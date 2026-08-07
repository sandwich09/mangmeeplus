# Double-Entry Ledger and Period Closing Plan

## Status

The pre-v5 item 10 baseline is implemented for MVP integration. The 2026-07-31 Feature Entitlement Decoupling v5.1 VAT-close and posted-cash-evidence work added below is owner-confirmed, planned below, and not yet implemented/verified.

Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10.

Implementation note 2026-06-25: API ledger schema/use cases, source posting adapters, close checks, web financial reports workspace, read-only AI ledger summary tool, migration, seed defaults, and focused verification are complete. Actual XLSX/CSV/PDF generation and richer accountant editing screens remain backlog. Full chart bootstrap is now a dedicated compatibility-scoped follow-up under item 10H rather than an unbounded import task.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
- Chart master follow-up: [[specs/chart-of-accounts-master-data-bootstrap-spec|Chart of Accounts Master Data Bootstrap Spec]] and [[plans/chart-of-accounts-master-data-bootstrap-plan|implementation plan]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 10. Double-Entry Ledger and Period Closing
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/platform-environment-config-spec|Platform Environment Config]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/sap-compatible-transaction-tax-account-determination-spec|SAP-Compatible Transaction Tax and Account Determination Spec]] and [[plans/sap-compatible-transaction-tax-account-determination-plan|item 11B plan]]
- Research:
  - [[research/chart-of-accounts-csv-analysis|Chart of Accounts CSV Analysis]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement double-entry accounting after document and expense sources exist, so finance/tax/reporting modules derive from balanced journal lines instead of ad hoc source-document totals.

## Current Repository Context

Current docs direction changed on 2026-06-23:

- Accounting Documents remains the user-facing workflow.
- Double-Entry Ledger moves earlier, directly after Expense and Receipt Upload.
- Thai Tax MVP now follows ledger so tax/report outputs can use ledger-backed accounting where useful.
- Chart-of-accounts CSV analysis exists under `docs/research/chart-of-accounts-csv-analysis.md`.

Before implementation, inspect current code because items 01-09 may add Prisma, auth, data model core, accounting documents, expense upload, and web shell.

Do not duplicate tenant, branch, document sequence, attachment, audit, outbox, request context, permission registry, accounting counterparty, accounting payment, source posting, notification, LINE binding, web-shell, config, or contract code. Extend existing primitives additively.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/double-entry-ledger-closing-spec.md`.
3. Read `docs/specs/accounting-documents-spec.md`.
4. Read `docs/specs/expense-receipt-upload-spec.md`.
5. Read `docs/specs/data-model-core-spec.md`.
6. Read `docs/specs/permission-matrix.md`.
7. Read `docs/specs/auth-authorization-rbac-spec.md`.
8. Read `docs/specs/web-core-workspace-spec.md`.
9. Read `docs/specs/platform-environment-config-spec.md`.
10. Read `docs/specs/tax-thailand-2026-spec.md`.
11. Read `docs/research/chart-of-accounts-csv-analysis.md`.
12. Read `docs/guidelines/backend-hexagonal-code-style.md`.
13. Read `docs/guidelines/web-frontend-code-style.md`.
14. Read `docs/guidelines/security-implementation-guideline.md`.
15. Read `docs/adr/0006-phase-1-platform-stack-defaults.md`.
16. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
17. Start at Phase 0: Reconcile Source Modules.

Do not mark Master Implementation Checklist item 10 complete until Phase 0 through Phase 7 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Ledger is accounting source of truth for GL, Trial Balance, P&L, Balance Sheet, and period close.
- Business users still work from documents first.
- Generated journals must be balanced, idempotent, and locked after posting.
- Corrections use reversal, adjustment, credit note, debit note, or module-approved void flow.
- Do not mutate posted journal lines.
- Do not allow LINE to post, reverse, close, unclose, export, or change chart of accounts.
- Reuse existing Prisma, auth, request-context, audit, outbox, document sequence, contracts, and web navigation patterns when present.
- If Prisma/auth/audit/outbox/document sequence/source modules exist, extend them with additive migrations and module code.
- Use decimal-safe money handling; never use JavaScript floats for debit, credit, tax, or balance calculations.
- Keep `companyId` as the tenant boundary on every ledger-owned record.
- Verify route company selection against active membership and permission server-side.
- Keep controllers thin and use hexagonal backend structure.
- Keep Prisma generated types out of domain models and contracts.
- Keep report queries company-scoped and period/date bounded by default.
- Keep AI Gateway access read-only and permission-checked through ERP APIs/tools, not direct Prisma access.
- Audit sensitive ledger actions with bounded metadata and no full report payloads.
- Add tests for accounting correctness before UI polish.

## Scope

### In Scope

- Chart of accounts model, seed/import path, normalized classes, and account lock policy.
- Accounting period model and period status.
- Journal entry and journal line model.
- Posting rule model and generated posting service.
- Generated journal entries for invoice, receipt/payment, tax invoice, expense, expense payment, and WHT baseline.
- Manual journal draft workflow for FINANCE and create/post/reverse workflow for ACCOUNTANT/OWNER.
- General Ledger and Trial Balance reports.
- P&L and Balance Sheet baseline after report group mapping exists.
- Period close/unclose with checks.
- Audit events and permission keys.
- Outbox events for journal post/reverse and period close/unclose when outbox exists.
- Shared ledger contracts in `packages/contracts`.
- Web API endpoints for chart, journals, reports, and close workflow.
- Web ledger workspace screens that follow item 03 conventions.
- Read-only ledger report tools for AI Gateway.
- Export API routes/contracts for XLSX accountant-review export requests. Actual file generation can return `export_not_implemented` until export infrastructure is implemented.

### Out of Scope

- Payroll postings.
- Fixed asset depreciation engine.
- Manufacturing costing.
- Full multi-currency revaluation.
- Consolidation across companies.
- Bank statement matching details beyond journal/payment hooks.
- Native filing submission to Revenue Department.
- Actual XLSX/CSV/PDF report file generation.
- Accounting-office-specific export templates.
- Manual journal two-step approval.
- Optional OWNER/MFA extra gate for close/unclose.

## First Implementation Defaults

- Chart of accounts source: use `docs/research/chart-of-accounts-csv-analysis.md` first. Do not require the original CSV for Phase 1 seed; curate seed from the analysis note.
- Account code format: `dddd-dd`.
- Starting currency: `THB`.
- Period key: monthly `YYYY-MM`.
- Journal entry number: use Data Model Core document sequence service with `documentType = ledger.journal`.
- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 10 starts.
- Money columns: use existing repo decimal type/pattern; otherwise Prisma `Decimal` with fixed-scale validation in domain logic.
- Source types: use stable strings from item 08/09 source posting contracts, such as `accounting.document`, `accounting.payment`, `expense.record`, and `expense.payment`.
- Manual journal entries start as web-only.
- `9999-99 บัญชีพัก` is controlled suspense and requires close review.
- P&L and Balance Sheet read account class/report group; do not infer from `Group1`.
- Generated posting status writes back to source only through source module adapter/use case, not direct table mutation from ledger infrastructure.

## Phase 0: Reconcile Source Modules

### Goal

Confirm finalized source documents and data primitives are ready for ledger integration.

### Tasks

- [ ] Inspect current Prisma schema and migrations.
- [ ] Inspect Accounting Documents implementation.
- [ ] Inspect Expense/Receipt Upload implementation.
- [ ] Inspect Data Model Core document sequence, branch, audit, and outbox services.
- [ ] Inspect Auth/RBAC permission registry and request context.
- [ ] Inspect Web Core navigation, route, list/detail/form, and forbidden-state patterns.
- [ ] Inspect AI Gateway read-tool conventions from item 07.
- [ ] Confirm source document finalization events and statuses.
- [ ] Confirm source posting input contracts from item 08 and item 09.
- [ ] Confirm source posting status update paths: pending, posted, posting_error, reversed.
- [ ] Confirm permission registry and audit service paths.
- [ ] Confirm current decimal/money convention.
- [ ] Confirm whether export infrastructure exists. Keep export routes/contracts ready either way; if infrastructure is missing, return a typed `export_not_implemented` response and backlog XLSX file generation.
- [ ] Record gaps before coding.

### Tests

- No code tests required unless existing setup changed.

### Exit Criteria

- Implementer knows exact source document hooks for journal generation.
- Implementer knows exact app/module folders and migration path.
- Implementer knows which existing primitives to extend and which missing primitives must be stubbed explicitly.
- No duplicate ledger/accounting schema plan remains unresolved.

## Phase 1: Ledger Schema, Contracts, and Seed

### Goal

Create database and contract foundation for double-entry accounting.

### Tasks

- [ ] Add Prisma models from the spec:
  - `ChartOfAccount`
  - `AccountingPeriod`
  - `JournalEntry`
  - `JournalLine`
  - `PostingRule`
  - `PeriodCloseRun`
- [ ] Add enums for account class, normal balance, journal status/type, period status, and close-run status.
- [ ] Add migration and seed.
- [ ] Curate default Thai SME chart of accounts from the CSV analysis.
- [ ] Normalize source typo `Service expesnes`.
- [ ] Mark `9999-99 บัญชีพัก` as controlled suspense.
- [ ] Add report-group mapping needed by GL/TB/P&L/BS.
- [ ] Seed monthly periods for current fiscal year when company setup allows it; otherwise add period creation use case.
- [ ] Add database indexes and domain validation for journal balance, unique account code, unique entry number, and idempotent source posting.
- [ ] Add ledger permission keys and default role grants.
- [ ] Add shared contracts under `packages/contracts/src/ledger.ts`.
- [ ] Export ledger contracts from `packages/contracts/src/index.ts`.

### Tests

- `pnpm --filter @watchdog-bms/api typecheck`
- `pnpm --filter @watchdog-bms/contracts typecheck`
- Migration applies locally.
- Seed creates chart of accounts, periods, posting-rule placeholders, and permission keys.
- Account code uniqueness works per company.

### Exit Criteria

- Ledger schema exists and can seed cleanly.
- Account classification does not rely on raw `Group1`.
- Contracts compile and do not expose Prisma row types.

## Phase 2: Domain Logic and Posting Engine

### Goal

Build pure accounting logic before HTTP/UI.

### Tasks

- [ ] Add domain models and ports for accounts, periods, journals, posting rules, and reports.
- [ ] Add journal balance validation.
- [ ] Add account normal-balance helpers.
- [ ] Add source-to-journal posting service.
- [ ] Add idempotency by source type/id.
- [ ] Add reversal logic.
- [ ] Add close-check logic.
- [ ] Keep pure logic free of NestJS/Prisma imports.

### Tests

- Balanced journal passes.
- Unbalanced journal fails.
- One line cannot have both debit and credit.
- Reversal produces opposite lines.
- Duplicate source posting returns existing generated journal.
- Close check fails for draft journals, missing postings, suspense balance, or unbalanced trial balance.

### Exit Criteria

- Accounting correctness rules are tested without database dependency.

## Phase 3: Repositories, Generated Journals, and Audit

### Goal

Persist generated and manual journal entries safely.

### Tasks

- [ ] Implement Prisma mappers/repositories.
- [ ] Implement generated journal use cases for supported source document types.
- [ ] Implement manual journal create/post/reverse use cases.
- [ ] Use Data Model Core sequence service for `ledger.journal` numbering.
- [ ] Enforce open-period checks.
- [ ] Write audit logs for account, posting rule, journal, and period actions.
- [ ] Append outbox events for posted/reversed journals and period close/unclose.

### Tests

- Invoice generated journal posts balanced lines.
- Payment journal clears receivable.
- Expense journal handles VAT/WHT baseline.
- Posted journal cannot edit lines.
- Account code change is blocked after first journal line.
- Period closed blocks posting.
- Audit records include totals and source refs without full exports.

### Exit Criteria

- Source document finalization can create locked, balanced, auditable journal entries.

## Phase 4: Ledger APIs

### Goal

Expose permission-protected web APIs for accounts, journals, reports, and periods.

### Tasks

- [ ] Add controllers for chart of accounts.
- [ ] Add controllers for journal list/detail/manual/post/reverse.
- [ ] Add report endpoints:
  - General Ledger
  - Trial Balance
  - Profit and Loss
  - Balance Sheet
- [ ] Add report export API route/contract for XLSX requests with `ledger.export` permission and audited access.
- [ ] Add period endpoints:
  - list periods
  - run close checks
  - close period
  - unclose period
- [ ] Add the read-only `LedgerCashEvidenceReader.getPostedCashJournalLineEvidence` adapter for Feature Entitlement Decoupling v5. Return only an exact full POSTED, unreversed company-owned Cash/Bank line with immutable content hash, account, direction, currency and amount; reject partial, reused, reversed, non-cash or mutable evidence. The Tax-owned allocation remains the global-use authority, and releasing a consumed line requires its linked reversal/supersession plus projection reversal/current-open correction.
- [ ] Extend close checks for Feature Entitlement Decoupling v5: with Ledger enabled, group/block only CURRENT Ledger-owned effective-period VAT source/opening/settlement/external-scope-transition/refund/payment projection heads (including `VatClaimLedgerProjection` and `TaxLedgerProjection`) in PENDING/READY/NEEDS_REVIEW and accept only POSTED/SATISFIED. Ignore a Tax projection pending solely because Tax is off. Tax-only is unaffected; enable-after-closed history routes current-open correction/backfill.
- [ ] Enforce ledger permission keys.
- [ ] Apply tenant and branch scope policy where relevant.
- [ ] Ensure export endpoints are audited.

### Tests

- Missing auth returns `401`.
- Missing ledger permission returns `403`.
- GL report is company-scoped.
- Trial Balance debit total equals credit total.
- P&L excludes balance-sheet accounts.
- Balance Sheet excludes P&L accounts except retained earnings/current profit mapping policy.
- Close endpoint blocks when checks fail.
- Posted-cash evidence accepts one exact eligible full line, hashes immutable facts, rejects partial/reused/reversed/non-cash lines, and cannot be released by an ordinary journal edit or unlink.
- VAT close fixtures cover every Ledger projection class/status, Ledger ON + Tax OFF with Tax projection PENDING/Ledger projection POSTED, Tax-only, and Ledger enable after an already-closed period without reopen/re-entry.
- Unclose requires note and permission.

### Exit Criteria

- Web can build ledger screens without bypassing use cases.

## Phase 5: Web Workspace Integration

### Goal

Add accountant-friendly ledger UI surfaces.

### Tasks

- [ ] Add Accounting > Ledger navigation entry if Web Core registry exists.
- [ ] Add chart of accounts list/detail/edit screens.
- [ ] Add journal list/detail screens.
- [ ] Add manual journal form for authorized users.
- [ ] Add GL and Trial Balance report screens.
- [ ] Add P&L and Balance Sheet baseline screens.
- [ ] Add period close checklist screen.
- [ ] Add forbidden/readonly states for non-accountant users.
- [ ] Link source document records from generated journal details.

### Tests

- Typecheck web.
- Permission-filtered nav hides mutation actions.
- Journal detail shows balanced totals.
- Close checklist shows failed checks with fix links.

### Exit Criteria

- Accountant can review accounting state in web without database access.

## Phase 6: AI/LINE Read Tools

### Goal

Let LINE AI answer accounting summaries from ledger safely.

### Tasks

- [ ] Add read-only ERP ledger tools for AI Gateway.
- [ ] Require `ledger.report.read` or narrower report permission.
- [ ] Return source refs and web links.
- [ ] Block all ledger final mutations from AI Gateway.
- [ ] Audit sensitive AI ledger report access.

### Tests

- AI tool without permission returns `403`.
- AI cannot post/reverse/close/unclose.
- Ledger summary includes source refs.
- Cross-company ledger read is denied.

### Exit Criteria

- AI CFO/accounting summaries can use ledger-backed reports safely.

## Phase 7: Verification and Handoff

### Goal

Prove ledger is ready for Thai Tax MVP and reporting modules.

### Tasks

- [ ] Run all required commands.
- [ ] Verify seed chart and account class mapping.
- [ ] Verify generated postings for invoice/payment/expense/WHT flows.
- [ ] Verify GL/TB/P&L/BS report consistency.
- [ ] Verify close/unclose audit.
- [ ] Update checklist item 10 only after verification.

### Tests

- `pnpm --filter @watchdog-bms/api typecheck`
- `pnpm --filter @watchdog-bms/api test`
- `pnpm --filter @watchdog-bms/contracts typecheck`
- `pnpm --filter @watchdog-bms/web typecheck`
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`
- `pnpm test`

### Exit Criteria

- Ledger can support Thai Tax MVP, reports, accountant review, and period close.
- Verification commands pass or failures are documented with concrete reasons.
- Implementation summary includes files changed, migrations, seed behavior, tests run, skipped commands, and known follow-ups.

## Review Checklist

- [ ] Journal entries cannot be posted unless total debit equals total credit.
- [ ] Each line has exactly one positive side: debit or credit.
- [ ] Posted journal lines are immutable from user routes.
- [ ] Generated posting is idempotent by company, source type, source id, and entry type.
- [ ] Reversal creates a new entry and links to the original.
- [ ] Period close blocks source mutation and journal posting in the closed period.
- [ ] Ledger-on period close blocks unresolved Ledger-owned effective-period VAT projections but never waits for a Tax projection solely because Tax is off; Tax-only and already-closed enable-later history follow the spec exceptions.
- [ ] Posted-cash evidence is immutable, exact-full-line and single-use; tax-linked release requires the matching reversal/current-open correction.
- [ ] Unclose requires permission, note, and high-risk audit.
- [ ] Chart account code changes are blocked after first journal-line reference.
- [ ] Account class/report group mapping is explicit and tested.
- [ ] GL/TB/P&L/BS read journal lines, not raw source documents.
- [ ] Trial Balance debit and credit totals match.
- [ ] Suspense account balance appears in close checks.
- [ ] Source posting errors are actionable and redacted.
- [ ] Server enforces company, permission, and branch scope.
- [x] H-03 remediation: manual-journal create/post re-resolve active posting accounts and active company branches, enforce branch ABAC, keep provenance/tax/report fields server-owned, and add database tenant/coherence constraints. Verified with focused negative/reconciliation tests, full API regression, typechecks, Prisma validation, clean 67-migration deploy, and database constraint probes.
- [ ] Web routes do not bypass server permissions.
- [ ] AI Gateway exposes read-only report tools only.
- [ ] LINE/AI cannot post, reverse, close, unclose, export, or edit accounts.
- [ ] Audit/outbox payloads are bounded and omit full report exports.
- [ ] Decimal/money logic is covered by unit tests.
- [ ] No payroll, fixed-asset, manufacturing, bank-reconciliation, marketplace settlement, actual XLSX/CSV/PDF file generation, or accounting-office template code lands in first pass.

## Definition of Done

- Phase 0 through Phase 7 exit criteria are complete.
- Chart of accounts, accounting periods, journals, journal lines, posting rules, close runs, permissions, contracts, and seed behavior are implemented.
- Finalized invoice/payment/expense/WHT-supported sources generate balanced, locked, idempotent journal entries.
- Manual journal draft/post/reverse workflow enforces permissions and period status.
- GL, Trial Balance, P&L, and Balance Sheet derive from ledger lines and account mapping.
- Period close and unclose enforce checks, audit, and mutation boundaries.
- Web ledger workspace lets authorized users review accounts, journals, reports, and close state.
- AI/LINE ledger access is read-only, permission-checked, cited with source refs, and audited when sensitive.
- Tests cover domain accounting rules, posting idempotency, repositories/use cases, permissions, reports, close checks, source integration, and AI read-tool denial paths.
- Verification commands and results are recorded in implementation summary.

## Required Commands

Run after each phase when relevant:

```sh
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm test
pnpm security:audit
```

Database phases also run migration, generate, and seed commands added by implementation.

## First Handoff Prompt for Sonnet 4.6

Use this exact scope for the first implementation turn:

```text
Implement Master Implementation Checklist item 10: Double-Entry Ledger and Period Closing.

Read:
- docs/plans/master-implementation-checklist.md
- docs/specs/double-entry-ledger-closing-spec.md
- docs/plans/double-entry-ledger-closing-plan.md
- docs/specs/accounting-documents-spec.md
- docs/specs/expense-receipt-upload-spec.md
- docs/specs/data-model-core-spec.md
- docs/specs/permission-matrix.md
- docs/specs/auth-authorization-rbac-spec.md
- docs/specs/web-core-workspace-spec.md
- docs/specs/platform-environment-config-spec.md
- docs/specs/tax-thailand-2026-spec.md
- docs/research/chart-of-accounts-csv-analysis.md
- docs/guidelines/backend-hexagonal-code-style.md
- docs/guidelines/web-frontend-code-style.md
- docs/guidelines/security-implementation-guideline.md
- docs/adr/0006-phase-1-platform-stack-defaults.md

Implement:
- Phase 0: Reconcile Source Modules
- Phase 1: Ledger Schema, Contracts, and Seed

Inspect current repo state first. If Prisma/auth/audit/outbox/document sequence/source posting/web shell already exists, extend it. If schema, route, permission, source contract, report mapping, or UI conflicts appear, stop and report them before coding.

Keep Master Implementation Checklist item 10 unchecked until all phases and verification pass.

Do not implement tax filing, bank reconciliation, payroll, fixed assets, manufacturing, marketplace settlement, manual-journal two-step approval, actual XLSX/CSV/PDF file generation, accounting-office-specific export templates, or optional OWNER/MFA close gate in this first pass. Add export API routes/contracts only.
```

## Risks

- Ledger postings can be wrong even when source documents look correct. Mitigation: tested posting rules and accountant review.
- Chart of accounts analysis has rough labels and typo. Mitigation: curate seed from `docs/research/chart-of-accounts-csv-analysis.md` and keep source-derived fields.
- Period close can block legitimate fixes. Mitigation: unclose policy with audit and notes.
- Reports can drift if they read documents directly. Mitigation: GL/TB/P&L/BS derive from journal lines only.

## Resolved Owner Decisions

- Manual journals: MVP allows ACCOUNTANT to create and post. FINANCE can create draft only if permission grants it. Two-step approval is deferred before beta.
- Period close: ACCOUNTANT can close. OWNER can close and unclose. Unclose requires note and high-risk audit.
- Export format: create XLSX export API/contract first. Actual XLSX file generation is backlog after ledger reports stabilize. CSV follows XLSX. PDF later.

## Ledger Backlog Not in First Pass

- Manual journal two-step approval before beta.
- XLSX report file generation behind the export API.
- CSV export for accounting-office import workflows.
- PDF financial statement export.
- Accounting-office-specific export templates.
- Optional OWNER/MFA extra gate for close/unclose before beta.

## Open Questions

- None for item 10 docs handoff.
