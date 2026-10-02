-- Claim payout Phase 2 (spec reimbursement-payout-account-and-payment-slip §12.5, §19): the slip a
-- payment was recorded with, and that file's checksum at the time. Both nullable and never
-- backfilled: every existing payment keeps NULL, which reads as "recorded without a slip".
-- The slip itself is an AttachmentLink row (targetType 'reimbursement_payment',
-- purpose 'reimbursement.payment.slip'); no schema change is needed for that.
ALTER TABLE "ReimbursementPayment"
  ADD COLUMN IF NOT EXISTS "slipAttachmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "slipChecksumSha256" TEXT;
