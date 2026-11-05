# Agent Memory: expense-goal-program-2026-10-26

Status: SPECS + PLANS ACCEPTED 2026-11-04 for steps 1–4 and 6–11 (step 5 is owner-present ops). All are re-anchored to develop e7c422802. Owner answered every summary question on 2026-11-04 (see Owner answers). Owner gave the go 2026-11-04 (step 5 last).
Owner: platform (owner sets order and business answers; Codex writes; controller reviews and lands)
Scope:
- Owner 2026-10-26 instruction: "จากข้อ 1-11 ให้ ทำ spec + plan อย่างละเอียดสามารถ ตรวจสอบย้อนกลับได้ และ implement ตามได้เลย ระวัง bug gap impact ทุกฟีเจอร์โมดูลที่เกี่ยวข้อง อย่าทำเกินฟีเจอร์ที่เปิดขายอยู่ ทำแค่สูงสุดคือตามฟีเจอร์ pack 1999 ให้ codex ช่วยทำ และคุณรีวิวให้คำปรึกษา".
- Goal and order: `docs/agent-memory/expense-leadership-specs-2026-10-23.md`, section "Owner order (2026-10-26)".

## Decisions
- **Ceiling.** Build only what the 1,999 pack sells: `STARTER_FEATURE_KEYS` plus `wht_pnd53` and `wht_50bis` (`packages/contracts/src/menu-entitlements.ts:432-501`). Any requirement aimed at an unsold module is removed or kept as a pure side effect, and recorded below.
- **Who does what.** Codex lanes write the specs, plans and code. The controller checks every claim against the code before it lands, runs the real-database, journey and browser checks, and commits. Landing is a direct push to develop and main with the same tree. No PR, no Actions, no deploy without the owner's word.
- **Traceability.** Each spec carries requirement ids (R…) mapped to evidence, plan step, test file and name, and acceptance row. This file maps owner steps to those documents and, later, to commits.

## Step map
| Step | What | Spec / plan | State |
|---|---|---|---|
| 1 | Security and file-safety fixes: attachment complete/delete scope, extraction scope, PDF scanner both ways, LINE substitute typed answer; G2 upload-intent branch (R11) and G3 signature-fill branch (R12) added 2026-11-04 | `docs/specs/expense-trust-and-money-fixes-spec.md` + plan | accepted 2026-11-04 (R1–R12, P01–P14; R11/R12 checked against `create-upload-intent.use-case.ts` and `signature-asset.use-case.ts`) |
| 2 | Unusable AI output not charged | same, R6 | accepted 2026-11-04; free quota already releases on unusable OCR (049aa51de), paid settlement fix remains |
| 3 | Customer-visible double counts; substitute category before confirm | same, R7–R9 | accepted 2026-11-04 |
| 4 | ภ.ง.ด. paper blocked while payments are missing | same, R10 | accepted 2026-11-04 |
| 5 | Dated ops: laptop deploy key rotation (window B, 2026-11-04); homepage release, ALB text and UAT AI lock in one window; help-pack review by 2026-12-18 | `docs/plans/ops-followups-2026-10-23-plan.md` | owner-present work; no spec change |
| 6 | Plain words on sold screens and in LINE; exact terms in reports | `docs/specs/plain-words-sold-screens-spec.md` + plan | accepted 2026-11-04: exhaustive for sold + free surfaces; 76 C rows; gaps outside wording recorded as B18–B23 |
| 7 | Accountant export cleanup | `docs/specs/accountant-export-cleanup-spec.md` + plan | accepted 2026-11-04: RC-F2 intersect first; 0.2 free-export guard; Phase S handed to trust/money P03; E5/posting cut |
| 8 | Accounting-software export (FlowAccount first) | `docs/specs/accounting-software-export-spec.md` + plan | accepted 2026-11-04; owner 2026-11-04: FlowAccount not renewed, so Phase 1 (accountant codes + purchase journal) starts first and the FlowAccount preset waits for a customer's template, like PEAK/Express |
| 9 | LINE AI workflow-first | `docs/specs/line-ai-workflow-first-spec.md`, `docs/specs/line-ai-measurement-and-eval-spec.md` + plan | accepted 2026-11-04: R4-F2 closed; 20 eval conversations restored (count corrected 2026-11-04); R26 package/knowledge fallback; R27 free no-AI |
| 10 | Weekly LINE summary | `docs/specs/proactive-expense-summary-spec.md` + plan | accepted 2026-11-04: ledger menu and ภ.พ.30 row cut (ceiling); R19 paid-only eligibility, free shops get no weekly summary; owner 2026-11-04 redesign (ceil9:5/6): shop-chosen day (R20, membership cursor, no seven-day cap for continuing recipients, C1 closed by controller), owner on by default, others picked in shop settings under company.setup.manage (R21), home invite removed |
| 11 | e-WHT incl. per-shop setting | `docs/specs/e-withholding-tax-payment-spec.md` + plan | READY; traceability, B5 note and free-path note added; citations re-anchored 2026-11-04 |

