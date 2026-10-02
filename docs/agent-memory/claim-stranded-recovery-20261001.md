# Agent Memory: claim stranded recovery (audit B3 and B4)

Status: implemented and verified on branch `claude/claim-stranded-recovery-20261001` (worktree `/private/tmp/mangmee-claim-stranded-20261001`). The payout assembly is merged in at `2ec53a4dc` (two merges: `3bd9197fa` brought in `ef1bdcad1`, `16c42f569` the printed claim form), and the follow-up round the controller asked for sits on top of the first delivery. Not pushed, no PR. One item needs the controller: a real-model check of two LINE answers (see Open questions).

Owner: claim-stranded lane (subagent), 2026-10-01 to 2026-10-02.

Scope: two ways an expense claim got permanently stuck, then four things this lane had noticed that break the same invariants. Sibling lanes own the pay step (payment form, `recordPaymentAtomic`, the pay-step part of the claim page), the hub list, the void-versus-bank-match fixes and the printed form.

- B3: a cancellation commits its intent first and voids the claim's expense records after it. Whatever stopped a void (a reason shorter than 3 characters, a closed accounting period, a filed tax period, an unposted journal) left the claim half cancelled: approval and payment refused, the page showing nothing unusual, and no way to finish.
- B4: an approval commits its decision first and builds the claim's expense records after it. When that second part failed, the claim sat at "waiting for approval" with an approved step and no button; a claim nobody had to approve offered a pay button the API refused. The reconciler that repairs both existed and was never scheduled.
- Follow-up round (2026-10-02): (1) a claim's expense record could be voided, rejected or deleted on the expense screen, which left a claim that could be neither paid nor carried out; (2) the finance queue and the list rows offered actions the API refuses on a claim being cancelled; (3) `approvalActions.canApprove` stayed true on such a claim; (4) the status badge of a claim the system holds still read the status it had not left.

Decisions:

- One rule for the cancel reason: `EXPENSE_VOID_REASON_MIN_LENGTH` / `isExpenseVoidReason` in contracts, read by the expense void, the cancel API and the reason dialog.
- What stops a void is read in one place (`expenses/infrastructure/expense-void-blocker.ts`), by the void itself and by the claim before it writes the intent. A refusal up front writes nothing and spends no reversal number.
- A cancellation that is pending is always visible (`pendingCancellation` on the detail) and finishable: anyone who may cancel the claim continues it, not only whoever started it; a stored reason the void refuses is replaced by the corrected one (audited); it can be withdrawn while no expense record is voided.
- Withdraw and continue cannot interleave into a half state: every void runs a fence in its own transaction (`assertCancellationPending`: the request lock, then `SELECT … FOR SHARE` on the claim). In SERIALIZABLE the snapshot is taken at the first statement, so the row lock is what turns a withdrawal that committed meanwhile into a serialization failure.
- While a cancellation is pending every other decision is refused (`reimbursement_cancellation_pending`): edit, submit, approve, reject, finance review, duplicate resolution, payment, building expense records.
- `pendingProjectionIntent` (domain logic) is the one definition of "decided, not carried out" for the scheduled run, the resume call and the detail flag.
- "ดำเนินการต่อ" goes through the reconciler's own `repair()`, the step the scheduled run takes, after the use case authorises the viewer with the function that feeds the detail flag (`awaitingSystemOf`). It decides nothing and attests nothing. Building the expense records of an approved claim now also checks the claim is still what was approved (`stale_approval_snapshot`).
- Who may resume: the approver who decided (branch in scope, and the approve right or their frozen place on the step); for a claim nobody had to approve, whoever may record its payment. A claim finance passed keeps the finance step's existing "ดำเนินการต่อ".
- Desk: a claim being cancelled and an approved claim not carried out are with the system (`currentDesk.kind = 'SYSTEM'`, "อยู่ที่ ระบบ", LINE "รอระบบปรับสถานะ", one constant `REIMBURSEMENT_SYSTEM_WAIT_LABEL`). A claim nobody had to approve that cannot be paid yet stays at the payment desk on both, because a list row cannot know whether its expense records are confirmed; the claim page stands at the approval step for it.
- Scheduling: the workers' existing scan mechanism (`startScanWorker`, BullMQ job scheduler, worker-token internal route), every 2 minutes, at most 100 decided claims and 100 cancellations per run, newest first. No new scheduler, no switch. The run skips while `REIMBURSEMENT_WRITE_QUIESCE` holds writes.
- The run skips a cancellation a person has to unblock, so a blocked one does not burn a reversal number every two minutes. ponytail: there is no attempt counter; a failure the blocker check does not foresee is retried each pass and logged each time.
- A lost race is not a failure: serialization failures, unique conflicts, and the void's and the confirmation's "record changed meanwhile" answers (`lostWriteRace`). A person gets 409 `reimbursement_cancellation_in_progress` / `reimbursement_resume_in_progress`; the run logs `reimbursement.reconcile.busy`.
- New API tests live in spec files the API package already lists, and the worker test in `expense-auto-post-worker.spec.ts`, because neither package runs an unlisted spec file and `package.json` is not edited here.

