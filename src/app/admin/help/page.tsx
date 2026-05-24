import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Layout from "@/components/Layout";

export default async function AdminHelpPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/");

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Help — Admin Guide</h1>
        <p className="text-sm text-gray-500 mb-8">Complete reference for managing the CRM, team, and data.</p>

        <HelpSection title="Team Management">
          <p>Go to <strong>Admin → Team</strong> to manage all agents.</p>
          <HelpTable headers={["Action", "How to use it"]} rows={[
            ["Add Agent", "Enter name, email, and a starting password. The agent logs in and can change their password from Profile."],
            ["Mark On Leave", "Set leave dates. Follow-ups in the leave window automatically shift to the agent's return date."],
            ["Bring Back", "Clears leave status so the agent receives new customers again."],
            ["Reassign Customers", "Move all customers from one agent to another or distribute via round-robin."],
            ["Balance Team", "Redistributes all customers evenly across every active agent. Supports preview before applying and untouched-first mode."],
            ["Remove Agent", "Must reassign customers first. Supports warm/cold split — send contacted customers to a specific agent, cold leads to round-robin."],
            ["Edit", "Update agent name, email, or password."],
          ]} />
          <p className="mt-3 font-medium text-amber-700">Important: Agent names in the CRM must exactly match the Owner column in your CSV files (case-insensitive) for auto-assignment to work during imports.</p>
        </HelpSection>

        <HelpSection title="Importing Data">
          <p>Go to <strong>Imports</strong> in the sidebar. Two import types are supported:</p>
          <HelpTable headers={["Import type", "What it does"]} rows={[
            ["Registrations", "Adds new customers or updates existing ones. Existing customers keep their current agent (sticky ownership)."],
            ["Bookings", "Adds booking records. New customers are created automatically. Upgrades NEW_REGISTRATION → CUSTOMER type."],
          ]} />
          <p className="mt-3"><strong>Owner column in CSV:</strong> If the name matches an existing agent, that agent gets the customer. If not, the customer is parked temporarily with the owner name saved. When you later create an agent with that exact name, all their customers are automatically assigned.</p>
          <p className="mt-2"><strong>Errors after import:</strong> Shown in an inline table — filter by name, phone, or reason. Download as XLSX if needed.</p>
          <p className="mt-2"><strong>Follow-up days:</strong> The number of days added to the booking date to set the follow-up can be configured directly on the Import Bookings page (default: 20 days).</p>
        </HelpSection>

        <HelpSection title="Reassignment Tools">
          <HelpTable headers={["Tool", "When to use it"]} rows={[
            ["Individual Reassign", "Open any customer's detail page → click Reassign next to the owner name."],
            ["Reassign Customers (team page)", "Move all customers from one agent to another."],
            ["Balance Team", "Redistribute everyone evenly. Preview shows before/after counts. Untouched-first mode takes never-contacted customers first."],
            ["Reassign Neglected", "Find customers not contacted in N days and redistribute them to active agents."],
            ["Warm/Cold split (on remove)", "When removing an agent: contacted customers go to a chosen agent, never-contacted go to round-robin."],
            ["Reassignment Log", "Full history of every owner change — who moved, from whom, to whom, when."],
          ]} />
        </HelpSection>

        <HelpSection title="Follow-up Filters Explained">
          <HelpTable headers={["Filter", "Definition"]} rows={[
            ["Cold", "Customers who have never booked (NEW_REGISTRATION type) and are not yet contacted"],
            ["Booked", "Customers with at least one booking"],
            ["Today", "Follow-up date is today"],
            ["Pipeline", "Customers with an active remark like Interested or Callback"],
            ["Action Required", "Customers requiring urgent follow-up"],
            ["Registered", "Filtered by customer type: NEW_REGISTRATION"],
            ["Booked (type)", "Filtered by customer type: CUSTOMER"],
            ["Closed", "Completed/closed follow-ups — accessible from Admin → Closed"],
          ]} />
        </HelpSection>

        <HelpSection title="Do Not Contact (DNC)">
          <p>Customers can be flagged as Do Not Contact in two ways:</p>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>An agent logs a call with remark <em>Invalid Number</em> — automatic DNC</li>
            <li>Any remark configured with <em>autoFlagDnc</em> triggers it</li>
          </ul>
          <p className="mt-2">As admin, you can remove the DNC flag from the customer detail page using the <strong>Remove DNC</strong> button.</p>
        </HelpSection>

        <HelpSection title="Danger Zone">
          <p className="text-red-700 font-medium">All actions here are permanent and require the super admin password.</p>
          <HelpTable headers={["Action", "What gets deleted"]} rows={[
            ["Wipe Registrations", "All registration records. Customers and follow-ups are kept."],
            ["Wipe Bookings", "All booking records. Customers and follow-ups are kept."],
            ["Wipe Registrations + Bookings", "Both registration and booking records."],
            ["Wipe All Customers", "Every customer and all associated data — follow-ups, activity logs, registrations, bookings. Full reset."],
          ]} />
        </HelpSection>

        <HelpSection title="Export">
          <p>Use the <strong>Export All Data</strong> button on the Admin page to download a full XLSX snapshot of the CRM. The file contains four sheets:</p>
          <ul className="list-disc list-inside space-y-1 mt-2 text-sm text-gray-700">
            <li><strong>Customers</strong> — all customers with owner, type, city, DNC status</li>
            <li><strong>Followups</strong> — current follow-up state per customer</li>
            <li><strong>Registrations</strong> — all registration records</li>
            <li><strong>Bookings</strong> — all bookings with amounts, salon, and status</li>
          </ul>
        </HelpSection>

        <HelpSection title="Super Admin">
          <p>The super admin account is defined in the server environment file (<code>.env</code>) and never stored in the database. Use it only as an emergency backup if the regular admin account is inaccessible.</p>
          <p className="mt-2">The super admin can log in, manage the system, and perform all admin actions — but cannot change the Danger Zone (it uses the same super admin password as confirmation).</p>
        </HelpSection>
      </div>
    </Layout>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
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