## Ceiling findings (controller, 2026-10-26)
- **Step 10, goal 5 and the link targets.** The spec adds a menu item "รายจ่ายตามหมวด" that opens `/income-expense-ledger`. That page belongs to the accounting-documents module and has no sold menu entry; `route-permissions.ts:75` lets `expense.read` reach it. The card also links there. This exposes an unsold page, which also mixes currencies (bug B8 of that spec). It is out of the ceiling: drop the new menu item and link only to sold pages (home page, expense list).
- **Step 10, ภ.พ.30 due-date row and Q6.** VAT/ภ.พ.30 is not sold, so drop the row. Keep the ภ.ง.ด.3/53 rows: they come from expense WHT data, which every pack has.
- **Step 11, B5.** The fix limits issue resolution to WHT periods. Its effect on ภ.พ.30 blockers reaches only shops that hold the unsold `thai_tax` feature. Keep it as a side effect only and add no work for ภ.พ.30.

- **Controller error, corrected 2026-11-04.** The ceil9 brief said "cut eval cases aimed at unsold intents". Codex then cut the cases that check two things: general-knowledge answers (for example how VAT 7% works) and the fixed package reply for unsold modules. The owner set both behaviours for every package on 2026-09-29. Round ceil9:3 restores those cases. New work for unsold modules stays out.
- **Develop drift, 2026-11-04.** 371 commits landed after the 10-26 base. Three of them matter here: free source drafts for never-paid shops (3 reads a month, model-free commands only), the LINE new-shop welcome/package advisor, and expense activity history. The free path now guards upload-intent branch and extraction scope; the paid path still has G2/R3. Every fix must cover both paths.

- **Follow-ups outside steps 1–11 (found 2026-11-04, not scheduled):**
  - B21: `/income-expense-ledger` is unsold but `expense.read` reaches it by typed URL.
  - B22: free shops get an account link that the shell denies.
  - B18/B23: the daily summary and the deal-ending notice go to OWNER/ADMIN by right.
  - Daily summary has no free-cohort exclusion.
  - Four free-mode spec files are unregistered.

## Owner answers (2026-11-04)
- Step 2, past charges: "ข้อ 2 ไม่ต้องคืน". No historical credit or refund; the forward-only R6/P07 fix stays.
- Step 10, weekly summary: "ควรเปลี่ยนวันได้และคนที่ได้รับแจ้งเตือนให้ set ตามสิทธิ์ได้และเจ้าของกิจการเป็น default เสมอ".
  - The shop picks the send day.
  - Recipients are picked in shop settings from the people who hold the read right.
  - The business owner is on by default.
  - This is an owner exception to "notify only the person concerned", for this notice only.
  - Redesign in ceil9:5.
