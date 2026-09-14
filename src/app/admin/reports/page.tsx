import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Agent Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Download a full team activity report as Excel — a per-agent summary plus every remark logged in the period.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <ReportCard
          href="/api/admin/reports/export?period=week"
          title="Weekly Report"
          description="Rolling last 7 days, all agents"
        />
        <ReportCard
          href="/api/admin/reports/export?period=month"
          title="Monthly Report"
          description="Rolling last 30 days, all agents"
        />
      </div>

      <p className="text-xs text-slate-400 mt-6">
        Looking for a single day instead?{" "}
        <Link href="/reports" className="underline text-blue-600 hover:text-blue-700">
          Daily Report
        </Link>{" "}
        is available to every agent for their own customers, and to you for any agent or all of them.
      </p>
    </Layout>
  );
}

function ReportCard({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <a
      href={href}
      download
      className="group bg-white p-5 rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md shadow-sm transition-all duration-150 block"
    >
      <h2 className="font-semibold text-gray-900 text-sm">{title}</h2>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
      <p className="text-xs text-emerald-600 font-semibold mt-3">Download Excel &rarr;</p>
    </a>
  );
}
