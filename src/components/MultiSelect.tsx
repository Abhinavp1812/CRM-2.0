"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

/**
 * Excel-style filter dropdown for a GET form: search box, "Select all",
 * tick boxes, Select all / Deselect all, OK / Cancel.
 *
 * The choice is sent as repeated query params (`name=a&name=b`). When every
 * option is ticked - or none - nothing is sent, which means "no filter".
 * OK submits the surrounding form; Cancel or clicking outside drops the edits.
 */
type Props = {
  name: string;
  options: MultiSelectOption[];
  selected: string[];
  allLabel: string;
  submitOnOk?: boolean;
  className?: string;
};

/** Remount when the applied selection changes (e.g. after a link sets a filter). */
export default function MultiSelect(props: Props) {
  return <MultiSelectInner key={props.selected.join("\u0001")} {...props} />;
}

function MultiSelectInner({
  name,
  options,
  selected,
  allLabel,
  submitOnOk = true,
  className = "",
}: {
  name: string;
  options: MultiSelectOption[];
  /** Currently applied values (empty = all). */
  selected: string[];
  /** Button text when there's no filter, e.g. "All salons". */
  allLabel: string;
  submitOnOk?: boolean;
  className?: string;
}) {
  const applied = useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const s = selected.filter((v) => known.has(v));
    return s.length === 0 || s.length === options.length ? options.map((o) => o.value) : s;
  }, [options, selected]);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(applied));
  const [committed, setCommitted] = useState<Set<string>>(() => new Set(applied));
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) cancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const q = search.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const visibleTicked = visible.filter((o) => draft.has(o.value)).length;
  const allVisibleTicked = visible.length > 0 && visibleTicked === visible.length;
  const someVisibleTicked = visibleTicked > 0 && !allVisibleTicked;

  function cancel() {
    setDraft(new Set(committed));
    setSearch("");
    setOpen(false);
  }

  function toggle(value: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function setVisible(on: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      for (const o of visible) {
        if (on) next.add(o.value);
        else next.delete(o.value);
      }
      return next;
    });
  }

  function ok() {
    if (draft.size === 0) return;
    setCommitted(new Set(draft));
    setSearch("");
    setOpen(false);
    if (submitOnOk) {
      const form = ref.current?.closest("form");
      // Let React flush the hidden inputs before submitting.
      if (form) setTimeout(() => form.requestSubmit(), 0);
    }
  }

  const isAll = committed.size === 0 || committed.size === options.length;
  const committedList = options.filter((o) => committed.has(o.value));
  const buttonText = isAll ? allLabel : committedList.length === 1 ? committedList[0].label : `${committedList.length} of ${options.length} selected`;

  return (
    <div ref={ref} className={"relative " + className}>
      {!isAll && committedList.map((o) => <input key={o.value} type="hidden" name={name} value={o.value} />)}

      <button
        type="button"
        onClick={() => (open ? cancel() : setOpen(true))}
        className={
          "w-full flex items-center justify-between gap-2 border rounded-lg px-2.5 py-1.5 text-sm text-left bg-white " +
          (isAll ? "border-gray-300 text-gray-800" : "border-blue-400 text-blue-800 bg-blue-50")
        }
        title={isAll ? allLabel : committedList.map((o) => o.label).join(", ")}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDownIcon className="h-4 w-4 flex-shrink-0 text-gray-500" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-72 max-w-[90vw] bg-white rounded-lg shadow-xl border border-gray-200">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <MagnifyingGlassIcon className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    ok();
                  }
                }}
                placeholder="Search"
                className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
            ) : (
              <>
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-slate-50 cursor-pointer border-b border-gray-100">
                  <input
                    type="checkbox"
                    checked={allVisibleTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleTicked;
                    }}
                    onChange={() => setVisible(!allVisibleTicked)}
                    className="rounded"
                  />
                  {q ? "(Select all search results)" : "(Select all)"}
                </label>
                {visible.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-800 hover:bg-slate-50 cursor-pointer">
                    <input type="checkbox" checked={draft.has(o.value)} onChange={() => toggle(o.value)} className="rounded" />
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.count !== undefined && <span className="text-xs text-gray-400">{o.count.toLocaleString("en-IN")}</span>}
                  </label>
                ))}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 p-2 border-t border-gray-100 bg-slate-50 rounded-b-lg">
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => setVisible(true)} className="text-blue-600 hover:underline">
                Select all
              </button>
              <button type="button" onClick={() => setVisible(false)} className="text-blue-600 hover:underline">
                Deselect all
              </button>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={cancel} className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={ok}
                disabled={draft.size === 0}
                title={draft.size === 0 ? "Tick at least one" : undefined}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
