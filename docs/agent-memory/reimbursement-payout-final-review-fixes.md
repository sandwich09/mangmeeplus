# Agent Memory: reimbursement payout, fixes from the final server-side review

Status: done on `claude/reimb-payout-final-fixes-20261002` (worktree `/private/tmp/mangmee-reimb-final-fixes-20261002`), created from `201c21776`. Not pushed, no PR. To be merged with the web branch (head `7b8bd7e0d`, web and e2e files only).
Owner: payout lane, final review (review file `scratchpad/final-review/server-review.md`, line numbers at `9d91db923`).
Scope: API, contracts, workflow notices, the assistant's claim detail tool, the CI gate, the payout spec and plan. No web file, no `package.json`.

## What was fixed

Item numbers are the coordinator's. "PG" is a case in `prisma-reimbursement.repository.draft-submit-race.spec.ts` on real PostgreSQL 18; "unit" runs over fakes.

| # | Review | Commit | What changed | Proof |
|---|---|---|---|---|
| 1 | S1 | `ff9ef0303` | A signature is written in a transaction that takes the claim lock and reads the claim again; a claim that changed since the signer's checks answers `stale_claim_snapshot` | PG, both orders, for a send-back and for a withdrawal; unit |
| 2 | S2 | `2032ae6b2` | The step a round opens keeps only those of the old step's people who are on today's approval route; none left: it names nobody and its role or the owner decides | PG with real roles and the real resolver; unit |
| 3 | S3 | `d8fffd410` | `REIMBURSEMENT_PG_GATE_REQUIRED=true … test:reimbursement-compatibility` is a step of `migration-review` with its own database | Rehearsed with the step's own commands, see Verification |
| 4 | S4 | `83e4cad9c` | A submit writes the round columns as NULL; spec §14.9 and the plan say what a rollback costs | PG |
| 5 | W1 | `d8c0b63b0` | Account-number guard on the void reason and the approval comment; the reject and void bodies are DTOs with length limits | Unit (DTO, void, approval) |
| 6 | W3 | `fe49b7f9d` | A notice body that renders empty falls back to its title | Unit |
| 7 | W4 | `e099a5be6` | A claim being cancelled is out of both reminder scans and the to-do rule; the three completion writers refuse it | PG for the writers and the notice; unit for scans and to-do |
| 8 | W6 | `1de5108f3` | New choice `mode: 'PREVIOUS'`: the account the claim had, also for a requester who is no longer active; typing one stays refused | PG; unit; DTO |
| 9 | W7 | `42ca8b626` | The reconciler lists decisions older than one minute | PG; unit |
| 10 | W8 | `de3e88d3d` | `expectedUpdatedAt` on the give-account call: a second press on the same page answers `reimbursement_changed` and freezes nothing | PG; unit; DTO |
| 11 | W10 | `13d07c4ab` | The export names the payer; a void that undoes a bank match writes `banking.statement_line.unmatched` in the same transaction | PG reads both events; unit |
| 12 | W11 | `dd9fc3473` | Tests only | Unit; one PG case extended |
| 13 | open item | `ca1ad9899` | The ready-to-pay notice asks the finance reviewer first, then the actor: the order of the claim page | Unit |
| 14 | open item | `279b20f9e`, spec `38087385a` | `reimbursement.get_detail` says of a round what the backlog tool says | Unit; manifest regenerated; whole-chain acceptance |
| 15 | new | `de30f7a96` | "Payment voided" retires the claim's open "paid" notice, and the next "paid" retires that one | Unit over the real notice repository with an in-memory client |
| 16 | leftovers | `89fbeb858`, `c69779902`, `1ad6d36ac` | Unused outbox injection removed; two orphan comments and one stale header fixed; the printed form reads the payment-method words from contracts | Unit; 22 sha256 pins unchanged |
| 17 | spec files | `8a4c6ed1f` | Two spec files that no gate ran are registered | Catalog and CI step |
| 18 | new | `4f38d6819` | The endpoints that decide on a claim ask the claim detail's gate first | Unit matrix: 2 refused callers, 12 claim states |

## Decisions taken here

