import { prisma } from "@/lib/prisma";
import { getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString } from "@/lib/normalize";
import { loadAssignment } from "./assignment";
import type { RegistrationsSyncResult, SourceRow, SyncContext, SyncError } from "./types";

/**
 * Upsert customers from "new registrations" rows.
 * - New phone → create customer (NEW_REGISTRATION), followup for today, registration record.
 * - Known phone → only fill in blank profile fields; owner is never changed.
 */
export async function importRegistrationRows(
  rows: SourceRow[],
  ctx: SyncContext
): Promise<RegistrationsSyncResult> {
  const assign = await loadAssignment();

  const existingCustomers = await prisma.customer.findMany({
    select: {
      id: true, phone: true, customerIdExt: true, ownerId: true,
      name: true, gender: true, address: true, city: true, sector: true,
    },
  });
  const customerByPhone = new Map(existingCustomers.map((c) => [c.phone, c]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  type Parsed = {
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
    raw: Record<string, unknown>;
  };

  const toCreate: Parsed[] = [];
  const toUpdate: Parsed[] = [];
  let skipCount = 0;
  const errors: SyncError[] = [];
  const seen = new Set<string>();

  for (const { sheet, rowNum, data: row } of rows) {
    const phone = normalizePhone(getField(row, "Contact Number", "Number with prefix", "Phone"));
    if (!phone) {
      skipCount++;
      errors.push({ sheet, row: rowNum, reason: "Missing or invalid phone number", data: row });
      continue;
    }
    if (seen.has(phone)) {
      skipCount++;
      errors.push({ sheet, row: rowNum, reason: `Duplicate phone in sheet (${phone})`, data: row });
      continue;
    }
    seen.add(phone);

    const existing = customerByPhone.get(phone);
    const ownerRaw = cleanString(getField(row, "Owner"));

    let ownerId: string;
    let ownerWarning: string | null = null;
    let autoAssigned = false;
    let pendingOwnerName: string | null = null;
    if (existing) {
      ownerId = existing.ownerId || assign.adminUser.id;
    } else {
      const pick = assign.pickOwner(ownerRaw);
      ownerId = pick.ownerId;
      autoAssigned = pick.autoAssigned;
      pendingOwnerName = pick.pendingOwnerName;
      ownerWarning = pick.warning;
      if (ownerWarning) errors.push({ sheet, row: rowNum, reason: ownerWarning, data: row });
    }

    const parsed: Parsed = {
      phone,
      customerIdExt: cleanString(getField(row, "Customer ID")) || null,
      name: cleanString(getField(row, "Name")) || null,
      gender: cleanString(getField(row, "Gender")) || null,
      onboardingDate: parseFlexibleDate(getField(row, "Onboarding Date")),
      address: cleanString(getField(row, "Address")) || null,
      city: cleanString(getField(row, "City")) || null,
      sector: cleanString(getField(row, "Sector")) || null,
      ownerId, ownerWarning, autoAssigned, pendingOwnerName,
      raw: row,
    };
    if (existing) toUpdate.push(parsed);
    else toCreate.push(parsed);
  }

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
        customerType: "NEW_REGISTRATION" as const,
        ownerId: p.ownerId,
        pendingOwnerName: p.pendingOwnerName,
      })),
      skipDuplicates: true,
    });

    const created = await prisma.customer.findMany({
      where: { phone: { in: toCreate.map((p) => p.phone) } },
      select: { id: true, phone: true },
    });
    const idByPhone = new Map(created.map((c) => [c.phone, c.id]));
    const withId = toCreate.filter((p) => idByPhone.has(p.phone));

    await prisma.followup.createMany({
      data: withId.map((p) => ({ customerId: idByPhone.get(p.phone)!, nextFollowupDate: today })),
      skipDuplicates: true,
    });
    await prisma.activityLog.createMany({
      data: withId.map((p) => ({
        customerId: idByPhone.get(p.phone)!,
        userId: ctx.userId,
        activityType: "CUSTOMER_IMPORTED" as const,
        note: p.ownerWarning || (p.autoAssigned ? "Registration synced from Google Sheet, auto-assigned" : "Registration synced from Google Sheet"),
      })),
    });
    await prisma.registration.createMany({
      data: withId.map((p) => ({
        customerId: idByPhone.get(p.phone)!,
        customerIdExt: p.customerIdExt,
        onboardingDate: p.onboardingDate,
        rawData: p.raw as never,
      })),
      skipDuplicates: true,
    });
  }

  // Fill blanks on existing customers, in parallel batches
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  for (const p of toUpdate) {
    const e = customerByPhone.get(p.phone)!;
    const data: Record<string, unknown> = {};
    if (!e.name && p.name) data.name = p.name;
    if (!e.gender && p.gender) data.gender = p.gender;
    if (!e.address && p.address) data.address = p.address;
    if (!e.city && p.city) data.city = p.city;
    if (!e.sector && p.sector) data.sector = p.sector;
    if (!e.customerIdExt && p.customerIdExt) data.customerIdExt = p.customerIdExt;
    if (Object.keys(data).length > 0) updates.push({ id: e.id, data });
  }
  for (let i = 0; i < updates.length; i += 30) {
    await Promise.all(
      updates.slice(i, i + 30).map((u) => prisma.customer.update({ where: { id: u.id }, data: u.data }))
    );
  }

  return {
    totalRows: rows.length,
    newCount: toCreate.length,
    updateCount: toUpdate.length,
    skipCount,
    errorCount: errors.length,
    autoAssignedCount: assign.autoAssignedCount,
    agentBreakdown: assign.breakdown(),
    errors,
  };
}
