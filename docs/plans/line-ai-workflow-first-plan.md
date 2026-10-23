# LINE AI Workflow-First Plan

Status: DRAFT — blocked on: R4-F2 (ordered dispatch of new controls) review before Phase A2; owner Q1–Q3, MC1 — เริ่มได้โดยไม่รอ A2: A9 (ผลที่ใช้ไม่ได้ไม่คิดเงิน), A10 (ใบทดแทนเขียนตอนกดการ์ดเท่านั้น — R4-F1 ปิดแล้ว), A6c (ทักทาย), A7 (telemetry), Phase M (M1a–M3; M4 รองบ Q3), B1 probe (แก้ตามรีวิว 2026-10-24 รอบ 1–4 + focused check แล้ว; A2 และ step ที่ขึ้นกับ A2 — A3a/A3c/A3b, A4a/A4b, A5, A6a, A6b, B4 — รอรีวิว R4-F2 ใน spec §17.2; ทุก step ยังต้องปิด spec §17.1 (MC1–MC11) ตามที่ระบุ)
Spec: `docs/specs/line-ai-workflow-first-spec.md`, `docs/specs/line-ai-measurement-and-eval-spec.md`
Memory: `docs/agent-memory/line-ai-workflow-first.md`
Baseline: main 6c54ba208 (2026-10-23)
Scope: วัด baseline (Phase M) → งานซ้ำไม่เรียกโมเดล + ขอบเขตการคิดเงิน (Phase A) → ข้อความงานซ้ำเรียก classifier ครั้งเดียว (Phase B) → Haiku 5.5 ให้ classifier (Phase C) → ปิดงานเอกสาร (Phase D)
หลักการ: ponytail full — reuse ที่เก็บสถานะเดิม, open token แบบเดิม, postback `chat-action` เดิม, `LINE_CHAT_ACTIONS` เดิม, use-case รายการของเว็บ (+ ทางอ่าน LINE ที่ตรวจสิทธิ์ชุดเดิม), `LineDraftPreviewStore` เดิม; ไม่มีสวิตช์; ไม่เพิ่ม dependency (ยกเว้นอัปเดต SDK ถ้า MC4); invariant ของ turn grant ไม่เปลี่ยน; ทางแก้ใบเบิกเดิมไม่เปลี่ยน

## กติกาการทำงานทุก lane

- worktree แยกต่อ lane, stage ทีละ path, ไม่ `git add -A`, ไม่ `git stash`, ไม่ pkill ตาม pattern
- ไม่ trigger GitHub Actions/PR; ตรวจในเครื่อง แล้ว controller push ตรงเข้า develop + main (คำสั่ง Owner 2026-10-20)
- ไม่แก้ `package.json` (ยกเว้น dependency); **assertion ใหม่ของ API อยู่ในไฟล์ที่ลงทะเบียนใน `apps/api/package.json` เท่านั้น** — invariant เงินกับ PostgreSQL จริงอยู่ใน `src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (ลงทะเบียนแล้ว มีแบบทดสอบ "real PostgreSQL:" ที่ :262–268); gateway อยู่ในไฟล์ที่ลงทะเบียนใน `apps/ai-gateway/package.json`
- คำตรวจต่อ step (คำสั่ง Owner 2026-09-21): typecheck แพ็กเกจที่แตะ + spec ที่แตะ; step ที่แตะ LINE รัน whole-chain ก่อน push
  - `pnpm --filter @watchdog-bms/contracts build`
  - `pnpm --filter @watchdog-bms/api typecheck` / `pnpm --filter @watchdog-bms/ai-gateway typecheck`
  - `pnpm --filter @watchdog-bms/api exec node --import tsx --test <spec ที่ลงทะเบียน>`
  - PG จริง: `scripts/local-proof/realpg.sh <tag> src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (ตั้ง `DATABASE_URL` ให้, realpg.sh:12)
  - regression PG เดิม: `BILLING_TEST_DATABASE_URL=<local> node scripts/run-line-ai-whole-chain-acceptance.mjs --reliability-postgres`
  - whole-chain: `node scripts/run-line-ai-whole-chain-acceptance.mjs`
  - W00: `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts` → อ่าน diff → รันซ้ำไม่มี UPDATE
- พร้อมกันไม่เกิน 3 lane บนเครื่อง 16 GB

## ลำดับที่บังคับ

