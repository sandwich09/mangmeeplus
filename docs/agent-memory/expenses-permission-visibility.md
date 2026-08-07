# Agent Memory: expenses-permission-visibility

Status: IMPLEMENTED + VERIFIED — 2026-07-26. Manual per-role browser walk pending a running stack.
Owner: Claude (audit + implementation, no Codex this time per owner request)
Scope: apps/web only. Rule enforced: a button the user has no permission to execute must not render. Backend untouched (its checks remain the source of truth).
Decisions:
- Pattern D (typed capability object): `expenseCapabilities(permissions)` + `ExpenseCapabilities` in expenses.model.ts mirror the EFFECTIVE backend gate (decorator ∩ use-case) audited from expense.controller.ts + use cases; canonical keys at apps/api/src/modules/auth/permission-registry.ts:118-135. `canExportPackage = export && read` (backend requires both). `canRequestOcr = ocr.request || review`; the receipt.upload-on-own-record alternative resolves in the modal (`canExtract`).
- Tabs hidden by capability (visibleExpensesTabs): upload→receipt.upload, manual→create, categories→category.manage, signatures→signature.manage, evidence→read; list always. `?tab=` deep-link to a hidden tab falls back to list.
- `canMutateDraft` now requires `canReview || (canUpdate && own record)` — ownership alone no longer shows edit/save/ส่งตรวจสอบ UI that would 403.
- Hidden (not disabled) per repo pattern for destructive/finance actions: void→canVoid, reject→canReject, บันทึกชำระ inputs→canRecordPayment, ตรวจสอบรายการซ้ำ→canReview, ไม่ใช่รายการซ้ำ→canResolveDuplicates, อ่านเอกสารอีกครั้ง→canExtract; signature อนุมัติ/ปฏิเสธ→canApprove prop; evidence export→canExport prop.
- Inverse gap fixed: pure approver (pack.expense.finance: confirm/reject/void/payment WITHOUT review/update) previously could never see ยืนยันและลงบัญชี (it lived only in guided mode). Added `approverOnlyActions` non-guided footer for READY_FOR_CONFIRMATION; `hasFooterActions` updated; REJECTED เริ่มตรวจใหม่ now gated (canReview || canUpdate+own) and routes reviewers to reviewer-mark-ready (the plain mark-ready decorator requires expense.update and would 403 a pure reviewer — pre-existing bug fixed in passing).
- Already-correct gates left alone: DocumentReviewSection save/override/substitute (isMutable && canReview), substitute approve (canConfirm && not payer), payer actions (payerUserId === userId).
Known backend quirks recorded (NOT fixed here, backend out of scope):
- GET /expenses list decorator requires expense.read_own — holders of only expense.read/review are 403'd at the guard.
- completeReceiptUpload decorator requires expense.receipt.upload even though the use case allows expense.review → a pure reviewer adding evidence files in DocumentReviewSection may 403; UI section is review-gated so only affects reviewers lacking receipt.upload.
Open questions: none blocking.
Artifacts:
- docs/plans/expenses-permission-visibility-plan.md (audit table: UI action → effective backend requirement; gap list)
- apps/web/src/features/expenses/expenses.model.ts (`ExpenseCapabilities`, `expenseCapabilities`)
- apps/web/src/features/expenses/ExpensesPages.tsx (visibleExpensesTabs, caps prop threading ExpenseListPage→ExpenseDetailModal, footer/payment/duplicate/OCR gates, approver-only footer)
- apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx (SignaturePanel canApprove, EvidencePanel canExport)
- apps/web/src/features/expenses/expenses.model.spec.ts (+5 capability tests)
Verification:
- `corepack pnpm --filter @watchdog-bms/web test` → 348 tests, 91 suites, pass 348 / fail 0 (baseline 343 + 5).
- typecheck exit 0; production build exit 0.
- Self diff-review: caps threading complete (no remaining canReview/canConfirm props on ExpenseListPage/ExpenseDetailModal), read-only info (paid/confirmed dates, duplicate warning card, view journal) intentionally still visible.
- E2E not run (stack down); e2e authed user has full perms so EXP-01..09 assertions unaffected by hiding rules.
Next: with stack up, walk the matrix per capability pack (view / self / review / finance): each pack sees only its tabs/buttons; pure-finance sees confirm on READY_FOR_CONFIRMATION.
