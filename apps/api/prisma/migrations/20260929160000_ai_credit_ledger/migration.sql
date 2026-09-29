-- AI credit cycles and lots (chat credit and receipt image add-on plan, PR C; spec §5.1–§5.3, §8.2, §11).
--
-- Additive only: two new tables and two nullable columns. Nothing is backfilled. A company changes
-- behaviour only once the cutover tool (plan PR G) sets "aiCreditCutoverAt"; until then every
-- company keeps today's calendar-month metering, and an OLD binary never reads or writes any of this.

ALTER TABLE "CompanyAiConfiguration" ADD COLUMN "aiCreditCutoverAt" TIMESTAMP(3),
ADD COLUMN "aiCreditCutoverSource" TEXT;

-- One lot of AI credit. Units are 0.01 credit = 1 satang of CHAT cost, never negative.
CREATE TABLE "AiCreditGrant" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "billingAccountId" TEXT,
    "sourceKind" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cycleKey" TEXT,
    "cycleState" TEXT,
    "allowanceSource" TEXT,
    "invoiceId" TEXT,
    "operationId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreditGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiCreditGrant_sourceKind_check"
      CHECK ("sourceKind" IN ('INCLUDED_CYCLE', 'ADD_ON_PAID', 'ADD_ON_ADMIN', 'SALES_EVENT')),
    CONSTRAINT "AiCreditGrant_cycleState_check" CHECK ("cycleState" IN ('PAID', 'RENEWAL_PENDING', 'CLOSED')),
    CONSTRAINT "AiCreditGrant_units_check" CHECK ("units" >= 0)
);

-- Append-only ledger of a lot. A RESERVE entry counts only while its reservation is live, so a
-- cancelled or released hold frees credit without a second write that could be missed.
CREATE TABLE "AiCreditEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "reservationId" TEXT,
    "operationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiCreditEntry_kind_check"
      CHECK ("kind" IN ('RESERVE', 'CONSUME', 'RELEASE', 'CORRECTION', 'FREEZE', 'UNFREEZE', 'REVOKE'))
);

CREATE UNIQUE INDEX "AiCreditGrant_sourceKey_key" ON "AiCreditGrant"("sourceKey");
CREATE INDEX "AiCreditGrant_companyId_sourceKind_expiresAt_idx" ON "AiCreditGrant"("companyId", "sourceKind", "expiresAt");
CREATE UNIQUE INDEX "AiCreditEntry_operationKey_key" ON "AiCreditEntry"("operationKey");
CREATE INDEX "AiCreditEntry_grantId_kind_idx" ON "AiCreditEntry"("grantId", "kind");
CREATE INDEX "AiCreditEntry_reservationId_idx" ON "AiCreditEntry"("reservationId");

ALTER TABLE "AiCreditGrant" ADD CONSTRAINT "AiCreditGrant_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCreditEntry" ADD CONSTRAINT "AiCreditEntry_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AiCreditGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
