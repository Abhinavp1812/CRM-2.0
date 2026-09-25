import { prisma } from "@/lib/prisma";
import { startOfTodayIST } from "@/lib/formatDate";
import { notOnLeaveWhere } from "@/lib/leave";

/**
 * Re-spread recent, still-untouched new registrations evenly across every
 * available agent. Only customers that are safe to move are considered: a new
 * registration (never booked), not DNC, with an active followup that nobody has
 * worked yet (no remark, never contacted), registered within the last N months.
 * Anything an agent has already touched stays exactly where it is.
 */

export interface AgentShare {
  agentId: string;
  name: string;
  current: number;
  target: number;
}

export interface Move {
  customerId: string;
  fromId: string;
  toId: string;
}

export interface RedistributionPlan {
  months: number;
  cutoff: Date;
  total: number;
  agents: AgentShare[];
  moves: Move[];
}

export async function planRecentRedistribution(months = 2): Promise<RedistributionPlan> {
  const cutoff = startOfTodayIST();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);

  const agents = await prisma.user.findMany({
    where: { role: "AGENT", deletedAt: null, isActive: true, ...notOnLeaveWhere() },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (agents.length < 2) return { months, cutoff, total: 0, agents: [], moves: [] };

  const pool = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      doNotContact: false,
      customerType: "NEW_REGISTRATION",
      ownerId: { in: agents.map((a) => a.id) },
      followup: { is: { currentRemark: null, lastContactedAt: null } },
      registrations: { some: { onboardingDate: { gte: cutoff } } },
    },
    select: { id: true, ownerId: true },
    orderBy: { id: "asc" },
  });

  const idsByOwner = new Map<string, string[]>(agents.map((a) => [a.id, []]));
  for (const c of pool) idsByOwner.get(c.ownerId!)!.push(c.id);

  const total = pool.length;
  const per = Math.floor(total / agents.length);
  let remainder = total - per * agents.length;

  // Extra leftovers go to whoever already holds the most, so fewer customers move.
  const byHolding = [...agents].sort((a, b) => idsByOwner.get(b.id)!.length - idsByOwner.get(a.id)!.length);
  const target = new Map<string, number>();
  for (const a of byHolding) {
    target.set(a.id, per + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }

  const shares: AgentShare[] = agents.map((a) => ({
    agentId: a.id,
    name: a.name,
    current: idsByOwner.get(a.id)!.length,
    target: target.get(a.id)!,
  }));

  const spare: { fromId: string; ids: string[] }[] = [];
  for (const s of shares) {
    const surplus = s.current - s.target;
    if (surplus > 0) spare.push({ fromId: s.agentId, ids: idsByOwner.get(s.agentId)!.slice(-surplus) });
  }

  const moves: Move[] = [];
  let si = 0;
  for (const s of shares) {
    let need = s.target - s.current;
    while (need > 0 && si < spare.length) {
      const src = spare[si];
      const take = src.ids.splice(0, need);
      for (const customerId of take) moves.push({ customerId, fromId: src.fromId, toId: s.agentId });
      need -= take.length;
      if (src.ids.length === 0) si++;
    }
  }

  return { months, cutoff, total, agents: shares, moves };
}

export async function executeRecentRedistribution(actingUserId: string | null, months = 2): Promise<{ moved: number }> {
  const plan = await planRecentRedistribution(months);
  if (plan.moves.length === 0) return { moved: 0 };

  const nameById = new Map(plan.agents.map((a) => [a.agentId, a.name]));
  const groups = new Map<string, Move[]>();
  for (const m of plan.moves) {
    const key = m.fromId + ">" + m.toId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  let moved = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const list of groups.values()) {
        const { fromId, toId } = list[0];
        for (let i = 0; i < list.length; i += 1000) {
          const chunk = list.slice(i, i + 1000);
          // Guard on ownerId so a customer reassigned since the preview is never overwritten.
          const res = await tx.customer.updateMany({
            where: { id: { in: chunk.map((m) => m.customerId) }, ownerId: fromId },
            data: { ownerId: toId },
          });
          moved += res.count;
          await tx.activityLog.createMany({
            data: chunk.map((m) => ({
              customerId: m.customerId,
              userId: actingUserId,
              activityType: "OWNER_CHANGED" as const,
              oldValue: nameById.get(fromId) ?? fromId,
              newValue: nameById.get(toId) ?? toId,
              note: "Recent untouched new leads re-spread evenly across agents",
            })),
          });
        }
      }
    },
    { timeout: 60000, maxWait: 10000 }
  );

  return { moved };
}
