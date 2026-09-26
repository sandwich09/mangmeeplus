# MangmeePlus: Financial Intelligence readiness audit

> Latest verification: `docs/research/mangmee-ai-code-verification-2026-09-26-th.md` supersedes AI/runtime conclusions tied to277 below. AWS v12 and the newer release receipt identify a2b926c6; chatKeyHash is now fixed, while fresh false-block/clarification/numeric/telemetry defects were reproduced on a2. The two277 latency rows remain historical evidence only.

วันที่ตรวจ: 26 กันยายน 2026 — ข้อเสนอเพื่อหารือ ยังไม่ใช่ spec/plan ที่อนุมัติให้ implement

## 1. ขอบเขตและข้อสรุป

ตรวจตามคำสั่งเจ้าของ: ไม่ใช้ข้อความการตลาดเป็นหลักฐาน ตรวจแพ็กเกจที่เปิดขาย โค้ดจริง เส้นทาง AI และความพร้อมต่อเป้าหมาย **Financial Data → Financial Intelligence → Business Financial Profile → Financial Services Needs** ทั้งฝั่ง SME และพันธมิตรธนาคาร

ระบบมี ERP/source evidence/permission-checked tools มากพอที่จะต่อยอด แต่ยังไม่มีหลักฐานว่าห่วงโซ่ข้างต้นทำงานครบพร้อมใช้งานทั่วไป ปัญหาที่ต้องแก้ก่อนเพิ่ม agent คือความหมายของตัวเลข การส่งบริบทข้ามบริการ การรู้ความสามารถที่เปิดจริง และการพิสูจน์คำตอบครบทั้งคำถาม

**ข้อแก้ไขสำคัญจากการตรวจเวอร์ชัน:** checkout นี้ HEAD `4a5817b4` เก่ากว่า release ที่บันทึกว่าขึ้น Production แล้ว (`277722ff6045298dac22182875379ea4826b00da`) วันที่ 25 กันยายน การอ่าน HEAD อย่างเดียวทำให้สรุปผิดทั้งแพ็กเกจและสถานะการแก้ AI จึงเทียบ source ทั้งสองเวอร์ชันก่อนให้ข้อเสนอ

ไม่มีการแก้ source code/package.json, เรียกโมเดลจริง, ส่งข้อความ LINE/ธนาคาร, ซื้อแพ็กเกจ หรือ deploy ในการตรวจนี้ มีเพียงอ่าน source, focused tests/mock probes, อ่าน Production metadata แบบ audited read-only และเขียนรายงาน/memory

## 2. ระดับหลักฐาน

- **LIVE-META:** อ่าน Production DB ณ วันตรวจผ่าน `infra/support/connect-production.sh view INC-20260926-AI-READINESS`; ยืนยัน `watchdog_support_ro`, `default_transaction_read_only=on`; session `watchdog-bedrock-dev-uhtl2f3efbgur4la8sbsyi69au` ออกจาก psql และจบ session ปกติ
- **RECORDED-RELEASE:** `docs/agent-memory/latest-main-kamal-uat-prod-2026-09-25.md` บันทึก signed/accepted release `277722ff`; AiTurn สองรายการล่าสุดที่อ่านได้ยืนยัน runtime source เดียวกัน ณ 2026-09-25 08:48 และ 09:02 UTC ไม่มีการตรวจ live host configuration ใหม่ทุกตัว จึงไม่ใช้แทน current deployment attestation
- **REPRO:** เรียกฟังก์ชันจริงใน local tree ด้วย synthetic data/provider stub ไม่ใช่ความถี่ hallucination จาก provider จริง; เทียบ source ของฟังก์ชันกับ release ที่บันทึกไว้
- **SOURCE:** พบจากเส้นทาง code จริง แต่ยังไม่ใช่ browser acceptance/live transaction
- **HISTORICAL:** incident เดิม ซึ่งบางสาเหตุแก้ใน release ใหม่แล้ว

