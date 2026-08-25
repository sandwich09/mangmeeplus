# Mangmee Brain Real Answers — Architecture Delivery Plan

สถานะ: **DRAFT v2 คู่กับ [mangmee-brain-real-answers-spec](../specs/mangmee-brain-real-answers-spec.md) (2026-08-25)**

กติกา: ทำตามลำดับเป้าหมาย **รับคนให้ไหว → ใช้แล้วชอบ → โตต่อได้**; smallest correct diff; ทุก phase มี focused check; ไม่มี phase ใดเปิด flag production; ทุกการเปิด UAT ผ่าน deploy.sh + บันทึก run ID ตาม `docs/runbooks/uat-production-v2-deployment.md`

ความสัมพันธ์กับแผนหลัก: Phase 0–1 อยู่ในรอบ 2.5 วัน (P6 ของแผน v4); Phase 2–10 คือ Brain-Real B1–B7 ของรอบถัดไป ทำคู่ขนานกับ P10–P12 ได้ แต่ Developer 1 คนทำทีละ phase

## Architecture delivery map

| Phase | Priority track | Outcome | Source plan ที่ reuse | Hard gate |
|---|---|---|---|---|
| 0 | B0 / P6-6B | telemetry UAT ใช้งานจริง + top-3 questions อยู่ใน manifest | assessment §5 | flags off, exact SHA/environment |
| 1 | P6-6A | baseline หมวดรายจ่าย + UX/metric ที่วัด override ได้ | spec S1 | golden set ≥30 และไม่มี cross-company category |
| 2 | B1 | hosted latency/cost/quality baseline | latency plan Phase 0/7 | traffic 2–3 วัน, stage p50/p95 ผูก SHA |
| 3 | B2 | ผู้ใช้เห็นว่ารับเรื่องแล้วภายใน SLO | latency plan Phase 1 | loading หลัง durable acceptance เท่านั้น |
| 4 | B3 | ลด debounce โดยไม่ทำข้อความแตก/ตอบซ้ำ | latency plan Phase 2 | 1,000/1,500/2,500 cohort gates |
| 5 | B4 | รู้ precision/recall ของ provider plan โดยไม่เปลี่ยนคำตอบ | latency plan Phase 3 shadow | zero user-visible behavior change |
| 6–7 | B5 | security suite กลับมารัน + canary prepared lane | spec S2 | 23/23, blind eval, kill-switch drill |
| 8–9 | B6 | 3 families หลักตอบเร็วและ grounded | spec S3 | golden/eval/cross-tenant/hosted ต่อ family |
| 10 | B7 | social conversation เป็นธรรมชาติ | advisor plan Slice A | persona/safety/mixed-intent/cost gates |

ลำดับ dependency บังคับคือ `B0 → B1 → B2 → B3 → B4 → B5 → B6 → B7`; งาน 6A อยู่ข้าง B0 แต่ทำก่อนตามคำสั่ง Owner. `AI-01`, P3 และ Gate C เป็น release gates คร่อมทุก phase ไม่ใช่งานท้ายแผน

## Phase 0 — B0: ยืนยันฐานก่อนแตะโค้ด (ในรอบ 2.5 วัน, ~1 ชม.)

งาน:

1. ยืนยัน telemetry บน UAT: `line.ai.api_trace`, `line.ai.stage`, `line.ai.turn_summary` ปรากฏใน hosted log (อ่าน cloud ตาม `docs/runbooks/cloud-environment-operations.md`) — ถ้าไม่พบ = UAT build เก่ากว่า merge → จัดคิว deploy เป็นงานแรกหลัง P8 และบันทึกใน manifest
2. บันทึกใน release manifest: รายการคำถาม 3 ข้อที่ Owner ยืนยัน + family key เป้าหมาย + flag ทุกตัวที่เกี่ยว = `off`

Exit evidence: log ตัวอย่าง 3 ชุดผูก SHA/environment; manifest updated

## Phase 1 — S1: หมวดรายจ่าย วัดก่อนปรับ (ในรอบ 2.5 วัน = 6A, 2 ชม. + งานต่อเนื่อง)

### 1.1 Golden set + harness (ในรอบ)

- สร้าง `scripts/expense-category.golden.ts` + `scripts/expense-category.golden.spec.ts` ตาม pattern `scripts/line-ai-latency-autonomy.corpus.ts` (root scripts = offline dev harness, **ห้ามถูก import จาก app test**)
- Fixture = sanitized OCR text + active catalogue snapshot + เฉลย (spec S1-R1, G7); เริ่ม ≥30 ใบ; Owner/นักบัญชียืนยันเฉลย (spec §10.3)
- Runner ให้คะแนน: suggestion accuracy, auto-fill accuracy (เกณฑ์ 0.85 ปัจจุบัน), omit rate, confusion pairs

