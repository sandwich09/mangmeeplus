# แผนพัฒนา สมุดรายรับ–รายจ่าย (Income–Expense Ledger MVP)

สถานะ: **ACTIVE — Phase 0–2 ✅; Phase 3A backend ✅; Phase 3B UI core ✅ 2026-08-27; Phase 3 ยังมี LED-FIN-07 รอ Owner ตัดสินเรื่องร่าง VAT ไม่ชัด; Phase 4A backend ✅, Phase 4B ledger/payment/export UI core ✅ และ Phase 4C แถบเตือน VAT 1.8 ล้าน ✅ 2026-08-27; Phase 6 ยังเหลือ**; P27 เป็นหัวขบวนสาย "โตต่อได้" (Owner 2026-08-26: P27 → P28 → …; สาย billing P14→P26 ท้ายคิวสุด)

Spec: [Income–Expense Ledger Spec](../specs/mangmee-income-expense-ledger-spec-th.md) — ทุก phase อ้าง requirement/หลักฐานจาก spec; แผนนี้ไม่ประกาศข้อเท็จจริงใหม่

ตำแหน่งในแผนหลัก: [แผนหลัก 2.5 วัน](mangmee-brain-2-5-day-priority-plan-th.md) **P27** — ทำก่อนสาย Bank/Auto Revenue (P15–P22); คิวรวมสองฝั่งดูที่ [สารบัญแผนรวมมั่งมีพลัส](mangmee-master-plan-index-th.md) (ภาค 1 = แผนนี้)

## 0. คำตอบตรง ๆ เรื่องเวลา

นี่ไม่ใช่งาน 2.5 วัน ประเมินแบบ dev 1 คน (รวมเขียน test ตามข้อบังคับ ไม่รวมรอ UAT/ผู้ใช้จริง):

