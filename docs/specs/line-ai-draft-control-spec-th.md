# Spec: น้องมั่งมีคุมงาน draft ได้ — service charge, วันที่ พ.ศ., อธิบายรายการ, แก้ draft ผ่าน LINE (v1)

สถานะ: APPROVED-FOR-BUILD (Owner อนุมัติ 5 ข้อ 2026-09-05) · เจ้าของ: Owner · ผู้เขียน: Fable (control) · ผู้ทำ: Opus ตาม `docs/plans/line-ai-draft-control-plan-th.md`

ข้อกำหนดติดตาม 2026-09-26: [คำตอบและสิทธิ์แก้ค่าใช้จ่ายผ่าน LINE](line-ai-expense-edit-capability-consistency-spec-th.md) ระบุ Owner decision ว่า **ทุกฟิลด์ต้อง preview → กดยืนยัน** และปิดช่องว่างระหว่างคำชวนแก้กับคำถาม “แก้รายการได้ไหม”; ให้ใช้เอกสารติดตามนี้กับงานแก้ไขรอบถัดไป

## 0. ทำไมต้องมี (หลักฐานจริงจาก UAT 2026-09-03)

Owner ส่งบิลร้านอาหาร (BHC) ที่มี "Service charge 10% 152.00" ผ่าน LINE แล้วพบ 4 อย่างในเทิร์นเดียว (log UAT api-web + ai-gateway, build 71263dd0, expense `cmtldq6vb00rp4s4906qfzpl8`):

| # | เห็นอะไร | สาเหตุในโค้ด (ณ develop `d861e43e`) |
|---|---|---|
| E1 | หน้าเว็บไม่มีช่อง service charge — กลายเป็น "รายการสินค้า" ชื่อ service charge | `receipt-ocr-apply.service.ts:367-375` แปลง `additionalCharges` เป็น `ExpenseLine` ธรรมดา; โมเดล `ExpenseLine` (`apps/api/prisma/schema.prisma`) ไม่มีฟิลด์บอกว่าเป็นค่าใช้จ่ายเพิ่ม |
| E2 | การ์ดสรุปบอก "วันที่: ยังไม่ระบุ" ทั้งที่บิลพิมพ์ `03/09/69` | `line-ai-value-normalizer.ts:455-463` — วัน/เดือน ≤ 12 ทั้งคู่ → ไม่ยอมตัดสินยุค (การตัดสินใจ 2026-08-28 สำหรับ "ข้อความที่คนพิมพ์"); แต่ `process-line-webhook.use-case.ts:4391` ใส่ `expenseDate: todayCivilDate()` ให้เงียบ ๆ → บันทึกจริงเป็น "วันนี้" ขณะที่การ์ดบอก "ยังไม่ระบุ" |
| E3 | พิมพ์ "จากบิลเมื่อกี้มี service charge 10% นะ แก้ไขได้ใช่ไหม" → ตอบ "แก้ไขรายการเดิมให้แล้ว" แต่ที่ทำจริงคือเขียนประโยคทับ `note` | `line-correction.use-case.ts:112-116` แก้ได้ 5 ฟิลด์ (`LINE_CORRECTION_FIELDS`, `line-ai.ts:688`) และ `note` เป็นการ **เขียนทับ** (`:115`) ส่วน `amount` แก้ได้แค่ "บรรทัดเดียว" (`amountOnlyLine`, `:161-170`) |
| E4 | ถาม "ทำไม service charge คิดแยกเป็นอีกรายการ" → ถูกปฏิเสธว่า "อยู่นอกขอบเขตระบบ" | intake = `BUSINESS_READ_QUESTION` (0.55) → gateway agent `general` ไม่มี tool ที่ "อธิบายรายการของฉัน" → `unsupported_module` → copy เดียวกับคำถามนอกระบบจริง ๆ (`line-ai-turn.use-case.ts:19`, `response-composer.agent.ts:183`) |

เป้าหมายปลายทางที่ Owner ตั้งไว้: **น้องมั่งมีต้องคุมระบบได้** — อ่าน อธิบาย และแก้งานที่ยังเป็น draft ได้ภายใต้สิทธิ์ ไม่ใช่แค่จดโน้ต

