# อ่านหลักฐานซื้อ marketplace ค้าปลีก และค่าขนส่งในโฟลว์ค่าใช้จ่ายเดิม

Status: Proposed v0.11, 2026-09-17. Paired with plan v0.11: W00–W08, D01–D09, A01–A88, IG01–IG29, E01–E27. Latest owner decision: failed reading returns a saved-file notice and direct link to manual completion on the same Web work item; replaces error-triggered reread buttons and LINE manual-entry proposals. PDF10MiB/multi-page/ordinary-receipt scope retained. Docs/design only; runtime/UX validation and release gates remain open.
Owner: Product owner / Codex
Scope: ผู้ซื้อ Shopee, Lazada, TikTok Shop, 7-Eleven, Lotus’s, Big C, Makro, CJ MORE และบริการขนส่งในไทย เพื่อรายการบริษัทและเบิกเงิน; กระดาษ/ภาพหน้าจอ/PDF/electronic ทั้ง LINE AI, อัปโหลดใหม่ และหน้าเปลี่ยนใบเสร็จ
User follow-up: explicitly include the existing ใบรับรองแทนใบเสร็จรับเงิน journey in this solution; see section 12. This is part of the baseline, not a later optional feature.
Plan: [Implementation plan W00–W08 พร้อม dependency และ acceptance mapping](../plans/marketplace-buyer-expense-capture-plan-th.md)
Background: [งานค้นคว้าและวิเคราะห์หกมุม](../research/marketplace-buyer-receipt-brainstorm-2026-09-14-th.md)
Source cases: [ทะเบียน 45 เคสและข้อจำกัด](../research/marketplace-buyer-public-corpus-2026-09-14-th.md) · [JSON](../research/marketplace-buyer-public-corpus-2026-09-14.json)

Retail research: [ผลสำรวจ 11 เอกสาร + ช่องทาง electronic](../research/thai-retail-buyer-receipt-survey-2026-09-17-th.md) · [catalog และ RC→A mapping](../research/thai-retail-buyer-receipt-survey-2026-09-17.json)
Courier extension: [ผลสำรวจ 7 ผู้ให้บริการ ณ 2026-09-18](../research/thai-courier-receipt-survey-2026-09-18-th.md); §18 เพิ่ม CC01–CC10 และ §18.4 กำหนดคำตอบเอกสารอื่น NR01–NR09 ที่ผู้ใช้ยืนยัน ภายใต้ v0.11 เดิม ยังไม่ใช่ latest-layout coverage หรือ runtime acceptance ที่ผ่านแล้ว

## 1. ผลลัพธ์ที่เลือก

ผู้ใช้ส่งหลักฐานผ่านค่าใช้จ่าย/LINE เดิม เห็นสรุปที่เข้าใจง่ายในหน้าตรวจเดิม ระบุส่วนบริษัทและผู้จ่ายเฉพาะเมื่อระบบยังไม่รู้ จากนั้นระบบจัดข้อมูลพร้อมใช้ต่อกับ expense หรือ reimbursement ตามเส้นทางที่รองรับ โดยไม่ให้กรอกข้อมูลซ้ำหรือคำนวณคูปองเอง

ข้อเลือกหลักคือ “เก็บต้นฉบับครบ → ตรวจและจัดส่วนบริษัท → ใช้หลักฐานเดิมหรือทำใบรับรองเมื่อเข้าเงื่อนไข → ทำต่อใน expense/ใบเบิกเดิม” ต้นฉบับกับส่วนบริษัทมีคนละความหมายและต้องเก็บได้ทั้งคู่ ใบรับรองเป็นขั้นจัดการหลักฐาน ไม่ใช่ปลายทางการเงินแยก

ทุกจุดรับข้อมูลมีทางเก็บ/แก้/เพิ่มหลักฐาน/พักและกลับมาได้จริง การเก็บร่างไม่แปลว่าส่งเบิก อนุมัติ ลงบัญชี หรือจ่ายเงินแล้ว อายุ 40+ เป็นกลุ่มทดสอบที่มีทักษะหลากหลาย ไม่ใช้แทนสมมติฐานความสามารถของคน

## 2. ขอบเขตตั้งต้น

### Must-have ของ feature รุ่นแรก

- ทางเข้าค่าใช้จ่ายและ LINE เดิม รวมหน้า “เปลี่ยนใบเสร็จ”; ภาพ/PDF ที่มีหลายร้าน หลายสินค้า หลายหน้า และ electronic โดยกฎร่วม/ความต่างของช่องทางเป็นข้อบังคับตาม §16
- ค้าปลีกหนึ่งผู้ขายไม่ต้องสร้าง expense ต่อ SKU; แยก purchase channel/merchant brand/legal issuer และแยก receipt type ออกจากรูปแบบไฟล์ตั้งแต่ intake
- จัดกลุ่มด้วยหลักฐานและให้ผู้ใช้แก้ได้ ไม่กำหนดว่าหนึ่ง upload batch เท่ากับหนึ่ง checkout เสมอ
- อ่านองค์ประกอบเงินพร้อม scope และ source evidence; ตรวจสินค้า ร้าน และยอดรวมโดยใช้ Decimal/satang
- สรุปหน้าตรวจเดิม เลือกของส่วนตัวออกระดับสินค้า/จำนวน เก็บต้นฉบับครบ และเห็นยอดบริษัทที่เปลี่ยน
- เก็บร่างที่ยังไม่ครบ เพิ่มรูป/แก้ต่อในงานเดิม และไม่ทับข้อมูลที่คนตรวจจาก OCR ที่กลับมาช้า
- สร้างส่วนบริษัทที่ตรวจแล้วพร้อม lineage และเชื่อม workflow ค่าใช้จ่าย/ใบเบิกเดิมตาม eligibility
- เชื่อมการตรวจความเพียงพอของหลักฐานกับใบรับรองแทนใบเสร็จเดิม เติม facts ที่ตรวจแล้ว รองรับลงนามออนไลน์/กระดาษตามสิทธิ แล้วกลับรายการเดิมโดยไม่สร้างค่าใช้จ่ายหรือจ่ายซ้ำ
- กันค่าใช้จ่าย/ใบเบิกซ้ำจากภาพเดิม เอกสารที่ตามมา การแยกร้าน และ concurrent actions
- single-store path เดิมยังใช้งานได้ตามเดิม และไม่ต้องเข้า flow พิเศษจากการเลือกชื่อแพลตฟอร์ม

### ขอบเขตเส้นทางที่พร้อมส่งต่อในรุ่นแรก

THB ที่ระบุสกุลได้ บริษัท/สาขาเดียว ผู้จ่ายที่ยืนยันได้หนึ่งคนหรือเงินบริษัทเต็มจำนวน สินค้า/ค่าธรรมเนียมอยู่ในโมดูลปลายทางที่รองรับ ส่วนลด/ค่าจัดส่งมีหลักฐานหรือ allocation policy ที่ยอมรับแล้ว และไม่มีเงินคืนค้างปรับยอด

- Company-funded: ต่อ expense review/confirmation/accounting/payment ตามข้อเท็จจริงและความสามารถเดิม ไม่สร้าง company payment จากเพียงข้อความ paid ในภาพ
- Employee-funded: ผู้จ่ายเป็นสมาชิกที่ระบบยืนยันได้ และภาษีอยู่ในขอบเขต reimbursement source เดิม (gross/non-claimable, ไม่ใช่ WHT หรือ claimable/unresolved tax) จึงส่งต่อใบเบิกได้
- Mixed personal/company items อยู่ใน feature รุ่นแรก ผ่านการจัดส่วนบริษัทก่อนสร้างต้นทางใบเบิก

### รับเก็บและตรวจได้ แต่ยังไม่ให้ส่งต่ออัตโนมัติ

เงินหลายแหล่ง/หลายผู้จ่าย BNPL สกุลต่างประเทศ coins ที่ยังแยกส่วนลดกับแหล่งเงินไม่ได้ shared promotion ที่ไม่รู้ eligibility ภาษีที่เส้นทางใบเบิกเดิมไม่รองรับ และ refund ที่ยังไม่คลี่คลาย ต้องเก็บ facts ครบพร้อมเหตุผล/ทางทำต่อที่ตรงกับความสามารถจริง

กรณีไม่มีผู้รับงานหรือยังไม่มีเส้นทางบัญชีที่รองรับ ให้เก็บร่างพร้อมเหตุผลและข้อมูลสำหรับผู้ใช้ดำเนินการต่อ ไม่แสดงว่าส่งให้บัญชีหรือเสร็จแล้ว ไม่มีการปิด tax/permission guards หรือตัด VAT ทิ้งเพื่อส่งเข้าเส้นทาง gross-only

ไม่อยู่ในรุ่นแรก: automatic mailbox/merchant-account connectors, arbitrary QR/URL fetching, การสร้าง e-Tax ออกแทนร้าน, automatic cryptographic verification ที่ยังไม่ตัดสิน D09, seller APIs/settlement/import backlog #19, automatic refund posting, generic arbitrary partial reimbursement, multiple claims/payers consuming one purchase group, external payees without accounts, new approval workflow และ AI financial finalization

## 3. User journey และข้อความ

1. ผู้ใช้เลือก “เพิ่มรูปหรือไฟล์” ผ่านทางเดิม ระบบเก็บต้นฉบับและเชื่อมงานที่เหมาะสม ไม่บังคับเลือกร้าน/platform/document type ก่อน
2. หลัง persistence สำเร็จ บอก “เก็บรูปแล้ว กำลังอ่านรายละเอียด”; ถ้ายังส่งไม่ถึงให้บอก “รูปยังส่งไม่สำเร็จ” พร้อม retry ที่ไม่ทำค่าที่มีอยู่หาย
3. ใช้หน้าตรวจเดิม สรุปร้าน/สินค้า/ยอดที่มีหลักฐานและ action ถัดไป รายละเอียดโปรโมชั่นเปิดเพิ่มได้ สถานะคลาดเคลื่อนที่กระทบยอดต้องมองเห็นก่อน action ที่เกี่ยวข้อง
4. ถ้ายังไม่ทราบส่วนใช้งาน ให้เลือก “ใช้สำหรับบริษัททั้งหมด” หรือ “มีของส่วนตัวด้วย” โดยไม่มีการเลือกแทนผู้ใช้; เลือกจำนวนส่วนตัวได้โดยรายการต้นฉบับยังอยู่
5. ถ้ายังไม่ทราบผู้จ่าย ให้ถาม “ใครเป็นคนจ่ายรายการนี้” พร้อมเฉพาะคำตอบและสมาชิกที่มีสิทธิเลือก; ผู้เตรียมเอกสารไม่กลายเป็นผู้รับเงินคืนโดยอัตโนมัติ
6. แสดงยอดบริษัท/ยอดขอเบิกพร้อมยอดจ่ายรวมที่เกี่ยวข้อง กดดูที่มาการแบ่งได้ ถ้ารายการใดรอตรวจ บอกสิ่งที่ขาดและทางเพิ่ม/แก้/พัก
7. ตรวจหลักฐานราย source: ถ้ามีใบเสร็จที่ใช้ได้ไปเส้นทางปกติ ถ้าไม่มีหรือขาดสาระสำคัญ ให้เพิ่มหลักฐานหรือเปิดใบรับรองแทนใบเสร็จเดิมเมื่อรายจ่ายจริงและ eligibility ผ่าน ตามข้อ 12 ถ้ายังไม่ผ่านให้เก็บ/แก้ต่อโดยไม่ปลอมข้อมูล
8. Action ตามสิทธิและเส้นทาง: ไปตรวจค่าใช้จ่ายบริษัท หรือเตรียมใบเบิกเดิม พร้อม carry-over ข้อมูล ไม่ส่งคำขอเบิกจาก LINE และไม่ข้าม web confirmation/approval เดิม
9. หลัง action สำเร็จ แสดงผลตามที่เกิดจริง เช่น “สร้างร่างใบเบิกแล้ว ยังไม่ได้ส่งอนุมัติ” พร้อมเปิดรายการเดิม retry ต้องได้รายการเดิม

การเห็นส่วนบริษัทและกดสร้างต้นทางไม่รับรองสิทธิภาษีหรืออนุมัติ reimbursement การเปลี่ยนกฎ LINE summary/stable financial form ต้องระบุเฉพาะจุดใน implementation ไม่ยกเครื่องหรือสร้างฟอร์มซ้ำ

คำถามที่จำเป็นทั้งหมด ณ ขณะนั้นแสดงร่วมกัน รับคำตอบบางส่วนได้ ไม่ถามซ้ำ และไม่บังคับกรอกข้อความ “ซื้อไปใช้ทำอะไร” ซึ่งยัง optional ตาม spec เดิม ทุก state มี “เก็บไว้ก่อน” เมื่อผู้ใช้มีสิทธิ draft; action นี้เก็บ/พักตามจริงและไม่ใช้เป็นชื่อของ final mutation

## 4. Domain decision: capture facts กับ eligible source

### Capture group

ใช้เป็นงานรวมหลักฐานในบริษัท/สาขาเดียว เก็บ immutable source attachments, document/store/order/item identities, observations, actual payment evidence, warnings และ revisions กลุ่มเป็นที่เก็บข้อมูลก่อนเข้าสู่เอกสารการเงิน ไม่ลงบัญชีด้วยตัวเอง

เก็บ platform checkout/order reference เมื่อพบ แต่ group ID ภายในไม่อ้างว่าเป็น checkout ID ของแพลตฟอร์ม ภาพหนึ่งอาจมีหลาย order; batch ที่มีการซื้อไม่เกี่ยวกันต้องเสนอแยกพร้อมเก็บทุกไฟล์

### Reviewed business allocation

snapshot ที่ ERP สร้างจาก facts ที่ตรวจแล้วและ policy ที่ใช้ ระบุ source group/revision, eligible item IDs/quantity, seller/legal issuer scope, component allocations, amount, currency, payer/funding route, provenance และผู้ review

ส่วนตัวคงอยู่ในต้นฉบับและฐานโปรโมชั่นที่เข้าเงื่อนไข แต่ไม่สร้างหนี้บริษัทหรือสิทธิเบิก ส่วนบริษัทที่ได้เป็นเอกสารจัดสรรภายใน ไม่ปลอมเป็นยอดที่ร้านออกใบกำกับมา

### Derived expense sources

สร้าง derived expense sources ตามผู้ออกเอกสาร/ขอบเขตที่จำเป็นจาก reviewed business allocation เท่านั้น UI แสดงเป็นรายร้านเพื่อให้เข้าใจง่าย แต่ storefront ไม่ใช่ legal issuer เสมอ และไม่กำหนดว่าต่อร้านต้องหนึ่ง expense ตลอดไป

สำหรับ employee-funded source ที่รองรับ ให้แต่ละ derived source มี netPayableAmount เท่ากับส่วนบริษัทที่ตรวจแล้ว จากนั้นใบเบิกใช้ยอดเต็มของ eligible draft ผ่านกฎ full-source เดิม พร้อมแนบ snapshot ของต้นฉบับและการจัดส่วนบริษัท

ตัวอย่าง: purchase ทั้งชุด 1,290 บาท ส่วนบริษัท 810 บาท ส่วนตัว 480 บาท → derived source สำหรับบริษัท 810 บาท → claim line เต็ม source 810 บาท; original purchase 1,290 บาทยังคงอยู่ในหลักฐาน/group facts และไม่สร้าง source expense รวมอีกก้อนที่ลงบัญชีได้

ชื่อเรียก: รีโปมี `ExpenseSourceDraft` อยู่แล้วซึ่งหมายถึงสถานะร่างบทสนทนา LINE ([logic](../../apps/api/src/modules/expenses/domain/logic/expense-source-draft.logic.ts:14), [web model](../../apps/web/src/features/expenses/expense-source-draft.model.ts)) คนละความกับเอกสารที่ derive จาก allocation ในงานนี้ ใน spec/plan/code ให้เรียกของใหม่ว่า **derived expense source** (หรือ eligible source) เท่านั้น ห้ามใช้คำว่า source draft ลอย ๆ เพราะจะชี้ไปที่ seam ผิด

**สิ่งที่ employee-funded derived expense source ต้องผ่านก่อนส่งเข้าใบเบิก (ข้อบังคับของ resolver ปัจจุบัน ไม่ใช่ข้อเสนอใหม่):**

การสร้าง derived source ใน W05 ยังไม่เท่ากับพร้อมเบิก: source ที่ต้องทำใบรับรองเข้า W06 ในสถานะรอหลักฐานได้ เมื่อใบรับรอง ISSUED และผ่านกฎอื่นจึงตรวจ resolver เพื่อส่งต่อ W07 ส่วน company-funded ใช้ expense/certificate guards ของ route นั้น ไม่บังคับผ่าน reimbursement resolver หรือห้าม VAT/WHT ตามเงื่อนไขใบเบิกโดยเหมารวม

- ผู้จ่าย: [reimbursement-source.ts:32-35](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:32) ไม่มีฟิลด์ payer แยก ถ้าไม่มีใบรับรองมันบังคับ `createdByUserId === requesterUserId`; ถ้ามีใบรับรองจึงใช้ `certificate.payerUserId` แปลว่า group ที่คนอื่นอัปโหลดแทนผู้จ่ายจะสร้าง source ที่เบิกไม่ได้จนกว่าจะตัดสินว่าจะแทน payer อย่างไร (D06)
- โครงเอกสาร: [reimbursement-source.ts:44-48](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:44) บังคับว่าผลรวม `lineTotalAmount` เท่า `netPayableAmount` และต้องผ่าน `expenseTotalsIdentityError` ทั้ง subtotal/discount/taxable/vat/wht ตาม vatMode ดังนั้น allocation ระดับสตางค์ต้องสร้างบรรทัดที่ identity ผ่าน ไม่ใช่เพียงยอดรวม 810
- ภาษี: [reimbursement-source.ts:36-38](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:36) reject ทันทีเมื่อ `whtAmount > 0`, `inputVatClaimStatus ∈ {CLAIMABLE, NEEDS_REVIEW}`, `vatMode === NEEDS_REVIEW` หรือ `taxEvidenceStatus === NEEDS_REVIEW` และ draft ที่ระบบสร้างตอน upload ตั้ง `inputVatClaimStatus: mode === 'SIMPLE' ? 'NON_CLAIMABLE' : 'NEEDS_REVIEW'` อยู่แล้ว ([expense-upload.use-case.ts:99](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:99)) เป็นค่าเริ่มต้นตาม capture mode ไม่ใช่ข้อสรุปภาษีหลัง review (ดู §9) D03 ต้องกำหนดการตรวจ classification ตาม facts/สิทธิและทางพักของเคสที่ยังไม่ครบ; ไม่บังคับให้ทุก source ผ่าน และห้ามตัด VAT หรือเปลี่ยนสถานะเพื่อเลี่ยง guard
- หลักฐานร่วมหลาย sibling มีสามกรณีที่ต้องทดสอบแยก ไม่ได้เกิดพร้อมกันทุก request: (1) [readReimbursementSource](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:43) ต้องพบ active attachment หรือ certificate artifact ตาม guard เดิม (2) [resolveReimbursementSourceLines](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:97) ตรวจ ambiguity เมื่อส่ง attachmentId และนับ capture-only parent ที่ sourceReimbursementRequestId เป็น null ด้วย; การส่ง linkedExpenseId ไม่ใช่สิทธิข้ามการตรวจ lineage/consumption (3) [source review guard](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:128) ปฏิเสธ attachment-only line ที่ไม่มี source snapshot/linkedExpenseId แต่ไฟล์ผูก expense อยู่ ออกแบบ lineage-aware path ให้รองรับทั้ง explicit-source และ attachment selection โดยคง unrelated/duplicate-source guards ห้ามแก้ด้วยการทิ้ง links หรือก๊อปไฟล์ต่อ child

นี่เป็นการเพิ่ม derived-source contract ที่มีหลักฐาน ไม่ใช่การอนุญาตให้ client แก้ source amount ตามใจ ต้องตรวจ derived source, actual payer binding, authoritative creator/audit และต้นทางทั้งสายก่อน claim/confirmation/payment

## 5. Persistence และ API boundary

เลือกเพิ่ม grouping/allocation capability ขนาดเล็กใน Expense module เดิม ใช้ storage/OCR/expense/reimbursement service เดิม ไม่สร้าง standalone marketplace service

- Raw observations, monetary components และ source snapshots เป็น versioned bounded data
- Group identity, revision, state, child lineage และการสงวนสิทธิส่งต่อเป็นข้อมูลที่ query/lock/บังคับ unique ได้ ไม่พึ่ง AI JSON เพื่อกันเบิกซ้ำ
- Relation ของ child ต้องมี company-scoped source identity และ stable scope key; generation idempotency ผูกกับ group + accepted revision + destination scope
- หนึ่ง group ในรุ่นแรกมีหนึ่ง funding route และหนึ่ง financial handoff ที่ active อยู่ การสร้าง child หลายรายการเกิดเป็น batch ที่รู้ครบทุกตัว ป้องกันผู้ใช้สลับ route เพื่อใช้ยอดเดิมสองครั้ง
- Cancellation/rejection ของ draft ไม่ลบ evidence และการใช้ใหม่ต้องตรวจว่าจะไม่มี active/paid/posted consumption เดิม ไม่ unlock อัตโนมัติเมื่อมีเงินหรือรายการบัญชีเกิดแล้ว
- Files มี canonical source ownership; destinations resolve evidence ผ่าน validated lineage อย่างชัดเจน ไม่ attach ไฟล์เดียวไปหลาย unrelated sources แล้วปิด ambiguous-source guard
- เก็บ approval snapshots รวม group/selection/component/payer/policy facts; source change ทำให้ handoff ที่ยังไม่ final ต้องกลับ review
- การเชื่อมเอกสารที่ตามมาซึ่งไม่เปลี่ยนตัวเลขเป็น versioned supplemental evidence เมื่อมีสิทธิ ไม่เปลี่ยน signed snapshot เงียบ ๆ ถ้าเปลี่ยน financial facts ให้ใช้ review/reversal ตามสถานะ

Implementation plan ต้องเลือก ORM fields/tables ที่เล็กที่สุดซึ่งบังคับ invariants เหล่านี้ได้ก่อน code เนื่องจากระบบเดิมสร้าง ExpenseRecord ทันทีตอน upload จึงต้องกำหนดการผูก entry draft กับ capture group ให้ชัด: entry ที่เป็น capture-only ห้ามไป confirm/pay/post/claim ได้ทุก server entry point และคง deep link ของผู้ใช้ การเปลี่ยนนี้ไม่ทำ migration ค่าใช้จ่ายเก่าให้เป็น capture-only ตามการเดา

ลำดับบังคับในแผน: W01 ต้องมี source-role/permission/capability guards และหลักฐานปฏิเสธ financial mutation ของ capture-only ก่อน W02 เปิดรับ multi-file group ไม่เลื่อนการป้องกันนี้ไปหลังสร้าง eligible sources ใน W05

API intent เชิงแนวคิด: อ่าน/เติม source observations, แก้ business selection และ payer, คำนวณ preview, ยอมรับ reviewed allocation และสร้าง destination drafts โดยทุก mutation มี expected revision/idempotency ตาม side effect

Client ส่ง identities/choices/corrections พร้อม evidence ได้ แต่ final allocation, destination totals และ source snapshots ต้องมาจาก ERP ที่ตรวจแล้ว ไม่มี client-supplied approved/paid/posting status และไม่มี direct AI-to-DB path

## 6. กฎเงินตั้งต้น

1. อ่านราคาขายจริงกับส่วนลดที่รวมแล้วให้ชัด แยก unit/extended price ไม่คูณจำนวนซ้ำ
2. ค่าส่งใช้ gross-minus-discount หรือ net เพียงรูปแบบเดียว ส่วนลดแม่และรายการแจกแจงนับครั้งเดียว
3. ใช้ breakdown จริงก่อน derived values ที่มีคำตอบเดียว ก่อน internal allocation ตาม policy ที่ยอมรับแล้ว
4. ข้อเสนอนโยบายเริ่มต้นสำหรับ shared product discount: แบ่งตามยอดสินค้าที่มีสิทธิหลังส่วนลดร้าน ไม่รวมค่าส่งและสินค้าที่ไม่เข้าเงื่อนไข; ยังต้องให้ผู้รับผิดชอบบริษัท/บัญชียอมรับก่อนใช้งานจริง
5. สินค้าส่วนตัวที่มีสิทธิในโปรโมชั่นยังอยู่ในฐานแบ่ง แล้วค่อยตัดสิทธิเบิก ไม่ย้ายส่วนลดของสินค้าส่วนตัวไปให้บริษัท
6. ค่าส่งยึดร้าน/พัสดุและหลักฐานจริง การแบ่งค่าส่งในพัสดุที่มีของส่วนตัวต้องใช้นโยบายที่ยอมรับแล้ว; ไม่ประกาศเป็นกฎเดียวทุกแพลตฟอร์ม
7. Largest remainder ถึงสตางค์และ stable tie-break เก็บเศษใน allocation provenance; sum เท่าต้นทางและส่วนลดไม่เกิน eligible base
8. Coins ที่ใช้เป็นส่วนลดที่พิสูจน์ได้มีผลตามเอกสาร; wallet ที่เป็นแหล่งเงินและ reward ที่ยังไม่รับจริงแยกกัน ไม่ตั้ง coin exchange rate ข้ามแพลตฟอร์ม
9. ไม่มี rounding หรือ discount ที่สร้างขึ้นเพื่อทำยอดให้ตรง จำนวนที่อ่านไม่ออกเก็บ unknown ไม่ใส่ 0
10. Supplier invoice totals, actual payments, business allocation, employee claim และ VAT eligibility เก็บแยกกัน ไม่ใช้เงินออกจากบัตรเป็นฐาน VAT โดยอัตโนมัติ
11. Retail ใช้ sale/void/discount/tender/reward/info events ตาม §16.2; รับเงินสด500ทอน432คือซื้อ68 ไม่ใช่500; savings summary/แต้มคงเหลือ/คูปองครั้งหน้าไม่ลดซ้ำ
12. Quantity/weight/pack size/unit price แยกกัน; VAT code ต้องอ่าน legend ไม่แปลง code1/code2 เป็น1%/2% และไม่เหมาภาษีทั้งใบเป็น7%
13. ซื้อสต็อก/สินทรัพย์/ชำระบิลบุคคลที่สามที่ปลายทาง expense แทนไม่ได้ ให้เก็บ/ระบุปลายทางที่มีจริงตามสิทธิ ไม่ลงเป็นค่าใช้จ่ายทันทีเพราะชื่อร้านหรือยอดบิล

Policies ที่ยังไม่ตกลงไม่ขวางการรับ/เก็บหลักฐาน แต่ต้องมีเหตุผลที่มองเห็นก่อน action ทางการเงินที่พึ่ง policy นั้น ข้อเสนอนี้ไม่ตั้งค่าบริษัทจริงหรืออนุมัติ accounting treatment ใดโดยปริยาย

## 7. AI และการกู้ข้อมูล

ใช้ reader/extractor เดิมพร้อม output version ที่รองรับ document/store/item/component scopes และ source references เพิ่ม deterministic validation หลัง extraction

- เก็บ transcription แยก interpretation; ตรวจ schema, row completeness, seller identity, repeated totals และ scope ก่อนเสนอพร้อมใช้
- page/region references ต้องตรวจได้จริง ไม่รับพิกัดหรือหลักฐานปลอมที่ AI แต่ง; fallback เป็น attachment/page/exact span เมื่อไม่รองรับ region
- ขีดจำกัดหน้า/item/token/context ต้องมี observable incomplete state และเก็บไฟล์ครบ ไม่ตัดข้อมูลท้ายแล้วอ้าง complete
- Re-read/repair เฉพาะปัญหาที่แก้ได้ใน call/time budget และนำผลมาเทียบ ไม่ลบข้อมูลที่มนุษย์ review แล้ว
- Capture success แยก extraction/reconciliation/handoff success; failure ของการแจ้งผลไม่ replay creation
- Log stage/version/count/latency/cost โดยไม่ใส่ raw receipts หรือข้อมูลส่วนบุคคล
- ใช้ held-out transaction bundles แยกจาก tuning; วัด seller/item/money-scope accuracy และ false-confident acceptance คู่กับ human correction time
- LINE multi-document/ambiguous refusal เดิมยังมีผล; กลุ่ม marketplace/ค้าปลีกที่รับเพิ่มต้องผ่าน versioned capture contract และ target/scope guards ตาม §16 ไม่ส่งหลายเอกสารลง single-expense fields หรือเพียงลบ refusal จาก prompt

## 8. ทางออกและสิทธิ

| สถานะ | ทางออก |
|---|---|
| รูป/ไฟล์ส่งไม่ถึง หรือไม่ทราบผล | ถ้ายืนยันว่าไม่ถูกเก็บจึงให้ส่งซ้ำ; ถ้ายังไม่ทราบให้ตรวจสถานะoperationเดิมก่อน ตาม§17 ไม่อ้างว่าไฟล์หายหรือเก็บแล้วเอง |
| รูป/ไฟล์เก็บแล้ว อ่านไม่ครบ | แจ้งว่าเก็บไฟล์แล้วและเปิดลิงก์Webกรอกส่วนที่ขาดในงานเดิมพร้อมไฟล์/ผลอ่าน; พักหรือเพิ่มหลักฐานจากหน้าเดิม |
| ยอดหรือส่วนลดไม่ชัด | เปิดหลักฐานตรงจุด เก็บ facts ที่รู้ และพักส่วนที่ยังไม่มีคำตอบ |
| ไม่รู้คำตอบ | รับคำตอบบางส่วนและพัก; ขอคนช่วยเฉพาะเมื่อมีผู้รับงานและสิทธิจริง |
| ทำนโยบาย/ภาษีไม่ครบ | แสดง review reason และปลายทางที่รองรับจริง; ไม่อ้างว่าจัดการให้แล้ว |
| ไม่มีสิทธิ final action | คง draft/source ที่เข้าถึงได้และ action ตาม role; ไม่สร้างทางลัดข้ามสิทธิ |
| อ่าน/สร้าง destination สำเร็จแต่แจ้งผลไม่ได้ | แสดง/ส่งผลเดิมเมื่อช่องทางพร้อม ไม่สร้างใหม่ |
| session หมดหรือกลับวันหลัง | เข้าใหม่แล้วกลับรายการเดิมเมื่อมีสิทธิ พร้อมสถานะที่ server เก็บจริง |

