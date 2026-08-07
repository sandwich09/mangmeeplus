# Fixed Assets Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 21.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/fixed-assets-spec|Fixed Assets Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 21. Fixed Assets
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/reports-bi-spec|Reports BI Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement fixed assets as the finance/accounting module that owns asset register, capitalization, depreciation schedule, transfer/custody history, disposal/write-off, and source posting inputs.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs/code snapshot on 2026-07-05 shows no existing fixed-assets module or shared contract. Item 21 should reuse these foundations:

- Item 04 attachment, document sequence, audit, and outbox primitives.
- Item 08 accounting document/payment source records.
- Item 09 expense source records and attachments.
- Item 10 ledger posting adapter and period close policy.
- Item 11 tax review/export authority.
- Item 12 procurement/AP vendor bill and source line records.
- Item 16 workflow tasks and notifications where available.
- Item 17 AI draft/suggestion review layer where available.
- Item 18 report dataset/export primitives where available.
- Item 20 employee/custodian context if implemented.

Before implementation, inspect latest code again because previous items may add module folders, permissions, Prisma models, generated clients, use-case helpers, test setup, report adapters, AI tools, web route conventions, and seed/sync scripts.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-07-05.

Active implementer target: Sonnet 4.6 or later.

Owner decisions for first pass:

- Web/API own all fixed-asset mutations.
- LINE and AI are read-only for fixed assets.
- First pass supports one accounting depreciation book.
- Straight-line monthly depreciation is the required depreciation method.
- Asset capitalization requires source evidence or manual evidence packet.
- Supplier/AP and expense modules may provide candidates; item 21 owns final capitalization.
- Disposal/write-off and impairment/adjustment require approval by default.
- Fixed Assets emits ledger/tax/report source data; item 10 and item 11 remain posting/tax authorities.

Start point:

1. Read this plan first.
2. Read `docs/specs/fixed-assets-spec.md`.
3. Read `docs/specs/procurement-supplier-ap-spec.md`.
4. Read `docs/specs/expense-receipt-upload-spec.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read `docs/specs/tax-thailand-2026-spec.md`.
7. Read `docs/specs/reports-bi-spec.md` if report adapters exist.
8. Read `docs/specs/permission-matrix.md`.
9. Read backend/frontend/security guidelines and ADR 0006.
10. Inspect `apps/api`, `apps/web`, `apps/workers`, `packages/contracts`, `packages/config`, `apps/api/prisma`, and current test scripts.
11. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 21 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 20.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not expose Prisma generated types as domain or API contracts.
- Use decimal-safe calculations. Use strings in shared contracts for money, percentages, quantities, and book values.
- Keep asset transaction history immutable after approval.
- Corrections use reversal, adjustment, impairment, or disposal/write-off records; do not silently edit locked depreciation lines.
- Respect item 10 closed-period policy before capitalization, depreciation approval, adjustment, disposal, write-off, and reversal.
- Respect item 11 tax review/export boundaries.
- Fixed Assets emits source posting inputs. It must not create ledger journals directly.
- LINE and AI remain read-only; all final fixed-asset mutation happens on web/API.
- AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or fixed-asset repositories.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared fixed-assets contracts in `packages/contracts`.
- API module for fixed assets using repo hexagonal structure.
- Permission keys and default grants.
- Asset categories, policies, ledger mapping metadata, and document sequence keys.
- Asset register, source links, transaction history, assignments, depreciation runs/lines, adjustments, disposal/write-off.
- Capitalization queue from procurement/AP, expenses, accounting/manual evidence where source adapters exist.
- Straight-line monthly depreciation logic.
- Ledger posting source inputs and period-close checks.
- Tax review metadata and source events for item 11.
- Report adapters/datasets when item 18 exists.
- Workflow/notification hooks when primitives exist.
- Web Fixed Assets workspace.
- Read-only LINE/AI summaries and mutation refusal.
- Tests for domain, permissions, use cases, API, UI, reports, and AI/LINE boundaries.

### Out of Scope

- RFID/NFC/scanner hardware, GPS/IoT tracking, maintenance management, insurance claims, leasing accounting, construction-in-progress, component accounting, complex revaluation accounting, and multi-book statutory engine.
- Direct tax filing/export mutation outside item 11.
- Direct ledger journal creation outside item 10.
- Auto-posting without approval and posting-rule checks.
- Multi-currency acquisition/revaluation.
- Government, bank, marketplace, or vendor system mutation.
- LINE/AI fixed-asset final mutation, approval, export, posting, disposal/write-off, or policy change.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Currency: explicit `THB` string by default.
- Route base: `/v1/companies/:companyId/fixed-assets`.
- Shared contract file: `packages/contracts/src/fixed-assets.ts`.
- API module folder: `apps/api/src/modules/fixed-assets`.
- Document sequence keys:
  - `fixed_asset.asset`
  - `fixed_asset.capitalization`
  - `fixed_asset.depreciation_run`
  - `fixed_asset.disposal`
  - `fixed_asset.adjustment`
- Permission prefix: `fixed_asset`.
- First depreciation book: `accounting`.
- Depreciation method: `STRAIGHT_LINE_MONTHLY`.
- Depreciation period key: `YYYY-MM`.
- Capitalization approval: required by default.
- Disposal/write-off approval: required by default.
- Impairment/adjustment approval: required by default.
- Asset transfer/custody approval: required when branch/location/custodian changes after capitalization.
- Reports: register, depreciation schedule, roll-forward, disposal summary.
- LINE/AI mutation response: refuse and deep-link to web.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root package scripts and current package manager behavior.
- [ ] Inspect `packages/contracts/src` exports and naming conventions.
- [ ] Inspect `apps/api/src/modules` for accounting, expenses, procurement, ledger, tax, reports, workflow, audit, outbox, attachments, document sequence, auth, and permissions.
- [ ] Inspect `apps/api/prisma/schema.prisma`, migrations, seed, and permission sync scripts.
- [ ] Confirm source identifiers and line-level refs for vendor bills, expenses, accounting documents, payments, and attachments.
- [ ] Confirm ledger source adapter shape, posting status writer, period close checker, and account mapping conventions.
- [ ] Confirm tax event/review adapter shape if item 11 exists.
- [ ] Confirm report dataset registry/export pattern if item 18 exists.
- [ ] Confirm workflow/notification hooks if item 16 exists.
- [ ] Confirm current web route/nav/API-client/table/form/error-state patterns.
- [ ] Confirm current AI Gateway tool registration and LINE refusal patterns.
- [ ] Decide exact Prisma model names, module folder split, route names, and test commands.
- [ ] Record unavailable integration points as typed unavailable states before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact source adapters, ledger/tax/report/workflow hooks, and files to touch.
- No duplicate ledger, tax, procurement, expense, report, attachment, or AI primitive remains in the plan.

## Phase 1: Contracts, Permissions, and Domain Logic

### Goal

Create framework-free contracts and pure fixed-asset business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add `packages/contracts/src/fixed-assets.ts`.
- [ ] Export fixed-assets contracts from `packages/contracts/src/index.ts`.
- [ ] Define enums/statuses from the spec.
- [ ] Define DTOs for category, asset, source link, transaction, depreciation run/line, assignment, adjustment, disposal, filters, reports, typed errors, and permission constants.
- [ ] Add domain models and pure logic under `apps/api/src/modules/fixed-assets/domain`.
- [ ] Implement straight-line monthly depreciation calculation with residual value floor and non-negative carrying amount.
- [ ] Implement source allocation validation: duplicate source, split allocation, combined allocation, amount reconciliation.
- [ ] Implement depreciation run uniqueness and draft recalculation behavior.
- [ ] Implement disposal/write-off carrying amount and gain/loss candidate calculation.
- [ ] Implement permission helper/policy functions for finance/accountant/manager/auditor/LINE/AI boundaries.

### Tests

- [ ] Contracts build/typecheck.
- [ ] Domain tests for depreciation, residual floor, duplicate period, disposal stop date, source allocation, carrying amount, and typed errors.
- [ ] Permission logic tests for role boundaries and AI/LINE mutation refusal.

### Exit Criteria

- Pure logic passes focused tests without database or HTTP dependencies.
- Permission constants match [[specs/permission-matrix|Permission Matrix]].

## Phase 2: Prisma, Repositories, Seed, and Permissions

### Goal

Persist fixed-assets records and permission grants using current data patterns.

### Tasks

- [ ] Add Prisma models/migration for categories, assets, source links, transactions, depreciation runs/lines, assignments, adjustments, disposal/write-off, and review issues.
- [ ] Add indexes/unique constraints for company-scoped asset number/tag, source allocation, depreciation run period, and active category code.
- [ ] Add repository interfaces and Prisma implementation.
- [ ] Add mappers between Prisma rows and domain models/contracts.
- [ ] Add permission keys to registry/sync scripts and default grants.
- [ ] Add document sequence seed keys.
- [ ] Add audit/outbox event names.

### Tests

- [ ] `prisma validate`
- [ ] Migration diff/review.
- [ ] Repository tests where current test setup supports database-backed tests.
- [ ] Permission sync/seed focused tests if present.

### Exit Criteria

- Migration is additive and scoped.
- Generated client builds.
- Permission keys and grants align with spec and matrix.

## Phase 3: Capitalization and Asset Register API

### Goal

Implement asset category setup, capitalization queue, and register lifecycle.

### Tasks

- [ ] Add use cases for category create/update/archive and list/read.
- [ ] Add source candidate adapters for procurement/AP, expenses, accounting/manual evidence where available.
- [ ] Add capitalization draft create/update/submit/approve/reject/void/capitalize use cases.
- [ ] Add asset register list/detail/update/archive use cases.
- [ ] Enforce source state, duplicate allocation, attachment evidence, period close, category policy, and approval checks.
- [ ] Emit audit and outbox events.
- [ ] Add HTTP controllers/routes.

### Tests

- [ ] API/use-case tests for category setup, candidate source, capitalization approval, duplicate source guard, missing evidence, and permission denial.
- [ ] Ledger period-close guard test using current item 10 adapter/mocked port.

### Exit Criteria

- Finance can create capitalization draft and approved asset register via API.
- Source allocation cannot duplicate or silently mismatch.

## Phase 4: Depreciation Runs and Posting Inputs

### Goal

Implement monthly depreciation run lifecycle and ledger-ready source outputs.

### Tasks

- [ ] Add depreciation run create/calculate/recalculate/submit/approve/void use cases.
- [ ] Generate line-level depreciation schedules from active assets.
- [ ] Add review issues for missing mapping, duplicate period, closed period, disposed asset, negative carrying amount, and missing policy.
- [ ] Lock approved lines and prevent silent mutation.
- [ ] Emit posting-ready source inputs for item 10.
- [ ] Store posting status/result updates from ledger adapter.

### Tests

- [ ] Domain and API tests for monthly depreciation, duplicate period, recalculation, approval lock, closed-period block, and posting source output.

### Exit Criteria

- Approved depreciation run is immutable and ledger-ready.
- Future depreciation excludes disposed/written-off assets.

## Phase 5: Transfer, Adjustment, Disposal, and Write-off

### Goal

Complete core asset lifecycle after capitalization.

### Tasks

- [ ] Add transfer/custody change create/approve use cases and assignment history.
- [ ] Add impairment/adjustment create/approve/reversal use cases.
- [ ] Add disposal/write-off draft/approve/void use cases.
- [ ] Calculate carrying amount and gain/loss candidate.
- [ ] Stop future depreciation after disposal/write-off.
- [ ] Emit ledger/tax/report source events and audit/outbox events.

### Tests

- [ ] API/use-case tests for transfer, adjustment, disposal/write-off, approval guard, carrying amount, gain/loss candidate, and depreciation stop.

### Exit Criteria

- Asset lifecycle supports capitalization through disposal/write-off without editing locked history.

## Phase 6: Reports, Workflow, Notifications, and AI/LINE Read Tools

### Goal

Wire fixed assets into surrounding platform surfaces safely.

### Tasks

- [ ] Register report datasets when item 18 exists: register, depreciation schedule, roll-forward, disposal summary.
- [ ] Add workflow tasks for capitalization review, depreciation approval, disposal/write-off approval, and blocked review issues when item 16 exists.
- [ ] Add notifications for high-risk disposal/write-off, failed depreciation run, missing ledger mapping, and review blockers where item 06 exists.
- [ ] Add read-only AI/LINE tool endpoints or adapters following current item 07/17 patterns.
- [ ] Add AI/LINE refusal handling for mutation requests.

### Tests

- [ ] Report adapter tests.
- [ ] Workflow/notification tests where primitives exist.
- [ ] AI/LINE read summary and mutation refusal tests.

### Exit Criteria

- Reports and AI/LINE never bypass source permissions.
- Missing optional primitives return typed unavailable states, not fake success.

## Phase 7: Web Workspace

### Goal

Ship the permission-aware Fixed Assets web experience.

### Tasks

- [ ] Add navigation entry for Fixed Assets under finance/accounting when permitted.
- [ ] Add asset register list/detail pages with filters, status, carrying value, posting status, and tax review status.
- [ ] Add category/policy setup page.
- [ ] Add capitalization queue and review/approval flow.
- [ ] Add depreciation run list/detail/calculate/review/approve flow.
- [ ] Add transfer/adjustment/disposal/write-off panels.
- [ ] Add report/deep-link entry points where report module exists.
- [ ] Handle loading, empty, forbidden, typed unavailable, closed-period blocked, stale source, and review issue states.

### Tests

- [ ] Web component/page tests for register, capitalization queue, depreciation run, disposal/write-off, forbidden, empty, loading, and unavailable states.

### Exit Criteria

- A finance/accountant user can complete the first web workflow without using raw API calls.

## Phase 8: Integration and E2E Smoke

### Goal

Verify the end-to-end lifecycle across source, fixed assets, ledger source output, reports, and web.

### Tasks

- [ ] Run migration and seed in the local verified environment.
- [ ] Smoke create category -> capitalization draft -> approve asset -> run depreciation -> approve -> create disposal/write-off -> approve.
- [ ] Verify ledger posting source inputs are visible to item 10 adapter.
- [ ] Verify report dataset rows or typed unavailable state.
- [ ] Verify AI/LINE read summary and mutation refusal.
- [ ] Verify permission revocation blocks later read/export/download.

### Tests

- [ ] Focused API suite.
- [ ] Focused web tests.
- [ ] At least one browser/E2E or API smoke path covering capitalization and depreciation.

### Exit Criteria

- Core lifecycle passes in a production-like local setup.
- Evidence is recorded in [[agent-memory/fixed-assets-21|Fixed Assets Memory]].

## Phase 9: Hardening, Docs, and Checklist Gate

### Goal

Close implementation truthfully only after evidence exists.

### Tasks

- [ ] Run package typechecks and focused tests for touched packages.
- [ ] Run Prisma validate/generate and migration deploy where environment supports it.
- [ ] Run docs diff check.
- [ ] Update this plan with implementation evidence and caveats.
- [ ] Update [[specs/fixed-assets-spec|Fixed Assets Spec]] if implementation decisions changed.
- [ ] Update [[agent-memory/fixed-assets-21|Fixed Assets Memory]] with verification commands/results.
- [ ] Update [[plans/master-implementation-checklist|Master Implementation Checklist]] only after implementation evidence supports it.

### Verification Commands

Use current package scripts after Phase 0 confirms exact names. Expected starting point:

```sh
corepack pnpm --filter @watchdog-bms/contracts build
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/api test -- fixed-assets
corepack pnpm --filter @watchdog-bms/web test -- fixed-assets
corepack pnpm --filter @watchdog-bms/api prisma validate
git diff --check -- docs packages apps
```

### Exit Criteria

- All planned phases pass or have owner-accepted blockers recorded.
- Checklist item 21 remains unchecked until implementation, migration/seed, tests, and smoke evidence pass.
- Docs, permission matrix, roadmap, and memory agree on final state.

## Sonnet 4.6 First Turn Scope

Do only Phase 0 and Phase 1 first:

1. Inspect repo integration points.
2. Add contracts, permission constants, and pure domain logic/tests.
3. Stop with evidence before adding Prisma migration or web UI unless owner explicitly expands the turn.

This keeps the first diff small while proving the hardest accounting rules early.
