"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface RemarkOption {
  label: string;
  defaultDaysAhead: number | null;
  autoFlagDnc: boolean;
  closesFollowup: boolean;
}

type LeadTemperature = "HOT" | "WARM" | "COLD";

interface Props {
  customerId: string;
  customerName: string | null;
  currentRemark: string | null;
  currentNote: string | null;
  currentLeadTemperature?: LeadTemperature | null;
  currentFollowupDate: string; // YYYY-MM-DD
  remarkOptions: RemarkOption[];
  onClose?: () => void;
}

export default function FollowupEditor({
  customerId,
  customerName,
  currentRemark,
  currentNote,
  currentLeadTemperature,
  currentFollowupDate,
  remarkOptions,
  onClose,
}: Props) {
  const router = useRouter();
  const [remark, setRemark] = useState(currentRemark || "");
  const [leadTemperature, setLeadTemperature] = useState<LeadTemperature | "">(currentLeadTemperature || "");
  const [note, setNote] = useState(currentNote || "");
  function toLocalIsoFromAny(input: string) {
    try {
      const d = new Date(input);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    } catch {
      return input?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    }
  }

  function todayLocalIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  // Default to today's date when opening the editor; user can change it.
  const [nextDate, setNextDate] = useState<string>(todayLocalIso());
  const [flagDnc, setFlagDnc] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedOption = remarkOptions.find((r) => r.label === remark);
  const isAutoDnc = selectedOption?.autoFlagDnc || false;
  const isCloser = selectedOption?.closesFollowup || false;
  const effectiveDnc = flagDnc || isAutoDnc;

  // When remark changes, suggest a default next date
  function handleRemarkChange(label: string) {
    setRemark(label);
    setError("");
    const opt = remarkOptions.find((r) => r.label === label);
    if (opt && opt.defaultDaysAhead !== null) {
      // compute default date using UTC to avoid timezone shifts
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + opt.defaultDaysAhead);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      setNextDate(`${y}-${m}-${dd}`);
    }
  }

  async function handleSave() {
    setError("");
    if (!leadTemperature) {
      setError("Pick a lead temperature (Hot/Warm/Cold) first.");
      return;
    }
    if (!remark) {
      setError("Pick a remark first.");
      return;
    }
    // Client-side rule check (server will also enforce)
    if (!effectiveDnc && !isCloser && !nextDate) {
      setError(
        "Set a next follow-up date OR mark this customer Do Not Contact. No customer can be left without a next step."
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/followups/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          remark,
          leadTemperature,
          note: note || undefined,
          nextFollowupDate:
            !effectiveDnc && !isCloser && nextDate ? nextDate : undefined,
          flagDnc: effectiveDnc,
          dncReason: effectiveDnc ? dncReason || remark : undefined,
        }),
      });
      const text = await res.text();
      let data: { success?: boolean; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setSaving(false);
        setError(`Server error (status ${res.status})`);
        return;
      }
      setSaving(false);
      if (!res.ok || !data.success) {
        setError(data.error || `Save failed (status ${res.status})`);
        return;
      }
      // Success — close + refresh
      if (onClose) onClose();
      router.refresh();
    } catch (e) {
      setSaving(false);
      setError(`Network error: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="font-semibold text-gray-900 text-lg">Update follow-up</h3>
          <p className="text-sm text-slate-500 mt-0.5">{customerName || "This customer"}</p>
        </div>
        {onClose ? (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors p-1 -m-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
            Lead Temperature <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "HOT", label: "Hot", active: "bg-red-600 text-white border-red-600", inactive: "bg-white text-red-700 border-red-200 hover:bg-red-50" },
                { value: "WARM", label: "Warm", active: "bg-amber-500 text-white border-amber-500", inactive: "bg-white text-amber-700 border-amber-200 hover:bg-amber-50" },
                { value: "COLD", label: "Cold", active: "bg-sky-600 text-white border-sky-600", inactive: "bg-white text-sky-700 border-sky-200 hover:bg-sky-50" },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setLeadTemperature(t.value)}
                disabled={saving}
                className={
                  "px-3 py-2 rounded-lg text-sm font-semibold border transition-colors " +
                  (leadTemperature === t.value ? t.active : t.inactive)
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
            Remark <span className="text-red-500">*</span>
          </label>
          <select
            value={remark}
            onChange={(e) => handleRemarkChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={saving}
          >
            <option value="">— Choose a remark —</option>
            {remarkOptions.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
                {r.autoFlagDnc ? " (auto-DNC)" : ""}
                {r.closesFollowup ? " (closes followup)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
            Note <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering for next time…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            disabled={saving}
          />
        </div>

        {!effectiveDnc && !isCloser ? (
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
              Next follow-up date <span className="text-red-500">*</span>
              {selectedOption?.defaultDaysAhead !== null && selectedOption?.defaultDaysAhead !== undefined ? (
                <span className="font-normal text-slate-400 normal-case tracking-normal"> (+{selectedOption.defaultDaysAhead}d default)</span>
              ) : null}
            </label>
            <input
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={saving}
            />
          </div>
        ) : null}

        {isAutoDnc ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            This remark automatically flags the customer as <strong>Do Not Contact</strong>.
          </div>
        ) : null}

        {isCloser && !isAutoDnc ? (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">
            This remark closes the follow-up. The customer won&apos;t appear in queues unless re-opened.
          </div>
        ) : null}

        {!isAutoDnc && !isCloser ? (
          <div className="border-t border-gray-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={flagDnc}
                onChange={(e) => setFlagDnc(e.target.checked)}
                className="mt-0.5"
                disabled={saving}
              />
              <span>
                <span className="text-sm font-semibold text-gray-800">Mark as Do Not Contact</span>
                <span className="block text-xs text-slate-500 mt-0.5">Wrong number, asked not to be called, etc.</span>
              </span>
            </label>
            {flagDnc ? (
              <input
                type="text"
                value={dncReason}
                onChange={(e) => setDncReason(e.target.value)}
                placeholder="Reason (optional)"
                className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={saving}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2 pt-2 border-t border-gray-100 justify-end">
          {onClose ? (
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          ) : null}
          <button
            onClick={handleSave}
            disabled={saving || !remark || !leadTemperature}
            className="px-5 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}