CREATE TYPE "CrmCustomerOriginSource" AS ENUM (
  'MANUAL', 'LINE', 'WALK_IN', 'PHONE', 'WEB', 'FACEBOOK',
  'MARKETPLACE', 'REFERRAL', 'IMPORT', 'OTHER'
);

CREATE TYPE "CrmCustomerCreatedByType" AS ENUM ('USER', 'SYSTEM', 'AI_ASSISTED');

-- Prisma 7 applies each PostgreSQL migration in one transaction, so PostgreSQL
-- forbids CREATE INDEX CONCURRENTLY here. Fail quickly rather than queue behind a
-- long-held lock; deploy this migration in a short CRM write window and retry if
-- the lock timeout is reached. Foreign-key scans below stay low-lock via NOT VALID.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Stop before the first data write when historical rows cross a tenant boundary
-- that cannot be repaired without an owner decision. Identity/customer and
-- conversation snapshots are repaired below; channel ownership and unrelated CRM
-- child ownership are security boundaries and therefore fail closed.
DO $$
DECLARE mismatch_count integer;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM "CrmChannelIdentity" i
  LEFT JOIN "CompanyMessagingChannel" ch ON ch."id" = i."channelId"
  WHERE ch."id" IS NULL OR ch."companyId" <> i."companyId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'CRM identity/channel tenant mismatch rows require manual remediation: %', mismatch_count;
  END IF;
END $$;

DO $$
DECLARE orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM "CrmConversation" c
  LEFT JOIN "CrmChannelIdentity" i ON i."id" = c."channelIdentityId"
  WHERE i."id" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'CRM conversations with missing channel identity require manual remediation: %', orphan_count;
  END IF;
END $$;

-- Legacy activity/follow-up rows may predate canonical customer lineage. Derive
-- customerId only when opportunity and converted-lead lineage agree; malformed,
-- cross-tenant, or conflicting references stop the migration before any repair.
DO $$
DECLARE mismatch_summary text;
BEGIN
  SELECT string_agg(gap_name || '=' || gap_count, ', ' ORDER BY gap_name)
  INTO mismatch_summary
  FROM (
    SELECT 'CrmActivity.lineage' AS gap_name, count(*) AS gap_count
    FROM "CrmActivity" x
    LEFT JOIN "CrmOpportunity" o
      ON o."companyId" = x."companyId" AND o."id" = x."opportunityId"
    LEFT JOIN "CrmLead" l
      ON l."companyId" = x."companyId" AND l."id" = x."leadId"
    WHERE (x."opportunityId" IS NOT NULL AND o."id" IS NULL)
       OR (x."leadId" IS NOT NULL AND l."id" IS NULL)
       OR (o."customerId" IS NOT NULL AND l."convertedCustomerId" IS NOT NULL
           AND o."customerId" <> l."convertedCustomerId")
       OR (x."customerId" IS NOT NULL AND o."customerId" IS NOT NULL
           AND x."customerId" <> o."customerId")
       OR (x."customerId" IS NOT NULL AND l."convertedCustomerId" IS NOT NULL
           AND x."customerId" <> l."convertedCustomerId")
    UNION ALL
    SELECT 'CrmOpportunity.leadLineage', count(*)
    FROM "CrmOpportunity" o
    LEFT JOIN "CrmLead" l
      ON l."companyId" = o."companyId" AND l."id" = o."leadId"
    WHERE o."leadId" IS NOT NULL
      AND (
        l."id" IS NULL
        OR l."convertedCustomerId" IS NULL
        OR l."convertedCustomerId" <> o."customerId"
      )
    UNION ALL
    SELECT 'CrmFollowUpTask.lineage', count(*)
    FROM "CrmFollowUpTask" x
    LEFT JOIN "CrmOpportunity" o
      ON o."companyId" = x."companyId" AND o."id" = x."opportunityId"
    LEFT JOIN "CrmLead" l
      ON l."companyId" = x."companyId" AND l."id" = x."leadId"
    WHERE (x."opportunityId" IS NOT NULL AND o."id" IS NULL)
       OR (x."leadId" IS NOT NULL AND l."id" IS NULL)
       OR (o."customerId" IS NOT NULL AND l."convertedCustomerId" IS NOT NULL
           AND o."customerId" <> l."convertedCustomerId")
       OR (x."customerId" IS NOT NULL AND o."customerId" IS NOT NULL
           AND x."customerId" <> o."customerId")
       OR (x."customerId" IS NOT NULL AND l."convertedCustomerId" IS NOT NULL
           AND x."customerId" <> l."convertedCustomerId")
  ) gaps
  WHERE gap_count > 0;

  IF mismatch_summary IS NOT NULL THEN
    RAISE EXCEPTION 'CRM child customer lineage requires manual remediation: %', mismatch_summary;
  END IF;
