"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

type SyncType = "registrations" | "bookings";

interface SheetSource {
  spreadsheetId: string;
  tabs: string[];
  url: string;
}

export interface SyncStatus {
  configured: boolean;
  serviceAccountEmail: string | null;
  scheduled: boolean;
  registrations: SheetSource;
  bookings: SheetSource;
}

interface SyncError {
  sheet: string;
  row: number;
  reason: string;
  data: Record<string, unknown>;
}

interface SyncResponse {
  success: boolean;
  type: SyncType;
  source: string;
  durationMs: number;
  totalRows: number;
  skipCount: number;
  errorCount: number;
  autoAssignedCount: number;
  agentBreakdown: { agentId: string; agentName: string; count: number }[];
  errors: SyncError[];
  // registrations
  newCount?: number;
  updateCount?: number;
  // bookings
  newBookingCount?: number;
  duplicateOrderCount?: number;
  upgradedCustomerCount?: number;
  newCustomerCount?: number;
  healedFollowups?: number;
  followupsCreated?: number;
  followupsUpdated?: number;
  followupsSkipped?: number;
}

/** Export the rows the sync could not use, with the reason, as an .xlsx file. */
function downloadErrorReport(errors: SyncError[], filename: string) {
  const rows = errors.map((e) => ({ Sheet: e.sheet, Row: e.row, Reason: e.reason, ...e.data }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Errors");
  XLSX.writeFile(wb, filename);
}

export default function SyncPanel({ status, bookingFollowupDays }: { status: SyncStatus; bookingFollowupDays: number }) {
  return (
    <div className="space-y-4">
      {!status.configured && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Google service account not configured</p>
            <p className="mt-1">
              Add <code className="font-mono text-xs bg-amber-100 px-1 rounded">GOOGLE_SERVICE_ACCOUNT_JSON</code> to the
              environment variables and redeploy. Sync buttons will fail until then.
            </p>
          </div>
        </div>
      )}

      {status.configured && status.serviceAccountEmail && (
        <p className="text-xs text-gray-500">
          Sheets must be shared (Viewer) with{" "}
          <span className="font-mono text-gray-700 select-all">{status.serviceAccountEmail}</span>.
          {status.scheduled
            ? " A scheduled sync also runs automatically every day."
            : " Scheduled sync is off until CRON_SECRET is set."}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SyncCard
          type="registrations"
          title="New Registrations"
          accent="blue"
          source={status.registrations}
          description="New customers from the registrations sheet. New phone numbers are created and assigned to the least-loaded agent; existing customers keep their agent."
        />
        <SyncCard
          type="bookings"
          title="Bookings"
          accent="green"
          source={status.bookings}
          description="Orders from the booking dump. Known order numbers are skipped, new customers are auto-assigned, registrations with a booking become customers, and the latest booking sets the followup date."
          extra={<FollowupDaysSetting initial={bookingFollowupDays} />}
        />
      </div>
    </div>
  );
}

function SyncCard({
  type,
  title,
  accent,
  source,
  description,
  extra,
}: {
  type: SyncType;
  title: string;
  accent: "blue" | "green";
  source: SheetSource;
  description: string;
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accentClasses = {
    blue: { badge: "bg-blue-50 text-blue-600", button: "bg-blue-600 hover:bg-blue-700" },
    green: { badge: "bg-green-50 text-green-600", button: "bg-green-600 hover:bg-green-700" },
  }[accent];

  async function handleSync() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/sync/${type}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setResult(data as SyncResponse);
      router.refresh(); // refresh history + agent breakdown below
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={"p-2 rounded-lg flex-shrink-0 " + accentClasses.badge}>
            <ArrowPathIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-600 mt-1">{description}</p>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2"
            >
              Open source sheet
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </a>
            <span className="text-xs text-gray-400 ml-2">
              Tab{source.tabs.length > 1 ? "s" : ""}: {source.tabs.join(", ")}
            </span>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={running}
          className={
            "flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-md disabled:bg-gray-400 " +
            accentClasses.button
          }
        >
          <ArrowPathIcon className={"h-4 w-4 " + (running ? "animate-spin" : "")} />
          {running ? "Syncing..." : "Sync now"}
        </button>
      </div>

      {extra}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800 break-words">{error}</div>
      )}

      {result && (
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-700 mb-3">
            <CheckCircleIcon className="h-5 w-5" />
            Sync complete
            <span className="font-normal text-gray-400 text-xs ml-auto">
              {result.totalRows.toLocaleString()} rows read in {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </div>

          {result.type === "registrations" ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="New Customers" value={result.newCount ?? 0} color="green" />
              <Stat label="Already Known" value={result.updateCount ?? 0} color="blue" />
              <Stat label="Skipped" value={result.skipCount} color="amber" />
              <Stat label="Errors" value={result.errorCount} color="red" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="New Bookings" value={result.newBookingCount ?? 0} color="green" />
              <Stat label="Already Synced" value={result.duplicateOrderCount ?? 0} color="gray" />
              <Stat label="New Customers" value={result.newCustomerCount ?? 0} color="green" />
              <Stat label="Upgraded" value={result.upgradedCustomerCount ?? 0} color="blue" />
              <Stat label="Followups Created" value={result.followupsCreated ?? 0} color="green" />
              <Stat label="Followups Updated" value={result.followupsUpdated ?? 0} color="blue" />
              <Stat label="Skipped" value={result.skipCount} color="amber" />
              <Stat label="Errors" value={result.errorCount} color="red" />
            </div>
          )}

          {(result.healedFollowups ?? 0) > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Gave {result.healedFollowups} customer{result.healedFollowups === 1 ? "" : "s"} a missing followup date, so they appear in an agent queue again.
            </p>
          )}

          {result.autoAssignedCount > 0 && result.agentBreakdown.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
              <p className="text-sm font-semibold text-blue-900 mb-1">
                Auto-assigned {result.autoAssignedCount} new customer{result.autoAssignedCount !== 1 ? "s" : ""}
              </p>
              <div className="space-y-0.5">
                {result.agentBreakdown.map((a) => (
                  <div key={a.agentId} className="flex justify-between text-sm">
                    <span className="text-blue-900">{a.agentName}</span>
                    <span className="font-mono text-blue-700">{a.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <button
              onClick={() =>
                downloadErrorReport(result.errors, `${type}-sync-errors-${new Date().toISOString().slice(0, 10)}.xlsx`)
              }
              className="mt-3 px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100"
            >
              Download Error Report ({result.errorCount} rows)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Days added to a booking date to schedule the next followup (Setting "bookingFollowupDays"). */
function FollowupDaysSetting({ initial }: { initial: number }) {
  const [days, setDays] = useState<number>(initial);
  const [saved, setSaved] = useState<number>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    const value = Math.max(1, Math.min(365, Math.round(days) || saved));
    setDays(value);
    if (value === saved) return;
    setState("saving");
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "bookingFollowupDays", value: String(value) }),
      });
      if (!res.ok) throw new Error();
      setSaved(value);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <label htmlFor="followup-days" className="text-gray-700">
        Follow-up <span className="font-mono">=</span> booking date +
      </label>
      <input
        id="followup-days"
        type="number"
        min={1}
        max={365}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center"
      />
      <span className="text-gray-700">days</span>
      <span className="text-xs ml-auto">
        {state === "saving" && <span className="text-gray-400">Saving...</span>}
        {state === "saved" && <span className="text-green-600">Saved</span>}
        {state === "error" && <span className="text-red-600">Could not save</span>}
      </span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "blue" | "green" | "gray" }) {
  const colors = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    gray: "bg-gray-50 text-gray-700",
  };
  return (
    <div className={"rounded-lg px-3 py-2 " + colors[color]}>
      <p className="text-[10px] uppercase tracking-wide font-medium">{label}</p>
      <p className="text-xl font-bold">{value.toLocaleString()}</p>
    </div>
  );
}
