# Agent Memory: reimbursement payout, wording and layout pass over the claim screens

Status: done on `claude/reimb-payout-p3-correction-round-20261002` (worktree `/private/tmp/mangmee-reimb-p3-20261002`), from `7b8bd7e0d`. Not pushed, no PR. The branch also carries the merges of `claude/reimb-payout-guide-20261002` and `claude/reimb-payout-final-fixes-20261002`.
Owner: polish lane (web, e2e, the claim guide, docs). No API file, no `package.json`.
Scope: the claims hub and its queues, the claim page at each step, the policy tab, the role page, the signature page where a claim sends a signer there, the claim guide and its pin. Decisions are recorded in the payout spec §18.5 (and §14.5, §17.2).

## The owner's model every string agrees with

A claim has a requester and an approver, and the approver records the payment. "ฝ่ายการเงิน" exists only where a company turned the finance-review step on. Plain Thai: no ids, enum words, English or currency signs; money as "1,234.50 บาท". Phone first: 390 px, no page-level sideways scroll, 44 px tap targets.

## Findings

| # | What | Result |
|---|---|---|
| 1 | Role page description of "อนุมัติการเบิก" | Not done: the sentence is served by the API (`capability-pack.registry.ts`, `pack.reimbursement.approve`). Web only renamed the module heading on the role page to "การเบิกจ่าย" |
| 2 | Third hub tab | "คิวรอจ่าย" where the finance step is off, "คิวการเงิน" where it is on; read from the policy endpoint, follows a policy save without a reload. Holders of the finance-review right who cannot read the policy still read "คิวการเงิน" (API) |
| 3 | Two sentences that said finance pays or edits | Reworded |
| 4 | One thing, one name | "ผู้เบิก", "ตั้งค่านโยบาย", "ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้", "แอดมิน"; the printed form keeps its words |
| 5 | "SLA" | "เกินกำหนด", "กำหนดเวลาอนุมัติและจ่าย (ชั่วโมง)", card "การเงินและกำหนดเวลา" |
| 6 | Duplicate mark on approval rows | Badge "อาจซ้ำ" on the row and the card |
| 7 | Missing-signature dialog | "ยังไม่มีลายเซ็นของคุณ": save one, it signs at once; no error toast beside the dialog |
| 8 | Hub tables | A table only where the list's own box is wide enough (mine 80rem, approvals 70rem, third tab 58rem), cards below, two columns from 44rem |
| 9 | Lost race in a correction form | The page reads the claim again; a form still offered stays, one no longer offered closes with what was not done and where to look |
| 10 | Two journey rows that read alike | Each account-given row names what it gave (bank and last 4 digits, or cash); rows still alike on one day show their time |
| 11 | e2e approver and cases | REIMB cases approved by the role the policy routes to; 17 of 17 pass |
| 12 | Statuses "เพิกถอน", "จ่ายบางส่วน" | Nothing changed, as told |
| 13 | Send-back beside the pay button | A line of text at the foot of the account box; on a claim with no account "เพิ่มบัญชีรับเงินให้ใบนี้ แล้วให้ผู้อนุมัติตรวจใหม่" |
| 14 | Slip picker | A list: what each file is, "เปิดดูไฟล์นี้", pictures before PDFs, the chosen file named |
| 15 | Misfiled e-slip after paying | The row says picture or PDF, and tells whoever pays what to do before and after the payment |
| 16 | Edit page subtitle | "ตามเหตุผลที่ส่งกลับ" only for a draft that was sent back, with the reason on the page |
| 17 | Approver block with no approver | Not shown on a claim that needed no approval |
| 18 | Signature page | `?fromClaim=` carries the claim; "กลับไปที่ใบเบิก" before and after saving; no red message stays |

Follow-ups of the server lane, on the web: the correction form offers "ใช้บัญชีเดิมของใบนี้" (`mode: 'PREVIOUS'`), sends `expectedUpdatedAt`, closes a form whose claim changed, drops the typed-account choice once the server refuses it for a requester who is no longer active, and the void dialog shows the account-number refusal at its field.

Seen in the real look and fixed: hub totals as "7,219.50 บาท"; no finance row on a claim that passes no review; "ตั้งแต่ 1.00 บาท" in the policy summary; a refused approval answered once by the screen that asked, above a queue read again; five kinds of tap targets under 44 px.

## Left for the API

As the pass left it. Every item but the undo of a slip move is closed in the last section of this note.

