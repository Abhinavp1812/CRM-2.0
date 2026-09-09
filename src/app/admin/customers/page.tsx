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
import Layout from "@/components/Layout";
import AdminCustomersTable, { type AdminCustomerClientRow } from "@/components/AdminCustomersTable";

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
    followupState: (params.followupState as "active" | "closed" | "dnc" | "contacted" | "all") || "all",
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
              <option value="contacted">Contacted (reached at least once)</option>
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
            <AdminCustomersTable
              rows={rows.map((c): AdminCustomerClientRow => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                phoneFormatted: formatPhone(c.phone),
                city: c.city,
                customerType: c.customerType,
                doNotContact: c.doNotContact,
                ownerName: c.ownerName,
                currentRemark: c.currentRemark,
                currentNote: c.currentNote,
                followupText: c.followupDate ? new Date(c.followupDate).toLocaleDateString("en-IN") : "-",
                lastContactText: c.lastContactedAt ? new Date(c.lastContactedAt).toLocaleDateString("en-IN") : "Never",
                totalActivities: c.totalActivities,
                lastActivityText: c.lastActivityDate ? new Date(c.lastActivityDate).toLocaleDateString("en-IN") : "-",
                hasFollowup: c.hasFollowup,
                telHref: telLink(c.phone),
                waHref: whatsappLink(c.phone, "Hi " + (c.name ?? "") + ", this is from Style Lounge."),
              }))}
              page={page}
              totalPages={totalPages}
              prevHref={buildUrl({ page: String(Math.max(1, page - 1)) })}
              nextHref={buildUrl({ page: String(Math.min(totalPages, page + 1)) })}
            />
          )}
        </div>
      </main>
    </Layout>
  );
}
