import { randomUUID } from "crypto";
import type { ActivityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createManyChunked, findManyChunked } from "@/lib/dbBatch";
import type {
  BackupActivity,
  BackupBooking,
  BackupCustomer,
  BackupFollowup,
  BackupRegistration,
  BackupRemarkOption,
  BackupSalon,
  BackupSetting,
  LinkedTable,
  RestoreCounts,
} from "./types";

const CHUNK = 1500;

/**
 * Restoring a backup OVERWRITES matching rows (by phone for customers, orderNo
 * for bookings, customerId for followups) with whatever the file says - unlike
 * the Google Sheets sync, which only ever fills in blanks. That's deliberate:
 * the point of "restore" is bringing data back to a known-good state, which
 * has to be able to undo drift, not just add to it. Nothing is ever deleted -
 * rows not present in the file are left untouched. User accounts are never
 * touched: owner/actor references are matched by email against whichever
 * users already exist in this database.
 *
 * Every table links back to its customer by phone number (this app's real
 * identity for a customer everywhere else), not a raw id from the backup file
 * - so each phase below is fully independent and can be called as its own
 * request. That's what lets the client send a big backup as many small
 * requests instead of one huge one, sidestepping Vercel's request-size limit
 * regardless of how much data there is, and makes every phase safe to retry
 * on its own if it times out.
 */

function addWarning(warnings: string[], msg: string) {
  if (warnings.length < 50) warnings.push(msg);
  else if (warnings.length === 50) warnings.push("...additional warnings omitted");
}

async function userEmailMap(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  return new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
}

/** Phase 1: small, independent config tables. Safe to call once, up front. */
export async function restoreConfig(
  remarkOptions: BackupRemarkOption[],
  settings: BackupSetting[],
  salons: BackupSalon[]
): Promise<Pick<RestoreCounts, "remarkOptionsWritten" | "settingsWritten" | "salonsCreated" | "salonsUpdated">> {
  const counts = { remarkOptionsWritten: 0, settingsWritten: 0, salonsCreated: 0, salonsUpdated: 0 };

  const existingRemarks = await prisma.remarkOption.findMany({ select: { id: true, label: true } });
  const remarkIdByLabel = new Map(existingRemarks.map((r) => [r.label, r.id]));
  for (const r of remarkOptions) {
    const existingId = remarkIdByLabel.get(r.label);
    const data = {
      color: r.color, sortOrder: r.sortOrder, isActive: r.isActive,
      defaultDaysAhead: r.defaultDaysAhead, autoFlagDnc: r.autoFlagDnc, closesFollowup: r.closesFollowup,
    };
    if (existingId) await prisma.remarkOption.update({ where: { id: existingId }, data });
    else await prisma.remarkOption.create({ data: { label: r.label, ...data } });
    counts.remarkOptionsWritten++;
  }

  for (const s of settings) {
    await prisma.setting.upsert({ where: { key: s.key }, update: { value: s.value }, create: { key: s.key, value: s.value } });
    counts.settingsWritten++;
  }

  const existingSalons = await prisma.salon.findMany({ select: { id: true, externalId: true } });
  const salonIdByExtId = new Map(existingSalons.filter((s) => s.externalId).map((s) => [s.externalId!, s.id]));
  for (let i = 0; i < salons.length; i += 25) {
    const batch = salons.slice(i, i + 25);
    await Promise.all(batch.map(async (s) => {
      const existingId = s.externalId ? salonIdByExtId.get(s.externalId) : undefined;
      const data = { name: s.name, phone: s.phone, address: s.address, city: s.city, state: s.state };
      if (existingId) {
        await prisma.salon.update({ where: { id: existingId }, data });
        counts.salonsUpdated++;
      } else {
        await prisma.salon.create({ data: { externalId: s.externalId, ...data, createdAt: new Date(s.createdAt) } });
        counts.salonsCreated++;
      }
    }));
  }

  return counts;
}

