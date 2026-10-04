# WHT Certificate Correction & Replacement Spec — แก้ไข/ออกใบแทน หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) ที่ระบบออกให้

Status: DRAFT (docs-first, ยังไม่ implement)
Owner: Finance/Accounting lane
Related (cross-reference เท่านั้น, ไม่แก้ไขไฟล์เหล่านี้):
`docs/specs/wht-certificate-system-issuance-spec.md` (sibling spec — SYSTEM_INITIAL_ISSUE ที่ build แล้ว, PR #720/#721),
`docs/plans/wht-certificate-system-issuance-plan.md` (โครงสร้าง/citation style ที่ spec นี้เดินตาม),
`docs/specs/feature-entitlement-decoupling-spec.md` (§CC5 — เจ้าของ design เต็มรูปแบบของ `WhtCertificateCommand`/`WhtCommandRegistry`/`artifactOrigin`/correction-replacement semantics),
`docs/specs/tax-thailand-2026-spec.md` (คำตัดสิน owner 2026-06-23 ที่ตั้งสามเส้นทาง SYSTEM_INITIAL_ISSUE/SYSTEM_CONTENT_CORRECTION/SYSTEM_REPLACEMENT_COPY, รายละเอียด WhtCertificateCommand/WhtCorrectionCase/WhtCertificateCopyArtifact schema เต็มรูปแบบ),
`docs/agent-memory/wht-certificate-system-issuance.md` ("Gate-unlock + button rename" section — สิ่งที่ทำให้งานนี้เริ่มได้)
Baseline discovery: 2026-09-22 บน `codex/wht-gate-unlock-20260922` (`d7b78436`)

## 1. ปัญหา

Owner ถามตรง ๆ ว่า "ถ้าแก้ข้อมูลแล้วออกใหม่ (regenerate) เอกสาร 50 ทวิ จะได้ค่าใหม่ไหม" คำตอบที่ตรวจสอบแล้วคือ **ไม่ได้ — และวันนี้ regenerate เอกสารที่ออกไปแล้วไม่ได้เลย แม้แต่จะยกเลิก (void) รายการจ่ายที่อยู่เบื้องหลังก็ไม่ได้เช่นกัน**:

- `WhtCertificate` (schema.prisma:5121-5151) ไม่มีฟิลด์ใด ๆ สำหรับผูกกับใบที่มาแทน/ใบที่ถูกแทนที่เลย (ไม่มี `supersededByCertificateId`, ไม่มี `artifactOrigin`) — มีแค่ `voidedAt`/`voidedByUserId`/`voidReason` (ยังไม่มีจุดไหนเขียนค่านี้เลยวันนี้ — ยืนยันจาก grep) และ `status: WhtCertificateStatus` (`DRAFT | ISSUED | VOIDED`, [schema.prisma:4372-4376](../../apps/api/prisma/schema.prisma))
- ไม่มี use case ไหนเลยที่แก้ไข/ยกเลิก/ออกใบแทนของ `WhtCertificate` ที่มี `status: ISSUED` — ยืนยันจาก grep ทั่ว `apps/api/src/modules/tax/` และ `apps/api/src/modules/procurement/`, `apps/api/src/modules/expenses/`
- Void-guard ของ `SupplierPayment` บล็อกการยกเลิกรายการจ่ายทันทีที่ certificate ผูกอยู่: `if (issuedHandoffs > 0) throw new ConflictException('wht_certificate_linked_requires_review')` ([prisma-procurement.repository.ts:1604](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts)) ครอบคลุมทั้ง `EXTERNAL_LINKED` และ `SYSTEM_ISSUED` ([:1600-1602](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts)) — comment ในโค้ดเองอธิบายเหตุผลไว้ชัดว่า "a legal document exists in the payee's hands... that needs a human, not a status flip" (:1596-1599) แต่ **ไม่มี flow "human" นั้นอยู่จริงเลยวันนี้** — บล็อกไว้เฉย ๆ ไม่มีทางไปต่อ
- ผลคือ: ตั้งแต่ momento ที่กด "พิมพ์เอกสาร 50 ทวิ" สำเร็จครั้งแรก ผู้ใช้ **ติดอยู่ตรงนั้นถาวร** — แก้ไขข้อมูลก็ไม่ได้ (ไม่มี edit), ยกเลิกรายการจ่ายเพื่อบันทึกใหม่ก็ไม่ได้ (void-guard บล็อก), และถ้าไฟล์ PDF ที่ดาวน์โหลดไปหาย ก็ไม่มีทางขอสำเนาใหม่ได้เลยเพราะ `pdfAttachmentId` ไม่เคยถูกเขียนจริง (sibling memory, Phase 2 finding, [wht-certificate-system-issuance.md:461-473](../../docs/agent-memory/wht-certificate-system-issuance.md)) — PDF มีอยู่แค่ใน response ตอน mint ครั้งเดียวเท่านั้น

Owner สั่งให้สร้างสองความสามารถที่ขาดอยู่นี้ **ตอนนี้เลย** ในหน่วยงานเดียวกับที่กำลังจะรวม PR ไป UAT (ไม่ใช่ deferred item อีกต่อไป):

1. **แก้ไข (correction)** — เอกสารที่ออกไปมีเนื้อหาผิด (ยอด/อัตรา/หมวด/รายละเอียดผู้รับเงิน) ต้องออกเอกสารที่แก้ไขแล้วได้
2. **ออกใบแทน (replacement/reissue)** — เอกสารเดิมถูกต้องอยู่แล้ว แต่ไฟล์หาย ต้องขอสำเนาเดิมซ้ำได้

โชคดีที่งานออกแบบสำหรับสองเส้นทางนี้ **มีอยู่แล้วเต็มรูปแบบ** ใน `feature-entitlement-decoupling-spec.md` §CC5 และ `tax-thailand-2026-spec.md` (สองไฟล์ที่ sibling spec อ้างถึงแล้วแต่ประกาศเป็น non-goal ไว้ก่อน — [wht-certificate-system-issuance-spec.md:43](../../docs/specs/wht-certificate-system-issuance-spec.md)) spec นี้จึงเป็นการ **ต่อยอด design ที่มีอยู่แล้ว** ไม่ใช่คิดใหม่ — งานหลักคือ **ย่อ scope ของ design เต็มรูปแบบ (CC5) ลงมาเป็น v1 ที่ shippable ได้จริง** โดยไม่ทิ้ง invariant ที่สำคัญที่สุดของมัน (ดู §5.1)

## 2. เป้าหมาย (v1)

1. เปิดปุ่ม **"แก้ไขหนังสือรับรอง"** ที่จุดเดียวกับที่แสดงเอกสารที่ระบบออกให้แล้ว (ทั้ง AP และ Expenses) — กดแล้วกรอกค่าที่ถูกต้องใหม่ พร้อมเหตุผล ระบบออกเอกสารใบใหม่เลขที่ใหม่ที่มีค่าที่แก้แล้ว และทำเครื่องหมายใบเดิมเป็นถูกแทนที่
2. เปิดปุ่ม **"ออกใบแทน"** ที่จุดเดียวกัน — กดครั้งเดียวได้สำเนา PDF ของเอกสารเดิมทุกตัวอักษร (เลขที่เดิม เนื้อหาเดิม) พร้อมป้ายกำกับ "ใบแทน" ที่มองเห็นได้ชัดเจนบนเอกสาร
3. ทั้งสองปุ่มใช้ได้เฉพาะกับ `WhtCertificateHandoff.status === 'SYSTEM_ISSUED'` เท่านั้น (ใบที่ระบบออกให้เอง) — **ไม่แตะ** เอกสารที่มาจาก `EXTERNAL_LINKED` เลย (ผู้ใช้ที่แนบเอกสารที่ออกภายนอกไว้ ยังต้องไปแก้ไข/ขอใบแทนกับผู้ที่ออกเอกสารภายนอกเหมือนเดิมทุกประการ — ไม่ใช่ regression เพราะ v1 นี้ตั้งใจจำกัดขอบเขตไว้)
4. คงกฎ "ต้องมีมนุษย์ ไม่ใช่แค่เปลี่ยนสถานะ" (void-guard comment) ไว้ทุกจุด — ฟีเจอร์นี้**ไม่ทำให้การแก้ไขบัญชี/ภาษีเบื้องหลังกลายเป็นอัตโนมัติ**เพียงเพราะมีปุ่มแก้ไขเอกสารแล้ว (ดู §5.1 คำตอบที่ resolve แล้ว)

## 3. Scope และ Non-goals

**ในสโคป (v1):**

- `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` และ `cap.wht50bis/SYSTEM_REPLACEMENT_COPY` — ทั้งสอง route นี้ถูกย้ายจาก `SPECIALIST_LEGAL/CLOSED` ไป `ORDINARY/OPEN` แล้วในคอมมิตก่อนหน้าของ branch นี้เอง (`fc9bf7ff`, ดู [wht-certificate-system-issuance.md:751-800](../../docs/agent-memory/wht-certificate-system-issuance.md)) — **ยังไม่มีโค้ดอะไรอยู่หลัง route ทั้งสองนี้เลย** งานของ spec นี้คือสร้างโค้ดนั้น
- สองจุดเข้าเดียวกับ SYSTEM_INITIAL_ISSUE: AP payment WHT tab (`WhtHandoffDetail`), Expenses confirm flow
- Data model ต่อยอด `WhtCertificate`/`WhtCertificateHandoff` ที่มีอยู่แล้ว แบบ additive เท่านั้น (ดู §5)
- PDF template สำหรับใบแทน (ป้าย "ใบแทน") และใบที่ถูกแทนที่ (ดู §6)
- Permission ใหม่หนึ่งตัว `wht.certificate.correct` (ดู §7)

**Non-goals (บันทึกไว้ ไม่ทำรอบนี้ — อ้างอิงจาก CC5/tax-thailand-2026-spec เพื่อไม่ให้สับสนว่าลืมทำ):**

- **`WhtCommandRegistry`/`WhtCertificateCommand`/`WhtCorrectionCase`/`WhtCertificateCopyArtifact`/`WhtReplacementCopyHandoff` แบบเต็มรูปแบบตาม CC5** ([feature-entitlement-decoupling-spec.md:232-258](../../docs/specs/feature-entitlement-decoupling-spec.md), [tax-thailand-2026-spec.md:1260-1395](../../docs/specs/tax-thailand-2026-spec.md)) — นี่คือ event-sourced command history + ledger/refund/RD-filing correction state machine เต็มระบบ ใหญ่กว่าสิ่งที่ owner ขอตอนนี้มาก (owner ขอแค่ "แก้ข้อมูลแล้วออกใหม่ได้" กับ "ขอสำเนาใหม่ได้เมื่อไฟล์หาย") v1 นี้**ย่อ**เหลือแค่คอลัมน์ additive บน `WhtCertificate`/`WhtCertificateHandoff` ที่มีอยู่แล้ว (ดู §5.1) พอสำหรับสอง action นี้เท่านั้น — เดินตาม precedent เดียวกับที่ sibling spec เคยทำกับ "Number-namespace merge ระหว่าง SYSTEM กับ EXTERNAL" (sibling spec §3, finding 2: design มีอยู่แล้วใน CC5 แต่โค้ดจริงยังไม่ทำ ไม่ต้องทำให้ครบตอนนี้ แค่ต้องไม่อ้างว่าทำแล้ว) — full CC5 apparatus ยังเป็นเป้าหมายระยะยาวที่ถูกต้อง ไม่ใช่ทิ้ง
- **แก้ไข/ยกเลิก return correction (ป.ป.01/ป.ป.02/ภ.ง.ด. เพิ่มเติม) และ refund claim workflow** ([feature-entitlement-decoupling-spec.md:242-258](../../docs/specs/feature-entitlement-decoupling-spec.md)) — decoupling spec เองแยกเรื่องนี้ไว้ชัดเจนว่าเป็นคนละ workflow กับ certificate-content correction ("Certificate-content correction and return correction are separate immutable workflows", [tax-thailand-2026-spec.md:110](../../docs/specs/tax-thailand-2026-spec.md)) — v1 นี้ทำแค่ certificate-content correction เท่านั้น ไม่แตะการยื่นแก้ ภ.ง.ด. กับ RD เลย
- **แก้ไขข้อมูล `SupplierPayment`/`ExpenseRecord`/`TaxEvent`/`TaxPeriod`/journal entries ให้ตรงกับใบที่แก้แล้ว** — ดู §5.1 คำตอบที่ resolve ชัดเจนว่าทำไม
- **EXTERNAL correction/replacement flow ใหม่** (เช่น "แนบเอกสารแก้ไข/ใบแทนที่ออกภายนอกแล้ว") — CC5 มี design ไว้ (`WhtReplacementCopyHandoff` status `EXTERNAL_LINKED`) แต่โค้ดปัจจุบันไม่มีอะไรรองรับเลย และ v1 นี้ไม่สร้างใหม่ — ถ้า route ปิดในอนาคต (ปัจจุบันเปิดอยู่แล้ว) ผู้ใช้กลับไปทำนอกระบบทั้งหมดเหมือนที่เป็นอยู่วันนี้ ไม่มี in-app fallback ใด ๆ ใน v1 — เดินตามกติกาเดียวกับที่ task instruction สั่งไว้ชัดว่าอย่าแตะ external-attach flow เดิม
- **Multiple correction chains / correction-of-a-correction ที่ผูก state machine ซับซ้อน** — v1 รองรับได้แค่ supersede เดียว (ใบเก่า → ใบใหม่); ใบใหม่จะแก้ต่ออีกก็ทำได้ (มันก็แค่ใบ SYSTEM_ISSUED ปัจจุบันอีกใบหนึ่ง) แต่ไม่มีการนับ revision/ประวัติแบบ append-only log อย่างที่ CC5's `WhtCorrectionCase`/`WhtCorrectionRevision` ออกแบบไว้
- **จำนวนครั้งที่ออกใบแทนแบบ ledger เต็มรูปแบบ (`WhtCertificateCopyArtifact` พร้อม `copySeq` ต่อใบ)** — v1 ใช้ตัวนับธรรมดา + audit log แทน (ดู §5.2)

## 4. ผู้ใช้และ journey

### 4.1 Accounts Payable — `WhtHandoffDetail`, บล็อก `issued`

UI ปัจจุบัน (ยืนยันจาก source, หลัง sibling Phase 4 landed): เมื่อ `handoff.status === 'SYSTEM_ISSUED'` แสดง banner เขียวพร้อมเลขที่และปุ่ม "ดาวน์โหลด PDF อีกครั้ง" ([AccountsPayablePages.tsx:1110-1118](../../apps/web/src/features/accounts-payable/AccountsPayablePages.tsx)) — banner นี้ทำงานเฉพาะ session เดียวกับที่เพิ่ง mint (`issuedPdf` เก็บใน React state, ไม่ persist ข้าม reload — sibling memory Phase 4 finding, [wht-certificate-system-issuance.md:567-575](../../docs/agent-memory/wht-certificate-system-issuance.md))

การเปลี่ยนแปลง v1: ในบล็อกเดียวกันนี้ (`issued ? (...)`) เมื่อมี `handoff.certificateId` (ไม่ต้องพึ่ง `issuedPdf` session-only เพราะแก้ไข/ออกใบแทนต้องทำได้แม้ reload หน้าไปแล้ว) และ permission+gate สองแกนผ่าน:

- ปุ่ม **"แก้ไขหนังสือรับรอง"** — เปิดฟอร์มเล็ก ๆ prefill ด้วยค่าปัจจุบันของ certificate ที่ active อยู่ (income category/rate/gross/withheld/payment date/form type + payee identity fields) ให้แก้ไขค่าที่ผิด พร้อมช่องเหตุผล (บังคับกรอก) กดยืนยันแล้วดาวน์โหลด PDF ใบใหม่ทันที banner อัปเดตเป็นเลขที่ใหม่
- ปุ่ม **"ออกใบแทน"** — กดครั้งเดียว ไม่มีฟอร์ม ดาวน์โหลด PDF สำเนาเดิมทันที (เลขที่เดิม เนื้อหาเดิม มีป้าย "ใบแทน")
- Handoff ที่มี `certificateId` ชี้ไปยัง certificate ที่ถูก supersede แล้ว (เช่น เพจ cache เก่า) ต้อง resolve ไปยัง certificate ปัจจุบันเสมอ — ดู §5.1 การอัปเดต `handoff.certificateId` แบบ conditional ตอน correction สำเร็จ ทำให้ปัญหานี้ไม่เกิดจริงถ้า flow ถูกต้อง

### 4.2 Expenses — จุดแสดงผลหลัง confirm

**ข้อสังเกตที่ต้องสำรวจตอน implement:** ฝั่ง Expenses วันนี้ "ดาวน์โหลด PDF อีกครั้ง" เป็น session-only prompt ผูกกับ React state ของหน้า confirm เดียวกัน (`whtIssuedPdf`, [ExpenseReviewPage.tsx:1026](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx)) — ไม่มี persistent panel แบบ AP's `WhtHandoffDetail` ที่ผูกกับ handoff โดยตรง ต่างจาก AP ตรงที่การแก้ไข/ขอใบแทนต้องใช้ได้ **นานหลังจาก session ที่ confirm จบไปแล้ว** (เช่น พบข้อผิดพลาดวันถัดไป) — v1 ต้องหาจุดแสดงผล READ-ONLY ของ expense ที่ยืนยันแล้วซึ่งคงอยู่ข้าม session (ไม่ใช่ `whtIssuedPdf` state) มาแสดงปุ่มทั้งสองแทน มิฉะนั้นผู้ใช้ Expenses จะใช้ฟีเจอร์นี้ได้แค่ในช่วงเวลาสั้น ๆ ทันทีหลัง confirm เท่านั้น ซึ่งไม่ตรงกับ use case จริง (พบ error ทีหลัง) — implementer ต้องสำรวจหน้าตรวจสอบ/ประวัติ expense ที่มีอยู่แล้วก่อนตัดสินใจว่าจะต่อยอดหน้าไหน (mirror แนวทางที่ sibling plan Phase 3.3 ใช้กับหน้า tax-signature settings ที่ไม่มีอยู่ก่อน)

## 5. Data model

### 5.1 คำถามสำคัญที่ต้อง resolve ก่อนอื่น: การแก้ไขเอกสารต้องแก้บัญชี/ภาษีเบื้องหลังด้วยหรือไม่

**คำตอบ: ไม่ต้อง — v1 นี้ scope แคบแค่ตัวเอกสาร (certificate-document-scoped) เท่านั้น ไม่แตะ `SupplierPayment`/`ExpenseRecord`/`TaxEvent`/`TaxPeriod`/journal entries เลย**

เหตุผล (grounded จากทั้ง design เต็มรูปแบบและโค้ดจริงที่มีอยู่):

1. **CC5 เองก็แยกสองเรื่องนี้ออกจากกันอย่างชัดเจน**: "Certificate-content correction and return correction are separate immutable workflows" ([tax-thailand-2026-spec.md:110](../../docs/specs/tax-thailand-2026-spec.md)) — CC5's full design ให้ certificate-correction "reference" การแก้ไขที่ฝั่ง source ทำไปแล้ว ("must reference an audited source payment/WHT correction or reversal", [feature-entitlement-decoupling-spec.md:241](../../docs/specs/feature-entitlement-decoupling-spec.md)) — แต่ไม่ได้บอกว่า certificate-correction ต้อง**เป็นคนทำการแก้ไขฝั่ง source เอง**
2. **กลไก "แก้ไขฝั่ง source" ที่ CC5 อ้างถึงยังไม่มีอยู่จริงในโค้ด และถูกบล็อกไว้เองด้วยซ้ำ**: `SupplierPayment`/`ExpenseRecord` เป็น append-only ตาม pattern ทั่วทั้ง repo (ไม่มี in-place edit ของ `whtCategoryCode`/`whtRate`/`whtAmount` หลัง RECORDED/CONFIRMED) หนทางเดียวที่จะ "แก้" คือ void แล้วบันทึกใหม่ — แต่ void ถูกบล็อกทันทีที่มี certificate ผูกอยู่ (`wht_certificate_linked_requires_review`, [prisma-procurement.repository.ts:1604](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts)) **ก่อนที่ certificate-correction feature นี้จะมีอยู่ด้วยซ้ำ** — ทำให้ "ต้องแก้ source ก่อนถึงจะแก้ certificate ได้" กลายเป็น chicken-and-egg ที่ไม่มีทางออกเลยถ้า v1 บังคับกฎนี้จริง (ดู open question ท้าย §12)
3. **บทเรียนจาก void-guard/`sync-tax-events` ที่มีอยู่แล้วสำหรับ "การแก้ไขชนิดอื่น"**: เมื่อ `TaxPeriod` ที่เกี่ยวข้อง lock แล้ว (`FILED`/`PAID`/`CLOSED`) ระบบ**ไม่เคยแก้ไขข้อมูลภาษีเงียบ ๆ ให้เอง** — มันปฏิเสธด้วย error code ตรง ๆ (`wht_tax_period_locked_requires_amendment`, [prisma-procurement.repository.ts:1594](../../apps/api/src/modules/procurement/infrastructure/prisma-procurement.repository.ts); `SOURCE_CHANGED_AFTER_TAX_PERIOD_LOCK` blocking review issue, [sync-tax-events.use-case.ts:109-112](../../apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts)) แล้วส่งเรื่องให้มนุษย์ทำผ่าน `TaxAdjustment(adjustmentType: CORRECTION)` ([schema.prisma:5259-5274](../../apps/api/prisma/schema.prisma)) แยกต่างหาก — spec นี้เดินตามเส้นเดียวกันเป๊ะ ๆ (ดู guard ข้อ 3 ด้านล่าง) แทนที่จะคิด mechanism ใหม่

**สรุปพฤติกรรม v1:**

- ฟอร์มแก้ไขให้ผู้ใช้พิมพ์ค่าที่ถูกต้องของ**ตัวเอกสาร**เข้าไปตรง ๆ (ไม่ derive จาก `SupplierPayment`/`ExpenseRecord` ใหม่) — เอกสารใหม่กับค่าที่บันทึกไว้ใน `SupplierPayment`/`ExpenseRecord` เดิม **อาจไม่ตรงกันได้** หลังแก้ไข นี่คือ known, documented limitation ไม่ใช่บั๊ก (เหมือนที่ CC5 เองก็แยก certificate correction ออกจาก return correction)
- รายงาน WHT ที่ derive จาก `SupplierPayment`/`ExpenseRecord` โดยตรง (เช่น `wht-report.logic.ts`) **จะไม่สะท้อนการแก้ไขที่ทำผ่านฟีเจอร์นี้** — ต้องแจ้งในหน้า UI ให้ผู้ใช้เข้าใจ (ข้อความแนะนำ: "การแก้ไขนี้มีผลกับตัวเอกสารที่มอบให้ผู้รับเงินเท่านั้น หากต้องแก้ไขยอดภาษีที่ยื่นด้วย ให้ติดต่อนักบัญชีเพื่อทำรายการแก้ไขทางบัญชีแยกต่างหาก")
- **Guard ที่ยังคงไว้ (ไม่ลดมาตรฐาน)**: ถ้า `TaxPeriod` ของ certificate เดิม (`WhtCertificate.taxPeriodId`) อยู่ในสถานะ `FILED`/`PAID`/`CLOSED` **และ** ค่าที่แก้ไขเป็นค่าทางการเงิน (gross/withheld/rate/incomeCategory/paymentDate/payee identity — ต่างจากแค่ typo ที่อยู่/รูปแบบ) → บล็อกด้วย error code ใหม่ `wht_certificate_correction_tax_period_locked` (mirror `wht_tax_period_locked_requires_amendment` แบบตรงไปตรงมา) พร้อมข้อความชี้ไปที่ขั้นตอนแก้ไขบัญชี/ยื่นแก้ที่มีอยู่แล้ว — ไม่ auto-bypass การ lock นี้เด็ดขาด
- Nonfinancial-only correction (เช่น แก้ตัวสะกดชื่อ/ที่อยู่ผู้รับเงิน) ไม่ติด guard นี้แม้ period จะ lock แล้ว เพราะไม่กระทบตัวเลขที่ยื่นไปแล้ว

### 5.2 Schema additions (additive บน `WhtCertificate`/`WhtCertificateHandoff` ที่มีอยู่แล้ว — ไม่สร้างตารางใหม่)

ต่อยอด `WhtCertificate` ([schema.prisma:5121-5151](../../apps/api/prisma/schema.prisma)) — เพิ่มคอลัมน์ nullable ทั้งหมด, ค่า default = พฤติกรรมเดิมทุกประการสำหรับ certificate ที่มีอยู่แล้ว:

```prisma
// Correction — self-relation แบบ bidirectional pointer, ย่อจาก CC5's WhtCorrectionCase/
// WhtCorrectionRevision append-only history (§3 non-goal) ให้เหลือแค่พอที่ single-supersede ต้องการ
supersededByCertificateId String?  @unique
supersedesCertificateId   String?  @unique
correctionReason          String?

// Replacement copy — ย่อจาก CC5's WhtCertificateCopyArtifact ledger (§3 non-goal) ให้เหลือตัวนับ
// เดียวพอสำหรับ "ระบบเคยออกใบแทนกี่ครั้ง ล่าสุดเมื่อไร ใครขอ" — ประวัติละเอียดกว่านี้ (ต่อครั้ง) อยู่ใน audit log
replacementCopyCount      Int      @default(0)
lastReplacementCopyAt     DateTime?
lastReplacementCopyByUserId String?
```

`voidReason`/`voidedAt`/`voidedByUserId` ที่มีอยู่แล้ว (ไม่มีจุดไหนเขียนค่าวันนี้ — seam เดียวกับที่ sibling spec เจอกับ `WhtCertificateHandoff.status`) ถูกใช้จริงเป็นครั้งแรกโดย correction: ใบเก่าถูก `status: 'VOIDED'`, `voidReason: 'SUPERSEDED_BY_CORRECTION'` (ค่าคงที่ ไม่ใช่ free text จากผู้ใช้), `voidedAt`/`voidedByUserId` ตามเวลา/ผู้แก้ไขจริง — ตรงกับ decoupling spec's "atomically marks the old record VOIDED with voidReasonCode=SUPERSEDED" ([feature-entitlement-decoupling-spec.md:241](../../docs/specs/feature-entitlement-decoupling-spec.md)) แค่เก็บ reason เป็น string คงที่แทน enum ใหม่ (ponytail — ไม่เพิ่ม enum สำหรับค่าเดียวที่ใช้จริง)

`supersededByCertificateId`/`supersedesCertificateId` เป็น `@unique` เพราะ v1 รองรับแค่ single-supersede ต่อใบ (§3 non-goal ข้อ chain) — self-relation สองทิศทาง ทำให้ query "certificate ที่ active อยู่ตอนนี้" ง่าย ๆ คือ `WHERE supersededByCertificateId IS NULL AND status != 'VOIDED'` โดยไม่ต้องมี registry แยก

ต่อยอด `WhtCertificateHandoff` ([schema.prisma:5164-5231](../../apps/api/prisma/schema.prisma)) — **ไม่เพิ่มคอลัมน์ใหม่เลย** `certificateId` ที่มีอยู่แล้วต้องถูก**อัปเดต**ให้ชี้ไปยัง certificate ปัจจุบันเสมอเมื่อ correction สำเร็จ (conditional `updateMany`, mirror sibling's `IssueWhtCertificateFromHandoffUseCase` step 8 pattern เป๊ะ ๆ — [issue-wht-certificate-from-handoff.use-case.ts:163-166](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts)) — ผู้อ่าน handoff (AP/Expenses UI) จึงเห็น certificate ล่าสุดเสมอโดยไม่ต้องเดินตาม supersession chain เอง

Migration ใหม่หนึ่งไฟล์ additive (ชื่อแนว `2026xxxx_wht_certificate_correction_replacement`) — `prisma validate` ต้องผ่านก่อนถือว่า schema งานนี้เสร็จ

## 6. PDF template requirements

ต่อยอด `buildWhtCertificateSvg`/`WhtCertificateFields` ([wht-certificate-pdf.logic.ts:16-51](../../apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts)) — ไม่แตะ signature/seal wiring ที่มีอยู่แล้ว (Decision A ของ sibling ยังใช้ต่อเหมือนเดิม)

### 6.1 ใบแทน (replacement) — ธงคือ "เนื้อหาเหมือนเดิมทุกตัวอักษร แค่มีป้ายบอกว่าเป็นสำเนา"

Convention ที่ต้อง reuse — **ไม่ใช่** diagonal watermark สีแดงแบบ `SubstituteReceiptPrintStamp` (`'VOID' | 'SUPERSEDED' | 'UNSIGNED' | 'AWAITING APPROVAL' | 'AWAITING REVIEW'`, [substitute-receipt-pdf.logic.ts:65](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts)) — นั่นคือกลไกบอก **สถานะวงจรชีวิตเอกสาร** (ใช้กับใบเก่าที่ถูกแทนที่แล้ว ดู §6.2) คนละเรื่องกับ "นี่คือสำเนา" convention ที่ถูกต้องคือแบบเดียวกับที่ `substitute-receipt.logic.ts` ใช้จริงกับใบแทนใบเสร็จ: **พิมพ์ป้ายกำกับเป็นข้อความบนตัวเอกสารโดยตรง** ไม่ใช่ overlay — `SUBSTITUTE_RECEIPT_TITLE` เป็น title ใหญ่แทนที่ title ปกติ ([substitute-receipt.logic.ts:5](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts)) พร้อมบรรทัดย่อย "เลขใบแทน: {documentNumber}" ([:283](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts))

50 ทวิ เป็นแบบฟอร์มราชการที่มี title ตายตัว **แก้ title ไม่ได้เหมือนใบเสร็จ** — ปรับ convention ให้เหมาะกับ constraint นี้: เพิ่มบรรทัด **"(ใบแทน — ออกซ้ำเมื่อ {issuedAt})"** ต่อท้าย/ข้างเลขที่เอกสาร (จุดเดียวกับที่พิมพ์ "เล่มที่/เลขที่" อยู่แล้ว) ตรงตามที่ tax-thailand-2026-spec.md ต้องการ ("visibly marks ใบแทน", "the Thai label ใบแทน is visible in the approved header position and cannot overlap statutory fields", [:1300,1302](../../docs/specs/tax-thailand-2026-spec.md)) — เป็น text ธรรมดาใน SVG (ไม่ใช่ opacity overlay) ตำแหน่งใกล้เลขที่เอกสาร ไม่ทับฟิลด์สถิติใด ๆ

`buildWhtCertificateSvg` เพิ่มพารามิเตอร์ optional ตัวใหม่:

```ts
replacementCopy?: { issuedAt: string /* ISO */ };
```

เมื่อมีค่า → เพิ่มบรรทัดป้ายกำกับข้างบน เมื่อไม่มี (undefined, ค่า default) → เอกสารเหมือนเดิมทุกประการ (ไม่กระทบ SYSTEM_INITIAL_ISSUE หรือ correction เดิมเลย)

### 6.2 ใบที่ถูกแทนที่ (superseded) — reuse `stateStamp: 'SUPERSEDED'` ตรง ๆ

`renderWhtCertificatePdf`/`renderSubstituteReceiptPdf` มีกลไก `PrintOptions.stateStamp` อยู่แล้วที่รองรับค่า `'SUPERSEDED'` พร้อม diagonal red overlay ที่ opacity 0.32 ตรงกลางหน้า ([substitute-receipt-pdf.logic.ts:65-67,417-427](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts)) — ใช้ได้ตรงตัวกับ **ใบเดิมที่ถูก correction แทนที่แล้ว** เมื่อผู้ใช้ดาวน์โหลดซ้ำ (ถ้าจะให้ดาวน์โหลดใบเก่าได้เลย — v1 ไม่บังคับต้องมี endpoint re-download ใบเก่า เพราะ sibling feature เองก็ไม่เคย persist `pdfAttachmentId` เลย — ดู §12 finding 2) เป็นตัวอย่าง generic mechanism ที่ตั้งใจไว้แต่แรกให้ใช้ข้าม document type ได้ (comment สนับสนุนการ reuse ข้าม module อยู่แล้ว)

`renderWhtCertificatePdf(svg, certificateNumber)` ([wht-certificate-pdf.logic.ts:140-142](../../apps/api/src/modules/tax/domain/logic/wht-certificate-pdf.logic.ts)) ปัจจุบัน**ไม่ส่งต่อ** `options` พารามิเตอร์ที่สามของ `renderSubstituteReceiptPdf` เลย — ต้องเพิ่ม parameter ที่สามแบบ optional (`options?: { stateStamp?: 'SUPERSEDED' }`) ส่งต่อตรง ๆ

## 7. Permissions / ABAC

**Permission ใหม่หนึ่งตัว: `wht.certificate.correct`** — ชื่อและขอบเขตตรงกับที่ decoupling spec/tax-thailand-2026-spec กำหนดไว้แล้วเป๊ะ ๆ ("narrow audited `wht.certificate.correct`", [feature-entitlement-decoupling-spec.md:235](../../docs/specs/feature-entitlement-decoupling-spec.md); "shared certificate-only correction/cancellation/ใบแทน" permission, [tax-thailand-2026-spec.md:1971](../../docs/specs/tax-thailand-2026-spec.md)) — **ตัวเดียวคุมทั้งแก้ไขและออกใบแทน** ไม่แยกสองสิทธิ์ (ตรงกับ design ที่มีอยู่แล้ว ไม่ต้องคิดใหม่)

**การตัดสินใจเรื่อง entitlement gate ของ permission นี้ — ดู §8 คำอธิบายเต็ม เพราะเป็นจุดที่ต้อง flag ให้ owner ยืนยัน**

จุดวาง: `permission-registry.ts` ใกล้บล็อก WHT ที่มีอยู่แล้ว ([permission-registry.ts:222-227](../../apps/api/src/modules/auth/permission-registry.ts)):

```
{ key: 'wht.certificate.correct', description: 'Correct or reissue a copy of a SYSTEM-issued 50 ทวิ certificate', riskLevel: 'HIGH' },
```

Role grant: เพิ่มเข้า FINANCE ([:882](../../apps/api/src/modules/auth/permission-registry.ts)) และ ACCOUNTANT ([:948](../../apps/api/src/modules/auth/permission-registry.ts)) ต่อท้าย `'wht.certificate.read', 'wht.external_certificate.link', 'wht.certificate.issue'` — role เดียวกับที่ถือ `wht.certificate.issue` อยู่แล้ว (การแก้ไข/ออกใบแทนของสิ่งที่ตัวเองมีสิทธิ์ออกได้ตั้งแต่แรก เป็นความรับผิดชอบต่อเนื่องกัน ไม่ใช่สิทธิ์ใหม่ที่ต้องแยก role) `riskLevel: 'HIGH'` เท่ากับ `wht.certificate.issue` เพราะ mint เอกสารกฎหมายใหม่เหมือนกัน

Pack: **ใส่เข้า pack ที่มีอยู่แล้ว `pack.wht.certificate.manage`** ([capability-pack.registry.ts:450-454](../../apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts)) ข้าง `wht.certificate.read`/`wht.external_certificate.link` — **ไม่ใช่** pack ใหม่แบบ `pack.wht.certificate.issue` ที่ gated ด้วย `thai_tax` — เหตุผลเต็มอยู่ที่ §8

## 8. Entitlement gate — จุดที่ต้อง flag ให้ owner ยืนยัน (ไม่ใช่แค่ทำตาม default)

### 8.1 Route-readiness gate

`cap.wht50bis/SYSTEM_CONTENT_CORRECTION` และ `cap.wht50bis/SYSTEM_REPLACEMENT_COPY` เป็น `routeClass: ORDINARY`, `seedState: OPEN` แล้ว (ย้ายมาจาก `SPECIALIST_LEGAL/CLOSED` ในคอมมิต `fc9bf7ff` ของ branch นี้เอง) — **ไม่ต้องรอ evidence เหมือน SYSTEM_INITIAL_ISSUE เดิม** เพราะ owner ยกเลิก specialist-review requirement ของทั้ง gate key ไปแล้ว (เหตุผลทางเทคนิค: `assertSpecialistRoutesClosed` match ที่ gate key ไม่ใช่ route key — sibling memory อธิบายไว้ครบแล้ว) — v1 นี้แค่ defensive re-check เหมือนที่ `IssueWhtCertificateFromHandoffUseCase` ทำกับ `SYSTEM_INITIAL_ISSUE` ([:83-85](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts)) — เพิ่ม helper คู่ขนาน `isSystemContentCorrectionOpen()`/`isSystemReplacementCopyOpen()` เรียก `isLaunchRouteOpen(guard, 'cap.wht50bis', 'SYSTEM_CONTENT_CORRECTION' | 'SYSTEM_REPLACEMENT_COPY')` ([wht-certificate-handoff.use-case.ts:32](../../apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts)) ตรง ๆ

### 8.2 Billing-tier entitlement (`thai_tax`) — คำถามจริงที่ต้อง resolve

Design เต็มรูปแบบ (CC5 + tax-thailand-2026-spec) พูดตรงกันทุกจุดว่า **`wht.certificate.correct` ไม่ต้องมี `thai_tax`**: "Certificate-content correction... does not require buying `thai_tax`" ([feature-entitlement-decoupling-spec.md:241](../../docs/specs/feature-entitlement-decoupling-spec.md)); "uses current source visibility or exact retained pre-cutoff legal-artifact authority + `wht.certificate.correct`, not `thai_tax`" ([tax-thailand-2026-spec.md:1393](../../docs/specs/tax-thailand-2026-spec.md)) — เหตุผลของ design เดิม: บริษัทที่เคย SYSTEM-issue ตอนยังเป็น ENTERPRISE แล้ว downgrade ทีหลัง ยังมีภาระผูกพันทางกฎหมายต้องแก้/ออกใบแทนของเอกสารที่ตัวเองเคยออกไปแล้ว — เป็นภาระต่อเนื่อง (compliance obligation) ไม่ใช่ฟีเจอร์เชิงพาณิชย์ใหม่ที่ต้องซื้อเพิ่ม

**แต่**: owner เพิ่งมีคำสั่งกลับด้าน design เดิมของ `SYSTEM_INITIAL_ISSUE` แบบเดียวกันนี้เป๊ะ ๆ มาแล้วเมื่อ 2026-09-22 ("ทวิ 50 ปุ่มกดออกเอกสาร ต้องเป็น pack ENTERPRISE เท่านั้น") และล่าสุดอีกครั้งตอนสั่งรวม gate ทั้งสามเส้นทางเข้าด้วยกัน โดยให้เหตุผลว่า "คาดหวังว่าเมื่อเปิด ENTERPRISE จะต้องได้ทวิ 50" (agent-memory: [wht-certificate-system-issuance.md:753-756](../../docs/agent-memory/wht-certificate-system-issuance.md)) — คำพูดนี้ตีความได้ว่า owner อาจมองความสามารถ 50 ทวิ ทั้งชุด (initial + correction + replacement) เป็น bundle เดียวที่ผูกกับ ENTERPRISE ทั้งหมด ไม่แยกแกนแบบที่ CC5 ออกแบบไว้

**คำแนะนำของ spec นี้ (ตาม design ที่มีอยู่แล้ว, resolved แต่ไม่ final จนกว่า owner ยืนยัน):** `wht.certificate.correct` **ไม่ gate ด้วย `thai_tax`** (เข้า `pack.wht.certificate.manage` เดิมที่ ungated, §7) — เหตุผลตรงตาม design เดิม + เคส downgrade ที่ยกมาข้างบนเป็นเคสจริงที่สมเหตุสมผล (ไม่ใช่การเดาเฉย ๆ) — นี่คือ**ข้อเสนอที่ resolve แล้วในเอกสารนี้ แต่เป็นการตีความ ไม่ใช่คำยืนยันจาก owner โดยตรงสำหรับสองเส้นทางนี้** (owner ยืนยันเรื่อง ENTERPRISE-gating ไว้เฉพาะปุ่ม SYSTEM_INITIAL_ISSUE เท่านั้น ไม่เคยพูดถึงปุ่มแก้ไข/ใบแทนตรง ๆ) — **ดู §12 open question ข้อ 1 ซึ่งเป็นคำถามที่สำคัญที่สุดของทั้งสเปกนี้**

หาก owner ยืนยันว่าต้องการให้ correction/replacement ผูกกับ `thai_tax` เหมือน initial-issue ด้วย ก็เพียงย้าย `wht.certificate.correct` ไปเข้า pack ใหม่ที่ gated (มิเรอร์ `pack.wht.certificate.issue`) แทน — เป็นการเปลี่ยนแค่หนึ่งบรรทัด ไม่กระทบ use case/schema ที่เหลือเลย (แยก concern ไว้ตั้งแต่ต้นตามที่ sibling spec §7 วางไว้)

## 9. Numbering

**คำตอบชัดเจนจาก design ที่มีอยู่แล้ว (ไม่ใช่จุดที่ต้องตัดสินใจใหม่):**

- **Correction = เลขที่ใหม่เสมอ** — "A corrected certificate supersedes the old artifact with a new number" ([tax-thailand-2026-spec.md:110](../../docs/specs/tax-thailand-2026-spec.md)); "Content correction under OPEN `cap.wht50bis/SYSTEM_CONTENT_CORRECTION` creates a new SYSTEM number/PDF" ([:1393](../../docs/specs/tax-thailand-2026-spec.md)) — ใช้ `ReserveDocumentNumberUseCase`/`documentSequences.commitNumberInTransaction` เดิม documentType `tax.wht_certificate` namespace เดียวกัน (namespace เดียวกับ initial issue — ไม่แยก namespace ใหม่) mirror ทุกขั้นตอนของ `IssueWhtCertificateFromHandoffUseCase` ([:105-118,158-160](../../apps/api/src/modules/tax/application/use-cases/issue-wht-certificate-from-handoff.use-case.ts)) รวม P2002 catch-and-replay
- **Replacement (ใบแทน) = เลขที่เดิมเสมอ ห้ามจองเลขใหม่** — "keeps the same certificate identity, number and `statutoryContentHash`" ([tax-thailand-2026-spec.md:1300](../../docs/specs/tax-thailand-2026-spec.md)); "`ใบแทน` is only a same-number unchanged-content copy for loss/damage" ([:110](../../docs/specs/tax-thailand-2026-spec.md)) — **ไม่เรียก `ReserveDocumentNumberUseCase` เลย** อ่าน `certificateNumber` จาก certificate ที่ active อยู่ตรง ๆ แล้ว re-render SVG เดิมพร้อมป้าย "ใบแทน" (§6.1)

## 10. Acceptance criteria

| # | Scenario | ผลที่ต้องได้ |
|---|---|---|
| C1 | มี `WhtCertificateHandoff.status === 'SYSTEM_ISSUED'` กด "แก้ไขหนังสือรับรอง" แก้เฉพาะที่อยู่ผู้รับเงิน (nonfinancial) | ใบใหม่เลขที่ใหม่ ค่าที่เหลือเหมือนเดิม ใบเก่า `status: VOIDED` + `voidReason: 'SUPERSEDED_BY_CORRECTION'` + `supersededByCertificateId` ชี้ไปใบใหม่ handoff.certificateId อัปเดตเป็นใบใหม่ |
| C2 | แก้ยอด/อัตรา/หมวดเงินได้ (financial) เมื่อ `TaxPeriod` ของใบเดิมยัง OPEN | ทำได้ปกติเหมือน C1 |
| C3 | แก้ยอด/อัตรา/หมวดเงินได้ (financial) เมื่อ `TaxPeriod` ของใบเดิม `FILED`/`PAID`/`CLOSED` | บล็อกด้วย `wht_certificate_correction_tax_period_locked` ไม่มีใบใหม่เกิดขึ้น ไม่มีเลขถูกจอง |
| C4 | กด "ออกใบแทน" ของ certificate ที่ active อยู่ | ได้ PDF เลขที่เดิม เนื้อหาเดิมทุกฟิลด์ มีป้าย "(ใบแทน — ออกซ้ำเมื่อ ...)" `replacementCopyCount` +1, `lastReplacementCopyAt`/`ByUserId` อัปเดต ไม่มีเลขใหม่ถูกจอง |
| C5 | กด "ออกใบแทน" ซ้ำสองครั้งติดกัน (ดับเบิลคลิก) | ได้ผลลัพธ์เดิมทั้งสองครั้ง (idempotent เพราะไม่มีการจองเลข ไม่มี state เปลี่ยนที่ทำให้เกิด conflict) — ไม่ต้องมี P2002 handling เพราะไม่มี unique constraint ให้ชน |
| C6 | Correction สองคำขอพร้อมกันสำหรับ handoff เดียวกัน | ได้ certificate ใหม่ใบเดียว เลขเดียว ไม่มี P2002 ดิบหลุดออกไป (mirror sibling S6) |
| C7 | Handoff ที่ `status !== 'SYSTEM_ISSUED'` (เช่น `EXTERNAL_LINKED`, `REQUIRED`) | ปุ่มทั้งสองไม่แสดงเลย — v1 ไม่แตะเอกสารที่มาจาก EXTERNAL |
| C8 | บริษัทไม่มี permission `wht.certificate.correct` (role ไม่ถือ หรือ — ถ้า owner ยืนยัน gate ด้วย thai_tax — ไม่มี entitlement) | ปุ่มทั้งสองไม่แสดงเลย ข้อมูล/banner ที่แสดงอยู่เดิมไม่เปลี่ยน |
| C9 | ออกใบแทนของ certificate ที่ถูก correction แทนที่ไปแล้ว (ไม่ active) ผ่านทาง handoff ปัจจุบัน | Resolve ไปที่ certificate ที่ active ล่าสุดเสมอ (ผ่าน `handoff.certificateId` ที่อัปเดตแล้วตอน correction) ไม่มีทางออกใบแทนของใบที่ถูก void แล้วได้ตรง ๆ |

## 11. Findings ระหว่างการค้นคว้า (grounded จากโค้ดจริง)

1. **`WhtCertificate.voidedAt`/`voidedByUserId`/`voidReason` เป็น seam ที่เตรียมไว้แล้วแต่ไม่มีจุดเขียนเลยวันนี้** — grep ทั่ว `apps/api/src/modules/tax/`, `apps/api/src/modules/procurement/`, `apps/api/src/modules/expenses/` ไม่พบการเขียนค่านี้เลยแม้แต่จุดเดียว — ยืนยัน pattern เดียวกับที่ sibling spec เจอกับ `WhtCertificateHandoff.status = SYSTEM_ISSUED` (เตรียมไว้ล่วงหน้าโดยเจตนา)
2. **`WhtCertificate.pdfAttachmentId` ไม่เคยถูกเขียนจริง (สืบทอดจาก sibling finding)** — v1 นี้เจอปัญหาเดียวกันซ้ำ: ไม่มีทาง "ดาวน์โหลดใบเก่าซ้ำ" ได้หลัง session แรกจบไป ถ้าต้องการให้ correction แสดงใบเก่าที่ถูก supersede พร้อม stateStamp SUPERSEDED (§6.2) ในหน้าที่ reload ไปแล้ว ต้อง**เก็บ PDF จริงลง `AttachmentObject` เป็นครั้งแรก** (ทั้งของใบใหม่และใบเก่าที่ถูกแทนที่) — เป็นงานที่ค้างมาจาก sibling feature ไม่ใช่ของใหม่ในสโคปนี้ตรง ๆ — spec นี้เลือก**ไม่บังคับ** ต้อง persist attachment ใน v1 (ดาวน์โหลด "ใบใหม่/ใบแทน" จาก response ทันทีพอ mirror sibling's `download-artifact.ts` pattern) — แต่ถ้า acceptance C9 ต้องการดูใบเก่าที่ถูกแทนที่แบบ persist ได้ ต้องทำเรื่อง attachment ก่อน (flagged เป็น future extension เดียวกับที่ sibling memory ทิ้งไว้)
3. **`ExpenseRecord`/`SupplierPayment` เป็น append-only แบบเดียวกันทั้งคู่** — ไม่มี in-place edit ของ WHT-related fields หลัง confirm/record ในทั้งสองโมดูล ยืนยันว่า §5.1's "certificate-document-scoped only" เป็นทางเลือกที่บังคับโดยสภาพจริงของโค้ด ไม่ใช่แค่ทางเลือกที่ง่ายกว่า
4. **`WhtCertificateStatus` enum (`DRAFT | ISSUED | VOIDED`) ตรงกับที่ CC5 คาดไว้เป๊ะ** ("With the existing certificate enum DRAFT | ISSUED | VOIDED", [feature-entitlement-decoupling-spec.md:234](../../docs/specs/feature-entitlement-decoupling-spec.md)) — ไม่ต้องเพิ่ม/เปลี่ยน enum

## 12. Open questions

1. **[สำคัญที่สุด] `wht.certificate.correct` ต้องผูก `thai_tax`/ENTERPRISE เหมือน `wht.certificate.issue` หรือไม่** — ดู §8.2 เต็ม ๆ spec นี้เสนอ **ไม่ผูก** ตาม design เดิมของ CC5 (การแก้ไข/ออกใบแทนของเอกสารที่เคยออกไปแล้วเป็นภาระผูกพันต่อเนื่อง ไม่ใช่ฟีเจอร์ใหม่ที่ต้องซื้อ) แต่ owner ไม่เคยยืนยันเรื่องนี้ตรง ๆ สำหรับสองเส้นทางนี้ — มีแค่คำสั่งเรื่อง `SYSTEM_INITIAL_ISSUE` กับคำพูดกว้าง ๆ ว่า "เปิด ENTERPRISE ต้องได้ทวิ 50" ซึ่งตีความได้สองทาง ต้องให้ owner ยืนยันก่อนเริ่ม implement เพราะเปลี่ยนทีหลังกระทบ role ที่เห็นปุ่มจริง (ไม่ใช่แค่ toggle ภายใน)
2. **การแสดงใบเก่าที่ถูก correction แทนที่แล้ว (พร้อม stateStamp SUPERSEDED) ให้ผู้ใช้ดูย้อนหลังได้หรือไม่** — v1 ตามที่ออกแบบใน §12 finding 2 ทำได้แค่ตอน mint (ดาวน์โหลดจาก response ทันที) ไม่มี endpoint persist สำหรับดูย้อนหลัง หาก owner ต้องการฟีเจอร์นี้จริง ต้องเพิ่ม scope เรื่อง attachment persistence ก่อน (งานที่ใหญ่กว่าที่ขอไว้เดิมเล็กน้อย)
3. **Chicken-and-egg ของ void-guard**: ถ้าในอนาคตมีคนต้องการแก้ `SupplierPayment.whtCategoryCode`/`whtRate` ของรายการที่มี certificate ผูกอยู่แล้วจริง ๆ (ไม่ใช่แค่แก้ certificate เฉย ๆ) ระบบยังไม่มีทางทำได้เลยแม้จะมีฟีเจอร์นี้ (void ยังถูกบล็อกเหมือนเดิม) — v1 นี้ไม่แก้ปัญหานี้ (นอกสโคปตาม §5.1) แต่บันทึกไว้ให้ผู้ดูแล accounting-correction workflow ทราบว่ายังเป็นช่องว่างจริง ไม่ใช่ solved โดยฟีเจอร์นี้