รับเข้าได้ง่ายต้องไม่แลกกับข้อมูลข้ามบริษัท source/child/attachment/payer ทุกความสัมพันธ์ต้องอยู่ใน company/branch scope ที่อนุญาต บริษัทปัจจุบันต้องเห็นได้ ไม่เปลี่ยนบริบทตามข้อความในภาพ

ความสามารถใหม่ยังไม่มี action-to-permission mapping ที่ตัดสินแล้ว: [permission registry](../../apps/api/src/modules/auth/permission-registry.ts:160) มีสิทธิ expense เดิมที่อาจ reuse ได้ ก่อนเปิด capture group ต้องระบุว่า "ดูกลุ่มหลักฐาน", "จัดส่วนบริษัท/ผู้จ่าย" และ "สร้าง derived expense source" ใช้ key ใด (reuse ของเดิมหรือเพิ่มเมื่อจำเป็น), ผูกกับ role/ownership ใด และ gate ด้วย entitlement/launch route อย่างไร ไม่ใช้การซ่อนปุ่มแทน server guard ดู IG15

ขนาดตัวอักษรไทย 18 CSS px และพื้นที่แตะหลักประมาณ 48 × 48 CSS px เป็น design target สำหรับทดสอบ รักษาการขยายข้อความ/reflow/contrast และ themed components เดิมตามงาน UX research

## 9. การลงบัญชีและขอบเขตปัจจุบัน

เลือก funding route ก่อน finalizing source; company-funded children ผ่าน expense path เดิม Employee-funded children เป็น evidence source ของ reimbursement และต้องไม่ post/pay ผ่าน company expense route พร้อมกัน

Reimbursement ยังคงเจ้าของ approval, employee-payable projection และ payment การรับรู้ต้นทุนและจ่ายต้องมี canonical source หนึ่งชุดตาม workflow เดิม [Source consistency](reimbursement-source-consistency-spec.md) และ [Expense ledger](expense-ledger-auto-post-spec.md) เป็นข้อจำกัดที่ต้องรักษา

Upload ใน capture mode `FULL` เริ่มด้วย `inputVatClaimStatus: NEEDS_REVIEW` ([expense-upload.use-case.ts:99](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:99)); mode นี้รวม VAT registration `REGISTERED` และ `UNKNOWN` ที่มี thai_tax entitlement ตาม [capture policy](../../apps/api/src/modules/expenses/domain/logic/expense-capture-policy.logic.ts:28) จึงไม่ใช่หลักฐานว่าบริษัทจด VAT แล้วหรือทุกเอกสารจะคง NEEDS_REVIEW หลังตรวจ Journey ต้องแสดง “รอตรวจภาษี” ให้ผู้มีสิทธิตรวจตามข้อเท็จจริงก่อนเตรียมใบเบิก; unknown/claimable/WHT ที่ route ไม่รองรับคงพักโดยไม่บังคับ NON_CLAIMABLE เพื่อผ่าน resolver A04/A08 ต้องครอบ SIMPLE, FULL/REGISTERED และ FULL/UNKNOWN พร้อมผลหลัง review ทั้งที่ส่งต่อได้และที่ยังถูกบล็อก

การเพิ่ม derived source ไม่ทำให้ claimable VAT/WHT ผ่าน gross-only projection ได้ ไม่ตีความการสำรองจ่ายว่าใช้ภาษีซื้อไม่ได้ตามกฎหมาย และไม่ลบ tax evidence ที่มาภายหลัง การขยายเส้นทาง employee-funded tax ต้องเป็น slice ที่มี spec/plan และ accounting acceptance แยกก่อนปล่อยใช้งาน

Company-funded mixed personal purchase ในรุ่นแรกยังต้อง review การเรียกคืนส่วนตัว/บัญชีที่เกี่ยวข้องก่อน finalization หากไม่มีเส้นทางรองรับ การแสดงยอดธุรกิจอย่างเดียวไม่ทำให้ยอดเงินบริษัทที่จ่ายไปส่วนตัวหาย

Refund ที่ตามมาผูกกับ group/order/item และ revision เอกสารได้ แต่ไม่แก้ expense/claim ที่ลงบัญชีหรือจ่ายแล้วเงียบ ๆ ใช้ refund/credit/reversal route ที่ตรวจแล้ว หรือเก็บรอผู้รับผิดชอบเมื่อยังไม่รองรับ

## 10. Acceptance ของ solution ตั้งต้น

| ID | ตัวอย่าง | ผลที่ต้องได้ |
|---|---|---|
| A01 | บิลร้านเดียวเดิม | อัปโหลด/อ่าน/แก้/บันทึก/ตรวจตามเดิม ไม่มีหน้าหรือคำถามเพิ่มที่ไม่จำเป็น |
| A02 | หลายภาพซื้อสองร้าน มีหน้าซ้อน | สินค้า/ร้านครบ นับครั้งเดียว เพิ่มภาพกลับงานเดิมได้ |
| A03 | 1,500 สินค้า - 100 ร้าน - 140 คูปอง + 100 ส่ง - 70 ลดส่ง | ยอดรวม 1,290; แจกตาม basis ที่ยอมรับได้ A=810 B=480 |
| A04 | A บริษัท B ส่วนตัว พนักงานจ่ายเต็ม | original 1,290 คงอยู่ สร้าง derived source 810 และเมื่อผ่าน employee eligibility ใช้ full-source claim 810; B ไม่สร้างหนี้บริษัท; ทดสอบ SIMPLE/FULL และกรณี tax review ยังไม่ผ่านตาม §9 |
| A05 | บริษัทจ่ายเต็ม 1,290 แต่มีส่วนตัว 480 | ไม่สร้าง employee reimbursement; เก็บเงินจริง 1,290 และส่วนตัว 480 เพื่อ review การจัดการส่วนตัวก่อน finalization |
| A06 | cashback 50 ที่จะได้รับ | ไม่ลด paid total ปัจจุบันจาก 1,290 เป็น 1,240 |
| A07 | ส่วนลดรวมกับ breakdown / ค่าส่ง net | ไม่หักซ้ำและไม่ fabricate balancing amounts |
| A08 | เอกสาร VAT ไม่เข้า claim path เดิม | เก็บ tax facts ครบและหยุดเฉพาะ action ที่ไม่รองรับพร้อมทาง review จริง ไม่แปลง VAT เป็น 0 |
| A09 | รูปเดียวรองรับหลาย eligible children | เปิดดูต้นฉบับผ่าน lineage ได้ และ guard ยังคงปฏิเสธ unrelated/ambiguous source |
| A10 | กดสร้างซ้ำ/retry/สองคนทำพร้อมกัน | มี destination batch และ active financial handoff เดียว source amount ไม่ถูกใช้ซ้ำ |
| A11 | เปลี่ยน selection/payer หลัง preview | เกิด revision ใหม่ คำนวณใหม่และต้องใช้ review ปัจจุบัน ก่อนใช้ snapshot เก่าไม่ได้ |
| A12 | re-OCR กลับหลังคนแก้ | ไม่ทับค่าคนและไม่เปลี่ยนยอดที่ผ่าน review เงียบ ๆ |
| A13 | invoice ตามมา / refund หลังจ่าย | ไม่สร้างซื้อซ้ำและไม่แก้ ledger/paid history ผ่าน source attachment update |
| A14 | ผู้ใช้ไม่รู้ ปิดหน้า กลับใหม่ | source ที่เก็บแล้วไม่หาย กลับงานเดิมได้และเข้าใจว่ายังไม่ได้ส่ง/อนุมัติ/จ่าย |
| A15 | cross-company/branch/actor หรือ child แอบอ้าง group | API ปฏิเสธโดยไม่เปิดเผยข้อมูลนอกสิทธิ |
| A16 | รูปอื่นของ order เดิมเข้าอีกกลุ่ม | duplicate candidates เชื่อม seller/order/evidence identities; ไม่แก้ด้วยการสร้าง group ID ใหม่ให้ใช้ยอดซ้ำ |
| A17 | พนักงานจ่าย 1,290 ส่วนบริษัท 810 ไม่มีใบเสร็จและเข้าเกณฑ์ | สร้าง derived source รอใบรับรองได้แต่ยังเบิกไม่ได้; ใบรับรองระบุ 810 พร้อมอ้างยอดจ่ายรวม/การจัดส่วน เมื่อ ISSUED และผ่าน resolver จึงส่ง full-source claim 810 โดย issuance ไม่บันทึกบริษัทคืนเงิน |
| A18 | บางร้านมีใบเสร็จ บางร้านไม่มี | ใช้ใบเสร็จร้านที่มีและทำใบรับรองเฉพาะ source ที่เข้าเงื่อนไข; ทุกเอกสารกลับชุดเดิม ไม่มีใบรับรองเหมาทั้ง checkout |
| A19 | มีใบเสร็จใช้ได้ แต่ไม่มีใบกำกับ VAT / order ยังไม่จ่าย | ไม่สร้างใบรับรองอัตโนมัติจากการไม่มีใบกำกับหรือข้อความ order; แสดงเส้นทางเพิ่มหลักฐาน/เก็บไว้ตามจริง |
| A20 | COMPANY certificate issue/retry แล้วกลับ expense | payment ที่ issuance บันทึกเกิดครั้งเดียว; paid=0/full/partial ผ่าน guard ตาม §12.4 โดย partial ถูกบล็อกทั้ง issuance ไม่ rewrite history หรือเติมจ่ายเพื่อผ่าน |
| A21 | DIGITAL/PAPER และ payer identity | ลงนาม/ตรวจรับตามนโยบาย; paper ที่ไม่มี verified payer-account link ยังไม่ส่งเบิกคืนในระบบ และไม่จับคู่จากชื่อหรือ uploader |
| A22 | แก้ selection/ส่วนลด/ผู้จ่ายหลัง preview/sign/issue | preview เก่าหมดอายุหรือเข้ากระบวนการแก้เอกสารเดิมตามสถานะ ไม่ย้ายลายเซ็น/approved certificate ไป scope ใหม่ |
| A23 | L03 ระบุ Paid by QR แต่ยังมีปุ่ม Transfer | อ่านเป็น method กับ order รอชำระ ไม่สร้าง payment หรือเปิดใบรับรองโดยถือว่าจ่ายแล้ว |
| A24 | S06 order 45,900 กับใบเสร็จร้าน 47,900 | เก็บสองยอดตามชนิดเอกสาร เชื่อมการซื้อเดียว ไม่สร้างรายจ่ายเพิ่มหรือส่วนลด 2,000 โดยไม่มีหลักฐาน |
| A25 | L14 subtotal รวมส่ง; S15 tax summary ก่อนส่วนลด | L14 net paid 184.80 ไม่บวกส่งซ้ำ; S15 total 611.51 ไม่ใช้ 637.51 เป็นยอดจ่าย และไม่บวกตารางภาษีซ้ำ |
| A26 | T08/T09 history สอง order; T11 สอง panel ของ order เดียว | แยกสอง order ที่ซื้อคนละวัน แต่ไม่เพิ่มสินค้าเสื้อกั๊กซ้ำเพราะปรากฏใน panel คืนสินค้า |
| A27 | S12 qty2/1/2, S15 ชื่อซ้ำ29สินค้า+ส่ง, T02 1แถม1 | นับแถว/จำนวน/variant ตามหลักฐาน ของแถมไม่เพิ่มยอด; ไม่ deduplicate ด้วยชื่อหรือคูณ bundle description ซ้ำ |
| A28 | S04/T15 ส่วนลดพับ; L02 ยอดท้ายตัด; S14 ไม่มีค่าส่ง | known total ไม่ทำให้ breakdown known; inferred total แยกจาก observed; missing shipping ไม่เปลี่ยนเป็น0 |
| A29 | T14 รีวิวรับคูปอง; X-S03 Coins to be earned | ไม่ลด payable หรือเพิ่ม tender จาก reward ในอนาคต |
| A30 | X-T01 timelineขั้นอนาคต; X-L03/X-T02 คืนเข้าwallet | ไม่อ่านขั้นสีเทาเป็น completed; แยก platform refund กับ wallet credit/withdrawal/bank confirmation; ไม่สร้าง fee ปิดส่วนต่าง |
| A31 | S11/T05 BNPL หรือเอกสาร MY/SG/ID/VN/PH | เก็บค่า/สกุล/ภาษีตามต้นฉบับและบอกขอบเขตที่ยังไม่รองรับ ไม่แปลงเป็น THB/ภาษีไทยหรือเงินสำรองจ่ายสดเอง |
| A32 | ภาพระบุวิธีจ่าย/ชื่อผู้รับสินค้า แต่ผู้จัดทำไม่ใช่ผู้จ่าย | ไม่จับคู่ requester จาก uploader, recipient name หรือบัตรที่ปิดเลข; ขอ actual payer binding ที่ server ตรวจตาม D06; ไม่เปลี่ยน creator และไม่บังคับใบรับรองนอก eligibility |
| A33 | T07 มีปุ่ม Receipt แต่ยังอยู่หน้าorder | จัดชนิดเอกสารจากเนื้อหาที่เปิดจริง ไม่อ้างว่าได้ใบเสร็จ/ใบกำกับจากข้อความปุ่ม |
| A34 | X-S03 ยอดสองร้านไม่ตรงยอดcheckoutที่แสดง | เก็บ mismatch และ scope ที่รู้ ไม่สร้างร้าน/สินค้า/ส่วนลด/ค่าธรรมเนียมเพื่อปิดยอด; ไม่เปิด paid-expense/certificate จาก checkout |
| A35 | เพิ่มภาพหน้า2/สลิป/ใบเสร็จที่ตามมา และเปลี่ยนไฟล์ที่ผิด | การเพิ่มไม่ retire ภาพเดิม; เปลี่ยนเฉพาะไฟล์ที่เลือกตามสิทธิ/retention; ต้นฉบับที่ source/certificate อ้างยังดูได้ |
| A36 | เลือก4ไฟล์ ส่งสำเร็จ2ไฟล์แล้วเน็ตหลุด/ปิดหน้า | แสดงสถานะตามจริงต่อไฟล์; กลับงานเดิม retryเฉพาะส่วนค้างด้วย identity เดิม ไม่สร้าง4expenseหรือคิดอ่านใหม่ทั้งหมด |
| A37 | มี41สินค้า หรือ1แถวอ่านไม่ออกแล้ว reader ยุบเป็นsummary | รักษาภาพ/ข้อเท็จจริงที่อ่านได้และแจ้งitem completeness; ห้ามใช้summaryแทนการเลือก/แบ่งสินค้ารายตัว |
| A38 | client/worker/APIเก่าหรือraw APIพยายามใช้capture-only/unknown schema | ทุก consumer มี compatibility guards หรือถูกกันไม่ให้เข้าถึงข้อมูลใหม่ก่อนเปิด intake; raw API ปฏิเสธ final mutation ที่ไม่รองรับ ไม่ลดรูปเป็น ordinary expense แล้ว confirm/pay/claim |
| A39 | parentยอด1,290 กับeligible sources และclaim projection | list/count/export/บัญชีแยกงานรับหลักฐานกับเอกสารการเงิน; ยอดบริษัทไม่ถูกนับparent+source+projectionซ้ำ |
| A40 | ใบรับรองร้านAออกแล้ว ร้านBรอลงนาม/เกิดข้อผิดพลาด | แสดงความคืบหน้ารายsource ทำต่อB; ไม่เซ็น/ออก/จ่ายAซ้ำ ไม่ย้อนสถานะAเพราะretryทั้งกลุ่ม และไม่แสดงทั้งชุดเสร็จ |
| A41 | เลือกทั้งหมดเป็นส่วนตัว หรือยอดส่วนบริษัทเป็น0 | เก็บผลว่าไม่มีเงินส่งต่อและจัดการหลักฐานตาม retention/access ที่ D08 กำหนด ไม่เก็บไม่สิ้นสุดโดยปริยาย; ไม่สร้าง expense/claim/certificate ยอด0; unknown ไม่ถูกนับเป็น0 |
| A42 | order31ส.ค. จ่าย1ก.ย. ใบเสร็จ3ก.ย. อัปโหลด5ก.ย. | เก็บวันที่แต่ละเหตุการณ์แยกกัน; expenseDateต้องมีที่มาและreviewตามปลายทาง ไม่ใช้วันอัปโหลดทับหรือเดารอบบัญชี |
| A43 | AI quotaหมดกลางชุด/responseหาย/re-readเฉพาะหน้า | ไฟล์ที่เก็บแล้วไม่หาย ผลอ่านเดิมใช้ต่อได้; lost-response retryใช้attemptเดิม; ค่าอ่าน/สิทธิ retryตามgovernanceเดิม ไม่คิดจากจำนวนchildที่สร้าง |
| A44 | รวม/แยกกลุ่มหลังเริ่มลงนาม หรือภาพเดิมเข้าอีกกลุ่ม | ป้องกันย้ายconsumed source/ย้ายลายเซ็น; correct/reverseตามสถานะ; valid sibling scopes ไม่ถูกตัดสินซ้ำเพราะใช้ภาพเดียว ขณะที่unrelated aliasยังถูกกัน |
| A45 | LINEมี2งานค้าง ภาพมาช้า/ผู้ส่งต่างคน/เปลี่ยนสาขา | ผูกงานด้วยบริบทและidentityที่ตรวจได้; ถ้าไม่ชัดให้เลือกงาน ไม่รวมจากเวลาใกล้กันหรือแก้ร่างล่าสุดเอง |
| A46 | ผู้มีสิทธิเห็นchildแต่ไม่มีสิทธิดูoriginal group/ไฟล์ | deep link/download/export/LINEต้องตรวจสิทธิหลักฐานจริง ไม่ขยายสิทธิเพราะlineage; ไม่อ้างว่าซ่อนข้อมูลส่วนตัวจากการตัดยอดเบิก |
| A47 | ปิดการรับfeatureใหม่ขณะมีงาน/เอกสารที่ทำไปแล้ว | หยุดintakeตามcapability แต่ยังอ่าน/กู้คืน/ทำcorrectionตามสิทธิผ่านเวอร์ชันที่รองรับ; ไม่มีfallbackให้ระบบเก่าใช้ยอดcaptureลงเงิน |
| A48 | คนแก้กลุ่ม/ส่วนบริษัท/ผู้จ่ายระหว่างworkerอ่านหน้าอื่น | ผลเก่าเก็บเป็นobservationแยกหรือstale ไม่เขียนทับreview; การเปลี่ยนที่มีผลต่อเงินทำให้previewที่เกี่ยวข้องใช้ไม่ได้ก่อนfinal action |
| A49 | R7-02 cash500/change432 | ยอด68; ไม่สร้างจ่าย500 |
| A50 | R7-01/RL-02 ส่วนลดและsavings summary | ลดครั้งเดียว รักษาscope/แถวอ้างอิง |
| A51 | RL-02 coins/card | document222 กับsettlement44+178และpoints balanceแยก; ไม่auto-approve reimbursement |
| A52 | RB-01 void59/−59/53 | saleใหม่53; ไม่ทำเป็นcoupon/refundนอกหลักฐาน |
| A53 | RM-01 weights/pack/tax codes | quantity/UOM/packไม่คูณซ้ำ, tax groupและยอดรวมถูก, codeไม่กลายเป็นrate |
| A54 | RB-02/RB-03 สองใบในภาพ | แยกdocument/transactionและsame-file lineage ไม่รวมเป็นซื้อเดียว |
| A55 | R7-03 + ใบเดิม / RM-01 replacement reference | evidenceมาทีหลังไม่เพิ่มexpense/claim/paymentซ้ำ |
| A56 | RC-01 coupon0, discount−10, queue21 | ยอด35; ไม่สร้างสินค้าคูปองหรือใช้เลขคิวเป็นreceipt ID |
| A57 | RC-02 current/balance/expiring points | ไม่แปลงแต้มเป็นยอดเงินหรือpayer identity |
| A58 | RL-01 ฉลากต่างยอดบิล | เก็บsource conflict ไม่ปรับยอดตามป้ายโดยเดา |
| A59 | ใบยาว>40/ต่อภาพ/จาง — ยังขาดfixtureจริง | completenessตรงภาพ, ไม่ให้แบ่งส่วนตัวจากitem blockที่หาย, save/recoveryผ่าน |
| A60 | receipt lost/abbreviated/full/certificate — ต้องมีbundleที่ได้รับสิทธิ์ | recoveryถูกชนิด; ใบรับรองไม่แทนtax invoice; late document/correctionไม่จ่ายซ้ำ |
| A61 | native PDF/scanned PDF/app screenshot/print-order PDF | แยกdocument typeกับcontainer; ต้นฉบับไม่เปลี่ยน, text/OCRมีprovenanceและขัดกันแล้วไม่false-ready |
| A62 | signed/timestamped/ordinary PDF + validation timeout | ผลตรวจแยกmethod/pass/fail/not-checked/unavailable; อ่านได้ไม่เท่ากับตรวจผ่าน, ตรวจผ่านไม่เท่ากับอนุมัติภาษี/เบิก; ใช้fixtureที่ไม่ได้redactทับsigned original  baselineพิสูจน์not-checked/unavailable; pass/failตามmethodต้องมีfixtureเมื่อเปิดautomatedverificationตามD09 และยังห้ามอ้างว่ามีตัวตรวจจากbaselineเพียงอย่างเดียว |
| A63 | paper→screenshot→full PDF→corrected/credit document | เสนอผูกซื้อเดิมโดยไม่เพิ่มยอด; ความต่างเลขเอกสาร/issuer/ยอดเข้าตรวจและcorrectionตามlock ไม่overwriteหลักฐานหรือเงินที่postแล้ว |
| A64 | password/corrupt PDF, เกินขอบต้นฉบับ10MiB, expired link, pending email | saved draftยังอยู่, มีทางเพิ่มหลักฐาน/กรอกต่อ/ขอร้าน; ไม่ปล่อยpasswordสู่log/prompt ไม่สร้างใบรับรองหรือแอบอนุมัติเพื่อข้ามerror |
| A65 | multi-page PDF, multiple receipts, attachment pages, missing last page | document/page coverageถูกต้อง; ไม่จำกัดหนึ่งไฟล์เท่ากับหนึ่งซื้อ และไม่ใช้summaryแทนcomplete item reviewโดยไม่แจ้ง |
| A66 | e-Tax email evidence/QR URL/text-layer instruction | เก็บเฉพาะหลักฐานที่มีสิทธิ, tenant/accessครบ; contentเป็นข้อมูลไม่ใช่คำสั่ง, ไม่fetch arbitrary URL/ส่งไฟล์ออกเอง; ข้อมูลประกอบวิธีตรวจไม่สูญหาย |
| A67 | PDF4,000,000 /4,000,001 /4,194,304 /4,194,305 /10,485,760 /10,485,761bytes | FE/BE/error copyใช้ขอบต้นฉบับ10MiBตรงกัน; ภายในขอบให้เข้าautomatic pipelineโดยวัดขอบแต่ละAI callแยก, ไม่manual-onlyเพราะ4MB; เกินขอบแจ้งตามจริงโดยคงงานเดิม ไม่re-encodeทับต้นฉบับหรืออ้างว่าเก็บไฟล์สำเร็จ |
| A68 | LINE ส่ง PDF เปล่า/มี caption, หลายใบในภาพ, ไฟล์เข้าช้าและมีหลายงาน | เก็บ bytes/target ที่อนุญาตก่อนบอกเก็บแล้ว; clarification ผูกงานและไฟล์เดิม ไม่สร้าง expense ก่อนรู้ scope; ไม่ยกเลิก MULTI_DOCUMENT guard ใน single-expense contract |
| A69 | ใบซื้อเดียวกันผ่าน LINE / อัปโหลดใหม่ / เปลี่ยนใบเสร็จ | facts/ยอด/unknown/completeness/verification semantics และ policy version ตรงกัน; ต่างได้เฉพาะช่องทางกับขนาดที่มีสัญญาชัด ไม่มี prompt แยกจนอ่านคนละยอด |
| A70 | เปลี่ยนไฟล์สำเร็จ แต่ AI fail/quotaหมด/ผลตอบกลับหาย/ไม่มีสิทธิอ่าน | ไฟล์ใหม่และค่าที่ตรวจเดิมยังอยู่พร้อมที่มา; failedแล้วให้ลิงก์กรอกบนWebรายการเดิม ไม่เสนอOCRซ้ำหรือสร้างใหม่; unknownผลต้องตรวจสถานะก่อนและไม่แสดงverifiedจากไฟล์เก่า |
| A71 | สองแท็บเปลี่ยน A→B และ A→C; OCR A/B กลับช้า; permission ถูกถอดระหว่าง upload | complete ต้องตรวจ expected target attachment และ revision ที่ผู้ใช้เริ่มเปลี่ยน; มี winner เดียวหรือแจ้ง conflict ไม่ให้ stale upload ทับ; stale OCR/notice/cache ไม่เปลี่ยนผลของไฟล์ปัจจุบัน |
| A72 | เปลี่ยน/แนบเพิ่ม/ลบใน DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION, CONFIRMED/VOIDED, มี claim หรือใบรับรองลงนามแล้ว | ใช้ตาราง §16.4; อนุญาตตาม server guards และ correction เดิม; ทุกผล deny/conflict มีทางกลับงานที่ถูกต้อง ไม่ retire หลักฐานที่ใช้ลงนามหรือจ่ายแล้ว |
| A73 | ผู้ใช้แก้ยอด/ภาษีไว้แล้ว เปลี่ยนเป็นใบคนละร้านหรือเอกสารใหม่มีช่องว่าง | ถาม/แสดงความต่างก่อนยอมรับ facts ใหม่; ไม่เอา vendor/item/tax/payment จากสองซื้อปนกัน ไม่เติมช่องว่างด้วยค่าจากเอกสารเก่าโดยไม่มี provenance; งานใหม่ต้องเริ่มตามสิทธิและไม่ทำรายการเดิมหาย |
| A74 | PDF provider ไม่รองรับ/ตัวอ่านตัดข้อความ/หลายหน้า/ไฟล์ติดรหัสทั้งสามทาง | แยก stored กับ readable; แสดงสาเหตุ/ทางกรอกต่อหรือแนบไฟล์อื่น; ไม่ใช้ first-page/summary เป็น complete และไม่เปลี่ยน provider policy หรือส่งข้อมูลออกเพื่อแก้ error โดยปริยาย |
| A75 | PDF10,000,000/10,485,760bytes ทั้งtext/scanned/mixed pages ผ่านLINE/อัปโหลด/เปลี่ยนใบเสร็จ | ระบบรับต้นฉบับและเริ่มautomatic bounded readingทั้งไฟล์; ขนาดเกิน4MBเพียงอย่างเดียวไม่คืนunsupported/manual-only; ส่งผลที่อ่านได้พร้อมข้อขัดกันเข้าสู่review; ถ้ามีหน้าค้างหรืออ่านไม่สำเร็จต้องเป็นpartial ไม่อ้างอ่านครบ |
| A76 | PDFหน้าเดียว10MBหรือหน้าหนึ่งยังเกินขอบproviderหลังแยก | renderสำเนาและแบ่งregions/tilesที่ตรวจขนาดจริง พร้อมoverview+พิกัด/ส่วนซ้อน; อ่านตัวเลขเล็ก/ภาษาไทยได้ตามgolden fixture ไม่ลดภาพจนข้อมูลหาย; ไม่เปลี่ยนต้นฉบับ |
| A77 | headerร้านหน้า1, สินค้าหลายchunk, totalท้ายใบ และมีหลายใบในPDF | assembleobservationsตามdocument/page/region+stableline IDs ไม่บวกsubtotal/totalซ้ำหรือmergeจากชื่อสินค้า; cross-pageidentity/void/ส่วนลดและunknownมีprovenanceก่อนallocation |
| A78 | workerหยุดหลังอ่านบางส่วน/retryผลหาย/ผู้ใช้เปลี่ยนprimaryหรือสิทธิระหว่างอ่านไฟล์10MB | ผลchunkที่สำเร็จยังอยู่; resumeเฉพาะงานค้างและreuseattemptตามgovernance; ไม่สร้างexpense/claimซ้ำ; rechecktenant/actor/revisionก่อนapply/notifyและstaleไม่ทับใหม่ |
| A79 | 10MBมีหลายร้อยหน้า/รูปขยายใหญ่มาก/เกินtoken-budgetหรือquotaหมดกลางงาน | จำกัดpage-per-batch/pixels/memory/time/concurrencyและขนาดHTTPจริง; ทำต่อด้วยcheckpointหรือแสดงpaused/incompleteตามเหตุจริง ไม่ตัดหน้าเงียบหรือบังคับลูกค้าแบ่งPDFเพราะ4MB; sizeไม่ใช่unlimitedbudget |
| A80 | e-Taxต้นฉบับ10MBถูกsplit/rasterเพื่ออ่าน; encrypted/corruptบางส่วน | hash/bytes/versionต้นฉบับคงเดิม; signature/timestampตรวจoriginalเท่านั้น; derivativeมีlineageไม่อ้างเป็นต้นฉบับ, errorชี้หน้า/สาเหตุและเก็บผลที่สำเร็จ; ไม่ออกใบรับรองอัตโนมัติ |
| A81 | PDF 2/5/10/20 หน้า ทั้ง native/scanned/mixed และใบเดียวต่อหลายหน้า | มี manifest ครบทุกหน้าเรียงตามไฟล์และเลขหน้าที่พิมพ์เป็นหลักฐานแยก; header/footer/carry-forward ไม่สร้างยอดหรือรายการซ้ำ; ไม่ใช้เพดาน 17 หน้าของ certificate preview เป็นเพดาน reader; ผ่านทั้งสามทาง |
| A82 | หน้าเปล่า/อ่านล้มเหลว/เลขหน้าขาด และหลายใบเสร็จรวมใน PDF เดียว | แยกcovered-blank/failed/suspected-missingและfile coverage/document completeness; groupingไม่แน่ชัดให้ตรวจหน้าที่เกี่ยวข้อง ผลอ่านบางส่วนเปิดกรอกต่อบนWebงานเดิมพร้อมแนบหน้าที่ขาด; ไม่รวมคนละบิลหรือเสนอuser reread |
| A83 | ทุกknown errorและunknown errorผ่านLINE/อัปโหลด/เปลี่ยนใบเสร็จ | UXE-01–27บอกปัญหา+สถานะจริง+actionที่มีสิทธิ์; failed readingใช้saved-file notice+ลิงก์กรอกบนWebงานเดิมตาม§17.6; ไม่สร้างerror reread/manualchatflowหรือเผยrawerror |
| A84 | ผลบันทึก/สร้างใบเบิก/ออกใบรับรองหาย, กดซ้ำ, cancel, สิทธิหรือsourceเปลี่ยนระหว่างerror | ตรวจสถานะด้วยoperationเดิมก่อนretryผลที่ไม่ทราบ; ไม่สร้าง/จ่าย/นับอ่านซ้ำ, source/สิทธิตรงตอนกด, retryเฉพาะส่วนค้าง, cancelไม่เท่ากับลบไฟล์หรือถอนเอกสารการเงิน |
| A85 | ผู้ใช้40+พบอ่านไม่สำเร็จแล้วกดลิงก์กรอกต่อบนWeb/กลับวันหลัง | ลิงก์ตรงงานเดิมพร้อมไฟล์/partialfacts; loginแล้วกลับเป้าหมาย, มือถือกรอกได้, ไม่อัปโหลด/สร้างใหม่ ไม่ต้องเลือกรายการจากlistเอง; เข้าใจว่าเป็นร่างไม่ใช่ส่งเบิกหรือจ่ายแล้ว; usabilityตามD05 |
| A86 | LINEถามย้อนหลังว่าไฟล์เมื่อกี้ส่งไม่ได้/ทำไมอ่านไม่ได้/ต้องส่งใหม่ไหม หลังrejectionหรือrestartโดยยังไม่มีexpense | ตอบจากreason/stage/size-limit-at-attempt/persist-stateที่APIตรวจสิทธิ์และอ้างอิงattemptเดิมได้; สาเหตุoversizeไม่กลายเป็นdownloaderrorทั่วไป; คำถามอย่างเดียวไม่OCRซ้ำ/สร้างร่าง/แก้เงิน |
| A87 | มีหลายไฟล์หรือหลายงาน/ไฟล์ชื่อซ้ำ/ไม่มีevent/retentionหมด/สิทธิ์เปลี่ยน/ข้อความLINEมาช้า | เลือกเฉพาะattemptที่actor/company/chatเข้าถึงได้; ผูกเป้าหมายด้วยreferenceที่serverตรวจได้ ไม่เลือกlatestผิดงาน; ไม่พบข้อมูลหรือlookupล่มตอบต่างกันและไม่เดาสาเหตุ/เปิดเผยงานอื่น |
| A88 | ผู้ใช้ถามเหตุผลขณะAI/provider/quotaไม่พร้อม, ถามซ้ำหลังrecoveryหรือlimitเปลี่ยน, หรือส่งข้อความแจ้งผลไม่สำเร็จ | ใช้คำตอบสถานะจากserverและfallbackเดิมเมื่อเหมาะสม; แสดงเหตุที่เกิดตอนนั้นแยกสถานะปัจจุบัน; ไม่ต้องอ่านไฟล์อีกเพื่ออธิบายerror ไม่ให้คำตอบถามสถานะกลายเป็นคำสั่งretry และไม่อ้างส่งข้อความถึงแล้วหากdeliveryไม่สำเร็จ |

