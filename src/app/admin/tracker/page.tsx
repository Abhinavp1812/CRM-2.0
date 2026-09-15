import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { getTrackerCounts, getTrackerRegistrations, getTrackerBookings } from "@/lib/tracker";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DEFAULT_RANGE_DAYS = 7;

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseDateParam(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; type?: string; page?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const params = await searchParams;

  const todayStr = todayIsoIST();
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const defaultTo = new Date(ty, tm - 1, td);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - (DEFAULT_RANGE_DAYS - 1));

  const from = parseDateParam(params.from) || defaultFrom;
  const to = parseDateParam(params.to) || defaultTo;
  const fromStr = params.from && parseDateParam(params.from) ? params.from : isoDate(from.getFullYear(), from.getMonth() + 1, from.getDate());
  const toStr = params.to && parseDateParam(params.to) ? params.to : isoDate(to.getFullYear(), to.getMonth() + 1, to.getDate());

  const toExclusive = new Date(to);
  toExclusive.setDate(toExclusive.getDate() + 1);

  const type = params.type === "registrations" || params.type === "bookings" ? params.type : null;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const range = { from, to: toExclusive };

  const [counts, registrationsResult, bookingsResult] = await Promise.all([
    getTrackerCounts(range),
    type === "registrations" ? getTrackerRegistrations(range, page, PAGE_SIZE) : Promise.resolve(null),
    type === "bookings" ? getTrackerBookings(range, page, PAGE_SIZE) : Promise.resolve(null),
  ]);

  function buildHref(overrides: Record<string, string | undefined>) {
    const merged = { from: fromStr, to: toStr, type: type || undefined, page: undefined as string | undefined, ...overrides };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
      .join("&");
    return "/admin/tracker" + (qs ? "?" + qs : "");
  }

  const activeResult = type === "registrations" ? registrationsResult : type === "bookings" ? bookingsResult : null;
  const activeTotal = activeResult?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tracker</h1>
        <p className="text-sm text-slate-500 mt-1">Registrations and bookings within a date range, with the full customer list behind each count.</p>
      </div>

      <form method="GET" className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">From</label>
          <input type="date" name="from" defaultValue={fromStr} max={todayStr} className="border rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">To</label>
          <input type="date" name="to" defaultValue={toStr} max={todayStr} className="border rounded px-2 py-1.5 text-sm" />
        </div>
        {type && <input type="hidden" name="type" value={type} />}
        <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-2xl">
        <Link
          href={buildHref({ type: "registrations" })}
          className={
            "rounded-xl p-5 border shadow-sm block hover:shadow transition-shadow " +
            (type === "registrations" ? "bg-blue-50 border-blue-300" : "bg-white border-gray-200")
          }
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Registrations</p>
          <p className="text-3xl font-bold mt-1 text-gray-900">{counts.registrations.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">{fromStr} to {toStr} - click to see who</p>
        </Link>
        <Link
          href={buildHref({ type: "bookings" })}
          className={
            "rounded-xl p-5 border shadow-sm block hover:shadow transition-shadow " +
            (type === "bookings" ? "bg-emerald-50 border-emerald-300" : "bg-white border-gray-200")
          }
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bookings</p>
          <p className="text-3xl font-bold mt-1 text-gray-900">{counts.bookings.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">{fromStr} to {toStr} - click to see who</p>
        </Link>
      </div>

      {type === "registrations" && registrationsResult && (
        <RegistrationsTable rows={registrationsResult.rows} />
      )}
      {type === "bookings" && bookingsResult && (
        <BookingsTable rows={bookingsResult.rows} />
      )}

      {type && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Link
              href={buildHref({ page: String(Math.max(1, page - 1)) })}
              className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
            >
              Previous
            </Link>
            <Link
              href={buildHref({ page: String(Math.min(totalPages, page + 1)) })}
              className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === totalPages ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </Layout>
  );
}

function RegistrationsTable({ rows }: { rows: Awaited<ReturnType<typeof getTrackerRegistrations>>["rows"] }) {
  if (rows.length === 0) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No registrations in this range.</div>;
  }
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">City</th>
            <th className="px-3 py-3">Owner</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Onboarding Date</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-3 py-3 font-medium text-gray-900">{r.customerName ?? "(no name)"}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3 text-gray-600">{r.city ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{r.ownerName ?? "-"}</td>
              <td className="px-3 py-3">
                <span className="inline-block px-1.5 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                  {r.customerType === "CUSTOMER" ? "Booked" : "Registered"}
                </span>
              </td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{r.onboardingDate ? formatDateIN(r.onboardingDate) : "-"}</td>
              <td className="px-3 py-3">
                <Link href={"/customers/" + r.customerId} className="text-blue-600 hover:underline text-xs">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookingsTable({ rows }: { rows: Awaited<ReturnType<typeof getTrackerBookings>>["rows"] }) {
  if (rows.length === 0) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No bookings in this range.</div>;
  }
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">Owner</th>
            <th className="px-3 py-3">Salon</th>
            <th className="px-3 py-3">Order Date</th>
            <th className="px-3 py-3">Booking Date</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Payment</th>
            <th className="px-3 py-3 text-right">Amount</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((b) => (
            <tr key={b.id} className="hover:bg-gray-50">
              <td className="px-3 py-3 font-medium text-gray-900">{b.customerName ?? "(no name)"}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{b.phone}</td>
              <td className="px-3 py-3 text-gray-600">{b.ownerName ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{b.salonName ?? "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{b.orderDate ? formatDateIN(b.orderDate) : "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{b.bookingDate ? formatDateIN(b.bookingDate) : "-"}</td>
              <td className="px-3 py-3 text-gray-600">{b.status ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{b.paymentStatus ?? "-"}</td>
              <td className="px-3 py-3 text-right font-semibold text-gray-900">
                {b.grandTotal ? "₹" + Math.round(Number(b.grandTotal)).toLocaleString("en-IN") : "-"}
              </td>
              <td className="px-3 py-3">
                <Link href={"/customers/" + b.customerId} className="text-blue-600 hover:underline text-xs">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
