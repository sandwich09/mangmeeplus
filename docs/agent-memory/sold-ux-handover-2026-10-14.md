# Agent Memory: sold-UX programme hand-over, 2026-10-14 afternoon

Status: the session that ran 2026-10-12 to 10-14 ends here (the owner: "session นี้เข้าวันที่ 3 แล้ว"). A new session continues from this file. Nothing is pushed (owner answer 18) and nothing is on UAT or Production (answer 19).
Owner: thawatchai. Plain Thai to him, short, no hashes, ids, paths or code; every report ends with "พร้อมแล้ว / ยังเหลือ".
Scope: the sold screens (starter preset, withholding for enterprise), the owner's question sets 1 to 5 and their accountant's rules.

## Where things are

| Place | Branch | What it holds |
|---|---|---|
| Served checkout `/private/tmp/mangmee-pv-b-20261011` | `claude/sold-ux-program-20261013` | What the owner's trial web (http://localhost:3140) runs. Gate `g6` GREEN on 2026-10-14 14:58: suites 21,665, real-database 515, journeys 64/64. |
| Integration checkout `/private/tmp/mangmee-pv-b2-20261012` | `claude/ux-owner-r-20261013` | Same head as served at hand-over. Lanes are merged HERE first, proven, then served fast-forwards. |
| Lane T `/private/tmp/mangmee-pv-a6-20261011` | `claude/ux-owner-t-20261013` | Withholding slice 5 (the payment decides the month): all rounds committed (B5-1, B5-1b, B5-2, B5-3 = paid but not withheld, unknown payment dates asked, certificate screens with two dates, the page, the journey). Built by reading: not yet merged, proven or seen in a browser. Seed-written payment dates are unconfirmed, so seeded expenses leave the papers until a date is given: check what that does to the trial shop and the journeys. |
| Lane P `/private/tmp/mangmee-pv-a-20261011` | `claude/ux-owner-p-20261013` | UX7 committed (the fix-focus waits for the rendered error; the paid row's buttons one size; the input-VAT change form opens from the saved decision; a certificate payment's proof on its row). Not merged, unproven in a browser. |
| Lane Q `/private/tmp/mangmee-pv-c-20261011` | `claude/ux-owner-q-20261013` | DQ, DQ2 (purchase-screen fixes; an explicit package change opens on the shop's current cadence) and WHT-msg (branch-settings message) committed, not merged. |

On the trial web now: batch A of the evening answers; withholding slices 1, 2 (who pays, a paper per paying establishment, the lock per payment, legacy months keep the month lock) and 3 (additional filing, a cancel after filing stays on its paper, the release command for old months); the right to input VAT apart from the document type (batch C, all four rounds plus fixes); the purchase screens D1 to D5 with the first fix round; a slip when recording an expense payment; `กิจการ` on the certificate in place of a receipt; three new shops added to the trial database only (`ร้านทั่วไป (ไม่จด VAT)`, `ร้านทั่วไป (ยังไม่ตอบเรื่อง VAT)`, `ร้านทดลองภาษีซื้อ`) with the dev sign-in owner made their owner. The release command for old filed months was run on the trial database (nothing to do there).

Not yet on the trial web, all committed in their lanes and waiting to be merged into the integration checkout and proven: slice 5 (lane T), DQ/DQ2/WHT-msg (lane Q), UX7 (lane P). No Codex round is running at hand-over.

## How to continue (the method of `docs/runbooks/local-proof-stack-and-merge-gate.md`, as practised)

1. Read each lane's last report (see "Artifacts"), review the diff, commit in the lane by explicit paths (never `git add -A`; never commit `apps/web/next-env.d.ts`).
2. Merge the lane branches into the integration checkout; resolve conflicts keeping both sides where both added; `prisma validate`, `prisma generate`, contracts build, `bash scripts/local-proof/tsc.sh both`; `S/codex/repin.sh <integration>` and commit what it changes.
3. In the integration checkout: `bash scripts/local-proof/prove.sh <tag>` (the gate without the trial stages). Journeys written by Codex by reading fail first about one time in three: send a Claude agent with a browser to the proof stack of the integration checkout to settle each failure as test, seed or product, and to look at the screens at 390, 1280 and 1556. Fix product findings in a lane; repeat.
4. When `PROVE GREEN`: stop the proof stack from the integration checkout (`bash scripts/local-proof/proof-stop.sh`), fast-forward served, `bash scripts/local-proof/gate.sh <tag>` from served (it migrates and restarts the trial). New release commands run on the trial database with `source scripts/local-proof/common.sh; lp_env trial`.
5. Codex lanes do not notify: wait on `run-N.result`. At most three lanes at once on this machine. Never stop a process by name or pattern.

## Decisions taken in this session that the owner did not word himself

- A branch without a tax branch code under "each branch pays" gets no paper until the code is filled (the question recommended this; the spec's draft had said "files as head office"); the stop is as narrow as its cause: an unanswered shop holds back only the form that has payments from more than one branch.
- Batch C: the ledger (not sold) now takes input VAT only when the right is `CLAIMABLE` with usable evidence; a draft journal is rebuilt on a decision; a posted journal refuses a decision with a true sentence and no way, so a ledger shop is told to judge the right before confirming.
- The right to input VAT is not shown at all for a shop that is not VAT-registered on the document date, nor for a paper with no VAT; after a decision the action reads `เปลี่ยนผลตรวจสิทธิภาษีซื้อ` and asks the reason first.
- The guide was not rewritten (answer 8), but two sentences of the expenses guide were synced to the new screen words because the guide tests require guides to quote current screen words.
- The printed claim form's "defect" reported earlier was withdrawn: the browser draws that paper and squeezes long text into its box.
- Purchase screens: an explicit package change opens on the shop's current cadence and way to pay; only a first purchase starts on monthly with nothing chosen.

## Open and owed

- Slice 5 must be proven and landed before the owner's accountant's rule is true on the trial: payment date decides the month; unpaid expenses on no paper; the 50 ทวิ's two dates; paid in parts; recorded late; paid but not withheld. Its existing-data rule (existing entered payment dates are kept as confirmed; only writers that invent a date are unconfirmed) needs a prover on real data.
- Online filing file (slice 4): not built by the owner's decision (question set 4, ค1); research kept in `docs/research/rd-wht-upload-format-research-2026-10-14.md`.
- The ledger-shop line before confirming is unproven in a browser (no seeded shop posts to the ledger).
- The purchase against the payment provider's test mode is owed on UAT (no provider test credentials locally).
- At release (UAT, then Production, only on the owner's word and through `docs/runbooks/uat-production-v2-deployment.md`): the new migrations of 2026-10-13/14, the data migration of open input-VAT rights, the release command `pnpm --filter @watchdog-bms/api exec node --import tsx src/scripts/backfill-withholding-filings.ts`, and the three billing rounds that were reverted on `main` only (see `docs/plans/purchase-screens-ux-plan.md`, "Base first").
- The owner's step list 4 (Thai, never committed) was being written and walked by an agent at hand-over.

## Findings of the step-list walk (2026-10-14, on the served head; not yet fixed in any lane unless noted)

The agent that wrote and walked the owner's step list 4 (55 steps) saw these; check each against lanes Q and P first (DQ and UX7 may already fix 3, 7 and part of 2):
1. The link from the input-VAT conditions to `ข้อมูลร้าน` has no way back to the expense (`ExpenseInputVatRight.tsx:100`).
2. `ยังไม่ครบ: ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน` stays after its box is ticked, and `ใช้ได้ตามเงื่อนไข` can be saved while the shop has no registered name or tax number (spec D5): a rule hole, server side first (`ExpenseInputVatRight.tsx:99–103`).
3. The change form is squeezed on a confirmed document (UX7 addressed it: verify).
4. A confirmed expense loses the `ภาษีซื้อรอตรวจสอบ` badge at the top (drafts and the list keep it).
5. The `บันทึกว่ายื่นแล้ว` dialog does not name which establishment's paper it files (`WithholdingPage.tsx:147`).
6. `ปิด` on the stop-renewal question leaves `ถอนคำขอที่ยังไม่ดำเนินการแล้ว` and the no-refund sentence on screen (`BillingCollectionPanel.tsx:14`).
7. `จ่ายเงินไม่สำเร็จ` offers only `ตรวจผลการจ่ายเงิน` (`billing-pending-payment.ts:156–159`): DQ item 7 may have fixed it: verify.
8. The renewing review's paying button looks grey until ticked (it does explain on press). Minor.
9. The certificate expense's page still says `บริษัทจ่ายเต็มจำนวน` in a shop that is not a company (`ExpensesPages.tsx:1323`); only the paper says `กิจการ` (answer ค3 covers the screen too).
10. After cancelling a filed expense the card still counts it while its row leaves the list: consistent with the spec, possibly confusing.

## Artifacts

- Plans and specs: `docs/plans/sold-ux-owner-answers-2026-10-13-evening-plan.md` (question sets 1 to 4; set 5 is the "Slice 5" section of the withholding spec), `docs/specs/withholding-returns-complete-spec.md`, `docs/specs/expense-input-vat-right-spec.md`, `docs/plans/purchase-screens-ux-plan.md`, `docs/runbooks/local-proof-stack-and-merge-gate.md`.
- The old session's working folder (not in git, may be cleaned by the machine): `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/7ff4318a-6f19-40b9-857a-46a15263aff0/scratchpad/`: `codex/STATE.md` (the controller's running log), `codex/lane.sh` and `codex/common-rules.md` (how a Codex round is started), `codex/repin.sh`, `ux-program/briefs2/*.md` (every brief), `codex/lane-uxt|uxp|uxq/run-N.result` and `last-N.md` (each round's result and report), `ux-program/owner/` (the Thai files sent to the owner), `try/*.ts` (the two trial-only scripts of this hand-over).
- Codex threads (resume them for the lanes): T `01a13430-6957-77d1-b426-c79014b34d53`, P `01a133b0-1818-75e0-8810-7a402551c328`, Q `01a133b0-1818-76e3-87f0-cd8b1cbe336a`, R `01a133b0-1818-7733-9149-c0b59af589ca` (R's worktree is now the integration checkout).

Verification: gate `g6` on served 1849232b7 GREEN (above); `PROVE i4` on the integration checkout GREEN with the same counts.
Next: land lanes T, Q, P as in "How to continue"; then report to the owner with what he can try.

## Evening of 2026-10-14 (second session)

- Lanes T (slice 5), P (UX7) and Q (DQ, DQ2, WHT-msg) merged into integration, then UX8 (P) and DQ3 (Q) for the step-list findings. Real-database payment specs were updated to slice 5 by a Claude agent (they pinned a WHT event and a certificate without a dated payment; a racing test hung the file); one product fix: a double press on a payment's certificate no longer fails on the handoff key (`wht-certificate-payment.ts`, insert-if-absent).
- Gate `g7` GREEN on served 91744ea56 at about 17:25: suites 21,744, real-database 523, journeys 66/66. The trial web now serves it (migrated: the three slice-5 migrations).
- Trial data: all 62 recorded payments of the trial shop keep confirmed dates (none were written by the seed writer), so its papers did not empty. A freshly seeded shop (proof stack) shows its seeded payments as `ยังไม่ทราบวันที่จ่ายเงินจริง` until a date is given (spec W4).
- Pressed by the controller on the proof stack at 390: the undated box on the withholding page; a date in September moved the payment from October to September's ภ.ง.ด.53 (gross 30,000).
- Step-list findings: 1, 2, 4, 9 fixed (UX8: CLAIMABLE refused without the shop's registered name and tax number, `input_vat_company_identity_required`; way back `กลับไปตรวจสิทธิภาษีซื้อ`; badge on a confirmed document; `กิจการจ่ายเต็มจำนวน`); 3 fixed by UX7; 5, 6 fixed (DQ3); 8 left (a spec pins the disabled look); 10 is the spec.
- Open: finding 7 (after `จ่ายเงินไม่สำเร็จ` only `ตรวจผลการจ่ายเงิน`): the server refuses a new purchase while the attempt is active and the attempt read lacks package and cadence: a server path, to ask the owner. Small: after saving a payment date the box disappears without saying which month the payment went to.
- Later the same evening, owner answers: (1) a failed purchase: tell the customer and let the existing pay button work, no new button — the server already frees the shop on FAILED/EXPIRED (an expired Checkout cannot be paid), so only the screen changed (DQ4b: `เลือกแพ็กเกจแล้วจ่ายอีกครั้งได้`, no check button); (2) group ง kept, except the claim line's category is preselected from its description (UX9; the "same description on an earlier claim" source needs a read that does not exist yet); (3) LINE keeps `แดชบอร์ด`. Also B5-4: saving a payment's real date says which month's paper it is on. All on the trial (served c88a05afc); proof i8 suites/real-db green, journeys 66/66 on a fresh database.
- Owner, same evening: the claim category from earlier claims with the same description — "ยังไม่ต้อง". The hint line under a preselected category was removed at his word. Correction: I had told him `จำนวนราย` counts payments; the code counts attachment rows (one payee per row, up to three payments a row, so a payee paid four times in a month takes two rows and counts two), the same for ภ.ง.ด.3 and ภ.ง.ด.53. This was ALREADY ANSWERED (answer 10 of 2026-10-13 evening, with his accountant: count rows, right as built; `docs/plans/sold-ux-owner-answers-2026-10-13-evening-plan.md`). Do not ask it again.
- Night of 2026-10-14: step list 5 (45 steps, walked on proof) sent to the owner (in his Downloads). Built after the walk and on the trial (served aff813fb4, API restarted 20:42): header `จ่ายครบแล้ว ยังออกหนังสือรับรองไม่ครบ` until every withheld payment has its certificate; the certificate chooser reads two equal payments apart (`รายการจ่ายที่ n`, `฿1,940.00`, `ออกหนังสือรับรองแล้ว`); a 50 ทวิ is issued or corrected only with the shop's registered name (owner "ทำตามที่เสนอเลย"; replacement copies print what was issued and are not refused). Controller read the walker's PDFs and a new certificate: right. Proof i9: suites 21,768, real-db 7/7 files, journeys 66/66.
