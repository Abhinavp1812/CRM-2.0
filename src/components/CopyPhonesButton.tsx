"use client";

import { useState } from "react";

/** Copies a list of phone numbers (one per line) to paste into Anantya. */
export default function CopyPhonesButton({ phones, label = "Copy numbers" }: { phones: string[]; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(phones.join("\n"));
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      alert("Couldn't copy - please use the Excel download instead.");
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      disabled={phones.length === 0}
      className="px-3 h-8 inline-flex items-center rounded-lg bg-white text-slate-700 border border-gray-200 hover:bg-slate-50 text-xs font-medium disabled:opacity-40"
    >
      {done ? "✓ Copied " + phones.length : label}
    </button>
  );
}
