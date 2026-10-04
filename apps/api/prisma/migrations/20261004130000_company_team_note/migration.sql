-- Platform-only note; no actor FK or restrictive company FK.
CREATE TABLE "CompanyTeamNote" (
    "companyId" TEXT NOT NULL,
    "text" VARCHAR(1000) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyTeamNote_pkey" PRIMARY KEY ("companyId"),
    CONSTRAINT "CompanyTeamNote_version_check" CHECK ("version" >= 0)
);
ALTER TABLE "CompanyTeamNote" ADD CONSTRAINT "CompanyTeamNote_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