## 1. การตัดสินใจของ Owner (2026-09-05)

1. service charge (และค่าใช้จ่ายเพิ่มชนิดอื่น) เป็นช่องของตัวเอง ทั้ง OCR → draft → เว็บ → การ์ด LINE → เครื่องมืออ่าน
2. วันที่แบบ พ.ศ. 2 หลักบนใบเสร็จต้องอ่านได้ และ**ห้ามใส่วันที่วันนี้ให้เงียบ ๆ**
3. คำถามเกี่ยวกับ "รายการของฉัน" ต้องตอบได้ (explain)
4. AI ต้องอธิบายงานและ**แก้ไขงานได้ตราบที่ยังเป็น draft**; ข้อความปฏิเสธต้องแยก "ยังไม่รองรับ (อยู่ในระบบแต่ยังทำไม่ได้)" ออกจาก "นอกขอบเขต"
5. ทำทั้งหมด แต่ **deploy UAT ครั้งเดียว** เมื่อทุกอย่างเสร็จ (รวม stale-identity fix + LIFF UX batch)

กติกาประจำ: ทุกการแก้ต้องกวาด impact / bug / gap รอบ ๆ ให้ครบ (§9) ไม่ใช่แก้แค่อาการที่เห็น

## 2. หลักการที่ห้ามละเมิด (สืบทอด ADR/spec เดิม)

- AI Gateway เรียกได้แต่ **tool ที่ตรวจสิทธิ์ผ่าน API** ไม่แตะ DB ตรง (AGENTS.md); การเขียนทุกครั้งผ่าน use-case เดียวกับที่เว็บใช้ (reconcile ยอด, audit) ไม่มี raw write
- **final mutation อยู่ที่เว็บเท่านั้น** (CONFIRMED/VOIDED/ลงบัญชี) — LINE แก้ได้เฉพาะสถานะ `DRAFT | NEEDS_REVIEW | READY_FOR_CONFIRMATION` (`enum ExpenseStatus`)
- ทุกการแก้ผ่าน LINE ต้อง **แสดงตัวอย่างก่อน แล้วผู้ใช้กดยืนยัน** (postback) — postback ทำได้ไม่เกินสิ่งที่พิมพ์ขอได้ (หลักเดิม `process-line-webhook.use-case.ts:1630`); ข้อความจากโมเดลไม่มีอำนาจสั่งเขียน (prepared plan = UNTRUSTED)
- **ความจริงก่อน**: ข้อความตอบต้องตรงกับสิ่งที่ระบบทำจริง ("บันทึกหมายเหตุไว้" ≠ "แก้ให้แล้ว"); ค่าที่เดา/สมมติต้องบอกว่าเดา
- provenance ของแชท: แก้ได้เฉพาะ record ที่ถูกจับในแชทนี้/โดยผู้ใช้นี้ ภายในหน้าต่างเวลาเดิมของ correction lane (`:333`)
- ไม่มี dependency ใหม่ ไม่แก้ `package.json` นอกจากเพิ่ม path spec; ไม่แตะ `LIFF_PAGE_CSP`
- วันที่ตาม ADR 0011: ไม่ถาม clarify บนเส้นทางใบเสร็จ; สิ่งที่ตัดสินไม่ได้ให้ปล่อยว่างและบอกตรง ๆ

## 3. Journey ที่ต้องเป็นจริงหลังทำเสร็จ (ผ่านมือถือ, ภาษาไทยธรรมดา, ห้ามมี "+" ในข้อความลูกค้า)

