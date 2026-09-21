# Dashboard and Notification Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 06.

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Give each company a trusted web dashboard, notification center, alert rule engine, and LINE alert delivery path that later modules can reuse without reinventing metric, trigger, recipient, cooldown, preference, audit, or delivery behavior.

Item 06 comes after Inventory MVP and before LINE AI Read-Only Assistant. The first implementation must ship reusable dashboard and notification primitives plus concrete inventory-backed alerts. It must not pretend future accounting, tax, CRM, procurement, or BI data exists before those source modules are implemented.

## 3. Non-goals

- Advanced BI builder, arbitrary report designer, custom SQL, or pivot-table workspace.
- Full Reports BI item 18.
- Accounting document, receivable, payable, tax, CRM, procurement, payroll, or bank-reconciliation source modules.
- Ledger-backed P&L, balance sheet, trial balance, or cashflow before Double-Entry Ledger item 10 exists.
- LINE AI chat or free-form read tools. Those belong to item 07.
- AI draft suggestion layer, AI marketing drafts, or workflow automation rules. Those belong to later items.
- Final approval, money, stock, tax, permission, posting, or external publishing actions from notifications or LINE.
- Native mobile push.
- Sending noisy alerts without source links, deduplication, cooldown, quiet hours, and preferences.
- Replacing web as the full workspace for detail review and action.

## 4. User Roles

- Owner: sees company health, urgent exceptions, daily summary, low-stock risk, and alert history.
- Admin: configures dashboard defaults, notification rules, recipient policies, channel policies, and company-wide preferences.
- Manager: sees team queues, SLA exceptions, and team-scoped alerts where ABAC allows.
- Sales: later sees own follow-ups, pipeline signals, and customer alerts after CRM/Sales item 15.
- Inventory staff: sees low stock, stockout risk, recent stock movements, and assigned stock alerts.
- Finance/accountant: later sees finance, tax, ledger, receivable, payable, close, and export alerts when those modules exist.
- Marketing: later sees campaign opportunities and content prompts when marketing modules exist.
- Staff: sees own tasks, own approvals, and own notifications.
- Auditor readonly: reads dashboard summaries and notification audit trail without mutation where permission allows.
- AI assistant user: later receives AI answers through item 07 tools; item 06 only prepares source-linked notification and summary payloads.

## 5. Boundary and Ownership

Dashboard and Notification owns:

- Company-scoped dashboard snapshot model and generation use cases.
- Dashboard widget registry and source-adapter contract.
- Notification trigger registry and rule configuration.
- Notification event, recipient, preference, delivery, read-state, cooldown, and audit behavior.
- Web dashboard, notification center, notification drawer, preferences, and rule management screens.
- Worker delivery pipeline for web notification persistence and LINE push delivery.
- Delivery adapter boundaries for LINE, web toast/polling, and future email/native channels.
- Shared contracts for dashboard summaries, widgets, notifications, preferences, rule configuration, and source references.

Source modules own:

- Source-of-truth records and source-specific validation.
- Metric query adapters for their data.
- Alert candidate adapters or outbox events for their data.
- Source-specific permissions and ABAC.
- Source detail pages and action pages opened by notification deep links.

Data Model Core owns:

- `Company`, `Branch`, membership, audit, attachment, document sequence, and outbox primitives where implemented by item 04.
- Transactional outbox table and worker claim path if already implemented.

Auth/RBAC owns:

- User/session identity, company membership, role grants, permission guard, request context, and audit actor.

Web Core Workspace owns:

- Workspace shell, route conventions, common UI primitives, navigation registry, permission-aware empty/forbidden states, and deep-link path patterns.

LINE Channel/Auth owns:

- LINE account linking, external identity, shared channel validation, selected company context, LIFF auth, and webhook signature verification.

AI Gateway and LINE AI item 07 owns:

- Free-form chat, read tools, source-aware answers, and AI follow-up prompts. Item 06 may store summary payloads and source refs, but it must not build the full AI assistant.

Workflow Automation item 16 owns:

- Cross-module workflow templates, arbitrary workflow rule actions, replay UI, dead-letter management, and task creation beyond notification delivery.

Reports BI item 18 owns:

- Advanced reports, exports, historical trend analysis beyond dashboard snapshots, and custom BI views.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/web`: Next.js App Router app with `platform-foundation` feature example, CSS Modules, shared `Badge`, `Stack`, and design-token imports.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/ai-gateway`: NestJS service shell with health/security patterns.
- `packages/contracts`: shared TypeScript contract package exists but is currently thin.
- `packages/config`: shared config package exists but is currently thin.
- No Prisma schema exists in this snapshot.
- ADR 0006 chooses Prisma, PostgreSQL, Redis/BullMQ, S3-compatible object storage, NestJS hexagonal modules, shared TypeScript contracts, and AWS ECS/RDS/Redis/S3 defaults.

