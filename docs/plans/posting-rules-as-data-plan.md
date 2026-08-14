# Plan: G2 — Posting Rules เป็น Data (ไม่ใช่ hardcode)

- สถานะ: **DRAFT — รอ owner เคาะ §5 (รูปแบบกฎ v2) และ §6.2 (ความหมายของ effective date)**
- วันที่: 2026-08-14
- ต่อยอดจาก: `docs/agent-memory/cr-2-posting-rule-writer.md` (สถานะ IN PROGRESS, slice 1 landed 2026-08-09), `docs/plans/chart-of-accounts-master-data-bootstrap-plan.md` Phase 6
- โจทย์จากเจ้าของผลิตภัณฑ์: *"ทำเพิ่มอย่างละเอียดรอบคอบ"*

---

## 1. อ่านก่อนทำ — ข้อเท็จจริงที่เปลี่ยนวิธีคิด

### 1.1 ทีมเคยตัดสินใจ **ไม่ใช้** `PostingRule` แบบ flat แล้ว — และมีเหตุผลที่ถูกต้อง

`docs/plans/chart-of-accounts-master-data-bootstrap-plan.md:265-270` บันทึกว่า Phase 6 ส่งมอบเป็น **source-specific account bindings ไม่ใช่ `PostingRule` rows** เพราะ:

> กฎ 4 ข้อที่ owner อนุมัติเป็นแบบ per-document ทั้งหมด และ **rule แบบ flat `(documentType, ruleKey) → {debit, credit}` แสดงออกไม่ได้**

**แผนนี้จึงไม่ใช่ "ย้าย hardcode ไป PostingRule ตามที่มีอยู่" — แต่คือการออกแบบ rule shape ที่แสดงกฎจริงได้ก่อน แล้วค่อยย้าย**

### 1.2 `DEFAULT_ACCOUNT_CODES` ผิด 8 จาก 10 — guard ที่มีอยู่ต้องคงไว้

`posting-engine.logic.ts:48-59` เทียบกับผัง `TH_SME_COA_V1`:

| Key | code ในโค้ด | ความจริงในผัง |
|---|---|---|
| `ACCOUNTS_RECEIVABLE` | `1210-00` | **ผิด** — `1210-00` คือลูกหนี้เงินให้กู้ยืม; AR จริงคือ `1130-01` |
| `EXPENSE_GENERAL` | `5310-01` | **ผิด** — `5310-01` คือเงินเดือน |
| `OUTPUT_VAT` | `2210-01` | ไม่มีในผัง (ที่ถูกคือ `2135-00`) |
| `INPUT_VAT` | `1280-00` | ไม่มีในผัง (ที่ถูกคือ `1154-00`) |
| `WHT_PAYABLE` | `2210-02` | ไม่มีในผัง (`2210-00` = เงินกู้ระยะยาว) |
| `WHT_RECEIVABLE` | `1270-00` | ไม่มีในผัง (ใกล้สุด `1156-00`) |
| `CASH_OR_BANK` | `1110-01` | ไม่มีในผัง (ใกล้สุด `1111-00`) |
| `EMPLOYEE_PAYABLE` | `2130-01` | ไม่มีในผัง |
| `ACCOUNTS_PAYABLE` | `2120-01` | ✅ ถูก |
| `REVENUE` | `4100-01` | ✅ ถูก |

`requiresReviewedPostingRules` (`:61-73`) บล็อกบริษัทที่ผ่าน chart bootstrap ไม่ให้ตกไปใช้ default พวกนี้ — **นี่คือพฤติกรรมที่ถูก** memory doc บันทึกว่าข้อเสนอเก่าที่ว่า "ปล่อยให้ fallback ทำงาน" ถูก **ยกเลิกแล้ว** เพราะจะได้บัญชีผิดร้ายแรง ไม่ใช่แค่ไม่ครบ

> **ห้ามทำ:** อย่า "แก้" guard นี้เพื่อให้ posting ผ่าน — ทางแก้คือทำให้มีกฎที่ถูกต้อง

### 1.3 สภาพ `PostingRule` วันนี้

