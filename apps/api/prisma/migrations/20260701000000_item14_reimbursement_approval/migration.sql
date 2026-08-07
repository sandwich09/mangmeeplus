-- Item 14: Reimbursement Approval and Review
-- Enums, tables, indexes, and foreign keys for the reimbursement workflow.

-- CreateEnum
CREATE TYPE "ReimbursementRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'VOIDED');
CREATE TYPE "ReimbursementApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SKIPPED', 'EXPIRED');
CREATE TYPE "ReimbursementFinanceReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'NEEDS_INFO', 'APPROVED_FOR_PAYMENT', 'BLOCKED');
CREATE TYPE "ReimbursementPaymentStatus" AS ENUM ('NOT_PAYABLE', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED');
CREATE TYPE "ReimbursementDuplicateStatus" AS ENUM ('NOT_CHECKED', 'NO_MATCH', 'POSSIBLE_DUPLICATE', 'CONFIRMED_DUPLICATE', 'OVERRIDDEN');
CREATE TYPE "ReimbursementReceiptRequirementStatus" AS ENUM ('REQUIRED', 'ATTACHED', 'MISSING_WITH_REASON', 'WAIVED_BY_POLICY');
CREATE TYPE "ReimbursementPostingStatus" AS ENUM ('not_required', 'pending', 'posted', 'posting_error', 'reversed');
CREATE TYPE "ReimbursementPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER');
CREATE TYPE "ReimbursementApproverMode" AS ENUM ('DIRECT_MANAGER', 'MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_USER', 'CUSTOM_ROLE');
CREATE TYPE "ReimbursementDuplicatePolicy" AS ENUM ('WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT');
CREATE TYPE "ReimbursementPolicyStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ReimbursementPaymentRecordStatus" AS ENUM ('RECORDED', 'VOIDED');
CREATE TYPE "ReimbursementDuplicateCandidateType" AS ENUM ('ATTACHMENT_CHECKSUM', 'EXPENSE_LINK', 'AMOUNT_DATE_VENDOR', 'MANUAL');
CREATE TYPE "ReimbursementDuplicateCandidateStatus" AS ENUM ('OPEN', 'DISMISSED', 'CONFIRMED', 'OVERRIDDEN');

-- CreateTable
CREATE TABLE "ReimbursementPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "approvalThresholdAmount" DECIMAL(18,4) NOT NULL DEFAULT 1.00,
    "approvalRequiredFromAmount" DECIMAL(18,4) NOT NULL DEFAULT 1.00,
    "approverMode" "ReimbursementApproverMode" NOT NULL DEFAULT 'MANAGER_ROLE',
    "defaultApproverUserId" TEXT,
    "defaultApproverRole" TEXT DEFAULT 'MANAGER',
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "requireReceipt" BOOLEAN NOT NULL DEFAULT true,
    "allowMissingReceiptWithReason" BOOLEAN NOT NULL DEFAULT false,
    "duplicatePolicy" "ReimbursementDuplicatePolicy" NOT NULL DEFAULT 'BLOCK_PAYMENT',
    "financeReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "slaHours" INTEGER,
    "status" "ReimbursementPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "requestNo" TEXT,
    "requesterUserId" TEXT NOT NULL,
    "requesterDisplayNameSnapshot" TEXT NOT NULL,
    "title" TEXT,
    "reason" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "categoryLabelSnapshot" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "incurredDate" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedByUserId" TEXT,
    "currentApproverUserId" TEXT,
    "currentApprovalStepId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "financeReviewStatus" "ReimbursementFinanceReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "financeReviewedByUserId" TEXT,
    "financeReviewedAt" TIMESTAMP(3),
    "financeReviewNote" TEXT,
    "status" "ReimbursementRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "ReimbursementPaymentStatus" NOT NULL DEFAULT 'NOT_PAYABLE',
    "duplicateStatus" "ReimbursementDuplicateStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "receiptRequirementStatus" "ReimbursementReceiptRequirementStatus" NOT NULL DEFAULT 'REQUIRED',
    "postingStatus" "ReimbursementPostingStatus" NOT NULL DEFAULT 'not_required',
    "linkedExpenseId" TEXT,
    "primaryAttachmentId" TEXT,
    "missingReceiptReason" TEXT,
    "approvalSnapshotHash" TEXT,
    "paymentTotalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementApprovalStep" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "approverUserId" TEXT,
    "approverRoleSnapshot" TEXT,
    "status" "ReimbursementApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decisionByUserId" TEXT,
    "comment" TEXT,
    "rejectionReason" TEXT,
    "requestSnapshotHash" TEXT NOT NULL,
    "invalidatedAt" TIMESTAMP(3),
    "invalidatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "paymentNo" TEXT,
    "paidAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "paymentMethod" "ReimbursementPaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentReference" TEXT,
    "bankAccountId" TEXT,
    "sourcePaymentRef" TEXT NOT NULL,
    "status" "ReimbursementPaymentRecordStatus" NOT NULL DEFAULT 'RECORDED',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "paidByUserId" TEXT NOT NULL,
    "voidedByUserId" TEXT,
    "postingStatus" "ReimbursementPostingStatus" NOT NULL DEFAULT 'not_required',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReimbursementDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reimbursementRequestId" TEXT NOT NULL,
    "candidateType" "ReimbursementDuplicateCandidateType" NOT NULL,
    "candidateRequestId" TEXT,
    "candidateExpenseId" TEXT,
    "candidateAttachmentId" TEXT,
    "score" INTEGER NOT NULL,
    "status" "ReimbursementDuplicateCandidateStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReimbursementDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReimbursementPolicy_companyId_status_idx" ON "ReimbursementPolicy"("companyId", "status");
CREATE UNIQUE INDEX "ReimbursementPolicy_companyId_branchId_key" ON "ReimbursementPolicy"("companyId", "branchId");
CREATE INDEX "ReimbursementRequest_companyId_requesterUserId_status_idx" ON "ReimbursementRequest"("companyId", "requesterUserId", "status");
CREATE INDEX "ReimbursementRequest_companyId_currentApproverUserId_status_idx" ON "ReimbursementRequest"("companyId", "currentApproverUserId", "status");
CREATE INDEX "ReimbursementRequest_companyId_status_paymentStatus_idx" ON "ReimbursementRequest"("companyId", "status", "paymentStatus");
CREATE UNIQUE INDEX "ReimbursementRequest_companyId_requestNo_key" ON "ReimbursementRequest"("companyId", "requestNo");
CREATE INDEX "ReimbursementApprovalStep_companyId_approverUserId_status_idx" ON "ReimbursementApprovalStep"("companyId", "approverUserId", "status");
CREATE INDEX "ReimbursementApprovalStep_reimbursementRequestId_sequenceNo_idx" ON "ReimbursementApprovalStep"("reimbursementRequestId", "sequenceNo");
CREATE INDEX "ReimbursementPayment_companyId_reimbursementRequestId_statu_idx" ON "ReimbursementPayment"("companyId", "reimbursementRequestId", "status");
CREATE INDEX "ReimbursementPayment_companyId_paidAt_paymentMethod_idx" ON "ReimbursementPayment"("companyId", "paidAt", "paymentMethod");
CREATE INDEX "ReimbursementDuplicateCandidate_companyId_reimbursementRequ_idx" ON "ReimbursementDuplicateCandidate"("companyId", "reimbursementRequestId", "status");

-- AddForeignKey
ALTER TABLE "ReimbursementPolicy" ADD CONSTRAINT "ReimbursementPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementApprovalStep" ADD CONSTRAINT "ReimbursementApprovalStep_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementApprovalStep" ADD CONSTRAINT "ReimbursementApprovalStep_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementPayment" ADD CONSTRAINT "ReimbursementPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementPayment" ADD CONSTRAINT "ReimbursementPayment_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementDuplicateCandidate" ADD CONSTRAINT "ReimbursementDuplicateCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementDuplicateCandidate" ADD CONSTRAINT "ReimbursementDuplicateCandidate_reimbursementRequestId_fkey" FOREIGN KEY ("reimbursementRequestId") REFERENCES "ReimbursementRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
