# Reimbursement Approval Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 14.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/reimbursement-approval-spec|Reimbursement and Approval Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 14. Reimbursement Approval
- Related specs:
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the reimbursement approval slice for WatchDog-BMS:

- Staff reimbursement requests.
- Strict default manager approval from 1 THB.
- Web approval queue and decision flow.
- Finance review and repayment status.
- Payment voucher (`ใบสำคัญจ่าย`) generation for approved unpaid reimbursements grouped by requester/payee.
- Reimbursement payment source facts for bank reconciliation.
- Ledger/tax-ready source adapters.
- Audit, outbox, notification, and read-only LINE/AI summaries.

This plan gives Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 14 follows these foundations:

- Item 04 data model core owns company, branch, attachments, document sequence, audit, and outbox primitives.
- Item 07 LINE AI is read-only and uses AI Gateway as orchestration boundary.
- Item 09 expense receipt upload owns receipt capture, OCR/extraction, AI verification, confirmed expenses, and expense payment facts.
- Item 10 ledger owns chart of accounts, journal posting, source posting adapters, posting status, and period close policy.
- Item 11 tax owns tax report/export/review workflows.
- Item 13 bank reconciliation reserves `REIMBURSEMENT_PAYMENT` as a payment source type.
- Item 16 workflow automation later owns reusable approval SLA escalation and workflow-rule configuration.

Current code snapshot on 2026-06-23 is still lean:

- `apps/api` has NestJS shell, health module, and common security decorators/guard.
- `apps/web` has Next.js shell and platform foundation feature.
- `packages/contracts` has only health/context types.
- No Prisma schema exists in the visible snapshot.

Before implementation, inspect latest code again because items 01 through 13 may add Prisma, auth, request context, audit, outbox, attachment storage, document sequences, expense APIs, ledger adapters, tax adapters, bank source matching, notifications, worker queues, web shell routes, API client helpers, and AI tool registration.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Owner decisions assumed for first pass:

- Approval required from 1 THB by default.
- One manager approval step is enough for MVP; model should allow more later.
- Requester self-approval is blocked by default.
- Manager approves/rejects in web only.
- LINE sends alerts and AI status summaries only.
- Finance review is required before payment.
- Finance records one full repayment; system does not execute bank transfers.
- Policy settings UI ships in item 14.
- Direct-manager/HR org chart modeling is out of scope. Use existing direct manager relationship only if present; otherwise use `MANAGER_ROLE` or configured approver user/role.
- Evidence export supports bounded JSON at minimum. Reuse existing export framework if present; do not create a broad export framework only for this item.
- Reimbursement payment source type is `REIMBURSEMENT_PAYMENT`.
- Advanced workflow SLA escalation is deferred to item 16.

Start point:

