import { prisma } from "@/lib/prisma";
import { listParam, oneParam, type SearchParamsRecord } from "@/lib/params";
import { segmentOf, type SegmentKey } from "@/lib/segments";

/**
 * Admin > Insights: what happened to every lead, which campaigns work, and why
 * customers don't book (again).
 *
 * Every customer in the CRM (a "lead") is loaded once per request together with
 * their bookings and the team's call/remark history, and reduced to one
 * `LeadFacts` row. Every number, chart, drill-down list and Excel sheet is then
 * counted from those same rows, so they can never disagree with each other.
 *
 * Rules (the same everywhere in the app):
 * - A booking only counts when its payment is Success or Partially Paid and it
 *   isn't cancelled. Failed / pending-payment orders never count as bookings.
 * - A booking's date is its orderDate (bookingDate when missing).
 * - A "visit" is one booking day: several orders on the same day are one visit.
 * - "Contacted" means the team logged a call or a remark on the customer.
 */

const DAY = 86_400_000;
const IST_OFFSET = 330 * 60_000;

/** A customer who came back has "stopped" after this many times their usual gap, and at least MIN_SILENT_DAYS. */
const SILENT_GAP_MULTIPLE = 3;
export const MIN_SILENT_DAYS = 30;
/** Someone who booked once only counts as "didn't come back" after this many days. */
export const GRACE_DAYS = 30;

export const NO_CAMPAIGN = "(no campaign)";
export const NO_SALON = "(unknown salon)";
export const NO_COUPON = "(no coupon)";
export const NO_OWNER = "(unassigned)";

// ---------- Outcomes: every lead is in exactly one ----------

export const OUTCOMES = [
  { key: "not_contacted", label: "Not contacted yet", short: "Not contacted", group: "notbooked", color: "bg-slate-300", text: "text-slate-600" },
  { key: "contacted", label: "Contacted, hasn't booked", short: "Contacted, no booking", group: "notbooked", color: "bg-slate-500", text: "text-slate-700" },
  { key: "payment_failed", label: "Tried to book, payment failed", short: "Payment failed", group: "notbooked", color: "bg-amber-400", text: "text-amber-700" },
  { key: "once_recent", label: `Booked once, less than ${GRACE_DAYS} days ago`, short: "Booked once (recent)", group: "booked", color: "bg-sky-300", text: "text-sky-700" },
  { key: "once_gone", label: "Booked once, never came back", short: "Booked once, gone", group: "lapsed", color: "bg-orange-500", text: "text-orange-700" },
  { key: "stopped", label: "Came back before, now stopped", short: "Came back, then stopped", group: "lapsed", color: "bg-red-500", text: "text-red-700" },
  { key: "returning", label: "Coming back regularly", short: "Coming back", group: "booked", color: "bg-emerald-500", text: "text-emerald-700" },
] as const;
export type OutcomeKey = (typeof OUTCOMES)[number]["key"];
export const outcomeOf = (k: string) => OUTCOMES.find((o) => o.key === k);

export const OUTCOME_HELP: Record<OutcomeKey, string> = {
  not_contacted: "Never booked, and nobody from the team has logged a call or remark on them.",
  contacted: "The team has called or left a remark, but they haven't made a paid booking (and no failed payment).",
  payment_failed: "Tried to book but the payment failed, and they never made a paid booking (called or not).",
  once_recent: `One paid visit, less than ${GRACE_DAYS} days ago - too early to say if they'll return.`,
  once_gone: `One paid visit, ${GRACE_DAYS}+ days ago, and no second visit.`,
  stopped: `2+ visits, but now silent for over ${SILENT_GAP_MULTIPLE}x their usual gap (at least ${MIN_SILENT_DAYS} days).`,
  returning: "2+ visits and still within their usual rhythm.",
};

// ---------- Reasons (why not booking / why not back), one per lead ----------

