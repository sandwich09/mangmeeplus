-- Sales credit taken back, owner decisions 2026-10-02 (sales spec §17.1, RB-37).
-- Additive only: one new table, its indexes and two CHECKs. Nothing existing is altered and
-- nothing is back-filled — "SalesAttribution"."refundedSatang" keeps the cumulative, undated
-- refund that older rows already carry, and the report goes on deducting it in the payment month.
-- From here on a refund that succeeded, or a payment dispute that was lost, is one row here: the
-- provider's own id (unique, so observing it twice deducts once), the provider's time, and the
-- time this system recorded it, which is the month the report deducts it in.
-- Prisma cannot model the CHECKs, so schema.prisma names them in a comment — do NOT let a future
-- `prisma migrate diff` drop them.

-- CreateTable
CREATE TABLE "SalesAttributionDeduction" (
    "id" TEXT NOT NULL,
    "attributionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "amountSatang" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAttributionDeduction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesAttributionDeduction_kind_check" CHECK ("kind" IN ('REFUND', 'DISPUTE')),
    CONSTRAINT "SalesAttributionDeduction_amount_check" CHECK ("amountSatang" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesAttributionDeduction_providerRef_key" ON "SalesAttributionDeduction"("providerRef");

-- CreateIndex
CREATE INDEX "SalesAttributionDeduction_createdAt_idx" ON "SalesAttributionDeduction"("createdAt");

-- CreateIndex
CREATE INDEX "SalesAttributionDeduction_attributionId_idx" ON "SalesAttributionDeduction"("attributionId");

-- AddForeignKey
ALTER TABLE "SalesAttributionDeduction" ADD CONSTRAINT "SalesAttributionDeduction_attributionId_fkey" FOREIGN KEY ("attributionId") REFERENCES "SalesAttribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
