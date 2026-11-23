import { prisma } from "@/lib/prisma";
import { loadInsights, type LeadFacts } from "@/lib/insights";
import { getTemplates, sendTemplate, type AnantyaTemplate } from "@/lib/anantya";
import { formatDateIN } from "@/lib/formatDate";

/**
 * WhatsApp nudges via Anantya.ai.
 *
 * Four customer groups (from the same per-customer facts as Insights, so the
 * numbers match): each can have its own approved WhatsApp template.
 *
 * Safety rules, enforced here for EVERY send (manual or automatic):
 * - Test mode (on by default): messages go ONLY to the test number, never to customers.
 * - Never nudge: opted out, Do Not Contact, latest remark Not Interested / Invalid Number,
 *   or already nudged (for real) within the cooldown.
 * - At most `perRunLimit` customers per group per run.
 */

export const GROUPS = [
  { key: "registered", label: "Registered, never booked", help: "No paid booking yet and no failed payment." },
  { key: "one_time", label: "One-time, didn't return", help: "1 paid visit, 30+ days ago, no second visit." },
  { key: "stopped", label: "Repeat / frequent who went quiet", help: "2+ visits, now silent for over 3x their usual gap (at least 30 days)." },
  { key: "payment_failed", label: "Payment failed, never booked", help: "Tried to book, payment failed, no paid booking since." },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];
export const isGroupKey = (v: unknown): v is GroupKey => GROUPS.some((g) => g.key === v);

const inGroup: Record<GroupKey, (l: LeadFacts) => boolean> = {
  registered: (l) => l.outcome === "not_contacted" || l.outcome === "contacted",
  one_time: (l) => l.outcome === "once_gone",
  stopped: (l) => l.outcome === "stopped",
  payment_failed: (l) => l.outcome === "payment_failed",
};

/** What fills each {{n}} in a template. */
export const VARIABLE_SOURCES = [
  { key: "first_name", label: "Customer first name", sample: (l: LeadFacts) => firstName(l.name) },
  { key: "full_name", label: "Customer full name", sample: (l: LeadFacts) => (l.name?.trim() || "there") },
  { key: "last_salon", label: "Last salon booked", sample: (l: LeadFacts) => (l.lastSalon && l.lastSalon !== "(unknown salon)" ? l.lastSalon : "your favourite salon") },
  { key: "last_visit", label: "Last visit date", sample: (l: LeadFacts) => (l.lastPaidAt ? formatDateIN(l.lastPaidAt) : "") },
  { key: "visits", label: "Number of visits", sample: (l: LeadFacts) => String(l.visits) },
  { key: "city", label: "City", sample: (l: LeadFacts) => l.city ?? "" },
  { key: "fixed", label: "Fixed text…", sample: () => "" },
] as const;
export type VariableSourceKey = (typeof VARIABLE_SOURCES)[number]["key"];

function firstName(name: string | null): string {
  const n = (name ?? "").trim().split(/\s+/)[0];
  return n && !/^\(?no name\)?$/i.test(n) ? n : "there";
}

export interface VariableConfig {
  source: VariableSourceKey;
  text?: string;
}
export interface GroupConfig {
  enabled: boolean;
  templateId: number | null;
  variables: VariableConfig[];
}
export interface NudgeSettings {
  mode: "manual" | "automatic";
  testMode: boolean;
  testNumber: string;
  cooldownDays: number;
  perRunLimit: number;
  groups: Record<GroupKey, GroupConfig>;
}

const KEY = "whatsapp.settings";
const DEFAULT_GROUP: GroupConfig = { enabled: false, templateId: null, variables: [] };
export const DEFAULT_SETTINGS: NudgeSettings = {
  mode: "manual",
  testMode: true,
  testNumber: "",
  cooldownDays: 7,
  perRunLimit: 100,
  groups: { registered: DEFAULT_GROUP, one_time: DEFAULT_GROUP, stopped: DEFAULT_GROUP, payment_failed: DEFAULT_GROUP },
};

