# Mangmee Brain Real Answers — Architecture and Product Spec

สถานะ: **DRAFT v2 สำหรับ review และลงมือ coding (2026-08-25)**

ที่มา: การตัดสินใจ Owner ในแผน [mangmee-brain-2-5-day-priority-plan-th](../plans/mangmee-brain-2-5-day-priority-plan-th.md) (v4) และ [Brain answer architecture assessment](mangmee-brain-answer-architecture-assessment.md) — สมองมั่งมีไม่ใช่เดโม, AI ต้องแยกหมวดรายจ่ายได้ก่อน, และตอบ 3 คำถามที่ Owner ยืนยัน: **เงินเข้า–ออกวันนี้ / สรุปรายการเดือนนี้ / สรุปค่าใช้จ่าย**

การจัดลำดับทุกข้อในเอกสารนี้ยึดเป้าหมายหลัก: **รับคนให้ไหว → ใช้แล้วชอบ → โตต่อได้**

- รับคนให้ไหว: ไม่เพิ่มความเสี่ยงล่ม/ตัวเลขผิด — แก้ correctness gap ที่พบก่อนเปิด, ทุก lane มี kill switch และเปิดแบบ evidence-gated
- ใช้แล้วชอบ: ความฉลาดลงที่จุดที่ผู้ใช้ใช้จริง — หมวดรายจ่ายแม่นบนเส้นทางใบเสร็จ และ 3 คำถามหลักตอบเร็ว+ตัวเลขตรง
- โตต่อได้: ทุกคำตอบใหม่เพิ่มผ่าน family registry + eval harness เดิม ไม่ต้องรื้อสถาปัตยกรรม

## 0. Product outcome และ architecture contract

### 0.1 ประสบการณ์ที่ต้องส่งมอบ

สมองมั่งมีต้องทำสามเรื่องพร้อมกัน โดยไม่ลด security/correctness เพื่อแลกความเร็ว:

| คุณค่าที่ผู้ใช้รับรู้ | Contract | หลักฐานก่อนเปิด |
|---|---|---|
| **ตอบไว** | รับข้อความแบบ durable ก่อน feedback; native LINE loading request accepted ≤1s p95; simple business read ใช้ deterministic/prepared lane เมื่อผ่าน gate; path ซับซ้อนบอกสถานะโดยไม่หมุนเงียบ | hosted p50/p95 ผูก SHA/environment จาก B1; cohort เทียบ control; load smoke Gate C |
| **ตอบถูก** | ข้อมูลบริษัทอ่านผ่าน permission-checked API tools เท่านั้น; ตัวเลขมาจาก tool result พร้อม source + `asOf`; unknown/partial/forbidden ต้องตอบตามจริง; mutation สุดท้ายยังอยู่นอก Brain-Real track | golden set, 23-case security suite, cross-tenant E2E, per-family blind eval |
| **คุยเป็นธรรมชาติ** | persona เดียวตาม advisor spec; answer-first, กระชับ, ต่อบริบทระยะสั้นได้; กำกวมถามทีละหนึ่งคำถาม; ไม่อ้างว่าเป็นมนุษย์และไม่ใช้ conversation memory เป็น business truth | social advisor eval + blind human naturalness gate ใน B7; knowledge/company feedback เป็นงาน Slice B/C ใน P23 |

SLO ในตารางเป็น **เป้าทดลอง** จน B1 มี hosted baseline ตามการตัดสินใจที่ยังเปิดใน assessment §6; ห้ามนำไปเป็นคำโฆษณาหรือ Production commitment ก่อนมีหลักฐาน

### 0.2 Runtime architecture ที่ reuse

```text
LINE webhook
  -> signature / legal / identity / company / durable acceptance
  -> loading-on-accept (B2, best effort)
  -> measured debounce + per-chat serialization (B3)
  -> one-brain routing
       -> zero-model deterministic authority lane
       -> prepared simple-read lane: 1 tool call + compiled formatter (B5–B6)
       -> full agentic lane: permission-checked tools + grounded fallback
       -> advisor lane: social (B7); knowledge / company insight (P23)
  -> response validation: permission + source + asOf + risk/mutation guard
  -> one final LINE response + delivery replay/fallback
```

ชั้น context เรียงเป็น `persona → short-term conversation → approved knowledge → bounded company profile → live tools → deterministic analytics` ตาม advisor spec; ชั้นหลังเท่านั้นที่เป็น business truth. ไม่มี runtime multi-agent swarm, ไม่มี AI Gateway อ่านฐานข้อมูลตรง, ไม่มี response cache เหนือ permission boundary และไม่ทำ token streaming ปลอมบน LINE

### 0.3 Conversation และ UX contract

