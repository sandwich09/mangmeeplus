# แผนพัฒนา Mangmee Accounting Operating System

สถานะ: DRAFT สำหรับจัดลำดับและอนุมัติขอบเขต

Spec หลัก: [Mangmee Accounting Operating System Spec](../specs/mangmee-accounting-operating-system-spec-th.md)

Research: [ผลสำรวจ FlowAccount](../research/flowaccount-accounting-product-audit-2026-08-26-th.md)

Knowledge: [Mangmee Accounting and Tax Knowledge Spec](../specs/mangmee-accounting-tax-knowledge-spec-th.md)

## 1. คำตอบตรง ๆ

ระบบบัญชีครบวงจรตามขอบเขตที่สำรวจไม่สามารถสร้างให้เสร็จและพิสูจน์คุณภาพได้ใน 2.5 วันด้วย dev 1 คน สิ่งที่ทำได้อย่างรับผิดชอบคือ:

- ช่วงเร่งด่วน P1–P5: ปิดบัคเส้นทางที่ใช้อยู่ ทำให้ผู้ใช้ 40+ ไม่หลง และเก็บหลักฐานว่า release candidate ปลอดภัยพอสำหรับ Controlled Beta
- P6 เป็นต้นไป: สร้าง Accounting OS ทีละ vertical slice โดยแต่ละ slice ต้องไหลจากเอกสาร → เงิน/stock/tax → ledger → report และมี evidence ก่อนเปิด

ห้ามกระจาย dev คนเดียวไปสร้างหน้าเอกสารทุกเมนูพร้อมกัน เพราะจะได้ UI ที่ดูเหมือนระบบบัญชี แต่ตัวเลข ภาษี และสมุดบัญชีไม่เชื่อมกัน

## 2. เป้าหมายและลำดับตัดสิน

ลำดับเดียวตลอดแผน:

1. รับคนให้ไหว: ระบบไม่ล่ม ข้อมูลไม่ข้ามบริษัท มี monitor/rollback/backup
2. ใช้แล้วชอบ: งานหลักจบง่าย รู้ว่าสำเร็จ และ AI ช่วยเฉพาะจุดที่ลดงานจริง
3. บัญชีถูก: source, tax, payment, stock และ ledger reconcile ได้
4. ขยายได้: เพิ่ม connector, knowledge และ volume โดยไม่สร้าง source of truth ใหม่

### Dependency map

~~~text
P1 Current truth + release freeze
 ├─ P2 Stop-ship expense/VAT bugs
 ├─ P3 UX 40+ + task-first navigation
 └─ P4 Evidence/monitor/incident lane
        → P5 Controlled Beta decision

P6 Accounting foundation/settings/posting rules
 ├─ P7 Sell-to-Cash
 ├─ P8 Procure-to-Pay + Expense
 └─ P9 Bank/Reconciliation + Revenue Inbox
        → P10 VAT/WHT/Tax packages
        → P11 GL/Opening/Close/Financial statements

P12 Inventory/Costing ─┐
P13 Fixed assets ──────┼→ P14 Reports and accountant workspace
P15 Mangmee Brain ─────┘
P16 Payroll/Extended compliance
  → P17 Connectors → P18 Scale/security/DR → P19 Controlled rollout
~~~

## 3. ช่วงเร่งด่วน 2.5 วัน: P1–P5

### P1 — ล็อกของที่จะเปิดและตรวจ current truth

เป้าหมาย: ทุกคนทดสอบ exact candidate เดียว และไม่ใช้ผลตรวจเก่าเป็นความจริงโดยไม่ revalidate

งาน:

1. บันทึก exact SHA, environment, feature flags และ entitlement ของบริษัททดสอบ
2. จัดรายการ journey ที่เปิดจริง: login/LINE link, company switch, receipt upload, AI extraction, expense review, submit, list, report และ Brain CTA
3. revalidate blocker จาก accounting-tax readiness ที่กระทบ journey เปิดจริง
4. ปิดทางเข้า feature ที่ยัง planned/blocked รวม Auto Revenue และ tax filing mutation
5. สร้าง bug board เดียว แบ่ง STOP-SHIP / สำคัญ / ปรับหลัง beta

