import { prisma } from "@/lib/prisma";
import { findManyChunked } from "@/lib/dbBatch";
import { segmentOf, type SegmentKey } from "@/lib/segments";
import { NONE_VALUE } from "@/lib/followups";

/**
 * The team's call activity (calls logged + remarks saved) in a time range, with
 * each customer's category ON THE DAY of the activity: Registered only /
 * One-time / Repeat / Frequent from the paid visits they had before that day.
 *
 * Used by the Daily Report (activity log), the Tracker and Insights 2.0's
 * "calls in a date range" tree, so all three count the same way.
 */

const IST_OFFSET = 330 * 60_000;
/** India calendar day (date-only booking columns are stored at UTC midnight, which maps to the same day). */
const dayKey = (d: Date) => new Date(d.getTime() + IST_OFFSET).toISOString().slice(0, 10);

export type ActivityKind = "CALL_LOGGED" | "REMARK_ADDED";
export const ACTIVITY_KINDS: { value: ActivityKind; label: string }[] = [
  { value: "CALL_LOGGED", label: "Call logged" },
  { value: "REMARK_ADDED", label: "Remark saved" },
];

export const NO_CAMPAIGN_VALUE = NONE_VALUE;

export interface CallActivityQuery {
  /** Exact instants; end is exclusive. */
  start: Date;
  end: Date;
  /** Only customers owned by these users (agents always pass themselves). Empty = everyone. */
  customerOwnerIds?: string[];
  /** Only activities logged by these users. Empty = anyone. */
  calledBy?: string[];
  kinds?: ActivityKind[];
  remarks?: string[];
  /** Customer lead source; NO_CAMPAIGN_VALUE = none. */
  campaigns?: string[];
}

export interface ActivityRow {
  id: string;
  at: Date;
  kind: ActivityKind;
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  ownerId: string | null;
  ownerName: string | null;
  campaign: string | null;
  calledBy: string;
  remark: string | null;
  leadTemperature: "HOT" | "WARM" | "COLD" | null;
  note: string | null;
  nextFollowupDate: Date | null;
  /** Paid visits before the day of this activity, and the category that makes them. */
  visitsBefore: number;
  segment: SegmentKey;
}

const PAID = {
  paymentStatus: { in: ["Success", "Partially Paid"] },
  OR: [{ status: null }, { status: { not: "Cancelled" } }],
};

/** Paid visit days (India calendar) per customer, oldest first. */
export async function paidVisitDays(customerIds: string[]): Promise<Map<string, string[]>> {
  const rows = await findManyChunked(customerIds, (chunk) =>
    prisma.booking.findMany({
      where: { customerId: { in: chunk }, ...PAID },
      select: { customerId: true, orderDate: true, bookingDate: true },
    })
  );
  const m = new Map<string, Set<string>>();
  for (const b of rows) {
    const d = b.orderDate ?? b.bookingDate;
    if (!d) continue;
    const set = m.get(b.customerId) ?? new Set<string>();
    set.add(dayKey(d));
    m.set(b.customerId, set);
  }
  return new Map(Array.from(m, ([id, s]) => [id, Array.from(s).sort()]));
}

/** Paid visits strictly before the India calendar day of `at` (a booking the same day counts as after the call). */
export function visitsBeforeDay(visitDays: string[], at: Date): number {
  const day = dayKey(at);
  return visitDays.filter((d) => d < day).length;
}

