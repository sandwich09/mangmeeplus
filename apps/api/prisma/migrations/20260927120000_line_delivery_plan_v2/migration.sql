CREATE TABLE "LineDeliveryPlan" (
 "id" TEXT NOT NULL PRIMARY KEY, "outcomeId" TEXT, "ledgerDeliveryId" TEXT, "outboxEventId" TEXT, "companyId" TEXT, "userId" TEXT,
 "version" INTEGER NOT NULL DEFAULT 2, "planJson" JSONB NOT NULL, "planHash" TEXT NOT NULL, "batchStateJson" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'READY', "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL, "purgeAt" TIMESTAMP(3) NOT NULL,
 "acceptedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "cancelReason" TEXT, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LineDeliveryPlan_owner_check" CHECK (num_nonnulls("outcomeId", "ledgerDeliveryId", "outboxEventId") = 1),
 CONSTRAINT "LineDeliveryPlan_version_check" CHECK ("version" = 2),
 CONSTRAINT "LineDeliveryPlan_hash_check" CHECK ("id" ~ '^[0-9a-f]{64}$' AND "planHash" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "LineDeliveryPlan_status_check" CHECK ("status" IN ('READY','UNKNOWN','WAITING_CONTINUATION','ACCEPTED','CANCELLED','REFUSED','EXPIRED')),
 CONSTRAINT "LineDeliveryPlan_size_check" CHECK (octet_length("planJson"::text) <= 262144),
 CONSTRAINT "LineDeliveryPlan_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "LineTurnOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LineDeliveryPlan_ledgerDeliveryId_fkey" FOREIGN KEY ("ledgerDeliveryId") REFERENCES "LineLedgerDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LineDeliveryPlan_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LineDeliveryPlan_outcomeId_key" ON "LineDeliveryPlan"("outcomeId");
CREATE UNIQUE INDEX "LineDeliveryPlan_ledgerDeliveryId_key" ON "LineDeliveryPlan"("ledgerDeliveryId");
CREATE UNIQUE INDEX "LineDeliveryPlan_outboxEventId_key" ON "LineDeliveryPlan"("outboxEventId");
CREATE INDEX "LineDeliveryPlan_status_nextAttemptAt_expiresAt_idx" ON "LineDeliveryPlan"("status","nextAttemptAt","expiresAt");
CREATE INDEX "LineDeliveryPlan_purgeAt_idx" ON "LineDeliveryPlan"("purgeAt");
CREATE INDEX "LineDeliveryPlan_companyId_userId_createdAt_idx" ON "LineDeliveryPlan"("companyId","userId","createdAt");
