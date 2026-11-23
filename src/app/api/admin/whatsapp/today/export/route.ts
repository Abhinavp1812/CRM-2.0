import { auth } from "@/auth";
import * as XLSX from "xlsx";
import { loadBatchHistory, loadBatchRows, BATCH_SECTIONS, GROUPS, type GroupKey } from "@/lib/whatsappNudges";
import { toWhatsAppNumber } from "@/lib/anantya";
import { formatDateTimeIN } from "@/lib/formatDate";

export const maxDuration = 60;

const label = (g: string) => GROUPS.find((x) => x.key === g)?.label ?? g;
const firstName = (name: string | null) => {
  const n = (name ?? "").trim().split(/\s+/)[0];
  return n && !/^\(?no name\)?$/i.test(n) ? n : "";
};

/**
 * One "Nudges for today" batch as Excel, ready to upload to Anantya:
 * an "All" sheet plus one sheet per list. ?at= picks the batch (default the
 * latest), ?group= limits it to one list.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  const sp = new URL(req.url).searchParams;
  const atParam = sp.get("at");
  const group = sp.get("group");
  const at = atParam && !isNaN(Date.parse(atParam)) ? new Date(atParam) : (await loadBatchHistory(1))[0]?.at;
  if (!at) return new Response(JSON.stringify({ error: "No batch generated yet" }), { status: 404 });

  const rows = (await loadBatchRows(at)).filter((r) => !group || r.group === group);
  const toRow = (r: (typeof rows)[number]) => ({
    Name: r.customer?.name ?? "",
    "First name": firstName(r.customer?.name ?? null),
    "Phone Number": r.phone,
    "WhatsApp Number": toWhatsAppNumber(r.phone),
    List: label(r.group),
  });
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => (a.customer?.name ?? "").localeCompare(b.customer?.name ?? "");

  const wb = XLSX.utils.book_new();
  const add = (name: string, data: ReturnType<typeof toRow>[]) => {
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: "Nobody in this list" }]);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\/?*[\]:]/g, "-").slice(0, 31));
  };
  const sections = BATCH_SECTIONS.filter((g) => !group || g === group) as GroupKey[];
  if (!group) add("All", sections.flatMap((g) => rows.filter((r) => r.group === g).sort(byName).map(toRow)));
  for (const g of sections) add(label(g), rows.filter((r) => r.group === g).sort(byName).map(toRow));

  const stamp = formatDateTimeIN(at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(/[^\d]+/g, "-");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nudges-for-today-${group ?? "all"}-${stamp}.xlsx"`,
    },
  });
}
