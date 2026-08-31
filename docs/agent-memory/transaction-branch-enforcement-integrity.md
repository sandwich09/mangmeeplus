# Agent Memory: transaction-branch-enforcement-integrity

Status: SPEC + IMPLEMENTATION on `codex/branch-lifecycle-guards` (cut from develop). AC1-AC7 done,
AC8 (production query) blocked on IAM. 2026-08-31. Analysis-only pass over every feature touched by the
2026-08-27 transaction-branch enforcement, looking forward through each lifecycle to completion.

Owner: Owner asked for a forward-looking gap/impact/bug spec covering all features, explicitly
without implementation.

Scope: `docs/specs/transaction-branch-enforcement-integrity-spec.md` (new). Read-only investigation
of `apps/api` enforcement call sites, `apps/web` error copy and branch pickers, the LINE receipt
lane, branch administration, and the P10 Flow B signup path.

Decisions:
- Filed as a new spec rather than an amendment: it spans six modules and contradicts the authority
  spec, so folding it into `multi-company-branch-scope-spec` would bury the contradiction (G4).
- Recorded two checked-and-clear findings (G9 Flow B provisioning, G10 other gates tolerate a closed
  branch) so the next pass does not re-investigate them.
- No data change proposed for the HQ-parked history (G5). The backfill was the Owner's "ทาง B"
  decision and is not reopened here.

Key findings (severity order):
- G1 HIGH — a company can reach zero ACTIVE branches and lose every write. `update-branch.use-case.ts:45`
  guards only `ARCHIVED`, and `canArchiveBranch` (`branch.logic.ts:20`) guards only `type=HEAD_OFFICE`.
  `DISABLED` is unguarded. UAT already holds 1 company in this state.
- G2 HIGH — `prisma-reimbursement.repository.ts:1238` (`prepareClaimProjections`, `:1157`) asserts the
  claim's branch is still ACTIVE, while every other mid-lifecycle gate only requires non-empty. Close a
  branch after approval and the claim can never complete; reimbursements have no branch setter
  (update at `reimbursement-request.use-case.ts:170-205` ignores `branchId`, and the edit UI never
  renders `TransactionBranchField`). Recurs on every branch closure; the 2026-08-29 backfill was one-shot.
- G3/G4 MEDIUM — stranded null rows stay visible to every branch scope under authority spec §35, and
  §37 ("unrestricted creators default to null") is now false for the six enforced tables.
- G5 MEDIUM — rule-2 backfill parked all undecided legacy rows on the sole HQ; `updatedAt` untouched by
  design means backfilled rows are indistinguishable from user choices forever.

Artifacts:
- `docs/specs/transaction-branch-enforcement-integrity-spec.md`
- `~/prod-branch-check.sql` — 4-query audit, validated against UAT, not in the repo.
- `infra/support/connect-production.sh` — NO change. The BSD `wc -w` padding bug was re-discovered
  and "fixed" here, then the cross-check found it already fixed on `main`/`develop` at `:63-67`.
  The working-tree edit was reverted. It only reproduced because the shared checkout sits on the
  stale `plan` branch — a standing trap for anyone verifying against this working tree.

Verification:
- UAT read live through `infra/uat/db-port-forward.sh` 2026-08-31: backfill migration finished
  2026-08-29T17:56Z not rolled back; `branchId IS NULL` = 0 across all six tables; 31 companies =
  27 single-active-branch + 3 multi-with-single-HQ + 0 undecidable + **1 with zero active branches**;
  68 legacy rows parked on a HQ inside a multi-branch company (upper bound).
- Production NOT read: the available credential lacks `ssm:StartSession` on
  `AWS-StartInteractiveCommand`, and runbook decision D8 forbids reaching production by port-forward.
- Every file:line in the spec was checked against `origin/main`, not the working tree.

