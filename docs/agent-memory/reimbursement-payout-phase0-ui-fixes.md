# Agent Memory: reimbursement payout Phase 0 (UI fixes and the pay right for approver roles)

Status: implemented on `claude/reimb-payout-p0-ui-fixes-20261001` (cut from develop `219c2369`), not pushed, no PR. Waiting for the coordinator session to integrate with the Phase 1 and Phase 2 lanes. Develop has since gained the spec and plan (#944, docs only); the branch merges with it cleanly.

Owner: Claude, Phase 0 lane. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: plan items 0.1, 0.2, 0.3, 0.6 and 0.7 of `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §13, §18; both reached develop in #944, after this branch was cut, so they are not in this branch's tree). The program's own memory file is `docs/agent-memory/reimbursement-recipient-bank-account.md`; this file is the Phase 0 lane's record and is kept separate so the parallel lanes do not edit one file. Items 0.4 (payment form default method) and 0.5 (text at the signed-copy uploader) belong to the Phase 2 lane. `PaymentForm`, the "ใบเบิกที่เซ็นแล้ว" section and `reimbursement.mapper.ts` are untouched.

## Decisions

- **Hub buckets come from the desk, not the status list.** A claim's bucket is read off `currentDesk.kind` (the server's rule, the same one the row prints as "อยู่ที่ …"): REQUESTER → ร่าง, APPROVER and FINANCE → รออนุมัติ/ตรวจสอบ, PAYMENT → รอจ่าย, no desk → จ่ายแล้ว or ปฏิเสธ/ยกเลิก. The spec lists statuses; the difference is `APPROVED` while still routed to finance (counted as รออนุมัติ/ตรวจสอบ, as its desk says) and `PARTIALLY_PAID` (counted as รอจ่าย).
- **Six chips, not five.** The owner's rule 2026-10-01 is that the chips add up to ทั้งหมด. Refused and cancelled claims had no chip, so ปฏิเสธ/ยกเลิก was added.
- **The hub loads every page.** It used one unpaged call and the list endpoint answers 20 rows, so older claims never reached the cards. `listAllReimbursements` pages 100 at a time on the client. Ceiling: move counting and filtering to the server when a shop has thousands of claims.
- **The payment desk is never "ฝ่ายการเงิน".** It reads "ผู้มีสิทธิ์บันทึกจ่าย", or the names on the claim page, for every claim, finance-reviewed or not. "ฝ่ายการเงิน" stays on the finance-review step only. The words live in `REIMBURSEMENT_DESK_LABELS` (contracts), read by the web and by the LINE backlog tool.
- **`paymentDesk` follows the permission resolver, not `activeApproverMembershipWhere`.** The plan named the approver predicate, which ignores branch status. The resolver drops archived branches from a SELECTED_BRANCHES scope and refuses a member left with none, so the list follows it. It is added by GET detail only (`GetReimbursementDetailUseCase`), like `approvalActions`: the page re-reads the claim after every action.
- **Every company-role backfill is audited, not only the two new keys.** `sync-permissions` writes one `access.role.update` row (actor SYSTEM) per role and key it adds, in the same transaction, and only for roles that gain the key.

## Open questions

- The AI eval set S3 (case R-13) expects the word "การเงิน" for a claim that waits for payment with no finance step. Its oracle follows the old label and needs updating before that case is re-run.
- A claim with no branch (legacy rows only) is refused by the payment endpoint for everyone (`TRANSACTION_BRANCH_REQUIRED`), while `paymentDesk` names the holders. New claims always have a branch.
- A legacy four-block claim still labels its payer block "ฝ่ายการเงิน" (the printed form's block title).
- A company role that keeps `reimbursement.approve` gets the pay and void rights back on the next deploy if they are removed by hand.

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
