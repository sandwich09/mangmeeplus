# Accounting Documents MVP Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 08.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Specs

- Spec: [[specs/accounting-documents-spec|Accounting Documents Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 08. Accounting Documents MVP
- Related specs:
  - [[specs/accounting-product-benchmark|Accounting Product Benchmark]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the first SME accounting document slice for WatchDog-BMS:

- Minimal accounting counterparty/customer master required for sales documents.
- Quotation, invoice or billing note, receipt, tax invoice, and payment records.
- Draft, quotation approval, issue/finalize, void/correction, payment status, and audit trail.
- Document conversion without duplicate keying.
- Full credit note and debit note workflows for issued document corrections.
- Web accounting workspace for finance and sales users.
- Ledger-ready finalized source documents for item 10.
- Tax-ready source details for item 11.

This plan should give Sonnet 4.6 enough detail to implement without reopening product, ledger, tax, security, or web ownership decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through item 03.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.
- No Prisma schema exists in the original snapshot, but items 01 through 07 may add Prisma, auth, audit, outbox, request context, web workspace, inventory, dashboard, notification, and LINE modules before item 08 starts.

Before implementation, inspect latest code again. Extend existing primitives. Do not duplicate tenant, branch, document sequence, attachment, audit, outbox, inventory, notification, LINE, web-shell, config, or contract code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/accounting-documents-spec.md`.
3. Read `docs/specs/accounting-product-benchmark.md`.
4. Read `docs/specs/double-entry-ledger-closing-spec.md`.
5. Read `docs/specs/permission-matrix.md`.
6. Read `docs/specs/data-model-core-spec.md`.
7. Read `docs/specs/auth-authorization-rbac-spec.md`.
8. Read `docs/specs/web-core-workspace-spec.md`.
9. Read `docs/specs/tax-thailand-2026-spec.md`.
10. Read `docs/guidelines/backend-hexagonal-code-style.md`.
11. Read `docs/guidelines/web-frontend-code-style.md`.
12. Read `docs/guidelines/security-implementation-guideline.md`.
13. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
14. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 08 complete until Phase 0 through Phase 8 exit criteria pass and verification commands are recorded.

## Core Rule

Implement web document workflows first, but make every finalized accounting-relevant source ledger-ready from day one.

Item 08 does not implement full ledger UI, chart of accounts, journal posting, trial balance, P&L, balance sheet, period close, OCR upload, expenses, bank reconciliation, procurement, or tax filing. It must expose deterministic posting inputs and lifecycle events so item 10 can generate balanced journal entries without refactoring document tables.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 07.
- If Prisma is missing, add it under `apps/api` following ADR 0006 and existing package conventions.
- If Prisma/auth/audit/outbox/document sequences already exist, extend them with additive migrations and module code.
- Do not duplicate `Company`, `Branch`, `CompanyMembership`, `AttachmentObject`, `AttachmentLink`, `DocumentSequence`, `AuditLog`, `OutboxEvent`, request context, inventory product, dashboard, notification, LINE binding, or AI Gateway modules.
- Use Data Model Core document sequence reservation/commit for issued document numbers. Drafts may use temporary ids; official numbers are assigned only when issuing/finalizing.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money and quantity handling. Do not calculate money with JavaScript floating-point math.
- Store `THB` as MVP default currency. Keep currency field explicit for later multi-currency support.
- Keep draft documents editable until issue. After issue, money, tax, counterparty, and line fields are locked except through approved correction flows.
- Do not hard-delete accounting documents, lines, payments, tax invoices, or posting state from user flows.
- Use void, full credit note, full debit note, or reversal-ready event for corrections. Silent mutation of issued/tax documents is forbidden.
- Payment records can support partial payment and allocation to one or more invoices, but first UI may optimize for one payment against one invoice.
- Overpayment must not be rejected by default. Record unapplied customer credit when payment amount exceeds allocated invoice amount.
- Sales can create quotation drafts and request quotation issue, but quotation issue requires approval before becoming final. Sales cannot self-approve quotation issue.
- Tax invoice fields must remain auditable. Issued tax invoice void/correction is high-risk and requires dedicated permission plus audit.
- Set `postingStatus` to `not_required` for non-accounting drafts and quotations, `pending` for finalized accounting-relevant sources, and later item 10 may set `posted`, `posting_error`, or `reversed`.
- Do not generate ledger journals in item 08. Only expose source posting input and emit lifecycle events.
- Emit outbox events for issue/finalize, payment record, void, credit note, debit note, and posting-state changes when outbox exists.
- Audit issue, void, credit note, debit note, tax invoice issue/void, and payment create/update/void.
- Enforce tenant, permission, branch scope, and record policy on the server. Web checks are UX only.
- Web is the only mutation surface for item 08. LINE and AI may read summaries later only through permission-checked APIs; no final accounting mutation from LINE.
- Web deep links must re-check current permission and record state.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared accounting document contracts in `packages/contracts`.
- Accounting document permission keys and default role grants.
- Prisma schema/migration/seed for accounting document models if Prisma exists or is added.
- Minimal accounting counterparty/customer master needed for documents before CRM item 15.
- API accounting module using hexagonal folder structure.
- Quotation, invoice, billing note, receipt, tax invoice, payment, and payment allocation use cases.
- Document conversion: quotation to invoice or billing note without duplicate keying.
- Draft, quotation approval, issue/finalize, void/correction, credit note, debit note, payment status, tax status, and posting status.
- Ledger-ready source document query/contract for item 10.
- Bounded outbox event payloads for accounting document lifecycle.
- Audit integration for sensitive accounting actions.
- Web accounting feature folder with list/detail/form/issue/payment views.
- Tests for contracts, domain totals, use cases, permissions, API behavior, outbox/audit payloads, and UI logic where current test setup supports them.

### Out of Scope

- General Ledger, Trial Balance, P&L, Balance Sheet, journal entry UI, posting rules, and period close. Item 10 owns them.
- OCR/AI receipt upload, document capture, expense review queue, and expense OCR draft flow. Item 09 owns them.
- Final tax report generation/export and filing calendars. Item 11 owns them.
- Bank account master and bank reconciliation. Item 13 owns them.
- Procurement, supplier AP, purchase orders, vendor bills, and goods receipt workflow. Item 12 owns them.
- Full CRM pipeline, lead/opportunity/follow-up workflow, customer segmentation, and sales activity. Item 15 owns them.
- Payroll, fixed assets, manufacturing, marketplace integration, and public developer API.
- LINE accounting mutation, AI final mutation, or autonomous accounting treatment.
- Production infrastructure provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 08 starts.
- Currency: `THB`.
- Document sequence keys:
  - `accounting.quotation`
  - `accounting.invoice`
  - `accounting.billing_note`
  - `accounting.receipt`
  - `tax.invoice`
  - `accounting.payment`
  - `accounting.credit_note`
  - `accounting.debit_note`
- Default issue sequence patterns should reuse Data Model Core defaults where present. If missing, seed conservative monthly patterns matching Data Model Core style.
- Document statuses: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `ISSUED`, `VOIDED`, `CREDITED`, `DEBITED`, `CLOSED`.
- Payment status on receivable documents: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOIDED`.
- Posting status: `not_required`, `pending`, `posted`, `posting_error`, `reversed`.
- Tax invoice type: `FULL`, `ABBREVIATED`.
- VAT mode: `NO_VAT`, `VAT_INCLUDED`, `VAT_EXCLUDED`, `EXEMPT`.
- Payment direction: `RECEIVED`, `PAID`. Item 08 UI focuses on `RECEIVED`; `PAID` stays as ledger-ready hook for later expense/AP flows.
- Payment method: `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER`.
- Overpayment handling: store unapplied customer credit on payment when received amount exceeds allocated invoice amount.
- Quotation approval default: Sales may create and submit quotation issue request; Manager or Finance approves; Sales may issue only after approval.
- Counterparty type: `CUSTOMER`, `VENDOR`, `BOTH`. Item 08 UI focuses on customers; vendor support stays minimal for future expense/AP links.
- Counterparty snapshot is copied to each issued document so later counterparty profile edits do not rewrite historical evidence.
- Date handling: store business dates as date-only fields where appropriate, and audit timestamps as server timestamps.
- Branch: optional on draft, required on issued documents when the company has branch scope or tax branch policy configured.
- Product reference on document lines is optional. Preserve item description, unit, quantity, price, discount, VAT, WHT, and total fields even when product master changes later.

## Required Ledger-Ready Outputs

Finalized source documents must expose:

- `companyId`
- `branchId` when applicable
- `sourceType`
- `sourceId`
- `documentType`
- `documentId`
- `documentNumber`
- `documentDate`
- `counterpartyId` when available
- `counterpartySnapshot`
- `currency`
- line-level quantity, unit price, discount, VAT, WHT, taxable amount, and total fields
- document-level subtotal, discount, taxable amount, VAT total, WHT total, grand total, paid total, and outstanding total
- payment direction, method, amount, paid date, bank account reference, payment allocation, and unapplied credit amount where applicable
- tax invoice type, tax invoice number, and tax invoice reference where applicable
- source lifecycle event such as issued, paid, voided, credited, debited, or reversed
- `postingStatus`: `not_required`, `pending`, `posted`, `posting_error`, or `reversed`
- `postingError` only when item 10 or a repair job writes one; keep redacted and actionable
- stable idempotency key for item 10 posting generation

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/web/package.json`, `apps/web/app`, `apps/web/src/common`, and `apps/web/src/features`.
- [ ] Inspect `apps/workers/src` for outbox worker conventions.
- [ ] Inspect `packages/contracts/src` and current export pattern.
- [ ] Inspect `packages/config/src` for feature flag/env patterns.
- [ ] Identify existing request context, auth guard, permission decorator, audit, outbox, document sequence, branch, attachment, and storage primitives.
- [ ] Identify current route naming and web navigation conventions from item 03.
- [ ] Identify existing inventory product contracts from item 05 for optional document line product references.
- [ ] Identify item 07 LINE/AI extension points, but do not add accounting mutation.
- [ ] Record any schema, route, package, or UI conflicts before coding.

### Exit Criteria

- Implementation summary states which existing primitives will be reused.
- No duplicate shared module is planned.
- Exact first source paths for contracts, API module, web feature, and tests are known.

## Phase 1: Contracts, Permissions, and Domain Rules

### Goal

Define stable accounting document contracts and business rules before persistence/API code.

### Tasks

- [ ] Add accounting document enums and DTO types in `packages/contracts` or existing contract location.
- [ ] Add money, tax, line, counterparty snapshot, quotation approval, payment, unapplied credit, posting state, credit/debit note, and source posting input types.
- [ ] Add list/detail filter and pagination contract types.
- [ ] Add accounting permission keys from the spec and permission matrix.
- [ ] Seed or map role grants using existing RBAC seed conventions.
- [ ] Implement pure domain logic for line totals, VAT mode, WHT amount handling, quotation approval, payment status, unapplied credit, document status transition validation, and posting-status decision.
- [ ] Add domain tests for totals, quotation approval, payment status, overpayment/unapplied credit, issue lock behavior, void/correction policy, and invalid transitions.

### Exit Criteria

- Contracts compile and are exported through existing package pattern.
- Permission keys are documented and ready for auth seed/migration.
- Domain tests cover money/tax calculations without database dependency.

## Phase 2: Persistence Models and Migrations

### Goal

Persist accounting source documents with audit/ledger/tax-ready fields.

### Tasks

- [ ] Add or extend Prisma schema for `AccountingCounterparty`, `AccountingDocument`, `AccountingDocumentLine`, `AccountingPayment`, `AccountingPaymentAllocation`, approval fields, unapplied credit fields, credit/debit note links, and posting-state fields or table.
- [ ] Add unique constraints for company-scoped issued document numbers.
- [ ] Add indexes for company, branch, document type, status, document date, counterparty, payment status, tax status, and posting status.
- [ ] Add counterparty snapshot JSON on issued documents.
- [ ] Add line-level tax and total fields.
- [ ] Add immutable issued metadata fields: issuedByUserId, issuedAt, voidedByUserId, voidedAt, voidReason.
- [ ] Add approval metadata fields: submittedForApprovalByUserId, submittedForApprovalAt, approvedByUserId, approvedAt, rejectedByUserId, rejectedAt, approvalNote.
- [ ] Add conversion/source fields such as sourceDocumentId, sourceDocumentType, and convertedFromDocumentId where useful.
- [ ] Add migration and seed document sequences if Data Model Core did not already seed the required keys.
- [ ] Add repository ports and Prisma repositories.
- [ ] Add persistence tests for uniqueness, indexes that are easy to assert, issued lock fields, and payment allocation constraints.

### Exit Criteria

- Schema supports all MVP source document flows without waiting for CRM, ledger, tax, expense upload, or bank reconciliation.
- Official document numbers cannot duplicate within a company/document type.
- Drafts remain separable from issued accounting evidence.

## Phase 3: API Use Cases and Controllers

### Goal

Implement web-owned accounting document workflows behind permission-checked API routes.

### Tasks

- [ ] Add accounting API module using existing hexagonal layout.
- [ ] Implement counterparty create/update/list/get use cases.
- [ ] Implement document create/update/list/get use cases for quotation, invoice, billing note, receipt, and tax invoice.
- [ ] Implement quotation submit/approve/reject use cases. Sales can submit and issue only after approval; Manager/Finance approve.
- [ ] Implement quotation conversion to invoice or billing note.
- [ ] Implement issue/finalize use cases with document sequence reservation/commit.
- [ ] Implement void/cancel use cases with reason, permission, status checks, and audit.
- [ ] Implement payment create/update/list/get and allocation to invoice.
- [ ] Implement overpayment handling that stores unapplied customer credit instead of rejecting by default.
- [ ] Implement receipt issue from payment or invoice payment flow.
- [ ] Implement tax invoice issue from invoice/receipt flow.
- [ ] Implement credit note and debit note create/issue/list/get workflows for issued document corrections.
- [ ] Add closed-period policy hook. If item 10 period table does not exist yet, keep an adapter that returns open period and a TODO-backed interface for item 10 to enforce later.
- [ ] Add server-side permission and tenant/branch checks to every route.
- [ ] Add API/controller tests for auth, permission denial, cross-company hiding, issue, conversion, payment, tax invoice, and void behavior.

### Exit Criteria

- Finance can create, issue, view, and void supported documents through API.
- Sales can create quotation drafts, submit for approval, and issue only after approval.
- Server rejects unauthorized document issue, payment mutation, tax invoice issue/void, and cross-company access.

## Phase 4: Ledger-Ready Source Events and Posting State

### Goal

Prepare item 10 ledger posting without generating journals in item 08.

### Tasks

- [ ] Implement source posting input query or application service for finalized documents and payments.
- [ ] Add idempotency keys for lifecycle events and future posting generation.
- [ ] Set posting status to `pending` on finalized accounting-relevant documents and `not_required` on quotations/drafts.
- [ ] Emit bounded outbox events when issue, approval, payment, receipt, tax invoice, void, credit/debit note, unapplied credit, or posting-state change occurs.
- [ ] Ensure outbox payloads include ids, document number, totals, event type, and idempotency key only. Do not include raw full document body, secrets, tokens, or files.
- [ ] Add tests for source posting input completeness, event idempotency, and redaction.
- [ ] Document item 10 integration point in module README or implementation summary.

### Exit Criteria

- Finalized invoice, payment, receipt, and tax invoice records expose complete posting inputs.
- Item 10 can generate journals from source ids without reading UI-only data.
- No ledger journal tables, posting rules, or GL reports are implemented in item 08.

## Phase 5: Web Accounting Workspace

### Goal

Give finance/sales users usable web document workflows within the shared workspace.

### Tasks

- [ ] Add Accounting navigation entries using item 03 route registry/shell conventions.
- [ ] Add accounting feature folder with API client, model, logic, constants, components, and CSS modules following web guideline.
- [ ] Add document list with filters for type, status, date range, counterparty, payment status, and posting status.
- [ ] Add document detail page showing lines, totals, lifecycle, payment status, tax invoice status, posting status, audit summary link where available, and future ledger link placeholder.
- [ ] Add create/edit forms for quotation and invoice/billing note.
- [ ] Add quotation submit/approval/rejection UI with role-aware actions.
- [ ] Add issue/finalize action with confirmation and validation errors.
- [ ] Add convert quotation action.
- [ ] Add payment recording and allocation UI.
- [ ] Add receipt/tax invoice issue flow where source state allows it.
- [ ] Add credit note and debit note full UI for eligible issued documents.
- [ ] Add void action with reason input and high-risk copy.
- [ ] Add loading, empty, error, forbidden, and locked states.
- [ ] Keep UI dense and finance-friendly. Do not build marketing landing pages.
- [ ] Add UI logic/unit tests where current setup supports them.
- [ ] Run responsive smoke check for desktop and mobile widths if browser tooling exists.

### Exit Criteria

- Finance can manage MVP accounting documents in web.
- Sales can create, submit, issue after approval, and track quotations without seeing unauthorized finance actions.
- Issued/voided/paid/posting states are clear and cannot resize or overlap important controls.

## Phase 6: Audit, Security, Tax, and Closed-State Guards

### Goal

Protect accounting evidence and leave explicit hooks for tax and period close.

### Tasks

- [ ] Audit successful and denied quotation approval, issue, void, tax invoice issue/void, payment create/update/void, credit note, and debit note actions.
- [ ] Redact audit metadata to ids, document numbers, totals, status changes, hashes, and reason text. Do not store raw full document payloads.
- [ ] Enforce high-risk permission checks for issued tax invoice void/correction.
- [ ] Add tax-ready fields and report-line candidate query for item 11 without building tax reports.
- [ ] Add period-locked mutation check through an interface that item 10 can later implement.
- [ ] Confirm no delete route exists for issued accounting evidence.
- [ ] Confirm LINE/AI cannot perform final accounting mutations.
- [ ] Add security tests for tenant isolation, permission denial, audit redaction, and blocked closed-state mutation where current infrastructure allows.

### Exit Criteria

- Sensitive accounting actions are audited.
- Issued documents cannot be silently mutated or deleted.
- Tax and period-close integration points are explicit and tested at boundary level.

## Phase 7: Integration Tests, Seeds, and Operational Handoff

### Goal

Prove end-to-end document flow and make implementation maintainable.

### Tasks

- [ ] Add seed data for document sequences and minimal accounting sample data when seed conventions exist.
- [ ] Add end-to-end or integration tests for quotation submit -> approval -> issue -> invoice -> payment -> receipt -> tax invoice.
- [ ] Add tests for partial payment and payment status calculation.
- [ ] Add tests for overpayment creating unapplied customer credit.
- [ ] Add tests for issue lock and void/reversal-ready event.
- [ ] Add tests for credit note and debit note workflows.
- [ ] Add tests for document number concurrency if current DB/test setup supports it.
- [ ] Add tests for source posting input completeness.
- [ ] Add module README or implementation notes covering source paths, key decisions, and item 10 handoff.
- [ ] Run verification commands.
- [ ] Record verification commands and results in implementation summary.

### Exit Criteria

- Core document workflow passes through API and web logic.
- Tests cover highest-risk money, permission, audit, event, and status behavior.
- Implementation summary tells item 10 where to read source posting inputs.

## Phase 8: Verification, Checklist Update, and Handoff

### Goal

Close item 08 only after implementation and verification are complete.

### Tasks

- [ ] Confirm all Phase 0 through Phase 7 exit criteria are complete.
- [ ] Confirm item 09 can add receipt upload/expense capture without changing item 08 source contracts.
- [ ] Confirm item 10 can generate ledger postings from finalized sources, credit/debit notes, and unapplied customer credit without document-table refactor.
- [ ] Confirm item 11 can read tax-ready source details without relying on ledger reports.
- [ ] Confirm item 15 CRM can later link to or expand accounting counterparties without breaking issued document snapshots.
- [ ] Run final verification commands.
- [ ] Record skipped commands with concrete reasons.
- [ ] Update Master Implementation Checklist item 08 only after implementation and verification pass.

### Verification Commands

Use exact commands available in the repo after implementation. Expected baseline commands:

```text
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/contracts test
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/api test
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/web test
pnpm typecheck
pnpm test
```

If Prisma is added or changed, also run current repo equivalents of:

```text
pnpm --filter @watchdog-bms/api prisma validate
pnpm --filter @watchdog-bms/api prisma generate
pnpm --filter @watchdog-bms/api prisma migrate dev --name accounting_documents_mvp
```

If web implementation needs runtime verification, start the dev server and verify accounting routes in browser at desktop and mobile widths.

### Exit Criteria

- Verification commands pass or failures are documented with concrete reasons.
- Implementation summary includes files changed, migrations, seed behavior, tests run, and known follow-ups.
- Master Implementation Checklist item 08 remains unchecked until all implementation work is actually complete.

## Review Checklist

### H-05 remediation evidence (2026-07-18)

- [x] Concrete document/payment DTOs provide runtime metadata for nested money inputs and reject unknown fields.
- [x] One shared Decimal-based business guard covers sign, THB precision, schema bound, rates, direction, allocation target state, currency, counterparty, and outstanding balance.
- [x] Payment/document use cases revalidate before persistence; overpayment is retained as unapplied credit.
- [x] Focused boundary/business tests cover negative, zero, NaN, infinity, exponent, precision overflow, bound overflow, overpayment, and invalid target state.

- [ ] Draft documents do not reserve official issued numbers unless existing sequence design requires reservation.
- [ ] Issued document numbers are unique per company and document type.
- [ ] Document sequence reservation and issue happen transactionally where repository support exists.
- [ ] Drafts are editable; issued money/tax fields are locked.
- [ ] Issued/tax documents cannot be hard-deleted through user routes.
- [ ] Corrections use void, full credit note, full debit note, or reversal-ready event.
- [ ] Counterparty snapshot is stored on issued documents.
- [ ] Line totals and document totals are decimal-safe.
- [ ] VAT mode and WHT fields are explicit and test-covered.
- [ ] Payment allocations update payment status correctly.
- [ ] Partial payment is supported at API/domain level.
- [ ] Overpayment creates unapplied customer credit and is ledger-ready.
- [ ] Sales quotation issue requires approval and cannot be self-approved by Sales.
- [ ] Credit note and debit note UI/workflows are implemented.
- [ ] Tax invoice issue/void is audited as high-risk.
- [ ] Posting status is visible and set correctly.
- [ ] Source posting input is deterministic and complete.
- [ ] Outbox events are bounded, redacted, and idempotent.
- [ ] Server enforces tenant, permission, and branch scope.
- [ ] Web routes do not bypass server permissions.
- [ ] Web feature code follows shared folder and CSS module conventions.
- [ ] UI shows locked, forbidden, empty, loading, and error states.
- [ ] AI Gateway does not import or use API Prisma client/accounting repositories directly.
- [ ] No LINE or AI final accounting mutation exists.
- [ ] No GL, journal posting, trial balance, P&L, balance sheet, or period close UI exists in item 08.

## Definition of Done

- Phase 0 through Phase 8 exit criteria are complete.
- Accounting counterparty, quotation approval, invoice/billing note, receipt, tax invoice, payment, unapplied credit, credit note, debit note, and allocation behavior is implemented.
- Finance can manage MVP accounting documents on web.
- Sales can create quotation flow and issue only after approval according to permissions.
- Issued documents are locked, audited, and correction-ready.
- Payments update receivable document status correctly.
- Finalized accounting-relevant records are tax/audit/ledger-posting ready.
- Item 10 can consume deterministic source posting inputs and lifecycle events.
- Tests cover money, status, permission, audit, outbox, and source posting boundaries.
- Verification commands and results are recorded in implementation summary.

## First Handoff Prompt for Sonnet 4.6

```text
Implement Master Implementation Checklist item 08: Accounting Documents MVP.

Start with docs/plans/accounting-documents-mvp-plan.md Phase 0 and Phase 1 only. Read docs/specs/accounting-documents-spec.md, accounting product benchmark, double-entry ledger spec, permission matrix, data model core spec, auth/RBAC spec, web core spec, Thai tax spec, backend/frontend/security guidelines, and ADR 0006 before editing.

Inspect current repo state first. If Prisma/auth/audit/outbox/document sequence/web shell already exists, extend it. If schema, route, permission, or UI conflicts appear, stop and report them before coding. Keep item 08 unchecked until all phases and verification pass.
```

## Risks

- Items 01 through 07 may introduce different schema, auth, request context, route, or UI conventions. Mitigation: Phase 0 reconciliation before edits.
- Accounting documents need customers before CRM item 15. Mitigation: minimal accounting counterparty with issued-document snapshots, later CRM can link/extend.
- Ledger needs stable source data but item 08 must not implement ledger. Mitigation: source posting input contract plus outbox events only.
- Document numbers can duplicate under concurrency. Mitigation: transactional sequence reservation/commit plus unique constraints.
- Money totals can drift if calculated with JavaScript floats. Mitigation: decimal type and tested calculator functions.
- Issued tax invoices can become legally sensitive. Mitigation: lock issued fields, require void/correction flow, audit high-risk actions.
- Period close does not exist until item 10. Mitigation: closed-period policy interface now, enforcing adapter later.
- AI/LINE mutation can creep into accounting. Mitigation: web-only mutations and explicit blocked mutation tests.

## Backlog After MVP

- Deposit invoice and advance payment workflow.
- Multi-currency documents and FX revaluation.
- Recurring invoices.
- PDF rendering/email delivery.
- Public accounting document API.
- Bank reconciliation integration.
- CRM customer merge and richer sales lifecycle.
- Procurement/AP supplier document workflow.
- Full tax report exports and accountant package.
