import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findResurrectedFollowups, repairResurrectedFollowups } from "@/lib/sync/heal";

export const maxDuration = 60;

/** Preview only - lists what would be deleted, without touching anything. */
export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const affected = await findResurrectedFollowups();
  return NextResponse.json({
    count: affected.length,
    examples: affected.slice(0, 10).map((a) => ({
      name: a.customerName,
      phone: a.phone,
      lastRemark: a.lastRemark,
      remarkAt: a.remarkAt,
      resurrectedAt: a.resurrectedAt,
    })),
  });
}

/** Deletes the confirmed set, restoring each customer's correct closed state. */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const deletedCount = await repairResurrectedFollowups();
  return NextResponse.json({ success: true, deletedCount });
}
