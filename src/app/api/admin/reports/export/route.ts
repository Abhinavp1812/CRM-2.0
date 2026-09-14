import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { getAgentPeriodStats, getRemarkActivity } from "@/lib/followups";
import { formatDateIN, formatTimeIN, startOfTodayIST } from "@/lib/formatDate";

export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") === "month" ? "month" : "week";

  const today = startOfTodayIST();
  const end = new Date(today);
  end.setDate(end.getDate() + 1); // exclusive upper bound, includes all of today
  const start = new Date(today);
  start.setDate(start.getDate() - (period === "month" ? 30 : 7));

  const [summary, detail] = await Promise.all([
    getAgentPeriodStats({ start, end }),
    getRemarkActivity({ ownerId: null }, { start, end }),
  ]);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      summary.map((a) => ({
        Agent: a.agentName,
        "Calls Logged": a.callsLogged,
        "Remarks Logged": a.remarksLogged,
        Booked: a.booked,
        Converted: a.converted,
        "Not Interested": a.notInterested,
        "Active Followups (now)": a.activeFollowupsNow,
      }))
    ),
    "Summary"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      detail.map((r) => ({
        Date: formatDateIN(r.time),
        Time: formatTimeIN(r.time),
        Agent: r.ownerName || "",
        Customer: r.customerName || "",
        Phone: r.phone,
        City: r.city || "",
        Remark: r.remark || "",
        "Lead Temperature": r.leadTemperature || "",
        Note: r.note || "",
        "Next Followup": r.nextFollowupDate ? formatDateIN(r.nextFollowupDate) : "Closed",
      }))
    ),
    "Remark Detail"
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const label = period === "month" ? "monthly" : "weekly";
  const dateStr = today.toISOString().slice(0, 10);
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="team-${label}-report-${dateStr}.xlsx"`,
    },
  });
}
