import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseFile, getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString } from "@/lib/normalize";

export const maxDuration = 60;

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

  // ---------- Pre-load reference data ----------
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, role: true },
  });
  const userByName = new Map<string, { id: string; role: string }>();
  for (const u of users) userByName.set(u.name.toLowerCase().trim(), { id: u.id, role: u.role });
  const adminUser = users.find((u) => u.role === "ADMIN");
  if (!adminUser) {
    return NextResponse.json({ error: "No admin user for parking lot" }, { status: 500 });
  }
  // Super Admin is virtual (not in DB), use real admin's ID for FK fields
  const userId = sessionUserId === "super-admin" ? adminUser.id : sessionUserId;

  // ---------- Round-robin agent assignment ----------
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

  // For deterministic even distribution of new customers, use cyclic round-robin over activeAgents
  const agentList = activeAgents.map((a) => a.id);
  let rrIndex = 0;
  function nextAgentRoundRobin(): string | null {
    if (agentList.length === 0) return null;
    const id = agentList[rrIndex % agentList.length];
    rrIndex++;
    return id;
  }

  const existingCustomers = await prisma.customer.findMany({
    select: {
      id: true, phone: true, customerIdExt: true, ownerId: true,
      name: true, gender: true, address: true, city: true, sector: true,
    },
  });
  const customerByPhone = new Map<string, typeof existingCustomers[0]>();
  for (const c of existingCustomers) customerByPhone.set(c.phone, c);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  type ParsedRow = {
    rowNum: number;
    phone: string;
    customerIdExt: string | null;
    name: string | null;
    gender: string | null;
    onboardingDate: Date | null;
    address: string | null;
    city: string | null;
    sector: string | null;
    ownerId: string;
    ownerWarning: string | null;
    autoAssigned: boolean;
    pendingOwnerName: string | null;
    isExisting: boolean;
    existingId: string | null;
    raw: Record<string, unknown>;
  };

  const toCreate: ParsedRow[] = [];
  const toUpdate: ParsedRow[] = [];
  let skipCount = 0;
  let autoAssignedCount = 0;
  const autoAssignedByAgent = new Map<string, number>(); // agentId -> count
  const errors: { row: number; reason: string; data: Record<string, unknown> }[] = [];
  const seenInFile = new Set<string>();

  for (let idx = 0; idx < sheet.rows.length; idx++) {
    const row = sheet.rows[idx];
    const rowNum = idx + 2;
    const phone = normalizePhone(getField(row, "Contact Number"));
    if (!phone) {
      skipCount++;
      errors.push({ row: rowNum, reason: "Missing or invalid phone number", data: row });
      continue;
    }
    if (seenInFile.has(phone)) {
      skipCount++;
      errors.push({ row: rowNum, reason: `Duplicate phone in same file (${phone})`, data: row });
      continue;
    }
    seenInFile.add(phone);

    const customerIdExt = cleanString(getField(row, "Customer ID")) || null;
    const name = cleanString(getField(row, "Name")) || null;
    const gender = cleanString(getField(row, "Gender")) || null;
    const onboardingDate = parseFlexibleDate(getField(row, "Onboarding Date"));
    const address = cleanString(getField(row, "Address")) || null;
    const city = cleanString(getField(row, "City")) || null;
    const sector = cleanString(getField(row, "Sector")) || null;
    const ownerRaw = cleanString(getField(row, "Owner"));

    let ownerId: string;
    let ownerWarning: string | null = null;
    let autoAssigned = false;
    let pendingOwnerName: string | null = null;
    const existing = customerByPhone.get(phone);

    if (existing) {
      // Sticky ownership - never reassign existing customers
      ownerId = existing.ownerId || adminUser.id;
    } else if (ownerRaw) {
      const matched = userByName.get(ownerRaw.toLowerCase().trim());
      if (matched) {
        ownerId = matched.id;
      } else {
        // Agent name from CSV not in system yet — park temporarily, store name for later
        pendingOwnerName = ownerRaw;
        const rrId = nextAgentRoundRobin();
        if (rrId) {
          ownerId = rrId;
          autoAssigned = true;
          autoAssignedCount++;
          autoAssignedByAgent.set(rrId, (autoAssignedByAgent.get(rrId) || 0) + 1);
          ownerWarning = `Owner "${ownerRaw}" not found - parked temporarily, will auto-assign when agent is created`;
        } else {
          ownerId = adminUser.id;
          ownerWarning = `Owner "${ownerRaw}" not found and no active agents - parked with admin, will auto-assign when agent is created`;
        }
        errors.push({ row: rowNum, reason: ownerWarning, data: row });
      }
    } else {
      const rrId = nextAgentRoundRobin();
      if (rrId) {
        ownerId = rrId;
        autoAssigned = true;
        autoAssignedCount++;
        autoAssignedByAgent.set(rrId, (autoAssignedByAgent.get(rrId) || 0) + 1);
      } else {
        ownerId = adminUser.id;
      }
    }

    const parsed: ParsedRow = {
      rowNum, phone, customerIdExt, name, gender, onboardingDate,
      address, city, sector, ownerId, ownerWarning, autoAssigned, pendingOwnerName,
      isExisting: !!existing,
      existingId: existing?.id || null,
      raw: row,
    };

    if (existing) toUpdate.push(parsed);
    else toCreate.push(parsed);
  }

  // ---------- Bulk DB writes ----------
  if (toCreate.length > 0) {
    await prisma.customer.createMany({
      data: toCreate.map((p) => ({
        phone: p.phone,
        name: p.name,
        gender: p.gender,
        address: p.address,
        city: p.city,
        sector: p.sector,
        customerIdExt: p.customerIdExt,
        customerType: "NEW_REGISTRATION",
        ownerId: p.ownerId,
        pendingOwnerName: p.pendingOwnerName,
      })),
      skipDuplicates: true,
    });

    const newCustomers = await prisma.customer.findMany({
      where: { phone: { in: toCreate.map((p) => p.phone) } },
      select: { id: true, phone: true },
    });
    const idByPhone = new Map(newCustomers.map((c) => [c.phone, c.id]));

    await prisma.followup.createMany({
      data: toCreate
        .map((p) => ({
          customerId: idByPhone.get(p.phone)!,
          nextFollowupDate: today,
        }))
        .filter((f) => f.customerId),
      skipDuplicates: true,
    });

    await prisma.activityLog.createMany({
      data: toCreate
        .filter((p) => idByPhone.get(p.phone))
        .map((p) => ({
          customerId: idByPhone.get(p.phone)!,
          userId,
          activityType: "CUSTOMER_IMPORTED" as const,
          note: p.ownerWarning || (p.autoAssigned ? "Registration imported, auto-assigned" : "Registration imported"),
        })),
    });

    await prisma.registration.createMany({
      data: toCreate
        .filter((p) => idByPhone.get(p.phone))
        .map((p) => ({
          customerId: idByPhone.get(p.phone)!,
          customerIdExt: p.customerIdExt,
          onboardingDate: p.onboardingDate,
          rawData: p.raw as never,
        })),
      skipDuplicates: true,
    });
  }

  for (const p of toUpdate) {
    const existing = customerByPhone.get(p.phone)!;
    const data: Record<string, unknown> = {};
    if (!existing.name && p.name) data.name = p.name;
    if (!existing.gender && p.gender) data.gender = p.gender;
    if (!existing.address && p.address) data.address = p.address;
    if (!existing.city && p.city) data.city = p.city;
    if (!existing.sector && p.sector) data.sector = p.sector;
    if (!existing.customerIdExt && p.customerIdExt) data.customerIdExt = p.customerIdExt;
    if (Object.keys(data).length > 0) {
      await prisma.customer.update({ where: { id: existing.id }, data });
    }
  }

  // Build agent breakdown for response
  const agentBreakdown = Array.from(autoAssignedByAgent.entries()).map(([agentId, count]) => {
    const agent = activeAgents.find((a) => a.id === agentId);
    return { agentId, agentName: agent?.name || "Unknown", count };
  }).sort((a, b) => b.count - a.count);

  await prisma.importHistory.create({
    data: {
      importType: "REGISTRATIONS",
      filename: file.name,
      uploadedById: userId,
      totalRows: sheet.rows.length,
      newCount: toCreate.length,
      updatedCount: toUpdate.length,
      skippedCount: skipCount,
      errorCount: errors.length,
      notes: `Sheet: ${sheetName}; ${autoAssignedCount} auto-assigned via round-robin`,
    },
  });

  return NextResponse.json({
    success: true,
    totalRows: sheet.rows.length,
    newCount: toCreate.length,
    updateCount: toUpdate.length,
    skipCount,
    errorCount: errors.length,
    autoAssignedCount,
    agentBreakdown,
    errors,
  });
  } catch (err) {
    console.error("[registrations/commit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
