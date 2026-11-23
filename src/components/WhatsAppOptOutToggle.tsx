"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** "WhatsApp nudges: On / Off" switch on the customer page. */
export default function WhatsAppOptOutToggle({ customerId, optedOut, canEdit }: { customerId: string; optedOut: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(optedOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !value;
    if (next && !window.confirm("Stop all WhatsApp nudges to this customer?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/customers/whatsapp-optout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, optOut: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setValue(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="text-slate-400">WhatsApp nudges:</span>
      <span className={value ? "font-semibold text-rose-600" : "font-semibold text-emerald-700"}>{value ? "Off (opted out)" : "On"}</span>
      {canEdit && (
        <button type="button" onClick={toggle} disabled={busy} className="text-blue-600 underline hover:text-blue-800 disabled:opacity-50">
          {busy ? "…" : value ? "Turn on" : "Turn off"}
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