### J1 ส่งบิลที่มี service charge (S-1 + S-2)
1. ส่งรูปบิล BHC → การ์ดสรุป: ร้าน, **วันที่ 03/09/2569 (อ่านจากบิล)**, รายการสินค้า 3 บรรทัด, **ค่าบริการ 10% 152.00**, ส่วนลด (ถ้ามี), VAT 117.04, รวม 1,789.04, สถานะ "ร่าง รอตรวจ"
2. เว็บ `ExpenseReviewPage`: ตารางรายการ + กลุ่ม "ค่าใช้จ่ายเพิ่ม" แยกจากสินค้า; แถวสรุป "ค่าบริการ" อยู่ระหว่าง "ส่วนลด" กับ "VAT"; ปุ่ม "เพิ่มค่าบริการ/ค่าส่ง" ในโหมดแก้ไข
3. ยอดเชื่อมกันเสมอ: `รวมสินค้า − ส่วนลด + ค่าใช้จ่ายเพิ่ม = ฐานภาษี` และ `ฐานภาษี + VAT = ยอดรวม` (ตามที่ apply service ยืนยันอยู่แล้ว `:84`)

### J2 ถาม "ทำไม" (S-3)
"ทำไม service charge คิดแยกเป็นอีกรายการ" → น้องมั่งมีตอบจากข้อมูลจริง: "บิล BHC 03/09/2569 ยอด 1,789.04 มาจาก สินค้า 1,520.00 + ค่าบริการ 10% 152.00 = 1,672.00 แล้วบวก VAT 7% 117.04 ค่ะ ค่าบริการแยกเป็นช่องของตัวเองเพื่อให้ยอดฐานภาษีถูก ถ้าจะแก้ พิมพ์บอกได้เลย เช่น 'ค่าบริการ 5%'" — ไม่มีการปฏิเสธว่านอกขอบเขต

### J3 แก้ draft ด้วยการพิมพ์ (S-4)
1. "จากบิลเมื่อกี้มี service charge 10% นะ" → น้องมั่งมี: "จะเพิ่มค่าบริการ 10% = 152.00 ให้บิล BHC 03/09/2569 ยอดรวมใหม่ 1,789.04 ค่ะ" + ปุ่ม **[ยืนยัน] [ยกเลิก]**
2. กดยืนยัน → บันทึก + audit → "แก้ให้แล้วค่ะ: เพิ่มค่าบริการ 152.00 · ยอดรวม 1,789.04 · ดูในเว็บ: <ลิงก์>"
3. ถ้าบิลมีค่าบริการอยู่แล้ว (เป็นบรรทัดสินค้าจาก OCR เก่า) → เสนอ "ย้ายเป็นช่องค่าบริการ" แทนการเพิ่มซ้ำ
4. ถ้า record ยืนยันแล้ว (CONFIRMED) → "รายการนี้ยืนยันไปแล้ว แก้ผ่าน LINE ไม่ได้ค่ะ ไปที่เว็บ <ลิงก์> เพื่อยกเลิกหรือแก้" (สถานะ `mutation_blocked`, ไม่ใช่ "นอกขอบเขต")

### J4 คำที่ยังทำไม่ได้ (S-0)
"ช่วยออกใบกำกับภาษีให้หน่อย" (อยู่ในระบบแต่ LINE ยังไม่ทำ) → "เรื่องนี้ทำได้ในเว็บค่ะ น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้: <ลิงก์>" (`unsupported_yet`) — ต่างจาก "ราคาทองวันนี้เท่าไหร่" → copy นอกขอบเขตเดิม (`unsupported_module`)

## 4. ขอบเขตงาน (slices)

| Slice | ชื่อ | เนื้อหา | schema |
|---|---|---|---|
| S-0 | ความจริงก่อน | ไม่ default วันที่เงียบ ๆ, correction ตอบตามจริง + `note` append-only, แยก copy ปฏิเสธ, กติกา VAT/WHT ของบรรทัดค่าใช้จ่ายเพิ่ม, การ์ดสรุปแยกกลุ่มค่าใช้จ่ายเพิ่ม | ไม่ |
| S-1 | service charge first-class | `ExpenseLine.chargeKind`, OCR apply, DTO/contract, เว็บ (แสดง+แก้+เพิ่ม), read tools, ตัวคัดลอกบรรทัด (substitute receipt / reimbursement) | เพิ่มคอลัมน์ nullable |
| S-2 | วันที่ พ.ศ. บนใบเสร็จ | normalizer โหมด `receipt`: อ่าน `DD/MM/YY` เป็น วัน/เดือน + ยุคที่สมเหตุสมผล, บันทึกว่าเป็นค่าที่ **สมมติ**, กัน future date | ไม่ |
| S-3 | อธิบายรายการของฉัน | tool `expense.explain_record` (read_detail), resolver "บิลเมื่อกี้" ใช้ร่วมกับ correction lane, router/orchestrator ไม่ตกไป `unsupported_module` เมื่อ intake เป็น business | ไม่ |
| S-4 | แก้ draft ผ่าน LINE | tool category `draft_update` + 5 tools, preview card + ยืนยัน/ยกเลิก postback, audit, idempotency, correction lane ย้ายมาใช้ tools เดียวกัน (เลิก `amountOnlyLine`) | ไม่ (ใช้ตารางเดิม + audit) |

