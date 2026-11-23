-- WhatsApp nudges (Anantya.ai): message log + opt-outs.
-- Written to be idempotent (IF NOT EXISTS / guarded constraints) because the
-- same statements can also be applied from Admin > WhatsApp ("Create WhatsApp
-- tables now", src/lib/whatsappSchema.ts). Only adds; never alters existing data.

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
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
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppOptOut" (
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppOptOut_pkey" PRIMARY KEY ("customerId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_customerId_createdAt_idx" ON "WhatsAppMessage"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppMessage_customerId_fkey') THEN
    ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WhatsAppOptOut_customerId_fkey') THEN
    ALTER TABLE "WhatsAppOptOut" ADD CONSTRAINT "WhatsAppOptOut_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
