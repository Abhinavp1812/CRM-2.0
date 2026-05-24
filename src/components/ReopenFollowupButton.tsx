"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  customerId: string;
  customerName: string | null;
  isDnc: boolean;
}

export default function ReopenFollowupButton({
  customerId,
  customerName,
  isDnc,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clearDnc, setClearDnc] = useState(true);
  const [error, setError] = useState("");

  async function go() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/customers/reopen-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, clearDnc: isDnc ? clearDnc : false }),
      });
      const data = await res.json();
      setSaving(false);
      if (!res.ok || !data.success) {
        setError(data.error || "Failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setSaving(false);
      setError("Network error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-2.5 h-7 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 text-xs font-medium transition-colors"
      >
        Re-open
      </button>
      {open ? (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center px-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
          >
            <h3 className="font-semibold text-gray-900 text-lg mb-1">
              Re-open follow-up?
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              <span className="font-medium text-slate-700">{customerName || "This customer"}</span> will be set to today and go back into their owner&apos;s queue.
            </p>
            {error ? (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            ) : null}
            {isDnc ? (
              <label className="flex items-start gap-3 text-sm mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearDnc}
                  onChange={(e) => setClearDnc(e.target.checked)}
                  className="mt-0.5"
                  disabled={saving}
                />
                <span>
                  <span className="font-semibold text-amber-900">Also remove Do Not Contact flag</span>
                  <span className="block text-xs text-amber-700 mt-0.5">
                    Required to actually contact them.
                  </span>
                </span>
              </label>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={go}
                disabled={saving}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Working…" : "Re-open"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}