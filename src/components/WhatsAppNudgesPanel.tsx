"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type VariableSourceKey = "first_name" | "full_name" | "last_salon" | "last_visit" | "visits" | "city" | "fixed";
interface VariableConfig {
  source: VariableSourceKey;
  text?: string;
}
interface GroupConfig {
  enabled: boolean;
  templateId: number | null;
  variables: VariableConfig[];
}
export interface PanelSettings {
  mode: "manual" | "automatic";
  testMode: boolean;
  testNumber: string;
  cooldownDays: number;
  perRunLimit: number;
  excludeSalons: string[];
  rotationIndex: number;
  groups: Record<string, GroupConfig>;
}
export interface PanelTemplate {
  id: number;
  name: string;
  status: string | null;
  isActive: boolean;
  text: string;
  variableCount: number;
}
export interface PanelGroup {
  key: string;
  label: string;
  help: string;
  total: number;
  eligible: number;
  excluded: { label: string; count: number }[];
  sample: { name: string; values: Record<string, string> } | null;
  round: { round: number; total: number; covered: number; remaining: number; nextBatch: number; startsNewRound: boolean };
}

const SOURCES: { key: VariableSourceKey; label: string }[] = [
  { key: "first_name", label: "Customer first name" },
  { key: "full_name", label: "Customer full name" },
  { key: "last_salon", label: "Last salon booked" },
  { key: "last_visit", label: "Last visit date" },
  { key: "visits", label: "Number of visits" },
  { key: "city", label: "City" },
  { key: "fixed", label: "Fixed text…" },
];

const render = (text: string, values: string[]) => text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => values[Number(n) - 1] || `{{${n}}}`);

