# Agent Memory: Expense review loading and direct cancellation

Status: Source fix complete; user approved integration into main and develop. Local integration checks passed on latest main; PR CI and merge pending. No deployment. Full authenticated E2E remains blocked by the existing local customer-access CLOSED response.
Owner: Codex
Scope: Expense review form loading boundary, durable-read busy state, and cancellation-to-deletion footer actions. No deployment or API contract changes.
Decisions:
- Follow `expense-review-page-redesign-plan.md` §3.2: cover the whole editable section while receipt upload/extraction/read job is active, across review steps. Keep receipt preview usable.
- Keep the form mounted; use a stable fieldset with disabled/inert and a sibling cover. Native disabled alone does not cover custom select summaries. Keep the spinner near the visible top of long forms using CSS sticky.
- Keep the lock until applied read results have refreshed. Terminal partial/failed/paused outcomes allow manual completion.
- Show cancellation directly in the footer with existing permissions, reason dialog, and confirmation. After the approved follow-up, replace it with direct deletion only for REJECTED records; financial void retains its existing menu.
- Use repository ponytail full skill; the legacy `/Users/spare058/...` skill path is absent, and `.agents/skills/ponytail/SKILL.md` is the local source.
Open questions: None.
Artifacts:
- `apps/web/src/features/expenses/ExpenseReviewPage.tsx`
- `apps/web/src/features/expenses/ExpenseReviewPage.qa.spec.ts`
- `e2e/expenses.spec.ts`: direct-cancel scenario updated; pending interaction scenarios added at 390/1280px.
- Isolated real-component harness and screenshots: `/tmp/expense-review-loading-qa/`.
Verification:
- `pnpm --filter @watchdog-bms/web exec tsc --noEmit --incremental false`: passed.
- ExpenseReviewPage QA, capture-status, and substitute-preview suites: 36 passed. Rerunning with `src/common/components/button/action-loading.spec.ts` yielded 45 passed / 1 failed: the global audit reports six pre-existing aria-busy gaps in AccountEmailOtpPanel, BillingPage, and ReimbursementJourneyPage; none in this change. Left those unrelated files untouched.
- `pnpm exec playwright test e2e/expenses.spec.ts --project=chromium --grep 'EXP-04A|EXP-READ-LOCK' --workers=1 --retries=0`: stopped before scenarios at dev-login 503 (`MangmeePlus customer access is currently closed`). No service or customer gate was changed.
- `pnpm exec playwright test --config=/tmp/expense-review-loading-qa/playwright.config.cjs`: 3 passed. Runs the same browser scenarios with the actual ExpenseReviewPage/children/styles; only Next navigation shell and local API/provider responses are simulated. Confirms direct cancellation opens the existing reason dialog, complete overlay bounds, disabled native controls, inert custom selector focus, visible spinner, usable desktop preview button, stable input node and draft value through loading, same-attachment QUEUED handoff, lock through final detail refresh, DONE/PARTIAL/PAUSED/FAILED unlock, reload into a running job, and no horizontal overflow at 390/1280px. This does not prove real backend cancellation or auth integration.
- Visually checked desktop loading and mobile ready screenshots. Initial full-section spinner was below the fold; moved it to a sticky upper position and reran successfully. Browser assertion was narrowed to the AI status because the form also has a totals status.
- `git diff --check`: passed. No dependency or package.json changes.
Next: Ready for review/source integration. Run the native authenticated scenarios once a local test environment accepts login; UAT/Production deployment was not requested.

## Main/develop integration authorized

