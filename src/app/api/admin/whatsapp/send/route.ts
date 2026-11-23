import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAnantyaConfigured } from "@/lib/anantya";
import { runGroup, isGroupKey } from "@/lib/whatsappNudges";

export const maxDuration = 60;

/**
 * Manual "send" for one group (admin only). Test mode is enforced inside
 * runGroup: while it's on, the message goes only to the saved test number.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAnantyaConfigured()) return NextResponse.json({ error: "ANANTYA_API_KEY is not set on this server." }, { status: 503 });

  let body: { group?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isGroupKey(body.group)) return NextResponse.json({ error: "Unknown group" }, { status: 400 });

  const userId = session.user.id === "super-admin" ? null : session.user.id;
  try {
    const result = await runGroup(body.group, { trigger: "manual", userId });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 500 });
  }
}
