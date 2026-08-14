# Agent Memory: Expense Blueprint Gap Closure (G1/G2/G3/G5 + ใบรับรองแทนใบเสร็จ)

Status: **แผนเสร็จ 5 ฉบับ · G8 ยืนยันแล้วว่าไม่ต้องแก้โค้ด · Phase 1 ของแผนใบรับรองแทนใบเสร็จ (บั๊ก dedup) ทำเสร็จ+เทสต์ผ่าน 2026-08-14 · ที่เหลือรอ owner เคาะ**

Owner: thawtchai (เจ้าของผลิตภัณฑ์) · วันที่บันทึก 2026-08-14 · branch `20260811`

## Scope

ต่อยอดจาก blueprint ผลิตภัณฑ์ (persona + rule engine) ที่ออกแบบไว้นอก repo แล้วนำมาเทียบกับโค้ดจริง เจ้าของเลือกทำ 6 หัวข้อ:

| # | หัวข้อ | สถานะ |
|---|---|---|
| 1 | ใบรับรองแทนใบเสร็จ — ตรวจว่าขาดอะไร + แจ้งเตือนกลับ | แผนเสร็จ |
| 2 | G1 verdict engine ให้สมกับระบบที่มี AI | แผนเสร็จ |
| 3 | G2 posting rules เป็น data (ละเอียดรอบคอบ) | แผนเสร็จ |
| 4 | G3 เชื่อมระบบสรรพากร | แผนเสร็จ (ต้อง spike ก่อน) |
| 5 | G4 non-VAT→VAT | **เลื่อน** — MVP1 ยังไม่เปิดให้กรอกรายรับ |
| 6 | G5 ยืนยันกฎ WHT | แผนเสร็จ |
| 7 | G6 ปิดบัญชีสิ้นปี | **เลื่อนไป MVP2** |
| 8 | G8 แก้บั๊ก P1 GAP-01 + GAP-07 | **ไม่ต้องแก้ — แก้ไปแล้ว ยืนยันด้วยเทสต์** |

## Decisions

1. **G4 เลื่อน / G6 ไป MVP2** — เจ้าของเคาะ 2026-08-14
2. **AI เล่า ไม่ตัดสิน** — verdict ทุกข้อคำนวณจาก deterministic logic; AI Gateway แปลงเป็นภาษาคนเท่านั้น เหตุผล: สรรพากรตรวจย้อนหลัง 2 ปี ต้อง reproducible + ต้องทำงานได้แม้ AI ล่ม/budget หมด (`receipt-ocr.client.ts` คืน `failed` ไม่ throw — เดินตาม pattern นี้)
3. **catalog เหตุผลเดียวร่วมกัน** — แผนใบรับรองแทนใบเสร็จ (`EvidenceGap`) กับ G1 (`TaxReason`) ต้องใช้ไฟล์เดียวใน `packages/contracts` ห้ามแยกสองชุด
4. **G2 ต้องออกแบบ rule shape ใหม่ก่อนย้าย** — ทีมเคยตัดสินใจ (Phase 6 ของ chart bootstrap plan) ว่า flat `PostingRule` แสดงกฎจริงไม่ได้ จึงส่งมอบเป็น account bindings แทน
5. **`requiresReviewedPostingRules` ห้ามแก้เพื่อให้ post ผ่าน** — `DEFAULT_ACCOUNT_CODES` ผิด 8/10 (ยืนยันซ้ำจาก `cr-2-posting-rule-writer.md`)
6. **G3 ต้อง fail-open** — RD service ไม่มี SLA/rate limit ประกาศ; ตรวจไม่ได้ = `UNKNOWN` ไม่ใช่ `INVALID` และห้ามบล็อกการบันทึกรายจ่าย

## หลักฐานที่ยืนยันแล้ว (ห้ามเสียเวลาตรวจซ้ำ)

**G8 — ทั้งสองบั๊กแก้แล้ว รันเทสต์จริง 24/24 ผ่าน (2026-08-14):**
```
npx tsx --test src/modules/employee-access/domain/logic/role-template-read-coverage.spec.ts \
  src/modules/employee-access/domain/logic/role-template-system-role-parity.spec.ts \
  src/modules/ledger/application/use-cases/expense-payment-posting.use-case.spec.ts \
  src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts
```
- GAP-01: `FINANCE_PACKS` มี `.view` ครบ, `tpl.x.accounting` มี `pack.ledger.view`+`pack.tax.view`, guard test ยืนยัน "24 finance reads" และ paired-read ทั้งระบบ
- GAP-07: มี canonical source `expense.payment` แล้ว (`journal.use-case.ts:417-431`, key ต่อ payment id), `countPostingBlockers` มีเทสต์ GAP-07 โดยเฉพาะ, ด่านปิดงวดรวม reimbursement blockers แล้ว

