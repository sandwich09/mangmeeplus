# Agent Memory: reimbursement payout round wording (the words of a send-back round)

Status: Part A (spec, contracts, API, the assistant's tools, the capability manifest) done on `claude/reimb-payout-round-wording-20261002`, from `origin/develop` at `603f461dd`, not pushed. Part B (web and its specs, the user guide and its pin, the e2e texts, the spec's web sections) is done on the same branch, 16 commits after Part A's head `7c641d21a`, not pushed. Part N (notification recipients, the notice to a requester when someone answers for them) is on its own branch.
Owner: payout lane (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §14.2, §14.3, §14.5, §14.6, §14.9, §17.1 to §17.3, §18.5, §18.6).
Scope: an approved claim that waits for payment can be sent back so that its requester gives the payout destination again and its approvers approve it again. Every word of that round was written for one case, a wrong account replaced by another account. The words now follow what the claim held when it was sent back (an account, cash, nothing) and what was answered (seven cases), and say who answered when it was not the requester. The owner's standard: every sentence a person reads must be true in the case they are in.

## Decisions

- Two facts choose every word, never the phase alone and never the reason code: what the claim HELD at the send-back, and what was ANSWERED against what the round began with.
- One name per thing: a claim's account is "บัญชีรับเงิน"; the method is "วิธีรับเงินคืน" everywhere; "บัญชีรับเงินคืน" names only a member's standing account.
- "The same destination" is decided once, in the transaction that takes the answer, and kept on the round's log entry (`sameAsApproved`). An entry without the key reads as not the same. No migration: one key in the existing JSON column `payoutCorrectionLogJson`.
- Reasons by what the claim holds: six for an account (five for a PromptPay number, which has no bank), three for cash with two new codes (`CASH_NOT_PAYABLE`, `REQUESTER_ASKED_METHOD`), one for a claim with no account (`NO_ACCOUNT_ON_CLAIM`, and not "อื่น ๆ"). From the waiting step the list is that of the answer not taken. The refusal code is unchanged.
- The two notices take their title and their body from the event; the catalog templates assemble no sentence.
- No sentence says the requester did what someone else did for them (a finance reviewer may answer for the requester): the row, the detail and the history event say who answered, and the sentences take that.
- The assistant's tools gain and lose no field. The desk row of claims that wait for their requester is one row per label. The note of a claim that holds an account now says "บัญชีรับเงิน" (it said "บัญชีรับเงินคืน"); the evaluation case that reads it (R-23) is to be run again.

## The words, as the code returns them

By what the claim holds (with its requester, the pay step, every send-back):

| Held | Status | Asked of the requester | Send-back phrase | Notice title | Reasons |
|---|---|---|---|---|---|
| an account | รอผู้เบิกแก้บัญชีรับเงิน | แก้บัญชีรับเงิน | ส่งกลับให้แก้บัญชีรับเงิน | ใบเบิกต้องแก้บัญชีรับเงิน | เลขบัญชีไม่ถูกต้อง · ชื่อบัญชีไม่ตรงกับผู้เบิก · ธนาคารไม่ถูกต้อง (not for PromptPay) · บัญชีปิดหรือโอนไม่ได้ · ผู้เบิกขอเปลี่ยนบัญชี · อื่น ๆ |
| nothing | รอผู้เบิกเพิ่มบัญชีรับเงิน | เพิ่มบัญชีรับเงิน | ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน | ใบเบิกต้องเพิ่มบัญชีรับเงิน | ใบนี้ยังไม่มีบัญชีรับเงิน |
| cash | รอผู้เบิกเลือกวิธีรับเงินคืน | เลือกวิธีรับเงินคืน | ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง | ใบเบิกต้องเลือกวิธีรับเงินคืนอีกครั้ง | จ่ายเป็นเงินสดไม่ได้ · ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน · อื่น ๆ |

The notice body is "เหตุผล: {reason} · เปิดใบเบิกเพื่อ{asked}".

By the answer (waiting for approval, the approval, the history):

