-- Item 10A: WatchDog shared LINE OA platform-level credential (singleton per credentialKind)
CREATE TABLE "PlatformLineCredential" (
    "id"                   TEXT NOT NULL,
    "credentialKind"       "CompanyCredentialKind" NOT NULL,
    "encryptedSecretJson"  TEXT NOT NULL,
    "secretVersion"        INTEGER NOT NULL DEFAULT 1,
    "health"               "CompanyCredentialHealth" NOT NULL DEFAULT 'UNKNOWN',
    "lastValidatedAt"      TIMESTAMP(3),
    "rotatedAt"            TIMESTAMP(3),
    "updatedByAdminUserId" TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformLineCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformLineCredential_credentialKind_key" ON "PlatformLineCredential"("credentialKind");

-- Item 10A: LINE user selected-company context for shared OA multi-company resolution
CREATE TABLE "LineCompanyContext" (
    "id"         TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LineCompanyContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineCompanyContext_lineUserId_key" ON "LineCompanyContext"("lineUserId");
CREATE INDEX "LineCompanyContext_lineUserId_idx" ON "LineCompanyContext"("lineUserId");
