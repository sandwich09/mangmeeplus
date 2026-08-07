# Bank Accounts and Reconciliation Implementation Plan

## Status

Pre-amendment item 13 baseline is implemented/verified as recorded below. The 2026-07-31 Feature Entitlement Decoupling v5.1 tax-evidence allocation, retained-source redaction and unmatch-safety amendment is owner-confirmed, planned below, and not yet implemented/verified.

For remaining/amended work, implement one phase at a time after the v5 contract is confirmed.

## Linked Spec

- Spec: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 13. Bank Accounts and Reconciliation
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
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

Implement the banking and reconciliation slice for WatchDog-BMS:

- Bank/cash account master.
- Statement import preview and commit.
- Manual statement lines.
- Payment and ledger cash movement matching.
- Reconciliation sessions.
- Bank adjustment drafts and ledger-ready posting inputs.
- Cash visibility.
- Evidence export.
- Web workflow and read-only AI/LINE summaries.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 13 follows these foundations:

- Item 08 accounting documents owns customer payments and shared accounting payment primitives.
- Item 09 expense upload owns confirmed expense payment facts.
- Item 10 ledger owns cash/bank ledger accounts, journal lines, source posting adapters, posting status, and period close policy.
- Item 11 tax owns tax reports and tax filing state.
- Item 12 procurement/AP owns supplier payments, vendor bill payment allocation, AP aging, and supplier statement.

Before implementation, inspect latest code again because items 01 through 12 may add Prisma, auth, request context, audit, outbox, document sequence, attachment storage, accounting payments, expense payments, supplier payments, ledger source adapters, tax source adapters, web shell routes, shared API client, and permission registry.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Owner decisions assumed for first pass:

- Bank transfer execution is out of scope. Record and reconcile only.
- Statement import supports CSV/XLSX-style parsing, manual entry, generic mapping, and first-pass alias presets for KBank K BIZ and SCB Business Anywhere. Direct bank feeds are deferred.
- Matching tolerance starts at zero amount variance; differences require override permission and reason.
- Full bank account number storage is deferred when encryption/tokenization primitives are absent.
- Reconciliation completion is ACCOUNTANT-owned by default.
- Ignored statement lines require Accountant review before reconciliation completion.
- Evidence export first pass supports JSON, CSV, XLSX, and PDF.
- Bank adjustment approval is ACCOUNTANT-owned by default.

Start point:

1. Read this plan first.
2. Read `docs/specs/bank-reconciliation-spec.md`.
3. Read `docs/specs/accounting-documents-spec.md`.
4. Read `docs/specs/expense-receipt-upload-spec.md`.
5. Read `docs/specs/procurement-supplier-ap-spec.md`.
6. Read `docs/specs/double-entry-ledger-closing-spec.md`.
7. Read `docs/specs/permission-matrix.md`.
8. Read backend/frontend/security guidelines.
9. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
10. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 13 complete until Phase 0 through Phase 9 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 12.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Use existing accounting payment, expense payment, supplier payment, reimbursement payment, and ledger journal records as source facts.
- Do not create a competing payment ledger.
- Do not initiate external bank transfers or bank API write actions.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money calculations. Use strings across shared contracts.
- Use transactions for import commit, match confirm/unmatch, adjustment approve/void, reconciliation complete/reopen, audit, outbox, and posting status updates where repository support exists.
- Statement lines are append-only after commit. Corrections use void/import reversal/ignore/adjustment, not silent mutation.
- Completed reconciliation locks included lines until reopened.
- Respect ledger period close when item 10 exists.
- Respect source payment void status before matching.
- Store masked account display data only unless approved encryption/tokenization support exists.
- LINE and AI remain read-only. All mutations happen in web/API.
- AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or banking repositories.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared banking/reconciliation contracts in `packages/contracts`.
- API banking module using hexagonal folder structure.
- Bank/cash account master.
- Statement import preview/commit and manual statement lines.
- Duplicate detection and statement normalization.
- Match candidate query, deterministic suggestions, confirm/reject/unmatch/ignore.
- Split match allocations.
- Bank adjustment draft, approval, posting input, and posting status integration.
- Reconciliation sessions, completion, reopen, and evidence export.
- Cash position read model.
- Permission keys and default grants.
- Audit and outbox integration where primitives exist.
- Ledger source posting inputs and period close checks.
- Web banking route group and finance UX.
- Read-only AI/LINE tools or API payloads when current AI Gateway integration points exist.
- Tests for contracts, domain logic, use cases, API behavior, UI behavior, and permission boundaries where current test setup supports them.

