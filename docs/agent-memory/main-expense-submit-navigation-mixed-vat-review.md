# Agent Memory: main-expense-submit-navigation-mixed-vat-review

Status: Completed and pushed to develop on 2026-08-27 by the authorized source-VAT agent. No deployment or live record changes.
Owner: /root for review/coordination; /root/expense_document_vat_acceptance for implementation and delivery.
Scope: Review returning to the expense list after successful review submission, mixed VAT/non-VAT lines, and document VAT different from calculated VAT; implement the remaining actual source-VAT acceptance gap on fresh develop. Preserve the already-present navigation and mixed-VAT features. No deployment or live customer-record changes.

## Decisions

- Baseline: `origin/main` = `007dcba70376acb94aa5b55275840304cabd6f68`; fetched `origin/develop` = `e9c4794b772971adb95154ed0ba70b999c9fd5a0` on 2026-08-27. Root checkout stays on `plan`; preserve the unrelated edited plan and untracked docs.
- Source-of-truth plan: `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md` sections 13.11.A (EXP-UX-01) and 13.11.B (VAT-MIX-01), read from main, plus `docs/agent-memory/expense-vat-source-reconciliation.md`.
- Follow mandatory ponytail full using the available repo skill. The legacy absolute path in AGENTS is unavailable; the local `.agents/skills/ponytail/SKILL.md` was read fully. Reuse existing tests and a temporary diagnostic; no new abstraction, dependency, or package.json edit.

## Findings

### Review submission navigation is already in main

- `apps/web/src/features/expenses/ExpenseReviewPage.tsx:330`: `markReady` awaits either the own or reviewer API, then refreshes the list and calls `router.replace('/companies/<id>/expenses?highlight=<expenseId>')` before showing `ส่งตรวจเรียบร้อยแล้ว`. It retains the disabled state until unmount; an API failure remains on the detail page.
- `apps/web/src/features/expenses/ExpensesPages.tsx` finds/highlights the exact submitted ID and adjusts list filters/pagination to reveal it; it does not guess the newest row.
- `e2e/expenses.spec.ts:146` EXP-04B @smoke asserts the detail-to-list URL, highlighted exact row, `พร้อมยืนยัน` label, and API `READY_FOR_CONFIRMATION` state. This E2E was inspected, not rerun in this turn.
- Distinguish the separate final-accounting action `ยืนยันและลงบัญชี`: it uses `doAction`, reloads the detail, and has a different toast. The user's quoted `ส่งตรวจเรียบร้อยแล้ว` matches `markReady`; do not conflate these actions.
- No inference about the current UAT deployed revision or the user's actual navigation failure was made.

### Mixed VAT/no-VAT arithmetic is already supported

- Main per-line VAT selection includes standard, exempt/no-VAT, zero-rated, custom, and unknown. Explicit zero is accepted; a blank rate in a VAT-bearing document remains unknown and is not silently converted to zero.
- Focused golden cases prove `100 @ 7% + 50 @ 0%` under VAT_EXCLUDED and `107 gross @ 7% + 50 @ 0%` under VAT_INCLUDED both produce VAT 7 and total 157. Residual rounding is never assigned to a non-VAT line.
- A real over-tolerance discrepancy can be persisted as draft and blocks confirmation until resolved; source VAT and computed VAT are retained separately.
- Main still collapses exempt and zero-rated semantics to stored rate zero. The earlier WHT/mixed-VAT task already delivered durable per-line tax treatment to develop (`bef36ab35d77e79e371788b1abf57e3bdf75ddc0`, delivery `8cafd8af9510bd8f1a866ab67b39db90df1304f5`); do not duplicate that work or imply it is deployed.

### Remaining gap: “use document VAT” bypasses the block without accepting the amount

- `ExpensesPages.tsx:1609` offers a reviewer carrier line and written reason, then promises confirmation using the source amount.
- `expense-draft.use-case.ts:636` checks `expense.review`, a nonempty reason, and a positive-VAT carrier line, and logs `expense.vat.source_override`. It does not pass an accepted amount/decision into the atomic finalizer or change amounts.
- `prisma-expense.repository.ts:2027` atomically finalizes tax snapshots and status/outbox but never updates source-acceptance status or header VAT for this override. The FINAL tax callback receives existing calculated line amounts.
- An observation test exercising the real ConfirmExpenseUseCase and PrismaExpenseRepository with an in-memory Prisma harness and deterministic tax-service stub reproduces: source VAT 8, calculated/stored VAT 7, reviewer chooses source -> CONFIRMED, but persisted header VAT remains 7, gross remains 107, tax finalizer receives 7, snapshot remains MISMATCH / acceptedSource CALCULATED, and the source-override audit exists.
- The existing reviewer-override test checks success and audit only, so its passing result did not cover actual accepted/persisted amounts.
- This proves a source-acceptance gap, not the specific cause of the user's unseen bill error. Do not suggest changing taxable lines to no-VAT just to bypass it.

