import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureWhatsAppTables } from "@/lib/whatsappSchema";

export const maxDuration = 60;

/**
 * Admin-only: create the two WhatsApp tables (message log, opt-outs) if they're
 * missing. Idempotent - only "create if not exists"; never changes existing data.
 */
export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureWhatsAppTables();
    await prisma.whatsAppMessage.count();
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[whatsapp/setup-db]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
