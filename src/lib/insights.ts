import { prisma } from "@/lib/prisma";

/**
 * Admin > Insights: why customers stop booking.
 *
 * Everything is derived from bookings + the team's call/remark history, loaded
 * once per request and computed in memory (a few thousand bookings), so every
 * chart, drill-down list and Excel export works from the same per-customer facts
 * and can never disagree with each other.
 *
 * A "paid" booking is payment Success / Partially Paid and not cancelled - the
 * same rule as Team Stats and the Tracker. A booking's date is its orderDate.
 */

const DAY = 86_400_000;

/** A customer who has gone quiet: no paid booking for 3x their usual gap, and at least this many days. */
export const MIN_SILENT_DAYS = 30;
const SILENT_GAP_MULTIPLE = 3;
/** One-time bookers only count as "never came back" once they've had this long to return. */
export const ONE_TIME_GRACE_DAYS = 30;

// Coupon use is deliberately not a signal: ~70% of regulars who are still booking
// only use coupons too, so it doesn't explain why anyone stopped.
export const SIGNALS = [
  { key: "not_called", label: "Nobody from our team called them after their last booking" },
  { key: "bad_experience", label: "Their latest order was cancelled or refunded" },
  { key: "payment_failed", label: "Tried to book again, but the payment failed" },
  { key: "not_interested", label: "Told our team they're not interested" },
  { key: "location", label: "Told our team it's a location issue" },
  { key: "unreachable", label: "Our team tried but couldn't reach them" },
] as const;
export type SignalKey = (typeof SIGNALS)[number]["key"];

export interface CustomerFacts {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  /** Separate booking days (several orders on one day count as one visit). */
  visits: number;
  /** Paid orders, including multiple on the same day. */
  orders: number;
  revenue: number;
  firstPaidAt: Date;
  lastPaidAt: Date;
  /** Typical days between this customer's paid bookings; null with fewer than 2. */
  usualGapDays: number | null;
  daysSinceLast: number;
  firstCoupon: string | null;
  firstSalon: string | null;
  lastSalon: string | null;
  /** Team's latest remark/note recorded after their last paid booking. */
  remarkSince: string | null;
  noteSince: string | null;
  signals: SignalKey[];
}

export interface FailedPaymentRow {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  failedOrders: number;
  lastTriedAt: Date;
  lastSalon: string | null;
  contactedSince: boolean;
}

type BookingLite = {
  customerId: string;
  d: Date;
  createdAt: Date;
  status: string | null;
  paymentStatus: string | null;
  grandTotal: number;
  coupon: string | null;
  salon: string | null;
};

const isPaid = (b: BookingLite) =>
  (b.paymentStatus === "Success" || b.paymentStatus === "Partially Paid") && b.status !== "Cancelled";
const isBad = (b: BookingLite) => b.status === "Cancelled" || b.paymentStatus === "Refunded";

/** orderDate is stored as a UTC-midnight calendar date, so its ISO date is the booking day. */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface InsightsData {
  now: Date;
  facts: CustomerFacts[];
  failedNeverPaid: FailedPaymentRow[];
  registeredCount: number;
  contactedCount: number;
  /** Every paid booking with whether it was that customer's first, for the trend chart. */
  paidBookings: { d: Date; isFirst: boolean }[];
  registrationsByDay: Date[];
}

