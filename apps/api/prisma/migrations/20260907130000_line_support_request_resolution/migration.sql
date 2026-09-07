-- Recovery R13: support ownership, request-bound LINE reply evidence, explicit resolution and a
-- deterministic keyset-paging index. Additive columns keep existing OPEN/ANSWERED/CLOSED rows.

ALTER TABLE "LineSupportRequest"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3),
  ADD COLUMN "assignmentNote" TEXT,
  ADD COLUMN "replyOperationId" TEXT,
  ADD COLUMN "replyTextHash" TEXT,
  ADD COLUMN "replyFirstAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastReplyText" TEXT,
  ADD COLUMN "lastReplySenderName" TEXT,
  ADD COLUMN "lastReplyDeliveryStatus" TEXT,
  ADD COLUMN "lastReplyError" TEXT,
  ADD COLUMN "resolvedByUserId" TEXT,
  ADD COLUMN "resolutionNote" TEXT;

CREATE INDEX "LineSupportRequest_status_lastMessageAt_id_idx"
  ON "LineSupportRequest"("status", "lastMessageAt", "id");
