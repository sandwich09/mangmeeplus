# Agent Memory: Reimbursement payout Phase 4.5 and 4.6 (the user guide and the help pack's pin on it)

Status: Implemented on branch `claude/reimb-payout-guide-20261002`, cut from `9d91db923` (the payout work with every phase's server side). Not pushed, no PR. 2026-10-02.

Owner: Claude (lane 4.5 and 4.6), for the payout coordinator. Push, PR, deploy, any real-model check and owner communication stay with the coordinator session.

Scope: plan tasks 4.5 (the user guide) and 4.6 (the step-journey spec points to the payout spec) of `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md`; spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §21 (the guide row) and the owner's model of 2026-10-01. Not in scope and untouched: everything under `apps/web/src/features/reimbursements/` (the correction round's screens are built on `claude/reimb-payout-p3-correction-round-20261002`), every help card's body, title and question, the other four guides, `package.json`.

## Decisions

The guide (`apps/web/src/features/user-guide/reimbursement-guide.content.ts`):

- **Written from the owner's model.** A claim has a requester and an approver, and the approver records the payment. "ฝ่ายการเงิน" is said only of the finance-review step, which a company turns on. The old text gave every claim a finance desk that reviews and pays ("คิวการเงิน", "ฝ่ายบัญชี และฝ่ายการเงิน … บันทึกการจ่ายเงิน").
- **13 sections became 21**, in the order a claim lives: `quick-start`, `tabs`, `list`, `flow`, `status`, `create`, `payout`, `submit`, `approve`, `pay`, `account-number`, `account-fix`, `finance`, `voucher`, `stuck`, `notify`, `old-claims`, `duplicate`, `policy`, `permissions`, `faq`. Only the existing block kinds are used. The anchors `quick-start` and `tabs` are kept: the help pack links to them.
- **Words.** "คำขอ" (with "ใบ" as its counter) is the record, its page is "หน้าคำขอ", and "ใบเบิก" is the printed form, as the help card `reimbursement.meaning` separates them. The screens themselves say "ใบ" of a claim; those words are kept only inside quotes.
- **A word in “ ” is on a screen, letter for letter.** The file's own rule, now held by `user-guide.content.spec.ts`: each quote must stand as a whole label (not cut out of a longer Thai phrase) in the claim screens, the shared error texts, the workspace dictionary and menu, the contracts, the printed form or the role page's choices. The old guide had drifted without it: "บันทึกร่าง" (the button is "บันทึกร่างคำขอเบิก"), "เปิดร่างที่บันทึกไว้", a signature step that uploaded a file, a four-signer table, and two error sentences that no longer exist.
- **The correction round's screens are not in this tree.** Five quotes of `account-fix` name them: “ส่งกลับให้แก้บัญชีรับเงิน”, “แก้บัญชีรับเงิน”, “ส่งกลับให้แก้อีกครั้ง”, “สิ่งที่เปลี่ยน: บัญชีรับเงินคืน”, “สำเนาก่อนแก้บัญชีรับเงิน”. They are the spec's words (§14.2, §14.4, §14.6) and were read on the web branch at `a3061d871`, where all 137 quotes of the guide stand as whole labels. The spec keeps them in one exception that ends by itself once the claim screens read `payoutCorrectionActions`; after the merge they are checked like the rest.
- **Rights are told in the role page's own choices** ("อนุมัติการเบิก", "ตรวจ/จ่ายการเบิก", …), not in invented names of single rights: that page offers those choices and nothing finer.
- **The duplicate section says what a claim is checked against**: the same receipt file or the same expense record as another claim. The old "three signals" were the expense module's.
- **Signing is told as it works**: the saved signature of "ลายเซ็นของฉัน", with the dialog that sends a signer there. The old text had the signer upload an image.
- **A new shortcut** to "บัญชีรับเงินคืนของฉัน", offered with the same right the page itself asks for (`reimbursement.create`).

The help pack (`apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`):

