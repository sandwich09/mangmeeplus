# LINE AI Workflow-First Spec — งานซ้ำเดินตามขั้นตอน, AI แยกงานครั้งเดียว

Status: DRAFT — documents only; R4-F2 CLOSED (focused review 2026-10-26); owner Q1–Q3 answered 2026-11-04; MC1 CLOSED (existing R21/AC11 design); A9/A10 moved to expense-trust-and-money-fixes; per-step engineering prerequisites remain; Re-anchored to develop e7c422802 on 2026-11-04; controller accepted 2026-11-04 (R26 package/knowledge fallback and R27 free no-AI admission checked against code); owner answers recorded 2026-11-04
Owner: LINE AI documents lane; controller assigns implementation after the documents round
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ค 16–24), `docs/specs/line-ai-measurement-and-eval-spec.md`, `docs/plans/line-ai-workflow-first-plan.md`, `docs/agent-memory/line-ai-workflow-first.md`, `docs/specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md`, `docs/specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md` (เส้นทางไม่ใช้โมเดลที่ถอนออก 2026-10-05), `docs/specs/line-ai-credit-levers-20261019.md`, `docs/specs/mangmee-ai-expense-advisor-spec-th.md`, `docs/specs/mangmee-brain-answer-architecture-assessment.md`
Baseline: HEAD `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, re-opened in this worktree 2026-11-04; earlier measurements and review dates remain historical

ความคิดของ Owner (2026-10-23, คำต่อคำ): "อันไหนที่ทำซ้ำอันนั้นควรมี workflow แล้ว ai classifier แม่นและเรียกแค่ tools เดียวแล้ว workflow วิ่งต่อ เช่นใบเบิก ใบทดแทน หรืออื่นๆ ที่เป็นงานที่ระบุได้ว่าซ้ำกันแน่นอน"
เป้าหมาย: คนที่ไม่รู้บัญชีทำรายจ่ายได้ง่ายขึ้น ต้นทุน AI ต่อ **งานที่เสร็จ** ลดลง และไม่มีการทำรายการผิด

อักษรย่อ: `pwu` = `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`, `stv2` = `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts`, `ira` = `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`, `lea` = `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`, `rda` = `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts`, `bas` = `apps/api/src/modules/line-ai/application/line-ai-budget-authority.service.ts`, `abb` = `packages/contracts/src/ai-budget-bounds.ts`, `abp` = `apps/ai-gateway/src/common/usage/ai-budget-provider.ts`, `cbr` = `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts`

---

## 1. ปัญหา

### 1.1 สิ่งที่ไม่เรียก AI อยู่แล้ว (ยืนยันจากโค้ด)

| ข้อความเข้า | ทาง | หลักฐาน |
|---|---|---|
| คำสั่งสาธารณะจากเมนู (พนักงาน, ติดต่อเจ้าหน้าที่, คุยกับ AI ต่อ, โปรโมชัน, นโยบายทดลองใช้) | การ์ดที่โค้ดสร้าง ก่อนอ่านตัวตน | pwu:6468–6530 |
| เลือกร้าน `/companies`, ซื้อแพ็กเกจ | deterministic | pwu:6662–6670 |
| ปุ่มยืนยันคู่ค้า, ปุ่มการ์ดรายการ (`expense_action_*`) | postback ที่มี token | pwu:6717–6742, 3671–3756 |
| คำตอบช่องที่การ์ดรายการถามค้าง (เหตุผล, ผู้รับเงิน, วิธีจ่าย), ช่องทีมงาน, ใบทดแทนที่ค้างลายเซ็น, หลักฐาน, หมวด | ตัวจับคำตอบก่อน intake | pwu:6747–6812, lea:977–993 |
| ปุ่มยืนยัน/ยกเลิกร่างใบเบิก | deterministic | pwu:6813–6820, 5418–5450 |
| เมนูหลัก/ถามข้อมูล/รายการรออนุมัติ/ถ่ายใบเสร็จ/บริการของเรา | การ์ดที่โค้ดสร้าง | pwu:6820–6881, 6984–7018 |
| "จ่ายแล้ว/โอนแล้ว" หลังรายการที่เพิ่งเห็น; พิมพ์ยอดอย่างเดียว **เฉพาะ** เมื่อเป้าหมายมีรายการเดียวและรายการนั้นจ่ายครบแล้ว (ยอดหลังรายการที่ยังไม่จ่าย/ร่าง หรือหลายรายการ → ตกไป intake ที่คิดเงิน) | regex ก่อน intake | pwu:3758–3793 (ยอดอย่างเดียว :3772–3779; `paidExpenseReply` คืนค่าเฉพาะรายการ PAID lea:92–93) เรียกที่ :7005 |
| คำตอบงานค้างของรูป: "ใช่ใบเสร็จ" (สร้างร่างจากไฟล์ที่เก็บไว้), เลขข้อ, ตรวจบิล, สแกนใบทดแทน; คำตอบร่างรายจ่าย | `answersOpenWork` ข้าม intake ช่วงต้น | pwu:6086–6110, 7141–7164 |
| ปุ่มอนุมัติ/ไม่อนุมัติ/ส่งอนุมัติจากแจ้งเตือนใบเบิก | open token ลงนาม → การ์ดยืนยัน | `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts:5–17`, lea:842–846 |
| ปุ่มขั้นถัดไปหลังกดยืนยัน (ทำใบเตรียมจ่าย → ส่ง → อนุมัติ → จ่าย → ออก 50 ทวิ, บันทึกจ่าย) ภายใน 120 วินาที | `expense_action_next/payment/wht` | lea:858–875, 936–944 (ดู B1) |

ข้อยกเว้นที่ยังจ่ายเงินแม้อยู่ในงานค้าง: คำตอบ "เป็นภาพประกอบ" ของรูปที่พักไว้ — ใช้คำบรรยายรูปเดิมแล้วไปถึง intake ภายหลัง (pwu:7166–7179 → :7690)

### 1.2 สิ่งที่ยังจ่ายค่าโมเดล (ยืนยันจากโค้ด)

| ข้อความเข้า | สิ่งที่เกิด | หลักฐาน |
|---|---|---|
| ข้อความพิมพ์อิสระในแชตส่วนตัว | intake router (Sonnet) ที่ pwu:7050 ก่อน handler ส่วนใหญ่ของ v2 (ยกเว้น `answersOpenWork` และ "จ่ายแล้ว") | pwu:7045–7050; แชตส่วนตัวผูก v2 โดยค่าตั้งต้น (`packages/config/src/index.ts:24–32`, pwu:9400–9406, 6715) |
| ปุ่มลัดแบบ message เช่น "ยอดขายวันนี้" ("ดูยอดขายวันนี้"), "ค่าใช้จ่ายเดือนนี้" | ส่งเป็นข้อความ → intake | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:147–165` |
| ปุ่มวิธีใช้ (help card): กรณีเดียวภาษาไทยที่ไม่ใช่เมนูเป็น message action ส่ง `command`; กรณีอื่นเป็น postback `chat-action` ที่ถูกแปลงกลับเป็นข้อความ `command` | ทั้งสองแบบเข้า intake + planner | `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts:55, 58–60`; `line-staff-menu.logic.ts:957`; `packages/contracts/src/ai-tools.ts:257` |
| ปุ่มเลือกในใบเบิกแบบ postback (ส่งรูป/ไม่มีใบเสร็จ/หมวด) | ผ่าน intake ที่คิดเงินก่อน แล้วจึงทำ proposal แบบ deterministic | pwu:7759–7778 |
| ปุ่มเลือก สาขา/ผู้ขอเบิก/ใบเบิกที่จะแก้/บิลที่จะเบิก/"รายการใหม่" | **message action** → intake + planner ต้องแปลข้อความกลับเป็น choiceId | `line-reimbursement-draft-card.logic.ts:303–320`, `line-business-card.logic.ts:41–46` |
| ปุ่ม "ใช้บิลนี้ทำใบเบิก" บนการ์ดใบเสร็จ | message action → intake + planner | pwu:10810–10817 |
| คำตอบคำถามของใบเบิก (เหตุผล/วัตถุประสงค์) | ต้องมี grant จาก intake และต้องไม่มีจำนวนเงินในข้อความ | pwu:5370–5400 (:5376 grant, :5377 `candidates?.amounts.length === 0`); rda:189–198 |
| รายละเอียดรายการใหม่ของใบเบิก ("ค่าแท็กซี่ 250 บาท เมื่อวาน") | ไม่มีตัวแยกแบบ deterministic — บรรทัดแรกมาจาก `reimbursementHints` ของ intake (rda:536–545) หรือ planner | rda:536–545; stv2:89 ("first get_options, then preview_create a manual ADD line") |
| "ส่งอนุมัติ/ส่งเลย/ยื่นเลย" | regex ตัดสินเอง แต่ทำหลัง intake ROUTED | pwu:3795–3817 เรียกที่ :7065, :7709 |
| คำทักทาย "สวัสดี" | ในแชตส่วนตัวไปถึง intake ก่อนเลนทักทาย (B3); สวิตช์ `LINE_AI_EXACT_GREETING_ENABLED` ค่าตั้งต้น false (`packages/config/src/index.ts:326`) | pwu:7050, 7075–7077, 7656 |
| คำถามวิธีใช้ของผู้ใช้ที่ผูกบัญชีแล้ว | turn ปกติ | pwu:6540–6557 |
| ปุ่ม "ทำขั้นตอนถัดไป" ของงานหลายข้อ (ตั้งแต่ fix-e 2026-10-17) | message action → metered intake; separate from signed `expense_action_next` | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:4812–4834,7050`; `docs/agent-memory/advisor-exam-fix-e.md:8` |

### 1.3 งานซ้ำที่โมเดลยังต้อง "คิดเอง" จากพรอมต์

- เริ่ม/แก้ใบเบิก, ใบเตรียมจ่าย, 50 ทวิ, ส่งตรวจ/ยืนยัน/ลบร่าง/ยกเลิก/บันทึกจ่ายรายการ, อนุมัติ/ไม่อนุมัติ/จ่ายคืนใบเบิก เขียนเป็นร้อยแก้วใน `CONTROL_PROMPT` บรรทัดเดียว (stv2:89)
- planner วนได้ 2 รอบ (stv2:723) maxTokens 2,048 (stv2:738) ส่งรายการ tool ที่เสนอทั้งหมดใน user message JSON (stv2:754) ซึ่งไม่ใช่จุด cache (`apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts:42–43, 284–296`); registry มี 85 operation (counted in `packages/contracts/src/ai-tools.ts:387`; historical manifest: `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`)
- งานเขียนที่ได้ preview ข้ามขั้นแต่งคำตอบ (stv2:1170–1177): งานเขียนที่พิมพ์มา = intake 1 + planner 1–2
- ปุ่มยืนยันเป็นขั้นตอนตายตัว (pwu:3671–3756)

### 1.4 ตัวแยกงาน (intake router) และขอบเขตการคิดเงิน วันนี้

- บังคับรูปแบบด้วยพรอมต์ (ira:406–407); `ProviderInput` ปัจจุบันยังไม่มี schema field (`apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts:6–26`)
- maxTokens 4,096 ข้อความ / 8,000 รูป (ira:737, :48); repair 1 ครั้งเฉพาะข้อความ v2 (ira:711)
- ความมั่นใจ < 0.6 กับ intent ที่ลงมือ → CLARIFY (ira:557–558, 787–828)
- มี calibration ของส่วนคงที่ 66,609 และ 61,057 ไบต์ ทั้งคู่กันไว้ 26,681 โทเคน (`apps/ai-gateway/src/common/usage/intake-token-calibration.ts:9–16`); เป็นแถวที่รับรองไว้ ไม่ใช่ผลวัดต้นทุนใหม่
- เคยพังจาก JSON ที่ไม่บังคับ schema: วงเล็บผิด 6/8, quote ไม่ escape 2/8 (`docs/agent-memory/mangmee-ai-expense-advisor-2026-09-27.md` run 5)
- **การ settle เงินเกิดทันทีหลัง provider ตอบ ก่อนผู้เรียกตรวจผล**: `settleV2` อยู่ใน `finally` ของ budget wrapper (เรียก provider ที่ abp:429, settle ที่ :459) ขณะที่ router parse ผลภายหลัง (ira:741); บริษัทรับเองเฉพาะเมื่อ usage `ok === false` (cbr:872); settle ซ้ำถูกกันเป็น `'duplicate'` (cbr:859–860) — คำตอบที่ provider ส่งครบแต่อ่านไม่ออก/ถูกตัดที่ max_tokens จึงถูกคิดเงินลูกค้า (B6)

### 1.5 เครดิตและ slot ของ turn

- `issue()` ไม่ตรวจเครดิต (bas:124–178); เครดิตถูกตรวจตอน `reserve()` ครั้งแรก (bas:305–363) ซึ่งกันเงินเท่าเพดานของการเรียกนั้นก่อนส่ง
- `narrow()` ปฏิเสธ `nextOrdinal < 1` (bas:291) — เส้นทางไม่ใช้โมเดลที่ขึ้น UAT 2026-10-05 ถูกปฏิเสธและถอน (`docs/specs/line-ai-credit-wording-and-deterministic-reads-spec-th.md:134`)
- slot: ทุกการเรียกที่ไม่ใช่ repair นับใน `maxTurnSlots` (abb:348–351); gateway เริ่มนับจาก `grant.nextOrdinal` ของ request (`apps/ai-gateway/src/common/usage/ai-usage.interceptor.ts:96`); authority ต้องการ ordinal ตรง `authority.nextOrdinal` (bas:344) — ใช้ grant ข้าม request ไม่ได้
- deadline ของ turn = `admittedAtMs` (เวลารับข้อความแรก, pwu:4450) + เพดานของ lane (`public` 40,000 ms ตอนออก grant — pwu:4451, bas:45); grant ที่เลย deadline ใช้ไม่ได้ (bas:155)
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
| turn log | `costSatang: null` เสมอ | ไม่มีต้นทุนต่อ turn | pwu:9395 |

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
6. **ผลที่ใช้ไม่ได้ไม่คิดเงินลูกค้า** (R12): prerequisite owned by expense-trust-and-money-fixes R6 / P07 (owner step 2); this lane integrates it without repeating the fix
7. บน paid path ขั้นที่ไม่เรียก AI ไม่คิดเครดิต งานที่เริ่มแล้วทำต่อจนจบได้แม้เครดิตหมด ข้อความพิมพ์ใหม่ยังผ่านประตูเครดิต (Owner §17 Q1 answered 2026-11-04; free D04 คงเดิม)
8. ทดลองโมเดลเล็กกับ Tier 1 หลัง eval ผ่านเท่านั้น

## 3. Non-goals

**Ceiling (owner 2026-10-26, R22):** every paid tier uses `starter`; ENTERPRISE_1999 adds only `wht_pnd53`/`wht_50bis` (`packages/contracts/src/menu-entitlements.ts:432–450,497–500`). New workflows, help conversions and fixed reads cover only sold expense/claim/payment-document/substitute workflows and entitled withholding work. Sales, CRM/inbox/bookings, ledger/finance reports, PO, inventory, bank reconciliation, tax workspace/VAT and shop OA receive no new formatter, conversion, workflow, tool or read. Existing/new general-knowledge and package-boundary evals remain in scope (R26); free D04 remains a separate gate (R27). Shared guards can affect existing callers; that is compatibility only, not module work. No new permission key or environment behavior switch.

New/changed UI, LINE replies and help use plain Thai, one short sentence and a same-card way out; exact tax/accounting terms remain in papers and exports. Keep the October 13 approvals/signatures/camera decisions and the later decision that LINE keeps `แดชบอร์ด` (`docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md:11–20`, final owner answers).

- ไม่เปลี่ยนโมเดลของ Tier 2, OCR, document QA
- ไม่สร้างหน้าเว็บใหม่; รับรอง/อนุมัติ/ออกใบรับรองแทนใบเสร็จยังอยู่ในเว็บ
- ไม่เปลี่ยนกติกาสิทธิ์/ABAC/การอนุมัติ — การอนุญาตต่อรายการใช้โค้ดเดิม (§8, R21); การเปิดทางอ่านรายการใน LINE (§6.1) ใช้การตรวจสิทธิ์ชุดเดิมของ use-case นั้น
- **ไม่ทำ workflow แก้ใบเบิก และไม่แตะทางแก้เดิม**: ตัวเลือก TARGET (UPDATE, rda:812–820) และทุกตัวเลือกของ action UPDATE คงเป็น message action ที่ไปเส้นทางเดิม; `proposeCollected`/`choose` รองรับเฉพาะ CREATE (rda:337–348, :164)
- ไม่ทำ workflow ให้คู่ค้า/พนักงาน/สาขา/แพ็กเกจ (pwu:6717–6739, 6745–6754, 6670)
- ไม่ทำ multi-intent ใน Tier 1; ไม่ทำ group/room
- ไม่เปลี่ยนสูตร slot/repair/QA ของ turn grant (classifier ใช้ authority แยก §6.4)
- ไม่ใส่วันหมดอายุใน open token รุ่นแรก
- ไม่ทำรายงานต้นทุนในเว็บ

## 4. ผู้ใช้และ journey

แพ็กเกจที่ขาย: ทุกแพ็กใช้ `starter`; Enterprise เพิ่มเฉพาะ `wht_pnd53`/`wht_50bis` (`packages/contracts/src/menu-entitlements.ts:497–500`)

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
| R4 | งานเขียนจบที่การ์ดยืนยันที่ลงนามและ use-case เดิม; A10/B7/B8 moved to expense-trust-and-money-fixes, step 1 / P04 (R5) and step 3 / P10 (R9); this lane reuses the signed-apply boundary | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts:203` — `messageText: '1'`; source trust/money spec §3, §5 |
| R5 | ถามครั้งเดียว ถามเฉพาะช่องที่ขาด; ค่าตั้งต้น: วันที่ไม่ระบุ = วันนี้ (กรุงเทพ), วัน/เดือนไม่ระบุปี = ปีนี้, ผู้ขอเบิก = ตัวเอง, สาขา = สาขาเดียวที่มีสิทธิ์, เป้าหมายเดียว = เลือกให้ | Owner rules; stv2:89 |
| R6 | ข้อความที่เป็นคำถาม/คำสั่งใหม่ไม่ใช่คำตอบของช่อง (ใช้เฉพาะส่วนตรวจคำถาม/คำสั่งของใบเบิก rda:194–197) และไม่ลบงานค้าง (รวมช่องชื่อผู้รับเงิน); เงื่อนไข "ต้องไม่มียอด" (rda:198) คงเป็นของช่องเหตุผลใบเบิกเท่านั้น — ช่องที่อยู่ เช่น "88 ถนนสีลม" มีตัวเลขได้ | §13 B2 |
| R7 | Tier 1 รันเฉพาะ: แชตส่วนตัว, ข้อความล้วน ≤ 1,000 หน่วย UTF-16, ไม่มีงานค้างที่ R2 รับ, `answersOpenWork` = false, ไม่มีคำถามค้างใน ledger/task projection, ไม่มีรูปที่พักไว้; อย่างอื่น → Tier 2 | pwu:6027–6110; §6.4 |
| R8 | classifier ได้แค่ข้อความปัจจุบัน + label ที่ปิด ไม่มีข้อมูลร้าน; span ต้องเป็นสตริงย่อยของข้อความจริง; จำนวนเงิน/วันที่ใช้ `extractValueCandidatesV2` เท่านั้น | budget contract §3 |
| R9 | เริ่ม workflow ทันทีเมื่อ label เป็น workflow, `confidence ≥ T` และ `confidence − second_confidence ≥ M` (เริ่ม T 0.80, M 0.15; **B5 2026-11-06: T 0.70, M 0.10**, set from 191 real classifier decisions on the tuning corpus: right starts 35 → 41 of 46, choice cards 17 → 10, no added mis-start); `0 ≤ second_confidence ≤ confidence ≤ 1` ตรวจฝั่ง server; กรณีไม่ผ่านตามตาราง §7.2.1 | R10 |
| R10 | provider บังคับ schema: Converse `outputConfig.textFormat` หรือ tool `strict: true`; ไม่มี `minimum/maximum/minLength/maxLength`; `additionalProperties` ต้อง false; compile ครั้งแรก "may take up to a few minutes"; grammar "cached for 24 hours from first access" | https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html |
| R11 | ขีดจำกัด: strict tools ≤ 20, optional ≤ 24, union ≤ 16; Sonnet 4.6 และ Haiku 5.5 อยู่ในรายการที่รองรับ; Converse กับ `global.anthropic.claude-sonnet-4-6` **ยังไม่ยืนยัน** → probe (plan B1) | https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| R12 | ผลล้มเหลวหรือใช้ไม่ได้คิดลูกค้าเป็นศูนย์; A9/B6 moved to expense-trust-and-money-fixes, step 2 / P07 (R6); classifier ใหม่ต้องใช้ acceptance hook เดียวกัน | `apps/ai-gateway/src/common/usage/ai-budget-provider.ts:459` — `await settleV2`; trust/money spec R6 |
| R13 | ข้อความพิมพ์ใหม่ผ่านประตูเครดิตแม้ไม่เรียกโมเดล; ปุ่มและคำตอบของงานที่เริ่มแล้วไม่ถูกเครดิตหมดขวาง | Owner §17 Q1 — answered 2026-11-04; paid no-AI steps cost zero |
| R14 | ไม่มีสวิตช์พฤติกรรม; สวิตช์ทักทายถูกลบ | Owner rule; `packages/config/src/index.ts:322–326` |
| R15 | คำที่ลูกค้าเห็นมาจากค่าคงที่ ผ่านตัวตรวจบุคลิก | `apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.ts:32–47` |
| R16 | แจ้งเตือนเฉพาะคนที่เกี่ยว — เพิ่มปุ่มบนแจ้งเตือนเดิม ไม่เพิ่มผู้รับ | Owner 2026-10-01 |
| R17 | ใบรับรองแทนใบเสร็จ: LINE เตรียม/ลงชื่อผู้รับเงินได้ตามเดิม; รับรอง/อนุมัติ/ออก อยู่ในเว็บ | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts:170–176` |
| R18 | ราคา (USD/MTok): Sonnet 4.6 in 3 / cache write 5 นาที 3.75 / cache read 0.30 / out 15; Haiku 5.5 (prompt ≤ 100k) in 0.10 / cache write 0.125 / cache read 0.01 / out 0.50; รุ่น 4.7 ขึ้นไปนับโทเคนมากขึ้นราว 30% | https://platform.claude.com/docs/en/about-claude/pricing |
| R19 | Haiku 5.5 บน `bedrock-runtime` รองรับ Messages, Converse, Invoke; `global.anthropic.claude-haiku-5-5` ใช้จาก ap-southeast-1 ได้ (ไม่มี In-Region/Geo); structured outputs; prompt cache ขั้นต่ำ 512 โทเคน TTL 5 นาที/1 ชม.; adaptive thinking เปิดเป็นค่าตั้งต้น effort ตั้งต้น medium (ปิด thinking แล้ว effort สูงสุด high); thinking tokens นับใน max_tokens | https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html; https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide |
| R20 | ให้เห็นเฉพาะเครื่องมือที่เกี่ยวช่วยเลือกถูกขึ้นมาก (13.62% → 43.13%) | https://arxiv.org/abs/2505.03275 |
| R21 | การอนุญาตต่อรายการใช้ของเดิม: `permitted` (lea:997–1012) รวม `expense.delete` หรือ (ผู้สร้าง + `expense.update`) และ `expense.review` หรือ (ผู้สร้าง + `expense.update`) (lea:1010–1011); การอนุมัติใช้ `approvalDecisionActions` + assignment ที่ตรึง (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts:162–180`, lea:1003–1006); **การอ่านเพื่อแสดง picker** ใช้ scope ของ use-case รายการ (`expenseListReadScope`, `apps/api/src/modules/expenses/application/expense-list-read-scope.ts:4–9`); ผู้ไม่มีสิทธิ์อ่าน (scope = null) แต่เป็นผู้สร้างที่มี `expense.create`/`expense.update` ใช้ picker เฉพาะรายการ `createdByUserId = ตัวเอง` สำหรับ action ที่ `permitted` อนุญาตผู้สร้าง (MARK_READY, DELETE_DRAFT) — §17.1 MC1; `canUseLineChatAction` (ai-tools.ts:293–303) ใช้แค่แสดงปุ่มนำทาง | review รอบ 1 F10, รอบ 2 P10 |
| R26 | Paid packs: after classification, unavailable-module shop-data requests retain the existing package reply, no model-free conversion, no unsold tool or invented figures, and no new refusal-specific charge beyond today's invocation/settlement rule; business general knowledge retains the existing advisor answer. Keep lower-pack WHT denial. | Existing `scopePolicyOverride`, `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406,417`; owner policy 2026-09-29 |
| R27 | Free shops: resolve the existing commercial access before Tier 1; `freeExpenseDrafts` never reaches classifier, intake, planner or compose. Preserve model-free receipt/menu/support/company/package entry points; OCR remains the existing three-source-document monthly exception. Never offer paid claim/payment/tax workflows to free shops or treat a package-advisor URI as a typed AI question. | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6942`; free spec D04 |

Path applicability (each requirement):

| Path | Requirements / meaning |
|---|---|
| Paid AI path | R1/R2/R5–R14/R17–R20/R22/R24–R26; their workflow, classifier, fixed-read and model-cost changes do not grant free financial work or Q&A. R13/Q1 cannot override D04. |
| Both, at each path's allowed boundary | R3/R4/R15/R16/R21/R23: identity/signature, confirmation, plain truthful copy, recipient, permission and ordered delivery rules hold on free and paid paths; a free refusal offers the existing expense-list or support exit on the same reply. R4 does not enable a free final write. |
| Free admission and preserved paid fallback | R27: free commands return before model admission; an upgrade resolves current access again and then uses paid R1–R26. Existing eligible trial/admin paths retain their existing access, not an inferred free flag. |

ข้อยกเว้น: E1 ปุ่มใช้ไม่ได้ — แยกตามสิ่งที่ server พิสูจน์ได้: (ก) ลายเซ็น/token ไม่ผ่าน (ปลอม ข้ามคน ข้ามบริษัท) หรือไม่พบในที่เก็บ/ใช้ไปแล้ว — `wf_open` ไม่มีวันหมดอายุ จึงล้มได้ทางนี้ทางเดียว → "การ์ดนี้ใช้ไม่ได้แล้วค่ะ" + targetless `เปิดเมนู` (same-card recovery; never expose a target); (ข) การ์ดหมดอายุจริงที่ server พิสูจน์ได้: `ReimbursementDraftAction` เลย `expiresAt` (`line-reimbursement-draft.use-case.ts:159`) หรือการ์ดรายการ/ใบเตรียมจ่ายที่ preview ใน Redis หายตาม TTL 600 วินาที (`line-draft-preview.store.ts:29, 111`) แต่ยังมี **บันทึกกู้คืน** `recover:<previewId>` (TTL 7 วัน เก็บ `{ companyId, userId, act, id, pm, pd, pa }` ลบทันทีเมื่อกดยืนยัน/ยกเลิก — มีบันทึกแต่ไม่มี preview จึงหมายถึงหมดเวลาเท่านั้น) และ company/user ตรงผู้กด → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่` (`wf_open` ที่ลงนามจากบันทึกนั้น); token เดิม `${previewId}.${sign(entry)}` (lea:588) ตรวจลายเซ็นไม่ได้เมื่อ entry หาย จึงใช้ previewId หาเฉพาะบันทึกกู้คืน และ `wf_open` ตรวจสิทธิ์/สถานะใหม่ทั้งหมดก่อนแสดง preview; E2 ไม่มีสิทธิ์ → คำปฏิเสธเดิม (`refusal()` lea:1014+); E3 แพ็กเกจไม่มี → ข้อความ entitlement เดิม (pwu:526); E4 ข้อความของ "อย่างอื่น" หมดอายุ/Redis ใช้ไม่ได้/วันที่กรุงเทพเปลี่ยนแล้ว → ขอให้พิมพ์ใหม่ 1 บรรทัด; E5 ระหว่าง support pause ปุ่ม workflow ทำงาน ข้อความพิมพ์ยังเข้า pause ตามเดิม

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
| `expense_submit` / `expense_confirm` / `expense_delete` / `expense_void` / `expense_pay` | `MARK_READY` / `CONFIRM` / `DELETE_DRAFT` / `VOID` / `RECORD_PAYMENT` | รายการ (+ เหตุผล VOID, วิธีจ่าย) | `ListExpensesUseCase` (`apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:309–319`, scope ตาม `readScope` :379–391) ตาม status/paymentStatus เรียง `expenseDate desc` (`prisma-expense.repository.ts:1288`); ผู้สร้างที่ไม่มี read scope → รายการ `createdByUserId = ตัวเอง` เท่านั้น (R21) | `permitted` ของ action นั้น |
| `payment_voucher` | `VOUCHER_CREATE` | รายจ่ายยืนยันแล้ว → ผู้รับเงิน (ถ้าขาด) | `ListExpensesUseCase` CONFIRMED | `vouchers.authorize` (lea:998) |
| `wht_certificate` | `WHT_CERTIFICATE_ISSUE` | ใบเตรียมจ่าย → ที่อยู่ผู้รับ (ถ้าขาด) | **`DisbursementVoucherUseCase.listForLine`** (ใหม่ — `list` เดิมปฏิเสธ LINE session: `disbursement-voucher.use-case.ts:69–72, 228–229`) | `canOfferCertificate` (`line-voucher-action.service.ts:75`), `wht_50bis` |
| `substitute_receipt` (ใหม่) | `substituteReceiptContinuation.execute` (confirmedStart แบบ pwu:6769) จนถึงการ์ด PREPARE/FORM ที่ลงนาม (`LineSubstituteReceiptActionService.prepare` :104); การตรวจรายจ่าย/เตรียมเอกสารเกิดเฉพาะตอนกดการ์ด (`apply` :183) — R4, B7 | ช่องของ continuation เดิม | **`ListSubstituteReceiptCandidatesUseCase` ทาง LINE** (ใหม่ — ตัวเดิมเรียก `assertWeb`: `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts:471–496`) — ไม่ใช้คิวลงชื่อ (`prisma-expense.repository.ts:1832–1848` เก็บเอกสารที่เตรียมแล้ว และไม่มี expense id) | ตัวกรองสิทธิ์/คุณสมบัติเดิมของ use-case นั้น (`substituteReceiptPreparationScope`, `collectSubstituteReceiptEligibilityIssues`) |