- S2: "today's approval route" is what a submit would resolve for the step's recorded role and the claim's branch. The policy's other approver roles count while the policy still names that role. A named approver stays while they hold read, approve and reject there. The solo exemption is kept. How an ordinary step is frozen at submit is unchanged.
- W1: the ordinary rejection reason is not guarded. The finding names the void reason and the approval comment; a receipt number in a rejection reason is ordinary.
- W6: `PREVIOUS` copies the sealed columns of the approved version into a new frozen version, with who entered that account as it was. The web form does not offer the choice yet.
- W7: pending cancellations are not delayed, only pending decisions.
- W8: `expectedUpdatedAt` is optional so the web keeps working until it sends it. Without it the call compares against its own read, as before.
- W11: the finding holds only for the suite without a database. The PG case "takes no other decision on a claim while its cancellation is pending" already pinned both refusals at `9d91db923`; that suite was not on the pull-request gate.
- Item 13: `approverRecipientUserIds` still carries the finance reviewer, so a rule pinned before the new order asks the same person.
- Item 14: for a claim in a round the tool puts the claim page's words for the phase in `status` ("รอผู้เบิกแก้บัญชีรับเงิน", "รออนุมัติบัญชีรับเงินใหม่"), with `sentBackOn` and the backlog's note in phase A and `resubmittedOn` in phase B. The gateway's fixed reply prints `status` as it comes, so no gateway file changed. A step a round set aside is not listed. A claim being cancelled is not said to be in a round. No approver is named, as before.
- Item 15: the pairing is keyed by the notice's trigger key in code (`WORKFLOW_NOTICE_ALSO_REPLACES`), not in a rule's config, so rules pinned or edited earlier follow it.
- Item 18: the gate is `assertCanReadRequestOrAssignment`, the function the claim detail calls. The payer's endpoints are not held to it, see Open questions.

## Known, left as they are

- W2: `looksLikeAccountNumber` is a heuristic for accidents. Full-width and Arabic-Indic digits pass; a number of up to nine digits followed by "บาท" passes by design.
- W5: a claim that waits for its requester's account has no reminder (spec §14.7), and its one notice goes to the requester.
- W9: a role that got its pay rights from a capability pack, whose admin then removed them, has no back-fill audit row, so the next deploy grants them once more.
- The dead `if (auditRequestId)` branch of `voidPaymentTrueReversal` stays. An audit row needs a request id (`AuditLog.requestId` is required), and 18 calls in five spec files, two of them real-PostgreSQL suites, void with none and rely on that branch.
- Repository writers with no guard and no production caller stay: `cancelRequestAtomic`, `updateRequest`, `createApprovalStep`, `updateApprovalStep`, `voidPayment`, `resolveDuplicateCandidates`.
- A void that makes no notice (a requester voiding the payment of their own claim) leaves the earlier "paid" notice current.
- An approver who holds a frozen place on a step and no read right at all can decide the step as before. Once it is decided the detail refuses them, and now so do a second approve and the resume; the scheduled run carries the decision out. An approver who keeps `reimbursement.read_related` (every staff role has it) is taken as before.
- Submit, draft edit and the evidence export keep their own rule: the branch is checked before the status, and no read right is asked of a finance reviewer or of a holder of `reimbursement.export`.
- `packages/contracts/src/expense-evidence.spec.ts` is in no test script either. It was not on the list.

## Open questions

- Paying and voiding. The item asked for the detail's read rights on pay and void as well. They are not applied there: the pay rule is the pay right and the claim's branch (spec §13), the claim page names exactly the members that rule takes (owner rule 2026-10-01, spec §18.3, pinned both ways by "claim detail paymentDesk"), and both are asked before anything about the claim, so a caller of another branch already gets the detail's answer. Asking a read right too changes who can pay; the payer list and the recipients of the ready-to-pay notice would have to follow. Every system role and capability pack that holds the pay right also holds `reimbursement.read`, so only custom roles differ. Decide whether paying needs a way to open the claim.
- Web follow-ups on the merged branch: offer "the account the claim had" (`mode: 'PREVIOUS'`) in the correction form, and send `expectedUpdatedAt: detail.updatedAt` with the give-account call.
- A real-model check of the new `reimbursement.get_detail` output. No model call was made here.

## Artifacts

