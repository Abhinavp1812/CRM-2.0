import { auth } from "@/auth";
import * as XLSX from "xlsx";
import {
  loadInsights,
  parseFilters,
  applyFilters,
  summarize,
  summarizeBy,
  reasonCounts,
  returnRateBy,
  selectList,
  listTitle,
  isListKey,
  outcomeOf,
  reasonLabel,
  OUTCOMES,
  OUTCOME_HELP,
  TEMPERATURES,
  GRACE_DAYS,
  NO_CAMPAIGN,
  type LeadFacts,
  type Summary,
} from "@/lib/insights";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { oneParam, searchParamsToRecord } from "@/lib/params";

export const maxDuration = 60;

type Row = Record<string, string | number>;

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

function leadRows(rows: LeadFacts[]): Row[] {
  return rows.map((r) => ({
    Customer: r.name ?? "",
    Phone: r.phone,
    City: r.city ?? "",
    Campaign: r.campaign === NO_CAMPAIGN ? "" : r.campaign,
    Agent: r.ownerName,
    Joined: formatDateIN(r.joinedAt),
    Registered: r.registered ? "Yes" : "No",
    "What happened": outcomeOf(r.outcome)?.label ?? r.outcome,
    Visits: r.visits,
    "Paid orders": r.orders,
    "Spent (Rs)": Math.round(r.revenue),
    "Usual gap between visits (days)": r.usualGapDays !== null ? Math.round(r.usualGapDays) : "",
    "First booking": r.firstPaidAt ? formatDateIN(r.firstPaidAt) : "",
    "Last booking": r.lastPaidAt ? formatDateIN(r.lastPaidAt) : "",
    "Days since last booking": r.daysSinceLast ?? "",
    "First salon": r.firstSalon ?? "",
    "Last salon": r.lastSalon ?? "",
    "First coupon": r.firstCoupon ?? "",
    "Failed payments": r.failedOrders,
    Temperature: r.temperature ? TEMPERATURES.find((t) => t.key === r.temperature)?.label ?? "" : "",
    "Latest remark": r.latestRemark?.label ?? "",
    "Remark date": r.latestRemark ? formatDateIN(r.latestRemark.at) : "",
    "Remark by": r.latestRemark?.by ?? "",
    Reason: r.reason ? reasonLabel(r.reason) : "",
    "Last contacted": r.lastContactAt ? formatDateIN(r.lastContactAt) : "Never",
    "Latest note": r.latestNote?.text ?? "",
    "Note date": r.latestNote ? formatDateIN(r.latestNote.at) : "",
    "Note by": r.latestNote?.by ?? "",
  }));
}