ไม่ทำในรอบนี้ (§10): advisor knowledge/company mode, ออกเอกสารผ่าน LINE, ยืนยัน/ลงบัญชีผ่าน LINE, แก้ record ที่ไม่ใช่ expense (income/receipt drafts) — แต่ contract ของ S-3/S-4 ต้องรับ `recordType` ไว้ล่วงหน้า (ค่าเดียวคือ `expense` ตอนนี้)

## 5. กติกาธุรกิจ

### 5.1 ค่าใช้จ่ายเพิ่ม (S-0/S-1)
- ชนิด = `RECEIPT_ADDITIONAL_CHARGE_KINDS` (`line-ai.ts:203`): SERVICE_CHARGE, DELIVERY, PACKAGING, PLATFORM_FEE, TIP, ROUNDING, OTHER — ใช้ enum เดียวกันทั้ง Prisma (`ExpenseLineChargeKind`), contract และเว็บ; ป้ายไทย: ค่าบริการ, ค่าส่ง, ค่าบรรจุ, ค่าธรรมเนียมแพลตฟอร์ม, ทิป, ปัดเศษ, อื่น ๆ
- บรรทัดค่าใช้จ่ายเพิ่ม = `ExpenseLine` ที่ `chargeKind != null`, `quantity = 1`, `unitPrice = จำนวนเงิน`; `lineNumber` ต่อท้ายสินค้าเสมอ; คำอธิบาย = ป้ายไทย + เปอร์เซ็นต์ถ้าอ่านได้ ("ค่าบริการ 10%")
- **VAT ของบรรทัดค่าใช้จ่ายเพิ่ม**: ตามที่ใบเสร็จบอก (per-charge `vatRate`/treatment ถ้า OCR ให้มา `:135`); ถ้าไม่มีหลักฐาน → `vatRate = null`, `vatTreatment = null`, `reviewStatus = NEEDS_REVIEW` ของบรรทัด (ห้ามเดา 7%) และ record เป็น `NEEDS_REVIEW` ด้วยเหตุผลที่อ่านออก
- **WHT**: ห้ามกระจาย WHT ลงบรรทัดค่าใช้จ่ายเพิ่มอัตโนมัติ; ถ้าเอกสารมี WHT และมีค่าใช้จ่ายเพิ่ม → record `NEEDS_REVIEW` เหตุผล "ตรวจฐานหัก ณ ที่จ่ายกับค่าบริการ"
- ส่วนลดหลังค่าบริการ / ปัดเศษ: `ROUNDING` อนุญาตติดลบได้ชนิดเดียว (ค่าอื่นต้อง > 0)
- เอกลักษณ์ยอด (ทุกทางเขียน: OCR, เว็บ, LINE): `subtotalAmount = Σ lineSubtotal ของสินค้า`, `taxableAmount = subtotalAmount − discountAmount + Σ ค่าใช้จ่ายเพิ่ม`, `vatAmount = Σ line vat`, `grandTotalAmount = taxableAmount + vatAmount`; ผิดเอกลักษณ์ → ปฏิเสธการเขียน (โค้ดเดิมมี tolerance snapshot ต่อบรรทัด — ใช้ค่านั้น)
- หมวดบัญชี: บรรทัดค่าใช้จ่ายเพิ่มสืบทอดหมวดของ record (เหมือนวันนี้) — การแยกบัญชี "ค่าบริการ" เป็น gap ทางบัญชี บันทึกใน §9 ไม่ทำรอบนี้

