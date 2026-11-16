import Link from "next/link";
import {
  getAdminCustomers,
  getAllUsersForFilter,
  getActiveRemarkOptions,
  getActiveLeadSources,
  formatPhone,
  whatsappLink,
  telLink,
  NONE_VALUE,
  type AdminCustomerFilter,
} from "@/lib/followups";
import { buildQuery, listParam, oneParam, type SearchParamsRecord } from "@/lib/params";
import MultiSelect from "@/components/MultiSelect";
import AdminCustomersTable, { type AdminCustomerClientRow } from "@/components/AdminCustomersTable";
import { formatDateIN } from "@/lib/formatDate";

const PAGE_SIZE = 50;

/** page, search (or legacy q), and the multi-value filters ownerId, customerType, followupState, remark, leadTemperature, leadSource. */
export type CustomersSearchParams = SearchParamsRecord;

const TYPE_OPTIONS = [
  { value: "NEW_REGISTRATION", label: "Registered" },
  { value: "CUSTOMER", label: "Booked" },
];
const STATE_OPTIONS = [
  { value: "active", label: "Active followup" },
  { value: "contacted", label: "Contacted (reached at least once)" },
  { value: "closed", label: "Closed (no followup)" },
  { value: "dnc", label: "DNC" },
];
const TEMP_OPTIONS = [
  { value: "HOT", label: "Hot" },
  { value: "WARM", label: "Warm" },
  { value: "COLD", label: "Cold" },
];
const only = <T extends string>(values: string[], allowed: { value: string }[]) =>
  values.filter((v) => allowed.some((a) => a.value === v)) as T[];

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
  const page = Math.max(1, parseInt(oneParam(params.page) || "1", 10) || 1);

  const filter: AdminCustomerFilter = {
    // `q` is the old /customers search param - still accepted so old links work.
    search: oneParam(params.search) || oneParam(params.q) || undefined,
    ownerId: restrictToOwnerId ? [restrictToOwnerId] : listParam(params.ownerId),
    customerType: only(listParam(params.customerType), TYPE_OPTIONS),
    followupState: only(listParam(params.followupState), STATE_OPTIONS),
    remark: listParam(params.remark),
    leadTemperature: only(listParam(params.leadTemperature), TEMP_OPTIONS),
    leadSource: listParam(params.leadSource),
  };

  const [{ rows, total }, users, remarkOptions, leadSources] = await Promise.all([
    getAdminCustomers(filter, page, PAGE_SIZE),
    isAdmin ? getAllUsersForFilter() : Promise.resolve([]),
    getActiveRemarkOptions(),
    getActiveLeadSources(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildUrl(overrides: Record<string, string | undefined>) {
    return (
      basePath +
      buildQuery({
        search: filter.search,
        ownerId: restrictToOwnerId ? undefined : filter.ownerId,
        customerType: filter.customerType,
        followupState: filter.followupState,
        remark: filter.remark,
        leadTemperature: filter.leadTemperature,
        leadSource: filter.leadSource,
        ...overrides,
      })
    );
  }

  // Keep a value that came from a link (e.g. a deactivated campaign) selectable.
  const withExtras = (opts: { value: string; label: string }[], chosen: string[] = []) => [
    ...opts,
    ...chosen.filter((v) => !opts.some((o) => o.value === v)).map((v) => ({ value: v, label: v })),
  ];

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
          <MultiSelect
            name="ownerId"
            allLabel="All owners"
            selected={filter.ownerId ?? []}
            options={[...users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })), { value: NONE_VALUE, label: "Unassigned" }]}
          />
        )}
        <MultiSelect name="customerType" allLabel="All types" selected={filter.customerType ?? []} options={TYPE_OPTIONS} />
        <MultiSelect name="followupState" allLabel="All states" selected={filter.followupState ?? []} options={STATE_OPTIONS} />
        <MultiSelect
          name="remark"
          allLabel="Any current remark"
          selected={filter.remark ?? []}
          options={withExtras(remarkOptions.map((r) => ({ value: r.label, label: r.label })), filter.remark)}
        />
        <MultiSelect name="leadTemperature" allLabel="Any temperature" selected={filter.leadTemperature ?? []} options={TEMP_OPTIONS} />
        <MultiSelect
          name="leadSource"
          allLabel="Any lead source"
          selected={filter.leadSource ?? []}
          options={[
            ...withExtras(leadSources.map((x) => ({ value: x.label, label: x.label })), filter.leadSource?.filter((v) => v !== NONE_VALUE)),
            { value: NONE_VALUE, label: "No lead source" },
          ]}
        />
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
