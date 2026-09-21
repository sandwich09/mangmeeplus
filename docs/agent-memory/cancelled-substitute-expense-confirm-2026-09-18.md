# Agent Memory: Cancelled substitute receipt blocks expense confirmation

Status: Implemented and verified locally; not deployed.
Owner: Codex
Scope: Expense confirmation after cancellation of a substitute receipt, following `docs/specs/expense-evidence-and-substitute-routing-spec.md`.
Decisions:
- The web confirmation gate retained a legacy fallback from missingReceiptReason/generated-at/source type to a signature requirement. Cancellation excludes SUPERSEDED evidence from expense detail but preserves the old reason and evidence assessment. This can display a signature demand for an inactive certificate.
- Use the existing shared expenseEvidenceConfirmationError in the web footer and review stepper, as API preflight and final transaction already do. An old reason alone must never require a signature.
- With no active certificate, a reviewed SUBSTITUTE_RECEIPT route asks the reviewer to select current evidence or prepare a new certificate. Never instruct them to sign cancelled history.
- SOURCE_DOCUMENT and ALTERNATIVE_EVIDENCE reviews allow confirmation even when the old reason/history remains. Cancellation itself is not evidence approval; missing/stale reviews and unfinished active certificates remain blocked.
- Preserve certificate history, signature/approval, payment, VAT, permissions, tenant/branch and transaction rules. No data cleanup, migration, deployment or package.json edits.
Open questions: None for this code fix. The screenshot does not identify a live expense ID; no production record was inspected or changed.
Artifacts:
- Shared contract confirmation validator and regression test.
- Web confirmation footer/stepper and regression tests.
- Existing atomic-confirm test extended with a retained cancellation reason.
- Browser recovery case in e2e/substitute-cancelled-view-only.spec.ts.
Verification:
- `corepack pnpm --filter @watchdog-bms/contracts build`: passed.
- `corepack pnpm --filter @watchdog-bms/contracts exec tsx --test src/expense-evidence.spec.ts`: 11 passed.
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-confirm-blocker.spec.ts src/features/expenses/expense-review-steps.logic.spec.ts src/features/expenses/ExpenseReviewPage.qa.spec.ts src/features/expenses/expenses.model.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts`: 136 passed.
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts`: 34 passed. Transaction tests use an in-memory repository harness, not a live PostgreSQL transaction.
- `corepack pnpm --filter @watchdog-bms/web typecheck` and final `corepack pnpm --filter @watchdog-bms/web exec tsc --noEmit`: passed. `git diff --check`: passed.
- `WEB_PORT=3020 E2E_WEB_BASE_URL=http://127.0.0.1:3020 corepack pnpm exec playwright test e2e/substitute-cancelled-view-only.spec.ts --project=chromium`: 3 passed. Real local authentication/browser, mocked expense responses. DIGITAL/PAPER cancellation stays view-only; the new case displays an actionable blocker, goes back to review the actual receipt, enables confirmation and sends exactly one confirm request on the same expense. No browser errors.
- Logs: `/tmp/cancelled-substitute-{web-tests,api-tests,web-typecheck,browser}.log`. Visually checked `test-results/substitute-cancelled-view--74300-nd-confirm-the-same-expense-chromium/cancelled-receipt-ready.png`.
- Preserved read-only and already-confirmed step display behavior; final confirmation always uses the shared validator. Reverted only the generated next-env.d.ts route-path change from the local browser run.
Next: User can review the scoped local diff; no production record was changed and release/deployment is a separate step.

## Production hotfix follow-up

- User requested combining this fix with isolated Production hotfix `8f5b508a` rather than bringing current main into Production.
- Production base `fc2838c4` lacks the v2 evidence review implementation. Implemented a scoped compatible fix in `/Users/thawatchai/.codex/worktrees/line-trial-pricing-prod-hotfix/mangmeeplus`, on `codex/line-trial-pricing-prod-hotfix-20260918`, as commit `0b0058adbc7353ec906a33746867af2a235b0934`, directly after `8f5b508a`.
- This backport only releases a retained-reason gate when the server finds cancelled certificate history, no current certificate/generated marker remains, and the primary original document is active and eligible. The same shared predicate runs in web, API preflight and final locked transaction. No v2 workflow, migration, dependencies, release controller or unrelated main work is included.
- Production-base verification: 51 contract + 117 web + 385 API/LINE tests passed (553 total), browser recovery passed, API/web typechecks passed. See the hotfix worktree's `docs/agent-memory/cancelled-substitute-prod-hotfix-2026-09-18.md` for exact commands and test limitations.
- The original main edits remain available separately. No deployment or customer data mutation was performed.
