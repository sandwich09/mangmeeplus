# Mangmee Brain Real Answers — Implementation Plan

สถานะ: **DRAFT v1 คู่กับ [mangmee-brain-real-answers-spec](../specs/mangmee-brain-real-answers-spec.md) (2026-08-25)**

กติกา: ทำตามลำดับเป้าหมาย **รับคนให้ไหว → ใช้แล้วชอบ → โตต่อได้**; smallest correct diff; ทุก phase มี focused check; ไม่มี phase ใดเปิด flag production; ทุกการเปิด UAT ผ่าน deploy.sh + บันทึก run ID ตาม `docs/runbooks/uat-production-v2-deployment.md`

ความสัมพันธ์กับแผนหลัก: Phase 0–1 อยู่ในรอบ 2.5 วัน (P6 ของแผน v4); Phase 2–5 คือ Brain-Real B5–B6 ของรอบถัดไป ทำคู่ขนานกับ P10–P12 ได้

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

## Phase 2 — S2: Security suite กลับมารันจริง (รอบถัดไป, ~0.5–1 วัน)

1. ย้าย `LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES` → `packages/contracts` (ไฟล์ใหม่ข้าง `line-ai-prepared-plan.ts`); root `scripts/line-ai-latency-autonomy.corpus.ts` re-export เพื่อคง protected manifest เดิม (ปัจจุบัน **256 ids = 164 + 92** ตาม assert ใน `scripts/line-ai-latency-autonomy.corpus.spec.ts:300-306` — ยึดตัวเลขจาก assert ไม่ hardcode ใหม่)
2. เขียน executing spec ใน `apps/ai-gateway` ตาม spec S2-R2 (method-call counters; zero-ERP-call; provenance; sanitizer)
3. ลงทะเบียนไฟล์ spec ใหม่เข้า explicit list ใน `apps/ai-gateway/package.json` `scripts.test` ตาม spec S2-R2b (ข้อยกเว้น AGENTS.md ที่ระบุเหตุผลไว้แล้ว — เพิ่มแถวอย่างเดียว ไม่จัดเรียง) พร้อมเพิ่ม `prepared-simple-read-formatter.spec.ts` ที่ orphan อยู่เข้า list ด้วย
4. ยืนยัน image build ไม่พัง (จุดที่เคยพังคือ import ข้าม boundary)

Verify: `pnpm -C packages/contracts build`; contracts specs เดิมเขียว; gateway `pnpm test` รวม 23/23; UAT build run เขียว

## Phase 3 — S2: Canary family บน UAT (รอบถัดไป, ~0.5 วัน + eval)

1. Wire flags เข้า `infra/prod-ecs-express/deploy.sh` ตาม pattern `LINE_AI_EXACT_GREETING_ENABLED` (บรรทัด 28–104, 354–361, 1457–1458): `LINE_AI_PREPARED_SIMPLE_READ_ENABLED`, `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`, และ `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` (B4) — UAT เปิดได้ / production hard-block
2. Blind pairwise eval ของ `sales.get_sales_summary::single_metric` ตาม Phase 5 gate → ผ่านแล้วจึงใส่ allowlist UAT
3. เปิดบน UAT, เก็บ `prepared_simple_read.*` + latency เทียบ baseline; ซ้อม kill switch (CLOSE → กลับ full path)

Exit: UAT run IDs, eval report, hosted p50/p95, drill record

## Phase 4 — S3-F1 สรุปค่าใช้จ่าย แล้วจึง F2 (รอบถัดไป, ~1–1.5 วัน)

F1 (`expense.list_recent`, ไม่แก้ API):

1. อ่าน response shape จริงของ tool → เลือก answerShape เดียว → เขียน formatter + fixtures ใน `prepared-simple-read-formatter.ts` (pattern family เดิม: grounded total, source ref, asOf, period, honest zero, unverified)
2. Golden set คำถาม ≥20 phrasing/ภาษา → routing + คำตอบตรง seed data; security regression 23 เคส + cross-tenant E2E
3. Blind pairwise eval → allowlist UAT → hosted latency + load smoke ชุดแผน P7

F2 (`accounting.get_summary::list`) — **แก้ G1 ก่อน**:

1. แก้ aggregation ใน `erp-business-tools.use-case.ts:42-70` ให้ครบทุกหน้า (มี bound) + regression เดือน >200 ใบ + วัด latency hosted (G10)
2. จากนั้นทำ formatter/golden/eval/allowlist ตามลำดับเดียวกับ F1; ขอบเขต "รายการ" ยืนยันกับ Owner ตอน fixtures (spec §10.2)

## Phase 5 — S3-F3 เงินเข้า–ออกวันนี้ (รอบถัดไป, ~1–1.5 วัน หลังนิยามลงนาม)

1. Owner + นักบัญชีลงนามนิยามเงินเข้า/เงินออก (spec §5-F3, §10.1) — ก่อนเขียนโค้ด
2. เพิ่ม tool `accounting.get_cash_movement_summary`: registry entry ใน `packages/contracts/src/ai-tools.ts` (ตาม shape entry เดิม) + tool class ใน `erp-business-tools.use-case.ts` (ตาม pattern `AccountingGetSummaryTool`) + **ลงทะเบียน DI ให้ครบ** (review finding): `apps/api/src/modules/line-ai/line-ai.module.ts` (import + `erpTools` array) และ `internal-tools.controller.ts` (import + constructor param + `toolMap.set`) — permission ตามกลุ่มที่มีอยู่, default วันนี้, ระบุ source "จากรายการที่บันทึกในระบบ"
3. Unit: permission negative, นิยามตรงลายเซ็น, explicit-empty, ช่วงวันที่; security เคสใหม่ (forged/cross-company input → sanitizer ตัด → fallback)
4. Formatter (เข้า X / ออก Y / สุทธิ Z + วันที่ + source) + fixtures + golden + blind eval → allowlist UAT

## รายงานและ gate ปิดท้าย

- ทุก phase อัปเดต `docs/agent-memory/mangmee-brain-real-answers.md` (สร้างเมื่อเริ่ม Phase 1): status, run IDs, ตัวเลข, สิ่งที่ค้าง
- Production enable ต้องครบ: security suite ใน CI, per-family eval, hosted latency, `AI-01` ปิด, P3 drill ครอบ flag ใหม่, Owner sign-offs ครบ (spec §10)
- สิ่งที่ **ไม่ทำ** ในแผนนี้: debounce/loading activation (ตาม latency plan เดิม), advisor slices, web chat, Knowledge Pack, billing, รายรับ

## ความเสี่ยงหลักและการกันไว้

| ความเสี่ยง | กันโดย |
|---|---|
| แก้ prompt แล้วความสามารถอื่นถดถอย | prompt-contract tests เดิม + protected eval manifest ทั้งชุด (256 ids ตาม assert ใน corpus spec) ต้องเขียวก่อน merge |
| Family ตอบตัวเลขผิดจาก tool bug | G1 แก้ก่อน F2; golden ต่อ family เทียบ seed จริง; formatter ห้ามคำนวณเอง |
| เปิดแล้วปิดไม่ทัน | ทุก flag/allowlist ใน manifest + P3 drill; allowlist ถอดแล้วกลับ full path ทันที |
| งานชนกับ P10–P12 (dev คนเดียว) | Phase 2–5 ประกาศคิวรายสัปดาห์ในแผนหลัก; ไม่เริ่มสอง phase พร้อมกัน |
