# LINE AI Workflow-First Spec — งานซ้ำเดินตามขั้นตอน, AI แยกงานครั้งเดียว

Status: DRAFT — blocked on: R4-F2 (ordered dispatch of new controls) review before Phase A2; owner Q1–Q3, MC1 — เริ่มได้โดยไม่รอ A2: A9 (ผลที่ใช้ไม่ได้ไม่คิดเงิน), A10 (ใบทดแทนเขียนตอนกดการ์ดเท่านั้น — R4-F1 ปิดแล้ว), A6c (ทักทาย), A7 (telemetry), Phase M (M1a–M3; M4 รองบ Q3), B1 probe (แก้ตามรีวิว 2026-10-24 รอบ 1–4 + focused check แล้ว; blocker อยู่ §17.2; ข้อที่ต้องปิดก่อนเขียนโค้ดอยู่ §17.1)
Owner: LINE AI lane (controller = main thread; implementation = Codex lanes ตาม `docs/plans/line-ai-workflow-first-plan.md`)
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ค 16–24), `docs/specs/line-ai-measurement-and-eval-spec.md`, `docs/plans/line-ai-workflow-first-plan.md`, `docs/agent-memory/line-ai-workflow-first.md`, `docs/specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md`, `docs/specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md` (เส้นทางไม่ใช้โมเดลที่ถอนออก 2026-10-05), `docs/specs/line-ai-credit-levers-20261019.md`, `docs/specs/mangmee-ai-expense-advisor-spec-th.md`, `docs/specs/mangmee-brain-answer-architecture-assessment.md`
Baseline: main 6c54ba208 (2026-10-23) — อ่านโค้ดจาก worktree `expense-specs-20261023` (tree เดียวกับ main)

ความคิดของ Owner (2026-10-23, คำต่อคำ): "อันไหนที่ทำซ้ำอันนั้นควรมี workflow แล้ว ai classifier แม่นและเรียกแค่ tools เดียวแล้ว workflow วิ่งต่อ เช่นใบเบิก ใบทดแทน หรืออื่นๆ ที่เป็นงานที่ระบุได้ว่าซ้ำกันแน่นอน"
เป้าหมาย: ต้นทุน AI ต่อ **งานที่เสร็จ** ลดลง ความแม่นยำสูงขึ้น และไม่มีการทำรายการผิด

อักษรย่อ: `pwu` = `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, `stv2` = `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts`, `ira` = `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`, `lea` = `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`, `rda` = `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts`, `bas` = `apps/api/src/modules/line-ai/application/line-ai-budget-authority.service.ts`, `abb` = `packages/contracts/src/ai-budget-bounds.ts`, `abp` = `apps/ai-gateway/src/common/usage/ai-budget-provider.ts`, `cbr` = `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts`

---

## 1. ปัญหา

### 1.1 สิ่งที่ไม่เรียก AI อยู่แล้ว (ยืนยันจากโค้ด)

| ข้อความเข้า | ทาง | หลักฐาน |
|---|---|---|
| คำสั่งสาธารณะจากเมนู (พนักงาน, ติดต่อเจ้าหน้าที่, คุยกับ AI ต่อ, โปรโมชัน, นโยบายทดลองใช้) | การ์ดที่โค้ดสร้าง ก่อนอ่านตัวตน | pwu:6444–6506 |
| เลือกร้าน `/companies`, ซื้อแพ็กเกจ | deterministic | pwu:6638–6646 |
| ปุ่มยืนยันคู่ค้า, ปุ่มการ์ดรายการ (`expense_action_*`) | postback ที่มี token | pwu:6692–6717, 3666–3732 |
| คำตอบช่องที่การ์ดรายการถามค้าง (เหตุผล, ผู้รับเงิน, วิธีจ่าย), ช่องทีมงาน, ใบทดแทนที่ค้างลายเซ็น, หลักฐาน, หมวด | ตัวจับคำตอบก่อน intake | pwu:6722–6787, lea:977–993 |
| ปุ่มยืนยัน/ยกเลิกร่างใบเบิก | deterministic | pwu:6788–6793, 5394–5426 |
| เมนูหลัก/ถามข้อมูล/รายการรออนุมัติ/ถ่ายใบเสร็จ/บริการของเรา | การ์ดที่โค้ดสร้าง | pwu:6794–6849, 6941–6975 |
| "จ่ายแล้ว/โอนแล้ว" หลังรายการที่เพิ่งเห็น; พิมพ์ยอดอย่างเดียว **เฉพาะ** เมื่อเป้าหมายมีรายการเดียวและรายการนั้นจ่ายครบแล้ว (ยอดหลังรายการที่ยังไม่จ่าย/ร่าง หรือหลายรายการ → ตกไป intake ที่คิดเงิน) | regex ก่อน intake | pwu:3734–3769 (ยอดอย่างเดียว :3748–3755; `paidExpenseReply` คืนค่าเฉพาะรายการ PAID lea:92–93) เรียกที่ :7005 |
| คำตอบงานค้างของรูป: "ใช่ใบเสร็จ" (สร้างร่างจากไฟล์ที่เก็บไว้), เลขข้อ, ตรวจบิล, สแกนใบทดแทน; คำตอบร่างรายจ่าย | `answersOpenWork` ข้าม intake ช่วงต้น | pwu:6062–6086, 7098–7121 |
| ปุ่มอนุมัติ/ไม่อนุมัติ/ส่งอนุมัติจากแจ้งเตือนใบเบิก | open token ลงนาม → การ์ดยืนยัน | `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts:5–17`, lea:842–846 |
| ปุ่มขั้นถัดไปหลังกดยืนยัน (ทำใบเตรียมจ่าย → ส่ง → อนุมัติ → จ่าย → ออก 50 ทวิ, บันทึกจ่าย) ภายใน 120 วินาที | `expense_action_next/payment/wht` | lea:858–875, 936–944 (ดู B1) |

ข้อยกเว้นที่ยังจ่ายเงินแม้อยู่ในงานค้าง: คำตอบ "เป็นภาพประกอบ" ของรูปที่พักไว้ — ใช้คำบรรยายรูปเดิมแล้วไปถึง intake ภายหลัง (pwu:7123–7136 → :7647)

### 1.2 สิ่งที่ยังจ่ายค่าโมเดล (ยืนยันจากโค้ด)

| ข้อความเข้า | สิ่งที่เกิด | หลักฐาน |
|---|---|---|
| ข้อความพิมพ์อิสระในแชตส่วนตัว | intake router (Sonnet) ที่ pwu:7007 ก่อน handler ส่วนใหญ่ของ v2 (ยกเว้น `answersOpenWork` และ "จ่ายแล้ว") | pwu:7002–7007; แชตส่วนตัวผูก v2 โดยค่าตั้งต้น (`packages/config/src/index.ts:24–32`, pwu:9357–9363, 6691) |
| ปุ่มลัดแบบ message เช่น "ยอดขายวันนี้" ("ดูยอดขายวันนี้"), "ค่าใช้จ่ายเดือนนี้" | ส่งเป็นข้อความ → intake | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:146–164` |
| ปุ่มวิธีใช้ (help card): กรณีเดียวภาษาไทยที่ไม่ใช่เมนูเป็น message action ส่ง `command`; กรณีอื่นเป็น postback `chat-action` ที่ถูกแปลงกลับเป็นข้อความ `command` | ทั้งสองแบบเข้า intake + planner | `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts:55, 58–60`; `line-staff-menu.logic.ts:942`; `packages/contracts/src/ai-tools.ts:257` |
| ปุ่มเลือกในใบเบิกแบบ postback (ส่งรูป/ไม่มีใบเสร็จ/หมวด) | ผ่าน intake ที่คิดเงินก่อน แล้วจึงทำ proposal แบบ deterministic | pwu:7716–7735 |
| ปุ่มเลือก สาขา/ผู้ขอเบิก/ใบเบิกที่จะแก้/บิลที่จะเบิก/"รายการใหม่" | **message action** → intake + planner ต้องแปลข้อความกลับเป็น choiceId | `line-reimbursement-draft-card.logic.ts:303–320`, `line-business-card.logic.ts:41–46` |
| ปุ่ม "ใช้บิลนี้ทำใบเบิก" บนการ์ดใบเสร็จ | message action → intake + planner | pwu:10692–10699 |
| คำตอบคำถามของใบเบิก (เหตุผล/วัตถุประสงค์) | ต้องมี grant จาก intake และต้องไม่มีจำนวนเงินในข้อความ | pwu:5346–5376 (:5352 grant, :5353 `candidates?.amounts.length === 0`); rda:189–198 |
| รายละเอียดรายการใหม่ของใบเบิก ("ค่าแท็กซี่ 250 บาท เมื่อวาน") | ไม่มีตัวแยกแบบ deterministic — บรรทัดแรกมาจาก `reimbursementHints` ของ intake (rda:536–545) หรือ planner | rda:536–545; stv2:89 ("first get_options, then preview_create a manual ADD line") |
| "ส่งอนุมัติ/ส่งเลย/ยื่นเลย" | regex ตัดสินเอง แต่ทำหลัง intake ROUTED | pwu:3771–3793 เรียกที่ :7022, :7666 |
| คำทักทาย "สวัสดี" | ในแชตส่วนตัวไปถึง intake ก่อนเลนทักทาย (B3); สวิตช์ `LINE_AI_EXACT_GREETING_ENABLED` ค่าตั้งต้น false (`packages/config/src/index.ts:326`) | pwu:7007, 7032–7034, 7613 |
| คำถามวิธีใช้ของผู้ใช้ที่ผูกบัญชีแล้ว | turn ปกติ | pwu:6516–6533 |
| ปุ่ม "ทำขั้นตอนถัดไป" ของงานหลายข้อ (ตั้งแต่ fix-e 2026-10-17) | intake ใหม่ทุกครั้ง ยังไม่มีการวัด | `docs/agent-memory/advisor-exam-fix-e.md` (E1) |

### 1.3 งานซ้ำที่โมเดลยังต้อง "คิดเอง" จากพรอมต์

- เริ่ม/แก้ใบเบิก, ใบเตรียมจ่าย, 50 ทวิ, ส่งตรวจ/ยืนยัน/ลบร่าง/ยกเลิก/บันทึกจ่ายรายการ, อนุมัติ/ไม่อนุมัติ/จ่ายคืนใบเบิก เขียนเป็นร้อยแก้วใน `CONTROL_PROMPT` บรรทัดเดียว 12,782 ตัวอักษร (stv2:89)
- planner วนได้ 2 รอบ (stv2:723) maxTokens 2,048 (stv2:738) ส่งรายการ tool ที่เสนอทั้งหมดใน user message JSON (stv2:754) ซึ่งไม่ใช่จุด cache (`apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts:42–43, 284–296`); registry มี 85 operation (`docs/research/mangmee-ai-capability-manifest-2026-09-27.json`)
- งานเขียนที่ได้ preview ข้ามขั้นแต่งคำตอบ (stv2:1170–1177): งานเขียนที่พิมพ์มา = intake 1 + planner 1–2
- ปุ่มยืนยันเป็นขั้นตอนตายตัว (pwu:3666–3732)

### 1.4 ตัวแยกงาน (intake router) และขอบเขตการคิดเงิน วันนี้

- บังคับรูปแบบด้วยพรอมต์เท่านั้น (ira:406–407); ไม่มี `outputConfig`/`strict` ใน `apps/ai-gateway/src` (grep 2026-10-23)
- maxTokens 4,096 ข้อความ / 8,000 รูป (ira:737, :48); repair 1 ครั้งเฉพาะข้อความ v2 (ira:711)
- ความมั่นใจ < 0.6 กับ intent ที่ลงมือ → CLARIFY (ira:557–558, 787–828)
- ส่วนคงที่ของพรอมต์ 66,609 ไบต์ กันไว้ 26,681 โทเคน (`apps/ai-gateway/src/common/usage/intake-token-calibration.ts:7–17`)
- เคยพังจาก JSON ที่ไม่บังคับ schema: วงเล็บผิด 6/8, quote ไม่ escape 2/8 (`docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md` run 5)
- **การ settle เงินเกิดทันทีหลัง provider ตอบ ก่อนผู้เรียกตรวจผล**: `settleV2` อยู่ใน `finally` ของ budget wrapper (เรียก provider ที่ abp:429, settle ที่ :459) ขณะที่ router parse ผลภายหลัง (ira:741); บริษัทรับเองเฉพาะเมื่อ usage `ok === false` (cbr:872); settle ซ้ำถูกกันเป็น `'duplicate'` (cbr:859–860) — คำตอบที่ provider ส่งครบแต่อ่านไม่ออก/ถูกตัดที่ max_tokens จึงถูกคิดเงินลูกค้า (B6)

### 1.5 เครดิตและ slot ของ turn

- `issue()` ไม่ตรวจเครดิต (bas:124–178); เครดิตถูกตรวจตอน `reserve()` ครั้งแรก (bas:305–363) ซึ่งกันเงินเท่าเพดานของการเรียกนั้นก่อนส่ง
- `narrow()` ปฏิเสธ `nextOrdinal < 1` (bas:291) — เส้นทางไม่ใช้โมเดลที่ขึ้น UAT 2026-10-05 ถูกปฏิเสธและถอน (`docs/specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md:134`)
- slot: ทุกการเรียกที่ไม่ใช่ repair นับใน `maxTurnSlots` (abb:348–351); gateway เริ่มนับจาก `grant.nextOrdinal` ของ request (`apps/ai-gateway/src/common/usage/ai-usage.interceptor.ts:96`); authority ต้องการ ordinal ตรง `authority.nextOrdinal` (bas:344) — ใช้ grant ข้าม request ไม่ได้
- deadline ของ turn = `admittedAtMs` (เวลารับข้อความแรก, pwu:4426) + เพดานของ lane (`public` 40,000 ms ตอนออก grant — pwu:4427, bas:45); grant ที่เลย deadline ใช้ไม่ได้ (bas:155)
- เมื่อเครดิตหมด "ข้อความทุกข้อความถูกปฏิเสธก่อนถึงโมเดล" (`docs/specs/mangmee-advisor-system-knowledge-2026-09-29-th.md:246`); ข้อยกเว้น "ทุกกรณีที่ระบบรับไว้ก่อน" ครอบเฉพาะที่ระบุ (:247–252)
- การเรียกที่ล้มเหลว/หมดเวลา บริษัทรับเอง (cbr:872, 893); ส่วนลูกค้า/บริษัทของทุกการ settle = `customerChargedSatang`/`companyAbsorbedSatang` (cbr:947, 954); ราคาต่อการเรียกปัดเป็นสตางค์เต็ม (`apps/api/src/modules/line-ai/application/ai-model-pricing.ts:223`)

### 1.6 ตัวเลขที่มี (อ่อน — ต้องวัดใหม่ตาม measurement spec)

| ตัวเลข | ค่า | ความน่าเชื่อถือ | ที่มา |
|---|---|---|---|
| Production ก.ย. | 2.39 บาท/ข้อความ จาก 16 ครั้ง | ตัวอย่างน้อย | backlog แถว 20 |
| Production 2026-09-17 | 48 intake calls / 55.67 บาท ≈ 1.16 บาท/intake | จริง แต่เก่า | `docs/research/line-ai-intake-cost-benchmark-2026-09-17.md:9` |
| intake cache อุ่น | 0.78–1.05 บาท (กลาง 0.92) | ประมาณจาก usage ที่ owner ให้ | `docs/agent-memory/line-ai-credit-cost-analysis-20261019.md` |
| หลังปรับ 10-19 | 0.60–0.79 บาท/intake | คำนวณจากไบต์ | `docs/research/line-ai-credit-levers-20261019.md` |
| ความแม่นยำล่าสุด | held-out 91.5%, ต่อเนื่อง 82.1% (เป้า 90%) | งานอ่านเท่านั้น | `docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md` |
| เวลา router | 3.8–4.4 วินาที; 4.6 จาก 11.1 วินาที | UAT | `docs/agent-memory/brain-ocr-evidence-harvest.md:128`; credit-wording spec:136 |
| turn log | `costSatang: null` เสมอ | ไม่มีต้นทุนต่อ turn | pwu:9352 |