| Phase | เนื้องาน | ประเมิน |
|---|---|---|
| 0 | ยืนยันสัญญา 6 ข้อ | ~~0.5 วัน~~ **เสร็จแล้ว 2026-08-26** |
| 1 | การเงินถูกก่อน (LED-FIN-01 + paymentNumber) | ~~1 วัน~~ ✅ **merge แล้ว (PR #247)** |
| 2 | หมวดรายรับ (model→API→UI→bootstrap) | ~~1.5 วัน~~ ✅ **merge แล้ว 2026-08-26** |
| 3 | บันทึกรายรับ 2 โหมด (bundle) + ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount | 3 วัน |
| 4 | หน้าสมุด + export | 2 วัน |
| 5 | จัดระเบียบฝั่งรายจ่าย + ทางเข้า | 0.5 วัน |
| 6 | เปิดระบบ: entitlement/nav/gate/E2E/หลักฐาน | 1.5 วัน |
| รวม | | **~9.5 วันทำงาน** (CN/DN เข้าขอบเขตแล้วตามคำตอบ Owner ข้อ 4) |

ตัดให้เร็วขึ้นได้ 2 จุดโดยไม่เสียหลักการ: (ก) เลื่อน XLSX เหลือ CSV ก่อน (−0.5 วัน), (ข) เลื่อนหน้า "จัดการหมวดรายรับ" ไปหลังเปิด (ใช้ 6 หมวด default ไปก่อน, −0.5 วัน) — ทั้งคู่ต้องให้ Owner เลือก ไม่ตัดเอง

## 1. กติกาการทำงาน

- ponytail full mode: shortest correct diff, reuse pattern เดิม, ไม่มี dependency ใหม่ (กราฟ = CSS bar; XLSX = `xlsx.logic.ts` เดิม)
- ทุก phase จบด้วย: (1) รายการไฟล์ที่แตะ (2) คำสั่ง verify + ผล (3) อัปเดต [task memory](../agent-memory/mangmee-income-expense-ledger.md)
- Branch ละ phase หรือรวม 2 phase ติดกัน → PR เข้า `develop`; ห้ามแตะ `package.json` นอกกติกา
- ทุก spec file ใหม่ของ apps/api ต้องลงทะเบียนใน `scripts.test` (มี spec-suite-coverage guard จับอยู่)
- Migration: เพิ่มอย่างเดียวตาม spec §6; รัน dry-run บน clone ก่อนตาม protocol เดิม

## Phase 0 — ยืนยันสัญญา 6 ข้อ ✅ **เสร็จ 2026-08-26** (ผลเต็มอยู่ใน spec §F-LED-1/§F-LED-6)

| # | ผลตรวจ (สรุป) |
|---|---|
| V1 | `counterpartyId` nullable ทั้ง schema/DTO/use-case (`schema.prisma:1751`, `accounting-money.dtos.ts:49`); **ไม่มี unique กันชื่อซ้ำ** → ตัดสิน: ไม่สร้าง row "ลูกค้าเงินสด" อัตโนมัติ, เอกสาร+payment ใช้ null คู่กัน (กติกา match `accounting-money-validation.logic.ts:95-96`) |
| V2 | purpose ฝั่ง accounting **ไม่มี** — gate กลางรับเฉพาะ `expense.record` (`attachment.logic.ts:24-32`) → Phase 3 ขยาย allow-list แบบ additive (spec M6) |
| V3 | `RECEIPT` + `sourceDocumentId` **ทำได้** (ตรวจ existence+branch แล้ว persist; กฎชนิดเอกสารไม่ block — `accounting-status.logic.ts:59-62`); ไม่มี auto-receipt เดิมในระบบ; `taxInvoiceId` เป็น dead metadata ไม่มี write path |
| V4 | truth = `VatRegistrationStatus` ผ่าน `vatRegistration.get(companyId, civilDate)` (`expense-draft.use-case.ts:701`) + กติกา `deriveExpenseCaptureMode` (`expense-capture-policy.logic.ts:28-32`) |
| V5 | `PUT /v1/system/partners/:id/features` (`system.partner_feature.manage`, CAS `expectedSetVersion`, normalization gate); off/on/off มี test พิสูจน์แล้ว (`set-partner-features.use-case.spec.ts:1322`) |
| V6 | chain use-case เดิม**ไม่ได้** (tx แยกคนละใบ + reserve เลขนอก tx) → ใช้ repository bundle ตามแบบ `submitDraftAtomic` + `reserveNumberInTransaction`/`commitNumberInTransaction` (spec §F-LED-1) |

## Phase 1 — การเงินถูกก่อน (LED-FIN-01, LED-FIN-02, M3)

1. แปลง `accounting-totals.logic.ts` → `decimal.js` (`ROUND_HALF_UP` 2dp) นโยบายเดียวกับ `expense-totals.logic.ts`; อินพุต/เอาต์พุต contract คงเดิม (string/number → string 2dp)
2. Golden spec ใหม่ `accounting-totals.golden.spec.ts`: เคสจาก spec §7 — VAT_INCLUDED/EXCLUDED/NO_VAT/EXEMPT, ค่าตกขอบ .005, discount, WHT, multi-line, เทียบผล float เดิมเพื่อบันทึกว่าเคสไหนเปลี่ยน (ต้องไม่มีเคสที่ผู้ใช้จริงมีเอกสารอยู่ — ยืนยันด้วย query บน seeded DB)
3. `createPayment` ตั้ง `paymentNumber` จาก sequence `accounting.payment` (reserve→commit ใน tx เดียวกัน) + backfill = ไม่ทำ (payment เก่าไม่มีเลข — แสดง "—")
4. Verify: unit ทั้ง module accounting-documents + ledger ผ่าน; `pnpm --filter api typecheck`

## Phase 2 — หมวดรายรับ (spec F-LED-2, M1, M2)

1. Migration `RevenueCategory` + `AccountingDocumentLine.revenueCategoryId` (+index) — additive
2. Contracts: `packages/contracts/src/accounting-documents.ts` เพิ่ม type หมวด + input field (optional — ไม่ break caller เดิม)
3. Bootstrap service 6 หมวด default (idempotent ต่อบริษัท, กระจก `expense-category-bootstrap.service.ts`) + เรียกจาก onboarding + คำสั่ง backfill บริษัทเดิม
4. Permission `accounting.revenue_category.manage` ใน registry + grants (role เดียวกับ `expense.category.manage`)
5. API: controller `companies/:companyId/revenue-categories` (GET/GET manage/POST/PATCH — โครงจาก `expense.controller.ts:515-547`); ไม่มี DELETE
6. `CreateDocument/UpdateDocument` รับ `revenueCategoryId` ต่อบรรทัด → validate ACTIVE + company → เขียน FK + snapshot ชื่อลง `revenueCategory` ตอน issue
7. Web: `CategoryManagePanel` ฝั่งรายรับ (reuse โครง component เดิม) ใต้ route sales-documents
8. Tests: unit bootstrap idempotent, CRUD+perm negative, snapshot-on-issue, spec ลงทะเบียนครบ

## Phase 3 — บันทึกรายรับ + ใบลดหนี้/เพิ่มหนี้ (spec F-LED-1, F-LED-6)

สถานะ 2026-08-27: **3A backend ✅ + 3B UI core ✅** — ฟอร์มสองโหมด, source-first correction, VAT/permission gating, branch scope และไฟล์แนบทำงานจริง; **ยังไม่ปิด Phase 3 เต็ม** เพราะ LED-FIN-07: engine ไม่มี durable state สำหรับร่างที่ VAT ยังไม่ชัดตามคำสัญญาเดิม

1. ✅ Repository `recordSimpleIncomeBundle`: Serializable + advisory lock + bounded retry ของ serialization conflict; dedup ผ่าน M7 command+fingerprint → INVOICE → payment/allocation → auto-RECEIPT → audit ใน tx; receipt เป็น evidence-only ไม่ลง settlement ซ้ำ
2. ✅ Endpoint `POST companies/:companyId/accounting/simple-income` — use-case บังคับ permission ครบ (`accounting.invoice.create` + `accounting.invoice.issue` + `accounting.payment.create` + `accounting.receipt.issue`); draft-only เป็น flow UI ข้อ 3 ไม่เรียก endpoint นี้
3. ✅ โหมด "ออกบิลไว้ก่อน": ฟอร์มเดียวกัน create draft → issue INVOICE; ผู้มี create แต่ไม่มี issue ได้ร่างพร้อมข้อความส่งต่อผู้ยืนยัน; ลูกค้าไม่บังคับและไม่สร้าง counterparty row
4. ✅ CN/DN source-first: อ้าง issued TAX_INVOICE หรือ issued INVOICE เฉพาะ non-VAT; UI prefill เอกสาร/มูลค่าเดิม, บังคับเหตุผล, คำนวณผลต่าง, แสดงเพดาน และปิดปุ่มพร้อมเหตุผลจนข้อมูลครบ
5. ✅ Web หน้า "บันทึกรายรับ" ตาม §F-LED-7 S1 ส่วนที่ contract รองรับ: 2 ปุ่มใหญ่, action-gating ตาม permission+VAT read, VAT ต่อบรรทัดจากหมวด O7/OX/O0/null, รวม/ไม่รวม VAT ต้องเลือกเอง, branch จาก workspace, WHT, ไฟล์แนบ PDF/JPG/PNG และ partial-failure recovery; กล่องสรุปอยู่หลังฟอร์มไม่ sticky เพราะ browser QA 390×844 พิสูจน์ว่าแบบ sticky บังช่องกรอก
6. ✅ **V7**: real PostgreSQL พิสูจน์บรรทัด 7% + 0% → invoice 207.00 → payment 207.00 → receipt 207.00; tax validator ยอม mixed line truth โดย header compatibility code เป็น undefined ตามตั้งใจ (ข้อจำกัด OX/O0 semantic ยังอยู่ LED-FIN-06)
7. Tests: unit idempotent-retry/partial-failure-rollback/perm-split, contract DTO, golden "issue→pay→receipt posting ครั้งเดียว" (ยืนยัน invariant spec §7.2), golden "หมวด OX ไม่สร้าง VAT" (เคสผัก — spec §7.9), CN อ้าง INVOICE + เพดานลดหนี้สะสม + เหตุผลบังคับ
8. ⏸️ **LED-FIN-07 (ต้องตอบก่อนทำ)**: schema/contract/DTO จริงไม่มี `AccountingVatMode.NEEDS_REVIEW`; Phase 3B จึง fail closed และคง input ในหน้า ห้าม issue/atomic income เมื่อ VAT บริษัทหรือรายบรรทัดยังไม่ชัด การทำ "บันทึกร่างไว้ก่อน" ต้องเลือก durable contract ใหม่ (เช่น review state แยกจาก vatMode หรือ enum+posting semantics) และวาง migration/reader compatibility ก่อน ห้ามใช้ `NO_VAT` แทน

หลักฐาน Phase 3B รอบปิด PR: web full 1100/1100, contracts 196/196, API full pretest+test exit 0, focused API 114/114 และ consolidated boundary/spec-coverage 22/22; contracts/web/API typecheck, Prisma validate และ diff check ผ่าน. Browser local 1280×900 + 390×844 พิสูจน์ `0.0300 × 68.50 = 2.06`, ออก `INV-202608-00028`, รับชำระจน `PAID`, สร้างพร้อมแนบหลักฐานและออก `CN-202608-00001`; DB ยืนยัน create idempotency key + active `AttachmentLink(accounting.document, accounting.document.supporting)` ที่ branch ตรง target; fresh console ไม่มี error/warn. ภาพและ manifest: [`docs/qa/evidence/p27-phase3b-2026-08-27/`](../qa/evidence/p27-phase3b-2026-08-27/README.md)

## Phase 4 — หน้าสมุด + export (spec F-LED-4)

สถานะ 2026-08-27: **Phase 4A + 4B core ✅** — summary/entries/export, 6 cards, category chart, filters, dashboard entry, receivable sort, receive-payment modal และ mobile cards ทำงานจริง; **Phase 4C ยังเหลือข้อ 5b** (คำเตือน VAT 1.8 ล้าน) จึงยังไม่ปิด Phase 4 ทั้งก้อน

1. API สรุป `GET companies/:companyId/income-expense-ledger/summary?from&to` — คืน 6 ตัวเลข + by-category สองฝั่ง + นิยาม period ที่ใช้ (echo กลับเพื่อพิสูจน์ convention); bounded walk + self-check ตาม guardrails `accounting.get_summary`; permission อ่านสองฝั่งแยกส่วน (มีฝั่งเดียวได้ฝั่งเดียว)
2. API รายการ `GET .../entries?type&categoryId&status&from&to` — union มุมมอง (เอกสารขาย / expense) แบบแบ่งหน้า พร้อม ref ไปหลักฐานต้นทาง
3. Export CSV+XLSX: builder ใหม่ตาม `expense-export.logic.ts` pattern + `safeCsvCell` + `buildXlsx`; ปุ่มเดียวโหลดจาก base64-in-JSON (pattern accountant package); permission `accounting.document.export` + `expense.export` ตามฝั่งที่รวม
4. Web หน้า "สมุดรายรับ–รายจ่าย" ตามสเปกหน้าจอ **spec §F-LED-7 S3 ทุกข้อ** (ลำดับ 6 ส่วนบน→ล่าง, การ์ด 2×3 บนมือถือ, self-check ไม่ผ่าน = "—" ห้ามโชว์ตัวเลขผิด, บริษัทไม่เปิดฝั่งขายเห็น "เร็ว ๆ นี้" ไม่ใช่ 0.00 หลอก, แท็บรอรับเงิน+รับชำระตาม S2); filter เดือน/ประเภท/หมวด/สถานะ; ห้ามคำ "กำไร/ยอดเงินคงเหลือ" (มี lint คำต้องห้ามใน spec ของหน้า)
5. Dashboard: เพิ่มการ์ดลิงก์เข้าสมุด (ไม่เพิ่ม provider ใหม่รอบนี้ — ตัวเลขอยู่ในหน้าสมุด)
5b. แถบเตือนใกล้เกณฑ์จด VAT 1.8 ล้าน (Owner สั่งทำ 2026-08-27; spec §7.9 ข้อ 6): เฉพาะ VAT fact `NOT_REGISTERED`, 80%/100% ของยอดขายสุทธิตามเอกสารตั้งแต่ต้นรอบบัญชี (`CompanyTaxProfile.accountingPeriodMonth`) ถึงวันนี้, ข้อความแนะนำปรึกษานักบัญชี ไม่ block + link กรมสรรพากร; revenue root คือ `INVOICE/BILLING_NOTE/DEBIT_NOTE` + source-less `TAX_INVOICE`, หัก `CREDIT_NOTE`, linked `TAX_INVOICE` ไม่นับซ้ำแต่ correction ยังปรับยอด; aggregate เพิ่มใน summary transactionเพราะยอดเดือนที่เลือกใช้แทนยอดรอบบัญชีไม่ได้; ต้องมี `accounting.document.read` + `company.vat_registration.read` + `tax.profile.read` และ company-wide scope; ไม่มีสิทธิ์/period config/สถานะไม่ชัด/request จำกัดสาขาไม่เรียก accessor และไม่คืนคำเตือน เพื่อไม่รั่ว VAT status/รอบบัญชีหรือทำ partial total เป็นยอดบริษัท
6. Tests: unit นิยามตัวเลข 6 ก้อน (golden dataset ที่มี void/credit note/partial/WHT/ข้ามเดือน), self-check mismatch → unavailable, export = หน้าจอ, perm ฝั่งเดียว, timezone ขอบวัน (เคสเที่ยงคืน Bangkok)

 หลักฐาน Phase 4B: real PostgreSQL 9/9 (ไม่ skip) รวม payment retry/concurrency/mixed VAT/ledger-export; web full 1109/1109, API full exit 0, contracts 196/196, API/web typecheck, Prisma validate และ diff check ผ่าน. Chrome local 1280×900 + 390×844: เปิดจาก dashboard, กรองรายการ, export 79 แถว, รับชำระ `INV-202608-00026` 500 บาทแล้วหายจาก receivable และยอดสรุปเปลี่ยน, mobile modal ใช้งานได้, console error/warn = 0. Browser QA พบและแก้ gap เพิ่ม: CREDIT_NOTE เคยเข้า receivable/ขึ้น "รอรับ"; ตอนนี้คงเป็นยอดปรับลดติดลบในสมุดแต่ไม่มี outstanding/payment action พร้อม PostgreSQL regression. ภาพและ manifest: [`docs/qa/evidence/p27-phase4b-2026-08-27/`](../qa/evidence/p27-phase4b-2026-08-27/README.md)

 หลักฐาน Phase 4C: official-source review + boundary `1,439,999.99/1,440,000.00/1,799,999.99/1,800,000.00/>1,800,000`, accounting-period config, standalone/linked `TAX_INVOICE` dedup, correction/credit subtraction, VOIDED exclusion, permission/VAT status/scope fail-closed และ accessor-outage fallback; domain 22/22, web logic 9/9, real PostgreSQL 9/9 (0 skip), contracts/API/web typecheck ผ่าน. Chrome local 1280×900 + 390×844 ทดสอบ APPROACHING และ REACHEDจริง, console error/warn = 0, คืนข้อมูล seedแล้ว. ภาพและ manifest: [`docs/qa/evidence/p27-phase4c-vat-threshold-2026-08-27/`](../qa/evidence/p27-phase4c-vat-threshold-2026-08-27/README.md)

## Phase 5 — จัดระเบียบฝั่งรายจ่าย (spec F-LED-3, LED-FIN-03)

1. แก้ default หมวดซ้อน: ทำ global dev-seed ให้เท่ากับ `TH_SME_EXPENSE_CATEGORIES_V1` หรือ archive แถว global ใน env ที่บริษัท bootstrap แล้ว — เลือกทางที่ diff เล็กสุดหลังดูผลต่อ AI `activeCategories` + golden category suggestion เดิม (ห้ามทำ accuracy baseline เสีย)
2. ทางเข้า "บันทึกรายจ่าย" จากหน้าสมุด → `expenses/upload` / `expenses/manual`
3. Tests: picker ไม่มีชื่อซ้ำบน seeded env; golden category ยังผ่าน

## Phase 6 — เปิดระบบ + หลักฐาน (spec F-LED-5, §8)

1. บังคับ launch gate `sales_documents/DEFAULT` ที่ root สร้างเอกสาร + `RecordSimpleIncome` (pattern `assertExpenseRootOpen` + Thai copy + DENIED audit); พิสูจน์ CLOSE → BLOCK_NEW_ROOT แต่ดู/รับชำระเดิมได้
2. Nav: เพิ่ม "สมุดรายรับ–รายจ่าย" + ปลด `salesdoc` → "ขายและรับเงิน" ตาม entitlement; บริษัทไม่เปิด → เห็นสมุดฝั่งจ่าย + ป้าย ไม่เจอ 403
3. เปิด entitlement ให้บริษัท allowlist ผ่าน `PUT /v1/system/partners/:id/features` (V5 — CAS `expectedSetVersion`, ระวัง normalization gate ของบริษัทเก่า) + ยืนยัน off/on/off บนบริษัททดสอบ (มี unit พิสูจน์แล้วที่ `set-partner-features.use-case.spec.ts:1322` — ทำซ้ำเชิง E2E หนึ่งรอบ)
4. E2E @smoke ใหม่ (project `critical`): LED-01 ขายสดจบเดียว→สมุดอัปเดต+ใบเสร็จมีจริง; LED-02 ออกบิล→รับชำระ→รอรับเงินลด; LED-03 หมวดรายรับ manage+ARCHIVED ไม่โผล่ picker; LED-04 export ได้ไฟล์+ยอดตรง; LED-05 perm negative
5. รัน `e2e:critical` เต็มชุด + unit ทุก package ที่แตะ + evidence ลง manifest (SHA, ผลรัน, นิยามตัวเลข)
6. Usability ผู้ใช้ 40+ ≥3 คน ตาม gate spec §8 (ต้องมนุษย์ — นัดผ่าน Owner)
7. UAT ตาม protocol `docs/runbooks/uat-production-v2-deployment.md` เมื่อรอบ release ถัดไปเปิด

## 2. Test matrix รวม

| ชั้น | ครอบ | ไฟล์/ที่อยู่ |
|---|---|---|
| Unit domain | totals decimal golden, สถานะ/สิทธิ์, bootstrap idempotent, นิยามตัวเลขสมุด, snapshot หมวด | apps/api modules accounting-documents / ledger / ใหม่ income-expense-ledger |
| Unit use-case | RecordSimpleIncome idempotent/rollback/perm-split, category CRUD, export builder | เดียวกัน |
| Contract | DTO ใหม่ทุกตัว + optional field ไม่ break เดิม | packages/contracts spec |
| Golden การเงิน | issue→pay→receipt posting ครั้งเดียว; paid+outstanding=grand; void reversal สุทธิศูนย์; CN ลดยอดสมุด | apps/api golden specs |
| E2E @smoke | LED-01..05 ข้างต้น | `e2e/income-expense-ledger.spec.ts` |
| Manual gate | ผู้ใช้ 40+ 3 คน + คำต้องห้าม + mobile 390px | บันทึกใน task memory + manifest |

## 3. ความเสี่ยงและทางถอย

- **LED-FIN-01 เปลี่ยนยอดเอกสารเดิม**: เกณฑ์หยุด — ถ้า golden เทียบ float พบเคสที่มีเอกสารจริงใน DB ยอดเปลี่ยน ให้หยุดและออกแบบ migration/afterthought ก่อน (คาดว่าไม่มีเพราะ feature ปิดอยู่ทั้งระบบ — ยืนยันด้วย count เอกสารใน Phase 1)
- **Bundle ซับซ้อนกว่าคาด**: V6 ยืนยันความเป็นไปได้แล้ว (pattern `submitDraftAtomic` + เลขเอกสารใน tx มีผู้ใช้จริง 2 module) แต่ถ้าระหว่างทำพบปัญหา isolation/lock → ทางถอย = จบที่ INVOICE PAID แล้วให้ปุ่ม "ออกใบเสร็จ" ชัด ๆ ในหน้า success (ยังตรง invariant ทุกข้อ เสียแค่หนึ่งคลิก)
- **Entitlement บริษัทเก่าติด normalization gate (ผล V5)**: คำสั่ง set features จะถูกปฏิเสธ `company_entitlement_normalization_pending` จนกว่า normalization จะ COMPLETED — ตรวจสถานะบริษัท allowlist ก่อนวันเปิด
- Kill switch พร้อมเสมอ: CLOSE `sales_documents/DEFAULT` → หยุดรับงานใหม่ทั้งฟีเจอร์ภายใน 15 นาทีตามกติกา P3

## 4. สิ่งที่แผนนี้ไม่สัญญา

- ไม่สัญญาความเร็ว AI/สมองมั่งมีเพิ่ม (family `sales.get_sales_summary` เดิมได้ประโยชน์ทางอ้อมจากข้อมูลที่เข้ามากขึ้นเท่านั้น)
- ไม่แตะ P26 billing meter — คนละสาย
- ไม่เปิด production จนกว่า Gate §8 ของ spec ผ่านครบและ Owner สั่ง GO ตาม release protocol