โมเดลมี (`schema.prisma:2745-2768`) แต่:
- **ไม่มี writer ใด ๆ ในระบบ** — ไม่มี repository create, ไม่มี seed, ไม่มี endpoint
- อ่านที่เดียว: `findActivePostingRule` (`prisma-ledger.repository.ts:324-346`) → คืนแค่ `mappingJson`
- `conditionJson`, `debitAccountId`, `creditAccountId` = **dead columns** ไม่มีใครอ่าน
- permission `ledger.posting-rule.read|manage` มีอยู่ (`permission-registry.ts:207-208`) แต่ route ที่ใช้จริงคือ **expense-account-binding** — ชื่อ permission กับสิ่งที่คุมไม่ตรงกัน

### 1.4 มี precedent ที่ทำถูกแล้วในระบบเดียวกัน

`TaxAccountDeterminationRule` (`schema.prisma:3327-3352`) มีครบทุกอย่างที่ `PostingRule` ควรมี:
`(companyId, taxCodeDefinitionId, taxRegime, direction, treatment, transactionContext, sourceModule, accountRole, postingSide, accountId, priority, conditionJson, status, effectiveFrom/To, version, reviewedByUserId)`

**นี่คือแม่แบบ** — `PostingRule` v2 ควรเดินตามโครงนี้ ไม่ใช่คิดใหม่

---

## 2. เป้าหมายและ non-goals

**เป้าหมาย**
1. กฎการลงบัญชีเป็น **ข้อมูลที่ทีม compliance แก้ได้เอง** ไม่ต้อง deploy
2. รายการเก่าคำนวณด้วย **กฎ ณ วันที่เกิดรายการ** ไม่ใช่กฎวันนี้
3. ทุกการ post ตอบได้ว่า **ใช้กฎ id/version ไหน** (ผูกกับ audit ของแผน G1)
4. ปิด 2 ช่องที่ยังทำให้ governed company post ไม่ได้: WHT และ cash/bank ตามวิธีจ่าย

**Non-goals**
- ไม่ทำ UI ให้ผู้ใช้ทั่วไปแก้กฎเอง (รอบนี้เป็น admin/compliance เท่านั้น)
- ไม่ย้อนกลับไปแก้ journal ที่ post ไปแล้ว (ดู §7.1)
- ไม่แตะ `TaxAccountDeterminationRule` (VAT ทำงานถูกอยู่แล้ว)

---

## 3. ลำดับที่ห้ามสลับ (จาก memory doc)

`cr-2-posting-rule-writer.md` ระบุชัด: **"ห้ามสลับลำดับ"**

```
1. WHT แยกตามประเภทผู้รับ (2132-03 ภ.ง.ด.3 / 2132-04 ภ.ง.ด.53)
2. cash/bank เลือกจากวิธีจ่ายจริง
3. ★ ค่อยเปิด expense_auto_post
```

เหตุผล: เปิด auto-post ก่อนที่กฎครบ = ทุกเอกสารกลายเป็น `posting_error` เงียบ ๆ

**แผนนี้เพิ่มขั้น 0 เข้าไปข้างหน้า** = ออกแบบ rule shape ให้แสดงกฎ 1 และ 2 ได้ก่อน มิฉะนั้นจะไปทำ binding เพิ่มอีกสองแบบแล้วยิ่งกระจาย

---

## 4. ช่องว่างที่ทำให้ post ไม่ได้วันนี้ (governed company)

| เคส | สิ่งที่เกิดขึ้น | ที่มา |
|---|---|---|
| expense ที่มี WHT | `{error:'wht_account_unmapped'}` — post ไม่ได้เลย | `posting-engine.logic.ts:253-263` |
| `expense.payment` / `reimbursement.payment` | `posting_rule_missing` (ไม่มี binding ของ cash/bank) | `journal.use-case.ts:573-605` |
| `REVIEWED_PAYABLE_CODES` | ยัง hardcode `{accountsPayableCode:'2120-01', employeePayableCode:'2131-09'}` ใน **application use case** | `journal.use-case.ts:79` |
| ผัง TH SME v1 | **ไม่มีบัญชี WHT-receivable** | `wht-settlement-capture-spec.md:71` |
| ใบเสร็จรับเงินที่มี output VAT `O7`/`OX` | ยังวิ่งผ่าน `buildDefaultPostingLines` → เขียน `2210-01` ที่ **ไม่มีในผัง** | `journal.use-case.ts:618-630` |