Public catalog/health ผ่านเครื่องมือ HTTP อ่านไม่สำเร็จ (403); browser catalog route ที่ลองให้ 404/blocked ดังนั้นไม่อ้างผลนั้นว่าเป็น availability ของบริการจริง ใช้ DB metadata ที่เจาะจงแทน ไม่เปิด customer session และไม่ทดสอบทุกหน้าบน Production

## 3. แพ็กเกจที่เปิดอยู่จริง

LIVE-META พบ LIVE BillingSettings version 1 อ้าง ACTIVE policy version 1, account/mode scope ตรงกัน, `new_sales=true`, audience `ALL`; price binding ครบทั้งเดือน/ปีของสี่ tier (8 offers) และไม่มี offerTerms override

สิ่งนี้ยืนยัน DB configuration ของการเปิดขาย ไม่ใช่การทดสอบ checkout หรือ Stripe price active/runtime billingMode ใหม่ในรอบนี้

| Tier | สิทธิ์จาก source ของ release `277722ff` | สิ่งที่ห้ามอนุมาน |
|---|---|---|
| STARTER_249 | starter menus | ไม่มี sales/bank/ledger ทั้งชุดโดยอัตโนมัติ |
| BASIC_499 | starter menus; capacity ต่างกัน | จ่ายสูงขึ้นไม่ได้เปิด financial modules ทุกด้าน |
| PRO_999 | starter menus; capacity ต่างกัน | เช่นเดียวกัน |
| ENTERPRISE_1999 | starter + `wht_pnd53` + `wht_50bis` | **ไม่ใช่ full preset ใน release นี้** |

starter มี expenses, reimbursement, AI LINE, dashboard/notifications, employees/roles, branches/settings/security (17 feature keys) ส่วน `full` preset ยังมีสำหรับ entitlement/admin use; existing grants/admin overrides/paid snapshots อาจต่างจากการซื้อใหม่

อ้างอิง exact-release source: `git show 277722ff:packages/contracts/src/menu-entitlements.ts`, `packages/contracts/src/billing.ts`, billing service `catalog/settings/quote` และ feature entitlement applicator

LIVE-META launch gates: AI, expenses, reimbursement, CRM, sales_documents, procurement, inventory, banking, ledger, reports, workflow, thai_tax และ expense_auto_post มี stored state OPEN; 50 ทวิ SYSTEM ทั้งสาม route OPEN; VAT in-product offset CLOSED

**OPEN gate ≠ ซื้อสิทธิ์แล้ว ≠ มี permission ≠ setup พร้อม ≠ journey ผ่าน** ต้องประเมินทุกชั้น อีกทั้ง stored gate state ยังไม่แทน build attestation ของ launch guard

**ถอนข้อสรุปจาก HEAD เก่า:** ENTERPRISE เป็น full และ 50 ทวิ SYSTEM seed CLOSED เป็นข้อมูลเก่าแล้วใน release `277722ff`; release เปลี่ยนเป็นสิทธิ์ภาษีแคบและ route OPEN พร้อม UI issue/correction/replacement จึงไม่จัดสองเรื่องนี้เป็น missing capability

## 4. AI: สิ่งที่ยังผิดได้จริง และสิ่งที่แก้แล้ว

### A. Output guard ยอมรับตัวเลขที่มีอยู่ แต่ผูกความหมายผิด — ต้องแก้ก่อน

REPRO ผ่าน `ResponseComposerAgent.composeAnswer` ด้วย source result `sales.get_sales_summary: totalSales=1000.00, transactionCount=2, basis=recorded_received_payments`:

| Input | Provider stub | Actual output |
|---|---|---|
| ยอดรับเงินจริงเท่าไร | ยอดรับเงินจริง 2 บาท | ส่ง 2 บาท |
| ยอดรับเงินจริง 999 บาทใช่ไหม | ยอดรับเงินจริง 999 บาท | ส่ง 999 บาท |

คำตอบที่ถูกคือ 1,000 บาท ตัวตรวจรวมเลขจากทุก field/คำถาม/ประวัติเป็น allowlist ไม่ผูก metric–value–unit–period–source จึงยอมเอาจำนวนรายการมาเป็นเงิน และเอาข้อสมมติผู้ใช้มาเป็นข้อเท็จจริงธุรกิจ

