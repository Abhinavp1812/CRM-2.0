import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import {
  loadInsights,
  parseFilters,
  applyFilters,
  summarize,
  summarizeBy,
  reasonCounts,
  returnRateBy,
  weeklyTrend,
  selectList,
  listTitle,
  isListKey,
  outcomeOf,
  reasonLabel,
  OUTCOMES,
  OUTCOME_HELP,
  TEMPERATURES,
  GRACE_DAYS,
  NO_CAMPAIGN,
  NO_OWNER,
  type InsightFilters,
  type LeadFacts,
  type ListQuery,
  type LatestNote,
  type Summary,
} from "@/lib/insights";
import { formatDateIN, todayIsoIST } from "@/lib/formatDate";
import { buildQuery, oneParam, type SearchParamsRecord } from "@/lib/params";
import MultiSelect from "@/components/MultiSelect";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;
const DAY = 86_400_000;

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const rupees = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const num = (n: number) => n.toLocaleString("en-IN");

type SP = Record<string, string | string[] | undefined>;
const qs = buildQuery;

const filterParams = (f: InsightFilters): SP => ({ from: f.from, to: f.to, campaign: f.campaign, salon: f.salon, owner: f.owner });

export default async function InsightsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const raw = await searchParams;
  const filters = parseFilters(raw);
  const sp = Object.fromEntries(["page", "list", "reason", "temp", "rsalon", "rcoupon"].map((k) => [k, oneParam(raw[k])]));
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);
  const list: ListQuery | null =
    sp.list && isListKey(sp.list)
      ? { list: sp.list, reason: sp.reason || undefined, temp: sp.temp || undefined, rsalon: sp.rsalon || undefined, rcoupon: sp.rcoupon || undefined }
      : null;

  const { now, leads: allLeads } = await loadInsights();
  const leads = applyFilters(allLeads, filters);
  const s = summarize(leads, now);

  // Links keep the current filters.
  const fp = filterParams(filters);
  const listHref = (q: Partial<ListQuery> & { list: string }) => "/admin/insights" + qs({ ...fp, ...q }) + "#list";
  const filterHref = (patch: Partial<InsightFilters>) => "/admin/insights" + qs({ ...fp, ...patch });
  const exportHref = (extra: SP) => "/api/admin/insights/export" + qs({ ...fp, ...extra });

  // Filter dropdown options come from all leads, so a choice never disappears.
  const campaignCounts = countOptions(allLeads.map((l) => l.campaign));
  const campaignOptions = campaignCounts.filter((o) => o.key !== NO_CAMPAIGN);
  const noCampaignCount = campaignCounts.find((o) => o.key === NO_CAMPAIGN)?.count ?? 0;
  const ownerCounts = new Map(countOptions(allLeads.map((l) => l.ownerKey)).map((o) => [o.key, o.count]));
  const salonOptions = countOptions(allLeads.filter((l) => l.firstSalon).map((l) => l.firstSalon!));
  const ownerOptions = Array.from(new Map(allLeads.map((l) => [l.ownerKey, l.ownerName])), ([key, label]) => ({ key, label })).sort((a, b) =>
    a.key === NO_OWNER ? 1 : b.key === NO_OWNER ? -1 : a.label.localeCompare(b.label)
  );

  const campaigns = summarizeBy(applyFilters(allLeads, filters, ["campaign"]), (l) => l.campaign, now);
  const agents = summarizeBy(leads, (l) => l.ownerKey, now);
  const ownerName = new Map(ownerOptions.map((o) => [o.key, o.label]));
  const notBooked = leads.filter((l) => l.visits === 0);
  const lapsed = leads.filter((l) => l.outcome === "once_gone" || l.outcome === "stopped");
  const whyNotBooked = reasonCounts(notBooked);
  const whyNotBack = reasonCounts(lapsed);
  const salons = returnRateBy(leads, (l) => l.firstSalon, 10, now);
  const coupons = returnRateBy(leads, (l) => l.firstCoupon, 15, now).slice(0, 15);
  const trend = weeklyTrend(applyFilters(allLeads, filters, ["from", "to"]), now, 12);

  const lapsedNotCalled = lapsed.filter((l) => l.reason === "not_called_since").length;
  const notContacted = s.outcomes.not_contacted;
  const realCampaigns = campaigns.filter((c) => c.key !== NO_CAMPAIGN && c.leads >= 20);
  const bestBooking = [...realCampaigns].sort((a, b) => b.booked / b.leads - a.booked / a.leads)[0];
  const withReturns = realCampaigns.filter((c) => c.eligible >= 10);
  const bestReturn = [...withReturns].sort((a, b) => b.eligibleReturned / b.eligible - a.eligibleReturned / a.eligible)[0];

  const rows = list ? selectList(leads, list, now) : [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const listParams: SP = list ? { list: list.list, reason: list.reason, temp: list.temp, rsalon: list.rsalon, rcoupon: list.rcoupon } : {};

  const today = todayIsoIST();
  const daysAgo = (n: number) => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const lastMonthEnd = new Date(Date.parse(monthStart) - DAY).toISOString().slice(0, 10);
  const lastMonthStart = lastMonthEnd.slice(0, 8) + "01";
  const ranges = [
    { label: "All time", from: undefined, to: undefined },
    { label: "Last 30 days", from: daysAgo(29), to: today },
    { label: "Last 90 days", from: daysAgo(89), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: lastMonthStart, to: lastMonthEnd },
  ];
  const filterSentence = describeFilters(filters, ownerName);

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insights</h1>
          <p className="text-sm text-slate-500 mt-1">
            What happened to every lead, which campaigns work, and why people don&apos;t book (again). Click any number or bar to see those customers.
          </p>
        </div>
        <a href={exportHref({ list: "report" })} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          Download full report (Excel)
        </a>
      </div>

      {/* ---------- Filters ---------- */}
      <form method="GET" action="/admin/insights" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
          <Field label="Joined from">
            <input type="date" name="from" defaultValue={filters.from ?? ""} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Joined to">
            <input type="date" name="to" defaultValue={filters.to ?? ""} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Campaign">
            <MultiSelect
              name="campaign"
              allLabel="All campaigns"
              selected={filters.campaign}
              options={[
                ...campaignOptions.map((o) => ({ value: o.key, label: o.key, count: o.count })),
                { value: NO_CAMPAIGN, label: "No campaign", count: noCampaignCount },
              ]}
            />
          </Field>
          <Field label="First booked at salon">
            <MultiSelect
              name="salon"
              allLabel="All salons"
              selected={filters.salon}
              options={salonOptions.map((o) => ({ value: o.key, label: o.key, count: o.count }))}
            />
          </Field>
          <Field label="Agent">
            <MultiSelect
              name="owner"
              allLabel="All agents"
              selected={filters.owner}
              options={ownerOptions.map((o) => ({ value: o.key, label: o.label, count: ownerCounts.get(o.key) ?? 0 }))}
            />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
            <Link href="/admin/insights" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Clear</Link>
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
        </div>
      </form>
      <p className="text-sm text-slate-600 mb-5">
        Showing <b>{num(s.leads)}</b> leads{filterSentence}. &ldquo;Joined&rdquo; = the day they registered or first tried to book, whichever came first.
        {filters.salon.length > 0 && " The salon filter only keeps customers who booked, so leads who never booked aren't included."}
      </p>

      {/* ---------- Headline numbers ---------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <Stat label="Leads" value={num(s.leads)} sub={`${num(s.registered)} registered`} href={listHref({ list: "all" })} />
        <Stat label="Contacted by team" value={pct(s.contacted, s.leads) + "%"} sub={`${num(s.contacted)} of ${num(s.leads)} leads`} href={listHref({ list: "contacted_any" })} />
        <Stat label="Booked" value={pct(s.booked, s.leads) + "%"} sub={`${num(s.booked)} leads made a paid booking`} href={listHref({ list: "booked" })} tone="blue" />
        <Stat
          label="Came back"
          value={pct(s.eligibleReturned, s.eligible) + "%"}
          sub={`${num(s.eligibleReturned)} of ${num(s.eligible)} who first booked ${GRACE_DAYS}+ days ago`}
          href={listHref({ list: "returned" })}
          tone="green"
        />
        <Stat label="Revenue" value={rupees(s.revenue)} sub={`${num(s.orders)} paid orders`} href={listHref({ list: "booked" })} />
        <Stat label="Lost customers" value={num(lapsed.length)} sub="booked once & gone, or stopped" href={listHref({ list: "lapsed" })} tone="red" />
      </div>

      {/* ---------- Plain-language findings ---------- */}
      <Section title="What the data says">
        <ul className="space-y-2 text-sm text-gray-800 list-disc pl-5">
          <li>
            <b>{num(s.booked)}</b> of <b>{num(s.leads)}</b> leads ({pct(s.booked, s.leads)}%) made at least one paid booking.{" "}
            <b>{num(s.outcomes.not_contacted)}</b> leads have never been contacted by the team.{" "}
            {notContacted > 0 && <Link className="text-blue-600 underline" href={listHref({ list: "not_contacted" })}>See them</Link>}
          </li>
          <li>
            Of customers who first booked {GRACE_DAYS}+ days ago, <b>{pct(s.eligibleReturned, s.eligible)}%</b> came back for a second visit (
            {num(s.eligibleReturned)} of {num(s.eligible)}).
          </li>
          <li>
            <b>{num(lapsed.length)}</b> customers didn&apos;t come back or stopped coming. For <b>{num(lapsedNotCalled)}</b> of them, nobody from the team called
            after their last visit - the easiest win.{" "}
            {lapsedNotCalled > 0 && <Link className="text-blue-600 underline" href={listHref({ list: "lapsed", reason: "not_called_since" })}>See them</Link>}
          </li>
          {s.outcomes.payment_failed > 0 && (
            <li>
              <b>{num(s.outcomes.payment_failed)}</b> leads tried to book but the payment failed and they never paid.{" "}
              <Link className="text-blue-600 underline" href={listHref({ list: "payment_failed" })}>See them</Link>
            </li>
          )}
          {filters.campaign.length === 0 && bestBooking && (
            <li>
              Best campaign for getting bookings: <b>{bestBooking.key}</b> - {pct(bestBooking.booked, bestBooking.leads)}% of its {num(bestBooking.leads)} leads
              booked{bestReturn && (
                <>
                  . Best for bringing people back: <b>{bestReturn.key}</b> - {pct(bestReturn.eligibleReturned, bestReturn.eligible)}% came back
                </>
              )}
              . (Campaigns with 20+ leads.)
            </li>
          )}
        </ul>
      </Section>

      {/* ---------- Outcomes ---------- */}
      <Section
        title="What happened to these leads"
        note="Every lead is in exactly one group. Click a group to see the customers."
        download={exportHref({ list: "all" })}
      >
        <StackedBar total={s.leads} parts={OUTCOMES.map((o) => ({ key: o.key, value: s.outcomes[o.key], color: o.color, label: o.short }))} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mt-4">
          {OUTCOMES.map((o) => (
            <Link key={o.key} href={listHref({ list: o.key })} className="flex items-start gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-slate-50 group">
              <span className={"mt-1 w-3 h-3 rounded-sm flex-shrink-0 " + o.color} />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 group-hover:text-blue-700 group-hover:underline">{o.label}</span>
                <span className="block text-xs text-slate-500">{OUTCOME_HELP[o.key]}</span>
              </span>
              <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                {num(s.outcomes[o.key])}
                <span className="text-slate-400 font-normal ml-1.5">{pct(s.outcomes[o.key], s.leads)}%</span>
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* ---------- Journey ---------- */}
      <Section title="Lead journey" note="How many leads reached each step. Some customers book without a call, so a later step isn't always a subset of the one before.">
        <BarList
          color="bg-blue-500"
          base={s.leads}
          items={[
            { label: "Leads", value: s.leads, href: listHref({ list: "all" }) },
            { label: "Registered", value: s.registered, href: listHref({ list: "registered" }) },
            { label: "Contacted by our team", value: s.contacted, href: listHref({ list: "contacted_any" }) },
            { label: "Booked at least once", value: s.booked, href: listHref({ list: "booked" }) },
            { label: "Came back (2+ visits)", value: s.returned, href: listHref({ list: "returned" }) },
            { label: "Regular (3+ visits)", value: s.regular, href: listHref({ list: "regular" }) },
          ]}
        />
      </Section>

      {/* ---------- Campaign comparison ---------- */}
      <Section
        title="Campaign comparison"
        note={`Which campaigns bring leads who register, book and come back. Uses your date, salon and agent filters (not the campaign filter). "Came back" counts customers who first booked ${GRACE_DAYS}+ days ago. Click a campaign to filter the whole page.`}
      >
        <CampaignTable rows={campaigns} selected={filters.campaign} hrefFor={(key) => filterHref({ campaign: onlyThis(filters.campaign, key) })} />
      </Section>

      {/* ---------- Reasons ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section
          title={`Why leads haven't booked (${num(notBooked.length)})`}
          note="The team's latest remark on each lead who never made a paid booking. Each lead counts once."
          download={exportHref({ list: "notbooked" })}
        >
          <BarList
            color="bg-slate-500"
            base={notBooked.length}
            items={whyNotBooked.map((r) => ({ label: r.label, value: r.count, href: listHref({ list: "notbooked", reason: r.key }) }))}
            empty="No leads here."
          />
        </Section>
        <Section
          title={`Why customers didn't come back (${num(lapsed.length)})`}
          note={`Booked once ${GRACE_DAYS}+ days ago and never returned, or came back before and then stopped. Uses the team's latest remark after their last visit. Each customer counts once.`}
          download={exportHref({ list: "lapsed" })}
        >
          <BarList
            color="bg-red-500"
            base={lapsed.length}
            items={whyNotBack.map((r) => ({ label: r.label, value: r.count, href: listHref({ list: "lapsed", reason: r.key }) }))}
            empty="No customers here."
          />
        </Section>
      </div>

      {/* ---------- Temperature ---------- */}
      <Section
        title="Lead temperature by outcome"
        note="The Hot / Warm / Cold the team last set for each lead. A Hot or Warm lead who hasn't booked is the best one to call next. Click a number to see the customers."
      >
        <TemperatureMatrix leads={leads} hrefFor={(outcome, temp) => listHref({ list: outcome, temp })} />
      </Section>

      {/* ---------- Agents ---------- */}
      <Section title="By agent" note="Leads currently owned by each agent. Click an agent to filter the whole page.">
        <AgentTable rows={agents} ownerName={ownerName} hrefFor={(key) => filterHref({ owner: onlyThis(filters.owner, key) })} notContactedHref={(key) => "/admin/insights" + qs({ ...fp, owner: key, list: "not_contacted" }) + "#list"} />
      </Section>

      {/* ---------- Return rates ---------- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title="Do customers come back? By first salon" note={`Of customers whose first paid visit was at this salon (${GRACE_DAYS}+ days ago), how many booked again. Salons with 10+ such customers.`}>
          <RateList items={salons.map((x) => ({ ...x, href: listHref({ list: "booked", rsalon: x.key }) }))} />
        </Section>
        <Section title="Do customers come back? By first coupon" note={`Same, by the coupon used on the first visit (team members' codes vs offer codes vs none). Codes with 15+ customers.`}>
          <RateList items={coupons.map((x) => ({ ...x, href: listHref({ list: "booked", rcoupon: x.key }) }))} />
        </Section>
      </div>

      {/* ---------- Trend ---------- */}
      <Section title="Last 12 weeks" note="Paid orders per week (first visit vs returning customers) and new leads. Follows your campaign, salon and agent filters, but always shows the last 12 weeks.">
        <TrendChart weeks={trend} />
      </Section>

      {/* ---------- Drill-down list ---------- */}
      {list && (
        <div id="list" className="scroll-mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 mt-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {listTitle(list)} <span className="text-slate-400 font-normal">({num(rows.length)})</span>
            </h2>
            <div className="flex gap-2">
              <a href={exportHref(listParams)} download className="px-3 h-8 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
                Download this list (Excel)
              </a>
              <Link href={"/admin/insights" + qs(fp)} className="px-3 h-8 inline-flex items-center rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs font-medium">
                Close
              </Link>
            </div>
          </div>
          <LeadsTable rows={pageRows} />
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
              <div className="flex gap-2">
                <Link
                  href={"/admin/insights" + qs({ ...fp, ...listParams, page: String(Math.max(1, page - 1)) }) + "#list"}
                  className={"px-3 h-9 inline-flex items-center rounded text-sm " + (page === 1 ? "bg-gray-100 text-gray-400 pointer-events-none" : "bg-white border hover:bg-gray-50 text-gray-700")}
                >
                  Previous
                </Link>
                <Link
                  href={"/admin/insights" + qs({ ...fp, ...listParams, page: String(Math.min(totalPages, page + 1)) }) + "#list"}
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

// ---------- helpers ----------

/** Clicking a row picks just that value; clicking it again when it is the only one clears the filter. */
function onlyThis(current: string[], key: string): string[] {
  return current.length === 1 && current[0] === key ? [] : [key];
}

function countOptions(values: string[]) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function describeFilters(f: InsightFilters, ownerName: Map<string, string>) {
  const parts: string[] = [];
  if (f.from && f.to) parts.push(`who joined ${formatDateIN(f.from)} - ${formatDateIN(f.to)}`);
  else if (f.from) parts.push(`who joined on or after ${formatDateIN(f.from)}`);
  else if (f.to) parts.push(`who joined on or before ${formatDateIN(f.to)}`);
  const names = (xs: string[]) => (xs.length <= 3 ? xs.join(", ") : xs.slice(0, 3).join(", ") + ` and ${xs.length - 3} more`);
  if (f.campaign.length) parts.push("from " + names(f.campaign.map((c) => (c === NO_CAMPAIGN ? "no campaign" : `"${c}"`))));
  if (f.salon.length) parts.push("whose first booking was at " + names(f.salon));
  if (f.owner.length) parts.push("owned by " + names(f.owner.map((o) => ownerName.get(o) ?? "unknown agent")));
  return parts.length ? " " + parts.join(", ") : " (all time, all campaigns, salons and agents)";
}

// ---------- building blocks ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, note, download, children }: { title: string; note?: string; download?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          {note && <p className="text-xs text-slate-500 mt-1 max-w-3xl">{note}</p>}
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

function Stat({ label, value, sub, href, tone }: { label: string; value: string; sub?: string; href: string; tone?: "red" | "blue" | "green" }) {
  const color = tone === "red" ? "text-red-600" : tone === "blue" ? "text-blue-700" : tone === "green" ? "text-emerald-600" : "text-gray-900";
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:shadow hover:border-blue-200 transition block">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={"text-2xl font-bold mt-1 " + color}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </Link>
  );
}

function StackedBar({ total, parts }: { total: number; parts: { key: string; value: number; color: string; label: string }[] }) {
  if (total === 0) return <p className="text-sm text-slate-400">No leads match these filters.</p>;
  return (
    <div className="flex h-8 w-full rounded-lg overflow-hidden ring-1 ring-slate-200">
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.key}
            className={p.color + " h-full flex items-center justify-center text-[11px] font-semibold text-white/95 overflow-hidden"}
            style={{ width: (100 * p.value) / total + "%" }}
            title={`${p.label}: ${p.value.toLocaleString("en-IN")} (${pct(p.value, total)}%)`}
          >
            {pct(p.value, total) >= 6 ? pct(p.value, total) + "%" : ""}
          </div>
        ))}
    </div>
  );
}