/** Phase 2: customers, in whatever batches the caller sends. Call before any linked-table phase. */
export async function restoreCustomers(
  rows: BackupCustomer[]
): Promise<Pick<RestoreCounts, "customersCreated" | "customersUpdated" | "customersSkipped" | "warnings">> {
  const warnings: string[] = [];
  let customersSkipped = 0;

  const validRows = rows.filter((c) => {
    if (!c.phone) { addWarning(warnings, "Skipped a customer with no phone number"); customersSkipped++; return false; }
    return true;
  });
  if (validRows.length === 0) return { customersCreated: 0, customersUpdated: 0, customersSkipped, warnings };

  const emailToId = await userEmailMap();
  const resolveUser = (email: string | null) => (email ? emailToId.get(email.toLowerCase()) ?? null : null);

  const phonesBefore = new Set(
    (await findManyChunked(
      validRows.map((c) => c.phone),
      (chunk) => prisma.customer.findMany({ where: { phone: { in: chunk } }, select: { phone: true } })
    )).map((c) => c.phone)
  );

  const insertRows = validRows.map((c) => {
    const ownerId = resolveUser(c.ownerEmail);
    if (c.ownerEmail && !ownerId) addWarning(warnings, `Owner "${c.ownerEmail}" not found for ${c.phone} - left unassigned`);
    return {
      id: randomUUID(), phone: c.phone, name: c.name, gender: c.gender, address: c.address, city: c.city, sector: c.sector,
      customerIdExt: c.customerIdExt, customerType: c.customerType, ownerId,
      pendingOwnerName: c.pendingOwnerName,
      doNotContact: c.doNotContact, doNotContactReason: c.doNotContactReason,
      doNotContactSetAt: c.doNotContactSetAt, doNotContactSetBy: resolveUser(c.doNotContactSetByEmail),
      firstSeenAt: c.firstSeenAt, createdAt: c.createdAt, deletedAt: c.deletedAt,
    };
  });

  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const chunk = insertRows.slice(i, i + CHUNK);
    await prisma.$executeRaw`
      INSERT INTO "Customer"
        (id, phone, name, gender, address, city, sector, "customerIdExt", "customerType", "ownerId", "pendingOwnerName",
         "doNotContact", "doNotContactReason", "doNotContactSetAt", "doNotContactSetBy",
         "firstSeenAt", "createdAt", "updatedAt", "deletedAt")
      SELECT
        v->>'id', v->>'phone', v->>'name', v->>'gender', v->>'address', v->>'city', v->>'sector',
        v->>'customerIdExt', (v->>'customerType')::"CustomerType", v->>'ownerId', v->>'pendingOwnerName',
        COALESCE((v->>'doNotContact')::boolean, false), v->>'doNotContactReason',
        (v->>'doNotContactSetAt')::timestamptz, v->>'doNotContactSetBy',
        COALESCE((v->>'firstSeenAt')::timestamptz, NOW()), COALESCE((v->>'createdAt')::timestamptz, NOW()), NOW(),
        (v->>'deletedAt')::timestamptz
      FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
      ON CONFLICT (phone) DO UPDATE SET
        name = EXCLUDED.name, gender = EXCLUDED.gender, address = EXCLUDED.address, city = EXCLUDED.city, sector = EXCLUDED.sector,
        "customerIdExt" = EXCLUDED."customerIdExt", "customerType" = EXCLUDED."customerType", "ownerId" = EXCLUDED."ownerId",
        "pendingOwnerName" = EXCLUDED."pendingOwnerName",
        "doNotContact" = EXCLUDED."doNotContact", "doNotContactReason" = EXCLUDED."doNotContactReason",
        "doNotContactSetAt" = EXCLUDED."doNotContactSetAt", "doNotContactSetBy" = EXCLUDED."doNotContactSetBy",
        "deletedAt" = EXCLUDED."deletedAt", "updatedAt" = NOW()
    `;
  }

  let customersCreated = 0, customersUpdated = 0;
  for (const c of validRows) {
    if (phonesBefore.has(c.phone)) customersUpdated++;
    else customersCreated++;
  }

  return { customersCreated, customersUpdated, customersSkipped, warnings };
}

/** Resolve a batch's customerPhone list to real ids, once, for whichever linked-table phase is running. */
async function resolvePhones(phones: string[]): Promise<Map<string, string>> {
  const rows = await findManyChunked(
    Array.from(new Set(phones)),
    (chunk) => prisma.customer.findMany({ where: { phone: { in: chunk } }, select: { id: true, phone: true } })
  );
  return new Map(rows.map((c) => [c.phone, c.id]));
}

