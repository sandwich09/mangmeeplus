# Reimbursement and Approval Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 14.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/reimbursement-approval-plan|Reimbursement Approval Plan]]

Amended 2026-07-26 by [[specs/reimbursement-journey-uplift-spec|Reimbursement Journey Uplift Spec]]: revives `ReimbursementLine` (multi-line claims) and a printable per-request `ใบเบิกค่าใช้จ่าย` claim form (NOT the grouped `ใบสำคัญจ่าย` voucher), widens reimbursement event payloads, and auto-enables reimbursement notification templates. LINE read-only boundary unchanged.

Owner decisions assumed for first pass on 2026-06-23:

- Every reimbursement request from 1 THB requires approval by default. Thresholds remain configurable.
- Final approve, reject, finance review, payment record, correction, void, and export actions are web/API actions only.
- LINE delivers alerts, reminders, AI status summaries, and web deep links only. LINE does not approve, reject, or mark paid.
- Staff can create reimbursement requests on web. When item 09 expense capture exists, reuse its attachment and expense evidence primitives instead of duplicating OCR/extraction.
- Finance records employee repayment status. External bank transfer execution is out of scope.
- First payment UI and API support full payment only. Partial payment status is reserved for later.
- Policy settings UI ships in item 14 for owner/admin configuration.
- Do not build a full HR/direct-manager model in item 14. Use existing direct manager fields only if already present; otherwise default to `MANAGER_ROLE` or configured approver user/role.
- Evidence export must support bounded JSON at minimum. Use existing export framework if present; do not create a broad export framework only for item 14.
- Reimbursement payment becomes a source payment type for item 13 bank reconciliation: `REIMBURSEMENT_PAYMENT`.
- Payment voucher (`ใบสำคัญจ่าย`) generation groups approved unpaid reimbursements by requester/payee, calculates the total transfer amount, and creates a web-reviewed repayment document. It does not execute bank transfer.
- Approved/paid reimbursement records expose deterministic ledger-ready and tax-review source facts for item 10 ledger and item 11 tax.
- Item 16 workflow automation owns configurable SLA escalation rules. Item 14 emits events and shows pending age/SLA-risk fields.

## 2. Goal

Ship the first trustworthy reimbursement workflow for WatchDog-BMS:

- Staff request reimbursement with receipt evidence, amount, category, reason, and requester context.
- Manager approves or rejects in web after LINE/web notification.
- Finance reviews approved requests for accounting, tax, duplicate, and payment readiness.
- Finance generates a payment voucher (`ใบสำคัญจ่าย`) for approved unpaid reimbursements grouped by requester/payee when repayment documentation is needed.
- Finance records employee repayment and payment reference.
- Owner, manager, finance, accountant, and staff can see status, blockers, and audit history.
- LINE/AI can summarize pending reimbursements and alert responsible users with web deep links only.
- Reimbursement payment facts can later be matched in bank reconciliation and posted through ledger adapters.

The first pass must be useful without an advanced policy engine. It should support strict default approval, one-step manager approval, finance review, paid status, audit, outbox events, permission checks, and web screens.

## 3. Non-goals

- Full HR, payroll, direct manager/org chart modeling, employee advance, per diem, travel booking, or corporate card management.
- Automatic bank transfer, PromptPay initiation, bank API write action, or payment rail integration.
- Complex multi-level approval routing or low-code workflow builder. Item 16 owns advanced workflow automation.
- Replacing item 09 receipt upload/OCR/AI extraction. Item 14 may reuse evidence and create request-specific review fields.
- Replacing item 12 procurement/AP vendor bill workflows.
- Replacing item 10 ledger journal generation or period close implementation.
- Replacing item 11 tax filing/export workflows or providing legal/tax advice.
- Broad JSON/CSV/XLSX/PDF export framework creation when no shared export primitive exists. Item 14 only needs bounded reimbursement JSON export fallback.
- LINE/AI final approval, rejection, payment, export, posting, or policy mutation.

## 4. User Roles

- Owner: sees reimbursement exposure, pending approvals, overdue approvals, paid/unpaid status, high-risk corrections, and policy settings.
- Admin: reads reimbursement configuration and manages policy only when granted.
- Requester (every company-member role, owner decision 2026-08-27): creates own requests,
  uploads receipt evidence, edits own drafts, submits, cancels allowed own requests, and reads
  own status while reimbursement is enabled. This includes ADMIN, company view/read-only,
  and custom roles. Platform-only SYSTEM_ADMIN is not a company requester.
- Manager: reviews assigned/team requests, approves or rejects in web, and sees pending approval queue.
- Finance: reviews approved requests, resolves duplicate/tax/accounting blockers, records repayment, exports evidence, and manages corrections.
- Accountant: reads accounting/tax/posting status, export evidence, and review blockers; may mark accounting review fields when granted by policy.
- Auditor readonly: reads requests, approvals, payments, attachments metadata, exports, and
  audit history without business mutation, except the same own-request self-service as every
  company member. It gains no approval or payment authority from that exception.
- AI assistant user: asks reimbursement status and queue summaries through permission-checked read tools only.

## 5. Boundary and Ownership

Reimbursement item 14 owns:

- Reimbursement request lifecycle.
- Approval threshold snapshot and approval steps.
- Assigned approver, requester/approver separation, decision comments, and rejection reasons.
- Finance reimbursement review and employee repayment status.
- Reimbursement payment source facts and payment reference.
- Reimbursement-specific duplicate flags.
- Reimbursement status history, audit actions, outbox events, and web deep links.
- Read-only AI/LINE summaries and alert payload contracts.

Expense item 09 owns:

- Receipt/bill capture from web and LINE.
- OCR/extraction and AI verification of expense evidence.
- Confirmed expense records, receipt evidence, expense payment facts, and expense source posting inputs.

