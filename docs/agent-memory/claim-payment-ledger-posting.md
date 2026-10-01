# Agent Memory: claim-payment-ledger-posting

Status: Code complete on `claude/claim-payment-ledger-posting-20261001` (from `origin/develop`
f63ca3441). Not pushed, no PR. Two existing gates still stand between this and a real shop: the
accounting screens are closed for this launch, and a shop on the standard chart has no reviewed
account mapping for a claim payout. Both need an owner or accountant decision (see Open questions).

Owner: thawatchai (agent session 2026-10-01)

Scope: audit row B5 — a recorded reimbursement (claim) payout was never posted to the general
ledger unless someone called `POST /posting/generate` by hand; no worker and no screen did.
Touched: the ledger auto-post drain, the period-close check, one line of the reimbursement
repository worklist query, the accounting-evidence screen and the period-close check copy on web.
No account mapping, permission, schema, route or `package.json` was changed.

## What the docs say the design was

- Manual posting was the intended design and the screen was never built. `finance-accounting-gaps-spec.md`
  GAP-02 Phase 3 shipped the posting source and the worklist endpoint
  (`GET /reimbursements/posting/pending`) and left "(ก) UI ปุ่มลงบัญชี + หน้า worklist settlement —
  ฝั่ง web" as an open follow-up.
- Auto-posting of claims was an explicit non-goal twice: `expense-ledger-auto-post-spec.md` §4
  ("…or reimbursements in this phase") and `reimbursement-step-journey-spec-th.md` ("ลงบัญชีอัตโนมัติของใบเบิก").
  The owner asked for it on 2026-10-01; the auto-post spec now carries it as §17 and the plan as Phase 6.

## Current design, verified in code

- Posting a claim payout creates ONE journal entry of type GENERATED for source
  `reimbursement.payment` + payment id, numbered from the ledger sequence, dated the paid date as a
  Thai civil date, in that month's period, every line on the claim's branch.
  Lines for a company NOT on the standard chart: Dr `2130-01` เจ้าหนี้พนักงาน / Cr `1110-01` เงินสด-ธนาคาร
  for the paid amount (`posting-engine.logic.ts`, case `reimbursement.payment`). No VAT or WHT lines.
  It is refused until every claim line's expense record has a POSTED accrual (or is a confirmed
  duplicate that needs none), while the payment is not RECORDED, or when the period is CLOSED.
