"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogCallButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/customers/log-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, note: note || undefined }),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      setSaving(false);
      if (!res.ok || !data.success) {
        setError(data.error || `Save failed (status ${res.status})`);
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch (e) {
      setSaving(false);
      setError(`Network error: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-3 h-9 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 text-sm font-medium transition-colors"
      >
        Log a call
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
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Log an off-schedule call</h3>
            <p className="text-sm text-slate-500 mb-4">
              Adds a timeline entry without changing their follow-up date.
            </p>
            {error ? (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                {error}
              </div>
            ) : null}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What was discussed?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
              disabled={saving}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setOpen(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Log call"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}