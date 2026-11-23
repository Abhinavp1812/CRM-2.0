import { NextResponse } from "next/server";
import { isAnantyaConfigured, getTemplates } from "@/lib/anantya";
import { getNudgeSettings, runGroup, GROUPS, type RunResult } from "@/lib/whatsappNudges";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Daily automatic WhatsApp nudges. Called by Vercel Cron (vercel.json) or the
 * server's own scheduler with `Authorization: Bearer <CRON_SECRET>`.
 * Does nothing unless Admin -> WhatsApp is set to Automatic. Test mode still
 * applies (one test message per group, to the test number only).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getNudgeSettings();
  if (settings.mode !== "automatic") return NextResponse.json({ ok: true, skipped: "Mode is manual" });
  if (!isAnantyaConfigured()) return NextResponse.json({ ok: false, error: "ANANTYA_API_KEY is not set" }, { status: 503 });

  const templates = await getTemplates();
  const results: RunResult[] = [];
  for (const g of GROUPS) {
    if (!settings.groups[g.key].enabled) continue;
    try {
      results.push(await runGroup(g.key, { trigger: "automatic", userId: null, settings, templates }));
    } catch (e) {
      console.error(`[cron/whatsapp] ${g.key}`, e);
      results.push({ group: g.key, isTest: settings.testMode, attempted: 0, sent: 0, failed: 0, errors: [e instanceof Error ? e.message : "Failed"] });
    }
  }
  return NextResponse.json({ ok: true, testMode: settings.testMode, results });
}
