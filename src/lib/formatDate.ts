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