## Open questions

- No current bill payload, screenshot, record ID, VAT values, or exact UI path was supplied for this issue. Need those only if investigating the actual UAT occurrence; this review establishes main code behavior.
- User explicitly authorized implementation, tests, and a normal push into develop after this report. No clarification needed for that scope. Keep prior Checkbill and employee-deletion deliveries independent.

## Artifacts

- Main source snapshot: `/tmp/mangmee-main-wht-vat.nbXuKs` (production code is unchanged).
- Temporary observation appended only in that snapshot to `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts`; clearly labeled diagnostic/current behavior, not desired regression. Root product code is unchanged.

## Verification

On the main snapshot, before appending the diagnostic:

```sh
./apps/api/node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec apps/api/src/modules/expenses/domain/logic/expense-totals.logic.spec.ts apps/api/src/modules/expenses/application/use-cases/expense-draft-vat-decouple.use-case.spec.ts apps/api/src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts
# 106 passed, 0 failed, 0 skipped

./apps/api/node_modules/.bin/tsx --tsconfig apps/web/tsconfig.json --test --test-reporter=spec apps/web/src/features/expenses/expense-review-validation.spec.ts apps/web/src/features/expenses/expenses.model.spec.ts apps/web/src/features/expenses/expenses-audit.logic.spec.ts
# 105 passed, 0 failed, 0 skipped
```

After appending the source-VAT diagnostic, reran the atomic-confirm spec: 6 passed (5 existing + 1 diagnostic), which reproduces the gap rather than demonstrating a fix. Total unique checks: 211 existing plus 1 diagnostic. No live DB, real accounts, browser E2E, or deployed-state checks were used.

## Implementation handoff — 2026-08-27

- Fetched main/develop again. Main remains `007dcba70376acb94aa5b55275840304cabd6f68`; develop is `2ef787b1cabf08f0958890d5b6f2ce68e327b2d6` including the password test-runner follow-up.
- Created `codex/expense-document-vat-acceptance` from that exact develop at `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-expense-document-vat-acceptance`; initial worktree clean. Root remains on `plan`, unrelated changes preserved.
- Spawned `/root/expense_document_vat_acceptance`. Agent must read AGENTS/ponytail and current docs/code/contracts, record its scoped plan/decision and `docs/agent-memory/expense-document-vat-acceptance.md`, implement, test, merge latest develop, and push feature/develop normally (no force). No deployment or main push.
- Required outcome: explicit authorized source-VAT acceptance updates actual carrier/line/header totals, accepted snapshot, FINAL tax components/report/posting values consistently. Preserve captured source/calculated evidence and existing VAT_INCLUDED/VAT_EXCLUDED, WHT and non-VAT semantics; no-VAT lines cannot absorb adjustments or become claimable.
- Preserve permissions, tenant/branch, unknown/invalid/rate-conflict/evidence guards, CAS/source checksum, period locks, numbering and atomic outbox. Override success audit belongs with the successful mutation, not before a later failed confirmation. Do not backfill historical confirmed records or create a policy-bypass blanket override.
- Verification includes actual persisted/FINAL values (not only success and audit), both VAT modes, mixed/no-VAT lines, invalid/unauthorized/stale/failure paths, test-runner coverage, types and UI accepted-state behavior. Recheck existing navigation/mixed-VAT paths without duplicating them. Only isolated/synthetic local tests; no live records/accounts.
- Notified Checkbill owner `/root/wht_units_mixed_vat` about potential expense module overlap. Each agent must preserve the other's narrow diff by fresh fetch/merge/retest before normal pushes. Avoid mutation through shared dependency/generated-client symlinks.

## Delivery — 2026-08-27

- Agent reports implementation `2b46cebb`, tested integration `65575487`, and final documented feature/develop tip `234d14255de67275d087aae85b63f1216f142210`. Root's subsequent develop fetch confirms this delivery is an ancestor of the notification integration.
- Explicit source-VAT acceptance now updates actual carrier-line/header totals, accepted decision, FINAL tax/report/posting values consistently; original captured and calculated evidence remains. No-VAT lines stay untouched; tax-code tolerance and permission/source-state protections remain. Success audit is atomic with confirmation. Web passes expectedUpdatedAt only for explicit override.
- Agent post-merge verification: expense API 1035 passed/6 DB-only skipped; shared-tax 365 passed/14 DB-only skipped; web 1195 passed; contracts 204 passed; API/web types and synthetic browser passed. DB-backed/live tests were not run; no customer records or deployment were touched.
- Full scoped evidence and limitations: `docs/agent-memory/expense-document-vat-acceptance.md` in the delivered branch. Existing submit-to-list navigation and mixed/no-VAT semantics preserved rather than duplicated.

Next: No implementation work remains for this source-VAT acceptance gap; a live release or investigation of a particular UAT record is a separate workflow.