function groupRows(rows: (Summary & { key: string })[], keyHeader: string, nameOf: (k: string) => string): Row[] {
  return rows.map((r) => ({
    [keyHeader]: nameOf(r.key),
    Leads: r.leads,
    Registered: r.registered,
    Contacted: r.contacted,
    "Contacted %": pct(r.contacted, r.leads),
    "Not contacted yet": r.outcomes.not_contacted,
    Booked: r.booked,
    "Booked % of leads": pct(r.booked, r.leads),
    [`Booked ${GRACE_DAYS}+ days ago`]: r.eligible,
    "Came back": r.eligibleReturned,
    "Came back %": pct(r.eligibleReturned, r.eligible),
    // One column per category - each customer counts in exactly one.
    "No paid booking": r.bySegment.registered,
    "One-time (1 visit)": r.bySegment.one,
    "Repeat (2-4 visits)": r.bySegment.repeat,
    "Frequent (5+ visits)": r.bySegment.frequent,
    "Lost customers": r.outcomes.once_gone + r.outcomes.stopped,
    "Paid orders": r.orders,
    "Revenue (Rs)": Math.round(r.revenue),
    "Revenue per lead (Rs)": r.leads ? Math.round(r.revenue / r.leads) : 0,
  }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No customers" }]);
  const headers = Object.keys(rows[0] ?? { Note: "" });
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const raw = searchParamsToRecord(new URL(req.url).searchParams);
  const sp = Object.fromEntries(["list", "reason", "temp", "rsalon", "rcoupon"].map((k) => [k, oneParam(raw[k])]));
  const list = sp.list || "report";
  if (list !== "report" && !isListKey(list)) {
    return new Response(JSON.stringify({ error: "Unknown list" }), { status: 400 });
  }

  const filters = parseFilters(raw);
  const { now, leads: allLeads } = await loadInsights();
  const leads = applyFilters(allLeads, filters);
  const ownerName = new Map(allLeads.map((l) => [l.ownerKey, l.ownerName]));
  const wb = XLSX.utils.book_new();

  if (list === "report") {
    const s = summarize(leads, now);
    const lapsed = leads.filter((l) => l.outcome === "once_gone" || l.outcome === "stopped");
    addSheet(wb, "Summary", [
      { Item: "Joined from", Value: filters.from ? formatDateIN(filters.from) : "Any" },
      { Item: "Joined to", Value: filters.to ? formatDateIN(filters.to) : "Any" },
      { Item: "Campaign", Value: filters.campaign.length ? filters.campaign.map((c) => (c === NO_CAMPAIGN ? "No campaign" : c)).join(", ") : "All" },
      { Item: "First booked at salon", Value: filters.salon.length ? filters.salon.join(", ") : "All" },
      { Item: "Agent", Value: filters.owner.length ? filters.owner.map((o) => ownerName.get(o) ?? o).join(", ") : "All" },
      { Item: "", Value: "" },
      { Item: "Leads", Value: s.leads },
      { Item: "Registered", Value: s.registered },
      { Item: "Contacted by team", Value: s.contacted },
      { Item: "Booked (1+ paid visit)", Value: s.booked },
      { Item: "Booked % of leads", Value: pct(s.booked, s.leads) },
      { Item: `Booked ${GRACE_DAYS}+ days ago`, Value: s.eligible },
      { Item: "...of whom came back", Value: s.eligibleReturned },
      { Item: "Came back %", Value: pct(s.eligibleReturned, s.eligible) },
      { Item: "Lost customers", Value: lapsed.length },
      { Item: "", Value: "" },
      { Item: "By number of visits (each lead counted once)", Value: "" },
      { Item: "No paid booking yet (0 visits)", Value: s.bySegment.registered },
      { Item: "One-time (1 visit)", Value: s.bySegment.one },
      { Item: "Repeat (2-4 visits)", Value: s.bySegment.repeat },
      { Item: "Frequent (5+ visits)", Value: s.bySegment.frequent },
      { Item: "Paid orders", Value: s.orders },
      { Item: "Revenue (Rs)", Value: Math.round(s.revenue) },
      { Item: "", Value: "" },
      { Item: "Rules", Value: "Only bookings with payment Success / Partially Paid (not cancelled) count. A visit = one booking day." },
    ]);
    addSheet(
      wb,
      "What happened",
      OUTCOMES.map((o) => ({ Outcome: o.label, Meaning: OUTCOME_HELP[o.key], Leads: s.outcomes[o.key], "% of leads": pct(s.outcomes[o.key], s.leads) }))
    );
    addSheet(
      wb,
      "Campaigns",
      groupRows(summarizeBy(applyFilters(allLeads, filters, ["campaign"]), (l) => l.campaign, now), "Campaign", (k) => (k === NO_CAMPAIGN ? "No campaign" : k))
    );
    addSheet(wb, "Agents", groupRows(summarizeBy(leads, (l) => l.ownerKey, now), "Agent", (k) => ownerName.get(k) ?? k));
    const notBooked = leads.filter((l) => l.visits === 0);
    addSheet(wb, "Why not booked", reasonCounts(notBooked).map((r) => ({ Reason: r.label, Leads: r.count, "%": pct(r.count, notBooked.length) })));
    addSheet(wb, "Why not back", reasonCounts(lapsed).map((r) => ({ Reason: r.label, Customers: r.count, "%": pct(r.count, lapsed.length) })));
    addSheet(
      wb,
      "Temperature",
      OUTCOMES.map((o) => {
        const ls = leads.filter((l) => l.outcome === o.key);
        return {
          Outcome: o.label,
          ...Object.fromEntries(TEMPERATURES.map((t) => [t.label, ls.filter((l) => (l.temperature ?? "none") === t.key).length])),
          Total: ls.length,
        };
      })
    );
    const rate = (header: string, rows: ReturnType<typeof returnRateBy>) =>
      rows.map((r) => ({ [header]: r.key, [`Customers (first booked ${GRACE_DAYS}+ days ago)`]: r.customers, "Came back": r.returned, "Came back %": Math.round(r.rate * 100) }));
    addSheet(wb, "Return by salon", rate("First salon", returnRateBy(leads, (l) => l.firstSalon, 1, now)));
    addSheet(wb, "Return by coupon", rate("First coupon", returnRateBy(leads, (l) => l.firstCoupon, 1, now)));
    addSheet(wb, "Lost customers", leadRows(selectList(leads, { list: "lapsed" }, now)));
    addSheet(wb, "All leads", leadRows(selectList(leads, { list: "all" }, now)));
  } else {
    const q = { list, reason: sp.reason || undefined, temp: sp.temp || undefined, rsalon: sp.rsalon || undefined, rcoupon: sp.rcoupon || undefined };
    addSheet(wb, listTitle(q), leadRows(selectList(leads, q, now)));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="insights-${list}-${todayIsoIST()}.xlsx"`,
    },
  });
}
