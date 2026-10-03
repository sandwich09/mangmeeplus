# Reports BI Spec

## 1. Status

Complete on 2026-07-04. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 18. Core foundation, AR/AP reconciliation, persisted export center, live migration/seed, and Reports browser/API smoke are implemented and verified. See [[plans/reports-bi-plan|Reports BI Plan]] and [[agent-memory/reports-bi-18]].

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Define reporting and BI views for sales, stock, receivables, expenses, tax, ledger-backed finance, and operational health.

First implementation should give users a usable web Reports workspace with curated report catalog, safe filters, charts, drill-downs, saved views, audited exports, report-ready notifications, and permission-aware LINE/AI summaries.

## 3. Non-Goals

- Arbitrary SQL, custom database query builder, or user-authored formulas.
- Full pivot-table engine with unrestricted field joins.
- External data warehouse, OLAP cube, dbt pipeline, or third-party BI embedding.
- Real-time streaming analytics.
- PDF financial statement generation.
- Email delivery. Report-ready email can be added after notification email exists.
- Export from LINE or AI.
- Final money, stock, tax, accounting, approval, permission, or external-platform mutation.
- Replacing source-module screens for document entry, posting, reconciliation, tax filing, CRM updates, procurement, or inventory movement.
- Building item 19 Marketplace Import, item 20 Payroll/HR, item 21 Fixed Assets, item 22 Manufacturing, item 23 AI Marketing, or item 24 Production Ops reports before those modules exist.

## 4. User Roles

- Owner: reads all reports, manages report definitions, runs exports, shares saved views, and audits report access.
- Admin: manages report catalog/settings and reads operational reports where source permissions allow.
- Manager: reads team/assigned sales, CRM, inventory, task, and operational summaries according to ABAC.
- Sales: reads own/assigned sales, customer, pipeline, quotation, AR-safe summaries, and saved views.
- Inventory: reads stock, movement, reorder, aging, count variance, and inventory-value operational reports for allowed locations.
- Finance: reads and exports accounting documents, AR/AP, expense, bank, tax-prep, cash, and finance summaries.
- Accountant: reads and exports ledger, tax, period close, AR/AP, finance, and audit-oriented reports.
- Marketing: reads marketing-safe customer/product/channel reports where source permissions allow; external campaign reports remain item 23.
- Staff: reads own reimbursement, expense, task, and request summaries.
- Auditor readonly: reads and exports audit-safe reports without mutation.
- AI assistant user: asks for report summaries and links; permissions inherit exact web user and source scope.

## 5. Boundary and Ownership

Financial reports such as GL, Trial Balance, P&L, and Balance Sheet derive from [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]. Operational reports must be reproducible from source records or checked snapshots. LINE receives summaries and links; web owns drill-down and export.

Reports BI owns:

- Curated report catalog and report grouping.
- Shared report contracts and dataset metadata.
- Report query orchestration across registered source-module query ports.
- Safe filter, sort, group, and chart config validation.
- Saved views, user/company report favorites, and shared report definitions.
- Report runs, snapshots, exports, and export audit trail.
- Drill-down payloads that link back to source modules.
- Report-ready notification events through Dashboard/Notification item 06.
- BI widgets/views derived from registered datasets, not arbitrary SQL.
- LINE/AI report summary tools with source refs and web deep links.

Source modules own:

- Source-of-truth data and business state machines.
- Source-specific calculations that require domain rules.
- Source-specific permissions and ABAC.
- Source-record detail screens and final mutations.
- Source exports already owned by module-specific specs unless Reports BI wraps them through registered adapters.

Dashboard/Notification owns:

- Notification delivery, preferences, digests, and delivery logs.
- Dashboard snapshot shell and notification deep-link behavior.
- `report_ready` notification trigger wiring.

Workflow Automation owns:

- Any scheduled or event-triggered report request that creates a task or notification.
- Workflow run/action audit around report requests.

AI Draft and Suggestion Layer owns:

- AI suggestions and draft artifacts that cite reports.
- Source draft creation from AI review.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared component and feature-folder conventions.
- `packages/contracts`: shared contract package exists and should receive report DTOs/types.
- `packages/config`: shared config package exists and may hold report/export limits.

Before implementation, inspect latest code again because items 01 through 17 may add Prisma, auth, request context, company/branch/team primitives, permissions, audit, outbox, notifications, dashboard snapshots, LINE binding, AI tool registry, workflow action adapters, worker queue helpers, source-module query ports, web shell routes, API client helpers, and source-module contracts.

Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, permission, dashboard, notification, LINE, AI Gateway, workflow, worker queue, web shell, source-module API, config, or contract code.

## 7. References

- [[plans/reports-bi-plan|Reports BI Plan]]
- [[plans/master-implementation-checklist|Master Implementation Checklist]]
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
- [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style]]
- [[guidelines/web-frontend-code-style|Web Frontend Code Style]]
- [[guidelines/security-implementation-guideline|Security Implementation Guideline]]

## 8. Product Decisions

- First pass ships curated reports and controlled BI saved views over registered datasets.
- Dataset registry is code/config controlled. Users cannot add raw SQL or arbitrary joins.
- Web is system of interaction for report exploration, saved views, and exports.
- LINE/AI can summarize and deep-link only. Export and saved-view mutation are web-only.
- Financial statements derive from posted ledger lines only.
- Operational reports derive from source records through source-module query ports or from checked snapshots built by those ports.
- Checked snapshots are optimization/cache, not source of truth. Snapshot metadata must include source module, source version/hash when available, computed time, filters, and freshness.
- CSV export is required for all tabular reports in first pass.
- XLSX export uses an existing spreadsheet writer if present; otherwise use `exceljs` when dependency policy allows. If no spreadsheet dependency can be used, export route must return typed `export_format_unavailable` for XLSX while CSV remains implemented.
- PDF export is deferred.
- Branch/location/team filters appear only when source modules and ABAC primitives exist.
- Manager finance summaries are disabled by default until explicit finance scope is granted.
- Reports must show unavailable/partial state instead of fake zero when source module is missing or permission is absent.
- Report definitions are versioned. Changing definition semantics creates new version metadata.
- Saved views can be private by default. Shared/company views require explicit permission.
- Exports are asynchronous when row count or generation cost exceeds configured threshold.

