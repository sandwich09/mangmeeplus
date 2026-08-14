# Plan: G1 — Expense Verdict Engine (ตัดสินรายจ่ายแบบอธิบายได้ + AI ช่วยเล่า)

- สถานะ: **DRAFT — รอ owner เคาะ §4 (ขอบเขต deductibility) และ §7 (บทบาท AI)**
- วันที่: 2026-08-14
- ขอบเขต: ทุกรายจ่ายหนึ่งบรรทัด/หนึ่งใบ ต้องตอบ 4 คำถามพร้อมเหตุผลภาษาไทย + อ้างกฎหมาย + ระดับความมั่นใจ
- โจทย์จากเจ้าของผลิตภัณฑ์: *"อยากทำให้ดีขึ้น ให้สมกับระบบที่มี AI อยู่เบื้องหลัง"*

---

## 1. ข้อค้นพบสำคัญจากการตรวจโค้ดจริง (แก้ความเข้าใจเดิม)

เอกสาร gap เดิมเขียนว่า "ชิ้นส่วนมีครบแล้วแต่กระจาย — งานคือ orchestrate" — **ตรวจจริงแล้วประเมินต่ำเกินไป**

| คำถาม | สภาพจริง |
|---|---|
| (a) เอกสารใช้ได้ไหม/ขาดอะไร | ✅ **มี logic จริง** — `deriveTaxEvidence` (`expense-document.logic.ts:33`) คืน `{taxEvidenceStatus, taxEvidenceReasonCode}` มี reason code 12 แบบ |
| (b) หักรายจ่ายทางภาษีได้ไหม (ม.65 ตรี) | ❌ **ไม่มีเลย** — `NONDEDUCTIBLE_*` ใน `TaxClaimability` เป็นเรื่อง **VAT** ไม่ใช่ deductibility ภาษีเงินได้นิติบุคคล |
| (c) ภาษีซื้อขอคืนได้ไหม | 🟡 **ครึ่งคนครึ่งระบบ และมีสองคำตอบที่ไม่คุยกัน** (ดู §1.1) |
| (d) หัก ณ ที่จ่ายเท่าไหร่ | ❌ **ไม่มี logic ตัดสิน** — เป็นเลขคูณล้วน `wht = round2(taxable × whtRate)` (`expense-totals.logic.ts:75-76`) โดย `whtRate` มาจาก OCR เท่านั้น |

**สรุป: 2 ใน 4 คำถามเป็น greenfield ไม่ใช่การต่อสาย**

### 1.1 ปัญหาโครงสร้าง: (c) มีสองคำตอบที่ไม่ reconcile

| ตัวที่ 1 | ตัวที่ 2 |
|---|---|
| `ExpenseRecord.inputVatClaimStatus` (`schema.prisma:2138`) | `ExpenseLine.claimabilitySnapshot` (`schema.prisma:2306`) |
| ระดับ **ใบ** | ระดับ **บรรทัด** |
| **คนกรอก** — ไม่มี derive function ที่ไหนเลย | **ระบบคำนวณ** — `resolveTransactionTaxPreview` (`transaction-tax.logic.ts:205,244`) |
| ตรวจโดย `validateDomesticInputVatEvidence` (`expense-status.logic.ts:174`) ที่คืน **string ภาษาอังกฤษ หรือ null** | สะสม error เป็น code array (`:265-268`) |

ต้องตัดสินใจว่าตัวไหนคือความจริง — ข้อเสนอ §5.3

### 1.2 ปัญหา: ข้อความไทยและกฎหมายอยู่ผิดที่

- ป้ายภาษาไทยของ reason code อยู่ใน **web bundle** (`apps/web/src/features/expenses/expenses.model.ts:489-502`) — API เข้าไม่ถึง แจ้งเตือนใช้ไม่ได้ LINE AI ใช้ไม่ได้
- **ทุกการอ้างกฎหมายในระบบวันนี้เป็น code comment** (ม.82/5, ม.86/6 ที่ `expense-document.logic.ts:43-46`) — ยกเว้นที่เดียว: `taxNote: 'ภาษีซื้อต้องห้าม ม.82/5(4)…'` ใน `expense-category-bootstrap.service.ts:54`
- `taxEvidenceReasonCode` เป็น `String?` ใน Prisma (`schema.prisma:2172`) ไม่ใช่ enum — DB ไม่บังคับให้อยู่ใน 12 ค่าที่ถูกต้อง

