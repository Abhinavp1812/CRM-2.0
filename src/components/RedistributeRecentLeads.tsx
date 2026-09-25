"use client";

import { useState } from "react";

interface Share {
  agentId: string;
  name: string;
  current: number;
  target: number;
}
interface Preview {
  months: number;
  cutoff: string;
  total: number;
  agents: Share[];
  moveCount: number;
}

export default function RedistributeRecentLeads() {
  const [months, setMonths] = useState(2);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setDone(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/admin/team/redistribute-recent?months=" + months);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load preview");
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team/redistribute-recent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to redistribute");
      setDone(data.moved);
      setPreview(null);
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm mb-6">
      <h3 className="font-semibold text-gray-900">Re-spread recent new leads</h3>
      <p className="text-sm text-slate-500 mt-1">
        Takes new registrations nobody has contacted yet (no remark, never called) from the last few months and
        divides them evenly across all available agents. Anything an agent has already worked stays where it is.
      </p>

      <div className="flex items-center gap-2 mt-3">
        <label className="text-sm text-gray-700">Registered within the last</label>
        <input
          type="number"
          min={1}
          max={12}
          value={months}
          onChange={(e) => {
            setMonths(Number(e.target.value) || 2);
            setPreview(null);
            setDone(null);
          }}
          className="w-16 border rounded px-2 py-1 text-sm"
        />
        <span className="text-sm text-gray-700">months</span>
        <button
          onClick={loadPreview}
          disabled={loading}
          className="ml-2 px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading && !confirming ? "Checking…" : "Preview"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      {done !== null && (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          Done. Moved {done} customer{done !== 1 ? "s" : ""}. Each move is in the Reassign Log.
        </div>
      )}

      {preview && (
        <div className="mt-4">
          {preview.moveCount === 0 ? (
            <p className="text-sm text-slate-500">
              Already even ({preview.total} untouched recent leads) - nothing to move.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-800 mb-2">
                {preview.total} untouched leads registered since {preview.cutoff.slice(0, 10)}. {preview.moveCount} would move:
              </p>
              <table className="text-sm border border-gray-200 rounded-lg overflow-hidden mb-3">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Agent</th>
                    <th className="px-3 py-2 text-right">Now</th>
                    <th className="px-3 py-2 text-right">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.agents.map((a) => (
                    <tr key={a.agentId}>
                      <td className="px-3 py-2 font-medium">{a.name}</td>
                      <td className="px-3 py-2 text-right font-mono">{a.current}</td>
                      <td className="px-3 py-2 text-right font-mono">{a.target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700"
                >
                  Move {preview.moveCount} customers
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700">Confirm: reassign {preview.moveCount} customers?</span>
                  <button
                    onClick={run}
                    disabled={loading}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {loading ? "Moving…" : "Yes, move them"}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={loading}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
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
  );
}
