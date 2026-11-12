import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import {
  loadInsights,
  selectView,
  signalCounts,
  returnRateBy,
  weeklyTrend,
  isStoppedRegular,
  isGoneOneTimer,
  VIEW_TITLES,
  SIGNALS,
  NO_COUPON,
  NO_SALON,
  MIN_SILENT_DAYS,
  ONE_TIME_GRACE_DAYS,
  type ViewKey,
  type CustomerFacts,
  type FailedPaymentRow,
} from "@/lib/insights";
import { formatDateIN } from "@/lib/formatDate";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const VIEWS = Object.keys(VIEW_TITLES) as ViewKey[];

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function viewHref(params: Record<string, string | undefined>) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
    .join("&");
  return "/admin/insights" + (qs ? "?" + qs : "") + "#list";
}

function exportHref(params: Record<string, string | undefined>) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
    .join("&");
  return "/api/admin/insights/export?" + qs;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; signal?: string; salon?: string; coupon?: string; page?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const params = await searchParams;
  const view = VIEWS.includes(params.view as ViewKey) ? (params.view as ViewKey) : null;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);

  const data = await loadInsights();
  const f = data.facts;

  const paying = f.length;
  const repeat = f.filter((x) => x.visits >= 2).length;
  const regulars = f.filter((x) => x.visits >= 3);
  const stopped = f.filter(isStoppedRegular);
  const goneOnce = f.filter(isGoneOneTimer);
  const stoppedSignals = signalCounts(stopped);
  const onceSignals = signalCounts(goneOnce);
  const stoppedRevenue = stopped.reduce((s, x) => s + x.revenue, 0);
  const stoppedGap = median(stopped.map((x) => x.usualGapDays ?? 0));
  const stoppedNotCalled = stoppedSignals.find((s) => s.key === "not_called")?.count ?? 0;

  const salons = returnRateBy(data, (x) => x.firstSalon ?? NO_SALON, 10);
  const coupons = returnRateBy(data, (x) => x.firstCoupon ?? NO_COUPON, 15).slice(0, 15);
  const trend = weeklyTrend(data, 12);
  const overallReturn = returnRateBy(data, () => "all", 1)[0];

  const worstSalon = [...salons].sort((a, b) => a.rate - b.rate)[0];
  const bestSalon = [...salons].sort((a, b) => b.rate - a.rate)[0];

  const selected = view ? selectView(data, view, params) : null;
  const totalRows = selected ? selected.rows.length : 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageRows = selected ? selected.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const listTitle = view
    ? VIEW_TITLES[view] +
      (params.signal ? " - " + (SIGNALS.find((s) => s.key === params.signal)?.label ?? "no clear sign") : "") +
      (params.salon ? " - " + params.salon : "") +
      (params.coupon ? " - " + params.coupon : "")
    : "";
  const listParams = { view: view ?? undefined, signal: params.signal, salon: params.salon, coupon: params.coupon };

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insights</h1>
          <p className="text-sm text-slate-500 mt-1">
            Who keeps booking, who stopped, and the likely reasons why. Click any bar or number to see those customers.
          </p>
        </div>
        <a
          href={exportHref({ view: "all" })}
          download
          className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          Download full report (Excel)
        </a>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Paying customers" value={paying.toLocaleString()} href={viewHref({ view: "paying" })} />
        <Stat label="Came back at least once" value={pct(repeat, paying) + "%"} sub={`${repeat.toLocaleString()} customers`} href={viewHref({ view: "repeat" })} />
        <Stat label="Regular customers" value={regulars.length.toLocaleString()} sub="3 or more visits" href={viewHref({ view: "regulars" })} />
        <Stat label="Regulars who stopped" value={stopped.length.toLocaleString()} sub={`${pct(stopped.length, regulars.length)}% of regulars`} tone="red" href={viewHref({ view: "stopped" })} />
        <Stat label="Payment failed, never paid" value={data.failedNeverPaid.length.toLocaleString()} sub="tried to book but gave up" tone="amber" href={viewHref({ view: "failed" })} />
      </div>

      {/* Key findings in plain words */}
      <Section title="What the data says">
        <ul className="space-y-2 text-sm text-gray-800 list-disc pl-5">
          <li>
            <b>{stopped.length}</b> of <b>{regulars.length}</b> regular customers ({pct(stopped.length, regulars.length)}%) have stopped booking. They used to
            visit about every <b>{Math.round(stoppedGap)} days</b> and together had spent <b>{rupees(stoppedRevenue)}</b>.
          </li>
          <li>
            <b>{stoppedNotCalled}</b> of those {stopped.length} were <b>never called by our team</b> after their last booking - the biggest
            gap, and the easiest to fix.{" "}
            <Link className="text-blue-600 underline" href={viewHref({ view: "stopped", signal: "not_called" })}>See them</Link>
          </li>
          <li>
            Overall, <b>{pct(overallReturn?.returned ?? 0, overallReturn?.customers ?? 0)}%</b> of customers come back after their first booking.
            {bestSalon && worstSalon && bestSalon.key !== worstSalon.key && (
              <>
                {" "}It depends a lot on the salon: <b>{bestSalon.key}</b> {pct(bestSalon.returned, bestSalon.customers)}% vs <b>{worstSalon.key}</b>{" "}
                {pct(worstSalon.returned, worstSalon.customers)}%.
              </>
            )}
          </li>
          <li>
            <b>{data.failedNeverPaid.length}</b> customers tried to book but their payment failed and they never completed a booking.{" "}
            <Link className="text-blue-600 underline" href={viewHref({ view: "failed" })}>See them</Link>
          </li>
        </ul>
      </Section>

      {/* Customer journey */}
      <Section title="Customer journey" note="How many customers make it to each step">
        <BarList
          color="bg-blue-500"
          items={[
            { label: "Registered", value: data.registeredCount },
            { label: "Contacted by our team", value: data.contactedCount },
            { label: "Booked at least once", value: paying, href: viewHref({ view: "paying" }) },
            { label: "Came back (2+ visits)", value: repeat, href: viewHref({ view: "repeat" }) },
            { label: "Regular (3+ visits)", value: regulars.length, href: viewHref({ view: "regulars" }) },
          ]}
          showShareOfFirst
        />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section
          title={`Why regulars stopped (${stopped.length})`}
          note={`Visited 3+ times, then silent for over 3x their usual gap (at least ${MIN_SILENT_DAYS} days). A customer can show more than one sign.`}
          download={exportHref({ view: "stopped" })}
        >
          <BarList
            color="bg-red-500"
            items={stoppedSignals.map((s) => ({ label: s.label, value: s.count, href: viewHref({ view: "stopped", signal: s.key }) }))}
            total={stopped.length}
          />
        </Section>
        <Section
          title={`Why one-time bookers didn't return (${goneOnce.length})`}
          note={`Booked once, at least ${ONE_TIME_GRACE_DAYS} days ago, and never again.`}
          download={exportHref({ view: "onetime" })}
        >
          <BarList
            color="bg-orange-500"
            items={onceSignals.map((s) => ({ label: s.label, value: s.count, href: viewHref({ view: "onetime", signal: s.key }) }))}
            total={goneOnce.length}
          />
        </Section>
      </div>

      <Section
        title="Bookings per week"
        note="Paid bookings, split into first-time customers and returning customers, with new registrations"
      >
        <TrendChart weeks={trend} />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section
          title="Do customers come back? By salon"
          note="Of customers whose first booking was at this salon, how many booked again (salons with 10+ customers)"
        >
          <RateList items={salons.map((s) => ({ ...s, href: viewHref({ view: "salon", salon: s.key }) }))} />
        </Section>
        <Section
          title="Do customers come back? By first coupon"
          note="Team members' personal codes vs offer codes vs no coupon (codes used by 15+ customers)"
        >
          <RateList items={coupons.map((c) => ({ ...c, href: viewHref({ view: "coupon", coupon: c.key }) }))} />
        </Section>
      </div>

      {/* Drill-down list */}
      {selected && view && (
        <div id="list" className="scroll-mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 mt-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {listTitle} <span className="text-slate-400 font-normal">({totalRows.toLocaleString()})</span>
            </h2>
            <div className="flex gap-2">
              <a href={exportHref(listParams)} download className="px-3 h-8 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
                Download this list (Excel)
              </a>
              <Link href="/admin/insights" className="px-3 h-8 inline-flex items-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-medium">
                Close
              </Link>
            </div>
          </div>
          {selected.kind === "failed" ? (
            <FailedTable rows={pageRows as FailedPaymentRow[]} />
          ) : (
            <FactsTable rows={pageRows as CustomerFacts[]} />
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Link
                  href={viewHref({ ...listParams, page: String(Math.max(1, page - 1)) })}
                  className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
                >
                  Previous
                </Link>
                <Link
                  href={viewHref({ ...listParams, page: String(Math.min(totalPages, page + 1)) })}
                  className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === totalPages ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
                >
                  Next
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function Section({
  title,
  note,
  download,
  children,
}: {
  title: string;
  note?: string;
  download?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {note && <p className="text-xs text-slate-500 mt-1">{note}</p>}
        </div>
        {download && (
          <a href={download} download className="px-2.5 h-7 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
            Download Excel
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone?: "red" | "amber";
}) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : "text-gray-900";
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow transition-shadow block">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={"text-2xl font-bold mt-1 " + color}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </Link>
  );
}

function BarList({
  items,
  color,
  total,
  showShareOfFirst,
}: {
  items: { label: string; value: number; href?: string }[];
  color: string;
  total?: number;
  showShareOfFirst?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const first = items[0]?.value ?? 0;
  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const share = total !== undefined ? pct(i.value, total) : showShareOfFirst ? pct(i.value, first) : null;
        const body = (
          <div className="group">
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
              <span className={"text-gray-800 " + (i.href ? "group-hover:text-blue-700 group-hover:underline" : "")}>{i.label}</span>
              <span className="text-gray-900 font-semibold whitespace-nowrap">
                {i.value.toLocaleString()}
                {share !== null && <span className="text-slate-400 font-normal ml-1.5">{share}%</span>}
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={"h-full rounded-full " + color} style={{ width: Math.max(i.value ? 1 : 0, (100 * i.value) / max) + "%" }} />
            </div>
          </div>
        );
        return i.href ? (
          <Link key={i.label} href={i.href} className="block">
            {body}
          </Link>
        ) : (
          <div key={i.label}>{body}</div>
        );
      })}
    </div>
  );
}

function RateList({ items }: { items: { key: string; customers: number; returned: number; rate: number; href: string }[] }) {
  if (items.length === 0) return <p className="text-sm text-slate-400">Not enough data yet.</p>;
  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const r = Math.round(i.rate * 100);
        const color = r >= 60 ? "bg-emerald-500" : r >= 35 ? "bg-amber-400" : "bg-red-500";
        return (
          <Link key={i.key} href={i.href} className="block group">
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
              <span className="text-gray-800 group-hover:text-blue-700 group-hover:underline truncate">{i.key}</span>
              <span className="whitespace-nowrap">
                <span className="font-semibold text-gray-900">{r}%</span>
                <span className="text-slate-400 ml-1.5">
                  {i.returned}/{i.customers}
                </span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={"h-full rounded-full " + color} style={{ width: Math.max(r ? 1 : 0, r) + "%" }} />
            </div>
          </Link>
        );
      })}
      <p className="text-xs text-slate-400 pt-1">Green 60%+ come back, amber 35-59%, red below 35%.</p>
    </div>
  );
}

