# Agent Memory: vat-registration-aware-expense-capture

Status: **IMPLEMENTED** 2026-08-05 — spec v1.2 / plan v1.2, step 1–7 ครบ commit แล้ว 6 คอมมิต (8190efaf → 8bbc1cfc)
Owner: thawtchai

Scope: ให้ flow บันทึกค่าใช้จ่าย/ใบเสร็จ รองรับ **ทั้งสองแบบ** — บริษัทที่ไม่ได้จด VAT เห็นฟอร์มเรียบง่าย, บริษัทที่จด VAT เห็นเหมือนเดิมทุกอย่าง. ไม่แตะ Tax Workspace, ไม่แตะฝั่งขาย, ไม่แตะ wizard ตอบสถานะ VAT (A4 ของ company-tax-identity-setup เป็นเจ้าของ)

## Decisions

- แยก 2 อย่างให้ขาด: **`vatStatus`** = fact (tri-state, dated, HIGH risk) vs **`captureMode`** = presentation policy (FULL/SIMPLE, derived, ไม่ persist, ไม่ audit, ไม่ใช้ตัดสินความถูกต้องทางภาษี)
- derivation (แก้แล้วตอน step 2 review): `REGISTERED → FULL` · `NOT_REGISTERED → SIMPLE` · `UNKNOWN → thai_tax ? FULL : SIMPLE` — **fact ที่ตอบแล้วชนะ entitlement เสมอ**
- แขน `UNKNOWN + entitled → FULL` คือกันไม่ให้บริษัทเดิม regress ตอน deploy (ทุกบริษัทจริงตอนนี้เป็น UNKNOWN) — อ่าน entitlement ไม่ใช่สร้าง proxy ของสถานะจด VAT (ตรงกับบทเรียนที่ company-tax-identity-setup บันทึกไว้ว่าห้ามสร้าง proxy)
- ประเมิน mode ด้วย **`expenseDate` ไม่ใช่ today** — เอกสารก่อนวันจด VAT ต้องเป็น SIMPLE
- ซ่อน ≠ ลบ: ข้อมูลภาษีที่มีอยู่ห้ามถูก null/zero/rewrite และ expense ที่มี `vatAmount ≠ 0` หรือมี Tax Code ต้อง render FULL เสมอแม้ workspace เป็น SIMPLE
- guard ที่ API อิง fact อย่างเดียว วางที่ **confirm** (จุดบรรจบเดียว) ไม่ใช่ที่ draft write: `NOT_REGISTERED` + `CLAIMABLE` → 400 `input_vat_not_available_company_not_vat_registered`; **`UNKNOWN` ห้าม block** (ไม่มี fact ไม่ใช่ fact)
- endpoint ใหม่ mask `vatStatus` เป็น `HIDDEN` ถ้าไม่มี `company.vat_registration.read` — เสมียนได้ฟอร์มถูกต้องโดยไม่รู้สถานะภาษีบริษัท
- **export ห้ามผูกกับ captureMode** (owner Q1 นำไปสู่ข้อนี้): CSV เป็น machine contract แบบ fixed column order, XLSX ที่มีคอลัมน์ VAT เป็นศูนย์คือคำจริง ไม่ใช่เศษ — ปล่อยให้ presentation policy ไปกำหนดรูปร่างไฟล์ที่ออกนอกระบบ = ความสับสนเดียวกับที่ spec นี้ตั้งใจกันไว้ (AC13 เป็น regression test)
- ถามสถานะ VAT inline gate ด้วย **permission ล้วน ไม่เช็ค role** (owner Q2) — `pack.company.vat_registration.manage` มีไว้ delegate ให้บัญชีอยู่แล้ว

## Discovery — ข้อเท็จจริงที่ตรวจจากโค้ดจริง (2026-08-05)

- โมเดล VAT registration เป็น dated interval + tri-state accessor มีครบแล้ว: `data-model-core/domain/logic/company-vat-registration.logic.ts:68`
- endpoint `GET/PUT /v1/companies/:companyId/vat-registration` (รองรับ `asOf`) มีแล้ว: `company-vat-registration.controller.ts:54,66`
- **web ไม่เคยอ่านสถานะจด VAT เลยแม้แต่ที่เดียว** — `rg 'vatRegistered|vat-registration' apps/web/src` เจอ 1 hit ที่ไม่เกี่ยว
- **ไม่มีที่ไหนเขียน `VatRegistrationPrompt` เลย** มีแต่ `findFirst` 2 จุดใน `company-identity.use-case.ts:75,341` → `sellerIdentityCompleteHO` เป็นจริงไม่ได้ และทุกบริษัทจริงติด `UNKNOWN` ถาวร
- การ์ด Tax Code ในหน้าบันทึกด้วยมือ render ไม่มีเงื่อนไข: `ExpensesPages.tsx:1552`
- `GET tax/code-definitions` gate ด้วย `company.branch.read` เท่านั้น ไม่มี `thai_tax`: `transaction-tax.controller.ts:125`
- Ledger ปลอดภัยอยู่แล้ว — `normalizeExpenseVatForLedger` zero VAT ของ expense ที่ไม่ claimable ก่อนลงบัญชี: `journal.use-case.ts:70` (ตรวจแล้วไม่ใช่บั๊ก)
- Tax sync ปลอดภัยอยู่แล้ว — สร้าง `VAT_INPUT` เฉพาะ `CLAIMABLE` + `USABLE_FOR_TAX`: `sync-tax-events.use-case.ts:217`
- โมดูล ภาษี ถูก gate ด้วย `thai_tax` อยู่แล้ว (`capability-pack.registry.ts:410`) + เมนู gate ด้วย permission (`web-core-workspace.constants.ts:192`) → ซ่อนได้โดยไม่ต้องแก้โค้ด

