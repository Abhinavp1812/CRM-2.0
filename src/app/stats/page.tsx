import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Layout from "@/components/Layout";

export const dynamic = "force-dynamic";

export default async function MyStatsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role === "ADMIN") redirect("/admin/stats");

  const userId = session.user.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [
    ownedCount, activeCount, dncCount, dueToday,
    callsThisWeek, remarksThisWeek,
    callsThisMonth, remarksThisMonth,
    callsToday, remarksToday,
  ] = await Promise.all([
    prisma.customer.count({ where: { ownerId: userId, deletedAt: null } }),
    prisma.customer.count({ where: { ownerId: userId, deletedAt: null, doNotContact: false, followup: { isNot: null } } }),
    prisma.customer.count({ where: { ownerId: userId, deletedAt: null, doNotContact: true } }),
    prisma.followup.count({
      where: {
        customer: { ownerId: userId, deletedAt: null, doNotContact: false },
        nextFollowupDate: { gte: today, lt: tomorrow },
        currentRemark: { not: null },
      },
    }),
    prisma.activityLog.count({ where: { userId, activityType: "CALL_LOGGED", createdAt: { gte: weekAgo } } }),
    prisma.activityLog.count({ where: { userId, activityType: "REMARK_ADDED", createdAt: { gte: weekAgo } } }),
    prisma.activityLog.count({ where: { userId, activityType: "CALL_LOGGED", createdAt: { gte: monthAgo } } }),
    prisma.activityLog.count({ where: { userId, activityType: "REMARK_ADDED", createdAt: { gte: monthAgo } } }),
    prisma.activityLog.count({ where: { userId, activityType: "CALL_LOGGED", createdAt: { gte: today, lt: tomorrow } } }),
    prisma.activityLog.count({ where: { userId, activityType: "REMARK_ADDED", createdAt: { gte: today, lt: tomorrow } } }),
  ]);

  return (
    <Layout>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">My Stats</h1>
        <p className="text-sm text-slate-500 mt-1">Your personal performance overview</p>
      </div>

      <Section title="My Pipeline">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total Owned" value={ownedCount} color="blue" />
          <Stat label="Active" value={activeCount} color="green" />
          <Stat label="DNC" value={dncCount} color="red" />
          <Stat label="Due Today" value={dueToday} color="amber" />
        </div>
      </Section>

      <Section title="Today">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Calls" value={callsToday} color="blue" />
          <Stat label="Remarks" value={remarksToday} color="green" />
        </div>
      </Section>

      <Section title="Last 7 Days">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Calls" value={callsThisWeek} color="blue" />
          <Stat label="Remarks" value={remarksThisWeek} color="green" />
        </div>
      </Section>

      <Section title="Last 30 Days">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Calls" value={callsThisMonth} color="blue" />
          <Stat label="Remarks" value={remarksThisMonth} color="green" />
        </div>
      </Section>
    </Layout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "blue" | "green" }) {
  const styles = {
    red: "bg-red-50 border-red-100 text-red-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
  };
  return (
    <div className={"rounded-xl p-4 border shadow-sm " + styles[color]}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