- The description of `pack.reimbursement.approve` ("ดูและอนุมัติ/ปฏิเสธคำขอเบิก") does not say the pack records and voids payments.
- `financeReviewRequired` for holders of `reimbursement.finance_review` who cannot read the policy (the third tab's name).
- Approve or reject on a claim that no longer waits for approval answers 422 with an English message and no code.
- After approval a possible duplicate reads `duplicateStatus: NO_MATCH` while `duplicateBlocksPayment` is true: the pay queue row has no mark and its count is 0.
- The detail does not say whether the account given in a round is the same account as before (the comparison shows two identical masked accounts after "ใช้บัญชีเดิมของใบนี้").
- The detail does not say the requester is no longer active: the account form learns it from the refusal.
- A slip cannot be taken off a payment, and a file moved out of the signed copies cannot be moved back with its declaration.
- A file cannot be withdrawn from the signed copies, nor its declaration alone (the attach-slip call does take it as a further slip; the page offers that only for a payment with no slip, by spec §16.2).
- The six send-back reasons all speak of a wrong account; a claim with no account has none that fits.

## Not in this lane, seen in the look

- Role page (`PermissionMatrixPrototypePage`): the permission table is 820 px in a box of 356, 666, 710, 677 and 613 px at 390, 700, 768, 1024 and 1280 px, so four of its five action columns need a sideways scroll at every width. Its role list shows "Company owner" and the description "Accounting access" in English (seed data), pack descriptions carry "audit", "dead letter", "webhook" (API), and its builder has two inputs and a button 40 px high at 390 px.
- `next dev` logs a CSP refusal for one script chunk on that page.
- The default label of a saved signature ends in an ISO date ("… 2026-10-02").
- Dashboard card "เกิน SLA" (`card.sla_breaches`), read by `e2e/daily-brief.spec.ts`.
- e2e SET-08E stops on the expense manual page ("กรุณาเลือกสาขาของรายการ") before it reaches the claim screens.

## Artifacts

- Screens and page text: `scratchpad/polish-shots/` (263 screenshots, 251 text files): `off--*` without the finance step (owner, manager, staff), `on--*` with it (finance reviewer, owner, accountant), `extra--*` the states reached by pressing something.
- Scripts and logs of the throwaway stack: `scratchpad/polish/` (`look.ts`, `extra.ts`, `setup.ts`, `logs/`).

## Verification

At `aac0045cf` (the last commit that changes code; this note is the only commit after it):

- Web suite 2563 of 2563. User-guide spec 10 of 10. Plain-Thai QA specs (`ReimbursementPages.plain-thai.qa.spec.ts`, `ReimbursementDraftActionPage.qa.spec.ts`) 57 of 57. `approved-knowledge.spec.ts` 9 of 9. W00 manifest parity 4 of 4. Maintenance pins current. `node scripts/run-line-ai-whole-chain-acceptance.mjs` rc 0. `git diff --check` clean.
- Typechecks: web and `e2e/reimbursements.spec.ts` through the native compiler, rc 0; contracts by the package's own build, rc 0 (the native compiler refuses that package's `baseUrl`, which is the tool and not the code).
- e2e on the lane's own stack (Playwright, chromium): `e2e/reimbursements.spec.ts` 17 of 17 (9 of 14 at the start of the pass; REIMB-13, 14 and 15 are new), `responsive.spec.ts` "/reimbursements — INV-7" desktop passes and its mobile half skips by the spec's own condition. `settings.spec.ts` SET-08E fails before it reaches a claim screen (see above).
- The real look, on a fresh throwaway stack at `ebd3dbd91`, then the four link widths of `a7a6b2463` measured again: 160 pages without the finance step and 45 with it at 390, 700, 768, 1024 and 1280 px, and 25 interaction steps. No page wider than its screen. No tap target under 44 px on a claim screen at 390 px.
- Table widths against their box: the three hub lists are cards at 1280 px and below (box 901, 645, 678, 634, 324 px at 1280, 1024, 768, 700, 390 px; two columns of cards at 901 px), and tables that fit from 1366 px (third tab: 987 in 987, with or without the review column), 1536 px (approvals: 1157 in 1157) and 1920 px (mine: 1541 in 1541). Before the pass each was 980 px in a box of 901, 645 and 678 px at 1280, 1024 and 768 px. Claim lines table 901 in 901 at 1280 px, cards below. The two tables of the edited-claim dialog 358, 628, 696, 856 and 856 px, each in a box of the same width.
- Guide pin `9bcb7ef1b1bf304c4fc1017963bb58603fe8e58fed3ed99404617e22c9e6f152` in `approved-product-help.ts`; the two cards it backs (`reimbursement.meaning` on `quick-start`, `reimbursement.roles` on `tabs`) were not edited and are still true as written.

Next (as this pass left it): the API items above; the role page's table; then the owner's six real claims can be finished through the pay step as REIMB-15 walks it.

