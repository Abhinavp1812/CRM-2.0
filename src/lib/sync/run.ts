import { prisma } from "@/lib/prisma";
import { fetchSheetRows, getServiceAccount, listSheetTabs } from "@/lib/googleSheets";
import { getSheetSource, type SyncType } from "./config";
import { importBookingRows } from "./bookings";
import { importRegistrationRows } from "./registrations";
import type { BookingsSyncResult, RegistrationsSyncResult, SourceRow } from "./types";

interface SyncMeta {
  source: string;
  startedAt: string;
  durationMs: number;
}

export type SyncResult =
  | ({ type: "registrations" } & SyncMeta & RegistrationsSyncResult)
  | ({ type: "bookings" } & SyncMeta & BookingsSyncResult);

export function isSyncType(v: unknown): v is SyncType {
  return v === "registrations" || v === "bookings";
}

/**
 * Pull every configured tab of a source sheet and load it into the CRM.
 * `userId` must be a real DB user (writes are attributed to it).
 */
export async function runSync(
  type: SyncType,
  userId: string,
  trigger: "manual" | "scheduled"
): Promise<SyncResult> {
  const startedAt = new Date();
  const src = getSheetSource(type);

  // Match configured tab names loosely (the sheet has e.g. "Jaipur " with a trailing space)
  const actualTabs = await listSheetTabs(src.spreadsheetId);
  const resolveTab = (wanted: string): string => {
    const key = wanted.trim().toLowerCase();
    const hit = actualTabs.find((t) => t.trim().toLowerCase() === key);
    if (!hit) {
      throw new Error(`Tab "${wanted}" not found in the sheet. Available tabs: ${actualTabs.map((t) => t.trim()).join(", ")}`);
    }
    return hit;
  };

  const rows: SourceRow[] = [];
  for (const wanted of src.tabs) {
    const tab = resolveTab(wanted);
    const table = await fetchSheetRows(src.spreadsheetId, tab);
    // Header is sheet row 1, so data rows are numbered from 2.
    table.rows.forEach((data, i) => rows.push({ sheet: tab, rowNum: i + 2, data }));
  }

  const source = `Google Sheet: ${src.tabs.join(", ")}`;
  const ctx = { userId };
  const meta = (): SyncMeta => ({
    source,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
  });

  if (type === "registrations") {
    const r = await importRegistrationRows(rows, ctx);
    await prisma.importHistory.create({
      data: {
        importType: "REGISTRATIONS",
        filename: source,
        uploadedById: userId,
        totalRows: r.totalRows,
        newCount: r.newCount,
        updatedCount: r.updateCount,
        skippedCount: r.skipCount,
        errorCount: r.errorCount,
        notes: `${trigger} sync; ${r.autoAssignedCount} auto-assigned`,
      },
    });
    return { type, ...meta(), ...r };
  }

  const r = await importBookingRows(rows, ctx);
  await prisma.importHistory.create({
    data: {
      importType: "BOOKINGS",
      filename: source,
      uploadedById: userId,
      totalRows: r.totalRows,
      newCount: r.newBookingCount,
      updatedCount: r.upgradedCustomerCount,
      skippedCount: r.skipCount + r.duplicateOrderCount,
      errorCount: r.errorCount,
      notes:
        `${trigger} sync; ${r.newCustomerCount} new customers, ${r.autoAssignedCount} auto-assigned; ` +
        `${r.followupsCreated} new followups, ${r.followupsUpdated} updated, ${r.followupsSkipped} kept (older booking)`,
    },
  });
  return { type, ...meta(), ...r };
}

/**
 * Resolve the DB user a sync is attributed to.
 * Super Admin is virtual (not in the DB), so fall back to the first real admin.
 */
export async function resolveSyncUserId(sessionUserId: string | null | undefined): Promise<string> {
  if (sessionUserId && sessionUserId !== "super-admin") return sessionUserId;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!admin) throw new Error("No admin user exists to attribute the sync to");
  return admin.id;
}

/** Non-secret summary of the sync setup for the admin UI. */
export function getSyncStatus() {
  const sa = getServiceAccount();
  return {
    configured: !!sa,
    serviceAccountEmail: sa?.client_email ?? null,
    scheduled: !!process.env.CRON_SECRET,
    registrations: getSheetSource("registrations"),
    bookings: getSheetSource("bookings"),
  };
}
