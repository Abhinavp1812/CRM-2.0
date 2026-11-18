import type { JourneyKey, LeadFacts } from "@/lib/insights";
import { SEGMENTS, type SegmentKey } from "@/lib/segments";

/**
 * Insights 2.0 decision tree. Every node is the set of customers whose end state
 * (follow-up journey by default, or payment journey for the payments tree) is in `leaves`.
 */
export interface TreeNode<K extends string = JourneyKey> {
  key: string;
  title: string;
  help: string;
  tone: "root" | "neutral" | "good" | "bad" | "pipe";
  leaves: K[];
  children?: TreeNode<K>[];
}

export const TREE: TreeNode = {
  key: "all",
  title: "All customers",
  help: "Everyone in the CRM matching your filters.",
  tone: "root",
  leaves: ["nocall_booked", "nocall_never", "first_converted", "first_closed", "later_converted", "later_closed", "pipeline"],
  children: [
    {
      key: "called",
      title: "Called by our team",
      help: "The team logged at least one call or remark.",
      tone: "neutral",
      leaves: ["first_converted", "first_closed", "later_converted", "later_closed", "pipeline"],
      children: [
        {
          key: "first_converted",
          title: "Converted after 1st call",
          help: "Made a paid booking after our first call, before we needed to call again.",
          tone: "good",
          leaves: ["first_converted"],
        },
        {
          key: "first_closed",
          title: "Do not contact after 1st call",
          help: "Flagged Do Not Contact or closed (e.g. Not Interested) after a single call, without booking.",
          tone: "bad",
          leaves: ["first_closed"],
        },
        {
          key: "more",
          title: "Needed more follow-ups",
          help: "Didn't book after the first call, so they went into the pipeline.",
          tone: "pipe",
          leaves: ["later_converted", "later_closed", "pipeline"],
          children: [
            {
              key: "later_converted",
              title: "Converted later",
              help: "Made a paid booking after 2 or more follow-up calls.",
              tone: "good",
              leaves: ["later_converted"],
            },
            {
              key: "later_closed",
              title: "Do not contact later",
              help: "Flagged Do Not Contact or closed after several calls, without booking.",
              tone: "bad",
              leaves: ["later_closed"],
            },
            {
              key: "pipeline",
              title: "Still in pipeline",
              help: "Still being followed up - no booking and not closed yet.",
              tone: "pipe",
              leaves: ["pipeline"],
            },
          ],
        },
      ],
    },
    {
      key: "notcalled",
      title: "Not called yet",
      help: "Nobody from the team has logged a call or remark on them.",
      tone: "neutral",
      leaves: ["nocall_booked", "nocall_never"],
      children: [
        {
          key: "nocall_booked",
          title: "Booked without a call",
          help: "Have made paid bookings on their own - never called.",
          tone: "good",
          leaves: ["nocall_booked"],
        },
        {
          key: "nocall_never",
          title: "Waiting for first call",
          help: "Never booked and never called.",
          tone: "neutral",
          leaves: ["nocall_never"],
        },
      ],
    },
  ],
};

export function flattenTree(node: TreeNode = TREE, depth = 0, parent: TreeNode | null = null): { node: TreeNode; depth: number; parent: TreeNode | null }[] {
  return [{ node, depth, parent }, ...(node.children ?? []).flatMap((c) => flattenTree(c, depth + 1, node))];
}

/** Combined views that aren't boxes in the tree, used by the headline numbers. */
export const EXTRA_NODES: TreeNode[] = [
  {
    key: "converted",
    title: "Converted after our calls",
    help: "Made a paid booking on or after the day of our first call (after the 1st call or later).",
    tone: "good",
    leaves: ["first_converted", "later_converted"],
  },
  {
    key: "closed",
    title: "Do not contact",
    help: "Flagged Do Not Contact or closed without booking (after the 1st call or later).",
    tone: "bad",
    leaves: ["first_closed", "later_closed"],
  },
];

export const findNode = (key: string) =>
  flattenTree().find((x) => x.node.key === key)?.node ?? EXTRA_NODES.find((n) => n.key === key) ?? null;

export const CONVERTED: JourneyKey[] = ["first_converted", "later_converted"];
export const CLOSED: JourneyKey[] = ["first_closed", "later_closed"];
export const CALLED: JourneyKey[] = ["first_converted", "first_closed", "later_converted", "later_closed", "pipeline"];

export interface NodeStats {
  total: number;
  bySegment: Record<SegmentKey, number>;
}

/** Counts per tree node (and per category inside it) in one pass. */
export function treeStats(leads: LeadFacts[]): Map<string, NodeStats> {
  const perLeaf = new Map<JourneyKey, Record<SegmentKey, number>>();
  for (const l of leads) {
    const m = perLeaf.get(l.journey) ?? (Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>);
    m[l.segmentAtStart]++;
    perLeaf.set(l.journey, m);
  }
  const out = new Map<string, NodeStats>();
  for (const node of [...flattenTree().map((x) => x.node), ...EXTRA_NODES]) {
    const bySegment = Object.fromEntries(SEGMENTS.map((s) => [s.key, 0])) as Record<SegmentKey, number>;
    for (const leaf of node.leaves) {
      const m = perLeaf.get(leaf);
      if (m) for (const s of SEGMENTS) bySegment[s.key] += m[s.key];
    }
    out.set(node.key, { total: Object.values(bySegment).reduce((a, b) => a + b, 0), bySegment });
  }
  return out;
}

/** Per category (when first called): how many were called, converted, closed, still in pipeline. */
export function conversionByCategory(leads: LeadFacts[]) {
  return SEGMENTS.map((s) => {
    const ls = leads.filter((l) => l.segmentAtStart === s.key);
    const called = ls.filter((l) => CALLED.includes(l.journey));
    const firstCall = ls.filter((l) => l.journey === "first_converted").length;
    const later = ls.filter((l) => l.journey === "later_converted").length;
    return {
      key: s.key,
      total: ls.length,
      called: called.length,
      converted: firstCall + later,
      firstCall,
      later,
      closed: ls.filter((l) => CLOSED.includes(l.journey)).length,
      pipeline: ls.filter((l) => l.journey === "pipeline").length,
      notCalled: ls.length - called.length,
    };
  });
}

export function nodeList(leads: LeadFacts[], node: TreeNode, seg: SegmentKey | null): LeadFacts[] {
  return leads
    .filter((l) => node.leaves.includes(l.journey) && (!seg || l.segmentAtStart === seg))
    .sort(
      (a, b) =>
        (b.convertedAt?.getTime() ?? 0) - (a.convertedAt?.getTime() ?? 0) ||
        (b.firstContactAt?.getTime() ?? 0) - (a.firstContactAt?.getTime() ?? 0) ||
        b.joinedAt.getTime() - a.joinedAt.getTime()
    );
}
