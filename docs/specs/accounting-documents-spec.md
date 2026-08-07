# Accounting Documents Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 08.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/accounting-documents-mvp-plan|Accounting Documents MVP Plan]]

## 2. Goal

Use FlowAccount-style SME accounting workflows as the product baseline: easy business documents first, then generated double-entry ledger for accounting correctness.

Item 08 ships the web-owned source document workflow for quotations, quotation approval, invoices/billing notes, receipts, tax invoices, payments, credit notes, and debit notes. Finalized accounting-relevant records must preserve deterministic posting inputs so item 10 can generate balanced journal entries without refactoring document data.

## 3. Non-goals

- Copying FlowAccount UI, wording, or proprietary implementation.
- General Ledger, Trial Balance, P&L, Balance Sheet, chart of accounts, posting rules, journal entry editing, or period close. These belong to [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]] item 10.
- OCR/AI receipt upload and expense capture workflow. This belongs to [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]] item 09.
- Thai tax report filing/export automation. Item 08 stores tax-ready source fields only; item 11 owns tax reports/exports.
- Bank account master and bank reconciliation. Item 13 owns them.
- Procurement, supplier AP, purchase orders, vendor bills, and goods receipt workflow. Item 12 owns them.
- Full CRM, pipeline, follow-up, and customer lifecycle. Item 15 owns them.
- Replacing professional accounting review.
- LINE or AI final accounting mutation.

## 4. User Roles

- Owner: sees sales, receivables, tax/document status, profit-ready summaries after ledger exists, and high-risk correction history.
- Sales: creates quotation drafts, submits quotation issue requests, issues approved quotations, converts allowed quotations, and views assigned quote/invoice/payment status.
- Finance: manages invoices, receipts, payments, tax invoices, document corrections, and finance review queues.
- Accountant: reviews source documents, tax readiness, posting status, and later ledger outputs.
- Auditor readonly: reads accounting documents, payments, posting status, and audit trail without mutation.
- AI assistant user: asks for summaries and explanations only through permission-checked read tools after source modules exist.

## 5. Business Workflow

1. Sales or finance creates an accounting counterparty/customer if needed.
2. Sales creates quotation draft.
3. Quotation is submitted for approval before final issue.
4. Manager or Finance approves/rejects quotation issue. Sales cannot self-approve.
5. Sales or Finance issues approved quotation.
6. Issued quotation converts to invoice or billing note without duplicate keying.
7. Finance issues invoice/billing note.
8. Payment is recorded against invoice/customer. Overpayment becomes unapplied customer credit.
9. Receipt is issued from payment or paid invoice flow.
10. Tax invoice is issued where business/tax policy requires it.
11. Credit note or debit note corrects eligible issued documents when needed.
12. Finalized accounting-relevant records emit lifecycle events and expose source posting inputs.
13. Item 10 later generates locked double-entry journals from those finalized source records.

Inventory updates from sales documents are not part of item 08 unless item 05 already exposes safe read/link fields. Stock reservation/deduction remains a later integration.

## 6. Core Business Rules

- Sales document numbers must be unique per company and document type.
- Official issued document numbers come from Data Model Core document sequences.
- Draft documents may use internal ids and remain editable.
- Issued documents lock money, tax, counterparty snapshot, document date, and line fields.
- Issued or tax-sensitive documents cannot be hard-deleted by user routes.
- Corrections after issue use void, full credit note, full debit note, or reversal-ready event.
- Tax invoice issue, void, credit note, and debit note actions require audit trail and dedicated permission.
- A plain receipt represents collection/payment evidence only: it has no output Tax Code and must not emit VAT again when VAT was recognized by an earlier tax invoice.
- A combined receipt/tax invoice must be distinguishable from a plain receipt and must satisfy tax-invoice evidence rules before its lines may carry active company-profile Tax Codes and emit VAT events.
- Tax Code is authoritative per line. The document header is a derived `NONE`, single-code, or `MIXED` summary and cannot drive calculation/posting/reporting.
- Credit/debit-note lines inherit the original issued tax-invoice line profile/code/rate/account/report snapshots and reference the original tax invoice rather than another correction document or unrelated duplicate event.
- `O7`, `OX`, and `O0` remain item-11A legacy compatibility values. SAP ERP/S/4/custom aliases and domestic/import/export/input/output meanings are owned by [[specs/sap-compatible-transaction-tax-account-determination-spec|item 11B]]; source validation must not infer treatment from title or external code alone.
- Payments must link to invoice, receipt, tax invoice, or counterparty account where possible.
- Partial payment is supported at domain/API level.
- Overpayment is supported at domain/API level and records unapplied customer credit instead of rejecting by default.
- Sales may issue quotations only after Manager or Finance approval. Sales cannot approve their own quotation issue.
- Counterparty profile edits do not rewrite issued document snapshots.
- Document line fields must preserve enough detail for posting, tax, audit, and later reports.
- Accounting documents must preserve deterministic posting inputs for generated double-entry journal entries.
- Finalized accounting-relevant documents must have accounting posting status: `not_required`, `pending`, `posted`, `posting_error`, or `reversed`.
- GL, Trial Balance, Journal Entry, P&L, Balance Sheet, and period closing are owned by item 10.
- Web is the only mutation surface for item 08.
- LINE/AI can read only permission-checked summaries later and must deep-link to web for actions.

