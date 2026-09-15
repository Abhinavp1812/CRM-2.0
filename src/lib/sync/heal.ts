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
