/** A row pulled from a source sheet, with enough metadata to report problems. */
export interface SourceRow {
  sheet: string;
  rowNum: number; // 1-based row number in the sheet (header is row 1)
  data: Record<string, unknown>;
}

export interface SyncError {
  sheet: string;
  row: number;
  reason: string;
  data: Record<string, unknown>;
}

export interface AgentBreakdown {
  agentId: string;
  agentName: string;
  count: number;
}

export interface SyncContext {
  /** Real DB user id to attribute writes to (never "super-admin"). */
  userId: string;
}

export interface RegistrationsSyncResult {
  totalRows: number;
  newCount: number;
  /** Customers that had no followup row at all and were given one (see heal.ts). */
  healedFollowups: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
  autoAssignedCount: number;
  agentBreakdown: AgentBreakdown[];
  errors: SyncError[];
}

export interface BookingsSyncResult {
  totalRows: number;
  newBookingCount: number;
  /** Customers that had no followup row at all and were given one (see heal.ts). */
  healedFollowups: number;
  duplicateOrderCount: number;
  upgradedCustomerCount: number;
  newCustomerCount: number;
  autoAssignedCount: number;
  agentBreakdown: AgentBreakdown[];
  skipCount: number;
  errorCount: number;
  followupsCreated: number;
  followupsUpdated: number;
  followupsSkipped: number;
  errors: SyncError[];
}
