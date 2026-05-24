import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPhone, whatsappLink, telLink, getActiveRemarkOptions } from "@/lib/followups";
import { CustomerTypeBadge } from "@/components/StatusBadge";
import TopNav from "@/components/TopNav";
import FollowupEditButton from "@/components/FollowupEditButton";
import LogCallButton from "@/components/LogCallButton";
import UnflagDncButton from "@/components/UnflagDncButton";
import Tabs from "@/components/Tabs";
import ReassignCustomerButton from "@/components/ReassignCustomerButton";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const isAdmin = session.user.role === "ADMIN";

  const [customer, remarkOptions, agents] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, email: true } },
        followup: true,
        bookings: { orderBy: { bookingDate: "desc" }, include: { salon: { select: { name: true, city: true } } } },
        registrations: { orderBy: { onboardingDate: "desc" } },
        activities: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } }, take: 200 },
      },
    }),
    getActiveRemarkOptions(),
    isAdmin
      ? prisma.user.findMany({ where: { role: "AGENT", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  if (!customer) notFound();

  const isOwner = customer.ownerId === session.user.id;
  const canEdit = isOwner || isAdmin;

  function toLocalIso(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const followupIso = customer.followup
    ? toLocalIso(new Date(customer.followup.nextFollowupDate))
    : toLocalIso(new Date());

  const lastBooking = customer.bookings[0];
  const completedBookings = customer.bookings.filter((b) => b.status === "Completed");
  const totalSpend = completedBookings.reduce((sum, b) => sum + (b.grandTotal ? Number(b.grandTotal) : 0), 0);
  const waMessage = "Hi " + (customer.name ?? "") + ", this is from Style Lounge.";

  return (
    <>
      <TopNav />
      <main className="min-h-screen bg-slate-50 py-4 md:py-8">
        <div className="max-w-5xl mx-auto px-4">

          {/* Back link */}
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4">
            ← Back to followups
          </Link>

          {/* DNC banner */}
          {customer.doNotContact && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-red-900">Do Not Contact</p>
                  <p className="text-sm text-red-700 mt-1">{customer.doNotContactReason || "(no reason given)"}</p>
                  <p className="text-xs text-red-500 mt-1">
                    Flagged {customer.doNotContactSetAt ? new Date(customer.doNotContactSetAt).toLocaleDateString("en-IN") : ""}
                  </p>
                </div>
                {isAdmin && <UnflagDncButton customerId={customer.id} />}
              </div>
            </div>
          )}

          {/* Profile card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <h1 className="text-xl md:text-2xl font-bold text-gray-900">{customer.name || "(no name)"}</h1>
                  <CustomerTypeBadge type={customer.customerType} doNotContact={customer.doNotContact} />
                </div>
                <p className="text-sm text-slate-600">
                  <span className="font-mono">{formatPhone(customer.phone)}</span>
                  {customer.city && <span className="ml-2 text-slate-400">· {customer.city}</span>}
                  {customer.gender && <span className="ml-2 text-slate-400">· {customer.gender}</span>}
                </p>
                {customer.address && <p className="text-sm text-slate-500 mt-1">{customer.address}</p>}
                <p className="text-xs text-slate-400 mt-2">
                  Owner: <span className="text-slate-600 font-medium">{customer.owner?.name || "-"}</span>
                  {isAdmin && agents.length > 0 && (
                    <ReassignCustomerButton
                      customerId={customer.id}
                      currentOwnerId={customer.ownerId}
                      agents={agents}
                    />
                  )}
                  {customer.customerIdExt && <span className="ml-3">ID: {customer.customerIdExt}</span>}
                </p>
              </div>

              {!customer.doNotContact && (
                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  <a href={telLink(customer.phone)} className="inline-flex items-center px-3 h-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium transition-colors">
                    Call
                  </a>
                  <a href={whatsappLink(customer.phone, waMessage)} target="_blank" rel="noopener" className="inline-flex items-center px-3 h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm font-medium transition-colors">
                    WhatsApp
                  </a>
                  {canEdit && <LogCallButton customerId={customer.id} />}
                  {canEdit && (
                    <FollowupEditButton
                      customerId={customer.id}
                      customerName={customer.name}
                      currentRemark={customer.followup?.currentRemark || null}
                      currentNote={customer.followup?.currentNote || null}
                      currentFollowupDate={followupIso}
                      remarkOptions={remarkOptions}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Stat label="Next followup" value={customer.followup ? new Date(customer.followup.nextFollowupDate).toLocaleDateString("en-IN") : "—"} />
            <Stat label="Last contact" value={customer.followup?.lastContactedAt ? new Date(customer.followup.lastContactedAt).toLocaleDateString("en-IN") : "Never"} />
            <Stat label="Bookings" value={customer.bookings.length.toString()} />
            <Stat label="Lifetime spend" value={totalSpend > 0 ? "₹" + Math.round(totalSpend).toLocaleString("en-IN") : "—"} />
          </div>

          {/* Current state */}
          {customer.followup && (customer.followup.currentRemark || customer.followup.currentNote) && (
            <div className="mb-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Current state</p>
              {customer.followup.currentRemark && (
                <p className="text-sm"><span className="font-medium text-slate-600">Remark:</span> {customer.followup.currentRemark}</p>
              )}
              {customer.followup.currentNote && (
                <p className="text-sm mt-1"><span className="font-medium text-slate-600">Note:</span> {customer.followup.currentNote}</p>
              )}
            </div>
          )}

          {/* Latest booking */}
          {lastBooking && (
            <div className="mb-4 bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Most recent booking</p>
              <p className="text-sm font-semibold text-gray-900">
                {lastBooking.salon?.name || lastBooking.salonNameSnapshot || "Unknown salon"}
                {lastBooking.bookingDate && <span className="font-normal text-slate-500"> · {new Date(lastBooking.bookingDate).toLocaleDateString("en-IN")}</span>}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Order #{lastBooking.orderNo} · {lastBooking.status || "?"} · {lastBooking.paymentStatus || "?"}
                {lastBooking.grandTotal && <span> · ₹{Math.round(Number(lastBooking.grandTotal)).toLocaleString("en-IN")}</span>}
              </p>
            </div>
          )}

          {/* Tabs: Timeline / Bookings / Registrations */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <Tabs
              tabs={[
                { id: "timeline", label: "Timeline", count: customer.activities.length, content: <Timeline activities={customer.activities} /> },
                { id: "bookings", label: "Bookings", count: customer.bookings.length, content: <BookingsTable bookings={customer.bookings} /> },
                { id: "registrations", label: "Registrations", count: customer.registrations.length, content: <RegistrationsTable registrations={customer.registrations} /> },
              ]}
            />
          </div>

        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 md:p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-1 truncate">{value}</p>
    </div>
  );
}

type Activity = {
  id: string;
  activityType: string;
  remark: string | null;
  note: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  user: { name: string } | null;
};

function activityLabel(a: Activity): string {
  switch (a.activityType) {
    case "REMARK_ADDED": return "Remark: " + (a.remark || "");
    case "NOTE_ADDED": return "Note added";
    case "FOLLOWUP_DATE_CHANGED": {
      const oldD = a.oldValue ? new Date(a.oldValue).toLocaleDateString("en-IN") : "-";
      const newD = a.newValue ? new Date(a.newValue).toLocaleDateString("en-IN") : "-";
      return "Follow-up moved: " + oldD + " → " + newD;
    }
    case "OWNER_CHANGED": return "Owner: " + (a.oldValue || "-") + " → " + (a.newValue || "-");
    case "CUSTOMER_IMPORTED": return "Imported (registration CSV)";
    case "BOOKING_IMPORTED": return "Booking imported";
    case "REGISTRATION_IMPORTED": return "Registration imported";
    case "CUSTOMER_TYPE_CHANGED": return "Type: " + a.oldValue + " → " + a.newValue;
    case "DNC_FLAGGED": return "Flagged Do Not Contact";
    case "DNC_UNFLAGGED": return "DNC flag removed";
    case "CALL_LOGGED": return "Call logged";
    default: return a.activityType;
  }
}

function Timeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) return <p className="text-sm text-slate-400 py-4">No activity yet.</p>;
  return (
    <div className="space-y-3 py-1">
      {activities.map((a) => (
        <div key={a.id} className="flex gap-3">
          <div className="flex-shrink-0 mt-1">
            <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5" />
          </div>
          <div className="min-w-0 pb-3 border-b border-gray-100 last:border-0 w-full">
            <p className="text-sm font-medium text-gray-900">{activityLabel(a)}</p>
            {a.note && <p className="text-sm text-slate-500 mt-0.5">{a.note}</p>}
            <p className="text-xs text-slate-400 mt-1">
              {new Date(a.createdAt).toLocaleString("en-IN")}
              {a.user?.name && <span> · {a.user.name}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

type Booking = {
  id: string;
  orderNo: string | null;
  bookingDate: Date | null;
  status: string | null;
  paymentStatus: string | null;
  grandTotal: unknown;
  salonNameSnapshot: string | null;
  salon: { name: string; city: string | null } | null;
};

function BookingsTable({ bookings }: { bookings: Booking[] }) {
  if (bookings.length === 0) return <p className="text-sm text-slate-400 py-4">No bookings yet.</p>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm min-w-[480px]">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Salon</th>
            <th className="px-3 py-2 text-left">Order</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Payment</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.map((b) => (
            <tr key={b.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-3 py-2 text-slate-600">{b.bookingDate ? new Date(b.bookingDate).toLocaleDateString("en-IN") : "-"}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-gray-900">{b.salon?.name || b.salonNameSnapshot || "-"}</span>
                {b.salon?.city && <span className="text-slate-400 text-xs ml-1">· {b.salon.city}</span>}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{b.orderNo}</td>
              <td className="px-3 py-2 text-slate-600">{b.status || "-"}</td>
              <td className="px-3 py-2 text-slate-600">{b.paymentStatus || "-"}</td>
              <td className="px-3 py-2 text-right font-semibold text-gray-900">
                {b.grandTotal ? "₹" + Math.round(Number(b.grandTotal)).toLocaleString("en-IN") : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Registration = {
  id: string;
  customerIdExt: string | null;
  onboardingDate: Date | null;
  createdAt: Date;
};

function RegistrationsTable({ registrations }: { registrations: Registration[] }) {
  if (registrations.length === 0) return <p className="text-sm text-slate-400 py-4">No registration records.</p>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-semibold">
          <tr>
            <th className="px-3 py-2 text-left">Onboarding date</th>
            <th className="px-3 py-2 text-left">External ID</th>
            <th className="px-3 py-2 text-left">Imported</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {registrations.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-3 py-2 text-slate-600">{r.onboardingDate ? new Date(r.onboardingDate).toLocaleDateString("en-IN") : "-"}</td>
              <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.customerIdExt || "-"}</td>
              <td className="px-3 py-2 text-slate-500">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
