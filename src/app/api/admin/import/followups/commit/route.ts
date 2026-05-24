import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseFile, getField } from "@/lib/parseFile";
import { normalizePhone, parseFlexibleDate, cleanString } from "@/lib/normalize";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id || (session.user.role !== "ADMIN" && session.user.id !== "super-admin")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const sheetName = formData.get("sheetName") as string | null;
    if (!file || !sheetName) {
      return NextResponse.json({ error: "Missing file or sheetName" }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const workbook = await parseFile(buffer, file.name);
    const sheet = workbook.sheets.find((s) => s.sheetName === sheetName);
    if (!sheet) return NextResponse.json({ error: "Sheet not found" }, { status: 400 });

    // Pre-load everything in 2 parallel queries
    const [agents, allCustomers] = await Promise.all([
      prisma.user.findMany({
        where: { role: "AGENT", isActive: true, deletedAt: null },
        select: { id: true, name: true },
      }),
      prisma.customer.findMany({
        select: { id: true, phone: true, ownerId: true },
      }),
    ]);

    const agentByName = new Map(agents.map((a) => [a.name.trim().toLowerCase(), a.id]));
    const customerByPhone = new Map(allCustomers.map((c) => [c.phone, c]));

    // Find the most recent date from date-stamped remark columns (e.g. "Remarks 23-05-2026")
    const remarkDatePattern = /^remarks\s+(\d{2}-\d{2}-\d{4})$/i;
    function findLastContactDate(row: Record<string, unknown>): { date: Date; remark: string | null; note: string | null } | null {
      let best: { date: Date; remark: string | null; note: string | null } | null = null;
      for (const [key, value] of Object.entries(row)) {
        const match = key.trim().match(remarkDatePattern);
        if (!match) continue;
        const parsed = parseFlexibleDate(match[1]);
        if (!parsed) continue;
        const remarkVal = cleanString(value) || null;
        // Count a column only if it has a non-empty remark value
        if (!remarkVal) continue;
        if (!best || parsed.getTime() > best.date.getTime()) {
          // Find corresponding Detailed Remarks column for the same date
          const detailKey = Object.keys(row).find(
            (k) => /^detailed\s+remarks\s+/i.test(k) && k.trim().toLowerCase().endsWith(match[1].toLowerCase())
          );
          const noteVal = detailKey ? (cleanString(row[detailKey]) || null) : null;
          best = { date: parsed, remark: remarkVal, note: noteVal };
        }
      }
      return best;
    }

    type ParsedRow = {
      customerId: string;
      currentOwnerId: string | null;
      newOwnerId: string | null;
      followupDate: Date;
      remark: string | null;
      note: string | null;
      lastContactDate: Date | null;
    };

    const parsed: ParsedRow[] = [];
    let skippedCount = 0;
    const errors: { row: number; reason: string; data: Record<string, unknown> }[] = [];

    for (let i = 0; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const rowNum = i + 2;

      const phone = normalizePhone(getField(row, "Contact Number", "Phone", "phone", "contact number"));
      if (!phone) {
        errors.push({ row: rowNum, reason: "Missing or invalid phone number", data: row });
        skippedCount++;
        continue;
      }

      const customer = customerByPhone.get(phone);
      if (!customer) {
        errors.push({ row: rowNum, reason: `Customer not found for phone ${phone}`, data: row });
        skippedCount++;
        continue;
      }

      const ownerName = cleanString(getField(row, "Owner", "owner", "Agent", "agent"));
      const nextFollowupRaw = getField(row, "Next Follow Up date", "Next Followup Date", "Next Follow Up Date", "followup date", "Next_Follow_Up_date");

      // Use date-stamped remark columns to find the most recent contact
      const lastContact = findLastContactDate(row);

      // Fall back to the plain Remarks/Note columns if no dated ones found
      const remark = lastContact?.remark ?? cleanString(getField(row, "Remarks", "remark", "Last Remark")) ?? null;
      const note = lastContact?.note ?? cleanString(getField(row, "Detailed Remarks", "detailed remarks", "Note", "notes", "detailed_remarks")) ?? null;

      parsed.push({
        customerId: customer.id,
        currentOwnerId: customer.ownerId,
        newOwnerId: ownerName ? (agentByName.get(ownerName.trim().toLowerCase()) ?? null) : null,
        followupDate: parseFlexibleDate(nextFollowupRaw) ?? new Date(),
        remark: remark || null,
        note: note || null,
        lastContactDate: lastContact?.date ?? null,
      });
    }

    // Pre-load existing followups for all matched customers
    const customerIds = parsed.map((p) => p.customerId);
    const existingFollowups = await prisma.followup.findMany({
      where: { customerId: { in: customerIds } },
      select: { customerId: true, currentRemark: true, currentNote: true, lastContactedAt: true },
    });
    const followupByCustomer = new Map(existingFollowups.map((f) => [f.customerId, f]));

    const toCreate = parsed.filter((p) => !followupByCustomer.has(p.customerId));
    const toUpdate = parsed.filter((p) => followupByCustomer.has(p.customerId));
    const ownerChanges = parsed.filter((p) => p.newOwnerId && p.newOwnerId !== p.currentOwnerId);

    // Single bulk SQL UPDATE for all followup updates
    if (toUpdate.length > 0) {
      const updateData = toUpdate.map((p) => {
        const ex = followupByCustomer.get(p.customerId)!;
        // Use the most recent date from dated remark columns; fall back to existing DB value
        const lcDate = p.lastContactDate ?? ex.lastContactedAt ?? null;
        return {
          cid: p.customerId,
          fd: p.followupDate.toISOString(),
          r: p.remark || ex.currentRemark || null,
          n: p.note || ex.currentNote || null,
          lc: lcDate ? lcDate.toISOString() : null,
        };
      });
      await prisma.$executeRaw`
        UPDATE "Followup" f
        SET
          "nextFollowupDate" = (v->>'fd')::timestamptz,
          "currentRemark"    = v->>'r',
          "currentNote"      = v->>'n',
          "lastContactedAt"  = (v->>'lc')::timestamptz,
          "updatedAt"        = NOW()
        FROM json_array_elements(${JSON.stringify(updateData)}::json) AS v
        WHERE f."customerId" = v->>'cid'
      `;
    }

    // Bulk create new followups
    if (toCreate.length > 0) {
      await prisma.followup.createMany({
        data: toCreate.map((p) => ({
          customerId: p.customerId,
          nextFollowupDate: p.followupDate,
          currentRemark: p.remark,
          currentNote: p.note,
          lastContactedAt: p.lastContactDate ?? null,
        })),
        skipDuplicates: true,
      });
    }

    // Single bulk SQL UPDATE for owner changes
    if (ownerChanges.length > 0) {
      const ownerData = ownerChanges.map((p) => ({ cid: p.customerId, oid: p.newOwnerId }));
      await prisma.$executeRaw`
        UPDATE "Customer" c
        SET "ownerId" = v->>'oid', "updatedAt" = NOW()
        FROM json_array_elements(${JSON.stringify(ownerData)}::json) AS v
        WHERE c.id = v->>'cid'
      `;
    }

    return NextResponse.json({
      success: true,
      totalRows: sheet.rows.length,
      updatedCount: toUpdate.length,
      createdCount: toCreate.length,
      ownerUpdatedCount: ownerChanges.length,
      skippedCount,
      errorCount: errors.length,
      errors,
    });
  } catch (err) {
    console.error("[followups/commit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
