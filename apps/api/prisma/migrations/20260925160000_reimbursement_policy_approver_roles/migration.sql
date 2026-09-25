-- AlterTable
ALTER TABLE "ReimbursementPolicy" ADD COLUMN     "defaultApproverRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- A policy keeps routing to the one role it already had.
UPDATE "ReimbursementPolicy"
SET "defaultApproverRoles" = ARRAY["defaultApproverRole"]
WHERE "defaultApproverRole" IS NOT NULL;