/**
 * For leads who haven't booked and customers who stopped, the most informative
 * thing we know - in this order:
 *   1. the team's latest remark (after their last visit, for customers who booked)
 *   2. called, but no remark recorded
 *   3. tried to book again but the payment failed (not called)
 *   4. their latest order was cancelled/refunded (not called)
 *   5. nobody has called them
 * Remark-based reasons are keyed "remark:<label>".
 */
export const FIXED_REASONS: Record<string, string> = {
  called_no_remark: "Called, but no remark recorded",
  failed_not_called: "Payment failed - nobody called them",
  cancelled_not_called: "Order cancelled/refunded - nobody called them",
  not_called_since: "Nobody called them after their last visit",
  not_contacted: "Nobody has contacted them yet",
};
export const reasonLabel = (key: string) =>
  key.startsWith("remark:") ? "Team's remark: " + key.slice(7) : FIXED_REASONS[key] ?? key;

export type Temperature = "HOT" | "WARM" | "COLD";
export const TEMPERATURES: { key: Temperature | "none"; label: string; color: string }[] = [
  { key: "HOT", label: "Hot", color: "bg-red-500" },
  { key: "WARM", label: "Warm", color: "bg-amber-400" },
  { key: "COLD", label: "Cold", color: "bg-sky-400" },
  { key: "none", label: "Not set", color: "bg-slate-300" },
];

export interface LatestNote {
  text: string;
  remark: string | null;
  at: Date;
  by: string | null;
}

export interface LeadFacts {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  ownerKey: string;
  ownerName: string;
  campaign: string;
  registered: boolean;
  /** When we first saw them: registration date or first order, whichever is earlier. */
  joinedAt: Date;
  joinedDay: string;
  contacted: boolean;
  lastContactAt: Date | null;
  doNotContact: boolean;

  /** Separate paid booking days. */
  visits: number;
  /** Paid orders, including several on one day. */
  orders: number;
  revenue: number;
  firstPaidAt: Date | null;
  lastPaidAt: Date | null;
  /** Median days between visits; null with fewer than 2 visits. */
  usualGapDays: number | null;
  daysSinceLast: number | null;
  firstSalon: string | null;
  lastSalon: string | null;
  firstCoupon: string | null;
  failedOrders: number;
  /** Paid orders as [date, isFirstVisit] for the weekly chart. */
  paidOrders: { d: Date; first: boolean }[];

  temperature: Temperature | null;
  latestRemark: { label: string; at: Date; by: string | null } | null;
  latestNote: LatestNote | null;
  outcome: OutcomeKey;
  /** Only for not-booked and lapsed leads (see FIXED_REASONS). */
  reason: string | null;

  // ---- Follow-up journey (Insights 2.0) ----
  /** Category today, from all paid visits. */
  segmentNow: SegmentKey;
  /** Category on the day we first called them (paid visits before that day); today's category if never called. */
  segmentAtStart: SegmentKey;
  /** Separate days the team called / left a remark. */
  contactDays: number;
  firstContactAt: Date | null;
  /** First paid visit on or after the day of our first call. */
  convertedAt: Date | null;
  journey: JourneyKey;

  // ---- Payments (Insights 2.0) ----
  /** Orders and their amount per payment outcome. */
  orderStats: Record<PayStatusKey, { orders: number; amount: number }>;
  payJourney: PayJourneyKey;
  /** Day of their first order whose payment failed. */
  firstFailedAt: Date | null;
  /** First paid order (Success / Partially Paid) on or after the day of the first failure. */
  bookedAfterFailAt: Date | null;
  bookedAfterFailStatus: "Success" | "Partially Paid" | null;
  /** The team called or left a remark on or after the day of the first failure. */
  calledAfterFail: boolean;
}

/**
 * Payment outcome of one order. Cancelled or refunded orders are always
 * "cancelled" - never shown as failed or paid - so "failed" means a failed
 * payment on an order that wasn't cancelled, and success + partial = real
 * (paid) bookings, the same rule as everywhere else.
 */