## 7. Document Types and Statuses

Document sequence keys:

```text
accounting.quotation
accounting.invoice
accounting.billing_note
accounting.receipt
tax.invoice
accounting.payment
accounting.credit_note
accounting.debit_note
```

Document statuses:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
ISSUED
VOIDED
CREDITED
DEBITED
CLOSED
```

Payment statuses on receivable documents:

```text
UNPAID
PARTIALLY_PAID
PAID
OVERDUE
VOIDED
```

Posting statuses:

```text
not_required
pending
posted
posting_error
reversed
```

Tax invoice types:

```text
FULL
ABBREVIATED
```

VAT modes:

```text
NO_VAT
VAT_INCLUDED
VAT_EXCLUDED
EXEMPT
```

Payment directions:

```text
RECEIVED
PAID
```

Payment methods:

```text
CASH
BANK_TRANSFER
CARD
CHEQUE
OTHER
```

## 8. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. The shape below is the required business contract, not exact ORM syntax.

### AccountingCounterparty

```text
AccountingCounterparty
- id
- companyId
- type: CUSTOMER, VENDOR, BOTH
- displayName
- legalName nullable
- taxId nullable
- branchCode nullable
- email nullable
- phone nullable
- billingAddressJson nullable
- shippingAddressJson nullable
- status: ACTIVE, ARCHIVED
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,displayName when practical through normalized field
- index companyId,type,status
```

Item 08 creates a minimal counterparty master because CRM item 15 comes later. CRM can later link to or expand this record. Issued documents keep snapshots so historical evidence stays stable.

### AccountingDocument

```text
AccountingDocument
- id
- companyId
- branchId nullable
- documentType
- documentNumber nullable until issued
- status
- documentDate
- dueDate nullable
- counterpartyId nullable
- counterpartySnapshotJson nullable
- sourceDocumentId nullable
- sourceDocumentType nullable
- convertedFromDocumentId nullable
- currency
- vatMode
- subtotalAmount
- discountAmount
- taxableAmount
- vatAmount
- whtAmount
- grandTotalAmount
- paidAmount
- outstandingAmount
- unappliedCreditAmount nullable
- paymentStatus nullable
- taxStatus nullable
- taxInvoiceType nullable
- taxInvoiceId nullable
- postingStatus
- journalEntryId nullable
- postingError nullable
- note nullable
- internalMemo nullable
- issuedByUserId nullable
- issuedAt nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,documentType,documentNumber when documentNumber exists
- index companyId,documentType,status
- index companyId,branchId,documentDate
- index companyId,counterpartyId
- index companyId,paymentStatus
- index companyId,postingStatus
```

### AccountingDocumentLine

```text
AccountingDocumentLine
- id
- companyId
- documentId
- lineNumber
- productId nullable
- skuSnapshot nullable
- description
- unitName nullable
- quantity
- unitPrice
- discountAmount
- vatRate nullable
- vatAmount
- whtRate nullable
- whtAmount
- lineSubtotalAmount
- lineTotalAmount
- taxCategory nullable
- revenueCategory nullable
- createdAt
- updatedAt
- unique documentId,lineNumber
- index companyId,productId
```

Product reference is optional. Preserve snapshots and descriptions because product master may change.

### AccountingPayment

```text
AccountingPayment
- id
- companyId
- branchId nullable
- paymentNumber nullable
- direction: RECEIVED, PAID
- status: DRAFT, RECORDED, VOIDED
- counterpartyId nullable
- counterpartySnapshotJson nullable
- method
- amount
- allocatedAmount
- unappliedAmount
- currency
- paidAt
- bankAccountRef nullable
- externalReference nullable
- note nullable
- postingStatus
- journalEntryId nullable
- createdByUserId
- updatedByUserId nullable
- voidedByUserId nullable
- voidedAt nullable
- voidReason nullable
- createdAt
- updatedAt
- unique companyId,paymentNumber when paymentNumber exists
- index companyId,direction,status
- index companyId,paidAt
- index companyId,counterpartyId
```

Item 08 UI focuses on `RECEIVED` payments. `PAID` is kept as a source hook for later expense/AP modules.

### AccountingPaymentAllocation

```text
AccountingPaymentAllocation
- id
- companyId
- paymentId
- documentId
- amount
- currency
- allocatedAt
- createdByUserId
- createdAt
- unique paymentId,documentId when one allocation row per target is used
- index companyId,documentId
```

### AccountingPostingState

Posting state may be embedded on source tables or normalized into a separate table, as long as the contract below is available:

```text
AccountingPostingState
- id
- companyId
- sourceType
- sourceId
- postingStatus
- journalEntryId nullable
- postingError nullable
- postedAt nullable
- reversedAt nullable
- updatedAt
- unique companyId,sourceType,sourceId
```

### AccountingQuotationApproval

Approval state may be embedded on `AccountingDocument` for quotations or normalized into a separate table, as long as the contract below is available:

```text
AccountingQuotationApproval
- id
- companyId
- quotationId
- status: PENDING, APPROVED, REJECTED
- submittedByUserId
- submittedAt
- approvedByUserId nullable
- approvedAt nullable
- rejectedByUserId nullable
- rejectedAt nullable
- note nullable
- createdAt
- updatedAt
- unique companyId,quotationId,status where current approval state exists
```

Sales cannot approve their own quotation issue. Manager or Finance approval is required before a Sales-created quotation can become `ISSUED`.

## 9. Ledger-Ready Source Posting Input

Item 10 must be able to ask item 08 for a deterministic source payload:

```text
AccountingSourcePostingInput
- companyId
- branchId nullable
- sourceType
- sourceId
- sourceEventType
- idempotencyKey
- documentType nullable
- documentId nullable
- documentNumber nullable
- documentDate or paidAt
- counterpartyId nullable
- counterpartySnapshot nullable
- currency
- subtotalAmount
- discountAmount
- taxableAmount
- vatAmount
- whtAmount
- grandTotalAmount
- paidAmount
- outstandingAmount
- lines[]
- paymentAllocations[]
- unappliedCreditAmount nullable
- taxInvoiceRef nullable
- reversalOf nullable
- postingStatus
```

Required line fields:

```text
lineNumber
productId nullable
description
quantity
unitPrice
discountAmount
taxableAmount
vatRate nullable
vatAmount
whtRate nullable
whtAmount
lineTotalAmount
taxCategory nullable
revenueCategory nullable
```

Rules:

- Source payload must be derived from persisted source records, not UI state.
- Idempotency key must remain stable for the same source event.
- Payload must not include raw secrets, auth tokens, full file bodies, or unrestricted audit metadata.
- Item 08 sets `postingStatus = pending` for finalized accounting-relevant sources.
- Item 10 owns journal generation and may update posting status to `posted`, `posting_error`, or `reversed`.

## 10. API Behavior

All protected routes are under `/v1/companies/:companyId/accounting`. Route `companyId` is a tenant selection hint and must be verified against request context.

```text
GET /counterparties
- Permission: accounting.counterparty.read
- Lists counterparties with type/status/search filters.

