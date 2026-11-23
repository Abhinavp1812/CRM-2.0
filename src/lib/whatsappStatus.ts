/**
 * Status / trigger values of WhatsAppMessage rows, shared by every page.
 *
 * - SENT / FAILED: the CRM sent the message through the Anantya API.
 * - LISTED: the customer was put in a "Nudges for today" batch for the team to
 *   send by hand from the Anantya platform. Counts as nudged (cooldown and
 *   round rotation), exactly like the WA Toolbox "Nudges Log".
 */
export const NUDGED_STATUSES = ["SENT", "LISTED"];
export const BATCH_TRIGGER = "list";

export function statusText(status: string): string {
  if (status === "SENT") return "Sent";
  if (status === "LISTED") return "Listed (send in Anantya)";
  return "Failed";
}

export function triggerText(trigger: string): string {
  if (trigger === "automatic") return "Automatic";
  if (trigger === BATCH_TRIGGER) return "Nudges for today";
  return "Manual";
}
