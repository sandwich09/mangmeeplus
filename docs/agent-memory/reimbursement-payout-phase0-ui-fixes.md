# Agent Memory: reimbursement payout Phase 0 (UI fixes and the pay right for approver roles)

Status: implemented on `claude/reimb-payout-p0-ui-fixes-20261001` (cut from develop `219c2369`), not pushed, no PR. Waiting for the coordinator session to integrate with the Phase 1 and Phase 2 lanes. Develop has since gained the spec and plan (#944, docs only); the branch merges with it cleanly.

Review follow-up (2026-10-01): implemented on `claude/reimb-payout-p0-followup-20261001`, cut from the Phase 0 + Phase 2 assembly `79ecff16`, not pushed, no PR. It changes several decisions below; each changed line says so. See "Review follow-up" at the end.

Owner: Claude, Phase 0 lane. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: plan items 0.1, 0.2, 0.3, 0.6 and 0.7 of `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §13, §18; both reached develop in #944, after this branch was cut, so they are not in this branch's tree). The program's own memory file is `docs/agent-memory/reimbursement-recipient-bank-account.md`; this file is the Phase 0 lane's record and is kept separate so the parallel lanes do not edit one file. Items 0.4 (payment form default method) and 0.5 (text at the signed-copy uploader) belong to the Phase 2 lane. `PaymentForm`, the "ใบเบิกที่เซ็นแล้ว" section and `reimbursement.mapper.ts` are untouched.

## Decisions

- **Hub buckets come from the desk, not the status list.** A claim's bucket is read off `currentDesk.kind` (the server's rule, the same one the row prints as "อยู่ที่ …"): REQUESTER → ร่าง, APPROVER and FINANCE → รออนุมัติ/ตรวจสอบ, PAYMENT → รอจ่าย, no desk → จ่ายแล้ว or ปฏิเสธ/ยกเลิก. The spec lists statuses; the difference is `APPROVED` while still routed to finance (counted as รออนุมัติ/ตรวจสอบ, as its desk says) and `PARTIALLY_PAID` (counted as รอจ่าย). *Follow-up:* the rule is `reimbursementHubBucket` in contracts. A claim with no desk, or an unknown desk kind, is placed by its status (a table typed over every status), so a draft without a desk is a draft.
- **Six chips, not five.** The owner's rule 2026-10-01 is that the chips add up to ทั้งหมด. Refused and cancelled claims had no chip, so ปฏิเสธ/ยกเลิก was added.
- **The hub counts on the server and takes its list lazily.** *Follow-up, replaces "the hub loads every page".* The list endpoint pages in the database and answers `hub`: the whole scope counted per bucket (one GROUP BY), the sum of the amounts and the drafts that still owe a receipt. `total` is read off the same groups. `bucket=` filters the list by the same rule the counts use. The hub shows the cards and chips from `hub`, takes the first page of the open filter (100 rows), and asks for another page only when the table page shown reaches past the rows it holds. Ceiling: search still reads the rows on the page, so typing a search takes every page of the open filter; search on the server when a shop holds thousands of claims. There is also no index on the list's order (createdAt, id), so each call still makes PostgreSQL walk the scope to sort and to group it.
- **The payment desk is never "ฝ่ายการเงิน".** It reads "ผู้มีสิทธิ์บันทึกจ่าย", or the names on the claim page, for every claim, finance-reviewed or not. "ฝ่ายการเงิน" stays on the finance-review step only. The words live in `REIMBURSEMENT_DESK_LABELS` (contracts), read by the web and by the LINE backlog tool.
- **`paymentDesk` follows the permission resolver, not `activeApproverMembershipWhere`.** The plan named the approver predicate, which ignores branch status. The resolver drops archived branches from a SELECTED_BRANCHES scope and refuses a member left with none, so the list follows it. It is added by GET detail only (`GetReimbursementDetailUseCase`), like `approvalActions`: the page re-reads the claim after every action. *Follow-up:* it is added only on a claim somebody can pay: one with a branch, in a status the payment endpoint takes (`PAYMENT_RECORDING_STATUSES`). A branchless or part-paid claim carries no `paymentDesk`, and the page prints the pool label.
- **Every company-role backfill is audited, not only the two new keys.** `sync-permissions` writes one `access.role.update` row (actor SYSTEM) per role and key it adds, in the same transaction, and only for roles that gain the key. *Follow-up:* the row carries `actorRefId: 'sync-permissions'` and the registry's risk level for the key; the roles that gain a key are read inside that transaction, which is serializable.
- **Approval queue rows carry `approvalActions`.** *Follow-up (audit B20).* `pendingApprovalActions` is the one resolver for the claim detail and for every queue row; the hub shows อนุมัติ and ปฏิเสธ only where the row says so.

## Open questions

- The AI eval set S3 (case R-13) expects the word "การเงิน" for a claim that waits for payment with no finance step. Its oracle follows the old label and needs updating before that case is re-run.
- Resolved in the follow-up: a claim with no branch named the holders while the payment endpoint refused them all. It now names nobody.
- A legacy four-block claim still titles its payer block "ฝ่ายการเงิน" on the printed form and in the signature section, which shows the form's own titles. The document-step note no longer does for a claim with no finance-review step (it says "ผู้บันทึกจ่าย"). The form and its section belong to the Phase 2 lane.
- Resolved 2026-10-01 (`reimbursement-payout-hub-bank-fixes.md`, owner decision): a back-fill grants a key to a role once. A company role that keeps `reimbursement.approve` no longer gets the pay and void rights back on the next deploy after its admin removes them.
- A legacy claim with no branch waits at the payment desk and nobody can pay it. The page says "ผู้มีสิทธิ์บันทึกจ่าย" and gives no way to fix the branch. No such claim is known in production; it needs an owner decision if one turns up.

## Artifacts

- Web: `apps/web/src/features/reimbursements/` — `reimbursements.logic.ts`, `reimbursements.model.ts`, `reimbursements.api.ts`, `ReimbursementsPages.tsx`, `ReimbursementJourneyPage.tsx` and their specs.
- API: `reimbursement-request.use-case.ts` (`paymentDesk`), `prisma-reimbursement.repository.ts` (`listPaymentRecorderNames`), `reimbursement-policy.use-case.ts` (`canRecordPayment`), `reimbursement-summary.use-case.ts` (backlog labels), `prisma/sync-permissions.ts`, `company-role-backfill.registry.ts`.
- Contracts: `packages/contracts/src/reimbursements.ts` (`REIMBURSEMENT_DESK_LABELS`, `paymentDesk`, `canRecordPayment`).
- Docs: `docs/specs/permission-matrix.md` §5.6, plus one line each in the advisor system-knowledge spec and the journey-uplift spec that quoted the old desk label.

## Verification

Run on 2026-10-01 at the branch head:

- Typecheck (native TypeScript, as CI): api, web, contracts pass. `prisma/sync-permissions.ts`, its spec and `seed.ts` are outside the API typecheck config and were checked with a one-off config: pass.
- Web suite `pnpm --filter @watchdog-bms/web test`: 2231 pass, 0 fail.
- API suite `pnpm --filter @watchdog-bms/api test`: exit 0, no failures.
- Unregistered specs run directly: `reimbursement-approval-backlog.use-case.spec.ts` pass, `packages/contracts/src/reimbursements.spec.ts` pass.
- W00 manifest parity spec: pass, no regeneration (no hashed file touched).
- `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0.
- API boot smoke `test:boot`: pass.
- Real PostgreSQL (throwaway container, not committed): the sync granted and audited the two keys on a company role and an orphan role, a rerun changed nothing, and `listPaymentRecorderNames` matched the resolver for every member and branch, with the feature on and off.
- Browser at 390 px (static render with the app's compiled CSS and fonts): hub, policy form and claim page have no horizontal overflow.
- Mutation check: 17 single-rule mutations, each caught by a spec.
- Not run: Playwright E2E (needs the full local stack); no real-model AI eval.

## Next

1. Coordinator: merge order with the Phase 1 and Phase 2 lanes; shared files are `reimbursements.logic.ts`, `reimbursements.model.ts`, `ReimbursementsPages.tsx`, `packages/contracts/src/reimbursements.ts`, the three web specs and `reimbursement-request.use-case.spec.ts`.
2. Before production: the read-only data check the plan asks for (company roles holding `reimbursement.approve` without `reimbursement.payment.record`), announced to the owner first.
3. After deploy: confirm the release log line `Company-role backfills:` for the two keys, and that the six stuck claims show under รอจ่ายเงินคืน.
4. Release note: approver roles gain the pay and void rights; the hub cards and chips changed.

## Review follow-up (2026-10-01)

Branch `claude/reimb-payout-p0-followup-20261001`, worktree `/private/tmp/mangmee-reimb-p0-followup-20261001`, cut from the assembly `79ecff16`. Not pushed, no PR. The Phase 2 follow-up lane works in parallel on `PaymentForm`, the slip routes, the void path, the claim-form print and the hub quick-pay modal; none of those were touched here.

What changed, by review item:

1. Hub paging. Web: one `HubList` (key, rows, total, next page, failure, summary) filled a page at a time through `loadHubPage`, whose returned function lets go of the request (the effect's cleanup). A late answer is dropped, a failed page keeps the rows and offers ลองอีกครั้ง, and the list ends on the server's total or on a page shorter than the server's page size. API: `listRequestPage` reads one page with OFFSET and LIMIT and the scope's groups; `hub` and `bucket` as described above.
2. `paymentDesk` only on a claim somebody can pay.
3. The policy warning "อนุมัติได้ แต่บันทึกจ่ายไม่ได้" names only roles that are still `selectable`.
4. Buckets by status when the row has no desk.
5. The document-step note says "ผู้บันทึกจ่าย" for a legacy four-block claim with no finance-review step.
6. Back-fill audit rows: `actorRefId`, the registry's risk level, the read inside a serializable transaction.
7. Queue rows carry `approvalActions`.
8. Specs for the claims that had none: the hub's use of the loader, the claim page's "อยู่ที่" line, a card tapped while open, the back-fill auditing every key.

Contract additions (all additive): `ReimbursementHubBucket`, `reimbursementHubBucket`, `ReimbursementHubSummary`, `ListReimbursementsFilter.bucket`, `PaginatedReimbursements.hub`, `ReimbursementApprovalQueueItem.approvalActions`.

Not changed: no AI-facing label or tool (the LINE tools map queue rows to their own fields), so the whole-chain acceptance was not needed. No `package.json` edit; the new API tests are in spec files already registered.

Merged with the updated assembly `41e2e1101` (develop's manual-entry docs and the Phase 2 follow-up) at `9cfc25d62`. Two conflicts, both sides kept: GET claim detail takes the assembly's `detailWithFileNames(..., ctx, approvalActions)` together with this lane's `paymentDesk` rule; the hub page's imports keep this lane's list functions together with the assembly's `PAYMENT_DIALOG_MEDIA_QUERY` and `quickPayTarget`. No schema change came with the merge.

Verification at the merged head `9cfc25d62` (2026-10-01):

- Typecheck: native TypeScript (the CI compiler) for api and web pass. The API package script (`tsc --noEmit`, 8 GB heap) passes, 0 errors. `prisma/sync-permissions.ts`, its spec and `seed.ts` are outside the API typecheck config and pass with a one-off config (run before the merge; the merge did not touch them).
- Web suite `pnpm --filter @watchdog-bms/web test`: 2287 pass, 0 fail.
- API specs of both lanes, 31 files run directly (every registered reimbursement spec, the attachment logic and repository specs, the LINE reimbursement tools, capability logic, the permission registry and resolver, `spec-suite-coverage`, `prisma/sync-permissions.spec.ts`, and the unregistered approval-backlog spec): 986 pass, 0 fail.
- W00 manifest parity spec: pass, no regeneration (no hashed file touched).
- Real PostgreSQL 18 (throwaway container, probe not committed): the sync granted and audited the two pay keys on a company role and on an orphan role, with `actorRefId` and the registry's risk level on every row it wrote, and a rerun wrote nothing. The list answered company, own and related scopes over 330 claims in pages of 100, rows sharing a `createdAt` included: for every bucket the count, the total and the rows of all pages agree, and the buckets add up to the scope.
- Browser at 390 px (static render with the app's compiled CSS and fonts, headless Chromium), run before the merge: the hub (mixed, 100 of 2,300 rows held, a filter open, a filter loading, both failure states, empty), the approval queue (reject only, both), the policy form with the warning, and the claim page with five payers named: no horizontal overflow.
- Not run: the full API suite, the whole-chain acceptance (no AI-facing label or tool changed), the boot smoke, Playwright E2E, and the `*.pg.spec.ts` files.
