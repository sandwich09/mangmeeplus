-- P31 section 8, single-admin mode for a data-rights case (Owner decision 2026-10-02).
--
-- Migration 20260809120000 made the DATABASE refuse five steps to the person who took the step
-- before: creator = approver, approver = executor, executor = verification starter,
-- executor = completer, and the executor recording independent verification. This project has
-- exactly one System Admin, so no case could move past its retention review.
--
-- The rules stay. A same-person step is accepted only as an explicit self-step: a marker and a
-- reason stored on the row of that step. Whether the platform really has one active System Admin
-- is decided by the service in the same transaction, because it is a fact about other tables at
-- that moment; without the marker and reason the database refuses exactly as before.
--
-- Additive: ten columns (constant defaults, so existing rows are not rewritten), three CHECK
-- constraints that every existing row already satisfies (no row can have a same-person step), and
-- two trigger functions replaced in place, so both triggers stay bound. Nothing is back-filled and
-- no step of a case moves, reads or removes any data outside these two tables.

ALTER TABLE "DataRightsCase"
  ADD COLUMN "approvalSingleAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvalSingleAdminReason" TEXT,
  ADD COLUMN "executionSingleAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "executionSingleAdminReason" TEXT,
  ADD COLUMN "verificationSingleAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "verificationSingleAdminReason" TEXT,
  ADD COLUMN "completionSingleAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completionSingleAdminReason" TEXT;

-- The marker is the truth in both directions: set exactly when the same person took both steps.
-- That also keeps it false on a new case, whose later stamps are all NULL.
ALTER TABLE "DataRightsCase"
  ADD CONSTRAINT "DataRightsCase_single_admin_marker_check" CHECK (
    "approvalSingleAdmin" = COALESCE("approvedByUserId" = "createdByUserId", false)
    AND "executionSingleAdmin" = COALESCE("executionStartedByUserId" = "approvedByUserId", false)
    AND "verificationSingleAdmin" = COALESCE("verificationStartedByUserId" = "executionStartedByUserId", false)
    AND "completionSingleAdmin" = COALESCE("completedByUserId" = "executionStartedByUserId", false)
  ),
  ADD CONSTRAINT "DataRightsCase_single_admin_reason_check" CHECK (
    (("approvalSingleAdmin" AND "approvalSingleAdminReason" IS NOT NULL
        AND char_length(btrim("approvalSingleAdminReason")) >= 20)
      OR (NOT "approvalSingleAdmin" AND "approvalSingleAdminReason" IS NULL))
    AND (("executionSingleAdmin" AND "executionSingleAdminReason" IS NOT NULL
        AND char_length(btrim("executionSingleAdminReason")) >= 20)
      OR (NOT "executionSingleAdmin" AND "executionSingleAdminReason" IS NULL))
    AND (("verificationSingleAdmin" AND "verificationSingleAdminReason" IS NOT NULL
        AND char_length(btrim("verificationSingleAdminReason")) >= 20)
      OR (NOT "verificationSingleAdmin" AND "verificationSingleAdminReason" IS NULL))
    AND (("completionSingleAdmin" AND "completionSingleAdminReason" IS NOT NULL
        AND char_length(btrim("completionSingleAdminReason")) >= 20)
      OR (NOT "completionSingleAdmin" AND "completionSingleAdminReason" IS NULL))
  );

ALTER TABLE "DataRightsEvidenceRecord"
  ADD COLUMN "singleAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "singleAdminReason" TEXT;

ALTER TABLE "DataRightsEvidenceRecord"
  ADD CONSTRAINT "DataRightsEvidenceRecord_single_admin_reason_check" CHECK (
    ("singleAdmin" AND "singleAdminReason" IS NOT NULL AND char_length(btrim("singleAdminReason")) >= 20)
    OR (NOT "singleAdmin" AND "singleAdminReason" IS NULL)
  );