ทางอ่านใน LINE ที่เพิ่ม (อ่านอย่างเดียว ตรวจสิทธิ์ชุดเดิม):
- `DisbursementVoucherUseCase.listForLine(ctx, query)` = `list` ที่เรียก `scope(ctx, 'read', branchId, lineConfirmed = true)` — ยังต้องมี `expense.disbursement.read` (:69–72) และ read scope ของรายจ่าย (:74–78); ไม่เปิดทางเขียนใด ๆ (ทาง read tool เดิมเลี่ยงด้วยการเปลี่ยน `authProvider` เป็น `'watchdog'` — `apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts:15–19`, G15)
- `ListSubstituteReceiptCandidatesUseCase.execute(ctx, filter, { channel: 'line' })` = ข้าม `assertWeb` เฉพาะการอ่านรายการ; ตัวกรองสิทธิ์/คุณสมบัติเหมือนเว็บทุกตัว; การเตรียม/ลงชื่อยังผ่าน continuation เดิม; การรับรอง/อนุมัติ/ออกยังเป็นเว็บ (R17) — §17.1 MC2

การค้นตามชื่อ (slot) — ห้ามพูด "ไม่พบ" ถ้าค้นไม่ครบ:
- ใบเบิก: `search` ฝั่ง DB (:553) แล้วกรองด้วย `approvalActions`/สิทธิ์ ไล่ ≤ 3 หน้า × 100 (pageSize สูงสุด 100, :538); `total` ≤ 300 แล้วไม่พบ → "ไม่พบ…"; > 300 → ปุ่มเว็บ
- รายจ่าย (แก้ P11): `ListExpensesUseCase.execute(ctx, { status | paymentStatus, vendorCounterpartyId?, createdByUserId? (R21), page, pageSize: 100 })` — ต้องส่ง `pageSize` เอง (ค่าตั้งต้น 20 สูงสุด 200, `expense-draft.use-case.ts:315–316`); ผลมี `total` และเรียง `expenseDate desc, id desc` (`prisma-expense.repository.ts:1287–1289`); ไม่ใส่ช่วงวันที่ จึงรวมรายการค้างจ่ายเก่ากว่า 90 วัน; ไล่ ≤ 3 หน้า; `expense_pay` เรียกสองชุด (`UNPAID`, `PARTIALLY_PAID`) แล้วรวมเรียงวันที่; **exhaustive** = Σ `total` ≤ 300 และอ่านครบทุกหน้า แล้วจึงกรองด้วย `permitted`; > 300 → "มีรายการมากเกินจะค้นในแชตค่ะ" + `ค้นในเว็บ`; ไม่มีการค้นด้วยข้อความ (ตัวกรองไม่มี search — `packages/contracts/src/expenses.ts:1243–1265`) ชื่อผู้ขายจึงผ่าน `vendorCounterpartyId` ตามข้อถัดไป
- รายจ่าย: ชื่อผู้ขาย → `ListCounterpartiesUseCase.execute(ctx, page, 100, { search })` (`apps/api/src/modules/accounting-documents/application/use-cases/counterparty.use-case.ts:266–272`) ≤ 3 หน้า (ไม่ใช้ tool เดิมที่ตัด 10 แถว `line-counterparty.service.ts:77`); 1 ราย → กรอง `vendorCounterpartyId`; 2–4 ราย → ปุ่มให้เลือกผู้ขาย; > 4 → ปุ่มเว็บ; 0 (ค้นครบ) → "ไม่พบผู้ขายชื่อ … ในรายชื่อคู่ค้าค่ะ"; **ไม่มี `accounting.counterparty.read`** (:75, use-case :270) → ส่งตรวจ/ลบร่างกรองด้วยชื่อร้านที่บันทึกในรายการของผู้ใช้เองก่อน (รอบ 20); ถ้าไม่พบหรืองานอื่น ไม่กรองตามชื่อ แสดงรายการล่าสุดด้วยคำ "เลือกจากรายการล่าสุดได้เลยค่ะ" (ไม่พูดว่าไม่พบ — รอบ 22)
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