**รายการสุดท้ายสำคัญ:** เป็นเส้นทางเดียวที่ hardcode ยัง "หลุด" ไปเขียนบัญชีจริงบน governed company ได้ — ต้องปิดในแผนนี้

---

## 5. ออกแบบ `PostingRule` v2

### 5.1 ปัญหาที่ต้องแสดงออกให้ได้

| กฎจริง | มิติที่ต้องใช้ตัดสิน |
|---|---|
| Dr ค่าใช้จ่ายตามหมวด | `expenseCategoryId` ต่อ **บรรทัด** (หลายบัญชีในใบเดียว) |
| Cr WHT ตามประเภทผู้รับ | `payeeEntityKind` (บุคคล→ภ.ง.ด.3 / นิติ→ภ.ง.ด.53) |
| Cr cash/bank ตามวิธีจ่าย | `paymentMethod` / `bankAccountId` |
| Cr เจ้าหนี้ | ปกติ `2120-01`, ถ้าเป็นใบเบิกพนักงาน `2131-09` |

flat `{debitAccountCode, creditAccountCode, whtAccountCode}` แสดง 3 ข้อแรกไม่ได้

### 5.2 ข้อเสนอ: rule = ชุดของ "leg" ที่มี resolver

```jsonc
{
  "ruleKey": "expense.confirmed",
  "documentType": "expense.record",
  "version": 3,
  "effectiveFrom": "2026-01-01",
  "effectiveTo": null,
  "explainTh": "บันทึกค่าใช้จ่ายค้างจ่าย",
  "lawRef": null,
  "legs": [
    {
      "role": "EXPENSE_DEBIT",
      "side": "DEBIT",
      "amount": "NET_OF_VAT",
      "resolver": { "kind": "EXPENSE_CATEGORY_BINDING" }      // แตกได้หลายบรรทัด
    },
    {
      "role": "WHT_PAYABLE",
      "side": "CREDIT",
      "amount": "WHT_TOTAL",
      "skipWhenZero": true,
      "resolver": {
        "kind": "LOOKUP",
        "by": "payeeEntityKind",
        "map": { "INDIVIDUAL": "2132-03", "JURISTIC": "2132-04" }
      }
    },
    {
      "role": "PAYABLE",
      "side": "CREDIT",
      "amount": "GROSS_MINUS_WHT",
      "resolver": {
        "kind": "LOOKUP",
        "by": "sourceEventVariant",
        "map": { "expense.claim.confirmed": "2131-09", "*": "2120-01" }
      }
    }
  ]
}
```

**resolver 3 แบบพอสำหรับกฎที่ owner อนุมัติทั้ง 4 ข้อ:**
- `FIXED` — บัญชีตายตัว
- `LOOKUP` — เลือกจาก field เดียวใน context ผ่าน map (มี `*` เป็น default)
- `EXPENSE_CATEGORY_BINDING` — แตกหลายบรรทัดตาม binding ที่มีอยู่แล้ว (ใช้ `resolveExpenseDebits` เดิม ไม่เขียนใหม่)

**สิ่งที่จงใจไม่ทำ:** ไม่ทำ expression language ทั่วไป (`conditionJson` แบบ arbitrary) — YAGNI และตรวจสอบยาก; ถ้ามีกฎที่ 3 resolver แสดงไม่ได้ ให้เพิ่ม resolver kind ใหม่ที่มีชื่อชัดเจน

**`amount` เป็น enum ปิด** ไม่ใช่สูตร: `GROSS | NET_OF_VAT | WHT_TOTAL | GROSS_MINUS_WHT | VAT_TOTAL`

### 5.3 VAT ยังไม่แตะ

`buildTransactionTaxPostingLines` (`posting-engine.logic.ts:292-380`) จัดการ VAT จาก `TaxAccountDeterminationRule` อยู่แล้วและ **ถูกต้อง** — leg ของ `PostingRule` ต้องส่ง **gross ทั้งสองข้าง** เหมือน `buildBoundExpenseAccrualLines` ทำวันนี้ (`:258-287`) แล้วให้ตัว tax engine carve VAT ออก

