# LINE AI Workflow-First Plan

Status: DRAFT — documents only; R4-F2 CLOSED (focused review 2026-10-26); owner Q1–Q3 answered 2026-11-04; MC1 CLOSED (existing R21/AC11 design); A9/A10 moved to expense-trust-and-money-fixes; per-step engineering prerequisites remain; Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R26 package/knowledge fallback and R27 free no-AI admission checked against code); owner answers recorded 2026-11-04
Owner: LINE AI documents lane; controller assigns implementation
Related: `docs/specs/line-ai-workflow-first-spec.md`, `docs/specs/line-ai-measurement-and-eval-spec.md`
Memory: `docs/agent-memory/line-ai-workflow-first.md`
Baseline: HEAD `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, re-opened in this worktree 2026-11-04; earlier measurements and review dates remain historical
Scope: วัด baseline (Phase M) → งานซ้ำไม่เรียกโมเดล (Phase A; charging inherited from trust/money P07) → ข้อความงานซ้ำเรียก classifier ครั้งเดียว (Phase B) → Haiku 5.5 ให้ classifier (Phase C) → ปิดงานเอกสาร (Phase D)
หลักการ: ponytail full — reuse ที่เก็บสถานะเดิม, open token แบบเดิม, postback `chat-action` เดิม, `LINE_CHAT_ACTIONS` เดิม, use-case รายการของเว็บ (+ ทางอ่าน LINE ที่ตรวจสิทธิ์ชุดเดิม), `LineDraftPreviewStore` เดิม; ไม่มีสวิตช์; ไม่เพิ่ม dependency (ยกเว้นอัปเดต SDK ถ้า MC4); invariant ของ turn grant ไม่เปลี่ยน; ทางแก้ใบเบิกเดิมไม่เปลี่ยน

## กติกาการทำงานทุก lane

- worktree แยกต่อ lane, stage ทีละ path, ไม่ `git add -A`, ไม่ `git stash`, ไม่ pkill ตาม pattern
- ไม่ trigger GitHub Actions/PR; ตรวจในเครื่อง แล้ว controller push ตรงเข้า develop + main (คำสั่ง Owner 2026-10-20)
- ไม่แก้ `package.json` (ยกเว้น dependency); **assertion ใหม่ของ API อยู่ในไฟล์ที่ลงทะเบียนใน `apps/api/package.json` เท่านั้น** — invariant เงินกับ PostgreSQL จริงอยู่ใน `src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (ลงทะเบียนแล้ว มีแบบทดสอบ "real PostgreSQL:" ที่ :262–268); gateway อยู่ในไฟล์ที่ลงทะเบียนใน `apps/ai-gateway/package.json`
- คำตรวจต่อ step (คำสั่ง Owner 2026-09-21): typecheck แพ็กเกจที่แตะ + spec ที่แตะ; step ที่แตะ LINE รัน whole-chain ก่อน push
  - `pnpm --filter @watchdog-bms/contracts build`
  - `bash scripts/local-proof/tsc.sh api` / `pnpm --filter @watchdog-bms/ai-gateway typecheck`
  - `pnpm --filter @watchdog-bms/api exec node --import tsx --test <spec ที่ลงทะเบียน>`
  - PG จริง: `scripts/local-proof/realpg.sh <tag> src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (ตั้ง `DATABASE_URL` ให้, realpg.sh:12)
  - regression PG เดิม: `BILLING_TEST_DATABASE_URL=<local> node scripts/run-line-ai-whole-chain-acceptance.mjs --reliability-postgres`
  - whole-chain: `node scripts/run-line-ai-whole-chain-acceptance.mjs`
  - W00: `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` → อ่าน diff → รันซ้ำไม่มี UPDATE
- พร้อมกันไม่เกิน 3 lane บนเครื่อง 16 GB

## Re-anchor and preserved paths — 2026-11-04

All citations target develop `e7c422802`. No old finding is claimed fixed without current code. Historical measurements remain historical. The current B1–B8 and MB1–MB3 evidence still shows the recorded gaps; moved trust/money work is not duplicated.

| Develop change / evidence | Plan adaptation | Requirements / first checks |
|---|---|---|
| `049aa51de`: free access already returns before paid intake (`apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6942`) | A1 preserves this commercial gate and fixes G21 same-message recovery with existing helpers; B4 inserts classifier only after it. No new free tier, allowance implementation or general Q&A. | R27/AC26; webhook `R27 free commands and welcome bypass every text model call` before B4; API and TYPE_API |
| `9036b8552`: welcome receipt alias and package-advisor URI exist (`line-staff-menu.logic.ts:885`; `apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:456`) | A6a/A6c must preserve receipt, services, support/company/package entry points and URI handoff; never classify a URI tap or rebuild package advice. | R15/R23/R27; same R27 webhook regression; browser handoff at 390/1280/~1556 during implementation |
| `3f6db1729`: recipient-bound accepted duplicate confirmation is suppressed (`process-line-webhook.use-case.ts:3717–3731`) | Shrink A5/A8 replay work to integration regressions around the existing suppression; retain expiry/recovery work only. | R3/R25/R27; existing webhook regressions plus R27 before A8 |
| `48295b57c`: company-picker message-action text already survives delivery (`apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14`) | Preserve the existing display-only sanitization; no picker-delivery fix. This change is in the visible-text transformer, not a new buffer fast path. | R3/R23/R27; retain registered `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts` — `sends real company IDs unchanged in picker actions on reply and push` |
| Current buffer still excludes company commands from its fast path (`line-message-buffer.service.ts:510–511`) and worker awaits dispatch (:707); singleton groups (`line-message-buffer.logic.ts:399–401`) and orphan envelope (`recover-orphan-line-events.use-case.ts:89,233`) remain | R4-F2 stays CLOSED. A2 excludes only its three new controls from fast path and retains AC22 fresh/frozen/company-order tests; no new company-selection implementation. | R23/AC22; registered buffer/logic specs before A2 |
| `1fbba874e`/`884ba5307`: concise modal already exists (`apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`) and its route is free-allowlisted (`apps/api/src/modules/system-partner-management/application/free-expense-access.ts:78`) | No history modal/API implementation; preserve normal source-update/audit behavior, no save caused by opening cards/history. | R4/R21/R27; normal permission regression, no new history test file |

Prompt/calibration correction is documentation only: reuse the two reviewed rows in `apps/ai-gateway/src/common/usage/intake-token-calibration.ts:9–16` (`62d6b4393`); drop the stale fixed prompt-character count. B6 remains conditional on new telemetry, not a repeat of existing credit levers.

Each step uses workflow §5 path applicability: paid workflow/classifier steps remain paid; free carries only the shared identity, permission, wording and ordered-delivery rules plus R27. The existing free source quota/attachment/commercial gates are reused unchanged. M2/M3 add free fixtures; M4/B5 report free zero-model-call checks separately from paid advisor quality/cost.

## ลำดับที่บังคับ

```
M1a → M1b → M1c → M2 → M3 → M4 (baseline; measurement Q1/workflow Q3 answered 2026-11-04: 2,000 THB ทั้งโปรแกรม)
A9 → moved to expense-trust-and-money-fixes, step 2 / P07 (R6); no duplicate implementation
A2 → A3a → A3c → A3b ; A1 → A3b ; A2 → A4a → A4b (MC1 closed 2026-11-04; ต้องปิด MC2) ; A10 → A4b (ใบทดแทน) ; A2 → A5 ; A1 + A2 → A6b ; A2 → A6a ; A6c อิสระ ; A7 อิสระ
A10 → moved to expense-trust-and-money-fixes, step 1 / P04 (R5) + step 3 / P10 (R9)
(A1..A10) → A8 (release Phase A)
B1 (probe, MC3/MC4) ขนานกับ A ; B1(ผ่าน) → B2 → B3 → B4 ; A3c + A4b + A8 → B4 ; M3 + B4 → B5
B5 + Q2 authorized 2026-11-04 + MC5 → C1 → C2 → C3 (MA4 + controller privacy gate before switch)
D หลังแต่ละ release
```

**Owner order, 2026-11-04 (supersedes "measure first" for spending only).** The owner said "ก่อนทดสอบ ai ให้แก้เรื่อง ลดค่าใช้จ่ายเอไอ และ แคชก่อน", then "ทำตามที่แนะนำได้เลย". The order is:

1. **No model spend.** Phase A (A1–A7) runs first, and A1 no longer waits for M4. In the same stretch:
   - the 1-hour prompt-cache decision (CACHE-1 below);
   - the LINE follow-up code (plain-words spec Q5).

   M1b, M1c, M2 and M3 continue offline: corpus, scorer, seed and oracle, with no real-model run.
2. **One real-model run.**
   - It is M4's baseline for Phases B and C, measured after Phase A.
   - It also serves as A8's typed-journey replay.
   - It includes the follow-up conversations.
3. **Then** Phase B, Phase C and their own runs, all inside the 2,000 THB programme cap.

**CACHE-1.** Bedrock Converse accepts `cachePoint.ttl: "1h"` for `global.anthropic.claude-sonnet-4-6`. The trade-offs:
- a 1-hour write costs 2× input ($6/MTok against $3.75 for 5 minutes);
- the cold-cache hold rises from about 9 to about 13 THB per intake;
- reads are unchanged.

Decide from a read-only Production `AiUsageEvent` count of cold writes by gap since the previous call (under 5, 5–60, over 60 minutes). Turn it on only if the measured saving exceeds the extra write cost. Then the spec, the pricing (`ai-model-pricing.ts`, `LINE_V2_TARIFFS`) and the hold calibration change together.

**CACHE-1 decided 2026-11-04: keep the 5-minute cache.** Production read-only count, 2026-10-20 to 2026-10-31: 126 model calls from 5 shops on 5 days.
- `line.intake-route`: 15 calls and 9 cold writes of about 24,600 tokens. Their gaps since the previous call: 0 under 5 minutes, 1 at 5–60 minutes, 8 over 60 minutes. Cache writes are 27.9 of 36.8 THB, so about 2.45 THB per intake. With a 1-hour TTL the cache part would rise from 29.4 to 41.5 THB, even optimistically.
- `ocr.receipt.extract`: 22.6 against 23.0 THB, no gain.

The cost lever is therefore the **size** of the cached prefix and the **number** of calls: Phase A (Tier 0) and Phase B (a classifier prefix of about 2,500 tokens), not the TTL. Re-check CACHE-1 when traffic leaves fewer than one hour between calls.

---

## Phase M — วัดก่อนแก้

### M1a Runtime ของการเล่นซ้ำ
- `scripts/line-ai-reliability-runtime.ts`: action ตามชนิด (postback/message/uri/camera) + `pressFrom` ข้าม actor (ขยาย :132–139); `EFFECT_TABLES` (:201–204) เพิ่มตารางตาม measurement spec §11; `businessSnapshot` + `unintendedEffects` ต่อ turn
- callback `onTurn(evidence)` และ **`onBeforeReset(conversation, attemptId)` เรียกก่อน `resetRuntimeFixtureDatabase` (:372)** เพื่อให้ harness อ่านการจอง/usage ของบทสนทนาก่อน truncate (:92); prefix ของ event id ใส่ `attemptId` (:436 วันนี้ = `sha(id:repeat:turnIndex)`) ให้ invocationKey ไม่ชนข้าม attempt (MB3)
- แยก effect เป็น `business`/`collectionState` ตาม measurement M-R6 (`ReimbursementDraftAction` COLLECTING, `ExpenseRecord.sourceChannelMetadataJson` + `updatedAt`/`updatedByUserId`, ตาราง log/usage/การจอง)
- snapshot หลายบริษัท/หลาย actor (actor = บริษัท + บทบาท + ขอบเขตสาขา); instrument `requestLineWorkflowClassify` (เพิ่มในรายการ :415 — ใช้ได้เมื่อ B4 มี method); fixture ops `expire`/`mutate`/`setCredit`
- ค่าตั้งต้นของความสามารถใหม่ = พฤติกรรมเดิม
- ตรวจ: `node_modules/.bin/tsx --test scripts/line-ai-reliability-runtime.spec.ts` (เพิ่มเคสในไฟล์เดิม: hook ก่อน truncate, event id ต่าง attempt ไม่ชน, collectionState ไม่นับเป็น wrong)

### M1b Corpus v2 + scorer (ขึ้นกับ M1a)
- M-R14/R26/R27: retain the 20 knowledge/package-boundary conversations listed in measurement §3 (T-139 included; corrected 2026-11-04), original ids and whole conversations; identical manifest/digest for baseline/candidate. Add free/paid matched inputs without enabling unsold modules; no new unsold formatter/conversion/workflow/tool/read.
- `scripts/line-ai-expense-advisor/types.ts`: `Actor/WorkflowTurn/GoldRecord/WorkflowTask/WorkflowConversation` + validator (`confirmTurn` + `expect.preview` บังคับสำหรับงานเขียน; `EXPENSE_PAID` ↔ `ExpensePayment`, `REIMBURSEMENT_PAID` ↔ `ReimbursementPayment`, `VOUCHER_PAID` ↔ `DisbursementVoucher` พร้อมยอด/วันที่/วิธีจ่าย; `phase: 'collect'`)
- `scripts/line-ai-expense-advisor/scorer.ts`: W1–W15, M-R5/M-R6 (เฉพาะส่วน `business`), ต้นทุนไม่ปัดทุกส่วนของ tariff + ตรวจคู่การปัด (M-R3), cold/warm (M-R12), attempt (M-R13)
- `scripts/line-ai-expense-advisor/run-preflight.ts`: `captureSpend` ก่อน truncate (:79); actor จาก `actors[]`/`as` แทน `companies[conversation.company]`/`conversation.role` (:129–130); บริษัท C; turn แบบ `press` (ไม่มี `calls`) ตรวจรูปแบบ แทนการวน `turn.expect.calls` (:134); `$seed` ของ GoldRecord resolve
- `scripts/line-ai-expense-advisor/report.ts`: ตารางก่อน/หลัง (§10)
- ตรวจ: `types.spec.ts`, `scorer.spec.ts`, `report.spec.ts`; `run-preflight.ts` กับ sample v2 (actor หลายคน + บริษัท C + turn กดปุ่ม)

### M1c run-real: checkpoint, ledger, attempt, provenance (ขึ้นกับ M1a, M1b)
- `scripts/line-ai-expense-advisor/run-real.ts`: `*.turns.jsonl`, `*.spend.jsonl`, `*.progress.json` (+ `inFlightAttemptId`); `attemptId` ต่อการรันบทสนทนา; `MANGMEE_EVAL_RESUME`; `captureSpend` ทุกจุดของ measurement §6.6 (เริ่ม/resume ก่อนสิ่งอื่น, ก่อน oracle truncate `gold-oracle-pass.ts:128` ที่เรียกจาก :216, ก่อน runtime reset, หลังบทสนทนาสุดท้าย) รวม ledger ตาม `invocationKey`; ติดตั้ง trigger `BEFORE INSERT ON "AiBudgetReservation"` + schema `eval_guard` ใน eval DB (measurement M-R9) และเขียน `eval_guard.ledger_satang` หลังทุก `captureSpend`; trigger เพิ่ม `eval_guard.cap_rejections` (sequence) ก่อน RAISE `EVAL_RUN_CAP` และ harness อ่านค่าก่อน/หลังทุก turn → `CAP_REACHED` (error ถูก `reserveAiBudgetStep` กลืนเป็น `reserve_failed` ที่ cbr:453–457 จึงใช้ error ไม่ได้); ปฏิเสธ Phase C เมื่อ transport ≠ bedrock (M-R2); provenance จาก usage + transport ของ launcher (แทน :220)
- `scripts/line-ai-expense-advisor/launch-gateway.mjs`: transport ที่ใช้จริงลง manifest
- `scripts/line-ai-expense-advisor/run-rescore.ts`: rescore จาก `businessSnapshot` (`MANGMEE_EVAL_EVIDENCE` + `MANGMEE_EVAL_CORPUS`, :46, :87)
- ไล่สูตร attempt key ของรูป/OCR แล้วบันทึกใน memory (MC7)
- ตรวจ: `run-rescore.spec.ts`; rescore evidence เก่าของ advisor คะแนนเดิม; จำลอง process ตายกลางบทสนทนาแล้ว resume — แถวค้างถูกบันทึกก่อน oracle truncate, ledger นับทั้งสอง attempt ไม่ซ้ำ, คะแนนใช้ attempt ที่ครบ; trigger กับ PostgreSQL จริง: test `real PostgreSQL: eval_guard …` ใน `scripts/line-ai-reliability-runtime.spec.ts` + entry ใหม่ใน `LINE_AI_RELIABILITY_POSTGRES_SUITES` (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:576`) ที่รันไฟล์นั้นด้วย `--test-name-pattern 'real PostgreSQL: eval_guard'` (วันนี้ `--reliability-postgres` รันเฉพาะ suite นั้น — `run-line-ai-whole-chain-acceptance.mjs:15`) — การเรียกที่ล้มแล้วบริษัทรับยังนับ, การจองที่ทำให้เกินเพดานถูกปฏิเสธก่อนส่ง, sequence เพิ่มแม้ reserve คืน `reserve_failed`

