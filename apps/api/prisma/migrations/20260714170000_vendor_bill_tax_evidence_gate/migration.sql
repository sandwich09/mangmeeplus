ALTER TABLE "VendorBill"
ADD COLUMN "taxEvidenceRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "taxEvidenceReviewStatus" "TaxEvidenceReviewStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "taxReviewIssuesJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "taxEvidenceReviewedByUserId" TEXT,
ADD COLUMN "taxEvidenceReviewedAt" TIMESTAMP(3);

UPDATE "VendorBill" AS bill
SET "taxEvidenceRequired" = true,
    "taxEvidenceReviewStatus" = 'REVIEW_REQUIRED',
    "taxReviewIssuesJson" = '["tax_evidence_review_required"]'::jsonb,
    "inputVatClaimStatus" = 'NEEDS_REVIEW'
WHERE EXISTS (
  SELECT 1
  FROM "VendorBillLine" AS line
  WHERE line."vendorBillId" = bill.id
    AND line."vatAmount" <> 0
    AND (line."taxContextSnapshot" = 'DOMESTIC_PURCHASE' OR line."taxContextSnapshot" IS NULL)
    AND (line."claimabilitySnapshot" = 'CLAIMABLE' OR line."claimabilitySnapshot" IS NULL)
);

UPDATE "VendorBillLine" AS line
SET "inputVatClaimStatus" = 'NEEDS_REVIEW'
FROM "VendorBill" AS bill
WHERE line."vendorBillId" = bill.id
  AND bill."taxEvidenceRequired" = true
  AND (line."claimabilitySnapshot" = 'CLAIMABLE' OR line."claimabilitySnapshot" IS NULL);