ขอบเขตงาน: งานหนึ่ง = workflow id หนึ่ง จาก event แรกถึง terminal ของ action นั้น; `reimbursement_claim` จบเมื่อร่างถูกบันทึก (`resultType = 'REIMBURSEMENT_REQUEST'`, `resultId` = `result.receipt.requestId`, pwu:5354); การส่งอนุมัติเป็นงาน `reimbursement_submit` ใหม่ที่ `sourceId` = requestId เดียวกัน; journey = งานที่ต่อกันด้วย `resultId → sourceId` ภายใน 30 นาที; `COMPLETED` = action ถูก apply (หรือคำตอบอ่านส่งถึง LINE); `DECLINED` = กด "ไม่ทำ" ที่การ์ด

ต้นทุนไม่เก็บซ้ำ: รายงานอ่าน `AiBudgetReservation` ของ attempt key ทั้งสองแบบต่อ event (turn `deliveryHash(['line-turn-v2', webhookEventId])` pwu:4449; classifier `deliveryHash(['line-classify-v2', webhookEventId])` §6.4) — ส่วนลูกค้า/บริษัทจาก `evidenceJson.customerChargedSatang/companyAbsorbedSatang` (cbr:947, 954); ต้นทุน provider แบบไม่ปัดคำนวณจากตัวนับโทเคน × ราคาใน `AiUsageEvent.pricingSnapshot` (`apps/api/prisma/schema.prisma:4569`) แยกจากยอดสตางค์ที่ปัดแล้ว (ai-model-pricing.ts:223) — measurement spec §6.5

อายุข้อมูล: ลบพร้อม `LineWebhookEventLog` ตาม `AI_DATA_RETENTION_DAYS` (ค่าตั้งต้น 90, `packages/config/src/index.ts:362`)

ไม่มีตารางสถานะ workflow ใหม่: สถานะอยู่ใน `ReimbursementDraftAction` (`apps/api/prisma/schema.prisma:7416`), StoredAction ใน Redis (`apps/api/src/modules/expenses/application/services/line-draft-preview.store.ts:4`), continuation ใบทดแทนเดิม

### 6.3 ที่เก็บชั่วคราว (Redis)

`LineDraftPreviewStore<StoredWorkflowChoice>` prefix `wf-choice:` TTL 900 วินาที: `{ choiceToken, options[], rawText, originalAcceptedAtMs, originalBangkokDate, originalEventIdHash, classifierDecision }` (คลาสเดิม line-draft-preview.store.ts:62)

### 6.4 Budget ของ classifier — authority แยก

- **authority kind ใหม่** `'webhook_classify'` (abb:228+); parent = แถว `LineWebhookEventLog` เดียวกัน คอลัมน์ `classifyAuthorityJson/Revision`; `bas` เลือกคอลัมน์ตาม kind ทุกจุด (`parent()` :81–86, `issue` :124–178, `validate` :180–197, `resolvePrivateOwner` :199+, `reserve` :305–363)
- `issue`: owner PRIVATE, `allowedProfileIds = ['line-classify/2']`, `maxTurnSlots = 2` (parser รับอยู่แล้ว abb:313), lane ใหม่ `classify` ใน `baseCeilings` (bas:45) = 10,000 ms (รอบ 22: เดิม 8,000 นับจาก admittedAt ซึ่งรวมช่วงรอรวมข้อความราว 3 วินาที classifier จึงเหลือจริงราว 3.8 วินาที; 10,000 ให้เพดาน 5 วินาทีของ classifier เป็นตัวกำหนด), `attemptKey = deliveryHash(['line-classify-v2', webhookEventId])`; `narrow`/`transferToDocumentQa` ปฏิเสธ kind นี้
- **profile ใหม่** `'line-classify/2': { maxInputTokens: 24_576, maxOutputTokens: 1_024, maxCalls: 2 }` (abb:216–219; รอบ 22 เพิ่มจาก 1 เพื่อยิงซ้ำหนึ่งครั้ง); `profileCounts` (bas:344) จำกัดไม่เกินสองครั้ง; digest ของตารางเปลี่ยน → release เดียว API/gateway/AgentCore
- ขนาดจาก estimator จริง (abp:126–162): พรอมต์ ≤ 8,000 ไบต์ + ข้อความ ≤ 1,000 หน่วย UTF-16 (ไทย ≈ 3,000 ไบต์) + framing ≈ 300 + schema ≈ 1,700 → ≈ 13,000 + 4,096 → ปัด 1,024 = 17,408 ≤ 24,576; spec test ยืนยัน
- **turn grant ไม่เปลี่ยน**: Tier 2 ใช้ turn grant ของ event (`prepareTextGrantV2` pwu:4436–4455) ordinal 0 ใน request ของ intake; ฟังก์ชัน slot (abb:339–351), `narrow` slot (bas:293), planner limit (stv2:727), QA (`apps/ai-gateway/src/modules/line-ai/application/document-qa.use-case.ts:97`), orchestrator (`orchestrator.agent.ts:1210`), AgentCore (`apps/ai-gateway/src/agentcore/runtime.ts:732`) คงเดิม (regression test)
- **deadline**: turn grant ยังนับจาก `admittedAtMs` (pwu:4450) + 40,000 ms ของ lane `public` (pwu:4451, bas:45) เหมือนเดิม — เวลาที่ classifier ใช้ (≤ 5 วินาที รวมการยิงซ้ำ) หักจากงบนี้ ไม่ขยาย; ผลคือ Tier 2 หลัง fallback ไม่ช้ากว่าเพดานเดิมของวันนี้ แต่ไม่อยู่ใต้ 15 วินาที (AC14)
- การตัดสินเก็บใน `classifyAuthorityJson.decision`: event ที่เล่นซ้ำใช้ผลเดิม ไม่จ่ายซ้ำ; authority ใช้แล้วไม่มี decision → Tier 2
- ประตูเครดิต: การจองของ classifier ตรวจเครดิตเหมือน intake วันนี้; ปฏิเสธด้วยเหตุเครดิต → `answerAiCreditRefusal` (pwu:7060)

- **สถานะ 2026-11-08 (รอบ 24b):** Haiku 5.5 รับเข้าแล้ว (แถว capacity, tariff, thinking ปิด, eval allowlist); intake route **ยังเป็น Sonnet** เพราะ grant ของ intake ถูก narrow ต่อเป็น grant ของ compose ที่ล็อก model และ tariff ไว้ — ถ้าเลือก Haiku ที่ intake คำตอบก็จะเป็น Haiku ด้วย ต้องออกแบบ grant แยกก่อน
- **สถานะ 2026-11-09 (รอบ 24c):** `LINE_CLASSIFY_MODEL_ID` กลับเป็น Sonnet 4.6. ชุด v14 รันซ้ำบน API key ด้วย classifier Haiku: workflow 180/181 หลังแก้ gold, เขียนผิด 0, ข้อความ "ลองใหม่" 0; classifier p50 2.6 → 1.4 วินาที แต่ p50 ของ turn ที่ใช้ model เต็มลดเพียง 7.3 → 7.0 วินาที. ใน 70 turn ที่ทั้งสองรอบจัดประเภท label ต่างกัน 11 turn และ Sonnet ถูกทุกครั้ง; Haiku อ่านคำถามดูรายการ "ใบเบิก…ที่ยังรออนุมัติ" เป็นงานอนุมัติด้วยความมั่นใจ 0.8 จึงตอบผิดเรื่อง. Haiku ใช้ได้เมื่อ partner model policy เลือก; ถ้าจะกลับไปใช้ต้องมีชุดตรวจใหม่และเพิ่มใน `APPROVED_AI_MODEL_IDS` + MC5 ก่อน. รอบเดียวกัน: คำถามงานเดียว "ต้องการทำเรื่องนี้ใช่ไหมคะ" รับ "ใช่ค่ะ" ที่พิมพ์เท่ากับกดปุ่ม และ "ไม่ใช่ค่ะ" ที่พิมพ์ไม่เริ่มงานรายละเอียด (จ่าย/ยกเลิก/ไม่อนุมัติ). ตรวจซ้ำ 13 บทสนทนาบน main 944ef10b6 (API key): งานที่ Haiku ทำให้แย่ลงทั้ง 6 งานผ่านกลับ และ label ตรงกับรอบ Sonnet เดิม 16/16
- **สถานะ 2026-11-09 (รอบ 25 ความเร็ว):** วัดจากชุด v14 รอบ Sonnet (API key, 600 turn) ว่าเวลาไปไหน.
  - ข้อความที่พิมพ์ทุกข้อความรอ debounce 1.0 วินาทีก่อนเริ่ม (turn ที่ไม่ใช้ model p50 1.27 วินาที); ปุ่ม postback ไม่รอ (p50 0.14 วินาที).
  - turn ที่ใช้ model เต็ม 217 turn p50 7.35 วินาที = รอก่อนเริ่ม 1.15 + intake route 5.2 + ส่วนอื่นราว 0.2. ทุก turn เรียก intake route; มีเพียง 41 turn (1 ใน 5) ที่เรียก classifier ก่อน และ 38 turn ที่เขียนคำตอบด้วย compose (7.2 วินาที, 273 output token).
  - เวลาของแต่ละ call เป็นงานเขียน ไม่ใช่งานอ่าน prompt: fit ของ intake route = 1.3 วินาที + 22 ms ต่อ output token (R² 0.55); compose 21 ms, classifier 17 ms. intake route เขียนราว 181–191 token ต่อ turn.
  - Haiku ที่ classifier เร็วกว่าราว 1 วินาทีเฉพาะ turn ที่ผ่าน classifier (1 ใน 6 ของ turn ที่ใช้ model เต็ม) ค่ากลางรวมจึงขยับเพียง 0.3 วินาที.
  - ลองตัด output ที่ server ไม่อ่านทั้งสองขั้น แล้วสอบชุด v14 เต็มบน API key (204 บาท): workflow 180/181 หลังแก้ gold เท่าเดิม, เขียนผิด 0, ข้อความ "ลองใหม่" 0.
  - classifier ละ text slot ที่ว่างได้ (เก็บไว้): output 78 → 39 token, classify p50 2.6 → 2.2 วินาที (Sonnet ทั้งสองรอบ); turn ที่ใช้ classifier อย่างเดียว p50 3.8 → 3.6 วินาที.
  - intake route (ถอยกลับ): บอกว่า semanticOutcome/fundingSource เขียนเฉพาะสอง route และ clause เดียวละ sources/filters ได้ แต่ model ยังเขียนตามตัวอย่าง shape ใน prompt — output ต่อ turn เดียวกันลดเพียง 5 token (ราว 0.1 วินาที) และ router ทิ้ง filter ที่รอบก่อนมีบ่อยขึ้น (16 vs 9 turn ในการเทียบคู่) เพราะ filters ไม่ใช่ช่องบังคับแล้ว. จึงคืน prompt, decoder และ calibration ของ intake เป็นแบบรอบ 24c; ถ้าจะลด output ของ intake ต้องแก้ตัวอย่าง shape และวัดว่า filter ไม่หาย.
  - ยังไม่ทำในรอบนี้: ลด debounce (ต้องมีข้อมูลจริงว่าข้อความแตกหรือไม่ ตาม cohort gate ของ latency spec), เรียก classifier คู่กับ intake (เสียค่า intake เพิ่มใน turn ที่เป็นงาน), ใช้ model ที่เขียนเร็วกว่าที่ compose (ต้องผ่าน admission + ชุดสอบ).
