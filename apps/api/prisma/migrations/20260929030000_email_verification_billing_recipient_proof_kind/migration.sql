-- Purchase without setup: the company-scoped billing recipient code (R-A8) writes
-- proofKind = 'BILLING_RECIPIENT', which the OTP-shape check never allowed. Every
-- recipient-code insert fails on real Postgres. Add the value and require the
-- companyId that BillingRecipientOtpService always sets for this proof kind.
ALTER TABLE "EmailVerificationToken" DROP CONSTRAINT IF EXISTS "EmailVerificationToken_otp_shape";
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_otp_shape"
  CHECK ("proofKind" IN ('LINK', 'OTP', 'BILLING_RECIPIENT') AND "failedAttempts" BETWEEN 0 AND 5 AND
    ("proofKind" <> 'OTP' OR ("emailRevision" IS NOT NULL AND "securityBindingHash" IS NOT NULL
      AND "sessionId" IS NOT NULL AND "keyVersion" IS NOT NULL AND "sendAttemptId" IS NOT NULL
      AND "requestKey" IS NOT NULL AND "requestFingerprint" IS NOT NULL)) AND
    ("proofKind" <> 'BILLING_RECIPIENT' OR "companyId" IS NOT NULL));
