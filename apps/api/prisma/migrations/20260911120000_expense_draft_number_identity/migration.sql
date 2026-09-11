-- Additive compatibility only: existing expense numbers, source snapshots and signatures stay intact.
ALTER TABLE "ExpenseRecord"
  ADD COLUMN "draftIdempotencyKey" TEXT,
  ADD COLUMN "draftPayloadHash" TEXT;

CREATE UNIQUE INDEX "ExpenseRecord_companyId_draftIdempotencyKey_key"
  ON "ExpenseRecord"("companyId", "draftIdempotencyKey");