```
M1a → M1b → M1c → M2 → M3 → M4 (baseline; ต้องได้งบ Q1 ของ measurement spec)
A9 (ขอบเขตการคิดเงิน) ขนานกับ M ได้ — ปล่อยแยกได้เพราะเป็นบั๊กเงิน
A2 → A3a → A3c → A3b ; A1 → A3b ; A2 → A4a → A4b (ต้องปิด MC1, MC2) ; A10 → A4b (ใบทดแทน) ; A2 → A5 ; A1 + A2 → A6b ; A2 → A6a ; A6c อิสระ ; A7 อิสระ
A10 (ใบทดแทนต้องกดการ์ด — แก้ B7) อิสระ ปล่อยแยกได้เพราะเป็นการเขียนโดยไม่ยืนยัน
(A1..A10) → A8 (release Phase A)
B1 (probe, MC3/MC4) ขนานกับ A ; B1(ผ่าน) → B2 → B3 → B4 ; A3c + A4b + A8 → B4 ; M3 + B4 → B5
B5 + Owner Q2 + MC5 → C1 → C2 → C3
D หลังแต่ละ release
```

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
- ชุดจูน `scripts/line-ai-expense-advisor/corpus.workflow.tuning.json` ≥ 240 turn / ≥ 80 บทสนทนา (≥ 60% typed journey)
- ชุดเก็บไว้ทดสอบ ≥ 150 turn / ≥ 50 บทสนทนา ตาม §15.1 โดย lane แยก เก็บนอก repo
- ตรวจ: validator; preflight oracle ผ่านทุกเฉลย

### M4 Baseline บน main (ขึ้นกับ M3 + งบ)
- typed journey ทั้งสองชุด + advisor held-out บน commit ของ main ที่ระบุ
- บันทึกใน `docs/research/line-ai-workflow-baseline-2026-10.md` และ memory
- ตรวจ: รายงานครบ; ledger ≤ เพดาน

---

## Phase A — งานซ้ำไม่เรียกโมเดล (Tier 0) + ขอบเขตการคิดเงิน

### A9 ขอบเขตการคิดเงิน (แก้ B6; ขนานกับ M)
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts`: `acceptOutput?: (output) => boolean` (local-only)
- `apps/ai-gateway/src/common/usage/ai-budget-provider.ts:400–467`: หลัง `call(bounded)` (:429) ก่อน settle (:459) — `output_limit` หรือ `acceptOutput` false → entries ของการเรียกนี้เป็น `ok:false` + `OUTPUT_UNUSABLE` (ตัวนับครบ)
- ผู้เรียก = ทุกการเรียกใต้ envelope v2 (spec §7.3): `intent-router.agent.ts:720` (parse สำเร็จ :741), `semantic-turn-v2.ts` (planner :738 valid :766–769, public lookup :948, compose :1184), **`apps/ai-gateway/src/modules/line-ai/application/document-qa.use-case.ts:92, 100`** (`parseLineDocumentQaResult` + `resultCovers`) — ต้อง rebuild AgentCore artifact; ไล่ `generateText`/`generateWithTools` ที่วิ่งใต้ `active-v2` ทั้งหมดแล้วบันทึกรายการใน memory
- `docs/specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md`: amendment §5 (MC8)
- ตรวจ: `ai-usage.interceptor.spec.ts` (รวม profile `document-qa/2`), `intent-router.agent.spec.ts`, `line-ai-internal.controller.spec.ts` (route `line-document-qa` ผลไม่ผ่าน → failed + usage `ok:false`); realpg `company-ai-usage-meter.spec.ts` (usage `ok:false` → `customerChargedSatang 0`, `companyAbsorbedSatang` = ต้นทุน; settle ครั้งที่สอง `'duplicate'`)

### A1 Budget amendment ส่วน Tier 0 (หลัง M4)
- `apps/api/src/modules/line-ai/application/line-ai-budget-authority.service.ts`: `serverRoute`; `narrow` (:274–303) ยอม ordinal 0 เฉพาะ `fixed_read` + `simple` + `['line-answer/2']`; `creditState()` อ่านอย่างเดียว
- `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts`: helper อ่านอย่างเดียว
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`: ส่ง `serverRoute`
- ตรวจ: `ai-gateway.client.spec.ts`, `line-intake-dispatch.use-case.spec.ts`; realpg `company-ai-usage-meter.spec.ts` (ordinal 0 เฉพาะ fixed_read, `creditState` ไม่เขียนแถว)

