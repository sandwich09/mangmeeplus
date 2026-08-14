# Blueprint รายจ่าย: ช่องว่าง + User Story (รวมไอเดีย persona/rule-engine กับจุดแข็งที่มีอยู่)

- สถานะ: **DRAFT — วิเคราะห์เทียบ blueprint กับโค้ดจริง**
- วันที่: 2026-08-14
- ที่มา: blueprint "persona (เจ้าของ/พนักงาน/นักบัญชี) + rule engine (WHT/VAT) + rules-as-data + verdict อธิบายได้ + confidence/human-in-the-loop + audit + engine เดียวสลับ VAT mode" (จากบทสนทนาออกแบบผลิตภัณฑ์)
- ฐานที่ตรวจ: สำรวจ `apps/api` (201 Prisma models), `apps/web`, `docs/specs`, `docs/product` บน branch ปัจจุบัน `20260811`
- คำเตือน: นี่คือ snapshot บางช่องว่างอาจกำลังทำอยู่ (เช็ค `docs/agent-memory/` เช่น `cr-2-posting-rule-writer.md`, `company-tax-identity-setup.md`) — ยืนยันกับ branch ล่าสุดก่อนลงมือ

---

## 0-A. อัปเดตหลังตรวจโค้ดเชิงลึก (2026-08-14) — อ่านก่อน

หลังเจ้าของผลิตภัณฑ์เลือกทำ G1/G2/G3/G5 + ใบรับรองแทนใบเสร็จ ได้ตรวจโค้ดจริงทุกจุดและ**แก้ความเข้าใจในตาราง §1 หลายข้อ**:

| เรื่อง | สิ่งที่เอกสารนี้เคยเขียน | ความจริงหลังตรวจ + รันเทสต์ |
|---|---|---|
| **G8 · GAP-01, GAP-07** | "บั๊ก P1 ต้องปิดก่อน" | ✅ **แก้ไปแล้วทั้งคู่** — รันเทสต์จริง 24/24 ผ่าน (ดู `finance-accounting-gaps-spec.md`) |
| **G1 · (b) หักรายจ่ายได้ไหม** | "ชิ้นส่วนมีครบ งานคือ orchestrate" | ❌ **ไม่มีเลย** — เป็น greenfield |
| **G1 · (d) WHT** | "มีแล้ว" | ❌ **ไม่มี logic ตัดสิน** — เป็นเลขคูณล้วน `wht = taxable × rate` โดย rate มาจาก OCR |
| **G1 · (c) ภาษีซื้อ** | "บางส่วน" | 🟡 **มีสองคำตอบที่ไม่ reconcile** — `inputVatClaimStatus` (ระดับใบ คนกรอก) vs `claimabilitySnapshot` (ระดับบรรทัด ระบบคำนวณ) |
| **G2 · posting rules** | "ย้ายจาก hardcode ไป PostingRule" | ⚠️ ทีมเคย**ตัดสินใจไม่ใช้** rule shape เดิมแล้ว เพราะ flat `(documentType, ruleKey) → {debit, credit}` แสดงกฎจริงไม่ได้ — ต้องออกแบบ shape ใหม่ก่อน |
| **G3 · ตรวจเลข 13 หลัก** | "ยังขาด" | ✅ ยังขาดจริง แต่**ช่องทางเปิดอยู่แล้ว** — RD มี SOAP service สาธารณะ (`rdws.rd.go.th`) |
| **G5 · WHT edge cases** | "❓ ต้องยืนยัน" | ยืนยันแล้ว: **ไม่มีเกณฑ์ 1,000, ไม่มี gross-up, ไม่มี ภ.ง.ด.54 (ตกไป PND53 เงียบ ๆ)** และพบ**ช่องข้ามผู้เช่า**ใน catalog WHT |

**บั๊กใหม่ที่พบระหว่างตรวจ (ไม่เคยอยู่ในเอกสารนี้):**
1. **P1 — แจ้งเตือนผู้อนุมัติใบรับรองแทนใบเสร็จไม่ทำงาน** ในกรณีปกติ (prepare กับ certify สร้าง dedup key เดียวกัน + cooldown 60 นาที)
2. **P1 — catalog `WhtIncomeCategory` เป็น global ไม่มี `companyId`** ผู้ใช้บริษัทหนึ่งเปิด/ปิดหมวด มีผลกับทุกบริษัท

**แผนที่แตกออกมาจากเอกสารนี้:**

