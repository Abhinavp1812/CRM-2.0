import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import {
  UserGroupIcon,
  NoSymbolIcon,
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  ArrowUpTrayIcon,
  ClipboardDocumentListIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";

export default async function AdminPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your team, imports, and data.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <AdminTile
          href="/admin/customers"
          icon={UserGroupIcon}
          color="blue"
          title="All Customers"
          description="Searchable master list with filters by owner, type, and follow-up status"
        />
        <AdminTile
          href="/admin/team"
          icon={UserGroupIcon}
          color="blue"
          title="Team"
          description="Add agents, manage leave, reassign customers, and balance workload"
        />
        <AdminTile
          href="/admin/imports"
          icon={ArrowDownTrayIcon}
          color="green"
          title="Imports"
          description="Upload registrations and bookings — auto-assigns new customers to agents"
        />
        <AdminTile
          href="/admin/closed-followups"
          icon={NoSymbolIcon}
          color="amber"
          title="Closed Followups"
          description="Re-engage Not Interested, DNC, and Service Taken customers"
        />
        <AdminTile
          href="/admin/reassignment-log"
          icon={ClipboardDocumentListIcon}
          color="blue"
          title="Reassignment Log"
          description="Full audit trail of every customer owner change"
        />
        <AdminTile
          href="/api/admin/export"
          icon={ArrowUpTrayIcon}
          color="green"
          title="Export All Data"
          description="Download customers, followups, registrations, and bookings as Excel"
          download
        />
        <AdminTile
          href="/admin/help"
          icon={QuestionMarkCircleIcon}
          color="blue"
          title="Help"
          description="Admin guide: team management, imports, reassignment tools, and more"
        />
        <AdminTile
          href="/admin/danger"
          icon={ExclamationTriangleIcon}
          color="red"
          title="Danger Zone"
          description="Permanently wipe registration or booking data — requires super admin password"
        />
      </div>
    </Layout>
  );
}

function AdminTile({
  href,
  icon: Icon,
  color,
  title,
  description,
  download,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "red" | "green" | "amber";
  title: string;
  description: string;
  download?: boolean;
}) {
  const iconStyles = {
    blue: "bg-blue-100 text-blue-600",
    red: "bg-red-100 text-red-600",
    green: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
  };
  const inner = (
    <div className="flex items-start gap-4">
      <div className={"p-2.5 rounded-xl flex-shrink-0 " + iconStyles[color]}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
  const cls = "group bg-white p-5 rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md shadow-sm transition-all duration-150 block";
  if (download) {
    return <a href={href} download className={cls}>{inner}</a>;
  }
  return <Link href={href} className={cls}>{inner}</Link>;
}
