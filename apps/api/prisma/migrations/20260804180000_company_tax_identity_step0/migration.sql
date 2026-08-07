-- Step 0 — Company tax identity, Release A (additive only).
-- Spec: docs/specs/company-tax-identity-setup-spec.md v2.9 §4-§8, §16, §17.
--
-- Additive by construction: every new column is nullable or defaulted, every new table is
-- created empty, and NO constraint is placed on pre-existing data. The §6.3 branch constraints
-- (one taxBranchCode per company, one ACTIVE head office) belong to Release B1, after the
-- reconciliation window has driven live conflicts to zero — adding them here would fail the
-- deploy on real tenants. Same reason there is no generator run and no data assertion in this
-- file: `migrate deploy` runs pending migrations back to back with no place for a human to
-- intervene, so a failing assertion would leave a failed row in _prisma_migrations.

-- CreateEnum
CREATE TYPE "LegalIdentityAuthorityReason" AS ENUM ('TIN_VERIFIED', 'VAT_MATCHED', 'TAX_DOCUMENT_ISSUED');

-- CreateEnum
CREATE TYPE "TinExistenceStatus" AS ENUM ('VERIFIED', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "VatDetailStatus" AS ENUM ('MATCHED', 'NOT_FOUND', 'MISMATCH');

-- CreateEnum
CREATE TYPE "VerificationAttemptStatus" AS ENUM ('VERIFIED', 'NOT_FOUND', 'MISMATCH', 'SERVICE_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "LegalIdentityChangeKind" AS ENUM ('INITIAL_CAPTURE', 'CORRECTION', 'LEGAL_CHANGE', 'RECONCILIATION_CORRECTION');

-- CreateEnum
CREATE TYPE "LegalIdentityCorrectionReason" AS ENUM ('TYPO', 'FORMATTING', 'TRANSLITERATION');

-- CreateEnum
CREATE TYPE "BuyerEntityKind" AS ENUM ('JURISTIC', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "BuyerVatStatus" AS ENUM ('VAT_REGISTERED', 'NOT_REGISTERED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VatFactStatus" AS ENUM ('REGISTERED', 'NOT_REGISTERED');

-- CreateEnum
CREATE TYPE "VatFactSource" AS ENUM ('LEGACY_SEED', 'USER_ANSWER', 'RD_VERIFIED', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('TAX_ID', 'BRANCH_DUP', 'VAT_HINT');

-- CreateEnum
CREATE TYPE "ReconciliationSourceState" AS ENUM ('ALIGNED', 'PENDING_ONE_SIDED', 'PENDING_CONFLICT');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BuyerEvidenceChangeKind" AS ENUM ('INITIAL_REMEDIATION', 'DATA_CORRECTION');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "lastLegalChangeEffectiveDate" DATE,
ADD COLUMN     "legalIdentityAuthoritativeAt" TIMESTAMP(3),
ADD COLUMN     "legalIdentityAuthoritativeReason" "LegalIdentityAuthorityReason",
ADD COLUMN     "legalIdentityAuthoritativeRef" TEXT,
ADD COLUMN     "legalIdentityCaptureCompletedAt" TIMESTAMP(3),
ADD COLUMN     "legalIdentityVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tinExistsAt" TIMESTAMP(3),
ADD COLUMN     "tinExistsStatus" "TinExistenceStatus",
ADD COLUMN     "tinSubjectHmac" TEXT,
ADD COLUMN     "tinSubjectHmacKeyVersion" INTEGER,
ADD COLUMN     "vatDetailAt" TIMESTAMP(3),
ADD COLUMN     "vatDetailSelectedBranchCode" TEXT,
ADD COLUMN     "vatDetailSnapshotJson" JSONB,
ADD COLUMN     "vatDetailStatus" "VatDetailStatus",
ADD COLUMN     "verificationLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "verificationLastAttemptStatus" "VerificationAttemptStatus";

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "isVatEstablishment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AccountingCounterparty" ADD COLUMN     "entityKind" "BuyerEntityKind",
ADD COLUMN     "vatStatus" "BuyerVatStatus";

-- AlterTable
ALTER TABLE "AccountingDocument" ADD COLUMN     "buyerTaxIdentityDraftJson" JSONB,
ADD COLUMN     "sellerEstablishmentBranchId" TEXT,
ADD COLUMN     "sellerSnapshotJson" JSONB;

-- AlterTable
ALTER TABLE "TaxEvent" ADD COLUMN     "sellerBranchCode" TEXT;

-- CreateTable
CREATE TABLE "CompanyLegalIdentityRevision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "legalIdentityVersion" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "changeKind" "LegalIdentityChangeKind" NOT NULL,
    "effectiveFrom" DATE,
    "correctionReason" "LegalIdentityCorrectionReason",
    "reconciliationItemId" TEXT,
    "repairCommandId" TEXT,
    "note" TEXT,
    "evidenceRef" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyLegalIdentityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVatRegistrationState" (
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyVatRegistrationState_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "CompanyVatRegistrationCommand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "expectedStateVersion" INTEGER NOT NULL,
    "resultStateVersion" INTEGER NOT NULL,
    "resultFactId" TEXT,
    "resultKind" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVatRegistrationCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyVatRegistrationFact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "VatFactStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "source" "VatFactSource" NOT NULL,
    "evidenceRef" TEXT,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByCommandId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyVatRegistrationFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VatRegistrationPrompt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "promptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VatRegistrationPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIdentityReconciliationItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "discriminator" TEXT NOT NULL,
    "sourceState" "ReconciliationSourceState" NOT NULL,
    "payloadMaskedJson" JSONB NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "resolutionCommandId" TEXT,
    "resolutionJson" JSONB,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyIdentityReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingDocumentIssueCommand" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "payloadFingerprint" TEXT NOT NULL,
    "resultDocumentNumber" TEXT NOT NULL,
    "entitlementEpochsJson" JSONB NOT NULL,
    "launchEntriesJson" JSONB NOT NULL,
    "availabilityVectorHash" TEXT NOT NULL,
    "preGateCutoff" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingDocumentIssueCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingDocumentBuyerEvidenceRevision" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "commandId" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "snapshotSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "buyerSnapshotJson" JSONB NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "changeKind" "BuyerEvidenceChangeKind" NOT NULL,
    "note" TEXT,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingDocumentBuyerEvidenceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingIssueAuthzObservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "documentType" "AccountingDocumentType" NOT NULL,
    "missingPermissionKey" TEXT NOT NULL,
    "hourBucketUtc" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingIssueAuthzObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyLegalIdentityRevision_companyId_changeKind_effective_idx" ON "CompanyLegalIdentityRevision"("companyId", "changeKind", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CompanyLegalIdentityRevision_companyId_createdAt_idx" ON "CompanyLegalIdentityRevision"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLegalIdentityRevision_companyId_legalIdentityVersion_key" ON "CompanyLegalIdentityRevision"("companyId", "legalIdentityVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyLegalIdentityRevision_companyId_repairCommandId_key" ON "CompanyLegalIdentityRevision"("companyId", "repairCommandId");

-- CreateIndex
CREATE INDEX "CompanyVatRegistrationCommand_companyId_createdAt_idx" ON "CompanyVatRegistrationCommand"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVatRegistrationCommand_companyId_commandId_key" ON "CompanyVatRegistrationCommand"("companyId", "commandId");

-- CreateIndex
CREATE INDEX "CompanyVatRegistrationFact_companyId_supersededAt_effective_idx" ON "CompanyVatRegistrationFact"("companyId", "supersededAt", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyVatRegistrationFact_companyId_id_key" ON "CompanyVatRegistrationFact"("companyId", "id");

-- CreateIndex
CREATE INDEX "VatRegistrationPrompt_companyId_resolvedAt_idx" ON "VatRegistrationPrompt"("companyId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VatRegistrationPrompt_companyId_context_key" ON "VatRegistrationPrompt"("companyId", "context");

-- CreateIndex
CREATE INDEX "CompanyIdentityReconciliationItem_companyId_status_kind_idx" ON "CompanyIdentityReconciliationItem"("companyId", "status", "kind");

-- CreateIndex
CREATE INDEX "CompanyIdentityReconciliationItem_status_kind_idx" ON "CompanyIdentityReconciliationItem"("status", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyIdentityReconciliationItem_companyId_id_key" ON "CompanyIdentityReconciliationItem"("companyId", "id");

-- CreateIndex
CREATE INDEX "AccountingDocumentIssueCommand_companyId_documentId_idx" ON "AccountingDocumentIssueCommand"("companyId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocumentIssueCommand_companyId_commandId_key" ON "AccountingDocumentIssueCommand"("companyId", "commandId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_evidence_revision_company_document_revision_key" ON "AccountingDocumentBuyerEvidenceRevision"("companyId", "documentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_evidence_revision_company_document_command_key" ON "AccountingDocumentBuyerEvidenceRevision"("companyId", "documentId", "commandId");

-- CreateIndex
CREATE INDEX "AccountingIssueAuthzObservation_hourBucketUtc_idx" ON "AccountingIssueAuthzObservation"("hourBucketUtc");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingIssueAuthzObservation_companyId_roleKey_documentT_key" ON "AccountingIssueAuthzObservation"("companyId", "roleKey", "documentType", "missingPermissionKey", "hourBucketUtc");

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_companyId_sellerEstablishmentBranchId_fkey" FOREIGN KEY ("companyId", "sellerEstablishmentBranchId") REFERENCES "Branch"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLegalIdentityRevision" ADD CONSTRAINT "CompanyLegalIdentityRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyLegalIdentityRevision" ADD CONSTRAINT "CompanyLegalIdentityRevision_companyId_reconciliationItemI_fkey" FOREIGN KEY ("companyId", "reconciliationItemId") REFERENCES "CompanyIdentityReconciliationItem"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVatRegistrationState" ADD CONSTRAINT "CompanyVatRegistrationState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVatRegistrationCommand" ADD CONSTRAINT "CompanyVatRegistrationCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVatRegistrationCommand" ADD CONSTRAINT "CompanyVatRegistrationCommand_companyId_resultFactId_fkey" FOREIGN KEY ("companyId", "resultFactId") REFERENCES "CompanyVatRegistrationFact"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyVatRegistrationFact" ADD CONSTRAINT "CompanyVatRegistrationFact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VatRegistrationPrompt" ADD CONSTRAINT "VatRegistrationPrompt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIdentityReconciliationItem" ADD CONSTRAINT "CompanyIdentityReconciliationItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentIssueCommand" ADD CONSTRAINT "AccountingDocumentIssueCommand_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentIssueCommand" ADD CONSTRAINT "AccountingDocumentIssueCommand_companyId_documentId_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "AccountingDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentBuyerEvidenceRevision" ADD CONSTRAINT "AccountingDocumentBuyerEvidenceRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocumentBuyerEvidenceRevision" ADD CONSTRAINT "AccountingDocumentBuyerEvidenceRevision_companyId_document_fkey" FOREIGN KEY ("companyId", "documentId") REFERENCES "AccountingDocument"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingIssueAuthzObservation" ADD CONSTRAINT "AccountingIssueAuthzObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Partial unique: at most one PENDING reconciliation item per key ──────────────────────────
-- Prisma cannot express a partial index, so it is raw SQL here. This one is safe in Release A
-- precisely because this migration created the table itself, empty. It allows RESOLVED rows
-- to accumulate without limit, which is what makes the resolve history append-only: a drift
-- found after a resolve inserts a NEW pending row instead of reopening the closed one.
CREATE UNIQUE INDEX "identity_reconciliation_item_pending_key"
  ON "CompanyIdentityReconciliationItem" ("companyId", "kind", "discriminator")
  WHERE "status" = 'PENDING';

-- ── Backfill 1: ภ.พ.20 establishments ───────────────────────────────────────────────────────
-- A branch that already carries a taxBranchCode is by definition a registered establishment.
-- The reverse is not inferred: a branch WITHOUT a code stays false, which is the default.
UPDATE "Branch" SET "isVatEstablishment" = true WHERE "taxBranchCode" IS NOT NULL;

-- ── Backfill 2: VAT registration state row per company ──────────────────────────────────────
-- Version 0 for everyone, so the CC4 compare-and-set has something to compare against on the
-- first command. Created here rather than lazily: a lazy create inside the command transaction
-- would race two concurrent first answers.
INSERT INTO "CompanyVatRegistrationState" ("companyId", "version", "createdAt", "updatedAt")
SELECT c."id", 0, NOW(), NOW()
FROM "Company" c
WHERE NOT EXISTS (SELECT 1 FROM "CompanyVatRegistrationState" s WHERE s."companyId" = c."id");

-- ── Backfill 3: seed a VAT fact only where the legacy answer carries a DATE ──────────────────
-- CompanyTaxProfile is the only place holding vatEffectiveDate, so it is the only legacy answer
-- that can become a dated fact. `vatRegistered = true` with no date is a HINT, not a fact: it
-- becomes a VAT_HINT reconciliation item for a human to date, produced by the operational
-- generator — never seeded here as if someone had answered it.
--
-- Company."vatRegistered" is deliberately NOT touched. It is read at seven call sites today and
-- writing it would change Release A behaviour; the mirror is maintained from the PUT command
-- onward, and any disagreement it has with the seeded fact is exactly what the VAT_HINT lane
-- is for.
INSERT INTO "CompanyVatRegistrationFact" (
  "id", "companyId", "status", "effectiveFrom", "effectiveTo", "source", "answeredAt", "createdAt"
)
-- Plain ::date on a `timestamp without time zone`, deliberately: it truncates the stored time
-- with no session timezone involved. `AT TIME ZONE 'UTC'` would produce a timestamptz whose
-- ::date depends on the running session's TimeZone, so the same migration would seed different
-- days on different servers. (Today no code writes vatEffectiveDate at all, so this seeds
-- nothing in practice — it exists for hand-populated rows.)
SELECT gen_random_uuid()::text, p."companyId", 'REGISTERED'::"VatFactStatus",
       p."vatEffectiveDate"::date, NULL, 'LEGACY_SEED'::"VatFactSource", NOW(), NOW()
FROM "CompanyTaxProfile" p
WHERE p."vatRegistered" = true
  AND p."vatEffectiveDate" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "CompanyVatRegistrationFact" f WHERE f."companyId" = p."companyId");