## Gaps/Bugs ที่เจอ (จัดลำดับ)

| # | เรื่อง | ระดับ | เจ้าของ |
| --- | --- | --- | --- |
| G1 | ไม่มีที่ไหนในผลิตภัณฑ์ถามคำถาม "จด VAT ไหม" เลย | High | company-tax-identity-setup A4 |
| G2 | ฝั่งขายออกเอกสารไม่ผ่าน `taxInvoiceEligible` — บริษัทไม่จด VAT ลง OUTPUT_VAT ได้ (`journal.use-case.ts:110`) ต่างจากฝั่ง expense ที่มี guard | High | company-tax-identity-setup §7 — **นอก scope งานนี้ ต้อง escalate** |
| G3 | `GET tax/code-definitions` ไม่มี entitlement gate | Medium | feature-entitlement |
| G4 | selector โชว์ CTA "ตั้งค่าภาษี" ให้คนที่ทำไม่ได้ (`TransactionTaxLineSelector.tsx:128`) — บั๊ก UI ที่มีอยู่จริงตอนนี้ | Medium | งานนี้ (แก้ได้แยก ลงก่อนได้) |
| G5 | upload สร้าง draft เป็น `NEEDS_REVIEW` เสมอ (`expense-upload.use-case.ts:63`) → คิวรกสำหรับบริษัทไม่จด VAT (ไม่ block confirm) | Low | งานนี้ |
| G6 | บริษัท `NOT_REGISTERED` ถูกดันไป `CLAIMABLE` ได้ ไม่มี layer ไหนเช็ค registration | High ถ้า `thai_tax` เปิด | งานนี้ §7.6 |
| G7 | **แก้แล้ว 2026-08-05** — `ExpenseCategory.inputVatDefault` เป็น dead config; สำรวจต่อพบว่ากว้างกว่าที่คิด: **ไม่มี field ไหนของ `ExpenseCategory` ถูกสืบทอดลง expense เลยสักตัว** (`taxCategory`, `accountHintKey` ก็เหมือนกัน — ตัวที่ ledger ใช้จริงอยู่บน `ExpenseRecord`/`ExpenseLine` ชื่อซ้ำแต่คนละคอลัมน์) ถอด UI + contract + repository mapping ออกแล้ว เก็บคอลัมน์ Prisma ไว้ (มี DB default และ drop เป็น migration ที่ย้อนไม่ได้) | Medium | เสร็จ |
| G8 | report `expense.accountant_evidence` gate ด้วย `expense.export` ไม่มี `thai_tax` และ dimension เดียวคือ `taxEvidenceStatus` → บริษัทไม่จด VAT รันได้แต่กลุ่มคงที่ | Low cosmetic | reports/entitlement นอก scope |

## Export impact (ตรวจตามที่ owner ถาม) — **ไม่กระทบ และตั้งใจไม่ให้กระทบ**

- index **CSV** `buildAccountantIndexCsv` ใช้ `ACCOUNTANT_INDEX_COLUMNS` เต็มเสมอ + contract บอกชัดว่าเป็น "machine-key CSV … for system-to-system consumers" (`packages/contracts/src/expenses.ts:838`) → **ห้ามแตะ** ตัดคอลัมน์ = พัง parser ที่อิงลำดับ
- index **XLSX** `summary` (default ของ UI `ExpensesPages.tsx:1180`) มี `vat_amount` → บริษัทไม่จด VAT ได้คอลัมน์ศูนย์ ซึ่งเป็นคำจริงและเป็นสิ่งที่สำนักงานบัญชีอยากเห็น → ไม่แตะ
- XLSX `full` เพิ่ม `taxable_amount`/`wht_amount`/`tax_evidence_status`/`tax_evidence_reason`/`vendor_tax_id`/`vendor_branch_code`/`company_tax_id` → ไม่แตะ
- evidence manifest มี `tax_evidence_status` ต่อไฟล์ → ไม่แตะ
- export อีกทางที่ hardcode `columnSet:'full'` อยู่ที่ `ExpensesWorkspacePanels.tsx:449` → ไม่แตะ
- report `tax.summary` gate ด้วย `tax.report.read` (permission ของ `thai_tax`) → หายเองอยู่แล้ว ไม่ต้องทำอะไร
- ledger + tax sync ตรวจแล้วปลอดภัยอยู่แล้วทั้งคู่