export const PAY_STATUSES = [
  { key: "success", label: "Success (paid in full)", short: "Success", bar: "bg-emerald-500" },
  { key: "partial", label: "Partially Paid", short: "Partial", bar: "bg-sky-500" },
  { key: "failed", label: "Failed", short: "Failed", bar: "bg-rose-500" },
  { key: "cancelled", label: "Cancelled / Refunded", short: "Cancelled", bar: "bg-slate-400" },
  { key: "other", label: "Pending / other", short: "Other", bar: "bg-amber-400" },
] as const;
export type PayStatusKey = (typeof PAY_STATUSES)[number]["key"];

export function payStatusOf(b: { status: string | null; paymentStatus: string | null }): PayStatusKey {
  if (b.status === "Cancelled" || b.paymentStatus === "Refunded") return "cancelled";
  if (b.paymentStatus === "Failed") return "failed";
  if (b.paymentStatus === "Success") return "success";
  if (b.paymentStatus === "Partially Paid") return "partial";
  return "other";
}

/**
 * Where each customer who placed an order ends up in the payments tree:
 *   never failed      -> paid_full (all paid orders Success) | paid_partial (any Partially Paid)
 *   had a failure     -> rec_success / rec_partial (booked on or after the failed day; by that booking's status)
 *                     -> lost_existing (no booking after, but had booked before) | lost_never (never booked)
 *   neither           -> other_only (only pending / cancelled orders)
 *   no orders at all  -> none (not in the tree)
 */
export const PAY_JOURNEYS = ["paid_full", "paid_partial", "rec_success", "rec_partial", "lost_existing", "lost_never", "other_only", "none"] as const;
export type PayJourneyKey = (typeof PAY_JOURNEYS)[number];

/**
 * Where each customer ends up in the Insights 2.0 tree (exactly one):
 *   never called  -> booked without a call | waiting for the first call
 *   called        -> converted after 1st call | do not contact after 1st call |
 *                    (needed more follow-ups) converted later | do not contact later | still in pipeline
 * "Converted" = a real paid visit on or after the day of our first call, before
 * the day of the second call for "after 1st call". "Do not contact" = flagged DNC,
 * or their followup was closed (e.g. Not Interested) without a booking.
 */
export const JOURNEYS = [
  "nocall_booked",
  "nocall_never",
  "first_converted",
  "first_closed",
  "later_converted",
  "later_closed",
  "pipeline",
] as const;
export type JourneyKey = (typeof JOURNEYS)[number];

/** Remarks that mean "they booked" - a closed followup with one of these is not a "do not contact". */
const POSITIVE_REMARK = /^(booked|converted|service taken)/i;

export type BookingLite = {
  d: Date;
  createdAt: Date;
  status: string | null;
  paymentStatus: string | null;
  grandTotal: number;
  coupon: string | null;
  salon: string | null;
};
export type ActLite = {
  activityType: string;
  remark: string | null;
  note: string | null;
  leadTemperature: Temperature | null;
  createdAt: Date;
  user: { name: string } | null;
};

const isPaid = (b: BookingLite) =>
  (b.paymentStatus === "Success" || b.paymentStatus === "Partially Paid") && b.status !== "Cancelled";
const isCancelled = (b: BookingLite) => b.status === "Cancelled" || b.paymentStatus === "Refunded";

/** Calendar day in India (date-only columns are stored at UTC midnight, which maps to the same day). */
export const dayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function latestNoteOf(acts: ActLite[]): LatestNote | null {
  for (let i = acts.length - 1; i >= 0; i--) {
    const text = acts[i].note?.trim();
    if (text) return { text, remark: acts[i].remark, at: acts[i].createdAt, by: acts[i].user?.name ?? null };
  }
  return null;
}

function lastWithRemark(acts: ActLite[]) {
  for (let i = acts.length - 1; i >= 0; i--) if (acts[i].remark) return acts[i];
  return null;
}