function BarList({ items, color, base, empty }: { items: { label: string; value: number; href?: string }[]; color: string; base: number; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-400">{empty ?? "No data."}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const body = (
          <div className="group">
            <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
              <span className={"text-gray-800 " + (i.href ? "group-hover:text-blue-700 group-hover:underline" : "")}>{i.label}</span>
              <span className="text-gray-900 font-semibold whitespace-nowrap">
                {num(i.value)}
                <span className="text-slate-400 font-normal ml-1.5">{pct(i.value, base)}%</span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={"h-full rounded-full " + color} style={{ width: Math.max(i.value ? 1 : 0, (100 * i.value) / max) + "%" }} />
            </div>
          </div>
        );
        return i.href ? (
          <Link key={i.label} href={i.href} className="block">{body}</Link>
        ) : (
          <div key={i.label}>{body}</div>
        );
      })}
    </div>
  );
}

function RateBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
      <div className={"h-full rounded-full " + color} style={{ width: Math.max(value ? 2 : 0, value) + "%" }} />
    </div>
  );
}

function CampaignTable({ rows, selected, hrefFor }: { rows: (Summary & { key: string })[]; selected: string[]; hrefFor: (key: string) => string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No leads match these filters.</p>;
  const maxLeads = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[860px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
            <th className="px-2 py-2">Campaign</th>
            <th className="px-2 py-2 w-40">Leads</th>
            <th className="px-2 py-2 text-right">Registered</th>
            <th className="px-2 py-2 text-right">Contacted</th>
            <th className="px-2 py-2 w-44">Booked (% of leads)</th>
            <th className="px-2 py-2 w-44">Came back (% of bookers)</th>
            <th className="px-2 py-2 text-right">Paid orders</th>
            <th className="px-2 py-2 text-right">Revenue</th>
            <th className="px-2 py-2 text-right">Revenue / lead</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const booked = pct(r.booked, r.leads);
            const back = pct(r.eligibleReturned, r.eligible);
            const isSel = selected.includes(r.key);
            return (
              <tr key={r.key} className={isSel ? "bg-blue-50" : "hover:bg-slate-50"}>
                <td className="px-2 py-2.5">
                  <Link href={hrefFor(r.key)} className={"font-medium hover:underline " + (r.key === NO_CAMPAIGN ? "text-slate-500" : "text-blue-700")}>
                    {r.key === NO_CAMPAIGN ? "No campaign" : r.key}
                  </Link>
                  {isSel && <span className="ml-2 text-[11px] text-blue-600">(selected)</span>}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-12 text-right font-semibold text-gray-900">{num(r.leads)}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-400 rounded-full" style={{ width: (100 * r.leads) / maxLeads + "%" }} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right text-gray-700">{num(r.registered)}</td>
                <td className="px-2 py-2.5 text-right text-gray-700">
                  {num(r.contacted)} <span className="text-slate-400">{pct(r.contacted, r.leads)}%</span>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-baseline justify-between text-xs mb-1">
                    <span className="font-semibold text-blue-700">{booked}%</span>
                    <span className="text-slate-400">{num(r.booked)}</span>
                  </div>
                  <RateBar value={booked} color="bg-blue-500" />
                </td>
                <td className="px-2 py-2.5">
                  {r.eligible > 0 ? (
                    <>
                      <div className="flex items-baseline justify-between text-xs mb-1">
                        <span className="font-semibold text-emerald-700">{back}%</span>
                        <span className="text-slate-400">{num(r.eligibleReturned)} of {num(r.eligible)}</span>
                      </div>
                      <RateBar value={back} color="bg-emerald-500" />
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">too early</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right text-gray-700">{num(r.orders)}</td>
                <td className="px-2 py-2.5 text-right text-gray-900 whitespace-nowrap">{rupees(r.revenue)}</td>
                <td className="px-2 py-2.5 text-right text-gray-700 whitespace-nowrap">{rupees(r.leads ? r.revenue / r.leads : 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TemperatureMatrix({ leads, hrefFor }: { leads: LeadFacts[]; hrefFor: (outcome: string, temp: string) => string }) {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const k = l.outcome + "|" + (l.temperature ?? "none");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const max = Math.max(1, ...Array.from(counts.values()));
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[620px]">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
            <th className="px-2 py-2 text-left">Outcome</th>
            {TEMPERATURES.map((t) => (
              <th key={t.key} className="px-2 py-2 text-center">
                <span className="inline-flex items-center gap-1.5">
                  <span className={"w-2.5 h-2.5 rounded-full " + t.color} />
                  {t.label}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {OUTCOMES.map((o) => {
            const total = TEMPERATURES.reduce((sum, t) => sum + (counts.get(o.key + "|" + t.key) ?? 0), 0);
            return (
              <tr key={o.key}>
                <td className="px-2 py-2 text-gray-800">
                  <span className="inline-flex items-center gap-2">
                    <span className={"w-2.5 h-2.5 rounded-sm " + o.color} />
                    {o.label}
                  </span>
                </td>
                {TEMPERATURES.map((t) => {
                  const n = counts.get(o.key + "|" + t.key) ?? 0;
                  const strength = n ? 0.08 + 0.5 * (n / max) : 0;
                  return (
                    <td key={t.key} className="px-1 py-1 text-center">
                      {n ? (
                        <Link
                          href={hrefFor(o.key, t.key)}
                          className="block rounded-md py-1.5 font-semibold text-gray-900 hover:ring-2 hover:ring-blue-300"
                          style={{ backgroundColor: `rgba(59,130,246,${strength})` }}
                        >
                          {num(n)}
                        </Link>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right font-semibold text-gray-900">{num(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AgentTable({
  rows,
  ownerName,
  hrefFor,
  notContactedHref,
}: {
  rows: (Summary & { key: string })[];
  ownerName: Map<string, string>;
  hrefFor: (key: string) => string;
  notContactedHref: (key: string) => string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">No leads match these filters.</p>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[760px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b">
            <th className="px-2 py-2">Agent</th>
            <th className="px-2 py-2 text-right">Leads</th>
            <th className="px-2 py-2 text-right">Not contacted yet</th>
            <th className="px-2 py-2 w-40">Contacted</th>
            <th className="px-2 py-2 w-40">Booked</th>
            <th className="px-2 py-2 w-40">Came back</th>
            <th className="px-2 py-2 text-right">Lost customers</th>
            <th className="px-2 py-2 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-slate-50">
              <td className="px-2 py-2.5">
                <Link href={hrefFor(r.key)} className="font-medium text-blue-700 hover:underline">{ownerName.get(r.key) ?? r.key}</Link>
              </td>
              <td className="px-2 py-2.5 text-right font-semibold text-gray-900">{num(r.leads)}</td>
              <td className="px-2 py-2.5 text-right">
                {r.outcomes.not_contacted > 0 ? (
                  <Link href={notContactedHref(r.key)} className="text-red-600 hover:underline">{num(r.outcomes.not_contacted)}</Link>
                ) : (
                  <span className="text-slate-400">0</span>
                )}
              </td>
              <td className="px-2 py-2.5"><PctCell n={r.contacted} d={r.leads} color="bg-slate-500" /></td>
              <td className="px-2 py-2.5"><PctCell n={r.booked} d={r.leads} color="bg-blue-500" /></td>
              <td className="px-2 py-2.5"><PctCell n={r.eligibleReturned} d={r.eligible} color="bg-emerald-500" /></td>
              <td className="px-2 py-2.5 text-right text-gray-700">{num(r.outcomes.once_gone + r.outcomes.stopped)}</td>
              <td className="px-2 py-2.5 text-right text-gray-900 whitespace-nowrap">{rupees(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PctCell({ n, d, color }: { n: number; d: number; color: string }) {
  if (!d) return <span className="text-xs text-slate-400">-</span>;
  return (
    <>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="font-semibold text-gray-900">{pct(n, d)}%</span>
        <span className="text-slate-400">{num(n)} of {num(d)}</span>
      </div>
      <RateBar value={pct(n, d)} color={color} />
    </>
  );
}

function RateList({ items }: { items: { key: string; customers: number; returned: number; rate: number; href: string }[] }) {
  if (items.length === 0) return <p className="text-sm text-slate-400">Not enough data for these filters.</p>;
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
                <span className="text-slate-400 ml-1.5">{i.returned} of {i.customers}</span>
              </span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={"h-full rounded-full " + color} style={{ width: Math.max(r ? 1 : 0, r) + "%" }} />
            </div>
          </Link>
        );
      })}
      <p className="text-xs text-slate-400 pt-1">Green: 60%+ came back. Amber: 35-59%. Red: below 35%.</p>
    </div>
  );
}

function TrendChart({ weeks }: { weeks: { start: Date; firstTime: number; returning: number; newLeads: number }[] }) {
  const maxOrders = Math.max(1, ...weeks.map((w) => w.firstTime + w.returning));
  const maxLeads = Math.max(1, ...weeks.map((w) => w.newLeads));
  return (
    <div>
      <div className="flex items-end gap-2 h-48 border-b border-slate-200">
        {weeks.map((w) => {
          const total = w.firstTime + w.returning;
          return (
            <div
              key={w.start.toISOString()}
              className="flex-1 h-full flex flex-col justify-end items-center relative"
              title={`Week of ${formatDateIN(w.start)}: ${w.firstTime} first-visit orders, ${w.returning} returning-customer orders, ${w.newLeads} new leads`}
            >
              <span className="text-[11px] text-slate-500 mb-0.5">{total}</span>
              <div className="w-full flex flex-col justify-end" style={{ height: (100 * total) / maxOrders + "%" }}>
                <div className="bg-blue-500 rounded-t" style={{ height: total ? (100 * w.returning) / total + "%" : 0 }} />
                <div className="bg-emerald-400" style={{ height: total ? (100 * w.firstTime) / total + "%" : 0 }} />
              </div>
              <div
                className="absolute left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-violet-500 ring-2 ring-white"
                style={{ bottom: `calc(${(100 * w.newLeads) / maxLeads}% - 4px)` }}
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
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500" /> Orders from returning customers</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-400" /> Orders on a customer&apos;s first visit</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> New leads (own scale, peak {maxLeads})</span>
      </div>
    </div>
  );
}

function LeadsTable({ rows }: { rows: LeadFacts[] }) {
  if (rows.length === 0) return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-600 mb-6">No customers here.</div>;
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr className="text-left text-xs font-medium text-gray-700 uppercase">
            <th className="px-3 py-3">Customer</th>
            <th className="px-3 py-3">Phone</th>
            <th className="px-3 py-3">Campaign</th>
            <th className="px-3 py-3">Agent</th>
            <th className="px-3 py-3">Joined</th>
            <th className="px-3 py-3">What happened</th>
            <th className="px-3 py-3 text-right">Visits</th>
            <th className="px-3 py-3 text-right">Spent</th>
            <th className="px-3 py-3">Last booking</th>
            <th className="px-3 py-3" title="Typical number of days between this customer's visits">Usual gap between visits</th>
            <th className="px-3 py-3">Last salon</th>
            <th className="px-3 py-3">Temp</th>
            <th className="px-3 py-3">Latest remark / reason</th>
            <th className="px-3 py-3">Latest note</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const o = outcomeOf(r.outcome)!;
            return (
              <tr key={r.id} className="hover:bg-gray-50 align-top">
                <td className="px-3 py-3 font-medium text-gray-900">
                  {r.name ?? "(no name)"}
                  {r.city && <div className="text-xs text-slate-400 font-normal">{r.city}</div>}
                </td>
                <td className="px-3 py-3 font-mono text-gray-700 whitespace-nowrap">{r.phone}</td>
                <td className="px-3 py-3 text-gray-600 text-xs">{r.campaign === NO_CAMPAIGN ? "-" : r.campaign}</td>
                <td className="px-3 py-3 text-gray-600">{r.ownerName}</td>
                <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{formatDateIN(r.joinedAt)}</td>
                <td className="px-3 py-3">
                  <span className={"inline-flex items-center gap-1.5 text-xs font-medium " + o.text}>
                    <span className={"w-2 h-2 rounded-full " + o.color} />
                    {o.short}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-gray-900">{r.visits}</td>
                <td className="px-3 py-3 text-right text-gray-900 whitespace-nowrap">{r.revenue ? rupees(r.revenue) : "-"}</td>
                <td className="px-3 py-3 text-gray-700 whitespace-nowrap">
                  {r.lastPaidAt ? (
                    <>
                      {formatDateIN(r.lastPaidAt)}
                      <div className="text-xs text-slate-400">{r.daysSinceLast} days ago</div>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.usualGapDays !== null ? Math.round(r.usualGapDays) + " days" : "-"}</td>
                <td className="px-3 py-3 text-gray-600">{r.lastSalon ?? "-"}</td>
                <td className="px-3 py-3 text-xs text-gray-700">{r.temperature ? TEMPERATURES.find((t) => t.key === r.temperature)?.label : "-"}</td>
                <td className="px-3 py-3 text-xs min-w-[11rem] max-w-[15rem]">
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
                  {r.reason && !r.reason.startsWith("remark:") && <div className="text-red-600 mt-0.5">{reasonLabel(r.reason)}</div>}
                </td>
                <td className="px-3 py-3 min-w-[13rem] max-w-[18rem]">
                  <NoteCell note={r.latestNote} />
                </td>
                <td className="px-3 py-3">
                  <Link href={"/customers/" + r.id} className="text-blue-600 hover:underline text-xs">Open</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NoteCell({ note }: { note: LatestNote | null }) {
  if (!note) return <span className="text-xs text-slate-400">No notes yet</span>;
  return (
    <div className="text-xs">
      <p className="text-gray-800 whitespace-pre-line">&ldquo;{note.text}&rdquo;</p>
      <p className="text-slate-400 mt-1">
        {note.remark ? note.remark + " · " : ""}
        {formatDateIN(note.at)}
        {note.by ? " · " + note.by : ""}
      </p>
    </div>
  );
}