### M2 Seed + oracle (ขึ้นกับ M1b)
- `scripts/line-ai-expense-advisor/seed.ts`: ตาม measurement spec §6.4 (สามบริษัทใน snapshot เดียว, actor จำกัดสาขา, สมาชิกสองบริษัท, assignment ตรึง, > 300 ใบ, ค้างจ่าย > 90 วัน, ผู้ขายชื่อซ้ำ/ไม่ใช่คู่ค้า, เครดิตหมด)
- `scripts/line-ai-expense-advisor/oracle.ts`, `gold-oracle-pass.ts`: ตรวจ `GoldRecord` ทุกตาราง + `expect.preview` + แถวลูกที่สืบจาก parent (`ReimbursementApprovalStep`, `DisbursementVoucherLine`, `WhtCertificateHandoff`, `WhtCertificateHistory` — measurement M-R6); `captureSpend` ก่อน truncate (:128); actor จาก `actors[]`/`as` + บริษัท C แทน `companies[conversation.company]`/`company.users[conversation.role]` (:140–141)
- ตรวจ: `oracle.spec.ts` (อนุมัติใบเบิกที่เขียนขั้นอนุมัติ `prisma-reimbursement.repository.ts:1964` ไม่นับเป็นเขียนนอก gold; แถวลูกที่ไม่ผูก parent นับ); `run-preflight.ts` และ oracle pass กับ sample หลาย actor + บริษัท C

