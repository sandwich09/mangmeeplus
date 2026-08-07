# Procurement, Supplier, and Accounts Payable Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 12.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/procurement-supplier-ap-spec|Procurement, Supplier, and Accounts Payable Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 12. Procurement, Supplier, and Accounts Payable
- Related specs:
  - [[specs/accounting-documents-spec|Accounting Documents Spec]]
  - [[specs/inventory-mvp-spec|Inventory MVP Spec]]
  - [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
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
  - [[adr/0003-inventory-stock-balance-source-of-truth|ADR 0003 Inventory Stock Balance Source of Truth]]
  - [[adr/0004-inventory-movement-immutability|ADR 0004 Inventory Movement Immutability]]
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the purchase-to-pay slice for WatchDog-BMS:

- Supplier master.
- Purchase request and purchase order approval.
- Goods receipt linked to inventory stock movements.
- Vendor bill matching, approval, and tax review.
- Supplier payment recording and allocation.
- AP aging and supplier statement.
- Ledger/tax source adapters.
- Web workflow and read-only AI/LINE summaries.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 12 follows these completed or planned foundations:

- Item 05 inventory owns product, location, immutable movements, and movement-derived balance.
- Item 08 accounting documents owns shared `AccountingCounterparty` and payment hooks including `direction = PAID`.
- Item 09 expense upload owns OCR/manual receipt expense capture and confirms simple expenses.
- Item 10 ledger owns chart of accounts, posting rules, source posting adapter contract, journals, and period close.
- Item 11 tax owns VAT/WHT/PP36 source event sync, reports, filing status, and WHT certificates.

Before implementation, inspect latest code again because items 01 through 11 may add Prisma, auth, request context, audit, outbox, document sequence, attachment storage, inventory APIs, accounting payment tables, ledger source adapters, tax source adapters, web shell routes, shared API client, and permission registry.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Owner decisions confirmed on 2026-06-23:

- Direct vendor bill without purchase order is allowed for `FINANCE` by default.
- Matching tolerance starts at zero amount/quantity variance; differences require override permission and reason.
- Supplier full bank account number storage is deferred when encryption/tokenization primitives are absent.

Start point:

1. Read this plan first.
2. Read `docs/specs/procurement-supplier-ap-spec.md`.
3. Read `docs/specs/accounting-documents-spec.md`.
4. Read `docs/specs/inventory-mvp-spec.md`.
5. Read `docs/specs/expense-receipt-upload-spec.md`.
6. Read `docs/specs/double-entry-ledger-closing-spec.md`.
7. Read `docs/specs/tax-thailand-2026-spec.md`.
8. Read `docs/specs/permission-matrix.md`.
9. Read backend/frontend/security guidelines.
10. Inspect `apps/api`, `apps/web`, `apps/workers`, `packages/contracts`, `packages/config`, and current Prisma state.
11. Start at Phase 0: Baseline and Integration Reconciliation.

Do not mark Master Implementation Checklist item 12 complete until Phase 0 through Phase 11 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 11.
- Extend existing Prisma/auth/audit/outbox/document-sequence/attachment/request-context primitives. Do not duplicate them.
- Supplier master must reuse or extend item 08 `AccountingCounterparty` with type `VENDOR` or `BOTH`.
- Do not create a competing vendor master, payment ledger, inventory balance table, tax filing table, or ledger posting table.
- Prefer reusing item 08 `AccountingPayment` with `direction = PAID` for supplier payments when it exists. If an AP facade is useful, keep it backed by the shared payment model or documented adapter.
- Goods receipt must create inventory movements through item 05 use cases/API/ports. Do not write inventory balance directly.
- If inventory only supports generic incoming movement types, use `stock_in` with `referenceType = goods_receipt`.
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, DB mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Use decimal-safe money and quantity calculations. Use strings across shared contracts.
- Use official document sequences from Data Model Core when available.
- Use transactions for document issue/post/approve/pay/void plus audit/outbox/source status updates where repository support exists.
- Issued PO, posted goods receipt, approved vendor bill, and recorded payment are locked. Corrections use void/reversal/adjustment workflows.
- Respect ledger period close when item 10 exists.
- Respect tax filed/closed period policy when item 11 exists.
- Keep AP payment recording separate from external bank transfer execution and bank reconciliation.
- LINE and AI remain read-only. All mutations happen in web/API.
- AI Gateway must call permission-checked ERP APIs/tools only. It must not import API Prisma client or procurement repositories.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared procurement/AP contracts in `packages/contracts`.
- API module(s) for procurement and accounts payable using hexagonal folder structure.
- Supplier profile linked to shared counterparty.
- Purchase request, purchase order, approval events, goods receipt, vendor bill, matching, supplier payment, allocations, AP aging, and supplier statement.
- Permission keys and default grants.
- Audit and outbox integration where primitives exist.
- Inventory movement integration for goods receipt.
- Ledger source posting inputs and posting status writer/reader integration.
- Tax source payloads for input VAT, WHT, and PP36 review candidates.
- Web procurement/AP feature folders and routes.
- Read-only AI/LINE tools or API payloads when current AI Gateway integration points exist.
- Tests for contracts, domain logic, use cases, API behavior, UI behavior, and permission boundaries where current test setup supports them.

### Out of Scope

- RFQ, supplier quote comparison, supplier portal, EDI, e-invoicing network.
- Bank account master, bank statement import, reconciliation, or actual bank transfer initiation.
- Receipt OCR extraction beyond linking existing attachment/evidence primitives.
- Journal generation or account setup UI beyond source posting payloads.
- Tax filing/export/certificate generation beyond source event payloads.
- Landed cost, multi-currency revaluation, lot/batch/serial/bin receiving, MRP, and advanced warehouse.
- Fixed asset register and depreciation.
- Payroll, reimbursement, sales, CRM, marketplace, manufacturing.
- LINE/AI procurement or AP mutation.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- IDs: repo standard; otherwise `String @id @default(cuid())`.
- Currency: explicit `THB` string by default.
- Document sequence keys:
  - `procurement.supplier`
  - `procurement.purchase_request`
  - `procurement.purchase_order`
  - `procurement.goods_receipt`
  - `accounts_payable.vendor_bill`
  - `accounts_payable.payment`
- Route bases:
  - `/v1/companies/:companyId/procurement`
  - `/v1/companies/:companyId/accounts-payable`
- AP aging buckets: `0-30`, `31-60`, `61-90`, `90+` days overdue plus `not_due`.
- Matching default: stock lines require three-way match; service/non-stock lines require two-way match.
- Matching tolerance default: zero amount/quantity variance. Any difference requires override permission and reason.
- Direct PO allowed for `FINANCE`, `OWNER`, and `ADMIN` by default. Staff uses purchase request.
- Direct vendor bill without PO allowed for `FINANCE` by default and must be audit-visible.
- Supplier overpayment blocked by default.
- Supplier full bank account number storage deferred when encryption/tokenization primitive is absent; store masked/last4 display data only.
- Goods receipt void after inventory movement blocks unless item 05 exposes safe reversal.
- LINE/AI mutation refused with web deep link.

## Phase 0: Baseline and Integration Reconciliation

### Goal

Confirm current implementation state and choose exact extension points without duplicating previous work.

### Tasks

- [ ] Inspect root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and package scripts.
- [ ] Inspect `apps/api/package.json`, `apps/api/src/common`, `apps/api/src/modules`, and current Prisma state.
- [ ] Inspect existing modules for accounting, inventory, expense, ledger, tax, auth, audit, outbox, document sequence, attachments, and request context.
- [ ] Confirm whether `AccountingCounterparty` exists and how vendor/customer types are represented.
- [ ] Confirm whether `AccountingPayment` with `direction = PAID` exists.
- [ ] Confirm inventory movement API/use case names, movement enum values, source reference fields, and reversal policy.
- [ ] Confirm ledger source adapter names, posting status writer contract, and period close policy hook.
- [ ] Confirm tax source adapter names, event sync contract, and filed/closed tax period policy hook.
- [ ] Confirm current permission key registry and seed location.
- [ ] Confirm current web route registry, navigation pattern, API client, loader, table, form, modal/drawer, dictionary/i18n, and error state primitives.
- [ ] Confirm current AI Gateway tool registration pattern if item 07 exists.
- [ ] Confirm current test commands for root, API, web, workers, contracts, config, and Prisma.
- [ ] Decide extension path for supplier profile, payment reuse, procurement/AP module split, and source adapter wiring.
- [ ] Record conflicts or unavailable primitives in implementation notes before coding.

### Tests

- No code tests required unless reconciliation changes setup.

### Exit Criteria

- Implementer knows exact files to touch.
- Implementer knows whether to add or extend Prisma.
- Implementer knows payment reuse path.
- Implementer knows inventory, ledger, tax, audit, outbox, permission, and web integration points.
- No duplicate vendor/payment/inventory/ledger/tax primitive plan remains unresolved.

## Phase 1: Contracts, Domain Model, and Pure Logic

### Goal

Create framework-free procurement/AP contracts and business logic before persistence and HTTP wiring.

### Tasks

- [ ] Add or extend `packages/contracts/src/procurement.ts`.
- [ ] Export procurement/AP contracts from `packages/contracts/src/index.ts`.
- [ ] Add API module folder(s), following current conventions:
  - `apps/api/src/modules/procurement/domain/models`
  - `apps/api/src/modules/procurement/domain/logic`
  - `apps/api/src/modules/procurement/domain/ports`
  - `apps/api/src/modules/procurement/application/use-cases`
  - `apps/api/src/modules/procurement/application/dto`
  - `apps/api/src/modules/procurement/infrastructure`
  - `apps/api/src/modules/procurement/presentation/http`
- [ ] If repo convention prefers separate AP module, create `accounts-payable` module with same hexagonal structure and shared domain contracts.
- [ ] Define enums and contract DTOs for supplier, purchase request, purchase order, goods receipt, vendor bill, matching, supplier payment, AP aging, supplier statement, posting status, and tax sync status.
- [ ] Define domain errors with stable codes for forbidden, not found, duplicate supplier document number, invalid status transition, locked record, self-approval, threshold exceeded, match blocked, over receipt, inventory failure, overpayment unsupported, period closed, tax period closed, and missing source dependency.
- [ ] Add pure logic:
  - purchase document total calculation
  - approval threshold check
  - self-approval guard
  - purchase request status transitions
  - purchase order status transitions
  - receipt quantity/tolerance validation
  - vendor bill two-way and three-way matching
  - variance override eligibility
  - supplier payment allocation and remaining balance
  - AP aging bucket calculation
  - source posting input mapping
  - tax source event candidate mapping
  - safe redaction for supplier bank details

### Tests

- `packages/contracts` typecheck.
- Domain unit tests for totals and decimal-safe math.
- Domain unit tests for approval threshold and self-approval.
- Domain unit tests for PO/PR/status transition guards.
- Domain unit tests for goods receipt tolerance.
- Domain unit tests for vendor bill matching.
- Domain unit tests for payment allocation and AP aging buckets.
- Domain unit tests for source posting and tax payload mapping.

### Exit Criteria

- Contracts compile and export from shared package.
- Core business rules are testable without NestJS, Prisma, or web.
- Domain errors have stable codes usable by API and web.

## Phase 2: Database Model, Migrations, and Seeds

### Goal

Persist procurement/AP state using existing data model primitives and indexes.

### Tasks

- [ ] Extend existing Prisma schema or ORM model with additive procurement/AP tables.
- [ ] Link supplier profile to existing `AccountingCounterparty`.
- [ ] Reuse existing payment table for supplier payments if practical; otherwise create AP payment table with adapter notes.
- [ ] Add purchase request, request line, purchase order, order line, goods receipt, receipt line, vendor bill, bill line, match row, supplier payment/allocation, supplier bank account, and approval event models as needed.
- [ ] Add enums or constrained string fields according to repo convention.
- [ ] Add unique constraints:
  - supplier code per company when present
  - supplier profile per counterparty
  - purchase document numbers per company
  - vendor bill number per company when present
  - supplier document number per company/supplier when present
- [ ] Add indexes for company/status/date/supplier/branch/posting/tax/match filters.
- [ ] Add permission seed entries and default role grants.
- [ ] Add document sequence seeds if Data Model Core sequence exists.
- [ ] Add default matching settings if config/settings primitive exists; otherwise use documented domain default and record settings backlog.
- [ ] Add migration and seed tests or smoke commands where repo supports them.

### Tests

- Prisma/schema validation.
- Migration generation/validation.
- Seed smoke test for permissions/sequences when seed command exists.
- Repository mapping unit tests if current repo style supports them.

### Exit Criteria

- Schema is additive and does not duplicate shared company, branch, counterparty, audit, outbox, payment, inventory, ledger, or tax primitives.
- Query indexes support primary list/report screens.
- Permission and sequence seeds are available.

## Phase 3: Supplier Master and Settings

### Goal

Implement supplier profile behavior linked to shared counterparty and safe sensitive data handling.

### Tasks

- [ ] Implement supplier repository/query ports.
- [ ] Implement create supplier use case that creates/links `AccountingCounterparty` as `VENDOR` or `BOTH`.
- [ ] Implement update supplier use case with status/on-hold/archive policy.
- [ ] Implement supplier list/detail queries.
- [ ] Implement masked supplier bank account list and manage use cases.
- [ ] Defer full bank number storage when encryption/tokenization primitives are absent.
- [ ] Add audit for supplier create/update and bank detail reads/writes where audit exists.
- [ ] Add outbox events for supplier create/update where outbox exists.
- [ ] Add permission checks for supplier profile and bank detail routes.

### Tests

- Supplier create links shared counterparty.
- Existing customer counterparty can become supplier/BOTH without duplicate.
- Supplier update does not mutate historical document snapshots.
- Bank account list returns masked data only.
- Missing bank permission returns `403`.

### Exit Criteria

- Supplier master works independently before purchase documents.
- Sensitive fields are redacted and permission-protected.

## Phase 4: Purchase Request and Purchase Order Workflow

### Goal

Implement approval-backed purchase commitment workflow.

### Tasks

- [ ] Implement purchase request create/update/list/detail/submit/approve/reject/cancel.
- [ ] Implement PR to PO conversion.
- [ ] Implement direct PO create/update when policy allows.
- [ ] Implement PO submit/approve/reject/issue/cancel/close.
- [ ] Integrate document sequence for request/PO numbers.
- [ ] Capture supplier and line snapshots on PO issue.
- [ ] Implement approval threshold and self-approval checks.
- [ ] Update line received/billed rollups from later phases through ports.
- [ ] Audit submit/approve/reject/issue/cancel/close.
- [ ] Emit outbox events for approval and PO issue/cancel.

### Tests

- Staff creates PR but cannot self-approve by default.
- Manager approval respects threshold and branch scope.
- Approved PR converts to PO with lines/totals.
- PO issue assigns sequence and locks fields.
- PO cancel blocks after receipt/bill exists.
- Unauthorized issue/approve returns `403`.

### Exit Criteria

- Purchase request/order lifecycle works through use cases.
- Issued PO is immutable except allowed close/cancel state changes.

## Phase 5: Goods Receipt and Inventory Integration

### Goal

Receive purchased goods and create inventory movements safely.

### Tasks

- [ ] Implement goods receipt create/update/list/detail from issued PO.
- [ ] Implement receipt quantity validation and tolerance rules.
- [ ] Map stockable lines to inventory movement requests.
- [ ] Use inventory API/use case/port to create incoming movement with `goods_receipt` source refs.
- [ ] Update PO line received quantities and PO status.
- [ ] Support service/non-stock received state without inventory movement.
- [ ] Implement posted receipt immutability.
- [ ] Implement receipt void policy:
  - no movement -> void allowed
  - safe reversal exists -> create reversal/adjustment
  - no reversal -> block with `inventory_reversal_unavailable`
- [ ] Audit receipt post/void.
- [ ] Emit outbox events for goods receipt posted/voided.

### Tests

- Receipt post creates inventory movement for stockable line.
- Service line receipt does not create inventory movement.
- Over-receipt blocks unless override permission/policy exists.
- PO status becomes partially received/received.
- Receipt void blocks when inventory reversal unavailable.
- Inventory failure rolls back receipt or leaves consistent compensating state.

### Exit Criteria

- Goods receipt is source-linked to inventory movement.
- No procurement code writes inventory balance directly.

## Phase 6: Vendor Bill, Matching, and Tax Review

### Goal

Implement vendor bill workflow with purchase/receipt matching and tax-ready fields.

### Tasks

- [ ] Implement vendor bill create/update/list/detail from PO, goods receipt, attachment/evidence, or direct policy.
- [ ] Implement duplicate supplier document number guard.
- [ ] Implement two-way and three-way matching.
- [ ] Implement matching variance calculation and override with reason.
- [ ] Implement bill submit/approve/reject/void.
- [ ] Lock vendor bill fields on approval.
- [ ] Set posting status `pending` on approved accounting-relevant bills.
- [ ] Set tax sync status `pending` or `not_required` from tax fields.
- [ ] Generate tax review issues for missing supplier tax id, missing branch code, missing tax invoice date, inconsistent VAT, unknown WHT category, and PP36 candidate.
- [ ] Update PO billed quantities and billed status.
- [ ] Audit bill create/match override/approve/reject/void.
- [ ] Emit outbox events for bill approval/void and status changes.

### Tests

- Vendor bill from PO matches expected quantities and amounts.
- Stock bill without receipt blocks under three-way match.
- Service bill can use two-way PO/bill match.
- Match variance blocks approval until override.
- Duplicate supplier document number blocks.
- Approval locks bill fields and sets posting/tax status.
- Void checks payment/posting/period/tax state.

### Exit Criteria

- Vendor bill can be approved only after matching/tax review rules pass or are explicitly overridden.
- Approved bills expose deterministic source state for ledger/tax.

## Phase 7: Supplier Payment, AP Aging, and Supplier Statement

### Goal

Record supplier payments, allocate them to approved bills, and expose AP visibility.

### Tasks

- [ ] Confirm payment reuse path from Phase 0.
- [ ] Implement supplier payment create/list/detail/void.
- [ ] Implement payment allocation to approved unpaid bills.
- [ ] Implement partial payment behavior.
- [ ] Block overpayment by default.
- [ ] Capture WHT category/rate/amount and net paid amount.
- [ ] Update vendor bill paid/outstanding status.
- [ ] Set payment posting status `pending`.
- [ ] Set payment tax sync status for WHT events.
- [ ] Implement AP aging query by as-of date, supplier, branch, bucket, and currency.
- [ ] Implement supplier statement query with bills, credits, payments, allocations, and running balance.
- [ ] Audit payment record/void and report export when supported.
- [ ] Emit outbox events for supplier payment recorded/voided and overdue detections if worker exists.

### Tests

- Payment allocates to approved bills only.
- Partial payment leaves bill partially paid.
- Full payment marks bill paid.
- Overpayment blocks by default.
- WHT amount reduces net paid and creates tax source candidate.
- AP aging bucket calculation is deterministic.
- Supplier statement running balance is reproducible.

### Exit Criteria

- AP users can see and manage unpaid exposure.
- Supplier payment recording does not imply bank transfer execution or reconciliation.

## Phase 8: Ledger, Tax, Audit, Outbox, and Worker Hooks

### Goal

Connect procurement/AP source records to ledger/tax modules and background notifications without crossing ownership boundaries.

### Tasks

- [ ] Implement ledger source reader for vendor bill and supplier payment source posting inputs.
- [ ] Implement ledger posting status writer for item 12 source records.
- [ ] Implement closed-period assertion calls before approve/pay/void/correction when ledger policy exists.
- [ ] Implement tax source payload builder for input VAT, WHT, and PP36 candidates.
- [ ] Implement tax sync status update callbacks or source event sync API calls when tax module exists.
- [ ] Implement filed/closed tax period assertion calls before tax-sensitive mutation when tax policy exists.
- [ ] Ensure source adapters are idempotent by source id and checksum.
- [ ] Ensure audit metadata is bounded/redacted.
- [ ] Ensure outbox payloads are bounded/redacted.
- [ ] Add worker hook for overdue AP detection only if workers/notification primitives exist; otherwise expose query and document backlog.

### Tests

- Ledger source posting input matches approved bill amounts and lines.
- Supplier payment posting input maps WHT correctly.
- Posting status writer updates only item 12 source record through adapter.
- Closed period blocks bill/payment/void mutation.
- Tax payload creates review issue instead of inferred missing values.
- Tax filed period blocks silent tax source mutation.
- Outbox payload does not include unmasked bank data or full attachments.

### Exit Criteria

- Ledger and tax can consume item 12 without direct table writes.
- Period/tax close policies are respected where modules exist.

## Phase 9: HTTP API Controllers

### Goal

Expose procurement/AP behavior through permission-protected HTTP routes.

### Tasks

- [ ] Register procurement/AP module(s) in API app module.
- [ ] Add controllers for supplier routes.
- [ ] Add controllers for purchase request routes.
- [ ] Add controllers for purchase order routes.
- [ ] Add controllers for goods receipt routes.
- [ ] Add controllers for vendor bill and AP report routes.
- [ ] Add controllers for supplier payment routes.
- [ ] Use existing request context/company/branch/permission decorators and guards.
- [ ] Use DTO validation and stable domain error mapping.
- [ ] Add pagination/filter/sort behavior following existing API conventions.
- [ ] Add OpenAPI metadata if current API conventions include Swagger decorators.
- [ ] Ensure no route returns unmasked bank details, raw attachment bodies, signed URLs, secrets, or unrestricted audit metadata.

### Tests

- Controller/API tests for success paths.
- API validation tests for malformed payloads.
- API permission tests for every mutation class.
- API tenant/branch isolation tests.
- API error mapping tests for locked, match blocked, inventory failed, period closed, and tax period closed.

### Exit Criteria

- API surface matches spec or records intentional route-convention differences.
- Protected routes deny by default and enforce server-side permissions.

## Phase 10: Web Procurement/AP Workspace

### Goal

Build web-owned purchase-to-pay user workflows with shared workspace patterns.

### Tasks

- [ ] Add feature folders under current web convention, likely:
  - `apps/web/src/features/procurement`
  - `apps/web/src/features/accounts-payable`
- [ ] Add or extend routes/navigation:
  - suppliers
  - purchase requests
  - purchase orders
  - goods receipts
  - vendor bills
  - supplier payments
  - AP aging
  - supplier statement
- [ ] Add feature API files and typed models.
- [ ] Add supplier list/detail/form and masked bank detail management.
- [ ] Add purchase request list/form/approval queue.
- [ ] Add purchase order list/detail/create/convert/issue/cancel/close.
- [ ] Add goods receipt receive/post workflow.
- [ ] Add vendor bill inbox/form/matching/approval workflow.
- [ ] Add supplier payment form/allocation workflow.
- [ ] Add AP aging and supplier statement views with drill-down.
- [ ] Add forbidden, readonly, empty, loading, validation-error, inventory-error, match-blocked, period-closed, and tax-period-closed states.
- [ ] Show visible cover loaders for every API wait.
- [ ] Disable covered actions while pending.
- [ ] Add Thai and English labels where current i18n pattern exists.
- [ ] Keep components, API, constants, logic, models, and styles separated.

### Tests

- Web typecheck.
- Component/logic tests where setup exists.
- User-flow tests for supplier create, PR submit/approve, PO issue, goods receipt post, bill approve, payment record, and AP aging filter.
- Loader/disabled-state tests for pending actions where practical.
- Accessibility smoke checks where current tooling exists.

### Exit Criteria

- Target users can complete purchase-to-pay workflows from web.
- No item 12 mutation is exposed through LINE.

## Phase 11: AI/LINE Read Tools, Verification, and Handoff

### Goal

Expose safe read summaries, run verification, and update checklist only after implementation passes.

### Tasks

- [ ] Add permission-checked read APIs/tools for:
  - open purchase approvals
  - open PO/receiving status
  - received-not-billed
  - AP aging
  - supplier balance
  - tax/posting exceptions
- [ ] Register AI Gateway tools only through current tool registry when item 07 exists.
- [ ] Add refusal behavior for approve, issue, receive, bill approve, pay, void, supplier bank update, tax filing, and ledger posting requests.
- [ ] Add source refs and web deep links to read responses.
- [ ] Run root/package typecheck, lint, tests, and build commands available in repo.
- [ ] Run API tests and web tests for touched packages.
- [ ] Run Prisma migration/seed verification if Prisma exists.
- [ ] Manually smoke through web flows if dev server/browser tooling is available.
- [ ] Record verification commands and any intentional gaps.
- [ ] Update [[plans/master-implementation-checklist|Master Implementation Checklist]] item 12 checkbox only after implementation and verification are done.

### Tests

- AI read tool permission tests.
- AI mutation refusal tests.
- End-to-end smoke path:
  - supplier
  - PR
  - PO
  - goods receipt
  - vendor bill
  - supplier payment
  - AP aging
  - ledger source input
  - tax source payload
- Full touched-package verification commands.

### Exit Criteria

- Item 12 source workflows are implemented and verified.
- AI/LINE remains read-only.
- Handoff notes include commands run, gaps, and follow-up backlog.

## Verification Checklist

- [ ] Contracts compile and are exported.
- [ ] Prisma/schema/migrations/seeds validate.
- [ ] Supplier master links shared counterparty.
- [ ] Supplier bank detail data is redacted and permission-protected.
- [ ] PR/PO approval lifecycle works with threshold/self-approval policy.
- [ ] Goods receipt creates inventory movement through item 05 boundary.
- [ ] Vendor bill matching and approval work.
- [ ] Supplier payment allocation and AP aging work.
- [ ] Ledger source posting inputs work for approved bill and recorded payment.
- [ ] Tax source payloads work for input VAT, WHT, and PP36 review candidates.
- [ ] Period/tax close policies block unsafe mutation where modules exist.
- [ ] Audit/outbox payloads are bounded and redacted.
- [ ] Web uses visible loaders for every API wait.
- [ ] API/web/contract tests pass.
- [ ] AI/LINE read tools refuse mutations.

## Risks

- Supplier/payment duplication with item 08. Mitigation: Phase 0 must confirm counterparty/payment reuse path before schema work.
- Inventory receipt coupling to item 05 internals. Mitigation: use application port/API and source refs only.
- Ledger/tax modules may not exist or may differ from docs. Mitigation: keep source payload/adapters explicit and record fallback pending statuses.
- Sensitive supplier bank details may lack encryption primitives. Mitigation: store masked-only fallback or defer full values.
- Matching rules can become too complex. Mitigation: first pass uses zero tolerance and explicit override reason.
- Payment workflow can be mistaken for bank transfer execution. Mitigation: UI/API copy and contracts say record only; bank execution/recon remains item 13.

## Open Questions

- Should supplier payments reuse item 08 `AccountingPayment` table directly or only through an AP facade?