1. Read this plan first.
2. Read `docs/specs/reimbursement-approval-spec.md`.
3. Read `docs/specs/expense-receipt-upload-spec.md`.
4. Read `docs/specs/bank-reconciliation-spec.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read `docs/specs/tax-thailand-2026-spec.md`.
7. Read `docs/specs/permission-matrix.md`.
8. Read backend/frontend/security guidelines.
9. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
10. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 14 complete until Phase 0 through Phase 8 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 13.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Reuse item 09 receipt/expense evidence where available.
- Payment vouchers must reuse approved reimbursement records and item 09 evidence links; they must not create duplicate expense capture or execute bank transfers.
- Do not build a separate file storage/OCR abstraction.
- Do not create a competing expense, payment ledger, bank reconciliation, tax filing, or workflow automation system.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money calculations. Use strings across shared contracts.
- Use transactions for submit, approve, reject, finance review, payment record, payment void, status event, audit, outbox, and posting status changes where repository support exists.
- Submitted approval snapshots are immutable. Changes invalidate approval and require resubmission/correction.
- Paid reimbursements cannot be silently edited.
- Respect ledger period close and bank reconciliation locks when those modules exist.
- LINE and AI remain read-only. All final mutations happen in web/API.
- AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or reimbursement repositories.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared reimbursement contracts in `packages/contracts`.
- API reimbursement module using hexagonal folder structure.
- Reimbursement policy defaults.
- Staff draft/create/submit workflow.
- Manager approval queue and approve/reject workflow.
- Finance review queue and payment record workflow.
- Duplicate detection hooks for receipt/expense/reimbursement candidates.
- Attachment and expense evidence links.
- Reimbursement payment source refs for bank reconciliation.
- Ledger/tax source adapter interfaces.
- Permission keys and default grant docs alignment.
- Audit and outbox integration where primitives exist.
- Notification/LINE alert payloads where current notification primitives exist.
- Read-only AI/LINE tool contracts where item 07 integration exists.
- Web requester, approval, finance, detail, and payment views.
- Tests for contracts, domain logic, use cases, API behavior, UI behavior, and permission boundaries where current test setup supports them.

### Out of Scope

- External bank transfer execution, PromptPay initiation, payment rails, direct debit, or bank API write action.
- Employee payroll, HR profile, direct manager/org chart modeling, advance settlement, per diem/mileage engine, travel booking, or corporate card feed.
- Full OCR/extraction provider work. Reuse item 09 if present.
- Multi-level workflow designer, SLA escalation engine, or low-code automation. Item 16 owns them.
- Journal generation, chart of accounts, financial statements, or period close implementation.
- Tax filing, tax export, WHT certificate generation, or final tax advice.
- Broad JSON/CSV/XLSX/PDF export framework creation when no shared export primitive exists. Item 14 only needs bounded reimbursement JSON export fallback.
- LINE/AI final approval, rejection, payment, export, posting, or policy mutation.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Currency: explicit `THB` string by default.
- Approval threshold: `1.00`.
- Approver mode: `MANAGER_ROLE` if direct manager relationship is absent; `DIRECT_MANAGER` if current auth/profile model supports it.
- Self-approval: blocked.
- Finance review: required before payment.
- Duplicate policy: warn on submit, block payment until finance resolves.
- Route base: `/v1/companies/:companyId/reimbursements`.
- Web route base: `/finance/reimbursements`.
- Approval web route: `/approvals/reimbursements`.
- Request sequence key: `reimbursement.request`.
- Payment sequence key: `reimbursement.payment`.
- Payment source type for bank reconciliation: `REIMBURSEMENT_PAYMENT`.
- Payment methods: `CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`.
- Payment behavior: full payment only; paid amount must equal approved outstanding amount.
- First web pass may support one line per request while data model supports multiple lines.
- Policy settings UI: required in item 14.
- Direct manager model: do not build HR/org chart; use existing direct manager relation only if present, otherwise `MANAGER_ROLE`.
- First export format: bounded JSON minimum; use existing export primitives if present.
- LINE/AI mutation refused with web deep link.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect existing modules for auth, permissions, request context, audit, outbox, document sequence, attachments, notifications, workers, AI tool registry, and web shell routes.
- [ ] Confirm whether item 09 expense records, attachment links, duplicate detection, and expense payment source facts exist.
- [ ] Confirm whether item 10 ledger source posting adapter and period close policy ports exist.
- [ ] Confirm whether item 11 tax source event/review adapter exists.
- [ ] Confirm whether item 13 bank reconciliation payment source adapter expects `REIMBURSEMENT_PAYMENT`.
- [ ] Confirm current user/team/manager relationship model. If no direct manager exists, use role-based manager approver.
- [ ] Confirm current permission key registry and seed/grant location.
- [ ] Confirm current notification/LINE push event contract and web deep-link helper.
- [ ] Confirm current web route registry, navigation pattern, API client, form, table, modal/drawer, dictionary/i18n, loading, and error primitives.
- [ ] Confirm current test commands for root, API, web, workers, contracts, config, Prisma, and e2e if present.
- [ ] Decide extension path for reimbursement module, Prisma/migrations, source payment adapter, ledger adapter, tax adapter, notification events, and web screens.
- [ ] Record unavailable primitives and fallback choices in implementation notes before coding.

### Tests

- No code tests required unless baseline changes setup.

### Exit Criteria

- Implementer knows exact files to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows attachment/expense integration path.
- Implementer knows approval assignment source.
- Implementer knows audit, outbox, permission, notification, bank, ledger, tax, web, and AI integration points.
- No duplicate expense/payment/bank/ledger/tax/workflow primitive plan remains unresolved.

## Phase 1: Contracts, Domain Model, and Pure Logic

### Goal

Create framework-free reimbursement contracts and business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/reimbursements.ts`.
- [ ] Export reimbursement contracts from `packages/contracts/src/index.ts`.
- [ ] Add API module folder, following current conventions:
  - `apps/api/src/modules/reimbursements/domain/models`
  - `apps/api/src/modules/reimbursements/domain/logic`
  - `apps/api/src/modules/reimbursements/domain/ports`
  - `apps/api/src/modules/reimbursements/application/use-cases`
  - `apps/api/src/modules/reimbursements/application/dto`
  - `apps/api/src/modules/reimbursements/infrastructure`
  - `apps/api/src/modules/reimbursements/presentation/http`
