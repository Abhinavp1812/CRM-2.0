import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  getTodayFollowups,
  getFollowupCounts,
  getFilteredCount,
  getActiveRemarkOptions,
  formatPhone,
  whatsappLink,
  telLink,
  type FollowupFilter,
  type BookingFlavor,
} from "@/lib/followups";
import { CustomerTypeBadge, FollowupStatusBadge } from "@/components/StatusBadge";
import Layout from "@/components/Layout";
import FollowupEditButton from "@/components/FollowupEditButton";
import SearchBar from "@/components/SearchBar";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const validFilters: FollowupFilter[] = [
    "all", "cold", "booked", "todays_followup", "pipeline", "action_required", "registered", "booked_type",
  ];
  const filter: FollowupFilter = validFilters.includes(params.filter as FollowupFilter)
    ? (params.filter as FollowupFilter)
    : "all";

  const isAdmin = session.user.role === "ADMIN";
  const scope = { userId: isAdmin ? null : session.user.id };

  const [followups, counts, filteredCount, remarkOptions] = await Promise.all([
    getTodayFollowups(scope, page, PAGE_SIZE, filter),
    getFollowupCounts(scope),
    getFilteredCount(scope, filter),
    getActiveRemarkOptions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  return (
    <Layout>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isAdmin ? "All Followups" : (session.user.name || "My") + "'s Followups"}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {filteredCount.toLocaleString()} <span className="text-slate-400">of</span> {counts.total.toLocaleString()} customers
          </p>
        </div>
        <div className="w-full sm:w-auto sm:max-w-xs">
          <SearchBar />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Cold" value={counts.cold} color="purple" />
        <StatCard label="Booked" value={counts.booked} color="green" />
        <StatCard label="Today" value={counts.todaysFollowup} color="blue" />
        <StatCard label="Pipeline" value={counts.pipeline} color="amber" />
        <StatCard label="Action Required" value={counts.actionRequired} color="red" />
      </div>

      {/* Filter tabs */}
      <FilterTabs currentFilter={filter} counts={counts} />

      {filteredCount === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
          <p className="text-slate-400 text-sm">No followups in this view.</p>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {followups.map((f) => (
              <FollowupCard key={f.customerId} f={f} remarkOptions={remarkOptions} showOwner={isAdmin} />
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-gray-200">
                  <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Customer</th>
                    {isAdmin && <th className="px-4 py-3">Owner</th>}
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">City</th>
                    <th className="px-4 py-3">Last Booking</th>
                    <th className="px-4 py-3">Last Contact</th>
                    <th className="px-4 py-3">Followup</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {followups.map((f) => (
                    <FollowupRow key={f.customerId} f={f} remarkOptions={remarkOptions} showOwner={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination page={page} totalPages={totalPages} filter={filter} />
        </>
      )}
    </Layout>
  );
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

function FilterTabs({
  currentFilter,
  counts,
}: {
  currentFilter: FollowupFilter;
  counts: {
    total: number; cold: number; booked: number; todaysFollowup: number;
    pipeline: number; actionRequired: number; registered: number; bookedType: number;
  };
}) {
  const tabs: { id: FollowupFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.total },
    { id: "cold", label: "Cold", count: counts.cold },
    { id: "booked", label: "Booked", count: counts.booked },
    { id: "todays_followup", label: "Today", count: counts.todaysFollowup },
    { id: "pipeline", label: "Pipeline", count: counts.pipeline },
    { id: "action_required", label: "Action Required", count: counts.actionRequired },
    { id: "registered", label: "Registered", count: counts.registered },
    { id: "booked_type", label: "Booked (type)", count: counts.bookedType },
  ];

  return (
    <div className="flex items-end gap-0.5 mb-4 border-b border-gray-200 overflow-x-auto pb-px">
      {tabs.map((t) => {
        const active = currentFilter === t.id;
        const href = t.id === "all" ? "/" : "/?filter=" + t.id;
        return (
          <Link
            key={t.id}
            href={href}
            className={
              "flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap " +
              (active
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300")
            }
          >
            {t.label}
            <span className={
              "text-xs px-1.5 py-0.5 rounded-full font-semibold " +
              (active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")
            }>
              {t.count.toLocaleString()}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, filter }: { page: number; totalPages: number; filter: FollowupFilter; }) {
  if (totalPages <= 1) return null;
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const filterParam = filter !== "all" ? "&filter=" + filter : "";
  return (
    <div className="flex items-center justify-between mt-4 px-1">
      <p className="text-sm text-slate-500">Page <span className="font-medium text-slate-700">{page}</span> of {totalPages}</p>
      <div className="flex gap-2">
        <Link
          href={"/?page=" + prevPage + filterParam}
          className={"px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium " + (page === 1 ? "bg-slate-100 text-slate-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-slate-50 text-slate-700 shadow-sm")}
        >
          ← Previous
        </Link>
        <Link
          href={"/?page=" + nextPage + filterParam}
          className={"px-3 h-9 inline-flex items-center rounded-lg text-sm font-medium " + (page === totalPages ? "bg-slate-100 text-slate-400 pointer-events-none" : "bg-white border border-gray-200 hover:bg-slate-50 text-slate-700 shadow-sm")}
        >
          Next →
        </Link>
      </div>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type RemarkOption = Awaited<ReturnType<typeof getActiveRemarkOptions>>[number];
type FollowupData = Awaited<ReturnType<typeof getTodayFollowups>>[number];

function toLocalIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function BookingFlavorBadge({ flavor }: { flavor: BookingFlavor }) {
  if (!flavor) return null;
  const styles: Record<string, { label: string; color: string }> = {
    AWAITING_SERVICE: { label: "Awaiting", color: "bg-blue-100 text-blue-700" },
    PAID_NOT_DONE: { label: "Paid, not done", color: "bg-orange-100 text-orange-700" },
    COMPLETED: { label: "Completed", color: "bg-emerald-100 text-emerald-700" },
    IN_PROGRESS: { label: "In progress", color: "bg-yellow-100 text-yellow-700" },
  };
  const s = styles[flavor];
  if (!s) return null;
  return <span className={"inline-block px-1.5 py-0.5 text-xs rounded-full font-medium " + s.color}>{s.label}</span>;
}

// ── Desktop table row ─────────────────────────────────────────────────────────

function FollowupRow({
  f,
  remarkOptions,
  showOwner,
}: {
  f: FollowupData;
  remarkOptions: RemarkOption[];
  showOwner: boolean;
}) {
  const lastBookingText = f.lastBookingDate ? new Date(f.lastBookingDate).toLocaleDateString("en-IN") : "-";
  const lastContactText = f.lastContactedAt ? new Date(f.lastContactedAt).toLocaleDateString("en-IN") : "Never";
  const followupText = new Date(f.effectiveFollowupDate).toLocaleDateString("en-IN");
  const followupIso = toLocalIso(new Date(f.nextFollowupDate));
  const waMessage = "Hi " + (f.customerName ?? "") + ", this is from Style Lounge.";

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3"><FollowupStatusBadge status={f.status} /></td>
      <td className="px-4 py-3">
        <Link href={"/customers/" + f.customerId} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
          {f.customerName ?? "(no name)"}
        </Link>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {f.untouched && !f.isBooked && !f.isCancelledRecovery && (
            <span className="inline-block px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-medium">Cold</span>
          )}
          {f.isCancelledRecovery && (
            <span className="inline-block px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">Recover</span>
          )}
          <BookingFlavorBadge flavor={f.bookingFlavor} />
          {f.isStale && (
            <span className="inline-block px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">Stale</span>
          )}
          {f.currentRemark && <span className="text-xs text-slate-400">{f.currentRemark}</span>}
        </div>
      </td>
      {showOwner && (
        <td className="px-4 py-3 text-sm text-slate-600">{f.ownerName || "-"}</td>
      )}
      <td className="px-4 py-3"><CustomerTypeBadge type={f.customerType} doNotContact={f.doNotContact} /></td>
      <td className="px-4 py-3 font-mono text-slate-600 text-xs whitespace-nowrap">{formatPhone(f.phone)}</td>
      <td className="px-4 py-3 text-slate-500 text-sm">{f.city ?? "-"}</td>
      <td className="px-4 py-3 text-slate-600 text-sm">
        {lastBookingText}
        {f.lastBookingSalon && <div className="text-xs text-slate-400">{f.lastBookingSalon}</div>}
      </td>
      <td className="px-4 py-3 text-slate-600 text-sm">{lastContactText}</td>
      <td className="px-4 py-3 text-slate-700 text-sm whitespace-nowrap font-medium">{followupText}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1.5 flex-wrap">
          <a href={telLink(f.phone)} className="inline-flex items-center justify-center px-2.5 h-7 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium transition-colors">Call</a>
          <a href={whatsappLink(f.phone, waMessage)} target="_blank" rel="noopener" className="inline-flex items-center justify-center px-2.5 h-7 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium transition-colors">WA</a>
          <FollowupEditButton
            customerId={f.customerId}
            customerName={f.customerName}
            currentRemark={f.currentRemark}
            currentNote={f.currentNote}
            currentFollowupDate={followupIso}
            remarkOptions={remarkOptions}
          />
          <Link href={"/customers/" + f.customerId} className="inline-flex items-center justify-center px-2.5 h-7 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium transition-colors">Open</Link>
        </div>
      </td>
    </tr>
  );
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function FollowupCard({
  f,
  remarkOptions,
  showOwner,
}: {
  f: FollowupData;
  remarkOptions: RemarkOption[];
  showOwner: boolean;
}) {
  const followupIso = toLocalIso(new Date(f.nextFollowupDate));
  const followupText = new Date(f.effectiveFollowupDate).toLocaleDateString("en-IN");
  const lastContactText = f.lastContactedAt ? new Date(f.lastContactedAt).toLocaleDateString("en-IN") : "Never";
  const waMessage = "Hi " + (f.customerName ?? "") + ", this is from Style Lounge.";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Top row: status + badges */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 flex-wrap">
        <FollowupStatusBadge status={f.status} />
        <CustomerTypeBadge type={f.customerType} doNotContact={f.doNotContact} />
        {f.untouched && !f.isBooked && !f.isCancelledRecovery && (
          <span className="inline-block px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full font-medium">Cold</span>
        )}
        {f.isCancelledRecovery && (
          <span className="inline-block px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">Recover</span>
        )}
        <BookingFlavorBadge flavor={f.bookingFlavor} />
        {f.isStale && (
          <span className="inline-block px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">Stale</span>
        )}
      </div>

      {/* Name + remark */}
      <div className="px-4 pb-2">
        <Link href={"/customers/" + f.customerId} className="text-base font-bold text-gray-900 hover:text-blue-600 transition-colors block">
          {f.customerName ?? "(no name)"}
        </Link>
        {f.currentRemark && (
          <p className="text-xs text-slate-400 mt-0.5">Last: {f.currentRemark}</p>
        )}
      </div>

      {/* Info row */}
      <div className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-mono">{formatPhone(f.phone)}</span>
        {f.city && <span>{f.city}</span>}
        {showOwner && f.ownerName && <span>Owner: <strong className="text-slate-700">{f.ownerName}</strong></span>}
        <span>Followup: <strong className="text-slate-700">{followupText}</strong></span>
        <span>Last contact: {lastContactText}</span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-100 bg-slate-50">
        <a href={telLink(f.phone)} className="flex-1 inline-flex items-center justify-center h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors">
          Call
        </a>
        <a href={whatsappLink(f.phone, waMessage)} target="_blank" rel="noopener" className="flex-1 inline-flex items-center justify-center h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium transition-colors">
          WhatsApp
        </a>
        <FollowupEditButton
          customerId={f.customerId}
          customerName={f.customerName}
          currentRemark={f.currentRemark}
          currentNote={f.currentNote}
          currentFollowupDate={followupIso}
          remarkOptions={remarkOptions}
        />
        <Link href={"/customers/" + f.customerId} className="inline-flex items-center justify-center h-9 px-3 rounded-lg bg-white border border-gray-200 text-slate-600 hover:bg-slate-50 text-sm font-medium transition-colors">
          Open
        </Link>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: "red" | "amber" | "blue" | "green" | "purple"; }) {
  const styles = {
    red: "bg-red-50 border-red-100 text-red-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    green: "bg-emerald-50 border-emerald-100 text-emerald-700",
    purple: "bg-purple-50 border-purple-100 text-purple-700",
  };
  return (
    <div className={"rounded-xl p-3 border shadow-sm " + styles[color]}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value.toLocaleString()}</p>
    </div>
  );
}
