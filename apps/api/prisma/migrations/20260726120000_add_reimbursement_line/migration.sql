-- Lane C: one claim holds many expense rows (1 ใบเบิก หลายรายการ).
-- Every statement is re-runnable: prod deploys ship a dirty tree, so a migration
-- can be recorded-applied from an unfinished file (docs/agent-memory prod migration drift).

CREATE TABLE IF NOT EXISTS "ReimbursementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "incurredDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "purpose" TEXT,
    "categoryKey" TEXT NOT NULL,
    "categoryLabelSnapshot" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "attachmentId" TEXT,
    "linkedExpenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementLine_reimbursementRequestId_lineNo_key" ON "ReimbursementLine"("reimbursementRequestId", "lineNo");
CREATE INDEX IF NOT EXISTS "ReimbursementLine_companyId_linkedExpenseId_idx" ON "ReimbursementLine"("companyId", "linkedExpenseId");
CREATE INDEX IF NOT EXISTS "ReimbursementLine_companyId_attachmentId_idx" ON "ReimbursementLine"("companyId", "attachmentId");

-- ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 15; guard on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReimbursementLine_companyId_fkey') THEN
    ALTER TABLE "ReimbursementLine"
      ADD CONSTRAINT "ReimbursementLine_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReimbursementLine_reimbursementRequestId_fkey') THEN
    ALTER TABLE "ReimbursementLine"
      ADD CONSTRAINT "ReimbursementLine_reimbursementRequestId_fkey"
      FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Backfill: every pre-existing claim becomes a one-line claim carrying its header
-- values, so header total == line 1 amount and no request is left line-less.
INSERT INTO "ReimbursementLine" (
  "id", "companyId", "reimbursementRequestId", "lineNo", "incurredDate", "description",
  "purpose", "categoryKey", "categoryLabelSnapshot", "amount", "attachmentId", "linkedExpenseId",
  "createdAt", "updatedAt"
)
SELECT
  'rbl_' || r."id",
  r."companyId",
  r."id",
  1,
  r."incurredDate",
  COALESCE(NULLIF(btrim(r."title"), ''), NULLIF(btrim(r."reason"), ''), 'รายการเบิก'),
  NULL,
  r."categoryKey",
  r."categoryLabelSnapshot",
  r."amount",
  r."primaryAttachmentId",
  r."linkedExpenseId",
  r."createdAt",
  r."updatedAt"
FROM "ReimbursementRequest" r
WHERE NOT EXISTS (
  SELECT 1 FROM "ReimbursementLine" l WHERE l."reimbursementRequestId" = r."id"
);
