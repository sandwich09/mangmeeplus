BEGIN;

CREATE TYPE "DataRightsCaseType" AS ENUM (
  'USER_ACCOUNT_ERASURE',
  'MEMBERSHIP_EXIT',
  'COMPANY_WORKSPACE_OFFBOARDING'
);

CREATE TYPE "DataRightsCaseStatus" AS ENUM (
  'RECEIVED',
  'IDENTITY_VERIFIED',
  'RETENTION_REVIEW',
  'APPROVED',
  'EXECUTING',
  'VERIFICATION',
  'COMPLETED',
  'COMPLETED_WITH_EXCEPTION',
  'BLOCKED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "DataRightsRequestSource" AS ENUM (
  'EMAIL',
  'SUPPORT',
  'IN_APP',
  'OTHER_MONITORED_CHANNEL'
);

CREATE TYPE "DataRightsDecisionCategory" AS ENUM (
  'ACCOUNT_IDENTITY',
  'AUTHENTICATION_SECRETS',
  'MEMBERSHIPS_ACCESS',
  'TENANT_OPERATIONAL_DATA',
  'ACCOUNTING_TAX_DOCUMENTS',
  'ATTACHMENTS_OBJECT_VERSIONS',
  'AI_OCR_DATA',
  'AUDIT_SECURITY_LOGS',
  'QUEUES_CACHES',
  'PROCESSORS',
  'BACKUPS',
  'LEGAL_ACCEPTANCE_EVIDENCE'
);

CREATE TYPE "DataRightsDisposition" AS ENUM (
  'DELETE',
  'ANONYMIZE',
  'RESTRICT',
  'RETAIN',
  'RETURN',
  'NOT_APPLICABLE'
);

CREATE TYPE "DataRightsEvidenceType" AS ENUM (
  'IDENTITY_VERIFICATION',
  'AUTHORITY_VERIFICATION',
  'EXPORT_DELIVERY',
  'ACCESS_REVOCATION',
  'DATABASE_EXECUTION',
  'OBJECT_STORAGE_INVENTORY',
  'QUEUE_CACHE_PURGE',
  'PROCESSOR_CONFIRMATION',
  'BACKUP_MANIFEST',
  'RETENTION_HOLD',
  'INDEPENDENT_VERIFICATION'
);

CREATE TABLE "DataRightsCase" (
  "id" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "caseType" "DataRightsCaseType" NOT NULL,
  "status" "DataRightsCaseStatus" NOT NULL DEFAULT 'RECEIVED',
  "requestSource" "DataRightsRequestSource" NOT NULL,
  "requesterContactHash" TEXT,
  "targetUserId" TEXT,
  "companyId" TEXT,
  "membershipId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "identityVerifiedAt" TIMESTAMP(3),
  "identityVerifiedByUserId" TEXT,
  "authorityVerifiedAt" TIMESTAMP(3),
  "authorityVerifiedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "executionStartedAt" TIMESTAMP(3),
  "executionStartedByUserId" TEXT,
  "verificationStartedAt" TIMESTAMP(3),
  "verificationStartedByUserId" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "outcomeSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataRightsCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataRightsCase_target_shape_check" CHECK (
    ("caseType" = 'USER_ACCOUNT_ERASURE'
      AND "targetUserId" IS NOT NULL AND "companyId" IS NULL AND "membershipId" IS NULL)
    OR
    ("caseType" = 'MEMBERSHIP_EXIT' AND "targetUserId" IS NOT NULL AND "companyId" IS NOT NULL AND "membershipId" IS NOT NULL)
    OR
    ("caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
      AND "targetUserId" IS NULL AND "companyId" IS NOT NULL AND "membershipId" IS NULL)
  ),
  CONSTRAINT "DataRightsCase_due_after_received_check" CHECK ("dueAt" > "receivedAt"),
  CONSTRAINT "DataRightsCase_completion_shape_check" CHECK (
    ("status" IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION')
      AND "completedAt" IS NOT NULL AND "completedByUserId" IS NOT NULL
      AND NULLIF(BTRIM("outcomeSummary"), '') IS NOT NULL)
    OR
    ("status" IN ('BLOCKED', 'REJECTED', 'CANCELLED')
      AND "completedAt" IS NULL AND "completedByUserId" IS NULL
      AND NULLIF(BTRIM("outcomeSummary"), '') IS NOT NULL)
    OR
    ("status" NOT IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED')
      AND "completedAt" IS NULL AND "completedByUserId" IS NULL AND "outcomeSummary" IS NULL)
  )
);