- Everything else: "ที่เหลือทำตามแนะนำได้เลย". Every other question takes the recommended answer, recorded in each spec by fixdoc:4.
  - B18: the daily summary keeps its recipients until R10 retires it.
  - B23: the deal-ending notice keeps going to OWNER. This is an owner exception.

## Open questions
- None waiting on the owner, except the go to start coding.
- Q5 LINE budget: the controller checks the OA package before release and proposes a figure.

## Artifacts
- Codex lane logs (local, not in git): `mangmee-worktrees/codex/lane-{fixdoc,wordsdoc,blkrev,ceil7,ceil9}/`; briefs in `codex/briefs/` (`goal-*-2b.md`, `goal-wordsdoc-3b.md`, `goal-ceil7-2.md`, `reanchor-20261104.md`).

## Implementation log (owner go 2026-11-04: steps in plan order, step 5 last)
- **Batch 1, landed 2026-11-04.** develop `99f127a64`, main `13a444a56`, same tree.
  - Step 1 (trust/money): P01 `c82d1237a`, P03 `ba4426193`, P02+P13+P14 `b45745e3d`, P04+P05 `6b987e237`.
  - Step 7 (export cleanup): 0.1 RC-F2 `7c606db2d`, 0.2 free denial `23eebd2cd`.
  - Step 9: M1a `97097c31b`.
  - Test-only repairs of develop drift: `4cb980091`, `2846c00de`, `3d55d9a40`, `99f127a64`.
  - Free draft shop seed and journey: `86c96153a`. Pins: `28719e37b`.
- **Batches 2–5, landed 2026-11-04.**
  - Batch 2 (`86712e40b`): step 7 Phase 1.1–1.5.
  - Batch 3 (`e0af66dd2`): P06, P07, QA refusal fix.
  - Batch 4 (`6fdfb9807`): step 3 P08–P10, step 7 Phase 2, journey fixes.
  - Batch 5 (`ad611aa61`): step 8 Phase 1.1–1.3, including the migration.
  - M1b part 1 + M1c (`dbf2f5982`).
- **Batch 6, landed 2026-11-04.** develop `fd46cc2e2`, main `c2da8c2ff`. Step 4 P11+P12, plus:
  - the legacy frozen-paper PG test, rewritten against real payments;
  - controller fixes: the who-can-fix tail only on visible items, and the R10 journey setup.
- **Batch 7, landed 2026-11-04.** develop `3c23aab83`, main `316dac214`.
  - Step 8 Phase 1.4–1.5. The controller restored the deprecated `columnSet` API compatibility.
  - Step 7 Phase 3.2+3.4. The repair script writes only with `--apply`.
  - Owner Q3: LINE answers the ภ.ง.ด.53 due date.
- **Batches 8–9, landed 2026-11-04.** develop `2637be6a6` / `e7eabbbad`: step 7 Phase 3.3/3.5/3.6, owner Q4 (LINE answers whenever possible), LINE read retry.
- **Batch 10, landed 2026-11-04.** develop `e28e60601`, main `a28938740`, same tree. Verify 19/19 GREEN (API 12.9k, web 5,161, gateway 2,704, whole-chain 5,663); real-PG 9 files GREEN; journeys 99/99 on a fresh DB.
  - Step 6 plain words, rounds 1–10 (P1–P6.4). Owner approved the help wording in chat on 2026-11-04 ("ตามแนะนำ", all 21 items) → help pack v7, public FAQ, guides.
  - Bug fix: help-card data reads (ภ.ง.ด.53 due date, package quota/renewal/expiry, claim approval, notifications, ภ.ง.ด.53 preparation) were refused on the general/help path ("ยังตรวจสอบคำตอบครบทุกส่วนไม่ได้ค่ะ"); now delivered with permission/feature rechecks.
  - Bug fix: the getting-started guide turned null entitlements into [] and hid 11 of 16 sections for shops without entitlement rows.
  - Old PG-only test pin: approved voucher reminder reads "อนุมัติแล้ว รอจ่าย".
  - Plan docs: step 9 cost-first order (owner 2026-11-04 "ก่อนทดสอบ ai ให้แก้เรื่อง ลดค่าใช้จ่ายเอไอ และ แคชก่อน"); CACHE-1 decided from Production counts: keep the 5-minute cache.
