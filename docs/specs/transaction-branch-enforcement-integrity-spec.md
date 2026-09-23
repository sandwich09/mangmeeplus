# Transaction Branch Enforcement — Lifecycle Integrity Spec

## 1. Status

v1.1 **IMPLEMENTED for AC1-AC7; AC8 outstanding.** 2026-08-31.

Written after `88aef194` (2026-08-27) made a branch mandatory on every transactional write and
`20260829170000_backfill_transaction_branch_defaults` (2026-08-29) healed the rows that change
stranded. Both shipped to production together in the 2026-08-30 release (source `a768e3a2`;
UAT passport run `33300034490` → READY `33301031588` → promote `33301552984`; the 14 pending
migrations were applied by the earlier promote `33292205993` and the next READY read
`EXACT_MATCH` / pending `0`).

Enforcement and backfill each solved the problem in front of them. This spec asks the question
neither of them was scoped to ask: **for every feature that now carries a branch, does the whole
process finish?** It walks each lifecycle forward from create to settlement and records where a
record can enter a state the product cannot get it out of.

The Owner answered every open question on 2026-08-31 (§9) and the guards were then built on
`codex/branch-lifecycle-guards`. §11 records what shipped and what deliberately did not.

## 2. Source Docs

- Authority: [[specs/multi-company-branch-scope-spec|Multi-Company Owner and Branch Scope Spec]] —
  owns `branchScopeMode`, `RequestContext.scopes.branchIds`, and the read rule for `branchId = null`.
- Authority: [[specs/branch-scope-visibility-spec|Branch Scope Visibility and Dashboard Branch Dimension Spec]]
- Task memory: [[agent-memory/transaction-branch-backfill|transaction-branch-backfill]] — the
  28-call-site audit and the Owner's "ทาง B" decision.
- Data migration: `apps/api/prisma/migrations/20260829170000_backfill_transaction_branch_defaults/migration.sql`

## 3. Non-goals

- Re-litigating the Owner's 2026-08-29 backfill rule (sole ACTIVE branch → sole ACTIVE
  `HEAD_OFFICE` → leave NULL). It shipped; this spec measures its consequences.
- Changing `AccountingDocument` / `JournalLine`, which are deliberately exempt (§6 G6).
- Branch **read** scoping, which the two authority specs already own.

## 4. Enforcement surface as built

Three functions in `apps/api/src/modules/data-model-core/application/services/transaction-branch.ts`:

| Function | Line | Checks | Used at |
|---|---|---|---|
| `requireTransactionBranchId` | `:7` | non-empty **only** — does not check the branch still exists or is ACTIVE | mid-lifecycle gates |
| `assertActiveTransactionBranch` | `:16` | non-empty **and** ACTIVE in this company | explicit selection, claim projection |
| `resolveTransactionBranchId` | `:26` | selection wins; defaults only when exactly one ACTIVE branch is in scope | create paths |

The split matters and is correct in principle: a gate mid-flight must not fail because someone
closed a branch yesterday. §6 G2 is where that principle is broken in one place.

## 5. Lifecycle coverage — does each feature finish?

| Module | Create | Mid-lifecycle gates | Branch setter after create? | Finishes? |
|---|---|---|---|---|
| Expenses | `expense-draft.use-case.ts:74` | `:641`, `:1160`, `prisma-expense.repository.ts:2056` | **Yes** — `expense-draft.use-case.ts:453` writes `branchId` on update | Yes |
| Accounting documents | `document.use-case.ts:120` | `:119`, `payment.use-case.ts:71`, repo `:166/:955/:1129` | **Yes** — `document.use-case.ts:255` | Yes |
| Ledger / manual journal | `prisma-ledger.repository.ts:78` | `journal.use-case.ts:256`, `:301` | Partial — draft re-save refills line defaults | Yes |
| Reimbursements | `reimbursement-request.use-case.ts:117` | `reimbursement-finance.use-case.ts:335`, `reimbursement-evidence.service.ts:23`, repo `:298/:686/:1962`, **`:1238`** | **No** — update at `reimbursement-request.use-case.ts:170-205` never writes `branchId`, and `TransactionBranchField` appears only on `ReimbursementCreatePage` | **No — see G1, G2** |
| Procurement (PR→PO→GR, bill, payment) | repo `:111` | `purchase-order.use-case.ts:55`, `goods-receipt.use-case.ts:29`, `vendor-bill.use-case.ts:127`, `supplier-payment.use-case.ts:62`, repo `:485/:588/:690/:887/:1337` | **No** — no branch-edit lane exists in the module | **No — see G2** |
| LINE receipt capture | `line-receipt-branch.logic.ts` default | — | n/a (creates an expense, which has a setter) | Yes |

