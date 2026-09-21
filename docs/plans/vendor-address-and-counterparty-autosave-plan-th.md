# แผนงาน: ที่อยู่ตามใบเสร็จ/ใบกำกับ และทะเบียนคู่ค้าแบบบันทึกอัตโนมัติ

## เอกสารที่เชื่อมโยง

- สเปค: [vendor-address-and-counterparty-autosave-spec-th.md](../specs/vendor-address-and-counterparty-autosave-spec-th.md)
- สถานะงาน: [vendor-address-and-counterparty-autosave.md](../agent-memory/vendor-address-and-counterparty-autosave.md)
- สเปคที่เกี่ยวข้อง: [company-tax-identity-setup-spec.md](../specs/company-tax-identity-setup-spec.md), [expense-receipt-upload-spec.md](../specs/expense-receipt-upload-spec.md), [receipt-tax-integrity-spec.md](../specs/receipt-tax-integrity-spec.md), [substitute-receipt-company-payer-spec.md](../specs/substitute-receipt-company-payer-spec.md)
- แนวทาง: `docs/guidelines/backend-hexagonal-code-style.md`, `docs/guidelines/web-frontend-code-style.md`, `.agents/skills/ponytail/SKILL.md`

## จุดประสงค์

เพิ่มที่อยู่ผู้ขายตามใบให้รายจ่าย ทำให้ทะเบียนคู่ค้าโตเองจากการทำงานปกติ และส่งที่อยู่ไปถึง 50 ทวิ กับ tax event โดยไม่เพิ่มการบล็อกใดๆ

## บริบทในโค้ดปัจจุบัน

- API: `apps/api/src/modules/expenses/**` (draft/review/confirm use cases, `receipt-ocr-apply.service.ts`, `expense-export.logic.ts`, `expense-document.logic.ts`), `apps/api/src/modules/accounting-documents/**` (counterparty use cases/controller/repository, `ensure-customer-counterparty.use-case.ts` เป็นแบบอย่าง), `apps/api/src/modules/tax/**` (`sync-tax-events.use-case.ts`, `create-wht-certificate.use-case.ts`, `wht-certificate-handoff.use-case.ts`), `apps/api/prisma/schema.prisma`
- Contracts: `packages/contracts/src/expenses.ts`, `accounting-documents.ts`, `line-ai.ts` (`ReceiptOcrFieldResult`), `company-tax-identity.ts` (`CompanyLegalAddress`)
- AI gateway: prompt/schema ของ receipt OCR
- Web: `apps/web/src/features/expenses/ExpensesPages.tsx` (ช่องผู้ขาย), `expenses.model.ts` (`AI_REVIEW_FIELD_KEYS`), `expense-review-validation.ts`, `apps/web/src/features/accounting-documents/AccountingPages.tsx` (ส่วนคู่ค้าเดิม), หน้าคู่ค้าใหม่, `SubstituteReceiptWizardPage.tsx` (prefill)
- ความเสี่ยงที่รู้อยู่: OCR prompt เปลี่ยนต้องรัน fixture suite; ทะเบียนไม่มี unique เลขภาษี (race → แถวซ้ำได้ ยอมรับตาม GAP-8); `ExpensesPages.tsx` ใหญ่ ต้องเพิ่มช่องแบบเดียวกับช่องเลขภาษีไม่ปรับโครง; audit sanitizer ต้องไม่รั่วที่อยู่

## กติกาการทำงาน

- ponytail full: diff สั้นที่สุด ใช้แบบแผนเดิม ไม่เพิ่ม dependency ไม่แก้ `package.json`
- ทุกจุดที่เพิ่มข้อความแจ้งผู้ใช้ ต้องมี "ทางไปต่อ" ในข้อความนั้น (สเปค §8) reviewer ตรวจข้อนี้ทุก PR
- ไม่แตะ `taxEvidenceStatus`/`inputVatClaimStatus` ด้วยเหตุที่อยู่ (สเปค E11)
- ไม่ย้าย mutation ใดไป LINE/AI

