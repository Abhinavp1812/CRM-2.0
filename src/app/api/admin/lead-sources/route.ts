import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [sources, counts] = await Promise.all([
    prisma.leadSourceOption.findMany({ orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }] }),
    prisma.customer.groupBy({ by: ["leadSource"], where: { deletedAt: null, leadSource: { not: null } }, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.leadSource, c._count._all]));
  return NextResponse.json({ sources: sources.map((s) => ({ ...s, customerCount: countBy.get(s.label) ?? 0 })) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const label = (body.label || "").trim();
  if (!label) return NextResponse.json({ error: "Label is required" }, { status: 400 });

  const existing = await prisma.leadSourceOption.findUnique({ where: { label } });
  if (existing) {
    if (existing.isActive) return NextResponse.json({ error: `"${label}" already exists` }, { status: 400 });
    // Re-adding a previously deactivated label just reactivates it.
    const revived = await prisma.leadSourceOption.update({ where: { id: existing.id }, data: { isActive: true } });
    return NextResponse.json({ success: true, source: revived });
  }

  const maxOrder = await prisma.leadSourceOption.aggregate({ _max: { sortOrder: true } });
  const created = await prisma.leadSourceOption.create({
    data: { label, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json({ success: true, source: created });
}
