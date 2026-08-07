# CRM Sales MVP Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 15.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

Owner update 2026-07-12: the production customer-management slice under [[agent-memory/customer-management-identity-linking|Customer Management and Identity Linking]] is implemented and locally accepted. Create/edit, duplicate confirmation, typed provenance, identity re-point/full merge, same-company lineage, no-tools AI preview, role projection, PDPA/race hardening, and durable delivery passed full package tests, builds, all 53 migrations from empty PostgreSQL, and authenticated browser smoke. Item 15 stays unchecked only because this plan's wider import/export and complete CRM workflow gates remain separate.

## Linked Specs

- Spec: [[specs/crm-sales-spec|CRM and Sales Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 15. CRM and Sales MVP
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]
  - [[adr/0008-line-ai-access-and-auth|ADR 0008 LINE AI Access and Auth]]

## Purpose

Implement the first CRM and sales slice for WatchDog-BMS:

- Customer and contact master records linked safely to accounting counterparties.
- Lead intake, assignment, qualification, conversion, and disqualification.
- Opportunity pipeline with default stages and company-configurable stage settings.
- Follow-up tasks and append-only sales activity timeline.
- Quotation draft link from CRM opportunity to Accounting Documents item 08.
- CRM dashboard/notification source hooks.
- Read-only LINE/AI Sales and CRM answers with source refs and web deep links.
- One production Customer Directory at `/companies/:companyId/customers`, with permission-gated create/edit/archive/assign, duplicate reuse/link, masked LINE identity, and Owner/Admin soft merge.

This plan should give Sonnet 4.6 enough detail to implement without reopening CRM/accounting ownership, security, AI mutation, or web UX decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through prior items.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.

Before implementation, inspect latest code again because items 01 through 14 may add Prisma, auth, request context, company/branch/team primitives, audit, outbox, document sequences, accounting counterparty/document APIs, dashboard providers, notification delivery, LINE binding, worker queues, web shell routes, API client helpers, and AI tool registration.

Extend existing primitives. Do not duplicate tenant, branch, team, membership, permission, audit, outbox, document sequence, accounting document, dashboard, notification, LINE, AI Gateway, web shell, config, or contract code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/crm-sales-spec.md`.
3. Read `docs/specs/accounting-documents-spec.md`.
4. Read `docs/specs/permission-matrix.md`.
5. Read `docs/specs/data-model-core-spec.md`.
6. Read `docs/specs/auth-authorization-rbac-spec.md`.
7. Read `docs/specs/web-core-workspace-spec.md`.
8. Read `docs/specs/dashboard-notification-spec.md`.
9. Read `docs/specs/line-ai-read-only-assistant-spec.md`.
10. Read `docs/specs/ai-gateway-agents-spec.md`.
11. Read `docs/guidelines/backend-hexagonal-code-style.md`.
12. Read `docs/guidelines/web-frontend-code-style.md`.
13. Read `docs/guidelines/security-implementation-guideline.md`.
14. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
15. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 15 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Core Rule

Web/API owns CRM mutations. LINE and AI are read-only. Accounting Documents item 08 owns official quotation lifecycle.

CRM can create/link quotation drafts through accounting boundaries, but CRM must not issue, approve, void, convert, or mutate accounting documents directly.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 14.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox/document sequences/accounting APIs already exist, extend them with additive migrations and module code.
- Do not duplicate `Company`, `Branch`, `Team`, `CompanyMembership`, `AccountingCounterparty`, `AccountingDocument`, `DocumentSequence`, `AuditLog`, `OutboxEvent`, request context, dashboard provider, notification channel, LINE binding, or AI tool modules.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money handling for opportunity estimates. Do not calculate money with JavaScript floating-point math.
- Store `THB` as MVP default currency. Keep currency field explicit for later multi-currency support.
- Enforce tenant, permission, team/branch/ownership ABAC, and record policy on the server.
- Web permission checks are UX only.
- No hard deletes from user routes.
- Activity entries are append-only.
- Lead conversion, import commit, follow-up complete-with-next-task, customer merge, and quotation draft link must be transactional and idempotent where retry can happen.
- Customer merge must not mutate issued accounting document snapshots.
- Quotation draft creation requires `crm.quotation.link` plus `accounting.quotation.create`.
- Quotation issue, approval, void, and conversion stay in Accounting Documents item 08.
- Emit audit/outbox events using existing primitives where present.
- Export customer data only with explicit permission, audit, and CSV injection protection.
- LINE and AI must call permission-checked APIs/tools only. They must not import API Prisma client or CRM repositories.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared CRM contracts in `packages/contracts`.
- CRM permission keys and default role grant alignment.
- Prisma schema/migration/seed for CRM models if Prisma exists or is added.
- API CRM module using hexagonal folder structure.
- Customer/contact CRUD, archive, assignment, duplicate detection, customer CSV import/export, and merge.
- Canonical customer identity (`CrmCustomer.id`), deterministic LINE identity reuse, human-confirmed normalized-phone candidates, Owner/Admin identity re-point/full merge, and origin/actor separation.
- Lead CRUD, assignment, conversion, and disqualification.
- Opportunity CRUD, pipeline board/table read model, stage move, won/lost close, and reopen.
- Follow-up task create/update/complete/snooze/cancel.
- Append-only sales activity timeline.
- Quotation draft link to Accounting Documents item 08.
- Dashboard/notification source hooks for follow-up due, overdue follow-up, stuck opportunity, unassigned lead, and pipeline summary.
- Read-only AI/LINE Sales and CRM tools or read APIs where current AI Gateway integration points exist.
- Web CRM feature folder with overview, customers, leads, pipeline, follow-ups, settings, import, and merge workflows.
- Tests for contracts, domain logic, use cases, API behavior, permissions, outbox/audit payloads, AI read scope, and UI behavior where current test setup supports them.

### Out of Scope

- Full call-center, telephony, recording, or omnichannel inbox.
- Automated marketplace, LINE, Facebook, or web-form lead ingestion. Source enums exist for later.
- Lead CSV import is not required in first pass; manual lead create plus customer CSV import is MVP.
- Marketing campaign execution. Item 19 owns it.
- Marketplace order import automation. Item 20 owns it.
- Advanced territory, commission, incentive, quota, and forecasting engines.
- Visit route planning, map scheduling, or field sales check-in.
- Customer portal and public CRM API.
- Accounting quotation issue/approval/void/conversion, invoice, receipt, payment, tax invoice, ledger, and tax report ownership.
- Autonomous AI outreach or AI CRM/accounting mutation.
- Production infrastructure provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 15 starts.
- Currency: `THB`.
- Default owner: creating user.
- Unassigned lead queue: allowed.
- Default customer status: `ACTIVE`.
- Canonical customer route: `/companies/:companyId/customers`; any older `/crm` customer tab links there instead of duplicating CRUD.
- Customer form: required name; optional phone, tier, and notes; create-only staff origin `MANUAL|WALK_IN|PHONE|WEB|OTHER`.
- LINE provider identity and internal customer id are read-only. Exact verified LINE identity reuses; normalized phone requires human confirmation; name-only never auto-links or auto-merges.
- Origin is acquisition channel, never `AI`. `createdByType` is `USER|SYSTEM|AI_ASSISTED` alongside `createdByUserId`; AI-assisted intake is preview-only until staff confirms the normal create API.
- Customer row/field policy: Owner/Admin all-company operational projection; Sales own/assigned operational projection; Manager explicitly assigned customers only; Auditor all-company full authorized read; Finance/Accountant accounting/contact allowlists without notes or LINE identity; Marketing random-reference pseudonymous segment/consent/origin/tier only, without canonical id/PII/contact/identity. Mixed roles resolve projection per row and use a discriminated server DTO, never a scope/field cross-product.
- Default lead status: `NEW`.
- Default opportunity status: `OPEN`.
- Default pipeline stages:
  - `New lead` -> `NEW_LEAD`
  - `Contacted` -> `CONTACTED`
  - `Qualified` -> `QUALIFIED`
  - `Quotation sent` -> `QUOTATION`
  - `Negotiation` -> `NEGOTIATION`
  - `Won` -> `WON`
  - `Lost` -> `LOST`
- Stage settings are company-scoped. Seed/lazy-create defaults for each company.
- `LOST` close requires reason.
- `WON` close should link quotation or require manual win reason.
- Reopen terminal opportunity requires manager/admin permission and reason.
- Customer CSV import preview/commit is in MVP. Lead CSV import and automated external ingestion are deferred.
- Customer export supports CSV and JSON if current export helpers exist; CSV only is acceptable for first pass if documented.
- Duplicate exact tax id/external id is high confidence; exact phone/email is medium/high; fuzzy normalized name is warning only.
- Contact consent default: `UNKNOWN`.
- Quotation behavior: CRM creates or reuses one active accounting quotation draft/link per opportunity; issue/approval happens in accounting. Multiple quotes require prior link `VOIDED`/`REJECTED` or explicit revision/new quote reason.
- LINE/AI behavior: read-only answers with source refs and web deep links.
- Merge behavior: soft merge with `MERGED` status/alias record; no hard delete.
- Full merge default: Owner/Admin with `crm.customer.merge`, preview + primary/secondary + reason; re-point actual CRM/LINE/booking relations in one transaction and make same-pair retry safe from stored merge state.
- Dashboard/notification behavior: if delivery primitives exist, wire CRM providers; otherwise add disabled future hooks/read providers.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/web/package.json`, `apps/web/app`, `apps/web/src/common`, and `apps/web/src/features`.
- [ ] Inspect `apps/workers/src` for outbox/notification worker conventions.
- [ ] Inspect `apps/ai-gateway/src` for AI tool registration and permission-read patterns.
- [ ] Inspect `packages/contracts/src` and current export pattern.
- [ ] Inspect `packages/config/src` for feature flag/env patterns.
- [ ] Identify existing request context, auth guard, permission decorator, audit, outbox, document sequence, branch/team, notification, and storage primitives.
- [ ] Identify Accounting Documents item 08 APIs/models for `AccountingCounterparty`, quotation draft create, quotation status read, and quotation route deep links.
- [ ] Identify current dashboard provider/notification event pattern from item 06.
- [ ] Identify current LINE read-only answer/deep-link pattern from item 07.
- [ ] Identify current web route naming, navigation, API client, form, table, board, modal/drawer, loading, and error primitives.
- [ ] Identify current test commands for root, API, web, workers, contracts, config, Prisma, and e2e if present.
- [ ] Record any schema, route, package, permission, or UI conflicts before coding.

### Tests

- No production code required.
- Run only lightweight existing checks if needed to confirm baseline.

### Exit Criteria

- Implementation summary states which existing primitives will be reused.
- No duplicate shared module is planned.
- Exact first source paths for contracts, API module, web feature, AI hooks, and tests are known.
- Phase 1 can start without product ownership questions.

## Phase 1: Contracts, Permissions, and Domain Logic

### Goal

Define stable CRM contracts, permission keys, and pure business rules before persistence/API code.

### Tasks

- [ ] Add CRM enums and DTO types in `packages/contracts` or current contract location:
  - customer status/type/source
  - customer `originSource`, `createdByType`, and `createdByUserId`
  - lead status/source
  - pipeline canonical groups
  - opportunity status
  - activity type/outcome
  - follow-up status/priority/channel
  - consent status
  - quotation link status
- [ ] Add contracts for customer list/detail/search/create/update/archive/assign/export, duplicate warnings/override, masked channel identity, Owner/Admin identity re-point, merge preview/commit, and role-safe field projections that do not require clients to discard forbidden fields.
- [ ] Add contracts for contact list/create/update/archive.
- [ ] Add contracts for lead list/create/update/assign/convert/disqualify.
- [ ] Add contracts for pipeline stage list/update.
- [ ] Add contracts for opportunity list/detail/board/create/update/stage move/close/reopen.
- [ ] Add contracts for activity append/list.
- [ ] Add contracts for follow-up create/update/complete/snooze/cancel/list.
- [ ] Add contracts for customer import preview/commit, duplicate preview/merge, quotation link, dashboard summary, and AI read tools.
- [ ] Add CRM permission keys in current permission source of truth.
- [ ] Align default grants with [[specs/crm-sales-spec|CRM and Sales Spec]] section 13 and [[specs/permission-matrix|Permission Matrix]].
- [ ] Implement pure domain logic for:
  - phone/email/tax id normalization
  - duplicate scoring
  - exact LINE identity reuse and normalized-phone candidate policy; name-only never auto-merges
  - staff-safe origin validation and origin/actor separation
  - pipeline stage validation
  - opportunity stage move/close/reopen rules
  - follow-up transition rules
  - lead conversion decision result
  - AI follow-up priority scoring
  - CSV export cell sanitization
- [ ] Add contract/domain unit tests.

### Tests

- Contract typecheck/build.
- Unit tests for normalization, duplicate scoring, pipeline validation, opportunity close rules, follow-up transitions, AI priority ranking, and export sanitization.

### Exit Criteria

- Shared CRM contracts compile.
- Permission keys are defined and documented.
- Pure domain logic passes tests without database dependencies.
- Later phases can implement persistence/API against stable contracts.

## Phase 2: Persistence and Migrations

### Goal

Add CRM persistence models and repositories while preserving tenant, audit, and accounting integration boundaries.

### Tasks

- [ ] Add additive Prisma schema/migration for CRM models from spec section 11:
  - `CrmCustomer`
  - `CrmContactPerson`
  - `CrmLead`
  - `CrmPipelineStage`
  - `CrmOpportunity`
  - `CrmActivity`
  - `CrmFollowUpTask`
  - `CrmQuotationLink`
  - `CrmCustomerSegment`
  - `CrmCustomerSegmentMember`
  - `CrmDuplicateCandidate`
  - `CrmCustomerMerge`
  - `CrmImportJob`
- [ ] Add indexes/unique constraints for company, owner, status, stage, due date, normalized fields, and accounting document links.
- [ ] Add/verify same-company customer foreign-key integrity for `CrmChannelIdentity` and race-safe first-contact creation so concurrent LINE/LIFF events leave no orphan customer.
- [ ] Migration repairs each legacy orphan/cross-company identity to its own deterministic provisional LINE customer and re-points its conversations before validating the composite FK; never deduplicate by name during repair.
- [ ] Add canonical typed `originSource` + `createdByType` alongside existing `createdByUserId`, backfill existing LINE/manual rows deterministically, and retain legacy free-string `source` only as deprecated compatibility (never as matching/policy authority).
- [ ] Add seed/lazy-create default pipeline stages per company.
- [ ] Add repository ports and Prisma implementations for customers, contacts, leads, opportunities, activities, follow-ups, stages, segments, duplicates, imports, merges, and quotation links.
- [ ] Add transaction helpers for lead conversion, follow-up completion, LINE identity creation/link, full customer merge, import commit, and quotation link creation using current transaction pattern.
- [ ] Add accounting adapter port for counterparty lookup/link and quotation draft create/status read.
- [ ] Add dashboard/notification adapter ports without final delivery assumptions.
- [ ] Add audit/outbox adapter ports using current shared primitives.
- [ ] Add migration tests or repository integration tests where current setup supports them.
- [ ] Deploy the customer-identity migration in a short CRM write window. Prisma 7 wraps it in a transaction, so regular tracked indexes are protected by a 5-second fail-fast `lock_timeout`; composite tenant/coherence FKs use `NOT VALID` then `VALIDATE`, and historical mismatches stop deployment for manual remediation.

### Tests

- Prisma generate/migrate validation command discovered in Phase 0.
- Repository tests for create/list/update with tenant scope.
- Seed/default stage tests.
- Unique/index constraint tests where current DB test setup supports them.

### Exit Criteria

- CRM schema is additive and migrates cleanly.
- Default stages exist for a company.
- Repository methods enforce company scope.
- No issued accounting document snapshot mutation path exists.

## Phase 3: Customer, Contact, Lead, Import, and Merge API

### Goal

Expose customer/contact/lead workflows through permission-checked API use cases and controllers.

### Tasks

- [ ] Register `CrmModule` in API app using current module conventions.
- [ ] Add use cases for customer list/search/detail/create/update/archive/assign/export; create/update both run duplicate checks and require an explicit override/selection when a normalized-phone candidate exists.
- [ ] Add use cases for contact list/create/update/archive.
- [ ] Add use cases for lead list/create/update/assign/convert/disqualify.
- [ ] Add use cases for CSV import preview/commit for customers. Keep lead import optional/backlog unless owner expands scope.
- [ ] Add masked LINE-identity read plus Owner/Admin identity re-point under `crm.customer.merge`; reject update-only/Sales callers, raw-id edits, and cross-company/inactive/merged targets.
- [ ] Add use cases for duplicate list, merge preview, and idempotent merge commit. Commit requires Owner/Admin `crm.customer.merge`, primary/secondary/reason, atomically re-points channel identities/conversations/bookings/contacts/opportunities/activities/follow-ups/quotation links/lead `convertedCustomerId`, and marks secondary `MERGED`; reverse remains optional only where invariants allow it.
- [ ] Add DTO validation using current class-validator or repo DTO pattern.
- [ ] Enforce tenant, role permission, customer row scope, field projection, ownership/team ABAC for non-customer records, status transitions, duplicate warnings, idempotency, and optimistic version checks where repo supports them.
- [ ] Project customer list/detail/search/duplicate/AI responses server-side: operational Owner/Admin/Sales; explicit-assignment-only Manager; full authorized read Auditor; accounting/contact allowlist Finance/Accountant with no notes/LINE identity; purpose-scoped pseudonymous Marketing with no canonical id/PII/contact/identity.
- [ ] Write audit/outbox events for sensitive actions.
- [ ] Add API controllers and route tests.
- [ ] Add API response examples/OpenAPI annotations if current API does so.

### Tests

- API integration tests for customer create/update/archive/assign/export, duplicate-confirmation enforcement, masked identity read/re-point security, and exact identity reuse under concurrent first contact.
- API integration tests for contact create/update/archive.
- API integration tests for lead create/assign/convert/disqualify.
- Customer import preview/commit tests for valid, invalid, duplicate, and CSV-injection rows.
- Merge preview/commit tests covering every re-pointed relation, tenant/permission/idempotency failures, secondary `MERGED`, and accounting snapshot preservation.
- Permission/projection tests for Sales own/assigned operational fields, Manager assigned-only customers, Owner/Admin all-company operational fields, Auditor all-company full read, Finance/Accountant accounting-contact allowlists, and Marketing pseudonymous allowlist.

### Exit Criteria

- Customer/contact/lead MVP works through API.
- Import/export and duplicate merge are permission-gated and audited.
- Lead conversion is idempotent and does not create duplicates on retry.
- Unauthorized records are not leaked.

## Phase 4: Opportunity, Pipeline, Follow-Up, and Activity API

### Goal

Implement sales pipeline, follow-up, and activity workflows through API.

### Tasks

- [ ] Add use cases for pipeline stage list/update with validation.
- [ ] Add use cases for opportunity list/detail/board/create/update/stage move/close/reopen.
- [ ] Add use cases for activity list/append.
- [ ] Add use cases for follow-up list/create/update/complete/snooze/cancel.
- [ ] Ensure stage moves append activity entries.
- [ ] Ensure follow-up completion can append activity and create next follow-up transactionally.
- [ ] Ensure overdue calculations use company/user timezone from current context.
- [ ] Emit outbox events for opportunity and follow-up lifecycle.
- [ ] Add read models for board columns, follow-up agenda, and customer/opportunity timeline.
- [ ] Add API route/controller tests.

### Tests

- Unit/API tests for pipeline stage config validation.
- API tests for opportunity create, stage move, close won/lost, reopen, and archive.
- API tests for follow-up create, complete with activity, snooze, cancel, and overdue list.
- API tests for append-only activity and corrected activity behavior if implemented.
- Permission tests for own/team/all scopes.
- Outbox/audit payload tests.

### Exit Criteria

- Sales pipeline and follow-up APIs satisfy MVP workflows.
- Stage/status invariants cannot be bypassed.
- Activity timeline is append-only.
- Board/table/agenda read models are ready for web.

## Phase 5: Quotation, Dashboard, and Notification Integration

### Goal

Connect CRM to accounting quotation drafts and operational alert/read providers.

### Tasks

- [ ] Implement accounting adapter for quotation draft create using item 08 boundary.
- [ ] Implement accounting adapter for quotation status summary read.
- [ ] Add use case `CreateOpportunityQuotationDraft`.
- [ ] Add use case `ListOpportunityQuotationLinks`.
- [ ] Enforce one active quotation draft/link per opportunity by default.
- [ ] Allow a new quote only when prior link is `VOIDED`/`REJECTED` or user provides explicit revision/new quote reason.
- [ ] Add use case or worker repair for quote link recovery if accounting draft succeeds and CRM link write fails.
- [ ] Persist `CrmQuotationLink` with accounting document id/status summary.
- [ ] Ensure CRM quote draft action requires `crm.quotation.link` plus `accounting.quotation.create`.
- [ ] Ensure issue/approve/void/convert actions deep-link to accounting, not CRM mutation.
- [ ] Add dashboard source providers for pipeline value/count, follow-up due/overdue, stuck opportunities, unassigned leads, and activity count.
- [ ] Add notification source events/rules for `follow_up_due`, `opportunity_stuck`, and `lead_unassigned` where current notification system supports them.
- [ ] If notification/dashboard delivery primitives are absent, register disabled future hooks/read providers and document gap.

### Tests

- API integration tests for quotation draft link success, active-link reuse, explicit revision reason, idempotent retry, duplicate link handling, permission denial, and accounting adapter failure.
- Contract tests for quote status summary redaction.
- Dashboard provider tests for scoped sales data.
- Notification payload tests for follow-up due, stuck opportunity, and unassigned lead.

### Exit Criteria

- CRM can create/link accounting quotation drafts without owning final quotation lifecycle.
- Dashboard/notification hooks are wired or safely disabled behind current future-hook pattern.
- Accounting permission boundary is enforced.

## Phase 6: Web CRM Workspace

### Goal

Build usable CRM web workflows as the primary mutation surface.

### Tasks

- [x] Add web route/navigation entry for CRM following current web shell pattern.
- [x] Add CRM API client/hooks/types using shared contracts.
- [ ] Build CRM overview with pipeline, follow-up, lead, and customer summaries.
- [x] Make `/companies/:companyId/customers` the sole customer directory and remove/redirect the old `/crm` customer CRUD tab to it.
- [x] Build customers table with search, filters, masked LINE-link status, create/edit/archive/assign actions, and independent permission-disabled states.
- [x] Render only the server-projected customer fields for the caller; Finance/Accountant UI must have no notes/LINE-identity affordance and Marketing must not receive or render canonical customer id, PII, contacts, or identity data.
- [x] Build the first-pass form for required name, optional phone/tier/notes, and create-only staff-safe origin. Internal id, normalized values, verified LINE identity, `createdByType`, and `createdByUserId` remain read-only.
- [x] Build duplicate candidate UI: exact normalized phone requires explicit reuse/link-or-continue confirmation; name-only warning never auto-selects; Owner/Admin merge preview shows affected relation counts and requires reason.
- [x] Add AI intake entry only when the user has both `crm.ai.assist` + `crm.customer.create`: `POST /crm/customers/ai-profile-extract` with `{text,locale?}` -> bounded name/phone/email/notes suggestion (`ok|uncertain|unavailable`) -> normal form -> staff confirm. No auto-save/re-point/merge action exists.
- [x] Build customer detail with profile, contacts, segments, consent, follow-ups, opportunities, quotation links, and activity timeline.
- [ ] Build lead inbox/table with create/edit/assign/convert/disqualify actions.
- [ ] Build pipeline board and table fallback with stage move and close actions.
- [ ] Build opportunity detail with follow-ups, activities, quotation draft link, quote status, close/reopen actions, and accounting deep link.
- [ ] Build follow-up agenda with due today, overdue, upcoming, complete, snooze, cancel, and next-task flow.
- [ ] Build customer import preview/commit UI. Keep lead import UI out of first pass unless owner expands scope.
- [ ] Build duplicate merge queue/preview/commit UI for Admin.
- [ ] Build CRM settings for pipeline stages and segments where permission allows.
- [x] Add loading skeleton, empty/permission-aware CTA, load error + retry, validation/duplicate states, save/link/merge pending states preventing double submit, mutation error + retry, and success refresh without stale rows.
- [ ] Verify responsive layouts for mobile and desktop. Text must not overlap or overflow.
- [x] Add UI tests where current setup supports them.

### Tests

- Web typecheck/build.
- Component tests for customer form, lead conversion, pipeline stage move, follow-up complete, quotation link action, import preview, and merge preview where setup supports them.
- API/Gateway tests for both-permission denial, request bounds, output bounds, uncertainty/provider-down behavior, empty tool allowlist, and proof that profile extraction never calls a persistence/tool path.
- Playwright/e2e smoke if current repo has e2e setup:
  - Sales creates customer, opportunity, follow-up, and quote draft link.
  - Manager views team pipeline.
  - Admin merges duplicate.
  - Sales previews AI-parsed customer fields, confirms through normal create, and handles phone candidates; Sales cannot re-point LINE identity. Owner/Admin can re-point/merge without raw-id editing.
  - Unauthorized role sees disabled/hidden actions.
- Visual/responsive check for CRM overview, customer detail, pipeline, and follow-up agenda.

### Exit Criteria

- Web CRM workspace is usable without landing page detours.
- Sales can complete core customer -> opportunity -> follow-up -> quotation draft workflow.
- Admin/Manager workflows are present and permission-aware.
- Mobile/desktop UI has no incoherent overlap.

## Phase 7: Read-Only AI and LINE Hooks

### Goal

Expose permission-scoped CRM answers to AI Gateway and LINE without mutation.

### Tasks

- [ ] Add read-only API/tools for:
  - follow-up priorities
  - customer summary
  - opportunity summary
  - pipeline summary
  - stuck opportunity summary
- [ ] Ensure tools call API/use cases, not repositories/Prisma.
- [ ] Include source refs and web deep links in responses.
- [ ] Reuse the canonical customer role projections for AI/LINE reads: Manager customer context remains assigned-only; Finance/Accountant exclude notes/LINE identity; Marketing receives pseudonymous segment/consent/origin/tier only.
- [ ] Add module-not-enabled or permission refusal responses matching LINE read-only assistant behavior.
- [ ] Wire AI Gateway Sales/CRM agent tool registration if current AI Gateway has tool registry.
- [ ] Wire LINE command/intent handlers if current LINE integration exists.
- [ ] If LINE/AI integration is not implemented yet, expose CRM read APIs and document integration points.

### Tests

- API tests for AI read endpoints with Sales own scope, Manager assigned customer scope, Finance/Accountant allowlists, Marketing pseudonymous projection, Auditor full read, and unauthorized role.
- AI tool tests for source refs, deep links, redaction, and refusal behavior where setup supports them.
- LINE/AI mutation attempts rejected with web-link guidance.

### Exit Criteria

- AI/LINE can answer scoped CRM questions or has documented integration-ready read APIs.
- AI/LINE cannot mutate CRM/accounting records.
- Source refs and permission redaction pass tests.

## Phase 8: Security, Reliability, and Performance Hardening

### Goal

Close security, data integrity, privacy, and operational gaps before checklist closeout.

### Tasks

- [ ] Review every controller/use case for tenant, permission, ABAC, and status checks.
- [x] Add tests for cross-company access denial.
- [x] Add tests for Sales own/assigned restrictions and Manager explicit-assignment-only customer scope, including denial when only team ABAC matches.
- [x] Add exact-key projection tests for Finance/Accountant redaction, Marketing pseudonymization/no-PII, Auditor full read/no mutation, and universal raw-provider/system-field omission.
- [x] Confirm no user route hard-deletes CRM records.
- [x] Confirm no CRM path mutates issued accounting document snapshots.
- [ ] Confirm idempotency for lead conversion, import commit, follow-up complete-with-next-task, merge, and quotation link.
- [x] Confirm audit/outbox payloads are bounded and do not leak raw import/private finance data.
- [ ] Confirm CSV import/export sanitizes formula-like values and handles malformed encodings safely.
- [ ] Confirm customer/contact consent rules affect AI outreach suggestions.
- [ ] Add pagination, search indexes, and query limits for customer, lead, opportunity, activity, and follow-up lists.
- [ ] Add rate/size limits for import preview/commit following current API pattern.
- [ ] Add observability logs/metrics where current repo pattern exists.
- [ ] Run security guideline checklist for new code.

### Tests

- Permission and ABAC integration tests.
- Import/export security tests.
- Idempotency tests.
- Query limit/pagination tests.
- Audit/outbox bounded payload tests.
- Typecheck/lint/test commands discovered in Phase 0.

### Exit Criteria

- CRM module is deny-by-default and permission-scoped.
- Sensitive actions are audited.
- Import/export and AI read surfaces are privacy-safe.
- Performance risks for MVP list/search endpoints are addressed with indexes and limits.

## Phase 9: Verification, Docs, and Checklist Gate

### Goal

Verify implementation, update docs, and only then close Master Implementation Checklist item 15.

### Tasks

- [x] Run relevant root/package commands discovered in Phase 0.
- [x] Run contracts build/typecheck/tests.
- [x] Run API tests.
- [x] Run web typecheck/build/tests.
- [x] Run worker/AI tests if touched.
- [x] Run Prisma generate/migrate validation if Prisma is present.
- [x] Run e2e/Playwright smoke if current repo has setup.
- [x] Record focused create/update duplicate-candidate, LINE identity reuse/link, merge re-point, permission, tenant, audit/outbox, and `/customers` browser evidence.
- [x] Confirm `originSource`/`createdByType` schema/contracts/backfill are canonical and tested. A deprecated `source` compatibility field may remain, but new UI/API policy must not depend on it.
- [x] Record exact verification commands and results in implementation notes or PR.
- [x] Update `docs/specs/permission-matrix.md` if implementation source of truth differs from this plan/spec.
- [ ] Update API docs/OpenAPI snapshots if current repo tracks them.
- [x] Update feature docs/navigation docs if current repo tracks them.
- [ ] Update [[plans/master-implementation-checklist|Master Implementation Checklist]] item 15 only after all phase exit criteria pass.

### Tests

- Full available verification suite for touched packages.
- Manual smoke through web CRM workflow if automated e2e is absent.

### Exit Criteria

- Customer/lead/opportunity/follow-up/quotation-link workflow works from API and web.
- LINE/AI read-only CRM answers are scoped and source-backed, or read APIs are integration-ready with documented blockers.
- Verification commands are recorded.
- No unresolved blocker remains for checklist item 15.

## Risks

- Accounting Documents item 08 may expose different quotation API names. Mitigation: build accounting adapter port in Phase 2 and reconcile exact boundary in Phase 0.
- Team/branch ABAC primitives may not exist. Customer policy is independent of that risk: Manager Customer Directory access remains explicit-assignment-only. Other CRM records may fall back to owner/assignment scope; never grant company-wide manager read implicitly.
- Dashboard/notification/LINE/AI modules may not be implemented or may differ from spec. Mitigation: add CRM read providers/events and disabled future hooks instead of inventing duplicate delivery.
- Duplicate merge can damage history if implemented as hard mutation. Mitigation: soft merge/alias only; never mutate issued accounting snapshots.
- Import/export can leak or corrupt data. Mitigation: strict mapping preview, audit, size limits, permission checks, and CSV injection protection.
- Pipeline drag/drop can create brittle UI. Mitigation: table fallback and explicit stage move action are acceptable.

## Resolved Owner Decisions

- Web/API is CRM mutation surface.
- `/companies/:companyId/customers` is the sole customer CRUD directory; Customer 360 is detail/history and `/crm` links to the directory.
- LINE provider ids are system-owned. Exact identity reuse is deterministic; phone is a human-confirmed candidate; name-only never auto-matches.
- LINE and AI are read-only for item 15 except deterministic item-15A ingestion through source APIs. AI-assisted staff intake is parse/preview only and cannot save/link/merge.
- `originSource` is distinct from `createdByType`/`createdByUserId`; `AI` is not an origin.
- Identity re-point is a high-risk partial merge and requires Owner/Admin `crm.customer.merge`, the same as full merge. Both are audited and tenant-scoped; full merge re-points actual customer references without rewriting issued accounting snapshots.
- Accounting Documents item 08 owns official quotation lifecycle.
- CRM customer edits/merge do not rewrite issued accounting document snapshots.
- Customer CSV import preview/commit is included. Lead CSV import and automated marketplace/LINE/Facebook ingestion are deferred.
- Default pipeline stages are included and company-configurable.
- Sales default visibility is own/assigned. Manager Customer Directory visibility is always explicit-assignment-only; team ABAC may scope other CRM record types but never broadens customer rows.
- Customer projection is least-privilege and server-enforced: Owner/Admin all-company operational; Sales own/assigned operational; Manager assigned-only; Auditor all-company full authorized read; Finance/Accountant accounting/contact allowlists without notes/LINE identity; Marketing pseudonymous segment/consent/origin/tier without canonical id, PII, contacts, or identity.
- Opportunity quotation behavior defaults to one active quote draft/link. Multiple quotes require prior `VOIDED`/`REJECTED` link or explicit revision/new quote reason.

## Open Questions

- Exact Accounting Documents quotation create/status API names must be reconciled in Phase 0.
- Exact web route pattern and navigation slot must be reconciled in Phase 0.
- Exact AI Gateway tool registry shape must be reconciled in Phase 0.