- **Batch 11, landed 2026-11-04.** develop `3e581fd12`, main `a9a857ee8`. Step 6 P6.5 closing journeys, plus a 390 px top-bar overflow fix (real bug: switchers and page title wider than the phone).
- **Batch 12, landed 2026-11-05.** develop `94001693e`, main `638d3ec4e`. Fixes from a free-shop customer ticket (2026-11-04):
  - marketplace receipts take the seller from the "ผู้ขาย" field, not the platform header;
  - a 13-digit run beside a phone number is not a tax id;
  - "คูปอง" counts as a discount;
  - document numbers with I/O go to review;
  - free shops get a package way out;
  - the expense list can count by "วันที่ส่งเข้า";
  - file types are written in English (JPEG, PNG, HEIC, HEIF, GIF, PDF);
  - LINE company switching shows "บริษัท n · ชื่อร้าน" instead of the id.
  - A web suite went out red (owner-role wording); fixed in batch 13. Lesson: list every RED line before pushing.
- **Batch 13, landed 2026-11-05.** develop `4c65362b2`, main `8b96ee08f`. Step 9 Phase A1–A7.
  - The LINE basis line says "รายการที่ยังไม่ยืนยัน".
  - lm1 M2/M-R6/M3 tuning corpus.
  - The task-run insert is atomic (`createMany` + `skipDuplicates`; the R24 real-PG race caught it).
- **Batch 14, landed 2026-11-05.** develop `5ce1f50e4`, main `a740d7279`. Step 11 e-WHT code (Phases 1–4).
- **Batch 15, landed 2026-11-05.** develop `214e91102`, main `0badd6c2a`. Step 9 Phase A4b: substitute-receipt and seller pickers without a model.
  - MC2 closed: LINE lists are read-only, and the signed continuation is unchanged.
  - Several matching sellers show up to 3 names plus the web exit.
  - Verify: one API spec process hung about 7 h while the laptop slept. The controller stopped its own pid and reran the file alone (GREEN).
  - Journeys 107/108: the PWS-CHAIN seller field empties after save about once in 6 runs. The cause is a stale `getExpense` overwriting the saved draft; it is pre-existing, and lane sd1 is fixing it.
- **Batch 16, landed 2026-11-05.** develop `f980b42f3`, main `c700760d5`.
  - Free-shop month summary command (fl1).
  - Stale-read guard on the expense review page (sd1, fixes PWS-CHAIN).
  - Harness r8.
- **Batch 17, landed 2026-11-05.** develop `16094beeb`, main `9292cac6e`.
  - A8 whole-chain scenarios (24→41) and `line.workflow_control`.
  - Free-answer scoring (lm1 r10).
- **Batch 18, landed 2026-11-05.** develop `8fd5d664c`, main `43cc952d7`.
  - `run-real` runs v2 corpora (lm1 r11/r12).
  - e-WHT read-only Production results.
- **Owner 2026-11-05, bill line limits:** "ตรวจทุกฟีเจอร์ที่เกี่ยวข้องกับรายการจ่ายในบิล ควรมีได้สูงสุด 30 รายการ", then agreed that rows inside one bill follow the AI read.
  - Rows inside one bill: `EXPENSE_MAX_ITEM_LINES` = 200 everywhere (OCR, substitute receipt, typed drafts). The substitute receipt's 8-row limit was what blocked the owner's claim.
  - Bills per voucher: 30. Bills per claim: 50, unchanged.
  - The LINE intake still offers 20 bills per voucher until a paired live calibration (credit-levers procedure). Its card shows the count and the web exit.
