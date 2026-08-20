-- Phase 4 of the LINE substitute-receipt assisted issuance spec, in one additive migration so the
-- paper route (4b) needs none: signatureMode/wetSignedScan* carry R10/R11, preparedFromChannel
-- carries the R7 audit trail. Every column has a default or is nullable, so existing rows are
-- untouched and the change is reversible by dropping the columns and the two enums.
-- CreateEnum
CREATE TYPE "SubstituteReceiptSignatureMode" AS ENUM ('DIGITAL', 'PAPER');

-- CreateEnum
CREATE TYPE "SubstituteReceiptPreparedChannel" AS ENUM ('WEB', 'LINE');

-- AlterTable
ALTER TABLE "ExpenseSubstituteReceiptEvidence" ADD COLUMN     "preparedFromChannel" "SubstituteReceiptPreparedChannel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "signatureMode" "SubstituteReceiptSignatureMode" NOT NULL DEFAULT 'DIGITAL',
ADD COLUMN     "wetSignedScanAttachmentId" TEXT,
ADD COLUMN     "wetSignedScanChecksumSha256" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseSubstituteReceiptEvidence_wetSignedScanAttachmentId_key" ON "ExpenseSubstituteReceiptEvidence"("wetSignedScanAttachmentId");
