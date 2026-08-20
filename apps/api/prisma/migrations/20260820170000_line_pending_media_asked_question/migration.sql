-- Phase 4b: a pending media row must remember WHICH question it was asked with, and in which chat.
-- Without it a numbered answer is resolved against the question the current state would ask now, so
-- an old "2" (just an illustration, do not record) reads as "2" on a different list and files the
-- image as evidence. Nullable and additive: rows written before this keep the receipt-clarify
-- meaning they were created with, and the change reverses by dropping the column.
-- AlterTable
ALTER TABLE "LineIntakePendingMedia" ADD COLUMN     "askedQuestionJson" JSONB;