END $$;

UPDATE "CrmActivity" x
SET "customerId" = lineage."customerId"
FROM (
  SELECT child."id", COALESCE(o."customerId", l."convertedCustomerId") AS "customerId"
  FROM "CrmActivity" child
  LEFT JOIN "CrmOpportunity" o
    ON o."companyId" = child."companyId" AND o."id" = child."opportunityId"
  LEFT JOIN "CrmLead" l
    ON l."companyId" = child."companyId" AND l."id" = child."leadId"
) lineage
WHERE x."id" = lineage."id"
  AND x."customerId" IS NULL
  AND lineage."customerId" IS NOT NULL;

UPDATE "CrmFollowUpTask" x
SET "customerId" = lineage."customerId"
FROM (
  SELECT child."id", COALESCE(o."customerId", l."convertedCustomerId") AS "customerId"
  FROM "CrmFollowUpTask" child
  LEFT JOIN "CrmOpportunity" o
    ON o."companyId" = child."companyId" AND o."id" = child."opportunityId"
  LEFT JOIN "CrmLead" l
    ON l."companyId" = child."companyId" AND l."id" = child."leadId"
) lineage
WHERE x."id" = lineage."id"
  AND x."customerId" IS NULL
  AND lineage."customerId" IS NOT NULL;

DO $$
DECLARE mismatch_summary text;
BEGIN
  SELECT string_agg(gap_name || '=' || gap_count, ', ' ORDER BY gap_name)
  INTO mismatch_summary
  FROM (
    SELECT 'CrmActivity.customerId' AS gap_name, count(*) AS gap_count
    FROM "CrmActivity" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."customerId"
    WHERE x."customerId" IS NOT NULL AND c."id" IS NULL
    UNION ALL
    SELECT 'CrmContactPerson.customerId', count(*)
    FROM "CrmContactPerson" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."customerId"
    WHERE c."id" IS NULL
    UNION ALL
    SELECT 'CrmFollowUpTask.customerId', count(*)
    FROM "CrmFollowUpTask" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."customerId"
    WHERE x."customerId" IS NOT NULL AND c."id" IS NULL
    UNION ALL
    SELECT 'CrmLead.convertedCustomerId', count(*)
    FROM "CrmLead" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."convertedCustomerId"
    WHERE x."convertedCustomerId" IS NOT NULL AND c."id" IS NULL
    UNION ALL
    SELECT 'CrmOpportunity.customerId', count(*)
    FROM "CrmOpportunity" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."customerId"
    WHERE c."id" IS NULL
    UNION ALL
    SELECT 'CrmQuotationLink.customerId', count(*)
    FROM "CrmQuotationLink" x
    LEFT JOIN "CrmCustomer" c ON c."companyId" = x."companyId" AND c."id" = x."customerId"
    WHERE c."id" IS NULL
  ) gaps
  WHERE gap_count > 0;

  IF mismatch_summary IS NOT NULL THEN
    RAISE EXCEPTION 'CRM customer tenant/orphan references require manual remediation: %', mismatch_summary;
  END IF;
END $$;

