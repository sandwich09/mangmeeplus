# Agent Memory: small-followups-2026-10-05

Status: In progress on `claude/small-followups-20261005` (from `develop` `373477010`). Not deployed: the owner said to continue the small work with Codex and NOT to deploy to UAT or Production yet.

Owner: Controller (Claude) scoped each item from the real screen and the code, reviewed and ran everything; implementation by Codex lanes (`gpt-6.1-sol`, effort high; xhigh for the money rule); one Claude agent for a browser proof.

Scope: the follow-ups that were set aside when the scope was frozen before the 2026-10-05 release (`owner-preview-batch-2026-10-04.md`, "Open questions"), plus one money rule the owner decided the same morning.

- Executive report, company list: an e-mail address shows whole (it wraps before "@"); a sort fact from outside the nine columns takes the note's place on a desktop where the contact pair is shown, so the list fits its 974 px box at 1280 px and no other column is squeezed (the note stays in the opened row and on a phone card).
- Executive report, revenue, money not tied to a company: the header is "จำนวน" and each value carries its unit (รายการ, บาท, ใบ) in a slot of one width.
- Executive report, tiles: no tile alone on a row for four to eight tiles.
- Executive Excel: the per-company sheet, the KPI and the bucket chart count the receipts that are in the system, under the same word and qualifier as every screen ("ใบเสร็จในระบบ"); the cumulative column "ใบเสร็จสะสม" is gone. Reference workbook regenerated.
- Executive account page in the console: the suspend button stands at the right end, with no divider left stranded when it wraps.
- Withholding kinds (Mangmee admin): a kind that is off reads "ไม่ได้เปิดใช้งาน", true whether it was ever on (the server keeps only the status).
- `e2e/receipt-draft-continuity.spec.ts`: the withholding journey follows today's block. Test only.
- Claims: a claim with a receipt confirmed as a duplicate takes no new payment, and the screen says why and what to do (see Decisions). In progress in its own lane.

Decisions:

- Owner, 2026-10-05 ~09:45: "ทำงานเล็ก ต่อ แต่ยังไม่ต้อง deploy uat prod ใช้ codex เหมือนเดิม".
- Owner, 2026-10-05 ~10:00, on a claim whose receipt a reviewer confirmed as a real duplicate and which could still be paid in full: "ก) ห้ามจ่ายจนกว่าจะเอารายการซ้ำออกหรือยกเลิกใบเบิก และมีคำแนะนำด้วย อย่าปิดเงียบ". The controller reads it as: under every duplicate policy; nothing already paid is reversed.
- Controller (the owner delegated screen design on 2026-10-04): with the contact pair shown, an extra sort column replaces the note column on a desktop instead of narrowing every text column. The first pass narrowed them and cut the package badges and put an e-mail on three lines.
- Left out on purpose: a payment date in the future on sales-document receipts. Sales documents are not in the packs that are sold (`focus-on-sold-feature-packs`).

Open questions:

- The business-type cell still splits some Thai compounds (สิน|ค้า, จัด|ทำ). The split comes from the browser's own Thai word list (the same library answers the same way outside a page), and the cell forces no break, so a layout rule cannot change it. Left.
- A new executive account's first sign-in goes through the legal screen written for shop users ("พื้นที่ทำงานของร้าน", "การยืนยันนี้ใช้กับบัญชีของคุณทุกกิจการ"). Seen by the browser proof on a local stack; not changed, the owner decides.
- With the churn filter the list can carry more than one extra fact column and then scrolls sideways, as before.

Artifacts:

- Branch `claude/small-followups-20261005`; lane branches `codex/small-exec-20261005`, `codex/small-wht-20261005`, `codex/small-dup-20261005`.
- Browser proof (local stack, 1280 and 390 px): an executive account holding the note right saves the team note from the company list and from the company page, the text survives a reload, the System Admin reads the same text in the console, and an account without the right has no edit control ("คุณอ่านหมายเหตุได้ แต่ยังไม่มีสิทธิ์แก้ไข"); a direct save by that account answers 403. This closes "not proven on a screen" of the batch note.

Verification: recorded at the end of this note when the branch is complete.

Next: finish the duplicate-payment lane, run the full local verification once on the merged branch, merge to `develop` and `main`. No deploy until the owner says so.
