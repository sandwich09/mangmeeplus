-- H4 fix round (external review r11) — link hardening.
--
-- F3: linking an externally issued 50 ทวิ was read-then-unconditional-update. Two operators linking
-- concurrently both read REQUIRED and the later silently overwrote the first one's legal evidence,
-- with no record that it had happened. Replay also compared the CREATION command id, because no
-- link command was ever persisted — so a genuine retry and a different second link were
-- indistinguishable. The link command now has its own identity and its own unique fence, and the
-- status transition becomes a conditional CAS.
--
-- The issued date and note are promoted to real columns: they are legal evidence about an RD
-- document, not audit breadcrumbs, and were previously accepted from the caller and then dropped.
--
-- F1(a): `branchCode` holds the PAYEE's tax branch code (certificate prefill). The INTERNAL source
-- branch of the payment was not captured at all, so a handoff could not be attributed to the branch
-- that made the payment. `sourceBranchId` records it. Note this is attribution, NOT authorization:
-- no AP surface enforces a branch boundary today (see task memory).
--
-- Additive only: five nullable columns and one NULL-distinct unique index. Nothing is dropped,
-- narrowed or backfilled, and no existing row becomes invalid.
ALTER TABLE "WhtCertificateHandoff"
  ADD COLUMN IF NOT EXISTS "linkCommandId"         TEXT,
  ADD COLUMN IF NOT EXISTS "linkPayloadFingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "externalIssuedDate"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "linkNote"              TEXT,
  ADD COLUMN IF NOT EXISTS "sourceBranchId"        TEXT;

-- The link fence. NULLs are distinct in Postgres, so every not-yet-linked handoff coexists freely
-- while any two link attempts carrying the same command id collide on exactly one winner.
CREATE UNIQUE INDEX IF NOT EXISTS "WhtCertificateHandoff_companyId_linkCommandId_key"
  ON "WhtCertificateHandoff" ("companyId", "linkCommandId");

CREATE INDEX IF NOT EXISTS "WhtCertificateHandoff_companyId_sourceBranchId_idx"
  ON "WhtCertificateHandoff" ("companyId", "sourceBranchId");
