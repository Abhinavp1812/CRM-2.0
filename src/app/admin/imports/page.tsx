import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import SyncPanel from "@/components/SyncPanel";
import { prisma } from "@/lib/prisma";
import { getSyncStatus } from "@/lib/sync/run";

export const dynamic = "force-dynamic";

export default async function DataSyncHub() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const [recentSyncs, agentBreakdown, followupSetting] = await Promise.all([
    prisma.importHistory.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { uploadedBy: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { role: "AGENT", deletedAt: null },
      select: {
        id: true,
        name: true,
        isActive: true,
        onLeaveFrom: true,
        _count: { select: { ownedCustomers: { where: { deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.setting.findUnique({ where: { key: "bookingFollowupDays" } }),
  ]);
  const bookingFollowupDays = parseInt(followupSetting?.value ?? "20", 10) || 20;

  const totalCustomers = agentBreakdown.reduce((s, a) => s + a._count.ownedCustomers, 0);
  const status = getSyncStatus();

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Sync</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Leads are pulled straight from the Google Sheets. New customers are auto-assigned to the least-loaded agent; existing customers keep their agent.
        </p>
      </div>

      <div className="mb-8">
        <SyncPanel status={status} bookingFollowupDays={bookingFollowupDays} />
      </div>

      {/* Agent customer breakdown */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Agent Breakdown
          <span className="ml-2 text-sm font-normal text-gray-500">({totalCustomers} total customers assigned)</span>
        </h2>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Customers</th>
                <th className="px-4 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agentBreakdown.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-gray-500 text-center">No agents yet</td></tr>
              ) : agentBreakdown.map((a) => {
                const pct = totalCustomers > 0 ? Math.round((a._count.ownedCustomers / totalCustomers) * 100) : 0;
                const label = a.onLeaveFrom ? "On Leave" : a.isActive ? "Active" : "Inactive";
                const statusColor = a.onLeaveFrom ? "text-yellow-600" : a.isActive ? "text-green-600" : "text-gray-400";
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                    <td className={"px-4 py-3 text-xs " + statusColor}>{label}</td>
                    <td className="px-4 py-3 text-right font-mono">{a._count.ownedCustomers.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-20 bg-gray-200 rounded-full h-1.5">
                          <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: pct + "%" }} />
                        </div>
                        <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sync history */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Sync History
          <span className="ml-2 text-sm font-normal text-gray-500">(last 20)</span>
        </h2>
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">By</th>
                <th className="px-4 py-3 text-right">Rows</th>
                <th className="px-4 py-3 text-right">New</th>
                <th className="px-4 py-3 text-right">Updated</th>
                <th className="px-4 py-3 text-right">Skipped</th>
                <th className="px-4 py-3 text-right">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentSyncs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-gray-500 text-center">No syncs yet</td></tr>
              ) : recentSyncs.map((imp) => (
                <tr key={imp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {imp.createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    <div className="text-xs text-gray-400">
                      {imp.createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={"inline-block px-2 py-0.5 rounded text-xs font-medium " +
                      (imp.importType === "REGISTRATIONS" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>
                      {imp.importType === "REGISTRATIONS" ? "Registrations" : "Bookings"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate" title={imp.notes ?? imp.filename}>
                    {imp.filename}
                    {imp.notes?.startsWith("scheduled") && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">auto</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{imp.uploadedBy.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{imp.totalRows.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-green-700">{imp.newCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-blue-700">{imp.updatedCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-amber-700">{imp.skippedCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-red-700">{imp.errorCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        One-time migration of the old followup spreadsheet is still available at{" "}
        <Link href="/admin/import/followups" className="text-blue-600 hover:underline">Import Combined Followups</Link>.
      </p>
    </Layout>
  );
}
