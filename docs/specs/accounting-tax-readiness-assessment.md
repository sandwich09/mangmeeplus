# ผลตรวจความพร้อมระบบบัญชี–ภาษี: ยื่นสรรพากร / งานบัญชีบริษัททั่วไป

Status: ผลตรวจ (read-only audit) ณ 2026-08-03 — ใช้เพื่อจัดลำดับงาน ไม่ใช่ spec สั่งพัฒนา; การตรวจครั้งนี้ไม่แก้โค้ด
Update 2026-08-04: RA-18 ปิด, RA-19 ปิดบางส่วน (branch `launch-prep/line-ai-expense`) — ดูรายละเอียดในกลุ่ม D
Audited tree: `develop` @ `544bdd25` (working tree ขณะตรวจมีงานค้างเรื่อง feature-entitlement / ai-draft ซึ่งอยู่นอกขอบเขต)
คำถามที่ตอบ: (1) ระบบครบพอที่จะยื่นสรรพากรได้ไหม (2) ใช้ทำบัญชีบริษัททั่วไปได้ไหม
เอกสารเกี่ยวข้อง: `docs/specs/finance-accounting-gaps-spec.md` (GAP-01..08 — เอกสารนั้นเป็น DRAFT รอทีมตัดสินรายข้อ ผลตรวจนี้ไม่แก้ไขและใช้เลข RA-xx แยกกัน), `docs/specs/accounting-product-benchmark.md`, `docs/plans/thai-tax-mvp-plan.md`, `docs/specs/tax-2026-verified-rules.md`, `docs/agent-memory/wht-durable-prefilled-handoff.md`

## 1. คำตอบสรุป

| คำถาม | คำตอบ | เหตุผลย่อ |
|---|---|---|
| ครบพอยื่นสรรพากรไหม | **ยังไม่ได้** | ไม่มีเอกสาร/รายงาน/ไฟล์ยื่นตามแบบสรรพากรแม้แต่รายการเดียว (RA-13..RA-16); WHT ผิดโครงสร้าง (RA-18..RA-20); บริษัทกรอกตัวตนภาษีเองไม่ได้ (RA-23) |
| ใช้ทำบัญชีบริษัททั่วไปได้ไหม | **ยังไม่ได้** | การลงบัญชีอัตโนมัติตายเชิงโครงสร้าง (RA-01/RA-02), งบเป็น movement เดือนเดียวและงบดุลไม่ดุล (RA-06/RA-07), ไม่มียอดยกมา/ปิดปี (RA-08/RA-09), ปิดงวดติด blocker จริง (GAP-07, RA-03) |

**บทบาทที่ระบบทำได้จริงวันนี้:** เก็บและเตรียมข้อมูล VAT/WHT อย่างมีร่องรอยตรวจสอบ (tax-data-preparation) เพื่อส่งต่อให้สำนักงานบัญชีไปจัดทำ/ยื่นเอง — ไม่ใช่ระบบยื่นภาษีหรือปิดงบครบวงจร

## 2. ความพร้อมรายแบบภาษี