Decisions of the follow-up round:

- A claim's expense record ends with its claim. `expense.void`, `expense.reject` and `expense.delete` refuse a record whose claim still stands (any status but REJECTED, CANCELLED, VOIDED) with 409 `expense_belongs_to_reimbursement` and a Thai message that names the claim and says to cancel it in the reimbursement menu. The void refuses before it reserves a reversal number; the delete audits the denial like its other refusals. The claim's own cancellation is untouched: it voids its records under its own authority (`executeForReimbursement`, called by the cancel use case and by the scheduled run that finishes a cancellation, and by nothing else). One reader, `findLiveClaimOf`, beside the void blocker.
- Reject is guarded though the controller named only void and delete: a rejected record is deletable, and a rejected claim record strands its claim the same way.
- The expense page hides the three for any record that has a source claim and says where to go, with a link to the claim. It reads the record, not the claim's status (the expense detail carries none); the API is the judge. The note is shown until the record is voided, because cancelling the claim leaves its records so.
- The server's own flags say what cannot be done while a claim is being cancelled: `pendingApprovalActions` answers no approve and no reject (and no self-approval hint). The approval queue needs no rule of its own for it: a row with no action is no row. Reading is not narrowed: an approver frozen onto the step who holds no read right still opens the claim (`assertCanReadRequestOrAssignment` asks what they would hold without the cancellation).
- Every claim row carries `cancellationPending: true` while a cancellation is on its way (`toRequestSummary`; never for a claim already cancelled). The finance queue keeps such a claim, because whoever may finish or withdraw the cancellation works there, and offers no payment and no finance decision on it. A list row offers no submit, edit or cancel. One rule on the web for a row and the detail (`claimIsBeingCancelled`).
- The quick-pay dialog shows its form only where the claim's own page would offer the payment (`quickPayBlockedNote` asks the page's step rule on the claim it has just read). Otherwise it says "บันทึกจ่ายใบนี้ไม่ได้" and what the page says, with a link to the page. This covers a row that is out of date: cancelled or paid meanwhile, or blocked by a duplicate.
- Correction of this note's earlier claim: no row ever offered a payment on a claim nobody had to approve that still waits for the system. Such a claim has status APPROVED; the finance queue lists FINANCE_REVIEW, READY_FOR_PAYMENT and PARTIALLY_PAID, and the row's pay button needs READY_FOR_PAYMENT. The stuck button of audit B4 was on the claim page and was fixed there.
- The status badge reads the claim's desk: a claim the system holds reads "รอระบบปรับสถานะ" (`claimStatusBadge`), on the claim page header, its status row and every list and queue row; the finance queue's search matches the words it shows. Web only.

Open questions:

- LINE, for the controller's real-model check; this lane made no model call. Two tools answer differently for a claim being cancelled, both since the first delivery and neither changed by the follow-up round:
  - `reimbursement.get_approval_backlog`: the claim is in the existing "รอระบบปรับสถานะ" group and is no longer counted in `awaitingApprovalCount`.
  - `reimbursement.list_pending_approvals`: the claim is no longer listed or counted in `total` (the tool reads `ListApprovalQueueUseCase`; commit `414df5f74`). The first report named only the backlog tool.
  - The wording of both is unchanged and no W00-hashed file changed. `reimbursement.get_detail` projects fixed fields and is unchanged: for an approved claim that waits for the system it still returns status `PENDING_APPROVAL`, where the web badge now reads "รอระบบปรับสถานะ".

Artifacts:

- Spec: `docs/specs/reimbursement-step-journey-spec-th.md` §19 (and pointers in §5, §13, §15, §17), with §19.7 and AC24 to AC26 for the follow-up round; `docs/specs/permission-matrix.md` §5.6 "Reimbursement claims that stopped halfway".
- Contracts: `packages/contracts/src/expenses.ts` (reason rule, `ExpenseVoidBlocker`), `packages/contracts/src/reimbursements.ts` (`pendingCancellation`, `awaitingSystem`, desk kind `SYSTEM`, `cancellationPending` on a summary).
- API: `expenses/infrastructure/expense-void-blocker.ts` (blockers, `findLiveClaimOf`, `claimOwnsExpenseError`); `expenses/application/use-cases/expense-draft.use-case.ts` (void, reject) and `delete-expense.use-case.ts`; `reimbursements/application/use-cases/reimbursement-request.use-case.ts` (cancel, withdraw, resume, detail flags); `…/reimbursement-approval.use-case.ts` (`awaitingSystemOf`, `pendingApprovalActions`); `…/dto/reimbursement.mapper.ts`; `…/services/reimbursement-projection-reconciler.service.ts`; `…/infrastructure/prisma-reimbursement.repository.ts`; `…/presentation/http/reimbursement-reconcile-internal.controller.ts`.
- Routes: `POST :requestId/cancel/withdraw`, `POST :requestId/resume`, `POST /internal/reimbursements/reconcile`.
- Workers: `apps/workers/src/modules/reimbursement-reconcile/reimbursement-reconcile-worker.ts`, registered in `apps/workers/src/main.ts` (a pinned file: both pin files synced).
- Web: `apps/web/src/features/reimbursements/` (`reimbursements.logic.ts`, `reimbursements.model.ts`, `ReimbursementJourneyPage.tsx`, `ReimbursementsPages.tsx`, `ReimbursementDetailSections.tsx`, `reimbursements.api.ts`), tests in `reimbursement-stranded-claims.qa.spec.ts`; `apps/web/src/features/expenses/` (`expenses.model.ts`, `ExpenseReviewPage.tsx`), test in `ExpenseReviewPage.qa.spec.ts`; refusal texts in `apps/web/src/common/api/api-error-message.ts`.
- Where the follow-up tests live (all files the packages already run): `void-expense-true-reversal.use-case.spec.ts`, `delete-expense.use-case.spec.ts`, `reimbursement-approval.use-case.spec.ts` and `reimbursement-request.use-case.spec.ts` (API `test` script); three cases in `prisma-reimbursement.repository.draft-submit-race.spec.ts` (API `pretest` and `test:reimbursement-compatibility`); the two web specs above (the web `test` glob).

