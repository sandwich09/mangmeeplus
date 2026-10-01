# Agent Memory: claim-payment-ledger-posting

Status: Code complete on `claude/claim-payment-ledger-posting-20261001`, including the fixes an
independent review asked for on 2026-10-01 (section "Review follow-up"). The branch contains
`claude/reimb-payout-assembly-20261001`: merged in at `3d0bbb713` before the fixes, and again at
`72b449454` after them (assembly tip `1d3a6dc16`; the only conflict was two import lines of the
reimbursement repository, both sides kept). Not pushed, no PR. Two existing
gates still stand between this and a real shop: the accounting screens are closed for this launch,
and a shop on the standard chart has no reviewed account mapping for a claim payout. Both need an
owner or accountant decision (see Open questions).

Owner: thawatchai (agent session 2026-10-01)

Scope: audit row B5 — a recorded reimbursement (claim) payout was never posted to the general
ledger unless someone called `POST /posting/generate` by hand; no worker and no screen did.
Touched: the ledger auto-post drain, the journal generator's settlement of a claim payout, the
period-close check, the accounting-evidence screen and the period-close check copy on web, one CI
step, and a few lines of the reimbursement lane (listed under Artifacts).
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
  its expense records to unpaid.

### The worker never posts a void reversal, and does not need to

The task asked for the worker to post claim payments "and their void reversals". There is no such
work to do, and the worker has no code for it. A void writes and posts its own reversing entry
inside the void transaction, so a reversal is never pending. The candidate SQL selects RECORDED
payments only, so a voided payout is never offered to the worker either. Any earlier note or report
that read as if the worker picks reversals up was wrong: what the worker picks up is the payout.

## Decisions

- Worker: a third branch in the existing candidate SQL, with the expense-payment gates plus the
  accrual proof of `assertSettlementPostingReady` restated in SQL. Without that pre-filter a payout
  that is merely waiting would be attempted, refused and flipped to `posting_error` every minute.
  The generator still repeats the proof and stays authoritative.
- A frozen `reimbursement` family removes claim payouts from the drain only. Only an explicit OFF
  row freezes: with `expenses` on, a company without the row inherits the family
  (`LEGACY_FEATURE_INHERITANCE`), which is what the canonical evaluator returns.
- A failed payout is not retried by the worker, like the other sources.
- The worklist query also returns `posting_error`. Without it the first refused attempt made
  the row vanish from the screen while still blocking period close.
- Screen: a section on the existing accounting-evidence tab, gated by the existing `canPostLedger`
  (which carries `ACCOUNTING_UI_HIDDEN`) and `reimbursement.finance_review`. It sits outside the
  panel's `!error` block and keeps its own error, so a refusal does not blank the screen.
- Period close: the check carries `breakdown`; the web names each kind and links to the screen that
  fixes it; a refused close runs the checks so the list appears without a second click.
- No account mapping was added or changed. No data migration. Nothing is posted for a company
  whose auto-post is off.

## Review follow-up (2026-10-01)

An independent review of `151c09c80` found two concurrency defects and five gaps. All seven are
fixed on the branch, one finding per commit.

1. **Post versus void** (`873d07373`, proof added in `899b23936`). The generator read the payment as
   RECORDED and wrote its journal many queries later; a void committing in between left a POSTED
   settlement on a VOIDED payment, with nothing to reverse it. Now the settlement is ONE
   read-committed transaction whose first statement stamps the payment `posted` with
   `where status = 'RECORDED'`. That row write takes turns with the void's own update of the row:
   whoever is second sees the other's committed result. The void finds a posted journal and reverses
   it, or the post finds a voided payment and writes nothing (no journal, no number, no stamp) and
   answers `reimbursement_payment_not_recorded`. The journal number is reserved and committed in the
   same transaction (`executeInTransaction` on the two numbering use cases), so a refused or failed
   settlement burns no number. Two posters take turns the same way; the second is answered with the
   first's journal.
2. **The worker's error stamp** (`b9f19cfb4`, `1801a7a63`, proof added in `a6eb9cd7c`).
   `updatePaymentPostingStatus` writes a RECORDED payment only and says whether it wrote, so a
   payment voided after the candidates were read keeps the status its void gave it. When an attempt
   is refused the worker stamps `posting_error` FIRST, then reads the journal table, in one
   transaction; if a posted settlement exists it stamps `posted` instead. The stamp holds the
   payment row, so no settlement can commit behind the read. The reason is kept as a structured log
   line `ledger.auto_post.claim_payout_failed` with the company id, the payment id and the code
   (the payment row has no error column).
3. **CI runs the SQL** (`4ac5382f4`). `claim-payment-posting.pg.spec.ts` runs in the
   "Migrations and Boot" job of `.github/workflows/ci.yml`, through
   `CLAIM_PAYMENT_POSTING_TEST_DATABASE_URL`, against a database of its own
   (`watchdog_claim_posting_ci`, created and migrated by the step). It needs its own database
   because the drain reads every ACTIVE company. The candidate SQL text and the worklist `where`,
   `orderBy` and `take` are also pinned in `expense-auto-post.use-case.spec.ts`, which CI runs
   without PostgreSQL.