หลักฐานผ่าน:

- candidate manifest
- feature ON/OFF matrix
- reproduction link/test สำหรับทุก STOP-SHIP
- ไม่มีเมนูที่พาไป 403, planned page หรือ mutation ครึ่งเสร็จ

ผู้รับผิดชอบ: Lead Dev + Product/Accounting Agent + QA Evidence Agent

### P2 — ปิดบัครายจ่ายและ Mixed VAT

เป้าหมาย: เส้นทางชูโรง “ถ่าย → AI อ่าน → ตรวจ → ส่ง” จบจริงและตัวเลขไม่บิด

งาน:

1. หลังส่งตรวจสำเร็จ redirect ไปหน้ารายการด้วย replace navigation
2. แสดง toast “ส่งตรวจเรียบร้อย” พร้อมสถานะใหม่และ highlight รายการเดิม
3. เพิ่ม editor VAT ต่อบรรทัด: มี VAT 7%, VAT 0%, ยกเว้น, ไม่มี VAT และยังไม่แน่ใจ
4. เก็บ source VAT กับ calculated VAT แยกกัน พร้อม difference/resolution
5. ทำ golden cases mixed VAT/discount/service charge/rounding/OCR correction
6. duplicate upload/retry ต้องไม่สร้าง expense ซ้ำ

หลักฐานผ่าน:

- E2E ยืนยัน URL, list row, status และ record ID หลัง submit
- golden VAT cases ขั้นต่ำ 10 เคสผ่าน 100%
- journal/tax preview เท่ากับ resolution ที่ผู้ใช้ยืนยัน
- ไม่มี hard block ที่ไม่มีทางแก้สำหรับใบเสร็จจริง

ผู้รับผิดชอบ: Lead Dev + Tax Evidence Agent + UX 40+ Agent + QA Evidence Agent

Stop condition: ถ้า data model ไม่สามารถเก็บ source/calculated/resolution แยกได้ ให้หยุดการแก้ UI แบบชั่วคราวและทำ migration/spec slice ที่เล็กที่สุดก่อน

### P3 — ทำให้ผู้ใช้ 40+ พบคุณค่าเร็ว

เป้าหมาย: ผู้ใช้ใหม่รู้ว่าต้องเริ่มตรงไหนภายในหนึ่งหน้าจอ

งาน:

1. Dashboard hero มี “ถามสมองมั่งมี” และ “ถ่ายใบเสร็จ”
2. แสดงงานค้างที่เป็นภาษาคน เช่น รอตรวจ, ต้องแก้ VAT, รอเอกสาร, ส่งแล้ว
3. ลดเมนู launch mode เหลือสิ่งที่เปิดจริง
4. แก้ label วันที่ เอกสาร บริษัท และสถานะที่เป็นศัพท์เทคนิค/รหัส
5. loading/error/empty/permission/redirect state ต้องมีทางไปต่อ
6. ตัวอักษร/ปุ่ม/contrast/focus ตาม UX minimum ใน spec

หลักฐานผ่าน:

- usability task 5 คน: ถ่ายใบแรกและดูรายการสำเร็จ ≥90%
- ผู้ทดสอบบอกได้ว่างานเสร็จหรือยัง ≥95%
- keyboard/mobile/tablet critical path ผ่าน
- raw ID/internal error ต่อผู้ใช้ = 0

ผู้รับผิดชอบ: Lead Dev + UX 40+ Agent + Accessibility review

### P4 — Monitoring, incident และ fast hotfix lane

เป้าหมาย: ถ้า beta พบปัญหา ทีมรู้ภายในเวลาและกู้ได้โดยไม่เดา

งาน:

1. event allowlist: login, company selected, receipt uploaded, OCR terminal, review opened, submit success/fail, list viewed, Brain asked/answered
2. trace correlation จาก web/LINE → API → worker/AI โดยไม่ log เอกสารจริง เลขภาษี หรือ prompt เกินจำเป็น
3. alarm สำหรับ error rate, p95, queue age, OCR terminal gap, duplicate, cross-tenant denial spike และ delivery failure
4. runbook incident: acknowledge <15 นาที, triage, feature kill switch, rollback, hotfix และ customer update
5. ซ้อมหนึ่ง incident แบบ feature off และหนึ่งแบบ rollback
6. ตรวจ backup/restore evidence ที่มีอยู่และระบุ gap

หลักฐานผ่าน:

- synthetic failure สร้าง alarm จริง
- on-call acknowledge และเริ่ม mitigation <15 นาทีในการซ้อม
- rollback/feature-off ทำได้ตาม runbook
- log/trace ผูก request ได้แต่ไม่เผย sensitive payload

ผู้รับผิดชอบ: Lead Dev + SRE/Observability Agent + Security Agent

### P5 — Quality gate และ Controlled Beta decision

เป้าหมาย: ตัดสิน OPEN/CLOSED จากหลักฐาน ไม่ใช่ความรู้สึก

Gate:

- G1 Correctness: mixed VAT, duplicate, submit/list, permissions ผ่าน
- G2 UX: 40+ task test ผ่าน
- G3 Reliability: smoke/load ไม่มี regression และ alarm ทำงาน
- G4 Security: tenant/branch/upload/auth negative tests ผ่าน
- G5 Operations: incident/rollback/backup evidence พร้อม
- G6 Marketing honesty: คำโฆษณาตรงกับ feature ON

ผลลัพธ์ต้องเป็นราย feature:

| Feature | ผลที่อนุญาต |
|---|---|
| Receipt capture/review | OPEN controlled / CLOSED |
| LINE login/link | OPEN controlled / CLOSED |
| Brain company answers | OPEN เฉพาะ families ที่ผ่าน / CLOSED |
| Sales documents | ตาม launch matrix แยก mutation |
| Auto Revenue | CLOSED ในช่วงเร่งด่วน |
| Tax filing/e-Tax | CLOSED จน package gate ผ่าน |
| Subscription enforcement | CLOSED จน meter/billing gate ผ่าน |

## 4. แผนสร้าง Accounting OS หลัง Controlled Beta

### P6 — Accounting foundation และ company policy

เป้าหมาย: ทำรากเดียวที่เอกสารทุก module ใช้ร่วมกัน

งาน:

- company/branch/tax/fiscal period setup
- chart of accounts และ manage UI
- posting rules as versioned data พร้อม review/activate
- document number series และ policy snapshot
- accounting category ↔ account/tax mappings
- common money/decimal/currency/rounding library
- source lineage, audit, outbox, idempotency และ state transition framework
- opening/cutover model draft

หลักฐานออกจาก P6:

- สร้างบริษัทใหม่แล้วมี reviewed defaults ที่ post golden document ได้
- invalid/missing rule fail closed ด้วยข้อความที่แก้ได้
- cross-company/branch และ duplicate command tests ผ่าน
- debit = credit property test ผ่านทุก posting template ที่เปิด

### P7 — Sell-to-Cash vertical slice

เป้าหมาย: ใบเสนอราคา → เรียกเก็บ → รับเงิน → AR/Tax/Ledger/Report ครบเส้นเดียว

ขอบเขต:

- customer/product master
- quotation, billing/invoice, tax invoice, receipt, cash sale
- conversion, partial/deposit/retention
- credit/debit note และ void/reversal
- receive payment, WHT receivable, overpayment/unapplied credit
- AR aging, collection report และ source-to-ledger drill-down

หลักฐาน:

- golden sell-to-cash อย่างน้อย 20 เคส
- invoice payment ไม่เพิ่ม revenue/VAT ซ้ำ
- partial/credit note/void/retry reconcile AR, VAT และ GL
- mobile/desktop journey และ permissions ผ่าน

### P8 — Procure-to-Pay และ Expense vertical slice