### 1.7 ประมาณการจำนวนครั้งที่จ่ายต่องาน (คำนวณจากเส้นทางโค้ด ไม่ใช่ค่าวัด)

| งาน | วันนี้ | หลังสเปกนี้ |
|---|---|---|
| พิมพ์ "เบิกค่าแท็กซี่ 250 บาท เมื่อวาน" → ไม่มีใบเสร็จ → หมวด → พิมพ์เหตุผล → ยืนยัน | ≈ **6** | classifier **1** |
| กด "สร้างใบเบิก" → รายการใหม่ → พิมพ์ "ค่าแท็กซี่ 250 บาท เมื่อวาน" → … → ยืนยัน | ≈ **6–8** | **0** |
| ผู้อนุมัติพิมพ์ "อนุมัติใบเบิกของสมชาย" | ≈ **3** | **1** |

---

## 2. เป้าหมาย

1. งานซ้ำใน §6.1 เป็น workflow ที่เขียนเป็นโค้ด มีปุ่ม ถามเฉพาะช่องที่ขาดครั้งเดียว และจบที่การ์ดยืนยันที่ลงนาม
2. ปุ่มของ workflow และคำตอบของคำถามที่ workflow ถามเอง (รวมรายละเอียด/ยอด/วันที่ของรายการใหม่) = 0 การเรียกโมเดล (Tier 0)
3. ข้อความพิมพ์ที่เป็นงานซ้ำ = เรียกโมเดล 1 ครั้ง ด้วยตัวแยกงานที่ **provider บังคับ schema** (Tier 1) แล้ว workflow วิ่งต่อ — ถ้า provider บังคับ schema ไม่ได้ Tier 1 ไม่ปล่อย (§16)
4. คำถามเปิด/อ่าน ใช้เส้นทางเดิม (Tier 2) — invariant ของ grant/slot ของ turn ไม่เปลี่ยน
5. ต้นทุนรวมของชุดงานคงที่ลด และต้นทุนต่องานซ้ำที่เสร็จ (รวมความพยายามที่ล้ม) ลด ≥ 70% จาก baseline; wrong-action = 0
6. **ผลที่ใช้ไม่ได้ไม่คิดเงินลูกค้า**: การตรวจผลเกิดก่อน settle (R12, แก้ B6)
7. ขั้นที่ไม่เรียก AI ไม่คิดเครดิต งานที่เริ่มแล้วทำต่อจนจบได้แม้เครดิตหมด ข้อความพิมพ์ใหม่ยังผ่านประตูเครดิต (รอ Owner §17 Q1)
8. ทดลองโมเดลเล็กกับ Tier 1 หลัง eval ผ่านเท่านั้น

## 3. Non-goals

- ไม่เปลี่ยนโมเดลของ Tier 2, OCR, document QA
- ไม่สร้างหน้าเว็บใหม่; รับรอง/อนุมัติ/ออกใบรับรองแทนใบเสร็จยังอยู่ในเว็บ
- ไม่เปลี่ยนกติกาสิทธิ์/ABAC/การอนุมัติ — การอนุญาตต่อรายการใช้โค้ดเดิม (§8, R21); การเปิดทางอ่านรายการใน LINE (§6.1) ใช้การตรวจสิทธิ์ชุดเดิมของ use-case นั้น
- **ไม่ทำ workflow แก้ใบเบิก และไม่แตะทางแก้เดิม**: ตัวเลือก TARGET (UPDATE, rda:812–820) และทุกตัวเลือกของ action UPDATE คงเป็น message action ที่ไปเส้นทางเดิม; `proposeCollected`/`choose` รองรับเฉพาะ CREATE (rda:337–348, :164)
- ไม่ทำ workflow ให้คู่ค้า/พนักงาน/สาขา/แพ็กเกจ (pwu:6692–6714, 6720–6729, 6646)
- ไม่ทำ multi-intent ใน Tier 1; ไม่ทำ group/room
- ไม่เปลี่ยนสูตร slot/repair/QA ของ turn grant (classifier ใช้ authority แยก §6.4)
- ไม่ใส่วันหมดอายุใน open token รุ่นแรก
- ไม่ทำรายงานต้นทุนในเว็บ

## 4. ผู้ใช้และ journey

แพ็กเกจที่ขาย: Starter/Basic/Pro (รายจ่าย + ใบเบิก), Enterprise (+ ภ.ง.ด.53/50 ทวิ) (`packages/contracts/src/menu-entitlements.ts` `TIER_FEATURE_PRESETS`)

| บทบาท | LINE | เว็บ |
|---|---|---|
| พนักงาน (ผู้ขอเบิก) | J1 กด "สร้างใบเบิก" → บิลหรือ "รายการใหม่" → พิมพ์ "ค่าแท็กซี่ 250 บาท เมื่อวาน" (ตัวแยกแบบ deterministic §7.5) → ใบเสร็จ/ไม่มี → หมวด → เหตุผล → การ์ดยืนยัน; หรือพิมพ์ทั้งหมดในข้อความเดียว (Tier 1); J3 "ส่งใบเบิก" → ใบเบิกร่างของตัวเอง | แก้ใบเบิก/ใบที่ส่งแล้ว ในเว็บหรือเส้นทาง AI เดิม |
| ผู้อนุมัติ (มีสิทธิ์ หรือถูกกำหนดในขั้นแบบตรึง) | J4 ปุ่มบนแจ้งเตือน (มีอยู่) หรือพิมพ์ "อนุมัติใบเบิกของสมชาย" → การ์ดยืนยัน; ไม่อนุมัติ → ถามเหตุผลบรรทัดเดียว | หน้าใบเบิกรออนุมัติ |
| การเงิน/ผู้จ่าย | J5 ปุ่ม "บันทึกจ่ายคืน" บนแจ้งเตือนใบเบิกพร้อมจ่าย (ใหม่) หรือพิมพ์ → ขอสลิป → การ์ดยืนยัน; J6 ยืนยันรายการที่หัก ณ ที่จ่าย → ใบเตรียมจ่าย → ส่ง → อนุมัติ → จ่าย → 50 ทวิ (Enterprise) | ไฟล์ 50 ทวิ/ภ.ง.ด. |
| เจ้าของร้าน | ทุก journey ตามสิทธิ์ + J7 ยืนยัน/ยกเลิก/บันทึกจ่ายรายการ, J8 เตรียมใบรับรองแทนใบเสร็จ | รับรอง/อนุมัติ/ออกใบทดแทน |
| ผู้สร้างรายการที่ไม่มีสิทธิ์อ่านรายการ (มีแค่ `expense.create`/`expense.update`) | ส่งตรวจ/ลบร่าง **ของตัวเอง** ผ่าน picker แบบเฉพาะของตัวเอง (R21, §17.1 MC1) | ตามสิทธิ์เดิม |
| ผู้ตรวจ (AUDITOR_READONLY) | ถามข้อมูล (Tier 2); งานเขียน → คำปฏิเสธเดิม ไม่มีปุ่มเริ่ม | อ่านอย่างเดียว |

ทุก journey: ข้อความที่ไม่ใช่งานซ้ำไป Tier 2; คำถามแทรกกลาง workflow ไม่ถูกจับเป็นคำตอบช่อง และไม่ลบงานค้าง (R6)

## 5. กติกา/ข้อยกเว้น

| # | กติกา | ที่มา |
|---|---|---|
| R1 | Tier 0 → Tier 1 → Tier 2 ชั้นแรกที่รับได้เป็นเจ้าของ | หลักฐานปัจจุบัน: https://arxiv.org/html/2512.04123 (การศึกษาระบบที่ใช้งานจริง — 16/20 กรณีใช้ขั้นตอนที่กำหนดไว้); แนวทางเชิงประวัติ: https://www.anthropic.com/engineering/building-effective-agents (2024-12-19 — หน้าเองระบุว่าเครื่องมือที่เล่าไว้เปลี่ยนไปแล้วตั้งแต่ ธ.ค. 2024 และชี้ไปแนวทางปัจจุบัน https://www.anthropic.com/engineering/managed-agents 2026-04-08 ซึ่งว่าด้วยสถาปัตยกรรม Managed Agents ไม่ได้ตัดสินเรื่อง workflow กับ agent) |
| R2 | คำตอบของคำถามที่ workflow ถามเอง ไปที่ตัวแยกช่องของ workflow นั้นก่อน ไม่ผ่าน classifier | Owner: คำตอบของคำถามที่ผู้ช่วยถามเอง ปิดคำถามนั้น |
| R3 | postback ทุกตัวมีหลักฐานหนึ่งในสามแบบ: (ก) **HMAC ครอบทุก field** — `wf_open` และ open token เดิม; (ข) **หลักฐานที่ server เก็บไว้และผูกเจ้าของ** — `wf_choice` (`token` = id สุ่มของ `StoredWorkflowChoice` ที่ผูก company/user/chat; `pick` ต้องอยู่ใน `options` ที่เก็บ) และ `reimbursement_choice` (`actionId` + `revision` = digest ของตัวเลือก rda:155 เทียบกับ action ที่ active ของเจ้าของ; `choice` ต้องอยู่ในตัวเลือกปัจจุบัน) — ไม่ใช้ HMAC เพราะทุกค่าถูกเทียบกับของที่ server เก็บ; (ค) **ปุ่มนำทางที่ไม่มีเป้าหมาย** — `chat-action`, `fixed-read` (id จากรายการปิด ตรวจสิทธิ์ใหม่ทุกครั้ง ไม่เขียน); ปุ่มเก่าแบบข้อความยังทำงาน | `line-reimbursement-approval-control.logic.ts:5–10`; `line-business-card.logic.ts:58–60`; rda:155 |
| R4 | workflow เขียนเองไม่ได้ — จบที่การ์ดยืนยันที่ลงนาม และ use-case เดิมตอนกด; ใบรับรองแทนใบเสร็จ: การเขียนรายจ่ายทุกอย่าง — หมวดค่าใช้จ่ายที่ตอบระหว่างเก็บข้อมูล, การตรวจรายจ่าย, การเตรียมเอกสารที่มีเลข (ISSUE หรือ FORM) — เกิดเฉพาะตอนกดการ์ดที่ลงนาม; ระหว่างเก็บข้อมูลค่าที่ตอบอยู่ใน `acceptedValues` ของ continuation เท่านั้น; ข้อความพิมพ์ "1"/"2"/คำตอบรับ แค่ส่งการ์ดยืนยันของทางเลือกนั้น (แก้ B7, B8) | Owner rule; lea:840–877; `line-substitute-receipt-action.service.ts:178–221` |
| R5 | ถามครั้งเดียว ถามเฉพาะช่องที่ขาด; ค่าตั้งต้น: วันที่ไม่ระบุ = วันนี้ (กรุงเทพ), วัน/เดือนไม่ระบุปี = ปีนี้, ผู้ขอเบิก = ตัวเอง, สาขา = สาขาเดียวที่มีสิทธิ์, เป้าหมายเดียว = เลือกให้ | Owner rules; stv2:89 |
| R6 | ข้อความที่เป็นคำถาม/คำสั่งใหม่ไม่ใช่คำตอบของช่อง (ใช้เฉพาะส่วนตรวจคำถาม/คำสั่งของใบเบิก rda:194–197) และไม่ลบงานค้าง (รวมช่องชื่อผู้รับเงิน); เงื่อนไข "ต้องไม่มียอด" (rda:198) คงเป็นของช่องเหตุผลใบเบิกเท่านั้น — ช่องที่อยู่ เช่น "88 ถนนสีลม" มีตัวเลขได้ | §13 B2 |
| R7 | Tier 1 รันเฉพาะ: แชตส่วนตัว, ข้อความล้วน ≤ 1,000 หน่วย UTF-16, ไม่มีงานค้างที่ R2 รับ, `answersOpenWork` = false, ไม่มีคำถามค้างใน ledger/task projection, ไม่มีรูปที่พักไว้; อย่างอื่น → Tier 2 | pwu:6003–6086; §6.4 |
| R8 | classifier ได้แค่ข้อความปัจจุบัน + label ที่ปิด ไม่มีข้อมูลร้าน; span ต้องเป็นสตริงย่อยของข้อความจริง; จำนวนเงิน/วันที่ใช้ `extractValueCandidatesV2` เท่านั้น | budget contract §3 |
| R9 | เริ่ม workflow ทันทีเมื่อ label เป็น workflow, `confidence ≥ T` และ `confidence − second_confidence ≥ M` (เริ่ม T 0.80, M 0.15; ตั้งจากชุดจูนตาม measurement spec §7.4); `0 ≤ second_confidence ≤ confidence ≤ 1` ตรวจฝั่ง server; กรณีไม่ผ่านตามตาราง §7.2.1 | R10 |
| R10 | provider บังคับ schema: Converse `outputConfig.textFormat` หรือ tool `strict: true`; ไม่มี `minimum/maximum/minLength/maxLength`; `additionalProperties` ต้อง false; compile ครั้งแรก "may take up to a few minutes"; grammar "cached for 24 hours from first access" | https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html |
| R11 | ขีดจำกัด: strict tools ≤ 20, optional ≤ 24, union ≤ 16; Sonnet 4.6 และ Haiku 5.5 อยู่ในรายการที่รองรับ; Converse กับ `global.anthropic.claude-sonnet-4-6` **ยังไม่ยืนยัน** → probe (plan B1) | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| R12 | **ขอบเขตการคิดเงิน**: ผลของการเรียกใต้ envelope LINE v2 ทุกครั้ง (ทุก profile `*/2` — abb:216–221 รวม `document-qa/2` และ `public-lookup/2` — และ `line-classify/2`) ถูกตรวจโดยผู้เรียก *ก่อน* settle (hook `acceptOutput` §7.3); ผลที่ไม่ครบ (`output_limit`), อ่านไม่ออก, ผิด schema, หมดเวลา = การเรียกที่ล้ม → usage `ok: false` → COMPANY_ABSORBED (cbr:872) โดยตัวนับโทเคนครบ; ขั้นที่ไม่เรียกโมเดลไม่จองเครดิต | Owner 2026-10-15 (การเรียก AI ที่ล้มไม่คิดเงินลูกค้า); budget contract §5 (ตัวนับต้องไม่หาย) |
| R13 | ข้อความพิมพ์ใหม่ผ่านประตูเครดิตแม้ไม่เรียกโมเดล; ปุ่มและคำตอบของงานที่เริ่มแล้วไม่ถูกเครดิตหมดขวาง | ข้อเสนอ — รอ Owner §17 Q1 |
| R14 | ไม่มีสวิตช์พฤติกรรม; สวิตช์ทักทายถูกลบ | Owner rule; `packages/config/src/index.ts:322–326` |
| R15 | คำที่ลูกค้าเห็นมาจากค่าคงที่ ผ่านตัวตรวจบุคลิก | `apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.ts:32–47` |
| R16 | แจ้งเตือนเฉพาะคนที่เกี่ยว — เพิ่มปุ่มบนแจ้งเตือนเดิม ไม่เพิ่มผู้รับ | Owner 2026-10-01 |
| R17 | ใบรับรองแทนใบเสร็จ: LINE เตรียม/ลงชื่อผู้รับเงินได้ตามเดิม; รับรอง/อนุมัติ/ออก อยู่ในเว็บ | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts:170–176` |
| R18 | ราคา (USD/MTok): Sonnet 4.6 in 3 / cache write 5 นาที 3.75 / cache read 0.30 / out 15; Haiku 5.5 (prompt ≤ 100k) in 0.10 / cache write 0.125 / cache read 0.01 / out 0.50; รุ่น 4.7 ขึ้นไปนับโทเคนมากขึ้นราว 30% | https://platform.claude.com/docs/en/about-claude/pricing |
| R19 | Haiku 5.5 บน `bedrock-runtime` รองรับ Messages, Converse, Invoke; `global.anthropic.claude-haiku-5-5` ใช้จาก ap-southeast-1 ได้ (ไม่มี In-Region/Geo); structured outputs; prompt cache ขั้นต่ำ 512 โทเคน TTL 5 นาที/1 ชม.; adaptive thinking เปิดเป็นค่าตั้งต้น effort ตั้งต้น medium (ปิด thinking แล้ว effort สูงสุด high); thinking tokens นับใน max_tokens | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html; https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide |
| R20 | ให้เห็นเฉพาะเครื่องมือที่เกี่ยวช่วยเลือกถูกขึ้นมาก (13.62% → 43.13%) | https://arxiv.org/abs/2505.03275 |
| R21 | การอนุญาตต่อรายการใช้ของเดิม: `permitted` (lea:997–1012) รวม `expense.delete` หรือ (ผู้สร้าง + `expense.update`) และ `expense.review` หรือ (ผู้สร้าง + `expense.update`) (lea:1010–1011); การอนุมัติใช้ `approvalDecisionActions` + assignment ที่ตรึง (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts:162–180`, lea:1003–1006); **การอ่านเพื่อแสดง picker** ใช้ scope ของ use-case รายการ (`expenseListReadScope`, `apps/api/src/modules/expenses/application/expense-list-read-scope.ts:4–9`); ผู้ไม่มีสิทธิ์อ่าน (scope = null) แต่เป็นผู้สร้างที่มี `expense.create`/`expense.update` ใช้ picker เฉพาะรายการ `createdByUserId = ตัวเอง` สำหรับ action ที่ `permitted` อนุญาตผู้สร้าง (MARK_READY, DELETE_DRAFT) — §17.1 MC1; `canUseLineChatAction` (ai-tools.ts:293–303) ใช้แค่แสดงปุ่มนำทาง | review รอบ 1 F10, รอบ 2 P10 |

