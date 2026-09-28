-- Purchase without setup (spec §18.2 §9): the document recipient is a column we own, not only Stripe Customer.email.
ALTER TABLE "BillingAccount"
  ADD COLUMN IF NOT EXISTS "recipientEmail" VARCHAR(320),
  ADD COLUMN IF NOT EXISTS "recipientSource" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientBouncedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recipientBounceNotifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "checkoutAddressJson" JSONB;
CREATE INDEX IF NOT EXISTS "BillingAccount_recipientEmail_idx" ON "BillingAccount"("recipientEmail");

-- Company-scoped recipient OTP challenge (R-A8) reuses the account OTP table; only this proofKind sets companyId.
ALTER TABLE "EmailVerificationToken" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
CREATE INDEX IF NOT EXISTS "EmailVerificationToken_companyId_proofKind_status_idx"
  ON "EmailVerificationToken"("companyId", "proofKind", "status");
