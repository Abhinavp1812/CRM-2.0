import { prisma } from "@/lib/prisma";
import { loadInsights } from "@/lib/insights";
import { buildNudgeLists } from "@/lib/nudgeLists";
import { getNudgeSettings } from "@/lib/whatsappNudges";
import { todayIsoIST } from "@/lib/formatDate";
import { NUDGED_STATUSES } from "@/lib/whatsappStatus";
import { oneParam, type SearchParamsRecord } from "@/lib/params";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from the URL: the re-engage date range (default today). */
export function parseNudgeListParams(sp: SearchParamsRecord) {
  const today = todayIsoIST();
  let from = oneParam(sp.from) ?? today;
  let to = oneParam(sp.to) ?? from;
  if (!ISO.test(from)) from = today;
  if (!ISO.test(to)) to = from;
  if (to < from) [from, to] = [to, from];
  return { from, to };
}

/**
 * Everything the Customer lists page / export needs. Uses the SAME excluded
 * salons and opt-outs as sending (Admin > WhatsApp > Settings), so a list is
 * exactly who can be messaged. WhatsApp tables are read defensively so the
 * lists still work before the database update.
 */
export async function loadNudgeListData(p: ReturnType<typeof parseNudgeListParams>) {
  const [{ leads }, settings, optOuts, lastNudges] = await Promise.all([
    loadInsights(),
    getNudgeSettings(),
    prisma.whatsAppOptOut.findMany({ select: { customerId: true } }).catch(() => [] as { customerId: string }[]),
    prisma.whatsAppMessage
      .groupBy({ by: ["customerId"], where: { isTest: false, status: { in: NUDGED_STATUSES }, customerId: { not: null } }, _max: { createdAt: true } })
      .catch(() => [] as { customerId: string | null; _max: { createdAt: Date | null } }[]),
  ]);
  const optedOut = new Set(optOuts.map((o) => o.customerId));
  const lastNudged = new Map(lastNudges.filter((r) => r.customerId && r._max.createdAt).map((r) => [r.customerId!, r._max.createdAt!]));
  const result = buildNudgeLists(leads, { optedOut, excludeSalons: settings.excludeSalons, reengageFrom: p.from, reengageTo: p.to });
  return { ...result, lastNudged, excludeSalons: settings.excludeSalons, cooldownDays: settings.cooldownDays };
}
