import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { parseLogParams, loadLogForExport, groupLabel } from "@/lib/whatsappLog";
import { formatDateIN, formatTimeIN } from "@/lib/formatDate";
import { statusText, triggerText } from "@/lib/whatsappStatus";
import { searchParamsToRecord } from "@/lib/params";

export const maxDuration = 60;

/** Nudge log as Excel - one row per message, oldest first (like the WA Toolbox "Nudges Log" sheet). */
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const p = parseLogParams(searchParamsToRecord(new URL(req.url).searchParams));
  const rows = await loadLogForExport(p);
  const data = rows.map((m) => ({
    Date: formatDateIN(m.createdAt),
    Time: formatTimeIN(m.createdAt),
    List: groupLabel(m.group),
    Name: m.customer?.name ?? (m.isTest ? "(test)" : ""),
    "Phone Number": m.phone,
    Template: m.templateName ?? (m.templateId ? String(m.templateId) : ""),
    How: triggerText(m.trigger),
    Test: m.isTest ? "Yes" : "",
    Result: statusText(m.status),
    Error: m.error ?? "",
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: "No messages for these filters" }]);
  ws["!cols"] = Object.keys(data[0] ?? { Note: "" }).map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 6)) }));
  XLSX.utils.book_append_sheet(wb, ws, "Nudges Log");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nudges-log-${p.from}_to_${p.to}.xlsx"`,
    },
  });
}