-- Same body as 20260809120000 except: the executor may record independent verification when the
-- row carries the single-admin marker and reason, and the marker is refused anywhere else.
CREATE OR REPLACE FUNCTION "enforce_data_rights_evidence_phase"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  case_status "DataRightsCaseStatus";
  executor_id TEXT;
  -- P31 section 8: the explicit single-admin marker and its reason, both on this row.
  single_admin_step BOOLEAN := NEW."singleAdmin" IS TRUE AND NULLIF(BTRIM(NEW."singleAdminReason"), '') IS NOT NULL;
BEGIN
  SELECT "status", "executionStartedByUserId"
  INTO case_status, executor_id
  FROM "DataRightsCase"
  WHERE "id" = NEW."caseId"
  FOR SHARE;

  IF case_status IS NULL THEN
    RAISE EXCEPTION 'data-rights case does not exist'
      USING ERRCODE = '23503';
  END IF;

  -- The marker is truthful both ways: it exists only where the executor records independent
  -- verification, never on other evidence and never for a different person.
  IF NEW."singleAdmin" IS TRUE AND (
    NEW."evidenceType" <> 'INDEPENDENT_VERIFICATION' OR NEW."recordedByUserId" IS DISTINCT FROM executor_id
  ) THEN
    RAISE EXCEPTION 'single-admin marker is only valid when the executor records independent verification'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."evidenceType" = 'IDENTITY_VERIFICATION' THEN
    IF case_status <> 'RECEIVED' OR NEW."category" IS NOT NULL THEN
      RAISE EXCEPTION 'identity evidence is only valid during RECEIVED and has no category'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."evidenceType" = 'AUTHORITY_VERIFICATION' THEN
    IF case_status <> 'IDENTITY_VERIFIED' OR NEW."category" IS NOT NULL THEN
      RAISE EXCEPTION 'authority evidence is only valid after identity verification and has no category'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."evidenceType" = 'EXPORT_DELIVERY' THEN
    IF case_status NOT IN ('RETENTION_REVIEW', 'APPROVED', 'EXECUTING') THEN
      RAISE EXCEPTION 'export evidence is not valid in the current phase'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."category" IS NULL THEN
      RAISE EXCEPTION 'export evidence requires the returned decision category'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."evidenceType" = 'INDEPENDENT_VERIFICATION' THEN
    IF case_status <> 'VERIFICATION' THEN
      RAISE EXCEPTION 'independent verification evidence is only valid during VERIFICATION'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."recordedByUserId" = executor_id AND NOT single_admin_step THEN
      RAISE EXCEPTION 'data-rights executor cannot provide independent verification'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."category" IS NOT NULL THEN
      RAISE EXCEPTION 'independent verification evidence has no single category'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    IF case_status <> 'EXECUTING' THEN
      RAISE EXCEPTION 'execution evidence is only valid during EXECUTING'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."evidenceType" = 'OBJECT_STORAGE_INVENTORY'
    AND NEW."category" IS DISTINCT FROM 'ATTACHMENTS_OBJECT_VERSIONS' THEN
    RAISE EXCEPTION 'object-storage evidence must use ATTACHMENTS_OBJECT_VERSIONS category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'ACCESS_REVOCATION'
    AND NEW."category" IS DISTINCT FROM 'MEMBERSHIPS_ACCESS' THEN
    RAISE EXCEPTION 'access-revocation evidence must use MEMBERSHIPS_ACCESS category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'DATABASE_EXECUTION' AND NEW."category" IS NULL THEN
    RAISE EXCEPTION 'database-execution evidence requires its decision category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'QUEUE_CACHE_PURGE'
    AND NEW."category" IS DISTINCT FROM 'QUEUES_CACHES' THEN
    RAISE EXCEPTION 'queue/cache evidence must use QUEUES_CACHES category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'PROCESSOR_CONFIRMATION'
    AND NEW."category" IS DISTINCT FROM 'PROCESSORS' THEN
    RAISE EXCEPTION 'processor evidence must use PROCESSORS category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'BACKUP_MANIFEST'
    AND NEW."category" IS DISTINCT FROM 'BACKUPS' THEN
    RAISE EXCEPTION 'backup evidence must use BACKUPS category'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."evidenceType" = 'RETENTION_HOLD' THEN
    IF NEW."category" IS NULL THEN
      RAISE EXCEPTION 'retention-hold evidence requires a decision category'
        USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "DataRightsDecisionRecord" decision
      WHERE decision."caseId" = NEW."caseId"
        AND decision."category" = NEW."category"
        AND decision."revision" = (
          SELECT MAX(latest."revision")
          FROM "DataRightsDecisionRecord" latest
          WHERE latest."caseId" = NEW."caseId" AND latest."category" = NEW."category"
        )
        AND decision."disposition" IN ('RETAIN', 'RESTRICT')
    ) THEN
      RAISE EXCEPTION 'retention-hold evidence must match a current retained/restricted decision'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Same body as 20260809120000 except: each of the four same-person rules accepts the step when the