การรับ feature ต้องมีหลักฐาน UX 40+ และ integration/browser จริงสำหรับแต่ละ critical path pilot ที่อ่าน draft ได้ยังไม่แปลว่า expense/reimbursement end-to-end ผ่านทั้งหมด

## 11. สิ่งที่ยังต้องตัดสินก่อน implementation ส่วนที่เกี่ยวข้อง

- Company policy: shared discount/shipping allocation, personal coins, purchase/refund eligibility และ tax treatment ที่ต้องอาศัยเอกสารจริง
- Representative source bundles และ expected outputs ที่ตรวจโดยคน รวมขอบเขต supported layouts/limits; เพิ่ม retail/electronic ทั้งห้าแบรนด์ และแยก redacted extraction fixtures จาก unaltered verification fixtures
- D09: วิธี/ขอบเขตตรวจ electronic evidence และ lifecycle ผลตรวจ; baseline แสดง not-checked/unavailable ตามจริง ไม่อ้าง signature passed จาก OCR; การตรวจอัตโนมัติต้องมี implementation/evidence เพิ่ม
- D02/D06 ต้องรวม replacement expected attachment/revision, state matrix, PDF/provider capability และ recovery parity ครบสามทางตาม §16
- Persistence/entry-draft mapping ที่เล็กที่สุดแต่บังคับ capture-only, source lineage, uniqueness และ locks ทุก financial entry point ได้
- ขอบเขต company-funded mixed personal และ employee-funded claimable-tax ที่ต้องใช้ accounting flow เพิ่ม; ห้ามอ้าง complete ก่อนมีเส้นทางจริง
- การแทน actual payer บน derived expense source ที่ resolver เดิมรับได้ (ใช้ creator เดิมได้เฉพาะเมื่อเป็นผู้จ่ายจริงที่ยืนยันแล้ว หรือเพิ่ม server-verified payer binding ตาม D06) ใบรับรองใช้ระบุตัวผู้จ่ายได้เฉพาะเมื่อมีเหตุเข้าเกณฑ์ §12 อยู่แล้ว ห้ามบังคับทำใบรับรองเพียงเพราะคนอัปโหลดไม่ใช่ผู้จ่าย และห้ามเขียน creator/audit ย้อนให้เป็นผู้จ่าย
- กติกา review tax classification ตามหลักฐานและสิทธิ พร้อมทางพักเมื่อข้อมูล/route ไม่รองรับ โดยไม่บังคับ NON_CLAIMABLE หรือ VAT=0 และการแตกบรรทัดที่ผ่าน totals identity ของ vatMode ปลายทาง
- Permission key/entitlement ของ capture group, business allocation และ derived source generation (IG15)
- PDPA: ฐานการประมวลผล/ROPA/ระยะเก็บของกลุ่มหลักฐานที่จบแบบ “ส่วนตัวทั้งหมด” หรือถูกทิ้งค้าง (A41 สั่งให้เก็บหลักฐานไว้) รวมการส่งภาพที่มีข้อมูลส่วนบุคคลเข้า AI provider ตาม processor register เดิม
- ทางเลือกที่แคบกว่า capture-only discriminator: ไม่สร้าง ExpenseRecord ตั้งแต่ init สำหรับ group intake ต้องบันทึกเหตุผลที่เลือก/ไม่เลือกไว้ใน plan D01 ก่อนลงมือ

ข้อเหล่านี้ไม่ขวางการใช้ spec เป็นจุดตั้งต้น แต่ห้าม implement financial decisions ที่ยังไม่ชัดโดยเดา policy ไม่มีการเปลี่ยน status ของ marketplace backlog หรือ deployment authorization จากเอกสารนี้

## 12. ใบรับรองแทนใบเสร็จรับเงินเป็นส่วนหนึ่งของ solution

ผู้ใช้ย้ำให้รวม flow นี้ไว้ใน baseline ใช้ [Company/personal funding spec](substitute-receipt-company-payer-spec.md), [Paper signing spec](substitute-receipt-paper-signing-spec.md), [Expense/certificate edit sync](substitute-receipt-expense-edit-sync-spec.md) และ [Hub actions](substitute-receipt-hub-actions-spec.md) เดิม โดยเพิ่มเฉพาะการเชื่อม eligible source และทางกลับไปงานเดิม

### 12.1 Evidence decision ต่อ source ที่ตรวจแล้ว

| สถานการณ์ | ทางที่เสนอ |
|---|---|
| มีใบเสร็จ/เอกสารที่ใช้ได้ตามการตรวจ | ใช้เอกสารนั้นใน expense/claim ตาม eligibility ไม่เพิ่มใบรับรอง |
| จ่ายจริงเพื่อบริษัท ไม่มีใบเสร็จหรือขาดสาระสำคัญ และผ่านกติกาเดิม | เสนอ “จัดทำใบรับรองแทนใบเสร็จ” พร้อม “เพิ่มใบเสร็จ” และ “เก็บไว้ก่อน” ตามสถานะ |
| มีเพียง order ที่ยังไม่จ่าย/COD pending/ข้อเท็จจริงยังไม่ชัด | เก็บร่างและขอ facts ที่จำเป็น; ไม่ใช้ใบรับรองทำให้ order กลายเป็นรายจ่ายที่จ่ายแล้ว |
| มีใบเสร็จใช้ได้ แต่ยังไม่มีใบกำกับภาษีสำหรับ VAT | แสดงเส้นทางขอ/แนบใบกำกับจากร้านและ tax review; การไม่มีใบกำกับอย่างเดียวไม่ใช่เหตุบังคับทำใบรับรอง |
| มีใบรับรองเดิมตรง source/scope/เวอร์ชัน | เปิด/ใช้เอกสารเดิมที่มีสิทธิ; ถ้า scope ไม่ตรงให้แก้ตามวงจรเอกสาร ไม่สร้างซ้ำหรือย้ายลายเซ็น |

Marketplace/retail screenshot หรือ PDF ที่ยังตรวจ electronic ไม่ได้ ไม่ได้ต้องทำใบรับรองทุกไฟล์ การเสนอขึ้นกับข้อเท็จจริงการจ่าย ความไม่พร้อมของใบเสร็จ และ policy/eligibility เดิม; ผู้ใช้ไม่ต้องวินิจฉัยชนิดเอกสารเองเพื่อเริ่ม capture

เพิ่มทางกู้เอกสารจากร้านตามช่องทางและวันที่ตรวจคู่มือ: ขอเต็มรูป/ดาวน์โหลดไฟล์เดิม/ใบแทนใบกำกับจากผู้ออก แยกจากใบรับรองภายในมั่งมี; เอกสารที่ตามมาแนบกับซื้อเดิมโดยไม่สร้างยอดซ้ำ หากเปลี่ยน facts หลังลงนามให้เข้ากระบวนการ correction เดิม ไม่ใช้ปุ่มเปลี่ยนใบเสร็จข้ามขั้นตอนนี้

### 12.2 ข้อมูลและขอบเขตการออก

- สร้างใบรับรองบน eligible source ที่ตรวจแล้วตามผู้รับเงิน/ขอบเขตเอกสารที่รองรับ ไม่สร้างบน capture-only parent ที่รวมหลายร้านหลายผู้รับเงิน
- เติมจากข้อมูลเดิม: บริษัทจดทะเบียน/สาขา รายการบริษัท ยอดที่จัดสรร ชื่อผู้รับเงินที่มีหลักฐาน วัน/วิธีจ่าย แหล่งเงิน ผู้รับรองที่ยืนยันแล้ว และหลักฐานอ้างอิง ทุก field ยังผ่าน validator และความครบถ้วนเดิม
- ขอเฉพาะข้อมูลที่ใบรับรองต้องใช้เพิ่ม เช่น เหตุผลที่ไม่มีใบเสร็จและคำรับรองการใช้จ่ายเพื่อบริษัท ไม่เดาชื่อผู้รับเงินจริง วันที่ เลขภาษี ที่อยู่ หรือเหตุผลแทนผู้ใช้
- ช่องวัตถุประสงค์ทั่วไปของ expense ยังคง optional; การรับรองข้อเท็จจริงเพื่อออกใบรับรองเป็นข้อกำหนดเฉพาะของขั้นลงนามนั้น ต้องอธิบายเหตุผลและเก็บร่างได้
- กรณี original payment 1,290 แต่ใบนี้รับรองส่วนบริษัท 810 ให้ snapshot/preview แสดงความสัมพันธ์นี้ชัดและอ้าง allocation ไม่บอกว่าหลักฐานธนาคารแสดงยอด 810 หรือเปลี่ยนต้นฉบับ
- ไม่ดึงสินค้า/ยอดส่วนตัวเข้าใบรับรองบริษัท และไม่ให้ส่วนลดเดียวกันเกิดในใบรับรองหลาย source เกินยอดต้นทาง
- หากมีหลายใบที่จำเป็น UI แสดงจำนวนใบ/ร้าน/สถานะในงานเดียวและ reuse ข้อมูลบริษัท/ผู้จ่ายที่ยืนยันแล้ว แต่ผู้ลงนามยังต้องตรวจ scope และทำ acknowledgements ตามแต่ละเอกสาร ไม่มีการเซ็นหรืออนุมัติรวมให้โดยปริยาย
- Parent multi-document classification ห้ามถูกคัดลอกเป็น source ร้านเดียวแล้วลบ blocker เฉย ๆ ต้องมี derived-scope validation ที่พิสูจน์ข้อมูลรายจ่ายของ source นั้นครบก่อนเปิด certificate path

### 12.3 ลงนามและกลับมาทำต่อ

- ใช้ wizard เดิมหลังตรวจ facts เลือก DIGITAL หรือ PAPER ตามสิทธิ/ความสามารถเดิม พร้อมลิงก์กลับไป source/กลุ่มเดิม
- DIGITAL: ผู้รับรองจริงลงนามผ่านบัญชีตน และผู้อนุมัติตามนโยบาย; ผู้จัดทำ/AI ไม่รับรองแทน
- PAPER: ดาวน์โหลดแบบเดิม เซ็นจริง อัปโหลดฉบับลงนาม และผู้มีสิทธิตรวจรับ; การดาวน์โหลดหรืออัปโหลดอย่างเดียวไม่ถือว่า ISSUED
- ใบกระดาษที่ไม่มีบัญชีผู้รับรองรองรับการออกตามระบบเดิม แต่ไม่ทำให้เกิด verified reimbursement payee ในระบบ source resolver; คงขอบเขตไม่สร้างผู้รับเงินภายนอกหรือจับคู่จากชื่อ/upload account
- Issued certificate ที่ใช้ส่งเข้า reimbursement ต้องมี actual payer link ที่ผ่านกฎต้นทางปัจจุบัน และ fundingSource PERSONAL_ADVANCE ตรง requester
- LINE ใช้ capture/prepare/handoff ตามสิทธิเดิม ลงนาม/อนุมัติใน web; การเพิ่มคำแนะนำ “ทำต่อที่ใบเบิก” อยู่ใน expense/capture journey ที่มีสิทธิ ไม่ทำให้ certificate issuance สร้างใบเบิกหรือจ่ายเงินคืนอัตโนมัติ

### 12.4 ผลต่อเงิน ภาษี และการแก้ย้อนหลัง

- COMPANY: flow ออกใบรับรองเดิมอาจบันทึกบริษัทจ่ายเต็มเมื่อยังไม่มี payment และเข้าเงื่อนไข จึงต้องใช้ funding route/lock/idempotency เดียวกับ source ทั้งสาย ไม่ให้ capture handoff หรือ expense payment เติมซ้ำ กรณีจ่ายบางส่วนมาก่อน [assertFullSubstitutePayment](../../apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts:6) **บล็อกการออกใบทั้งใบ** (`substitute_full_payment_required`) ไม่ใช่ออกใบแล้วไม่เติมส่วนต่าง คงทางพัก/ตรวจประวัติจริง และทำ correction/reversal เฉพาะเมื่อข้อมูลผิดตามสิทธิและ audit เดิม ห้าม rewrite หรือเติมจ่ายเพียงเพื่อผ่าน guard; acceptance/fixture ของ W06 ต้องคาดหวังแบบนี้
- PERSONAL_ADVANCE: ออกใบรับรองไม่สร้าง ExpensePayment ของบริษัท ไม่ยืนยันว่าคืนเงินแล้ว และห้าม ordinary source confirm/payment ใช้ผิด route การคืนผ่าน reimbursement เดิมเมื่อผ่าน eligibility เท่านั้น
- Company-funded purchase ที่มีของส่วนตัวปนต้องแก้ accounting allocation ของเงินจริงก่อน issue/financial handoff หากยังไม่รองรับ ไม่ใช้ใบรับรองยอดบริษัทเพื่อซ่อนส่วนเงินบริษัทที่จ่ายส่วนตัว
- ใบรับรองคง supporting-evidence status ของระบบ ไม่สร้างสิทธิภาษีซื้อหรือรับรองหักรายจ่ายทางภาษีอัตโนมัติ VAT invoice ของร้านที่มีจริงยังเก็บแยกและใช้ tax-review route ที่รองรับ
- แก้สินค้า ส่วนบริษัท ส่วนลด วันที่ ผู้รับเงิน ผู้รับรอง หรือแหล่งเงินแล้ว invalidate preview/snapshot/signatures ตามวงจรเดิม เอกสาร ISSUED และ source ที่มี payment/JV/active claim ต้องใช้ correction/cancel/reversal ที่อนุญาต ไม่เขียนทับ
- ยกเลิกใบรับรองไม่ลบต้นฉบับหรือกลับรายการจ่าย/บัญชีเอง เก็บ history และใช้ hub actions เดิมที่แยก view/edit/cancel ตามสถานะ

Acceptance A17–A22 ต้องมีหลักฐาน real API/DB, rendered PDF และ browser ทั้งมือถือ/desktop รวมกรณีระงับ/กลับมาทำต่อ ก่อนอ้างว่า feature เชื่อมใบรับรองครบ ไม่จำกัด verification แค่การแสดงปุ่ม

## 13. ข้อกำหนดจาก public corpus และข้อมูลที่ต้องรู้

ชุดอ้างอิงมี 45 purchase/order cases จาก 43 หน้าแหล่งอ้างอิง: ไทย 21 ต่างประเทศ 24 และเคสเสริม 9 เคส มีหลายหน้าต่อบิล ภาพ order ที่ยังไม่จ่าย/ยกเลิก และ screenshot ในบทความสอนใช้ด้วย ไม่ใช่ 45 ใบเสร็จรับเงินที่ยืนยันความแท้แล้ว และยังไม่ครอบคลุมชุดไทยหลายร้านที่จ่ายจริงครบสายทุกแพลตฟอร์ม รายละเอียดและ URL อยู่ใน [ทะเบียนหลักฐาน](../research/marketplace-buyer-public-corpus-2026-09-14-th.md)

### 13.1 ข้อมูลหลักและเจ้าของการตัดสิน

ตารางนี้เป็น logical contract ที่ต้องรักษา ไม่กำหนดให้เพิ่มทุก field เป็นคอลัมน์ ORM หรือแสดงทุกช่องต่อผู้ใช้ ต้อง map เข้าสัญญาเดิมและเลือก persistence ใน Phase 0

| กลุ่มข้อมูล | สิ่งที่ต้องเก็บเมื่อพบ | ที่มา / ผู้ยืนยัน |
|---|---|---|
| Document evidence | attachment/page/region หรือ exact span, document kind, locale/currency, layout completeness, source revision | extractor เสนอ; server ตรวจ reference และผู้ review แก้ได้ |
| Purchase identity | platform, checkout/order/suborder/item/package references ที่มีจริง, purchase group ภายใน | หลักฐาน; ห้ามใช้ group ID ภายในแทน platform checkout ที่ไม่ปรากฏ |
| Supplier identity | storefront, seller และ legal issuer แยกกัน, วันที่/เลขเอกสารแต่ละชนิด | หลักฐานร้าน/ใบเสร็จ; ไม่เติมข้อมูลตามชื่อแพลตฟอร์ม |
| Items | stable row identity, description, variant, quantity, unit price, extended amount, list/strike-through price, gift/bundle relation | source rows; ชื่อเหมือนกันอย่างเดียวไม่ใช่ duplicate |
| Monetary components | raw label, amount/currency, effect, scope, parent/child หรือ included-in relation, applied status | extractor อ่าน; deterministic validator ตรวจความสัมพันธ์ |
| Totals | merchandise/shipping/tax/document total, buyer payable และ reported paid total ตามขอบเขตที่แสดง | ต้นฉบับ; ไม่มี total กลางที่เขียนทับทุกชนิด |
| Payment evidence | method, current payment status, amount/time/reference, payer/funding evidence | label วิธีจ่ายไม่ใช่ proof of payment; actual payer ต้องยืนยันผ่านสิทธิระบบ |
| Refund evidence | requested/approved/processing/completed/current unknown, item scope, amount, destination, expected/actual dates, platform/bank evidence | แยกคำใน timeline ออกจาก event ที่เกิดจริง |
| Business selection | item/quantity บริษัทและส่วนตัว, reviewed allocation, policy/version | ผู้ใช้หรือผู้มีสิทธิ review; ไม่เดาจากประเภทสินค้า |
| Receipt sufficiency | เอกสารที่มี/ที่ขาด เหตุผล และ certificate eligibility ต่อ source | existing validators และผู้มีสิทธิ; AI ไม่รับรองความจริงแทนคน |
| Accounting readiness | tax classification, funding route, source/claim eligibility, unresolved reason | ERP policy/permission APIs; ไม่ใช่ model confidence |
| Audit | observed/inferred/policy-derived/human-reviewed, source references, revisions, actor/model/schema/policy version | server-authoritative history |

Monetary effect ต้องแยกอย่างน้อย charge, applied discount, tax included/additional/unknown, payment tender, future reward, refund, balance และ summary/reference ที่ไม่มีผลเพิ่มยอด รายการที่ไม่รู้ความหมายเก็บ unclassified และรอตรวจ ไม่ทิ้ง label ที่ไม่อยู่ใน dictionary

Scope อาจเป็น item, seller/order, shipping/package, checkout หรือ document; ต้องมีหลักฐานความสัมพันธ์ก่อนปันส่วน เช่น parent discount กับ child breakdown ต้องไม่เป็นสองรายการหัก การเห็นยอดไม่ตรงอย่างเดียวไม่พอให้สรุปว่าเป็น coupon, shipping หรือ rounding

Coins quantity กับ money equivalent เป็นคนละค่า; redeemed coins อาจอยู่ในส่วนลดตามหลักฐาน แต่ wallet balance/payment/refund credit มีอีกบทบาท ต้องระบุว่าใช้แล้ว/จะได้รับ/มีอยู่ในกระเป๋า/ได้รับคืน ไม่เลือกบทบาทจากคำว่า coins/cashback/balance เพียงอย่างเดียว

### 13.2 สถานะที่ต้องแยกจากกัน

- เก็บไฟล์สำเร็จ ≠ อ่านครบ ≠ ยอดตรง ≠ จ่ายจริง ≠ หลักฐานเพียงพอ ≠ มีสิทธิเบิก ≠ ลงบัญชี/จ่ายคืนแล้ว
- Purchase state (เช่น รอชำระ/จัดส่ง/ยกเลิก) และ payment state เป็นคนละแกน เพราะ order ยกเลิกอาจมีเงินออกที่ต้องตรวจเพิ่มได้
- Refund state และ destination แยกกัน; completed ในแพลตฟอร์มไม่รับรองธนาคารได้เงิน และ credit เข้า wallet ไม่ใช่ withdrawal สำเร็จ
- หลักฐานใหม่ที่ขัดกันไม่ถูกเลือกทิ้งโดยอัตโนมัติ เก็บ conflict พร้อม provenance; คำบอกเล่าของผู้ใช้และค่าที่อ่านจากภาพแสดงที่มาแยกกัน
- Summary UI แสดงสถานะและ action ที่มีผล ณ ขณะนั้น ไม่แสดง model score เป็นคำรับรอง “ถูกต้อง” และไม่ยุบทุกแกนเป็นสีเขียวเดียว

### 13.3 การอ่านและตรวจที่เสนอให้เริ่มทำ

1. รับไฟล์ด้วย flow เดิมและคงลำดับหน้า/source reference; ตรวจไฟล์ซ้ำและภาพที่เป็นหน้า/ส่วนต่อก่อนการเงิน
2. แยกพื้นที่เอกสาร/สินค้า/summary/timeline/โฆษณา พร้อม document kind และ scope; คำสั่งที่ฝังในรูปไม่ใช่คำสั่งให้ AI หรือ ERP ทำงาน
3. อ่าน raw facts และ evidence references; ไม่ให้ model แต่งชื่อผู้ออก วันที่ ผู้จ่าย หรือ breakdown ที่ถูกพับเพื่อเติม schema
4. Validate bounded output, row/page completeness, currencies, duplicate components และสมการแต่ละ scope ด้วย decimal ตามสกุล; คง reported rounding/tax ที่พิมพ์ และ flag เมื่อตีความไม่ได้
5. เปรียบเทียบเอกสารของ purchase เดียวโดยคง document total, buyer payable, payment และ refund คนละค่า; หลักฐาน invoice ภายหลังต้องไม่สร้างการซื้อใหม่
6. ถ้าอ่านพลาดที่แก้ได้ ให้อ่านซ้ำเฉพาะจุดภายใน budget; ถ้าต้นฉบับไม่มีข้อมูล ให้อยู่ unknown และใช้หน้าตรวจเดิมรับข้อมูล/เพิ่มภาพ/พัก
7. หลังคนยืนยัน facts และส่วนบริษัท ให้ ERP คำนวณ reviewed allocation และ eligibility; AI Gateway ใช้ permission-checked APIs/tools ตามสถาปัตยกรรมเดิม ไม่อ่าน/เขียน repository โดยตรง
8. เตรียมเอกสารและส่งต่อเฉพาะ route ที่ผ่านกฎข้อ 5, 9 และ 12 ทุกครั้ง retry และ source change ต้องร่วม exclusion/revision boundary เดียวกัน

ไม่ต้องเริ่มด้วย parser แยกทุก promotion ทุกแพลตฟอร์ม ใช้ schema กลางที่เก็บ label/scope/ที่มา และเพิ่ม mapping เฉพาะที่มีตัวอย่างรองรับก่อน ระบบที่อ่าน total ได้แต่ยังแบ่งคูปองไม่ได้ต้องบันทึกความสำเร็จสองระดับนี้ตรงจริง

### 13.4 UX ตั้งต้นที่ใช้ทดสอบกับคนอายุ 40+

หน้าตรวจเดิมแสดงตาม facts ที่มี เช่น “พบ 2 ร้าน • 5 รายการ”, “ยอดจ่ายรวมที่พบ”, “ส่วนของบริษัท”, “ผู้จ่าย” และรายการที่ต้องตรวจ การบอกจำนวนร้าน/รายการต้องระบุว่าอ่านยังไม่ครบเมื่อ source ถูกตัด ไม่ใช้คำว่าพบครบเพียงเพราะ model ส่ง JSON จบ

| ปัญหา | ข้อความตัวอย่าง | ทางทำต่อ |
|---|---|---|
| เห็นยอดorderแต่ไม่เห็นการจ่าย | “พบยอดสั่งซื้อแล้ว ยังไม่พบหลักฐานว่าจ่ายสำเร็จ” | เพิ่มหลักฐาน/ยืนยัน facts ตามสิทธิ/เก็บไว้ก่อน; ยังไม่ใช่ปุ่มบันทึก paid |
| สรุปเงินไม่ครบ | “ภาพนี้ยังไม่เห็นรายละเอียดส่วนลด” | เพิ่มหน้ารายละเอียดหรือเก็บไว้ก่อน; แก้ได้เมื่อมี facts ไม่บังคับเดาคูปอง |
| ยอดร้านกับยอดจ่ายต่างกัน | “ใบเสร็จร้านและยอดในคำสั่งซื้อไม่เท่ากัน” | ดูสองหลักฐานพร้อมยอด/ที่มา; แนบข้อมูลเพิ่มหรือพักเพื่อ review |
| ผู้จ่ายไม่ชัด | “ยังไม่ทราบว่าใครเป็นคนจ่าย” | เลือกผู้จ่ายที่มีสิทธิ/เก็บไว้ก่อน ไม่ตั้ง uploader เป็นผู้รับเงิน |
| ไม่มีใบเสร็จและเข้าเกณฑ์ | “รายการนี้จัดทำใบรับรองแทนใบเสร็จได้” | เปิด wizard ที่เติมข้อมูลตรวจแล้ว เพิ่มใบเสร็จแทน หรือพัก |
| ยังไม่มีเส้นทางรองรับ | “เก็บข้อมูลแล้ว รายการนี้ยังต้องตรวจเรื่อง…” | เปิดข้อมูลเดิมและเหตุผลจริง ส่งให้ผู้รับงานเฉพาะเมื่อมีผู้รับ/สิทธิ/ผลส่งสำเร็จ |

