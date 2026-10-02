# Agent Memory: Reimbursement payout Phase 4.2 and 4.3 (claim history and the paid notice)

Status: Implemented on branch `claude/reimb-payout-history-notice-20261002`, cut from the payout assembly at `ae14805df`. Not pushed, no PR. 2026-10-02. Code head before this note: `d6868febb`.

Owner: Claude (lane 4.2 and 4.3), for the payout coordinator. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §17.2, §17.3, §12.4, §18.3, §23 (AC37, the notice half of AC21), §25.1 (I2, I4); plan Phase 4 tasks 4.2 (without the three correction-round lines, which come with Phase 3) and 4.3; and five small page refinements. Not in scope and untouched: stranded-claim recovery (the approval step and the cancel area of the claim page, the approval and cancel use cases, the projection reconciler), the printed form, the LINE assistant's tools, the user guide.

## Decisions

The paid notice (4.3):

- One wording for how a payment was made lives in contracts: `REIMBURSEMENT_PAYMENT_METHOD_LABELS`, `reimbursementPaymentHowText` and `reimbursementPaidNotice`. The payment row, the timeline and the notice all read it (I4).
- The event `reimbursement.payment_recorded` gains exactly one field, `paidNotice`: the finished Thai sentence, built inside the payment transaction from the payment just written and the account the payer confirmed (the repository hands both to `onPaymentPersisted`). The brief allowed the last 4, the bank name and the method as fields too; none is added, because a template that can only print the sentence cannot print a code word, also after an admin edits it.
- The sentence says the method actually used (AC21). Transfer into a confirmed account: "โอนเข้าบัญชีลงท้าย 1234 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป" (PromptPay: "โอนเข้าพร้อมเพย์เบอร์ลงท้าย …"). Transfer with no confirmed account: "โอนเงิน จำนวน …". Cash: "จ่ายเป็นเงินสด 1,614.50 บาท". No reason, no bank name, no account name.
- The template body is `{{paidNotice}}`. The event keeps `paidAmount`, `currency` and `paymentNo`, so the rule snapshot of the previous release and a rule whose text an admin changed render as before. The release-time template sync re-pins only rules that are still what the sync pinned.
- An event written by the previous release and delivered after the re-pin has no `paidNotice` and gives a notice with its title only. Accepted: it is the few events in the outbox at the moment of release.
- Recipient unchanged: the requester only, and not when they recorded the payment themselves.

Who a claim waits for (I2):

- `paymentTurnUserIds`: the finance reviewer who passed the claim, then the claim's own approver (the contracts rule, through `claimApproverUserId`). Those of them who can record the payment head the list in that order; everyone else follows by name. It is the order the ready-to-pay notice asks in.
- The API cuts `paymentDesk` to two names plus `moreCount`. One web function (`paymentDeskText`) feeds the header line, the step note and the timeline, so they cannot differ.
- The would-be approvers of a claim that needed no approval are not put first on the page (the notice lane does prefer them for the notice). See Open questions.

History on the claim page (4.2):

- `payoutHistory` is on the detail read only: every account version the claim was sent with, oldest first, masked like `payout`. Copies of a default account kept with the payment of a legacy claim (`LEGACY_PAYMENT`) are not in it. The attestation of the current version is left out while the claim is back in draft. The card shows the block only when there is more than the current account, and it has no reveal control.
- The card always says where the account of a sent transfer claim came from: the requester's default (and who set it, when somebody else did), typed by the requester for this claim, or typed by a preparer.
- Timeline: "อนุมัติและตรวจบัญชีรับเงินโดย …" when that step attested the account; "อนุมัติโดย … · ผู้เบิกยืนยันบัญชีของตนเอง" when the approver is the requester; "อนุมัติโดย …" otherwise. A voided payment stays as two rows: the paid row as it was, then "ยกเลิกการจ่ายแล้ว: เหตุผล" with the void date. Rows are keyed by payment, so the correction-round rows of Phase 3 can be added by date without touching them.
- Existing behaviour seen in the browser, now written in spec §17.2: when a payer other than the requester confirms the account of a self-approved claim, the payer becomes the account's checker (§10.2). The approval line then reads "อนุมัติโดย …" again and the card names the payer.
- "ยกเลิกการจ่ายแล้ว" is the one wording for a voided payment, on its row and in the timeline.
- The evidence export gives each payment `paidOn`, the day in Thai time, beside `paidAt`.

Small fixes:

- The label of `note_contains_account_number` is true for both texts it guards: finance's note on a claim, and the reason for paying by another method than asked. It no longer speaks of a notice, because the payment reason is in none.
- The void dialog says in one sentence that a bank match is undone too.
- `api-error-coverage.spec.ts` also reads the `{ error: 'code' }` refusals of the reimbursement planners, so `payout_confirmation_required` and `payment_method_mismatch_reason_required` are covered.

## Open questions

- A claim that needed no approval: should the people who would have approved it be named first at the pay step, as the notice prefers them? It needs the approver route resolver at read time. Not done.
- After a void the earlier "paid" notice stays open in the bell beside the "voided" one. A newer notice only resolves older ones of the same trigger.
- `payment_amount_invalid` and `payment_over_approved_amount` have no Thai label. The coverage spec still does not see codes a validator returns as a bare string.
- Audit rows that predate this lane: `reimbursement.payment.record` names the slip file (`slipAttachmentId`) and `reimbursement.payment.void` carries the free-text void reason. This lane adds nothing to audit metadata or logs; whether those two rows should change is for the coordinator.
- The claim list says "อยู่ที่ ผู้มีสิทธิ์บันทึกจ่าย" without names (list rows carry no payer names). It does not contradict the claim page, it is only less specific.
- The plan's checkboxes 4.2 and 4.3 are not ticked here: the print lane edits the neighbouring line 4.1.

## Artifacts

- Contracts: `packages/contracts/src/reimbursements.ts`.
- API: `apps/api/src/modules/reimbursements/` (`application/use-cases/reimbursement-finance.use-case.ts`, `reimbursement-request.use-case.ts`, `application/dto/reimbursement.mapper.ts`, `domain/logic/reimbursement.logic.ts`, `infrastructure/prisma-reimbursement.repository.ts`, `infrastructure/reimbursement-payout.ts`), `apps/api/src/modules/workflow/domain/workflow-template-catalog.ts`.
- Web: `apps/web/src/features/reimbursements/` (`reimbursements.logic.ts`, `reimbursements.model.ts`, `reimbursement-payout.logic.ts`, `ReimbursementPayout.tsx`, `ReimbursementDetailSections.tsx`), `apps/web/src/common/api/api-error-message.ts`, `api-error-coverage.spec.ts`.
- Spec: §17.2, §17.3, §18.3, §20.
- No migration, no `package.json` change, no file hashed by the W00 manifest, no pinned file.

## Verification

At `d6868febb`:

- Typechecks: contracts, API (package script), web. All exit 0.
- API specs of the reimbursements, workflow and dashboard-notifications modules: 1076 tests, 1019 pass, 0 fail, 57 skipped (the real-PostgreSQL files, run separately below).
- Web suite: 2398 of 2398.
- Reimbursement real-PostgreSQL gate on a throwaway PostgreSQL 18.3 container: 60 of 60. Claim payment posting on PostgreSQL: 16 of 16.
- W00 manifest parity with the reimbursement tool specs: 12 of 12, nothing regenerated. LINE claim detail tool spec: 7 of 7. Maintenance pins: current. `git diff --check`: clean.
- Mutation checks (one edit, the specs must fail, restore): 37 of 37 caught.
- Real stack (own PostgreSQL and MinIO containers, API and web of this branch): 15 claims seeded through the HTTP API as the QA roles (transfer, cash, paid by another method both ways, voided, voided and paid again, legacy with and without the payer's confirmation, two accounts, self-approved, self-paid, filed by a preparer, two waiting claims). 179 screenshots at 390 px and 1280 px (claim page as requester and as payer, the void dialog, the notification page, the claim list), no horizontal overflow. In the visible text of the 53 views there is no id, no code word and no "THB"; the only Latin text is document numbers and the file-type hint of the upload field. The 12 paid notices read as designed and link to the claim page; the requester who paid their own claim got none. No full account number anywhere in the database dump or the API log; the free-text reasons and slip file ids are in no event, workflow or notice table.
- Release path on the same database: with the previous release's rule the notice read "จ่ายแล้ว 111.00 บาท · เลขที่จ่าย …"; this branch's template sync re-pinned the rule and the next notice read "จ่ายเป็นเงินสด 222.00 บาท"; after an admin changed the rule's text the sync left it alone and the notice used the admin's words with the amount.

Not run: the repository's own e2e suite, a LINE push (the stack has no LINE), the whole-chain acceptance script (no hashed file changed), the boot DI smoke script (no provider or constructor changed; the API of this branch did boot and serve).

## Next

- Coordinator: merge into the assembly, tick plan 4.3 and note 4.2 as done except the correction-round lines.
- Release: the workflow template sync in the release task re-pins the paid rule of every company that has not changed it.
- Phase 3 adds the three correction-round rows to the timeline.
