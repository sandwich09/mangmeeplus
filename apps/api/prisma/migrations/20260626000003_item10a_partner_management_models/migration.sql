-- Item 10A: Partner management models

CREATE TYPE "CompanyCredentialKind" AS ENUM ('LINE_MESSAGING_API', 'LINE_LOGIN', 'LINE_LIFF');
CREATE TYPE "CompanyCredentialHealth" AS ENUM ('OK', 'ERROR', 'UNKNOWN');

CREATE TABLE "CompanyFeatureEntitlement" (
  "id"                         TEXT NOT NULL,
  "companyId"                  TEXT NOT NULL,
  "featureKey"                 TEXT NOT NULL,
  "enabled"                    BOOLEAN NOT NULL DEFAULT false,
  "updatedBySystemAdminUserId" TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyFeatureEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyAiConfiguration" (
  "id"                         TEXT NOT NULL,
  "companyId"                  TEXT NOT NULL,
  "modelId"                    TEXT NOT NULL,
  "updatedBySystemAdminUserId" TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyAiConfiguration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyIntegrationCredential" (
  "id"                         TEXT NOT NULL,
  "companyId"                  TEXT NOT NULL,
  "provider"                   TEXT NOT NULL DEFAULT 'LINE',
  "credentialKind"             "CompanyCredentialKind" NOT NULL,
  "encryptedSecretJson"        TEXT NOT NULL,
  "secretVersion"              INTEGER NOT NULL DEFAULT 1,
  "health"                     "CompanyCredentialHealth" NOT NULL DEFAULT 'UNKNOWN',
  "lastValidatedAt"            TIMESTAMP(3),
  "rotatedAt"                  TIMESTAMP(3),
  "updatedBySystemAdminUserId" TEXT,
  "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyIntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyAiConfiguration_companyId_key"
  ON "CompanyAiConfiguration"("companyId");

CREATE UNIQUE INDEX "CompanyFeatureEntitlement_companyId_featureKey_key"
  ON "CompanyFeatureEntitlement"("companyId", "featureKey");

CREATE INDEX "CompanyFeatureEntitlement_companyId_enabled_idx"
  ON "CompanyFeatureEntitlement"("companyId", "enabled");

CREATE UNIQUE INDEX "CompanyIntegrationCredential_companyId_provider_credentialKind_key"
  ON "CompanyIntegrationCredential"("companyId", "provider", "credentialKind");

CREATE INDEX "CompanyIntegrationCredential_companyId_idx"
  ON "CompanyIntegrationCredential"("companyId");

ALTER TABLE "CompanyFeatureEntitlement"
  ADD CONSTRAINT "CompanyFeatureEntitlement_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyAiConfiguration"
  ADD CONSTRAINT "CompanyAiConfiguration_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyIntegrationCredential"
  ADD CONSTRAINT "CompanyIntegrationCredential_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
