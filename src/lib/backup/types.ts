/**
 * Full-fidelity backup format — every field of every customer-related table,
 * enough to reconstruct the CRM's data exactly (not the human-readable report
 * the "Export All Data" button produces, which loses precision on purpose).
 *
 * Every table links back to its customer by phone number, not by database id.
 * Ids are only meaningful within one database, and this file is meant to be
 * restorable into a different one (e.g. after a full wipe) - phone is already
 * this app's real identity for a customer everywhere else, so restoring keys
 * off it too. Same idea for a booking's salon: linked by its externalId, not
 * a raw id.
 *
 * User references (owner, who last touched something) are exported as email
 * for the same reason. User accounts themselves are never included: passwords
 * are out of scope, and the target database's own Team page is the source of
 * truth for who exists.
 *
 * Bump BACKUP_VERSION only for a breaking shape change; the importer checks it.
 */

export const BACKUP_VERSION = 1;

export interface BackupMeta {
  version: number;
  exportedAt: string;
  counts: {
    salons: number;
    customers: number;
    followups: number;
    activities: number;
    registrations: number;
    bookings: number;
    remarkOptions: number;
    settings: number;
  };
}

/** The full export, as downloaded. The importer re-slices this into request-sized batches client-side. */
export interface BackupFile extends BackupMeta {
  salons: BackupSalon[];
  customers: BackupCustomer[];
  followups: BackupFollowup[];
  activities: BackupActivity[];
  registrations: BackupRegistration[];
  bookings: BackupBooking[];
  remarkOptions: BackupRemarkOption[];
  settings: BackupSetting[];
}

export interface BackupSalon {
  externalId: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  createdAt: string;
}

export interface BackupCustomer {
  phone: string;
  name: string | null;
  gender: string | null;
  address: string | null;
  city: string | null;
  sector: string | null;
  customerIdExt: string | null;
  customerType: "NEW_REGISTRATION" | "CUSTOMER";
  ownerEmail: string | null;
  pendingOwnerName: string | null;
  doNotContact: boolean;
  doNotContactReason: string | null;
  doNotContactSetAt: string | null;
  doNotContactSetByEmail: string | null;
  firstSeenAt: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface BackupFollowup {
  customerPhone: string;
  nextFollowupDate: string;
  currentRemark: string | null;
  currentNote: string | null;
  lastContactedAt: string | null;
  lastContactedByEmail: string | null;
  updatedByEmail: string | null;
}

export interface BackupActivity {
  id: string;
  customerPhone: string;
  userEmail: string | null;
  activityType: string;
  remark: string | null;
  note: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export interface BackupRegistration {
  id: string;
  customerPhone: string;
  customerIdExt: string | null;
  onboardingDate: string | null;
  rawData: unknown;
  createdAt: string;
}

export interface BackupBooking {
  id: string;
  customerPhone: string;
  salonExternalId: string | null;
  orderNo: string | null;
  aiCallingStatus: string | null;
  orderDate: string | null;
  bookingDate: string | null;
  bookingTime: string | null;
  status: string | null;
  paymentStatus: string | null;
  salonNameSnapshot: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  gst: string | null;
  grossAmount: string | null;
  stylistDiscount: string | null;
  slotsDiscount: string | null;
  couponsDiscount: string | null;
  offersDiscount: string | null;
  hygieneFee: string | null;
  platformFee: string | null;
  grandTotal: string | null;
  tokenAmount: string | null;
  remainingAmount: string | null;
  gatewayOrderId: string | null;
  styleLoungeCoupon: string | null;
  salonCoupon: string | null;
  styleLoungeUser: string | null;
  rawData: unknown;
  createdAt: string;
}

export interface BackupRemarkOption {
  label: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  defaultDaysAhead: number | null;
  autoFlagDnc: boolean;
  closesFollowup: boolean;
}

export interface BackupSetting {
  key: string;
  value: string;
}

/** One table's worth of rows, sent as one request by the client-side batching loop. */
export type LinkedTable = "followups" | "activities" | "registrations" | "bookings";

export interface RestoreCounts {
  salonsCreated: number;
  salonsUpdated: number;
  customersCreated: number;
  customersUpdated: number;
  customersSkipped: number;
  followupsWritten: number;
  followupsSkipped: number;
  activitiesWritten: number;
  activitiesSkipped: number;
  registrationsWritten: number;
  registrationsSkipped: number;
  bookingsWritten: number;
  bookingsSkipped: number;
  remarkOptionsWritten: number;
  settingsWritten: number;
  warnings: string[];
}

export function emptyRestoreCounts(): RestoreCounts {
  return {
    salonsCreated: 0, salonsUpdated: 0,
    customersCreated: 0, customersUpdated: 0, customersSkipped: 0,
    followupsWritten: 0, followupsSkipped: 0,
    activitiesWritten: 0, activitiesSkipped: 0,
    registrationsWritten: 0, registrationsSkipped: 0,
    bookingsWritten: 0, bookingsSkipped: 0,
    remarkOptionsWritten: 0, settingsWritten: 0,
    warnings: [],
  };
}
