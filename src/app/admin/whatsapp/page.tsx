import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import WhatsAppNudgesPanel, { type PanelGroup } from "@/components/WhatsAppNudgesPanel";
import SegmentBadge from "@/components/SegmentBadge";
import WhatsAppSetupDbButton from "@/components/WhatsAppSetupDbButton";
import WhatsAppTabs from "@/components/WhatsAppTabs";
import { prisma } from "@/lib/prisma";
import { isAnantyaConfigured, getTemplates, type AnantyaTemplate } from "@/lib/anantya";
import {
  getNudgeSettings,
  buildAudience,
  nextRotationGroup,
  roundProgress,
  GROUPS,
  EXCLUSIONS,
  VARIABLE_SOURCES,
  isGroupKey,
  type AudienceRow,
  type GroupKey,
} from "@/lib/whatsappNudges";
import { formatDateIN, formatDateTimeIN } from "@/lib/formatDate";
import { statusText, triggerText } from "@/lib/whatsappStatus";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 50;

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ group?: string; show?: string; page?: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");
  const params = await searchParams;

  const configured = isAnantyaConfigured();
  const settings = await getNudgeSettings();

  let templates: AnantyaTemplate[] = [];
  let templatesError: string | null = null;
  if (configured) {
    try {
      templates = await getTemplates();
    } catch (e) {
      templatesError = e instanceof Error ? e.message : "Unknown error";
    }
  }

  // The lists work from customer data alone; the two WhatsApp tables (message
  // log, opt-outs) come from a database update that runs on deploy. If they're
  // missing, everything else still shows and a banner explains.
  const [a, recentResult] = await Promise.all([
    buildAudience(settings),
    loadRecent().then(
      (rows) => ({ rows, error: null as string | null }),
      (e: unknown) => ({ rows: [] as Awaited<ReturnType<typeof loadRecent>>, error: e instanceof Error ? e.message : "Database error" })
    ),
  ]);
  const recent = recentResult.rows;
  const dbError = recentResult.error;
  const audience: Record<GroupKey, AudienceRow[]> = a.groups;
  const blockedCount = a.blocked;
  const salonOptions = Array.from(new Set([...settings.excludeSalons, ...a.salonOptions]));
  const next = nextRotationGroup(settings);
  const nextAutomatic = next ? GROUPS.find((g) => g.key === next.group)!.label : null;

  const panelGroups: PanelGroup[] = GROUPS.map((g) => {
    const rows = audience?.[g.key] ?? [];
    const eligible = rows.filter((r) => !r.excluded);
    const counts = new Map<string, number>();
    for (const r of rows) if (r.excluded) counts.set(EXCLUSIONS[r.excluded], (counts.get(EXCLUSIONS[r.excluded]) ?? 0) + 1);
    const sample = eligible[0]?.lead;
    return {
      key: g.key,
      label: g.label,
      help: g.help,
      total: rows.length,
      eligible: eligible.length,
      excluded: Array.from(counts, ([label, count]) => ({ label, count })),
      round: roundProgress(rows, settings.rounds[g.key], settings.perRunLimit),
      sample: sample ? { name: sample.name ?? "(no name)", values: Object.fromEntries(VARIABLE_SOURCES.map((v) => [v.key, v.sample(sample)])) } : null,
    };
  });

  // Preview list for one group.
  const group: GroupKey | null = isGroupKey(params.group) ? params.group : null;
  const show = params.show === "excluded" ? "excluded" : "eligible";
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const previewAll = group && audience ? audience[group].filter((r) => (show === "excluded" ? r.excluded : !r.excluded)) : [];
  const previewRows = previewAll.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(previewAll.length / PAGE_SIZE));
  const nextBatchSize = group && audience && show === "eligible" ? roundProgress(audience[group], settings.rounds[group], settings.perRunLimit).nextBatch : 0;
  const previewHref = (patch: { show?: string; page?: number }) =>
    `/admin/whatsapp?group=${group}&show=${patch.show ?? show}${patch.page && patch.page > 1 ? `&page=${patch.page}` : ""}#preview`;

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Nudges</h1>
        <WhatsAppTabs active="settings" />
        <p className="text-sm text-slate-500 mt-1">
          Automatic WhatsApp reminders through Anantya.ai, with a different approved template for each type of customer. Customers marked Not Interested,
          Do Not Contact, Invalid Number or opted out never get them, and nobody gets more than one nudge per cooldown period.
        </p>
      </div>

      {/* Setup status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Status ok={configured} title="Anantya API key" okText="Connected" badText="Missing - add ANANTYA_API_KEY" />
        <Status ok={configured && !templatesError} title="Templates" okText={`${templates.length} found in Anantya`} badText={configured ? "Couldn't load" : "Needs the API key"} />
        <Status ok={!dbError} title="Database" okText="Ready" badText="Update needed (see below)" />
      </div>

      {dbError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 mb-5">
          <b>The WhatsApp tables aren&apos;t in the database yet.</b> Until they are, you can set things up but sending is blocked (nothing may go out
          without being logged).
          <div>
            <WhatsAppSetupDbButton />
          </div>
          <div className="text-xs text-red-600 mt-2 break-all">{String(dbError).slice(0, 300)}</div>
        </div>
      )}

      <WhatsAppNudgesPanel
        initial={settings}
        templates={templates}
        templatesError={templatesError}
        groups={panelGroups}
        configured={configured}
        salonOptions={salonOptions}
        nextAutomatic={nextAutomatic}
        blockedCount={blockedCount}
      />

      {/* Preview list */}
      {group && audience && (
        <div id="preview" className="scroll-mt-4 mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-gray-900">
              {GROUPS.find((g) => g.key === group)!.label}{" "}
              <span className="text-slate-400 font-normal">({previewAll.length.toLocaleString("en-IN")} {show === "excluded" ? "excluded" : "can be nudged"})</span>
            </h2>
            <div className="flex gap-2 text-sm">
              <Link href={previewHref({ show: "eligible" })} className={"px-3 py-1 rounded-full border " + (show === "eligible" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600")}>
                Can be nudged
              </Link>
              <Link href={previewHref({ show: "excluded" })} className={"px-3 py-1 rounded-full border " + (show === "excluded" ? "bg-rose-600 text-white border-rose-600" : "bg-white text-slate-600")}>
                Excluded
              </Link>
              <Link href="/admin/whatsapp" className="px-3 py-1 rounded-full border bg-white text-slate-600">Close</Link>
            </div>
          </div>
          {show === "eligible" && (
            <p className="text-xs text-slate-500 mb-2">
              {settings.testMode
                ? "Test mode is on: a send goes only to the test number, using the first customer's details."
                : `This is the queue for round ${settings.rounds[group].number}: the next send goes to the ${nextBatchSize} highlighted customers (not yet nudged this round, never-nudged first). Nobody gets a second nudge until everyone here has had one.`}
            </p>
          )}
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                  {show === "eligible" && <th className="px-3 py-3">Queue</th>}
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Phone</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Owner</th>
                  <th className="px-3 py-3">Last booking</th>
                  <th className="px-3 py-3">Latest remark</th>
                  <th className="px-3 py-3">Last nudged</th>
                  {show === "excluded" && <th className="px-3 py-3">Why excluded</th>}
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewRows.map(({ lead: l, excluded, covered, lastNudgedAt }, i) => {
                  const pos = (page - 1) * PAGE_SIZE + i + 1;
                  const upNext = show === "eligible" && pos <= nextBatchSize;
                  return (
                  <tr key={l.id} className={upNext ? "bg-emerald-50/70" : "hover:bg-gray-50"}>
                    {show === "eligible" && (
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        <span className="font-mono text-slate-500">#{pos}</span>{" "}
                        {upNext ? (
                          <span className="text-emerald-700 font-semibold">next batch</span>
                        ) : covered ? (
                          <span className="text-slate-400">done this round</span>
                        ) : (
                          <span className="text-slate-500">waiting</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-medium text-gray-900">{l.name ?? "(no name)"}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-700">{l.phone}</td>
                    <td className="px-3 py-2.5"><SegmentBadge visits={l.visits} /></td>
                    <td className="px-3 py-2.5 text-gray-600">{l.ownerName}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{l.lastPaidAt ? formatDateIN(l.lastPaidAt) : "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-700">{l.latestRemark?.label ?? "-"}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{lastNudgedAt ? formatDateIN(lastNudgedAt) : "never"}</td>
                    {show === "excluded" && <td className="px-3 py-2.5 text-xs text-rose-700">{excluded ? EXCLUSIONS[excluded] : ""}</td>}
                    <td className="px-3 py-2.5">
                      <Link href={"/customers/" + l.id} className="text-blue-600 hover:underline text-xs">Open</Link>
                    </td>
                  </tr>
                  );
                })}
                {previewRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-slate-500">Nobody here.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-gray-600">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Link href={previewHref({ page: Math.max(1, page - 1) })} className={"px-3 h-8 inline-flex items-center rounded border " + (page === 1 ? "pointer-events-none text-gray-300" : "bg-white")}>Previous</Link>
                <Link href={previewHref({ page: Math.min(totalPages, page + 1) })} className={"px-3 h-8 inline-flex items-center rounded border " + (page === totalPages ? "pointer-events-none text-gray-300" : "bg-white")}>Next</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Message log */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Recent messages</h2>
        <p className="text-xs text-slate-500 mb-3">
          Only messages the CRM itself sent through Anantya (customers picked in &ldquo;Nudges for today&rdquo; are not shown here - nothing is sent for
          them). &ldquo;Sent&rdquo; means Anantya accepted the message. Delivery and read status are shown in Anantya&apos;s own dashboard.
        </p>
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                <th className="px-3 py-3">When</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Sent to</th>
                <th className="px-3 py-3">Group</th>
                <th className="px-3 py-3">Template</th>
                <th className="px-3 py-3">How</th>
                <th className="px-3 py-3">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateTimeIN(m.createdAt, { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-3 py-2">
                    {m.customer ? (
                      <Link href={"/customers/" + m.customer.id} className="text-blue-700 hover:underline">{m.customer.name ?? "(no name)"}</Link>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-700">{m.phone}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{GROUPS.find((g) => g.key === m.group)?.label ?? m.group}</td>
                  <td className="px-3 py-2 text-gray-700 text-xs">{m.templateName ?? (m.templateId ? "#" + m.templateId : "-")}</td>
                  <td className="px-3 py-2 text-xs">
                    {m.isTest && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mr-1">TEST</span>}
                    {triggerText(m.trigger)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {m.status === "SENT" ? <span className="text-emerald-700 font-medium">Sent</span> : m.status === "LISTED" ? <span className="text-blue-700">{statusText(m.status)}</span> : <span className="text-red-600" title={m.error ?? ""}>Failed{m.error ? ": " + m.error.slice(0, 80) : ""}</span>}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-500">No messages sent yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

function loadRecent() {
  // Only messages the CRM really sent (or tried to). "Nudges for today" lists are
  // not messages - they're on their own tab and in the Nudge log.
  return prisma.whatsAppMessage.findMany({
    where: { status: { not: "LISTED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { customer: { select: { id: true, name: true } } },
  });
}

function Status({ ok, title, okText, badText }: { ok: boolean; title: string; okText: string; badText: string }) {
  return (
    <div className={"rounded-xl border p-3 " + (ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className={"text-sm font-semibold mt-0.5 " + (ok ? "text-emerald-700" : "text-amber-800")}>{ok ? "✓ " + okText : badText}</p>
    </div>
  );
}