Verify: `pnpm exec tsx --test scripts/expense-category.golden.spec.ts` (โครง harness); ผล baseline บันทึกเป็นไฟล์รายงานใน manifest

### 1.2 Baseline hosted (ในรอบ ถ้า UAT พร้อม; ไม่งั้นวันถัดไป)

- รัน fixture ผ่านเส้นทางจริง (UAT intake หรือ provider config เดียวกับ UAT) เก็บผลเทียบ offline

### 1.3 ปรับตามตัวเลข (หลัง baseline เท่านั้น)

- แตะได้เฉพาะ: prompt (`apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` ส่วน categorySuggestion), catalogue ของบริษัทนำร่อง, ค่า `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE` (`packages/contracts/src/line-ai.ts:278`) — เปลี่ยนค่าต้องมี calibration report แนบ
- รัน golden ซ้ำ: ทุกมิติไม่แย่ลง + ดีขึ้นตามเกณฑ์ที่บันทึก

Verify: prompt-contract test ใน gateway ยังผ่าน; `pnpm -C apps/ai-gateway test`; golden report before/after

### 1.4 UX ยืนยัน + telemetry (ในรอบส่วน UX; telemetry ทำต่อได้)

- **เพิ่ม data path ก่อนแตะ UI:** suggestion ต่ำกว่าเกณฑ์ถูกทิ้งหลัง apply วันนี้ (review finding) — persist/expose ผ่าน API แบบ additive ให้ review payload มี suggestion (id/confidence/ชื่อหมวด) ก่อน จึงทำ UI "ตัวเลือกแนะนำ" ได้
- Web review form: ตรวจ/แก้ให้ตรง S1-R4 (pre-selected, แก้ 1 แตะ, ไม่มี suggestion ไม่เดา) — ไฟล์หลัก `apps/web/src/features/expenses/` (ExpenseReviewPage/model ตามหลักฐาน spec 2.1)
- ครอบเส้นทาง LINE draft conversation ด้วย (`line-expense-draft-conversation.use-case.ts` ถือ `suggestedCategoryId` อยู่แล้ว): override event ต้องยิงจาก LINE เช่นกัน + อย่างน้อยหนึ่ง use-case test
- เพิ่ม product events ตาม S1-R5 ใน apply/confirm path ฝั่ง API (web + LINE) + redaction test

Verify: Playwright เคส review form (390px + desktop); `receipt-ocr-apply.service.spec.ts` extended; telemetry payload ไม่มี PII

Exit Phase 1: ตาราง baseline↔after ผูก SHA; override-rate event ใช้งานจริงบน UAT

## Phase 2 — B1: Hosted baseline (รอบถัดไป, measurement 2–3 วัน)

1. หลัง B0 ยืนยัน telemetry เก็บ UAT/beta traffic โดยทุก latency flag ยัง off; แยก journey/lane และ split-utterance cohort
2. สรุป p50/p95 ของ webhook → durable acceptance → loading/process start → router/model/tool/composer → delivery พร้อม model/tool-call count และ cost ต่อ eligible turn
3. ผูก report กับ SHA, environment, provider/model config และ sample size; ห้ามรวม lane จนค่าเฉลี่ยซ่อน path ช้า

Exit: baseline report ที่ใช้เป็น control ของ B2–B6; ถ้า telemetry ขาด stage ใดให้ซ่อม instrumentation ก่อน activation

## Phase 3 — B2: Loading-on-accept (ตาม latency plan)

1. Wire `LINE_AI_LOADING_ANIMATION_ENABLED` master + `LINE_AI_LOADING_ON_ACCEPT_ENABLED` เข้า deploy.sh ด้วย UAT-only guard
2. เปิด tenant canary หลัง durable acceptance; ตรวจ ordering, duplicate webhook, final-before-loading cancellation และ group chat ที่ไม่มี loading
3. เทียบ loading-request accepted p95 กับ B1 และซ้อมปิด flag ให้กลับ processing-start behavior

Exit: accepted ≤1s p95 ตามเป้าทดลอง, ไม่มี feedback ก่อน durable acceptance, run ID + rollback evidence

## Phase 4 — B3: Debounce cohort (ตาม latency plan)