## Server-side gaps closed, with the web change each needs (2 Oct 2026)

Status: done on the same branch and worktree, from `19fe51537`. Not pushed, no PR. No `package.json` edit, no migration, no AI model call.
Owner: server lane of the polish pass (API, contracts, web, the claim guide and its pin, e2e text, docs).
Scope: every item of "Left for the API" above except the undo of a slip move (the owner said not to build one), and three items found after the pass: the pay dialog of the queue table, the sentence on a misfiled slip, and two assistant tools. Decisions are in the payout spec §18.6, with the rule of each in §14.3, §14.5, §14.6, §16.2, §17.2 and §17.3.

| # | Commit | What changed | Proved by |
|---|---|---|---|
| 1 | `be45b63aa` | The role page's three claim choices say what they grant: "อนุมัติการเบิก" also records and voids a payment, "ตรวจสอบการเบิก" cannot, "ตรวจ/จ่ายการเบิก" lists everything | `capability.logic.spec.ts`, a rule over the registry (no database) |
| 2 | `a2154783d` | The claims list answer carries the company's `financeReviewRequired`; the hub asks the list for one row when the viewer cannot read the policy. Who may read the policy is unchanged | `reimbursement-request.use-case.spec.ts` (fakes); `reimbursements.api.spec.ts`, the hub QA spec |
| 3 | `79671fe1e` | Approve or reject on a claim that no longer waits: 409 `reimbursement_not_awaiting_approval` with a Thai sentence that names no status word; a dialog that can no longer act closes | `reimbursement-approval.use-case.spec.ts` (fakes) and one real-PostgreSQL case; three web cases |
| 4 | `1d38df69a` | A possible duplicate is one fact: the payment's own test (`duplicateBlocksPayment`: the claim's policy blocks, and it has an open candidate) is what the payment, the claim detail and the pay-queue row read; `duplicateStatus` in every answer is read with the claim's candidates | four rule cases; two real-PostgreSQL cases through submit, approval, projection and payment; two claim-page cases |
| 5 | `f0550ecb9` | The pay call and the attach-slip call refuse a declared signed copy unless the body carries `confirmSignedCopyWithdrawal: true` (409 `payment_slip_signed_copy_unconfirmed`, nothing written). The form sends it for a signed copy chosen under the note "ย้ายกลับไม่ได้"; the move dialog says the same and sends it on yes. No undo | fake-Prisma repository case, use-case hand-over, DTO shape, one real-PostgreSQL case for both calls; web save, API call and dialog cases |
| 6 | `cdba09705`, pin of the reasons in `15cc8fc6f` | Reason `NO_ACCOUNT_ON_CLAIM` "ใบนี้ยังไม่มีบัญชีรับเงิน", offered and accepted only for a claim with no account of its own (one contracts function for both sides); the notice asks to add an account; the journey says "ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน…" and "ผู้เบิกเพิ่มบัญชีรับเงิน" | `reimbursement-request.use-case.spec.ts` (fakes), `reimbursement.logic.spec.ts`; five web cases |
| 7 | `5228c4f2a` | `payoutCorrection.sameAsPrevious` while a round's account waits for approval: the server compares the stored fingerprints and only the answer leaves. The card shows one account under "บัญชีเดิม ไม่ได้เปลี่ยน" | use-case case over the repository's own payout code (fakes), one real-PostgreSQL case; one web case |
| 8 | `b34ae2cf1` | `payoutCorrectionActions.submitModes` and `specifiedRefusal`: the choices the account endpoint takes from this viewer, by the endpoint's own rules. The form offers only those and says up front why typing is not one | use-case case that holds every listed and unlisted choice against the endpoint (fakes), the real-PostgreSQL inactive-requester case extended, a rule case; one web case |
| 9 | `3eda22886` | The pay dialog of the queue table has "เปิดดูไฟล์นี้" on every listed file, by the claim page's own handler; the form's `onOpenFile` is no longer optional | the dialog rendered with its claim read and each link pressed; the wiring of both hosts |
| 10 | `a4928c826` | The sentence on a signed-copy row after a payment with a slip is true in both cases, and names "แนบสลิปเพิ่ม" only while the payment row shows it | the pinned sentence, the control on the page, a payment at its slip limit |
| 11 | `9850bdaf8`, manifest in `9f7651c3c` | A claim being cancelled is in none of the four figures of `reimbursement.get_summary`, and `reimbursement.get_detail` reads its status as "รอระบบปรับสถานะ" | `reimbursement-request.use-case.spec.ts`, `erp-core-detail-tools.use-case.spec.ts` (fakes) |

Every new test was run against the code as it was before its change and failed there.