- [ ] Define enums and contract DTOs for request, line, approval step, finance review, payment, policy, duplicate candidate, audit timeline, queue item, payment source ref, and AI summary.
- [ ] Define domain errors with stable codes for forbidden, not found, invalid status transition, self approval denied, missing receipt, stale approval snapshot, approval threshold mismatch, rejection reason required, duplicate unresolved, finance review required, payment over approved amount, payment reference required, source expense missing, period closed, bank match locked, attachment forbidden, idempotency conflict, and missing source dependency.
- [ ] Add pure logic:
  - decimal-safe threshold comparison
  - request required field validation
  - receipt requirement validation
  - approval snapshot hash generation
  - approval assignment decision from policy
  - self-approval guard
  - status transition guard
  - approval invalidation guard
  - rejection validation
  - finance review blocker calculation
  - duplicate candidate scoring
  - payment eligibility validation
  - payment total/outstanding calculation
  - payment source ref mapping
  - ledger source input mapping shape
  - tax review candidate mapping shape
  - redaction helpers for audit/outbox/AI payloads

### Tests

- `packages/contracts` typecheck.
- Unit tests for threshold, status transitions, self-approval, stale snapshot, duplicate scoring, finance blockers, payment guards, payment totals, source ref mapping, and redaction.

### Exit Criteria

- Contracts compile.
- Pure logic has focused tests.
- No Nest/Prisma/browser dependency leaks into domain logic.
- Source adapter interfaces are explicit enough for persistence/API phases.

## Phase 2: Persistence and Migrations

### Goal

Persist reimbursement state using repo Prisma/migration conventions while preserving source module ownership.

### Tasks

- [ ] Add Prisma models/enums or extend existing schema for:
  - `ReimbursementPolicy`
  - `ReimbursementRequest`
  - `ReimbursementLine`
  - `ReimbursementApprovalStep`
  - `ReimbursementPayment`
  - `ReimbursementDuplicateCandidate`
  - optional `ReimbursementStatusEvent` only if shared audit cannot power timeline
- [ ] Add indexes for company/status/requester/approver/payment status queues.
- [ ] Add unique constraint for `companyId, requestNo`.
- [ ] Add idempotency uniqueness according to current idempotency pattern.
- [ ] Link attachments through existing attachment link primitives where available.
- [ ] Link item 09 expense records through nullable source refs where available.
- [ ] Add repository mappers from persistence rows to domain models.
- [ ] Add repository/query ports and Prisma implementations.
- [ ] Add transaction helpers or use current unit-of-work pattern for state-changing workflows.
- [ ] Add seed/default reimbursement policy if current seed system exists.
- [ ] Add permission keys/default grants to current permission seed/registry if implemented.

### Tests

- Prisma generate/migration validation command used by repo.
- Repository/mapper tests if existing integration test setup supports DB.
- Typecheck touched packages.

### Exit Criteria

- Schema/migrations apply cleanly.
- Repositories can create/read/update request, approval step, and payment records.
- Queue queries are indexed and scoped by company.
- Permission keys exist in same source of truth as other modules.

## Phase 3: API Use Cases and HTTP Controllers

### Goal

Implement permission-checked business workflows behind thin controllers.

### Tasks

- [ ] Register `ReimbursementsModule` in `apps/api/src/app.module.ts` or current module registry.
- [ ] Implement use cases:
  - create draft
  - update draft
  - submit request
  - cancel request
  - get detail
  - list requests
  - list approval queue
  - approve request
  - reject request
  - list finance queue
  - update finance review
  - record payment
  - void payment
  - export evidence if export primitive exists
- [ ] Enforce tenant, branch/team, ownership, requester/approver separation, and permission checks in use cases or shared authorization layer.
- [ ] Validate idempotency keys for submit/approve/reject/payment.
- [ ] Write audit and outbox records in same transaction as mutation where primitives exist.
- [ ] Add controller routes under `/v1/companies/:companyId/reimbursements`.
- [ ] Add API DTO validation using current class-validator or repo DTO pattern.
- [ ] Return stable error codes from domain/use-case errors.
- [ ] Add Swagger/OpenAPI annotations if current API does so.

### Tests

- Use-case tests with fake repositories/ports for happy path and guards.
- Controller/API tests where current setup supports Nest integration tests.
- Permission tests for own/team/finance/auditor boundaries.

### Exit Criteria

- API supports draft -> submit -> approve/reject -> finance review -> payment.
- Forbidden users cannot read or mutate out-of-scope requests.
- Sensitive mutations audit and emit bounded outbox payloads.
- Controllers contain no business logic.

## Phase 4: Approval, Notification, and Read-Only AI/LINE Hooks