### Out of Scope

- Bank transfer execution, PromptPay initiation, direct debit, external approval, payment rails, card settlement provider settlement, or bank API write actions.
- Direct bank feed integration, OAuth bank connections, statement scraping, or open-banking provider setup.
- Replacing source payment workflows from accounting documents, expense, AP, or reimbursement.
- Journal generation, chart of accounts management, financial statement generation, or period close implementation.
- Tax filing/export/certificate generation.
- Multi-currency revaluation and FX gain/loss automation.
- Payroll, fixed assets, manufacturing, marketplace settlement, CRM collections.
- LINE/AI banking mutation.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Currency: explicit `THB` string by default.
- Document sequence keys:
  - `bank.reconciliation_session`
  - `bank.adjustment`
- Route base: `/v1/companies/:companyId/banking`
- Web route base: `/finance/banking`
- Statement import parser: generic mapping plus first-pass alias presets `KASIKORNBANK_KBIZ` and `SCB_BUSINESS_ANYWHERE`.
- Bank preset parser fixtures: synthetic CSV and XLSX-like rows first; replace or add real exports in Phase 0 when available.
- Date tolerance for suggestions: plus/minus 7 calendar days.
- Matching amount tolerance: zero.
- Reconciliation variance tolerance: zero.
- Supported first export formats: JSON, CSV, XLSX, and PDF.
- Account number storage: masked/last4 only unless encryption/tokenization exists.
- Bank account status default: `ACTIVE`.
- Statement line directions: deposit positive, withdrawal negative.
- LINE/AI mutation refused with web deep link.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect existing modules for accounting payments, expense payments, supplier payments, reimbursement, ledger, tax, auth, audit, outbox, document sequence, attachments, and request context.
- [ ] Confirm whether `AccountingPayment` supports `direction = RECEIVED` and `direction = PAID`.
- [ ] Confirm item 12 supplier payment source model and API, if implemented.
- [ ] Confirm item 09 expense payment source model and API, if implemented.
- [ ] Confirm item 14 reimbursement source is absent or present.
- [ ] Confirm ledger account model, journal line query shape, source posting adapter names, posting status writer contract, and period close policy hook.
- [ ] Confirm attachment/file upload primitives for statement import and evidence export.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current web route registry, navigation pattern, API client, loader, table, form, modal/drawer, dictionary/i18n, and error state primitives.
- [ ] Confirm current AI Gateway tool registration pattern if item 07 exists.
- [ ] Confirm current test commands for root, API, web, workers, contracts, config, Prisma, and e2e if present.
- [ ] Decide extension path for banking module, source payment adapters, ledger adapter wiring, import parsing, and evidence export.
- [ ] Collect or request one real statement export each for KBank K BIZ and SCB Business Anywhere when available.
- [ ] If real exports are unavailable, create synthetic fixtures and mark presets as alias-based until validated.
- [ ] Record public source limitation: stable official sample CSV/XLSX column layouts were not found during docs prep.
- [ ] Record conflicts or unavailable primitives in implementation notes before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows payment source adapter paths for customer, supplier, expense, reimbursement, and ledger.
- Implementer knows audit, outbox, permission, attachment, ledger, web, and AI integration points.
- No duplicate payment/ledger/tax primitive plan remains unresolved.

