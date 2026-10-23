# e-Withholding Tax Payment Spec — จ่ายผ่าน e-WHT (ธนาคารนำส่ง อัตรา 1%)

Status: READY (docs-first) — reviewed 4 rounds + focused blocker checks 2026-10-24, no HIGH open; see Must close before coding (owner Q1–Q4 first)
Owner: Expenses + Tax lane
Related: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (ข้อ 7), `docs/plans/e-withholding-tax-payment-plan.md`, `docs/agent-memory/e-withholding-tax-payment.md`, `docs/specs/wht-settlement-capture-spec.md`, `docs/specs/wht-certificate-system-issuance-spec.md`, `docs/specs/withholding-returns-complete-spec.md`, `docs/research/rd-filing-and-data-intake-research.md` (RA-24), `docs/guidelines/thai-ux-standard.md`
Baseline: main 6c54ba208 (2026-10-23) — อ่านจาก worktree `claude/expense-specs-20261023` ซึ่ง tree เดียวกับ 6c54ba208 (tree `7593ad1f`)

## 1. ปัญหา

ร้านที่จ่ายค่าบริการ ค่าเช่า ค่าวิชาชีพ ค่าโฆษณา หรือรางวัล ผ่านบริการ e-Withholding Tax (e-WHT) ของธนาคาร ได้อัตราหัก ณ ที่จ่าย 1% แทน 5/3/2% และธนาคารเป็นผู้นำส่งภาษีกับข้อมูลให้กรมสรรพากรเอง (§5) แต่ระบบวันนี้ไม่รู้จัก e-WHT เลย ผลคือรายการที่ธนาคารนำส่งไปแล้วถูกนับซ้ำในงานยื่นแบบของร้าน

หลักฐาน (อ่านโค้ด ณ baseline):

- **ไม่มีแนวคิด e-WHT ในโค้ด** — ค้น `e-WHT|eWHT|e-Withholding|epay.rd` ใน `apps/` `packages/` `scripts/` ไม่พบ (มีแต่ชื่อไฟล์ `expense-wht-*` ที่บังเอิญตรง)
- **อัตราเป็นเลขอิสระ 0–100%** — `validateExpenseWhtInput` ([packages/contracts/src/expenses.ts:531-547](../../packages/contracts/src/expenses.ts)) ไม่มีเงื่อนไขช่องทางจ่าย
- **อัตราตั้งต้นตามประเภทเงินได้** — migration [`20261004120000_open_wht_income_categories`](../../apps/api/prisma/migrations/20261004120000_open_wht_income_categories/migration.sql): ค่าบริการ 3% (`WHT_SERVICE_3` บุคคล, `WHT_SERVICE_5` นิติบุคคล), ค่าเช่า 5%, ค่าวิชาชีพ 3%, ค่าโฆษณา 2%, ค่าขนส่ง 1%; [`20261013120100_wht_income_routes_catalog`](../../apps/api/prisma/migrations/20261013120100_wht_income_routes_catalog/migration.sql) เพิ่มรางวัล ดอกเบี้ย เงินปันผล; ฟอร์มตรวจเติมอัตราตั้งต้นเมื่อเลือก "จ่ายค่าอะไร" ([apps/web/src/features/expenses/ExpensesPages.tsx:2554-2561](../../apps/web/src/features/expenses/ExpensesPages.tsx)) — ผู้ใช้พิมพ์ 1 เองได้ แต่ไม่มีที่บอกว่าจ่ายผ่าน e-WHT
- **ทุกรายจ่ายที่หักภาษีได้ 50 ทวิค้างออก** — ยืนยันรายจ่ายที่ `whtAmount > 0` สร้าง `WhtCertificateHandoff` สถานะ `REQUIRED` เสมอ ([apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:3522-3525](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), :3704-3712, ฟังก์ชัน :4912) → แท็บ "ยังไม่ออก", LINE เสนอปุ่มออก 50 ทวิ ([apps/api/src/modules/line-ai/application/line-voucher-action.service.ts:75-84](../../apps/api/src/modules/line-ai/application/line-voucher-action.service.ts)), ใบเตรียมจ่ายถือว่าทุกรายการหักภาษีเป็น `PENDING` ([apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts:130](../../apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts)) แล้วบอก "ยังไม่ได้ออกหนังสือรับรอง (50 ทวิ)" ([apps/web/src/common/i18n/workspace-dictionary.ts:153](../../apps/web/src/common/i18n/workspace-dictionary.ts))
- **ทุกการจ่ายที่หักภาษีเข้า ภ.ง.ด.3/53** — `SyncTaxEventsUseCase` เขียน `TaxEvent` `ACTIVE` ต่อการจ่ายทุกครั้ง ([apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts:276-330](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)); แบบกระดาษและไฟล์ให้ผู้ทำบัญชีอ่าน event `ACTIVE` ([apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts:48-49](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts), :117-127; [apps/api/src/modules/tax/application/services/withholding-accountant-export.ts:31-45](../../apps/api/src/modules/tax/application/services/withholding-accountant-export.ts)); ยอด ภงด.53 ใน LINE มาจาก event `ACTIVE` ([apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts:93-96](../../apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts)); การตรวจแบบเช็กแค่ `ฐาน × อัตรา ≈ ยอดหัก` ([apps/api/src/modules/tax/application/services/withholding-filing-validation.ts:107](../../apps/api/src/modules/tax/application/services/withholding-filing-validation.ts)) แถว 1% จึงผ่าน
- **ร้านแพ็ก 249–999 ส่งไฟล์ให้ผู้ทำบัญชีโดยไม่มีช่องบอกช่องทาง** — คอลัมน์ไฟล์ส่งออกมี `wht_amount` และ `wht_certificate_numbers` แต่ไม่มีช่องทางนำส่ง ([packages/contracts/src/expenses.ts:1762](../../packages/contracts/src/expenses.ts), :1795, ไฟล์แบบย่อ :1862-1872)
- **`WHT_RATE_MISMATCH` มีแต่คำ ไม่มีใครสร้าง** — [apps/api/src/modules/tax/domain/logic/tax-period.logic.ts:94](../../apps/api/src/modules/tax/domain/logic/tax-period.logic.ts), :124; ป้าย [apps/web/src/features/tax/tax.logic.ts:36](../../apps/web/src/features/tax/tax.logic.ts)
- **คำอธิบายของ AI/คู่มือไม่พูดถึง e-WHT** — `wht.calculate_withholding` ([erp-advisor-document-tools.use-case.ts:146-149](../../apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts)); แนวทางผู้ช่วย ([apps/ai-gateway/src/modules/line-ai/agents/advisor-domain-guidance.ts:9-10](../../apps/ai-gateway/src/modules/line-ai/agents/advisor-domain-guidance.ts)); การ์ด `wht.calculation` v6 ([apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts:138](../../apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts)); คู่มือภาษี ([apps/web/src/features/user-guide/tax-guide.content.ts:107-145](../../apps/web/src/features/user-guide/tax-guide.content.ts))

**สถานการณ์ที่ผิดจริงวันนี้:** ร้านแพ็ก 1,999 จ่ายค่าโฆษณาบริษัท A ฐาน 10,000 + VAT 700 ผ่าน e-WHT เมื่อ 5 พ.ย. 2569 ธนาคารหัก 1% = 100 บาทและนำส่งภายใน 4 วันทำการ ร้านบันทึกรายจ่าย "ค่าโฆษณา (นิติบุคคล)" แก้อัตราเป็น 1 → ยืนยัน → 50 ทวิค้าง "ยังไม่ออก" → 7 ธ.ค. ดาวน์โหลด ภ.ง.ด.53 เดือน พ.ย. ที่มีแถวบริษัท A หัก 100 → ยื่นและชำระซ้ำ 100 บาท และอาจออก 50 ทวิกระดาษอีกใบ

## 2. เป้าหมาย

1. ผู้ตรวจรายจ่ายบอกได้ในฟอร์มเดิมว่า "ธนาคารนำส่ง (e-WHT)"; ระบบเสนออัตรา 1% เมื่อประเภทลดได้ วันที่อยู่ในช่วง และกรอกเป็นเปอร์เซ็นต์ (§5.2)
2. รายการ e-WHT ไม่เข้าแบบ ภ.ง.ด.3/53, ไฟล์ผู้ทำบัญชีของแบบ, ยอด ภงด.53 ใน LINE และไม่มี 50 ทวิค้าง — แต่ยังเห็นและดาวน์โหลดแยกเป็นรายการ "จ่ายผ่าน e-WHT" ได้ทุกเดือน (รวมเดือนที่ไม่มีแบบหรือยื่นแล้ว) เพื่อกระทบกับหลักฐานธนาคาร
3. การจ่ายของรายจ่าย e-WHT ทุกทาง (บันทึกจ่ายเว็บ/LINE, ใบเตรียมจ่าย, ใบรับรองแทนใบเสร็จ, รายการจ่ายเดิมก่อนเปลี่ยนช่องทาง) ไม่เป็นเงินสดหรือบัตร
4. ไฟล์ส่งออกรายจ่าย (ทุกแพ็ก) บอกช่องทางนำส่งทุกแถวที่หักภาษี
5. รายการที่ร้านยื่นเองแต่หัก 1% ในประเภทที่ปกติสูงกว่า ได้คำเตือนก่อนยื่น (`WHT_RATE_MISMATCH`) — โดยไม่ทึกทักว่า 1% แปลว่า e-WHT
6. ทุกประโยคใหม่จริงในทุกกรณี (ตาราง §10.2), การปฏิเสธมีทางออก, ไม่มีสวิตช์

## 3. Non-goals

