import Link from "next/link";

const TABS = [
  { key: "settings", label: "Settings & sending", href: "/admin/whatsapp" },
  { key: "lists", label: "Customer lists", href: "/admin/whatsapp/lists" },
  { key: "log", label: "Nudge log", href: "/admin/whatsapp/log" },
] as const;

/** Tab bar shared by the three Admin > WhatsApp pages. */
export default function WhatsAppTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div className="flex gap-1 mt-2 mb-3 border-b border-gray-200">
      {TABS.map((t) =>
        t.key === active ? (
          <span key={t.key} className="px-3 py-2 text-sm font-semibold text-blue-700 border-b-2 border-blue-600">
            {t.label}
          </span>
        ) : (
          <Link key={t.key} href={t.href} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 border-b-2 border-transparent">
            {t.label}
          </Link>
        )
      )}
    </div>
  );
}