### M3 Corpus (ขึ้นกับ M2)
- M-R14/R26/R27: round-1 removals of knowledge/package replies are withdrawn. Retain their original ids, existing lower-pack WHT denials, and new boundary regressions; add a free-company fixture whose typed questions make no model call. Do not alter or truncate source conversations to satisfy minima.
- ชุดจูน `scripts/line-ai-expense-advisor/corpus.workflow.tuning.json` ≥ 240 turn / ≥ 80 บทสนทนา (≥ 60% typed journey)
- ชุดเก็บไว้ทดสอบ ≥ 150 turn / ≥ 50 บทสนทนา ตาม §15.1 โดย lane แยก เก็บนอก repo
- ตรวจ: validator; preflight oracle ผ่านทุกเฉลย

### M4 Baseline บน main (ขึ้นกับ M3; Q3/measurement Q1 answered 2026-11-04 — 2,000 THB ทั้งโปรแกรม)
- typed journey ทั้งสองชุด + retained advisor held-out (knowledge/package boundaries included) (measurement §3) บน commit ของ main ที่ระบุ
- บันทึกใน `docs/research/line-ai-workflow-baseline-2026-10.md` และ memory
- ตรวจ: รายงานครบ; ledger ≤ เพดาน
- **Status 2026-11-05:**
  - **Budget.** The owner raised the programme cap to 2,300 THB, re-runs included ("แผนทดสอบ AI จริง อนุญาตให้ใช้เกินได้ นิดหน่อย 2,100-2,300 อนุมัติ").
  - **Harness fixes before the run.** These landed on develop/main:
    - compact streamed turn evidence: the first full tuning run had run out of memory at 114 turns;
    - resume after a kill;
    - a 24-turn replay limit: one held-out chain has 22 turns;
    - permission-refusal gold checked against the role table: three tuning rows were wrong, because every role holds self-service claim permissions;
    - a new unscored refusal label `record`, for "the role may, this record may not". Four held-out rows were relabelled before the first held-out run, and no scored field changed.
  - **Running.** The baseline runs on main `efd65cbf5`: tuning, then held-out workflow, then advisor held-out.
  - **Sequencing.** It runs before P7 and Phase B land. P7.4's acceptance is measured in the post-fix run instead; that costs the same, because Phase B needs that run anyway.

---

Owner Q1 — **answered 2026-11-04**: paid no-AI steps cost no credit and a task finishes after credit runs out midway; A1/A3b no longer await an owner answer, and free D04 is unchanged. MC1 is **closed, answered 2026-11-04** through existing R21/AC11/§14 tests; A4b retains MC2 and implementation proof.

## Phase A — งานซ้ำไม่เรียกโมเดล (Tier 0) + ขอบเขตการคิดเงิน

### A9 — moved to expense-trust-and-money-fixes, step 2 / P07 (R6)
No implementation here. P07 owns B6, all current v2 callers, settlement/repair/counters and AC6. B3 adds only the new classifier's acceptance predicate after that hook exists; A8 reruns the owned billing regressions.

### A1 Budget amendment ส่วน Tier 0 (before M4, owner order 2026-11-04)
- `apps/api/src/modules/line-ai/application/line-ai-budget-authority.service.ts`: `serverRoute`; `narrow` (:274–303) ยอม ordinal 0 เฉพาะ `fixed_read` + `simple` + `['line-answer/2']`; `creditState()` อ่านอย่างเดียว
- `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts`: helper อ่านอย่างเดียว
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`: ส่ง `serverRoute`
- ตรวจ: `ai-gateway.client.spec.ts`, `line-intake-dispatch.use-case.spec.ts`; realpg `company-ai-usage-meter.spec.ts` (ordinal 0 เฉพาะ fixed_read, `creditState` ไม่เขียนแถว)

- R27 prerequisite: retain the existing `freeExpenseDrafts` early return before any credit/classifier admission; model-free receipt/menu/support/company/package entry points keep their own gates. Q1 cannot authorize free typed Q&A or financial work. Add the named R27 webhook test first. For G21, in the existing free return of `ProcessLineWebhookUseCase`, pass `lineChoiceQuickReply` to `deliverReply`'s existing optional third argument (`process-line-webhook.use-case.ts:2659–2680`) for a permitted expense-list URI or support command; use `freeExpenseMenuReply` read/update predicates for truthful edit wording. Keep one short sentence and no new helper, permission or model call.

### A2 Token + postback (อิสระ)
- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts`: `lineWorkflowOpenSig/verify` ครอบ `[company, user, act, id, pm, pd, pa]` (namespace `line-workflow-open-v1`); คงของเดิม
- `packages/contracts/src/line-ai.ts`: `LineWorkflowId`, `LineWorkflowControl` (`wf_open` keys `action, act, id, pm?, pd?, pa?, sig`; `wf_choice`)
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts`: parse exact keys → `event.workflowControl`; `chat-action` ที่เป็น workflow → `event.workflowStart`
- `apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts`: allowlist (:120–123, :259)
- **message buffer (R4-F2 CLOSED 2026-10-26, spec §7.1/§17.2)**: `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts` — `workflowControl`/`workflowStart`/`fixedReadControl` ใน type ของ item (:60–75), การตรวจ command (:475) **และตัดออกจากทางลัดคำสั่งเมนูไร้สถานะ (:510–511) ให้ส่งผ่าน worker ตามลำดับเสมอ** (idle → :499–504; ไม่ idle → `state.open` + `flushOpen` :541 — แยกเป็น group เดี่ยวที่ :949–950 และไม่แซง `/company` ที่รอ), payload ที่ freeze (:1051–1065), sweep replay (:383–398), `toTextEvent` (:1086–1091); `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:25`; pwu `LineTextEvent` (pwu:240); controller ใส่ค่าเข้า item (:96–125)
- ตรวจ: `line-webhook.controller.spec.ts`, `line-staff-menu.logic.spec.ts`, `process-line-webhook.use-case.spec.ts`, `line-message-buffer.service.spec.ts`, `line-message-buffer.logic.spec.ts` (ทั้งหมดลงทะเบียนแล้ว; AC22 — control ไม่หายเมื่อมีข้อความค้างใน buffer และหลัง sweep replay; regression: ระหว่าง turn ที่กำลังทำงาน ส่ง `/company B` แล้วกดปุ่มอ่านคงที่ → ปุ่มถูกประมวลผลหลังการสลับ ได้ข้อมูลบริษัท B ไม่ใช่ A)

### A3a ตัวเลือกใบเบิกของ CREATE เป็น postback (ขึ้นกับ A2)
- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.ts:303–320`: BRANCH/REQUESTER/SOURCE/`new-line` เป็น postback **เฉพาะเมื่อ action เป็น CREATE และมี `options.control`**; ตัวเลือกของ UPDATE (รวม TARGET) คงเป็นข้อความเดิมทุก byte
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts:24–33`: `choice` รับ choiceId ทุกชนิดของ CREATE + `new-line`
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:160–186`: `choose` (CREATE) เลือก BRANCH/REQUESTER/SOURCE; `new-line` ล้าง `linkedExpenseChoiceId`; parser รับ label เดิมตรงตัว
- `process-line-webhook.use-case.ts:10810–10817`: "ใช้บิลนี้ทำใบเบิก" เป็น postback SOURCE
- ตรวจ: `process-line-webhook.use-case.spec.ts` (CREATE เป็น postback, UPDATE/TARGET เหมือนเดิมทุก byte, journey แก้ใบเบิกเดิมผ่าน)