| หัวข้อ | แผน |
|---|---|
| ใบรับรองแทนใบเสร็จ + ตรวจครบถ้วน + แจ้งเตือน | [[plans/expense-evidence-completeness-and-notification-plan]] |
| G1 verdict engine (+ บทบาท AI) | [[plans/expense-verdict-engine-plan]] |
| G2 posting rules เป็น data | [[plans/posting-rules-as-data-plan]] |
| G3 เชื่อมระบบสรรพากร | [[plans/rd-taxpayer-verification-plan]] |
| G5 ยืนยันกฎ WHT | [[plans/wht-rule-verification-plan]] |

**เลื่อนตามที่เจ้าของเคาะ (2026-08-14):** G4 (non-VAT→VAT transition) เลื่อน — MVP1 ยังไม่เปิดให้กรอกรายรับ · G6 (ปิดบัญชีสิ้นปี) เลื่อนไป **MVP2**

---

## 0. บทสรุปผู้บริหาร — คุณอยู่ตรงไหนแล้ว

Claude ในเว็บ **อ่านโค้ดในเครื่องคุณไม่ได้** เลยเสนอ blueprint แบบเริ่มจากศูนย์ แต่ของจริงคุณสร้างไปแล้วเกือบทั้ง blueprint:

- ✅ **ถ่ายบิล → OCR ไทย → review → confirm → จ่าย → ลงบัญชี** ครบ lifecycle (โมดูล `expenses`, Typhoon OCR)
- ✅ **VAT engine บางส่วน**: VAT mode (`NO_VAT/VAT_INCLUDED/VAT_EXCLUDED/EXEMPT`) + สถานะเคลมภาษีซื้อ (`CLAIMABLE/NON_CLAIMABLE/NEEDS_REVIEW`) + tax-evidence classification
- ✅ **WHT engine**: `WhtCertificate` (50 ทวิ), `WhtIncomeCategory` (catalog อัตราแบบ config), ภ.ง.ด.3/53, payment handoff
- ✅ **rules-as-data สำหรับ "อัตราภาษี"**: `TaxRateConfig` / `TaxYearConfig` / `TaxCalendarRule` / `TaxRuleSource` (มี effective date, review-gated)
- ✅ **Double-entry ledger** + ผังบัญชี SME ไทย (`th-sme-chart-of-accounts-v1`) + posting engine + ปิดงวด + GL/TB/P&L/BS
- ✅ **human-in-the-loop**: `TaxReviewIssue` + `NEEDS_REVIEW` + finance queue
- ✅ **audit log** ทั้งระบบ + `taxReviewerRole` enforce แล้ว
- ✅ **ใบรับรองแทนใบเสร็จ** (substitute receipt) + ลายเซ็น + policy — ตรงกับ pain point #1 ของ blueprint เป๊ะ
- ✅ **engine เดียวสลับ VAT mode**: มี VAT-registration state machine (`CompanyVatRegistration*`) + VAT-aware capture (spec implemented v1.3)
- ✅ **RBAC แยกหน้าที่**: FINANCE (เดินเงิน) / ACCOUNTANT (ปิดสมุด) ตาม segregation of duties + maker-checker

**แปลว่า blueprint ที่คุณชอบ = ~80% สร้างเสร็จแล้ว** สิ่งที่เหลือคือ "ชั้นบนสุด" ที่ทำให้มันกลายเป็นแต้มต่อเหนือ FlowAccount/PEAK จริง ๆ — ส่วนที่ยังขาดอยู่ด้านล่าง

---

## 1. Blueprint → ของจริง (ตารางเทียบ)

