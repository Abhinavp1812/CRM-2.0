import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseFile, getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString, parseNumber } from "@/lib/normalize";

export const maxDuration = 60;

const FOLLOWUP_DAYS_DEFAULT = 20;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export async function POST(req: Request) {
  try {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sessionUserId = session.user.id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const sheetName = formData.get("sheetName") as string | null;
  if (!file || !sheetName) {
    return NextResponse.json({ error: "Missing file or sheetName" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const wb = await parseFile(buffer, file.name);
  const sheet = wb.sheets.find((s) => s.sheetName === sheetName);
  if (!sheet) {
    return NextResponse.json({ error: "Sheet not found" }, { status: 400 });
  }

  const [users, settings] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, role: true },
    }),
    prisma.setting.findMany(),
  ]);
  const userByName = new Map<string, { id: string; role: string }>();
  for (const u of users) userByName.set(u.name.toLowerCase().trim(), { id: u.id, role: u.role });
  const adminUser = users.find((u) => u.role === "ADMIN");
  if (!adminUser) {
    return NextResponse.json({ error: "No admin user for parking lot" }, { status: 500 });
  }
  const userId = sessionUserId === "super-admin" ? adminUser.id : sessionUserId;
  const followupDays = parseInt(
    settings.find((s) => s.key === "bookingFollowupDays")?.value || `${FOLLOWUP_DAYS_DEFAULT}`,
    10
  );

  // Round-robin agent assignment
  const activeAgents = await prisma.user.findMany({
    where: { role: "AGENT", deletedAt: null, onLeaveFrom: null },
    select: { id: true, name: true },
  });

  const agentCustomerCounts = await prisma.customer.groupBy({
    by: ["ownerId"],
    where: { deletedAt: null, ownerId: { in: activeAgents.map((a) => a.id) } },
    _count: { _all: true },
  });
  const countByOwner = new Map<string, number>();
  for (const row of agentCustomerCounts) {
    if (row.ownerId) countByOwner.set(row.ownerId, row._count._all);
  }

  const agentCounts = new Map<string, number>();
  activeAgents.forEach((a) => agentCounts.set(a.id, countByOwner.get(a.id) || 0));

  function nextAgentRoundRobin(): string | null {
    if (agentCounts.size === 0) return null;
    let minId: string | null = null;
    let minCount = Infinity;
    for (const [id, c] of agentCounts.entries()) {
      if (c < minCount) {
        minCount = c;
        minId = id;
      }
    }
    if (minId) agentCounts.set(minId, (agentCounts.get(minId) || 0) + 1);
    return minId;
  }

  const [existingCustomers, existingOrders, existingSalons] = await Promise.all([
    prisma.customer.findMany({
      select: {
        id: true, phone: true, ownerId: true, customerType: true,
        doNotContact: true,
      },
    }),
    prisma.booking.findMany({
      where: { orderNo: { not: null } },
      select: { orderNo: true },
    }),
    prisma.salon.findMany({
      where: { externalId: { not: null } },
      select: { id: true, externalId: true },
    }),
  ]);
  const customerByPhone = new Map(existingCustomers.map((c) => [c.phone, c]));
  const existingOrderNos = new Set(existingOrders.map((b) => b.orderNo!));
  const salonByExtId = new Map(existingSalons.map((s) => [s.externalId!, s.id]));

  type ParsedRow = {
    rowNum: number;
    phone: string;
    orderNo: string;
    raw: Record<string, unknown>;
    status: string;
    ownerRaw: string;
    customerName: string | null;
    bookingDate: Date | null;
    orderDate: Date | null;
    bookingTime: string | null;
    paymentStatus: string | null;
    aiCallingStatus: string | null;
    salonExtId: string | null;
    salonName: string | null;
    salonPhone: string | null;
    salonAddress: string | null;
    salonCity: string | null;
    salonState: string | null;
    gst: number | null;
    grossAmount: number | null;
    stylistDiscount: number | null;
    slotsDiscount: number | null;
    couponsDiscount: number | null;
    offersDiscount: number | null;
    hygieneFee: number | null;
    platformFee: number | null;
    grandTotal: number | null;
    tokenAmount: number | null;
    remainingAmount: number | null;
    gatewayOrderId: string | null;
    styleLoungeCoupon: string | null;
    salonCoupon: string | null;
    styleLoungeUser: string | null;
  };

  const toProcess: ParsedRow[] = [];
  let skipCount = 0;
  let duplicateOrderCount = 0;
  const errors: { row: number; reason: string; data: Record<string, unknown> }[] = [];
  const ordersInFile = new Set<string>();

  for (let idx = 0; idx < sheet.rows.length; idx++) {
    const row = sheet.rows[idx];
    const rowNum = idx + 2;
    const phone = normalizePhone(getField(row, "Contact Number"));
    const orderNo = cleanString(getField(row, "Order No.")) || null;

    if (!phone) {
      skipCount++;
      errors.push({ row: rowNum, reason: "Missing or invalid phone number", data: row });
      continue;
    }
    if (!orderNo) {
      skipCount++;
      errors.push({ row: rowNum, reason: "Missing Order No.", data: row });
      continue;
    }
    if (existingOrderNos.has(orderNo)) {
      duplicateOrderCount++;
      continue;
    }
    if (ordersInFile.has(orderNo)) {
      skipCount++;
      errors.push({ row: rowNum, reason: `Duplicate Order No. in same file (${orderNo})`, data: row });
      continue;
    }
    ordersInFile.add(orderNo);

    toProcess.push({
      rowNum,
      phone,
      orderNo,
      raw: row,
      status: cleanString(getField(row, "Status")),
      ownerRaw: cleanString(getField(row, "Owner")),
      customerName: cleanString(getField(row, "Customer Name")) || null,
      bookingDate: parseFlexibleDate(getField(row, "Booking Date")),
      orderDate: parseFlexibleDate(getField(row, "Order Date")),
      bookingTime: cleanString(getField(row, "Booking Time")) || null,
      paymentStatus: cleanString(getField(row, "Payment Status")) || null,
      aiCallingStatus: cleanString(getField(row, "AI Calling Status")) || null,
      salonExtId: cleanString(getField(row, "Salon Id")) || null,
      salonName: cleanString(getField(row, "Salon Name")) || null,
      salonPhone: cleanString(getField(row, "Salon Contact Number")) || null,
      salonAddress: cleanString(getField(row, "Address")) || null,
      salonCity: cleanString(getField(row, "City")) || null,
      salonState: cleanString(getField(row, "State")) || null,
      gst: parseNumber(getField(row, "GST")),
      grossAmount: parseNumber(getField(row, "Gross Amount")),
      stylistDiscount: parseNumber(getField(row, "Stylist Discount")),
      slotsDiscount: parseNumber(getField(row, "Slots Discount")),
      couponsDiscount: parseNumber(getField(row, "Coupons Discount")),
      offersDiscount: parseNumber(getField(row, "Offers Discount")),
      hygieneFee: parseNumber(getField(row, "Hygiene Fee")),
      platformFee: parseNumber(getField(row, "Plateform Fee", "Platform Fee")),
      grandTotal: parseNumber(getField(row, "Grand Total Amount")),
      tokenAmount: parseNumber(getField(row, "Token Amount")),
      remainingAmount: parseNumber(getField(row, "Remaining Amount")),
      gatewayOrderId: cleanString(getField(row, "Gateway Order ID")) || null,
      styleLoungeCoupon: cleanString(getField(row, "Style Lounge Coupon")) || null,
      salonCoupon: cleanString(getField(row, "Salon Coupon")) || null,
      styleLoungeUser: cleanString(getField(row, "Style Lounge User")) || null,
    });
  }

  // Salon ensure
  const newSalonExtIds = new Map<string, ParsedRow>();
  for (const p of toProcess) {
    if (p.salonExtId && !salonByExtId.has(p.salonExtId) && !newSalonExtIds.has(p.salonExtId)) {
      newSalonExtIds.set(p.salonExtId, p);
    }
  }
  if (newSalonExtIds.size > 0) {
    await prisma.salon.createMany({
      data: Array.from(newSalonExtIds.values()).map((p) => ({
        externalId: p.salonExtId!,
        name: p.salonName || `Salon ${p.salonExtId}`,
        phone: p.salonPhone,
        address: p.salonAddress,
        city: p.salonCity,
        state: p.salonState,
      })),
      skipDuplicates: true,
    });
    const newSalons = await prisma.salon.findMany({
      where: { externalId: { in: Array.from(newSalonExtIds.keys()) } },
      select: { id: true, externalId: true },
    });
    for (const s of newSalons) salonByExtId.set(s.externalId!, s.id);
  }

  // Customer ensure with round-robin auto-assign
  let autoAssignedCount = 0;
  const autoAssignedByAgent = new Map<string, number>(); // agentId -> count
  const newCustomers = new Map<string, ParsedRow>();
  for (const p of toProcess) {
    if (!customerByPhone.has(p.phone) && !newCustomers.has(p.phone)) {
      newCustomers.set(p.phone, p);
    }
  }

  // Pre-compute owner resolution so pendingOwnerName can be stored per customer
  const ownerResolution = new Map<string, { ownerId: string; pendingOwnerName: string | null }>();
  for (const p of newCustomers.values()) {
    let ownerId: string;
    let pendingOwnerName: string | null = null;
    if (p.ownerRaw) {
      const matched = userByName.get(p.ownerRaw.toLowerCase().trim());
      if (matched) {
        ownerId = matched.id;
      } else {
        // Agent name from CSV not in system yet — park temporarily, store name for later
        pendingOwnerName = p.ownerRaw;
        const rrId = nextAgentRoundRobin();
        if (rrId) {
          ownerId = rrId;
          autoAssignedCount++;
          autoAssignedByAgent.set(rrId, (autoAssignedByAgent.get(rrId) || 0) + 1);
          errors.push({ row: p.rowNum, reason: `Owner "${p.ownerRaw}" not found - parked temporarily, will auto-assign when agent is created`, data: p.raw });
        } else {
          ownerId = adminUser.id;
          errors.push({ row: p.rowNum, reason: `Owner "${p.ownerRaw}" not found and no active agents - parked with admin, will auto-assign when agent is created`, data: p.raw });
        }
      }
    } else {
      const rrId = nextAgentRoundRobin();
      if (rrId) {
        ownerId = rrId;
        autoAssignedCount++;
        autoAssignedByAgent.set(rrId, (autoAssignedByAgent.get(rrId) || 0) + 1);
      } else {
        ownerId = adminUser.id;
      }
    }
    ownerResolution.set(p.phone, { ownerId, pendingOwnerName });
  }

  if (newCustomers.size > 0) {
    await prisma.customer.createMany({
      data: Array.from(newCustomers.values()).map((p) => {
        const { ownerId, pendingOwnerName } = ownerResolution.get(p.phone)!;
        return {
          phone: p.phone,
          name: p.customerName,
          city: p.salonCity,
          customerType: "CUSTOMER" as const,
          pendingOwnerName,
          ownerId,
        };
      }),
      skipDuplicates: true,
    });
    const justCreated = await prisma.customer.findMany({
      where: { phone: { in: Array.from(newCustomers.keys()) } },
      select: {
        id: true, phone: true, ownerId: true, customerType: true, doNotContact: true,
      },
    });
    for (const c of justCreated) customerByPhone.set(c.phone, c);
  }

  // Build agent breakdown for response
  const agentBreakdown = Array.from(autoAssignedByAgent.entries()).map(([agentId, count]) => {
    const agent = activeAgents.find((a) => a.id === agentId);
    return { agentId, agentName: agent?.name || "Unknown", count };
  }).sort((a, b) => b.count - a.count);

  // Upgrade NEW_REGISTRATION -> CUSTOMER (sticky ownership)
  const phonesToUpgrade: string[] = [];
  for (const p of toProcess) {
    const c = customerByPhone.get(p.phone);
    if (c && c.customerType === "NEW_REGISTRATION") {
      phonesToUpgrade.push(p.phone);
    }
  }
  if (phonesToUpgrade.length > 0) {
    await prisma.customer.updateMany({
      where: { phone: { in: phonesToUpgrade } },
      data: { customerType: "CUSTOMER" },
    });
    const upgradeIds = Array.from(new Set(phonesToUpgrade)).map((ph) => customerByPhone.get(ph)?.id).filter(Boolean) as string[];
    await prisma.activityLog.createMany({
      data: upgradeIds.map((id) => ({
        customerId: id,
        userId,
        activityType: "CUSTOMER_TYPE_CHANGED" as const,
        oldValue: "NEW_REGISTRATION",
        newValue: "CUSTOMER",
        note: "Promoted via booking import",
      })),
    });
  }

  // Filter to rows whose customer is confirmed in the map (guards against race-condition gaps)
  const processable = toProcess.filter((p) => customerByPhone.has(p.phone));

  // Bulk-create bookings
  await prisma.booking.createMany({
    data: processable.map((p) => ({
      customerId: customerByPhone.get(p.phone)!.id,
      orderNo: p.orderNo,
      aiCallingStatus: p.aiCallingStatus,
      orderDate: p.orderDate,
      bookingDate: p.bookingDate,
      bookingTime: p.bookingTime,
      status: p.status || null,
      paymentStatus: p.paymentStatus,
      salonId: p.salonExtId ? salonByExtId.get(p.salonExtId) || null : null,
      salonNameSnapshot: p.salonName,
      city: p.salonCity,
      state: p.salonState,
      address: p.salonAddress,
      gst: p.gst,
      grossAmount: p.grossAmount,
      stylistDiscount: p.stylistDiscount,
      slotsDiscount: p.slotsDiscount,
      couponsDiscount: p.couponsDiscount,
      offersDiscount: p.offersDiscount,
      hygieneFee: p.hygieneFee,
      platformFee: p.platformFee,
      grandTotal: p.grandTotal,
      tokenAmount: p.tokenAmount,
      remainingAmount: p.remainingAmount,
      gatewayOrderId: p.gatewayOrderId,
      styleLoungeCoupon: p.styleLoungeCoupon,
      salonCoupon: p.salonCoupon,
      styleLoungeUser: p.styleLoungeUser,
      rawData: p.raw as never,
    })),
    skipDuplicates: true,
  });

  await prisma.activityLog.createMany({
    data: processable.map((p) => ({
      customerId: customerByPhone.get(p.phone)!.id,
      userId,
      activityType: "BOOKING_IMPORTED" as const,
      note: `Order ${p.orderNo} (${p.status || "no status"})`,
    })),
  });

  // Followup scheduling - latest booking wins
  const latestInImport = new Map<string, Date>();
  for (const p of toProcess) {
    if (!p.bookingDate) continue;
    const c = customerByPhone.get(p.phone);
    if (!c) continue;
    if (c.doNotContact) continue;

    const existing = latestInImport.get(c.id);
    if (!existing || p.bookingDate.getTime() > existing.getTime()) {
      latestInImport.set(c.id, p.bookingDate);
    }
  }

  const customerIds = Array.from(latestInImport.keys());
  if (customerIds.length === 0) {
    await prisma.importHistory.create({
      data: {
        importType: "BOOKINGS",
        filename: file.name,
        uploadedById: userId,
        totalRows: sheet.rows.length,
        newCount: toProcess.length,
        updatedCount: phonesToUpgrade.length,
        skippedCount: skipCount + duplicateOrderCount,
        errorCount: errors.length,
        notes: `Sheet: ${sheetName}; ${autoAssignedCount} auto-assigned; no followups scheduled`,
      },
    });
    return NextResponse.json({
      success: true,
      totalRows: sheet.rows.length,
      newBookingCount: toProcess.length,
      duplicateOrderCount,
      upgradedCustomerCount: phonesToUpgrade.length,
      autoAssignedCount,
      agentBreakdown,
      skipCount,
      errorCount: errors.length,
      followupsCreated: 0,
      followupsUpdated: 0,
      followupsSkipped: 0,
      errors,
    });
  }

  const [existingFollowups, allBookingDates] = await Promise.all([
    prisma.followup.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, nextFollowupDate: true },
    }),
    prisma.booking.findMany({
      where: { customerId: { in: customerIds }, bookingDate: { not: null } },
      select: { customerId: true, bookingDate: true },
    }),
  ]);

  const followupByCustomer = new Map(existingFollowups.map((f) => [f.customerId, f.nextFollowupDate]));

  const overallMaxByCustomer = new Map<string, Date>();
  for (const b of allBookingDates) {
    if (!b.bookingDate) continue;
    const existing = overallMaxByCustomer.get(b.customerId);
    if (!existing || b.bookingDate.getTime() > existing.getTime()) {
      overallMaxByCustomer.set(b.customerId, b.bookingDate);
    }
  }

  let followupsCreated = 0;
  let followupsUpdated = 0;
  let followupsSkipped = 0;
  const followupActivityLogs: { customerId: string; userId: string; activityType: "FOLLOWUP_DATE_CHANGED"; oldValue: string | null; newValue: string; note: string }[] = [];

  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const followupCreates: { customerId: string; nextFollowupDate: Date; updatedById: string }[] = [];
  const followupUpdates: { cid: string; finalDate: Date; oldDate: Date }[] = [];

  for (const [cid, importLatest] of latestInImport) {
    const overallMax = overallMaxByCustomer.get(cid);
    if (!overallMax) continue;
    if (importLatest.getTime() !== overallMax.getTime()) { followupsSkipped++; continue; }

    const finalDate = maxDate(addDays(importLatest, followupDays), todayDate);
    const existingFollowup = followupByCustomer.get(cid);

    if (!existingFollowup) {
      followupCreates.push({ customerId: cid, nextFollowupDate: finalDate, updatedById: userId });
      followupActivityLogs.push({ customerId: cid, userId, activityType: "FOLLOWUP_DATE_CHANGED", oldValue: null, newValue: finalDate.toISOString(), note: "Followup auto-created from new booking" });
      followupsCreated++;
    } else {
      followupUpdates.push({ cid, finalDate, oldDate: existingFollowup });
      followupActivityLogs.push({ customerId: cid, userId, activityType: "FOLLOWUP_DATE_CHANGED", oldValue: existingFollowup.toISOString(), newValue: finalDate.toISOString(), note: "Followup reset by new booking import (latest booking wins)" });
      followupsUpdated++;
    }
  }

  // Batch creates
  if (followupCreates.length > 0) {
    await prisma.followup.createMany({ data: followupCreates, skipDuplicates: true });
  }

  // Parallel updates in batches of 30
  for (let i = 0; i < followupUpdates.length; i += 30) {
    await Promise.all(
      followupUpdates.slice(i, i + 30).map(({ cid, finalDate }) =>
        prisma.followup.update({
          where: { customerId: cid },
          data: { nextFollowupDate: finalDate, currentRemark: null, currentNote: null, lastContactedAt: null, lastContactedById: null, updatedById: userId },
        })
      )
    );
  }

  if (followupActivityLogs.length > 0) {
    await prisma.activityLog.createMany({ data: followupActivityLogs });
  }

  await prisma.importHistory.create({
    data: {
      importType: "BOOKINGS",
      filename: file.name,
      uploadedById: userId,
      totalRows: sheet.rows.length,
      newCount: toProcess.length,
      updatedCount: phonesToUpgrade.length,
      skippedCount: skipCount + duplicateOrderCount,
      errorCount: errors.length,
      notes: `Sheet: ${sheetName}; ${autoAssignedCount} auto-assigned; ${followupsCreated} new followups, ${followupsUpdated} updated, ${followupsSkipped} skipped (backdated)`,
    },
  });

  return NextResponse.json({
    success: true,
    totalRows: sheet.rows.length,
    newBookingCount: toProcess.length,
    duplicateOrderCount,
    upgradedCustomerCount: phonesToUpgrade.length,
    autoAssignedCount,
    agentBreakdown,
    skipCount,
    errorCount: errors.length,
    followupsCreated,
    followupsUpdated,
    followupsSkipped,
    errors,
  });
  } catch (err) {
    console.error("[bookings/commit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}