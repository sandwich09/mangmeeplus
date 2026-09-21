-- Reimbursement step journey spec §7/§14, owner decision D2 + A1 (2026-09-19): "ตรวจการเงินก่อนจ่าย"
-- (finance review before payment) defaults to OFF so a solo owner can finish a claim — submit,
-- approve, pay — in one sitting without an extra desk. Existing companies get the same default,
-- not just fresh ones, so this is a real behavior change rather than a new-row default alone.
--
-- Safe for claims already in flight: every ReimbursementRequest freezes its policy at submit time
-- into approvalPolicySnapshotJson (reimbursement.constants.ts effectivePolicyForRequest), so this
-- never changes how an in-flight or historical claim is routed — only which value a NEW submission
-- reads. A company that wants finance review back can flip the policy switch on again from settings;
-- this migration only changes the column default and today's stored rows.
--
-- Idempotent: SET DEFAULT is a plain catalog change, and the UPDATE only touches rows still `true`,
-- so re-running this file is a no-op the second time.
ALTER TABLE "ReimbursementPolicy" ALTER COLUMN "financeReviewRequired" SET DEFAULT false;

UPDATE "ReimbursementPolicy" SET "financeReviewRequired" = false WHERE "financeReviewRequired" = true;
