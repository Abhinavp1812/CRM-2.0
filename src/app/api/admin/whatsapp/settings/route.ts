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
  // Partial updates are fine: anything not sent keeps its saved value.
  const current = await getNudgeSettings();
  await saveNudgeSettings({ ...current, ...body });
  return NextResponse.json({ success: true, settings: await getNudgeSettings() });
}