### Goal

Connect reimbursement events to alerts and AI summaries without allowing LINE mutation.

### Tasks

- [ ] Emit notification/outbox payload when request is submitted and approval is assigned.
- [ ] Emit requester notification payload when approved, rejected, needs information, ready to pay, or paid.
- [ ] Create or extend web deep-link helper for reimbursement detail/approval routes.
- [ ] Add read-only summary/query use cases for:
  - my reimbursement status
  - pending approvals
  - approval summary by age/status
  - unpaid approved reimbursements
- [ ] Register AI Gateway read tools only if item 07 registry exists.
- [ ] Ensure AI tools call API/use cases, not repositories/Prisma.
- [ ] Add LINE refusal behavior for approve/reject/payment/export/policy mutation requests where LINE intent layer exists.
- [ ] Include SLA-risk/age fields but leave automated escalation rule creation to item 16.

### Tests

- Unit/use-case tests for alert payload redaction and deep-link generation.
- AI tool tests or contract tests where item 07 setup exists.
- Test mutation requests through AI/LINE policy return refusal/web link.

### Exit Criteria

- Manager can receive alert payload with safe summary and web link.
- AI/LINE tools are read-only and permission-checked.
- No final reimbursement mutation is possible from LINE/AI.

## Phase 5: Finance Payment, Bank, Ledger, and Tax Adapters

### Goal

Make approved reimbursements usable by finance, bank reconciliation, ledger, and tax review without taking over those modules.

### Tasks

- [ ] Implement finance blocker calculation from duplicate, receipt, tax/accounting, and policy checks.
- [ ] Implement payment voucher generation for approved, finance-reviewed, unpaid requests grouped by requester/payee, with included evidence refs, blockers, total transfer amount, and generated document/artifact metadata where document primitives exist.
- [ ] Implement payment recording and voiding with domain guards.
- [ ] Enforce MVP full-payment rule: paid amount must equal approved outstanding amount; reject underpayment, partial payment, and overpayment.
- [x] H-06 hardening: record reimbursement payment/source ref/request totals atomically with serializable transaction, per-request advisory lock, CAS, durable unique attempt key, and idempotent retry/number finalization.
- [ ] Implement `REIMBURSEMENT_PAYMENT` source adapter/query for item 13 bank reconciliation if bank adapter extension point exists.
- [ ] Implement ledger source posting input adapter for item 10 if ledger adapter extension point exists.
- [ ] Implement tax review candidate/source fact adapter for item 11 if tax adapter extension point exists.
- [ ] Call ledger period close policy before payment void/correction when item 10 exists.
- [ ] Call bank reconciliation lock policy before payment void when item 13 exists.
- [ ] Update posting status through source adapter interface only.
- [ ] Add evidence export using current export primitives. If none exist, add bounded JSON export from read model.

### Tests

- Unit tests for finance blockers, payment voucher grouping/totaling, full-payment validation, payment source ref, ledger source input, tax review candidate, and payment void blockers.
- H-06 deterministic two-request race, transactional boundary fault injection, CAS conflict, and retry-after-commit-timeout tests.
- Integration tests for bank/ledger/tax adapter contracts where those modules exist.
- Export redaction test.

### Exit Criteria

- Reimbursement payments can be read as source payment refs for bank reconciliation.
- Ledger/tax adapters return deterministic source facts without generating journals or filings.
- Payment correction respects bank/ledger blockers when those modules exist.

## Phase 6: Web UI

### Goal

Ship ergonomic web workflows for requester, manager, and finance users.

### Tasks

- [ ] Add feature folder `apps/web/src/features/reimbursements`.
- [ ] Add feature files:
  - `reimbursements.api.ts`
  - `reimbursements.constants.ts`
  - `reimbursements.logic.ts`
  - `reimbursements.model.ts`
  - `components/ReimbursementsPage.tsx`
  - `components/ReimbursementDetailPage.tsx`
  - `components/ReimbursementApprovalQueue.tsx`
  - `components/ReimbursementFinanceQueue.tsx`
  - CSS modules as needed
- [ ] Add thin Next.js route files for current app router convention.
- [ ] Reuse common layout, badge, modal/drawer, table, form, loader, and error primitives.
- [ ] Add Thai and English dictionary entries according to current i18n pattern. If no i18n exists, isolate labels in constants for later extraction.
- [ ] Build requester list and request form.
- [ ] Build manager approval queue and detail decision form.
- [ ] Build finance queue, blocker display, and full-payment form.
- [ ] Build owner/admin policy settings UI for threshold, approver mode, configured approver user/role when supported, receipt rule, duplicate policy, finance review rule, and SLA hours.
- [ ] Build detail timeline/audit summary using API read model.
- [ ] Show scoped cover loaders for list refresh, submit, approve, reject, finance review, payment, export, and void actions.
- [ ] Ensure responsive desktop/mobile layouts with no overlapping controls.

