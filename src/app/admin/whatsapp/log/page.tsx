import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Layout from "@/components/Layout";
import MultiSelect from "@/components/MultiSelect";
import WhatsAppTabs from "@/components/WhatsAppTabs";
import { parseLogParams, loadLog, groupLabel } from "@/lib/whatsappLog";
import { GROUPS } from "@/lib/whatsappNudges";
import { formatDateIN, formatTimeIN, todayIsoIST } from "@/lib/formatDate";
import { buildQuery, oneParam, type SearchParamsRecord } from "@/lib/params";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const DAY = 86_400_000;

export default async function NudgeLogPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  const sp = await searchParams;
  const p = parseLogParams(sp);
  const page = Math.max(1, parseInt(oneParam(sp.page) || "1", 10) || 1);

  let data: Awaited<ReturnType<typeof loadLog>> | null = null;
  let dbError: string | null = null;
  try {
    data = await loadLog(p, page, PAGE_SIZE);
  } catch (e) {
    dbError = e instanceof Error ? e.message : "Database error";
  }

  const base = { from: p.from, to: p.to, group: p.groups, status: p.status ?? undefined, kind: p.kind === "real" ? undefined : p.kind, q: p.q || undefined };
  const href = (patch: Record<string, string | string[] | undefined>) => "/admin/whatsapp/log" + buildQuery({ ...base, ...patch });
  const exportHref = "/api/admin/whatsapp/log/export" + buildQuery(base);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const today = todayIsoIST();
  const daysAgo = (n: number) => new Date(Date.parse(today) - n * DAY).toISOString().slice(0, 10);

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp Nudges</h1>
          <WhatsAppTabs active="log" />
        </div>
        <a href={exportHref} download className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          Download log (Excel)
        </a>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Every WhatsApp nudge the CRM sent (or tried to), batch by batch - who got which list&apos;s message, when, and whether Anantya accepted it. Test messages
        are hidden unless you choose them.
      </p>

      <form method="GET" action="/admin/whatsapp/log" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3 items-end">
          <Field label="From">
            <input type="date" name="from" defaultValue={p.from} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={p.to} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <Field label="List">
            <MultiSelect name="group" allLabel="All lists" selected={p.groups} options={GROUPS.map((g) => ({ value: g.key, label: g.label }))} />
          </Field>
          <Field label="Result">
            <select name="status" defaultValue={p.status ?? ""} className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="">Sent & failed</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
            </select>
          </Field>
          <Field label="Messages">
            <select name="kind" defaultValue={p.kind} className="w-full border rounded-lg px-2 py-1.5 text-sm">
              <option value="real">Real customers</option>
              <option value="test">Test messages</option>
              <option value="all">Both</option>
            </select>
          </Field>
          <Field label="Customer / phone">
            <input name="q" defaultValue={p.q} placeholder="Search" className="w-full border rounded-lg px-2 py-1.5 text-sm" />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Apply</button>
            <Link href="/admin/whatsapp/log" className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">Reset</Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
          <span className="text-slate-500">Quick dates:</span>
          {[
            { label: "Today", from: today, to: today },
            { label: "Yesterday", from: daysAgo(1), to: daysAgo(1) },
            { label: "Last 7 days", from: daysAgo(6), to: today },
            { label: "Last 30 days", from: daysAgo(29), to: today },
          ].map((r) => (
            <Link
              key={r.label}
              href={href({ from: r.from, to: r.to, page: undefined })}
              className={"px-2.5 py-1 rounded-full border " + (p.from === r.from && p.to === r.to ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-gray-200 hover:bg-slate-50")}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </form>

      {dbError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          The WhatsApp tables aren&apos;t in the database yet - open <Link href="/admin/whatsapp" className="underline">Settings &amp; sending</Link> and click
          &ldquo;Create WhatsApp tables now&rdquo;.
        </div>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Stat label="Messages" value={data.total} />
              <Stat label="Sent" value={data.sent} tone="good" />
              <Stat label="Failed" value={data.failed} tone="bad" />
              <Stat label="Different customers" value={data.customers} />
            </div>
            {data.byGroup.length > 0 && (
              <p className="text-xs text-slate-500 mb-3">By list: {data.byGroup.map((g) => `${g.label} ${g.count.toLocaleString("en-IN")}`).join(" · ")}</p>
            )}
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-left text-xs font-medium text-gray-700 uppercase">
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">List</th>
                    <th className="px-3 py-3">Customer</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3">Template</th>
                    <th className="px-3 py-3">How</th>
                    <th className="px-3 py-3">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.rows.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDateIN(m.createdAt)}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatTimeIN(m.createdAt, { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{groupLabel(m.group)}</td>
                      <td className="px-3 py-2">
                        {m.customer ? (
                          <Link href={"/customers/" + m.customer.id} className="text-blue-700 hover:underline">{m.customer.name ?? "(no name)"}</Link>
                        ) : (
                          <span className="text-slate-400">{m.isTest ? "test" : "-"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">{m.phone}</td>
                      <td className="px-3 py-2 text-xs text-gray-700">{m.templateName ?? "#" + m.templateId}</td>
                      <td className="px-3 py-2 text-xs">
                        {m.isTest && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 mr-1">TEST</span>}
                        {m.trigger === "automatic" ? "Automatic" : "Manual"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {m.status === "SENT" ? (
                          <span className="text-emerald-700 font-medium">Sent</span>
                        ) : (
                          <span className="text-red-600" title={m.error ?? ""}>Failed{m.error ? ": " + m.error.slice(0, 80) : ""}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">No messages for these filters.</td>
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
          </>
        )
      )}
    </Layout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={"text-2xl font-bold mt-0.5 " + (tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : "text-gray-900")}>{value.toLocaleString("en-IN")}</p>
    </div>
  );
}