### 1.3 จุดแข็งที่ต้องรักษาและต่อยอด (สำคัญมาก)

**ระบบนี้ไม่ได้ gate ด้วยตัวเลข confidence เป็นหลัก — แต่ gate ด้วย evidence-signal grounding ซึ่งแข็งแรงกว่า:**
- OCR ทำงาน 2 ขั้น: ขั้นที่ 1 ถอดเป็น markdown ดิบ ขั้นที่ 2 เลือกค่าจากข้อความนั้น
- `parseBusinessDocumentClassification` (`business-document-classification.logic.ts:50`) **เก็บเฉพาะ span ที่ปรากฏจริงในข้อความขั้นที่ 1**
- `gateBusinessDocumentClassification` (`:130`) ลดชั้นใบเสร็จที่ไม่มีสัญญาณการชำระ/ยอดรวม/ผู้ขาย
- `amountSignalSupports` (`expense-document.logic.ts:200`) ตรวจว่ายอดที่อ้างปรากฏในเอกสารจริง

**นี่คือแบบที่ verdict engine ต้องใช้** — อย่าเปลี่ยนไปพึ่งตัวเลข confidence ลอย ๆ

มี threshold จริงแค่ตัวเดียวในระบบ: `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE = 0.85` (`contracts/src/line-ai.ts:200`)

---

## 2. หลักการออกแบบ (ไม่ต่อรอง)

1. **AI เล่า ไม่ตัดสิน** — verdict ทุกข้อคำนวณจาก deterministic logic; AI Gateway ทำหน้าที่แปลงเป็นภาษาคนที่อ่านรื่นเท่านั้น ห้าม AI เป็นผู้ตัดสินว่าเคลม VAT ได้/ไม่ได้ (เหตุผล: ตรวจสอบย้อนหลังได้, reproducible, สรรพากรตรวจแล้วต้องตอบได้)
2. **ทุก verdict มี reason code** — ไม่มี free text ที่ไม่มี code กำกับ
3. **ทุก reason code มี `lawRef`** — ยกกฎหมายจาก comment ขึ้นมาเป็นข้อมูล
4. **ไม่รู้ ต้องบอกว่าไม่รู้** — ห้ามเดา ให้สถานะ `NEEDS_INPUT` พร้อมคำถามเดียวที่ตอบง่าย
5. **เก็บว่าใช้กฎเวอร์ชันไหน** — ผูกกับแผน G2 (posting rules เป็น data) และ `TaxRateConfig` ที่มี effective date

---

## 3. โครงสร้าง Verdict

### 3.1 Reason-code catalog (ทำก่อนอย่างอื่น — เป็นฐานร่วมกับแผนใบรับรองแทนใบเสร็จ)

ไฟล์ใหม่: `packages/contracts/src/tax-reason-catalog.ts`

```ts
export interface TaxReason {
  code: string;                    // 'ABBREVIATED_TAX_INVOICE_NOT_CREDITABLE'
  th: string;                      // "ใบกำกับภาษีอย่างย่อ ขอคืนภาษีซื้อไม่ได้"
  howToFixTh?: string;             // "ขอใบกำกับภาษีเต็มรูปจากผู้ขาย"
  lawRef?: string;                 // "ประมวลรัษฎากร ม.86/6"
  severity: 'BLOCKING' | 'WARNING' | 'INFO';
}
export const TAX_REASONS: Record<string, TaxReason>;
```

**งานย้ายที่ต้องทำ (ไม่ใช่เขียนใหม่):**
- ย้าย `TAX_EVIDENCE_REASON_LABELS` จาก `apps/web/.../expenses.model.ts:489-502` → catalog
- ย้ายกฎหมายจาก comment `expense-document.logic.ts:43-46` → field `lawRef`
- แปลง `validateDomesticInputVatEvidence` (`expense-status.logic.ts:174`) จากคืน `string|null` → คืน `TaxReason[]`
- ย้าย `deriveExpenseAuditChecks` (`apps/web/.../expenses.model.ts:687`) จาก client → server (มันคือ verdict presenter ที่ทำงานผิดชั้นอยู่)
- เปลี่ยน `ExpenseRecord.taxEvidenceReasonCode` จาก `String?` → enum (migration)