## ขอบเขต

อยู่ในขอบเขต: สเปค §3 Slice 1 (Phase 1–4) และ Slice 2 (Phase 5)

นอกขอบเขต: ฝั่งรายได้, ตัวพิมพ์ 50 ทวิ, merge คู่ค้า, ข้อมูลธนาคารคู่ค้า, deploy

## สัญญา Theme (บังคับทุกงานฝั่งเว็บของแผนนี้)

หน้าคู่ค้าเป็นหน้าใหม่หน้าแรกของโมดูลนี้ จึงต้องถูกบังคับให้อยู่ในระบบดีไซน์เดิมตั้งแต่บรรทัดแรก ห้ามสร้างชุดสีหรือชุดปุ่มของตัวเอง

**สี ตัวอักษร ระยะ** มาจาก `packages/design-tokens/generated/web/theme.css` เท่านั้น: `--color-brand-25..900` (brand-500 = #22c55e), `--color-gray-25..900`, `--color-success-*`, `--color-warning-*`, `--color-danger-*`, `--font-family-sans` ห้ามเขียนค่าสีดิบ (hex/rgb) ในไฟล์ใหม่ ยกเว้นกรณีที่ไฟล์ข้างเคียงทำอยู่แล้วและมีคอมเมนต์อธิบายเหตุผล

**คลาสสำเร็จรูป** ใน `apps/web/app/globals.css` ใช้ตามชื่อ ไม่สร้างใหม่: `mangmee-page` `mangmee-card` `mangmee-card-header` `mangmee-card-body` `mangmee-card-muted` `mangmee-input` `mangmee-btn` + `mangmee-btn-primary|secondary|danger` `mangmee-badge` + โทน `brand|sky|amber|rose|teal|slate|purple|lime|cyan|indigo|line|danger` `mangmee-table` `mangmee-table-scroll` `mangmee-tab` `mangmee-tab-active` `mangmee-segmented` `mangmee-stat-card` `mangmee-icon-frame` + `mangmee-icon-tone-*` `mangmee-safe-bottom`

**ตัวช่วยคลาส** นำเข้าจาก `@/features/expenses/ExpensesUi`: `inputClass` `btnClass` `ghostClass` `dangerClass` (ฝั่ง employee-access มีชุดชื่อเดียวกันแต่เป็น Tailwind ดิบ — ห้ามนำเข้าชุดนั้นมาใช้ในโมดูลนี้ เพราะจะได้ปุ่มคนละแบบ)

**คอมโพเนนต์ที่ต้องใช้แทนการเขียนเอง**

| ต้องการ | ใช้ |
|---|---|
| โครงหน้า หัวข้อ ปุ่มมุมขวา | `MangmeePage`, `MangmeeCard`, `MangmeeBadge`, `cx` จาก `@/common/components/mangmee` |
| ช่องกรอก | `TextField` `TextareaField` `SelectField` `SwitchField` `FieldError` จาก `@/common/components/field` หรือ `inputClass` กับ `<label>` จริงเมื่อต้องการโครงเอง |
| ดรอปดาวน์ / วันที่ / ไฟล์ | `ThemedSelect` `ThemedDate` `ThemedFile` (มี portal แก้ปัญหาแผงถูกตัดอยู่แล้ว ห้ามเขียน `<select>` ดิบในฟอร์มใหม่) |
| สถานะหน้า | `LoadingState` `ErrorState` `EmptyState` `ForbiddenState` `CoverLoader` จาก `@/common/components/state` |
| กล่องยืนยัน | `Modal` `AlertModal` `useConfirm` จาก `@/common/components/modal` |
| แถบขั้นตอน | `ThemedSteps` จาก `@/common/components/steps` |
| ไอคอน | ชุด `ICON` ใน `ExpensesUi.tsx` หรือ inline SVG stroke 1.9 แบบเดียวกัน ห้ามใช้อิโมจิ |

**เมนูและเส้นทาง** เพิ่มรายการเมนูที่ `packages/contracts/src/menu-entitlements.ts` ด้วยรูปแบบเดียวกับ `reimbursements` (`navKey` `labelTh` `group: 'finance'` `iconKey` `parentFeatureKey` `entitlementKeys` `gatePermissions` `status`) แล้วใส่ `navKey` ลง `DESIGN_HANDOFF_NAV_ORDER` ใน `WorkspaceLayout.tsx` ให้อยู่ต่อจาก `expenses` ห้ามแก้ลำดับรายการอื่น

**โครงไฟล์** ตาม `docs/guidelines/web-frontend-code-style.md`: `apps/web/src/features/counterparties/` แยก `*.api.ts` `*.model.ts` `*.logic.ts` และคอมโพเนนต์ ห้ามรวม markup กับ logic กับ API ในไฟล์เดียว

**มือถือมาก่อน** ออกแบบที่ 390 px ก่อนเสมอ เป้าแตะสูงอย่างน้อย 44 px ใช้ `dvh` ไม่ใช่ `vh` ไม่มี scroll แนวนอน ป้ายและชิปต้องไม่ล้นขอบ

**ตรวจก่อนส่งงาน** ผู้คุมงานจะ grep หาค่าสีดิบ `#` ในไฟล์ใหม่ และหา `<select` `<button class="bg-` ที่ไม่ผ่านคลาสกลาง งานที่ไม่ผ่านสองข้อนี้จะถูกตีกลับ

## Phase 0: Discovery และยืนยันสมมติฐาน

- [x] เจ้าของดูตัวอย่างหน้าจอรอบแรก (20 ก.ย. 2569) ให้ความเห็น 4 ข้อ: รหัสสาขาไม่บังคับและจัดแนวใหม่, ตัดกล่องเปรียบเทียบที่อยู่บนหน้าตรวจ, ไม่ใช้ dropdown สาขา, ตัดตัวเลือกประเภท → สเปค A4–A6 และ mockup v2
- [ ] เจ้าของดู mockup v2 และตอบ A1–A6 (หรือใช้ค่าที่สเปคเลือก)
- [ ] อ่านโค้ดจุดที่จะแก้อีกครั้ง: expense draft/review/confirm write paths, receipt-ocr-apply, counterparty repository, sync-tax-events, create-wht-certificate
- [ ] ยืนยันว่า `RdVatDetailAdapter` ยังไม่มีในโค้ด (ปุ่มดึงจากกรมสรรพากรจึงซ่อนไว้จนกว่าจะมี)

เกณฑ์ออก: A1–A4 มีคำตอบ

## Phase 1: ช่องที่อยู่บนรายจ่าย + ส่งออก + tax event + BUG-1 (API)

- [ ] `schema.prisma`: `ExpenseRecord.vendorAddressSnapshot String? @db.VarChar(500)` + migration idempotent ไม่ backfill
- [ ] contracts: `vendorAddressSnapshot` ใน detail/summary/inputs; `vendorSnapshotJson` เขียน `{id,name,taxId,branchCode,addressText}`
- [ ] draft/review-fields/update use cases + repository field list (`prisma-expense.repository.ts:905`) รับและคืนค่า; แก้ได้เฉพาะสถานะ DRAFT/NEEDS_REVIEW/READY_FOR_CONFIRMATION และยังไม่ถูกใบเบิกอ้างสิทธิ์ ตามกฎเดิมของหน้าตรวจ (CON-11)
- [ ] list filter `vendorAddressMissing=true` (null และ `sourceDocumentType = TAX_INVOICE`)
- [ ] `expense-export.logic.ts`: คอลัมน์ `vendor_address`
- [ ] `sync-tax-events.use-case.ts`: `payeeSnapshot.address` จากรายจ่าย → ทะเบียน → null (4 จุด)
- [ ] `packages/contracts`: `formatCompanyLegalAddress(addr): string`; `create-wht-certificate.use-case.ts:72` ใช้แทน `JSON.stringify` (BUG-1)
- [x] ที่อยู่ผู้ถูกหักบน handoff — ทำเป็นสามคอลัมน์ข้าง snapshot (`payeeAddress`, `payeeAddressByUserId`, `payeeAddressAt`) แทน `payeeAddressOverride` ใน prefill เพราะ prefill ถูกล็อกด้วย `prefillSnapshotHash` (2026-09-21)

ทดสอบ: spec ของ export, sync-tax-events (address precedence), create-wht-certificate (payer address เป็นข้อความ), draft/review use case (บันทึก/ล็อก), formatter golden vectors

เกณฑ์ออก: AC01 (เว็บยังไม่มีช่อง ทดสอบผ่าน API), AC07 ฝั่ง API, AC12

## Phase 2: ออโต้จับคู่และออโต้บันทึกคู่ค้า (API)

- [ ] `packages/contracts/src/accounting-documents.ts`: โครง `CounterpartyAddressV2` + helper `counterpartyAddressText(json)` ที่อ่านทั้ง v2 และคีย์เดิม
- [ ] domain logic ใหม่ใน accounting-documents: `matchVendorKey()` (A2), `normalizeThaiAddress()`, `decideVendorAutoSave()` คืนกรณี a/b/c/d แบบ pure โดยกรณี c อ่านธง `locked` (ไม่ล็อก = ล่าสุดเป็นหลัก)
- [ ] `type` ของคู่ค้าตั้งโดยระบบ: สร้างจากใบซื้อ = VENDOR, ถูกใช้ในเอกสารขายครั้งแรก = BOTH; DTO create/update ไม่รับ `type` จาก client (ยกเว้น CRM/procurement ที่ตั้งเองอยู่แล้ว)
- [ ] `EnsureVendorCounterpartyFromExpenseUseCase` (**ไม่เพิ่ม launch gate** — CON-3, audit source `expense_auto_link` ไม่มีค่าที่อยู่ใน metadata — CON-10, ไม่ผูก counterparty.manage, ไม่ล้มรายจ่าย) เรียกจาก expense draft/review/confirm และ `receipt-ocr-apply.service.ts`; ข้ามเมื่อ `captureSource='API_INTERNAL'` หรือมี `sourceReimbursementRequestId` (CON-4)
- [ ] จับคู่โดยไม่กรอง `type` (CON-12); เจอแถว CUSTOMER → เลื่อนเป็น BOTH; เติม `vendorEntityKindSnapshot` จากทะเบียนเมื่อว่าง และบันทึกค่าที่ผู้ตรวจเลือกกลับทะเบียน (CON-7)
- [ ] เลื่อน VENDOR → BOTH ใน transaction ของการเขียนเอกสาร/รับเงินฝั่งขาย (CON-1) พร้อมเทสต์ว่าเครื่องมือสรุปรายรับของ AI เห็นคู่ค้านั้น
- [ ] `receipt-ocr-apply.service.ts`: เพิ่ม `vendorAddressSnapshot` ในรายการห้ามทับหลัง `reviewedAt` (CON-5)
- [ ] `prisma-procurement.repository.ts`: เขียน `billingAddressJson` ผ่าน helper v2 (CON-9)
- [ ] `permission-registry.ts`: ADMIN ได้ `accounting.counterparty.read`/`.manage`; `pack.expense.review` ได้ `accounting.counterparty.read` (CON-2) + อัปเดต `permission-matrix.md`
- [ ] รหัสสาขา: DTO รับเฉพาะตัวเลข 5 หลัก เก็บ null เมื่อว่าง กุญแจจับคู่ถือ null = `00000` (CON-8)
- [ ] repository: `findVendorByKey`, `updateBillingAddressV2`, `appendSeenAddress` (สูงสุด 5), `promoteSeenAddress`
- [ ] endpoint `POST /counterparties/:id/promote-seen-address` (manage) + PATCH รับ `locked`; list/detail เพิ่ม `usage`, `addressMissing`, `search`, `recentExpenses`, `usageCounts`
- [ ] audit metadata: `addressChanged`, ไม่มีที่อยู่เต็ม; ตรวจ sanitizer

ทดสอบ: pure logic ครบสี่กรณี + normalize; use case failure isolation (repo throw → expense ยังสำเร็จ + flag); real-PG race สองใบพร้อมกัน; permission ของ promote

เกณฑ์ออก: AC02, AC03 ฝั่ง API, AC06, AC10, AC11

## Phase 3: หน้าจอเว็บ (คู่ค้า + ช่องบนหน้าตรวจ + ใบทดแทน)

- [ ] หน้าคู่ค้าใหม่ `apps/web/src/features/counterparties/` (list + detail/edit) route ใต้ workspace เมนู "คู่ค้า" ใต้ การเงินและบัญชี สิทธิ์ read/manage เดิม; ไม่มีตัวเลือกประเภท ใช้ป้ายการใช้งาน; การ์ดประวัติที่อยู่ + ปุ่ม "ใช้อันนี้เป็นหลัก" + สวิตช์ล็อก; รหัสสาขาไม่บังคับ
- [ ] ส่วน "ลูกค้าและคู่ค้า" ใน `AccountingPages.tsx` เหลือรายการล่าสุด + ลิงก์ "จัดการคู่ค้า"
- [ ] `ExpensesPages.tsx`: ช่อง "ที่อยู่ผู้ขายตามใบ" ใต้เลขภาษี + ป้าย AI/จากทะเบียน + hint "ใช้ที่อยู่นี้" + คำเตือนใบกำกับเต็มรูป (warning ไม่ใช่ error) + toast กรณี a/b และบรรทัดข้อมูลกรณี c (ไม่มีปุ่ม) ตามผล auto-save ที่ API คืน; แทนที่ตัวเลือกสาขาด้วย สำนักงานใหญ่/สาขา + ช่องรหัส 5 หลัก (ผูก `vendorBranchCodeSnapshot` เดิม)
- [ ] `expense-review-validation.ts`: ความยาว 500 (error มีข้อความแก้), warning สำหรับ TAX_INVOICE ว่าง
- [ ] `expenses.model.ts`: `AI_REVIEW_FIELD_KEYS.vendorAddressSnapshot = ['vendorAddress']`
- [ ] หน้ารายการรายจ่าย: ตัวกรอง "ใบกำกับที่ยังไม่มีที่อยู่ผู้ขาย"
- [ ] ใบทดแทน: prefill `payeeAddress` จาก `vendorAddressSnapshot` เมื่อชื่อผู้รับเงินตรงผู้ขาย
- [ ] workpaper ภ.พ.30: บรรทัด checklist จำนวนใบที่ยังไม่มีที่อยู่ (อ่านจาก list filter เดิม)

ทดสอบ: web logic/model specs; browser 390 px ทุกสถานะใน §11.1; e2e ตรวจใบ → toast → หน้าคู่ค้า

เกณฑ์ออก: AC03, AC04, AC05, AC09

## Phase 4: OCR อ่านที่อยู่ (D3 ก้าวที่สอง)

- [ ] `ReceiptOcrFieldResult`: `vendorAddress?`, `buyerAsPrinted?`; `missingFields` เพิ่ม `vendorAddress` เฉพาะ TAX_INVOICE
- [ ] AI gateway prompt/schema: ช่องแยกผู้ขาย/ผู้ซื้อ กฎ "ห้ามย้ายตัวตนผู้ซื้อไปช่องผู้ขาย"
- [ ] `receipt-ocr-apply.service.ts`: `completed.vendorAddress → vendorAddressSnapshot` (เฉพาะเมื่อผู้ใช้ยังไม่พิมพ์) และเก็บ `buyerAsPrinted` ไว้ใน `aiVerifiedFieldsJson` (Slice 2 ใช้)
- [ ] LINE: คำถามหนึ่งครั้งเมื่อ TAX_INVOICE และไม่มีที่อยู่ ตอบหรือข้ามได้ ไม่ถามซ้ำ; บรรทัดสรุปกรณี a
- [ ] fixture ใหม่ 3 ใบ + รันชุดทดสอบเดิมของสเปคความถูกต้องภาษี + `node scripts/run-line-ai-whole-chain-acceptance.mjs`

เกณฑ์ออก: AC08 และ LINE harness ผ่าน

## Phase 5: Slice 2 ผู้ซื้อตามที่พิมพ์ (ไม่บล็อก)

- [ ] `ExpenseRecord.buyerAsPrintedJson Json?` + migration
- [ ] pure `compareBuyerAsPrinted(printed, company, branch)` → MATCH/MISMATCH/UNCHECKED ด้วย normalize เดียวกับ Phase 2
- [ ] ตั้งค่าตอน OCR apply และตอนบันทึกการตรวจ; ไม่แตะ claimability
- [ ] เว็บ: แถบผลเทียบ + ปุ่ม [ยืนยันว่าใช้ได้ พร้อมเหตุผล] (audit) + [ทำเครื่องหมายใช้ภาษีซื้อไม่ได้] (ใช้ path เดิมของ inputVatClaimStatus โดยคน) + ลิงก์ตั้งค่าที่อยู่บริษัทเมื่อ UNCHECKED

เกณฑ์ออก: AC13

## การตรวจสอบเชิงบูรณาการ

- สัญญา API ↔ เว็บ: ฟิลด์เสริมทั้งหมด optional เว็บเดิมอ่านได้
- เส้นทางผู้ใช้: ร้านใหม่ครั้งแรก (toast + คู่ค้าใหม่), ร้านเดิม (เติมเอง), ที่อยู่ต่าง (แถบ + แตะเดียว), LINE ใบกำกับ (ถามครั้งเดียว), 50 ทวิ prefill
- คำสั่ง:

```bash
pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/domain/logic/expense-export.logic.spec.ts src/modules/tax/application/use-cases/sync-tax-events.use-case.spec.ts src/modules/tax/application/use-cases/create-wht-certificate.use-case.spec.ts
```

```bash
pnpm --filter @watchdog-bms/web test
```

```bash
node scripts/run-line-ai-whole-chain-acceptance.mjs
```

## ความเสี่ยง

- แถวคู่ค้าซ้ำจากเลขภาษีอ่านผิด (GAP-8): toast ทำให้เห็นทันที เครื่องมือรวมเป็นงานถัดไป
- การผูก `vendorCounterpartyId` ครั้งแรกจะทำให้ตัวตรวจรายการซ้ำให้คะแนนคู่ค้า+วัน+ยอด (+25) ซึ่งไม่เคยทำงานมาก่อน ใบที่เคยผ่านอาจขึ้นเป็นรายการซ้ำ (CON-6) ต้องระบุใน release note และยืนยันว่าเป็นคำเตือนที่ปลดได้
- OCR ต้นทุนเพิ่มต่อใบเล็กน้อย ติดตามจาก AiUsageEvent หลังปล่อย
- `ExpensesPages.tsx` ใหญ่: เพิ่มช่องแบบเดียวกับเลขภาษีเท่านั้น ไม่ปรับโครง
- ที่อยู่ผู้ขายบุคคลธรรมดาเป็นข้อมูลส่วนบุคคล: audit/log ห้ามมีค่าเต็ม ตรวจด้วย scan test เดิมของ sanitizer

## คำถามเปิด

- ไม่มีที่บล็อก เจ้าของยืนยัน A1–A4 ใน Phase 0
