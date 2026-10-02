-- Claim payout Phase 3 (spec reimbursement-payout-account-and-payment-slip §14, §19): sending an
-- approved claim back to have its payout account corrected, on the same claim and number.
--
-- Additive only: six nullable columns on "ReimbursementRequest", never backfilled. Every existing claim
-- keeps NULL in all of them, which reads as "in no correction round, and never was in one". No new
-- request status and no enum value: a claim in a round is PENDING_APPROVAL, so an OLD binary reads it
-- as waiting for approval and refuses its payment by status.
--
--   payoutCorrectionRequestedAt        when the claim was last sent back; NULL = not in a round
--   payoutCorrectionRequestedByUserId  who sent it back
--   payoutCorrectionReasonCode         why, from the fixed list of the contracts package
--   payoutCorrectionNote               an optional note (the API refuses one that carries an account number)
--   payoutCorrectionSubmittedAt        when the requester gave the account again; NULL = still waiting for them
--   payoutCorrectionLogJson            every step of every round, oldest first; kept after the five are cleared
ALTER TABLE "ReimbursementRequest"
  ADD COLUMN IF NOT EXISTS "payoutCorrectionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payoutCorrectionRequestedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutCorrectionReasonCode" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutCorrectionNote" TEXT,
  ADD COLUMN IF NOT EXISTS "payoutCorrectionSubmittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payoutCorrectionLogJson" JSONB;