- **แผนรอบ 26 ความเร็ว (owner 2026-11-09: "1 ถึง 4 ทำได้หมดเลย ข้อ 4 ต้องมั่นใจว่า ai เข้าใจบทสนทนาและบริบทที่คุยก่อนหน้าได้ ความถูกต้องต้องให้แม่นที่สุดคือ95% ขึ้นไป"):** เกณฑ์ผ่านของทุกข้อเท่าเดิม — workflow ≥95%, เขียนผิด 0, ข้อความ "ลองใหม่" 0 — และ advisor ต้องไม่ต่ำกว่ารอบ Sonnet ล่าสุด (160–165/210) กับ replyaudit ไม่มีคำตอบงงเพิ่ม.
  - **26a ตัวอย่าง shape ของ intake:** ตัวอย่างเองบอกว่า semanticOutcome/fundingSource มีเฉพาะ EXPENSE_DOCUMENT_CAPTURE และ REIMBURSEMENT_REQUEST_START และ sources มีเมื่อ 2 clause ขึ้นไปหรือ quote; `filters` ยังบังคับ; decoder ให้ clause เดียวที่ไม่มี sources อ้างทุก part เต็ม. ตรวจด้วยชุดย่อย 40 บทสนทนาก่อน: output ต่อ turn คู่เดียวกันต้องลด และ filter ที่หาย (เทียบคู่) ต้องไม่เกินระดับ noise (9).
  - **26b classifier คู่กับ intake:** ไม่ทำ. การเรียก intake ล่วงหน้าแล้วทิ้ง (1) ถูกเก็บเงินลูกค้าเพราะไม่มีทางยกเลิกหรือย้ายเป็น COMPANY_ABSORBED หลังเรียกสำเร็จ (2) hold สองก้อนพร้อมกันเปลี่ยนว่าข้อความไหนถูกปฏิเสธเมื่อเครดิตใกล้หมด (3) ใช้สิทธิ์ re-ask ครั้งเดียวไปก่อน — ขัดกฎไม่เก็บเงินการเรียกที่ไม่ได้ใช้และ "คำตอบเหมือนเดิมทุกเคส". แบบปลอดภัย (เตรียมข้อมูลอ่านอย่างเดียวคู่กัน) ประหยัดเพียงช่องว่างระหว่าง call ราว 0.04 วินาที.
  - **26c คำตอบทั่วไปบน Haiku 5.5:** วัดบน API key: Sonnet 4.6 เขียน 23 ms/token, Haiku 5.5 5.3 ms/token. ย้ายเฉพาะ lane `general` (คำถามความรู้/วิธีใช้ ไม่มีข้อมูลบริษัท; 32 ใน 38 compose turn ของ v14, p50 16.8 วินาที). ฝั่ง API เท่านั้น: `LINE_COMPOSE_MODEL_ID`; grant ของ webhook_event แบบ PRIVATE ที่ไม่มี partner policy probe Haiku คู่กันและเก็บ `answerModel` (ไม่อยู่ใน grant ที่เซ็น); narrow ครั้งแรกเข้า `general` เปลี่ยน model/tariff/capacity เป็น answerModel; lane `mixed`/`simple`/`public` และ replay เหมือนเดิม; probe ไม่ผ่าน = ใช้ model เดิม. ก่อนขึ้น UAT/production ต้องเพิ่ม Haiku ใน `APPROVED_AI_MODEL_IDS` ของ API, gateway และ AgentCore (`deploy.sh`, `agentcore-deploy.sh`) พร้อมกันทั้งสามส่วน (ถ้าเพิ่มแค่ gateway คำตอบทั่วไปจะล้มที่ AgentCore); MC5 probe และการตรวจ UAT/production ที่เรียก LINE AI เป็นการเรียก Bedrock/AgentCore จริง ทำได้เฉพาะเมื่อ owner สั่งชัดในข้อความนั้น (owner 2026-11-09: "ห้ามเรียก bedrock หรือ agent core จริงโดยเด็ดขาด").
  - **26d debounce:** วันนี้ 1000 ms ทั้ง UAT/production; window เริ่มนับใหม่ทุก bubble; ระหว่างที่ turn ก่อนยังทำงาน bubble ใหม่รอและรวมเป็น turn ถัดไปเสมอ ค่า debounce จึงตัดสินแค่การแยกครั้งแรกของแชตที่ว่าง. ช่องว่างที่ต้องปิดก่อนลด: turn ที่ workflow/claim handler ตอบไม่บันทึก turn memory, classifier เห็นแค่ข้อความปัจจุบัน, harness ส่ง turn เป็นหลาย bubble พร้อมช่องว่างไม่ได้. ลำดับ: (1) อ่านช่องว่างระหว่างข้อความจริงของ production (ตัวเลขรวมเท่านั้น, session อ่านอย่างเดียว) (2) harness รองรับ bubble + gap (3) ชุดข้อความแตกที่ผมเขียนเอง (ไม่ใช่ held-out) รันที่ 1000 กับค่าที่เลือก — ความถูกต้องของเคสที่แตกต้องไม่ต่ำกว่าเคสที่รวม (4) ค่าใหม่ไม่ต่ำกว่าที่ข้อมูลจริงรองรับ. ใช้แทนขั้น cohort 14 วันของ latency spec เพราะ traffic จริงยังไม่ถึง 10,000 intent ต่อ cohort; owner สั่งให้ทำข้อนี้ 2026-11-09 และต้องรายงานให้ owner เห็นก่อนขึ้น production.
    - **ผล 26d (2026-11-09):** owner: "ไม่จำเป็น ลดเวลาได้เลย ตอนนี้ลูกค้าแทบไม่มี" — ไม่อ่านข้อมูล production. ชุดข้อความแตก 20 บทสนทนาจาก tuning corpus (สอง turn แรกส่งเป็นสอง bubble ห่าง 700 ms, API key, 30.79 บาท): debounce 1000 (รวมเป็นหนึ่ง turn) ผ่าน 12/20, debounce 500 (แยกเป็นสอง turn) ผ่าน 14/20; เขียนผิด 0 ทั้งสองแบบ, ข้อความ "ลองใหม่" 0. เคสที่แยกเข้าใจต่อจากข้อความก่อน (ถาม "ยอดเท่าไรคะ" แล้ว bubble "250 บาท วันนี้" ถูกรับเป็นยอด); ข้อความหลายบรรทัดที่ถูกรวมกลับแพ้ตัวเก็บข้อมูลแบบกำหนดตายตัวที่ไม่รับ `\n` (ส่งใบเบิกผ่านเฉพาะแบบแยก). เคสที่ไม่ผ่านทั้งสองแบบเหมือนกัน (เช่น "ไม่มีใบเสร็จ หมวด… เหตุผล…" ในข้อความเดียวถูกถามเหตุผลซ้ำ) ไม่เกี่ยวกับ debounce. ตั้ง `LINE_AI_BUFFER_DEBOUNCE_MS=500` ใน `infra/kamal/config.json` ทั้ง UAT และ production (มีผลเมื่อ release ครั้งถัดไป) และ `production-ai-env.json` ของ eval; harness ใช้ค่านั้นเป็นค่าเริ่มต้น.
  - **ผลสอบเต็มชุด v14 รอบ 26 (26a+26c+26d, API key, 175 บาท):** workflow 180/181 หลังแก้ gold (งานเดียวที่ตกคือ classifier หมดเวลา 5 วินาทีทั้งสองครั้งบน API key แล้วทาง intake ใส่เหตุผลผิดในตัวอย่าง ลูกค้ากดไม่ยืนยัน — classifier ไม่ได้แก้รอบนี้ และรอบ 25 หมดเวลา 3 ครั้ง), เขียนผิด 0, ข้อความ "ลองใหม่" 0, advisor 164/210 (รอบ 25: 160). ความเร็วเทียบรอบ 25: turn ที่ไม่ใช้ model p50 1.2 → 0.7 วินาที; classifier อย่างเดียว 3.6 → 2.9; ใช้ model เต็ม p50 7.1 → 6.2, p95 19.1 → 12.1; intake route 5.10 → 4.62 วินาที (output 177 → 150 token); compose 8.34 → 2.27 วินาที; turn คำตอบทั่วไป p50 16.6 → 10.4 วินาที. อ่านคำตอบ Haiku เทียบ Sonnet 9 ข้อ: ส่วนใหญ่เท่ากันและสั้นกว่า; 2 ข้ออ่อนกว่า (ตอบแบบ "ถ้าระบบของคุณแสดง…" แทนที่จะบอกว่าระบบนี้ทำอะไร, และให้วิธีถ่ายแต่ไม่บอกตรงๆ ว่าควรถ่ายใหม่).
- **สถานะ 2026-11-09 (รอบ 28, owner: "แก้ให้เรียบร้อยก่อน … ตั้งค่า prod ด้วย … ไม่ใช่คอนฟิกหลุด"):** (1) คำตอบทั่วไปของ Haiku: คำถามใช่/ไม่ใช่เปิดด้วยคำตอบ, ไม่พูดถึง "ระบบของคุณ" และไม่ส่งไปถาม "ผู้ดูแลระบบ" (สิทธิ์ตั้งโดยเจ้าของกิจการ); วาง rule ไว้ใน rule สองบรรทัดของหัวข้อ other, ข้าง rule เรื่อง product และบรรทัดตรวจท้าย prompt — ครั้งแรกที่ใส่ไว้ต้น prompt Haiku ไม่ทำตาม. ตรวจซ้ำ 28 บทสนทนาที่มีคำตอบ Haiku (API key, 37.11 บาท, cap หยุดที่ 24) งานผ่าน 25/40 เท่ารอบ 25/26; ตรวจ 6 บทสนทนาหลังย้าย rule (3.74 บาท): คำตอบที่อ้าง "ระบบของคุณ/ผู้ดูแลระบบ" 0, สองข้อที่อ่อนตอบตรงแล้ว. (2) `infra/kamal/config.json` อนุญาต `global.anthropic.claude-haiku-5-5` คู่ Sonnet 4.6 ใน api-web และ ai-gateway ทั้ง UAT และ production (ค่า AI และ debounce ของสองระบบเท่ากัน; ต่างเฉพาะ billing/Stripe/Official OA ของ production ตามเดิม). (3) release เดิมยก environment ของ AgentCore ต่อจากของเก่าและเปลี่ยนแค่ GIT_SHA ฯลฯ ทำให้ model ที่อนุญาตใน config.json ไม่ถึง AgentCore; ตอนนี้ AgentCore รับ `APPROVED_AI_MODEL_IDS` และค่า global-profile approval จาก environment ของ gateway ที่ release (มี release test ที่ตกถ้าไม่มีการแก้). เอกสาร AWS/Anthropic: Haiku 5.5 รับ `thinking: disabled` ที่ effort ต่ำกว่า high และ `effort` เป็น stable บน Bedrock ไม่ต้อง beta header; การส่งผ่าน Converse `additionalModelRequestFields` เอกสารไม่ระบุตรงๆ — คำถามทั่วไปข้อแรกบน UAT คือการยืนยัน (ห้ามเรียก Bedrock จริงจากเครื่องนี้).
- **สถานะ 2026-11-09 (รอบ 27, owner: แก้ "ไม่มีใบเสร็จ หมวด… เหตุผล…" แล้วบอทถามเหตุผลซ้ำ):** ข้อความเดียวเก็บ "ไม่มีใบเสร็จ", หมวด และเหตุผลของใบเบิกครบอยู่แล้ว; บริษัทที่บังคับใบเสร็จแต่ยอมให้ระบุเหตุผล (`requireReceipt` + `allowMissingReceiptWithReason`) ยังต้องการ `missingReceiptReason` แยก ซึ่งเป็นคนละช่องกับเหตุผลของใบเบิก แต่บอทถามแค่ "ไม่มีใบเสร็จเพราะอะไรคะ" จึงดูเหมือนถามซ้ำ. แก้: เมื่อเก็บเหตุผลของใบเบิกแล้ว คำถามเป็น "ได้เหตุผลของใบเบิกแล้วค่ะ ขอเหตุผลที่ไม่มีใบเสร็จด้วย เช่น ร้านไม่ออกใบเสร็จ"; ประโยค "ไม่มีใบเสร็จเพราะ…" ในข้อความเดียวกันถูกเก็บเป็น `missingReceiptReason` ข้อความที่ครบจึงไปถึงตัวอย่างทันที; ไม่ใช้เหตุผลของใบเบิกเป็นเหตุผลที่ไม่มีใบเสร็จ. ตรวจซ้ำ 8 บทสนทนาใบเบิกที่ "ไม่มีใบเสร็จ" ของ v14 + บทสนทนาฝึกแบบข้อความครบ (API key, 9.91 บาท): 8/9 ผ่าน, บทสนทนาข้อความครบบันทึกร่างพร้อมเหตุผลทั้งสอง; ตัวที่ตกคือ classifier หมดเวลา 5 วินาทีบน API key แล้วไปทางสำรอง (ไม่เกี่ยวกับรอบนี้; รอบ 25–27 เกิด 2–3 ครั้งต่อรอบ).
- **model ของ classify grant** (แก้รอบ 4 F5): capability request ของ classifier ส่ง `modelPolicy: { modelId: LINE_CLASSIFY_MODEL_ID }` (ค่าคงที่ในโค้ด: Phase B = `global.anthropic.claude-sonnet-4-6`, Phase C = `global.anthropic.claude-haiku-5-5` ตาม Q2 answered 2026-11-04; release เมื่อผ่าน MA4 และ privacy gate ใน C3) แทน model ของบริษัท; บริษัทที่มี model policy ของ partner (`resolveCompanyAiModelPolicy` `ai-gateway.client.ts:162`) ใช้ model ของ policy นั้น ไม่ข้ามนโยบายบริษัท; model ต้องผ่าน `REVIEWED_LINE_MODEL_CAPACITY` (`apps/ai-gateway/src/modules/line-ai/infrastructure/provider/reviewed-line-model-capacity.ts`) + approved lists (`line-reliability-capabilities.controller.ts:24–37`, `ai-gateway.client.ts:171–178`) — วันนี้ตารางไม่มี Haiku 5.5 จึงต้องเพิ่มพร้อมหลักฐานจาก AWS model card และ ceiling 100,000 โทเคนให้ตรง tariff ≤ 100k prompt (§17.1 MC10); `provider.factory.ts:21–29` ใช้ `grant.model` อยู่แล้ว

### 6.5 API-side authority field

`serverRoute?: 'fixed_read'` (ไม่อยู่ใน signed grant เหมือน `admitOverCap`, bas:28–30) สำหรับปุ่มอ่านคงที่ (§7.4 ข้อ 2)

## 7. Contracts/API

### 7.1 Postback (≤ 300 ตัวอักษร, exact keys แบบ `parseLineReimbursementChoiceControl` — `apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts:24–33`)

