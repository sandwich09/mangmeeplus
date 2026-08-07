-- CreateEnum
CREATE TYPE "SourceDocumentType" AS ENUM ('RECEIPT', 'TAX_INVOICE', 'TRANSFER_SLIP', 'HANDWRITTEN_CASH_BILL', 'SUPPLIER_BILL', 'MARKETPLACE_ORDER_SCREENSHOT', 'EXPENSE_NOTE_TEXT', 'SUBSTITUTE_RECEIPT', 'OTHER_EXPENSE_DOCUMENT', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "TaxEvidenceStatus" AS ENUM ('USABLE_FOR_TAX', 'SUPPORTING_ONLY', 'NOT_TAX_EVIDENCE', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ExpenseLineReviewStatus" AS ENUM ('SUGGESTED', 'REVIEWED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SignatureAssetStatus" AS ENUM ('PENDING_OWNER_APPROVAL', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SignatureSubmitChannel" AS ENUM ('WEB', 'LINE');

-- AlterTable
ALTER TABLE "ExpenseRecord" ADD COLUMN     "sourceChannelMetadataJson" JSONB,
ADD COLUMN     "sourceDocumentLanguage" TEXT,
ADD COLUMN     "sourceDocumentType" "SourceDocumentType" NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN     "substituteReceiptGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "substituteReceiptGeneratedByUserId" TEXT,
ADD COLUMN     "taxEvidenceReasonCode" TEXT,
ADD COLUMN     "taxEvidenceStatus" "TaxEvidenceStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: existing rows were uploaded when they were created.
UPDATE "ExpenseRecord" SET "uploadedAt" = "createdAt";

-- AlterTable
ALTER TABLE "ExpenseLine" ADD COLUMN     "aiLineConfidence" DOUBLE PRECISION,
ADD COLUMN     "reviewStatus" "ExpenseLineReviewStatus" NOT NULL DEFAULT 'REVIEWED',
ADD COLUMN     "sourceLineText" TEXT;

-- CreateTable
CREATE TABLE "CompanySignatureAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT,
    "status" "SignatureAssetStatus" NOT NULL DEFAULT 'PENDING_OWNER_APPROVAL',
    "originalAttachmentId" TEXT NOT NULL,
    "derivedAttachmentId" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "submittedFromChannel" "SignatureSubmitChannel" NOT NULL DEFAULT 'WEB',
    "lineMessageId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySignatureAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureFillRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "signatureAssetId" TEXT NOT NULL,
    "appliedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renderedAttachmentId" TEXT,
    "placeholder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureFillRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanySignatureAsset_companyId_status_idx" ON "CompanySignatureAsset"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanySignatureAsset_companyId_lineMessageId_idx" ON "CompanySignatureAsset"("companyId", "lineMessageId");

-- CreateIndex
CREATE INDEX "SignatureFillRecord_companyId_expenseId_idx" ON "SignatureFillRecord"("companyId", "expenseId");

-- CreateIndex
CREATE INDEX "SignatureFillRecord_companyId_signatureAssetId_idx" ON "SignatureFillRecord"("companyId", "signatureAssetId");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_uploadedAt_idx" ON "ExpenseRecord"("companyId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ExpenseRecord_companyId_taxEvidenceStatus_idx" ON "ExpenseRecord"("companyId", "taxEvidenceStatus");

-- AddForeignKey
ALTER TABLE "CompanySignatureAsset" ADD CONSTRAINT "CompanySignatureAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureFillRecord" ADD CONSTRAINT "SignatureFillRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureFillRecord" ADD CONSTRAINT "SignatureFillRecord_signatureAssetId_fkey" FOREIGN KEY ("signatureAssetId") REFERENCES "CompanySignatureAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