เป้าหมาย: สั่งซื้อ/รับของ/ค่าใช้จ่าย/จ่ายเงินไหลไป AP, stock, tax และ ledger

ขอบเขต:

- supplier master
- purchase request optional, PO approval
- goods/service receipt
- vendor bill/expense/OCR
- 2-way/3-way match และ tolerance
- payment proposal/voucher/batch
- WHT payable/50 Tawi handoff
- AP aging และ supplier statement

หลักฐาน:

- partial receipt/bill/payment ไม่เกินต้นทาง
- duplicate OCR/source file ไม่สร้างซ้ำ
- segregation of duties negative tests
- AP subledger reconcile GL

### P9 — Bank Reconciliation และ Revenue Inbox

เป้าหมาย: เงินเข้า–ออกทุกบรรทัดมีที่มาและ reconcile กับบัญชีได้

ขอบเขต:

- import PDF/CSV ที่มีอยู่ก่อน direct connector
- parser/fingerprint/duplicate control
- suggested match กับ payment/expense/journal
- split/aggregate match, transfer pair, fee/interest/chargeback adjustment
- reconciliation session/opening/closing evidence
- Revenue Inbox classification และ exception workflow

หลักฐาน:

- statement golden sets หลายธนาคาร/format
- opening + inflow − outflow = closing
- transfer ไม่กระทบ P&L
- unknown deposit ไม่ default เป็น revenue
- match precision/coverage รายงานแยกกัน และ false auto-confirm = 0 ใน high-risk cases

### P10 — VAT, WHT และ Tax Workspace

เป้าหมาย: นักบัญชีเตรียม ตรวจ และ export package ได้จาก source ที่ trace ได้

ขอบเขต:

- input/output tax registers
- purchase VAT evidence/eligibility/claim period
- PP30 workpaper, carry forward, amendment
- PP36 flow และ payment receipt → input claim
- WHT issued/received, PND1/3/53 data, 50 Tawi
- tax calendar/notification
- filing/payment evidence และ locked snapshots

หลักฐาน:

- schema/fixture เทียบแบบทางการ
- Tax expert ที่ระบุชื่อลงนาม rule snapshot/golden cases
- source-to-form และ form-to-ledger reconcile
- filed snapshot เปลี่ยนไม่ได้; amendment lineage ผ่าน

หมายเหตุ: การสร้างข้อมูลพร้อมยื่น, export file และ direct e-Filing เป็นคนละ activation gate

### P11 — GL, Opening, Close และงบการเงิน

เป้าหมาย: ใช้ทำบัญชีบริษัททั่วไปและปิดงวดได้จริง

ขอบเขต:

- JV/UV/SV/PV/RV workspace
- post/approve/reverse และ journal attachments
- opening trial balance/AR/AP/bank/stock/assets/tax
- general ledger, trial balance, P&L, Balance Sheet, activity
- accrual/prepayment/depreciation/tax closing
- close revenue/expense, retained earnings, period lock/unlock
- closing checklist และ evidence pack

หลักฐาน:

- TB balanced, Balance Sheet assertion และ roll-forward ผ่าน
- opening + movements = closing
- subledger/control-account reconciliation ครบ
- draft/posted/reversed/locked period cases ผ่าน
- Accountant ปิดงวดทดสอบ end-to-end โดยไม่แก้ DB

### P12 — Inventory, Warehouse และ Costing

เป้าหมาย: จำนวนและมูลค่าสินค้าตรงกับเอกสารและ GL

ขอบเขต:

- service/non-stock/stock, units/barcodes
- warehouses/locations/main warehouse
- receipt/issue/return/transfer/adjust/count
- low stock/reorder
- costing policy/cost layers/COGS
- stock card, on-hand/value และ reconciliation

หลักฐาน:

- movement immutability/idempotency
- quantity/value golden cases รวม negative stock/return/transfer
- inventory value และ COGS reconcile GL
- physical count adjustment มี approval/evidence

### P13 — Fixed Assets

เป้าหมาย: ซื้อสินทรัพย์จนถึงค่าเสื่อม/จำหน่ายครบวงจร