export async function loadCallActivity(q: CallActivityQuery): Promise<ActivityRow[]> {
  const campaigns = q.campaigns ?? [];
  const realCampaigns = campaigns.filter((c) => c !== NO_CAMPAIGN_VALUE);
  const campaignWhere = campaigns.length
    ? {
        OR: [
          ...(realCampaigns.length ? [{ leadSource: { in: realCampaigns } }] : []),
          ...(campaigns.includes(NO_CAMPAIGN_VALUE) ? [{ leadSource: null }] : []),
        ],
      }
    : {};

  const acts = await prisma.activityLog.findMany({
    where: {
      activityType: { in: q.kinds?.length ? q.kinds : ["CALL_LOGGED", "REMARK_ADDED"] },
      createdAt: { gte: q.start, lt: q.end },
      ...(q.calledBy?.length ? { userId: { in: q.calledBy } } : {}),
      ...(q.remarks?.length ? { remark: { in: q.remarks } } : {}),
      customer: {
        deletedAt: null,
        ...(q.customerOwnerIds?.length ? { ownerId: { in: q.customerOwnerIds } } : {}),
        ...campaignWhere,
      },
    },
    select: {
      id: true,
      createdAt: true,
      activityType: true,
      remark: true,
      leadTemperature: true,
      note: true,
      newValue: true,
      user: { select: { name: true } },
      customer: {
        select: { id: true, name: true, phone: true, city: true, leadSource: true, ownerId: true, owner: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const visits = await paidVisitDays(Array.from(new Set(acts.map((a) => a.customer.id))));

  return acts.map((a) => {
    const before = visitsBeforeDay(visits.get(a.customer.id) ?? [], a.createdAt);
    const next = a.activityType === "REMARK_ADDED" && a.newValue ? new Date(a.newValue) : null;
    return {
      id: a.id,
      at: a.createdAt,
      kind: a.activityType as ActivityKind,
      customerId: a.customer.id,
      customerName: a.customer.name,
      phone: a.customer.phone,
      city: a.customer.city,
      ownerId: a.customer.ownerId,
      ownerName: a.customer.owner?.name ?? null,
      campaign: a.customer.leadSource,
      calledBy: a.user?.name ?? "Admin",
      remark: a.remark,
      leadTemperature: a.leadTemperature,
      note: a.note,
      nextFollowupDate: next && !isNaN(next.getTime()) ? next : null,
      visitsBefore: before,
      segment: segmentOf(before),
    };
  });
}

// ---------- One row per customer called in the range ----------

export interface CalledCustomer {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  ownerId: string | null;
  ownerName: string | null;
  campaign: string | null;
  /** Category on the day of their first call in the range. */
  segment: SegmentKey;
  firstAt: Date;
  lastAt: Date;
  activities: number;
  /** Latest remark saved in the range. */
  remark: string | null;
  remarkAt: Date | null;
  remarkBy: string | null;
  note: string | null;
  /** First paid visit on or after the day of their first call in the range (up to today). */
  bookedOn: Date | null;
  /** "booked", "remark:<label>" or "no_remark". */
  response: string;
}

export const responseLabel = (key: string) =>
  key === "booked" ? "Booked after the call" : key === "no_remark" ? "Call logged, no remark" : key.startsWith("remark:") ? key.slice(7) : key;

/** Groups activity rows (any order) into one row per customer, and works out what happened after the call. */
export async function summarizeCalledCustomers(rows: ActivityRow[]): Promise<CalledCustomer[]> {
  const visits = await paidVisitDays(Array.from(new Set(rows.map((r) => r.customerId))));
  return summarizeWithVisits(rows, visits);
}

/** Pure part of summarizeCalledCustomers: `visits` = paid visit days (India, YYYY-MM-DD) per customer. */
export function summarizeWithVisits(rows: ActivityRow[], visits: Map<string, string[]>): CalledCustomer[] {
  const byCustomer = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const list = byCustomer.get(r.customerId) ?? [];
    list.push(r);
    byCustomer.set(r.customerId, list);
  }
  return Array.from(byCustomer, ([id, list]) => {
    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const lastRemark = [...sorted].reverse().find((r) => r.remark);
    const lastNote = [...sorted].reverse().find((r) => r.note?.trim());
    const firstDay = dayKey(first.at);
    const booked = (visits.get(id) ?? []).find((d) => d >= firstDay);
    return {
      id,
      name: first.customerName,
      phone: first.phone,
      city: first.city,
      ownerId: first.ownerId,
      ownerName: first.ownerName,
      campaign: first.campaign,
      segment: first.segment,
      firstAt: first.at,
      lastAt: last.at,
      activities: sorted.length,
      remark: lastRemark?.remark ?? null,
      remarkAt: lastRemark?.at ?? null,
      remarkBy: lastRemark?.calledBy ?? null,
      note: lastNote?.note?.trim() ?? null,
      bookedOn: booked ? new Date(Date.parse(booked)) : null,
      response: booked ? "booked" : lastRemark?.remark ? "remark:" + lastRemark.remark : "no_remark",
    };
  });
}

/** Colour family for a response, so the tree reads at a glance. */
export function responseTone(key: string): "good" | "bad" | "pipe" | "neutral" {
  if (key === "booked") return "good";
  if (key === "no_remark") return "neutral";
  const r = key.slice(7).toLowerCase();
  if (/not interested|invalid|dnd|do not|wrong|not required|location/.test(r)) return "bad";
  if (/not connected|busy|switched off|no answer|unreachable/.test(r)) return "neutral";
  return "pipe";
}
