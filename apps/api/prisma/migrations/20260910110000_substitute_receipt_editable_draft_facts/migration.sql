-- Drafts can be incomplete while being corrected; signed/issued facts remain mandatory.
-- Keep superseded drafts retainable as history without inventing placeholder text.
ALTER TABLE "ExpenseSubstituteReceiptEvidence"
  DROP CONSTRAINT "ExpenseSubstituteReceiptEvidence_reason_check",
  DROP CONSTRAINT "ExpenseSubstituteReceiptEvidence_business_purpose_check",
  ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_reason_check"
    CHECK ("status" IN ('PREPARED', 'SUPERSEDED') OR length(btrim("missingReceiptReason")) > 0),
  ADD CONSTRAINT "ExpenseSubstituteReceiptEvidence_business_purpose_check"
    CHECK ("status" IN ('PREPARED', 'SUPERSEDED') OR length(btrim("businessPurpose")) > 0);
