-- Branch dimension for dashboard snapshots (branch-scope-visibility plan §7b).
-- Additive enum value only: existing rows keep COMPANY, the column default is unchanged and no
-- backfill is needed. The existing @@index([companyId, scope, scopeKey, generatedAt]) already
-- covers the scope-aware findLatest lookup that reads these rows.
ALTER TYPE "DashboardScope" ADD VALUE IF NOT EXISTS 'BRANCH';
