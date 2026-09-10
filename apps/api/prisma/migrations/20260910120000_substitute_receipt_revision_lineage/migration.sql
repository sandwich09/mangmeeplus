-- Automatic edits have a lineage independent of issued financial corrections.
ALTER TABLE "ExpenseSubstituteReceiptEvidence" ADD COLUMN "revisionOfEvidenceId" TEXT;
