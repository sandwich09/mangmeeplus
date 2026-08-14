# Plan: ตรวจความครบถ้วนของเอกสาร + แจ้งเตือนกลับให้แก้ไขเร็วที่สุด

- สถานะ: **DRAFT — รอ owner เคาะ §3 (ใครควรได้รับแจ้งเตือน) และ §7 (ระดับความเข้มของการเตือนซ้ำ)**
- วันที่: 2026-08-14
- ขอบเขต: ใบรับรองแทนใบเสร็จ (`ExpenseSubstituteReceiptEvidence`) + เอกสารรายจ่ายทั่วไป (`ExpenseRecord` receipt upload)
- Spec ที่เกี่ยวข้อง: [[specs/expense-receipt-upload-spec]], [[specs/dashboard-notification-spec]], plan เดิม `substitute-receipt-*`
- โจทย์จากเจ้าของผลิตภัณฑ์: *"อยากทำให้ดีและง่าย อยากได้ตรวจสอบว่าเอกสารที่ upload มานี้ยังขาดอะไร ต้องแจ้งเตือนกลับไปให้คนขอออกหรือเจ้าของบริษัททราบ เพื่อให้ได้ข้อมูลครบถ้วนเร็วที่สุด"*

---

## 1. สภาพปัจจุบัน (ตรวจจากโค้ดจริง)

### 1.1 สิ่งที่ทำงานดีอยู่แล้ว — ห้าม regress

State machine ของใบรับรองแทนใบเสร็จแน่นมาก และต้องรักษาไว้:

| กลไก | ที่อยู่ |
|---|---|
| `PREPARED → PAYER_CERTIFIED → ISSUED` + `SUPERSEDED` พร้อม advisory lock + optimistic `expectedVersion` | `prisma-expense.repository.ts:1076, 1200, 1274, 821` |
| Snapshot ไม่เปลี่ยนย้อนหลัง (`snapshotJson` + `snapshotChecksumSha256`) ตอน certify | `prisma-expense.repository.ts:1200` |
| ลายเซ็นผูกกับผู้ลงนามจริง (ACTIVE + uploader ตรงคน + magic-byte + checksum ตรง) | `substitute-receipt.use-case.ts:895-916` |
| กันอนุมัติตัวเอง เว้น OWNER/ADMIN/MANAGER, ตรวจซ้ำใน transaction ตอน issue | `substitute-receipt.use-case.ts:35-37, 677-680`; `prisma-expense.repository.ts:1305-1307` |
| ISSUED บังคับ `SUPPORTING_ONLY` + `NON_CLAIMABLE` เสมอ (เคลม VAT ไม่ได้) | `expense-draft.use-case.ts:499-502` |
| confirm ต้องมี artifact จริง ไม่ใช่แค่ข้อความเหตุผล | `expense-draft.use-case.ts:495-498` |

### 1.2 ปัญหาที่ 1 — ตัวตรวจ "ขาดอะไร" อยู่ผิดที่ (client-only)

ตัวประเมินความครบถ้วนที่ให้รายการ "ยังขาดอะไร" อยู่ใน **web bundle เท่านั้น**:

- `evaluateDetailsReadiness` — `apps/web/src/features/expenses/substitute-receipt-wizard.model.ts:242-263`
- `evaluateEvidenceReadiness` — `:265-278`
- `evaluateSigningReadiness` — `:280-292`

ฝั่ง API **ไม่มีฟังก์ชันเทียบเท่า** — `PrepareSubstituteReceiptUseCase` โยน `BadRequestException` ทีละข้อแรกที่เจอ (`substitute-receipt.use-case.ts:331-397`)

ผลที่ตามมา 4 ข้อ:
1. ระบบรู้ว่า "ขาดอะไร" เฉพาะตอนที่ผู้ใช้เปิด wizard อยู่ — ไม่มีใครถามได้จากที่อื่น
2. แจ้งเตือนสร้างข้อความ "ขาดอะไร" ไม่ได้ เพราะ server ไม่รู้
3. หน้า hub / รายการ / dashboard บอกไม่ได้ว่าใบไหนติดอะไร
4. LINE AI ตอบไม่ได้ว่า "ใบนี้ยังขาดอะไร"

