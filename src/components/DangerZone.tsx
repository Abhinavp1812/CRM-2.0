"use client";

import { useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

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