ขอบเขต:

- asset candidate จาก expense
- category/account mapping
- register/capitalization
- depreciation draft/review/post
- transfer/improvement/impairment/disposal/write-off
- asset/depreciation/GL reports

หลักฐาน:

- schedule เทียบ Accountant workbook
- depreciation/reversal/disposal journals ผ่าน golden set
- asset register reconcile GL

### P14 — Reports และ Accountant Workspace

เป้าหมาย: รายงานทุกตัว trace กลับ source และใช้ปิดงานได้

งาน:

- report catalog และ data contract
- common period/status/company/branch/project filters
- operational, tax และ accounting reports ตาม spec
- drill-down, export snapshot, generatedAt/asOf/version
- business-document vs manual-journal split
- accountant exception inbox และ close dashboard

หลักฐาน:

- totals reconcile source/subledger/GL
- export re-open/reproduce ได้จาก snapshot
- permission/redaction tests
- report performance baseline และ large-volume test

### P15 — สมองมั่งมีและคลังความรู้

เป้าหมาย: ตอบฉลาด เร็ว ถูก และเพิ่มความรู้ใหม่ได้โดยไม่รื้อระบบ

งาน:

- compiled/approved knowledge packs ตาม knowledge spec
- domain aliases/intents และ answer templates
- company read tools สำหรับ cash, AR/AP, expense, tax, inventory, close blockers
- exception explanation/deep link
- general conversation + current-information policy
- expert review/admin lifecycle และ eval harness

หลักฐาน:

- wrong-tenant disclosure = 0
- ตัวเลขทุกคำตอบ company ตรง tool result 100%
- high-risk tax answer มี approved source/reviewer/version 100%
- expired/unknown pack fail closed
- blind eval factuality/task completion/latency ผ่านต่อ family

### P16 — Payroll และ Extended Compliance

เป้าหมาย: เติมภาระที่ระบบบัญชีบริษัทต้องใช้ แต่มี privacy/rule คนละชุดกับเอกสารซื้อขาย

ขอบเขต:

- employee/payroll source integration หรือ payroll module ตาม decision
- salary, allowance, deduction, employer cost และ payment evidence
- ภ.ง.ด.1/1ก, 50 ทวิ, ประกันสังคม และกองทุนที่เกี่ยว
- ภ.ง.ด.50/51 workpaper จาก adjusted accounting profit
- ภ.ง.ด.54/cross-border, ภาษีธุรกิจเฉพาะ, อากรแสตมป์ เฉพาะธุรกิจที่เข้าเงื่อนไข
- compliance calendar, reviewer, export และ evidence

หลักฐาน:

- employee privacy/permission/redaction tests
- payroll-to-bank/WHT/expense/GL reconciliation
- แบบ/rule แต่ละชุดมี official source และ named expert sign-off
- capability label แยก education/data preparation/export/direct filing ตามความจริง

### P17 — Connectors

ลำดับแนะนำ:

1. Bank Statement import ที่มีอยู่
2. Bank feed แรก
3. QR/Payment Gateway แรก
4. Marketplace settlement แรก
5. POS/Sales system
6. Partner API

ทุก connector ต้องผ่าน canonical adapter, idempotency, replay, signature/auth, rate limit, DLQ, reconciliation และ source lineage ก่อนเปิด

### P18 — Scale, Security และ Disaster Recovery

งาน:

- load profile หลักหมื่น/แสน tenant ตาม forecast
- DB/query/index/queue/object-storage capacity
- per-company AI/OCR quota และ fair use
- autoscaling/circuit breaker/backpressure
- security threat model/penetration/tenant isolation
- backup restore, failover, RPO/RTO และ incident drill
- deploy/rollback/hotfix path ที่ลดเวลาปลอดภัย

หลักฐาน:

- load/soak/failure-injection report ผูก exact release
- no cross-tenant leakage
- restore/failover drill ผ่าน
- incident acknowledge <15 นาทีและ mitigation ตาม SLA ภายในที่กำหนด

### P19 — Controlled rollout และ scale decision

