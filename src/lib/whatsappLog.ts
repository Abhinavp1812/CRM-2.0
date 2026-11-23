import { prisma } from "@/lib/prisma";
import { istDayRange, todayIsoIST } from "@/lib/formatDate";
import { listParam, oneParam, type SearchParamsRecord } from "@/lib/params";
import { GROUPS } from "@/lib/whatsappNudges";

/** Nudge log (every WhatsApp message the CRM sent or tried): filters shared by the page and its Excel export. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export const groupLabel = (key: string) => GROUPS.find((g) => g.key === key)?.label ?? key;

export function parseLogParams(sp: SearchParamsRecord) {
  const today = todayIsoIST();
  const monthAgo = new Date(Date.parse(today) - 29 * DAY).toISOString().slice(0, 10);
  let from = oneParam(sp.from) ?? monthAgo;
  let to = oneParam(sp.to) ?? today;
  if (!ISO.test(from)) from = monthAgo;
  if (!ISO.test(to)) to = today;
  if (to < from) [from, to] = [to, from];
  const status = oneParam(sp.status);
  const kind = oneParam(sp.kind);
  return {
    from,
    to,
    groups: listParam(sp.group),
    status: status === "SENT" || status === "FAILED" || status === "LISTED" ? status : null,
    /** "real" (default), "test", or "all". */
    kind: kind === "test" || kind === "all" ? kind : "real",
    q: (oneParam(sp.q) ?? "").trim(),
  };
}

export type LogParams = ReturnType<typeof parseLogParams>;

function where(p: LogParams) {
  const digits = p.q.replace(/\D/g, "");
  return {
    createdAt: { gte: istDayRange(p.from).start, lt: istDayRange(p.to).end },
    ...(p.groups.length ? { group: { in: p.groups } } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.kind === "real" ? { isTest: false } : p.kind === "test" ? { isTest: true } : {}),
    ...(p.q
      ? {
          OR: [
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            { customer: { name: { contains: p.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export async function loadLog(p: LogParams, page: number, pageSize: number) {
  const w = where(p);
  const [rows, total, byStatus, byGroup] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      where: w,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.whatsAppMessage.count({ where: w }),
    prisma.whatsAppMessage.groupBy({ by: ["status"], where: w, _count: { _all: true } }),
    prisma.whatsAppMessage.groupBy({ by: ["group"], where: w, _count: { _all: true } }),
  ]);
  const uniqueCustomers = await prisma.whatsAppMessage.findMany({ where: { ...w, customerId: { not: null } }, distinct: ["customerId"], select: { customerId: true } });
  return {
    rows,
    total,
    sent: byStatus.find((s) => s.status === "SENT")?._count._all ?? 0,
    failed: byStatus.find((s) => s.status === "FAILED")?._count._all ?? 0,
    listed: byStatus.find((s) => s.status === "LISTED")?._count._all ?? 0,
    customers: uniqueCustomers.length,
    byGroup: byGroup.map((g) => ({ key: g.group, label: groupLabel(g.group), count: g._count._all })).sort((a, b) => b.count - a.count),
  };
}

/** Every matching row, oldest first (for Excel), capped to keep the file reasonable. */
export function loadLogForExport(p: LogParams) {
  return prisma.whatsAppMessage.findMany({
    where: where(p),
    orderBy: { createdAt: "asc" },
    take: 50_000,
    include: { customer: { select: { name: true } } },
  });
}
