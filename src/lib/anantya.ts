/**
 * Anantya.ai WhatsApp API client (https://apiv1.anantya.ai/swagger/v1/swagger.json).
 * Auth: `X-Api-Key` header with the key from Anantya -> Integrations -> API Key,
 * stored in the ANANTYA_API_KEY environment variable (never in code).
 *
 * Their spec documents most responses only as "200 OK", so responses are parsed
 * defensively and the raw text is kept for troubleshooting.
 */

const BASE = "https://apiv1.anantya.ai";
const TIMEOUT_MS = 20_000;

export const isAnantyaConfigured = () => !!process.env.ANANTYA_API_KEY?.trim();

function apiKey(): string {
  const k = process.env.ANANTYA_API_KEY?.trim();
  if (!k) throw new Error("ANANTYA_API_KEY is not set - add it to the environment variables and redeploy / restart.");
  return k;
}

async function call(path: string, init: RequestInit): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { accept: "*/*", "X-Api-Key": apiKey(), ...(init.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export interface AnantyaTemplate {
  id: number;
  name: string;
  status: string | null;
  isActive: boolean;
  text: string;
  /** Highest {{n}} placeholder in the text = how many variables the template needs. */
  variableCount: number;
}

/** Placeholders like {{1}}, {{2}} in the template text. */
export function countVariables(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Pulls the array out of whatever envelope the API used: [..], {dataObj:[..]}, {data:[..]}, {result:[..]}. */
function asArray(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["dataObj", "DataObj", "data", "Data", "result", "Result", "templates", "Templates"]) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

export async function getTemplates(): Promise<AnantyaTemplate[]> {
  const r = await call("/api/Campaign/GetTemplates", { method: "GET" });
  if (!r.ok) throw new Error(`Anantya GetTemplates failed (HTTP ${r.status}): ${r.text.slice(0, 200)}`);
  return asArray(r.json)
    .map((t) => {
      const text = String(pick(t, "msgText", "MsgText", "templateText", "body") ?? "");
      return {
        id: Number(pick(t, "id", "Id", "templateId", "TemplateId")),
        name: String(pick(t, "templateName", "TemplateName", "name") ?? "(unnamed)"),
        status: (pick(t, "templateStatus", "TemplateStatus", "status") as string | undefined) ?? null,
        isActive: pick(t, "isActive", "IsActive") === undefined ? true : !!pick(t, "isActive", "IsActive"),
        text,
        variableCount: countVariables(text),
      };
    })
    .filter((t) => Number.isFinite(t.id));
}

/** Anantya wants the number with the country code; CRM phones are 10-digit Indian numbers. */
export function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

export interface SendResult {
  ok: boolean;
  status: number;
  /** Trimmed raw response, kept in the message log. */
  response: string;
  error: string | null;
}

/**
 * Send one approved template to one number. `variables[i]` fills {{i+1}}
 * (Anantya's Attribute1..Attribute13).
 */
export async function sendTemplate(opts: { templateId: number; phone: string; name: string; variables: string[] }): Promise<SendResult> {
  const form = new FormData();
  form.append("ContactNo", toWhatsAppNumber(opts.phone));
  form.append("ContactName", (opts.name || "Customer").slice(0, 60));
  opts.variables.slice(0, 13).forEach((v, i) => form.append(`Attribute${i + 1}`, v ?? ""));
  try {
    const r = await call(`/api/Campaign/SendSingleTemplateMessage?templateId=${encodeURIComponent(String(opts.templateId))}`, {
      method: "POST",
      body: form,
    });
    // Some APIs answer 200 with {isSuccess:false, message:"..."} - treat that as a failure.
    const o = r.json && typeof r.json === "object" && !Array.isArray(r.json) ? (r.json as Record<string, unknown>) : null;
    const flagged = o ? pick(o, "isSuccess", "IsSuccess", "success", "Success") : undefined;
    const ok = r.ok && flagged !== false;
    const message = o ? String(pick(o, "message", "Message") ?? "") : "";
    return {
      ok,
      status: r.status,
      response: r.text.slice(0, 1000),
      error: ok ? null : `HTTP ${r.status}${message ? ": " + message : r.text ? ": " + r.text.slice(0, 200) : ""}`,
    };
  } catch (e) {
    return { ok: false, status: 0, response: "", error: e instanceof Error ? e.message : "Request failed" };
  }
}