รายละเอียดส่วนลด/ค่าส่งเปิดเพิ่มได้ แต่ยอดที่ยังไม่ยืนยันและ blocker ที่เกี่ยวกับ action ต้องเห็นก่อนกด ปุ่มหลักหนึ่ง action ตามสถานะ; ทางพักและเพิ่มหลักฐานไม่ทำข้อมูลเดิมหาย เมื่อย้อนจากใบรับรองให้เปิดร้าน/source เดิมและแสดง ISSUED/รอลงนาม/รอตรวจตาม server

### 13.5 เงื่อนไขก่อนอ้างว่าพร้อมใช้งาน

- Public reference 45 เคสใช้สร้าง field inventory และ adversarial cases เท่านั้น; เก็บ Thai consented/redacted bundles ที่มี expected labels และเหตุผลต่อการตัดสินก่อน eval
- Golden labels ต้องครอบคลุม identity, items/quantity, all monetary roles/scopes, unknowns, payment/refund states, document sufficiency และผลทางการเงินที่คาดหวัง ไม่ตรวจเฉพาะ total
- แยก train/tuning/held-out ตามการซื้อและภาพที่ซ้ำกันข้ามเว็บ; หลายหน้าหรือสองpanelของเคสเดียวห้ามหลุดไปคนละชุด
- Acceptance A01–A88 ต้อง map กับ fixture ที่มีสิทธิใช้ และมี Thai positive multi-store paid cases ทุกแพลตฟอร์มก่อนอ้างว่ารองรับครบ ไม่มี accuracy/coverage target ที่ถือว่าผ่านแล้วจากจำนวนภาพ
- พฤติกรรมผิดที่ทำให้จ่าย/เบิกซ้ำ, ยอด/สกุล/ผู้จ่ายผิดแบบมั่นใจ หรือเปลี่ยน unpaid เป็น paid ต้องเป็น release blocker ใน regression ที่ตกลง ไม่เฉลี่ยกลบด้วย OCR accuracy รวม
- วัดเวลาแก้ของผู้ซื้อและบัญชี อัตราทำเองจบ อัตราพักแล้วกลับมาจบ ความเข้าใจสถานะ และค่าอ่าน/เวลาAI ต่อเคสก่อนกำหนด rollout; ยังไม่มี usability/eval results ในงานนี้

## 14. Impact, gaps และความเสี่ยงบั๊ก — ตรวจเพิ่มถึง 2026-09-17

**ผลประเมิน: v0.3–v0.6 มี IG01–IG15; v0.7 เพิ่ม IG16–IG25/A49–A74; v0.8 เพิ่ม IG26–IG27/A75–A82 สำหรับ PDF10MiB และหลายหน้า; v0.9 เพิ่ม IG28/A83–A85 สำหรับerror UX; v0.10 เพิ่ม IG29/A86–A88 สำหรับLINEถามย้อนหลัง** ตรวจเส้นทางที่เกี่ยวข้องตาม inventory §16.6 และหลักฐาน E01–E27. IG18 มีข้อขัดกันของค่าขอบไฟล์ที่ยืนยันจาก source; รายการอื่นแยกพฤติกรรมเดิม/ช่องว่าง/ความเสี่ยงชัด ยังไม่ใช่ runtime reproduction หรือการรับรองว่าปลอดบั๊กทุก race

สถานะทุก IG ยังเปิดจนกว่าจะมี implementation/decision และ verification ของ slice นั้น หลักฐานโค้ดยืนยันพฤติกรรมปัจจุบัน ส่วนข้อความ “ถ้านำมาใช้กับกลุ่มหลายร้าน” เป็นการประเมินผลกระทบของ feature ใหม่ ไม่ถือว่าพฤติกรรมเดิมผิดโดยตัวมันเอง

P0 ในตารางหมายถึงต้องปิดก่อนเปิดเส้นทางที่มีผลต่อเงิน/เอกสารลงนามของ feature นี้; P1 ต้องปิดก่อนให้ผู้ใช้ใช้ความสามารถที่เกี่ยวข้อง ไม่ใช่การแจ้งเหตุ Production P0 ณ ตอนนี้ เส้นทางที่ประกาศยังไม่รองรับต้องเก็บ/พักได้จริงและไม่แสดงว่าพร้อมทำการเงิน

### 14.1 ระบบที่ได้รับผลกระทบและหลักฐานที่อ่าน

| Ref | จุดที่ตรวจในโค้ดปัจจุบัน | ผลต่อ solution |
|---|---|---|
| E01 | [Upload UI](../../apps/web/src/features/expenses/ExpensesPages.tsx:291) ใช้ files[0]; [init upload](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:75) สร้าง draft และมีการ reuse ตาม LINE message identity | multi-file/resume/grouping ต้องเพิ่ม contract จริง; การวนเรียกinitไม่ใช่group upload |
| E02 | [Complete/replace primary](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:211) ถอดลิงก์/soft-delete primaryเก่าของdraftเมื่อไม่shared/ไม่มีretention; [testsเดิม](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts:285) ระบุพฤติกรรมนี้ | เพิ่มหน้าต่อ/แนบใบเสร็จตามมา ต้องไม่เรียกreplaceโดยปริยาย |
| E03 | [Extraction use case](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:103) และ [attachment selector](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:611) เลือก attachmentเดียว | การเก็บsupportingเพิ่มไม่ได้หมายความว่าOCRรวมทุกไฟล์แล้ว |
| E04 | [OCR contract](../../packages/contracts/src/line-ai.ts:270) มีvendor/discountชุดเดียว; [apply limit](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:130) จำกัด40แถว และ [usableItemLines](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:591) คืน[]เมื่อแถวใช้ไม่ได้ | summary fallback เดิมใช้กับบิลทั่วไปได้ แต่พิสูจน์ item completeness/ส่วนบริษัทของกลุ่มใหม่ไม่ได้ |
| E05 | [Reimbursement resolver](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:18) ตรวจบริษัท/สาขา/สกุล/ผู้จ่าย/ภาษี/ยอดเต็ม และ [file source resolution](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:87) ปฏิเสธหลายsourceจากไฟล์เดียว | derived-source/payer/lineage ต้องต่อกฎเดิม ไม่ลดguardหรือเปลี่ยนcreatedBy; จุดบังคับที่ชัดคือ :32-35 payer, :36-38 tax, :44-48 lines/totals identity และ :97-98 ambiguous ซึ่งนับ capture-only parent ด้วย |
| E06 | [Funding locks](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts:7) เดินความสัมพันธ์ผ่านattachmentLink; [duplicate detection](../../apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts:10) ใช้primary checksumและข้อมูลเอกสาร | group relations/aliases ต้องเข้าขอบเขตเดียวกัน; valid siblingsต้องแยกจากunrelated duplicate |
| E07 | [Late OCR preservation](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:987), [remove receipt](../../apps/api/src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.ts:21), [certificate certification/issuance](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:1777), [funding rules](../../apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts:6) | มีrevision/retention/signing/payment guardsอยู่แล้ว ต้องขยายให้ครอบคลุมgroup/selectionและงานที่สำเร็จบางsource |
| E08 | [OCR admission](../../apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts:74) ผูกattemptกับrequestId แยกlost-response retryจากre-read และใช้budget/quota | ต้องออกแบบretryต่อไฟล์/attempt; ห้ามเอาจำนวนร้าน/childไปแทนจำนวนอ่านโดยไม่มีกติกา |
| E09 | [Expense list/count](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:772), [accountant export row](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts:20), [claim projection](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts:34) | ต้องแยกcaptureงานรับหลักฐาน, eligible sources และเอกสารที่รับรู้เงินในรายการ/รายงาน ไม่แก้เฉพาะหน้าupload |
| E10 | [LINE continuation](../../apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts:46) มีtarget-requiredและผูกcompany/user/chat/expense | ผูกข้อความ/ภาพกับgroup-sourceอย่างชัด รักษาการเลือกงานเมื่อมีหลายร่าง |
| E11 | [Upload date default](../../apps/api/src/modules/expenses/presentation/http/expense.controller.ts:230), [source amount/date check](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:104), [positive payable guard](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:44) | วันที่หลายเหตุการณ์และยอดบริษัท0ต้องมีผลลัพธ์เฉพาะ ไม่ดันทุกcaptureเข้าpositive-money source |
| E12 | [Web PDF limit](../../apps/web/src/features/expenses/expense-upload.logic.ts:17), [upload notice](../../apps/web/src/features/expenses/ExpensesPages.tsx:279), [API extraction limit](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:20) | FEเตือนที่4,194,304 แต่APIรับอ่านถึง4,000,000bytes; ช่วง4,000,001–4,194,304ขัดกันจริงในsource ยังไม่รันruntime |
| E13 | [Gateway PDF reader](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:280) | PDFต้องใช้providerที่รองรับ; ปัจจุบันnon-BedrockคืนPDF_PROVIDER_UNSUPPORTED, read output4096tokens และ truncatedคืนerror; ไม่ยืนยันทุกหน้าอ่านครบ |
| E14 | [shared OCR endpoint](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:157), [MULTI_DOCUMENT guard](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:338), [prompt](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:518), [parser](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:965) | Web/LINEใช้single-expense output; multi-docตัดfields, line blockจำกัด40; ต้องเพิ่มcapture contractก่อนปลดscope ไม่ใช่เพิ่มชื่อร้านในpromptอย่างเดียว |
| E15 | [LINE intake media selection](../../apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:208), [LINE downloaded-media type gate](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7448), [OCR call](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7382) | static trace: downloadLineMediaสร้างcontentBase64เฉพาะmessageType=image (:7448); file/PDFไม่มีค่านี้และtryExtractReceiptFieldsคืนNOT_REQUESTEDก่อนเรียกGateway (:7372) แม้ดาวน์โหลดbytesได้; captionช่วยroute/manual captureแต่ไม่ได้เติมPDFเข้าOCRเอง ต้องต่อbounded pipelineจากoriginalและทดสอบraw file event ไม่mockข้ามgate |
| E16 | [replace UI](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx:428), [reread policy](../../apps/web/src/features/expenses/expenses.model.ts:1705), [upload client](../../apps/web/src/features/expenses/expenses.api.ts:202) | replacementมีauto rereadในDRAFT/NEEDS_REVIEWเมื่อมีสิทธิ; READYไม่auto reread; ใช้shared prepareแล้วcompleteผ่านAPI ไม่ใช่flowที่ไม่มีAI |
| E17 | [complete receipt](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:197), [retire old primary](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts:285) | completeอ่านrevisionตอนrequestเริ่ม, payloadยังไม่มีexpected target/revisionจากตอนผู้ใช้เลือก; updateprimaryไม่ได้ระบุclearผลOCRเดิม; retireเฉพาะdraft/unshared/unheld files ต้องขยายcontractและsource-version invalidation |
| E18 | [apply revision fence](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:998), [reviewed identity/lines](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:1013) | มีhuman-review preservationและstale guardsแล้ว; receiptต่างใบต้องไม่ปนfactsหรือยกผลตรวจเก่าให้ไฟล์ใหม่ การรักษาค่าคนไม่เท่ากับรับรองหลักฐานใหม่ |
| E19 | [material primary lock](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts:918), [remove guards](../../apps/api/src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.ts:21), [LINE final receipt context](../../apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts:785) | primaryเป็นmaterial; active claim/signed evidenceมีguards; removeมีเงื่อนไขเข้มกว่าappend/replace; ห้ามเพิ่มทางลัดจากLINE/ปุ่มใหม่ |
| E20 | [shared upload preparation](../../apps/web/src/common/files/upload-file.logic.ts:48), [PDF preserve](../../apps/web/src/features/expenses/expense-upload.logic.ts:281), [LINE media security](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7416) | reuseMIME/bytes/security checks; PDFไม่re-encodeในprepare; ไฟล์ปลอดภัย/เก็บสำเร็จไม่ได้แปลว่าอ่านได้หรือตรวจe-Taxผ่าน |
| E21 | [duplicate candidates](../../apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts:10), [candidate facts](../../apps/api/src/modules/expenses/domain/logic/expense-duplicate.logic.ts:18), [OCR fields](../../packages/contracts/src/line-ai.ts:270) | มีchecksum/perceptual/document heuristicsเดิม แต่representationยังไม่แทนpurchase/document replacement graphและmethod-specific electronic verification; reuseก่อนเพิ่มfield |
| E22 | [PDF page copy ที่ใช้อยู่](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts:234), [PDF renderer](../../apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts:12), [native text reader](../../apps/api/src/modules/banking/infrastructure/pdf-statement-text.extractor.ts:20) | APIมีpdf-lib/pdfjs-dist/sharpและรูปแบบrender/textอยู่แล้ว; reuse library/pattern ไม่ยกข้อจำกัด17หน้า/previewresolutionของcertificateมาเป็นreceipt limit และไม่แก้bank parserโดยพลการ |
| E23 | [Bedrock adapter](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts:41), [Gateway body parser](../../apps/ai-gateway/src/main.ts:53), [upload defaults](../../packages/config/src/index.ts:168) | adapterส่งdocumentbytesตรง, mediaHTTP route16mb, storagedefault10MiB; ต้องวัดserializedbase64payloadจริงต่อcall ไม่ส่งไฟล์10MBตรงให้providerด้วยการเพิ่มconstant |
| E24 | [LINE ledger drain](../../apps/api/src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.ts:1), [receipt extraction](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:20) | ledgerdrainปัจจุบันเป็นread-only follow-up ไม่ใช่receiptchunkworkerสำเร็จรูป; W00/D02ต้องเลือกdurable execution seamที่ถูกboundary โดยreuseinfra/patternก่อนเพิ่มqueue/service ไม่อ้างว่ามีงานbackgroundPDFแล้ว |
| E25 | [LINE download error copy](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:264), [LINE safety copy](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:361), [LINE OCR reason copy](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:376), [Web review error state](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx:249) | มีข้อความเฉพาะทางและerror stateเดิมให้reuse; download failureใช้คำว่ารูปทั้งimage/file, safety replyรวมหลายสาเหตุ, OCR governanceมีบางreasonแล้ว; ยังไม่มีหลักฐานmappingทุกreason×persist-state×สามทางตาม§17 ไม่ใช่runtime reproduction |
| E26 | [LINE download rejection](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7428), [coarse failure outcome](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5546), [event log](../../apps/api/prisma/schema.prisma:1747), [payload cleanup](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7527) | sizeเกิน/credentialsไม่พร้อม/fetchหรือboundedreadล้มเหลวคืนnullแล้วcallerใช้RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILEDร่วมกัน; payloadถูกscrubตามretentionflow จึงต้องเก็บsafe reason/contextที่พอถามย้อนหลังได้ก่อนexpenseโดยไม่เก็บrawpayloadเพิ่ม |
| E27 | [existing LINE status answer](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:3661), [existing record explanation](../../apps/api/src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.ts:226), [pending media](../../apps/api/prisma/schema.prisma:7920), [read evidence](../../apps/api/src/modules/line-ai/application/line-read-evidence.service.ts:1) | มีread-only statusตามrecentcapturedexpenseและexplain_recordที่ตรวจสิทธิ์แล้ว; pendingmediaต้องมีattachment จึงไม่แทนrejectionก่อนเก็บbytesทุกกรณี; reuseboundaryเหล่านี้ ไม่อ้างว่ามีdiagnostictoolครบแล้วหรือให้Gatewayอ่านDB/logตรง |

เลขบรรทัดเป็นตำแหน่งใน working tree ณ รอบตรวจ อาจเลื่อนเมื่อโค้ดเปลี่ยน ต้องทบทวนก่อนimplementation ไม่ได้ตรวจ deployed environment หรือแก้codeในรอบนี้

### 14.2 Gap / bug-risk register

| ID / ระดับ | ประเภทและสถานการณ์ที่ทำให้เกิดปัญหา | สิ่งที่ต้องทำ / หลักฐานปิดงาน |
|---|---|---|
| IG01 / P0 | **Integration gap E01–E02**: เพิ่ม3รูปด้วยprimaryเดิมอาจเหลือเพียงรูปท้าย; retry initจากเว็บสร้างdraftใหม่; group retentionไม่อยู่ในกฎshared fileเดิม | แยกappend/replace/detach intent, per-file stable upload identity/status และresume; กันลบหลักฐานที่group/child/signatureยังอ้าง; A35–A36 รวมnetwork lossและretention |
| IG02 / P1 | **Integration gap E03–E04**: supportingไม่ได้ถูกอ่านรวม, เกิน40แถว/แถวเสียยุบเป็นsummaryแล้วดูเหมือนอ่านครบ; contractไม่มีหลายissuer/scope | bounded group extraction output พร้อมpage/item completeness และversion; summaryเก็บได้แต่ไม่ให้item allocation/handoffจนพิสูจน์ครบ; A02/A27/A37 |
| IG03 / P0 | **Design/integration gap E01/E09**: parentที่เป็นExpenseRecordยังเข้ารายการ/รายงาน/confirmได้ หรือsourceกับclaim projectionนับต้นทุนซ้ำ | authoritative capture-only discriminatorและทุกwrite/read consumer; ระบุแถวใดเป็นงาน แถวใดเป็นเงินจริงในexport; A09/A38–A39 |
| IG04 / P0 | **Integration gap E05–E06**: claim810อ้างsource1290ถูกปฏิเสธ, uploaderไม่ใช่payer, ไฟล์เดียวหลายchildเป็นambiguous หรือaliasหลุดlock | derived sourcesที่serverรับรองเต็มยอดส่วนบริษัท, explicit verified payer, canonical lineage/reservationร่วมกฎเดิม; A04/A09–A11/A15–A16/A32 **รอบ2026-09-15**: resolverไม่มีฟิลด์payer จึงต้องตัดสินการแทนpayerใน D06 และแตกบรรทัดให้ผ่าน expenseTotalsIdentity ก่อนอ้างว่าsource810ใช้ได้ |
| IG05 / P0 | **Design gap E07**: childAออกใบรับรอง/มีผลpaymentแล้ว แต่Bยังค้าง; retryทั้งbatchทำAซ้ำ หรือเปลี่ยนallocationแล้วทำลายลายเซ็นA | แยกatomic draft generationจากระยะลงนาม/ออก/จ่ายที่เกิดหลายครั้งตามผู้ใช้; มีสถานะและside-effect identityรายsource; reservegroupก่อนเริ่มผลการเงินจริง; A17–A22/A40/A44 |
| IG06 / P1 | **Integration gap E07**: existing expectedUpdatedAtคุ้มครองexpense แต่selection/group/sourceหน้าอื่นเปลี่ยนระหว่างOCRหรือpreview | group revisionและsource revisionเข้าการตรวจเดียวกับreview/sign/handoff; late resultไม่ทับคน; A11–A12/A48 |
| IG07 / P0 | **Design gap E06**: ย้ายไฟล์/orderไปกลุ่มใหม่หลังใช้ยอดแล้วเพื่อหลบduplicate; หรือvalid siblingsถูกflagเพราะภาพเดียว | ownership/consumptionตามcanonical source+scope, merge/splitย้ายได้เฉพาะช่วงที่อนุญาต, preservealias/history; sibling exceptionเฉพาะvalidated lineage ไม่ปิดduplicate guardรวม; A16/A44 |
| IG08 / P1 | **Integration/UX gap E08**: quotaหมดกลางชุด, lost-responseทำattemptใหม่, แยกร้านแล้วอ่านภาพเดียวซ้ำทุกchild | per-attempt checkpoint/usage, retry policyเดิม, batch budget/limitsชัด, quotaหมดหยุดการอ่านที่เหลือแต่รักษางานและmanual recovery; A36/A43 |
| IG09 / P1 | **Security/UX design gap E05/E07/E09**: child linkทำให้เห็นต้นฉบับคนละสิทธิหรือข้อมูลส่วนตัว; exportส่งทั้งparentโดยไม่ตรวจaccess | authorize original evidenceทุกview/download/export/LINE, retentionตามเจ้าของจริง; แยกการตัดสิทธิเบิกจากการredactข้อมูล ไม่มีsilent permission widening; A15/A46 |
| IG10 / P1 | **Integration/UX gap E10**: ภาพส่งต่อกันอาจคนละซื้อ/ผู้จ่าย, LINEมีหลายงานแล้วคำตอบไปผิดร้าน, กลับจากcertificateผิดsource | stable work/group/source routingและper-fileสถานะ; ambiguityให้เลือกงาน, carry-overกลับงานเดิม; A14/A36/A40/A45 |
| IG11 / P0 | **Policy/representation gap E05/E07/E09**: shared promotionยังไม่รู้basis, บริษัทจ่ายของส่วนตัว, VAT/WHT/BNPL/refundผ่านปลายทางที่แทนข้อมูลไม่ได้ | ปิดpolicy/representationเฉพาะsupported sliceก่อนเงิน; unsupportedเก็บfactsและpauseจริง ไม่ลดภาษีหรือทำcertificateแก้ความไม่รู้; A05/A08/A13/A19/A30–A31 **รอบ2026-09-15**: ต้องมีกติกา review classification ตาม facts พร้อมทางพักเมื่อไม่มีหลักฐานหรือปลายทางไม่รองรับ; ห้ามบังคับค่าภาษีเพื่อให้ทุกเคสผ่าน |
| IG12 / P1 | **Design edge gap E11**: ผู้ใช้ตัดของส่วนตัวจนยอดบริษัท0; ของแถมถูกสร้างต้นทุน; order/payment/receipt/uploadอยู่คนละวันหรือเดือน | no-financial-handoff outcomeสำหรับยอด0ที่ยืนยันแล้ว, unknownไม่เท่ากับ0, preserveหลายวันที่และreview expenseDate; A27/A41–A42 |
| IG13 / P1 | **Rollout/compatibility gap E03–E05/E09**: API/workerเก่ารับschemaใหม่แล้วทิ้งscope; ปิดfeatureแล้วงานค้างถูกfallbackเป็นordinary expense | capability/version negotiationก่อนสร้าง/อ่าน/ใช้source, compatibility regression, disable-new-intakeโดยคงread/recoveryที่รองรับ; A01/A38/A47 |
| IG14 / P1 | **Validation gap**: 45public casesดูหลากหลายแต่ยังไม่มีThai full paid multi-store golden bundlesทุกplatform และยังไม่ทดสอบ40+ | ปิดcoverageตามcorpusข้อ5, map A01–A88กับauthorized fixtures; separateaccuracy/false-ready/usability/cost; ห้ามอ้างผ่านจากจำนวนreference |
| IG15 / P1 | **Permission/entitlement gap**: capture group, business allocation และ derived source generation ยังไม่มี action-to-key/ownership mapping ที่ตัดสินแล้วใน [permission registry](../../apps/api/src/modules/auth/permission-registry.ts:160) และยังไม่ตัดสินว่า gate ด้วย entitlement/capability อย่างไร | ระบุ key/role/entitlement ก่อน W01; server ปฏิเสธ actor ที่ไม่มีสิทธิในทุก entry point ไม่ใช้การซ่อนปุ่ม; A15/A46 |
| IG16 / P1 | **E04/E14: single discount + nonnegative item lines ไม่แทนvoid/savings/tender/rewardครบ; ถือเป็นextension gap** | normalize signed eventsก่อนexpense materialization; ไม่absหรือเปิดnegativeทุกแถว; monetary role/provenance/Decimal; A49–A52/A56/A57 |
| IG17 / P1 | **E04/E18: quantity/pack/tax markersและreviewed tax semanticsมีหลายชั้น** | แยกqty/UOM/packกับdisplay count, อ่านlegend/unknown และreuseper-line tax; ไม่ใช้7%ทั้งใบ/ไม่เดาZERO_RATED; A53/A58/A59 |
| IG18 / P1 | **E12: confirmed static mismatch FE4MiBกับBE4MB; replacement/LINEยังไม่มีหลักฐานใช้thresholdเดียวกัน** | D02ระบุupload/extraction/provider limitsแยกและหน่วยbytes; shared threshold+error recoveryทั้งสามทาง; A67/A69/A74 |
| IG19 / P1 | **E13/E14: รับPDFได้ไม่เท่ากับproviderอ่านได้; text/page/token coverageยังไม่เป็นmanifest** | capability typed errors, page/document completeness, boundedreuse/retry; รักษาvision reader policyเดิมจนD02ตัดสิน; A61/A65/A74 |
| IG20 / P1 | **E15: confirmed static LINE file/PDF OCR gap — downloaderเตรียมAI contentเฉพาะimage จึงข้ามPDFที่OCR preflight; classifier/caption/clarificationต่างจากWeb** | durable capture/pending identityตามสิทธิ; ไม่บอกเก็บแล้วก่อนpersist,ไม่lost bytesหลังถามกลับ; scope/target/versionก่อนgroup routing; ต่อfile/PDFจากbytesที่ตรวจสิทธิแล้วเข้าสู่bounded reader ไม่เพียงเติมbase64ไฟล์10MBทั้งก้อน; A68/A69/A75/A81 |
| IG21 / P1 | **E20/E21: OCR status/ไฟล์PDFยังไม่ใช่method-specific electronic verification** | original hash/version+derivative, not-checked/failed/unavailableต่างกัน, D09/authorized evidence; screenshotยังreviewได้ตามpolicy; A61/A62/A64/A66 |
| IG22 / P1 | **E16–E18: เปลี่ยนprimaryแล้วอ่านล้มเหลวหรือไม่auto reread อาจเหลือfacts/statusจากเอกสารเก่า** | invalidate current-source verificationโดยรักษาค่าคนพร้อมprovenance; diff/reviewก่อนใช้กับไฟล์ใหม่ ไม่ปนสองซื้อ; A70/A73 |
| IG23 / P0 | **E17/E19: revisionช่วงcompleteไม่ใช่revisionตอนเลือกไฟล์; retain/material/claim/signingสัมพันธ์กัน** | expected old attachment+revisionจากUI/LINE, transaction/idempotency/old-result fence, state matrixและretention; A63/A71/A72 |
| IG24 / P0 | **E06/E21: paper/screenshot/PDF/lateinvoiceต่างhashแต่ซื้อเดียว; issuerอาจต่างจากplatform** | document relations/candidatesที่ตรวจแล้วและconsumptionข้ามช่องทาง; ไม่mergeจากยอด/โลโก้; replacement/creditผ่านcorrection; A54/A55/A60/A63/A69 |
| IG25 / P1 | **Validation/UX gap: 11ภาพกับ5guidesไม่ใช่originalelectronic corpusหรือthree-entry runtime proof** | authorized bundlesครบ5แบรนด์, held-outไม่รั่วข้ามภาพเดียวกัน; UX40+ผ่านreplacement/recovery, sample countsไม่ใช่ผลผ่าน; A49–A74 |
| IG26 / P1 | **E13/E22/E23: PDF10MBเกินขอบproviderและการsplitอาจยังเกินขนาดต่อหน้า/ทำบริบทหาย** | เพิ่มbounded page/region preprocessing + manifest/reassembly; ขนาดส่วนย่อยวัดจริง, overview/overlap dedupและtinyprintquality; A75/A76/A77/A80 |
| IG27 / P1 | **E08/E23/E24: หลายcallเสี่ยงtimeout/ใช้quotaซ้ำ/กินmemoryและstaleapply; asyncLINEที่มีไม่ใช่receiptworkerทั่วไป** | durable bounded runner, perchunkcheckpoint+attemptidentity, HTTP/base64/pixels budgets, source/actorcheckตอนทำต่อ; A78/A79; ไม่manual-onlyจาก4MB |
| IG28 / P1 | **E25: recoveryมีหลักการแต่reason/copy/actionยังไม่เป็นmatrixร่วม; unknown result, file-vs-image, securityและpermissionอาจสื่อผิดสถานะ** | §17 UXE-01–27 + typed reason/recovery mappingตามD02/D06; reusecopy/helpersเดิม, observable-state-before-retry, known/unknownและUX40+ evidence; A83–A85 |
| IG29 / P1 | **E26/E27: pre-capture reasonถูกยุบรวมและการถามstatusเดิมอิงexpenseที่สร้างแล้ว จึงยังอธิบายfile rejectionย้อนหลังอย่างมีหลักฐานไม่ครบ** | §17.5ให้safe durable outcomeแม้ไม่มีexpense+permission-checked lookup, exact/ambiguous/no-evidence semantics, deterministic fallbackและno implicit retry; A86–A88 |

### 14.3 ข้อกำหนดเพิ่มเพื่อไม่ให้ช่องว่างกลายเป็นบั๊ก

**ไฟล์และการกลับมาทำต่อ**

- “เพิ่มหลักฐาน”เป็นappendในงานเดิม; “เปลี่ยนไฟล์นี้”เป็นreplaceเฉพาะไฟล์ที่ผู้ใช้เลือกตามสิทธิและretention ห้ามmulti-uploadเรียกprimary-replaceต่อเนื่อง การdetachผิดกลุ่มไม่เท่ากับลบobjectที่เอกสารอื่นยังใช้อยู่
- งานต้องจำfile manifest/สถานะที่serverรับแล้ว ไม่สัญญาว่าbrowserเก็บไฟล์ที่ยังไม่อัปโหลดหลังปิดหน้าได้; ถ้าbytesยังไม่ถึงให้บอกเลือกไฟล์นั้นใหม่ ส่วนที่สำเร็จไม่เริ่มใหม่
- Groupมีsource filesครบไม่ได้แปลว่าอ่านครบทุกหน้า การอ่านแบบsummary/partialต้องมีเหตุผลที่userเข้าใจได้และไม่เปิดitem-level allocationจากรายละเอียดที่หาย

