-- H4 — durable prefilled WHT (50 ทวิ) external handoff.
--
-- `cap.wht50bis/SYSTEM_INITIAL_ISSUE` is SPECIALIST_LEGAL and permanently CLOSED, so the system
-- cannot issue the certificate itself. Until H4 the closed path threw a bare 409 whose Thai message
-- already claimed "บันทึกข้อมูลไว้แล้ว" while persisting nothing. This table is that missing record:
-- a durable, prefilled artifact the operator uses to have the 50 ทวิ issued externally and link back.
--
-- Additive only: new enum + new table + new indexes. No existing column is dropped, widened,
-- narrowed or backfilled, and no NOT NULL is added to an existing table.
--
-- Spec: feature-entitlement-decoupling-spec.md:205, tax-thailand-2026-spec.md:1324-1343.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhtHandoffStatus') THEN
    CREATE TYPE "WhtHandoffStatus" AS ENUM ('REQUIRED', 'EXTERNAL_LINKED', 'SYSTEM_ISSUED', 'CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WhtCertificateHandoff" (
  "id"                        TEXT NOT NULL,
  "status"                    "WhtHandoffStatus" NOT NULL DEFAULT 'REQUIRED',
  "companyId"                 TEXT NOT NULL,
  "sourcePaymentType"         TEXT,
  "sourcePaymentId"           TEXT,
  "payeeId"                   TEXT,
  "branchCode"                TEXT,
  "sourceFeatureKey"          TEXT NOT NULL,
  "taxPeriodId"               TEXT,
  "taxEventIdsJson"           JSONB NOT NULL DEFAULT '[]',
  "prefillSnapshotJson"       JSONB NOT NULL,
  "prefillSnapshotHash"       TEXT NOT NULL,
  "availabilityVectorJson"    JSONB NOT NULL,
  "externalCertificateNumber" TEXT,
  "externalEvidenceRef"       TEXT,
  "linkedAt"                  TIMESTAMP(3),
  "linkedByUserId"            TEXT,
  "creationCommandId"         TEXT NOT NULL,
  "payloadFingerprint"        TEXT NOT NULL,
  "certificateId"             TEXT,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhtCertificateHandoff_pkey" PRIMARY KEY ("id")
);

-- The operative idempotency fence for endpoint-seam rows, whose source identity is null
-- (coordinator ruling OQ-1). Postgres treats NULLs as distinct, so the identity unique below
-- fences settlement-created rows only — exactly where the spec's identity is non-null.
CREATE UNIQUE INDEX IF NOT EXISTS "WhtCertificateHandoff_companyId_creationCommandId_key"
  ON "WhtCertificateHandoff" ("companyId", "creationCommandId");

-- tax-thailand-2026-spec.md:1342 — one handoff per (company, payment, payee).
-- Explicitly named: the derived name would exceed Postgres' 63-char identifier limit and be
-- silently truncated, leaving the schema and the database disagreeing about the index name.
CREATE UNIQUE INDEX IF NOT EXISTS "WhtCertificateHandoff_source_identity_key"
  ON "WhtCertificateHandoff" ("companyId", "sourcePaymentType", "sourcePaymentId", "payeeId");

CREATE INDEX IF NOT EXISTS "WhtCertificateHandoff_companyId_status_idx"
  ON "WhtCertificateHandoff" ("companyId", "status");

CREATE INDEX IF NOT EXISTS "WhtCertificateHandoff_companyId_taxPeriodId_idx"
  ON "WhtCertificateHandoff" ("companyId", "taxPeriodId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WhtCertificateHandoff_companyId_fkey'
  ) THEN
    ALTER TABLE "WhtCertificateHandoff"
      ADD CONSTRAINT "WhtCertificateHandoff_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