## Open questions

ไม่มี — Q1 ซ่อนทั้งคอลัมน์และตัวแก้ · Q2 ตาม permission ล้วน · Q3 G2 อยู่ใต้ company-tax-identity-setup ยืนยันแล้ว

## Artifacts

- `docs/specs/vat-registration-aware-expense-capture-spec.md`
- `docs/plans/vat-registration-aware-expense-capture-plan.md`

## Verification (รันซ้ำทุก step ไม่ใช่ทีเดียวตอนจบ)

- `apps/api` npm test → 0 failures · `apps/web` npm test → 681/681
- `pnpm test:boot` (boot-di-smoke) → Nest resolve provider ครบ — **จำเป็น** เพราะ unit test จับ DI error ไม่ได้
- tsc --noEmit ผ่านทั้งสอง package
- footprint: 26 ไฟล์ +1157/-32 · ledger, tax sync, contracts, expense-export.logic.ts **ไม่ถูกแตะเลย** (ยืนยันด้วย git diff --stat)

## บทเรียนจากงานนี้ (ใช้ซ้ำได้)

- **review ต่อ step จับบั๊กจริง**: step 2 discovery เจอว่า `thai_tax` เป็น ON by default (`DEFAULT_ENABLED_FEATURE_KEYS`, owner decision 2026-08-04) → derivation แบบ entitlement-first ของ step 1 จะโชว์ UI ภาษีเต็มให้บริษัทที่ตอบ `NOT_REGISTERED` ไปแล้ว แล้ว claim guard ก็จะ reject สิ่งที่ UI นั้นชวนให้ทำ → แก้เป็น "answered fact ชนะ entitlement"
- **ผลพ่วงเชิง product**: เพราะ `thai_tax` default on บริษัทจะถึง SIMPLE ก็ต่อเมื่อ *มีคนตอบคำถาม VAT* → step 6 (ถามคำถาม) คือ step ที่ส่งมอบคุณค่าจริง ไม่ใช่ของแถมตอนท้าย
- **guard ที่จุดบรรจบ ไม่ใช่ทุก write site**: `finalizeAndConfirmExpenseCas` มี caller เดียว และทุกช่องทาง (web/LINE/AI/reimbursement) ผ่านมันหมด → guard ที่ confirm ครอบคลุมกว่าและ diff เล็กกว่า guard ที่ draft write
- **LOADING ต้องเป็น state ที่สาม**: default เป็น FULL ระหว่างรอ = กระพริบการ์ด Tax Code ใส่ user ที่งานนี้ตั้งใจช่วย; default เป็น SIMPLE = กระพริบ field หายใส่บริษัทที่จด VAT
- **ปล่อย code error โดยไม่มี label = ผู้ใช้เห็น snake_case ดิบ** → เพิ่ม Thai label ใน `api-error-message.ts` คอมมิตเดียวกับ error code เสมอ

## Next

- **G7 ปิดแล้ว** — ถอดทิ้ง ไม่ wire เพราะ claimability ปัจจุบันเป็นของ **Tax Code รายบรรทัด** (`TaxCodeDefinition.claimabilityDefault` → `snapshot.claimability`) การ wire ค่า default ระดับหมวดหมู่กลับมา = สร้างแหล่งความจริงที่สองที่ขัดกับ Tax Code ได้
- **เหลือให้ owner ตัดสินถ้าอยากเก็บกวาดต่อ**: drop คอลัมน์ `ExpenseCategory.inputVatDefault` (+ `taxCategory` ถ้าจะเอาด้วย) เป็น migration แยก · ถ้าอยากได้ฟีเจอร์ "หมวดหมู่แนะนำภาษี" จริง ให้ผูก หมวดหมู่ → Tax Code เริ่มต้น ไม่ใช่ → claimability
- **G9 (เจอตอนตอบคำถาม G7)**: ไม่มี UI ไหนในเว็บส่ง `inputVatClaimStatus: 'CLAIMABLE'` เลย → path ขอคืนภาษีซื้อแบบ header-level เข้าจากเว็บไม่ได้ สอดคล้องกับว่าโมเดลนั้นถูกแทนที่ด้วย Tax Code รายบรรทัดแล้ว แต่ควรยืนยันว่าตั้งใจ
- **G2 (ฝั่งขายไม่มี registration gate)** อยู่ใต้ company-tax-identity-setup §7 — ยังไม่มีใครทำ
- **A4 ของ company-tax-identity-setup** ยังเป็นเจ้าของ wizard onboarding + prompt table; คำตอบที่สาม "ไม่แน่ใจ" รอ A4
- E2E ตาม spec §15 ยังไม่ได้เขียน (unit + boot smoke ครอบแล้ว)