export interface CustomerLite {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  leadSource: string | null;
  doNotContact: boolean;
  firstSeenAt: Date;
  ownerId: string | null;
  owner: { name: string } | null;
  followup: { leadTemperature: Temperature | null } | null;
  /** Earliest registration date, and whether they have any registration at all. */
  regDate: Date | null;
  registered: boolean;
}

/** Reduce one customer + their bookings + calls/remarks (oldest first) to a LeadFacts row. Pure - no DB. */
export function buildLead(c: CustomerLite, bookings: BookingLite[], acts: ActLite[], now: Date): LeadFacts {
  const list = [...bookings].sort((a, b) => a.d.getTime() - b.d.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
  const paid = list.filter(isPaid);

  // Joined = earliest of registration date and first order of any kind; fall back
  // to when the CRM first saw them.
  const candidates = [c.regDate, list[0]?.d].filter((d): d is Date => !!d);
  const joinedAt = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : c.firstSeenAt;

  const visitDays = Array.from(new Set(paid.map((b) => dayKey(b.d))));
  const gaps: number[] = [];
  for (let i = 1; i < visitDays.length; i++) {
    gaps.push((Date.parse(visitDays[i]) - Date.parse(visitDays[i - 1])) / DAY);
  }
  const usualGapDays = median(gaps);
  const first = paid[0];
  const last = paid[paid.length - 1];
  const daysSinceLast = last ? Math.floor((now.getTime() - last.d.getTime()) / DAY) : null;

  const failed = list.filter((b) => b.paymentStatus === "Failed");
  const latestTemp = [...acts].reverse().find((a) => a.leadTemperature)?.leadTemperature ?? null;
  const remarkAct = lastWithRemark(acts);

  // ---- follow-up journey ----
  const contactDayKeys = Array.from(new Set(acts.map((a) => dayKey(a.createdAt)))).sort();
  const firstContactDay = contactDayKeys[0];
  const secondContactDay = contactDayKeys[1];
  const segmentNow = segmentOf(visitDays.length);
  const segmentAtStart = firstContactDay ? segmentOf(visitDays.filter((d) => d < firstContactDay).length) : segmentNow;
  const convertDay = firstContactDay ? visitDays.find((d) => d >= firstContactDay) : undefined;
  const closed = c.doNotContact || (c.followup === null && !POSITIVE_REMARK.test(remarkAct?.remark ?? ""));
  let journey: JourneyKey;
  if (!firstContactDay) journey = visitDays.length > 0 ? "nocall_booked" : "nocall_never";
  else if (convertDay) journey = !secondContactDay || convertDay < secondContactDay ? "first_converted" : "later_converted";
  else if (closed) journey = contactDayKeys.length <= 1 ? "first_closed" : "later_closed";
  else journey = "pipeline";

  // ---- payments ----
  const orderStats = Object.fromEntries(PAY_STATUSES.map((s) => [s.key, { orders: 0, amount: 0 }])) as LeadFacts["orderStats"];
  for (const b of list) {
    const s = orderStats[payStatusOf(b)];
    s.orders++;
    s.amount += b.grandTotal;
  }
  // Payment failures on orders that weren't cancelled (a cancelled order is never "failed").
  const firstFailed = list.find((b) => payStatusOf(b) === "failed");
  const firstFailedDay = firstFailed ? dayKey(firstFailed.d) : undefined;
  // Same day counts as "after": a failed attempt followed by a successful retry is the common case.
  const bookedAfterFail = firstFailedDay ? paid.find((b) => dayKey(b.d) >= firstFailedDay) : undefined;
  const bookedBeforeFail = firstFailedDay ? paid.some((b) => dayKey(b.d) < firstFailedDay) : false;
  let payJourney: PayJourneyKey;
  if (list.length === 0) payJourney = "none";
  else if (!firstFailed) payJourney = paid.length === 0 ? "other_only" : paid.some((b) => b.paymentStatus === "Partially Paid") ? "paid_partial" : "paid_full";
  else if (bookedAfterFail) payJourney = bookedAfterFail.paymentStatus === "Partially Paid" ? "rec_partial" : "rec_success";
  else payJourney = bookedBeforeFail ? "lost_existing" : "lost_never";

  // ---- outcome ----
  let outcome: OutcomeKey;
  if (visitDays.length === 0) {
    // A failed payment is the strongest sign of intent, so it wins over "contacted".
    outcome = failed.length > 0 ? "payment_failed" : acts.length > 0 ? "contacted" : "not_contacted";
  } else if (visitDays.length === 1) {
    outcome = daysSinceLast! < GRACE_DAYS ? "once_recent" : "once_gone";
  } else {
    const silentLimit = Math.max(SILENT_GAP_MULTIPLE * (usualGapDays ?? 0), MIN_SILENT_DAYS);
    outcome = daysSinceLast! > silentLimit ? "stopped" : "returning";
  }
  // ---- reason ----
  let reason: string | null = null;
  if (visitDays.length === 0) {
    if (remarkAct) reason = "remark:" + remarkAct.remark;
    else if (acts.length > 0) reason = "called_no_remark";
    else if (failed.length > 0) reason = "failed_not_called";
    else reason = "not_contacted";
  } else if (outcome === "once_gone" || outcome === "stopped") {
    const actsAfter = acts.filter((a) => a.createdAt >= last.d);
    const remarkAfter = lastWithRemark(actsAfter);
    const latestOrder = list[list.length - 1];
    if (remarkAfter) reason = "remark:" + remarkAfter.remark;
    else if (actsAfter.length > 0) reason = "called_no_remark";
    else if (failed.some((b) => b.d > last.d)) reason = "failed_not_called";
    else if (isCancelled(latestOrder) && latestOrder.d >= last.d) reason = "cancelled_not_called";
    else reason = "not_called_since";
  }

  const firstVisitDay = visitDays[0];
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    city: c.city,
    ownerKey: c.ownerId ?? NO_OWNER,
    ownerName: c.owner?.name ?? NO_OWNER,
    campaign: c.leadSource?.trim() || NO_CAMPAIGN,
    registered: c.registered,
    joinedAt,
    joinedDay: dayKey(joinedAt),
    contacted: acts.length > 0,
    lastContactAt: acts.length ? acts[acts.length - 1].createdAt : null,
    doNotContact: c.doNotContact,
    visits: visitDays.length,
    orders: paid.length,
    revenue: paid.reduce((s, b) => s + b.grandTotal, 0),
    firstPaidAt: first?.d ?? null,
    lastPaidAt: last?.d ?? null,
    usualGapDays,
    daysSinceLast,
    firstSalon: first ? first.salon ?? NO_SALON : null,
    lastSalon: last ? last.salon ?? NO_SALON : null,
    firstCoupon: first ? first.coupon ?? NO_COUPON : null,
    failedOrders: failed.length,
    paidOrders: paid.map((b) => ({ d: b.d, first: dayKey(b.d) === firstVisitDay })),
    temperature: c.followup?.leadTemperature ?? latestTemp,
    latestRemark: remarkAct ? { label: remarkAct.remark!, at: remarkAct.createdAt, by: remarkAct.user?.name ?? null } : null,
    latestNote: latestNoteOf(acts),
    outcome,
    reason,
    segmentNow,
    segmentAtStart,
    contactDays: contactDayKeys.length,
    firstContactAt: acts[0]?.createdAt ?? null,
    convertedAt: convertDay ? new Date(Date.parse(convertDay)) : null,
    journey,
    orderStats,
    payJourney,
    firstFailedAt: firstFailed?.d ?? null,
    bookedAfterFailAt: bookedAfterFail?.d ?? null,
    bookedAfterFailStatus: bookedAfterFail ? (bookedAfterFail.paymentStatus === "Partially Paid" ? "Partially Paid" : "Success") : null,
    calledAfterFail: firstFailedDay ? acts.some((a) => dayKey(a.createdAt) >= firstFailedDay) : false,
  };
}

