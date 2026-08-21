-- Fail closed: PostgreSQL treats NULL values as distinct in a composite unique
-- constraint, so the Prisma-declared key cannot protect the company policy row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ReimbursementPolicy"
    WHERE "branchId" IS NULL
    GROUP BY "companyId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_company_policy';
  END IF;
END $$;

-- Keep the deprecated response alias byte-equivalent before the runtime starts
-- dual-writing it with the canonical threshold.
UPDATE "ReimbursementPolicy"
SET "approvalThresholdAmount" = "approvalRequiredFromAmount"
WHERE "approvalThresholdAmount" IS DISTINCT FROM "approvalRequiredFromAmount";

ALTER TABLE "ReimbursementRequest"
ADD COLUMN "approvalPolicySnapshotJson" JSONB;

-- NULL means a legacy role-routed step. New steps freeze the eligible people
-- resolved at submission, so later role edits do not steal work already assigned.
ALTER TABLE "ReimbursementApprovalStep"
ADD COLUMN "assignedApproverUserIdsJson" JSONB;

CREATE UNIQUE INDEX "ReimbursementPolicy_company_default_unique"
ON "ReimbursementPolicy" ("companyId")
WHERE "branchId" IS NULL;