| แบบ/เอกสาร | สถานะในระบบ | ยื่น/ใช้ได้? |
|---|---|---|
| ใบกำกับภาษี (ม.86/4) | data model + เลขรัน + ขอบเขตกฎหมายถูกต้อง แต่**ไม่มีเอกสารพิมพ์/PDF**, snapshot ผู้ซื้อไม่มีที่อยู่/สาขา, ไม่มีต้นฉบับ/สำเนา (RA-13) | ✗ |
| ใบลดหนี้/ใบเพิ่มหนี้ | ผูกต้นฉบับถูกต้อง, เครื่องหมายลบถูกต้อง, กัน correction ซ้อน — แต่พิมพ์ไม่ได้ (RA-13) | ครึ่งทาง |
| รายงานภาษีขาย / รายงานภาษีซื้อ | **ไม่มี**ตามรูปแบบ RD — มีแค่ตาราง tax event รวมสองทิศทาง (RA-14) | ✗ |
| ภ.พ.30 | box 1–9 คำนวณจริง (`aggregatePp30Boxes`); บริษัทที่ onboard ตั้งแต่ 2026-08-04 ได้ tax-code profile + report mapping ACTIVE ตอนสร้างบริษัท จึงมีตัวเลขจริง **เฉพาะฝั่งภาษีซื้อ box 6/7** — ฝั่งขาย box 1/2/3/5 ยังเป็น 0 (template ที่ seed มีแต่โค้ด INPUT และ `sales_documents` ไม่ได้อยู่ใน launch package) ทำให้ box 8/9 อ่านเป็น "ชำระเกิน" ด้านเดียว; บริษัทเดิมและเส้น legacy header VAT ยังให้ **0** (RA-16), ไม่มีแบบฟอร์ม/ไฟล์ยื่น (RA-15) | ✗ |
| ภ.พ.36 | เส้นทางสมบูรณ์สุดในระบบ (reverse charge, evidence gating, input claim) แต่ไม่มีแบบยื่น | ครึ่งทาง |
| ภ.ง.ด.3 | reachable แล้วตั้งแต่ 2026-08-04 — expense เก็บประเภทผู้รับเงินและ sync derive PND3/PND53 (RA-18 ปิด); ยังไม่มีใบแนบ/ไฟล์ยื่น | ✗ (ยื่น) / ✓ (เกิด event) |
| ภ.ง.ด.53 | rate ไหลจาก line แล้ว (เป็น percent) + gross ใช้ฐานบรรทัดที่หัก (RA-19 ปิดบางส่วน — หมวดเงินได้ยังเป็น free-text, ยังไม่ได้ตรวจกับแบบจริง), การจ่าย AP ไม่เข้าระบบภาษี (RA-20), ไม่มีใบแนบ/ไฟล์ยื่น | ✗ |
| หนังสือรับรอง 50 ทวิ | ออกจากระบบไม่ได้ (seed CLOSED — by design) → เส้นทางจริงคือ handoff ไปออกภายนอก (H4: backend + AP panel มีแล้ว); ไม่มีฟอร์มพิมพ์ (RA-21) | ✗ (ออกเอง) / ✓ (handoff ภายนอก) |
| ภ.ง.ด.50/51 (CIT) | endpoint คืนค่าว่างถาวร — ไม่มีอะไรเขียนข้อมูล CIT (RA-25); spec ตั้งใจ scope แค่ calendar+summary แต่แม้ calendar ก็ไม่ทำงาน | ✗ |
| ภ.ง.ด.1 / ประกันสังคม | **ไม่มีโมดูล payroll ทั้งระบบ** (RA-30) | ✗ |
| รายงานสินค้าและวัตถุดิบ (ม.87(3)) | ไม่มี — inventory report เป็น qty ทั่วไป ไม่ใช่แบบ RD (RA-14) | ✗ |
| e-Tax Invoice / e-Receipt | ไม่มี — เป็น non-goal ที่ประกาศใน `tax-thailand-2026-spec.md` | ✗ (ตั้งใจ) |

## 3. ความพร้อมงานบัญชีบริษัททั่วไป

| งาน | สถานะ |
|---|---|
| ผังบัญชี | ดี — ผังไทย SME 175 บัญชี bootstrap อัตโนมัติ + preview/apply; แต่สร้าง/แก้บัญชีจาก UI ไม่ได้ (backend มี endpoint, ไม่มีหน้าจอ) |
| ลงบัญชีอัตโนมัติจากเอกสาร | **ตายเชิงโครงสร้างสำหรับทุกบริษัทที่ onboard จริง** (RA-01, RA-02) |
| ลง JV เอง | backend ครบ, **ไม่มี UI** (RA-04) |
| งบทดลอง / งบกำไรขาดทุน / งบดุล | เป็น movement งวดเดียว ไม่มียอดยกมา/สะสม (RA-06); งบดุลไม่ดุล (RA-07) |
| งบกระแสเงินสด | ไม่มี (RA-10) |
| ปิดงวดเดือน | gate 10 ข้อแข็งแรง แต่ติด blocker จริงจาก expense จ่ายแล้วค้าง pending (GAP-07) และเอกสารขายที่ post ไม่ได้ (RA-03) |
| ปิดปี / ยอดยกมา | **ไม่มีทั้งคู่** (RA-08, RA-09 / GAP-05) |
| ทะเบียนทรัพย์สิน/ค่าเสื่อม | ไม่มี (RA-32) |
| ต้นทุนสินค้า / COGS | ไม่มี — inventory เป็นจำนวนอย่างเดียว (RA-31) |
| กระทบยอดธนาคาร | มีโมดูล แต่ไม่เคยเทียบกับยอด GL จริง และรายการปรับปรุงธนาคารลงบัญชีไม่ได้ (RA-33, RA-05) |
| ลูกหนี้/เจ้าหนี้คงค้าง | AP ดี (มี aging bucket); AR เป็น list แบนไม่มี bucket และตกหล่นเอกสารบางชนิด (RA-34) |
| Export ไฟล์ (XLSX/CSV/PDF) | ledger export = stub `export_not_implemented`; tax export ไม่มี durable storage (RA-10, RA-13) |
| สิทธิ์ผู้ใช้ฝ่ายบัญชี/การเงิน | preset ที่ ship แล้วใช้งานจริงไม่ได้ — ขาด read permissions (GAP-01) |

