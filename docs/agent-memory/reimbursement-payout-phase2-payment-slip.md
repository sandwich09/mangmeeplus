# Agent Memory: reimbursement payout Phase 2 (payment slip at the payment step, and moving misfiled slips)

Status: implemented and reviewed. Phase 2 was merged with Phase 0 on `claude/reimb-payout-assembly-20261001` (head `79ecff16`); the review and impact-audit follow-up is on `claude/reimb-payout-p2-followup-20261001`, cut from that head. Not pushed, no PR. E2E not run.

Owner: Claude, Phase 2 lane. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: Phase 2 of `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` plus its items 0.4 and 0.5 (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §11.4, §12, §16, §20). The program's own memory file is `docs/agent-memory/reimbursement-recipient-bank-account.md`; Phase 0 keeps `reimbursement-payout-phase0-ui-fixes.md`. This file is the Phase 2 lane's record. Not in scope and untouched: hub cards and paging, `paymentDesk`, the policy warning, approval queue buttons, `sync-permissions` (Phase 0), and the payout account itself (Phase 1).

## Decisions

Owner decisions of 2026-10-01 that this lane implements:

- A payment recorded as a bank transfer must carry a slip. Other methods may. The API enforces it; the form is only a helper. One function decides for both: `reimbursementPaymentSlipRequired` in contracts.
- The payment form selects no method. The payer chooses.
- A slip is opened by the requester, the claim's approver, holders of the payment-record right, and holders of the finance-review right. Nobody else.
- A slip is payment evidence. It never counts as an expense receipt or a signed claim copy, and the generic attachment download serves it to nobody.
- A slip attached by mistake through "ใบเบิกที่เซ็นแล้ว" can be moved to the payment without uploading it again. The move withdraws the "signed on paper" declaration made with that file.
- Voiding keeps the slip with the voided payment. A new payment needs a slip of its own; the earlier slip of the same claim may be chosen again.

Design decisions:

- **Where a slip lives.** An `AttachmentLink` with `targetType = reimbursement_payment`, `purpose = reimbursement.payment.slip`. The payment row also keeps the first slip's id and checksum (`slipAttachmentId`, `slipChecksumSha256`, both nullable) so a replay can be compared. A slip upload is tagged `generatedFor = reimbursement_payment_slip` with its claim id, the way a signature upload is tagged.
- **Three things can be a slip.** The payer's own slip upload for that claim, a file attached to that claim as a signed copy (the misfiled slip), or a slip of an earlier payment of the same claim. Anything else is `payment_slip_invalid`.
- **A slip is an exclusive link.** A file is accepted as a slip only when every link it has is the kind its source allows and no claim line names it as a receipt. `findAttachmentLinkConflict`, the check every link write goes through, refuses any link onto a file that carries the slip link or the slip upload tag. The signed-copy link takes the file's retention lock and re-checks inside its transaction. A slip is also refused as a claim-line receipt when the line is saved.
- **One viewer rule.** `canOpenReimbursementPaymentSlip` (contracts) is used by the slip download guard and to compute `viewerCanOpenSlips` on every payment of every claim detail. The web's "ดูสลิป" button reads only that verdict. `detailWithFileNames` requires the viewer, so no route can return a claim detail without deciding it.
- **File ids follow the same verdict.** Each payment carries `slipCount` for every reader and `slips` (file ids) only for a viewer who may open them.
- **Whose approval counts.** `isReimbursementClaimApprover`: an approved, non-invalidated step decided at or after the claim's current `submittedAt`. Only PENDING steps are invalidated on resubmission, so "the latest approved step" kept naming the approver of an earlier round. This is the journey page's own rule (*2026-10-01:* the journey page now calls this function instead of keeping a copy, `reimbursement-payout-hub-bank-fixes.md`). `isReimbursementPayoutParty` builds on it and is the single rule Phase 1 reuses for the account-number reveal.
- **Replays.** A replay is the same payment only when amount, currency, method, date, reference, bank account and slip all match. A replay naming a different slip, or the key of a payment since voided, is a conflict.
- **Lost races.** A payment, slip attach or void rolled back by PostgreSQL for a serialization conflict answers 409 `reimbursement_payment_state_changed`, not 500. `isSerializationFailure` reads P2034 and the raw-statement shape (P2010 with SQLSTATE 40001). The global exception filter is unchanged.
- **Bank match.** Voiding a payment with a CONFIRMED bank reconciliation match is refused (`reimbursement_payment_bank_matched`) until the match is undone. *Changed 2026-10-01 (`reimbursement-payout-hub-bank-fixes.md`):* the bank screen does not list a fully matched line, so that match could never be undone. The void now undoes the match itself and refuses only a line inside a completed reconciliation (`reimbursement_payment_bank_reconciled`).
- **Phone.** Below the `sm` width the finance queue's quick pay opens the claim page with the form already open in the payment step card (`?pay=1`). The dialog stays from `sm` up, and its form mounts once the claim detail has loaded.
- **Print.** The form prints the Thai calendar day of each instant. No stored hash depends on the renderer.

## Open questions