### 5.2 วันที่ (S-0/S-2)
- ใบเสร็จ (`documentContext: 'receipt'`): `D/M/YY` ที่ทั้งคู่ ≤ 12 → อ่านเป็น **วัน/เดือน** (ธรรมเนียมใบเสร็จไทย) พร้อม assumption `orderAssumedDayMonth`; ยุคเลือกจาก `plausibleEraReadings` (69 → 2569 → 2026; 26 → 2026 ก็ได้ถ้าสมเหตุสมผล; ถ้าอ่านได้ 2 ยุคที่ต่างกันเกิน 1 ปี → ใช้ยุคที่ใกล้วันนี้ที่สุด แต่ติดธง assumption) — ข้อความที่คนพิมพ์ในแชทคงกติกาเดิม 2026-08-28 (ไม่เดา)
- อ่านไม่ได้จริง ๆ → **ห้ามใส่วันนี้เงียบ ๆ**: record ใช้วันที่ส่งเป็น placeholder ได้ (คอลัมน์ NOT NULL) แต่ต้อง (ก) ติดธง `dateUnverified` ใน evidence/`aiFieldSummary`, (ข) record เป็น `NEEDS_REVIEW`, (ค) การ์ดบอก "วันที่: ยังไม่ระบุ — ใช้วันที่ส่งไว้ก่อน พิมพ์ 'วันที่ 3/9/69' เพื่อแก้", (ง) เว็บแสดงเครื่องหมาย "ยังไม่ยืนยัน" ที่ช่องวันที่
- วันที่ที่อ่านได้แต่ > วันนี้ + 1 วัน หรือ < วันนี้ − 2 ปี → `NEEDS_REVIEW` เหตุผล "วันที่ผิดปกติ"

### 5.3 การตอบ/ปฏิเสธ (S-0/S-3)
- รหัสปฏิเสธใหม่ `unsupported_yet` ใน `ADVISOR_REFUSAL_CODES` + intent-router allowlist + terminal-outcome + formatter (`line-ai-formatter.logic.ts:24`): ใช้เมื่อ **intake intent ฝั่ง API ที่เชื่อถือได้** (`LineAiTurnRequest.intakeIntent`, `intent-router.agent.ts:985`) เป็น business intent แต่ไม่มี tool/lane รองรับ; copy: "เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้ค่ะ ทำได้ในเว็บ: <ลิงก์ที่ตรงเรื่อง>"; `unsupported_module` คง copy เดิมสำหรับเรื่องนอกระบบจริง
- ห้ามใช้ copy "นอกขอบเขต" กับคำถามที่ intake จัดเป็น business (test ห้ามถอย: กรณี E4 ต้องได้คำตอบจริงจาก S-3 และในระหว่างที่ S-3 ยังไม่ขึ้นต้องได้ `unsupported_yet`)
- correction lane ตอบตามที่ทำจริง: แต่ละฟิลด์ที่เปลี่ยน = "เปลี่ยน <ฟิลด์> จาก <เก่า> เป็น <ใหม่>"; ถ้าข้อความผู้ใช้มีเรื่องเงิน/ค่าบริการ/VAT ที่ lane เดิมทำไม่ได้ → ต้องพูดตรง ๆ ว่า "ยังไม่ได้แก้ยอด" และส่งต่อไป S-4 (เมื่อมี) หรือให้ลิงก์เว็บ; `note` = **append** ("ผู้ใช้แจ้ง: …" ต่อท้าย, ตัดความยาวที่ 500 ตัวอักษร) ไม่ทับ provenance "LINE receipt upload"

