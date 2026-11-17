import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { loadCallActivity, summarizeCalledCustomers, responseLabel } from "@/lib/callActivity";
import { parseCallReportParams } from "@/lib/callReportParams";
import { SEGMENTS, segmentInfo } from "@/lib/segments";
import { searchParamsToRecord } from "@/lib/params";
import { formatDateIN, formatTimeIN } from "@/lib/formatDate";

export const maxDuration = 60;

type Row = Record<string, string | number>;

function addSheet(wb: XLSX.WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nothing in this range" }]);
  ws["!cols"] = Object.keys(rows[0] ?? { Note: "" }).map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  const isAdmin = session.user.role === "ADMIN";

  // Same parser as the page, so the file always matches the screen - and agents
  // only ever get their own customers, whatever they put in the URL.
  const p = parseCallReportParams(searchParamsToRecord(new URL(req.url).searchParams), { id: session.user.id, isAdmin });
  const allRows = await loadCallActivity(p.query);
  const segSet = p.segments.length ? new Set(p.segments) : null;
  const rows = segSet ? allRows.filter((r) => segSet.has(r.segment)) : allRows;
  const customers = (await summarizeCalledCustomers(allRows)).filter((c) => !segSet || segSet.has(c.segment));

  const wb = XLSX.utils.book_new();
  addSheet(
    wb,
    "Calls & remarks",
    rows.map((r) => ({
      Date: formatDateIN(r.at),
      Time: formatTimeIN(r.at),
      Customer: r.customerName || "",
      Phone: r.phone,
      City: r.city || "",
      "Category (when called)": segmentInfo(r.segment).label,
      "Paid visits before": r.visitsBefore,
      "Called by": r.calledBy,
      Owner: r.ownerName || "",
      Campaign: r.campaign || "",
      Type: r.kind === "CALL_LOGGED" ? "Call" : "Remark",
      Status: r.remark || "",
      "Lead Temperature": r.leadTemperature || "",
      Note: r.note || "",
      "Next Followup": r.kind === "REMARK_ADDED" ? (r.nextFollowupDate ? formatDateIN(r.nextFollowupDate) : "Closed") : "",
    }))
  );
  addSheet(
    wb,
    "Customers called",
    customers.map((c) => ({
      Customer: c.name || "",
      Phone: c.phone,
      City: c.city || "",
      "Category (when first called)": segmentInfo(c.segment).label,
      Owner: c.ownerName || "",
      Campaign: c.campaign || "",
      "First call": formatDateIN(c.firstAt),
      "Calls & remarks": c.activities,
      Response: responseLabel(c.response),
      "Booked on": c.bookedOn ? formatDateIN(c.bookedOn) : "",
      "Latest remark": c.remark || "",
      "Remark by": c.remarkBy || "",
      "Latest note": c.note || "",
    }))
  );
  const responses = Array.from(new Set(customers.map((c) => c.response)));
  addSheet(
    wb,
    "By category",
    responses.map((r) => {
      const of = customers.filter((c) => c.response === r);
      return {
        Response: responseLabel(r),
        ...Object.fromEntries(SEGMENTS.map((s) => [s.label, of.filter((c) => c.segment === s.key).length])),
        Total: of.length,
      };
    })
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const name = p.fromStr === p.toStr ? p.fromStr : `${p.fromStr}_to_${p.toStr}`;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily-report-${name}.xlsx"`,
    },
  });
}
