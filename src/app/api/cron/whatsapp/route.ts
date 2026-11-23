import { NextResponse } from "next/server";
import { isAnantyaConfigured } from "@/lib/anantya";
import { getNudgeSettings, runAutomatic } from "@/lib/whatsappNudges";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Daily automatic WhatsApp nudges. Called by Vercel Cron (vercel.json) or the
 * server's own scheduler with `Authorization: Bearer <CRON_SECRET>`.
 * Does nothing unless Admin -> WhatsApp is set to Automatic. Sends the
 * "last booking 25 days ago" list + one count list on rotation. Test mode still
 * applies (one test message per group, to the test number only).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getNudgeSettings();
  if (settings.mode !== "automatic") return NextResponse.json({ ok: true, skipped: "Mode is manual" });
  if (!isAnantyaConfigured()) return NextResponse.json({ ok: false, error: "ANANTYA_API_KEY is not set" }, { status: 503 });

  try {
    return NextResponse.json({ ok: true, ...(await runAutomatic()) });
  } catch (e) {
    console.error("[cron/whatsapp]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
