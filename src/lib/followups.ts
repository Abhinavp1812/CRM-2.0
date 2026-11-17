import { prisma } from "@/lib/prisma";
import { startOfTodayIST } from "@/lib/formatDate";
import { segmentOf, type SegmentKey } from "@/lib/segments";

const STALE_THRESHOLD_DAYS = 60;
const NEW_BOOKING_DAYS = 20;
// A followup counts as "New" (badge + pinned to the top of page 1) while it has
// never been contacted and its date was set within this many days - covers a
// freshly synced lead or one just bulk-scheduled by an admin. It stops being
// "new" the moment an agent logs a call or saves a remark, regardless of age.
const NEW_LEAD_DAYS = 3;
const NEW_LEAD_CAP = 20;

export type BookingFlavor =
  | "AWAITING_SERVICE"
  | "PAID_NOT_DONE"
  | "COMPLETED"
  | "IN_PROGRESS"
  | null;

export interface FollowupRow {
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  doNotContact: boolean;
  leadSource: string | null;
  nextFollowupDate: Date;
  effectiveFollowupDate: Date;
  currentRemark: string | null;
  currentNote: string | null;
  leadTemperature: "HOT" | "WARM" | "COLD" | null;
  lastContactedAt: Date | null;
  lastBookingDate: Date | null;
  lastBookingSalon: string | null;
  registeredAt: Date | null;
  ownerName: string | null;
  status: "OVERDUE" | "DUE_TODAY" | "UPCOMING";
  untouched: boolean;
  isNew: boolean;
  isStale: boolean;
  isBooked: boolean;
  isCancelledRecovery: boolean;
  bookingFlavor: BookingFlavor;
}

export interface FollowupCounts {
  total: number;
  cold: number;
  booked: number;
  todaysFollowup: number;
  pipeline: number;
  actionRequired: number;
  registered: number;
  bookedType: number;
}

export type FollowupFilter =
  | "all"
  | "cold"
  | "booked"
  | "todays_followup"
  | "pipeline"
  | "action_required"
  | "registered"
  | "booked_type";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getDateMarkers() {
  const today = startOfTodayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const staleCutoff = new Date(today);
  staleCutoff.setDate(staleCutoff.getDate() - STALE_THRESHOLD_DAYS);
  const newBookingCutoff = new Date(today);
  newBookingCutoff.setDate(newBookingCutoff.getDate() - NEW_BOOKING_DAYS);
  return { today, tomorrow, staleCutoff, newBookingCutoff };
}

// ── Customer categories (Registered / One-time / Repeat / Frequent) ──────────

/**
 * Paid visits per customer - only customers with at least one. A visit is one
 * paid booking day (payment Success / Partially Paid, not cancelled); several
 * orders on the same day count once. Same rule as Insights.
 */
export async function getPaidVisitCounts(scope: { userId: string | null }): Promise<Map<string, number>> {
  const ownerId = scope.userId;
  const rows = await prisma.$queryRaw<{ id: string; visits: number }[]>`
    SELECT b."customerId" AS id,
           COUNT(DISTINCT CAST(COALESCE(b."orderDate", b."bookingDate") AS date))::int AS visits
    FROM "Booking" b
    JOIN "Customer" c ON c.id = b."customerId"
    WHERE c."deletedAt" IS NULL
      AND (${ownerId}::text IS NULL OR c."ownerId" = ${ownerId})
      AND b."paymentStatus" IN ('Success', 'Partially Paid')
      AND COALESCE(b."status", '') <> 'Cancelled'
      AND COALESCE(b."orderDate", b."bookingDate") IS NOT NULL
    GROUP BY b."customerId"
  `;
  return new Map(rows.map((r) => [r.id, Number(r.visits)]));
}

/**
 * Narrows a followup list: to one category (an id allow-list or deny-list) and/or
 * to customers from any of the given campaigns (lead sources; NONE_VALUE = no campaign).
 */
export interface SegmentScope {
  include: string[] | null;
  exclude: string[] | null;
  leadSources?: string[];
  /** Has a paid booking at any of these salons (by salon name). */
  salons?: string[];
  /** YYYY-MM-DD, inclusive: has a registration dated in this range. */
  regFrom?: string;
  regTo?: string;
  /** YYYY-MM-DD, inclusive: has a paid booking dated in this range (booking date, else order date). */
  bookFrom?: string;
  bookTo?: string;
}

/** Extra Followups filters on top of the category. */
export interface ListFilters {
  leadSources: string[];
  salons: string[];
  regFrom?: string;
  regTo?: string;
  bookFrom?: string;
  bookTo?: string;
}

const hasDateOrSalon = (s: SegmentScope | null | undefined) => !!(s && (s.salons?.length || s.regFrom || s.regTo || s.bookFrom || s.bookTo));

/** Date-only columns are stored at UTC midnight: [from 00:00Z, day after `to` 00:00Z). */
function dayRange(from?: string, to?: string): Record<string, Date> | null {
  if (!from && !to) return null;
  const r: Record<string, Date> = {};
  if (from) r.gte = new Date(from + "T00:00:00Z");
  if (to) r.lt = new Date(Date.parse(to + "T00:00:00Z") + 86_400_000);
  return r;
}

