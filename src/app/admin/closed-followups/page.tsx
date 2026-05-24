import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getClosedCustomers, getClosureReasons, formatPhone } from "@/lib/followups";
import { CustomerTypeBadge } from "@/components/StatusBadge";
import Layout from "@/components/Layout";
import ReopenFollowupButton from "@/components/ReopenFollowupButton";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ClosedFollowupsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; reason?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const reason = params.reason || "all";

  const [{ rows, total }, reasons] = await Promise.all([
    getClosedCustomers(reason === "all" ? null : reason, page, PAGE_SIZE),
    getClosureReasons(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildUrl(overrides: Record<string, string | undefined>) {
    const merged: Record<string, string | undefined> = {
      reason: reason !== "all" ? reason : undefined,
      ...overrides,
    };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
      .join("&");
    return "/admin/closed-followups" + (qs ? "?" + qs : "");
  }

  return (
    <Layout>
      <main className="min-h-screen bg-slate-50 py-4 md:py-8">
        <div className="max-w-7xl mx-auto px-4">
          <Link href="/admin" className="inline-flex items-center text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4">
            ← Admin
          </Link>
          <div className="flex items-baseline justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Closed Followups</h1>
              <p className="text-sm text-slate-500 mt-1">
                {total.toLocaleString()} customers · Re-open to put them back in queue
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-0.5 mb-4 border-b border-gray-200 overflow-x-auto pb-px">
            <FilterTab href={buildUrl({ reason: undefined })} active={reason === "all"} label="All" />
            <FilterTab href={buildUrl({ reason: "dnc" })} active={reason === "dnc"} label="Do Not Contact" />
            {reasons.filter((r) => r !== "dnc").map((r) => (
              <FilterTab key={r} href={buildUrl({ reason: r })} active={reason === r} label={r} />
            ))}
          </div>

          {total === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center">
              <p className="text-slate-400 text-sm">No closed followups in this view.</p>
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {rows.map((c) => (
                  <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <Link href={"/customers/" + c.id} className="font-semibold text-gray-900 hover:text-blue-600">
                          {c.name ?? "(no name)"}
                        </Link>
                        <p className="text-xs text-slate-500 mt-0.5 font-mono">{formatPhone(c.phone)}</p>
                      </div>
                      <CustomerTypeBadge type={c.customerType} doNotContact={c.doNotContact} />
                    </div>
                    <div className="text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1 mb-3">
                      {c.city && <span>{c.city}</span>}
                      {c.ownerName && <span>Owner: {c.ownerName}</span>}
                      <span className={c.doNotContact ? "text-red-600 font-medium" : ""}>{c.closedReason}</span>
                      {c.closedAt && <span>Closed {new Date(c.closedAt).toLocaleDateString("en-IN")}</span>}
                    </div>
                    <div className="flex gap-2">
                      <ReopenFollowupButton customerId={c.id} customerName={c.name} isDnc={c.doNotContact} />
                      <Link href={"/customers/" + c.id} className="inline-flex items-center px-3 h-8 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium">
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-gray-200">
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">City</th>
                      <th className="px-4 py-3">Owner</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Closed</th>
                      <th className="px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={"/customers/" + c.id} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                            {c.name ?? "(no name)"}
                          </Link>
                        </td>
                        <td className="px-4 py-3"><CustomerTypeBadge type={c.customerType} doNotContact={c.doNotContact} /></td>
                        <td className="px-4 py-3 font-mono text-slate-600 text-xs whitespace-nowrap">{formatPhone(c.phone)}</td>
                        <td className="px-4 py-3 text-slate-500">{c.city ?? "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{c.ownerName ?? "-"}</td>
                        <td className="px-4 py-3">
                          <span className={c.doNotContact ? "text-red-600 font-semibold text-sm" : "text-slate-700 text-sm"}>
                            {c.closedReason}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {c.closedAt ? new Date(c.closedAt).toLocaleDateString("en-IN") : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <ReopenFollowupButton customerId={c.id} customerName={c.name} isDnc={c.doNotContact} />
                            <Link href={"/customers/" + c.id} className="inline-flex items-center px-2.5 h-7 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium transition-colors">
                              Open
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 px-1">
                  <p className="text-sm text-slate-500">Page <span className="font-medium text-slate-700">{page}</span> of {totalPages}</p>
                  <div className="flex gap-2">
                    <Link
                      href={buildUrl({ page: String(Math.max(1, page - 1)) })}
                      className={"px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium " + (page === 1 ? "bg-slate-100 text-slate-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-slate-50 text-slate-700 shadow-sm")}
                    >
                      ← Previous
                    </Link>
                    <Link
                      href={buildUrl({ page: String(Math.min(totalPages, page + 1)) })}
                      className={"px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium " + (page === totalPages ? "bg-slate-100 text-slate-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-slate-50 text-slate-700 shadow-sm")}
                    >
                      Next →
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </Layout>
  );
}

function FilterTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        "flex-shrink-0 px-3 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap " +
        (active
          ? "border-blue-600 text-blue-700"
          : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300")
      }
    >
      {label}
    </Link>
  );
}