| Began with | Given | Answer | What was done (the requester) | The same, by someone else | The thing approved | Status and notice title |
|---|---|---|---|---|---|---|
| an account | another account | `NEW_ACCOUNT` | ผู้เบิกแก้บัญชีรับเงิน | {ชื่อ} แก้บัญชีรับเงินแทนผู้เบิก | บัญชีรับเงินใหม่ | รออนุมัติบัญชีรับเงินใหม่ |
| an account | the same account | `SAME_ACCOUNT` | ผู้เบิกยืนยันบัญชีเดิม | {ชื่อ} ยืนยันบัญชีเดิมแทนผู้เบิก | บัญชีรับเงินเดิม | รออนุมัติบัญชีรับเงินเดิม |
| an account | cash | `CASH_INSTEAD` | ผู้เบิกเปลี่ยนวิธีรับเงินคืน | {ชื่อ} เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก | การรับเป็นเงินสด | รออนุมัติการรับเป็นเงินสด |
| cash | an account | `ACCOUNT_INSTEAD` | ผู้เบิกเปลี่ยนวิธีรับเงินคืน | {ชื่อ} เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก | บัญชีรับเงิน | รออนุมัติบัญชีรับเงิน |
| cash | cash | `SAME_CASH` | ผู้เบิกยืนยันวิธีรับเงินคืนเดิม | {ชื่อ} ยืนยันวิธีรับเงินคืนเดิมแทนผู้เบิก | การรับเป็นเงินสด | รออนุมัติการรับเป็นเงินสด |
| nothing | an account | `FIRST_ACCOUNT` | ผู้เบิกเพิ่มบัญชีรับเงิน | {ชื่อ} เพิ่มบัญชีรับเงินแทนผู้เบิก | บัญชีรับเงิน | รออนุมัติบัญชีรับเงิน |
| nothing | cash | `FIRST_CASH` | ผู้เบิกเลือกวิธีรับเงินคืน | {ชื่อ} เลือกวิธีรับเงินคืนแทนผู้เบิก | การรับเป็นเงินสด | รออนุมัติการรับเป็นเงินสด |

The approvers' notice body is "ยอด {amount} บาท · รอคุณตรวจและอนุมัติ{the thing approved}". Without the fact: "รอผู้เบิกเลือกวิธีรับเงินคืน", "รออนุมัติวิธีรับเงินคืน".

## What Part A built

Contracts (`packages/contracts/src/reimbursements.ts`):

- Facts: `ReimbursementPayoutHeld` and `reimbursementPayoutHeld(claim)`; `ReimbursementPayoutRoundAnswer` and `reimbursementPayoutRoundAnswer(start, given, sameAccount)`; `ReimbursementPayoutRoundAnsweredBy` (`byUserId`, `byName?`, `onBehalf?`).
- Fields: `payoutCorrectionAnswer` and `payoutCorrectionAnsweredBy` on a row and a detail (waiting for approval only); `held`, `answer`, `onBehalf` on a `payoutCorrectionHistory` event.
- Words: `reimbursementPayoutRoundStatus(claim)`, `reimbursementPayoutRoundAsk(held)`, `reimbursementPayoutRoundSendBack(held)`, `reimbursementPayoutRoundDid(answer, answeredBy)`, `reimbursementPayoutRoundApproves(answer)`, `reimbursementPayoutRoundApproverNote(answer, answeredBy)`, `reimbursementPayoutRoundGivenNote(answeredBy)`, `reimbursementPayoutRoundCashNote(answeredBy)`, `reimbursementPayoutSentBackNotice(held, reasonCode)`, `reimbursementPayoutAnswerNotice(answer)`, `reimbursementPayoutCorrectionReasons(held, payoutKind)`, and the table `REIMBURSEMENT_PAYOUT_ROUND_TEXTS` (`held`, `given`, `answer`).
- Kept for the web until Part B and deleted by it: `REIMBURSEMENT_PAYOUT_CORRECTION_PHASE_LABELS`, `reimbursementPayoutCorrectionAsk`, the `boolean` overload of `reimbursementPayoutCorrectionReasons`.

API:

- `domain/logic/reimbursement.logic.ts`: `payoutCorrectionFacts(log, requesterUserId)` is the ONE reading of the round's log (what was held at each send-back, what each answer was, whether it was given for the requester); `payoutCorrectionHeld`, `payoutCorrectionAnswer`, `payoutCorrectionAnsweredBy`, `payoutCorrectionStatusLabel`, `payoutCorrectionRequesterDesk`.
- `infrastructure/reimbursement-payout.ts`: `payoutCorrectionKeptDestination`; `infrastructure/prisma-reimbursement.repository.ts` (`submitPayoutCorrectionAtomic`) writes `sameAsApproved` and hands the answer to `onPersisted`.
- `application/dto/reimbursement.mapper.ts`: the two fields on rows and details; `sameAsPrevious` from the answer; the read-time comparison is gone.
- `application/use-cases/reimbursement-request.use-case.ts` (`payoutCorrectionHistoryOf`): the facts on the events.
- `application/use-cases/reimbursement-approval.use-case.ts` (`sendBackForPayoutCorrection`): reasons by what the claim holds and by the account kind; the event carries `payoutCorrectionTitle` and `payoutCorrectionNotice`.
- `application/use-cases/reimbursement-payout-correction.use-case.ts`: the answered event carries `payoutAnswerTitle` and `payoutAnswerNotice`.
- `workflow/domain/workflow-template-catalog.ts`: the two templates print those keys.
- `domain/logic/claim-form.logic.ts`, `application/use-cases/reimbursement-claim-form.use-case.ts`: the printed line is "รับเงินคืนทาง: {status label}".
- `application/use-cases/reimbursement-summary.use-case.ts`, `line-ai/application/use-cases/erp-core-detail-tools.use-case.ts`: the assistant's two tools; `docs/research/mangmee-ai-capability-manifest-2026-09-27.json` regenerated.
- `application/use-cases/reimbursement-payout.use-case.ts`: the notice of an account typed for someone says "บัญชีรับเงิน".