Source: `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts:589–604,724–728,863+` ไม่มี HEAD→277722ff diff ข้อบกพร่องของ guard จึงอยู่ใน implementation เดียวกับ recorded runtime แต่การตรวจนี้ไม่ได้วัดว่าโมเดลจริงผลิตคำตอบดังกล่าวบ่อยเพียงใด และ sales เป็น feature ที่ต้องมีสิทธิ์จริงก่อนใช้

### B. AgentCore ยังส่งบริบทไม่ครบ

Local REPRO `validatePayload → payloadToTurnRequest` ทำให้ valueCandidates/openClarifications/chatKeyHash หาย แต่ **valueCandidates ถูกแก้แล้วใน277722ff** จึงเหลือข้อค้นพบ current-source ที่ openClarifications/chatKeyHash และ return coverage ไม่อยู่ใน mapping

`expense.explain_record` ใช้ chatKeyHash ค้น “บิลเมื่อกี้”; ไม่มีแล้ว `resolveFromChat` คืน undefined และ tool คืน found:false ได้ แม้รายการมีอยู่ การอ้างถึงของเดิมจึงต้องมี provenance ครบ ไม่ใช่ให้ LLM เดา ID

Exact-release mapping: `runtime.ts@277722ff:286–312,456–478`; API expense resolver `erp-core-detail-tools.use-case.ts:262,333–346`

### C. ถามสองเดือนตอบเดือนเดียว: เคยเกิดจริง แต่มี fix แล้ว

HISTORICAL Sept25 03:50 UTC: persisted request ถามสองเดือน มี tool call กรกฎาคมเพียงเดือนเดียว ยอดกรกฎาคมถูกตาม inclusive status basis แต่สิงหาคมหาย (`docs/agent-memory/prod-mangmee-two-month-expense-answer-2026-09-25.md`)

Local HEAD REPRO ผ่าน OrchestratorAgent.run JSON fallback: expense tool ถูกลบชื่อออกหลังเรียกครั้งแรก จึงเรียกกรกฎาคมครั้งเดียวและไม่มี coverage

**277722ff ส่ง valueCandidates ครบ และเพิ่ม deterministic completion ของ expense months / fast-path veto / unresolved-month clarification แล้ว** มี tests สำหรับ typo ที่พบจริง สองเดือน failed August และ budget ข้อผิดพลาดเฉพาะนี้จึงไม่ใช่รายการ “ยังไม่แก้” ในรายงานปัจจุบัน

JSON fallback ยังลบ tool name หลังใช้ครั้งแรก (`orchestrator.agent.ts@277722ff:1116`) แต่ต้องทดสอบ repeated-tool queries ชนิดอื่นแยก ไม่ใช้ reproduction เก่าฟันธงว่าทุกสองเดือนยังพัง ส่วน native path มี distinct inputs/parallel/coverage retry อยู่แล้ว

### D. Legacy path ปฏิเสธคำถามอ่านข้อมูลง่าย ๆ

REPRO เมื่อ orchestration=false และ permissions ถูกต้อง:

- “มีรายการรออนุมัติไหม” → mutation_blocked, ERP calls 0
- “ยอดขายเพิ่มขึ้นเท่าไร” → mutation_blocked, ERP calls 0
- “ขอดูกำไรขาดทุนเดือนนี้” → unsupported_yet พร้อมลิงก์ expenses

Substring classifier เห็น “อนุมัติ/เพิ่ม” แล้วถือเป็น mutation; financial keywords อยู่ unsupported list Source unchanged at277722ff แต่ไม่ได้อ่าน live feature flag จึงเป็น latent fallback/configuration defect ไม่ใช่หลักฐานว่า Production ทุกคำถามวิ่งเส้นนี้

งาน capability/expense edit ที่กำลังแก้ใน working tree เป็นงานแยก ยังไม่ใช่หลักฐานว่า deploy แล้ว และไม่แก้ numeric guard โดยอัตโนมัติ

## 5. ข้อมูลการเงินจริง: AI ไม่ใช่จุดผิดเพียงจุดเดียว

