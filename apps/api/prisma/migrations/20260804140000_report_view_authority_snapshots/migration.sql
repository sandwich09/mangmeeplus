-- U3 / AC26 — creation-time authority for retained saved-view configuration.
-- Automatic and additive: customers neither migrate data nor re-enter saved views. Legacy `{}`
-- rows remain usable while Reports is ON and fail closed only on the retained OFF path.
ALTER TABLE "ReportView"
  ADD COLUMN IF NOT EXISTS "permissionSnapshotJson" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "sourceScopeSnapshotJson" JSONB NOT NULL DEFAULT '{}';

-- PARTIAL exports remain machine-readable CSV while their coverage explanation survives refresh.
ALTER TABLE "ReportExportRequest"
  ADD COLUMN IF NOT EXISTS "coverageWarningsJson" JSONB NOT NULL DEFAULT '[]';