export async function getNudgeSettings(): Promise<NudgeSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SETTINGS;
  try {
    const s = JSON.parse(row.value) as Partial<NudgeSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      // Test mode stays on unless it was explicitly switched off.
      testMode: s.testMode !== false,
      groups: { ...DEFAULT_SETTINGS.groups, ...(s.groups ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveNudgeSettings(s: NudgeSettings): Promise<void> {
  const clean: NudgeSettings = {
    mode: s.mode === "automatic" ? "automatic" : "manual",
    testMode: s.testMode !== false,
    testNumber: (s.testNumber ?? "").replace(/\D/g, "").slice(-10),
    cooldownDays: Math.min(60, Math.max(1, Math.round(Number(s.cooldownDays) || 7))),
    perRunLimit: Math.min(500, Math.max(1, Math.round(Number(s.perRunLimit) || 100))),
    groups: Object.fromEntries(
      GROUPS.map((g) => {
        const c = s.groups?.[g.key] ?? DEFAULT_GROUP;
        return [
          g.key,
          {
            enabled: !!c.enabled,
            templateId: c.templateId ? Number(c.templateId) : null,
            variables: (c.variables ?? [])
              .slice(0, 13)
              .map((v) => ({ source: VARIABLE_SOURCES.some((x) => x.key === v.source) ? v.source : "fixed", text: (v.text ?? "").slice(0, 200) })),
          },
        ];
      })
    ) as Record<GroupKey, GroupConfig>,
  };
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: JSON.stringify(clean) }, create: { key: KEY, value: JSON.stringify(clean) } });
}

// ---------- Audience ----------

export const EXCLUSIONS = {
  opted_out: "Opted out of WhatsApp",
  dnc: "Do Not Contact",
  not_interested: "Latest remark: Not Interested",
  invalid: "Latest remark: Invalid / wrong number",
  cooldown: "Already nudged recently",
  bad_phone: "No valid phone number",
} as const;
export type ExclusionKey = keyof typeof EXCLUSIONS;

/** Why a customer must not be nudged (first matching rule), or null if they can be. */
export function exclusionFor(l: LeadFacts, optedOut: Set<string>, nudgedRecently: Set<string>): ExclusionKey | null {
  const remark = l.latestRemark?.label ?? "";
  if (optedOut.has(l.id)) return "opted_out";
  if (l.doNotContact) return "dnc";
  if (/not\s*interested/i.test(remark)) return "not_interested";
  if (/invalid|wrong\s*number/i.test(remark)) return "invalid";
  if (nudgedRecently.has(l.id)) return "cooldown";
  if (!/^\d{10}$/.test(l.phone)) return "bad_phone";
  return null;
}

/** Which nudge group a customer belongs to (at most one), from the same facts as Insights. */
export function groupOf(l: LeadFacts): GroupKey | null {
  return GROUPS.find((g) => inGroup[g.key](l))?.key ?? null;
}

export interface AudienceRow {
  lead: LeadFacts;
  excluded: ExclusionKey | null;
}

export async function buildAudience(settings: NudgeSettings): Promise<{ groups: Record<GroupKey, AudienceRow[]> }> {
  const since = new Date(Date.now() - settings.cooldownDays * 86_400_000);
  const [{ leads }, optOuts, recent] = await Promise.all([
    loadInsights(),
    prisma.whatsAppOptOut.findMany({ select: { customerId: true } }),
    prisma.whatsAppMessage.findMany({
      where: { isTest: false, status: "SENT", createdAt: { gte: since }, customerId: { not: null } },
      select: { customerId: true },
    }),
  ]);
  const opted = new Set(optOuts.map((o) => o.customerId));
  const nudged = new Set(recent.map((r) => r.customerId!));

  const exclusionOf = (l: LeadFacts) => exclusionFor(l, opted, nudged);

  const groups = Object.fromEntries(GROUPS.map((g) => [g.key, [] as AudienceRow[]])) as Record<GroupKey, AudienceRow[]>;
  for (const l of leads) {
    const g = GROUPS.find((x) => inGroup[x.key](l));
    if (!g) continue;
    groups[g.key].push({ lead: l, excluded: exclusionOf(l) });
  }
  // Freshest first: most recent booking (or newest lead).
  for (const k of Object.keys(groups) as GroupKey[]) {
    groups[k].sort((a, b) => (b.lead.lastPaidAt ?? b.lead.joinedAt).getTime() - (a.lead.lastPaidAt ?? a.lead.joinedAt).getTime());
  }
  return { groups };
}

