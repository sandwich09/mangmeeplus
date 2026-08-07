-- Item 10A: Add ARCHIVED to CompanyStatus and lifecycle timestamps to Company

ALTER TYPE "CompanyStatus" ADD VALUE 'ARCHIVED';

ALTER TABLE "Company"
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "disabledAt"  TIMESTAMP(3),
  ADD COLUMN "archivedAt"  TIMESTAMP(3);
