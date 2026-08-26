# แผนพัฒนารวม: สมุดรายรับ–รายจ่าย + ซื้อ–จ่ายเงิน (FlowAccount parity ทั้งสองฝั่ง — P27+P28)

สถานะ: **ACTIVE — รวมสองแผนเป็นฉบับเดียวตามคำสั่ง Owner 2026-08-26**; ภาค 1 (ขาย–รับเงิน): Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ merge แล้ว → คิวถัดไป **Phase 3**; ภาค 2 (ซื้อ–จ่าย): เริ่มหลังภาค 1 จบ — รอ Owner ตอบ [P2P spec §10](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) ข้อ 2–5 (ข้อ 1 เรื่องคิว ตอบแล้ว 2026-08-26: P28 ต่อจาก P27 ทันที, สาย billing ท้ายคิวสุด)

Spec (ยังแยกสองฉบับตามฝั่ง — แผนนี้ไม่ประกาศข้อเท็จจริงใหม่):

- ภาค 1: [Income–Expense Ledger Spec](../specs/mangmee-income-expense-ledger-spec-th.md)
- ภาค 2: [Purchase-to-Pay MVP Spec](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) (engine canonical: [procurement-supplier-ap-spec](../specs/procurement-supplier-ap-spec.md))

ตำแหน่งในแผนหลัก: [แผนหลัก 2.5 วัน](mangmee-brain-2-5-day-priority-plan-th.md) **P27 → P28** — หัวขบวนสาย "โตต่อได้" (Owner 2026-08-26: P27 → P28 → P13 → P15–P17 → P18–P24 → billing P14→P26 ท้ายสุด)

## 0. คำตอบตรง ๆ เรื่องเวลา (dev 1 คน รวม test ไม่รวมรอ UAT/ผู้ใช้จริง)