> ข้อผิดพลาดที่ต้องระวัง: ถ้า leg ออกบรรทัด VAT เองด้วย จะ **double-book** — memory doc เตือนข้อนี้ไว้ชัด

### 5.4 ตาราง

ทางเลือก: (A) เพิ่ม field ใน `PostingRule` เดิม, (B) ตารางใหม่ `PostingRuleLeg`

**แนะนำ A** — เก็บ legs ใน `mappingJson` แล้วเพิ่ม `mappingSchemaVersion Int` เพื่อแยก v1 (flat) กับ v2 (legs) เหตุผล: ไม่มี row v1 อยู่จริงเลยในระบบ (§1.3) จึงไม่มีข้อมูลต้อง migrate และ JSON ตรวจด้วย schema validator ได้

ต้องเพิ่ม field:
- `mappingSchemaVersion Int @default(2)`
- `explainTh String?` และ `lawRef String?` (สอดคล้องหลัก "อธิบายได้" ของ G1)
- `reviewedByUserId String?` + `reviewedAt` (ตาม pattern ของ `TaxAccountDeterminationRule` และ `ExpenseCategory.ledgerAccountReviewedByUserId`)
- ใช้ `status` เดิม แต่เพิ่มค่า `DRAFT` ให้ pattern review-gated เหมือน `TaxRuleStatus` ที่ระบบใช้อยู่

ลบ/เลิกใช้: `debitAccountId`, `creditAccountId`, `conditionJson` (mark deprecated ก่อน ค่อยลบในรอบถัดไป)

---

## 6. จุดที่ต้องระวังเป็นพิเศษ (ละเอียดตามที่ขอ)

### 6.1 idempotency ทำให้กฎใหม่ **ไม่มีผลย้อนหลัง** — ต้องสื่อสารให้ชัด

`JournalEntry @@unique([companyId, sourceType, sourceId, entryType])` + `findGeneratedJournal` (`journal.use-case.ts:544-548`) → generate ซ้ำจะ **คืน journal เดิมเงียบ ๆ** ไม่ post ใหม่ตามกฎใหม่

**ผลที่ตามมา:**
- ✅ ดี: แก้กฎแล้วบัญชีที่ลงไปแล้วไม่กระโดด
- ⚠️ ต้องระวัง: ถ้าเจอว่ากฎเดิมผิด **ต้อง reverse แล้ว post ใหม่** เท่านั้น — ต้องมีเครื่องมือ/runbook สำหรับกรณีนี้ และต้องบอกผู้ใช้ว่า "แก้กฎแล้วรายการเก่าไม่เปลี่ยน"

### 6.2 ⚠️ effective date เทียบกับ **เวลาที่ post** ไม่ใช่วันที่เอกสาร — landmine

`findActivePostingRule` (`prisma-ledger.repository.ts:330-342`) ใช้ `now()` ไม่ใช่ `source.sourceDate`

**ผลวันนี้:** backfill เอกสารเดือนมกราคมในเดือนสิงหาคม → ได้กฎที่ effective ณ เดือนสิงหาคม ซึ่งผิดหลัก "รายการเก่าใช้กฎ ณ วันนั้น"

**ต้องเคาะ:** เปลี่ยนเป็นเทียบกับวันที่เอกสารหรือไม่
- **แนะนำ: เปลี่ยน** — เพราะเป้าหมายข้อ 2 ของแผนนี้ต้องการแบบนั้น
- **แต่ระวัง:** การเปลี่ยนนี้จะทำให้ backfill ที่กำลังจะรัน resolve กฎคนละตัวกับที่ทดสอบไว้ → ต้องทำ **ก่อน** เปิด auto-post และต้องมี preview

### 6.3 การแยก id กับ code ใช้ heuristic เปราะ

`journal.use-case.ts:639-657` ตัดสินว่า `accountId` เป็น "code" ถ้ามี `-` อยู่ในสตริง (cuid ไม่มี `-`)

ใช้ได้วันนี้ แต่เป็น string-shape heuristic ไม่ใช่ typed discriminator — **v2 ควรระบุชัด** เช่น `{"accountCode": "2132-03"}` vs `{"accountId": "clx..."}` แยก key กันไปเลย

