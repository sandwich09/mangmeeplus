# Agent Memory: expense-detail-stepper-ux

Status: IMPLEMENTED — 2026-07-26 (uncommitted in working tree, branch fix/permissions-system)
Owner: Claude (harness) → implementation subagent
Scope: apps/web only. `ExpenseDetailModal` guided step flow per docs/plans/expense-detail-stepper-ux-plan.md. No API/contract changes.
Decisions:
- Guided stepper only when canMutateDraft && status ∈ {DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION}; all other views unchanged (`guided = canMutateDraft`, which already implies those statuses).
- 4 steps: document → details → evidence → review. Step state derived from ExpenseDetail (server truth) via `deriveExpenseReviewSteps(detail, canReview)` in expenses.model.ts; `substituteReady` lifted into `expenseSubstituteReceiptReady` (single source shared with the modal).
- Chips freely navigable (badge ✓/⚠/number); initial step computed once per opened expenseId (ref-guarded effect) so in-modal refreshes never auto-jump; READY_FOR_CONFIRMATION opens at step 4.
- ส่งตรวจสอบ gains UI-only minimum-data gate (details step done: vendor name + date + ≥1 line) with `expenses.submit_requires_details` tooltip; classificationBlocked guard and all other handlers/guards/tooltips untouched. ปฏิเสธ lives on step 4 only; reject/void reason sub-footer unchanged.
- Payment card hidden in guided mode (no content in those statuses).
- Plan deviations (recorded): (1) plan's evidence done-criterion said `taxEvidenceStatus !== 'PENDING_REVIEW'` — that value does not exist in `TaxEvidenceStatus`; implemented with the actual pending value `'NEEDS_REVIEW'`. (2) `initialExpenseReviewStep(steps, status?)` takes an optional status param so the "READY_FOR_CONFIRMATION → step 4" rule lives in the pure model and is unit-tested. (3) optional `expenses.step_of` key skipped (unused).
Open questions: none blocking.
Artifacts:
- docs/plans/expense-detail-stepper-ux-plan.md (EN plan, source of truth)
- ../Doc/expense-detail-stepper-ux-summary-th.md (Thai summary, outside repo)
- apps/web/src/features/expenses/expenses.model.ts (`ExpenseReviewStepKey/State`, `expenseSubstituteReceiptReady`, `deriveExpenseReviewSteps`, `initialExpenseReviewStep`)
- apps/web/src/features/expenses/ExpensesPages.tsx (`ExpenseDetailModal` guided mode; section JSX moved into named blocks, internals unchanged)
- apps/web/src/common/i18n/workspace-dictionary.ts (th+en `expenses.step_document/step_review/step_next/step_back/submit_requires_details`)
- apps/web/src/features/expenses/expense-review-steps.logic.spec.ts (10 node:test cases)
- e2e/expenses.spec.ts (EXP-04 navigates chips ผู้ขายและรายการ → สรุปและส่งตรวจ)
- docs/specs/expense-receipt-upload-spec.md (§13 Web: guided step flow bullet)
Verification:
- `corepack pnpm --filter @watchdog-bms/web test` → 325 tests, 86 suites, pass 325 / fail 0 (includes new expense-review-steps.logic.spec.ts: 10 pass).
- `corepack pnpm --filter @watchdog-bms/web typecheck` → clean (exit 0). Note: required `corepack pnpm --filter @watchdog-bms/contracts build` first — contracts dist was stale on this working copy and produced 14 pre-existing errors in crm/employee-access files unrelated to this change.
- E2E EXP-01..05 not run here (needs running stack); EXP-04 updated per plan.
- Harness re-verification (independent, 2026-07-26): re-ran web test (325/325 pass) and typecheck (clean); `corepack pnpm --filter @watchdog-bms/web build` succeeds; full-file `git diff` of ExpensesPages.tsx reviewed — hunks confined to imports + modal region, hub/EXPENSES_TABS untouched; all 8 original actions confirmed present with unchanged handlers/guards; non-guided composition byte-matches the original section order.
Next: run e2e EXP-01..05 against a running stack; manual walk DRAFT→ส่งตรวจสอบ and READY_FOR_CONFIRMATION→ยืนยันและลงบัญชี when the app is up.

Update 2026-07-26 (owner request): the details-step "บันทึกข้อมูลและรายการ" button was removed — `ExpenseReviewEditSection.save` (now returns boolean) is registered into the modal via `saveRef` and runs on ANY navigation leaving the details step (ถัดไป/ย้อนกลับ/chips, `goToStep`); navigation is blocked while saving or when save fails (error stays in the section). Line-item ลบ button replaced with a red ICON.trash icon button (aria-label kept). `expenses.save_review` key retained but unused.
