import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { dayThreshold, destinationId, roundRobin, preview } = await req.json();
  if (!dayThreshold || dayThreshold < 1) return NextResponse.json({ error: "Invalid dayThreshold" }, { status: 400 });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dayThreshold);
  cutoff.setHours(0, 0, 0, 0);

  // Neglected = followup date is overdue by threshold AND never contacted OR last contact is also past threshold
  const neglected = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      followup: {
        nextFollowupDate: { lt: cutoff },
        OR: [
          { lastContactedAt: null },
          { lastContactedAt: { lt: cutoff } },
        ],
      },
    },
    select: { id: true, owner: { select: { name: true } } },
  });

  if (preview) {
    return NextResponse.json({ count: neglected.length });
  }

  if (neglected.length === 0) return NextResponse.json({ success: true, reassigned: 0 });

  const ids = neglected.map((c) => c.id);

  if (destinationId) {
    const dest = await prisma.user.findUnique({ where: { id: destinationId } });
    if (!dest || dest.role !== "AGENT" || dest.deletedAt) {
      return NextResponse.json({ error: "Invalid destination agent" }, { status: 400 });
    }
    await prisma.customer.updateMany({ where: { id: { in: ids } }, data: { ownerId: destinationId } });
    return NextResponse.json({ success: true, reassigned: ids.length });
  }

  if (roundRobin) {
    const agents = await prisma.user.findMany({
      where: { role: "AGENT", deletedAt: null, onLeaveFrom: null },
      select: { id: true },
    });
    if (agents.length === 0) return NextResponse.json({ error: "No active agents" }, { status: 400 });

    const counts = await prisma.customer.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: agents.map((a) => a.id) }, deletedAt: null },
      _count: { _all: true },
    });
    const countBy: Record<string, number> = {};
    for (const r of counts) if (r.ownerId) countBy[r.ownerId] = r._count._all;
    const agentOrder = agents.map((a) => ({ id: a.id, count: countBy[a.id] || 0 }));
    const mapping: Record<string, string[]> = {};

    for (const cid of ids) {
      agentOrder.sort((a, b) => a.count - b.count);
      const dest = agentOrder[0];
      mapping[dest.id] = mapping[dest.id] || [];
      mapping[dest.id].push(cid);
      dest.count++;
    }
    for (const [destId, chunk] of Object.entries(mapping)) {
      await prisma.customer.updateMany({ where: { id: { in: chunk } }, data: { ownerId: destId } });
    }
    return NextResponse.json({ success: true, reassigned: ids.length });
  }

  return NextResponse.json({ error: "Provide destinationId or roundRobin: true" }, { status: 400 });
}