ข้อยกเว้น: E1 ปุ่มใช้ไม่ได้ — แยกตามสิ่งที่ server พิสูจน์ได้: (ก) ลายเซ็น/token ไม่ผ่าน (ปลอม ข้ามคน ข้ามบริษัท) หรือไม่พบในที่เก็บ/ใช้ไปแล้ว — `wf_open` ไม่มีวันหมดอายุ จึงล้มได้ทางนี้ทางเดียว → ข้อความเดิม "การ์ดนี้ใช้ไม่ได้แล้วค่ะ ขอเตรียมการ์ดใหม่อีกครั้ง" (lea:178) ไม่มีปุ่มที่อ้างเป้าหมาย; (ข) การ์ดหมดอายุจริงที่ server พิสูจน์ได้: `ReimbursementDraftAction` เลย `expiresAt` (`line-reimbursement-draft.use-case.ts:159`) หรือการ์ดรายการ/ใบเตรียมจ่ายที่ preview ใน Redis หายตาม TTL 600 วินาที (`line-draft-preview.store.ts:29, 111`) แต่ยังมี **บันทึกกู้คืน** `recover:<previewId>` (TTL 7 วัน เก็บ `{ companyId, userId, act, id, pm, pd, pa }` ลบทันทีเมื่อกดยืนยัน/ยกเลิก — มีบันทึกแต่ไม่มี preview จึงหมายถึงหมดเวลาเท่านั้น) และ company/user ตรงผู้กด → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่` (`wf_open` ที่ลงนามจากบันทึกนั้น); token เดิม `${previewId}.${sign(entry)}` (lea:588) ตรวจลายเซ็นไม่ได้เมื่อ entry หาย จึงใช้ previewId หาเฉพาะบันทึกกู้คืน และ `wf_open` ตรวจสิทธิ์/สถานะใหม่ทั้งหมดก่อนแสดง preview; E2 ไม่มีสิทธิ์ → คำปฏิเสธเดิม (`refusal()` lea:1014+); E3 แพ็กเกจไม่มี → ข้อความ entitlement เดิม (pwu:534); E4 ข้อความของ "อย่างอื่น" หมดอายุ/Redis ใช้ไม่ได้/วันที่กรุงเทพเปลี่ยนแล้ว → ขอให้พิมพ์ใหม่ 1 บรรทัด; E5 ระหว่าง support pause ปุ่ม workflow ทำงาน ข้อความพิมพ์ยังเข้า pause ตามเดิม

## 6. Data model (additive เท่านั้น)

### 6.1 แคตตาล็อก workflow และแหล่งเป้าหมาย

ชื่อ = id ของ `LINE_CHAT_ACTIONS` เดิม (ai-tools.ts:258–279) + `substitute_receipt` (ใหม่) โดยเพิ่ม field `workflow: true`; ปุ่มเริ่มแสดงตาม `mayOfferWorkflow` = มีทางใดทางหนึ่งของ `permitted`/assignment (R21)

แหล่งเป้าหมาย = use-case รายการที่แบ่งหน้าและกรองฝั่ง DB (ไม่ใช้ tool สรุปที่ตัด 10 แถว: `reimbursement-summary.use-case.ts:287`, `erp-reimbursement-tools.use-case.ts:59`; ไม่ใช้ `reimbursement.get_summary` ที่ไม่มี id — `line-read-evidence.spec.ts:403`)

| workflow id | action ปลายทาง (เดิม) | ช่องที่อาจถาม | แหล่งเป้าหมาย | ตัวกรองเฉพาะ action |
|---|---|---|---|---|
| `reimbursement_claim` | `open` + `buildOptions` + proposal → `reimbursement_draft_confirm` | บิล/รายการใหม่ → (รายละเอียด ยอด วันที่ — §7.5) → ใบเสร็จ/ไม่มี → หมวด → เหตุผล | SOURCE choices ของ `rda.buildOptions` (rda:705) | ตามเดิม |
| `reimbursement_submit` | `REIMBURSEMENT_SUBMIT` | ใบเบิก | `ListReimbursementsUseCase` (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.ts:504–589`) `bucket: 'draft'` | `canSubmitClaim` (lea:376) |
| `reimbursement_cancel` | `REIMBURSEMENT_CANCEL` | ใบเบิก → เหตุผล | เหมือนบน, status ที่ยกเลิกได้ | `permitted` CANCEL (lea:1002) |
| `approvals` | `REIMBURSEMENT_APPROVE` | ใบเบิก | `ListReimbursementsUseCase` `status: 'PENDING_APPROVAL'` + `search` (:553) | `approvalActions.canApprove` (:575) |
| `reimbursement_reject` | `REIMBURSEMENT_REJECT` | ใบเบิก → เหตุผล | เหมือนบน | `approvalActions.canReject` |
| `reimbursement_pay` | `REIMBURSEMENT_RECORD_PAYMENT` | ใบเบิก → สลิป | `ListReimbursementsUseCase` `bucket: 'payment'` | `reimbursement.payment.record` (lea:1000) |
| `expense_submit` / `expense_confirm` / `expense_delete` / `expense_void` / `expense_pay` | `MARK_READY` / `CONFIRM` / `DELETE_DRAFT` / `VOID` / `RECORD_PAYMENT` | รายการ (+ เหตุผล VOID, วิธีจ่าย) | `ListExpensesUseCase` (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:286–295`, scope ตาม `readScope` :355–367) ตาม status/paymentStatus เรียง `expenseDate desc` (`prisma-expense.repository.ts:1273`); ผู้สร้างที่ไม่มี read scope → รายการ `createdByUserId = ตัวเอง` เท่านั้น (R21) | `permitted` ของ action นั้น |
| `payment_voucher` | `VOUCHER_CREATE` | รายจ่ายยืนยันแล้ว → ผู้รับเงิน (ถ้าขาด) | `ListExpensesUseCase` CONFIRMED | `vouchers.authorize` (lea:998) |
| `wht_certificate` | `WHT_CERTIFICATE_ISSUE` | ใบเตรียมจ่าย → ที่อยู่ผู้รับ (ถ้าขาด) | **`DisbursementVoucherUseCase.listForLine`** (ใหม่ — `list` เดิมปฏิเสธ LINE session: `disbursement-voucher.use-case.ts:69–72, 228–229`) | `canOfferCertificate` (`line-voucher-action.service.ts:75`), `wht_50bis` |
| `substitute_receipt` (ใหม่) | `substituteReceiptContinuation.execute` (confirmedStart แบบ pwu:6744) จนถึงการ์ด PREPARE/FORM ที่ลงนาม (`LineSubstituteReceiptActionService.prepare` :100); การตรวจรายจ่าย/เตรียมเอกสารเกิดเฉพาะตอนกดการ์ด (`apply` :178) — R4, B7 | ช่องของ continuation เดิม | **`ListSubstituteReceiptCandidatesUseCase` ทาง LINE** (ใหม่ — ตัวเดิมเรียก `assertWeb`: `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts:471–496`) — ไม่ใช้คิวลงชื่อ (`prisma-expense.repository.ts:1817–1833` เก็บเอกสารที่เตรียมแล้ว และไม่มี expense id) | ตัวกรองสิทธิ์/คุณสมบัติเดิมของ use-case นั้น (`substituteReceiptPreparationScope`, `collectSubstituteReceiptEligibilityIssues`) |

ทางอ่านใน LINE ที่เพิ่ม (อ่านอย่างเดียว ตรวจสิทธิ์ชุดเดิม):
- `DisbursementVoucherUseCase.listForLine(ctx, query)` = `list` ที่เรียก `scope(ctx, 'read', branchId, lineConfirmed = true)` — ยังต้องมี `expense.disbursement.read` (:69–72) และ read scope ของรายจ่าย (:74–78); ไม่เปิดทางเขียนใด ๆ (ทาง read tool เดิมเลี่ยงด้วยการเปลี่ยน `authProvider` เป็น `'watchdog'` — `apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts:15–19`, G15)
- `ListSubstituteReceiptCandidatesUseCase.execute(ctx, filter, { channel: 'line' })` = ข้าม `assertWeb` เฉพาะการอ่านรายการ; ตัวกรองสิทธิ์/คุณสมบัติเหมือนเว็บทุกตัว; การเตรียม/ลงชื่อยังผ่าน continuation เดิม; การรับรอง/อนุมัติ/ออกยังเป็นเว็บ (R17) — §17.1 MC2

การค้นตามชื่อ (slot) — ห้ามพูด "ไม่พบ" ถ้าค้นไม่ครบ:
- ใบเบิก: `search` ฝั่ง DB (:553) แล้วกรองด้วย `approvalActions`/สิทธิ์ ไล่ ≤ 3 หน้า × 100 (pageSize สูงสุด 100, :538); `total` ≤ 300 แล้วไม่พบ → "ไม่พบ…"; > 300 → ปุ่มเว็บ
- รายจ่าย (แก้ P11): `ListExpensesUseCase.execute(ctx, { status | paymentStatus, vendorCounterpartyId?, createdByUserId? (R21), page, pageSize: 100 })` — ต้องส่ง `pageSize` เอง (ค่าตั้งต้น 20 สูงสุด 200, `expense-draft.use-case.ts:291–292`); ผลมี `total` และเรียง `expenseDate desc, id desc` (`prisma-expense.repository.ts:1271–1274`); ไม่ใส่ช่วงวันที่ จึงรวมรายการค้างจ่ายเก่ากว่า 90 วัน; ไล่ ≤ 3 หน้า; `expense_pay` เรียกสองชุด (`UNPAID`, `PARTIALLY_PAID`) แล้วรวมเรียงวันที่; **exhaustive** = Σ `total` ≤ 300 และอ่านครบทุกหน้า แล้วจึงกรองด้วย `permitted`; > 300 → "มีรายการมากเกินจะค้นในแชตค่ะ" + `ค้นในเว็บ`; ไม่มีการค้นด้วยข้อความ (ตัวกรองไม่มี search — `packages/contracts/src/expenses.ts:1232–1254`) ชื่อผู้ขายจึงผ่าน `vendorCounterpartyId` ตามข้อถัดไป
- รายจ่าย: ชื่อผู้ขาย → `ListCounterpartiesUseCase.execute(ctx, page, 100, { search })` (`apps/api/src/modules/accounting-documents/application/use-cases/counterparty.use-case.ts:266–272`) ≤ 3 หน้า (ไม่ใช้ tool เดิมที่ตัด 10 แถว `line-counterparty.service.ts:77`); 1 ราย → กรอง `vendorCounterpartyId`; 2–4 ราย → ปุ่มให้เลือกผู้ขาย; > 4 → ปุ่มเว็บ; 0 (ค้นครบ) → "ไม่พบผู้ขายชื่อ … ในรายชื่อคู่ค้าค่ะ"; **ไม่มี `accounting.counterparty.read`** (:75, use-case :270) → ไม่กรองตามชื่อ แสดงรายการล่าสุดด้วยคำ "เลือกจากรายการล่าสุดได้เลยค่ะ" (ไม่พูดว่าไม่พบ)
- ใบเตรียมจ่าย: `q` ของ `listForLine`

### 6.2 ตาราง metric ของงาน (migration additive)

```prisma
/// One LINE workflow run (task) from its first press/message to its own terminal state. No message text (PDPA).
model LineAiTaskRun {
  id                   String    @id @default(cuid())
  companyId            String
  membershipId         String
  chatKeyHash          String    @db.VarChar(64)
  kind                 String    @db.VarChar(40)   // workflow id | 'read' | 'open' | 'smalltalk' | 'unknown'
  entry                String    @db.VarChar(20)   // 'BUTTON' | 'NOTIFICATION' | 'TYPED_CLASSIFIED' | 'TYPED_FULL'
  status               String    @default("OPEN") @db.VarChar(16) // OPEN | COMPLETED | DECLINED | REFUSED | ABANDONED
  deadEnd              Boolean   @default(false)
  eventCount           Int       @default(0)
  pressCount           Int       @default(0)
  typedCount           Int       @default(0)
  classifierLabel      String?   @db.VarChar(40)
  classifierConfidence Decimal?  @db.Decimal(4, 3)
  sourceType           String?   @db.VarChar(40)
  sourceId             String?   @db.VarChar(64)
  resultType           String?   @db.VarChar(40)
  resultId             String?   @db.VarChar(64)
  startedAt            DateTime  @default(now())
  endedAt              DateTime?
  updatedAt            DateTime  @updatedAt
  company              Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@index([companyId, startedAt])
  @@index([companyId, chatKeyHash, status])
  @@index([companyId, resultId])
}

model LineWebhookEventLog {
  // ...existing fields
  taskRunId                 String?
  classifyAuthorityJson     Json?    // §6.4
  classifyAuthorityRevision Int      @default(0)
  @@index([taskRunId])
}
```

ขอบเขตงาน: งานหนึ่ง = workflow id หนึ่ง จาก event แรกถึง terminal ของ action นั้น; `reimbursement_claim` จบเมื่อร่างถูกบันทึก (`resultType = 'REIMBURSEMENT_REQUEST'`, `resultId` = `result.receipt.requestId`, pwu:5330); การส่งอนุมัติเป็นงาน `reimbursement_submit` ใหม่ที่ `sourceId` = requestId เดียวกัน; journey = งานที่ต่อกันด้วย `resultId → sourceId` ภายใน 30 นาที; `COMPLETED` = action ถูก apply (หรือคำตอบอ่านส่งถึง LINE); `DECLINED` = กด "ไม่ทำ" ที่การ์ด

ต้นทุนไม่เก็บซ้ำ: รายงานอ่าน `AiBudgetReservation` ของ attempt key ทั้งสองแบบต่อ event (turn `deliveryHash(['line-turn-v2', webhookEventId])` pwu:4425; classifier `deliveryHash(['line-classify-v2', webhookEventId])` §6.4) — ส่วนลูกค้า/บริษัทจาก `evidenceJson.customerChargedSatang/companyAbsorbedSatang` (cbr:947, 954); ต้นทุน provider แบบไม่ปัดคำนวณจากตัวนับโทเคน × ราคาใน `AiUsageEvent.pricingSnapshot` (`apps/api/prisma/schema.prisma:4567`) แยกจากยอดสตางค์ที่ปัดแล้ว (ai-model-pricing.ts:223) — measurement spec §6.5

อายุข้อมูล: ลบพร้อม `LineWebhookEventLog` ตาม `AI_DATA_RETENTION_DAYS` (ค่าตั้งต้น 90, `packages/config/src/index.ts:362`)

ไม่มีตารางสถานะ workflow ใหม่: สถานะอยู่ใน `ReimbursementDraftAction` (`apps/api/prisma/schema.prisma:7409`), StoredAction ใน Redis (`apps/api/src/modules/expenses/application/services/line-draft-preview.store.ts:4`), continuation ใบทดแทนเดิม

### 6.3 ที่เก็บชั่วคราว (Redis)

`LineDraftPreviewStore<StoredWorkflowChoice>` prefix `wf-choice:` TTL 900 วินาที: `{ choiceToken, options[], rawText, originalAcceptedAtMs, originalBangkokDate, originalEventIdHash, classifierDecision }` (คลาสเดิม line-draft-preview.store.ts:62)

### 6.4 Budget ของ classifier — authority แยก

- **authority kind ใหม่** `'webhook_classify'` (abb:228+); parent = แถว `LineWebhookEventLog` เดียวกัน คอลัมน์ `classifyAuthorityJson/Revision`; `bas` เลือกคอลัมน์ตาม kind ทุกจุด (`parent()` :81–86, `issue` :124–178, `validate` :180–197, `resolvePrivateOwner` :199+, `reserve` :305–363)
- `issue`: owner PRIVATE, `allowedProfileIds = ['line-classify/2']`, `maxTurnSlots = 2` (parser รับอยู่แล้ว abb:313), lane ใหม่ `classify` ใน `baseCeilings` (bas:45) = 8,000 ms, `attemptKey = deliveryHash(['line-classify-v2', webhookEventId])`; `narrow`/`transferToDocumentQa` ปฏิเสธ kind นี้
- **profile ใหม่** `'line-classify/2': { maxInputTokens: 24_576, maxOutputTokens: 1_024, maxCalls: 1 }` (abb:216–219); `profileCounts` (bas:344) ทำให้เรียกได้ครั้งเดียว; digest ของตารางเปลี่ยน → release เดียว API/gateway/AgentCore
- ขนาดจาก estimator จริง (abp:126–162): พรอมต์ ≤ 8,000 ไบต์ + ข้อความ ≤ 1,000 หน่วย UTF-16 (ไทย ≈ 3,000 ไบต์) + framing ≈ 300 + schema ≈ 1,700 → ≈ 13,000 + 4,096 → ปัด 1,024 = 17,408 ≤ 24,576; spec test ยืนยัน
- **turn grant ไม่เปลี่ยน**: Tier 2 ใช้ turn grant ของ event (`prepareTextGrantV2` pwu:4412–4431) ordinal 0 ใน request ของ intake; ฟังก์ชัน slot (abb:339–351), `narrow` slot (bas:293), planner limit (stv2:727), QA (`apps/ai-gateway/src/modules/line-ai/application/document-qa.use-case.ts:97`), orchestrator (`orchestrator.agent.ts:1210`), AgentCore (`apps/ai-gateway/src/agentcore/runtime.ts:732`) คงเดิม (regression test)
- **deadline**: turn grant ยังนับจาก `admittedAtMs` (pwu:4426) + 40,000 ms ของ lane `public` (pwu:4427, bas:45) เหมือนเดิม — เวลาที่ classifier ใช้ (≤ 4 วินาที) หักจากงบนี้ ไม่ขยาย; ผลคือ Tier 2 หลัง fallback ไม่ช้ากว่าเพดานเดิมของวันนี้ แต่ไม่อยู่ใต้ 15 วินาที (AC14)
- การตัดสินเก็บใน `classifyAuthorityJson.decision`: event ที่เล่นซ้ำใช้ผลเดิม ไม่จ่ายซ้ำ; authority ใช้แล้วไม่มี decision → Tier 2
- ประตูเครดิต: การจองของ classifier ตรวจเครดิตเหมือน intake วันนี้; ปฏิเสธด้วยเหตุเครดิต → `answerAiCreditRefusal` (pwu:7017)

- **model ของ classify grant** (แก้รอบ 4 F5): capability request ของ classifier ส่ง `modelPolicy: { modelId: LINE_CLASSIFY_MODEL_ID }` (ค่าคงที่ในโค้ด: Phase B = `global.anthropic.claude-sonnet-4-6`, Phase C = `global.anthropic.claude-haiku-5-5` เมื่อ Owner Q2 อนุมัติ) แทน model ของบริษัท; บริษัทที่มี model policy ของ partner (`resolveCompanyAiModelPolicy` `ai-gateway.client.ts:159`) ใช้ model ของ policy นั้น ไม่ข้ามนโยบายบริษัท; model ต้องผ่าน `REVIEWED_LINE_MODEL_CAPACITY` (`apps/ai-gateway/src/modules/line-ai/infrastructure/provider/reviewed-line-model-capacity.ts`) + approved lists (`line-reliability-capabilities.controller.ts:24–37`, client :168–175) — วันนี้ตารางไม่มี Haiku 5.5 จึงต้องเพิ่มพร้อมหลักฐานจาก AWS model card และ ceiling 100,000 โทเคนให้ตรง tariff ≤ 100k prompt (§17.1 MC10); `provider.factory.ts:21–29` ใช้ `grant.model` อยู่แล้ว

### 6.5 API-side authority field

`serverRoute?: 'fixed_read'` (ไม่อยู่ใน signed grant เหมือน `admitOverCap`, bas:28–30) สำหรับปุ่มอ่านคงที่ (§7.4 ข้อ 2)

## 7. Contracts/API

### 7.1 Postback (≤ 300 ตัวอักษร, exact keys แบบ `parseLineReimbursementChoiceControl` — `apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts:24–33`)

| action | keys | ความหมาย |
|---|---|---|
| `chat-action` (เดิม) | `action, id` | ถ้า id เป็น workflow → Tier 0 เริ่ม workflow แทนการแปลงเป็นข้อความ `command` (line-staff-menu.logic.ts:942); message action ของ help card (line-business-card.logic.ts:55) เปลี่ยนเป็น postback นี้ |
| `wf_open` (ใหม่) | `action, act, id, pm?, pd?, pa?, sig` | เปิดการ์ด preview ของ `act` (ค่าใดก็ได้ใน `EXPENSE_ACTIONS`, lea:44 — รวม `VOUCHER_SUBMIT/APPROVE/PAY/CANCEL/RETURN`, `WHT_CERTIFICATE_ISSUE`, `RECORD_PAYMENT`) กับเป้าหมาย `id`; `pm`/`pd`/`pa` = วิธีจ่าย/วันจ่าย/**ยอดจ่าย** ที่ผู้ใช้ให้ไว้ก่อนหน้า (แทน `applied.paymentIntent` ใน Redis lea:863; `paidAmount` อยู่ใน paymentIntent lea:470 — ถ้าไม่ส่ง preview ตั้งยอด = ยอดค้างทั้งหมด lea:539 ซึ่งผิดสำหรับการจ่ายบางส่วน); `sig = HMAC(secret, ['line-workflow-open-v1', company, user, act, id, pm ?? '', pd ?? '', pa ?? ''])` ตรวจด้วย `timingSafeEqual`; open token เดิม 3 แบบยังรับ (lea:842–846) |
| `wf_choice` (ใหม่) | `action, token, pick` | ตอบการ์ดความมั่นใจต่ำ: `pick` = workflow id ที่การ์ดแสดง หรือ `other` |
| `reimbursement_choice` (เดิม) | `action, actionId, revision, choice` | ขยาย `choice` ให้รับ choiceId ของ BRANCH/REQUESTER/SOURCE และ `new-line` **เฉพาะ action CREATE**; ตัวเลือกของ action UPDATE (รวม TARGET, rda:812–820) ไม่เปลี่ยน (Non-goals) |
| `fixed-read` (ใหม่) | `action, id` (exact 2 keys) | `id` ∈ `FIXED_READ` — ค่าคงที่ในโค้ด: id → label/ข้อความเดิมของ `QUERY_ACTIONS` (`line-staff-menu.logic.ts:146–164`) + tool + prepared family; controller ตั้ง `fixedReadControl: { id }` และข้อความ synthetic = ข้อความเดิมของปุ่มนั้น (วันนี้ `linePostbackCommandText` :928–945 คืน null สำหรับ action ที่ไม่รู้จัก — ต้องเพิ่ม branch); ทำเฉพาะ id ที่ family อยู่ใน prepared allowlist (`LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`, `packages/config/src/index.ts:554` — release gate ตรวจ ไม่ใช่ซ่อนปุ่มตาม env); id อื่นคง message action เดิม (Tier 2) |

- ปุ่มขั้นถัดไปที่ระบบเสนอหลังกดยืนยัน: `offerNext` (VOUCHER_CREATE/SUBMIT/APPROVE/PAY, `line-voucher-action.service.ts:68–74`, lea:940–942), `offerPayment` (lea:943), `offerWht` (lea:936) → `wf_open` ของ action นั้น + id (`nextVoucherId`/expenseId) + `pm/pd/pa` จาก paymentIntent ตอนสร้างปุ่ม (แก้ B1); control เดิมยังรับสำหรับการ์ดเก่า
- เพิ่ม action ใหม่ใน allowlist ของ delivery plan (`apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts:120–123, 259`) และ parser ของ webhook controller
- เพิ่ม `workflowControl`, `workflowStart`, `fixedReadControl`, `reimbursementChoiceControl` เข้า `deterministicCommand` (pwu:6612) และ `allowDuringSupportPause` (pwu:6690) — แก้ B5
- **ทางผ่าน message buffer (แก้รอบ 4 F2)**: วันนี้ buffer คัดลอกเฉพาะ control เดิมจากข้อความสุดท้าย (`reimbursementChoiceControl: last.reimbursementChoiceControl` — `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:1061, 1090`) control ใหม่จึงหายก่อนถึง handler; ต้องเพิ่ม `workflowControl`/`workflowStart`/`fixedReadControl` ใน (1) type ของ item (:60–75, `line-message-buffer.logic.ts:25`) และ `LineTextEvent` (pwu:236); (2) การตรวจว่าเป็น command (:475) — control ทุกตัวทำให้ item เป็น `command` (worker แยก command เป็น group เดี่ยว `[group.item]` :849–850, :949–950 จึงไม่ถูกรวมกับข้อความอื่น) **แต่ไม่เข้าทางลัด** ของคำสั่งเมนูไร้สถานะ (:510–511 `void this.dispatchBatch(key, state, [item], …)` ที่ข้ามคิว): เงื่อนไขทางลัดเพิ่ม `&& !item.workflowControl && !item.workflowStart && !item.fixedReadControl` — chat idle → ทาง idle เดิม (:500–504, `kickWorker`); ไม่ idle → เข้า `state.open` แล้ว `flushOpen` ทันที (:541) ต่อคิว worker ตามลำดับ จึงไม่แซง `/company B` ที่รออยู่ (บริษัท resolve ตอน event ถูกประมวลผล pwu:6648) — ไม่งั้นปุ่มอ่านคงที่ที่กดหลังสลับบริษัทจะได้ข้อมูลการเงินของบริษัทเดิม (focused check 2026-10-24); control เดิมไม่เปลี่ยนในงานนี้; (3) payload ที่ freeze ลง `payloadJson` (:1051–1065) ซึ่ง sweep ใช้ replay (:383–398); (4) `toTextEvent` (:1086–1091); controller ใส่ค่าเข้า item ที่ `line-webhook.controller.ts:96–125`

### 7.2 Classifier endpoint (gateway)

`POST /v1/internal/ai/line-workflow-classify` — `@Post('line-workflow-classify')` ใน `LineAiInternalController` (`@Controller('internal/ai')`, `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:390–393`) ใช้ `AiUsageInterceptor` เดิม; API client `requestLineWorkflowClassify` (path `/internal/ai/line-workflow-classify`, รูปแบบเดียวกับ `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:164–286`)

```ts
type LineWorkflowClassifyRequest = {
  requestId: string; companyId: string; userId: string; locale: 'th-TH' | 'en-GB';
  messageText: string; inputEvidence: LineAiInputEvidenceV2;
  budgetGrantV2: AiBudgetGrantV2;               // authorityKind 'webhook_classify'
  contractCapabilities: ['input-evidence-v2', 'budget-envelope-v2'];
};
type LineWorkflowLabel = LineWorkflowId | 'read' | 'howto' | 'open' | 'smalltalk' | 'multi' | 'unclear';
type LineWorkflowClassifyResponse =
  | { status: 'CLASSIFIED'; label: LineWorkflowLabel; secondLabel: LineWorkflowLabel | 'none';
      confidence: number; secondConfidence: number;
      slots: { reference: 'this' | 'last_shown' | 'named' | 'none'; ordinal: number; personName: string; vendorName: string;
               descriptionText: string; amountText: string; dateText: string; reasonText: string; categoryText: string };
      schemaEnforcement: 'output_config' | 'strict_tool'; usage: LineAiUsageEntry[]; modelId: string }
  | { status: 'UNAVAILABLE'; errorCode: string; budgetCode?: string; usage: LineAiUsageEntry[] };
```

schema (ทุก field required, `additionalProperties: false`, ไม่มี union, ไม่มีขีดจำกัดตัวเลข — R10/R11):

```json
{"type":"object","additionalProperties":false,
 "required":["label","second_label","confidence","second_confidence","reference","ordinal","person_name","vendor_name","description_text","amount_text","date_text","reason_text","category_text"],
 "properties":{
  "label":{"type":"string","enum":["reimbursement_claim","reimbursement_submit","reimbursement_cancel","approvals","reimbursement_reject","reimbursement_pay","expense_submit","expense_confirm","expense_delete","expense_void","expense_pay","payment_voucher","wht_certificate","substitute_receipt","read","howto","open","smalltalk","multi","unclear"]},
  "second_label":{"type":"string","enum":["<ทุกค่าของ label>","none"]},
  "confidence":{"type":"number"},"second_confidence":{"type":"number"},
  "reference":{"type":"string","enum":["this","last_shown","named","none"]},
  "ordinal":{"type":"integer"},
  "person_name":{"type":"string"},"vendor_name":{"type":"string"},"description_text":{"type":"string"},
  "amount_text":{"type":"string"},"date_text":{"type":"string"},"reason_text":{"type":"string"},"category_text":{"type":"string"}}}
```

- ตรวจ (ใน `acceptOutput` ก่อน settle — R12): `0 ≤ second_confidence ≤ confidence ≤ 1`, `ordinal` 0–9, span ทุกช่องเป็นสตริงย่อยของข้อความจริง (ไม่ใช่ → ค่าว่าง ไม่ทำให้ทั้งผลตก), `amount_text`/`date_text` ต้องตรง span ของ candidate จาก `extractValueCandidatesV2` (ไม่ตรง → ค่าว่าง), label นอก enum → ตก; `second_label` = `label` → ทำให้เป็น `second_label: 'none'`, `second_confidence: 0` ก่อนใช้ R9 และ §7.2.1 (เก็บทั้งค่าดิบและค่าหลังทำให้เป็นมาตรฐานใน decision); enum ตายตัวทุก tenant; งานนอก enum (คู่ค้า พนักงาน สาขา แพ็กเกจ แก้ใบเบิก) → `open`
- พรอมต์ระบบ ≥ 4,000 ตัวอักษร และ ≤ 8,000 ไบต์ UTF-8: นิยาม label + ตัวอย่างสั้น + `LINE_AI_THAI_BUSINESS_GLOSSARY` (ira:52–56); `maxTokens` 256; usageTag `line.workflow-classify`; ไม่มี repair
- thinking/effort: Sonnet 4.6 ไม่เปิด thinking เมื่อไม่ส่งพารามิเตอร์ (ทั้ง Converse และ Messages API); Haiku 5.5 เปิด adaptive thinking เป็นค่าตั้งต้น → classifier ส่ง `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }` (ชื่อของ Messages API; ปิด thinking ได้เมื่อ effort ≤ high — R19) ผ่าน `additionalModelRequestFields` ของ Converse (ชื่อบน Bedrock ยืนยันตอน probe — §17.1 MC5); **Phase C วัดและปล่อยบน Bedrock เท่านั้น** เพราะ `provider.factory.ts:52–54` เลือก `AnthropicApiProvider` เมื่อมี `anthropicApiKey` และคำขอของ provider นั้นไม่ปิด thinking (measurement M-R2); ถ้าเกิดบนเครื่องแล้วโทเคนหมดที่ thinking → `output_limit` → absorbed + Tier 2 (R12)
- timeout 4,000 ms (หรือเหลือของ work deadline ของ classify grant) ผ่าน `deadlineAt`/`AbortSignal` เดิม; หมดเวลา/ตก → Tier 2 (absorbed)
- ประมาณราคา (คำนวณ, FX 33): Sonnet 4.6 อุ่น (2,500 cache read + 300 in + 100 out) ≈ 0.00315 USD ≈ **0.10 บาท**; เย็น (2,500 cache write 3.75) ≈ 0.011775 USD ≈ **0.39 บาท**; Haiku 5.5 อุ่น (cache read 0.01) ≈ 0.000105 USD ≈ **0.35 สตางค์** → ลงบัญชี **0 สตางค์**; เย็น (cache write 0.125) ≈ 0.0003925 USD ≈ **1.30 สตางค์** (1.29525) → ลงบัญชี **1 สตางค์** — ยอดรวมต่อการเรียกปัด ROUND_HALF_UP เป็นสตางค์เต็ม (ai-model-pricing.ts:223) จึงเป็น 0 เฉพาะเมื่อต่ำกว่า 0.5 สตางค์; รายงานต้นทุนใช้ค่าไม่ปัดแยก (measurement spec M-R3, §6.5)

#### 7.2.1 เมื่อความมั่นใจไม่ผ่าน R9

| label อันดับ 1 | label อันดับ 2 | ผล |
|---|---|---|
| workflow | workflow อื่น | การ์ด "ต้องการทำเรื่องไหนคะ" + 2 ปุ่ม workflow + `อย่างอื่น` |
| workflow | read/howto/open/smalltalk/multi/unclear/none | การ์ด "ต้องการทำเรื่องนี้ใช่ไหมคะ" + ปุ่ม workflow นั้น + `อย่างอื่น` |
| workflow | workflow **ตัวเดียวกัน** (ซ้ำ) | ทำให้เป็น `none` ก่อน (§7.2) → เริ่มเลยถ้าผ่าน R9 ไม่งั้นแถวบน (ปุ่มเดียว + `อย่างอื่น`) |
| ไม่ใช่ workflow (อะไรก็ตาม) | ใดก็ได้ | Tier 2 ทันที (ไม่ขัดคำถามเปิด) |
| ตก/UNAVAILABLE | — | Tier 2 |

`wf_choice.pick` รับได้เฉพาะ workflow id ที่การ์ดนั้นแสดง (เก็บใน `StoredWorkflowChoice.options`) หรือ `other`

### 7.3 Provider port และขอบเขตการคิดเงิน (แก้ F2/B6)

- `ProviderInput.outputSchema?: { name: string; schema: Record<string, unknown> }` และ **`ProviderInput.acceptOutput?: (output: ProviderOutput) => boolean`** (local-only แบบ `signal` ไม่ serialize — `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts:6–26`)
- `withAiBudgetEnvelope` (abp:400–467): หลัง `call(bounded)` และก่อน `finally` settle — ถ้า `completion === 'output_limit'` หรือ `acceptOutput` คืน false → ตั้ง `failure = { code: 'OUTPUT_UNUSABLE' }` และแก้ usage entries ของการเรียกนี้ (index ≥ `fromIndex`) เป็น `ok: false, errorCode: 'OUTPUT_UNUSABLE'` โดยไม่แตะตัวนับ → `settleV2` ส่ง entry ที่ `ok: false` → COMPANY_ABSORBED (cbr:872); ห้ามแก้ usage หลัง settle (settle ซ้ำเป็น `'duplicate'` cbr:859–860)
- ผู้เรียกที่ต้องส่ง `acceptOutput` = **ทุกการเรียกใต้ envelope v2** (แก้ทั้ง class ของ B6): classifier `line-classify/2` (schema + ตรวจ §7.2); intake router ira:720 (`line-intake-text/2`/`line-intake-image/2`; `parseIntakePlan` สำเร็จ ira:741); planner stv2:738 (`line-control/2`; `calls`/`questions` ใช้ได้ :766–769); public lookup stv2:948 (`public-lookup/2`); compose stv2:1184 (`line-answer/2`); **document QA** `apps/ai-gateway/src/modules/line-ai/application/document-qa.use-case.ts:92, 100` (`document-qa/2`; `parseLineDocumentQaResult` + `resultCovers` — วันนี้ settle ก่อน parse :93 แล้วคืน `QA_RESULT_INVALID` :97, :106); lane A9 ไล่ `generateText`/`generateWithTools` ทุกจุดที่วิ่งใต้ `active-v2` แล้วบันทึกรายการใน memory — จุดที่ไม่ส่ง `acceptOutput` ต้องเขียนเหตุผลไว้
- `BedrockProvider.generateText` (bedrock.provider.ts:83): `outputConfig.textFormat` ตามตัวอย่าง AWS; ทาง strict tool ผ่าน `generateWithTools` (:115–157); `AnthropicApiProvider`: `output_config.format`; `OpenAiProvider` → `PROVIDER_CONTRACT_UNSUPPORTED`
- budget proof: `v2RenderedInput` (abp:126–162) นับไบต์ outputSchema ใน `textBytes`; `schemaDigest = sha256(canonicalJson(outputSchema ? { tools: tools ?? [], outputSchema } : tools ?? []))`; `payloadDigest` รวม outputSchema (ไม่มี = byte เดิม)
- SDK `@aws-sdk/client-bedrock-runtime@3.1075.0` (`pnpm-lock.yaml:386`) มี type `outputConfig` หรือไม่ ยังไม่ยืนยัน — §17.1 MC4

### 7.4 Budget amendment (ส่วนเพิ่มที่มีวันที่ใน `mangmee-ai-input-provider-budget-contract-2026-09-27.md`)

1. Tier 0 ไม่ขอ grant: เอาเงื่อนไข grant ออกจาก pwu:5352 และ :7718; `inputEvidence` จาก `textEvidenceV2` (pwu:4386–4399)
2. ปุ่มอ่านคงที่: `narrow` (bas:274–303) ยอม `nextOrdinal === 0` เฉพาะ `serverRoute === 'fixed_read'` + lane `simple` + profiles ⊆ `['line-answer/2']`; ถ้า prepared formatter ปฏิเสธ gateway คืนผลที่ไม่เรียกโมเดลตาม guard เดิม (`orchestrator.agent.ts:1210–1222`, `PREPARED_READ_UNAVAILABLE`) — guard คงไว้เพราะ grant นี้ไม่มี `line-control/2` ให้ planner; ทาง `fixed_read` ใช้ข้อความกลางที่จริงทุกปุ่ม (§10) + ปุ่มเปิดหน้าเว็บของ id นั้น แทนข้อความเดิมที่ชี้หน้ารายจ่าย; ไม่มีการเรียกโมเดลสำรองใน grant เดียวกัน
3. classifier: authority/profile แยก §6.4
4. ขอบเขตการคิดเงิน: `acceptOutput` ก่อน settle (§7.3) — แก้ข้อความ §5 ของสัญญาที่ให้ `ok` สะท้อนแค่ผล transport: สำหรับ LINE v2 `ok: false` ครอบผลที่ใช้ไม่ได้ด้วย โดยตัวนับครบ
5. อ่านเครดิตไม่ใช้จ่าย: `creditState(companyId, now)` ใช้ `readAiBudgetMonthSnapshot` (cbr:1046) + `readAiCreditBalance` (`apps/api/src/modules/line-ai/application/ai-credit-ledger.ts:268`) + `decideAiBudgetStep` (cbr:216) แบบอ่านอย่างเดียว
6. การจอง/settle และการแบ่ง `customerChargedSatang/companyAbsorbedSatang` ไม่เปลี่ยน

### 7.5 API ภายใน

- `LineWorkflowTargetService.pick(ctx, chat, workflow, slots, page)` (ไฟล์ใหม่ใน `apps/api/src/modules/line-ai/application/`) — แหล่งตาม §6.1, กรองด้วย predicate อนุญาตเดิม (R21) คืน `{ targets, total, exhaustive }`
- **เริ่มใบเบิกแบบ deterministic** `LineReimbursementDraftAdapterService.startFromWorkflow(ctx, owner, ownerEpoch, start)`:
  - สร้าง action ด้วย `LineReimbursementDraftUseCase.open(ctx, owner, key)` (`apps/api/src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.ts:140–150`) โดย `taskId = stableUuid(['reimbursement-draft-task', owner, 'workflow', eventIdHash])` และ `key = { taskId, actionId: stableUuid(['reimbursement-draft-action', taskId, 'CREATE', 1]), actionOrdinal: 1, operation: 'CREATE' }` — รูปแบบเดียวกับ rda:390–393; `open` ปฏิเสธ `actionId`/`taskId` ที่ไม่ใช่ UUID และ `actionOrdinal < 1` เป็น `invalid_field` (`line-reimbursement-draft.use-case.ts:143`); `stableUuid` ตั้ง version 5 (rda:106–112) จึงผ่าน regex UUID (:22); event เดิมส่งซ้ำ → key เดิม → `intentKeyHash` เดิม (:150) → `findOrCreateDraftAction` คืนแถวเดิม (`apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts:713–717`) + `buildOptions` (rda:705); admission = `{ source: 'workflow', eventIdHash }` แทน accepted ledger request (ทาง Tier 2 ยังใช้ rda:567–640)
  - ถ้ามี action ที่ active อยู่แล้ว (`drafts.active`) → ทำต่อ action นั้น (ไม่เปิดซ้อน)
- **ตัวแยกรายละเอียดรายการใหม่** `parseManualClaimLine(evidence, candidates)` (ฟังก์ชันใหม่ใน `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.logic.ts`):
  - ยอด = candidate จำนวนเงินเพียงตัวเดียว (THB) จาก `extractValueCandidatesV2`; วันที่ = candidate วันที่ไม่เกินหนึ่งตัว (ไม่มี → วันนี้ R5); รายละเอียด = ช่วงข้อความต่อเนื่องที่ยาวที่สุดนอก span ของยอด/วันที่ หลังตัดคำเชื่อม/คำลงท้ายที่ระบุ (`บาท`, `ค่ะ`, `คะ`, `ครับ`, `นะ`, ช่องว่าง, วรรคตอน) ยาว ≥ 2 ตัวอักษร
  - proof: รายละเอียด = `USER_TEXT` refs ของ span นั้น; ยอด/วันที่ = `candidateId` (รูปแบบ proof เดิมใน stv2:89 และ `validateProposalProofs` rda:959)
  - ยอดหลายตัว/ไม่มียอด/ไม่มีรายละเอียด → ถามเฉพาะส่วนที่ขาด 1 คำถาม ("ยอดเท่าไรคะ" / "เป็นค่าอะไรคะ"); ยอดหลายตัว → "รายการนี้ยอดเท่าไรคะ" + ปุ่มยอดที่พบ (ไม่เกิน 4)
  - Tier 1: ใช้ `description_text/amount_text/date_text` ของ classifier ผ่านตัวแยกเดียวกัน (span ต้องตรง); ไม่มีรายละเอียด → ถามตามข้อก่อนหน้า
  - ตัวจับคำตอบในขั้นนี้ทำงานก่อน `answerReason` และยอมรับข้อความที่มียอด (ต่างจาก rda:198 และ pwu:5353 ซึ่งยังใช้กับช่องเหตุผล)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ตัวตน/บริษัท/สมาชิก/ข้อตกลง/entitlement resolve ก่อนทุก handler ตามลำดับเดิม (pwu:6509–6690)
- `sig`/token ผูก company + user (+ act + id + pm + pd + pa) ด้วย `aiGatewayInternalSecret` ตรวจด้วย `timingSafeEqual`; token ของคนอื่น/บริษัทอื่น/สาขานอก scope → ปฏิเสธ ไม่บอกว่ามีรายการ
- การ์ด preview เรียก `preview(..., opened=true)` ซึ่งยังตรวจ `permitted` (lea:997–1012), สาขา (lea:259), สถานะ/revision, entitlement และตอนกดยืนยัน (lea:880–895)
- picker แสดงเฉพาะรายการที่ use-case คืนตาม scope และผ่าน predicate อนุญาต; ทางอ่าน LINE ใหม่ (`listForLine`, candidates `channel: 'line'`) อ่านอย่างเดียวและตรวจสิทธิ์ชุดเดิม
- classifier ไม่ได้รับข้อมูลร้าน (R8)
- แชตกลุ่ม/ห้อง: "กรุณาทำรายการในแชตส่วนตัวค่ะ" (pwu:6434–6438)
- AI Gateway ไม่แตะ DB

## 9. State transitions

### 9.1 การเลือกชั้นต่อข้อความ

```
event (verified, identity, company, legal, entitlement; support pause: postback ของ workflow ผ่าน — E5)
 ├─ postback wf_* / chat-action(workflow) / reimbursement_choice(CREATE) / expense_action_* / draft controls ─► Tier 0
 ├─ text && มีงานค้างที่ถามช่อง (claim รายละเอียด/เหตุผล, expense action awaiting, substitute, team)
 │     ├─ parser ช่องรับได้ ─► Tier 0
 │     └─ คำถาม/คำสั่งใหม่ ─► ตกไปข้างล่าง (งานค้างคงอยู่ + เตือน 1 บรรทัด)
 ├─ text ตรงคำสั่ง/label ปุ่มเดิม/คำทักทาย ─► Tier 0 (creditState ก่อน — R13)
 ├─ ไม่ผ่าน R7 ─► Tier 2
 └─ ผ่าน R7 ─► Tier 1 (classify grant ของตัวเอง)
        ├─ ผ่าน R9 + มีทางอนุญาต ─► start workflow (Tier 0 ต่อ)
        ├─ ไม่ผ่าน R9 ─► ตาราง §7.2.1
        ├─ ไม่มีทางอนุญาต/แพ็กเกจ ─► คำปฏิเสธเดิม
        ├─ เครดิตไม่พอ ─► การ์ดเครดิตเดิม
        └─ อื่น ๆ / ตก ─► Tier 2 (turn grant ของ event เดิม)

