import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getAdminCustomers,
  getAllUsersForFilter,
  getActiveRemarkOptions,
  formatPhone,
  whatsappLink,
  telLink,
  type AdminCustomerFilter,
} from "@/lib/followups";
import { CustomerTypeBadge } from "@/components/StatusBadge";
import Layout from "@/components/Layout";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    search?: string;
    ownerId?: string;
    customerType?: string;
    followupState?: string;
    remark?: string;
  }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const filter: AdminCustomerFilter = {
    search: params.search || undefined,
    ownerId: params.ownerId || undefined,
    customerType: (params.customerType as "NEW_REGISTRATION" | "CUSTOMER" | "all") || "all",
    followupState: (params.followupState as "active" | "closed" | "dnc" | "all") || "all",
    remark: params.remark || undefined,
  };

  const [{ rows, total }, users, remarkOptions] = await Promise.all([
    getAdminCustomers(filter, page, PAGE_SIZE),
    getAllUsersForFilter(),
    getActiveRemarkOptions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildUrl(overrides: Record<string, string | undefined>) {
    const merged = {
      search: filter.search,
      ownerId: filter.ownerId,
      customerType: filter.customerType !== "all" ? filter.customerType : undefined,
      followupState: filter.followupState !== "all" ? filter.followupState : undefined,
      remark: filter.remark,
      ...overrides,
    };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
      .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
      .join("&");
    return "/admin/customers" + (qs ? "?" + qs : "");
  }

  return (
    <Layout>
      <main className="min-h-screen bg-gray-50 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900">
            Back to Admin
          </Link>
          <div className="flex items-baseline justify-between mt-2 mb-4">
            <h1 className="text-2xl font-bold text-gray-900">All Customers</h1>
            <p className="text-sm text-gray-600">{total.toLocaleString()} matching</p>
          </div>

          <form method="GET" className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              name="search"
              defaultValue={filter.search || ""}
              placeholder="Search name or phone"
              className="border rounded px-2 py-1.5 text-sm md:col-span-2"
            />
            <select
              name="ownerId"
              defaultValue={filter.ownerId || ""}
              className="border rounded px-2 py-1.5 text-sm"
            >
              <option value="">All owners</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </select>
            <select
              name="customerType"
              defaultValue={filter.customerType || "all"}
              className="border rounded px-2 py-1.5 text-sm"
            >
              <option value="all">All types</option>
              <option value="NEW_REGISTRATION">Registered</option>
              <option value="CUSTOMER">Booked</option>
            </select>
            <select
              name="followupState"
              defaultValue={filter.followupState || "all"}
              className="border rounded px-2 py-1.5 text-sm"
            >
              <option value="all">All states</option>
              <option value="active">Active followup</option>
              <option value="closed">Closed (no followup)</option>
              <option value="dnc">DNC</option>
            </select>
            <select
              name="remark"
              defaultValue={filter.remark || ""}
              className="border rounded px-2 py-1.5 text-sm md:col-span-2"
            >
              <option value="">Any current remark</option>
              {remarkOptions.map((r) => (
                <option key={r.label} value={r.label}>{r.label}</option>
              ))}
            </select>
            <div className="md:col-span-3 flex gap-2 justify-end">
              <Link
                href="/admin/customers"
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                Clear
              </Link>
              <button
                type="submit"
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Apply filters
              </button>
            </div>
          </form>

          {total === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">
              No customers match these filters.
            </div>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                      <th className="px-3 py-3">Customer</th>
                      <th className="px-3 py-3">Type</th>
                      <th className="px-3 py-3">Phone</th>
                      <th className="px-3 py-3">City</th>
                      <th className="px-3 py-3">Owner</th>
                      <th className="px-3 py-3">Current State</th>
                      <th className="px-3 py-3">Followup Date</th>
                      <th className="px-3 py-3">Activities</th>
                      <th className="px-3 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((c) => {
                      const followupText = c.followupDate
                        ? new Date(c.followupDate).toLocaleDateString("en-IN")
                        : "-";
                      const lastContactText = c.lastContactedAt
                        ? new Date(c.lastContactedAt).toLocaleDateString("en-IN")
                        : "Never";
                      const lastActivityText = c.lastActivityDate
                        ? new Date(c.lastActivityDate).toLocaleDateString("en-IN")
                        : "-";
                      const waMessage = "Hi " + (c.name ?? "") + ", this is from Style Lounge.";

                      return (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3">
                            <Link
                              href={"/customers/" + c.id}
                              className="font-medium text-gray-900 hover:text-blue-700"
                            >
                              {c.name ?? "(no name)"}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <CustomerTypeBadge
                              type={c.customerType}
                              doNotContact={c.doNotContact}
                            />
                          </td>
                          <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">
                            {formatPhone(c.phone)}
                          </td>
                          <td className="px-3 py-3 text-gray-600">{c.city ?? "-"}</td>
                          <td className="px-3 py-3 text-gray-600">{c.ownerName ?? "-"}</td>
                          <td className="px-3 py-3 text-gray-700 max-w-xs">
                            {c.currentRemark ? (
                              <div>
                                <div className="font-medium">{c.currentRemark}</div>
                                {c.currentNote ? (
                                  <div className="text-xs text-gray-500 truncate">{c.currentNote}</div>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-gray-400 text-xs italic">No remark</span>
                            )}
                            <div className="text-xs text-gray-500 mt-0.5">Last: {lastContactText}</div>
                          </td>
                          <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{followupText}</td>
                          <td className="px-3 py-3 text-gray-600 text-center">
                            <div>{c.totalActivities}</div>
                            <div className="text-xs text-gray-500">{lastActivityText}</div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex gap-1 flex-wrap">
                              {!c.doNotContact ? (
                                <>
                                  <a href={telLink(c.phone)} className="inline-flex items-center px-2 h-7 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs">Call</a>
                                  <a href={whatsappLink(c.phone, waMessage)} target="_blank" rel="noopener" className="inline-flex items-center px-2 h-7 rounded bg-green-50 text-green-700 hover:bg-green-100 text-xs">WA</a>
                                </>
                              ) : null}
                              <Link href={"/customers/" + c.id} className="inline-flex items-center px-2 h-7 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs">Open</Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 ? (
                <div className="flex items-center justify-between mt-4 px-1">
                  <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <Link
                      href={buildUrl({ page: String(Math.max(1, page - 1)) })}
                      aria-disabled={page === 1}
                      className={
                        "px-3 h-9 inline-flex items-center rounded text-sm " +
                        (page === 1
                          ? "bg-gray-100 text-gray-400 pointer-events-none"
                          : "bg-white border hover:bg-gray-50 text-gray-700")
                      }
                    >
                      Previous
                    </Link>
                    <Link
                      href={buildUrl({ page: String(Math.min(totalPages, page + 1)) })}
                      aria-disabled={page === totalPages}
                      className={
                        "px-3 h-9 inline-flex items-center rounded text-sm " +
                        (page === totalPages
                          ? "bg-gray-100 text-gray-400 pointer-events-none"
                          : "bg-white border hover:bg-gray-50 text-gray-700")
                      }
                    >
                      Next
                    </Link>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </Layout>
  );
}
