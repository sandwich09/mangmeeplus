ALTER TABLE "AttachmentObject"
ADD COLUMN "objectVersionId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AttachmentObject"
    GROUP BY "bucket", "objectKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'H-11 preflight failed: duplicate AttachmentObject bucket/objectKey references require evidence triage before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "AttachmentObject_bucket_objectKey_key"
ON "AttachmentObject"("bucket", "objectKey");
