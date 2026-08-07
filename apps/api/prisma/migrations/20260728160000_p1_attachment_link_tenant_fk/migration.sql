ALTER TABLE "AttachmentObject"
  ADD CONSTRAINT "AttachmentObject_companyId_id_key" UNIQUE ("companyId", "id");

ALTER TABLE "AttachmentLink"
  DROP CONSTRAINT "AttachmentLink_attachmentId_fkey";

ALTER TABLE "AttachmentLink"
  ADD CONSTRAINT "AttachmentLink_companyId_attachmentId_fkey"
  FOREIGN KEY ("companyId", "attachmentId")
  REFERENCES "AttachmentObject"("companyId", "id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
