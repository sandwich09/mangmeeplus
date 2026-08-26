-- Retry-safe generic invoice draft creation. Nullable columns preserve every existing document;
-- PostgreSQL permits multiple NULLs while fencing a supplied key per company.
ALTER TABLE "AccountingDocument"
  ADD COLUMN "createIdempotencyKey" TEXT,
  ADD COLUMN "createPayloadFingerprint" TEXT;

CREATE UNIQUE INDEX "AccountingDocument_companyId_createIdempotencyKey_key"
  ON "AccountingDocument"("companyId", "createIdempotencyKey");
