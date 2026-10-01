# Agent Memory: claim stranded recovery (audit B3 and B4)

Status: implemented and verified on branch `claude/claim-stranded-recovery-20261001` (worktree `/private/tmp/mangmee-claim-stranded-20261001`, from the payout assembly at `77f6fd885`). Not pushed, no PR. One item needs the controller: a real-model check of the LINE backlog answer (see Open questions).

Owner: claim-stranded lane (subagent), 2026-10-01 to 2026-10-02.

Scope: two ways an expense claim got permanently stuck, and nothing else. Sibling lanes own the pay step (payment form, `recordPaymentAtomic`, the pay-step part of the claim page) and the hub list / void-versus-bank-match fixes; this lane touched only the approval step and the cancel area of the claim page.

- B3: a cancellation commits its intent first and voids the claim's expense records after it. Whatever stopped a void (a reason shorter than 3 characters, a closed accounting period, a filed tax period, an unposted journal) left the claim half cancelled: approval and payment refused, the page showing nothing unusual, and no way to finish.
- B4: an approval commits its decision first and builds the claim's expense records after it. When that second part failed, the claim sat at "waiting for approval" with an approved step and no button; a claim nobody had to approve offered a pay button the API refused. The reconciler that repairs both existed and was never scheduled.

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

Open questions:

- LINE backlog (`GetReimbursementApprovalBacklogUseCase`, read by an AI tool): a claim being cancelled is now in the existing "รอระบบปรับสถานะ" group and is no longer counted in `awaitingApprovalCount`. The wording is unchanged and no W00-hashed file changed, but the numbers the tool returns for such claims did. Needs the controller's judgement on a real-model check; this lane made no model call.
- The header badge of an approved claim that waits for the system still reads "รออนุมัติ" (its status has not moved). The step card says what happened. Left alone: the badge is outside the approval step and the cancel area.

Artifacts:

- Spec: `docs/specs/reimbursement-step-journey-spec-th.md` §19 (and pointers in §5, §13, §15, §17); `docs/specs/permission-matrix.md` §5.6 "Reimbursement claims that stopped halfway".
- Contracts: `packages/contracts/src/expenses.ts` (reason rule, `ExpenseVoidBlocker`), `packages/contracts/src/reimbursements.ts` (`pendingCancellation`, `awaitingSystem`, desk kind `SYSTEM`).
- API: `expenses/infrastructure/expense-void-blocker.ts`; `reimbursements/application/use-cases/reimbursement-request.use-case.ts` (cancel, withdraw, resume, detail flags); `…/reimbursement-approval.use-case.ts` (`awaitingSystemOf`); `…/services/reimbursement-projection-reconciler.service.ts`; `…/infrastructure/prisma-reimbursement.repository.ts`; `…/presentation/http/reimbursement-reconcile-internal.controller.ts`.
- Routes: `POST :requestId/cancel/withdraw`, `POST :requestId/resume`, `POST /internal/reimbursements/reconcile`.
- Workers: `apps/workers/src/modules/reimbursement-reconcile/reimbursement-reconcile-worker.ts`, registered in `apps/workers/src/main.ts` (a pinned file: both pin files synced).
- Web: `apps/web/src/features/reimbursements/` (`reimbursements.logic.ts`, `ReimbursementJourneyPage.tsx`, `reimbursements.api.ts`, `reimbursements.model.ts`, `ReimbursementDetailSections.tsx`), tests in `reimbursement-stranded-claims.qa.spec.ts`; refusal texts in `apps/web/src/common/api/api-error-message.ts`.

Verification (2026-10-02, this machine):

- Typechecks: contracts, API package script (heap flag), web, workers: pass.
- API specs: every spec of the reimbursements, expenses and ledger modules plus the body-validation, suite-coverage, DI-token and worker-token guards: 2,765 tests, 2,696 pass, 69 skipped (they need a database), 0 fail.
- Real PostgreSQL gate (`test:reimbursement-compatibility`, `REIMBURSEMENT_PG_GATE_REQUIRED=true`, throwaway `postgres:18.3-alpine`): 66 pass, 0 skipped. 47 before this branch, 19 new.
- Workers `pnpm test`: 46 pass.
- Whole web suite: 2,356 pass. The first run failed one guard (`api-error-coverage.spec.ts`: new refusal codes had Thai text only in the feature map); fixed and rerun.
- Boot DI smoke (`test:boot`): pass.
- LINE-AI capability manifest spec: pass, no regeneration needed. Whole-chain acceptance (`node scripts/run-line-ai-whole-chain-acceptance.mjs`, run although nothing was regenerated, because the LINE backlog use case changed): pass.
- Maintenance pins: stale after `apps/workers/src/main.ts` changed, synced, `--check` current.
- Every new test was run against the pre-fix code and failed there (pre-fix sources swapped in for the unit and web specs; four mutants for the PostgreSQL cases: the old list query, no content check, no blocked-skip, no confirmation-race classification).
- Browser, 390 px, on a throwaway local stack (own PostgreSQL database, own Redis container, API and web on free ports): the approved-waiting claim, the no-approval claim, a cancellation stranded by a short reason and an unfinished cancellation, with ดำเนินการต่อ, ดำเนินการยกเลิกต่อ with a corrected reason, and ถอนการยกเลิก pressed through the real API.
- The scheduled-run route on the same throwaway API: 401 without the worker token and with a wrong one, 200 with counts for the worker, and a `limit` in the body is ignored. The workers process itself was not run against it.

Next:

- Controller: real-model check for the LINE backlog change above, then merge order with the two sibling lanes (the claim page and `prisma-reimbursement.repository.ts` are shared files).
- Noticed outside this lane, not fixed here:
  - A claim-born confirmed expense can be voided directly from the expense screen with `expense.void`; the claim then cannot be paid or carried out and says so only as a projection error.
  - The finance queue still lists a claim that is being cancelled, with a pay action the API refuses; the hub list offers quick pay for a claim nobody had to approve whose expense records are not confirmed (a list row has no `awaitingSystem`).
  - Two concurrent voids of one expense collide on the reversal number's idempotency key (`void-reversal:…:${Date.now()}`) in the same millisecond; handled here as a lost race, not fixed at the source.
  - A void that fails after reserving its reversal number leaves a gap in the journal numbering.
  - `apps/workers/src/main.spec.ts` is not in the workers `test` script, so its wiring checks never run in CI.
  - Two claim lines of the same person, day and amount are parked as possible duplicates of each other, which blocks payment until someone clears them.
