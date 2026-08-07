ALTER TABLE "CompanyTaxCodeProfile"
ADD COLUMN "roundingMode" TEXT NOT NULL DEFAULT 'HALF_UP',
ADD COLUMN "roundingScale" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "taxAmountTolerance" DECIMAL(20,6) NOT NULL DEFAULT 0.01;

ALTER TABLE "CompanyTaxCodeProfile"
ADD CONSTRAINT "CompanyTaxCodeProfile_roundingMode_check"
CHECK ("roundingMode" IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')),
ADD CONSTRAINT "CompanyTaxCodeProfile_roundingScale_check"
CHECK ("roundingScale" BETWEEN 0 AND 4),
ADD CONSTRAINT "CompanyTaxCodeProfile_taxAmountTolerance_check"
CHECK ("taxAmountTolerance" >= 0);

ALTER TABLE "TaxEvent"
ADD COLUMN "roundingModeSnapshot" TEXT,
ADD COLUMN "roundingScaleSnapshot" INTEGER,
ADD COLUMN "taxAmountToleranceSnapshot" DECIMAL(20,6);

ALTER TABLE "JournalLine"
ADD COLUMN "roundingModeSnapshot" TEXT,
ADD COLUMN "roundingScaleSnapshot" INTEGER,
ADD COLUMN "taxAmountToleranceSnapshot" DECIMAL(20,6);

ALTER TABLE "AccountingDocumentLine"
ADD COLUMN "roundingModeSnapshot" TEXT,
ADD COLUMN "roundingScaleSnapshot" INTEGER,
ADD COLUMN "taxAmountToleranceSnapshot" DECIMAL(20,6);

ALTER TABLE "ExpenseLine"
ADD COLUMN "roundingModeSnapshot" TEXT,
ADD COLUMN "roundingScaleSnapshot" INTEGER,
ADD COLUMN "taxAmountToleranceSnapshot" DECIMAL(20,6);

ALTER TABLE "VendorBillLine"
ADD COLUMN "roundingModeSnapshot" TEXT,
ADD COLUMN "roundingScaleSnapshot" INTEGER,
ADD COLUMN "taxAmountToleranceSnapshot" DECIMAL(20,6);
