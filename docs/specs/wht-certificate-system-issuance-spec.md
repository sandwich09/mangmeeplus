# WHT Certificate System Issuance Spec — ออกหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ในระบบ ครั้งแรก

2026-10-04: confirmed withholding expenses retain “พิมพ์เอกสาร 50 ทวิ” across visits when entitlement, permission and server route capability allow. Issued certificates retain re-download/correction (`GET /companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate`, read/issue/correct permission, latest certificate, same number, no new issue/replacement); no withholding means no action. Reopen cancels required direct and tax-event handoffs and supersedes all active expense tax events (legacy VAT, finalized line contributions and WHT); confirmation rebuilds the direct handoff from corrected facts with the same id and clears an operator address belonging to the old payee. Direct issuance/external linking rechecks the confirmed source under the correction lock. Tax-workspace issuance and external fallback creation also recheck the confirmed expense and current active event hashes. Handoff status checks and certificate creation are in the same transaction, so a losing issuance leaves no certificate. Issued/external certificates block reopening. Catalog matches payee type (individual ภ.ง.ด.3, juristic ภ.ง.ด.53); changes clear incompatible categories. Mangmee manages the catalog; empty applicable lists direct users to the Mangmee team.

## Print-format correction (2026-09-23)

The system PDF must print on the Revenue Department's published 50 ทวิ form, with Thai text confined to its payer, payee, tax ID, filing type, income, amount, and signature fields. The PDF must not expose serialized address JSON, overlap form labels or adjacent columns, or substitute a visually different blank page. The Revenue Department source is https://rd.go.th/fileadmin/tax_pdf/withhold/approve_wh3_081156.pdf. A replacement copy retains its number and shows ใบแทน. The payer signature stays blank unless the company chose automatic signature. The same renderer applies to initial issuance, correction, and replacement.

Status: DRAFT (docs-first, ยังไม่ implement)
Owner: Finance/Accounting lane
Related (cross-reference เท่านั้น, ไม่แก้ไขไฟล์เหล่านี้):
`docs/specs/wht-settlement-capture-spec.md` (AP payment WHT capture — ฝั่งจ่าย, ที่มาของ `SupplierPayment.whtCategoryCode/whtRate`),
`docs/specs/feature-entitlement-decoupling-spec.md` (§ WHT/`cap.wht50bis` — เจ้าของ launch-gate/command-registry design เต็มรูปแบบ),
`docs/agent-memory/wht-durable-prefilled-handoff.md` (H4 — สร้าง `WhtCertificateHandoff`, ตั้งใจ scope out expense-side ไว้ให้ slice นี้),
`docs/specs/tax-thailand-2026-spec.md` (คำตัดสิน owner 2026-06-23: สามเส้นทาง SYSTEM_INITIAL_ISSUE/SYSTEM_CONTENT_CORRECTION/SYSTEM_REPLACEMENT_COPY)
Baseline discovery: 2026-09-22 บน `main` (f9894656)

## 1. ปัญหา

ระบบบันทึกหัก ณ ที่จ่ายได้แล้วในสองจุด (AP payment ผ่าน wht-settlement-capture-spec ที่ deploy แล้ว, และ Expenses ที่ capture `whtAmount`/`vendorEntityKindSnapshot` มาตั้งแต่ก่อนหน้า) แต่ทั้งสองจุด **ไม่มีทางออกหนังสือรับรอง 50 ทวิ จากในระบบเองได้เลย** วันนี้:

- ฝั่ง AP: แท็บ "หนังสือรับรองหัก ณ ที่จ่าย" (`WhtHandoffPanel`, [AccountsPayablePages.tsx:893](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) มีแค่ปุ่ม "ดูข้อมูลสำหรับออกเอกสาร" ([:941](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) ที่เปิด panel ให้คัดลอกข้อมูลไปออกเองข้างนอก แล้วกลับมา "แนบเอกสาร" ที่ออกภายนอกแล้ว ([:1112](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — ไม่มีปุ่ม "ออกเอกสารในระบบ" เลย
- ฝั่ง Expenses: ไม่มี `WhtCertificate`/`WhtCertificateHandoff` ถูกสร้างเลยตอน "ยืนยันเอกสาร" ([ExpenseReviewPage.tsx:923](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) แม้จะบังคับกรอก "ประเภทผู้รับเงิน (หัก ณ ที่จ่าย)" ก่อนยืนยันแล้ว ([expense-status.logic.ts:321](../../apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts)) — ช่องว่างนี้ถูกบันทึกไว้แล้วว่าตั้งใจ scope out จาก H4 (`wht-durable-prefilled-handoff.md` OQ-2)

เหตุผลที่ SYSTEM issuance ปิดอยู่ (`cap.wht50bis/SYSTEM_INITIAL_ISSUE`, `routeClass: SPECIALIST_LEGAL`, seed CLOSED — [launch-matrix.catalog.ts:190-198](../../apps/api/src/modules/feature-launch/domain/launch-matrix.catalog.ts)) **ไม่ใช่ข้อจำกัดทางกฎหมาย** แต่เป็นเพราะ (a) PDF export วันนี้เป็น ASCII text stream ล้วน (`buildMinimalPdf`, [tax-export.logic.ts:65-87](../../apps/api/src/modules/tax/domain/logic/tax-export.logic.ts)) ที่ **render ภาษาไทยไม่ได้เลย** (BaseFont Helvetica มาตรฐาน ไม่มี glyph ไทย ไม่มี embedded font/encoding), (b) ยังไม่มี correction/replacement command history ที่ durable, (c) ยังไม่ผ่านการรีวิวโดยนักบัญชี/ผู้เชี่ยวชาญภาษีกับ golden fixture จริง ตามที่ระบุไว้ใน feature-entitlement-decoupling-spec.md บรรทัด 11 ("official Thai golden fixtures and real accountant/statutory acceptance pass")

สิ่งที่คู่แข่ง (FlowAccount, PEAK) ทำได้อยู่แล้วและ owner ยืนยันแล้วว่าไม่มีข้อกำหนดพิเศษ: ออก PDF 50 ทวิ จากข้อมูลการจ่ายที่ยืนยันแล้วโดยตรง ไม่มีขั้นตอนภายนอก ไม่ต้องเซ็นดิจิทัลแบบพิเศษ ไม่มี serial-numbering scheme ที่ RD ควบคุม (เล่มที่/เลขที่เป็นเลขเอกสารภายในบริษัทเอง)

## 2. เป้าหมาย (v1)

1. เปิดปุ่ม "ออกเอกสารในระบบ" ที่จุดยืนยันทั้งสองจุด (AP WHT tab, Expenses ยืนยันเอกสาร) เมื่อ `cap.wht50bis/SYSTEM_INITIAL_ISSUE` OPEN — ออกได้ทันทีไม่ต้องออกไปข้างนอกก่อน
2. PDF ที่ออกต้องตรงกับแบบฟอร์ม 50 ทวิ ตัวจริงตามกฎหมาย (ฟิลด์ครบ อ่านภาษาไทยได้ ไม่ใช่ text stub)
3. คงทางเลือก EXTERNAL-issue-then-attach เดิมไว้คู่กัน ไม่ถอดออก — ผู้ใช้ที่ยังอยากออกเองข้างนอกยังทำได้เหมือนเดิมทุกจุด
4. Permission/entitlement model ของ**ปุ่ม "ออกเอกสารในระบบ" เท่านั้น** (ไม่ใช่ data-capture fields หรือ EXTERNAL-issue-then-attach flow) ต้อง**ผูก** กับ entitlement เดียวกับที่เปิดชุดฟีเจอร์ภาษีไทยของ `ENTERPRISE_1999` (`featureEntitlementKey: 'thai_tax'` — ยืนยันจาก `TIER_FEATURE_PRESETS`/`FEATURE_PACKAGE_PRESETS.full` ว่า `ENTERPRISE_1999` เป็น tier เดียวที่ featureKeys มี `thai_tax`; STARTER_249/BASIC_499/PRO_999 ใช้ `starter` preset ที่ไม่มี `thai_tax` เลย, [menu-entitlements.ts:442-495](../../packages/contracts/src/menu-entitlements.ts)) — **นี่คือ owner decision วันที่ 2026-09-22** (follow-up chat message, คำต่อคำ: _"ทวิ 50 ปุ่มกดออกเอกสาร ต้องเป็น pack ENTERPRISE เท่านั้น, pack อื่นจะเป็น เก็บข้อมูลแต่ไม่มีปุ่มกดออกเอกสาร"_) ที่**กลับคำ**จากที่เขียนไว้เดิมในบรรทัดนี้ (เดิมอ้าง feature-entitlement-decoupling-spec.md บรรทัด 331 ว่า "thai_tax and Tax-workspace issue permission are not required" สำหรับ SYSTEM initial issuance) — บรรทัด 331 ของไฟล์นั้นและจุดยืนของ mangmee-package-entitlements-spec-th.md ที่วาง 50 ทวิ/ภ.ง.ด.53 เป็น "feature readiness lock แยกจาก billing tier" ยังคง**ไม่ได้ถูกแก้ไข** (นอกสโคปงานนี้) — เป็นข้อขัดแย้งที่บันทึกไว้ให้ผู้ดูแล billing/entitlement docs ทราบแยกต่างหาก ไม่ใช่ความผิดพลาด (ดู §7, §8, §12 finding 9, §13)

## 3. Scope และ Non-goals

**ในสโคป (v1):**

- `cap.wht50bis/SYSTEM_INITIAL_ISSUE` เท่านั้น — ออกครั้งแรกจากการยืนยันจ่าย/ยืนยันเอกสารครั้งเดียว
- สองจุดเข้า: AP payment WHT tab, Expenses confirm
- Data model ต่อยอดจาก `WhtCertificate`/`WhtCertificateHandoff` ที่มีอยู่แล้ว (ดู §5) — ไม่ redesign
- PDF template จริงตามแบบ 50 ทวิ (ดู §6)
- Permission ใหม่แคบ ๆ หนึ่งตัวถ้าจำเป็น (ดู §7)
- ปิดช่องว่าง prefill ที่ทำให้ออกไม่ได้จริง เช่น Expenses ไม่มี WHT income category (ดู §12 finding 8b) และ payer branch code เป็น null เสมอ (ดู §12 finding 6)

**Non-goals (บันทึกไว้ ไม่ทำรอบนี้):**

- `SYSTEM_CONTENT_CORRECTION` / `SYSTEM_REPLACEMENT_COPY` (ใบแทน) — ยังปิดต่อไป ไม่แตะ; งานนี้เป็นของ CC5-scoped lane ตาม `WhtCertificateCommand`/`WhtCommandRegistry`/`artifactOrigin` design ใน feature-entitlement-decoupling-spec.md
- e-Withholding Tax bank-integration (ยื่นตรงผ่านธนาคาร/RD API) — ไอเดียแยกที่ owner ระบุว่าใหญ่กว่านี้มาก deferred ไปทั้งหมด ไม่ออกแบบใน spec นี้
- Number-namespace merge ระหว่าง SYSTEM กับ EXTERNAL ให้เป็น atomic registry เดียวกัน (feature-entitlement-decoupling-spec.md บรรทัด 238) — เป็น design ที่บันทึกไว้แล้วแต่ยังไม่ได้ build (ดู §12 finding 2); v1 ไม่ทำ ไม่ทำให้แย่ลงกว่าที่เป็นอยู่ แต่ต้องไม่อ้างว่าทำแล้ว
- แก้ estate-wide ABAC เรื่อง branch authorization (H4 flagged ไว้แล้วว่าเป็นคำถามระดับบริษัท ไม่ใช่ของ feature เดียว) — v1 แค่เติม branch **tax code** ที่หายไปในการพิมพ์ (bug fix, ไม่ใช่ authorization boundary ใหม่)
- Correction/void ของ SYSTEM-issued certificate — เดินตาม void-guard เดิมที่ block ไว้แล้ว (`wht_certificate_linked_requires_review`) ไม่ต้องมี flow แก้ไข/ยกเลิกใหม่ใน v1
- Bill-carried WHT (ตั้งหนี้แบบหักไว้แล้ว) — นอกสโคปเดิมของ wht-settlement-capture-spec อยู่แล้ว ไม่แตะ

## 4. ผู้ใช้และ journey (สองจุดเข้า)

### 4.1 Accounts Payable — "บันทึกจ่ายเจ้าหนี้" → แท็บ "หนังสือรับรองหัก ณ ที่จ่าย"

UI ปัจจุบัน (ยืนยันจาก source):

- ฟอร์ม `<summary>บันทึกจ่ายเจ้าหนี้</summary>` ([:678](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) มี fieldset `<legend>หัก ณ ที่จ่าย</legend>` ([:690](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — กรอกหมวด/อัตรา/ยอดหักตาม wht-settlement-capture-spec §6.7 ที่ deploy แล้ว
- แท็บแยก `wht: 'หนังสือรับรองหัก ณ ที่จ่าย'` ([:875](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) แสดง banner "ระบบจะออกหนังสือรับรองหัก ณ ที่จ่ายให้ภายนอก แล้วแนบเข้ามาได้..." ([:912](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — ต่อรายการมีปุ่มสลับ "ดูข้อมูลสำหรับออกเอกสาร"/"ปิด" ([:941](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) เปิด `WhtHandoffDetail` ที่แสดงข้อมูล payer/payee ครบและมีฟอร์ม "แนบหนังสือรับรองที่ออกภายนอกแล้ว" ปุ่ม "แนบเอกสาร" ([:1085-1112](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx))

การเปลี่ยนแปลง v1: เมื่อทั้งสอง gate ผ่าน — (1) route-readiness gate `cap.wht50bis/SYSTEM_INITIAL_ISSUE` OPEN และ (2) บริษัทมี entitlement `thai_tax` (ENTERPRISE_1999 — owner decision 2026-09-22, ดู §8) — และ handoff อยู่สถานะ `REQUIRED` เติมปุ่มที่สามใน `WhtHandoffDetail` — "ออกเอกสารในระบบ" คู่กับฟอร์ม "แนบเอกสาร" เดิม (ทั้งสองทางเลือกอยู่บนหน้าเดียวกัน ผู้ใช้เลือกทางใดทางหนึ่ง) เมื่อกดแล้วสถานะ handoff ไป `SYSTEM_ISSUED` (enum มีอยู่แล้ว, label ไทย "ระบบออกให้แล้ว" มีอยู่แล้ว [:889](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) พร้อม PDF ให้ดาวน์โหลด

**หมายเหตุแก้ไข (พบระหว่างเขียน plan, ดู `docs/plans/wht-certificate-system-issuance-plan.md` §4.1):** `WhtHandoffDetail` วันนี้เช็คแค่ `const linked = handoff.status === 'EXTERNAL_LINKED'` ([AccountsPayablePages.tsx:980](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — ไม่มี branch สำหรับ `SYSTEM_ISSUED` เลยวันนี้ (เพราะยังไม่มีอะไรเขียนค่านั้น) ถ้าไม่แก้ แถวที่ระบบออกให้แล้วจะยังโชว์ฟอร์ม "แนบเอกสารที่ออกภายนอก" อยู่ผิด ๆ นี่คือ**การแก้ไข UI ที่จำเป็น ไม่ใช่แค่การเพิ่มปุ่มใหม่เข้าไปเฉย ๆ**

### 4.2 Expenses — หน้าตรวจสอบ → "ยืนยันเอกสาร"

**UI follow-up 2026-10-04:** the first review step uses one withholding block after the line
list, beginning with ไม่หัก / หัก. Selecting หัก reveals payee type, income category and
rate/amount together before any positive rate is entered. Positive withholding still requires
both classifications under the existing `validateConfirm` rules. Blank rate/amount or ไม่หัก
sends explicit zero and clears withholding metadata/errors. Empty, loading and failed category
lists are explained separately, including for read-only viewers. See
[expense withholding input spec](expense-wht-input-units-mixed-vat-spec.md#review-interaction-2026-10-04).
The print button, AP print heading/button and stale-state notice reuse the workspace dictionary's
“พิมพ์เอกสาร 50 ทวิ” wording. Catalog activation and issuance gates are unchanged.

UI ก่อนเปลี่ยนแปลง v1 (ยืนยันจาก source):

- Dropdown บังคับ "ประเภทผู้รับเงิน (หัก ณ ที่จ่าย)" (`t('expenses.payee_entity_kind')`) ต่อเมื่อ `whtAmount > 0` ก่อนกดยืนยันได้ ([expense-status.logic.ts:318-323](../../apps/api/src/modules/expenses/domain/logic/expense-status.logic.ts))
- ปุ่ม "ยืนยันเอกสาร" (`t('expenses.confirm_and_post')`, [ExpenseReviewPage.tsx:923](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) เรียก `confirmExpense` → toast "ยืนยันเอกสารเรียบร้อยแล้ว" — ไม่มี handoff/certificate ใด ๆ เกิดขึ้นหลังจากนี้วันนี้

การเปลี่ยนแปลง v1: ที่จุดยืนยันเดียวกันนี้ (ในธุรกรรมเดียวกับ confirm ไม่ใช่ปุ่มแยกทีหลัง) เมื่อ `whtAmount > 0`:
1. ต้องเพิ่มช่องบังคับใหม่ "ประเภทเงินได้ (หัก ณ ที่จ่าย)" — dropdown จาก `WhtIncomeCategory` ACTIVE catalog เดียวกับที่ AP ใช้ (ดู finding 8b, §12) เพราะ Expenses ไม่มีฟิลด์นี้เลยวันนี้
2. สร้าง `WhtCertificateHandoff(REQUIRED)` แบบเดียวกับที่ `createWhtHandoffForPayment` ทำฝั่ง AP (ปิดช่องว่างที่ H4 ตั้งใจ scope out ไว้)
3. ถ้าทั้งสอง gate ผ่าน (route-readiness OPEN + บริษัทมี entitlement `thai_tax`/ENTERPRISE_1999 — §8): เสนอ "ออกเอกสารในระบบ" ทันทีในหน้าเดียวกันหลังยืนยันสำเร็จ (ไม่บังคับ — ผู้ใช้ปิดไปออกทีหลังจากหน้า handoff ก็ได้ ถ้ามี global work hub ในอนาคต)

## 5. Data model

**หลักการ: ต่อยอด ไม่ redesign** — `WhtCertificate` และ `WhtCertificateHandoff` ที่ H4 สร้างไว้มีฟิลด์ที่ v1 ต้องการอยู่แล้วเกือบทั้งหมด:

- `WhtCertificateHandoff.status` มีค่า `SYSTEM_ISSUED` ในอยู่แล้ว ([schema.prisma:5146](../../apps/api/prisma/schema.prisma)) และถูก honor ไว้แล้วในจุด block-void (`prisma-procurement.repository.ts:1602`) และ label ฝั่ง UI (`AccountsPayablePages.tsx:889` → "ระบบออกให้แล้ว") — **ไม่มีโค้ดจุดไหนเขียนค่านี้เลยวันนี้** ยืนยันว่าเป็น seam ที่ H4 เตรียมไว้ให้ slice นี้โดยเจตนา
- `WhtCertificateHandoff.certificateId` (nullable string, [schema.prisma:5204](../../apps/api/prisma/schema.prisma)) มีไว้ผูกกับ `WhtCertificate.id` แล้ว เมื่อ SYSTEM issue สำเร็จให้เขียนค่านี้พร้อมเปลี่ยน status ในธุรกรรมเดียว
- `WhtCertificate` model ครบฟิลด์ที่ฟอร์ม RD ต้องการอยู่แล้ว (`payerSnapshotJson`, `payeeSnapshotJson`, `incomeCategoryCode/Name`, `whtRate`, `grossAmount`, `withheldAmount`, `certificateNumber`, `pdfAttachmentId`) — ไม่ต้อง migration ใหม่สำหรับ field เหล่านี้
- **หมายเหตุ (ดู `docs/plans/wht-certificate-system-issuance-plan.md` §2.2 ข้อ 5):** `WhtCertificate.taxPeriodId` เป็น NOT NULL และเป็น required relation ไปยัง `TaxPeriod` ([schema.prisma:5116-5117,5137](../../apps/api/prisma/schema.prisma)) — ไม่ต้อง migration ใหม่จริงตามที่ระบุไว้ข้างต้น แต่ use case ใหม่ต้องมีคำตอบว่าจะได้ค่านี้มาจากไหนโดยไม่มี `POST tax/sync` มาก่อน (ซึ่งเป็นทางเดียวที่มีอยู่วันนี้ที่สร้าง `TaxPeriod`/`TaxEventIds`) คำตอบตาม plan: reuse `PrismaTaxRepository.upsertPeriod` find-or-create helper เดิมที่ `sync-tax-events.use-case.ts` ใช้อยู่แล้วทุก loop แทนที่จะรอ sync แยก

**สิ่งที่ต้องเพิ่มจริง (เท่าที่จำเป็น, ponytail):**

1. Expenses เท่านั้น — ฟิลด์ WHT income category ที่ไม่มีอยู่เลยวันนี้ (AP มี `SupplierPayment.whtCategoryCode`/`whtRate` แล้วจาก wht-settlement-capture-spec ที่ deploy แล้ว — [procurement.model.ts:366](../../apps/api/src/modules/procurement/domain/models/procurement.model.ts)) ต้องเพิ่ม field เทียบเท่าบน `ExpenseRecord`/`whtInputJson` เพื่อให้มี `incomeCategoryCode`/`whtRate` ที่ certificate ต้องใช้ — ยืนยันจาก schema ว่า `ExpenseRecord` มีแค่ `whtAmount`, `vendorEntityKindSnapshot` ไม่มี income-category field เลย
2. Payer `branchCode` ในการ prefill/issue — ปัจจุบัน hardcode `null` เสมอ (§12 finding 6) ต้องแก้ให้ดึงจาก `Branch.taxBranchCode` ของสาขาที่จ่ายจริง (ฟิลด์นี้มีอยู่แล้วในสคีมา ไม่ต้อง migration)
3. **ลายเซ็น/ตราประทับ (resolved — ดู §10):** owner เลือกตัวเลือก (ค) ทำเป็นการตั้งค่าระดับบริษัท — ต่อยอด `CompanyTaxProfile` ([schema.prisma:4544-4561](../../apps/api/prisma/schema.prisma)) ที่เป็น per-company (`companyId @unique`) และเป็นที่เก็บ tax-related company setting อยู่แล้ว (§12 finding 6 ก็อ้างถึงโมเดลนี้) ตามหลักการ "ต่อยอด ไม่ redesign" เดียวกับหัวข้อนี้ — เพิ่มฟิลด์ใหม่แบบ additive:
   - `signatureMode` (string/enum, ค่าเริ่มต้น `BLANK` — ดู §10 เรื่อง default)
   - `signatureImageAttachmentId` (nullable string, อ้างถึง `AttachmentObject.id`, มีค่าต่อเมื่อ `signatureMode = AUTO_STAMP`)
   - `companySealImageAttachmentId` (nullable string, อ้างถึง `AttachmentObject.id`, มีค่าต่อเมื่อ `signatureMode = AUTO_STAMP`)

   ไม่ใช่ column ใหม่บน `WhtCertificate`/`WhtCertificateHandoff` — ค่านี้เป็นของบริษัท ไม่ใช่ของใบแต่ละใบ ตอน render PDF ให้ query `CompanyTaxProfile` ของบริษัทประกอบ ไม่ต้อง denormalize ซ้ำ

## 6. PDF template requirement

ต้องแทนที่ `buildMinimalPdf` ([tax-export.logic.ts:65](../../apps/api/src/modules/tax/domain/logic/tax-export.logic.ts)) ด้วย pipeline SVG→raster→pdf-lib แบบเดียวกับใบแทนใบเสร็จ (`renderSubstituteReceiptPdf`, [substitute-receipt-pdf.logic.ts:341](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts)) ผ่าน `TaxArtifactRendererService` ที่เป็น seam ไว้ให้แล้ว ([tax-artifact-renderer.service.ts](../../apps/api/src/modules/tax/application/services/tax-artifact-renderer.service.ts))

**หมายเหตุแก้ไข (พบระหว่างเขียน plan, ดู `docs/plans/wht-certificate-system-issuance-plan.md` §2.5):** `buildMinimalPdf`/`buildTaxExportArtifact` ตัวเดียวกันนี้ถูกใช้ร่วมโดย `GenerateTaxFilingPackageUseCase` ด้วย ([generate-tax-filing-package.use-case.ts:64](../../apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts) เรียก `buildTaxExportArtifact` สำหรับ export ชุดยื่นภาษี VAT/WHT ที่ไม่เกี่ยวข้องกับ 50 ทวิเลย) — การ "แทนที่" ฟังก์ชันนี้ตรง ๆ ตามตัวอักษรจะเปลี่ยน PDF ของ filing package ไปด้วยโดยไม่ตั้งใจ วิธีที่ถูกต้อง (ตาม plan Phase 2.5) คือสร้างไฟล์/เมธอด renderer ใหม่แยกต่างหาก (`wht-certificate-pdf.logic.ts` + เมธอดใหม่ `TaxArtifactRendererService.renderWhtCertificate`) โดยไม่แตะ `buildMinimalPdf`/`buildTaxExportArtifact`/filing package เดิมเลย

Template ต้องมีฟิลด์จริงตามแบบ 50 ทวิ ครบ:
- เลขประจำตัวผู้เสียภาษี 13 หลักทั้งผู้จ่าย/ผู้รับ + ที่อยู่ + สาขา (payer branchCode ต้องไม่ null อีกต่อไป — ดู §5.2)
- เล่มที่/เลขที่ (จาก `ReserveDocumentNumberUseCase` documentType `tax.wht_certificate` เดิม)
- ช่องกาเครื่องหมายประเภทแบบ ภ.ง.ด.3/53 — derive จาก `vendorEntityKindSnapshot`/`supplierType`: `INDIVIDUAL` → ภ.ง.ด.3, `JURISTIC`/`JURISTIC_PERSON` → ภ.ง.ด.53, อื่น ๆ fallback ภ.ง.ด.53 (กติกาเดียวกับที่ `sync-tax-events`/H4 ใช้อยู่แล้ว ไม่คิดใหม่)
- ตารางประเภทเงินได้/อัตรา/จำนวนเงินที่จ่าย/ภาษีที่หักไว้
- ช่องผู้จ่ายเงินลงชื่อ/วันที่ — ตำแหน่งนี้อ่านค่า `CompanyTaxProfile.signatureMode` ของบริษัท (ดู §5, §10 resolved decision): `AUTO_STAMP` → วางรูปลายเซ็น+ตราที่เก็บไว้ลงตำแหน่งนี้; `BLANK` (default) → เว้นว่างเหมือน template เดิมที่มีอยู่แล้ววันนี้ ไม่ต้องเปลี่ยน layout อื่นใด

**ข้อจำกัดที่ต้องระวัง (จาก Phase A, ดูรายละเอียด §12 finding 3):** pipeline นี้ไม่ได้ฝัง glyph ไทยลง PDF text operator — มันแรสเตอร์ SVG (font "Noto Sans Thai" ที่ apt-get ติดตั้งไว้ในอิมเมจ API เท่านั้น, [Dockerfile:5,92-101](../../apps/api/Dockerfile)) เป็นภาพแล้ววาง ทำให้ตัวอักษรใน PDF ไม่ใช่ text ที่ select/search/copy ได้ ยอมรับได้สำหรับ v1 (เพราะทำตามแบบเดิมที่มีอยู่ ตรวจสอบแล้วว่า render ไทยได้จริง) แต่ต้องพิสูจน์ด้วยตาว่า checkbox/ตัวเลขตัวเล็กในแบบจริงยังอ่านออกที่ raster density 150-200 DPI ก่อนปิด gate

## 7. Permissions / ABAC

**สถานะปัจจุบัน (ยืนยันจาก source):**

| Action | Permission ปัจจุบัน | Feature-gated? |
|---|---|---|
| AP payment + WHT fieldset | `procurement.supplier_payment.create` + `.release` | ไม่ (procurement.* ไม่มี prefix rule) |
| Expenses "ยืนยันเอกสาร" | `expense.confirm` | ไม่ |
| อ่าน/แนบ external handoff | `wht.certificate.read`, `wht.external_certificate.link` (`pack.wht.certificate.manage`) | **ไม่** — pack นี้ไม่มี `featureEntitlementKey` ([capability-pack.registry.ts:450-454](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) — ตั้งใจ decouple จาก `thai_tax` ตาม H4 |
| ออกใบ 50 ทวิ จาก Tax workspace (`POST tax/wht-certificates`) | `tax.certificate.issue` (`pack.tax.prepare`) | **ใช่ — gated ด้วย `thai_tax`** ([capability-pack.registry.ts:434](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) |
| "ออกเอกสารในระบบ" จาก AP/Expenses (ใหม่, v1) | `wht.certificate.issue` (ใหม่ — pack ใหม่, ดูคำแนะนำด้านล่าง) | **ใช่ — gated ด้วย `thai_tax`** (owner decision 2026-09-22, กลับคำจากที่เคยแนะนำไว้ว่าไม่ gate) |

**เหตุผลที่ยังต้องสร้าง permission ใหม่แยก ไม่ reuse `tax.certificate.issue` ตรง ๆ (ไม่เปลี่ยนจาก Phase A แม้ entitlement decision จะกลับด้าน):** endpoint SYSTEM-issuance ที่มีโค้ดอยู่แล้ว (`CreateWhtCertificateUseCase`, [create-wht-certificate.use-case.ts](../../apps/api/src/modules/tax/application/use-cases/create-wht-certificate.use-case.ts)) ต้องการ `TaxPeriod`/`TaxEventIds` ที่มีอยู่ก่อนแล้วเท่านั้น (มาจาก `POST tax/sync` แยกต่างหาก — ดู §12 finding 8a) ซึ่งไม่มีพร้อมตอนกดยืนยันจ่าย/ยืนยันเอกสาร — เหตุผลนี้**เป็นเรื่อง shape ของ use case ไม่ใช่เรื่อง entitlement** จึงยังคงอยู่ไม่ว่า owner จะตัดสินใจเรื่อง `thai_tax` อย่างไร: AP/Expenses ยังต้องมี use case/permission ของตัวเองที่ mint certificate ตรงจากข้อมูล settlement/expense โดยไม่ง้อ `TaxPeriod`/`TaxEventIds`

**คำแนะนำ (ปรับตาม owner decision 2026-09-22, §2 goal 4):** เพิ่ม permission ใหม่หนึ่งตัว `wht.certificate.issue` — แต่ต่างจากที่เคยแนะนำไว้ก่อนหน้านี้ (ที่จะใส่แบบไม่ gate เข้า `pack.wht.certificate.manage` เดิม) ตอนนี้ permission นี้**ต้องมี `featureEntitlementKey: 'thai_tax'`** ซึ่งกลไก gating ของระบบนี้ผูกที่ระดับ**แพ็ก** ไม่ใช่ระดับ permission เดี่ยว (`pack.featureEntitlementKey`, [feature-gate.logic.ts:99-104](../../apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts), [capability.logic.ts:55](../../apps/api/src/modules/employee-access/domain/logic/capability.logic.ts)) — ถ้าใส่ `wht.certificate.issue` เข้า `pack.wht.certificate.manage` เดิมตรง ๆ จะ**ไม่ถูก gate จริง** เพราะ pack นั้นตั้งใจไม่มี `featureEntitlementKey` อยู่แล้ว (เพื่อให้ read/link ยังใช้ได้โดยไม่ต้องมี `thai_tax` — [capability-pack.registry.ts:445-454](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) และการเติม key เข้า pack เดิมจะ gate read/link ไปด้วยผิดสโคป (Decision 1 ระบุชัดว่าห้ามแตะ read/link)

จึงต้องสร้าง**pack ใหม่แยกต่างหาก** เช่น `pack.wht.certificate.issue` (module: `'tax'`, `featureEntitlementKey: 'thai_tax'`) ถือ permission เดียวคือ `wht.certificate.issue` — มิเรอร์ pattern ที่มีอยู่แล้วของการแยก pack ตาม gate (`pack.tax.view`/`pack.tax.prepare`/`pack.tax.manage` ล้วน gated, ขณะที่ `pack.wht.certificate.manage` ไม่ gated) คงไว้ไม่แก้ `pack.wht.certificate.manage` (read/link) เดิม มอบ `wht.certificate.issue` ให้ role เดียวกับ `wht.certificate.read`/`wht.external_certificate.link` (FINANCE, ACCOUNTANT; OWNER inherit ผ่าน `COMPANY_PERMISSION_KEYS`, [permission-registry.ts:875,941](../../apps/api/src/modules/auth/permission-registry.ts)) — บริษัทที่ role มีสิทธิ์นี้แต่ไม่มี entitlement `thai_tax` จะยังไม่เห็นปุ่มอยู่ดี (ถูก entitlement ตัดออกก่อนถึงชั้น role) ไม่ reuse `tax.certificate.issue` (คนละ use-case shape ตาม finding 8a) และไม่ overload `procurement.supplier_payment.create`/`expense.confirm` (permission เหล่านั้นคุมการบันทึกจ่าย/ยืนยันเอกสาร ไม่ใช่การออกเอกสารกฎหมายแยก) เอกสาร use-case ใหม่ต้อง `RequirePermissions('wht.certificate.issue')` และตรวจ `assertRouteCompany` เหมือน route อื่นในไฟล์เดียวกัน

**Audit:** ตาม pattern ที่ `CreateWhtCertificateUseCase` ทำอยู่แล้ว (`audit.log({ action: 'tax.wht_certificate.issue', riskLevel: 'HIGH', ... })`) และ `ReserveDocumentNumberUseCase`/`CommitDocumentNumberUseCase` (`document.number.reserve`/`.commit`, `riskLevel: 'LOW'`) — reuse ทั้งชุด ไม่คิด audit schema ใหม่

## 8. Entitlement gate

`cap.wht50bis/SYSTEM_INITIAL_ISSUE` มีอยู่แล้วใน `FEATURE_LAUNCH_MATRIX` ([launch-matrix.catalog.ts:190-198](../../apps/api/src/modules/feature-launch/domain/launch-matrix.catalog.ts)) เป็น `routeClass: 'SPECIALIST_LEGAL'`, `seedState: 'CLOSED'`, `specialistApprovalRequired: true` — **ไม่ต้องสร้าง gate ใหม่** งานของ spec นี้คือทำให้ route นี้มีหลักฐานพอ OPEN ได้ (PDF ตรงแบบจริง + ผ่านนักบัญชี/ผู้เชี่ยวชาญภาษี + regression fixture) ตาม OPEN transition rule ที่มีอยู่แล้ว (ต้องมี `validationEvidenceRef`/`validationEvidenceHash` + `specialistApprovedByUserId`, [feature-entitlement-decoupling-spec.md:86-87](../../docs/specs/feature-entitlement-decoupling-spec.md))

Route-readiness gate นี้เป็น**คนละแกนกับ** billing tier: package-entitlements spec (owner decision 2026-09-21) เก็บ ภ.ง.ด.53/50 ทวิ เป็น feature-readiness lock **แยกจาก** `ENTERPRISE_1999` เสมอ ([mangmee-package-entitlements-spec-th.md:99,105](../../docs/specs/mangmee-package-entitlements-spec-th.md)) — ต่อให้ ENTERPRISE ขายได้แล้ว ก็ยังต้องรอ specialist evidence ของ route นี้แยกต่างหาก ไม่ผูกกับ checkout ไหนทั้งสิ้น

**คำตัดสิน 2026-09-22 เพิ่มแกนที่สอง — ปุ่ม "ออกเอกสารในระบบ" ต้องผ่านทั้งสองแกนพร้อมกัน:** owner สั่งว่า "ทวิ 50 ปุ่มกดออกเอกสาร ต้องเป็น pack ENTERPRISE เท่านั้น, pack อื่นจะเป็น เก็บข้อมูลแต่ไม่มีปุ่มกดออกเอกสาร" (§2 goal 4, §7) ดังนั้นตั้งแต่นี้ไปมี**สองประตูที่เป็นอิสระต่อกัน**ต้องผ่านครบทั้งคู่ ปุ่มถึงจะแสดง/ทำงานได้:

1. **Route-readiness gate** — `cap.wht50bis/SYSTEM_INITIAL_ISSUE` ต้อง OPEN (ตามย่อหน้าบน — SPECIALIST_LEGAL, ยังต้องมี golden-fixture/accountant evidence เหมือนเดิม ไม่เปลี่ยน)
2. **Billing-tier entitlement gate (ใหม่)** — บริษัทต้องมี `thai_tax` entitlement (คือซื้อ `ENTERPRISE_1999`) ผ่าน permission ใหม่ `wht.certificate.issue` ที่ gated ด้วย `featureEntitlementKey: 'thai_tax'` (§7)

สองแกนนี้ตอบคำถามคนละเรื่องและ**ไม่ขัดกันเอง**: แกน (1) คือความพร้อมทาง legal/compliance ของฟีเจอร์ (พิสูจน์แล้วว่า PDF/ตัวเลขถูกต้องตามกฎหมาย) ส่วนแกน (2) คือการแพ็กเกจเชิงพาณิชย์ (ใครจ่ายเงินซื้อฟีเจอร์นี้ได้บ้าง) — เดิม spec นี้ตั้งใจให้แกน (2) ไม่เกี่ยวข้องเลย (ดู §2 goal 4 เวอร์ชันก่อนแก้) แต่ owner ตัดสินใจกลับด้านเฉพาะสำหรับปุ่มออกเอกสารในระบบเท่านั้น ไม่กระทบแกน (1) แต่อย่างใด บริษัทหนึ่งอาจอยู่ในสถานะ "แกน 1 OPEN แต่แกน 2 ไม่ผ่าน" ได้ตามปกติ (เช่น ไม่ได้ซื้อ ENTERPRISE) — กรณีนี้คือ acceptance scenario S9 (§11)

## 9. Numbering (เล่มที่/เลขที่)

ใช้ `ReserveDocumentNumberUseCase`/`CommitDocumentNumberUseCase` เดิม (documentType `tax.wht_certificate` — โค้ดที่ `CreateWhtCertificateUseCase` ใช้อยู่แล้ววันนี้เวลา gate OPEN) ป้องกัน collision ด้วย DB unique จริง สองตัว: `@@unique([companyId, documentType, documentNumber])` และ `@@unique([companyId, documentType, idempotencyKey])` ([schema.prisma:1255-1256](../../apps/api/prisma/schema.prisma)) — ไม่ใช่ advisory lock (advisory lock มีแค่สำหรับ `documentType === 'expense.record'` เท่านั้น, [prisma-document-sequence.repository.ts:88-90](../../apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.ts))

**Edge case ที่ต้องระวังตอน implement (ดูรายละเอียด §12 finding 2):** การจอง reservation ไม่มี catch-and-replay สำหรับ P2002 เหมือนที่ `WhtCertificateHandoffUseCase.createOrReplay` มี (H4's F5 fix) — สองคำขอ "ออกเอกสารในระบบ" ที่ idempotencyKey เดียวกันพร้อมกันจริง ๆ (ดับเบิลคลิก/สองแท็บ) จะชนกันที่ `tx.documentNumber.create` แล้วโยน P2002 ดิบออกไปแทนที่จะ replay เนียน ๆ use case ใหม่ต้อง wrap ด้วย catch-P2002-then-reload แบบเดียวกับ F5 ไม่ใช่ปล่อยผ่าน

## 10. ลายเซ็น/ตราประทับ — คำตัดสิน owner (resolved 2026-09-22, เดิมเป็น OPEN QUESTION)

**คำตัดสิน:** owner เลือกตัวเลือก **(ค)** จากสามตัวเลือกที่เสนอไว้เดิม (ดูตัวเลือกเดิม (a)/(b)/(c) ด้านล่าง เพื่อ traceability) — ทำเป็น**การตั้งค่าระดับบริษัท (per-company setting)**: แต่ละบริษัทเลือกเองระหว่าง "ประทับลายเซ็น+ตราที่อัปโหลดไว้ลง PDF อัตโนมัติ" กับ "เว้นว่างไว้ให้พิมพ์แล้วเซ็นเอง" ตัดสินใจในแชทติดตามผลเดียวกับ Decision 1 เรื่อง ENTERPRISE gating วันที่ 2026-09-22

ตัวเลือกเดิมที่เสนอไว้ (เก็บไว้อ้างอิง):
(a) ประทับลายเซ็น/ตราที่อัปโหลดไว้ล่วงหน้าลง PDF อัตโนมัติ
(b) เว้นว่างไว้ให้ผู้ใช้พิมพ์แล้วเซ็นเอง
(c) ทั้งสองแบบเป็นตัวเลือกที่ตั้งค่าได้ต่อบริษัท ← **owner เลือกข้อนี้**

**สิ่งที่ต้องมี (เล็กสุดที่ถูก, ponytail — ไม่ออกแบบเป็นระบบ "document branding"/e-signature กว้างกว่านี้):**

1. **Setting ระดับบริษัท** — โหมด `AUTO_STAMP`/`BLANK` บวก (เมื่อเลือก `AUTO_STAMP`) reference ไปยังรูปลายเซ็นหนึ่งรูปและรูปตราประทับบริษัทหนึ่งรูป ต่อยอด `CompanyTaxProfile` แบบ additive (ดู §5 สำหรับฟิลด์ที่เพิ่ม) — **default = `BLANK`** จนกว่าบริษัทจะเข้ามาเลือก `AUTO_STAMP` เอง (บริษัทที่ยังไม่ได้ตั้งค่าอะไรเลย = พฤติกรรมเดิมทุกประการ ไม่มีอะไรเปลี่ยนโดยไม่ได้ตั้งใจ)
2. **UI การตั้งค่าเล็ก ๆ ให้บริษัทอัปโหลด/จัดการ** — เป็น**หน้าใหม่ระดับบริษัท คนละ concept กับ**ฟีเจอร์ลายเซ็นส่วนบุคคลที่มีอยู่แล้ว (`expense.signature.self_manage`/`expense.signature.manage`, model `CompanySignatureAsset` [schema.prisma:2806-2831](../../apps/api/prisma/schema.prisma) — comment ในสคีมาเองก็ระบุไว้ชัดว่า "a signature is a PERSONAL asset" ของพนักงานแต่ละคน ไม่ใช่ลายเซ็น "ผู้จ่ายเงิน"/กรรมการ/ผู้มีอำนาจของบริษัทที่ 50 ทวิ ต้องการ) — **ห้าม conflate หรือ reuse data model ของฟีเจอร์นั้น** แต่**ควร reuse กลไก upload/storage ทั่วไปแบบเดียวกัน**: `CreateUploadIntentUseCase`/`CompleteAttachmentUploadUseCase` เขียนลง `AttachmentObject` ([schema.prisma:1142-1179](../../apps/api/prisma/schema.prisma)) แล้วผูกด้วย `linkAttachmentToTarget` — ตาม pattern ที่ `signature-asset.use-case.ts` ใช้อยู่แล้ววันนี้ ([signature-asset.use-case.ts:5-6](../../apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts) imports, [:198](../../apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts) `originalAttachmentId: cmd.attachmentId`, [:219](../../apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts) `linkAttachmentToTarget(...)`) — ไม่ต้องคิด upload/storage ใหม่ แค่ target type ใหม่ (เช่น `'company.tax_signature'`) แทน `'company.signature_asset'`
3. **PDF template** — ดู §6 (อัปเดตแล้ว): `AUTO_STAMP` → วางรูปลายเซ็น+ตราตำแหน่งที่มีอยู่แล้วในแบบ; `BLANK` → เว้นว่างเหมือน template เดิมที่มีอยู่แล้ว ไม่ต้องออกแบบ layout ใหม่

## 11. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| S1 | AP payment หัก 3% แล้วกด "ออกเอกสารในระบบ" เมื่อ gate OPEN | handoff → `SYSTEM_ISSUED`, `certificateId` ผูกกับ `WhtCertificate` แถวใหม่, PDF ดาวน์โหลดได้ทันที, เลขที่จองผ่าน `tax.wht_certificate` namespace เดิม |
| S2 | Expense confirm ที่มี `whtAmount > 0` ไม่เลือกประเภทเงินได้ | บล็อก confirm เหมือนที่บล็อก `vendorEntityKindSnapshot` วันนี้ (ข้อความบอกเหตุผล ไม่ใช่ error ทั่วไป) |
| S3 | Expense confirm ที่มี `whtAmount > 0` + เลือกประเภทเงินได้ครบ | สร้าง `WhtCertificateHandoff(REQUIRED)` เสมอ (ไม่ว่า gate จะ OPEN หรือ CLOSED) — mirror AP behavior |
| S4 | gate CLOSED ทั้งสองจุด | พฤติกรรมเดิมทุกอย่าง (external handoff flow) ไม่มีอะไรเปลี่ยน — ทดสอบ regression |
| S5 | payer จ่ายจากสาขาอื่นที่ไม่ใช่สำนักงานใหญ่ ที่มี `taxBranchCode` | payerSnapshot.branchCode ต้องไม่ null และตรงกับ `Branch.taxBranchCode` ของสาขาที่จ่ายจริง |
| S6 | สองคำขอออกเอกสารพร้อมกันสำหรับ obligation เดียวกัน (ดับเบิลคลิก) | ได้ certificate เดียว เลขเดียว ไม่มี P2002 ดิบหลุดออกไปที่ผู้ใช้ |
| S7 | Void payment ที่ handoff เป็น `SYSTEM_ISSUED` แล้ว | บล็อกด้วย `wht_certificate_linked_requires_review` เหมือน `EXTERNAL_LINKED` (โค้ด guard มีอยู่แล้ว ไม่ต้องแก้ แค่ต้อง cover ด้วย test ใหม่) |
| S8 | Golden-fixture review | PDF ที่ออกต้องผ่านการเทียบฟิลด์กับแบบ 50 ทวิ ตัวจริงโดยนักบัญชี/ผู้เชี่ยวชาญภาษีอย่างน้อยหนึ่งรอบ พร้อมบันทึกผลเป็น `validationEvidenceRef`/`validationEvidenceHash` ก่อนขอ OPEN บน `cap.wht50bis/SYSTEM_INITIAL_ISSUE` — ใช้ถ้อยคำเดียวกับ feature-entitlement-decoupling-spec.md ("official Thai golden fixtures and real accountant/statutory acceptance") ไม่ลดมาตรฐาน |
| S9 | บริษัท**ไม่ได้**อยู่บนแพ็กเกจที่มี `thai_tax` (ไม่ใช่ ENTERPRISE_1999), route gate `cap.wht50bis/SYSTEM_INITIAL_ISSUE` เป็น OPEN แล้ว, ผู้ใช้เปิดหน้า WHT handoff/ยืนยันเอกสาร | ปุ่ม/แอคชัน "ออกเอกสารในระบบ" ต้อง**ไม่แสดง** (หรือแสดงแบบ disabled พร้อมเหตุผล) — data capture (หมวด/อัตรา/ยอดหัก/ประเภทผู้รับเงิน) และ flow EXTERNAL-issue-then-attach (ดูข้อมูล/แนบเอกสารที่ออกภายนอก) ยังทำงานปกติทุกจุดเหมือนเดิม |
| S10 | บริษัทตั้งค่า `signatureMode = AUTO_STAMP` พร้อมอัปโหลดรูปลายเซ็น+ตราแล้ว ออกเอกสารในระบบสำเร็จ | PDF ที่ได้ต้องแสดงรูปลายเซ็นและตราประทับที่เก็บไว้ ในตำแหน่งช่องผู้จ่ายเงินลงนามตามแบบ |
| S11 | บริษัทตั้งค่า `signatureMode = BLANK` (หรือยังไม่เคยตั้งค่าอะไรเลย — ค่า default) ออกเอกสารในระบบสำเร็จ | ช่องผู้จ่ายเงินลงนามต้องเว้นว่างไว้ เหมือน baseline ของ template วันนี้ ไม่มีรูปใด ๆ ถูกวาง |

## 12. Findings & risks จาก Phase A discovery

1. **Permission ที่มีอยู่ผูกผิด entitlement** — `tax.certificate.issue` (endpoint SYSTEM-issuance ที่มีโค้ดอยู่แล้ว) อยู่ใน `pack.tax.prepare` ที่ `featureEntitlementKey: 'thai_tax'` ขัดกับ design ที่บันทึกไว้แล้วว่า SYSTEM issuance ไม่ควรต้องมี `thai_tax` — ต้องเพิ่ม permission decoupled ใหม่ (§7) ก่อน AP/Expenses จะเรียกใช้ได้ถูกต้อง
2. **Numbering ไม่มี P2002 catch-and-replay ในเส้นทางที่มีอยู่** — `reserveNumberInTransaction` ป้องกัน collision ด้วย DB unique จริงสองตัว แต่ไม่ได้ catch P2002 เหมือนที่ `WhtCertificateHandoffUseCase.createOrReplay` ทำ (H4's F5) → ดับเบิลคลิกจะเห็น error ดิบ ต้องห่อ use case ใหม่ให้ถูก และ**การรวม namespace เลขที่ระหว่าง SYSTEM กับ EXTERNAL ที่ owner บอกว่า "ออกแบบไว้แล้วให้ปลอดภัย" นั้นเป็นแค่ design ใน feature-entitlement-decoupling-spec.md บรรทัด 238 — โค้ดจริงยังไม่ทำ** (`linkExternal` ไม่เคยเรียก `ReserveDocumentNumberUseCase` เลย) v1 ไม่ต้องสร้าง merge นี้ (ไม่ใช่ regression ใหม่ที่ v1 สร้างขึ้น) แต่ spec/implementer ต้องไม่เข้าใจผิดว่ามันมีแล้ว
3. **Thai font render ผ่าน raster ไม่ใช่ embedded glyph** — pipeline ที่จะ reuse (substitute-receipt) รัน SVG ผ่าน `sharp`/librsvg ด้วยฟอนต์ Noto Sans Thai ที่ apt-get ติดตั้งในอิมเมจ API เท่านั้น (Dockerfile บังคับ build-time assert ว่าไฟล์ฟอนต์มีอยู่) แล้วแรสเตอร์เป็นภาพฝังใน PDF — อ่านไทยได้จริง (ยืนยันจาก dark-pixel-ratio runtime guard ที่มีอยู่แล้ว) แต่ตัวหนังสือใน PDF ไม่ใช่ text ที่ select ได้ และฟอนต์ผูกกับ container เดียว (API) เท่านั้น ถ้า render ย้ายไป service อื่นต้องติดตั้งฟอนต์ซ้ำ
4. **ไม่มี whole-chain acceptance script สำหรับ tax/billing** — repo มีของ LINE-AI (`scripts/run-line-ai-whole-chain-acceptance.mjs`) เท่านั้น ไม่มีของ WHT/tax รายการ spec ที่ต้องเขียวก่อน merge: `create-wht-certificate.use-case.spec.ts`, `wht-certificate-handoff.use-case.spec.ts`, `wht-income-category.use-case.spec.ts`, `wht-report.logic.spec.ts`, `sync-tax-events-supplier-payment-wht.use-case.spec.ts`, `sync-tax-events-wht-form.use-case.spec.ts`, `sync-tax-events-components/output-code/payee-address/vat-invariant.use-case.spec.ts`, `supplier-payment-integrity.use-case.spec.ts`, `prisma-procurement-integrity.repository.spec.ts`, `expense-status.logic.spec.ts`, `expense-capture-status.logic.spec.ts` (web), `expense-confirm-blocker.spec.ts` (web), `prisma-expense.repository.atomic-confirm.spec.ts`, `accounts-payable.logic.spec.ts`/`accounts-payable.model.spec.ts` (web) — ต้องเพิ่ม integration spec ใหม่สำหรับเส้นทาง confirm→certificate เพราะไม่มี suite ไหน cover การ mint certificate จาก business-confirm action วันนี้
5. **Entitlement gate ถูกต้องอยู่แล้ว ไม่ต้องสร้างใหม่** — `cap.wht50bis/SYSTEM_INITIAL_ISSUE` มีอยู่แล้วเป็น `SPECIALIST_LEGAL` seed CLOSED และแยกจาก billing tier ตาม owner decision 2026-09-21 อย่างชัดเจน งานของ spec นี้คือ "ป้อนหลักฐาน" ให้ gate นี้ ไม่ใช่คิด gate ใหม่
6. **Payer branch code เป็น null เสมอ (bug ที่ต้องแก้)** — `CreateWhtCertificateUseCase` hardcode `payerSnapshot.branchCode: null` ทุกครั้งไม่ว่าจ่ายจากสาขาไหน แม้ `Branch.taxBranchCode` จะมีอยู่แล้วในสคีมาเพื่อจุดประสงค์นี้พอดี (`isVatEstablishment` คู่กัน) และ `CompanyTaxProfile.branchPolicy` (default `HEAD_OFFICE_ONLY`) ก็เก็บไว้เฉย ๆ ไม่มีโค้ดไหนใช้จริง — ถ้าไม่แก้ ทุกใบที่ระบบออกจะพิมพ์สาขาผู้จ่ายว่างเสมอ ต้องแก้เป็นส่วนหนึ่งของ v1 (populate จาก field ที่มีอยู่แล้ว ไม่ใช่ฟีเจอร์ใหม่)
7. **VAT registration ไม่เกี่ยวกับ 50 ทวิ — ตรวจแล้วไม่มี interaction** — grep `vatRegistered`/`VatRegistrationStatus` ใน `create-wht-certificate.use-case.ts`, `wht-report.logic.ts`, `sync-tax-events.use-case.ts` ไม่เจอเลย ตรงกับหลักภาษีไทยที่ WHT (มาตรา 50 ทวิ) กับ VAT เป็นคนละระบบ — UAT ที่ default `NOT_VAT_REGISTERED` จึงไม่กระทบฟีเจอร์นี้ ไม่ต้องแก้อะไรเรื่องนี้
8. **Landmine อื่นที่เจอระหว่างอ่านโค้ด confirm-flow จริง:**
   - **(a) Tax-event dependency chain ผิดรูปกับความต้องการ "ออกได้ทันทีตอนยืนยัน"** — `CreateWhtCertificateUseCase` (endpoint ที่มีอยู่วันนี้) ต้องการ `TaxPeriod` + `TaxEventIds` (`WHT_PND3`/`WHT_PND53` events) ที่มีอยู่แล้วเท่านั้น — events เหล่านี้ถูกสร้างโดย `POST tax/sync` แยกต่างหาก ซึ่งเป็นแอคชันของนักบัญชีที่กดเป็นรอบ ๆ และ gated ด้วย `tax.event.sync` (`thai_tax`-gated) ไม่ใช่สิ่งที่มีพร้อมตอนกดยืนยันจ่าย/ยืนยันเอกสาร ดังนั้น use case ใหม่สำหรับ AP/Expenses **ต้องไม่ reuse shape ของ `CreateWhtCertificateUseCase` ตรง ๆ** ต้องออกแบบให้ mint certificate ตรงจากข้อมูล settlement/expense ที่มีอยู่แล้ว ณ ตอนนั้น (mirror วิธีที่ `createWhtHandoffForPayment` derive prefill ตรงจาก payment โดยไม่ง้อ TaxPeriod/TaxEventIds อยู่แล้ว) — นี่คือจุดแตกทาง design ที่ implementation plan ต้องตัดสินใจก่อนเขียนโค้ด
   - **(b) Expenses ไม่มี WHT income category เลย** — schema `ExpenseRecord`/`ExpenseLine` มีแค่ `whtAmount`/`whtRate`/`vendorEntityKindSnapshot` ไม่มี field เทียบเท่า `SupplierPayment.whtCategoryCode` ที่ AP มีแล้ว (มาจาก wht-settlement-capture-spec ที่ deploy แล้ว) — ถ้าไม่เพิ่ม จะไม่มีทางกรอก `incomeCategoryCode`/`incomeCategoryName` บนใบที่ออกจาก Expenses ได้เลย ต้องเพิ่ม dropdown + read endpoint แบบเดียวกับที่ AP มี (`GET .../procurement/wht-categories` gated ด้วย permission ของ procurement — Expenses ต้องมี endpoint คู่ขนานที่ gate ด้วย permission ของ expense แทน ไม่ใช้ `tax.config.read`) — **หมายเหตุ (ดู `docs/plans/wht-certificate-system-issuance-plan.md` Phase 1.2):** ฝั่ง read มี use case สำเร็จรูปอยู่แล้วให้ reuse ตรง ๆ — `ListWhtIncomeCategoriesUseCase` export จาก `procurement.module.ts` อยู่แล้ว ไม่ต้อง derive/เขียน query ใหม่
   - **(c) Seam ถูกเตรียมไว้ให้แล้วโดยเจตนา** — `WhtCertificateHandoff.status: SYSTEM_ISSUED` และ `.certificateId` มีอยู่ในสคีมาแล้ว ถูกอ้างถึงใน void-guard และ UI label แล้ว แต่ไม่มีจุดไหนเขียนค่าเหล่านี้เลย — ยืนยันว่า H4 เตรียม seam นี้ไว้ให้ slice นี้โดยตรง ไม่ต้องคิด schema ใหม่สำหรับจุดนี้
   - **(d) Void-guard ถูกต้องอยู่แล้วสำหรับ SYSTEM_ISSUED** — โค้ด block void เมื่อ status อยู่ใน `['EXTERNAL_LINKED', 'SYSTEM_ISSUED']` ครอบคลุมแล้ว ([prisma-procurement.repository.ts:1602](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts)) — v1 แค่ต้องเพิ่ม test คลุม ไม่ต้องแก้โค้ด
9. **Owner decision 2026-09-22 กลับคำ recommendation เดิมของ Phase A เรื่อง entitlement** — Phase A discovery (finding 1 ด้านบน) แนะนำให้ permission ใหม่**ไม่ gate** ด้วย `thai_tax` ตาม design เดิมของ feature-entitlement-decoupling-spec.md บรรทัด 331 owner สั่งกลับด้านในแชทติดตามผลวันที่ 2026-09-22 คำต่อคำ: _"ทวิ 50 ปุ่มกดออกเอกสาร ต้องเป็น pack ENTERPRISE เท่านั้น, pack อื่นจะเป็น เก็บข้อมูลแต่ไม่มีปุ่มกดออกเอกสาร"_ — ผลคือ permission ใหม่ `wht.certificate.issue` ต้อง gate ด้วย `thai_tax` (§7) และ route ต้องผ่านสองแกน (§8) การกลับด้านนี้จำกัดเฉพาะ**ปุ่ม/แอคชัน SYSTEM-issue เท่านั้น** ไม่กระทบ data-capture fields, `WhtCertificateHandoff` auto-creation, หรือ EXTERNAL-issue-then-attach flow ตามที่ระบุไว้ชัดใน §2 goal 4

## 13. ความเสี่ยง / deploy note

- ~~Implementation ต้องรอคำตอบ owner เรื่องลายเซ็น/ตรา (§10)~~ — **resolved 2026-09-22** owner เลือกตัวเลือก (ค) ตั้งค่าต่อบริษัท (§10) ไม่เป็น blocker อีกต่อไป
- Gate `cap.wht50bis/SYSTEM_INITIAL_ISSUE` เป็น `SPECIALIST_LEGAL` — เปิดได้เฉพาะหลังนักบัญชี/ผู้เชี่ยวชาญภาษีรีวิว golden fixture จริงเท่านั้น ห้าม deploy โดยหวังเปิด gate เองโดยไม่มี evidence นี้ — แกนนี้ยังคงเดิม แยกจาก entitlement gate ที่เพิ่มใหม่ (§8)
- แก้ permission ของ `POST tax/wht-certificates` (เพิ่ม `wht.certificate.issue`) ต้องเช็คว่าไม่กระทบ endpoint เดิมที่ Tax workspace ใช้อยู่ (อาจต้องรับได้ทั้งสอง permission หรือแยก route ใหม่ให้ AP/Expenses เรียกแทน — implementation ตัดสินใจตอนเขียนแผน)
- Expenses ต้อง migration เพิ่ม field income-category ก่อน — เดินตาม pattern migration ของ wht-settlement-capture-spec (additive เท่านั้น)
- **ข้อขัดแย้งที่ยังไม่ได้แก้ในเอกสารอื่น (owner decision 2026-09-22, §2 goal 4/§12 finding 9):** สเปกนี้ตอนนี้ขัดแย้งโดยตรงกับ (1) feature-entitlement-decoupling-spec.md บรรทัด 331 ("thai_tax and Tax-workspace issue permission are not required" สำหรับ SYSTEM_INITIAL_ISSUE) และ (2) mangmee-package-entitlements-spec-th.md ที่ยังวาง 50 ทวิ/ภ.ง.ด.53 เป็น feature-readiness lock ที่ตั้งใจแยกจาก billing tier เสมอ ([:99,105](../../docs/specs/mangmee-package-entitlements-spec-th.md)) — สอง spec นั้น**ไม่ได้ถูกแก้ไขในรอบนี้** (นอกสโคปของ docs task นี้) ต้องแจ้งผู้ดูแล billing/entitlement docs ให้ทราบและพิจารณาแก้ไข/ประสาน wording ให้ตรงกัน ก่อนใครอ่านเอกสารทั้งสามชุดแล้วเข้าใจผิดว่า design ยังไม่กลับด้าน

## Browser regression amendment — 2026-10-04

The 50 ทวิ company signature page reads `GET /companies/:companyId/tax/profile/signature`, protected by the existing `company.tax_signature.manage` permission (entitled through `wht_50bis`, or legacy `thai_tax`). It returns only `signatureMode` and `signatureImageAttachmentId`, with `BLANK`/null defaults. Route company must match the request company. ENTERPRISE signature managers can read and save this setting; STARTER and non-managers cannot. The full `tax/profile` endpoint and other Tax workspace data retain their existing tax-only permission gates. This page does not serve PND53.

Controls appear only after successful loading; failed loading offers retry, not a default-value save. The card keeps inner padding at 390 px. No schema change is required.

### Confirmed-expense browser follow-up (2026-10-04)

An issued expense certificate keeps a compact sticky download action (“ดาวน์โหลดเอกสารอีกครั้ง”); correction and replacement controls remain in the document body. Issuance eligibility and the no-withholding exclusion are unchanged. After issuance, the main document actions display the certificate's reopen blocker for all readers, independent of ledger permission. The in-app expense guide uses the shared actual correction and payment-cancellation button names. The owner decision prohibiting future expense-payment dates applies only to expense payment recording, not certificate correction dates or claim payouts in this lane.
