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
- **In progress (Codex lanes):**
  - step 1 P06 (receipt XML);
  - step 7 Phase 1.4/1.5 (committed 1.1–1.3 `163869f24` in the lane worktree);
  - step 9 M1c (M1b part 1 committed in the lane worktree).
- **Later:** steps 2–4 (P07–P12), then 6, 8, 10, 11; step 5 last with the owner.

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