## 9. Report Lifecycle

```text
Catalog -> Query Request -> Permission/ABAC Check -> Source Adapter Query -> Result/Chart -> Optional Drilldown -> Optional Save View -> Optional Export -> Audit/Notification
```

Report query statuses:

```text
READY
PARTIAL
EMPTY
FORBIDDEN
UNAVAILABLE
STALE
INVALID_FILTER
FAILED
```

Export statuses:

```text
QUEUED
RUNNING
READY
FAILED
EXPIRED
CANCELLED
```

Rules:

- Every query starts from server-derived `companyId`, `userId`, roles, permissions, and ABAC scope.
- Client-sent company, role, permission, branch, team, location, and source ids are hints only and must be verified server-side.
- Report module checks report permission first, then source-module permissions for every dataset and drill-down.
- Missing source permission returns forbidden/unavailable rows or widgets without leaking restricted values.
- Source adapters must return source refs for drill-down where records exist.
- Drill-down re-checks current source permission and ABAC. A report row never grants source-record access.
- Report result includes `computedAt`, `freshness`, source module list, filter echo, and definition version.
- Financial report rows must include period/date filter, currency, account grouping, and source refs where source refs are safe.
- Operational report rows must identify source module and record type.
- Snapshot freshness must be disclosed. Stale snapshots are visible but marked stale.
- Report exports use the same query/filter/permission path as screen results.
- Export files are temporary artifacts with expiry and audit metadata; do not store full file content in audit logs.

## 10. Report Catalog

Minimum first-pass catalog:

| Code | Name | Source | Required source permissions | Notes |
|---|---|---|---|---|
| `financial.general_ledger` | General Ledger | Ledger | `ledger.report.read` | Derives from posted journal lines. |
| `financial.trial_balance` | Trial Balance | Ledger | `ledger.report.read` | Debit/credit totals and difference. |
| `financial.profit_and_loss` | Profit and Loss | Ledger | `ledger.report.read` | Revenue, cost, expense, tax expense. |
| `financial.balance_sheet` | Balance Sheet | Ledger | `ledger.report.read` | Asset, liability, equity, current profit mapping. |
| `ar.aging` | Accounts Receivable Aging | Accounting docs plus ledger reconciliation | `accounting.invoice.read`, `accounting.payment.read` | Reconcile total to AR control account when ledger exists; flag mismatch. |
| `ap.aging` | Accounts Payable Aging | Procurement/AP plus ledger reconciliation | `procurement.vendor_bill.read` when available | If procurement module absent, show unavailable. |
| `sales.summary` | Sales Summary | Accounting docs, CRM | `accounting.invoice.read` or `crm.report.read` by scope | Issued invoices/receipts for finance view; CRM opportunity for pipeline view. |
| `sales.pipeline` | Sales Pipeline | CRM | `crm.report.read` | Team/own scope per CRM ABAC. |
| `inventory.stock_balance` | Stock Balance | Inventory | inventory report/read permission from item 05 | Quantity, value when valuation source exists, location scope. |
| `inventory.stock_movement` | Stock Movement | Inventory | inventory report/read permission from item 05 | Movement type, source ref, period. |
| `inventory.reorder` | Reorder and Stockout Risk | Inventory | inventory report/read permission from item 05 | Uses reorder thresholds where configured. |
| `expense.summary` | Expense Summary | Expense, reimbursement, AP | `expense.read` or scoped reimbursement/procurement permission | Separates draft/confirmed/paid states. |
| `expense.accountant_evidence` | Accountant Expense Evidence | Expense | `expense.export` plus source read/ABAC | DB-backed index for accountant package exports, including uploaded date, document date, source type, tax evidence status, category, totals, VAT/WHT, uploader, and evidence refs. |
| `tax.summary` | Tax Summary | Thai Tax | `tax.report.read` | VAT, WHT, filings, certificates, due state. |
| `bank.cash_position` | Cash Position | Bank reconciliation, ledger | `bank.cash.read` or ledger/report permission | Bank balance, unreconciled count, ledger cash where available. |
| `ops.workflow_sla` | Workflow SLA | Workflow | workflow read permission | Rules, overdue tasks, failed runs. |
| `ops.dashboard_health` | Operational Health | Dashboard/Notification | `dashboard.read` plus source permissions | Alert counts, stale modules, unavailable modules. |
| `ai.suggestion_summary` | AI Suggestion Summary | AI Draft/Suggestion | `ai.suggestion.read` | Suggestion status, review aging, source coverage. |

Optional only if modules exist:

- Marketplace/channel sales after item 19.
- Payroll and HR compliance after item 20.
- Fixed assets after item 21.
- Manufacturing/BOM after item 22.
- AI marketing performance after item 23.
- Production ops/SLO after item 24.

## 11. BI Views

BI view means a saved report configuration over one registered dataset, not arbitrary cross-dataset SQL.

First-pass BI view supports:

- Dataset selection from catalog.
- Date period, branch/team/location, customer/vendor/product/category, status, and owner filters when dataset exposes them.
- Grouping by allowlisted dimensions.
- Measures from allowlisted numeric fields.
- Sorting by allowlisted columns.
- Chart type: table, KPI strip, bar, line, stacked bar, donut, aging bucket table.
- Private saved views.
- Company-shared saved views with `report.view.share`.
- Favorite/pin per user.
- Drill-down to source refs when permission allows.

First-pass BI view does not support:

- Joining arbitrary datasets.
- Custom formulas.
- Raw SQL.
- Editable source records inside report grid.
- External embedding.

## 12. Data Model Draft

Use existing Prisma/schema conventions if present. Names are draft and may adapt to local naming, but behavior must stay equivalent.

### ReportDatasetDefinition

- `id`
- `code`: unique stable code, e.g. `sales.summary`.
- `version`: integer or semver.
- `title`
- `description`
- `category`: `FINANCIAL`, `SALES`, `INVENTORY`, `EXPENSE`, `TAX`, `BANK`, `CRM`, `PROCUREMENT`, `OPERATIONS`, `AI`, `CUSTOM`
- `sourceModule`
- `adapterKey`
- `status`: `ENABLED`, `DISABLED`, `UNAVAILABLE`
- `requiredReportPermissionsJson`
- `requiredSourcePermissionsJson`
- `supportedFiltersJson`
- `supportedDimensionsJson`
- `supportedMeasuresJson`
- `supportedChartKindsJson`
- `freshnessSlaSeconds`
- `snapshotPolicy`: `LIVE`, `SNAPSHOT_ALLOWED`, `SNAPSHOT_REQUIRED`
- `createdAt`
- `updatedAt`

### ReportView

- `id`
- `companyId`
- `ownerUserId`
- `datasetCode`
- `datasetVersion`
- `name`
- `description`
- `visibility`: `PRIVATE`, `COMPANY`, `ROLE`, `TEAM`
- `sharedRoleIdsJson` or local equivalent when role ids exist.
- `sharedTeamIdsJson` or local equivalent when team ids exist.
- `filtersJson`
- `dimensionsJson`
- `measuresJson`
- `sortJson`
- `chartConfigJson`
- `pinned`
- `createdAt`
- `updatedAt`
- `archivedAt`

### ReportRun

- `id`
- `companyId`
- `requestedByUserId`
- `datasetCode`
- `datasetVersion`
- `viewId`
- `status`
- `filtersJson`
- `permissionSnapshotJson`
- `sourceScopeSnapshotJson`
- `rowCount`
- `computedAt`
- `sourceFreshnessJson`
- `sourceRefsPreviewJson`
- `errorCode`
- `errorMessage`
- `createdAt`
- `updatedAt`

### ReportSnapshot

- `id`
- `companyId`
- `datasetCode`
- `datasetVersion`
- `periodKind`
- `periodStart`
- `periodEnd`
- `scopeHash`
- `filtersHash`
- `sourceHash`
- `status`
- `dataPreviewJson` or storage pointer according to repo pattern.
- `rowCount`
- `computedAt`
- `expiresAt`
- `createdByRunId`
- `createdAt`

### ReportExportRequest

- `id`
- `companyId`
- `requestedByUserId`
- `datasetCode`
- `datasetVersion`
- `viewId`
- `runId`
- `format`: `CSV`, `XLSX`
- `status`
- `filtersJson`
- `columnConfigJson`
- `permissionSnapshotJson`
- `sourceScopeSnapshotJson`
- `rowCount`
- `fileName`
- `fileMimeType`
- `fileSizeBytes`
- `storageKey` or file pointer if object storage exists.
- `sha256`
- `expiresAt`
- `errorCode`
- `errorMessage`
- `createdAt`
- `updatedAt`

### ReportDrilldownAccessLog

- `id`
- `companyId`
- `userId`
- `datasetCode`
- `runId`
- `sourceModule`
- `sourceType`
- `sourceId`
- `permissionKeysJson`
- `result`: `ALLOWED`, `DENIED`, `NOT_FOUND`
- `createdAt`

### ReportSubscription

Optional in first pass; create only if worker/notification scheduling primitives exist.

- `id`
- `companyId`
- `ownerUserId`
- `viewId`
- `scheduleCron`
- `timezone`
- `deliveryChannel`: `WEB_NOTIFICATION`
- `enabled`
- `lastRunAt`
- `nextRunAt`
- `createdAt`
- `updatedAt`

## 13. Permission Keys

Add or align these keys in [[specs/permission-matrix|Permission Matrix]]:

```text
report.catalog.read
report.dataset.read
report.query.run
report.view.read
report.view.create
report.view.update_own
report.view.share
report.view.manage
report.snapshot.read
report.export
report.export.read_own
report.export.manage
report.subscription.manage
report.audit.read
bi.view.read
bi.view.create
bi.view.update_own
bi.view.share
bi.admin
```

Default grants:

```text
OWNER: all report and BI permissions
ADMIN: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.view.share, report.view.manage, report.snapshot.read, report.export, report.export.read_own, report.export.manage, report.subscription.manage, report.audit.read, bi.view.read, bi.view.create, bi.view.update_own, bi.view.share, bi.admin
MANAGER: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.export.read_own, bi.view.read, bi.view.create, bi.view.update_own within team/assigned ABAC and source permissions
SALES: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.export.read_own, bi.view.read, bi.view.create, bi.view.update_own for own/assigned sales/CRM/accounting source permissions
INVENTORY: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.export.read_own, bi.view.read, bi.view.create, bi.view.update_own for allowed inventory locations
FINANCE: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.view.share, report.snapshot.read, report.export, report.export.read_own, bi.view.read, bi.view.create, bi.view.update_own, bi.view.share for finance/accounting/tax/bank source permissions
ACCOUNTANT: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.view.share, report.snapshot.read, report.export, report.export.read_own, report.audit.read, bi.view.read, bi.view.create, bi.view.update_own, bi.view.share for accounting/tax/ledger source permissions
MARKETING: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.export.read_own, bi.view.read, bi.view.create, bi.view.update_own for marketing-safe source data
STAFF: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.view.create, report.view.update_own, report.export.read_own, bi.view.read for own requests/tasks only
AUDITOR_READONLY: report.catalog.read, report.dataset.read, report.query.run, report.view.read, report.snapshot.read, report.export, report.export.read_own, report.audit.read, bi.view.read
```