## 4. Findings จากการตรวจครั้งนี้ (RA-01..RA-34)

ระดับ: **บล็อก** = ใช้งานจริงไม่ได้ถ้าไม่แก้ · **สูง** = ผิด/ขาดที่กระทบความถูกต้อง · **รอง** = คุณภาพ/ความสะดวก
เลขบรรทัดเป็นค่า ณ วันที่ตรวจ (tree `544bdd25`)

### กลุ่ม A — การลงบัญชี (posting)

- **RA-01 (บล็อก) PostingRule ไม่มีทางสร้างได้ แต่ระบบบังคับต้องมี** — ไม่มี endpoint/UI/seed ใดเขียน `postingRule` (ยืนยันด้วย grep: การเขียนมีเฉพาะใน generated Prisma client) ขณะที่ `requiresReviewedPostingRules` (`apps/api/src/modules/ledger/domain/logic/posting-engine.logic.ts:57`) บังคับใช้กับทุกบริษัทที่มี chart-template provenance ซึ่งคือทุกบริษัทที่ onboard/seed → `posting/generate` ล้มด้วย `posting_rule_missing` (`journal.use-case.ts:514`) เสมอ
- **RA-02 (บล็อก) รหัสบัญชี default ในโค้ดขัดกับผัง TH_SME_COA_V1** — `ACCOUNTS_RECEIVABLE: '1210-00'` (ในผังคือลูกหนี้เงินให้กู้ยืม; trade AR จริงคือ 1130-01), `EXPENSE_GENERAL: '5310-01'` (= เงินเดือน) และอีก 6 รหัส (1110-01, 2210-01, 2130-01, 1280-00, 2210-02, 1270-00) ไม่มีในผัง; `categoryKey`/`accountHintKey` ถูกส่งเข้า posting input แล้วไม่ถูกอ่าน — ไม่มี mapping หมวดค่าใช้จ่าย→บัญชี (`posting-engine.logic.ts:44-55`)
- **RA-03 (บล็อก) เอกสารฝั่งขายและ accounting payment ไม่มีปุ่ม post ใน UI** — ถูก stamp `postingStatus:'pending'` ตอนสร้าง (`prisma-accounting.repository.ts:462`) และ pending นับเป็น blocker ปิดงวด (`period.use-case.ts:159-166`); ปุ่ม post มีเฉพาะ expenses และ AP → รายได้/VAT ขายไม่มีทางถึง ledger ผ่านการใช้งานปกติ
- **RA-04 (บล็อก) ไม่มี UI สำหรับ JV manual** — backend create/post/reverse ครบ (`journal.use-case.ts:215,250,284`) แต่ `apps/web/src/features/ledger/ledger.api.ts` ไม่มีฟังก์ชันเรียก → ค่าเสื่อม, รายการปรับปรุง, ยอดยกมา ทำจากหน้าจอไม่ได้เลย
- **RA-05 (สูง) รายการปรับปรุงธนาคารลงบัญชีไม่ได้** — `BankAdjustment` มีช่อง ledger account และตั้ง `postingStatus:'pending'` (`bank-adjustment.use-case.ts:126`) แต่ไม่มี branch ใน `canonicalSource` → ค่าธรรมเนียม/ดอกเบี้ยธนาคารไม่มีเส้นทางเข้าบัญชี

### กลุ่ม B — งบการเงิน/งวดบัญชี

- **RA-06 (บล็อก) รายงานทุกตัวเป็น movement งวดเดียว** — TB/GL/P&L/BS ล้วน aggregate หนึ่ง period; `openingBalance` hardcode `'0.0000'` (`report.use-case.ts:45`); ไม่มี YTD, ยอดสะสม, งวดเปรียบเทียบ
- **RA-07 (บล็อก) งบดุลไม่ roll กำไรงวดเข้าส่วนทุน** — สินทรัพย์ ≠ หนี้สิน+ทุน และไม่มี assertion ใดตรวจ (`report.use-case.ts:141`) → ใช้เป็นงบแสดงฐานะการเงินไม่ได้
- **RA-08 (บล็อก) ยอดยกมาไม่มีทั้งระบบ** — entry type `OPENING_BALANCE` ประกาศพร้อม label ไทย แต่ไม่มี writer/endpoint/UI → ย้ายบริษัทที่มีบัญชีเดิมเข้าระบบไม่ได้
- **RA-09 (บล็อก) ไม่มีปิดปี/ปีบัญชี** — `CLOSING` ไม่เคยถูกเขียน, ไม่มี fiscal year (period เป็น YYYY-MM เท่านั้น), ไม่มี retained-earnings roll-forward; ตรงกับ GAP-05 ซึ่งทีม defer ไว้ 2026-07-29 (ต้องกลับมาก่อน year-end ลูกค้ารายแรก)
- **RA-10 (สูง) ไม่มีงบกระแสเงินสด; export เป็น stub** — `cashFlowCategory` ในผังไม่เคยถูกใช้; ledger export คืน `export_not_implemented` (`report.use-case.ts:187`)
- **RA-11 (สูง) reversal ทิ้งข้อมูลภาษีและใช้วันที่ผิดงวด** — copy เฉพาะ account/branch/amount แต่ทิ้ง `taxSnapshot`/`componentKey`/`reportContributionsJson`; `entryDate` = วันนี้ + เลขรันจาก sequence เดือนปัจจุบัน ทั้งที่ลงใน period เดิม (`journal.use-case.ts:313`)
- **RA-12 (รอง) หน้า `/period-closing` เป็น placeholder** (`PlannedModulePage`); ไม่มี unclose UI

