import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { getRemarkActivity } from "@/lib/followups";
import { formatDateIN, formatTimeIN } from "@/lib/formatDate";

export const maxDuration = 30;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const isAdmin = session.user.role === "ADMIN";

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const dateStr = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Agents can only ever export their own customers, regardless of what they pass.
  const ownerId = isAdmin ? searchParams.get("ownerId") || null : session.user.id;

  const rows = await getRemarkActivity({ ownerId }, { start: dayStart, end: dayEnd });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      rows.map((r) => ({
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
    "Daily Report"
  );

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily-report-${dateStr}.xlsx"`,
    },
  });
}
