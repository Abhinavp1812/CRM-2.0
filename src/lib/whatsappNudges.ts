import { prisma } from "@/lib/prisma";
import { loadInsights, type LeadFacts } from "@/lib/insights";
import { getTemplates, sendTemplate, type AnantyaTemplate } from "@/lib/anantya";
import { buildNudgeLists, NUDGE_LISTS } from "@/lib/nudgeLists";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";

/**
 * WhatsApp nudges via Anantya.ai - sending side of Admin > WhatsApp.
 *
 * The groups ARE the Customer lists (lib/nudgeLists.ts), so what you see in a
 * list is exactly who can be messaged:
 *   last25 · never · one · two · three (3-4) · frequent
 * Each group can have its own approved WhatsApp template.
 *
 * Automatic mode, once a day: the "last booking 25 days ago" list + ONE count
 * list on rotation (1 time -> 2 times -> 3-4 times -> frequent -> never booked).
 * Each batch goes to people never nudged first, then the longest-ago nudged, so
 * nobody gets a second nudge until everyone in that list has had one.
 *
 * Safety rules, enforced here for EVERY send (manual or automatic):
 * - Test mode (on by default): ONE message per send, to the test number only.
 * - "Do not nudge" customers (opted out, Do Not Contact, latest remark Not
 *   Interested / Invalid) are never in a group; excluded salons are left out.
 * - Nobody gets more than one real nudge per cooldown period.
 * - At most `perRunLimit` customers per group per run.
 */

export const GROUPS = NUDGE_LISTS.filter((l) => l.key !== "blocked").map((l) => ({ key: l.key, label: l.label, help: l.help })) as {
  key: GroupKey;
  label: string;
  help: string;
}[];
export type GroupKey = "last25" | "never" | "one" | "two" | "three" | "frequent";
export const isGroupKey = (v: unknown): v is GroupKey => GROUPS.some((g) => g.key === v);

/** Automatic mode sends last25 every day plus one of these, in turn. */
export const ROTATION: GroupKey[] = ["one", "two", "three", "frequent", "never"];

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
  /** Anyone who ever ordered at one of these salons is never nudged. */
  excludeSalons: string[];
  /** Position in ROTATION for the next automatic run. */
  rotationIndex: number;
  groups: Record<GroupKey, GroupConfig>;
}

const KEY = "whatsapp.settings";
const DEFAULT_GROUP: GroupConfig = { enabled: false, templateId: null, variables: [] };
const defaultGroups = (): Record<GroupKey, GroupConfig> =>
  Object.fromEntries(GROUPS.map((g) => [g.key, { ...DEFAULT_GROUP }])) as Record<GroupKey, GroupConfig>;
export const DEFAULT_SETTINGS: NudgeSettings = {
  mode: "manual",
  testMode: true,
  testNumber: "",
  cooldownDays: 7,
  perRunLimit: 40,
  excludeSalons: [],
  rotationIndex: 0,
  groups: defaultGroups(),
};

export async function getNudgeSettings(): Promise<NudgeSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return { ...DEFAULT_SETTINGS, groups: defaultGroups() };
  try {
    const s = JSON.parse(row.value) as Partial<NudgeSettings>;
    const groups = defaultGroups();
    for (const g of GROUPS) if (s.groups?.[g.key]) groups[g.key] = s.groups[g.key];
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      // Test mode stays on unless it was explicitly switched off.
      testMode: s.testMode !== false,
      excludeSalons: Array.isArray(s.excludeSalons) ? s.excludeSalons : [],
      rotationIndex: Number.isInteger(s.rotationIndex) ? (s.rotationIndex as number) : 0,
      groups,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, groups: defaultGroups() };
  }
}

