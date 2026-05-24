import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { preview?: boolean; untouchedFirst?: boolean } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  const { preview = false, untouchedFirst = false } = body;

  const agents = await prisma.user.findMany({
    where: { role: "AGENT", deletedAt: null, onLeaveFrom: null },
    select: { id: true, name: true },
  });
  const agentIds = agents.map((a) => a.id);
  if (agentIds.length === 0) return NextResponse.json({ error: "No active agents" }, { status: 400 });

  const total = await prisma.customer.count({ where: { deletedAt: null } });
  const per = Math.floor(total / agentIds.length);
  let remainder = total - per * agentIds.length;

  const counts = await prisma.customer.groupBy({
    by: ["ownerId"],
    where: { ownerId: { in: agentIds }, deletedAt: null },
    _count: { _all: true },
  });
  const countBy: Record<string, number> = {};
  for (const r of counts) if (r.ownerId) countBy[r.ownerId] = r._count._all;

  const targets: Record<string, number> = {};
  for (const id of agentIds) {
    targets[id] = per + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }

  const surplusOwners = agentIds.filter((id) => (countBy[id] || 0) > targets[id]);
  const deficitOwners = agentIds.filter((id) => (countBy[id] || 0) < targets[id]);

  if (surplusOwners.length === 0 && deficitOwners.length === 0) {
    return NextResponse.json({ success: true, alreadyBalanced: true, plan: [], total });
  }

  // Build preview plan
  const agentNameById = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const plan = agentIds.map((id) => ({
    agentId: id,
    agentName: agentNameById[id],
    current: countBy[id] || 0,
    target: targets[id],
    delta: targets[id] - (countBy[id] || 0),
  }));

  if (preview) {
    return NextResponse.json({ success: true, plan, total });
  }

  // Execute balance
  await prisma.$transaction(async (tx) => {
    const surplus = surplusOwners.slice();
    const deficit = deficitOwners.slice();
    let sIdx = 0;

    for (let dIdx = 0; dIdx < deficit.length; dIdx++) {
      const dest = deficit[dIdx];
      let need = targets[dest] - (countBy[dest] || 0);

      while (need > 0 && sIdx < surplus.length) {
        const src = surplus[sIdx];
        const avail = (countBy[src] || 0) - targets[src];
        if (avail <= 0) { sIdx++; continue; }

        const take = Math.min(avail, need);

        // When untouchedFirst, prefer customers that have never been contacted
        let customers;
        if (untouchedFirst) {
          // First try never-contacted customers from this agent
          const untouched = await tx.customer.findMany({
            where: { ownerId: src, deletedAt: null, followup: { lastContactedAt: null } },
            select: { id: true },
            take,
          });
          if (untouched.length >= take) {
            customers = untouched;
          } else {
            // Top up with any remaining customers
            const rest = await tx.customer.findMany({
              where: { ownerId: src, deletedAt: null, id: { notIn: untouched.map((c) => c.id) } },
              select: { id: true },
              take: take - untouched.length,
            });
            customers = [...untouched, ...rest];
          }
        } else {
          customers = await tx.customer.findMany({
            where: { ownerId: src, deletedAt: null },
            select: { id: true },
            take,
          });
        }

        const ids = customers.map((c) => c.id);
        if (ids.length > 0) {
          await tx.customer.updateMany({ where: { id: { in: ids } }, data: { ownerId: dest } });
          countBy[src] = (countBy[src] || 0) - ids.length;
          countBy[dest] = (countBy[dest] || 0) + ids.length;
          need -= ids.length;
        } else {
          sIdx++;
        }

        if ((countBy[src] || 0) <= targets[src]) sIdx++;
      }
    }
  });

  return NextResponse.json({ success: true, plan });
}
