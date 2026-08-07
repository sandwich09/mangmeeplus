CREATE TYPE "SubstituteReceiptEvidenceStatus" AS ENUM ('PREPARED', 'PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED');

CREATE TABLE "ExpenseSubstituteReceiptEvidence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "branchId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "SubstituteReceiptEvidenceStatus" NOT NULL DEFAULT 'PREPARED',
    "documentNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "snapshotJson" JSONB,
    "snapshotChecksumSha256" TEXT,
    "originalSourceDocumentType" "SourceDocumentType" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "missingReceiptReason" TEXT NOT NULL,
    "businessPurpose" TEXT NOT NULL,
    "paymentEvidenceAttachmentIds" JSONB NOT NULL,
    "supportingAttachmentIds" JSONB NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "paymentMethod" "ExpensePaymentMethod",
    "note" TEXT,
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL,
    "expenseUpdatedAtAtPreparation" TIMESTAMP(3) NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "payerName" TEXT NOT NULL,
    "payerPosition" TEXT,
    "payerSignatureAttachmentId" TEXT,
    "payerSignatureChecksumSha256" TEXT,
    "certifiedArtifactAttachmentId" TEXT,
    "certifiedArtifactChecksumSha256" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "approverUserId" TEXT,
    "approverName" TEXT,
    "approverPosition" TEXT,
    "approverSignatureAttachmentId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "artifactAttachmentId" TEXT,
    "checksumSha256" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersedeReason" TEXT,
    "issuedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseSubstituteReceiptEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_artifactAttachmentId_key"
ON "ExpenseSubstituteReceiptEvidence"("artifactAttachmentId");

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_key"
ON "ExpenseSubstituteReceiptEvidence"("certifiedArtifactAttachmentId");

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_companyId_expenseId_version_key"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "expenseId", "version");

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_companyId_expenseId_idempotencyKey_key"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "expenseId", "idempotencyKey");

CREATE INDEX "ExpenseSubstituteReceiptEvidence_companyId_expenseId_status_idx"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "expenseId", "status");

CREATE INDEX "ExpenseSubstituteReceiptEvidence_companyId_payerUserId_status_idx"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "payerUserId", "status");

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_one_payer_certified_key"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "expenseId") WHERE "status" = 'PAYER_CERTIFIED';

CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_one_issued_key"
ON "ExpenseSubstituteReceiptEvidence"("companyId", "expenseId") WHERE "status" = 'ISSUED';

ALTER TABLE "ExpenseSubstituteReceiptEvidence"
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_version_check" CHECK ("version" > 0),
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_reason_check" CHECK (length(btrim("missingReceiptReason")) > 0),
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_business_purpose_check" CHECK (length(btrim("businessPurpose")) > 0),
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_payer_certified_check" CHECK (
  "status" NOT IN ('PAYER_CERTIFIED', 'ISSUED') OR (
    "snapshotJson" IS NOT NULL AND "snapshotChecksumSha256" IS NOT NULL AND
    "payerPosition" IS NOT NULL AND "payerSignatureAttachmentId" IS NOT NULL AND
    "payerSignatureChecksumSha256" IS NOT NULL AND
    "certifiedArtifactAttachmentId" IS NOT NULL AND
    "certifiedArtifactChecksumSha256" IS NOT NULL AND "certifiedAt" IS NOT NULL
  )
),
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_issued_check" CHECK (
  "status" <> 'ISSUED' OR (
    "approverUserId" IS NOT NULL AND "approverName" IS NOT NULL AND
    "approverPosition" IS NOT NULL AND "approverSignatureAttachmentId" IS NOT NULL AND
    "approvedAt" IS NOT NULL AND "issuedByUserId" IS NOT NULL AND
    "artifactAttachmentId" IS NOT NULL AND "checksumSha256" IS NOT NULL AND "issuedAt" IS NOT NULL
  )
),
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_superseded_check" CHECK (
  "status" <> 'SUPERSEDED' OR ("supersededAt" IS NOT NULL AND length(btrim("supersedeReason")) > 0)
);

ALTER TABLE "ExpenseSubstituteReceiptEvidence"
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseSubstituteReceiptEvidence"
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "ExpenseRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseSubstituteReceiptEvidence"
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_artifactAttachmentId_fkey"
FOREIGN KEY ("artifactAttachmentId") REFERENCES "AttachmentObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseSubstituteReceiptEvidence"
ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_certifiedArtifactAttachmentId_fkey"
FOREIGN KEY ("certifiedArtifactAttachmentId") REFERENCES "AttachmentObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