**การเงินและใบรับรองที่สำเร็จบางส่วน**

- สร้าง derived expense sources แบบ atomic/idempotent batch ได้ แต่ไม่ครอบการรอมนุษย์เซ็นหรือ external work ทั้งหมดไว้ใน DB transaction เดียว
- ก่อนเริ่มลงนาม/ออกใบรับรอง/ใช้sourceทางการเงิน ต้องยืนยันfinancial allocationทั้งชุดที่เกี่ยวข้องและreserve funding route/scope ชัด; มีoperation identityรายsource/เวอร์ชัน ส่วนเอกสารบางใบที่ค้างแสดงค้าง ไม่สรุปยอดว่าจ่ายคืนครบ
- เมื่อมีการลงนามแล้ว ห้ามgeneric group edit/merge/split/regenerateเปลี่ยนfinancial scopeใต้ลายเซ็นหรือย้ายconsumed source; ใช้correctionที่ตรวจผลกระทบก่อน สิทธิทำเอกสารอื่นที่ค้างยังคงตามsnapshotที่ถูกต้อง และแนบหลักฐานเสริมที่ไม่เปลี่ยนfactsได้ตามข้อ5/12
- COMPANY issuanceที่บันทึกpaymentแล้วเป็นผลจริงแม้แถวอื่นค้าง ห้ามreset/ปล่อยreservationเพราะrequesttimeout; PERSONAL issuanceยังไม่บันทึกบริษัทคืนเงิน สิทธิใบเบิกต้องผ่านresolverเดิม
- Unknown, ไม่มีส่วนบริษัท และส่วนบริษัท0เป็นคนละผลลัพธ์ ยอด0ที่ตรวจแล้วเก็บเป็นหลักฐานโดยไม่มีpositive-money destination ไม่สร้างใบรับรองหรือexpenseศูนย์เพื่อให้flowแสดงสำเร็จ

**ผลกระทบต่อระบบรอบข้าง**

- Scope/source-roleต้องเข้าshared read models: รายการและจำนวนงาน, source picker, approval summary, accountant package/CSV/XLSX, related evidence, deep links, LINE status, ledger/payment retry/reversalที่เกี่ยวข้อง ต้องinventorycallersก่อนcode
- เมื่อต้องนับยอดค่าใช้จ่าย ให้ใช้เอกสารที่เป็นเจ้าของการรับรู้ตามroute พร้อมsource references; ห้ามรวมยอดoriginal purchaseที่มีส่วนตัวเข้าcompany spendเพราะเป็นแถวparent และห้ามนับeligible evidence sourceซ้ำกับclaim projection
- สิทธิchildไม่ได้ให้สิทธิดูต้นฉบับทั้งกลุ่มโดยอัตโนมัติ; ถ้าactorไม่มีสิทธิให้แสดงข้อจำกัดตามจริง การจัดส่วนบริษัทไม่ใช่การลบหรือปิดบังข้อมูลส่วนตัวในไฟล์ต้นฉบับ
- Reuseผลอ่านที่ยังตรงsource/versionก่อนเรียกproviderซ้ำ บันทึกusageตามOCR governanceเดิม; ถ้าต้องเปลี่ยนหน่วยquotaของmulti-page/batchต้องspecแยกก่อน ไม่อ้างว่า1order=1read
- Reuse launch-gate/entitlement เดิมโดยตัดสิน route ใน D07: [assertExpenseRootOpen](../../apps/api/src/modules/expenses/application/expense-launch-gate.ts:36) ผูก `expenses/DEFAULT` ตายตัวและปิดเฉพาะการสร้างงานใหม่ จึงยังรับ route key ใหม่ไม่ได้โดยตรง หากต้องปิด intake กลุ่มแยกจากใบเสร็จเดิม ต้องเชื่อม route กับ registry/seed/guard/runoff/deployment admission เดิมให้ครบก่อนเปิด ไม่ใช้ kill switch แทน source-role guards
- Additive schema อย่างเดียวไม่กัน server/worker รุ่นเก่าที่ไม่อ่าน discriminator: W01 ต้องส่ง compatibility guards ให้ทุก read/write consumer และพิสูจน์ว่าไม่มี binary ที่ไม่รองรับเข้าถึง capture records ก่อน W02 เปิด intake ถ้าคุมไม่ได้ให้คง intake ปิด; ปิด intake หลังมีข้อมูลแล้วไม่ทำให้ rollback ไป binary เก่าปลอดภัย ต้องคงรุ่นที่รองรับหรือแยกข้อมูลด้วยกลไกที่ทดสอบแล้ว งานค้างยังอ่าน/กู้คืนได้ตามสิทธิ ไม่เพิ่ม handshake protocol โดยไม่มีเหตุจำเป็น
- D08 ต้องระบุการใช้ policy/processor/retention เดิมและช่องว่างของ capture-only ก่อนใช้ข้อมูลส่วนบุคคลจริงใน pilot หรือส่ง AI ไม่รอ G3; fixtures จำลองที่ไม่มีข้อมูลบุคคลเดินต่อได้ การจบว่าใช้ส่วนตัวทั้งหมดไม่ได้กำหนดให้เก็บไม่สิ้นสุด

### 14.4 เกณฑ์ออกจาก impact review

- ก่อนimplementationของแต่ละslice ระบุownerของdecision/contract, endpointsและbackground callers, write/read impact, migration/capability strategy, expected errorsและทางกู้ต่อIGที่เกี่ยวข้อง
- ก่อนเปิดcapture groupกับผู้ใช้ ต้องปิด IG15, D08 ส่วนข้อมูลจริง และ compatibility ของ W01; การแทน payer/tax classification ต้องปิดก่อน action ที่พึ่งข้อสรุปนั้น ไม่ขวาง capture-only ที่เก็บ unknown และไม่สร้างผลเงิน
- ก่อนเปิดfinancial handoff ต้องปิด IG01/IG03/IG04/IG05/IG07/IG11/IG23/IG24 ในขอบเขตที่เปิดจริง พร้อมAPI/DB concurrency, source/certificate/payment identity และexport reconciliation; ไม่ใช้UIซ่อนปุ่มแทนserverguard
- ก่อนใช้group captureกับลูกค้า ต้องผ่านper-file save/recovery, completeness/limit, quota, LINE target, permissionsและversion testsของเส้นทางนั้น; ordinary single-file receipt regressionต้องผ่านด้วย
- A01–A88 เป็นacceptance targets ยังไม่มีเครื่องหมายผ่านในรอบstatic reviewนี้ ต้องบันทึกcommand/fixture/resultและข้อจำกัดเมื่อทดสอบจริง
- Verificationรอบนี้: อ่านโค้ดและtest definitionsข้างต้นพร้อมspecเดิม; ตรวจเอกสาร/ลิงก์/IDด้วยlocal checkเท่านั้น ไม่มีAPI/DB/browser repro, application tests หรือcloud access จึงยังไม่สรุปว่าปลอดบั๊กหรือพร้อมrelease

<a id="implementation-plan"></a>
## 15. การพัฒนาคู่กับ spec

ใช้ [Implementation plan](../plans/marketplace-buyer-expense-capture-plan-th.md) เป็นรายการงานที่เดินตามข้อกำหนดนี้ ทุก work package มี dependencies, เจ้าของ boundary, จุดแก้ในrepo, ผลส่งมอบและวิธีตรวจรับ โดยยังไม่ถือว่าข้อกำหนดผ่านเพราะมีแผนแล้ว