Implementation must inspect current code before editing. Items 01 through 05 may add config, Prisma, auth, request context, audit, outbox, web workspace shell, shared API client, contracts, inventory schema, and inventory APIs before item 06 starts. If those exist, extend them. Do not create duplicate tenant, auth, audit, outbox, permission, web-shell, HTTP-client, or inventory read primitives.

## 7. Linked Plan and References

- Plan: [[plans/dashboard-notification-plan|Dashboard and Notification Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 06.
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Web shell: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- Inventory: [[specs/inventory-mvp-spec|Inventory MVP Spec]]
- LINE channel/auth: [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
- LINE UX: [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Workflow automation: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Reports BI: [[specs/reports-bi-spec|Reports BI Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Web guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Product Decisions

- Tenant boundary is `companyId`.
- Route `companyId`, selected company, or LINE company context is a selection hint only. Backend must verify active membership and permissions.
- Web is the full detail and action surface.
- LINE is summary, alert, and deep-link channel for item 06. LINE AI chat comes in item 07.
- Notification rule configuration is web-only and requires admin permission.
- Notification recipients are users, not raw phone numbers or LINE ids.
- Notification delivery uses linked LINE identities only. Unknown or unlinked LINE users receive no business data.
- Every notification event must have a source reference or dashboard snapshot reference.
- Dashboard metrics must disclose source module, computed time, freshness, and unavailable state when source data does not exist.
- Item 06 implements inventory-backed dashboard widgets and inventory alert rules because Inventory MVP is item 05.
- Metrics for sales, finance, tax, CRM, procurement, payroll, and bank reconciliation remain registered future hooks until source modules exist.
- Low-priority alerts can be digested. Critical alerts bypass digest but still respect recipient permission and deduplication.
- Quiet hours suppress non-critical LINE delivery by default. Web notification center still records the event.
- Native mobile push is deferred.
- Email delivery is not part of item 06. Record it as a future email-notification feature for report/export and finance workflows.
- Dashboard snapshots are reproducible from source records or clearly marked as generated summaries. No fake business metrics.
- Financial dashboard widgets that require ledger reports stay unavailable until item 10.
- Final business changes from notification deep links happen in web routes that re-check permission and current record state.

## 9. Permission Model

Minimum permission keys:

```text
dashboard.read
dashboard.configure
dashboard.snapshot.generate
notification.read
notification.preference.manage
notification.rule.manage
notification.delivery.read
notification.delivery.retry
```

Recommended source-gated behavior:

- Dashboard access requires `dashboard.read` plus the source permission for restricted widgets.
- Inventory widgets require inventory read/report permission from item 05.
- Notification center requires `notification.read` and only returns notifications addressed to the requesting user, plus admin/auditor views where explicitly granted.
- Notification rule CRUD requires `notification.rule.manage`.
- Preference update requires `notification.preference.manage` for self, or admin permission for another user.
- Delivery logs require `notification.delivery.read`.
- Delivery retry requires `notification.delivery.retry` or admin permission.
- Opening a notification deep link must re-check current source permission. A delivered alert never grants source-record access.
- AI Gateway item 07 must inherit the same permissions when reading dashboard snapshots or notification source refs.

Default grant intent:

- OWNER: all dashboard and notification permissions.
- ADMIN: configure, rule manage, delivery read/retry, preference manage, dashboard read.
- MANAGER: dashboard read and team-scoped notification read.
- INVENTORY: dashboard read for inventory widgets and own/team inventory notifications.
- FINANCE/ACCOUNTANT: dashboard read for finance widgets when source modules exist, own finance notifications.
- SALES/MARKETING/STAFF: dashboard read and own/module notifications according to source module permission.
- AUDITOR_READONLY: dashboard read, notification read, and delivery read without mutation.

## 10. Shared Contracts

Add or extend shared contracts under `packages/contracts/src`.

Recommended files:

```text
packages/contracts/src/dashboard.ts
packages/contracts/src/notifications.ts
packages/contracts/src/index.ts
```

Minimum dashboard exports:

```ts
export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'custom';

export type DashboardMetricFreshness = 'fresh' | 'stale' | 'unavailable';

export type DashboardWidgetKind =
  | 'metric_card'
  | 'metric_list'
  | 'trend'
  | 'queue'
  | 'alert_digest'
  | 'module_status';

export type DashboardSourceRef = {
  module: string;
  sourceType: string;
  sourceId?: string;
  label: string;
  href?: string;
  permissionKey?: string;
};

export type DashboardMetricValue = {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  severity?: 'normal' | 'info' | 'warning' | 'critical';
  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
    value: number | null;
    label: string;
  };
  freshness: DashboardMetricFreshness;
  sourceRefs: DashboardSourceRef[];
  computedAt: string;
};

export type DashboardWidget = {
  key: string;
  title: string;
  kind: DashboardWidgetKind;
  module: string;
  metrics: DashboardMetricValue[];
  href?: string;
  unavailableReason?: string;
};

export type DashboardSnapshotDto = {
  id: string;
  companyId: string;
  periodKind: DashboardPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  widgets: DashboardWidget[];
};
```

Minimum notification exports:

```ts
export type NotificationSeverity = 'critical' | 'action' | 'insight' | 'info';

export type NotificationChannel = 'web' | 'line';

export type NotificationEventStatus = 'open' | 'resolved' | 'suppressed' | 'expired';

export type NotificationDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'suppressed';

export type NotificationTriggerKey =
  | 'daily_owner_summary'
  | 'stock_low'
  | 'stockout_risk'
  | 'sales_today_low'
  | 'invoice_overdue'
  | 'tax_due_soon'
  | 'approval_pending'
  | 'follow_up_due'
  | 'campaign_opportunity'
  | 'report_ready'
  | 'system_security_alert';

export type NotificationSourceRef = {
  module: string;
  sourceType: string;
  sourceId?: string;
  href?: string;
  label: string;
  permissionKey?: string;
};

export type NotificationSummaryDto = {
  id: string;
  companyId: string;
  triggerKey: NotificationTriggerKey | string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sourceRefs: NotificationSourceRef[];
  deepLinkHref?: string;
  createdAt: string;
  readAt?: string;
  deliveryChannels: NotificationChannel[];
};

export type NotificationPreferenceDto = {
  userId: string;
  enabledChannels: NotificationChannel[];
  enabledTriggerKeys: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  digestFrequency: 'none' | 'daily' | 'weekly';
};
```

Use contract values at API, web, workers, and AI Gateway boundaries. Domain models may use richer internal types, but external payloads should stay stable and explicit.

## 11. Data Model Draft

Use existing tenant/auth/audit/outbox models if item 01 through 05 already created them. Names below are conceptual; adapt exact Prisma naming to existing convention.

### DashboardSnapshot

- `id`
- `companyId`
- `scope`: `company`, `role`, or `user`
- `scopeKey`: nullable role key or user id
- `periodKind`: `today`, `week`, `month`, `quarter`, `custom`
- `periodStart`
- `periodEnd`
- `metricsJson`
- `sourceRefsJson`
- `freshnessStatus`: `fresh`, `stale`, `partial`, `unavailable`
- `generatedBy`: `system`, `manual`, `worker`, `ai_gateway`
- `generatedAt`
- `createdAt`

Indexes:

- `companyId`, `periodKind`, `periodStart`, `periodEnd`, `generatedAt`
- `companyId`, `scope`, `scopeKey`, `generatedAt`

### DashboardWidgetConfig

- `id`
- `companyId`
- `widgetKey`
- `moduleKey`
- `status`: `enabled`, `disabled`
- `position`
- `configJson`
- `createdByUserId`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

Unique:

- `companyId`, `widgetKey`

### NotificationRule

- `id`
- `companyId`
- `triggerKey`
- `name`
- `severity`
- `conditionJson`
- `recipientPolicyJson`
- `channelPolicyJson`
- `cooldownMinutes`
- `digestPolicy`: `none`, `daily`, `weekly`
- `status`: `enabled`, `disabled`, `system`
- `createdByUserId`
- `updatedByUserId`
- `createdAt`
- `updatedAt`

Unique:

- `companyId`, `triggerKey` for system/default rules unless multiple custom rules are explicitly supported later.

### NotificationEvent

- `id`
- `companyId`
- `ruleId`: nullable for system events
- `triggerKey`
- `sourceModule`
- `sourceType`
- `sourceId`: nullable for snapshot-level events
- `severity`
- `title`
- `body`
- `payloadJson`
- `sourceRefsJson`
- `deepLinkHref`
- `dedupKey`
- `status`: `open`, `resolved`, `suppressed`, `expired`
- `firstSeenAt`
- `lastSeenAt`
- `resolvedAt`
- `createdAt`
- `updatedAt`

Indexes:

- `companyId`, `triggerKey`, `status`, `createdAt`
- `companyId`, `sourceModule`, `sourceType`, `sourceId`
- `companyId`, `dedupKey`

### NotificationRecipient

- `id`
- `eventId`
- `companyId`
- `userId`
- `recipientReason`: `owner`, `role`, `assigned`, `team`, `rule`, `self`
- `readAt`
- `dismissedAt`
- `snoozedUntil`
- `createdAt`

Unique:

- `eventId`, `userId`

### NotificationDelivery

- `id`
- `recipientId`
- `companyId`
- `channel`: `web`, `line`
- `status`: `queued`, `sending`, `sent`, `failed`, `skipped`, `suppressed`
- `attemptCount`
- `nextAttemptAt`
- `sentAt`
- `errorCode`
- `errorMessage`
- `providerMessageId`
- `metadataJson`
- `createdAt`
- `updatedAt`

Indexes:

- `companyId`, `channel`, `status`, `nextAttemptAt`
- `recipientId`, `channel`

### NotificationPreference

- `id`
- `companyId`
- `userId`
- `enabledChannelsJson`
- `enabledTriggerKeysJson`
- `quietHoursStart`
- `quietHoursEnd`
- `timezone`
- `digestFrequency`
- `createdAt`
- `updatedAt`

Unique:

- `companyId`, `userId`

### AlertState

- `id`
- `companyId`
- `dedupKey`
- `status`: `active`, `cooling_down`, `resolved`
- `occurrenceCount`
- `lastTriggeredAt`
- `cooldownUntil`
- `lastResolvedAt`
- `createdAt`
- `updatedAt`

Unique:

- `companyId`, `dedupKey`

### Channel-Specific Delivery Records

If item 02 already defines `LineDelivery`, attach it to `NotificationDelivery` or reuse it for LINE-specific provider status. If it does not exist, store LINE provider fields in `NotificationDelivery.metadataJson` for item 06 and avoid duplicate tables.

## 12. Dashboard Source Adapters

Use a source-adapter contract so later modules plug in safely:

```ts
export type DashboardMetricProviderPort = {
  moduleKey: string;
  collectMetrics(input: {
    companyId: string;
    userId: string;
    permissions: string[];
    periodStart: Date;
    periodEnd: Date;
  }): Promise<DashboardWidget[]>;
};
```

Rules:

- Provider must return unavailable widgets when its source module is not installed or not migrated.
- Provider must not leak restricted data when source permission is missing.
- Provider must include source refs or snapshot refs for every metric.
- Provider must report freshness and computed time.
- Provider must avoid N+1 queries and use source-module query ports where available.
- Dashboard module must not import Prisma repositories from other modules directly. Use source-module query ports, application services, or contracts exposed by the source module.

Item 06 required providers:

- Dashboard summary provider: active critical/action alert counts, unread notifications, last snapshot time, unavailable module list.
- Inventory health provider: low stock count, stockout count, stockout risk count, top low-stock products, last stock movement time, links to inventory report/detail routes.
- Module status provider: shows which planned metric groups are not available yet because source modules are not implemented.

Future providers:

- Sales/revenue provider after accounting/sales source modules exist.
- Receivables/payables provider after accounting/procurement/bank modules exist.
- Tax provider after Thai Tax item 11 exists.
- CRM follow-up provider after CRM item 15 exists.
- Workflow queue provider after workflow item 16 exists.
- Ledger-backed finance provider after Double-Entry Ledger item 10 exists.
- Reports BI provider after item 18 exists.

## 13. Web Dashboard Behavior

Primary route:

```text
/companies/[companyId]/dashboard
```

Recommended feature folder:

```text
apps/web/src/features/dashboard-notification/
  dashboard-notification.api.ts
  dashboard-notification.constants.ts
  dashboard-notification.logic.ts
  dashboard-notification.model.ts
  components/
    CompanyDashboardPage.tsx
    NotificationCenterPage.tsx
    NotificationDrawer.tsx
    NotificationPreferencesPage.tsx
    NotificationRulesPage.tsx
```

Dashboard must show:

- Company-scoped page title and period control.
- KPI/metric cards only for available source data.
- Inventory health section after item 05 is available.
- Alert digest and unread notification count.
- Recent critical/action notifications.
- Module-unavailable states for future widgets without fake numbers.
- Drill-down links to source pages using Web Core deep-link conventions.
- Loading, empty, stale, error, forbidden, and partial-data states.

Widget rules:

- No metric card may show `0` when the source is unavailable. Use unavailable/partial state.
- Drill-down links must be hidden or disabled if user lacks source permission.
- Stale snapshots must show computed time.
- Critical/action notifications should be visible near top without using decorative marketing layout.
- User layout preferences can wait unless implementation cost is low; widget enable/disable config is enough.

## 14. Notification Taxonomy

Severity levels:

- `critical`: security issue, tax due today, stockout, severe delivery failure, high-risk operational issue.
- `action`: approval needed, follow-up due, low stock, invoice overdue, report needs review.
- `insight`: sales trend, product suggestion, stockout risk, AI recommendation.
- `info`: export ready, report ready, summary generated, background job complete.

Customer-facing Thai labels keep these machine severities unchanged but render `critical` as `สำคัญ` (not `วิกฤต`) on web and LINE.

Channels:

- `web`: notification center and optional web toast/polling.
- `line`: LINE push to linked users with preferences enabled.
- LINE push renders a compact structured card with severity, title, body, and at most one primary URI button. It must not put a naked deep-link URL in message text or trigger LINE's large link preview.
- The URI button opens the same permission-checked web deep link owned by the notification event. If no trusted absolute web origin is configured, omit the button instead of inventing a host.
- Email is reserved for a future email-notification feature. Do not implement email delivery, provider config, or preference UI in item 06.

Event status:

- `open`: active notification visible to recipients.
- `resolved`: source condition no longer true or event manually resolved by system/admin.
- `suppressed`: generated but not shown/delivered due to rule/preference/policy.
- `expired`: no longer relevant after TTL.

Delivery status:

- `queued`
- `sending`
- `sent`
- `failed`
- `skipped`
- `suppressed`

Read state belongs to recipient (`readAt`), not delivery status.

## 15. Core Alert Rules

| trigger | source module | first implementation status | condition | default recipients | default channels | cooldown | deep link |
|---|---|---|---|---|---|---|---|
| `daily_owner_summary` | dashboard | implement | daily snapshot generated at 07:00 Asia/Bangkok by default, company-configurable later, or manual trigger | Owner, Admin optional | web, line | 20 h | dashboard |
| `stock_low` | inventory | implement | stock balance <= reorder point where reorder point is set and product/location active | Owner, Inventory, Admin | web, line | 12 h per product/location | inventory stock/product detail |
| `stockout_risk` | inventory | implement if movement trend data exists; otherwise disabled | projected days left <= threshold | Owner, Inventory | web, line | 12 h per product/location | inventory stock/product detail |
| `sales_today_low` | sales/accounting | future disabled | sales today below target by cutoff time | Owner, Sales manager | web, line | 6 h | sales dashboard |
| `invoice_overdue` | accounting | future disabled | invoice unpaid after due date | Owner, Finance, Sales owner | web, line | 24 h per invoice | invoice detail |
| `tax_due_soon` | tax | future disabled | tax due within N days and not filed | Owner, Finance, Accountant | web, line | 24 h per tax period | tax period |
| `approval_pending` | approvals/workflow | future disabled | approval pending beyond SLA | Manager, Owner | web, line | 6 h per approval | approval detail |
| `follow_up_due` | CRM | future disabled | CRM task due today or overdue | Sales assignee, Manager | web, line | 24 h per task | customer/task detail |
| `campaign_opportunity` | marketing | future disabled | low sales + enough stock + margin ok | Marketing, Owner | web, line | 24 h per candidate | marketing draft |
| `report_ready` | reports | future disabled | report/export generated | requester | web; email later | none | report/export detail |
| `system_security_alert` | auth/audit | future hook | suspicious auth/security event | Owner, Admin | web, line for critical | none | security/audit detail |

Default rule creation:

- Seed enabled rules only for implemented triggers.
- Seed disabled system rules for future triggers only if they are clearly marked unavailable and cannot fire.
- Admin can edit condition thresholds, recipients, channels, cooldown, and enabled status for implemented triggers.
- Admin cannot enable future triggers until source module declares provider support.

## 16. Notification Generation Rules

- Every event needs `companyId`, `triggerKey`, severity, title, body, source refs, dedup key, and recipient policy.
- Dedup key must be deterministic and include company, trigger, source module, source type, and source id or snapshot period.
- Existing active event with same dedup key inside cooldown updates `lastSeenAt` and `occurrenceCount`, not a new event.
- Resolved source condition updates existing event to `resolved`.
- Preference suppression still creates auditable `NotificationDelivery` status `suppressed` or `skipped`.
- Rule disable suppresses new events but must not delete existing history.
- Delivery retry must be idempotent by delivery id and provider idempotency where available.
- Worker must cap retry attempts and record error code/message without leaking secrets.
- Critical events bypass quiet hours but still respect permission and channel availability.
- Action/insight/info LINE delivery respects quiet hours; web notification center still records event.
- Digest delivery groups low-priority events by recipient, company, period, and severity.
- A notification recipient is resolved at event creation time; if permissions change later, opening the source deep link still re-checks current access.

## 17. API Behavior

Use current API route conventions from items 01 through 05. If no convention exists, default to `/v1/companies/:companyId/...`.

Dashboard:

- `GET /v1/companies/:companyId/dashboard`
  - Permission: `dashboard.read`.
  - Query: period kind/date range, optional widget keys.
  - Behavior: returns latest fresh snapshot when available, otherwise computes read-through snapshot if safe.
  - Response: `DashboardSnapshotDto`.
- `GET /v1/companies/:companyId/dashboard/snapshots/latest`
  - Permission: `dashboard.read`.
  - Behavior: returns latest snapshot metadata and widgets.
- `POST /v1/companies/:companyId/dashboard/snapshots/generate`
  - Permission: `dashboard.snapshot.generate` or internal worker auth.
  - Behavior: generates snapshot for period/scope and writes audit/outbox where available.

Notifications:

- `GET /v1/companies/:companyId/notifications`
  - Permission: `notification.read`.
  - Query: status, severity, triggerKey, channel, read state, date range, cursor.
  - Behavior: returns notifications addressed to current user unless admin/auditor scope is explicit.
- `GET /v1/companies/:companyId/notifications/unread-count`
  - Permission: `notification.read`.
  - Behavior: returns unread count grouped by severity.
- `POST /v1/companies/:companyId/notifications/:notificationId/read`
  - Permission: `notification.read`.
  - Behavior: marks current user's recipient row read.
- `POST /v1/companies/:companyId/notifications/read-all`
  - Permission: `notification.read`.
  - Behavior: marks current user's visible recipient rows read for optional filters.
- `POST /v1/companies/:companyId/notifications/:notificationId/dismiss`
  - Permission: `notification.read`.
  - Behavior: dismisses current user's recipient row only.
- `GET /v1/companies/:companyId/notification-preferences`
  - Permission: `notification.preference.manage` for self or admin for another user.
- `PUT /v1/companies/:companyId/notification-preferences`
  - Permission: `notification.preference.manage`.
  - Validation: enabled channels, trigger keys, quiet hours, timezone.

Rules:

- `GET /v1/companies/:companyId/notification-rules`
  - Permission: `notification.rule.manage` for admin/config view.
- `PUT /v1/companies/:companyId/notification-rules/:ruleId`
  - Permission: `notification.rule.manage`.
  - Validation: source trigger support, threshold shape, recipient policy, channel policy, cooldown.
- `POST /v1/companies/:companyId/notification-rules/:ruleId/test`
  - Permission: `notification.rule.manage`.
  - Behavior: validates recipients and creates a test notification only in safe test mode; do not send real LINE messages unless explicitly requested and audited.

Delivery/admin:

- `GET /v1/companies/:companyId/notification-deliveries`
  - Permission: `notification.delivery.read`.
- `POST /v1/companies/:companyId/notification-deliveries/:deliveryId/retry`
  - Permission: `notification.delivery.retry`.
  - Behavior: requeues failed delivery when retry policy allows.

Internal ingestion:

- Prefer application use cases or outbox consumers over public HTTP.
- If an internal endpoint is necessary, protect with service auth, tenant validation, idempotency key, and audit.

Error cases:

- `401` unauthenticated.
- `403` no membership or missing permission.
- `404` source record or notification not visible to user.
- `409` duplicate/dedup conflict when creating test/system events.
- `422` invalid rule condition, quiet hours, channel, or recipient policy.
- `429` delivery/rule test rate limit.

## 18. Worker and Delivery Behavior

Recommended worker module:

```text
apps/workers/src/modules/notifications/
  notification-worker.ts
  notification-jobs.ts
  notification-delivery-adapters.ts
```

Worker responsibilities:

- Generate scheduled dashboard snapshots.
- Run implemented alert scans such as `stock_low` and `stockout_risk`.
- Consume source-module outbox events when available.
- Resolve notification recipients and preferences.
- Create web notification recipient rows.
- Queue LINE deliveries for linked users with enabled preferences.
- Apply quiet hours, digest policy, cooldown, retry, and failure handling.
- Write delivery status, audit, and bounded logs.

Delivery order:

1. Evaluate rule/source signal.
2. Create or update `NotificationEvent` through dedup logic.
3. Resolve recipients through policy and current membership/permission.
4. Create `NotificationRecipient`.
5. Create channel `NotificationDelivery` rows.
6. Persist web delivery immediately as `sent` or `queued` depending on implementation.
7. Push LINE messages through adapter.
8. Mark sent/failed/skipped/suppressed.

LINE delivery:

- Requires linked `ExternalIdentity` or equivalent from LINE Channel/Auth.
- Requires active WatchDog shared LINE channel config plus linked identity/selected company context.
- Must never send to raw unverified LINE user ids from request payloads.
- Must use concise text with source label, severity, and web deep link.
- Must not include secrets, raw tokens, full financial/accounting details, or unrestricted record payloads.
- Must not offer final action buttons for money, stock, tax, approval, accounting, or permission changes.
- If LIFF/web deep link is unavailable, message should say to open web dashboard and still avoid data overexposure.

Example LINE text shape:

```text
[WatchDog] Low stock
SKU ABC-001: current 2, reorder point 5.
Open dashboard: <deep link>
```

## 19. AI Behavior

Item 06 can:

- Store dashboard snapshots with source refs for later AI answers.
- Create deterministic daily summary notification text.
- Create `daily_owner_summary` event with dashboard source refs.
- Expose permission-checked dashboard snapshot API that item 07 AI tools can call later.

Item 06 cannot:

- Build full LINE AI chat.
- Let AI bypass permission or ABAC.
- Let AI approve, post, publish, pay, move stock, edit tax, or change permissions.
- Call an LLM directly from ERP core unless an AI Gateway summary endpoint already exists and is permission-checked. If no safe AI Gateway endpoint exists, use deterministic summary text and leave AI enrichment for item 07.

AI Gateway item 07 must use API/tool access, not direct database/repository access.

## 20. Web Notification UX

Notification center route:

```text
/companies/[companyId]/notifications
```

Recommended additional routes:

```text
/companies/[companyId]/settings/notifications
/companies/[companyId]/settings/notification-rules
```

Notification center must support:

- Unread count by severity.
- Filters by severity, trigger, read state, source module, and date range.
- Notification list with stable item height, source label, timestamp, severity, channel status, and read state.
- Mark one read, mark all read, dismiss, and open source.
- Empty, loading, failed, forbidden, and no-results states.
- Deep link opening with permission re-check on source page.

Notification drawer/header behavior:

- Header unread badge from unread-count API.
- Recent critical/action items first.
- View all link to notification center.
- Polling is acceptable for MVP. WebSocket/SSE can wait unless existing app already has it.

Preferences page:

- Channel toggles: web and LINE. Email toggle belongs to a future email-notification feature.
- Trigger type toggles.
- Quiet hours start/end and timezone.
- Digest frequency.
- Save/cancel states, validation, and permission state.

Rule management page:

- Admin-only.
- List rules with status, trigger, severity, cooldown, channels, and source support.
- Edit implemented rules only.
- Future unsupported rules visible as disabled/unavailable.
- Rule test must be explicit and audit-safe.

## 21. Security, Audit, and Compliance Rules

- Deny by default.
- All API routes must verify company membership and permission server-side.
- Dashboard widget source data must re-check source-module permission.
- Notification deep links must not embed privileged data in URL.
- Notification payloads must be bounded and redacted.
- Do not log LINE access tokens, channel secrets, provider request bodies containing secrets, or raw business payloads.
- Delivery failures must record safe error code/message only.
- Notification rule changes, preference changes, delivery retry, and critical delivery failures must write audit records where audit exists.
- Sensitive source refs, finance/tax/accounting payloads, and AI tool calls must be audited after those modules exist.
- Outbox/worker jobs must be idempotent.
- Rule test endpoint must be rate-limited and audited.
- Source records deleted/archived after notification creation must not expose stale hidden data; source page handles missing/forbidden state.
- Cross-company notification, snapshot, and delivery queries must be impossible through route params or cursors.

## 22. Edge Cases

- Company has no dashboard snapshot yet.
- Source module not implemented or migration not applied.
- Inventory exists but no products or no reorder points.
- Product becomes archived after low-stock notification fires.
- Stock is replenished after low-stock notification fires.
- Repeated low-stock scan runs inside cooldown.
- Quiet hours crosses midnight.
- User disables LINE after delivery is queued.
- User loses source permission after notification is delivered.
- User belongs to multiple companies and opens a LINE deep link.
- LINE account is unlinked, disabled, or belongs to another company context.
- LINE provider returns rate limit, invalid user, timeout, or channel misconfiguration.
- Worker crashes after event creation but before delivery row update.
- Duplicate outbox event arrives.
- Rule condition JSON is invalid after code upgrade.
- Admin disables rule while deliveries are queued.
- Notification source link points to a route not yet implemented.
- Cursor pagination receives stale/foreign cursor.
- Daily summary generation overlaps across workers.

## 23. Acceptance Criteria

- [ ] Dashboard and notification docs are marked ready for item 06 implementation handoff.
- [ ] Shared dashboard and notification contracts compile and are exported.
- [ ] API module follows hexagonal structure and current repo conventions.
- [ ] Prisma/schema additions are additive and reuse existing tenant/auth/audit/outbox primitives.
- [ ] Dashboard snapshot generation works for company scope and returns unavailable states for missing source modules.
- [ ] Web dashboard shows inventory-backed metrics, alert digest, unread counts, and source drill-downs where permission allows.
- [ ] Notification rules exist for daily owner summary, low stock, and stockout risk where source data supports them.
- [ ] Future alert rules are disabled/unavailable until source modules exist.
- [ ] Notification events have source refs, severity, dedup key, cooldown, recipient rows, and delivery rows.
- [ ] Notification center supports list, unread count, mark read, dismiss, filters, and source deep link.
- [ ] Preferences support channel toggles, trigger toggles, quiet hours, timezone, and digest frequency.
- [ ] Admin rule management supports implemented rule config and blocks unsupported future triggers.
- [ ] Worker can generate snapshots, scan inventory alert candidates, queue deliveries, retry failures, and record statuses.
- [ ] LINE push delivery sends only to linked users with enabled preferences and active permission.
- [ ] LINE alert opens web/LIFF deep link and web re-checks permission/current source state.
- [ ] Quiet hours suppress non-critical LINE delivery but keep web notification history.
- [ ] Critical/action alerts are deduplicated and cooldown-aware.
- [ ] Rule changes, preference changes, delivery retry, and critical delivery failures are audited where audit exists.
- [ ] AI behavior remains summary/source-ref preparation only; no full LINE AI chat in item 06.
- [ ] Verification commands pass or failures are documented with concrete reasons.

## 24. Test Cases

Unit/domain:

- Dedup key generation is stable for same company/trigger/source.
- Cooldown updates existing active event instead of creating duplicate event.
- Quiet hours suppresses non-critical LINE delivery and does not suppress critical delivery.
- Digest groups low-priority events by user/company/period.
- Preference resolver disables user-selected channels and trigger types.
- Recipient resolver excludes inactive memberships and users without source permission.
- Dashboard unavailable widget does not render fake zero.
- Dashboard freshness logic marks stale snapshot after configured age.

Use case:

- Generate dashboard snapshot with inventory provider succeeds.
- Generate dashboard snapshot without source provider returns unavailable widget.
- Stock low scan creates notification event and recipient/delivery rows.
- Stock low scan repeated inside cooldown does not create duplicate event.
- Replenished stock resolves active low-stock event.
- Daily summary creates one event per configured period/dedup key.
- Rule update rejects unsupported trigger enablement.
- Preference update rejects invalid quiet hour/timezone.
- Mark read only affects current user's recipient row.
- Dismiss only affects current user's recipient row.
- Delivery retry requeues failed delivery and increments attempt count safely.

Integration/API:

- Unauthenticated request gets denied.
- User from another company cannot read dashboard, notifications, rules, or delivery rows.
- User with `dashboard.read` but without inventory permission sees inventory unavailable/forbidden widget.
- User without `notification.rule.manage` cannot update rules.
- Notification list returns only addressed notifications for normal user.
- Admin/auditor delivery log view respects permission.
- Rule test endpoint is permission-protected and rate-limited.
- Cursor pagination cannot cross company boundary.
- Audit rows are written for rule change, preference change, and retry where audit exists.
- Outbox/job processing is idempotent for duplicate signal.

Worker/delivery:

- LINE delivery is skipped for unlinked user.
- LINE delivery is suppressed when user disables LINE channel.
- LINE provider failure records `failed`, error code, retry time, and safe message.
- Retry cap prevents infinite loop and preserves history.
- Worker restart can resume queued deliveries.
- Duplicate worker execution does not double-send same delivery.

Web:

- Dashboard renders loading, success, stale, partial, empty, forbidden, and error states.
- Dashboard widgets do not overlap or resize unpredictably with long metric labels.
- Notification drawer shows unread badge and recent critical/action notifications.
- Notification center filters by severity, trigger, read state, and source module.
- Mark read, mark all read, dismiss, and open source actions call correct APIs.
- Preferences page validates quiet hours and saves toggles.
- Rule management page prevents editing unsupported future triggers.
- Mobile and desktop dashboard/notification layouts remain usable.

LINE/AI:

- Unlinked LINE user receives no business-detail alert.
- Linked user with disabled LINE preference receives no LINE push.
- LINE alert contains concise source context and web deep link.
- LINE alert cannot execute final stock, money, tax, accounting, approval, or permission mutation.
- AI Gateway does not import or query dashboard/notification database directly.

## 25. Implementation Handoff

Sonnet 4.6 should start by reading:

1. `docs/plans/master-implementation-checklist.md`
2. `docs/plans/dashboard-notification-plan.md`
3. `docs/specs/dashboard-notification-spec.md`
4. `docs/specs/permission-matrix.md`
5. `docs/specs/data-model-core-spec.md`
6. `docs/specs/auth-authorization-rbac-spec.md`
7. `docs/specs/web-core-workspace-spec.md`
8. `docs/specs/inventory-mvp-spec.md`
9. `docs/specs/line-ai-channel-auth-spec.md`
10. `docs/guidelines/backend-hexagonal-code-style.md`
11. `docs/guidelines/web-frontend-code-style.md`
12. `docs/guidelines/security-implementation-guideline.md`
13. ADR 0006.

First implementation pass should follow [[plans/dashboard-notification-plan|Dashboard and Notification Plan]] Phase 0 and Phase 1, then continue phase by phase.

If Prisma/auth/audit/outbox/web shell/inventory modules already exist from items 01 through 05, reuse and extend them. If schema, permission, delivery, or route conflicts appear, stop and report the conflict before coding further.

## 26. Owner Decisions

- Daily owner summary defaults to 07:00 Asia/Bangkok. Store/configure it so company-level customization can be added later.
- LINE alert language defaults to `th-TH`.
- Email delivery is not needed in item 06. Add a backlog note for a future email-notification feature, especially for report/export and finance workflows.

These owner decisions are implementation defaults unless owner changes them before coding.
