import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isSyncType, resolveSyncUserId, runSync } from "@/lib/sync/run";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Manual "Sync now" from the admin Data Sync page. */
export async function POST(_req: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { type } = await params;
    if (!isSyncType(type)) {
      return NextResponse.json({ error: `Unknown sync type "${type}"` }, { status: 400 });
    }

    const userId = await resolveSyncUserId(session.user.id);
    const result = await runSync(type, userId, "manual");
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