4. **Worklist size** (`d451f433d`). The query takes at most `CLAIM_PAYOUT_WORKLIST_LIMIT` (200)
   rows, oldest payment first. The screen draws ten and adds ten per "แสดงเพิ่ม"; at the limit the
   heading says "200 รายการแรก" instead of a total.
5. **A payment dated in a closed period** (`114d18a88`). Recording refuses it, the way expense
   confirmation does: 409 `reimbursement_payment_accounting_period_locked:<month>` unless the period
   of the paid date (Thai time) is OPEN, REOPENED or not opened yet. The check runs in the existing
   readiness preflight, before a payment number is reserved. A replay of a payment already recorded
   is still answered as recorded. The web message tells the payer to check the date or have the
   period reopened first.
6. **Web nits** (`b6a0cc05f`). The card is on the page from the start with a one-line loading
   state, and "nothing waiting" is one line of the same height, so the page below does not jump. A
   failed first load shows the reason and "โหลดอีกครั้ง", not "(0 รายการ)". The claim-number link is
   44 px tall. The row badges and the period-close check share one wording from one constant
   ("ยังไม่ลงบัญชี" / "ลงบัญชีผิดพลาด"). Another currency is named in Thai, never by its code.
7. **Docs** (this file, spec §17, plan Phase 6).

Left alone on the reviewer's instruction: auto-post readiness ignoring the settlement mappings
(it fails closed), and the accountant questions below.

## Existing data

Payouts already recorded stay `pending`. They are picked up by:
1. the worker — only for a company with auto-post on, and only payouts recorded at or after its
   activation time, once their accruals are posted;
2. the screen worklist — every unposted or failed payout of any age, in the user's branch scope,
   the 200 oldest first;
3. (as before) a direct call to `POST /posting/generate`.
The historical backfill covers expense accruals only, so an older payout goes through the screen.
A payout that already sits in a closed period (recorded before recording refused such a date) is
refused with `period_closed` until that period is reopened; it stays on the worklist.

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

## Known residuals

- Auto-post cannot be switched on today: readiness needs company `PostingRule` rows and nothing
  writes them, so the worker serves no company until that is solved.
- Readiness does not check the settlement mappings, so a company could pass it and still fail
  every payout. It fails closed; left as it is on the reviewer's instruction.
- The closed-period check at recording is a read before the write, not a lock. The period close
  itself runs its checks and then updates the period with no lock, for every source, so a close and
  a recording in the same instant are not serialized. The result would be a `pending` payout in a
  closed period, which stays on the worklist until the period is reopened.
- The generator stamps `pending` before it posts. That early stamp can overwrite `posted` only if a
  second poster passes the "journal already exists" read, the first then commits, and the second
  dies before its own claim. Posting again corrects the flag; the journal is not affected.
- Expense sources (`expense.record`, `expense.payment`) keep the older path: number, journal and
  flag are separate writes, the worker and an accountant racing can leave the flag at
  `posting_error`, and two posters can collide on the journal number. Only the claim payout was in
  scope here.
- First use of a month: two posters creating the same accounting period at once can collide on the
  period upsert. Pre-existing, any source.
- When the worker's own bookkeeping fails (database error while settling a refusal) the drain run
  ends with that error and the next run starts again. Same as the other sources.
- `reimbursement-payout-account-and-payment-slip-spec-th.md` (another lane) does not yet mention
  the closed-period refusal at recording.
- `expense-number.pg.spec.ts` (unregistered) has one stale fixture: its claim test creates no
  company membership and fails with `reimbursement_requester_unavailable`.
- The entitlement runoff matrix describes the drain as an `expense_auto_post` surface; it now also
  writes `reimbursement` rows behind the freeze above. The matrix was not edited.

## Artifacts

- API (ledger): `apps/api/src/modules/ledger/application/use-cases/expense-auto-post.use-case.ts`,
  `journal.use-case.ts`, `period.use-case.ts`, `apps/api/src/modules/ledger/infrastructure/prisma-ledger.repository.ts`
  (optional transaction client on three methods).
- API (numbering): `apps/api/src/modules/data-model-core/application/use-cases/reserve-document-number.use-case.ts`,
  `commit-document-number.use-case.ts` (`executeInTransaction`).
- API (reimbursement lane, kept small):
  - `prisma-reimbursement.repository.ts`: the worklist predicate (`posting_error` included) and
    `take`; `updatePaymentPostingStatus` (RECORDED only, optional transaction client, returns
    whether it wrote); `assertClaimPaymentReady(..., paidAt?)`; new `assertPaymentPeriodOpen`;
    two import lines.
  - `reimbursement-finance.use-case.ts`: one argument on the preflight call in
    `RecordReimbursementPaymentUseCase`.
