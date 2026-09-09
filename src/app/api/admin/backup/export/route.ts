import { gzipSync } from "zlib";
import { auth } from "@/auth";
import { buildBackup } from "@/lib/backup/export";

export const maxDuration = 60;

/**
 * Full-fidelity JSON backup of every customer-related table - the "just in
 * case" download meant to be restorable via Admin > Backup & Restore. This is
 * NOT the same as "Export All Data": that one is a human-readable report with
 * formatted dates and resolved names; this one preserves exact values so it
 * round-trips.
 *
 * The response is gzip-compressed. A browser downloading this URL directly
 * decompresses it automatically, so the saved file is plain readable JSON -
 * the compression only saves transfer time, nothing else to know about it.
 */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const backup = await buildBackup();
  const json = JSON.stringify(backup);
  const gzipped = gzipSync(Buffer.from(json, "utf-8"));
  const date = new Date().toISOString().split("T")[0];

  return new Response(gzipped as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "Content-Disposition": `attachment; filename="crm-backup-${date}.json"`,
    },
  });
}