/** Values for {{1}}..{{n}}; any variable not configured falls back to the first name ({{1}}) or "". */
export function variablesFor(config: GroupConfig, lead: LeadFacts, variableCount = config.variables.length): string[] {
  return Array.from({ length: Math.max(variableCount, config.variables.length) }, (_, i) => {
    const v = config.variables[i] ?? (i === 0 ? { source: "first_name" as const } : { source: "fixed" as const, text: "" });
    if (v.source === "fixed") return v.text ?? "";
    return VARIABLE_SOURCES.find((s) => s.key === v.source)!.sample(lead);
  });
}

/** Fill {{n}} in a template's text, for previews. */
export function renderTemplate(text: string, values: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[Number(n) - 1] || `{{${n}}}`);
}

// ---------- Sending ----------

export interface RunResult {
  group: GroupKey;
  isTest: boolean;
  attempted: number;
  sent: number;
  failed: number;
  skippedReason?: string;
  errors: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

/**
 * Send one group's nudge. In test mode: ONE message, to the test number only,
 * filled with the first eligible customer's details. Otherwise: every eligible
 * customer, up to perRunLimit.
 */
export async function runGroup(
  group: GroupKey,
  opts: { trigger: "manual" | "automatic"; userId: string | null; settings?: NudgeSettings; templates?: AnantyaTemplate[] }
): Promise<RunResult> {
  const settings = opts.settings ?? (await getNudgeSettings());
  const config = settings.groups[group];
  const base: RunResult = { group, isTest: settings.testMode, attempted: 0, sent: 0, failed: 0, errors: [] };

  if (!config.enabled) return { ...base, skippedReason: "This group is switched off." };
  if (!config.templateId) return { ...base, skippedReason: "No template chosen for this group." };
  if (settings.testMode && !/^\d{10}$/.test(settings.testNumber)) return { ...base, skippedReason: "Test mode is on but no valid 10-digit test number is saved." };

  const templates = opts.templates ?? (await getTemplates());
  const template = templates.find((t) => t.id === config.templateId);
  if (!template) return { ...base, skippedReason: `Template #${config.templateId} was not found in Anantya.` };

  const { groups } = await buildAudience(settings);
  const eligible = groups[group].filter((r) => !r.excluded).map((r) => r.lead);

  const log = (data: { customerId: string | null; phone: string; ok: boolean; error: string | null; response: string; isTest: boolean }) =>
    prisma.whatsAppMessage.create({
      data: {
        customerId: data.customerId,
        phone: data.phone,
        group,
        templateId: template.id,
        templateName: template.name,
        isTest: data.isTest,
        trigger: opts.trigger,
        status: data.ok ? "SENT" : "FAILED",
        error: data.error,
        response: data.response || null,
        sentById: opts.userId,
      },
    });

  if (settings.testMode) {
    const sample = eligible[0];
    const variables = sample
      ? variablesFor(config, sample, template.variableCount)
      : Array.from({ length: Math.max(template.variableCount, config.variables.length) }, (_, i) => (config.variables[i]?.source === "fixed" ? config.variables[i].text ?? "" : "Test"));
    const r = await sendTemplate({ templateId: template.id, phone: settings.testNumber, name: sample?.name ?? "Test", variables });
    await log({ customerId: null, phone: settings.testNumber, ok: r.ok, error: r.error, response: r.response, isTest: true });
    return { ...base, attempted: 1, sent: r.ok ? 1 : 0, failed: r.ok ? 0 : 1, errors: r.error ? [r.error] : [] };
  }

  const batch = eligible.slice(0, settings.perRunLimit);
  const results = await mapLimit(batch, 4, async (lead) => {
    const r = await sendTemplate({ templateId: template.id, phone: lead.phone, name: lead.name ?? "", variables: variablesFor(config, lead, template.variableCount) });
    await log({ customerId: lead.id, phone: lead.phone, ok: r.ok, error: r.error, response: r.response, isTest: false });
    if (r.ok) {
      // Shows on the customer's timeline.
      await prisma.activityLog.create({
        data: {
          customerId: lead.id,
          userId: opts.userId,
          activityType: "NOTE_ADDED",
          note: `WhatsApp nudge sent (${GROUPS.find((g) => g.key === group)!.label}): template "${template.name}"${opts.trigger === "automatic" ? " - automatic" : ""}`,
        },
      });
    }
    return r;
  });
  const errors = Array.from(new Set(results.filter((r) => !r.ok).map((r) => r.error ?? "Failed"))).slice(0, 5);
  return {
    ...base,
    attempted: batch.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    errors,
  };
}