wf_choice pick=other (event ใหม่):
   วันที่กรุงเทพเปลี่ยนจาก originalBangkokDate หรือของในที่เก็บหาย ─► "พิมพ์บอกน้องมั่งมีอีกครั้งได้เลยค่ะ"
   ไม่งั้น ─► สร้าง inputEvidence จาก rawText: turnKey และ acceptedAtMs = ของ event ใหม่ (admission ใหม่ → deadline ใหม่)
             เก็บ originalEventIdHash/originalAcceptedAtMs ไว้เป็น provenance ─► Tier 2 ของ event ใหม่ (ไม่ผ่าน Tier 1 อีก)
```

### 9.2 workflow ทั่วไป

`START` → `PICK_TARGET` (ข้ามถ้าเป้าหมายเดียว/ได้จาก slot) → `COLLECT_FIELD`* → `PREVIEW` → `APPLIED` (= COMPLETED) → `NEXT_OFFERED` (ปุ่ม `wf_open` ของงานถัดไป) | `DECLINED` | `EXPIRED` (→ ปุ่มเตรียมใหม่) | `REFUSED`

- ใบเบิก: `ReimbursementDraftAction.status` COLLECTING → PREVIEW → APPLIED (rda:130–186); ช่องในขั้น COLLECTING: line (ตัวแยก §7.5) → receipt → category → reason
- expense/voucher/claim decision: `StoredAction` (lea:56–60, 880–950)
- ใบทดแทน: continuation เก็บช่อง → `pendingDecision: 'ISSUE_CONFIRM'` → การ์ด PREPARE (ISSUE) หรือ FORM ที่ลงนาม (พิมพ์ "1"/"2"/คำตอบรับ = ส่งการ์ดของทางเลือกนั้น ไม่เขียน) → กด → `apply` ส่ง `confirmedDecision` ที่อ่านจาก token → `prepareFromLine` (B7)

### 9.3 `LineAiTaskRun.status`

`OPEN` → `COMPLETED` | `DECLINED` | `REFUSED` | `ABANDONED` (ไม่มี event 30 นาที — ตั้งตอนอ่านรายงาน); `deadEnd = true` เมื่อส่งข้อความตันตาม measurement spec §6.3

## 10. UI: LINE cards — ข้อความไทยตรงตัว

การ์ด/quick reply แบบเดิม (`lineChoiceQuickReply` line-business-card.logic.ts:41; `docs/guidelines/thai-ux-standard.md`); label ≤ 20 ตัวอักษร; ไม่มีรายการเลขข้อแบบพิมพ์

| จุด | ข้อความ | ปุ่ม |
|---|---|---|
| เมนูหลัก (ตาม `mayOfferWorkflow`) | (คงเดิม) | `สร้างใบเบิก` `ส่งใบเบิก` `อนุมัติใบเบิก` `บันทึกจ่าย` (chat-action) |
| เลือกใบเบิก — ส่ง / อนุมัติ / ไม่อนุมัติ / จ่ายคืน | เลือกใบเบิกที่จะส่งอนุมัติค่ะ / เลือกใบเบิกที่จะอนุมัติค่ะ / เลือกใบเบิกที่ไม่อนุมัติค่ะ / เลือกใบเบิกที่จะบันทึกจ่ายคืนค่ะ | ใบละปุ่ม (เลขที่ + ยอด) สูงสุด 4 + `ดูทั้งหมดในเว็บ` เมื่อ total > 4 |
| เลือกรายการ — ยืนยัน / ส่งตรวจ / ลบร่าง / ยกเลิก / บันทึกจ่าย | เลือกรายการที่จะยืนยันค่ะ / เลือกรายการที่จะส่งตรวจค่ะ / เลือกร่างที่จะลบค่ะ / เลือกรายการที่จะยกเลิกค่ะ / เลือกรายการที่จะบันทึกจ่ายค่ะ | รายการละปุ่ม (ร้าน + ยอด) |
| — ใบเตรียมจ่าย / 50 ทวิ / ใบทดแทน | เลือกรายจ่ายที่จะทำใบเตรียมจ่ายค่ะ / เลือกใบเตรียมจ่ายที่จะออก 50 ทวิค่ะ / เลือกรายการที่จะทำใบรับรองแทนใบเสร็จค่ะ | เหมือนบน |
| ไม่มีเป้าหมาย (exhaustive) | ยังไม่มีใบเบิกที่ส่งได้ค่ะ / ไม่มีใบเบิกรอคุณอนุมัติค่ะ / ยังไม่มีใบเบิกที่รอจ่ายค่ะ / ไม่มีรายการรอยืนยันค่ะ / ไม่มีรายการค้างจ่ายค่ะ | `เปิดในเว็บ` |
| ชื่อไม่ตรง (exhaustive) | ไม่พบใบเบิกของ {ชื่อ} ที่รอคุณอนุมัติค่ะ | `ดูใบเบิกรออนุมัติ` |
| ค้นไม่ครบ | มีรายการมากเกินจะค้นในแชตค่ะ | `ค้นในเว็บ` |
| ผู้ขายหลายราย | หมายถึงผู้ขายรายไหนคะ | รายละปุ่ม (ไม่เกิน 4) |
| ผู้ขายไม่อยู่ในรายชื่อคู่ค้า (ค้นครบ) | ไม่พบผู้ขายชื่อ {ชื่อ} ในรายชื่อคู่ค้าค่ะ | `เปิดในเว็บ` |
| ไม่มีสิทธิ์ค้นคู่ค้า | เลือกจากรายการล่าสุดได้เลยค่ะ | รายการล่าสุด |
| ใบเบิก — เลือกบิล (เดิม line-reimbursement-draft-card.logic.ts:311) | เลือกบิลที่จะเบิก หรือเริ่มรายการใหม่ได้เลยค่ะ | บิลละปุ่ม + `รายการใหม่` (postback, CREATE) |
| ใบเบิก — รายละเอียดรายการใหม่ (เดิม :321) | ขอรายละเอียดรายการ จำนวนเงิน และวันที่สำรองจ่ายเพื่อทำใบเบิกต่อค่ะ (ข้อความเดิม) | — |
| ใบเบิก — ขาดยอด / ขาดรายละเอียด / ยอดหลายตัว | ยอดเท่าไรคะ / เป็นค่าอะไรคะ / รายการนี้ยอดเท่าไรคะ | (ยอดหลายตัว) ปุ่มยอดที่พบ |
| การ์ดใบเสร็จระหว่างทำใบเบิก (pwu:10692) | (คงเดิม) | `ใช้บิลนี้ทำใบเบิก` (postback SOURCE) |
| classifier ไม่ชัด — 2 workflow | ต้องการทำเรื่องไหนคะ | {ชื่อ 1} {ชื่อ 2} `อย่างอื่น` (ชื่อจาก `LINE_CHAT_ACTIONS.title`) |
| classifier ไม่ชัด — 1 workflow | ต้องการทำเรื่องนี้ใช่ไหมคะ | {ชื่อ} `อย่างอื่น` |
| "อย่างอื่น" แต่ของเดิมใช้ไม่ได้ (E4) | พิมพ์บอกน้องมั่งมีอีกครั้งได้เลยค่ะ | — |
| ปุ่ม/token ใช้ไม่ได้ (ลายเซ็นไม่ผ่าน, ไม่พบ, ใช้แล้ว — E1 ก) | การ์ดนี้ใช้ไม่ได้แล้วค่ะ ขอเตรียมการ์ดใหม่อีกครั้ง (คงเดิม lea:178) | — |
| การ์ดที่เก็บไว้หมดอายุจริง + รู้เป้าหมายจากข้อมูลที่ลงนาม (E1 ข) | การ์ดนี้หมดเวลาแล้วค่ะ | `เตรียมการ์ดใหม่` (wf_open) |
| ปุ่มอ่านคงที่ — ดึงข้อมูลไม่ได้ (`PREPARED_READ_UNAVAILABLE`) | ตอนนี้น้องมั่งมียังดึงข้อมูลนี้ไม่ได้ค่ะ ดูในเว็บได้เลย | `เปิดในเว็บ` (หน้าของ id นั้น) |
| ใบทดแทน — ตอบหมวดระหว่างเก็บข้อมูล (B8) | ✅ รับข้อมูลเข้าร่างแล้ว (ยังไม่แก้รายการ): หมวดค่าใช้จ่าย — ข้อความเดิมของช่องอื่น (continuation :1267); ลบบรรทัด "หมวดค่าใช้จ่ายบันทึกลงรายการให้แล้ว…" (:1268) และรุ่นอังกฤษ (:1316) | — |
| ใบทดแทน — การ์ด PREPARE/FORM เมื่อมีหมวดที่ตอบไว้ | บรรทัดเพิ่มในการ์ด: หมวดค่าใช้จ่าย: {ชื่อหมวด} | — |
| ใบทดแทน — พิมพ์ "1"/คำตอบรับ ขณะรอเลือก | (การ์ด PREPARE เดิม: ข้อมูลครบแล้วค่ะ กดเตรียมใบรับรองเพื่อตรวจและลงนามต่อ — `line-substitute-receipt-action.service.ts:117`) | `เตรียมใบรับรอง` |
| ใบทดแทน — พิมพ์ "2"/ขอฟอร์ม ขณะรอเลือก | ข้อมูลครบแล้วค่ะ กดขอฟอร์มเพื่อพิมพ์ไปเซ็นเอง | `ขอฟอร์มไปเซ็นเอง` (คำเดิมของตัวเลือก — continuation :714) |
| คำถามแทรกระหว่างรอช่อง (ต่อท้ายคำตอบ Tier 2 ครั้งเดียว) | ↩️ {คำถามเดิมของช่อง เช่น "ยกเลิกรายการนี้เพราะอะไรคะ" lea:338} | — |
| คำทักทาย | (คงเดิม `EXACT_GREETING_REPLY`) | quick reply เมนูเดิม |

อังกฤษ: "I can't fetch this data right now; you can view it on the web.", "Expense category: {name}", "The details are complete; get the form to sign on paper.", "Get a form to sign on paper", "Which one do you mean?", "Do you want to do this?", "Choose the claim to submit.", "This card has expired.", "Prepare a new card", "Something else", "Too many records to search in chat.", "Which supplier do you mean?", "Choose from the latest records.", "What is the amount?", "What is this expense for?", "Please type your request again."

## 11. Impact analysis

| ส่วน | ผลกระทบ | สิ่งที่ต้องทำ |
|---|---|---|
| `pwu` | claim choice/answer/submit/รายละเอียดรายการก่อน intake; `handleWorkflowControl`; Tier 1 ก่อน `tryRouteIntake` (:7007); ทักทายก่อน v2 route; pause allowlist (:6612, :6690); `taskRunId` | `process-line-webhook.use-case.spec.ts` |
| webhook controller | parse postback ใหม่ (`wf_open`, `wf_choice`, `fixed-read`, `chat-action` workflow) | `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` (:96–125) + `line-webhook.controller.spec.ts` |
| message buffer (รอบ 4 F2) | control ใหม่ผ่าน type/command/freeze/replay/`toTextEvent` | `line-message-buffer.service.ts`, `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts`, pwu `LineTextEvent` :236; ตรวจใน `line-message-buffer.service.spec.ts`, `line-message-buffer.logic.spec.ts` (ลงทะเบียนใน `apps/api/package.json`) |
| preview store (E1 ข) | บันทึกกู้คืน `recover:<previewId>` TTL 7 วัน | `line-draft-preview.store.ts`, lea (:588 สร้างการ์ด, :845–880 กด) |
| model admission (Phase C) | Haiku 5.5 ใน `REVIEWED_LINE_MODEL_CAPACITY`; classifier เลือก model เอง (§6.4) | `reviewed-line-model-capacity.ts`, `line-reliability-capabilities.controller.ts:24–37`, `ai-gateway.client.ts:159–175` |
| การ์ด/เมนู | message → postback (CREATE เท่านั้น); ปุ่มเริ่ม; picker; ปุ่มหมดเวลา | `line-staff-menu.logic.ts`, `line-business-card.logic.ts`, `line-reimbursement-draft-card.logic.ts`, `line-expense-action-card.logic.ts` |
| ใบเบิก | `choose` รับ choice ของ CREATE; `startFromWorkflow`; `parseManualClaimLine`; ทาง UPDATE ไม่แตะ | `rda`, `line-ai-classifier.logic.ts` |
| picker | service ใหม่ + ทางอ่าน LINE ใหม่ 2 ทาง | `LineWorkflowTargetService`; `disbursement-voucher.use-case.ts` (`listForLine`); `substitute-receipt.use-case.ts` (`channel: 'line'`) |
| expense/voucher | `wf_open` สำหรับ next/payment/wht + paymentIntent ใน postback (รวม `pa`); guard คำถาม (B2) | `lea`, `line-voucher-action.service.ts` |
| ใบทดแทน (B7, B8) | ข้อความพิมพ์ส่งการ์ดแทนการเตรียม; การ์ด FORM; `apply` ส่ง `confirmedDecision` แทน `messageText: '1'`; หมวดที่ตอบอยู่ใน `acceptedValues` จนกด (เลิกส่ง `expenseCategoryId` ที่ :2000) และเขียนตอน apply; ตัวกันลายเซ็นของ `prepare` เฉพาะ ISSUE (:116) | `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts` (input :1678, `answerIssueDecision` :2189), `line-substitute-receipt-action.service.ts` (:100, :178–203), pwu `rememberSubstituteDeliverySource` (:5863–5877) |
| help card | ทุกรูปเป็น postback `chat-action`; workflow id → Tier 0 | `ai-tools.ts:257–303`, `line-business-card.logic.ts:48–61`, `line-staff-menu.logic.ts:942` |
| gateway | classifier + endpoint; `outputSchema`; **`acceptOutput` ก่อน settle**; router/planner/public lookup/compose/document QA ส่ง `acceptOutput` | ไฟล์ agent ใหม่ 1, `line-ai-internal.controller.ts`, `bedrock.provider.ts`, `anthropic-api.provider.ts`, `openai.provider.ts`, `provider.port.ts`, `abp`, `ira`, `stv2`, `document-qa.use-case.ts` |
| budget authority | kind `webhook_classify` + คอลัมน์ต่อ kind; `serverRoute`; `creditState` | `bas`, `cbr` (read helper) |
| contracts | authorityKind, profile + digest, types | `abb`, `packages/contracts/src/line-ai.ts`, `ai-tools.ts` |
| config | ลบ `LINE_AI_EXACT_GREETING_ENABLED` + getter (`apps/api/src/common/config/app-config.service.ts:129`) | `packages/config/src/index.ts`, `index.test.ts` |
| notification | ปุ่ม `บันทึกจ่ายคืน` บน `workflow.reimbursement_ready_for_payment` | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:551, 656` |
| billing/entitlement | entitlement เดิม; 50 ทวิ เฉพาะ `wht_50bis`; การคิดเงินผลที่ใช้ไม่ได้ลดลง (B6) | — |
| migration | `LineAiTaskRun` + 3 คอลัมน์ (additive) | `apps/api/prisma/schema.prisma` |
| W00 manifest | ไฟล์ที่ hash เปลี่ยน; api intake `line.workflow_control` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts`) | `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + อ่าน diff |
| whole-chain catalog | scenario: `claim-by-buttons-zero-model`, `claim-new-line-deterministic`, `typed-claim-one-classifier-call`, `low-confidence-choice`, `credit-out-mid-claim`, `next-step-after-ten-minutes`, `pending-reason-intervening-question`, `pending-payee-intervening-question`, `greeting-bound-chat-zero-model`, `fixed-read-button-zero-model`, `workflow-button-during-support-pause`, `unusable-output-absorbed`, `document-qa-unusable-absorbed`, `claim-edit-route-unchanged`, `substitute-typed-choice-shows-signed-card`, `partial-payment-next-step-keeps-amount`, `invalid-token-vs-expired-card`, `buffered-workflow-control-survives`, `substitute-category-not-written-before-confirm`, `substitute-issue-then-form-no-signature`, `fixed-read-unavailable-honest`, `expired-card-recovery-after-redis-ttl` | `scripts/line-ai-whole-chain-acceptance.catalog.mjs` |
| eval runtime | ตาม measurement spec §11 | — |
| AgentCore + Kamal | ไม่มี env ใหม่; digest เปลี่ยน → release เดียว (`infra/kamal/release.py:224–226`); semantic turn เปลี่ยนเฉพาะ `acceptOutput` → rebuild artifact; ไม่แตะ `infra/prod-ecs-express/*` (`docs/runbooks/cloud-environment-operations.md:71–134`) | `docs/runbooks/uat-production-v2-deployment.md` |
| journeys/seed | reliability runtime ยิง webhook จริง (`scripts/line-ai-reliability-runtime.ts:237–452`) + seed ของ eval | measurement spec §6.4 |
| เว็บ | ไม่เปลี่ยน | — |

