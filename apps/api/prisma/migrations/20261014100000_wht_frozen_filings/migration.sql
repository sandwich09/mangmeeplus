-- Additive only: historical periods/packages are not reconstructed or rewritten.
CREATE TABLE "WhtFiling" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "taxPeriodId" TEXT NOT NULL,
  "formType" "TaxFormType" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "establishmentCode" TEXT NOT NULL,
  "establishmentBranchId" TEXT,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "status" "TaxPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "preparedBy" TEXT NOT NULL,
  "payerSnapshotJson" JSONB NOT NULL,
  "rowsChecksum" TEXT NOT NULL,
  "filingPackageId" TEXT,
  "downloadedAt" TIMESTAMP(3),
  "filedAt" TIMESTAMP(3),
  "filedByUserId" TEXT,
  "filedNote" TEXT,
  "rowsCertain" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhtFiling_taxPeriodId_fkey" FOREIGN KEY ("taxPeriodId") REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WhtFiling_filingPackageId_fkey" FOREIGN KEY ("filingPackageId") REFERENCES "TaxFilingPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WhtFiling_establishmentCode_check" CHECK ("establishmentCode" ~ '^[0-9]{5}$'),
  CONSTRAINT "WhtFiling_sequence_check" CHECK ("sequence" >= 0)
);
CREATE UNIQUE INDEX "WhtFiling_paper_key" ON "WhtFiling"("companyId", "formType", "periodKey", "establishmentCode", "sequence");
CREATE UNIQUE INDEX "WhtFiling_filingPackageId_key" ON "WhtFiling"("filingPackageId");
CREATE INDEX "WhtFiling_companyId_taxPeriodId_idx" ON "WhtFiling"("companyId", "taxPeriodId");
CREATE TABLE "WhtFilingLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "whtFilingId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "taxEventId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "lineJson" JSONB NOT NULL,
  CONSTRAINT "WhtFilingLine_whtFilingId_fkey" FOREIGN KEY ("whtFilingId") REFERENCES "WhtFiling"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhtFilingLine_whtFilingId_rowNumber_key" ON "WhtFilingLine"("whtFilingId", "rowNumber");
CREATE INDEX "WhtFilingLine_sourceType_sourceId_idx" ON "WhtFilingLine"("sourceType", "sourceId");
CREATE INDEX "WhtFilingLine_taxEventId_idx" ON "WhtFilingLine"("taxEventId");
ALTER TABLE "TaxFilingPackage" ADD COLUMN "whtFilingId" TEXT;
ALTER TABLE "TaxFilingPackage" ADD CONSTRAINT "TaxFilingPackage_whtFilingId_fkey" FOREIGN KEY ("whtFilingId") REFERENCES "WhtFiling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TaxFilingPackage_whtFilingId_idx" ON "TaxFilingPackage"("whtFilingId");