/** Salon names that have bookings, for the Followups salon filter (names exactly as stored). */
export async function getSalonNames(): Promise<string[]> {
  const [salons, snapshots] = await Promise.all([
    prisma.salon.findMany({ where: { bookings: { some: {} } }, select: { name: true } }),
    prisma.booking.groupBy({ by: ["salonNameSnapshot"], where: { salonId: null, salonNameSnapshot: { not: null } } }),
  ]);
  const names = [...salons.map((s) => s.name), ...snapshots.map((s) => s.salonNameSnapshot ?? "")].filter((n) => n.trim());
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function segmentScope(seg: SegmentKey | null, visits: Map<string, number>): SegmentScope | null {
  if (!seg) return null;
  if (seg === "registered") return { include: null, exclude: Array.from(visits.keys()) };
  return { include: Array.from(visits).filter(([, v]) => segmentOf(v) === seg).map(([id]) => id), exclude: null };
}

/** Category + campaign / salon / date filters for the Followups page; null when nothing is set. */
export function listScope(seg: SegmentKey | null, visits: Map<string, number>, f: ListFilters): SegmentScope | null {
  const s = segmentScope(seg, visits);
  const any = f.leadSources.length || f.salons.length || f.regFrom || f.regTo || f.bookFrom || f.bookTo;
  if (!any) return s;
  return { include: s?.include ?? null, exclude: s?.exclude ?? null, ...f };
}

function segmentWhere(s: SegmentScope | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  const clauses: Record<string, unknown>[] = [];
  if (s.include) clauses.push({ customerId: { in: s.include.length ? s.include : ["__no_match__"] } });
  else if (s.exclude) clauses.push({ customerId: { notIn: s.exclude } });
  if (s.leadSources?.length) clauses.push({ customer: anyOf("leadSource", s.leadSources) });
  const reg = dayRange(s.regFrom, s.regTo);
  if (reg) clauses.push({ customer: { registrations: { some: { onboardingDate: reg } } } });
  // Booking date and salon must match the SAME paid booking.
  const book = dayRange(s.bookFrom, s.bookTo);
  if (book || s.salons?.length) {
    const bookingAnd: Record<string, unknown>[] = [
      { paymentStatus: { in: ["Success", "Partially Paid"] } },
      { OR: [{ status: null }, { status: { not: "Cancelled" } }] },
    ];
    if (book) bookingAnd.push({ OR: [{ bookingDate: book }, { bookingDate: null, orderDate: book }] });
    if (s.salons?.length) {
      bookingAnd.push({ OR: [{ salon: { name: { in: s.salons } } }, { salonId: null, salonNameSnapshot: { in: s.salons } }] });
    }
    clauses.push({ customer: { bookings: { some: { AND: bookingAnd } } } });
  }
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : { AND: clauses };
}

// scope: agent userId OR null (= all customers, admin combined view)
function buildBaseWhere(scope: { userId: string | null }) {
  return {
    customer: {
      ...(scope.userId ? { ownerId: scope.userId } : {}),
      doNotContact: false,
      deletedAt: null,
    },
  };
}

async function getBookedCustomerIds(scope: { userId: string | null }, newBookingCutoff: Date): Promise<Set<string>> {
  const rows = await prisma.booking.findMany({
    where: {
      bookingDate: { gte: newBookingCutoff },
      paymentStatus: { in: ["Success", "Partially Paid"] },
      NOT: { status: "Cancelled" },
      customer: {
        ...(scope.userId ? { ownerId: scope.userId } : {}),
        doNotContact: false,
        deletedAt: null,
      },
    },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  return new Set(rows.map((r) => r.customerId));
}

async function getCancelledRecoveryIds(scope: { userId: string | null }, newBookingCutoff: Date): Promise<Set<string>> {
  const rows = await prisma.booking.findMany({
    where: {
      bookingDate: { gte: newBookingCutoff },
      status: "Cancelled",
      customer: {
        ...(scope.userId ? { ownerId: scope.userId } : {}),
        doNotContact: false,
        deletedAt: null,
      },
    },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  return new Set(rows.map((r) => r.customerId));
}

async function getLatestPaidBookingByCustomer(
  customerIds: string[]
): Promise<Map<string, { date: Date; status: string | null; paymentStatus: string | null }>> {
  if (customerIds.length === 0) return new Map();
  const rows = await prisma.booking.findMany({
    where: {
      customerId: { in: customerIds },
      paymentStatus: { in: ["Success", "Partially Paid"] },
      NOT: { status: "Cancelled" },
    },
    orderBy: { bookingDate: "desc" },
    select: {
      customerId: true,
      bookingDate: true,
      status: true,
      paymentStatus: true,
    },
  });
  const map = new Map<string, { date: Date; status: string | null; paymentStatus: string | null }>();
  for (const r of rows) {
    if (!r.bookingDate) continue;
    if (!map.has(r.customerId)) {
      map.set(r.customerId, {
        date: r.bookingDate,
        status: r.status,
        paymentStatus: r.paymentStatus,
      });
    }
  }
  return map;
}

function classifyBooking(
  bookingDate: Date,
  status: string | null,
  today: Date
): BookingFlavor {
  const bd = startOfDay(bookingDate);
  const isFuture = bd.getTime() >= today.getTime();
  const s = (status || "").toLowerCase();
  if (s === "completed") return "COMPLETED";
  if (s === "in progress") return "IN_PROGRESS";
  if (s === "pending") return isFuture ? "AWAITING_SERVICE" : "PAID_NOT_DONE";
  return null;
}

export async function getFollowupCounts(scope: { userId: string | null }, seg?: SegmentScope | null): Promise<FollowupCounts> {
  const { today, tomorrow, staleCutoff, newBookingCutoff } = getDateMarkers();
  const segW = segmentWhere(seg);
  const baseWhere = { ...buildBaseWhere(scope), ...(segW ? { AND: [segW] } : {}) };

  const bookedIds = await getBookedCustomerIds(scope, newBookingCutoff);
  const bookedArr = Array.from(bookedIds);

  const cold = await prisma.followup.count({
    where: {
      ...baseWhere,
      currentRemark: null,
      lastContactedAt: null,
      ...(bookedArr.length > 0 ? { customerId: { notIn: bookedArr } } : {}),
    },
  });

  const booked = bookedArr.length > 0
    ? await prisma.followup.count({
        where: {
          ...baseWhere,
          currentRemark: null,
          lastContactedAt: null,
          customerId: { in: bookedArr },
        },
      })
    : 0;

  const todaysFollowup = await prisma.followup.count({
    where: {
      ...baseWhere,
      OR: [
        {
          AND: [
            { nextFollowupDate: { gte: today, lt: tomorrow } },
            {
              OR: [
                { lastContactedAt: { gte: staleCutoff } },
                { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
              ],
            },
          ],
        },
        {
          AND: [
            { lastContactedAt: { lt: staleCutoff, not: null } },
            { currentRemark: { not: null } },
          ],
        },
      ],
    },
  });

  const pipeline = await prisma.followup.count({
    where: {
      ...baseWhere,
      nextFollowupDate: { gte: tomorrow },
      OR: [
        { lastContactedAt: { gte: staleCutoff } },
        { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
      ],
    },
  });

  const actionRequired = await prisma.followup.count({
    where: {
      ...baseWhere,
      nextFollowupDate: { lt: today },
      OR: [
        { lastContactedAt: { gte: staleCutoff } },
        { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
      ],
    },
  });

  const total = cold + booked + todaysFollowup + pipeline + actionRequired;

  // Registered / Booked (type) are meant to be "leads still awaiting first
  // contact" - once an agent logs a remark or a call, that customer already
  // has a home in one of the five status tabs above (Pipeline, Today, etc.),
  // so it must drop out of here or it shows up twice across the tab bar.
  const [registered, bookedType] = await Promise.all([
    prisma.followup.count({
      where: {
        ...baseWhere,
        currentRemark: null,
        lastContactedAt: null,
        customer: { ...baseWhere.customer, customerType: "NEW_REGISTRATION" },
      },
    }),
    prisma.followup.count({
      where: {
        ...baseWhere,
        currentRemark: null,
        lastContactedAt: null,
        customer: { ...baseWhere.customer, customerType: "CUSTOMER" },
      },
    }),
  ]);

  return { total, cold, booked, todaysFollowup, pipeline, actionRequired, registered, bookedType };
}

type WhereInput = ReturnType<typeof buildBaseWhere> & Record<string, unknown>;

async function applyFilter(
  baseWhere: ReturnType<typeof buildBaseWhere>,
  filter: FollowupFilter,
  today: Date,
  tomorrow: Date,
  staleCutoff: Date,
  newBookingCutoff: Date,
  scope: { userId: string | null },
  seg?: SegmentScope | null
): Promise<WhereInput> {
  const customerFilter: {
    ownerId?: string;
    doNotContact: boolean;
    deletedAt: null;
    customerType?: "NEW_REGISTRATION" | "CUSTOMER";
  } = {
    doNotContact: baseWhere.customer.doNotContact,
    deletedAt: baseWhere.customer.deletedAt,
  };
  if (scope.userId) customerFilter.ownerId = scope.userId;
  if (filter === "registered") customerFilter.customerType = "NEW_REGISTRATION";
  if (filter === "booked_type") customerFilter.customerType = "CUSTOMER";

  const where: WhereInput = { customer: customerFilter };
  const segW = segmentWhere(seg);
  if (segW) where.AND = [segW];

  if (filter === "registered" || filter === "booked_type") {
    // Awaiting first contact only - once touched, this customer already has a
    // home in one of the status tabs (Pipeline, Today, etc.) and must not
    // also show up here, or it appears twice across the tab bar.
    where.currentRemark = null;
    where.lastContactedAt = null;
  } else if (filter === "cold") {
    const bookedIds = await getBookedCustomerIds(scope, newBookingCutoff);
    const arr = Array.from(bookedIds);
    where.currentRemark = null;
    where.lastContactedAt = null;
    if (arr.length > 0) where.customerId = { notIn: arr };
  } else if (filter === "booked") {
    const bookedIds = await getBookedCustomerIds(scope, newBookingCutoff);
    const arr = Array.from(bookedIds);
    where.currentRemark = null;
    where.lastContactedAt = null;
    where.customerId = arr.length > 0 ? { in: arr } : { in: ["__no_match__"] };
  } else if (filter === "todays_followup") {
    where.OR = [
      {
        AND: [
          { nextFollowupDate: { gte: today, lt: tomorrow } },
          {
            OR: [
              { lastContactedAt: { gte: staleCutoff } },
              { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
            ],
          },
        ],
      },
      {
        AND: [
          { lastContactedAt: { lt: staleCutoff, not: null } },
          { currentRemark: { not: null } },
        ],
      },
    ];
  } else if (filter === "pipeline") {
    where.nextFollowupDate = { gte: tomorrow };
    where.OR = [
      { lastContactedAt: { gte: staleCutoff } },
      { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
    ];
  } else if (filter === "action_required") {
    where.nextFollowupDate = { lt: today };
    where.OR = [
      { lastContactedAt: { gte: staleCutoff } },
      { AND: [{ lastContactedAt: null }, { currentRemark: { not: null } }] },
    ];
  }

  return where;
}

export async function getFilteredCount(
  scope: { userId: string | null },
  filter: FollowupFilter,
  seg?: SegmentScope | null
): Promise<number> {
  const { today, tomorrow, staleCutoff, newBookingCutoff } = getDateMarkers();
  const baseWhere = buildBaseWhere(scope);
  const where = await applyFilter(baseWhere, filter, today, tomorrow, staleCutoff, newBookingCutoff, scope, seg);
  return prisma.followup.count({ where });
}

/**
 * List order. "followup" = next followup date (with fresh leads pinned on page 1),
 * "booking" = latest PAID booking first, "registered" = latest registration first.
 * Customers without that date go last, in followup-date order.
 */
export type FollowupSort = "followup" | "booking" | "registered";

/** All customer ids matching `where`, ordered newest-first by paid booking or registration date. */
async function idsSortedByDate(where: WhereInput, sort: "booking" | "registered"): Promise<string[]> {
  const ids = (await prisma.followup.findMany({ where, select: { customerId: true }, orderBy: { nextFollowupDate: "asc" } })).map(
    (r) => r.customerId
  );
  if (ids.length === 0) return ids;
  const dateRows =
    sort === "booking"
      ? await prisma.$queryRaw<{ id: string; d: Date | null }[]>`
          SELECT b."customerId" AS id, MAX(COALESCE(b."bookingDate", b."orderDate")) AS d
          FROM "Booking" b
          WHERE b."customerId" = ANY(${ids}::text[])
            AND b."paymentStatus" IN ('Success', 'Partially Paid')
            AND COALESCE(b."status", '') <> 'Cancelled'
          GROUP BY b."customerId"
        `
      : await prisma.$queryRaw<{ id: string; d: Date | null }[]>`
          SELECT r."customerId" AS id, MAX(r."onboardingDate") AS d
          FROM "Registration" r
          WHERE r."customerId" = ANY(${ids}::text[])
          GROUP BY r."customerId"
        `;
  const dateOf = new Map(dateRows.filter((r) => r.d).map((r) => [r.id, new Date(r.d!).getTime()]));
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => {
    const da = dateOf.get(a);
    const db = dateOf.get(b);
    if (da !== undefined && db !== undefined && da !== db) return db - da;
    if (da !== undefined && db === undefined) return -1;
    if (da === undefined && db !== undefined) return 1;
    return pos.get(a)! - pos.get(b)!;
  });
}

export async function getTodayFollowups(
  scope: { userId: string | null },
  page = 1,
  pageSize = 50,
  filter: FollowupFilter = "all",
  seg?: SegmentScope | null,
  sort?: FollowupSort | null
): Promise<FollowupRow[]> {
  const { today, tomorrow, staleCutoff, newBookingCutoff } = getDateMarkers();
  const baseWhere = buildBaseWhere(scope);
  const where = await applyFilter(baseWhere, filter, today, tomorrow, staleCutoff, newBookingCutoff, scope, seg);
  const segInclude = seg?.include ?? null;
  const segExclude = seg?.exclude ?? null;
  const lsAll = seg?.leadSources ?? [];
  const lsFilter = lsAll.length > 0;
  const lsReal = lsAll.filter((v) => v !== NONE_VALUE);
  const lsNone = lsAll.includes(NONE_VALUE);

  const [bookedIds, cancelledIds] = await Promise.all([
    getBookedCustomerIds(scope, newBookingCutoff),
    getCancelledRecoveryIds(scope, newBookingCutoff),
  ]);

  const followupInclude = {
    customer: {
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        customerType: true,
        doNotContact: true,
        leadSource: true,
        owner: { select: { name: true } },
        // Latest PAID booking (Success / Partially Paid, not cancelled) - the same
        // rule the "Latest booking" sort and the category badge use.
        bookings: {
          where: {
            paymentStatus: { in: ["Success", "Partially Paid"] },
            OR: [{ status: null }, { status: { not: "Cancelled" } }],
          },
          orderBy: [{ bookingDate: { sort: "desc" as const, nulls: "last" as const } }, { orderDate: "desc" as const }],
          take: 1,
          select: {
            bookingDate: true,
            orderDate: true,
            salonNameSnapshot: true,
            salon: { select: { name: true } },
          },
        },
        registrations: {
          orderBy: { onboardingDate: "desc" as const },
          take: 1,
          select: { onboardingDate: true },
        },
      },
    },
  };

  // The Registered and Booked (type) tabs are meant to surface newest-first,
  // across every page - not just a capped page-1 preview. A plain sort by
  // Customer.firstSeenAt doesn't actually do that: every customer created in
  // the same bulk sync batch shares the exact same value (Postgres's now()
  // is fixed for the whole transaction, not per row), so within one sync run
  // the order is arbitrary. What "recent" really means here is each row's own
  // date - onboardingDate for a registration, the booking date for a booking
  // - which Prisma can't sort a findMany by (it can't order by an aggregate
  // of a to-many relation; confirmed by a type error, not assumed). A single
  // raw query resolves the correctly ordered, paginated id list directly:
  // NULLS LAST so a customer without one yet still appears, just after the
  // ones with a real date, falling back to firstSeenAt as the final tiebreak.
  const isRegistered = filter === "registered";
  const isBookedType = filter === "booked_type";
  const newCutoff = new Date(today);
  newCutoff.setDate(newCutoff.getDate() - NEW_LEAD_DAYS);

  let followups: Awaited<ReturnType<typeof prisma.followup.findMany<{ include: typeof followupInclude }>>>;

  // The Registered / Booked (type) tabs' own SQL doesn't know the date and salon
  // filters, so with those set they go through the generic sorted path instead,
  // keeping the same newest-first order.
  if (!sort && hasDateOrSalon(seg) && (isRegistered || isBookedType)) sort = isRegistered ? "registered" : "booking";

  if (sort === "booking" || sort === "registered") {
    const orderedIds = (await idsSortedByDate(where, sort)).slice((page - 1) * pageSize, page * pageSize);
    const rows = orderedIds.length
      ? await prisma.followup.findMany({ where: { customerId: { in: orderedIds } }, include: followupInclude })
      : [];
    const byCustomerId = new Map(rows.map((f) => [f.customer.id, f]));
    followups = orderedIds.map((id) => byCustomerId.get(id)).filter((f): f is NonNullable<typeof f> => f !== undefined);
  } else if (isRegistered || isBookedType) {
    const skip = (page - 1) * pageSize;
    const ownerId = scope.userId;
    // Inner-joined to Followup and restricted to untouched (no remark, never
    // contacted) so this only ever shows leads still awaiting first contact -
    // once an agent works one, it belongs to a status tab (Pipeline, Today,
    // etc.) instead, not here too, and a closed-out customer (no Followup row
    // left at all) drops out of the list entirely, same as every other tab.
    const idRows = isRegistered
      ? await prisma.$queryRaw<{ id: string }[]>`
          SELECT c.id
          FROM "Customer" c
          JOIN "Followup" f ON f."customerId" = c.id
          LEFT JOIN "Registration" r ON r."customerId" = c.id
          WHERE c."deletedAt" IS NULL AND c."doNotContact" = false AND c."customerType" = 'NEW_REGISTRATION'
            AND f."currentRemark" IS NULL AND f."lastContactedAt" IS NULL
            AND (${ownerId}::text IS NULL OR c."ownerId" = ${ownerId})
            AND (${segInclude}::text[] IS NULL OR c.id = ANY(${segInclude}::text[]))
            AND (${segExclude}::text[] IS NULL OR c.id <> ALL(${segExclude}::text[]))
            AND (${lsFilter}::boolean = false OR c."leadSource" = ANY(${lsReal}::text[]) OR (${lsNone}::boolean AND c."leadSource" IS NULL))
          GROUP BY c.id
          ORDER BY MAX(r."onboardingDate") DESC NULLS LAST, c."firstSeenAt" DESC
          LIMIT ${pageSize} OFFSET ${skip}
        `
      : await prisma.$queryRaw<{ id: string }[]>`
          SELECT c.id
          FROM "Customer" c
          JOIN "Followup" f ON f."customerId" = c.id
          LEFT JOIN "Booking" b ON b."customerId" = c.id
          WHERE c."deletedAt" IS NULL AND c."doNotContact" = false AND c."customerType" = 'CUSTOMER'
            AND f."currentRemark" IS NULL AND f."lastContactedAt" IS NULL
            AND (${ownerId}::text IS NULL OR c."ownerId" = ${ownerId})
            AND (${segInclude}::text[] IS NULL OR c.id = ANY(${segInclude}::text[]))
            AND (${segExclude}::text[] IS NULL OR c.id <> ALL(${segExclude}::text[]))
            AND (${lsFilter}::boolean = false OR c."leadSource" = ANY(${lsReal}::text[]) OR (${lsNone}::boolean AND c."leadSource" IS NULL))
          GROUP BY c.id
          ORDER BY MAX(b."bookingDate") DESC NULLS LAST, c."firstSeenAt" DESC
          LIMIT ${pageSize} OFFSET ${skip}
        `;

    const orderedIds = idRows.map((r) => r.id);
    const rows = orderedIds.length
      ? await prisma.followup.findMany({ where: { customerId: { in: orderedIds } }, include: followupInclude })
      : [];
    const byCustomerId = new Map(rows.map((f) => [f.customer.id, f]));
    followups = orderedIds.map((id) => byCustomerId.get(id)).filter((f): f is NonNullable<typeof f> => f !== undefined);
  } else {
    const normalFollowupsPromise = prisma.followup.findMany({
      where,
      include: followupInclude,
      orderBy: { nextFollowupDate: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Page 1 only: pin a small batch of untouched, freshly-dated leads to the
    // top - a synced or bulk-scheduled lead the customer hasn't seen yet. This
    // never changes the underlying skip/take math for the normal query above,
    // so later pages are unaffected and nothing is skipped or duplicated there.
    let newFollowups: Awaited<typeof normalFollowupsPromise> = [];
    if (page === 1) {
      newFollowups = await prisma.followup.findMany({
        where: { AND: [where, { lastContactedAt: null, updatedAt: { gte: newCutoff } }] },
        include: followupInclude,
        orderBy: { updatedAt: "desc" },
        take: NEW_LEAD_CAP,
      });
    }

    const normalFollowups = await normalFollowupsPromise;
    const pinnedIds = new Set(newFollowups.map((f) => f.customer.id));
    followups =
      page === 1 ? [...newFollowups, ...normalFollowups.filter((f) => !pinnedIds.has(f.customer.id))] : normalFollowups;
  }

  const customerIds = followups.map((f) => f.customer.id);
  const latestPaidByCustomer = await getLatestPaidBookingByCustomer(customerIds);

  return followups.map((f) => {
    const fd = startOfDay(f.nextFollowupDate);
    const lastBooking = f.customer.bookings[0];
    const untouched = !f.currentRemark && !f.lastContactedAt;
    const isNew = !f.lastContactedAt && f.updatedAt >= newCutoff;
    const isStale = !!f.lastContactedAt && f.lastContactedAt < staleCutoff;
    const isBooked = bookedIds.has(f.customer.id) && untouched;
    const isCancelledRecovery = cancelledIds.has(f.customer.id) && untouched && !isBooked;

    let bookingFlavor: BookingFlavor = null;
    if (isBooked) {
      const lp = latestPaidByCustomer.get(f.customer.id);
      if (lp) bookingFlavor = classifyBooking(lp.date, lp.status, today);
    }

    let effectiveFollowupDate = fd;
    if (untouched && !isBooked) effectiveFollowupDate = today;
    else if (isStale) effectiveFollowupDate = today;

    let status: "OVERDUE" | "DUE_TODAY" | "UPCOMING";
    if (effectiveFollowupDate.getTime() < today.getTime()) status = "OVERDUE";
    else if (effectiveFollowupDate.getTime() === today.getTime()) status = "DUE_TODAY";
    else status = "UPCOMING";

    return {
      customerId: f.customer.id,
      customerName: f.customer.name,
      phone: f.customer.phone,
      city: f.customer.city,
      customerType: f.customer.customerType,
      doNotContact: f.customer.doNotContact,
      leadSource: f.customer.leadSource,
      nextFollowupDate: f.nextFollowupDate,
      effectiveFollowupDate,
      currentRemark: f.currentRemark,
      currentNote: f.currentNote,
      leadTemperature: f.leadTemperature,
      lastContactedAt: f.lastContactedAt,
      lastBookingDate: lastBooking?.bookingDate ?? lastBooking?.orderDate ?? null,
      lastBookingSalon: lastBooking?.salon?.name || lastBooking?.salonNameSnapshot || null,
      registeredAt: f.customer.registrations[0]?.onboardingDate ?? null,
      ownerName: f.customer.owner?.name || null,
      status,
      untouched,
      isNew,
      isStale,
      isBooked,
      isCancelledRecovery,
      bookingFlavor,
    };
  });
}

export function formatPhone(phone: string): string {
  if (!phone || phone.length !== 10) return phone;
  return phone;
}

export function whatsappLink(phone: string, message?: string): string {
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/91${phone}${text}`;
}

export function telLink(phone: string): string {
  return `tel:+91${phone}`;
}

// === Remark activity report (daily / weekly / monthly) ===
// Reads ActivityLog directly, not Followup - a closing remark (Not Interested,
// Converted, etc.) deletes the Followup row (see api/followups/save/route.ts),
// so ActivityLog is the only place that day's full remark history still lives.

export interface RemarkActivityRow {
  id: string;
  time: Date;
  customerId: string;
  customerName: string | null;
  phone: string;
  city: string | null;
  ownerName: string | null;
  remark: string | null;
  leadTemperature: "HOT" | "WARM" | "COLD" | null;
  note: string | null;
  nextFollowupDate: Date | null;
}

export async function getRemarkActivity(
  scope: { ownerId: string | string[] | null; remarks?: string[] },
  range: { start: Date; end: Date }
): Promise<RemarkActivityRow[]> {
  const owners = scope.ownerId === null ? [] : Array.isArray(scope.ownerId) ? scope.ownerId : [scope.ownerId];
  const rows = await prisma.activityLog.findMany({
    where: {
      activityType: "REMARK_ADDED",
      createdAt: { gte: range.start, lt: range.end },
      ...(scope.remarks?.length ? { remark: { in: scope.remarks } } : {}),
      customer: {
        deletedAt: null,
        ...(owners.length ? { ownerId: { in: owners } } : {}),
      },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, city: true, owner: { select: { name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    time: r.createdAt,
    customerId: r.customer.id,
    customerName: r.customer.name,
    phone: r.customer.phone,
    city: r.customer.city,
    ownerName: r.customer.owner?.name || null,
    remark: r.remark,
    leadTemperature: r.leadTemperature,
    note: r.note,
    nextFollowupDate: r.newValue ? new Date(r.newValue) : null,
  }));
}

export interface AgentPeriodStat {
  agentId: string;
  agentName: string;
  callsLogged: number;
  remarksLogged: number;
  booked: number;
  converted: number;
  notInterested: number;
  activeFollowupsNow: number;
}

export async function getAgentPeriodStats(range: { start: Date; end: Date }): Promise<AgentPeriodStat[]> {
  const agents = await prisma.user.findMany({
    where: { role: "AGENT", deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return Promise.all(
    agents.map(async (a) => {
      const [callsLogged, remarksLogged, booked, converted, notInterested, activeFollowupsNow] = await Promise.all([
        prisma.activityLog.count({ where: { userId: a.id, activityType: "CALL_LOGGED", createdAt: { gte: range.start, lt: range.end } } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "REMARK_ADDED", createdAt: { gte: range.start, lt: range.end } } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "REMARK_ADDED", remark: "Booked", createdAt: { gte: range.start, lt: range.end } } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "REMARK_ADDED", remark: "Converted", createdAt: { gte: range.start, lt: range.end } } }),
        prisma.activityLog.count({ where: { userId: a.id, activityType: "REMARK_ADDED", remark: "Not Interested", createdAt: { gte: range.start, lt: range.end } } }),
        prisma.followup.count({ where: { customer: { ownerId: a.id, deletedAt: null, doNotContact: false } } }),
      ]);
      return { agentId: a.id, agentName: a.name, callsLogged, remarksLogged, booked, converted, notInterested, activeFollowupsNow };
    })
  );
}

export async function getActiveRemarkOptions() {
  return prisma.remarkOption.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      label: true,
      defaultDaysAhead: true,
      autoFlagDnc: true,
      closesFollowup: true,
    },
  });
}

export async function getActiveLeadSources() {
  return prisma.leadSourceOption.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { label: true },
  });
}

// === Admin helpers (unchanged signatures, kept) ===
export interface AdminCustomerRow {
  id: string;
  name: string | null;
  phone: string;
  city: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  doNotContact: boolean;
  ownerName: string | null;
  ownerId: string | null;
  leadSource: string | null;
  followupDate: Date | null;
  currentRemark: string | null;
  currentNote: string | null;
  leadTemperature: "HOT" | "WARM" | "COLD" | null;
  lastContactedAt: Date | null;
  totalActivities: number;
  lastActivityDate: Date | null;
  hasFollowup: boolean;
}

/** Filter value meaning "has no owner" / "has no lead source". */
export const NONE_VALUE = "__none__";

export type FollowupStateFilter = "active" | "closed" | "dnc" | "contacted";

/** Every list is "any of these"; an empty or missing list means no filter. */
export interface AdminCustomerFilter {
  search?: string;
  ownerId?: string[];
  customerType?: ("NEW_REGISTRATION" | "CUSTOMER")[];
  followupState?: FollowupStateFilter[];
  remark?: string[];
  leadTemperature?: ("HOT" | "WARM" | "COLD")[];
  leadSource?: string[];
}

/** "Any of these values" on a nullable column, where NONE_VALUE stands for null. */
function anyOf(field: string, values: string[]): Record<string, unknown> {
  const real = values.filter((v) => v !== NONE_VALUE);
  const clauses: Record<string, unknown>[] = [];
  if (real.length) clauses.push({ [field]: { in: real } });
  if (values.includes(NONE_VALUE)) clauses.push({ [field]: null });
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}

export async function getAdminCustomers(filter: AdminCustomerFilter, page = 1, pageSize = 50) {
  // Each filter is its own AND clause. Keeping relation conditions (followup is /
  // isNot) in separate objects avoids mixing them with scalar keys in one object,
  // which Prisma rejects at runtime.
  const and: Record<string, unknown>[] = [{ deletedAt: null }];
  if (filter.search && filter.search.trim().length >= 2) {
    const q = filter.search.trim();
    const digitsOnly = q.replace(/D/g, "");
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(digitsOnly.length >= 4 ? [{ phone: { contains: digitsOnly } }] : []),
        { customerIdExt: q },
      ],
    });
  }
  if (filter.ownerId?.length) and.push(anyOf("ownerId", filter.ownerId));
  if (filter.leadSource?.length) and.push(anyOf("leadSource", filter.leadSource));
  if (filter.customerType?.length) and.push({ customerType: { in: filter.customerType } });
  if (filter.followupState?.length) {
    const byState: Record<FollowupStateFilter, Record<string, unknown>> = {
      active: { doNotContact: false, followup: { isNot: null } },
      // A closed customer has no Followup row at all.
      closed: { doNotContact: false, followup: null },
      dnc: { doNotContact: true },
      // Lifetime, matches the "Called" / "Booked" counts on Team Stats exactly:
      // every customer EVER actually reached, read straight from the activity log
      // - not Followup.lastContactedAt, which disappears when a remark closes the
      // followup. Not restricted to doNotContact: false, for the same reason.
      contacted: { activities: { some: { activityType: { in: ["CALL_LOGGED", "REMARK_ADDED"] } } } },
    };
    and.push({ OR: filter.followupState.map((st) => byState[st]) });
  }
  // Remark and temperature live on the Followup row, so these only match
  // customers with an open followup.
  if (filter.remark?.length) and.push({ followup: { is: { currentRemark: { in: filter.remark } } } });
  if (filter.leadTemperature?.length) and.push({ followup: { is: { leadTemperature: { in: filter.leadTemperature } } } });
  const where = { AND: and };

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        followup: { select: { nextFollowupDate: true, currentRemark: true, currentNote: true, leadTemperature: true, lastContactedAt: true } },
        _count: { select: { activities: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  const rows: AdminCustomerRow[] = customers.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, city: c.city, customerType: c.customerType,
    doNotContact: c.doNotContact, ownerName: c.owner?.name || null, ownerId: c.ownerId,
    leadSource: c.leadSource,
    followupDate: c.followup?.nextFollowupDate || null,
    currentRemark: c.followup?.currentRemark || null,
    currentNote: c.followup?.currentNote || null,
    leadTemperature: c.followup?.leadTemperature || null,
    lastContactedAt: c.followup?.lastContactedAt || null,
    totalActivities: c._count.activities,
    lastActivityDate: c.activities[0]?.createdAt || null,
    hasFollowup: !!c.followup,
  }));

  return { rows, total };
}

export async function getAllUsersForFilter() {
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

export interface ClosedCustomerRow {
  id: string; name: string | null; phone: string; city: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER"; doNotContact: boolean;
  doNotContactReason: string | null; doNotContactSetAt: Date | null;
  ownerName: string | null; closedReason: string; closedAt: Date | null;
}

export async function getClosedCustomers(filterReason: string | null, page = 1, pageSize = 50) {
  const where: Record<string, unknown> = {
    deletedAt: null,
    OR: [{ doNotContact: true }, { AND: [{ doNotContact: false }, { followup: null }] }],
  };
  if (filterReason === "dnc") {
    where.OR = undefined;
    where.doNotContact = true;
  }
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        owner: { select: { name: true } },
        activities: { where: { activityType: "REMARK_ADDED" }, orderBy: { createdAt: "desc" }, take: 1, select: { remark: true, createdAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.customer.count({ where }),
  ]);
  let rows: ClosedCustomerRow[] = customers.map((c) => {
    const lastRemark = c.activities[0];
    let closedReason = ""; let closedAt: Date | null = null;
    if (c.doNotContact) { closedReason = c.doNotContactReason || "Do Not Contact"; closedAt = c.doNotContactSetAt; }
    else if (lastRemark) { closedReason = lastRemark.remark || "Closed"; closedAt = lastRemark.createdAt; }
    else { closedReason = "No active followup"; closedAt = c.updatedAt; }
    return {
      id: c.id, name: c.name, phone: c.phone, city: c.city, customerType: c.customerType,
      doNotContact: c.doNotContact, doNotContactReason: c.doNotContactReason,
      doNotContactSetAt: c.doNotContactSetAt, ownerName: c.owner?.name || null,
      closedReason, closedAt,
    };
  });
  if (filterReason && filterReason !== "all" && filterReason !== "dnc") {
    rows = rows.filter((r) => r.closedReason.toLowerCase() === filterReason.toLowerCase());
  }
  return { rows, total };
}

export async function getClosureReasons(): Promise<string[]> {
  const closingRemarks = await prisma.remarkOption.findMany({
    where: { isActive: true, closesFollowup: true },
    select: { label: true },
    orderBy: { sortOrder: "asc" },
  });
  return ["dnc", ...closingRemarks.map((r) => r.label)];
}