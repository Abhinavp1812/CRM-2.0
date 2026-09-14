import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { startOfTodayIST } from "@/lib/formatDate";

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const userId = session.user.id;

  let body: { customerId?: string; clearDnc?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { customerId, clearDnc } = body;
  if (!customerId) {
    return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const today = startOfTodayIST();

  await prisma.$transaction(async (tx) => {
    // Clear DNC if requested or if customer is DNC
    if (clearDnc || customer.doNotContact) {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          doNotContact: false,
          doNotContactReason: null,
          doNotContactSetAt: null,
          doNotContactSetBy: null,
        },
      });
      await tx.activityLog.create({
        data: {
          customerId,
          userId,
          activityType: "DNC_UNFLAGGED",
          note: "Re-opened via admin re-engagement workflow",
        },
      });
    }

    // Create a fresh followup record (or update if somehow exists)
    await tx.followup.upsert({
      where: { customerId },
      update: {
        nextFollowupDate: today,
        currentRemark: null,
        currentNote: null,
        lastContactedAt: null,
        lastContactedById: null,
        updatedById: userId,
      },
      create: {
        customerId,
        nextFollowupDate: today,
        updatedById: userId,
      },
    });

    // Activity log entry
    await tx.activityLog.create({
      data: {
        customerId,
        userId,
        activityType: "FOLLOWUP_DATE_CHANGED",
        oldValue: null,
        newValue: today.toISOString(),
        note: "Followup re-opened by admin",
      },
    });
  });

  return NextResponse.json({ success: true });
}