- CI: `.github/workflows/ci.yml` (step "Test reimbursement claim proofs against PostgreSQL" in `migration-review`).
- Catalog: `scripts/line-ai-whole-chain-acceptance.catalog.mjs`.
- Contracts: `packages/contracts/src/reimbursements.ts`.
- API, reimbursements: `application/use-cases/reimbursement-approval.use-case.ts`, `reimbursement-request.use-case.ts`, `reimbursement-finance.use-case.ts`, `reimbursement-payout-correction.use-case.ts`, `reimbursement-claim-signature.use-case.ts`, `application/dto/reimbursement.mapper.ts`, `domain/logic/reimbursement.logic.ts`, `domain/logic/claim-form.logic.ts`, `infrastructure/prisma-reimbursement.repository.ts`, `infrastructure/reimbursement-payout.ts`, `presentation/http/reimbursement.controller.ts`, `presentation/http/reimbursement.dtos.ts`.
- API, elsewhere: `workflow/application/use-cases/workflow-action-runner.use-case.ts`, `workflow-scan-candidates.use-case.ts`, `workflow/domain/workflow-template-catalog.ts`, `dashboard-notifications/application/use-cases/notification.use-cases.ts`, `dashboard-notifications/infrastructure/prisma-notification.repository.ts`, `document-notification-state.ts`, `line-ai/application/use-cases/erp-core-detail-tools.use-case.ts`, `common/pipes/body-validation-coverage.spec.ts` (146 to 144).
- Documents: `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` (§11.3, §12.8, §14.2, §14.5, §14.9, §17.3, §20), `docs/specs/reimbursement-step-journey-spec-th.md` §11, `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md`, `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`.

## Verification

Run on 2026-10-02 at `4f38d6819` with a clean tree, before the commit that adds this note (that commit is this note and one section of the plan).

- Typechecks, the package scripts: contracts, workers, ai-gateway and web exit 0; API `pnpm --filter @watchdog-bms/api typecheck` (heap flag) exits 0 in 216 s.
- API unit suite `pnpm --filter @watchdog-bms/api test` (the pre-test list and 511 files): exit 0, no failure. The real-PostgreSQL race spec skips there, having no database.
- Contracts tests 343 of 343. Web unit suite 2508 of 2508.
- Reimbursement specs without a database, 22 files and `prisma/sync-permissions.spec.ts`: 882 of 882.
- Every new test was seen failing on the code from before its fix. Item 18: 16 fail there (13 of the matrix, 3 changed cases). W11 is tests only: with the three explicit checks removed, 2 unit and 2 PG cases fail.
- The two PostgreSQL steps of `migration-review`, with their own commands and env read out of `ci.yml`, against a throwaway `postgres:18.3-alpine` container at the digest the job pins (127.0.0.1:5432), removed afterwards:
  - "Test claim payout posting against PostgreSQL": CREATE DATABASE, 271 migrations from empty, 16 of 16.
  - "Test reimbursement claim proofs against PostgreSQL": CREATE DATABASE, 271 migrations from empty, `test:reimbursement-compatibility` 96 of 96 in 4 suites, 0 skipped (89 before this lane), then the A5 evidence spec 12 of 12.
- Boot DI smoke `test:boot`: "Nest resolved every provider". The approval and request use-case files now import each other's functions; the compiled modules load in any order with every constructor's metadata intact.
- Maintenance pins `--check`: 48 exact files, status current, no pinned file changed.
- W00 manifest: regenerated for `erp-core-detail-tools.use-case.ts` (digest `e3708b42…`), parity 4 of 4 without the variable. It was generated with that change still uncommitted, so it records `checkoutDirty: true`; the digest does not include that field.
- `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0, 12 suites, 3665 tests in its eight node-test suites. The contracts suite went from 228 to 231 with the newly registered spec.
- The printed form's 22 sha256 pins (18 in `claim-form.logic.spec.ts`, 4 in `reimbursement-claim-form.use-case.spec.ts`) pass before and after the label change.
- `git diff --check` clean. No `package.json` edit.

Run without a model: the gateway's fixed reply for the new tool output, through its own formatter ("สถานะ: รอผู้เบิกแก้บัญชีรับเงิน", "สถานะ: รออนุมัติบัญชีรับเงินใหม่").

Run from the registries (`ROLE_GRANTS`, `CAPABILITY_PACKS`): every system role and capability pack that holds a right to approve, reject, review, pay or void (OWNER, ADMIN, MANAGER, FINANCE, ACCOUNTANT; the approve, review and finance packs) also holds `reimbursement.read`, and STAFF holds `reimbursement.read_related` and `reimbursement.read_own`. So the gate of item 18 refuses nobody a standard role lets act.

Read, not run: the web error map (a 403 with no sentence of its own shows the shared "no permission" text, so the gate's answers need no new web string).

Not run: Playwright E2E, a browser pass, and any model call.

## Next

- Merge with the web branch; regenerate the W00 manifest on the merged tree if a hashed file differs.
- The owner's decision on paying and voiding (Open questions).
- The two web follow-ups and the real-model check above.