- ช่องหลักช่วง Controlled Beta คือ LINE; dashboard มี CTA ไปช่องที่พร้อมจริง. Web chat/history/streaming/citation drawer อยู่ P23 ไม่อยู่ในรอบ 2.5 วัน
- social ตอบสั้น 1–3 ประโยค; business/company ตอบ **คำตอบก่อน → เงื่อนไขสำคัญ → source/asOf → next action**
- คำตอบข้อมูลบริษัทต้องบอกช่วงเวลาและคำว่า `อิงข้อมูลบริษัท ณ ...`; กรณี cash movement ต้องบอกว่าเป็นรายการที่บันทึกในระบบ ไม่ใช่ยอดธนาคาร
- LINE ใช้ loading แล้วส่ง final response ครั้งเดียว เพราะแก้ bubble เดิมแบบ token streaming ไม่ได้; ห้าม push เศษคำตอบหลายข้อความเพื่อเลียนแบบ web streaming
- clarification ถามเพียงหนึ่งข้อที่ทำให้ตอบต่อได้; permission denial ไม่เผยว่าข้อมูลหรือ feature ใดมีอยู่; source unavailable เสนอ retry/ทางเลือกที่ปลอดภัย
- Flex/card ใช้เมื่อช่วยให้เห็นยอด ช่วงเวลา แหล่งข้อมูล และ deep link ชัดขึ้น; social/clarification ใช้ text; ไม่มีศัพท์ provider, confidence หรือ internal tool name ในข้อความผู้ใช้

## 1. Scope

| Slice | เนื้อหา | โมดูลที่แตะ |
|---|---|---|
| S1 | AI แยกหมวดหมู่รายจ่าย: วัด → ปรับ → UX ยืนยัน → telemetry (6A ของแผน) | `apps/api` (expenses), `apps/ai-gateway` (extraction prompt), `apps/web` (review form), `scripts` (eval) |
| S2 | Re-establish ชุดทดสอบความปลอดภัย 23 เคสของ prepared lane + เปิด canary family (`sales.get_sales_summary::single_metric`) บน UAT (B5) | `packages/contracts`, `apps/ai-gateway`, `infra/prod-ecs-express/deploy.sh` |
| S3 | Compiled families สำหรับ 3 คำถามที่ยืนยัน (B6): F1 สรุปค่าใช้จ่าย, F2 สรุปรายการเดือนนี้, F3 เงินเข้า–ออกวันนี้ | `packages/contracts`, `apps/api` (line-ai tools), `apps/ai-gateway` (formatter) |

Non-goals (มี spec เดิมรองรับหรือถูกถอยตามการตัดสินใจ Owner):

- ไม่แตะกลไก debounce/loading/cohort — activation ตาม [latency lanes spec](line-ai-latency-and-autonomy-lanes-spec.md) เดิม (B1–B3)
- ไม่ทำ advisor conversation ใน S1–S3; B7 ทำเฉพาะ social Slice A ตาม [advisor spec](line-ai-mangmee-advisor-conversation-spec.md); knowledge/company Slice B/C และ Knowledge Pack อยู่ P23
- ไม่ทำ web chat, Knowledge Pack, semantic retrieval (P23), รายรับ/Auto Revenue (ถอยหลัง P26), billing (P26)
- ไม่เปลี่ยน model provider, ไม่เพิ่ม agent ใหม่, ไม่ให้ AI อ่าน DB ตรง (กติกา AGENTS.md)

## 2. หลักฐานสถานะปัจจุบัน (ตรวจจากโค้ดจริง 2026-08-25)

