CREATE TABLE "ReimbursementDraftAction" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "messagingChannelId" TEXT NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "channelKind" VARCHAR(16) NOT NULL,
    "chatKeyHash" CHAR(64) NOT NULL,
    "ownerEpoch" INTEGER NOT NULL,
    "taskId" UUID NOT NULL,
    "actionOrdinal" INTEGER NOT NULL,
    "intentKeyHash" CHAR(64) NOT NULL,
    "operation" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'COLLECTING',
    "previewRevision" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "expectedRequestUpdatedAt" TIMESTAMP(3),
    "commandJson" JSONB,
    "previewJson" JSONB,
    "sourceProofJson" JSONB,
    "confirmationDigest" CHAR(64),
    "resultJson" JSONB,
    "appliedRequestUpdatedAt" TIMESTAMP(3),
    "previewDeliveryId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReimbursementDraftAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReimbursementDraftAction_ownerEpoch_check" CHECK ("ownerEpoch" >= 0),
    CONSTRAINT "ReimbursementDraftAction_actionOrdinal_check" CHECK ("actionOrdinal" >= 1),
    CONSTRAINT "ReimbursementDraftAction_previewRevision_check" CHECK ("previewRevision" >= 0),
    CONSTRAINT "ReimbursementDraftAction_operation_check" CHECK ("operation" IN ('CREATE', 'UPDATE')),
    CONSTRAINT "ReimbursementDraftAction_status_check" CHECK ("status" IN ('COLLECTING', 'PREVIEW', 'APPLIED', 'CANCELLED', 'EXPIRED', 'STALE')),
    CONSTRAINT "ReimbursementDraftAction_channel_check" CHECK ("channel" = 'line' AND "channelKind" = 'USER'),
    CONSTRAINT "ReimbursementDraftAction_hashes_check" CHECK (
      "chatKeyHash" ~ '^[0-9a-f]{64}$'
      AND "intentKeyHash" ~ '^[0-9a-f]{64}$'
      AND ("confirmationDigest" IS NULL OR "confirmationDigest" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "ReimbursementDraftAction_payload_size_check" CHECK (
      COALESCE(octet_length("commandJson"::text), 0)
        + COALESCE(octet_length("previewJson"::text), 0)
        + COALESCE(octet_length("sourceProofJson"::text), 0) <= 131072
    ),
    CONSTRAINT "ReimbursementDraftAction_result_size_check" CHECK (COALESCE(octet_length("resultJson"::text), 0) <= 4096),
    CONSTRAINT "ReimbursementDraftAction_state_check" CHECK (
      ("status" = 'COLLECTING' AND "previewRevision" = 0 AND "confirmationDigest" IS NULL)
      OR ("status" = 'PREVIEW' AND "previewRevision" >= 1 AND "previewJson" IS NOT NULL AND "confirmationDigest" IS NOT NULL)
      OR ("status" = 'APPLIED' AND "requestId" IS NOT NULL AND "resultJson" IS NOT NULL AND "appliedAt" IS NOT NULL AND "appliedRequestUpdatedAt" IS NOT NULL)
      OR "status" IN ('CANCELLED', 'EXPIRED', 'STALE')
    )
);

CREATE UNIQUE INDEX "ReimbursementDraftAction_companyId_intentKeyHash_key" ON "ReimbursementDraftAction"("companyId", "intentKeyHash");
CREATE INDEX "ReimbursementDraftAction_companyId_actorUserId_status_expiresAt_idx" ON "ReimbursementDraftAction"("companyId", "actorUserId", "status", "expiresAt");
CREATE INDEX "ReimbursementDraftAction_companyId_membershipId_createdAt_idx" ON "ReimbursementDraftAction"("companyId", "membershipId", "createdAt");
CREATE INDEX "ReimbursementDraftAction_companyId_requestId_idx" ON "ReimbursementDraftAction"("companyId", "requestId");
CREATE INDEX "ReimbursementDraftAction_status_expiresAt_idx" ON "ReimbursementDraftAction"("status", "expiresAt");

ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReimbursementDraftAction" ADD CONSTRAINT "ReimbursementDraftAction_companyId_requestId_fkey" FOREIGN KEY ("companyId", "requestId") REFERENCES "ReimbursementRequest"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