| ไอเดียใน blueprint | สถานะจริง | อยู่ที่ไหน |
|---|---|---|
| ถ่ายบิล + OCR ไทย | ✅ มีแล้ว | `expenses` receipt-uploads + Typhoon OCR |
| เตือน "เอกสารไม่พอ" ตอน capture | 🟡 บางส่วน | review-fields, ocr-total-acknowledgement — แต่ยังไม่ใช่ "verdict card 15 วิ" ฝั่งพนักงาน |
| ทำใบสำคัญจ่าย/ใบรับรองแทนใบเสร็จให้อัตโนมัติ | ✅ มีแล้ว | substitute-receipt flow + payment-voucher.pdf |
| VAT engine (ด่านตรวจ) | 🟡 บางส่วน | claim status + evidence policy มี แต่ยังไม่มี "5 ด่าน + เหตุผล + confidence" เป็น verdict เดียว |
| ตรวจใบกำกับครบตาม ม.86/4 | 🟡 บางส่วน | review-fields ตรวจได้บางช่อง ยังไม่เป็น checklist 8 องค์ประกอบชัด |
| WHT engine (อัตรา + แบบยื่น) | ✅ มีแล้ว | `WhtIncomeCategory` catalog + ภ.ง.ด.3/53 |
| WHT: เกณฑ์ 1,000 สะสม "ต่อสัญญา" | ❓ ต้องยืนยัน | อาจนับต่อบิล — ต้องเช็ค (edge case ใหญ่) |
| WHT: gross-up ออกภาษีแทน | ❓ ต้องยืนยัน | ไม่พบชัดใน inventory |
| WHT: บิลปนสินค้า+บริการ แยกยอด | ❓ ต้องยืนยัน | edge case — ต้องเช็ค |
| rules-as-data (อัตราภาษี) | ✅ มีแล้ว | `TaxRateConfig` + effective date |
| **rules-as-data (posting/ผังบัญชี)** | ❌ **ยังขาด** | posting default ฝังโค้ด `Dr 5310-01/Cr 2120-01` (GAP-02) |
| verdict อธิบายได้ + อ้างกฎหมาย | 🟡 บางส่วน | AI draft มี citation แต่ยังไม่มี verdict **deterministic** ต่อบรรทัดที่มี `explain_th` + `law_ref` |
| confidence + ถามคำถามเดียว | 🟡 บางส่วน | `ReceiptAiVerification` มี แต่ routing "ถามคำถามเดียว → เข้าคิวนักบัญชี" ยังไม่เป็นระบบ |
| ตรวจเลขผู้เสียภาษี 13 หลักกับสรรพากร (กันใบกำกับปลอม) | ❌ **ยังขาด** | ไม่พบใน inventory |
| เฝ้ายอด 1.8 ล้าน → เตือน → สลับโหมด non-VAT→VAT | 🟡 บางส่วน | มี state machine แต่ยังไม่มี "ตัวเฝ้ายอด + wizard เปลี่ยนผ่าน + แปลงเอกสารเก่า" |
| ปิดบัญชีสิ้นปี + ภ.ง.ด.50 | ❌ **ยังขาด** | GAP-05 ไม่มี fiscal year/กำไรสะสม/closing entry |
| audit log ทุก verdict | 🟡 บางส่วน | audit มี แต่ "verdict ใช้กฎเวอร์ชันไหน" ยังไม่ผูกเพราะ posting ยังไม่ใช่ data |

---

## 2. สิ่งที่ยังขาด (Gap list, เรียงตามแต้มต่อทางธุรกิจ)

### G1 · Verdict engine ที่ "อธิบายได้" ต่อรายจ่ายหนึ่งบรรทัด — **แต้มต่อสูงสุด**
ชิ้นส่วนมีครบแล้ว (claim status, evidence policy, WHT category, review issue) แต่ยังกระจายอยู่คนละที่ ยังไม่ถูกรวมเป็น **verdict object เดียวต่อ expense/line** ที่ตอบ 4 อย่างพร้อมกันในภาษาคน + อ้างกฎหมาย + confidence:
1. เอกสารนี้ใช้ได้ไหม / ขาดอะไร
2. หักรายจ่ายทางภาษีได้ไหม (deductible?)
3. ภาษีซื้อขอคืนได้ไหม (5 ด่าน)
4. ต้องหัก ณ ที่จ่ายเท่าไหร่ แบบไหน

นี่คือสิ่งที่เปลี่ยนระบบจาก "บันทึกตามที่กรอก" → "ผู้ช่วยที่ตรวจสอบได้" และเป็นเหตุผลให้สำนักงานบัญชีกล้าใช้. **ทำได้เพราะ backend มีข้อมูลครบแล้ว — งานคือ orchestrate + surface**
- ต่อยอดจาก: `tax-evidence-policy.logic.ts`, `expense` claim status, `WhtIncomeCategory`, `TaxReviewIssue`
- Effort: M | ต้องตัดสินใจ product: รูปแบบ verdict card + ระดับ confidence ที่ trigger คิวนักบัญชี