### 1.3 ปัญหาที่ 2 — แจ้งเตือนมีน้อยมาก และมีบั๊กทำให้ผู้อนุมัติไม่ได้รับ

**ที่มีอยู่:** trigger เดียว `expense.substitute_receipt_signature_pending` (`substitute-receipt.use-case.ts:242-262`) ยิง 2 จุด — ตอน prepare (→ ผู้จ่าย) และตอน certify (→ ผู้อนุมัติ)

**บั๊กที่ยืนยันแล้ว (P1):** ทั้งสองจุดใช้ `triggerKey + sourceModule + sourceType + sourceId(evidence.id)` ชุดเดียวกัน และไม่ส่ง `periodKey` → `buildDedupKey` (`notification.logic.ts:14-31`) ได้คีย์เดียวกันเป๊ะ

- prepare ตั้ง `cooldownUntil = now + 60 นาที` (`notification.use-cases.ts:225-226`)
- ถ้าผู้จ่ายลงนามภายใน 1 ชั่วโมง (ซึ่งคือกรณีปกติ) → certify ได้ `{skipped:true, reason:'cooldown'}` (`:211-215`)
- **ไม่มี recipient row และไม่มี delivery row ของผู้อนุมัติเกิดขึ้นเลย** → ผู้อนุมัติไม่รู้ว่าต้องอนุมัติ
- unit spec stub ตัว notify ไว้ (`substitute-receipt.use-case.spec.ts:89,312`) จึงจับไม่ได้

**ที่ไม่มีเลย:**
- ไม่มีแจ้งเตือน "เอกสารยังขาดข้อมูล" ทุกชนิด — ผู้ใช้รู้ได้ทางเดียวคือปุ่มถูก disable ใน wizard
- ไม่มีแจ้งกลับ**ผู้เตรียม** เมื่อผู้จ่ายลงนามแล้ว หรือเมื่อผู้อนุมัติออกใบ/ปฏิเสธ (`Approve`/`Supersede` ไม่ inject `notify` ด้วยซ้ำ)
- ไม่มีการเตือนซ้ำ ไม่มี SLA escalation ไม่มี digest
- ไม่มี `NotificationRule` row ถูกสร้างเลยทั้งระบบ (`PrismaNotificationRuleRepository` ไม่มี `create`) → cooldown เป็น default 60 นาทีตายตัว ปรับต่อบริษัทไม่ได้
- ช่องทาง handoff ในหน้า wizard มีแค่ปุ่ม "คัดลอกลิงก์" (`SubstituteReceiptWizardPage.tsx:1208-1214`)

---

## 2. เป้าหมายของแผนนี้

1. **ย้ายตัวตรวจความครบถ้วนมาไว้ที่ server เป็น source of truth เดียว** — web, API, แจ้งเตือน, LINE AI ใช้คำตอบชุดเดียวกัน
2. **ผู้ใช้รู้ว่าขาดอะไร โดยไม่ต้องเปิด wizard** — เห็นจากรายการ, จากแจ้งเตือน, จากถาม LINE
3. **แจ้งเตือนกลับถูกคน ถูกเวลา** — คนที่แก้ได้ได้รับก่อน, เจ้าของได้รับเมื่อค้างนาน
4. **ปิดบั๊ก dedup** ที่ทำให้ผู้อนุมัติไม่ได้รับแจ้งเตือน

**Non-goals:** ไม่เปลี่ยน state machine, ไม่เปลี่ยนกฎว่าใบรับรองแทนใบเสร็จเคลม VAT ไม่ได้, ไม่ทำ LINE Flex card ในรอบนี้ (ข้อความธรรมดาพอ), ไม่แตะ `CompanySignatureAsset` ที่ยังไม่ถูกต่อสาย

---

## 3. ออกแบบ: Completeness Evaluator (ฝั่ง server)

### 3.1 รูปแบบผลลัพธ์

เพิ่ม pure domain logic ไฟล์ใหม่:
`apps/api/src/modules/expenses/domain/logic/evidence-completeness.logic.ts`