| action | keys | ความหมาย |
|---|---|---|
| `chat-action` (เดิม) | `action, id` | ถ้า id เป็น workflow → Tier 0 เริ่ม workflow แทนการแปลงเป็นข้อความ `command` (line-staff-menu.logic.ts:957); เฉพาะปุ่มของ sold workflows ใน §6.1: message action ของ help card (`line-business-card.logic.ts:56`) เปลี่ยนเป็น postback นี้; id อื่นคง output เดิม รวม `ai-tools.ts:281–287` |
| `wf_open` (ใหม่) | `action, act, id, pm?, pd?, pa?, sig` | เปิดการ์ด preview ของ `act` (ค่าใดก็ได้ใน `EXPENSE_ACTIONS`, lea:44 — รวม `VOUCHER_SUBMIT/APPROVE/PAY/CANCEL/RETURN`, `WHT_CERTIFICATE_ISSUE`, `RECORD_PAYMENT`) กับเป้าหมาย `id`; `pm`/`pd`/`pa` = วิธีจ่าย/วันจ่าย/**ยอดจ่าย** ที่ผู้ใช้ให้ไว้ก่อนหน้า (แทน `applied.paymentIntent` ใน Redis lea:863; `paidAmount` อยู่ใน paymentIntent lea:470 — ถ้าไม่ส่ง preview ตั้งยอด = ยอดค้างทั้งหมด lea:539 ซึ่งผิดสำหรับการจ่ายบางส่วน); `sig = HMAC(secret, ['line-workflow-open-v1', company, user, act, id, pm ?? '', pd ?? '', pa ?? ''])` ตรวจด้วย `timingSafeEqual`; open token เดิม 3 แบบยังรับ (lea:842–846) |
| `wf_choice` (ใหม่) | `action, token, pick` | ตอบการ์ดความมั่นใจต่ำ: `pick` = workflow id ที่การ์ดแสดง หรือ `other` |
| `reimbursement_choice` (เดิม) | `action, actionId, revision, choice` | ขยาย `choice` ให้รับ choiceId ของ BRANCH/REQUESTER/SOURCE และ `new-line` **เฉพาะ action CREATE**; ตัวเลือกของ action UPDATE (รวม TARGET, rda:812–820) ไม่เปลี่ยน (Non-goals) |
| `fixed-read` (ใหม่) | `action, id` (exact 2 keys) | `FIXED_READ` is a code constant with **one sold entry**, `expense_month` → label `ค่าใช้จ่ายเดือนนี้`, synthetic text `ดูค่าใช้จ่ายเดือนนี้`, existing `expense.list_recent::single_metric` formatter, sold expense-list URL. `QUERY_ACTIONS` sales/CRM/inbox/finance/PO rows stay message actions; no new formatter or tests for them. Controller sets `fixedReadControl: { id }`; `linePostbackCommandText` adds only that closed id. Reuse `APPROVED_PREPARED_FAMILY_KEYS` (`prepared-simple-read-formatter.ts:1782–1786`) and `preparedEligibilityCtx` (`orchestrator.agent.ts:1918`); neither reads the obsolete env setting; unavailable formatter → §10 recovery, zero model calls. |

- ปุ่มขั้นถัดไปที่ระบบเสนอหลังกดยืนยัน: `offerNext` (VOUCHER_CREATE/SUBMIT/APPROVE/PAY, `line-voucher-action.service.ts:68–74`, lea:940–942), `offerPayment` (lea:943), `offerWht` (lea:936) → `wf_open` ของ action นั้น + id (`nextVoucherId`/expenseId) + `pm/pd/pa` จาก paymentIntent ตอนสร้างปุ่ม (แก้ B1); control เดิมยังรับสำหรับการ์ดเก่า
- เพิ่ม action ใหม่ใน allowlist ของ delivery plan (`apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts:120–123, 259`) และ parser ของ webhook controller
- เพิ่ม `workflowControl`, `workflowStart`, `fixedReadControl`, `reimbursementChoiceControl` เข้า `deterministicCommand` (pwu:6636) และ `allowDuringSupportPause` (pwu:6714) — แก้ B5
- **Message buffer, R4-F2 remains CLOSED after re-anchor:** `LineMessageBufferService.appendAccepted` currently recognizes existing controls at `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:475`; new controls must become commands and be excluded from the non-company menu fast path (:510–511). Idle commands already enter the worker (:499–503); non-idle controls must retain queued order and use the awaited dispatch (:707), with singleton groups in `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:399–401`. Add `workflowControl`/`workflowStart`/`fixedReadControl` to types, command recognition, frozen payload and `toTextEvent` copies (`line-message-buffer.service.ts:1061,1090`), plus controller parsing (`apps/api/src/modules/auth/presentation/line-webhook.controller.ts:96–125`). Orphan parsing/replay preserves the envelope (`apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts:89,233`). Preserve current `company-select`/`company-page` parsing (`line-staff-menu.logic.ts:955–956`) and company resolution (`pwu:6672`). Keep AC22 fresh, frozen/orphan and queued `/company B` regressions on free and paid paths; no new company-selection implementation.

### 7.2 Classifier endpoint (gateway)

`POST /v1/internal/ai/line-workflow-classify` — `@Post('line-workflow-classify')` ใน `LineAiInternalController` (`@Controller('internal/ai')`, `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:390–393`) ใช้ `AiUsageInterceptor` เดิม; API client `requestLineWorkflowClassify` (path `/internal/ai/line-workflow-classify`, รูปแบบเดียวกับ `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:167–292`)

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
- thinking/effort: Sonnet 4.6 ไม่เปิด thinking เมื่อไม่ส่งพารามิเตอร์ (ทั้ง Converse และ Messages API); Haiku 5.5 เปิด adaptive thinking เป็นค่าตั้งต้น → classifier ส่ง `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }` (ชื่อของ Messages API; ปิด thinking ได้เมื่อ effort ≤ high — R19) ผ่าน `additionalModelRequestFields` ของ Converse (ชื่อบน Bedrock ยืนยันตอน probe — §17.1 MC5); ตั้งแต่ 2026-11-08 (รอบ 24b) `AnthropicApiProvider` ก็ส่ง `thinking: { type: 'disabled' }` + `output_config.effort: 'low'` ให้ Haiku 5.5 ด้วย (probe 1 ครั้งบน API key ผ่าน: thinking 0 โทเคน) จึงวัดความถูกต้องบน API key ได้; เวลาตอบของ production ยังต้องวัดบน Bedrock ตอน UAT (MC5); ถ้าเกิดบนเครื่องแล้วโทเคนหมดที่ thinking → `output_limit` → absorbed + Tier 2 (R12)
- timeout 5,000 ms (หรือเหลือของ work deadline ของ classify grant) ผ่าน `deadlineAt`/`AbortSignal` เดิม; หมดเวลา/ตก → Tier 2 (absorbed)
- **ยิงซ้ำ (รอบ 22):** ถ้าครั้งแรกยังไม่ตอบใน 2,200 ms ส่งคำขอเดิมอีกหนึ่งครั้ง (call index 1 ผ่าน `budget-step` ของตัวเอง) คำตอบแรกที่ผ่าน `acceptOutput` ใช้ อีกครั้งถูกยกเลิก; ครั้งที่ยกเลิกหรือล้มเหลว บริษัทรับเอง ลูกค้าจ่ายไม่เกินหนึ่งครั้ง; ไม่ยิงซ้ำเมื่อครั้งแรกล้มเร็ว เวลาเหลือน้อยกว่าราว 1.5 วินาที หรือ budget ปฏิเสธ; คำขอที่ได้ admission แล้วแต่ไม่ได้ส่งถึง provider ต้อง settle เป็นศูนย์ (ไม่ทิ้ง hold `DISPATCHED`) — ที่มา: v13 มี 3 ใน 80 ครั้งที่ค้างถึงเพดาน ทั้งที่ครั้งอื่นตอบภายใน 2.6 วินาที
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

### 7.2.2 Preserve the advisor and free boundary (R26/R27)

The gap is in the earlier design/coverage, not a newly observed scope-policy bug: `VAT 7% คิดยังไงคะ ถ้าราคาสินค้ารวมภาษีแล้ว` was excluded from eval, although the held-out case requires an answer (`scripts/line-ai-expense-advisor/corpus.heldout.json:624–632`); `ช่วยออกใบแจ้งหนี้ให้ลูกค้าหน่อยครับ` must keep the package reply and never claim issuance (`scripts/line-ai-expense-advisor/corpus.tuning.json:4760–4784`). A generic Tier 2 fallback did not explicitly protect either path after adding the classifier.

Smallest change: in B3/B4, non-workflow `read/howto/open/smalltalk/multi/unclear` continues to `ProcessLineWebhookUseCase.tryRouteIntake` with the original text/evidence, current company/permissions/entitlements and existing turn authority. Do not add an unsold label, formatter, model-free conversion or tool. Reuse `scopePolicyOverride` (`apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406,417`): general knowledge returns no override; unavailable shop data returns the fixed package override. Existing `OrchestratorAgent.runTurn` applies it before tools (`apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:1168–1175`); `runSemanticTurnV2` applies it per clause (`apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts:692–717`). Mixed requests preserve the independently answerable knowledge clause. Do not rewrite this policy.

Charging: `no_tool` means no ERP tool, not no model. Keep existing paid admission and settlement; add no refusal-specific charge, reserve or unsold-read call. The fixed scope override itself creates no planner/compose call in the sole-clause path; model/classifier costs remain visible in W13. Failed/unusable calls remain R12, owned by trust/money P07. This adds no alternative billing rule.

Free entry already returns at `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6942`, before intake `pwu:7050` (commit `049aa51de`); insert no new classifier above it. Preserve `services` and `receipt` before that return (`pwu:6827–6861`), including `WELCOME_RECEIPT_COMMAND` (`line-staff-menu.logic.ts:885`), public support/company/package commands and the welcome's package-advisor URI (`apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:456`, commit `9036b8552`). The existing advisor loads the catalog and matches offers in its form (`apps/api/src/common/security/line-package-advisor.page.ts:141,223–231`); it does not invoke the classifier. Media keeps its free-specific route and source-only persistence (`pwu:9974,10614`); do not replace OCR with typed classification. The free allowance and pending reservations remain in `free-expense-quota.ts:9,20–28`; commercial/attachment gates remain in `expense-commercial-access.ts:22–25` and `free-expense-attachment.ts:23–26`.

The new free wording gap is current: plain free Q&A returns `FREE_EXPENSE_CHAT_REPLY` without an action (`apps/api/src/modules/line-ai/domain/logic/free-expense-line.logic.ts:1`; `pwu:6938–6939`), and the text-edit constant unconditionally suggests editing (`free-expense-line.logic.ts:2`). In A1, keep the commercial early return and short refusal lead, pass same-message recovery as `deliverReply`'s existing third `quickReply` argument (`pwu:2659–2680`), using `lineChoiceQuickReply` (`line-business-card.logic.ts:41–46`): permission-checked expense-list URI when readable/configured, otherwise the existing support command. Offer edit wording only with current read/update access; one short sentence, no new permission or free semantic edit. Reuse `freeExpenseMenuReply`'s permission predicates (`free-expense-line.logic.ts:15–21`) rather than a new access rule. Test first with read-only, upload-only and read/update free actors in the named R27 webhook test.

Impact: API/LINE routing, Gateway guard regressions and eval manifests only. Preserve expense activity history at the existing source-update/audit boundary; no extra save for opening a card, modal or advisor, no new export/tax/notification write, no new permission/dependency/environment switch. Risks are classifier capture of a general question, bypassing D04, lost package guards or a false zero-charge assertion. First add the named R26/R27 tests in §14 before classifier integration; use current signed-delivery dedupe for repeated confirms (`pwu:3717–3731`, commit `3f6db1729`) rather than creating another suppression mechanism.

### 7.3 Provider schema and inherited charging boundary

A9/B6 **moved to expense-trust-and-money-fixes, step 2 / P07 (R6)**. That spec owns the complete current-caller inventory, validation before settlement, repair, counters and real-PG billing tests; do not implement those again here. New classifier code supplies its own schema/acceptance predicate through the shared hook once P07 lands.

B1 alone adds `ProviderInput.outputSchema` in `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts` and renders it in `BedrockProvider.generateText` / `AnthropicApiProvider`; unsupported providers refuse. Include schema bytes in `v2RenderedInput`, `schemaDigest` and `payloadDigest` in `apps/ai-gateway/src/common/usage/ai-budget-provider.ts`; absent schema preserves the existing digest. MC3/MC4 remain a provider/SDK proof, not an assumed capability. This is independent of changing existing callers' billing acceptance.

### 7.4 Budget amendment (ส่วนเพิ่มที่มีวันที่ใน `mangmee-ai-input-provider-budget-contract-2026-09-27.md`)

1. Tier 0 ไม่ขอ grant: เอาเงื่อนไข grant ออกจาก pwu:5376 และ :7761; `inputEvidence` จาก `textEvidenceV2` (pwu:4410–4423)
2. ปุ่มอ่านคงที่: `narrow` (bas:274–303) ยอม `nextOrdinal === 0` เฉพาะ `serverRoute === 'fixed_read'` + lane `simple` + profiles ⊆ `['line-answer/2']`; ถ้า prepared formatter ปฏิเสธ gateway คืนผลที่ไม่เรียกโมเดลตาม guard เดิม (`orchestrator.agent.ts:1210–1222`, `PREPARED_READ_UNAVAILABLE`) — guard คงไว้เพราะ grant นี้ไม่มี `line-control/2` ให้ planner; ทาง `fixed_read` ใช้ข้อความสั้น (§10) + ปุ่มเปิดรายการค่าใช้จ่ายของร้านปัจจุบัน; ไม่มีการเรียกโมเดลสำรองใน grant เดียวกัน
3. classifier: authority/profile แยก §6.4
4. Charging contract amendment is owned by expense-trust-and-money-fixes R6 / P07; this lane references that result and adds only the classifier profile
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
  - ตัวจับคำตอบในขั้นนี้ทำงานก่อน `answerReason` และยอมรับข้อความที่มียอด (ต่างจาก rda:198 และ pwu:5377 ซึ่งยังใช้กับช่องเหตุผล)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- ตัวตน/บริษัท/สมาชิก/ข้อตกลง/entitlement resolve ก่อนทุก handler ตามลำดับเดิม (pwu:6533–6714)
- `sig`/token ผูก company + user (+ act + id + pm + pd + pa) ด้วย `aiGatewayInternalSecret` ตรวจด้วย `timingSafeEqual`; token ของคนอื่น/บริษัทอื่น/สาขานอก scope → ปฏิเสธ ไม่บอกว่ามีรายการ
- การ์ด preview เรียก `preview(..., opened=true)` ซึ่งยังตรวจ `permitted` (lea:997–1012), สาขา (lea:259), สถานะ/revision, entitlement และตอนกดยืนยัน (lea:880–895)
- picker แสดงเฉพาะรายการที่ use-case คืนตาม scope และผ่าน predicate อนุญาต; ทางอ่าน LINE ใหม่ (`listForLine`, candidates `channel: 'line'`) อ่านอย่างเดียวและตรวจสิทธิ์ชุดเดิม
- classifier ไม่ได้รับข้อมูลร้าน (R8)
- แชตกลุ่ม/ห้อง: "กรุณาทำรายการในแชตส่วนตัวค่ะ" (pwu:6458–6462)
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
| การ์ดใบเสร็จระหว่างทำใบเบิก (pwu:10810) | (คงเดิม) | `ใช้บิลนี้ทำใบเบิก` (postback SOURCE) |
| classifier ไม่ชัด — 2 workflow | ต้องการทำเรื่องไหนคะ | {ชื่อ 1} {ชื่อ 2} `อย่างอื่น` (ชื่อจาก `LINE_CHAT_ACTIONS.title`) |
| classifier ไม่ชัด — 1 workflow | ต้องการทำเรื่องนี้ใช่ไหมคะ | {ชื่อ} `อย่างอื่น` |
| "อย่างอื่น" แต่ของเดิมใช้ไม่ได้ (E4) | พิมพ์บอกน้องมั่งมีอีกครั้งได้เลยค่ะ | — |
| ปุ่ม/token ใช้ไม่ได้ (ลายเซ็นไม่ผ่าน, ไม่พบ, ใช้แล้ว — E1 ก) | การ์ดนี้ใช้ไม่ได้แล้วค่ะ | `เปิดเมนู` (targetless existing menu command; no target disclosed) |
| การ์ดที่เก็บไว้หมดอายุจริง + รู้เป้าหมายจากข้อมูลที่ลงนาม (E1 ข) | การ์ดนี้หมดเวลาแล้วค่ะ | `เตรียมการ์ดใหม่` (wf_open) |
| ปุ่มอ่านคงที่ — ดึงข้อมูลไม่ได้ (`PREPARED_READ_UNAVAILABLE`) | ตอนนี้ยังดูยอดให้ไม่ได้ค่ะ | `เปิดในเว็บ` (หน้าของ id นั้น) |
| คำถามแทรกระหว่างรอช่อง (ต่อท้ายคำตอบ Tier 2 ครั้งเดียว) | ↩️ {คำถามเดิมของช่อง เช่น "ยกเลิกรายการนี้เพราะอะไรคะ" lea:338} | — |
| คำทักทาย | (คงเดิม `EXACT_GREETING_REPLY`) | quick reply เมนูเดิม |

อังกฤษ: "I cannot fetch this total right now.", "Expense category: {name}", "The details are complete; get the form to sign on paper.", "Get a form to sign on paper", "Which one do you mean?", "Do you want to do this?", "Choose the claim to submit.", "This card has expired.", "Prepare a new card", "Something else", "Too many records to search in chat.", "Which supplier do you mean?", "Choose from the latest records.", "What is the amount?", "What is this expense for?", "Please type your request again."

## 11. Impact analysis

| ส่วน | ผลกระทบ | สิ่งที่ต้องทำ |
|---|---|---|
| `pwu` | claim choice/answer/submit/รายละเอียดรายการก่อน intake; `handleWorkflowControl`; Tier 1 ก่อน `tryRouteIntake` (pwu:7050); ทักทายก่อน v2 route; pause allowlist (pwu:6636–6652); `taskRunId` | `process-line-webhook.use-case.spec.ts` |
| webhook controller | parse postback ใหม่ (`wf_open`, `wf_choice`, `fixed-read`, `chat-action` workflow) | `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` (:96–125) + `line-webhook.controller.spec.ts` |
| message buffer (รอบ 4 F2) | control ใหม่ผ่าน type/command/freeze/replay/`toTextEvent` | `line-message-buffer.service.ts`, `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts`, pwu `LineTextEvent` (pwu:240); ตรวจใน `line-message-buffer.service.spec.ts`, `line-message-buffer.logic.spec.ts` (ลงทะเบียนใน `apps/api/package.json`) |
| preview store (E1 ข) | บันทึกกู้คืน `recover:<previewId>` TTL 7 วัน | `line-draft-preview.store.ts`, lea (:588 สร้างการ์ด, :845–880 กด) |
| model admission (Phase C) | Haiku 5.5 ใน `REVIEWED_LINE_MODEL_CAPACITY`; classifier เลือก model เอง (§6.4) | `reviewed-line-model-capacity.ts`, `line-reliability-capabilities.controller.ts:24–37`, `ai-gateway.client.ts:162–178` |
| การ์ด/เมนู | message → postback (CREATE เท่านั้น); ปุ่มเริ่ม; picker; ปุ่มหมดเวลา | `line-staff-menu.logic.ts`, `line-business-card.logic.ts`, `line-reimbursement-draft-card.logic.ts`, `line-expense-action-card.logic.ts` |
| ใบเบิก | `choose` รับ choice ของ CREATE; `startFromWorkflow`; `parseManualClaimLine`; ทาง UPDATE ไม่แตะ | `rda`, `line-ai-classifier.logic.ts` |
| picker | service ใหม่ + ทางอ่าน LINE ใหม่ 2 ทาง | `LineWorkflowTargetService`; `disbursement-voucher.use-case.ts` (`listForLine`); `substitute-receipt.use-case.ts` (`channel: 'line'`) |
| expense/voucher | `wf_open` สำหรับ next/payment/wht + paymentIntent ใน postback (รวม `pa`); guard คำถาม (B2) | `lea`, `line-voucher-action.service.ts` |
| ใบทดแทน (B7, B8) | moved to expense-trust-and-money-fixes, step 1 / P04 (R5) + step 3 / P10 (R9); A4b reuses their tested continuation and signed apply | No duplicate continuation/category/card implementation in this lane |
| help card | เฉพาะ sold workflow ids ใน §6.1 เป็น postback `chat-action` → Tier 0; unsold/non-workflow output stays unchanged | `ai-tools.ts:257–303`, `line-business-card.logic.ts:48–61`, `line-staff-menu.logic.ts:957` |
| gateway | classifier + endpoint + `outputSchema`; new classifier uses the R6/P07 acceptance hook; existing-caller billing changes belong to trust/money | ไฟล์ agent ใหม่ 1, `line-ai-internal.controller.ts`, `bedrock.provider.ts`, `anthropic-api.provider.ts`, `openai.provider.ts`, `provider.port.ts`, `abp`, `ira`, `stv2`, `document-qa.use-case.ts` |
| budget authority | kind `webhook_classify` + คอลัมน์ต่อ kind; `serverRoute`; `creditState` | `bas`, `cbr` (read helper) |
| contracts | authorityKind, profile + digest, types | `abb`, `packages/contracts/src/line-ai.ts`, `ai-tools.ts` |
| config | ลบ `LINE_AI_EXACT_GREETING_ENABLED` + getter (`apps/api/src/common/config/app-config.service.ts:129`) | `packages/config/src/index.ts`, `index.test.ts` |
| notification | ปุ่ม `บันทึกจ่ายคืน` บน `workflow.reimbursement_ready_for_payment` | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:551, 656` |
| billing/entitlement | entitlement เดิม; 50 ทวิ เฉพาะ `wht_50bis`; B6 is a trust/money P07 dependency | — |
| migration | `LineAiTaskRun` + 3 คอลัมน์ (additive) | `apps/api/prisma/schema.prisma` |
| W00 manifest | ไฟล์ที่ hash เปลี่ยน; api intake `line.workflow_control` (`apps/api/src/modules/line-ai/line-ai-capability-manifest.ts`) | `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1` + อ่าน diff |
| whole-chain catalog | scenario: `claim-by-buttons-zero-model`, `claim-new-line-deterministic`, `typed-claim-one-classifier-call`, `low-confidence-choice`, `credit-out-mid-claim`, `next-step-after-ten-minutes`, `pending-reason-intervening-question`, `pending-payee-intervening-question`, `greeting-bound-chat-zero-model`, `fixed-read-button-zero-model`, `workflow-button-during-support-pause`, `unusable-output-absorbed`, `document-qa-unusable-absorbed`, `claim-edit-route-unchanged`, `substitute-typed-choice-shows-signed-card`, `partial-payment-next-step-keeps-amount`, `invalid-token-vs-expired-card`, `buffered-workflow-control-survives`, `substitute-category-not-written-before-confirm`, `substitute-issue-then-form-no-signature`, `fixed-read-unavailable-honest`, `expired-card-recovery-after-redis-ttl` | `scripts/line-ai-whole-chain-acceptance.catalog.mjs` |
| eval runtime | ตาม measurement spec §11 | — |
| AgentCore + Kamal | ไม่มี env ใหม่; digest เปลี่ยน → release เดียว (`infra/kamal/release.py:224–226`); existing semantic-turn billing changes/rebuild belong to trust/money P07; rebuild classifier artifact where required; ไม่แตะ `infra/prod-ecs-express/*` (`docs/runbooks/cloud-environment-operations.md:277–340`) | `docs/runbooks/uat-production-v2-deployment.md` |
| journeys/seed | reliability runtime ยิง webhook จริง (`scripts/line-ai-reliability-runtime.ts:237–452`) + seed ของ eval | measurement spec §6.4 |
| เว็บ | ไม่เปลี่ยน | — |

## 12. Gaps

| # | Gap | หลักฐาน |
|---|---|---|
| G1 | ปุ่มเลือกใบเบิกเป็นข้อความ | line-reimbursement-draft-card.logic.ts:303–320 |
| G2 | ปุ่มเลือกแบบ postback ยังผ่าน intake ที่คิดเงิน | pwu:7759–7761 |
| G3 | คำตอบเหตุผลต้องมี grant จาก intake | pwu:5376 |
| G4 | "ส่งอนุมัติ" รอ intake ก่อน | pwu:7050,7065 |
| G5 | ปุ่ม help card จบที่ข้อความ `command` → intake + planner | line-business-card.logic.ts:55, 58–60; line-staff-menu.logic.ts:957 |
| G6 | ปุ่มลัดอ่านข้อมูลคงที่ผ่าน intake | line-staff-menu.logic.ts:147–165; bas:291 |
| G7 | ไม่มีปุ่มบันทึกจ่ายคืนแบบ open token | line-reimbursement-approval-control.logic.ts:4 |
| G8 | ใบเบิกที่ค้างทำต่อด้วยปุ่มไม่ได้เมื่อเครดิตหมด | advisor-system-knowledge spec:246–252; pwu:7058–7062 |
| G9 | ไม่มี identity ของงานที่ทนทานสำหรับรายงานต้นทุน — task identity ข้ามข้อความมีแล้วใน task projection (`deliveryHash(['line-task', …])` pwu:4858, `item.taskRef` :4867, เก็บผ่าน `LineConversationContextService` :2195) แต่ไม่ผูกกับการจอง/usage และ log ต่อ turn มี `costSatang: null` | pwu:4858, 4867, 9395 |
| G10 | router ไม่บังคับ schema | ira:406–407 |
| G11 | การเลือกโมเดลยึด `grant.model` ของ request (classify grant แยก จึงเลือกเองได้ในรอบ C) | `provider.factory.ts:21–29` |
| G12 | สูตร LINE fake บนเครื่องไม่อยู่ใน git | ค้น `docs/` ไม่พบ |
| G13 | Multi-task message continuation "ทำขั้นตอนถัดไป" still uses metered intake; signed expense-action next buttons are already deterministic (§1.1) | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:4830–4834,7050`; `docs/agent-memory/advisor-exam-fix-e.md:8` |
| G14 | tool รายการของ LINE ตัดที่ 10 แถว ไม่มีตัวกรองตาม action | reimbursement-summary.use-case.ts:287, erp-reimbursement-tools.use-case.ts:59, line-counterparty.service.ts:77 |
| G15 | read tool ของใบเตรียมจ่ายใน LINE ผ่านด่าน LINE session ด้วยการตั้ง `authProvider: 'watchdog'` (อ่านอย่างเดียว สิทธิ์ยังตรวจ) — ทาง `listForLine` ใหม่ทำแบบชัดเจนแทน | erp-advisor-document-tools.use-case.ts:15–19; disbursement-voucher.use-case.ts:69–72 |
| G16 | รายละเอียดรายการใหม่ของใบเบิกไม่มีตัวแยกแบบ deterministic | rda:536–545; pwu:5377; rda:198 |
| G17 | ไม่มีรายการ "รายจ่ายที่ทำใบทดแทนได้" ทาง LINE (ของเว็บเรียก `assertWeb`) | substitute-receipt.use-case.ts:474 |
| G18 — in scope docs correction | Old spec treated `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` as a release switch, but active code uses a constant | `apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts:1780–1786`; `orchestrator.agent.ts:1918` — reuse the existing approved sold formatter; no new switch or registry expansion |
| G19 — out of scope current fast-path hazard | Existing stateful commands also satisfy the broad non-company fast-path condition; this lane changes only its three new controls | `line-message-buffer.service.ts:475,510–511` includes existing expense controls/input evidence; static ordering hazard, not a reproduced data leak; separate existing-control audit, no expansion of A2 |
| G20 — test-registration gap | W00 and standalone PG/continuation tests are not package-listed | `apps/api/package.json` grep counts in plan Traceability; existing whole-chain regressions only, no new assertions in those files |

| G21 — in scope R15/R27 | Free chat refusal has no same-message way out; edit hint may promise editing without checking update access | `apps/api/src/modules/line-ai/domain/logic/free-expense-line.logic.ts:1–2`; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6941`; delivery adds only media choices or links in the text (`pwu:2669–2679`; `line-business-card.logic.ts:462–474`), so the plain free-chat constant supplies no exit; reuse current permission-gated menu predicates (:15–21 in `free-expense-line.logic.ts`) and existing quick replies, not new free capabilities |
| G22 — closed document gap, R26/M-R14 | Round 1 removed valid general-knowledge/package-denial regressions, despite current shared policy | `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406,417`; restore coverage, no policy rewrite |
| G23 — out of scope, wording handoff | The merged activity modal still maps human expense void to accounting jargon, and tax actions to technical labels | `apps/web/src/features/expenses/expense-history.logic.ts:11,15–16`; rendered at `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:89`. Human `expense.void` survives the history filter unless projected from claim authority (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:2091–2097,2117–2121`). Record for the wording lane; no modal/label change or tests here. |

## 13. Bugs ที่พบในโค้ดปัจจุบัน (ยืนยันจากการอ่านโค้ด ยังไม่ได้รัน)

| # | Bug | หลักฐาน | สถานการณ์ที่ล้ม | ความรุนแรง |
|---|---|---|---|---|
| B1 | ปุ่มขั้นถัดไปพึ่งที่เก็บ "applied" อายุ 120 วินาที ช่องเดียวต่อแชต | `line-draft-preview.store.ts:33, 209–225`; lea:243, 845–880 | ยืนยันรายการที่หัก ณ ที่จ่าย 3 นาทีต่อมากด "ทำใบเตรียมจ่าย" → "การ์ดนี้ใช้ไม่ได้แล้วค่ะ…" ต้องพิมพ์ → จ่ายค่าโมเดล | Medium |
| B2 | ช่องที่รอเหตุผล/ที่อยู่ รับคำถามเป็นค่า; ช่องชื่อผู้รับเงินได้คำถามแล้วลบงานค้าง | lea:977–993 (ลบที่ :988); เทียบ rda:195–198 | "ต้องใส่เหตุผลด้วยเหรอคะ" กลายเป็นเหตุผล; "ชื่อใคร?" ทำให้งานหาย | Medium |
| B3 | เลนทักทายไม่ใช้โมเดลไม่ทำงานในแชตส่วนตัว | `packages/config/src/index.ts:24–32`, pwu:9400–9406, 6715, 7050, 7075–7077, 7656 | "สวัสดีค่ะ" → intake + answer | Low |
| B4 | ข้อความปุ่ม/การ์ดหมดอายุเป็นทางตัน | lea:178, 877, 880 | ดู B1 | Low–Medium |
| B5 | ระหว่าง support pause ปุ่มเลือกใบเบิกและปุ่ม `chat-action` ถูกบันทึกเป็นข้อความถึงเจ้าหน้าที่ | pwu:6636–6652 (เทียบ :6620–6628) | ลูกค้าใน pause กด "ไม่มีใบเสร็จ" → ได้ข้อความรับเรื่อง | Low |
| B6 — moved to expense-trust-and-money-fixes R6 / P07 (owner step 2) | คำตอบที่ provider ส่งครบแต่ใช้ไม่ได้ (JSON อ่านไม่ออก/ผิด schema/ถูกตัดที่ max_tokens) ของ router, planner, compose **และ document QA** ถูกคิดเงินลูกค้า — settle ก่อนผู้เรียกตรวจผล และ absorb เฉพาะ `ok === false` | abp:429, 459 (settle ใน `finally`); ira:741 (parse หลัง settle); `document-qa.use-case.ts:92–93` (parse หลัง settle) → `QA_RESULT_INVALID` :97, :106; cbr:872, 859–860 | router ตอบ JSON วงเล็บผิด (เคยเกิด 6/8 ใน run 5) → `ROUTER_SEMANTIC_SCHEMA_INVALID` → ลูกค้าจ่ายทั้งครั้งแรกและครั้ง repair แต่ได้ "ยังไม่เข้าใจ" — ขัดกติกา Owner "การเรียก AI ที่ล้มไม่คิดเงินลูกค้า" | Medium (เงิน) |
| B7 — moved to expense-trust-and-money-fixes R5 / P04 (owner step 1) | ใบทดแทนที่ข้อมูลครบ (`pendingDecision: 'ISSUE_CONFIRM'`) รับคำตอบพิมพ์ "1"/"2"/คำตอบรับ แล้วแก้รายจ่าย (ยอมรับการตรวจเอกสาร, หลักฐาน SUPPORTING_ONLY) และเตรียมเอกสารที่มีเลขทันทีโดยไม่ผ่านการ์ดที่ลงนาม; การ์ด PREPARE ที่ลงนามเองก็ป้อน `messageText: '1'` เข้า continuation ตัวเดียวกัน จึงแยกการกดการ์ดกับการพิมพ์ไม่ได้ | continuation `issueDecisionChoice` :774–778 (`'2'` → FORM) → `line-substitute-receipt-continuation.use-case.ts:1918` → `answerIssueDecision` :2189 → `prepareFromLine` :2289, :2346 → `this.prepare.execute` :2394; การ์ด `line-substitute-receipt-action.service.ts:203` | ข้อความ "2" ที่ไปถึง continuation (route ความหมาย pwu:7886–7887 หรือทาง clarification pwu:7481–7483) → เอกสารถูกเตรียมพร้อมเลขโดยผู้ใช้ไม่เห็นการ์ดยืนยัน — ขัด R4; ทางที่ไปถึงในแต่ละสถานะพิสูจน์ด้วย test ที่ล้มก่อนแก้ (§17.1 MC9) | High (เขียนโดยไม่ยืนยัน) |
| B8 — moved to expense-trust-and-money-fixes R9 / P10 (owner step 3) | ใบทดแทน: คำตอบช่องหมวดค่าใช้จ่ายระหว่างเก็บข้อมูลเขียน `ExpenseRecord.expenseCategoryId` ทันที (ใน CAS เดียวกับสถานะ continuation) ก่อนมีการ์ดยืนยัน และข้อความตอบว่า "หมวดค่าใช้จ่ายบันทึกลงรายการให้แล้ว" | `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts:1992–2001` (`expenseCategoryId: acceptedNow.expenseCategoryId` at :2000) → `saveLineSubstituteContinuation` (`prisma-expense.repository.ts:4406`); ข้อความ `line-substitute-receipt-continuation.use-case.ts:1268`, อังกฤษ :1316 | ตอบ "หมวด: ค่าเดินทาง" แล้วเลิกทำ → หมวดของรายจ่ายถูกเปลี่ยนโดยไม่เคยยืนยัน — ขัด R4 | High (เขียนโดยไม่ยืนยัน) |

## 14. Test plan

- R26 first: `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` — `R26 non-workflow labels preserve knowledge and package replies`; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R26 classifier fallback preserves package replies and business knowledge`; retain `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` — `U2 definitions are general knowledge, while Starter shop reads and issuance remain gated`; `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` — `R26 fixed package reply adds no tool or compose call`. Cover every paid tier, lower-pack WHT denial and mixed knowledge/data input; assert no fabricated amount or successful mutation. Compare the complete business answer, not just a nonempty reply; preserve the existing business-versus-social shaping boundary (`apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts:1463–1467`).
- R27 first: the same registered API webhook spec — `R27 free commands and welcome bypass every text model call`. Pair the same VAT/data inputs in free and paid contexts; free has zero classifier/intake/planner/compose calls, original free refusal plus same-reply expense-list/support exit, zero business mutation and no customer AI charge. Include free welcome receipt, services, support, company switch and package-advisor handoff; rerun the existing free-boundary tests `refuses open chat and semantic edits before every model seam`, `keeps deterministic main menu usable without advertising financial actions` and `blocks a fourth image before downloading, routing or creating a draft` in that same API file. Existing quota/source-only/upgrade rules stay unchanged; no duplicate quota tests. Preserve existing replay-confirm suppression. No corpus/code edits in this round.

assertion ใหม่ของ API ทั้งหมดอยู่ในไฟล์ที่ลงทะเบียนใน `apps/api/package.json` แล้ว (ไม่สร้างไฟล์ ไม่แก้ scripts):
- `process-line-webhook.use-case.spec.ts`: ลำดับ Tier 0/1/2; ปุ่มไม่สร้าง reservation; ตัวแยกรายละเอียดรายการใหม่ (ยอดเดียว/หลายยอด/ไม่มีรายละเอียด/วันที่ไม่มีปี); คำตอบช่องก่อน intake; ทักทาย 0 call; credit-out mid-claim ตาม Q1; ปุ่มหมดเวลา; support pause; การ์ด §7.2.1 ทั้งสี่แถว; "อย่างอื่น" ได้ admission ใหม่และปฏิเสธเมื่อวันที่เปลี่ยน; การ์ดใบเบิก CREATE เป็น postback และ UPDATE/TARGET เหมือนเดิมทุก byte (P19); `wf_open` ของ VOUCHER_SUBMIT/APPROVE/PAY และ RECORD_PAYMENT พร้อม `pm/pd`; delivery plan รับ action ใหม่; adapter `choose`/`startFromWorkflow` (mock repo)
- `line-staff-menu.logic.spec.ts`, `line-business-card.logic.spec.ts`, `line-ai-classifier.spec.ts` (`isPendingFieldAnswer` ไม่ปฏิเสธที่อยู่ที่มีตัวเลข, `parseManualClaimLine`), `line-webhook.controller.spec.ts`
- `process-line-webhook.use-case.spec.ts` เพิ่ม: `wf_open` ที่มี `pa` (จ่ายบางส่วน) ได้ยอดเดิม; `second_label` ซ้ำ; E1 (ก)/(ข) ได้ข้อความตามตาราง §10 รวมกรณี preview ใน Redis หายแต่มีบันทึกกู้คืน; picker รายจ่าย (P11): `pageSize: 100`, ค้างจ่ายอายุ > 90 วันอยู่ในผล, Σ `total` > 300 → ข้อความค้นไม่ครบ; `fixed-read` ทั้งสองผล (prepared รับ / `PREPARED_READ_UNAVAILABLE`)
- buffer (F2) ใน `line-message-buffer.service.spec.ts` + `line-message-buffer.logic.spec.ts`: `workflowControl`/`workflowStart`/`fixedReadControl` เป็น command, อยู่ใน payload ที่ freeze, รอด sweep replay และถึง `processWebhook.execute` ครบ
- `internal-tools.controller.spec.ts`, `erp-reimbursement-tools.use-case.spec.ts`, `reimbursement-request.use-case.spec.ts`: picker ตาม scope, assignment ตรึง, `exhaustive`, ผู้สร้างที่ไม่มี read scope เห็นเฉพาะของตัวเอง
- `ai-gateway.client.spec.ts`, `line-intake-dispatch.use-case.spec.ts`: client classifier, turn grant เหมือนเดิมทุก byte
- **PostgreSQL จริง** ใน `company-ai-usage-meter.spec.ts` (ลงทะเบียนใน `apps/api/package.json` และมีแบบทดสอบ "real PostgreSQL:" ที่ใช้ `DATABASE_URL` อยู่แล้ว — `company-ai-usage-meter.spec.ts:262–268`) รันด้วย `scripts/local-proof/realpg.sh <tag> src/modules/line-ai/application/company-ai-usage-meter.spec.ts` (realpg.sh ตั้ง `DATABASE_URL`): classify authority แยกคอลัมน์และไม่กระทบ turn; เรียกได้ครั้งเดียว; narrow ordinal 0 เฉพาะ `fixed_read`; `creditState` ไม่เขียนแถว; classify replay uses the original decision; billing acceptance/settlement duplicates remain trust/money R6/P07 tests — ไฟล์ PG ใน catalog (`line-ai-budget-authority.pg.spec.ts` ฯลฯ) ยังรันเป็น regression เดิม แต่ไม่ใช่ที่อยู่ของ assertion ใหม่
- **Gateway:** `bedrock.provider.spec.ts` and `ai-usage.interceptor.spec.ts` cover new outputSchema rendering/digests; `line-intake-router.agent.spec.ts` / `line-ai-internal.controller.spec.ts` cover the new classifier and its P07 acceptance hook. Existing router/planner/QA billing tests and caller changes are owned by trust/money R6/P07, not repeated here.
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
| AC6 | เครดิตหมดกลางใบเบิกบน paid path (Q1 answered 2026-11-04) | ปุ่ม/คำตอบช่อง/ยืนยัน 0 reservation; ข้อความพิมพ์ใหม่ได้การ์ดเครดิตเดิม |
| AC7 | "สวัสดีค่ะ" ไม่มีงานค้าง | 0 call; ไม่มีสวิตช์ทักทายในโค้ด |
| AC8 | Sold fixed read `expense_month` only (`ค่าใช้จ่ายเดือนนี้`) | Prepared success or unavailable recovery both make 0 model calls; button opens sold expense list; unsold QUERY_ACTIONS receive no conversion, formatter or new tests |
| AC9 | B1/B4 — รวม VOUCHER_SUBMIT → APPROVE → PAY และบันทึกจ่ายที่มีวิธีจ่ายเดิม | กดหลัง 30 นาทีได้การ์ดถัดไปพร้อมวิธีจ่าย/วันที่/ยอดเดิม (จ่ายบางส่วน 400 จาก 1,000 → การ์ดใหม่ 400 ไม่ใช่ 1,000); การ์ดหมดเวลา → ปุ่มเตรียมใหม่ 0 call |
| AC10 | B2 | คำถามไม่ถูกจับเป็นค่า ไม่ลบงานค้าง; ชื่อที่พิมพ์ต่อเติมงานเดิม |
| AC11 | สิทธิ์ | ไม่มีทางอนุญาต → คำปฏิเสธเดิม; ผู้สร้างที่มี `expense.create` + `expense.update` แต่ไม่มีสิทธิ์อ่าน: picker เห็นเฉพาะร่างของตัวเอง และลบ/ส่งตรวจได้ (MC1 answered 2026-11-04); token ข้ามคน/บริษัท/สาขาถูกปฏิเสธ |
| AC12 | B5 | ระหว่าง support pause ปุ่ม workflow ทำงาน |
| AC13 | held-out ของ measurement spec | ตาม MA3 |
| AC14 | เวลา | Tier 0 p50 ≤ 1.5 วิ p95 ≤ 3 วิ; Tier 1 ที่เริ่ม workflow p50 ≤ 3.5 วิ p95 ≤ 6 วิ ไม่มี > 15 วิ; ข้อความที่ fallback ไป Tier 2 ตาม A7 (full path p95 ≤ 15 วิ, ไม่มี > 30 วิ) โดยเวลาของ classifier รวมอยู่ด้วย และไม่เกิน deadline เดิมของ turn |
| AC15 | schema | probe ผ่าน; output ใช้ไม่ได้ = 0 ใน held-out |
| AC16 | B6 — moved to expense-trust-and-money-fixes R6 / P07 (step 2) | Acceptance owned there: AC6; new classifier integration must retain zero customer charge for unusable output |
| AC17 | ใบเตรียมจ่าย/50 ทวิ/ใบทดแทน จาก LINE | picker ใช้ `listForLine`/candidates `channel: 'line'`; ผู้ไม่มีสิทธิ์อ่านไม่เห็นรายการ; ไม่มีทางเขียนใหม่ |
| AC18 | ทางแก้ใบเบิกเดิม | การ์ด/ข้อความของ action UPDATE เหมือน baseline ทุก byte; journey แก้ใบเบิกในชุดทดสอบผ่านเท่าเดิม |
| AC19 | ปล่อยงาน | W00 regenerate + อ่าน diff; whole-chain ผ่าน; realpg ผ่าน; live replay ผ่าน; ข้อความใหม่ผ่านตัวตรวจบุคลิก |
| AC20 | B7/B8 — moved to expense-trust-and-money-fixes R5/P04 and R9/P10 (steps 1, 3) | Acceptance owned there: AC5/AC9; workflow integration reuses signed apply and proposed category, with no duplicate fix |
| AC21 | E1 | token ปลอม/ข้ามคน/ใช้แล้ว → ข้อความสั้น §10 + ปุ่ม `เปิดเมนู` ที่ไม่อ้างเป้าหมาย; การ์ดที่เก็บไว้เลย `expiresAt` → "การ์ดนี้หมดเวลาแล้วค่ะ" + `เตรียมการ์ดใหม่`; ไม่มีกรณีที่บอก "หมดเวลา" โดยพิสูจน์เวลาไม่ได้; preview ใน Redis หายหลัง 600 วินาทีแต่มีบันทึกกู้คืน → ปุ่ม `เตรียมการ์ดใหม่` ได้ preview ใหม่ 0 call |
| AC22 | control ผ่าน buffer (F2) | กดปุ่ม `wf_open`/`wf_choice`/`chat-action` workflow/`fixed-read` ระหว่างที่ buffer มีข้อความค้าง และหลัง process ตายแล้ว sweep replay → handler ได้ control ครบทุกครั้ง; ไม่มีกรณีกดแล้วเงียบ; **ลำดับ**: ระหว่าง turn ที่กำลังทำงาน ส่ง `/company B` แล้วกดปุ่มอ่านคงที่ → ปุ่มถูกประมวลผลหลังการสลับ ได้ข้อมูลของบริษัท B (หรือคำปฏิเสธสิทธิ์ของ B) ไม่มีข้อมูลของบริษัท A |
| AC23 | picker รายจ่าย (P11) | เป้าหมายค้างจ่ายที่อายุ > 90 วันถูกเสนอ; "ไม่พบ" เฉพาะเมื่อ Σ `total` ≤ 300 และอ่านครบ |
| AC24 | Existing ready-for-payment notification gains the workflow action | Only its existing concerned recipient receives it; no new recipient or owner-by-role broadcast; click rechecks current permission and branch |
| AC25 | R26; measurement MA6 | Paid knowledge retains a full advisor answer; unavailable shop data retains the existing package reply and permitted exit, zero unsold tools, invented figures or false mutation claims, no model-free conversion and no extra refusal charge; lower-pack WHT denial remains; mixed inputs retain independent knowledge answers. |
| AC26 | R27; measurement MA6 | Free eligible shops return before any classifier/intake/planner/compose call; deterministic commands/welcome receipt/package-advisor/support/company selection remain usable with their existing gates, allowed source OCR only, no paid workflow start/final write, and same-reply recovery. Paid upgrade is re-resolved, not guessed. |

## 16. Risks/rollout

- schema enforcement เป็นเงื่อนไขปล่อย Tier 1 (probe; ไม่ได้ทั้งสองทาง = ไม่ปล่อย Tier 1)
- grammar compile หลังหมดอายุอาจนานหลายนาที → timeout 5 วินาที (ยิงซ้ำที่ 2.2 วินาที) → Tier 2 (absorbed); W14 ใน telemetry
- classifier ผิด → ได้ตัวเลือก/preview ไม่มีการเขียน (R4)
- ข้อความเปิดเสีย classifier ~0.10–0.39 บาทและ ≤ 5 วินาที (ยิงซ้ำเฉพาะส่วนหางที่ช้า) → ประตู W13
- B6 fix ลดรายได้เครดิตจากการเรียกที่ล้ม (ตามกติกา Owner) — แจ้งในสรุป release
- action ใบเบิกที่ workflow เปิด ถ้าผู้ใช้พิมพ์งานใบเบิกอื่นไปทาง Tier 2 ระหว่างนั้น planner เดิมจะได้ `FINANCIAL_ACTION_SELECTION_REQUIRED` (rda:369–370) — ยอมรับ; workflow ทำต่อ action เดิมด้วยปุ่ม
- ปุ่มเก่าแบบข้อความในประวัติแชต → parser รับ label เดิม (R3)
- ปุ่ม workflow/อ่านคงที่ที่กดระหว่าง turn ที่กำลังทำงานจะรอ turn นั้นจบตามลำดับ (R4-F2) — AC14 วัดเวลาจากตอน chat idle
- B7 fix เปลี่ยนพฤติกรรมเดิม: คนที่เคยพิมพ์ "1" แล้วได้เอกสารทันที ต้องกดการ์ดอีกหนึ่งครั้ง (ตาม R4)
- digest เปลี่ยน → release เดียว; rollback ทั้งชุด; migration additive
- Rollout: Phase A → Phase B; proof stack → UAT ตาม runbook → Owner เดินจริง → Production เมื่อ Owner สั่ง; ไม่มีสวิตช์

## 17. Owner answers (เรื่องเงิน/ธุรกิจของ Owner เท่านั้น)

| # | สถานะคำตอบ | คำตอบเจ้าของ |
|---|---|---|
| Q1 | **answered 2026-11-04** | Paid path only: a step that calls no AI costs no credit, and a task that runs out of credit midway finishes; free D04 remains unchanged. |
| Q2 | **answered 2026-11-04** | Allow the Tier 1 Global model switch when MA4 passes, with the controller checking the privacy policy’s sub-processor and cross-border text covers a Global inference profile before switching (plan C3); Tier 2/OCR stays as designed. |
| Q3 | **answered 2026-11-04** | The budget for the whole program is 2,000 THB, shared with measurement Q1; M4 no longer waits for budget approval. |

### 17.1 Must close before coding

| # | เรื่อง | ใครปิด | ขั้นถัดไป/คำแนะนำ |
|---|---|---|---|
| MC1 — CLOSED; **answered 2026-11-04** | Creator without list-read rights may see only their own LINE items to send for review or delete a draft | Owner | Existing design: R21, §6.1 picker, AC11 and §14/Traceability test `R21 picker isolates creator tenant branch and frozen assignment`; reuse own-record filtering at `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:384` and existing action rights at `apps/api/src/modules/line-ai/application/line-expense-action.service.ts:1010`–1011; implementation/proof remains A4b, no new requirement ID. |
| MC2 — **CLOSED 2026-11-05** (controller security review: read-only, same permission and branch checks; existing signed continuations unchanged; a LINE prepare outside the signed substitute continuation is refused, web sessions are `watchdog` and unaffected) | เปิดทางอ่านใน LINE ของรายการใบเตรียมจ่าย (`lineConfirmed` ฝั่ง read) และรายการที่ทำใบทดแทนได้ (ข้าม `assertWeb` ฝั่ง read) | Controller (security review) | แนะนำเปิดเฉพาะการอ่าน + ตรวจสิทธิ์เดิม + test ว่าทางเขียนยังปิด |
| MC3 — **CLOSED 2026-11-05** | Sonnet 4.6 บน Converse รองรับ structured outputs หรือไม่ | Controller | One local Bedrock probe (`global.anthropic.claude-sonnet-4-6`, ap-southeast-1) returned valid JSON under `output_config`; the cold call took 5,625 ms, so B5 keeps the post-deploy warm-up call |
| MC4 — **CLOSED 2026-11-05** | SDK 3.1075.0 มี type `outputConfig` หรือไม่ | Controller | Yes: `ConverseCommandInput.outputConfig.textFormat` and `ToolSpecification.strict`; no dependency change |
| MC5 | ชื่อพารามิเตอร์ปิด thinking/effort ของ Haiku 5.5 ใน `additionalModelRequestFields` ของ Converse (Messages API ใช้ `thinking: { type: 'disabled' }` + `output_config: { effort: 'low' }`) | Lane C2 | probe 1 ครั้งบน UAT ตาม runbook; ไม่ผ่าน → ไม่เริ่ม Phase C |
| MC6 | Task retention | Closed by local trace | Reuse `RecoverOrphanLineEventsUseCase.purgeExpiredEvents` (`recover-orphan-line-events.use-case.ts:387–407`) and its `aiDataRetentionDays` cutoff; A7 adds task deletion in that sweep, before event deletion |
| MC7 | สูตร attempt key ของรูป/OCR สำหรับรายงานต้นทุน | Lane M1c | ไล่ทุกสูตรแล้วบันทึก |
| MC8 | B6 caller inventory/rebuild | Trust/money R6 / P07 | moved to expense-trust-and-money-fixes, step 2; no duplicated work here |
| MC9 | Typed substitute reachability / signed apply | Trust/money R5 / P04 and R9 / P10 | moved to expense-trust-and-money-fixes, steps 1 and 3; failing tests and path proof owned there |
| MC10 | ค่า context/output ของ Haiku 5.5 สำหรับ `REVIEWED_LINE_MODEL_CAPACITY` (ceiling 100,000 ให้ตรง tariff ≤ 100k prompt) | Lane C1 | อ่าน AWS model card แล้วบันทึก URL/วันที่ในคอมเมนต์แบบแถวของ Sonnet |
| MC11 | Sold fixed-read family | A6b | Closed by code trace 2026-10-26: `line-staff-menu.logic.ts:155` and existing `expense.list_recent::single_metric` formatter; only `expense_month` is designed |

### 17.2 Focused review results — CLOSED

R4-F1's design review closed 2026-10-24; implementation moved to trust/money R9 / P10. **R4-F2 CLOSED by focused review 2026-10-26**: the proposed controls are commands, excluded from the menu fast path, dispatched by the awaited worker as singleton groups; frozen replay preserves their envelope. This closes the design-review blocker, not an implementation/runtime claim. Q1–Q3 are answered 2026-11-04 and MC1 is closed through the existing design; per-step engineering proofs remain.

| Review id | Opened evidence | Disposition / regression |
|---|---|---|
| R4-F1 / B8 | `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts:2000` — `expenseCategoryId: acceptedNow.expenseCategoryId` | Closed design; moved to expense-trust-and-money-fixes, step 3 / P10 (R9) |
| R4-F2 | `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:511` — `void this.dispatchBatch`; `:707` — `await this.dispatchBatch`; `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:399–401` — `groups.push({ kind: 'command', item })`; `apps/api/src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.ts:89` — `return envelope as LineBufferEnvelope`; `:233` — `await this.buffer.enqueue(envelope, true)` | CLOSED 2026-10-26. Keep AC22 fresh control, frozen/orphan replay and queued `/company B` ordering tests in A2. No redesign or new review dependency. |

## Develop changes checked 2026-11-04

| Changed finding | Current evidence and commit | Plan decision |
|---|---|---|
| Never-paid shops are no longer uniformly locked; D04/source-only access exists | `049aa51de`; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933–6942`; commercial gate `apps/api/src/modules/expenses/application/expense-commercial-access.ts:22–25` | Preserve admission, quota and source writers; R27/A1/B4 adds classifier-boundary regressions and the narrow G21 recovery fix only. Paid R26 is not free typed Q&A. |
| Welcome receipt and package-advisor entry already exist | `9036b8552`; `line-staff-menu.logic.ts:885`; `apps/api/src/modules/external-signup/application/line-signup-notify.service.ts:453–457` | Preserve commands/URI and cohort, no replacement advisor or welcome work. |
| Accepted duplicate confirmation result is already suppressed | `3f6db1729`; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3717–3731` | A5/A8 retain integration regressions; do not rebuild suppression. B1/B4 expiry remains a separate current gap. |
| Activity history already records updates and is free-allowlisted | `1fbba874e`/`884ba5307`; existing modal `apps/web/src/features/expenses/ExpenseHistoryModal.tsx:77–96`; update hook `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts:1207–1212`; `apps/api/src/modules/system-partner-management/application/free-expense-access.ts:78` | Preserve existing writes/audit and read authorization; no modal/history implementation here. |
| Prompt-size/calibration wording was stale | Current `CONTROL_PROMPT` is at `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts:89` (file history includes `73a28b6d5`); `62d6b4393` registered two calibration sizes with the same bound (`apps/ai-gateway/src/common/usage/intake-token-calibration.ts:9–16`) | Remove the unsupported 12,782-character claim; show both registered calibration sizes as historical reviewed bounds. No prompt/calibration fix or new benchmark is added. |
| Company-picker executable commands already survive delivery | `48295b57c`; `apps/api/src/modules/line-ai/domain/logic/line-language.logic.ts:7–14` preserves message-action text; existing registered adapter regression at `apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts:10` | Preserve display-only sanitization in A2/A8; do not rebuild picker delivery. Location clarification: this merged fix is in the visible-text transformer, while the buffer order checks below remain unchanged. |
| Company-selection ordering is already protected | `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:510–511,707`; `line-message-buffer.logic.ts:399–401`; current `git log --oneline -- <buffer file>` includes `de9832352`, `c1adb5e56` | R4-F2 stays closed; A2 changes only transport of its three proposed controls and keeps AC22. No claim that the company-selection change introduced a new buffer bug. |

Current B1–B8 and MB1–MB3 remain visible at the re-anchored evidence; the changes above do not fix them. B6/B7/B8 stay exclusively with trust/money P07/P04/P10.

## 2026-10-26 change boundaries and first checks

| Requirements | Concrete failing input / current or former-design result | Smallest implementation target / impact | Risk / test first |
|---|---|---|---|
| R2/R22 (A6a) | Press the sold `สร้างใบเบิก` help action alone in Thai → `productHelpQuickReply` emits text (:56), then `chat-action` also resolves back to text (`line-staff-menu.logic.ts:957`) → metered intake | Change `productHelpQuickReply` in `line-business-card.logic.ts` per **sold workflow id**, and workflow handling in `process-line-webhook.use-case.ts`; keep unsold/non-workflow branches unchanged; API/LINE only, no export/tax/notification rule change | A global helper rewrite would alter unsold help; first add `R3 signed or stored control rejects cross-owner replay` and the sold card tests in the trace table |
| R22 (A6b) | Press `ค่าใช้จ่ายเดือนนี้` → `line-staff-menu.logic.ts:155`, `messageAction`, then intake; former plan mapped every QUERY_ACTION including unsold sales | In `line-staff-menu.logic.ts`, update **both** `buildStaffCompletionQuickReply` (:172–175) and `buildStaffQueryMenu` (:578–580), plus `linePostbackCommandText`; use one existing `expense.list_recent::single_metric` formatter (:1741, :1783), existing permission-checked API tool, server plan and narrow guard; no formatter change, no AI Gateway DB reads | Missing one button renderer leaves paid reads; first add `R22 expense month is the single fixed-read entry` and success/unavailable/permission cases in registered webhook tests |
| R23 (A2) | New control after queued `/company B` would be dropped by old `toTextEvent` or overtake through :511 if merely tagged command | Add three controls to type/command/frozen payload/`toTextEvent`, exclude them from fast path; reuse singleton groups, awaited worker and unchanged orphan envelope; no new notifications/export/tax work | Closed design review still needs AC22 fresh, frozen-replay and company-order failing regressions before implementation; no review blocker is reopened |
| R4/R12 | Typed substitute `2` can prepare; a category answer writes the expense; complete invalid JSON can be charged | **moved to expense-trust-and-money-fixes**: step 1/P04 R5, step 2/P07 R6, step 3/P10 R9; only integrate their tested boundaries | Never copy the older implementation sketch; use their exact test names and acceptance; classifier is the only new caller needing its own acceptance predicate |

All other scoped changes retain the scenarios/targets/impacts in §§1, 6–14 and their trace rows below. Money and permission tests are written first; schema work stays additive. Existing sold web handoffs are exercised at 390, 1280 and about 1556 px in `e2e/journeys/claim-declined-then-paid.journey.spec.ts`, `payment-document-two-people.journey.spec.ts` and `no-receipt-certificate.journey.spec.ts`; LINE-card proof uses the webhook harness, not browser screenshots as a substitute.

## Traceability

R1–R21 retain their original ids. R22 is the sold ceiling (§3/§7.1), R23 is ordered durable dispatch (§7.1/AC22), R24 is task telemetry (§6.2), R25 is exact late-card recovery (§5 E1/§7.1), R26 preserves paid knowledge/package replies and R27 preserves free D04 admission (§7.2.2). These ids cover the catalog, defaults, contracts, permissions, UI and release obligations; detailed clauses remain in their cited sections. Test names below are **planned**, not claims of execution. API tests use registered files; the plan records actual grep counts. A9/A10 rows name the external owner so there is one implementation.

| Requirement | Opened evidence (quote ≤15 words) | Plan step | Test file + proposed test name | Acceptance | First source document |
|---|---|---|---|---|---|
| R1 — tier order | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7050` — `this.tryRouteIntake` | A3b, B4 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R1 tier zero owns a sold workflow before classifier` | AC1/AC2/AC5 | `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` ค16–17 |
| R2 — pending answers | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5376` — `this.budgetGrantsV2.has(event)` | A3c, A3b | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R2 claim answers precede metered intake` | AC1/AC10 | `docs/specs/line-ai-workflow-first-spec.md` §1.2 G3 |
| R3 — bound controls | `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:155` — `revision: digest` | A2, A3a | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R3 signed or stored control rejects cross-owner replay` | AC11/AC18 | `docs/specs/line-ai-workflow-first-spec.md` §5 R3 |
| R4 — signed apply (moved) | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts:203` — `messageText: '1'` | A10 → trust/money step 1/P04 R5 + step 3/P10 R9 | `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` — `R5 typed issue or form never prepares`; `R9 category stays proposed until signed confirmation` | AC20 → trust/money AC5/AC9 | `docs/specs/line-ai-workflow-first-spec.md` §13 B7/B8 |
| R5 — missing fields/defaults | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7049` — `this.textValueCandidates` | A3c | `apps/api/src/modules/line-ai/domain/logic/line-ai-classifier.spec.ts` — `R5 manual claim line uses one amount and Bangkok date` | AC1/AC2 | `docs/specs/line-ai-workflow-first-spec.md` §7.5 |
| R6 — interruption guard | `apps/api/src/modules/line-ai/application/line-expense-action.service.ts:988` — `await this.store.discard` | A3b | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R6 question keeps pending payee and reason` | AC10 | `docs/specs/line-ai-workflow-first-spec.md` §13 B2 |
| R7 — classifier admission | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7045` — `!await this.answersOpenWork` | B4 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R7 open work and media bypass classifier` | AC2/AC5 | `docs/specs/line-ai-workflow-first-spec.md` §5 R7 |
| R8 — source-bound slots | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7049` — `this.textValueCandidates` | B3, B4 | `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` — `R8 classifier sends no shop data and keeps exact spans` | AC2/AC15 | `docs/specs/line-ai-workflow-first-spec.md` §5 R8 |
| R9 — confidence and choice | `apps/api/src/modules/line-ai/application/line-reimbursement-draft-adapter.service.ts:166` — `input.control.revision !== digest` | B3, B4, B5 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R9 low-confidence choices and other get fresh admission` | AC4 | `docs/specs/line-ai-workflow-first-spec.md` §7.2.1 |
| R10 — provider schema | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts:6` — `export type ProviderInput`; https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html | B1, B3 | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts` — `R10 output schema reaches provider and budget digest` | AC15 | `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` ค19 |
| R11 — supported probe | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts:83` — `new ConverseCommand` | B1 | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts` — `R11 unsupported schema capability refuses safely` | AC15 | `docs/specs/line-ai-workflow-first-spec.md` §17.1 MC3/MC4 |
| R12 — no unusable charge (moved) | `apps/ai-gateway/src/common/usage/ai-budget-provider.ts:459` — `await settleV2` | A9 → trust/money step 2/P07 R6; B3 integration only | `apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts` — `R6 unusable calls charge zero and settle once`; new classifier in `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` — `R12 unusable classifier is absorbed` | AC16 → trust/money AC6 | `docs/specs/line-ai-workflow-first-spec.md` §13 B6 |
| R13 — credit boundary (Q1) | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7060` — `this.answerAiCreditRefusal` | A1, A3b | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R13 started claim completes after credit exhaustion` | AC6 | `docs/specs/line-ai-workflow-first-spec.md` §17 Q1 |
| R14 — no behavior switch | `packages/config/src/index.ts:326` — `LINE_AI_EXACT_GREETING_ENABLED` | A6c, A6b | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R14 greeting and sold fixed read need no feature switch` | AC7/AC8 | `docs/specs/line-ai-workflow-first-spec.md` §13 B3 |
| R15 — truthful plain Thai/recovery | `apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.ts:37` — `const MALE_PARTICLE` | A5, A6a, A6b, A8 | `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts` — `R15 sold cards have one truthful sentence and a way out` | AC19/AC21 | `docs/specs/line-ai-workflow-first-spec.md` §10; owner wording 2026-10-26 |
| R16 — existing recipient only | `apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts:551` — `current.recipient.userId` | A4a | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R16 ready-for-payment action goes only to existing recipient` | AC24 | `docs/specs/line-ai-workflow-first-spec.md` §5 R16 |
| R17 — web completion boundary | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts:174` — `เปิดเว็บเพื่อลงนามและอนุมัติใบรับรองค่ะ` | A4b, A10 integration | `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts` — `R17 LINE candidate reads do not admit web-only final writes` | AC17 | `docs/specs/line-ai-workflow-first-spec.md` §6.1 G17 |
| R18 — pinned cost/rounding | `apps/api/src/modules/line-ai/application/ai-model-pricing.ts:223` — `Decimal.ROUND_HALF_UP` | C1, M1b | `apps/api/src/modules/line-ai/application/ai-model-pricing.spec.ts` — `R18 classifier tariff rounds once and preserves exact report cost` | AC13; measurement MA4 | `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` ค23 |
| R19 — reviewed small model | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/reviewed-line-model-capacity.ts:8` — `'global.anthropic.claude-sonnet-4-6'` | C1–C3 | `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts` — `R19 classify model respects partner policy and reviewed capacity` | AC13/AC15 | `docs/specs/line-ai-workflow-first-spec.md` §6.4; MC5/MC10 |
| R20 — closed relevant tool set | https://arxiv.org/abs/2505.03275 (historical research; not re-fetched) | B3, B6 (only after evidence) | `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` — `R20 classifier labels contain only the sold workflow catalog` | AC13 | `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` ค24 |
| R21 — record/read permission | `apps/api/src/modules/expenses/application/expense-list-read-scope.ts:4` — `export function expenseListReadScope`; `apps/api/src/modules/line-ai/application/line-expense-action.service.ts:1010` — `ctx.permissions.includes('expense.delete')` | A4a, A4b (MC1 closed; MC2 remains) | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R21 picker isolates creator tenant branch and frozen assignment` | AC11/AC17/AC23 | `docs/specs/line-ai-workflow-first-spec.md` §5 R21 |
| R22 — sold conversion ceiling | `packages/contracts/src/menu-entitlements.ts:500` — `'wht_pnd53', 'wht_50bis'`; `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:155` — `['ค่าใช้จ่ายเดือนนี้'` | A6a, A6b; M1b/M3 | `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts` — `R22 expense month is the single fixed-read entry` | AC8/AC18 | `docs/specs/line-ai-workflow-first-spec.md` §1.2 G5/G6; owner ceiling 2026-10-26 |
| R23 — ordered durable controls | `apps/api/src/modules/line-ai/application/line-message-buffer.service.ts:707` — `await this.dispatchBatch`; `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts:401` — `groups.push({ kind: 'command', item })` | A2 | `apps/api/src/modules/line-ai/application/line-message-buffer.service.spec.ts` — `R23 fresh frozen replay and company switch retain control order`; `apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts` — `R23 control is a singleton command` | AC22 | `docs/specs/line-ai-workflow-first-spec.md` §17.2 R4-F2, focused review 2026-10-26 |
| R24 — task/cost telemetry | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:9395` — `costSatang: null` | A7; M1a–M4 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R24 task run links reservations without user text` | AC1/AC13; measurement MA5 | `docs/specs/line-ai-workflow-first-spec.md` §12 G9 |
| R25 — late/expired/partial payment | `apps/api/src/modules/expenses/application/services/line-draft-preview.store.ts:33` — `LINE_DRAFT_APPLIED_TTL_SECONDS = 120` | A5 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R25 expired preview recovers exact partial payment once` | AC9/AC21 | `docs/specs/line-ai-workflow-first-spec.md` §13 B1/B4 |
| R26 — paid knowledge/package fallback | `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:406` — `kind === 'general'`; `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts:417` — `reasonCode: 'PACKAGE_FEATURE_NOT_ENABLED'` | B3, B4, B5; M1b/M3 | `apps/ai-gateway/src/modules/line-ai/agents/line-intake-router.agent.spec.ts` — `R26 non-workflow labels preserve knowledge and package replies`; `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R26 classifier fallback preserves package replies and business knowledge`; retain `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` — `U2 definitions are general knowledge, while Starter shop reads and issuance remain gated`; `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts` — `R26 fixed package reply adds no tool or compose call` | AC25; measurement MA6 | `docs/specs/mangmee-advisor-system-knowledge-2026-09-29-th.md` G01–G04; controller correction 2026-11-04 |
| R27 — free model-free admission | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6933` — `if (resolvedAccess.freeExpenseDrafts)`; `apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts:885` — `WELCOME_RECEIPT_COMMAND` | A1, A6a/A6b/A6c, A8, B4, B5; M2/M3 | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `R27 free commands and welcome bypass every text model call` | AC26; measurement MA6 | `docs/specs/free-expense-drafts-spec-th.md` D02/D04; `docs/specs/new-shop-welcome-package-advisor-spec-th.md` A04 |
