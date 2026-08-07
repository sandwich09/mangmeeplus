CREATE TABLE "CompanyBusinessPolicy" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "discountPolicyJson" JSONB NOT NULL DEFAULT '{}',
  "poApprovalPolicyJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyBusinessPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyBusinessPolicy_companyId_key" ON "CompanyBusinessPolicy"("companyId");
ALTER TABLE "CompanyBusinessPolicy" ADD CONSTRAINT "CompanyBusinessPolicy_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
