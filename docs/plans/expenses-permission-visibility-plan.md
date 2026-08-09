# Plan: Expenses — Permission-Gated Button Visibility

Status: IMPLEMENTED + VERIFIED — 2026-07-26 (implemented by Claude directly, not via Codex; see docs/agent-memory/expenses-permission-visibility.md for evidence)
Owner: Claude
Scope: `apps/web` only. Rule: an action button the user has no permission to execute must NOT render (repo pattern A/D: hidden + typed capability object). Backend permission checks are the source of truth and stay untouched.

## Backend truth (audited from expense.controller.ts decorators + use-case guards)

Canonical keys: `apps/api/src/modules/auth/permission-registry.ts:118-135` (18 `expense.*` keys).
Effective requirement per action = decorator ∩ use-case check. Key ones for UI:

| UI action | Effective backend requirement |
|---|---|
| tab อัปโหลดใบเสร็จ (init receipt upload) | `expense.receipt.upload` |
| tab บันทึกด้วยมือ (create draft) | `expense.create` |
| tab หมวดหมู่ (list/manage all gated) | `expense.category.manage` |
| tab ลายเซ็นบริษัท (list gated by decorator) | `expense.signature.manage` |
| — ปุ่มอนุมัติ/ปฏิเสธ ลายเซ็น | `expense.signature.approve` |
| tab หลักฐานทางบัญชี (shared-evidence GET) | `expense.read` |
| — ปุ่มส่งออกชุดเอกสาร (accountant package) | `expense.export` AND `expense.read` |
| แก้ไข draft / ส่งตรวจสอบ / เริ่มตรวจใหม่ | `expense.review` OR (`expense.update` AND owner) |
| ยกเลิกรายการ (reject) | `expense.reject` |
| ยกเลิกเอกสาร (void) | `expense.void` |
| ยืนยันและลงบัญชี | `expense.confirm` |
| บันทึกชำระ | `expense.payment.record` |
| ตรวจสอบรายการซ้ำ | `expense.review` |
| ไม่ใช่รายการซ้ำ (dismiss) | `expense.duplicate.resolve` |
| อ่านเอกสารอีกครั้ง (OCR) | `expense.ocr.request` OR `expense.review` OR (`expense.receipt.upload` AND owner) |

## Gaps found (buttons visible without permission today)

1. All 5 non-list tabs always render — categories/signatures tabs 403 on open for most roles.
2. Detail modal: void, payment-record, reject, duplicate-check, dismiss-duplicate, OCR-again buttons render with no permission check.
3. `canMutateDraft = isMutable && (canReview || owner)` — owner without `expense.update` gets edit UI that 403s on save.
4. SignaturePanel approve/reject render for `signature.manage` holders lacking `signature.approve`.
5. EvidencePanel export button renders without `expense.export`.
6. Inverse gap: a pure confirmer (`pack.expense.finance`: confirm/reject/void/payment, no review) can NEVER see ยืนยันและลงบัญชี because it renders only in guided mode (`canMutateDraft`). Fix: non-guided footer shows confirm/reject on READY_FOR_CONFIRMATION for permitted users.

## Fix design (pattern D — typed capability object, unit-tested)

- `expenses.model.ts`: add `ExpenseCapabilities` + `expenseCapabilities(permissions: string[])` mirroring the backend table (incl. `canExportPackage = export && read`). Extend `expenses.model.spec.ts`.
- `ExpensesHubPage`: compute caps once; `EXPENSES_TABS` filtered by caps (list always); `?tab=` deep-link falls back to a visible tab; pass caps down (`ExpenseListPage`/`ExpenseDetailModal` take `caps` instead of `canReview`/`canConfirm` booleans; `SignaturePanel` gets `canApprove`; `EvidencePanel` gets `canExport`).
- `ExpenseDetailModal`: `canMutateDraft` requires `canReview || (canUpdate && owner)`; hide (not disable) void/reject/payment-inputs/duplicate-buttons/OCR-again per table; add non-guided READY_FOR_CONFIRMATION footer for confirm/reject holders; REJECTED restart gated like mark-ready.
- Ownership-dependent caps (OCR, update) resolved in the modal where `detail.createdByUserId` is available.
- Read-only info (paid/confirmed dates, duplicate warnings) stays visible — only actions hide.

## Verification

- New unit tests for `expenseCapabilities` + tab visibility; full web test/typecheck/build green (baseline 343).
- Manual matrix check per capability pack (view/self/review/finance) recorded in memory doc.

## 2026-08-10 amendment: related actors

- [x] Add feature-gated, view-only `expense.read_related` to the universal core pack and custom-role backfill.
- [x] Resolve relation from persisted expense, payment, substitute-receipt and source-reimbursement actors under tenant/branch scope.
- [x] Apply the same ABAC to list, detail, substitute-receipt hub/history, web navigation and LINE/AI read tools.
- [x] Keep every mutation behind its existing action permission, actor check and lifecycle state; the OCR route now declares its real action permissions instead of a read permission.
- [x] Add indexes for every actor path used by the related-view query.

Verification: focused API permission/feature/ABAC/LINE tests 138/138, AI Gateway 81/81, and focused web tests
passed. Contracts build and web/AI Gateway typechecks passed; API typecheck reports no amendment errors and
only the established 14 unrelated test errors plus one error in an untracked concurrent payer-access spec.
Prisma validate/generate passed and the complete 127-migration
chain applied to a clean PostgreSQL database.
