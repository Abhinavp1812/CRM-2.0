import { prisma } from "@/lib/prisma";

/**
 * Admin > Tracker: counts + drill-down lists of registrations and bookings
 * within an admin-picked date range. Registrations are counted by
 * onboardingDate (when the person actually signed up, per the sheet) and
 * bookings by orderDate (when the order was placed) - not bookingDate, which
 * is the appointment date and can land outside the period the order came in.
 * Both are historical-fact counts (every Registration/Booking row ever
 * synced), not filtered by the customer's current DNC or followup state.
 */

export interface TrackerRange {
  /** Inclusive start of day. */
  from: Date;
  /** Exclusive - the instant right after the end day, so pass "day after the last day". */
  to: Date;
}

export interface TrackerCounts {
  registrations: number;
  bookings: number;
}

export async function getTrackerCounts(range: TrackerRange): Promise<TrackerCounts> {
  const [registrations, bookings] = await Promise.all([
    prisma.registration.count({
      where: { onboardingDate: { gte: range.from, lt: range.to }, customer: { deletedAt: null } },
    }),
    prisma.booking.count({
      where: { orderDate: { gte: range.from, lt: range.to }, customer: { deletedAt: null } },
    }),
  ]);
  return { registrations, bookings };
}

export interface TrackerRegistrationRow {
  id: string;
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  onboardingDate: Date | null;
}

export async function getTrackerRegistrations(
  range: TrackerRange,
  page = 1,
  pageSize = 50
): Promise<{ rows: TrackerRegistrationRow[]; total: number }> {
  const where = { onboardingDate: { gte: range.from, lt: range.to }, customer: { deletedAt: null } };
  const [rows, total] = await Promise.all([
    prisma.registration.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, phone: true, city: true, customerType: true, owner: { select: { name: true } } },
        },
      },
      orderBy: { onboardingDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.registration.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      customerId: r.customer.id,
      customerName: r.customer.name,
      phone: r.customer.phone,
      city: r.customer.city,
      ownerName: r.customer.owner?.name || null,
      customerType: r.customer.customerType,
      onboardingDate: r.onboardingDate,
    })),
  };
}

export interface TrackerBookingRow {
  id: string;
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  orderNo: string | null;
  orderDate: Date | null;
  bookingDate: Date | null;
  salonName: string | null;
  status: string | null;
  paymentStatus: string | null;
  grandTotal: string | null;
}

export async function getTrackerBookings(
  range: TrackerRange,
  page = 1,
  pageSize = 50
): Promise<{ rows: TrackerBookingRow[]; total: number }> {
  const where = { orderDate: { gte: range.from, lt: range.to }, customer: { deletedAt: null } };
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, city: true, owner: { select: { name: true } } } },
        salon: { select: { name: true } },
      },
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.booking.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((b) => ({
      id: b.id,
      customerId: b.customer.id,
      customerName: b.customer.name,
      phone: b.customer.phone,
      city: b.customer.city,
      ownerName: b.customer.owner?.name || null,
      orderNo: b.orderNo,
      orderDate: b.orderDate,
      bookingDate: b.bookingDate,
      salonName: b.salon?.name || b.salonNameSnapshot,
      status: b.status,
      paymentStatus: b.paymentStatus,
      grandTotal: b.grandTotal ? b.grandTotal.toString() : null,
    })),
  };
}