- เปิด allowlist บริษัทนำร่อง
- canary ต่อ feature ไม่เปิดทั้ง suite พร้อมกัน
- compare error/latency/accuracy/drop-off/support load
- weekly Accountant/UX review ของ exceptions
- feature kill switch และ rollback owner ชัด
- ขยาย cohort เมื่อ evidence ผ่านเท่านั้น

## 5. Agent เฉพาะทางทำอะไรบ้าง

dev หลักยังเป็นผู้แก้โค้ดและตัดสิน integration เพียงคนเดียว Agent ใช้เป็นผู้สำรวจ สร้าง test oracle และ review หลักฐาน ไม่ให้หลาย Agent แก้ไฟล์เดียวกันพร้อมกัน

| Agent | งานหลัก | Artifact/หลักฐาน | ห้ามทำแทนคน |
|---|---|---|---|
| Product/Accounting Domain Agent | แตก journey, state, source-of-truth, accounting effect และ exception | state matrix, posting examples, gap list | อนุมัตินโยบายบัญชีของบริษัท |
| Thai Tax Evidence Agent | ตรวจ VAT/WHT/แบบ/แหล่ง/effective date | source register, rule fixture, expert checklist | ให้คำปรึกษาภาษีเฉพาะกรณีหรือ sign-off |
| UX 40+ Agent | heuristic review, copy, task flow, accessibility | annotated flow, usability script, issue severity | อ้างว่าใช้ง่ายโดยไม่ทดสอบผู้ใช้จริง |
| Backend/Domain Agent | review invariants, state transitions, idempotency, contracts | focused tests, contract review | ข้าม tenant/permission boundary |
| Frontend Agent | form/list/loading/error/mobile/accessibility | component/E2E checklist, screenshots/artifacts | ซ่อน accounting error ด้วย UI |
| QA Evidence Agent | golden cases, E2E, regression, exact-SHA evidence | machine-readable test report, trace/artifact | เปลี่ยน expected result ให้ test ผ่าน |
| Security Agent | tenant/branch/auth/upload/export/threat model | negative tests, threat register | อนุมัติ production risk แทน Owner |
| SRE/Observability Agent | SLI/SLO, alarm, dashboard, runbook, drill | alarm evidence, incident timeline, restore proof | เปิด/แก้ production โดยไม่มี protocol |
| AI/Knowledge Agent | pack schema, retrieval, citations, eval, latency/cost | knowledge registry, eval report | แต่งตัวเลขบริษัทหรือ approve tax pack |
| Integration/Data Agent | connector mapping, duplicate/replay/reconciliation | canonical fixtures, replay tests | ให้ provider event เขียน ledger โดยตรง |

Human sign-off ที่ขาดไม่ได้:

- Owner/Product: outcome, scope,คำโฆษณา และ risk acceptance
- นักบัญชีที่ระบุชื่อ: posting rules, opening, close, reports
- ผู้เชี่ยวชาญภาษีที่ระบุชื่อ: tax packs/rules/forms
- ผู้ใช้ 40+ จริง: usability evidence
- Release owner/on-call: OPEN/CLOSED และ incident authority

## 6. Quality evidence matrix

| ด้าน | Metric/Gate | หลักฐานขั้นต่ำ |
|---|---|---|
| Ledger | debit = credit; duplicate post = 0 | property + integration + golden journals |
| Source trace | final report line trace กลับ source ได้ | source-to-report E2E |
| VAT | mixed VAT/rounding/source difference ถูก | signed golden fixtures |
| Tax | rule/source/reviewer/effective ครบ | pack registry + expert sign-off |
| AR/AP | subledger = control account | reconciliation report |
| Bank | opening + movement = closing; unresolved แสดงครบ | reconciliation session evidence |
| Inventory | qty/value/COGS reconcile | stock golden set + GL reconciliation |
| UX | task completion ≥90%; critical error 0 | moderated usability artifacts |
| Accessibility | keyboard/focus/label/contrast/mobile critical path | automated + manual checklist |
| Security | cross-tenant disclosure 0 | negative integration/E2E |
| Reliability | critical errors/latency/queue/AI terminal visible | dashboard + alarm drill |
| Incident | acknowledge <15 นาที | drill timestamp + runbook |
| AI | company numbers equal tool result; cited high-risk answer 100% | eval report + traces |

