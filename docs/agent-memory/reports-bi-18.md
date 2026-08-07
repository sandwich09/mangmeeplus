# Agent Memory: reports-bi-18

Status: Complete on 2026-07-04. Reports/BI item 18 is implemented, live-migrated/seeded on local Postgres, browser-smoked through Reports workspace export flow, and checked in the Master Implementation Checklist.

Owner: Codex

Scope: Implement/review/test/fix gaps for item 18 Reports and BI across contracts, API, Prisma, permissions, LINE/AI tool wiring, web workspace, docs, and verification.

Decisions:

- Use a code-controlled curated catalog and registered source adapters; no arbitrary SQL, custom query builder, or user-authored formulas.
- Keep report permissions and source-module permissions as separate gates. Catalog/query/export/download/drill-down re-check report permission plus source permission/ABAC.
- Align report/BI permission surface with the Reports BI spec and Permission Matrix: catalog, dataset, query, saved view, snapshot, export, subscription, audit, and BI admin/view keys.
- Use CSV as the implemented first-pass export format. XLSX returns typed `export_format_unavailable` instead of adding a new dependency.
- LINE/AI report tool is read-only: summarize and deep-link only; no export, saved-view sharing, dataset admin, or source mutation.

Artifacts:

- `packages/contracts/src/reports.ts`
- `packages/contracts/src/ai-tools.ts`
- `apps/api/src/modules/reports/**`
- `apps/api/src/modules/tax/application/use-cases/get-tax-summary.use-case.ts`
- `apps/api/prisma/migrations/20260704120000_item18_reports_bi/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/auth/permission-registry.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-report-tools.use-case.ts`
- `apps/api/src/modules/line-ai/line-ai.module.ts`
- `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts`
- `apps/web/src/features/reports/**`
- `apps/web/app/(workspace)/companies/[companyId]/reports/page.tsx`
- `docs/specs/permission-matrix.md`
- `docs/plans/reports-bi-plan.md`
- `docs/plans/master-implementation-checklist.md`

Implemented:

- Shared report DTOs/types/constants exported from `packages/contracts`.
- Report/BI permission registry and role grants for item 18.
- API Reports module with catalog, query orchestration, validation, run persistence, saved views, CSV export, XLSX typed-unavailable fallback, export download re-check, drill-down access logs, audit logs, and `report_ready` notifications.
- Prisma models for report views, runs, export requests, and drill-down access logs.
- Adapters for ledger financial reports, AR/sales/accounting summaries, CRM pipeline, inventory reports, expense/accountant evidence, tax summary, AP aging, bank cash, workflow SLA, dashboard health, and AI suggestion summary.
- Web Reports workspace with catalog, filters, chart/table display, saved views, export request/download, and unavailable/partial/error states.
- AR/AP aging reports reconcile source outstanding totals against ledger control accounts by `reportGroup` when `ledger.report.read` is present, with mismatch totals/warnings and permission/no-ledger warnings when reconciliation cannot run.
- Persisted export center via `GET /companies/:companyId/reports/exports`, scoped to own exports unless `report.export.manage` is granted.
- LINE/AI monthly summary tool using report/source permissions and web deep links only.

Known gaps:

- None blocking item 18 closeout. Deferred by first-pass scope: arbitrary SQL/custom builder, external BI/data warehouse, PDF reports, email delivery, report subscriptions, and reports for items 19-24 before those modules ship.

Verification:

- `corepack pnpm --filter @watchdog-bms/contracts build` passed.
- `corepack pnpm --filter @watchdog-bms/api typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/api prisma:validate` passed.
- `corepack pnpm --dir apps/api exec tsx --test src/modules/reports/domain/report-permission.logic.spec.ts src/modules/reports/domain/report-query-validator.logic.spec.ts src/modules/reports/domain/report-csv.logic.spec.ts src/modules/reports/application/report-source-adapters.spec.ts src/modules/reports/application/report.use-cases.spec.ts` passed, 16/16.
- `corepack pnpm --dir apps/api test` passed, 846/846.
- `DATABASE_URL=<local docker postgres on localhost:15432> corepack pnpm --dir apps/api exec prisma migrate deploy` applied `20260704120000_item18_reports_bi`.
- `DATABASE_URL=<local docker postgres on localhost:15432> corepack pnpm --dir apps/api exec prisma db seed` passed.
- `API_PORT=3301 WEB_PORT=3300 DATABASE_URL=<local docker postgres on localhost:15432> REDIS_URL=redis://localhost:6379 corepack pnpm e2e` passed, 2/2. Reports smoke opened Reports, ran a report, saved a view, exported and downloaded CSV, reloaded persisted export center, verified `report_ready` notification API, and verified audit entry.
- Sandbox note: Prisma DB connection required running outside sandbox. E2E first exposed missing `GetGeneralLedgerUseCase` export from `LedgerModule`; fixed and rerun passed.

Next:

- Use this memory as the item 18 closeout evidence. Future report work should start from explicit new scope, not reopen item 18 silently.
