ALTER TABLE "DisbursementVoucherRevision"
ADD COLUMN "postApprovalAction" "DisbursementVoucherRevisionDecision",
ADD COLUMN "postApprovalByUserId" TEXT,
ADD COLUMN "postApprovalAt" TIMESTAMP(3),
ADD COLUMN "postApprovalReason" TEXT;