## 12. Gaps

| # | Gap | หลักฐาน |
|---|---|---|
| G1 | ปุ่มเลือกใบเบิกเป็นข้อความ | line-reimbursement-draft-card.logic.ts:303–320 |
| G2 | ปุ่มเลือกแบบ postback ยังผ่าน intake ที่คิดเงิน | pwu:7716–7718 |
| G3 | คำตอบเหตุผลต้องมี grant จาก intake | pwu:5352 |
| G4 | "ส่งอนุมัติ" รอ intake ก่อน | pwu:7005 vs 7022 |
| G5 | ปุ่ม help card จบที่ข้อความ `command` → intake + planner | line-business-card.logic.ts:55, 58–60; line-staff-menu.logic.ts:942 |
| G6 | ปุ่มลัดอ่านข้อมูลคงที่ผ่าน intake | line-staff-menu.logic.ts:146–164; bas:291 |
| G7 | ไม่มีปุ่มบันทึกจ่ายคืนแบบ open token | line-reimbursement-approval-control.logic.ts:4 |
| G8 | ใบเบิกที่ค้างทำต่อด้วยปุ่มไม่ได้เมื่อเครดิตหมด | advisor-system-knowledge spec:246–252; pwu:7015–7019 |
| G9 | ไม่มี identity ของงานที่ทนทานสำหรับรายงานต้นทุน — task identity ข้ามข้อความมีแล้วใน task projection (`deliveryHash(['line-task', …])` pwu:4834, `item.taskRef` :4843, เก็บผ่าน `LineConversationContextService` :2190) แต่ไม่ผูกกับการจอง/usage และ log ต่อ turn มี `costSatang: null` | pwu:4834, 4843, 9352 |
| G10 | router ไม่บังคับ schema | ira:406–407 |
| G11 | การเลือกโมเดลยึด `grant.model` ของ request (classify grant แยก จึงเลือกเองได้ในรอบ C) | `provider.factory.ts:21–29` |
| G12 | สูตร LINE fake บนเครื่องไม่อยู่ใน git | ค้น `docs/` ไม่พบ |
| G13 | ปุ่ม "ทำขั้นตอนถัดไป" จ่าย intake ใหม่ทุกครั้ง ยังไม่วัด | advisor-exam-fix-e.md E1 |
| G14 | tool รายการของ LINE ตัดที่ 10 แถว ไม่มีตัวกรองตาม action | reimbursement-summary.use-case.ts:287, erp-reimbursement-tools.use-case.ts:59, line-counterparty.service.ts:77 |
| G15 | read tool ของใบเตรียมจ่ายใน LINE ผ่านด่าน LINE session ด้วยการตั้ง `authProvider: 'watchdog'` (อ่านอย่างเดียว สิทธิ์ยังตรวจ) — ทาง `listForLine` ใหม่ทำแบบชัดเจนแทน | erp-advisor-document-tools.use-case.ts:15–19; disbursement-voucher.use-case.ts:69–72 |
| G16 | รายละเอียดรายการใหม่ของใบเบิกไม่มีตัวแยกแบบ deterministic | rda:536–545; pwu:5353; rda:198 |
| G17 | ไม่มีรายการ "รายจ่ายที่ทำใบทดแทนได้" ทาง LINE (ของเว็บเรียก `assertWeb`) | substitute-receipt.use-case.ts:474 |