export interface InsightsData {
  now: Date;
  leads: LeadFacts[];
}

export async function loadInsights(): Promise<InsightsData> {
  const now = new Date();
  const [customers, rawBookings, activities, regDates] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        leadSource: true,
        doNotContact: true,
        firstSeenAt: true,
        ownerId: true,
        owner: { select: { name: true } },
        followup: { select: { leadTemperature: true } },
      },
    }),
    prisma.booking.findMany({
      where: { customer: { deletedAt: null } },
      select: {
        customerId: true,
        orderDate: true,
        bookingDate: true,
        createdAt: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
        styleLoungeCoupon: true,
        salonNameSnapshot: true,
        salon: { select: { name: true } },
      },
    }),
    prisma.activityLog.findMany({
      where: { activityType: { in: ["CALL_LOGGED", "REMARK_ADDED"] }, customer: { deletedAt: null } },
      select: {
        customerId: true,
        activityType: true,
        remark: true,
        note: true,
        leadTemperature: true,
        createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.registration.groupBy({ by: ["customerId"], _min: { onboardingDate: true }, _count: { _all: true } }),
  ]);

  const bookingsBy = new Map<string, BookingLite[]>();
  for (const b of rawBookings) {
    const d = b.orderDate ?? b.bookingDate;
    if (!d) continue;
    const lite: BookingLite = {
      d,
      createdAt: b.createdAt,
      status: b.status,
      paymentStatus: b.paymentStatus,
      grandTotal: b.grandTotal ? Number(b.grandTotal) : 0,
      coupon: b.styleLoungeCoupon?.trim() || null,
      salon: b.salon?.name || b.salonNameSnapshot || null,
    };
    const list = bookingsBy.get(b.customerId);
    if (list) list.push(lite);
    else bookingsBy.set(b.customerId, [lite]);
  }

  const actsBy = new Map<string, ActLite[]>();
  for (const a of activities) {
    const list = actsBy.get(a.customerId);
    if (list) list.push(a);
    else actsBy.set(a.customerId, [a]);
  }

  const regBy = new Map(regDates.map((r) => [r.customerId, r._min.onboardingDate]));

  const leads = customers.map((c) =>
    buildLead(
      { ...c, regDate: regBy.get(c.id) ?? null, registered: regBy.has(c.id) },
      bookingsBy.get(c.id) ?? [],
      actsBy.get(c.id) ?? [],
      now
    )
  );

  return { now, leads };
}

