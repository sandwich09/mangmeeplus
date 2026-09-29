-- Sales-event discounts, SD-A (docs/specs/sales-event-discounts-spec-th.md §6.1; plan SD-A).
-- Additive only: four new tables, their indexes, CHECKs and two partial unique indexes.
-- States are TEXT, not enums (SD-T5). Prisma cannot model the CHECKs or the partial uniques, so
-- schema.prisma names them in comments — do NOT let a future `prisma migrate diff` drop them.

-- CreateTable
CREATE TABLE "SalesEventBatch" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "discountSatang" INTEGER NOT NULL,
    "rewardChatCreditUnits" INTEGER NOT NULL DEFAULT 0,
    "rewardReceiptImageUnits" INTEGER NOT NULL DEFAULT 0,
    "issueCap" INTEGER NOT NULL,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "claimStartsAt" TIMESTAMP(3) NOT NULL,
    "claimEndsAt" TIMESTAMP(3) NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesEventBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesEventBatch_state_check" CHECK ("state" IN ('OPEN', 'PAUSED', 'SUSPENDED')),
    -- Whole baht and whole AI credits (SED-39), never negative, and at least one reward (spec §3.1).
    CONSTRAINT "SalesEventBatch_reward_check" CHECK (
      "discountSatang" >= 0 AND "discountSatang" % 100 = 0
      AND "rewardChatCreditUnits" >= 0 AND "rewardChatCreditUnits" % 100 = 0
      AND "rewardReceiptImageUnits" >= 0
      AND ("discountSatang" > 0 OR "rewardChatCreditUnits" > 0 OR "rewardReceiptImageUnits" > 0)
    ),
    -- The cap is a database fact, so concurrent claims can never hand out one ticket too many.
    CONSTRAINT "SalesEventBatch_issue_check" CHECK ("issueCap" >= 1 AND "issuedCount" >= 0 AND "issuedCount" <= "issueCap"),
    CONSTRAINT "SalesEventBatch_window_check" CHECK ("claimEndsAt" > "claimStartsAt")
);

-- CreateTable
CREATE TABLE "SalesEventBatchAgent" (
    "batchId" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedByUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SalesEventBatchAgent_pkey" PRIMARY KEY ("batchId","salesUserId")
);

-- CreateTable
CREATE TABLE "SalesEventQrToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "batchRevision" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesEventQrToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesEventTicket" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "batchRevision" INTEGER NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "holderProvider" TEXT NOT NULL DEFAULT 'LINE',
    "holderChannelId" TEXT NOT NULL,
    "holderProviderUserId" TEXT NOT NULL,
    "discountSatang" INTEGER NOT NULL,
    "rewardChatCreditUnits" INTEGER NOT NULL,
    "rewardReceiptImageUnits" INTEGER NOT NULL,
    "scopeJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ISSUED',
    "redeemedAs" TEXT,
    "companyId" TEXT,
    "attemptId" TEXT,
    "invoiceId" TEXT,
    "appliedDiscountSatang" INTEGER,
    "claimRequestKey" TEXT NOT NULL,
    "redeemRequestKey" TEXT,
    "reservedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesEventTicket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesEventTicket_amounts_check" CHECK (
      "discountSatang" >= 0 AND "rewardChatCreditUnits" >= 0 AND "rewardReceiptImageUnits" >= 0
      AND ("appliedDiscountSatang" IS NULL OR "appliedDiscountSatang" >= 0)
    ),
    -- Spec §6.3: an unused ticket is bound to no shop; a reservation is always a first-bill discount
    -- held by one Checkout attempt; a used ticket names its shop and the way it was used.
    CONSTRAINT "SalesEventTicket_state_check" CHECK (
      ("state" IN ('ISSUED', 'REVOKED') AND "redeemedAs" IS NULL AND "companyId" IS NULL
        AND "attemptId" IS NULL AND "invoiceId" IS NULL AND "appliedDiscountSatang" IS NULL)
      OR ("state" = 'RESERVED' AND "redeemedAs" = 'DISCOUNT' AND "companyId" IS NOT NULL AND "attemptId" IS NOT NULL)
      OR ("state" = 'USED' AND "redeemedAs" IN ('DISCOUNT', 'CREDIT') AND "companyId" IS NOT NULL)
    ),
    CONSTRAINT "SalesEventTicket_revoke_check" CHECK (
      "state" <> 'REVOKED' OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "revokeReason" IS NOT NULL)
    )
);

-- CreateIndex
CREATE INDEX "SalesEventBatch_state_claimEndsAt_idx" ON "SalesEventBatch"("state", "claimEndsAt");

-- CreateIndex
CREATE INDEX "SalesEventBatchAgent_salesUserId_active_idx" ON "SalesEventBatchAgent"("salesUserId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEventQrToken_tokenHash_key" ON "SalesEventQrToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SalesEventQrToken_batchId_expiresAt_idx" ON "SalesEventQrToken"("batchId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEventTicket_serial_key" ON "SalesEventTicket"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEventTicket_attemptId_key" ON "SalesEventTicket"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEventTicket_invoiceId_key" ON "SalesEventTicket"("invoiceId");

-- CreateIndex
CREATE INDEX "SalesEventTicket_holderChannelId_holderProviderUserId_state_idx" ON "SalesEventTicket"("holderChannelId", "holderProviderUserId", "state");

-- CreateIndex
CREATE INDEX "SalesEventTicket_companyId_state_idx" ON "SalesEventTicket"("companyId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "SalesEventTicket_batchId_holderChannelId_holderProviderUser_key" ON "SalesEventTicket"("batchId", "holderChannelId", "holderProviderUserId");

-- CreateIndex (partial) — SD-O5: one first-bill discount per shop for its whole life. A reservation
-- holds the slot until Checkout releases it.
CREATE UNIQUE INDEX "SalesEventTicket_company_discount_key" ON "SalesEventTicket"("companyId") WHERE "state" IN ('RESERVED', 'USED') AND "redeemedAs" = 'DISCOUNT';

-- CreateIndex (partial) — SD-Q8 default: one ticket per shop per batch, whichever way it is used.
CREATE UNIQUE INDEX "SalesEventTicket_batch_company_key" ON "SalesEventTicket"("batchId", "companyId") WHERE "state" IN ('RESERVED', 'USED');

-- AddForeignKey
ALTER TABLE "SalesEventBatchAgent" ADD CONSTRAINT "SalesEventBatchAgent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalesEventBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEventQrToken" ADD CONSTRAINT "SalesEventQrToken_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalesEventBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEventTicket" ADD CONSTRAINT "SalesEventTicket_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SalesEventBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