### A2 Token + postback (อิสระ)
- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts`: `lineWorkflowOpenSig/verify` ครอบ `[company, user, act, id, pm, pd, pa]` (namespace `line-workflow-open-v1`); คงของเดิม
- `packages/contracts/src/line-ai.ts`: `LineWorkflowId`, `LineWorkflowControl` (`wf_open` keys `action, act, id, pm?, pd?, pa?, sig`; `wf_choice`)
- `apps/api/src/modules/auth/presentation/line-webhook.controller.ts`: parse exact keys → `event.workflowControl`; `chat-action` ที่เป็น workflow → `event.workflowStart`
- `apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts`: allowlist (:120–123, :259)
- **message buffer (BLOCKER R4-F2, spec §7.1/§17.2)**: `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts` — `workflowControl`/`workflowStart`/`fixedReadControl` ใน type ของ item (:60–75), การตรวจ command (:475) **และตัดออกจากทางลัดคำสั่งเมนูไร้สถานะ (:510–511) ให้ส่งผ่าน worker ตามลำดับเสมอ** (idle → :500–504; ไม่ idle → `state.open` + `flushOpen` :541 — แยกเป็น group เดี่ยวที่ :949–950 และไม่แซง `/company` ที่รอ), payload ที่ freeze (:1051–1065), sweep replay (:383–398), `toTextEvent` (:1086–1091); `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:25`; pwu `LineTextEvent` (:236); controller ใส่ค่าเข้า item (:96–125)
- ตรวจ: `line-webhook.controller.spec.ts`, `line-staff-menu.logic.spec.ts`, `process-line-webhook.use-case.spec.ts`, `line-message-buffer.service.spec.ts`, `line-message-buffer.logic.spec.ts` (ทั้งหมดลงทะเบียนแล้ว; AC22 — control ไม่หายเมื่อมีข้อความค้างใน buffer และหลัง sweep replay; regression: ระหว่าง turn ที่กำลังทำงาน ส่ง `/company B` แล้วกดปุ่มอ่านคงที่ → ปุ่มถูกประมวลผลหลังการสลับ ได้ข้อมูลบริษัท B ไม่ใช่ A)

### A3a ตัวเลือกใบเบิกของ CREATE เป็น postback (ขึ้นกับ A2)
- `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.ts:303–320`: BRANCH/REQUESTER/SOURCE/`new-line` เป็น postback **เฉพาะเมื่อ action เป็น CREATE และมี `options.control`**; ตัวเลือกของ UPDATE (รวม TARGET) คงเป็นข้อความเดิมทุก byte
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts:24–33`: `choice` รับ choiceId ทุกชนิดของ CREATE + `new-line`
- `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:160–186`: `choose` (CREATE) เลือก BRANCH/REQUESTER/SOURCE; `new-line` ล้าง `linkedExpenseChoiceId`; parser รับ label เดิมตรงตัว
- `process-line-webhook.use-case.ts:10692–10699`: "ใช้บิลนี้ทำใบเบิก" เป็น postback SOURCE
- ตรวจ: `process-line-webhook.use-case.spec.ts` (CREATE เป็น postback, UPDATE/TARGET เหมือนเดิมทุก byte, journey แก้ใบเบิกเดิมผ่าน)

### A3c เริ่มใบเบิกและเก็บรายละเอียดรายการแบบ deterministic (ขึ้นกับ A3a; แก้รอบ 2 F5)
- `line-reimbursement-draft-adapter.service.ts`: `startFromWorkflow` (`LineReimbursementDraftUseCase.open` `line-reimbursement-draft.use-case.ts:140–150` + `buildOptions` :705; `taskId = stableUuid(['reimbursement-draft-task', owner, 'workflow', eventIdHash])`, `actionId = stableUuid(['reimbursement-draft-action', taskId, 'CREATE', 1])`, `actionOrdinal: 1`, `operation: 'CREATE'` ตามรูปแบบ rda:390–393 — `open` ปฏิเสธ id ที่ไม่ใช่ UUID หรือ ordinal < 1 (:143); admission `{ source: 'workflow', eventIdHash }`; มี action active → ทำต่อ)
- `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic.ts`: `parseManualClaimLine(evidence, candidates)` (spec §7.5) ใช้ proof `USER_TEXT` + `candidateId` ที่ `validateProposalProofs` (rda:959) รับ
- `line-reimbursement-draft-adapter.service.ts`: `answerLine` — ตัวจับคำตอบของขั้นรายละเอียดรายการ (ก่อน `answerReason`; ยอมข้อความที่มียอด)
- ตรวจ: `line-ai-classifier.spec.ts` (ยอดเดียว/หลายยอด/ไม่มีรายละเอียด/วันไม่มีปี/ไทยปนอังกฤษ), `process-line-webhook.use-case.spec.ts` (AC1 0 reservation; `startFromWorkflow` ไม่ได้ `invalid_field`; event เดิมส่งซ้ำได้ action เดิม)