### A3c เริ่มใบเบิกและเก็บรายละเอียดรายการแบบ deterministic (ขึ้นกับ A3a; แก้รอบ 2 F5)
- `line-reimbursement-draft-adapter.service.ts`: `startFromWorkflow` (`LineReimbursementDraftUseCase.open` `line-reimbursement-draft.use-case.ts:140–150` + `buildOptions` :705; `taskId = stableUuid(['reimbursement-draft-task', owner, 'workflow', eventIdHash])`, `actionId = stableUuid(['reimbursement-draft-action', taskId, 'CREATE', 1])`, `actionOrdinal: 1`, `operation: 'CREATE'` ตามรูปแบบ rda:390–393 — `open` ปฏิเสธ id ที่ไม่ใช่ UUID หรือ ordinal < 1 (:143); admission `{ source: 'workflow', eventIdHash }`; มี action active → ทำต่อ)
- `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic.ts`: `parseManualClaimLine(evidence, candidates)` (spec §7.5) ใช้ proof `USER_TEXT` + `candidateId` ที่ `validateProposalProofs` (rda:959) รับ
- `line-reimbursement-draft-adapter.service.ts`: `answerLine` — ตัวจับคำตอบของขั้นรายละเอียดรายการ (ก่อน `answerReason`; ยอมข้อความที่มียอด)
- ตรวจ: `line-ai-classifier.spec.ts` (ยอดเดียว/หลายยอด/ไม่มีรายละเอียด/วันไม่มีปี/ไทยปนอังกฤษ), `process-line-webhook.use-case.spec.ts` (AC1 0 reservation; `startFromWorkflow` ไม่ได้ `invalid_field`; event เดิมส่งซ้ำได้ action เดิม)

### A3b ลำดับ Tier 0 ของใบเบิก + guard คำถาม + support pause (ขึ้นกับ A1, A3c)
- `process-line-webhook.use-case.ts`: claim choice (:7759–7778), `continueReimbursementQuestion` (:5370–5400 เอาเงื่อนไข grant :5376 ออก), `answerLine`, `handleClaimSubmitText` (:7065, :7709) เข้าบล็อกก่อน intake (:6755–6812); `reimbursementChoiceControl`/`workflowControl`/`workflowStart` ใน `deterministicCommand` (:6636) และ `allowDuringSupportPause` (:6714); คำพิมพ์ใหม่เรียก `creditState` ตาม Q1
- `line-ai-classifier.logic.ts`: `isPendingFieldAnswer(text)` = **เฉพาะ** ส่วนตรวจคำถาม/คำสั่งที่ย้ายจาก rda:194–197; เงื่อนไข "ต้องไม่มียอด" (rda:198) คงอยู่ใน `answerReason` ของใบเบิก ไม่ย้าย (ที่อยู่ผู้รับเงิน เช่น "88 ถนนสีลม" มีตัวเลขได้)
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts:977–993`: ใช้ `isPendingFieldAnswer`; คำถามไม่ลบงานค้าง (แก้ :988)
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `line-ai-classifier.spec.ts` (ที่อยู่มีตัวเลขผ่าน; คำถามไม่ผ่าน; เหตุผลใบเบิกที่มียอดยังถูกปฏิเสธเหมือนเดิม)

### A4a picker + เริ่มจากปุ่ม — ใบเบิก (ขึ้นกับ A2)
- ไฟล์ใหม่ `apps/api/src/modules/line-ai/application/line-workflow-target.service.ts`: `ListReimbursementsUseCase` (`reimbursement-request.use-case.ts:504–589`) ตาม bucket/status/search, กรองด้วย `approvalActions`/`canSubmitClaim`/`permitted`, ≤ 3 หน้า × 100, `exhaustive`
- `process-line-webhook.use-case.ts`: `handleWorkflowControl` หลังจุด resolve สิทธิ์ (:6714)
- `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`: การ์ด picker/ว่าง/ค้นไม่ครบ
- `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:551, 656`: ปุ่ม `บันทึกจ่ายคืน`
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `line-business-card.logic.spec.ts`, `reimbursement-request.use-case.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts`

### A4b picker — รายจ่าย ใบเตรียมจ่าย 50 ทวิ ใบทดแทน (ขึ้นกับ A4a; MC1 closed 2026-11-04; ต้องปิด MC2 ก่อน)
- `line-workflow-target.service.ts`: `ListExpensesUseCase` (`expense-draft.use-case.ts:309–319`, `readScope` :379–391) ส่ง `pageSize: 100` เอง (ค่าตั้งต้น 20, :316), ≤ 3 หน้า, ไม่มีช่วงวันที่, `expense_pay` สองชุด UNPAID/PARTIALLY_PAID, exhaustive = Σ `total` ≤ 300 และอ่านครบ (spec §6.1 P11); ผู้สร้างที่ไม่มี read scope → รายการ `createdByUserId = ตัวเอง` สำหรับ MARK_READY/DELETE_DRAFT (MC1); ผู้ขาย → `ListCounterpartiesUseCase.execute(ctx, page, 100, { search })` (`counterparty.use-case.ts:266–272`) ≤ 3 หน้า, หลายราย → ปุ่มเลือก, ไม่มี `accounting.counterparty.read` → รายการล่าสุดไม่กรอง
- `apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts`: `listForLine(ctx, query)` = `list` ที่ใช้ `scope(ctx, 'read', branchId, true)` (:74–78) — อ่านอย่างเดียว (MC2)
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts:471–496`: `ListSubstituteReceiptCandidatesUseCase.execute(ctx, filter, { channel: 'line' })` ข้าม `assertWeb` (:474) เฉพาะการอ่าน (MC2)
- `apps/api/src/modules/line-ai/application/line-voucher-action.service.ts`: `canOfferCertificate` (:75) กรอง 50 ทวิ
- `process-line-webhook.use-case.ts`: `substitute_receipt` เริ่มด้วย continuation เดิม (:6769) จากรายการของ candidates — หลัง A10 เท่านั้น
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `internal-tools.controller.spec.ts` (ไม่ข้ามสิทธิ์; ทางเขียนของใบเตรียมจ่าย/ใบทดแทนใน LINE ยังปฏิเสธ), `reimbursement-request.use-case.spec.ts`

- Controller 2026-11-05: MC2 closed (read-only, same permission and branch checks; existing signed continuations unchanged). Substitute receipts start from the existing signed continuation (spec R7: LINE may prepare there, never sign, approve or issue). Several matching sellers: the card lists up to 3 scrubbed names with the action's web exit; no new control.