### กลุ่ม C — เอกสาร/รายงานภาษีตามกฎหมาย

- **RA-13 (บล็อก) เอกสาร statutory พิมพ์ไม่ได้แม้แต่ใบเดียว** — ไม่มี template ใบกำกับภาษี (ไม่มีแนวคิดต้นฉบับ/สำเนา; counterparty snapshot เก็บแค่ `{id, displayName, taxId, legalName}` ไม่มีที่อยู่/สาขาผู้ซื้อ — `document.use-case.ts:194`); PDF generator ตัวเดียวของระบบคือ `buildMinimalPdf` ฝัง `/BaseFont /Helvetica` (`tax-export.logic.ts:71`) → **เรนเดอร์ภาษาไทยไม่ได้** และลงท้าย "Manual filing only"
- **RA-14 (บล็อก) ไม่มีรายงานภาษีขาย/ภาษีซื้อตามแบบ RD** — `generate-vat-report` รวม output+input เป็น line list เดียว ไม่มีลำดับที่, สาขา, คอลัมน์ตามแบบ; ไม่มีรายงานสินค้าและวัตถุดิบ
- **RA-15 (บล็อก) ไม่มีไฟล์ยื่น RD e-filing ของแบบใดเลย** — filing package = raw tax events เป็น JSON/CSV/XLSX/PDF ไม่ใช่รูปแบบยื่น; `tax-2026-verified-rules.md:130` ระบุเองว่า "Export format must be confirmed per current RD portal specification" ซึ่งยังไม่เคยทำ
- **RA-16 (บล็อก — ปิดบางส่วน 2026-08-04 สำหรับบริษัทใหม่) ภ.พ.30 boxes เป็นศูนย์บนเส้นทาง default** — เส้น legacy header VAT (`sync-tax-events.use-case.ts:178`) ไม่เขียน `reportContributionsJson` ซึ่งเป็นแหล่งเดียวที่ `pp30Boxes` อ่าน (`transaction-tax-reconciliation.use-case.ts:284`) → บริษัทที่ยังไม่ตั้ง CompanyTaxCodeProfile ACTIVE + report mapping ครบ จะเห็น ภ.พ.30 = 0 ขณะที่ Tax Workspace แสดง VAT events ปกติ โดยไม่มี warning ว่าเลขสองชุดต่างกัน
  - **ปิดแล้วสำหรับบริษัทที่ onboard ใหม่**: `create-company-onboarding.use-case.ts` เรียก `bootstrapCompanyTaxConfiguration` (`tax/application/services/tax-config-bootstrap.service.ts`) ใน transaction เดียวกับผังบัญชี → บริษัทใหม่ได้ profile `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` สถานะ **ACTIVE** พร้อม Tax Code `V7`/`ND`, account determination rules (`INPUT_VAT_CLAIMABLE → 1154-00`, `NONDEDUCTIBLE_VAT_EXPENSE → 5390-02` จาก `TH_SME_COA_V1_MAPPING_MANIFEST`) และ report mapping ภ.พ.30 box 6/7 ทั้งหมดสถานะ ACTIVE → FINAL resolve ของบรรทัดภาษีซื้อขอคืนได้ไม่โยน 422 `transaction_tax_needs_review` อีก และ box 6/7 มีตัวเลขจริง
  - **ยังค้าง**: (ก) บริษัทเดิม/UAT ไม่มี backfill — ต้อง onboard ใหม่หรือตั้ง config เองผ่าน wizard; (ข) เส้น legacy header VAT ยังไม่เขียน `reportContributionsJson` ดังนั้นเอกสารที่ผ่านเส้นนั้น (ไม่ผูก Tax Code) ยังทำให้ box เป็น 0 อยู่ และยังไม่มี warning ว่าเลขสองชุดต่างกัน; (ค) **ฝั่งภาษีขายยังไม่ถูก seed** — template `WATCHDOG_TH_DOMESTIC_EXPENSE_V1` มีแต่โค้ด INPUT (`V7`/`ND`) และ `requiredReportMappings` สร้าง box 1/5 ให้เฉพาะโค้ด OUTPUT ดังนั้น box 1/2/3/5 = 0 และ box 9 (ชำระเกิน) = ภาษีซื้อทั้งจำนวน สำหรับบริษัท launch package (ซึ่งยังไม่มี `sales_documents` จึงออกใบกำกับภาษีไม่ได้อยู่แล้ว) — ต้องตัดสินใจระดับ owner ว่าจะ seed โค้ด OUTPUT, ใส่ `sales_documents` ใน package, หรือกำกับหน้า ภ.พ.30 ว่าเป็นด้านภาษีซื้อเท่านั้น