POST /counterparties
- Permission: accounting.counterparty.manage
- Creates minimal customer/vendor record.

PATCH /counterparties/:counterpartyId
- Permission: accounting.counterparty.manage
- Updates non-issued master data only. Historical document snapshots do not change.

GET /documents
- Permission: accounting.document.read or document-type-specific read permission.
- Lists documents by type, status, date range, counterparty, payment status, posting status.

POST /documents
- Permission: document-type-specific create permission.
- Creates draft quotation, invoice, billing note, receipt, or tax invoice.

GET /documents/:documentId
- Permission: document-type-specific read permission.
- Returns header, lines, payments, lifecycle, posting status, and safe refs.

PATCH /documents/:documentId
- Permission: document-type-specific update permission.
- Updates draft only. Rejects issued/voided/closed records.

POST /documents/:documentId/submit-approval
- Permission: accounting.quotation.submit_approval
- Submits quotation for approval before issue.

POST /documents/:documentId/approve
- Permission: accounting.quotation.approve
- Approves quotation issue request. Rejects self-approval by submitting Sales user.

POST /documents/:documentId/reject
- Permission: accounting.quotation.approve
- Rejects quotation issue request with note.

POST /documents/:documentId/issue
- Permission: document-type-specific issue permission.
- Reserves/commits official number, locks source fields, audits action, emits event. Sales-created quotations must be approved first.

