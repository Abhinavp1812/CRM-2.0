import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import SegmentBadge from "@/components/SegmentBadge";
import WhatsAppTabs from "@/components/WhatsAppTabs";
import WhatsAppBatchControls from "@/components/WhatsAppBatchControls";
import CopyPhonesButton from "@/components/CopyPhonesButton";
import {
  getNudgeSettings,
  buildAudience,
  planBatch,
  roundProgress,
  loadBatchHistory,
  loadBatchRows,
  BATCH_SECTIONS,
  ROTATION,
  GROUPS,
  type GroupKey,
} from "@/lib/whatsappNudges";
import type { LeadFacts } from "@/lib/insights";
import { formatDateIN, formatDateTimeIN, istDayRange, todayIsoIST } from "@/lib/formatDate";
import { oneParam, type SearchParamsRecord } from "@/lib/params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const label = (g: GroupKey) => GROUPS.find((x) => x.key === g)!.label;
const when = (d: Date) => formatDateTimeIN(d, { dateStyle: "medium", timeStyle: "short" });

export default async function NudgesForTodayPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");
  const sp = await searchParams;

  const settings = await getNudgeSettings();
  const [{ groups }, history] = await Promise.all([
    buildAudience(settings),
    loadBatchHistory(30).then(
      (h) => ({ ok: true as const, h }),
      () => ({ ok: false as const, h: [] as { at: Date; count: number }[] })
    ),
  ]);

  const atParam = oneParam(sp.at);
  const latest = history.h[0] ?? null;
  const selected = (atParam && history.h.find((b) => b.at.toISOString() === atParam)) || latest;
  const rows = selected ? await loadBatchRows(selected.at) : [];
  const isLatest = !!selected && selected === latest;

  // Facts (visits, last booking...) for each customer, from today's lists.
  const facts = new Map<string, LeadFacts>();
  for (const g of BATCH_SECTIONS) for (const r of groups[g]) facts.set(r.lead.id, r.lead);

  const plan = planBatch(groups, settings.perRunLimit, settings.batchRotationIndex);
  const next = [
    { label: label("last25"), count: plan.sections.last25.length, newRound: false },
    ...(plan.category ? [{ label: label(plan.category), count: plan.sections[plan.category].length, newRound: plan.newRounds.includes(plan.category) }] : []),
  ];
  const nextCategory = plan.category;
  const afterThat = nextCategory ? ROTATION[(ROTATION.indexOf(nextCategory) + 1) % ROTATION.length] : null;
  // Sections to show: the 25-days list always, plus whichever list(s) the batch used.
  const sectionsShown = BATCH_SECTIONS.filter((g) => g === "last25" || rows.some((r) => r.group === g));
  const latestIsToday = !!latest && latest.at >= istDayRange(todayIsoIST()).start;
  const exportHref = (group?: GroupKey) =>
    "/api/admin/whatsapp/today/export?" + new URLSearchParams({ ...(selected ? { at: selected.at.toISOString() } : {}), ...(group ? { group } : {}) }).toString();

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Nudges</h1>
          <WhatsAppTabs active="today" />
        </div>
        {selected && (
          <a href={exportHref()} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            Download this batch (Excel)
          </a>
        )}
      </div>

      <p className="text-sm text-slate-500 mb-4">
        Works like the WA Toolbox &ldquo;Nudges for Today&rdquo;. Each click picks <b>everyone whose last booking was 25 days ago</b> plus{" "}
        <b>{settings.perRunLimit} customers from ONE list</b>, taking turns: {ROTATION.map(label).join(" → ")} → back to {label(ROTATION[0])}. Then you send
        them from the <b>Anantya platform</b> (download the Excel or copy the numbers). Nothing is sent from here. Every customer picked is recorded in the
        Nudge log, so when a list&apos;s turn comes again you get its <b>next {settings.perRunLimit}</b>. Nobody repeats until the whole list has had a turn,
        then that list starts again from the top (a new round). Do-not-nudge customers and excluded salons are never picked, and nobody is picked twice within{" "}
        {settings.cooldownDays} days.
      </p>

      {!history.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          The WhatsApp tables aren&apos;t in the database yet - open <Link href="/admin/whatsapp" className="underline">Settings &amp; sending</Link> and click
          &ldquo;Create WhatsApp tables now&rdquo;.
        </div>
      ) : (
        <>
          <WhatsAppBatchControls
            latestAt={latest ? latest.at.toISOString() : null}
            latestIsToday={latestIsToday}
            next={next}
            note={
              nextCategory
                ? `This click's list: ${label(nextCategory)}${afterThat && afterThat !== nextCategory ? ` · the click after: ${label(afterThat)}` : ""}`
                : "Every list is in the cooldown right now - only the 25-days list can be picked."
            }
          />

          {history.h.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
              <span className="text-slate-500">Batches:</span>
              {history.h.slice(0, 12).map((b) => {
                const active = selected && b.at.getTime() === selected.at.getTime();
                return (
                  <Link
                    key={b.at.toISOString()}
                    href={"/admin/whatsapp/today?at=" + encodeURIComponent(b.at.toISOString())}
                    className={"px-2.5 py-1 rounded-full border " + (active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")}
                  >
                    {when(b.at)} ({b.count})
                  </Link>
                );
              })}
              <Link href="/admin/whatsapp/log?kind=real" className="text-blue-600 hover:underline ml-1">Full history in Nudge log →</Link>
            </div>
          )}

          {!selected ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-slate-500">
              No batch yet - click <b>Generate nudges for today</b> to get today&apos;s list.
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">
                Batch of {when(selected.at)} <span className="text-slate-400 font-normal">({rows.length.toLocaleString("en-IN")} customers)</span>
                {!isLatest && <span className="ml-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">older batch</span>}
              </h2>
              <p className="text-xs text-slate-500 mb-3">Send each list its own template from Anantya. Numbers are 10 digits; the Excel also has them with 91 in front.</p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {sectionsShown.map((g) => {
                  const list = rows
                    .filter((r) => r.group === g)
                    .sort((a, b) => (a.customer?.name ?? "").localeCompare(b.customer?.name ?? ""));
                  const prog = g === "last25" ? null : roundProgress(groups[g], settings.rounds[g], settings.perRunLimit);
                  return (
                    <section key={g} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">
                            {label(g)} <span className="text-slate-400 font-normal">({list.length})</span>
                          </h3>
                          <p className="text-[11px] text-slate-500">
                            {prog
                              ? `Now: round ${prog.round} · ${prog.covered.toLocaleString("en-IN")} of ${prog.total.toLocaleString("en-IN")} covered · ${prog.remaining.toLocaleString("en-IN")} still to go`
                              : "Everyone due today (last paid visit 25 days ago)"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <CopyPhonesButton phones={list.map((r) => r.phone)} />
                          <a href={exportHref(g)} download className="px-3 h-8 inline-flex items-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
                            Excel
                          </a>
                        </div>
                      </div>
                      <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-white sticky top-0 border-b">
                            <tr className="text-left text-[11px] font-medium text-gray-500 uppercase">
                              <th className="px-3 py-2 w-8">#</th>
                              <th className="px-3 py-2">Name</th>
                              <th className="px-3 py-2">Phone</th>
                              <th className="px-3 py-2">Category</th>
                              <th className="px-3 py-2">Last booking</th>
                              <th className="px-3 py-2">Last salon</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {list.map((r, i) => {
                              const f = r.customerId ? facts.get(r.customerId) : undefined;
                              return (
                                <tr key={r.id} className="hover:bg-gray-50">
                                  <td className="px-3 py-1.5 text-xs text-slate-400">{i + 1}</td>
                                  <td className="px-3 py-1.5">
                                    {r.customer ? (
                                      <Link href={"/customers/" + r.customer.id} className="text-blue-700 hover:underline">{r.customer.name ?? "(no name)"}</Link>
                                    ) : (
                                      <span className="text-slate-400">(deleted)</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono text-gray-700">{r.phone}</td>
                                  <td className="px-3 py-1.5">{f ? <SegmentBadge visits={f.visits} /> : <span className="text-slate-300">-</span>}</td>
                                  <td className="px-3 py-1.5 text-xs text-gray-600 whitespace-nowrap">{f?.lastPaidAt ? formatDateIN(f.lastPaidAt) : "-"}</td>
                                  <td className="px-3 py-1.5 text-xs text-gray-600">{f?.lastSalon ?? "-"}</td>
                                </tr>
                              );
                            })}
                            {list.length === 0 && (
                              <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">Nobody from this list in this batch.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </Layout>
  );
}