CREATE TABLE "DataRightsDecisionRecord" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "category" "DataRightsDecisionCategory" NOT NULL,
  "disposition" "DataRightsDisposition" NOT NULL,
  "legalBasisCode" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "retentionUntil" TIMESTAMP(3),
  "accessRestriction" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataRightsDecisionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataRightsDecisionRecord_caseId_fkey" FOREIGN KEY ("caseId")
    REFERENCES "DataRightsCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataRightsDecisionRecord_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "DataRightsDecisionRecord_retention_check" CHECK (
    ("disposition" IN ('RETAIN', 'RESTRICT')
      AND "retentionUntil" IS NOT NULL
      AND NULLIF(BTRIM("accessRestriction"), '') IS NOT NULL)
    OR
    ("disposition" NOT IN ('RETAIN', 'RESTRICT')
      AND "retentionUntil" IS NULL
      AND "accessRestriction" IS NULL)
  )
);

CREATE TABLE "DataRightsEvidenceRecord" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "evidenceType" "DataRightsEvidenceType" NOT NULL,
  "category" "DataRightsDecisionCategory",
  "reference" TEXT NOT NULL,
  "sha256" TEXT,
  "note" TEXT,
  "recordedByUserId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataRightsEvidenceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataRightsEvidenceRecord_caseId_fkey" FOREIGN KEY ("caseId")
    REFERENCES "DataRightsCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataRightsEvidenceRecord_sha256_check" CHECK (
    "sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "DataRightsEvidenceRecord_completion_hash_check" CHECK (
    "evidenceType" IN ('IDENTITY_VERIFICATION', 'AUTHORITY_VERIFICATION') OR "sha256" IS NOT NULL
  )
);

CREATE TABLE "DataRightsCaseActionRecord" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "commandId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "DataRightsCaseStatus",
  "toStatus" "DataRightsCaseStatus",
  "actorUserId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataRightsCaseActionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataRightsCaseActionRecord_caseId_fkey" FOREIGN KEY ("caseId")
    REFERENCES "DataRightsCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DataRightsCase_requestKey_key" ON "DataRightsCase"("requestKey");
CREATE INDEX "DataRightsCase_status_dueAt_idx" ON "DataRightsCase"("status", "dueAt");
CREATE INDEX "DataRightsCase_targetUserId_createdAt_idx" ON "DataRightsCase"("targetUserId", "createdAt");
CREATE INDEX "DataRightsCase_companyId_createdAt_idx" ON "DataRightsCase"("companyId", "createdAt");
CREATE INDEX "DataRightsCase_membershipId_createdAt_idx" ON "DataRightsCase"("membershipId", "createdAt");
CREATE UNIQUE INDEX "DataRightsCase_active_user_erasure_target_key"
  ON "DataRightsCase"("targetUserId")
  WHERE "caseType" = 'USER_ACCOUNT_ERASURE'
    AND "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED');
CREATE UNIQUE INDEX "DataRightsCase_active_membership_exit_target_key"
  ON "DataRightsCase"("membershipId")
  WHERE "caseType" = 'MEMBERSHIP_EXIT'
    AND "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED');