## 6. Gaps

Severity is "what a real customer experiences", not code smell. **Forward** answers: does this get
worse with time, or is the exposure frozen?

### G1 — A company can reach zero ACTIVE branches and lose every write

`update-branch.use-case.ts:45` runs its guard only when `cmd.status === 'ARCHIVED'`, and
`canArchiveBranch` (`branch.logic.ts:20`) refuses only when the branch is `type = HEAD_OFFICE`
and it is the last active head office. Two holes follow from that shape:

- `BranchStatus.DISABLED` is **not guarded at all** — an owner can disable the only head office.
- A company whose last ACTIVE branch is `type = BRANCH` can archive it; the guard never fires.

With zero ACTIVE branches, `resolveTransactionBranchId:33-38` finds nothing and every create in
every module returns 422 `TRANSACTION_BRANCH_REQUIRED`. The company can still log in and read, and
cannot record anything at all.

Onboarding is not the source: `create-company-onboarding.use-case.ts:283-293` always creates an
ACTIVE `HEAD_OFFICE`. This is reached only by self-service branch administration.

**Evidence:** UAT holds 1 company in exactly this state today (31 companies: 27 single-active-branch,
3 multi-branch with a single HQ, 1 with zero active branches).
**Severity:** HIGH — total loss of write capability for that tenant, self-inflicted, silent.
**Forward:** WORSENS. Reachable any day by any owner; nothing warns and nothing detects it.

**Prior art — the zero-branch state is not unknown, and two live docs treat it as legal:**

- [[plans/branch-scope-visibility-plan|Branch Scope Visibility Plan]] `:66` records
  *"`branches.length === 0` is also the legitimate state for a company with no ACTIVE branch rows"*
  and decides that rendering no branch label there is correct.
- [[specs/reimbursement-approver-routing-policy-spec|Reimbursement Approver Routing Policy Spec]]
  `:330` goes further: *"With no active branches, an active eligible holder makes the company-central
  route COMPLETE"* — approver routing is specified to keep working for such a company.

So the defect is not "zero branches exists". It is that **two subsystems disagree about whether that
state is legal**: routing and scope labelling support it, transaction enforcement makes it fatal.
Closing this by simply forbidding the state would contradict the approver-routing spec, which this
spec has no authority to overrule.

**RESOLVED — Owner 2026-08-31 (D3, D5).** A company with zero ACTIVE branches is **not** a legal
state: every real company always holds one undeletable `HEAD_OFFICE`. Option (a) is taken. The
`DISABLED` hole is therefore a plain defect — the guard must fire on any transition out of `ACTIVE`,
not only on `ARCHIVED`, and it must not depend on the branch's type.

**The exception costs nothing in the guard.** The platform tenant (`มั่งมีพลัส · ระบบภายใน`) is exempt
because it is a system-admin workspace, not a customer. It has **zero branch rows and never had
any**, so a transition guard can never fire for it — there is no branch to move out of `ACTIVE`.
No carve-out code is needed. The exception only matters if someone later builds a health check or
alert for "companies with no active branch"; that check must skip the platform tenant, and there is
no `Company` flag to skip it by today — the only marker is a membership holding the `SYSTEM_ADMIN`
role (`permission-registry.ts:965`, "Platform company onboarding access").

**Also decided (D4):** a company may hold **one** `HEAD_OFFICE` and no more. `create-branch.use-case.ts`
checks permission, the P29 branch limit, branch code and tax branch code — it never checks whether a
head office already exists, so a second one can be created today. Matches Thai tax practice, where
the head office carries tax branch code `00000`.

### G2 — Closing a branch permanently strands the claims already on it

`prisma-reimbursement.repository.ts:1238`, inside `prepareClaimProjections` (`:1157`), calls
`assertActiveExpenseBranch` on the **claim's existing** branch when projecting an approved
reimbursement into expense records. Every other mid-lifecycle gate deliberately uses the
non-empty-only `requireTransactionBranchId`; this one asserts ACTIVE.

