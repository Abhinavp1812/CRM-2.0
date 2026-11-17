/**
 * Customer categories, by number of paid visits (a visit = one paid booking day;
 * several orders on the same day count once):
 *   Registered only 0 · One-time 1 · Repeat 2-4 · Frequent 5+
 * Shared by the Followups dashboard and Insights 2.0 so both always agree.
 */

export const SEGMENTS = [
  {
    key: "registered",
    label: "Registered only",
    short: "Registered",
    help: "No paid booking yet",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    card: "border-slate-300 bg-slate-50 text-slate-700",
    ring: "ring-slate-400",
  },
  {
    key: "one",
    label: "One-time",
    short: "One-time",
    help: "1 paid visit",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
    badge: "bg-sky-50 text-sky-700 border-sky-200",
    card: "border-sky-300 bg-sky-50 text-sky-800",
    ring: "ring-sky-500",
  },
  {
    key: "repeat",
    label: "Repeat",
    short: "Repeat",
    help: "2-4 paid visits",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    card: "border-violet-300 bg-violet-50 text-violet-800",
    ring: "ring-violet-500",
  },
  {
    key: "frequent",
    label: "Frequent",
    short: "Frequent",
    help: "5+ paid visits",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    card: "border-amber-300 bg-amber-50 text-amber-800",
    ring: "ring-amber-500",
  },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]["key"];

export const SEGMENT_KEYS = SEGMENTS.map((s) => s.key) as SegmentKey[];

export function segmentOf(visits: number): SegmentKey {
  if (visits <= 0) return "registered";
  if (visits === 1) return "one";
  if (visits <= 4) return "repeat";
  return "frequent";
}

export const segmentInfo = (key: SegmentKey) => SEGMENTS.find((s) => s.key === key)!;

export const isSegmentKey = (v: unknown): v is SegmentKey => typeof v === "string" && (SEGMENT_KEYS as string[]).includes(v);

/** Visit-count range for a category, for SQL / Prisma filters. max is inclusive; null = no upper bound. */
export function segmentRange(key: SegmentKey): { min: number; max: number | null } {
  switch (key) {
    case "registered": return { min: 0, max: 0 };
    case "one": return { min: 1, max: 1 };
    case "repeat": return { min: 2, max: 4 };
    case "frequent": return { min: 5, max: null };
  }
}