## 13. Bugs ที่พบในโค้ดปัจจุบัน (ยืนยันจากการอ่านโค้ด ยังไม่ได้รัน)

| # | Bug | หลักฐาน | สถานการณ์ที่ล้ม | ความรุนแรง |
|---|---|---|---|---|
| B1 | ปุ่มขั้นถัดไปพึ่งที่เก็บ "applied" อายุ 120 วินาที ช่องเดียวต่อแชต | `line-draft-preview.store.ts:33, 209–225`; lea:243, 845–880 | ยืนยันรายการที่หัก ณ ที่จ่าย 3 นาทีต่อมากด "ทำใบเตรียมจ่าย" → "การ์ดนี้ใช้ไม่ได้แล้วค่ะ…" ต้องพิมพ์ → จ่ายค่าโมเดล | Medium |
| B2 | ช่องที่รอเหตุผล/ที่อยู่ รับคำถามเป็นค่า; ช่องชื่อผู้รับเงินได้คำถามแล้วลบงานค้าง | lea:977–993 (ลบที่ :988); เทียบ rda:195–198 | "ต้องใส่เหตุผลด้วยเหรอคะ" กลายเป็นเหตุผล; "ชื่อใคร?" ทำให้งานหาย | Medium |
| B3 | เลนทักทายไม่ใช้โมเดลไม่ทำงานในแชตส่วนตัว | `packages/config/src/index.ts:24–32`, pwu:9357–9363, 6691, 7007, 7032–7034, 7613 | "สวัสดีค่ะ" → intake + answer | Low |
| B4 | ข้อความปุ่ม/การ์ดหมดอายุเป็นทางตัน | lea:178, 877, 880 | ดู B1 | Low–Medium |
| B5 | ระหว่าง support pause ปุ่มเลือกใบเบิกและปุ่ม `chat-action` ถูกบันทึกเป็นข้อความถึงเจ้าหน้าที่ | pwu:6612–6628 (เทียบ :6596–6604) | ลูกค้าใน pause กด "ไม่มีใบเสร็จ" → ได้ข้อความรับเรื่อง | Low |
| B6 | คำตอบที่ provider ส่งครบแต่ใช้ไม่ได้ (JSON อ่านไม่ออก/ผิด schema/ถูกตัดที่ max_tokens) ของ router, planner, compose **และ document QA** ถูกคิดเงินลูกค้า — settle ก่อนผู้เรียกตรวจผล และ absorb เฉพาะ `ok === false` | abp:429, 459 (settle ใน `finally`); ira:741 (parse หลัง settle); `document-qa.use-case.ts:92–93` (parse หลัง settle) → `QA_RESULT_INVALID` :97, :106; cbr:872, 859–860 | router ตอบ JSON วงเล็บผิด (เคยเกิด 6/8 ใน run 5) → `ROUTER_SEMANTIC_SCHEMA_INVALID` → ลูกค้าจ่ายทั้งครั้งแรกและครั้ง repair แต่ได้ "ยังไม่เข้าใจ" — ขัดกติกา Owner "การเรียก AI ที่ล้มไม่คิดเงินลูกค้า" | Medium (เงิน) |
| B7 | ใบทดแทนที่ข้อมูลครบ (`pendingDecision: 'ISSUE_CONFIRM'`) รับคำตอบพิมพ์ "1"/"2"/คำตอบรับ แล้วแก้รายจ่าย (ยอมรับการตรวจเอกสาร, หลักฐาน SUPPORTING_ONLY) และเตรียมเอกสารที่มีเลขทันทีโดยไม่ผ่านการ์ดที่ลงนาม; การ์ด PREPARE ที่ลงนามเองก็ป้อน `messageText: '1'` เข้า continuation ตัวเดียวกัน จึงแยกการกดการ์ดกับการพิมพ์ไม่ได้ | continuation `issueDecisionChoice` :774–778 (`'2'` → FORM) → :1917 → `answerIssueDecision` :2189 → `prepareFromLine` :2289, :2346 → `this.prepare.execute` :2394; การ์ด `line-substitute-receipt-action.service.ts:203` | ข้อความ "2" ที่ไปถึง continuation (route ความหมาย pwu:7843–7844 หรือทาง clarification pwu:7438–7440) → เอกสารถูกเตรียมพร้อมเลขโดยผู้ใช้ไม่เห็นการ์ดยืนยัน — ขัด R4; ทางที่ไปถึงในแต่ละสถานะพิสูจน์ด้วย test ที่ล้มก่อนแก้ (§17.1 MC9) | High (เขียนโดยไม่ยืนยัน) |
| B8 | ใบทดแทน: คำตอบช่องหมวดค่าใช้จ่ายระหว่างเก็บข้อมูลเขียน `ExpenseRecord.expenseCategoryId` ทันที (ใน CAS เดียวกับสถานะ continuation) ก่อนมีการ์ดยืนยัน และข้อความตอบว่า "หมวดค่าใช้จ่ายบันทึกลงรายการให้แล้ว" | continuation :1992–2001 (`expenseCategoryId: acceptedNow.expenseCategoryId` :2000) → `saveLineSubstituteContinuation` (`prisma-expense.repository.ts:4312`); ข้อความ :1266–1268, อังกฤษ :1315–1317 | ตอบ "หมวด: ค่าเดินทาง" แล้วเลิกทำ → หมวดของรายจ่ายถูกเปลี่ยนโดยไม่เคยยืนยัน — ขัด R4 | High (เขียนโดยไม่ยืนยัน) |