So: a claim is created against branch B, approved, and then someone disables or archives B. The
claim now fails at finance completion with `TRANSACTION_BRANCH_INVALID` — and per §5 there is **no
setter**: edit is DRAFT-only, the edit UI never renders `TransactionBranchField`, and update ignores
`branchId` even if a caller sends it. The claim cannot be completed and cannot be moved. Only SQL
can free it, exactly like the pre-backfill stranding the Owner hit on UAT.

**Severity:** HIGH — money owed to an employee, permanently blocked, with no in-product remedy.
**Forward:** WORSENS. Branch closure is a normal business event; every closure can create a new
batch of unfinishable claims, and the 2026-08-29 backfill was a one-shot that does not run again.

**RESOLVED — Owner 2026-08-31 (D1): block the closure, do not weaken the assertion.** A branch may
not leave `ACTIVE` while claims on it are still in flight. The refusal must name the count so the
operator knows what to clear, and it fires **before** any state changes.

"In flight" means a `ReimbursementRequest` on that branch whose status is not terminal — everything
except `PAID`, `REJECTED`, `CANCELLED` and `VOIDED`. `DRAFT`, `PENDING_APPROVAL`, `APPROVED`,
`FINANCE_REVIEW`, `READY_FOR_PAYMENT` and `PARTIALLY_PAID` all block the closure. `PARTIALLY_PAID`
is deliberately included: the remaining balance still has to move through the same projection.

**Scope of the check — reimbursements only, and that is on purpose.** Procurement's gates
(`purchase-order.use-case.ts:55`, `goods-receipt.use-case.ts:29`, `vendor-bill.use-case.ts:127`,
`supplier-payment.use-case.ts:62`) use the non-empty-only `requireTransactionBranchId`, so a closed
branch does not block a PO, receipt or bill that is already moving. Widening the guard to open
purchase documents would refuse closures that work fine today. If the Owner later wants "no closing
a branch with any open work at all", that is a separate, larger product rule — not this fix.

### G3 — A stranded row is blocked for everyone and visible to everyone

The authority spec §35 defines the read rule as `branchId IN scopes.branchIds OR branchId IS NULL`,
because a null branch means **company-central**, and the code implements it literally —
`branch.logic.ts:48-51`, where `isBranchInScope` returns `true` for a null branch before it ever
consults the scope list. Enforcement did not change that rule. A row the
backfill could not decide therefore has the worst possible pair of properties: no one can act on it,
and every branch-restricted employee in the company can see it — including a claim's amount, title
and evidence that a branch-scoped employee was never meant to read.

**Severity:** MEDIUM in theory — **currently moot in practice.**
**Forward:** FROZEN, and no longer re-armed. G2's stranded claims carry a real (closed) branch, not a
null one, so they are scoped normally.

**CLOSED — Owner 2026-08-31 (D3).** Because every real company always holds exactly one ACTIVE
`HEAD_OFFICE`, the backfill's rule 1 or rule 2 resolves every legacy row and none is left null. UAT
confirms it: `branchId IS NULL` is 0 across all six tables. The visibility question has no subject.
It reopens only if a company can again reach a shape the backfill cannot decide, which D3 and D4
together prevent. Kept on record so the reasoning is not re-derived.

### G4 — The authority spec now states the opposite of the behaviour

`multi-company-branch-scope-spec.md:37`: *"Unrestricted creators default to `null` (company-central)
unless they pass `branchId`."* Since 2026-08-27 that is false for `ExpenseRecord`,
`ReimbursementRequest`, `PurchaseRequest`, `PurchaseOrder`, `GoodsReceipt` and `VendorBill` — an
unrestricted creator in a multi-branch company now gets a 422 instead of a company-central row.

Docs are the source of truth in this repo, so a spec that disagrees with shipped behaviour is a
defect in its own right: the next agent or engineer will build against the wrong rule.

**Severity:** MEDIUM — process defect, high blast radius on future work.
**Forward:** WORSENS with every feature built on the stale rule.
**Direction:** amend §35/§37 of the authority spec to carve out the six enforced tables, and record
which tables keep company-central semantics.

### G5 — Backfilled history is un-auditable and skews branch reporting

Rule 2 of the migration assigns *every* undecided legacy row of a multi-branch company to that
company's sole ACTIVE `HEAD_OFFICE`. For a company with five branches and one HQ, all pre-2026-08-27
expenses, claims and purchase documents now report as HQ activity even where they belonged to a
branch. The migration deliberately leaves `updatedAt` untouched (so in-flight `expectedUpdatedAt`
checks keep matching), which also means **no marker distinguishes a backfilled row from one the user
chose** — the assignment cannot be reviewed or reversed after the fact.