### A5 ปุ่มขั้นถัดไปไม่หมดอายุ + ทางออก (ขึ้นกับ A2; แก้ B1/B4)
- `apps/api/src/modules/line-ai/domain/logic/line-expense-action-card.logic.ts:28–30`: ปุ่ม next/payment/wht เป็น `wf_open` (`act` = action ถัดไปจาก `offerNext`/`offerPayment`/`offerWht`, lea:936–943; `id` = `nextVoucherId`/expenseId; `pm/pd/pa` จาก paymentIntent ตอนสร้างปุ่ม — `paidAmount` lea:470)
- `line-expense-action.service.ts:845–880`: control เดิมยังรับ; หมดอายุและรู้เป้าหมาย → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่`; `preview` รับ `pm/pd/pa` จาก `wf_open` แทน `applied.paymentIntent` (:863) — มี `pa` แล้วไม่ตั้งยอดเป็นยอดค้างทั้งหมด (:539)
- `apps/api/src/modules/expenses/application/services/line-draft-preview.store.ts`: บันทึกกู้คืน `recover:<previewId>` TTL 7 วัน `{ companyId, userId, act, id, pm, pd, pa }` เขียนพร้อม preview (lea:588) และลบเมื่อกดยืนยัน/ยกเลิก; preview หาย (TTL 600 วินาที :29, :111) + มีบันทึก + เจ้าของตรง → E1 (ข); ไม่มีบันทึก → E1 (ก)
- `process-line-webhook.use-case.ts:3735–3755`: การ์ดหมดเวลาพร้อมปุ่ม
- ตรวจ: `process-line-webhook.use-case.spec.ts` (VOUCHER_SUBMIT → APPROVE → PAY → WHT หลัง 30 นาที; RECORD_PAYMENT พร้อมวิธีจ่ายเดิม; จ่ายบางส่วน 400 จาก 1,000 แล้วเปิดการ์ดใหม่ได้ 400; ยืนยันรายการที่สองในแชตเดียวกัน; E1 (ก) token ไม่ผ่าน → ข้อความเดิม lea:178 ปุ่ม targetless `เปิดเมนู`, (ข) เลย `expiresAt` หรือ preview หายหลัง 600 วินาทีแต่มีบันทึกกู้คืน → "การ์ดนี้หมดเวลาแล้วค่ะ" + ปุ่มที่ได้ preview ใหม่)

### A6a ปุ่มนำทาง `chat-action` (ขึ้นกับ A2)
- `packages/contracts/src/ai-tools.ts:258–279`: `workflow: true` only for sold workflow ids in spec §6.1 + `substitute_receipt`; `mayOfferWorkflow` (R21/R22)
- `line-business-card.logic.ts:48–61`: only sold workflow ids in spec §6.1 convert the single-message action at :56 to `chat-action`; keep other actions, including unsold sales/finance/tax/inventory/customers/bookings/procurement (`ai-tools.ts:281–287`), byte-identical; no new conversion/capability tests for unsold modules; R26 knowledge/package-guard regressions remain required
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`: ปุ่มในเมนูหลัก; :957 คงการแปลง id ที่ไม่ใช่ workflow
- ตรวจ: `line-business-card.logic.spec.ts`, `line-staff-menu.logic.spec.ts`

### A6b ปุ่มอ่านข้อมูลคงที่ 0 โมเดล (ขึ้นกับ A1, A2)
- `buildStaffCompletionQuickReply` (:173–176) and `buildStaffQueryMenu` (:579–581) in `line-staff-menu.logic.ts`: code constant `FIXED_READ` has **only** `expense_month` (`ค่าใช้จ่ายเดือนนี้` / `ดูค่าใช้จ่ายเดือนนี้`, current sold row :155), using the existing `expense.list_recent::single_metric` formatter. Convert that button only; sales, CRM bookings/inbox, finance/ledger and PO retain their message actions and receive no formatter/conversion/capability tests; R26 package-boundary regressions remain required. `parseLineFixedReadControl` accepts exactly `action,id`; add only this id in `linePostbackCommandText` (:943–960).
- controller + buffer: `fixedReadControl` ตาม A2 (ข้อความ synthetic = ข้อความเดิมของปุ่ม)
- `process-line-webhook.use-case.ts`: route plan ฝั่ง server + grant `serverRoute: 'fixed_read'` + narrow ordinal 0; ผล `PREPARED_READ_UNAVAILABLE` จาก guard เดิม (`orchestrator.agent.ts:1210–1222`) → ข้อความกลาง spec §10 + ปุ่มเว็บของ id นั้น (ไม่ใช้ข้อความเดิมที่ชี้หน้ารายจ่าย, ไม่เรียกโมเดลสำรอง)
- New fixed-read route uses the single code-defined family without reading an environment feature switch; reuse existing formatter/eligibility guards. `APPROVED_PREPARED_FAMILY_KEYS` already includes this family (`prepared-simple-read-formatter.ts:1783`, used by `orchestrator.agent.ts:1918`), so no Gateway allowlist change is needed; unsold formatters stay unchanged. Unavailable output is a zero-call recovery, not permission to run a planner.
- ตรวจ: `process-line-webhook.use-case.spec.ts` (prepared รับ 0 call; prepared ปฏิเสธ → ข้อความกลาง + ปุ่มเว็บ 0 call), `line-staff-menu.logic.spec.ts`, `line-webhook.controller.spec.ts`; realpg `company-ai-usage-meter.spec.ts`

### A6c ทักทายเปิดเสมอ (อิสระ; แก้ B3)
- `process-line-webhook.use-case.ts`: ย้ายทักทาย (:7656–7675) ขึ้นก่อน v2 route (:7045)
- `packages/config/src/index.ts:322–326` ลบ flag; `apps/api/src/common/config/app-config.service.ts:129` ลบ getter; `packages/config/src/index.test.ts`
- ตรวจ: `process-line-webhook.use-case.spec.ts`; config test

### A7 Telemetry งาน (อิสระ)
- `apps/api/prisma/schema.prisma`: `LineAiTaskRun` + `taskRunId` + 2 คอลัมน์ classify (migration เดียว, additive)
- `process-line-webhook.use-case.ts`: task run ตามขอบเขตงาน (spec §6.2); log `line.ai.task_summary` (ต้นทุนไม่ปัด/ลูกค้า/บริษัท, basis ของแถว absorbed จาก `providerUsageBasis` cbr:956)
- `scripts/line-ai-task-report.ts`
- การลบตามอายุ: `RecoverOrphanLineEventsUseCase.purgeExpiredEvents` (`recover-orphan-line-events.use-case.ts:387–407`) ลบ task ที่เกิน cutoff เดิมก่อน webhook log; MC6 closed by trace
- ตรวจ: `pnpm --filter @watchdog-bms/api prisma:validate`; migrate บน Postgres ในเครื่อง; `process-line-webhook.use-case.spec.ts`

- Controller ruling 2026-11-05: a notification's `wf_open` button is the same signed payload as a picker button, so its task run records `entry = 'BUTTON'`. `NOTIFICATION` stays reserved until a signed origin key is worth adding; nothing reads the split today.

### A10 — moved to expense-trust-and-money-fixes, step 1 / P04 (R5) and step 3 / P10 (R9)
No implementation here. P04 owns B7 typed-choice/signed-apply safety; P10 owns B8 category staging/CAS and FORM behavior. A10 is satisfied only after both steps pass their AC5/AC9; A4b integrates their existing signed action instead of duplicating the fix.

