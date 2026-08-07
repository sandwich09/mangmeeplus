# Agent Memory: web-expense-review-step-completeness

Status: Implemented and verified (2026-08-04).

Owner: main thread.

Scope: guided expense-review stepper truthfulness + data-step density.
- `apps/web/src/features/expenses/expenses.model.ts`
- `apps/web/src/features/expenses/expense-review-steps.logic.spec.ts`
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`
- `apps/api/src/modules/expenses/application/use-cases/expense-draft-ai-missing-fields.use-case.spec.ts` (new, registered in `apps/api` `test` script)

Decisions:
- 2026-08-05, product owner override: the ตรวจข้อมูล step no longer consults AI `missingFields` at all.
  A draft whose vendor name, date and lines are filled is green even while OCR still flags a field it
  could not read — the blue "AI อ่านได้ไม่ครบ" strip already names those fields, and a ⚠ over a
  filled-in form read as an error the user could not clear. Consequence: the data step has only
  `done` / `pending`; `attention` is unreachable there, and `detailsStepDone` (which gates
  ส่งให้ผู้อนุมัติ) now follows real values instead of AI flags. The evidence step keeps its
  `category` flag rule. Risk accepted: an AI-defaulted `expenseDate` (upload stamps today) is green
  without a human touching it.
- Green (`done`) on a step means "the data that step owns is complete". The evidence step is green
  only when its own fields are complete AND no AI `missingFields` flag it owns is still outstanding;
  the final ตรวจก่อนส่ง step additionally requires the two earlier steps to be done, so the last check
  can never read as complete over an unfinished one.
- AI `missingFields` are routed to the step that owns the input: `category` → evidence step, everything
  else → data step. `receipt_evidence` is deliberately ignored by both — it is stamped once at LINE
  text-note capture and never updated, while `expenseNeedsReceiptOrSubstitute` reads live attachment
  state and already governs that rule.
- Server-side, `UpdateExpenseDraftUseCase` clears a `missingFields` flag when the save supplies the
  value (blank strings do not count; amount flags clear only when the saved lines total above zero).
  Without this the flags never cleared and a step could not go green. This is the root-cause fix —
  both PATCH routes (`:expenseId` and `:expenseId/review-fields`) go through this one use case.
- Editable drafts open on step 1 so the owner presses ถัดไป themselves. A step in `attention` is still
  jumped to directly (preserves the pre-existing "no-file draft opens on evidence" behaviour), and
  READY_FOR_CONFIRMATION still opens on the final review step.
- Density: the data step showed three messages that all said "AI read it, please check" — the transient
  extraction notice, a titled AI prefill card, and the step helper strip. Now: the info-tone extraction
  notice is suppressed when an AI summary exists, the prefill card collapsed to one compact strip
  carrying only the actionable ต้องกรอกเอง chips plus the re-read button, the step-1 helper was reworded
  to name the fields to check instead of repeating the AI line, and the redundant 🤖 AI header badge
  was dropped. Dictionary keys `expenses.ai_prefill_title` / `ai_prefill_desc` were removed (dead);
  `ai_prefill_complete` / `ai_prefill_partial` added in th + en.

Open questions: none.

Verification:
- `apps/web`: `npx tsc --noEmit -p tsconfig.json` clean (repo `lint` == this); `npx tsx --test "src/**/*.spec.ts"` → 663 pass / 0 fail.
- `apps/api`: `npx tsc --noEmit -p tsconfig.json` clean; `npx tsx --test src/modules/expenses/application/use-cases/*.spec.ts` → all pass, including the 6 new missingFields-clearing cases.
- Not run: browser/E2E. The dev stack was not up (`:3000` closed). `e2e/expenses.spec.ts` EXP-04 clicks
  step tabs explicitly, so it does not depend on which step opens first.

Next: confirm visually against a real OCR'd receipt when the dev stack is next running — specifically
that a fully-read receipt shows all three steps green while still opening on step 1.