export default function WhatsAppNudgesPanel({
  initial,
  templates,
  templatesError,
  groups,
  configured,
  salonOptions,
  nextAutomatic,
  blockedCount,
}: {
  initial: PanelSettings;
  templates: PanelTemplate[];
  templatesError: string | null;
  groups: PanelGroup[];
  configured: boolean;
  salonOptions: string[];
  nextAutomatic: string | null;
  blockedCount: number;
}) {
  const [salonSearch, setSalonSearch] = useState("");
  const router = useRouter();
  const [s, setS] = useState<PanelSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  const update = (patch: Partial<PanelSettings>) => {
    setS((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const updateGroup = (key: string, patch: Partial<GroupConfig>) => {
    setS((p) => ({ ...p, groups: { ...p.groups, [key]: { ...p.groups[key], ...patch } } }));
    setDirty(true);
  };

  async function save(next: PanelSettings = s) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/whatsapp/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setS(data.settings);
      setDirty(false);
      setMsg({ ok: true, text: "Settings saved." });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function send(g: PanelGroup) {
    const cfg = s.groups[g.key];
    const tpl = templates.find((t) => t.id === cfg.templateId);
    if (dirty) {
      setMsg({ ok: false, text: "Save your changes first." });
      return;
    }
    const question = s.testMode
      ? `TEST MODE: send ONE "${tpl?.name}" message for "${g.label}" to the test number ${s.testNumber}?\n\nNo customer will receive anything.`
      : `Send "${tpl?.name}" to ${Math.min(g.eligible, s.perRunLimit).toLocaleString("en-IN")} REAL customers in "${g.label}"?\n\nThis messages real customers on WhatsApp and cannot be undone.`;
    if (!window.confirm(question)) return;
    setSending(g.key);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/whatsapp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ group: g.key }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      if (data.skippedReason) setMsg({ ok: false, text: data.skippedReason });
      else
        setMsg({
          ok: data.failed === 0,
          text:
            (data.isTest ? "Test message: " : "") +
            `${data.sent} sent, ${data.failed} failed` +
            (data.errors?.length ? ` - ${data.errors.join("; ")}` : "") +
            (data.isTest ? `. Check WhatsApp on ${s.testNumber}.` : "."),
        });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---------- Mode ---------- */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Sending mode</p>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-slate-50">
              {(["manual", "automatic"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => update({ mode: m })}
                  className={"px-4 py-1.5 text-sm rounded-md font-medium " + (s.mode === m ? "bg-white shadow text-gray-900" : "text-slate-500 hover:text-slate-800")}
                >
                  {m === "manual" ? "Manual" : "Automatic"}
                </button>
              ))}
            </div>
            {s.mode === "automatic" && (
              <p className="text-xs font-medium text-blue-700 mt-2">Next rotation list: {nextAutomatic ?? "none - switch on a count list and pick its template"}</p>
            )}
            <p className="text-xs text-slate-500 mt-2">
              {s.mode === "manual"
                ? "Nothing is sent until an admin previews a group and clicks Send."
                : "Every day (about 10:00 AM India time): the \"Last booking 25 days ago\" list + ONE count list on rotation (1 time → 2 times → 3-4 times → Frequent → Never booked)."}
            </p>
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Test mode</p>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={s.testMode}
                onChange={(e) => {
                  if (!e.target.checked && !window.confirm("Turn test mode OFF?\n\nAfter saving, sends will go to REAL customers.")) return;
                  update({ testMode: e.target.checked });
                }}
                className="w-4 h-4"
              />
              <span className={"text-sm font-semibold " + (s.testMode ? "text-amber-700" : "text-emerald-700")}>
                {s.testMode ? "ON - only the test number gets messages" : "OFF - real customers get messages"}
              </span>
            </label>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-slate-500">Test number</span>
              <input
                value={s.testNumber}
                onChange={(e) => update({ testNumber: e.target.value })}
                placeholder="10-digit number"
                inputMode="numeric"
                className="border border-gray-300 rounded-lg px-2 py-1 text-sm w-36 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Cooldown (days)</span>
              <input
                type="number"
                min={1}
                max={60}
                value={s.cooldownDays}
                onChange={(e) => update({ cooldownDays: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <span className="text-[11px] text-slate-400">max one nudge per customer in this many days</span>
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Max per group per run</span>
              <input
                type="number"
                min={1}
                max={500}
                value={s.perRunLimit}
                onChange={(e) => update({ perRunLimit: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <span className="text-[11px] text-slate-400">the rest go in the next run</span>
            </label>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Never nudge customers of these salons</p>
          <p className="text-xs text-slate-500 mb-2">
            Anyone who ever ordered at a ticked salon (any payment status) is left out of every list.{" "}
            {s.excludeSalons.length > 0 ? <b>{s.excludeSalons.length} selected: {s.excludeSalons.join(", ")}</b> : "None selected."}
          </p>
          <input
            value={salonSearch}
            onChange={(e) => setSalonSearch(e.target.value)}
            placeholder="Search salons"
            className="w-full md:w-80 border border-gray-300 rounded-lg px-2 py-1 text-sm mb-2"
          />
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1">
            {salonOptions
              .filter((n) => n.toLowerCase().includes(salonSearch.trim().toLowerCase()))
              .map((n) => (
                <label key={n} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={s.excludeSalons.includes(n)}
                    onChange={(e) => update({ excludeSalons: e.target.checked ? [...s.excludeSalons, n] : s.excludeSalons.filter((x) => x !== n) })}
                  />
                  <span className="truncate">{n}</span>
                </label>
              ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {blockedCount.toLocaleString("en-IN")} customers are in &ldquo;Do not nudge&rdquo; (Not Interested, Do Not Contact, Invalid Number or opted out) and are never messaged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t">
          <button
            type="button"
            onClick={() => save()}
            disabled={saving || !dirty}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : dirty ? "Save settings" : "Saved"}
          </button>
          {msg && <span className={"text-sm " + (msg.ok ? "text-emerald-700" : "text-red-600")}>{msg.text}</span>}
        </div>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <b>Anantya API key missing.</b> Add <code className="bg-amber-100 px-1 rounded">ANANTYA_API_KEY</code> to this server&apos;s environment variables
          (Vercel → Settings → Environment Variables, or the AWS <code>.env</code>), then redeploy / restart.
        </div>
      )}
      {templatesError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <b>Couldn&apos;t load templates from Anantya:</b> {templatesError}
        </div>
      )}

      {/* ---------- Groups ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {groups.map((g) => {
          const cfg = s.groups[g.key] ?? { enabled: false, templateId: null, variables: [] };
          const tpl = templates.find((t) => t.id === cfg.templateId);
          const vars: VariableConfig[] = Array.from({ length: tpl?.variableCount ?? 0 }, (_, i) => cfg.variables[i] ?? { source: i === 0 ? "first_name" : "fixed", text: "" });
          const values = vars.map((v) => (v.source === "fixed" ? v.text ?? "" : g.sample?.values[v.source] ?? ""));
          const approved = !tpl || /approved/i.test(tpl.status ?? "approved");
          return (
            <div key={g.key} className={"bg-white rounded-2xl border shadow-sm p-5 " + (cfg.enabled ? "border-emerald-200" : "border-gray-200")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{g.label}</h3>
                  <p className="text-xs text-slate-500">{g.help}</p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={cfg.enabled} onChange={(e) => updateGroup(g.key, { enabled: e.target.checked })} className="w-4 h-4" />
                  {cfg.enabled ? <span className="text-emerald-700 font-medium">On</span> : <span className="text-slate-500">Off</span>}
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-lg font-bold text-gray-900">{g.total.toLocaleString("en-IN")}</p>
                  <p className="text-[11px] text-slate-500">in this group</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2">
                  <p className="text-lg font-bold text-emerald-700">{g.eligible.toLocaleString("en-IN")}</p>
                  <p className="text-[11px] text-emerald-700/80">can be nudged</p>
                </div>
                <div className="rounded-lg bg-rose-50 p-2">
                  <p className="text-lg font-bold text-rose-700">{(g.total - g.eligible).toLocaleString("en-IN")}</p>
                  <p className="text-[11px] text-rose-700/80">excluded</p>
                </div>
              </div>
              <div className="mt-2">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-gray-800">Round {g.round.round}</span>
                  <span className="text-slate-500">
                    {g.round.covered.toLocaleString("en-IN")} of {g.round.total.toLocaleString("en-IN")} covered · next batch {g.round.nextBatch.toLocaleString("en-IN")}
                    {g.round.startsNewRound ? " (starts round " + (g.round.round + 1) + ")" : ""}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: (g.round.total ? (100 * g.round.covered) / g.round.total : 0) + "%" }} />
                </div>
              </div>
              {g.excluded.length > 0 && (
                <p className="text-[11px] text-slate-500 mt-1.5">Excluded: {g.excluded.map((x) => `${x.label} ${x.count.toLocaleString("en-IN")}`).join(" · ")}</p>
              )}

              <label className="block mt-4">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">WhatsApp template (from Anantya)</span>
                <select
                  value={cfg.templateId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    const n = templates.find((t) => t.id === id)?.variableCount ?? 0;
                    // Start every variable with a sensible default so none is ever sent empty.
                    updateGroup(g.key, {
                      templateId: id,
                      variables: Array.from({ length: n }, (_, i) => (i === 0 ? { source: "first_name" as const } : { source: "fixed" as const, text: "" })),
                    });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="">- choose a template -</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.status ? ` (${t.status})` : ""}
                      {!t.isActive ? " - inactive" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {tpl && !approved && <p className="text-xs text-amber-700 mt-1">This template is &ldquo;{tpl.status}&rdquo;, not approved - WhatsApp may reject it.</p>}

              {vars.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fill the template&apos;s variables</p>
                  {vars.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-500 w-10">{`{{${i + 1}}}`}</span>
                      <select
                        value={v.source}
                        onChange={(e) => {
                          const next = [...vars];
                          next[i] = { source: e.target.value as VariableSourceKey, text: next[i].text };
                          updateGroup(g.key, { variables: next });
                        }}
                        className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      >
                        {SOURCES.map((x) => (
                          <option key={x.key} value={x.key}>{x.label}</option>
                        ))}
                      </select>
                      {v.source === "fixed" && (
                        <input
                          value={v.text ?? ""}
                          onChange={(e) => {
                            const next = [...vars];
                            next[i] = { source: "fixed", text: e.target.value };
                            updateGroup(g.key, { variables: next });
                          }}
                          placeholder="text"
                          className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {tpl && (
                <div className="mt-3 rounded-xl bg-[#e7f8e9] border border-emerald-100 p-3">
                  <p className="text-[11px] font-semibold text-emerald-800 mb-1">
                    Preview{g.sample ? ` (as ${g.sample.name} would see it)` : ""}
                  </p>
                  <p className="text-sm text-gray-800 whitespace-pre-line">{render(tpl.text, values) || "(template has no text)"}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                <button
                  type="button"
                  disabled={!configured || !cfg.enabled || !tpl || sending !== null}
                  onClick={() => send(g)}
                  className={
                    "px-3 py-1.5 text-sm rounded-lg font-medium disabled:opacity-40 " +
                    (s.testMode ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-emerald-600 text-white hover:bg-emerald-700")
                  }
                  title={!cfg.enabled ? "Switch this group on first" : !tpl ? "Choose a template first" : undefined}
                >
                  {sending === g.key
                    ? "Sending…"
                    : s.testMode
                      ? `Send test to ${s.testNumber || "test number"}`
                      : `Approve & send to next ${Math.min(g.eligible, s.perRunLimit).toLocaleString("en-IN")}`}
                </button>
                <Link href={`/admin/whatsapp?group=${g.key}#preview`} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-slate-700 hover:bg-slate-50">
                  Preview who gets it
                </Link>
                <Link href={`/admin/whatsapp/lists?list=${g.key}`} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-slate-700 hover:bg-slate-50">
                  Full list
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
