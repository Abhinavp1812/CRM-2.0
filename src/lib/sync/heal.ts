import { prisma } from "@/lib/prisma";

/**
 * A customer with no Followup row never shows up in an agent's queue, so it is
 * effectively invisible. That should not happen, but a sync that hits Vercel's
 * 60-second limit part-way through can leave a few behind: the customers are
 * committed before their followups are.
 *
 * This runs at the end of every sync and gives any such customer a followup:
 * latest booking + followupDays for customers who have booked, today otherwise.
 * It only creates missing rows, and never touches an existing followup.
 */
export async function healMissingFollowups(userId: string, followupDays: number): Promise<number> {
  const LIMIT = 5000;

  const orphans = await prisma.customer.findMany({
    where: { deletedAt: null, followup: null },
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

/**
 * Split a bulk insert so no single statement carries the whole sheet.
 * Large single createMany calls are the slowest part of a first sync and the
 * most likely thing to blow the function timeout outright.
 */
export async function createManyChunked<T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>,
  size = 1000
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await insert(rows.slice(i, i + size));
  }
}
