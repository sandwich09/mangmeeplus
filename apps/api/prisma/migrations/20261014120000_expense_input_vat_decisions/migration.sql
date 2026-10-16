CREATE TABLE "ExpenseInputVatDecision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "fromStatus" "InputVatClaimStatus" NOT NULL,
  "toStatus" "InputVatClaimStatus" NOT NULL,
  "reason" TEXT,
  "conditionsJson" JSONB NOT NULL,
  "evidenceAttachmentIds" TEXT[] NOT NULL,
  "decidedByUserId" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseInputVatDecision_expense_fkey" FOREIGN KEY ("companyId", "expenseId") REFERENCES "ExpenseRecord"("companyId", "id") ON DELETE CASCADE,
  CONSTRAINT "ExpenseInputVatDecision_reason_length" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 1 AND 500)
);
CREATE INDEX "ExpenseInputVatDecision_companyId_expenseId_decidedAt_idx" ON "ExpenseInputVatDecision"("companyId", "expenseId", "decidedAt");
