import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import MultiSelect from "@/components/MultiSelect";
import { loadInsights, parseFilters, applyFilters, NO_CAMPAIGN, NO_OWNER, type InsightFilters, type LeadFacts } from "@/lib/insights";
import { TREE, treeStats, findNode, flattenTree, conversionByCategory, nodeList, type TreeNode, type NodeStats } from "@/lib/journeyTree";
import { SEGMENTS, segmentInfo, isSegmentKey, type SegmentKey } from "@/lib/segments";
import { buildQuery, oneParam, type SearchParamsRecord } from "@/lib/params";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import styles from "./tree.module.css";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
const DAY = 86_400_000;
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const num = (n: number) => n.toLocaleString("en-IN");
const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

const TONES: Record<TreeNode["tone"], { accent: string; soft: string; text: string; donut: string }> = {
  root: { accent: "border-l-blue-600", soft: "bg-blue-50", text: "text-blue-700", donut: "#2563eb" },
  neutral: { accent: "border-l-slate-400", soft: "bg-slate-50", text: "text-slate-700", donut: "#94a3b8" },
  good: { accent: "border-l-emerald-500", soft: "bg-emerald-50", text: "text-emerald-700", donut: "#10b981" },
  bad: { accent: "border-l-rose-500", soft: "bg-rose-50", text: "text-rose-700", donut: "#f43f5e" },
  pipe: { accent: "border-l-amber-500", soft: "bg-amber-50", text: "text-amber-700", donut: "#f59e0b" },
};

