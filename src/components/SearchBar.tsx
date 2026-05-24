"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

interface Result {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  doNotContact: boolean;
  ownerName: string | null;
}

export default function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/customers/search?q=" + encodeURIComponent(q));
        const data = await res.json();
        setResults(data.results || []);
        setActiveIdx(0);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) { setOpen(false); setQ(""); router.push("/customers/" + r.id); }
    } else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search customers…"
          className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm placeholder:text-slate-400 transition"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute z-50 mt-1.5 w-full min-w-[320px] right-0 bg-white rounded-xl shadow-xl border border-gray-200 max-h-80 overflow-y-auto">
          {loading ? (
            <p className="p-4 text-sm text-slate-400">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">No matches found.</p>
          ) : (
            <ul className="py-1">
              {results.map((r, idx) => (
                <li key={r.id}>
                  <Link
                    href={"/customers/" + r.id}
                    onClick={() => { setOpen(false); setQ(""); }}
                    className={
                      "flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors " +
                      (idx === activeIdx ? "bg-blue-50" : "")
                    }
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 text-sm truncate">{r.name || "(no name)"}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                        {r.doNotContact ? (
                          <span className="text-red-600 font-medium">DNC</span>
                        ) : r.customerType === "CUSTOMER" ? (
                          <span className="text-emerald-600">Booked</span>
                        ) : (
                          <span className="text-blue-600">Registered</span>
                        )}
                        {r.city && <span>· {r.city}</span>}
                        {r.ownerName && <span>· {r.ownerName}</span>}
                      </div>
                    </div>
                    <span className="font-mono text-xs text-slate-500 flex-shrink-0">{r.phone}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
