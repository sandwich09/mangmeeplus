ALTER TABLE "AiTurn"
  ADD COLUMN "modelProvider" TEXT,
  ADD COLUMN "modelId" TEXT,
  ADD COLUMN "modelRegion" TEXT,
  ADD COLUMN "modelPurpose" TEXT,
  ADD COLUMN "modelLineageJson" JSONB;

ALTER TABLE "ReceiptExtraction"
  ADD COLUMN "modelId" TEXT,
  ADD COLUMN "processingRegion" TEXT,
  ADD COLUMN "processingPurpose" TEXT;

ALTER TABLE "ReceiptAiVerification"
  ADD COLUMN "processingRegion" TEXT,
  ADD COLUMN "processingPurpose" TEXT;