### A3b ลำดับ Tier 0 ของใบเบิก + guard คำถาม + support pause (ขึ้นกับ A1, A3c)
- `process-line-webhook.use-case.ts`: claim choice (:7716–7735), `continueReimbursementQuestion` (:5346–5376 เอาเงื่อนไข grant :5352 ออก), `answerLine`, `handleClaimSubmitText` (:7022, :7666) เข้าบล็อกก่อน intake (:6730–6787); `reimbursementChoiceControl`/`workflowControl`/`workflowStart` ใน `deterministicCommand` (:6612) และ `allowDuringSupportPause` (:6690); คำพิมพ์ใหม่เรียก `creditState` ตาม Q1
- `line-ai-classifier.logic.ts`: `isPendingFieldAnswer(text)` = **เฉพาะ** ส่วนตรวจคำถาม/คำสั่งที่ย้ายจาก rda:194–197; เงื่อนไข "ต้องไม่มียอด" (rda:198) คงอยู่ใน `answerReason` ของใบเบิก ไม่ย้าย (ที่อยู่ผู้รับเงิน เช่น "88 ถนนสีลม" มีตัวเลขได้)
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts:977–993`: ใช้ `isPendingFieldAnswer`; คำถามไม่ลบงานค้าง (แก้ :988)
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `line-ai-classifier.spec.ts` (ที่อยู่มีตัวเลขผ่าน; คำถามไม่ผ่าน; เหตุผลใบเบิกที่มียอดยังถูกปฏิเสธเหมือนเดิม)

### A4a picker + เริ่มจากปุ่ม — ใบเบิก (ขึ้นกับ A2)
- ไฟล์ใหม่ `apps/api/src/modules/line-ai/application/line-workflow-target.service.ts`: `ListReimbursementsUseCase` (`reimbursement-request.use-case.ts:504–589`) ตาม bucket/status/search, กรองด้วย `approvalActions`/`canSubmitClaim`/`permitted`, ≤ 3 หน้า × 100, `exhaustive`
- `process-line-webhook.use-case.ts`: `handleWorkflowControl` หลังจุด resolve สิทธิ์ (:6690)
- `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`: การ์ด picker/ว่าง/ค้นไม่ครบ
- `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:551, 656`: ปุ่ม `บันทึกจ่ายคืน`
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `line-business-card.logic.spec.ts`, `reimbursement-request.use-case.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts`

### A4b picker — รายจ่าย ใบเตรียมจ่าย 50 ทวิ ใบทดแทน (ขึ้นกับ A4a; ต้องปิด MC1, MC2 ก่อน)
- `line-workflow-target.service.ts`: `ListExpensesUseCase` (`expense-draft.use-case.ts:286–295`, `readScope` :355–367) ส่ง `pageSize: 100` เอง (ค่าตั้งต้น 20, :292), ≤ 3 หน้า, ไม่มีช่วงวันที่, `expense_pay` สองชุด UNPAID/PARTIALLY_PAID, exhaustive = Σ `total` ≤ 300 และอ่านครบ (spec §6.1 P11); ผู้สร้างที่ไม่มี read scope → รายการ `createdByUserId = ตัวเอง` สำหรับ MARK_READY/DELETE_DRAFT (MC1); ผู้ขาย → `ListCounterpartiesUseCase.execute(ctx, page, 100, { search })` (`counterparty.use-case.ts:266–272`) ≤ 3 หน้า, หลายราย → ปุ่มเลือก, ไม่มี `accounting.counterparty.read` → รายการล่าสุดไม่กรอง
- `apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts`: `listForLine(ctx, query)` = `list` ที่ใช้ `scope(ctx, 'read', branchId, true)` (:74–78) — อ่านอย่างเดียว (MC2)
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts:471–496`: `ListSubstituteReceiptCandidatesUseCase.execute(ctx, filter, { channel: 'line' })` ข้าม `assertWeb` (:474) เฉพาะการอ่าน (MC2)
- `apps/api/src/modules/line-ai/application/line-voucher-action.service.ts`: `canOfferCertificate` (:75) กรอง 50 ทวิ
- `process-line-webhook.use-case.ts`: `substitute_receipt` เริ่มด้วย continuation เดิม (:6744) จากรายการของ candidates — หลัง A10 เท่านั้น
- ตรวจ: `process-line-webhook.use-case.spec.ts`, `internal-tools.controller.spec.ts` (ไม่ข้ามสิทธิ์; ทางเขียนของใบเตรียมจ่าย/ใบทดแทนใน LINE ยังปฏิเสธ), `reimbursement-request.use-case.spec.ts`

