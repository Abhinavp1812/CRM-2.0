import { prisma } from "@/lib/prisma";
import { loadInsights, type LeadFacts } from "@/lib/insights";
import { getTemplates, sendTemplate, type AnantyaTemplate } from "@/lib/anantya";
import { buildNudgeLists, NUDGE_LISTS } from "@/lib/nudgeLists";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { NUDGED_STATUSES, BATCH_TRIGGER } from "@/lib/whatsappStatus";

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
  /** Position in ROTATION for the next "Nudges for today" batch. */
  batchRotationIndex: number;
  /**
   * Per list: which round we're on and when it started. A customer nudged
   * (for real) since startedAt is "covered" this round; batches go only to
   * customers not yet covered until everyone is, then a new round starts.
   */
  rounds: Record<GroupKey, RoundState>;
  groups: Record<GroupKey, GroupConfig>;
}
export interface RoundState {
  number: number;
  /** ISO timestamp. */
  startedAt: string;
}
const FIRST_ROUND: RoundState = { number: 1, startedAt: "1970-01-01T00:00:00.000Z" };
const defaultRounds = (): Record<GroupKey, RoundState> =>
  Object.fromEntries(GROUPS.map((g) => [g.key, { ...FIRST_ROUND }])) as Record<GroupKey, RoundState>;

const KEY = "whatsapp.settings";
const DEFAULT_GROUP: GroupConfig = { enabled: false, templateId: null, variables: [] };
const defaultGroups = (): Record<GroupKey, GroupConfig> =>
  Object.fromEntries(GROUPS.map((g) => [g.key, { ...DEFAULT_GROUP }])) as Record<GroupKey, GroupConfig>;
export const DEFAULT_SETTINGS: NudgeSettings = {
  mode: "manual",
  testMode: true,
  testNumber: "",
  cooldownDays: 7,
  perRunLimit: 50,
  excludeSalons: [],
  rotationIndex: 0,
  batchRotationIndex: 0,
  rounds: defaultRounds(),
  groups: defaultGroups(),
};

export async function getNudgeSettings(): Promise<NudgeSettings> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  if (!row) return { ...DEFAULT_SETTINGS, rounds: defaultRounds(), groups: defaultGroups() };
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
      batchRotationIndex: Number.isInteger(s.batchRotationIndex) ? (s.batchRotationIndex as number) : 0,
      rounds: { ...defaultRounds(), ...(s.rounds ?? {}) },
      groups,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, rounds: defaultRounds(), groups: defaultGroups() };
  }
}

