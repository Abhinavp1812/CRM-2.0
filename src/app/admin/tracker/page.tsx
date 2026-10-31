import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import { getTrackerCounts, getTrackerRegistrations, getTrackerBookings } from "@/lib/tracker";
import {
  getBehaviourCounts,
  getWindowedBookings,
  getBookedOnce,
  getNeverBooked,
  type BehaviourBookingRow,
  type NeverBookedRow,
} from "@/lib/trackerBehaviour";
import { formatDateIN } from "@/lib/formatDate";
import { resolveTrackerParams, WINDOW_MONTH_OPTIONS } from "@/lib/trackerParams";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type BehaviourType = "repeat" | "newbookers" | "neverbooked" | "bookedonce";
const BEHAVIOUR_TYPES: BehaviourType[] = ["repeat", "newbookers", "neverbooked", "bookedonce"];

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; type?: string; page?: string; months?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const params = await searchParams;

  const { todayStr, fromStr, toStr, range, windowMonths, windowLabel, behaviourWindow } = resolveTrackerParams(params);

  const type: "registrations" | "bookings" | BehaviourType | null =
    params.type === "registrations" || params.type === "bookings"
      ? params.type
      : BEHAVIOUR_TYPES.includes(params.type as BehaviourType)
        ? (params.type as BehaviourType)
        : null;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const [counts, behaviour, registrationsResult, bookingsResult, behaviourBookings, neverBookedRows] = await Promise.all([
    getTrackerCounts(range),
    getBehaviourCounts(behaviourWindow),
    type === "registrations" ? getTrackerRegistrations(range, page, PAGE_SIZE) : Promise.resolve(null),
    type === "bookings" ? getTrackerBookings(range, page, PAGE_SIZE) : Promise.resolve(null),
    type === "repeat" || type === "newbookers"
      ? getWindowedBookings(behaviourWindow, type === "repeat", page, PAGE_SIZE)
      : type === "bookedonce"
        ? getBookedOnce(page, PAGE_SIZE)
        : Promise.resolve(null),
    type === "neverbooked" ? getNeverBooked(page, PAGE_SIZE) : Promise.resolve(null),
  ]);

  function buildHref(overrides: Record<string, string | undefined>) {
    const merged = {
      from: fromStr,
      to: toStr,
      type: type || undefined,
      months: String(windowMonths),
      page: undefined as string | undefined,
      ...overrides,
    };
    const qs = Object.entries(merged)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
      .join("&");
    return "/admin/tracker" + (qs ? "?" + qs : "");
  }

  // Downloads use the same dates and window that are on screen right now.
  function exportHref(only: string) {
    return `/api/admin/tracker/export?only=${only}&from=${fromStr}&to=${toStr}&months=${windowMonths}`;
  }

  const activeTotal =
    type === "registrations"
      ? registrationsResult?.total ?? 0
      : type === "bookings"
        ? bookingsResult?.total ?? 0
        : type === "repeat"
          ? behaviour.repeatBookings
          : type === "newbookers"
            ? behaviour.newBookers
            : type === "neverbooked"
              ? behaviour.neverBooked
              : type === "bookedonce"
                ? behaviour.bookedOnce
                : 0;
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
        <input type="hidden" name="months" value={windowMonths} />
        <button type="submit" className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
        <a
          href={exportHref("all")}
          download
          title="One workbook: a summary sheet plus a sheet for every list below, using the dates and window currently selected"
          className="ml-auto px-4 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700"
        >
          Download everything (Excel)
        </a>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 max-w-2xl">
        <TrackerCard
          href={buildHref({ type: "registrations" })}
          downloadHref={exportHref("registrations")}
          active={type === "registrations"}
          activeClass="bg-blue-50 border-blue-300"
          label="Registrations"
          value={counts.registrations}
          note={`${fromStr} to ${toStr}`}
        />
        <TrackerCard
          href={buildHref({ type: "bookings" })}
          downloadHref={exportHref("bookings")}
          active={type === "bookings"}
          activeClass="bg-emerald-50 border-emerald-300"
          label="Bookings"
          value={counts.bookings}
          note={`${fromStr} to ${toStr}`}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mr-2">Customer behaviour</h2>
        <span className="text-xs text-slate-400">Repeat bookings and new bookers cover the</span>
        {WINDOW_MONTH_OPTIONS.map((m) => (
          <Link
            key={m}
            href={buildHref({ months: String(m) })}
            className={
              "px-2.5 h-7 inline-flex items-center rounded-lg text-xs font-medium border " +
              (m === windowMonths
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")
            }
          >
            {m === 0 ? "All time" : m + (m === 1 ? " month" : " months")}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <TrackerCard
          href={buildHref({ type: "repeat" })}
          downloadHref={exportHref("repeat")}
          active={type === "repeat"}
          activeClass="bg-violet-50 border-violet-300"
          label="Repeat bookings"
          value={behaviour.repeatBookings}
          note={`Paid bookings in the ${windowLabel} from customers who had booked before - ${behaviour.repeatCustomers.toLocaleString()} returning customers`}
        />
        <TrackerCard
          href={buildHref({ type: "newbookers" })}
          downloadHref={exportHref("newbookers")}
          active={type === "newbookers"}
          activeClass="bg-violet-50 border-violet-300"
          label="New bookers"
          value={behaviour.newBookers}
          note={`Customers whose very first paid booking was in the ${windowLabel}`}
        />
        <TrackerCard
          href={buildHref({ type: "neverbooked" })}
          downloadHref={exportHref("neverbooked")}
          active={type === "neverbooked"}
          activeClass="bg-violet-50 border-violet-300"
          label="Registered, never booked"
          value={behaviour.neverBooked}
          note="All time: registered customers with no paid booking yet"
        />
        <TrackerCard
          href={buildHref({ type: "bookedonce" })}
          downloadHref={exportHref("bookedonce")}
          active={type === "bookedonce"}
          activeClass="bg-violet-50 border-violet-300"
          label="Booked once, never again"
          value={behaviour.bookedOnce}
          note="All time: customers with exactly one paid booking so far"
        />
      </div>
      <p className="text-xs text-slate-400 -mt-3 mb-6">
        Only paid bookings count here (payment Success or Partially Paid, not cancelled) - failed, pending and refunded orders are left out.
        The Registrations and Bookings cards above count every order.
      </p>

      {type === "registrations" && registrationsResult && (
        <RegistrationsTable rows={registrationsResult.rows} />
      )}
      {type === "bookings" && bookingsResult && (
        <BookingsTable rows={bookingsResult.rows} />
      )}
      {(type === "repeat" || type === "newbookers" || type === "bookedonce") && behaviourBookings && (
        <BehaviourBookingsTable
          rows={behaviourBookings as BehaviourBookingRow[]}
          showNumber={type === "repeat"}
          empty={
            type === "repeat"
              ? `No repeat bookings in the ${windowLabel}.`
              : type === "newbookers"
                ? `No new bookers in the ${windowLabel}.`
                : "No customers with exactly one booking."
          }
        />
      )}
      {type === "neverbooked" && neverBookedRows && <NeverBookedTable rows={neverBookedRows as NeverBookedRow[]} />}

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

/** A count card: the body opens the customer list, the bottom link downloads just that list as Excel. */
function TrackerCard({
  href,
  downloadHref,
  active,
  activeClass,
  label,
  value,
  note,
}: {
  href: string;
  downloadHref: string;
  active: boolean;
  activeClass: string;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className={"rounded-xl border shadow-sm flex flex-col " + (active ? activeClass : "bg-white border-gray-200")}>
      <Link href={href} className="block p-5 pb-3 flex-1 hover:bg-black/[0.02] rounded-t-xl transition-colors">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-3xl font-bold mt-1 text-gray-900">{value.toLocaleString()}</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{note}</p>
        <p className="text-xs text-blue-600 font-medium mt-2">Click to see who &rarr;</p>
      </Link>
      <div className="px-5 pb-4">
        <a
          href={downloadHref}
          download
          className="inline-flex items-center h-7 px-2.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium transition-colors"
        >
          Download Excel
        </a>
      </div>
    </div>
  );
}

function BehaviourBookingsTable({
  rows,
  showNumber,
  empty,
}: {
  rows: BehaviourBookingRow[];
  showNumber: boolean;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">{empty}</div>;
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
            <th className="px-3 py-3">Salon</th>
            <th className="px-3 py-3">Order Date</th>
            <th className="px-3 py-3">Booking Date</th>
            {showNumber && <th className="px-3 py-3">Booking #</th>}
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3 text-right">Amount</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((b) => (
            <tr key={b.bookingId} className="hover:bg-gray-50">
              <td className="px-3 py-3 font-medium text-gray-900">{b.customerName ?? "(no name)"}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{b.phone}</td>
              <td className="px-3 py-3 text-gray-600">{b.city ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{b.ownerName ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{b.salonName ?? "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{b.orderDate ? formatDateIN(b.orderDate) : "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{b.bookingDate ? formatDateIN(b.bookingDate) : "-"}</td>
              {showNumber && <td className="px-3 py-3 text-gray-700">{b.bookingNumber}</td>}
              <td className="px-3 py-3 text-gray-600">{b.status ?? "-"}</td>
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

function NeverBookedTable({ rows }: { rows: NeverBookedRow[] }) {
  if (rows.length === 0) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">Every registered customer has booked.</div>;
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
            <th className="px-3 py-3">Registered</th>
            <th className="px-3 py-3">Followup</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.customerId} className="hover:bg-gray-50">
              <td className="px-3 py-3 font-medium text-gray-900">{r.customerName ?? "(no name)"}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3 text-gray-600">{r.city ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{r.ownerName ?? "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{r.registeredAt ? formatDateIN(r.registeredAt) : "-"}</td>
              <td className="px-3 py-3 text-gray-600">{r.hasActiveFollowup ? "Active" : "Closed"}</td>
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