| ข้อค้นพบ | หลักฐาน | ผลต่อ advisor/profile |
|---|---|---|
| AP aging รวม currency แล้ว hardcode THB | Synthetic 100 THB + 100 USD → 200.0000 THB; `ap-reporting.use-case.ts:11+` | ต้องแยกสกุลเงินก่อนให้ AI สรุป/แนะนำ |
| AR tool นับ DRAFT invoice | Synthetic DRAFT100 → openCount1/outstanding100 แต่ basis ระบุ issued; `erp-core-detail-tools.use-case.ts:119+` | หนี้รอเรียกเก็บอาจถูกนับเกิน |
| Bank cash UI เปลี่ยน unknown เป็น0 และรวมข้าม currency เป็นบาท | `BankingPages.tsx:177–197`; API คืน currency/reconciliation dates | ยอดที่ไม่ทราบและยอดเก่าถูกแสดงเหมือนเงินจริงปัจจุบัน |
| Income-expense cashDifference รวม WHT และอ่าน payments บางกลุ่ม | Cash97+WHT3 → cashDifference100; `income-expense-ledger.logic.ts:40+` | ไม่ใช่ consolidated actual cashflow ของทั้งบริษัท |
| Sales summary มีนิยามต่างกัน | AI=recorded customer receipts by paidAt; report=issued invoices+pipeline | ต้องแยกยอดขาย/เก็บเงิน/pipeline/รายได้บัญชี |
| Ledger report บาง path ใช้ period-only balances, GL opening=0, missing period→zeros | `ledger/application/use-cases/report.use-case.ts:22+` | ยังใช้เป็นยอดคงเหลือสะสมหรือ profile ครบถ้วนโดยไม่ตรวจไม่ได้ |

AP/AR/banking/ledger อยู่ใน code/admin-enabled scope แต่ไม่ได้อยู่ใน starter/Enterprise ใหม่โดยอัตโนมัติ ข้อค้นพบนี้เกี่ยวกับระบบทั้งหมดและการขยายสู่เป้าหมายธนาคาร ไม่ใช่กล่าวว่าลูกค้าสี่แพ็กเกจเจอทุกข้อแล้ว

AP query ยังรับ asOfDate แต่ไม่ใช้ reconstruct historical state และ use case ไม่ส่ง branch scope; ต้องยืนยัน intended permission contract ก่อนให้ผู้ใช้คิดว่าเป็น historical/branch-scoped debt ห้ามสรุปจากการตรวจนี้ว่าเกิด data leak แล้ว

จุดที่ reuse ได้ดี: `banking/infrastructure/prisma-match-source.query.ts` มี sourceType/sourceId/currency/direction/date ครบ customer/expense/supplier/reimbursement/bank adjustment และตัด reimbursement-projected expense เพื่อไม่ให้นับซ้ำ เหมาะเป็นฐาน normalized payment facts มากกว่าบวกยอดจากแต่ละหน้าเข้าด้วยกัน

## 6. การใช้งานครบเส้นทาง

- Expense capture/review/payment/evidence/reimbursement มี implementation จริง และ daily-closing มี due/overdue/missing evidence/duplicate buckets ให้ใช้ต่อได้
- Simple income สร้าง invoice/payment/receipt แบบ atomic; sales document/payment/AP ไม่ใช่ placeholders แม้บาง navigation metadata ยังเขียน planned
- Banking import/matching/reconciliation/cash-position มี API จริง แต่ bank AI tools ถูก router-disabled และไม่มี executor; generic monthly report tool ก็ไม่ได้เลือก bank dataset
- Banking form ไม่ส่ง ledgerAccountId และไม่มี UI link/edit ขณะที่ complete reconciliation ต้องมี field นี้ จึงสร้างบัญชีใหม่ผ่านเว็บแล้วทำ flow จบผ่าน UI เดียวกันไม่ได้ถ้าไม่มีการ setup อีกทาง
- Banking read-only viewer เห็น create/deactivate เพราะ UI filter read tab แล้วไม่ gate write buttons; API ยังตรวจ manage permission จึงเป็น UX/contract defect ไม่ใช่ demonstrated authorization bypass
- Journal/closing UI ถูกซ่อนด้วย ACCOUNTING_UI_HIDDEN; period-closing route เป็น PlannedModulePage แม้ ledger backend มีจริง เป็น launch boundary ที่ต้องบอกตามจริง

