import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { getTrackerCounts, getTrackerRegistrations, getTrackerBookings } from "@/lib/tracker";
import {
  getBehaviourCounts,
  getWindowedBookings,
  getBookedOnce,
  getNeverBooked,
  type BehaviourBookingRow,
} from "@/lib/trackerBehaviour";
import { formatDateIN } from "@/lib/formatDate";
import { resolveTrackerParams } from "@/lib/trackerParams";

export const maxDuration = 60;

// Far above any real list here (the biggest is ~15k), but keeps one sheet
// comfortably inside what Excel and a 60-second request can handle.
const ROW_LIMIT = 100000;

const KEYS = ["registrations", "bookings", "repeat", "newbookers", "neverbooked", "bookedonce"] as const;
type Key = (typeof KEYS)[number];

type Cell = string | number;
interface SheetData {
  name: string;
  headers: string[];
  rows: Record<string, Cell>[];
}

const date = (v: Date | null) => (v ? formatDateIN(v) : "");
const amount = (v: string | null) => (v ? Math.round(Number(v) * 100) / 100 : "");

function behaviourRows(rows: BehaviourBookingRow[], withNumber: boolean): Pick<SheetData, "headers" | "rows"> {
  const headers = [
    "Customer", "Phone", "City", "Owner", "Salon", "Order No", "Order Date", "Booking Date",
    ...(withNumber ? ["Booking #"] : []), "Status", "Amount",
  ];
  return {
    headers,
    rows: rows.map((b) => ({
      Customer: b.customerName ?? "",
      Phone: b.phone,
      City: b.city ?? "",
      Owner: b.ownerName ?? "",
      Salon: b.salonName ?? "",
      "Order No": b.orderNo ?? "",
      "Order Date": date(b.orderDate),
      "Booking Date": date(b.bookingDate),
      ...(withNumber ? { "Booking #": b.bookingNumber } : {}),
      Status: b.status ?? "",
      Amount: amount(b.grandTotal),
    })),
  };
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const only = sp.get("only") || "all";
  if (only !== "all" && !KEYS.includes(only as Key)) {
    return new Response(JSON.stringify({ error: "Unknown export" }), { status: 400 });
  }

  const { todayStr, fromStr, toStr, range, windowLabel, behaviourWindow } = resolveTrackerParams({
    from: sp.get("from"),
    to: sp.get("to"),
    months: sp.get("months"),
  });
  const wanted: Key[] = only === "all" ? [...KEYS] : [only as Key];

  const builders: Record<Key, () => Promise<SheetData>> = {
    registrations: async () => {
      const { rows } = await getTrackerRegistrations(range, 1, ROW_LIMIT);
      return {
        name: "Registrations",
        headers: ["Customer", "Phone", "City", "Owner", "Type", "Onboarding Date"],
        rows: rows.map((r) => ({
          Customer: r.customerName ?? "",
          Phone: r.phone,
          City: r.city ?? "",
          Owner: r.ownerName ?? "",
          Type: r.customerType === "CUSTOMER" ? "Booked" : "Registered",
          "Onboarding Date": date(r.onboardingDate),
        })),
      };
    },
    bookings: async () => {
      const { rows } = await getTrackerBookings(range, 1, ROW_LIMIT);
      return {
        name: "Bookings",
        headers: ["Customer", "Phone", "City", "Owner", "Salon", "Order No", "Order Date", "Booking Date", "Status", "Payment", "Amount"],
        rows: rows.map((b) => ({
          Customer: b.customerName ?? "",
          Phone: b.phone,
          City: b.city ?? "",
          Owner: b.ownerName ?? "",
          Salon: b.salonName ?? "",
          "Order No": b.orderNo ?? "",
          "Order Date": date(b.orderDate),
          "Booking Date": date(b.bookingDate),
          Status: b.status ?? "",
          Payment: b.paymentStatus ?? "",
          Amount: amount(b.grandTotal),
        })),
      };
    },
    repeat: async () => ({
      name: "Repeat Bookings",
      ...behaviourRows(await getWindowedBookings(behaviourWindow, true, 1, ROW_LIMIT), true),
    }),
    newbookers: async () => ({
      name: "New Bookers",
      ...behaviourRows(await getWindowedBookings(behaviourWindow, false, 1, ROW_LIMIT), false),
    }),
    neverbooked: async () => {
      const rows = await getNeverBooked(1, ROW_LIMIT);
      return {
        name: "Never Booked",
        headers: ["Customer", "Phone", "City", "Owner", "Registered", "Followup"],
        rows: rows.map((r) => ({
          Customer: r.customerName ?? "",
          Phone: r.phone,
          City: r.city ?? "",
          Owner: r.ownerName ?? "",
          Registered: date(r.registeredAt),
          Followup: r.hasActiveFollowup ? "Active" : "Closed",
        })),
      };
    },
    bookedonce: async () => ({
      name: "Booked Once",
      ...behaviourRows(await getBookedOnce(1, ROW_LIMIT), false),
    }),
  };

  const sheets = await Promise.all(wanted.map((k) => builders[k]()));

  const wb = XLSX.utils.book_new();

  if (only === "all") {
    const [counts, behaviour] = await Promise.all([getTrackerCounts(range), getBehaviourCounts(behaviourWindow)]);
    const summary: Record<string, Cell>[] = [
      { Metric: "Registrations", Count: counts.registrations, Covers: `${fromStr} to ${toStr}` },
      { Metric: "Bookings (every order, incl. unpaid)", Count: counts.bookings, Covers: `${fromStr} to ${toStr}` },
      { Metric: "Repeat bookings (paid)", Count: behaviour.repeatBookings, Covers: windowLabel },
      { Metric: "Customers behind the repeat bookings", Count: behaviour.repeatCustomers, Covers: windowLabel },
      { Metric: "New bookers (paid)", Count: behaviour.newBookers, Covers: windowLabel },
      { Metric: "Registered, never booked", Count: behaviour.neverBooked, Covers: "All time" },
      { Metric: "Booked once, never again", Count: behaviour.bookedOnce, Covers: "All time" },
    ];
    const ws = XLSX.utils.json_to_sheet(summary, { header: ["Metric", "Count", "Covers"] });
    ws["!cols"] = [{ wch: 40 }, { wch: 10 }, { wch: 26 }];
    XLSX.utils.book_append_sheet(wb, ws, "Summary");
  }

  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows, { header: s.headers });
    ws["!cols"] = s.headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="tracker-${only}-${todayStr}.xlsx"`,
    },
  });
}
