import { prisma } from "@/lib/prisma";
import { getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString } from "@/lib/normalize";
import { loadAssignment } from "./assignment";
import { createManyChunked, findManyChunked, healMissingFollowups } from "./heal";
import type { RegistrationsSyncResult, SourceRow, SyncContext, SyncError } from "./types";

/**
 * Upsert customers from "new registrations" rows.
 * - New phone → create customer (NEW_REGISTRATION), followup for today, registration record.
 * - Known phone → only fill in blank profile fields; owner is never changed.
 */
const FOLLOWUP_DAYS_DEFAULT = 20;

export async function importRegistrationRows(
  rows: SourceRow[],
  ctx: SyncContext
): Promise<RegistrationsSyncResult> {
  const [assign, settings] = await Promise.all([loadAssignment(), prisma.setting.findMany()]);
  const followupDays = parseInt(
    settings.find((s) => s.key === "bookingFollowupDays")?.value || `${FOLLOWUP_DAYS_DEFAULT}`,
    10
  );

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
    await createManyChunked(toCreate, (chunk) =>
      prisma.customer.createMany({
        data: chunk.map((p) => ({
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
      })
    );

    // A single query with 15,000+ phones in an IN clause is slow enough on its
    // own to risk the function timeout - read it back in parallel chunks instead.
    const created = await findManyChunked(
      toCreate.map((p) => p.phone),
      (chunk) => prisma.customer.findMany({ where: { phone: { in: chunk } }, select: { id: true, phone: true } })
    );
    const idByPhone = new Map(created.map((c) => [c.phone, c.id]));
    const withId = toCreate.filter((p) => idByPhone.has(p.phone));

    // These three tables are independent of each other - write them concurrently
    // instead of one after another to cut this step's wall-clock time roughly 3x.
    await Promise.all([
      createManyChunked(withId, (chunk) =>
        prisma.followup.createMany({
          data: chunk.map((p) => ({ customerId: idByPhone.get(p.phone)!, nextFollowupDate: today })),
          skipDuplicates: true,
        })
      ),
      createManyChunked(withId, (chunk) =>
        prisma.activityLog.createMany({
          data: chunk.map((p) => ({
            customerId: idByPhone.get(p.phone)!,
            userId: ctx.userId,
            activityType: "CUSTOMER_IMPORTED" as const,
            note: p.ownerWarning || (p.autoAssigned ? "Registration synced from Google Sheet, auto-assigned" : "Registration synced from Google Sheet"),
          })),
        })
      ),
      createManyChunked(withId, (chunk) =>
        prisma.registration.createMany({
          data: chunk.map((p) => ({
            customerId: idByPhone.get(p.phone)!,
            customerIdExt: p.customerIdExt,
            onboardingDate: p.onboardingDate,
            rawData: p.raw as never,
          })),
          skipDuplicates: true,
        })
      ),
    ]);
  }

  // Fill blanks on existing customers. Only rows with at least one blank field
  // to fill are included - most already-migrated customers have nothing to do
  // here (as this run just proved: 0 updates needed for 15,091 already-known
  // customers). But if that ever isn't true, one-at-a-time updates in batches
  // of 30 is the exact pattern that timed out the bookings sync - so this uses
  // the same single bulk SQL statement instead, chunked for safety at scale.
  // Missing keys mean "leave unchanged" (COALESCE keeps the existing value).
  type Fill = { id: string; name: string | null; gender: string | null; address: string | null; city: string | null; sector: string | null; customerIdExt: string | null };
  const updates: Fill[] = [];
  for (const p of toUpdate) {
    const e = customerByPhone.get(p.phone)!;
    const fill: Fill = {
      id: e.id,
      name: !e.name && p.name ? p.name : null,
      gender: !e.gender && p.gender ? p.gender : null,
      address: !e.address && p.address ? p.address : null,
      city: !e.city && p.city ? p.city : null,
      sector: !e.sector && p.sector ? p.sector : null,
      customerIdExt: !e.customerIdExt && p.customerIdExt ? p.customerIdExt : null,
    };
    const hasFill = fill.name || fill.gender || fill.address || fill.city || fill.sector || fill.customerIdExt;
    if (hasFill) updates.push(fill);
  }
  for (let i = 0; i < updates.length; i += 2000) {
    const chunk = updates.slice(i, i + 2000);
    await prisma.$executeRaw`
      UPDATE "Customer" c
      SET
        "name" = COALESCE(v->>'name', c."name"),
        "gender" = COALESCE(v->>'gender', c."gender"),
        "address" = COALESCE(v->>'address', c."address"),
        "city" = COALESCE(v->>'city', c."city"),
        "sector" = COALESCE(v->>'sector', c."sector"),
        "customerIdExt" = COALESCE(v->>'customerIdExt', c."customerIdExt"),
        "updatedAt" = NOW()
      FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
      WHERE c.id = v->>'id'
    `;
  }

  // A customer who already existed by phone (imported before this sync ever ran,
  // or picked up first by a booking) never went through the toCreate branch above,
  // so they never got a Registration row - meaning their onboarding date and raw
  // sheet snapshot were silently dropped every time this sync saw them, no matter
  // how many times it ran. Back-fill one registration for anyone in toUpdate who
  // doesn't already have one, so this data isn't lost for existing customers.
  if (toUpdate.length > 0) {
    const toUpdateIds = toUpdate.map((p) => customerByPhone.get(p.phone)!.id);
    const alreadyRegistered = new Set(
      (await findManyChunked(
        toUpdateIds,
        (chunk) => prisma.registration.findMany({ where: { customerId: { in: chunk } }, select: { customerId: true } })
      )).map((r) => r.customerId)
    );

    const backfill = toUpdate
      .map((p) => ({ id: customerByPhone.get(p.phone)!.id, p }))
      .filter(({ id }) => !alreadyRegistered.has(id));

    if (backfill.length > 0) {
      await Promise.all([
        createManyChunked(backfill, (chunk) =>
          prisma.registration.createMany({
            data: chunk.map(({ id, p }) => ({
              customerId: id,
              customerIdExt: p.customerIdExt,
              onboardingDate: p.onboardingDate,
              rawData: p.raw as never,
            })),
            skipDuplicates: true,
          })
        ),
        createManyChunked(backfill, (chunk) =>
          prisma.activityLog.createMany({
            data: chunk.map(({ id }) => ({
              customerId: id,
              userId: ctx.userId,
              activityType: "REGISTRATION_IMPORTED" as const,
              note: "Registration record backfilled from Google Sheet (customer already existed)",
            })),
          })
        ),
      ]);
    }
  }

  const healedFollowups = await healMissingFollowups(ctx.userId, followupDays);

  return {
    totalRows: rows.length,
    newCount: toCreate.length,
    healedFollowups,
    updateCount: toUpdate.length,
    skipCount,
    errorCount: errors.length,
    autoAssignedCount: assign.autoAssignedCount,
    agentBreakdown: assign.breakdown(),
    errors,
  };
}