/** Phase 3: one linked table's worth of rows. Call only after all customer batches have completed. */
export async function restoreLinkedTable(
  table: LinkedTable,
  rows: BackupFollowup[] | BackupActivity[] | BackupRegistration[] | BackupBooking[]
): Promise<Partial<RestoreCounts>> {
  if (rows.length === 0) return {};

  const phones = rows.map((r) => (r as { customerPhone: string }).customerPhone);
  const [idByPhone, salons] = await Promise.all([
    resolvePhones(phones),
    table === "bookings" ? prisma.salon.findMany({ select: { id: true, externalId: true } }) : Promise.resolve([]),
  ]);
  const salonIdByExtId = new Map(salons.filter((s) => s.externalId).map((s) => [s.externalId!, s.id]));

  if (table === "followups") {
    const warnings: string[] = [];
    const emailToId = await userEmailMap();
    const resolveUser = (email: string | null) => (email ? emailToId.get(email.toLowerCase()) ?? null : null);
    let followupsSkipped = 0;

    const insertRows = (rows as BackupFollowup[])
      .map((f) => {
        const customerId = idByPhone.get(f.customerPhone);
        if (!customerId) { followupsSkipped++; return null; }
        return {
          id: randomUUID(), customerId,
          nextFollowupDate: f.nextFollowupDate, currentRemark: f.currentRemark, currentNote: f.currentNote,
          lastContactedAt: f.lastContactedAt,
          lastContactedById: resolveUser(f.lastContactedByEmail), updatedById: resolveUser(f.updatedByEmail),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    for (let i = 0; i < insertRows.length; i += CHUNK) {
      const chunk = insertRows.slice(i, i + CHUNK);
      await prisma.$executeRaw`
        INSERT INTO "Followup"
          (id, "customerId", "nextFollowupDate", "currentRemark", "currentNote", "lastContactedAt", "lastContactedById", "updatedAt", "updatedById")
        SELECT
          v->>'id', v->>'customerId', (v->>'nextFollowupDate')::timestamptz, v->>'currentRemark', v->>'currentNote',
          (v->>'lastContactedAt')::timestamptz, v->>'lastContactedById', NOW(), v->>'updatedById'
        FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
        ON CONFLICT ("customerId") DO UPDATE SET
          "nextFollowupDate" = EXCLUDED."nextFollowupDate",
          "currentRemark" = EXCLUDED."currentRemark",
          "currentNote" = EXCLUDED."currentNote",
          "lastContactedAt" = EXCLUDED."lastContactedAt",
          "lastContactedById" = EXCLUDED."lastContactedById",
          "updatedAt" = NOW(),
          "updatedById" = EXCLUDED."updatedById"
      `;
    }
    return { followupsWritten: insertRows.length, followupsSkipped, warnings };
  }

  if (table === "activities") {
    let activitiesSkipped = 0;
    const emailToId = await userEmailMap();
    const resolveUser = (email: string | null) => (email ? emailToId.get(email.toLowerCase()) ?? null : null);

    const insertRows = (rows as BackupActivity[])
      .map((a) => {
        const customerId = idByPhone.get(a.customerPhone);
        if (!customerId) { activitiesSkipped++; return null; }
        return {
          id: a.id, customerId, userId: resolveUser(a.userEmail),
          activityType: a.activityType as ActivityType,
          remark: a.remark, note: a.note, oldValue: a.oldValue, newValue: a.newValue,
          createdAt: new Date(a.createdAt),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await createManyChunked(insertRows, (chunk) => prisma.activityLog.createMany({ data: chunk, skipDuplicates: true }));
    return { activitiesWritten: insertRows.length, activitiesSkipped };
  }

  if (table === "registrations") {
    let registrationsSkipped = 0;
    const insertRows = (rows as BackupRegistration[])
      .map((r) => {
        const customerId = idByPhone.get(r.customerPhone);
        if (!customerId) { registrationsSkipped++; return null; }
        return {
          id: r.id, customerId, customerIdExt: r.customerIdExt,
          onboardingDate: r.onboardingDate ? new Date(r.onboardingDate) : null,
          rawData: r.rawData as never,
          createdAt: new Date(r.createdAt),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await createManyChunked(insertRows, (chunk) => prisma.registration.createMany({ data: chunk, skipDuplicates: true }));
    return { registrationsWritten: insertRows.length, registrationsSkipped };
  }

  // bookings
  let bookingsSkipped = 0;
  const insertRows = (rows as BackupBooking[])
    .map((b) => {
      const customerId = idByPhone.get(b.customerPhone);
      if (!customerId) { bookingsSkipped++; return null; }
      return {
        id: b.id, customerId,
        salonId: b.salonExternalId ? salonIdByExtId.get(b.salonExternalId) ?? null : null,
        orderNo: b.orderNo, aiCallingStatus: b.aiCallingStatus,
        orderDate: b.orderDate, bookingDate: b.bookingDate, bookingTime: b.bookingTime,
        status: b.status, paymentStatus: b.paymentStatus,
        salonNameSnapshot: b.salonNameSnapshot, city: b.city, state: b.state, address: b.address,
        gst: b.gst, grossAmount: b.grossAmount, stylistDiscount: b.stylistDiscount, slotsDiscount: b.slotsDiscount,
        couponsDiscount: b.couponsDiscount, offersDiscount: b.offersDiscount, hygieneFee: b.hygieneFee,
        platformFee: b.platformFee, grandTotal: b.grandTotal, tokenAmount: b.tokenAmount, remainingAmount: b.remainingAmount,
        gatewayOrderId: b.gatewayOrderId, styleLoungeCoupon: b.styleLoungeCoupon, salonCoupon: b.salonCoupon,
        styleLoungeUser: b.styleLoungeUser, rawData: b.rawData, createdAt: b.createdAt,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Bookings without an Order No. never conflict with each other (SQL NULL never equals
  // NULL for uniqueness), so those always insert fresh - matches how the sync treats them.
  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const chunk = insertRows.slice(i, i + CHUNK);
    await prisma.$executeRaw`
      INSERT INTO "Booking"
        (id, "customerId", "orderNo", "aiCallingStatus", "orderDate", "bookingDate", "bookingTime", status, "paymentStatus",
         "salonId", "salonNameSnapshot", city, state, address, gst, "grossAmount", "stylistDiscount", "slotsDiscount",
         "couponsDiscount", "offersDiscount", "hygieneFee", "platformFee", "grandTotal", "tokenAmount", "remainingAmount",
         "gatewayOrderId", "styleLoungeCoupon", "salonCoupon", "styleLoungeUser", "rawData", "createdAt")
      SELECT
        v->>'id', v->>'customerId', v->>'orderNo', v->>'aiCallingStatus',
        (v->>'orderDate')::timestamptz, (v->>'bookingDate')::timestamptz, v->>'bookingTime', v->>'status', v->>'paymentStatus',
        v->>'salonId', v->>'salonNameSnapshot', v->>'city', v->>'state', v->>'address',
        (v->>'gst')::numeric, (v->>'grossAmount')::numeric, (v->>'stylistDiscount')::numeric, (v->>'slotsDiscount')::numeric,
        (v->>'couponsDiscount')::numeric, (v->>'offersDiscount')::numeric, (v->>'hygieneFee')::numeric, (v->>'platformFee')::numeric,
        (v->>'grandTotal')::numeric, (v->>'tokenAmount')::numeric, (v->>'remainingAmount')::numeric,
        v->>'gatewayOrderId', v->>'styleLoungeCoupon', v->>'salonCoupon', v->>'styleLoungeUser',
        (v->'rawData')::jsonb, (v->>'createdAt')::timestamptz
      FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
      ON CONFLICT ("orderNo") DO UPDATE SET
        "customerId" = EXCLUDED."customerId", "aiCallingStatus" = EXCLUDED."aiCallingStatus",
        "orderDate" = EXCLUDED."orderDate", "bookingDate" = EXCLUDED."bookingDate", "bookingTime" = EXCLUDED."bookingTime",
        status = EXCLUDED.status, "paymentStatus" = EXCLUDED."paymentStatus", "salonId" = EXCLUDED."salonId",
        "salonNameSnapshot" = EXCLUDED."salonNameSnapshot", city = EXCLUDED.city, state = EXCLUDED.state, address = EXCLUDED.address,
        gst = EXCLUDED.gst, "grossAmount" = EXCLUDED."grossAmount", "stylistDiscount" = EXCLUDED."stylistDiscount",
        "slotsDiscount" = EXCLUDED."slotsDiscount", "couponsDiscount" = EXCLUDED."couponsDiscount", "offersDiscount" = EXCLUDED."offersDiscount",
        "hygieneFee" = EXCLUDED."hygieneFee", "platformFee" = EXCLUDED."platformFee", "grandTotal" = EXCLUDED."grandTotal",
        "tokenAmount" = EXCLUDED."tokenAmount", "remainingAmount" = EXCLUDED."remainingAmount",
        "gatewayOrderId" = EXCLUDED."gatewayOrderId", "styleLoungeCoupon" = EXCLUDED."styleLoungeCoupon",
        "salonCoupon" = EXCLUDED."salonCoupon", "styleLoungeUser" = EXCLUDED."styleLoungeUser", "rawData" = EXCLUDED."rawData"
    `;
  }
  return { bookingsWritten: insertRows.length, bookingsSkipped };
}