- **RA-17 (สูง) สาขาถูกตัดทิ้งจาก tax event ฝั่งขาย** — `branchCode: null` hardcode (`accounting-document-source.adapter.ts:38`) ทั้งที่ `Branch.taxBranchCode` มีใน schema → ยื่นแยกสาขาไม่ได้

### กลุ่ม D — หัก ณ ที่จ่าย (WHT)

- **RA-18 ~~(บล็อก)~~ ปิดแล้ว 2026-08-04** — `ExpenseRecord.vendorEntityKindSnapshot` (enum `BuyerEntityKind`, nullable, migration `20260804190000_expense_payee_entity_kind`) เก็บประเภทผู้รับเงินตอน review (select 2 ตัวเลือกใน `ExpenseReviewEditSection`, แสดงเมื่อมี WHT เท่านั้น) และ `sync-tax-events.use-case.ts` derive `INDIVIDUAL → PND3` / `JURISTIC → PND53`; `validateConfirm` **บล็อกการ confirm** เมื่อ `whtAmount > 0` แต่ยังไม่ระบุประเภท เพราะหลัง CONFIRMED แก้ไม่ได้ (CONFIRMED → VOIDED เท่านั้น) — ค่า null คง PND53 เป็น fallback สำหรับ**เอกสารที่ confirm ไว้ก่อนรุ่นนี้เท่านั้น** และไม่มี backfill/reclassification path (เลขผู้เสียภาษี 13 หลักแยกสองประเภทไม่ได้ จึงไม่เดา)
- **RA-19 (บล็อก — ปิดบางส่วน 2026-08-04) อัตรา WHT ถูก drop และหมวดเงินได้ใช้ free-text** — อัตราไหลจาก line แล้ว (`expense-source.adapter.ts` อ่าน `ExpenseLine.whtRate` แล้ว**แปลงจาก fraction เป็น percent** ให้ตรงหน่วยของ `WhtIncomeCategory.defaultRate` และฝั่ง AP; เอกสารที่ผสมหลายอัตราคง null ไว้ให้ review เพราะ header event ถือได้อัตราเดียว) พร้อม `grossAmount` = ผลรวม taxable ของ**บรรทัดที่หัก ณ ที่จ่ายเท่านั้น** (gross x อัตรา จึงตรงกับยอดที่หักไว้บนใบแนบ) และ `payeeSnapshot.branchCode` ใช้ `vendorBranchCodeSnapshot` แล้ว; **ยังค้าง**: ยังไม่ได้ตรวจกับแบบ RD จริง (ยังไม่มี generator ใบแนบ); `incomeCategoryCode` มาจาก expense category (free-text) → การ group ใบแนบ (payee+หมวด+อัตรา) ยังไม่ตรงแบบ; catalog อัตรา 15 แถวใน seed เป็น DRAFT และไม่ถูกใช้คำนวณที่ไหนเลย (อัตราเป็นค่าที่ผู้ใช้พิมพ์มือรายเอกสาร)
- **RA-20 (บล็อก) การจ่ายเงิน supplier ฝั่ง AP ไม่สร้าง tax event** — `SupplierPayment.whtAmount` / `VendorBill.wht*` validate แล้ว (net = gross − wht) แต่ไม่ไหลเข้า `TaxEvent`; `AccountingPaymentSourceAdapter` เป็น no-op stub → จุดที่ SME หัก ณ ที่จ่ายบ่อยสุดหายไปจากรายงานทั้งหมด — **ปิด payment seam แล้ว 2026-08-05**: `SupplierPaymentSourceAdapter` + loop ใน `sync-tax-events.use-case.ts` สร้าง WHT_PND3/53 จากการจ่ายจริง, ฐานเงินได้ derive จากอัตรา, handoff prefill หมวด/อัตราครบ, void reverse event + cancel handoff (`docs/specs/wht-settlement-capture-spec.md` §6); discovery พบเพิ่มและแก้แล้ว: posting source เคยฮาร์ดโค้ด `whtTotal:'0'` และไม่มีโค้ดไหนเขียน `WhtHandoffStatus.CANCELLED`; **ยังค้าง**: bill-carried WHT (ตั้งหนี้แล้วหัก) ยังไม่สร้าง tax event
- **RA-21 (สูง — บางส่วนตั้งใจ) ออก 50 ทวิ จากระบบไม่ได้และไม่มีฟอร์ม** — `cap.wht50bis/SYSTEM_INITIAL_ISSUE` seed เป็น CLOSED (`launch-matrix.catalog.ts:191`) → `POST tax/wht-certificates` คืน 409 พร้อมสร้าง handoff ให้ไปออกนอกระบบ ซึ่งเป็น design ที่ตั้งใจ (H4) และ**มี UI แล้ว** (`WhtHandoffPanel` ใน `AccountsPayablePages.tsx:585`, แท็บ `wht`) — ช่องว่างที่เหลือจริง: ไม่มีฟอร์ม 50 ทวิ พิมพ์ได้ (ติด RA-13), ไม่มี GET list/reprint certificate, `WhtCertificate` ขาด field statutory (หมวดเงินได้ 1–6, เงื่อนไขการหัก, ช่องลงนาม), และ handoff ถูกสร้างเฉพาะ seam supplier-payment settlement — ฝั่ง expense ยังไม่ wire (บันทึกไว้ใน H4 memory)
- **RA-22 (สูง) ฝั่งถูกหัก ณ ที่จ่าย (ขาย) ไม่ถูก track** — `WITHHELD_RECEIVABLE`/`WHT_RECEIVABLE` มีใน enum และเอกสารขายเก็บ `whtAmount` ได้ แต่ไม่มีอะไร sync → สะสมเครดิตภาษีสำหรับ CIT ไม่ได้ — **ปิดส่วน settlement+GL แล้ว 2026-08-05**: `AccountingPayment.whtAmount` + allocation share, รับชำระแยกเงินสด/ภาษีถูกหัก, posting `accounting.payment.received` เดบิต WHT receivable, void คืนทั้งสองส่วน, เลข 50 ทวิ ของลูกค้าเก็บที่ `externalReference` (`docs/specs/wht-settlement-capture-spec.md` §7); **ยังค้าง**: CIT credit report จากยอดบัญชีนี้

