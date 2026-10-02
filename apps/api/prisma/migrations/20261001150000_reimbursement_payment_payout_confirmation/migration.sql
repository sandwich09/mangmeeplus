-- Claim payout Phase 1 part B (spec reimbursement-payout-account-and-payment-slip §12.3, §12.4, §15,
-- §19): what the payer confirmed when recording a payment.
--
-- Additive only: three nullable columns, never backfilled. Every existing payment keeps NULL in all
-- three, which reads as "recorded before the pay step asked": no account confirmed, no reason given.
-- An OLD binary reads and writes none of them.
--
--   payoutDestinationVersion  the account the transfer was confirmed into: a version of the claim's
--                             own "ReimbursementPayoutDestination" rows
--   payoutConfirmedAt         when the payer confirmed it
--   methodMismatchReason      why the payer paid by another method than the requester asked for
--
-- §15 (a claim sent before claims carried an account, paid into the requester's default account)
-- needs no column of its own. The copy kept with the payment is one more frozen row of
-- "ReimbursementPayoutDestination" for that claim ("source" = 'LEGACY_PAYMENT', a free-text column),
-- and "payoutDestinationVersion" points at it exactly as it points at a claim's own snapshot. The
-- claim's own payout columns stay NULL, so its approval hash and its signatures are untouched.
ALTER TABLE "ReimbursementPayment"
  ADD COLUMN IF NOT EXISTS "payoutDestinationVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "payoutConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "methodMismatchReason" TEXT;