### Tests

- Web typecheck.
- Pure logic tests for status labels, filters, queue grouping, form validation, full-payment validation, payment reference requirements, and policy settings validation.
- UI smoke/manual screenshots if browser tooling exists.

### Exit Criteria

- Staff can submit from web.
- Manager can approve/reject from web.
- Finance can review and mark paid from web.
- Owner/admin can update reimbursement policy settings from web.
- Thai labels fit common workspace layout.
- Mutation pending states are visible and prevent duplicate submits.

## Phase 7: Security, Tests, and Hardening

### Goal

Close correctness, permission, audit, and regression gaps before checklist completion.

### Tasks

- [ ] Add/verify permission keys in permission matrix, seed, and controller/use-case guards.
- [ ] Add denied-action audit for self-approval, forbidden approve/reject/payment, cross-company attachment, and payment void blockers where audit primitive supports denied events.
- [ ] Add idempotency tests for submit, approve, reject, and payment.
- [ ] Add cross-company and cross-branch tests.
- [ ] Add snapshot invalidation tests.
- [ ] Add payment correction/void tests.
- [ ] Add audit/outbox redaction tests.
- [ ] Add AI/LINE final-mutation refusal tests where integration exists.
- [ ] Run repo verification commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm lint`
  - package-specific build/test commands required by current scripts
- [ ] Record any unavailable commands, failures, or blocked dependencies in implementation notes.

### Tests

- Root/package typecheck.
- Root/package tests.
- Root/package lint.
- Any DB migration/integration test commands current repo requires.

### Exit Criteria

- Core reimbursement workflows pass tests.
- Security/permission boundaries have tests.
- Audit/outbox payloads are redacted.
- Verification commands are recorded.

## Phase 8: Documentation and Checklist Closeout

### Goal

Keep docs as source of truth and close item 14 only after implementation truly passes.

### Tasks

- [ ] Update implementation notes with final routes, models, permissions, adapter names, and verification commands.
- [ ] Update API docs/OpenAPI snapshots if current repo tracks them.
- [ ] Update web navigation/docs if current repo tracks them.
- [ ] Update `docs/specs/requirements-coverage.md` if behavior materially changed.
- [ ] Update `docs/specs/permission-matrix.md` only if implemented permission keys differ from this plan/spec.
- [ ] Update Master Implementation Checklist item 14 checkbox only after all exit criteria pass.
- [ ] Keep item 14 unchecked if any phase, verification command, or critical acceptance criterion remains incomplete.

### Tests

- Documentation link check if current repo has one.
- No code tests required unless docs generation exists.

### Exit Criteria

- Item 14 docs and implementation agree.
- Master checklist remains unchecked until implementation and verification pass.
- Handoff notes explain any deferred backlog clearly.

## Risks

- Earlier items may not exist yet in code, despite docs readiness. Mitigation: keep ports/adapters explicit and implement minimal local boundaries without duplicating source modules.
- Direct manager relationship may not exist. Mitigation: use `MANAGER_ROLE` approver mode first and do not build HR/org chart inside item 14.
- Expense/attachment primitives may differ from docs. Mitigation: inspect item 09 code and adapt; do not create parallel OCR/storage.
- Bank/ledger/tax adapters may not exist. Mitigation: create source ref/read-model interfaces and wire adapters when modules appear.
- Workflow SLA automation may be expected too early. Mitigation: emit events and show age/SLA-risk; leave configurable escalation to item 16.
- Payment correction can conflict with bank reconciliation/period close. Mitigation: call policy ports where present and block safely when unknown.

## Resolved Owner Decisions

- First payment UI/API is full-payment only.
- Payment voucher first pass groups records by requester/payee and prepares repayment documentation only; bank transfer execution and bulk payment files stay out of scope.
- Policy settings UI ships in item 14.
- Direct manager/HR org chart model should not be built in item 14. Use existing direct manager relation only if present; otherwise use `MANAGER_ROLE` or configured approver user/role.
- Evidence export supports bounded JSON at minimum. Use existing export framework if present; do not create a broad export framework only for item 14.
- 2026-08-10: all persisted related actors may view a reimbursement through `reimbursement.read_related`, including linked
  expense actors, but only within tenant/branch scope. Mutations remain governed by their existing action permission,
  exact actor and state. API, web and LINE/AI must share the same relation boundary.
