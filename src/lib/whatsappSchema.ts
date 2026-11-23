import { prisma } from "@/lib/prisma";

/**
 * The two WhatsApp tables, as idempotent SQL (safe to run any number of times).
 * Same statements as prisma/migrations/20261123120000_add_whatsapp_nudges, so
 * whichever runs first - this admin button or `prisma migrate deploy` on a
 * Vercel build - the other is a harmless no-op.
 */
export const WHATSAPP_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "phone" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "templateName" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "response" TEXT,
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "WhatsAppOptOut" (
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppOptOut_pkey" PRIMARY KEY ("customerId")
  )`,
  `CREATE INDEX IF NOT EXISTS "WhatsAppMessage_customerId_createdAt_idx" ON "WhatsAppMessage"("customerId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppMessage_customerId_fkey') THEN
      ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppOptOut_customerId_fkey') THEN
      ALTER TABLE "WhatsAppOptOut" ADD CONSTRAINT "WhatsAppOptOut_customerId_fkey"
        FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** Create the WhatsApp tables if they're missing. Only ever adds; never alters or drops anything. */
export async function ensureWhatsAppTables(): Promise<void> {
  for (const sql of WHATSAPP_SCHEMA_SQL) await prisma.$executeRawUnsafe(sql);
}