- **Owner 2026-11-05, real-model budget:** "อนุญาตให้ใช้เกินได้ นิดหน่อย 2,100-2,300 อนุมัติ".
  - M4 runs tuning workflow, held-out workflow and advisor held-out, capped at 2,300 THB in total, re-runs included.
  - A 2-conversation Bedrock smoke found three problems:
    - LINE claims typed over several messages never reached a draft (`invalid_provenance` on re-sent values; live since 2026-10-17);
    - turn-agent calls cached only the system prompt (about 2.6–2.9 THB per warm write turn);
    - three harness bugs.
- **Owner 2026-11-05, "AI ต้องอ่านถูก":** marketplace receipt reading was fixed against the 3 real images on Bedrock.
  - Results: seller, receipt number, every row, discount and delivery are right on all three. One look-alike Thai letter (ฎ/ฏ) stays ambiguous at 22 px.
  - Tall images are read as tiles the provider does not downscale, at about 3.5 THB per tall receipt.
- **Batch 19 (this batch):**
  - harness r13;
  - the LINE multi-message claim fix;
  - turn-agent cache points;
  - the marketplace OCR fixes;
  - bill line limits.
- **Owner 2026-11-05 ("ทำตามแนะนำ"), from the free-shop ticket:**
  - free shops get a model-free month summary command in LINE (lane fl1);
  - a stranger who types before linking gets one line before the door card, which reverses the 2026-09-21 card-alone rule (lane fl1);
  - the customer's two wrong drafts are repaired after a read-only Production check and the owner's OK on the change list.
- **Held (not on develop):**
  - step 10 weekly summary (lane ws1) through 5.5 journeys: waits for the controller's fake-LINE proof and the LINE OA cost figure (5.5);
  - step 11 Phase 5: docs, rollback set R (BL1 independent review) and read-only Production checks BL3 + REDUCED-rate-1 count (owner MFA); UAT on the owner's order;
  - step 9: A8 release gate, then M4, the one real-model run (held-out workflow corpus round 2 in lane ho1).
- **Owner 2026-11-04:** LINE follow-up questions approved ("ได้ ตามแนะนำ"): remember the last card id, explain it more simply from approved text, due-date follow-ups and ภ.ง.ด.3; one real-model test run after the cost work (within the 2,000 THB programme cap).
- **Later:** step 7 Phase 4; step 9 M3/M4 and Phases B–C; step 5 last, with the owner.

## Verification
- Batch 1 checks:
  - `scripts/local-proof/verify.sh`: 19/19 GREEN (API 12.7k, web 5,113, gateway 2,583, whole-chain 4,151);
  - real-PG: 718/718 (9 files);
  - proof journeys: 91/91 on a fresh DB;
  - M-14 with ClamAV 1.5.4: all checks pass;
  - 18 repo/generated PDFs scanned old vs new: only the RD fillable forms with JavaScript are refused.
- Baseline before batch 1: a clean develop had 75 API, 4 web, 1 gateway and 1 W00 failures (drift from 049aa51de with Actions off), all repaired test-only.
- **Owner FYI:** 049aa51de shortened the LINE follow-welcome without a spec record. The test now pins the current text, and nothing changed for customers.

## Next
- Done 2026-11-04: reviewed fixdoc:3, ceil9:3/4, wordsdoc:4 and ceil7:2 against e7c422802; landed on develop and main.
- Done 2026-11-04 (later): owner answers recorded (fixdoc:4) and weekly summary redesigned (ceil9:5/6); controller reviewed and landed docs only.
- Owner reading file (untracked, shared checkout): `docs/research/owner-summary-expense-steps-1-11-2026-11-04-th.md`, with 22 decisions and recommendations.
- On the owner's go: implement in order, starting with trust/money P01–P14 round 1 (Codex lanes; controller reviews, runs real-PG/journey/browser checks, lands).
- **No code until the owner says so.** Owner, 2026-10-26: "ยังไม่ต้องโค้ดนะ spec และ plan. เสร็จแล้วสรุปให้ฉันอ่านเป็นภาษาไทย เข้าใจง่ายก่อน".
