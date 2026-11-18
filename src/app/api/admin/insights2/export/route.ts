import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { loadInsights, parseFilters, applyFilters, NO_CAMPAIGN, type LeadFacts, type PayJourneyKey } from "@/lib/insights";
import { TREE, treeStats, flattenTree, findNode, conversionByCategory, nodeList, type TreeNode } from "@/lib/journeyTree";
import { PAY_TREE, payTreeStats, payStatusComparison, recoveryStats, paySelect, payKeyTitle } from "@/lib/paymentTree";
import { SEGMENTS, segmentInfo, isSegmentKey } from "@/lib/segments";
import { oneParam, searchParamsToRecord } from "@/lib/params";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { periodRange, loadPeriodCustomers, periodTree, periodSelect } from "@/lib/periodTree";
import { responseLabel } from "@/lib/callActivity";

export const maxDuration = 60;

type Row = Record<string, string | number>;
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

const journeyTitle = new Map(flattenTree().flatMap(({ node }) => node.leaves.length === 1 ? [[node.leaves[0], node.title] as const] : []));

function customerRows(rows: LeadFacts[]): Row[] {
  return rows.map((r) => ({
    Customer: r.name ?? "",
    Phone: r.phone,
    City: r.city ?? "",
    Campaign: r.campaign === NO_CAMPAIGN ? "" : r.campaign,
    Agent: r.ownerName,
    "Category when first called": segmentInfo(r.segmentAtStart).label,
    "Category now": segmentInfo(r.segmentNow).label,
    "Where they are": journeyTitle.get(r.journey) ?? r.journey,
    "First called": r.firstContactAt ? formatDateIN(r.firstContactAt) : "",
    "Days called": r.contactDays,
    "Converted on": r.convertedAt ? formatDateIN(r.convertedAt) : "",
    "Paid visits": r.visits,
    "Spent (Rs)": Math.round(r.revenue),
    "Last booking": r.lastPaidAt ? formatDateIN(r.lastPaidAt) : "",
    "Do not contact": r.doNotContact ? "Yes" : "",
    "Latest remark": r.latestRemark?.label ?? "",
    "Remark date": r.latestRemark ? formatDateIN(r.latestRemark.at) : "",
    "Remark by": r.latestRemark?.by ?? "",
    "Latest note": r.latestNote?.text ?? "",
    Joined: formatDateIN(r.joinedAt),
  }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "No customers" }]);
  ws["!cols"] = Object.keys(rows[0] ?? { Note: "" }).map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const raw = searchParamsToRecord(new URL(req.url).searchParams);

  // "Calls in a date range" tree download.
  const pnode = oneParam(raw.pnode);
  if (pnode) {
    const { fromStr, toStr } = periodRange(raw);
    const pFilters = { ...parseFilters(raw), salon: [] };
    const called = await loadPeriodCustomers(fromStr, toStr, pFilters);
    const pt = periodTree(called, `${formatDateIN(fromStr)} - ${formatDateIN(toStr)}`);
    if (!pt.stats.has(pnode)) return new Response(JSON.stringify({ error: "Unknown box" }), { status: 400 });
    const psegParam = oneParam(raw.pseg);
    const pseg = isSegmentKey(psegParam) ? psegParam : null;
    const wb = XLSX.utils.book_new();
    if (pnode === "all" && !pseg) {
      addSheet(
        wb,
        "Tree",
        flattenTree(pt.tree).map(({ node: n, depth, parent }) => {
          const s = pt.stats.get(n.key)!;
          return {
            Box: "    ".repeat(depth) + n.title,
            Customers: s.total,
            "% of box above": parent ? pct(s.total, pt.stats.get(parent.key)!.total) : 100,
            ...Object.fromEntries(SEGMENTS.map((x) => [x.label, s.bySegment[x.key]])),
          };
        })
      );
    }
    addSheet(
      wb,
      pt.titleOf(pnode) + (pseg ? " - " + segmentInfo(pseg).label : ""),
      periodSelect(called, pnode, pseg).map((c) => ({
        Customer: c.name ?? "",
        Phone: c.phone,
        City: c.city ?? "",
        "Category (when first called in range)": segmentInfo(c.segment).label,
        Owner: c.ownerName ?? "",
        Campaign: c.campaign ?? "",
        "First call": formatDateIN(c.firstAt),
        "Calls & remarks": c.activities,
        Response: responseLabel(c.response),
        "Booked on": c.bookedOn ? formatDateIN(c.bookedOn) : "",
        "Latest remark": c.remark ?? "",
        "Remark by": c.remarkBy ?? "",
        "Latest note": c.note ?? "",
      }))
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="calls-${fromStr}_to_${toStr}.xlsx"`,
      },
    });
  }

  // Payments section download.
  const paynode = oneParam(raw.paynode);
  if (paynode) {
    if (paynode !== "report" && !payKeyTitle(paynode)) return new Response(JSON.stringify({ error: "Unknown box" }), { status: 400 });
    const payFilters = { ...parseFilters(raw), salon: [] };
    const { leads: everyone } = await loadInsights();
    const leads = applyFilters(everyone, payFilters);
    const paysegParam = oneParam(raw.payseg);
    const payseg = isSegmentKey(paysegParam) ? paysegParam : null;
    const wb = XLSX.utils.book_new();
    if (paynode === "report") {
      const stats = payTreeStats(leads);
      const rec = recoveryStats(leads);
      const totalOrders = payStatusComparison(leads).reduce((a, s) => a + s.orders, 0);
      addSheet(
        wb,
        "By payment status",
        payStatusComparison(leads).map((s) => ({
          "Payment status": s.label,
          Orders: s.orders,
          "% of orders": pct(s.orders, totalOrders),
          Customers: s.customers,
          "Amount (Rs)": Math.round(s.amount),
        }))
      );
      addSheet(wb, "Recovery", [
        { Item: "Customers with a failed payment", Value: rec.failed },
        { Item: "Booked after the failure", Value: rec.recovered },
        { Item: "Booked after the failure %", Value: pct(rec.recovered, rec.failed) },
        { Item: "...of which the same day", Value: rec.sameDay },
        { Item: "Typical days to book again", Value: rec.medianDays ?? "" },
        { Item: "Didn't book after the failure", Value: rec.lost },
        { Item: "...and nobody called them after", Value: rec.lostNotCalled },
      ]);
      addSheet(
        wb,
        "Tree",
        flattenPay(PAY_TREE).map(({ node: n, depth, parent }) => {
          const s = stats.get(n.key)!;
          return {
            Box: "    ".repeat(depth) + n.title,
            Customers: s.total,
            "% of box above": parent ? pct(s.total, stats.get(parent.key)!.total) : 100,
            ...Object.fromEntries(SEGMENTS.map((x) => [x.label, s.bySegment[x.key]])),
            Meaning: n.help,
          };
        })
      );
      addSheet(wb, "Customers with orders", payRows(paySelect(leads, "all", null)));
    } else {
      addSheet(wb, (payKeyTitle(paynode) ?? paynode) + (payseg ? " - " + segmentInfo(payseg).label : ""), payRows(paySelect(leads, paynode, payseg)));
    }
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="payments-${paynode.replace(/[^a-z0-9_-]/gi, "-")}-${todayIsoIST()}.xlsx"`,
      },
    });
  }

  const nodeKey = oneParam(raw.node) || "report";
  const node = nodeKey === "report" ? null : findNode(nodeKey);
  if (nodeKey !== "report" && !node) return new Response(JSON.stringify({ error: "Unknown node" }), { status: 400 });
  const segParam = oneParam(raw.seg);
  const seg = isSegmentKey(segParam) ? segParam : null;

  const filters = { ...parseFilters(raw), salon: [] };
  const { leads: all } = await loadInsights();
  const leads = applyFilters(all, filters);
  const wb = XLSX.utils.book_new();

  if (!node) {
    const stats = treeStats(leads);
    addSheet(
      wb,
      "Tree",
      flattenTree(TREE).map(({ node: n, depth, parent }) => {
        const s = stats.get(n.key)!;
        return {
          Box: "    ".repeat(depth) + n.title,
          Customers: s.total,
          "% of box above": parent ? pct(s.total, stats.get(parent.key)!.total) : 100,
          ...Object.fromEntries(SEGMENTS.map((x) => [x.label, s.bySegment[x.key]])),
          Meaning: n.help,
        };
      })
    );
    addSheet(
      wb,
      "By category",
      conversionByCategory(leads).map((c) => ({
        Category: segmentInfo(c.key).label,
        Customers: c.total,
        Called: c.called,
        "Converted after 1st call": c.firstCall,
        "Converted later": c.later,
        "Converted total": c.converted,
        "Conversion % (of called)": pct(c.converted, c.called),
        "Still in pipeline": c.pipeline,
        "Do not contact": c.closed,
        "Not called yet": c.notCalled,
      }))
    );
    addSheet(wb, "All customers", customerRows(nodeList(leads, TREE, null)));
  } else {
    addSheet(wb, node.title + (seg ? " - " + segmentInfo(seg).label : ""), customerRows(nodeList(leads, node, seg)));
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="insights2-${nodeKey}-${todayIsoIST()}.xlsx"`,
    },
  });
}

function flattenPay(node: TreeNode<PayJourneyKey>, depth = 0, parent: TreeNode<PayJourneyKey> | null = null): { node: TreeNode<PayJourneyKey>; depth: number; parent: TreeNode<PayJourneyKey> | null }[] {
  return [{ node, depth, parent }, ...(node.children ?? []).flatMap((c) => flattenPay(c, depth + 1, node))];
}

function payRows(rows: LeadFacts[]): Row[] {
  return rows.map((r) => {
    const recoverDays =
      r.firstFailedAt && r.bookedAfterFailAt ? Math.max(0, Math.round((r.bookedAfterFailAt.getTime() - r.firstFailedAt.getTime()) / 86_400_000)) : "";
    return {
      Customer: r.name ?? "",
      Phone: r.phone,
      City: r.city ?? "",
      Category: segmentInfo(r.segmentNow).label,
      Owner: r.ownerName,
      Campaign: r.campaign === NO_CAMPAIGN ? "" : r.campaign,
      "Success orders": r.orderStats.success.orders,
      "Partially paid orders": r.orderStats.partial.orders,
      "Failed orders": r.orderStats.failed.orders,
      "Cancelled / refunded orders": r.orderStats.cancelled.orders,
      "Pending / other orders": r.orderStats.other.orders,
      "Paid amount (Rs)": Math.round(r.orderStats.success.amount + r.orderStats.partial.amount),
      "Failed amount (Rs)": Math.round(r.orderStats.failed.amount),
      "First failed payment": r.firstFailedAt ? formatDateIN(r.firstFailedAt) : "",
      "Booked after failure on": r.bookedAfterFailAt ? formatDateIN(r.bookedAfterFailAt) : "",
      "Booked after failure as": r.bookedAfterFailStatus ?? "",
      "Days to book again": recoverDays,
      "Called after failure": r.firstFailedAt ? (r.calledAfterFail ? "Yes" : "No") : "",
      "Latest remark": r.latestRemark?.label ?? "",
      "Remark date": r.latestRemark ? formatDateIN(r.latestRemark.at) : "",
      "Latest note": r.latestNote?.text ?? "",
    };
  });
}
