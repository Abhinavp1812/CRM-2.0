import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

/**
 * Bulk-reschedule when a batch of already-existing customers next shows up
 * in their agent's followup queue. Only touches nextFollowupDate - remark,
 * note, and lastContactedAt are left exactly as they are, so an untouched
 * lead is still untouched (and eligible for the "New" badge) once its date
 * arrives, and an already-worked customer keeps its history.
 *
 * DNC customers and customers with no active followup (closed) are skipped -
 * those go through the dedicated unflag / reopen flows instead, which also
 * handle the DNC/remark reset logic this endpoint deliberately does not.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { customerIds?: string[]; date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { customerIds, date } = body;
  if (!Array.isArray(customerIds) || customerIds.length === 0) {
    return NextResponse.json({ error: "No customers selected" }, { status: 400 });
  }
  if (customerIds.length > 20000) {
    return NextResponse.json({ error: "Too many customers selected at once" }, { status: 400 });
  }
  const parsedDate = date ? new Date(date) : null;
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: "Missing or invalid date" }, { status: 400 });
  }
  parsedDate.setHours(0, 0, 0, 0);

  let actingUserId: string | null = session.user.id === "super-admin" ? null : session.user.id;
  if (session.user.id === "super-admin") {
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", deletedAt: null } });
    actingUserId = adminUser?.id ?? null;
  }

  // Only customers with an active followup and not flagged DNC are eligible.
  const eligible = await prisma.customer.findMany({
    where: {
      id: { in: customerIds },
      deletedAt: null,
      doNotContact: false,
      followup: { isNot: null },
    },
    select: { id: true, followup: { select: { nextFollowupDate: true } } },
  });

  const skippedCount = customerIds.length - eligible.length;

  if (eligible.length > 0) {
    const updateData = eligible.map((c) => ({ cid: c.id, fd: parsedDate.toISOString() }));
    for (let i = 0; i < updateData.length; i += 2000) {
      const chunk = updateData.slice(i, i + 2000);
      await prisma.$executeRaw`
        UPDATE "Followup" f
        SET
          "nextFollowupDate" = (v->>'fd')::timestamptz,
          "updatedById" = ${actingUserId},
          "updatedAt" = NOW()
        FROM json_array_elements(${JSON.stringify(chunk)}::json) AS v
        WHERE f."customerId" = v->>'cid'
      `;
    }

    for (let i = 0; i < eligible.length; i += 2000) {
      const chunk = eligible.slice(i, i + 2000);
      await prisma.activityLog.createMany({
        data: chunk.map((c) => ({
          customerId: c.id,
          userId: actingUserId,
          activityType: "FOLLOWUP_DATE_CHANGED" as const,
          oldValue: c.followup?.nextFollowupDate?.toISOString() ?? null,
          newValue: parsedDate.toISOString(),
          note: "Bulk-scheduled by admin",
        })),
      });
    }
  }

  return NextResponse.json({ success: true, updatedCount: eligible.length, skippedCount });
}
