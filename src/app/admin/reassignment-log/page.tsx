import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReassignmentLogPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const logs = await prisma.activityLog.findMany({
    where: { activityType: "OWNER_CHANGED" },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      user: { select: { name: true } },
    },
  });

  return (
    <Layout>
      <div className="mb-6">
        <Link href="/admin" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors mb-2">← Admin</Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-1">Reassignment Log</h1>
        <p className="text-sm text-slate-500 mt-1">All customer owner changes, most recent first. Up to 500 entries.</p>
      </div>

      {logs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-slate-400 text-sm shadow-sm">
          No reassignments recorded yet.
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    {log.customer ? (
                      <Link href={`/customers/${log.customer.id}`} className="font-semibold text-gray-900 hover:text-blue-600 text-sm">
                        {log.customer.name || "(no name)"}
                      </Link>
                    ) : <span className="text-slate-400 text-sm">—</span>}
                    {log.customer?.phone && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{log.customer.phone}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 whitespace-nowrap">{new Date(log.createdAt).toLocaleDateString("en-IN")}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="bg-slate-100 px-2 py-0.5 rounded font-medium">{log.oldValue || "—"}</span>
                  <span className="text-slate-400">→</span>
                  <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{log.newValue || "—"}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">By {log.user?.name || "System"}</p>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-gray-200">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">To</th>
                  <th className="px-4 py-3">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                      {new Date(log.createdAt).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      {log.customer ? (
                        <Link href={`/customers/${log.customer.id}`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                          {log.customer.name || "(no name)"}
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                      {log.customer?.phone && (
                        <span className="block text-xs text-slate-400 font-mono">{log.customer.phone}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{log.oldValue || "—"}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{log.newValue || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{log.user?.name || "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Layout>
  );
}