-- row carries that step's marker and reason, and a marker or reason can change only on its own
-- step, like the stamps beside it.
CREATE OR REPLACE FUNCTION "enforce_data_rights_case_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  decision_count INTEGER;
  missing_evidence_count INTEGER;
  -- P31 section 8: a single-admin marker and its reason belong to their step exactly like its stamps.
  approval_marker_changed BOOLEAN := NEW."approvalSingleAdmin" IS DISTINCT FROM OLD."approvalSingleAdmin"
    OR NEW."approvalSingleAdminReason" IS DISTINCT FROM OLD."approvalSingleAdminReason";
  execution_marker_changed BOOLEAN := NEW."executionSingleAdmin" IS DISTINCT FROM OLD."executionSingleAdmin"
    OR NEW."executionSingleAdminReason" IS DISTINCT FROM OLD."executionSingleAdminReason";
  verification_marker_changed BOOLEAN := NEW."verificationSingleAdmin" IS DISTINCT FROM OLD."verificationSingleAdmin"
    OR NEW."verificationSingleAdminReason" IS DISTINCT FROM OLD."verificationSingleAdminReason";
  completion_marker_changed BOOLEAN := NEW."completionSingleAdmin" IS DISTINCT FROM OLD."completionSingleAdmin"
    OR NEW."completionSingleAdminReason" IS DISTINCT FROM OLD."completionSingleAdminReason";
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey"
    OR NEW."caseType" IS DISTINCT FROM OLD."caseType"
    OR NEW."requestSource" IS DISTINCT FROM OLD."requestSource"
    OR NEW."requesterContactHash" IS DISTINCT FROM OLD."requesterContactHash"
    OR NEW."targetUserId" IS DISTINCT FROM OLD."targetUserId"
    OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."membershipId" IS DISTINCT FROM OLD."membershipId"
    OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
    OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'immutable data-rights case scope cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF OLD."status" = 'IDENTITY_VERIFIED'
      AND OLD."authorityVerifiedAt" IS NULL
      AND OLD."authorityVerifiedByUserId" IS NULL
      AND NEW."authorityVerifiedAt" IS NOT NULL
      AND NEW."authorityVerifiedByUserId" IS NOT NULL
      AND NEW."identityVerifiedAt" IS NOT DISTINCT FROM OLD."identityVerifiedAt"
      AND NEW."identityVerifiedByUserId" IS NOT DISTINCT FROM OLD."identityVerifiedByUserId"
      AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt"
      AND NEW."approvedByUserId" IS NOT DISTINCT FROM OLD."approvedByUserId"
      AND NEW."executionStartedAt" IS NOT DISTINCT FROM OLD."executionStartedAt"
      AND NEW."executionStartedByUserId" IS NOT DISTINCT FROM OLD."executionStartedByUserId"
      AND NEW."verificationStartedAt" IS NOT DISTINCT FROM OLD."verificationStartedAt"
      AND NEW."verificationStartedByUserId" IS NOT DISTINCT FROM OLD."verificationStartedByUserId"
      AND NEW."completedAt" IS NOT DISTINCT FROM OLD."completedAt"
      AND NEW."completedByUserId" IS NOT DISTINCT FROM OLD."completedByUserId"
      AND NEW."outcomeSummary" IS NOT DISTINCT FROM OLD."outcomeSummary"
      AND NOT (approval_marker_changed OR execution_marker_changed
        OR verification_marker_changed OR completion_marker_changed) THEN
      IF NOT EXISTS (
        SELECT 1 FROM "DataRightsEvidenceRecord" evidence
        WHERE evidence."caseId" = NEW."id"
          AND evidence."evidenceType" = 'AUTHORITY_VERIFICATION'
          AND evidence."recordedByUserId" = NEW."authorityVerifiedByUserId"
      ) THEN
        RAISE EXCEPTION 'authority stamp requires matching append-only evidence'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW."identityVerifiedAt" IS DISTINCT FROM OLD."identityVerifiedAt"
      OR NEW."identityVerifiedByUserId" IS DISTINCT FROM OLD."identityVerifiedByUserId"
      OR NEW."authorityVerifiedAt" IS DISTINCT FROM OLD."authorityVerifiedAt"
      OR NEW."authorityVerifiedByUserId" IS DISTINCT FROM OLD."authorityVerifiedByUserId"
      OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
      OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
      OR NEW."executionStartedAt" IS DISTINCT FROM OLD."executionStartedAt"
      OR NEW."executionStartedByUserId" IS DISTINCT FROM OLD."executionStartedByUserId"
      OR NEW."verificationStartedAt" IS DISTINCT FROM OLD."verificationStartedAt"
      OR NEW."verificationStartedByUserId" IS DISTINCT FROM OLD."verificationStartedByUserId"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId"
      OR NEW."outcomeSummary" IS DISTINCT FROM OLD."outcomeSummary"
      OR approval_marker_changed OR execution_marker_changed
      OR verification_marker_changed OR completion_marker_changed THEN
      RAISE EXCEPTION 'data-rights evidence stamps are immutable without a status transition'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'RECEIVED' AND NEW."status" IN ('IDENTITY_VERIFIED', 'REJECTED', 'CANCELLED'))
    OR (OLD."status" = 'IDENTITY_VERIFIED' AND NEW."status" IN ('RETENTION_REVIEW', 'REJECTED', 'CANCELLED'))
    OR (OLD."status" = 'RETENTION_REVIEW' AND NEW."status" IN ('APPROVED', 'REJECTED', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('EXECUTING', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'BLOCKED')
    OR (OLD."status" = 'EXECUTING' AND NEW."status" IN ('VERIFICATION', 'BLOCKED'))
    OR (OLD."status" = 'VERIFICATION' AND NEW."status" IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED'))
  ) THEN
    RAISE EXCEPTION 'invalid data-rights status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '55000';
  END IF;

  IF (NEW."identityVerifiedAt" IS DISTINCT FROM OLD."identityVerifiedAt"
      OR NEW."identityVerifiedByUserId" IS DISTINCT FROM OLD."identityVerifiedByUserId")
    AND NOT (OLD."status" = 'RECEIVED' AND NEW."status" = 'IDENTITY_VERIFIED') THEN
    RAISE EXCEPTION 'identity-verification stamps may change only on identity verification'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."authorityVerifiedAt" IS DISTINCT FROM OLD."authorityVerifiedAt"
    OR NEW."authorityVerifiedByUserId" IS DISTINCT FROM OLD."authorityVerifiedByUserId" THEN
    RAISE EXCEPTION 'authority-verification stamps cannot change during a status transition'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
      OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
      OR approval_marker_changed)
    AND NOT (OLD."status" = 'RETENTION_REVIEW' AND NEW."status" = 'APPROVED') THEN
    RAISE EXCEPTION 'approval stamps may change only on approval'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."executionStartedAt" IS DISTINCT FROM OLD."executionStartedAt"
      OR NEW."executionStartedByUserId" IS DISTINCT FROM OLD."executionStartedByUserId"
      OR execution_marker_changed)
    AND NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'EXECUTING') THEN
    RAISE EXCEPTION 'execution stamps may change only when execution starts'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."verificationStartedAt" IS DISTINCT FROM OLD."verificationStartedAt"
      OR NEW."verificationStartedByUserId" IS DISTINCT FROM OLD."verificationStartedByUserId"
      OR verification_marker_changed)
    AND NOT (OLD."status" = 'EXECUTING' AND NEW."status" = 'VERIFICATION') THEN
    RAISE EXCEPTION 'verification stamps may change only when verification starts'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId"
      OR completion_marker_changed)
    AND NOT (OLD."status" = 'VERIFICATION' AND NEW."status" IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION')) THEN
    RAISE EXCEPTION 'completion stamps may change only on completion'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."outcomeSummary" IS DISTINCT FROM OLD."outcomeSummary"
    AND NEW."status" NOT IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'outcome summary may change only when a case closes'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'IDENTITY_VERIFIED' AND (
    NEW."identityVerifiedAt" IS NULL OR NEW."identityVerifiedByUserId" IS NULL
  ) THEN
    RAISE EXCEPTION 'identity verification evidence is required'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."status" = 'IDENTITY_VERIFIED' AND NOT EXISTS (
    SELECT 1 FROM "DataRightsEvidenceRecord" evidence
    WHERE evidence."caseId" = NEW."id"
      AND evidence."evidenceType" = 'IDENTITY_VERIFICATION'
      AND evidence."recordedByUserId" = NEW."identityVerifiedByUserId"
  ) THEN
    RAISE EXCEPTION 'identity stamp requires matching append-only evidence'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'RETENTION_REVIEW'
    AND NEW."caseType" <> 'USER_ACCOUNT_ERASURE'
    AND (NEW."authorityVerifiedAt" IS NULL OR NEW."authorityVerifiedByUserId" IS NULL) THEN
    RAISE EXCEPTION 'tenant authority verification is required'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'APPROVED' THEN
    IF NEW."approvedAt" IS NULL OR NEW."approvedByUserId" IS NULL THEN
      RAISE EXCEPTION 'approval identity and timestamp are required'
        USING ERRCODE = '55000';
    END IF;
    SELECT COUNT(DISTINCT "category") INTO decision_count
      FROM "DataRightsDecisionRecord" WHERE "caseId" = NEW."id";
    IF decision_count <> 12 THEN
      RAISE EXCEPTION 'all 12 data-layer decisions are required before approval'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."approvedByUserId" = NEW."createdByUserId"
      AND NOT (NEW."approvalSingleAdmin" IS TRUE AND NULLIF(BTRIM(NEW."approvalSingleAdminReason"), '') IS NOT NULL) THEN
      RAISE EXCEPTION 'data-rights case requires an approver independent from its creator'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."status" IN ('APPROVED', 'EXECUTING', 'VERIFICATION', 'COMPLETED', 'COMPLETED_WITH_EXCEPTION') AND EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT ON ("category") "disposition", "retentionUntil", "accessRestriction"
      FROM "DataRightsDecisionRecord"
      WHERE "caseId" = NEW."id"
      ORDER BY "category", "revision" DESC
    ) latest_decision
    WHERE latest_decision."disposition" IN ('RETAIN', 'RESTRICT')
      AND (
        latest_decision."retentionUntil" IS NULL
        OR latest_decision."retentionUntil" <= CURRENT_TIMESTAMP
        OR NULLIF(BTRIM(latest_decision."accessRestriction"), '') IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'retained/restricted decisions require a current future review date before approval or execution'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."status" = 'EXECUTING' THEN
    IF NEW."executionStartedAt" IS NULL OR NEW."executionStartedByUserId" IS NULL THEN
      RAISE EXCEPTION 'execution identity and timestamp are required'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."executionStartedByUserId" = NEW."approvedByUserId"
      AND NOT (NEW."executionSingleAdmin" IS TRUE AND NULLIF(BTRIM(NEW."executionSingleAdminReason"), '') IS NOT NULL) THEN
      RAISE EXCEPTION 'data-rights approver cannot execute the case'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."status" = 'VERIFICATION' THEN
    IF NEW."verificationStartedAt" IS NULL OR NEW."verificationStartedByUserId" IS NULL THEN
      RAISE EXCEPTION 'verification identity and timestamp are required'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."verificationStartedByUserId" = NEW."executionStartedByUserId"
      AND NOT (NEW."verificationSingleAdmin" IS TRUE AND NULLIF(BTRIM(NEW."verificationSingleAdminReason"), '') IS NOT NULL) THEN
      RAISE EXCEPTION 'data-rights execution requires an independent verifier'
        USING ERRCODE = '55000';
    END IF;

    WITH latest_decision AS (
      SELECT DISTINCT ON ("category") "category", "disposition"
      FROM "DataRightsDecisionRecord"
      WHERE "caseId" = NEW."id"
      ORDER BY "category", "revision" DESC
    ), baseline_required AS (
      SELECT 'MEMBERSHIPS_ACCESS'::"DataRightsDecisionCategory" AS "category",
        'ACCESS_REVOCATION'::"DataRightsEvidenceType" AS evidence_type
      UNION ALL
      SELECT 'ACCOUNT_IDENTITY'::"DataRightsDecisionCategory", 'DATABASE_EXECUTION'::"DataRightsEvidenceType"
      WHERE NEW."caseType" = 'USER_ACCOUNT_ERASURE'
      UNION ALL
      SELECT 'TENANT_OPERATIONAL_DATA'::"DataRightsDecisionCategory", 'DATABASE_EXECUTION'::"DataRightsEvidenceType"
      WHERE NEW."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
      UNION ALL
      SELECT 'ATTACHMENTS_OBJECT_VERSIONS'::"DataRightsDecisionCategory", 'OBJECT_STORAGE_INVENTORY'::"DataRightsEvidenceType"
      WHERE NEW."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
      UNION ALL
      SELECT 'QUEUES_CACHES'::"DataRightsDecisionCategory", 'QUEUE_CACHE_PURGE'::"DataRightsEvidenceType"
      WHERE NEW."caseType" <> 'MEMBERSHIP_EXIT'
      UNION ALL
      SELECT 'PROCESSORS'::"DataRightsDecisionCategory", 'PROCESSOR_CONFIRMATION'::"DataRightsEvidenceType"
      WHERE NEW."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
      UNION ALL
      SELECT 'BACKUPS'::"DataRightsDecisionCategory", 'BACKUP_MANIFEST'::"DataRightsEvidenceType"
      WHERE NEW."caseType" <> 'MEMBERSHIP_EXIT'
    ), decision_required AS (
      SELECT "category", 'ACCESS_REVOCATION'::"DataRightsEvidenceType" AS evidence_type
      FROM latest_decision
      WHERE "category" = 'MEMBERSHIPS_ACCESS' AND "disposition" IN ('DELETE', 'RESTRICT')
      UNION ALL
      SELECT "category", 'DATABASE_EXECUTION'::"DataRightsEvidenceType"
      FROM latest_decision WHERE "disposition" IN ('DELETE', 'ANONYMIZE')
      UNION ALL
      SELECT "category", 'OBJECT_STORAGE_INVENTORY'::"DataRightsEvidenceType"
      FROM latest_decision
      WHERE "category" = 'ATTACHMENTS_OBJECT_VERSIONS' AND "disposition" IN ('DELETE', 'ANONYMIZE')
      UNION ALL
      SELECT "category", 'QUEUE_CACHE_PURGE'::"DataRightsEvidenceType"
      FROM latest_decision
      WHERE "category" = 'QUEUES_CACHES' AND "disposition" IN ('DELETE', 'ANONYMIZE')
      UNION ALL
      SELECT "category", 'PROCESSOR_CONFIRMATION'::"DataRightsEvidenceType"
      FROM latest_decision
      WHERE "category" = 'PROCESSORS' AND "disposition" <> 'NOT_APPLICABLE'
      UNION ALL
      SELECT "category", 'BACKUP_MANIFEST'::"DataRightsEvidenceType"
      FROM latest_decision
      WHERE "category" = 'BACKUPS' AND "disposition" <> 'NOT_APPLICABLE'
      UNION ALL
      SELECT "category", 'EXPORT_DELIVERY'::"DataRightsEvidenceType"
      FROM latest_decision WHERE "disposition" = 'RETURN'
    ), required AS (
      SELECT "category", evidence_type FROM baseline_required
      UNION
      SELECT "category", evidence_type FROM decision_required
    )
    SELECT COUNT(*) INTO missing_evidence_count
    FROM required
    WHERE NOT EXISTS (
      SELECT 1 FROM "DataRightsEvidenceRecord" evidence
      WHERE evidence."caseId" = NEW."id"
        AND evidence."evidenceType" = required.evidence_type
        AND evidence."category" = required."category"
    );
    IF missing_evidence_count > 0 THEN
      RAISE EXCEPTION 'required execution evidence is incomplete'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON ("category") "disposition"
        FROM "DataRightsDecisionRecord"
        WHERE "caseId" = NEW."id"
        ORDER BY "category", "revision" DESC
      ) latest_decision
      WHERE latest_decision."disposition" = 'RETURN'
    ) AND NOT EXISTS (
      SELECT 1 FROM "DataRightsEvidenceRecord" evidence
      WHERE evidence."caseId" = NEW."id" AND evidence."evidenceType" = 'EXPORT_DELIVERY'
    ) THEN
      RAISE EXCEPTION 'export delivery evidence is required for RETURN decisions'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON ("category") "category", "disposition"
        FROM "DataRightsDecisionRecord"
        WHERE "caseId" = NEW."id"
        ORDER BY "category", "revision" DESC
      ) latest_decision
      WHERE latest_decision."disposition" IN ('RETAIN', 'RESTRICT')
        AND NOT EXISTS (
          SELECT 1 FROM "DataRightsEvidenceRecord" evidence
          WHERE evidence."caseId" = NEW."id"
            AND evidence."evidenceType" = 'RETENTION_HOLD'
            AND evidence."category" = latest_decision."category"
        )
    ) THEN
      RAISE EXCEPTION 'retention-hold evidence is required for retained/restricted data'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."status" IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION') THEN
    IF NEW."completedAt" IS NULL OR NEW."completedByUserId" IS NULL OR NEW."outcomeSummary" IS NULL THEN
      RAISE EXCEPTION 'completion identity, timestamp and outcome are required'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."completedByUserId" = NEW."executionStartedByUserId"
      AND NOT (NEW."completionSingleAdmin" IS TRUE AND NULLIF(BTRIM(NEW."completionSingleAdminReason"), '') IS NOT NULL) THEN
      RAISE EXCEPTION 'data-rights executor cannot verify completion'
        USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "DataRightsEvidenceRecord" evidence
      WHERE evidence."caseId" = NEW."id"
        AND evidence."evidenceType" = 'INDEPENDENT_VERIFICATION'
        AND evidence."recordedByUserId" = NEW."completedByUserId"
    ) THEN
      RAISE EXCEPTION 'the completer must record independent-verification evidence'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."status" = 'COMPLETED' AND EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON ("category") "disposition"
        FROM "DataRightsDecisionRecord"
        WHERE "caseId" = NEW."id"
        ORDER BY "category", "revision" DESC
      ) latest_decision
      WHERE latest_decision."disposition" IN ('RETAIN', 'RESTRICT')
    ) THEN
      RAISE EXCEPTION 'retained or restricted data requires COMPLETED_WITH_EXCEPTION'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."status" = 'COMPLETED_WITH_EXCEPTION' AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON ("category") "disposition"
        FROM "DataRightsDecisionRecord"
        WHERE "caseId" = NEW."id"
        ORDER BY "category", "revision" DESC
      ) latest_decision
      WHERE latest_decision."disposition" IN ('RETAIN', 'RESTRICT')
    ) THEN
      RAISE EXCEPTION 'COMPLETED_WITH_EXCEPTION requires current retained or restricted data'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
