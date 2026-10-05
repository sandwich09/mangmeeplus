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
- Claims: a claim with a receipt confirmed as a duplicate takes no new payment under every duplicate policy, asked before the payment lock and under it, with its own reason and refusal. The claim detail and journey, both pay-queue layouts, the payment refusal, the API error map and the LINE claim answer say why and the way out for the claim's state, from one function in contracts (`reimbursementDuplicateBlockNotice`). Neither "ปลดรายการซ้ำ" nor the finance override is offered for it. Before the confirmation, on an expense that comes from a claim, the page says the claim will not be payable, must be cancelled, and that the confirmation cannot be undone. Nothing recorded is reversed; approval is not blocked. Spec: `docs/specs/reimbursement-approval-spec.md`.

Decisions:

- Owner, 2026-10-05 ~09:45: "ทำงานเล็ก ต่อ แต่ยังไม่ต้อง deploy uat prod ใช้ codex เหมือนเดิม".
- Owner, 2026-10-05 ~10:00, on a claim whose receipt a reviewer confirmed as a real duplicate and which could still be paid in full: "ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". The controller reads it as: under every duplicate policy; nothing already paid is reversed.
- Controller (the owner delegated screen design on 2026-10-04): with the contact pair shown, an extra sort column replaces the note column on a desktop instead of narrowing every text column. The first pass narrowed them and cut the package badges and put an e-mail on three lines.
- Owner, 2026-10-05 ~11:55, on the legal screen a new executive account passes at its first sign-in: "ก) ปล่อยไว้". The screen is the one every account passes (the executive spec already requires it, like sales accounts); two phrases on it are written for shop users ("พื้นที่ทำงานของร้าน" under the logo, "การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ"). They stay as they are; the documents and the three statements were never in question.
- Left out on purpose: a payment date in the future on sales-document receipts. Sales documents are not in the packs that are sold (`focus-on-sold-feature-packs`).

Open questions:

- The business-type cell still splits some Thai compounds (สิน|ค้า, จัด|ทำ). The split comes from the browser's own Thai word list (the same library answers the same way outside a page), and the cell forces no break, so a layout rule cannot change it. Left.
- With the churn filter the list can carry more than one extra fact column and then scrolls sideways, as before.

Artifacts:

- Branch `claude/small-followups-20261005`; lane branches `codex/small-exec-20261005`, `codex/small-wht-20261005`, `codex/small-dup-20261005`.
- Browser proof (local stack, 1280 and 390 px): an executive account holding the note right saves the team note from the company list and from the company page, the text survives a reload, the System Admin reads the same text in the console, and an account without the right has no edit control ("คุณอ่านหมายเหตุได้ แต่ยังไม่มีสิทธิ์แก้ไข"); a direct save by that account answers 403. This closes "not proven on a screen" of the batch note.

Verification: see the section at the end of this note.

Next: merge to `develop` and `main`. No deploy until the owner says so; the next release needs a new UAT round and his explicit go for Production.

## How the lanes went

- `small-wht` (6 minutes): the status word and the browser test. The test had never been run; running it on a throwaway stack found four more things the product had changed since it was written (two toasts on a save, the counterparty list remembering a vendor's payee type between runs, ย้อนกลับ behind เพิ่มเติม, seeded income kinds for a person).
- `small-exec` (23 minutes): six items. The controller then reworked the extra-sort-column layout and removed the duplicate Excel column after looking at the real screen and a downloaded file, and reverted a class that changed nothing.
- `small-dup`: the first turn stopped after eleven minutes when the service answered "selected model is at capacity"; resumed on another model from its own diff and finished in 37 minutes. The controller tidied the sentence joins and one fallback sentence.

## Verification (controller, 2026-10-05 11:21–11:27, head `fe99cb8aa`)

GitHub Actions has ended every pull-request run in `startup_failure` with zero jobs since 2026-09-25, so the gates were run locally with `scratchpad/integration-verify.sh` (the 17 steps CI runs): **all 17 exit 0**.

| Suite | Result |
|---|---|
| API fixed-list suite | 11,866 tests, exit 0 |
| Web (`src/**/*.spec.ts`) | 3,162 pass, 0 fail |
| AI gateway | 1,536 pass, 0 fail |
| Contracts | 351 pass, 0 fail |
| Config | 153 pass, 0 fail |
| Workers | 47 pass, 0 fail |
| Real-PostgreSQL specs | exit 0; the reimbursement compatibility job 107 pass, with the new test "a confirmed own expense blocks detail, queue and new payment under the real lock for every policy" |
| LINE-AI whole-chain acceptance | exit 0, capability manifest regenerated |

The first full run was red on two older checks that pinned yesterday's behaviour, both corrected: the four-tile class in `executive-presentation.spec.ts`, and `claim-payment-posting.pg.spec.ts`, which paid a claim after its receipt was confirmed as a duplicate (now the payment is recorded first, which is still possible, and the worker posts it as before).

`e2e/receipt-draft-continuity.spec.ts`: 11 of 11 on chromium, three runs in a row, on a throwaway stack (own containers; database named `watchdog_bms` and bucket `receipt-remediation-…` as the spec's own safety checks require).

Seen on the owner's local stack at 1280 and 390 px: the company list with and without an extra sort column, the unmatched-money table, the withholding kinds page, the executive account page, a usage export downloaded and opened (60 columns, one receipt count).
