-- Additive foundation only; expense reservations intentionally have no foreign key.
CREATE TYPE "DisbursementVoucherStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');
CREATE TYPE "DisbursementVoucherOrigin" AS ENUM ('PREPARED', 'DIRECT_PAYMENT', 'REISSUED');
CREATE TYPE "DisbursementVoucherPayeeBasis" AS ENUM ('SINGLE', 'TAX_ID', 'SAME_NAME', 'PREPARER_CONFIRMED');
CREATE TYPE "DisbursementVoucherRevisionDecision" AS ENUM ('APPROVED', 'RETURNED', 'WITHDRAWN', 'CANCELLED');

ALTER TABLE "ExpenseRecord" ADD COLUMN "reservedByDisbursementVoucherId" TEXT;

CREATE TABLE "DisbursementVoucher" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentNumber" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "DisbursementVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "DisbursementVoucherOrigin" NOT NULL,
    "replacesVoucherId" TEXT,
    "payeeName" TEXT NOT NULL,
    "payeeTaxId" TEXT,
    "payeeBranchCode" TEXT,
    "payeeBasis" "DisbursementVoucherPayeeBasis" NOT NULL,
    "payeeConfirmedByUserId" TEXT,
    "plannedPayDate" DATE,
    "plannedMethod" "ExpensePaymentMethod",
    "payeeBankName" TEXT,
    "payeeAccountName" TEXT,
    "payeeAccountLast4" TEXT,
    "payeeAccountCiphertext" TEXT,
    "note" TEXT,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "preparedByUserId" TEXT NOT NULL,
    "requestedApproverUserId" TEXT,
    "lastReminderToUserId" TEXT,
    "lastReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "returnedAt" TIMESTAMP(3),
    "returnedByUserId" TEXT,
    "returnReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelReason" TEXT,
    "cancelledAfterPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidDate" DATE,
    "paidRecordedAt" TIMESTAMP(3),
    "paidByUserId" TEXT,
    "paidMethod" "ExpensePaymentMethod",
    "paidFromRef" VARCHAR(128),
    "paidSnapshotJson" JSONB,
    "paidSnapshotHash" TEXT,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "pdfAttachmentId" TEXT,
    "slipAttachmentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DisbursementVoucher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisbursementVoucherRevision" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "decision" "DisbursementVoucherRevisionDecision",
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    CONSTRAINT "DisbursementVoucherRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisbursementVoucherLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "sourceHashAtSubmit" TEXT,
    "expensePaymentId" TEXT,
    "coversPaymentId" TEXT,
    CONSTRAINT "DisbursementVoucherLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DisbursementVoucher_companyId_id_key" ON "DisbursementVoucher"("companyId", "id");
CREATE UNIQUE INDEX "DisbursementVoucher_companyId_documentNumber_key" ON "DisbursementVoucher"("companyId", "documentNumber");
CREATE INDEX "DisbursementVoucher_companyId_status_plannedPayDate_idx" ON "DisbursementVoucher"("companyId", "status", "plannedPayDate");
CREATE INDEX "DisbursementVoucher_companyId_branchId_idx" ON "DisbursementVoucher"("companyId", "branchId");
CREATE UNIQUE INDEX "DisbursementVoucherRevision_voucherId_revision_key" ON "DisbursementVoucherRevision"("voucherId", "revision");
CREATE UNIQUE INDEX "DisbursementVoucherLine_coversPaymentId_key" ON "DisbursementVoucherLine"("coversPaymentId");
CREATE INDEX "DisbursementVoucherLine_companyId_expenseId_idx" ON "DisbursementVoucherLine"("companyId", "expenseId");

ALTER TABLE "DisbursementVoucher" ADD CONSTRAINT "DisbursementVoucher_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisbursementVoucherRevision" ADD CONSTRAINT "DisbursementVoucherRevision_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "DisbursementVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisbursementVoucherLine" ADD CONSTRAINT "DisbursementVoucherLine_companyId_voucherId_fkey" FOREIGN KEY ("companyId", "voucherId") REFERENCES "DisbursementVoucher"("companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DisbursementVoucherLine" ADD CONSTRAINT "DisbursementVoucherLine_companyId_expenseId_fkey" FOREIGN KEY ("companyId", "expenseId") REFERENCES "ExpenseRecord"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