CREATE UNIQUE INDEX "DataRightsCase_active_company_offboarding_target_key"
  ON "DataRightsCase"("companyId")
  WHERE "caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
    AND "status" NOT IN ('COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'BLOCKED', 'REJECTED', 'CANCELLED');

CREATE UNIQUE INDEX "DataRightsDecisionRecord_caseId_category_revision_key"
  ON "DataRightsDecisionRecord"("caseId", "category", "revision");
CREATE INDEX "DataRightsDecisionRecord_caseId_category_recordedAt_idx"
  ON "DataRightsDecisionRecord"("caseId", "category", "recordedAt");

CREATE INDEX "DataRightsEvidenceRecord_caseId_evidenceType_recordedAt_idx"
  ON "DataRightsEvidenceRecord"("caseId", "evidenceType", "recordedAt");

CREATE UNIQUE INDEX "DataRightsCaseActionRecord_commandId_key"
  ON "DataRightsCaseActionRecord"("commandId");
CREATE INDEX "DataRightsCaseActionRecord_caseId_createdAt_idx"
  ON "DataRightsCaseActionRecord"("caseId", "createdAt");
CREATE INDEX "DataRightsCaseActionRecord_actorUserId_createdAt_idx"
  ON "DataRightsCaseActionRecord"("actorUserId", "createdAt");

CREATE FUNCTION "enforce_data_rights_decision_scope"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  case_status "DataRightsCaseStatus";
  case_type "DataRightsCaseType";
BEGIN
  SELECT "status", "caseType"
  INTO case_status, case_type
  FROM "DataRightsCase"
  WHERE "id" = NEW."caseId"
  FOR SHARE;

  IF case_status IS NULL THEN
    RAISE EXCEPTION 'data-rights case does not exist'
      USING ERRCODE = '23503';
  END IF;
  IF case_status <> 'RETENTION_REVIEW' THEN
    RAISE EXCEPTION 'data-rights decisions may only be recorded during RETENTION_REVIEW'
      USING ERRCODE = '55000';
  END IF;

  IF case_type = 'MEMBERSHIP_EXIT' AND (
    (NEW."category" = 'MEMBERSHIPS_ACCESS' AND NEW."disposition" NOT IN ('DELETE', 'RESTRICT', 'NOT_APPLICABLE'))
    OR (NEW."category" <> 'MEMBERSHIPS_ACCESS' AND NEW."disposition" <> 'NOT_APPLICABLE')
  ) THEN
    RAISE EXCEPTION 'membership-exit decisions are limited to membership access'
      USING ERRCODE = '55000';
  END IF;

  IF case_type = 'USER_ACCOUNT_ERASURE'
    AND NEW."category" IN ('TENANT_OPERATIONAL_DATA', 'ACCOUNTING_TAX_DOCUMENTS', 'ATTACHMENTS_OBJECT_VERSIONS')
    AND NEW."disposition" IN ('DELETE', 'ANONYMIZE', 'RETURN') THEN
    RAISE EXCEPTION 'user-account erasure cannot delete or return tenant-owned records'
      USING ERRCODE = '55000';
  END IF;

  IF case_type = 'COMPANY_WORKSPACE_OFFBOARDING'
    AND NEW."category" IN ('ACCOUNT_IDENTITY', 'AUTHENTICATION_SECRETS')
    AND NEW."disposition" <> 'NOT_APPLICABLE' THEN
    RAISE EXCEPTION 'company offboarding cannot alter members global accounts or credentials'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataRightsDecisionRecord_scope_guard"
BEFORE INSERT ON "DataRightsDecisionRecord"
FOR EACH ROW EXECUTE FUNCTION "enforce_data_rights_decision_scope"();

CREATE FUNCTION "enforce_data_rights_evidence_phase"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  case_status "DataRightsCaseStatus";
  executor_id TEXT;
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
    IF NEW."recordedByUserId" = executor_id THEN
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

CREATE TRIGGER "DataRightsEvidenceRecord_phase_guard"
BEFORE INSERT ON "DataRightsEvidenceRecord"
FOR EACH ROW EXECUTE FUNCTION "enforce_data_rights_evidence_phase"();

CREATE FUNCTION "enforce_data_rights_case_initial_state"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW."status" <> 'RECEIVED'
    OR NEW."identityVerifiedAt" IS NOT NULL OR NEW."identityVerifiedByUserId" IS NOT NULL
    OR NEW."authorityVerifiedAt" IS NOT NULL OR NEW."authorityVerifiedByUserId" IS NOT NULL
    OR NEW."approvedAt" IS NOT NULL OR NEW."approvedByUserId" IS NOT NULL
    OR NEW."executionStartedAt" IS NOT NULL OR NEW."executionStartedByUserId" IS NOT NULL
    OR NEW."verificationStartedAt" IS NOT NULL OR NEW."verificationStartedByUserId" IS NOT NULL
    OR NEW."completedAt" IS NOT NULL OR NEW."completedByUserId" IS NOT NULL
    OR NEW."outcomeSummary" IS NOT NULL THEN
    RAISE EXCEPTION 'a data-rights case must start in RECEIVED without lifecycle evidence stamps'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataRightsCase_initial_state_guard"
BEFORE INSERT ON "DataRightsCase"
FOR EACH ROW EXECUTE FUNCTION "enforce_data_rights_case_initial_state"();

CREATE FUNCTION "enforce_data_rights_active_scope"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  active_statuses "DataRightsCaseStatus"[] := ARRAY[
    'RECEIVED', 'IDENTITY_VERIFIED', 'RETENTION_REVIEW', 'APPROVED', 'EXECUTING', 'VERIFICATION'
  ]::"DataRightsCaseStatus"[];
BEGIN
  -- Case creation is rare and high risk. One transaction lock makes the overlap
  -- checks authoritative even when two different request types arrive together.
  PERFORM pg_advisory_xact_lock(hashtextextended('data-rights:active-scope:v1', 0));

  IF NEW."caseType" = 'USER_ACCOUNT_ERASURE' AND EXISTS (
    SELECT 1
    FROM "DataRightsCase" existing
    WHERE existing."status" = ANY(active_statuses)
      AND (
        (existing."caseType" = 'MEMBERSHIP_EXIT' AND existing."targetUserId" = NEW."targetUserId")
        OR (
          existing."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING'
          AND EXISTS (
            SELECT 1 FROM "CompanyMembership" membership
            WHERE membership."userId" = NEW."targetUserId" AND membership."companyId" = existing."companyId"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'an overlapping active membership/company data-rights case already exists'
      USING ERRCODE = '23505';
  END IF;

  IF NEW."caseType" = 'MEMBERSHIP_EXIT' AND EXISTS (
    SELECT 1
    FROM "DataRightsCase" existing
    WHERE existing."status" = ANY(active_statuses)
      AND (
        (existing."caseType" = 'USER_ACCOUNT_ERASURE' AND existing."targetUserId" = NEW."targetUserId")
        OR (existing."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING' AND existing."companyId" = NEW."companyId")
      )
  ) THEN
    RAISE EXCEPTION 'an overlapping active user/company data-rights case already exists'
      USING ERRCODE = '23505';
  END IF;

  IF NEW."caseType" = 'COMPANY_WORKSPACE_OFFBOARDING' AND EXISTS (
    SELECT 1
    FROM "DataRightsCase" existing
    WHERE existing."status" = ANY(active_statuses)
      AND (
        (existing."caseType" = 'MEMBERSHIP_EXIT' AND existing."companyId" = NEW."companyId")
        OR (
          existing."caseType" = 'USER_ACCOUNT_ERASURE'
          AND EXISTS (
            SELECT 1 FROM "CompanyMembership" membership
            WHERE membership."companyId" = NEW."companyId" AND membership."userId" = existing."targetUserId"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'an overlapping active user/membership data-rights case already exists'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataRightsCase_active_scope_guard"
BEFORE INSERT ON "DataRightsCase"
FOR EACH ROW EXECUTE FUNCTION "enforce_data_rights_active_scope"();

CREATE FUNCTION "deny_data_rights_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "DataRightsDecisionRecord_append_only"
BEFORE UPDATE OR DELETE ON "DataRightsDecisionRecord"
FOR EACH ROW EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE TRIGGER "DataRightsEvidenceRecord_append_only"
BEFORE UPDATE OR DELETE ON "DataRightsEvidenceRecord"
FOR EACH ROW EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE TRIGGER "DataRightsCaseActionRecord_append_only"
BEFORE UPDATE OR DELETE ON "DataRightsCaseActionRecord"
FOR EACH ROW EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE TRIGGER "DataRightsDecisionRecord_no_truncate"
BEFORE TRUNCATE ON "DataRightsDecisionRecord"
FOR EACH STATEMENT EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE TRIGGER "DataRightsEvidenceRecord_no_truncate"
BEFORE TRUNCATE ON "DataRightsEvidenceRecord"
FOR EACH STATEMENT EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE TRIGGER "DataRightsCaseActionRecord_no_truncate"
BEFORE TRUNCATE ON "DataRightsCaseActionRecord"
FOR EACH STATEMENT EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

CREATE FUNCTION "enforce_data_rights_case_transition"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  decision_count INTEGER;
  missing_evidence_count INTEGER;
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
      AND NEW."outcomeSummary" IS NOT DISTINCT FROM OLD."outcomeSummary" THEN
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
      OR NEW."outcomeSummary" IS DISTINCT FROM OLD."outcomeSummary" THEN
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
      OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId")
    AND NOT (OLD."status" = 'RETENTION_REVIEW' AND NEW."status" = 'APPROVED') THEN
    RAISE EXCEPTION 'approval stamps may change only on approval'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."executionStartedAt" IS DISTINCT FROM OLD."executionStartedAt"
      OR NEW."executionStartedByUserId" IS DISTINCT FROM OLD."executionStartedByUserId")
    AND NOT (OLD."status" = 'APPROVED' AND NEW."status" = 'EXECUTING') THEN
    RAISE EXCEPTION 'execution stamps may change only when execution starts'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."verificationStartedAt" IS DISTINCT FROM OLD."verificationStartedAt"
      OR NEW."verificationStartedByUserId" IS DISTINCT FROM OLD."verificationStartedByUserId")
    AND NOT (OLD."status" = 'EXECUTING' AND NEW."status" = 'VERIFICATION') THEN
    RAISE EXCEPTION 'verification stamps may change only when verification starts'
      USING ERRCODE = '55000';
  END IF;
  IF (NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId")
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
    IF NEW."approvedByUserId" = NEW."createdByUserId" THEN
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
    IF NEW."executionStartedByUserId" = NEW."approvedByUserId" THEN
      RAISE EXCEPTION 'data-rights approver cannot execute the case'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW."status" = 'VERIFICATION' THEN
    IF NEW."verificationStartedAt" IS NULL OR NEW."verificationStartedByUserId" IS NULL THEN
      RAISE EXCEPTION 'verification identity and timestamp are required'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."verificationStartedByUserId" = NEW."executionStartedByUserId" THEN
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
    IF NEW."completedByUserId" = NEW."executionStartedByUserId" THEN
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

CREATE TRIGGER "DataRightsCase_transition_guard"
BEFORE UPDATE ON "DataRightsCase"
FOR EACH ROW EXECUTE FUNCTION "enforce_data_rights_case_transition"();

CREATE FUNCTION "deny_data_rights_case_delete"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'DataRightsCase is durable evidence; DELETE is not permitted'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "DataRightsCase_no_delete"
BEFORE DELETE ON "DataRightsCase"
FOR EACH ROW EXECUTE FUNCTION "deny_data_rights_case_delete"();

CREATE TRIGGER "DataRightsCase_no_truncate"
BEFORE TRUNCATE ON "DataRightsCase"
FOR EACH STATEMENT EXECUTE FUNCTION "deny_data_rights_append_only_mutation"();

COMMIT;
