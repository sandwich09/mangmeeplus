-- Lane F: digital signatures on the printable ใบเบิกค่าใช้จ่าย.
-- Every statement is re-runnable: prod deploys ship a dirty tree, so a migration
-- can be recorded-applied from an unfinished file (docs/agent-memory prod migration drift).

-- CREATE TYPE has no IF NOT EXISTS in PostgreSQL 15; guard on pg_type.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReimbursementClaimSignatureRole') THEN
    CREATE TYPE "ReimbursementClaimSignatureRole" AS ENUM ('REQUESTER', 'APPROVER', 'FINANCE_REVIEW', 'PAYER');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ReimbursementClaimSignature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "role" "ReimbursementClaimSignatureRole" NOT NULL,
    "signatureAttachmentId" TEXT NOT NULL,
    "signedByUserId" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementClaimSignature_pkey" PRIMARY KEY ("id")
);

-- One signature per role per claim: re-signing replaces the signer's own row.
CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementClaimSignature_reimbursementRequestId_role_key" ON "ReimbursementClaimSignature"("reimbursementRequestId", "role");
CREATE INDEX IF NOT EXISTS "ReimbursementClaimSignature_companyId_reimbursementRequest_idx" ON "ReimbursementClaimSignature"("companyId", "reimbursementRequestId");

-- ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 15; guard on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReimbursementClaimSignature_companyId_fkey') THEN
    ALTER TABLE "ReimbursementClaimSignature"
      ADD CONSTRAINT "ReimbursementClaimSignature_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReimbursementClaimSignature_reimbursementRequestId_fkey') THEN
    ALTER TABLE "ReimbursementClaimSignature"
      ADD CONSTRAINT "ReimbursementClaimSignature_reimbursementRequestId_fkey"
      FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- No backfill: signatures only ever come from a real signing action.