### กลุ่ม E — Config/ตัวตนภาษี

- **RA-23 (บล็อก) `CompanyTaxProfile` เป็น read-only** — โค้ดแอปอ้างถึงเฉพาะ `findUnique` 4 จุด (ยืนยัน grep: `tax.controller.ts:39,51`, `transaction-tax.controller.ts:40`, `create-wht-certificate.use-case.ts:65`); ไม่มี endpoint เขียน; permission `tax.profile.manage` ลงทะเบียนแล้วแต่ไม่ guard อะไร; ข้อมูล (เลขผู้เสียภาษี, สถานะจด VAT, นโยบายสาขา) มาจาก seed เท่านั้น; `Company.taxId` ก็ไม่มี endpoint แก้ → **บริษัทจริงกรอกตัวตนภาษีของตัวเองไม่ได้**
- **RA-24 (บล็อก) โมเดล config อัตรา/ปฏิทินภาษีเป็น dead code** — `TaxYearConfig`/`TaxRateConfig`/`TaxCalendarRule`/`TaxRuleSource` ไม่มีการอ้างอิงนอก generated client (ยืนยัน grep); VAT 7% มาจาก `useState('7')` ใน React (`AccountingPages.tsx:188`); `evaluateDueDate()` ไม่มี caller (ยืนยัน grep) → `TaxPeriod.dueDate` เป็น null ทุกแบบ ไม่มี deadline/การเตือน; ขัดกฎ §5 ของ `tax-2026-verified-rules.md` ("ห้าม hardcode อัตรา/กำหนดเวลา") โดยตรง
- **RA-25 (สูง) CIT ตายทั้งเส้น** — ไม่มีอะไรสร้าง `TaxPeriod` ชนิด CIT หรือเขียน `CitLedgerSummary` → `GET tax/cit-calendar` คืน `[]` ถาวร แท็บ CIT ว่างเสมอ (spec ตั้งใจจำกัดแค่ calendar+summary แต่แม้ส่วนนั้นก็ไม่ทำงาน)
- **RA-26 (สูง) โหมดไม่จด VAT ไม่ถูก enforce ตอนสร้าง event** — ไม่มีเส้นทางสร้าง VAT event ที่ตรวจ `vatRegistered` → บริษัทไม่จด VAT ที่เผลอออก TAX_INVOICE ก็เกิด output VAT event; กลไก `CompanyVatRegistration*` ตาม spec §9 ยังไม่มีใน schema
- **RA-27 (รอง) ใบกำกับภาษีอย่างย่อมีแค่ column** — `AccountingTaxInvoiceType` (FULL/ABBREVIATED) ไม่มีอะไร set/แยก logic/แสดงผล
- **RA-28 (รอง) การรวมยอดไม่แยกสกุลเงิน** — `getAccountBalances` group ตาม `accountId` อย่างเดียว → ถ้ามี line ต่างสกุลจะถูกบวกรวมโดยไม่แปลง; ไม่มี FX revaluation (ยอมรับได้ตราบที่ THB-only จริง ซึ่ง posting ก็บังคับอยู่)
- **RA-29 (สูง) การปัดเศษ VAT ฝั่งเอกสารขายใช้ float** — `accounting-totals.logic.ts` ใช้ `Math.round(v*100)/100` บน `number` ขณะที่เส้น 11B ใช้ decimal.js ถูกต้อง — ขัดกฎ decimal-safe money ของ spec