// ---------- Filters (top of the page) ----------

export interface InsightFilters {
  /** YYYY-MM-DD, inclusive - matched against the day the lead joined. */
  from?: string;
  to?: string;
  /** Any of these campaigns (NO_CAMPAIGN for none). Empty = all. */
  campaign: string[];
  /** Salon of their first paid visit - any of these. Empty = all. */
  salon: string[];
  /** ownerId or NO_OWNER - any of these. Empty = all. */
  owner: string[];
}

export function parseFilters(sp: SearchParamsRecord): InsightFilters {
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    from: date(oneParam(sp.from)),
    to: date(oneParam(sp.to)),
    campaign: listParam(sp.campaign),
    salon: listParam(sp.salon),
    owner: listParam(sp.owner),
  };
}

export function applyFilters(leads: LeadFacts[], f: InsightFilters, skip: (keyof InsightFilters)[] = []) {
  const on = (k: keyof InsightFilters) => !skip.includes(k);
  const set = (k: "campaign" | "salon" | "owner") => (on(k) && f[k].length ? new Set(f[k]) : null);
  const campaigns = set("campaign");
  const salons = set("salon");
  const owners = set("owner");
  const from = on("from") ? f.from : undefined;
  const to = on("to") ? f.to : undefined;
  return leads.filter(
    (l) =>
      (!from || l.joinedDay >= from) &&
      (!to || l.joinedDay <= to) &&
      (!campaigns || campaigns.has(l.campaign)) &&
      (!salons || (l.firstSalon !== null && salons.has(l.firstSalon))) &&
      (!owners || owners.has(l.ownerKey))
  );
}

