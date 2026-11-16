/** A search param value as Next gives it: a repeated key (`a=1&a=2`) arrives as an array. */
export type ParamValue = string | string[] | undefined;
export type SearchParamsRecord = Record<string, ParamValue>;

/** All non-empty values of a (possibly repeated) param, de-duplicated. */
export function listParam(v: ParamValue): string[] {
  const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
}

/** First non-empty value of a param. */
export function oneParam(v: ParamValue): string | undefined {
  return listParam(v)[0];
}

/** Build "?a=1&b=x&b=y" from a record; arrays become repeated keys, empty values are dropped. */
export function buildQuery(params: Record<string, string | string[] | undefined | null>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === undefined || item === null || item === "") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(item));
    }
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/** URLSearchParams -> record, keeping repeated keys as arrays (for route handlers). */
export function searchParamsToRecord(sp: URLSearchParams): SearchParamsRecord {
  const out: SearchParamsRecord = {};
  for (const key of new Set(sp.keys())) {
    const all = sp.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
