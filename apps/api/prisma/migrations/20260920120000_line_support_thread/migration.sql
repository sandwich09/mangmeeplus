-- v3 (Owner 2026-09-20, line-support-request-spec-th สัญญา v3): the support inbox becomes a chat.
-- One row per thing said on a request — customer text, customer photo/document (bytes in the blob
-- table), staff reply — from the tap that opened the case to the resolve that closed it.
-- Additive: two tables, both cascade-deleted with the request, so the existing 90-day purge of a
-- CLOSED case still removes everything the customer sent, bytes included.

-- CreateTable
CREATE TABLE "LineSupportMessage" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "senderName" TEXT,
    "senderUserId" TEXT,
    "lineMessageId" TEXT,
    "operationId" TEXT,
    "deliveryStatus" TEXT,
    "mediaMimeType" TEXT,
    "mediaByteSize" INTEGER,
    "mediaFileName" TEXT,
    "mediaError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineSupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineSupportMessageBlob" (
    "messageId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineSupportMessageBlob_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
-- A redelivered LINE webhook (same lineMessageId) must not append the same sentence or photo twice.
CREATE UNIQUE INDEX "LineSupportMessage_requestId_lineMessageId_key" ON "LineSupportMessage"("requestId", "lineMessageId");

-- CreateIndex
-- A same-key retry of one staff reply updates its bubble's delivery status instead of adding one.
CREATE UNIQUE INDEX "LineSupportMessage_requestId_operationId_key" ON "LineSupportMessage"("requestId", "operationId");

-- CreateIndex
-- The thread read: one request, oldest first.
CREATE INDEX "LineSupportMessage_requestId_createdAt_idx" ON "LineSupportMessage"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "LineSupportMessage" ADD CONSTRAINT "LineSupportMessage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LineSupportRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineSupportMessageBlob" ADD CONSTRAINT "LineSupportMessageBlob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "LineSupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