## Open questions

- The unregistered spec `reimbursement-approval-backlog.use-case.spec.ts` is not in the API `test` script. Its pins were updated and it passes by hand; nothing was added to it. Registering it needs a `package.json` edit, which the owner decides.
- "ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี" on the card of a cash claim is also untrue outside a round, when a preparer chose cash on a draft filed for someone else. No fact on the detail says who chose cash there. In a round `reimbursementPayoutRoundCashNote` covers it.
- Found by Part B's look and not fixed (contracts or API words): a PromptPay claim's send-back form offers "เลขบัญชีไม่ถูกต้อง" and its number has the button "แสดงเลขบัญชี", where the entry form says "เบอร์พร้อมเพย์"; the send-back form's second line presumes the kind of answer ("เมื่อผู้เบิกแก้แล้ว …", "เมื่อผู้เบิกเพิ่มแล้ว …") although the requester may choose cash; the pay-step sentence for a reader who cannot pay speaks of "ผู้เบิก" to the requester themself.
- The guide's row for the notice to a requester when someone answers for them describes the notice without quoting its titles: the literals are on the notification branch. Quotes can be added after the merge; the guide's quote check then finds them in contracts.
- In the requester's list card a long reason ends in an ellipsis (one line, as that card was written); the approval and pay queue cards wrap it over two lines.
- The requester is not told when someone answers for them with cash, the default account or the former account (Part N).

## What Part B built

Web (`apps/web/src/features/reimbursements/`), reading Part A's facts and functions only (no screen builds a sentence of the round from a phase or a reason code):

