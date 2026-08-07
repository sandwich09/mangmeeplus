# Reports BI Plan

## Status

Complete on 2026-07-04. Core Reports/BI foundation is implemented and verified, including tax summary, workflow SLA, AI suggestion summary, AR/AP ledger-control reconciliation, persisted export center, live migration/seed, and browser/API smoke evidence. [[plans/master-implementation-checklist|Master Implementation Checklist]] item 18 is checked.

Active implementer target: Sonnet 4.6 or later.

## Linked Specs

- [[specs/reports-bi-spec|Reports BI Spec]]
- [[specs/permission-matrix|Permission Matrix]]
- [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- [[specs/accounting-documents-spec|Accounting Documents Spec]]
- [[specs/expense-receipt-upload-spec|Expense and Receipt Upload Spec]]
- [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- [[specs/crm-sales-spec|CRM and Sales Spec]]
- [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- [[specs/workflow-automation-spec|Workflow Automation Spec]]
- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]

## Purpose

Implement the first Reports and BI layer for WatchDog-BMS:

- Curated report catalog across finance, sales, inventory, expense, tax, bank, CRM, procurement/AP, workflow, dashboard health, and AI suggestion summaries.
- Controlled BI saved views over registered datasets.
- Permission-aware report query API with filter, dimension, measure, sort, pagination, freshness, and source-ref metadata.
- Financial reports that derive from posted ledger lines only.
- Operational reports that derive from source-module query ports or checked snapshots.
- Web Reports workspace with catalog, filters, table/chart modes, drill-down, saved views, export center, and admin health.
- Audited CSV export for all tabular reports and XLSX support where dependency is available.
- Dashboard/Notification `report_ready` event for export/subscription completion.
- LINE/AI report summaries and deep links, with no export or source mutation from LINE/AI.

This plan gives Sonnet 4.6 enough detail to implement without reopening ownership of ledger, accounting documents, tax, inventory, bank, CRM, procurement, workflow, notifications, AI Gateway, permissions, or source-module state machines.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared component and feature-folder conventions.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 17 may add Prisma, auth, request context, company/branch/team/location primitives, permissions, audit, outbox, notifications, dashboard snapshots, LINE binding, AI tool registry, workflow action adapters, worker queue helpers, source-module query ports, web shell routes, API client helpers, and source-module contracts.

Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, notification, dashboard, LINE, AI Gateway, workflow, worker queue, source-module API, web shell, config, or contract code.

## Implementation Readiness Status

Status: implementation complete as of 2026-07-04. The original handoff below is retained as historical implementation guidance.

Historical start point:

1. Read this plan first.
2. Read `docs/specs/reports-bi-spec.md`.
3. Read `docs/specs/permission-matrix.md`.
4. Read `docs/specs/dashboard-notification-spec.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read source-module specs for adapters available in current code.
7. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
8. Read `docs/specs/ai-draft-suggestion-layer-spec.md`.
9. Read backend, web, and security guidelines.
10. Inspect `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, `packages/config`, and current Prisma state.
11. Start at Phase 0: Baseline and Integration Reconciliation.

Completion rule used for closeout: Master Implementation Checklist item 18 was not marked complete until Phase 0 through Phase 9 exit criteria passed and verification commands were recorded.

## Implementation Review 2026-07-04

Implemented:

- Shared report contracts in `packages/contracts/src/reports.ts`, including catalog/query/result/saved-view/export/drilldown DTOs and full report/BI permission constants.
- API `ReportsModule` with curated code-controlled catalog, query validation, source-permission checks, report run persistence, saved views, CSV export, XLSX typed-unavailable response, export download permission re-check, drill-down logging, audit logs, and `report_ready` notification emission for ready CSV exports.
- Prisma schema and migration for `ReportView`, `ReportRun`, `ReportExportRequest`, and `ReportDrilldownAccessLog`.
- Source adapters for ledger financial reports, AR/sales/accounting summaries, CRM pipeline, inventory stock reports, expense/accountant evidence, tax summary, AP aging, bank cash, workflow SLA, dashboard health, and AI suggestion summary. Missing adapters return unavailable rather than fake zero.
- AR/AP aging reconciliation against ledger control accounts by ledger `reportGroup`, with mismatch totals/warnings and scoped warning when the caller lacks `ledger.report.read`.
- Web Reports workspace at `/reports` with catalog, filters, chart/table result view, saved views, persisted export center, CSV/XLSX export actions, export download, and unavailable/partial/error states.
- LINE/AI read-only monthly report summary tool that inherits user report/source permissions, summarizes/deep-links only, and cannot export/share/mutate.
- Permission Matrix alignment for report/BI keys and role grants; report permission is always paired with source-module permission/ABAC.

Closeout fixes on 2026-07-04:

- AR/AP ledger-control reconciliation now computes control-account amount, source/control difference, period, and account codes where ledger data is available.
- Export center now reads persisted export requests from `GET /companies/:companyId/reports/exports`.
- Live local DB evidence is recorded: migration deploy, seed, Reports browser flow, CSV download, persisted export reload, `report_ready` notification API, and audit log API.

Verification recorded on 2026-07-04:

```text
corepack pnpm --filter @watchdog-bms/contracts build
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/api prisma:validate
corepack pnpm --dir apps/api exec tsx --test src/modules/reports/domain/report-permission.logic.spec.ts src/modules/reports/domain/report-query-validator.logic.spec.ts src/modules/reports/domain/report-csv.logic.spec.ts src/modules/reports/application/report-source-adapters.spec.ts src/modules/reports/application/report.use-cases.spec.ts
corepack pnpm --dir apps/api test
DATABASE_URL=<local docker postgres on localhost:15432> corepack pnpm --dir apps/api exec prisma migrate deploy
DATABASE_URL=<local docker postgres on localhost:15432> corepack pnpm --dir apps/api exec prisma db seed
API_PORT=3301 WEB_PORT=3300 DATABASE_URL=<local docker postgres on localhost:15432> REDIS_URL=redis://localhost:6379 corepack pnpm e2e
```

Results: contracts/API/web typecheck clean, Prisma schema valid, focused report tests 16/16 pass, full API suite 846/846 pass, migration deploy/seed pass, and Playwright e2e 2/2 pass. The first Prisma DB status/deploy attempt from sandbox could not read the local DB detail; rerun outside the sandbox connected and passed.

## Core Rule

Financial reports come from ledger lines. Operational reports come from source modules or checked snapshots. Reports never become source of truth, never bypass source permissions, and never execute final business mutations.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 17.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox/notification/dashboard/LINE/AI/workflow primitives already exist, extend them with additive migrations and module code.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use server-derived `companyId`, `userId`, roles, permissions, branch/team/location scope, and source refs. Never trust client-sent tenant, permission, or role fields.
- Report module checks report permission and source-module permission for every query, drill-down, saved shared view, export, and download.
- Source adapters must call source-module query ports/application services. Do not import another module's Prisma repository directly.
- Financial statements must delegate to ledger report logic from item 10 or recreate the same calculation rules over posted journal lines only.
- Operational report totals must be reproducible from source records or checked snapshots with source freshness metadata.
- Missing modules show `UNAVAILABLE` or `PARTIAL`; do not render fake zero.
- CSV export must work for tabular reports.
- XLSX export must use an existing spreadsheet writer if present; otherwise add `exceljs` when dependency policy allows. Return typed `export_format_unavailable` only if spreadsheet dependency cannot be used.
- PDF export is deferred.
- LINE/AI can summarize and deep-link only. Export, saved-view mutation, dataset admin, source mutation, and final business actions remain web/API-only or blocked.
- Every export request/download, shared-view change, dataset admin change, sensitive report query, and drill-down denial writes audit.
- Tests must cover permissions, cross-company denial, source permission revocation, export audit, and unavailable/partial states.
- Each phase must leave touched packages typecheckable.
- Record verification commands and skipped tests with concrete reasons.

## Scope

### In Scope

- Shared report/BI contracts in `packages/contracts`.
- Report/BI permission keys and role grant alignment.
- API Reports module using local hexagonal conventions.
- Dataset registry and source adapter contract.
- Report catalog, query validation, query orchestration, drill-down, saved views, export requests, export metadata, and optional snapshots/subscriptions.
- Source adapters for modules implemented by the time item 18 starts:
  - Ledger financial reports.
  - Accounting documents sales/AR.
  - Expense/reimbursement summary.
  - Thai tax summary.
  - Inventory stock reports.
  - CRM sales/pipeline reports.
  - Bank/cash reports.
  - Procurement/AP aging if item 12 exists.
  - Workflow SLA and dashboard health if item 16 exists.
  - AI suggestion summary if item 17 exists.
- Web Reports workspace and export center.
- Dashboard/Notification integration for `report_ready`.
- LINE/AI read-only report summary tools.
- Audit and retention behavior for reports and exports.
- Unit, integration, API permission, web, LINE/AI, and smoke tests.

### Out of Scope

- Arbitrary SQL/custom query builder.
- Unrestricted pivot/table calculation engine.
- External data warehouse or third-party BI embed.
- PDF export.
- Email delivery.
- LINE export or LINE saved-view management.
- Final money, stock, tax, accounting, approval, permission, posting, reconciliation, or source mutation.
- Marketplace/channel reports before item 19.
- Payroll/HR, fixed asset, manufacturing, AI marketing, or production ops reports before their roadmap items.

## First Implementation Defaults

- Default landing route: `/reports`.
- Default period: current month in company timezone.
- Default max screen range: 24 months.
- Default max export range: 60 months.
- Default screen page limit: 100 rows.
- Default sync export row limit: 5,000 rows.
- Default async export row limit: 100,000 rows.
- Default export file expiry: 7 days.
- Default chart kinds: table, KPI, bar, line, stacked bar, donut, aging bucket.
- Default saved-view visibility: private.
- Shared/company views require `report.view.share`.
- Dataset admin route requires `bi.admin`.
- Manager finance summaries are disabled by default unless explicit finance scope is granted.
- CSV export required.
- XLSX export uses existing spreadsheet writer if present, otherwise `exceljs` when dependency policy allows; typed unavailable fallback only when dependency cannot be used.
- Report subscriptions optional unless worker/schedule primitives already exist.
- Notifications use web and LINE channels only through existing Dashboard/Notification behavior.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Map existing code from items 01 through 17 and choose exact extension points before editing.

### Tasks

- [ ] Inspect `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, and `packages/config`.
- [ ] Identify current auth/request context/company membership/permission guard patterns.
- [ ] Identify current Prisma/schema/migration pattern or confirm missing persistence.
- [ ] Identify audit/outbox/notification/dashboard integration points.
- [ ] Identify source-module query ports or application services available for ledger, accounting, expense, tax, inventory, CRM, bank, procurement, workflow, dashboard, and AI suggestion modules.
- [ ] Identify web route shell, API client helpers, data-fetch conventions, form/filter patterns, and component primitives.
- [ ] Identify worker/queue/export/storage utilities, if any.
- [ ] Identify existing CSV/XLSX/file storage libraries.
- [ ] Record which catalog datasets can be enabled now and which must start as `UNAVAILABLE`.
- [ ] Stop and report conflicts before coding if source modules expose incompatible report contracts or missing permissions cannot be resolved additively.

### Tests

- No new tests required. Run existing lint/typecheck only if useful to confirm clean baseline.

### Exit Criteria

- Exact files/modules to extend are known.
- Enabled vs unavailable datasets are listed.
- Persistence/export/worker strategy is chosen from existing primitives.
- No duplicate auth/audit/notification/dashboard/AI/workflow/source primitives are planned.

## Phase 1: Contracts, Permissions, and Domain Logic

### Goal

Create shared report contracts, permission keys, and pure report-domain validation before persistence/API/UI.

### Tasks

- [ ] Add report/BI DTOs and enums to `packages/contracts`.
- [ ] Add or align permission keys from spec section 13.
- [ ] Add role grant defaults according to local permission matrix implementation.
- [ ] Add dataset registry/domain model:
  - dataset code/version/category/status
  - required report/source permissions
  - supported filters/dimensions/measures/chart kinds
  - snapshot policy/freshness SLA
- [ ] Add query validator:
  - dataset enabled
  - filters allowlisted
  - date range bounded
  - dimensions/measures/sort allowlisted
  - page limit bounded
- [ ] Add report status mapping.
- [ ] Add source-ref and drill-down validation.
- [ ] Add export format/size validation.
- [ ] Add saved-view validation for private/shared/company views.
- [ ] Add money/date/timezone helper usage from existing packages or source modules.
- [ ] Add unit tests for contracts/domain validation.

### Tests

- Contract package tests/typecheck.
- API unit tests for report domain validation.
- Permission matrix tests if local project has them.

### Exit Criteria

- Shared contracts compile.
- Unknown filters/dimensions/measures/sort fields are rejected.
- Report permission and source permission are modeled separately.
- Dataset unavailable/partial/forbidden states are represented.

## Phase 2: Persistence, Migrations, and Seeds

### Goal

Persist saved views, runs, snapshots, exports, and optional subscriptions using current repo persistence pattern.

### Tasks

- [ ] Add additive Prisma/schema migration or equivalent persistence definitions for:
  - `ReportDatasetDefinition` if dataset metadata persists locally
  - `ReportView`
  - `ReportRun`
  - `ReportSnapshot`
  - `ReportExportRequest`
  - `ReportDrilldownAccessLog`
  - `ReportSubscription` only if scheduling exists
- [ ] Seed minimum report catalog definitions or register them in code/config according to existing pattern.
- [ ] Add repository/query interfaces and Prisma/infrastructure implementations.
- [ ] Add idempotency helpers for export request and scheduled/subscription runs if applicable.
- [ ] Add retention/expiry fields for export files and snapshots.
- [ ] Add audit event type constants for report query/export/download/share/admin/drill-down denial.
- [ ] Add migrations tests or schema validation commands.

### Tests

- Migration/schema validation.
- Repository tests for create/read/update/archive saved view.
- Repository tests for export status transitions and expiry.
- Repository tests for run/snapshot metadata.

### Exit Criteria

- Persistence layer supports saved views, runs, export requests, and audit metadata.
- Additive migration passes.
- Dataset seed/registry can produce catalog DTOs.
- Export request status transitions are deterministic.

## Phase 3: Source Adapter Registry and Dataset Catalog

### Goal

Register datasets through source adapters and expose catalog without leaking forbidden data.

### Tasks

- [ ] Add `ReportSourceAdapterPort` and `ReportAdapterRegistry`.
- [ ] Implement adapter health/freshness contract.
- [ ] Add ledger adapter for:
  - `financial.general_ledger`
  - `financial.trial_balance`
  - `financial.profit_and_loss`
  - `financial.balance_sheet`
- [ ] Add accounting/AR adapter for:
  - `ar.aging`
  - `sales.summary`
- [ ] Add AP adapter for `ap.aging` when procurement/AP module exists; otherwise unavailable adapter.
- [ ] Add inventory adapter for:
  - `inventory.stock_balance`
  - `inventory.stock_movement`
  - `inventory.reorder`
- [ ] Add expense adapter for `expense.summary`.
- [ ] Add expense accountant-evidence adapter for `expense.accountant_evidence`, reusing item 09 package/index query where available.
- [ ] Add tax adapter for `tax.summary`.
- [ ] Add CRM adapter for `sales.pipeline`.
- [ ] Add bank adapter for `bank.cash_position`.
- [ ] Add workflow/dashboard/AI adapters for operational reports where modules exist:
  - `ops.workflow_sla`
  - `ops.dashboard_health`
  - `ai.suggestion_summary`
- [ ] For every missing module, register unavailable dataset metadata with no fake totals.
- [ ] Add catalog use case that combines report permission and source permission to return visible/enabled/unavailable datasets safely.
- [ ] Add tests for catalog visibility and missing modules.

### Tests

- Unit tests for adapter registry.
- Integration tests for catalog API/use case with allowed, forbidden, and unavailable datasets.
- Permission tests for each enabled adapter category.

### Exit Criteria

- Catalog returns dataset metadata with status, filters, dimensions, measures, chart kinds, and freshness metadata.
- Missing modules are `UNAVAILABLE`.
- Forbidden source permissions do not leak totals/row counts.
- Source adapters use source query ports/services, not foreign repositories.

## Phase 4: Query Engine, Calculations, and Drill-Down

### Goal

Run report queries through adapters with consistent validation, calculation, pagination, totals, freshness, warnings, and drill-down.

### Tasks

- [ ] Add report query use case:
  - validate request
  - check report permission
  - check source permission through adapter/source service
  - execute adapter query
  - persist run metadata
  - return `ReportResultDto`
- [ ] Add pagination/cursor helper according to local API conventions.
- [ ] Add totals/summary calculation helper where adapter returns raw rows.
- [ ] Add chart result builder for table/KPI/bar/line/stacked bar/donut/aging bucket.
- [ ] Add stale/partial/unavailable warning builder.
- [ ] Implement financial report delegation to ledger calculations.
- [ ] Implement AR aging buckets and ledger reconciliation warning.
- [ ] Implement AP aging unavailable/available behavior.
- [ ] Implement sales summary with source distinction between booked revenue and CRM pipeline.
- [ ] Implement inventory reports with location ABAC and valuation-unavailable warning.
- [ ] Implement tax, bank, workflow, dashboard, and AI summary reports where sources exist.
- [ ] Add drill-down use case that calls source detail/link APIs and logs allowed/denied access.
- [ ] Add audit for sensitive report queries if audit policy requires it.

### Tests

- Unit tests for chart/totals/bucket/freshness helpers.
- Integration tests for enabled adapters.
- Permission tests for cross-company, missing source permission, and permission revoked after run.
- Drill-down allowed/denied tests.

### Exit Criteria

- Query API returns bounded company-scoped report results.
- Financial statements derive from ledger only.
- Operational reports return source refs and freshness metadata.
- Drill-down re-checks source permission.
- Unavailable/partial/stale states are visible and deterministic.

## Phase 5: Export, Worker Jobs, Snapshots, and Notifications

### Goal

Ship audited CSV export, optional XLSX export, async jobs when needed, checked snapshots, and report-ready notification.

### Tasks

- [ ] Add export request use case that reuses query validation/permission path.
- [ ] Add CSV export service for all tabular reports:
  - safe escaping
  - formula injection prevention
  - null/date/money formatting
  - stable column order
- [ ] Add XLSX export service using existing spreadsheet writer if present, otherwise `exceljs` when dependency policy allows.
- [ ] Add typed `export_format_unavailable` response if XLSX is unavailable.
- [ ] Add sync-vs-async threshold based on row count/config.
- [ ] Add worker job for async export if worker queue exists.
- [ ] Add export file storage using current object/local storage abstraction.
- [ ] Add expiry/cleanup metadata; cleanup job only if worker/scheduler exists.
- [ ] Add export download route/use case that re-checks current permission and ownership.
- [ ] Add checked snapshot builder for datasets where snapshot policy allows/requires it.
- [ ] Emit Dashboard/Notification `report_ready` event when export/subscription/snapshot completes.
- [ ] Add audit for export request/download/failure.
- [ ] Add optional report subscription scheduling only if existing workflow/worker primitives make it straightforward.

### Tests

- Unit tests for CSV escaping and formula injection prevention.
- Integration tests for export request lifecycle.
- Worker tests for async export success/failure.
- Permission tests for download after permission revocation.
- Notification integration test for `report_ready`.
- Snapshot freshness/source-hash tests.

### Exit Criteria

- CSV export works for tabular reports.
- XLSX either works or returns typed unavailable response.
- Export requests/downloads are audited.
- Report-ready event emits through existing notification path.
- Export download re-checks current permission.

## Phase 6: API Module and AI/LINE Tool Surface

### Goal

Expose report APIs and read-only AI/LINE tools without allowing export or mutation from AI/LINE.

### Tasks

- [ ] Add API controller/routes:
  - `GET /reports/catalog`
  - `POST /reports/query`
  - `GET /reports/runs/:runId`
  - `POST /reports/drilldown`
  - saved views routes
  - export routes
  - admin dataset routes
  - subscription routes only if implemented
- [ ] Add DTO validation schemas and error codes.
- [ ] Add API client contracts/helpers for web.
- [ ] Register AI Gateway tools or API endpoints for:
  - report summary
  - report detail within row/limit caps
  - report status/freshness explanation
- [ ] Ensure AI tools call ERP Core APIs and do not import Prisma/source repositories.
- [ ] Ensure AI/LINE refuses export, saved-view share/admin, subscription management, and source mutations.
- [ ] Add LINE summary/deep-link behavior through existing LINE read-only assistant integration.
- [ ] Add rate limits if current API layer supports them.

### Tests

- API route validation and permission tests.
- AI tool policy tests.
- LINE summary/refusal tests.
- Error contract tests for invalid filters, forbidden, unavailable, too large, source state changed, expired export.

### Exit Criteria

- API routes enforce report and source permissions.
- AI/LINE report summaries are source-cited and permission-aware.
- AI/LINE cannot export, mutate saved views, manage datasets, or mutate source records.
- API errors are typed and redacted.

## Phase 7: Web Reports Workspace

### Goal

Build usable Reports UI as first screen, not a landing page.

### Tasks

- [ ] Add `/reports` route and feature folder following current web conventions.
- [ ] Add report catalog screen:
  - category tabs/filter
  - search
  - favorites
  - unavailable/forbidden states
- [ ] Add report detail screen:
  - filter bar
  - quick period controls
  - table/chart mode
  - chart type selector where dataset supports it
  - KPI/totals strip
  - pagination
  - warnings/freshness/source module badges
  - drill-down drawer/link
- [ ] Add saved views UI:
  - create/update/delete private view
  - share/company/role/team view where permission allows
  - invalid view state when fields removed
- [ ] Add export action and export center:
  - queued/running/ready/failed/expired statuses
  - download with current permission check
- [ ] Add admin dataset health screen for `bi.admin`.
- [ ] Add permission-aware empty, forbidden, unavailable, partial, stale, loading, and error states.
- [ ] Add responsive layout checks for desktop/mobile.
- [ ] Use existing UI primitives and design tokens.

### Tests

- Component/unit tests if web stack has them.
- Playwright/e2e smoke if project has e2e setup.
- Manual browser screenshot checks if UI is implemented and dev server can run.
- Accessibility/basic keyboard tests if local tooling exists.

### Exit Criteria

- `/reports` opens actual workspace.
- Users can run report, change filters, switch table/chart, drill down, save view, export, and download where permission allows.
- UI handles long labels and mobile/desktop without overlap.
- Forbidden/unavailable/partial/stale states are clear and do not leak restricted data.

## Phase 8: Cross-Module Integration Hardening

### Goal

Verify Reports BI stays inside boundaries with source modules, notifications, workflow, AI, LINE, and permissions.

### Tasks

- [ ] Verify ledger reports use ledger calculations only.
- [ ] Verify AR/AP reports reconcile against ledger where possible and warn on mismatch.
- [ ] Verify inventory reports respect location ABAC.
- [ ] Verify CRM reports respect own/team/assigned ABAC and manager fallback policy.
- [ ] Verify manager finance summaries remain forbidden/unavailable unless explicit finance scope is granted.
- [ ] Verify tax reports respect tax period/report permissions.
- [ ] Verify bank reports mask sensitive bank fields without `bank.account.sensitive_read`.
- [ ] Verify workflow/dashboard/AI reports use existing module APIs and do not create mutation paths.
- [ ] Verify report-ready notification opens deep link and source route re-checks permission.
- [ ] Verify workflow-triggered report, if implemented, runs under requester/current permission.
- [ ] Verify LINE/AI cannot export or mutate.
- [ ] Verify audit entries exist for sensitive events.
- [ ] Verify source permission revocation after run/export blocks later restricted access.

### Tests

- Cross-module integration tests.
- Permission regression tests.
- Audit tests.
- Notification smoke.
- AI/LINE refusal tests.

### Exit Criteria

- No cross-module repository import shortcuts.
- Permission and ABAC boundaries pass.
- Report-ready notification and web deep link work.
- LINE/AI stay read-only.
- Audit trail covers sensitive report usage.

## Phase 9: Verification, Documentation, and Checklist Gate

### Goal

Verify implementation, update docs, and only then close Master Implementation Checklist item 18.

### Tasks

- [ ] Run root lint/typecheck/test commands that exist.
- [ ] Run API tests.
- [ ] Run worker tests if worker/export jobs changed.
- [ ] Run web tests.
- [ ] Run contract/config tests if present.
- [ ] Run Prisma migration/schema checks if Prisma exists.
- [ ] Run AI Gateway tests if tools changed.
- [ ] Run e2e/smoke flow: open reports -> run report -> save view -> export CSV -> notification -> download -> audit visible.
- [ ] Run finance smoke flow: Trial Balance/AR Aging -> ledger/source mismatch warning -> drill-down permission.
- [ ] Run inventory smoke flow: Stock Balance location ABAC.
- [ ] Run LINE smoke flow: allowed summary/deep link and export refusal.
- [ ] Verify cross-company denial.
- [ ] Verify source permission revoked after export blocks download.
- [ ] Verify unavailable module state without fake zero.
- [ ] Update docs only for actual implementation deltas.
- [ ] Record verification commands and skipped checks with reasons.
- [ ] Update Master Implementation Checklist item 18 checkbox only after all exit criteria pass.

### Tests

- Full available suite plus targeted smoke/e2e checks above.

### Exit Criteria

- All available tests/checks pass or skipped checks have concrete recorded reasons.
- Docs match implementation behavior.
- Item 18 acceptance criteria in spec section 24 pass.
- No item 19 through item 24 scope leaks into implementation.
- Master checklist is updated only after implementation and verification are complete.

## Review Checklist

- [ ] Shared report contracts compile.
- [ ] Report permission keys and source permission checks are enforced.
- [ ] Cross-company access is blocked.
- [ ] Financial reports derive from posted ledger lines only.
- [ ] Operational reports use source-module query ports or checked snapshots.
- [ ] Missing modules show unavailable/partial state, not fake zero.
- [ ] Report catalog does not leak forbidden totals or row counts.
- [ ] Query validator rejects unknown fields and excessive ranges.
- [ ] Saved views store config only, not result rows.
- [ ] Shared views require `report.view.share`.
- [ ] CSV export works and prevents formula injection.
- [ ] XLSX works or returns typed unavailable response.
- [ ] Export request/download are audited.
- [ ] Export download re-checks current permission.
- [ ] Drill-down calls source APIs and logs denied sensitive access.
- [ ] Dashboard/Notification `report_ready` event works.
- [ ] LINE/AI can summarize and deep-link only.
- [ ] LINE/AI cannot export, share views, manage datasets, or mutate source records.
- [ ] Web UI handles loading, empty, forbidden, unavailable, partial, stale, error, export failed, and expired states.
- [x] Master Implementation Checklist item 18 checked after verification passed on 2026-07-04.

## Historical First Sonnet 4.6 Prompt

Implement Master Implementation Checklist item 18: Reports and BI.

Start with Phase 0 and Phase 1 only unless I explicitly expand scope.

Read, in order:

1. `docs/plans/master-implementation-checklist.md`
2. `docs/plans/reports-bi-plan.md`
3. `docs/specs/reports-bi-spec.md`
4. `docs/specs/permission-matrix.md`
5. `docs/specs/dashboard-notification-spec.md`
6. `docs/specs/double-entry-ledger-closing-spec.md`
7. Relevant source-module specs for adapters available in current code
8. `docs/specs/line-ai-read-only-assistant-spec.md`
9. `docs/specs/ai-draft-suggestion-layer-spec.md`
10. `docs/guidelines/backend-hexagonal-code-style.md`
11. `docs/guidelines/web-frontend-code-style.md`
12. `docs/guidelines/security-implementation-guideline.md`

Then inspect current code in `apps/api`, `apps/ai-gateway`, `apps/workers`, `apps/web`, `packages/contracts`, and `packages/config`.

For Phase 0, report existing primitives, enabled/unavailable datasets, export/storage support, and exact files to extend. For Phase 1, implement report contracts, permission keys, dataset registry/domain models, query validation, saved-view/export validation, status mapping, source-ref/drill-down validation, and focused unit tests.

Do not implement arbitrary SQL/custom query builder, PDF export, LINE export, external BI embedding, item 19 Marketplace Import, item 20 Payroll/HR, item 21 Fixed Assets, item 22 Manufacturing, item 23 AI Marketing, item 24 Production Ops, or final money/stock/tax/accounting/approval/permission/source mutations.

Master Implementation Checklist item 18 was checked on 2026-07-04 after implementation, migration/seed, focused tests, full API tests, typechecks, and Playwright smoke passed.

## Risks

- Report totals may diverge from source modules if adapters duplicate business rules. Mitigation: use source-module query ports/services and ledger report logic.
- Financial and operational totals can appear inconsistent. Mitigation: label source basis and show reconciliation warnings instead of blending silently.
- Exports can leak sensitive data after permissions change. Mitigation: re-check permission on download and expire files.
- BI saved views can become invalid when dataset fields change. Mitigation: version dataset definitions and show invalid-view repair state.
- Large reports can hurt API performance. Mitigation: bounded filters, pagination, async export, snapshots, and row limits.
- Missing modules can tempt fake placeholder values. Mitigation: strict unavailable/partial state and tests.

## Owner Decisions

- Curated report catalog plus controlled BI saved views are first-pass scope.
- Arbitrary SQL/custom query builder is deferred.
- CSV export is required for first pass.
- XLSX export uses existing spreadsheet writer if present; otherwise add `exceljs` when dependency policy allows. Typed unavailable fallback is acceptable only when dependency cannot be used.
- PDF export is deferred.
- LINE/AI summary and deep link only; export and saved-view mutation remain web-only.
- Manager finance summaries are disabled by default until explicit finance scope is granted.
- First-pass export defaults: 100 rows/page, sync export up to 5,000 rows, async export up to 100,000 rows, export files expire after 7 days.
- Report subscriptions are optional first pass and only if scheduler/notification primitives already exist.

## Backlog Notes

- Revisit production export row/size limits after real customer data volume is known.
- Revisit manager finance-summary scope before beta if owner wants broader manager visibility.
- Revisit spreadsheet writer only if repo later standardizes on a different XLSX package than `exceljs`.