export async function saveNudgeSettings(s: NudgeSettings): Promise<void> {
  const clean: NudgeSettings = {
    mode: s.mode === "automatic" ? "automatic" : "manual",
    testMode: s.testMode !== false,
    testNumber: (s.testNumber ?? "").replace(/\D/g, "").slice(-10),
    cooldownDays: Math.min(60, Math.max(1, Math.round(Number(s.cooldownDays) || 7))),
    perRunLimit: Math.min(500, Math.max(1, Math.round(Number(s.perRunLimit) || 40))),
    excludeSalons: (Array.isArray(s.excludeSalons) ? s.excludeSalons : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 50),
    rotationIndex: Math.max(0, Math.round(Number(s.rotationIndex) || 0)) % ROTATION.length,
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
  cooldown: "Already nudged recently",
} as const;
export type ExclusionKey = keyof typeof EXCLUSIONS;

export interface AudienceRow {
  lead: LeadFacts;
  excluded: ExclusionKey | null;
  lastNudgedAt: Date | null;
}

/**
 * Who is in each group today (from the Customer lists, re-engage date = today)
 * and who is held back by the cooldown. Rows are in SEND order: never nudged
 * first, then longest-ago nudged, then by phone so the order is stable.
 */
export async function buildAudience(
  settings: NudgeSettings
): Promise<{ groups: Record<GroupKey, AudienceRow[]>; blocked: number; salonOptions: string[] }> {
  const since = Date.now() - settings.cooldownDays * 86_400_000;
  const [{ leads }, optOuts, nudges] = await Promise.all([
    loadInsights(),
    prisma.whatsAppOptOut.findMany({ select: { customerId: true } }),
    prisma.whatsAppMessage.groupBy({
      by: ["customerId"],
      where: { isTest: false, status: "SENT", customerId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);
  const lastNudged = new Map(nudges.filter((n) => n.customerId && n._max.createdAt).map((n) => [n.customerId!, n._max.createdAt!]));
  const today = todayIsoIST();
  const { lists } = buildNudgeLists(leads, {
    optedOut: new Set(optOuts.map((o) => o.customerId)),
    excludeSalons: settings.excludeSalons,
    reengageFrom: today,
    reengageTo: today,
  });

  const groups = Object.fromEntries(
    GROUPS.map((g) => {
      const rows: AudienceRow[] = lists[g.key].map(({ lead }) => {
        const at = lastNudged.get(lead.id) ?? null;
        return { lead, lastNudgedAt: at, excluded: at && at.getTime() >= since ? "cooldown" : null };
      });
      rows.sort(sendOrder);
      return [g.key, rows];
    })
  ) as Record<GroupKey, AudienceRow[]>;

  // Every salon anyone has ordered at, most used first (for the exclusion picker).
  const salonCounts = new Map<string, number>();
  for (const l of leads) for (const s of l.salonsEver) salonCounts.set(s, (salonCounts.get(s) ?? 0) + 1);
  const salonOptions = Array.from(salonCounts).sort((a, b) => b[1] - a[1]).map(([name]) => name);

  return { groups, blocked: lists.blocked.length, salonOptions };
}

/** Never nudged first, then the longest-ago nudged; phone as a stable tie-break. */
export function sendOrder(a: { lead: LeadFacts; lastNudgedAt: Date | null }, b: { lead: LeadFacts; lastNudgedAt: Date | null }): number {
  const ta = a.lastNudgedAt?.getTime() ?? 0;
  const tb = b.lastNudgedAt?.getTime() ?? 0;
  return ta - tb || a.lead.phone.localeCompare(b.lead.phone);
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

/** The count list automatic mode sends next (skipping groups that are off or have no template), or null. */
export function nextRotationGroup(settings: NudgeSettings): { group: GroupKey; index: number } | null {
  for (let i = 0; i < ROTATION.length; i++) {
    const index = (settings.rotationIndex + i) % ROTATION.length;
    const g = ROTATION[index];
    if (settings.groups[g].enabled && settings.groups[g].templateId) return { group: g, index };
  }
  return null;
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
 * filled with the first eligible customer's details. Otherwise: the next
 * `perRunLimit` eligible customers in send order.
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
  const label = GROUPS.find((g) => g.key === group)!.label;

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
      : Array.from({ length: Math.max(template.variableCount, config.variables.length) }, (_, i) =>
          config.variables[i]?.source === "fixed" ? config.variables[i].text ?? "" : "Test"
        );
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
          note: `WhatsApp nudge sent (${label}): template "${template.name}"${opts.trigger === "automatic" ? " - automatic" : ""}`,
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

/**
 * The daily automatic run: last25 (if switched on) + the next count list in
 * the rotation. Moves the rotation on by one after a run that sent (or tried).
 */
export async function runAutomatic(): Promise<{ results: RunResult[]; rotationGroup: GroupKey | null; testMode: boolean }> {
  const settings = await getNudgeSettings();
  const templates = await getTemplates();
  const results: RunResult[] = [];
  if (settings.groups.last25.enabled) {
    results.push(await runGroup("last25", { trigger: "automatic", userId: null, settings, templates }));
  }
  const next = nextRotationGroup(settings);
  if (next) {
    results.push(await runGroup(next.group, { trigger: "automatic", userId: null, settings, templates }));
    // Re-read so a settings change made during the run isn't overwritten.
    const latest = await getNudgeSettings();
    await saveNudgeSettings({ ...latest, rotationIndex: (next.index + 1) % ROTATION.length });
  }
  return { results, rotationGroup: next?.group ?? null, testMode: settings.testMode };
}
