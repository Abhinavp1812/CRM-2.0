"use client";
import { useState } from "react";

export default function SelfLeaveButton({ name, role }: { name?: string; role?: string }) {
  const [show, setShow] = useState(false);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/me/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: from || null, until: until || null }) });
      const data = await res.json();
      if (!data?.success) {
        alert(data?.error || "Failed to set leave");
      } else {
        setShow(false);
      }
    } catch (err) {
      alert("Failed to set leave");
    } finally {
      setLoading(false);
    }
  }

  if (role !== "AGENT") return null;

  return (
    <>
      <button
        onClick={() => setShow(true)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Mark On Leave
      </button>
      {show && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-gray-900 text-lg mb-1">Mark On Leave</h3>
            <p className="text-sm text-slate-500 mb-4">Follow-ups in your leave window will shift to your return date.</p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">From</label>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">Until</label>
                <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShow(false)} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={submit} disabled={loading} className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50">
                {loading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
