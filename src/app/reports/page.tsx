import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { getRemarkActivity, getAllUsersForFilter } from "@/lib/followups";
import { LeadTemperatureBadge } from "@/components/StatusBadge";
import { formatDateIN, formatTimeIN, todayIsoIST } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; ownerId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = session.user.role === "ADMIN";

  const params = await searchParams;
  const dateStr = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIsoIST();
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Agents only ever see their own customers; only an admin can pick "all" or someone else.
  const scopeOwnerId = isAdmin ? params.ownerId || null : session.user.id;

  const [rows, agents] = await Promise.all([
    getRemarkActivity({ ownerId: scopeOwnerId }, { start: dayStart, end: dayEnd }),
    isAdmin ? getAllUsersForFilter() : Promise.resolve([]),
  ]);

  const exportHref =
    "/api/reports/daily/export?date=" + dateStr + (isAdmin && params.ownerId ? "&ownerId=" + params.ownerId : "");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daily Report</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every remark logged on this day{isAdmin ? "" : " for your customers"} — including closed ones like Not
          Interested, Converted, or Not Connected, which no longer show on the main follow-ups list.
        </p>
      </div>

      <form method="GET" className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Date</label>
          <input
            type="date"
            name="date"
            defaultValue={dateStr}
            max={todayIsoIST()}
            className="border rounded px-2 py-1.5 text-sm"
          />
        </div>
        {isAdmin && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Agent</label>
            <select name="ownerId" defaultValue={params.ownerId || ""} className="border rounded px-2 py-1.5 text-sm">
              <option value="">All agents</option>
              {agents
                .filter((a) => a.role === "AGENT")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
        <a
          href={exportHref}
          download
          className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 ml-auto"
        >
          Download Excel
        </a>
      </form>

      <p className="text-sm text-gray-600 mb-3">{rows.length.toLocaleString()} remark{rows.length === 1 ? "" : "s"} logged</p>

      {rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No remarks logged on this day.</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                <th className="px-3 py-3">Time</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Phone</th>
                <th className="px-3 py-3">City</th>
                {isAdmin && <th className="px-3 py-3">Agent</th>}
                <th className="px-3 py-3">Remark</th>
                <th className="px-3 py-3">Temp</th>
                <th className="px-3 py-3">Note</th>
                <th className="px-3 py-3">Next Followup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                    {formatTimeIN(r.time, { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">
                    <Link href={"/customers/" + r.customerId} className="hover:text-blue-700">
                      {r.customerName || "(no name)"}
                    </Link>
                  </td>
                  <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
                  <td className="px-3 py-3 text-gray-600">{r.city || "-"}</td>
                  {isAdmin && <td className="px-3 py-3 text-gray-600">{r.ownerName || "-"}</td>}
                  <td className="px-3 py-3 text-gray-800 font-medium whitespace-nowrap">{r.remark}</td>
                  <td className="px-3 py-3">
                    <LeadTemperatureBadge temperature={r.leadTemperature} />
                  </td>
                  <td className="px-3 py-3 text-gray-500 max-w-xs truncate">{r.note || "-"}</td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                    {r.nextFollowupDate ? formatDateIN(r.nextFollowupDate) : "Closed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
