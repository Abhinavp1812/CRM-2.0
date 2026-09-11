import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: {
    customerId?: string;
    remark?: string;
    leadTemperature?: string;
    note?: string;
    nextFollowupDate?: string; // ISO date string
    flagDnc?: boolean;
    dncReason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerId, remark, leadTemperature, note, nextFollowupDate, flagDnc, dncReason } = body;
  if (!customerId) {
    return NextResponse.json({ error: "Missing customerId" }, { status: 400 });
  }
  if (!remark) {
    return NextResponse.json({ error: "Remark is required" }, { status: 400 });
  }
  if (leadTemperature !== "HOT" && leadTemperature !== "WARM" && leadTemperature !== "COLD") {
    return NextResponse.json({ error: "Lead temperature (Hot/Warm/Cold) is required" }, { status: 400 });
  }
  const temperature: "HOT" | "WARM" | "COLD" = leadTemperature;

  // Load remark option to check rules
  const remarkOption = await prisma.remarkOption.findUnique({
    where: { label: remark },
  });
  if (!remarkOption || !remarkOption.isActive) {
    return NextResponse.json({ error: `Unknown remark: ${remark}` }, { status: 400 });
  }

  // Resolve DNC flag (rule: Invalid Number auto-flags)
  const shouldFlagDnc = flagDnc || remarkOption.autoFlagDnc;
  const dncReasonResolved = dncReason || (remarkOption.autoFlagDnc ? remark : null);

  // Locked rule: every save requires next-followup-date OR DNC OR closes-followup remark
  if (!shouldFlagDnc && !remarkOption.closesFollowup && !nextFollowupDate) {
    return NextResponse.json(
      {
        error:
          "Either set a next follow-up date OR mark Do Not Contact. No customer can be left without a next step.",
      },
      { status: 400 }
    );
  }

  // Verify customer exists and the user owns it (or is admin)
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { followup: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const isOwner = customer.ownerId === userId;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "You don't own this customer" }, { status: 403 });
  }

  const now = new Date();
  // Parse nextFollowupDate (YYYY-MM-DD) as a date-only UTC value to avoid timezone shifts
  let newDate: Date | null = null;
  if (nextFollowupDate) {
    const m = nextFollowupDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    newDate = new Date(Date.UTC(y, mo - 1, d));
  }

  // Transaction: update everything atomically
  await prisma.$transaction(async (tx) => {
    // 1. Update or create follow-up record
    if (shouldFlagDnc || remarkOption.closesFollowup) {
      // No future follow-up needed — delete the row entirely
      await tx.followup.deleteMany({ where: { customerId } });
    } else if (newDate) {
      await tx.followup.upsert({
        where: { customerId },
        update: {
          nextFollowupDate: newDate,
          currentRemark: remark,
          currentNote: note || null,
          leadTemperature: temperature,
          lastContactedAt: now,
          lastContactedById: userId,
          updatedById: userId,
        },
        create: {
          customerId,
          nextFollowupDate: newDate,
          currentRemark: remark,
          currentNote: note || null,
          leadTemperature: temperature,
          lastContactedAt: now,
          lastContactedById: userId,
          updatedById: userId,
        },
      });
    }

    // 2. Apply DNC if requested
    if (shouldFlagDnc && !customer.doNotContact) {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          doNotContact: true,
          doNotContactReason: dncReasonResolved,
          doNotContactSetAt: now,
          doNotContactSetBy: userId,
        },
      });
      await tx.activityLog.create({
        data: {
          customerId,
          userId,
          activityType: "DNC_FLAGGED",
          note: dncReasonResolved,
        },
      });
    }

    // 3. Log the remark itself
    await tx.activityLog.create({
      data: {
        customerId,
        userId,
        activityType: "REMARK_ADDED",
        remark,
        leadTemperature: temperature,
        note: note || null,
        newValue: newDate ? newDate.toISOString() : null,
      },
    });

    // 4. If date was set, log a separate FOLLOWUP_DATE_CHANGED event
    if (newDate && customer.followup) {
      const oldDate = customer.followup.nextFollowupDate.toISOString();
      const newDateIso = newDate.toISOString();
      if (oldDate !== newDateIso) {
        await tx.activityLog.create({
          data: {
            customerId,
            userId,
            activityType: "FOLLOWUP_DATE_CHANGED",
            oldValue: oldDate,
            newValue: newDateIso,
          },
        });
      }
    }
  });

  return NextResponse.json({ success: true });
}