## 7. ระยะห่างจากเป้าหมายสองฝั่ง

| ขั้น | ที่มีจริง | สิ่งที่ยังต้องพิสูจน์/สร้าง |
|---|---|---|
| Financial Data | เอกสาร รายจ่าย การจ่ายเงิน รายรับ AP/AR bank matching posted journals/source refs | หน่วยและความหมายตรงกัน, source status, dedup, opening balance, currency, scope, coverage/freshness; ช่องทางรายรับสำหรับแพ็กเกจที่ขายจริง |
| Financial Intelligence | Scoped tools, daily closing, expense categories, financial/tax reports | Metric-bound answers, complete questions, reconciled explanations, uncertainty/data-quality status; availability บนแต่ละช่องทาง |
| Business Financial Profile | Company identity/TSIC/base currency และ facts กระจายในโมดูล | Snapshot ที่มี version/as-of/methodology/source lineage/completeness; ไม่พบ dedicated profile service/model/tool ใน scope ที่ค้น |
| Financial Services Needs | ยังไม่พบ dedicated engine/contract/tool | Explainable need signals + assumptions + owner confirmation; ไม่ใช่ตัดสินอนุมัติสินเชื่อ |
| Partner delivery | Tenant/branch permissions, audit, internal outbox มีฐาน | Partner client/scope, purpose/consent/revoke, bounded profile API, schema versions, delivery/dedup/retry/audit; ไม่พบ bank integration implementation |

Original banking spec ตัด direct bank feed/OAuth/transfers ออกโดยตั้งใจ จึงเป็นขอบเขตใหม่ ไม่ใช่ regression

## 8. ข้อเสนอเรียงลำดับ

### P0 — คำตอบพื้นฐานต้องไว้ใจได้

1. ใช้ fact contract เดียว: metricId/value/unit/currency/period/dateBasis/statusBasis/scope/asOf/sourceRefs/quality; เงินและสถานะสำคัญ format จาก typed facts ตัวเลขที่ผู้ใช้กล่าวเป็น hypothesis ไม่ใช่ evidence
2. ปิด AP currency/AR draft/unknown-as-zero และกำหนด semantic definition “ขาย–รับเงิน–จ่าย–ค้าง–คงเหลือ” ให้ตรง source ทุกช่องทาง
3. AgentCore/local/fallback ต้องรักษาบริบทและ coverage เท่ากัน; reuse fix หลายเดือนที่ deploy แล้ว ตรวจส่วนที่ยังไม่ครบเพิ่ม
4. Availability ต้องมาจาก entitlement + permission + launch + setup + tool implementation และตอบแยก “ยังไม่มีข้อมูล/ยังตั้งค่าไม่ครบ/ไม่มีสิทธิ์/ยังทำผ่าน LINE ไม่ได้/ไม่รองรับ”
5. ชุดคำถามจริงของเจ้าของเป็น release evidence พร้อม exact source/tool input/answer, expected amount/status/period; tests เก่าที่ผ่านไม่แทน correctness

### P1 — คุณค่าที่ผู้ประกอบการเห็นทันที

ใช้แพ็กเกจปัจจุบันเริ่มจาก “วันนี้ต้องจัดการอะไร 3 เรื่อง” มีจำนวนเงิน/วันครบกำหนด/เหตุผล/ปุ่มเปิดรายการ และยืนยันรายการแล้วผลรวมเปลี่ยนสอดคล้องกัน จากนั้นถามต่อ “ทำไม/เทียบเดือนก่อน/บิลไหน” ได้โดยไม่เริ่มใหม่

สำหรับภาพรวมเงินเข้า–ออก ต้องเปิด product/permission/entitlement journey ของรายรับที่มีอยู่แล้ว หรือเริ่มจาก import ข้อมูลคู่ค้าแบบตกลง schema ก่อน ไม่ถือว่าโมดูลมีใน repo แล้วลูกค้าซื้อเข้าถึงได้