## 14. Test plan

assertion ใหม่ของ API ทั้งหมดอยู่ในไฟล์ที่ลงทะเบียนใน `apps/api/package.json` แล้ว (ไม่สร้างไฟล์ ไม่แก้ scripts):
- `process-line-webhook.use-case.spec.ts`: ลำดับ Tier 0/1/2; ปุ่มไม่สร้าง reservation; ตัวแยกรายละเอียดรายการใหม่ (ยอดเดียว/หลายยอด/ไม่มีรายละเอียด/วันที่ไม่มีปี); คำตอบช่องก่อน intake; ทักทาย 0 call; credit-out mid-claim ตาม Q1; ปุ่มหมดเวลา; support pause; การ์ด §7.2.1 ทั้งสี่แถว; "อย่างอื่น" ได้ admission ใหม่และปฏิเสธเมื่อวันที่เปลี่ยน; การ์ดใบเบิก CREATE เป็น postback และ UPDATE/TARGET เหมือนเดิมทุก byte (P19); `wf_open` ของ VOUCHER_SUBMIT/APPROVE/PAY และ RECORD_PAYMENT พร้อม `pm/pd`; delivery plan รับ action ใหม่; adapter `choose`/`startFromWorkflow` (mock repo)
- `line-staff-menu.logic.spec.ts`, `line-business-card.logic.spec.ts`, `line-ai-classifier.spec.ts` (`isPendingFieldAnswer` ไม่ปฏิเสธที่อยู่ที่มีตัวเลข, `parseManualClaimLine`), `line-webhook.controller.spec.ts`
- B7: `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` (ลงทะเบียนใน `apps/api/package.json` และใช้ `LineSubstituteReceiptActionService` อยู่แล้ว) + `process-line-webhook.use-case.spec.ts` — พิมพ์ "1"/"2"/"ได้เลย" ขณะ `ISSUE_CONFIRM` → การ์ดที่ลงนาม ไม่มีการแก้คอลัมน์ธุรกิจของ `ExpenseRecord` และไม่สร้าง evidence; กดการ์ด → เตรียม 1 ครั้ง; token ของ ISSUE ใช้กับ FORM ไม่ได้ (`line-substitute-receipt-continuation.use-case.spec.ts` ไม่อยู่ใน `apps/api/package.json` แม้ catalog เรียกบางชื่อ — ไม่ใช้เป็นที่อยู่ของ assertion ใหม่)
- `process-line-webhook.use-case.spec.ts` เพิ่ม: `wf_open` ที่มี `pa` (จ่ายบางส่วน) ได้ยอดเดิม; `second_label` ซ้ำ; E1 (ก)/(ข) ได้ข้อความตามตาราง §10 รวมกรณี preview ใน Redis หายแต่มีบันทึกกู้คืน; picker รายจ่าย (P11): `pageSize: 100`, ค้างจ่ายอายุ > 90 วันอยู่ในผล, Σ `total` > 300 → ข้อความค้นไม่ครบ; `fixed-read` ทั้งสองผล (prepared รับ / `PREPARED_READ_UNAVAILABLE`)
- B8 + A10 ใน `substitute-receipt.use-case.spec.ts`: ตอบหมวดระหว่างเก็บข้อมูล → `ExpenseRecord.expenseCategoryId` ไม่เปลี่ยน และ blocker หมวดหายเพราะค่าใน `acceptedValues` (:552); กดการ์ด → หมวดถูกเขียนก่อน review ใน apply ครั้งเดียว; ISSUE ที่ขอลายเซ็นแล้วพิมพ์ "2" → ได้การ์ด FORM ไม่ถูกขอลายเซ็น
- buffer (F2) ใน `line-message-buffer.service.spec.ts` + `line-message-buffer.logic.spec.ts`: `workflowControl`/`workflowStart`/`fixedReadControl` เป็น command, อยู่ใน payload ที่ freeze, รอด sweep replay และถึง `processWebhook.execute` ครบ
- `internal-tools.controller.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts`, `reimbursement-request.use-case.spec.ts`: picker ตาม scope, assignment ตรึง, `exhaustive`, ผู้สร้างที่ไม่มี read scope เห็นเฉพาะของตัวเอง
- `ai-gateway.client.spec.ts`, `line-intake-dispatch.use-case.spec.ts`: client classifier, turn grant เหมือนเดิมทุก byte
- **PostgreSQL จริง** ใน `company-ai-usage-meter.spec.ts` (ลงทะเบียนใน `apps/api/package.json` และมีแบบทดสอบ "real PostgreSQL:" ที่ใช้ `DATABASE_URL` อยู่แล้ว — `company-ai-usage-meter.spec.ts:262–268`) รันด้วย `scripts/local-proof/realpg.sh <tag> src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (realpg.sh ตั้ง `DATABASE_URL`): classify authority แยกคอลัมน์และไม่กระทบ turn; เรียกได้ครั้งเดียว; usage `ok:false` = COMPANY_ABSORBED; narrow ordinal 0 เฉพาะ `fixed_read`; `creditState` ไม่เขียนแถว; settle ครั้งที่สองเป็น `'duplicate'` — ไฟล์ PG ใน catalog (`line-ai-budget-authority.pg.spec.ts` ฯลฯ) ยังรันเป็น regression เดิม แต่ไม่ใช่ที่อยู่ของ assertion ใหม่
- **Gateway** (ลงทะเบียนใน `apps/ai-gateway/package.json`): `bedrock.provider.spec.ts`; `ai-usage.interceptor.spec.ts` (`acceptOutput` false/`output_limit` → entries `ok:false` ก่อน settle; schema ใน digest); `line-intake-router.agent.spec.ts` (classifier + router ส่ง `acceptOutput`); `line-ai-internal.controller.spec.ts`; document QA: `ai-usage.interceptor.spec.ts` กับ profile `document-qa/2` และ `line-ai-internal.controller.spec.ts` route `line-document-qa` (ผลไม่ผ่าน `resultCovers` → failed + usage `ok:false`)
- **Live replay ก่อนเรียกว่า "เสร็จ"**: ชุด workflow ของ measurement spec ผ่าน reliability runtime ที่ยิง `LineWebhookController` จริง + gateway จริง + โมเดลจริง
- **เครื่องจริง:** proof/UAT ตาม runbook; รายงานว่ากดอะไร/ไม่ได้กดอะไร
- typecheck + boot + spec ที่แตะ + whole-chain (คำสั่ง Owner 2026-09-21); ไม่ trigger GitHub Actions

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| AC1 | journey ปุ่มล้วน: `สร้างใบเบิก` → `รายการใหม่` → พิมพ์ "ค่าแท็กซี่ 250 บาท เมื่อวาน" → ไม่มีใบเสร็จ → หมวด → เหตุผล → ยืนยัน (งาน 1) → `ส่งอนุมัติ` → ยืนยัน (งาน 2) | 0 แถว `AiBudgetReservation`; บรรทัดใบเบิก รายละเอียด "ค่าแท็กซี่" ยอด 250.00 วันที่เมื่อวาน (กรุงเทพ); งาน 1 `resultId` = งาน 2 `sourceId`; ใบเบิก PENDING_APPROVAL |
| AC2 | พิมพ์ "เบิกค่าแท็กซี่ 250 บาท เมื่อวาน" (ไม่มีงานค้าง) | ทั้งงาน 1 การเรียก (`line.workflow-classify`); ร่างมีบรรทัดเดียวกับ AC1; ถามเฉพาะที่ขาด |
| AC3 | "อนุมัติใบเบิกของสมชาย" (มีสิทธิ์ / assignment ตรึง) — 1 / 2 / 0 (≤ 300) / > 300 ใบ | การ์ด / ปุ่ม 2 ใบ / "ไม่พบใบเบิกของสมชายที่รอคุณอนุมัติค่ะ" / "มีรายการมากเกินจะค้นในแชตค่ะ" |
| AC4 | ข้อความกำกวม — ทั้งสี่แถวของ §7.2.1 | การ์ดตามตาราง; กดตัวเลือก 0 call เพิ่ม; `อย่างอื่น` = Tier 2 ด้วยข้อความเดิมและ deadline ใหม่ |
| AC5 | คำถามเปิด/อ่าน (advisor held-out) | A2 ≥ 90%, A3 ≥ baseline; turn grant/slot เหมือนเดิม |
| AC6 | เครดิตหมดกลางใบเบิก (ถ้า Q1 ตามข้อเสนอ) | ปุ่ม/คำตอบช่อง/ยืนยัน 0 reservation; ข้อความพิมพ์ใหม่ได้การ์ดเครดิตเดิม |
| AC7 | "สวัสดีค่ะ" ไม่มีงานค้าง | 0 call; ไม่มีสวิตช์ทักทายในโค้ด |
| AC8 | ปุ่ม `ค่าใช้จ่ายเดือนนี้` (และทุก id ใน `FIXED_READ`) | 0 call ทุกกรณี; prepared ปฏิเสธ → ข้อความ §10 + ปุ่มเว็บของ id นั้น; id ที่ไม่มี prepared family คงเป็น message action (Tier 2 เดิม) |
| AC9 | B1/B4 — รวม VOUCHER_SUBMIT → APPROVE → PAY และบันทึกจ่ายที่มีวิธีจ่ายเดิม | กดหลัง 30 นาทีได้การ์ดถัดไปพร้อมวิธีจ่าย/วันที่/ยอดเดิม (จ่ายบางส่วน 400 จาก 1,000 → การ์ดใหม่ 400 ไม่ใช่ 1,000); การ์ดหมดเวลา → ปุ่มเตรียมใหม่ 0 call |
| AC10 | B2 | คำถามไม่ถูกจับเป็นค่า ไม่ลบงานค้าง; ชื่อที่พิมพ์ต่อเติมงานเดิม |
| AC11 | สิทธิ์ | ไม่มีทางอนุญาต → คำปฏิเสธเดิม; ผู้สร้างที่มี `expense.create` + `expense.update` แต่ไม่มีสิทธิ์อ่าน: picker เห็นเฉพาะร่างของตัวเอง และลบ/ส่งตรวจได้ (ถ้า MC1 อนุมัติ); token ข้ามคน/บริษัท/สาขาถูกปฏิเสธ |
| AC12 | B5 | ระหว่าง support pause ปุ่ม workflow ทำงาน |
| AC13 | held-out ของ measurement spec | ตาม MA3 |
| AC14 | เวลา | Tier 0 p50 ≤ 1.5 วิ p95 ≤ 3 วิ; Tier 1 ที่เริ่ม workflow p50 ≤ 3.5 วิ p95 ≤ 6 วิ ไม่มี > 15 วิ; ข้อความที่ fallback ไป Tier 2 ตาม A7 (full path p95 ≤ 15 วิ, ไม่มี > 30 วิ) โดยเวลาของ classifier รวมอยู่ด้วย และไม่เกิน deadline เดิมของ turn |
| AC15 | schema | probe ผ่าน; output ใช้ไม่ได้ = 0 ใน held-out |
| AC16 | B6 | router/planner/public lookup/compose/document QA/classifier ที่ได้ผลใช้ไม่ได้: `customerChargedSatang = 0`, `companyAbsorbedSatang` = ต้นทุน, ตัวนับโทเคนครบ |
| AC17 | ใบเตรียมจ่าย/50 ทวิ/ใบทดแทน จาก LINE | picker ใช้ `listForLine`/candidates `channel: 'line'`; ผู้ไม่มีสิทธิ์อ่านไม่เห็นรายการ; ไม่มีทางเขียนใหม่ |
| AC18 | ทางแก้ใบเบิกเดิม | การ์ด/ข้อความของ action UPDATE เหมือน baseline ทุก byte; journey แก้ใบเบิกในชุดทดสอบผ่านเท่าเดิม |
| AC19 | ปล่อยงาน | W00 regenerate + อ่าน diff; whole-chain ผ่าน; realpg ผ่าน; live replay ผ่าน; ข้อความใหม่ผ่านตัวตรวจบุคลิก |
| AC20 | B7 | พิมพ์ "1"/"2"/"ได้เลย" ขณะใบทดแทนรอเลือก → การ์ดที่ลงนาม 1 ใบ; ไม่มีแถว `ExpenseSubstituteReceiptEvidence` ใหม่ และคอลัมน์ธุรกิจของ `ExpenseRecord` (รวม `expenseCategoryId`) ไม่เปลี่ยน **ตลอดทุก turn ของการเก็บข้อมูล** จนกว่าจะกด; กดแล้วเขียนหมวด + เตรียม 1 ครั้ง; ISSUE → FORM ไม่ถูกขอลายเซ็น |
| AC21 | E1 | token ปลอม/ข้ามคน/ใช้แล้ว → ข้อความเดิม lea:178 ไม่มีปุ่มอ้างเป้าหมาย; การ์ดที่เก็บไว้เลย `expiresAt` → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่`; ไม่มีกรณีที่บอก "หมดเวลา" โดยพิสูจน์เวลาไม่ได้; preview ใน Redis หายหลัง 600 วินาทีแต่มีบันทึกกู้คืน → ปุ่ม `เตรียมการ์ดใหม่` ได้ preview ใหม่ 0 call |
| AC22 | control ผ่าน buffer (F2) | กดปุ่ม `wf_open`/`wf_choice`/`chat-action` workflow/`fixed-read` ระหว่างที่ buffer มีข้อความค้าง และหลัง process ตายแล้ว sweep replay → handler ได้ control ครบทุกครั้ง; ไม่มีกรณีกดแล้วเงียบ; **ลำดับ**: ระหว่าง turn ที่กำลังทำงาน ส่ง `/company B` แล้วกดปุ่มอ่านคงที่ → ปุ่มถูกประมวลผลหลังการสลับ ได้ข้อมูลของบริษัท B (หรือคำปฏิเสธสิทธิ์ของ B) ไม่มีข้อมูลของบริษัท A |
| AC23 | picker รายจ่าย (P11) | เป้าหมายค้างจ่ายที่อายุ > 90 วันถูกเสนอ; "ไม่พบ" เฉพาะเมื่อ Σ `total` ≤ 300 และอ่านครบ |

