"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { BACKUP_VERSION, type BackupFile, type LinkedTable, type RestoreCounts } from "@/lib/backup/types";

const BATCH_SIZE = 1500;
const LINKED_TABLES: LinkedTable[] = ["followups", "activities", "registrations", "bookings"];

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function emptyCounts(): RestoreCounts {
  return {
    salonsCreated: 0, salonsUpdated: 0,
    customersCreated: 0, customersUpdated: 0, customersSkipped: 0,
    followupsWritten: 0, followupsSkipped: 0,
    activitiesWritten: 0, activitiesSkipped: 0,
    registrationsWritten: 0, registrationsSkipped: 0,
    bookingsWritten: 0, bookingsSkipped: 0,
    remarkOptionsWritten: 0, settingsWritten: 0,
    warnings: [],
  };
}

async function postPhase(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/admin/backup/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data;
}

function mergeCounts(into: RestoreCounts, from: Record<string, unknown>) {
  for (const key of Object.keys(into) as (keyof RestoreCounts)[]) {
    if (key === "warnings") continue;
    const v = from[key];
    if (typeof v === "number") (into[key] as number) += v;
  }
  const w = from.warnings;
  if (Array.isArray(w)) into.warnings.push(...w.filter((x): x is string => typeof x === "string"));
}

export default function BackupRestorePanel() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<BackupFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<RestoreCounts | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setParsed(null);
    setParseError(null);
    setResult(null);
    setRunError(null);
    setConfirmText("");
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as BackupFile;
      if (typeof data.version !== "number" || data.version > BACKUP_VERSION) {
        throw new Error(`This file's backup version (${data.version}) is newer than this app understands (${BACKUP_VERSION}). Update the app first.`);
      }
      if (!Array.isArray(data.customers) || !Array.isArray(data.bookings)) {
        throw new Error("This doesn't look like a CRM backup file - some expected sections are missing.");
      }
      setParsed(data);
    } catch (e) {
      setParseError(
        e instanceof Error
          ? e.message
          : "Couldn't read this file. Make sure it's the exact .json file downloaded from Download Full Backup, unmodified."
      );
    }
  }

  async function runRestore() {
    if (!parsed) return;
    setRunning(true);
    setRunError(null);
    setResult(null);
    const totals = emptyCounts();

    try {
      setStatus("Restoring remark options, settings, and salons…");
      mergeCounts(totals, await postPhase({
        phase: "config", version: parsed.version,
        remarkOptions: parsed.remarkOptions, settings: parsed.settings, salons: parsed.salons,
      }));

      const customerBatches = chunk(parsed.customers, BATCH_SIZE);
      for (let i = 0; i < customerBatches.length; i++) {
        setStatus(`Restoring customers… batch ${i + 1} of ${customerBatches.length || 1}`);
        mergeCounts(totals, await postPhase({ phase: "customers", version: parsed.version, rows: customerBatches[i] }));
      }

      for (const table of LINKED_TABLES) {
        const rows = parsed[table] as unknown[];
        const batches = chunk(rows, BATCH_SIZE);
        for (let i = 0; i < batches.length; i++) {
          setStatus(`Restoring ${table}… batch ${i + 1} of ${batches.length || 1}`);
          mergeCounts(totals, await postPhase({ phase: "linked", version: parsed.version, table, rows: batches[i] }));
        }
      }

      setResult(totals);
      setStatus("");
      router.refresh();
    } catch (e) {
      setResult(totals);
      setRunError(
        (e instanceof Error ? e.message : "Restore failed") +
        " — already-restored data is kept (nothing is undone). Press Restore again to pick up where this left off; already-done rows are safely skipped."
      );
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setParsed(null);
    setParseError(null);
    setConfirmText("");
    setResult(null);
    setRunError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
          <ArrowUpTrayIcon className="h-6 w-6" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Backup &amp; Restore</h2>
          <p className="text-sm text-gray-600 mt-1">
            A full, exact snapshot of every customer, followup, remark, registration, and booking - not the readable
            report from Export All Data. Meant for disaster recovery: restoring overwrites matching records with what&apos;s
            in the file (by phone number, order number, etc.) but never deletes anything not mentioned in it.
          </p>
        </div>
      </div>

      <a
        href="/api/admin/backup/export"
        className="self-start inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
      >
        <ArrowDownTrayIcon className="h-4 w-4" />
        Download Full Backup
      </a>

      <div className="border-t border-gray-100 pt-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">Restore from a backup file</label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={running}
          className="block w-full text-sm border border-gray-200 rounded-md p-2"
        />

        {parseError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3 text-sm text-red-800">{parseError}</div>
        )}

        {parsed && !result && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mt-3">
            <div className="flex items-start gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold">
                  This file was exported {new Date(parsed.exportedAt).toLocaleString("en-IN")} and contains{" "}
                  {parsed.counts.customers.toLocaleString()} customers, {parsed.counts.bookings.toLocaleString()} bookings,
                  and {parsed.counts.activities.toLocaleString()} activity records.
                </p>
                <p className="mt-1">
                  Restoring will overwrite matching records in this database with the data from this file. This does not
                  delete anything - customers not in this file are left alone.
                </p>
                <label className="block mt-3">
                  <span className="text-xs font-medium">Type RESTORE to confirm</span>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    disabled={running}
                    className="mt-1 block w-full text-sm border border-amber-300 rounded-md px-2 py-1.5"
                    placeholder="RESTORE"
                  />
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={runRestore}
                disabled={confirmText !== "RESTORE" || running}
                className="px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-300"
              >
                {running ? "Restoring…" : "Restore"}
              </button>
              <button
                onClick={reset}
                disabled={running}
                className="px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {running && <p className="text-sm text-blue-700 mt-3">{status}</p>}

        {runError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-3 text-sm text-red-800">{runError}</div>
        )}

        {result && (
          <div className="mt-3">
            {!runError && (
              <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-3">
                <CheckCircleIcon className="h-5 w-5" />
                Restore complete
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <ResultStat label="Customers Created" value={result.customersCreated} />
              <ResultStat label="Customers Updated" value={result.customersUpdated} />
              <ResultStat label="Followups Written" value={result.followupsWritten} />
              <ResultStat label="Activities Written" value={result.activitiesWritten} />
              <ResultStat label="Registrations Written" value={result.registrationsWritten} />
              <ResultStat label="Bookings Written" value={result.bookingsWritten} />
              <ResultStat label="Salons Written" value={result.salonsCreated + result.salonsUpdated} />
              <ResultStat label="Remark Options" value={result.remarkOptionsWritten} />
            </div>
            {result.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3 text-xs text-amber-900 max-h-40 overflow-y-auto">
                {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
            <button
              onClick={reset}
              className="mt-3 px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Restore another file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg px-3 py-2 bg-gray-50 text-gray-700">
      <p className="text-[10px] uppercase tracking-wide font-medium">{label}</p>
      <p className="text-lg font-bold">{value.toLocaleString()}</p>
    </div>
  );
}