### A5 ปุ่มขั้นถัดไปไม่หมดอายุ + ทางออก (ขึ้นกับ A2; แก้ B1/B4)
- `apps/api/src/modules/line-ai/domain/logic/line-expense-action-card.logic.ts:28–30`: ปุ่ม next/payment/wht เป็น `wf_open` (`act` = action ถัดไปจาก `offerNext`/`offerPayment`/`offerWht`, lea:936–943; `id` = `nextVoucherId`/expenseId; `pm/pd/pa` จาก paymentIntent ตอนสร้างปุ่ม — `paidAmount` lea:470)
- `line-expense-action.service.ts:845–880`: control เดิมยังรับ; หมดอายุและรู้เป้าหมาย → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่`; `preview` รับ `pm/pd/pa` จาก `wf_open` แทน `applied.paymentIntent` (:863) — มี `pa` แล้วไม่ตั้งยอดเป็นยอดค้างทั้งหมด (:539)
- `apps/api/src/modules/expenses/application/services/line-draft-preview.store.ts`: บันทึกกู้คืน `recover:<previewId>` TTL 7 วัน `{ companyId, userId, act, id, pm, pd, pa }` เขียนพร้อม preview (lea:588) และลบเมื่อกดยืนยัน/ยกเลิก; preview หาย (TTL 600 วินาที :29, :111) + มีบันทึก + เจ้าของตรง → E1 (ข); ไม่มีบันทึก → E1 (ก)
- `process-line-webhook.use-case.ts:3711–3731`: การ์ดหมดเวลาพร้อมปุ่ม
- ตรวจ: `process-line-webhook.use-case.spec.ts` (VOUCHER_SUBMIT → APPROVE → PAY → WHT หลัง 30 นาที; RECORD_PAYMENT พร้อมวิธีจ่ายเดิม; จ่ายบางส่วน 400 จาก 1,000 แล้วเปิดการ์ดใหม่ได้ 400; ยืนยันรายการที่สองในแชตเดียวกัน; E1 (ก) token ไม่ผ่าน → ข้อความเดิม lea:178 ไม่มีปุ่ม, (ข) เลย `expiresAt` หรือ preview หายหลัง 600 วินาทีแต่มีบันทึกกู้คืน → "การ์ดนี้หมดเวลาแล้วค่ะ" + ปุ่มที่ได้ preview ใหม่)

### A6a ปุ่มนำทาง `chat-action` (ขึ้นกับ A2)
- `packages/contracts/src/ai-tools.ts:257–303`: `workflow: true` + `substitute_receipt`; `mayOfferWorkflow` (spec R21)
- `line-business-card.logic.ts:48–61`: ทุกปุ่มเป็น postback `chat-action` (รวม :55)
- `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts`: ปุ่มในเมนูหลัก; :942 คงการแปลง id ที่ไม่ใช่ workflow
- ตรวจ: `line-business-card.logic.spec.ts`, `line-staff-menu.logic.spec.ts`

### A6b ปุ่มอ่านข้อมูลคงที่ 0 โมเดล (ขึ้นกับ A1, A2)
- `line-staff-menu.logic.ts:146–164`: `FIXED_READ` (id → label/ข้อความเดิม + tool + prepared family) และปุ่ม `QUERY_ACTIONS` เป็น postback `action=fixed-read&id=<id>` **เฉพาะ id ที่ family อยู่ใน prepared allowlist** (MC11); id อื่นคง message action เดิม; `parseLineFixedReadControl` (exact 2 keys) + branch ใน `linePostbackCommandText` (:928–945 วันนี้คืน null สำหรับ action ที่ไม่รู้จัก)
- controller + buffer: `fixedReadControl` ตาม A2 (ข้อความ synthetic = ข้อความเดิมของปุ่ม)
- `process-line-webhook.use-case.ts`: route plan ฝั่ง server + grant `serverRoute: 'fixed_read'` + narrow ordinal 0; ผล `PREPARED_READ_UNAVAILABLE` จาก guard เดิม (`orchestrator.agent.ts:1210–1222`) → ข้อความกลาง spec §10 + ปุ่มเว็บของ id นั้น (ไม่ใช้ข้อความเดิมที่ชี้หน้ารายจ่าย, ไม่เรียกโมเดลสำรอง)
- release gate: ทุก family ใน `FIXED_READ` อยู่ใน `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` ของ env ที่ปล่อย (`packages/config/src/index.ts:554`)
- ตรวจ: `process-line-webhook.use-case.spec.ts` (prepared รับ 0 call; prepared ปฏิเสธ → ข้อความกลาง + ปุ่มเว็บ 0 call), `line-staff-menu.logic.spec.ts`, `line-webhook.controller.spec.ts`; realpg `company-ai-usage-meter.spec.ts`

### A6c ทักทายเปิดเสมอ (อิสระ; แก้ B3)
- `process-line-webhook.use-case.ts`: ย้ายทักทาย (:7613–7632) ขึ้นก่อน v2 route (:7002)
- `packages/config/src/index.ts:322–326` ลบ flag; `apps/api/src/common/config/app-config.service.ts:129` ลบ getter; `packages/config/src/index.test.ts`
- ตรวจ: `process-line-webhook.use-case.spec.ts`; config test

### A7 Telemetry งาน (อิสระ)
- `apps/api/prisma/schema.prisma`: `LineAiTaskRun` + `taskRunId` + 2 คอลัมน์ classify (migration เดียว, additive)
- `process-line-webhook.use-case.ts`: task run ตามขอบเขตงาน (spec §6.2); log `line.ai.task_summary` (ต้นทุนไม่ปัด/ลูกค้า/บริษัท, basis ของแถว absorbed จาก `providerUsageBasis` cbr:956)
- `scripts/line-ai-task-report.ts`
- การลบตามอายุ: sweep เดียวกับ `LineWebhookEventLog` (MC6)
- ตรวจ: `pnpm --filter @watchdog-bms/api prisma:validate`; migrate บน Postgres ในเครื่อง; `process-line-webhook.use-case.spec.ts`

### A10 ใบทดแทน: เตรียมเอกสารจากการกดการ์ดที่ลงนามเท่านั้น (แก้ B7; อิสระ)
- ก่อนแก้: test ที่ล้มบน baseline — พิมพ์ "2" ขณะ `ISSUE_CONFIRM` ผ่านทาง route ความหมาย (pwu:7843–7844) และทาง clarification (pwu:7438–7440) แล้วดูว่า `prepare.execute` ถูกเรียก; บันทึกทางที่พบใน memory (MC9)
- `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts`: input ของ `execute` (:1678) เพิ่ม `confirmedDecision?: 'ISSUE' | 'FORM'` (server-only); `answerIssueDecision` (:2189) — ISSUE/FORM ที่มาจากข้อความ (ไม่มี `confirmedDecision`) คืนผล READY_FOR_WEB + `decisionOffered` โดยไม่แก้ `ExpenseRecord` และไม่เรียก `prepareFromLine` (:2289); มี `confirmedDecision` → ทางเดิม (ISSUE ที่ไม่มีลายเซ็นยังขอรูปลายเซ็นก่อน)
- **หมวดก่อนยืนยัน (BLOCKER R4-F1 = B8, spec §17.2)**: continuation เลิกส่ง `expenseCategoryId` ให้ `saveLineSubstituteContinuation` (:2000 → repository :4312) — เก็บใน `acceptedValues` เท่านั้น; จุดที่อ่านหมวดจากแถวก่อนยืนยันประเมินด้วย `{ ...expense, expenseCategoryId: proposed }` (blocker หมวดใช้ค่าที่เสนออยู่แล้ว :552); `prepareFromLine` (:2346) เขียนหมวดด้วย CAS ก่อน `review.execute` (:2367) ในการกดครั้งเดียว; ข้อความ :1266–1268 / :1315–1317 ใช้รุ่น "(ยังไม่แก้รายการ)"
- `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts`: `prepare(ctx, chat, expenseId, language, decision = 'ISSUE')` (:100) ใส่ `decision` ใน token + digest; ตัวกันลายเซ็น `state.signatureRequested && !findReusableSignatureAsset` (:116) ใช้เฉพาะ `decision === 'ISSUE'` (continuation ตั้ง `signatureRequested: true` ที่ :2315 เมื่อ ISSUE ไม่มีลายเซ็น — ไม่งั้นการ์ด FORM ถูกขอลายเซ็นแทน); การ์ด FORM/PREPARE ใช้ label/summary ตาม spec §10 และแสดงหมวดที่เสนอ; `apply` (:178) ส่ง `confirmedDecision` จาก token แทน `messageText: '1'` (:203)
- `process-line-webhook.use-case.ts`: `rememberSubstituteDeliverySource` (:5863–5877) ส่ง `decisionOffered` เข้า `prepare`
- ตรวจ: `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` (ลงทะเบียนแล้ว) + `process-line-webhook.use-case.spec.ts` (AC20 ทุก turn ของการเก็บข้อมูล: หมวดไม่ถูกเขียนก่อนกด; ISSUE ที่ขอลายเซ็น → พิมพ์ "2" → การ์ด FORM ไม่ขอลายเซ็น); test ที่ล้มบน baseline ก่อนแก้สำหรับ B8 ด้วย; whole-chain (catalog เรียก `line-substitute-receipt-continuation.use-case.spec.ts` บางชื่อ — ต้องยังผ่าน)

### A8 Release gate Phase A (ขึ้นกับ A1–A7, A9, A10)
- whole-chain catalog: scenario Tier 0 + `unusable-output-absorbed` + `document-qa-unusable-absorbed` + `claim-edit-route-unchanged` + `substitute-typed-choice-shows-signed-card` + `partial-payment-next-step-keeps-amount` + `invalid-token-vs-expired-card` (spec §11)
- W00 regenerate + api intake `line.workflow_control` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts`)
- live replay: button journey ชุดจูน (W3 = 100%, 0 การเรียก) + typed journey ทั้งชุด
- proof stack → UAT ตาม runbook (บันทึก run id) → Owner เดินจริงบน LINE → Production เมื่อ Owner สั่ง