- The accrual it clears is posted earlier, from each claim line's expense record: Dr expense /
  Cr employee payable (legacy `5310-01` / `2130-01`; standard chart: the category's account / `2131-09`).
- Who may post: `journal.entry.create` + `journal.entry.post` and the claim's branch in scope.
  System roles: OWNER, ACCOUNTANT. FINANCE can read the worklist (`reimbursement.finance_review`)
  but cannot post. The worker runs with a system context holding only the two journal rights and
  `expense.read`.
- The company-level setting is the `expense_auto_post` entitlement: off by default, set by the
  platform operator, requires `double_entry_ledger`, and refused unless chart, posting, tax and bank
  readiness pass. When on (with `expenses` on), a worker posts every minute, and only sources
  created or confirmed at or after the moment it was switched on.
- Void: one transaction. A posted payout gets a REVERSAL entry (mirror lines, posted immediately, in
  the original entry's period, refused if that period is not open) and becomes `reversed`; an unposted
  one becomes `not_required` and touches no ledger entry. The claim returns to READY_FOR_PAYMENT and
  its expense records to unpaid. There is nothing left for a worker to post after a void.

## Decisions

- Worker: a third branch in the existing candidate SQL, with the expense-payment gates plus the
  accrual proof of `assertSettlementPostingReady` restated in SQL. Without that pre-filter a payout
  that is merely waiting would be attempted, refused and flipped to `posting_error` every minute.
  The generator still repeats the proof and stays authoritative.
- A frozen `reimbursement` family removes claim payouts from the drain only. Only an explicit OFF
  row freezes: with `expenses` on, a company without the row inherits the family
  (`LEGACY_FEATURE_INHERITANCE`), which is what the canonical evaluator returns.
- Failure marks the payment `posting_error` through `PrismaReimbursementRepository.updatePaymentPostingStatus`
  (the payment has no error column). A failed payout is not retried by the worker, like the other sources.
- The worklist query now also returns `posting_error`. Without it the first refused attempt made
  the row vanish from the screen while still blocking period close.
- Screen: a section on the existing accounting-evidence tab, gated by the existing `canPostLedger`
  (which carries `ACCOUNTING_UI_HIDDEN`) and `reimbursement.finance_review`. It sits outside the
  panel's `!error` block and keeps its own error, so a refusal does not blank the screen.
- Period close: the check carries `breakdown`; the web names each kind and links to the screen that
  fixes it; a refused close runs the checks so the list appears without a second click.
- No account mapping was added or changed. No data migration. Nothing is posted for a company
  whose auto-post is off.

## Existing data

Payouts already recorded stay `pending`. After this change they are picked up by:
1. the worker — only for a company with auto-post on, and only payouts recorded at or after its
   activation time, once their accruals are posted;
2. the screen worklist — every unposted or failed payout of any age, in the user's branch scope;
3. (as before) a direct call to `POST /posting/generate`.
The historical backfill covers expense accruals only, so an older payout goes through the screen.

## Open questions (owner or accountant)

1. Standard chart (`TH_SME_COA_V1`, every company created by onboarding): which accounts does a
   claim payout post to? The accrual credits `2131-09` (owner decision 2026-08-09) and the same
   decision says cash or bank is resolved "from the actual payment method", which is not built.
   Until it is, the payout is refused with `posting_rule_missing`. `expense.payment` is in the same state.
2. Standard chart: a claim line typed into the claim form has no expense category, so its accrual
   is refused with `expense_account_unmapped:no_category` (GAP-02 item 3, deferred). Which account
   does a typed claim line debit?
3. A confirmed-duplicate claim line has no accrual, yet the payout debits the employee payable for
   the full paid amount. Is the resulting debit balance on the payable intended?
4. A legacy 4-decimal claim (580.0042) is settled at its satang amount (580.00): the accrual and the
   expense record keep 580.0042, the payment and settlement are 580.00. Where does the residue go?
5. Reopen the accounting screens? `ACCOUNTING_UI_HIDDEN` (owner decision 2026-08-09) hides the
   journal page, period close and every posting button, including the new worklist.

## Known residuals (pre-existing, not changed)

- Auto-post cannot be switched on today: readiness needs company `PostingRule` rows and nothing
  writes them, so the worker serves no company until that is solved.
- Readiness does not check the settlement mappings, so a company could pass it and still fail
  every payout.
- The worker and an accountant posting the same source in the same instant leave one journal, but
  the loser can leave the status at `posting_error`; posting again corrects it. Same for expenses.
- A void and a post of the same payout in the same instant are not serialized (the generator takes
  no claim lock). Same exposure as manual posting today.
- `expense-number.pg.spec.ts` (unregistered) has one stale fixture: its claim test creates no
  company membership and fails with `reimbursement_requester_unavailable`.
- The entitlement runoff matrix describes the drain as an `expense_auto_post` surface; it now also
  writes `reimbursement` rows behind the freeze above. The matrix was not edited.

## Artifacts

- API: `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts`,
  `period.use-case.ts`, `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts`
  (one predicate in `listUnpostedReimbursementPayments`), `packages/contracts/src/ledger.ts`.
- Web: `apps/web/src/features/expenses/ClaimPaymentPosting.tsx` (new), `ExpensesWorkspacePanels.tsx`,
  `ExpensesPages.tsx`, `apps/web/src/features/ledger/ledger.api.ts`, `ledger.logic.ts`, `LedgerReportsPage.tsx`.
- Specs (registered): `expense-auto-post.use-case.spec.ts`, `journal-reversal-net-zero.use-case.spec.ts`,
  `period-reimbursement-close.use-case.spec.ts`; web `ClaimPaymentPosting.spec.ts` (new),
  `ledger.logic.spec.ts`, `action-loading.spec.ts`.
- Spec (opt-in, not registered): `apps/api/src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts`.
- Docs: `docs/specs/expense-ledger-auto-post-spec.md` §17, `docs/plans/expense-ledger-auto-post-plan.md`
  Phase 6, `docs/specs/finance-accounting-gaps-spec.md` GAP-02 follow-up (ก).

## Verification (2026-10-01, this worktree)

- Typecheck (native TS, CI compiler): API rc 0, web rc 0. A planted type error in the new component
  and in the pg spec was reported, so both files are covered.
- Web suite `tsx --test "src/**/*.spec.ts"`: 2230 tests, 2230 pass.
- API specs of the ledger and reimbursement modules: 637 tests, 621 pass, 16 skipped (the registered
  claim race spec, which skips without a database), 0 fail.
- Boot DI smoke (`test:boot`): Nest resolved every provider (the drain has a new constructor parameter).
- W00 capability manifest parity: pass; no hashed file was touched, nothing regenerated.
- Real PostgreSQL (throwaway `postgres:18.3-alpine`, full migration chain applied):
  `claim-payment-posting.pg.spec.ts` 6/6; the registered claim race spec 16/16 against the same database.
- Mutation checks: 17 API mutations and 26 web mutations killed by the unit specs; 14 mutations of the
  candidate SQL, drain and worklist killed by the PostgreSQL spec.
- Layout: the two components rendered with the app's compiled CSS in headless Chromium at 320, 360,
  390, 768 and 1280 px: no horizontal scroll, no element outside the viewport, 44 px actions on phone.
- Not run: the full API fixed list, Playwright e2e, a live browser session (the section is hidden
  by `ACCOUNTING_UI_HIDDEN`, and no seeded stack was started).

To re-run the PostgreSQL spec against a throwaway database:
`CLAIM_PAYMENT_POSTING_PG_TEST=1 DATABASE_URL=postgresql://…@127.0.0.1:<port>/<db> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts`

## Next

- Owner or accountant answers open questions 1 and 2; then the settlement mapping can be built
  (chart bootstrap plan Phase 6, posting-rules plan Phase 5) and standard-chart shops can post.
- Owner decides question 5; flipping `ACCOUNTING_UI_HIDDEN` shows the worklist with the other posting buttons.
- If wanted: register the PostgreSQL spec in CI (needs a `package.json` or `ci.yml` edit, owner approval).
