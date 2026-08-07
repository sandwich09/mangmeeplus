# Dashboard and Notification Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 06.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 06. Dashboard and Notification
- Related specs:
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/line-ai-channel-auth-spec|LINE AI Channel/Auth Spec]]
  - [[specs/line-ai-assistant-ux-spec|LINE AI Assistant UX Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/reports-bi-spec|Reports BI Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement reusable business-health dashboard and notification primitives:

- Dashboard snapshot generation.
- Dashboard source-provider registry.
- Inventory-backed dashboard widgets.
- Notification rule registry and default rules.
- Notification event, recipient, preference, delivery, read, cooldown, and audit behavior.
- Web dashboard, notification center, preferences, and rule management.
- Worker jobs for snapshot generation, alert scanning, delivery, retry, and digest.
- LINE push delivery for linked users.
- Extension hooks for future sales, finance, tax, CRM, workflow, reports, and AI modules.

This plan should give Sonnet 4.6 enough detail to implement without reopening product, architecture, source-ownership, or LINE/AI boundary decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/web`: Next.js App Router app with `platform-foundation` feature example, CSS Modules, shared `Badge`, `Stack`, and design tokens.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/ai-gateway`: NestJS service shell.
- `packages/contracts`: shared contract package exists but currently thin.
- `packages/config`: shared config package exists but currently thin.
- No Prisma schema exists in this snapshot.
- Items 01 through 05 may add Prisma, auth, audit, outbox, request context, branch scope, web workspace shell, API client, inventory schema, inventory APIs, worker conventions, and shared contract conventions before item 06 starts.

Before implementation, inspect latest code again. Extend existing primitives. Do not duplicate tenant, auth, audit, outbox, permission, inventory, web-shell, HTTP-client, queue, or config code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/dashboard-notification-spec.md`.
3. Read `docs/specs/permission-matrix.md`.
4. Read `docs/specs/data-model-core-spec.md`.
5. Read `docs/specs/auth-authorization-rbac-spec.md`.
6. Read `docs/specs/web-core-workspace-spec.md`.
7. Read `docs/specs/inventory-mvp-spec.md`.
8. Read `docs/specs/line-ai-channel-auth-spec.md`.
9. Read backend, web, and security guidelines.
10. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
11. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 06 complete until Phase 0 through Phase 10 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 05.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and current package conventions.
- If Prisma/auth/audit/outbox already exists, extend it with additive migrations and module code.
- Do not duplicate `Company`, `User`, `CompanyMembership`, `ExternalIdentity`, `PlatformLineChannel`, `LineCompanyContext`, `AuditLog`, `OutboxEvent`, or inventory models. Treat `LineChannelBinding` as legacy/company-specific only.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Dashboard module must not import source-module Prisma repositories directly. Use source-module query ports, application services, or contracts.
- Dashboard widgets must show unavailable/forbidden/stale states instead of fake numbers.
- Notifications must always include tenant, source reference, severity, dedup key, recipient policy, and delivery audit trail.
- Delivery jobs must be idempotent and retry-safe.
- LINE delivery must use linked identities and current permissions only.
- LINE alert content must be concise and link back to web for detail/action.
- Item 06 must not implement full LINE AI chat, final actions from LINE, or arbitrary workflow automation.
- Server enforces permissions. Web permission checks are UX only.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared dashboard and notification contracts in `packages/contracts`.
- API dashboard-notification module using hexagonal folder structure.
- Prisma schema/migration/seed for dashboard and notification models if Prisma exists or is added.
- Permission keys and default role grants for dashboard/notification.
- Dashboard snapshot generation and source-provider registry.
- Inventory-backed dashboard widgets and stock alert candidates.
- Notification rule registry, system/default rules, preferences, event dedup, recipients, delivery rows, read/dismiss behavior, cooldown, digest, and retry.
- Worker jobs for scheduled snapshots, alert scans, queued deliveries, failed-delivery retry, and optional digest.
- LINE push delivery adapter that uses item 02 LINE identity/channel primitives if present.
- Web dashboard, notification center/drawer, preferences, and admin rule management.
- Audit and outbox integration where shared primitives exist.
- Tests for contracts, domain logic, use cases, API behavior, worker delivery, and web behavior where current test setup supports them.

### Out of Scope

- Advanced BI/report builder and exports.
- Full sales/revenue, receivable, payable, tax, CRM, procurement, payroll, bank, or ledger metrics before those modules exist.
- Full Reports BI item 18.
- Full LINE AI Read-Only Assistant item 07.
- AI draft suggestion layer or AI marketing.
- Workflow Automation item 16 rules/actions/dead-letter UI.
- Native mobile push.
- Email delivery, email provider config, and email preference UI. Record future email-notification backlog instead.
- WebSocket/SSE real-time notifications unless the app already has real-time infrastructure.
- Final approval, payment, accounting posting, stock mutation, tax filing, permission change, or external publishing from notifications/LINE.
- Production infrastructure provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs.
- Dashboard route: `/companies/[companyId]/dashboard`.
- Notification center route: `/companies/[companyId]/notifications`.
- Notification settings routes:
  - `/companies/[companyId]/settings/notifications`
  - `/companies/[companyId]/settings/notification-rules`
- API route base: `/v1/companies/:companyId/...` unless previous items chose a different convention.
- Company timezone default: `Asia/Bangkok`.
- Daily owner summary schedule: 07:00 Asia/Bangkok by default, with storage/config shape that allows company-level customization later.
- Dashboard snapshot freshness: fresh <= 15 minutes for operational widgets, stale after 15 minutes, unavailable when source missing.
- Low-stock rule: `balance <= reorderPoint` when reorder point is set.
- Stockout risk rule: disabled until movement trend data is available, unless item 05 already exposes enough history for a conservative days-left estimate.
- Low-stock cooldown: 12 hours per product/location dedup key.
- Daily summary cooldown: 20 hours per company/day/scope.
- Critical alerts bypass quiet hours.
- Action/insight/info LINE delivery respects quiet hours.
- Notification list page size: 25 default, cursor pagination.
- Delivery retry: 5 max attempts with capped backoff unless existing worker standard differs.
- LINE alert language default: `th-TH`.
- Email channel is not implemented in item 06. Do not add email adapter, provider config, or preference UI; record future email-notification backlog for report/export and finance workflows.
- Web notification center is source of truth for read/dismiss state. LINE delivery does not mark read.
- AI summary uses deterministic text unless item 07 or an approved AI Gateway summary endpoint already exists.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating prior work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/workers/package.json`, worker entrypoint, queue/config conventions, and any outbox consumer from item 04.
- [ ] Inspect `apps/web/app`, `apps/web/src/common`, `apps/web/src/features`, and current workspace shell/routes from item 03.
- [ ] Inspect `apps/ai-gateway` only to confirm boundaries; do not add AI chat behavior in item 06.
- [ ] Inspect `packages/contracts/src` and export style.
- [ ] Inspect `packages/config` for Redis, LINE, worker, and public API config helpers.
- [ ] Confirm whether Prisma already exists.
- [ ] Confirm whether auth/request-context/audit modules from item 02 exist.
- [ ] Confirm whether Data Model Core outbox, audit, branch, document sequence, and worker claim primitives from item 04 exist.
- [ ] Confirm whether Inventory MVP item 05 exposes product/location/balance/read query ports or APIs.
- [ ] Confirm whether LINE account-linking models and channel config exist.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current web HTTP client, layout, route, table, form, modal, toast, badge, empty/error/forbidden, and dictionary primitives.
- [ ] Confirm current test commands for root, API, web, workers, contracts, config, and any Prisma commands.
- [ ] Decide extension path:
  - extend existing Prisma/auth/audit/outbox/inventory/web shell, or
  - create missing item-06-specific pieces with clear notes.
- [ ] Record schema, route, permission, queue, LINE, or UI conflicts before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files/modules to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows how dashboard/notification will plug into auth, permissions, audit, outbox, inventory, workers, LINE binding, web shell, and shared contracts.
- No duplicate tenant/auth/audit/outbox/inventory/web-core plan remains unresolved.

## Phase 1: Contracts, Domain Models, and Pure Logic

### Goal

Create framework-free dashboard and notification contracts, domain models, and pure business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/dashboard.ts`.
- [ ] Add or extend `packages/contracts/src/notifications.ts`.
- [ ] Export contracts from `packages/contracts/src/index.ts`.
- [ ] Add API module folder:
  - `apps/api/src/modules/dashboard-notifications/domain/models`
  - `apps/api/src/modules/dashboard-notifications/domain/logic`
  - `apps/api/src/modules/dashboard-notifications/domain/ports`
  - `apps/api/src/modules/dashboard-notifications/application/use-cases`
  - `apps/api/src/modules/dashboard-notifications/application/dto`
  - `apps/api/src/modules/dashboard-notifications/infrastructure`
  - `apps/api/src/modules/dashboard-notifications/presentation/http`
- [ ] Define domain models/enums for dashboard period, widget, metric, freshness, source ref, notification rule, event, recipient, preference, delivery, alert state, channel, severity, trigger key, status, and digest policy.
- [ ] Add pure logic:
  - notification severity ordering
  - deterministic dedup key builder
  - cooldown decision
  - alert resolution decision
  - quiet-hours evaluator including overnight ranges
  - delivery channel eligibility by severity/preference
  - digest grouping
  - dashboard freshness/staleness calculation
  - unavailable widget builder
  - source permission requirement resolver
- [ ] Add domain errors with stable codes for forbidden, not found, unsupported trigger, invalid rule condition, invalid preference, invalid quiet hours, duplicate rule, duplicate event, delivery not retryable, source unavailable, and malformed cursor.

### Tests

- `packages/contracts` typecheck.
- Domain unit tests for dedup key builder.
- Domain unit tests for cooldown and repeated event behavior.
- Domain unit tests for quiet hours including overnight ranges.
- Domain unit tests for channel preference suppression.
- Domain unit tests for digest grouping.
- Domain unit tests for dashboard freshness/unavailable widgets.
- Domain unit tests for permission requirement resolver.

### Exit Criteria

- Shared contracts compile and are exported.
- Domain logic has no NestJS, Prisma, HTTP, worker, LINE SDK, Redis, queue, or browser imports.
- Core dashboard/notification rules are covered by pure tests.

## Phase 2: Prisma Schema, Migration, and Seed

### Goal

Create database records for snapshots, rules, events, recipients, preferences, deliveries, and alert state.

### Tasks

- [ ] Add Prisma to `apps/api` if still missing and previous items did not add it.
- [ ] Add or extend `apps/api/prisma/schema.prisma`.
- [ ] Reuse existing `Company`, `User`, `CompanyMembership`, `ExternalIdentity`, `PlatformLineChannel`, `LineCompanyContext`, `AuditLog`, `OutboxEvent`, and inventory models if they exist.
- [ ] Add dashboard/notification enums where needed.
- [ ] Add models:
  - `DashboardSnapshot`
  - `DashboardWidgetConfig`
  - `NotificationRule`
  - `NotificationEvent`
  - `NotificationRecipient`
  - `NotificationDelivery`
  - `NotificationPreference`
  - `AlertState`
- [ ] Reuse existing `LineDelivery` if item 02 already added it; otherwise store LINE provider metadata on `NotificationDelivery`.
- [ ] Add indexes and uniqueness constraints from the spec.
- [ ] Add migration scripts if missing.
- [ ] Add seed updates:
  - dashboard/notification permission keys
  - default role grants
  - enabled rules for `daily_owner_summary` and `stock_low`
  - disabled/unavailable system rules for future triggers
  - default preferences for demo users if demo data exists
- [ ] Add migration/seed README note if no existing Prisma docs exist.

### Tests

- Prisma validate/generate command.
- Migration applies to local/test database where current setup supports it.
- Seed is idempotent.
- Schema uniqueness checks for default rules, recipient rows, and alert-state dedup keys.

### Exit Criteria

- Schema is additive and does not duplicate shared or inventory models.
- Prisma generated client typecheck passes.
- Seed can run repeatedly without duplicate permission/rule/preference records.
- Future triggers are not enabled without source-provider support.

## Phase 3: Ports, Repositories, Queries, and Transactions

### Goal

Implement persistence adapters, dashboard queries, notification repositories, and transaction boundaries behind ports.

### Tasks

- [ ] Define ports:
  - `DashboardSnapshotRepositoryPort`
  - `DashboardWidgetConfigRepositoryPort`
  - `DashboardMetricProviderPort`
  - `NotificationRuleRepositoryPort`
  - `NotificationEventRepositoryPort`
  - `NotificationRecipientRepositoryPort`
  - `NotificationDeliveryRepositoryPort`
  - `NotificationPreferenceRepositoryPort`
  - `AlertStateRepositoryPort`
  - `NotificationTransactionPort`
  - optional `AuditPort`, `OutboxPort`, `MembershipPort`, `PermissionPort`, `LineIdentityPort`, `ClockPort`
- [ ] Implement Prisma mappers for dashboard/notification models.
- [ ] Implement Prisma repositories and read queries.
- [ ] Implement cursor pagination for notification lists.
- [ ] Implement transaction wrapper for event creation, recipient creation, delivery row creation, alert-state update, audit append, and outbox append.
- [ ] Implement row-level tenant filters for every query.
- [ ] Implement source permission filter hooks for dashboard widgets and notification recipients.
- [ ] Add query DTOs that are explicit and web-safe.

### Tests

- Repository integration tests where DB test setup exists.
- Mapper tests if persistence/domain shapes differ.
- Transaction test for event + recipient + delivery atomicity.
- Query test for notification pagination and tenant isolation.
- Query test for unread counts by severity.

### Exit Criteria

- Persistence code lives only under `infrastructure`.
- Application/domain imports only ports and domain models.
- Notification creation is atomic where database support exists.
- Cross-company reads are blocked by query design.

## Phase 4: Dashboard Snapshot and Source Providers

### Goal

Implement dashboard snapshot generation, inventory-backed widgets, and unavailable/future-source behavior.

### Tasks

- [ ] Implement dashboard snapshot generation use case.
- [ ] Implement dashboard provider registry.
- [ ] Implement core dashboard summary provider:
  - unread count
  - critical/action alert count
  - last snapshot time
  - unavailable planned module list
- [ ] Implement inventory health provider using item 05 query ports/APIs:
  - low stock count
  - stockout count
  - stockout risk count when available
  - top low-stock products
  - last stock movement time
  - deep links to inventory report/product/location pages
- [ ] Implement unavailable providers for sales, finance, tax, CRM, workflow, reports, and ledger-backed widgets.
- [ ] Implement snapshot freshness/staleness behavior.
- [ ] Implement source permission handling for dashboard widgets.
- [ ] Write audit/outbox event for manual/system snapshot generation where available.

### Tests

- Snapshot generation succeeds with inventory provider.
- Snapshot generation returns unavailable future widgets without fake values.
- User without inventory permission sees forbidden/unavailable inventory widget.
- Stale snapshot is marked stale after threshold.
- Source refs and deep links are included for inventory metrics.
- Missing inventory provider does not crash dashboard response.

### Exit Criteria

- Dashboard API can produce a company snapshot with implemented and unavailable widgets.
- Inventory metrics are source-linked and permission-aware.
- Future module widgets are safe placeholders, not fake business data.

## Phase 5: Notification Rules, Events, Preferences, and Dedup

### Goal

Implement notification rule management, event generation, recipient resolution, preferences, cooldown, digest grouping, and read/dismiss behavior.

### Tasks

- [ ] Implement default rule query/list use cases.
- [ ] Implement rule update use case for implemented triggers.
- [ ] Block enabling unsupported future triggers.
- [ ] Implement preference get/update use cases.
- [ ] Implement notification event create/update/resolve use case.
- [ ] Implement recipient resolver:
  - owner/admin recipients
  - role recipients
  - assigned/source recipients where source adapter supports them
  - permission and active membership filtering
- [ ] Implement cooldown and alert-state update.
- [ ] Implement dedup behavior for repeated events.
- [ ] Implement read one, read all, dismiss, and unread-count use cases.
- [ ] Implement delivery retry eligibility use case.
- [ ] Implement audit events for rule change, preference change, read/dismiss if required, retry, and critical delivery failure where audit exists.

### Tests

- Rule update succeeds for implemented trigger.
- Rule update rejects unsupported future trigger enablement.
- Invalid condition JSON fails validation.
- Preference update validates quiet hours/timezone/channels.
- Repeated low-stock event inside cooldown updates existing event.
- Replenished stock resolves existing low-stock event.
- Recipient resolver excludes inactive/missing-permission users.
- Mark read affects only current user.
- Dismiss affects only current user.
- Unread count groups by severity.
- Retry eligibility rejects sent/suppressed/non-retryable deliveries.

### Exit Criteria

- Notification events have source refs, recipients, delivery rows, dedup, cooldown, and preferences.
- Rule/preference mutation is permission-protected and audited where infrastructure exists.
- Future triggers cannot fire accidentally.

## Phase 6: Inventory Alert Scans and Worker Jobs

### Goal

Wire implemented alert signals into worker jobs and source events.

### Tasks

- [ ] Add worker notification module under `apps/workers` following current worker conventions.
- [ ] Add job definitions for:
  - scheduled dashboard snapshot generation
  - daily owner summary generation
  - inventory low-stock scan
  - stockout risk scan when supported
  - queued delivery processing
  - failed delivery retry
  - optional digest delivery
- [ ] If Data Model Core outbox exists, consume relevant source/outbox events idempotently.
- [ ] If outbox does not exist, implement safe scheduled scans without duplicating future outbox design.
- [ ] Ensure low-stock scan uses item 05 inventory read API/port and does not directly mutate inventory records.
- [ ] Ensure job payloads include company id, trigger key, idempotency key, and bounded metadata.
- [ ] Add retry/backoff and dead-letter notes consistent with current worker infrastructure.
- [ ] Add worker logs without secrets or oversized payloads.

### Tests

- Scheduled snapshot job creates snapshot once per idempotency key.
- Low-stock scan creates event for product/location below reorder point.
- Low-stock scan repeated inside cooldown does not duplicate delivery.
- Stock replenishment resolves active event where source data supports it.
- Duplicate job execution is idempotent.
- Worker can resume queued deliveries after restart where test setup supports it.

### Exit Criteria

- Worker can generate snapshots and inventory-backed notifications.
- Jobs are idempotent and bounded.
- Worker does not bypass API/domain permissions or source ownership.

## Phase 7: Delivery Adapters and LINE Push

### Goal

Deliver web notifications and LINE alerts through preference-aware, retry-safe adapters.

### Tasks

- [ ] Implement web delivery adapter or persistence path for notification center.
- [ ] Implement LINE delivery adapter using existing LINE config/identity/channel primitives.
- [ ] If LINE config does not exist, add config placeholders and skip LINE delivery with audited `skipped` status instead of failing whole job.
- [ ] Resolve LINE user id only through linked identity records.
- [ ] Build concise LINE message templates for:
  - daily owner summary
  - low stock
  - stockout risk if enabled
  - test notification
- [ ] Generate web/LIFF deep links using Web Core route helpers if available.
- [ ] Enforce preferences and quiet hours before channel delivery.
- [ ] Record provider message id and safe error data.
- [ ] Implement delivery retry with max attempt cap.
- [ ] Ensure native push remains out of scope.
- [ ] Do not implement email adapter, provider config, or email preference UI in item 06.
- [ ] Record future email-notification backlog for report/export and finance workflows.

### Tests

- Web delivery row becomes visible in notification center.
- LINE delivery skips unlinked user.
- LINE delivery suppresses disabled channel preference.
- Quiet hours suppress non-critical LINE delivery.
- Critical delivery bypasses quiet hours.
- Provider failure records failed status, retry time, safe error, and attempt count.
- Duplicate delivery job does not double-send same delivery.
- Deep link contains no sensitive payload and re-checks permission when opened.

### Exit Criteria

- LINE alerts can be sent to linked users when config exists.
- Missing LINE config or identity is handled as skipped/suppressed, not a crash.
- Delivery audit trail is complete and safe.

## Phase 8: HTTP API Controllers

### Goal

Expose dashboard, notification, preference, rule, and delivery behavior through permission-protected API routes.

### Tasks

- [ ] Add `DashboardNotificationsModule` to API app module.
- [ ] Add dashboard controller routes:
  - get dashboard
  - latest snapshot
  - generate snapshot
- [ ] Add notification controller routes:
  - list notifications
  - unread count
  - mark read
  - mark all read
  - dismiss
- [ ] Add preference controller routes:
  - get preferences
  - update preferences
- [ ] Add rule controller routes:
  - list rules
  - update rule
  - test rule if safe and audited
- [ ] Add delivery/admin controller routes:
  - list deliveries
  - retry delivery
- [ ] Apply `@RequirePermissions(...)` or current guard equivalents.
- [ ] Validate company id against request context.
- [ ] Validate DTOs with class-validator or current convention.
- [ ] Return stable error codes/messages.
- [ ] Add OpenAPI tags/schemas if current API docs use them.

### Tests

- Protected routes deny unauthenticated requests.
- Missing permission returns forbidden.
- Cross-company route param cannot access data.
- Dashboard route returns snapshot DTO.
- Notification list filters and paginates.
- Mark read/dismiss only affects current user's recipient row.
- Rule update requires admin permission.
- Delivery retry requires delivery retry permission.
- Invalid DTO returns validation error.

### Exit Criteria

- API surface matches spec or records any intentional route-convention differences.
- Controllers are thin and call use cases only.
- API tests cover tenant and permission boundaries.

## Phase 9: Web Dashboard, Notification Center, Preferences, and Rules

### Goal

Build item 06 user-facing web surfaces inside the workspace shell.

### Tasks

- [ ] Add or extend route files for:
  - `/companies/[companyId]/dashboard`
  - `/companies/[companyId]/notifications`
  - `/companies/[companyId]/settings/notifications`
  - `/companies/[companyId]/settings/notification-rules`
- [ ] Add `apps/web/src/features/dashboard-notification` files:
  - API client
  - constants
  - logic/helpers
  - models
  - components
  - CSS module or TailAdmin-derived styling consistent with item 03
- [ ] Build company dashboard page:
  - period control
  - inventory metrics
  - alert digest
  - unread counts
  - future module unavailable states
  - source deep links
  - stale/partial/error states
- [ ] Build notification drawer/header integration if workspace shell exposes a header slot.
- [ ] Build notification center page:
  - filters
  - list
  - unread count
  - mark read
  - mark all read
  - dismiss
  - open source
  - pagination
- [ ] Build preferences page:
  - web and LINE channel toggles
  - trigger toggles
  - quiet hours
  - timezone
  - digest frequency
- [ ] Build rule management page:
  - implemented rule list/edit
  - disabled future trigger states
  - explicit test action if API supports it
- [ ] Add loading, empty, forbidden, error, stale, and no-results states.
- [ ] Keep route files thin.
- [ ] Ensure text fits and layout works on mobile and desktop.

### Tests

- Web typecheck.
- Component/helper tests where current setup supports them.
- Dashboard renders success, partial, stale, empty, forbidden, and error states.
- Notification center filters and actions call expected API functions.
- Preferences validation covers quiet hours and channel toggles.
- Rule management blocks unsupported triggers in UI.
- Responsive smoke test manually or through browser tooling if current app can run.

### Exit Criteria

- Owner/admin can view dashboard and notification center in web.
- Users can manage own preferences.
- Admin can manage implemented notification rules.
- Future metrics/rules are represented as unavailable without fake data.
- Web UI follows existing workspace/design conventions.

## Phase 10: Verification, Documentation, and Checklist Guard

### Goal

Verify full item 06 behavior, record commands, and keep master checklist unchecked until implementation truly passes.

### Tasks

- [ ] Run package-specific typecheck/test commands for touched packages.
- [ ] Run Prisma validate/generate/migrate commands if Prisma was added or changed.
- [ ] Run worker tests or smoke path.
- [ ] Start local dev services if needed and verify key web routes.
- [ ] Verify LINE delivery skip/success path depending on local config.
- [ ] Verify no full LINE AI chat or final action path was added.
- [ ] Update implementation notes with:
  - files changed
  - migrations
  - seeds
  - env vars
  - commands run
  - test results
  - known follow-ups
- [ ] Leave Master Implementation Checklist item 06 unchecked until every exit criterion passes.

### Expected Commands

Use exact commands available in the repo after implementation. Expected baseline commands:

```text
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/workers typecheck
pnpm --filter @watchdog-bms/workers test
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/web test
pnpm typecheck
pnpm test
```

If Prisma is added or changed, also run current repo equivalents of:

```text
pnpm --filter @watchdog-bms/api prisma validate
pnpm --filter @watchdog-bms/api prisma generate
pnpm --filter @watchdog-bms/api prisma migrate dev --name dashboard_notifications
```

If web implementation needs runtime verification, start the web dev server and verify dashboard/notification routes in browser.

### Exit Criteria

- Phase 0 through Phase 10 exit criteria are complete.
- Verification commands pass or failures are documented with concrete reasons.
- Implementation summary records changed files, migrations, seeds, config, tests, and follow-ups.
- Item 06 remains unchecked until implementation and verification pass.

## Review Checklist

- [ ] Dashboard shows unavailable/stale/forbidden states instead of fake source data.
- [ ] Dashboard widgets include source module, computed time, freshness, and source refs.
- [ ] Inventory low-stock widgets use item 05 source/query ownership.
- [ ] Future sales/finance/tax/CRM/workflow/report widgets do not fire or show fake data.
- [ ] Notification events include company, trigger, severity, source refs, dedup key, and status.
- [ ] Dedup and cooldown prevent noisy duplicate alerts.
- [ ] Recipient resolution filters inactive users, missing permissions, and wrong company.
- [ ] Notification preferences and quiet hours are enforced.
- [ ] Critical alerts bypass quiet hours; non-critical LINE delivery does not.
- [ ] Web notification center remains source of truth for read/dismiss state.
- [ ] Delivery retry is idempotent and capped.
- [ ] LINE delivery uses linked identity plus shared-channel selected company context only.
- [ ] LINE messages contain no secrets or privileged payloads.
- [ ] Deep links re-check source permission and current record state.
- [ ] Rule management cannot enable unsupported future triggers.
- [ ] Rule/preference/retry mutations are audited where audit exists.
- [ ] Worker jobs are idempotent and bounded.
- [ ] AI Gateway does not import/use API Prisma client or direct dashboard/notification repositories.
- [ ] Item 06 does not implement full LINE AI chat.
- [ ] Web route files are thin.
- [ ] Web feature code separates components, API, constants, logic, models, and styles.
- [ ] Mobile and desktop layouts have no text overlap or unstable widget sizing.

## Definition of Done

- Dashboard snapshot generation, inventory-backed widgets, alert digest, and unavailable future-module states work.
- Notification rules, events, recipients, preferences, deliveries, cooldown, read/dismiss, and retry work.
- Worker jobs generate snapshots, scan low stock, queue deliveries, and process/retry LINE/web delivery.
- LINE alerts send only to linked, permitted, opted-in users and link back to web.
- Web dashboard, notification center, preferences, and rule management are usable.
- Server-side tenant and permission enforcement covers every route and worker source read.
- Audit/outbox integration is used where shared primitives exist.
- Tests cover critical business rules, tenant isolation, permission boundaries, delivery failure, and web states.
- Verification commands and results are recorded.
- Master Implementation Checklist item 06 is updated only after full implementation and verification.

## First Handoff Prompt for Sonnet 4.6

```text
Implement Master Implementation Checklist item 06: Dashboard and Notification.

Start with docs/plans/dashboard-notification-plan.md Phase 0 and Phase 1 only. Read docs/specs/dashboard-notification-spec.md, permission matrix, data model core spec, auth/RBAC spec, web core spec, inventory MVP spec, LINE channel/auth spec, backend/frontend/security guidelines, and ADR 0006 before editing.

Inspect current repo state first. If Prisma/auth/audit/outbox/web shell/inventory modules already exist, extend them. Do not duplicate shared primitives. Item 06 should implement reusable dashboard/notification primitives, inventory-backed widgets/alerts, web notification center, preferences/rules, worker delivery, and LINE push delivery. Do not implement full LINE AI chat or final actions from LINE. Keep item 06 unchecked until all phases and verification pass.
```

## Risks

- Items 01 through 05 may introduce different schema, auth, request context, inventory, worker, or UI conventions. Mitigation: Phase 0 reconciliation before edits.
- Dashboard may accidentally show fake zero values for missing future modules. Mitigation: explicit unavailable widgets and tests.
- Notification scans can spam users. Mitigation: deterministic dedup keys, cooldown, digest, preference tests, and quiet hours.
- Delivery jobs can double-send after retry/restart. Mitigation: delivery row status transitions and idempotency keys.
- LINE delivery can leak data to wrong user if linked identity is not verified. Mitigation: resolve recipients through internal user id and linked identity only.
- Source permission can change after delivery. Mitigation: deep links re-check current permission and source state.
- Dashboard module can couple to inventory Prisma directly. Mitigation: use source query ports/APIs and review imports.
- AI chat scope can creep into item 06. Mitigation: deterministic summaries only and explicit blocked tests.
- Rule JSON can become hard to migrate. Mitigation: typed condition validation and trigger-specific schema version field if needed.
- Worker dependency on outbox may block item 06 if outbox is absent. Mitigation: scheduled scan fallback with clear notes.

## Backlog After Item 06

- WebSocket/SSE real-time notification updates.
- User-customizable dashboard layout.
- Future email-notification feature for report/export and finance delivery.
- Native mobile push.
- Advanced digest templates.
- Workflow Automation item 16 rule/action integration.
- LINE AI follow-up prompts and read tools in item 07.
- Sales, finance, tax, CRM, procurement, payroll, bank, and ledger dashboard providers as source modules ship.
- Reports BI item 18 advanced charts, exports, and historical analytics.
