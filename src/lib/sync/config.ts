/**
 * Where the CRM pulls its lead data from.
 * Sheet IDs are not secrets, so sensible defaults live here; override via env.
 *
 *   BOOKINGS_SHEET_ID          spreadsheet ID of the booking dump
 *   BOOKINGS_SHEET_TABS        comma-separated tab names (default "Sheet1")
 *   REGISTRATIONS_SHEET_ID     spreadsheet ID of the new-customers sheet
 *   REGISTRATIONS_SHEET_TABS   comma-separated tab names (default "Delhi/NCR")
 */

export type SyncType = "registrations" | "bookings";

export interface SheetSource {
  spreadsheetId: string;
  tabs: string[];
  url: string;
}

const DEFAULT_BOOKINGS_SHEET_ID = "170eda6EUteO6axl9ewPvV5vQtmS6kmQxeecJopceI2s";
const DEFAULT_REGISTRATIONS_SHEET_ID = "11BmPSUipryhD6ZNgeR5Rf06-ceQXehUD-DQSHeAOyMQ";

function splitTabs(raw: string | undefined, fallback: string): string[] {
  const tabs = (raw ?? fallback)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tabs.length > 0 ? tabs : [fallback];
}

/** Accepts either a bare ID or a full Google Sheets URL. */
function extractSheetId(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v) return fallback;
  const m = v.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : v;
}

export function getSheetSource(type: SyncType): SheetSource {
  const spreadsheetId =
    type === "bookings"
      ? extractSheetId(process.env.BOOKINGS_SHEET_ID, DEFAULT_BOOKINGS_SHEET_ID)
      : extractSheetId(process.env.REGISTRATIONS_SHEET_ID, DEFAULT_REGISTRATIONS_SHEET_ID);
  const tabs =
    type === "bookings"
      ? splitTabs(process.env.BOOKINGS_SHEET_TABS, "Sheet1")
      : splitTabs(process.env.REGISTRATIONS_SHEET_TABS, "Delhi/NCR");
  return { spreadsheetId, tabs, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` };
}