## 16. Risks/rollout

- schema enforcement เป็นเงื่อนไขปล่อย Tier 1 (probe; ไม่ได้ทั้งสองทาง = ไม่ปล่อย Tier 1)
- grammar compile หลังหมดอายุอาจนานหลายนาที → timeout 4 วินาที → Tier 2 (absorbed); W14 ใน telemetry
- classifier ผิด → ได้ตัวเลือก/preview ไม่มีการเขียน (R4)
- ข้อความเปิดเสีย classifier ~0.10–0.39 บาทและ ≤ 4 วินาที → ประตู W13
- B6 fix ลดรายได้เครดิตจากการเรียกที่ล้ม (ตามกติกา Owner) — แจ้งในสรุป release
- action ใบเบิกที่ workflow เปิด ถ้าผู้ใช้พิมพ์งานใบเบิกอื่นไปทาง Tier 2 ระหว่างนั้น planner เดิมจะได้ `FINANCIAL_ACTION_SELECTION_REQUIRED` (rda:369–370) — ยอมรับ; workflow ทำต่อ action เดิมด้วยปุ่ม
- ปุ่มเก่าแบบข้อความในประวัติแชต → parser รับ label เดิม (R3)
- ปุ่ม workflow/อ่านคงที่ที่กดระหว่าง turn ที่กำลังทำงานจะรอ turn นั้นจบตามลำดับ (R4-F2) — AC14 วัดเวลาจากตอน chat idle
- B7 fix เปลี่ยนพฤติกรรมเดิม: คนที่เคยพิมพ์ "1" แล้วได้เอกสารทันที ต้องกดการ์ดอีกหนึ่งครั้ง (ตาม R4)
- digest เปลี่ยน → release เดียว; rollback ทั้งชุด; migration additive
- Rollout: Phase A → Phase B; proof stack → UAT ตาม runbook → Owner เดินจริง → Production เมื่อ Owner สั่ง; ไม่มีสวิตช์

## 17. Open questions (เรื่องเงิน/ธุรกิจของ Owner เท่านั้น)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | ขั้นที่ไม่เรียก AI คิดเครดิตไหม และถ้าเครดิตหมดระหว่างงาน ให้ทำต่อจนจบไหม | **ไม่คิด และให้ทำต่อจนจบ**; ข้อความพิมพ์ใหม่ยังเจอการ์ดเครดิตหมด |
| Q2 | ถ้าผลวัดผ่าน MA4 ให้ย้าย Tier 1 ไป Haiku 5.5 แบบ Global ได้เลยไหม | **ได้เลยเมื่อผ่านเกณฑ์** — Tier 2/OCR ยังเป็น Sonnet |
| Q3 | งบวัดผลทั้งโปรแกรม | measurement spec §17 (แนะนำ 2,000 บาท) |

### 17.1 Must close before coding

| # | เรื่อง | ใครปิด | ขั้นถัดไป/คำแนะนำ |
|---|---|---|---|
| MC1 | ผู้สร้างที่ไม่มีสิทธิ์อ่านรายการ (มีแค่ `expense.create`/`expense.update`) เห็น picker ของรายการตัวเองใน LINE ได้ไหม (กติกาสิทธิ์) | Owner | แนะนำ **ได้** — ตรงกับที่ `permitted` ให้ผู้สร้างลบ/ส่งตรวจของตัวเองอยู่แล้ว (lea:1010–1011) |
| MC2 | เปิดทางอ่านใน LINE ของรายการใบเตรียมจ่าย (`lineConfirmed` ฝั่ง read) และรายการที่ทำใบทดแทนได้ (ข้าม `assertWeb` ฝั่ง read) | Controller (security review) | แนะนำเปิดเฉพาะการอ่าน + ตรวจสิทธิ์เดิม + test ว่าทางเขียนยังปิด |
| MC3 | Sonnet 4.6 บน Converse รองรับ structured outputs หรือไม่ | Controller | probe (plan B1) ก่อน B2 |
| MC4 | SDK 3.1075.0 มี type `outputConfig` หรือไม่ | Lane B1 | ตรวจใน node_modules; ไม่มี → อัปเดต dependency |
| MC5 | ชื่อพารามิเตอร์ปิด thinking/effort ของ Haiku 5.5 ใน `additionalModelRequestFields` ของ Converse (Messages API ใช้ `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }`) | Lane C2 | probe 1 ครั้งบน UAT ตาม runbook; ไม่ผ่าน → ไม่เริ่ม Phase C |
| MC6 | งาน purge ที่ต้องลบ `LineAiTaskRun` ด้วย | Lane A7 | ค้น sweep ของ `LineWebhookEventLog` |
| MC7 | สูตร attempt key ของรูป/OCR สำหรับรายงานต้นทุน | Lane M1c | ไล่ทุกสูตรแล้วบันทึก |
| MC8 | ขอบเขตของ B6 fix ใน planner/compose (stv2) ต้อง rebuild AgentCore | Controller | ทำใน A9 พร้อม Phase A release |
| MC9 | ทางที่ข้อความพิมพ์ไปถึง continuation ใบทดแทนในแต่ละสถานะ (route ความหมาย pwu:7843 / clarification pwu:7438–7440) — B7 | Lane A10 (ก่อนแก้โค้ดของ A10) | เขียน test ที่ล้มบน baseline ก่อน แล้วบันทึกทางที่พบใน memory |
| MC10 | ค่า context/output ของ Haiku 5.5 สำหรับ `REVIEWED_LINE_MODEL_CAPACITY` (ceiling 100,000 ให้ตรง tariff ≤ 100k prompt) | Lane C1 | อ่าน AWS model card แล้วบันทึก URL/วันที่ในคอมเมนต์แบบแถวของ Sonnet |
| MC11 | id ของ `FIXED_READ` ที่มี prepared family จริง | Lane A6b | ไล่ `QUERY_ACTIONS` กับ `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` แล้วบันทึก |

### 17.2 Unreviewed fixes from round 4 — BLOCKERS

focused check 2026-10-24: **R4-F1 ปิดแล้ว** (เลื่อนการเขียนหมวดไปตอนกดการ์ด — A10 เริ่มได้); **R4-F2 = ออกแบบแล้ว รอรีวิวก่อนเริ่ม Phase A2** (การตรวจพบว่าการจัดเป็น command ทำให้ control ใหม่เข้าทางลัดที่ข้ามคิว — แก้เป็นการส่งตามลำดับด้านล่าง)

| # | สถานการณ์ที่ล้มวันนี้ | การแก้ที่ออกแบบ | ประตูรีวิว |
|---|---|---|---|
| R4-F1 (B8) — **CLOSED** | ใบทดแทนที่ยังเก็บข้อมูล: น้องมั่งมีถามหมวด → ผู้ใช้ตอบ "หมวด: ค่าเดินทาง" → `saveLineSubstituteContinuation` เขียน `ExpenseRecord.expenseCategoryId` ทันที (continuation :2000 → `prisma-expense.repository.ts:4312`) → ผู้ใช้เลิกทำ → หมวดของรายจ่ายเปลี่ยนไปแล้วโดยไม่มีการ์ดยืนยัน | หมวดเก็บใน `acceptedValues.expenseCategoryId` เท่านั้น (เลิกส่ง field นี้ที่ :2000); blocker/คุณสมบัติประเมินจากค่าที่เสนอ (มีอยู่แล้วที่ :552 — ตรวจที่อื่นที่อ่านหมวดจากแถวให้ใช้ `{ ...expense, expenseCategoryId: proposed }`); การ์ด PREPARE/FORM แสดงหมวด; `apply` → `prepareFromLine` เขียนหมวดด้วย CAS ก่อน `review.execute` (:2367) ในการกดครั้งเดียว; ข้อความตอบใช้รุ่น "(ยังไม่แก้รายการ)" (§10) | ผู้ตรวจยืนยัน: (1) ไม่มีทางอื่นในระหว่างเก็บข้อมูลที่เขียนคอลัมน์ธุรกิจของ `ExpenseRecord`; (2) ทุกจุดที่อ่านหมวดจากแถวก่อนยืนยันใช้ค่าที่เสนอ; (3) AC20 ครอบทุก turn ของการเก็บข้อมูล; (4) test ใน `substitute-receipt.use-case.spec.ts` ล้มบน baseline และผ่านหลังแก้ |
| R4-F2 — **designed, needs review before Phase A2** | (ก) ผู้ใช้ส่งข้อความแล้วกดปุ่ม `wf_open`/`fixed-read` ทันที (หรือ process ตายแล้ว sweep replay): buffer สร้าง event จากข้อความสุดท้ายโดยคัดลอกเฉพาะ control เดิม (`line-message-buffer.service.ts:1061, 1090`) → control ใหม่หาย; (ข) ถ้าแค่จัดเป็น command: ระหว่าง turn ที่กำลังทำงาน `/company B` เข้าคิว แต่ปุ่มอ่านคงที่ที่กดตามมาเข้าทางลัด (:510–511) แซงไปก่อน → ได้ข้อมูลการเงินของบริษัท A หลังผู้ใช้สลับเป็น B | เพิ่ม control ใหม่ทั้งสามใน type (:60–75, logic :25, pwu :236), payload ที่ freeze (:1051–1065), sweep replay (:383–398), `toTextEvent` (:1086–1091); จัดเป็น command (:475) ให้แยกเป็น group เดี่ยว แต่**ตัดออกจากทางลัด** :510–511 — idle → ทาง idle (:500–504), ไม่ idle → `state.open` + `flushOpen` (:541) ต่อคิว worker ตามลำดับ — §7.1 | ผู้ตรวจยืนยัน: (1) ไม่มีจุดอื่นที่สร้าง `LineTextEvent` จาก buffer โดยไม่ผ่านรายการนี้; (2) item ที่มี control ไม่ถูกรวมกับข้อความอื่น และไม่ถูกส่งก่อน batch ที่รออยู่; (3) AC22 รวม "/company B แล้วกดปุ่มอ่านคงที่ระหว่าง turn ที่กำลังทำงาน" + test ใน `line-message-buffer.service.spec.ts`/`line-message-buffer.logic.spec.ts` ล้มบน baseline และผ่านหลังแก้ |
