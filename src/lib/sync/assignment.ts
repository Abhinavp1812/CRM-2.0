import { prisma } from "@/lib/prisma";
import type { AgentBreakdown } from "./types";

export interface OwnerPick {
  ownerId: string;
  autoAssigned: boolean;
  /** Owner name from the sheet that matched no agent; stored so a later-created agent picks the customer up. */
  pendingOwnerName: string | null;
  warning: string | null;
}

/**
 * Owner assignment shared by every sync.
 *
 * - Existing customers always keep their owner (sticky ownership); callers
 *   never ask this helper for a customer that already exists.
 * - New customers go to the active, non-leave agent with the fewest customers,
 *   so repeated small syncs stay balanced across the team.
 * - With no agents available, customers are parked with the admin.
 */
export async function loadAssignment() {
  const [users, activeAgents] = await Promise.all([
    prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, role: true },
    }),
    prisma.user.findMany({
      where: { role: "AGENT", deletedAt: null, isActive: true, onLeaveFrom: null },
      select: { id: true, name: true },
    }),
  ]);

  const adminUser = users.find((u) => u.role === "ADMIN");
  if (!adminUser) throw new Error("No admin user exists to park unassigned customers with");

  const userByName = new Map<string, string>();
  for (const u of users) userByName.set(u.name.toLowerCase().trim(), u.id);

  const counts = new Map<string, number>();
  if (activeAgents.length > 0) {
    const grouped = await prisma.customer.groupBy({
      by: ["ownerId"],
      where: { deletedAt: null, ownerId: { in: activeAgents.map((a) => a.id) } },
      _count: { _all: true },
    });
    for (const a of activeAgents) counts.set(a.id, 0);
    for (const g of grouped) if (g.ownerId) counts.set(g.ownerId, g._count._all);
  }

  const autoAssignedByAgent = new Map<string, number>();
  let autoAssignedCount = 0;

  function nextAgent(): string | null {
    let minId: string | null = null;
    let min = Infinity;
    for (const [id, c] of counts) {
      if (c < min) { min = c; minId = id; }
    }
    if (!minId) return null;
    counts.set(minId, min + 1);
    autoAssignedByAgent.set(minId, (autoAssignedByAgent.get(minId) ?? 0) + 1);
    autoAssignedCount++;
    return minId;
  }

  /**
   * Pick an owner for a brand-new customer.
   * `ownerRaw` is an optional owner name from the sheet (rarely present).
   */
  function pickOwner(ownerRaw: string): OwnerPick {
    if (ownerRaw) {
      const matched = userByName.get(ownerRaw.toLowerCase().trim());
      if (matched) return { ownerId: matched, autoAssigned: false, pendingOwnerName: null, warning: null };
      // Named agent does not exist yet: park with someone now and remember the name, so the
      // customer moves automatically when that agent is created (handled by the team API).
      const rr = nextAgent();
      if (rr) {
        return {
          ownerId: rr, autoAssigned: true, pendingOwnerName: ownerRaw,
          warning: `Owner "${ownerRaw}" not found - parked temporarily, will auto-assign when agent is created`,
        };
      }
      return {
        ownerId: adminUser!.id, autoAssigned: false, pendingOwnerName: ownerRaw,
        warning: `Owner "${ownerRaw}" not found and no active agents - parked with admin, will auto-assign when agent is created`,
      };
    }
    const rr = nextAgent();
    if (rr) return { ownerId: rr, autoAssigned: true, pendingOwnerName: null, warning: null };
    return { ownerId: adminUser!.id, autoAssigned: false, pendingOwnerName: null, warning: null };
  }

  function breakdown(): AgentBreakdown[] {
    return Array.from(autoAssignedByAgent.entries())
      .map(([agentId, count]) => ({
        agentId,
        agentName: activeAgents.find((a) => a.id === agentId)?.name ?? "Unknown",
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }

  return {
    adminUser,
    pickOwner,
    breakdown,
    get autoAssignedCount() { return autoAssignedCount; },
  };
}