Verification (2026-10-02, this machine, at `16c42f569`, the head before the commit that carries this note):

- Typechecks: contracts, API package script (heap flag), web, workers: pass. The pull-request CI's Typecheck job step for step: the native compiler on API and web, every other package's own script (config, contracts, workers, ai-gateway, design tokens) and the DI metadata check: pass.
- API specs: every non-PostgreSQL spec of the reimbursements, workflow, expenses, ledger, banking and audit modules and of `prisma/`, plus the body-validation, suite-coverage, DI-token and worker-token guards (167 files): 3,327 tests, 3,229 pass, 98 skipped (they need a database), 0 fail.
- Real PostgreSQL gate (`test:reimbursement-compatibility`, `REIMBURSEMENT_PG_GATE_REQUIRED=true`, throwaway `postgres:18.3-alpine`): 80 pass, 0 skipped. 47 before this branch, 19 from the first delivery, 11 from the assembly, 3 from the follow-up round.
- Workers `pnpm test`: 46 pass.
- Whole web suite: 2,403 pass.
- Boot DI smoke (`test:boot`): pass.
- LINE-AI capability manifest spec: 4 pass, no regeneration needed. Whole-chain acceptance (`node scripts/run-line-ai-whole-chain-acceptance.mjs`): pass.
- Maintenance pins: `--check` current after both merges; the sync changed nothing either time.
- Every new test was run against the code before its fix and failed there. First delivery: pre-fix sources swapped in for the unit and web specs, four mutants for the PostgreSQL cases. Follow-up round: the sources before each fix's commit swapped in for its unit, web and PostgreSQL cases.
- Browser, 390 px, on a throwaway local stack, for the first delivery only: the approved-waiting claim, the no-approval claim, a cancellation stranded by a short reason and an unfinished cancellation, with ดำเนินการต่อ, ดำเนินการยกเลิกต่อ with a corrected reason, and ถอนการยกเลิก pressed through the real API. The follow-up round was not looked at in a browser.
- The scheduled-run route on the same throwaway API: 401 without the worker token and with a wrong one, 200 with counts for the worker, and a `limit` in the body is ignored. The workers process itself was not run against it.
- Not run: Playwright e2e, the whole API `test` script, the ai-gateway test script.

Next:

- Controller: the real-model check above, then landing. The branch already contains the assembly at `2ec53a4dc`.
- Left, not fixed here:
  - A claim expense record that was rejected on the expense screen before this fix: the claim's cancellation refuses it (`…_expense_not_voidable`) and the claim cannot be paid. One voided there does not block the cancellation, but the claim cannot be paid either. Whether production holds such rows is one query: expense records with a source claim and status REJECTED or VOIDED whose claim is not REJECTED, CANCELLED or VOIDED.
  - A READY_FOR_PAYMENT row whose claim has an open duplicate that blocks payment still shows บันทึกจ่าย; the dialog, and the claim page on a phone, then show the page's duplicate note instead of a form. A row cannot tell: its `hasDuplicateBlocker` is not the payment gate's test.
  - The expense list row carries no claim link, so a claim record in a deletable state would still show its delete icon there and get the Thai refusal. The claim's own paths leave no record in such a state.
  - The PostgreSQL cases skip in pull-request CI (its unit job has no database); they run on demand in Extended Tests, PostgreSQL Integration.
  - Two concurrent voids of one expense collide on the reversal number's idempotency key (`void-reversal:…:${Date.now()}`) in the same millisecond; handled here as a lost race, not fixed at the source.
  - A void that fails after reserving its reversal number leaves a gap in the journal numbering.
  - `apps/workers/src/main.spec.ts` is not in the workers `test` script, so its wiring checks never run in CI.
  - Two claim lines of the same person, day and amount are parked as possible duplicates of each other, which keeps the claim waiting for the system until someone clears them.
