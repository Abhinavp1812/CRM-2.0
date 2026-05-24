import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";

export default async function AgentHelpPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Help — Agent Guide</h1>
        <p className="text-sm text-gray-500 mb-8">Everything you need to use the CRM effectively.</p>

        <HelpSection title="Your Follow-up Dashboard">
          <p>The main screen shows all your customers and when to contact them next. Every row is one customer.</p>
          <HelpTable rows={[
            ["All", "Every customer assigned to you"],
            ["Cold", "Customers who have never booked — your primary target"],
            ["Booked", "Customers who have at least one booking"],
            ["Today", "Customers whose follow-up date is today — contact these first"],
            ["Pipeline", "Customers actively being worked (Interested, Callback, etc.)"],
            ["Action Required", "Customers that need immediate attention"],
            ["Registered", "Customers by type: registered but never booked"],
            ["Booked (type)", "Customers by type: have at least one booking"],
          ]} headers={["Tab", "What it shows"]} />
          <p className="mt-3">The <strong>Status badge</strong> on each row shows urgency: <em>Today</em> means the follow-up is due today, <em>Cold</em> means it is overdue.</p>
        </HelpSection>

        <HelpSection title="Logging a Call">
          <p>After every call, log what happened so the follow-up date updates correctly.</p>
          <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700 mt-2">
            <li>Click <strong>Update</strong> on any row (or open the customer and click <strong>Log Call</strong>)</li>
            <li>Select a <strong>Remark</strong> — what happened on the call</li>
            <li>Add an optional <strong>Note</strong> with extra context</li>
            <li>The next follow-up date is auto-suggested — adjust if needed</li>
            <li>Click Save</li>
          </ol>
          <HelpTable rows={[
            ["Interested", "Customer is interested — follow up in a few days"],
            ["No Answer", "They did not pick up — auto-sets +2 days"],
            ["Call Back", "They asked you to call back later"],
            ["Booked", "Customer made a booking — closes the follow-up"],
            ["Not Interested", "Customer declined — closes the follow-up"],
            ["Invalid Number", "Wrong number — automatically flags as Do Not Contact"],
          ]} headers={["Remark", "What it means"]} />
        </HelpSection>

        <HelpSection title="Customer Detail Page">
          <p>Click <strong>Open</strong> on any row to open the full customer profile. You will find:</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 mt-2">
            <li><strong>Lifetime spend</strong> — total value of all completed bookings</li>
            <li><strong>Timeline</strong> — every call ever logged, with dates and notes</li>
            <li><strong>Bookings tab</strong> — full booking history with amounts and status</li>
            <li><strong>Registrations tab</strong> — registration events from imports</li>
          </ul>
          <p className="mt-2 text-sm text-gray-600">Use the <strong>Call</strong> and <strong>WA</strong> buttons to reach the customer directly without dialing manually.</p>
        </HelpSection>

        <HelpSection title="Self Leave">
          <p>If you are going on leave, mark it in the sidebar under your name.</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 mt-2">
            <li>Set your leave start and end date</li>
            <li>All follow-ups that fall in your leave window automatically shift to your return date</li>
            <li>When you are back, mark yourself as returned so new customers can be assigned to you</li>
          </ul>
        </HelpSection>

        <HelpSection title="My Stats">
          <p>The <strong>My Stats</strong> page shows your personal performance numbers — calls logged, bookings, follow-ups completed, and more. Use it to track your own progress.</p>
        </HelpSection>

        <HelpSection title="Do Not Contact (DNC)">
          <p>Some customers are flagged as Do Not Contact — usually because their number is invalid or they explicitly asked not to be called.</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 mt-2">
            <li>DNC customers are shown with a red banner on their profile</li>
            <li>You cannot log a call or update follow-ups for DNC customers</li>
            <li>Only admins can remove a DNC flag</li>
          </ul>
        </HelpSection>

        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <strong>Need more help?</strong> Contact your admin. They manage team settings, imports, and can reassign customers.
        </div>
      </div>
    </Layout>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-3">{title}</h2>
      <div className="space-y-2 text-sm text-gray-700">{children}</div>
    </div>
  );
}

function HelpTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-gray-200">
          <tr>{headers.map((h) => <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className={"px-3 py-2.5 " + (j === 0 ? "font-semibold text-gray-900" : "text-slate-600")}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