**สภาพจริงของ verdict 4 ด้าน (แก้ความเข้าใจเดิมที่ประเมินต่ำไป):**
- (a) เอกสาร — ✅ มี `deriveTaxEvidence` (`expense-document.logic.ts:33`) + reason code 12 แบบ **แต่รันเฉพาะตอน intake และเฉพาะเมื่อ doc type ยัง `NEEDS_REVIEW`** (`expense-extraction.use-case.ts:156`)
- (b) หักรายจ่าย ม.65 ตรี — ❌ **ไม่มีเลย** (`NONDEDUCTIBLE_*` ใน `TaxClaimability` เป็นเรื่อง VAT ไม่ใช่ CIT)
- (c) ภาษีซื้อ — 🟡 **สองคำตอบไม่ reconcile**: `ExpenseRecord.inputVatClaimStatus` (คนกรอก, ไม่มี derive function) vs `ExpenseLine.claimabilitySnapshot` (ระบบคำนวณ, `transaction-tax.logic.ts:244`)
- (d) WHT — ❌ **ไม่มี logic ตัดสิน** `wht = round2(taxable × whtRate)` (`expense-totals.logic.ts:75`), rate มาจาก OCR เท่านั้น, `WhtIncomeCategory` **ไม่มี relation ไป ExpenseLine/ExpenseRecord เลย**

**Pattern ที่ต้องรักษา:** ระบบ gate ด้วย **evidence-signal grounding** (ต้องคัด span จริงจากข้อความ OCR ขั้นที่ 1) ไม่ใช่ตัวเลข confidence ลอย ๆ — `parseBusinessDocumentClassification`, `gateBusinessDocumentClassification`, `amountSignalSupports` · threshold จริงมีตัวเดียวคือ `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE = 0.85`

**ที่เก็บ input contract ที่พร้อมใช้:** `expenseTaxSourceChecksum` (`expense-status.logic.ts:21`) รวบ fact ภาษีครบแล้ว (ใช้ทำ checksum) — refactor ให้ share shape อย่าประกอบใหม่

**ai-draft คือท่อที่ต้องใช้ต่อ:** `AiDraftGenerationRequest/Result` (`packages/contracts/src/ai-draft-suggestion.ts:272,294`) generic อยู่แล้ว, prompt เป็น persona น้องมั่งมี ห้ามแต่งข้อมูลนอก FACTS, template `tax_evidence_checklist` มีแล้วแต่ evidence collector เป็น **stub 3 บรรทัด** (`suggestion-generator.service.ts:90-94`) ← ช่องรอเสียบ

## บั๊กใหม่ที่พบ

1. ✅ **แก้แล้ว 2026-08-14 · P1 · แจ้งเตือนผู้อนุมัติใบรับรองแทนใบเสร็จไม่ทำงาน**
   **สาเหตุ:** `notifySignaturePending` ใช้ `triggerKey+sourceModule+sourceType+sourceId` ชุดเดียวกันทั้งตอน prepare และ certify และไม่ส่ง `periodKey` → `buildDedupKey` (`notification.logic.ts:14-31`) ได้คีย์เดียวกัน → prepare ตั้ง cooldown 60 นาที → ผู้จ่ายลงนามภายใน 1 ชม. (กรณีปกติ) → certify ได้ `{skipped:true,'cooldown'}` (`notification.use-cases.ts:211-215`) **ไม่มี recipient/delivery ของผู้อนุมัติเกิดขึ้นเลย** · unit spec เดิม stub notify ทั้งก้อนจึงจับไม่ได้
   **การแก้:** ตาราง `SIGNATURE_STAGES` ใน `substitute-receipt.use-case.ts` — `PAYER` คงคีย์เดิม `expense.substitute_receipt_signature_pending` (preference ผู้ใช้เดิมไม่พัง), `APPROVER` ได้คีย์ใหม่ `expense.substitute_receipt_approval_pending` + ข้อความที่ตรงงาน · ลงทะเบียนคีย์ใหม่ใน `IMPLEMENTED_TRIGGER_KEYS` (ถ้าลืม LINE gate จะ drop เงียบ)
   **Guard test:** `'gives the payer and approver stages distinct dedup keys for the same certificate'` — เดินจริงทั้ง prepare+certify แล้ว assert `sourceId` เท่ากันแต่ `buildDedupKey()` ต่างกัน + ทุก triggerKey ต้องอยู่ใน `IMPLEMENTED_TRIGGER_KEYS`
   **พิสูจน์ test:** จำลองบั๊กกลับ (ทำให้สองขั้นใช้คีย์เดียวกัน) → เทสต์ล้มตามคาด → คืนค่า
   **ผลรัน:** 13/13 ในไฟล์นั้น · ชุดรวม substitute-receipt + notification 9 ไฟล์ **101 เทสต์ exit 0** · `tsc` ไม่มี error ในไฟล์ที่แก้
   **บทเรียนที่ใช้ซ้ำได้:** trigger ใดที่ยิงหลายขั้นบน `sourceId` เดียวกัน **ต้องแยก triggerKey** — `buildDedupKey` ไม่มีมิติ "ขั้นตอน" และ cooldown default 60 นาทีจะกลืนขั้นถัดไปเสมอ
