# Agent Memory: Reimbursement payout Phase 1 part B (the pay step)

Status: Implemented on branch `claude/reimb-payout-p1b-pay-step-20261001`, cut from the payout assembly at `1d3a6dc16`. Not pushed, no PR. The assembly has moved since (ledger posting fixes, hub and bank fixes); a trial merge with its head `c85a33308` is kept on the local branch `claude/reimb-payout-p1b-merge-trial-20261002` (see "Merging").

Owner: Claude (lane P1 part B), for the payout coordinator. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §11, §12.1 to §12.4, §12.6 to §12.8, §15, §22, §23, §25.1; plan Phase 1 tasks 1.1 (payment columns), 1.9, 1.11, 1.13 (the pay-step parts), 1.15, 1.16; and six review findings in the same area. Part A is `reimbursement-payout-p1-default-account.md`; the slip and the payment form are `reimbursement-payout-phase2-payment-slip.md`. Not in scope and untouched: the printed form, the hub cards, paging and search, bank matching, stranded-claim recovery, the paid notice (plan 4.3), the account-correction round (Phase 3).

## Decisions

Product:

- **One table, one function.** The table of spec §12.4 is `reimbursementPaymentRule(requested, paymentMethod)` in contracts: whether the slip is required, whether the payer's confirmation is `required`, `optional` or `none`, and whether a reason is required. The API applies it under the payment lock and the form builds its fields from it. `requested` is null for a legacy claim.
- **What the payer states.** `payoutDestinationVersion` (the account version the page showed; the web sends it with every payment of a claim that has one, whatever the method), `payoutConfirmed`, `payoutDefaultToken` (legacy only) and `methodMismatchReason`.
- **How the statement is held against the claim** (`planPaymentPayout`, in this order): a version other than the claim's own, or a default token on a claim that has its own snapshot, is `payout_destination_changed`; a transfer into the claim's account without the confirmation is `payout_confirmation_required`; a confirmation on a legacy claim that names no default is `payout_confirmation_required`; a method other than the one asked for without a reason is `payment_method_mismatch_reason_required`; a reason that carries an account number is `note_contains_account_number`.
- **A cash claim paid by transfer** needs a reason and a slip and no confirmation: the claim has no account.
- **Legacy claims are paid as before.** No confirmation and no reason is ever required of one. Their payer is shown the requester's current default account, labelled as never approved on the claim, with the audited reveal. Ticking the confirmation is the payer's choice: with it, a copy of that default is kept with the payment; without it, the payment records no account and its row says "ไม่มีบัญชีรับเงินในใบเบิก".
- **The legacy copy never touches the claim.** It is a frozen row of `ReimbursementPayoutDestination` (`source` = `LEGACY_PAYMENT`, `verifiedVia` = `PAYMENT`) that the payment points to by version. The claim's three payout columns stay empty, so its approval hash and its signature acknowledgement hash are what they were.
- **The payer is the check when nobody else was** (spec §10.2). When the account has no verifier, or only the requester, a confirmed transfer records the payer as who checked it; the form says "ยังไม่มีผู้ตรวจบัญชีนี้ คุณเป็นผู้ตรวจ". A payer who is the requester does not replace their own attestation.
- **The same payment.** The replay comparison, before the lock and under it, includes the account version and, for a legacy copy, the default it was made from. A request that repeats a voided payment is a new payment and needs its own confirmation.
- **The reason is free text for people.** It is stored on the payment row and shown on that row to everyone who reads the claim. It is in no event payload, audit row, notice or log line. The audit row says only that the method differs and which method was asked for.
- **The form.** The method starts from what the claim asks for; a legacy claim starts from none; cash is never chosen for the payer. The tick is kept with the key of the account it was given for (a version, or a default token), so it is no tick for another account or after the method changes. A failed save changes nothing but the banner.
- **What a payment says.** Row: method, the confirmed account (bank or PromptPay, account name, last 4), when the payer confirmed, the mark "จ่ายต่างจากที่ผู้เบิกขอ" with its reason. History: "จ่ายแล้ว โดย … · โอนเข้าบัญชีลงท้าย 1234 · มีสลิป". Export: the same, masked, as keys that are absent for a payment that has none of it.