POST /documents/:documentId/void
- Permission: document-type-specific void permission.
- Requires reason, checks policy/closed-period hook, audits action, emits reversal-ready event.

POST /documents/:documentId/convert
- Permission: source read plus target create permission.
- Converts issued quotation to invoice or billing note without losing item/tax data.

GET /payments
- Permission: accounting.payment.read
- Lists payments by direction/status/date/counterparty/method.

POST /payments
- Permission: accounting.payment.create
- Records payment and optional invoice allocation. Overpayment creates unapplied customer credit.

PATCH /payments/:paymentId
- Permission: accounting.payment.update
- Updates draft or policy-allowed recorded payment fields only.

POST /payments/:paymentId/void
- Permission: accounting.payment.void
- Requires reason, audits action, emits reversal-ready event.

POST /tax-invoices
- Permission: accounting.tax_invoice.issue
- Issues tax invoice from eligible source document/payment flow.

POST /tax-invoices/:documentId/void
- Permission: accounting.tax_invoice.void
- Requires reason, high-risk audit, and correction hook.

POST /credit-notes
- Permission: accounting.credit_note.create
- Creates credit note draft from eligible issued source document.

POST /credit-notes/:documentId/issue
- Permission: accounting.credit_note.issue
- Issues credit note, audits correction, and emits reversal-ready event.

POST /debit-notes
- Permission: accounting.debit_note.create
- Creates debit note draft from eligible issued source document.

POST /debit-notes/:documentId/issue
- Permission: accounting.debit_note.issue
- Issues debit note, audits correction, and emits reversal-ready event.