| Phase | ภาค | เนื้องาน | ประเมิน |
|---|---|---|---|
| 0 | 1 ขาย–รับเงิน | ยืนยันสัญญา V1–V6 | ~~0.5 วัน~~ ✅ **เสร็จ 2026-08-26** |
| 1 | 1 | การเงินถูกก่อน (LED-FIN-01 + paymentNumber) | ~~1 วัน~~ ✅ **merge แล้ว (PR #247)** |
| 2 | 1 | หมวดรายรับ (model→API→UI→bootstrap) | ~~1.5 วัน~~ ✅ **merge แล้ว 2026-08-26** |
| 3 | 1 | บันทึกรายรับ 2 โหมด (bundle) + ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount | 3 วัน |
| 4 | 1 | หน้าสมุด + export | 2 วัน |
| 5 | 1 | จัดระเบียบฝั่งรายจ่าย + ทางเข้า | 0.5 วัน |
| 6 | 1 | เปิดระบบ: entitlement/nav/gate/E2E/หลักฐาน | 1.5 วัน |
| 7 | 2 ซื้อ–จ่าย | ยืนยันสัญญา W1–W5 | 0.5 วัน |
| 8 | 2 | SupplierCreditNote engine (model→settle→tax→GL→maker-checker) | 3 วัน |
| 9 | 2 | หน้าจอ S4 (CN) + S2 ปรับ (source-first + checklist ภาษาคน) | 2 วัน |
| 10 | 2 | S1 landing + S3 อนุมัติ/จ่ายรวมหลายบิล | 2 วัน |
| 11 | 2 | รวมฝั่งซื้อเข้าสมุด (F-P2P-4) + S5 (aging/statement เพิ่มเครดิตค้าง) | 1.5 วัน |
| 12 | 2 | เปิดระบบฝั่งซื้อ: nav คืน + entitlement/gate + E2E P2P-01..05 + หลักฐาน | 1.5 วัน |
| รวม | | | **~20 วันทำงาน** (ทำไปแล้ว ~3 วัน เหลือ ~17); ตัวเลือก Owner: +ใบเพิ่มหนี้ฝั่งซื้อ ~1 วัน, +two-step release ~1.5 วัน |

ทางลัดที่ตัดได้โดยไม่เสียหลักการ (Owner เลือก ไม่ตัดเอง): (ก) เลื่อน XLSX เหลือ CSV ก่อน (−0.5), (ข) เลื่อนหน้า "จัดการหมวดรายรับ" ไปหลังเปิด (−0.5), (ค) เลื่อน S1 landing ฝั่งซื้อไปหลังเปิด ใช้ hub เดิมก่อน (−1), (ง) เลื่อนจ่ายรวมหลายบิล จ่ายทีละใบก่อน (−0.5)

## 1. กติกาการทำงาน (ใช้ทั้งสองภาค)

- ponytail full mode: shortest correct diff, reuse pattern เดิม, ไม่มี dependency ใหม่ (กราฟ = CSS bar; XLSX = `xlsx.logic.ts` เดิม)
- ทุก phase จบด้วย: (1) รายการไฟล์ที่แตะ (2) คำสั่ง verify + ผล (3) อัปเดต task memory ([ภาค 1](../agent-memory/mangmee-income-expense-ledger.md) / [ภาค 2](../agent-memory/mangmee-purchase-to-pay.md))
- Branch ละ phase หรือรวม 2 phase ติดกัน → PR เข้า `develop`; ห้ามแตะ `package.json` นอกกติกา
- ทุก spec file ใหม่ของ apps/api ต้องลงทะเบียนใน `scripts.test` (มี spec-suite-coverage guard จับอยู่)
- Migration: เพิ่มอย่างเดียว (additive) ตาม spec; รัน dry-run บน clone ก่อนตาม protocol เดิม
- ภาค 2 เพิ่ม: ห้ามแตะ `updateVendorBillPaid` dead code; อัปเดต spec-coverage matrix ในแผนหลักเมื่อ spec เปลี่ยนสถานะ

---

# ภาค 1 — สมุดรายรับ–รายจ่าย (ฝั่งขาย–รับเงิน, เดิม P27)

## Phase 0 — ยืนยันสัญญา 6 ข้อ ✅ **เสร็จ 2026-08-26** (ผลเต็มอยู่ใน spec §F-LED-1/§F-LED-6)

| # | ผลตรวจ (สรุป) |
|---|---|
| V1 | `counterpartyId` nullable ทั้ง schema/DTO/use-case (`schema.prisma:1751`, `accounting-money.dtos.ts:49`); **ไม่มี unique กันชื่อซ้ำ** → ตัดสิน: ไม่สร้าง row "ลูกค้าเงินสด" อัตโนมัติ, เอกสาร+payment ใช้ null คู่กัน (กติกา match `accounting-money-validation.logic.ts:95-96`) |
| V2 | purpose ฝั่ง accounting **ไม่มี** — gate กลางรับเฉพาะ `expense.record` (`attachment.logic.ts:24-32`) → Phase 3 ขยาย allow-list แบบ additive (spec M6) |
| V3 | `RECEIPT` + `sourceDocumentId` **ทำได้** (ตรวจ existence+branch แล้ว persist; กฎชนิดเอกสารไม่ block — `accounting-status.logic.ts:59-62`); ไม่มี auto-receipt เดิมในระบบ; `taxInvoiceId` เป็น dead metadata ไม่มี write path |
| V4 | truth = `VatRegistrationStatus` ผ่าน `vatRegistration.get(companyId, civilDate)` (`expense-draft.use-case.ts:701`) + กติกา `deriveExpenseCaptureMode` (`expense-capture-policy.logic.ts:28-32`) |
| V5 | `PUT /v1/system/partners/:id/features` (`system.partner_feature.manage`, CAS `expectedSetVersion`, normalization gate); off/on/off มี test พิสูจน์แล้ว (`set-partner-features.use-case.spec.ts:1322`) |
| V6 | chain use-case เดิม**ไม่ได้** (tx แยกคนละใบ + reserve เลขนอก tx) → ใช้ repository bundle ตามแบบ `submitDraftAtomic` + `reserveNumberInTransaction`/`commitNumberInTransaction` (spec §F-LED-1) |

## Phase 1 — การเงินถูกก่อน (LED-FIN-01, LED-FIN-02, M3) ✅ **merge แล้ว (PR #247; specs module 144/144)**

1. แปลง `accounting-totals.logic.ts` → `decimal.js` (`ROUND_HALF_UP` 2dp) นโยบายเดียวกับ `expense-totals.logic.ts`; อินพุต/เอาต์พุต contract คงเดิม (string/number → string 2dp)
2. Golden spec ใหม่ `accounting-totals.golden.spec.ts`: เคสจาก spec §7 — VAT_INCLUDED/EXCLUDED/NO_VAT/EXEMPT, ค่าตกขอบ .005, discount, WHT, multi-line, เทียบผล float เดิมเพื่อบันทึกว่าเคสไหนเปลี่ยน (ต้องไม่มีเคสที่ผู้ใช้จริงมีเอกสารอยู่ — ยืนยันด้วย query บน seeded DB)
3. `createPayment` ตั้ง `paymentNumber` จาก sequence `accounting.payment` (reserve→commit ใน tx เดียวกัน) + backfill = ไม่ทำ (payment เก่าไม่มีเลข — แสดง "—")
4. Verify: unit ทั้ง module accounting-documents + ledger ผ่าน; `pnpm --filter api typecheck`

## Phase 2 — หมวดรายรับ (spec F-LED-2, M1, M2) ✅ **merge แล้ว 2026-08-26 (model+bootstrap+API+web ครบ; รายละเอียดใน task memory)**

1. Migration `RevenueCategory` + `AccountingDocumentLine.revenueCategoryId` (+index) — additive
2. Contracts: `packages/contracts/src/accounting-documents.ts` เพิ่ม type หมวด + input field (optional — ไม่ break caller เดิม)
3. Bootstrap service 6 หมวด default (idempotent ต่อบริษัท, กระจก `expense-category-bootstrap.service.ts`) + เรียกจาก onboarding + คำสั่ง backfill บริษัทเดิม
4. Permission `accounting.revenue_category.manage` ใน registry + grants (role เดียวกับ `expense.category.manage`)
5. API: controller `companies/:companyId/revenue-categories` (GET/GET manage/POST/PATCH — โครงจาก `expense.controller.ts:515-547`); ไม่มี DELETE
6. `CreateDocument/UpdateDocument` รับ `revenueCategoryId` ต่อบรรทัด → validate ACTIVE + company → เขียน FK + snapshot ชื่อลง `revenueCategory` ตอน issue
7. Web: `CategoryManagePanel` ฝั่งรายรับ (reuse โครง component เดิม) ใต้ route sales-documents
8. Tests: unit bootstrap idempotent, CRUD+perm negative, snapshot-on-issue, spec ลงทะเบียนครบ

## Phase 3 — บันทึกรายรับ + ใบลดหนี้/เพิ่มหนี้ (spec F-LED-1, F-LED-6) ← **คิวถัดไป**

1. Repository bundle method ใหม่ `recordSimpleIncomeBundle` (ดีไซน์สรุปใน spec §F-LED-1 ตามผล V6): tx เดียว Serializable + advisory lock — dedup `idempotencyKey` → INVOICE+lines → เลขเอกสารใน tx (`reserveNumberInTransaction`/`commitNumberInTransaction`) → issue (+tax snapshot ผ่าน db param สำหรับบริษัท VAT) → payment RECEIVED + allocation → auto-RECEIPT (`sourceDocumentId` = INVOICE ที่เพิ่ง issue, ผล V3) → audit ผ่าน tx; `RecordSimpleIncomeUseCase` เป็นชั้น permission/validation หุ้ม
2. Endpoint ใหม่ `POST companies/:companyId/accounting/simple-income` — permission ประกอบจากของเดิม (`accounting.invoice.create` + `accounting.invoice.issue` + `accounting.payment.create` + `accounting.receipt.issue`); ผู้ไม่มีสิทธิ์ issue → สร้างได้แค่ draft พร้อมข้อความบอกขั้นถัดไป
3. โหมด "ออกบิลไว้ก่อน": ฟอร์มเดียวกัน จบที่ issue INVOICE/BILLING_NOTE (reuse use-case เดิมทั้งหมด — งานคือ UI); UI ลูกค้าไม่บังคับ แสดง label "ลูกค้าทั่วไป (ขายเงินสด)" เมื่อว่าง (ผล V1 — ไม่สร้าง counterparty row)
4. **ใบลดหนี้/เพิ่มหนี้แบบ FlowAccount (Owner ข้อ 4)**: ขยาย source rule ให้ CN/DN อ้าง `INVOICE` ที่ issue แล้วได้ (แก้ `accounting-status.logic.ts:103-109` + tests), migration M5 (`adjustmentReasonCode/Text`), UI สาเหตุบังคับ (รายการสาเหตุตรวจกับต้นทางกรมสรรพากรก่อน copy — เทียบ `tax-2026-verified-rules.md`), prefill มูลค่าเดิม/ที่ถูกต้อง/ผลต่างจาก source; ไม่ทำ CN แบบไม่อ้างเอกสาร
5. Web หน้า "บันทึกรายรับ" ตามสเปกหน้าจอ **spec §F-LED-7 S1 ทุกข้อ** (theme เดิม, 2 ปุ่มใหญ่ ≥56px, action-gating 7.2: ปุ่มที่กดไม่สำเร็จต้องไม่มีอยู่ — ซ่อนตามสิทธิ์/disabled+เหตุผลใต้ปุ่ม, sticky แถบสรุปเงิน, สำเร็จ replace→สมุด+highlight) + **VAT ต่อบรรทัด default จากหมวด (spec §7.9)**: หมวด O7/OX/O0 → pre-select, หมวดไม่กำหนด → บรรทัดบังคับเลือกก่อนยืนยัน, ซ่อนทั้งหมดเมื่อบริษัทไม่จด VAT (V4)
6. **V7 (เพิ่มจากรอบสอง)**: พิสูจน์ mixed-rate invoice ผ่าน engine จริง (บรรทัด 7% + บรรทัด 0/ยกเว้นในใบเดียว): create→issue→totals→payment ถูกทุกชั้น + `deriveCompatibleOutputTaxCode`/`validateOutputTaxDocument` ยอมรับ — ถ้า engine ติด ให้บันทึกและเสนอทางแก้ก่อนทำ UI
7. Tests: unit idempotent-retry/partial-failure-rollback/perm-split, contract DTO, golden "issue→pay→receipt posting ครั้งเดียว" (ยืนยัน invariant spec §7.2), golden "หมวด OX ไม่สร้าง VAT" (เคสผัก — spec §7.9), CN อ้าง INVOICE + เพดานลดหนี้สะสม + เหตุผลบังคับ

## Phase 4 — หน้าสมุด + export (spec F-LED-4)

1. API สรุป `GET companies/:companyId/income-expense-ledger/summary?from&to` — คืน 6 ตัวเลข + by-category สองฝั่ง + นิยาม period ที่ใช้ (echo กลับเพื่อพิสูจน์ convention); bounded walk + self-check ตาม guardrails `accounting.get_summary`; permission อ่านสองฝั่งแยกส่วน (มีฝั่งเดียวได้ฝั่งเดียว)
2. API รายการ `GET .../entries?type&categoryId&status&from&to` — union มุมมอง (เอกสารขาย / expense) แบบแบ่งหน้า พร้อม ref ไปหลักฐานต้นทาง
3. Export CSV+XLSX: builder ใหม่ตาม `expense-export.logic.ts` pattern + `safeCsvCell` + `buildXlsx`; ปุ่มเดียวโหลดจาก base64-in-JSON (pattern accountant package); permission `accounting.document.export` + `expense.export` ตามฝั่งที่รวม
4. Web หน้า "สมุดรายรับ–รายจ่าย" ตามสเปกหน้าจอ **spec §F-LED-7 S3 ทุกข้อ** (ลำดับ 6 ส่วนบน→ล่าง, การ์ด 2×3 บนมือถือ, self-check ไม่ผ่าน = "—" ห้ามโชว์ตัวเลขผิด, บริษัทไม่เปิดฝั่งขายเห็น "เร็ว ๆ นี้" ไม่ใช่ 0.00 หลอก, แท็บรอรับเงิน+รับชำระตาม S2); filter เดือน/ประเภท/หมวด/สถานะ; ห้ามคำ "กำไร/ยอดเงินคงเหลือ" (มี lint คำต้องห้ามใน spec ของหน้า)
5. Dashboard: เพิ่มการ์ดลิงก์เข้าสมุด (ไม่เพิ่ม provider ใหม่รอบนี้ — ตัวเลขอยู่ในหน้าสมุด)
5b. แถบเตือนใกล้เกณฑ์จด VAT 1.8 ล้าน (spec §7.9 ข้อ 6 — ถ้า Owner ไม่ตัด): เฉพาะบริษัทไม่จด VAT, 80%/100% ของยอดขายสะสมปีปฏิทิน, ข้อความแนะนำปรึกษานักบัญชี ไม่ block; ใช้ตัวเลขก้อนเดียวกับการ์ดสมุด (ไม่มี query ใหม่)
6. Tests: unit นิยามตัวเลข 6 ก้อน (golden dataset ที่มี void/credit note/partial/WHT/ข้ามเดือน), self-check mismatch → unavailable, export = หน้าจอ, perm ฝั่งเดียว, timezone ขอบวัน (เคสเที่ยงคืน Bangkok)

หมายเหตุคิวรวม: นิยาม "จ่ายแล้ว/รอจ่าย" ของสมุดออกแบบให้รับแหล่งที่สอง (SupplierPayment) ได้ใน Phase 11 โดยแก้ที่ API สมุดจุดเดียว — ไม่ต้อง refactor หน้า

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

---

# ภาค 2 — ซื้อและจ่ายเงิน แบบ FlowAccount + ใบลดหนี้ฝั่งซื้อ (เดิม P28)

เริ่มเมื่อภาค 1 จบ (Owner ยืนยันคิว 2026-08-26) และ Owner ตอบ [P2P spec §10](../specs/mangmee-purchase-to-pay-mvp-spec-th.md) ข้อ 2–5 แล้ว

## Phase 7 — ยืนยันสัญญา (W1–W5) ก่อนเขียนโค้ด

| # | ต้องยืนยัน | วิธี |
|---|---|---|
| W1 | `resolveSourceTaxInTransaction(..., 'INPUT', 'procurement')` รับ context `RETURN_OR_CREDIT` + sign ลบได้จริง (ฝั่งขายใช้ผ่าน accounting-documents — ฝั่ง procurement ยังไม่เคยเรียก) | อ่าน resolver + ทดลอง unit กับ fixture บิลจริง |
| W2 | `SyncTaxEventsUseCase` จะเห็นบรรทัด CN อย่างไร — ผ่าน adapter เดิม (บิล CREDITED) หรือ CN ต้องมี adapter แหล่งใหม่ | อ่าน `expense-source.adapter.ts:86-119` + ตัดสิน schema CN lines |
| W3 | posting source ของ CN: reuse `buildPostingKey`/posting-source pattern บิลด้วย sign ได้ไหม | อ่าน posting-source บิล + ledger journal path |
| W4 | ~~สมุด P27 จะเสร็จก่อนหรือหลัง~~ **ตอบแล้วโดยคิวรวม**: Phase 4 (ภาค 1) มาก่อน Phase 11 เสมอ — เหลือแค่ยืนยัน ณ วันเริ่มว่า API สมุดที่ส่งมอบจริงตรงตามหมายเหตุคิวรวมท้าย Phase 4 | เทียบของจริงตอนเริ่ม Phase 11 |
| W5 | เลข seq `procurement.supplier_credit_note` + purpose ไฟล์แนบใหม่ (`procurement.credit_note.evidence`) ไม่ชนกติกา attachment gate (M6 ภาค 1) | อ่าน document-sequence defaults + attachment.logic |

ผล Phase 7 → อัปเดต P2P spec §5/§8 ด้วยคำตอบ (แก้ spec ก่อน ไม่ workaround)

## Phase 8 — SupplierCreditNote engine (spec F-P2P-2)

1. Migration: model + enums + `@@unique([companyId, supplierId, supplierDocumentNumber])` + seq default `PCN-{YYYY}{MM}-{SEQ}`
2. Repository bundle: create draft (+lines+tax DRAFT snapshot) / submit / approve (CAS + checksum pin + dual quota — reuse ตัวช่วย maker-checker เดิม) / apply (settle path ใหม่: ลด outstanding ก่อน → เครดิตค้าง `unappliedAmount`; สถานะบิล → `CREDITED` เมื่อปิดพอดี) / void (ก่อน apply เท่านั้น)
3. Tax: FINAL snapshot ตอน approve (context `RETURN_OR_CREDIT`, sign −1, refuse PP36/IMPORT_SERVICE), งวดล็อก → refuse; sync เข้าทางเดิม (ผล W2)
4. GL: posting source + journal reversal สัดส่วน (ผล W3)
5. Controller `companies/:companyId/accounts-payable/supplier-credit-notes` + permissions ใหม่ (`procurement.supplier_credit_note.read/create/approve/void` — grant กลุ่มเดียวกับ vendor_bill)
6. Tests: transition table, settle ทุกเคส P2P spec §8.1–8.2 (partial/paid/เพดานสะสม/satang), maker-checker mirror, tax refuse cases, idempotent number+dedupe — ลงทะเบียนครบ

## Phase 9 — หน้าจอ CN + บิล (S4 + S2)

1. S4 ตาม P2P spec §7 เป๊ะ: ปุ่มจากหน้าบิล (ตาม matrix สิทธิ์+สถานะ), prefill แก้ไม่ได้, สาเหตุบังคับ, แถบผล "ลดยอดค้าง/เครดิตค้าง" ก่อนกด, disabled+เหตุผล
2. S2: แปลง checklist `buildTaxReviewIssues` เป็นภาษาคนตามตาราง copy ใน spec, source-first เลือก PO/GR, ปุ่มส่งอนุมัติบอกชื่อกลุ่มผู้อนุมัติ
3. Web unit: gating logic + copy; E2E แท่ง CN (P2P-03/04)

## Phase 10 — S1 landing + S3 จ่ายเงิน

1. S1 การ์ดงานค้าง (query จาก endpoint list เดิม + aging — ไม่มี endpoint ใหม่ถ้าไม่จำเป็น; ถ้าต้องมี summary endpoint ให้ใช้ pattern bounded aggregate เดียวกับ `aggregateDocumentsByType` ของภาค 1)
2. S3: กล่องรออนุมัติ + จ่ายรวมหลายบิล (UI บน allocation engine เดิม) + สถานะ 1/2 อนุมัติ
3. nav ภายในหน้า "ซื้อและจ่ายเงิน" → hub เดิมสำหรับ PO/GR/supplier (ไม่ rewrite hub ในรอบนี้)

## Phase 11 — รวมฝั่งซื้อเข้าสมุด + รายงาน (F-P2P-4, S5)

1. API สมุด: "จ่ายแล้ว" += SupplierPayment(RECORDED).netPaid; การ์ดใหม่ "รอจ่าย (บิลผู้ขาย)"; ป้ายแหล่งที่มา; อัปเดตตาราง F-LED-4 ใน spec ภาค 1 พร้อม PR เดียวกัน
2. S5: aging + statement เพิ่มเครดิตค้าง; แถว CN ในสมุด (ยอดลบ+เหตุผล)
3. Golden: ตัวเลขสมุดสองแหล่ง reconcile + drill ครบ

## Phase 12 — เปิดระบบฝั่งซื้อ + หลักฐาน

1. คืน `procurement`/`accounts-payable` เข้า `DESIGN_HANDOFF_NAV_ORDER` (เฉพาะ entitlement เปิด — ตรรกะ nav เดิมจัดการอยู่แล้ว) + เพิ่ม submenu `procurement.wht_handoff`
2. Kill switch: บังคับ gate `procurement/DEFAULT` ที่ root สร้าง PR/PO/GR/บิล/CN (pattern `assertExpenseRootOpen` + Thai copy + DENIED audit)
3. เปิด allowlist ผ่าน partner features (CAS/normalization ตาม V5 ภาค 1)
4. E2E P2P-01..05 เข้า project critical + รัน suite ที่แตะทั้งหมด + evidence (SHA/ผลรัน/นิยามตัวเลข) + usability 40+ 3 คน (ต้องมนุษย์)

---

## 2. Test matrix รวม

| ชั้น | ครอบ | ไฟล์/ที่อยู่ |
|---|---|---|
| Unit domain | totals decimal golden, สถานะ/สิทธิ์, bootstrap idempotent, นิยามตัวเลขสมุด, snapshot หมวด; ภาค 2: CN transition/settle/เพดานสะสม/satang | apps/api modules accounting-documents / ledger / procurement |
| Unit use-case | RecordSimpleIncome idempotent/rollback/perm-split, category CRUD, export builder; ภาค 2: CN maker-checker mirror + tax refuse | เดียวกัน |
| Contract | DTO ใหม่ทุกตัว + optional field ไม่ break เดิม | packages/contracts spec |
| Golden การเงิน | issue→pay→receipt posting ครั้งเดียว; paid+outstanding=grand; void reversal สุทธิศูนย์; CN ลดยอดสมุด; ภาค 2: `paid + outstanding + creditedApplied = grandTotal` + สมุดสองแหล่ง reconcile | apps/api golden specs |
| E2E @smoke | LED-01..05 + P2P-01..05 | `e2e/income-expense-ledger.spec.ts` + `e2e/purchase-to-pay.spec.ts` |
| Manual gate | ผู้ใช้ 40+ 3 คน ต่อภาค + คำต้องห้าม + mobile 390px | บันทึกใน task memory + manifest |

## 3. ความเสี่ยงและทางถอย

- **LED-FIN-01 เปลี่ยนยอดเอกสารเดิม**: เกณฑ์หยุด — ถ้า golden เทียบ float พบเคสที่มีเอกสารจริงใน DB ยอดเปลี่ยน ให้หยุดและออกแบบ migration ก่อน (Phase 1 ปิดแล้วโดยไม่พบเคส — feature ปิดอยู่ทั้งระบบ)
- **Bundle ซับซ้อนกว่าคาด**: V6 ยืนยันความเป็นไปได้แล้ว (pattern `submitDraftAtomic` + เลขเอกสารใน tx มีผู้ใช้จริง 2 module) แต่ถ้าระหว่างทำพบปัญหา isolation/lock → ทางถอย = จบที่ INVOICE PAID แล้วให้ปุ่ม "ออกใบเสร็จ" ชัด ๆ ในหน้า success (ยังตรง invariant ทุกข้อ เสียแค่หนึ่งคลิก)
- **Entitlement บริษัทเก่าติด normalization gate (ผล V5)**: คำสั่ง set features จะถูกปฏิเสธ `company_entitlement_normalization_pending` จนกว่า normalization จะ COMPLETED — ตรวจสถานะบริษัท allowlist ก่อนวันเปิด
- **W1/W2 ไม่ผ่าน** (resolver/sync ไม่รองรับฝั่งซื้อ sign ลบ): ทางถอย = tax event ผ่าน adapter แหล่งใหม่เฉพาะ CN (pattern `tax.pp36_input_claim` ที่เขียน event ตรงแบบ idempotent) — ช้าลง ~1 วัน ไม่เปลี่ยน UX
- **เครดิตค้างสับสนผู้ใช้**: MVP โชว์เฉพาะใน statement + aging พร้อมคำอธิบาย; ไม่มี auto-หัก จนพฤติกรรมจริงชัด
- Kill switch พร้อมเสมอ: CLOSE `sales_documents/DEFAULT` (ภาค 1) / `procurement/DEFAULT` (ภาค 2) → หยุดรับงานใหม่ทั้งฟีเจอร์ภายใน 15 นาทีตามกติกา P3

## 4. สิ่งที่แผนนี้ไม่สัญญา

- ไม่สัญญาความเร็ว AI/สมองมั่งมีเพิ่ม (family `sales.get_sales_summary` เดิมได้ประโยชน์ทางอ้อมจากข้อมูลที่เข้ามากขึ้นเท่านั้น)
- ไม่แตะสาย billing P14→P26 — คนละสาย และ Owner โยกไปท้ายคิวสุดแล้ว (2026-08-26)
- ภาค 2 ไม่ย้อนแก้งานภาค 1 ยกเว้น Phase 11 ที่ขยาย API สมุดตามที่ระบุ
- ไม่เปิด production จนกว่า Gate ของ spec แต่ละภาคผ่านครบ (ภาค 1 §8 / ภาค 2 §9) และ Owner สั่ง GO ตาม release protocol