### 5.4 แก้ draft ผ่าน LINE (S-4)
- tools (category ใหม่ `draft_update` ใน `ToolCategory`, `ai-tools.ts:5`): `expense.draft.set_header` (expenseDate, vendorName, documentNumber, noteAppend), `expense.draft.set_line` (lineNumber, description?, amount?, vatTreatment?), `expense.draft.add_charge` (kind, amount | percentOfSubtotal, vatTreatment?), `expense.draft.remove_line` (lineNumber, สินค้าหรือค่าใช้จ่ายเพิ่ม), `expense.draft.set_vat_mode` (vatMode, rate) — ทุกตัว `requiredPermissions` = สิทธิ์เดียวกับเว็บ (`expense.update`/`expenses.update` ตามที่ controller เว็บใช้ — ผู้ทำต้องอ่าน controller จริง), `requiresErpPermissionCheck: true`, `sensitiveAudit: true`
- **สองจังหวะเสมอ**: (1) `preview` — API คำนวณผลลัพธ์ผ่าน reconcile service เดียวกับเว็บแบบ dry-run แล้วคืน diff (ก่อน/หลัง ยอดรวมใหม่ คำเตือน) → การ์ด LINE "ยืนยัน/ยกเลิก" ที่ผูกกับ `previewId` (TTL 10 นาที, ผูก company + user + chat + record `updatedAt`); (2) `apply` — confirm/cancel postback ส่ง `action` และ opaque `previewId` ของการ์ดใบนั้น โดยไม่ส่ง expense/company id → API ตรวจ action+UUID แบบเข้มและ claim preview เดิมก่อน mutation; การ์ดเก่าหรือข้อความยืนยันที่พิมพ์เองใช้กับ preview ล่าสุดไม่ได้ → ตรวจ permission/status/branch และ `updatedAt` เท่าเดิม (ไม่งั้น "รายการเปลี่ยนไปแล้ว ขอดูใหม่") → เขียนใน transaction เดียว → audit `expense.line_ai.draft_update` (before/after/previewId/messageId) → ตอบผลจริง
- guard: สถานะ ∈ DRAFT/NEEDS_REVIEW/READY_FOR_CONFIRMATION; provenance แชท + หน้าต่างเวลาเดียวกับ correction lane; หนึ่ง preview ค้างต่อแชท (ใหม่แทนเก่า); rate limit ต่อผู้ใช้ (ใช้ limiter เดิมของ LINE); ไม่นับโควตาใบเสร็จ (`RECEIPT_QUOTA` นับเฉพาะการจับใหม่)
- ข้อความจากโมเดลกำหนดได้แค่ **ข้อเสนอ** (tool + args) — server ตรวจ args ด้วย schema, ตัวเลขต้องมาจากข้อความผู้ใช้หรือจาก record (grounding เดิมของ correction lane); prompt injection ในรูป/ข้อความห้ามทำให้เกิด apply โดยไม่มี postback ยืนยัน
- correction lane เดิม (5 ฟิลด์) กลายเป็นผู้ใช้ tools เดียวกัน: `amount` → `set_line` เมื่อมีบรรทัดเดียว มิฉะนั้นถาม "บรรทัดไหน" (clarify เดิม); ลบ `amountOnlyLine`

### 5.5 อธิบายรายการ (S-3)
- tool `expense.explain_record` (category `read_detail`, permission อ่านเดียวกับ `expense.get_detail`) input `{ recordRef: { kind: 'recent' | 'id' | 'documentNumber', value? } }` output: header, กลุ่มบรรทัด (สินค้า/ค่าใช้จ่ายเพิ่ม/ส่วนลด), เอกลักษณ์ยอดเป็นตัวเลขจริง, รายการ assumption/ยังไม่ยืนยัน (จาก aiFieldSummary), สิ่งที่แก้ได้ทาง LINE และวิธีพิมพ์
- คำตอบ render แบบ deterministic (template ไทย) — โมเดลห้ามแต่งตัวเลข; ความยาวไม่เกิน 1 การ์ด + 1 ข้อความ
- router: `BUSINESS_READ_QUESTION` ที่พูดถึง บิล/รายการ/ยอด/ทำไม/เมื่อกี้ → agent ที่มี tool นี้; resolver "บิลเมื่อกี้" = ตัวเดียวกับ correction lane (`:333` recency + provenance)

## 6. สัญญา (contracts) — ต้องมี test ทั้งสองฝั่ง

