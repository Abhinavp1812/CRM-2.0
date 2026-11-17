import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { loadInsights, parseFilters, applyFilters, NO_CAMPAIGN, type LeadFacts } from "@/lib/insights";
import { TREE, treeStats, flattenTree, findNode, conversionByCategory, nodeList } from "@/lib/journeyTree";
import { SEGMENTS, segmentInfo, isSegmentKey } from "@/lib/segments";
import { oneParam, searchParamsToRecord } from "@/lib/params";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";

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
