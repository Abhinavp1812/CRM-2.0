-- CreateTable
CREATE TABLE "WhatsAppMessage" (
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
CREATE TABLE "WhatsAppOptOut" (
    "customerId" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppOptOut_pkey" PRIMARY KEY ("customerId")
);

-- CreateIndex
CREATE INDEX "WhatsAppMessage_customerId_createdAt_idx" ON "WhatsAppMessage"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppOptOut" ADD CONSTRAINT "WhatsAppOptOut_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

