import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function PATCH(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Extract id from URL to avoid runtime param access issues
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1];
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action } = body;
  if (!action) return NextResponse.json({ error: "Missing action" }, { status: 400 });

  if (action === "markOnLeave") {
    const { from, until } = body; // ISO strings or YYYY-MM-DD or null

    function parseDateOnly(input: string) {
      // Accept YYYY-MM-DD or any parseable ISO; return Date at UTC midnight
      const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        return new Date(Date.UTC(y, mo - 1, d));
      }
      const dt = new Date(input);
      return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }

    const fromDate = from ? parseDateOnly(from) : null;
    const untilDate = until ? parseDateOnly(until) : null;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { onLeaveFrom: fromDate, onLeaveUntil: untilDate } });

      // If both from and until provided, shift followups that fall within the leave window to the day after 'until' (return date)
      if (fromDate && untilDate) {
        // start = UTC midnight of fromDate
        const start = new Date(fromDate);
        start.setUTCHours(0, 0, 0, 0);
        // end = UTC end of untilDate
        const end = new Date(untilDate);
        end.setUTCHours(23, 59, 59, 999);

        // returnDate = day after untilDate (UTC midnight)
        const returnDate = new Date(untilDate);
        returnDate.setUTCDate(returnDate.getUTCDate() + 1);
        returnDate.setUTCHours(0, 0, 0, 0);

        const owned = await tx.customer.findMany({ where: { ownerId: id, deletedAt: null }, select: { id: true } });
        const ownedIds = owned.map((c) => c.id);
        if (ownedIds.length > 0) {
          await tx.followup.updateMany({ where: { customerId: { in: ownedIds }, nextFollowupDate: { gte: start, lte: end } }, data: { nextFollowupDate: returnDate } });
        }
      }
    });

    return NextResponse.json({ success: true });
  }

  if (action === "bringBack") {
    await prisma.user.update({ where: { id }, data: { onLeaveFrom: null, onLeaveUntil: null } });
    return NextResponse.json({ success: true });
  }

  if (action === "reassignCustomers") {
    // body: { destinationId?: string, roundRobin?: boolean }
    const { destinationId, roundRobin } = body;
    const owned = await prisma.customer.findMany({ where: { ownerId: id, deletedAt: null }, select: { id: true } });
    const ownedIds = owned.map((c) => c.id);

    if (ownedIds.length === 0) return NextResponse.json({ success: true, reassignCount: 0 });

    if (roundRobin) {
      // find active agents excluding this one
      const agents = await prisma.user.findMany({ where: { role: "AGENT", deletedAt: null, id: { not: id }, onLeaveFrom: null }, select: { id: true } });
      if (agents.length === 0) return NextResponse.json({ error: "No available agents to reassign" }, { status: 400 });

      // Balance to equalize loads: compute current counts and greedily assign owned customers to least-loaded agent
      const agentIds = agents.map((a) => a.id);
      const counts = await prisma.customer.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null }, _count: { _all: true } });
      const countBy: Record<string, number> = {};
      for (const r of counts) if (r.ownerId) countBy[r.ownerId] = r._count._all;

      const agentOrder = agentIds.map((id) => ({ id, count: countBy[id] || 0 }));
      const mapping: Record<string, string[]> = {};

      for (const cid of ownedIds) {
        // pick least-loaded agent
        agentOrder.sort((a, b) => a.count - b.count);
        const dest = agentOrder[0];
        mapping[dest.id] = mapping[dest.id] || [];
        mapping[dest.id].push(cid);
        dest.count++;
      }

      // perform batched updates per destination
      for (const destId of Object.keys(mapping)) {
        const idsToMove = mapping[destId];
        await prisma.customer.updateMany({ where: { id: { in: idsToMove } }, data: { ownerId: destId } });
      }

      return NextResponse.json({ success: true, reassignCount: ownedIds.length });
    }

    if (destinationId) {
      // ensure destination exists and is an agent
      const dest = await prisma.user.findUnique({ where: { id: destinationId } });
      if (!dest) return NextResponse.json({ error: "Destination user not found" }, { status: 404 });
      if (dest.role !== "AGENT") return NextResponse.json({ error: "Destination must be an agent" }, { status: 400 });
      await prisma.customer.updateMany({ where: { id: { in: ownedIds } }, data: { ownerId: destinationId } });
      return NextResponse.json({ success: true, reassignCount: ownedIds.length });
    }

    return NextResponse.json({ error: "Missing destinationId or roundRobin flag" }, { status: 400 });
  }

  if (action === "updateDetails") {
    const { name, email, password } = body;
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (email) {
      const emailNorm = String(email).toLowerCase().trim();
      const existing = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (existing && existing.id !== id) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      updates.email = emailNorm;
    }
    if (password) {
      const hash = await bcrypt.hash(String(password), 10);
      updates.passwordHash = hash;
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    await prisma.user.update({ where: { id }, data: updates });
    return NextResponse.json({ success: true });
  }

  if (action === "reassignWarmCold") {
    // Warm = customers that have been contacted at least once
    // Cold = customers that have never been contacted
    const { warmDestId, warmRoundRobin, coldDestId, coldRoundRobin } = body;

    const owned = await prisma.customer.findMany({
      where: { ownerId: id, deletedAt: null },
      select: { id: true, followup: { select: { lastContactedAt: true } } },
    });
    const warm = owned.filter((c) => c.followup?.lastContactedAt != null).map((c) => c.id);
    const cold = owned.filter((c) => c.followup?.lastContactedAt == null).map((c) => c.id);

    async function loadAgents() {
      const agents = await prisma.user.findMany({
        where: { role: "AGENT", deletedAt: null, id: { not: id }, onLeaveFrom: null },
        select: { id: true },
      });
      return agents;
    }

    async function roundRobinAssign(customerIds: string[]) {
      const agents = await loadAgents();
      if (agents.length === 0) return false;
      const agentIds = agents.map((a) => a.id);
      const counts = await prisma.customer.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null }, _count: { _all: true } });
      const countBy: Record<string, number> = {};
      for (const r of counts) if (r.ownerId) countBy[r.ownerId] = r._count._all;
      const agentOrder = agentIds.map((aid) => ({ id: aid, count: countBy[aid] || 0 }));
      const mapping: Record<string, string[]> = {};
      for (const cid of customerIds) {
        agentOrder.sort((a, b) => a.count - b.count);
        const dest = agentOrder[0];
        mapping[dest.id] = mapping[dest.id] || [];
        mapping[dest.id].push(cid);
        dest.count++;
      }
      for (const [destId, chunk] of Object.entries(mapping)) {
        await prisma.customer.updateMany({ where: { id: { in: chunk } }, data: { ownerId: destId } });
      }
      return true;
    }

    if (warm.length > 0) {
      if (warmDestId) {
        const dest = await prisma.user.findUnique({ where: { id: warmDestId } });
        if (!dest || dest.role !== "AGENT" || dest.deletedAt) {
          return NextResponse.json({ error: "Invalid warm destination agent" }, { status: 400 });
        }
        await prisma.customer.updateMany({ where: { id: { in: warm } }, data: { ownerId: warmDestId } });
      } else if (warmRoundRobin) {
        const ok = await roundRobinAssign(warm);
        if (!ok) return NextResponse.json({ error: "No available agents for warm customers" }, { status: 400 });
      }
    }

    if (cold.length > 0) {
      if (coldDestId) {
        const dest = await prisma.user.findUnique({ where: { id: coldDestId } });
        if (!dest || dest.role !== "AGENT" || dest.deletedAt) {
          return NextResponse.json({ error: "Invalid cold destination agent" }, { status: 400 });
        }
        await prisma.customer.updateMany({ where: { id: { in: cold } }, data: { ownerId: coldDestId } });
      } else if (coldRoundRobin) {
        const ok = await roundRobinAssign(cold);
        if (!ok) return NextResponse.json({ error: "No available agents for cold customers" }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true, warmMoved: warm.length, coldMoved: cold.length });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1];

  // parse optional body with reassign instructions
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const owned = await prisma.customer.findMany({ where: { ownerId: id, deletedAt: null }, select: { id: true } });
  const ownedIds = owned.map((c) => c.id);

  if (ownedIds.length > 0) {
    // if destinationId or roundRobin provided, perform reassign automatically
    const { destinationId, roundRobin } = body;
    if (destinationId || roundRobin) {
      if (roundRobin) {
        const agents = await prisma.user.findMany({ where: { role: "AGENT", deletedAt: null, id: { not: id }, onLeaveFrom: null }, select: { id: true } });
        if (agents.length === 0) return NextResponse.json({ error: "No available agents to reassign" }, { status: 400 });
        const agentIds = agents.map((a) => a.id);
        const counts = await prisma.customer.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null }, _count: { _all: true } });
        const countBy: Record<string, number> = {};
        for (const r of counts) if (r.ownerId) countBy[r.ownerId] = r._count._all;

        const agentOrder = agentIds.map((id) => ({ id, count: countBy[id] || 0 }));
        const mapping: Record<string, string[]> = {};
        for (const cid of ownedIds) {
          agentOrder.sort((a, b) => a.count - b.count);
          const dest = agentOrder[0];
          mapping[dest.id] = mapping[dest.id] || [];
          mapping[dest.id].push(cid);
          dest.count++;
        }
        for (const destId of Object.keys(mapping)) {
          await prisma.customer.updateMany({ where: { id: { in: mapping[destId] } }, data: { ownerId: destId } });
        }
      } else if (destinationId) {
        const dest = await prisma.user.findUnique({ where: { id: destinationId } });
        if (!dest) return NextResponse.json({ error: "Destination user not found" }, { status: 404 });
        if (dest.role !== "AGENT") return NextResponse.json({ error: "Destination must be an agent" }, { status: 400 });
        await prisma.customer.updateMany({ where: { id: { in: ownedIds } }, data: { ownerId: destinationId } });
      }
    } else {
      return NextResponse.json({ error: "Agent still owns customers; please reassign before deleting (or provide destinationId/roundRobin in request body)" }, { status: 400 });
    }
  }

  await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ success: true });
}
