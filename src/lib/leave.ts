import type { Prisma } from "@prisma/client";
import { startOfTodayIST } from "@/lib/formatDate";

/**
 * Leave is a date window (onLeaveFrom..onLeaveUntil, both date-only, UTC-anchored
 * like every other date in this app), not a permanent flag. The columns are only
 * cleared when the agent next logs in, so anything that checks `onLeaveFrom: null`
 * treats an agent whose leave ENDED days ago as still away - they silently stop
 * receiving new customers (and are skipped by reassign/balance) until they happen
 * to log in again. Always go through these instead.
 */

/** Prisma filter: agent is available today - no leave, leave hasn't started, or leave already ended. */
export function notOnLeaveWhere(today: Date = startOfTodayIST()): Prisma.UserWhereInput {
  return {
    OR: [{ onLeaveFrom: null }, { onLeaveFrom: { gt: today } }, { onLeaveUntil: { lt: today } }],
  };
}

/** Same rule for a row already loaded. Open-ended leave (no end date) counts as on leave. */
export function isOnLeaveNow(
  from: Date | string | null | undefined,
  until: Date | string | null | undefined,
  today: Date = startOfTodayIST()
): boolean {
  if (!from) return false;
  const f = new Date(from).getTime();
  if (f > today.getTime()) return false;
  if (until && new Date(until).getTime() < today.getTime()) return false;
  return true;
}