export default async function Insights2Page({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const raw = await searchParams;
  const filters: InsightFilters = { ...parseFilters(raw), salon: [] };
  const nodeKey = oneParam(raw.node);
  const selected = nodeKey ? findNode(nodeKey) : null;
  const segParam = oneParam(raw.seg);
  const seg: SegmentKey | null = isSegmentKey(segParam) ? segParam : null;
  const page = Math.max(1, parseInt(oneParam(raw.page) || "1", 10) || 1);

  const { leads: allLeads } = await loadInsights();
  const leads = applyFilters(allLeads, filters);
  const stats = treeStats(leads);
  const byCategory = conversionByCategory(leads);
  const st = (key: string) => stats.get(key)!;

  const fp = { from: filters.from, to: filters.to, campaign: filters.campaign, owner: filters.owner };
  const nodeHref = (key: string, s?: SegmentKey | null) => "/admin/insights2" + buildQuery({ ...fp, node: key, seg: s ?? undefined }) + "#list";
  const filterHref = (patch: Partial<typeof fp>) => "/admin/insights2" + buildQuery({ ...fp, ...patch });
  const exportHref = (extra: Record<string, string | undefined>) => "/api/admin/insights2/export" + buildQuery({ ...fp, ...extra });

  // Filter options come from every customer, so a choice never disappears.
  const countBy = (xs: string[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const campaignCounts = countBy(allLeads.map((l) => l.campaign));
  const campaignOptions = [
    ...Array.from(campaignCounts)
      .filter(([k]) => k !== NO_CAMPAIGN)
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => ({ value: k, label: k, count: c })),
    { value: NO_CAMPAIGN, label: "No campaign", count: campaignCounts.get(NO_CAMPAIGN) ?? 0 },
  ];
  const ownerCounts = countBy(allLeads.map((l) => l.ownerKey));
  const ownerOptions = Array.from(new Map(allLeads.map((l) => [l.ownerKey, l.ownerName])))
    .map(([value, label]) => ({ value, label, count: ownerCounts.get(value) ?? 0 }))
    .sort((a, b) => (a.value === NO_OWNER ? 1 : b.value === NO_OWNER ? -1 : a.label.localeCompare(b.label)));

  // Headline: where everyone stands now.
  const total = st("all").total;
  const called = st("called").total;
  const converted = st("first_converted").total + st("later_converted").total;
  const closed = st("first_closed").total + st("later_closed").total;
  const pipeline = st("pipeline").total;
  const bookedNoCall = st("nocall_booked").total;
  const waiting = st("nocall_never").total;
  const donut = [
    { label: "Converted after our calls", value: converted, color: "#10b981", href: nodeHref("converted") },
    { label: "Still in pipeline", value: pipeline, color: "#f59e0b", href: nodeHref("pipeline") },
    { label: "Do not contact", value: closed, color: "#f43f5e", href: nodeHref("closed") },
    { label: "Booked without a call", value: bookedNoCall, color: "#38bdf8", href: nodeHref("nocall_booked") },
    { label: "Waiting for first call", value: waiting, color: "#cbd5e1", href: nodeHref("nocall_never") },
  ];

  const rows = selected ? nodeList(leads, selected, seg) : [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedPath = selected ? flattenTree().find((x) => x.node.key === selected.key) : null;

  const today = todayIsoIST();
  const daysAgo = (n: number) => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const lastMonthEnd = new Date(Date.parse(monthStart) - DAY).toISOString().slice(0, 10);
  const ranges = [
    { label: "All time", from: undefined, to: undefined },
    { label: "Last 30 days", from: daysAgo(29), to: today },
    { label: "Last 90 days", from: daysAgo(89), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: lastMonthEnd.slice(0, 8) + "01", to: lastMonthEnd },
  ];

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Insights 2.0 <span className="ml-1 align-middle text-[11px] font-semibold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">Follow-up tree</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            How our calls turn customers into bookings. Click any box to see those customers. Colours show each customer&apos;s category when we first called them.
          </p>
        </div>
        <a href={exportHref({ node: "report" })} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          Download full report (Excel)
        </a>
      </div>

      {/* ---------- Filters ---------- */}
      <form method="GET" action="/admin/insights2" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <Field label="Joined from">
            <input type="date" name="from" defaultValue={filters.from ?? ""} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Joined to">
            <input type="date" name="to" defaultValue={filters.to ?? ""} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Campaign">
            <MultiSelect name="campaign" allLabel="All campaigns" selected={filters.campaign} options={campaignOptions} />
          </Field>
          <Field label="Agent">
            <MultiSelect name="owner" allLabel="All agents" selected={filters.owner} options={ownerOptions} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
            <Link href="/admin/insights2" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Clear</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          <span className="text-slate-500">Quick dates:</span>
          {ranges.map((r) => {
            const active = filters.from === r.from && filters.to === r.to;
            return (
              <Link
                key={r.label}
                href={filterHref({ from: r.from, to: r.to })}
                className={"px-2.5 py-1 rounded-full border " + (active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")}
              >
                {r.label}
              </Link>
            );
          })}
          <span className="text-slate-400 ml-1">&ldquo;Joined&rdquo; = the day they registered or first tried to book.</span>
        </div>
      </form>

      {/* ---------- Headline ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5 mb-6">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 flex flex-col sm:flex-row items-center gap-6">
          <Donut parts={donut} total={total} />
          <ul className="flex-1 w-full space-y-1.5">
            {donut.map((d) => (
              <li key={d.label}>
                <Link href={d.href} className="flex items-center justify-between gap-3 text-sm rounded-lg px-2 py-1 -mx-2 hover:bg-slate-50 group">
                  <span className="flex items-center gap-2 text-gray-700 group-hover:text-blue-700">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} />
                    {d.label}
                  </span>
                  <span className="font-semibold text-gray-900 whitespace-nowrap">
                    {num(d.value)} <span className="text-slate-400 font-normal">{pct(d.value, total)}%</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="xl:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Customers" value={num(total)} sub={`${num(called)} called by the team`} href={nodeHref("all")} />
          <Kpi label="Converted" value={num(converted)} sub={`${pct(converted, called)}% of called customers`} href={nodeHref("converted")} tone="good" big />
          <Kpi label="After 1st call" value={num(st("first_converted").total)} sub={`${pct(st("first_converted").total, converted)}% of conversions`} href={nodeHref("first_converted")} tone="good" />
          <Kpi label="After more follow-ups" value={num(st("later_converted").total)} sub={`${pct(st("later_converted").total, converted)}% of conversions`} href={nodeHref("later_converted")} tone="good" />
          <Kpi label="Still in pipeline" value={num(pipeline)} sub="being followed up" href={nodeHref("pipeline")} tone="pipe" />
          <Kpi label="Do not contact" value={num(closed)} sub={`${pct(closed, called)}% of called customers`} href={nodeHref("closed")} tone="bad" />
          <Kpi label="Not called yet" value={num(st("notcalled").total)} sub={`${num(waiting)} never booked`} href={nodeHref("nocall_never")} />
          <Kpi label="Booked, no call" value={num(bookedNoCall)} sub="came on their own" href={nodeHref("nocall_booked")} />
        </div>
      </div>

      {/* ---------- Tree ---------- */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Follow-up decision tree</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl">
              Every customer ends in exactly one box on the right. &ldquo;Converted&rdquo; means a real paid booking (Success / Partially Paid) on or after the day of
              our first call. Percentages are of the box on the left.
            </p>
          </div>
          <SegmentLegend />
        </div>
        <div className="overflow-x-auto pb-2">
          <ul className={styles.root} style={{ ["--line" as string]: "#cbd5e1" }}>
            <TreeBranch node={TREE} parentTotal={null} stats={stats} selectedKey={selected?.key ?? null} hrefFor={(k) => nodeHref(k)} />
          </ul>
        </div>
      </div>

      {/* ---------- Conversion by category ---------- */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-gray-900">Which category converts best?</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">
          Grouped by the customer&apos;s category on the day we first called them (customers we haven&apos;t called use today&apos;s category). Click a number to see the customers.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2 text-right">Customers</th>
                <th className="px-2 py-2 text-right">Called</th>
                <th className="px-2 py-2 w-72">Of those called</th>
                <th className="px-2 py-2 text-right">Converted</th>
                <th className="px-2 py-2 text-right">Conversion</th>
                <th className="px-2 py-2 text-right">Not called yet</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byCategory.map((c) => {
                const s = segmentInfo(c.key);
                return (
                  <tr key={c.key}>
                    <td className="px-2 py-3">
                      <span className={"inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium " + s.badge}>
                        <span className={"w-2 h-2 rounded-full " + s.dot} />
                        {s.label}
                      </span>
                      <div className="text-[11px] text-slate-400 mt-0.5">{s.help}</div>
                    </td>
                    <td className="px-2 py-3 text-right font-semibold text-gray-900">
                      <Link href={nodeHref("all", c.key)} className="hover:underline">{num(c.total)}</Link>
                    </td>
                    <td className="px-2 py-3 text-right text-gray-700">
                      <Link href={nodeHref("called", c.key)} className="hover:underline">{num(c.called)}</Link>
                    </td>
                    <td className="px-2 py-3">
                      <OutcomeBar
                        total={c.called}
                        parts={[
                          { label: "Converted after 1st call", value: c.firstCall, color: "bg-emerald-500" },
                          { label: "Converted later", value: c.later, color: "bg-emerald-300" },
                          { label: "Still in pipeline", value: c.pipeline, color: "bg-amber-400" },
                          { label: "Do not contact", value: c.closed, color: "bg-rose-500" },
                        ]}
                      />
                    </td>
                    <td className="px-2 py-3 text-right text-emerald-700 font-semibold">
                      <Link href={nodeHref("converted", c.key)} className="hover:underline">{num(c.converted)}</Link>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <span className="text-lg font-bold text-gray-900">{pct(c.converted, c.called)}%</span>
                    </td>
                    <td className="px-2 py-3 text-right text-gray-600">
                      <Link href={nodeHref("notcalled", c.key)} className="hover:underline">{num(c.notCalled)}</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-600">
            <LegendDot className="bg-emerald-500" label="Converted after 1st call" />
            <LegendDot className="bg-emerald-300" label="Converted later" />
            <LegendDot className="bg-amber-400" label="Still in pipeline" />
            <LegendDot className="bg-rose-500" label="Do not contact" />
          </div>
        </div>
      </div>

      {/* ---------- Customer list for the clicked box ---------- */}
      {selected && (
        <div id="list" className="scroll-mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 mt-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {selected.title} <span className="text-slate-400 font-normal">({num(rows.length)})</span>
              </h2>
              <p className="text-xs text-slate-500">
                {selectedPath?.parent ? selectedPath.parent.title + " → " : ""}
                {selected.help}
              </p>
            </div>
            <div className="flex gap-2">
              <a href={exportHref({ node: selected.key, seg: seg ?? undefined })} download className="px-3 h-8 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
                Download this list (Excel)
              </a>
              <Link href={filterHref({})} className="px-3 h-8 inline-flex items-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-medium">
                Close
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <SegChip href={nodeHref(selected.key, null)} active={!seg} label="All categories" count={st(selected.key).total} />
            {SEGMENTS.map((s) => (
              <SegChip key={s.key} href={nodeHref(selected.key, s.key)} active={seg === s.key} label={s.label} count={st(selected.key).bySegment[s.key]} dot={s.dot} />
            ))}
          </div>
          <CustomerTable rows={pageRows} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Link
                  href={"/admin/insights2" + buildQuery({ ...fp, node: selected.key, seg: seg ?? undefined, page: String(Math.max(1, page - 1)) }) + "#list"}
                  className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
                >
                  Previous
                </Link>
                <Link
                  href={"/admin/insights2" + buildQuery({ ...fp, node: selected.key, seg: seg ?? undefined, page: String(Math.min(totalPages, page + 1)) }) + "#list"}
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

// ---------- tree ----------

function TreeBranch({
  node,
  parentTotal,
  stats,
  selectedKey,
  hrefFor,
}: {
  node: TreeNode;
  parentTotal: number | null;
  stats: Map<string, NodeStats>;
  selectedKey: string | null;
  hrefFor: (key: string) => string;
}) {
  const s = stats.get(node.key)!;
  return (
    <li>
      <NodeCard node={node} stats={s} parentTotal={parentTotal} selected={selectedKey === node.key} href={hrefFor(node.key)} />
      {node.children && (
        <ul>
          {node.children.map((c) => (
            <TreeBranch key={c.key} node={c} parentTotal={s.total} stats={stats} selectedKey={selectedKey} hrefFor={hrefFor} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeCard({ node, stats, parentTotal, selected, href }: { node: TreeNode; stats: NodeStats; parentTotal: number | null; selected: boolean; href: string }) {
  const t = TONES[node.tone];
  const share = parentTotal !== null ? pct(stats.total, parentTotal) : 100;
  return (
    <Link
      href={href}
      title={node.help}
      className={
        "block w-52 flex-shrink-0 rounded-xl border border-gray-200 border-l-4 bg-white p-3 shadow-sm transition hover:shadow-md hover:-translate-y-0.5 " +
        t.accent +
        (selected ? " ring-2 ring-blue-500 ring-offset-2" : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700 leading-tight">{node.title}</p>
        {parentTotal !== null && <span className={"text-[11px] font-semibold rounded-full px-1.5 py-0.5 " + t.soft + " " + t.text}>{share}%</span>}
      </div>
      <p className={"text-2xl font-bold mt-1 " + (node.tone === "root" ? "text-blue-700" : "text-gray-900")}>{num(stats.total)}</p>
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-100 mt-2">
        {SEGMENTS.map((x) =>
          stats.bySegment[x.key] > 0 ? (
            <div key={x.key} className={x.bar} style={{ width: (100 * stats.bySegment[x.key]) / Math.max(1, stats.total) + "%" }} />
          ) : null
        )}
      </div>
      <div className="grid grid-cols-4 gap-1 mt-1.5 text-[10px] text-slate-500">
        {SEGMENTS.map((x) => (
          <span key={x.key} className="flex items-center gap-1" title={x.label + ": " + stats.bySegment[x.key].toLocaleString("en-IN")}>
            <span className={"w-1.5 h-1.5 rounded-full flex-shrink-0 " + x.dot} />
            {compact(stats.bySegment[x.key])}
          </span>
        ))}
      </div>
    </Link>
  );
}

const compact = (n: number) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

// ---------- building blocks ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Donut({ parts, total }: { parts: { label: string; value: number; color: string }[]; total: number }) {
  let acc = 0;
  const stops = parts
    .filter((p) => p.value > 0)
    .map((p) => {
      const start = (100 * acc) / Math.max(1, total);
      acc += p.value;
      const end = (100 * acc) / Math.max(1, total);
      return `${p.color} ${start}% ${end}%`;
    });
  const converted = parts[0]?.value ?? 0;
  return (
    <div className="relative w-44 h-44 flex-shrink-0">
      <div className="absolute inset-0 rounded-full" style={{ background: total ? `conic-gradient(${stops.join(", ")})` : "#e2e8f0" }} />
      <div className="absolute inset-[18%] rounded-full bg-white flex flex-col items-center justify-center text-center shadow-inner">
        <span className="text-3xl font-bold text-emerald-600">{num(converted)}</span>
        <span className="text-[11px] text-slate-500 leading-tight">converted<br />of {num(total)}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, href, tone, big }: { label: string; value: string; sub: string; href: string; tone?: "good" | "bad" | "pipe"; big?: boolean }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : tone === "pipe" ? "text-amber-600" : "text-gray-900";
  return (
    <Link href={href} className={"rounded-xl border shadow-sm p-3 hover:shadow transition block " + (big ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={"text-2xl font-bold mt-0.5 " + color}>{value}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </Link>
  );
}

function SegmentLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {SEGMENTS.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5" title={s.help}>
          <span className={"w-2.5 h-2.5 rounded-full " + s.dot} />
          {s.label} <span className="text-slate-400">({s.help})</span>
        </span>
      ))}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={"w-3 h-3 rounded-sm " + className} />
      {label}
    </span>
  );
}

function OutcomeBar({ total, parts }: { total: number; parts: { label: string; value: number; color: string }[] }) {
  if (!total) return <span className="text-xs text-slate-400">nobody called yet</span>;
  return (
    <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100">
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.label} className={p.color} style={{ width: (100 * p.value) / total + "%" }} title={`${p.label}: ${p.value.toLocaleString("en-IN")} (${pct(p.value, total)}%)`} />
        ))}
    </div>
  );
}

function SegChip({ href, active, label, count, dot }: { href: string; active: boolean; label: string; count: number; dot?: string }) {
  return (
    <Link
      href={href}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium " +
        (active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-gray-200 hover:bg-slate-50")
      }
    >
      {dot && <span className={"w-2 h-2 rounded-full " + dot} />}
      {label}
      <span className={active ? "text-blue-100" : "text-slate-400"}>{count.toLocaleString("en-IN")}</span>
    </Link>
  );
}

function SegBadge({ k }: { k: SegmentKey }) {
  const s = segmentInfo(k);
  return (
    <span className={"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap " + s.badge}>
      <span className={"w-1.5 h-1.5 rounded-full " + s.dot} />
      {s.short}
    </span>
  );
}

function CustomerTable({ rows }: { rows: LeadFacts[] }) {
  if (rows.length === 0) return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600 mb-6">No customers here.</div>;
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">When first called</th>
            <th className="px-3 py-3">Now</th>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Campaign</th>
            <th className="px-3 py-3">First called</th>
            <th className="px-3 py-3 text-right" title="Separate days the team called or left a remark">Days called</th>
            <th className="px-3 py-3">Converted on</th>
            <th className="px-3 py-3 text-right">Paid visits</th>
            <th className="px-3 py-3 text-right">Spent</th>
            <th className="px-3 py-3">Latest remark</th>
            <th className="px-3 py-3">Latest note</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50 align-top">
              <td className="px-3 py-3 font-medium text-gray-900">
                {r.name ?? "(no name)"}
                {r.city && <div className="text-xs text-slate-400 font-normal">{r.city}</div>}
                {r.doNotContact && <div className="text-[11px] text-rose-600 font-normal">Do not contact</div>}
              </td>
              <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
              <td className="px-3 py-3"><SegBadge k={r.segmentAtStart} /></td>
              <td className="px-3 py-3"><SegBadge k={r.segmentNow} /></td>
              <td className="px-3 py-3 text-gray-600">{r.ownerName}</td>
              <td className="px-3 py-3 text-gray-600 text-xs">{r.campaign === NO_CAMPAIGN ? "-" : r.campaign}</td>
              <td className="px-3 py-3 text-gray-700 whitespace-nowrap">{r.firstContactAt ? formatDateIN(r.firstContactAt) : "-"}</td>
              <td className="px-3 py-3 text-right text-gray-900">{r.contactDays}</td>
              <td className="px-3 py-3 whitespace-nowrap">{r.convertedAt ? <span className="text-emerald-700 font-medium">{formatDateIN(r.convertedAt)}</span> : "-"}</td>
              <td className="px-3 py-3 text-right text-gray-900">{r.visits}</td>
              <td className="px-3 py-3 text-right text-gray-900 whitespace-nowrap">{r.revenue ? rupees(r.revenue) : "-"}</td>
              <td className="px-3 py-3 text-xs min-w-[10rem]">
                {r.latestRemark ? (
                  <>
                    <span className="font-medium text-gray-800">{r.latestRemark.label}</span>
                    <div className="text-slate-400">
                      {formatDateIN(r.latestRemark.at)}
                      {r.latestRemark.by ? " · " + r.latestRemark.by : ""}
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400">No remark</span>
                )}
              </td>
              <td className="px-3 py-3 text-xs min-w-[12rem] max-w-[18rem]">
                {r.latestNote ? (
                  <>
                    <p className="text-gray-800 whitespace-pre-line">&ldquo;{r.latestNote.text}&rdquo;</p>
                    <p className="text-slate-400 mt-1">
                      {formatDateIN(r.latestNote.at)}
                      {r.latestNote.by ? " · " + r.latestNote.by : ""}
                    </p>
                  </>
                ) : (
                  <span className="text-slate-400">No notes yet</span>
                )}
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
