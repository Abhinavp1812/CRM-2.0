import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { parseFile, normalizeHeader } from "@/lib/parseFile";
import { normalizePhone } from "@/lib/normalize";
import { createManyChunked, findManyChunked } from "@/lib/dbBatch";

export const maxDuration = 60;

/**
 * Tag existing customers with a campaign (lead source) from an uploaded
 * Excel/CSV list of phone numbers. Only customers already in the CRM are
 * tagged; numbers not found are reported back, never created.
 *
 * Send `confirm=false` first to get a preview (nothing is written), then the
 * same file with `confirm=true` to apply it. A customer already tagged with a
 * different campaign is switched to this one - the preview says how many.
 */

const PHONE_HEADER = /phone|mobile|contact|number|whatsapp/;

function extractPhones(rows: Record<string, unknown>[], headers: string[]) {
  const phoneCol = headers.find((h) => PHONE_HEADER.test(normalizeHeader(h))) ?? headers[0];
  const valid = new Set<string>();
  const invalid: string[] = [];
  for (const row of rows) {
    const raw = row[phoneCol];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const phone = normalizePhone(raw);
    if (phone) valid.add(phone);
    else invalid.push(String(raw).trim());
  }
  return { phoneCol, phones: Array.from(valid), invalid };
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload a file" }, { status: 400 });
  }
  const file = form.get("file") as File | null;
  const label = String(form.get("label") ?? "").trim();
  const confirm = form.get("confirm") === "true";
  if (!file) return NextResponse.json({ error: "Choose an Excel or CSV file" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "Choose or type a campaign name" }, { status: 400 });

  let rows: Record<string, unknown>[];
  let headers: string[];
  try {
    const wb = await parseFile(await file.arrayBuffer(), file.name);
    const sheet = wb.sheets.find((s) => s.rows.length > 0);
    if (!sheet) return NextResponse.json({ error: "The file has no rows" }, { status: 400 });
    rows = sheet.rows;
    headers = sheet.headers;
  } catch (e) {
    return NextResponse.json({ error: "Couldn't read the file: " + (e instanceof Error ? e.message : "unknown error") }, { status: 400 });
  }

  const { phoneCol, phones, invalid } = extractPhones(rows, headers);
  if (phones.length === 0) {
    return NextResponse.json({ error: `No valid 10-digit phone numbers found in column "${phoneCol}"` }, { status: 400 });
  }

  const customers = await findManyChunked(phones, (chunk) =>
    prisma.customer.findMany({
      where: { phone: { in: chunk }, deletedAt: null },
      select: { id: true, phone: true, leadSource: true },
    })
  );
  const found = new Set(customers.map((c) => c.phone));
  const notFound = phones.filter((p) => !found.has(p));
  const alreadyTagged = customers.filter((c) => c.leadSource === label);
  const toTag = customers.filter((c) => c.leadSource !== label);
  const switching = toTag.filter((c) => c.leadSource);
  const switchedFrom: Record<string, number> = {};
  for (const c of switching) switchedFrom[c.leadSource!] = (switchedFrom[c.leadSource!] ?? 0) + 1;

  const summary = {
    phoneColumn: phoneCol,
    rows: rows.length,
    validPhones: phones.length,
    invalidCount: invalid.length,
    invalidSamples: invalid.slice(0, 5),
    matched: customers.length,
    alreadyTagged: alreadyTagged.length,
    toTag: toTag.length,
    switching: switching.length,
    switchedFrom,
    notFound,
  };

  if (!confirm) return NextResponse.json({ preview: true, ...summary });

  // Make sure the campaign exists in the dropdown (re-activating it if it was turned off).
  const existing = await prisma.leadSourceOption.findUnique({ where: { label } });
  if (!existing) {
    const maxOrder = await prisma.leadSourceOption.aggregate({ _max: { sortOrder: true } });
    await prisma.leadSourceOption.create({ data: { label, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 } });
  } else if (!existing.isActive) {
    await prisma.leadSourceOption.update({ where: { id: existing.id }, data: { isActive: true } });
  }

  const userId = session.user.id === "super-admin" ? null : session.user.id;
  const ids = toTag.map((c) => c.id);
  const previousById = new Map(toTag.map((c) => [c.id, c.leadSource]));

  await createManyChunked(ids, (chunk) => prisma.customer.updateMany({ where: { id: { in: chunk } }, data: { leadSource: label } }));
  await createManyChunked(ids, (chunk) =>
    prisma.activityLog.createMany({
      data: chunk.map((id) => ({
        customerId: id,
        userId,
        activityType: "NOTE_ADDED" as const,
        oldValue: previousById.get(id) ?? null,
        newValue: label,
        note: `Lead source set to "${label}" (campaign import${previousById.get(id) ? `, was "${previousById.get(id)}"` : ""})`,
      })),
    })
  );

  return NextResponse.json({ preview: false, tagged: ids.length, ...summary });
}