```ts
export type EvidenceGapCode =
  | 'PAYEE_NAME_REQUIRED'
  | 'PAYEE_ADDRESS_RECOMMENDED'
  | 'PAYEE_TAX_ID_RECOMMENDED'
  | 'PAYEE_TAX_ID_MALFORMED'
  | 'MISSING_REASON_REQUIRED'
  | 'BUSINESS_PURPOSE_REQUIRED'
  | 'PAYER_REQUIRED'
  | 'PAYMENT_DATE_REQUIRED'
  | 'PAYMENT_METHOD_REQUIRED'
  | 'SUPPORTING_EVIDENCE_REQUIRED'
  | 'PAYMENT_EVIDENCE_REQUIRED'
  | 'RENDERABILITY_EXCEEDED'
  | 'PAYER_SIGNATURE_REQUIRED'
  | 'APPROVER_SIGNATURE_REQUIRED'
  | 'APPROVER_NOT_CONFIGURED';

export interface EvidenceGap {
  code: EvidenceGapCode;
  severity: 'BLOCKING' | 'RECOMMENDED';   // BLOCKING = ไปต่อไม่ได้
  labelTh: string;                         // "ยังไม่ได้ระบุชื่อผู้รับเงิน"
  howToFixTh: string;                      // "กรอกชื่อผู้รับเงินตามบัตรประชาชน"
  fixableBy: 'PREPARER' | 'PAYER' | 'APPROVER' | 'ADMIN';
  field?: string;                          // ชี้ field ให้ UI focus ได้
}

export interface EvidenceCompleteness {
  stage: 'DETAILS' | 'EVIDENCE' | 'SIGNING' | 'APPROVAL' | 'COMPLETE';
  ready: boolean;                          // ไม่มี BLOCKING เหลือ
  gaps: EvidenceGap[];
  blockingCount: number;
  nextActorRole: 'PREPARER' | 'PAYER' | 'APPROVER' | null;
  nextActorUserIds: string[];              // ใครทำต่อได้จริง (ผ่าน eligibility เดิม)
}
```

**หลักการสำคัญ:** ฟังก์ชันนี้ **pure** ไม่แตะ Prisma/Nest รับ input เป็น facts ที่ประกอบมาแล้ว — ทดสอบง่าย และเรียกได้ทั้งจาก use case, จาก worker เตือนซ้ำ, จาก LINE AI tool

`labelTh` / `howToFixTh` เก็บใน **catalog เดียวที่ `packages/contracts`** ไม่ใช่ใน web bundle (แก้ปัญหาข้อความกระจาย — ดูแผน G1 §เหตุผลเดียวกัน)

### 3.2 จุดที่เรียกใช้ (ทดแทนตัวเดิม ไม่ใช่เพิ่มซ้อน)

| จุด | เดิม | ใหม่ |
|---|---|---|
| `PrepareSubstituteReceiptUseCase` | โยน error ทีละข้อ | เรียก evaluator ก่อน ถ้ามี BLOCKING โยน `BadRequestException` ที่ body มี `gaps[]` ครบทุกข้อ (ไม่ใช่ข้อแรก) |
| `GET .../substitute-receipt/history` และ hub list | ไม่มี | แนบ `completeness` ต่อรายการ |
| `GET .../expenses/:id` detail | ไม่มี | แนบ `completeness` เมื่อ expense พึ่งพาใบรับรองแทนใบเสร็จ |
| web wizard | `evaluate*Readiness` ฝั่ง client | เรียกใช้ค่าจาก API แทน — **ลบ logic ซ้ำฝั่ง client** เหลือแค่ render |
| worker เตือนซ้ำ (§7) | ไม่มี | เรียก evaluator เพื่อสร้างข้อความ |

> ข้อควรระวัง: ตอนนี้ web ใช้ `evaluate*Readiness` ตัดสินใจ disable ปุ่มแบบ optimistic (ไม่ต้องรอ API) การเปลี่ยนต้องคง responsiveness — วิธี: API ส่ง `completeness` มากับ payload ที่ wizard โหลดอยู่แล้ว แล้ว client คำนวณ diff ระหว่างพิมพ์จาก schema เดียวกันที่ share ผ่าน contracts (ไม่ใช่เขียนกฎซ้ำ)

### 3.3 ครอบคลุมเอกสารรายจ่ายทั่วไปด้วย

โจทย์ผู้ใช้พูดถึง "เอกสารที่ upload มา" กว้างกว่าใบรับรองแทนใบเสร็จ — ดังนั้น evaluator ต้องมีพี่น้องอีกตัวสำหรับ expense ปกติ:

`deriveExpenseEvidenceGaps(expense, taxEvidence, companyVatStatus)` → `EvidenceGap[]` โดย **นำ logic ที่มีอยู่แล้วมารวม ไม่เขียนใหม่**:
- `deriveTaxEvidence` (`expense-document.logic.ts:33`) → เอกสารประเภทไหน ใช้ทางภาษีได้แค่ไหน
- `validateDomesticInputVatEvidence` (`expense-status.logic.ts:174`) → ตอนนี้คืน `string | null` ภาษาอังกฤษ — **แปลงให้คืน `EvidenceGap[]`** (ดูแผน G1 ซึ่งทำเรื่องเดียวกัน — สองแผนนี้ต้อง share catalog)
- `deriveExpenseAuditChecks` (`apps/web/.../expenses.model.ts:687`) → ย้ายจาก client มา server เป็น gap codes

**การประสานกับแผน G1:** `EvidenceGap` คือ "ส่วน (a) เอกสารขาดอะไร" ของ verdict engine — ต้องใช้ reason-code catalog ตัวเดียวกัน อย่าสร้างสองชุด

---

## 4. แก้บั๊ก dedup (ต้องทำก่อนงานแจ้งเตือนอื่น)

**สาเหตุ:** dedupKey ไม่มีมิติ "ขั้นตอน" และไม่มีมิติ "ผู้รับ"

**ทางแก้ที่เลือก:** แยก trigger key ตามขั้น แทนที่จะยัด evidence.id อย่างเดียว

| ขั้น | triggerKey ใหม่ | ผู้รับ |
|---|---|---|
| prepare เสร็จ รอผู้จ่ายลงนาม | `expense.substitute_receipt.payer_signature_pending` | ผู้จ่าย |
| ผู้จ่ายลงนามแล้ว รออนุมัติ | `expense.substitute_receipt.approval_pending` | ผู้อนุมัติที่มีสิทธิ์ |
| ออกใบแล้ว | `expense.substitute_receipt.issued` | ผู้เตรียม + ผู้จ่าย |
| ถูก supersede/ยกเลิก | `expense.substitute_receipt.superseded` | ผู้เตรียม + ผู้จ่าย |
| เอกสารขาดข้อมูล | `expense.evidence_incomplete` | ตาม `fixableBy` (§5) |

ทุก key ต้องเพิ่มเข้า `IMPLEMENTED_TRIGGER_KEYS` (`notification.model.ts:127`) ไม่งั้น LINE preference gate จะ drop ทิ้ง (`notification.use-cases.ts:320-331`)

**เพิ่ม guard test:** unit test ที่ยืนยันว่า prepare แล้ว certify ต่อทันที → ผู้อนุมัติได้ recipient row จริง (ต้องไม่ stub `CreateOrUpdateNotificationEventUseCase` ทั้งก้อนแบบ spec ปัจจุบัน — ให้ stub ที่ระดับ repository แทน เพื่อให้ dedup/cooldown จริงถูกรัน)

**ตัวเลือกเสริมที่ควรทำพร้อมกัน:** ให้ `buildDedupKey` รับ `stageKey?` เพิ่ม เพื่อให้เคสอื่นในอนาคตไม่ตกหลุมเดิม — แต่ไม่จำเป็นถ้าแยก triggerKey แล้ว (ตัดสินใจตอน implement โดยดูว่ามี trigger อื่นที่ยิงหลายขั้นด้วย sourceId เดียวกันไหม)

---

## 5. ออกแบบ: แจ้งเตือน "เอกสารยังขาดข้อมูล"

### 5.1 หลักการเลือกผู้รับ — แจ้งคนที่ "แก้ได้" ก่อนเสมอ

จาก `EvidenceGap.fixableBy`:

| fixableBy | ผู้รับจริง |
|---|---|
| `PREPARER` | ผู้สร้าง expense / ผู้เตรียมใบรับรอง |
| `PAYER` | `payerUserId` ของใบนั้น |
| `APPROVER` | ผู้อนุมัติที่ผ่าน `listEligibleSubstituteReceiptApprovers` + policy mode |
| `ADMIN` | ผู้ถือ `company.setup.manage` (เช่นกรณี `APPROVER_NOT_CONFIGURED`) |

