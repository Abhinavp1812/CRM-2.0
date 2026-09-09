"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import Layout from "@/components/Layout";
import Link from "next/link";

interface CommitResponse {
  success: boolean;
  totalRows: number;
  updatedCount: number;
  createdCount: number;
  ownerUpdatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: { row: number; reason: string; data: Record<string, unknown> }[];
}

function downloadErrorReport(errors: CommitResponse["errors"], filename: string) {
  const rows = errors.map((e) => ({ Row: e.row, Reason: e.reason, ...e.data }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, filename);
}

export default function FollowupsImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(f: File | null) {
    setFile(f);
    setSheetName(null);
    setSheetOptions([]);
    setResult(null);
    setError(null);
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
      const res = await fetch("/api/admin/import/followups/commit", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Layout>
      <div className="mb-6">
        <Link href="/admin/imports" className="text-sm text-blue-600 hover:underline">← Back to Data Sync</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Import Combined Followups</h1>
        <p className="text-sm text-gray-500 mt-1">
          Imports next followup dates, remarks, notes and agent assignments from your existing spreadsheet.
          Run <strong>Registrations</strong> and <strong>Bookings</strong> imports first.
        </p>
      </div>

      {/* Column guide */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 text-sm text-blue-900">
        <p className="font-semibold mb-2">Expected columns (column names must match exactly):</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1 font-mono text-xs">
          <span>• Contact Number</span>
          <span>• Owner</span>
          <span>• Next Follow Up date</span>
          <span>• Remarks</span>
          <span>• Detailed Remarks</span>
        </div>
      </div>

      {!result && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">1. Choose your Combined Followups CSV or XLSX</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            className="block w-full text-sm border border-gray-200 rounded-md p-2"
            disabled={parsing || committing}
          />
          {file && <p className="text-xs text-gray-600 mt-1">Selected: {file.name}</p>}
          {parsing && <p className="text-sm text-blue-600 mt-2">Parsing...</p>}

          {sheetOptions.length > 1 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">2. Choose sheet</label>
              <select
                value={sheetName || ""}
                onChange={(e) => setSheetName(e.target.value)}
                className="block w-full text-sm border border-gray-200 rounded-md p-2"
              >
                <option value="">-- Select --</option>
                {sheetOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
          )}

          {sheetName && (
            <button
              onClick={handleCommit}
              disabled={committing}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {committing ? "Importing..." : "Import Followups"}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-green-700 mb-4">Import complete</h2>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Stat label="Followups Updated" value={result.updatedCount} color="blue" />
            <Stat label="Followups Created" value={result.createdCount} color="green" />
            <Stat label="Owners Assigned" value={result.ownerUpdatedCount} color="green" />
            <Stat label="Skipped" value={result.skippedCount} color="amber" />
            <Stat label="Errors" value={result.errorCount} color="red" />
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { setResult(null); setFile(null); setSheetName(null); setSheetOptions([]); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Import another file
            </button>
            {result.errors.length > 0 && (
              <button
                onClick={() => downloadErrorReport(result.errors, `followup-errors-${file?.name ?? "import"}.xlsx`)}
                className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100"
              >
                Download Error Report ({result.errorCount} rows)
              </button>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "blue" | "green" }) {
  const colors = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
  };
  return (
    <div className={"rounded-lg p-3 " + colors[color]}>
      <p className="text-xs uppercase tracking-wide font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