### What a reader of the code should know

- Item 4, the cause: the three writes that complete a claim's expense records (`complete*ProjectionAtomic`) overwrite the claim's `duplicateStatus` column with the result of those records, while the payment is refused by the claim's own open candidates. The column and its writers are unchanged; the answer is merged on read (`claimDuplicateStatus`), so claims written before the fix read correctly with no migration. A claim under a policy that only warns has no mark in the pay queue (its payment is not refused) and still reads as a possible duplicate.
- Item 5 is a 409 on purpose: a page loaded before the question existed knows no such code, and its 409 sentence says to load the latest data, which is what gets it the picker that asks. A copy with no declaration needs no confirmation. A declaration set aside by a correction round still needs it: it is on the file, and the move removes it.
- Item 6: the notice's title is the workflow template's and reads "ใบเบิกต้องแก้บัญชีรับเงิน" for every reason; only the body follows the reason. The status name of the round ("รอผู้เบิกแก้บัญชีรับเงิน") and the requester's button ("แก้บัญชีรับเงิน") are the same for every reason too: one name for one state.
- Item 7: the fingerprint covers the kind, the bank, the account name and the number, so the same number under another name is another account. `sameAsPrevious` exists only in phase B; a claim that had no account is never "the same"; cash both times is.
- Item 8: `submitModes` lists what the endpoint takes. Two of them are shown as another choice and not twice: a default that is cash, and "the account the claim had" when that was cash, are both the cash choice. An answer without the list (a page read before the server gave one) offers every choice, and the refusal `payout_account_member_not_active` still closes typing.
- The typing rule (`mayTypePayoutAccountFor`) and the reasons a claim takes (`reimbursementPayoutCorrectionReasons`) are each one function read by the side that offers and the side that refuses.
- The contracts package's own test script does not run `reimbursements.spec.ts`; the reasons and the ask word are held by `reimbursement.logic.spec.ts` in the API suite.

### Still open

- No command takes a file out of ใบเบิกที่เซ็นแล้ว or a slip off a payment, and no command moves a file back with its declaration (the owner's word: no undo). The row's sentence says what to do in both cases (item 10).
- The pack descriptions other than the three claim ones, and the role page's table width, are as the earlier section left them.
- `e2e/reimbursements.spec.ts`: REIMB-11 now expects the 409 before the confirmed move, and REIMB-14 expects the same-account answer and card. Type-checked; not run with Playwright in this pass.

### Verification of this section

At `a4928c826`, the last commit that changes product code (the commits after it are the spec, one e2e expectation and this note):

- Typechecks, by each package's own script: contracts (typecheck and build), API (`pnpm --filter @watchdog-bms/api typecheck`, 71 s), web (`next typegen && tsc --noEmit`), ai-gateway: all rc 0. The native compiler over API and web after every item: rc 0.
- Contracts tests 344 of 344. Whole web suite 2598 of 2598. Whole API suite (the package's `test` script, no database): 11,532 passed, none failed.
- Reimbursement real-PostgreSQL gate (`REIMBURSEMENT_PG_GATE_REQUIRED=true … test:reimbursement-compatibility`) on a throwaway PostgreSQL 18.3 container with every migration applied: 101 of 101, none skipped. The container was removed afterwards.
- Boot DI smoke: Nest resolved every provider. Maintenance pins: current (48 files), nothing to sync. W00 manifest parity 4 of 4; it was regenerated once, for item 11 (`9f7651c3c`), and no hashed file changed after. `node scripts/run-line-ai-whole-chain-acceptance.mjs` rc 0 (21 repository scenarios). `approved-knowledge.spec.ts` 9 of 9; user-guide spec 10 of 10. `git diff --check` clean.
- `e2e/reimbursements.spec.ts`: type-checked with the native compiler (the spec and everything it imports), rc 0. Not run with Playwright.
- Guide pin `1e13e61539476ac9f5ee1e4d81842019a9ee0f41ce509382d102c976ad09a779` in `approved-product-help.ts` (moved four times in this section: items 2, 6, 7 and 10). The two cards it backs were not edited and are still true as written.
- Not done in this section: a look in a browser. The screen changes are held by rendered-markup specs (wrapping text, 44 px links by the form's own component), not by screenshots at 390 px.
- One miss, put right: `reimbursement.logic.spec.ts` pins the list of reasons and was not among the specs run for item 6, so `cdba09705` carries a failing pin that `15cc8fc6f` fixes. From then on every item was checked against every reimbursement spec of the API, and the whole suite at the end.

Next: run e2e REIMB-11 and REIMB-14 on a stack; the role page's table; then the owner's six real claims can be finished through the pay step as REIMB-15 walks it.
