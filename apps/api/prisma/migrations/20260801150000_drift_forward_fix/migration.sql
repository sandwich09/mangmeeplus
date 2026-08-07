-- Converge migration history to schema.prisma (migration-drift heal).
-- Diagnosis: docs/agent-memory/migration-drift-diagnosis.md
--
-- Fully idempotent + state-independent: safe on a fresh replay, on the current dev DB
-- (which carries two older CHECK variants), and on UAT/prod regardless of which variant
-- they applied. Every step is guarded on catalog state, never on migration history —
-- that is what makes it safe on an environment lagging several migrations behind.

SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. AiTurnIntent: re-assert the three intake values. 20260705150000 added them and
--    every environment has them; a merge conflict dropped them from schema.prisma only
--    (restored in the same change). Kept here so the enum can never be the thing that
--    is missing: additive, IF NOT EXISTS, and the values are not used in this
--    transaction (PG >= 12 requirement).
-- ---------------------------------------------------------------------------
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'EVIDENCE_CAPTURE';
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'SIGNATURE_REQUEST';
ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS 'CLARIFY';

-- ---------------------------------------------------------------------------
-- 1. CrmCampaignRecipient.companyId tenant FK — never created by
--    20260712090000_crm_campaign_broadcast (hand-written). Genuine integrity gap.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE "CrmCampaignRecipient"
    ADD CONSTRAINT "CrmCampaignRecipient_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Crm campaign FKs: same ON DELETE, but ON UPDATE NO ACTION instead of CASCADE.
--    Re-assert only when the update action actually differs ('c' = CASCADE).
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'CrmCampaign|CrmCampaign_companyId_fkey|companyId|Company|CASCADE',
      'CrmCampaign|CrmCampaign_channelId_fkey|channelId|CompanyMessagingChannel|RESTRICT',
      'CrmCampaignRecipient|CrmCampaignRecipient_campaignId_fkey|campaignId|CrmCampaign|CASCADE',
      'CrmCampaignRecipient|CrmCampaignRecipient_channelIdentityId_fkey|channelIdentityId|CrmChannelIdentity|RESTRICT'
    ]) AS spec
  LOOP
    DECLARE
      p text[] := string_to_array(r.spec, '|');
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = p[2] AND conrelid = format('%I', p[1])::regclass AND confupdtype <> 'c'
      ) THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p[1], p[2]);
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE %s ON UPDATE CASCADE',
          p[1], p[2], p[3], p[4], p[5]);
      END IF;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. @updatedAt columns must not carry a DB default. DROP DEFAULT is idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE "CrmDataSubjectRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ThaiAddressMaster" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 4. Identifier truncation: hand-written migrations truncated names at 63 chars
--    without preserving Prisma's _key/_idx/_fkey suffix. Rename only if the old
--    name is present and the target name is free. Zero data impact.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  -- foreign-key constraint rename
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachme_fkey') THEN
    ALTER TABLE "ExpenseSubstituteReceiptEvidence"
      RENAME CONSTRAINT "ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_"
      TO "ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachme_fkey";
  END IF;

  -- index renames
  FOR r IN
    SELECT unnest(ARRAY[
      'ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_|ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmen_key',
      'ExpenseSubstituteReceiptEvidence_companyId_expenseId_idempotenc|ExpenseSubstituteReceiptEvidence_companyId_expenseId_idempo_key',
      'ExpenseSubstituteReceiptEvidence_companyId_expenseId_version_ke|ExpenseSubstituteReceiptEvidence_companyId_expenseId_versio_key',
      'ExpenseSubstituteReceiptEvidence_companyId_payerUserId_status_i|ExpenseSubstituteReceiptEvidence_companyId_payerUserId_stat_idx',
      'Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_evidence|Pp36PaymentEvidenceBinding_supplierPaymentAllocationId_evid_key',
      'ReimbursementClaimSignature_companyId_reimbursementRequest_idx|ReimbursementClaimSignature_companyId_reimbursementRequestI_idx',
      'ReportDrilldownAccessLog_companyId_sourceModule_sourceType_s_id|ReportDrilldownAccessLog_companyId_sourceModule_sourceType__idx'
    ]) AS spec
  LOOP
    DECLARE
      p text[] := string_to_array(r.spec, '|');
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = p[1] AND relkind = 'i')
         AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = p[2] AND relkind = 'i') THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', p[1], p[2]);
      END IF;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. CHECK-constraint heal for the two migrations that were edited after being
--    applied locally. Invisible to `prisma migrate diff` — Prisma has no CHECK
--    concept — so only this explicit re-assert converges an environment that ran
--    the pre-edit draft.
--    Committed intent: buffer in {0,30,60,90,120}; booking duration 60..180 step 30.
--    Fail-closed: a row violating the tighter bound aborts the migration for manual
--    triage. Never silently widen the constraint, never silently rewrite data.
-- ---------------------------------------------------------------------------
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Company"
   WHERE "bookingBufferMinutes" IS NOT NULL AND "bookingBufferMinutes" NOT IN (0, 30, 60, 90, 120);
  IF bad > 0 THEN
    RAISE EXCEPTION 'drift-convergence: % Company row(s) have bookingBufferMinutes outside {0,30,60,90,120}. Triage before applying.', bad;
  END IF;

  SELECT count(*) INTO bad FROM "Product"
   WHERE "bookingDurationMinutes" IS NOT NULL
     AND NOT ("bookingDurationMinutes" BETWEEN 60 AND 180 AND "bookingDurationMinutes" % 30 = 0);
  IF bad > 0 THEN
    RAISE EXCEPTION 'drift-convergence: % Product row(s) have bookingDurationMinutes outside 60..180 step 30 (the pre-edit migration allowed 30). Triage before applying.', bad;
  END IF;
END $$;

ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_bookingBufferMinutes_check";
ALTER TABLE "Company" ADD CONSTRAINT "Company_bookingBufferMinutes_check"
  CHECK ("bookingBufferMinutes" IN (0, 30, 60, 90, 120));

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_bookingDurationMinutes_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_bookingDurationMinutes_check"
  CHECK (
    "bookingDurationMinutes" IS NULL OR
    ("bookingDurationMinutes" BETWEEN 60 AND 180 AND "bookingDurationMinutes" % 30 = 0)
  );