**เจ้าของบริษัทไม่ได้รับทุกใบ** — จะท่วม ให้ได้รับเมื่อ (ก) ค้างเกิน SLA (§7) หรือ (ข) ไม่มีใครแก้ได้ (`ADMIN` gap) หรือ (ค) เจ้าของเป็น `fixableBy` เอง

> **ต้องเคาะ:** เจ้าของต้องการรับ digest รายวันของใบที่ค้างทั้งหมดด้วยไหม (แนะนำ: ใช้ `CreateDailyOwnerSummaryUseCase` ที่มีอยู่แล้ว เพิ่มบรรทัด "ใบรับรองแทนใบเสร็จค้าง N ใบ" แทนการยิงทีละใบ)

### 5.2 เนื้อหาข้อความ

ข้อความสร้างจาก `gaps` โดยตรง ไม่ hardcode:

```
หัวข้อ:  ใบรับรองแทนใบเสร็จ SR-202608-00012 ยังขาดข้อมูล 2 รายการ
เนื้อหา:  • ยังไม่ได้ระบุชื่อผู้รับเงิน
         • ยังไม่ได้แนบหลักฐานการจ่ายเงิน
         เปิดระบบเพื่อกรอกให้ครบ
deepLink: /companies/{c}/expenses/substitute-receipts/{evidenceId}
severity: 'action'
```

กรณี expense ปกติ (ไม่ใช่ใบรับรองแทนใบเสร็จ) ให้ deep link ไปหน้า review ของ expense นั้น

### 5.3 จุดที่ยิง

| เหตุการณ์ | ยิงเมื่อ |
|---|---|
| อัปโหลดใบเสร็จเสร็จ + OCR เสร็จ | ถ้า evaluator พบ BLOCKING gap → แจ้งผู้อัปโหลด |
| prepare ใบรับรองแทนใบเสร็จสำเร็จ | แจ้งผู้จ่าย (มีอยู่แล้ว — คง) |
| certify สำเร็จ | แจ้งผู้อนุมัติ (มีอยู่แล้ว แต่บั๊ก — แก้ตาม §4) |
| issue สำเร็จ | **ใหม่** แจ้งผู้เตรียม + ผู้จ่ายว่าเสร็จแล้ว |
| supersede | **ใหม่** แจ้งผู้เตรียม + ผู้จ่ายว่าใบถูกยกเลิก/ออกใหม่ |
| worker เตือนซ้ำ | ตาม §7 |

**หมายเหตุสำคัญ:** ตอนนี้ `notifySignaturePending` ถูก try/catch + `logger.warn` (ไม่ล้ม flow) — คงพฤติกรรมนี้ไว้ทุกจุดที่เพิ่ม การแจ้งเตือนล้มต้องไม่ทำให้เอกสารออกไม่ได้

---

## 6. หน้าจอที่ต้องแก้ (ให้ "ง่าย" ตามโจทย์)

1. **หน้า hub ใบรับรองแทนใบเสร็จ** — เพิ่ม badge "ขาด N รายการ" + ชื่อคนที่ต้องทำต่อ (จาก `nextActorRole`) ทำให้เห็นภาพรวมว่าติดตรงไหนโดยไม่ต้องเปิดทีละใบ
2. **หน้า wizard** — `ReadinessCard` เดิมยังอยู่ แต่ข้อความมาจาก server (`labelTh`/`howToFixTh`) แทน hardcode ฝั่ง client
3. **หน้ารายการรายจ่าย** — คอลัมน์/ป้ายบอก "เอกสารไม่ครบ" พร้อม tooltip จาก `gaps[0].labelTh`
4. **ปุ่ม "แจ้งเตือนอีกครั้ง"** ในหน้า hub/wizard — ให้ผู้เตรียมกดกระตุ้นซ้ำได้เอง แทนการต้องคัดลอกลิงก์ไปส่งไลน์เอง (แก้ handoff gap ที่ §1.3) — ต้อง rate-limit (เช่น 1 ครั้ง/15 นาที/ใบ)

---

## 7. เตือนซ้ำและ escalation

**ปัญหา:** ปัจจุบันเตือนครั้งเดียวจบ ถ้าคนนั้นไม่เห็นก็ค้างตลอดไป