export async function loadInsights(): Promise<InsightsData> {
  const now = new Date();
  const [rawBookings, activities, registeredCount, recentRegs] = await Promise.all([
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
      select: { customerId: true, activityType: true, remark: true, note: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.customer.count({ where: { deletedAt: null, registrations: { some: {} } } }),
    prisma.registration.findMany({
      where: { onboardingDate: { gte: new Date(now.getTime() - 120 * DAY) }, customer: { deletedAt: null } },
      select: { onboardingDate: true },
    }),
  ]);

  const bookings: BookingLite[] = rawBookings
    .filter((b) => b.orderDate || b.bookingDate)
    .map((b) => ({
      customerId: b.customerId,
      d: (b.orderDate ?? b.bookingDate)!,
      createdAt: b.createdAt,
      status: b.status,
      paymentStatus: b.paymentStatus,
      grandTotal: b.grandTotal ? Number(b.grandTotal) : 0,
      coupon: b.styleLoungeCoupon,
      salon: b.salon?.name || b.salonNameSnapshot || null,
    }));

  const byCustomer = new Map<string, BookingLite[]>();
  for (const b of bookings) {
    const list = byCustomer.get(b.customerId);
    if (list) list.push(b);
    else byCustomer.set(b.customerId, [b]);
  }

  const actsByCustomer = new Map<string, typeof activities>();
  for (const a of activities) {
    const list = actsByCustomer.get(a.customerId);
    if (list) list.push(a);
    else actsByCustomer.set(a.customerId, [a]);
  }
  const contactedCount = actsByCustomer.size;

  const customers = await prisma.customer.findMany({
    where: { id: { in: Array.from(byCustomer.keys()) }, deletedAt: null },
    select: { id: true, name: true, phone: true, city: true, owner: { select: { name: true } } },
  });
  const customerById = new Map(customers.map((c) => [c.id, c]));

  const facts: CustomerFacts[] = [];
  const failedNeverPaid: FailedPaymentRow[] = [];
  const paidBookings: { d: Date; isFirst: boolean }[] = [];

  for (const [customerId, list] of byCustomer) {
    const c = customerById.get(customerId);
    if (!c) continue;
    list.sort((a, b) => a.d.getTime() - b.d.getTime() || a.createdAt.getTime() - b.createdAt.getTime());
    const paid = list.filter(isPaid);
    const acts = actsByCustomer.get(customerId) ?? [];

    if (paid.length === 0) {
      const failed = list.filter((b) => b.paymentStatus === "Failed");
      if (failed.length > 0) {
        const lastTried = failed[failed.length - 1];
        failedNeverPaid.push({
          id: c.id,
          name: c.name,
          phone: c.phone,
          city: c.city,
          ownerName: c.owner?.name ?? null,
          failedOrders: failed.length,
          lastTriedAt: lastTried.d,
          lastSalon: lastTried.salon,
          contactedSince: acts.some((a) => a.createdAt >= lastTried.d),
        });
      }
      continue;
    }

    // A visit is one booking day: customers often place several orders on the same
    // day (one per service), and counting those as repeat bookings made a single
    // trip look like a "regular" with a 0-day gap.
    const visitDays = Array.from(new Set(paid.map((b) => dayKey(b.d))));
    const firstDay = visitDays[0];
    paid.forEach((b) => paidBookings.push({ d: b.d, isFirst: dayKey(b.d) === firstDay }));

    const first = paid[0];
    const last = paid[paid.length - 1];
    const visitDates = visitDays.map((k) => new Date(k + "T00:00:00Z"));
    const gaps: number[] = [];
    for (let i = 1; i < visitDates.length; i++) gaps.push((visitDates[i].getTime() - visitDates[i - 1].getTime()) / DAY);
    const usualGapDays = median(gaps);
    const daysSinceLast = Math.floor((now.getTime() - last.d.getTime()) / DAY);

    const latestOrder = list[list.length - 1];
    const actsSince = acts.filter((a) => a.createdAt >= last.d);
    const remarksSince = actsSince.filter((a) => a.activityType === "REMARK_ADDED");
    const lastRemark = remarksSince[remarksSince.length - 1];

    const signals: SignalKey[] = [];
    if (actsSince.length === 0) signals.push("not_called");
    if (isBad(latestOrder) && latestOrder.d >= last.d) signals.push("bad_experience");
    if (list.some((b) => b.paymentStatus === "Failed" && b.d > last.d)) signals.push("payment_failed");
    if (lastRemark?.remark === "Not Interested") signals.push("not_interested");
    if (lastRemark?.remark === "Location Issue") signals.push("location");
    if (lastRemark?.remark === "Not Connected") signals.push("unreachable");

    facts.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      city: c.city,
      ownerName: c.owner?.name ?? null,
      visits: visitDays.length,
      orders: paid.length,
      revenue: paid.reduce((s, b) => s + b.grandTotal, 0),
      firstPaidAt: first.d,
      lastPaidAt: last.d,
      usualGapDays,
      daysSinceLast,
      firstCoupon: first.coupon,
      firstSalon: first.salon,
      lastSalon: last.salon,
      remarkSince: lastRemark?.remark ?? null,
      noteSince: lastRemark?.note ?? null,
      signals,
    });
  }

  return {
    now,
    facts,
    failedNeverPaid,
    registeredCount,
    contactedCount,
    paidBookings,
    registrationsByDay: recentRegs.map((r) => r.onboardingDate!).filter(Boolean),
  };
}

// ---------- Segments ----------

export const isStoppedRegular = (f: CustomerFacts) =>
  f.visits >= 3 &&
  f.daysSinceLast > Math.max(SILENT_GAP_MULTIPLE * (f.usualGapDays ?? 0), MIN_SILENT_DAYS);

export const isGoneOneTimer = (f: CustomerFacts) => f.visits === 1 && f.daysSinceLast >= ONE_TIME_GRACE_DAYS;

