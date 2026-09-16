# อ่านหลักฐานซื้อหลายร้านในโฟลว์ค่าใช้จ่ายเดิม

Status: Proposed v0.6, 2026-09-16. Paired with implementation plan v0.6 (W00–W08, D01–D08). Includes 45 public purchase/order references, 9 supplemental cases, IG01–IG15 impact review and A01–A48 acceptance. ตรวจทานรีวิว v0.5 แล้ว แก้ route/stage ของ resolver, payer/certificate eligibility, tax review, launch-gate rollout และ privacy ก่อน pilot; ดูบันทึกตรวจทานใน plan §10. Work packages and traceability are defined; implementation/validation gates remain open. No runtime bug reproduction, OCR accuracy, release readiness or company-policy approval is claimed.
Owner: Product owner / Codex
Scope: ผู้ซื้อ Shopee, Lazada และ TikTok Shop ในไทย เพื่อรายการบริษัทและการเบิกเงิน
User follow-up: explicitly include the existing ใบรับรองแทนใบเสร็จรับเงิน journey in this solution; see section 12. This is part of the baseline, not a later optional feature.
Plan: [Implementation plan W00–W08 พร้อม dependency และ acceptance mapping](../plans/marketplace-buyer-expense-capture-plan-th.md)
Background: [งานค้นคว้าและวิเคราะห์หกมุม](../research/marketplace-buyer-receipt-brainstorm-2026-09-14-th.md)
Source cases: [ทะเบียน 45 เคสและข้อจำกัด](../research/marketplace-buyer-public-corpus-2026-09-14-th.md) · [JSON](../research/marketplace-buyer-public-corpus-2026-09-14.json)

## 1. ผลลัพธ์ที่เลือก

ผู้ใช้ส่งหลักฐานผ่านค่าใช้จ่าย/LINE เดิม เห็นสรุปที่เข้าใจง่ายในหน้าตรวจเดิม ระบุส่วนบริษัทและผู้จ่ายเฉพาะเมื่อระบบยังไม่รู้ จากนั้นระบบจัดข้อมูลพร้อมใช้ต่อกับ expense หรือ reimbursement ตามเส้นทางที่รองรับ โดยไม่ให้กรอกข้อมูลซ้ำหรือคำนวณคูปองเอง

ข้อเลือกหลักคือ “เก็บต้นฉบับครบ → ตรวจและจัดส่วนบริษัท → ใช้หลักฐานเดิมหรือทำใบรับรองเมื่อเข้าเงื่อนไข → ทำต่อใน expense/ใบเบิกเดิม” ต้นฉบับกับส่วนบริษัทมีคนละความหมายและต้องเก็บได้ทั้งคู่ ใบรับรองเป็นขั้นจัดการหลักฐาน ไม่ใช่ปลายทางการเงินแยก

ทุกจุดรับข้อมูลมีทางเก็บ/แก้/เพิ่มหลักฐาน/พักและกลับมาได้จริง การเก็บร่างไม่แปลว่าส่งเบิก อนุมัติ ลงบัญชี หรือจ่ายเงินแล้ว อายุ 40+ เป็นกลุ่มทดสอบที่มีทักษะหลากหลาย ไม่ใช้แทนสมมติฐานความสามารถของคน

## 2. ขอบเขตตั้งต้น

### Must-have ของ feature รุ่นแรก

- ทางเข้าค่าใช้จ่ายและ LINE เดิม; ภาพ/PDF ที่มีหลายร้าน หลายสินค้า และหลายหน้าที่เกี่ยวข้องกัน
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

ไม่อยู่ในรุ่นแรก: seller APIs/settlement/import backlog #19, automatic refund posting, generic arbitrary partial reimbursement, multiple claims/payers consuming one purchase group, external payees without accounts, new approval workflow และ AI financial finalization

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
- LINE multi-document/ambiguous refusal เดิมยังมีผล นอกจากกลุ่ม marketplace ที่ตรงกับ acceptance ใหม่อย่างชัดเจนซึ่งยังอยู่ใน authorized capture scope

## 8. ทางออกและสิทธิ

| สถานะ | ทางออก |
|---|---|
| รูปส่งไม่ถึง | บอกว่าไม่ถูกเก็บ ลองส่งต่อโดยรักษาข้อมูลในหน้าที่ทำได้ |
| รูปเก็บแล้ว อ่านไม่ครบ | เพิ่มภาพ/แก้ข้อมูลในงานเดิม/เก็บไว้ก่อน |
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