### กลุ่ม F — โมดูลที่ไม่มี

- **RA-30 (บล็อกสำหรับ "บัญชีครบวงจร") payroll ไม่มีทั้งระบบ** — ไม่มีโมดูล/โมเดล/`PND1` ใน `TaxFormType`; "payroll" เป็น keyword ที่ LINE AI ปฏิเสธ (`line-ai-classifier.logic.ts:22`) → ภ.ง.ด.1/ประกันสังคมทำไม่ได้ (ตรงกับ benchmark ที่จัดเป็น Later)
- **RA-31 (สูง) inventory ไม่มีมิติต้นทุน** — ไม่มี unit cost/valuation/COGS; `StockMovement` เป็นจำนวนอย่างเดียว; บัญชี stock/ต้นทุนขายในผังเป็นบัญชีตาย
- **RA-32 (สูง) fixed assets/ค่าเสื่อมไม่มี** — มีแต่ชื่อบัญชีในผัง; ทางเดียวคือ JV manual ซึ่งไม่มี UI (RA-04)
- **RA-33 (สูง) กระทบยอดธนาคารไม่เคยเทียบกับ GL** — "book side" เป็น statement arithmetic (`banking.logic.ts:349-367` ตั้ง book balance = opening statement balance, movement = 0) → เป็นการกระทบ statement↔เอกสารต้นทาง ไม่ใช่ statement↔บัญชีแยกประเภท
- **RA-34 (รอง) AR aging เป็น list แบน** — ไม่มี bucket และตกหล่น `TAX_INVOICE`/`DEBIT_NOTE`/`BILLING_NOTE` (`report-source-adapters.ts:354-401`); ฝั่ง AP ทำถูกแล้ว (bucket ครบ) แต่ statement of account hardcode `openingBalance: '0'`

## 5. จุดแข็งที่ยืนยันจากการตรวจ (ฐานที่ต่อยอดได้)

- **ภ.พ.30 box math ของจริง** — `aggregatePp30Boxes` คำนวณ box 1–9 ถูกต้อง พร้อม report mapping รายบริษัทแบบ effective-dated
- **ภ.พ.36 ครบที่สุดในระบบ** — reverse charge (V3/V4), payment-evidence gating, input claim แยก use case
- **ขอบเขตกฎหมายของเอกสารเข้มงวด** — RECEIPT/INVOICE ธรรมดาห้ามถือ Tax Code, ใบลดหนี้/เพิ่มหนี้ต้องอ้างต้นฉบับที่ issue แล้ว, กัน correction ซ้อน correction, เลขรันแบบ reserve→commit
- **Reversal เป็น net-zero ที่ถูกต้อง** — ต้นฉบับคง POSTED, กัน double-reversal ที่ DB unique, void ผูก transaction เดียวกับต้นทางและ fail-closed เมื่องวดปิด
- **Gate ปิดงวด 10 ข้อ + filing lifecycle ซื่อสัตย์** — `markFiled` ต้องผ่าน EXPORTED + ไม่มี BLOCKING issue + reconciliation REVIEWED + staleness check; ไม่มีการอ้างว่ายื่นกับ RD ให้
- **ผังบัญชีไทย SME 175 บัญชี bootstrap อัตโนมัติ** พร้อม checksum, preview/conflict-review/apply และ fail-closed เมื่อ readiness ไม่ผ่าน
- **VAT ซื้อมี evidence gating** — non-claimable กลายเป็น review issue ไม่ใช่หายเงียบ
- **H4 WHT handoff** — เมื่อออก 50 ทวิ เองไม่ได้ ระบบสร้าง prefilled handoff + ผูกกลับ พร้อม AP panel (ซื่อสัตย์กว่า 409 เปล่า)