- Only the pin moved: `sources.reimbursements.hash` is `01b47de50ab746629455a85749d781778e61cf11bc55bdfa013125aecdc8517e` (was `f4c3fa1c…6f17`). No card body, title or question was edited, so no real-model check is owed for this lane.
- `reimbursement.meaning` (anchor `quick-start`) is still true: the section says a requester "จ่ายเงินไปก่อนแล้วขอเบิกคืนจากบริษัท", that "“คำขอเบิก” คือรายการที่ยื่นในระบบ ส่วน “ใบเบิกค่าใช้จ่าย” คือเอกสารที่พิมพ์ออกมาให้ผู้เบิกและผู้อนุมัติลงนาม", and that "การมีร่างหรือมีใบเบิกที่พิมพ์แล้ว จึงยังไม่ได้แปลว่าอนุมัติหรือจ่ายเงินคืนแล้ว".
- `reimbursement.roles` (anchor `tabs`) is still true: the section says "ทุกคนใช้หน้าเดียวกัน แต่เห็นแท็บตามบทบาทและสิทธิ์ของตน", "ผู้เบิก ผู้อนุมัติ และฝ่ายการเงินจึงเห็นงานไม่เหมือนกัน", and "ให้แจ้งผู้ดูแลระบบตรวจสิทธิ์ของคุณ ไม่ต้องสร้างคำขอใหม่". The honest part about finance sits beside it and does not contradict the card: the finance tab is shown by the finance-review right, and the finance desk's own work exists only where the step is on.
- Any later edit of the guide file moves the pin again: `shasum -a 256 apps/web/src/features/user-guide/reimbursement-guide.content.ts`, put the value in `sources.reimbursements`, run `approved-knowledge.spec.ts`. With the old pin that spec fails (8 of 9).

Docs:

- `docs/specs/reimbursement-step-journey-spec-th.md` points to the payout spec where it speaks of the pay step: the related documents, a rule under §5 with the sections to read, the solo owner's path, and a line above the notes of §6. Where the two differ on the pay step, the payout spec holds.
- The plan's checkboxes 4.5 and 4.6 are left as they are, like the other lanes.
- The owner's release note is not in git: `payout-release-note-th.md` in the coordinator's scratchpad.

## Found in the product while writing (nothing here was changed)

1. **The role page cannot take the pay right alone.** "อนุมัติการเบิก" is one choice (approve, reject, record and void a payment) and counts as chosen only when a role holds all of it (`coveredPacks`). Its description, "ดูและอนุมัติ/ปฏิเสธคำขอเบิก", does not say it pays. So "a company admin may remove the pay right and it is not given back" has no path on the web; the guide says what happens when it is removed and not how.
2. **"คิวการเงิน" is shown by the finance-review right, whatever the company's switch.** The owner of a shop with no finance desk has a tab of that name holding the claims that wait for payment, with the empty text "ไม่มีรายการรอการเงิน". It is the one place a shop without the step still reads "การเงิน". The guide explains it; whether the tab should be named so is a product decision.
3. **Two texts still say finance pays or edits**, outside this lane's files: the expense page's "ระบบบันทึกการชำระให้อัตโนมัติเมื่อการเงินบันทึกจ่ายใบเบิก" (`ExpenseReviewPage.tsx`) and the claim form's "เฉพาะผู้ขอหรือฝ่ายการเงินเท่านั้นที่แก้ไขคำขอนี้ได้".
4. **One switch, three names.** The policy page labels it "ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้"; the refusal `self_approval_denied` quotes it as "อนุญาตให้อนุมัติคำขอตนเอง"; and the tab "ตั้งค่านโยบาย" is called "ตั้งค่าเบิกจ่าย" by that refusal, by the step notes and by the button "ไปที่ตั้งค่าเบิกจ่าย".
5. **Latin letters on the screens**: the badge "เกิน SLA", the field "SLA (ชั่วโมง)", the card "การเงินและ SLA". The guide has to quote them; the spec lets `SLA` through for that reason.
6. **Four words for the requester**: "ผู้เบิก" (claim page), "ผู้ขอ" (list, search), "ผู้ยื่น" (the "อยู่ที่" line of a draft, the timeline), "ผู้สำรองจ่ายและรับเงินคืน" (the form). And the role is "แอดมิน" on the policy page and "ผู้ดูแลบริษัท" on the payout account card.
7. **Two statuses nothing produces.** No code path sets a claim to "เพิกถอน" or to "จ่ายบางส่วน" (a payment is voided, never the claim; a part payment is refused). The guide says they are found on old claims only.
8. **An approver without the finance tab is not warned of a possible duplicate in the queue.** The "อาจซ้ำ" badge is on finance-queue rows only; on the claim page it is one row of "ข้อมูลคำขอ", and then the pay step's "ติดรายการซ้ำ".
9. **The missing-signature dialog says to wait** ("รอให้ลายเซ็นมีสถานะพร้อมใช้งาน", and `claim_saved_signature_required` says "รออนุมัติลายเซ็น") while the signature page says "ใช้ลงนามได้ทันที". The guide says only to save a signature and come back.

