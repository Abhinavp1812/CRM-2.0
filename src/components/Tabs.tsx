"use client";
import { useState, ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
}

export default function Tabs({ tabs, defaultId }: { tabs: Tab[]; defaultId?: string }) {
  const [activeId, setActiveId] = useState(defaultId || tabs[0]?.id);
  const active = tabs.find((t) => t.id === activeId) || tabs[0];

  return (
    <div>
      <div className="border-b border-gray-200 flex gap-0.5 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={
              "flex-shrink-0 flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap " +
              (activeId === t.id
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300")
            }
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span className={
                "inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold " +
                (activeId === t.id ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")
              }>
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="pt-4">{active?.content}</div>
    </div>
  );
}