---

## Phase B — ข้อความงานซ้ำ = classifier ครั้งเดียว (Tier 1)

### B1 Provider บังคับ schema + probe (ขนานกับ A; เป็นเงื่อนไขของ B2–B5)
- `provider.port.ts`: `outputSchema`
- `bedrock.provider.ts` (`generateText` :83): `outputConfig.textFormat`; strict tool ผ่าน `generateWithTools` (:115–157); `anthropic-api.provider.ts`: `output_config.format`; `openai.provider.ts`: `PROVIDER_CONTRACT_UNSUPPORTED`
- `ai-budget-provider.ts:126–162`: outputSchema ใน `textBytes`, `schemaDigest`, `payloadDigest` (ไม่มี = byte เดิม)
- MC4: ตรวจ SDK; MC3: probe บน UAT ด้วย schema จริงกับ `global.anthropic.claude-sonnet-4-6` ตาม runbook (Owner รับทราบก่อน) — ไม่ผ่านทั้งสองทาง = หยุด Phase B
- ตรวจ: `bedrock.provider.spec.ts`, `ai-usage.interceptor.spec.ts`

### B2 Contracts + classify authority (ขึ้นกับ B1 ผ่าน)
- `packages/contracts/src/ai-budget-bounds.ts`: authorityKind `'webhook_classify'` (parser :285–322), profile `line-classify/2` (24,576 / 1,024 / 1), digest ใหม่ — ไม่แก้ฟังก์ชัน slot (:339–351)
- `packages/contracts/src/line-ai.ts`: request/response (spec §7.2 รวม `descriptionText`)
- `line-ai-budget-authority.service.ts`: คอลัมน์ตาม kind (:81–86, :124–178, :180, :199, :305–363), lane `classify` 8,000 ms (:45), ปฏิเสธ `narrow`/`transferToDocumentQa`, เก็บ `decision`
- `ai-budget-provider.ts`: usageTag `line.workflow-classify` → profile ใหม่
- ตรวจ: contracts build; typecheck API + gateway; realpg `company-ai-usage-meter.spec.ts` (classify ไม่กระทบ turn grant, เรียกได้ครั้งเดียว, replay ใช้ decision เดิม); regression: `semantic-turn-v2.ts:727`, `document-qa.use-case.ts:97`, `orchestrator.agent.ts:1210`, `agentcore/runtime.ts:732` ไม่เปลี่ยน

