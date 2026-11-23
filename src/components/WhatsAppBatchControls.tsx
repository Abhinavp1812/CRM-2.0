"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** ISO time of the latest batch, if any. */
  latestAt: string | null;
  latestIsToday: boolean;
  /** What the next click will pick, per list. */
  next: { label: string; count: number; newRound: boolean }[];
}

/** "Generate nudges for today" + undo of the latest batch. */
export default function WhatsAppBatchControls({ latestAt, latestIsToday, next }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"gen" | "undo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = next.reduce((n, x) => n + x.count, 0);

  async function generate() {
    if (latestIsToday && !confirm("A batch was already generated today. Generate the NEXT batch as well? (The customers will be different.)")) return;
    setBusy("gen");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/today", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.skippedReason) throw new Error(data.skippedReason);
      router.push("/admin/whatsapp/today");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    if (!latestAt) return;
    if (!confirm("Undo the latest batch? Its customers go back to the front of their lists and are removed from the Nudge log. Only do this if you have NOT sent it from Anantya.")) return;
    setBusy("undo");
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/today?at=" + encodeURIComponent(latestAt), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.push("/admin/whatsapp/today");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={busy !== null || total === 0}
          className="px-5 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === "gen" ? "Generating…" : "🎯 Generate nudges for today"}
        </button>
        {latestAt && (
          <button type="button" onClick={undo} disabled={busy !== null} className="px-3 py-2 text-xs text-rose-700 border border-rose-200 bg-rose-50 rounded-lg hover:bg-rose-100 disabled:opacity-50">
            {busy === "undo" ? "Undoing…" : "Undo latest batch"}
          </button>
        )}
        {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
      </div>
      <p className="text-xs text-slate-500 mt-3">
        Next batch: {next.map((x, i) => (
          <span key={x.label}>
            {i > 0 && " · "}
            {x.label} <b className="text-slate-700">{x.count.toLocaleString("en-IN")}</b>
            {x.newRound && <span className="text-violet-700"> (starts a new round)</span>}
          </span>
        ))}{" "}
        = <b className="text-slate-700">{total.toLocaleString("en-IN")}</b> customers
      </p>
    </div>
  );
}
