import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import SegmentBadge from "@/components/SegmentBadge";
import { NUDGE_LISTS, BLOCK_REASONS, isNudgeListKey, type NudgeListKey } from "@/lib/nudgeLists";
import { parseNudgeListParams, loadNudgeListData } from "@/lib/nudgeListsData";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { buildQuery, oneParam, type SearchParamsRecord } from "@/lib/params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
const DAY = 86_400_000;

export default async function NudgeListsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const sp = await searchParams;
  const p = parseNudgeListParams(sp);
  const listParamValue = oneParam(sp.list);
  const list: NudgeListKey = isNudgeListKey(listParamValue) ? listParamValue : "last25";
  const page = Math.max(1, parseInt(oneParam(sp.page) || "1", 10) || 1);

  const data = await loadNudgeListData(p);
  const rows = data.lists[list];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const base = { from: p.from, to: p.to };
  const href = (patch: Record<string, string | string[] | undefined>) => "/admin/whatsapp/lists" + buildQuery({ ...base, list, ...patch });
  const exportHref = (which: string) => "/api/admin/whatsapp/lists/export" + buildQuery({ ...base, list: which });

  const today = todayIsoIST();
  const shift = (n: number) => new Date(Date.parse(today) + n * DAY).toISOString().slice(0, 10);
  const rangeText = p.from === p.to ? formatDateIN(p.from) : `${formatDateIN(p.from)} - ${formatDateIN(p.to)}`;
  const bookedText =
    data.lastBookedFrom === data.lastBookedTo ? formatDateIN(data.lastBookedFrom) : `${formatDateIN(data.lastBookedFrom)} - ${formatDateIN(data.lastBookedTo)}`;
  const info = NUDGE_LISTS.find((l) => l.key === list)!;

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Nudges</h1>
          <div className="flex gap-1 mt-2 border-b border-gray-200">
            <Link href="/admin/whatsapp" className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800 border-b-2 border-transparent">Settings &amp; sending</Link>
            <span className="px-3 py-2 text-sm font-semibold text-blue-700 border-b-2 border-blue-600">Customer lists</span>
          </div>
        </div>
        <a href={exportHref("all")} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          Download all lists (Excel)
        </a>
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Who to nudge, by how many paid visits they&apos;ve made (Success / Partially Paid, not cancelled; several orders on one day = one visit). <b>Every customer appears in exactly one tab</b>: someone whose last booking was 25 days ago is only in that
        tab, and customers marked Not Interested, Do Not Contact, Invalid Number or opted out are only in &ldquo;Do not nudge&rdquo;.
      </p>

      {/* Filters */}
      <form method="GET" action="/admin/whatsapp/lists" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <input type="hidden" name="list" value={list} />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Re-engage on (from)</span>
            <input type="date" name="from" defaultValue={p.from} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Re-engage on (to)</span>
            <input type="date" name="to" defaultValue={p.to} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <div className="text-xs text-slate-600">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Excluded salons</span>
            {data.excludeSalons.length ? data.excludeSalons.join(", ") : "None"}{" "}
            <Link href="/admin/whatsapp" className="text-blue-600 hover:underline">change in Settings</Link>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
            <Link href={`/admin/whatsapp/lists?list=${list}`} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Reset</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          <span className="text-slate-500">Re-engage on:</span>
          {[
            { label: "Today", from: today, to: today },
            { label: "Tomorrow", from: shift(1), to: shift(1) },
            { label: "Next 7 days", from: today, to: shift(6) },
          ].map((r) => (
            <Link
              key={r.label}
              href={href({ from: r.from, to: r.to, page: undefined })}
              className={"px-2.5 py-1 rounded-full border " + (p.from === r.from && p.to === r.to ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")}
            >
              {r.label}
            </Link>
          ))}
          <span className="text-slate-400">
            → &ldquo;Last booking 25 days ago&rdquo; = last paid visit on {bookedText}
          </span>
        </div>
        {(data.excludeSalons.length > 0 || data.noPhone > 0) && (
          <p className="text-[11px] text-slate-500 mt-2">
            {data.excludeSalons.length > 0 && <>Left out because they ever ordered at an excluded salon: <b>{data.salonExcluded.toLocaleString("en-IN")}</b>. </>}
            {data.noPhone > 0 && <>Left out for having no valid 10-digit phone: <b>{data.noPhone.toLocaleString("en-IN")}</b>.</>}
          </p>
        )}
      </form>

      {/* List tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        {NUDGE_LISTS.map((l) => {
          const active = l.key === list;
          const blocked = l.key === "blocked";
          return (
            <Link
              key={l.key}
              href={href({ list: l.key, page: undefined })}
              className={
                "rounded-xl border-2 p-3 shadow-sm transition block " +
                (active ? (blocked ? "border-rose-500 bg-rose-50 ring-2 ring-rose-200" : "border-blue-500 bg-blue-50 ring-2 ring-blue-200") : "border-gray-200 bg-white hover:border-slate-300")
              }
            >
              <p className={"text-xs font-semibold " + (blocked ? "text-rose-700" : "text-slate-700")}>{l.label}</p>
              <p className={"text-2xl font-bold mt-1 " + (blocked ? "text-rose-600" : "text-gray-900")}>{data.lists[l.key].length.toLocaleString("en-IN")}</p>
              <p className="text-[11px] text-slate-400 leading-tight">{l.key === "last25" ? `re-engage ${rangeText}` : l.help}</p>
            </Link>
          );
        })}
      </div>

      {/* Table */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {info.label} <span className="text-slate-400 font-normal">({rows.length.toLocaleString("en-IN")})</span>
        </h2>
        <a href={exportHref(list)} download className="px-3 h-8 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
          Download this list (Excel)
        </a>
      </div>
      <p className="text-xs text-slate-500 mb-2">{info.help}</p>
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr className="text-left text-xs font-medium text-gray-700 uppercase">
              <th className="px-3 py-3">Customer</th>
              <th className="px-3 py-3">Phone</th>
              <th className="px-3 py-3">Category</th>
              <th className="px-3 py-3 text-right">Visits</th>
              <th className="px-3 py-3">Last booking</th>
              <th className="px-3 py-3">Last salon</th>
              <th className="px-3 py-3">Owner</th>
              <th className="px-3 py-3">Latest remark</th>
              <th className="px-3 py-3">{list === "blocked" ? "Why not nudged" : "Last WhatsApp nudge"}</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.map(({ lead: l, blocked }) => {
              const nudged = data.lastNudged.get(l.id);
              return (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    {l.name ?? "(no name)"}
                    {!l.registered && <div className="text-[11px] text-slate-400 font-normal">bookings only (not registered)</div>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-gray-700">{l.phone}</td>
                  <td className="px-3 py-2.5"><SegmentBadge visits={l.visits} /></td>
                  <td className="px-3 py-2.5 text-right text-gray-900">{l.visits}</td>
                  <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                    {l.lastPaidAt ? (
                      <>
                        {formatDateIN(l.lastPaidAt)}
                        <div className="text-[11px] text-slate-400">{l.daysSinceLast} days ago</div>
                      </>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{l.lastSalon ?? "-"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{l.ownerName}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-700">{l.latestRemark?.label ?? "-"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {list === "blocked" ? (
                      <span className="text-rose-700 font-medium">{blocked ? BLOCK_REASONS[blocked] : ""}</span>
                    ) : nudged ? (
                      formatDateIN(nudged)
                    ) : (
                      <span className="text-slate-400">never</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={"/customers/" + l.id} className="text-blue-600 hover:underline text-xs">Open</Link>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">Nobody in this list.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-gray-600">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Link href={href({ page: String(Math.max(1, page - 1)) })} className={"px-3 h-8 inline-flex items-center rounded border " + (page === 1 ? "pointer-events-none text-gray-300" : "bg-white")}>Previous</Link>
            <Link href={href({ page: String(Math.min(totalPages, page + 1)) })} className={"px-3 h-8 inline-flex items-center rounded border " + (page === totalPages ? "pointer-events-none text-gray-300" : "bg-white")}>Next</Link>
          </div>
        </div>
      )}
    </Layout>
  );
}
