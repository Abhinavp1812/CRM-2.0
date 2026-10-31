import { startOfTodayIST, todayIsoIST } from "@/lib/formatDate";
import type { TrackerRange } from "@/lib/tracker";

/**
 * Turns the Tracker page's query params (from / to / months) into the exact
 * ranges every count and list uses. Shared by the page and the Excel export so
 * a download always covers precisely what is on screen.
 */

export const WINDOW_MONTH_OPTIONS = [1, 3, 6, 12, 0]; // 0 = all time
export const DEFAULT_WINDOW_MONTHS = 3;
const DEFAULT_RANGE_DAYS = 7;

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateParam(v: string | undefined | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export interface ResolvedTrackerParams {
  todayStr: string;
  fromStr: string;
  toStr: string;
  /** Registrations / bookings range; `to` is exclusive (the day after the last day). */
  range: TrackerRange;
  windowMonths: number;
  windowLabel: string;
  /** Window for repeat bookings / new bookers: last N months ending today (India), or all time. */
  behaviourWindow: TrackerRange;
}

export function resolveTrackerParams(params: {
  from?: string | null;
  to?: string | null;
  months?: string | null;
}): ResolvedTrackerParams {
  const todayStr = todayIsoIST();
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const defaultTo = new Date(ty, tm - 1, td);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - (DEFAULT_RANGE_DAYS - 1));

  const from = parseDateParam(params.from) || defaultFrom;
  const to = parseDateParam(params.to) || defaultTo;
  const fromStr = params.from && parseDateParam(params.from) ? params.from : isoDate(from.getFullYear(), from.getMonth() + 1, from.getDate());
  const toStr = params.to && parseDateParam(params.to) ? params.to : isoDate(to.getFullYear(), to.getMonth() + 1, to.getDate());

  const toExclusive = new Date(to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const requestedMonths = parseInt(params.months ?? "", 10);
  const windowMonths = WINDOW_MONTH_OPTIONS.includes(requestedMonths) ? requestedMonths : DEFAULT_WINDOW_MONTHS;
  const windowTo = startOfTodayIST();
  windowTo.setUTCDate(windowTo.getUTCDate() + 1);
  const windowFrom = new Date(windowTo);
  if (windowMonths === 0) windowFrom.setTime(Date.UTC(2000, 0, 1));
  else windowFrom.setUTCMonth(windowFrom.getUTCMonth() - windowMonths);

  return {
    todayStr,
    fromStr,
    toStr,
    range: { from, to: toExclusive },
    windowMonths,
    windowLabel: windowMonths === 0 ? "all time" : `last ${windowMonths} month${windowMonths === 1 ? "" : "s"}`,
    behaviourWindow: { from: windowFrom, to: windowTo },
  };
}
