import { dayKey, type LeadFacts } from "@/lib/insights";

/**
 * Admin > WhatsApp > Customer lists - who to nudge, by how many times they've
 * booked. Counting follows the CRM rule: paid visits (Success / Partially Paid,
 * not cancelled; several orders on one day = one visit).
 *
 *   never     registered, no paid visit
 *   one       1 visit
 *   two       2 visits
 *   three     3-4 visits
 *   frequent  5+ visits
 *   last25    last paid visit exactly 25 days before the "re-engage on" date(s)
 *             - and ONLY there: they are taken out of their count list, so every
 *             customer is in exactly one list
 *   blocked   do not nudge: opted out, Do Not Contact, latest remark Not Interested /
 *             Invalid number. They're left out of every other list.
 *
 * Also left out of the nudge lists: no valid 10-digit phone, and (optionally)
 * anyone who EVER ordered at one of the excluded salons, any payment status.
 */

export const NUDGE_LISTS = [
  { key: "last25", label: "Last booking 25 days ago", help: "Last paid visit exactly 25 days before the re-engage date. Shown only here, not in their count list." },
  { key: "never", label: "Never booked", help: "Registered, no paid booking yet." },
  { key: "one", label: "1 time", help: "Exactly 1 paid visit." },
  { key: "two", label: "2 times", help: "Exactly 2 paid visits." },
  { key: "three", label: "3-4 times", help: "3 or 4 paid visits." },
  { key: "frequent", label: "Frequent", help: "5 or more paid visits." },
  { key: "blocked", label: "Do not nudge", help: "Not Interested, Do Not Contact, Invalid Number or opted out - never messaged." },
] as const;
export type NudgeListKey = (typeof NUDGE_LISTS)[number]["key"];
export const isNudgeListKey = (v: unknown): v is NudgeListKey => NUDGE_LISTS.some((l) => l.key === v);

export const BLOCK_REASONS = {
  opted_out: "Opted out of WhatsApp",
  dnc: "Do Not Contact",
  not_interested: "Not Interested",
  invalid: "Invalid / wrong number",
} as const;
export type BlockReason = keyof typeof BLOCK_REASONS;

export function blockReason(l: LeadFacts, optedOut: Set<string>): BlockReason | null {
  const remark = l.latestRemark?.label ?? "";
  if (optedOut.has(l.id)) return "opted_out";
  if (l.doNotContact) return "dnc";
  if (/not\s*interested/i.test(remark)) return "not_interested";
  if (/invalid|wrong\s*number/i.test(remark)) return "invalid";
  return null;
}

export function countListOf(l: LeadFacts): "never" | "one" | "two" | "three" | "frequent" | null {
  if (l.visits === 0) return l.registered ? "never" : null;
  if (l.visits === 1) return "one";
  if (l.visits === 2) return "two";
  if (l.visits <= 4) return "three";
  return "frequent";
}

/** "Glow and go Unisex-Salon " -> "glowandgounisexsalon" (same matching as the WA Toolbox). */
export const salonKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

export interface NudgeListRow {
  lead: LeadFacts;
  blocked: BlockReason | null;
}

export interface NudgeListOptions {
  optedOut: Set<string>;
  /** Salon names; anyone who ever ordered at one is left out of the nudge lists. */
  excludeSalons: string[];
  /** YYYY-MM-DD "re-engage on" range for the 25-days list (single day = from === to). */
  reengageFrom: string;
  reengageTo: string;
  daysBefore?: number;
}

const shiftDay = (iso: string, days: number) => new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

export function buildNudgeLists(leads: LeadFacts[], o: NudgeListOptions) {
  const days = o.daysBefore ?? 25;
  const lastFrom = shiftDay(o.reengageFrom, -days);
  const lastTo = shiftDay(o.reengageTo, -days);
  const excluded = new Set(o.excludeSalons.map(salonKey).filter(Boolean));

  const lists = Object.fromEntries(NUDGE_LISTS.map((l) => [l.key, [] as NudgeListRow[]])) as Record<NudgeListKey, NudgeListRow[]>;
  let noPhone = 0;
  let salonExcluded = 0;

  for (const l of leads) {
    const bucket = countListOf(l);
    if (!bucket) continue;
    const blocked = blockReason(l, o.optedOut);
    if (blocked) {
      lists.blocked.push({ lead: l, blocked });
      continue;
    }
    if (!/^\d{10}$/.test(l.phone)) {
      noPhone++;
      continue;
    }
    if (excluded.size && l.salonsEver.some((s) => excluded.has(salonKey(s)))) {
      salonExcluded++;
      continue;
    }
    // Every customer lands in exactly ONE list: the 25-days list takes them out
    // of their count list, so nobody is ever in two tabs (or messaged twice a day).
    const d = l.lastPaidAt ? dayKey(l.lastPaidAt) : null;
    if (d && d >= lastFrom && d <= lastTo) lists.last25.push({ lead: l, blocked: null });
    else lists[bucket].push({ lead: l, blocked: null });
  }

  // Most recent booking first; never-booked by newest lead.
  const byRecent = (a: NudgeListRow, b: NudgeListRow) =>
    (b.lead.lastPaidAt?.getTime() ?? 0) - (a.lead.lastPaidAt?.getTime() ?? 0) || b.lead.joinedAt.getTime() - a.lead.joinedAt.getTime();
  for (const k of Object.keys(lists) as NudgeListKey[]) lists[k].sort(byRecent);

  return { lists, noPhone, salonExcluded, lastBookedFrom: lastFrom, lastBookedTo: lastTo };
}