### A8 Release gate Phase A (ขึ้นกับ A1–A7, A9, A10)
- whole-chain catalog: add only this lane’s sold Tier 0 / unchanged-claim-edit / exact-payment / recovery scenarios from spec §11; rerun trust/money R5/R6/R9 regression cases after P04/P07/P10, without adding duplicate billing/substitute scenarios or caller changes
- W00 regenerate + api intake `line.workflow_control` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts`)
- live replay: button journey ชุดจูน (W3 = 100%, 0 การเรียก) + typed journey ทั้งชุด
- proof stack → UAT ตาม runbook (บันทึก run id) → Owner เดินจริงบน LINE → Production เมื่อ Owner สั่ง
- **Status 2026-11-05:** code parts done (whole-chain catalog 24 → 41 scenarios, including the owner's 2026-11-05 free month summary and stranger entry, all zero-model; intake `line.workflow_control`; W00 regenerated). Still open: the live replay, which runs as the M4 typed-journey replay on a named main commit; then proof stack → UAT → owner walk → Production, all on the owner's order.

---

## Phase B — ข้อความงานซ้ำ = classifier ครั้งเดียว (Tier 1)

### B1 Provider บังคับ schema + probe (ขนานกับ A; เป็นเงื่อนไขของ B2–B5)
- `provider.port.ts`: `outputSchema`
- `bedrock.provider.ts` (`generateText` :83): `outputConfig.textFormat`; strict tool ผ่าน `generateWithTools` (:115–157); `anthropic-api.provider.ts`: `output_config.format`; `openai.provider.ts`: `PROVIDER_CONTRACT_UNSUPPORTED`
- `ai-budget-provider.ts:126–162`: outputSchema ใน `textBytes`, `schemaDigest`, `payloadDigest` (ไม่มี = byte เดิม)
- MC4: ตรวจ SDK; MC3: probe บน UAT ด้วย schema จริงกับ `global.anthropic.claude-sonnet-4-6` ตาม runbook (Owner รับทราบก่อน) — ไม่ผ่านทั้งสองทาง = หยุด Phase B
- ตรวจ: `bedrock.provider.spec.ts`, `ai-usage.interceptor.spec.ts`
- **Status 2026-11-05:**
  - **Code done** on branch `codex/phase-b1-20261105` (`360bb97e0`), not yet landed. Bedrock sends `outputConfig.textFormat` (`json_schema`). Inputs without a schema keep identical bytes and digests. OpenAI, disabled and the local Anthropic transport refuse a schema.
  - **MC4 closed:** SDK 3.1075.0 has `outputConfig` and tool `strict`.
  - **MC3 closed** by one local Bedrock probe: valid JSON under `output_config`. The cold call took 5,625 ms, 826 input and 78 output tokens.
  - **Timeout.** The cold call is over the 4,000 ms classifier timeout, so B5's post-deploy grammar warm-up call stays required.
  - **UAT probe.** Replaced by this local probe, against the same model id and region. B5's UAT release still exercises it.

### B2 Contracts + classify authority (ขึ้นกับ B1 ผ่าน)
- `packages/contracts/src/ai-budget-bounds.ts`: authorityKind `'webhook_classify'` (parser :285–322), profile `line-classify/2` (24,576 / 1,024 / 1), digest ใหม่ — ไม่แก้ฟังก์ชัน slot (:339–351)
- `packages/contracts/src/line-ai.ts`: request/response (spec §7.2 รวม `descriptionText`)
- `line-ai-budget-authority.service.ts`: คอลัมน์ตาม kind (:81–86, :124–178, :180, :199, :305–363), lane `classify` 8,000 ms (:45), ปฏิเสธ `narrow`/`transferToDocumentQa`, เก็บ `decision`
- `ai-budget-provider.ts`: usageTag `line.workflow-classify` → profile ใหม่
- ตรวจ: contracts build; typecheck API + gateway; realpg `company-ai-usage-meter.spec.ts` (classify ไม่กระทบ turn grant, เรียกได้ครั้งเดียว, replay ใช้ decision เดิม); regression: `semantic-turn-v2.ts:727`, `document-qa.use-case.ts:97`, `orchestrator.agent.ts:1210`, `agentcore/runtime.ts:732` ไม่เปลี่ยน

### B3 Classifier ใน gateway (ขึ้นกับ B2, trust/money R6 / P07 via A9)
- ไฟล์ใหม่ `apps/ai-gateway/src/modules/line-ai/agents/workflow-classifier.agent.ts`: พรอมต์ 4,000 ตัวอักษร–8,000 ไบต์ + schema + `acceptOutput` (span/ช่วงความมั่นใจ/enum/candidate) + timeout 4,000 ms + thinking ปิด
- `line-ai-internal.controller.ts`: `@Post('line-workflow-classify')` → `/v1/internal/ai/line-workflow-classify`
- ตรวจ: `line-intake-router.agent.spec.ts` (ไม่มีข้อมูลร้าน, bound ≤ 24,576, ตก/timeout/ช้า = UNAVAILABLE + `ok:false`), `line-ai-internal.controller.spec.ts`

- R26: non-workflow labels preserve paid advisor knowledge/package paths; add `R26 non-workflow labels preserve knowledge and package replies` in existing `line-intake-router.agent.spec.ts` for VAT knowledge versus unavailable-shop-data requests, lower-pack WHT denial and mixed clauses; do not add unsold labels/tools.

### B4 Tier 1 ใน API (ขึ้นกับ B3, A3c, A4b, A8)
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`: `requestLineWorkflowClassify` + issue classify grant
- `process-line-webhook.use-case.ts`: Tier 1 ก่อน `tryRouteIntake` (:7050) ตาม R7; label → `pick`/`startFromWorkflow` (slot `descriptionText/amountText/dateText` → `parseManualClaimLine`); ไม่ผ่าน R9 → ตาราง spec §7.2.1; `อย่างอื่น` → admission ใหม่ของ event ใหม่ (acceptedAtMs ใหม่ + provenance เดิม; วันที่กรุงเทพเปลี่ยน → ขอพิมพ์ใหม่) → Tier 2; อื่น ๆ → Tier 2
- ตรวจ: `process-line-webhook.use-case.spec.ts` (1 call ต่องาน, ตาราง §7.2.1 สี่แถว, `อย่างอื่น` หลัง 60 วินาทีไม่หมดเวลา, ข้ามวันขอพิมพ์ใหม่, ไม่มีทางอนุญาต, เครดิตไม่พอ), `ai-gateway.client.spec.ts`; realpg

- R26/R27: preserve `scopePolicyOverride` in `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406,417`, its sole-clause call (`orchestrator.agent.ts:1168`) and mixed-clause call (`semantic-turn-v2.ts:692`). Free returns before Tier 1; paid knowledge uses the advisor and unavailable shop data uses its fixed package reply, no model-free conversion or new refusal charge. No Gateway policy rewrite.
- First tests: registered `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R26 classifier fallback preserves package replies and business knowledge`, `R27 free commands and welcome bypass every text model call`; Gateway `orchestrator.agent.spec.ts` — retain `U2 definitions are general knowledge, while Starter shop reads and issuance remain gated` and add `R26 fixed package reply adds no tool or compose call`. Run `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts`, `bash scripts/local-proof/tsc.sh api`, then GATEWAY with those exact existing files. Dependencies stay B3/A3c/A4b/A8 plus M3 for corpus proof; no schema change.

### B5 ปรับเกณฑ์ + release gate Phase B (ขึ้นกับ M3, B4)
- ตั้ง T/M บนชุดจูน (measurement spec §7.4) ล็อกในโค้ด
- held-out → MA3 and MA6, including R26/R27; ไม่ผ่าน = ไม่ปล่อย Tier 1
- เวลาตาม spec AC14 (Tier 0/1 ≤ 15 วิ; fallback ไป Tier 2 ตาม A7 ภายใน deadline เดิมของ turn)
- whole-chain + W00 + live replay + UAT + Owner + Production; หลัง deploy เรียก classifier 1 ครั้งเพื่อ compile grammar; เฝ้า W14
- **Status 2026-11-06.** T 0.70 / M 0.10 are locked in code (`4c24027de`). The first held-out run on main `921face4f` **does not pass**: Tier 1 is not released. Results are in `docs/research/line-ai-workflow-baseline-2026-10.md`, "After Phase B".
  - **What held:** wrong applied changes fell 20 → 0.
  - **What failed:** almost no workflow task finishes by chat. An open picker traps later messages, and count questions open the approval picker. Both are being fixed in round 8.
  - **Next:** a re-run, then a fresh blind held-out set for MA3/MA6.
- **Status 2026-11-06, blind gate.** Rounds 8–10 lift the tuning corpus to W3 65/72 (90.3%), with wrong applied 0. On the first blind set (held-out v2), MA3/MA6 is **not met**: W3 85/156 (54.5%), and one real wrong change, a claim edit applied to a draft the user did not pick. Tier 1 stays unreleased. Details are in `docs/research/line-ai-workflow-baseline-2026-10.md`, "Round 10 and the blind gate".
- **Status 2026-11-06, second blind gate.** Round 11 lifts tuning W3 to 65/69 (94.2%). On blind set v3, MA3/MA6 is **not met**: W3 workflow is 98/164 (59.8%) once one wrong gold button label is corrected, with wrong applied 0. Round 12 and cards round 4 fix the product causes, and blind set v4 is the next gate. Details are in `docs/research/line-ai-workflow-baseline-2026-10.md`, "Rounds 11–12 and the second blind gate".
- **Status 2026-11-07, blind sets v4 and v5.** MA3/MA6 is **not met**. W3 workflow is 53/119 (44.5%) on v4, mostly from big-shop named records, which round 13 fixed. On v5 it is 111/169 (65.7%), and v5 found the first real wrong writes: 14 claim drafts saved a politeness particle as the reason, and one expense draft was captured from a claim reference. Round 14 fixes these causes, and blind set v6 is the next gate. Details are in `docs/research/line-ai-workflow-baseline-2026-10.md`, "Rounds 12–13 and blind sets v4 and v5".
  - **Fixes:** the eight product causes are in rounds `wfp-r11` and `cards-r3`.
  - **Next gate:** a new blind held-out v3, whose gold is checked against the current seed and `ROLE_GRANTS`. Running it needs the owner's approval for budget beyond the 2,300 THB eval cap.

