import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { agentId } = await req.json();
  if (!agentId) return NextResponse.json({ error: "Missing agentId" }, { status: 400 });

  const [customer, agent] = await Promise.all([
    prisma.customer.findUnique({ where: { id }, include: { owner: { select: { name: true } } } }),
    prisma.user.findUnique({ where: { id: agentId } }),
  ]);

  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (!agent || agent.role !== "AGENT" || agent.deletedAt) {
    return NextResponse.json({ error: "Invalid agent" }, { status: 400 });
  }
  if (customer.ownerId === agentId) {
    return NextResponse.json({ success: true });
  }

  let actingUserId: string | null = session.user.id === "super-admin" ? null : session.user.id;
  if (session.user.id === "super-admin") {
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN", deletedAt: null } });
    actingUserId = adminUser?.id ?? null;
  }

  await prisma.$transaction([
    prisma.customer.update({ where: { id }, data: { ownerId: agentId } }),
    prisma.activityLog.create({
      data: {
        customerId: id,
        userId: actingUserId,
        activityType: "OWNER_CHANGED",
        oldValue: customer.owner?.name || customer.ownerId || "unknown",
        newValue: agent.name,
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