### B3 Classifier ใน gateway (ขึ้นกับ B2, A9)
- ไฟล์ใหม่ `apps/ai-gateway/src/modules/line-ai/agents/workflow-classifier.agent.ts`: พรอมต์ 4,000 ตัวอักษร–8,000 ไบต์ + schema + `acceptOutput` (span/ช่วงความมั่นใจ/enum/candidate) + timeout 4,000 ms + thinking ปิด
- `line-ai-internal.controller.ts`: `@Post('line-workflow-classify')` → `/v1/internal/ai/line-workflow-classify`
- ตรวจ: `line-intake-router.agent.spec.ts` (ไม่มีข้อมูลร้าน, bound ≤ 24,576, ตก/timeout/ช้า = UNAVAILABLE + `ok:false`), `line-ai-internal.controller.spec.ts`

### B4 Tier 1 ใน API (ขึ้นกับ B3, A3c, A4b, A8)
- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts`: `requestLineWorkflowClassify` + issue classify grant
- `process-line-webhook.use-case.ts`: Tier 1 ก่อน `tryRouteIntake` (:7007) ตาม R7; label → `pick`/`startFromWorkflow` (slot `descriptionText/amountText/dateText` → `parseManualClaimLine`); ไม่ผ่าน R9 → ตาราง spec §7.2.1; `อย่างอื่น` → admission ใหม่ของ event ใหม่ (acceptedAtMs ใหม่ + provenance เดิม; วันที่กรุงเทพเปลี่ยน → ขอพิมพ์ใหม่) → Tier 2; อื่น ๆ → Tier 2
- ตรวจ: `process-line-webhook.use-case.spec.ts` (1 call ต่องาน, ตาราง §7.2.1 สี่แถว, `อย่างอื่น` หลัง 60 วินาทีไม่หมดเวลา, ข้ามวันขอพิมพ์ใหม่, ไม่มีทางอนุญาต, เครดิตไม่พอ), `ai-gateway.client.spec.ts`; realpg

### B5 ปรับเกณฑ์ + release gate Phase B (ขึ้นกับ M3, B4)
- ตั้ง T/M บนชุดจูน (measurement spec §7.4) ล็อกในโค้ด
- held-out → MA3; ไม่ผ่าน = ไม่ปล่อย Tier 1
- เวลาตาม spec AC14 (Tier 0/1 ≤ 15 วิ; fallback ไป Tier 2 ตาม A7 ภายใน deadline เดิมของ turn)
- whole-chain + W00 + live replay + UAT + Owner + Production; หลัง deploy เรียก classifier 1 ครั้งเพื่อ compile grammar; เฝ้า W14

### B6 (เมื่อหลักฐานรองรับเท่านั้น) ลดพรอมต์ planner
- telemetry 2 สัปดาห์แสดงว่างานซ้ำไม่ไป Tier 2 → ตัดร้อยแก้วงานซ้ำจาก `CONTROL_PROMPT` (stv2:89); rebuild AgentCore; วัด W11; ถ้าแตะพรอมต์ router ต้อง recalibrate (`scripts/recalibrate-line-intake.cjs`)

---

## Phase C — Haiku 5.5 ให้ classifier (หลัง B5 + Owner Q2)

### C1 โมเดลของ classify grant
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.factory.ts:21–29`: ใช้ `grant.model` ของ classify grant (ไม่กระทบ turn)
- `ai-gateway.client.ts` (`LINE_V2_TARIFFS`) + `apps/api/src/modules/line-ai/application/ai-model-pricing.ts`: tariff `global.anthropic.claude-haiku-5-5` (≤ 100k prompt); ยอดลงบัญชีต่อการเรียกปัด ROUND_HALF_UP เป็นสตางค์เต็ม (:223) — เป็น 0 เฉพาะเมื่อต่ำกว่า 0.5 สตางค์ (อุ่น ~0.35 → 0; เย็น 1.29525 → 1); รายงานต้นทุนใช้ค่าไม่ปัด
- `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/reviewed-line-model-capacity.ts`: แถว `global.anthropic.claude-haiku-5-5` พร้อมหลักฐาน AWS model card และ ceiling 100,000 โทเคน (MC10) — ไม่มีแถวนี้ capability endpoint ตอบ `ready: false` (`line-reliability-capabilities.controller.ts:24–37`) และ client คืน null (`ai-gateway.client.ts:168–175`)
- `ai-gateway.client.ts` (`requestLineWorkflowClassify`): capability request ของ classifier ส่ง `modelPolicy: { modelId: LINE_CLASSIFY_MODEL_ID }` (ค่าคงที่ในโค้ด) แทน model ของบริษัท ยกเว้นบริษัทที่มี model policy ของ partner (:159) — spec §6.4
- config: model id ใน approved list; ขอการเข้าถึงโมเดลใน console
- ตรวจ: realpg (โมเดลผิด = refuse), `ai-model-pricing.spec.ts`, `line-ai-internal.controller.spec.ts` (capability ของ Haiku 5.5 `ready` เมื่อครบเงื่อนไข), `ai-gateway.client.spec.ts` (classify grant ได้ model ของ classifier; turn grant ยังได้ model ของบริษัท)

