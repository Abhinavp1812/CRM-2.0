import { prisma } from "@/lib/prisma";
import { startOfTodayIST } from "@/lib/formatDate";

export { createManyChunked, findManyChunked } from "@/lib/dbBatch";

/**
 * A customer with no Followup row never shows up in an agent's queue, so it is
 * effectively invisible. That should not happen, but a sync that hits Vercel's
 * 60-second limit part-way through can leave a few behind: the customers are
 * committed before their followups are.
 *
 * This runs at the end of every sync and gives any such customer a followup:
 * latest booking + followupDays for customers who have booked, today otherwise.
 * It only creates missing rows, and never touches an existing followup.
 *
 * Critical: a Followup row is ALSO deliberately deleted whenever an agent
 * saves a closing remark (Not Interested, Converted, ...) or flags DNC (see
 * api/followups/save/route.ts) - that customer has no Followup row too, but
 * for a completely different reason: they were closed on purpose, not left
 * behind by a timeout. Without the exclusion below, this function can't tell
 * the two apart and was silently resurrecting every closed-out customer on
 * every single sync run - wiping their remark/contact history back to
 * "never contacted" and dumping them back in the active queue a few minutes
 * after an agent closed them. Only a customer who has NEVER had a remark
 * saved or been DNC-flagged is a genuine orphan.
 */
export async function healMissingFollowups(userId: string, followupDays: number): Promise<number> {
  const LIMIT = 5000;

  const orphans = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      followup: null,
      activities: { none: { activityType: { in: ["REMARK_ADDED", "DNC_FLAGGED"] } } },
    },
    select: { id: true },
    take: LIMIT,
  });
  if (orphans.length === 0) return 0;

  const ids = orphans.map((c) => c.id);
  const bookings = await prisma.booking.findMany({
    where: { customerId: { in: ids }, bookingDate: { not: null } },
    select: { customerId: true, bookingDate: true },
  });

  const latestByCustomer = new Map<string, Date>();
  for (const b of bookings) {
    if (!b.bookingDate) continue;
    const prev = latestByCustomer.get(b.customerId);
    if (!prev || b.bookingDate.getTime() > prev.getTime()) latestByCustomer.set(b.customerId, b.bookingDate);
  }

  const today = startOfTodayIST();

  const data = ids.map((id) => {
    const latest = latestByCustomer.get(id);
    let date = today;
    if (latest) {
      const due = new Date(latest);
      due.setDate(due.getDate() + followupDays);
      due.setHours(0, 0, 0, 0);
      date = due.getTime() > today.getTime() ? due : today;
    }
    return { customerId: id, nextFollowupDate: date, updatedById: userId };
  });

  const res = await prisma.followup.createMany({ data, skipDuplicates: true });
  return res.count;
}

export interface ResurrectedFollowup {
  followupId: string;
  customerId: string;
  customerName: string | null;
  phone: string;
  lastRemark: string;
  remarkAt: Date;
  resurrectedAt: Date;
}

/**
 * One-time repair for damage already done by the healMissingFollowups bug
 * above (fixed 2026-09-15): finds every customer whose Followup currently
 * looks untouched (no remark, never contacted) despite having a remark on
 * record - which is only possible if it was wrongly recreated after being
 * deliberately closed, since a legitimate reopen (admin "Reopen" button, or
 * unflagging DNC) always leaves its own activity log entry after the last
 * remark, and is excluded here. Read-only - use repairResurrectedFollowups
 * to actually delete the confirmed rows.
 */
export async function findResurrectedFollowups(): Promise<ResurrectedFollowup[]> {
  const candidates = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      followup: { currentRemark: null, lastContactedAt: null },
      activities: { some: { activityType: "REMARK_ADDED" } },
    },
    select: {
      id: true,
      name: true,
      phone: true,
      followup: { select: { id: true, updatedAt: true } },
      activities: {
        where: { activityType: { in: ["REMARK_ADDED", "FOLLOWUP_DATE_CHANGED", "DNC_UNFLAGGED"] } },
        orderBy: { createdAt: "asc" },
        select: { activityType: true, remark: true, note: true, createdAt: true },
      },
    },
    take: 3000,
  });

  const found: ResurrectedFollowup[] = [];
  for (const c of candidates) {
    if (!c.followup) continue;
    const acts = c.activities;
    const lastRemark = [...acts].reverse().find((a) => a.activityType === "REMARK_ADDED");
    if (!lastRemark) continue;
    const reopenAfter = acts.find(
      (a) =>
        (a.activityType === "FOLLOWUP_DATE_CHANGED" &&
          a.createdAt > lastRemark.createdAt &&
          (a.note || "").toLowerCase().includes("re-opened")) ||
        (a.activityType === "DNC_UNFLAGGED" && a.createdAt > lastRemark.createdAt)
    );
    if (reopenAfter) continue;
    if (c.followup.updatedAt > lastRemark.createdAt) {
      found.push({
        followupId: c.followup.id,
        customerId: c.id,
        customerName: c.name,
        phone: c.phone,
        lastRemark: lastRemark.remark || "",
        remarkAt: lastRemark.createdAt,
        resurrectedAt: c.followup.updatedAt,
      });
    }
  }
  return found;
}

/** Deletes exactly the Followup rows findResurrectedFollowups() identifies, restoring their correct closed state. */
export async function repairResurrectedFollowups(): Promise<number> {
  const affected = await findResurrectedFollowups();
  if (affected.length === 0) return 0;
  const res = await prisma.followup.deleteMany({ where: { id: { in: affected.map((a) => a.followupId) } } });
  return res.count;
}
