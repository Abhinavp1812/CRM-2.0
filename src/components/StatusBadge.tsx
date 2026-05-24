import { CustomerType } from "@prisma/client";

export function CustomerTypeBadge({
  type,
  doNotContact,
}: {
  type: CustomerType;
  doNotContact?: boolean;
}) {
  if (doNotContact) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
        DNC
      </span>
    );
  }
  if (type === "CUSTOMER") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
        Booked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200">
      Registered
    </span>
  );
}

export function FollowupStatusBadge({
  status,
}: {
  status: "OVERDUE" | "DUE_TODAY" | "UPCOMING";
}) {
  if (status === "OVERDUE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
        Overdue
      </span>
    );
  }
  if (status === "DUE_TODAY") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        Today
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
      Upcoming
    </span>
  );
}