- `packages/contracts`: `ExpenseLineChargeKind` (= 7 ชนิดเดิม), `ExpenseLineDto.chargeKind?: ExpenseLineChargeKind | null`, `ExpenseDetail.charges: { kind, label, amount, vatAmount }[]`, `LineDraftUpdatePreview`, `LineDraftUpdatePostback` (`previewId`, action ยืนยัน/ยกเลิก), refusal code `unsupported_yet`, normalizer option `documentContext`
- API: `updateExpenseDraft` (เว็บใช้อยู่ `expenses.api.ts:124`) รับ `chargeKind` ต่อบรรทัด; endpoint internal tools สำหรับ `draft_update` (preview/apply) ใน `internal-tools.controller.ts` ตามแบบ tool เดิม; `expense.get_detail`/`expense.explain_record` คืน `charges`
- AI Gateway: registry entries ใหม่ + agent ที่ถือ tools; orchestrator: business intake + ไม่มี tool → `unsupported_yet`
- เว็บ: `ExpenseReviewPage` แสดง/แก้/เพิ่มบรรทัดค่าใช้จ่ายเพิ่ม; `expense-review-validation.ts` รู้จักเอกลักษณ์ยอดใหม่
- LINE: การ์ดสรุป (`receiptItemLines`/summary builder) แยกกลุ่ม "ค่าใช้จ่ายเพิ่ม"; การ์ด preview + postback

## 7. สถานะ/สิทธิ์/audit

- สิทธิ์: อ่าน = สิทธิ์เดิมของ `expense.get_detail`; แก้ = สิทธิ์เดียวกับ `updateExpenseDraft` ของเว็บ; ไม่มีสิทธิ์ใหม่
- audit: `expense.line_ai.draft_update` (confirmed apply), `expense.line_ai.draft_preview` (preview, LOW). **Superseded 2026-09-26:** `expense.line_correction.apply` is retired because direct correction writes are disabled; see [LINE expense edit capability consistency](line-ai-expense-edit-capability-consistency-spec-th.md).
- state ของ preview: Redis key `line-ai:draft-preview:<companyId>:<chatKey>` (TTL 600s) — ไม่มีตารางใหม่

## 8. Config & rollout

- `LINE_AI_DRAFT_EDIT_ENABLED` (default **off**; UAT on ผ่าน `deploy.sh` jq block; prod ตัดสินหลัง UAT) — คุม S-4 ทั้งหมด (preview/apply + การเสนอแก้ในคำตอบ); ปิดอยู่ = correction lane เดิมแต่ตอบตามจริง (S-0)
- S-0/S-1/S-2/S-3 ไม่มี flag (เป็นความถูกต้อง + read-only)
- migration S-1: เพิ่มคอลัมน์ nullable เท่านั้น; ไม่มี backfill (บรรทัด OCR เก่าที่เป็น "service charge" ปล่อยเป็นสินค้าไว้ — S-4 มีทาง "ย้ายเป็นช่องค่าบริการ")

## 9. ทะเบียน impact / gap ที่ต้องกวาดทุก slice (ผู้ทำต้องรายงานทีละข้อ: แก้ / ไม่กระทบเพราะ… / gap ค้าง)

