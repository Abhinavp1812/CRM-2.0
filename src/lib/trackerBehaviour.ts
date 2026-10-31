import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TrackerRange } from "@/lib/tracker";

/**
 * Admin > Tracker, "customer behaviour": repeat bookings, new bookers,
 * registered-but-never-booked, and booked-once-never-again.
 *
 * Unlike the plain registration/booking counts, these are about whether a
 * customer actually bought, so they only count PAID bookings - the same rule
 * Team Stats uses for "Paid Bookings". Roughly a quarter of all orders are
 * failed / pending / refunded payments, and counting those would make someone
 * whose card was declined look like a "new booker" or a repeat customer.
 *
 * A booking's date is its orderDate (when it was placed), matching the plain
 * counts. "First" and "repeat" are decided per customer across ALL of their
 * paid bookings in order, not just the ones that fall inside the window.
 */

const PAID_BOOKING = Prisma.sql`b."paymentStatus" IN ('Success', 'Partially Paid') AND COALESCE(b."status", '') <> 'Cancelled'`;

/** Every paid booking, numbered per customer in the order placed (n = 1 is their first). */
const NUMBERED_PAID_BOOKINGS = Prisma.sql`
  numbered AS (
    SELECT b.id, b."customerId", b."orderNo", b."orderDate", b."bookingDate", b."status",
           b."salonId", b."salonNameSnapshot", b."grandTotal"::text AS "grandTotal",
           COALESCE(b."orderDate", b."bookingDate") AS d,
           ROW_NUMBER() OVER (
             PARTITION BY b."customerId"
             ORDER BY COALESCE(b."orderDate", b."bookingDate"), b."createdAt", b.id
           ) AS n
    FROM "Booking" b
    JOIN "Customer" c ON c.id = b."customerId"
    WHERE c."deletedAt" IS NULL AND ${PAID_BOOKING} AND COALESCE(b."orderDate", b."bookingDate") IS NOT NULL
  )`;

export interface BehaviourCounts {
  repeatBookings: number;
  repeatCustomers: number;
  newBookers: number;
  neverBooked: number;
  bookedOnce: number;
}

export async function getBehaviourCounts(window: TrackerRange): Promise<BehaviourCounts> {
  const [windowed, neverBooked, bookedOnce] = await Promise.all([
    prisma.$queryRaw<{ repeat_bookings: bigint; repeat_customers: bigint; new_bookers: bigint }[]>`
      WITH ${NUMBERED_PAID_BOOKINGS}
      SELECT
        COUNT(*) FILTER (WHERE n > 1 AND d >= ${window.from} AND d < ${window.to}) AS repeat_bookings,
        COUNT(DISTINCT "customerId") FILTER (WHERE n > 1 AND d >= ${window.from} AND d < ${window.to}) AS repeat_customers,
        COUNT(*) FILTER (WHERE n = 1 AND d >= ${window.from} AND d < ${window.to}) AS new_bookers
      FROM numbered`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM "Customer" c
      WHERE c."deletedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "Registration" r WHERE r."customerId" = c.id)
        AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."customerId" = c.id AND ${PAID_BOOKING})`,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT b."customerId" FROM "Booking" b
        JOIN "Customer" c ON c.id = b."customerId"
        WHERE c."deletedAt" IS NULL AND ${PAID_BOOKING}
        GROUP BY b."customerId" HAVING COUNT(*) = 1
      ) once`,
  ]);

  return {
    repeatBookings: Number(windowed[0].repeat_bookings),
    repeatCustomers: Number(windowed[0].repeat_customers),
    newBookers: Number(windowed[0].new_bookers),
    neverBooked: Number(neverBooked[0].count),
    bookedOnce: Number(bookedOnce[0].count),
  };
}

export interface BehaviourBookingRow {
  bookingId: string;
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
  grandTotal: string | null;
  /** 1 = their first paid booking, 2 = second, ... */
  bookingNumber: number;
}

type BookingRowRaw = {
  id: string;
  customerId: string;
  name: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  orderNo: string | null;
  orderDate: Date | null;
  bookingDate: Date | null;
  salonName: string | null;
  status: string | null;
  grandTotal: string | null;
  n: bigint;
};

