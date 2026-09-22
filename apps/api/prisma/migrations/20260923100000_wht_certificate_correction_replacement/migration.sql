-- WHT certificate correction & replacement plan §1.1: additive columns for single-supersede
-- correction (bidirectional self-relation kept as plain strings — mirrors
-- WhtCertificateHandoff.certificateId, no Prisma `@relation`) and a plain replacement-copy counter
-- (no per-copy ledger table, §3 non-goal). Every column nullable/defaulted, so existing rows are
-- unaffected.
ALTER TABLE "WhtCertificate"
  ADD COLUMN IF NOT EXISTS "supersededByCertificateId" TEXT,
  ADD COLUMN IF NOT EXISTS "supersedesCertificateId" TEXT,
  ADD COLUMN IF NOT EXISTS "correctionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "replacementCopyCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastReplacementCopyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastReplacementCopyByUserId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "WhtCertificate_supersededByCertificateId_key" ON "WhtCertificate"("supersededByCertificateId");
CREATE UNIQUE INDEX IF NOT EXISTS "WhtCertificate_supersedesCertificateId_key" ON "WhtCertificate"("supersedesCertificateId");