> **บังคับ:** catalog นี้ **ตัวเดียวกัน**กับที่แผน [[plans/expense-evidence-completeness-and-notification-plan]] ใช้ ห้ามแยกสองชุด — `EvidenceGap` ในแผนนั้นคือหน้าตาของคำถาม (a)

### 3.2 รูป verdict

```ts
export interface ExpenseVerdict {
  scope: 'RECORD' | 'LINE';
  scopeId: string;
  ruleSetVersion: string;          // กฎชุดไหนตัดสิน — สำหรับ audit
  evaluatedAt: string;

  document:      VerdictPart<'USABLE_FOR_TAX'|'SUPPORTING_ONLY'|'UNUSABLE'|'NEEDS_INPUT'>;
  deductibility: VerdictPart<'DEDUCTIBLE'|'NON_DEDUCTIBLE'|'CAPPED'|'NEEDS_INPUT'>;
  inputVat:      VerdictPart<'CLAIMABLE'|'NON_CLAIMABLE'|'PENDING_EVIDENCE'|'NEEDS_INPUT'>;
  wht:           VerdictPart<'REQUIRED'|'NOT_REQUIRED'|'NEEDS_INPUT'> & {
                   rate?: string; amount?: string; formType?: 'PND3'|'PND53';
                   incomeCategoryCode?: string;
                 };

  question?: { code: string; textTh: string; options: string[] };  // ถามคำถามเดียวเมื่อขาดข้อมูล
  narrative?: { summaryTh: string; generatedBy: 'AI'|'TEMPLATE'; modelId?: string };
}

interface VerdictPart<S> {
  status: S;
  reasons: TaxReason[];
  confidence: 'HIGH'|'MEDIUM'|'LOW';   // มาจาก grounding ไม่ใช่ตัวเลขลอย
  needsHumanReview: boolean;
}
```

**หมายเหตุ `confidence`:** ใช้ 3 ระดับจาก **grounding signal** ไม่ใช่ float:
- `HIGH` = ทุก fact ที่ใช้ตัดสินมาจาก span ที่ยืนยันในเอกสาร หรือมาจาก master data ที่ผู้ใช้ยืนยันแล้ว
- `MEDIUM` = fact บางส่วนมาจาก OCR ที่ผ่าน `amountSignalSupports` แต่ไม่มีคนยืนยัน
- `LOW` = มี fact ที่เดา/ขาด → ต้องออก `question` และตั้ง `needsHumanReview`

---

## 4. เนื้อกฎแต่ละด้าน

### 4.1 (a) Document — ต่อยอดของเดิม (Effort: S)

- ใช้ `deriveTaxEvidence` เดิมเป็นแกน
- **แก้ข้อจำกัดสำคัญ:** วันนี้มันรัน **เฉพาะตอน intake และเฉพาะเมื่อ doc type ยังเป็น `NEEDS_REVIEW`** (`expense-extraction.use-case.ts:156`) — verdict engine ต้องมี trigger ของตัวเองที่รันตอน review/แก้ไขข้อมูลด้วย
- **แก้ `taxEvidencePolicyComplete`** (`tax-evidence-policy.logic.ts:78`) ที่คืน `boolean` ทั้งที่คำนวณ "required − present" แล้วทิ้งผลต่าง — ให้คืนรายการที่ขาด (ของถูกอยู่แล้ว แค่ทิ้งข้อมูล)

### 4.2 (c) Input VAT — 5 ด่าน (Effort: M)

เขียน `deriveInputVatVerdict()` เป็น pure function ที่รัน 5 ด่านตามลำดับ ตกด่านไหนคืนเหตุผลด่านนั้นทันที:

| ด่าน | ตรวจ | มีของเดิมไหม |
|---|---|---|
| 0 | บริษัทจด VAT ณ วันที่เอกสาร | ✅ มี `vatStatus` ใน `validateDomesticInputVatEvidence` |
| 1 | ต้องเป็นใบกำกับภาษีเต็มรูป | ✅ `deriveTaxEvidence` |
| 2 | ครบตาม ม.86/4 (8 องค์ประกอบ) | 🟡 ตรวจได้บางช่อง (`deriveExpenseAuditChecks` ฝั่ง web) — ต้องทำเป็น checklist ครบ |
| 3 | ต้องห้ามตาม ม.82/5 (ค่ารับรอง / รถนั่ง ≤10 ที่นั่ง / ไม่เกี่ยวกิจการ / ผู้ไม่มีสิทธิออก) | 🟡 มีบางส่วนผ่าน tax code — รถนั่งต้องผูกทะเบียนรถ (ยังไม่มี master data), ผู้ไม่มีสิทธิออก ต้องรอ G3 |
| 4 | ภายใน 6 เดือนนับจากเดือนที่ออกใบกำกับ | ❌ ยังไม่มี — ต้องเพิ่ม + countdown เตือนก่อนหมดสิทธิ |

ด่าน 0 กรณี non-VAT ต้องแสดงข้อความชัด: *"ภาษีซื้อรวมเป็นต้นทุนได้ทั้งจำนวน — เงินไม่หาย แค่เปลี่ยนที่อยู่"*

### 4.3 (d) WHT — greenfield (Effort: M–L)

**สภาพวันนี้:** `WhtIncomeCategory` (`schema.prisma:3571`) มี 15 แถว seed ไว้ (`seed.ts:3193-3226`) แต่ **ไม่มี relation ไปยัง `ExpenseLine`/`ExpenseRecord` เลย** — ใช้เฉพาะสาย procurement/supplier payment

**ต้องสร้าง:** mapping `หมวดรายจ่าย/คำอธิบายบริการ → ประเภทเงินได้ → อัตรา/แบบยื่น`

รายละเอียดกฎและ edge case อยู่ในแผนแยก: [[plans/wht-rule-verification-plan]] (G5) — แผนนี้รับผลจากที่นั่นมาใส่ verdict

**ขั้นต่ำที่ verdict ต้องทำได้ในเฟสแรก:** อ่านหมวดรายจ่าย → เสนอ `incomeCategoryCode` + rate จาก catalog → ถ้าไม่มั่นใจให้ออก `question` ("จ่ายให้บริษัทหรือบุคคลธรรมดา?") แทนการเดา

### 4.4 (b) Deductibility ภาษีเงินได้นิติบุคคล — greenfield

> **ต้องเคาะขอบเขต:** ทำเต็ม ม.65 ตรี (มี 20 อนุมาตรา) หรือทำเฉพาะกลุ่มที่เจอบ่อยใน SME

**ข้อเสนอ: ทำเฉพาะ 5 กลุ่มที่เจอบ่อยและตรวจอัตโนมัติได้ ที่เหลือปล่อยเป็น `NEEDS_INPUT`**
1. รายจ่ายที่พิสูจน์ผู้รับไม่ได้ → `NON_DEDUCTIBLE` (ม.65 ตรี (18)) — ตรวจได้จาก (a) + ใบรับรองแทนใบเสร็จ
2. ค่ารับรอง → `CAPPED` เพดาน 0.3% ของรายได้หรือทุนจดทะเบียนแล้วแต่สูงกว่า ไม่เกิน 10 ล้าน — ตรวจได้จากหมวดรายจ่าย **แต่ต้องรู้ยอดรายได้ทั้งปี → ต้องคำนวณระดับรอบบัญชี ไม่ใช่ระดับใบ**
3. เบี้ยปรับ/เงินเพิ่มภาษี → `NON_DEDUCTIBLE` (ม.65 ตรี (6))
4. รายจ่ายส่วนตัว/ให้โดยเสน่หา → `NON_DEDUCTIBLE` (ม.65 ตรี (3)) — ตรวจจากหมวด
5. รายจ่ายที่ไม่มีเอกสาร → `NON_DEDUCTIBLE` — ต่อจาก (a) โดยตรง

**หมายเหตุสถาปัตยกรรม:** ข้อ 2 เป็น verdict ที่ตัดสินระดับใบไม่ได้ — ต้องมี "verdict ระดับรอบบัญชี" แยก ให้เฟสแรกทำแค่ **ติดธง** ว่าใบนี้เป็นค่ารับรอง แล้วให้รายงานรวมตอนปิดปี (ผูกกับ G6 ที่เลื่อนไป MVP2)

