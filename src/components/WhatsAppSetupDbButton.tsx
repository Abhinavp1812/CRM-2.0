"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** One-click creation of the WhatsApp tables (admin page banner). */
export default function WhatsAppSetupDbButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/whatsapp/setup-db", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3 mt-3">
      <button type="button" onClick={run} disabled={busy} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
        {busy ? "Creating…" : "Create WhatsApp tables now"}
      </button>
      <span className="text-xs text-red-700">Adds two new tables only - existing data isn&apos;t touched.</span>
      {error && <span className="text-xs text-red-700 font-semibold">{error}</span>}
    </span>
  );
}
