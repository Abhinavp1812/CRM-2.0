import Link from "next/link";
import {
  getAdminCustomers,
  getAllUsersForFilter,
  getActiveRemarkOptions,
  getActiveLeadSources,
  formatPhone,
  whatsappLink,
  telLink,
  type AdminCustomerFilter,
} from "@/lib/followups";
import AdminCustomersTable, { type AdminCustomerClientRow } from "@/components/AdminCustomersTable";
import { formatDateIN } from "@/lib/formatDate";

const PAGE_SIZE = 50;

export interface CustomersSearchParams {
  page?: string;
  search?: string;
  q?: string;
  ownerId?: string;
  customerType?: string;
  followupState?: string;
  remark?: string;
  leadTemperature?: string;
  leadSource?: string;
}

/**
 * Filterable customer list shared by /customers and /admin/customers.
 * Admins see everyone and can filter by owner / bulk-edit followup dates;
 * agents are always limited to their own customers (`restrictToOwnerId`).
 */
export default async function CustomersBrowser({
  params,
  basePath,
  isAdmin,
  restrictToOwnerId,
}: {
  params: CustomersSearchParams;
  basePath: string;
  isAdmin: boolean;
  restrictToOwnerId?: string;
}) {
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const filter: AdminCustomerFilter = {
    // `q` is the old /customers search param - still accepted so old links work.
    search: params.search || params.q || undefined,
    ownerId: restrictToOwnerId ?? (params.ownerId || undefined),
    customerType: (params.customerType as "NEW_REGISTRATION" | "CUSTOMER" | "all") || "all",
    followupState: (params.followupState as "active" | "closed" | "dnc" | "contacted" | "all") || "all",
    remark: params.remark || undefined,
    leadTemperature: (params.leadTemperature as "HOT" | "WARM" | "COLD") || undefined,
    leadSource: params.leadSource || undefined,
  };

  const [{ rows, total }, users, remarkOptions, leadSources] = await Promise.all([
    getAdminCustomers(filter, page, PAGE_SIZE),
    isAdmin ? getAllUsersForFilter() : Promise.resolve([]),
    getActiveRemarkOptions(),
    getActiveLeadSources(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildUrl(overrides: Record<string, string | undefined>) {
    const merged = {
      search: filter.search,
      ownerId: restrictToOwnerId ? undefined : filter.ownerId,
      customerType: filter.customerType !== "all" ? filter.customerType : undefined,
      followupState: filter.followupState !== "all" ? filter.followupState : undefined,
      remark: filter.remark,
      leadTemperature: filter.leadTemperature,
      leadSource: filter.leadSource,
      ...overrides,
    };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
      .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
      .join("&");
    return basePath + (qs ? "?" + qs : "");
  }

  return (
    <>
      <form method="GET" action={basePath} className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          type="text"
          name="search"
          defaultValue={filter.search || ""}
          placeholder="Search name or phone"
          className="border rounded px-2 py-1.5 text-sm md:col-span-2"
        />
        {isAdmin && (
          <select name="ownerId" defaultValue={filter.ownerId || ""} className="border rounded px-2 py-1.5 text-sm">
            <option value="">All owners</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role})
              </option>
            ))}
          </select>
        )}
        <select name="customerType" defaultValue={filter.customerType || "all"} className="border rounded px-2 py-1.5 text-sm">
          <option value="all">All types</option>
          <option value="NEW_REGISTRATION">Registered</option>
          <option value="CUSTOMER">Booked</option>
        </select>
        <select name="followupState" defaultValue={filter.followupState || "all"} className="border rounded px-2 py-1.5 text-sm">
          <option value="all">All states</option>
          <option value="active">Active followup</option>
          <option value="contacted">Contacted (reached at least once)</option>
          <option value="closed">Closed (no followup)</option>
          <option value="dnc">DNC</option>
        </select>
        <select name="remark" defaultValue={filter.remark || ""} className="border rounded px-2 py-1.5 text-sm">
          <option value="">Any current remark</option>
          {remarkOptions.map((r) => (
            <option key={r.label} value={r.label}>
              {r.label}
            </option>
          ))}
        </select>
        <select name="leadTemperature" defaultValue={filter.leadTemperature || ""} className="border rounded px-2 py-1.5 text-sm">
          <option value="">Any temperature</option>
          <option value="HOT">Hot</option>
          <option value="WARM">Warm</option>
          <option value="COLD">Cold</option>
        </select>
        <select name="leadSource" defaultValue={filter.leadSource || ""} className="border rounded px-2 py-1.5 text-sm">
          <option value="">Any lead source</option>
          {leadSources.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
          {/* Keep a deactivated campaign selectable when a link points at it. */}
          {filter.leadSource && !leadSources.some((s) => s.label === filter.leadSource) && (
            <option value={filter.leadSource}>{filter.leadSource}</option>
          )}
        </select>
        <div className="md:col-span-5 flex items-center gap-2 justify-end">
          <span className="mr-auto text-sm text-gray-600">{total.toLocaleString()} matching</span>
          <Link href={basePath} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded">
            Clear
          </Link>
          <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            Apply filters
          </button>
        </div>
      </form>

      {total === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No customers match these filters.</div>
      ) : (
        <AdminCustomersTable
          rows={rows.map(
            (c): AdminCustomerClientRow => ({
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
              leadTemperature: c.leadTemperature,
              leadSource: c.leadSource,
              followupText: c.followupDate ? formatDateIN(c.followupDate) : "-",
              lastContactText: c.lastContactedAt ? formatDateIN(c.lastContactedAt) : "Never",
              totalActivities: c.totalActivities,
              lastActivityText: c.lastActivityDate ? formatDateIN(c.lastActivityDate) : "-",
              hasFollowup: c.hasFollowup,
              telHref: telLink(c.phone),
              waHref: whatsappLink(c.phone, "Hi " + (c.name ?? "") + ", this is from Style Lounge."),
            })
          )}
          page={page}
          totalPages={totalPages}
          prevHref={buildUrl({ page: String(Math.max(1, page - 1)) })}
          nextHref={buildUrl({ page: String(Math.min(totalPages, page + 1)) })}
          isAdmin={isAdmin}
        />
      )}
    </>
  );
}