function TrendChart({ weeks }: { weeks: { start: Date; newBookers: number; repeat: number; registrations: number }[] }) {
  const maxBookings = Math.max(1, ...weeks.map((w) => w.newBookers + w.repeat));
  const maxRegs = Math.max(1, ...weeks.map((w) => w.registrations));
  return (
    <div>
      <div className="flex items-end gap-2 h-48 border-b border-slate-200">
        {weeks.map((w) => {
          const total = w.newBookers + w.repeat;
          return (
            <div key={w.start.toISOString()} className="flex-1 h-full flex flex-col justify-end items-center relative" title={`${w.newBookers} first-time, ${w.repeat} returning, ${w.registrations} registrations`}>
              <span className="text-[11px] text-slate-500 mb-0.5">{total}</span>
              <div className="w-full flex flex-col justify-end" style={{ height: (100 * total) / maxBookings + "%" }}>
                <div className="bg-blue-500 rounded-t" style={{ height: total ? (100 * w.repeat) / total + "%" : 0 }} />
                <div className="bg-emerald-400" style={{ height: total ? (100 * w.newBookers) / total + "%" : 0 }} />
              </div>
              <div
                className="absolute left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-violet-500 ring-2 ring-white"
                style={{ bottom: `calc(${(100 * w.registrations) / maxRegs}% - 4px)` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-1">
        {weeks.map((w) => (
          <div key={w.start.toISOString()} className="flex-1 text-center text-[10px] text-slate-400">
            {formatDateIN(w.start, { day: "numeric", month: "short" })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500" /> Returning customers</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400" /> First-time customers</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> New registrations (own scale, peak {maxRegs})</span>
      </div>
    </div>
  );
}

function FactsTable({ rows }: { rows: CustomerFacts[] }) {
  if (rows.length === 0) return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No customers here.</div>;
  const label = (k: string) => SIGNALS.find((s) => s.key === k)?.label ?? k;
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">Owner</th>
            <th className="px-3 py-3 text-right">Visits</th>
            <th className="px-3 py-3 text-right">Spent</th>
            <th className="px-3 py-3">Usually every</th>
            <th className="px-3 py-3">Last booking</th>
            <th className="px-3 py-3">Last salon</th>
            <th className="px-3 py-3">Signs</th>
            <th className="px-3 py-3">Team&apos;s last remark</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50 align-top">
              <td className="px-3 py-3 font-medium text-gray-900">{r.name ?? "(no name)"}{r.city && <div className="text-xs text-slate-400 font-normal">{r.city}</div>}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3 text-gray-600">{r.ownerName ?? "-"}</td>
              <td className="px-3 py-3 text-right text-gray-900">{r.visits}</td>
              <td className="px-3 py-3 text-right text-gray-900 whitespace-nowrap">{rupees(r.revenue)}</td>
              <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.usualGapDays !== null ? Math.round(r.usualGapDays) + " days" : "-"}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                {formatDateIN(r.lastPaidAt)}
                <div className="text-xs text-slate-400">{r.daysSinceLast} days ago</div>
              </td>
              <td className="px-3 py-3 text-gray-600">{r.lastSalon ?? "-"}</td>
              <td className="px-3 py-3 text-xs text-gray-600 min-w-[13rem] max-w-[16rem]">{r.signals.length ? r.signals.map(label).join("; ") : "-"}</td>
              <td className="px-3 py-3 text-xs text-gray-600 min-w-[11rem] max-w-[14rem]">
                {r.remarkSince ?? "-"}
                {r.noteSince && <div className="text-slate-400 italic">&ldquo;{r.noteSince}&rdquo;</div>}
              </td>
              <td className="px-3 py-3">
                <Link href={"/customers/" + r.id} className="text-blue-600 hover:underline text-xs">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailedTable({ rows }: { rows: FailedPaymentRow[] }) {
  if (rows.length === 0) return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600">No customers here.</div>;
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">City</th>
            <th className="px-3 py-3">Owner</th>
            <th className="px-3 py-3 text-right">Failed tries</th>
            <th className="px-3 py-3">Last try</th>
            <th className="px-3 py-3">Salon</th>
            <th className="px-3 py-3">Called since?</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-3 py-3 font-medium text-gray-900">{r.name ?? "(no name)"}</td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3 text-gray-600">{r.city ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{r.ownerName ?? "-"}</td>
              <td className="px-3 py-3 text-right text-gray-900">{r.failedOrders}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{formatDateIN(r.lastTriedAt)}</td>
              <td className="px-3 py-3 text-gray-600">{r.lastSalon ?? "-"}</td>
              <td className="px-3 py-3 text-gray-600">{r.contactedSince ? "Yes" : <span className="text-red-600">No</span>}</td>
              <td className="px-3 py-3">
                <Link href={"/customers/" + r.id} className="text-blue-600 hover:underline text-xs">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