- **การจ่ายเงินจริงหรือเชื่อมธนาคาร** — ระบบไม่ส่งคำสั่ง e-WHT ไม่ดึงใบเสร็จอิเล็กทรอนิกส์ (backlog ข้อ 11) ระบบเชื่อสิ่งที่ผู้ตรวจระบุ
- **บัญชีธนาคารที่ตั้งเป็น e-WHT แบบ PEAK** — PEAK ตั้งวัตถุประสงค์บัญชีเป็น "ใช้ e-Withholding Tax" แล้วแนะนำอัตราตอนจ่าย ([PEAK manual](https://www.peakaccount.com/peak-manual/financial-accounting-data/add-bank-account/creating-bank-account-type)) แต่แพ็กที่ขายไม่มีทะเบียนบัญชีธนาคารของร้าน (`BankAccount` อยู่ในโมดูลกระทบยอดที่ไม่ได้ขาย; `ExpenseRecord.bankAccountRef`/`DisbursementVoucher.paidFromRef` เป็นข้อความอิสระ) จึงเลือกที่รายจ่าย
- **ใบจ่ายเจ้าหนี้ (procurement `SupplierPayment`)** — ไม่อยู่ในแพ็กที่ขาย (`STARTER_FEATURE_KEYS` — [packages/contracts/src/menu-entitlements.ts:432-450](../../packages/contracts/src/menu-entitlements.ts)); ลูป supplier payment ใน sync คงเดิม (นับเป็นร้านยื่นเอง)
- **ใบเบิก (claims)** — รับรายจ่ายที่หักภาษีไม่ได้ (`reimbursement_source_tax_review_required` — [apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:39](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)); รายการที่ใบเบิกสร้างมี WHT 0 ([materialize-claim-expenses.service.ts:84](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts), :94)
- **ฝั่งร้านเป็นผู้ถูกหักผ่าน e-WHT** — โมดูลไม่ได้ขาย
- **การลงบัญชีการนำส่งภาษี** — ระบบไม่ลงบัญชีการนำส่งภาษีหัก ณ ที่จ่ายอยู่แล้ว (มีแค่ `markPaid` สถานะงวด — [apps/api/src/modules/tax/presentation/http/tax.controller.ts:376](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts))
- **หนึ่งรายจ่ายจ่ายหลายงวดคนละช่องทาง** (§5.4)
- **ใบสำคัญจ่าย PDF** — ข้อความเดิมยังจริง (แสดงยอดภาษีที่หัก ไม่ได้อ้าง 50 ทวิ — [disbursement-voucher-pdf.logic.ts:130](../../apps/api/src/modules/expenses/domain/logic/disbursement-voucher-pdf.logic.ts), :158) → gap G5
- **เปิดเครื่องคิดเลข/สรุปรายเดือนใน LINE ให้แพ็กอื่น** — registry ผูก `wht_50bis`/`wht_pnd53` ([packages/contracts/src/ai-tools.ts:1354](../../packages/contracts/src/ai-tools.ts), :1361) คงเดิม; ความรู้ทั่วไปเรื่อง e-WHT ไปทางการ์ดคำตอบที่เปิดทุกแพ็ก (§4)
- ภ.ง.ด.1 / เงินเดือน, ภ.ง.ด.54

## 4. ผู้ใช้และ journey

| ผู้ใช้ | เว็บ (390, 1,280 และ ~1,556 px) | LINE |
|---|---|---|
| **ผู้ตรวจ/เจ้าของร้าน** (`expense.review` หรือผู้ส่งรายการตามกติกาเดิม) | เปิดรายจ่าย → "หัก" → ผู้รับเงินเป็นใคร → จ่ายค่าอะไร → **นำส่งภาษีอย่างไร** = "ธนาคารนำส่ง (e-WHT)" → อัตราเติม 1% เมื่อเข้าเงื่อนไข (แก้ได้) → ยืนยัน; ถ้ารายจ่ายมีการจ่ายเงินสด/บัตรอยู่แล้ว เลือก e-WHT ไม่ได้ (W-R2) | รายจ่ายที่หักภาษีไปยืนยันบนเว็บผ่าน "ตรวจเพื่อยืนยัน" เหมือนเดิม ([line-expense-action.service.ts:648-649](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)); ข้อความไม่พูดถึง 50 ทวิสำหรับ e-WHT (L-3) |
| **ผู้บันทึกจ่าย** (`expense.payment.record`) | วิธีจ่ายของรายการ e-WHT ไม่มีเงินสด/บัตร ตั้งต้น "โอนเงิน" + W-P1; วันจ่ายนอกช่วงได้ W-P2 | การ์ดบันทึกจ่ายมี L-2 (+ L-9 ถ้าวันจ่ายนอกช่วง); ไม่ถามวิธีจ่าย ตั้งต้น "โอนเงิน"; พิมพ์ว่าเงินสด → L-1 พร้อมปุ่ม [โอนเงิน] [เปิดรายการ] ที่ผูกกับรายการเดิม (§10.5) |
| **ผู้เตรียม/อนุมัติ/จ่ายใบเตรียมจ่าย** | รายการ e-WHT แสดง W-V1 แทน "ยังไม่ได้ออก 50 ทวิ"; วิธีจ่ายที่วางแผน/จ่ายจริงไม่มีเงินสด/บัตรเมื่อมีรายการ e-WHT; W-P1/W-P2 ในการ์ดจ่าย | การ์ดใบเตรียมจ่าย L-4 (+ L-9); พรีวิวการจ่ายปฏิเสธเงินสด/บัตรตั้งแต่ก่อนกดยืนยัน (L-1); ไม่มีปุ่มออก 50 ทวิให้รายการ e-WHT |
| **ผู้ทำใบรับรองแทนใบเสร็จ** | วิธีจ่ายในใบรับรองของรายจ่าย e-WHT ไม่มีเงินสด/บัตร (W-R3) | — |
| **ผู้ทำบัญชี แพ็ก 249–999** | ไฟล์ส่งออกรายจ่ายมีคอลัมน์ "วิธีนำส่งภาษีหัก ณ ที่จ่าย" (คอลัมน์สุดท้าย) | — |
| **ผู้ทำบัญชี แพ็ก 1,999** (`wht.pnd53.read`) | หน้า ภาษีหัก ณ ที่จ่าย: แบบไม่มีแถว e-WHT; การ์ด "จ่ายผ่าน e-WHT" + ปุ่ม "ดาวน์โหลดรายการ e-WHT" (ทำงานแม้เดือนไม่มีแบบหรือยื่นแล้ว); การ์ด "ควรตรวจก่อนยื่น" สำหรับ `WHT_RATE_MISMATCH` | สรุปรายเดือนแยกยอด e-WHT (L-11) |
| **ทุกแพ็กที่ถามน้องมั่งมี** | คู่มือภาษีหัวข้อ "จ่ายผ่าน e-WHT" | ถาม "e-WHT คืออะไร / ต้องยื่น ภงด53 ไหม" → การ์ด `wht.e-wht` (featureKeys ว่าง — เปิดทุกแพ็กที่อ่านรายจ่ายได้) |
| **แพ็ก 1,999 ที่ใช้เครื่องคิดเลข** | — | ถามค่าโฆษณา → เลือกปุ่มประเภท (ชื่อเต็มในแค็ตตาล็อก) → คำตอบเดิม + L-5; แพ็กอื่นได้ข้อความแพ็กเดิมของ scope policy ไม่เห็นเครื่องคิดเลข |

## 5. กติกา/ข้อยกเว้น

### 5.1 แหล่งที่มา (อ่านเอง)

- **กฎกระทรวง ฉบับที่ 402 (พ.ศ. 2569)** — https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr402.docx — แทนที่ (17/5) ของข้อ 2 กฎกระทรวง 144: จ่าย **1 ม.ค. 2569 – 31 ธ.ค. 2570** และผู้มีหน้าที่นำส่งดำเนินการตามวิธีนำส่งตามมาตรา 3 ปัณรส หักร้อยละ 1.0: (ก) 40(2) ให้บริษัท/ห้างนิติบุคคล (ข) 40(3) ค่ากู๊ดวิลล์ ลิขสิทธิ์ สิทธิอื่น ให้บริษัท/ห้างนิติบุคคล (ค) 40(5)(ก) ค่าเช่า ยกเว้นค่าเช่าเรือตามกฎหมายส่งเสริมพาณิชยนาวีที่ใช้ขนส่งสินค้าระหว่างประเทศ (ง) 40(6) และ 40(7) (จ) 40(8) รางวัลประกวด แข่งขัน ชิงโชค (ฉ) 40(8) ค่าแสดงของนักแสดงสาธารณะบุคคลธรรมดามีภูมิลำเนาในไทย (ช) 40(8) จ้างทำของ รางวัล/ส่วนลดส่งเสริมการขาย ค่าโฆษณา และบริการอื่น **ไม่รวมค่าบริการโรงแรม ภัตตาคาร และเบี้ยประกันชีวิต**; ทุกข้อไม่รวมมูลนิธิหรือสมาคมที่ประกอบกิจการซึ่งมีรายได้และที่รัฐมนตรีประกาศตามมาตรา 47(7)(ข); ลงนาม 1 ต.ค. 2569 ประกาศในราชกิจจานุเบกษา เล่ม ๑๔๓ ตอนที่ ๖๓ ก วันที่ ๙ ตุลาคม ๒๕๖๙ (หัวเอกสาร mr402.docx — fact-check lane อ่านเมื่อ 2026-10-23)
- **กฎกระทรวง ฉบับที่ 389 (พ.ศ. 2566)** — https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr389.pdf — รายการเดียวกัน ช่วง **1 ม.ค. 2566 – 31 ธ.ค. 2568** (ราชกิจจาฯ เล่ม 140 ตอนที่ 15 ก, 10 มี.ค. 2566) ⇒ 1% ต่อเนื่อง 1 ม.ค. 2566 – 31 ธ.ค. 2570
- **กฎกระทรวง 144 ข้อ 2 รวมฉบับ** — https://www.rd.go.th/2494.html (ปรับปรุง 20 ต.ค. 2569) — ข้อ 2(7)(ค) ค่าเช่าเรือที่ใช้ขนส่งสินค้าระหว่างประเทศหัก **1.0% ตามปกติ ไม่ต้องผ่าน e-WHT**; ข้อ 2(17/5) คือข้อ e-WHT 2569–2570 ซึ่งตัดค่าเช่าเรือนั้นออก (ยืนยันโดย coordinator ตาม review F13)
- **คำสั่งกรมสรรพากร ท.ป.4/2528 ข้อ 12/1** — https://www.rd.go.th/3479.html (ปรับปรุง 25 มิ.ย. 2569) — ค่าบริการหัก 3% ให้บุคคลและบริษัท (ไม่รวมมูลนิธิ/สมาคม) **ไม่รวมการจ่ายค่าบริการของโรงแรม ภัตตาคาร และเบี้ยประกันชีวิต** — คือรายการเหล่านี้ไม่ใช่ค่าบริการที่ต้องหัก 3% ตั้งแต่ต้น ไม่ใช่ "ใช้อัตราปกติ"; ข้อ 12/3 เบี้ยประกันวินาศภัย 1%; ข้อ 12/7 หักเมื่อจ่ายตามสัญญาเดียวตั้งแต่ 1,000 บาท
- **ข่าวกรมสรรพากร ปชส. 14/2569** (16 มิ.ย. 2569) — https://www.rd.go.th/fileadmin/user_upload/news/2569thai/news14_2569.pdf — ครม. ขยายมาตรการ ลด 5/3/2% เหลือ 1% สำหรับการจ่ายผ่าน e-WHT 1 ม.ค. 2569 – 31 ธ.ค. 2570
- **ข่าวกรมสรรพากร ปชส. 5/2564** (27 ต.ค. 2563) พร้อมเอกสารแนบ — https://www.rd.go.th/fileadmin/user_upload/news/news5_2564.pdf — ผู้จ่ายส่งเงินและข้อมูลให้ธนาคาร ธนาคารออกหลักฐานอิเล็กทรอนิกส์ให้ผู้จ่ายและผู้รับ โอนเงินหลังหักภาษีให้ผู้รับ นำส่งข้อมูลและภาษีให้กรมสรรพากร **ภายใน 4 วันทำการ**; กรมออกใบเสร็จอิเล็กทรอนิกส์ให้ผู้จ่าย การเสียภาษีเสร็จสมบูรณ์; นำส่งขาดไปนำส่งเพิ่มผ่านระบบนี้ได้; ผู้รับเงินตรวจหลักฐานที่ www.rd.go.th
- **"ไม่ต้องยื่น ภ.ง.ด.3/53 และไม่ต้องออก 50 ทวิ"** — **ยืนยันจากหน้าของกรมสรรพากรเอง**: ปชส. 5/2564 หน้า 1 (เดิมผู้จ่ายยื่นแบบ นำส่ง และจัดทำหนังสือรับรองเอง เปลี่ยนให้ธนาคารเป็นตัวกลาง), หน้า 3 (วิธีนำส่ง "แทนการยื่นแบบเป็นกระดาษหรือผ่านอินเทอร์เน็ต"), หน้า 5 (ไม่ต้องจัดทำ ไม่ต้องยื่นแบบ ไม่ต้องนำส่งและไม่ต้องแนบหนังสือรับรอง); ธนาคาร (เช่น Bangkok Bank) พูดแบบเดียวกัน — **ยังไม่ได้อ่านตัวประกาศอธิบดีฯ ตามมาตรา 3 ปัณรส** (G1)

### 5.2 กติกาที่ระบบใช้

| ประเภทเงินได้ในระบบ (code) | ปกติ | e-WHT 1% | หมายเหตุ |
|---|---|---|---|
| ค่าบริการ บุคคล/นิติบุคคล (`WHT_SERVICE_3`, `WHT_SERVICE_5`) | 3% | `REDUCED` | (ช) และ (ก); ค่าบริการโรงแรม ภัตตาคาร เบี้ยประกันชีวิต ไม่ใช่ค่าบริการที่หัก 3% ตั้งแต่ต้น (ท.ป.4/2528 ข้อ 12/1) จึงไม่ควรอยู่ในประเภทนี้ |
| ค่าเช่า (`WHT_RENT_IND`, `WHT_RENT_JUR`) | 5% | `REDUCED` | (ค); ค่าเช่าเรือขนส่งสินค้าระหว่างประเทศ 1% ตามปกติ (กฎกระทรวง 144 ข้อ 2(7)(ค)) — 1% จึงไม่ได้แปลว่า e-WHT เสมอ |
| ค่าวิชาชีพ (`WHT_PROFESSIONAL_*`) | 3% | `REDUCED` | (ง) |
| ค่าโฆษณา (`WHT_ADVERTISING_*`) | 2% | `REDUCED` | (ช) |
| รางวัล (`WHT_PRIZE`, `WHT_PRIZE_JUR` ยัง DRAFT) | 5% | `REDUCED` | (จ) |
| ค่าขนส่ง (`WHT_TRANSPORT_*`) | 1% | `NOT_REDUCED` | ไม่อยู่ในรายการ |
| ดอกเบี้ย เงินปันผล (`WHT_INTEREST*`, `WHT_DIVIDEND*`) | — | `NOT_REDUCED` | 40(4) ไม่อยู่ในรายการ |
| อื่นๆ (`WHT_OTHER_IND`, `WHT_OTHER_JUR`) | 3% | `UNKNOWN` | อาจเป็น (ก)(ข)(ฉ) หรือไม่ใช่ — ไม่เดา |

- อัตราที่เสนอ = 1 เฉพาะเมื่อ: ช่องทาง `E_WHT` + ประเภท `REDUCED` + วันที่อ้างอิงใน **1 ม.ค. 2566 – 31 ธ.ค. 2570** + โหมดกรอก **RATE**; นอกนั้นคงพฤติกรรมเดิม (อัตราตั้งต้นของประเภทในโหมด RATE; โหมด AMOUNT ไม่เติมอะไร)
- วันที่อ้างอิงในฟอร์มตรวจ = วันที่เอกสาร; ตอนบันทึก/จ่ายใช้วันจ่ายจริงเพื่อเตือน W-P2/L-9 (ไม่ปฏิเสธ) — ครอบทุกทางจ่าย: บันทึกจ่ายเว็บ, จ่ายใบเตรียมจ่ายเว็บ, การ์ด RECORD_PAYMENT และ VOUCHER_PAY ใน LINE
- อัตราเป็นข้อเสนอที่แก้ได้เสมอ; **เซิร์ฟเวอร์ไม่บังคับอัตราตามช่องทาง** เพราะข้อยกเว้นในกฎกระทรวง (เช่น ผู้รับเงินบางประเภท) และช่วงวันที่ ระบบมองไม่เห็นทั้งหมด
- ช่องทาง `E_WHT` เลือกได้ทุกวันที่ (ระบบ e-WHT มีตั้งแต่ 1 ต.ค. 2563) ช่วงวันที่มีผลแค่อัตราที่เสนอ
- **ข้อห้ามเดียวที่บังคับ**: รายจ่าย `E_WHT` มีการจ่ายด้วย `CASH` หรือ `CARD` ไม่ได้ ไม่ว่าทางใด (§7.3); `BANK_TRANSFER`, `CHEQUE`, `OTHER`, ไม่ระบุ → รับ (ไม่ได้ตรวจว่าธนาคารใดรับเช็คผ่าน e-WHT จึงไม่ปฏิเสธสิ่งที่พิสูจน์ไม่ได้)
- ฐานภาษีหัก ณ ที่จ่าย = ยอดก่อน VAT เหมือนเดิม

### 5.3 ผลต่อหน้าที่ของร้าน (สิ่งที่ระบบแสดง)

- รายการ `E_WHT`: ไม่อยู่ในแบบ ภ.ง.ด.3/53 (และไม่อยู่ในชีต ภ.ง.ด.2 ของไฟล์ผู้ทำบัญชี), ไม่มี 50 ทวิ, ผู้รับเงินตรวจหลักฐานที่เว็บกรมสรรพากร
- เดือนที่มีทั้งสองแบบ: ร้านยังต้องยื่นแบบสำหรับรายการ "ร้านยื่นแบบเอง" — แบบจึงมีเฉพาะแถวเหล่านั้น

### 5.4 Partial e-WHT และกรณีขอบ

| กรณี | กติกา |
|---|---|
| เดือนเดียวกัน บางรายจ่าย e-WHT บางรายจ่ายยื่นเอง | ตามรายจ่าย; แบบมีเฉพาะร้านยื่นเอง; การ์ด/ไฟล์ e-WHT แสดงส่วนที่เหลือ |
| รายจ่ายเดียวหลายบรรทัด ต่างประเภท | ช่องทางเป็นของทั้งรายจ่าย; อัตราต่อบรรทัดตามประเภท |
| รายจ่ายเดียวจ่ายหลายงวด คนละช่องทาง | ไม่รองรับ — ระบบปันภาษีตามสัดส่วนเดียว (`allocateExpenseWithholding` — [apps/api/src/modules/tax/domain/logic/expense-payment-withholding.logic.ts:6-27](../../apps/api/src/modules/tax/domain/logic/expense-payment-withholding.logic.ts)); ทางออก: แยกเป็นสองรายจ่าย |
| ใบเตรียมจ่ายมีทั้งรายการ e-WHT และยื่นเอง | อนุญาต; สถานะต่อรายการ; วิธีจ่ายที่วางแผนและที่จ่ายจริงห้ามเงินสด/บัตรทั้งใบ |
| วันที่เอกสารหรือวันจ่ายนอก 1 ม.ค. 2566 – 31 ธ.ค. 2570 | เลือก e-WHT ได้; อัตราเสนอ = เดิม; คำเตือน W-F9 / W-P2 / L-9; ไม่ปฏิเสธ |
| เปลี่ยนเป็น e-WHT (เปิดแก้) ทั้งที่มีรายการจ่ายเงินสด/บัตร `RECORDED` อยู่ | ปฏิเสธตอนบันทึกฟอร์มและตอนยืนยันใหม่ (W-R2) — ทางออก: คงเป็น "ร้านยื่นแบบเอง" (การเปิดแก้เปลี่ยนแค่สถานะ รายการจ่ายยังอยู่ — [prisma-expense.repository.ts:802](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) |
| ใบรับรองแทนใบเสร็จของรายจ่าย e-WHT ระบุวิธีจ่ายเงินสด/บัตร | ปฏิเสธตอนบันทึก/รับรอง/ออกใบ (W-R3) — การออกใบสร้างรายการจ่ายเองด้วยวิธีจ่ายในใบ ([prisma-expense.repository.ts:3085-3098](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) |
| ร้านยื่นเองแต่หัก 1% ในประเภท `REDUCED` ในช่วง | `WHT_RATE_MISMATCH` (WARNING) หนึ่งรายการต่อรายจ่ายต่องวด — ข้อความเป็นเงื่อนไข ไม่ทึกทักว่าเป็น e-WHT (เช่น ค่าเช่าเรือขนส่งระหว่างประเทศ 1% ถูกต้องได้); แบบยังดาวน์โหลดได้ |
| ผู้รับเงินไม่รู้ประเภท (`WHT_PAYEE_KIND_UNKNOWN`) | ยืนยันรายจ่ายที่หักภาษีต้องมีประเภทผู้รับเงิน ([apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts:322-324](../../apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts)) และช่องทางตั้งได้เฉพาะตอนแก้ไขได้ ⇒ `E_WHT` + ไม่รู้ประเภทเกิดไม่ได้; ถ้าเจอ sync ข้ามแถวโดยไม่สร้าง issue; แถวเก่า `null` ได้ issue เดิม |
| เปิดแก้รายจ่าย e-WHT ที่ยังไม่จ่าย/จ่ายบางส่วน แล้วเปลี่ยนเป็นร้านยื่นเอง 2% | ยืนยันใหม่ได้เมื่อยอดที่จ่ายแล้วไม่เกินยอดสุทธิใหม่; handoff กลับเป็น `REQUIRED`; sync ⇒ `ACTIVE` |
| เปิดแก้รายจ่าย e-WHT ที่จ่ายครบแล้ว แล้วเปลี่ยนอัตราให้ยอดสุทธิลดลง | ยืนยันใหม่ถูกบล็อกด้วย `expense_paid_exceeds_payable` เดิม ([prisma-expense.repository.ts:3507](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), :4999) พร้อมทางออกเดิม `expenseOverpaymentRemedy` ([packages/contracts/src/expenses.ts:787-790](../../packages/contracts/src/expenses.ts)) — ถูกต้อง เพราะผู้รับเงินได้ยอดสุทธิของ 1% ไปแล้ว |
| เปลี่ยนรายการที่อยู่ในแบบที่ยื่นแล้วเป็น e-WHT | เปิดแก้ถูกบล็อกด้วย `tax_period_filed` เดิม ([packages/contracts/src/expenses.ts:674-676](../../packages/contracts/src/expenses.ts), :825-828) |
| e-WHT ที่จ่ายในเดือนที่ล็อกแบบเก่า (FILED/PAID/CLOSED ไม่มีแถวแบบ) | บันทึก `EXCLUDED` ได้ (ไม่แตะประวัติการยื่น) — ข้ามเฉพาะเมื่อมีแถวแบบ FILED ครอบการจ่ายนั้นจริง (§7.4); การเปิดแก้รายจ่าย e-WHT ใช้หลักเดียวกัน: บล็อกเฉพาะแถวแบบ FILED ที่ครอบจริง ไม่ใช้ล็อกเดือนแบบเก่าหรือสถานะงวดของ event `EXCLUDED` แต่ยังคงล็อกงวดบัญชีและ ภ.พ.30 (review รอบ 2 F7 — §7.4) |
| รายจ่ายสกุลเงินอื่นที่จ่ายผ่าน e-WHT | บันทึก `EXCLUDED` ตามสกุลเงินของรายการ ไม่แปลงค่า (ระบบไม่มีอัตราแลกเปลี่ยนที่ตรวจแล้ว); ทุกยอดรวม/ไฟล์/ข้อความ e-WHT แยกตามสกุลเงิน (review รอบ 2 F2) |
| ธนาคารนำส่งแล้วและร้านยื่นแบบซ้ำไปแล้ว (ก่อนมีฟีเจอร์) | นอกระบบ: ผู้ทำบัญชีติดต่อกรมสรรพากร; ระบบไม่แก้แบบที่ FILED |

## 6. Data model (additive)

```prisma
enum WhtRemittance {
  PAYER_FILES   // ร้านยื่นแบบและนำส่งเอง (ภ.ง.ด.3/53) — ความหมายเดิมของทุกแถว
  E_WHT         // จ่ายผ่าน e-Withholding Tax ของธนาคาร ธนาคารเป็นผู้นำส่ง
}

model ExpenseRecord {
  // null = ไม่หักภาษี หรือแถวก่อนมีฟีเจอร์ (ระบบนับเป็น PAYER_FILES). ตั้งได้เฉพาะเมื่อ whtAmount > 0.
  whtRemittance WhtRemittance?
}
```

Migration `apps/api/prisma/migrations/2026102412xxxx_expense_wht_remittance/migration.sql`:

```sql
CREATE TYPE "WhtRemittance" AS ENUM ('PAYER_FILES', 'E_WHT');
ALTER TABLE "ExpenseRecord" ADD COLUMN "whtRemittance" "WhtRemittance";
```

- ไม่ backfill — แถวเก่า `null`
- **ต้องผ่านทุกชั้นของ repository** (review F3): `createExpense` data, whitelist ของ `updateExpense` ([prisma-expense.repository.ts:1885-1889](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts) — ฟิลด์นอกรายการถูกทิ้งเงียบ), input types ของ repository, `mapExpense` (:244) และโมเดล `ExpenseRecord` ([apps/api/src/modules/expenses/domain/models/expense.model.ts:13](../../apps/api/src/modules/expenses/domain/models/expense.model.ts))
- **`TaxEvent` ไม่เพิ่มคอลัมน์**: ใช้สถานะ `EXCLUDED` ที่มีใน enum แต่ไม่มีใครเขียน ([tax-thailand-2026-spec.md:1044](tax-thailand-2026-spec.md)) + `sourceEventType = 'expense.wht.e_wht'`
- `WhtCertificateHandoff` ไม่เปลี่ยน — รายการ `E_WHT` ไม่สร้าง handoff
- กติกาเป็นค่าคงที่ใน `packages/contracts/src/tax.ts` แบบเดียวกับ `whtCertificateUnsupportedReason` (:956-960) เพราะรหัสประเภทมาจาก migration และผู้ดูแลระบบเปลี่ยนได้แค่สถานะ ([system-wht-income-category.controller.ts:18-32](../../apps/api/src/modules/tax/presentation/http/system-wht-income-category.controller.ts)):

```ts
export const WHT_REMITTANCES = ['PAYER_FILES', 'E_WHT'] as const;
export type WhtRemittance = (typeof WHT_REMITTANCES)[number];
export const E_WHT_REDUCED_RATE = {
  ratePercent: '1',
  windows: [
    { from: '2023-01-01', to: '2025-12-31', source: 'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr389.pdf' },
    { from: '2026-01-01', to: '2027-12-31', source: 'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/mr402.docx' },
  ],
  reduced: ['WHT_SERVICE_3', 'WHT_SERVICE_5', 'WHT_RENT_IND', 'WHT_RENT_JUR', 'WHT_PROFESSIONAL_IND', 'WHT_PROFESSIONAL_JUR',
    'WHT_ADVERTISING_IND', 'WHT_ADVERTISING_JUR', 'WHT_PRIZE', 'WHT_PRIZE_JUR'],
  unknown: ['WHT_OTHER_IND', 'WHT_OTHER_JUR'],
} as const;
export function eWhtRateKind(code?: string | null): 'REDUCED' | 'NOT_REDUCED' | 'UNKNOWN';
export function eWhtReducedRateOn(code: string | null | undefined, civilDate: string): '1' | null; // REDUCED + ในช่วง
export function eWhtPaymentMethodAllowed(method?: string | null): boolean;   // false เฉพาะ CASH, CARD
export const E_WHT_WORDS = { /* ทุกประโยคใน §10.1 ที่เดียว */ } as const;
```

- `packages/contracts/src/prisma-enum-parity.spec.ts` เพิ่ม `{ source: 'tax.ts', arrayName: 'WHT_REMITTANCES', prismaEnum: 'WhtRemittance' }`

## 7. Contracts/API

### 7.1 สัญญา

| สัญญา | การเปลี่ยน |
|---|---|
| `ExpenseDetail` ([packages/contracts/src/expenses.ts:1059](../../packages/contracts/src/expenses.ts)) / โมเดล API `ExpenseRecord` | `whtRemittance: WhtRemittance \| null` |
| `CreateExpenseDraftInput` / `UpdateExpenseDraftInput` (:1141, :1189) | `whtRemittance?: WhtRemittance \| null` — absent = คงเดิม; เก็บ `null` เมื่อ `whtAmount` หลังบันทึกเป็น 0; ค่าอื่น → 400 `expense_wht_remittance_invalid` |
| `ExpenseTotalsPreviewDto` (POST totals-preview, `forbidNonWhitelisted` — [apps/api/src/common/pipes/validation-pipe.options.ts:7](../../apps/api/src/common/pipes/validation-pipe.options.ts)) | **ไม่เพิ่ม** — เว็บตัด `whtRemittance` ออกจาก payload preview เหมือนที่ตัด `whtCategoryCode`/`whtRate` อยู่แล้ว ([apps/web/src/features/expenses/useExpenseReviewTotals.ts:24-30](../../apps/web/src/features/expenses/useExpenseReviewTotals.ts)) (review F4) |
| `DisbursementVoucherDetail.lines[]` ([packages/contracts/src/disbursement-vouchers.ts:216-217](../../packages/contracts/src/disbursement-vouchers.ts)) | `withholdingCertificate.state` เพิ่ม `'E_WHT'`; เพิ่ม `whtRemittance` และ `eWhtReducedRateApplied: boolean` (ประเภท `REDUCED` และอัตราหัวเอกสาร 1 — คำนวณด้วย `expenseWhtHeaderRate` เดิม); ต้องเพิ่ม `whtRemittance`, `whtCategoryCode`, `whtRate`, `whtInputJson`, `lines.whtRate` ใน `detailInclude` ([prisma-disbursement-voucher.repository.ts:35-39](../../apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts)) และ mapper ([disbursement-voucher.use-case.ts:276-285](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts)) เพื่อให้การ์ดจ่ายเว็บและ LINE VOUCHER_PAY แยก 1% ของประเภทลดได้จากค่าขนส่ง 1% (review รอบ 3 F5/P11); **รอบ 4 F7/P42**: `expenseWhtHeaderRate` ต้องได้บรรทัดทั้งหมดพร้อม `whtAmount`/`whtRate`/`taxableAmount` ([expense-wht-input.logic.ts:7-15](../../apps/api/src/modules/expenses/domain/logic/expense-wht-input.logic.ts) — แถวเก่าที่ `whtInputJson` ว่างใช้อัตราบรรทัดก่อนอัตราหัวเอกสาร) ⇒ เลิก `take: 1` ของ lines ใน `detailInclude` ([prisma-disbursement-voucher.repository.ts:38](../../apps/api/src/modules/expenses/infrastructure/prisma-disbursement-voucher.repository.ts)) สำหรับฟิลด์นี้ (คำอธิบายยังใช้บรรทัดแรก) |
| `WithholdingMonthDto` ([packages/contracts/src/tax.ts:941-952](../../packages/contracts/src/tax.ts)) | `bankRemitted?: WithholdingMonthPaymentDto[]` (แบบเดียวกับ `separatePnd2`); `WithholdingMonthPaymentDto` (:923-940) เพิ่ม `currency?: string` — แถว e-WHT ใส่สกุลเงินของรายการเสมอ (review รอบ 2 F2) |
| `ReviewIssueCode` `WHT_RATE_MISMATCH` | เริ่มสร้างจริง; description ไทย W-T4 severity `WARNING` |
| `ACCOUNTANT_INDEX_COLUMNS` (:1731-1797), labels, `ACCOUNTANT_INDEX_SUMMARY_COLUMNS` (:1862-1872) | `wht_remittance` ต่อท้าย**สุดท้าย**ของทั้งสองชุด (หลัง `bundle_file_names` และหลัง `notes` ตามลำดับ) — ไม่มีคอลัมน์เดิมขยับ (review F25) |
| `AccountantIndexSource` ([apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:25](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts)) | เพิ่ม `whtRemittance`; ผู้เรียก `buildAccountantIndexRow` ที่ [expense-evidence.use-case.ts:165-207](../../apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts) ส่งค่าจากแถว และ query ของหน้านั้นต้อง select ฟิลด์นี้ — มิฉะนั้นทุกแถวเป็น "ไม่ได้ระบุ" (review รอบ 2 F5) |
| `DisbursementPayableExpense` ([packages/contracts/src/disbursement-vouchers.ts:226](../../packages/contracts/src/disbursement-vouchers.ts)) | เพิ่ม `whtRemittance` — ส่งต่อจาก `readDisbursementExpenseSources` (เพิ่มใน `select` ที่ [prisma-expense.repository.ts:1295-1304](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) และ `payableExpenses` ([disbursement-voucher-read.use-case.ts:83-92](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher-read.use-case.ts)) เพื่อให้พรีวิว/plannedMethod รู้ช่องทาง และตัวเลือกวิธีจ่ายของร่างใบตัดเงินสด/บัตรได้ (review รอบ 2 F4 / P21) |
| ผลลัพธ์ `wht.calculate_withholding` | `eWhtRatePercent?`, `eWhtWithheldAmount?` + ประโยค L-5 เมื่อประเภทที่เลือก `REDUCED` และวันนี้ในช่วง |
| ผลลัพธ์ `wht.get_month_summary` | `eWht: { paymentCount, withheldByCurrency: { currency, amount }[] } \| null` — คำนวณเฉพาะผู้มี `wht.pnd53.read`; ผู้มีแค่ `wht.certificate.read` อาจถูกจำกัดให้เห็นเฉพาะรายจ่ายของตน/ที่เกี่ยวข้อง ([wht-handoff-read-scope.ts:10-18](../../apps/api/src/modules/tax/application/services/wht-handoff-read-scope.ts)) จึงได้ `null` (review รอบ 2 F1) + ประโยค L-11; ประโยคเดิมเปลี่ยนเป็น L-12/L-12en และท้ายข้อความ L-13/L-13en ที่บอกว่าเป็นรายการใบ 50 ทวิ ไม่ใช่การจ่าย (บั๊ก B7); ฟิลด์ผลลัพธ์เปลี่ยนชื่อให้ตรงความหมาย: `paymentCount` → `certificateItemCount`, `totalPaid` → `totalIncome`, `totalWithheld` → `totalDocumentWithholding`, `byIncomeType[]` ใช้ `itemCount`/`totalIncome`/`totalDocumentWithholding` + `countBasis: 'certificate_worklist_including_unpaid'` (ค้นแล้วไม่มีผู้อ่านฟิลด์เดิมนอกไฟล์เครื่องมือใน `apps/ai-gateway`, `apps/api/src/modules/line-ai`, `packages/contracts`); คำอธิบายใน registry ([packages/contracts/src/ai-tools.ts:1351](../../packages/contracts/src/ai-tools.ts)) เปลี่ยนเป็น "Read the 50 bis certificate worklist (issued, recorded outside, and still required — confirmed unpaid expenses included) with income bases and document withholding by income type for periodKey YYYY-MM (current month by default). With wht.pnd53.read also read the PND53 period remittance, its system deadline and e-WHT bank-remitted totals by currency. No other tax forms or mutations." — สิทธิ์และ featureKeys เดิม (review รอบ 3 F6/P33); **ยอดซ้อน (review รอบ 4 F5 / บั๊ก B13)**: รายจ่ายที่มี handoff ระดับเอกสาร `REQUIRED` และมี handoff ของบางการจ่ายที่ออก/บันทึกแล้ว ([wht-certificate-handoff.use-case.ts:268-275](../../apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts) ซ่อนแถว REQUIRED เฉพาะเมื่อทุกการจ่ายมีใบแล้ว) — แถว REQUIRED นับเป็นยอดคงเหลือ = ยอดเอกสาร − ยอดของใบที่ออก/บันทึกแล้ว (ไม่ติดลบ; ถ้าเหลือ 0 ไม่นับรายการ) แทนการบวกเต็ม ([erp-advisor-document-tools.use-case.ts:84-90](../../apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts)) |

### 7.2 Endpoint ใหม่หนึ่งตัว (review F9)

`GET /companies/:companyId/tax/withholding/months/:periodKey/e-wht-export?establishmentCode=`
- guard เดียวกับ `GET tax/withholding/months/:periodKey` ([tax.controller.ts:92-93](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts) — `wht.pnd53.read` + entitlement เดิม) + `branchScopeWhere`
- อ่าน event `EXCLUDED` (`WHT_PND2|3|53`) ของเดือนผ่าน `currentWithholdingPayments` (ตัดรายจ่ายที่ไม่ใช่ CONFIRMED และการจ่ายที่ไม่ใช่ RECORDED — [withholding-filing-state.ts:28-39](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts)) และ `partitionWithholdingPayments` เมื่อระบุสาขา
- คืนไฟล์ XLSX ชีตเดียว W-X3 (คอลัมน์เดียวกับชีตแบบ ยกเว้นเลข 50 ทวิ และเพิ่มคอลัมน์ "สกุลเงิน"; แถวรวมแยกต่อสกุลเงิน — review รอบ 2 F2) สร้างสดทุกครั้งด้วย `buildWorkbook` — **ไม่ผ่าน** validation ของแบบ, ไม่จองเลขเอกสาร, ไม่สร้าง `TaxFilingPackage`, ไม่เก็บไฟล์ ⇒ ใช้ได้ทั้งเดือนที่มีแต่ e-WHT (แบบถูกบล็อกที่ [generate-tax-filing-package.use-case.ts:119-120](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts)) และเดือนที่ยื่นแล้ว (ไฟล์แบบถูก replay จากที่เก็บ :60-71)
- audit `tax.withholding.e_wht_export` (riskLevel HIGH แบบเดียวกับ export ภาษีเดิม :163-173)
- **ไฟล์ Excel ของแบบไม่เปลี่ยน** (ไม่เพิ่มชีต) — artifact และ checksum ของแบบไม่ขึ้นกับ e-WHT

### 7.3 จุดบังคับ "e-WHT ห้ามเงินสด/บัตร" (review F1, F21)

ฟังก์ชันเดียว `assertEWhtPaymentMethod(expense, method)` → 409 เมื่อ `whtRemittance=E_WHT` และ `!eWhtPaymentMethodAllowed(method)`; เรียกที่:

| จุด | ไฟล์ | รหัส/ข้อความ |
|---|---|---|
| บันทึกจ่าย (ธุรกรรม) — ครอบใบเตรียมจ่ายด้วย | `recordPaymentInTransaction` ([prisma-expense.repository.ts:670](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)); ใบเตรียมจ่ายเรียกที่ [disbursement-voucher.use-case.ts:764](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts) | `expense_ewht_payment_method` / W-R1 |
| พรีวิวบันทึกจ่าย (LINE) | `RecordExpensePaymentUseCase.previewLineAction` ([expense-draft.use-case.ts:1988-1997](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) | เดียวกัน |
| พรีวิวจ่ายใบเตรียมจ่าย (LINE) — วิธีจ่ายจริง `payment.paymentMethod ?? voucher.plannedMethod` | ลูป source [disbursement-voucher.use-case.ts:149-153](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts) | เดียวกัน |
| วิธีจ่ายที่วางแผนของใบเตรียมจ่าย (สร้าง/แก้/ส่ง) | validation `plannedMethod` (:57, :111, :184) เมื่อมีรายการ `E_WHT` | `disbursement_ewht_planned_method` / W-R1 |
| ใบรับรองแทนใบเสร็จ (บันทึก/รับรอง/ออกใบ) — เมื่อใบจะสร้างรายการจ่าย | `assertSubstitutePaymentDetails` ใน [`substitute-funding.logic.ts:19`](../../apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts) (import ที่ substitute-receipt.use-case.ts:36 — review รอบ 2 F10; เรียกที่ [substitute-receipt.use-case.ts:382](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts), :806 และใน `issueSubstituteEvidence` ของ repository ก่อนสร้างรายการจ่ายที่ :3085) | `substitute_receipt_ewht_payment_method` / W-R3 |
| ตั้ง/ยืนยันช่องทาง e-WHT ขณะมีรายการจ่าย `RECORDED` ที่เป็น CASH/CARD | `UpdateExpenseDraftUseCase` เมื่อค่าที่จะบันทึกเป็น `E_WHT`, และสองจุดยืนยัน `confirmExpenseCas` (:3489, ข้าง :3507) และ `finalizeAndConfirmExpenseCas` (:3542, ข้าง :3632) | `expense_ewht_cash_payment_exists` / W-R2 |

### 7.4 Sync และ repository (review F2, F5–F8)

ลูป expense WHT ของ `SyncTaxEventsUseCase.execute`:

```
row.whtRemittance === 'E_WHT':
  ล็อก: ข้ามเฉพาะเมื่อมีแถวแบบ FILED ครอบการจ่ายนี้จริง (filedLineCoversPayment บน WhtFilingLine);
        ล็อกเดือนแบบเก่า (FILED/PAID/CLOSED ที่ไม่มีแถวแบบ — filed-withholding-payment.ts:20-24) และ assertPeriodUnlocked ของ PND2 ไม่บล็อก EXCLUDED
  formType = ตามประเภทผู้รับเงิน+ประเภทเงินได้ (กติกาเดิม) — ไม่รู้ประเภทผู้รับเงิน → ข้ามแถว ไม่สร้าง issue
  resolve ของ source นี้ เฉพาะ issue ในงวดภาษีหัก ณ ที่จ่าย (formType ∈ PND2/PND3/PND53):
        WHT_PAYEE_KIND_UNKNOWN, MISSING_TAX_ID, FUNCTIONAL_CURRENCY_FX_MISSING, WHT_RATE_MISMATCH
  hash เดิม + { remittance: 'E_WHT' }
  upsertEvent({ ...เดิม, status: 'EXCLUDED', sourceEventType: 'expense.wht.e_wht' })
row.whtRemittance ∈ { null, 'PAYER_FILES' }:
  ทุกอย่างเดิม และเก็บผล mismatch ต่อ (sourceId, taxPeriodId): จริงถ้ามีแถวใดของรายจ่ายนั้นในงวดนั้น
        eWhtRateKind=REDUCED && whtRate==1 && eWhtReducedRateOn(code, eventDate)
หลังจบลูป: ต่อ (sourceId, taxPeriodId) ที่เก็บไว้ → createIssue(WHT_RATE_MISMATCH, WARNING) หรือ resolve — ครั้งเดียว (ไม่กลับไปกลับมาระหว่างแถว — F6)
```

- **ตรวจข้อมูลต้นทางรวมต่อ (รายจ่าย, งวด) (review รอบ 2 F3 / บั๊ก B6)**: `MISSING_TAX_ID` และ `FUNCTIONAL_CURRENCY_FX_MISSING` ของแถว `SYSTEM_FILLS` ตัดสินหลังจบลูป — สร้างถ้ามีแถวใดของรายจ่ายนั้นในงวดนั้นต้องการ, resolve เฉพาะเมื่อไม่มีแถวใดต้องการ — แทนการ resolve ทันทีต่อแถวที่ :72 และ :307-308 ซึ่งทำให้ผลขึ้นกับลำดับบรรทัด
- **เส้นทางแบบต่อบรรทัด (review รอบ 3 F2 / บั๊ก B9)**: `withholdingForm` (:75) เรียก `supersedeUnclassifiedWithholding(..., keepEventType)` ทั้งรายจ่าย ([prisma-tax.repository.ts:386-393](../../apps/api/src/modules/tax/infrastructure/repositories/prisma-tax.repository.ts)) ⇒ บรรทัดที่ไป PND3 กับบรรทัดที่ไป PND2 ลบ event ของกันและกันทุกรอบ — เปลี่ยนให้รับ `sourceLineKey` และ supersede เฉพาะ event ของบรรทัด/การจ่ายเดียวกัน (กรณีไม่รู้ประเภทผู้รับเงินที่ :66 ยังทั้งรายจ่าย เพราะประเภทเป็นของทั้งรายจ่าย)
- **ตัวบล็อกจากต้นทางต้องไม่หายจากแบบ (review รอบ 3 F1/P28 / บั๊ก B8, B11)**: (ก) ทางผู้ทำบัญชีจัดทำ — `validateWithholdingFiling` คืนเฉพาะ fault สาขา/ผู้จ่าย ([withholding-filing-validation.ts:68-70](../../apps/api/src/modules/tax/application/services/withholding-filing-validation.ts)) ทิ้ง issue ต้นทาง ⇒ เก็บ issue ต้นทางที่เป็น BLOCKING ไว้ด้วย ให้ :119-120 ของ `generate-tax-filing-package.use-case.ts` บล็อก; (ข) ต้นทางที่ไม่มี event ในงวดนั้นเลย (เช่น `MISSING_TAX_ID` ของแถวระบบกรอก) ถูกตัดออกจาก `paperIssues` ([generate-tax-filing-package.use-case.ts:88](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts)) และ `periodIssues` ของหน้าเดือน ([generate-wht-report.use-case.ts:159](../../apps/api/src/modules/tax/application/use-cases/generate-wht-report.use-case.ts)) เมื่อเดือนนั้นมีกระดาษ/สาขาอยู่แล้ว ⇒ issue BLOCKING ของต้นทางที่ไม่มี event ในงวด บล็อกทุกกระดาษของแบบนั้นในเดือนนั้นจนแก้ (ทางออก: แก้ข้อมูลต้นทางตามข้อความ issue เดิม ซึ่งชี้ไปที่รายจ่ายหรือคู่ค้า)
- **รอบ 4 ปรับเรื่องตัวบล็อก (review รอบ 4 F2, F3, F4, F8 / บั๊ก B12)**: (ก) ทางผู้ทำบัญชีจัดทำเก็บ issue ต้นทางทั้ง BLOCKING **และ WARNING** (มิฉะนั้น W-T4 หายจากเดือนที่มีประเภท "อื่นๆ" — F8); (ข) issue ของต้นทางที่ไม่มี event ผูกกับกระดาษตาม**สาขาของรายจ่าย** (`ExpenseRecord.branchId` → establishment ด้วยกติกาเดียวกับ event — `resolveWhtEstablishment`/`partitionWithholdingPayments`) ไม่ใช่ทุกกระดาษ; ถ้าสาขาของต้นทางอยู่นอกขอบเขตของผู้เรียก ตัวบล็อกแสดงแบบไม่มีชื่อผู้รับเงิน/รหัสรายจ่าย/รหัสคู่ค้า (W-T5) และทางแก้คือผู้ดูแลสาขานั้น; ถ้ายังไม่ได้ตอบโหมดผู้จ่ายใช้ `WHT_PAYER_MODE_REQUIRED` เดิม (F2); (ค) `validateWithholdingFiling` ไม่ตัด `WHT_PAYEE_KIND_UNKNOWN` ทิ้งอีกต่อไป ([withholding-filing-validation.ts:14](../../apps/api/src/modules/tax/application/services/withholding-filing-validation.ts)) — issue นี้บล็อกกระดาษทั้ง ภ.ง.ด.3 และ ภ.ง.ด.53 ของสาขาเดียวกันในเดือนนั้น เพราะยังไม่รู้ว่าอยู่แบบไหน และการ์ดเดือน ([WithholdingPage.tsx:85](../../apps/web/src/features/tax/WithholdingPage.tsx)) นับเป็นตัวบล็อกด้วย (F3 / B12); **ตัวบล็อกชุดเดียวกันใช้ที่การบันทึกว่ายื่นแล้วด้วย** (focused review 2026-10-24): `markFiled` ([tax.controller.ts:333-336](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts)) ตัด `WHT_PAYEE_KIND_UNKNOWN` และนับเฉพาะ issue ของต้นทางที่มี event ในกระดาษ ⇒ กระดาษที่ดาวน์โหลดก่อนการแก้ (สถานะ EXPORTED) ยังบันทึกว่ายื่นได้ และหลัง FILED การดาวน์โหลดจะ replay ไฟล์เดิมโดยไม่ตรวจ ([generate-tax-filing-package.use-case.ts:57-71](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts)) — แก้โดยแยกฟังก์ชันเดียว `withholdingPaperBlockers(db, ctx, period, establishment, events)` (issue ต้นทาง BLOCKING ในขอบเขต + ต้นทางที่ไม่มี event ผูกตามสาขา + `WHT_PAYEE_KIND_UNKNOWN` ของสาขาเดียวกันสำหรับทั้งสองแบบ + ซ่อนรายละเอียดนอกขอบเขต) ใช้ทั้ง `validateWithholdingFiling`, `getMonth` และ `markFiled`; replay ของกระดาษ FILED คงเดิม (เป็นสิ่งที่ยื่นไปแล้ว ห้ามเปลี่ยน) แต่ `getMonth` แสดง W-T6 บนกระดาษ FILED ที่มีตัวบล็อกผูกอยู่ และเมื่อแก้ข้อมูลต้นทางแล้ว การจ่ายนั้นได้ event ใหม่ที่ไม่อยู่ในกระดาษที่ยื่น ⇒ ถ้ายังอยู่แบบเดียวกัน ระบบเสนอกระดาษ "เพิ่มเติมครั้งที่ n" ตามกลไกเดิม; ถ้าย้ายไปอีกแบบที่เดือนนั้นยังไม่ได้ยื่น (ไม่รู้ประเภท → บุคคลธรรมดา ⇒ ภ.ง.ด.3 — [sync-tax-events-wht-form.use-case.spec.ts:91](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts)) แบบนั้นเปิดเป็นแบบปกติ และถ้าพ้นกำหนดจะถูก fault `overdue` เดิมบล็อก — ผู้ทำบัญชียื่นช้ากับกรมสรรพากรเอง (W-T6b; BL3 re-check 2026-10-24) (`withholdingPaperPayments`/`openWithholdingSequence` — [withholding-filing-state.ts:67-76](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts)); (ง) หลังลูป resolve issue `MISSING_TAX_ID`, `FUNCTIONAL_CURRENCY_FX_MISSING`, `WHT_PAYEE_KIND_UNKNOWN`, `WHT_RATE_MISMATCH` ในงวด WHT ของ `expense.record` ที่ (รายจ่าย, งวด) ไม่อยู่ในชุดที่ต้องการของรอบนี้ — ตัวอ่านอ่านรายจ่าย CONFIRMED ที่หักภาษีและการจ่ายทั้งหมดทุกรอบ ([expense-source.adapter.ts:70-80](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) จึงเป็นชุดเต็ม ครอบการยกเลิกรายจ่าย ยกเลิกการจ่าย เอาการหักออก และต้นทางที่ไม่เคยมี event; ทาง void และ `retireExpenseTaxEvents` resolve ทันทีด้วย — ตัวบล็อกเก่าจึงไม่บล็อกกระดาษที่ไม่เกี่ยว (F4)
- **ขอบเขต resolve (F2)**: `resolveSourceIssues` รับตัวกรอง `taxPeriod.formType in [PND2, PND3, PND53]`; จุดเดิมที่ [sync-tax-events.use-case.ts:72](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts) ใช้ตัวกรองนี้ด้วย (แก้บั๊ก B5)
- `prisma-tax.repository.ts`:
  - `findActiveEventBySourceComponent` (:200-205) → `status in [ACTIVE, EXCLUDED]`
  - `upsertEvent` (:214-284): guard ของการจ่าย (:226-233) — สำหรับ `status: 'EXCLUDED'` ตรวจแค่ว่าการจ่ายยัง `RECORDED`+`paidAtConfirmed` และไม่มีแถวแบบ FILED ครอบ (ไม่ใช้ล็อกเดือนแบบเก่า); การพลิกงวด FILED → EXPORTED ทำเฉพาะ `ACTIVE` (:278-283) ⇒ ไม่เปลี่ยนประวัติการยื่น (F7)
  - `retireObsoleteExpenseWithholding` (:367-380) → supersede ทั้ง `ACTIVE` และ `EXCLUDED`; `EXCLUDED` ไม่ต้องตรวจล็อกการยื่น (ไม่เคยอยู่ในแบบ); เมื่อ supersede ให้ resolve `WHT_RATE_MISMATCH` ของ source+งวดนั้น (F5)
- `expense-void-blocker.ts` `retireExpenseTaxEvents` (:212-216) → supersede `ACTIVE|EXCLUDED` + resolve `WHT_RATE_MISMATCH` ของ source ในงวด WHT (F5)
- **เปิดแก้รายจ่าย e-WHT (review รอบ 2 F7)**: ตัวตรวจเปิดแก้ใช้ `filedWithholdingPaymentPeriods` ([expense-void-blocker.ts:206](../../apps/api/src/modules/expenses/infrastructure/expense-void-blocker.ts)) ซึ่งรวมล็อกเดือนแบบเก่าตามเดือนที่จ่าย และนับงวดของทุก event ของรายจ่าย (:196-208) ⇒ เมื่อรายจ่ายเป็น `E_WHT`: ใช้เฉพาะแถวแบบ FILED ที่ครอบจริง และไม่นับงวดของ event `EXCLUDED`; คงล็อกงวดบัญชีและงวด ภ.พ.30/อื่นเดิม — `tax_period_filed` (:137) จึงเกิดเฉพาะเมื่อมีแถวที่ยื่นจริง
- **ยกเลิกรายจ่ายที่ยืนยันแล้ว (F8)**: ทาง void ข้าม `retireExpenseTaxEvents` เมื่อ `voidedFromConfirmed` ([prisma-expense.repository.ts:3476](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts)) — เพิ่มในธุรกรรมเดียวกัน: supersede event `EXCLUDED` ของรายจ่ายนี้ทันที (ไม่มีประวัติการยื่นให้ป้องกัน) + resolve `WHT_RATE_MISMATCH`; event `ACTIVE` ให้ sync จัดการตามเดิม; การ์ด/ไฟล์ e-WHT อ่านผ่าน `currentWithholdingPayments` จึงไม่แสดงรายจ่ายที่ยกเลิกแม้ก่อน sync

### 7.5 อื่น ๆ

- ยืนยันรายจ่าย: `E_WHT` → ไม่เรียก `createWhtHandoffForExpense` (:3522, :3704)
- ข้อความแจ้งเตือนตอนเปิดแก้รายจ่ายที่มีหนังสือรับรอง ([expense-draft.use-case.ts:2049](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) เปลี่ยนท้ายประโยคจาก "เมื่อเอกสารถูกยืนยันอีกครั้ง ให้ออกหนังสือรับรองใบใหม่" เป็น N-1 — จริงทั้งกรณียืนยันใหม่เป็นร้านยื่นเอง (handoff กลับมา) และเป็น e-WHT (ไม่มี) (review F17)
- `validateWithholdingFiling` (:51): fault `bank_remitted_only` (W-T3) แทน `empty` **เฉพาะเมื่อ** ไม่มี event `ACTIVE` ของแบบในขอบเขตกระดาษ (สาขา) **และ** มี `EXCLUDED` ของแบบ+สาขาเดียวกัน **และ** ไม่มี issue ต้นทาง BLOCKING ที่เปิดอยู่ในขอบเขตนั้น (รวม issue ของต้นทางที่ไม่มี event — §7.4) — มิฉะนั้นพฤติกรรมเดิม เพราะการจ่ายปกติที่ขาดเลขผู้เสียภาษีก็ไม่มี event `ACTIVE` เช่นกัน ([sync-tax-events.use-case.ts:300-305](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts); review รอบ 3 F4)

## 8. สิทธิ์ ABAC และขอบเขต tenant

- **ไม่มีสิทธิ์ใหม่ ไม่มี feature key ใหม่ ไม่มีสวิตช์**
- ตั้งช่องทาง: สิทธิ์เดียวกับช่องหัก ณ ที่จ่ายอื่นใน `UpdateExpenseDraftUseCase` ([expense-draft.use-case.ts:420-448](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts)) + `assertBranchInScope` (:422)
- บันทึกจ่าย `expense.payment.record`; ใบเตรียมจ่าย `expense.disbursement.*`; ใบรับรองแทนใบเสร็จตามสิทธิ์เดิม
- การ์ดและไฟล์ e-WHT หน้า ภาษีหัก ณ ที่จ่าย: `wht.pnd53.read` + entitlement `wht_pnd53` + `branchScopeWhere` ([generate-wht-report.use-case.ts:47-48](../../apps/api/src/modules/tax/application/use-cases/generate-wht-report.use-case.ts)); export ใหม่ใช้ guard ชุดเดียวกัน
- สรุปรายเดือน LINE (L-11): **เฉพาะผู้มี `wht.pnd53.read`** (สิทธิ์เดียวกับยอด ภงด.53 ในเครื่องมือเดียวกัน :68, :93) + ขอบเขตสาขาเดิม (:70-71) + `branchScopeWhere` บน event; ผู้มีแค่ `wht.certificate.read` ไม่ได้บรรทัดนี้ เพราะการอ่านของเขาอาจถูกจำกัดที่รายจ่ายของตน/ที่เกี่ยวข้อง ([wht-handoff-read-scope.ts:10-18](../../apps/api/src/modules/tax/application/services/wht-handoff-read-scope.ts)) (review รอบ 2 F1)
- ทุก query มี `companyId`
- AI Gateway: ไม่มี tool ใหม่; เครื่องคิดเลขอยู่ใน API ตรวจสิทธิ์ `expense.create`/`procurement.supplier_payment.read` เดิม ([erp-advisor-document-tools.use-case.ts:128](../../apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts)) และ feature `wht_50bis`/`wht_pnd53` เดิมใน registry; ไม่มีการเรียกโมเดลเพิ่ม
- แพ็ก: ช่องทาง e-WHT, การไม่มี 50 ทวิ, คอลัมน์ไฟล์ส่งออก, การ์ด `wht.e-wht` = ทุกแพ็ก (249/499/999/1,999 — `starter` มี `expenses`, [menu-entitlements.ts:495-501](../../packages/contracts/src/menu-entitlements.ts)); การ์ด/ไฟล์ e-WHT ของหน้า ภาษีหัก ณ ที่จ่าย, เครื่องคิดเลข, สรุปรายเดือน = แพ็ก 1,999

## 9. State transitions

`ExpenseRecord.whtRemittance`

| สถานะรายจ่าย | ตั้ง/เปลี่ยนได้ไหม |
|---|---|
| DRAFT / NEEDS_REVIEW / READY_FOR_CONFIRMATION | ได้ — `whtAmount` 0 ⇒ `null`; ตั้ง `E_WHT` ไม่ได้ถ้ามีรายการจ่าย `RECORDED` CASH/CARD (W-R2) |
| CONFIRMED | ไม่ได้ — เปิดแก้แล้วยืนยันใหม่ (ยืนยันใหม่ตรวจ W-R2 และ `expense_paid_exceeds_payable` เดิม) |
| VOIDED | ไม่ได้ |

ยืนยัน: `PAYER_FILES`/`null` → handoff `REQUIRED` (เดิม); `E_WHT` → ไม่สร้าง (handoff ที่ `CANCELLED` จากการเปิดแก้คง `CANCELLED`)

`TaxEvent` ต่อการจ่าย (`sourceLineKey = payment:<id>`)

```
(ไม่มี) ──sync, PAYER_FILES──▶ ACTIVE ──hash เปลี่ยน/เปิดแก้/ยกเลิกจ่าย/sync หลังยกเลิกรายจ่าย──▶ SUPERSEDED
(ไม่มี) ──sync, E_WHT──────▶ EXCLUDED ──hash เปลี่ยน/เปิดแก้/ยกเลิกจ่าย(ที่ sync)/ยกเลิกรายจ่าย(ทันที)──▶ SUPERSEDED
ACTIVE ในแบบ FILED: แตะไม่ได้ (เดิม)  ·  EXCLUDED: ไม่เคยอยู่ในแบบ ไม่เปลี่ยนสถานะงวด
```

`TaxReviewIssue` `WHT_RATE_MISMATCH`: OPEN ↔ RESOLVED ต่อ (รายจ่าย, งวด) ตามผลรวมของแถว; RESOLVED เมื่อเปลี่ยนเป็น e-WHT, เอาการหักออก, เปิดแก้, ยกเลิก หรืออัตราไม่ใช่ 1

## 10. UI

### 10.1 ประโยคใหม่ทั้งหมด (อยู่ใน `E_WHT_WORDS` ที่เดียว)

| id | ที่ | ข้อความ |
|---|---|---|
| W-F1 | ป้ายช่องในฟอร์มตรวจ | นำส่งภาษีอย่างไร |
| W-F2 | ตัวเลือก (ค่าตั้งต้นเมื่อ "หัก") | ร้านยื่นแบบเอง |
| W-F3 | ตัวเลือก | ธนาคารนำส่ง (e-WHT) |
| W-F4 | คำใบ้เมื่อเลือก W-F3 | ธนาคารนำส่งภาษีให้ ไม่ต้องยื่นแบบและไม่ต้องออก 50 ทวิสำหรับรายการนี้ |
| W-F5 | คำใบ้อัตรา: e-WHT + ค่าบริการ + ในช่วง | อัตรา e-WHT 1% · ค่าบริการโรงแรม ภัตตาคาร และเบี้ยประกันชีวิตไม่อยู่ในประเภทนี้ |
| W-F6 | คำใบ้อัตรา: e-WHT + เช่า/วิชาชีพ/โฆษณา/รางวัล + ในช่วง | อัตรา e-WHT 1% |
| W-F7 | คำใบ้อัตรา: e-WHT + `NOT_REDUCED` | ประเภทนี้ไม่ลดอัตราเมื่อจ่ายผ่าน e-WHT |
| W-F8 | คำใบ้อัตรา: e-WHT + อื่นๆ (แทน `whtFilingRouteHint` — F14) | ประเภท “อื่นๆ” ให้ผู้ทำบัญชีบอกอัตรา e-WHT |
| W-F9 | คำใบ้อัตรา: e-WHT + `REDUCED` + นอกช่วง | วันที่เอกสารอยู่นอกช่วงอัตรา e-WHT 1% (1 ม.ค. 2566–31 ธ.ค. 2570) |
| W-F10 | คำใบ้: ร้านยื่นเอง + `REDUCED` + อัตรา 1 + ในช่วง | ถ้าจ่ายผ่าน e-WHT ให้เลือก “ธนาคารนำส่ง (e-WHT)” แทน |
| W-F11 | คำใบ้ประเภทผู้รับเงิน เมื่อ e-WHT (แทน "บริษัทยื่น ภ.ง.ด.53 · บุคคลยื่น ภ.ง.ด.3") | ใช้เลือกประเภทเงินได้ที่ตรงกัน |
| W-D1 | หน้ารายจ่ายที่ยืนยันแล้ว **และมีการจ่าย `RECORDED`** (แทนการ์ด 50 ทวิ) | จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่งภาษี ไม่ต้องออก 50 ทวิ ผู้รับเงินตรวจหลักฐานได้ที่เว็บกรมสรรพากร |
| W-D1u | หน้ารายจ่ายที่ยืนยันแล้ว **ยังไม่มีการจ่าย** (review รอบ 3 F9) | ตั้งให้จ่ายผ่าน e-WHT เมื่อจ่ายแล้ว ธนาคารจะนำส่งภาษี ไม่ต้องออก 50 ทวิ |
| W-P1 | ฟอร์มจ่าย/การ์ดจ่ายใบเตรียมจ่าย ที่มีรายการ e-WHT | จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร |
| W-P2 | ฟอร์มจ่าย/การ์ดจ่ายใบเตรียมจ่าย/ยืนยันวันที่จ่าย/ช่องวันจ่ายของใบรับรองแทนใบเสร็จที่ใช้เงินของบริษัท (`SubstituteReceiptWizardPage.tsx:2063` — การออกใบสร้างรายการจ่ายด้วยวันนี้ [prisma-expense.repository.ts:3093](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts); review รอบ 3 F8): วันจ่ายนอกช่วง + อัตรา 1 + `REDUCED` | วันที่จ่ายอยู่นอกช่วงอัตรา e-WHT 1% ตรวจอัตราหักก่อนบันทึก |
| W-PD1 | `PaymentDateConfirmation` คำนำ เมื่อรายจ่าย e-WHT (แทน "…ก่อนนำไปยื่นภาษี" ที่ [PaymentDateConfirmation.tsx:18](../../apps/web/src/features/expenses/PaymentDateConfirmation.tsx)) | ยังไม่ทราบวันที่จ่ายเงินจริง ระบุวันที่จากหลักฐาน |
| W-PD2 | `PaymentDateConfirmation` บันทึกวันที่สำเร็จ รายจ่าย e-WHT (แทน "รายการนี้อยู่ในแบบเดือน …" ที่ :26) | บันทึกวันที่จ่ายแล้ว รายการนี้จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่ง |
| W-C1 | กล่องยืนยันเปิดแก้/ยกเลิกรายจ่าย/ยกเลิกรายการจ่าย ของรายจ่าย e-WHT ที่มีการจ่าย | การแก้ในระบบไม่เปลี่ยนภาษีที่ธนาคารนำส่ง ถ้ายอดหักเปลี่ยน ให้ผู้ทำบัญชีจัดการกับธนาคารหรือกรมสรรพากร |
| W-V1 | ใบสำคัญจ่าย (ใบ `PAID`) ต่อรายการ e-WHT | จ่ายผ่าน e-WHT ธนาคารเป็นผู้นำส่งภาษี ไม่ต้องออก 50 ทวิ |
| W-V1u | ใบเตรียมจ่ายที่ยังไม่จ่าย (DRAFT/PENDING_APPROVAL/APPROVED) ต่อรายการ e-WHT (review รอบ 3 F9) | จะจ่ายผ่าน e-WHT ธนาคารจะนำส่งภาษี ไม่ต้องออก 50 ทวิ |
| W-T1 | หน้า ภาษีหัก ณ ที่จ่าย หัวการ์ด | จ่ายผ่าน e-WHT |
| W-T2 | ใต้หัวการ์ด | ธนาคารเป็นผู้นำส่ง จึงไม่อยู่ในแบบ ภ.ง.ด.3/53 |
| W-T2b | ปุ่มในการ์ด | ดาวน์โหลดรายการ e-WHT |
| W-T3 | การ์ดแบบ (ต่อแบบและต่อสาขาที่เลือก) ตามเงื่อนไข §7.5 | รายการที่จ่ายแล้วของ {ภ.ง.ด.3 / ภ.ง.ด.53}{ของสาขา X} ในระบบเดือนนี้จ่ายผ่าน e-WHT ทั้งหมด จึงไม่มีแถวในแบบนี้ |
| W-T4 | การ์ด "ควรตรวจก่อนยื่น" + ป้าย "ตรวจอัตรา" | {ผู้รับเงิน}: หัก 1% ถ้าจ่ายผ่าน e-WHT ให้เปิดแก้รายจ่ายแล้วเลือก “ธนาคารนำส่ง (e-WHT)” ถ้าไม่ใช่ ตรวจว่าอัตรานี้ถูกต้อง |
| W-T5 | การ์ด "ต้องแก้ก่อนยื่น" — ตัวบล็อกของต้นทางที่สาขาอยู่นอกขอบเขตผู้ดู (review รอบ 4 F2) | มีรายการของสาขาที่คุณไม่ได้ดูแลที่ต้องแก้ก่อนยื่นแบบนี้ ให้ผู้ดูแลสาขานั้นแก้ข้อมูล |
| W-T6 | กระดาษที่บันทึกว่ายื่นแล้ว (FILED) ที่มีตัวบล็อกผูกอยู่ (focused review 2026-10-24; BL3 re-check) | {ผู้รับเงิน หรือ "รายการของสาขาที่คุณไม่ได้ดูแล"}: ไม่อยู่ในแบบที่ยื่นแล้ว แก้ข้อมูลก่อน แล้วระบบจะบอกว่าต้องยื่นแบบเพิ่มเติมหรือยื่นอีกแบบหนึ่ง |
| W-T6a | หลังแก้ข้อมูล รายการยังอยู่แบบเดียวกับกระดาษที่ยื่นแล้ว | (ไม่มีข้อความใหม่ — กลไกเดิมเสนอ "แบบเพิ่มเติมครั้งที่ n" ของแบบนั้น) |
| W-T6b | หลังแก้ข้อมูล รายการย้ายไปอีกแบบที่เดือนนั้นยังไม่ได้ยื่น (เช่น ไม่รู้ประเภท → บุคคลธรรมดา ⇒ ภ.ง.ด.3) | ไม่มีข้อความใหม่: แบบนั้นเปิดเป็น**แบบปกติ (ไม่ใช่แบบเพิ่มเติม)** ตาม [withholding-filing-state.ts:67-72](../../apps/api/src/modules/tax/application/services/withholding-filing-state.ts); ถ้าพ้นกำหนดแล้ว ใช้ข้อความเดิม "พ้นกำหนดยื่นแล้ว ให้ผู้ทำบัญชีตรวจเงินเพิ่มและยื่นแบบกับกรมสรรพากร" ([withholding-filing-validation.ts:56](../../apps/api/src/modules/tax/application/services/withholding-filing-validation.ts), [tax-period.logic.ts:145](../../apps/api/src/modules/tax/domain/logic/tax-period.logic.ts)) — ยื่นช้า อาจมีเงินเพิ่ม/เบี้ยปรับ ผู้ทำบัญชีจัดการ |
| L-14 | LINE คำอธิบายเมื่อถาม "e-WHT คืออะไร" (ทาง `documentExplanationReply` ไม่ใช่การ์ด) — ใช้ข้อความเดียวกับ L-7 จาก `E_WHT_WORDS` (review รอบ 4 F6) | (= L-7) |
| W-X1 | หัวคอลัมน์ไฟล์ส่งออก | วิธีนำส่งภาษีหัก ณ ที่จ่าย |
| W-X2 | ค่าในคอลัมน์ | ร้านยื่นแบบเอง · ธนาคารนำส่ง (e-WHT) · ไม่ได้ระบุ · (ว่าง) |
| W-X3 | ชื่อชีต/ไฟล์ e-WHT | จ่ายผ่าน e-WHT |
| W-R1 | 409 `expense_ewht_payment_method` / `disbursement_ewht_planned_method` | รายการนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร เลือกวิธีจ่ายอื่น หรือเปิดแก้รายการเพื่อเปลี่ยนวิธีนำส่ง |
| W-R2 | 409 `expense_ewht_cash_payment_exists` | รายการนี้มีการจ่ายด้วยเงินสดหรือบัตรอยู่ จึงเลือก e-WHT ไม่ได้ ให้คงเป็น “ร้านยื่นแบบเอง” |
| W-R3 | 409 `substitute_receipt_ewht_payment_method` | รายจ่ายนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคาร เลือกวิธีจ่ายอื่นในใบรับรอง |
| N-1 | ท้ายข้อความแจ้งเตือนเปิดแก้ (แทนของเดิมที่ :2049) | ถ้าเอกสารถูกยืนยันอีกครั้งและยังต้องมีหนังสือรับรอง ระบบจะขึ้นให้ออกใบใหม่ |
| L-1 | LINE ปฏิเสธเงินสด/บัตร + ปุ่ม [โอนเงิน] [เปิดรายการ] | รายการนี้จ่ายผ่าน e-WHT ต้องจ่ายผ่านธนาคารค่ะ กด “โอนเงิน” หรือเปิดรายการเพื่อเปลี่ยนวิธีนำส่งค่ะ |
| L-2 | LINE การ์ดพรีวิวบันทึกจ่าย/จ่ายใบเตรียมจ่าย (ก่อนจ่าย — review รอบ 3 F9) | รายการนี้จะจ่ายผ่าน e-WHT ธนาคารจะนำส่งภาษีหลังจ่ายค่ะ |
| L-3 | LINE ขั้นหลักฐาน รายจ่าย e-WHT (แทน [line-expense-action.service.ts:500-501](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)) | ตรวจหลักฐานเพื่อยืนยันรายจ่ายก่อนสร้างใบเตรียมจ่ายค่ะ |
| L-4 | LINE การ์ดใบเตรียมจ่าย ทุกบรรทัดที่มีหักภาษี ([line-voucher-action.service.ts:127](../../apps/api/src/modules/line-ai/application/line-voucher-action.service.ts), :166 — ตัวเลขคือยอดหักของทั้งเอกสาร [disbursement-voucher.use-case.ts:279](../../apps/api/src/modules/expenses/application/use-cases/disbursement-voucher.use-case.ts); review รอบ 3 F7 / บั๊ก B10) | … · หักภาษีทั้งเอกสาร {wht} บาท (ต่อท้าย " (e-WHT)" เมื่อรายการเป็น e-WHT) |
| L-5 | LINE เครื่องคิดเลข (ประเภทที่เลือก `REDUCED`, วันนี้ในช่วง) | ถ้าจ่ายผ่าน e-WHT ของธนาคารภายใน 31 ธ.ค. 2570 จะหัก 1% คือ {x} บาท ยกเว้นบางกรณีค่ะ |
| L-9 | LINE การ์ดจ่าย: วันจ่ายนอกช่วง + อัตรา 1 + `REDUCED` | วันที่จ่ายอยู่นอกช่วงอัตรา e-WHT 1% ตรวจอัตราหักก่อนยืนยันค่ะ |
| L-10 | LINE ถามซ้ำเมื่อคำตอบวิธีจ่ายอ่านไม่ออก (รายการ e-WHT เท่านั้น) + ปุ่ม [โอนเงิน] [เช็ค] | จ่ายผ่านธนาคารแบบไหนคะ |
| L-11 | LINE สรุปรายเดือน (บรรทัดใหม่ — เฉพาะผู้มี `wht.pnd53.read`) | จ่ายผ่าน e-WHT {k} รายการ หักไว้ {ยอดต่อสกุลเงิน เช่น "100.00 บาท" หรือ "100.00 บาท และ 10.00 USD"} ธนาคารเป็นผู้นำส่ง ไม่รวมในยอดข้างบนค่ะ |
| L-12 | LINE สรุปรายเดือน (แก้ประโยคเดิมที่ :108 — บั๊ก B7) | ใบ 50 ทวิ: ออกหรือบันทึกแล้ว {n} ใบ จากรายการที่ต้องมีใบ {m} รายการ (นับรายการที่ยังไม่จ่ายด้วย) ยอดเงินได้ {a} บาท ยอดหักตามเอกสาร {b} บาทค่ะ |
| L-12en | สรุปรายเดือนภาษาอังกฤษ (แทน :102) | 50 bis worklist: {n} issued or recorded of {m} items that need one (unpaid items included); income {a} THB, withholding per documents {b} THB. |
| L-13 | ท้ายสรุปรายเดือน (แทน "ยอดหักของการจ่ายกับยอดในงวด…" ที่ :114) | ยอดหักตามรายการใบ 50 ทวิกับยอดในงวด ภงด.53 อาจต่างกันถ้ายังไม่ได้ดึงรายการล่าสุด และยอดของงวดยังไม่ใช่ยอดค้างชำระค่ะ |
| L-13en | ท้ายสรุปรายเดือนภาษาอังกฤษ (แทน :107) | Worklist withholding and period totals may differ before the latest sync; a period total is not an unpaid balance. |
| L-7 | การ์ดคำตอบใหม่ `wht.e-wht` (ต้องอนุมัติ — Q4) | จ่ายผ่านบริการ e-WHT ของธนาคาร ธนาคารจะนำส่งภาษีให้ ร้านไม่ต้องยื่น ภ.ง.ด.3/53 และไม่ต้องออก 50 ทวิสำหรับการจ่ายนั้นค่ะ 😊 ค่าบริการ ค่าเช่า ค่าวิชาชีพ ค่าโฆษณา และรางวัล ที่จ่ายถึง 31 ธ.ค. 2570 หัก 1% (มีข้อยกเว้นบางกรณี) ในรายจ่ายให้เลือก “ธนาคารนำส่ง (e-WHT)” ผู้รับเงินตรวจหลักฐานได้ที่เว็บกรมสรรพากรค่ะ |
| L-8 | แก้การ์ด `wht.calculation` v6 (ต้องอนุมัติ) | ใช้ยอดก่อน VAT คูณอัตราตามประเภทเงินได้ค่ะ 😊 เลือก “จ่ายค่าอะไร” ให้ตรงกับรายการก่อน ถ้าจ่ายผ่าน e-WHT ให้เลือก “ธนาคารนำส่ง (e-WHT)” ด้วย ถ้าประเภทนั้นลดอัตราได้ วันที่เอกสารอยู่ในช่วงที่กฎหมายลดอัตรา และกรอกเป็นเปอร์เซ็นต์ ระบบเติมอัตราที่ลดแล้วให้ค่ะ |
| H-1 | คู่มือภาษี หัวข้อใหม่ในแท็บ WHT | **จ่ายผ่าน e-WHT** — ถ้าจ่ายผ่านบริการ e-WHT ของธนาคาร ธนาคารนำส่งภาษีให้ ไม่ต้องยื่นแบบและไม่ต้องออก 50 ทวิสำหรับการจ่ายนั้น ในรายจ่ายเลือก “ธนาคารนำส่ง (e-WHT)” ถ้าประเภทลดอัตราได้ วันที่เอกสารอยู่ในช่วงที่กฎหมายลด (ถึง 31 ธ.ค. 2570) และกรอกเป็นเปอร์เซ็นต์ ระบบเติม 1% ให้ รายการนี้จะไม่อยู่ในแบบ ภ.ง.ด.3/53 |
| H-2 | แก้สรุปแท็บ WHT ที่ผิดอยู่ (บั๊ก B3) | มั่งมีเปิดใช้ประเภทเงินได้ให้แล้ว ประเภทที่ยังรอตรวจจะเลือกไม่ได้ |

ประโยคเดิมที่**ไม่แสดง**สำหรับรายการ e-WHT: dictionary :153 และ :154, LINE :501 ("…และออกหนังสือรับรอง 50 ทวิค่ะ"), `MISSING_TAX_ID`, คำใบ้ประเภทผู้รับเงินเดิม (dictionary :341 → W-F11), และ **`whtFilingRouteHint`** ([packages/contracts/src/tax.ts:961-966](../../packages/contracts/src/tax.ts), แสดงที่ [ExpensesPages.tsx:2566](../../apps/web/src/features/expenses/ExpensesPages.tsx)) — ถ้าไม่ซ่อน ประเภทอื่นๆ จะบอกพร้อมกันว่า "ไม่ต้องยื่นแบบ" และ "ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง"

### 10.2 ตาราง surface × case

ฟอร์มตรวจ (เว็บ)

| ช่องทาง | ประเภท | วันที่ | โหมด/อัตรา | แสดง | จริงไหม |
|---|---|---|---|---|---|
| ร้านยื่นเอง | ใดก็ได้ | ใดก็ได้ | RATE ≠1 หรือ AMOUNT | คำใบ้เดิม (รวม `whtFilingRouteHint`) | จริง (ไม่เปลี่ยน) |
| ร้านยื่นเอง | `REDUCED` | ในช่วง | RATE =1 | W-F10 | จริง: ประโยคเงื่อนไข ไม่อ้างว่า 1% คือ e-WHT (ค่าเช่าเรือระหว่างประเทศ 1% ปกติก็ไม่ขัด) |
| ร้านยื่นเอง | ขนส่ง / นอกช่วง | — | RATE =1 | คำใบ้เดิม | จริง |
| e-WHT | ค่าบริการ | ในช่วง | RATE | W-F4 + W-F5 (อัตราเติม 1 เมื่อเลือกประเภท/ช่องทาง) | จริง: W-F5 ตาม ท.ป.4/2528 ข้อ 12/1 |
| e-WHT | เช่า/วิชาชีพ/โฆษณา/รางวัล | ในช่วง | RATE | W-F4 + W-F6 | จริง: บอกอัตราที่เติม อัตราแก้ได้ |
| e-WHT | `REDUCED` | ในช่วง | AMOUNT | W-F4 (ไม่เติม ไม่พูดเรื่องอัตรา) | จริง |
| e-WHT | ขนส่ง/ดอกเบี้ย/ปันผล | ใดก็ได้ | ใดก็ได้ | W-F4 + W-F7 (ซ่อน `whtFilingRouteHint`) | จริง |
| e-WHT | อื่นๆ | ใดก็ได้ | ใดก็ได้ | W-F4 + W-F8 (ซ่อน `whtFilingRouteHint`) | จริง — ไม่มีประโยค "ผู้ทำบัญชีต้องจัดทำแบบ" ขัดกัน |
| e-WHT | `REDUCED` | นอกช่วง | ใดก็ได้ | W-F4 + W-F9 | จริง |
| e-WHT | ยังไม่เลือก | — | — | W-F4 | จริง |
| e-WHT | ใดก็ได้ | — | — | ประเภทผู้รับเงิน: W-F11 | จริง (ไม่อ้างแบบที่ร้านยื่น) |

หน้ารายจ่าย/ใบเตรียมจ่าย/การจ่าย/ใบรับรองแทนใบเสร็จ

| ข้อความ | กรณี | จริงไหม |
|---|---|---|
| W-D1 / W-D1u | e-WHT + `whtAmount>0`: มีการจ่าย `RECORDED` ⇒ W-D1; ยังไม่มี ⇒ W-D1u | จริง: ไม่อ้างว่าจ่ายแล้วหรือมีหลักฐานบนเว็บกรมก่อนมีการจ่าย (review รอบ 3 F9); ไม่แสดงกับ `null`/`PAYER_FILES` |
| W-V1 / W-V1u | รายการ e-WHT ในใบ: ใบ `PAID` ⇒ W-V1; ยังไม่จ่าย ⇒ W-V1u | จริง |
| L-2 | การ์ดพรีวิวก่อนจ่ายของรายการ e-WHT | จริง (บอกสิ่งที่จะเกิด) |
| L-4 | ทุกบรรทัดที่ `whtAmount>0` ในการ์ดใบเตรียมจ่าย | จริง: ระบุว่าเป็นยอดทั้งเอกสาร ไม่ใช่ส่วนของการจ่ายครั้งนี้ (B10) |
| W-P1 | ฟอร์ม/การ์ดจ่ายที่มีรายการ e-WHT ≥1 | จริงทุกกรณี |
| W-P2, L-9 | e-WHT + `REDUCED` + อัตรา 1 + วันจ่ายนอกช่วง (บันทึกจ่ายเว็บ, จ่ายใบเตรียมจ่ายเว็บ, ยืนยันวันที่จ่าย, ใบรับรองแทนใบเสร็จเงินบริษัท, RECORD_PAYMENT, VOUCHER_PAY — ใบเตรียมจ่ายใช้ `eWhtReducedRateApplied` ของบรรทัด) | จริง; ไม่แสดงเมื่อในช่วงหรืออัตราไม่ใช่ 1 |
| W-C1 | e-WHT + มีรายการจ่าย `RECORDED` | จริง (พูดว่าระบบไม่เปลี่ยน) |
| W-R1 / L-1 | e-WHT + CASH/CARD ทุกทางใน §7.3 ยกเว้นใบรับรองแทนใบเสร็จ | จริง; ทางออกมีจริง (เลือกวิธีอื่นได้เสมอ; เปิดแก้ได้ถ้าไม่มีตัวบล็อก ถ้ามีจะได้ข้อความบล็อกเดิม) |
| W-R2 | บันทึก/ยืนยัน e-WHT ขณะมีรายการจ่าย CASH/CARD | จริง; ทางออก "คงเป็นร้านยื่นแบบเอง" ทำได้เสมอ |
| W-R3 | ใบรับรองแทนใบเสร็จของรายจ่าย e-WHT วิธีจ่าย CASH/CARD | จริง; เปลี่ยนวิธีจ่ายในใบได้เสมอ |
| L-3 | ขั้นหลักฐาน `whtAmount>0` + e-WHT | จริง; ร้านยื่นเอง/`null` ใช้ข้อความเดิม |
| N-1 | เปิดแก้รายจ่ายที่มีหนังสือรับรอง (ทุกช่องทาง) | จริงทั้งยืนยันใหม่เป็นร้านยื่นเอง (ขึ้นให้ออก), เป็น e-WHT (ไม่ต้องมี — ไม่ขึ้น) และไม่ยืนยันใหม่ |
| W-PD1, W-PD2 (+ W-P2) | ยืนยันวันที่จ่ายของรายจ่าย e-WHT ที่การจ่ายยังไม่รู้วันที่ (แสดงที่ `ExpenseReviewPage.tsx:1850`) | จริง (ไม่อ้างการยื่นแบบ); ข้อความเดิม "…อยู่ในแบบเดือน…" แสดงเฉพาะร้านยื่นเอง/`null` (review รอบ 2 F9) |

หน้า ภาษีหัก ณ ที่จ่าย (แพ็ก 1,999)

| ข้อความ | กรณี | จริงไหม |
|---|---|---|
| W-T1/W-T2/W-T2b | มี event `EXCLUDED` ของเดือนในสาขาที่เห็นได้ และรายจ่าย/การจ่ายยังปัจจุบัน | จริง |
| W-T3 | เงื่อนไข §7.5: ไม่มี `ACTIVE` + มี `EXCLUDED` ของแบบและสาขาเดียวกัน + ไม่มี issue ต้นทาง BLOCKING ในขอบเขต (รวมต้นทางที่ไม่มี event) | จริง — "ที่จ่ายแล้ว" และเงื่อนไข issue ตัดกรณีการจ่ายปกติที่ขาดเลขผู้เสียภาษี/ไม่รู้ประเภท (review รอบ 3 F4); ระบุแบบและสาขา (F16) |
| ข้อความเดิม "เดือนนี้ไม่มีรายการหักภาษี…" ([tax-period.logic.ts:143](../../apps/api/src/modules/tax/domain/logic/tax-period.logic.ts)) | ไม่มีทั้ง `ACTIVE` และ `EXCLUDED` ในขอบเขต | จริง (เดิม) |
| W-T4 | `WHT_RATE_MISMATCH` OPEN | จริง: ระบุแค่ข้อเท็จจริง "หัก 1%" แล้วเป็นเงื่อนไขสองทาง; ไม่สร้างกับแถวที่อยู่ในแบบ FILED (ถูกข้ามก่อน — [sync-tax-events.use-case.ts:282](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) |
| หัว "ควรตรวจก่อนยื่น" | มี issue WARNING ≥1 | จริง (ไม่บล็อก) |

ไฟล์ส่งออก W-X2: `whtAmount=0` → ว่าง; `>0`+`PAYER_FILES` → ร้านยื่นแบบเอง; `>0`+`E_WHT` → ธนาคารนำส่ง (e-WHT); `>0`+`null` → ไม่ได้ระบุ

LINE: L-5 เฉพาะเมื่อผู้ใช้เลือกประเภทในแค็ตตาล็อกแล้ว (ชื่อเต็ม เช่น "ค่าโฆษณา (นิติบุคคล)" — จับคู่ชื่อเต็มที่ [erp-advisor-document-tools.use-case.ts:131-133](../../apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts)) และวันนี้ ≤ 31 ธ.ค. 2570; L-11 จริงเพราะนับจาก event `EXCLUDED` ตามวันจ่ายจริง แยกสกุลเงิน และแสดงเฉพาะผู้อ่านงวดภาษีได้ทั้งสาขา; L-12 จริงเพราะบอกว่าเป็นรายการใบ 50 ทวิที่นับรายการยังไม่จ่ายด้วย และใช้ "ยอดหักตามเอกสาร" แทน "หักไว้"; L-7/L-8 จริงทุกแพ็ก (ไม่อ้างเมนูที่แพ็กไม่มี)

### 10.3 เว็บที่ 390 px

- ฟอร์มตรวจ: `ThemedSelect` W-F1..F3 เต็มความกว้าง ใน `fieldset[data-testid=expense-withholding]` ต่อจาก "จ่ายค่าอะไร" ก่อน "หน่วยหัก ณ ที่จ่าย" (`ExpensesPages.tsx:2547-2575`), คำใบ้หนึ่งบรรทัดแบบเดิม, ช่องแตะได้ ≥ 44 px
- หน้ารายจ่ายที่ยืนยันแล้ว: W-D1 เป็น `Notice tone="info"` แทน `ExpenseCertificateCard` (`ExpenseReviewPage.tsx:1310-1405`)
- ฟอร์มจ่าย: วิธีจ่ายของรายการ e-WHT = โอนเงิน · เช็ค · อื่นๆ (ตั้งต้นโอนเงิน `ExpenseReviewPage.tsx:246`) + W-P1/W-P2 ใต้ช่อง; ปุ่มบันทึกแถบล่างเดิม
- ใบรับรองแทนใบเสร็จ: ตัวเลือกวิธีจ่ายของรายจ่าย e-WHT ไม่มีเงินสด/บัตร (`SubstituteReceiptWizardPage.tsx:268`, :532)
- ใบเตรียมจ่าย: W-V1 ในแถวข้อความของรายการ ไม่มีปุ่ม; วิธีจ่ายที่วางแผน/การ์ดจ่ายตัดเงินสด/บัตรเมื่อมีรายการ e-WHT
- หน้า ภาษีหัก ณ ที่จ่าย: การ์ด "จ่ายผ่าน e-WHT" ต่อจากการ์ด ภ.ง.ด.2 (`WithholdingPage.tsx:209`) แถวแบบ `rowClass` + ปุ่ม W-T2b; การ์ด "ควรตรวจก่อนยื่น" แยกจาก "ต้องแก้ก่อนยื่น" (`WithholdingPage.tsx:230`)

### 10.4 เว็บที่ 1,280 px และ ~1,556 px

- ไม่เปลี่ยนโครงหน้า: เต็มความกว้าง, ปุ่มฟอร์มอยู่แถบล่าง, fieldset หัก ณ ที่จ่ายคอลัมน์เดียวในกริดเดิม
- หน้า ภาษีหัก ณ ที่จ่าย: การ์ด e-WHT เต็มแถวแบบการ์ด ภ.ง.ด.2; การ์ดแบบสองคอลัมน์ (`lg:grid-cols-2`, :208) คงเดิม; ปุ่ม W-T2b ขนาดเท่าปุ่มในกลุ่มเดียวกัน (วัด)

### 10.5 LINE

- ใช้ปุ่มเท่านั้น ไม่มีรายการตัวเลข; น้องมั่งมีพูด "ค่ะ"
- ไม่ถามวิธีจ่ายสำหรับรายการ/ใบเตรียมจ่ายที่มี e-WHT: ตั้งต้น "โอนเงิน" ในการ์ดพรีวิว; ผู้ใช้ยืนยันด้วยการ์ดที่ลงชื่อแบบเดิม
- **สถานะลองใหม่ที่ผูกกับรายการ (review F22)**: เมื่อพรีวิว RECORD_PAYMENT/VOUCHER_PAY ได้ `expense_ewht_payment_method` (ผู้ใช้พิมพ์ว่าเงินสด/บัตร) ให้บันทึก `StoredAction` ของ chat เดิม: `awaitingField: 'paymentMethod'`, `revision`/`digest` ของรายการ ณ ตอนนั้น (ตรวจแบบเดียวกับ [line-expense-action.service.ts:981-984](../../apps/api/src/modules/line-ai/application/line-expense-action.service.ts)), `preview.payment` เดิม (ยอด/วันที่) และ `allowedPaymentMethods: ['BANK_TRANSFER','CHEQUE','OTHER']` แล้วตอบ L-1 พร้อมปุ่ม [โอนเงิน] (ส่งข้อความ "โอนเงิน") และ [เปิดรายการ] (uri หน้ารายจ่าย/ใบเตรียมจ่ายเมื่อ `webBaseUrl` เป็น https); คำตอบ "โอนเงิน" ถูกอ่านที่ตัวแยกวิธีจ่ายเดิม (:991) แล้วเรียกพรีวิวใหม่**พร้อมยอดและวันที่เดิม** (ขยาย :995-997 ให้ส่ง `entry.preview.payment` สำหรับ RECORD_PAYMENT); รายการเปลี่ยนระหว่างนั้น → ข้อความ "รายการเปลี่ยน" เดิม; ตอบเงินสดซ้ำ → L-1 ซ้ำโดยไม่สร้างสถานะใหม่; ตอบอ่านไม่ออก → L-10 พร้อมปุ่ม [โอนเงิน] [เช็ค] (แทน `question()` เดิมที่เสนอเงินสด/บัตร :333-338); "ยกเลิก" → ทิ้งสถานะ (เดิม :985)

## 11. Impact analysis

| พื้นที่ | ผลกระทบ | ไฟล์ |
|---|---|---|
| Prisma/migration | enum + คอลัมน์ nullable | `apps/api/prisma/schema.prisma`, migration ใหม่ |
| Contracts | `WHT_REMITTANCES`, กติกา, `eWhtPaymentMethodAllowed`, `E_WHT_WORDS`, ฟิลด์รายจ่าย, voucher state, `bankRemitted`, คอลัมน์ export (ท้ายสุด), parity | `packages/contracts/src/{tax,expenses,disbursement-vouchers}.ts`, `prisma-enum-parity.spec.ts` |
| Expenses API — persistence | create data, update whitelist, input types, `mapExpense`, model (F3) | `prisma-expense.repository.ts:244`, :1885-1889, create path; `domain/models/expense.model.ts` |
| Expenses API — กติกา | normalize, ไม่สร้าง handoff, จุดบังคับ §7.3, ข้อความแจ้งเตือน N-1 | `expense-draft.use-case.ts` (:393-, :1988-1997, :2049), `prisma-expense.repository.ts` (:670, :3476, :3489-3525, :3542-3712, :2957-3098), `expense-status.logic.ts`, `substitute-funding.logic.ts` |
| ใบเตรียมจ่าย | state `E_WHT`; plannedMethod/พรีวิว/จ่าย ห้ามเงินสด/บัตร; W-P2; PDF ไม่เปลี่ยน | `disbursement-voucher.use-case.ts` (:57, :111, :149-153, :184), `prisma-expense.repository.ts:1295-1304` (`readDisbursementExpenseSources` select), `disbursement-voucher-read.use-case.ts:83-92` (`payableExpenses`), `prisma-disbursement-voucher.repository.ts:35-39` (`detailInclude`) และ :120-134, `disbursement-voucher.use-case.ts:276-285` (mapper — รอบ 3 F5), `DisbursementVoucherWithholding.tsx`, `disbursement-voucher-payment.logic.ts:42-46`, `DisbursementVoucherPayCard.tsx`, ฟอร์มร่างใบ |
| ใบรับรองแทนใบเสร็จ | ห้ามเงินสด/บัตรสำหรับ e-WHT | `substitute-funding.logic.ts:19`, `substitute-receipt.use-case.ts:382`, :806, `SubstituteReceiptWizardPage.tsx` |
| Tax sync | EXCLUDED, hash, สกุลเงินของรายการ, ตรวจต้นทางรวมต่อรายจ่าย+งวด (B6), supersede แบบอื่นต่อบรรทัด (B9), resolve เฉพาะงวด WHT, WARNING รวมต่อรายจ่าย+งวด, แก้ :72 | `sync-tax-events.use-case.ts`, `expense-source.adapter.ts:70-135`, `domain/ports/source-reader.port.ts`, `tax-period.logic.ts` |
| Tax repository | lookup/retire EXCLUDED, guard ของ EXCLUDED, resolve ตามงวด | `prisma-tax.repository.ts` (:200-205, :226-233, :367-380, :395-400); `expense-void-blocker.ts:212-216` |
| แบบ/ไฟล์ผู้ทำบัญชี | เนื้อไฟล์แบบไม่เปลี่ยน; fault `bank_remitted_only` ต่อแบบ+สาขาตามเงื่อนไข §7.5; เก็บ issue ต้นทาง BLOCKING และ WARNING ในทางผู้ทำบัญชีจัดทำ (B8, รอบ 4 F8) และของต้นทางที่ไม่มี event ผูกตามสาขาของรายจ่าย ซ่อนรายละเอียดนอกขอบเขต (B11, รอบ 4 F2); ไม่ตัด `WHT_PAYEE_KIND_UNKNOWN` (B12, รอบ 4 F3); resolve ตัวบล็อกของต้นทางที่ไม่ส่งผลแล้ว (รอบ 4 F4) | `withholding-filing-validation.ts:14`, :51, :68-70; `generate-tax-filing-package.use-case.ts:76`, :88, :119-120; `generate-wht-report.use-case.ts:159`; `WithholdingPage.tsx:85`; `prisma-tax.repository.ts:367-380`; `tax-period.logic.ts` |
| Export e-WHT ใหม่ | endpoint §7.2 | `tax.controller.ts`, `generate-wht-report.use-case.ts` (หรือ service ใหม่ข้างกัน), `common/export/xlsx.logic` เดิม |
| หน้า ภาษีหัก ณ ที่จ่าย | `bankRemitted` (มีสกุลเงิน); สาขาที่มีแต่ e-WHT ต้องปรากฏ (รวม establishment จาก event `EXCLUDED` เข้ากับ :143); fault `bank_remitted_only` ต้องไม่ถูกตัดทิ้งที่ตัวกรองฟอร์มว่าง :171 (review รอบ 2 F6); การ์ด, ปุ่มดาวน์โหลด, WARNING card | `generate-wht-report.use-case.ts:47-48`, :240; `WithholdingPage.tsx`; `tax.api.ts`; `tax.logic.ts:36` |
| 50 ทวิ (ทุกแพ็ก) | ไม่มี handoff ⇒ ไม่ขึ้นค้าง/ไม่เสนอใน LINE/ใบเตรียมจ่ายไม่บอกว่ายังไม่ออก; หน้าภาษีเลือกได้แค่ event `ACTIVE` ([create-wht-certificate.use-case.ts:83-84](../../apps/api/src/modules/tax/application/use-cases/create-wht-certificate.use-case.ts)) | — |
| แจ้งเตือน | เปลี่ยนท้ายข้อความ `expense.wht_certificate_cancelled` ตอนเปิดแก้ (N-1); ไม่มีแจ้งเตือนใหม่ (แจ้งเฉพาะผู้ออกใบเดิม) | `expense-draft.use-case.ts:2049` |
| เว็บรายจ่าย | ช่องใหม่ คำใบ้ autofill (RATE เท่านั้น) ซ่อน `whtFilingRouteHint` เมื่อ e-WHT การ์ดแทน 50 ทวิ ฟอร์มจ่าย กล่องยืนยัน; ตัด `whtRemittance` จาก preview payload (F4) | `ExpensesPages.tsx:2521-2600`, `useExpenseReviewTotals.ts:28-29`, `expense-review-validation.ts`, `ExpenseReviewPage.tsx` (:1850), `PaymentDateConfirmation.tsx` (:18, :26 — F9), `workspace-dictionary.ts` |
| LINE | L-1..L-4, L-9, L-10, สถานะลองใหม่ §10.5, ค่าตั้งต้นวิธีจ่าย | `line-expense-action.service.ts` (:156, :333-338, :500-501, :533-541, :566, :981-997, :1050), `line-voucher-action.service.ts` (:127, :160-167 — ป้าย "หักภาษีทั้งเอกสาร" B10) |
| AI tool / ผู้ช่วย | เครื่องคิดเลข L-5; สรุปรายเดือน L-11 (เฉพาะ `wht.pnd53.read`, แยกสกุลเงิน)/L-12, L-12en, L-13, L-13en + ชื่อฟิลด์ใหม่ + `countBasis` (บั๊ก B7) + `eWht`; แนวทางผู้ช่วย | `erp-advisor-document-tools.use-case.ts` (:66-121 รวมยอดซ้อน B13, :124-151), `advisor-domain-guidance.ts`, `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts` (:355-365, :429-441 — ทาง e-WHT ก่อนทางหัก ณ ที่จ่ายทั่วไป, L-14 — รอบ 4 F6) |
| การ์ดคำตอบ/คู่มือ | การ์ดใหม่ `wht.e-wht` อ้างคู่มือภาษีตรง ๆ (sourceURL `/companies/{companyId}/user-guide/tax#wht`, sourceFile `apps/web/src/features/user-guide/tax-guide.content.ts`, sourceHash ใหม่ — ไม่ใช้ helper `card()` ของ `product-help-draft-cards.ts:3-12` ที่ตรึงไว้กับ getting-started — F24); แก้ `wht.calculation` v6; คู่มือ H-1/H-2 ⇒ `sources.tax.hash` ใหม่ ([approved-product-help.ts:8](../../apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts)); v4 ไม่เพิ่มการ์ด (ล็อก 12 ใบ — `approved-knowledge.spec.ts:64`) | `product-help-draft-cards.ts`, `approved-product-help.ts`, `tax-guide.content.ts`; เทสต์ `agent-tools.registry.spec.ts:351-362` (v6 จาก 68 เป็น 69 การ์ด, reviewers เพิ่มบันทึกอนุมัติ — review รอบ 2 F11) |
| W00 manifest | `approved-product-help.ts`/`product-help-draft-cards.ts` อยู่ใน source references (`line-ai-capability-manifest.ts:157-158`) ⇒ regenerate แล้วรีวิว diff | `line-ai-capability-manifest.spec.ts` (whole-chain `reliability-api-v2`) |
| Whole-chain | ไม่เพิ่ม suite; รัน `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push | — |
| Capability/registry | เปลี่ยนเฉพาะคำอธิบาย `wht.get_month_summary` ([ai-tools.ts:1351](../../packages/contracts/src/ai-tools.ts) — รอบ 3 F6); สิทธิ์ featureKeys และการผูกเครื่องมือเดิม (เครื่องคิดเลข/สรุปยังแพ็ก 1,999 — F19); ไฟล์นี้อยู่ใน W00 ⇒ regenerate | `packages/contracts/src/ai-tools.ts` |
| Billing/entitlement | ไม่มี key ใหม่; ไม่มี gate | — |
| Export รายจ่าย (ทุกแพ็ก) | `wht_remittance` ท้ายสุดทั้งสองชุด (backlog ข้อ 25 ต้องคงคอลัมน์นี้) | `expense-export.logic.ts` (:25 `AccountantIndexSource`, :152, :188), `expense-evidence.use-case.ts` (:165-207 mapping + select; สารบัญ ZIP ชุดเต็ม — F5) |
| Browser journeys | ใหม่ `e2e/journeys/e-wht-payment.journey.spec.ts`; ขยาย `withholding-forms.journey.spec.ts` | — |
| Seed | proof stack: e-WHT 1 + ร้านยื่นเอง 1 เดือนเดียวกัน | `apps/api/prisma/seed-expenses.ts` |
| Supplier payment / claims / ledger | ไม่เปลี่ยน (§3) | — |

## 12. Gaps

- G1 ฐานกฎหมายเรื่องไม่ต้องยื่นแบบ/ไม่ต้องออก 50 ทวิ อ่านได้จากข่าวและเอกสารแนบของกรมสรรพากร แต่ยังไม่พบตัวประกาศอธิบดีฯ ตามมาตรา 3 ปัณรส
- G2 ไม่ตรวจว่าธนาคารนำส่งจริง — เชื่อผู้ตรวจ; ใบเสร็จอิเล็กทรอนิกส์ของกรมแนบเป็นหลักฐานการจ่ายเดิมได้
- G3 ช่วงอัตรา 1% อยู่ในโค้ด — ขยายต้องแก้ `E_WHT_REDUCED_RATE.windows` (ขยายมาแล้ว 389 → 402)
- G4 ไม่มีค่าตั้งต้นระดับร้าน/จำตามผู้รับเงิน (Q3)
- G5 ใบสำคัญจ่าย PDF ไม่มีหมายเหตุ e-WHT
- G6 เครื่องคิดเลขและสรุปรายเดือนใน LINE มีเฉพาะแพ็ก 1,999 (registry เดิม) — แพ็กอื่นได้การ์ดความรู้ L-7 เท่านั้น; ถ้าจะเปิดเครื่องมือให้แพ็กอื่นเป็นเรื่องแพ็กเกจแยก
- G7 ใบจ่ายเจ้าหนี้ (procurement) ไม่มีช่องทาง e-WHT — ไม่ได้ขาย
- G8 ข้อยกเว้นในกฎกระทรวง (มูลนิธิ/สมาคมบางแห่ง, เรือระหว่างประเทศ) และการจัดประเภทผิด (เช่น ค่าบริการโรงแรมใส่ในค่าบริการ) ระบบแยกไม่ได้ — อาศัยคำใบ้และการแก้อัตรา
- G9 `packages/contracts/src/tax.spec.ts` และ `expenses-wording.spec.ts` ไม่อยู่ใน runner ใด (ค้นแล้ว) — เทสต์กติกาใหม่จึงวางในไฟล์ API ที่รันอยู่
- G10 คำถามวิธีจ่ายใน LINE เดิมเป็นข้อความให้พิมพ์ (:156, :1050) — นอกขอบเขต ยกเว้นกรณี e-WHT ที่ใช้ปุ่ม (§10.5)
- G11 แพ็กคำตอบ v6 หยุดใช้ 27 ธ.ค. 2569 (backlog ข้อ 5) — การ์ด `wht.e-wht` หยุดพร้อมกัน
- G13 ยอด e-WHT สกุลเงินอื่นไม่แปลงเป็นบาท (ไม่มีอัตราแลกเปลี่ยนที่ตรวจแล้ว) — แสดงแยกสกุลเงิน
- G12 ข้อ 12/7 ของ ท.ป.4/2528 (หักเมื่อสัญญาเดียว ≥ 1,000 บาท) ระบบยังไม่ตรวจ — เรื่องเดิมของการหักภาษี ไม่ใช่ของ e-WHT

## 13. Bugs found in current code

| # | ที่ | สถานการณ์ที่ผิด | ความรุนแรง |
|---|---|---|---|
| B1 | `sync-tax-events.use-case.ts:276-330` + `generate-tax-filing-package.use-case.ts:48-49,117-127` + `withholding-accountant-export.ts:31-45` + `withholding-filing-validation.ts:107` | การจ่ายที่ธนาคารนำส่งผ่าน e-WHT แล้วถูกเขียนเป็น event `ACTIVE` และพิมพ์ใน ภ.ง.ด.3/53 + Excel โดยไม่มีอะไรเตือน (§1) ⇒ ยื่นและชำระซ้ำ | สูง |
| B2 | `prisma-expense.repository.ts:3522-3525`, :3704-3712; `prisma-disbursement-voucher.repository.ts:130`; `workspace-dictionary.ts:153-154`; `line-voucher-action.service.ts:75-84`; `line-expense-action.service.ts:500-501` | รายการเดียวกันได้ 50 ทวิค้าง, ข้อความ "ยังไม่ได้ออกหนังสือรับรอง (50 ทวิ)", ปุ่มออก 50 ทวิใน LINE — ไม่จริงสำหรับ e-WHT และชวนออกเอกสารซ้ำ | กลาง |
| B3 | `apps/web/src/features/user-guide/tax-guide.content.ts:109` | สรุปแท็บ WHT บอก "15 หมวด และทุกหมวดเริ่มต้นที่สถานะ DRAFT" แต่ migration `20261004120000` เปิด 12 หมวด และ `20261013120100` ทำให้มี 18 รหัส (ACTIVE 13) | ต่ำ |
| B4 | `tax-period.logic.ts:94,124`; `tax.logic.ts:36` | `WHT_RATE_MISMATCH` ไม่มีผู้สร้าง และคำอธิบาย API เป็นอังกฤษ `WHT rate mismatch` ซึ่ง `withholdingIssueDescription` (:157-169) ส่งต่อตามเดิมถ้าถูกสร้าง | ต่ำ (แก้ใน Phase 2) |
| B5 | `sync-tax-events.use-case.ts:70-73` (ร่วมกับ :233-236) | รายจ่ายสกุลเงินต่างประเทศที่มี VAT และหักภาษีด้วยประเภทเส้นทาง `ACCOUNTANT_PREPARES`/`SEPARATE_PND2`: ลูป VAT สร้าง `FUNCTIONAL_CURRENCY_FX_MISSING` BLOCKING ในงวด ภ.พ.30 (:234) แล้วลูป WHT ในรอบ sync เดียวกัน resolve ทุกงวดของ source นั้นโดยไม่กรองงวด (:72) ⇒ ตัวบล็อก ภ.พ.30 หายเงียบ ภาษีซื้อรายการนั้นหายจากแบบโดยไม่มีเตือน (review F2) | กลาง (ภ.พ.30 อยู่ใน `thai_tax` ที่ยังไม่ขาย; แก้ใน Phase 2.2) |
| B6 | `sync-tax-events.use-case.ts:70-73` ร่วมกับ :300-305 และ :307-308 | รายจ่ายเก่าหลายบรรทัดที่แยกประเภท (`!whtInputJson && lines > 1` — [expense-source.adapter.ts:104-108](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) เช่น บรรทัด 1 `WHT_SERVICE_3` (ระบบกรอกแบบ) + บรรทัด 2 `WHT_OTHER_IND` (ผู้ทำบัญชีจัดทำ) ผู้ขายไม่มีเลขผู้เสียภาษี: บรรทัด 1 สร้าง `MISSING_TAX_ID` และไม่มี event; บรรทัด 2 resolve issue ของรายจ่ายนั้นทันที (:72) ⇒ แบบเดือนนั้นขาดแถวค่าบริการโดยไม่มีตัวบล็อก; ลำดับบรรทัดกลับกัน issue ยังอยู่ — ผลขึ้นกับลำดับ (review รอบ 2 F3) | สูง (เฉพาะรายจ่ายเก่าแบบแยกบรรทัด; แบบที่พิมพ์ขาดแถว) — แก้ใน Phase 2.2 |
| B7 | `erp-advisor-document-tools.use-case.ts:75-115` ร่วมกับ `prisma-expense.repository.ts:4953` | สรุปรายเดือนใน LINE นับ handoff 50 ทวิเป็น "การจ่าย" — handoff ของรายจ่ายสร้างตั้งแต่ยืนยัน (ยังไม่จ่าย) และ prefill `paymentDate` = วันที่เอกสาร ⇒ ใบแจ้งหนี้ที่ยืนยันแต่ยังไม่จ่ายถูกรายงานว่า "จากการจ่าย 1 รายการ … หักไว้ …" (review รอบ 2 F8) | กลาง — แก้ป้ายทั้งไทย/อังกฤษ ท้ายข้อความ ชื่อฟิลด์ และคำอธิบายเครื่องมือ (L-12, L-12en, L-13, L-13en) ใน Phase 4.3 |
| B8 | `withholding-filing-validation.ts:68-70` ร่วมกับ `generate-tax-filing-package.use-case.ts:118-120` | เดือนที่มีรายการประเภท "ผู้ทำบัญชีจัดทำ" อย่างน้อยหนึ่งรายการ: validation คืนเฉพาะ fault สาขา/ผู้จ่าย ทิ้ง issue ต้นทางทั้งหมด (เช่น `MISSING_TAX_ID` ของรายการอื่น) ⇒ ไฟล์ Excel ให้ผู้ทำบัญชีดาวน์โหลดได้ทั้งที่รายการนั้นขาดไป (review รอบ 3 F1/P28) | สูง — แก้ใน Phase 2.3 |
| B9 | `sync-tax-events.use-case.ts:75` ร่วมกับ `prisma-tax.repository.ts:386-393` | รายจ่ายเก่าบุคคลธรรมดาที่แยกบรรทัด เช่น `WHT_SERVICE_3` (ภ.ง.ด.3) + หมวดที่ยื่น ภ.ง.ด.2 แยก: แต่ละบรรทัด supersede event ของแบบอื่นทั้งรายจ่าย ⇒ เหลือแบบของบรรทัดสุดท้ายเท่านั้นและสลับไปมาทุก sync (review รอบ 3 F2) | สูงเมื่อผู้ดูแลระบบเปิดหมวดดอกเบี้ย/เงินปันผลบุคคล (ตอนนี้ DRAFT — migration `20261013120100`) — แก้ใน Phase 2.2 |
| B10 | `line-voucher-action.service.ts:127`, :166 ร่วมกับ `disbursement-voucher.use-case.ts:279` | การ์ดใบเตรียมจ่ายใน LINE แสดง "จ่าย X บาท · หักภาษี Y บาท" โดย Y เป็นยอดหักทั้งเอกสาร ไม่ใช่ส่วนของการจ่ายนี้ — จ่าย 5,300 จากยอดสุทธิ 10,600 ที่หัก 100 แสดง 100 ทั้งที่ส่วนของการจ่ายนี้คือ 50 (review รอบ 3 F7) | กลาง — แก้ป้ายใน Phase 4.1 |
| B11 | `generate-tax-filing-package.use-case.ts:88` ร่วมกับ `generate-wht-report.use-case.ts:159`, :240-241 | issue ต้นทางของรายการที่ไม่มี event ในงวด (เช่น ค่าบริการที่ผู้ขายไม่มีเลขผู้เสียภาษี) ถูกตัดจาก `paperIssues`/`periodIssues` เมื่อเดือนนั้นมีรายการอื่นที่มี event (มีกระดาษ/สาขาแล้ว) ⇒ ดาวน์โหลด PDF/Excel ได้โดยขาดรายการนั้น และการ์ดแบบไม่แสดงตัวบล็อก — พบจากการอ่านโค้ดระหว่างแก้ review รอบ 3 F1/F4 ยังไม่ได้รันยืนยัน | สูง — แก้ใน Phase 2.3 (ผูกตามสาขาและซ่อนรายละเอียดนอกขอบเขต — รอบ 4 F2) |
| B12 | `withholding-filing-validation.ts:14` ร่วมกับ `WithholdingPage.tsx:85` | รายจ่ายเก่าที่จ่ายแล้วแต่ไม่รู้ประเภทผู้รับเงินไม่มี event และได้ `WHT_PAYEE_KIND_UNKNOWN`; ถ้าเดือนนั้นมีรายการ ภ.ง.ด.53 อื่นที่ถูกต้อง validation ตัด issue นี้ทิ้ง ⇒ ดาวน์โหลด PDF/Excel ได้โดยขาดรายการนั้น (review รอบ 4 F3) | สูง — แก้ใน Phase 2.3; ช่องเดียวกันที่การบันทึกว่ายื่นแล้ว `tax.controller.ts:333-336` (focused review); BL3 ปิดโดย focused re-check 2026-10-24 |
| B13 | `wht-certificate-handoff.use-case.ts:268-275` ร่วมกับ `erp-advisor-document-tools.use-case.ts:84-90` | รายจ่ายฐาน 10,000 หัก 100 จ่ายสองงวดครึ่ง ออกใบให้งวดแรกแล้ว: แถว REQUIRED ระดับเอกสารยังอยู่ (เต็ม 10,000/100) คู่กับใบงวดแรก 5,000/50 ⇒ สรุปรายเดือนรายงาน 15,000/150 (review รอบ 4 F5) | กลาง — แก้ใน Phase 4.3 |

## 14. Test plan

ไม่ได้รันเทสต์ในงานเอกสารนี้ (worktree ไม่มี node_modules) — ทุกข้อคือแผน

API — ไฟล์ที่อยู่ใน `apps/api/package.json` แล้วเท่านั้น:
- `src/modules/tax/domain/logic/tax-period.logic.spec.ts` — `eWhtRateKind` ทุกรหัส §5.2; `eWhtReducedRateOn` ขอบ 2022-12-31/2023-01-01/2025-12-31/2026-01-01/2027-12-31/2028-01-01; `eWhtPaymentMethodAllowed`; `WHT_RATE_MISMATCH` เป็นไทย WARNING
- `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` — E_WHT ⇒ `EXCLUDED`, ไม่สร้าง MISSING_TAX_ID/KIND/FX; resolve เฉพาะงวด WHT (issue FX ในงวด PP30 ยัง OPEN — B5 ทั้งทางเดิม :72 และทางใหม่); สลับช่องทาง ⇒ supersede; ร้านยื่นเอง 1% ค่าโฆษณาในช่วง ⇒ WARNING; **รายจ่ายสองบรรทัด (โฆษณา 1% + ขนส่ง 1%) งวดเดียว ⇒ WARNING หนึ่งรายการ OPEN คงที่หลัง sync สองรอบ** (F6); เปลี่ยนเป็น e-WHT ⇒ WARNING RESOLVED (F5); e-WHT ในเดือนล็อกแบบเก่า ⇒ `EXCLUDED` ถูกเขียน งวดไม่เปลี่ยนสถานะ; e-WHT ที่มีแถวแบบ FILED ครอบ ⇒ ข้าม (F7); รายจ่ายเก่าสองบรรทัด SERVICE_3 + OTHER_IND ไม่มีเลขผู้เสียภาษี ทั้งสองลำดับบรรทัด ⇒ `MISSING_TAX_ID` OPEN คงที่หลัง sync สองรอบ (B6); e-WHT สกุล USD + THB ⇒ event คงสกุลเงินเดิม (F2); รายจ่ายเก่าบุคคลสองบรรทัด SERVICE_3 + หมวด PND2 ทั้งสองลำดับ sync สองรอบ ⇒ event `WHT_PND3` และ `WHT_PND2` อยู่ครบ (B9 — รอบ 3 F2); รายจ่ายขาดเลขผู้เสียภาษีแล้วถูกยกเลิก / ยกเลิกการจ่าย / เอาการหักออก ⇒ issue ถูก resolve หลัง sync (รอบ 4 F4)
- `src/modules/tax/infrastructure/repositories/prisma-tax.repository.spec.ts` — lookup เห็น `EXCLUDED`; `upsertEvent(EXCLUDED)` ผ่านในเดือนล็อกแบบเก่าและไม่พลิกงวด; retire supersede `EXCLUDED` + resolve WARNING; `resolveSourceIssues` กรอง formType
- `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` — แบบไม่มีแถว e-WHT; ไฟล์ Excel ของแบบไม่มีชีต e-WHT และ checksum ไม่เปลี่ยนเมื่อเพิ่ม e-WHT; W-T3 ต่อแบบ/สาขา (เดือนที่ PND3 มีแต่ e-WHT แต่ PND53 มีแถวปกติ ⇒ PND53 ไม่ได้ W-T3 — F16); WARNING ไม่บล็อก; `GenerateWhtReportUseCase.getMonth`: สาขาที่มีแต่ e-WHT ปรากฏพร้อม W-T3 และ fault `bank_remitted_only` ไม่ถูกตัดทิ้ง, `bankRemitted` มีสกุลเงิน (review รอบ 2 F6, F2); sync → export จริงของ A22 ทั้งสองลำดับบรรทัด ⇒ PDF และ Excel ทางผู้ทำบัญชีจัดทำ ถูกบล็อกด้วย `MISSING_TAX_ID` (B8, B11 — รอบ 3 F1); รายการปกติขาดเลขผู้เสียภาษีที่ไม่มี event + รายการอื่นมี event ⇒ กระดาษถูกบล็อกและการ์ดแสดงตัวบล็อก (B11); เดือนที่มี e-WHT + รายการปกติขาดเลขผู้เสียภาษี ⇒ ไม่มี W-T3 (รอบ 3 F4); รายจ่ายเก่าไม่รู้ประเภทผู้รับเงิน + รายการ ภ.ง.ด.53 อื่น ⇒ PDF/Excel ทั้ง ภ.ง.ด.3 และ 53 ถูกบล็อก (B12 — รอบ 4 F3); ต้นทางไม่มี event ของสาขา B ไม่บล็อกกระดาษสาขา A แยก, ผู้ดูที่ไม่มีสิทธิ์สาขา B เห็น W-T5 ไม่มีชื่อ/รหัส (รอบ 4 F2); ค่าโฆษณาร้านยื่นเอง 1% + ประเภท "อื่นๆ" เดือนเดียวกัน ⇒ W-T4 ยังแสดง (รอบ 4 F8)
- `src/modules/tax/presentation/http/tax.controller.spec.ts` — `markFiled` (BL3, focused review): กระดาษ EXPORTED → เกิด `WHT_PAYEE_KIND_UNKNOWN` ของสาขาเดียวกัน → บันทึกว่ายื่นถูกปฏิเสธ `PND53_FILING_REVIEW`; ต้นทางไม่มี event ที่ขาดเลขผู้เสียภาษีในสาขาเดียวกัน ⇒ ปฏิเสธเช่นกัน; สาขาอื่น ⇒ ไม่บล็อก (A37); endpoint e-WHT export: สิทธิ์ `wht.pnd53.read`, เดือนที่มีแต่ e-WHT ได้ไฟล์, เดือนที่ยื่นแบบแล้วได้รายการ e-WHT ที่บันทึกหลังยื่น (ไม่ replay), สาขานอกขอบเขตไม่เห็น, ไม่สร้าง `TaxFilingPackage`
- `src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts` — `previewLineAction`/`execute`: E_WHT+CASH/CARD ⇒ 409; อื่นผ่าน; ร้านยื่นเอง+CASH ผ่าน; ข้อความแจ้งเตือนเปิดแก้ใหม่ N-1 (แทน assertion เดิมที่ :259-264)
- `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` — ใบรับรองแทนใบเสร็จของรายจ่าย E_WHT วิธีจ่าย CASH ⇒ 409 W-R3 ทั้งบันทึกและรับรอง
- `src/modules/expenses/domain/logic/expense-export.logic.spec.ts` — W-X2 สี่กรณี; `wht_remittance` เป็นคอลัมน์สุดท้ายทั้งชุดย่อและชุดเต็ม ตำแหน่งเดิมทุกคอลัมน์ไม่ขยับ (F25); ผ่านผู้เรียกจริงใน `expense-evidence.use-case.ts` แถว E_WHT ได้ "ธนาคารนำส่ง (e-WHT)" ไม่ใช่ "ไม่ได้ระบุ" (review รอบ 2 F5)
- `src/modules/expenses/domain/logic/expense-status.logic.spec.ts` — normalize `null` เมื่อ `whtAmount=0`; ค่าผิด ⇒ error
- `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` — เครื่องคิดเลข: "ค่าโฆษณา" ⇒ ปุ่มเลือกประเภท (ไม่คำนวณ — F20); เลือก "ค่าโฆษณา (นิติบุคคล)" ฐาน 10000 ปี 2026 ⇒ 2% = 200.00 + L-5 1% = 100.00; ขนส่ง/วันที่จำลอง 2028 ⇒ ไม่ต่อท้าย; สรุปรายเดือน: เดือนที่มีแต่ e-WHT ⇒ L-12 ด้วยศูนย์ + L-11 ยอดจริง, สาขานอกขอบเขตไม่รวม (F18); ผู้มีแค่ `wht.certificate.read` ขอบเขตรายจ่ายของตน ⇒ ไม่มี L-11 และ `eWht: null` (รอบ 2 F1); e-WHT สองสกุลเงิน ⇒ ยอดแยกสกุลเงิน (รอบ 2 F2); ใบแจ้งหนี้ยืนยันแต่ยังไม่จ่าย ⇒ L-12 นับเป็นรายการใบ ไม่เรียกว่าการจ่าย (B7); ภาษาอังกฤษ L-12en/L-13en และฟิลด์ `certificateItemCount`/`totalIncome`/`totalDocumentWithholding`/`countBasis` (รอบ 3 F6); การ์ดใบเตรียมจ่ายที่จ่ายบางส่วน 5,300 จาก 10,600 หัก 100 ⇒ "หักภาษีทั้งเอกสาร 100 บาท" (B10 — รอบ 3 F7); VOUCHER_PAY ค่าขนส่ง 1% วันจ่าย 2028 ⇒ ไม่มี L-9 แต่ค่าโฆษณา e-WHT 1% ⇒ มี L-9 (รอบ 3 F5); รายจ่ายจ่ายสองงวด ออกใบงวดแรก ⇒ สรุปรายเดือนนับ 10,000/100 ไม่ใช่ 15,000/150 (B13 — รอบ 4 F5); ใบเตรียมจ่าย L-4 และ `canOfferCertificate=false`; พรีวิว VOUCHER_PAY plannedMethod CASH + รายการ e-WHT ⇒ 409 ก่อนการ์ด (F21)
- `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` — `LineExpenseActionService`: L-3; การ์ดบันทึกจ่าย L-2 ตั้งต้นโอนเงินไม่ถาม; พิมพ์ "เงินสด" ⇒ L-1 + สองปุ่ม + `StoredAction` ผูก revision; กด "โอนเงิน" ⇒ พรีวิวใหม่ยอด/วันเดิม; รายการเปลี่ยนก่อนกด ⇒ ข้อความรายการเปลี่ยน; ตอบอ่านไม่ออก ⇒ L-10 (F22); วันจ่าย 2028-01-05 ⇒ L-9 (F11)

PostgreSQL จริง (ข้ามบนเครื่องเมื่อไม่มี `DATABASE_URL` ตามแบบเดิม — `prisma-expense.repository.payment.spec.ts:426-432`):
- `src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts` — `whtRemittance` บันทึกและอ่านคืนผ่าน create/update/`mapExpense` (F3); ยืนยัน E_WHT ⇒ ไม่มี handoff; ร้านยื่นเอง ⇒ `REQUIRED`; เปิดแก้ E_WHT ที่จ่ายบางส่วน 5,000 → ร้านยื่นเอง 2% ⇒ ยืนยันได้ handoff `REQUIRED` (F10); จ่ายครบ 10,600 แล้วเปลี่ยนเป็น 2% ⇒ `expense_paid_exceeds_payable`; รายจ่ายที่มีการจ่ายเงินสดแล้วเปิดแก้เป็น E_WHT ⇒ 409 W-R2 ทั้งตอนบันทึกและยืนยัน (F1); หนังสือรับรองที่ออกแล้ว → เปิดแก้ → E_WHT → ยืนยัน ⇒ ไม่มี handoff `REQUIRED` (F17)
- `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` — จ่ายใบเตรียมจ่ายที่มีรายการ e-WHT ด้วยเงินสด ⇒ ปฏิเสธ ไม่มี `ExpensePayment` ใหม่; อ่านใบได้ `E_WHT`; `readDisbursementExpenseSources`/`payableExpenses` คืน `whtRemittance` และพรีวิวด้วย plannedMethod CASH ⇒ 409 (review รอบ 2 F4); รายละเอียดใบจาก `detailInclude` คืน `whtRemittance` และ `eWhtReducedRateApplied` (รอบ 3 F5); แถวเก่า `whtInputJson` ว่าง อัตราหัวเอกสาร 3 อัตราบรรทัด 0.01 แล้วเปิดแก้เปลี่ยนเป็น e-WHT ⇒ `eWhtReducedRateApplied = true` และ W-P2/L-9 แสดงเมื่อจ่ายนอกช่วง (รอบ 4 F7)
- `src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts` — ออกใบรับรองแทนใบเสร็จของรายจ่าย E_WHT ด้วยเงินสด ⇒ ปฏิเสธ ไม่มีรายการจ่าย (F1)
- `src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts` — ยกเลิกรายจ่ายที่ยืนยันแล้ว ⇒ `EXCLUDED` เป็น `SUPERSEDED` ในธุรกรรมเดียวกันก่อน sync (F8); เปิดแก้ ⇒ เช่นกัน; เปิดแก้รายจ่าย e-WHT ที่จ่ายในเดือนล็อกแบบเก่า ⇒ เปิดได้ แต่รายจ่ายร้านยื่นเองเดือนเดียวกัน ⇒ ยังบล็อก `tax_period_filed` (review รอบ 2 F7)
- migration: `prisma migrate deploy` + `verify-applied-migration-catalog` เดิม

Contracts: `packages/contracts/src/prisma-enum-parity.spec.ts`

Gateway: `apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.spec.ts` และ spec ของ semantic-turn-v2 ที่อยู่ในชุด gateway ของ whole-chain (`scripts/line-ai-whole-chain-acceptance.catalog.mjs:352-360`) — ถาม "e-WHT คืออะไร" ได้ L-14 (ไม่ใช่คำอธิบายหัก ณ ที่จ่ายทั่วไปที่บอกว่าผู้จ่ายนำส่ง [line-ai-scope-policy.logic.ts:362](../../apps/ai-gateway/src/modules/line-ai/domain/logic/line-ai-scope-policy.logic.ts), :441; คำตอบที่ส่งจริงผ่าน [semantic-turn-v2.ts:1510](../../apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts) — review รอบ 4 F6); `apps/ai-gateway/src/modules/line-ai/agents/agent-tools.registry.spec.ts` (:351-362 — v6 จาก 68 เป็น 69 การ์ด, reviewers มีบันทึกอนุมัติใหม่, v4 คงเดิม — review รอบ 2 F11; อยู่ในสคริปต์ `test` ของ ai-gateway แล้ว); `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts` — hash คู่มือภาษีใหม่, v4 ยัง 12 การ์ด, v6 มี `wht.e-wht` ที่ `sourceFile` เป็น tax-guide และ `sourceHash` ตรงไฟล์ (F24), featureKeys ว่าง; `apps/ai-gateway/src/modules/line-ai/agents/tool-availability.spec.ts` — เครื่องคิดเลขไม่เปิดให้แพ็ก starter แต่การ์ด `wht.e-wht` เปิด (F19); W00 หลัง regenerate

Web (`tsx --test "src/**/*.spec.ts"`): `expense-withholding-ux.spec.ts` (ตาราง §10.2 + autofill RATE เท่านั้น + ซ่อน `whtFilingRouteHint` เมื่อ e-WHT + preview payload ไม่มี `whtRemittance` — F4/F14/F15), `disbursement-voucher-payment.logic.spec.ts`, `DisbursementVoucherPayCard.qa.spec.ts` (ไม่มีเงินสด/บัตร + W-P2 — F11), `WithholdingPage.spec.ts` (การ์ด W-T1..T4, ปุ่มดาวน์โหลด, สาขาที่มีแต่ e-WHT — รอบ 2 F6), `PaymentDateConfirmation.spec.ts` (W-PD1/W-PD2/W-P2 — รอบ 2 F9), web spec ของ `SubstituteReceiptWizardPage` (W-P2 ที่ช่องวันจ่ายเงินบริษัท — รอบ 3 F8), หน้ารายจ่าย W-D1/W-D1u และใบ W-V1/W-V1u (รอบ 3 F9), `user-guide.content.spec.ts`

Browser (real browser + ดูภาพ ตาม `docs/guidelines/thai-ux-standard.md:114` — **390 และ 1,280** พร้อมข้อมูลไทย + ~1,556 ตามที่เจ้าของดู — F23):
- ใหม่ `e2e/journeys/e-wht-payment.journey.spec.ts` (`journeys-mobile` 375): เลือก e-WHT ค่าโฆษณา → อัตรา 1 → ยืนยัน → W-D1 → บันทึกจ่ายไม่มีเงินสด → ไฟล์ส่งออกมี "ธนาคารนำส่ง (e-WHT)" คอลัมน์สุดท้าย
- ขยาย `e2e/journeys/withholding-forms.journey.spec.ts`: เดือนผสม → แบบมีแถวเดียว, การ์ด e-WHT หนึ่งแถว, ดาวน์โหลดรายการ e-WHT ได้
- กดเองบน proof stack ที่ล้างได้ (ไม่ใช่ร้านทดลองของเจ้าของ): ฟอร์มตรวจ, หน้ารายจ่าย, ฟอร์มจ่าย, กล่องเปิดแก้, ใบเตรียมจ่าย, ใบรับรองแทนใบเสร็จ, หน้า ภาษีหัก ณ ที่จ่าย ที่ 390 / 1,280 / 1,556 — ถ่ายภาพ ดูภาพ วัดปุ่มในกลุ่ม กดผิดหนึ่งครั้ง (เลือกเงินสดให้รายการ e-WHT)

## 15. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| A1 | ค่าโฆษณา นิติบุคคล วันที่เอกสาร 2026-11-03 เลือก e-WHT (RATE) | อัตราเติม 1; W-F4 + W-F6; ฐาน 10,000 VAT 700 ⇒ หัก 100 ยอดจ่าย 10,600 |
| A2 | ยืนยัน A1 (ยังไม่จ่าย) | ไม่มี handoff; หน้ารายจ่าย W-D1u; แท็บ "ยังไม่ออก" ไม่มีรายการนี้ |
| A3 | จ่าย A1 ด้วยเงินสด ผ่าน: บันทึกจ่ายเว็บ, LINE RECORD_PAYMENT, ใบเตรียมจ่าย (plannedMethod และจ่ายจริง, พรีวิว LINE), ใบรับรองแทนใบเสร็จ | 409 รหัสตาม §7.3 / L-1; ไม่มีการเขียน; LINE กด [โอนเงิน] ⇒ การ์ดใหม่ยอด/วันเดิม |
| A4 | จ่าย A1 โอนเงิน 2026-11-05 แล้ว sync | `WHT_PND53` `EXCLUDED` `expense.wht.e_wht` ฐาน 10,000 หัก 100 งวด 2026-11; ไม่มี issue ของ source นี้; หน้ารายจ่ายเปลี่ยนเป็น W-D1 |
| A5 | เดือน 2026-11 มี A1 + ค่าบริการร้านยื่นเอง 3% | ภ.ง.ด.53 PDF/Excel มีแถวเดียว (ค่าบริการ) และไม่มีชีต e-WHT; การ์ด W-T1 มี A1; ดาวน์โหลดรายการ e-WHT ได้ไฟล์หนึ่งแถว; LINE ยอด ภงด.53 ไม่รวม 100 และ L-11 แสดง 1 รายการ 100 บาท |
| A6 | เดือนที่ ภ.ง.ด.53 มีแต่ e-WHT | การ์ด ภ.ง.ด.53 แสดง W-T3 ไม่มีปุ่มดาวน์โหลดแบบ; **ดาวน์โหลดรายการ e-WHT ได้** |
| A6b | เดือนที่ยื่น ภ.ง.ด.53 แล้ว มีจ่าย e-WHT เพิ่มทีหลัง | ไฟล์แบบที่ยื่นเปิดได้เหมือนเดิม (replay); ไฟล์ e-WHT มีรายการใหม่; งวดไม่กลับเป็น EXPORTED |
| A7 | ค่าโฆษณาร้านยื่นเองอัตรา 1 จ่ายในช่วง | `WHT_RATE_MISMATCH` WARNING หนึ่งรายการ; W-T4; ดาวน์โหลดแบบได้; แก้อัตราเป็น 2 / เปลี่ยนเป็น e-WHT / ยกเลิกรายจ่าย ⇒ RESOLVED |
| A8 | ค่าขนส่งร้านยื่นเอง 1% | ไม่มี WARNING |
| A9 | A1 จ่ายแล้ว 5,000 (บางส่วน) → เปิดแก้ (เห็น W-C1) → ร้านยื่นเอง 2% → ยืนยัน | ยืนยันได้ (5,000 ≤ 10,500); `EXCLUDED` → `SUPERSEDED`; handoff `REQUIRED`; sync ⇒ `ACTIVE` |
| A9b | A1 จ่ายครบ 10,600 → เปิดแก้ → ร้านยื่นเอง 2% → ยืนยัน | ถูกบล็อก `expense_paid_exceeds_payable` พร้อมทางออกเดิม |
| A9c | รายจ่ายที่มีการจ่ายเงินสดแล้ว → เปิดแก้ → เลือก e-WHT | บันทึกไม่ได้ W-R2 |
| A10 | รายการร้านยื่นเองที่อยู่ในแบบ FILED แล้ว จะเปลี่ยนเป็น e-WHT | เปิดแก้ถูกบล็อก `tax_period_filed` เดิม |
| A11 | วันที่เอกสาร 2028-01-03 เลือก e-WHT ค่าโฆษณา | อัตราเติม 2; W-F9 |
| A11b | เอกสาร 2027-12-20 e-WHT 1% จ่าย 2028-01-05 (เว็บ, ใบเตรียมจ่าย, LINE ทั้งสองการ์ด) | W-P2 / L-9 แสดง; บันทึกได้ |
| A12 | ประเภท "อื่นๆ" + e-WHT | อัตราเดิม 3; W-F8; ไม่มีข้อความ "ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง" |
| A12b | e-WHT + โหมด AMOUNT | ไม่เติมอัตรา; มีแค่ W-F4 |
| A13 | ใบเตรียมจ่ายสองรายการ (e-WHT + ยื่นเอง) จ่ายโอนเงิน | สำเร็จ; e-WHT แสดง W-V1u ก่อนจ่ายและ W-V1 หลังจ่าย ไม่มีปุ่ม 50 ทวิ; อีกรายการข้อความเดิม; LINE เสนอออก 50 ทวิเฉพาะรายการยื่นเอง (แพ็ก 1,999) |
| A14 | ส่งออกไฟล์รายจ่าย (ย่อและเต็ม) | "วิธีนำส่งภาษีหัก ณ ที่จ่าย" เป็นคอลัมน์สุดท้าย ค่าตาม W-X2; คอลัมน์เดิมตำแหน่งเดิม |
| A15 | LINE แพ็ก 1,999 "ค่าโฆษณา ฐานก่อนภาษี 10000 ต้องหักเท่าไหร่" | ได้ปุ่มเลือกประเภท; กด "ค่าโฆษณา (นิติบุคคล)" ⇒ 2% = 200 + L-5 1% = 100 |
| A15b | LINE แพ็ก 249 ถามเรื่องเดียวกัน | ไม่เห็นเครื่องคิดเลข (ข้อความแพ็กเดิม); ถาม "e-WHT ต้องยื่น ภงด53 ไหม" ได้การ์ด `wht.e-wht` (หลังอนุมัติ) |
| A16 | ข้อความแจ้งเตือนเมื่อเปิดแก้รายจ่ายที่มีหนังสือรับรองแล้ว | ลงท้าย N-1; เปลี่ยนเป็น e-WHT แล้วยืนยัน ⇒ ไม่มีรายการค้างออก |
| A17 | ทุกแพ็ก 249/499/999/1,999 | A1–A4, A9–A14 เหมือนกัน; การ์ด/ไฟล์ e-WHT หน้า ภาษีหัก ณ ที่จ่าย, เครื่องคิดเลข, สรุปรายเดือน เฉพาะ 1,999; ไม่มีสวิตช์ |
| A18 | 390, 1,280 และ ~1,556 px (เบราว์เซอร์จริง ข้อมูลไทย ดูภาพ) | ไม่ล้นจอ ไม่มี scroll แนวนอน ปุ่มในกลุ่มขนาดเท่ากัน (วัด) ปุ่มฟอร์มอยู่แถบล่าง |
| A19 | ฟอร์มตรวจเลือก e-WHT แล้วระบบคำนวณยอดใหม่ | totals-preview ตอบ 200 (payload ไม่มี `whtRemittance`) |
| A20 | LINE สรุปรายเดือน โดยผู้มีแค่ `wht.certificate.read` (เห็นเฉพาะรายจ่ายของตน) | ไม่มีบรรทัด e-WHT, `eWht: null` |
| A21 | เดือนเดียวมี e-WHT 100 บาท และ 10 USD | การ์ด/ไฟล์/LINE แสดง "100.00 บาท" และ "10.00 USD" แยกกัน ไม่รวมเป็น 110 |
| A22 | รายจ่ายเก่าสองบรรทัด (ค่าบริการ + อื่นๆ) ไม่มีเลขผู้เสียภาษี | `MISSING_TAX_ID` OPEN ทุกลำดับบรรทัด; ดาวน์โหลดแบบถูกบล็อกจนแก้ |
| A23 | สาขา B มีแต่ e-WHT ในเดือนนั้น | หน้าเดือนแสดงสาขา B พร้อม W-T3 และการ์ด e-WHT |
| A24 | รายจ่าย e-WHT จ่ายในเดือนที่ล็อกแบบเก่า แล้วเปิดแก้ | เปิดแก้ได้ (ยกเว้นงวดบัญชี/ภ.พ.30 ล็อก) |
| A25 | ยืนยันวันที่จ่ายของรายจ่าย e-WHT | เห็น W-PD1; บันทึกแล้วได้ W-PD2 ไม่ใช่ "อยู่ในแบบเดือน …" |
| A26 | สร้างร่างใบเตรียมจ่ายที่มีรายการ e-WHT | ตัวเลือกวิธีจ่ายที่วางแผนไม่มีเงินสด/บัตร (ข้อมูลจาก `DisbursementPayableExpense.whtRemittance`) |
| A27 | เดือนที่มีค่าบริการผู้ขายไม่มีเลขผู้เสียภาษี (ไม่มี event) + รายการอื่นที่มี event (รวมกรณีมีประเภท "ผู้ทำบัญชีจัดทำ") | PDF และ Excel ถูกบล็อกด้วยข้อความ `MISSING_TAX_ID` เดิม และการ์ดแบบแสดงตัวบล็อก (B8, B11) |
| A28 | รายจ่ายเก่าบุคคลสองบรรทัด (ภ.ง.ด.3 + ภ.ง.ด.2) sync สองรอบ ทั้งสองลำดับบรรทัด | event ทั้งสองแบบอยู่ครบ (B9) |
| A29 | LINE การ์ดใบเตรียมจ่ายจ่ายบางส่วน 5,300 จากยอดสุทธิ 10,600 หัก 100 | บรรทัดแสดง "หักภาษีทั้งเอกสาร 100 บาท" (B10) |
| A30 | เดือนเดียวมี e-WHT + การจ่ายปกติที่ขาดเลขผู้เสียภาษี | ไม่มี W-T3; แสดงตัวบล็อก `MISSING_TAX_ID` |
| A31 | ใบรับรองแทนใบเสร็จเงินบริษัทของรายจ่าย e-WHT 1% ค่าโฆษณา วันจ่าย 2028-01-05 | ช่องวันจ่ายแสดง W-P2; บันทึกได้ |
| A32 | ซ้อมย้อนกลับบน UAT ตาม §16 (deploy ชุดย้อนกลับ R แล้วเปิดหน้า ภาษีหัก ณ ที่จ่าย ซึ่ง sync ทั้งบริษัท) | ไม่มี event `ACTIVE` ของรายจ่าย e-WHT เกิดขึ้น; แบบไม่มีแถว e-WHT; บน R บันทึกจ่ายเงินสดให้รายจ่าย e-WHT ที่ยังไม่จ่าย ⇒ 409; เปิดแก้แล้วยืนยันใหม่ ⇒ ไม่มี handoff (review รอบ 4 F1) |
| A33 | รายจ่ายเก่าไม่รู้ประเภทผู้รับเงิน (จ่ายแล้ว) + รายการ ภ.ง.ด.53 อื่นเดือนเดียวกัน | ดาวน์โหลด ภ.ง.ด.3 และ ภ.ง.ด.53 ของสาขานั้นถูกบล็อก จนเลือกประเภทผู้รับเงิน (B12) |
| A34 | ต้นทางไม่มี event ของสาขา B; ผู้มีสิทธิ์เฉพาะสาขา A เปิดหน้าเดือน (โหมดสำนักงานใหญ่จ่ายทั้งหมด) | เห็น W-T5 ไม่มีชื่อ/รหัส; ผู้ดูแลสาขา B เห็นรายการเต็มพร้อมลิงก์แก้ |
| A35 | รายจ่ายขาดเลขผู้เสียภาษีถูกยกเลิก แล้ว sync | issue ถูก resolve และไม่บล็อกกระดาษอีก |
| A36 | LINE ถาม "e-WHT คืออะไร" (ทุกแพ็ก) | ได้ L-14/L-7 ไม่ใช่คำอธิบายว่าผู้จ่ายนำส่ง |
| A37 | กระดาษ ภ.ง.ด.53 ดาวน์โหลดแล้ว (EXPORTED) → มีรายจ่ายเก่าที่จ่ายแล้วแต่ไม่รู้ประเภทผู้รับเงินเกิดขึ้นในสาขาเดียวกัน → กด "บันทึกว่ายื่นแล้ว" | ถูกปฏิเสธด้วยข้อความ `WHT_PAYEE_KIND_UNKNOWN` เดิม (`PND53_FILING_REVIEW`); เลือกประเภทแล้ว ดาวน์โหลดใหม่ แล้วบันทึกได้ |
| A38 | กระดาษ ภ.ง.ด.53 FILED (ก่อนการแก้) ที่มีตัวบล็อก `MISSING_TAX_ID` ของรายการนิติบุคคลผูกอยู่ | ไฟล์ที่ยื่นเปิดได้เหมือนเดิม; การ์ดแสดง W-T6; ใส่เลขผู้เสียภาษีแล้ว ระบบเสนอ ภ.ง.ด.53 เพิ่มเติมครั้งที่ 1 ที่มีรายการนั้น (W-T6a) |
| A38b | มีแต่ ภ.ง.ด.53 FILED; รายการไม่รู้ประเภทผู้รับเงินถูกแก้เป็นบุคคลธรรมดา | event ย้ายเป็น `WHT_PND3`; ภ.ง.ด.3 เดือนนั้นเปิดเป็นแบบปกติ (ไม่ใช่เพิ่มเติม); ถ้าพ้นกำหนดแล้ว ดาวน์โหลดถูกบล็อกด้วยข้อความ overdue เดิม (W-T6b) |

## 16. Risks/rollout

- **ผู้ใช้เลือก e-WHT ทั้งที่ไม่ได้จ่ายผ่าน e-WHT** ⇒ ภาษีไม่ถูกยื่นโดยใคร: ป้ายบอก "ธนาคารนำส่ง", W-F4 บอกผล, การ์ด/ไฟล์ e-WHT และคอลัมน์ไฟล์ให้ผู้ทำบัญชีกระทบกับใบเสร็จของธนาคาร/กรมสรรพากร
- **ข้อมูลเก่าที่จ่าย e-WHT แต่บันทึกแบบเดิม**: sync แรกหลัง deploy สร้าง WARNING ให้แถว 1% ที่ยังไม่ยื่น (A7); แถวที่ยื่นแล้วระบบไม่แตะ; ก่อน deploy นับด้วย query อ่านอย่างเดียว (runbook bastion — แจ้งเจ้าของก่อนเปิด session)
- **แก้ B5 แล้วตัวบล็อก ภ.พ.30 ที่เคยหายจะกลับมา** สำหรับรายจ่ายสกุลเงินต่างประเทศ — ถูกต้อง แต่ผู้ใช้ `thai_tax` (ไม่ได้ขาย) อาจเห็นตัวบล็อกใหม่
- **ช่วงอัตราหมดหรือขยาย**: แก้ค่าคงที่ที่เดียว; หลัง 31 ธ.ค. 2570 คำใบ้/ประโยค 1% หายตามวันที่
- **แพ็กคำตอบต้องอนุมัติ** (L-7/L-8/H-1/H-2) ก่อน merge แผน §4.4 (review รอบ 2 F12); ส่วนอื่นไม่อ้างการ์ด
- Rollout: migration additive ไม่ backfill; ไม่มีสวิตช์; API+web พร้อมกัน; UAT ตาม `docs/runbooks/uat-production-v2-deployment.md`; ถามเจ้าของก่อนขึ้น Production
- **ย้อนกลับ (review รอบ 3 F3)** — "หยุด sync" ทำไม่ได้: เปิดหน้า ภาษีหัก ณ ที่จ่าย เดือนใดก็ sync ทั้งบริษัท ([WithholdingPage.tsx:142](../../apps/web/src/features/tax/WithholdingPage.tsx)) และตัวอ่านรายจ่ายอ่านทุกการจ่ายโดยไม่สนช่วงวันที่ ([expense-source.adapter.ts:76](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) ⇒ API รุ่นเก่าจะเขียน `ACTIVE` ให้รายการ e-WHT ทันที ขั้นตอนที่ทำได้จริง:
  1. **ห้ามย้อน API ข้ามรุ่นนี้ด้วยรุ่นเก่าตรง ๆ** — migration เป็น additive คอลัมน์อยู่ถาวร
  2. **เตรียมชุดย้อนกลับ R ตั้งแต่วันปล่อย**: R = รุ่นก่อนหน้า + schema ที่มีคอลัมน์ `whtRemittance` + **ตัวป้องกันฝั่งเขียนทุกจุดของรุ่นนี้ที่อ่าน `whtRemittance`** (จุดบังคับวิธีจ่ายทั้งหมดใน §7.3 รวม `recordPaymentInTransaction` [prisma-expense.repository.ts:670-679](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), การไม่สร้าง handoff ตอนยืนยัน และการตรวจรายการจ่ายเงินสด/บัตรตอนยืนยันใหม่ — มิฉะนั้นรายจ่าย e-WHT ที่ยังไม่จ่ายรับเงินสดได้ แล้วตัวอ่านของ R ตัดการจ่ายเงินสดนั้นออกจากแบบ — review รอบ 4 F1/P40; UI ไม่ต้องคง) + เงื่อนไขใน `findConfirmedWithWhtByCompany` ([expense-source.adapter.ts:70-80](../../apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts)) ให้ตัดรายจ่าย `whtRemittance = 'E_WHT'` ออก (ครอบทุกทาง sync เพราะทุกทางเรียก `SyncTaxEventsUseCase.execute` ซึ่งอ่านรายจ่ายผ่านตัวอ่านนี้: [tax.controller.ts:130-137](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts) `tax/pnd53/sync` และ `tax/withholding/:formType/sync` ที่หน้าเดือนเรียก, :236-242 `tax/sync`, และ :311); build และ publish image ไว้พร้อม deploy ตาม `docs/runbooks/uat-production-v2-deployment.md` และซ้อมบน UAT ก่อนขึ้น Production (A32)
  3. ถ้าต้องย้อน: deploy R (ไม่ใช่รุ่นเก่าตรง ๆ); รายการ e-WHT ที่บันทึกระหว่างนั้นคงเป็น `EXCLUDED`/ไม่มี event; ช่องเลือกบนเว็บหายไปแต่ค่าในฐานข้อมูลยังอยู่
  4. ถ้าเคยมีรุ่นที่ไม่มีเงื่อนไขนี้ทำงานไปแล้ว: deploy รุ่นนี้หรือ R แล้ว sync ⇒ event `ACTIVE` ที่รุ่นเก่าเขียนจะถูก supersede (hash ต่างเพราะรวม remittance); จากนั้น query อ่านอย่างเดียวหา `WhtFilingLine` ที่อ้างรายจ่าย e-WHT ในแบบที่ยื่นระหว่างนั้น แล้วแจ้งผู้ทำบัญชีให้จัดการกับกรมสรรพากร (ระบบไม่แก้แบบที่ FILED)

## 17. Open questions (เฉพาะเรื่องธุรกิจของเจ้าของ)

| # | คำถาม | คำแนะนำ |
|---|---|---|
| Q1 | เปิดให้เลือก "ธนาคารนำส่ง (e-WHT)" ในรายจ่ายทุกแพ็ก (249/499/999/1,999) ใช่ไหม | **ใช่ ทุกแพ็ก** — การหักภาษีในรายจ่ายอยู่ในชุดเริ่มต้นแล้ว การกันยื่นซ้ำเป็นเรื่องความถูกต้อง |
| Q2 | ผู้รับเงินขอกระดาษ 50 ทวิ สำหรับการจ่ายผ่าน e-WHT จะให้ระบบออกได้ไหม | **ไม่ให้ออก** — กรมสรรพากรบอกว่าไม่ต้องออก ผู้รับเงินตรวจบนเว็บกรมได้ |
| Q3 | ค่าตั้งต้นของรายจ่ายใหม่ที่หักภาษี: "ร้านยื่นแบบเอง" ทุกครั้ง หรือจำตามร้าน/ผู้รับเงิน | **"ร้านยื่นแบบเอง" ทุกครั้งรอบแรก** — ค่าตั้งต้นที่ผิดเงียบ ๆ เสี่ยงกว่าการกดเลือกหนึ่งครั้ง |
| Q4 | อนุมัติข้อความน้องมั่งมีและคู่มือ L-7, L-8, H-1, H-2 (§10.1) — บล็อกเฉพาะแผน §4.4 | **อนุมัติตามที่เขียน** — ผ่านตาราง §10.2 และอ้างแหล่ง §5.1 |

## 18. Must close before coding

ข้อที่ปิดด้วยการอ่านโค้ดไม่ได้ (ทุกข้อ MEDIUM/LOW; ไม่มี HIGH ค้าง) — ปิดก่อนเริ่มขั้นที่ระบุ

| # | เรื่อง | ระดับ | เจ้าของ | ขั้นต่อไป | บล็อกขั้นไหน |
|---|---|---|---|---|---|
| MC1 | คำตอบเจ้าของ Q1–Q4 (§17) | MEDIUM | เจ้าของ (ผ่าน coordinator) | ส่ง §17 เป็นภาษาไทยง่าย ๆ | Q2 → แผน 1.3 (การข้าม handoff); Q4 → แผน 4.4 |
| MC2 | ตัวประกาศอธิบดีฯ ตามมาตรา 3 ปัณรส ที่เป็นฐานของ "ไม่ต้องยื่นแบบ/ไม่ต้องออก 50 ทวิ" (G1) | LOW | research lane | ค้นบน rd.go.th และราชกิจจานุเบกษา; ถ้าเนื้อความต่างจาก ปชส. 5/2564 ให้แก้ W-F4, W-D1, W-V1, L-7, H-1 | แผน 3.1 (ข้อความเว็บ) และ 4.4 |
| MC3 | ธนาคารใดรับการจ่ายด้วยเช็ค/ช่องทางอื่นผ่าน e-WHT | LOW | research lane | อ่านหน้าบริการ e-WHT ของธนาคารหลัก (กสิกร, SCB, กรุงเทพ, กรุงศรี); ถ้าไม่มี ให้ `eWhtPaymentMethodAllowed` รับเฉพาะ `BANK_TRANSFER`/`OTHER`/ไม่ระบุ | แผน 1.2 |
| MC5 | review รอบ 4 (รอบสุดท้าย) เสร็จ 2026-10-24: HIGH ใหม่ 3 ข้อแก้ในเอกสารแล้วแต่ไม่มีรอบตรวจต่อ ⇒ ตาราง "Unreviewed fixes from round 4" ด้านล่าง | — | coordinator | — | ดูด้านล่าง |

### Round-4 HIGH fixes — all CLOSED by focused checks (2026-10-24)

ทั้งสามข้อเป็น HIGH ที่ออกแบบการแก้ไว้หลัง review รอบสุดท้าย; focused blocker review (Codex, 2026-10-24 — `review-ewht-blockers.md`) ปิด BL1 และ BL2; focused re-check ของ BL3 (2026-10-24 — `review-ewht-bl3.md`) ยืนยันว่าการบังคับร่วมที่ `markFiled` ปิดช่องโหว่ และข้อแก้สุดท้าย (แยก "แบบเพิ่มเติมของแบบเดิม" กับ "แบบปกติของอีกแบบ — อาจยื่นช้า") ทำแล้วใน W-T6a/W-T6b, A38/A38b ⇒ **ไม่มี blocker เหลือ** — ตารางนี้เก็บไว้เป็นประวัติ

| # | review | สถานการณ์ที่ผิด | การแก้ที่ออกแบบ | ขั้นที่ถูกบล็อก | เจ้าของการแก้ |
|---|---|---|---|---|---|
| BL1 — **CLOSED** (focused review 2026-10-24) | รอบ 4 F1 (P40) | ย้อนกลับด้วย R ที่มีแค่ตัวกรอง sync: รายจ่าย e-WHT ที่ยังไม่จ่ายรับ **เงินสด** ผ่าน API ที่ย้อนกลับ แล้วยังเป็น `E_WHT` ⇒ ตัวอ่านของ R ตัดการจ่ายเงินสดนั้นออก ภ.ง.ด.3/53 ขาดแถว | R ต้องคงตัวป้องกันฝั่งเขียนทั้งหมดที่อ่าน `whtRemittance` (§7.3 ทุกจุด, ไม่สร้าง handoff, ตรวจตอนยืนยันใหม่) + ตัวกรอง sync; ซ้อมบน UAT ตาม A32 | แผน Phase 5 (เตรียม R) และการขึ้น Production ทั้งหมด | Expenses + Tax lane; ผู้ตรวจอิสระ (coordinator จัด) |
| BL2 — **CLOSED** (focused review 2026-10-24) | รอบ 4 F2 | การแก้ B11 แบบ "ตัวบล็อกต้นทางที่ไม่มี event บล็อกทุกกระดาษ" ทำให้ export ของสาขา A คืนชื่อผู้ขาย รหัสรายจ่าย รหัสคู่ค้า ของสาขา B ([generate-tax-filing-package.use-case.ts:76](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts), :120) | ผูกตัวบล็อกตามสาขาของรายจ่าย (§7.4 ข้อ "รอบ 4" (ข)); นอกขอบเขตผู้เรียก ⇒ W-T5 ไม่มีรายละเอียด; ทางแก้คือผู้ดูแลสาขานั้น | แผน 2.3 | Tax lane; ผู้ตรวจอิสระ |
| BL3 — **CLOSED** (focused re-check 2026-10-24) | รอบ 4 F3 (บั๊กเดิม B12) | (1) รายจ่ายเก่าที่จ่ายแล้วแต่ไม่รู้ประเภทผู้รับเงิน (ไม่มี event) + รายการ ภ.ง.ด.53 อื่นที่ถูกต้อง ⇒ `validateWithholdingFiling` (:14) ตัด `WHT_PAYEE_KIND_UNKNOWN` ⇒ ดาวน์โหลดแบบได้โดยขาดรายการนั้น; (2) กระดาษที่ดาวน์โหลดก่อนการแก้ (EXPORTED) ยัง "บันทึกว่ายื่นแล้ว" ได้เพราะ `markFiled` ตัด issue เดียวกัน ([tax.controller.ts:333-336](../../apps/api/src/modules/tax/presentation/http/tax.controller.ts)) แล้วการดาวน์โหลดหลัง FILED replay ไฟล์ที่ขาดโดยไม่ตรวจ ([generate-tax-filing-package.use-case.ts:57-71](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts)) | ฟังก์ชันเดียว `withholdingPaperBlockers` ใช้ที่ validation, `getMonth` **และ `markFiled`** (§7.4 ข้อ "รอบ 4" (ค)); regression EXPORTED → เกิดตัวบล็อกผู้รับเงินไม่รู้ประเภท → บันทึกว่ายื่นถูกปฏิเสธ (A37); กระดาษที่ FILED ก่อนการแก้: ไม่แก้ไฟล์ที่ยื่นแล้ว แต่ `getMonth` ติดธง W-T6 และหลังแก้ข้อมูลต้นทาง: แบบเดิม ⇒ แบบเพิ่มเติม (A38, W-T6a); อีกแบบที่ยังไม่ยื่น ⇒ แบบปกติ อาจพ้นกำหนดและถูก fault overdue เดิม (A38b, W-T6b) + ก่อน deploy query อ่านอย่างเดียวหากระดาษ FILED ที่มีตัวบล็อกผูกอยู่ แล้วแจ้งเจ้าของ/ผู้ทำบัญชี | แผน 2.3 | Tax lane; focused re-check (coordinator จัด) |

MEDIUM/LOW จากรอบ 4 (F4–F9) แก้ในเอกสารแล้วและไม่บล็อก; ข้อที่ยังต้องปิดก่อนเขียนโค้ดคือ MC1 (คำตอบเจ้าของ — ก่อน), MC2, MC3 ในตารางบน