**Evidence (UAT, upper bound):** 68 legacy rows sit on a HEAD_OFFICE inside a multi-branch company —
New Nail Near Me 37 expenses / 2 claims, WatchDog UAT 16 / 4, ป๋อจ้าน Company 7 / 2.
**Severity:** MEDIUM — per-branch reports for periods before 2026-08-27 overstate HQ.
**Forward:** FROZEN. New rows always carry a real selection.

**ACCEPTED, NO ACTION — Owner 2026-08-31 (D2).** Rationale as given: production is not expected to
hold companies in the affected shape, the fix costs effort out of proportion to the harm, and
touching historical accounting rows risks breaking something else. No report annotation, no cut-off
marker, no data change.

**Residual risk, stated so the decision stays informed:** if a production company does have several
branches, its per-branch view of anything before 2026-08-27 attributes that activity to the head
office. Nothing warns the reader. The §8 query's fourth block measures this in one shot if the
question is ever revisited — it is the cheapest way to convert this assumption into a fact.

### G6 — "Company-central" survives in the ledger but is illegal at the source

`AccountingDocument` and `JournalLine` are exempt by design and may still hold `branchId = null`.
The six source tables may not. A single business event can therefore be branch-bearing in expenses
and branch-less in its journal lines, which quietly breaks any reconciliation that joins them on
branch.

**Severity:** LOW–MEDIUM — correctness of branch-dimension reconciliation, not of the ledger itself.
**Forward:** FROZEN.
**Direction:** state the intended join semantics; if branch-dimension reconciliation is a goal, it
needs its own decision rather than inheriting two different rules.

### G7 — The error tells the user to do something they cannot do

`api-error-message.ts:14` renders `TRANSACTION_BRANCH_REQUIRED` as
*"กรุณาระบุสาขาของรายการก่อนดำเนินการ"*. In the G1 case there is no branch to select; in the G2 case
there is no field to select it in. The LINE lane already does better —
`process-line-webhook.use-case.ts:3488` recognises both codes and replies with dedicated copy
because the Owner flagged the retry loop on 2026-08-27 — and the reimbursement client pre-checks at
`reimbursements.api.ts:38` before calling the API. The web's generic path has neither.

**Severity:** MEDIUM — turns a fixable setup problem into a support call.
**Forward:** tracks G1/G2.
**Direction:** distinguish "you must choose" from "there is nothing to choose" at the API, and let
the web route the second to branch settings.

### G8 — Production exposure is unmeasured

The UAT numbers above are live-read. Production has **not** been queried: the credential available
to the agent lacks `ssm:StartSession` on `AWS-StartInteractiveCommand`, and the runbook forbids
reaching production through a port-forward (decision D8, no transcript). The paste-ready query is at
`~/prod-branch-check.sql`; the run command is in §8.

Production is *structurally* better placed than UAT — it received enforcement and backfill in the
same release, so it never had the window that stranded rows on UAT. That is a reason to expect a
clean result, not evidence of one.

**Severity:** MEDIUM — known unknown.
**Forward:** static for the backfill question; **live** for G1, which can occur at any time.

### G9 — Checked and clear: Flow B signup provisions a branch

Recorded so it is not re-investigated. The P10 auto-register Flow B provisioning path
(`external-signup/application/provision-signup.use-case.ts:34,61`) delegates to
`CreateCompanyOnboardingUseCase`, which creates the ACTIVE `HEAD_OFFICE` at
`create-company-onboarding.use-case.ts:283-293`. Companies created by public signup start
enforcement-safe. No gap.

### G10 — Checked and clear: closing a branch does not break the other gates

Only `assertActiveTransactionBranch` rejects a non-ACTIVE branch, and it is reached from exactly two
places: explicit selection inside `resolveTransactionBranchId:31`, and the reimbursement projection
in G2. Every other mid-lifecycle gate uses the non-empty-only check, so disabling a branch does not
retro-block approvals, payments or goods receipts already in flight. G2 is the single exception, and
that is why it is filed as a gap rather than as the rule.

## 7. Acceptance criteria

Aligned to the Owner decisions in §9. A future implementation closes this spec when all hold:

- **AC1 (G1 / D3)** — No branch status change can leave a company with zero ACTIVE branches. The
  guard fires on **any** transition out of `ACTIVE`, not only `ARCHIVED`, and regardless of branch
  type. Regression tests cover the `DISABLED` path and the last-`type=BRANCH` path, not just
  `ARCHIVED` + `HEAD_OFFICE`.
- **AC2 (G1 / D4)** — Creating a second `HEAD_OFFICE` in a company is refused, with its own error
  code and Thai copy.
- **AC3 (G2 / D1)** — A branch with in-flight reimbursements cannot leave `ACTIVE`. The refusal
  states how many claims block it, and nothing is mutated before the check. In-flight = status not
  in `PAID`, `REJECTED`, `CANCELLED`, `VOIDED`.
- **AC4 (G2 / D1)** — Proven by a test that closes a branch between claim approval and finance
  completion: today the claim is stranded, after the fix the closure is refused and the claim
  completes normally.
- **AC5 (G7 / D5-copy)** — When the last active branch is disabled, the message explains the rule and
  offers the create-a-branch path in the same step, rather than a bare refusal.
- **AC6 (G4)** — The authority spec states, per table, whether `branchId = null` is legal and what it
  means for reads. `multi-company-branch-scope-spec.md:37` no longer claims unrestricted creators
  default to null for the six enforced tables.
- **AC7 (G4 / D3)** — `reimbursement-approver-routing-policy-spec.md:330` and
  `branch-scope-visibility-plan.md:66` are amended: a company with no ACTIVE branch is a
  platform-tenant-only state, not a supported customer state.
- **AC8 (G8)** — The §8 query has been run against production and the result recorded in task memory
  with the date and run reference.

Explicitly **not** in scope, by decision: any change to pre-2026-08-27 branch history or to how it is
reported (D2).

## 8. Verification

Run on each environment; both use the paths already sanctioned per environment.

- **UAT** — `infra/uat/db-port-forward.sh` in the background, then the four queries in
  `~/prod-branch-check.sql`. Executed 2026-08-31; results in §6 G1/G5.
- **Production** — `infra/support/connect-production.sh view <incident-ref> < ~/prod-branch-check.sql`.
  Not yet executed (G8). The BSD `wc -w` padding bug that makes this script refuse to open a session
  on macOS is **already fixed on `main` and `develop`** (`connect-production.sh:63-67`, with the
  reason in a comment). Anyone who still hits it is running a stale checkout, not a live bug.

The query answers four things: the backfill migration's ledger row, remaining `branchId IS NULL`
counts per table, the company branch-shape distribution (the G1 detector), and the G5 upper bound.

## 9. Owner decisions (2026-08-31)

All questions raised by the first draft are answered. None remain open.

| # | Question | Decision | Consequence |
|---|---|---|---|
| **D1** | Closing a branch that still has claims in flight | **Block the closure.** Clear the work first | G2 closes without weakening the projection assertion; scope is reimbursements only (see G2) |
| **D2** | Pre-enforcement history parked on the head office | **Do nothing.** Not expected in production, effort out of proportion, risk of collateral damage | G5 accepted as a known limitation; residual risk recorded in G5 |
| **D3** | Is a company with zero ACTIVE branches legal? | **No.** Every real company always has one undeletable head office | G1 takes option (a); G3 closes as moot; two other documents need amending (AC7) |
| **D4** | May a company hold two head offices? | **No.** One per company | New guard on create (AC2); matches tax branch code `00000` practice |
| **D5** | The platform tenant `มั่งมีพลัส · ระบบภายใน` has no branches | **Exception, by design.** It is a system-admin workspace, not a customer | Costs nothing in the guard (it has no branch to disable); matters only for any future health check — see G1 |

Copy decision recorded with D3: when the last active branch is disabled, refuse **and** offer to
create the replacement branch in the same step, rather than refusing flatly.

## 10. Cross-check record (2026-08-31)

Every claim in this spec was re-verified against the branches that matter, after the first draft was
written from a stale `plan` checkout.

- **`main` and `develop` are byte-identical.** `origin/main` = `b7c5ea49`, `origin/develop` =
  `b2cc9d1a`; develop is an ancestor and `git diff origin/develop origin/main` is empty — the four
  commits between them are merge commits only. No claim needs a per-branch qualifier.
- **33 of 34 cited `file:line` references verified** against `origin/main` by reading the line and
  matching its expected content. All 33 code and doc citations hold.
