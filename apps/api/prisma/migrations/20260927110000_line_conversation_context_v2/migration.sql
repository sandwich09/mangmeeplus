ALTER TABLE "AiConversation"
 ADD COLUMN "channelKind" TEXT, ADD COLUMN "messagingChannelId" TEXT, ADD COLUMN "chatKeyHash" TEXT, ADD COLUMN "membershipId" TEXT,
 ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "taskStateJson" JSONB, ADD COLUMN "stateExpiresAt" TIMESTAMP(3), ADD COLUMN "lifecycleEpoch" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "preferenceRequestId" TEXT, ADD COLUMN "preferenceJson" JSONB, ADD COLUMN "preferenceVersion" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "preferenceExpiresAt" TIMESTAMP(3),
 ADD CONSTRAINT "AiConversation_binding_check" CHECK (num_nonnulls("channelKind", "messagingChannelId", "chatKeyHash", "membershipId") IN (0, 4)),
 ADD CONSTRAINT "AiConversation_channel_check" CHECK ("channelKind" IS NULL OR ("channel" = 'line' AND "channelKind" IN ('USER','GROUP','ROOM'))),
 ADD CONSTRAINT "AiConversation_state_bounds" CHECK ("stateVersion" >= 0 AND "lifecycleEpoch" >= 0 AND "preferenceVersion" >= 0 AND ("taskStateJson" IS NULL OR octet_length("taskStateJson"::text) <= 16384) AND ("preferenceJson" IS NULL OR octet_length("preferenceJson"::text) <= 1024));
CREATE UNIQUE INDEX "AiConversation_full_owner_key" ON "AiConversation" ("companyId", "userId", "membershipId", "channel", "channelKind", "messagingChannelId", "chatKeyHash");
CREATE INDEX "AiConversation_stateExpiresAt_idx" ON "AiConversation" ("stateExpiresAt");
CREATE INDEX "AiConversation_companyId_membershipId_idx" ON "AiConversation" ("companyId", "membershipId");
ALTER TABLE "LineIntakePendingMedia"
 ADD COLUMN "channelKind" TEXT, ADD COLUMN "messagingChannelId" TEXT, ADD COLUMN "chatKeyHash" TEXT, ADD COLUMN "membershipId" TEXT,
 ADD COLUMN "lifecycleEpoch" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "intakeStateId" TEXT, ADD COLUMN "readJobId" TEXT, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "LineIntakePendingMedia_binding_check" CHECK (num_nonnulls("channelKind", "messagingChannelId", "chatKeyHash", "membershipId") IN (0, 4)),
 ADD CONSTRAINT "LineIntakePendingMedia_version_check" CHECK ("revision" >= 0 AND "lifecycleEpoch" >= 0);
