import { loadCallActivity, paidVisitDays, responseLabel, responseTone, type ActivityRow } from "@/lib/callActivity";
import { NO_CAMPAIGN, type InsightFilters } from "@/lib/insights";
import type { NodeStats, TreeNode } from "@/lib/journeyTree";
import { SEGMENTS, type SegmentKey } from "@/lib/segments";
import { istDayRange, todayIsoIST } from "@/lib/formatDate";
import { oneParam, type SearchParamsRecord } from "@/lib/params";

/**
 * Insights 2.0 "calls in a date range" tree - EVERY call counts (calling a
 * customer twice = 2), exactly like Team Stats "Calls (7d)":
 *   Calls in the range -> one box per agent (who made the call)
 *                      -> Booked after the call / one box per remark saved
 * A call = a remark saved (lib/callCounts.ts). Each call is coloured by the
 * customer's category on the day of that call. Follows the page's campaign
 * filter; the agent here is who CALLED (not who owns the customer).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

export function periodRange(raw: SearchParamsRecord) {
  const today = todayIsoIST();
  const fallbackFrom = new Date(Date.parse(today) - 6 * DAY).toISOString().slice(0, 10);
  let fromStr = oneParam(raw.cfrom) ?? fallbackFrom;
  let toStr = oneParam(raw.cto) ?? today;
  if (!ISO.test(fromStr)) fromStr = fallbackFrom;
  if (!ISO.test(toStr)) toStr = today;
  if (toStr < fromStr) [fromStr, toStr] = [toStr, fromStr];
  return { fromStr, toStr };
}

export interface CallEntry extends ActivityRow {
  /** First paid visit on or after the day of this call (up to today). */
  bookedOn: Date | null;
  /** "booked", "remark:<label>" or "no_remark". */
  response: string;
  /** Tree key of the agent box. */
  agentKey: string;
}

const agentKeyOf = (calledById: string | null) => "a:" + (calledById ?? "admin");

export async function loadPeriodCalls(fromStr: string, toStr: string, filters: InsightFilters): Promise<CallEntry[]> {
  const rows = await loadCallActivity({ start: istDayRange(fromStr).start, end: istDayRange(toStr).end, kinds: ["REMARK_ADDED"] });
  const campaigns = filters.campaign.length ? new Set(filters.campaign) : null;
  const kept = rows.filter((r) => !campaigns || campaigns.has(r.campaign?.trim() || NO_CAMPAIGN));
  const visits = await paidVisitDays(Array.from(new Set(kept.map((r) => r.customerId))));
  return kept.map((r) => withOutcome(r, visits.get(r.customerId) ?? []));
}

const IST_OFFSET = 330 * 60_000;
const dayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);

/** Pure: what happened after one call. `visitDays` = the customer's paid visit days (YYYY-MM-DD). */
export function withOutcome(r: ActivityRow, visitDays: string[]): CallEntry {
  const day = dayKey(r.at);
  const booked = visitDays.find((d) => d >= day);
  return {
    ...r,
    bookedOn: booked ? new Date(Date.parse(booked)) : null,
    response: booked ? "booked" : r.remark ? "remark:" + r.remark : "no_remark",
    agentKey: agentKeyOf(r.calledById),
  };
}

const emptySegs = () => Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>;

function stats(list: CallEntry[]): NodeStats {
  const bySegment = emptySegs();
  for (const c of list) bySegment[c.segment]++;
  return { total: list.length, bySegment };
}

const matches = (c: CallEntry, key: string) => key === "all" || c.agentKey === key || c.agentKey + "|" + c.response === key;

export function periodSelect(calls: CallEntry[], key: string, seg: SegmentKey | null): CallEntry[] {
  return calls.filter((c) => matches(c, key) && (!seg || c.segment === seg)).sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** Calls per agent (who called), most first - the same numbers as the agent boxes. */
export function agentSummary(calls: CallEntry[]) {
  const m = new Map<string, { key: string; name: string; calls: number; customers: Set<string>; booked: number }>();
  for (const c of calls) {
    const a = m.get(c.agentKey) ?? { key: c.agentKey, name: c.calledBy, calls: 0, customers: new Set<string>(), booked: 0 };
    a.calls++;
    a.customers.add(c.customerId);
    if (c.response === "booked") a.booked++;
    m.set(c.agentKey, a);
  }
  return Array.from(m.values())
    .map((a) => ({ key: a.key, name: a.name, calls: a.calls, customers: a.customers.size, booked: a.booked }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

export function periodTree(calls: CallEntry[], rangeText: string): { tree: TreeNode; stats: Map<string, NodeStats>; titleOf: (key: string) => string } {
  const m = new Map<string, NodeStats>();
  const titles = new Map<string, string>();
  const rootTitle = "Calls " + rangeText;
  m.set("all", stats(calls));
  titles.set("all", rootTitle);

  const agents = agentSummary(calls).map((a) => {
    const mine = calls.filter((c) => c.agentKey === a.key);
    const responses = Array.from(new Set(mine.map((c) => c.response))).sort((x, y) =>
      x === "booked" ? -1 : y === "booked" ? 1 : x === "no_remark" ? 1 : y === "no_remark" ? -1 : mine.filter((c) => c.response === y).length - mine.filter((c) => c.response === x).length
    );
    m.set(a.key, stats(mine));
    titles.set(a.key, a.name);
    const children: TreeNode[] = responses.map((r) => {
      const key = a.key + "|" + r;
      m.set(key, stats(mine.filter((c) => c.response === r)));
      titles.set(key, `${a.name} - ${responseLabel(r)}`);
      return {
        key,
        title: responseLabel(r),
        help:
          r === "booked"
            ? "The customer made a paid booking (Success / Partially Paid) on or after the day of this call."
            : `Remark saved on the call: ${responseLabel(r)} (no paid booking since).`,
        tone: responseTone(r),
        leaves: [],
      };
    });
    const node: TreeNode = {
      key: a.key,
      title: a.name,
      help: `Calls made by ${a.name} (remarks saved), whoever owns the customer. Same number as Team Stats.`,
      tone: "neutral",
      leaves: [],
      children,
    };
    return node;
  });

  const tree: TreeNode = {
    key: "all",
    title: rootTitle,
    help: "Every call in this date range: each remark saved = 1 call, so calling a customer twice counts twice. Same count as Team Stats.",
    tone: "root",
    leaves: [],
    children: agents,
  };
  return { tree, stats: m, titleOf: (key: string) => titles.get(key) ?? key };
}