2. **P1 · `WhtIncomeCategory` เป็น global ข้ามผู้เช่า** — ไม่มีคอลัมน์ `companyId`, `@@unique([code])`, และ `SetWhtIncomeCategoryStatusUseCase` (`tax/.../wht-income-category.use-case.ts:32-35`) `update({where:{code}})` ไม่มี company scope แต่ audit ใต้ `ctx.companyId` → บริษัทหนึ่ง activate มีผลทุกบริษัท · **แก้ตาม `wht-rule-verification-plan` §2.1 (แนะนำทาง B: ตาราง activation ต่อบริษัท)**
3. **ผู้รับต่างประเทศตกไป ภ.ง.ด.53 เงียบ ๆ** — ไม่มี `PND54` ใน `TaxFormType`; `FOREIGN` fallback ที่ `sync-tax-events.use-case.ts:305-310` โดย**ไม่สร้าง review issue**
4. **บิลปนสินค้า+บริการ ที่เส้นจ่ายเงินอาจหักเกิน** — UI แนะนำ `bill.taxableAmount × rate` = ฐานทั้งบิลรวมสินค้า (`AccountsPayablePages.tsx:580-584`)

## Open questions (ต้อง owner เคาะก่อน implement)

1. ใบรับรองแทนใบเสร็จ: เจ้าของบริษัทรับแจ้งเตือนแบบ digest รายวัน หรือรายใบ · ตัวเลข SLA เตือนซ้ำ/escalate
2. G1: ขอบเขต deductibility ม.65 ตรี — ทำ 5 กลุ่มตามที่เสนอ หรือกว้างกว่า · วิธีเก็บ verdict (แนะนำทาง C: คำนวณสดตอน draft + snapshot ตอน confirm)
3. G2: รูปแบบ rule v2 (legs + resolver 3 kind) พอไหม · effective date เทียบวันที่เอกสารแทน `now()` หรือไม่ · code ของบัญชี WHT-receivable ที่ผัง TH SME v1 ยังไม่มี · ใครมีสิทธิ์ activate rule
4. G5: เลือกทาง A/B/C ของ cross-tenant catalog (แนะนำ B)

## Artifacts

- `docs/product/expense-blueprint-gap-and-user-stories-th.md` — ตารางช่องว่าง + user story 19 ข้อ + §0-A บันทึกการแก้ความเข้าใจ
- `docs/plans/expense-evidence-completeness-and-notification-plan.md`
- `docs/plans/expense-verdict-engine-plan.md`
- `docs/plans/posting-rules-as-data-plan.md`
- `docs/plans/rd-taxpayer-verification-plan.md`
- `docs/plans/wht-rule-verification-plan.md`
- `docs/specs/finance-accounting-gaps-spec.md` — อัปเดต GAP-01/GAP-07 เป็น ✅ พร้อมหลักฐาน

## Verification

- รันเทสต์ 4 ไฟล์ที่เกี่ยวกับ GAP-01/GAP-07: **24/24 ผ่าน** (คำสั่งด้านบน)
- ยืนยันบั๊ก dedup ด้วยการอ่านโค้ดตรง: `notification.logic.ts:14-31` + `notification.use-cases.ts:202-215,225-226` + `substitute-receipt.use-case.ts:242-262`
- ยืนยัน cross-tenant ด้วยการอ่านโค้ดตรง: `schema.prisma:3571-3588` (ไม่มี companyId) + `wht-income-category.use-case.ts:29-35`
- G3: ยืนยัน endpoint จากหน้าทางการกรมสรรพากร (rd.go.th/42535, /42539) — **ยังไม่ได้เรียกจริง** ต้องทำ spike ตามแผน Phase 0

## Next

**ลำดับที่แนะนำ:**
1. ~~Phase 1 ของแผนใบรับรองแทนใบเสร็จ — แก้บั๊ก dedup~~ ✅ **เสร็จ 2026-08-14**
2. **§2.1 ของแผน G5** — แก้ cross-tenant catalog (เรื่อง isolation) ← **ถัดไป**
3. **Phase 1 ร่วมของ G1 + แผนใบรับรองฯ** — reason-code catalog ใน `packages/contracts` (เป็นฐานร่วม ทำครั้งเดียว)
4. **Phase 0 ของ G3** — spike RD service โดยเฉพาะข้อ "เรียกจาก ap-southeast-1 ได้ไหม" (เสี่ยงสุด รู้เร็วดีกว่า)
5. G2 Phase 0 (rule shape) — ต้องเคาะ 4 ข้อก่อน

**ห้ามทำก่อนของอื่น:** เปิด `expense_auto_post` — ลำดับใน `cr-2-posting-rule-writer.md` ระบุ "ห้ามสลับลำดับ" คือ WHT ตามผู้รับ → cash/bank ตามวิธีจ่าย → **ค่อย**เปิด auto-post