### C2 Converse กับ Haiku 5.5 (ไม่มี transport ใหม่)
- `BedrockProvider` (Converse) เดิม; classifier ส่ง `additionalModelRequestFields` = `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }` (ชื่อของ Messages API; ชื่อบน Converse ยืนยันใน probe — MC5); test output ถูกตัด
- Phase C ใช้ Bedrock เท่านั้น (measurement M-R2; `provider.factory.ts:52–54` เลือก `AnthropicApiProvider` เมื่อมีคีย์ local และคำขอนั้นไม่ปิด thinking) — `run-real` ปฏิเสธรัน Phase C ที่ transport ≠ bedrock
- probe 1 ครั้งบน UAT ตาม runbook
- ตรวจ: `bedrock.provider.spec.ts`

### C3 Eval + release
- held-out เดิม → MA4 (ต้นทุน provider ไม่ปัด); ผ่าน → release; ไม่ผ่าน → คง Sonnet

---

## Phase D — ปิดงานเอกสาร

- backlog ค 16–24: สถานะ/ตัวเลขจริง; amendment ของ budget contract; สูตร LINE fake ลง `docs/runbooks/` (G12)
- memory: run id ของ UAT/READY/Production, ผลวัด, สิ่งที่ยังไม่ได้กดทดสอบ

## การตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่บันทึก)

1. ชื่อ workflow = `LINE_CHAT_ACTIONS` id (+ `substitute_receipt`); ไม่มี workflow แก้ใบเบิก และทางแก้เดิมไม่เปลี่ยน (UPDATE/TARGET คงเป็นข้อความ)
2. ไม่มีตารางสถานะ workflow ใหม่; ตารางใหม่ไว้วัดผลเท่านั้น
3. classifier ไม่เห็นข้อมูลร้าน; ตัวเลข/วันที่จากตัวอ่านค่าเดิม; รายละเอียดรายการต้องเป็น span ของข้อความจริง
4. classifier มี authority/attempt/grant ของตัวเอง — invariant ของ turn grant ไม่เปลี่ยน
5. การอนุญาตต่อรายการ = โค้ดเดิม; การอ่านเพื่อ picker = scope ของ use-case รายการ (+ ผู้สร้างเห็นของตัวเองถ้า MC1 อนุมัติ)
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
