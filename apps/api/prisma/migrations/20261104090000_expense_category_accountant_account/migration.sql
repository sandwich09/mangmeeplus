CREATE TABLE "ExpenseCategoryAccountantAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "expenseCategoryId" TEXT NOT NULL,
    "accountCode" VARCHAR(20) NOT NULL,
    "accountName" VARCHAR(120) NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseCategoryAccountantAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExpenseCategoryAccountantAccount_companyId_expenseCategoryI_key"
    ON "ExpenseCategoryAccountantAccount"("companyId", "expenseCategoryId");
CREATE INDEX "ExpenseCategoryAccountantAccount_companyId_idx"
    ON "ExpenseCategoryAccountantAccount"("companyId");
ALTER TABLE "ExpenseCategoryAccountantAccount" ADD CONSTRAINT "ExpenseCategoryAccountantAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseCategoryAccountantAccount" ADD CONSTRAINT "ExpenseCategoryAccountantAccount_expenseCategoryId_fkey"
    FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