| งานในแผน | ข้อกำหนดใน spec ที่รับผิดชอบ | สิ่งที่ต้องเห็นก่อนผ่านงาน |
|---|---|---|
| [W00](../plans/marketplace-buyer-expense-capture-plan-th.md#w00) | §2/5/11/13/14 | decision ของ slice, contract/caller inventory และ fixture readiness |
| [W01](../plans/marketplace-buyer-expense-capture-plan-th.md#w01) | §4/5/8/14 | capture-only/lineage/access/version guards ก่อนรับกลุ่ม |
| [W02](../plans/marketplace-buyer-expense-capture-plan-th.md#w02) | §3/7/8/14/16 | หลายไฟล์ append/replace/resume และกลับงานเดิมได้จริง |
| [W03](../plans/marketplace-buyer-expense-capture-plan-th.md#w03) | §6/7/13/16 | อ่านพร้อมscope/evidence/completeness ไม่แต่งยอดและไม่ข้ามquota |
| [W04](../plans/marketplace-buyer-expense-capture-plan-th.md#w04) | §3/4/6/8/9 | ส่วนบริษัท/ผู้จ่าย/snapshot/ทางพักในหน้าตรวจเดิม |
| [W05](../plans/marketplace-buyer-expense-capture-plan-th.md#w05) | §4/5/9/14 | eligible sources เต็มยอดส่วนบริษัทและใช้เงินจริงได้ครั้งเดียว |
| [W06](../plans/marketplace-buyer-expense-capture-plan-th.md#w06) | §12/14 | ใบรับรอง DIGITAL/PAPER + partial progress + กลับsourceเดิม |
| [W07](../plans/marketplace-buyer-expense-capture-plan-th.md#w07) | §5/9/12/14 | expense/claim/payment/exportทั้งสายไม่ซ้ำและสิทธิถูกต้อง |
| [W08](../plans/marketplace-buyer-expense-capture-plan-th.md#w08) | §10/13.5/14.4 | integration/AI/UX40+/compatibility/readinessตามขอบเขตที่เปิด |

แผนข้อ6จับคู่ A01–A88 ทีละข้อกับงานและหลักฐาน; ข้อ7จับคู่ IG01–IG29 กับงานที่ต้องปิด; ข้อ4ระบุ D01–D09 และงานที่ขึ้นกับแต่ละdecision เพื่อไม่หยุดงาน capture เพราะ policy การเงินที่ยังไม่ใช้

เมื่อเปลี่ยนbehavior/contract/ขอบเขต ให้แก้specและplan/memoryในงานเดียวกัน โดยคง acceptance/IG IDs ที่ยังมีความหมายและเพิ่มIDเมื่อมีข้อกำหนดใหม่ ไม่ใช้planยกเว้นกฎเงิน/สิทธิ/ใบรับรองของspecโดยไม่ระบุการเปลี่ยน

W06เป็นข้อบังคับของfeatureเต็ม; capture pilotไม่ทำให้ถือว่าจบค่าใช้จ่าย/ใบเบิก และ COMPANY certificate issuanceซึ่งอาจบันทึกpaymentต้องอยู่ภายใต้financial gate แม้พัฒนาอยู่ก่อนงานhandoff W07 การเปิดลูกค้าจริงต้องผ่านreadinessและreleaseprotocolตามแผน

<a id="retail-electronic"></a>
## 16. Retail/electronic และการอ่านครบสามทาง — baseline v0.8

ส่วนนี้เป็นข้อกำหนดของ spec/plan หลักตามคำขอ 2026-09-17 ครอบ 7-Eleven, Lotus’s, Big C, Makro, CJ MORE พร้อม marketplace เดิม; RC-A01–19 จาก research ถูกย้ายเป็น A49–A67 และเพิ่ม A68–A74 สำหรับ integration/เปลี่ยนใบเสร็จ v0.8 เพิ่ม A75–A82 และ §16.7–16.8 สำหรับ PDF10MiB/หลายหน้า; ทุกข้อยังรอตรวจรับจริง ไม่ใช่ optional research backlog

### 16.1 ทางเข้าร่วมและขอบเขตของผลลัพธ์

| ทางเข้า | สิ่งที่ต้องทำ | สิ่งที่ไม่เปลี่ยนจาก boundary เดิม |
|---|---|---|
| LINE AI: ส่งภาพ/ไฟล์/ตอบงานค้าง | bind company/branch/actor/chat และ pending file/work; ถ้ามีหลายงานให้เลือกจากงานที่มีสิทธิ; captionless PDF ต้องมีทางเก็บ/clarifyตามจริง; reuse router read เฉพาะไฟล์/versionที่ตรง | ไม่มี financial finalization จากข้อความหรือ AI; ไม่ใช้ context ใบรับรองที่รอลายเซ็นรับภาพใบเสร็จแทนลายเซ็น/scanโดยเดา |
| Web: อัปโหลดใหม่ | reuse ExpensesPages/attachment preparation/expense capture; แสดง persisted/reading/incomplete/review ตามจริง; หลายไฟล์ของซื้อเดียวไม่สร้างหลายexpenseทันที | capture-only guards ต้องมาก่อนgroup intake; MIME/size/security/permission และquotaเดิมยังใช้ |
| Web: เปลี่ยนใบเสร็จ/อ่านใหม่ | reuse ExpenseReviewPage และ API เดิมโดยขยายcontractตาม §16.4; รองรับimage/PDFและกฎAIเดียวกับสองทางแรก; mobileกับdesktopเข้าถึงได้ | “เปลี่ยนไฟล์ผิด”, “แนบเอกสารเพิ่ม”, “แก้เอกสารการเงิน” เป็นคนละintent ไม่ใช้primary-replaceแทนทุกอย่าง |

กฎอ่านเอกสาร/normalize/reconcile และผลตีความที่ปลายทางใช้ต้องเป็น versioned shared contract ใน Gateway/API เดิม ช่องทางมีpresentation/clarificationต่างกันได้ แต่เอกสารและreview/policy versionเดียวกันต้องไม่ให้ยอดหรือความหมายเงินต่างกันเพราะส่งคนละหน้า (A69) การแก้ shared reader ต้องตรวจผลกระทบ bank-statement reader ซึ่งใช้เส้นทางเดียวกันก่อน merge code

ไฟล์สแกนกระดาษในPDF, electronic invoiceต้นฉบับ, screenshotในแอป, PDFที่printจากหน้าorder และslipจ่ายเงินต้องจำแนกจากเนื้อหา; container/brandไม่เป็นหลักฐานว่าpaid/มีVAT/verificationผ่าน ไม่เพิ่มmerchant-specific servicesหรือโมดูลบัญชีใหม่เพื่ออ่านเอกสาร

### 16.2 Facts และกฎค้าปลีกที่ทั้งสามทางต้องใช้

- Identity: purchase channel, merchant brand, legal issuer/tax branch/store/POS, document type/number/date/time/currency และreferenceของการออกแทนแยกกัน; เลขเอกสารเก็บstringไม่ตัด0นำหน้า ไม่ใช้เลขคิว/สมาชิก/บัตรเป็นreceipt IDหรือactual payer
- Document graph: transaction/purchaseหนึ่งครั้งมีหลายdocumentและหลายrepresentation; supporting/abbreviated/full/replacement/creditสัมพันธ์กันได้ตามหลักฐานหรือreview มีหลายpurchaseในภาพเดียวได้ ห้ามhard-codeหนึ่งไฟล์เท่ากับหนึ่งexpense
- Line events: sale, explicit void/reversal, applied discount, price correction, zero-price promotion, reward/info, unknown; linked voidหักล้างเฉพาะเมื่อมีหลักฐาน แถวติดลบไม่ถูกabsหรือส่งตรงเข้าordinary item amount และvoidภายในบิลไม่ถูกประกาศเป็นrefundนอกบิล
- Quantity: แยกซื้อกี่หน่วย/กก./แพ็ก, pack size, unit/extended price และตัวนับรายการ; คำว่า3ชิ้น/แพ็กไม่คูณซ้ำกับquantityโดยเดา แถวรายละเอียดจำนวนใต้สินค้าไม่สร้างสินค้าใหม่; quantityที่อ่านไม่พบไม่กลายเป็นobserved1จากparserdefault หากต้องใช้1เป็นsummary representationต้องบอกinferred/summaryและยังไม่เปิดแบ่งจำนวนสินค้าที่ไม่รู้
- Money: document subtotal/discount/tax/total, cash tendered/change, settlement components/outstanding และยอดเบิกเป็นคนละค่า; future coupon, current/balance/expiring points และsavings summaryไม่ลดซ้ำ หากCPN/coinsยังแยกrole/ownerไม่ได้เก็บlabelและunknown ไม่auto-approveหรือแปลงเป็นemployee cash
- Tax: เก็บraw marker+legend+group/row evidence; rate0ไม่เท่ากับEXEMPTโดยอัตโนมัติ, code1/code2ไม่ใช่1%/2%; “Vatable”ต้องอ่านร่วมกับVAT INCLUDEDและยอด ไม่เลือกVAT modeจากคำเดียว Per-row VATเดิมมีอยู่แล้วให้reuse; กฎ employee claimable-tax limitation และ financial totals identityตาม §4/9ยังมีผล
- Image/PDF regions: ราคาในฉลากสินค้า/หน้าจอโฆษณาที่อยู่ข้างใบเสร็จไม่แก้ราคาในบิลเอง; amount/date/itemที่ขัดกันแสดง conflict พร้อมแหล่งข้อมูล ห้ามเติม balancing discount/roundingเพื่อปิดยอด
- Destination intent: หน้าร้านเดียวหลายSKUไม่ต้องแตกexpenseต่อSKU; ซื้อสต็อก/สินทรัพย์หรือบริการรับชำระแทนผู้อื่นต้องมีปลายทางและผู้ออกที่ยืนยันได้ตามscope ไม่เดาจากMakro/7-Eleven และไม่เพิ่มstock/asset implementationในงานนี้

### 16.3 Electronic evidence, AI และทางกู้ต่อ

เก็บไฟล์ต้นฉบับพร้อมattachment identity/hash/object versionและสิทธิ; rendered pages/thumbnail/extracted text/redactionต้องอ้างต้นฉบับและเป็นderivative ไม่rewritePDFต้นฉบับ การมีhashยืนยันได้เพียงbytesตรงกัน ไม่รับรองissuer/ความถูกต้องทางภาษี

Reader policyปัจจุบันใช้vision/document provider (E13/E14) และมีrouter-text reuseแล้ว ให้reuseก่อน; nativePDF text layerใช้เป็นหลักฐาน/optimizationได้เมื่อ D02 มีการเทียบrendered page/completeness และprovider/privacy/budget evidence ไม่เปลี่ยนเป็นtext-firstทั่วระบบตามresearchโดยไม่มีการตัดสิน การมีtext layerไม่ได้แปลว่าตรงกับหน้าที่เห็นหรือมีXMLแนบเสมอ

แยกอย่างน้อยสามผล: (1) extraction/completeness (2) electronic document verification (3) expense/reimbursement/tax eligibility. อย่าreuse aiVerificationStatus เป็น cryptographic verdict; D09เลือกrepresentationที่เล็กที่สุดโดยมีmethod, status, reason, checked-at, original file/versionที่ตรวจ และverifier versionเมื่อมีตัวตรวจ

- Baselineแสดงยังไม่ตรวจ/ตรวจไม่ได้ได้ตรงไปตรงมา หากยังไม่มีตัวตรวจอย่าแสดงpassed; timeout/providerไม่พร้อมไม่เท่ากับinvalid/ปลอม ส่วนพบหลักฐานไม่ผ่านต้องมีเหตุผลและทางขอไฟล์จากร้าน/ให้ผู้มีสิทธิตรวจ
- Signature-based e-Tax และ by-Email timestampต้องตรวจด้วยวิธีตรงชนิดเอกสาร; ไม่รับรองไฟล์จากการเป็นPDF/A, อีเมลผู้ส่ง, QR, AI confidence หรือร้านมีชื่อในissuer registryเพียงอย่างเดียว ไม่ออกe-Taxแทนร้าน
- manual upload/shareจากแอป/LINE/อีเมลเป็นขอบเขตแรก ไม่อ่านmailboxทั้งหมด ไม่fetch arbitrary OCR URL/QR ไม่ส่งไฟล์ไปexternal validatorโดยไม่มีprocessor/permissionตามD08/D09
- เก็บemail/receipt companion evidenceที่จำเป็นต่อmethodเมื่อผู้ใช้แนบมาและมีสิทธิ; screenshotช่วยเก็บfactsได้แต่ไม่แปลงเป็นoriginaleTax ไฟล์ติดรหัสใช้เลือกไฟล์อื่น/กรอกต่อ/ขอร้านเป็นbaseline ไม่ร้องขอรหัสในchatหรือprompt/log; การทำunlock UIเป็นงานต้องกำหนดsecret handlingก่อน
- ขนาดสำหรับstorage/upload, ขนาดต่อAI/provider call และpage/item/token budgetsแยกตามD02ด้วยbytesจริง; PDFภายใน10MiBต้องเข้าautomatic processingตาม§16.7 ไม่manual-onlyเพราะเกิน4MB ส่วนerrorจริง/งบไม่พอมีcheckpointและrecovery ไม่บีบอัด/print-to-PDFทับต้นฉบับเพื่อข้ามgate
- Page manifestต้องระบุsource pages/regions, read/missing/partial/failed และdocument grouping การตัดท้าย/มีเกิน40items/หนึ่งแถวอ่านเสียทำให้completenessไม่พร้อมสำหรับitem allocation แม้totalรู้แล้ว ห้ามแสดงอ่านครบจากsummary fallback
- merchant recovery linksเก็บchannel/source date/last verifiedและfallback; คู่มือCJ2024/BigC2025ไม่เป็นSLAปัจจุบันหรือ policyบริษัท ขอลิงก์/ไฟล์จากร้านไม่เท่ากับสมัครบริการ/ยอมรับสินค้าแทนผู้ใช้

### 16.4 หน้าเปลี่ยนใบเสร็จ: contract, state และ UX

**สามintentที่ผู้ใช้แยกได้:** “เปลี่ยนไฟล์ใบเสร็จนี้” ใช้แก้ไฟล์ผิด/อ่านไม่ชัดของงานที่เลือก; “แนบหลักฐานเพิ่ม” ใช้เพิ่มหน้า/slip/e-Tax/เต็มรูปที่ตามมา; “แก้รายการ/เอกสารที่ออกแล้ว” ใช้ correctionตามสิทธิและสถานะ ถ้าเป็นการซื้อใหม่ให้สร้างงานใหม่ตามทางเดิม ไม่เอาfactsใหม่ปนงานเก่า

ก่อนreplace APIต้องรับexpected expense/group revisionและexpected old attachment identity/versionจากตอนผู้ใช้เห็น/เลือกเป้าหมาย ไม่อ่านrevisionล่าสุดตอนcompleteแล้วตีความว่าuserยอมรับทุกอย่างที่เกิดระหว่างupload Operation identityต้องใช้ซ้ำได้เมื่อผลตอบกลับหาย; intentเดิมต่างbytesหรือtargetต้องconflict ไม่สร้างwinnerสองรายการ

Bindingไฟล์ใหม่, ปรับcurrent primary, invalidationผลตรวจของไฟล์เก่า/previewที่เกี่ยวข้อง, audit และretire/detachตามretentionต้องเกิดภายใต้guards/transactionที่ถูกต้อง หากuploadล้มเหลวหรือcommitconflict primaryเดิมและfactsเดิมยังอยู่ ไฟล์ที่ส่งสำเร็จแต่ยังไม่bindจัดเป็นpending/orphanตามcleanupเดิม ไม่แสดงว่าเป็นหลักฐานปัจจุบัน

เมื่อbindสำเร็จแล้วอ่านใหม่ล้มเหลว/ไม่มีสิทธิ/โควตาหมด: ไฟล์ใหม่ยังอยู่ ค่าที่คนเคยตรวจยังรักษาไว้พร้อมข้อความว่าอ้างไฟล์เดิมและต้องตรวจเทียบ ไม่โชว์ค่าเก่าว่าAIอ่านจากไฟล์ใหม่ และไม่คงreadyจากผลตรวจเก่า รูป preview/notice/session retryต้องผูกcurrentattachmentกับrevisionตรงกัน OCRที่กลับช้าต้องไม่เขียนทับไฟล์หรือreviewล่าสุด

| สถานะ/เงื่อนไขก่อนเปลี่ยน | พฤติกรรมที่กำหนด | การอ่านและทางทำต่อ |
|---|---|---|
| DRAFT / NEEDS_REVIEW ที่ไม่มีlock | replaceตามสิทธิและexpected revision; เก็บต้นฉบับที่ยังมีreference/hold; resetผลตรวจที่ผูกไฟล์เก่า ไม่ล้างค่าคนโดยเงียบ | auto rereadเมื่อมีสิทธิและอ่านได้; ถ้าfail/manualให้ตรวจข้อมูลกับไฟล์ใหม่ก่อนready |
| READY_FOR_CONFIRMATION ที่ยังไม่ใช้ลงเงิน/ลงนาม | การเปลี่ยนprimaryที่มีผลต่อหลักฐานต้องกลับNEEDS_REVIEWแบบatomic; ห้ามreadyจากใบเก่า | แสดงผลต่าง/ปุ่มอ่านใหม่หรืออ่านตามpolicyที่กำหนด; ต้องreviewอีกครั้ง ไม่auto-confirm |
| PREPARED ใบรับรอง / พิมพ์แบบฟอร์มแล้ว | primary/material evidenceต้องผ่านsync/revision/invalidatepreviewของใบรับรอง ไม่เปลี่ยนใต้formเดิม; ถ้าเส้นทางยังไม่รองรับให้blockพร้อมเปิดงานแก้เดิม | ไม่ย้ายform/signature candidateไปfactsใหม่; supportingที่ไม่เปลี่ยนfactsใช้flowเดิมตามสิทธิ |
| PAYER_CERTIFIED / ISSUED หรือclaimที่submitแล้ว | genericprimaryreplaceปฏิเสธตามserverguard; ใช้correction/claimflowเดิม | แนบsupplementalได้เฉพาะเส้นทางที่อนุญาตและไม่แก้snapshot; ห้ามปลดguardหรือสร้างใบรับรองซ้ำ |
| มีclaimDRAFTที่อ้างsource | ไม่silentเปลี่ยนยอด/ผู้จ่าย/ต้นฉบับใต้previewใบเบิก; ตรวจdependencyและให้แก้ผ่านflowที่revalidateทั้งsource/claim | resetpreviewตามrevision/สิทธิ หรือblockให้กลับงานเดิมเมื่อยังไม่มีroute; ไม่ใช้DRAFTเป็นข้อยกเว้นอัตโนมัติ |
| CONFIRMED / มีpaymentหรือposting / VOIDED | ไม่ใช้genericreplaceแก้ประวัติ; เส้นทางcorrection/reversal/แนบเพิ่มที่มีจริงเป็นผู้ควบคุม | ไม่re-OCRapplyทับเงิน/บัญชีที่เกิดแล้ว; คงหลักฐานเดิมและบอกปลายทางที่ทำได้ |
| ไม่มีสิทธิ/สาขาหรือสมาชิกเปลี่ยนระหว่างทำ | serverตรวจซ้ำก่อนbind/extract/apply; denyไม่ทำmutationบางส่วน | แสดงเหตุผล ไม่คืนข้อมูลนอกสิทธิ และไม่อ้างไฟล์pendingว่าactive |

เงื่อนไขตารางซ้อนกันให้ใช้ข้อจำกัดที่เข้มกว่า ตรวจทั้ง UI/API/LINE/worker ไม่ใช้disabledbuttonแทนserverguard และอย่าใช้ข้อกำหนดใหม่ลบguardclaim/retentionที่เข้มกว่าอยู่แล้วในremove route

Human-reviewed identity/date/tax/linesยังถูกคุ้มครองตามE18 แต่การเปลี่ยนเป็นใบคนละร้าน/ซื้อใหม่ไม่ใช่เหตุให้เก็บvendorเก่าผสมtotalใหม่: แสดงdiffของmerchant/document/date/items/tax/total/payer hints พร้อมsourceversion และให้คนยืนยันเฉพาะfactsที่เกี่ยวข้องก่อนพร้อม ไม่ตีความช่องที่อ่านไม่ออกเป็นอนุญาตเติมค่าเก่าหรือ0

UX40+: ปุ่มบนmobile/desktopชื่อสอดคล้องกันและอยู่ในบริบทเอกสารที่เลือก; แสดง “กำลังอัปโหลด” แยก “เก็บไฟล์แล้ว กำลังอ่าน” และ “เก็บไฟล์แล้ว ยังอ่านไม่ได้”; retry/remove/replaceไม่ทำให้inputคนหาย มีpreviewซูม/อ่านง่ายและerrorข้อความ ไม่ใช้สีอย่างเดียว ไม่มีการส่งค่าใช้จ่าย/ใบเบิกอัตโนมัติเพราะเปลี่ยนรูปสำเร็จ

### 16.5 หลักฐานซ้ำ, ใบแทน และ corpus

Document relation/duplicate candidatesต้องรวมissuer+branch/reference/date/amount/currencyตามหลักฐานและreview ควบคู่hash/perceptualเดิม; ไม่mergeจากยอดหรือโลโก้เพียงอย่างเดียว ใบเต็มรูปอาจเลขใหม่แต่เป็นซื้อเดิม มีหลายใบในภาพเดียวและคนละซื้อยอดเท่ากันได้ cross-channel retry/lateinvoiceไม่เพิ่มsource consumptionอีกชุด

ทางกู้เอกสารเรียงตามสถานการณ์: มีใบอย่างย่อพอเก็บค่าใช้จ่าย→ขอเต็มรูปเมื่อจำเป็น; ไฟล์เดิมหาย→ประวัติแอป/ขอจากissuer; จ่ายจริงไม่มีหลักฐานพอและเข้าpolicy→W06 DIGITAL/PAPER; ไม่รู้ว่าจ่ายจริง/ยอดขัดกัน→เก็บและตรวจต่อ ใบแทนใบกำกับจากร้านไม่ใช่ใบรับรองมั่งมี และเอกสารที่ตามมาหลังลงนาม/จ่ายแล้วใช้correctionตาม§12

Corpusปัจจุบันมี11retaildocuments/10images/10sourcepages และelectronicguidance5แบรนด์; R7-03เป็นapp screenshot, originalelectronicfilesที่ตรวจsignature/timestampแล้ว=0 ไม่นับคู่มือ/โปสเตอร์/หลายrepresentationเป็นซื้อเพิ่ม ก่อนclaimcoverageต้องมีauthorized current TH positive/negative bundlesของทั้ง5แบรนด์และช่องทางที่เปิด แยกredacted/synthetic extraction testsจากunaltered verification tests เพราะredactionอาจทำให้signatureเสีย; publicURLไม่ใช่trainingpermission เป้าหมาย75purchasesเป็นข้อเสนอเก็บเพิ่ม ไม่ใช่จำนวนที่ทำแล้วหรือเงื่อนไขให้ชะลองานfoundationทั้งหมด

### 16.6 Inventory ผลกระทบและการตรวจรับ

ตารางนี้ครอบทุกboundaryที่พบว่าเกี่ยวข้องในการอ่านsourceรอบนี้; เป็นinventoryสำหรับลงมือ ไม่ใช่คำรับรองว่าได้รันทุกcaller/race ผู้พัฒนาต้องค้นcallersเพิ่มเมื่อเปลี่ยนcontractและบันทึกสิ่งที่ค้นพบในW00

| Boundary / consumers | หลักฐานปัจจุบัน | งาน/ข้อกำหนดที่ต้องตรวจ |
|---|---|---|
| New upload / camera / drop / MIME preparation | E01/E12/E20, ExpensesPages + upload-file.logic | W01/W02; A61/A64/A67/A69/A74, append/resume/same size semantics |
| Replace / reread / remove / mobile viewer | E16–E19, ExpenseReviewPage + expenses.api + removal route | W01–W04/W06; A70–A73, notices/preview/revision/retention/state matrix |
| LINE webhook / router / pending clarification / replies | E10/E15/E19, process-line-webhook + continuation | W01–W04/W06; A45/A68/A69/A71/A72, ambiguityและretry/receipt-vs-signature |
| Gateway reader / prompt / parser / classifier / shared bank-statement read | E13/E14 | W03; A49–A59/A61/A65/A69/A74, preserve non-expense/multi-doc refusalและprovider policy |
| Shared contract / apply / item lines / VAT / source-state | E04/E18/E21 | W01/W03/W04; facts roles, completeness, mixedtax, humanreview/stale result |
| Storage / attachment complete / canonical download / retention | E02/E17/E19/E20 | W01/W02/W07; byte preservation, samefile refs, quarantine/permission, replacement transaction |
| Duplicate candidates / group graph / allocation / reservation | E06/E21 | W01/W04/W05; A54/A55/A63/A69/A71, cross-entrysamepurchaseไม่consumeซ้ำ |
| Expense review / ready / confirm / pay / ledger / reversal | E01/E05/E09/E19 | W01/W04/W05/W07; nofinancialeffectfromcapture, state/correctionและtax guards |
| Reimbursement picker / resolver / draft / submit / projection | E05/E09/E19 | W05/W07; verifiedpayer/fullsource, liveclaimlocks, draftclaimrevalidation, totalsidentity |
| Substitute eligibility / prepare / sign / issue / paper / correction | E07/E19, spec§12 | W06; A60/A63/A72, noauto-certificatefromPDFfailure, actualpayer/retention/payment-once |
| List/count/search / LINE status / export / evidence links | E09, spec§14.3 | W07; hidecapturemoney, source/verificationstatusจริง, originalaccessและnoPIIleak |
| Quota / retry / telemetry / schema compatibility / launch gates | E08/E13/E15, IG08/IG13/IG15 | W01/W02/W03/W08; noextraAIperchild, typedreason, disableintakeยังอ่านงานเดิมได้ |

การตรวจรับต้องบันทึกผ่าน/ไม่ผ่าน/ยังไม่รันรายAและรายsurface ข้อที่ไม่พึ่งช่องทางเช่นDecimalnormalizationใช้sharedunitfixtureได้ แต่A68–A74ต้องมีAPI/UI/LINE integrationตามเงื่อนไข ไม่ใช้unitผ่านแทนDBraceหรือbrowserjourney ต้องทดสอบทั้งordinarysingle-receipt regressionและunsupported/recovery pathsด้วย

### 16.7 PDF 10 MB ต้องอ่านอัตโนมัติได้ — ข้อกำหนดเพิ่ม v0.8

ผู้ใช้ยืนยันว่าลูกค้าต้องส่ง PDF10MBแล้วให้AIอ่านได้ การรับไฟล์ไว้แล้วให้กรอกเองเพียงเพราะเกิน4MBไม่ผ่านข้อกำหนดนี้ กำหนดขอบต้นฉบับเป็น **10MiB = 10,485,760bytes** เพื่อreuseค่าuploaddefaultเดิมและครอบ10MBแบบdecimalด้วย; UI/LINEต้องสื่อขนาดตรงกันและใช้bytesจากservercapability ไม่ยืมเพดานproviderมาเป็นเพดานไฟล์ลูกค้า การรองรับหมายถึงอ่านเอกสารปกติที่ผ่านfile/security/permission checksตามขอบเขตและเกณฑ์คุณภาพ ไม่รับประกันอ่านได้ทุกข้อมูลในไฟล์ที่เสีย/ติดรหัส/ภาพอ่านไม่ออก

ลำดับบังคับ: **รับและเก็บต้นฉบับ → ตรวจ/ทำpage manifest → จัดส่วนอ่านภายใน → อ่านทีละส่วน → รวมfactsพร้อมที่มา → ตรวจความครบและยอด → หน้าตรวจเดิม** ทุกทางรวมหน้าเปลี่ยนใบเสร็จต้องเรียกpipelineเดียวกัน ไม่เพิ่มconstant4→10แล้วส่งPDFทั้งก้อนให้provider

**ขอบภายนอกกับภายในเป็นคนละขอบ:** [AWS Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html) ระบุเอกสารไม่เกิน4.5MBต่อdocument และภาพไม่เกิน3.75MB/8000×8000px ณวันที่ตรวจ2026-09-17; เป็นขอบprovider ไม่ใช่มาตรฐานใบเสร็จ กำหนดtargetภายในเริ่มต้นPDF chunk≤4,000,000bytes และภาพ/region≤3,500,000bytes/ไม่เกิน8000pxต่อด้านเพื่อมีmargin ทั้งนี้effective limitต้องไม่เกินmodel/providerที่เลือก และD02ต้องพิสูจน์quality/body/token/runtime budgetsก่อนเปิดใช้ ต้องวัดขนาดที่serializeจริงรวมbase64และcontextทั้งหมดด้วย (mediaHTTProuteปัจจุบัน16mbตามE23)

**การจัดส่วนอ่านที่เลือก:**

1. ฝั่งAPIที่มีสิทธิเข้าถึงattachmentเป็นผู้prepareต้นฉบับ/derivatives โดยreusepdf-lib/pdfjs-dist/sharpและpatternE22ก่อนเพิ่มdependency ไม่ย้ายAI Gatewayไปอ่านdatabaseหรือoriginalobjectsข้ามpermission boundary ตัวอย่างcopyPagesอยู่ใน [เอกสารpdf-lib](https://pdf-lib.js.org/docs/api/classes/pdfdocument#copypages); การcopyหน้าไม่ได้รับประกันว่าแต่ละไฟล์เล็กลงตามจำนวนหน้าต้องวัดoutputbytesจริง
2. เอกสารหลายหน้า: copyหน้าหรือกลุ่มหน้าขนาดเหมาะสมเป็นderivative PDFที่อยู่ในขอบbytes/page/tokenจริง ปรับกลุ่มเมื่อมีหน้าใหญ่หรือบริบทมาก ไม่หาร10MBด้วย4MBแล้วสมมติว่าจะได้3chunkเสมอ และไม่ส่งทุกchunkกลับเข้าrequestเดียวจนเกินขอบรวม
3. หากหน้าเดียวเกินขอบหรือcopyแล้วยังใหญ่: renderสำเนาหน้านั้นเป็นภาพที่มีรายละเอียดเพียงพอ ถ้าลดขนาดทั้งหน้าแล้วตัวเลข/ภาษาไทยเล็กเกินเกณฑ์ ให้แบ่งregions/tilesพร้อมoverviewสำหรับlayoutและพิกัดในหน้าต้นฉบับ/ส่วนซ้อนที่จำเป็น ระบบเป็นผู้ทำ ไม่ให้ลูกค้าตัดPDFเอง การrenderต้องboundedpixels/memory ไม่decodeทุกหน้าความละเอียดสูงพร้อมกัน
4. Native text layerใช้ร่วมเป็นหลักฐาน/ช่วยเลือกregionเมื่อผ่านD02และเทียบกับrenderedpageได้; ไม่เชื่อhidden/text-layerที่ขัดกับสิ่งที่เห็น และไม่เปลี่ยนvision policyเดิมอัตโนมัติ สำเนาที่split/rasterใช้เพื่ออ่านเท่านั้น signature/timestampและbyteintegrityต้องอ้างoriginalไม่ใช่derivative
5. Gatewayคืนobservationsแยกdocument/page/region/lineและread completeness ก่อนERPรวมfactsข้ามchunk ต้องเชื่อมheader/issuerต้นใบกับtotalท้ายใบจากหลักฐาน, เก็บunassignedเมื่อไม่รู้; row/total/discountซ้ำเพราะoverlapหรือfooterไม่นับซ้ำ แต่สินค้าชื่อเหมือนกันจริงห้ามdedupด้วยข้อความอย่างเดียว
6. การรวมผลต้องboundedเช่นกัน ไม่เอาtranscriptionหลายร้อยหน้ารวมลงprompt/output4096tokensแล้วตัดท้าย แบ่งdocument/rowgroupsต่อได้โดยรักษาIDs/provenance ก่อนreconcileระดับdocument/purchaseด้วยDecimalตาม§6/16.2; หนึ่งPDFหลายซื้อยังเป็นหลายdocument/purchaseและไม่สร้างexpenseต่อchunk

**งานอ่านที่ทำต่อได้:**

- ต้นฉบับต้องpersistก่อนบอก“เก็บไฟล์แล้ว”; page manifest/jobต้องผูกcompany/actor/chatหรือWebwork/attachmenthash+objectversion/preprocessversion และsource revision มีสถานะpreparing/reading/partial/paused/needs-reviewตามจริง ไม่ขวางUIรอproviderหลายcallจนHTTPtimeout
- เลือกdurable runnerจากinfra/patternเดิมในW00/D02 พร้อมlease/checkpoint/reclaim/idempotency/cancel ไม่สร้างmicroserviceหรือqueueproductใหม่โดยไม่มีเหตุ; LINEread-onlyledgerdrainในE24ไม่ใช่receiptmutationworkerที่reuseตรง ๆ ได้ ผลGatewayยังเป็นsuggestionsและERPเป็นผู้applyผ่านสิทธิ/locks
- บันทึกผลแต่ละchunkที่สำเร็จก่อนรับงานถัดไป จำกัดconcurrencyและresource budgetsต่อjob/tenant; processตายหรือผลHTTPหายให้reuseผลเดิม/attemptidentity ไม่อ่านทุกหน้าใหม่ ไม่สร้างexpense/claimเพิ่มและไม่ใช้leaseexpiredเป็นหลักฐานว่าproviderไม่ได้ทำงาน
- เปลี่ยนprimary/แก้review/สิทธิเปลี่ยนระหว่างอ่านต้องตรวจrevisionและactorใหม่ก่อนแต่ละapply/notification; งานเก่าคงstale/cancelledobservationsตามretention ไม่ทับไฟล์หรือข้อมูลปัจจุบัน และไม่ส่งผลให้chat/actorที่เสียสิทธิ
- แยกlogicalcustomerjobจากprovidercalls/subattemptsในusageledger รักษาquota/billinggovernanceเดิม; D02ต้องmapadmission/reservation/retry/chargeก่อนเปิด ไม่เงียบคิดหนึ่งchunkเป็นใบเสร็จลูกค้าใหม่ทุกครั้งหรือให้readไม่จำกัด หากงบไม่พอแสดงpausedพร้อมผลที่เก็บและทางทำต่อ ไม่อ้างสำเร็จจากหน้าที่อ่านบางส่วน
- ขนาด10MBไม่ได้จำกัดจำนวนหน้า/decodedpixels/tokencost จึงต้องมีpage-per-batch/time/pixels/memory/concurrency budgetsพร้อมcheckpoint; จำนวนหน้ามากให้แบ่งรอบงานอัตโนมัติเมื่ออยู่ในentitlement/budget ถ้าจำเป็นต้องpauseให้ระบุเหตุจริง ไม่บังคับsplitไฟล์หรือใช้pagecapเงียบ ๆ เพื่อผ่านA75

**UXเมื่อส่งไฟล์10MB:** แสดง“เก็บไฟล์แล้ว กำลังอ่านเอกสาร” แล้วบอกจำนวนหน้าที่อ่านสำเร็จจากmanifestเมื่อรู้จริง เช่น“อ่านแล้ว6จาก12หน้า”; ไม่สัญญาเวลาแน่นอนก่อนวัด ผู้ใช้ปิดหน้าแล้วกลับงานเดิมได้ ในLINEใช้receipt/pendingworkและdeliveryที่ตรวจสิทธิ/ผลจริง ไม่ใช้replytokenที่หมดอายุแล้วอ้างแจ้งสำเร็จ เมื่ออ่านล้มเหลวให้แจ้งว่าเก็บไฟล์แล้วพร้อมลิงก์ไปWebงานเดิมเพื่อกรอกเฉพาะข้อมูลที่ขาดตาม§17.6 ไม่เสนออ่านซ้ำหรือย้อนให้กรอกทุกช่องใหม่

**เงื่อนไขถือว่ารองรับ10MBแล้ว:** A75–A80ผ่านบนทั้งสามทางด้วยnative/scanned/mixed PDFและsingle-page large-imageจริงตามfixtureที่มีสิทธิ พร้อมtinyThai text/money accuracy, page coverage, partial retry/worker recovery, original-byte preservation, source-version race และbudgetsที่วัดได้ ห้ามอ้างผ่านจากไฟล์เล็กที่เติมpaddingให้ครบ10MBอย่างเดียว คงmanual recoveryสำหรับerrorจริงแต่ไม่ใช้เป็นทางปกติของเอกสาร10MBที่อ่านได้

### 16.8 PDF หลายหน้า — ต้องอ่านครบและรวมตามเอกสาร

ผู้ใช้ย้ำว่าต้องรองรับหลายหน้า ข้อกำหนดนี้ใช้ทั้งไฟล์เล็กกว่า4MBและไฟล์ถึง10MiB ผ่าน LINE AI, อัปโหลดใหม่ และเปลี่ยนใบเสร็จ ไม่ถือว่าอ่านได้ครบจากการที่ provider รับ PDF สำเร็จเพียงอย่างเดียว

| รูปแบบไฟล์ | พฤติกรรมที่ต้องได้ |
|---|---|
| ใบเสร็จ/ใบกำกับเดียวต่อหลายหน้า | อ่านรายการทุกหน้า เชื่อมผู้ออก/เลขเอกสารจากหัวใบกับยอดท้ายใบ; ยอดยกไป/ยกมาและหัว/ท้ายที่พิมพ์ซ้ำไม่ใช่รายการซื้อหรือยอดจ่ายเพิ่ม |
| หลายใบเสร็จ/หลายร้านรวมไฟล์เดียว | ตรวจขอบเอกสารและความสัมพันธ์กับการซื้อ แล้วให้ตรวจกลุ่มก่อนสร้างปลายทางการเงิน; ไม่ถือว่าหนึ่งหน้าเท่ากับหนึ่งบิล หรือหนึ่งไฟล์เท่ากับหนึ่งexpense |
| หน้า native text, สแกนภาพ และหน้าผสม | เลือกส่วนอ่านภายในตาม§16.7 แต่เก็บลำดับและที่มาครบ; ขนาดไฟล์เล็กไม่ใช่เหตุให้ข้ามการตรวจจำนวนหน้า/ข้อความที่ตัดท้าย |
| หน้าว่าง/กลับหัว/อ่านไม่สำเร็จ | ประเมินแต่ละหน้าก่อนระบุว่าว่าง; ความมั่นใจต่ำหรือrenderล้มเหลวไม่ถูกนับเป็นหน้าว่าง และไม่ทำให้งานแสดงอ่านครบ |
| เลขหน้าระบุ1/3และ3/3 แต่ไฟล์มี2หน้า | file coverageอาจครบ2/2 แต่document completenessต้องแจ้งสงสัยขาดหน้า2; เปิดทางแนบหลักฐานเพิ่มในงานเดิมตามสิทธิ ไม่สร้างค่าใช้จ่ายใหม่หรือแต่งข้อมูลส่วนที่หาย |

**การนับความครบ:** manifestต้องครอบ physical page ทุกหน้าที่พบ พร้อมสถานะ pending/read/partial/failed หรือ inspected-blank และ mapping ไป document/region; เก็บ printed page number แยกจากลำดับในไฟล์ หน้าที่ตรวจแล้วว่างนับเป็น covered ได้ แต่ไม่แสดงว่าได้อ่านรายการสินค้า ผู้ใช้เห็น “ตรวจแล้ว8จาก10หน้า — 2หน้ายังอ่านไม่สำเร็จ” ได้ตามผลจริง การได้ total จากหน้าท้ายไม่ทำให้ item completeness ผ่านก่อนอ่านหน้ารายการครบ

**ความสัมพันธ์และหน้าที่ขาด:** ใช้เลขเอกสาร/ผู้ออก/เลขหน้าที่พิมพ์/continuationและlayoutเป็นหลักฐานร่วม ไม่ใช้ชื่อร้านเหมือนกันเพื่อรวมบิลโดยอัตโนมัติ ถ้าไม่มีเลขหน้าไม่อนุมานว่าต้องมีหน้าหาย; ถ้าหลักฐานขัดกันให้คงunassigned/conflict และชี้หน้าที่ต้องตรวจ การแนบหน้าที่ขาดทำให้manifest/group revisionเปลี่ยน ต้องตรวจซ้ำเฉพาะส่วนและความสัมพันธ์ที่ได้รับผล ก่อนยอมใช้ผลรวมใหม่ โดยรักษาค่าที่ผู้ใช้ตรวจแล้วและกฎsource/claim/certificateเดิม

**จำนวนหน้ากับขนาดไฟล์:** ไม่ใช่ขอบเดียวกันและยังไม่มีตัวเลขเพดานหน้าที่พิสูจน์แล้ว ห้ามนำเพดาน17หน้าของcertificate previewมาใช้กับตัวอ่านใบเสร็จ D02/W00ต้องระบุจำนวนหน้าที่รองรับจริงและpage/pixel/token/time/usage budgetsจากการวัดก่อนเปิดลูกค้า; Web/LINEอ่านcapabilityเดียวกัน ไม่ประกาศรองรับไม่จำกัดหน้า ถ้าเกินขอบที่ประกาศต้องแจ้งเหตุ/เก็บผลที่persistแล้วพร้อมทางทำต่อ ไม่ตัดเหลือหน้าแรกหรือNหน้าโดยเงียบ

**ชุดตรวจรับ A81/A82 ร่วมกับ A75–A80:** ทดสอบ2,5,10,20หน้าแบบอ่านครบทั้งใบเดียวและหลายใบ ผสมnative/scanned/mixedและไฟล์เล็กกว่า4MB/ใกล้10MiB; 20หน้าต้องพิสูจน์ว่าไม่ติดcap17หน้าที่ไม่เกี่ยวข้อง เพิ่ม50/100หน้าและไฟล์ที่อยู่บนขอบจำนวนหน้าที่D02เลือกเพื่อวัดทรัพยากร/แบ่งรอบ/หยุดและทำต่อ ตัวเลขชุดทดสอบไม่ใช่เพดานที่เปิดขายหรือSLA จัดคู่fixtureหน้าเปล่าที่ตรวจจริงกับหน้าที่render/อ่านล้มเหลว, หน้าเลขขาด, carry-forward, มากกว่า40รายการ และgroupingไม่แน่ชัด การทดสอบ50/100หน้าที่เพียงpauseถูกต้องยังไม่ใช่หลักฐานว่าอ่านครบ50/100หน้าได้

UXใช้หน้าตรวจเดิมเป็นสรุปบิล/ร้านและยอด พร้อมปุ่มดูหน้าที่อ้างอิง ผู้ใช้ไม่ต้องจัดchunkเอง ถ้าหน้า7อ่านไม่สำเร็จให้ลิงก์กรอกส่วนที่ขาดบนWebงานเดิม; ถ้าต้นฉบับขาดหน้าให้แนบหลักฐานเพิ่มในหน้าเดิม ไม่สร้างใบรับรองแทนใบเสร็จโดยอัตโนมัติเพื่อทำให้งานดูเสร็จ


**ยืนยันช่องทาง LINE เพิ่มเติม (2026-09-17):** [LINE Help — ส่งไฟล์](https://help.line.me/line?contentId=20007005) ระบุมือถือใช้ปุ่ม+→Fileและคอมพิวเตอร์ลากไฟล์เข้าแชตได้; [LINE Developers — รับเนื้อหาจากผู้ใช้](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) รองรับรับfileผ่านwebhook/message IDแล้วดาวน์โหลดcontent ไม่ต้องให้ผู้ใช้ส่งภาพทีละหน้าเพียงเพราะPDFมีหลายหน้า แหล่งที่ตรวจนี้ไม่ได้ยืนยันเพดานPDFขาเข้าทุกclient จึงไม่ยืมตัวเลขขนาดภาพขาออกของMessaging APIมาเป็นfile cap; W08ต้องทดสอบclientที่รองรับกับไฟล์จริง

สำหรับมั่งมี E15/IG20ยืนยันจากsourceว่าทางรับLINE file/PDFปัจจุบันยังข้ามOCR preflightเพราะไม่มีcontentBase64 ข้อกำหนดA68/A75/A81ต้องทดสอบตั้งแต่raw message.type=file ผ่านdownload/validation/persist/manifest/reader/review รวมส่งโดยไม่มีข้อความ, ส่งพร้อมข้อความแยกที่bufferจับคู่, และข้อความตอบclarificationภายหลัง ไม่injectcontentBase64ในfixtureจนข้ามจุดเสียจริง การแก้ต้องreuseboundedpipeline§16.7 ไม่ส่งต้นฉบับ10MBตรงให้provider

ต้นฉบับที่รับจากLINEต้องเก็บตามสิทธิ/retentionก่อนอ้างว่าเก็บสำเร็จ เพราะLINEระบุcontentจะถูกลบหลังเวลาหนึ่งและไม่ได้ให้ใช้เป็นที่เก็บถาวร; หากดาวน์โหลดไม่ได้หรือหมดอายุ ให้ส่งไฟล์อีกครั้งหรือเปิดทางอัปโหลดเดิมที่ผูกงาน/สิทธิเดิม โดยไม่สร้างexpenseซ้ำ ไม่กำหนดอายุ7วันเอง เมื่อดาวน์โหลดและเก็บสำเร็จแล้ว งานอ่านต่อใช้สำเนาต้นฉบับของระบบ ไม่ย้อนพึ่งไฟล์ในแชตสำหรับทุกretry


<a id="error-recovery"></a>
## 17. ข้อความแจ้งปัญหาและทางทำต่อ — v0.9

มีrecovery principlesใน§3/7/8/13/16แล้ว ส่วนนี้ทำให้เป็นข้อกำหนดข้อความ/ปุ่ม/สถานะร่วมที่ตรวจรับได้สำหรับผู้ใช้40+และผู้ใช้ทุกวัย ไม่ถือว่าแอปปัจจุบันทำครบหรือผ่านusabilityแล้ว ตัวอย่างข้อความด้านล่างเป็นcopyตั้งต้น ต้องผูกกับผลจริง ไม่ให้AIแต่งสถานะหรือคำมั่นขึ้นเอง

### 17.1 ทุกข้อความตอบสามเรื่องและมีทางที่ทำได้จริง

1. **เกิดอะไรขึ้น:** ใช้คำที่ผู้ใช้เข้าใจ เช่น “ยังอ่านหน้า7ไม่ได้”; คำว่ารูป/ไฟล์/เอกสารตรงกับสิ่งที่ส่ง ไม่โยนHTTP code, token, providerหรือstack traceให้ผู้ใช้แก้
2. **ข้อมูลถึงขั้นไหนแล้ว:** แยกยังไม่ส่ง/กำลังตรวจผล/เก็บต้นฉบับแล้ว/อ่านบางส่วน/ร่าง/ส่งอนุมัติ/ลงนาม/จ่ายแล้ว ใช้สถานะserverที่ผู้ใช้มีสิทธิ์ดู; ไม่บอก“ข้อมูลไม่หาย”หรือ“ยังไม่บันทึก”ทุกerrorโดยไม่รู้ผล
3. **ทำอะไรต่อ:** ปุ่มหลักหนึ่งทางที่ใช้ได้ในขณะนั้น พร้อมทางพักหรือกรอกต่อเมื่อมีสิทธิ์ ถ้าต้องแนบไฟล์ใหม่ให้ขอเฉพาะไฟล์/หน้าที่ขาด ไม่ล้างช่องที่คนตรวจแล้ว

แยกrecoverable, ต้องผู้ใช้แก้, รอสิทธิ์/งบ, ถูกล็อก และunknown outcome ปุ่ม“ลองใหม่”ไม่ใช่คำตอบเดียวทุกกรณี; security/quota/permission/issued-lockต้องไม่วนretryเพื่อข้ามguard ทางขอความช่วยเหลือมีได้เมื่อระบบมีช่องทาง/ผู้รับจริงเท่านั้น การส่งหาใครต้องใช้สิทธิ์และการยืนยันตามflowเดิม ไม่แสดง“ส่งให้บัญชีแล้ว”จากเพียงการเสนอปุ่ม

เมื่อมีหลายปัญหาพร้อมกัน ให้ตรวจสิทธิ์ก่อนเปิดเผยข้อมูล จากนั้นแสดงunknownผลการเงิน/การบันทึกที่ต้องตรวจสถานะก่อน แล้วจึงปัญหาไฟล์หรือการอ่านตามactionที่ผู้ใช้กำลังทำ ไม่ยิงหลายtoastหรือให้ปุ่มที่ขัดกัน งานอื่นที่ไม่ขึ้นกับปัญหานี้และยังมีสิทธิ์ทำต่อได้ การรอ/retryอัตโนมัติต้องมีขอบเวลา/จำนวนรอบตามD02 เมื่อยังตรวจไม่ได้ให้บอกว่ายังยืนยันผลไม่ได้และเปิดทางพัก ไม่ปล่อยspinnerไม่สิ้นสุดหรือสัญญาเวลาเสร็จเอง

### 17.2 ตารางสถานการณ์และข้อความตั้งต้น

ค่าในวงเล็บปีกกามาจากข้อมูลที่ตรวจแล้วเท่านั้น หากไม่มีข้อมูลให้ใช้ข้อความที่ไม่ระบุค่า การอ้าง“เก็บไฟล์แล้ว”ต้องมีpersisted identityก่อนเสมอ; แต่ละแถวอาจมีvariantตามreason/persist-state ไม่เอาข้อความsuccessจากแถวหนึ่งไปครอบunknownของอีกแถว

| รหัสกรณี | เมื่อเกิด | ข้อความตัวอย่าง | ปุ่มหลัก/ทางทำต่อ | กฎรักษาข้อมูลและข้อห้าม |
|---|---|---|---|---|
| UXE-01 | อัปโหลดไม่สำเร็จและยืนยันว่าไม่ถูกเก็บ | ยังส่งไฟล์นี้ไม่สำเร็จ | ส่งไฟล์นี้อีกครั้ง | รักษาค่าที่มีอยู่; ไม่อ้างเก็บbytesที่ยังไม่ถึง และขอเลือกไฟล์ใหม่เฉพาะที่browserไม่มีแล้ว |
| UXE-02 | คำตอบบันทึกหาย/ไม่ทราบว่าcommitสำเร็จหรือไม่ | กำลังตรวจสอบว่าไฟล์นี้บันทึกสำเร็จหรือยัง | ตรวจสอบสถานะ | ใช้operationเดิม; ไม่อ้างล้มเหลวหรือให้สร้างใหม่จนresolveสถานะ; ขณะตรวจปิดปุ่มmutationซ้ำ |
| UXE-03 | LINEดาวน์โหลดไม่ได้/หมดอายุ | ยังรับไฟล์นี้จาก LINE ไม่สำเร็จ | ส่งไฟล์อีกครั้ง | ระบุหมดอายุเฉพาะมีหลักฐาน; มีทางอัปโหลดผ่านเว็บผูกงานเดิมตามสิทธิ ถ้าไม่มีงานpersistห้ามอ้างว่ามีร่างแล้ว |
| UXE-04 | ชนิดไฟล์ไม่รองรับ/นามสกุลไม่ตรง | ไฟล์นี้ยังเปิดอ่านไม่ได้ กรุณาเลือก {ชนิดไฟล์ที่รองรับ} | เลือกไฟล์อื่น | รายการชนิดมาจากcapabilityจริง; ไม่ให้เปลี่ยนนามสกุลอย่างเดียวหรือแนะนำZIPเมื่อAPIไม่รองรับ |
| UXE-05 | ขนาดต้นฉบับเกินขอบจริง | ไฟล์นี้ขนาด {ขนาดไฟล์} เกินขนาดที่รับได้ {ขนาดที่รองรับ} | เลือกไฟล์อื่น | ทั้งสามทางใช้bytes/หน่วยเดียวกัน; PDFภายใน10MiBต้องเข้าการอ่านอัตโนมัติ ไม่ส่งมาข้อความนี้เพราะprovider4MB |
| UXE-06 | PDFมีรหัสผ่าน | ไฟล์นี้มีรหัสผ่าน จึงยังอ่านไม่ได้ | เลือกไฟล์ที่เปิดอ่านได้ | เก็บไว้ก่อน/กรอกเฉพาะข้อมูลได้ตามสิทธิ; ไม่ขอรหัสในLINE/prompt/log และไม่อ้างว่าปลดรหัสให้แล้ว |
| UXE-07 | PDFเสียหายหรือเปิดไม่ได้ | เปิดไฟล์นี้ไม่สำเร็จ กรุณาดาวน์โหลดจากต้นทางแล้วส่งใหม่ | เลือกไฟล์ใหม่ | ระบุไฟล์เสียเฉพาะตรวจพบ; รักษาร่าง/ไฟล์อื่นที่persistแล้ว ไม่ตีความว่าไม่มีใบเสร็จ |
| UXE-08 | ตรวจพบไฟล์ไม่ผ่านความปลอดภัย | ไฟล์นี้ไม่ผ่านการตรวจความปลอดภัย จึงยังใช้เป็นหลักฐานไม่ได้ | เลือกไฟล์อื่น | ไม่เปิดอ่านAI/previewไฟล์ที่ถูกกัก; ไม่ส่งrawscannerdetailและไม่ใช้manual overrideผ่านquarantine |
| UXE-09 | บริการตรวจความปลอดภัยขัดข้อง | ยังตรวจความปลอดภัยของไฟล์นี้ไม่ได้ จึงยังไม่เริ่มอ่าน | ตรวจอีกครั้งเมื่อพร้อม | คงpending/quarantineตามretention; ไม่เรียกไฟล์ว่าอันตรายเพียงเพราะscannerล่ม และไม่ข้ามscan |
| UXE-10 | AIอ่านไม่สำเร็จหลังรับและเก็บไฟล์แล้ว | อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่ | กรอกข้อมูลต่อ | ลิงก์ไปงานเดิมบนเว็บตาม§17.6; ไม่เสนออ่านใหม่/ให้กรอกในแชต ถ้างานยังrunningหรือผลunknownให้ตอบสถานะจริงก่อน ไม่เรียกfailedเอง |
| UXE-11 | บริษัทปิดAI/ไม่มีproviderที่รองรับ | เก็บไฟล์แล้วค่ะ ขณะนี้ระบบอ่านเอกสารให้อัตโนมัติไม่ได้ กดกรอกข้อมูลต่อได้ที่นี่ | กรอกข้อมูลต่อ | บอกreasonจริงเมื่อถามต่อ; ใช้ไฟล์และข้อมูลเดิมในเว็บ ไม่วนอ่านหรือให้ลูกค้าแก้configurationเอง |
| UXE-12 | โควตาอ่านหมด/งบอ่านที่ได้รับอนุญาตไม่พอ | ใช้สิทธิ์อ่านเอกสารครบแล้วค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่ | กรอกข้อมูลต่อ | กล่าวว่าเก็บแล้วเฉพาะpersistยืนยัน; จำนวน/รอบมาจากserver ไม่ซื้อแพ็กเกจหรือเริ่มอ่านใหม่จากerror link |
| UXE-13 | อ่านได้บางหน้า/บางข้อมูลไม่ชัด | อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่ | กรอกข้อมูลต่อ | Webเติมผลที่อ่านได้และชี้ข้อมูล/หน้าที่ขาด; ไม่เสนอOCRซ้ำ ไม่ล้างผลที่มีและไม่อ้างครบจากยอดท้ายใบ |
| UXE-14 | การอ่านหยุดก่อนครบเพราะขอบทรัพยากร/เวลาที่อนุญาต | เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่ | กรอกข้อมูลต่อ | เปิดWebงานเดิมพร้อมผลที่มีและเหตุจริง; ไม่สั่งผู้ใช้แบ่งไฟล์เพียงเพราะ4MBหรือเริ่มOCRรอบใหม่จากerrorlink; ถ้ายังเป็นงานrunningให้แสดงสถานะงานจริงตาม§17.6 |
| UXE-15 | หลักฐานบ่งชี้หน้าขาด | เอกสารระบุ {จำนวนหน้าที่พิมพ์} หน้า แต่ไฟล์นี้มี {จำนวนหน้าที่พบ} หน้า กรุณาตรวจหน้าที่ขาด | แนบหลักฐานเพิ่ม | ใช้เมื่อมีevidence; retryOCRแก้หน้าที่ไม่มีในต้นฉบับไม่ได้; appendงานเดิมและinvalidateเฉพาะผลที่กระทบ |
| UXE-16 | ยอด/ส่วนลดขัดกัน หรือไม่แน่ใจว่าคนละบิล | ยังสรุป {ยอดเงินหรือกลุ่มบิลที่มีปัญหา} ไม่ได้ กรุณาตรวจข้อมูลที่ทำเครื่องหมาย | ตรวจจุดที่ไม่ตรง | แสดงค่าคู่แข่งและหน้าอ้างอิง/รับคำตอบบางส่วน; ไม่หักส่วนลดสมมติหรือบังคับค่าให้ผ่าน; พักเฉพาะการเงินที่พึ่งข้อมูลนี้ |
| UXE-17 | การตรวจelectronicไม่พร้อมหรือพบข้อไม่ผ่าน | กรณียังตรวจไม่ได้: อ่านข้อมูลได้ แต่ยังตรวจสอบเอกสารอิเล็กทรอนิกส์ไม่ได้ | ดูรายละเอียดการตรวจ | คำว่าอ่านข้อมูลได้ใช้เมื่อextractionสำเร็จจริงเท่านั้น; พบข้อไม่ผ่านใช้ข้อความต่างกันพร้อมเหตุจริงและให้ผู้มีสิทธิตรวจ; ไม่เรียกปลอมจากtimeout ไม่ให้OCRsuccessแทนverificationหรือtaxapproval |
| UXE-18 | sessionหมด/สิทธิ์ดูหรือแก้ถูกถอด | กรณีsessionหมด: กรุณาเข้าสู่ระบบอีกครั้งเพื่อทำต่อ; กรณีไม่มีสิทธิ์: บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ | เข้าสู่ระบบ / กลับรายการที่มีสิทธิ์ | เลือกactionตรงreason; ตรวจสิทธิ์ก่อนโชว์สถานะ/ชื่อบิล/ไฟล์ ไม่รับรองว่าผู้ใช้ยังเห็นข้อมูลเดิม ห้ามแสดงปุ่มแก้ข้ามสิทธิ์ |
| UXE-19 | เปลี่ยนไฟล์ล้มเหลวและยืนยันว่าไม่bind | ยังเปลี่ยนไฟล์ไม่สำเร็จ ใบเสร็จเดิมยังใช้อยู่ | ลองเปลี่ยนไฟล์อีกครั้ง | ใช้เมื่อcurrentattachmentยังเดิมจริง; ถ้าไม่รู้ผลใช้UXE-02 ไม่ยืนยันprimaryจากcache |
| UXE-20 | เปลี่ยนไฟล์สำเร็จแต่AIอ่านใหม่ไม่สำเร็จ | เปลี่ยนไฟล์แล้วค่ะ แต่ยังอ่านข้อมูลไม่สำเร็จ กดกรอกข้อมูลต่อได้ที่นี่ | กรอกข้อมูลต่อ | เปิดcurrentattachment/versionจริงบนหน้าเดิม; แสดงค่าที่คนตรวจแล้วพร้อมที่มาว่าอ้างไฟล์เก่า ไม่คงreadyจากใบเก่า ไม่มีretryOCRจากลิงก์ |
| UXE-21 | มีคนแก้รายการ/เปลี่ยนไฟล์ระหว่างทำงาน | รายการนี้มีการเปลี่ยนแปลง กรุณาเปิดข้อมูลล่าสุดก่อนทำต่อ | เปิดข้อมูลล่าสุด | รักษาค่าที่แก้ไว้เพื่อเทียบเท่าที่มีสิทธิ์ ไม่overwriteอัตโนมัติ; stale jobไม่applyหรือแจ้งผลเก่าเป็นปัจจุบัน |
| UXE-22 | ส่งอนุมัติ/ลงนาม/จ่ายแล้ว จึงแก้ตรงนี้ไม่ได้ | รายการนี้ {สถานะจริง} แล้ว จึงเปลี่ยนใบเสร็จตรงนี้ไม่ได้ | เปิดรายการเดิม | เสนอcorrection/แนบเพิ่มเติมเฉพาะrouteที่สถานะ/สิทธิ์รองรับ; ไม่สร้างรายการซ้ำหรือปลดล็อกเพื่อแก้error |
| UXE-23 | พบใบเสร็จที่อาจซ้ำ | พบรายการที่อาจเป็นใบเสร็จเดียวกัน กรุณาตรวจสอบก่อนบันทึกเพิ่ม | ตรวจรายการที่พบ | แสดงเฉพาะcandidateที่ดูได้; ไม่กล่าวหาซ้ำแน่นอนจากยอดหรือชื่อร้าน และไม่merge/deleteแทนผู้ใช้ |
| UXE-24 | สร้างใบเบิก/ออกใบรับรอง/ผลการเงินหาย หรือสำเร็จบางร้าน | กำลังตรวจสอบผลรายการ {รายการที่เข้าถึงได้} ก่อนทำต่อ | ตรวจสอบสถานะรายการ | reuseoperation/handoff/certificate identity; สำเร็จร้านAคงไว้และทำต่อB ไม่จ่าย/ออกซ้ำ; LINEยังไม่ทำfinancialfinalizationและไม่อ้างยกเลิกเงินจากcancelอ่าน |
| UXE-25 | บันทึกหรืออ่านสำเร็จแต่ส่งผลในLINEไม่สำเร็จ | ในหน้าสถานะที่เข้าถึงได้: {ผลที่ยืนยันแล้ว} แต่ยังส่งข้อความแจ้งผลไม่สำเร็จ | เปิดผลรายการเดิม | ไม่มีข้อความส่งถึงไม่ได้แปลว่างานล้มเหลว; ส่งผลเดิมเมื่อdeliveryอนุญาต/ผู้ใช้กลับมา ไม่replayOCRหรือcreation ไม่อ้างว่าผู้ใช้เห็นข้อความนี้แล้ว |
| UXE-26 | ไม่มีใบเสร็จ/หลักฐานไม่พอ | รายการนี้ยังขาดหลักฐาน กรุณาเพิ่มเอกสารที่มี | เพิ่มหลักฐาน | เสนอใบรับรองแทนใบเสร็จเฉพาะรายจ่ายจริงและeligibilityผ่านตาม§12; ไม่มีใบกำกับหรือAIอ่านพลาดไม่ใช่เหตุออกใบรับรองอัตโนมัติ |
| UXE-27 | ข้อผิดพลาดที่ยังจัดประเภทไม่ได้ | เกิดปัญหาระหว่างทำรายการ กำลังตรวจสอบสถานะล่าสุด | ตรวจสอบสถานะ | ไม่เดาnetwork/provider/เงิน/การเก็บไฟล์; ถ้าสถานะยังตรวจไม่ได้ให้บอกยังยืนยันไม่ได้และพัก/กลับรายการเดิมตามสิทธิ์ มีรหัสอ้างอิงปลอดภัยเมื่อมีจริง ไม่แสดงstacktraceหรือสัญญาแจ้งทีมแล้ว |


### 17.3 Contract และ implementation ที่เล็กที่สุด

Reuseerror reasons, upload/extraction outcomes, pendingwork/operation IDs, dictionary, UI noticeและLINE reply helpersเดิม ไม่สร้างglobal error platformหรือเพิ่มserviceใหม่เพื่อข้อความนี้ W00/D02/D06ต้องmapreasonจริงทุกจุดไปcopy/actionที่ตั้งใจไว้ และมีunknownfallbackสำหรับreason/schemaที่ยังไม่รู้จัก; UXEเป็นรหัสกรณีตรวจรับ ไม่ใช่การสั่งเพิ่มAPI enum27ตัวโดยอัตโนมัติ

ข้อมูลขั้นต่ำที่ต้องหาได้จากresponse/statusเดิมหรือขยายเท่าที่ขาด: ขั้นตอนที่มีปัญหา, reasonที่จำแนกได้, operation/work/attachmentและrevisionที่มีสิทธิ์, persist/read/financial-stateที่serverยืนยันหรือunknown, รายไฟล์/หน้าที่สำเร็จ/ค้าง, allowed next actionsพร้อมtargetและretryability/cooldownจริง ข้อมูลนี้อาจอยู่ในหลายcontractเดิม ไม่บังคับสร้างenvelopeใหม่ให้ทุกAPI ยอด/ส่วนลด/ผู้จ่ายหรือreceipt textไม่ถูกส่งเป็นrawdebugdataในerror message/log

Unknown mutationต้องตรวจสถานะoperationเดิมก่อนสร้างใหม่; knownretryใช้identityเดิมตามgovernanceและอ่านเฉพาะส่วนค้าง ห้ามรับรอง“ไม่เสียโควตา/ไม่คิดเงินเพิ่ม”หากไม่มีledgerยืนยัน Stop/cancelอ่านหยุดการเริ่มส่วนถัดไปเมื่อทำได้; ส่วนที่providerเริ่มแล้วอาจจบและมีusageตามจริง การพัก/หยุดอ่านไม่ลบต้นฉบับ ไม่ยกเลิกใบเบิกหรือย้อนการจ่ายเงิน การลบ/ถอนต้องเป็นactionเดิมที่มีguardของมัน

เมื่อกลับมา/กดปุ่มทุกครั้งต้องrecheckactor/company/branch/permission/source revisionก่อนapplyหรือแสดงผล ไม่เชื่อallowed-actionที่cacheไว้แทนserver ถ้าสถานะlatestยังตรวจไม่ได้ให้แสดงunknownและทางกลับมาดู ไม่เสนอfinalmutationซ้ำ ปุ่มบนข้อความLINEเก่าต้องresolveงานเดิมและตอบด้วยสถานะล่าสุดที่เปิดเผยได้

### 17.4 Presentation และการตรวจรับความเข้าใจ

Webใช้ข้อความคงอยู่ใกล้ไฟล์/หน้าหรือช่องที่มีปัญหา พร้อมสรุปเมื่อมีหลายจุด; toastอย่างเดียวไม่พอ ข้อความไม่ใช้สี/emojiอย่างเดียวแทนความหมาย รักษาขนาด/การแตะ/reflowและcomponentsตาม§8; focusและการประกาศสถานะต้องไม่รบกวนการกรอกหรือย้ายผู้ใช้หนีจุดแก้ errorรายละเอียดทางเทคนิคซ่อนไว้และใช้รหัสอ้างอิงปลอดภัยแทน

LINEตอบสั้นตามสามเรื่องใน§17.1และปุ่มที่ใช้ได้จริง; ไม่ส่งหนึ่งข้อความต่อหนึ่งchunkจนรบกวน ใช้receipt/pendingworkเดิมเพื่อติดตาม เมื่อLINEส่งผลไม่ได้ให้ตรวจจากหน้าสถานะที่เข้าถึงได้หรือแสดงผลเดิมเมื่อผู้ใช้กลับมา ไม่รับรองว่าจะpushได้ทุกกรณี ไม่มีข้อความแชตใดเปลี่ยนfinancialconfirmation boundaryตาม§3/12

W08ต้องทำfailure injectionและjourney checksครอบUXE-01–27ทั้งสามทางที่เกี่ยวข้อง รวมnormal/unknown/malformed/missing-state response, partialfiles/pages, lostresponseทั้งก่อนและหลังcommit, duplicateclick, permission/sourcechange, expiredLINEdownload/reply และไม่มีผู้รับความช่วยเหลือ ตรวจว่าปุ่มพาไปงานเดิมได้จริงและยังรักษาguard/ผลที่สำเร็จ; snapshotข้อความอย่างเดียวไม่พอ

การทดสอบ40+ตามD05ให้ผู้ใช้บอกด้วยคำของตนว่า (1) ไฟล์/รายการถึงขั้นไหน (2) ต้องทำอะไรต่อ (3) การกดซ้ำจะสร้างหรือจ่ายใหม่หรือไม่ แล้วลงมือกู้ต่อด้วยตนเอง ใช้กรณีไม่อ่านเอกสารครบ/ยอดขัดกัน/โควตา/เน็ตหลุด/ใบรับรองและเปลี่ยนใบเสร็จ วัดความเข้าใจผิดเรื่องsaved/submitted/paidและrecovery success; ผลลัพธ์ยังต้องวัด ไม่อ้างว่ามีข้อความแล้วเท่ากับใช้ง่ายหรือครอบคลุมerrorทุกแบบที่อาจเกิด


### 17.5 ผู้ใช้ถาม AI ใน LINE ว่า “ส่งไม่ได้เพราะอะไร” — v0.10

**ข้อกำหนดผลิตภัณฑ์:** ผู้ใช้ถามเป็นภาษาทั่วไปได้ เช่น “ไฟล์เมื่อกี้ทำไมส่งไม่ได้”, “ใหญ่ไปหรือเปล่า”, “รองรับ PDF ไหม”, “ต้องส่งใหม่ไหม”, “บันทึกไปหรือยัง” และถามต่อจากคำตอบเดิมได้ คำตอบต้องยึดเหตุการณ์และสถานะจริงที่ผู้ใช้เข้าถึงได้ พร้อมทางทำต่อใน§17.2 ไม่ใช่เพียงให้AIรู้ข้อความerrorจากprompt ขอบเขตนี้ครอบเหตุการณ์รับไฟล์/อ่าน/บันทึก/เปลี่ยนใบเสร็จและclaim/certificate continuationในfeatureนี้ เรื่องอื่นใช้toolsและสิทธิ์เดิม

**แยกสิ่งที่บอตรู้ได้:** [LINE Developers](https://developers.line.biz/en/docs/messaging-api/receiving-messages/) อธิบายการรับeventผ่านwebhookและดึงไฟล์ด้วยmessage ID. ในการออกแบบจึงต้องแยก “มีeventรับไฟล์และมีเหตุผลปฏิเสธ” ออกจาก “ไม่มีหลักฐานรับไฟล์ในข้อมูลที่ค้นได้”; อย่างหลังอาจเกิดก่อนถึงบอต/eventมาช้า/ข้อมูลพ้นretention/ค้นไม่ตรง ไม่ใช่หลักฐานว่าไฟล์ใหญ่ เสีย หรือผู้ใช้ไม่ได้ส่ง ถ้าLINE clientส่งไฟล์ไม่ออกก่อนเกิดevent บอตไม่เห็นข้อความผิดพลาดบนเครื่องผู้ใช้โดยอัตโนมัติ

| ข้อมูลที่ระบบยืนยันได้ | แนวคำตอบเมื่อผู้ใช้ถาม | ทางทำต่อ |
|---|---|---|
| มีfile eventและตรวจพบขนาดเกินตอนรับ | “ไฟล์ {ชื่อที่แสดงได้} ขนาด {ขนาดที่ตรวจได้} เกินขนาดที่ระบบรับได้ {ขอบตอนรับ} จึงยังไม่ได้เก็บไฟล์นี้” | เลือกไฟล์ที่อยู่ในขอบ; ถ้าขอบเปลี่ยนภายหลังบอกขอบปัจจุบันและทางส่งใหม่ที่รองรับ ไม่เสนอเว็บเพื่อข้ามlimitเดียวกัน |
| ชนิดไฟล์ไม่รองรับ/ผลตรวจไม่ผ่าน | “ไฟล์ชนิดนี้ยังไม่รองรับ กรุณาเลือก {ชนิดที่รับได้}” หรือข้อความตรงเหตุจริงในUXE-04/08/09 | เลือกไฟล์อื่น/ตรวจใหม่เมื่อระบบพร้อมตามreason; ไม่เรียกไฟล์เสียจากเพียงนามสกุลหรือscannerล่ม |
| เก็บต้นฉบับแล้ว แต่อ่านบางหน้าไม่สำเร็จ | “อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่” | ลิงก์ไปหน้าตรวจเดิมบนเว็บพร้อมไฟล์/ผลอ่าน; ไม่มีปุ่มหรือคำสั่งอ่านซ้ำเป็นerror recovery |
| มีเหตุdownload failure แต่ไม่รู้สาเหตุละเอียด | “ตอนนั้นระบบรับไฟล์จาก LINE ไม่สำเร็จ แต่ยังระบุสาเหตุแน่ชัดไม่ได้” | ตรวจสถานะล่าสุด/ส่งไฟล์อีกครั้งเมื่อยืนยันว่าไม่ได้เก็บ; ไม่ขยายreasonรวมเป็นsizeหรือexpiredเอง |
| ไม่พบevent/attemptในขอบข้อมูลที่มีสิทธิ์และยังเก็บอยู่ | หลังตรวจงานที่เกี่ยวข้องแล้ว: “ตอนนี้ยังไม่พบไฟล์ที่จะอ่านค่ะ กด + → ไฟล์ แล้วเลือกส่งไฟล์นั้นในแชตนี้อีกครั้งได้เลย” | ค้นงาน/pendingที่มีสิทธิ์ก่อนและต้องไม่ใช่lookupล่มหรือunknowncommit; มีหลายcandidateให้เลือกแทนขอชื่อซ้ำ ไม่ใช้คำถามว่าLINEขึ้นข้อความอะไรเป็นทางออกแรก; late/resendต้องตรวจความซ้ำตาม§17.6 |
| ค้นสถานะไม่ได้เพราะบริการขัดข้อง | “ตอนนี้ยังตรวจสอบสถานะไม่ได้ จึงยังยืนยันไม่ได้ว่าไฟล์ถูกเก็บหรือยัง” | ตรวจอีกครั้ง/พักตาม§17; แยกจากnot-found ไม่กดสร้างหรือส่งไฟล์ซ้ำเพื่อแก้unknownโดยอัตโนมัติ |
| มีหลายไฟล์ที่เป็นไปได้ | “หมายถึงไฟล์ไหนคะ” พร้อมตัวเลือกชื่อ/เวลา/สถานะเท่าที่แสดงได้ | ให้เลือกหนึ่งครั้งแล้วผูกบทสนทนาถัดไปกับattemptนั้น; ไม่เดาว่าlatestเสมอหรือเลือกด้วยชื่อซ้ำอย่างเดียว |
| ปัญหาเดิมถูกแก้แล้ว | “ตอนแรก {เหตุที่บันทึกไว้} ตอนนี้ {สถานะล่าสุดที่ยืนยันได้} แล้ว” | เปิดรายการเดิม/ขั้นถัดไป; ไม่ตอบจากerrorเก่าจนผู้ใช้ส่งหรือจ่ายซ้ำ |

**ทำให้มีfactsตั้งแต่จุดที่พลาด:** E26แสดงว่าdownloadLineMediaคืนnullร่วมกันทั้งoversize/credentials/download/bounded-read errors และcallerเก็บreasonรวม จึงแก้แค่ข้อความไม่ได้ W02ต้องpreserve typed failureเมื่อทราบสาเหตุและstage ก่อนยุบหรือscrubpayload; ไม่ดาวน์โหลดไฟล์เกินขอบเพื่อเอาข้อมูลอธิบาย และไม่สร้างexpense/attachmentปลอมให้มีIDสำหรับถามสถานะ

D02/D06เลือกที่เก็บเล็กที่สุดจากevent/outcome/pending/operation infrastructureเดิมก่อนเพิ่มschema: actor/company/chat bindingที่serverยืนยัน, event/message/attempt reference, เวลา/ขั้นตอน/reason, filenameที่sanitizeและมีสิทธิ์เห็นเมื่อจำเป็น, ขนาดที่ทราบพร้อมแหล่ง(webhook metadataหรือmeasured bytes), capability/limitที่ใช้ตัดสินตอนนั้น, persisted-targetถ้ามี และresult/deliveryแยกกัน ข้อมูลพออธิบายfailureต้องยังresolveได้หลังrestartหรือrawpayloadถูกล้าง แต่ลบตามretentionที่ตกลง ไม่เก็บrawLINEpayload/ไฟล์ถูกปฏิเสธ/secretsยาวขึ้นเพื่อแชตถามย้อนหลัง ไม่มีcompany/actorที่ตรวจได้ให้เข้าสู่link/permission recoveryเดิม ไม่เปิดประวัติข้ามบัญชี

**ลำดับตอบและขอบเขตAI:** resolveเป้าหมายจากbutton/referenceที่serverตรวจได้หรือpendingcontextก่อน; ถ้าไม่มีreferenceให้ค้นเฉพาะcandidateของactor/company/chatในช่วงที่กำหนดและให้เลือกเมื่อกำกวม ชื่อไฟล์ที่ผู้ใช้พิมพ์ช่วยค้นได้แต่ไม่ใช่authorization. การquoteใช้เฉพาะmessageชนิดที่LINEส่งreferenceให้จริงและเราresolveได้ ไม่สมมติว่าการquotePDFทุกclientมีquotedMessageId

จากนั้นอ่านoutcomeและcurrentstatusผ่านpermission-checked API/read-toolเดิมที่ขยายตามD02 พร้อมas-of/source revisionและallowed recovery actions; Gatewayห้ามอ่านDB/productionlogsโดยตรง E27มีstatusและexpense.explain_recordอยู่แล้วให้reuseboundary แต่toolที่ต้องมีexpenseไม่ครอบrejectionก่อนcapture จึงต้องออกแบบlookupส่วนนั้นอย่างชัดเจน ข้อความยืนยันสาเหตุ/ขนาด/การเก็บ/ยอด/การจ่ายมาจากserver template/factsเท่านั้น AIช่วยเข้าใจคำถามและอธิบายภาษาคนโดยไม่เพิ่มเหตุผลเอง หากstructuredresultไม่ครบหรือผิดschemaให้ใช้unknownfallback

การถาม “ทำไม”, “ได้หรือยัง”, “ต้องส่งใหม่ไหม” เป็นread-only ไม่เปลี่ยนprimary ไม่อ่านไฟล์ใหม่ ไม่สร้างร่างหรือส่งอนุมัติ เมื่อผู้ใช้ถามว่าจะทำต่ออย่างไร ให้เปิดลิงก์Webกรอกงานเดิมตาม§17.6 ไม่เสนอคำสั่งหรือปุ่มอ่านซ้ำและไม่เริ่มmanual-entryบทสนทนาเป็นerror recovery การถามสถานะไม่ใช้OCRcallหรือหักOCRquotaใหม่; หากใช้LLMสำหรับบทสนทนาต้องอยู่ใต้governanceข้อความเดิม ไม่อ้างว่าusageทั้งหมดฟรี

เมื่อAI/providerหรือOCRquotaไม่พร้อม ต้องมีคำตอบสถานะพื้นฐานแบบdeterministicผ่านpattern/status handlerเดิมสำหรับคำถามที่resolveได้ ไม่ให้การอธิบายว่าAIขัดข้องต้องเรียกAIอ่านไฟล์ซ้ำ ข้อความกำกวมใช้คำถามเลือกเป้าหมายหรือfallbackสั้น ๆ โดยไม่เดา หากAPI/storage/LINEdeliveryเองล่มยังไม่รับประกันตอบได้ทันที ต้องบอกขอบเขตที่ตรวจไม่ได้เมื่อสื่อสารได้ และกลับมาแสดงผลจริงเมื่อช่องทางพร้อม

**ทดสอบก่อนอ้างว่าถามAIแล้วตอบได้:** A86–A88ต้องครอบไฟล์เกินขอบตั้งแต่metadata/ชนิดไม่รองรับ/temporary download/ไม่มีexpense, restart+payloadscrub, หลายไฟล์ชื่อซ้ำ/หลายผู้ใช้ในgroup/เปลี่ยนบริษัท, lateevent/retentionหมด/lookupล่ม/noevent, actualreasonกับคำถามชี้นำผิด (“ไฟล์เสียใช่ไหม” ทั้งที่quotaหมด), ถามซ้ำหลังrecovery/limitเปลี่ยน, providerไม่พร้อมและผลส่งข้อความหาย ตรวจทั้งfacts/copy/target/access/no-mutation และอ่านคำถามธรรมชาติหลายรูปแบบ; ไม่ใช้mock expenseที่สร้างแล้วแทนfailureก่อนcaptureทั้งหมด


### 17.6 อ่านไม่สำเร็จ → เก็บไฟล์แล้วและลิงก์กรอกต่อบนเว็บ — v0.11

ข้อกำหนดนี้ต่อยอด handler และหน้ารายการเดิมตามผลตรวจ §17.8 ไม่ใช่งานสร้างระบบ recovery หรือฟอร์มใหม่ทั้งหมด; จุดที่ยังขาดต้องแยกจากความสามารถเดิมที่ตรวจแล้ว

**คำตัดสินล่าสุดจากผู้ใช้:** เมื่ออ่านไม่สำเร็จให้บอกว่าเก็บไฟล์ไว้แล้วและให้ลิงก์ไปกรอกเองบนเว็บ ใช้แทนข้อเสนอปุ่มอ่านซ้ำ/พิมพ์สั่งอ่านซ้ำ/กรอกข้อมูลในLINEที่เคยอยู่ในv0.10 งานนี้ไม่เพิ่มerror recoveryเหล่านั้น ข้อกำหนดใช้ร่วมกับใบเสร็จปกติ/retail/marketplace ภาพหรือPDF ผ่านLINE/upload/replacement โดยsuccessful flowยังเหมือนเดิม

ข้อความหลักหลังserverยืนยันการเก็บต้นฉบับและการอ่านfailed:

> อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่

ข้อความนี้ต้องมีลิงก์/ปุ่มจริงชื่อ **กรอกข้อมูลต่อ** ที่ไปยังหน้าตรวจหรือกรอกของงานนั้นบนWeb ถ้าอ่านได้บางส่วนใช้ “อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่” ถ้าเปลี่ยนใบเสร็จแล้วใช้ “เปลี่ยนไฟล์แล้วค่ะ แต่ยังอ่านข้อมูลไม่สำเร็จ กดกรอกข้อมูลต่อได้ที่นี่” พร้อมcurrentfileและค่าที่ต้องตรวจเทียบ

**ปลายทางลิงก์:** เมื่อมีexpenseIdให้reuseหน้ารายการเดิม `/companies/{companyId}/expenses/{expenseId}` ซึ่งเปิดExpenseReviewPage ห้ามส่งไปหน้าอัปโหลดใหม่/ฟอร์มสร้างใหม่/หน้ารวมแล้วให้ผู้ใช้หาเอง ถ้ามีเพียงpersisted pending/captureที่ยังไม่มีexpense ต้องมีdeep linkผูกworkนั้นเข้าreview UIที่ขยายจากของเดิมตามD02/W02/W04ก่อนเปิดfeature; ไม่ใส่IDปลอมหรือสร้างexpenseซ้ำเพียงเพื่อทำลิงก์ การเปิดลิงก์ต้องไม่สร้าง/ส่งเบิก/จ่ายหรือเริ่มOCRจากGET

URLสร้างจากWeb originและtargetที่serverยืนยันได้ ไม่รับURLจากOCR/LLMและไม่เป็นpublic linkเข้าไฟล์ดิบ การรู้URLไม่ให้สิทธิ์เพิ่ม ตรวจactor/company/branch/file/recordทั้งตอนสร้างลิงก์และเปิด ถ้าsessionหมดให้loginแล้วกลับเป้าหมายเดิมด้วยsafe return target ถ้าสิทธิ์หรือสถานะเปลี่ยนให้แสดงเหตุและทางที่มีสิทธิ์ ไม่เผยไฟล์/ยอดให้คนอื่นหรือเปิดฟอร์มแก้เอกสารที่locked

**เมื่อเปิดเว็บ:** เห็นไฟล์ที่เก็บไว้และผลที่อ่านได้แล้วในหน้าเดียวกัน/สลับดูได้สะดวกบนมือถือ เติมfieldsที่มีและชี้เฉพาะข้อมูลที่ขาดหรือขัดกัน ไม่ให้uploadใหม่และไม่ล้างค่าที่คนตรวจแล้ว ผู้ใช้กรอกแล้วบันทึกในงานเดิมผ่านvalidation/permissionsเดิม; ค่าที่คนกรอกมีprovenanceแยกจากOCR ไม่ทำให้AI/electronic-verificationกลายเป็นpassedและไม่ข้ามconfirmation/approvalตาม§3/12

ถ้าลิงก์อ้างไฟล์ก่อนreplace ให้resolveงานและตรวจrevisionแสดงcurrentfileกับเหตุที่ข้อมูลต้องตรวจใหม่ ไม่ให้ผลOCRที่กลับช้าทับค่าที่กรอกในเว็บ การกดลิงก์ซ้ำหรือถามในLINEภายหลังต้องเปิดสถานะล่าสุดของงานเดียวกัน ไม่สร้างใหม่/คิดOCRซ้ำ ถ้าเคยอ่านหรือกรอกสำเร็จแล้วให้แสดงผลปัจจุบัน ไม่ตอบfailedเก่าจนผู้ใช้กรอกซ้ำ

**ข้อความต้องตรงสถานะ:** “เก็บไฟล์ไว้แล้ว” ใช้ได้เมื่อpersistยืนยันจริงเท่านั้น ถ้าupload/downloadถูกปฏิเสธก่อนเก็บ, มีunknowncommit, lookupล่มหรือsecurityquarantine ให้ตอบreason/recoveryตาม§17.2/17.5แทน ไม่อ้างมีไฟล์พร้อมกรอก หากยังrunningให้บอกกำลังอ่านพร้อมสถานะ; ไม่เปลี่ยนเป็นfailedเพียงเพราะคำตอบมาช้า ถ้าAIปิด/quotaหมดแต่ไฟล์เก็บแล้ว ให้บอกเหตุตามจริงพร้อมลิงก์กรอกเดียวกัน

เมื่อเข้าสู่failed/partialที่จบการอ่านแล้ว ให้จบเส้นทางAIอ่านของงานนั้นและพาไปWebทันที ไม่บังคับลองซ้ำอีกหลายรอบก่อนแสดงลิงก์ ไม่มีปุ่ม/text shortcutที่เริ่มOCRใหม่จากerrorนี้ การกู้transport/workerที่ยังเป็นงานอ่านเดิมและยังไม่terminalใช้bounded checkpoint/attempt governanceใน§16.7/D02; ไม่อ้างเป็นเหตุให้requeueงานที่ประกาศfailedแล้ว การส่งไฟล์ใหม่/เปลี่ยนไฟล์โดยผู้ใช้ภายหลังยังเป็นintentเดิมตาม§16.4 ไม่ใช่retryอัตโนมัติจากerror

### 17.7 กรอกบนเว็บแล้วยังไม่มีข้อมูลพอ

Webต้องให้พักร่างเดิมไว้ได้เมื่อผู้ใช้ไม่ทราบข้อมูล ไม่ใส่ยอด0/วันที่ปัจจุบัน/ประมาณยอดเพื่อผ่านvalidation หากต้นฉบับไม่ชัดหรือขาดหน้าให้แนบหลักฐานที่ดีขึ้นในหน้าเดิมตามappend/replace intentและretentionของ§16.4 โดยไม่เอาใบใหม่ไปปนผิดงาน ไม่ต้องสร้างmanual-entry flowในLINEเพื่อกู้OCR

ถ้าต้องขอเอกสารจากร้านให้แสดงช่องทางที่ยืนยันได้ตามresearch/สิทธิ์ ทางให้คนช่วยมีเฉพาะผู้รับและrouteที่มีจริง ไม่มีการส่งหาใครเอง เมื่อเป็นรายจ่ายจริงและเข้าeligibilityของ§12จึงเสนอflowใบรับรองแทนใบเสร็จเดิม; OCRอ่านไม่สำเร็จไม่ทำให้สร้างใบรับรองอัตโนมัติหรืออนุมัติยอด/ผู้จ่ายที่ยังไม่ทราบ

**ตรวจรับA43/A64/A70/A74/A82–A88:** failed/partialเกิดแล้วแจ้งsavedเมื่อจริงพร้อมWebtargetที่ถูกงาน; กดจากLINEบนมือถือถึงไฟล์/partialfacts/ช่องขาด, login-return, pendingก่อนexpense, permission/locked/replaced states, old-link/currentrevision, repeatedclickและlateOCRไม่สร้าง/แก้ซ้ำ; ไม่มีnewOCRหรือmanual-entry chatจากerrorlink; unknown/unsavedไม่อ้างsaved และordinary receipt successไม่เพิ่มขั้นตอน ทดสอบUI/handlerจริงก่อนอ้างรองรับ ไม่ใช้การมีข้อความในspecเป็นหลักฐานการเปิดใช้

### 17.8 ผลตรวจ handler เดิมเพื่อจำกัดงาน — 2026-09-17

ตรวจ source และชุดทดสอบเดิมในเครื่องแล้ว พบฐานที่ reuse ได้จริงตาม E25/E27 ดังนี้ ไม่ได้ตรวจระบบที่ deploy หรือส่งข้อความ LINE จริง

| จุดเข้า | ของเดิมที่ใช้ต่อได้ | ช่องว่างเฉพาะ §17.6 |
| --- | --- | --- |
| LINE ผิดพลาดหลังเก็บรายการ | [executeReceiptUpload catch](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5370) ตรวจไฟล์ที่ commit แล้ว เรียก [savedReceiptReplies](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:6158) และ [formatPaypersReply](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:991) พร้อมลิงก์รายการเดิม; recovery นี้ไม่เรียก OCR ซ้ำ | ข้อความปัจจุบันเป็นสรุปร่าง ต้องให้สถานะอ่าน failed/partial และป้ายกรอกต่อสอดคล้องกันเมื่อทราบผลจริง ไม่สร้าง catch หรือ form อีกชุด |
| LINE อ่านล้มเหลวก่อนมี expense | [decideLineBusinessDocument](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:511) คืน clarify เมื่อ OCR ไม่สำเร็จ แม้ route เป็น expense; [clarify branch](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5918) เก็บ pending ผ่าน ensurePendingMedia และถามประเภทเอกสาร; [ทางจบ clarification](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:7060) มีลิงก์หลังสร้างรายการแล้ว | ยังไม่ใช่ลิงก์กรอกทันที ต้องเชื่อม pending เดิมถึง Web ภายใต้ D02/W02/W04; การมี handler หลัง capture ไม่ได้ปิดช่องว่างก่อน capture ห้ามสร้าง expense ของไฟล์ไม่ทราบประเภทหรือข้าม MULTI_DOCUMENT/permission guard เพื่อให้มี URL |
| อัปโหลดใหม่บน Web | [UploadPanel](../../apps/web/src/features/expenses/ExpensesPages.tsx:309) complete ไฟล์ก่อนอ่าน AI; เมื่ออ่านล้มเหลวทั่วไปยัง onSuccess ไป [รายละเอียด expense เดิม](../../apps/web/src/features/expenses/ExpensesPages.tsx:2459) พร้อม notice; quota มีลิงก์รายการที่บันทึกไว้ | [ข้อความเดิม](../../apps/web/src/common/i18n/workspace-dictionary.ts:709) ยังชวนอ่านซ้ำ และ UploadPanel มี new_request อัตโนมัติสำหรับบาง failed result ต้องปรับจุดเดิมตามนิยาม terminal ใน D02; ไม่ลบการตรวจผลคำขอที่ยังไม่ทราบผล |
| เปลี่ยนใบเสร็จ/กรอกต่อ | [attachPrimaryReceipt และ extractAgain](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx:427) ใช้รายการเดิม; [ExpenseReviewEditSection](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx:1008) และ viewer อยู่หน้าเดียวกัน | ใช้ form/save/validation/permission เดิม ปรับ notice และการแสดงปุ่มอ่านซ้ำใน failed state ตาม §17.6; การอ่านไฟล์ที่ผู้ใช้เพิ่งเปลี่ยนเป็น intent ใหม่ ยังต้องทำงานตามเดิม |

[requestExpenseExtractionWithRecovery](../../apps/web/src/features/expenses/expense-upload.logic.ts:133) มีการอ่านสถานะและใช้ requestId เดิมเมื่อผล HTTP ไม่แน่นอนอยู่แล้ว ต้องรักษาการป้องกันงานซ้ำนี้ แยกจาก [expenseExtractionRetryMode](../../apps/web/src/features/expenses/expense-upload.logic.ts:29) ที่ออกคำขอใหม่หลังได้รับบาง failed result

หลักฐาน: focused existing API tests ผ่าน 29 เคส รวมเก็บ original/partial fields เมื่อ apply ล้มเหลว, กู้หลัง commit, same-record link และไม่อ่านซ้ำ; existing Web logic/policy/source QA ผ่าน 54 เคส ผลเหล่านี้ยืนยันพฤติกรรมเดิม รวมพฤติกรรมถามประเภท/อ่านซ้ำที่ยังต้องปรับ ไม่ใช่หลักฐานว่าข้อกำหนด v0.11 ผ่านครบแล้ว Browser, login-return, pending-to-Web, mobile UX40+ และ PDF 10 MiB หลายหน้ายังต้องตรวจรับตามแผน

## 18. เอกสารค่าขนส่ง: ขยาย discovery และ regression — 2026-09-18

ใช้ baseline v0.11 และ W00–W08 เดิมกับไปรษณีย์ไทย, KEX/เคอรี่, Flash, J&T, SPX, DHL Express และ SCG Express ตาม [ผลสำรวจ](../research/thai-courier-receipt-survey-2026-09-18-th.md) และ [catalog](../research/thai-courier-receipt-survey-2026-09-18.json). ขอบเขตคือผู้ซื้อบริการขนส่งนำหลักฐานมาทำค่าใช้จ่าย/เบิกเงิน ไม่ใช่กระทบยอดรายได้ COD ของผู้ขาย. CC01–CC10 เป็นเคสตรวจรับเพิ่มที่ยังต้องทดสอบ ไม่เปลี่ยนจำนวน A01–A88/IG01–IG29/E01–E27 หรืออ้างว่ารองรับทุกแบบล่าสุดแล้ว

### 18.1 รูปแบบและบทบาทของหลักฐาน

- **CC01/CC04:** แยกใบรับเงิน ใบชั่วคราว ใบกำกับภาษีอย่างย่อ ใบเต็ม ใบแจ้งหนี้ ใบปะหน้า และใบนำฝากจากเนื้อหา ไม่ตัดสินจากกระดาษแคบ/A4/PDF/โลโก้. Reuse document kinds เดิมก่อนเพิ่ม enum; ชื่อใบปะหน้าหรือใบนำฝากเพียงอย่างเดียวไม่ยืนยันยอดจ่าย และไม่ใช้ชื่อนั้นปฏิเสธใบที่มีข้อมูลรับชำระรวมอยู่จริง. แยก legal issuer, ร้านตัวแทนรับพัสดุ, ผู้ส่ง, ผู้รับ, buyer และ payer ตามหลักฐาน ไม่ใช้ปลายทางแทนผู้ซื้อภาษี
- **CC02:** หนึ่งใบมีหลายพัสดุได้; receipt/invoice ID, tracking หลายค่า และ payment reference เป็นคนละบทบาท. หน้า summary/detail ที่อ้างเอกสารเดียวกันต้องไม่บวกยอดซ้ำหรือสร้างรายจ่ายซ้ำ. หลาย tracking อย่างเดียวไม่ใช่ MULTI_DOCUMENT; หลายใบคนละธุรกรรมในไฟล์เดียวต้องคง guard และ grouping เดิม
- **CC03:** ค่าขนส่ง บรรจุภัณฑ์ fuel ค่าพื้นที่พิเศษ ประกัน และค่าธรรมเนียม COD เก็บเป็นรายการ/charges ตามหลักฐาน; ส่วนลดและ charges ที่ย้ำทั้งแถวและท้ายใบรวมครั้งเดียว. เงินสดที่รับ/เงินทอนไม่ใช่ expense total และน้ำหนักไม่เป็น multiplier ของราคาต่อพัสดุที่รวมแล้ว. ใช้ per-line VAT facts เดิม ไม่ hardcode อัตราหรือสิทธิภาษีรายแบรนด์
- **CC04/CC07:** ยอด COD ค่าสินค้า มูลค่าที่แจ้งประกัน ค่าธรรมเนียมเก็บเงิน และยอดโอนสุทธิแยกกัน; หลักฐานผู้รับจ่าย COD อาจประกอบการซื้อเดิม ไม่สร้างค่าใช้บริการขนส่งเท่ามูลค่าสินค้า. Customs Receipt/Duty Invoice/ค่าบริการต้องคงบทบาทและภาษีตามเอกสาร ไม่รวมภาษีหรือบันทึกจ่ายซ้ำ. ข้อมูลไม่พอให้พักการยืนยันเฉพาะส่วน ไม่เดา
- **CC05/CC06:** ใบเต็ม/electronic ที่มาแทนใบชั่วคราว รวมถึง bill รายเดือน/ใบย่อย/credit note ต้องตรวจ relation และยอดใช้ไปแล้วก่อนเพิ่มหรือแทนหลักฐาน. Tracking เดียวไม่พอ dedupe เพราะอาจมีค่าบริการเพิ่มคนละใบ. เก็บ document date, shipment date, due date และ payment state แยกความหมาย; ใบแจ้งหนี้ไม่เท่ากับชำระแล้ว. รักษา source/claim/certificate/payment locks และ correction flow เดิม
- **CC07/CC10:** ไฟล์ PDF/อีเมล/ภาพหน้าจอไม่ยืนยันว่าเป็น e-Tax ที่ผ่านการตรวจ. เก็บ original bytes และ provenance ตาม D09; OCR หรือข้อความ “Digitally signed” ไม่แทน signature verification/การอนุมัติภาษี. วันที่แก้ไฟล์หรือวันที่ค้นพบไม่แทนวันที่ออกเอกสารหรือหลักฐานว่าเป็น layout ล่าสุด

D02 ต้องตรวจว่า manifest/evidence และ contract เดิมเก็บ shipment references หลายค่าและความสัมพันธ์หลักฐานพอหรือไม่. เพิ่มเฉพาะส่วนที่พิสูจน์ว่าขาด ไม่ใส่ tracking ลง documentNumber เพื่อเลี่ยง contract และไม่สร้าง handler/ตารางแยกรายบริษัทขนส่งโดยอัตโนมัติ

### 18.2 ผู้ใช้ 40+ และการกู้ต่อในสามช่องทาง

**CC08/CC09:** ส่งรูปหรือไฟล์ใน LINE, อัปโหลดใหม่ หรือเปลี่ยนใบเสร็จผ่าน flow เดิมได้โดยไม่ต้องเลือกบริษัทขนส่ง/ชนิดภาษีก่อน. หน้าตรวจแสดงค่าบริการรวม วันที่ และผู้ออกหลักฐานก่อน เปิดรายละเอียดพัสดุ/charges เมื่อจำเป็น; ขอให้ผู้ใช้ตอบเฉพาะข้อมูลสำคัญที่ขาดหรือขัดกัน ไม่บังคับกรอกทุกเลข tracking

กติกา original 10 MiB/หลายหน้า/partial facts ใช้ §16 และยังต้อง implement/ตรวจรับตามเดิม. ถ้าอ่านไม่สำเร็จและเก็บไฟล์สำเร็จจริง ใช้ §17.6: แจ้งสั้นและปุ่ม **กรอกข้อมูลต่อ** ไป Web งานเดิม; ไม่เริ่ม OCR ใหม่จาก error link. หน้าเปลี่ยนใบเสร็จต้องเปิด revision ปัจจุบันและรักษาค่าที่คนตรวจแล้วพร้อม provenance. กรอกไม่ครบให้พักงานหรือแนบหลักฐานในงานเดิมได้; ใบรับรองแทนใบเสร็จใช้ §12/W06 เฉพาะรายจ่ายจริงและผ่าน eligibility ไม่ออกอัตโนมัติเพราะ OCR ล้มเหลวหรือไม่มีใบกำกับเต็ม

### 18.3 หลักฐานก่อนยืนยันความพร้อม

ตรวจช่องทางสาธารณะ 7 เจ้า ณ 2026-09-18 และลงทะเบียน 11 records: visual 9/text-only 2, แบ่งเป็นสำเนาธุรกรรมที่ยังไม่ตรวจความแท้ 7 และตัวอย่างคู่มือ 4. ใบธุรกรรมที่ตรวจภาพใหม่ที่สุดคือไปรษณีย์ไทย 2026-02-23; J&T/SPX/SCG ยังไม่มี specimen ใบจริงที่ตรวจได้. ไม่รับรองว่าทุก provider/รูปแบบล่าสุดครบหรือทุกใบใช้เป็น training fixture ได้

W00/D05 ต้องได้ชุดที่มีสิทธิ ครบช่องทาง/เอกสารที่แต่ละเจ้าออกจริง และคู่ใบชั่วคราว→เต็ม/แก้ไข/เดือนรวมที่สัมพันธ์จริง; D09 ต้องมี original สำหรับตรวจ electronic แยกจากสำเนาปกปิดข้อมูล. W08 ตรวจ CC01–CC10 ตาม [แผนส่วน 12](../plans/marketplace-buyer-expense-capture-plan-th.md) ทั้ง extraction, monetary reconciliation, state/permissions, LINE/upload/replace และ UX40+. ผล API29/Web54 ใน §17.8 ไม่ใช่ผลความแม่นยำ AI อ่านเอกสารขนส่ง

### 18.4 LINE ตอบเอกสารที่ไม่ใช่ใบเสร็จ/ใบกำกับภาษี — owner approved 2026-09-18

ใช้กับเอกสารทั่วไปและเอกสารขนส่ง โดยขยาย CC01/CC04/CC08/CC09. NR01–NR09 ด้านล่างเป็นกรณีตรวจรับย่อย ไม่ใช่ enum หรือ handler ใหม่. **การจำแนกได้ว่าเป็นเอกสารอื่นเป็นผลอ่านสำเร็จ**; แยกจากอ่านไม่สำเร็จและอ่านได้แต่ยังจำแนกไม่แน่ใจ. การไม่มีหัวใบเสร็จ/ใบกำกับไม่ใช่เหตุปฏิเสธทั้งหมด: ใบแจ้งหนี้ สลิป และคำสั่งซื้อยังผ่านเข้า review ได้ตาม expense eligibility เดิม โดยไม่เปลี่ยนเป็นใบเสร็จหรือยืนยันการชำระ/ภาษีอัตโนมัติ

ข้อความต้องบอกชนิดที่รู้จริง สิ่งที่ยังขาด และทางทำต่อที่ใช้ได้. ตารางเป็นข้อความตามสถานะ ไม่ส่งทุกทางเลือกพร้อมกัน; ใช้คำว่า “ยังไม่ได้สร้างรายการ” เฉพาะ server ยืนยันว่าไม่มี expense และไม่ใช้กับ append/replace ของรายการที่มีอยู่แล้ว

| Case / เงื่อนไข | ข้อความหลัก | ทางทำต่อ |
| --- | --- | --- |
| NR01 อ่านว่าเป็นใบปะหน้าและไม่มีหลักฐานรับชำระค่าส่ง | ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ | ส่งหลักฐานค่าส่งเพิ่มในงานเดิมเมื่อผูก pending แล้ว; จ่ายแล้วแต่ไม่มีใบเสร็จใช้ทาง Web ด้านล่าง |
| NR02 ใบนำฝากที่แสดงการรับพัสดุ แต่ไม่มีข้อมูลรับชำระค่าส่ง | ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ | เช่นเดียวกับ NR01; น้ำหนัก/จำนวนชิ้น/COD ไม่ใช้แทนยอดค่าส่ง |
| NR03 ใบเสนอราคา/ใบสั่งซื้อ/ใบส่งของที่ยังไม่มีข้อมูลพอเป็น expense evidence | ใบนี้เป็น{ชนิดเอกสารที่ยืนยันได้}ค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ | ส่งหลักฐานเพิ่ม; ถ้าต้องการดูรายการเดิมให้ลิงก์งานที่มีสิทธิ์ ห้ามส่งไปหน้ารวมบัญชีโดยไม่เกี่ยวกับงาน |
| NR04 ใบแจ้งหนี้/บิลผู้ขายที่ผ่าน eligibility แต่ยังไม่มีหลักฐานจ่าย | ใบนี้เป็นใบแจ้งหนี้ ยอด {ยอดที่ยืนยันได้} บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก | เปิด review เดิม; ถ้าร่างบันทึกแล้วให้บอกผลจริง ไม่อ้าง paid และไม่ให้ส่งใบเสร็จเพื่อผ่านขั้นอ่านโดยไม่จำเป็น |
| NR05 สลิปโอนหรือหลักฐานคำสั่งซื้อที่ผ่าน eligibility | สลิป: พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร; คำสั่งซื้อ: พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน | เปิด review เดิมพร้อม facts; ไม่เรียกเป็นใบเสร็จ/ใบกำกับ และไม่ผูกผู้รับโอนเป็นผู้ขายหรือยอด COD เป็นค่าขนส่งโดยเดา |
| NR06 เช็กบิลมียอดและเข้าเงื่อนไข continuation เดิม | ใบนี้บอกยอดที่ต้องจ่าย แต่ยังไม่ยืนยันว่าร้านรับเงินแล้วค่ะ จ่ายเงินแล้วหรือยังคะ | Reuse ตัวเลือกเดิม “จ่ายแล้ว แต่ไม่ได้ใบเสร็จ” / “ยังไม่ได้จ่าย” / “มีใบเสร็จ จะส่งรูปใหม่”; คำตอบเป็นคำยืนยันของผู้ใช้ ไม่ใช่หลักฐานชำระแทนทุกกรณี |
| NR07 ยืนยันว่าเป็นภาพที่ไม่เกี่ยวกับเอกสารค่าใช้จ่าย/ธุรกิจ | ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ | ไม่มี expense หรือ pending สำหรับค่าใช้จ่ายที่สร้างอัตโนมัติจากภาพนี้; เอกสารธุรกิจชนิดอื่น เช่น การจอง ใช้ handler/สิทธิ์เดิม |
| NR08 อ่านเนื้อหาได้แต่ชนิด/วัตถุประสงค์ยังไม่แน่ใจ | ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ | ถ้ามี expense purpose และ pending ที่เก็บแล้ว ให้เปิด “กรอกข้อมูลต่อ” เพื่อยืนยันใน Web งานเดิม; ถ้ายังไม่รู้ purpose ใช้ clarification เดิมตามข้อมูลที่ขาด ไม่กล่าวหาว่าเป็นภาพไม่เกี่ยวข้องหรืออ้างอ่านล้มเหลว |
| NR09 อ่านไม่สำเร็จหรือ partial ที่จบการอ่านแล้ว และเก็บไฟล์ยืนยันได้ | Failed: อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลต่อได้ที่นี่; partial: เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่ | “กรอกข้อมูลต่อ” ตาม §17.6 พร้อม partial facts; ไม่มี OCR ใหม่หรือบทสนทนากรอกข้อมูลใน LINE จาก error link; unsaved/unknown/running ใช้ข้อความตามสถานะจริงใน §17 |

**การเก็บและผูกงานก่อนเสนอทางทำต่อ:** สำหรับ NR01–NR03 และ NR08 ที่ยืนยันเจตนาทำค่าใช้จ่ายและมีสิทธิ ให้ reuse pending media/capture เดิมเพื่อเก็บต้นฉบับและ facts โดยยังไม่สร้าง expense เพื่อแลกกับ URL. ต้องได้ persist confirmation และ work/attachment revision ที่ถูกต้องก่อนบอก “เก็บไฟล์ไว้แล้ว” หรือเสนอ same-work Web link. เมื่อส่งหลักฐานเพิ่มให้ผูกกับงานเดิมผ่าน identity ที่ตรวจสิทธิ์; ถ้ามีหลายงานให้เลือกเฉพาะงานที่ดูได้ ไม่เดาว่าเป็นไฟล์ล่าสุด. ผล unknown, permission denied, download expired หรือ persist failed ใช้ §17 ไม่อ้าง saved และไม่สร้างซ้ำ

**จ่ายแล้วแต่ไม่มีใบเสร็จ:** NR01–NR03 เปิด “กรอกข้อมูลต่อ” ไป Web งานเดิมเมื่อเงื่อนไขข้างต้นครบ ให้ยืนยันยอด ผู้จ่าย และหลักฐานที่มี แล้วใช้ §12/W06 พิจารณาใบรับรองแทนใบเสร็จเฉพาะเข้าเกณฑ์. ไม่ให้ตอบหลายช่องใน LINE และไม่ออกใบรับรองเพียงเพราะเป็นใบปะหน้า/ขาดใบกำกับ. NR06 รักษา payment-choice continuation เดิมและ guards ของมัน; เป็นการเลือกสถานะบิล ไม่ใช่การเพิ่ม manual-entry chat สำหรับ OCR failure

**ใช้ร่วมกับ upload/replace:** Web ใช้ผลจำแนกและเงื่อนไขการเงินเดียวกัน แสดง notice ในหน้าเดิม. งานที่มี expense แล้วใช้สถานะ/ลิงก์ของรายการนั้น; การรับไฟล์เข้าระบบ การเปลี่ยน primary attachment และการ apply facts เป็นคนละผล ต้องบอกเฉพาะที่ server ยืนยัน. เอกสารที่ไม่ผ่านเกณฑ์ไม่ทำให้ ready/paid โดยอัตโนมัติ ไม่ล้างค่าที่คนตรวจแล้วหรือข้าม source/claim/certificate locks และไม่ออก expense ซ้ำเพื่อกู้ต่อ

**ของเดิมและช่องว่าง:** [formatBusinessDocumentReply](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:547), [check-bill reply](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:579) และ [eligibility gate](../../apps/api/src/modules/expenses/domain/logic/expense-document.logic.ts:376) มีอยู่แล้ว. [Reference branch](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5870) เก็บ pending เฉพาะทาง check-bill ในเงื่อนไขที่ตรวจ ไม่ใช่ทุกเอกสารอ้างอิง. W02/W04 ต้องเชื่อม persisted non-receipt pending→Web ก่อนอ้างว่าทำต่อได้; D02 ตรวจว่า classification/evidence เดิมเลือกคำเฉพาะใบปะหน้า/ใบนำฝากได้หรือไม่ หากยังแยกไม่แน่ใจใช้ NR08 ไม่เดาชนิดหรือเพิ่ม enum รายขนส่งเพื่อข้อความอย่างเดียว. ทั้งหมดเป็นข้อกำหนดที่ยังต้อง implement/ทดสอบ
