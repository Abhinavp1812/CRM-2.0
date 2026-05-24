import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Layout from "@/components/Layout";

export const dynamic = "force-dynamic";

export default async function AdminStatsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const agents = await prisma.user.findMany({
    where: { role: "AGENT", deletedAt: null },
    select: { id: true, name: true, onLeaveFrom: true },
    orderBy: { name: "asc" },
  });

  const [totalCustomers, dncCustomers, closedCustomers, activeFollowups, totalBookings, paidBookings] = await Promise.all([
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.customer.count({ where: { deletedAt: null, doNotContact: true } }),
    prisma.customer.count({ where: { deletedAt: null, doNotContact: false, followup: null } }),
    prisma.followup.count({ where: { customer: { deletedAt: null, doNotContact: false } } }),
    prisma.booking.count(),
    prisma.booking.count({ where: { paymentStatus: { in: ["Success", "Partially Paid"] }, NOT: { status: "Cancelled" } } }),
  ]);

  const agentStats = await Promise.all(
    agents.map(async (a) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

      const [ownedCount, ownedActive, ownedDnc, callsThisWeek, remarksThisWeek, dueToday] = await Promise.all([
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null } }),
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null, doNotContact: false, followup: { isNot: null } } }),
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null, doNotContact: true } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "CALL_LOGGED", createdAt: { gte: weekAgo } } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "REMARK_ADDED", createdAt: { gte: weekAgo } } }),
        prisma.followup.count({
          where: {
            customer: { ownerId: a.id, deletedAt: null, doNotContact: false },
            nextFollowupDate: { gte: today, lt: tomorrow },
            currentRemark: { not: null },
          },
        }),
      ]);

      return { id: a.id, name: a.name, onLeave: !!a.onLeaveFrom, ownedCount, ownedActive, ownedDnc, callsThisWeek, remarksThisWeek, dueToday };
    })
  );

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Team Stats</h1>
        <p className="text-sm text-slate-500 mt-1">Performance overview across all agents</p>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <OverviewStat label="Total Customers" value={totalCustomers} />
        <OverviewStat label="Active Followups" value={activeFollowups} />
        <OverviewStat label="Closed" value={closedCustomers} />
        <OverviewStat label="DNC" value={dncCustomers} />
        <OverviewStat label="Total Bookings" value={totalBookings} />
        <OverviewStat label="Paid Bookings" value={paidBookings} />
      </div>

      {/* Per-agent section */}
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Per-Agent</h2>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {agentStats.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-gray-900">{a.name}</p>
              {a.onLeave && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">On Leave</span>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Owned</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedCount}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Active</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedActive}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Due Today</p>
                <p className="text-lg font-bold text-gray-900">{a.dueToday}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">DNC</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedDnc}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Calls 7d</p>
                <p className="text-lg font-bold text-gray-900">{a.callsThisWeek}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Remarks 7d</p>
                <p className="text-lg font-bold text-gray-900">{a.remarksThisWeek}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-gray-200">
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Owned</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">DNC</th>
                <th className="px-4 py-3">Due Today</th>
                <th className="px-4 py-3">Calls (7d)</th>
                <th className="px-4 py-3">Remarks (7d)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agentStats.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {a.name}
                    {a.onLeave && <span className="ml-2 inline-block px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">On Leave</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{a.ownedCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.ownedActive.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.ownedDnc.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.dueToday.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.callsThisWeek.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.remarksThisWeek.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

function OverviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-xl font-bold mt-1 text-gray-900">{value.toLocaleString()}</p>
    </div>
  );
}
