ALTER TABLE "LineWebhookEventLog" ADD COLUMN "budgetAuthorityJson" JSONB, ADD COLUMN "budgetAuthorityRevision" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "LineWebhookEventLog_budget_authority_check" CHECK ("budgetAuthorityRevision" >= 0 AND ("budgetAuthorityJson" IS NULL OR octet_length("budgetAuthorityJson"::text) <= 32768));
ALTER TABLE "LineLedgerDelivery" ADD COLUMN "budgetAuthorityJson" JSONB, ADD COLUMN "budgetAuthorityRevision" INTEGER NOT NULL DEFAULT 0,
 ADD CONSTRAINT "LineLedgerDelivery_budget_authority_check" CHECK ("budgetAuthorityRevision" >= 0 AND ("budgetAuthorityJson" IS NULL OR octet_length("budgetAuthorityJson"::text) <= 32768));