## Artifacts

- Web: `apps/web/src/features/user-guide/reimbursement-guide.content.ts`, `apps/web/src/features/user-guide/user-guide.content.spec.ts` (section count, the staff reader's shortcuts, and three checks: the two anchors, the quotes, plain Thai with money as "1,234.50 บาท").
- AI gateway: `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` (one hash).
- Docs: `docs/specs/reimbursement-step-journey-spec-th.md`, this note.
- No migration, no contract, no API or screen code, no `package.json`, no file hashed by the W00 manifest or the maintenance pins.

## Verification

Run on 2026-10-02 at the code head `17a195453` (the commit before this note).

- Typechecks: the web package script (`next typegen && tsc --noEmit`) exit 0 on the first version of the guide; the native compiler as CI runs it (`tsconfig.typecheck.json`) exit 0 with the spec's checks in; the ai-gateway package script exit 0.
- `user-guide.content.spec.ts`: 10 of 10. Mutation checks, one edit each, all caught: a button label shortened ("บันทึกร่าง"), a label that is on no screen, another unknown label of the round, the exception removed, a currency code, money without decimals, an anchor renamed.
- The guide's quotes against the correction-round web branch at `a3061d871` (its files read with `git show`, a script outside the repo): 137 quotes, none missing, and the exception would have ended.
- `ReimbursementPages.plain-thai.qa.spec.ts`: 21 of 21. Every web spec of the reimbursement and user-guide features: 337 of 337.
- Whole web suite `pnpm --filter @watchdog-bms/web test`: 2422 of 2422.
- `approved-knowledge.spec.ts`: 9 of 9 with the new pin, 8 of 9 with the old one.
- `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0, 12 suites. W00 manifest parity: 4 of 4, nothing regenerated. Maintenance pins `--check`: current. `git diff --check`: clean.
- Browser at 390 px: the real route `/companies/:companyId/user-guide/reimbursements` of `next dev` from this worktree, inside the real app shell. No backend: a throwaway stand-in outside the repo answered the session lookup and nothing else, so the shell's company and branch pickers showed their retry state. With all 21 sections and all 22 answers open, the page is 390 px wide (no horizontal scroll), nothing in the guide is wider than the screen or clipped, and every section summary fits its two lines. Read section by section for wrapping; two sentences that left a lone "ๆ" at a line end were reworded.
- No AI model call was made.

Not run: Playwright e2e, the API suite (no API code changed), a real-model check of the help cards (none is owed: no card changed).

## Next

- Coordinator: merge with the correction-round web branch. The quote check then holds its five words against the real screens; if a label there changes, the spec names it and the guide and the pin move with it.
- Coordinator: decide the findings above, tick plan 4.5 and 4.6, and send the owner the release note.
