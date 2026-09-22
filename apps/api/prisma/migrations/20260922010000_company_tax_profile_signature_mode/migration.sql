-- WHT certificate system issuance plan §3.1 (Decision A, 2026-09-22): company-level signature
-- setting for the 50 ทวิ PDF signature block — v1 is signature-only, no seal/stamp column at all.
--
-- Additive and idempotent: signatureMode defaults to 'BLANK', which is exactly today's behaviour
-- (the signature block prints empty) for every company that has not opted in.
ALTER TABLE "CompanyTaxProfile"
  ADD COLUMN IF NOT EXISTS "signatureMode" TEXT NOT NULL DEFAULT 'BLANK',
  ADD COLUMN IF NOT EXISTS "signatureImageAttachmentId" TEXT;