Cross-check (2026-08-31): `main` (`b7c5ea49`) and `develop` (`b2cc9d1a`) are byte-identical trees, so
no claim needs a per-branch qualifier. 33 of 34 cited `file:line` refs verified line-by-line against
`origin/main`; the one failure was the connect-production.sh claim above. Docs sweep found no spec or
plan owning branch-enforcement lifecycle behaviour, but two docs treat the zero-active-branch state as
LEGAL — `branch-scope-visibility-plan.md:66` and `reimbursement-approver-routing-policy-spec.md:330`
("With no active branches, an active eligible holder makes the company-central route COMPLETE"). That
reframed G1 from "add a guard" to "two subsystems disagree about whether the state is legal", and the
spec now offers two options instead of a direction.

Owner decisions 2026-08-31 (spec §9) — all questions answered, none open:
- D1 closing a branch with in-flight claims: BLOCK the closure (not "let the claim finish on a closed
  branch"). In-flight = reimbursement status not in PAID/REJECTED/CANCELLED/VOIDED. Reimbursements
  only — procurement gates never assert ACTIVE, so widening would refuse closures that work today.
- D2 pre-enforcement HQ-parked history: DO NOTHING. Owner rationale: does not occur in production,
  effort out of proportion, risk of collateral damage. Residual risk recorded in spec G5.
- D3 zero-ACTIVE-branch company: ILLEGAL. Every real company keeps one undeletable head office. This
  reverses the first draft's framing and closes G3 as moot (no null rows can survive the backfill
  rules). Two documents now contradict it and need amending: reimbursement-approver-routing-policy-spec
  §330 and branch-scope-visibility-plan §66.
- D4 second HEAD_OFFICE: FORBIDDEN, one per company. create-branch has no such check today.
- D5 `WatchDog System` (zero branches) is the system-admin platform tenant, an intended exception.
  Costs nothing in the transition guard — it has no branch to disable — but any future "companies with
  no active branch" health check must skip it, and there is no Company flag to skip it by; the only
  marker is a SYSTEM_ADMIN role membership.

Correction to an earlier claim in this memory: the UAT company with zero active branches is
`WatchDog System` with ZERO branch rows ever, not a customer who disabled their branches. Across all
of UAT, non-ACTIVE branches = 0 — the DISABLED path has never been exercised by anyone. The hole is
reachable (BranchSettingsPage.tsx:219-221 offers "ปิดใช้งาน" in a dropdown for any branch, two clicks)
but unused.

Implementation (spec §11 has the full record):
- `canArchiveBranch` -> `canLeaveActiveBranch(branch, activeHeadOffices, activeBranches)` returning
  `{code,message}`; guard now fires on ANY exit from ACTIVE, not only ARCHIVED, and a second rule
  catches the company whose only branch is `type=BRANCH`.
- `assertNoInFlightReimbursements` in `reimbursements/application/branch-in-flight.ts` — imports only
  `@nestjs/common`, so data-model-core importing it creates no cycle. Mirrors `plan-term-limit.ts`.
- One head office per company on create (`branch_head_office_exists`).
- `apiErrorCode` extracted in `api-error-message.ts`; the page branches on the code to offer the
  create-a-branch step. A page reading `.code` directly would miss codes nested in `details`.
- package.json deliberately untouched — new tests went into the already-registered
  `update-branch.use-case.spec.ts` rather than a new file that would need wiring into the suite.

Verification (all run in this session, contradicting the older "non-interactive sessions cannot run
tests" note — they run here after `pnpm install` + `prisma generate`):
- api owned suite: exit 0, no failures. web suite: 1319 passed / 0 failed.
- api + web typecheck clean. Fresh worktree needs `pnpm --filter @watchdog-bms/contracts build` first,
  or web typecheck fails on `@watchdog-bms/contracts` with errors that look like your own.
- Focused run of the three touched specs: 50 passed.

Residual edge recorded not fixed: a P29 `branchLimit=1` company whose single ACTIVE branch is
`type=BRANCH` can neither deactivate it nor create a replacement; the way out is to EDIT the branch.
Head-office-only companies never see it (different error code, no create-step offer).

Next:
- Run the spec §8 query on production once `ssm:StartSession` is granted, and record it here (AC8).
- Worktree `mangmeeplus-branch-guards` stays until the PR is merged.
