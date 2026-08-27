-- P27 Phase 3: legally attributable corrections and an idempotent simple-income command.
ALTER TABLE "AccountingDocument"
  ADD COLUMN "adjustmentReasonCode" TEXT,
  ADD COLUMN "adjustmentReasonText" TEXT;

CREATE TABLE "AccountingSimpleIncomeCommand" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountingSimpleIncomeCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingSimpleIncomeCommand_companyId_idempotencyKey_key"
  ON "AccountingSimpleIncomeCommand"("companyId", "idempotencyKey");
CREATE UNIQUE INDEX "AccountingSimpleIncomeCommand_companyId_invoiceId_key"
  ON "AccountingSimpleIncomeCommand"("companyId", "invoiceId");
CREATE UNIQUE INDEX "AccountingSimpleIncomeCommand_companyId_paymentId_key"
  ON "AccountingSimpleIncomeCommand"("companyId", "paymentId");
CREATE UNIQUE INDEX "AccountingSimpleIncomeCommand_companyId_receiptId_key"
  ON "AccountingSimpleIncomeCommand"("companyId", "receiptId");
CREATE INDEX "AccountingSimpleIncomeCommand_companyId_completedAt_idx"
  ON "AccountingSimpleIncomeCommand"("companyId", "completedAt");

ALTER TABLE "AccountingSimpleIncomeCommand"
  ADD CONSTRAINT "AccountingSimpleIncomeCommand_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountingSimpleIncomeCommand"
  ADD CONSTRAINT "AccountingSimpleIncomeCommand_companyId_invoiceId_fkey"
  FOREIGN KEY ("companyId", "invoiceId") REFERENCES "AccountingDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingSimpleIncomeCommand"
  ADD CONSTRAINT "AccountingSimpleIncomeCommand_companyId_paymentId_fkey"
  FOREIGN KEY ("companyId", "paymentId") REFERENCES "AccountingPayment"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingSimpleIncomeCommand"
  ADD CONSTRAINT "AccountingSimpleIncomeCommand_companyId_receiptId_fkey"
  FOREIGN KEY ("companyId", "receiptId") REFERENCES "AccountingDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