- User approved “โอเคแล้วเอาเข้า main+develop ได้”. Scoped integration uses the four code/test files and this memory only; dictionary includes only the two `expenses.rejecting` keys, excluding unrelated counterparty work.
- Isolated managed worktree: `/Users/thawatchai/.codex/worktrees/expense-review-actions/mangmeeplus`, branch `codex/expense-review-actions-main-20260929`, based on `origin/main` at `b72cab2fdd14bf8d632f9db4af19c8941b3c1063`. Original shared working directory and other pending changes remain intact.
- The scoped patch applies cleanly to current main and retains its newer expense-review changes. Relevant source files match develop before this patch; separate PRs will keep unrelated branch history out of each integration.
- Installed existing lockfile offline with frozen-lockfile; built contracts/design tokens. No package.json or lockfile changes.
- Rebuilt the real-component harness from the integration worktree on port 19340. All three browser scenarios passed against this newer source (cancellation failure/pending/success/delete confirmation, complete loading lock at 390/1280px).
- `pnpm --filter @watchdog-bms/web test`: 2,204 passed, zero failures; the earlier shared-workspace loading-audit failure is absent on this newer integration base. `pnpm --filter @watchdog-bms/web typecheck`: passed, including Next route generation. `git diff --check` and staged diff checks: passed.
- GitHub CI will be checked before merge. Deploy workflows are manual; no release or customer-gate action was requested.

## Interactive preview requested

- Opened and verified the actual component in the Codex browser at `http://127.0.0.1:19339/companies/seed-local-company/expenses/synthetic-1`; tab marked as a deliverable.
- Preview server now runs in exec session `13405`, using `/tmp/expense-review-loading-qa/run.cjs`. All records and provider/API replies are local synthetic data. No real OCR request or customer mutation occurs.
- Demo receipt is an explicitly synthetic SVG. “อ่านเอกสารอีกครั้ง” simulates a 10-second read so the user can inspect the whole-form cover; “ยกเลิกรายการ” opens the existing confirmation dialog directly.

## Follow-up proposal: cancellation then deletion

- User asks why “เพิ่มเติม” remains and whether “ยกเลิกรายการ” should become “ลบ” only after cancellation succeeds.
- Current implementation keeps delete in “เพิ่มเติม”; the existing shared delete policy also permits draft deletion. Cancellation changes this review flow to REJECTED, preserves the record, and exposes the existing restart-review action; hard deletion is a separate action subject to permission, retention, and linked-data guards.
- Recommended review-page UX: show cancellation during review, show pending state while cancelling, then replace it with direct deletion only after confirmed server success and when the existing delete permission allows it; retain deletion confirmation and the restart-review alternative. Remove the unnecessary menu in this flow. Financial VOIDED/posted cases retain their separate rules.
- Discussion only in this turn; no implementation of this proposed state-based action change yet.

## Approved and implemented: cancellation then deletion

- User approved with “โอเค ลองทำมาดู”. The standard expense review footer now shows cancellation while reviewing, “กำลังยกเลิก…” with disabled confirmation/reason while the request is pending, and direct “ลบ” in the same position after refreshed server state is REJECTED and existing delete permissions allow it.
- No “เพิ่มเติม” menu remains in this review flow. Failed cancellation preserves the reason and offers retry without exposing deletion. Permanent deletion still needs the existing confirmation; “เริ่มตรวจใหม่” remains available under existing permissions.
- Shared backend/list deletion rules, financial void actions, and the separate blocked check-bill preparation controls are unchanged. No data model, API, permission, or dependency changes.
- Added only the Thai/English `expenses.rejecting` dictionary entry; preserved unrelated dictionary edits.
- Extended EXP-04A to exercise dismissal, delayed cancellation, failure/retry, success, action replacement, and dismissing permanent-delete confirmation while retaining API state. The local harness uses the same scenario source.
- Verification rerun: TypeScript passed; focused QA/capture-status/substitute-preview tests 36 passed; local real-component browser scenarios 3 passed (including loading coverage at 390/1280px); `git diff --check` passed. Native authenticated E2E remains unverified because of the previously recorded CLOSED customer gate; did not change or retry that environment.
- Preserved the user's synthetic-1 record (already REJECTED) across preview restart. Reloaded the visible Codex browser and verified direct deletion plus restart-review; opened and dismissed the delete confirmation without deleting. Screenshot: `/tmp/expense-review-loading-qa/cancel-to-delete-preview.png`. Tab remains available for review; no deployment.
