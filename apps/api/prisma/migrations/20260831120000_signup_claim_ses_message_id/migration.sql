-- Flow B bounce/complaint feedback (spec §4D): remember which SES message carried the claim email
-- so an SNS event can find the request it belongs to. Unique — SES never reuses a MessageId.
ALTER TABLE "CompanySignupRequest"
  ADD COLUMN "claimEmailSesMessageId" TEXT;

CREATE UNIQUE INDEX "CompanySignupRequest_claimEmailSesMessageId_key"
  ON "CompanySignupRequest"("claimEmailSesMessageId");
