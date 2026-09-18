-- W07-int, appendix §3 (LINE column) / §2.2.
--
-- 1. `linePushTargetId` — the chat a LINE capture's result may be pushed into. W02-LINE stored only
--    `lineChatKeyHash`, which is a hash, so a capture that arrived in a GROUP chat had no reachable
--    destination and its result was recorded as undelivered. Server-set, never in an HTTP dto.
ALTER TABLE "ExpenseCaptureGroup" ADD COLUMN "linePushTargetId" TEXT;

-- 2. The NULL-distinct hole in `ExpenseCaptureObservation_companyId_fileId_version_key`: a group
--    created by conversion (§3.1) keeps its facts under `expenseId` with `fileId` NULL, and
--    Postgres treats every NULL as distinct, so two concurrent corrections could both write
--    version N. Prisma cannot express a partial unique index, so it lives here as raw SQL.
CREATE UNIQUE INDEX "ExpenseCaptureObservation_companyId_expenseId_version_key"
  ON "ExpenseCaptureObservation" ("companyId", "expenseId", "version")
  WHERE "fileId" IS NULL;
