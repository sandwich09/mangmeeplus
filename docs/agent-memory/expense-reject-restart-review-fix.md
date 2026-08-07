# Agent Memory: expense reject / restart-review fix

Status: Done (single turn)
Owner: thawatchai
Scope: `apps/api` expense status machine + mark-ready use case, `apps/web` expense review page reject/void panel

Decisions:
- `REJECTED` is no longer terminal: it may reopen to `NEEDS_REVIEW` only. Straight to
  `READY_FOR_CONFIRMATION` was rejected — it would make a rejected record confirmable in one click
  with no correction. `REJECTED -> DRAFT/READY_FOR_CONFIRMATION/CONFIRMED` stay blocked
  (spec `expense-receipt-upload-spec.md:1231` requires rejected-to-confirmed to fail).
- `MarkExpenseReadyUseCase` targets `NEEDS_REVIEW` when the record is `REJECTED`, so the existing
  `mark-ready` / `reviewer-mark-ready` endpoints keep serving the web "เริ่มตรวจใหม่" button
  (`docs/plans/expenses-permission-visibility-plan.md:43` already specified this restart action).
  Skipped a dedicated reopen endpoint: same permission gate, same callers, larger diff.
- Rejection stamps (`rejectedAt` / `rejectReason`) are kept on reopen — the editor needs the reason.
  Side effect: the "ปฏิเสธเมื่อ …" line in `ExpenseReviewPage` now stays visible after reopen.
- Reject/void reason box now closes on success, matching the duplicate-resolution branch.

Open questions:
- Should the "ปฏิเสธเมื่อ …" line be gated on `status === 'REJECTED'` so a reopened/confirmed record
  stops showing it as current state? Left as-is (history is useful while correcting).

Artifacts:
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts`
- `apps/api/src/modules/expenses/domain/logic/expense-status.logic.spec.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`

Verification:
- `npx tsx --test "src/modules/expenses/**/*.spec.ts"` (apps/api) — 313 pass, 0 fail.
- `npx tsc --noEmit` in `apps/api` and `apps/web` — clean.
- Not run: browser E2E on the reopen path.

Next:
- Manual check: reject → panel closes → "เริ่มตรวจใหม่" returns the record to `NEEDS_REVIEW`.
