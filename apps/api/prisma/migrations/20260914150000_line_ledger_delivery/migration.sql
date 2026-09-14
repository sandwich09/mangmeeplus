CREATE TYPE "LineLedgerDeliveryStatus" AS ENUM ('PREPARING', 'READY', 'UNKNOWN', 'ACCEPTED', 'REFUSED', 'PARKED');
CREATE TABLE "LineLedgerDelivery" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "webhookEventId" TEXT NOT NULL, "entryId" TEXT NOT NULL,
  "status" "LineLedgerDeliveryStatus" NOT NULL DEFAULT 'PREPARING',
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL,
  "messagesJson" JSONB, "authorizationJson" JSONB, "completionJson" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0, "acceptedAt" TIMESTAMP(3), "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineLedgerDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LineLedgerDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LineLedgerDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LineLedgerDelivery_companyId_status_createdAt_idx" ON "LineLedgerDelivery"("companyId", "status", "createdAt");
CREATE INDEX "LineLedgerDelivery_createdAt_idx" ON "LineLedgerDelivery"("createdAt");