### G2 · Posting rules เป็น "data" ไม่ใช่ hardcode
ตอนนี้ posting default ฝังโค้ด (`Dr 5310-01 / Cr 2120-01`) และ "ไม่มี `PostingRule` ใน DB เลย" (finance-accounting-gaps GAP-02). blueprint ต้องการกฎเป็น record ที่มี effective date เพื่อให้ทีม compliance แก้เองได้และรายการเก่ายังคำนวณด้วยกฎ ณ วันนั้น
- ต่อยอดจาก: มี model `PostingRule` แล้ว + `posting-engine.logic.ts` — ต้อง seed rule จริงแทน default ฝังโค้ด (ดู `docs/agent-memory/cr-2-posting-rule-writer.md`)
- Effort: M

### G3 · ตรวจเลขผู้เสียภาษี 13 หลักกับสรรพากร (กันใบกำกับปลอม)
ฟีเจอร์ขายแรงที่คู่แข่งไม่มี — เช็คว่าผู้ขายจดทะเบียน VAT จริง/สถานะ active กับระบบตรวจสอบผู้ประกอบการ VAT ของสรรพากร ตอน OCR อ่านเลขได้
- ต่อยอดจาก: OCR อ่านเลขผู้เสียภาษีอยู่แล้ว + `AccountingCounterparty`
- Effort: M | ต้องตัดสินใจ: แหล่ง API/ความถี่ cache/พฤติกรรมเมื่อ verify ไม่ได้

### G4 · non-VAT → VAT transition (เฝ้ายอด 1.8 ล้าน + wizard + แปลงเอกสาร)
blueprint ชี้ว่าเป็นจุดที่คู่แข่งทำไม่ลื่น และเป็น lifetime-value ที่เก็บได้ก่อนใคร มี state machine แล้วแต่ยังขาด: (ก) ตัวเฝ้ายอดรายได้สะสม 12 เดือน → เตือนล่วงหน้าก่อนแตะ 1.8M, (ข) wizard "เดือนสุดท้ายก่อนจด → วันจด → เดือนแรกหลังจด", (ค) แปลงพฤติกรรมเอกสาร/ผังบัญชีตอนสลับ
- ต่อยอดจาก: `CompanyVatRegistration*` state machine, `sales.summary`/`reports` (มียอดขายอยู่แล้ว)
- Effort: M–L

### G5 · WHT edge cases ที่ blueprint ระบุ — ยืนยัน/เติม
1. เกณฑ์ 1,000 บาท นับ **สะสมต่อสัญญา** ไม่ใช่ต่อบิล
2. บิลปนสินค้า+บริการ → หักเฉพาะส่วนบริการ ถ้าแยกไม่ได้หักทั้งยอด + เตือนขอผู้ขายแยกบรรทัด
3. gross-up "ออกภาษีแทน" เมื่อผู้ขายไม่ยอมให้หัก
4. ผู้รับต่างประเทศ → ภ.ง.ด.54 + ภ.พ.36 (ภ.พ.36 มีแล้ว, ภ.ง.ด.54 ต้องเช็ค)
- ต่อยอดจาก: `wht-report.logic.ts`, `WhtIncomeCategory`
- Effort: S–M ต่อข้อ | ต้องยืนยันสถานะปัจจุบันก่อน

### G6 · ปิดบัญชีสิ้นปี (year-end closing) → ภ.ง.ด.50
GAP-05: มีแค่ปิดงวดรายเดือน ไม่มี fiscal year, ไม่มีบัญชีกำไรสะสม, ไม่มี closing entry → นิติบุคคลปิดงบส่ง DBD + ยื่น ภ.ง.ด.50 จากระบบตรง ๆ ไม่ได้ (ทีมเคาะ: ไว้ก่อน จะกลับมาทำทันสิ้นรอบบัญชีแรกของลูกค้าจริง)
- Effort: L | มี outline ใน finance-accounting-gaps GAP-05

### G7 · Persona พนักงานหน้างาน ให้ "15 วินาที" จริง
มี web upload + LINE capture correction แล้ว แต่ blueprint เน้น loop แน่น ๆ: ถ่ายรูปเดียว → verdict ทันที → รู้ว่าต้องขอเอกสารเพิ่มอะไร "ตอนยังยืนหน้าร้าน" → เห็นสถานะเบิกคืน โดยพนักงานเห็นแค่งานตัวเอง
- ต่อยอดจาก: `expenses/upload`, LINE capture, reimbursement status (มี `read_own` แล้ว)
- Effort: M (ผูกกับ G1)