- Contracts: `packages/contracts/src/ledger.ts` (`PeriodCloseCheck.breakdown`, `CLAIM_PAYOUT_WORKLIST_LIMIT`).
- Web: `apps/web/src/features/expenses/ClaimPaymentPosting.tsx`, `ExpensesWorkspacePanels.tsx`,
  `ExpensesPages.tsx`, `apps/web/src/features/ledger/ledger.api.ts`, `ledger.logic.ts`,
  `LedgerReportsPage.tsx`, `apps/web/src/common/api/api-error-message.ts` (one label).
- CI: `.github/workflows/ci.yml`, step "Test claim payout posting against PostgreSQL".
- Specs (registered, CI without PostgreSQL): `expense-auto-post.use-case.spec.ts`,
  `journal-reversal-net-zero.use-case.spec.ts`, `period-reimbursement-close.use-case.spec.ts`,
  `reimbursement-payment-posting.use-case.spec.ts`; web `ClaimPaymentPosting.spec.ts`,
  `ledger.logic.spec.ts`, `action-loading.spec.ts`, `api-error-message.spec.ts`.
- Spec (PostgreSQL, CI step above): `apps/api/src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts`.
- Docs: `docs/specs/expense-ledger-auto-post-spec.md` §17, `docs/plans/expense-ledger-auto-post-plan.md`
  Phase 6, `docs/specs/finance-accounting-gaps-spec.md` GAP-02 follow-up (ก).

## Verification (2026-10-01, this worktree, after the review follow-up)

- Typecheck (native TS, CI compiler): API rc 0, web rc 0. A planted type error in the web component
  was reported, so the run is real.
- Web suite `tsx --test "src/**/*.spec.ts"`: 2311 tests, 2311 pass.
- API specs of the ledger and reimbursement modules (PostgreSQL specs aside): 749 tests, 722 pass,
  27 skipped (specs that need a database), 0 fail.
- Boot DI smoke (`test:boot`): Nest resolved every provider.
- W00 capability manifest parity: pass; nothing regenerated.
- Pending-button audit (`scripts/qa/action-loading-coverage.mjs --check`): 0 gaps.
- Real PostgreSQL (throwaway `postgres:18.3-alpine`): `claim-payment-posting.pg.spec.ts` 16/16,
  run repeatedly. The CI step's own commands were also run against a fresh database: create it,
  migrate from empty, 16/16.
- Each order of post and void is proven twice: with fakes in `journal-reversal-net-zero.use-case.spec.ts`
  (CI) and on real PostgreSQL in the pg spec, where one side is held at a chosen point and the other
  is shown to WAIT for the payment row (`pg_stat_activity`), plus sixteen unsynchronised rounds.
- Mutation checks after the follow-up: 68 mutations of the changed code killed by the unit and web
  specs, and 30 by the PostgreSQL spec (candidate SQL, the claim, the worker's stamps, the worklist,
  the closed-period rule). Two of the 30 first survived on PostgreSQL (number reserved outside the
  transaction; worker stamping outside its transaction); a case was added for each.
- Layout: the worklist rendered in every state with the app's compiled CSS in headless Chromium at
  320, 360, 390, 768 and 1280 px: no horizontal scroll, the claim link 44 px tall, loading and empty
  cards the same height.
- After the second assembly merge (`72b449454`, Prisma client regenerated, contracts rebuilt): API
  and web typecheck rc 0; web suite 2344/2344; ledger and reimbursement API specs 879 tests, 835
  pass, 44 skipped, 0 fail; boot smoke, manifest parity and the pending-button audit pass; the
  PostgreSQL spec 16/16 with the assembly's two new migrations applied, and 16/16 from an empty
  database; the lane's registered claim race spec 44/44 on the same PostgreSQL.
- Not run: the full API fixed list, Playwright e2e, a live browser session (the section is hidden
  by `ACCOUNTING_UI_HIDDEN`, and no seeded stack was started). The GitHub workflow itself has not
  run: nothing was pushed.

To re-run the PostgreSQL spec against a throwaway database of its own (migrated, otherwise empty,
name ending `_ci`, on localhost):
`CLAIM_PAYMENT_POSTING_TEST_DATABASE_URL=postgresql://…@127.0.0.1:<port>/<db>_ci pnpm --filter @watchdog-bms/api exec tsx --test src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts`

## Next

- Owner or accountant answers open questions 1 and 2; then the settlement mapping can be built
  (chart bootstrap plan Phase 6, posting-rules plan Phase 5) and standard-chart shops can post.
- Owner decides question 5; flipping `ACCOUNTING_UI_HIDDEN` shows the worklist with the other posting buttons.
- The payout lane may want the closed-period refusal in its own spec, and its payment form could
  stop a closed month before the request is sent; neither is done here.
- Watch the first CI run of the new step: it has only been run locally with the same commands.
