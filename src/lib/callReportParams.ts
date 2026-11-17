import { istDayRange, todayIsoIST } from "@/lib/formatDate";
import { listParam, oneParam, type SearchParamsRecord } from "@/lib/params";
import { isSegmentKey, type SegmentKey } from "@/lib/segments";
import type { ActivityKind, CallActivityQuery } from "@/lib/callActivity";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface CallReportParams {
  fromStr: string;
  toStr: string;
  segments: SegmentKey[];
  kinds: ActivityKind[];
  remarks: string[];
  calledBy: string[];
  campaigns: string[];
  query: CallActivityQuery;
}

/**
 * Daily Report filters from the URL. Agents are always limited to their own
 * customers and can't filter by who called; admins see everyone.
 */
export function parseCallReportParams(sp: SearchParamsRecord, user: { id: string; isAdmin: boolean }): CallReportParams {
  const today = todayIsoIST();
  // Old links used ?date=YYYY-MM-DD for a single day.
  const legacy = oneParam(sp.date);
  let fromStr = oneParam(sp.from) ?? legacy ?? today;
  let toStr = oneParam(sp.to) ?? legacy ?? fromStr;
  if (!ISO.test(fromStr)) fromStr = today;
  if (!ISO.test(toStr)) toStr = fromStr;
  if (toStr < fromStr) [fromStr, toStr] = [toStr, fromStr];

  const segments = listParam(sp.seg).filter(isSegmentKey);
  const kinds = listParam(sp.kind).filter((k): k is ActivityKind => k === "CALL_LOGGED" || k === "REMARK_ADDED");
  const remarks = listParam(sp.remark);
  const calledBy = user.isAdmin ? listParam(sp.by) : [];
  const campaigns = listParam(sp.campaign);

  return {
    fromStr,
    toStr,
    segments,
    kinds,
    remarks,
    calledBy,
    campaigns,
    query: {
      start: istDayRange(fromStr).start,
      end: istDayRange(toStr).end,
      customerOwnerIds: user.isAdmin ? [] : [user.id],
      calledBy,
      kinds,
      remarks,
      campaigns,
    },
  };
}