การรับ feature ต้องมีหลักฐาน UX 40+ และ integration/browser จริงสำหรับแต่ละ critical path pilot ที่อ่าน draft ได้ยังไม่แปลว่า expense/reimbursement end-to-end ผ่านทั้งหมด

## 11. สิ่งที่ยังต้องตัดสินก่อน implementation ส่วนที่เกี่ยวข้อง

- Company policy: shared discount/shipping allocation, personal coins, purchase/refund eligibility และ tax treatment ที่ต้องอาศัยเอกสารจริง
- Representative source bundles และ expected outputs ที่ตรวจโดยคน รวมขอบเขต supported layouts/limits
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

Marketplace screenshot ไม่ได้ต้องทำใบรับรองทุกภาพ การเสนอขึ้นกับข้อเท็จจริงการจ่าย ความไม่พร้อมของใบเสร็จ และ policy/eligibility เดิม; ผู้ใช้ไม่ต้องวินิจฉัยชนิดเอกสารเองเพื่อเริ่ม capture

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
- Acceptance A01–A48 ต้อง map กับ fixture ที่มีสิทธิใช้ และมี Thai positive multi-store paid cases ทุกแพลตฟอร์มก่อนอ้างว่ารองรับครบ ไม่มี accuracy/coverage target ที่ถือว่าผ่านแล้วจากจำนวนภาพ
- พฤติกรรมผิดที่ทำให้จ่าย/เบิกซ้ำ, ยอด/สกุล/ผู้จ่ายผิดแบบมั่นใจ หรือเปลี่ยน unpaid เป็น paid ต้องเป็น release blocker ใน regression ที่ตกลง ไม่เฉลี่ยกลบด้วย OCR accuracy รวม
- วัดเวลาแก้ของผู้ซื้อและบัญชี อัตราทำเองจบ อัตราพักแล้วกลับมาจบ ความเข้าใจสถานะ และค่าอ่าน/เวลาAI ต่อเคสก่อนกำหนด rollout; ยังไม่มี usability/eval results ในงานนี้

## 14. Impact, gaps และความเสี่ยงบั๊ก — ตรวจเทียบโค้ด 2026-09-14

**ผลประเมิน: v0.3 เพิ่ม IG01–IG14/A35–A48, v0.5 เพิ่ม IG15 และ v0.6 ตรวจทานผลรีวิวกับโค้ดอีกครั้ง** ทั้ง 15 รายการเป็น impact/gap targets จาก targeted static review ไม่ใช่การยืนยันว่ามี 15 production bugs หรือว่าตรวจทุก endpoint/ทุก race แล้ว

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
| IG14 / P1 | **Validation gap**: 45public casesดูหลากหลายแต่ยังไม่มีThai full paid multi-store golden bundlesทุกplatform และยังไม่ทดสอบ40+ | ปิดcoverageตามcorpusข้อ5, map A01–A48กับauthorized fixtures; separateaccuracy/false-ready/usability/cost; ห้ามอ้างผ่านจากจำนวนreference |
| IG15 / P1 | **Permission/entitlement gap**: capture group, business allocation และ derived source generation ยังไม่มี action-to-key/ownership mapping ที่ตัดสินแล้วใน [permission registry](../../apps/api/src/modules/auth/permission-registry.ts:160) และยังไม่ตัดสินว่า gate ด้วย entitlement/capability อย่างไร | ระบุ key/role/entitlement ก่อน W01; server ปฏิเสธ actor ที่ไม่มีสิทธิในทุก entry point ไม่ใช้การซ่อนปุ่ม; A15/A46 |

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
- ก่อนเปิดfinancial handoff ต้องปิด IG01/IG03/IG04/IG05/IG07/IG11 ในขอบเขตที่เปิดจริง พร้อมAPI/DB concurrency, source/certificate/payment identity และexport reconciliation; ไม่ใช้UIซ่อนปุ่มแทนserverguard
- ก่อนใช้group captureกับลูกค้า ต้องผ่านper-file save/recovery, completeness/limit, quota, LINE target, permissionsและversion testsของเส้นทางนั้น; ordinary single-file receipt regressionต้องผ่านด้วย
- A01–A48 เป็นacceptance targets ยังไม่มีเครื่องหมายผ่านในรอบstatic reviewนี้ ต้องบันทึกcommand/fixture/resultและข้อจำกัดเมื่อทดสอบจริง
- Verificationรอบนี้: อ่านโค้ดและtest definitionsข้างต้นพร้อมspecเดิม; ตรวจเอกสาร/ลิงก์/IDด้วยlocal checkเท่านั้น ไม่มีAPI/DB/browser repro, application tests หรือcloud access จึงยังไม่สรุปว่าปลอดบั๊กหรือพร้อมrelease

