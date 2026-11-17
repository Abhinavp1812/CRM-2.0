import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import MultiSelect from "@/components/MultiSelect";
import { LeadTemperatureBadge } from "@/components/StatusBadge";
import { getAllUsersForFilter, getActiveRemarkOptions, getActiveLeadSources } from "@/lib/followups";
import { loadCallActivity, summarizeCalledCustomers, responseLabel, ACTIVITY_KINDS, NO_CAMPAIGN_VALUE, type ActivityRow } from "@/lib/callActivity";
import { parseCallReportParams } from "@/lib/callReportParams";
import { SEGMENTS, segmentInfo, type SegmentKey } from "@/lib/segments";
import { formatDateIN, formatTimeIN, todayIsoIST } from "@/lib/formatDate";
import { buildQuery, oneParam, type SearchParamsRecord } from "@/lib/params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 100;
const DAY = 86_400_000;
const num = (n: number) => n.toLocaleString("en-IN");
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = session.user.role === "ADMIN";

  const sp = await searchParams;
  const p = parseCallReportParams(sp, { id: session.user.id, isAdmin });
  const page = Math.max(1, parseInt(oneParam(sp.page) || "1", 10) || 1);

  const [allRows, agents, remarkOptions, leadSources] = await Promise.all([
    loadCallActivity(p.query),
    isAdmin ? getAllUsersForFilter() : Promise.resolve([]),
    getActiveRemarkOptions(),
    getActiveLeadSources(),
  ]);

  // Category counts use every row in range, so the cards stay visible while one is selected.
  const customersAll = await summarizeCalledCustomers(allRows);
  const segSet = p.segments.length ? new Set(p.segments) : null;
  const rows = segSet ? allRows.filter((r) => segSet.has(r.segment)) : allRows;
  const customers = segSet ? customersAll.filter((c) => segSet.has(c.segment)) : customersAll;
  const booked = customers.filter((c) => c.response === "booked").length;

  // Response x category matrix (one row per customer: their latest remark in range, or "booked").
  const responses = Array.from(new Set(customers.map((c) => c.response))).sort((a, b) =>
    a === "booked" ? -1 : b === "booked" ? 1 : a === "no_remark" ? 1 : b === "no_remark" ? -1 : countOf(customers, b) - countOf(customers, a)
  );

  const base = {
    from: p.fromStr,
    to: p.toStr,
    seg: p.segments,
    kind: p.kinds,
    remark: p.remarks,
    by: p.calledBy,
    campaign: p.campaigns,
  };
  const href = (patch: Partial<typeof base> & { page?: string }) => "/reports" + buildQuery({ ...base, ...patch });
  const exportHref = "/api/reports/daily/export" + buildQuery(base);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const today = todayIsoIST();
  const daysAgo = (n: number) => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
  const ranges = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: daysAgo(1), to: daysAgo(1) },
    { label: "Last 7 days", from: daysAgo(6), to: today },
    { label: "This month", from: today.slice(0, 8) + "01", to: today },
  ];
  const rangeText = p.fromStr === p.toStr ? formatDateIN(p.fromStr) : `${formatDateIN(p.fromStr)} - ${formatDateIN(p.toStr)}`;

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Report</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every call and remark{isAdmin ? "" : " on your customers"} in the dates you pick - which category each customer was in when called, and what they said.
          </p>
        </div>
        <a href={exportHref} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          Download Excel
        </a>
      </div>

      {/* ---------- Filters ---------- */}
      <form method="GET" action="/reports" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
          <Field label="From">
            <input type="date" name="from" defaultValue={p.fromStr} max={today} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={p.toStr} max={today} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Category (when called)">
            <MultiSelect name="seg" allLabel="All categories" selected={p.segments} options={SEGMENTS.map((s) => ({ value: s.key, label: s.label }))} />
          </Field>
          <Field label="Activity type">
            <MultiSelect name="kind" allLabel="Calls & remarks" selected={p.kinds} options={ACTIVITY_KINDS} />
          </Field>
          <Field label="Status (remark)">
            <MultiSelect
              name="remark"
              allLabel="Any status"
              selected={p.remarks}
              options={[
                ...remarkOptions.map((r) => ({ value: r.label, label: r.label })),
                ...p.remarks.filter((v) => !remarkOptions.some((r) => r.label === v)).map((v) => ({ value: v, label: v })),
              ]}
            />
          </Field>
          <Field label="Campaign">
            <MultiSelect
              name="campaign"
              allLabel="All campaigns"
              selected={p.campaigns}
              options={[...leadSources.map((s) => ({ value: s.label, label: s.label })), { value: NO_CAMPAIGN_VALUE, label: "No campaign" }]}
            />
          </Field>
          {isAdmin ? (
            <Field label="Called by">
              <MultiSelect name="by" allLabel="Anyone" selected={p.calledBy} options={agents.map((a) => ({ value: a.id, label: a.name }))} />
            </Field>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button type="submit" className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
            <Link href="/reports" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Reset</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          <span className="text-slate-500">Quick dates:</span>
          {ranges.map((r) => {
            const active = p.fromStr === r.from && p.toStr === r.to;
            return (
              <Link
                key={r.label}
                href={href({ from: r.from, to: r.to, page: undefined })}
                className={"px-2.5 py-1 rounded-full border " + (active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      </form>

      {/* ---------- Who was called, by category ---------- */}
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Customers called · {rangeText}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <SummaryCard
          label="All categories"
          value={customersAll.length}
          sub={`${num(allRows.length)} calls & remarks`}
          href={href({ seg: [], page: undefined })}
          active={!segSet}
          activeClass="border-blue-500 bg-blue-50 ring-2 ring-blue-200"
        />
        {SEGMENTS.map((s) => {
          const n = customersAll.filter((c) => c.segment === s.key).length;
          const active = p.segments.length === 1 && p.segments[0] === s.key;
          return (
            <SummaryCard
              key={s.key}
              label={s.label}
              dot={s.dot}
              value={n}
              sub={`${pct(n, customersAll.length)}% · ${s.help}`}
              href={href({ seg: active ? [] : [s.key], page: undefined })}
              active={active}
              activeClass={s.card + " ring-2 " + s.ring}
            />
          );
        })}
        <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 shadow-sm">
          <p className="text-xs font-semibold text-emerald-800">Booked after the call</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{num(booked)}</p>
          <p className="text-[11px] text-emerald-700/70">{pct(booked, customers.length)}% of customers called{segSet ? " (selected categories)" : ""}</p>
        </div>
      </div>

      {/* ---------- Responses by category ---------- */}
      {customers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
          <h2 className="font-semibold text-gray-900 text-sm">What they said, by category</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-3">
            One line per customer: &ldquo;Booked after the call&rdquo; if they made a paid booking on or after the day we first called them in this range, otherwise their latest remark in the range. Click a remark to see those calls.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
                  <th className="px-2 py-2 text-left">Response</th>
                  {SEGMENTS.filter((s) => !segSet || segSet.has(s.key)).map((s) => (
                    <th key={s.key} className="px-2 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={"w-2 h-2 rounded-full " + s.dot} />
                        {s.short}
                      </span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 w-40"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {responses.map((r) => {
                  const ofResp = customers.filter((c) => c.response === r);
                  const label = responseLabel(r);
                  const linkable = r.startsWith("remark:");
                  return (
                    <tr key={r} className={r === "booked" ? "bg-emerald-50/50" : ""}>
                      <td className="px-2 py-2">
                        {linkable ? (
                          <Link href={href({ remark: [r.slice(7)], page: undefined })} className="text-blue-700 hover:underline">{label}</Link>
                        ) : (
                          <span className={r === "booked" ? "font-semibold text-emerald-700" : "text-slate-600"}>{label}</span>
                        )}
                      </td>
                      {SEGMENTS.filter((s) => !segSet || segSet.has(s.key)).map((s) => {
                        const n = ofResp.filter((c) => c.segment === s.key).length;
                        return (
                          <td key={s.key} className={"px-2 py-2 text-right " + (n ? "text-gray-900" : "text-slate-300")}>
                            {n || "-"}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right font-semibold text-gray-900">{num(ofResp.length)}</td>
                      <td className="px-2 py-2">
                        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                          {SEGMENTS.map((s) => {
                            const n = ofResp.filter((c) => c.segment === s.key).length;
                            return n ? <div key={s.key} className={s.bar} style={{ width: (100 * n) / ofResp.length + "%" }} /> : null;
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- Activity log ---------- */}
      <p className="text-sm text-gray-600 mb-2">
        {num(rows.length)} call{rows.length === 1 ? "" : "s"} &amp; remark{rows.length === 1 ? "" : "s"} · {num(customers.length)} customer{customers.length === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No calls or remarks match these filters.</div>
      ) : (
        <ActivityTable rows={pageRows} isAdmin={isAdmin} />
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Link
              href={href({ page: String(Math.max(1, page - 1)) })}
              className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
            >
              Previous
            </Link>
            <Link
              href={href({ page: String(Math.min(totalPages, page + 1)) })}
              className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === totalPages ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </Layout>
  );
}

function countOf(customers: { response: string }[], r: string) {
  return customers.filter((c) => c.response === r).length;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  href,
  active,
  activeClass,
  dot,
}: {
  label: string;
  value: number;
  sub: string;
  href: string;
  active: boolean;
  activeClass: string;
  dot?: string;
}) {
  return (
    <Link href={href} className={"rounded-xl border-2 p-3 shadow-sm transition block " + (active ? activeClass : "border-gray-200 bg-white hover:border-slate-300")}>
      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
        {dot && <span className={"w-2.5 h-2.5 rounded-full " + dot} />}
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{num(value)}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </Link>
  );
}

function SegTag({ k, visits }: { k: SegmentKey; visits: number }) {
  const s = segmentInfo(k);
  return (
    <span className={"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap " + s.badge} title={`${visits} paid visit${visits === 1 ? "" : "s"} before this day`}>
      <span className={"w-1.5 h-1.5 rounded-full " + s.dot} />
      {s.short}
    </span>
  );
}

function ActivityTable({ rows, isAdmin }: { rows: ActivityRow[]; isAdmin: boolean }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Date &amp; time</th>
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3" title="Category on the day of this call">Category</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">Called by</th>
            {isAdmin && <th className="px-3 py-3">Owner</th>}
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Temp</th>
            <th className="px-3 py-3">Note</th>
            <th className="px-3 py-3">Next followup</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50 align-top">
              <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                {formatDateIN(r.at)}
                <div className="text-xs text-slate-400">{formatTimeIN(r.at, { hour: "2-digit", minute: "2-digit" })}</div>
              </td>
              <td className="px-3 py-3 font-medium text-gray-900">
                <Link href={"/customers/" + r.customerId} className="hover:text-blue-700">{r.customerName || "(no name)"}</Link>
                {r.city && <div className="text-xs text-slate-400 font-normal">{r.city}</div>}
              </td>
              <td className="px-3 py-3"><SegTag k={r.segment} visits={r.visitsBefore} /></td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3 text-gray-700">{r.calledBy}</td>
              {isAdmin && <td className="px-3 py-3 text-gray-500">{r.ownerName || "-"}</td>}
              <td className="px-3 py-3 text-xs text-gray-600 whitespace-nowrap">{r.kind === "CALL_LOGGED" ? "Call" : "Remark"}</td>
              <td className="px-3 py-3 text-gray-800 font-medium whitespace-nowrap">{r.remark || "-"}</td>
              <td className="px-3 py-3"><LeadTemperatureBadge temperature={r.leadTemperature} /></td>
              <td className="px-3 py-3 text-gray-600 text-xs max-w-xs whitespace-pre-line">{r.note || "-"}</td>
              <td className="px-3 py-3 text-gray-600 whitespace-nowrap">
                {r.kind === "REMARK_ADDED" ? (r.nextFollowupDate ? formatDateIN(r.nextFollowupDate) : "Closed") : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
