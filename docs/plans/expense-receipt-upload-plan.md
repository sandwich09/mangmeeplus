# Expense Receipt Upload Implementation Plan

## Status

Implemented and locally verified for checklist items 09, 09A, and 09B. Remaining real-provider/production calibration and tenant policy work is tracked in the linked focused plans and memories.

Capture-first payment integrity §19m follow-up is **MERGED DEVELOP** via PR #287 at
`111532966c415fee11abb36ca1749bf1fc66ee52` (2026-08-27T04:36:17Z), exact-head
CI `33039136161` SUCCESS on `179981a45f00a1d0b3a1898dce9f877f2457563e`.
Final combined E2E33/33, zero skipped/flaky, web1139/1139 and eight-suite checks128/128
(including 6 real PostgreSQL cases); see
[delivery memory](../agent-memory/expense-payment-capture-integrity.md). This does not
complete unrelated old checklist items or authorize main/Production rollout.

The primary WatchDog/Codex agent owns implementation. Claude CLI is restricted to read-only development review and test verification; it must not implement, edit, stage, commit, or deploy.

## Linked Specs

- Spec: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Focused OCR provider follow-up: [[specs/typhoon-receipt-ocr-spec|Typhoon Receipt OCR Spec]]
- Cross-domain image intake follow-up: [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]] and [[plans/business-document-image-intake-plan|Business Document Image Intake Plan]]
- Substitute-evidence hardening follow-up: [[plans/substitute-receipt-evidence-hardening-plan|Substitute Receipt Evidence Hardening Plan]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 09. Expense and Receipt Upload
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Period Closing Spec]]
  - [[specs/data-model-core-spec|Data Model Core Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
  - [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
  - [[specs/platform-environment-config-spec|Platform Environment Config]]
  - [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the first expense capture slice for WatchDog-BMS:

- Web receipt/bill upload using shared attachment storage.
- LINE receipt/bill/supplier tax-invoice image/PDF/text upload from linked, permission-checked users.
- Broad expense-document intake: receipts, tax invoices, transfer slips, handwritten cash bills, supplier bills, Shopee/Lazada/TikTok marketplace order screenshots, reimbursement-supporting documents, any-language expense documents, and no-receipt spend notes such as `ค่ากาแฟ 65 บาท`.
- Paypers-like LINE capture UX: user sends evidence in LINE, AI extracts expense/tax fields, detects source document type/language, classifies to the active company expense category catalogue, WatchDog auto-keys a reviewable draft into web, LINE replies with recognized document type/amount/category/date/vendor/tax summary plus missing-field/duplicate warnings and a web review link.
- OCR/extraction-ready expense drafts that remain review-only until finance confirmation.
- AI verification that checks receipt/text evidence, totals, tax fields, duplicate signals, confidence, vendor hints, and category hints before inserting structured draft/review data.
- Tax evidence decision fields that say whether captured evidence is usable for tax, supporting-only, not tax evidence, or needs review, with reason codes.
- Multi-line receipt extraction into reviewable expense lines, with one-line fallback when OCR/AI is uncertain.
- Manual company expense category management for owner/admin/finance users; AI may choose from active configured categories but cannot create or administer categories.
- Manual review and correction for source document type/language, vendor, date, price, quantity, amount, VAT, WHT, category/account hint, payment, branch, attachment evidence, and substitute receipt evidence.
- Company signature asset storage for web users and LINE AI signature-image submissions, web owner-approval ticket before active use, optional background removal, and signature fill into substitute receipt/review evidence placeholders.
- Accounting office shared evidence view inside WatchDog web, backed by DB filters and signed attachment URLs instead of Google Drive folders.
- Accountant package export from DB-backed filters, including generic Thai accounting-office CSV/XLSX index where available, evidence manifest, and permission-checked evidence download links.
- Duplicate detection and resolution.
- Confirmed expense records with audit, outbox, payment state, tax-ready fields, and ledger-ready posting input.
- Web Expenses workspace for upload, review queue, detail, confirmation, rejection, void, and paid status.
- LINE reply flow with verification summary, inserted fields, missing fields, duplicate warnings, and web deep link.

This plan should give Sonnet 4.6 enough detail to implement without reopening product, ledger, tax, security, storage, or web ownership decisions.

## Current Repository Context

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/ai-gateway`: NestJS service shell with health/security skeleton.
- `apps/workers`: TypeScript worker shell with BullMQ and Redis dependencies.
- `apps/web`: Next.js App Router shell with shared feature-folder conventions evolving through item 03.
- `packages/contracts`: shared contract package exists but may still be thin.
- `packages/config`: shared config package exists but may still be thin.
- No Prisma schema exists in the original snapshot, but items 01 through 08 may add Prisma, auth, audit, outbox, document sequence, attachment, web workspace, inventory, dashboard, notification, LINE, and accounting document modules before item 09 starts.

Before implementation, inspect latest code again. Extend existing primitives. Do not duplicate tenant, branch, document sequence, attachment, audit, outbox, accounting counterparty, accounting payment, notification, LINE, web-shell, config, or contract code.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer: primary WatchDog/Codex agent. Claude CLI role: read-only dev review/test only.

Start point:

1. Read this plan first.
2. Read `docs/specs/expense-receipt-upload-spec.md`.
3. Read `docs/specs/accounting-documents-spec.md`.
4. Read `docs/specs/double-entry-ledger-closing-spec.md`.
5. Read `docs/specs/data-model-core-spec.md`.
6. Read `docs/specs/permission-matrix.md`.
7. Read `docs/specs/auth-authorization-rbac-spec.md`.
8. Read `docs/specs/web-core-workspace-spec.md`.
9. Read `docs/specs/platform-environment-config-spec.md`.
10. Read `docs/specs/tax-thailand-2026-spec.md`.
11. Read `docs/guidelines/backend-hexagonal-code-style.md`.
12. Read `docs/guidelines/web-frontend-code-style.md`.
13. Read `docs/guidelines/security-implementation-guideline.md`.
14. Inspect `apps/api`, `apps/web`, `apps/workers`, `apps/ai-gateway`, `packages/contracts`, `packages/config`, and current Prisma state.
15. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 09 complete until Phase 0 through Phase 8 exit criteria pass and verification commands are recorded.

## Core Rule

Upload, OCR, and LINE AI verification create drafts or ready-for-confirmation review data only after the document is accepted as expense evidence. Shared-LINE quotation, scheduling, order-only, non-financial, unreadable, ambiguous, and multi-document images do not create expense drafts. AI may insert verified draft fields with provenance. Finance-confirmed expense records become ledger-ready sources. Item 09 must not generate journals, post ledger entries, file tax reports, or complete reimbursement/procurement workflows.

Paypers-like means LINE-first intake and AI-assisted data entry, not autonomous accounting or Google Drive storage. LINE may capture receipt, bill, tax-invoice, transfer-slip, handwritten-cash-bill, marketplace-screenshot, reimbursement-supporting, any-language, and short text expense evidence and draft fields; web remains the source of truth for correction, substitute receipt generation, category administration, confirmation, export, tax review, and posting readiness.

## Role Gates

BA gate: Expense capture must let staff/requesters send receipts, tax invoices, transfer slips, handwritten cash bills, marketplace screenshots, reimbursement-supporting documents, any-language documents, and short text notes from web or LINE, get draft capture feedback, and let finance review/confirm with duplicate, tax, category, substitute receipt, payment, and ledger handoff rules visible.

SA gate: Implementation must extend existing attachment, LINE identity, permission, audit/outbox, expense, accounting counterparty/payment, AI Gateway, and web-shell primitives without duplicate storage or autonomous accounting mutation.

DEV gate: Read Ponytail before edits, implement smallest additive diff per phase, keep AI/OCR behind ports, reuse contracts/config, and run focused typecheck/test for each touched package.

Integration gate: Verify LINE/web upload to API draft contract, web review/confirmation path, loading/error/permission states, AI-not-configured fallback, and E2E/browser path when repo support exists.

## Integration Verification

Record verification commands in `docs/agent-memory/expense-receipt-upload-09.md` for each implementation slice. Docs-only alignment changes may verify with `pnpm agent:gates` and `git diff --check`; executable changes must add focused package typecheck/test and browser/E2E evidence when UI flow changes.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 08.
- If Prisma/auth/audit/outbox/document sequences/attachments already exist, extend them with additive migrations and module code.
- Do not duplicate `Company`, `Branch`, `CompanyMembership`, `AttachmentObject`, `AttachmentLink`, `DocumentSequence`, `AuditLog`, `OutboxEvent`, request context, accounting counterparty, accounting payment, notification, LINE binding, AI Gateway, or web-shell modules.
- Use Data Model Core attachment upload intent, completion, link, and signed download/view behavior.
- Use existing LINE webhook/account-linking primitives for LINE upload. Verify LINE signature, linked user, active company, permission, idempotency, MIME type, and size before creating expense data.
- Never return raw object keys, bucket names requiring secrecy, storage credentials, or permanent public URLs to clients.
- Runtime upload limits must come from config such as `UPLOAD_MAX_BYTES` and `ALLOWED_UPLOAD_MIME_TYPES`.
- Accept PDF, PNG, and JPEG unless environment config narrows supported MIME types. LINE text notes may accompany media or stand alone as no-receipt expense notes, but user text cannot override server-derived tenant, permission, branch, or confirmation state.
- Use AI/model-driven cross-domain classification before expense source-document classification. A positive printed transaction total plus receipt/settlement evidence is required for `RECEIPT`; quantity-only order/check images do not enter the expense source-document mapping automatically. Canonical rules live in [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]].
- Support any-language document intake as draft capture. OCR/AI can auto-key what it can verify; unsupported language/script or unreadable handwriting falls back to manual review.
- Keep extraction behind an application/domain port. A no-op or not-configured provider is acceptable for first pass.
- OCR/extraction output is suggestion data only. AI verification may insert draft/review fields only after validation and confidence gates. It cannot confirm, reject, void, pay, export, post, or classify final tax/accounting fields without explicit permission-checked review flow.
- Document type, category, and text-note understanding must be AI/model-driven semantic extraction/classification, not keyword-only routing, regex-only parsing, or static dictionaries that require adding every vendor/platform/language phrase by hand.
- Deterministic logic stays as validation/accounting guards only: permission, tenant/branch context, allowed enum/category ids, decimal totals/tax math, duplicate detection, state transitions, audit, source posting input, and final-mutation blocking.
- AI category classification may choose only active system/default or company-specific expense categories visible to the company. Unknown/low-confidence category matches must stay `NEEDS_REVIEW`/`อื่นๆ`; AI must not invent or create categories.
- AI verification must keep field-level provenance and must not invent vendor tax ids, vendor document numbers, VAT/WHT, branch, payment facts, or missing receipt details.
- For supplier tax invoices, extract vendor name, vendor tax id, branch code, document number, issue date, VAT base, VAT amount, grand total, WHT hint, and input VAT claimability into review fields when confidence gates pass; otherwise mark each field `NEEDS_REVIEW`.
- For tax evidence status, map clear tax invoice/receipt evidence to `USABLE_FOR_TAX`, payment-only or business-support evidence to `SUPPORTING_ONLY`, non-business or invalid proof to `NOT_TAX_EVIDENCE`, and uncertain/low-confidence cases to `NEEDS_REVIEW`. Store reason codes and allow finance/accountant override.
- For receipts with multiple visible line items, create one `ExpenseLine` per visible item only when line description and amount/quantity evidence is sufficiently clear. Otherwise create a single summary line and mark line breakdown `NEEDS_REVIEW`.
- For transfer slips, extract payer/payee, transfer date/time, amount, bank/reference hints, and payment evidence only; do not infer VAT/tax invoice fields from a slip alone.
- For marketplace screenshots, extract platform, seller/store, order id, item descriptions, quantity, price, shipping/discount when visible, and keep tax fields `NEEDS_REVIEW` unless valid tax-invoice data is present.
- For substitute receipts, generate evidence only from web review with missing receipt reason and reviewer identity; do not generate substitute receipts from LINE alone.
- Store signatures as company-scoped signature assets using the existing attachment primitives. Web upload/draw/import or LINE AI signature-image submission creates `PENDING_OWNER_APPROVAL` plus a web approval ticket; an OWNER or explicitly delegated owner-level approver must approve before the signature becomes `ACTIVE` and reusable. Background removal creates a derived transparent signature asset and keeps the original. Filling a signature placeholder is a permission-checked web action with preview, active-signature check, applier metadata, rendered evidence attachment, and audit; it is not expense confirmation or reimbursement approval.
- LINE AI may create a pending signature ticket only after linked-user, company-context, permission, MIME type, size, idempotency, and AI semantic signature-intent checks. The item 10B LINE Intake Router Agent should own this context split before handing off to item 09 signature/expense use cases. Signature-intent detection must consider the image and accompanying text/conversation context and must not be keyword-only routing, regex-only parsing, or a static phrase list. It must not activate, background-remove, apply, or administer signatures.
- Accounting office sharing is a web read/export view for accountant/auditor users or invited company users with expense permissions. Use DB-backed virtual folders by year/month and normal signed attachment URL checks; do not create public folder links or Google Drive folders.
- Accountant package export uses the Reports/BI/export primitives when present. Default package format is a generic Thai accounting-office export: exact column list from the spec, index CSV/XLSX, manifest JSON, and permission-checked evidence download links grouped by period/expense. Expense module should expose source query/package data, index rows, evidence manifest, tax evidence status/reasons, and attachment refs; Reports/BI can own CSV/XLSX export center behavior where available. Do not copy a vendor-specific proprietary export format.
- First pass uses manifest plus permission-checked downloads only. Do not generate bundled archives until the owner asks for offline archives later.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money and quantity handling.
- Store `THB` as MVP default currency. Keep currency field explicit.
- Use item 08 `AccountingCounterparty` for vendors where available; extend with vendor fields if needed.
- Use item 08 `AccountingPayment` direction `PAID` for expense payment where available; if missing, extend it additively.
- Draft expenses are editable. Confirmed expenses lock vendor snapshot, document date, document number, money/tax/payment/category fields, and primary evidence.
- Do not hard-delete confirmed expenses, lines, receipt attachments, extraction records, duplicate records, or payment links from user flows.
- Corrections after confirmation use void/reversal-ready event or explicit adjustment flow.
- Duplicate warnings require resolution or override reason before confirmation.
- Set `postingStatus = not_required` for drafts, rejected records, and duplicate-only records.
- Set `postingStatus = pending` for confirmed accounting-relevant expense records.
- Do not generate ledger journals in item 09. Only expose source posting input and emit lifecycle events.
- Emit outbox events for web/LINE receipt upload, extraction completion/failure, AI verification completion/failure, AI field insertion, duplicate flag, expense confirmation, rejection, void, payment record, and posting-state change when outbox exists.
- Audit upload completion, LINE upload receive/reject, extraction request/failure, AI verification request/field insertion/failure, review updates, duplicate resolution, confirmation, rejection, void, payment record, category changes, and exports.
- Enforce tenant, permission, branch scope, ownership/team ABAC, and record policy on the server. Web checks are UX only.
- Web and LINE are allowed capture surfaces for item 09. LINE/AI mutation is limited to receipt media ingestion, attachment creation, draft expense creation, AI verification, and insertion of verified draft/review fields through allowlisted use cases.
- LINE/AI cannot confirm, reject, void, pay, export, post ledger entries, change categories as final admin action, or alter confirmed expenses.
- LINE replies should use capture-status wording: draft/evidence captured, recognized fields, category suggestion, missing fields, duplicate warning, and web deep link. Do not tell the user final accounting/tax posting is complete from LINE capture alone.
- Web deep links must re-check current permission and record state.
- Each phase must leave touched packages typecheckable.
- Record verification commands and any skipped tests with concrete reasons.

## Scope

### In Scope

- Shared expense contracts in `packages/contracts`.
- Expense permission keys and default role grants.
- Prisma schema/migration/seed for expense models if Prisma exists or is added.
- Source document type/language, tax evidence status/reason, expense categories/account hints, manual company category management, AI semantic category classification, and ledger handoff.
- API expense module using hexagonal folder structure.
- Receipt/bill upload intent and completion flow using Data Model Core attachment primitives.
- LINE receipt/bill media ingest flow through existing LINE webhook/account-linking primitives.
- LINE supplier tax-invoice media ingest flow using the same expense draft pipeline as receipts/bills.
- LINE transfer-slip, handwritten-cash-bill, marketplace-screenshot, and any-language document ingest using the same draft pipeline with document-type review fallback.
- LINE text-only expense note ingest flow using the same draft pipeline, no-receipt provenance, category suggestion, and web review link.
- Web substitute receipt (`ใบแทนใบเสร็จ`) generation for missing/insufficient receipt cases, stored as review evidence and never treated as an external tax invoice.
- Web signature asset management for upload/draw/import, LINE AI pending signature-image tickets, remove-background derived asset, and fill-to-signature-placeholder on substitute receipt/review evidence documents.
- Web accountant shared evidence view with permission-filtered virtual year/month folders and signed attachment previews/downloads.
- Accountant-ready export package source query and manifest, with generic Thai accounting-office CSV/XLSX index delegated to Reports/BI/export primitives when present.
- OCR/extraction port, queue/job hooks, no-op/not-configured provider behavior, and suggestion storage.
- AI verification port/tool flow with field-level provenance and verified draft/review field insertion.
- Expense draft/review/confirm/reject/void/payment/duplicate use cases.
- Deterministic source posting input for item 10.
- Tax-ready fields for item 11.
- Bounded outbox event payloads for expense lifecycle.
- Audit integration for sensitive expense actions.
- Web Expenses feature folder with review queue, upload flow, detail/review form, duplicate panel, receipt viewer, confirmation, rejection, void, payment status, and category view where appropriate.
- LINE reply templates or message builders for Paypers-like capture status, verification summary, missing fields, duplicate warnings, and web deep links.
- Tests for contracts, domain totals, status transitions, duplicate logic, storage policy, LINE upload, AI verification insertion, use cases, permissions, API behavior, outbox/audit payloads, and UI logic where current test setup supports them.

### Out of Scope

- Ledger journal generation, chart of accounts, posting rules, GL/TB/P&L/BS, and period close. Item 10 owns them.
- Thai tax report filing/export automation. Item 11 owns it.
- Procurement, purchase orders, goods receipt, vendor bill approval, and AP aging. Item 12 owns them.
- Bank reconciliation and bank account master. Item 13 owns them.
- Reimbursement approval and employee repayment lifecycle. Item 14 owns them.
- Fixed asset register and depreciation. Item 21 owns them.
- Full accounting workspace in LINE.
- AI final confirmation, payment, void, export, posting, or autonomous accounting treatment.
- Production infrastructure provisioning.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: `String @id @default(cuid())` unless repo already standardizes UUIDs before item 09 starts.
- Currency: `THB`.
- Document sequence key: `expense.record`.
- Optional payment sequence key: `expense.payment` only if item 08 payment model cannot cover paid expense records.
- Expense statuses: `DRAFT`, `EXTRACTING`, `NEEDS_REVIEW`, `READY_FOR_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `VOIDED`.
- Extraction statuses: `NOT_REQUESTED`, `NOT_CONFIGURED`, `QUEUED`, `PROCESSING`, `SUCCEEDED`, `PARTIAL`, `FAILED`.
- AI verification statuses: `NOT_VERIFIED`, `VERIFYING`, `AI_VERIFIED`, `PARTIAL`, `NEEDS_REVIEW`, `FAILED`, `HUMAN_VERIFIED`.
- Duplicate statuses: `NOT_CHECKED`, `NO_MATCH`, `POSSIBLE_DUPLICATE`, `CONFIRMED_DUPLICATE`, `OVERRIDDEN`.
- Duplicate writes: every writer takes the company reconciliation lock before the expense lock and performs company/current-branch/editable-status/non-posted revalidation inside the transaction; detection/detail/target lookup apply branch ABAC to the candidate expense, and detail redacts a hidden candidate plus its header `duplicateOfExpenseId`; candidate writes are scoped to `{id, companyId, expenseId, status: OPEN}`. Rescans preserve human resolutions, reopen only system-stale evidence, soft-close (never delete) stale visible `OPEN` rows, preserve confirmed evidence, and recompute the aggregate. Confirm/dismiss require a 3–500 character reason; confirm selects one winner, stores `duplicateOfExpenseId`, and soft-closes other opens. Web exposes both actions and a restricted-candidate state.
- Payment statuses: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `VOIDED`.
- Posting statuses: `not_required`, `pending`, `posted`, `posting_error`, `reversed`.
- VAT modes: `NO_VAT`, `VAT_INCLUDED`, `VAT_EXCLUDED`, `EXEMPT`, `NEEDS_REVIEW`.
- Input VAT claim statuses: `CLAIMABLE`, `NON_CLAIMABLE`, `NEEDS_REVIEW`.
- Payment methods: `CASH`, `BANK_TRANSFER`, `CARD`, `CHEQUE`, `OTHER`.
- Capture sources: `WEB_UPLOAD`, `WEB_MANUAL`, `LINE_UPLOAD`, `API_INTERNAL`.
- Attachment purposes: `expense.receipt.primary`, `expense.receipt.supporting`, `expense.review.evidence`.
- Runtime upload size and MIME defaults come from config. Do not hard-code 10 MB or 25 MB in feature logic.
- First UI may optimize for one-line expense, but domain/API must support multiple lines.
- Missing receipt requires `missingReceiptReason` and finance-level permission or explicit policy grant.
- Duplicate override requires reason before confirmation.
- Confirmed expense copies vendor snapshot and locks core evidence fields.
- No OCR provider required for first usable implementation.
- LINE upload requires a linked account, active company context, and `expense.receipt.line_upload`; every standard employee role receives that own-intake grant, while auditor/platform/demo roles remain excluded. Keep idempotency by LINE message id and return an AI verification summary.
- Permission UI follow-up (deferred): the current role/menu matrix is read-only for protected system roles and its generic `ค่าใช้จ่าย+ใบเสร็จ` cells do not prove LINE-upload access. When individual overrides ship, expose `expense.receipt.line_upload` as an explicit own-intake capability and verify that the UI preview and LINE webhook use the same effective resolver; do not infer it from menu visibility alone.
- LINE capture UX default: one user action in LINE should be enough to create a draft from receipt/bill/tax-invoice/transfer-slip/handwritten-cash-bill/marketplace evidence or text-only expense note; any correction, substitute receipt generation, category administration, final confirmation, export, or ledger/tax action happens in web.
- First source posting input is generated from confirmed expense and paid-status fields, not from UI form state.

## Required Ledger-Ready Outputs

Confirmed expenses must expose:

- `companyId`
- `branchId` when applicable
- `sourceType`
- `sourceId`
- `sourceEventType`
- stable `idempotencyKey`
- `expenseNumber` when assigned
- expense date and paid date where applicable
- vendor counterparty id and vendor snapshot where available
- currency
- line-level quantity, unit price, discount, VAT, WHT, taxable amount, and total fields
- document-level subtotal, discount, taxable amount, VAT total, WHT total, grand total, net payable, paid total, and outstanding total
- VAT mode and input VAT claim status
- payment status, method, amount, bank reference, and payment link where available
- expense category/account hints
- source document type and language hint
- attachment evidence metadata without object keys or signed URLs
- duplicate status and override reason where applicable
- source lifecycle event such as confirmed, paid, voided, or reversed
- `postingStatus`: `not_required`, `pending`, `posted`, `posting_error`, or `reversed`
- `postingError` only when item 10 or a repair job writes one; keep redacted and actionable

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect `apps/web/package.json`, `apps/web/app`, `apps/web/src/common`, and `apps/web/src/features`.
- [ ] Inspect `apps/workers/src` for queue/outbox worker conventions.
- [ ] Inspect `apps/ai-gateway/src` for read-only AI integration boundaries.
- [ ] Inspect `packages/contracts/src` and current export pattern.
- [ ] Inspect `packages/config/src` for storage/upload/env patterns.
- [ ] Identify existing request context, auth guard, permission decorator, audit, outbox, document sequence, attachment, storage, branch, accounting counterparty, accounting payment, notification, and web navigation primitives.
- [ ] Identify item 08 accounting module paths and contracts.
- [ ] Identify current route naming and web navigation conventions from item 03.
- [ ] Record any schema, route, package, or UI conflicts before coding.

### Exit Criteria

- Implementation summary states which existing primitives will be reused.
- No duplicate shared module is planned.
- Exact first source paths for contracts, API module, web feature, worker hooks, and tests are known.

## Phase 1: Contracts, Permissions, and Domain Rules

### Goal

Define stable expense contracts and business rules before persistence/API code.

### Tasks

- [ ] Add expense enums and DTO types in `packages/contracts` or existing contract location.
- [ ] Add upload intent, LINE upload, attachment metadata, source document type/language, tax evidence status/reason, extraction suggestion, AI verification, duplicate candidate, expense draft/detail/list, line, tax, payment, category, substitute receipt metadata, company signature asset/owner approval/fill, accountant package index/manifest/download-link, status transition, and source posting input contract types.
- [ ] Add list/detail filter and pagination contract types.
- [ ] Add expense permission keys from the spec and permission matrix.
- [ ] Seed or map role grants using existing RBAC seed conventions.
- [ ] Implement pure domain logic for VAT modes, input VAT claim status, tax evidence status/reason mapping, WHT, net payable, paid/outstanding amounts, status transitions, duplicate scoring, AI line-splitting fallback, AI verified-field insertion gates, confirmation validation, and posting-status decision.
- [ ] Add domain tests for totals, status transitions, tax evidence status/reasons, duplicate logic, AI line-splitting fallback, AI verified-field insertion, confirmation validation, no-receipt policy, and source posting input redaction.

### Exit Criteria

- Contracts compile and are exported through existing package pattern.
- Permission keys are documented and ready for auth seed/migration.
- Domain tests cover money/tax calculations and status behavior without database dependency.

## Phase 2: Persistence Models and Migrations

### Goal

Persist expense drafts, reviewed records, receipt evidence links, extraction suggestions, duplicate candidates, and ledger/tax-ready fields.

### Tasks

- [ ] Add or extend Prisma schema for `ExpenseRecord`, `ExpenseLine`, `ExpenseCategory`, `ReceiptExtraction`, `ReceiptAiVerification`, `ExpenseDuplicateCandidate`, and optional expense/payment link.
- [ ] Reuse `AttachmentObject` and `AttachmentLink`; do not create expense-specific file tables that duplicate storage primitives.
- [ ] Reuse item 08 `AccountingCounterparty` for vendors and item 08 `AccountingPayment` for paid expenses where available.
- [ ] Add unique constraints for company-scoped expense numbers where used.
- [ ] Add indexes for company, branch, status, uploaded date, expense/document date, vendor, tax evidence status, payment status, posting status, duplicate status, and primary attachment.
- [ ] Add vendor snapshot JSON and vendor display/tax snapshots.
- [ ] Add source document type/language, tax evidence status/reason, uploadedAt, and line-level price, quantity, tax, category, source line text, confidence/review status, and total fields.
- [ ] Add immutable confirmation metadata fields: reviewedByUserId, reviewedAt, confirmedByUserId, confirmedAt, rejectedByUserId, rejectedAt, rejectReason, voidedByUserId, voidedAt, voidReason.
- [ ] Add extraction metadata and bounded suggestion JSON.
- [ ] Add AI verification status, verified field provenance, inserted field provenance, confidence/warning metadata, and LINE message/event id fields.
- [ ] Add duplicate candidate records with reason codes and resolution state.
- [ ] Add migration and seed default expense categories if seed conventions exist.
- [ ] Add document sequence seed for `expense.record` if Data Model Core sequence exists and no sequence is present.
- [ ] Add repository ports and Prisma repositories.
- [ ] Add persistence tests for uniqueness, LINE message idempotency, attachment/expense company matching, confirmed lock fields, AI verification provenance, duplicate constraints, and category status.
- [ ] Add persistence tests for source document type/language and substitute receipt metadata.

### Exit Criteria

- Schema supports web upload, LINE upload, manual draft, extraction suggestion, AI verification insertion, review, confirmation, rejection, void, duplicate resolution, payment status, and source posting output.
- Confirmed expenses preserve evidence and snapshots without waiting for ledger/tax/AP/reimbursement modules.
- Drafts remain separable from confirmed accounting evidence.

## Phase 3: Storage, Upload, Extraction, and Worker Hooks

### Goal

Implement receipt/bill upload safely and make extraction optional but ready.

### Tasks

- [ ] Implement use case to create expense draft plus attachment upload intent using shared attachment storage port.
- [ ] Implement LINE media ingest use case that receives verified LINE event context, downloads media server-side, creates tenant-scoped attachment evidence, creates `LINE_UPLOAD` draft, and enforces idempotency by LINE message id.
- [ ] Implement LINE text-only expense-note ingest that receives verified LINE event context, uses AI semantic extraction for amount/purpose/date/category hints, suggests an active configured category, creates a `LINE_UPLOAD` draft without primary attachment, stores bounded redacted provenance, and returns a web review link.
- [ ] Implement AI/model-driven document-type classification for receipt, tax invoice, transfer slip, handwritten cash bill, supplier bill, marketplace order screenshot, text note, other document, and needs-review fallback.
- [ ] Implement upload completion use case that validates company, uploader permission, content type, file extension, size, object metadata, and object ownership.
- [ ] Link active attachment to `ExpenseRecord` with purpose `expense.receipt.primary` or `expense.receipt.supporting`.
- [ ] Add signed download/view URL query that checks expense/attachment policy before returning URL.
- [ ] Implement extraction port with methods for queue/request, process, and normalize suggestions.
- [ ] Implement AI verification port/use case that compares extraction output and receipt evidence against totals/tax/duplicate/vendor validations, then inserts only verified fields into draft/review data.
- [ ] Implement semantic category classification guard that inserts only active configured category ids/keys and marks uncertain category results `NEEDS_REVIEW`.
- [ ] Implement substitute receipt generation service for web review: requires missing receipt reason, reviewer identity, amount/category/tax review fields, and produces bounded review evidence.
- [ ] Implement signature asset storage using shared attachment primitives, including web upload and LINE AI signature-image intake, company ownership, `PENDING_OWNER_APPROVAL` -> `ACTIVE` lifecycle, original asset retention, derived background-removed asset, and audit-safe metadata.
- [ ] Implement LINE AI signature-image intake handoff from the item 10B LINE Intake Router Agent: use AI/model-driven image+text semantic detection for signature-upload intent, verify linked user/company/permission/MIME/size/idempotency, store pending signature candidate, create web owner-approval ticket, and reply with pending status plus web link without creating an expense draft. Ambiguous cases should ask for clarification or continue normal expense-document handling rather than opening a signature ticket.
- [ ] Implement owner approval action for company signature assets. Use workflow/task approval request primitives when available; otherwise expose a web pending-approval queue. Only OWNER or explicitly delegated owner-level approver can activate a signature asset.
- [ ] Implement signature fill service that renders a selected active signature asset into a substitute receipt/review evidence placeholder and records applier/provenance metadata.
- [ ] Implement accountant shared evidence query/package source service with uploaded-date and receipt-date filters, virtual year/month grouping, index rows, evidence manifest, tax evidence status/reasons, and attachment refs.
- [ ] Implement no-op/not-configured extraction provider when no OCR provider is configured.
- [ ] Implement no-op/not-configured AI verification behavior that leaves records in `NEEDS_REVIEW` and replies with manual-review guidance.
- [ ] Add worker/job handler only if worker queue conventions exist; otherwise expose application service and leave clear interface notes for worker integration.
- [ ] Store extraction status, suggested fields, AI verification status, inserted fields, confidence, warning codes, and redacted errors.
- [ ] Ensure logs, audit, and outbox do not include raw OCR/AI provider payloads, prompts, images, object keys, signed URLs, or file bodies.
- [ ] Add tests for upload validation, LINE webhook/media idempotency, cross-company attachment rejection, extraction-not-configured flow, AI verification partial/failure flow, and redaction.

### Exit Criteria

- User can upload receipt evidence into a draft expense through safe web or LINE attachment flow.
- Manual review works when OCR provider is absent.
- Extraction suggestions and AI verification provenance are stored separately from reviewed expense fields.

## Phase 4: API Use Cases and Controllers

### Goal

Implement web-owned expense workflows behind permission-checked API routes.

### Tasks

- [ ] Add expenses API module using existing hexagonal layout.
- [ ] Implement list/get expense use cases with filters and ABAC.
- [ ] Implement manual draft create/update use cases.
- [ ] Implement receipt upload create/complete use cases from Phase 3.
- [ ] Implement LINE receipt upload use case from Phase 3 behind existing LINE webhook routing.
- [ ] Implement LINE text-only expense-note use case from Phase 3 behind existing LINE webhook routing; do not route no-receipt expense notes only to generic Q&A when they contain amount and purpose/category.
- [ ] Implement extraction request/retry use case.
- [ ] Implement AI verification request/retry and verified-field insertion use case.
- [ ] Implement duplicate check, candidate confirm, candidate dismiss, and override reason behavior.
- [ ] Implement finance review update use case for source document type/language, vendor, date, document number, lines, price/quantity/tax, category/account hint, payment, branch, and notes.
- [ ] Block mark-ready and confirm for unresolved manual-web `NOT_EXPENSE_DOCUMENT`; allow only an explicit `expense.review` acknowledgement with reviewed source document type and bounded reason, while preserving original classification and HIGH-risk audit history.
- [ ] Implement confirm use case with required fields, totals validation, duplicate policy, attachment/missing receipt policy, closed-period hook, audit, outbox, and posting status.
- [ ] Implement reject use case with reason and posting status `not_required`.
- [ ] Implement void use case with reason, period policy hook, reversal-ready event, audit, and posting status update.
- [ ] Implement payment record/link use case using item 08 `AccountingPayment` when available.
- [ ] Implement category list/create/update/archive use cases.
- [ ] Add source posting input query/application service for item 10.
- [ ] Add server-side permission, tenant, branch, ownership/team, and status checks to every route.
- [ ] Add API/controller tests for auth, permission denial, cross-company hiding, web upload, LINE media upload, LINE text-only note upload, document-type classification, substitute receipt generation, category create/update/archive, AI verification/category insert, review, confirm, duplicate, payment, void, and source posting input behavior.

### Exit Criteria

- Finance can review and confirm/reject/void expenses through API.
- Staff can upload from web/LINE and manage own drafts only where policy allows.
- Server rejects unauthorized confirmation, void, payment, export, cross-company access, and invalid status transitions.

## Phase 5: Web Expenses Workspace

### Goal

Give finance and allowed users usable web expense capture/review workflows within the shared workspace.

### Tasks

- [ ] Add Expenses navigation entries using item 03 route registry/shell conventions.
- [ ] Add expense feature folder with API client, model, logic, constants, components, and CSS modules following web guideline.
- [ ] Add review queue with filters for status, submitted/uploaded date, receipt/document date, vendor, category, tax evidence status, payment status, posting status, duplicate status, and uploader.
- [ ] Add upload panel/dropzone that supports PDF/image files and mobile browser capture.
- [ ] Add manual expense create flow for finance or policy-allowed users.
- [ ] Add expense detail/review screen with receipt/document viewer, source document type/language, extraction suggestions, AI verification provenance, inserted-field markers, editable review fields, price/quantity/tax breakdown, duplicate warnings, payment section, category/account hint, attachment list, substitute receipt generation, status history, and posting status.
- [ ] Add signature upload/draw/import picker, LINE-created pending signature ticket state, owner approve/reject actions, remove-background action, transparent signature preview, and apply-to-placeholder action for substitute receipt/review evidence documents.
- [ ] Add accountant shared evidence view with virtual year/month folders, filters by uploaded date and receipt/document date, and signed preview/download actions.
- [ ] Add accountant package action/status UI that requests the generic Thai accounting-office index CSV/XLSX, shows package manifest, and opens evidence through permission-checked preview/download links.
- [ ] Add LINE-created draft indicators, LINE message/event safe metadata, and verification summary display.
- [ ] Add duplicate resolution controls with reason capture.
- [ ] Add confirm action with validation feedback.
- [ ] Add reject and void actions with reason input.
- [ ] Add paid/partial-paid status UI where payment permission exists.
- [ ] Add category management UI using the existing settings pattern when available; otherwise ship API-backed finance/admin create/update/archive controls plus a small finance-facing selector.
- [ ] Add read-only states for confirmed, rejected, voided, and unauthorized users.
- [ ] Add loading, empty, error, forbidden, extraction not configured, extraction failed, AI verification partial/failed, upload failed, LINE upload failed, duplicate warning, and closed-period blocked states.
- [ ] Keep UI dense and finance-friendly. Do not build marketing landing pages.
- [ ] Add UI logic/unit tests where current setup supports them.
- [ ] Run responsive smoke check for desktop and mobile widths if browser tooling exists.

### Exit Criteria

- Users can upload receipt evidence from web or LINE and see draft status.
- Finance can work a review queue and confirm/reject/void expense records.
- Receipt preview, extraction suggestions, AI verification provenance, duplicate warnings, and posting/payment status are clear on desktop and mobile.

## Phase 6: Ledger, Tax, Audit, Outbox, and Security Boundaries

### Goal

Protect expense evidence and make item 10/item 11 integration explicit without implementing their full modules.

### Tasks

- [ ] Implement deterministic `ExpenseSourcePostingInput` query/service.
- [ ] Add stable idempotency keys for confirmed, paid, voided, and reversed source events.
- [ ] Set posting status correctly for draft/rejected/confirmed/voided flows.
- [ ] Emit bounded outbox events for web/LINE upload, extraction, AI verification, AI field insertion, duplicate, confirmation, rejection, void, payment, and posting-state change.
- [ ] Add tax-ready source fields and query for item 11 without building tax reports.
- [ ] Add accountant package audit/outbox where export primitives exist; include filters hash, record count, manifest hash, actor, and source modules without raw file bodies.
- [ ] Add period-locked mutation check through an interface that item 10 can later implement.
- [ ] Audit successful and denied sensitive expense actions.
- [ ] Redact audit metadata to ids, numbers, hashes, totals, status changes, and reason text.
- [ ] Confirm no delete route exists for confirmed expense evidence.
- [ ] Confirm LINE/AI can only create receipt-upload drafts and insert AI-verified draft/review fields; they cannot confirm, reject, void, pay, export, post, or alter confirmed expenses.
- [ ] Add security tests for tenant isolation, permission denial, LINE signature/account-link checks, attachment URL policy, AI verification redaction, audit redaction, outbox redaction, and blocked closed-state mutation where current infrastructure allows.

### Exit Criteria

- Item 10 can generate journals from confirmed expense source ids without reading UI-only data.
- Item 11 can review expense-side tax fields without relying on ledger reports.
- Sensitive actions are audited and redacted.
- No raw storage/object/OCR/AI/LINE secrets leak through API, audit, outbox, or logs.

## Phase 7: Integration Tests, Seeds, and Operational Handoff

### Goal

Prove end-to-end expense flow and make implementation maintainable.

### Tasks

- [ ] Add seed data for expense categories and document sequence where seed conventions exist.
- [ ] Add end-to-end or integration tests for web upload -> complete -> review -> duplicate check -> confirm -> source posting input.
- [ ] Add end-to-end or integration tests for LINE receipt media -> draft -> extraction -> AI verification -> inserted fields -> review queue.
- [ ] Add integration test for LINE text-only note such as `ค่าเดินทาง 200 บาท` -> draft -> semantic category suggestion -> review queue.
- [ ] Add integration tests for transfer slip, handwritten cash bill, and marketplace screenshot -> draft -> document-type/category/tax-review behavior.
- [ ] Add integration tests for tax evidence status/reason on tax invoice, transfer slip, marketplace screenshot, handwritten bill, and text-only note cases.
- [ ] Add integration test for multi-line receipt -> multiple draft lines, plus low-confidence line extraction -> one summary line and `NEEDS_REVIEW`.
- [ ] Add integration test for substitute receipt generation from missing receipt reason -> review evidence -> confirm-ready draft.
- [ ] Add integration test for web signature upload and LINE AI semantic signature-image intake -> pending owner approval ticket -> approve -> background-removed derived asset -> fill signature placeholder -> rendered evidence attachment with audit metadata.
- [ ] Add LINE signature-intent tests proving unseen natural wording and signature-like image context can open a pending ticket without adding keyword rules, while ambiguous media does not open a ticket automatically.
- [ ] Add integration test for accountant shared evidence view showing only permitted expenses/attachments through web and signed URL checks.
- [ ] Add integration test for accountant package export source query/manifest using uploaded-date and receipt-date filters and blocking download after permission revocation.
- [ ] Add tests for manual expense without attachment requiring reason and permission.
- [ ] Add tests for company category create/update/archive and AI classification refusing unknown/inactive categories, including unseen wording that must not require keyword updates.
- [ ] Add tests for extraction-not-configured, extraction-failed, AI-verification-partial, and AI-verification-failed flows.
- [ ] Add tests for VAT included/excluded/no VAT/WHT calculations.
- [ ] Add tests for staff own-draft web/LINE access and finance confirmation.
- [ ] Add tests for auditor read-only access.
- [ ] Add tests for confirmed lock and void/reversal-ready event.
- [ ] Add tests for attachment download URL authorization.
- [ ] Add tests for source posting input completeness and redaction.
- [ ] Add module README or implementation notes covering source paths, key decisions, config, LINE upload flow, provider/no-op extraction/AI verification behavior, and item 10 handoff.
- [ ] Run verification commands.
- [ ] Record verification commands and results in implementation summary.

### Exit Criteria

- Core web upload, LINE upload, AI verification, review, and confirm workflow passes through API and web logic.
- Tests cover highest-risk money, permission, LINE, attachment, AI verification, audit, event, duplicate, and status behavior.
- Implementation summary tells item 10 where to read expense source posting inputs.

## Phase 8: Verification, Checklist Update, and Handoff

### Goal

Close item 09 only after implementation and verification are complete.

### Tasks

- [ ] Confirm all Phase 0 through Phase 7 exit criteria are complete.
- [ ] Confirm item 08 accounting counterparty/payment integrations were reused or extended additively.
- [ ] Confirm item 10 can generate expense and expense-payment journals from source posting inputs without table refactor.
- [ ] Confirm item 11 can read expense tax fields without relying on ledger reports.
- [ ] Confirm LINE receipt upload creates idempotent draft records and inserts only AI-verified draft/review fields with provenance.
- [ ] Confirm item 12 can later add procurement/AP workflow without replacing expense capture records.
- [ ] Confirm item 14 can later add reimbursement approval without replacing expense attachment/review records.
- [ ] Run final verification commands.
- [ ] Record skipped commands with concrete reasons.
- [ ] Update Master Implementation Checklist item 09 only after implementation and verification pass.

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
pnpm --filter @watchdog-bms/api prisma migrate dev --name expense_receipt_upload
```

If worker/extraction queue is implemented, also run current repo equivalents of:

```text
pnpm --filter @watchdog-bms/workers typecheck
pnpm --filter @watchdog-bms/workers test
```

If web implementation needs runtime verification, start the dev server and verify expense routes in browser at desktop and mobile widths.

### Exit Criteria

- Verification commands pass or failures are documented with concrete reasons.
- Implementation summary includes files changed, migrations, seed behavior, web/LINE upload behavior, extraction/AI verification config behavior, tests run, and known follow-ups.
- Master Implementation Checklist item 09 remains unchecked until all implementation work is actually complete.

## Review Checklist

- [ ] Expense upload uses shared attachment primitives.
- [ ] Upload completion validates tenant, permission, MIME type, extension, size, object metadata, and ownership.
- [ ] LINE upload validates signature, linked account, active company, permission, media metadata, idempotency, and safe media download.
- [ ] Object keys, storage credentials, signed URLs, raw file bodies, raw OCR provider payloads, raw AI prompts/outputs, and LINE secrets do not leak.
- [ ] Runtime upload config is used instead of hard-coded file limits.
- [ ] OCR/extraction is suggestion-only and optional.
- [ ] AI verification inserts only validated/confident draft fields and stores field-level provenance.
- [ ] Manual review works when OCR provider is missing.
- [ ] Drafts are editable; confirmed evidence and money/tax/vendor fields are locked.
- [ ] Confirmed expenses cannot be hard-deleted through user routes.
- [ ] Missing receipt requires reason and permission/policy.
- [ ] Duplicate warnings require resolution or override reason before confirmation.
- [ ] Vendor counterparty and payment primitives from item 08 are reused or extended additively.
- [ ] Vendor snapshots are stored on confirmation.
- [ ] Line totals and document totals are decimal-safe.
- [ ] VAT mode, input VAT claim status, and WHT fields are explicit and test-covered.
- [ ] Tax evidence status/reason is explicit, reviewable, and test-covered.
- [ ] Multi-line receipt split and one-line fallback are test-covered.
- [ ] Payment status and paid/outstanding amounts are clear and ledger-ready.
- [ ] Posting status is visible and set correctly.
- [ ] Source posting input is deterministic and complete.
- [ ] Outbox events are bounded, redacted, and idempotent.
- [ ] Sensitive actions are audited with redacted metadata.
- [ ] Server enforces tenant, permission, branch, own/team ABAC, and status checks.
- [ ] Web routes do not bypass server permissions.
- [ ] Web feature code follows shared folder and CSS module conventions.
- [ ] UI shows locked, forbidden, empty, loading, extraction failed, AI verification partial/failed, web/LINE upload failed, duplicate, and error states.
- [ ] AI Gateway does not import or use API Prisma client/expense repositories directly.
- [ ] LINE/AI draft creation and verified field insertion go through allowlisted use cases only.
- [ ] No LINE or AI final confirmation/payment/void/export/posting mutation exists.
- [ ] LINE/AI can create a pending signature-image ticket only through the allowlisted intake path; it cannot approve, activate, background-remove, apply signatures, administer signature assets, or expose accountant shared evidence outside web permission checks.
- [ ] Accountant package export/download uses current web/export permission checks and never public folder links. Manifest/download links re-check permission per file and must not be permanent public URLs.
- [ ] No GL, journal posting, trial balance, P&L, balance sheet, tax filing, AP aging, bank reconciliation, or reimbursement approval workflow exists in item 09.

## Definition of Done

- Phase 0 through Phase 8 exit criteria are complete.
- Web and LINE receipt/bill upload create safe expense drafts.
- AI verification inserts correct draft/review data only when evidence, totals, confidence, duplicate, and permission checks pass.
- Manual review works with or without OCR provider.
- Finance can review, correct, confirm, reject, void, and record payment status for expenses.
- Staff/policy-allowed users can upload from web/LINE and manage own drafts only.
- Confirmed expenses are locked, audited, duplicate-aware, tax-ready, and ledger-posting ready.
- Item 10 can consume deterministic source posting inputs and lifecycle events.
- Item 11 can read tax-ready expense fields.
- Tests cover money, web/LINE upload, AI verification insertion, storage, status, permission, duplicate, audit, outbox, and source posting boundaries.
- Verification commands and results are recorded in implementation summary.

## Historical First Implementation Handoff

```text
Implement Master Implementation Checklist item 09: Expense and Receipt Upload.

Start with docs/plans/expense-receipt-upload-plan.md Phase 0 and Phase 1 only. Read docs/specs/expense-receipt-upload-spec.md, accounting documents spec, double-entry ledger spec, data model core spec, permission matrix, auth/RBAC spec, LINE AI read-only assistant spec, LINE channel/auth spec, web core spec, platform environment config spec, Thai tax spec, backend/frontend/security guidelines, and ADR 0006 before editing.

Inspect current repo state first. If Prisma/auth/audit/outbox/document sequence/attachment/accounting counterparty/accounting payment/LINE webhook/AI Gateway/web shell already exists, extend it. Implement LINE receipt upload as draft creation plus AI verification/verified field insertion only; do not implement LINE final confirmation/payment/void/export/posting. If schema, route, storage, permission, OCR/AI provider, LINE, or UI conflicts appear, stop and report them before coding. Keep item 09 unchecked until all phases and verification pass.
```

## Compressed-image duplicate follow-up — 2026-07-29

- [x] Compute a server-side perceptual hash for verified JPEG/PNG bytes using the already-locked `sharp` version and declare it directly for the API.
- [x] Persist the optional hash on `AttachmentObject` through an additive migration.
- [x] Reuse one duplicate-candidate function for web upload, direct LINE upload, deferred LINE receipt confirmation, manual review, and post-OCR checks.
- [x] Normalize OCR document number, tax id, date, and amount before deterministic scoring.
- [x] Fall back to normalized OCR vendor name for vendor/date/amount matching before a draft is linked to a vendor counterparty, so different-angle photos of the same bill remain detectable.
- [x] Keep visual and OCR matches advisory as `POSSIBLE_DUPLICATE`; never auto-reject, merge, or confirm.
- [x] Run focused tests, Prisma validation, and API typecheck; record evidence in task memory.

## Focused Follow-up — Automatic Expense Category Suggestion (2026-07-30)

Status: shipped and locally verified 2026-07-30. Canonical product rules are in `docs/specs/expense-receipt-upload-spec.md` §19e.

Smallest-change plan:

- [x] Reconcile the existing category catalogue, receipt OCR contract/parser, shared OCR apply service, web extraction path, LINE media path, permissions, and current focused tests.
- [x] Specify one-category semantics, active-catalogue bounds, evidence/confidence gates, preservation of reviewed data, web/LINE parity, and explicit GL/tax exclusions.
- [x] Extend the existing receipt OCR request/result contract and prompt with a bounded active catalogue and an optional evidence-backed category suggestion. Do not add a model-selectable accounting tool or dependency.
- [x] Revalidate category company/status inside the shared API transaction; write the same effective category to the header and OCR-derived line; preserve any existing header category.
- [x] Pass the catalogue through both web and LINE OCR paths. Permit the existing LINE route hint only as a confidence-gated fallback, never as an override of a valid OCR result.
- [x] Normalize the `category` missing-field result against the effective stored category so Finance sees the correct review state.
- [x] Add focused gateway parser/prompt, extraction-use-case, and apply-service tests, then run relevant typechecks/tests.
- [x] Record verification evidence and final shipped state in this plan and `docs/agent-memory/expense-receipt-auto-category.md`.

Acceptance evidence required:

- Valid active high-confidence exact-evidence suggestions auto-fill both header and derived line.
- Unknown, inactive, foreign-company, low-confidence, or evidence-free suggestions are ignored.
- Re-extraction preserves a Finance-selected category.
- Web and LINE both send the active catalogue and remain usable when no category is selected.
- No new endpoint, database column, dependency, AI tool, direct AI-to-repository access, or final accounting mutation is introduced.

Verification evidence:

- AI Gateway receipt controller/parser/classification tests: 27/27 passed.
- API shared apply + web extraction + LINE webhook tests: 77/77 passed.
- Contracts, AI Gateway, and API TypeScript typechecks passed; contracts build passed.
- `git diff --check` passed.

## Capture-first payment integrity follow-up — 2026-08-27

Scope: spec §19m; no P28 credit policy, bank connections, matching, reconciliation, or
subscription changes. Baseline: `d2b40f37948d482c1bdd29c6047551c4258f24a7`.

- [x] Trace the real review-page/API/use-case/repository caller and AccountingPayment
  idempotency precedent; agree the optional-key legacy compatibility contract.
- [x] Add nullable company-unique expense payment intent/fingerprint fields and migration.
- [x] Keep replay, company-scoped source reread/branch comparison, payment/totals, audit,
  and outbox inside the existing transaction/lifecycle lock. Command-entry permission
  uses resolved request context; no fresh DB permission resolution inside the transaction.
- [x] Add the actual civil paid-date field and stable retry intent to the existing panel.
- [x] Extend registered DTO/use-case/repository/web tests, including real isolated
  PostgreSQL concurrency and rollback; require PostgreSQL execution in existing CI job.
- [x] Run focused/typecheck/full relevant checks; initial author-only freeze was followed
  by root's integration evidence and merged delivery below.
- [x] Resolve the Opus review's initial-refusal UX finding: distinguish definitive first
  4xx from uncertain network/408/5xx outcomes, preserve earlier uncertainty on a later
  refusal, and block same-key retry on an explicit idempotency conflict. Verify the
  classifier and success/edit reset in the registered model suite.
- [x] Bootstrap only the root-authorized isolated local DB/MinIO bucket and API port 3003;
  retain them for root's browser QA. No shared DB or cloud mutation.
- [x] Author/list/typecheck EXP-28 in the existing expense E2E file for initial refusal,
  uncertain retry, conflict, and explicit edit. Only payment error responses are mocked;
  its owned confirmed receipt fixture is voided through the supported endpoint in finally.
  EXP-27's real payment test remains unchanged. Add the payment method's accessible label.
- [x] Keep the payment intent after a known successful POST until a direct detail refresh
  succeeds; persistent Thai saved/refresh-pending guidance permits only safe original-key
  retry or the existing deliberate-edit exit. Shared load/classifier/backend unchanged.
  Author/list/typecheck EXP-29 for real payment, failed following GET, exact replay and
  one payment row; final browser execution belongs to root. EXP-27/28 remain unchanged.
- [x] Root completes desktop/mobile browser evidence and independent review: combined
  E2E33/33 (accounting6 + AP6 + expense21), zero skipped/flaky, web1139/1139,
  eight-suite checks128/128 (including 6 real PostgreSQL cases), real Chrome manual draft
  and six inspected images; see memory
  for real-versus-mocked boundaries and Opus/root dispositions.
- [x] Rebase onto develop21f109d5 and rerun integration checks; PR #287 merged at
  `111532966c415fee11abb36ca1749bf1fc66ee52`, 2026-08-27T04:36:17Z after CI `33039136161`
  SUCCESS on `179981a45f00a1d0b3a1898dce9f877f2457563e`. No shared DB migration or
  main/Production promotion in this phase.

Evidence and exact commands live in
`docs/agent-memory/expense-payment-capture-integrity.md`. Existing unkeyed rows stay
compatible; external callers generating fresh request IDs still represent new payments.
The migration's validating CHECK takes an ACCESS EXCLUSIVE lock and scans existing rows;
its non-concurrent unique-index build also locks writes. Both require production operator
timing review before deployment; this task does not authorize shared DB migration.

## Risks

- Items 01 through 08 may introduce different schema, auth, request context, route, storage, or UI conventions. Mitigation: Phase 0 reconciliation before edits.
- Upload docs contain different example file-size defaults. Mitigation: runtime config is source of truth.
- OCR/AI verification may be absent or unreliable. Mitigation: no-op/not-configured providers, confidence gates, validation guards, provenance, and mandatory manual review.
- LINE webhook/media handling can create duplicate drafts under retries. Mitigation: signature validation and idempotency by LINE message id.
- Vendor/payment primitives may be incomplete from item 08. Mitigation: extend item 08 primitives additively, do not duplicate.
- Ledger needs stable source data but item 09 must not implement ledger. Mitigation: source posting input contract plus outbox events only.
- Expense and AP/procurement boundaries can blur. Mitigation: item 09 covers simple expense capture; item 12 owns purchase workflow and AP aging.
- Reimbursement boundaries can blur. Mitigation: item 09 stores expense evidence; item 14 owns reimbursement approval/payout.
- Money totals can drift if calculated with JavaScript floats. Mitigation: decimal type and tested calculator functions.
- Raw file/OCR/AI/LINE data can leak through logs/audit/outbox. Mitigation: redaction tests and bounded payload rules.
- AI/LINE mutation can creep beyond draft capture. Mitigation: allowlisted draft-create/verify tools and explicit blocked final-mutation tests.

## Resolved Product Decisions 2026-07-03

- Accountant package template: use a generic Thai accounting-office package by default, not a vendor-specific copied format. Include the exact index CSV/XLSX columns from the spec and `evidence_manifest.json` with permission-checked evidence download links. A custom accounting-office template can be added later when a real office provides required columns, ordering, and file naming.
- Signature ownership: signatures are company-level assets. Web upload/draw/import or LINE AI signature-image submission creates a pending signature and web approval ticket; OWNER approval is required before the signature becomes active and reusable. Per-user personal signatures stay out of scope until requested.
- Background removal implementation: first pass uses deterministic light-background removal in the existing web stack where practical: normalize/crop, make near-white/light pixels transparent, preserve dark ink, preview before saving a derived PNG, and keep the original. Add server-side image processing or an AI/background-removal service only if real signature samples fail this path.
- Bundled archive: first pass does not create bundled archives. Use `evidence_manifest.json` plus individual permission-checked signed downloads. Add archive generation only if the owner later asks for offline archives.

## Backlog After MVP

- Typhoon OCR provider implementation for receipt/tax-invoice AI capture. See [[plans/typhoon-receipt-ocr-plan|Typhoon Receipt OCR Plan]].
- Vendor-specific extraction templates.
- Optional LINE explicit-confirmation policy for low-risk expenses, if owner later approves security/audit gates.
- Expense policy engine and configurable approval thresholds.
- Corporate card feed and bank matching.
- Procurement/AP integration.
- Reimbursement approval and repayment integration.
- Fixed asset capitalization workflow.
- Custom accountant-office package templates beyond the default index/manifest/evidence package.