- **1 citation was wrong and is corrected in §8:** the `connect-production.sh` BSD `wc` bug is
  already fixed on `main`/`develop`. It reproduced only because the working checkout sat on the
  stale `plan` branch. No fix is needed and none should be committed.
- **Docs swept for prior coverage.** `TRANSACTION_BRANCH_REQUIRED` appears in exactly two documents,
  both task memory, neither a spec. No existing spec or plan owns branch enforcement's lifecycle
  behaviour — which is why this document exists. The two documents that touch the zero-branch state
  are cited in G1 and materially changed that gap's conclusion.
- **No existing doc records the `DISABLED` guard hole or the G2 projection assertion.** Both are new.

## 11. Implementation record (2026-08-31)

Branch `codex/branch-lifecycle-guards`, cut from `develop`.

| AC | Status | Where |
|---|---|---|
| AC1 last-active guard, any exit from ACTIVE | DONE | `branch.logic.ts` `canLeaveActiveBranch`, `update-branch.use-case.ts` |
| AC2 one head office per company | DONE | `create-branch.use-case.ts`, code `branch_head_office_exists` |
| AC3 in-flight claims block deactivation | DONE | `reimbursements/application/branch-in-flight.ts` |
| AC4 proven by test | DONE | `update-branch.use-case.spec.ts` — 7 new cases |
| AC5 refusal offers the create-a-branch step | DONE | `BranchSettingsPage.tsx`, gated on `branch_last_active_required` |
| AC6 authority spec carve-out | DONE | `multi-company-branch-scope-spec.md` §35 block |
| AC7 two contradicting docs amended | DONE | `reimbursement-approver-routing-policy-spec.md` §6.2, `branch-scope-visibility-plan.md` §5 |
| AC8 production query | **OUTSTANDING** | blocked on `ssm:StartSession` (G8) |

### Design notes worth keeping

- **`canArchiveBranch` became `canLeaveActiveBranch`** and returns `{code, message}` instead of a bare
  string. The old name would have lied the moment it started guarding `DISABLED`, and the code has to
  reach the web to be rendered in Thai.
- **Two rules, not one.** The head-office rule is checked first and reported first; the last-active
  rule catches the company whose only branch is `type = BRANCH`, which the head-office rule cannot
  see. Neither subsumes the other.
- **The in-flight check runs last** — it costs a query, and the two structural checks are cheaper to
  fail on.
- **`branch-in-flight.ts` imports nothing but `@nestjs/common`**, so `data-model-core` importing it
  creates no module cycle back into reimbursements. It follows the shape of
  `system-partner-management/application/plan-term-limit.ts`, the existing precedent for a
  cross-module create-side assertion.
- **`apiErrorCode` was extracted** in `api-error-message.ts` rather than re-implemented in the page: a
  Nest `UnprocessableEntityException({code})` puts the code either on the error or inside `details`,
  and a screen reading only the top level would have failed silently while the message still
  translated — hiding the break.

### Checked and deliberately not changed

- **`resolve-identity-reconciliation.use-case.ts:179`** archives a branch with a raw
  `tx.branch.update`, bypassing the guard. Left alone: it only ever archives one of two branches that
  share a tax identity, so it cannot reach zero, and it is a system-admin reconciliation path with its
  own postcondition check.
- **Procurement gates.** Untouched, per D1's scope note in G2.
- **Pre-enforcement history.** Untouched, per D2.

### Residual edge, recorded not fixed

A company on a P29 plan whose `branchLimit` is 1, and whose single ACTIVE branch is `type = BRANCH`
rather than a head office, can now neither deactivate that branch (refused by the last-active rule)
nor create a replacement (refused by `assertBranchLimit`). The web copy that offers "สร้างสาขาใหม่ก่อน"
would fail for it. The ordinary path out is to **edit** the existing branch — relocation is a rename
plus an address change, not a replace — so no deadlock exists in practice. Companies whose single
branch is the head office never see this: they are refused by `branch_head_office_required`, which
does not offer the create step.

### Verification run

- `pnpm --filter @watchdog-bms/api test` — full owned suite, **exit 0, no failures**.
- `pnpm --filter @watchdog-bms/web test` — **1319 passed, 0 failed**.
- `pnpm --filter @watchdog-bms/api typecheck` and `... web typecheck` — both clean (web needs
  `pnpm --filter @watchdog-bms/contracts build` first in a fresh worktree).
- Focused run of the three touched specs: 50 passed, 0 failed.