<a id="implementation-plan"></a>
## 15. การพัฒนาคู่กับ spec

ใช้ [Implementation plan](../plans/marketplace-buyer-expense-capture-plan-th.md) เป็นรายการงานที่เดินตามข้อกำหนดนี้ ทุก work package มี dependencies, เจ้าของ boundary, จุดแก้ในrepo, ผลส่งมอบและวิธีตรวจรับ โดยยังไม่ถือว่าข้อกำหนดผ่านเพราะมีแผนแล้ว

| งานในแผน | ข้อกำหนดใน spec ที่รับผิดชอบ | สิ่งที่ต้องเห็นก่อนผ่านงาน |
|---|---|---|
| [W00](../plans/marketplace-buyer-expense-capture-plan-th.md#w00) | §2/5/11/13/14 | decision ของ slice, contract/caller inventory และ fixture readiness |
| [W01](../plans/marketplace-buyer-expense-capture-plan-th.md#w01) | §4/5/8/14 | capture-only/lineage/access/version guards ก่อนรับกลุ่ม |
| [W02](../plans/marketplace-buyer-expense-capture-plan-th.md#w02) | §3/7/8/14 | หลายไฟล์ append/replace/resume และกลับงานเดิมได้จริง |
| [W03](../plans/marketplace-buyer-expense-capture-plan-th.md#w03) | §6/7/13 | อ่านพร้อมscope/evidence/completeness ไม่แต่งยอดและไม่ข้ามquota |
| [W04](../plans/marketplace-buyer-expense-capture-plan-th.md#w04) | §3/4/6/8/9 | ส่วนบริษัท/ผู้จ่าย/snapshot/ทางพักในหน้าตรวจเดิม |
| [W05](../plans/marketplace-buyer-expense-capture-plan-th.md#w05) | §4/5/9/14 | eligible sources เต็มยอดส่วนบริษัทและใช้เงินจริงได้ครั้งเดียว |
| [W06](../plans/marketplace-buyer-expense-capture-plan-th.md#w06) | §12/14 | ใบรับรอง DIGITAL/PAPER + partial progress + กลับsourceเดิม |
| [W07](../plans/marketplace-buyer-expense-capture-plan-th.md#w07) | §5/9/12/14 | expense/claim/payment/exportทั้งสายไม่ซ้ำและสิทธิถูกต้อง |
| [W08](../plans/marketplace-buyer-expense-capture-plan-th.md#w08) | §10/13.5/14.4 | integration/AI/UX40+/compatibility/readinessตามขอบเขตที่เปิด |

แผนข้อ6จับคู่ A01–A48 ทีละข้อกับงานและหลักฐาน; ข้อ7จับคู่ IG01–IG15 กับงานที่ต้องปิด; ข้อ4ระบุ D01–D06 และงานที่ขึ้นกับแต่ละdecision เพื่อไม่หยุดงาน capture เพราะ policy การเงินที่ยังไม่ใช้

เมื่อเปลี่ยนbehavior/contract/ขอบเขต ให้แก้specและplan/memoryในงานเดียวกัน โดยคง acceptance/IG IDs ที่ยังมีความหมายและเพิ่มIDเมื่อมีข้อกำหนดใหม่ ไม่ใช้planยกเว้นกฎเงิน/สิทธิ/ใบรับรองของspecโดยไม่ระบุการเปลี่ยน

W06เป็นข้อบังคับของfeatureเต็ม; capture pilotไม่ทำให้ถือว่าจบค่าใช้จ่าย/ใบเบิก และ COMPANY certificate issuanceซึ่งอาจบันทึกpaymentต้องอยู่ภายใต้financial gate แม้พัฒนาอยู่ก่อนงานhandoff W07 การเปิดลูกค้าจริงต้องผ่านreadinessและreleaseprotocolตามแผน