### B6 (เมื่อหลักฐานรองรับเท่านั้น) ลดพรอมต์ planner
- telemetry 2 สัปดาห์แสดงว่างานซ้ำไม่ไป Tier 2 → ตัดร้อยแก้วงานซ้ำจาก `CONTROL_PROMPT` (stv2:89); rebuild AgentCore; วัด W11; ถ้าแตะพรอมต์ router ต้อง recalibrate (`scripts/recalibrate-line-intake.cjs`)

---

## Phase C — Haiku 5.5 ให้ classifier (หลัง B5; Q2 answered 2026-11-04; switch gated by MA4 and privacy review)

### C1 โมเดลของ classify grant
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory.ts:21–29`: ใช้ `grant.model` ของ classify grant (ไม่กระทบ turn)
- `ai-gateway.client.ts` (`LINE_V2_TARIFFS`) + `apps/api/src/modules/line-ai/application/ai-model-pricing.ts`: tariff `global.anthropic.claude-haiku-5-5` (≤ 100k prompt); ยอดลงบัญชีต่อการเรียกปัด ROUND_HALF_UP เป็นสตางค์เต็ม (:223) — เป็น 0 เฉพาะเมื่อต่ำกว่า 0.5 สตางค์ (อุ่น ~0.35 → 0; เย็น 1.29525 → 1); รายงานต้นทุนใช้ค่าไม่ปัด
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/reviewed-line-model-capacity.ts`: แถว `global.anthropic.claude-haiku-5-5` พร้อมหลักฐาน AWS model card และ ceiling 100,000 โทเคน (MC10) — ไม่มีแถวนี้ capability endpoint ตอบ `ready: false` (`line-reliability-capabilities.controller.ts:24–37`) และ client คืน null (`ai-gateway.client.ts:171–178`)
- `ai-gateway.client.ts` (`requestLineWorkflowClassify`): capability request ของ classifier ส่ง `modelPolicy: { modelId: LINE_CLASSIFY_MODEL_ID }` (ค่าคงที่ในโค้ด) แทน model ของบริษัท ยกเว้นบริษัทที่มี model policy ของ partner (:162) — spec §6.4
- config: model id ใน approved list; ขอการเข้าถึงโมเดลใน console
- ตรวจ: realpg (โมเดลผิด = refuse), `ai-model-pricing.spec.ts`, `line-ai-internal.controller.spec.ts` (capability ของ Haiku 5.5 `ready` เมื่อครบเงื่อนไข), `ai-gateway.client.spec.ts` (classify grant ได้ model ของ classifier; turn grant ยังได้ model ของบริษัท)

### C2 Converse กับ Haiku 5.5 (ไม่มี transport ใหม่)
- `BedrockProvider` (Converse) เดิม; classifier ส่ง `additionalModelRequestFields` = `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }` (ชื่อของ Messages API; ชื่อบน Converse ยืนยันใน probe — MC5); test output ถูกตัด
- Phase C ใช้ Bedrock เท่านั้น (measurement M-R2; `provider.factory.ts:52–54` เลือก `AnthropicApiProvider` เมื่อมีคีย์ local และคำขอนั้นไม่ปิด thinking) — `run-real` ปฏิเสธรัน Phase C ที่ transport ≠ bedrock
- probe 1 ครั้งบน UAT ตาม runbook
- ตรวจ: `bedrock.provider.spec.ts`

### C3 Eval + release
- held-out เดิม → MA4 (ต้นทุน provider ไม่ปัด); ก่อน switch controller ต้องตรวจและบันทึกว่า privacy policy เรื่อง sub-processor และ cross-border ครอบคลุม Global inference profile ตาม Q2 answered 2026-11-04; ผ่านทั้งสอง gate → release ตามขั้นเดิม; ถ้า gate ใดยังไม่ผ่าน → คง Sonnet โดยไม่ขอคำตอบ Q2 ซ้ำ.

---

## Phase D — ปิดงานเอกสาร

- R1/R18–R20/R22: backlog ค 16–24: สถานะ/ตัวเลขจริง; amendment ของ budget contract; สูตร LINE fake ลง `docs/runbooks/` (G12)
- memory: run id ของ UAT/READY/Production, ผลวัด, สิ่งที่ยังไม่ได้กดทดสอบ

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. ชื่อ workflow = `LINE_CHAT_ACTIONS` id (+ `substitute_receipt`); ไม่มี workflow แก้ใบเบิก และทางแก้เดิมไม่เปลี่ยน (UPDATE/TARGET คงเป็นข้อความ)
2. ไม่มีตารางสถานะ workflow ใหม่; ตารางใหม่ไว้วัดผลเท่านั้น
3. classifier ไม่เห็นข้อมูลร้าน; ตัวเลข/วันที่จากตัวอ่านค่าเดิม; รายละเอียดรายการต้องเป็น span ของข้อความจริง
4. classifier มี authority/attempt/grant ของตัวเอง — invariant ของ turn grant ไม่เปลี่ยน
5. การอนุญาตต่อรายการ = โค้ดเดิม; การอ่านเพื่อ picker = scope ของ use-case รายการ (+ ผู้สร้างเห็นเฉพาะของตัวเองสำหรับส่งตรวจ/ลบร่างตาม MC1 answered 2026-11-04)
6. picker ใช้ use-case รายการที่แบ่งหน้า (+ ทางอ่าน LINE ที่ตรวจสิทธิ์เดิม); ห้ามพูด "ไม่พบ" ถ้าค้นไม่ครบ
7. provider ต้องบังคับ schema ได้ ไม่งั้นไม่ปล่อย Tier 1
8. ผลที่ใช้ไม่ได้ตรวจก่อน settle และไม่คิดเงินลูกค้า
9. `wf_open` ลงนามครอบ action/target/วิธีจ่าย/วันจ่าย/ยอดจ่าย; ไม่มีวันหมดอายุในรุ่นแรก (ล้มได้ทางลายเซ็นเท่านั้น → ข้อความเดิม lea:178)
10. ลดจำนวนการเรียกก่อน แล้วจึงลดราคาโมเดล (assessment 2026-08-25 §6)
11. ใบทดแทน: การตรวจ/เตรียมเอกสารที่มีเลขเกิดจากการกดการ์ดที่ลงนามเท่านั้น (B7)
12. เพดานเงินของรันวัดคุมด้วย trigger ใน eval DB ก่อนทุกการส่ง ไม่ใช่เครดิตลูกค้า; ledger บันทึกก่อนทุก reset และรวมตาม `invocationKey`
13. key ของ `startFromWorkflow` = UUID ที่คงที่ + `actionOrdinal: 1`
14. ใบทดแทน: ระหว่างเก็บข้อมูลไม่เขียนคอลัมน์ธุรกิจของรายจ่าย (รวมหมวด) — ทุกการเขียนเกิดตอนกดการ์ด (B8)
15. control ใหม่ทุกตัวผ่าน message buffer ครบ (type, command, freeze, replay, `toTextEvent`) และส่งผ่าน worker ตามลำดับเสมอ — ไม่ใช้ทางลัดของคำสั่งเมนู
16. postback มีหลักฐานสามแบบ: HMAC (`wf_open`), หลักฐานที่ server เก็บผูกเจ้าของ (`wf_choice`, `reimbursement_choice`), ปุ่มนำทางไม่มีเป้าหมาย (`chat-action`, `fixed-read`)

## Traceability

The companion specs' Traceability tables give exact proposed test names and acceptance ids; every retained step maps back below. `R*` means workflow spec; `M-R*` means measurement spec. A9/A10 are external dependencies, not work assigned twice. No code, corpus, test, migration, package, cloud or release operation is authorized in this documents round.

