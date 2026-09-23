# Agent Memory: platform-tenant-brand-and-sales-credential

Status: Released to UAT through Kamal.
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
Verification: `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/sales-console/sales-console.qa.spec.ts src/features/system-partners/PartnerSupportTools.qa.spec.ts` passed (42 tests); `corepack pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` passed; PR #724 CI run `35805366035` passed. Kamal UAT operation `20260923T013213Z-a576cd15` deployed main `abd2b4a37da242669a04a6e5a4506e0caf2e95a9` in 323.562 seconds with all 12 phases, public `OPEN`, KMS signature verification, and 2/2 SSM-session cleanup passed; LINE acceptance is deferred by owner.
Next: Do not run reset-password tooling merely to rename the tenant. Production release is out of scope.
