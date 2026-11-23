import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateBatch, deleteBatch, loadBatchHistory } from "@/lib/whatsappNudges";

export const maxDuration = 60;

/** "Generate nudges for today": the next batch from every list (admin only). Sends nothing. */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id === "super-admin" ? null : session.user.id;
  try {
    return NextResponse.json(await generateBatch(userId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

/** Undo the LATEST batch only (made by mistake) - its customers go back in the queue. */
export async function DELETE(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const at = new URL(req.url).searchParams.get("at");
  if (!at || isNaN(Date.parse(at))) return NextResponse.json({ error: "Missing batch time" }, { status: 400 });
  try {
    const [latest] = await loadBatchHistory(1);
    if (!latest || latest.at.getTime() !== Date.parse(at)) return NextResponse.json({ error: "Only the latest batch can be undone." }, { status: 400 });
    return NextResponse.json({ removed: await deleteBatch(latest.at) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
