/**
 * Every date/time in this app is shown to an India-based team, but Vercel's
 * server runtime defaults to UTC - "en-IN" only controls formatting style
 * (dd/mm/yyyy, 12-hour clock, etc.), NOT which timezone the clock is read in.
 * Without an explicit timeZone, a server-rendered time is UTC mislabeled as
 * if it were IST (off by 5:30). Always go through these helpers instead of
 * calling toLocaleDateString/toLocaleTimeString/toLocaleString directly.
 */

const TIME_ZONE = "Asia/Kolkata";

function asDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

export function formatDateIN(input: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return asDate(input).toLocaleDateString("en-IN", { timeZone: TIME_ZONE, ...opts });
}

export function formatTimeIN(input: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return asDate(input).toLocaleTimeString("en-IN", { timeZone: TIME_ZONE, ...opts });
}

export function formatDateTimeIN(input: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  return asDate(input).toLocaleString("en-IN", { timeZone: TIME_ZONE, ...opts });
}

/**
 * "Today", as a date-only value anchored to UTC midnight - matching how every
 * date-only column in this app is stored (nextFollowupDate, bookingDate, etc.
 * are all Date.UTC(y, m, d)). NEVER compute "today" on the server with
 * `new Date(); x.setHours(0,0,0,0)` - that truncates to midnight in the
 * server's OWN timezone (UTC on Vercel), which runs 5:30 behind India's real
 * calendar day: from 12:00 AM to 5:29 AM IST, the server still thinks it's
 * yesterday, so anything gated on "is this due today" silently lags by up to
 * 5.5 hours every single day. This reads today's Y/M/D as seen in India first,
 * then anchors it the same way every stored date already is.
 */
export function startOfTodayIST(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  const d = Number(parts.find((p) => p.type === "day")!.value);
  return new Date(Date.UTC(y, m - 1, d));
}

/** startOfTodayIST() as a YYYY-MM-DD string, e.g. for an <input type="date"> default. */
export function todayIsoIST(): string {
  return startOfTodayIST().toISOString().slice(0, 10);
}

/**
 * The exact instants an India calendar day starts and ends, for filtering
 * timestamps (createdAt etc.) by "this day in India". `new Date(y, m, d)` would
 * use the server's timezone - UTC on Vercel - and cut the day at 5:30 AM IST.
 */
export function istDayRange(isoDay: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(isoDay + "T00:00:00Z") - 330 * 60_000);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