---

## 5. สถาปัตยกรรมและการเก็บข้อมูล

### 5.1 ที่อยู่ของ engine

```
apps/api/src/modules/expenses/domain/logic/verdict/
  ├─ verdict.types.ts
  ├─ document-verdict.logic.ts       ← ห่อ deriveTaxEvidence เดิม
  ├─ input-vat-verdict.logic.ts      ← 5 ด่าน
  ├─ wht-verdict.logic.ts            ← ใหม่
  ├─ deductibility-verdict.logic.ts  ← ใหม่
  └─ verdict.orchestrator.ts         ← รวม 4 ด้าน + ออก question + confidence
```

ทั้งหมด **pure** ไม่แตะ Prisma/Nest — ตามแบบที่ repo ใช้อยู่แล้ว

### 5.2 Input contract — มีของพร้อมใช้แล้ว

`expenseTaxSourceChecksum` (`expense-status.logic.ts:21`) รวบ fact ที่เกี่ยวกับภาษีทั้งหมดไว้แล้ว (ใช้ทำ SHA-256 เป็น optimistic-concurrency token) — **รูปร่างของมันคือ input contract ที่พร้อมใช้ของ verdict engine** ให้ refactor ให้ share shape เดียวกัน อย่าประกอบ fact ใหม่

### 5.3 เก็บผลอย่างไร — ต้องเคาะ

| ทางเลือก | ข้อดี | ข้อเสีย |
|---|---|---|
| **A. คำนวณสด ไม่เก็บ** | ไม่มีข้อมูลค้างผิด, กฎเปลี่ยนแล้วผลเปลี่ยนทันที | audit ย้อนหลังไม่ได้ว่า "ตอนนั้นระบบบอกอะไร", query ช้า |
| **B. เก็บ snapshot ตอน confirm** | audit ได้จริง, ตรงกับหลัก "เก็บว่าใช้กฎเวอร์ชันไหน" | ต้อง migration + invalidation |
| **C. ผสม** — คำนวณสดระหว่าง draft, snapshot ตอน confirm | ได้ทั้งสองอย่าง | ซับซ้อนกว่า |

**แนะนำ C** — ตรงกับพฤติกรรมระบบที่มีอยู่ (snapshot ตอน finalize คือ pattern ที่ใช้แล้วทั้ง `snapshotJson` ของใบรับรองแทนใบเสร็จ และ `claimabilitySnapshot`)

### 5.4 reconcile (c) สองตัว

**ข้อเสนอ:** `ExpenseLine.claimabilitySnapshot` (ระดับบรรทัด, ระบบคำนวณ) เป็นความจริง — `ExpenseRecord.inputVatClaimStatus` กลายเป็น **projection** ที่ derive จากบรรทัด (เช่น ถ้ามีบรรทัดใดเคลมได้ = `CLAIMABLE`) ไม่ใช่ field ที่คนกรอกอิสระ

ต้องระวัง: มีที่ที่ repository บังคับเขียนทับ 2 จุด (`prisma-expense.repository.ts:1135`, `:1373` สาย substitute receipt) — ต้องคง invariant ว่าใบรับรองแทนใบเสร็จ = `NON_CLAIMABLE` เสมอ

---

## 6. บทบาทของ AI (ตอบโจทย์ "ให้สมกับระบบที่มี AI")

### 6.1 ใช้ของที่มีอยู่ ไม่สร้างท่อใหม่

`ai-draft` เป็น pattern ที่ต้องการพอดีและ **generic อยู่แล้ว**:

- Contract: `AiDraftGenerationRequest` (`packages/contracts/src/ai-draft-suggestion.ts:272`) = `{templateKey, language, agent, domain, facts: string[], citations, wantsChecklist}` → `AiDraftGenerationResult` (`:294`) = `{summary, recommendation, riskLevel, confidence, checklistItems}`
- Gateway prompt เป็น persona น้องมั่งมี ภาษาไทย และ **ห้ามแต่งข้อมูลนอก `FACTS`/`CITATIONS`** อยู่แล้ว (`generate-draft.use-case.ts:13-23`)
- **security seam ที่ต้องเคารพ:** API ถือ source id จริง ส่งให้ gateway แค่ `{label, valuePreview}` แล้ว re-validate ก่อน persist
- มี template `tax_evidence_checklist` อยู่แล้ว (`ai-draft-template-catalog.ts:81-90`) แต่ evidence collector เป็น **stub 3 บรรทัดภาษาอังกฤษ** (`suggestion-generator.service.ts:90-94`) — **นี่คือช่องที่รอเสียบพอดี**

