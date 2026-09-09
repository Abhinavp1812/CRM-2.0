"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CustomerTypeBadge } from "@/components/StatusBadge";

export interface AdminCustomerClientRow {
  id: string;
  name: string | null;
  phone: string;
  phoneFormatted: string;
  city: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  doNotContact: boolean;
  ownerName: string | null;
  currentRemark: string | null;
  currentNote: string | null;
  followupText: string;
  lastContactText: string;
  totalActivities: number;
  lastActivityText: string;
  hasFollowup: boolean;
  telHref: string;
  waHref: string;
}

/** Rows eligible for the bulk "show from date" action: active followup, not DNC. */
function isSelectable(r: AdminCustomerClientRow): boolean {
  return r.hasFollowup && !r.doNotContact;
}

export default function AdminCustomersTable({
  rows,
  page,
  totalPages,
  prevHref,
  nextHref,
}: {
  rows: AdminCustomerClientRow[];
  page: number;
  totalPages: number;
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ updatedCount: number; skippedCount: number } | null>(null);

  const selectableRows = useMemo(() => rows.filter(isSelectable), [rows]);
  const allOnPageSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        for (const r of selectableRows) next.delete(r.id);
      } else {
        for (const r of selectableRows) next.add(r.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setError(null);
    setLastResult(null);
  }

  async function applyDate() {
    if (selected.size === 0 || !date) return;
    setApplying(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/customers/bulk-followup-date", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerIds: Array.from(selected), date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setLastResult({ updatedCount: data.updatedCount, skippedCount: data.skippedCount });
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 bg-blue-600 text-white rounded-lg shadow-lg px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{selected.size.toLocaleString()} selected</span>
          <label className="flex items-center gap-2 text-sm">
            Show from
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-gray-900 text-sm rounded px-2 py-1"
              disabled={applying}
            />
          </label>
          <button
            onClick={applyDate}
            disabled={!date || applying}
            className="px-3 py-1.5 text-sm bg-white text-blue-700 rounded font-medium hover:bg-blue-50 disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
          <button
            onClick={clearSelection}
            disabled={applying}
            className="px-3 py-1.5 text-sm bg-blue-700 rounded hover:bg-blue-800"
          >
            Clear selection
          </button>
          {error && <span className="text-sm text-red-100 bg-red-800/40 rounded px-2 py-1">{error}</span>}
        </div>
      )}

      {lastResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
          Updated {lastResult.updatedCount.toLocaleString()} customer{lastResult.updatedCount !== 1 ? "s" : ""}.
          {lastResult.skippedCount > 0 && (
            <span className="text-green-700">
              {" "}Skipped {lastResult.skippedCount.toLocaleString()} (Do Not Contact or no active followup) - use Reopen or Unflag DNC for those first.
            </span>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs font-medium text-gray-700 uppercase">
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAllOnPage}
                  disabled={selectableRows.length === 0}
                  title="Select all eligible customers on this page"
                  className="rounded"
                />
              </th>
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Type</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">City</th>
              <th className="px-3 py-3">Owner</th>
              <th className="px-3 py-3">Current State</th>
              <th className="px-3 py-3">Followup Date</th>
              <th className="px-3 py-3">Activities</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((c) => {
              const selectable = isSelectable(c);
              return (
                <tr key={c.id} className={"hover:bg-gray-50 " + (selected.has(c.id) ? "bg-blue-50" : "")}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      disabled={!selectable}
                      title={selectable ? undefined : "No active followup or flagged Do Not Contact"}
                      className="rounded"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={"/customers/" + c.id} className="font-medium text-gray-900 hover:text-blue-700">
                      {c.name ?? "(no name)"}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <CustomerTypeBadge type={c.customerType} doNotContact={c.doNotContact} />
                  </td>
                  <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{c.phoneFormatted}</td>
                  <td className="px-3 py-3 text-gray-600">{c.city ?? "-"}</td>
                  <td className="px-3 py-3 text-gray-600">{c.ownerName ?? "-"}</td>
                  <td className="px-3 py-3 text-gray-700 max-w-xs">
                    {c.currentRemark ? (
                      <div>
                        <div className="font-medium">{c.currentRemark}</div>
                        {c.currentNote ? <div className="text-xs text-gray-500 truncate">{c.currentNote}</div> : null}
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs italic">No remark</span>
                    )}
                    <div className="text-xs text-gray-500 mt-0.5">Last: {c.lastContactText}</div>
                  </td>
                  <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{c.followupText}</td>
                  <td className="px-3 py-3 text-gray-600 text-center">
                    <div>{c.totalActivities}</div>
                    <div className="text-xs text-gray-500">{c.lastActivityText}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {!c.doNotContact ? (
                        <>
                          <a href={c.telHref} className="inline-flex items-center px-2 h-7 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs">Call</a>
                          <a href={c.waHref} target="_blank" rel="noopener" className="inline-flex items-center px-2 h-7 rounded bg-green-50 text-green-700 hover:bg-green-100 text-xs">WA</a>
                        </>
                      ) : null}
                      <Link href={"/customers/" + c.id} className="inline-flex items-center px-2 h-7 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs">Open</Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Link
              href={prevHref}
              aria-disabled={page === 1}
              className={
                "px-3 h-9 inline-flex items-center rounded text-sm " +
                (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")
              }
            >
              Previous
            </Link>
            <Link
              href={nextHref}
              aria-disabled={page === totalPages}
              className={
                "px-3 h-9 inline-flex items-center rounded text-sm " +
                (page === totalPages ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")
              }
            >
              Next
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