| พื้นที่ | ต้องดู |
|---|---|
| OCR apply (`receipt-ocr-apply.service.ts`) | charge → chargeKind, VAT/WHT rule §5.1, เอกลักษณ์ยอด, MAX charges |
| correction lane (`line-correction.use-case.ts`) | note append, ความจริงในคำตอบ, ย้ายไป tools S-4 |
| substitute receipt continuation (`line-substitute-receipt-continuation.use-case.ts`) | คัดลอกบรรทัดต้องพก chargeKind; ใบสำคัญรับเงินแทนแสดงค่าบริการอย่างไร |
| reimbursement → expense (source lines) | บรรทัดที่สร้างจาก reimbursement มี chargeKind หรือไม่ (น่าจะ null — ยืนยัน) |
| VAT capture / input VAT claim | ฐานภาษีรวมค่าบริการ; บรรทัด NEEDS_REVIEW ต้องกัน claim |
| WHT (`whtInputJson`, ledger `journal.use-case.ts:88`) | ห้ามกระจายอัตโนมัติ; ledger ยังปฏิเสธ WHT อยู่แล้ว — ไม่เปลี่ยน |
| ledger/journal, reports, CSV export | บรรทัดค่าใช้จ่ายเพิ่มยัง post ตามหมวด record; report by category ไม่เปลี่ยน; export มีคอลัมน์ chargeKind หรือไม่ (เพิ่มถ้าถูก) |
| web list/detail/validation/QA specs | ยอดสรุป, ตัวกรอง, `expense-review-validation` |
| LINE summary card / status row (`:849`) | กลุ่มค่าใช้จ่ายเพิ่ม, วันที่ assumed/unverified |
| read tools `expense.get_detail`/`list` + security eval (`line-ai-security-eval.ts`) | `charges`, กรณี injection สั่งแก้ → ต้องไม่มี apply โดยไม่มี postback |
| AI usage/cost (`AiUsageEvent`) | S-3/S-4 เพิ่ม tool call — บันทึกชนิดใหม่; cost baseline ดู memory 2026-09-04 |
| โควตา (`RECEIPT_QUOTA_ENFORCED`) | การแก้ไม่นับเป็นใบเสร็จใหม่ |
| PDPA | ไม่มีข้อมูลส่วนบุคคลใหม่; audit payload ไม่เก็บรูป |
| docs | `line-ai-capture-correction-spec.md` (5 ฟิลด์ → tools), ADR 0011 (เพิ่มโหมด receipt), advisor spec (refusal code), runbook LINE flags |

## 10. ไม่ทำในรอบนี้ (บันทึกเป็น gap)

- บัญชีแยก "ค่าบริการ" (chart of accounts) และรายงานตามชนิดค่าใช้จ่ายเพิ่ม
- แก้ record ชนิดอื่น (income/receipt/substitute) ผ่าน LINE — contract รองรับ `recordType` ไว้
- ยืนยัน/ยกเลิก/ลงบัญชีผ่าน LINE (final mutation)
- advisor knowledge/company mode (spec แยก)

## 11. Gates (ต้องมีหลักฐานจริงก่อนปิดแต่ละ slice)

- unit + real-Postgres spec สำหรับ: apply (charge/VAT/WHT/identity), normalizer receipt mode (ตาราง 03/09/69, 3/9/69, 12/09/69, 13/09/69, 9/3/2569, 2026-09-03, ว่าง), correction honesty + note append, `unsupported_yet` routing, explain tool, preview/apply (สถานะ, provenance, updatedAt race, TTL, postback ปลอม, cross-company)
- security eval ใหม่ ≥ 6 กรณี (injection ในรูป/ข้อความสั่งแก้, postback ที่ไม่ตรง previewId, previewId ของแชทอื่น, CONFIRMED record, ผู้ใช้ไม่มีสิทธิ์, ยอดผิดเอกลักษณ์)
- mutation ต่อ slice (อย่างน้อย 3 ตัว) ต้องทำให้ test แดง
- web: QA spec ของ `ExpenseReviewPage` + `next build`
- local drive ผ่าน LINE fake harness (memory `local-line-fake-harness`) สำหรับ J2–J4 ด้วยข้อความจริงของ Owner; OCR ใช้ fixture ของบิล BHC (ผลลัพธ์ OCR ที่ UAT ให้มาแล้ว) ไม่ต้องเรียก Bedrock
- UAT script ให้ Owner ทดสอบด้วยมือ: J1–J4 พร้อมข้อความที่พิมพ์และผลที่ควรเห็น

## 12. คำถาม Owner — สถานะ

| # | คำถาม | สถานะ |
|---|---|---|
| Q1 | ค่าบริการที่ไม่มี VAT ระบุ → NEEDS_REVIEW (ไม่เดา 7%) | ตัดสินโดย spec §5.1 — Owner ทักได้ |
| Q2 | LINE แก้ได้ถึงสถานะ READY_FOR_CONFIRMATION | ตัดสินโดย spec §2 — Owner ทักได้ |
| Q3 | flag S-4 default off ใน prod จนกว่า UAT ผ่าน | ตามแบบ flags เดิม |
