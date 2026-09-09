import { createSign } from "crypto";

/**
 * Minimal Google Sheets reader using a service account.
 * No SDK dependency: we sign a JWT with the service-account private key,
 * exchange it for an access token, then call the Sheets REST API.
 *
 * Credentials come from env (never committed):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — full contents of the service-account JSON file (preferred)
 *   or
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export function getServiceAccount(): ServiceAccount | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json) as Partial<ServiceAccount>;
      if (parsed.client_email && parsed.private_key) {
        return { client_email: parsed.client_email, private_key: normalizeKey(parsed.private_key) };
      }
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) return { client_email: email, private_key: normalizeKey(key) };
  return null;
}

function normalizeKey(key: string): string {
  let k = key.trim();
  // Strip surrounding quotes some dashboards add
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  // Env UIs often store the key with literal "\n" sequences
  return k.replace(/\n/g, "\n");
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const sa = getServiceAccount();
  if (!sa) {
    throw new Error(
      "Google service account is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)."
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google auth failed: ${data.error_description || data.error || res.statusText}`);
  }
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function sheetsGet(path: string): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${SHEETS_API}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.ok) return res.json();

  let detail = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    detail = body.error?.message || detail;
  } catch { /* ignore */ }

  const sa = getServiceAccount();
  if (res.status === 403) {
    throw new Error(
      `Google Sheets access denied. Share the spreadsheet with ${sa?.client_email ?? "the service account"} (Viewer). Details: ${detail}`
    );
  }
  if (res.status === 404) throw new Error(`Spreadsheet not found. Check the sheet ID. Details: ${detail}`);
  if (res.status === 400) throw new Error(`Google Sheets request rejected (check the tab name). Details: ${detail}`);
  throw new Error(`Google Sheets error ${res.status}: ${detail}`);
}

/** List tab names in a spreadsheet. */
export async function listSheetTabs(spreadsheetId: string): Promise<string[]> {
  const data = (await sheetsGet(`${spreadsheetId}?fields=sheets.properties.title`)) as {
    sheets?: { properties?: { title?: string } }[];
  };
  return (data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

export interface SheetTable {
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * Read a whole tab. Row 1 is treated as the header row.
 * Values are returned as the sheet displays them (formatted strings), which
 * keeps dates like "09-09-2026" and phone numbers intact.
 *
 * Duplicate header names (e.g. two "Name" columns) are merged: the last
 * non-empty value wins, so a cleaned-up column overrides a raw one.
 */
export async function fetchSheetRows(spreadsheetId: string, tab: string): Promise<SheetTable> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const data = (await sheetsGet(
    `${spreadsheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING&majorDimension=ROWS`
  )) as { values?: unknown[][] };

  const values = data.values ?? [];
  if (values.length === 0) return { headers: [], rows: [] };

  const rawHeaders = values[0].map((h) => String(h ?? "").trim());
  const headers = Array.from(new Set(rawHeaders.filter(Boolean)));

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < values.length; i++) {
    const line = values[i];
    const row: Record<string, unknown> = {};
    for (const h of headers) row[h] = "";
    let hasData = false;
    for (let c = 0; c < rawHeaders.length; c++) {
      const h = rawHeaders[c];
      if (!h) continue;
      const v = line[c] === undefined || line[c] === null ? "" : String(line[c]).trim();
      if (v !== "") {
        row[h] = v;
        hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }
  return { headers, rows };
}