-- Customer duplicate matching needs a persisted normalized name so candidates can be
-- found without loading the tenant's entire customer table. Typed provenance separates
-- where the customer came from from who/what performed the write.
ALTER TABLE "CrmCustomer" ADD COLUMN "displayNameNormalized" TEXT;
ALTER TABLE "CrmCustomer" ADD COLUMN "marketingRef" TEXT;
ALTER TABLE "CrmCustomer" ADD COLUMN "personalDataErasedAt" TIMESTAMP(3);
ALTER TABLE "CrmCustomer" ADD COLUMN "originSource" "CrmCustomerOriginSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "CrmCustomer" ADD COLUMN "createdByType" "CrmCustomerCreatedByType" NOT NULL DEFAULT 'USER';
ALTER TABLE "CrmQuotationLink" ADD COLUMN "requestKey" TEXT;

-- Preserve immutable audit/event facts while removing the historical customer name
-- value that violates data minimization and would survive a customer erasure.
UPDATE "OutboxEvent"
SET "payloadJson" = "payloadJson" #- '{data,displayName}'
WHERE "eventType" = 'crm.customer.created'
  AND jsonb_typeof("payloadJson"->'data') = 'object'
  AND ("payloadJson"->'data') ? 'displayName';

UPDATE "AuditLog"
SET "metadataJson" = ("metadataJson" - 'displayName') #- '{data,displayName}'
WHERE "action" = 'crm.customer.create'
  AND jsonb_typeof("metadataJson") = 'object'
  AND (
    "metadataJson" ? 'displayName'
    OR (jsonb_typeof("metadataJson"->'data') = 'object' AND ("metadataJson"->'data') ? 'displayName')
  );

UPDATE "CrmCustomer"
SET "displayNameNormalized" = lower(regexp_replace(trim("displayName"), '[[:space:]]+', ' ', 'g')),
    "marketingRef" = gen_random_uuid()::text;

ALTER TABLE "CrmCustomer"
ADD CONSTRAINT "CrmCustomer_displayNameNormalized_not_null"
CHECK ("displayNameNormalized" IS NOT NULL) NOT VALID;
ALTER TABLE "CrmCustomer" VALIDATE CONSTRAINT "CrmCustomer_displayNameNormalized_not_null";
ALTER TABLE "CrmCustomer" ALTER COLUMN "displayNameNormalized" SET NOT NULL;
ALTER TABLE "CrmCustomer" DROP CONSTRAINT "CrmCustomer_displayNameNormalized_not_null";

ALTER TABLE "CrmCustomer"
ADD CONSTRAINT "CrmCustomer_marketingRef_not_null"
CHECK ("marketingRef" IS NOT NULL) NOT VALID;
ALTER TABLE "CrmCustomer" VALIDATE CONSTRAINT "CrmCustomer_marketingRef_not_null";
ALTER TABLE "CrmCustomer" ALTER COLUMN "marketingRef" SET NOT NULL;
ALTER TABLE "CrmCustomer" DROP CONSTRAINT "CrmCustomer_marketingRef_not_null";

UPDATE "CrmCustomer"
SET "originSource" = CASE
  WHEN "source" = 'LINE' THEN 'LINE'::"CrmCustomerOriginSource"
  WHEN "source" IN ('BOOKING_WALK_IN', 'BOOKING_BACKFILL') THEN 'WALK_IN'::"CrmCustomerOriginSource"
  WHEN "source" = 'BOOKING_PHONE' THEN 'PHONE'::"CrmCustomerOriginSource"
  WHEN "source" = 'BOOKING_WEB' THEN 'WEB'::"CrmCustomerOriginSource"
  WHEN "source" = 'BOOKING_FACEBOOK' THEN 'FACEBOOK'::"CrmCustomerOriginSource"
  WHEN "source" = 'CSV_IMPORT' THEN 'IMPORT'::"CrmCustomerOriginSource"
  WHEN "source" = 'LEAD_CONVERSION' THEN 'MANUAL'::"CrmCustomerOriginSource"
  WHEN "source" IS NULL OR "source" IN ('MANUAL', 'BOOKING_STAFF') THEN 'MANUAL'::"CrmCustomerOriginSource"
  ELSE 'OTHER'::"CrmCustomerOriginSource"
