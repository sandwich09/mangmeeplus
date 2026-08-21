# Spec: ช่องว่างและข้อบกพร่องระบบการเงิน–บัญชี (Finance & Accounting Gaps)

- สถานะ: **DRAFT — รอทีมตัดสินใจรายข้อ**
- ฐานโค้ดที่ตรวจ: `origin/develop` @ `8d86485` (+ PR #44)
- วันที่ตรวจ: 2026-07-28
- วิธีตรวจ: อ่านโค้ดจริง + **รัน `compileRole` จริง** กับทุก preset ที่เกี่ยว (ไม่ใช่อ่านอย่างเดียว) — ทุก claim มี file:line กำกับ

---

## 0. โครงสร้างที่ถูกต้องอยู่แล้ว (invariant — ห้าม regress)

การแบ่ง FINANCE / ACCOUNTANT ของ **system role** ออกแบบถูกต้องตามหลัก segregation of duties และแนวปฏิบัติบัญชีไทย:

| หลักการ | โค้ดที่บังคับ |
|---|---|
| FINANCE = คนเดินเงิน (AR/AP, จ่าย-รับเงิน, ธนาคาร, ออกใบกำกับภาษี) — post GL / ปิดงวดไม่ได้ | `ROLE_GRANTS.FINANCE` — `apps/api/src/modules/auth/permission-registry.ts:629-697` |
| ACCOUNTANT = คนปิดสมุด (post/reverse journal, ปิด-เปิดงวด, ผังบัญชี, ตั้งค่าภาษี, ปิดกระทบยอด) — ออกเอกสาร/จ่ายเงินไม่ได้ | `ROLE_GRANTS.ACCOUNTANT` — `permission-registry.ts:698-744` |
| มอบ role การเงิน/บัญชีต้องผ่าน OWNER (`access.role.financial.assign`) | `employee-access.logic.ts:26-28` |
| Vendor bill maker-checker กันที่ระดับ **user** (คนยื่นอนุมัติเองไม่ได้ แม้ role เดียวกัน) | `vendor-bill.use-case.ts:446-448`; FINANCE ไม่อยู่ใน `SELF_APPROVAL_EXEMPT_ROLES` (`procurement.logic.ts:280-284`) |
| เบิกจ่ายแยก 2 ด่าน: MANAGER อนุมัติ → FINANCE จ่าย | `reimbursement.approve` (MANAGER) vs `reimbursement.payment.record` (FINANCE) |

**ตรวจแล้ว ไม่ใช่บั๊ก:**
- FINANCE เห็นเมนู "ปิดงวด" แบบ read-only (`ledger.period.read`) — ถูกต้อง ฝ่ายการเงินต้องรู้สถานะงวด แต่ปิดเองไม่ได้ (สิทธิ์ปิดเป็นของ OWNER+ACCOUNTANT ตรงตามหลักผู้ทำบัญชีตาม พ.ร.บ.การบัญชี 2543)
- FINANCE ถือทั้ง `vendor_bill.create` และ `.approve` — ปลอดภัย เพราะกัน self-approval ที่ระดับ user แล้ว

---

## GAP-01 · Job preset การเงิน/บัญชี ขาดสิทธิ์อ่าน — role ที่สร้างใช้งานจริงไม่ได้

**ประเภท:** บั๊ก (ยืนยันด้วยการรัน `compileRole` จริง) · **Priority: P1** · **Effort: S** · **สถานะ: ✅ แก้แล้ว — ยืนยันด้วยการรันเทสต์จริง 2026-08-14**

> **ยืนยัน 2026-08-14:** `FINANCE_PACKS` (`role-template.registry.ts`) มี `.view` pack ครบแล้ว (billing/payment/bank/procurement/expense/tax) และ `tpl.x.accounting` มี `pack.ledger.view` + `pack.tax.view` แล้ว · guard test มีจริง 2 ไฟล์: `role-template-read-coverage.spec.ts` และ `role-template-system-role-parity.spec.ts` · รันผ่าน 24/24 รวม assertion "tpl.x.finance holds all 24 finance reads" และ "every preset grants the paired .read for every write it grants" (acceptance ข้อ 4 ของ spec นี้)

### ปัญหา

`FINANCE_PACKS` (`apps/api/src/modules/employee-access/domain/registries/role-template.registry.ts:17-20`) ประกอบจาก pack ประเภท operate/issue/manage ล้วน **ไม่มี pack `.view` เลย** ทั้งที่ pack `.view` มีครบทุก domain ใน registry

ผล compile จริง (entitlement ครบ + granter = OWNER = กรณีดีที่สุด):

| preset | สิทธิ์รวม | read | ขาด read คู่งานเขียน | เมนูที่เห็น |
|---|---|---|---|---|
| `tpl.x.finance` (+ อีก 3 preset อุตสาหกรรมที่แชร์ `FINANCE_PACKS`) | 79 | **6** (มีแต่ session/attachment/branch/dashboard/notification/task) | **24 ตัว** | **4/28** — dashboard, workflow, reimbursements, notifications |
| `tpl.x.accounting` | 58 | 30 | **6 ตัว** (`ledger.account/period/posting-rule.read`, `tax.config/period/profile.read`) | 11/28 — **ไม่เห็นเมนู journal, tax, closing, reports** ทั้งที่ post journal + ปิดงวดได้ |

ตัวอย่างความพัง: role จาก preset "การเงิน" ออกใบแจ้งหนี้ได้ (`accounting.invoice.create/issue`) แต่ไม่มี `accounting.invoice.read` → เปิดหน้ารายการใบแจ้งหนี้ไม่ได้ · อนุมัติบิลเจ้าหนี้ได้แต่ไม่มี `procurement.vendor_bill.read` · confirm ค่าใช้จ่ายได้แต่ไม่มี `expense.read`

Preset นี้ถึงมือผู้ใช้จริงแล้ว — UI เรียก `listRoleTemplates` ที่ `apps/web/src/features/employee-access/EmployeeAccessPages.tsx:729`

**system role `FINANCE`/`ACCOUNTANT` ที่ seed ไว้ ไม่กระทบ** — บั๊กอยู่เฉพาะเส้นทางสร้าง custom role จาก preset

### การแก้

1. **`FINANCE_PACKS` เพิ่ม:** `pack.billing.view`, `pack.payment.view`, `pack.bank.view`, `pack.procurement.view`, `pack.expense.view`, `pack.tax.view`, `pack.cash.view`
2. **`pack.reimbursement.finance` มี `'reimbursement.read'` ในตัว pack เอง** — ใช้สำหรับผู้ตรวจและจ่ายครบวงจร โดยไม่พ่วง `reimbursement.approve`
3. **เพิ่ม `pack.reimbursement.review`** สำหรับดู/ตรวจการเงิน/ส่งออกโดยไม่ให้ payment record/void หรือ duplicate resolution และเพิ่ม pack นี้ใน `tpl.x.accounting`; จึงประกอบสิทธิ์ให้ ACCOUNTANT, STAFF หรือ custom role ได้โดยไม่ over-grant
4. **`tpl.x.accounting` เพิ่ม:** `pack.ledger.view`, `pack.tax.view`

ข้อควรระวัง: pack `.view` ทุกตัวเป็น read-only อยู่แล้ว (ยืนยันจาก registry) — การเพิ่มต้องไม่พาสิทธิ์เขียนติดมา

### Acceptance criteria

1. compile `tpl.x.finance` แล้วต้องถือ read ครบ 24 ตัวที่เคยขาด: `accounting.{billing_note,counterparty,credit_note,debit_note,document,invoice,payment,receipt}.read`, `bank.{account,adjustment,match,reconciliation,statement}.read`, `expense.read`, `procurement.{goods_receipt,purchase_order,supplier,supplier_payment,vendor_bill}.read`, `reimbursement.read`, `tax.{certificate,event,report,review_issue}.read`
2. เมนู sidebar ของ role จาก `tpl.x.finance` ต้องรวม: expenses, accounts-payable, banking, tax, reimbursements, salesdoc (ตรวจผ่าน `filterModulesByPermissions` + `WORKSPACE_MODULES`)
3. compile `tpl.x.accounting` แล้วเห็นเมนู journal, tax, closing, reports
4. **Guard test ระดับระบบ (สำคัญสุด):** สำหรับ**ทุก** template ใน `ROLE_TEMPLATES` — ทุก permission เขียนที่มีคู่ `.read` อยู่จริงใน `PERMISSIONS` registry ต้องได้ `.read` นั้นมาด้วยหลัง compile (กันบั๊กชนิดนี้ทั้งชั้น ไม่ใช่แค่ 2 preset นี้)
5. ผล compile ต้องไม่มีสิทธิ์เขียนเพิ่มจากเดิมแม้แต่ตัวเดียว (เทียบ snapshot ก่อน-หลัง)

### Test plan

- Unit test ใหม่ใน `apps/api/src/modules/employee-access/domain/logic/` (เช่น `role-template-read-coverage.spec.ts`) รันด้วย node:test ตาม convention ของ repo
- รัน: `corepack pnpm --filter @watchdog-bms/api test` (เพิ่มไฟล์เข้า test list ใน `apps/api/package.json`)

---

## GAP-02 · เงินเบิกจ่ายไม่เคยลงสมุดบัญชี และด่านปิดงวดไม่ตรวจ

**ประเภท:** ช่องว่างเชิงบัญชี (ยืนยันแล้ว) · **Priority: P1** · **Effort: M** · **สถานะ: ✅ ตัดสินใจแล้ว — ทาง B (2026-07-28) · กำลัง implement**

### หลักฐาน

- ตอนอนุมัติคำขอเบิก ระบบตั้ง `postingStatus: 'pending'` (`reimbursement-approval.use-case.ts:97`) แต่ **ไม่มีโค้ดใดในโมดูล ledger อ้างถึง reimbursement เลย** → ค้าง `pending` ตลอดกาล
- ด่านปิดงวด `source_postings_complete` (`period.use-case.ts:116-130`) ตรวจ 5 แหล่ง: เอกสารขาย, การรับเงิน, ค่าใช้จ่าย, บิลเจ้าหนี้, จ่ายซัพพลายเออร์ — **ไม่มีเบิกจ่าย**
- *แก้ไขข้อมูลจาก spec ฉบับแรก:* `expense.claim` ใน seed เป็น **document sequence** (เลขที่เอกสาร EXP-) ไม่ใช่ posting rule

**ผลลัพธ์:** ปิดงวดสำเร็จได้ทั้งที่มีเงินสดจ่ายออกจริง (สถานะ `PAID`) ที่ยังไม่ลง GL

### การตัดสินใจ (2026-07-28)

เลือก **ทาง B** — แปลงใบเบิกเป็น expense record แล้ววิ่งท่อ expense เดิม ลงบัญชี 2 จังหวะ:
จังหวะ 1 ตอนอนุมัติ `Dr ค่าใช้จ่าย / Cr เจ้าหนี้พนักงาน` · จังหวะ 2 ตอนจ่าย `Dr เจ้าหนี้พนักงาน / Cr ธนาคาร`

พร้อมเคาะ 3 ข้อ:
1. **เพิ่มบัญชีใหม่ `2130-01 เจ้าหนี้พนักงาน` (LIABILITY)** — แยกชัดจากเจ้าหนี้การค้า `2120-01`
2. สร้าง expense เป็น `READY_FOR_CONFIRMATION` ตอนอนุมัติ → การเงิน confirm ระหว่าง finance review · บริษัทที่ไม่เปิด finance review → auto-confirm ด้วยค่า default (`vatMode=NO_VAT`, `inputVatClaimStatus=NON_CLAIMABLE` — ใบเสร็จนามพนักงานเคลม VAT ไม่ได้)
3. ⏸ **เลื่อน:** mapping `ReimbursementLine.categoryKey` (free text) → `ExpenseCategory` — วันนี้ posting engine ไม่ใช้หมวดเลือกบัญชี (ลง `5310-01` ทั้งหมด) จึงเป็นเรื่อง reporting ล้วน · **ต้องกลับมาทำเมื่อมี posting rule ต่อหมวดจริง** (มี reminder ใน memory ของผู้ช่วยแล้ว)

### ข้อเท็จจริงที่พบเพิ่มตอนสำรวจลึก (กระทบดีไซน์)

1. **ท่อ expense post จังหวะเดียว** — template `expense.payment` มีในโค้ดแต่ unreachable: `canonicalSource` ผลิตแต่ event `confirmed`/`voided` และ idempotency ยึด 1 journal ต่อ `(sourceType, sourceId)` (`journal.use-case.ts:351-357,409`) → จังหวะจ่ายของสะพานต้องเพิ่ม source ใหม่ `reimbursement.payment` (key ต่อ payment id)
2. **ไม่มี PostingRule ใน DB เลย** — ใช้ default ฝังโค้ด: Dr `5310-01` / Cr `2120-01` เจ้าหนี้การค้า hardcode (`posting-engine.logic.ts:107-117`) → ต้องเพิ่ม event variant `expense.claim.confirmed` สำหรับ expense ที่เกิดจากใบเบิก เพื่อ Cr `2130-01`
3. **Posting ทั้งระบบเป็น manual** — `POST posting/generate` เรียกจากหน้า AP เท่านั้น ไม่มี auto-post หลัง confirm
4. `linkedExpenseId` วันนี้ = expense ที่พนักงานแนบเป็นหลักฐานเอง + กัน double-claim (`reimbursement-evidence.service.ts:35-38`) — สะพาน reuse ฟิลด์นี้: line ที่มี link แล้ว**ไม่สร้าง expense ซ้ำ**

### แผน implement (อนุมัติแล้ว 2026-07-28)

| Phase | งาน | Effort | สถานะ |
|---|---|---|---|
| 0 | ยืนยันบั๊ก expense payment pending (→ GAP-07) + เคาะ 3 คำถาม | — | ✅ เสร็จ |
| 1 | บัญชี `2130-01` + ฟิลด์ `sourceReimbursementRequestId` บน ExpenseRecord + posting engine: `expense.claim.confirmed` / `reimbursement.payment` | S | ✅ เสร็จ (PR-1) |
| 2 | สะพานสร้าง expense ตอนอนุมัติ (idempotent, ข้าม line ที่ link แล้ว, default VAT, เขียน `linkedExpenseId` กลับ, `postingStatus` truthful) | M | ✅ เสร็จ (PR-1) |
| 3 | จังหวะจ่าย: posting source `reimbursement.payment` (pending→posted ผ่าน markSource) · void posted → true reversal ในtransaction เดียว (mirror `voidExpenseTrueReversal`) · worklist `GET reimbursements/posting/pending` | S | ✅ เสร็จ (PR-1) |
| 4 | ด่านปิดงวด blocker ที่ 6 — **ต้อง merge หลัง PR-1 เสมอ** (ลงก่อน = ปิดงวดไม่ได้ทั้งระบบ) | S | รอ (PR-2) |
| 5 | ตรวจอิสระ + e2e จริง | S | ✅ เสร็จ — ทดสอบครบ lifecycle บนแอปจริง: ยื่น→ADMIN อนุมัติ→expense เกิด→confirm (EXP-202607-00003)→accrual Dr 5310-01/Cr 2130-01→จ่าย→settlement Dr 2130-01/Cr 1110-01 (ยอด 2130-01 = 0)→void→reversal (ยอดกลับมา 1,000) |

**Deviation ที่บันทึก (Phase 2):** ไม่ auto-confirm กรณี `financeReviewRequired=false` — `ConfirmExpenseUseCase` บังคับสิทธิ์ `expense.confirm` + ตรวจใบเสร็จซึ่ง context ผู้อนุมัติไม่มี; expense รอการเงิน confirm เสมอ (ด่าน Phase 4 จับตัวค้าง)

**Follow-ups ค้าง:** (ก) UI ปุ่มลงบัญชี + หน้า worklist settlement — ฝั่ง web · (ข) copy `missingReceiptReason` จากใบเบิก → expense · (ค) ใบเบิกไม่มีใบเสร็จ: ✅ **เคาะแล้ว (2026-07-29): คงเข้ม** — expense จากใบเบิกไร้ใบเสร็จต้องผ่านพิธีใบรับรองแทนใบเสร็จ (ISSUED) ก่อน confirm เสมอ ไม่ผ่อน — หลักฐานภาษีต้องแน่น (สะพาน copy missingReceiptReason ให้แล้ว การเงินไม่ต้องพิมพ์ซ้ำ)

**การส่งมอบ:** PR-1 = Phase 1+2+3 (สะพาน+posting) · PR-2 = Phase 4 (blocker)

### Acceptance criteria

1. อนุมัติใบเบิก → เกิด expense record ต่อ line ที่ยังไม่มี link (`READY_FOR_CONFIRMATION`, branch จากคำขอ) · อนุมัติซ้ำ/retry ไม่สร้างซ้ำ
2. confirm expense (โดยการเงิน หรือ auto) → journal `Dr 5310-01 / Cr 2130-01` (+VAT/WHT ตามเดิม)
3. จ่ายเงินเบิก → journal `Dr 2130-01 / Cr 1110-01` idempotent ต่อ payment · void → true reversal
4. `postingStatus` ของใบเบิกสะท้อนสถานะจริงของ expense ที่ลิงก์
5. ปิดงวดที่มีใบเบิกค้าง post → FAILED พร้อมจำนวน (Phase 4) · ไม่มีใบเบิก → ทำงานเหมือนเดิม
6. Line ที่พนักงานลิงก์ expense เดิม → ไม่เกิด expense ใหม่ และ double-claim guard เดิมไม่เสีย

### Approve/visibility logic จากทีม (2026-07-28) — สถานะการรองรับ

| ข้อ | Logic จากทีม | สถานะ |
|---|---|---|
| 1 | พนักงานผู้สร้างใบเบิกเห็นสถานะของตัวเอง (อนุมัติแล้ว/รอการเงินโอนคืน) | ✅ มีอยู่แล้ว — ทุก role ที่สร้างใบเบิกได้ถือ `reimbursement.read_own` และ detail แสดง status/paymentStatus |
| 2 | บัญชี + owner เห็นรายการที่การเงินยังไม่โอน/ค้างจ่าย | ✅ มีอยู่แล้ว — ACCOUNTANT ถือ `reimbursement.read` + `finance_review` → เห็น `/finance-queue` (FINANCE_REVIEW / READY_FOR_PAYMENT / PARTIALLY_PAID); OWNER เห็นทุกอย่าง |
| 3 | สิทธิ์การเห็นนี้ set ให้ role อื่นได้ **โดย owner เท่านั้น** | ✅ ทำแล้ว — `ownerGatedGrantViolation` (`employee-access.logic.ts`): การใส่ `reimbursement.read` ลง custom role (create/update) ต้องถือ `access.role.financial.assign` ซึ่งเป็นของ OWNER คนเดียว — ปิดช่องที่ ADMIN (ถือทั้ง `access.role.manage` และ `reimbursement.read`) แจกสิทธิ์นี้เองได้ |
| 4 | ผู้อนุมัติ = manager/admin/owner | ✅ ทำแล้ว — ดู GAP-06.6 |
| 5 | **Default ADMIN ให้ permission ใครไม่ได้** จนกว่า owner จะมอบ | ✅ ทำแล้ว (เคาะขอบเขต: ตัดเฉพาะจัดการ role) — ถอน `access.role.manage` / `admin.role.manage` / `access.role_template.manage` ออกจาก ADMIN default; owner มอบอำนาจโดยสร้าง custom role ที่มี key เหล่านี้แล้ว assign ให้แอดมินที่ไว้ใจ (ADMIN คนอื่น assign role นั้นต่อไม่ได้เพราะติด subset rule) — ADMIN ยังจ้างพนักงาน + แต่งตั้ง role ที่สิทธิ์ ⊆ ของตัวเองได้ตามเดิม |

ขอบเขตข้อ 3 ที่จงใจไม่แตะ: การ**มอบ system role เดิม**ที่มีสิทธิ์นี้ในตัว (เช่น MANAGER, AUDITOR) ให้พนักงาน ยังเป็น employee management ปกติ — ด่านใหม่คุมเฉพาะ "การประกอบ permission ลง role" ตามถ้อยคำของทีม ("set permission ให้ role")

---

## GAP-03 · `procurement.supplier_payment.release` — maker-checker ที่โค้ดสัญญาไว้แต่ไม่มีจริง

**ประเภท:** ช่องว่าง design vs implementation (ยืนยันแล้ว) · **Priority: P2** · **Effort: S (ทาง B) / M (ทาง A)** · **ต้องตัดสินใจ product**

### หลักฐาน

- Endpoint บันทึกจ่ายซัพพลายเออร์มีอันเดียว และบังคับผู้เรียก**คนเดียวกัน**ต้องถือทั้ง `create` และ `release` พร้อมกัน (`supplier-payment.controller.ts:30`, `supplier-payment.use-case.ts:34-37`)
- Comment ใน use-case อ้างว่า *"H-07: …so roles can split preparer from releaser"* แต่**ไม่มีขั้น release แยก ไม่มีสถานะ DRAFT ไม่มี endpoint ที่สอง** — permission นี้จึงทำได้แค่ "ปิดสิทธิ์ role ทั้งก้อน" ไม่ใช่แยกคนเตรียม/คนปล่อยเงิน

### ทางเลือก

- **ทาง A (ได้ control จริง):** two-step — `create` สร้าง payment สถานะ `DRAFT` → endpoint `release` ใหม่ต้องถือ `release` และ**ต้องไม่ใช่คนสร้าง** (pattern เดียวกับ vendor bill maker-checker ที่มีอยู่แล้ว) → เงินออกเมื่อ release เท่านั้น
- **ทาง B (ถูกและตรงไปตรงมา):** ยอมรับ semantics ปัจจุบัน แก้ description ของ permission (`permission-registry.ts:219`) และ comment ใน use-case ไม่ให้อ้าง split ที่ไม่มีจริง

**✅ เคาะแล้ว (2026-07-29): ทาง B — ทำแล้ว** (แก้ description ใน permission-registry + comment ใน use-case ให้ตรงความจริง: เป็น "กุญแจดอกที่สอง" ไม่ใช่ maker-checker split) · ทาง A (two-step release จริง) = **backlog**

---

## GAP-04 · `taxReviewerRole` — config ที่เก็บไว้แต่ไม่เคยบังคับใช้

**ประเภท:** dead config (ยืนยันแล้ว) · **Priority: P2** · **Effort: S** · **ต้องตัดสินใจ product**

- Schema default `ACCOUNTANT` (`apps/api/prisma/schema.prisma:2663`), seed ตั้งค่า, controller ส่งค่ากลับ (`tax.controller.ts:37`) — แต่**ไม่มีโค้ดสักบรรทัดที่อ่านค่านี้ไปตัดสิทธิ์อะไร** (grep ทั้ง `apps/api/src/modules` + `apps/web/src` เจอที่เดียวคือ default ตอน return)
- **ทางเลือก:** (ก) enforce จริง — ผู้ resolve `tax.review_issue` / mark filed ต้องถือ role ตามค่านี้ หรือ (ข) ถอดฟิลด์ออกกันเข้าใจผิดว่ามีการควบคุม
- **✅ เคาะแล้ว (2026-07-29): ทาง (ก) — enforce จริง** · scope: ผู้ทำ `tax.filing.mark_filed` / `tax.review_issue.resolve` ต้องถือ role ตรงกับ `taxReviewerRole` ของบริษัท (OWNER ผ่านเสมอ)
- **✅ Implement แล้ว (2026-07-29):** เพิ่ม pure logic `taxReviewerViolation` (`tax-reviewer.logic.ts`, fallback `ACCOUNTANT` เมื่อไม่มี profile/null) + guard ใน `tax.controller.ts` (`markFiled`, `resolveIssue`) เช็คหลัง `assertRouteCompany` โยน `403 { code: 'tax_reviewer_role_required' }` และบันทึก `taxReviewerRole` ลง audit metadata ทั้งสอง action · `@RequirePermissions` เดิมยังอยู่ (เป็น check เพิ่ม ไม่ใช่แทน) · endpoint `legacy-remediation/{preview,apply}` ใน transaction-tax เป็น config/data-migration (ไม่ได้ resolve review issue) จึงไม่แตะ

---

## GAP-05 · ปิดบัญชีสิ้นปี (year-end closing) ยังไม่มีทั้งระบบ

**ประเภท:** missing feature (ยืนยันแล้ว) · **Priority: P3** · **Effort: L** · **⏸ ทีมเคาะ (2026-07-29): ไว้ก่อน** — จะกลับมาวาง product spec ให้ทันสิ้นรอบบัญชีแรกของลูกค้าจริง

- ระบบมีเฉพาะ**ปิดงวดรายเดือน** (`AccountingPeriod` + `ledger.period.close/unclose` — `schema.prisma:2144`) — ไม่มี closing entries, ไม่มีบัญชีกำไรสะสม (retained earnings) ในผังบัญชี template, ไม่มีแนวคิดรอบบัญชี (fiscal year) เลย (grep ทั้ง source + seed ไม่พบ)
- **ผลทางธุรกิจ:** นิติบุคคลไทยปิดงบส่งงบต่อ DBD + ยื่น ภ.ง.ด.50 จากระบบนี้ตรง ๆ ไม่ได้ — ต้องเอาข้อมูลออกไปทำที่อื่น

### ขอบเขตขั้นต่ำ (outline สำหรับ spec ฉบับเต็ม)

1. Config รอบบัญชี (วันสิ้นรอบ) ใน company accounting profile
2. บัญชี "กำไร(ขาดทุน)สะสม" ในผังบัญชี template + migration สำหรับบริษัทเดิม
3. Use case ปิดปี: precondition ทุกงวดของรอบ = CLOSED → generate closing entry (ล้างรายได้/ค่าใช้จ่ายเป็นศูนย์ โอนผลต่างเข้ากำไรสะสม) → ล็อกทั้งรอบ
4. สิทธิ์ใหม่ `ledger.year.close` / `.unclose` ระดับ CRITICAL — OWNER + ACCOUNTANT (สอดคล้อง `ledger.period.close` เดิม)
5. รายงานหลังปิด: งบแสดงฐานะการเงิน + งบกำไรขาดทุน

---

## GAP-06 · รายการย่อย (hardening + ความสอดคล้อง) — P3

| # | เรื่อง | หลักฐาน | ข้อเสนอ |
|---|---|---|---|
| 6.1 | ด่าน OWNER-approval ของ financial role ตรวจจาก **role key** (`'FINANCE'`/`'ACCOUNTANT'`) ไม่ใช่เนื้อสิทธิ์ — custom role ที่ถือสิทธิ์เงินเท่ากันไม่ trip ด่านนี้ | `employee-access.logic.ts:26-28` | ความเสี่ยงจริง**ต่ำ** เพราะเช็คข้อ (3) ใน `roleGrantViolation` กันคนที่ไม่ถือสิทธิ์ grant สิทธิ์นั้นอยู่แล้ว (ในทางปฏิบัติเหลือแต่ OWNER ที่สร้างได้ ซึ่งเป็นผู้อนุมัติเอง) — ทำเป็น defense-in-depth: trip ด่านเมื่อ role ถือสิทธิ์ในเซ็ต critical (`journal.entry.post`, `ledger.period.close`, `accounting.payment.void`, `accounting.tax_invoice.issue`, `supplier_payment.release`, `expense.payment.record`, `reimbursement.payment.record`) |
| 6.2 | `docs/specs/permission-matrix.md` อ้าง permission ที่ไม่มีจริง (`ledger.period.approve_close`, `tax.period.prepare`, ตระกูล `payroll.*`, `fixed_asset.*`, `manufacturing.*`) | เทียบกับ `permission-registry.ts` | ✅ **ทำแล้ว (2026-07-29):** ลบ/แก้ key เดี่ยวที่ไม่มีจริงใน section ภาษี+ledger, mark ทั้ง section `payroll.*`/`fixed_asset.*`/`manufacturing.*` เป็น planned/future และปรับ tax grants ให้ตรง registry |
| 6.3 | Pack นิยามไว้แต่ไม่มี preset ไหนใช้: `pack.tax_invoice.issue` (CRITICAL) ฯลฯ | `capability-pack.registry.ts` | ✅ เคาะหลักการ (2026-07-29): **preset ต้อง mirror ความสามารถของ system role** → ✅ **ทำแล้ว (2026-07-29):** เพิ่ม `pack.tax_invoice.issue` เข้า `FINANCE_PACKS` — finance preset ทั้ง 4 ออก/ยกเลิกใบกำกับภาษีได้แล้ว + มี parity guard test (`role-template-system-role-parity.spec.ts`) |
| 6.4 | Preset `tpl.x.manager` แรงกว่า system role `MANAGER` (`vendor_bill.approve`) | `role-template.registry.ts` | ✅ เคาะ (2026-07-29): **ตัดออกจาก preset** → ✅ **ทำแล้ว (2026-07-29):** ตัด `procurement.vendor_bill.approve` ออกจาก `pack.procurement.approve` — manager preset ทั้ง 3 ไม่อนุมัติใบวางบิลผู้ขายแล้ว (หมายเหตุ: `ap_manage` ไม่เคยมี key นี้ ดังนั้นตอนนี้ไม่มี preset ไหนถือ `vendor_bill.approve` เลย — system FINANCE ยังถือ) |
| 6.5 | `pack.procurement.ap_manage` แถม `goods_receipt.post/void` (OWNER-only ใน system roles) | `capability-pack.registry.ts:299` | ✅ เคาะ (2026-07-29): **แยกออก** → ✅ **ทำแล้ว (2026-07-29):** ย้าย `goods_receipt.post/void` ออกจาก `ap_manage` ไป pack ใหม่ `pack.procurement.goods_receipt_post` ที่ไม่มี preset ไหนใช้ (owner delegate ผ่าน custom role ได้) |
| 6.6 | ADMIN อนุมัติใบเบิกไม่ได้ — intended behavior จากทีมคือ manager/admin/owner | `permission-registry.ts` (ADMIN block) | ✅ **เคาะแล้ว + ทำแล้ว (2026-07-28):** เพิ่ม `reimbursement.approve`/`.reject` ให้ ADMIN (การจ่ายยังเป็นของ FINANCE — ผู้อนุมัติกับผู้จ่ายแยกมือเหมือนเดิม) |
| 6.7 | หลัง 6.4 ไม่มี preset ไหนอนุมัติบิลเจ้าหนี้ได้ ทั้งที่ system FINANCE มี | `capability-pack.registry.ts` (ap_manage) | ✅ **เคาะแล้ว + ทำแล้ว (2026-07-29):** เพิ่ม `vendor_bill.approve` เข้า `pack.procurement.ap_manage` (preset การเงิน mirror FINANCE) — self-approval guard ระดับ user ยังคุมเหมือนเดิม: คนยื่นอนุมัติใบตัวเองไม่ได้ |

---

## GAP-07 · expense ที่จ่ายเงินแล้วค้าง `postingStatus='pending'` ถาวร → block ปิดงวดตลอดกาล

**ประเภท:** บั๊ก (ยืนยันใน Phase 0 ของ GAP-02, 2026-07-28) · **Priority: P1** · **Effort: S–M** · **สถานะ: ✅ แก้แล้ว — ยืนยันด้วยการรันเทสต์จริง 2026-08-14**

> **ยืนยัน 2026-08-14:** แนวแก้ที่เสนอไว้ถูกนำไปทำจริง — มี canonical posting source `expense.payment` แล้ว (`journal.use-case.ts:417-431`, idempotency key `expense.payment:${payment.id}` ต่อ payment id ตามกลไก payment-leg ของ GAP-02 Phase 3) · เทสต์ `expense-payment-posting.use-case.spec.ts` รันผ่าน ครอบคลุม: post `Dr 2120-01 / Cr 1110-01` จาก payment event, ใช้วันที่ `paidAt` เป็นงวด, จ่ายบางส่วน, idempotent, ปฏิเสธ claim-born expense (ต้องผ่าน `reimbursement.payment`) · `countPostingBlockers` มีเทสต์ "GAP-07 settlement blockers" ยืนยันว่านับ paid expense ที่ยังไม่มี settlement journal โดยไม่นับซ้ำ และไม่นับ claim-born · ด่านปิดงวดรวม reimbursement blockers แล้ว (GAP-02 Phase 4 / PR-2 — `period.use-case.ts:177`)

- `RecordExpensePaymentUseCase` ตั้ง `postingStatus='pending'` หลังบันทึกการจ่าย (`expense-draft.use-case.ts:566-603`) แต่เส้น post จังหวะจ่ายของ expense ไปไม่ถึง (ดู GAP-02 ข้อเท็จจริง 1) → ค้าง `pending` ถาวร
- `countPostingBlockers` นับ `CONFIRMED` + `postingStatus='pending'` เป็น blocker ปิดงวด (`prisma-expense.repository.ts:1153-1164`) → **expense ทุกใบที่บันทึกการจ่ายแล้วกลายเป็นตัว block การปิดงวดถาวร** — บั๊กนี้มีอยู่วันนี้ ไม่เกี่ยวกับเบิกจ่าย
- **แนวแก้ที่เสนอ:** ใช้กลไก payment-leg ที่สร้างใน GAP-02 Phase 1 (source ต่อ payment id) มา wire ให้ expense payment ด้วย — หรืออย่างน้อยเลิกตั้ง `pending` ตอนจ่ายจนกว่าจะมี payment leg จริง

---

## GAP-08 · expense ที่มีใบเสร็จแนบ confirm ไม่ผ่านเสมอ + error ถูก mask

**ประเภท:** บั๊ก (เจอจาก e2e จริงของ GAP-02, 2026-07-28) · **Priority: P1** · **สถานะ: ✅ แก้แล้วใน PR-1**

- **8a:** CAS ของ confirm (`finalizeAndConfirmExpenseCas`) hardcode `attachments: []` ขณะที่ checksum ฝั่งเรียกคำนวณจาก attachment links จริง → expense ทุกใบที่มีใบเสร็จ (ผ่าน `linkAttachment` ของ flow อัปโหลดปกติ) ล้มด้วย `expense_confirmation_source_checksum_changed` — local ไม่มีใครเจอเพราะ MinIO ไม่เคยเปิด จึงไม่เคยมีใบเสร็จจริงในเครื่อง
- **8b:** cleanup ตอน confirm ล้มเรียก `voidNumber` กับเลขที่ยัง RESERVED (voidNumber บังคับ COMMITTED) → โยน 409 ทับ error จริง — แก้เป็น cancel + ห้ามกลืน cause

---

## ตารางสรุป

| ID | เรื่อง | ประเภท | Priority | Effort | ตัดสินใจ product? | พร้อมทำ |
|---|---|---|---|---|---|---|
| GAP-01 | Preset การเงิน/บัญชีขาดสิทธิ์อ่าน | บั๊ก | **P1** | S | ไม่ต้อง | ✅ **แก้แล้ว + เทสต์ผ่าน (ยืนยัน 2026-08-14)** |
| GAP-02 | เบิกจ่ายไม่ลง GL + ปิดงวดไม่ตรวจ | ช่องว่างบัญชี | **P1** | M | ✅ ทาง B | ✅ Phase 1–3 เสร็จ+e2e ผ่าน (PR-1) · เหลือ Phase 4 (PR-2) |
| GAP-03 | supplier payment ไม่มีขั้น release จริง | design gap | P2 | S/M | ต้อง | ทาง B ทำได้เลย |
| GAP-04 | `taxReviewerRole` ไม่ถูก enforce | dead config | P2 | S | ต้อง | รอตัดสินใจ |
| GAP-05 | ปิดบัญชีสิ้นปี | missing feature | P3 | L | ต้อง (spec แยก) | รอ spec |
| GAP-06 | hardening + ความสอดคล้อง 6 ข้อ | misc | P3 | S–M | บางข้อ | ✅ 6.2–6.6 ทำแล้ว · เหลือ 6.1 |
| GAP-07 | expense ที่จ่ายแล้ว block ปิดงวดถาวร | บั๊ก | **P1** | S–M | — | ✅ **แก้แล้ว + เทสต์ผ่าน (ยืนยัน 2026-08-14)** |
| GAP-08 | expense มีใบเสร็จ confirm ไม่ผ่าน + error mask | บั๊ก | **P1** | S | — | ✅ แก้แล้ว (PR-1) |