## 6. ข้อควรระวังในการอ่านสถานะโปรเจค

- Checklist `[x] 11` (Thai Tax MVP) หมายถึง MVP สโคปเดิมเท่านั้น — `thai-tax-mvp-plan.md` ฉบับ v5.1 (rewrite 2026-07-31) เช็คแล้วเพียง 3/122 งาน; สโคปใหม่ (filing-scope partitions, PP30 credit mechanics, delayed input VAT, ป.ป.01/02, ใบแทน) ยังไม่ได้สร้างทั้งหมด
- ทุกความสามารถอยู่หลัง entitlement แบบ deny-by-default (`double_entry_ledger`, `thai_tax`, `reports`, `expense_auto_post`) — บน UAT ทั้ง 7 บริษัทยังปิดอยู่ ณ 2026-08-03
- H4 (WHT handoff) commit แล้วแต่**ยังไม่ deploy**; migration drift `20260728120000` ยังเป็น deploy gate ของทุก lane
- `finance-accounting-gaps-spec.md` มี P1 ที่ทีมยืนยันแล้วและยังเปิดอยู่: GAP-01 (role presets ใช้ไม่ได้), GAP-07 (expense จ่ายแล้ว block ปิดงวดถาวร), GAP-02 Phase 4 (close ยังไม่เช็ค reimbursement)

## 7. ลำดับงานแนะนำก่อนใช้กับบริษัทจริง

1. **Phase A — ปลดล็อกการลงบัญชี**: RA-01 (PostingRule CRUD หรือยกเลิกการบังคับสำหรับ default), RA-02 (แก้ default codes ให้ตรงผัง + mapping หมวด→บัญชี), RA-03 (ปุ่ม post ฝั่งขาย), RA-04 (UI JV manual) + ปิด GAP-01, GAP-07, GAP-02 Phase 4
2. **Phase B — งบถูกต้อง**: RA-06/RA-07 (ยอดสะสม + BS ดุล), RA-08 (ยอดยกมา), RA-09/GAP-05 (ปิดปี + retained earnings)
3. **Phase C — เอกสารตามกฎหมาย**: เปลี่ยน PDF renderer ให้ฝัง font ไทย (จุดคานงัด — ปลดล็อกทั้ง RA-13/RA-21), เพิ่มที่อยู่/สาขาผู้ซื้อใน snapshot, template ใบกำกับภาษี + 50 ทวิ, รายงานภาษีขาย/ซื้อตามแบบ RD (RA-14)
4. **Phase D — WHT + ตัวตนภาษี**: ~~RA-18 (derive PND3/53 จากประเภทผู้รับ)~~ ปิด 2026-08-04, RA-19 (เหลือ income category + catalog อัตรา), RA-20 (AP → tax event), RA-23 (write path ของ tax profile), RA-24 (อัตรา/ปฏิทินจาก config)
5. **Phase E — ยื่นจริง**: ไฟล์ e-filing ตามแบบ RD (RA-15), แก้ ภ.พ.30 legacy path หรือบังคับ wizard (RA-16), สาขา (RA-17), ส่วนที่เหลือกลุ่ม F ตามลำดับธุรกิจ

## 8. วิธีตรวจและข้อจำกัด

- ตรวจโดย code survey 3 เลนขนาน (accounting core/ledger, tax modules, cross-check เอกสาร) บน tree `544bdd25` วันที่ 2026-08-03; ไม่ได้รันระบบ ไม่ได้แก้โค้ด
- Claim ที่มีน้ำหนักสูงถูกยืนยันซ้ำด้วย grep 15 รายการ ได้แก่: การไม่มี writer ของ `postingRule`, PND53 hardcode, `companyTaxProfile` findUnique-only, `useState('7')`, `export_not_implemented`, Helvetica PDF, default codes 1210-00/5310-01, caller ของ `requiresReviewedPostingRules`, dead tax-config models, `evaluateDueDate` ไม่มี caller, `whtRate: null`, `branchCode: null`, และการมีอยู่จริงของ `WhtHandoffPanel` ใน web
- ผลสำรวจรอบแรกมีหนึ่งข้อที่คลาดเคลื่อนและถูกแก้แล้วในเอกสารนี้: UI ของ WHT handoff **มีจริง** (แท็บ `wht` ใน AccountsPayablePages) — ข้อความ "ไม่มี UI ทั้งหมด" จึงจำกัดเฉพาะฝั่ง certificate list/reprint
- เลขบรรทัดจะ drift ตามการแก้โค้ด — ใช้ชื่อ symbol/ไฟล์เป็นหลัก