### 6.4 การ post ไม่ได้อยู่ใน transaction เดียวกับ markSource

`journal.use-case.ts:665-669` — reserve number → create → post → commit number → `markSource` **ไม่ได้ห่อ transaction** และ `markSource` (`:374-394`) เขียน `postingStatus` ไปยัง 7 repository คนละตัว

แผนนี้ **ไม่แก้เรื่องนี้** (นอกขอบเขต) แต่ต้องรู้ไว้ว่าถ้า rule ใหม่ทำให้ post ล้มกลางทาง อาจเหลือสถานะค้าง — ให้ทดสอบ failure path ด้วย

### 6.5 `selectPostingRuleCandidate` เลือก version สูงสุด ไม่ใช่ตาม effective date

`posting-engine.logic.ts:35-44` — company-scoped ชนะ platform, แล้วเลือก **version สูงสุด**

ถ้าจะมีหลาย version ที่ effective คนละช่วง ต้องแน่ใจว่า query กรอง effective ถูกก่อน แล้วค่อยเลือก version — ไม่งั้น version ใหม่ที่ยังไม่ effective จะชนะ (วันนี้ query กรอง effective แล้ว จึงยังถูก แต่ถ้าเปลี่ยนตาม §6.2 ต้องตรวจซ้ำ)

### 6.6 `PostingTemplate` เป็น dead type

`posting-engine.logic.ts:20-28` — declared แต่ไม่มีใครใช้ (เศษจากดีไซน์เก่าที่มี `amountKey` indirection) ให้ลบตอนทำ v2 เพื่อไม่ให้สับสนกับ shape ใหม่

---

## 7. แผนการส่งมอบ

| Phase | งาน | Effort | เงื่อนไข |
|---|---|---|---|
| 0 | **สรุป rule shape v2 + JSON schema validator + unit test ของ resolver ทั้ง 3 แบบ** (ยังไม่ต่อเข้า posting path) | M | ต้องเคาะ §5.2 ก่อน |
| 1 | เพิ่ม field ใน `PostingRule` (`mappingSchemaVersion`, `explainTh`, `lawRef`, `reviewedBy*`, status DRAFT) + migration | S | |
| 2 | **repository writer + endpoint admin** (`GET/PUT companies/:c/posting/rules`) หลัง `ledger.posting-rule.manage` + audit HIGH | M | ปิดช่องที่ permission ชื่อไม่ตรงงาน (§1.3) |
| 3 | เพิ่มบัญชี WHT ในผัง TH SME v1 (`2132-03`, `2132-04`, และ **WHT-receivable ที่ยังไม่มี**) + migration บริษัทเดิม + อัปเดต checksum | M | ⚠️ แก้ผัง = checksum เปลี่ยน = กระทบ `requiresReviewedPostingRules` — ต้องทดสอบบริษัทเดิม |
| 4 | **กฎ WHT ตามประเภทผู้รับ** (ลำดับที่ 1 ของ memory doc) ผ่าน resolver `LOOKUP` | M | ปลดล็อก expense ที่มี WHT |
| 5 | **กฎ cash/bank ตามวิธีจ่าย** (ลำดับที่ 2) | M | ปลดล็อก `expense.payment` / `reimbursement.payment` |
| 6 | ย้าย `REVIEWED_PAYABLE_CODES` (`journal.use-case.ts:79`) → rule row | S | |
| 7 | ปิดช่อง `reviewedLegacyOutput` ที่ยังเขียน `2210-01` (§4 แถวสุดท้าย) → ให้ใช้ rule/tax engine | M | |
| 8 | เปลี่ยน effective-date ให้เทียบวันที่เอกสาร (§6.2) + preview ผลกระทบ | M | ต้องทำก่อน Phase 9 |
| 9 | **เปิด `expense_auto_post`** (ลำดับที่ 3) | S | ห้ามทำก่อน 4,5,8 ครบ |
| 10 | seed rule เริ่มต้นจาก `TH_SME_COA_V1_MAPPING_MANIFEST` (10 role, ทุกตัว `REVIEW_REQUIRED`) เป็น DRAFT ให้นักบัญชี activate | M | ตาม pattern `WhtIncomeCategory` ที่ ship DRAFT |

