CREATE TYPE "WhtRemittance" AS ENUM ('PAYER_FILES', 'E_WHT');
ALTER TABLE "ExpenseRecord" ADD COLUMN "whtRemittance" "WhtRemittance";
ALTER TABLE "CompanyTaxProfile" ADD COLUMN "eWhtUsed" BOOLEAN NOT NULL DEFAULT false;
