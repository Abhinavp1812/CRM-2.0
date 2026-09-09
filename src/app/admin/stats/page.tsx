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

      const [ownedCount, ownedActive, ownedDnc, callsThisWeek, dueToday, customersContacted, customersBooked] = await Promise.all([
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null } }),
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null, doNotContact: false, followup: { isNot: null } } }),
        prisma.customer.count({ where: { ownerId: a.id, deletedAt: null, doNotContact: true } }),
        // A call is a call whether it's logged with the dedicated button or simply
        // recorded by saving a remark - saving a remark always stamps lastContactedAt
        // too, so it represents a real contact just as much. One column, not two.
        prisma.activityLog.count({ where: { userId: a.id, activityType: { in: ["CALL_LOGGED", "REMARK_ADDED"] }, createdAt: { gte: weekAgo } } }),
        prisma.followup.count({
          where: {
            customer: { ownerId: a.id, deletedAt: null, doNotContact: false },
            nextFollowupDate: { gte: today, lt: tomorrow },
            currentRemark: { not: null },
          },
        }),
        // Conversion: every owned customer this agent has ever reached (lifetime,
        // not time-boxed - "these customers"), and of those, how many are now a
        // paying customer (customerType flips to CUSTOMER on their first booking).
        prisma.customer.count({
          where: { ownerId: a.id, deletedAt: null, doNotContact: false, followup: { lastContactedAt: { not: null } } },
        }),
        prisma.customer.count({
          where: { ownerId: a.id, deletedAt: null, doNotContact: false, followup: { lastContactedAt: { not: null } }, customerType: "CUSTOMER" },
        }),
      ]);

      return {
        id: a.id, name: a.name, onLeave: !!a.onLeaveFrom,
        ownedCount, ownedActive, ownedDnc, callsThisWeek, dueToday,
        customersContacted, customersBooked,
        conversionRate: customersContacted > 0 ? Math.round((customersBooked / customersContacted) * 100) : 0,
      };
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
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Per-Agent</h2>
        <p className="text-xs text-slate-400">Contacted &amp; Booked are lifetime totals, not just the last 7 days</p>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden space-y-3">
        {agentStats.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-gray-900">{a.name}</p>
              {a.onLeave && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">On Leave</span>}
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Owned</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedCount}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Active</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedActive}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">DNC</p>
                <p className="text-lg font-bold text-gray-900">{a.ownedDnc}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2">
                <p className="text-xs text-slate-500">Due Today</p>
                <p className="text-lg font-bold text-gray-900">{a.dueToday}</p>
              </div>
            </div>
            <div className="mt-2 bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-500">Calls (7d)</p>
              <p className="text-lg font-bold text-gray-900">{a.callsThisWeek}</p>
            </div>
            <div className="mt-2 bg-blue-50 rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-700 font-medium">Called {a.customersContacted.toLocaleString()} customers</p>
                <p className="text-xs text-blue-600 mt-0.5">{a.customersBooked.toLocaleString()} of them booked</p>
              </div>
              <p className="text-xl font-bold text-blue-700">{a.conversionRate}%</p>
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
                <th className="px-4 py-3">Called</th>
                <th className="px-4 py-3">Booked</th>
                <th className="px-4 py-3">Conversion</th>
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
                  <td className="px-4 py-3 text-slate-700">{a.customersContacted.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-700">{a.customersBooked.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                      {a.conversionRate}%
                    </span>
                  </td>
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
