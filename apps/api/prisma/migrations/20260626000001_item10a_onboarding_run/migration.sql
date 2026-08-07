-- Item 10A: CompanyOnboardingRun for admin-created customer onboarding

CREATE TYPE "OnboardingRunStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED', 'FAILED');

CREATE TABLE "CompanyOnboardingRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "status" "OnboardingRunStatus" NOT NULL DEFAULT 'DRAFT',
  "modulePackage" TEXT,
  "handoffUrl" TEXT,
  "lineAddUrl" TEXT,
  "lineLinkUrl" TEXT,
  "createdBySystemAdminUserId" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyOnboardingRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyOnboardingRun_companyId_idx" ON "CompanyOnboardingRun"("companyId");
CREATE INDEX "CompanyOnboardingRun_createdBySystemAdminUserId_idx" ON "CompanyOnboardingRun"("createdBySystemAdminUserId");

ALTER TABLE "CompanyOnboardingRun"
  ADD CONSTRAINT "CompanyOnboardingRun_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyOnboardingRun"
  ADD CONSTRAINT "CompanyOnboardingRun_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CompanyOnboardingRun"
  ADD CONSTRAINT "CompanyOnboardingRun_createdBySystemAdminUserId_fkey"
  FOREIGN KEY ("createdBySystemAdminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
