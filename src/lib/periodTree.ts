import { loadCallActivity, summarizeCalledCustomers, responseLabel, responseTone, type CalledCustomer } from "@/lib/callActivity";
import { NO_CAMPAIGN, NO_OWNER, type InsightFilters } from "@/lib/insights";
import type { NodeStats, TreeNode } from "@/lib/journeyTree";
import { SEGMENTS, type SegmentKey } from "@/lib/segments";
import { istDayRange, todayIsoIST } from "@/lib/formatDate";
import { oneParam, type SearchParamsRecord } from "@/lib/params";

/**
 * Insights 2.0 "calls in a date range" tree:
 *   Customers called in the range -> Booked after the call
 *                                 -> Not booked yet -> one box per latest remark (or "no remark")
 * Each customer counts once, in the category they were in on the day of their
 * first call in the range. Follows the page's campaign and agent filters.
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

export async function loadPeriodCustomers(fromStr: string, toStr: string, filters: InsightFilters): Promise<CalledCustomer[]> {
  const rows = await loadCallActivity({ start: istDayRange(fromStr).start, end: istDayRange(toStr).end });
  const campaigns = filters.campaign.length ? new Set(filters.campaign) : null;
  const owners = filters.owner.length ? new Set(filters.owner) : null;
  return (await summarizeCalledCustomers(rows)).filter(
    (c) => (!campaigns || campaigns.has(c.campaign?.trim() || NO_CAMPAIGN)) && (!owners || owners.has(c.ownerId ?? NO_OWNER))
  );
}

const emptySegs = () => Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>;

function stats(list: CalledCustomer[]): NodeStats {
  const bySegment = emptySegs();
  for (const c of list) bySegment[c.segment]++;
  return { total: list.length, bySegment };
}

export function periodSelect(customers: CalledCustomer[], key: string, seg: SegmentKey | null): CalledCustomer[] {
  return customers
    .filter((c) => (key === "all" ? true : key === "notbooked" ? c.response !== "booked" : c.response === key))
    .filter((c) => !seg || c.segment === seg)
    .sort((a, b) => (b.bookedOn?.getTime() ?? 0) - (a.bookedOn?.getTime() ?? 0) || b.lastAt.getTime() - a.lastAt.getTime());
}

export function periodTree(customers: CalledCustomer[], rangeText: string): { tree: TreeNode; stats: Map<string, NodeStats>; titleOf: (key: string) => string } {
  const notBooked = customers.filter((c) => c.response !== "booked");
  const responses = Array.from(new Set(notBooked.map((c) => c.response))).sort((a, b) =>
    a === "no_remark" ? 1 : b === "no_remark" ? -1 : notBooked.filter((c) => c.response === b).length - notBooked.filter((c) => c.response === a).length
  );
  const tree: TreeNode = {
    key: "all",
    title: "Customers called " + rangeText,
    help: "Customers the team called or left a remark on in this date range (each counted once).",
    tone: "root",
    leaves: [],
    children: [
      {
        key: "booked",
        title: "Booked after the call",
        help: "Made a paid booking (Success / Partially Paid) on or after the day of their first call in this range.",
        tone: "good",
        leaves: [],
      },
      {
        key: "notbooked",
        title: "Not booked yet",
        help: "No paid booking since the call. Split by their latest remark in this range.",
        tone: "neutral",
        leaves: [],
        children: responses.map((r) => ({
          key: r,
          title: responseLabel(r),
          help: r === "no_remark" ? "A call was logged but no remark was saved." : `Latest remark in this range: ${responseLabel(r)}.`,
          tone: responseTone(r),
          leaves: [],
        })),
      },
    ],
  };
  const m = new Map<string, NodeStats>();
  m.set("all", stats(customers));
  m.set("booked", stats(customers.filter((c) => c.response === "booked")));
  m.set("notbooked", stats(notBooked));
  for (const r of responses) m.set(r, stats(notBooked.filter((c) => c.response === r)));
  const titleOf = (key: string) =>
    key === "all" ? tree.title : key === "booked" ? "Booked after the call" : key === "notbooked" ? "Not booked yet" : responseLabel(key);
  return { tree, stats: m, titleOf };
}