Extra rules:

- Report permission is never enough by itself. User must also hold source-module permission and pass ABAC for every dataset, row detail, drill-down, and export.
- `report.export` is required for company-wide exports. `report.export.read_own` reads only own export jobs/files.
- `report.view.share` is required to create role/team/company shared views.
- `report.view.manage` can archive shared views and edit catalog metadata.
- `bi.admin` is OWNER/ADMIN only and controls dataset enable/disable and health tools.
- Service actors may run scheduled reports, but every scheduled run uses owner/requester permission snapshot and re-checks current permissions.

Sensitive report/BI permissions:

```text
report.export
report.export.manage
report.view.share
report.view.manage
report.subscription.manage
report.audit.read
bi.admin
```

## 14. Shared Contracts

Minimum shared exports in `packages/contracts`:

```ts
export type ReportCategory =
  | 'FINANCIAL'
  | 'SALES'
  | 'INVENTORY'
  | 'EXPENSE'
  | 'TAX'
  | 'BANK'
  | 'CRM'
  | 'PROCUREMENT'
  | 'OPERATIONS'
  | 'AI'
  | 'CUSTOM';

export type ReportStatus =
  | 'READY'
  | 'PARTIAL'
  | 'EMPTY'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'STALE'
  | 'INVALID_FILTER'
  | 'FAILED';

export type ReportChartKind =
  | 'table'
  | 'kpi'
  | 'bar'
  | 'line'
  | 'stacked_bar'
  | 'donut'
  | 'aging_bucket';

export type ReportExportFormat = 'CSV' | 'XLSX';

export type ReportFilterValue = string | number | boolean | null | string[] | number[];

export type ReportSourceRef = {
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  label?: string;
  permissionKey?: string;
  href?: string;
};

export type ReportDatasetDto = {
  code: string;
  version: string;
  title: string;
  description?: string;
  category: ReportCategory;
  status: 'ENABLED' | 'DISABLED' | 'UNAVAILABLE';
  requiredReportPermissions: string[];
  requiredSourcePermissions: string[];
  supportedFilters: ReportFilterDefinitionDto[];
  supportedDimensions: ReportFieldDefinitionDto[];
  supportedMeasures: ReportFieldDefinitionDto[];
  supportedChartKinds: ReportChartKind[];
  freshnessSlaSeconds?: number;
};

export type ReportFilterDefinitionDto = {
  key: string;
  label: string;
  kind: 'date_range' | 'select' | 'multi_select' | 'text' | 'number_range' | 'boolean';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

export type ReportFieldDefinitionDto = {
  key: string;
  label: string;
  valueType: 'string' | 'number' | 'money' | 'quantity' | 'date' | 'datetime' | 'percent' | 'status';
  aggregate?: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'none';
};

export type ReportQueryRequestDto = {
  datasetCode: string;
  viewId?: string;
  filters: Record<string, ReportFilterValue>;
  dimensions?: string[];
  measures?: string[];
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  chartKind?: ReportChartKind;
  page?: { cursor?: string; limit?: number };
};

export type ReportCellValue = string | number | boolean | null;

export type ReportRowDto = {
  id: string;
  cells: Record<string, ReportCellValue>;
  sourceRefs: ReportSourceRef[];
  drilldownAvailable: boolean;
};

export type ReportResultDto = {
  runId: string;
  datasetCode: string;
  datasetVersion: string;
  status: ReportStatus;
  computedAt: string;
  freshness: 'fresh' | 'stale' | 'unavailable';
  filters: Record<string, ReportFilterValue>;
  columns: ReportFieldDefinitionDto[];
  rows: ReportRowDto[];
  totals?: Record<string, ReportCellValue>;
  chart?: {
    kind: ReportChartKind;
    labels: string[];
    series: Array<{ key: string; label: string; values: number[] }>;
  };
  sourceModules: Array<{ sourceModule: string; status: ReportStatus; computedAt?: string; message?: string }>;
  pageInfo?: { nextCursor?: string; hasNextPage: boolean };
  warnings: Array<{ code: string; message: string }>;
};

export type ReportExportRequestDto = {
  datasetCode: string;
  viewId?: string;
  format: ReportExportFormat;
  filters: Record<string, ReportFilterValue>;
  columns?: string[];
};

export type ReportExportDto = {
  id: string;
  datasetCode: string;
  format: ReportExportFormat;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  fileName?: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  expiresAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 15. API Behavior

All API routes:

- Require active company membership.
- Derive `companyId`, `userId`, roles, permissions, and ABAC scope server-side.
- Use backend permission guard plus source-module permission checks.
- Validate filters against dataset metadata.
- Bound date ranges, row limits, group counts, and export sizes through config.
- Write audit for sensitive report query, drill-down, saved-view share, export request, export download, admin dataset change, and subscription change.

### List Catalog

```text
GET /reports/catalog
```

- Permission: `report.catalog.read`.
- Returns datasets visible to user. Dataset may be present with `UNAVAILABLE` if source module missing or permission absent, but restricted names/metadata must not leak sensitive field details.
- Error cases: `403` missing report permission, `404` company not found, `500` only for unexpected failure.

### Run Report Query

```text
POST /reports/query
```

- Permission: `report.query.run` plus source read permissions.
- Body: `ReportQueryRequestDto`.
- Success: `ReportResultDto`.
- Validation:
  - Dataset exists and enabled.
  - Filters allowed by dataset and date range within configured maximum.
  - Dimensions/measures/sort fields allowlisted.
  - Page limit bounded.
- Error cases:
  - `400 invalid_filter`, `400 invalid_dimension`, `400 invalid_measure`.
  - `403` missing report/source permission.
  - `409 source_unavailable` if source adapter cannot run.
  - `422 unsupported_report_state` if source module exists but required source status is not ready.

### Get Run

```text
GET /reports/runs/:runId
```

- Permission: `report.query.run` plus same source permissions, or own run where policy allows.
- Re-checks current permission before returning cached result metadata.
- Does not return restricted rows if permission was revoked after run.

### Drill Down

```text
POST /reports/drilldown
```

- Permission: report read/query plus source record read permission.
- Body includes `runId`, `datasetCode`, `sourceModule`, `sourceType`, `sourceId`.
- Success returns source-link DTO or source summary DTO exposed by source module.
- Must not bypass source module detail APIs.

### Saved Views

```text
GET /reports/views
POST /reports/views
PATCH /reports/views/:viewId
DELETE /reports/views/:viewId
```

- Read permission: `report.view.read`.
- Create permission: `report.view.create`.
- Own update permission: `report.view.update_own`.
- Shared/company update permission: `report.view.manage`.
- Sharing permission: `report.view.share`.
- Saved view payload stores only dataset code and allowlisted config. Do not store raw result rows.

### Exports

```text
POST /reports/exports
GET /reports/exports
GET /reports/exports/:exportId
GET /reports/exports/:exportId/download
```

- Request permission: `report.export` for company/exportable reports, or stricter source export permission when module requires it.
- Own list/read permission: `report.export.read_own`.
- Manage permission: `report.export.manage`.
- Export reuses same query validation and permission checks as screen report.
- Download re-checks current user permission and export ownership/policy.
- Export file expires according to config.
- Error cases:
  - `403` missing permission.
  - `400 export_format_unavailable` before query/storage for any format other than CSV in the first pass.
  - `413 export_too_large`.
  - `410 export_expired`.
  - `422 source_state_changed` if snapshot hash changed and policy requires fresh export.

### Dataset Admin

```text
GET /reports/admin/datasets
PATCH /reports/admin/datasets/:datasetCode
POST /reports/admin/datasets/:datasetCode/rebuild-snapshot
```

- Permission: `bi.admin`.
- Rebuild snapshot uses worker when available.
- Admin route shows adapter health, last run, freshness, and missing dependencies.

### Subscriptions

Optional first pass if scheduling primitives exist:

```text
GET /reports/subscriptions
POST /reports/subscriptions
PATCH /reports/subscriptions/:subscriptionId
DELETE /reports/subscriptions/:subscriptionId
```

- Permission: `report.subscription.manage`.
- Channel: `WEB_NOTIFICATION` only.
- Scheduled runs re-check current permission before generation and delivery.

## 16. Source Adapter Contract

Reports BI must use source-module query ports or application services. It must not import Prisma repositories from another module directly.

Minimum adapter port:

```ts
export type ReportSourceAdapterPort = {
  sourceModule: string;
  listDatasets(): Promise<ReportDatasetDto[]>;
  validateQuery(input: ReportQueryRequestDto, context: ReportContext): Promise<ReportValidatedQuery>;
  runQuery(input: ReportValidatedQuery, context: ReportContext): Promise<ReportResultDto>;
  buildExportRows?(input: ReportValidatedQuery, context: ReportContext): AsyncIterable<Record<string, ReportCellValue>>;
  getDrilldown?(input: ReportDrilldownRequest, context: ReportContext): Promise<ReportDrilldownDto>;
  getFreshness?(datasetCode: string, context: ReportContext): Promise<ReportSourceFreshnessDto>;
};
```

Context:

```ts
export type ReportContext = {
  companyId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  branchIds?: string[];
  teamIds?: string[];
  locationIds?: string[];
  timezone: string;
  currency: string;
  requestId: string;
};
```

Adapter rules:

- Validate source permissions and ABAC inside adapter or source service.
- Return `FORBIDDEN` without restricted values when user lacks source access.
- Return `UNAVAILABLE` when source module is absent or not migrated.
- Include source refs for drill-down where allowed.
- Avoid N+1 source queries for common report pages.
- Keep money precision exact using source decimal/money primitives.
- Use Thai timezone/company timezone for date-period boundaries.
- Respect source status filters. Draft/voided/reversed records must not be counted as final unless report explicitly asks for draft/status analysis.
- Reconcile financial operational totals to ledger where appropriate and expose mismatch warning instead of silently blending sources.

## 17. Calculation Rules

Global:

- Default period is current month in company timezone.
- Date range maximum defaults to 24 months for screen queries and 60 months for export unless config overrides.
- Currency defaults to company base currency. Multi-currency reports must show source currency and base converted amount only if source module owns conversion rate.
- Deleted/archived records are excluded unless dataset explicitly supports archive audit.
- Voided, reversed, rejected, cancelled, and draft records are excluded from final totals unless report explicitly tracks those states.
- Totals must be computed server-side from the same filtered dataset as rows.
- Empty result is `EMPTY`, not `FAILED`.

Financial:

- General Ledger, Trial Balance, P&L, and Balance Sheet follow [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]] section 14.1.
- Reports must not read raw accounting documents or expenses directly for financial statements except source labels attached to journal lines.
- Closed periods are still readable. New report calculations must respect period close state and report definition version.
- Suspense balance appears as warning or separate row according to ledger policy.

Receivables:

- AR aging starts from issued invoices/debit notes less receipts/credit notes according to Accounting Documents rules.
- Buckets: current, 1-30, 31-60, 61-90, 91+ days overdue.
- Due date is source document due date. If missing, use issue date and warning `missing_due_date`.
- Reconcile total open AR against ledger AR control account when ledger exists; show `ledger_mismatch` warning with difference amount.

Payables:

- AP aging starts from vendor bills/payables in Procurement/AP when item 12 exists.
- If source module absent, dataset returns `UNAVAILABLE`.
- Reconcile total open AP against ledger AP control account when ledger exists.

Sales:

- Financial sales totals use ledger revenue accounts.
- Operational sales summary can use issued invoices/receipts and CRM opportunity data when each source permission allows.
- Pipeline reports use CRM stage/status and must not count opportunity value as booked revenue.
- Sales by customer/product uses accounting document line items only when user has source document read permission.

Inventory:

- Stock balance derives from inventory source-of-truth balances/movements from item 05.
- Negative stock, reserved stock, count variance, and reorder risk follow inventory policy.
- Inventory value appears only if valuation source exists; otherwise show quantity-only with warning `valuation_unavailable`.

Expense:

- Expense totals derive from confirmed/approved expense records, reimbursement finance-reviewed records, and AP records according to status.
- Draft and rejected expenses are excluded from final expense totals unless status analysis report selected.
- Accountant evidence datasets derive from expense source records and attachment metadata only; evidence downloads still re-check source permissions and signed URL policy.
- Receipt OCR/raw payloads are never exposed in report rows.

Tax:

- VAT/WHT summaries derive from Thai Tax item 11 period/report records.
- Tax reports must show period, report status, filing/payment status, due date, and export availability.
- Reports cannot mark filed/paid or edit tax adjustments.

Bank/Cash:

- Cash position uses bank account/reconciliation records and/or ledger cash accounts where available.
- Unreconciled counts and stale statement warnings come from Bank Reconciliation item 13.
- Sensitive bank account fields require `bank.account.sensitive_read`; otherwise mask account numbers.

Operational Health:

- Workflow SLA and dashboard health derive from workflow/dashboard adapters.
- Reports cannot retry failed workflow action or notification delivery; they only link to source console if permission allows.

## 18. Export Rules

- CSV export is mandatory for all tabular datasets in first pass and begins with a UTF-8 BOM so Thai text opens correctly in desktop Excel without a manual import wizard; that BOM is part of the hashed and retained immutable bytes.
- XLSX export should be implemented through shared export service using an existing spreadsheet writer if present; otherwise use `exceljs` when dependency policy allows. If not available, route returns typed `export_format_unavailable`.
- Export rows use same server-side filters, permission checks, and source adapters as screen query.
- Export may be synchronous only under small configured row limit; otherwise queue worker job.
- Default sync export limit is 5,000 rows.
- Default async export limit is 100,000 rows.
- Requests above async export limit must fail with `export_too_large` and ask user to narrow filters.
- Export file names include dataset code, period, company-safe name, and timestamp.
- Export files expire by default after 7 days or config value.
- Stored export bytes use `report-export/<companyId>/...`; download accepts only the exact current-company segment. S3/MinIO lifecycle expires the current object at 7 days and makes its noncurrent byte version eligible for removal 1 day later, including crash-orphans, while `pending/`, evidence, receipts, and attachments keep their separate policies.
- Export metadata is audited. Audit stores ids, dataset code, filters hash/preview, row count, format, actor, source modules, and file hash. Do not store full file content in audit metadata.
- Export download re-checks current permission and export ownership/policy.
- Export cannot be triggered from LINE/AI.
- Sensitive exports require explicit user action in web and cannot be auto-delivered to external channels.

## 19. Web UI Behavior

Route shape should follow existing web shell conventions. Suggested routes:

```text
/reports
/reports/:datasetCode
/reports/views/:viewId
/reports/exports
/reports/admin
```

Reports workspace:

- Left navigation or tabs by category: Financial, Sales, Inventory, Expense, Tax, Bank, Operations, AI.
- Catalog list with search, category filter, favorites, unavailable badges, and permission-aware hidden/disabled states.
- Report detail page with filter bar, quick period controls, table/chart switch, chart type selector, save view, export button, and drill-down drawer.
- KPI strip for key measures where dataset supports it.
- Table with stable columns, sortable allowed fields, pagination/cursor, totals row, source refs, stale/partial warnings, and empty/forbidden/unavailable states.
- Saved views list with private/shared labels and owner.
- Export center showing queued/running/ready/failed/expired exports and download action.
- Admin dataset health page for `bi.admin`.

UI rules:

- Do not use marketing landing page. First screen is actual Reports workspace.
- Do not show fake sample metrics.
- Long labels must fit table headers, cards, tabs, and buttons on mobile/desktop.
- The shop-facing report catalogue, filters, measures, and result-column labels use Thai display text from the catalogue/source adapter. CSV exports reuse those same result-column labels. Keep report codes and source-module keys out of the workspace.
- Assistant-facing report source references use the report title from that same catalogue; do not maintain a second report-name list.
- Propose a saved-view name with the report title and the shared Thai short date. Preserve names that a company has already saved or typed.
- Format report dates and times with the shared Thai date helpers, period keys as Thai short months, numeric values with Thai grouping, booleans as ใช่/ไม่ใช่, and money as two decimal places followed by the row's currency: บาท for THB, the code of another currency, nothing when the source does not know it (charts the same). A report without a currency column is in the company's base currency, baht; a report whose rows can be in different currencies carries a สกุลเงิน column (the accountant evidence report gained one).
- Show the dataset's `freshnessSlaSeconds` as a Thai freshness threshold in minutes, not as a promise that the source updated within that interval.
- Result rows and CSV files show words, never the machine values rows carry. `reports/domain/report-row-text.logic.ts` holds the one map, per report and column (statuses, ledger sections and classes, metric keys, severity, freshness, tax type, form and period status, movement type and direction, input-VAT claim, THB as บาท; other currencies keep their code), plus ใช่/ไม่ใช่ and the chart labels taken from those columns; shared contract labels are reused. The report page's query response and the CSV export pass through it. The adapter rows keep the machine values because the assistant's report tool keys on them.
- CSV dates and times are the company's (Asia/Bangkok), written `YYYY-MM-DD` and `YYYY-MM-DD HH:mm` so a spreadsheet sorts them; a civil date stays as it is. The file is named by the report's Thai title and the company day (`reportCsvFileName`; a character a file name may not hold becomes `-`), plus `-ข้อมูลบางส่วน` when partial.
- A report's catalogue description says what its rows hold (shared words from contracts), and the reports guide copies titles and descriptions word for word (API test reads the guide). The ledger use cases sum only the selected period's posted lines (opening balance 0, nothing carried forward), so the general ledger and trial balance balance columns read ยอดสุทธิในงวด and the ledger descriptions say the period is not cumulative (2026-10-03).
- Every warning code a report can return has its own Thai sentence on the page (`reportWarningText`); the generic partial-data sentence is only for a code the page does not know. A web test reads the codes from the API sources.
- Rows show document numbers and the names people know (product, storage location, the company's expense category, an archived one included, customer), never an internal id. A record without a number shows none; a customer without a name shows ไม่ระบุชื่อลูกค้า.
- Export/download buttons are hidden or disabled when permission or source export permission missing.
- Drill-down links open source module pages and source pages re-check permission.
- If source module missing, show unavailable state with module name and no fake zero.
- If only some source modules unavailable, result status is `PARTIAL` with warning.
- If permission is missing for a dataset, do not leak row counts, totals, or sensitive labels.

## 20. LINE and AI Behavior

LINE can:

- Answer report summaries for datasets user can read.
- Return small KPI summaries with source names, computed time, and freshness.
- Provide deep links to web report and source records where permission allows.
- Notify user that an export or scheduled report is ready through Dashboard/Notification `report_ready` event.

LINE cannot:

- Run export, download export, share saved view, manage dataset, create subscription, or change filters as persistent state.
- Show full report tables with sensitive details beyond concise summary.
- Perform final money, stock, tax, accounting, approval, permission, or source mutation.

AI Gateway can:

- Call permission-checked report summary/detail tools.
- Cite report run id, dataset code, source modules, and computed time.
- Explain missing data, forbidden data, stale snapshots, and ledger/source mismatch warnings.

AI Gateway cannot:

- Query database directly.
- Execute arbitrary SQL.
- Export files.
- Bypass report/source permission.
- Invent totals when report API returns unavailable/partial/forbidden.

## 21. Notifications and Workflow Integration

Report-ready event:

```text
triggerKey: report_ready
sourceModule: reports
sourceType: report_export | report_subscription | report_snapshot
sourceId: exportId | subscriptionRunId | snapshotId
severity: info
channels: web, line where user preference and permission allow
deepLink: report/export detail
```

Rules:

- Notification recipient must be requester/subscription owner unless workflow/source policy expands recipients.
- Opening notification re-checks report and source permissions.
- Workflow may request report generation or create tasks around report readiness only through report APIs.
- Workflow cannot auto-export sensitive data to external channels.
- Failed report jobs can create workflow/admin task if workflow primitives exist.

## 22. Audit, Retention, and Privacy

Always audited:

- Report export request.
- Report export download.
- Saved view share/unshare.
- Shared view update/archive.
- Dataset admin enable/disable/config change.
- Subscription create/update/delete.
- Sensitive financial/tax/bank report query if audit policy marks it sensitive.
- Drill-down denied on sensitive source record.

Audit metadata includes:

- Actor, company, roles/permission snapshot ids where available.
- Dataset code/version and view id.
- Filter hash and safe preview.
- Source modules and row count.
- Export format, file hash, expiry, and status.
- Result status and warning codes.

Privacy rules:

- Do not store full report result in audit logs.
- Do not expose raw OCR payloads, raw bank import files, tax certificate raw payloads, AI prompts, or object storage keys in report rows.
- Mask bank account numbers unless permission allows.
- Use source modules to redact customer PII where marketing/staff permissions are limited.
- Export files expire and can be regenerated by authorized users.

## 23. Edge Cases

- Source module not implemented: dataset returns `UNAVAILABLE`; catalog can show disabled/unavailable without fake values.
- Source permission revoked after report run: run/export/download/drill-down re-checks current permission and blocks restricted data.
- Source data changes after snapshot: result marked `STALE` or export blocked with `source_state_changed` when policy requires fresh data.
- Ledger not posted for operational source: operational report can show source total with `ledger_not_posted` warning; financial statements must exclude unposted source records.
- Ledger mismatch with AR/AP/source total: report returns warning and reconciliation difference.
- Closed period: reports remain readable; source mutation remains blocked by source module.
- Missing due date: aging report uses issue date and warning.
- Multi-currency source without conversion: show source currency and warning; do not invent base currency conversion.
- Large report query: require narrower filters or async export.
- Empty result: show empty state with filters, not error.
- Partial ABAC scope: report returns scoped totals only and labels scope.
- Saved view references removed field: mark view invalid and offer edit/reset.
- Export job fails after file creation: clean temporary file if storage pattern supports cleanup.
- Snapshot build races with source update: snapshot stores source hash/version and freshness metadata.
- User opens shared view but lacks source permission: view metadata may show but query returns forbidden/unavailable according to policy.

## 24. Acceptance Criteria

- [x] Reports BI docs are ready for item 18 implementation handoff.
- [x] Shared report contracts compile and are exported from `packages/contracts`.
- [x] Report/BI permission keys are added/aligned and enforced with deny-by-default behavior.
- [x] Report catalog lists visible datasets with status, category, required permissions, filters, dimensions, measures, chart kinds, and freshness metadata.
- [x] Report query API validates filters/dimensions/measures/sort and returns bounded company-scoped results.
- [x] Financial statements derive from posted ledger lines only.
- [x] AR/AP reports reconcile to ledger control accounts where ledger exists and expose mismatch warnings.
- [x] Operational reports derive from source-module query ports or checked snapshots, not duplicated raw repositories.
- [x] Missing source modules return unavailable/partial state, not fake zero.
- [x] Saved views support private views and permission-controlled sharing.
- [x] Web Reports workspace supports catalog, filters, table/chart, drill-down, saved views, export center, and forbidden/unavailable/empty/stale states.
- [x] CSV export works for tabular datasets and uses same permission/filter path as screen query.
- [x] XLSX export works or returns typed `export_format_unavailable` while CSV remains available.
- [x] Export request/download are audited and permission-checked.
- [x] Report-ready notification event is emitted through Dashboard/Notification integration when export/subscription completes.
- [x] LINE/AI summaries are permission-aware, source-cited, and deep-link to web.
- [x] LINE/AI cannot export, share views, manage datasets, or mutate source records.
- [x] Cross-company access is blocked.
- [x] Source permission revocation after run blocks later download/drill-down.
- [x] Master Implementation Checklist item 18 checked after implementation and verification passed.

## 25. Required Tests

Unit:

- Dataset registry hides/marks unavailable datasets according to module availability and permissions.
- Query validator rejects unknown filters, dimensions, measures, sort fields, excessive range, and excessive page size.
- Report permission policy requires both report permission and source permission.
- Report status mapping handles ready, partial, empty, forbidden, unavailable, stale, invalid filter, and failed.
- CSV export escapes commas, quotes, newlines, formulas, and null values safely.
- XLSX unavailable path returns typed error when generator unavailable.
- Source freshness/staleness calculation.
- Saved view validation rejects removed/unknown fields.

Integration:

- Catalog API returns only allowed datasets.
- Report query denies cross-company access.
- GL/TB/P&L/BS route delegates to ledger report adapter and does not read raw documents directly.
- AR aging uses accounting source and emits ledger mismatch warning when control total differs.
- Stock balance uses inventory source adapter and location ABAC.
- Tax summary uses tax source adapter and denies missing `tax.report.read`.
- Export request creates audited export job and file metadata.
- Export download re-checks current permission.
- Drill-down calls source module detail/link API and logs allowed/denied access.
- Report-ready notification event is emitted after export ready.
- Scheduled report, if implemented, re-checks current permissions before run.

API permission:

- User with `report.query.run` but without source permission gets forbidden/unavailable without totals.
- User with source permission but without report permission gets `403`.
- User without `report.export` cannot request company export.
- User with only `report.export.read_own` cannot download another user's export.
- Manager without explicit finance scope cannot read company-wide finance summary datasets.
- Shared view cannot be created without `report.view.share`.
- Admin dataset route requires `bi.admin`.

Web:

- Reports catalog renders loading, ready, empty, unavailable, forbidden, and error states.
- Filter changes trigger query and preserve valid URL/search state according to web conventions.
- Table/chart view handles long labels and mobile/desktop layouts without overlap.
- Drill-down opens drawer/link only where permission allows.
- Saved view create/update/share states.
- Export center shows queued/running/ready/failed/expired states.

LINE/AI:

- LINE summary for allowed dataset includes computed time, freshness, and web link.
- LINE refuses export/share/admin actions.
- AI report tool without source permission returns permission-limited response.
- AI does not invent totals when API returns unavailable/partial.

E2E/smoke:

- Owner opens Reports, runs Sales Summary, saves private view, exports CSV, receives report-ready notification, downloads export, and audit entry exists.
- Finance runs AR Aging, sees ledger mismatch warning, drills into invoice link.
- Inventory user runs Stock Balance for allowed location and cannot read other location.
- Accountant runs Trial Balance and exports CSV.
- Sales user cannot read company-wide financial statement.
- Source permission revoked after export ready prevents later download.

## 26. Implementation Handoff Checklist

- [ ] Read [[plans/master-implementation-checklist|Master Implementation Checklist]] item 18.
- [ ] Read [[plans/reports-bi-plan|Reports BI Plan]].
- [ ] Read this spec.
- [ ] Read [[specs/permission-matrix|Permission Matrix]] and add/align report/BI keys.
- [ ] Read [[specs/dashboard-notification-spec|Dashboard and Notification Spec]] for `report_ready`.
- [ ] Read [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]] for financial report derivation.
- [ ] Read source-module specs for every adapter enabled in current code.
- [ ] Inspect current code before editing.
- [ ] Start with contracts, permissions, dataset registry, and query validation before UI polish.
- [ ] Implement with source adapters/query ports, not cross-module repository imports.
- [x] Item 18 checked after acceptance criteria and verification commands passed on 2026-07-04.

## 27. Owner Decisions

- Curated report catalog and controlled BI saved views are first-pass scope.
- Arbitrary SQL and unrestricted custom report builder are deferred.
- CSV export is required for first pass.
- XLSX uses existing spreadsheet writer if present; otherwise use `exceljs` when dependency policy allows. Typed unavailable fallback is allowed only when dependency cannot be used.
- PDF export is deferred.
- LINE/AI can summarize and deep-link only; export and view sharing are web-only.
- Manager finance summaries are disabled by default until explicit finance scope is granted.
- First-pass export defaults are 100 rows/page, sync export up to 5,000 rows, async export up to 100,000 rows, and 7-day export expiry.
- Scheduled report subscriptions are optional first pass and only if worker/notification primitives already exist.

## 28. Backlog Notes

- Revisit production export row/size limits after real customer data volume is known.
- Revisit manager finance-summary scope before beta if owner wants broader manager visibility.
- Revisit spreadsheet writer only if repo later standardizes on a different XLSX package than `exceljs`.

## Browser regression amendment — 2026-10-04

The retained-report history route remains available under its existing artifact-read permission gates when Reports is not enabled. Its description states only that it displays accessible history/files; it must not imply that this company previously purchased Reports or that files exist. With a successful empty read it says there are no accessible report files. Loading or failed reads must not be described as an empty result. History-only mode has no save-view or create-export button, including a disabled button; permitted retained-artifact downloads retain their existing checks.
