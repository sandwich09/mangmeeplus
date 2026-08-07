CREATE TYPE "ExpenseCashEvidencePolicy" AS ENUM (
  'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
  'ALLOW_SUPPORTING_EVIDENCE_ONLY'
);

CREATE TABLE "ExpenseSubstituteReceiptPolicy" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "approverUserIds" JSONB NOT NULL,
  "cashEvidencePolicy" "ExpenseCashEvidencePolicy" NOT NULL DEFAULT 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE',
  "cashEvidenceInstructions" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExpenseSubstituteReceiptPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptPolicy_companyId_key"
  ON "ExpenseSubstituteReceiptPolicy"("companyId");

CREATE INDEX "ExpenseSubstituteReceiptPolicy_companyId_updatedAt_idx"
  ON "ExpenseSubstituteReceiptPolicy"("companyId", "updatedAt");

ALTER TABLE "ExpenseSubstituteReceiptPolicy"
  ADD CONSTRAINT "ExpenseSubstituteReceiptPolicy_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