### G8 · บั๊ก P1 ที่บล็อกการใช้งานจริง (ปิดก่อน feature ใหม่)
- **GAP-01**: preset การเงิน/บัญชี custom role ขาดสิทธิ์ `.read` → role สร้างแล้วเปิดหน้าไม่ได้
- **GAP-07**: expense ที่จ่ายแล้วค้าง `postingStatus='pending'` ถาวร → บล็อกปิดงวดตลอดกาล
(สถานะล่าสุดใน `docs/specs/finance-accounting-gaps-spec.md` — บางข้อทำแล้ว ยืนยันก่อน)

---

## 3. User Stories (ละเอียด — จัดตาม persona + rule engine)

หลักคิด: **แต่ละ persona เห็นแค่งานของตัวเอง** และทุก story ต่อยอดจากโมดูลที่มีอยู่ ไม่รื้อใหม่

### Persona A — พนักงานหน้างาน (ผู้จ่ายเงิน)

**US-A1 · ถ่ายบิลรู้ผลใน 15 วินาที** *(ปิด G1, G7)*
> ในฐานะพนักงานที่จ่ายเงินหน้างาน ฉันต้องการถ่ายรูปบิลครั้งเดียวแล้วเห็นทันทีว่า "ใช้ได้/ขาดอะไร" เพื่อขอเอกสารเพิ่มจากร้านได้ตอนที่ยังยืนอยู่หน้าร้าน

Acceptance criteria:
- ถ่าย/อัปโหลด 1 รูป → OCR อ่าน → แสดง **verdict card** ภายในไม่กี่วินาที: เขียว = ใช้ได้, เหลือง = ขาด X (เช่น "บิลนี้ไม่มีเลขผู้เสียภาษีผู้ขาย — ขอใบกำกับภาษีเต็มรูป หรือถ้าร้านออกไม่ได้ ระบบจะสร้างใบรับรองแทนใบเสร็จให้")
- ถ้า OCR confidence ต่ำ ระบบถาม **คำถามเดียว** (เช่น "จ่ายให้บริษัทหรือบุคคล?") ไม่ให้กรอกฟอร์มยาว
- กดปุ่มเดียวเข้าสู่ flow ใบรับรองแทนใบเสร็จที่มีอยู่แล้ว ถ้าเอกสารไม่พอ
- ต่อยอด: `expenses/upload`, `ReceiptAiVerification`, substitute-receipt flow

**US-A2 · เห็นสถานะเบิกคืนโดยไม่ต้องทวงเจ้านาย** *(ปิด G7)*
> ในฐานะพนักงาน ฉันต้องการเห็นสถานะคำขอเบิกของฉัน (รออนุมัติ/อนุมัติแล้ว/รอการเงินโอน/จ่ายแล้ว) เพื่อไม่ต้องทวงทางไลน์

Acceptance criteria:
- หน้า/การ์ด "ของฉัน" แสดง timeline สถานะ ใช้สิทธิ์ `reimbursement.read_own` ที่มีอยู่
- แจ้งเตือนผ่าน LINE เมื่อสถานะเปลี่ยนเป็น "จ่ายแล้ว"
- ต่อยอด: `reimbursements` finance-queue/status, notification + LINE

