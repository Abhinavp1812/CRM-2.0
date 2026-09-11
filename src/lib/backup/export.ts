import { prisma } from "@/lib/prisma";
import {
  BACKUP_VERSION,
  type BackupFile,
  type BackupSalon,
  type BackupCustomer,
  type BackupFollowup,
  type BackupActivity,
  type BackupRegistration,
  type BackupBooking,
  type BackupRemarkOption,
  type BackupSetting,
} from "./types";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function decimalStr(d: unknown): string | null {
  if (d === null || d === undefined) return null;
  return d.toString();
}

export async function buildBackup(): Promise<BackupFile> {
  const [users, salons, customers, followups, activities, registrations, bookings, remarkOptions, settings] =
    await Promise.all([
      prisma.user.findMany({ select: { id: true, email: true } }),
      prisma.salon.findMany(),
      prisma.customer.findMany({ select: { id: true, phone: true, name: true, gender: true, address: true, city: true, sector: true, customerIdExt: true, customerType: true, ownerId: true, pendingOwnerName: true, doNotContact: true, doNotContactReason: true, doNotContactSetAt: true, doNotContactSetBy: true, firstSeenAt: true, createdAt: true, deletedAt: true } }),
      prisma.followup.findMany({ select: { customer: { select: { phone: true } }, nextFollowupDate: true, currentRemark: true, currentNote: true, leadTemperature: true, lastContactedAt: true, lastContactedById: true, updatedById: true } }),
      prisma.activityLog.findMany({ select: { id: true, customer: { select: { phone: true } }, userId: true, activityType: true, remark: true, leadTemperature: true, note: true, oldValue: true, newValue: true, createdAt: true } }),
      prisma.registration.findMany({ select: { id: true, customer: { select: { phone: true } }, customerIdExt: true, onboardingDate: true, rawData: true, createdAt: true } }),
      prisma.booking.findMany({ select: { id: true, customer: { select: { phone: true } }, salon: { select: { externalId: true } }, orderNo: true, aiCallingStatus: true, orderDate: true, bookingDate: true, bookingTime: true, status: true, paymentStatus: true, salonNameSnapshot: true, city: true, state: true, address: true, gst: true, grossAmount: true, stylistDiscount: true, slotsDiscount: true, couponsDiscount: true, offersDiscount: true, hygieneFee: true, platformFee: true, grandTotal: true, tokenAmount: true, remainingAmount: true, gatewayOrderId: true, styleLoungeCoupon: true, salonCoupon: true, styleLoungeUser: true, rawData: true, createdAt: true } }),
      prisma.remarkOption.findMany(),
      prisma.setting.findMany(),
    ]);

  const emailById = new Map(users.map((u) => [u.id, u.email]));
  const emailOf = (id: string | null | undefined) => (id ? emailById.get(id) ?? null : null);

  // customerId -> phone, needed only while building this export (Customer.id
  // is looked up on the parent object here since findMany above didn't select it
  // for the child records - the include already gave us the phone directly).

  const backupSalons: BackupSalon[] = salons.map((s) => ({
    externalId: s.externalId,
    name: s.name,
    phone: s.phone,
    address: s.address,
    city: s.city,
    state: s.state,
    createdAt: s.createdAt.toISOString(),
  }));

  const backupCustomers: BackupCustomer[] = customers.map((c) => ({
    phone: c.phone,
    name: c.name,
    gender: c.gender,
    address: c.address,
    city: c.city,
    sector: c.sector,
    customerIdExt: c.customerIdExt,
    customerType: c.customerType,
    ownerEmail: emailOf(c.ownerId),
    pendingOwnerName: c.pendingOwnerName,
    doNotContact: c.doNotContact,
    doNotContactReason: c.doNotContactReason,
    doNotContactSetAt: iso(c.doNotContactSetAt),
    doNotContactSetByEmail: emailOf(c.doNotContactSetBy),
    firstSeenAt: c.firstSeenAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    deletedAt: iso(c.deletedAt),
  }));

  const backupFollowups: BackupFollowup[] = followups
    .filter((f) => f.customer)
    .map((f) => ({
      customerPhone: f.customer!.phone,
      nextFollowupDate: f.nextFollowupDate.toISOString(),
      currentRemark: f.currentRemark,
      currentNote: f.currentNote,
      leadTemperature: f.leadTemperature,
      lastContactedAt: iso(f.lastContactedAt),
      lastContactedByEmail: emailOf(f.lastContactedById),
      updatedByEmail: emailOf(f.updatedById),
    }));

  const backupActivities: BackupActivity[] = activities
    .filter((a) => a.customer)
    .map((a) => ({
      id: a.id,
      customerPhone: a.customer!.phone,
      userEmail: emailOf(a.userId),
      activityType: a.activityType,
      remark: a.remark,
      leadTemperature: a.leadTemperature,
      note: a.note,
      oldValue: a.oldValue,
      newValue: a.newValue,
      createdAt: a.createdAt.toISOString(),
    }));

  const backupRegistrations: BackupRegistration[] = registrations
    .filter((r) => r.customer)
    .map((r) => ({
      id: r.id,
      customerPhone: r.customer!.phone,
      customerIdExt: r.customerIdExt,
      onboardingDate: iso(r.onboardingDate),
      rawData: r.rawData,
      createdAt: r.createdAt.toISOString(),
    }));

  const backupBookings: BackupBooking[] = bookings
    .filter((b) => b.customer)
    .map((b) => ({
      id: b.id,
      customerPhone: b.customer!.phone,
      salonExternalId: b.salon?.externalId ?? null,
      orderNo: b.orderNo,
      aiCallingStatus: b.aiCallingStatus,
      orderDate: iso(b.orderDate),
      bookingDate: iso(b.bookingDate),
      bookingTime: b.bookingTime,
      status: b.status,
      paymentStatus: b.paymentStatus,
      salonNameSnapshot: b.salonNameSnapshot,
      city: b.city,
      state: b.state,
      address: b.address,
      gst: decimalStr(b.gst),
      grossAmount: decimalStr(b.grossAmount),
      stylistDiscount: decimalStr(b.stylistDiscount),
      slotsDiscount: decimalStr(b.slotsDiscount),
      couponsDiscount: decimalStr(b.couponsDiscount),
      offersDiscount: decimalStr(b.offersDiscount),
      hygieneFee: decimalStr(b.hygieneFee),
      platformFee: decimalStr(b.platformFee),
      grandTotal: decimalStr(b.grandTotal),
      tokenAmount: decimalStr(b.tokenAmount),
      remainingAmount: decimalStr(b.remainingAmount),
      gatewayOrderId: b.gatewayOrderId,
      styleLoungeCoupon: b.styleLoungeCoupon,
      salonCoupon: b.salonCoupon,
      styleLoungeUser: b.styleLoungeUser,
      rawData: b.rawData,
      createdAt: b.createdAt.toISOString(),
    }));

  const backupRemarkOptions: BackupRemarkOption[] = remarkOptions.map((r) => ({
    label: r.label,
    color: r.color,
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    defaultDaysAhead: r.defaultDaysAhead,
    autoFlagDnc: r.autoFlagDnc,
    closesFollowup: r.closesFollowup,
  }));

  const backupSettings: BackupSetting[] = settings.map((s) => ({ key: s.key, value: s.value }));

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      salons: backupSalons.length,
      customers: backupCustomers.length,
      followups: backupFollowups.length,
      activities: backupActivities.length,
      registrations: backupRegistrations.length,
      bookings: backupBookings.length,
      remarkOptions: backupRemarkOptions.length,
      settings: backupSettings.length,
    },
    salons: backupSalons,
    customers: backupCustomers,
    followups: backupFollowups,
    activities: backupActivities,
    registrations: backupRegistrations,
    bookings: backupBookings,
    remarkOptions: backupRemarkOptions,
    settings: backupSettings,
  };
}
