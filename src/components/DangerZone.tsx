"use client";

import { useState } from "react";
import { ExclamationTriangleIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";

type Target = "registrations" | "bookings" | "both" | "customers";

interface WipeConfig {
  target: Target;
  title: string;
  description: string;
  confirmLabel: string;
}

const WIPE_OPTIONS: WipeConfig[] = [
  {
    target: "registrations",
    title: "Wipe All Registrations",
    description: "Permanently deletes every registration record. Customers and their follow-ups are not affected.",
    confirmLabel: "Delete all registrations",
  },
  {
    target: "bookings",
    title: "Wipe All Bookings",
    description: "Permanently deletes every booking record. Customers and their follow-ups are not affected.",
    confirmLabel: "Delete all bookings",
  },
  {
    target: "both",
    title: "Wipe Registrations + Bookings",
    description: "Permanently deletes all registration and booking records. Customers and follow-ups are not affected.",
    confirmLabel: "Delete all registrations and bookings",
  },
  {
    target: "customers",
    title: "Wipe All Customers",
    description: "Permanently deletes every customer and all associated data — follow-ups, activity logs, registrations, and bookings. The database will be completely empty.",
    confirmLabel: "Delete all customers and all data",
  },
];

interface RepairExample {
  name: string | null;
  phone: string;
  lastRemark: string;
  remarkAt: string;
  resurrectedAt: string;
}

function RepairResurrectedFollowups() {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ count: number; examples: RepairExample[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/danger/repair-resurrected-followups");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load preview");
      setPreview(data);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function runRepair() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/danger/repair-resurrected-followups", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to repair");
      setDone(data.deletedCount);
      setPreview(null);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-100 flex-shrink-0">
          <WrenchScrewdriverIcon className="h-5 w-5 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900">Repair Resurrected Followups</h3>
          <p className="text-sm text-slate-500 mt-1">
            One-time cleanup for a fixed sync bug that was recreating a blank follow-up for customers already
            closed out (Not Interested, Converted, DNC) - wiping their remark and &quot;last contacted&quot; back
            to never. This deletes only those wrongly-recreated rows; the customer&apos;s actual remark/contact
            history is untouched either way.
          </p>

          {done !== null && (
            <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
              Done. Restored {done} customer{done !== 1 ? "s" : ""} to their correct closed state.
            </div>
          )}

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

          {!preview && done === null && (
            <button
              onClick={loadPreview}
              disabled={loading}
              className="mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Checking…" : "Preview affected customers"}
            </button>
          )}

          {preview && (
            <div className="mt-3">
              {preview.count === 0 ? (
                <p className="text-sm text-slate-500">Nothing to repair - no affected customers found.</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-800 mb-2">
                    Found {preview.count} affected customer{preview.count !== 1 ? "s" : ""}. Examples:
                  </p>
                  <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-600 uppercase">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Customer</th>
                          <th className="px-2 py-1.5 text-left">Phone</th>
                          <th className="px-2 py-1.5 text-left">Last Remark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.examples.map((e, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1.5">{e.name || "(no name)"}</td>
                            <td className="px-2 py-1.5 font-mono">{e.phone}</td>
                            <td className="px-2 py-1.5">{e.lastRemark}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!confirming ? (
                    <button
                      onClick={() => setConfirming(true)}
                      className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      Repair these {preview.count} customers
                    </button>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700">Confirm: delete these {preview.count} bad rows?</span>
                      <button
                        onClick={runRepair}
                        disabled={loading}
                        className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                      >
                        {loading ? "Repairing…" : "Yes, repair"}
                      </button>
                      <button
                        onClick={() => setConfirming(false)}
                        disabled={loading}
                        className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DangerZone() {
  const [active, setActive] = useState<WipeConfig | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ registrations: number; bookings: number; customers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openModal(cfg: WipeConfig) {
    setActive(cfg);
    setPassword("");
    setError(null);
    setResult(null);
  }

  function closeModal() {
    setActive(null);
    setPassword("");
    setError(null);
  }

  async function handleConfirm() {
    if (!active || !password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/danger/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, target: active.target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult({ registrations: data.deletedRegistrations ?? 0, bookings: data.deletedBookings ?? 0, customers: data.deletedCustomers ?? 0 });
      setActive(null);
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <RepairResurrectedFollowups />
      </div>

      {result && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
          {result.customers > 0
            ? `Done. Deleted ${result.customers} customer${result.customers !== 1 ? "s" : ""} and all associated data.`
            : `Done. Deleted ${result.registrations} registration${result.registrations !== 1 ? "s" : ""} and ${result.bookings} booking${result.bookings !== 1 ? "s" : ""}.`
          }
        </div>
      )}

      <div className="space-y-4">
        {WIPE_OPTIONS.map((cfg) => (
          <div key={cfg.target} className="bg-white border border-red-200 rounded-xl p-5 flex items-start justify-between gap-4 shadow-sm">
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900">{cfg.title}</h3>
              <p className="text-sm text-slate-500 mt-1">{cfg.description}</p>
            </div>
            <button
              onClick={() => openModal(cfg)}
              className="flex-shrink-0 px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
            >
              Wipe
            </button>
          </div>
        ))}
      </div>

      {/* Modal */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-100">
                <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{active.title}</h2>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              {active.description} <strong>This cannot be undone.</strong>
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enter super admin password to confirm
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              placeholder="Super admin password"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
              autoFocus
              disabled={loading}
            />

            {error && (
              <p className="text-sm text-red-600 mb-3">{error}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                disabled={loading || !password}
                className="flex-1 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "Deleting…" : active.confirmLabel}
              </button>
              <button
                onClick={closeModal}
                disabled={loading}
                className="flex-1 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
