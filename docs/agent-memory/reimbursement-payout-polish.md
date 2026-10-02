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

Next: the API items above; the role page's table; then the owner's six real claims can be finished through the pay step as REIMB-15 walks it.