Wow ที่ควรสาธิตหลัง P0 ผ่าน: “ค่าใช้จ่ายเพิ่มจากหมวดใด มีบิลใดเป็นตัวผลัก และต้องทำอะไรต่อ” พร้อมกดดู source; หรือ “ยอดขายกับเงินเข้าต่างกันเพราะเอกสารใด” หลัง reconcile invoice/payment/settlement ครบ ตัวอย่างเป็น proposed behavior ไม่ใช่ผลที่ระบบปัจจุบันทำได้แล้วทุกเคส

### P2 — Profile และ partner pilot บนฐานเดียวกัน

สร้าง snapshot บริษัทตามงวด: เงินรับจริง/จ่ายจริง/AP/AR/ความถี่รายรับ/ความกระจุกตัว/ภาระที่ทราบ + coverage/freshness/reconciliation + evidence links แล้วให้เจ้าของเลือกแบ่งปันขอบเขตที่ชัดเจน

KBTG/เหมียวจด: ทดลองนำข้อมูลรายจ่ายที่ยืนยันแล้วและความหมายธุรกิจ/ภาระค้าง/quality เข้าไปเสริม financial picture โดยยังไม่สมมติว่าเหมียวจดมี public partner API

SCB/แม่มณี: ทดลองจับ money-in payment/settlement กับ money-out ที่ยืนยันแล้ว พร้อมป้องกันการนับ payment และ settlement ซ้ำ ก่อนเสนอภาพรวมเงินหมุนเวียนและเหตุผลของ service need

Financial Services Needs ขั้นแรกเป็น “พบรูปแบบรับเงินช้ากว่ากำหนดจ่าย จึงอาจต้องการปรับ term/collection/working-capital facility” พร้อมหลักฐานและข้อมูลที่ขาด ไม่สร้าง eligibility/credit score จาก LLM ลอย ๆ

### ความเร็วและแนวคิดหมึกยักษ์

ใช้เป็นอุปมาทางสถาปัตยกรรม: สมองกลางแปลโจทย์/เลือก metric/ตรวจความครบ หนวดเป็น domain tools ที่คำนวณตรงตามกฎและ permission ระบบประสาทเป็น fact/provenance contract

คำถามง่ายควรวิ่ง existing prepared/deterministic read → permission-checked tool → typed formatter; คำถามหลายด้านเรียก independent tools พร้อมกันและให้โมเดลอธิบายเฉพาะส่วนที่จำเป็น ไม่จำเป็นต้องสร้าง multi-agent หรือตั้งบริการใหม่ให้ทุกหนวด

AiTurn runtime277 สองรายการล่าสุดมี durationMs 4,369 และ6,231, modelCallCount2; sample น้อยและไม่ได้วัดตั้งแต่ผู้ใช้ส่ง LINE จนเห็นคำตอบ จึงไม่ใช่ p95 benchmark ส่วน turn เก่า141ms/0calls แสดงว่ามีทางไม่เรียกโมเดลอยู่แล้ว ไม่ใช่สิ่งที่ต้องสร้างใหม่ทั้งหมด

## 9. เกณฑ์ยอมรับที่เสนอ

ก่อนบอกว่าพร้อมเป็น advisor และก่อน partner demo แบบอ้าง readiness:

- ยอดเงินจริง/จำนวนรายการ/สกุลเงิน/วันที่/สถานะตรง source ทุกข้อในชุดตรวจ; seed ตัวเลขผิดในคำถามแล้วระบบต้องไม่รับตาม
- ถามสองเดือน สองสาขา หรือคำถามต่อเนื่อง: ตอบครบหรือระบุส่วนขาดอย่างชัดเจน ไม่ตอบบางส่วนเหมือนครบ
- ไม่มีงวด/ไม่เคย reconcile/ไม่มี opening balance ต้องเป็น unknown/insufficient ไม่ใช่ศูนย์
- Owner/employee/read-only/different package ได้คำตอบตามสิทธิ์และ capability จริง
- Invoice/receipt/payment/WHT/reimbursement projection/settlement ไม่ถูกนับซ้ำหรือเปลี่ยนความหมาย
- เปลี่ยน source แล้วเลขบนเว็บ/LINE/profile ตรงกัน; evidence ที่เปิดดูยังผ่าน permission checks
- วัด latency แยก routing/tool/model/delivery และ p50/p95 ด้วย representative traffic ก่อนตั้ง SLA
- Partner preview แสดง exactly what will be shared, purpose, as-of/quality; revoke และ audit มีผลจริง

