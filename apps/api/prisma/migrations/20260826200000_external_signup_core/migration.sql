-- P10-0 external signup core only. No public route or provider integration is enabled here.

CREATE TYPE "CompanySignupState" AS ENUM (
    'RECEIVED', 'VALIDATED', 'EMAIL_PENDING', 'EMAIL_VERIFIED', 'PROVISIONING', 'READY',
    'LINE_LINK_PENDING', 'COMPLETED', 'EMAIL_FAILED', 'PROVISIONING_FAILED', 'SUSPENDED', 'EXPIRED'
);

CREATE TABLE "CompanySignupRequest" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'official-site',
    "externalSignupId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "taxId" TEXT,
    "ownerDisplayName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "referralCode" TEXT,
    "requestedOfferKey" TEXT,
    "state" "CompanySignupState" NOT NULL DEFAULT 'RECEIVED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "provisioningAttemptId" TEXT,
    "provisioningStartedAt" TIMESTAMP(3),
    "companyId" TEXT,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanySignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanySignupRequest_externalSignupId_key" ON "CompanySignupRequest"("externalSignupId");
CREATE UNIQUE INDEX "CompanySignupRequest_provisioningAttemptId_key" ON "CompanySignupRequest"("provisioningAttemptId");
CREATE INDEX "CompanySignupRequest_state_updatedAt_idx" ON "CompanySignupRequest"("state", "updatedAt");
CREATE INDEX "CompanySignupRequest_contactEmail_idx" ON "CompanySignupRequest"("contactEmail");
CREATE INDEX "CompanySignupRequest_taxId_idx" ON "CompanySignupRequest"("taxId");
CREATE INDEX "CompanySignupRequest_companyId_idx" ON "CompanySignupRequest"("companyId");
CREATE INDEX "CompanySignupRequest_ownerUserId_idx" ON "CompanySignupRequest"("ownerUserId");

ALTER TABLE "CompanySignupRequest" ADD CONSTRAINT "CompanySignupRequest_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanySignupRequest" ADD CONSTRAINT "CompanySignupRequest_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