- **Orphan slip uploads have no sweeper.** A slip uploaded and never recorded with a payment (the payer abandoned the form, or saving failed and was not retried) stays stored and ACTIVE. It is unreadable by anyone: the generic download refuses the slip tag, no link can be written onto it, it cannot be a claim-line receipt or a signed copy, and the slip endpoint serves only linked slips. Its id is returned only to the person who uploaded it. Follow-up: decide whether to sweep tagged files that are older than a set age and have no link. Not built here on purpose.
- **A generic link written in the same instant as a slip link is not mutually excluded.** The generic link writers take no file lock. Each side's check closes every order that is not simultaneous. Closing it fully means every link writer taking the retention lock.
- **A bank match confirmed in the same instant as a void** can still slip through: the confirm side does not lock the payment. *Closed 2026-10-01 (`reimbursement-payout-hub-bank-fixes.md`):* the confirm reads the payment under the void's lock in a serializable transaction; real PostgreSQL proves both orders.
- **The 10 MB limit applies to new slip uploads only.** A file moved from the signed copies keeps its size (signed copies allow 25 MB).
- **Timeline and notification text** do not mention the method or the slip. That is Phase 4 (plan 4.3) and the Phase 0 lane's wording.
- **E2E.** `REIMB-08` to `REIMB-11` are written and type-checked, not run. No E2E covers the phone route (`?pay=1`).
- **Legacy claims.** The slip rule applies to them from the day this ships: a payer in the middle of paying an old claim by transfer is refused until a slip is attached. Needs a release note.

## Artifacts

- Migration: `apps/api/prisma/migrations/20261001130000_reimbursement_payment_slip/` (two nullable columns on `ReimbursementPayment`).
- Contracts: `packages/contracts/src/reimbursements.ts` (`reimbursementPaymentSlipRequired`, `isReimbursementClaimApprover`, `isReimbursementPayoutParty`, `canOpenReimbursementPaymentSlip`, `slipCount`, `viewerCanOpenSlips`).
- API, reimbursements: `reimbursement-payment-slip.use-case.ts` (four use cases), `reimbursement-finance.use-case.ts`, `reimbursement.mapper.ts`, `prisma-reimbursement.repository.ts` (`recordPaymentAtomic`, `resolvePaymentSlip`, `linkPaymentSlip`, `attachPaymentSlipAtomic`, `linkSignedClaimFormCopy`, `voidPaymentTrueReversal`), `reimbursement-evidence.service.ts`, `claim-form.logic.ts`, `reimbursement.controller.ts`.
- API, shared: `data-model-core/domain/logic/attachment.logic.ts` (`findAttachmentLinkConflict`, `isReimbursementPaymentSlipFile`), `create-download-url.use-case.ts` (hash-pinned), `delete-attachment.use-case.ts`, `prisma-attachment.repository.ts`, `common/database/prisma-error.ts` (`isSerializationFailure`).
- Routes under `/companies/:companyId/reimbursements`: `POST :requestId/payments/slip-upload-intent`, `POST :requestId/payments/slip-uploads/:attachmentId/complete`, `POST :requestId/payments/:paymentId/slips`, `GET :requestId/payments/:paymentId/slips/:attachmentId/download-url`. `POST :requestId/payments` takes `slipAttachmentId`.
- Web: `apps/web/src/features/reimbursements/` — `ReimbursementDetailSections.tsx` (`PaymentForm`, payment rows, signed-copy section), `reimbursements.logic.ts` (`savePaymentForm`, `slipTargetPayment`, `quickPayTarget`), `ReimbursementsPages.tsx` (`PaymentModal`), `ReimbursementJourneyPage.tsx`, `reimbursements.api.ts`; `common/api/api-error-message.ts`.
- Docs: `docs/specs/permission-matrix.md` (payment slip routes and readers), the transfer FAQ in the user guide.
- Seam for Phase 1: three "Phase 1 seam" comments (`PaymentForm`, `savePaymentForm`, and the pre-reservation check in `RecordReimbursementPaymentUseCase`). The record use case builds one payment facts object that feeds `isSamePaymentRequest` and the repository; Phase 1 adds its fields there.

## Verification

Follow-up branch head, 2026-10-01. Run:

- Typecheck (native TypeScript, as CI): api, web and contracts pass.
- Touched API unit specs, each run on its own: pass (finance, related-access, claim-signature, approval, request, void-reversal, payment-mirror, claim-form logic and use case, reimbursement logic, write-quiesce guard, attachment logic, attachment repository, and the specs of every other module that reaches the shared link check).
- Touched API unit specs at head: 22 files, 517 tests, 0 fail.
- Real PostgreSQL 18.3 (throwaway container): the plan's gate `test:reimbursement-compatibility` 30 of 30 at head, of which `prisma-reimbursement.repository.draft-submit-race.spec.ts` is 27, including slip exclusivity, the signed-copy race in both orders, the 409 answer for a lost race, and the bank-match void rule. Mutation check: with the row write in `linkSignedClaimFormCopy` removed, the race spec fails.
- Web suite `pnpm --filter @watchdog-bms/web test`: one full run, 2267 of 2268. The one failure was this lane's (the raw-error scanner on the form's refusal field); fixed, and that file with the two touched specs rerun: pass. The full suite was not run again after that fix.
- Maintenance pins `--check`: current (no hash-pinned file touched in the follow-up). W00 manifest parity: 4 of 4, no regeneration. `prisma validate`: valid. No schema or migration change in the follow-up.
- E2E spec: type-checked only.

Not run: Playwright, a browser pass at 390 px, live HTTP, the LINE whole-chain acceptance (no AI text changed).

## Next

- Coordinator: integrate with Phase 1, then one PR for the round.
- Phase 1 lane: reuse `isReimbursementPayoutParty` for the account-number flag; add the payer confirmation at the three seams. (Part A is merged: the reveal group takes its approver answer from `isReimbursementClaimApprover`, the rule under `isReimbursementPayoutParty`, and keeps its own conditions. The three seams wait for part B.)
- Phase 4: timeline and notification wording for method and slip; the rest of the user guide.
- Decide on a sweeper for orphan slip uploads.
- Release note: the slip rule applies to claims approved before the feature.