END,
"createdByType" = CASE
  WHEN "createdByUserId" = 'system' THEN 'SYSTEM'::"CrmCustomerCreatedByType"
  ELSE 'USER'::"CrmCustomerCreatedByType"
END;

CREATE INDEX "CrmCustomer_companyId_displayNameNormalized_idx"
ON "CrmCustomer"("companyId", "displayNameNormalized");

CREATE UNIQUE INDEX "CrmCustomer_marketingRef_key"
ON "CrmCustomer"("marketingRef");
CREATE UNIQUE INDEX "CrmQuotationLink_companyId_opportunityId_requestKey_key"
ON "CrmQuotationLink"("companyId", "opportunityId", "requestKey");

-- Canonicalize existing Thai phone keys: +66/0066/66 and a local leading 0 all
-- become the same national significant digits. Non-Thai international values keep
-- their country code (without +/00 punctuation).
UPDATE "CrmCustomer"
SET "primaryPhoneNormalized" = CASE
  WHEN regexp_replace(COALESCE("primaryPhone", ''), '[^0-9]', '', 'g') ~ '^(0066|66)0?[0-9]{8,9}$'
    THEN regexp_replace(regexp_replace("primaryPhone", '[^0-9]', '', 'g'), '^(0066|66)0?', '')
  WHEN regexp_replace(COALESCE("primaryPhone", ''), '[^0-9]', '', 'g') ~ '^0[0-9]{8,9}$'
    THEN substring(regexp_replace("primaryPhone", '[^0-9]', '', 'g') FROM 2)
  WHEN regexp_replace(COALESCE("primaryPhone", ''), '[^0-9]', '', 'g') ~ '^00[0-9]+$'
    THEN substring(regexp_replace("primaryPhone", '[^0-9]', '', 'g') FROM 3)
  ELSE NULLIF(regexp_replace(COALESCE("primaryPhone", ''), '[^0-9]', '', 'g'), '')
END;

-- Repair any historical identity orphan/cross-tenant reference left by the old
-- non-transactional LINE first-contact path. Preserve every identity and conversation;
-- each invalid identity gets its own deterministic provisional same-company customer.
CREATE TEMP TABLE "_CrmIdentityCustomerRepair" AS
SELECT
  i."id" AS "identityId",
  i."companyId",
  'crm-line-repair-' || md5(i."companyId" || ':' || i."id") AS "repairCustomerId",
  i."providerUserId",
  COALESCE(NULLIF(trim(i."displayName"), ''), 'ลูกค้า LINE') AS "displayName"
FROM "CrmChannelIdentity" i
LEFT JOIN "CrmCustomer" c
  ON c."companyId" = i."companyId" AND c."id" = i."customerId"
WHERE c."id" IS NULL;

