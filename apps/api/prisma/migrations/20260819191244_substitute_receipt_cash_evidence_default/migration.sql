-- R6: new policy rows default to the permissive cash-evidence rule. Existing rows keep the value
-- their company already chose — this statement changes the default only, never stored data.
-- AlterTable
ALTER TABLE "ExpenseSubstituteReceiptPolicy" ALTER COLUMN "cashEvidencePolicy" SET DEFAULT 'ALLOW_SUPPORTING_EVIDENCE_ONLY';
