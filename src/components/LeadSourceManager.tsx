"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface LeadSourceOption {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  customerCount: number;
}

interface ImportSummary {
  preview: boolean;
  tagged?: number;
  phoneColumn: string;
  rows: number;
  validPhones: number;
  invalidCount: number;
  invalidSamples: string[];
  matched: number;
  alreadyTagged: number;
  toTag: number;
  switching: number;
  switchedFrom: Record<string, number>;
  notFound: string[];
}

const customersHref = (label: string) => "/admin/customers?leadSource=" + encodeURIComponent(label);

export default function LeadSourceManager() {
  const [sources, setSources] = useState<LeadSourceOption[] | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/admin/lead-sources");
    const data = await res.json();
    if (res.ok) setSources(data.sources);
  }

  useEffect(() => {
    fetch("/api/admin/lead-sources")
      .then((res) => res.json())
      .then((data) => setSources(data.sources));
  }, []);

  async function addSource() {
    const label = newLabel.trim();
    if (!label) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lead-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setNewLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    setTogglingId(id);
    try {
      await fetch("/api/admin/lead-sources/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      await load();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Campaigns</h2>
        <p className="text-xs text-slate-500 mb-4">Click a campaign to see all its customers.</p>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSource()}
            placeholder="e.g. Pedicure Campaign"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={adding}
          />
          <button
            onClick={addSource}
            disabled={adding || !newLabel.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {!sources ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-slate-400">No lead sources yet - add one above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={customersHref(s.label)}
                  className={"text-sm hover:text-blue-700 hover:underline " + (s.isActive ? "text-gray-900" : "text-gray-400 line-through")}
                >
                  {s.label}
                </Link>
                <div className="flex items-center gap-3">
                  <Link href={customersHref(s.label)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                    {s.customerCount.toLocaleString()} customer{s.customerCount === 1 ? "" : "s"} &rarr;
                  </Link>
                  <button
                    onClick={() => toggleActive(s.id, s.isActive)}
                    disabled={togglingId === s.id}
                    className={
                      "text-xs px-2.5 h-7 rounded-lg border font-medium disabled:opacity-50 " +
                      (s.isActive
                        ? "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                        : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100")
                    }
                  >
                    {togglingId === s.id ? "…" : s.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CampaignImport sources={sources ?? []} onDone={load} />
    </div>
  );
}

function CampaignImport({ sources, onDone }: { sources: LeadSourceOption[]; onDone: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSummary(null);
    setError(null);
  }

  async function send(confirm: boolean) {
    if (!file || !label.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("label", label.trim());
      form.append("confirm", String(confirm));
      const res = await fetch("/api/admin/lead-sources/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setSummary(data);
      if (confirm) {
        setFile(null);
        setFileKey((k) => k + 1);
        await onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  function downloadNotFound(phones: string[]) {
    const blob = new Blob(["phone number\n" + phones.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `not-in-crm-${label.trim().replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const active = sources.filter((s) => s.isActive);

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 mb-1">Import campaign leads</h2>
      <p className="text-xs text-slate-500 mb-4">
        Upload an Excel or CSV file with a <b>phone number</b> column. Customers already in the CRM with those numbers get tagged
        with the campaign. Numbers that aren&apos;t in the CRM are listed, not added.
      </p>

      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Campaign</label>
      <input
        list="lead-source-options"
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          reset();
        }}
        placeholder="Pick one, or type a new campaign name"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        disabled={loading}
      />
      <datalist id="lead-source-options">
        {active.map((s) => (
          <option key={s.id} value={s.label} />
        ))}
      </datalist>

      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">File</label>
      <input
        key={fileKey}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          reset();
        }}
        className="block w-full text-sm text-gray-700 mb-4 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 file:text-sm file:font-medium hover:file:bg-slate-200"
        disabled={loading}
      />

      {!summary?.preview && (
        <button
          onClick={() => send(false)}
          disabled={loading || !file || !label.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Preview"}
        </button>
      )}

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {summary && (
        <div className={"mt-4 rounded-lg border p-4 text-sm " + (summary.preview ? "bg-slate-50 border-slate-200" : "bg-green-50 border-green-200")}>
          {!summary.preview && (
            <p className="font-semibold text-green-800 mb-2">
              Done. Tagged {summary.tagged?.toLocaleString()} customer{summary.tagged === 1 ? "" : "s"} as &ldquo;{label.trim()}&rdquo;.
            </p>
          )}
          <ul className="space-y-1 text-gray-700">
            <li>
              {summary.validPhones.toLocaleString()} valid phone numbers read from column &ldquo;{summary.phoneColumn}&rdquo;
              {summary.invalidCount > 0 && (
                <span className="text-amber-700">
                  {" "}
                  ({summary.invalidCount} skipped as invalid, e.g. {summary.invalidSamples.join(", ")})
                </span>
              )}
            </li>
            <li>
              <b>{summary.matched.toLocaleString()}</b> found in the CRM
              {summary.alreadyTagged > 0 && <span className="text-slate-500"> ({summary.alreadyTagged} already tagged with this campaign)</span>}
            </li>
            {summary.preview && (
              <li>
                <b>{summary.toTag.toLocaleString()}</b> will be tagged as &ldquo;{label.trim()}&rdquo;
              </li>
            )}
            {summary.switching > 0 && (
              <li className="text-amber-700">
                {summary.switching} {summary.preview ? "will be moved" : "were moved"} from another campaign:{" "}
                {Object.entries(summary.switchedFrom)
                  .map(([k, v]) => `${k} (${v})`)
                  .join(", ")}
              </li>
            )}
            <li>
              <b>{summary.notFound.length.toLocaleString()}</b> not in the CRM
              {summary.notFound.length > 0 && (
                <button onClick={() => downloadNotFound(summary.notFound)} className="ml-2 text-blue-600 hover:underline">
                  Download these numbers
                </button>
              )}
            </li>
          </ul>

          {summary.preview && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => send(true)}
                disabled={loading || summary.toTag === 0}
                className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading ? "Tagging…" : summary.toTag === 0 ? "Nothing to tag" : `Tag ${summary.toTag.toLocaleString()} customers`}
              </button>
              <button onClick={reset} disabled={loading} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50">
                Cancel
              </button>
            </div>
          )}
          {!summary.preview && (
            <Link href={customersHref(label.trim())} className="inline-block mt-3 text-blue-600 hover:underline">
              See all &ldquo;{label.trim()}&rdquo; customers &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