## 10. Verification และแหล่งอ้างอิง

Existing pure/mocked suites รอบ starter 365 tests ผ่านตาม report เดิม; รอบขยายมี banking logic/use cases และ ERP procurement/ledger tests ผ่าน (รายงานชุดหลัง68/68) ชุดเหล่านี้ซ้อนกันได้ จึงไม่รวมเป็นจำนวน unique tests และไม่เท่ากับ live acceptance

คำสั่งที่ใช้สำหรับ focused tests ได้แก่:

```sh
pnpm --filter @watchdog-bms/web exec tsx --test --test-reporter=dot src/features/banking/banking.logic.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/banking/domain/logic/banking.logic.spec.ts src/modules/banking/application/use-cases/bank-account.use-case.spec.ts src/modules/banking/application/use-cases/reconciliation.use-case.spec.ts
git diff 4a5817b4 277722ff -- <inspected-files>
git show 277722ff:<source-path>
```

Ad-hoc inline REPRO ใช้ tsx กับ provider/ERP stub ไม่เพิ่ม test files: composer amount/count/user-number cases, runtime payload roundtrip, JSON two-month loop, orchestration-off classifier, AP currency, AR draft, income/WHT semantics ผลและขอบเขตระบุในหัวข้อข้างต้น

Numeric guard compact reproduction (primary auditor รันยืนยันซ้ำ exit0, acceptedWrongResult=true ทั้งสองแถว; ไม่มี network call):

```sh
pnpm --filter @watchdog-bms/ai-gateway exec tsx -e 'import { ResponseComposerAgent } from "./src/modules/line-ai/agents/response-composer.agent"; (async () => { const c = new ResponseComposerAgent(); const data = [{ tool: "sales.get_sales_summary", data: { totalSales: "1000.00", transactionCount: 2, basis: "recorded_received_payments" } }]; for (const [q, t] of [["ยอดรับเงินจริงเท่าไร", "ยอดรับเงินจริง 2 บาท"], ["ยอดรับเงินจริง 999 บาทใช่ไหม", "ยอดรับเงินจริง 999 บาท"]]) { const actual = await c.composeAnswer(q, data, "ยอดรับเงินจริง 1000.00 บาท จำนวนรายการ 2 รายการ", { generateText: async () => ({ ok: true, text: t }) } as any, { planLanguage: "th", locale: "th-TH" }); console.log(JSON.stringify({ question: q, actual, acceptedWrongResult: actual === t })); } })();'
```

Bank context ใช้ primary pages เพียงอธิบาย integration hypothesis ไม่ใช้พิสูจน์ว่ามี API หรือ partnership แล้ว:

- [เหมียวจด: ฟังก์ชันที่ประกาศ](https://www.meowjot.com/pricing) มี category/budget/comparison/export อยู่แล้ว จึงควรหา value จากข้อมูลธุรกิจที่ตรวจสอบได้และภาระค้าง มากกว่าสรุปรายจ่ายทั่วไปซ้ำ
- [SCB: payment FAQ](https://www.scb.co.th/th/personal-banking/faq/payment-faq) อธิบายรับเงินเข้าบัญชีแม่มณีและ settlement เข้าบัญชีปลายทาง เป็นเหตุผลที่ต้องแยก payment event กับ bank movement

ยังไม่ทำ production chat replay, browser journey ทุก module, load test, partner API handshake หรือ formal security/legal/compliance acceptance จึงไม่ให้เปอร์เซ็นต์ readiness ที่ไม่มีเกณฑ์รองรับ