- `reimbursements.model.ts`: `claimStatusBadge(claim)` prints `reimbursementPayoutRoundStatus(claim)`; `StatusBadge` takes the whole claim.
- `reimbursement-payout.logic.ts`: `payoutRoundTexts(claim)` (contracts' texts by what the claim holds), `payoutCorrectionSendBackTitle`, `payoutCorrectionAnswerWords(claim, forSelf)`, `payoutRoundAnswer`, `payoutCorrectionAnsweredText(answer, answeredBy)`, `PAYOUT_CORRECTION_SAVE_LABEL` ("บันทึกวิธีรับเงินคืน"), `claimCashNote(detail)` (who chose cash), `payoutCorrectionReasons(detail)` (by held and account kind); `claimPayoutView` and `claimPayoutHistory` show a kept account once (the copy joins the row of the account it copies, "{who} ยืนยันบัญชีเดิม เมื่อ …", never "ยังไม่มีผู้ตรวจบัญชีนี้"); the closing messages of a refused press; the copy label "สำเนาก่อนส่งกลับ".
- `reimbursements.logic.ts`: the step notes of both phases (the requester, whoever answers for them, the approvers, a reader), the approvers' card (`title`, `labels` by answer), the journey rows from `held` / `answer` / `onBehalf`, the queue button "ตรวจ{สิ่งที่รออนุมัติ}", the notes of set-aside approval steps, the journey's "ตรวจการเงินแล้ว โดย …".
- `ReimbursementPayoutCorrection.tsx`: the send-back form (one reason is stated, test id `reimbursement-payout-correction-reason`), the answer form.
- `ReimbursementPayout.tsx`, `ReimbursementDetailSections.tsx`, `ReimbursementJourneyPage.tsx`: the pay-step line (no "อย่าเพิ่งจ่าย" for a reader who cannot pay), the signing note, the toasts.
- `ReimbursementsPages.tsx`: the pay queue's finance line per claim in a company with no finance step, its counter; the card lists' one column is named (`grid-cols-1`), found by the look at 390 px.
- `apps/web/src/common/api/api-error-message.ts`: the refusal sentences of a round, and `payout_destination_required`.
- `apps/web/src/features/user-guide/reimbursement-guide.content.ts` (sections `status`, `account-fix`, `notify`, `old-claims`, `faq`) and its spec (no exception list); the pin in `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` is `7ad4b343c1abc3662991b58ce4c4e529c5c79a39d3007bd76c818701faac2d83`. No card body changed; the two cards that cite the guide (`reimbursement.meaning`, `reimbursement.roles`) cite sections that were not touched.
- Contracts: the three deprecated exports are deleted.
- `e2e/reimbursements.spec.ts`: REIMB-12, REIMB-14, REIMB-15 texts.

Done differently from the wording table, and why:

- The note of a set-aside approval step ends "… ถูกส่งกลับ หรือมีการเลือกอีกครั้ง" (the table's "… หรือผู้เบิกส่งมาอีกครั้ง" names the requester when someone else answered).
- The guide's status meanings do not say who answered, for the same reason.
- The kept account's history line is the contracts sentence of who did it ("ผู้เบิกยืนยันบัญชีเดิม เมื่อ …", or "{ชื่อ} ยืนยันบัญชีเดิมแทนผู้เบิก เมื่อ …"), not the table's "ผู้เบิกยืนยันบัญชีนี้อีกครั้งเมื่อ …".
- A company that HAS the finance step shows the pay queue as before (every row has its finance words); the change is for a company without the step.

## Artifacts

- Part B commits, in order: `32326c6cb` status label, `25966ae70` the send-back, `fb0ec1862` the requester's side, `0673b9b3f` the approvers' side, `378db9614` the card and the kept account, `eec4fb730` signing and the copy label, `b76f9b4cf` refusals, `85efcd209` pay queue, `6742b2355` finance row of the journey, `166cd8d27` contracts aliases removed, `a118c0000` and `60a0cd5de` guide and pin, `1f9369a3c` e2e texts, `1242f80d6` spec, `aa7d856d0` hub card width, then this note.
- Part A commits on the branch, in order: `12c223d1c` spec, `a0d700582` contracts, `7e0065906` facts, `6d8f14116` reasons, `0aa044062` notices, `20accffeb` one name in the typed-account notice, `9f082f62b` printed form, `c3891076d` assistant tools, `bea0b04cd` manifest, `9a940f796` the assistant's note, `cab02e7e1` who answered, then this note.

## Verification

Run on 2026-10-02 at `cab02e7e1`.

- Contracts: build, and the package's tests 344 of 344.
- Typechecks by the package scripts: API (heap flag) exit 0, web exit 0. The web compiles with the three deprecated exports.
- API `test` script, whole: exit 0, no failure.
- Real PostgreSQL 18.3 in REQUIRED mode (`REIMBURSEMENT_PG_GATE_REQUIRED=true … test:reimbursement-compatibility`), a throwaway container migrated from empty: 102 of 102, none skipped (101 before; one case new, five extended).
- Registered API specs of the touched areas (50 files): 1429 tests, 1330 pass, 99 skip without a database, none fail.
- New and changed tests against the production code of `603f461dd` with this branch's spec files: 26 new tests, 26 fail there; 18 changed tests, 16 fail there (the two that pass changed a comment, and a reason code the base also takes).
- Capability manifest parity 4 of 4 after regeneration; `node scripts/run-line-ai-whole-chain-acceptance.mjs` exit 0, 12 suites.
- Maintenance pins `--check`: current, no pinned file touched. `git diff --check` clean. No `package.json` edit, no migration, no model call.

Part B, run on 2026-10-02 at `aa7d856d0`.

- Typechecks by the package scripts: web exit 0, API (heap flag) exit 0 after the alias removal, AI gateway exit 0. Contracts: build, tests 344 of 344.
- Whole web suite: 2627 tests, 2627 pass (2598 with 2 failing before Part B).
- Approved-knowledge spec 9 of 9; guide spec 11 of 11; capability manifest parity 4 of 4 (no hashed web file changed, so the manifest did not move and the whole-chain script was not needed).
- New and changed web tests against the web code of `7c641d21a` with this branch's spec files: 43 tests new by name, 41 fail there; the 2 that pass are old assertions under a new name (one renamed, one split out of an existing test). 40 tests that kept their name fail there. Of those failures 3 are a missing function, the rest assert words.
- A real look on a throwaway stack (own containers, removed after), 82 looks: every case of a round at 390 px (an account answered with another account, with the same account, with cash; a cash claim answered with cash and with an account; a claim with nothing answered with an account and with cash; an answer typed and a cash choice made for the requester by a finance reviewer; a PromptPay claim's send-back form; an answer sent back again), the pay queue with one claim that passed a finance review among claims that never had the step (cards at 390 px, table and payment dialog at 1536 px), the hub lists. Nothing wider than the screen and no text outside it. One defect found and fixed (`aa7d856d0`).
- `e2e/reimbursements.spec.ts` 17 of 17 and `e2e/settings.spec.ts` 20 of 20, each on a freshly reset stack.
- Maintenance pins `--check`: current. `git diff --check` clean. No `package.json` edit, no API file touched, no migration, no model call.

## Next

- Part N: the notice recipients, and the notice to a requester when someone answers for them.
- The real-model run of the assistant's reads of a round, R-23 included.
