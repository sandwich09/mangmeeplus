CREATE TYPE "ExpensePaymentRecordStatus" AS ENUM ('RECORDED', 'VOIDED');

CREATE UNIQUE INDEX "ExpenseRecord_companyId_id_key" ON "ExpenseRecord"("companyId", "id");

CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "paymentMethod" "ExpensePaymentMethod",
    "paidAt" TIMESTAMP(3) NOT NULL,
    "bankAccountRef" TEXT,
    "status" "ExpensePaymentRecordStatus" NOT NULL DEFAULT 'RECORDED',
    "postingStatus" "ExpensePostingStatus" NOT NULL DEFAULT 'pending',
    "journalEntryId" TEXT,
    "postingError" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "voidedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpensePayment_companyId_id_key" ON "ExpensePayment"("companyId", "id");
CREATE INDEX "ExpensePayment_companyId_expenseId_paidAt_idx" ON "ExpensePayment"("companyId", "expenseId", "paidAt");
CREATE INDEX "ExpensePayment_companyId_postingStatus_paidAt_idx" ON "ExpensePayment"("companyId", "postingStatus", "paidAt");

ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_companyId_expenseId_fkey"
  FOREIGN KEY ("companyId", "expenseId") REFERENCES "ExpenseRecord"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve existing paid rows as one legacy payment event. Reusing the expense id keeps existing
-- expense.payment journals linked to the new source without rewriting immutable ledger rows.
INSERT INTO "ExpensePayment" (
  "id", "companyId", "expenseId", "amount", "currency", "paymentMethod", "paidAt", "bankAccountRef",
  "status", "postingStatus", "journalEntryId", "postingError", "createdByUserId", "voidedByUserId", "voidedAt",
  "createdAt", "updatedAt"
)
SELECT
  expense."id", expense."companyId", expense."id", expense."paidAmount", expense."currency",
  expense."paymentMethod", COALESCE(expense."paidAt", expense."expenseDate"), expense."bankAccountRef",
  CASE WHEN expense."status" = 'VOIDED' THEN 'VOIDED'::"ExpensePaymentRecordStatus" ELSE 'RECORDED'::"ExpensePaymentRecordStatus" END,
  CASE
    WHEN reversal."id" IS NOT NULL THEN 'reversed'::"ExpensePostingStatus"
    WHEN payment_journal."status" = 'POSTED' THEN 'posted'::"ExpensePostingStatus"
    WHEN expense."status" = 'VOIDED' THEN 'not_required'::"ExpensePostingStatus"
    -- Before this migration the header stored whichever leg ran last. An error belongs to the
    -- payment only when a generated accrual already proves that the accrual leg completed.
    WHEN accrual_journal."id" IS NOT NULL AND expense."postingStatus" = 'posting_error'
      THEN 'posting_error'::"ExpensePostingStatus"
    ELSE 'pending'::"ExpensePostingStatus"
  END,
  payment_journal."id", CASE
    WHEN accrual_journal."id" IS NOT NULL AND expense."postingStatus" = 'posting_error'
      THEN expense."postingError"
    ELSE NULL
  END,
  COALESCE(expense."updatedByUserId", expense."createdByUserId"), expense."voidedByUserId", expense."voidedAt",
  COALESCE(expense."paidAt", expense."createdAt"), expense."updatedAt"
FROM "ExpenseRecord" expense
LEFT JOIN "JournalEntry" payment_journal
  ON payment_journal."companyId" = expense."companyId"
 AND payment_journal."sourceType" = 'expense.payment'
 AND payment_journal."sourceId" = expense."id"
 AND payment_journal."entryType" = 'GENERATED'
LEFT JOIN "JournalEntry" accrual_journal
  ON accrual_journal."companyId" = expense."companyId"
 AND accrual_journal."sourceType" = 'expense.record'
 AND accrual_journal."sourceId" = expense."id"
 AND accrual_journal."entryType" = 'GENERATED'
LEFT JOIN "JournalEntry" reversal
  ON reversal."companyId" = expense."companyId"
 AND reversal."sourceType" = 'expense.payment'
 AND reversal."sourceId" = expense."id"
 AND reversal."entryType" = 'REVERSAL'
WHERE expense."paidAmount" > 0
  -- Claim projections settle from ReimbursementPayment and must not create a second cash fact.
  AND expense."sourceReimbursementRequestId" IS NULL;

-- Recording a payment previously overwrote the accrual posting pointer/status. Restore the header
-- from the accrual journal; payment posting state now lives only on ExpensePayment.
WITH paid_expense AS (
  SELECT DISTINCT "companyId", "expenseId" FROM "ExpensePayment"
), accrual_journal AS (
  SELECT "companyId", "sourceId", "id", "status"
  FROM "JournalEntry"
  WHERE "sourceType" = 'expense.record' AND "entryType" = 'GENERATED'
)
UPDATE "ExpenseRecord" expense
SET
  "postingStatus" = CASE
    WHEN expense."status" = 'VOIDED' THEN expense."postingStatus"
    WHEN expense."status" <> 'CONFIRMED' THEN expense."postingStatus"
    WHEN accrual."status" = 'POSTED' THEN 'posted'::"ExpensePostingStatus"
    WHEN expense."duplicateStatus" = 'CONFIRMED_DUPLICATE' THEN 'not_required'::"ExpensePostingStatus"
    WHEN accrual."id" IS NULL AND expense."postingStatus" = 'posting_error'
      THEN 'posting_error'::"ExpensePostingStatus"
    ELSE 'pending'::"ExpensePostingStatus"
  END,
  "journalEntryId" = accrual."id",
  "postingError" = CASE
    WHEN expense."status" <> 'CONFIRMED' THEN expense."postingError"
    WHEN accrual."id" IS NULL AND expense."postingStatus" = 'posting_error' THEN expense."postingError"
    ELSE NULL
  END
FROM paid_expense payment
LEFT JOIN accrual_journal accrual
  ON accrual."companyId" = payment."companyId" AND accrual."sourceId" = payment."expenseId"
WHERE payment."companyId" = expense."companyId" AND payment."expenseId" = expense."id";