function toBookingRow(r: BookingRowRaw): BehaviourBookingRow {
  return {
    bookingId: r.id,
    customerId: r.customerId,
    customerName: r.name,
    phone: r.phone,
    city: r.city,
    ownerName: r.ownerName,
    orderNo: r.orderNo,
    orderDate: r.orderDate,
    bookingDate: r.bookingDate,
    salonName: r.salonName,
    status: r.status,
    grandTotal: r.grandTotal,
    bookingNumber: Number(r.n),
  };
}

/** Repeat bookings (isRepeat) or first-ever bookings, i.e. new bookers (!isRepeat), placed inside the window. */
export async function getWindowedBookings(
  window: TrackerRange,
  isRepeat: boolean,
  page = 1,
  pageSize = 50
): Promise<BehaviourBookingRow[]> {
  const skip = (page - 1) * pageSize;
  const nFilter = isRepeat ? Prisma.sql`nb.n > 1` : Prisma.sql`nb.n = 1`;
  const rows = await prisma.$queryRaw<BookingRowRaw[]>`
    WITH ${NUMBERED_PAID_BOOKINGS}
    SELECT nb.id, nb."customerId", c.name, c.phone, c.city, u.name AS "ownerName", nb."orderNo", nb."orderDate",
           nb."bookingDate", COALESCE(s.name, nb."salonNameSnapshot") AS "salonName", nb."status", nb."grandTotal", nb.n
    FROM numbered nb
    JOIN "Customer" c ON c.id = nb."customerId"
    LEFT JOIN "User" u ON u.id = c."ownerId"
    LEFT JOIN "Salon" s ON s.id = nb."salonId"
    WHERE ${nFilter} AND nb.d >= ${window.from} AND nb.d < ${window.to}
    ORDER BY nb.d DESC, nb.id
    LIMIT ${pageSize} OFFSET ${skip}`;
  return rows.map(toBookingRow);
}

/** Customers with exactly one paid booking ever - that single booking is shown. */
export async function getBookedOnce(page = 1, pageSize = 50): Promise<BehaviourBookingRow[]> {
  const skip = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<BookingRowRaw[]>`
    WITH ${NUMBERED_PAID_BOOKINGS},
    singles AS (SELECT "customerId" FROM numbered GROUP BY "customerId" HAVING COUNT(*) = 1)
    SELECT nb.id, nb."customerId", c.name, c.phone, c.city, u.name AS "ownerName", nb."orderNo", nb."orderDate",
           nb."bookingDate", COALESCE(s.name, nb."salonNameSnapshot") AS "salonName", nb."status", nb."grandTotal", nb.n
    FROM numbered nb
    JOIN singles ON singles."customerId" = nb."customerId"
    JOIN "Customer" c ON c.id = nb."customerId"
    LEFT JOIN "User" u ON u.id = c."ownerId"
    LEFT JOIN "Salon" s ON s.id = nb."salonId"
    ORDER BY nb.d DESC, nb.id
    LIMIT ${pageSize} OFFSET ${skip}`;
  return rows.map(toBookingRow);
}

export interface NeverBookedRow {
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  registeredAt: Date | null;
  hasActiveFollowup: boolean;
}

/** Registered customers with no paid booking at all, newest registration first. */
export async function getNeverBooked(page = 1, pageSize = 50): Promise<NeverBookedRow[]> {
  const skip = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<
    {
      id: string;
      name: string | null;
      phone: string;
      city: string | null;
      ownerName: string | null;
      registeredAt: Date | null;
      hasFollowup: boolean;
    }[]
  >`
    SELECT c.id, c.name, c.phone, c.city, u.name AS "ownerName",
           (SELECT MAX(r."onboardingDate") FROM "Registration" r WHERE r."customerId" = c.id) AS "registeredAt",
           EXISTS (SELECT 1 FROM "Followup" f WHERE f."customerId" = c.id) AS "hasFollowup"
    FROM "Customer" c
    LEFT JOIN "User" u ON u.id = c."ownerId"
    WHERE c."deletedAt" IS NULL
      AND EXISTS (SELECT 1 FROM "Registration" r WHERE r."customerId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM "Booking" b WHERE b."customerId" = c.id AND ${PAID_BOOKING})
    ORDER BY "registeredAt" DESC NULLS LAST, c.id
    LIMIT ${pageSize} OFFSET ${skip}`;
  return rows.map((r) => ({
    customerId: r.id,
    customerName: r.name,
    phone: r.phone,
    city: r.city,
    ownerName: r.ownerName,
    registeredAt: r.registeredAt,
    hasActiveFollowup: r.hasFollowup,
  }));
}
