import { prisma } from "@/lib/prisma";
import { istDayRange, todayIsoIST } from "@/lib/formatDate";
import { NO_CAMPAIGN } from "@/lib/insights";

/**
 * "Calls" as Team Stats counts them, shared so Team Stats and Insights 2.0
 * always show the same number for the same agent and dates:
 * every "Log call" click AND every remark saved is one call, counted for the
 * agent who did it (whoever owns the customer). Calling one customer twice
 * counts twice.
 */
export const CALL_ACTIVITY_TYPES = ["CALL_LOGGED", "REMARK_ADDED"] as const;

const DAY = 86_400_000;

/** Last 7 days INCLUDING today (today + the 6 days before), IST. */
export function last7Days(): { from: string; to: string; start: Date; end: Date } {
  const to = todayIsoIST();
  const from = new Date(Date.parse(to) - 6 * DAY).toISOString().slice(0, 10);
  return { from, to, start: istDayRange(from).start, end: istDayRange(to).end };
}

export interface AgentCalls {
  userId: string | null;
  name: string;
  /** Log-call clicks + remarks saved. */
  calls: number;
  logged: number;
  remarks: number;
  /** Different customers among those calls. */
  customers: number;
}

/** Calls per agent (who made them) between start and end. `campaigns` (optional) limits to customers of those campaigns. */
export async function callsByAgent(q: { start: Date; end: Date; campaigns?: string[] }): Promise<AgentCalls[]> {
  const campaigns = q.campaigns ?? [];
  const real = campaigns.filter((c) => c !== NO_CAMPAIGN);
  const where = {
    activityType: { in: [...CALL_ACTIVITY_TYPES] },
    createdAt: { gte: q.start, lt: q.end },
    ...(campaigns.length
      ? {
          customer: {
            OR: [
              ...(real.length ? [{ leadSource: { in: real } }] : []),
              ...(campaigns.includes(NO_CAMPAIGN) ? [{ leadSource: null }, { leadSource: "" }] : []),
            ],
          },
        }
      : {}),
  };
  const [byType, byCustomer] = await Promise.all([
    prisma.activityLog.groupBy({ by: ["userId", "activityType"], where, _count: { _all: true } }),
    prisma.activityLog.groupBy({ by: ["userId", "customerId"], where }),
  ]);
  const ids = Array.from(new Set(byType.map((r) => r.userId).filter((x): x is string => !!x)));
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name ?? "(no name)"]));

  const rows = new Map<string, AgentCalls>();
  const row = (userId: string | null) => {
    const k = userId ?? "";
    if (!rows.has(k)) rows.set(k, { userId, name: userId ? nameOf.get(userId) ?? "(deleted user)" : "Admin", calls: 0, logged: 0, remarks: 0, customers: 0 });
    return rows.get(k)!;
  };
  for (const r of byType) {
    const a = row(r.userId);
    a.calls += r._count._all;
    if (r.activityType === "CALL_LOGGED") a.logged += r._count._all;
    else a.remarks += r._count._all;
  }
  for (const r of byCustomer) row(r.userId).customers++;
  return Array.from(rows.values()).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}