**ข้อเสนอ:** worker ตัวใหม่ (หรือต่อจาก `notification-worker.ts` ที่มีอยู่) สแกนใบที่ค้าง:

| สถานะค้าง | เตือนซ้ำ | escalate ถึงเจ้าของ |
|---|---|---|
| `PREPARED` (รอผู้จ่ายลงนาม) | ทุก 24 ชม. | เกิน 3 วัน |
| `PAYER_CERTIFIED` (รออนุมัติ) | ทุก 24 ชม. | เกิน 2 วัน |
| expense มี BLOCKING gap | ทุก 48 ชม. | เกิน 7 วัน |

ใช้ `NotificationRule.cooldownMinutes` ที่มีอยู่แล้ว — **ต้องเพิ่ม `create` ใน `PrismaNotificationRuleRepository`** (ตอนนี้ไม่มี, `prisma-notification.repository.ts:90-110`) แล้ว seed rule ต่อบริษัทตอน onboarding

> **ต้องเคาะ:** ตัวเลขข้างบนเป็นข้อเสนอ — เจ้าของต้องการเข้มกว่า/ผ่อนกว่านี้ไหม และต้องการปิดการเตือนซ้ำต่อบริษัทได้ไหม

---

## 8. ลำดับการส่งมอบ

| Phase | งาน | Effort | ทดสอบ |
|---|---|---|---|
| 1 | ✅ **เสร็จแล้ว 2026-08-14** — แก้บั๊ก dedup (§4) + guard test | S | ✅ ผ่าน (ดู §8.1) |
| 2 | `evidence-completeness.logic.ts` + catalog ข้อความใน contracts + unit test ครบทุก gap code | M | unit ต่อ gap code, snapshot ของ `gaps[]` |
| 3 | ต่อ evaluator เข้า API (prepare error body, history, hub list, expense detail) | M | integration: prepare ที่ขาด 3 อย่าง ต้องคืน 3 gaps ไม่ใช่ 1 |
| 4 | trigger แจ้งเตือนใหม่ทั้ง 5 ตัว (§5.3) + `IMPLEMENTED_TRIGGER_KEYS` | M | unit ต่อ trigger + e2e ใบเดียวไล่ครบ lifecycle |
| 5 | web: ใช้ค่าจาก server, ลบ logic ซ้ำฝั่ง client, badge ใน hub/list, ปุ่มเตือนซ้ำ | M | e2e wizard เดิมต้องผ่านเหมือนเดิม |
| 6 | worker เตือนซ้ำ + escalation + `NotificationRule.create` + seed | M | unit เวลาผ่านไป N วันแล้วยิงกี่ครั้ง |

**Phase 1 ส่งแยกได้ทันที** และควรส่งก่อน เพราะเป็นบั๊กที่ผู้ใช้เจอวันนี้

### 8.1 Phase 1 — สิ่งที่ทำจริง (2026-08-14)

**การแก้:** แยก triggerKey ตามขั้นผ่านตาราง `SIGNATURE_STAGES` ในไฟล์เดียวที่ทั้งสอง call site วิ่งผ่าน (`substitute-receipt.use-case.ts`)

- `PAYER` → `expense.substitute_receipt_signature_pending` (คีย์เดิม — preference ของผู้ใช้ที่ตั้งไว้แล้วไม่พัง)
- `APPROVER` → `expense.substitute_receipt_approval_pending` (**ใหม่**) พร้อมข้อความที่ตรงงานจริง: *"ใบรับรองแทนใบเสร็จรออนุมัติ เลขที่ … / ผู้จ่ายเงินลงลายมือชื่อแล้ว เปิดระบบเพื่อตรวจสอบและอนุมัติ"*
- ลงทะเบียนคีย์ใหม่ใน `IMPLEMENTED_TRIGGER_KEYS` (`notification.model.ts`) — ถ้าลืมข้อนี้ LINE preference gate จะ drop ทิ้งเงียบ ๆ

**ทำไมเลือกคีย์แยก ไม่ใช่ยัด `periodKey`:** `periodKey` มีความหมายเป็นงวดบัญชี การเอามาใช้แทน "ขั้นตอน" จะทำให้ dedup key อ่านไม่รู้เรื่อง และคีย์แยกยังทำให้ผู้ใช้เปิด/ปิดแจ้งเตือนแยกขั้นได้จากหน้า preference ที่แสดงเฉพาะคีย์ที่ implement แล้ว