GET /posting-sources/:sourceType/:sourceId
- Permission: internal ledger service or protected repair/admin policy.
- Returns AccountingSourcePostingInput for item 10.
```

If the implementation chooses explicit routes such as `/quotations` and `/invoices`, it must still expose the same behavior, permissions, and source posting contract.

## 11. Permission Keys

Add these keys if missing:

```text
accounting.counterparty.read
accounting.counterparty.manage
accounting.document.read
accounting.document.create
accounting.document.update
accounting.document.issue
accounting.document.void
accounting.quotation.read
accounting.quotation.create
accounting.quotation.update
accounting.quotation.submit_approval
accounting.quotation.approve
accounting.quotation.issue
accounting.quotation.void
accounting.invoice.read
accounting.invoice.create
accounting.invoice.update
accounting.invoice.issue
accounting.invoice.void
accounting.billing_note.read
accounting.billing_note.create
accounting.billing_note.update
accounting.billing_note.issue
accounting.billing_note.void
accounting.receipt.read
accounting.receipt.create
accounting.receipt.update
accounting.receipt.issue
accounting.receipt.void
accounting.tax_invoice.read
accounting.tax_invoice.issue
accounting.tax_invoice.void
accounting.credit_note.read
accounting.credit_note.create
accounting.credit_note.issue
accounting.credit_note.void
accounting.debit_note.read
accounting.debit_note.create
accounting.debit_note.issue
accounting.debit_note.void
accounting.payment.read
accounting.payment.create
accounting.payment.update
accounting.payment.void
accounting.document.export
```

Default role intent:

```text
OWNER: all accounting document permissions
ADMIN: read/manage configuration and read documents unless owner grants mutation
SALES: quotation create/update/submit approval, issue only after Manager/Finance approval, own or assigned document read
FINANCE: all document, payment, receipt, tax invoice, credit note, debit note, and counterparty workflow permissions except role/security admin
ACCOUNTANT: read all accounting documents, read/export, tax invoice review, credit/debit note review, and correction visibility; mutation only when explicitly granted or through finance/accounting policy
AUDITOR_READONLY: accounting document/payment read and export where policy allows
MANAGER: read/approve summary or team-scoped documents and approve/reject quotation issue where ABAC allows
INVENTORY, MARKETING, STAFF: no accounting document mutation by default
```

## 12. UI Behavior

### Web Admin

Web owns all accounting document mutation.

Required views:

- Accounting document list with filters for document type, status, date range, counterparty, payment status, and posting status.
- Counterparty list/detail minimal master.
- Quotation create/edit/detail/issue/convert.
- Invoice or billing note create/edit/detail/issue.
- Payment record/allocation.
- Receipt issue/detail.
- Tax invoice issue/detail.
- Credit note and debit note create/issue/detail.
- Void/correction entry point with reason.
- Posting status display on finalized accounting-relevant records.
- Future ledger journal link when `journalEntryId` exists.
- Forbidden, locked, empty, loading, validation error, and audit-sensitive states.

Design rules:

- Keep screens dense, finance-friendly, and consistent with web workspace patterns.
- Do not use landing-page/marketing layout for accounting workspace.
- Do not hide accounting consequences of issue, void, tax invoice, or payment actions.
- Confirm high-risk actions such as voiding issued/tax documents.

### LINE and AI

LINE/AI may later expose:

- Document/payment summaries the user can read.
- Source refs and web deep links.
- Missing payment or pending posting warnings.

LINE/AI must not:

- Create, issue, void, update, pay, allocate, post, export, or correct accounting documents.
- Accept typed company ids, role names, branch ids, payment amounts, or tax treatment from chat as authorization.
- Bypass web confirmation for accounting actions.

## 13. Related Module Boundaries

- Item 09 Expense and Receipt Upload may create draft expense/accounting records later; item 08 must not build OCR upload flow.
- Item 10 Double-Entry Ledger consumes finalized source posting inputs and lifecycle events from item 08.
- Item 11 Thai Tax consumes tax-ready source fields and later ledger summaries.
- Item 12 Procurement/AP consumes or extends payment/vendor hooks for payable workflows.
- Item 13 Bank Reconciliation matches bank transactions to payments later.
- Item 15 CRM can link richer customer records to `AccountingCounterparty` later. Issued document snapshots remain immutable.

## 14. Outbox Events and Audit Actions

Outbox event names should use Data Model Core conventions and stable lowercase dot keys:

```text
accounting.quotation.issued
accounting.quotation.submitted_for_approval
accounting.quotation.approved
accounting.quotation.rejected
accounting.quotation.voided
accounting.invoice.issued
accounting.invoice.voided
accounting.billing_note.issued
accounting.billing_note.voided
accounting.receipt.issued
accounting.receipt.voided
accounting.tax_invoice.issued
accounting.tax_invoice.voided
accounting.payment.recorded
accounting.payment.unapplied_credit_created
accounting.payment.voided
accounting.document.converted
accounting.credit_note.issued
accounting.debit_note.issued
accounting.document.posting_status_changed
```

Outbox payloads include ids, document number, event type, status, totals, and idempotency key. Do not include full document bodies, raw files, tokens, secrets, or unrestricted PII.

Audit actions:

```text
accounting.counterparty.create
accounting.counterparty.update
accounting.document.create
accounting.document.update
accounting.document.issue
accounting.document.void
accounting.document.convert
accounting.payment.create
accounting.payment.update
accounting.payment.void
accounting.quotation.submit_approval
accounting.quotation.approve
accounting.quotation.reject
accounting.credit_note.create
accounting.credit_note.issue
accounting.credit_note.void
accounting.debit_note.create
accounting.debit_note.issue
accounting.debit_note.void
accounting.tax_invoice.issue
accounting.tax_invoice.void
accounting.posting_state.update
```

Audit metadata must include ids, document number, old/new status, amount summary, actor, request id, reason text where required, and result. Redact raw full payloads.

## 15. Edge Cases

- Issuing the same draft twice: return existing issued result or reject idempotently; never allocate two official numbers.
- Concurrent issue: unique constraint and transactional sequence handling prevent duplicate numbers.
- Counterparty archived after draft: allow draft update only if policy permits; issued snapshots remain valid.
- Product archived after draft: issued document preserves line snapshot.
- Partial payment: invoice becomes `PARTIALLY_PAID`.
- Overpayment: create unapplied customer credit and include it in posting source input.
- Payment voided after receipt issued: require reversal-ready event and status recalculation.
- Tax invoice already issued: reject duplicate issue unless policy creates credit/debit note flow.
- Sales quotation issue without approval: reject until Manager/Finance approval exists.
- Sales self-approval attempt: reject and audit denial.
- Credit/debit note against unsupported source state: reject with actionable validation error.
- Issued document in closed period: closed-period adapter from item 10 must reject mutation when available.
- Posting rule missing in item 10: source remains finalized; posting status may become `posting_error`.
- Cross-company document id: return `403` or hidden `404` according to auth policy, never leak ownership.

## 16. Acceptance Criteria

- [ ] Sales document flow is clear from quotation to invoice/billing note to payment/receipt/tax invoice.
- [ ] Quotation issue requires approval; Sales can issue approved quotations but cannot self-approve.
- [ ] Web owns all accounting document mutations.
- [ ] LINE/AI boundaries are explicit and mutation-free.
- [ ] Minimal counterparty/customer support exists before CRM item 15.
- [ ] Document sequence keys and official numbering rules are defined.
- [ ] Draft, pending approval, approved, rejected, issued, voided, credited/debited, paid, and posting statuses are explicit.
- [ ] Issued documents preserve immutable counterparty and line snapshots.
- [ ] Tax invoice and WHT-capable fields are represented in data model.
- [ ] Payment allocation and partial payment behavior are represented.
- [ ] Overpayment creates unapplied customer credit and is ledger-ready.
- [ ] Credit note and debit note full workflows are represented in API and web.
- [ ] Finalized documents expose ledger posting inputs and posting status.
- [ ] Outbox events and audit actions are bounded/redacted.
- [ ] Web supports complex accounting views through double-entry ledger item 10 later.
- [ ] AI can explain accounting summaries later without changing records.

## 17. Test Cases

Domain tests:

- Quotation totals calculate correctly with discount and VAT modes.
- Invoice issue locks money/tax fields.
- Payment allocation updates invoice payment status.
- Partial payment leaves outstanding amount.
- Overpayment creates unapplied customer credit.
- Sales quotation issue is rejected until Manager/Finance approval exists.
- Sales self-approval is rejected.
- Void requires valid status and reason.
- Credit note and debit note issue against eligible documents emit correction events.
- Tax invoice duplicate issue is rejected.
- Source posting input includes required header, line, tax, payment, and idempotency fields.

Persistence/use-case tests:

- Company-scoped document number uniqueness blocks duplicates.
- Concurrent issue does not create duplicate document numbers.
- Cross-company access is denied or hidden.
- Missing permission returns `403`.
- Issued document update returns validation error.
- Voided/corrected document emits reversal-ready source event.
- Quotation approval writes audit event and unlocks issue for allowed actor.
- Payment void recalculates allocation/payment status or blocks according to policy.
- Audit metadata redacts full document body.
- Outbox payload contains bounded source refs and no secret-like fields.

Web tests:

- List filters by document type/status/date/payment/posting status.
- Quotation converts to invoice without losing item data.
- Quotation approval UI allows Manager/Finance approval and blocks Sales self-approval.
- Issue action shows validation and locked state.
- Payment form handles partial payment.
- Overpayment UI records unapplied credit.
- Credit note and debit note UI supports create/issue/detail.
- Forbidden/locked/loading/empty/error states render.

Integration smoke:

- Quotation submit -> approval -> issue -> invoice -> payment -> receipt -> tax invoice path works through API and web logic.
- Credit note and debit note paths work through API and web logic.
- Finalized invoice can be consumed by item 10 posting input contract.
- Closed-period policy hook rejects mutation when item 10 adapter exists.

## 18. Implementation Handoff Notes

Suggested source paths:

```text
apps/api/prisma/schema.prisma
apps/api/prisma/seed.ts
apps/api/src/modules/accounting-documents/
apps/api/src/modules/accounting-documents/domain/
apps/api/src/modules/accounting-documents/application/
apps/api/src/modules/accounting-documents/infrastructure/
apps/api/src/modules/accounting-documents/presentation/http/
apps/web/src/features/accounting-documents/
packages/contracts/src/accounting-documents.ts
```

Recommended API module layout:

```text
apps/api/src/modules/accounting-documents/
  domain/
    models/
    logic/
    ports/
  application/
    dto/
    use-cases/
  infrastructure/
    db/
    repositories/
  presentation/
    http/
  accounting-documents.module.ts