1. เปิด cohort `1,000 ms primary / 1,500 ms conservative / 2,500 ms control` ตาม decision เดิม โดยคง per-chat serialization
2. วัด fragment rate, re-ask/duplicate rate, final latency, model calls และ cost; equality boundary ต้อง deterministic
3. เลือก candidate เมื่อ quality guard ผ่าน; ถ้า 1,000 ms ถดถอยให้ใช้ 1,500 ms ไม่ลด guard

Exit: cohort report + chosen value/rollback; config ที่ไม่ได้เลือกยังไม่เปิดกว้าง

## Phase 5 — B4: Fused-plan shadow (ตาม latency plan)

1. Wire/เปิด `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` บน UAT โดยไม่ forward authority ไป execute path
2. เทียบ proposed plan กับ full-path outcome: eligible precision/recall, sanitizer mismatch, unsupported/mutation/permission cases และ provider quality
3. ถ้า precision ไม่ผ่าน ให้ปรับ bounded prompt/schema แล้ว replay corpus; ห้ามเปิด prepared execution เพื่อชดเชยตัวเลข shadow

Exit: shadow report ผูก provider/SHA; user-visible answer byte/path ไม่เปลี่ยน

## Phase 6 — B5/S2: Security suite กลับมารันจริง (รอบถัดไป, ~0.5–1 วัน)

1. ย้าย `LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES` → `packages/contracts` (ไฟล์ใหม่ข้าง `line-ai-prepared-plan.ts`); root `scripts/line-ai-latency-autonomy.corpus.ts` re-export เพื่อคง protected manifest เดิม (ปัจจุบัน **256 ids = 164 + 92** ตาม assert ใน `scripts/line-ai-latency-autonomy.corpus.spec.ts:300-306` — ยึดตัวเลขจาก assert ไม่ hardcode ใหม่)
2. เขียน executing spec ใน `apps/ai-gateway` ตาม spec S2-R2 (method-call counters; zero-ERP-call; provenance; sanitizer)
3. ลงทะเบียนไฟล์ spec ใหม่เข้า explicit list ใน `apps/ai-gateway/package.json` `scripts.test` ตาม spec S2-R2b (ข้อยกเว้น AGENTS.md ที่ระบุเหตุผลไว้แล้ว — เพิ่มแถวอย่างเดียว ไม่จัดเรียง) พร้อมเพิ่ม `prepared-simple-read-formatter.spec.ts` ที่ orphan อยู่เข้า list ด้วย
4. ยืนยัน image build ไม่พัง (จุดที่เคยพังคือ import ข้าม boundary)

Verify: `pnpm -C packages/contracts build`; contracts specs เดิมเขียว; gateway `pnpm test` รวม 23/23; UAT build run เขียว

## Phase 7 — B5/S2: Canary family บน UAT (รอบถัดไป, ~0.5 วัน + eval)

1. Wire flags เข้า `infra/prod-ecs-express/deploy.sh` ตาม pattern `LINE_AI_EXACT_GREETING_ENABLED` (บรรทัด 28–104, 354–361, 1457–1458): `LINE_AI_PREPARED_SIMPLE_READ_ENABLED`, `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`, และ `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` (B4) — UAT เปิดได้ / production hard-block
2. Blind pairwise eval ของ `sales.get_sales_summary::single_metric` ตาม Phase 5 gate → ผ่านแล้วจึงใส่ allowlist UAT
3. เปิดบน UAT, เก็บ `prepared_simple_read.*` + latency เทียบ baseline; ซ้อม kill switch (CLOSE → กลับ full path)

Exit: UAT run IDs, eval report, hosted p50/p95, drill record

## Phase 8 — B6/S3-F1 สรุปค่าใช้จ่าย แล้วจึง F2 (รอบถัดไป, ~1–1.5 วัน)

F1 (`expense.list_recent`, ไม่แก้ API):

1. อ่าน response shape จริงของ tool → เลือก answerShape เดียว → เขียน formatter + fixtures ใน `prepared-simple-read-formatter.ts` (pattern family เดิม: grounded total, source ref, asOf, period, honest zero, unverified)
2. Golden set คำถาม ≥20 phrasing/ภาษา → routing + คำตอบตรง seed data; security regression 23 เคส + cross-tenant E2E
3. Blind pairwise eval → allowlist UAT → hosted latency + load smoke ชุดแผน P7

F2 (`accounting.get_summary::list`) — **แก้ G1 ก่อน**:

1. แก้ aggregation ใน `erp-business-tools.use-case.ts:42-70` ให้ครบทุกหน้า (มี bound) + regression เดือน >200 ใบ + วัด latency hosted (G10)
2. จากนั้นทำ formatter/golden/eval/allowlist ตามลำดับเดียวกับ F1; ขอบเขต "รายการ" ยืนยันกับ Owner ตอน fixtures (spec §10.2)

## Phase 9 — B6/S3-F3 เงินเข้า–ออกวันนี้ (รอบถัดไป, ~1–1.5 วัน หลังนิยามลงนาม)

1. Owner + นักบัญชีลงนามนิยามเงินเข้า/เงินออก (spec §5-F3, §10.1) — ก่อนเขียนโค้ด
2. เพิ่ม tool `accounting.get_cash_movement_summary`: registry entry ใน `packages/contracts/src/ai-tools.ts` (ตาม shape entry เดิม) + tool class ใน `erp-business-tools.use-case.ts` (ตาม pattern `AccountingGetSummaryTool`) + **ลงทะเบียน DI ให้ครบ** (review finding): `apps/api/src/modules/line-ai/line-ai.module.ts` (import + `erpTools` array) และ `internal-tools.controller.ts` (import + constructor param + `toolMap.set`) — permission ตามกลุ่มที่มีอยู่, default วันนี้, ระบุ source "จากรายการที่บันทึกในระบบ"
3. Unit: permission negative, นิยามตรงลายเซ็น, explicit-empty, ช่วงวันที่; security เคสใหม่ (forged/cross-company input → sanitizer ตัด → fallback)
4. Formatter (เข้า X / ออก Y / สุทธิ Z + วันที่ + source) + fixtures + golden + blind eval → allowlist UAT

## Phase 10 — B7: Advisor Slice A (ตาม advisor plan)

1. ทำเฉพาะ `SOCIAL_CHAT` บน one-brain/router/composer เดิม; ไม่เพิ่ม agent, knowledge registry, company profile หรือ tool ชุดใหม่
2. Reuse advisor plan เฉพาะ Phase 0/1/4/5/8/9 ส่วน social: persona + short-term context เพื่อ pronoun/follow-up/tone, one-call prepared answer, validator, observability และ feedback ที่ไม่รบกวน
3. เปิดตามลำดับ measurement cohort (`mode=social`, direct answer off) → social direct-answer UAT/canary; mixed social+business ต้องไป business lane เดิม และ group/room ต้องไม่มี company context
4. รัน persona/naturalness, fake-human/dependency, crisis/privacy, mixed-intent และ cross-chat context eval; generative calls เฉลี่ย ≤1.1 และ cost gate เทียบ reference path

Exit: ผู้ใช้คุย social ได้เป็นธรรมชาติ; blind human naturalness win-or-tie ≥0.90; copy/CTA ปรับให้ตรง capability ที่เปิด. Advisor Slice B/C (knowledge/company) และ Knowledge Pack registry ยังอยู่ P23 ตามคำสั่ง Owner

## รายงานและ gate ปิดท้าย

- ทุก phase อัปเดต `docs/agent-memory/mangmee-brain-real-answers.md` (สร้างเมื่อเริ่ม Phase 1): status, run IDs, ตัวเลข, สิ่งที่ค้าง
- Production enable ต้องครบ: security suite ใน CI, per-family eval, hosted latency, `AI-01` ปิด, P3 drill ครอบ flag ใหม่, Owner sign-offs ครบ (spec §10)
- สิ่งที่ **ไม่ทำ** ในแผนนี้: เขียน debounce/loading/advisor architecture ซ้ำ (reuse plan เดิม), web chat, Knowledge Pack เต็มรูปแบบ, billing, รายรับ

## ความเสี่ยงหลักและการกันไว้

| ความเสี่ยง | กันโดย |
|---|---|
| แก้ prompt แล้วความสามารถอื่นถดถอย | prompt-contract tests เดิม + protected eval manifest ทั้งชุด (256 ids ตาม assert ใน corpus spec) ต้องเขียวก่อน merge |
| Family ตอบตัวเลขผิดจาก tool bug | G1 แก้ก่อน F2; golden ต่อ family เทียบ seed จริง; formatter ห้ามคำนวณเอง |
| เปิดแล้วปิดไม่ทัน | ทุก flag/allowlist ใน manifest + P3 drill; allowlist ถอดแล้วกลับ full path ทันที |
| งานชนกับ P10–P12 (dev คนเดียว) | Phase 2–10 ประกาศคิวรายสัปดาห์ในแผนหลัก; ไม่เริ่มสอง phase พร้อมกัน |