INSERT INTO "CrmCustomer" (
  "id", "marketingRef", "companyId", "displayName", "displayNameNormalized", "customerType",
  "status", "consentStatus", "source", "originSource",
  "createdByType", "tier", "engagementScore", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  r."repairCustomerId", gen_random_uuid()::text, r."companyId", r."displayName",
  lower(regexp_replace(trim(r."displayName"), '[[:space:]]+', ' ', 'g')),
  'UNKNOWN'::"CrmCustomerType", 'ACTIVE'::"CrmCustomerStatus",
  'UNKNOWN'::"CrmConsentStatus", 'LINE', 'LINE'::"CrmCustomerOriginSource",
  'SYSTEM'::"CrmCustomerCreatedByType", 'LEAD'::"CrmCustomerTier", 0,
  'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_CrmIdentityCustomerRepair" r
ON CONFLICT ("id") DO NOTHING;

UPDATE "CrmChannelIdentity" i
SET "customerId" = r."repairCustomerId"
FROM "_CrmIdentityCustomerRepair" r
WHERE i."id" = r."identityId";

UPDATE "CrmConversation" c
SET "customerId" = r."repairCustomerId"
FROM "_CrmIdentityCustomerRepair" r
WHERE c."channelIdentityId" = r."identityId"
  AND c."companyId" = r."companyId";

DROP TABLE "_CrmIdentityCustomerRepair";

-- Provider is descriptive metadata on the identity; the channel is authoritative.
-- Canonicalizing it is safe after the tenant/channel preflight above and lets the
-- composite FK prevent future provider drift.
UPDATE "CrmChannelIdentity" i
SET "provider" = ch."provider"
FROM "CompanyMessagingChannel" ch
WHERE ch."id" = i."channelId"
  AND ch."companyId" = i."companyId"
  AND i."provider" IS DISTINCT FROM ch."provider";

-- The identity is canonical for a conversation's tenant, channel, and customer.
-- Repair historical denormalized snapshots before adding composite FKs.
UPDATE "CrmConversation" c
SET "companyId" = i."companyId",
    "channelId" = i."channelId",
    "customerId" = i."customerId"
FROM "CrmChannelIdentity" i
WHERE i."id" = c."channelIdentityId"
  AND (
    c."companyId" IS DISTINCT FROM i."companyId"
    OR c."channelId" IS DISTINCT FROM i."channelId"
    OR c."customerId" IS DISTINCT FROM i."customerId"
  );

-- A message belongs to its conversation. Before repairing the duplicated company
-- snapshot, fail if the move would collide with another provider message. An
-- autonomy job referencing a message from another conversation is ambiguous and
-- can drive a reply side effect, so it requires manual remediation.
DO $$
DECLARE conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM "CrmMessage" m
  JOIN "CrmConversation" c ON c."id" = m."conversationId"
  JOIN "CrmMessage" other
    ON other."companyId" = c."companyId"
   AND other."providerMessageId" = m."providerMessageId"
   AND other."id" <> m."id"
  WHERE m."companyId" <> c."companyId"
    AND m."providerMessageId" IS NOT NULL;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'CRM message tenant repair has provider-message conflicts requiring manual remediation: %', conflict_count;
  END IF;
END $$;

DO $$
DECLARE mismatch_count integer;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM "CrmAutonomyJob" j
  JOIN "CrmMessage" m ON m."id" = j."messageId"
  WHERE m."conversationId" <> j."conversationId";
  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'CRM autonomy job conversation/message mismatch rows require manual remediation: %', mismatch_count;
  END IF;
END $$;

UPDATE "CrmMessage" m
SET "companyId" = c."companyId"
FROM "CrmConversation" c
WHERE c."id" = m."conversationId"
  AND m."companyId" IS DISTINCT FROM c."companyId";

UPDATE "CrmAiAssistFeedback" f
SET "companyId" = c."companyId"
FROM "CrmConversation" c
WHERE c."id" = f."conversationId"
  AND f."companyId" IS DISTINCT FROM c."companyId";

UPDATE "CrmAutonomyJob" j
SET "companyId" = c."companyId"
FROM "CrmConversation" c
WHERE c."id" = j."conversationId"
  AND j."companyId" IS DISTINCT FROM c."companyId";

CREATE UNIQUE INDEX "CompanyMessagingChannel_companyId_id_key"
ON "CompanyMessagingChannel"("companyId", "id");
CREATE UNIQUE INDEX "CompanyMessagingChannel_companyId_id_provider_key"
ON "CompanyMessagingChannel"("companyId", "id", "provider");
CREATE UNIQUE INDEX "CrmChannelIdentity_companyId_id_key"
ON "CrmChannelIdentity"("companyId", "id");
CREATE UNIQUE INDEX "CrmChannelIdentity_companyId_channelId_customerId_id_key"
ON "CrmChannelIdentity"("companyId", "channelId", "customerId", "id");
CREATE UNIQUE INDEX "CrmConversation_companyId_id_key"
ON "CrmConversation"("companyId", "id");
CREATE UNIQUE INDEX "CrmLead_companyId_id_key"
ON "CrmLead"("companyId", "id");
CREATE UNIQUE INDEX "CrmOpportunity_companyId_id_key"
ON "CrmOpportunity"("companyId", "id");
CREATE UNIQUE INDEX "CrmMessage_companyId_conversationId_id_key"
ON "CrmMessage"("companyId", "conversationId", "id");
CREATE UNIQUE INDEX "CrmAutonomyJob_companyId_conversationId_messageId_key"
ON "CrmAutonomyJob"("companyId", "conversationId", "messageId");

ALTER TABLE "CrmChannelIdentity"
ADD CONSTRAINT "CrmChannelIdentity_companyId_channelId_provider_fkey"
FOREIGN KEY ("companyId", "channelId", "provider")
REFERENCES "CompanyMessagingChannel"("companyId", "id", "provider")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmConversation"
ADD CONSTRAINT "CrmConversation_companyId_channelId_fkey"
FOREIGN KEY ("companyId", "channelId")
REFERENCES "CompanyMessagingChannel"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmConversation"
ADD CONSTRAINT "CrmConversation_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmConversation"
ADD CONSTRAINT "CrmConversation_identity_customer_fkey"
FOREIGN KEY ("companyId", "channelId", "customerId", "channelIdentityId")
REFERENCES "CrmChannelIdentity"("companyId", "channelId", "customerId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- Enforce every identity against a real same-company canonical customer.
ALTER TABLE "CrmChannelIdentity"
ADD CONSTRAINT "CrmChannelIdentity_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE
NOT VALID;

ALTER TABLE "CrmContactPerson"
ADD CONSTRAINT "CrmContactPerson_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmOpportunity"
ADD CONSTRAINT "CrmOpportunity_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmOpportunity"
ADD CONSTRAINT "CrmOpportunity_companyId_leadId_fkey"
FOREIGN KEY ("companyId", "leadId")
REFERENCES "CrmLead"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmActivity"
ADD CONSTRAINT "CrmActivity_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmActivity"
ADD CONSTRAINT "CrmActivity_companyId_opportunityId_fkey"
FOREIGN KEY ("companyId", "opportunityId")
REFERENCES "CrmOpportunity"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmActivity"
ADD CONSTRAINT "CrmActivity_companyId_leadId_fkey"
FOREIGN KEY ("companyId", "leadId")
REFERENCES "CrmLead"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmFollowUpTask"
ADD CONSTRAINT "CrmFollowUpTask_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmFollowUpTask"
ADD CONSTRAINT "CrmFollowUpTask_companyId_opportunityId_fkey"
FOREIGN KEY ("companyId", "opportunityId")
REFERENCES "CrmOpportunity"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmFollowUpTask"
ADD CONSTRAINT "CrmFollowUpTask_companyId_leadId_fkey"
FOREIGN KEY ("companyId", "leadId")
REFERENCES "CrmLead"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmQuotationLink"
ADD CONSTRAINT "CrmQuotationLink_companyId_customerId_fkey"
FOREIGN KEY ("companyId", "customerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmLead"
ADD CONSTRAINT "CrmLead_companyId_convertedCustomerId_fkey"
FOREIGN KEY ("companyId", "convertedCustomerId")
REFERENCES "CrmCustomer"("companyId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmMessage"
ADD CONSTRAINT "CrmMessage_companyId_conversationId_fkey"
FOREIGN KEY ("companyId", "conversationId")
REFERENCES "CrmConversation"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmAiAssistFeedback"
ADD CONSTRAINT "CrmAiAssistFeedback_companyId_conversationId_fkey"
FOREIGN KEY ("companyId", "conversationId")
REFERENCES "CrmConversation"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmAutonomyJob"
ADD CONSTRAINT "CrmAutonomyJob_companyId_conversationId_fkey"
FOREIGN KEY ("companyId", "conversationId")
REFERENCES "CrmConversation"("companyId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmAutonomyJob"
ADD CONSTRAINT "CrmAutonomyJob_companyId_conversationId_messageId_fkey"
FOREIGN KEY ("companyId", "conversationId", "messageId")
REFERENCES "CrmMessage"("companyId", "conversationId", "id")
ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "CrmChannelIdentity"
VALIDATE CONSTRAINT "CrmChannelIdentity_companyId_customerId_fkey";
ALTER TABLE "CrmChannelIdentity"
VALIDATE CONSTRAINT "CrmChannelIdentity_companyId_channelId_provider_fkey";
ALTER TABLE "CrmConversation"
VALIDATE CONSTRAINT "CrmConversation_companyId_channelId_fkey";
ALTER TABLE "CrmConversation"
VALIDATE CONSTRAINT "CrmConversation_companyId_customerId_fkey";
ALTER TABLE "CrmConversation"
VALIDATE CONSTRAINT "CrmConversation_identity_customer_fkey";
ALTER TABLE "CrmContactPerson"
VALIDATE CONSTRAINT "CrmContactPerson_companyId_customerId_fkey";
ALTER TABLE "CrmOpportunity"
VALIDATE CONSTRAINT "CrmOpportunity_companyId_customerId_fkey";
ALTER TABLE "CrmOpportunity"
VALIDATE CONSTRAINT "CrmOpportunity_companyId_leadId_fkey";
ALTER TABLE "CrmActivity"
VALIDATE CONSTRAINT "CrmActivity_companyId_customerId_fkey";
ALTER TABLE "CrmActivity"
VALIDATE CONSTRAINT "CrmActivity_companyId_opportunityId_fkey";
ALTER TABLE "CrmActivity"
VALIDATE CONSTRAINT "CrmActivity_companyId_leadId_fkey";
ALTER TABLE "CrmFollowUpTask"
VALIDATE CONSTRAINT "CrmFollowUpTask_companyId_customerId_fkey";
ALTER TABLE "CrmFollowUpTask"
VALIDATE CONSTRAINT "CrmFollowUpTask_companyId_opportunityId_fkey";
ALTER TABLE "CrmFollowUpTask"
VALIDATE CONSTRAINT "CrmFollowUpTask_companyId_leadId_fkey";
ALTER TABLE "CrmQuotationLink"
VALIDATE CONSTRAINT "CrmQuotationLink_companyId_customerId_fkey";
ALTER TABLE "CrmLead"
VALIDATE CONSTRAINT "CrmLead_companyId_convertedCustomerId_fkey";
ALTER TABLE "CrmMessage"
VALIDATE CONSTRAINT "CrmMessage_companyId_conversationId_fkey";
ALTER TABLE "CrmAiAssistFeedback"
VALIDATE CONSTRAINT "CrmAiAssistFeedback_companyId_conversationId_fkey";
ALTER TABLE "CrmAutonomyJob"
VALIDATE CONSTRAINT "CrmAutonomyJob_companyId_conversationId_fkey";
ALTER TABLE "CrmAutonomyJob"
VALIDATE CONSTRAINT "CrmAutonomyJob_companyId_conversationId_messageId_fkey";

-- Keep the old global-id FKs until the same-company replacements have validated,
-- then remove the redundant weaker constraints without an integrity gap.
ALTER TABLE "CrmChannelIdentity" DROP CONSTRAINT IF EXISTS "CrmChannelIdentity_channelId_fkey";
ALTER TABLE "CrmConversation" DROP CONSTRAINT IF EXISTS "CrmConversation_channelId_fkey";
ALTER TABLE "CrmContactPerson" DROP CONSTRAINT IF EXISTS "CrmContactPerson_customerId_fkey";
ALTER TABLE "CrmOpportunity" DROP CONSTRAINT IF EXISTS "CrmOpportunity_customerId_fkey";
ALTER TABLE "CrmMessage" DROP CONSTRAINT IF EXISTS "CrmMessage_conversationId_fkey";
ALTER TABLE "CrmAiAssistFeedback" DROP CONSTRAINT IF EXISTS "CrmAiAssistFeedback_conversationId_fkey";
ALTER TABLE "CrmAutonomyJob" DROP CONSTRAINT IF EXISTS "CrmAutonomyJob_conversationId_fkey";
ALTER TABLE "CrmAutonomyJob" DROP CONSTRAINT IF EXISTS "CrmAutonomyJob_messageId_fkey";
