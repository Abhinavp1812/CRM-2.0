import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { NUDGE_LISTS, BLOCK_REASONS, isNudgeListKey, type NudgeListRow } from "@/lib/nudgeLists";
import { parseNudgeListParams, loadNudgeListData } from "@/lib/nudgeListsData";
import { segmentInfo } from "@/lib/segments";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { oneParam, searchParamsToRecord } from "@/lib/params";

export const maxDuration = 60;

type Row = Record<string, string | number>;

function rowsFor(rows: NudgeListRow[], lastNudged: Map<string, Date>, blockedList: boolean): Row[] {
  return rows.map(({ lead: l, blocked }) => ({
    Name: l.name ?? "",
    "Phone Number": l.phone,
    Category: segmentInfo(l.segmentNow).label,
    "Paid visits": l.visits,
    "Last Booking Date": l.lastPaidAt ? formatDateIN(l.lastPaidAt) : "",
    "Days since last booking": l.daysSinceLast ?? "",
    "Last salon": l.lastSalon ?? "",
    "Registered?": l.registered ? "Yes" : "No (bookings only)",
    Owner: l.ownerName,
    Campaign: l.campaign === "(no campaign)" ? "" : l.campaign,
    "Latest remark": l.latestRemark?.label ?? "",
    ...(blockedList
      ? { "Why not nudged": blocked ? BLOCK_REASONS[blocked] : "" }
      : { "Last WhatsApp nudge": lastNudged.get(l.id) ? formatDateIN(lastNudged.get(l.id)!) : "" }),
  }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Row[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nobody in this list" }]);
  ws["!cols"] = Object.keys(rows[0] ?? { Note: "" }).map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
}

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const raw = searchParamsToRecord(new URL(req.url).searchParams);
  const which = oneParam(raw.list) || "all";
  if (which !== "all" && !isNudgeListKey(which)) return new Response(JSON.stringify({ error: "Unknown list" }), { status: 400 });

  const p = parseNudgeListParams(raw);
  const data = await loadNudgeListData(p);
  const wb = XLSX.utils.book_new();

  const lists = which === "all" ? NUDGE_LISTS : NUDGE_LISTS.filter((l) => l.key === which);
  if (which === "all") {
    addSheet(wb, "Summary", [
      { Item: "Re-engage on", Value: p.from === p.to ? formatDateIN(p.from) : `${formatDateIN(p.from)} - ${formatDateIN(p.to)}` },
      { Item: "Excluded salons (from Settings)", Value: data.excludeSalons.join(", ") || "None" },
      ...NUDGE_LISTS.map((l) => ({ Item: l.label, Value: data.lists[l.key].length })),
      { Item: "Left out: excluded salons", Value: data.salonExcluded },
      { Item: "Left out: no valid phone", Value: data.noPhone },
      { Item: "Counting", Value: "Paid visits: Success / Partially Paid, not cancelled; several orders on one day = one visit." },
    ]);
  }
  for (const l of lists) addSheet(wb, l.label, rowsFor(data.lists[l.key], data.lastNudged, l.key === "blocked"));

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="whatsapp-${which}-${todayIsoIST()}.xlsx"`,
    },
  });
}