**Guard test:** `'gives the payer and approver stages distinct dedup keys for the same certificate'` — เดินจริงทั้ง prepare และ certify บน evidence เดียวกัน แล้ว assert ว่า `sourceId` เท่ากัน แต่ `buildDedupKey()` ของสองอันต่างกัน และทุก triggerKey ที่ยิงต้องอยู่ใน `IMPLEMENTED_TRIGGER_KEYS`

**พิสูจน์ว่า test ใช้ได้จริง:** ทดลองแก้ให้ทั้งสองขั้นใช้คีย์เดียวกัน (จำลองบั๊กเดิม) → เทสต์ล้มตามคาด แล้วคืนค่า

**ผลรัน:** substitute-receipt 13/13 ผ่าน · ชุดรวม substitute-receipt + notification 9 ไฟล์ **101 เทสต์ ผ่านหมด (exit 0)** · `tsc` ไม่มี error ในไฟล์ที่แก้ (35 error ที่เหลือเป็นของเดิมจาก Prisma client ที่ยังไม่ generate ใหม่ — `expensePayment`, `platformAccessControl`)

**ยังไม่ได้ทำใน Phase 1 (อยู่ Phase ถัดไป):** แจ้งเตือน "เอกสารขาดข้อมูล", แจ้งกลับผู้เตรียมเมื่อ issue/supersede, เตือนซ้ำ/escalation, `NotificationRule.create`

---

## 9. Acceptance criteria

1. prepare แล้ว payer certify ภายใน 1 ชั่วโมง → ผู้อนุมัติ **ได้รับแจ้งเตือนจริง** (มี `NotificationRecipient` + `NotificationDelivery` ทั้ง web และ line)
2. เรียก prepare ด้วยข้อมูลที่ขาด 3 อย่าง → response ระบุครบทั้ง 3 พร้อม `labelTh`/`howToFixTh`/`fixableBy` ไม่ใช่ข้อความเดียว
3. หน้า hub แสดงต่อใบว่า "ขาด N รายการ" และ "รอใคร" โดยไม่ต้องเปิดใบ
4. อัปโหลดใบเสร็จที่ข้อมูลไม่ครบ → ผู้อัปโหลดได้รับแจ้งเตือนพร้อมรายการที่ขาดภายในรอบ delivery ปกติ
5. ใบค้างเกิน SLA → เจ้าของได้รับ escalation (หรือเห็นใน daily summary ตามที่เคาะ §5.1)
6. ข้อความ "ขาดอะไร" ที่ web แสดง = ข้อความเดียวกับที่แจ้งเตือนส่ง (มาจาก catalog เดียว)
7. state machine เดิม, การกันอนุมัติตัวเอง, checksum ลายเซ็น, และกฎ `SUPPORTING_ONLY`/`NON_CLAIMABLE` **ไม่เปลี่ยน** — regression test เดิมผ่านทั้งหมด
8. การแจ้งเตือนล้มเหลว ต้องไม่ทำให้ prepare/certify/issue ล้ม

---

## 10. ความเสี่ยง

| ความเสี่ยง | การรับมือ |
|---|---|
| ย้าย readiness จาก client → server ทำให้ wizard หน่วง | share schema ผ่าน contracts ให้ client คำนวณระหว่างพิมพ์ได้ ส่วน server เป็นผู้ตัดสินตอน submit |
| แจ้งเตือนเยอะเกินจนผู้ใช้ปิดทิ้ง | แจ้งเฉพาะคนที่แก้ได้ + เจ้าของรับเป็น digest + cooldown ต่อ rule |
| แยก triggerKey แล้วของเก่าที่ยิงไปแล้วค้างสถานะ | trigger ใหม่ = คีย์ใหม่ ไม่ชนของเดิม; ของเดิมปล่อยหมดอายุตามปกติ |
| catalog ข้อความซ้ำกับแผน G1 | **บังคับ**: G1 กับแผนนี้ใช้ reason-code catalog ไฟล์เดียวกันใน `packages/contracts` — ตัดสินใจโครงสร้างร่วมก่อนเริ่ม Phase 2 |