### 6.2 AI ทำอะไรได้บ้าง (เรียงตามความเสี่ยง)

| ระดับ | งาน | อนุญาต |
|---|---|---|
| 1 | **เล่า verdict เป็นภาษาคน** — รับ verdict ที่คำนวณแล้วเป็น facts → เขียนสรุป 2-3 บรรทัดที่เจ้าของอ่านเข้าใจ | ✅ ทำเลย |
| 2 | **แนะนำวิธีแก้** — "ขอใบกำกับภาษีเต็มรูปจากร้าน โดยแจ้งเลขผู้เสียภาษีบริษัท" | ✅ ทำ (จาก `howToFixTh` + บริบท) |
| 3 | **เดาหมวดรายจ่าย/ประเภทเงินได้** เมื่อ deterministic ตัดสินไม่ได้ | 🟡 ได้ แต่ต้องเป็น **ข้อเสนอที่คนกดยืนยัน** และบันทึกว่า AI เสนอ |
| 4 | **ตัดสินว่าเคลม VAT ได้/ไม่ได้ หรือหัก WHT เท่าไหร่** | ❌ **ห้าม** |

ระดับ 3 ต้องผ่าน `ai-draft-safety.logic.ts` (allowlist ของ `AiCandidateActionType` ที่จงใจไม่มี final-mutation) และ `ai-draft-permission.logic.ts:13`

### 6.3 ทำไมไม่ให้ AI ตัดสิน

1. สรรพากรตรวจย้อนหลัง 2 ปี ลูกค้าต้องตอบได้ว่าทำไมตอนนั้นบันทึกแบบนั้น — คำตอบต้อง reproducible
2. กฎภาษีเปลี่ยนตามประกาศ ต้องรู้ว่ารายการเก่าใช้กฎ ณ วันนั้น (ทำได้เฉพาะ rules-as-data)
3. ระบบมี rate/budget limit อยู่แล้ว — verdict ต้องทำงานได้แม้ AI ล่มหรือ budget หมด (`receipt-ocr.client.ts` คืน `{status:'failed'}` ไม่ throw — ต้องคง pattern นี้)

**ผลที่ตามมาในการออกแบบ:** `narrative` เป็น field **optional** ใน verdict — ถ้า AI ไม่ตอบ ให้ fallback เป็น template จาก `TAX_REASONS[].th` ต่อกัน ผู้ใช้ยังได้คำตอบครบ แค่สำนวนแข็งกว่า

---

## 7. หน้าจอ

1. **Verdict card ในหน้า review** — 4 แถบ (เอกสาร/หักรายจ่าย/ภาษีซื้อ/หัก ณ ที่จ่าย) เขียว-เหลือง-แดง + เหตุผล + ปุ่ม "ทำไม?" กางกฎหมาย
   - ต่อยอด `ExpenseReviewPage.tsx:396` ที่ render `deriveExpenseAuditChecks` อยู่แล้ว
2. **การ์ดสั้นตอนถ่ายบิล (พนักงาน)** — แสดงเฉพาะ (a) + สิ่งที่ต้องขอเพิ่ม ให้จบใน 1 หน้าจอ (US-A1)
3. **คิวนักบัญชี** — filter `needsHumanReview = true` เรียงตาม severity
4. **LINE** — ถาม "ใบนี้เคลม VAT ได้ไหม" → ตอบจาก verdict + narrative

---

## 8. ลำดับการส่งมอบ

