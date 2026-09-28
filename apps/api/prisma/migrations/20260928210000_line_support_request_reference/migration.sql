-- Purchase without setup (spec §18.2 R-E5): a support request opened from a billing card/message
-- carries a server-derived reference to the attempt or invoice it started from. Staff-only.
ALTER TABLE "LineSupportRequest"
  ADD COLUMN IF NOT EXISTS "referenceKind" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceId" TEXT;
