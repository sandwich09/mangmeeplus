-- M-03: only an explicitly reviewed current template version may enter an
-- autonomous customer-AI prompt. Existing templates intentionally start
-- unapproved and remain available as staff quick replies.
ALTER TABLE "CrmMessageTemplate"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "aiApprovedVersion" INTEGER,
    ADD COLUMN "aiApprovedAt" TIMESTAMP(3),
    ADD COLUMN "aiApprovedByUserId" TEXT;

ALTER TABLE "CrmMessageTemplate"
    ADD CONSTRAINT "CrmMessageTemplate_version_check"
    CHECK ("version" >= 1),
    ADD CONSTRAINT "CrmMessageTemplate_ai_approval_version_check"
    CHECK ("aiApprovedVersion" IS NULL OR ("aiApprovedVersion" >= 1 AND "aiApprovedVersion" <= "version")),
    ADD CONSTRAINT "CrmMessageTemplate_ai_approval_metadata_check"
    CHECK (
      ("aiApprovedVersion" IS NULL AND "aiApprovedAt" IS NULL AND "aiApprovedByUserId" IS NULL)
      OR
      ("aiApprovedVersion" IS NOT NULL AND "aiApprovedAt" IS NOT NULL AND "aiApprovedByUserId" IS NOT NULL)
    );