// ---------- Drill-down lists ----------

export const LIST_GROUPS = {
  all: "All leads",
  registered: "Leads who registered",
  contacted_any: "Leads our team contacted",
  booked: "Leads who booked (1+ paid visit)",
  returned: "Customers who came back (2 or more visits)",
  // One per category - each customer is in exactly one of these four.
  seg_registered: "No paid booking yet",
  seg_one: "One-time customers (1 visit)",
  seg_repeat: "Repeat customers (2-4 visits)",
  seg_frequent: "Frequent customers (5+ visits)",
  notbooked: "Leads who haven't booked",
  lapsed: "Customers who didn't come back or stopped",
} as const;
export type ListGroup = keyof typeof LIST_GROUPS;

export interface ListQuery {
  /** An OutcomeKey or a ListGroup. */
  list: string;
  reason?: string;
  temp?: string;
  /** Return-rate drill-downs: first salon / first coupon, only customers who had time to return. */
  rsalon?: string;
  rcoupon?: string;
}

export const hadTimeToReturn = (l: LeadFacts, now: Date) =>
  !!l.firstPaidAt && now.getTime() - l.firstPaidAt.getTime() >= GRACE_DAYS * DAY;

export function inGroup(l: LeadFacts, key: string): boolean {
  switch (key) {
    case "all": return true;
    case "registered": return l.registered;
    case "contacted_any": return l.contacted;
    case "booked": return l.visits >= 1;
    case "returned": return l.visits >= 2;
    case "seg_registered": return l.segmentNow === "registered";
    case "seg_one": return l.segmentNow === "one";
    case "seg_repeat": return l.segmentNow === "repeat";
    case "seg_frequent": return l.segmentNow === "frequent";
    case "notbooked": return l.visits === 0;
    case "lapsed": return l.outcome === "once_gone" || l.outcome === "stopped";
    default: return l.outcome === key;
  }
}

export const isListKey = (k: string) => k in LIST_GROUPS || OUTCOMES.some((o) => o.key === k);

export function listTitle(q: ListQuery): string {
  const parts: string[] = [LIST_GROUPS[q.list as ListGroup] ?? outcomeOf(q.list)?.label ?? q.list];
  if (q.reason) parts.push(reasonLabel(q.reason));
  if (q.temp) parts.push("Temperature: " + (TEMPERATURES.find((t) => t.key === q.temp)?.label ?? q.temp));
  if (q.rsalon) parts.push("First salon: " + q.rsalon);
  if (q.rcoupon) parts.push("First coupon: " + q.rcoupon);
  return parts.join(" - ");
}

export function selectList(leads: LeadFacts[], q: ListQuery, now: Date): LeadFacts[] {
  const rows = leads.filter(
    (l) =>
      inGroup(l, q.list) &&
      (!q.reason || l.reason === q.reason) &&
      (!q.temp || (l.temperature ?? "none") === q.temp) &&
      (!q.rsalon || (l.firstSalon === q.rsalon && hadTimeToReturn(l, now))) &&
      (!q.rcoupon || (l.firstCoupon === q.rcoupon && hadTimeToReturn(l, now)))
  );
  // Most valuable first: customers who booked, by visits then recency; then newest leads.
  return rows.sort(
    (a, b) =>
      b.visits - a.visits ||
      (b.lastPaidAt?.getTime() ?? 0) - (a.lastPaidAt?.getTime() ?? 0) ||
      b.joinedAt.getTime() - a.joinedAt.getTime()
  );
}

// ---------- Aggregations ----------

export interface Summary {
  leads: number;
  registered: number;
  contacted: number;
  booked: number;
  /** Customers per category (by paid visits) - each customer in exactly one. */
  bySegment: Record<SegmentKey, number>;
  /** Booked 30+ days ago, so they had a fair chance to come back. */
  eligible: number;
  eligibleReturned: number;
  orders: number;
  revenue: number;
  outcomes: Record<OutcomeKey, number>;
}

