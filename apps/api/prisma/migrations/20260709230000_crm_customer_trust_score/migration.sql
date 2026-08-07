-- AlterTable
ALTER TABLE "CrmCustomer" ADD COLUMN "trustScore" INTEGER,
ADD COLUMN "trustScoreFactorsJson" JSONB,
ADD COLUMN "trustScoreComputedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CrmCustomer_trustScoreComputedAt_idx" ON "CrmCustomer"("trustScoreComputedAt");