---

## 8. Acceptance criteria

1. governed company ที่มี expense พร้อม WHT → post สำเร็จ ได้ `Cr 2132-03` (ผู้รับบุคคล) หรือ `2132-04` (นิติบุคคล) ตามจริง
2. `expense.payment` และ `reimbursement.payment` → post สำเร็จ โดย cash/bank มาจากวิธีจ่ายจริง ไม่ใช่ค่าคงที่
3. แก้กฎผ่าน endpoint admin → รายการ **ใหม่** ใช้กฎใหม่, รายการ **เก่า** ไม่เปลี่ยน และมีข้อความบอกผู้ใช้เรื่องนี้
4. เอกสารลงวันที่ในช่วงที่กฎเก่า effective (แต่ post วันนี้) → ใช้ **กฎเก่า** (หลัง Phase 8)
5. journal ที่ generate ต้องบันทึกได้ว่าใช้ rule id + version ไหน
6. rule ที่ status `DRAFT` **ไม่ถูกใช้** post — ต้อง activate โดยผู้มีสิทธิ์ก่อน และมี audit
7. ไม่มีเส้นทางใดเขียนบัญชีที่ไม่มีอยู่ในผังของบริษัทได้อีก (ปิด `2210-01`, `1280-00`, `1210-00`, `5310-01` ที่หลุดอยู่)
8. เปิด auto-post แล้ว เอกสารตัวอย่างครบทุก event type post ผ่านโดยไม่มี `posting_error`
9. เทสต์เดิมทั้งหมดผ่าน โดยเฉพาะ `template-company-posting.use-case.spec.ts`, `expense-account-binding.*`, `wht-payment-posting.logic.spec.ts`, `journal-vat-invariant.use-case.spec.ts`

---

## 9. ความเสี่ยง

| ความเสี่ยง | ระดับ | การรับมือ |
|---|---|---|
| แก้ผังบัญชี → checksum เปลี่ยน → บริษัทเดิมสถานะ chart เพี้ยน | **สูง** | Phase 3 ต้องมี migration ที่อัปเดต `chartOfAccountsTemplateChecksum` ของบริษัทเดิมพร้อมกัน + test บริษัทที่ bootstrap ไปแล้ว |
| เปิด auto-post ก่อนกฎครบ → ทุกเอกสารเป็น `posting_error` | **สูง** | ลำดับ §3 ห้ามสลับ + Phase 9 มี precondition ตรวจว่ากฎครบทุก event ก่อนเปิด |
| เปลี่ยน effective date semantics แล้ว backfill ได้ผลต่างจากที่ทดสอบ | กลาง | Phase 8 ต้องมี preview endpoint ที่เทียบผลก่อน/หลังบนข้อมูลจริง |
| leg ออกบรรทัด VAT เองแล้ว double-book | กลาง | leg ส่ง gross ทั้งสองข้างเสมอ + invariant test ว่า VAT มาจาก tax engine เท่านั้น (`journal-vat-invariant.use-case.spec.ts` มีอยู่แล้ว) |
| JSON schema ผิดแล้ว post พังตอน runtime | กลาง | validate ตอนเขียน (endpoint) ไม่ใช่ตอน post + rule เข้าเป็น DRAFT ก่อนเสมอ |
| ทำ resolver ทั่วไปเกินจำเป็น | ต่ำ | จำกัด 3 kind ตาม §5.2; เพิ่มใหม่ต้องมีชื่อเฉพาะ ไม่ใช่ expression language |

---

## 10. สิ่งที่ต้องเคาะก่อนเริ่ม

1. **รูปแบบ rule v2** (§5.2) — legs + resolver 3 แบบ พอไหม
2. **effective date** (§6.2) — เปลี่ยนไปเทียบวันที่เอกสารหรือคงเดิม
3. **บัญชี WHT-receivable** — ใช้ code อะไรในผัง TH SME v1 (ยังไม่มี)
4. **ใครมีสิทธิ์ activate rule** — `ledger.posting-rule.manage` เดิม หรือต้อง OWNER เหมือน critical อื่น
