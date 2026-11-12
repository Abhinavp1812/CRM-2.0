import { auth } from "@/auth";
import * as XLSX from "xlsx";
import {
  loadInsights,
  selectView,
  signalCounts,
  returnRateBy,
  isStoppedRegular,
  isGoneOneTimer,
  VIEW_TITLES,
  SIGNALS,
  NO_COUPON,
  NO_SALON,
  type ViewKey,
  type CustomerFacts,
  type FailedPaymentRow,
  type LatestNote,
} from "@/lib/insights";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";

export const maxDuration = 60;

type Row = Record<string, string | number>;

function noteColumns(n: LatestNote | null): Row {
  return {
    "Latest note": n?.text ?? "",
    "Note remark": n?.remark ?? "",
    "Note date": n ? formatDateIN(n.at) : "",
    "Note by": n?.by ?? "",
  };
}

const signalLabel =(k: string) => SIGNALS.find((s) => s.key === k)?.label ?? k;

function factsRows(rows: CustomerFacts[]): Row[] {
  return rows.map((r) => ({
    Customer: r.name ?? "",
    Phone: r.phone,
    City: r.city ?? "",
    Owner: r.ownerName ?? "",
    Visits: r.visits,
    "Paid orders": r.orders,
    "Spent (Rs)": Math.round(r.revenue),
    "Usually visits every (days)": r.usualGapDays !== null ? Math.round(r.usualGapDays) : "",
    "First booking": formatDateIN(r.firstPaidAt),
    "Last booking": formatDateIN(r.lastPaidAt),
    "Days since last booking": r.daysSinceLast,
    "First salon": r.firstSalon ?? "",
    "Last salon": r.lastSalon ?? "",
    "First coupon": r.firstCoupon ?? "",
    Signs: r.signals.map(signalLabel).join("; "),
    ...noteColumns(r.latestNote),
  }));
}

function failedRows(rows: FailedPaymentRow[]): Row[] {
  return rows.map((r) => ({
    Customer: r.name ?? "",
    Phone: r.phone,
    City: r.city ?? "",
    Owner: r.ownerName ?? "",
    "Failed tries": r.failedOrders,
    "Last try": formatDateIN(r.lastTriedAt),
    Salon: r.lastSalon ?? "",
    "Called since?": r.contactedSince ? "Yes" : "No",
    ...noteColumns(r.latestNote),
  }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No customers" }]);
  const headers = Object.keys(rows[0] ?? { Note: "" });
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const viewParam = sp.get("view") || "all";
  if (viewParam !== "all" && !(viewParam in VIEW_TITLES)) {
    return new Response(JSON.stringify({ error: "Unknown view" }), { status: 400 });
  }

  const data = await loadInsights();
  const wb = XLSX.utils.book_new();

  if (viewParam === "all") {
    const f = data.facts;
    const regulars = f.filter((x) => x.visits >= 3);
    const stopped = f.filter(isStoppedRegular);
    const once = f.filter(isGoneOneTimer);
    addSheet(wb, "Summary", [
      { Metric: "Registered customers", Value: data.registeredCount },
      { Metric: "Contacted by our team", Value: data.contactedCount },
      { Metric: "Paying customers (1+ paid visit)", Value: f.length },
      { Metric: "Came back (2+ visits)", Value: f.filter((x) => x.visits >= 2).length },
      { Metric: "Regular customers (3+ visits)", Value: regulars.length },
      { Metric: "Regulars who stopped booking", Value: stopped.length },
      { Metric: "Booked once, never came back (30+ days)", Value: once.length },
      { Metric: "Payment failed, never paid", Value: data.failedNeverPaid.length },
    ]);
    addSheet(wb, "Why regulars stopped", signalCounts(stopped).map((s) => ({ Sign: s.label, Customers: s.count })));
    addSheet(wb, "Why one-timers left", signalCounts(once).map((s) => ({ Sign: s.label, Customers: s.count })));
    addSheet(
      wb,
      "Return rate by salon",
      returnRateBy(data, (x) => x.firstSalon ?? NO_SALON, 1).map((s) => ({
        Salon: s.key,
        Customers: s.customers,
        "Came back": s.returned,
        "Return rate %": Math.round(s.rate * 100),
      }))
    );
    addSheet(
      wb,
      "Return rate by coupon",
      returnRateBy(data, (x) => x.firstCoupon ?? NO_COUPON, 1).map((s) => ({
        "First coupon": s.key,
        Customers: s.customers,
        "Came back": s.returned,
        "Return rate %": Math.round(s.rate * 100),
      }))
    );
    addSheet(wb, "Regulars who stopped", factsRows(selectView(data, "stopped", {}).rows as CustomerFacts[]));
    addSheet(wb, "Booked once, gone", factsRows(selectView(data, "onetime", {}).rows as CustomerFacts[]));
    addSheet(wb, "Payment failed", failedRows(data.failedNeverPaid));
  } else {
    const view = viewParam as ViewKey;
    const sel = selectView(data, view, { signal: sp.get("signal"), salon: sp.get("salon"), coupon: sp.get("coupon") });
    addSheet(wb, VIEW_TITLES[view], sel.kind === "failed" ? failedRows(sel.rows) : factsRows(sel.rows));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="insights-${viewParam}-${todayIsoIST()}.xlsx"`,
    },
  });
}