### 2.1 การแนะนำหมวดรายจ่าย — มีครบวงจรแล้ว แต่ไม่เคยวัด

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| Extraction prompt สั่ง model เสนอ `categorySuggestion = {expenseCategoryId จาก active catalogue, confidence, evidenceSignals 1–5 span จาก OCR text}` เลือกได้ 1 หมวดต่อเอกสาร; catalogue ว่าง/ไม่ชัดต้อง omit + ใส่ `category` ใน missingFields; ห้ามใช้หมวดไปแก้ VAT/GL | `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:466,473-474` |
| Gateway parse แบบ bounded: ตรวจชนิด id/confidence และ evidenceSignals ทุกตัวต้องปรากฏใน documentText จริง | `line-ai-internal.controller.ts:853-876` |
| API auto-fill เฉพาะเมื่อ expense ยังไม่มีหมวด และ `confidence >= RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE`; หมวดต้องเป็น global (`companyId null`) หรือของบริษัทเดียวกัน; มี fallbackCategorySuggestion path ใช้เกณฑ์ confidence เดียวกัน (แต่ไม่บังคับ evidenceSignals); คืน `categoryAutoFilled` | `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:532-573` |
| เกณฑ์ confidence = `0.85` (ค่าคงที่ ไม่เคย calibrate จากข้อมูลจริง) | `packages/contracts/src/line-ai.ts:278` |
| LINE capture hints ใช้เกณฑ์เดียวกัน | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3487` |
| Per-line `suggestedCategoryId` ถูกรวมเป็น `categorySuggestions` + `categoryName` ในผลตรวจเอกสาร | `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.ts:248-249,305-308` |
| Web ยัง**ไม่แสดง** suggestion ให้ผู้ใช้เห็นเป็นตัวเลือก: review-steps ระบุ `categorySuggestion` เป็น key ที่ stepper จงใจไม่ใช้ (`AI_EVIDENCE_STEP_FIELDS = ['category']`) และ grep ไม่พบ consumer; ผู้ใช้เห็นหมวดเพราะ server auto-fill `expenseCategoryId` แล้วเท่านั้น | `apps/web/src/features/expenses/expenses.model.ts:888-894` |
| Gateway รับ active catalogue ใน OCR request จริง (`boundedReceiptCategories`) — โครง fixture ของ golden harness จึงตรงกับของจริง | `line-ai-internal.controller.ts:488` + controller spec (bounded catalogue assertions) |
| **ไม่มี** eval harness วัดความแม่นหมวด และ **ไม่มี** telemetry ว่า auto-fill ถูก override บ่อยแค่ไหน (grep `categoryAutoFilled` พบเฉพาะใน apply service; ไม่มี consumer ฝั่ง audit/product event) | grep ทั้ง `apps/api`, `apps/web` |

### 2.2 Prepared simple-read lane — โค้ดพร้อม ปิดอยู่ และมีช่องว่าง 1 จุด

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| Lane ทำงานแบบ: intake router เสนอ prepared plan (bounded) → orchestrator ตรวจ `intakeIntent === 'BUSINESS_READ_QUESTION'` จาก server-bound field → sanitizer exact-equality → ยิง specialist **หนึ่งครั้ง** → ตอบด้วย compiled formatter (0 model call เพิ่ม) | [latency memory](../agent-memory/line-ai-latency-and-autonomy-lanes.md) Phase 3–5; merge เข้า `main` แล้ว |
| Formatter registry เป็น allowlist แบบ `${tool}::${answerShape}` — "Add one verified family at a time"; family เดียวที่ compile แล้ว: `sales.get_sales_summary::single_metric` | `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts:4,136` |
| การเปิด family ต้องผ่าน blind pairwise eval (≥3 ratings/row, 30 paired/ภาษา-family, one-sided LB ≥0.50) — latency memory Phase 5 gate | latency memory Phase 5 |
| **ชุดทดสอบความปลอดภัย 23 เคสไม่มีตัวรันจริง** — corpus อยู่ `scripts/line-ai-latency-autonomy.corpus.ts` (root, ไม่ถูก copy เข้า app image); spec เดิมที่ import ข้าม boundary ทำ build พังและถูกลบ 2026-08-21 | latency memory "Phase 4 SECURITY EXECUTION — REMOVED"; grep `LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES` พบเฉพาะใน `scripts/` |
| Flag pattern สำหรับเปิดบน UAT/production: `LINE_AI_EXACT_GREETING_ENABLED` ใน deploy.sh (UAT default true, production hard-error) | `infra/prod-ecs-express/deploy.sh:28-104,354-361,1457-1458` |

### 2.3 Read tools สำหรับ 3 คำถาม — สองข้อมีของ หนึ่งข้อขาด tool

| คำถาม | Tool | หลักฐานและช่องว่าง |
|---|---|---|
| สรุปค่าใช้จ่าย | `expense.list_recent` — "expense totals and bounded records for the **current month by default** or an explicit date range" + `fromDate/toDate/branchId` | `packages/contracts/src/ai-tools.ts:349-361` — **ตรงคำถามพอดี ไม่ต้องแก้ tool** |
| สรุปรายการเดือนนี้ | `accounting.get_summary` — counts/totals ของเอกสารบัญชีต่อ documentType ตามช่วงวันที่ | registry `ai-tools.ts:582-594`; handler `apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts` — BUG-GAP เดิม: รวมยอดจากหน้าแรกเดียว (repository clamp ที่ 100 ใบ) → **แก้แล้ว 2026-08-26 ดู G1** |
| ค่าใช้จ่ายวันนี้ (F3 นิยามใหม่ 2026-08-26; เดิม "เงินเข้า–ออกวันนี้") | `expense.get_daily_closing` ครอบฝั่งค่าใช้จ่ายวันเดียวพอดี (`ai-tools.ts:377-390`) — **ใช้ tool เดิมได้เลย**; ส่วน "เงินเข้า" ไม่มี tool เดียวตอบได้ (`ledger.get_financial_summary` = net profit/assets; dashboard ไม่มี field เงินเข้า/ออก; prepared lane ยิงได้หนึ่ง call) จึงเลื่อนไปหลังฝั่งรายรับเปิด (P26) | F3 ทำได้ทันที (ดู §5 F3); revenue family = งานอนาคต |

## 3. Requirements — S1: AI แยกหมวดหมู่รายจ่าย

หลักการ: ระบบมีครบแล้ว (2.1) — S1 คือ **วัดก่อน แล้วปรับตามที่ตัวเลขชี้** ห้ามปรับ prompt/threshold ก่อนมี baseline

- **S1-R1 Golden set:** อย่างน้อย 30 ใบเสร็จจริงของบริษัทนำร่อง ครอบคลุมหมวดหลัก เก็บเป็น **OCR text ที่ sanitize แล้ว** (ไม่มีรูป, ไม่มี PII ลูกค้า, mask เลขภาษี/เบอร์โทรที่ไม่จำเป็น) + active catalogue snapshot + เฉลย `expenseCategoryId` ที่ Owner/นักบัญชียืนยันรายใบ
- **S1-R2 Baseline:** วัดบน exact candidate ผ่านเส้นทางจริง (hosted UAT intake หรือ provider run ที่ config เดียวกับ UAT): (a) suggestion ตรงเฉลย, (b) auto-fill (≥0.85) ตรงเฉลย, (c) อัตรา omit ("ไม่แน่ใจ"), (d) confusion pairs (หมวดไหนสับสนกับหมวดไหน)
- **S1-R3 การปรับ:** เลือก lever จาก confusion จริงเท่านั้น — ตัวเลือกที่อนุญาต: ถ้อยคำ prompt (ไฟล์เดิม), คุณภาพชื่อ/ความชัดของ catalogue บริษัทนำร่อง, เกณฑ์ 0.85 (calibrate จาก precision/coverage ของ golden set) — ห้ามเพิ่ม dependency/agent ใหม่
- **S1-R4 UX ยืนยัน (web review form + LINE):** หมวดที่ auto-fill ต้องแสดงเป็นค่า pre-selected ที่ผู้ใช้เห็นและแก้ได้ในแตะเดียว; กรณีมี suggestion แต่ต่ำกว่าเกณฑ์ ให้แสดงเป็นตัวเลือกแนะนำ ไม่ใช่ค่าที่เลือกแล้ว — **ข้อเท็จจริงจาก review: suggestion ต่ำกว่าเกณฑ์ไม่ถูก persist/ส่งถึง web วันนี้** (apply service ใช้เฉพาะ ≥0.85 แล้วทิ้ง) ดังนั้นข้อนี้ต้องเพิ่ม API contract แบบ additive (persist/expose suggestion ต่ำกว่าเกณฑ์) เป็นงานใน scope S1 ไม่ใช่แค่แก้ UI; ไม่มี suggestion = ผู้ใช้เลือกเอง ห้ามเดา; การแก้หมวดต้องไม่ล้างข้อมูลอื่นที่กรอกแล้ว; และต้องครอบ **เส้นทาง LINE draft conversation** (`line-expense-draft-conversation.use-case.ts` ที่ถือ `suggestedCategoryId` อยู่แล้ว) ซึ่งเป็น journey หลักบนมือถือ ไม่ใช่เฉพาะ web
- **S1-R5 Telemetry:** เพิ่ม product event แบบไม่มี PII/เนื้อหาเอกสาร: `expense_category_suggested` (autoFilled: bool, confidenceBand), `expense_category_overridden` (fromSuggested: bool) — นิยาม override rate = ผู้ใช้เปลี่ยนหมวดที่ auto-fill/แนะนำก่อน confirm; ต้องยิงจากทั้ง web review และ LINE draft conversation (มิฉะนั้นข้อมูล override จะตัด journey มือถือทิ้งเงียบ ๆ); เข้า catalog ตามชั้น observability ของแผน (หัวข้อ 13.7) — ห้าม log ชื่อหมวดคู่กับข้อมูลลับเกินจำเป็น
- **S1-R6 เกณฑ์ผ่าน:** ตั้งจาก baseline จริงและบันทึกใน release manifest (แผน Gate B); ก่อนมี baseline ห้ามประกาศตัวเลขความแม่น

## 4. Requirements — S2: Security suite + canary family

- **S2-R1 ย้าย corpus เข้า package ที่ ship:** ย้าย/ส่งออก `LINE_AI_PREPARED_PLAN_SECURITY_EVAL_CASES` (23 เคส) จาก `scripts/line-ai-latency-autonomy.corpus.ts` ไปไว้ใน `packages/contracts` (ที่เดียวกับ `line-ai-prepared-plan.ts` ที่มี bounds/parser อยู่แล้ว) โดย root scripts ยัง re-export ได้เพื่อไม่ทำ manifest เดิมพัง — **ห้าม app test import จาก root `scripts/` เด็ดขาด** (สาเหตุ build พังครั้งก่อน)
- **S2-R2 Executing spec ใน gateway:** เขียน spec ใน `apps/ai-gateway` ที่รันใน `pnpm test` จริง ยืนยันตามที่ spec เดิมเคย claim: 19 เคส reject/fallback แตะ ERP **ศูนย์ครั้ง**, 4 เคส source-honesty ยิง 1 ครั้งและตอบ authoritative terminal, ทุกเคสพิสูจน์ `ResponseComposer.compose === 0`, `CoverageCritic.judge === 0`, `IntentRouter.route === 0` ด้วย method-call counters; รวมเคส trusted-provenance (forged `intakeIntent` → 0 call) และ sanitizer exact-equality
- **S2-R2b ลงทะเบียน test file (จุดที่เคยพลาด):** `apps/ai-gateway/package.json` `scripts.test` เป็น **explicit file list** — spec ที่ไม่อยู่ใน list จะไม่ถูกรันเลย (สาเหตุที่ suite เดิม "มีไฟล์แต่ไม่เคยรัน"); ไฟล์ spec ใหม่ทุกตัวของ S2/S3 ต้องถูกเพิ่มเข้า list นี้ และให้เพิ่ม `prepared-simple-read-formatter.spec.ts` ที่ตอนนี้ orphan (มีไฟล์อยู่แต่ไม่อยู่ใน list) เข้าไปด้วย — การแก้ `package.json` ครั้งนี้เป็น**ข้อยกเว้นที่ระบุเหตุผลไว้ล่วงหน้า**ต่อกติกา AGENTS.md เพราะเป็นทางเดียวที่ test จะถูกรัน (แก้เฉพาะ `scripts.test` แถวที่เพิ่ม ไม่จัดเรียงใหม่)
- **S2-R3 เปิด canary บน UAT:** wire `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` + `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` เข้า deploy.sh ตาม pattern exact-greeting (UAT เปิดได้, production hard-block จนผ่าน gate); family แรก = `sales.get_sales_summary::single_metric` ต้องผ่าน blind pairwise eval (latency memory Phase 5 gate) ก่อนใส่ใน allowlist
- **S2-R4 ลำดับบังคับ:** S2-R2 ผ่านใน CI **ก่อน** S2-R3 เสมอ; fused-plan shadow (B4) เปิดก่อนหรือพร้อม canary เพื่อเก็บ provider precision

## 5. Requirements — S3: สาม compiled families

รูปแบบร่วมทุก family: กรอกเฉพาะ field ที่ registry ประกาศ (`fromDate/toDate/...`), ตอบด้วย compiled formatter ที่แสดง **ตัวเลขจากผล tool ตรง ๆ + source ref + asOf + ช่วงเวลา** (pattern P2-C ของ latency memory: ระบุ period จาก validated input, ห้ามแต่ง), explicit-empty แสดงศูนย์อย่างซื่อสัตย์, non-success ใช้ `preparedTerminalReply` ไม่แต่งตัวเลข; ภาษาไทย/อังกฤษตาม fixture; ทุก family เข้า allowlist ได้หลังผ่าน golden set + blind pairwise eval ของตัวเอง

### F1 — สรุปค่าใช้จ่าย (`expense.list_recent::single_metric` หรือ `::list`)

- ใช้ tool เดิมตามหลักฐาน 2.3 — **ไม่แก้ API**
- Default period = เดือนปัจจุบัน (พฤติกรรม tool เดิม); ผู้ใช้ระบุช่วงได้ผ่าน date candidates ของ lane เดิม
- Formatter: ยอดรวม + จำนวนรายการ + ช่วงเวลา + ลิงก์หน้า expenses; ถ้า tool คืน breakdown หมวด ให้แสดง top หมวดตามที่ข้อมูลมีจริง (ตรวจ response shape ตอน implement — อย่า assume)
- answerShape เลือกจาก response จริงตอนทำ golden fixtures; ขึ้นทะเบียนเป็น family key เดียว ไม่เปิดสอง shape พร้อมกัน

### F2 — สรุปรายการเดือนนี้ (`accounting.get_summary::list`)

- **เงื่อนไขบังคับก่อนเปิด:** ปิด BUG-GAP ยอดจาก 200 ใบแรก (2.3) — แก้ handler ให้รวมยอดครบทุกหน้า (aggregate query หรือ loop จน `page` หมด โดยมี bound ป้องกันงานหนักเกิน) พร้อม regression test เดือนที่เอกสาร > 200 ใบ; ระหว่างยังไม่แก้ ห้ามเปิด family นี้
- ขอบเขตคำว่า "รายการ": ตีความร่วมกับ Owner ตอนทำ golden fixtures (เอกสารบัญชีต่อประเภท ตาม tool ที่มี); formatter แสดง count+total ต่อ documentType + ช่วงเวลา + ลิงก์
- มุมมองเงินเข้า–ออกของเดือนยังไม่มี family รองรับ (F3 นิยามใหม่เป็นค่าใช้จ่ายรายวัน; ฝั่งรายรับหลัง P26) — คำถามลักษณะนั้นให้ fallback ไป full path ตามปกติ ไม่ขยาย F2 เกิน tool จริง

### F3 — ค่าใช้จ่ายวันนี้ (`expense.get_daily_closing`) — นิยามใหม่ตามการตัดสินใจ Owner 2026-08-26

การตัดสินใจ Owner: ฝั่งรายรับยังไม่ได้ทำ → F3 เป็น**รายงานค่าใช้จ่ายรายวัน**ก่อน; family "เงินเข้าวันนี้/เงินเข้า–ออก" เลื่อนไปรอบหลัง P26 พร้อมนิยามที่นักบัญชีลงนาม (ข้อกำหนดเดิมของหัวข้อนี้ย้ายไปกับ family นั้น)

- **ใช้ tool เดิม `expense.get_daily_closing`** (`ai-tools.ts:377-390`) — ไม่สร้าง tool ใหม่ ไม่แตะ DI; tool จำกัดหนึ่งวันโดย design ("Do not use for week, month, or date-range totals") ตรงกับคำถาม
- Formatter: จำนวนรายการ + ยอดตามที่ tool คืน (จ่ายแล้ว/ค้างจ่าย/รอตรวจ) + วันที่ + ลิงก์ + บรรทัดบังคับ "จากรายการที่บันทึกในระบบ — ไม่ใช่ยอดเงินเข้าออกธนาคาร" (G5); ห้าม formatter บวกยอดที่ tool ไม่ได้รวมมา; template และ phrasing อยู่ใน [user-questions-catalog](mangmee-brain-user-questions-catalog.md) §2-Q3
- นิยามตัวเลข (ต้องให้นักบัญชี/Owner ลงนามก่อน implement — สอดคล้อง REVENUE-03 "เงินเข้าไม่เท่ากับรายได้"):
  - เงินเข้า = ยอดรับชำระที่บันทึกในระบบ (AccountingPayment ฝั่งรับ) ในช่วงเวลา
  - เงินออก = ยอดค่าใช้จ่ายที่จ่ายแล้ว (paid) ที่บันทึกในระบบ ในช่วงเวลา
  - ระบุแหล่งข้อมูลชัดใน field ของคำตอบ: **"จากรายการที่บันทึกในระบบ ไม่ใช่ยอดเคลื่อนไหวธนาคาร"** (ยังไม่มี bank feed — P18)
  - รายการที่ยังจัดประเภทไม่ได้ไม่ถูกเหมารวม; ถ้า definition ข้อใดยังไม่ผ่านการลงนาม family นี้ยังไม่เปิด
- Formatter: เงินเข้า X / เงินออก Y / สุทธิ Z + วันที่ + source + ลิงก์; ห้ามคำว่า "กำไร" (คนละความหมายกับ cash movement)

## 6. Invariants ที่ห้ามถอย (ทุก slice)

1. AI Gateway เรียก permission-checked API tools เท่านั้น — ไม่มี direct DB (AGENTS.md)
2. ตัวเลขทุกตัวในคำตอบมาจาก tool result — model/formatter ห้ามคำนวณเพิ่มนอกเหนือผลรวมที่ tool คืน (advisor spec non-goal)
3. Prepared lane: หนึ่ง call, exact-equality sanitizer, trusted `intakeIntent` จาก server-bound field เท่านั้น (latency memory P0 fix)
4. หมวดรายจ่ายเป็น reporting dimension — ห้ามไปแก้ VAT/Tax Code/GL/payment (prompt กติกาเดิม `line-ai-internal.controller.ts:474`)
5. ทุก flag เปิดผ่าน deploy.sh + UAT run (pattern PR #226); production hard-block จน gate ผ่าน; kill switch ปิดได้ภายใน 15 นาที (แผน P3)
6. `AI-01` delivery blockers ยังเป็น gate ก่อน customer GO — เอกสารนี้ไม่ปลดล็อก
7. ข้อความ/predicate ภาษาไทยที่ anchor ต้อง normalize ด้วย **NFC ไม่ใช่ NFKC** (สระอำ U+0E33 decompose ใต้ NFKC — gotcha ที่เคยเจอจริง)

## 7. Gap / Bug impact register

| # | Gap | Impact ถ้าไม่ปิด | การปิด + slice |
|---|---|---|---|
| G1 | **ปิดแล้ว 2026-08-26** — บั๊กจริงแรงกว่าที่บันทึก: repository clamp `pageSize` ที่ **100** (`prisma-accounting.repository.ts:516`) จึง truncate ที่ 100 ใบไม่ใช่ 200; แก้เป็น bounded page walk (สูงสุด 50 หน้า) + self-check `Σ byType.count = total` → `SUMMARY_COUNT_MISMATCH` + เกิน bound → `SUMMARY_PERIOD_TOO_LARGE` (ไม่คืนตัวเลขบางส่วน) + regression 250 ใบ; พ่วงแก้ pagination instability ด้วย `id` tiebreaker ใน orderBy (OFFSET บน key ไม่ unique ซ้ำ/ข้ามแถวได้และ self-check จับไม่ได้) | เดือนเอกสารเยอะ → AI ตอบยอดผิดเงียบ ๆ (เป้า 1) | เหลือ: วัด latency hosted ของ walk (G10) เมื่อมี traffic |
| G2 | Security suite 23 เคสไม่มีตัวรัน | เปิด lane โดยไม่มีหลักฐาน security = เสี่ยง cross-tenant/forged plan | S2-R1/R2 ก่อน S2-R3 เสมอ |
| G3 | เกณฑ์ 0.85 ไม่เคย calibrate | auto-fill ผิดบ่อยโดยไม่รู้ หรือเข้มเกินจน auto-fill แทบไม่ทำงาน | S1-R2 baseline → S1-R3 calibrate |
| G4 | ไม่มี override telemetry | ตรวจ drift ความแม่นหมวดใน production ไม่ได้ | S1-R5 |
| G5 | "เงินเข้า–ออก" ไม่มี bank feed | ผู้ใช้เข้าใจผิดว่าเป็นยอดธนาคาร | F3 ระบุ source ในคำตอบเสมอ + นิยามลงนาม |
| G6 | Prepared lane = 1 call | family ที่ต้องประกอบหลาย tool เป็นไปไม่ได้ | F3 สร้าง tool เดียวที่ตอบครบ; ห้ามออกแบบ family multi-call |
| G7 | Golden fixtures มีข้อมูลธุรกิจ | PDPA/ความลับรั่วผ่าน repo | S1-R1: sanitized OCR text เท่านั้น, mask identifiers, Owner อนุมัติชุดข้อมูล |
| G8 | Formatter ภาษาไทย + ตัวเลข | เศษสตางค์/format ผิด = ดูไม่น่าเชื่อถือ | fixtures ครอบ number formatting + Thai/English ต่อ family |
| G9 | Flag ใหม่ไม่ผูก master switch | เปิดแล้วปิดไม่ทันตาม 15 นาที | ทุก flag อยู่ใน release manifest + ซ้อม CLOSE ใน P3 drill |
| G10 | เดือน >200 ใบ ใช้เวลา query นาน | ตอบช้าจน SLO หลุด | วัด latency ของ aggregation ใหม่ใน hosted ก่อนเปิด F2 |

## 8. การทดสอบ (ครบทุกชั้น)

### 8.1 S1 — หมวดรายจ่าย

| ชุด | เนื้อหา | ผ่านเมื่อ |
|---|---|---|
| Unit (มีแล้ว ต้อง extend) | `receipt-ocr-apply.service.spec.ts`: auto-fill ≥/< threshold, ไม่ทับหมวดที่มีอยู่, cross-company category ถูกปฏิเสธ, fallback path | เคสเดิมผ่าน + เคสใหม่ต่อ lever ที่ปรับ |
| Prompt contract | ตรวจ system prompt จริงว่าคงกติกา catalogue-only + omission (pattern prompt-contract test ที่มีอยู่ใน gateway) | prompt มีข้อความกติกาครบหลังแก้ |
| Golden eval (ใหม่) | harness ตาม pattern `scripts/*.corpus.ts`: 30+ sanitized fixtures → suggestion/auto-fill/omit/confusion report | baseline บันทึกแล้ว; หลังปรับไม่แย่ลงในทุกมิติและดีขึ้นตามเกณฑ์ manifest |
| Hosted evidence | รันใบจริงผ่าน UAT intake (exact SHA) เทียบเฉลย | ตัวเลข hosted ใกล้เคียง offline (บันทึกส่วนต่าง) |
| Web E2E | review form: pre-selected + แก้ 1 แตะ + ไม่ล้าง field อื่น + ไม่มี suggestion แล้วไม่เดา + suggestion ต่ำกว่าเกณฑ์แสดงเป็น "ตัวเลือกแนะนำ" (หลังเพิ่ม data path ตาม S1-R4) | Playwright ผ่านบน 390px และ desktop |
| LINE flow test | draft conversation เลือก/แก้หมวด: `suggestedCategoryId` ไหลถูกช่อง + override event ยิงจากเส้นทาง LINE | unit/use-case test ใน `apps/api` ผ่าน |
| Telemetry test | event เกิดตาม S1-R5, ไม่มี PII ใน payload (redaction test ตามชั้น 13.7 ของแผน) | assertion ผ่าน |

### 8.2 S2 — Security + canary

| ชุด | เนื้อหา | ผ่านเมื่อ |
|---|---|---|
| Contracts | corpus ย้ายแล้ว build clean: `pnpm -C packages/contracts build` + spec เดิม (`line-ai-prepared-plan.spec.ts`) ไม่แตก | build + tests เขียว |
| Gateway security suite (ใหม่) | 23/23 executing ใน `apps/ai-gateway` `pnpm test` ตาม S2-R2 (zero-ERP-call counters, composer/critic/router = 0, provenance, sanitizer) | 23/23 ใน CI; ไม่มี import จาก root scripts |
| Image build | ai-gateway image build ผ่าน (จุดที่เคยพัง) | UAT build run เขียว |
| Blind pairwise eval | family canary ตาม latency memory Phase 5 gate (≥3 ratings/row, 30 paired/ภาษา, LB ≥0.50) | ผลผ่านเกณฑ์ + บันทึกผู้ให้คะแนน |
| UAT runtime | เปิด flag บน UAT: eligible question → 1 ERP call → formatter answer พร้อม source/asOf; ineligible → fallback full path; kill switch CLOSE แล้วกลับ path เดิม | log `prepared_simple_read.*` + p50/p95 เทียบ baseline B1 |

### 8.3 S3 — Families

| ชุด | เนื้อหา | ผ่านเมื่อ |
|---|---|---|
| Tool unit | F2: aggregation ครบทุกหน้า + เคส >200 ใบ; F3: tool ใหม่ — permission negative (ไม่มีสิทธิ์ = forbidden, ไม่มี data รั่ว), นิยามเงินเข้า/ออกตรงตามที่ลงนาม, วันนี้/ช่วงวันที่, explicit-empty = ศูนย์ | unit ผ่านใน `apps/api` |
| Formatter fixtures | ต่อ family: Thai/English, ระบุ period จาก validated input, explicit-empty, unverified/non-success ใช้ terminal reply, number formatting | fixtures ผ่านใน gateway suite |
| Golden set ต่อ family | คำถามจริง ≥ 20 แบบ/ภาษา ต่อ family (ครอบ phrasing) → routing เข้า lane + คำตอบตรงเฉลยจาก seed data | รายงานต่อ family ก่อนเข้า allowlist |
| Security regression | รัน 23 เคส + เคสใหม่ของ tool ใหม่ (forged input field, cross-company id ใน input ถูก sanitizer ตัด → fallback) | 100% |
| Cross-tenant E2E | สองบริษัท seed ต่างกัน ถามคำเดียวกัน → ตัวเลขของบริษัทตัวเองเท่านั้น | 0 leakage |
| Hosted latency | p50/p95 ต่อ family บน UAT เทียบ SLO ทดลอง (simple read p50 ≤3s ตาม latency spec) | บันทึกจริง ไม่ใช้ local timing |
| Load smoke ร่วม | คำถาม family อยู่ในชุด load smoke ของแผน P7 Gate C | error <1%, queue age ไม่โต |

### 8.4 Conversation และ UX integration

| ชุด | เนื้อหา | ผ่านเมื่อ |
|---|---|---|
| Response contract | 3 คำถามหลักตอบ answer-first พร้อม period, source, `asOf` และ next action; cash movement มีคำชี้แจงว่าไม่ใช่ยอดธนาคาร | fixture Thai/English ผ่าน 100%; ไม่มีตัวเลขที่ formatter สร้างเอง |
| Clarification/fallback | คำว่า “รายการ” ที่ยังตีความไม่ได้ถามหนึ่งคำถาม; forbidden/unavailable/partial/no-data ใช้สถานะที่ถูกต้องและไม่เผย tenant data | deterministic cases ผ่าน; ERP call = 0 เมื่อ plan ถูก reject |
| LINE presentation | loading เกิดหลัง durable acceptance; final response ครั้งเดียว; card/text ตรง mode; deep link คง company context ที่ตรวจแล้ว | integration test + UAT device evidence |
| Natural conversation (B7) | social, follow-up, mixed social+business, persona และ safety ตาม advisor spec | advisor eval ผ่าน; blind human naturalness win-or-tie ≥0.90; ยังไม่ถือว่าผ่านใน B0–B6 |
| Feedback | knowledge/company มี `ตรงคำถาม/ไม่ตรง`; social ไม่ถูกรบกวนด้วย feedback ทุก turn; event ไม่มี prompt/PII ดิบ | event/redaction test ผ่าน |

### 8.5 คำสั่งที่ใช้ (pattern ที่รันจริงในรีโปนี้)

```bash
pnpm -C packages/contracts build && pnpm exec tsx --test packages/contracts/src/line-ai-prepared-plan.spec.ts
pnpm -C apps/ai-gateway test
pnpm -C apps/api exec tsx --test src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts
pnpm exec tsx --test scripts/line-ai-latency-autonomy.corpus.spec.ts
```

(หมายเหตุ: session ที่รันไม่ได้ต้องบันทึกเหตุผลตามกติกา Definition of Done ของแผน)

## 9. Rollout และ kill switch

1. ทุกอย่าง default-off; เปิดบน UAT ก่อนเสมอผ่าน deploy.sh ตาม pattern `LINE_AI_EXACT_GREETING_ENABLED` (UAT เปิดได้/production hard-block)
2. ลำดับเปิด: S2 canary → F1 → F2 (หลังแก้ G1) → F3 (หลังนิยามลงนาม) — ทีละ family, สังเกต override/complaint ก่อนตัวถัดไป
3. Production เปิดได้เมื่อ: security suite เขียวใน CI, blind eval ผ่านต่อ family, hosted latency บันทึกแล้ว, `AI-01` ปิด, P3 drill ครอบ flag ใหม่
4. ถอยกลับ: เอา family ออกจาก allowlist (env NARROWS only — พฤติกรรมกลับ full path ทันที) หรือปิด flag lane; ทั้งสองอยู่ใน release manifest

## 10. สิ่งที่ Owner/ผู้เชี่ยวชาญต้องลงนามก่อน implement ส่วนที่เกี่ยว

1. ~~นิยาม "เงินเข้า/เงินออก" ของ F3~~ — เลื่อนไปกับ revenue family หลัง P26 (Owner 2026-08-26: F3 เป็นฝั่งค่าใช้จ่ายก่อน จึงไม่ต้องลงนามในรอบนี้)
2. ขอบเขต "รายการ" ของ F2 (Owner) — ตอนทำ golden fixtures
3. เฉลย golden set หมวดรายจ่าย 30 ใบ (Owner หรือนักบัญชี — คำถามข้อ 20 ของแผน)
4. ชุด fixtures ที่ sanitize แล้วได้รับอนุญาตให้อยู่ใน repo (G7)

## 11. Definition of Done ระดับผลิตภัณฑ์

- [ ] B0–B6 ทำให้ 3 คำถามหลักตอบจากข้อมูลบริษัทจริงได้โดยไม่ข้าม permission และมี source/`asOf`
- [ ] B7 ผ่าน naturalness/persona/safety eval ก่อนกล่าวอ้างว่าคุยเรื่องทั่วไปได้เป็นธรรมชาติ; การให้คำแนะนำจาก knowledge/company ต้องรอ Slice B/C ของ P23
- [ ] latency, accuracy, delivery และ cost ใช้หลักฐาน hosted ของ exact candidate ไม่ใช้ local timing หรือข้อความใน spec แทนผลทดสอบ
- [ ] `AI-01`, P3 incident drill และ Gate C load smoke ผ่านก่อน customer GO ของ lane ที่เกี่ยว
- [ ] ทุก lane/family มี default-off flag, allowlist และ rollback owner ใน release manifest
- [ ] copy หน้าเว็บและ Marketing บอกเฉพาะ capability ที่เปิดจริง; ก่อน B7 ห้ามใช้คำว่า “ตอบได้ทุกเรื่องเหมือน ChatGPT”

## 12. แหล่งอ้างอิง

- [แผน 2.5 วัน v4](../plans/mangmee-brain-2-5-day-priority-plan-th.md) · [Architecture assessment](mangmee-brain-answer-architecture-assessment.md)
- [Latency/autonomy lanes spec](line-ai-latency-and-autonomy-lanes-spec.md) · [memory](../agent-memory/line-ai-latency-and-autonomy-lanes.md)
- [Advisor conversation spec](line-ai-mangmee-advisor-conversation-spec.md)
- Implementation plan คู่กัน: [mangmee-brain-real-answers-plan](../plans/mangmee-brain-real-answers-plan.md)