Review findings fixed here:

- The reveal asks the read access the claim detail asks, of every member of the reveal group (`claimPayoutRevealGroup`).
- After a lost race the form says one thing: press save again. The record call raises no global toast. Any other conflict keeps its own sentence and nothing beside it says to press save.
- A misfiled copy that is also used elsewhere (a receipt of a claim line, or a file attached to something else) answers `payment_slip_in_use_elsewhere` (422) with its own sentence, not the one about file type and size.
- A claim with no branch offers no "บันทึกจ่าย", on the queue (`queueRowOffersPayment`) or on the claim page; the payment step says why.
- Quick pay: the press says which layout it came from (`quickPayTarget('cards' | 'table')`). The phone cards (below `md`) open the claim page with `?pay=1`; the table opens the dialog. Nothing measures the screen a second time.
- A replayed void answers the whole claim detail.

Also changed, found while building:

- The quick-pay dialog mounted the form on the bare queue row when the claim read failed. It now mounts only on the loaded claim, under the same account box, and a failed read offers a retry and the claim's own page.
- A revealed number that does not end with the last 4 digits on the card is not shown: the page is out of date, and it says so.
- The legacy sentence is the spec's own (§15) on every surface: "ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน จึงไม่มีบัญชีที่ผ่านการอนุมัติในใบ".

Architecture:

- Migration `20261001150000_reimbursement_payment_payout_confirmation`: three nullable columns on `ReimbursementPayment` (`payoutDestinationVersion`, `payoutConfirmedAt`, `methodMismatchReason`). No back-fill, no new table, no enum value. The legacy copy needs no column of its own.
- Refusals are 409, like the payout refusals of submit and approve (a page from before the release reads "load the latest"). The guard on the reason is the 400 it is elsewhere. One helper decides: `paymentPayoutRefusal`.
- Everything that can refuse is checked before a payment number is reserved, then again under the lock from the row read in the transaction. The check before the lock that reads the account (`assertPaymentPayoutUsable`) runs only when the plan names one.
- `confirmPaymentPayout` runs inside `recordPaymentAtomic`. For a legacy copy it locks the member's default row, compares the token, and writes the copy and the payment in the one transaction.
- The detail carries `legacyPayoutDefault` (masked, with an opaque `confirmToken` bound to the claim and the default's fingerprint) only for a viewer who may record that claim's payment. The claim's reveal call answers that viewer with the default and records it (`source: MEMBER_DEFAULT`).
- The Thai labels of the new codes are in the shared map (`apps/web/src/common/api/api-error-message.ts`), where part A and Phase 2 put theirs. The feature's `ERROR_CODE_LABELS` lookups fall through to it.

Deliberately not done:

- **Hub "payout blockers".** The part A note says only that the hub banner counts drafts not ready to send for receipt and date reasons. Neither it, the spec nor the plan says which claims a payer "must pay but cannot yet", or where the count would show. Not built.
- **The paid notice** (plan 4.3, AC37, and the notice half of AC21). The event payload is unchanged.
- The labels were not copied into `ERROR_CODE_LABELS`: a code in both maps is answered from the feature map, and codes that are in both today already read differently (`reimbursement_payment_already_recorded` is one).
- No Playwright spec was added to `e2e/`. The browser pass was a script outside the repo.
- The plan's checkboxes were left as they are.

## Open questions

- A payer transfers into the legacy default shown, and the requester changes the default before the payer saves. The save is refused (`payout_destination_changed`); the reopened page shows the new default. The payer can then only record the payment with no account. Decide whether that is enough.
- The label of `note_contains_account_number` says the text goes into a notice. For the payment reason that is not true (it is shown on the payment row). The form's own check says it correctly; the API label is what a direct caller reads.
- The dialog is offered from `md` (768 px) up, the width at which the queue shows its table. A tablet in portrait therefore gets the dialog.
- `ERROR_CODE_LABELS`: copy the three labels there or not (see above).

## Artifacts

- Contracts: `packages/contracts/src/reimbursements.ts` (`reimbursementPaymentRule`, `ReimbursementPaymentDestinationSummary`, `ReimbursementLegacyPayoutDefault`, the four input fields, the three payment fields).
- API: `domain/logic/payout-destination.logic.ts` (`planPaymentPayout`, `legacyPayoutConfirmToken`), `domain/logic/reimbursement.logic.ts` (`isSamePaymentRequest`), `infrastructure/reimbursement-payout.ts` (`confirmPaymentPayout`, `assertPaymentPayoutUsable`, `readLegacyPayoutDefault`, `readPaymentPayoutDestinations`, `readRecordedPaymentPayout`, `paymentPayoutRefusal`), `infrastructure/prisma-reimbursement.repository.ts` (`recordPaymentAtomic`, `resolvePaymentSlip`), `application/use-cases/reimbursement-finance.use-case.ts` (record, void replay, export), `reimbursement-request.use-case.ts` (`legacyPayoutPayer`, `claimPayoutRevealGroup`), `reimbursement-payout-reveal.use-case.ts`, `application/dto/reimbursement.mapper.ts`, `presentation/http/reimbursement.dtos.ts`.
- Web: `apps/web/src/features/reimbursements/` — `reimbursement-payout.logic.ts` (`paymentFormPayout`, `requestedPayout`, the texts), `ReimbursementPayout.tsx` (`ClaimPayoutCard` with `payStep`, `PayerConfirmationCheck`), `ReimbursementDetailSections.tsx` (`PaymentForm`, payment rows), `reimbursements.logic.ts` (`validatePaymentForm`, `savePaymentForm`, `paymentSaveErrorMessage`, `paymentFactsText`, `quickPayTarget`, `queueRowOffersPayment`, the no-branch step), `ReimbursementsPages.tsx` (`PaymentModal`, the queue buttons), `ReimbursementJourneyPage.tsx`.
- The three "Phase 1 seam" comments Phase 2 left (`PaymentForm`, `savePaymentForm`, the check before a payment number is reserved) are gone: the work sits where they were.
- Tests: `reimbursement.logic.spec.ts`, `reimbursement-finance.use-case.spec.ts`, `reimbursement-related-access.use-case.spec.ts`, `reimbursement.dtos.spec.ts`, `prisma-reimbursement.repository.draft-submit-race.spec.ts` (all registered in `apps/api/package.json`); web `ReimbursementPayStep.qa.spec.ts` (new), `reimbursements.payment-slip.spec.ts`, `ReimbursementPayout.qa.spec.ts`, `ReimbursementPaymentForm.qa.spec.ts`.

## Verification

Run at the lane head `fae12ff30` unless said otherwise, 2026-10-02.

- Typechecks, the package scripts: contracts, API (heap flag, 70 s) and web all exit 0. The native compiler (as CI) also passes for API and web.
- API, reimbursement module specs without a database: 698 tests, 650 pass, 0 fail, 48 skip (the real-PostgreSQL spec skips itself).
- Contracts tests: 343 of 343.
- Whole web suite `pnpm --filter @watchdog-bms/web test`: 2366 of 2366.
- Real PostgreSQL 18.3 (throwaway container, removed afterwards): the gate `test:reimbursement-compatibility` 51 of 51 with `REIMBURSEMENT_PG_GATE_REQUIRED=true`, of which four cases are new: one version from the real submit and approval to the payment record, with replay and void; the version check racing a concurrent account change (the loser is 409, the retry is `payout_destination_changed`, nothing is written); the payer recorded as verifier through the frozen-row trigger; a legacy claim's default copied, raced and the claim's hashes unchanged. `claim-payment-posting.pg.spec.ts` on a database of its own: 6 of 6.
- `migration:review` exit 0; `prisma validate` exit 0; `migrate deploy` from empty on PostgreSQL 18.3.
- Maintenance pins `--check`: current (no pinned file touched). W00 manifest parity: 4 of 4, no regeneration (no hashed file touched), so the LINE whole-chain acceptance was not needed.
- Mutation checks at `aabe9706c` (one edit, run the specs, restore): 11 of 11 killed in the API (stale version accepted, no confirmation, no reason, account number in the reason, the two replay comparisons, the check under the lock skipped, the payer never or always recorded as verifier, the reason in the audit row, the status helper), 17 of 17 on the web, and the check under the lock again against real PostgreSQL.
- Every web commit of the lane was checked out and run on its own: typecheck and the reimbursement specs pass at each.
- Browser, a throwaway local stack (my own PostgreSQL, Redis and MinIO containers; the API and `next dev` from this worktree at `aabe9706c`; the seeded QA accounts), driven by a Playwright script outside the repo, at 390 px and 1280 px: 38 steps pass. The payer's page for a transfer claim, a PromptPay claim, a cash claim, a legacy claim with and without a default; show and copy; another method asking why; a reader who may not see the number; quick pay at 390, 700 and 1280 px; and five real payments (a transfer with the tick refused first, a claim nobody had checked, cash for a transfer claim from the dialog, a legacy claim into the default, a legacy claim with no account). No page is wider than its screen. Screenshots: the coordinator scratchpad, `p1b-shots/`.
- On that stack, after the payments and eight reveals: a dump of the database and both server logs hold neither test number in plain text, bare or with dashes or spaces (the PromptPay number appears only in seeded CRM rows). The reason typed for a cash payment is in the payment row and nowhere else. Over real HTTP the refusals answer 409 or 400 as designed, and the reveal answers the payer and refuses a reader.

Not run: Playwright specs of `e2e/` (none were added), `test:boot` (the API of this branch booted and served the browser pass), the LINE whole-chain acceptance. Not checked in a browser: a 140-character account name (the wrapping classes are asserted in the web spec), a claim with no branch, a failed claim read in the dialog, a lost race.

## Merging

- The lane branch conflicts with the assembly head `c85a33308` in one place: the import block of `ReimbursementsPages.tsx`. The hub lane added `HUB_SEARCH_DELAY_MS` and `hubListStatusText` on the line above the one where this lane replaced `PAYMENT_DIALOG_MEDIA_QUERY` with `queueRowOffersPayment`. Keep both. Everything else merges by itself, the payment preflight included.
- The merge is done and tested on the local branch `claude/reimb-payout-p1b-merge-trial-20261002`. On that tree: API and web typecheck; 850 API tests of the reimbursement module and of what the assembly touched (795 pass, 55 skip without a database); the whole web suite 2382 of 2382; the real-PostgreSQL gate 58 of 58; the claim payout posting spec 16 of 16 on a database of its own.
- After checking out the other branch in the same worktree, build contracts again (`pnpm --filter @watchdog-bms/contracts build`): the web resolves contracts through `dist`.

## Next

- Coordinator: merge into the assembly (one import-line conflict, see "Merging"), then the round's PR.
- Decide the hub "payout blockers" and say what it counts.
- Phase 4 (plan 4.3): the paid notice names the method actually paid and the last 4 digits (AC37, the notice half of AC21).
- E2E: REIMB specs for the pay step (transfer with the tick, another method with a reason, a legacy claim with and without a default, `?pay=1` from the phone cards).
- Release note: a transfer into a claim's account is refused without the tick; a page opened before the release reads "load the latest".
