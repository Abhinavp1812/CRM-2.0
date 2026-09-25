import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { planRecentRedistribution, executeRecentRedistribution } from "@/lib/redistribute";

export const maxDuration = 60;

function parseMonths(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 2;
}

/** Preview only - nothing is changed. */
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const months = parseMonths(new URL(req.url).searchParams.get("months"));
  const plan = await planRecentRedistribution(months);
  return NextResponse.json({
    months: plan.months,
    cutoff: plan.cutoff,
    total: plan.total,
    agents: plan.agents,
    moveCount: plan.moves.length,
  });
}

/** Re-runs the plan fresh and applies it. */
export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { months?: number } = {};
  try {
    body = await req.json();
  } catch {
    /* defaults */
  }

  let actingUserId: string | null = session.user.id === "super-admin" ? null : session.user.id;
  if (session.user.id === "super-admin") {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN", deletedAt: null }, select: { id: true } });
    actingUserId = admin?.id ?? null;
  }

  const { moved } = await executeRecentRedistribution(actingUserId, parseMonths(body.months));
  return NextResponse.json({ success: true, moved });
}