```

Before coding:

1. Read `docs/plans/master-implementation-checklist.md`.
2. Read this spec.
3. Read `docs/plans/accounting-documents-mvp-plan.md`.
4. Read `docs/specs/accounting-product-benchmark.md`.
5. Read `docs/specs/double-entry-ledger-closing-spec.md`.
6. Read `docs/specs/permission-matrix.md`.
7. Read `docs/specs/data-model-core-spec.md`.
8. Read `docs/specs/auth-authorization-rbac-spec.md`.
9. Read `docs/specs/web-core-workspace-spec.md`.
10. Read backend, frontend, and security guidelines.
11. Inspect current `apps/api`, `apps/web`, `apps/workers`, `packages/contracts`, `packages/config`, and Prisma state.

First implementation pass should be Phase 0 and Phase 1 from the linked plan unless owner explicitly expands scope.

If Prisma, auth, audit, outbox, document sequences, or web workspace already exists, reuse and extend it. Report schema/route/permission conflicts before coding.

## 19. Remaining Open Questions

- Which export formats do Thai accountants expect after item 10 and item 11 exist?

## 20. Owner Decisions

- Credit note and debit note require full UI in item 08.
- Overpayment must create unapplied customer credit; do not reject by default.
- Sales role can issue quotations only after Manager or Finance approval. Sales cannot self-approve.

## 21. Owner Update 2026-07-14 — Line-Level Transaction Tax

- Item 08 source lines must expose deterministic tax facts and immutable issued snapshots; item 11B resolves Tax Code definitions, evidence rules, tax components, accounts, and report contributions.
- One document may contain standard, zero-rated, exempt, or other reviewed treatments on different lines.
- Plain receipt remains no-code/payment-only. Receipt/tax invoice uses tax-document lines and never duplicates tax recognized by its linked source.
- Sales UI/API must eventually use the item-11B resolver and compatibility adapter rather than the global `O7 | OX | O0` header enum.

## 22. Security Update 2026-07-18 — Money Input Invariants (H-05)

- Public accounting document/payment mutations use concrete class DTOs under the global whitelist/forbid-non-whitelisted pipe; plain TypeScript input types are not an HTTP trust boundary.
- Item 08 remains THB-only. User-entered money is a plain decimal string with at most 14 integer digits and 2 fractional digits; exponent, non-finite, signed-negative, and zero payment/line values are invalid. Quantity is positive with at most 4 fractional digits.
- Discount is non-negative and strictly below its line subtotal. VAT/WHT rates are between 0 and 100. A line subtotal must remain within the accounting money bound before persistence.
- Payment use cases revalidate amount/currency before persistence. Allocation additionally requires a received payment, an issued receivable document (`INVOICE`, `BILLING_NOTE`, or `DEBIT_NOTE`), matching currency/counterparty, and positive outstanding balance.
- Overpayment remains valid and the amount above the target outstanding balance becomes unapplied customer credit; validation must not silently turn it into over-allocation.
- Line count is not a money invariant. A DRAFT may hold zero lines so an in-progress document can be saved before its lines are entered; the "at least one line" rule belongs to the issue transition only (`validateIssuableLines`, returns 422). The create DTO must therefore not carry `@ArrayMinSize(1)` — that would make the issue-time guard unreachable and break ACCT-05. `@ArrayMaxSize(200)` remains a payload bound.
