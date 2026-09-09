import { prisma } from "@/lib/prisma";
import { getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString, parseNumber } from "@/lib/normalize";
import { loadAssignment } from "./assignment";
import { createManyChunked, findManyChunked, healMissingFollowups } from "./heal";
import type { BookingsSyncResult, SourceRow, SyncContext, SyncError } from "./types";

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

/**
 * Insert bookings from the booking-dump rows.
 * - Dedup by Order No. (already-known orders are skipped silently).
 * - Unknown phones become CUSTOMER records, assigned to the least-loaded agent.
 * - NEW_REGISTRATION customers with a booking are promoted to CUSTOMER (owner unchanged).
 * - Followup date = latest booking + bookingFollowupDays, only when this booking
 *   is the latest one the customer has overall ("latest booking wins").
 */
export async function importBookingRows(
  rows: SourceRow[],
  ctx: SyncContext
): Promise<BookingsSyncResult> {
  const [assign, settings] = await Promise.all([loadAssignment(), prisma.setting.findMany()]);
  const followupDays = parseInt(
    settings.find((s) => s.key === "bookingFollowupDays")?.value || `${FOLLOWUP_DAYS_DEFAULT}`,
    10
  );

  const [existingCustomers, existingOrders, existingSalons] = await Promise.all([
    prisma.customer.findMany({
      select: { id: true, phone: true, ownerId: true, customerType: true, doNotContact: true },
    }),
    prisma.booking.findMany({ where: { orderNo: { not: null } }, select: { orderNo: true } }),
    prisma.salon.findMany({ where: { externalId: { not: null } }, select: { id: true, externalId: true } }),
  ]);
  const customerByPhone = new Map(existingCustomers.map((c) => [c.phone, c]));
  const existingOrderNos = new Set(existingOrders.map((b) => b.orderNo!));
  const salonByExtId = new Map(existingSalons.map((s) => [s.externalId!, s.id]));

  type Parsed = {
    sheet: string;
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

  const toProcess: Parsed[] = [];
  let skipCount = 0;
  let duplicateOrderCount = 0;
  const errors: SyncError[] = [];
  const ordersSeen = new Set<string>();

  for (const { sheet, rowNum, data: row } of rows) {
    const orderNo = cleanString(getField(row, "Order No.", "Order No", "Order Number")) || null;
    // Already in the DB: silent skip, no need to parse further
    if (orderNo && existingOrderNos.has(orderNo)) {
      duplicateOrderCount++;
      continue;
    }
    const phone = normalizePhone(getField(row, "Contact Number", "Phone"));
    if (!phone) {
      skipCount++;
      errors.push({ sheet, row: rowNum, reason: "Missing or invalid phone number", data: row });
      continue;
    }
    if (!orderNo) {
      skipCount++;
      errors.push({ sheet, row: rowNum, reason: "Missing Order No.", data: row });
      continue;
    }
    if (ordersSeen.has(orderNo)) {
      skipCount++;
      errors.push({ sheet, row: rowNum, reason: `Duplicate Order No. in sheet (${orderNo})`, data: row });
      continue;
    }
    ordersSeen.add(orderNo);

    toProcess.push({
      sheet, rowNum, phone, orderNo, raw: row,
      status: cleanString(getField(row, "Status")),
      ownerRaw: cleanString(getField(row, "Owner")),
      customerName: cleanString(getField(row, "Customer Name")) || null,
      bookingDate: parseFlexibleDate(getField(row, "Booking Date")),
      orderDate: parseFlexibleDate(getField(row, "Order Date")),
      bookingTime: cleanString(getField(row, "Booking Time")) || null,
      paymentStatus: cleanString(getField(row, "Payment Status")) || null,
      aiCallingStatus: cleanString(getField(row, "AI Calling Status")) || null,
      salonExtId: cleanString(getField(row, "Salon Id", "Salon ID")) || null,
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

  // ---------- Salons ----------
  const newSalons = new Map<string, Parsed>();
  for (const p of toProcess) {
    if (p.salonExtId && !salonByExtId.has(p.salonExtId) && !newSalons.has(p.salonExtId)) {
      newSalons.set(p.salonExtId, p);
    }
  }
  if (newSalons.size > 0) {
    await prisma.salon.createMany({
      data: Array.from(newSalons.values()).map((p) => ({
        externalId: p.salonExtId!,
        name: p.salonName || `Salon ${p.salonExtId}`,
        phone: p.salonPhone,
        address: p.salonAddress,
        city: p.salonCity,
        state: p.salonState,
      })),
      skipDuplicates: true,
    });
    const created = await prisma.salon.findMany({
      where: { externalId: { in: Array.from(newSalons.keys()) } },
      select: { id: true, externalId: true },
    });
    for (const s of created) salonByExtId.set(s.externalId!, s.id);
  }

  // ---------- New customers ----------
  const newCustomers = new Map<string, Parsed>();
  for (const p of toProcess) {
    if (!customerByPhone.has(p.phone) && !newCustomers.has(p.phone)) newCustomers.set(p.phone, p);
  }
  if (newCustomers.size > 0) {
    await createManyChunked(Array.from(newCustomers.values()), (chunk) =>
      prisma.customer.createMany({
        data: chunk.map((p) => {
          const pick = assign.pickOwner(p.ownerRaw);
          if (pick.warning) errors.push({ sheet: p.sheet, row: p.rowNum, reason: pick.warning, data: p.raw });
          return {
            phone: p.phone,
            name: p.customerName,
            city: p.salonCity,
            customerType: "CUSTOMER" as const,
            ownerId: pick.ownerId,
            pendingOwnerName: pick.pendingOwnerName,
          };
        }),
        skipDuplicates: true,
      })
    );
    const created = await findManyChunked(
      Array.from(newCustomers.keys()),
      (chunk) =>
        prisma.customer.findMany({
          where: { phone: { in: chunk } },
          select: { id: true, phone: true, ownerId: true, customerType: true, doNotContact: true },
        })
    );
    for (const c of created) customerByPhone.set(c.phone, c);

    await createManyChunked(created, (chunk) =>
      prisma.activityLog.createMany({
        data: chunk.map((c) => ({
          customerId: c.id,
          userId: ctx.userId,
          activityType: "CUSTOMER_IMPORTED" as const,
          note: "Customer created from booking sync (Google Sheet)",
        })),
      })
    );
  }

  // ---------- Promote NEW_REGISTRATION -> CUSTOMER ----------
  const upgradeIds = new Set<string>();
  for (const p of toProcess) {
    const c = customerByPhone.get(p.phone);
    if (c && c.customerType === "NEW_REGISTRATION") upgradeIds.add(c.id);
  }
  if (upgradeIds.size > 0) {
    const ids = Array.from(upgradeIds);
    await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { customerType: "CUSTOMER" } });
    await prisma.activityLog.createMany({
      data: ids.map((id) => ({
        customerId: id,
        userId: ctx.userId,
        activityType: "CUSTOMER_TYPE_CHANGED" as const,
        oldValue: "NEW_REGISTRATION",
        newValue: "CUSTOMER",
        note: "Promoted via booking sync",
      })),
    });
  }

  // ---------- Bookings ----------
  const processable = toProcess.filter((p) => customerByPhone.has(p.phone));
  if (processable.length > 0) {
    await createManyChunked(processable, (chunk) =>
      prisma.booking.createMany({
        data: chunk.map((p) => ({
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
      })
    );
    await createManyChunked(processable, (chunk) =>
      prisma.activityLog.createMany({
        data: chunk.map((p) => ({
          customerId: customerByPhone.get(p.phone)!.id,
          userId: ctx.userId,
          activityType: "BOOKING_IMPORTED" as const,
          note: `Order ${p.orderNo} (${p.status || "no status"})`,
        })),
      })
    );
  }

  // ---------- Followups: latest booking wins ----------
  const latestInSync = new Map<string, Date>();
  for (const p of processable) {
    if (!p.bookingDate) continue;
    const c = customerByPhone.get(p.phone)!;
    if (c.doNotContact) continue;
    const prev = latestInSync.get(c.id);
    if (!prev || p.bookingDate.getTime() > prev.getTime()) latestInSync.set(c.id, p.bookingDate);
  }

  let followupsCreated = 0;
  let followupsUpdated = 0;
  let followupsSkipped = 0;

  const customerIds = Array.from(latestInSync.keys());
  if (customerIds.length > 0) {
    const [existingFollowups, allBookingDates] = await Promise.all([
      findManyChunked(customerIds, (chunk) =>
        prisma.followup.findMany({
          where: { customerId: { in: chunk } },
          select: { customerId: true, nextFollowupDate: true },
        })
      ),
      findManyChunked(customerIds, (chunk) =>
        prisma.booking.findMany({
          where: { customerId: { in: chunk }, bookingDate: { not: null } },
          select: { customerId: true, bookingDate: true },
        })
      ),
    ]);
    const followupByCustomer = new Map(existingFollowups.map((f) => [f.customerId, f.nextFollowupDate]));
    const overallMax = new Map<string, Date>();
    for (const b of allBookingDates) {
      if (!b.bookingDate) continue;
      const prev = overallMax.get(b.customerId);
      if (!prev || b.bookingDate.getTime() > prev.getTime()) overallMax.set(b.customerId, b.bookingDate);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const creates: { customerId: string; nextFollowupDate: Date; updatedById: string }[] = [];
    const updates: { cid: string; finalDate: Date }[] = [];
    const logs: {
      customerId: string; userId: string; activityType: "FOLLOWUP_DATE_CHANGED";
      oldValue: string | null; newValue: string; note: string;
    }[] = [];

    for (const [cid, latest] of latestInSync) {
      const max = overallMax.get(cid);
      if (!max) continue;
      if (latest.getTime() !== max.getTime()) { followupsSkipped++; continue; }

      const finalDate = maxDate(addDays(latest, followupDays), today);
      const existing = followupByCustomer.get(cid);
      if (!existing) {
        creates.push({ customerId: cid, nextFollowupDate: finalDate, updatedById: ctx.userId });
        logs.push({ customerId: cid, userId: ctx.userId, activityType: "FOLLOWUP_DATE_CHANGED", oldValue: null, newValue: finalDate.toISOString(), note: "Followup auto-created from new booking" });
        followupsCreated++;
      } else {
        updates.push({ cid, finalDate });
        logs.push({ customerId: cid, userId: ctx.userId, activityType: "FOLLOWUP_DATE_CHANGED", oldValue: existing.toISOString(), newValue: finalDate.toISOString(), note: "Followup reset by new booking sync (latest booking wins)" });
        followupsUpdated++;
      }
    }

    if (creates.length > 0) {
      await createManyChunked(creates, (chunk) =>
        prisma.followup.createMany({ data: chunk, skipDuplicates: true })
      );
    }
    // One-at-a-time updates don't scale: hundreds of individual UPDATE round trips are
    // exactly what blew the function timeout here. A single bulk SQL statement (same
    // json_array_elements pattern the followups importer already uses) replaces all of
    // them with one query per chunk, regardless of how many customers need resetting.
    if (updates.length > 0) {
      const updateData = updates.map(({ cid, finalDate }) => ({ cid, fd: finalDate.toISOString() }));
      for (let i = 0; i < updateData.length; i += 2000) {
        const chunk = updateData.slice(i, i + 2000);
        await prisma.$executeRaw`
          UPDATE "Followup" f
          SET
            "nextFollowupDate" = (v->>'fd')::timestamptz,
            "currentRemark" = NULL,
            "currentNote" = NULL,
            "lastContactedAt" = NULL,
            "lastContactedById" = NULL,
            "updatedById" = ${ctx.userId},
            "updatedAt" = NOW()
          FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
          WHERE f."customerId" = v->>'cid'
        `;
      }
    }
    if (logs.length > 0) {
      await createManyChunked(logs, (chunk) => prisma.activityLog.createMany({ data: chunk }));
    }
  }

  const healedFollowups = await healMissingFollowups(ctx.userId, followupDays);

  return {
    totalRows: rows.length,
    newBookingCount: processable.length,
    healedFollowups,
    duplicateOrderCount,
    upgradedCustomerCount: upgradeIds.size,
    newCustomerCount: newCustomers.size,
    autoAssignedCount: assign.autoAssignedCount,
    agentBreakdown: assign.breakdown(),
    skipCount,
    errorCount: errors.length,
    followupsCreated,
    followupsUpdated,
    followupsSkipped,
    errors,
  };
}
