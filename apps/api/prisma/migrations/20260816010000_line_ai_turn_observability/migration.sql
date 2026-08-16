-- Additive hosted-runtime evidence. Never store prompts, OCR text, media keys, or signed URLs here.
ALTER TABLE "AiTurn" ADD COLUMN "observabilityJson" JSONB;