**US-A3 · จ่ายแทนบริษัทแล้วเคลียร์ทีหลังแบบมีหลักฐาน** *(จุดแข็งเดิม + blueprint pain #4)*
> ในฐานะพนักงาน/กรรมการที่ควักเงินจ่ายก่อน ฉันต้องการยื่นเบิกจากมือถือง่ายเท่าส่งไลน์ พร้อมแนบสลิปโอน เพื่อให้มีร่องรอยอนุมัติชัดเจน

Acceptance criteria:
- ยื่นเบิกแนบหลักฐานโอน → เข้า flow อนุมัติ (MANAGER/ADMIN) → จ่าย (FINANCE) แยกมือ ตามที่มีอยู่
- ต่อยอด: `reimbursements` (GAP-02 สะพานลง GL ทำแล้ว: อนุมัติ→`Dr 5310-01/Cr 2130-01 เจ้าหนี้พนักงาน`, จ่าย→`Dr 2130-01/Cr ธนาคาร`)

### Persona B — เจ้าของกิจการ

**US-B1 · เห็นกำไรจริงแบบเรียลไทม์ ไม่ใช่ยอดเงินในบัญชี** *(blueprint pain #5)*
> ในฐานะเจ้าของ ฉันต้องการเห็นกำไร/ค่าใช้จ่าย/ภาษีค้างจ่ายแบบเรียลไทม์ เพื่อไม่ต้องบริหารด้วยยอดเงินในบัญชีธนาคาร

Acceptance criteria:
- dashboard ดึงจาก double-entry ledger (P&L/BS) ไม่ใช่ผลรวมเอกสารดิบ
- ถาม LINE AI ได้ "เดือนนี้กำไรเท่าไหร่ / ภาษีต้องจ่ายเท่าไหร่"
- ต่อยอด: `reports` (financial.profit_and_loss), LINE AI read-only

**US-B2 · เตือนก่อนแตะ 1.8 ล้าน ต้องจด VAT** *(ปิด G4)*
> ในฐานะเจ้าของกิจการที่ยังไม่จด VAT ฉันต้องการให้ระบบเตือนล่วงหน้าเมื่อรายได้สะสม 12 เดือนใกล้ 1.8 ล้าน เพื่อจดทะเบียนภายใน 30 วันไม่โดนภาษีย้อนหลัง

Acceptance criteria:
- เฝ้ายอดรายได้สะสมแบบ rolling 12 เดือน → เตือนที่ threshold (เช่น 80%, 95%, เกิน)
- ปุ่ม "เริ่ม wizard เปลี่ยนเป็น VAT" นำเข้า flow US-C-transition
- ต่อยอด: `sales.summary`, `CompanyVatRegistration*`, notification

**US-B3 · อนุมัติรายจ่ายจากมือถือ พร้อมเหตุผลภาษี** *(blueprint pain #4 + G1)*
> ในฐานะเจ้าของ/ผู้อนุมัติ ฉันต้องการอนุมัติรายจ่าย/ใบเบิกจากมือถือ โดยเห็น verdict สั้น ๆ ว่ารายการนี้หักภาษีได้ไหม/ต้องหัก ณ ที่จ่ายไหม เพื่อตัดสินใจได้เร็วโดยไม่ต้องเป็นนักบัญชี

Acceptance criteria:
- คิวอนุมัติแสดง verdict badge ต่อรายการ + เหตุผล 1 บรรทัด
- ต่อยอด: reimbursement/procurement approval + verdict จาก G1

### Persona C — นักบัญชี / สำนักงานบัญชี

**US-C1 · คิวตรวจเฉพาะรายการก้ำกึ่ง ไม่ใช่ทั้งกอง** *(ปิด G1, blueprint human-in-the-loop)*
> ในฐานะนักบัญชี ฉันต้องการให้ระบบส่งเข้าคิวตรวจเฉพาะรายการที่ confidence ต่ำหรือกฎก้ำกึ่ง เพื่อไม่ต้องไล่ดูทุกใบ

Acceptance criteria:
- รายการ `NEEDS_REVIEW`/confidence ต่ำ → เข้า `TaxReviewIssue` queue อัตโนมัติ พร้อมเหตุผลว่าทำไมถูก flag
- นักบัญชี override ได้ และการ override ถูกบันทึก audit
- ต่อยอด: `TaxReviewIssue`, finance queue

**US-C2 · verdict ทุกใบมีคำอธิบาย + อ้างกฎหมาย** *(ปิด G1)*
> ในฐานะนักบัญชี ฉันต้องการเห็นว่าทำไมระบบตัดสินแบบนี้ พร้อมอ้างอิงประกาศ/มาตรา เพื่อกล้ายืนยันเวลาสรรพากรตรวจ

Acceptance criteria:
- ทุก verdict แสดง `explain_th` + `law_ref` (เช่น "ค่ารับรอง ภาษีซื้อขอคืนไม่ได้ — ม.82/5", "หักบริการ 3% — ทป.4/2528 ข้อ 8")
- audit เก็บว่า verdict ใช้กฎเวอร์ชัน/effective date ไหน
- ต่อยอด: G1 verdict + G2 rules-as-data (จำเป็นคู่กัน)

**US-C3 · ชุดยื่นภาษีพร้อมส่ง** *(จุดแข็งเดิม)*
> ในฐานะนักบัญชี ฉันต้องการชุดยื่น ภ.พ.30 / ภ.ง.ด.3/53 + 50 ทวิ ที่รวมยอดอัตโนมัติและ export ได้ เพื่อไม่ต้องคีย์ซ้ำ

Acceptance criteria (ส่วนใหญ่มีแล้ว — ต่อ verdict engine):
- vat-report / wht-report + filing-package + 50 ทวิ PDF (มีแล้ว) ดึง verdict ที่ผ่านการตรวจ
- export review JSON/CSV/XLSX/PDF (มีแล้ว)

**US-C4 · เปลี่ยนผ่าน non-VAT → VAT ให้ลูกค้าแบบมีขั้นตอน** *(ปิด G4)*
> ในฐานะนักบัญชี ฉันต้องการ wizard พาลูกค้าจาก non-VAT เป็น VAT: เดือนสุดท้ายก่อนจด → วันจด → เดือนแรกหลังจด โดยข้อมูลเก่าไม่ต้องเริ่มใหม่

Acceptance criteria:
- ตั้งวันจดทะเบียน → ระบบสลับพฤติกรรมเอกสาร/ผังบัญชี/VAT engine ตั้งแต่วันนั้น (engine เดียว สลับ mode)
- รายงานภาษีซื้อที่ใช้สิทธิได้เริ่มนับจากวันจด
- ต่อยอด: `CompanyVatRegistration*`, VAT engine mode switch

**US-C5 · ปิดบัญชีสิ้นปี → ภ.ง.ด.50** *(ปิด G6)*
> ในฐานะนักบัญชี ฉันต้องการปิดรอบบัญชีสิ้นปี (ล้างรายได้/ค่าใช้จ่ายเข้ากำไรสะสม + ล็อกทั้งรอบ) เพื่อออกงบ+ เตรียม ภ.ง.ด.50 จากระบบเดียว

Acceptance criteria (ตาม outline GAP-05):
- config รอบบัญชี + บัญชีกำไรสะสมในผัง template + migration บริษัทเดิม
- use case ปิดปี: ทุกงวด CLOSED → closing entry → ล็อกรอบ
- สิทธิ์ `ledger.year.close` (OWNER + ACCOUNTANT)
- งบแสดงฐานะการเงิน + งบกำไรขาดทุนหลังปิด

### Rule Engine — user stories เชิงระบบ

**US-R1 · verdict pipeline 4 ขั้นต่อรายจ่ายหนึ่งบรรทัด** *(ปิด G1)*
> ในฐานะระบบ ฉันต้องประมวลทุก expense line ผ่านท่อ: document validator → WHT engine → VAT engine → deductibility classifier แล้วคืน verdict เดียวที่มี rate/หักเท่าไหร่/เคลมได้ไหม/ขาดอะไร + `explain_th` + `law_ref` + `confidence`

Acceptance criteria:
- input = expense object (ผู้ขาย: นิติ/บุคคล, จด VAT ไหม, เลข 13 หลัก; หมวด; ยอด; ประเภทเอกสาร; company VAT mode)
- VAT mode เป็นแค่ field ใน context (engine เดียวรองรับทั้งจด/ไม่จด)
- output ผูกกับ posting + ชุดยื่นรายเดือน
- ต่อยอด: รวม `tax-evidence-policy.logic.ts` + WHT category + claim status ที่มีอยู่

**US-R2 · VAT engine 5 ด่าน คืนเหตุผลตกด่านไหน** *(ปิด G1)*
> ในฐานะระบบ ฉันต้องตัดสินภาษีซื้อผ่าน 5 ด่าน: (0) โหมดกิจการ → (1) ประเภทเอกสารเต็มรูป → (2) ครบ ม.86/4 (8 องค์ประกอบ) → (3) ต้องห้าม ม.82/5 (ค่ารับรอง/รถนั่ง≤10/ไม่เกี่ยวกิจการ/ผู้ไม่มีสิทธิออก) → (4) เวลา 6 เดือน

Acceptance criteria:
- ตกด่านไหนคืนคำตัดสัน + เหตุผลด่านนั้นทันที
- ด่าน 0 non-VAT: แสดง "ภาษีซื้อรวมเป็นต้นทุน — เงินไม่หาย แค่เปลี่ยนที่อยู่"
- ด่าน 2: OCR + validator เช็ค 8 องค์ประกอบอัตโนมัติ
- ด่าน 3 รถนั่ง: ผูกทะเบียนรถใน master data
- ด่าน 4: countdown เตือนก่อนหมดสิทธิ; schema เผื่อ apportionment ratio (เฉลี่ยภาษีซื้อ phase 2)

**US-R3 · WHT engine ครบ edge case** *(ปิด G5)*
> ในฐานะระบบ ฉันต้องประเมิน WHT: เปิดใช้เมื่อผู้จ่าย=นิติ + ยอดสะสม **ต่อสัญญา** ≥1,000 → จำแนกประเภทเงินได้ → เลือกอัตรา/แบบยื่นตามผู้รับ (บุคคล→ภ.ง.ด.3, นิติ→ภ.ง.ด.53) ฐาน = ยอดก่อน VAT วันจ่ายจริง

Acceptance criteria:
- นับ 1,000 สะสมต่อสัญญา ไม่ใช่ต่อบิล
- บิลปนสินค้า+บริการ: แยกได้หักเฉพาะบริการ แยกไม่ได้หักทั้งยอด + เตือนขอแยกบรรทัด
- gross-up ออกภาษีแทนคำนวณถูก
- ต่างประเทศ → ชุดกฎ ภ.ง.ด.54 + ภ.พ.36 (โครงสร้างเผื่อไว้)
- ต่อยอด: `wht-report.logic.ts`, `WhtIncomeCategory`

**US-R4 · กฎเป็น data มี effective date** *(ปิด G2)*
> ในฐานะทีม compliance ฉันต้องแก้กฎ (อัตรา/ผังบัญชี posting) ได้โดยไม่ต้อง deploy และรายการเก่าต้องคำนวณด้วยกฎ ณ วันที่เกิดรายการ

Acceptance criteria:
- posting rule ย้ายจาก hardcode เป็น `PostingRule` record (when/then/priority/effective/law_ref/explain_th)
- อัตราภาษีใช้ `TaxRateConfig` ที่มี effective date (มีแล้ว) — ต่อ posting เข้าชุดเดียวกัน
- ต่อยอด: `PostingRule` model + `cr-2-posting-rule-writer.md`

**US-R5 · ตรวจเลขผู้เสียภาษี 13 หลัก** *(ปิด G3)*
> ในฐานะระบบ ฉันต้องเช็คเลข 13 หลักของผู้ขายกับระบบตรวจสอบผู้ประกอบการ VAT ของสรรพากร ตอน OCR อ่านได้ เพื่อกันใบกำกับปลอม/ผู้ไม่มีสิทธิออก

Acceptance criteria:
- ผลเช็ค (จด VAT จริง/active/ชื่อตรง) แนบเข้า verdict ด่าน 3
- cache ผล + พฤติกรรมชัดเมื่อ verify ไม่ได้ (ไม่ block แต่ flag)
- ต่อยอด: OCR เลขผู้เสียภาษี + `AccountingCounterparty`

**US-R6 · audit ทุก verdict + confidence routing**
> ในฐานะระบบ ฉันต้องเก็บ audit ทุกคำตัดสิน (กฎเวอร์ชันไหน ใครแก้ ใคร override) และถ้า confidence ต่ำกว่าเกณฑ์ ต้องถามคำถามเดียวแทนการเดา แล้วส่งเข้าคิวนักบัญชี

Acceptance criteria:
- verdict record เก็บ rule version + actor + override
- threshold confidence → ถาม 1 คำถาม → ก้ำกึ่งไหลเข้า `TaxReviewIssue`
- ต่อยอด: audit log ที่มี + `ReceiptAiVerification` + `TaxReviewIssue`

---

## 4. ลำดับที่แนะนำ (ต่อยอดจากจุดแข็ง ให้เห็นผลเร็ว)

1. **ปิดบั๊ก P1 ก่อน** (G8: GAP-01 สิทธิ์ read ของ preset, GAP-07 expense ค้าง pending) — ไม่งั้น feature ใหม่วางบนฐานที่ปิดงวดไม่ได้
2. **G1 verdict engine (US-R1/R2/R3 + A1 + C2)** — แต้มต่อสูงสุด และ backend มีข้อมูลครบแล้ว งานหลักคือ orchestrate + surface
3. **G2 posting-as-data (US-R4)** — ปลดล็อก audit "กฎเวอร์ชันไหน" ให้ verdict สมบูรณ์
4. **G3 ตรวจเลข 13 หลัก (US-R5)** — จุดขายที่คู่แข่งไม่มี ทำคู่ขนานได้
5. **G4 non-VAT→VAT (US-B2/C4)** — lifetime value
6. **G6 ปิดสิ้นปี (US-C5)** — ตามที่ทีมเคาะ ทำทันสิ้นรอบบัญชีแรกของลูกค้าจริง

หมายเหตุ: UI ledger/journal/period-closing มีในโค้ดแต่ซ่อน (`ACCOUNTING_UI_HIDDEN=true`, owner decision 2026-08-09) — server posting ยังทำงาน หลายอย่างข้างบนเป็นการ "เปิด + เสริมชั้นอธิบาย" มากกว่าสร้างใหม่
