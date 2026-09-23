# Agent Memory: platform-tenant-brand-and-sales-credential

Status: Implemented locally; awaiting normal UAT release process.
Owner: Codex
Scope: Rename the internal platform tenant shown in system user lookup and protect the one-time sales credential handoff UI.
Decisions:
- Keep `seed-watchdog-system-company` as the stable technical ID; rename only the visible Company and protected-admin display names.
- Use an idempotent data migration so existing UAT/Production tenant rows change during deployment; seed and reset scripts use the same names afterward.
- Reuse the existing `SalesCredentialPanel`, which receives the one-time credential after create/reset and is rendered above the team list. Add a regression check rather than duplicate it.
Open questions: None.
Artifacts:
- `apps/api/prisma/migrations/20260923120000_platform_tenant_brand/migration.sql`
- `apps/web/src/features/sales-console/sales-console.qa.spec.ts`
Verification: `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/sales-console/sales-console.qa.spec.ts src/features/system-partners/PartnerSupportTools.qa.spec.ts` passed (42 tests); `corepack pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` passed; API PostgreSQL smoke passed its non-writing boundary test and skipped database cases because no disposable test database was configured.
Next: Deploy only through the UAT/Production deployment protocol; do not run reset-password tooling merely to rename the tenant.
