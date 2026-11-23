import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveNudgeSettings, getNudgeSettings, type NudgeSettings } from "@/lib/whatsappNudges";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: NudgeSettings;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Partial updates are fine: anything not sent keeps its saved value. The round
  // counters and rotation position are run by the server - never taken from the
  // page, so a page opened before a send can't wind them back.
  const current = await getNudgeSettings();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rounds, rotationIndex, ...editable } = body;
  await saveNudgeSettings({ ...current, ...editable });
  return NextResponse.json({ success: true, settings: await getNudgeSettings() });
}
