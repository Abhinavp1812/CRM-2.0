import { PAY_STATUSES, type LeadFacts, type PayJourneyKey, type PayStatusKey } from "@/lib/insights";
import type { NodeStats, TreeNode } from "@/lib/journeyTree";
import { SEGMENTS, type SegmentKey } from "@/lib/segments";

/**
 * Insights 2.0 payments tree: customers who placed at least one order, split by
 * whether a payment ever failed and whether they booked (Success / Partially Paid)
 * on or after the day of their first failed payment. Colours = category today.
 */
export const PAY_TREE: TreeNode<PayJourneyKey> = {
  key: "all",
  title: "Customers who placed an order",
  help: "Everyone with at least one order of any payment status (matching your filters).",
  tone: "root",
  leaves: ["paid_full", "paid_partial", "rec_success", "rec_partial", "lost_existing", "lost_never", "other_only"],
  children: [
    {
      key: "clean",
      title: "Paid, never had a failed payment",
      help: "Made paid bookings and none of their orders ever had a failed payment.",
      tone: "good",
      leaves: ["paid_full", "paid_partial"],
      children: [
        { key: "paid_full", title: "Always paid in full", help: "Every paid booking was Success.", tone: "good", leaves: ["paid_full"] },
        { key: "paid_partial", title: "Has partially-paid bookings", help: "At least one booking was Partially Paid.", tone: "pipe", leaves: ["paid_partial"] },
      ],
    },
    {
      key: "failed",
      title: "Had a failed payment",
      help: "At least one order's payment failed (cancelled / refunded orders don't count as failed).",
      tone: "bad",
      leaves: ["rec_success", "rec_partial", "lost_existing", "lost_never"],
      children: [
        {
          key: "recovered",
          title: "Booked after the failure",
          help: "Made a Success or Partially Paid booking on or after the day of their first failed payment.",
          tone: "good",
          leaves: ["rec_success", "rec_partial"],
          children: [
            { key: "rec_success", title: "Paid in full (Success)", help: "Their first booking after the failure was paid in full.", tone: "good", leaves: ["rec_success"] },
            { key: "rec_partial", title: "Partially paid", help: "Their first booking after the failure was Partially Paid.", tone: "pipe", leaves: ["rec_partial"] },
          ],
        },
        {
          key: "lost",
          title: "Didn't book after the failure",
          help: "No Success / Partially Paid booking since their first failed payment.",
          tone: "bad",
          leaves: ["lost_existing", "lost_never"],
          children: [
            { key: "lost_existing", title: "Had booked before", help: "Existing customers whose later payment failed and who haven't booked since.", tone: "bad", leaves: ["lost_existing"] },
            { key: "lost_never", title: "Never booked at all", help: "Their payment failed and they have never made a paid booking.", tone: "bad", leaves: ["lost_never"] },
          ],
        },
      ],
    },
    {
      key: "other_only",
      title: "Only pending / cancelled orders",
      help: "No paid booking and no failed payment - only pending, cancelled or refunded orders (including cancelled orders whose payment failed).",
      tone: "neutral",
      leaves: ["other_only"],
    },
  ],
};

function flatten(node: TreeNode<PayJourneyKey>): TreeNode<PayJourneyKey>[] {
  return [node, ...(node.children ?? []).flatMap(flatten)];
}
export const PAY_NODES = flatten(PAY_TREE);

const emptySegs = () => Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>;

/** Counts per box (split by category today) in one pass. */
export function payTreeStats(leads: LeadFacts[]): Map<string, NodeStats> {
  const perLeaf = new Map<PayJourneyKey, Record<SegmentKey, number>>();
  for (const l of leads) {
    if (l.payJourney === "none") continue;
    const m = perLeaf.get(l.payJourney) ?? emptySegs();
    m[l.segmentNow]++;
    perLeaf.set(l.payJourney, m);
  }
  const out = new Map<string, NodeStats>();
  for (const node of PAY_NODES) {
    const bySegment = emptySegs();
    for (const leaf of node.leaves) {
      const m = perLeaf.get(leaf);
      if (m) for (const s of SEGMENTS) bySegment[s.key] += m[s.key];
    }
    out.set(node.key, { total: Object.values(bySegment).reduce((a, b) => a + b, 0), bySegment });
  }
  return out;
}

/** Order-level comparison: orders, customers and amount per payment status. */
export function payStatusComparison(leads: LeadFacts[]) {
  return PAY_STATUSES.map((s) => {
    let orders = 0;
    let customers = 0;
    let amount = 0;
    for (const l of leads) {
      const st = l.orderStats[s.key];
      if (st.orders > 0) {
        orders += st.orders;
        customers++;
        amount += st.amount;
      }
    }
    return { key: s.key as PayStatusKey, label: s.label, bar: s.bar, orders, customers, amount };
  });
}

/** Recovery headline numbers. */
export function recoveryStats(leads: LeadFacts[]) {
  const failed = leads.filter((l) => l.firstFailedAt);
  const recovered = failed.filter((l) => l.bookedAfterFailAt);
  const lost = failed.filter((l) => !l.bookedAfterFailAt);
  const days = recovered
    .map((l) => Math.max(0, Math.round((l.bookedAfterFailAt!.getTime() - l.firstFailedAt!.getTime()) / 86_400_000)))
    .sort((a, b) => a - b);
  const median = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
  return {
    failed: failed.length,
    recovered: recovered.length,
    sameDay: days.filter((d) => d === 0).length,
    medianDays: median,
    lost: lost.length,
    lostNotCalled: lost.filter((l) => !l.calledAfterFail).length,
  };
}

/** Customers in a box ("status:<key>" = anyone with at least one order of that payment status), optionally one category. */
export function paySelect(leads: LeadFacts[], key: string, seg: SegmentKey | null): LeadFacts[] {
  let rows: LeadFacts[];
  if (key.startsWith("status:")) {
    const st = key.slice(7) as PayStatusKey;
    rows = leads.filter((l) => l.orderStats[st]?.orders > 0);
  } else if (key === "lost_notcalled") {
    rows = leads.filter((l) => l.firstFailedAt && !l.bookedAfterFailAt && !l.calledAfterFail);
  } else {
    const node = PAY_NODES.find((n) => n.key === key);
    if (!node) return [];
    rows = leads.filter((l) => node.leaves.includes(l.payJourney));
  }
  return rows
    .filter((l) => !seg || l.segmentNow === seg)
    .sort(
      (a, b) =>
        (b.firstFailedAt?.getTime() ?? 0) - (a.firstFailedAt?.getTime() ?? 0) ||
        (b.lastPaidAt?.getTime() ?? 0) - (a.lastPaidAt?.getTime() ?? 0) ||
        b.joinedAt.getTime() - a.joinedAt.getTime()
    );
}

export function payKeyTitle(key: string): string | null {
  if (key.startsWith("status:")) {
    const s = PAY_STATUSES.find((x) => x.key === key.slice(7));
    return s ? "Customers with a " + s.label + " order" : null;
  }
  if (key === "lost_notcalled") return "Payment failed, didn't book after, and nobody called them";
  return PAY_NODES.find((n) => n.key === key)?.title ?? null;
}
