# Agent Memory: small-followups-2026-10-05

Status: Complete on `claude/small-followups-20261005` (from `develop` `373477010`), verified locally, on the owner's local stack. Not deployed: the owner said to continue the small work with Codex and NOT to deploy to UAT or Production yet.

Owner: Controller (Claude) scoped each item from the real screen and the code, reviewed and ran everything; implementation by Codex lanes (`gpt-6.1-sol`, effort high; xhigh for the money rule); one Claude agent for a browser proof.

Scope: the follow-ups that were set aside when the scope was frozen before the 2026-10-05 release (`owner-preview-batch-2026-10-04.md`, "Open questions"), plus one money rule the owner decided the same morning.

- Executive report, company list: an e-mail address shows whole (it wraps before "@"); a sort fact from outside the nine columns takes the note's place on a desktop where the contact pair is shown, so the list fits its 974 px box at 1280 px and no other column is squeezed (the note stays in the opened row and on a phone card).
- Executive report, revenue, money not tied to a company: the header is "จำนวน" and each value carries its unit (รายการ, บาท, ใบ) in a slot of one width.
- Executive report, tiles: no tile alone on a row for four to eight tiles (four share one row from 768 px; seven or eight use four columns; on a phone the last of seven spans the row). Six stay 3 + 3.
- Executive Excel: the per-company sheet has ONE receipt count, the sheet's own "ใบเสร็จในระบบ (รายการ)", with the same qualifier as every screen; the cumulative column "ใบเสร็จสะสม" is gone (the first pass renamed it and left the same figure twice: seen in a file downloaded from the local stack). The fictional reference workbook uses "ใบเสร็จในระบบ" for its column, KPI and chart, and is regenerated.
- Executive account page in the console: the suspend button stands at the right end, with no divider left stranded when it wraps.
- Withholding kinds (Mangmee admin): a kind that is off reads "ไม่ได้เปิดใช้งาน", true whether it was ever on (the server keeps only the status).
- `e2e/receipt-draft-continuity.spec.ts`: the withholding journey follows today's block. Test only.
- Claims: a claim with a receipt confirmed as a duplicate takes no new payment under every duplicate policy, asked before the payment lock and under it, with its own reason and refusal. The claim detail and journey, both pay-queue layouts, the payment refusal, the API error map and the LINE claim answer say why and the way out for the claim's state, from one function in contracts (`reimbursementDuplicateBlockNotice`). Neither "ปลดรายการซ้ำ" nor the finance override is offered for it. Before the confirmation, on an expense that comes from a claim, the page says the claim will not be payable, must be cancelled, and that the confirmation cannot be undone. Nothing recorded is reversed; approval is not blocked. Spec: `docs/specs/reimbursement-approval-spec.md`. A second round, after a browser check on a real stack, made the other sentences true for a blocked claim: the badge reads "รอยกเลิก", the desk line and the timeline name who can cancel instead of "พร้อมจ่าย" and "กำลังรอ … บันทึกจ่าย" (claim page, lists, both pay-queue layouts, the LINE claim and backlog answers); the toast after voiding a payment says only what the reader can do next; the pay-queue table wraps the guidance and fits at 1280 px; the summary card reads "ติดรายการซ้ำ"; the duplicate override on a confirmed duplicate is refused with `duplicate_confirmed` before any write (it answered 200 and wrote a SUCCESS audit row while clearing nothing); a payment form opened before the confirmation reads the claim again and closes; the payout send-back is not offered on a blocked claim. A third round (controller, after the second browser check): both claim list reads load the claim's own duplicate expenses, so a list card reads "รอยกเลิก" too (the lists returned no duplicate reason and still said "พร้อมจ่าย"); the pay-queue line "อยู่ที่ …" wraps on a phone instead of being cut.

Decisions:

- Owner, 2026-10-05 ~09:45: "ทำงานเล็ก ต่อ แต่ยังไม่ต้อง deploy uat prod ใช้ codex เหมือนเดิม".
- Owner, 2026-10-05 ~10:00, on a claim whose receipt a reviewer confirmed as a real duplicate and which could still be paid in full: "ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". The controller reads it as: under every duplicate policy; nothing already paid is reversed.
- Controller (the owner delegated screen design on 2026-10-04): with the contact pair shown, an extra sort column replaces the note column on a desktop instead of narrowing every text column. The first pass narrowed them and cut the package badges and put an e-mail on three lines.
- Owner, 2026-10-05 ~11:55, on the legal screen a new executive account passes at its first sign-in: "ก) ปล่อยไว้". The screen is the one every account passes (the executive spec already requires it, like sales accounts); two phrases on it are written for shop users ("พื้นที่ทำงานของร้าน" under the logo, "การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ"). They stay as they are; the documents and the three statements were never in question.
- Left out on purpose: a payment date in the future on sales-document receipts. Sales documents are not in the packs that are sold (`focus-on-sold-feature-packs`).

Open questions:

- The business-type cell still splits some Thai compounds (สิน|ค้า, จัด|ทำ). The split comes from the browser's own Thai word list (the same library answers the same way outside a page), and the cell forces no break, so a layout rule cannot change it. Left.
- With the churn filter the list can carry more than one extra fact column and then scrolls sideways, as before.
- A claim blocked by a confirmed duplicate keeps its stored status, so three things still treat it as payable. Asked the owner (recommended: count and remind only what can really be paid), not started:
  - the payment reminders and their notices (`workflow-template-catalog.ts`: "รอคุณบันทึกการจ่ายเงิน", "พร้อมจ่ายเบิกจ่าย", "ใบเบิกกลับไปรอจ่าย") can still name it. Changing that touches who is notified and the reminder selection;
  - the counts and totals: the summary tile "รอจ่าย N" and "ยอดคงค้างรวม" on the claims page (on the local stack the tile read 9 while 2 claims could really be paid), and the LINE aggregate "อนุมัติแล้วรอจ่าย" (`prepared-simple-read-formatter.ts`);
  - the void dialog: its guidance is true but circular for the person voiding (it tells the voider to void).
- The finance-review decision on a claim that is at the finance-review step with a confirmed duplicate is covered by unit tests only; it was not opened on a screen.

Artifacts:

- Branch `claude/small-followups-20261005`; lane branches `codex/small-exec-20261005`, `codex/small-wht-20261005`, `codex/small-dup-20261005`.
- Browser proof (local stack, 1280 and 390 px): an executive account holding the note right saves the team note from the company list and from the company page, the text survives a reload, the System Admin reads the same text in the console, and an account without the right has no edit control ("คุณอ่านหมายเหตุได้ แต่ยังไม่มีสิทธิ์แก้ไข"); a direct save by that account answers 403. This closes "not proven on a screen" of the batch note.
- Browser proof of the duplicate rule (local stack, 1280 and 390 px, seed shop owner): round 1 — the refusal, the guidance for each state, no "ปลดรายการซ้ำ" and no override on a confirmed duplicate, the warning before the confirmation (all passed, three findings: the badge and desk line still said "พร้อมจ่าย", the void toast, the table too wide). Round 2 — six of seven passed; the two left (list cards, the cut desk line on a phone) were fixed in the third round and seen again: the "mine" tab and the queue read "รอยกเลิก", the desk line stands on two lines, the summary card reads "ติดรายการซ้ำ", and the list API returns the reason `EXPENSE_CONFIRMED_DUPLICATE`.

Verification: see the section at the end of this note.

Next: merge to `develop` and `main`. No deploy until the owner says so; the next release needs a new UAT round and his explicit go for Production.

## How the lanes went

- `small-wht` (6 minutes): the status word and the browser test. The test had never been run; running it on a throwaway stack found four more things the product had changed since it was written (two toasts on a save, the counterparty list remembering a vendor's payee type between runs, ย้อนกลับ behind เพิ่มเติม, seeded income kinds for a person).
- `small-exec` (23 minutes): six items. The controller then reworked the extra-sort-column layout and removed the duplicate Excel column after looking at the real screen and a downloaded file, and reverted a class that changed nothing.
- `small-dup`: the first turn stopped after eleven minutes when the service answered "selected model is at capacity"; resumed on another model from its own diff and finished in 37 minutes. The controller tidied the sentence joins and one fallback sentence.

## Verification (controller, 2026-10-05 12:49–12:55, head `0dc66f10c`)

GitHub Actions has ended every pull-request run in `startup_failure` with zero jobs since 2026-09-25, so the gates were run locally with `scratchpad/integration-verify.sh` (the 17 steps CI runs): **all 17 exit 0** on the final code head. The same run was green at 11:27 on `fe99cb8aa` (before the second claims round) and at 12:32 on `2a68482c4` (before the third).

| Suite | Result |
|---|---|
| API fixed-list suite | 11,868 tests, exit 0 |
| Web (`src/**/*.spec.ts`) | 3,175 pass, 0 fail |
| AI gateway | 1,536 pass, 0 fail |
| Contracts | 351 pass, 0 fail |
| Config | 153 pass, 0 fail |
| Workers | 47 pass, 0 fail |
| Real-PostgreSQL specs | exit 0; the reimbursement compatibility job includes "a confirmed own expense blocks detail, queue and new payment under the real lock for every policy", which also asserts that both list reads return the confirmed-duplicate count |
| LINE-AI whole-chain acceptance | exit 0, capability manifest regenerated on the merged tree |

The first full run (11:13) was red on two older checks that pinned yesterday's behaviour, both corrected: the four-tile class in `executive-presentation.spec.ts`, and `claim-payment-posting.pg.spec.ts`, which paid a claim after its receipt was confirmed as a duplicate (now the payment is recorded first, which is still possible, and the worker posts it as before).

`e2e/receipt-draft-continuity.spec.ts`: 11 of 11 on chromium, three runs in a row, on a throwaway stack (own containers; database named `watchdog_bms` and bucket `receipt-remediation-…` as the spec's own safety checks require).

Seen on the owner's local stack at 1280 and 390 px: the company list with and without an extra sort column, the unmatched-money table, the withholding kinds page, the executive account page, a usage export downloaded and opened (60 columns, one receipt count).