Commit rounds are review boundaries of at most five steps: M1a/M1b/M1c/M2/M3, then budget-approved M4; A1/A2/A3a/A3c/A3b; A4a/A4b/A5/A6a/A6b; A6c/A7/A8; B1–B5 (B1 probe may precede the A rounds); C1–C3 and D. B6 stays conditional. Each implementation commit includes its own focused check; dependencies below override the grouping. Shared files are updated sequentially after adjacent work lands.

Command notation (execute only during implementation, from this worktree):

- **API:** `pnpm --filter @watchdog-bms/api exec node --import tsx --test <file relative to apps/api>` for each API file named below.
- **TYPE_API:** `bash scripts/local-proof/tsc.sh api`; **TYPE_WEB:** `bash scripts/local-proof/tsc.sh web` when an existing sold browser journey is touched.
- **GATEWAY:** `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test <file relative to apps/ai-gateway>` plus its typecheck.
- **HARNESS:** `node_modules/.bin/tsx --test <scripts file>`; preserve isolated DB/Redis and budget requirements of measurement §7.2.
- **SCHEMA:** `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma` and `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`; additive migrations only, applied to an isolated local proof DB.
- **realpg.sh:** `scripts/local-proof/realpg.sh line-workflow src/modules/line-ai/application/company-ai-usage-meter.spec.ts`; a skipped database block is not proof.

| Step | Requirement ids | Dependency | Focused test file(s), names in specs' trace tables | Verification command(s) |
|---|---|---|---|---|
| M1a | M-R5–M-R7/M-R13 | None | scripts/line-ai-reliability-runtime.spec.ts | HARNESS; TYPE_API |
| M1b | M-R3/M-R4/M-R6/M-R12/M-R14; R26/R27 | M1a | scripts/line-ai-expense-advisor/types.spec.ts; scripts/line-ai-expense-advisor/scorer.spec.ts | HARNESS |
| M1c | M-R2/M-R3/M-R9/M-R11/M-R13 | M1a/M1b | scripts/line-ai-expense-advisor/run-rescore.spec.ts; scripts/line-ai-reliability-runtime.spec.ts | HARNESS; existing reliability-postgres command (eval guard) |
| M2 | M-R5/M-R6/M-R8/M-R13; R27 | M1b | scripts/line-ai-expense-advisor/oracle.spec.ts | HARNESS; preflight/oracle isolated DB |
| M3 | M-R1/M-R8/M-R14; R26/R27 | M2 | scripts/line-ai-expense-advisor/types.spec.ts | HARNESS; retained-behaviour validator/preflight |
| M4 | M-R9/M-R10/M-R14; R26/R27 | M3; Q3/measurement Q1 answered 2026-11-04, whole-program budget 2,000 THB | scripts/line-ai-expense-advisor/report.spec.ts | HARNESS; §7.2 real-run commands with approved budget |
| A9 (moved) | R12 | Trust/money owner step 2/P07 (R6) | apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts | No implementation here; run owned R6 regressions via API/realpg |
| A1 | R13/R22; R27 | M4; Q1 answered 2026-11-04 (paid no-AI step zero credit; started task finishes) | apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts; apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts; apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API; realpg.sh |
| A2 | R3/R23 | No R4-F2 review dependency (CLOSED) | apps/api/src/modules/line-ai/application/line-message-buffer.service.spec.ts; apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts; apps/api/src/modules/auth/line-webhook.controller.spec.ts | API; TYPE_API |
| A3a | R2/R3/R22 | A2 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| A3c | R2/R5/R8 | A3a | apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts; apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| A3b | R1/R2/R6/R13 | A1/A3c; Q1 answered 2026-11-04 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| A4a | R16/R21 | A2 | apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts; apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| A4b | R17/R21 | A4a + MC2; MC1 closed 2026-11-04; substitute only after P04/P10 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts | API; TYPE_API |
| A5 | R3/R15/R25 | A2 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts | API; TYPE_API |
| A6a | R15/R21/R22; R27 | A2 | apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts; apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts | API; TYPE_API |
| A6b | R14/R22/R23; R27 | A1/A2 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts; apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts | API; TYPE_API; realpg.sh |
| A6c | R14/R15; R27 | Independent | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; packages/config/src/index.test.ts | API; config test; TYPE_API |
| A7 | R24; M-R8 | Independent | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts | API; TYPE_API; SCHEMA; additive migration on local DB |
| A10 (moved) | R4 | Trust/money step 1/P04 R5 + step 3/P10 R9 | apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts | No implementation here; run owned R5/R9 integration regressions via API |
| A8 | R1/R3/R4/R12/R15/R22/R23/R25; R27 | Retained A steps; P04/P07/P10 passed | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; scripts/line-ai-reliability-runtime.spec.ts | API; HARNESS; whole-chain; existing W00 regression; live replay only in implementation |
| B1 | R10/R11 | Independent; MC3/MC4 | apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts; apps/ai-gateway/src/common/usage/ai-usage.interceptor.spec.ts | GATEWAY; schema probe under deploy runbook in implementation |
| B2 | R7/R8/R12 | B1 passed | apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts | API; TYPE_API; GATEWAY; realpg.sh; contracts build |
| B3 | R8–R12/R20; R26 | B2 + trust/money P07 | apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts | GATEWAY |
| B4 | R1/R7/R9/R13; R26/R27 | B3/A3c/A4b/A8 | apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts; apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts; apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts | API; TYPE_API; realpg.sh; GATEWAY |
| B5 | R9/R10/R20/R22; M-R10/M-R14; R26/R27 | M3/B4 | scripts/line-ai-expense-advisor/scorer.spec.ts; scripts/line-ai-expense-advisor/report.spec.ts | HARNESS; MA3/MA6 with R26/R27; whole-chain |
| B6 (conditional) | R20 | Two weeks of telemetry proves need | apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts | GATEWAY; W11 retained advisor corpus; rebuild artifact if changed |
| C1 | R18/R19 | B5; Q2 answered 2026-11-04, final switch remains gated in C3 | apps/api/src/modules/line-ai/application/ai-model-pricing.spec.ts; apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts | API; GATEWAY; realpg.sh |
| C2 | R11/R19; M-R2 | C1 + MC5 | apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts | GATEWAY; Bedrock-only probe in implementation |
| C3 | R18/R19; M-R10 | C2 + MA4 + controller verification of Global sub-processor/cross-border privacy coverage before switch | scripts/line-ai-expense-advisor/scorer.spec.ts; scripts/line-ai-expense-advisor/report.spec.ts | HARNESS; MA4; release gates |
| D | R1/R15/R18–R20/R22/R24 | After each implementation release | scripts/line-ai-expense-advisor/report.spec.ts | Docs evidence and signed release result; no extra feature build |

API registration rechecked 2026-11-04 with `grep -c "<file>" apps/api/package.json` for each exact relative path below. Positive counts are static registration evidence only. Existing W00/PG regression files with count 0 receive **no new assertions** here; run them only through their existing whole-chain paths. No package.json edits.

| API file (relative to apps/api) | grep count |
|---|---|
| `src/modules/auth/line-webhook.controller.spec.ts` | 1 |
| `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` | 2 |
| `src/modules/line-ai/application/ai-model-pricing.spec.ts` | 1 |
| `src/modules/line-ai/application/company-ai-usage-meter.spec.ts` | 1 |
| `src/modules/line-ai/application/line-message-buffer.service.spec.ts` | 1 |
| `src/modules/line-ai/application/use-cases/erp-reimbursement-tools.use-case.spec.ts` | 1 |
| `src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts` | 1 |
| `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 |
| `src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts` | 1 |
| `src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts` | 2 |
| `src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts` | 1 |
| `src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` | 1 |
| `src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts` | 2 |
| `src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts` | 4 |
| `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts` | 1 |

Gateway registration rechecked 2026-11-04: `grep -c "orchestrator.agent.spec.ts" apps/ai-gateway/package.json` = 2, `grep -c "line-intake-router.agent.spec.ts" apps/ai-gateway/package.json` = 1. Reuse the existing U2 definition/package regression; no new assertion is assigned to the unlisted standalone scope-policy spec.

Existing picker regression is retained, not expanded: `grep -c "src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts" apps/api/package.json` = 1 (checked 2026-11-04). Run it with API command notation during A8; add no assertions to the unlisted standalone delivery-plan spec.
