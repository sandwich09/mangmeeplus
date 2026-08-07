-- Item 15A Phase 2: durable bytes for inbound CRM LINE media.
-- LINE's content API retains message content only for a limited window, so the
-- webhook fetches media at ingestion and stores it here (storageProvider "db")
-- — the only store that survives ECS redeploys until a real object store ships.

-- CreateTable
CREATE TABLE "AttachmentBlob" (
    "attachmentId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentBlob_pkey" PRIMARY KEY ("attachmentId")
);

-- CreateIndex
CREATE INDEX "AttachmentBlob_companyId_idx" ON "AttachmentBlob"("companyId");

-- AddForeignKey
ALTER TABLE "AttachmentBlob" ADD CONSTRAINT "AttachmentBlob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "AttachmentObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
