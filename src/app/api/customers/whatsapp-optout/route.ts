import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Turn WhatsApp nudges off / on for one customer (their owner or an admin). */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { customerId?: string; optOut?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.customerId || typeof body.optOut !== "boolean") return NextResponse.json({ error: "Missing customerId / optOut" }, { status: 400 });

  const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true, ownerId: true } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const isAdmin = session.user.role === "ADMIN";
  if (!isAdmin && customer.ownerId !== session.user.id) return NextResponse.json({ error: "You don't own this customer" }, { status: 403 });

  const userId = session.user.id === "super-admin" ? null : session.user.id;
  if (body.optOut) {
    await prisma.whatsAppOptOut.upsert({
      where: { customerId: customer.id },
      update: {},
      create: { customerId: customer.id, createdById: userId, reason: "Marked in CRM" },
    });
  } else {
    await prisma.whatsAppOptOut.deleteMany({ where: { customerId: customer.id } });
  }
  await prisma.activityLog.create({
    data: {
      customerId: customer.id,
      userId,
      activityType: "NOTE_ADDED",
      note: body.optOut ? "WhatsApp nudges turned OFF for this customer" : "WhatsApp nudges turned back ON for this customer",
    },
  });
  return NextResponse.json({ success: true, optOut: body.optOut });
}