export async function saveNudgeSettings(s: NudgeSettings): Promise<void> {
  const clean: NudgeSettings = {
    mode: s.mode === "automatic" ? "automatic" : "manual",
    testMode: s.testMode !== false,
    testNumber: (s.testNumber ?? "").replace(/\D/g, "").slice(-10),
    cooldownDays: Math.min(60, Math.max(1, Math.round(Number(s.cooldownDays) || 7))),
    perRunLimit: Math.min(500, Math.max(1, Math.round(Number(s.perRunLimit) || 50))),
    excludeSalons: (Array.isArray(s.excludeSalons) ? s.excludeSalons : [])
      .map((x) => String(x).trim())
      .filter(Boolean)
      .slice(0, 50),
    rotationIndex: Math.max(0, Math.round(Number(s.rotationIndex) || 0)) % ROTATION.length,
    batchRotationIndex: Math.max(0, Math.round(Number(s.batchRotationIndex) || 0)) % ROTATION.length,
    rounds: Object.fromEntries(
      GROUPS.map((g) => {
        const r = s.rounds?.[g.key];
        const startedAt = r && !isNaN(Date.parse(r.startedAt)) ? new Date(r.startedAt).toISOString() : FIRST_ROUND.startedAt;
        return [g.key, { number: Math.max(1, Math.round(Number(r?.number) || 1)), startedAt }];
      })
    ) as Record<GroupKey, RoundState>,
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
  /** Already nudged (for real) in this list's current round. */
  covered: boolean;
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
  // The WhatsApp tables are read defensively so the lists, counts and salon
  // picker still work before the database update has created them.
  const [{ leads }, optOuts, nudges] = await Promise.all([
    loadInsights(),
    prisma.whatsAppOptOut.findMany({ select: { customerId: true } }).catch(() => [] as { customerId: string }[]),
    prisma.whatsAppMessage
      .groupBy({
        by: ["customerId"],
        where: { isTest: false, status: { in: NUDGED_STATUSES }, customerId: { not: null } },
        _max: { createdAt: true },
      })
      .catch(() => [] as { customerId: string | null; _max: { createdAt: Date | null } }[]),
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
      const roundStart = Date.parse(settings.rounds[g.key].startedAt);
      const rows: AudienceRow[] = lists[g.key].map(({ lead }) => {
        const at = lastNudged.get(lead.id) ?? null;
        return {
          lead,
          lastNudgedAt: at,
          covered: !!at && at.getTime() >= roundStart,
          excluded: at && at.getTime() >= since ? "cooldown" : null,
        };
      });
      // Queue order: not yet covered this round first, then never-nudged / longest-ago.
      rows.sort((a, b) => Number(a.covered) - Number(b.covered) || sendOrder(a, b));
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

/**
 * Who the next batch comes from: customers not yet nudged this round (and not
 * in cooldown). When everyone eligible is covered, the next send starts a new
 * round with the whole list again.
 */
export function roundQueue(rows: AudienceRow[]): { candidates: LeadFacts[]; startsNewRound: boolean } {
  const eligible = rows.filter((r) => !r.excluded);
  const notCovered = eligible.filter((r) => !r.covered);
  if (notCovered.length === 0 && eligible.length > 0) return { candidates: eligible.map((r) => r.lead), startsNewRound: true };
  return { candidates: notCovered.map((r) => r.lead), startsNewRound: false };
}

/** Round progress for a list card: covered = nudged this round. */
export function roundProgress(rows: AudienceRow[], round: RoundState, perRunLimit: number) {
  const covered = rows.filter((r) => r.covered).length;
  const q = roundQueue(rows);
  return {
    round: round.number,
    total: rows.length,
    covered,
    remaining: rows.length - covered,
    nextBatch: Math.min(perRunLimit, q.candidates.length),
    startsNewRound: q.startsNewRound,
  };
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

  // Never send anything that can't be logged - the log is what enforces the cooldown.
  const tablesReady = await prisma.whatsAppMessage.count({ take: 1 }).then(
    () => true,
    () => false
  );
  if (!tablesReady) return { ...base, skippedReason: "The WhatsApp message log isn't in the database yet - redeploy on Vercel so the database update runs." };
  if (!config.enabled) return { ...base, skippedReason: "This group is switched off." };
  if (!config.templateId) return { ...base, skippedReason: "No template chosen for this group." };
  if (settings.testMode && !/^\d{10}$/.test(settings.testNumber)) return { ...base, skippedReason: "Test mode is on but no valid 10-digit test number is saved." };

  const templates = opts.templates ?? (await getTemplates());
  const template = templates.find((t) => t.id === config.templateId);
  if (!template) return { ...base, skippedReason: `Template #${config.templateId} was not found in Anantya.` };

  const { groups } = await buildAudience(settings);
  const queue = roundQueue(groups[group]);
  const eligible = queue.candidates;
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
  // Everyone in the list has had this round's nudge -> start the next round now,
  // so these messages count towards it.
  if (queue.startsNewRound && batch.length > 0) {
    const latest = await getNudgeSettings();
    await saveNudgeSettings({
      ...latest,
      rounds: { ...latest.rounds, [group]: { number: latest.rounds[group].number + 1, startedAt: new Date().toISOString() } },
    });
  }
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

// ---------- "Nudges for today" (manual batches, like the WA Toolbox) ----------

/** Section order on the page and in Excel: the 25-days list, then the count lists. */
export const BATCH_SECTIONS: GroupKey[] = ["last25", "one", "two", "three", "frequent", "never"];

/**
 * Who goes in the next batch (like the WA Toolbox "Nudges for Today"):
 * - last25: everyone due today (not nudged within the cooldown), every time.
 * - ONE count list, in turn (1 time -> 2 times -> 3-4 times -> frequent ->
 *   never booked): the next `batchSize` from its round queue - customers not yet
 *   in this round's batches, never-nudged first. When the whole list has been
 *   covered, it starts the next round from the top. A list with nobody
 *   available today (all in cooldown) is skipped for the next one.
 */
export function planBatch(
  groups: Record<GroupKey, AudienceRow[]>,
  batchSize: number,
  rotationIndex: number
): { sections: Record<GroupKey, LeadFacts[]>; newRounds: GroupKey[]; category: GroupKey | null; categoryIndex: number } {
  const sections = Object.fromEntries(BATCH_SECTIONS.map((g) => [g, [] as LeadFacts[]])) as Record<GroupKey, LeadFacts[]>;
  sections.last25 = groups.last25.filter((r) => !r.excluded).map((r) => r.lead);
  for (let i = 0; i < ROTATION.length; i++) {
    const index = (((rotationIndex + i) % ROTATION.length) + ROTATION.length) % ROTATION.length;
    const g = ROTATION[index];
    const q = roundQueue(groups[g]);
    if (q.candidates.length === 0) continue;
    sections[g] = q.candidates.slice(0, batchSize);
    return { sections, newRounds: q.startsNewRound ? [g] : [], category: g, categoryIndex: index };
  }
  return { sections, newRounds: [], category: null, categoryIndex: rotationIndex % ROTATION.length };
}

export interface BatchResult {
  /** ISO time of the batch (every row in it has this createdAt). */
  at: string | null;
  counts: Record<GroupKey, number>;
  /** The count list this batch came from. */
  category: GroupKey | null;
  newRounds: GroupKey[];
  skippedReason?: string;
}

/**
 * Generate the next batch: picks the customers (planBatch) and records each one
 * in the nudge log as LISTED, so they count as nudged - the next click gives the
 * next customers, and the cooldown keeps the CRM's own sending off them too.
 * Nothing is sent from here; the team sends from the Anantya platform.
 */
export async function generateBatch(userId: string | null): Promise<BatchResult> {
  const empty = Object.fromEntries(BATCH_SECTIONS.map((g) => [g, 0])) as Record<GroupKey, number>;
  const tablesReady = await prisma.whatsAppMessage.count({ take: 1 }).then(
    () => true,
    () => false
  );
  if (!tablesReady) return { at: null, counts: empty, category: null, newRounds: [], skippedReason: "The WhatsApp tables aren't in the database yet - click \"Create WhatsApp tables now\" on Settings & sending." };

  const settings = await getNudgeSettings();
  const { groups } = await buildAudience(settings);
  const { sections, newRounds, category, categoryIndex } = planBatch(groups, settings.perRunLimit, settings.batchRotationIndex);
  const total = BATCH_SECTIONS.reduce((n, g) => n + sections[g].length, 0);
  if (total === 0) return { at: null, counts: empty, category: null, newRounds: [], skippedReason: "Nobody to nudge right now - everyone is in the cooldown." };

  const at = new Date();
  {
    // Re-read so a settings change made meanwhile isn't overwritten. A new round's
    // startedAt = at, so this batch is the first of it. The next batch moves on to
    // the next list (only once a list was actually used).
    const latest = await getNudgeSettings();
    const rounds = { ...latest.rounds };
    for (const g of newRounds) rounds[g] = { number: rounds[g].number + 1, startedAt: at.toISOString() };
    await saveNudgeSettings({
      ...latest,
      rounds,
      batchRotationIndex: category ? (categoryIndex + 1) % ROTATION.length : latest.batchRotationIndex,
    });
  }
  await prisma.whatsAppMessage.createMany({
    data: BATCH_SECTIONS.flatMap((g) =>
      sections[g].map((lead) => ({
        customerId: lead.id,
        phone: lead.phone,
        group: g,
        templateId: 0,
        templateName: null,
        isTest: false,
        trigger: BATCH_TRIGGER,
        status: "LISTED",
        sentById: userId,
        createdAt: at,
      }))
    ),
  });
  return { at: at.toISOString(), counts: Object.fromEntries(BATCH_SECTIONS.map((g) => [g, sections[g].length])) as Record<GroupKey, number>, category, newRounds };
}

/** Past batches, newest first: when, and how many customers. */
export async function loadBatchHistory(take = 30): Promise<{ at: Date; count: number }[]> {
  const rows = await prisma.whatsAppMessage.groupBy({
    by: ["createdAt"],
    where: { trigger: BATCH_TRIGGER, status: "LISTED" },
    _count: { _all: true },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map((r) => ({ at: r.createdAt, count: r._count._all }));
}

/** Every customer in one batch. */
export function loadBatchRows(at: Date) {
  return prisma.whatsAppMessage.findMany({
    where: { trigger: BATCH_TRIGGER, status: "LISTED", createdAt: at },
    orderBy: { createdAt: "asc" },
    include: { customer: { select: { id: true, name: true } } },
  });
}

/** Undo a batch made by mistake: those customers go back to the front of their queues. */
export async function deleteBatch(at: Date): Promise<number> {
  const where = { trigger: BATCH_TRIGGER, status: "LISTED", createdAt: at };
  const used = await prisma.whatsAppMessage.findFirst({ where: { ...where, group: { in: ROTATION } }, select: { group: true } });
  const r = await prisma.whatsAppMessage.deleteMany({ where });
  // Give the turn back to the list this batch came from.
  const index = used ? ROTATION.indexOf(used.group as GroupKey) : -1;
  if (index >= 0) {
    const latest = await getNudgeSettings();
    await saveNudgeSettings({ ...latest, batchRotationIndex: index });
  }
  return r.count;
}