/** Customers who had a fair chance to come back (first paid booking at least the grace period ago). */
export const hadTimeToReturn = (f: CustomerFacts, now: Date) =>
  now.getTime() - f.firstPaidAt.getTime() >= ONE_TIME_GRACE_DAYS * DAY;

export type ViewKey =
  | "paying"
  | "repeat"
  | "regulars"
  | "stopped"
  | "onetime"
  | "failed"
  | "salon"
  | "coupon";

export const VIEW_TITLES: Record<ViewKey, string> = {
  paying: "Customers who booked at least once",
  repeat: "Customers who came back (2+ visits)",
  regulars: "Regular customers (3+ visits)",
  stopped: "Regular customers who stopped booking",
  onetime: "Booked once and never came back",
  failed: "Tried to book, payment failed, never paid",
  salon: "Customers whose first booking was at this salon",
  coupon: "Customers whose first booking used this coupon",
};

export const NO_COUPON = "(no coupon)";
export const NO_SALON = "(unknown salon)";

export function selectView(
  data: InsightsData,
  view: ViewKey,
  opts: { signal?: string | null; salon?: string | null; coupon?: string | null }
): { kind: "facts"; rows: CustomerFacts[] } | { kind: "failed"; rows: FailedPaymentRow[] } {
  if (view === "failed") {
    return { kind: "failed", rows: [...data.failedNeverPaid].sort((a, b) => b.lastTriedAt.getTime() - a.lastTriedAt.getTime()) };
  }
  let rows = data.facts;
  if (view === "repeat") rows = rows.filter((f) => f.visits >= 2);
  else if (view === "regulars") rows = rows.filter((f) => f.visits >= 3);
  else if (view === "stopped") rows = rows.filter(isStoppedRegular);
  else if (view === "onetime") rows = rows.filter(isGoneOneTimer);
  else if (view === "salon") rows = rows.filter((f) => hadTimeToReturn(f, data.now) && (f.firstSalon ?? NO_SALON) === opts.salon);
  else if (view === "coupon") rows = rows.filter((f) => hadTimeToReturn(f, data.now) && (f.firstCoupon ?? NO_COUPON) === opts.coupon);

  if (opts.signal && (view === "stopped" || view === "onetime")) {
    rows = opts.signal === "none" ? rows.filter((f) => f.signals.length === 0) : rows.filter((f) => f.signals.includes(opts.signal as SignalKey));
  }

  const sorted = [...rows].sort((a, b) =>
    view === "stopped" || view === "regulars" ? b.visits - a.visits || a.daysSinceLast - b.daysSinceLast : b.lastPaidAt.getTime() - a.lastPaidAt.getTime()
  );
  return { kind: "facts", rows: sorted };
}

// ---------- Aggregations for the charts ----------

export function signalCounts(rows: CustomerFacts[]) {
  return [
    ...SIGNALS.map((s) => ({ key: s.key as string, label: s.label, count: rows.filter((f) => f.signals.includes(s.key)).length })),
    { key: "none", label: "No clear sign in our data", count: rows.filter((f) => f.signals.length === 0).length },
  ];
}

export function returnRateBy(
  data: InsightsData,
  keyOf: (f: CustomerFacts) => string,
  minCustomers: number
) {
  const groups = new Map<string, { customers: number; returned: number }>();
  for (const f of data.facts) {
    if (!hadTimeToReturn(f, data.now)) continue;
    const k = keyOf(f);
    const g = groups.get(k) ?? { customers: 0, returned: 0 };
    g.customers++;
    if (f.visits >= 2) g.returned++;
    groups.set(k, g);
  }
  return Array.from(groups, ([key, g]) => ({ key, ...g, rate: g.customers ? g.returned / g.customers : 0 }))
    .filter((g) => g.customers >= minCustomers)
    .sort((a, b) => b.customers - a.customers);
}

/** Last N weeks (Monday-start), paid bookings split into first-time vs repeat, plus registrations. */
export function weeklyTrend(data: InsightsData, weeks: number) {
  const monday = new Date(data.now);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const start = new Date(monday.getTime() - (weeks - 1) * 7 * DAY);
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    start: new Date(start.getTime() + i * 7 * DAY),
    newBookers: 0,
    repeat: 0,
    registrations: 0,
  }));
  const idx = (d: Date) => Math.floor((d.getTime() - start.getTime()) / (7 * DAY));
  for (const b of data.paidBookings) {
    const i = idx(b.d);
    if (i < 0 || i >= weeks) continue;
    if (b.isFirst) buckets[i].newBookers++;
    else buckets[i].repeat++;
  }
  for (const d of data.registrationsByDay) {
    const i = idx(d);
    if (i >= 0 && i < weeks) buckets[i].registrations++;
  }
  return buckets;
}
