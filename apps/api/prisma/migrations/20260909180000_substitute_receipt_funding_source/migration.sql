CREATE TYPE "SubstituteReceiptFundingSource" AS ENUM ('COMPANY', 'PERSONAL_ADVANCE');
ALTER TABLE "ExpenseSubstituteReceiptEvidence" ADD COLUMN "fundingSource" "SubstituteReceiptFundingSource";