ตัวเลข performance/automation ที่ยังไม่มี hosted baseline เป็น target ทดลอง ไม่ใช่คำสัญญา Marketing

## 7. Feature priority map

| Capability | ลำดับ | เหตุผล |
|---|---|---|
| Expense submit redirect + mixed VAT | P2 | ปัญหาจริงบน flow ชูโรงและกระทบความเชื่อมั่น/ภาษี |
| Task-first UX + Brain CTA | P3 | ลดเวลาถึงคุณค่าและการหลงเมนู |
| Monitoring/incident/rollback | P4 | เปิดคนเพิ่มโดยไม่มีตาบอด |
| Posting rules/settings foundation | P6 | ถ้าไม่ถูก ทุก module ต่อผิด |
| Sell-to-Cash | P7 | รายรับ/AR/VAT และ growth |
| Procure-to-Pay/Expense | P8 | งานจริงปัจจุบันและ AP/WHT |
| Bank/Reconciliation/Revenue Inbox | P9 | ลดงานคีย์และพิสูจน์เงิน |
| VAT/WHT workspace | P10 | ความพร้อมนักบัญชี/ภาษี |
| GL/Opening/Close | P11 | เงื่อนไขเป็นระบบบัญชีจริง |
| Inventory/Costing | P12 | จำนวนอย่างเดียวไม่พอทำบัญชี |
| Fixed assets | P13 | ปิดงบครบขึ้น |
| Reports | P14 | ตรวจและตัดสินได้ |
| Full Knowledge/Brain | P15 | ขยายคำตอบบนฐานที่ถูก |
| Payroll/extended compliance | P16 | แยก privacy/rule จาก core ซื้อขาย แต่จำเป็นต่อบริษัททั่วไป |
| Direct connectors | P17 | ทำหลัง canonical flow/reconciliation พร้อม |

## 8. Definition of Done ทั้งระบบ

มั่งมีเรียกตัวเองว่า Accounting OS พร้อมใช้กับบริษัทจริงได้เมื่อ:

- user journey หลักขาย ซื้อ ค่าใช้จ่าย รับ–จ่าย ธนาคาร stock tax close จบโดยไม่แก้ DB
- source, subledger, tax, inventory และ GL reconcile
- opening/period close/lock/reopen/correction มี evidence
- เอกสารและรายงานที่อ้างพร้อมใช้ผ่าน expert review
- ผู้ใช้ 40+ ทำ critical task สำเร็จตามเกณฑ์
- permission/tenant/audit/idempotency/security ผ่าน
- monitoring/backup/restore/incident/deploy/rollback ผ่าน drill
- AI ตอบจาก tools/approved knowledge และ fail closed เมื่อไม่รู้
- ทุก feature เปิดผ่าน entitlement/canary และมี rollback owner

## 9. Open decisions สำหรับ Owner

1. ยืนยันว่าช่วงเร่งด่วน P1–P5 ให้ปิดปัญหาของที่ใช้จริงก่อนสร้างเมนูบัญชีใหม่หรือไม่
2. บริษัทนำร่องทำธุรกิจประเภทใดและใช้เอกสารขาย/ซื้อแบบใดจริง
3. ให้ module แรกหลัง beta เป็น Sell-to-Cash หรือ Procure-to-Pay/Expense
4. Bank/Payment/Marketplace connector แรกคือเจ้าใด
5. ใช้ costing method ใดในบริษัทนำร่อง
6. ใครเป็นนักบัญชีและผู้เชี่ยวชาญภาษีที่ลงนาม golden cases
7. ขอบเขตแรกของแบบภาษี: prepare/report/export หรือ direct filing
8. SLA/RPO/RTO ที่ยอมรับหลังเห็น baseline จริง
