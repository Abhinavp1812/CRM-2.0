"use client";

import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import Layout from "@/components/Layout";
import Link from "next/link";

interface CommitResponse {
  success: boolean;
  totalRows: number;
  newBookingCount?: number;
  duplicateOrderCount?: number;
  upgradedCustomerCount?: number;
  autoAssignedCount?: number;
  agentBreakdown?: { agentId: string; agentName: string; count: number }[];
  skipCount: number;
  errorCount: number;
  followupsCreated?: number;
  followupsUpdated?: number;
  followupsSkipped?: number;
  errors: { row: number; reason: string; data: Record<string, unknown> }[];
}

function downloadErrorReport(errors: CommitResponse["errors"], filename: string) {
  const rows = errors.map((e) => ({ Row: e.row, Reason: e.reason, ...e.data }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, filename);
}

export default function BookingsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorFilter, setErrorFilter] = useState("");

  // Follow-up days setting
  const [followupDays, setFollowupDays] = useState<number>(20);
  const [savingDays, setSavingDays] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.bookingFollowupDays) setFollowupDays(parseInt(data.bookingFollowupDays, 10));
      })
      .catch(() => {});
  }, []);

  async function saveFollowupDays(days: number) {
    if (!days || days < 1) return;
    setSavingDays(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "bookingFollowupDays", value: String(days) }),
      });
    } finally {
      setSavingDays(false);
    }
  }

  async function handleFileChange(f: File | null) {
    setFile(f);
    setSheetName(null);
    setSheetOptions([]);
    setResult(null);
    setError(null);
    setErrorFilter("");
    if (!f) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/admin/import/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Parse failed");
      setSheetOptions(data.sheets.map((s: { sheetName: string }) => s.sheetName));
      if (data.sheets.length === 1) setSheetName(data.sheets[0].sheetName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }

  async function handleCommit() {
    if (!file || !sheetName) return;
    setCommitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sheetName", sheetName);
      const res = await fetch("/api/admin/import/bookings/commit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  const filteredErrors = result?.errors.filter((e) => {
    if (!errorFilter) return true;
    const q = errorFilter.toLowerCase();
    const name = String(e.data?.Name ?? e.data?.name ?? "").toLowerCase();
    const phone = String(e.data?.Phone ?? e.data?.Mobile ?? e.data?.phone ?? e.data?.mobile ?? "");
    return e.reason.toLowerCase().includes(q) || name.includes(q) || phone.includes(q);
  }) ?? [];

  return (
    <Layout>
      <div className="mb-6">
        <Link href="/admin/imports" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors mb-2">← Imports</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Import Bookings</h1>
      </div>

      {/* Follow-up days setting */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 shadow-sm">
        <p className="text-sm font-semibold text-amber-900 mb-2">Follow-up days after booking date</p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min="1"
            max="365"
            value={followupDays}
            onChange={(e) => setFollowupDays(Number(e.target.value))}
            onBlur={(e) => saveFollowupDays(Number(e.target.value))}
            className="w-24 border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
            disabled={savingDays}
          />
          <span className="text-sm text-amber-700">
            {savingDays ? "Saving…" : "days after booking date"}
          </span>
        </div>
      </div>

      {!result && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
          <div className="mb-5">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">1. Choose CSV or XLSX file</label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              className="block w-full text-sm border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              disabled={parsing || committing}
            />
            {file && <p className="text-xs text-slate-500 mt-1.5">Selected: <span className="font-medium text-slate-700">{file.name}</span></p>}
            {parsing && <p className="text-sm text-blue-600 mt-2">Parsing…</p>}
          </div>

          {sheetOptions.length > 1 && (
            <div className="mb-5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">2. Choose sheet</label>
              <select
                value={sheetName || ""}
                onChange={(e) => setSheetName(e.target.value)}
                className="block w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select sheet —</option>
                {sheetOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
          )}

          {sheetName && (
            <button
              onClick={handleCommit}
              disabled={committing}
              className="inline-flex items-center px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {committing ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 shadow-sm">
          <p className="text-sm text-red-800 font-medium">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Import complete</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <ResultStat label="New Bookings" value={result.newBookingCount || 0} color="green" />
            <ResultStat label="Duplicate Orders" value={result.duplicateOrderCount || 0} color="amber" />
            <ResultStat label="Customers Upgraded" value={result.upgradedCustomerCount || 0} color="blue" />
            <ResultStat label="Skipped" value={result.skipCount} color="amber" />
            <ResultStat label="Followups Created" value={result.followupsCreated || 0} color="green" />
            <ResultStat label="Followups Updated" value={result.followupsUpdated || 0} color="blue" />
            <ResultStat label="Followups Kept" value={result.followupsSkipped || 0} color="gray" />
            <ResultStat label="Errors" value={result.errorCount} color="red" />
          </div>

          {result.autoAssignedCount && result.autoAssignedCount > 0 && result.agentBreakdown && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
              <h3 className="font-semibold text-blue-900 mb-2">
                Auto-assigned via round-robin: {result.autoAssignedCount} new customers
              </h3>
              <div className="space-y-1">
                {result.agentBreakdown.map((a) => (
                  <div key={a.agentId} className="flex justify-between text-sm">
                    <span className="text-blue-800">{a.agentName}</span>
                    <span className="font-semibold text-blue-700">{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="mb-5 border border-red-200 rounded-xl overflow-hidden">
              <div className="bg-red-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-b border-red-200">
                <h3 className="text-sm font-semibold text-red-900">
                  {result.errorCount} error{result.errorCount !== 1 ? "s" : ""}
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Filter by name, phone, or reason…"
                    value={errorFilter}
                    onChange={(e) => setErrorFilter(e.target.value)}
                    className="text-sm border border-red-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-400 w-52 bg-white"
                  />
                  <button
                    onClick={() => downloadErrorReport(result.errors, `errors-${file?.name ?? "import"}.xlsx`)}
                    className="text-xs px-3 py-1.5 bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 whitespace-nowrap font-medium"
                  >
                    Download XLSX
                  </button>
                </div>
              </div>
              <div className="overflow-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 sticky top-0 border-b border-red-200">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-red-800 uppercase tracking-wide">Row</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-red-800 uppercase tracking-wide">Reason</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-red-800 uppercase tracking-wide">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-red-800 uppercase tracking-wide">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {filteredErrors.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-sm text-slate-400">No errors match the filter.</td>
                      </tr>
                    ) : filteredErrors.map((e) => (
                      <tr key={e.row} className="hover:bg-red-50 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.row}</td>
                        <td className="px-3 py-2 text-red-800 text-xs">{e.reason}</td>
                        <td className="px-3 py-2 text-slate-700 text-xs">{String(e.data?.Name ?? e.data?.name ?? "-")}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-600">
                          {String(e.data?.Phone ?? e.data?.Mobile ?? e.data?.phone ?? e.data?.mobile ?? "-")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setFile(null); setSheetName(null); setSheetOptions([]); setErrorFilter(""); }}
            className="inline-flex items-center px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            Import another file
          </button>
        </div>
      )}
    </Layout>
  );
}

function ResultStat({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "blue" | "green" | "gray" }) {
  const colors = {
    red: "bg-red-50 border-red-100 text-red-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    gray: "bg-slate-50 border-slate-100 text-slate-600",
  };
  return (
    <div className={"rounded-xl p-3 border shadow-sm " + colors[color]}>
      <p className="text-xs uppercase tracking-wide font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