Item 14 may link to item 09 records, but must not duplicate expense OCR/extraction, attachment storage, or confirmed expense accounting logic.

Accounting, ledger, tax, bank, and workflow ownership:

- Item 08 owns shared accounting counterparties and customer payment primitives.
- Item 10 owns chart of accounts, journal generation, posting rules, posting status writes, and period close policy.
- Item 11 owns tax reports, filings, tax exports, and WHT certificate workflows.
- Item 13 owns bank account master, statement import, payment matching, and reconciliation.
- Item 16 owns configurable approval SLA automation, reusable workflow rules, task engine, and escalation templates.

AI Gateway owns no reimbursement source data and must call permission-checked API/tools only.

## 6. Current Repository Baseline

Current repo snapshot on 2026-06-23:

- `apps/api`: NestJS service shell with health module and deny-by-default security skeleton.
- `apps/api/src/common/security`: `DenyByDefaultGuard`, `@Public()`, `@RequirePermissions(...)`, and `SecurityModule`.
- `apps/web`: Next.js App Router shell with platform foundation feature only.
- `apps/ai-gateway`: NestJS service shell.
- `apps/workers`: worker shell.
- `packages/contracts`: shared `HealthStatus` and `TenantContext` only.
- No Prisma schema exists in this snapshot.

Before implementation, inspect latest code again. Items 01 through 13 may add Prisma, auth, request context, audit, outbox, attachment storage, document sequences, expense records, ledger adapters, tax adapters, bank payment matching, web shell routes, API client helpers, notification delivery, workers, and AI tool registration. Extend those primitives. Do not create duplicates.

## 7. References

