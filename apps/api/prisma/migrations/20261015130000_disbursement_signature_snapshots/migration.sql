ALTER TABLE "DisbursementVoucher"
  ADD COLUMN "preparerSignatureJson" JSONB,
  ADD COLUMN "approverSignatureJson" JSONB,
  ADD COLUMN "payerSignatureJson" JSONB;