| Phase | งาน | Effort | ผลที่ได้ |
|---|---|---|---|
| 1 | **Reason-code catalog** ใน contracts + ย้ายข้อความ/กฎหมายจาก web และ comment + enum migration ของ `taxEvidenceReasonCode` | S–M | ฐานร่วมกับแผนใบรับรองแทนใบเสร็จ; ยังไม่เปลี่ยนพฤติกรรม |
| 2 | `document-verdict` + `input-vat-verdict` (5 ด่าน) + orchestrator + unit test ครบทุก reason code | M | (a) และ (c) ตอบได้พร้อมเหตุผล |
| 3 | reconcile (c) สองตัว (§5.4) + snapshot ตอน confirm (§5.3 ทาง C) | M | audit ตอบได้ว่าใช้กฎไหน |
| 4 | Verdict card ในหน้า review + การ์ดพนักงาน | M | ผู้ใช้เห็นผลจริง |
| 5 | `wht-verdict` (รับกฎจากแผน G5) | M–L | (d) ตอบได้ |
| 6 | `deductibility-verdict` 5 กลุ่ม (§4.4) | M | (b) ตอบได้บางส่วน |
| 7 | ต่อ AI narrative ผ่าน `ai-draft` (เสียบ evidence collector ของ `tax_evidence_checklist` ที่ยัง stub) | S–M | คำอธิบายอ่านรื่น |

**Phase 1 ต้องทำร่วมกับแผนใบรับรองแทนใบเสร็จ Phase 2** — เป็น catalog เดียวกัน อย่าทำซ้ำ

---

## 9. Acceptance criteria

1. รายจ่าย 1 ใบ เรียก verdict → ได้คำตอบครบ 4 ด้าน แต่ละด้านมี `status` + `reasons[]` ที่ทุกตัวมี `th` และ (ถ้ามี) `lawRef`
2. ใบกำกับภาษีอย่างย่อ → `inputVat.status = NON_CLAIMABLE` พร้อมเหตุผลอ้าง ม.86/6 และ `howToFixTh`
3. บริษัทไม่จด VAT → `inputVat` แสดงข้อความ "รวมเป็นต้นทุนได้ทั้งจำนวน" ไม่ใช่แค่ปฏิเสธเฉย ๆ
4. ใบกำกับเกิน 6 เดือน → ตกด่าน 4 พร้อมเหตุผล; ใกล้ครบ 6 เดือน → เตือนล่วงหน้า
5. ข้อมูลไม่พอตัดสิน → ได้ `question` **หนึ่งคำถาม** ไม่ใช่ฟอร์มยาว และรายการเข้าคิวนักบัญชี
6. AI gateway ล่ม/budget หมด → verdict ยังคืนครบ เพียงไม่มี `narrative`
7. verdict ที่ snapshot ไว้ต้องบอกได้ว่าใช้ `ruleSetVersion` ไหน
8. ข้อความไทยที่ web แสดง = ที่แจ้งเตือนส่ง = ที่ LINE ตอบ (catalog เดียว)
9. เทสต์เดิมของ expense/tax ผ่านทั้งหมด (ไม่ regress)

---

## 10. ความเสี่ยง

| ความเสี่ยง | การรับมือ |
|---|---|
| กฎภาษีตีความผิด → ลูกค้าเสียหาย | ทุก reason code ต้องผ่านการรีวิวโดยผู้สอบบัญชีภาษีอากร (TA) ก่อนเปิดใช้ (ดูแผน G5 §วิธียืนยัน); เปิดแบบ review-gated ตาม pattern `TaxRuleStatus.DRAFT` ที่ระบบใช้อยู่แล้ว |
| ผู้ใช้เชื่อ verdict มากเกินไป | ทุกหน้าจอต้องมีข้อความว่าเป็นการช่วยตรวจเบื้องต้น ไม่ใช่คำวินิจฉัยทางกฎหมาย (สอดคล้อง non-goal ของ `tax-thailand-2026-spec`) |
| ทำ (b) deductibility เต็ม ม.65 ตรี แล้วไม่จบ | จำกัด 5 กลุ่มตาม §4.4 ที่เหลือ `NEEDS_INPUT` อย่างซื่อสัตย์ |
| ค่ารับรองต้องรู้ยอดทั้งปี ตัดสินระดับใบไม่ได้ | เฟสแรกแค่ติดธง คำนวณเพดานจริงรอ G6 (MVP2) |
| verdict คำนวณช้าตอนโหลดรายการ | คำนวณสดเฉพาะหน้า detail; รายการใช้ snapshot/สรุปสั้น |