- Plan: [[plans/reimbursement-approval-plan|Reimbursement Approval Plan]]
- Roadmap: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 14.
- Expense receipt upload: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]
- Bank reconciliation: [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]]
- Double-entry ledger: [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]]
- Thai tax: [[specs/tax-thailand-2026-spec|Thai Tax 2026 Spec]]
- Data primitives: [[specs/data-model-core-spec|Data Model Core Spec]]
- Auth/RBAC: [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]]
- Permissions: [[specs/permission-matrix|Permission Matrix]]
- Web workspace: [[specs/web-core-workspace-spec|Web Core Workspace Spec]]
- LINE AI read-only: [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- AI Gateway: [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- Workflow automation: [[specs/workflow-automation-spec|Workflow Automation Spec]]
- Backend guideline: [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
- Frontend guideline: [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
- Security guideline: [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Stack ADR: [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## 8. Core Workflows

### 8.1 Staff Creates and Submits Request

The create action must be visible and usable on mobile and desktop for every entitled
company-member role, with supporting branch selection and receipt upload permissions. Old
custom roles are backfilled through the standard permission sync; new/edited roles include
the mandatory self-service pack. Feature OFF still removes new-claim actions; the hub and
empty state must describe unavailable creation without directing the user to a missing button.
No company entitlement or deployment/customer gate is changed by this role-policy fix.

1. Staff opens web reimbursement workspace.
2. Staff creates draft with amount, currency, incurred date, category, reason, optional vendor/payee display, branch/project/cost center where available, and receipt evidence.
3. System validates amount, currency, required fields, attachment ownership, requester membership, branch scope, and duplicate candidates.
4. System shows policy requirement. Default policy requires approval from 1 THB.
5. Staff submits request.
6. System freezes submitted fields into approval snapshot, assigns manager/approver, sets status `PENDING_APPROVAL`, writes audit/outbox, and creates notification payload.
7. Manager receives LINE/web alert with deep link to web approval detail.

### 8.2 Manager Approves or Rejects in Web

1. Manager opens approval queue from web or LINE deep link.
2. API re-checks current company, branch/team ABAC, permission, assigned approver policy, self-approval rule, request status, and snapshot consistency.
3. Approval page shows requester, amount, category, incurred date, receipt preview/link, reason, duplicate warning, policy note, prior decisions, and finance/tax flags.
4. Manager approves or rejects.
5. Rejection requires reason.
6. Approved request moves to `APPROVED` and finance review queue.
7. Rejected request moves to `REJECTED`; requester can copy to new draft or revise only if policy explicitly allows resubmission.
8. System writes audit/outbox and notifies requester/finance as appropriate.

### 8.3 Finance Reviews and Marks Paid

1. Finance opens approved reimbursement queue.
2. Finance verifies receipt evidence, amount, category/account hint, tax sensitivity, WHT/VAT relevance, duplicate warnings, requester bank/payment details display, and ledger/tax readiness.
3. Finance resolves blockers or marks request ready to pay.
4. Finance may create a payment voucher (`ใบสำคัญจ่าย`) for one requester/payee that groups approved, finance-reviewed, unpaid reimbursement requests and item 09 expense evidence eligible for reimbursement.
5. Voucher preview shows included receipts/evidence, missing evidence blockers, tax/accounting blockers, total transfer amount, payment method/reference fields, and generated document number when sequence is available.
6. Finance records repayment with paid amount, currency, paid date, payment method, payment reference, optional bank account, voucher reference, and note.
7. Payment record updates request payment status.
8. Paid request emits reimbursement payment source fact for bank reconciliation and ledger/tax adapters.
9. Request becomes `PAID` when paid amount covers approved amount and no payment void blocker remains.

### 8.4 Correction, Void, and Reversal-Ready Flow

1. Drafts can be edited by requester while `DRAFT`.
2. Submitted or pending requests cannot be silently edited.
3. Amount, category, attachment, requester, incurred date, or reason changes after submission must cancel existing approval snapshot and return to draft/resubmission flow, or create correction record after payment.
4. Approved unpaid request can be voided/cancelled only with permission and reason.
5. Paid request cannot be edited silently. Correction uses payment void/adjustment or reversal-ready event, respecting bank reconciliation and closed-period blockers when those modules exist.
6. Every correction, void, and denied correction is audited.

### 8.5 LINE and AI Alert Flow

1. Request submission emits notification/outbox event.
2. Notification layer sends manager LINE alert when WatchDog shared LINE OA identity, selected company context, and preference exist.
3. LINE alert contains concise summary and web deep link only.
4. Manager opens web to approve/reject.
5. AI can answer "my reimbursement status", "pending approvals", "overdue approvals", and "unpaid reimbursements" using read-only permission-checked tools.
6. AI refuses approval, rejection, payment, export, or policy mutation from LINE and returns web link when useful.

## 9. Core Business Rules

- Reimbursement records are company-scoped and branch-aware.
- `companyId` and current user context must come from server-side request context, not client-submitted trust.
- Every request amount from 1 THB requires approval by default.
- Threshold, approver mode, allowed categories, missing receipt policy, and SLA hours are configurable per company.
- First pass supports one manager approval step. Data model must allow more steps later.
- Requester cannot approve own request by default, even when the requester has manager role.
- Explicit self-approval policy can be added later, but first pass should block self-approval and return stable error `self_approval_denied`.
- Approval decision must reference immutable submitted snapshot.
- If submitted fields that affect approval are changed, existing approval step becomes invalid/cancelled and request must be resubmitted.
- Rejection requires non-empty reason.
- Approval comment is optional unless policy requires it.
- Approved request still requires finance review before payment.
- Finance review must resolve duplicate blockers and tax/accounting required fields before payment.
- Payment cannot be recorded for `DRAFT`, `PENDING_APPROVAL`, `REJECTED`, `CANCELLED`, or `VOIDED` requests.
- Payment cannot exceed approved amount unless an explicit overpayment/correction policy exists. First pass blocks overpayment.
- MVP payment is full-payment only: one payment must equal the approved outstanding amount. Underpayment, partial payment, and overpayment are blocked until a later owner-approved partial/adjustment policy exists.
- Payment recording must re-read eligibility and persist the payment, stable source ref, payment totals, outstanding amount, payment status, and request status in one serializable transaction protected by a per-company/request advisory lock and request-state CAS.
- Each payment attempt has a durable unique key. When the caller omits a client key, the API derives the key from company, reimbursement request, and the server-owned request version; caller-controlled `paidAt` must never determine idempotency.
- A retry of the same committed payload returns the recorded payment/request state without a second payment, audit event, or outbox event. A reused key with different payment facts returns an idempotency conflict.
- Payment method first pass values are `CASH`, `BANK_TRANSFER`, `CHEQUE`, `OTHER`.
- Owner decision 2026-10-04: attached payment evidence replaces the reference requirement. Transfers still require their slip; cheques without evidence require their cheque number. Cash/other references remain optional. See payout spec §27.
- External bank transfer execution is out of scope.
- Paid reimbursement cannot be edited silently.
- Payment void after bank reconciliation or ledger posting must call current bank/ledger policy ports when those modules exist.
- Closed ledger period blocks payment void/correction when item 10 period policy exists.
- Receipt evidence is required by default unless finance-level permission and missing receipt reason policy allows exception.
- Reimbursement receipt pickers accept PDF plus JPG/JPEG, PNG, HEIC/HEIF, and GIF image sources. The web must reuse
  the expense receipt preparation path to inspect the image container and normalize HEIC/HEIF, GIF, oversized images,
  and browser metadata/container mismatches into a valid static JPEG before creating the upload intent. The shared
  server attachment boundary remains PDF/PNG/JPEG and still verifies extension, declared MIME type, and magic bytes.
- Draft creation and receipt upload are separate writes. If one receipt upload fails after the draft exists, every
  successfully uploaded receipt must still be linked to its line, the failed line numbers must be shown, and the UI
  must open the existing draft for correction instead of offering an action that can create a duplicate request.
- The create action is labelled `บันทึกร่างคำขอเบิก`. While preparing or uploading images it must expose a pending
  state. A recovery action after partial success is labelled by its actual outcome, such as `เปิดร่างเพื่อแก้ไขไฟล์`.
- Draft submission UX must explain the effective company receipt policy before the requester submits. When an
  unevidenced line is blocked by policy, the submit action is disabled and the detail view directs the requester to
  attach a receipt; a missing-receipt reason must not be presented as sufficient when the company policy disallows it.
- Receipt-policy API rejections must use the same reviewed Thai guidance in the shared mutation toast and inline
  error. `missing_receipt` must not suggest that reloading fixes missing evidence or that a reason always suffices;
  `missing_receipt_reason_required` must specifically ask for the missing reason. Unknown API diagnostics stay hidden.
- A claim-form signature action uses the latest `ACTIVE` company signature asset submitted by the eligible signer.
  It must never resolve another user's signature. If the signer has no active saved signature, the web shows a modal
  with a secondary cancel action and a primary `ไปหน้าลายเซ็น` action that navigates to the existing signature feature.
  Existing actor/role eligibility, claim snapshot acknowledgement, attachment integrity, and audit checks still apply.
- Attachment records must use Data Model Core attachment primitives. Do not expose object keys or permanent public URLs.
- If item 09 expense upload exists, reuse its attachment links, duplicate detection inputs, and confirmed expense source facts where possible.
- Item 14 may create request-local receipt links, but must not create a separate object storage abstraction.
- Payment voucher generation must reuse reimbursement and expense evidence records. It must not execute bank transfer, post ledger entries, or bypass finance review.
- A payment voucher groups records by requester/payee. It must not mix different payees unless an explicit bulk payment-export scope is approved later.
- Voucher totals must be decimal-safe and derived from approved outstanding reimbursement amounts after duplicate, missing receipt, and finance blockers are resolved.
- Duplicate detection must check at least attachment checksum, expenseId, requester, vendor display, incurred date, amount, currency, and normalized reason/reference.
- Clarification 2026-10-04: same receipt checksum and linked expense are strong matches across every active claim of the company; soft scoring remains same-requester. Use indexed evidence queries for strong matches, retaining the bounded same-requester lookup for soft scoring. Existing exclusive attachment/expense reuse restrictions still apply.
- For unresolved duplicates, `WARN` permits submission/payment with a warning; `BLOCK_SUBMIT` persists detected candidates/audit and refuses submission without numbering or routing; the frozen `BLOCK_PAYMENT` refuses payment for open claim candidates or unresolved possible duplicates in its own expense documents. Preflight, locked payment, detail and queue use one predicate.
- Owner decision, **2026-10-05**: “ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ”. Any own expense record marked `CONFIRMED_DUPLICATE` blocks **new** claim payments under every policy (`WARN`, `BLOCK_SUBMIT`, `BLOCK_PAYMENT`), using reason `EXPENSE_CONFIRMED_DUPLICATE` and refusal `duplicate_confirmed`. Existing payments remain recorded; there is no automatic reversal. The confirmed expense remains excluded from the ledger. Approval is unchanged.
- Confirmed duplicates cannot be cleared or bypassed through finance approval. Claim detail/journey, pay-queue marks, payment refusals and LINE claim answers reuse the Thai guidance in contracts: cancel this claim, then have the requester send a new claim without the duplicate item. Show the existing cancel action only when the cancel endpoint permits this viewer, status and branch; otherwise name the requester with cancellation rights or the finance reviewer responsible for the branch. For `PARTIALLY_PAID`/`PAID`, cancellation is unavailable while payments stand: the existing payment-void path must cancel all recorded payments first, then the claim can be cancelled. A pending cancellation points to completion; ended claims are described as ended, without offering cancellation again.
- Before confirming a duplicate on an expense with `sourceReimbursementRequestId`, the expense review screen warns that the claim cannot be paid, must be cancelled and replaced without the duplicate item, and the duplicate confirmation cannot be undone. Other expense confirmations retain their existing words.
- A payment recorder or reimbursement duplicate resolver clears an **unresolved** block with an audited reason through the expense module’s duplicate-resolution service, then the existing reconcile/confirmation path. Interrupted confirmation is retried from the same claim action; unconfirmed overridden documents remain unready for payment. Candidate targets/raw reasons are returned only when the viewer can read the referenced claim; otherwise return generic Thai evidence reasons without target identifiers or links.
- Money calculations must be decimal-safe. Do not use JavaScript floating-point math for business totals.
- Currency starts as explicit `THB` by default.
- Tax-sensitive fields require finance/accountant review and may feed item 11 as review candidates only.
- Input VAT/WHT treatment must remain explicit and reviewable. Do not assume every reimbursement is tax-claimable.
- Approved accounting-relevant reimbursements should set posting status `pending` when ledger integration exists.
- Draft, rejected, cancelled, duplicate-only, and non-accounting requests use posting status `not_required`.
- Item 10 owns journal generation and may update posting status to `posted`, `posting_error`, or `reversed` through adapters only.
- Reimbursement payment source type for bank reconciliation is `REIMBURSEMENT_PAYMENT`.
- Item 13 matches payment records to bank statement lines; item 14 only records payment facts and source refs.
- LINE and AI may not approve, reject, finance-review, mark paid, void, export, or change policy.
- Web permission checks are UX only; backend remains authoritative.
- Audit all sensitive successful and denied actions.
- Outbox payloads must be bounded and redacted. Do not include signed URLs, raw receipt text, full OCR payload, bank account full numbers, auth tokens, or secrets.
- API mutations must support idempotency keys where duplicate client submits or LINE/web retries can happen.

## 10. Statuses and Enumerations

Request statuses:

```text
DRAFT
PENDING_APPROVAL
APPROVED
REJECTED
CANCELLED
FINANCE_REVIEW
READY_FOR_PAYMENT
PARTIALLY_PAID
PAID
VOIDED
```

Approval step statuses:

```text
PENDING
APPROVED
REJECTED
CANCELLED
SKIPPED
EXPIRED
```

Finance review statuses:

```text
NOT_REQUIRED
PENDING
NEEDS_INFO
APPROVED_FOR_PAYMENT
BLOCKED
```

Payment statuses:

```text
NOT_PAYABLE
UNPAID
PARTIALLY_PAID
PAID
VOIDED
```

Request and payment `PARTIALLY_PAID` statuses are reserved for later. MVP workflows must not enter them.

Duplicate statuses:

```text
NOT_CHECKED
NO_MATCH
POSSIBLE_DUPLICATE
CONFIRMED_DUPLICATE
OVERRIDDEN
```

Receipt requirement statuses:

```text
REQUIRED
ATTACHED
MISSING_WITH_REASON
WAIVED_BY_POLICY
```

Posting statuses:

```text
not_required
pending
posted
posting_error
reversed
```

Payment methods:

```text
CASH
BANK_TRANSFER
CHEQUE
OTHER
```

Approver modes:

```text
DIRECT_MANAGER
MANAGER_ROLE
OWNER_ROLE
CUSTOM_USER
CUSTOM_ROLE
```

## 11. Data Model Draft

Use repo conventions and current Prisma naming when implementation starts. Shape below is required business contract, not exact ORM syntax.

### ReimbursementPolicy

```text
ReimbursementPolicy
- id
- companyId
- branchId nullable
- currency default THB
- approvalThresholdAmount default 1.00
- approvalRequiredFromAmount default 1.00
- approverMode
- defaultApproverUserId nullable
- defaultApproverRole nullable
- allowSelfApproval default false
- requireReceipt default true
- allowMissingReceiptWithReason default false
- duplicatePolicy: WARN, BLOCK_SUBMIT, BLOCK_PAYMENT
- financeReviewRequired default true
- slaHours nullable
- status: ACTIVE, INACTIVE
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,branchId,status where active policy convention allows
```

### ReimbursementRequest

```text
ReimbursementRequest
- id
- companyId
- branchId nullable
- requestNo
- requesterUserId
- requesterDisplayNameSnapshot
- requesterTeamId nullable
- title nullable
- reason
- categoryKey
- categoryLabelSnapshot nullable
- amount
- currency default THB
- incurredDate
- submittedAt nullable
- submittedByUserId nullable
- currentApproverUserId nullable
- currentApprovalStepId nullable
- approvedAt nullable
- rejectedAt nullable
- rejectionReason nullable
- cancelledAt nullable
- financeReviewStatus
- financeReviewedByUserId nullable
- financeReviewedAt nullable
- financeReviewNote nullable
- status
- paymentStatus
- duplicateStatus
- receiptRequirementStatus
- taxReviewStatus nullable
- postingStatus
- linkedExpenseId nullable
- primaryAttachmentId nullable
- approvalPolicySnapshotJson
- approvalSnapshotHash
- paymentTotalAmount default 0
- outstandingAmount
- idempotencyKey nullable
- createdByUserId
- updatedByUserId nullable
- createdAt
- updatedAt
- unique companyId,requestNo
- index companyId,requesterUserId,status
- index companyId,currentApproverUserId,status
- index companyId,status,paymentStatus
```

### ReimbursementLine

```text
ReimbursementLine
- id
- companyId
- reimbursementRequestId
- lineNo
- description
- categoryKey
- amount
- currency
- incurredDate nullable
- vendorDisplayName nullable
- taxInvoiceNo nullable
- taxReviewJson nullable
- attachmentId nullable
- linkedExpenseLineId nullable
- accountHint nullable
- createdAt
- updatedAt
```

First web pass may create one line per request. Model allows multiple receipt/line support later.

### ReimbursementApprovalStep

```text
ReimbursementApprovalStep
- id
- companyId
- reimbursementRequestId
- sequenceNo
- approverUserId
- approverRoleSnapshot nullable
- status
- assignedAt
- decidedAt nullable
- decisionByUserId nullable
- comment nullable
- rejectionReason nullable
- policySnapshotJson
- requestSnapshotHash
- invalidatedAt nullable
- invalidatedReason nullable
- createdAt
- updatedAt
- index companyId,approverUserId,status
```

### ReimbursementPayment

```text
ReimbursementPayment
- id
- companyId
- reimbursementRequestId
- idempotencyKey
- paymentNo nullable
- paidAmount
- currency
- paymentMethod
- paidAt
- paymentReference nullable
- bankAccountId nullable
- sourcePaymentRef
- status: RECORDED, VOIDED
- voidedAt nullable
- voidReason nullable
- paidByUserId
- voidedByUserId nullable
- postingStatus
- bankMatchStatus nullable
- createdAt
- updatedAt
- unique companyId,idempotencyKey
- index companyId,reimbursementRequestId,status
- index companyId,paidAt,paymentMethod
```

`sourcePaymentRef` must be stable enough for item 13:

```text
sourceType = REIMBURSEMENT_PAYMENT
sourceId = ReimbursementPayment.id
direction = PAID
amount = paidAmount
currency = currency
paidAt = paidAt
counterpartyDisplay = requesterDisplayNameSnapshot
requestId = ReimbursementRequest.id
```

### ReimbursementDuplicateCandidate

```text
ReimbursementDuplicateCandidate
- id
- companyId
- reimbursementRequestId
- candidateType: ATTACHMENT_CHECKSUM, EXPENSE_LINK, AMOUNT_DATE_VENDOR, MANUAL
- candidateRequestId nullable
- candidateExpenseId nullable
- candidateAttachmentId nullable
- score
- status: OPEN, DISMISSED, CONFIRMED, OVERRIDDEN
- reason nullable
- resolvedByUserId nullable
- resolvedAt nullable
- createdAt
```

### ReimbursementStatusEvent

Use shared AuditLog when available. Add local status event table only if current audit primitive cannot serve timeline UI.

```text
ReimbursementStatusEvent
- id
- companyId
- reimbursementRequestId
- fromStatus nullable
- toStatus
- action
- actorUserId
- note nullable
- metadataJson redacted
- occurredAt
```

## 12. Shared Contracts

Add or extend contracts under `packages/contracts/src`.

Recommended file:

```text
packages/contracts/src/reimbursements.ts
```

Export from:

```text
packages/contracts/src/index.ts
```

Minimum contract families:

```text
ReimbursementRequestStatus
ReimbursementApprovalStepStatus
ReimbursementFinanceReviewStatus
ReimbursementPaymentStatus
ReimbursementPaymentMethod
ReimbursementPolicySummary
ReimbursementRequestSummary
ReimbursementRequestDetail
ReimbursementLineInput
CreateReimbursementRequestInput
UpdateReimbursementDraftInput
SubmitReimbursementRequestInput
ApproveReimbursementInput
RejectReimbursementInput
FinanceReviewReimbursementInput
RecordReimbursementPaymentInput
ReimbursementApprovalQueueItem
ReimbursementFinanceQueueItem
ReimbursementPaymentSourceRef
ReimbursementAiSummary
```

API DTOs must not expose object storage keys, full bank account numbers, signed URL internals, raw OCR payloads, Prisma row names, or internal retry lock fields.

## 13. API Behavior

Use current route/version conventions. If none exist, prefer:

```text
/v1/companies/:companyId/reimbursements
```

### Request APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| List requests | `GET /v1/companies/:companyId/reimbursements` | `reimbursement.read`, `reimbursement.read_related` or `reimbursement.read_own` | Supports own/related/team/finance filters, status, date, requester, payment status; every path is branch-scoped. |
| Create draft | `POST /v1/companies/:companyId/reimbursements` | `reimbursement.create` | Creates `DRAFT`; validates attachment ownership if supplied. |
| Get detail | `GET /v1/companies/:companyId/reimbursements/:requestId` | scoped read | Includes timeline, approval steps, duplicate flags, payment summary. |
| Update draft | `PATCH /v1/companies/:companyId/reimbursements/:requestId` | `reimbursement.update_own_draft` or finance override | Draft only unless correction flow exists. |
| Submit | `POST /v1/companies/:companyId/reimbursements/:requestId/submit` | `reimbursement.submit` | Freezes snapshot, assigns approver, emits event. |
| Cancel own request | `POST /v1/companies/:companyId/reimbursements/:requestId/cancel` | `reimbursement.cancel_own` or admin/finance | Allowed before payment and per policy. |

### Approval APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| Approval queue | `GET /v1/companies/:companyId/reimbursements/approval-queue` | `reimbursement.approve` | Returns assigned/team approvals. |
| Approve | `POST /v1/companies/:companyId/reimbursements/:requestId/approve` | `reimbursement.approve` | Blocks self-approval and stale snapshot. |
| Reject | `POST /v1/companies/:companyId/reimbursements/:requestId/reject` | `reimbursement.reject` | Requires reason. |

### Finance and Payment APIs

| Action | Route | Permission | Notes |
|---|---|---|---|
| Finance queue | `GET /v1/companies/:companyId/reimbursements/finance-queue` | `reimbursement.finance_review` | Approved/unpaid/blocker-focused queue. |
| Finance review | `POST /v1/companies/:companyId/reimbursements/:requestId/finance-review` | `reimbursement.finance_review` | Resolves accounting/tax/duplicate/payment blockers. |
| Create payment voucher | `POST /v1/companies/:companyId/reimbursements/payment-vouchers` | `reimbursement.payment.record` plus read scope for included requests | Groups approved, finance-reviewed, unpaid requests by requester/payee and creates a voucher preview/artifact source. Does not execute transfer. |
| Get payment voucher | `GET /v1/companies/:companyId/reimbursements/payment-vouchers/:voucherId` | `reimbursement.read` or scoped finance/accountant access | Shows included requests, evidence refs, blockers, total transfer amount, and generated document artifact status. |
| Record payment | `POST /v1/companies/:companyId/reimbursements/:requestId/payments` | `reimbursement.payment.record` | Approved and finance-reviewed only. MVP paid amount must equal approved outstanding amount. |
| Void payment | `POST /v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/void` | `reimbursement.payment.void` | Requires reason and bank/ledger policy checks when present. |
| Export evidence | `GET /v1/companies/:companyId/reimbursements/:requestId/export` | `reimbursement.export` | Bounded evidence export; formats depend on current export primitives. |

### Read-Only AI/LINE APIs

Expose through AI Gateway/read-tool registry only when current item 07 integration exists:

```text
reimbursement.get_my_status
reimbursement.list_pending_approvals
reimbursement.get_approval_summary
reimbursement.get_unpaid_summary
```

These tools are read-only and must enforce same API permissions and ABAC as web.

## 14. Permission Contract

Permission keys:

```text
reimbursement.read
reimbursement.read_related
reimbursement.read_own
reimbursement.create
reimbursement.update_own_draft
reimbursement.submit
reimbursement.cancel_own
reimbursement.approve
reimbursement.reject
reimbursement.finance_review
reimbursement.payment.record
reimbursement.payment.void
reimbursement.duplicate.resolve
reimbursement.policy.read
reimbursement.policy.manage
reimbursement.export
```

Default grants:

```text
ALL company roles: reimbursement.read_related (related records only; no mutation authority)
OWNER: all reimbursement permissions
ADMIN: reimbursement.read, reimbursement.policy.read, reimbursement.policy.manage, reimbursement.export
MANAGER: reimbursement.read where ABAC allows team/summary, reimbursement.approve where assigned/team policy allows, reimbursement.reject where assigned/team policy allows
FINANCE: reimbursement.read, reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own, reimbursement.finance_review, reimbursement.payment.record, reimbursement.payment.void, reimbursement.duplicate.resolve, reimbursement.policy.read, reimbursement.export
ACCOUNTANT: reimbursement.read, reimbursement.finance_review where accounting policy grants, reimbursement.export
AUDITOR_READONLY: reimbursement.read, reimbursement.export
STAFF: reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own
SALES: reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own when company policy grants employee reimbursement
INVENTORY: reimbursement.read_own, reimbursement.create, reimbursement.update_own_draft, reimbursement.submit, reimbursement.cancel_own when company policy grants employee reimbursement
MARKETING: no reimbursement permissions by default unless company policy grants employee reimbursement
```

2026-08-10 owner amendment: related visibility follows persisted requester/workflow/payment/signature/signed-copy actors and
linked or generated expense records, under tenant + branch ABAC on every hop. It is view-only. Approval, draft changes,
submission, cancellation, finance review, payment, void and signing retain their exact permission + actor + state checks.
Web, API and LINE/AI use the same source predicate; the related list is labelled as such and cannot offer requester actions
on another employee's draft.

Sensitive reimbursement permissions:

```text
reimbursement.approve
reimbursement.reject
reimbursement.finance_review
reimbursement.payment.record
reimbursement.payment.void
reimbursement.duplicate.resolve
reimbursement.policy.manage
reimbursement.export
```

## 15. UI Behavior

### Web

Main route group should follow current web shell conventions. If no convention exists, prefer:

```text
/finance/reimbursements
/finance/reimbursements/:requestId
/approvals/reimbursements
```

Required screens:

- My reimbursements: staff/requester list with status, amount, submitted date, approval state, payment state, and actions.
- Request form: create/edit draft with amount, category, date, reason, receipt evidence, duplicate warning, and submit action.
- Approval queue: manager queue with requester, amount, age, category, policy note, receipt indicator, and approve/reject actions.
- Approval detail: full request snapshot, receipt preview/download through secure attachment route, decision form, history, and permission/error states.
- Finance queue: approved/unpaid/blocker queue with duplicate/tax/accounting/payment status filters.
- Finance detail: review fields, payment form, payment history, source refs, and audit timeline.
- Policy settings: owner/admin screen for threshold, approver mode, configured approver user/role where supported, receipt rule, duplicate policy, finance review rule, and SLA hours. Ship in item 14.

Visible UI language defaults to Thai with English available, following web guideline.

Every loading mutation must show scoped cover loader and disable repeated submit.

### LINE

LINE can show:

- Manager alert: pending reimbursement approval with requester, amount, category, age, and web link.
- Requester alert: submitted, approved, rejected, ready to pay, paid, or needs information.
- Finance alert: approved reimbursement waiting for payment where notification preferences allow.
- AI summaries: my status, pending approvals, overdue approvals, unpaid reimbursements.

LINE cannot show:

- Final approve/reject/payment controls.
- Full receipt file without web permission and secure signed-url flow.
- Policy editing.
- Export generation.

## 16. Audit and Outbox

Always audit:

```text
reimbursement.request.create
reimbursement.request.update_draft
reimbursement.request.submit
reimbursement.request.cancel
reimbursement.approval.assign
reimbursement.approval.approve
reimbursement.approval.reject
reimbursement.approval.self_approval_denied
reimbursement.approval.invalidate
reimbursement.duplicate.flag
reimbursement.duplicate.resolve
reimbursement.finance_review.update
reimbursement.payment.record
reimbursement.payment.void
reimbursement.request.void
reimbursement.policy.update
reimbursement.export
reimbursement.ai_tool.read
```

Audit metadata may include:

- request id and request number
- requester id
- approver id
- status transition
- amount, currency, category
- duplicate candidate ids and reason codes
- payment id and payment method
- payment reference hash or short safe display
- attachment id and checksum hash
- actor id
- reason/comment

Audit metadata must not include:

- signed URLs
- object keys
- raw file bodies
- full OCR provider payloads
- full bank account numbers
- auth tokens or secrets

Outbox event keys:

```text
reimbursement.request_created
reimbursement.request_submitted
reimbursement.approval_assigned
reimbursement.approved
reimbursement.rejected
reimbursement.cancelled
reimbursement.duplicate_flagged
reimbursement.finance_review_updated
reimbursement.ready_for_payment
reimbursement.payment_recorded
reimbursement.payment_voided
reimbursement.posting_status_changed
reimbursement.policy_updated
```

Outbox payloads are bounded ids, status, totals, actor ids, source refs, and idempotency keys only.

## 17. Edge Cases

- Requester submits with no receipt: block unless policy allows missing receipt and reason.
- Same receipt already used by another reimbursement or expense: flag duplicate before submit/payment.
- Manager is also requester: block self-approval by default.
- Assigned approver loses permission before decision: block decision and require reassignment/admin resolution.
- Approval link opened after request changed: show stale state and block old decision.
- Rejection without reason: return validation error.
- Finance tries to pay rejected/cancelled request: return invalid status transition.
- Finance records a transfer with its slip and no reference: accept. A cheque needs its number or attached payment evidence; reject only when both are absent (owner 2026-10-04).
- Payment amount exceeds approved amount: block overpayment.
- Paid request needs correction: require void/adjustment reason; no silent edit.
- Payment already matched in bank reconciliation: block void unless item 13 reopen/unmatch policy allows.
- Ledger period closed: block correction/void when item 10 period policy exists.
- Attachment belongs to another company: reject.
- User can read own request but not team request: enforce row scope server-side.
- Duplicate idempotency key with same payload: return existing result.
- Same idempotency key with different payload: return conflict.
- LINE alert delivery fails: business state remains valid; notification retry/dead-letter belongs to notification/workflow primitives.
- Workflow SLA escalation missing: request still shows age/SLA-risk; item 16 can add escalation later.

## 18. Acceptance Criteria

- [ ] Staff can create a draft reimbursement request on web.
- [ ] Staff can attach or link receipt evidence using tenant-scoped attachment primitives.
- [ ] Staff can submit request; submitted snapshot is immutable for approval.
- [ ] Default policy requires approval from 1 THB.
- [ ] Manager receives notification payload/LINE alert with web deep link when channel primitives exist.
- [ ] Manager can approve assigned/team request in web.
- [ ] Manager can reject assigned/team request in web with required reason.
- [ ] Requester cannot approve own request by default.
- [ ] Non-approver cannot approve or reject.
- [ ] Changing approval-sensitive submitted fields invalidates existing approval and requires resubmission/correction.
- [ ] Finance can review approved request and resolve duplicate/tax/accounting blockers.
- [ ] Finance can generate a payment voucher (`ใบสำคัญจ่าย`) grouped by requester/payee from approved, finance-reviewed, unpaid reimbursements and included receipt evidence.
- [ ] Payment voucher calculates total transfer amount from approved outstanding amounts, shows blockers before payment, and does not execute bank transfer.
- [ ] Finance can mark approved and reviewed request paid with payment method, date, amount, and reference rules.
- [ ] MVP payment recording is full-payment only; partial/underpayment is rejected.
- [ ] Payment cannot be recorded for draft, pending, rejected, cancelled, or voided requests.
- [ ] Paid request cannot be silently edited.
- [ ] Reimbursement payment exposes `REIMBURSEMENT_PAYMENT` source ref for bank reconciliation.
- [ ] Accounting-relevant reimbursement exposes ledger-ready posting input and posting status where item 10 exists.
- [ ] Tax-sensitive reimbursement fields remain explicit and reviewable where item 11 exists.
- [ ] All sensitive actions write redacted audit records.
- [ ] Outbox events are emitted for submission, approval, rejection, finance review, payment, and status changes.
- [ ] Server enforces tenant, branch/team ABAC, ownership, and permission checks on every route.
- [ ] Web shows requester list, approval queue, finance queue, detail/timeline, and payment status.
- [ ] Web shows owner/admin reimbursement policy settings.
- [ ] Evidence export returns bounded JSON when no shared export framework exists.
- [ ] LINE/AI can show read-only summaries and web links only.
- [ ] LINE/AI cannot approve, reject, finance-review, pay, export, post, or change policy.

## 19. Test Cases

- Unit: policy requires approval at 1 THB and above by default.
- Unit: approval threshold comparison uses decimal-safe money logic.
- Unit: self-approval returns `self_approval_denied`.
- Unit: rejection without reason fails.
- Unit: submitted snapshot hash changes when amount/category/receipt/reason changes.
- Unit: stale approval decision is rejected after snapshot invalidation.
- Unit: payment guard rejects unapproved or not-finance-reviewed requests.
- Unit: payment over approved amount is rejected.
- Unit: payment below approved outstanding amount is rejected in MVP full-payment mode.
- Integration: two concurrent payment requests serialize and create exactly one payment.
- Integration: failure at payment create, source-ref write, request CAS, or transactional readback rolls back all payment/request state and can be retried once.
- Integration: retry after an ambiguous transaction/document-number commit timeout returns the committed payment and does not duplicate payment or numbering.
- Unit: duplicate scoring catches same checksum and same amount/date/vendor/requester patterns.
- Unit: reimbursement payment source ref maps to `REIMBURSEMENT_PAYMENT`, `direction = PAID`, amount, currency, and paid date.
- Unit: payment voucher grouping rejects mixed requester/payee unless a later bulk-payment policy explicitly allows it.
- Unit: payment voucher total equals sum of approved outstanding amounts using decimal-safe math.
- Unit: audit/outbox payload redaction excludes signed URLs, object keys, raw OCR, and secrets.
- Integration: staff can create, update own draft, submit, and read own status.
- Integration: staff cannot read other user's request unless role/ABAC grants it.
- Integration: manager can approve assigned/team request but not unrelated request.
- Integration: finance can mark paid only after approval and finance review.
- Integration: payment void requires permission and reason.
- Integration: attachment cross-company link is rejected.
- Integration: duplicate idempotency key returns existing result or conflict according to payload.
- API security: AI Gateway read tool cannot call mutation use cases.
- API security: LINE approval/reject/payment request is refused with web-link guidance.
- Web logic: approval queue disables approve/reject while mutation is pending.
- Web logic: payment form uses the shared reference/evidence rule and method-specific labels/hints; only a cheque without evidence requires its number (owner 2026-10-04).
- Web logic: policy settings validates threshold, approver mode, receipt rule, duplicate policy, finance review rule, and SLA hours.
- Web responsive smoke: request form, approval detail, finance queue, and payment form fit desktop and mobile without overlapping controls.

## 20. Implementation Notes

- Prefer API module path `apps/api/src/modules/reimbursements`.
- Prefer web feature path `apps/web/src/features/reimbursements`.
- Prefer shared contract file `packages/contracts/src/reimbursements.ts`.
- Follow backend hexagonal folders:
  - `domain/models`
  - `domain/logic`
  - `domain/ports`
  - `application/use-cases`
  - `application/dto`
  - `infrastructure/db`
  - `infrastructure/repositories`
  - `infrastructure/queries`
  - `presentation/http`
- Keep controllers thin. Controllers call use cases only.
- Keep Prisma usage inside infrastructure repositories, queries, mappers, and shared Prisma service.
- Do not use Prisma generated types as domain models.
- Reuse existing permission, audit, outbox, attachment, notification, document sequence, request context, and API client helpers.
- If no Prisma exists when item 14 starts, first add or follow current platform persistence convention from earlier items.
- If previous items are not implemented, keep ports explicit and create minimal in-memory/no-op adapters only when repo pattern supports tests.

## 21. Resolved Defaults

- Default currency: `THB`.
- Default approval threshold: `1.00`.
- Default approver mode: `MANAGER_ROLE` unless company/user manager relationship exists, then `DIRECT_MANAGER`.
- Default direct manager model decision: do not build HR/org manager model in item 14; use existing direct manager relation only if already present.
- Default self-approval: blocked.
- Default finance review: required before payment.
- Default payment behavior: full payment only; partial payment is backlog.
- Default duplicate policy: warn on submit, block payment until finance resolves.
- Default request numbering sequence key: `reimbursement.request`.
- Default payment numbering sequence key: `reimbursement.payment`.
- Default policy UI: required in item 14.
- Default export behavior: bounded JSON minimum; use existing export framework if present.
- Default web mutation surface: web/API only.
- Default LINE behavior: alert, summary, and deep link only.

## 22. Backlog After MVP

- Multi-step approval routing.
- Partial reimbursement payments.
- Delegated approvers and out-of-office substitution.
- Full direct-manager/HR org chart approval routing.
- Configurable per-category/per-branch thresholds.
- Cash advance and travel advance settlement.
- Per diem/mileage rules.
- Corporate card feed.
- Employee bank account vault/tokenization.
- Bulk reimbursement payment batch export.
- Full workflow SLA escalation templates from item 16.
- Native mobile capture beyond LINE/web.