export function summarize(leads: LeadFacts[], now: Date): Summary {
  const s: Summary = {
    leads: leads.length,
    registered: 0,
    contacted: 0,
    booked: 0,
    bySegment: { registered: 0, one: 0, repeat: 0, frequent: 0 },
    eligible: 0,
    eligibleReturned: 0,
    orders: 0,
    revenue: 0,
    outcomes: Object.fromEntries(OUTCOMES.map((o) => [o.key, 0])) as Record<OutcomeKey, number>,
  };
  for (const l of leads) {
    if (l.registered) s.registered++;
    if (l.contacted) s.contacted++;
    if (l.visits >= 1) s.booked++;
    s.bySegment[l.segmentNow]++;
    if (hadTimeToReturn(l, now)) {
      s.eligible++;
      if (l.visits >= 2) s.eligibleReturned++;
    }
    s.orders += l.orders;
    s.revenue += l.revenue;
    s.outcomes[l.outcome]++;
  }
  return s;
}

/** Per-group summaries (campaign, agent...), biggest first. */
export function summarizeBy(leads: LeadFacts[], keyOf: (l: LeadFacts) => string, now: Date) {
  const groups = new Map<string, LeadFacts[]>();
  for (const l of leads) {
    const k = keyOf(l);
    const g = groups.get(k);
    if (g) g.push(l);
    else groups.set(k, [l]);
  }
  return Array.from(groups, ([key, ls]) => ({ key, ...summarize(ls, now) })).sort((a, b) => b.leads - a.leads);
}

/** How often each reason applies within a set of leads (reasons sum to the set size). */
export function reasonCounts(leads: LeadFacts[]) {
  const m = new Map<string, number>();
  for (const l of leads) if (l.reason) m.set(l.reason, (m.get(l.reason) ?? 0) + 1);
  return Array.from(m, ([key, count]) => ({ key, label: reasonLabel(key), count })).sort((a, b) => b.count - a.count);
}

/** Return rate by a key of the first visit, among customers who had time to come back. */
export function returnRateBy(leads: LeadFacts[], keyOf: (l: LeadFacts) => string | null, minCustomers: number, now: Date) {
  const groups = new Map<string, { customers: number; returned: number }>();
  for (const l of leads) {
    if (!hadTimeToReturn(l, now)) continue;
    const k = keyOf(l);
    if (!k) continue;
    const g = groups.get(k) ?? { customers: 0, returned: 0 };
    g.customers++;
    if (l.visits >= 2) g.returned++;
    groups.set(k, g);
  }
  return Array.from(groups, ([key, g]) => ({ key, ...g, rate: g.customers ? g.returned / g.customers : 0 }))
    .filter((g) => g.customers >= minCustomers)
    .sort((a, b) => b.customers - a.customers);
}

/** Last N weeks (Monday start, India time): paid orders split first visit vs returning, plus new leads. */
export function weeklyTrend(leads: LeadFacts[], now: Date, weeks: number) {
  const today = new Date(Date.parse(dayKey(now)));
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * DAY);
  const start = new Date(monday.getTime() - (weeks - 1) * 7 * DAY);
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(start.getTime() + i * 7 * DAY),
    firstTime: 0,
    returning: 0,
    newLeads: 0,
  }));
  const idx = (d: Date) => Math.floor((Date.parse(dayKey(d)) - start.getTime()) / (7 * DAY));
  for (const l of leads) {
    for (const o of l.paidOrders) {
      const i = idx(o.d);
      if (i < 0 || i >= weeks) continue;
      if (o.first) buckets[i].firstTime++;
      else buckets[i].returning++;
    }
    const j = idx(l.joinedAt);
    if (j >= 0 && j < weeks) buckets[j].newLeads++;
  }
  return buckets;
}
