ALTER TABLE "CompanyAiConfiguration"
  ADD COLUMN "salesDealChatCreditSatang" INTEGER,
  ADD COLUMN "salesDealChatCreditEndsAt" TIMESTAMP(3);

ALTER TABLE "CompanyAiConfiguration"
  ADD CONSTRAINT "CompanyAiConfiguration_salesDealChatCreditSatang_check"
  CHECK ("salesDealChatCreditSatang" IS NULL OR "salesDealChatCreditSatang" >= 0);
