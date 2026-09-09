import { NextResponse } from "next/server";
import { resolveSyncUserId, runSync, type SyncResult } from "@/lib/sync/run";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduled sync, invoked by Vercel Cron (see vercel.json).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; nothing else may call this.
 * Registrations run first so booking rows can promote them in the same pass.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  let ok = true;

  try {
    const userId = await resolveSyncUserId(null);
    for (const type of ["registrations", "bookings"] as const) {
      try {
        const r: SyncResult = await runSync(type, userId, "scheduled");
        // Keep the log small: drop per-row error payloads
        results[type] = { ...r, errors: undefined };
      } catch (err) {
        ok = false;
        results[type] = { error: err instanceof Error ? err.message : "Sync failed" };
        console.error(`[cron/sync] ${type}`, err);
      }
    }
  } catch (err) {
    ok = false;
    results.error = err instanceof Error ? err.message : "Sync failed";
    console.error("[cron/sync]", err);
  }

  return NextResponse.json({ ok, ranAt: new Date().toISOString(), ...results }, { status: ok ? 200 : 500 });
}
