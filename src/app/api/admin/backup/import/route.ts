import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { restoreConfig, restoreCustomers, restoreLinkedTable } from "@/lib/backup/import";
import { BACKUP_VERSION, type LinkedTable } from "@/lib/backup/types";

export const maxDuration = 60;

const LINKED_TABLES: LinkedTable[] = ["followups", "activities", "registrations", "bookings"];

/**
 * Restores one phase of a backup at a time - the browser sends the parsed
 * backup file as a sequence of requests (config once, then customers in
 * batches, then each linked table in batches), so this never has to accept
 * one giant request no matter how large the backup is. See src/lib/backup
 * for the full restore semantics (overwrite-matching, nothing ever deleted).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const version = body.version;
  if (typeof version !== "number" || version > BACKUP_VERSION) {
    return NextResponse.json(
      { error: `Unsupported backup version. This app understands up to version ${BACKUP_VERSION}.` },
      { status: 400 }
    );
  }

  try {
    if (body.phase === "config") {
      const result = await restoreConfig(
        Array.isArray(body.remarkOptions) ? body.remarkOptions : [],
        Array.isArray(body.settings) ? body.settings : [],
        Array.isArray(body.salons) ? body.salons : []
      );
      return NextResponse.json({ success: true, ...result });
    }

    if (body.phase === "customers") {
      if (!Array.isArray(body.rows)) return NextResponse.json({ error: "Missing rows" }, { status: 400 });
      const result = await restoreCustomers(body.rows);
      return NextResponse.json({ success: true, ...result });
    }

    if (body.phase === "linked") {
      const table = body.table;
      if (typeof table !== "string" || !LINKED_TABLES.includes(table as LinkedTable)) {
        return NextResponse.json({ error: `Unknown table "${table}"` }, { status: 400 });
      }
      if (!Array.isArray(body.rows)) return NextResponse.json({ error: "Missing rows" }, { status: 400 });
      const result = await restoreLinkedTable(table as LinkedTable, body.rows);
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: `Unknown phase "${body.phase}"` }, { status: 400 });
  } catch (err) {
    console.error("[backup/import]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restore failed" },
      { status: 500 }
    );
  }
}