## Phase 1: Contracts, Domain Model, and Pure Logic

### Goal

Create framework-free banking contracts and business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/banking.ts`.
- [ ] Export banking contracts from `packages/contracts/src/index.ts`.
- [ ] Add API module folder, following current conventions:
  - `apps/api/src/modules/banking/domain/models`
  - `apps/api/src/modules/banking/domain/logic`
  - `apps/api/src/modules/banking/domain/ports`
  - `apps/api/src/modules/banking/application/use-cases`
  - `apps/api/src/modules/banking/application/dto`
  - `apps/api/src/modules/banking/infrastructure`
  - `apps/api/src/modules/banking/presentation/http`
- [ ] Define enums and contract DTOs for bank account, statement import, statement line, match, match candidate, bank adjustment, reconciliation session, evidence export, cash position, posting status, and read-only AI summaries.
- [ ] Define domain errors with stable codes for forbidden, not found, duplicate import, duplicate line, invalid mapping, invalid status transition, locked reconciliation, over allocation, wrong sign, wrong currency, match variance, missing source payment, source voided, period closed, ledger link missing, sensitive account denied, and missing source dependency.
- [ ] Add pure logic:
  - statement row normalization
  - KBank K BIZ and SCB Business Anywhere alias preset normalization
  - debit/credit/signed amount normalization
  - Thai/Buddhist Era date normalization where parser can detect it
  - duplicate hash generation
  - statement line status calculation
  - match suggestion scoring
  - match allocation validation
  - split allocation validation
  - ignore-line validation
  - reconciliation movement and balance calculation
  - reconciliation completion guard
  - bank adjustment posting input mapping
  - safe redaction for account details
  - cash position aggregation shape

### Tests

- `packages/contracts` typecheck.
- Unit tests for normalization, duplicate hashing, matching, split allocation, reconciliation balances, adjustment posting input, and account redaction.
- Unit tests for generic, KBank, and SCB preset alias fixtures.

### Exit Criteria

- Contracts compile.
- Pure logic has focused tests.
- No Nest/Prisma/browser dependency leaks into domain logic.
- Source adapter interfaces are explicit enough for Phase 3.

## Phase 2: Persistence and Migrations

### Goal

Persist banking state using repo Prisma/migration conventions while preserving source module ownership.

### Tasks

- [ ] Add or extend Prisma models for:
  - `BankAccount`
  - `BankStatementImport`
  - `BankStatementLine`
  - `BankReconciliationMatch`
  - `BankAdjustment`
  - `BankReconciliationSession`
  - `BankReconciliationSessionLine`
  - `BankReconciliationEvidenceExport`
- [ ] Add `BankStatementLine.allocationVersion` and `BankMatchAllocationCommand` parent + ordered `BankReconciliationMatch` children so one split-confirm command increments once and replays the whole set; append command-idempotent VOID_MATCH with expected version and one-void-per-target uniqueness.
- [ ] Add indexes and uniqueness constraints from spec where Prisma supports them.
- [ ] Add enum values or string constants using repo convention.
- [ ] Add an expand/backfill/enforce migration for the v5 amendment: nullable/default fields first; company/line lock and over-allocation/source-remaining precheck; deterministic allocationVersion; one-child `LEGACY_RECONCILED` parent per existing match plus deterministic legacy void parent; shadow verification; then LIVE non-null/partial uniqueness enforcement. Ambiguous rows get one internal prefilled review and block only new allocation—no deletion or customer re-entry. Rollback is fix-forward to dual-read.
- [ ] Add repository interfaces in domain/application ports.
- [ ] Add Prisma repositories and mappers.
- [ ] Add transaction boundary helpers using current unit-of-work pattern if present.
- [ ] Add seed/default permission keys where current seed pattern exists.
- [ ] Add document sequence keys for `bank.reconciliation_session` and `bank.adjustment` when sequence primitives exist.

### Tests

- Prisma validate/generate/migrate command used by repo.
- Repository mapper unit tests where current pattern exists.

### Exit Criteria

- Migration applies cleanly locally.
- Prisma generated client/typecheck passes.
- No source payment tables are duplicated.
- Sensitive account number fields store masked/last4 only unless approved secret storage exists.

## Phase 3: Bank Accounts and Statement Import API

### Goal

Expose bank account management and statement import preview/commit through permission-checked API use cases.

### Tasks

- [ ] Register banking module in API app using current module conventions.
- [ ] Implement bank account use cases:
  - list
  - get
  - create
  - update
  - deactivate/archive
- [ ] Implement statement import preview use case with parser/mapping abstraction.
- [ ] Implement built-in alias presets for KBank K BIZ and SCB Business Anywhere.
- [ ] Implement statement import commit use case with duplicate handling and transaction.
- [ ] Implement manual statement line create use case.
- [ ] Implement import void use case with completed reconciliation guard.
- [ ] Add DTO validation using current validation library.
- [ ] Add permission checks and ABAC company/branch checks.
- [ ] Add audit/outbox events where primitives exist.
- [ ] Add HTTP controllers/routes.
- [ ] Add API response examples in tests or fixtures when repo pattern exists.

### Tests

- Unit tests for use cases with fake repositories.
- API integration tests for create bank account, update bank account, preview import, commit import, manual line, void import, duplicate handling, and permissions.
- Parser tests for generic, KBank, and SCB preset fixture rows.

### Exit Criteria

- Finance can create bank account and commit valid statement lines through API.
- Duplicate statement rows are blocked or warned according to request.
- Unauthorized roles cannot mutate banking records.
- Audit/outbox behavior is verified or documented if primitives absent.

## Phase 4: Matching Engine and Source Adapters

### Goal

Match statement lines to source payments and ledger cash movements without copying source ownership.

### Tasks

- [ ] Implement `BankMatchSourcePort` interfaces for:
  - customer payments from item 08
  - expense payments from item 09
  - supplier payments from item 12
  - reimbursement payments from item 14 when present
  - ledger journal lines from item 10
  - bank adjustments from item 13
  - immutable VAT refund outcomes, refundable external-scope-transition dispositions, PP30 filing payments and PP36/PND filing-payment roots from item 11; the Bank module allocates evidence but never owns tax state
- [ ] Define a contracts-owned immutable `TaxCashTargetReader` for Bank and Bank-owned `BankConfirmedMatchEvidenceReader` for Tax. Wire adapters at the composition/read-model boundary; do not import cross-module repositories/mutation services or use `forwardRef`. Test each module with fake ports.
- [ ] Implement adapters that return permission-filtered `BankMatchCandidate`, including explicit `sourceAction`, `sourceArtifactHash`, `sourceCashEffect`, direction and canonical cash amount for every eligible tax target; persist the same hash/action/cash-effect on confirmed tax matches for audit/fingerprint validation, while non-tax sources may leave them null. Only ORIGINAL/REPLACEMENT `REFUND_RECEIVED|REFUNDED,cashEffect=DEPOSIT`, their durable-evidence-backed economic `cashEffect=WITHDRAWAL` reversals and explicit filing payment/reversal actions qualify. `cashEffect=NONE`, every noncash refund/disposition, bare `mutationKind=REVERSAL` and legacy unknown-amount markers reject before allocation. Callers without source detail permission receive only labeled reconciliation-safe fields and no dead URL.
- [ ] Implement match candidate query use case.
- [ ] Implement suggestion generation use case.
- [ ] Implement command-idempotent confirm match with one parent/full child-result hash, split allocation, expected statement-line allocation-version CAS, remaining amount, action-specific sign, currency, date/reference tolerance, canonical source identity and source status validation. Tax artifacts must already exist; Tax then appends its evidence head.
- [ ] Return the immutable whole match result/version to the shared Tax cash-evidence-link orchestrator. The Bank command never creates tax truth; the follow-up link targets the existing artifact hash and is safely resumable without asking the user to select evidence again.
- [ ] Implement reject suggestion use case.
- [ ] Implement command-idempotent void/unmatch with expected allocation version. Return `tax_evidence_in_use` once a dependent projection consumed the match. PAYMENT_REVERSAL uses a new opposite-direction allocation; artifact supersession with unchanged cash transfers evidence to its successor without freeing the match. Only explicit corrected-evidence unlink may reverse/current-open-correct its evidence/projection and append the void before freeing allocation.
- [ ] Implement ignore statement line use case with reason.
- [ ] Add locking guard for completed reconciliation session lines.
- [ ] Update statement line status after match changes.
- [ ] Add audit/outbox events for match confirmation/unmatch/ignore.

### Tests

- Unit tests for each source adapter with representative records.
- Unit tests for match suggestion scoring and allocation.
- Integration tests for confirming a customer payment match.
- Integration tests for confirming a supplier payment match when item 12 source exists.
- Integration tests prove one statement-line allocation cannot be reused by two tax payment/refund artifacts; concurrent splits never exceed the line and a stale allocation version changes nothing.
- Split command retry returns the whole immutable child set, payload reuse rejects, version increments once, and two distinct void commands cannot both win.
- Legacy match migration covers clean, overallocated and already-voided rows with no customer re-entry.
- Tax adapter tests cover ORIGINAL/REPLACEMENT refund `cashEffect=DEPOSIT`, evidence-backed economic refund reversal `cashEffect=WITHDRAWAL`, classification-only reversal NONE rejection, all noncash refund/disposition rejection, payment reversal DEPOSIT with a new allocation, payment WITHDRAWAL, target-hash/action/cash-effect mismatch, non-tax nullable artifact hash and combined PP30 principal+charge amount. Bank evidence remains usable with Ledger off/unmapped and later resolves its Ledger account without cash re-selection. Bank-only callers see labeled safe aggregates with no Tax detail/dead link, while Tax-visible callers receive permitted detail. Bank and Tax modules compile/test independently with fake boundary ports.
- Mark-tax-first→match→cash-link and UI match-at-command retry preserve one selection, one Bank allocation set and one Tax evidence head; concurrent link failure never rolls back or duplicates tax truth.
- Consumed tax match cannot ordinary-unmatch; still-true cash transfers to an artifact successor without freeing, and only explicit corrected-evidence unlink frees it once after projection correction.
- Permission tests for match confirm, unmatch, and override.

### Exit Criteria

- Statement lines can be suggested, matched, split, rejected, ignored, and unmatched.
- Over-allocation, duplicate tax-evidence reuse, stale allocation version, dependent-evidence unmatch, wrong action/sign, wrong currency, source voided, detail leakage and variance without override are blocked.
- Source modules remain owners of payment facts.

## Phase 5: Bank Adjustments, Ledger Integration, and Period Policy

### Goal

Support bank-origin activity that needs accounting follow-up while respecting item 10 ledger boundaries.

### Tasks

- [ ] Implement bank adjustment create/submit/approve/void use cases.
- [ ] Add category validation for bank fee, interest, owner contribution/draw, inter-account transfer, unknown deposit, unknown withdrawal, and other.
- [ ] Require ledger debit/credit account mapping before approval where item 10 account model exists.
- [ ] Restrict approval to ACCOUNTANT/OWNER by default.
- [ ] Generate deterministic posting input for approved bank adjustments.
- [ ] Wire posting status writer/reader contract where item 10 exists.
- [ ] Call ledger period close policy before approving, voiding, or changing accounting-relevant adjustment.
- [ ] Support matching approved bank adjustment to statement line.
- [ ] Add audit/outbox events.

### Tests

- Unit tests for adjustment approval guards and posting input mapping.
- Integration tests for adjustment approve and posting status.
- Period close policy test when item 10 hook exists.

### Exit Criteria

- Bank-origin fees/interest/transfers can be represented without ad hoc ledger edits.
- Approved adjustment is ledger-ready but ledger generation remains item 10-owned.
- Closed-period rules are respected.

## Phase 6: Reconciliation Sessions and Evidence Export

### Goal

Complete bank reconciliation workflow and export reproducible evidence.

### Tasks

- [ ] Implement reconciliation list/get/create/recalculate use cases.
- [ ] Implement completion guard:
  - required lines matched or ignored with reason
  - ignored lines reviewed by Accountant
  - no unexplained source payment open items inside policy
  - zero variance by default
  - with Ledger enabled, ledger link present and closed-period policy passes
  - with Ledger off, use matched-source-evidence basis and let `NOT_APPLICABLE|PENDING_ENABLE` Ledger status pass
- [ ] On later Ledger enable, deploy-owned binding/backfill consumes retained completed sessions/matches without statement re-import or re-match; deduplicate an unresolved bank-account mapping into one prefilled task.
- [ ] Implement completed session line snapshot.
- [ ] Implement reopen use case with reason and permission.
- [ ] Implement void use case if business policy needs it.
- [ ] Implement evidence export JSON, CSV, XLSX, and PDF.
- [ ] Add attachment/file output integration if current primitives exist.
- [ ] Add export hash and audit/outbox events.
- [ ] Add cash position query/read model.

### Tests

- Unit tests for reconciliation balance calculation and completion guard.
- Integration tests for create, complete, lock, reopen, export, Bank-only completion with a null Ledger link, and Ledger OFF→ON bind/backfill without re-import/re-match.
- Permission tests for complete, reopen, and export.
- Permission tests confirm FINANCE cannot complete reconciliation and cannot approve bank adjustment by default.

### Exit Criteria

- Accountant can complete reconciliation with reproducible balances.
- Bank-only completion is independent of Ledger; enable-later reuses its retained evidence.
- Completed reconciliation locks included lines.
- Reopen requires permission and reason.
- Evidence export contains all required source data and hash.
- Cash position endpoint works.

## Phase 7: Web Banking Workspace

### Goal

Build practical web UI for finance users using existing web shell and component patterns.

### Tasks

- [ ] Add web route group under `/finance/banking`.
- [ ] Add navigation entry using current route/nav registry.
- [ ] Add API client/hooks for banking endpoints.
- [ ] Build Bank Accounts list and detail screens.
- [ ] Build Statement Lines tab with filters and statuses.
- [ ] Build Statement Import preview/commit workflow.
- [ ] Build Manual Statement Line drawer/modal.
- [ ] Build Matching workspace with candidate list, split allocation, confirm/reject/ignore/unmatch actions, and source links.
- [ ] Build Bank Adjustments tab with create/submit/approve/void actions according to permissions.
- [ ] Build Reconciliation list/detail/complete/reopen/export workflow.
- [ ] Build Cash Position view.
- [ ] Add empty, loading, error, permission-denied, locked, and validation states.
- [ ] Ensure masked account numbers display by default.
- [ ] Add reason capture for ignore, override, unmatch, reopen, void, and high-risk actions.

### Tests

- Component tests where current setup supports them.
- UI route smoke tests.
- Playwright/e2e flow if repo has e2e setup:
  - create bank account
  - import statement preview/commit
  - match line
  - Accountant completes reconciliation
  - export evidence

### Exit Criteria

- Finance user can perform first-pass banking workflow from web.
- Unauthorized user sees read/blocked states correctly.
- Text fits in dense finance tables on desktop and mobile.
- No LINE/AI mutation path exists.

## Phase 8: Read-Only AI/LINE Hooks

### Goal

Expose banking summaries to AI/LINE without allowing mutations.

### Tasks

- [ ] Add permission-checked read APIs or AI tools for:
  - `banking.cashPosition.read`
  - `banking.unmatchedStatementLines.read`
  - `banking.reconciliationStatus.read`
  - `banking.matchCandidates.read`
  - `banking.bankAccountSummary.read`
- [ ] Register tools in AI Gateway using current tool pattern when item 07 exists.
- [ ] Add source refs and web deep links.
- [ ] Add refusal behavior for import, match, unmatch, complete, reopen, adjustment, payment, and transfer requests.
- [ ] Add LINE response tests or tool tests where current setup supports them.

### Tests

- AI tool contract tests.
- Permission tests for scoped banking summaries.
- Refusal tests for mutation prompts.

### Exit Criteria

- LINE/AI can answer read-only banking questions.
- LINE/AI cannot mutate banking, payment, ledger, tax, or external bank state.
- Responses include source refs and web links.

## Phase 9: Verification, Docs, and Checklist Gate

### Goal

Verify implementation end-to-end and update docs only after code is complete.

### Tasks

- [ ] Run relevant root/package commands discovered in Phase 0.
- [ ] Run contracts typecheck/tests.
- [ ] Run API tests.
- [ ] Run web tests/build.
- [ ] Run Prisma validate/migration checks.
- [ ] Run AI Gateway tests if tools were added.
- [ ] Run e2e/smoke workflow if repo supports it.
- [ ] Confirm audit/outbox events appear in tests or local smoke.
- [ ] Confirm permission-denied cases.
- [ ] Confirm no full bank account number is stored without secret primitive.
- [ ] Update implementation notes with commands and results.
- [ ] Update master checklist item 13 checkbox only after all exit criteria pass.

### Tests

Record exact commands and outcomes in implementation notes or PR description.

### Exit Criteria

- All implemented package checks pass.
- Banking workflow works from API and web.
- JSON/CSV/XLSX/PDF reconciliation evidence export works.
- Read-only AI/LINE hooks work or are explicitly documented as deferred due to missing item 07 primitives.
- Master checklist remains unchecked until implementation verification is complete.

## Risks

- Source payment models may differ across items 08, 09, 12, and 14. Mitigation: create adapters, not duplicate tables.
- Bank CSV/XLSX formats vary widely and public official sample columns may not be available. Mitigation: generic mapping plus KBank/SCB alias presets, actionable unmapped-header errors, and real fixture validation when possible.
- Matching false positives can create bad audit evidence. Mitigation: suggestions are not final until user confirms; store confidence/reason.
- Completed reconciliation can block corrections. Mitigation: reopen flow with permission, reason, and audit.
- Ledger period close can conflict with late bank statement imports. Mitigation: call item 10 period policy before completion or adjustment approval.
- Sensitive bank account data can leak. Mitigation: masked/last4 only until approved secret storage exists.
- Evidence export scope can grow. Mitigation: include JSON/CSV/XLSX/PDF in first pass and keep exporter format contracts shared.

## Open Questions

- Which exact exported headers should replace the alias presets after collecting real KBank and SCB sample files?
- Should bank adjustment approval reuse workflow automation when item 16 exists?

## Implementation Note 2026-07-06 — Web Import/Matching Slice Shipped

Phase 7 tasks "Statement Import preview/commit workflow" and "Matching workspace with candidate list, confirm/ignore/unmatch actions and source links" are DONE (live-verified; see [[agent-memory/banking-reconciliation-13|task memory]]), plus the read side of Phase 4 source adapters:

- Web: นำเข้า statement tab (CSV file or paste-from-Excel/TSV; server-side preview with valid/duplicate/error markers; skip/flag duplicate policy; commit with SHA-256 fileHash; import history + void-with-reason) and จับคู่รายการ tab (open lines, ranked candidates with allocation prefill, confirm/unmatch/ignore-with-reason). XLSX file upload deferred — requires a parser dependency; Excel paste covers the flow.
- API: `GET .../statement-lines` + `GET .../statement-imports` under `bank.statement.read`; `match-candidates` response now includes real `candidates` from `PrismaMatchSourceQuery` (AccountingPayment RECEIVED, ExpenseRecord paid, SupplierPayment, ReimbursementPayment, approved BankAdjustment; confirmed allocations subtracted; fully-matched candidates excluded). Split allocation input, per-line reason capture, and direction/currency filtering included.
- Still open in Phase 7: manual statement line drawer, bank-adjustment-from-line shortcut, evidence export screen. Still open in Phase 4: suggestion persistence (SUGGESTED matches), ledger journal line source.

## Follow-Up Scope 2026-07-06 — PDF/Photo Statement Intake (OCR)

Owner requirement + recorded direction: [[specs/bank-reconciliation-spec|spec]] §20. CSV/XLSX stays canonical; PDF/photo is an additional intake feeding the SAME preview -> human-commit flow.

STATUS 2026-07-06 (same day): IMPLEMENTED and live-verified. See [[agent-memory/banking-reconciliation-13|task memory]] for verification evidence.

- Extraction service in `apps/api` banking module — DONE. `POST .../statement-imports/extract` (permission `bank.statement.import`, bounded by `UPLOAD_MAX_BYTES`, refuse-not-truncate, route-scoped JSON body limit). PDF text layer first via `PdfStatementTextExtractor` + pure `clusterPdfTextRows` (positioned text items → header-alias column mapping → canonical CSV-alias keys; NO AI involved). **Dependency decision recorded: added `pdfjs-dist` to apps/api** — no PDF parser existed anywhere in the monorepo and text-layer extraction of Thai CID-font bank PDFs is not hand-rollable; loaded via native dynamic import (ESM-only package under CJS swc build). Scanned PDFs are refused first-pass with a stable code telling the user to upload page photos instead (avoids the heavy `canvas` render dependency; photos cover scans).
- AI Gateway OCR for photos — DONE. New internal endpoint `POST /internal/ai/bank-statement-extract` (same X-Internal-Secret + two-stage Typhoon-OCR → provider-structuring pipeline as item 09 receipts; fail-closed `not_configured`/`failed`); banking-owned `StatementAiExtractClient` in apps/api (module boundary kept — no line-ai import). Route-scoped 16mb body limit on both internal OCR endpoints (also fixes the latent >750KB receipt image rejection under the global 1mb limit).
- Preview-row mapping + provenance — DONE. Extract returns rows keyed by the SAME canonical aliases the CSV path accepts + per-row `confidence` (1.0 for pdf_text) + `sourceKind`; commit stores whitelisted `{sourceKind, extractionModelId}` into existing `BankStatementImport.mappingJson` (no migration needed).
- Deterministic pre-commit guardrails — DONE. `checkRunningBalanceContinuity` (pure, cent-arithmetic) runs in BOTH extract and the shared preview (CSV benefits too) returning 1-based break row numbers; existing `statementLineHash` dedupe applies unchanged (live-verified: rows committed from a PDF are flagged duplicate on re-extract); commit stays human-only under `bank.statement.import` and auto-skips error rows.
- Web — DONE. Same import screen accepts .pdf/.jpg/.png; provenance banner (pdf_text = "ไม่ใช้ AI", ocr = model id + ตรวจทานก่อนยืนยัน), CSV-preferred nudge copy, low-confidence (<0.8) and balance-break rows highlighted with Thai warnings, Thai error strings for all stable extract error codes.
- Tests — DONE. Domain: clustering (Thai headers, split header items, repeated page-2 headers, no-header scan), balance-chain units; use case: permission/size/scan-reject/OCR-map/confidence-clamp/fail-closed/provenance whitelist; gateway controller: secret, mime, not_configured, two-stage happy path with fake fetch. Plus a runnable hand-written-PDF integration check (scratchpad) proving the pdfjs path end-to-end.
- Remaining for this scope: real Thai bank PDF/photo validation when the owner provides samples (Typhoon key exists in env but external calls were deliberately not exercised); XLSX file upload still needs a parser dependency decision (Excel paste covers it).
