CREATE TYPE "ExpenseSubstituteReceiptApprovalMode" AS ENUM ('OWNER_SELF', 'DESIGNATED_APPROVERS');

ALTER TABLE "ExpenseSubstituteReceiptPolicy"
  ADD COLUMN "approvalMode" "ExpenseSubstituteReceiptApprovalMode" NOT NULL DEFAULT 'OWNER_SELF';

-- Existing rows were created under the mandatory two-person rule and already name approvers.
-- Keep their control in force; only companies created from now on get the solo-owner default.
UPDATE "ExpenseSubstituteReceiptPolicy" SET "approvalMode" = 'DESIGNATED_APPROVERS';
