# Implementation Plan: อ่านหลักฐานซื้อหลายร้านผ่านค่าใช้จ่ายเดิม

Status: Planned v0.6, 2026-09-16. Paired with spec v0.6. Work packages W00–W08, D01–D08, A01–A48 และ IG01–IG15 are defined; application implementation has not started in this task. ตรวจทานรีวิว v0.5 และแก้ route/stage, payer/tax, rollout และ privacy ตาม §10 แล้ว
Spec: [ข้อกำหนดผลิตภัณฑ์และการเชื่อมระบบ](../specs/marketplace-buyer-expense-capture-spec-th.md)
Research: [วิเคราะห์หกมุม](../research/marketplace-buyer-receipt-brainstorm-2026-09-14-th.md)
Corpus: [45 public purchase/order cases + 9 supplemental cases](../research/marketplace-buyer-public-corpus-2026-09-14-th.md)
Memory: [สถานะงาน](../agent-memory/marketplace-buyer-receipt-brainstorm.md)

## 1. ผลลัพธ์และวิธีใช้แผนคู่กับ spec

ผู้ซื้อส่งหลายภาพ/PDF ผ่านค่าใช้จ่ายหรือ LINE เดิม ตรวจรายการบริษัทและผู้จ่าย ใช้ใบเสร็จที่มีหรือทำใบรับรองแทนใบเสร็จเมื่อเข้าเกณฑ์ แล้วไปค่าใช้จ่าย/ใบเบิกเดิมโดยไม่กรอกซ้ำ ไม่คำนวณคูปองเอง และไม่เบิกหรือบันทึกจ่ายซ้ำ

Spec เป็นแหล่งกติกาและ acceptance; แผนนี้เป็นลำดับงาน จุดแก้ dependencies และหลักฐานตรวจรับ การเปลี่ยน behavior ต้องแก้ spec กับ mapping ของแผนในงานเดียวกัน ไม่ใช้ implementation เปลี่ยนนโยบายโดยปริยาย

- ทุก W เป็นขอบเขตตรวจรับ อาจแบ่งหลาย diff/PR ตามขนาดจริง ไม่กำหนดว่าต้องทำ PR ใหญ่หรือหนึ่ง PR ต่อ W
- สถานะ W ใช้ Planned → In progress → Verified โดยอ้างหลักฐานที่รันจริง; มีโค้ดหรือ unit test ผ่านอย่างเดียวไม่ปิด integration/UX gate
- เจ้าของงานในเอกสารหมายถึงผู้รับผิดชอบตามโมดูล/การตัดสิน ไม่ใช่การสั่งสร้าง subagents หรือใช้ delivery-chain เดิม
- ไม่มีการเปิดบริการ cloud/deploy/ส่งข้อความลูกค้าจากการทำแผนนี้ การทดสอบเขียนข้อมูลให้ใช้ local isolated fixtures ที่ระบุชัด
- คงขอบเขตเริ่มต้นใน spec §2: THB, บริษัท/สาขาเดียว, ผู้จ่ายที่ยืนยันได้และ funding route เดียว; unsupported tax/BNPL/split funding/refund เก็บและพักตามเหตุผลจริง
- ใบรับรองแทนใบเสร็จเป็นงานบังคับ W06 ของ feature เต็ม ไม่ถูกตัดออกเมื่อแบ่งงานเป็นช่วง

## 2. สิ่งที่เสร็จแล้วและสิ่งที่ยังไม่ได้ทำ

- [x] สังเคราะห์ solution หกมุมและเชื่อม upload/expense/reimbursement/certificate เดิม
- [x] ตรวจภาพสาธารณะ 45 purchase/order cases แพลตฟอร์มละ15 และเคสเสริม9 โดยระบุประเทศ/ชนิด/ข้อจำกัด ไม่ใช่45ใบเสร็จที่ยืนยันความแท้
- [x] ตรวจโค้ดแบบเจาะจุด: spec §14 มี E01–E11 และ IG01–IG15; ยังไม่ใช่ inventory ทุก caller หรือ runtime reproduction
- [x] จัด W00–W08 และ traceability ครบ A01–A48 / IG01–IG15 ในแผนนี้
- [x] รีวิวเอกสาร 2026-09-15 เทียบ resolver/permission registry จริง: เพิ่มข้อบังคับ payer/totals identity/tax classification, D07 permission, IG15 และแก้ seam ของ W04
- [ ] ตัดสิน persistence/API/policy เฉพาะส่วนที่ใช้จริงและจัด Thai golden bundles ที่ได้รับสิทธิ์
- [ ] ลงมือแก้แอป/migration, ทดสอบ API/DB/browser, วัด AI และ usability40+
- [ ] ตรวจรับ feature เต็มและผ่านกระบวนการปล่อยระบบเมื่อมีงาน release

## 3. ลำดับงานและ dependencies

| งาน | ส่งมอบอะไร | ต้องมีมาก่อน | Spec |
|---|---|---|---|
| W00 | ปิด design decisions ของ slice, caller inventory, fixtures และ contract | baseline/corpus/impact review ที่มีแล้ว | §2/5/11/13/14 |
| W01 | data contract, capture-only guards, lineage/access/version foundation | W00: D01/D06/D07 และขอบเขต intake D02 | §4/5/8/14 |
| W02 | multi-file upload/append/replace/resume ผ่าน Web/LINE เดิม | W01 และ D02 ฝั่ง upload | §3/7/8/14 |
| W03 | อ่านหลายหลักฐานพร้อม scope, completeness, reconciliation และ quota | W02 และ D02 ฝั่ง AI | §6/7/13 |
| W04 | review ส่วนบริษัท/ผู้จ่ายและ allocation snapshot | W03; D03 เฉพาะการคำนวณที่พึ่ง policy | §3/4/6/8/9 |
| W05 | สร้าง derived expense sources แบบ atomic/idempotent และกันใช้ซ้ำ | W04, D01/D03/D06 สำหรับ route ที่เลือก | §4/5/9/14 |
| W06 | ใบรับรองแทนใบเสร็จ DIGITAL/PAPER และทำต่อรายร้าน | W05 และ D04 | §12/14 |
| W07 | ต่อ expense/reimbursement เดิมพร้อม export/status/permissions | W05 + W06 สำหรับ branch ใบรับรอง | §5/9/12/14 |
| W08 | integration regression, AI/UX40+, compatibility และ readiness | W01–W07 + D05 | §10/13.5/14.4 |

ลำดับหลักคือ W00 → W01 → W02 → W03 → W04 → W05 → W06 → W07 → W08 การจัด fixture/UX discovery ใน W00/D05 ทำต่อระหว่างพัฒนาได้ การยังไม่รู้ policy การเงินไม่ขวางการทำ capture ที่ไม่ใช้ policy นั้น แต่ต้องไม่ข้าม gate ไปสร้างผลการเงินจริง

**จัด capture-only guards ใน W01 ก่อนเปิด multi-file intake W02** เพราะระบบเดิมสร้าง ExpenseRecord ตั้งแต่เริ่ม upload การเลื่อน guard ไปตอนแยกร้านจะเปิดช่องให้ draft รวมเข้าทาง confirm/pay/claim ได้

## 4. Decision register ก่อนลงมือส่วนที่เกี่ยวข้อง

| ID | ต้องตัดสินและบันทึก | ผู้รับผิดชอบการตัดสิน | บล็อกงานใดเมื่อยังไม่ชัด |
|---|---|---|---|
| D01 | ORM ที่เล็กที่สุดสำหรับ entryExpenseId↔group, source roles, stable item/scope IDs, revisions, unique keys, reservation และ lock order; migration/legacy defaults **ต้องบันทึกด้วยว่าเทียบกับทางเลือกที่แคบกว่า (ไม่สร้าง ExpenseRecord ตั้งแต่ init สำหรับ group intake) แล้วเลือก/ไม่เลือกเพราะอะไร** | ผู้พัฒนา API/ฐานข้อมูลและผู้ดูแลสถาปัตยกรรม | W01, W05 |
| D02 | manifest/append/replace/resume contracts, MIME/file/page/item limits, extraction attempt identity, batch budget, unknown/partial errors; reuse quota policy เดิม | ผู้พัฒนา Web/API/AI ตาม boundary | W02/W03 เฉพาะส่วนที่พึ่งข้อนั้น |
| D03 | shared discount/shipping eligible base, coins/wallet treatment, actual payer authorization, business allocation และ company-funded personal amount ที่ปลายทางแทนได้ **รวม tax review ตาม facts/สิทธิและทางพักเมื่อไม่รองรับ ไม่บังคับ NON_CLAIMABLE หรือ VAT=0; การแตกบรรทัดต้องผ่าน `expenseTotalsIdentityError` ของ vatMode ปลายทาง** | Product/ผู้รับผิดชอบบริษัทและบัญชี สำหรับ policy; API สำหรับ enforcement | W04 ที่คำนวณตาม policy, W05/W07 ของ route นั้น |
| D04 | map eligibility/วันที่/ผู้รับเงิน/ผู้รับรองกับกฎใบรับรองเดิม; wordingยอดoriginalกับส่วนบริษัท; correction/partial completion; ไม่สร้าง policy ใบรับรองใหม่โดยปริยาย | Product/บัญชีและผู้พัฒนา expense/certificate | W06 |
| D05 | authorized Thai positive/negative bundles, human expected labels, supported layout/limits, เกณฑ์ pilot ด้านเวลาแก้/ความเข้าใจ/false-ready | ผู้ตรวจข้อมูลบัญชี, QA/UX และผู้รับผิดชอบ AI | W08 และการอ้างความพร้อม/accuracy |
| D06 | backend-to-frontend source/payer/error contracts, canonical evidence access, full-source claim mapping, consumed-source aliases และ consumer inventory **รวมข้อชี้ขาด: derived source จะแทน actual payer อย่างไรในเมื่อ [resolver](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:32) ใช้ `createdByUserId` เมื่อไม่มีใบรับรอง — creator เดิมใช้ได้เมื่อเป็นผู้จ่ายจริงที่ยืนยันแล้ว หรือเพิ่ม server-verified payer binding; ห้ามปลอม creator และห้ามบังคับใบรับรองนอก eligibility §12 เพื่อแก้ payer** | ผู้พัฒนา expense/reimbursement/contracts | W01 foundation และ W05/W07 |
| D07 | permission key/entitlement ของ capture group, business allocation และ derived source generation: reuse key เดิมหรือเพิ่มใหม่ใน [permission registry](../../apps/api/src/modules/auth/permission-registry.ts:160), map เข้า role/ownership ใด และใช้ launch route/entitlement ใด รวม registry/seed/runoff/deployment admission; helper เดิมผูก expenses/DEFAULT ไม่รับ route ใหม่โดยอัตโนมัติ | ผู้พัฒนา auth/expense และผู้ดูแลสิทธิ | W01 และทุก UI/endpoint ของ feature |
| D08 | PDPA: ฐานการประมวลผล/ROPA/retention ของกลุ่มหลักฐานที่ไม่กลายเป็นเอกสารการเงิน และการส่งภาพที่มีข้อมูลส่วนบุคคลเข้า AI provider ตาม processor register เดิม | ผู้รับผิดชอบ PDPA/Product | ก่อน W02/W03 หรือ G1 ใช้ข้อมูลบุคคลจริง/ส่ง AI; fixtures จำลองไม่มีข้อมูลบุคคลเดินต่อได้ และ G3 ตรวจ coverage ครบ |

ทุก decision ยังเปิดจนกว่าจะมีเนื้อหาและผู้ตัดสินจริงใน spec/บันทึกงาน ไม่ให้ตัวเลือกเทคนิคธรรมดากลายเป็น approval ใหม่ที่ไม่จำเป็น; เรื่อง policy ที่เปลี่ยนยอด/สิทธิห้ามเดา หากเปลี่ยนขอบเขต ให้บันทึกใน spec ก่อนพัฒนาส่วนนั้น

## 5. Work packages ที่ตรวจรับได้

<a id="w00"></a>
### W00 — ปิดแบบของ slice และเตรียมหลักฐานทดสอบ

Owner: ผู้พัฒนา feature; Product/บัญชีเฉพาะ policy; QA/UX/AI เฉพาะ fixture และเกณฑ์ตรวจรับ
Status: Planned; งาน research/static review ในข้อ2เสร็จแล้ว แต่ W00 ยังไม่เสร็จ

- [ ] อ่าน spec/plan/memory ล่าสุดและเทียบ working tree ที่จะลงมือ ไม่อ้างเลขบรรทัด E01–E11 ว่ายังคงเดิมเสมอ
- [ ] ระบุ slice-1 contract: A ข้อไหนอยู่ใน slice แรก (ข้อเสนอ: employee-funded, ไม่เกินสองร้าน, ยังไม่มีใบรับรอง) และข้อไหนเลื่อน เพื่อไม่ให้ W00 กลายเป็นงานเอกสารยาวก่อนมีโค้ด
- [ ] ปิด D01/D06/D07 และส่วน D02 ที่ต้องใช้ก่อนสร้าง schema/upload; บันทึก action/request/response/error/revision และ permission matrix ลง spec §5/13 หรือ contract appendix ที่ลิงก์จาก spec
- [ ] inventory Web/LINE/API/background paths: init/complete/extract/update/remove/confirm/pay/post/claim/certificate/cancel/reversal และ list/count/export/evidence download; ต้องรวม [reimbursement-source.ts](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:97) ที่ query `sourceReimbursementRequestId: null` ในฐานะ read consumer ของ discriminator
- [ ] จัด fixtures จากข้อมูลที่ได้รับสิทธิ์; ใช้ simulated unit cases ที่ระบุว่าเป็นข้อมูลจำลองได้ระหว่างพัฒนา แต่ไม่นับแทน45referenceหรือThai golden bundles
- [ ] ให้คนระบุ expected scope/items/quantity/amount/currency/payment/refund/unknowns/business use/payer/document eligibility; แยก purchase ที่ซ้ำข้าม tuning/held-out
- [ ] ใช้ decision register แยกเรื่องที่ค้างเฉพาะ route ออกจากงาน capture ที่เดินได้
- [ ] D08 บันทึก policy/processor/retention ที่ reuse และช่องว่างก่อนใช้ข้อมูลบุคคลจริงใน W02/W03/G1; ใช้ fixtures จำลองที่ไม่มีข้อมูลบุคคลได้ระหว่างที่ยังเปิดอยู่

Deliverables: decisions ของ slice, endpoint/consumer inventory, fixture manifest และ expected outputs ที่ตรวจย้อนกลับได้
Exit: W01 เริ่มได้เมื่อ D01/D06/D07 ชัด; W02/W03 เริ่มเมื่อ D02 ส่วนที่ใช้ชัด; ไม่ต้องรอเปิดทุก unsupported route
Verification: ตรวจ contract กับ code owner/consumer และทำ traceability check; ยังไม่ใช้ผลนี้เป็น application test

<a id="w01"></a>
### W01 — Foundation และ guard ก่อนรับข้อมูลกลุ่ม

Owner: API/contracts/database
Status: Planned
Depends on: W00 / D01 / D06 / D07 และขอบเขต intake D02

จุดแก้หลัก: [Prisma schema](../../apps/api/prisma/schema.prisma), [expense contracts](../../packages/contracts/src/expenses.ts), [funding guard](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts), [expense repository](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), [reimbursement source](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)

- [ ] เพิ่ม bounded/versioned contracts และ relational identities ตาม D01 โดย reuse Expense module; ไม่สร้าง marketplace service แยก
- [ ] เพิ่ม source-role/capability guards ในทุก financial entry point จาก inventory รวม raw API/background callers; where-clause ของ ambiguous-source ฝั่ง reimbursements ต้องเห็น discriminator ด้วย ไม่ใช่เฉพาะโมดูล expenses
- [ ] เพิ่ม/ผูก permission key ตาม D07 และบังคับที่ server ทุก endpoint ของ feature; UI ซ่อนปุ่มไม่ใช่ guard
- [ ] วาง canonical ownership/retention/access และ lock traversal ที่ group/child/attachment aliases เข้าขอบเขตเดียวกัน
- [ ] reuse [launch gate เดิม](../../apps/api/src/modules/expenses/application/expense-launch-gate.ts:36) ตาม D07 โดยรู้ว่า `assertExpenseRootOpen` ผูก expenses/DEFAULT ตายตัว; route แยกต้องเชื่อม registry/seed/guard/runoff/deployment admission เดิมครบ ไม่เปิด route จริงในงานเอกสาร
- [ ] deploy compatibility guards ให้ทุก consumer ก่อนเริ่มสร้าง group; พิสูจน์ว่าไม่มี server/worker ที่ไม่รู้ source role เข้าถึงข้อมูลใหม่ ถ้าคุมไม่ได้คง intake ปิด; additive schema หรือปิด intake อย่างเดียวไม่อนุญาต rollback ไป binary เก่าหลังมีข้อมูล (spec §14.3)
- [ ] ทำ additive migration ตามแบบที่ตัดสินแล้ว; legacy records คง semantics เดิม ไม่เดาว่าเป็นcapture-onlyจากชื่อร้านหรือ OCR
- [ ] ให้ list/read แสดงงาน capture ได้โดยไม่สื่อว่าเป็นยอดบริษัทที่รับรู้แล้ว; versions ที่ไม่เข้าใจ source role ปฏิเสธ final mutation

Exit: สร้าง capture-only fixture ได้และพิสูจน์ว่า confirm/pay/claim/certificate-finalization ที่ยังไม่ eligible ถูกปฏิเสธโดย server; ordinary receipt ยังผ่าน path เดิม
Checks: contract/DTO checks, local PostgreSQL constraints/transactions, cross-company/branch/actor/alias และ old/new capability tests
Acceptance หลัก: A09/A10/A15/A16/A35/A36/A38/A39/A44/A46/A47
IG: IG01/IG03/IG04/IG07/IG09/IG13/IG15

<a id="w02"></a>
### W02 — อัปโหลดหลายไฟล์และกลับมาทำต่อ

Owner: Web/API/LINE intake
Status: Planned
Depends on: W01 / D02 upload contract

จุดแก้หลัก: [ExpensesPages](../../apps/web/src/features/expenses/ExpensesPages.tsx), [upload UI logic](../../apps/web/src/features/expenses/expense-upload.logic.ts), [expense client](../../apps/web/src/features/expenses/expenses.api.ts), [upload use cases](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts), [remove receipt](../../apps/api/src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.ts), [LINE continuation](../../apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts)

- [ ] ทางเข้าปัจจุบันรับหลายไฟล์/หลายหน้าเป็น recoverable work item; ไม่วน init แล้วสร้าง unrelated expense ต่อไฟล์
- [ ] per-file identity/manifest/status และ resumable intent; complete/retryใช้identityเดิมเมื่อผลตอบกลับหาย
- [ ] “เพิ่มหลักฐาน” append; “เปลี่ยนไฟล์นี้” replace เฉพาะเป้าหมาย; detach/cleanupไม่ลบไฟล์ที่ source/signature ยังอ้าง
- [ ] กลับจากปิดหน้าแสดงส่วนที่ server เก็บแล้ว ขอเลือกใหม่เฉพาะไฟล์ที่ bytes ยังไม่ถึง ไม่สัญญาว่าเก็บไฟล์บนbrowserได้ทุกกรณี
- [ ] LINEผูกgroup/source/actor/branchจากบริบทที่ยืนยันได้; หลายงานหรือภาพที่มาช้าให้เลือกงานเมื่อกำกวม
- [ ] single-file/camera/drop/review เดิมยังทำงาน; ปุ่มและข้อผิดพลาดอ่านง่ายตาม spec §8

Exit: ส่ง4ไฟล์ สำเร็จ2แล้วตัดเน็ต กลับมาทำต่อโดยไม่สูญงาน/สร้างdraftซ้ำ และเพิ่มหน้า2ไม่ retire หน้า1
Checks: upload/retention/API permission tests, local browser บนmobile+desktop และ LINE payload/retry tests โดยไม่ส่งข้อความจริงถึงลูกค้า
Acceptance หลัก: A01/A02/A14/A15/A35/A36/A43/A45/A46
IG: IG01/IG09/IG10

<a id="w03"></a>
### W03 — อ่านหลักฐานแบบมี scope และไม่ฝืนเติมค่าที่ขาด

Owner: AI Gateway + API extraction
Status: Planned
Depends on: W02 / D02 extraction contract

จุดแก้หลัก: [OCR contract](../../packages/contracts/src/line-ai.ts), [extract use case](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts), [OCR client](../../apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts), [OCR apply](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts), [document classification](../../apps/ai-gateway/src/modules/line-ai/domain/logic/business-document-classification.logic.ts)

- [ ] group extractionเก็บpage/regionหรือexact span, document/order/store/item/component identities และ completeness; ไฟล์เดียวอาจหลายorder/หลายpanel
- [ ] อ่าน monetary roles แยก charge/discount/tax/tender/reward/refund/summary และความสัมพันธ์included/parent-child; ไม่รวมสิ่งที่ซ้ำ — เริ่มตาม spec §13.3 คือ schema กลางที่เก็บ label/scope/ที่มา แล้วเพิ่ม mapping เฉพาะที่มีตัวอย่างรองรับ ไม่ต้องได้ taxonomy เต็มก่อน G1
- [ ] ตรวจ source-reported amounts/สมการด้วยDecimal; แยก observed/inferred/policy-derived; ไม่สร้างrounding/discountเพื่อปิดยอด
- [ ] รองรับเกินlimit/แถวเสียด้วยincomplete stateที่รักษาต้นฉบับ; summary fallbackไม่อ้างว่าพร้อมแบ่งสินค้า
- [ ] แยก method/paid/refund timeline/destination/currency และวันที่แต่ละเหตุการณ์; unknownไม่เป็น0/THB/paid
- [ ] reuseผลที่ตรงrevision, per-attempt budget/admission และ retryตามgovernanceเดิม; quotaหมดกลางชุดยังเก็บ/แก้ต่อได้
- [ ] ป้องกันprompt injectionจากเอกสารและlate resultทับreview; Gatewayเรียกpermission-checked APIsเท่านั้น

Exit: ส่งผลที่มีหลักฐานตรวจย้อนกลับได้พร้อมunknown/incomplete ไม่เปลี่ยนสถานะเงินเอง; foreign/BNPLรับเป็นcaptureตามขอบเขต
Checks: schema/parser fixtures, actual extraction against authorized examples เมื่อพร้อม, source-reference validity, quota/lost-response/stale-result tests; แยก OCR correctness จาก readiness
Acceptance หลัก: A01/A02/A06/A07/A12/A23–A31/A33/A34/A36/A37/A42/A43/A48
IG: IG02/IG06/IG08/IG12/IG14

<a id="w04"></a>
### W04 — ตรวจส่วนบริษัท ผู้จ่าย และยอดจัดสรร

Owner: Web/API; Product/บัญชีสำหรับ D03
Status: Planned
Depends on: W03; D03 เฉพาะกฎที่ใช้กับยอด

จุดแก้หลัก: [review page](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx), [review validation](../../apps/web/src/features/expenses/expense-review-validation.ts), [upload/list UI](../../apps/web/src/features/expenses/ExpensesPages.tsx), [draft use cases](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts), [expense totals](../../apps/api/src/modules/expenses/domain/logic/expense-totals.logic.ts)

หมายเหตุชื่อ: `expense-source-draft.logic.ts` และ `expense-source-draft.model.ts` ที่มีอยู่เดิมคือร่างบทสนทนา LINE ไม่ใช่งานจัดสรรของ W04 อย่านำมาใช้เป็น seam และอย่าเรียกของใหม่ว่า source draft (ดู spec §4)

- [ ] สรุปยอด/ร้าน/สินค้า/ผู้จ่ายในหน้าตรวจเดิม เปิดdetailเพิ่มได้ และแสดงblockerที่กระทบactionก่อนกด
- [ ] รับ business/personal selectionระดับจำนวนโดยไม่เลือก“บริษัททั้งหมด”ให้เอง; purposeทั่วไปยังoptional
- [ ] ผูก actual payerตามสิทธิ ไม่ใช้uploader/ชื่อผู้รับสินค้าแทนผู้รับเงินคืน
- [ ] source breakdownก่อนunique inferenceก่อนpolicy allocation; largest remainderถึงสตางค์พร้อมstable ties/eligible caps/provenance
- [ ] ผลการแบ่งต้องแตกเป็นบรรทัดที่ผ่าน `expenseTotalsIdentityError` ตาม vatMode ปลายทาง; tax classification มาจาก facts/review ตาม D03 เมื่อ employee route ยังไม่รองรับให้เก็บรอ ไม่บังคับ classification ให้ resolver รับ
- [ ] serverสร้างreviewed allocation snapshot ผูกrevision/policy/payer/selection; การเปลี่ยนfactsทำให้previewที่เกี่ยวข้องหมดอายุ
- [ ] unknown/unsupportedคงทางพัก; business amount0ที่ยืนยันแล้วจบเป็นหลักฐานไม่มีเงินส่งต่อ
- [ ] เลือก expenseDateจากfactsที่reviewตามปลายทาง ไม่ใช้upload dateทับpayment/invoice/order date

Exit: original1,290/บริษัท810/ส่วนตัว480และที่มาการแบ่งยังอยู่ครบ; คนกลับมาแก้ต่อได้และไม่ต้องคำนวณคูปองเอง
Checks: Decimal property/invariant tests รวม totals identity ของบรรทัดที่สร้าง, stale revision/permission checks, review save/reload และ usability discovery40+ ของsummary/recovery
Acceptance หลัก: A03–A08/A11/A12/A14/A19/A24/A27/A28/A31/A32/A34/A37/A41/A42/A45/A48
IG: IG06/IG10/IG11/IG12

<a id="w05"></a>
### W05 — Eligible sources และการใช้ยอดครั้งเดียว

Owner: API expense/reimbursement/database
Status: Planned
Depends on: W04 / D01 / D03 / D06 สำหรับ funding route ที่จะใช้

จุดแก้หลัก: [expense repository](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), [funding guard](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts), [source resolver](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts), [duplicate detection](../../apps/api/src/modules/expenses/application/services/expense-duplicate-detection.ts)

- [ ] สร้าง derived expense sources ตาม legal/document scope จาก accepted snapshot แบบ atomic/idempotent batch; ไม่มี expense รวมอีกก้อนที่ลงเงินได้
- [ ] แต่ละsourceเต็มยอดส่วนบริษัท เช่น810; ไม่overridefull-source resolverให้เบิก810จากsource1290
- [ ] employee source ที่มีหลักฐานครบต้องผ่าน [readReimbursementSource](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:18) ก่อนใบเบิก: payer D06, lines/netPayable/totals identity และ tax guards; source รอใบรับรองสร้างเพื่อเข้า W06 ได้แต่ยังไม่ claim-ready ทดสอบ rejection ก่อน ISSUED และ resolver ผ่านหลัง W06 เมื่อ facts อื่นครบ
- [ ] company-funded ใช้ expense/certificate validation ของ route นั้น ไม่บังคับ reimbursement resolver และไม่ใช้ข้อห้าม VAT/WHT ของ employee route เหมารวม; source รอ review ไม่เปิด final mutation
- [ ] canonical lineage/permission/actual payer binding พร้อม one-active funding route และoperation keysที่query/lockได้
- [ ] retries/concurrent users/route-switch/group aliasesไม่ใช้ยอดซ้ำ; valid siblingsแชร์หลักฐานได้ผ่านlineageที่ตรวจแล้วโดยไม่ปิดambiguous-source guardรวม
- [ ] merge/split/cancel/regenerateไม่ย้ายconsumed sourceหรือลายเซ็น; คืนสิทธิใช้ใหม่เฉพาะเมื่อพิสูจน์ว่าไม่มีผลเงิน/active consumptionค้าง
- [ ] source0ไม่ถูกmaterializeเป็นpositive-money expense; unknownยังต้องreview

Exit: มีeligible810จากoriginal1290ที่พิสูจน์source chainได้ และ concurrent generationได้destination batchเดียว
Checks: local PostgreSQL race/unique/locking tests, alias cross-tenant tests, source full amount/date/payer/line totals และ failure rollbackของdraft generation
Acceptance หลัก: A03/A04/A09–A11/A15/A16/A32/A38/A39/A41/A44
IG: IG03/IG04/IG07/IG11

<a id="w06"></a>
### W06 — ใบรับรองแทนใบเสร็จและสถานะรายร้าน

Owner: Expense/certificate API + Web/LINE handoff; บัญชีสำหรับ D04
Status: Planned — required for full feature
Depends on: W05 / D04

จุดแก้หลัก: [certificate use case](../../apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts), [funding rules](../../apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts), [certificate repository](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), [edit sync](../../apps/api/src/modules/expenses/infrastructure/substitute-expense-edit.ts), [wizard model](../../apps/web/src/features/expenses/substitute-receipt-wizard.model.ts), [LINE continuation](../../apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts)

- [ ] eligibilityต่อeligible source: paid business evidence + ไม่มีใบเสร็จ/ขาดสาระสำคัญตามกฎเดิม; ไม่มีVATinvoiceอย่างเดียวหรือunpaid orderไม่auto-issue
- [ ] prefillเฉพาะfactsที่ตรวจแล้ว เหตุผล/คำรับรองให้ผู้มีสิทธิระบุ; ไม่ถามข้อมูลเดิมซ้ำ
- [ ] original payment1,290กับcertified company portion810แสดงความสัมพันธ์จริง; ไม่เปลี่ยนสลิปเป็น810หรือรับรองส่วนตัว
- [ ] DIGITALใช้บัญชีผู้รับรองจริง; PAPERใช้แบบ/อัปโหลดฉบับลงนาม/ตรวจรับตามกฎเดิม; unlinked payerไม่กลายเป็นผู้รับเงินเบิก
- [ ] reserve group/scopeก่อนconsequential steps; per-source/version idempotencyและprogress แยกatomic draft generationจากรอคนเซ็น
- [ ] COMPANY issueอาจบันทึกpaymentครั้งเดียวตาม guard เดิม; กรณีจ่ายบางส่วนมาก่อน [assertFullSubstitutePayment](../../apps/api/src/modules/expenses/domain/logic/substitute-funding.logic.ts:6) บล็อกการออกใบทั้งใบ (`substitute_full_payment_required`) คงทางพัก/ตรวจ facts และแก้ผ่าน correction/reversal ที่มีสิทธิเมื่อประวัติผิดจริง ห้าม rewrite/เติมจ่ายเพื่อผ่าน guard; PERSONAL_ADVANCE issueไม่คืนเงินบริษัท
- [ ] ร้านAออกแล้วBค้าง ให้ทำต่อBโดยไม่reissue/pay A; แก้factsที่เซ็นแล้วใช้correctionไม่ย้ายลายเซ็น
- [ ] กลับsource/งานเดิมพร้อมสถานะจริงและnext actionตามสิทธิ; ไม่สร้างหรือส่งใบเบิกเองจากissuance

Exit: ทั้งเส้นทางมีใบเสร็จ/บางร้านไม่มี/DIGITAL/PAPER/ทำค้างแล้วต่อ ผ่านreviewและกลับงานเดิมถูกใบ
Checks: API/DB issue raceและpartial progress, source-edit/signature races, COMPANY0/full/partial และ PERSONAL no-payment, render/inspectเอกสารจริง และmobile/desktop wizard return
Acceptance หลัก: A10/A13/A14/A17–A23/A33/A34/A35/A40/A44/A45/A48
IG: IG01/IG05/IG06/IG10/IG11

ข้อสังเกตการเปิดใช้: COMPANY issuanceมีผลการเงินจริง จึงต้องผ่านfinancial gateในข้อ9ก่อนให้ลูกค้าใช้ แม้ตำแหน่งในแผนจะอยู่ก่อนW07 การพัฒนา/ทดสอบlocal W06ไม่เท่ากับเปิดใช้แยกโดยข้ามgate

<a id="w07"></a>
### W07 — Expense/ใบเบิกเดิม และยอดในหน้ารายการ/รายงาน

Owner: Expense/reimbursement/ledger integration + Web/API
Status: Planned
Depends on: W05 และ W06 สำหรับ certificate branch

จุดแก้หลัก: [source resolver](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts), [reimbursement repository](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts), [claim materializer](../../apps/api/src/modules/reimbursements/application/services/materialize-claim-expenses.service.ts), [expense draft/confirmation](../../apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts), [expense export](../../apps/api/src/modules/expenses/domain/logic/expense-export.logic.ts), [reimbursement client](../../apps/web/src/features/reimbursements/reimbursements.api.ts)

- [ ] employee-funded eligible sourcesเข้าใบเบิกเดิมเต็มsourceพร้อมsnapshot; ordinary company expense sourceไม่ถูกconfirm/payขนานกัน
- [ ] company-fundedเข้าexpense pathตามfacts; ของส่วนตัว/unsupportedtaxต้องมีrepresentationหรือเก็บรอ ไม่ซ่อนเงินออกจริง
- [ ] submit/approve/finance projection/confirm/payment revalidategroup/source/payer/policy revisionและlocks; ไม่มีfinal mutationจากAI
- [ ] list/count/source-picker/export/evidence/LINEแสดงrolesและยอดcompanyตามownerของการรับรู้ ไม่บวกparent+source+projectionซ้ำ
- [ ] ทุกdownload/deep link/exportตรวจสิทธิoriginal evidence; child accessไม่ขยายสิทธิparentและไม่เท่ากับredactส่วนตัว
- [ ] invoice/refundตามมาเชื่อมpurchaseเดิม; signed/paid/postedใช้correct/reverseตามระบบ ไม่silent overwrite
- [ ] retryจากresponseหายและpartial downstream workกลับdestinationเดิมพร้อมสถานะจริง

Exit: browser/API/DBแสดงเส้นทางoriginal1290→source810→claim810→projection/paymentที่ถูกต้องเพียงชุดเดียว รวมtax blockedและcompany-fundedทางที่รองรับ
Checks: end-to-end local integration, payment-vs-edit races, snapshot/actor/branchrevocation, source/payment/JV identities, export reconciliation และordinary expense/reimbursement regression
Acceptance หลัก: A01/A04/A05/A08–A10/A13/A15/A17/A20/A21/A24/A30–A32/A39/A40/A42/A44/A46
IG: IG03/IG04/IG05/IG07/IG09/IG11

<a id="w08"></a>
### W08 — ตรวจรับและเตรียมเปิดใช้

Owner: ผู้พัฒนา feature + QA/UX/AI + Product/บัญชีในผลลัพธ์ที่รับรอง
Status: Planned
Depends on: W01–W07 / D05

- [ ] รันA01–A48ตามmappingและบันทึกผลจริงต่อfixture/case; skipหรือmockไม่ใช้แทนหลักฐานDB/browserที่กำหนด
- [ ] วัดAIด้วยheld-out purchase bundles แยกmoney/scope/item completeness/payment/refund/unknown/false-ready; ไม่อ้างaccuracyจาก45publicreferences
- [ ] ทดสอบผู้ใช้40–49/50–59/60+ที่มีทักษะต่างกัน เริ่มdiscovery6–8คน ใช้uploadหลายภาพ/ตัดส่วนตัว/แก้ยอด/พักกลับ/ใบรับรอง/แยกsaved-issued-submitted-paid
- [ ] เก็บindependent completion, correction timeของผู้ซื้อ/บัญชี, recovery success, false confidence, providerlatency/cost ตามเกณฑ์D05
- [ ] ทดสอบold/newcontract/worker compatibility, disable-new-intakeและงานค้าง, retained evidence, normal receipt regressions
- [ ] ปิดIGตามsliceด้วยdecision+implementation+evidence; ผลผิดผู้จ่าย/สกุล/ยอด/paidและduplicatefinancial consumptionเป็นreleaseblockerในชุดregressionที่ตกลง
- [ ] บันทึกข้อจำกัดและreadinessตามrouteจริง; งานcloud/releaseภายหลังต้องอ่านrunbooksและผ่านprotocolของrepoก่อนทำ

Exit: มีacceptance evidenceครบสำหรับrouteที่เสนอเปิดใช้งาน พร้อมremaining unsupported routesที่แสดงทางพักจริง; ไม่มีการประกาศreleaseจากlocaltestsอย่างเดียว
IG: IG01–IG15; Acceptance: A01–A48

## 6. Traceability: acceptance → งานและหลักฐาน

ตารางนี้เป็น authoritative ของการ map acceptance→งาน ส่วน "Acceptance หลัก" ใต้แต่ละ W เป็นรายการย่อที่ไม่ exhaustive แต่ละแถวคือข้อกำหนดใน spec §10; ทุกแถวยังเป็น **Planned** ผลverificationให้บันทึกตามข้อ10 ไม่ใช้mappingเป็นเครื่องหมายผ่าน

| Acceptance | งานที่รับผิดชอบ | หลักฐานสำคัญ |
|---|---|---|
| A01 | W02/W03/W07/W08 | ordinary single-file receipt และค่าใช้จ่ายเดิมผ่านจริง |
| A02 | W02/W03 | หลายภาพ/หน้าซ้อนครบและนับครั้งเดียว |
| A03 | W04/W05 | Decimal allocation รวม1,290 และส่วน810/480ตรงfixture |
| A04 | W04/W05/W07 | original1,290→eligible810→full-sourceclaim810 |
| A05 | W04/W07 | บริษัทจ่ายรวม/ส่วนตัวคงfacts ไม่มีemployeeclaimผิดroute |
| A06 | W03/W04 | futurecashbackไม่ลดpayableปัจจุบัน |
| A07 | W03/W04 | parent/childdiscountและnetshippingไม่นับซ้ำ |
| A08 | W04/W07 | unsupportedtaxคงfactsและrejectเฉพาะaction |
| A09 | W01/W05/W07 | validatedsharedlineageใช้ได้; unrelatedambiguousยังreject |
| A10 | W01/W05/W06/W07 | DBconcurrencyและlostresponseเกิดผลเงิน/เอกสารครั้งเดียว |
| A11 | W04/W05/W06 | selection/payerเปลี่ยนแล้วpreviewเก่าใช้ไม่ได้ |
| A12 | W03/W04 | lateOCRไม่ทับค่าที่คนตรวจ |
| A13 | W06/W07 | lateinvoice/refundไม่ซื้อซ้ำหรือเขียนทับpostedhistory |
| A14 | W02/W04/W06 | พัก/กลับงานเดิมพร้อมสถานะที่userเข้าใจ |
| A15 | W01/W02/W05/W07 | API/DB/downloadcross-company/branch/actorถูกปฏิเสธ |
| A16 | W01/W05 | differentimage/groupaliasของorderเดิมยังกันใช้ซ้ำ |
| A17 | W05/W06/W07 | source รอใบรับรองสร้างได้แต่เบิกไม่ได้; certify810พร้อมoriginal1,290; PERSONALไม่คืนเงินตอนissue; resolver ผ่านหลัง ISSUED เมื่อ facts ครบ |
| A18 | W06 | บางร้านมีใบเสร็จ บางร้านใช้ใบรับรองเฉพาะscope |
| A19 | W04/W06 | missingVAT/unpaidไม่auto-createcertificate |
| A20 | W06/W07 | COMPANYissue/retry/paymentครั้งเดียว; zero/full/partial fixtures และ partial บล็อก issuance ทั้งใบโดยไม่ rewrite history |
| A21 | W06/W07 | DIGITAL/PAPER/verifiedpayerตามidentityและsignaturepolicy |
| A22 | W04/W06 | แก้factหลังpreview/sign/issueใช้invalidate/correctionถูกสถานะ |
| A23 | W03/W06 | PaidbyQR+Transferยังไม่paid/eligiblecertificate |
| A24 | W03/W04/W07 | order45,900กับreceipt47,900แยกfactsโดยไม่แต่งdiscount |
| A25 | W03 | subtotalรวมส่ง/taxsummaryไม่บวกซ้ำ |
| A26 | W03 | historyคนละorderแยก; panelซ้ำไม่เพิ่มสินค้า |
| A27 | W03/W04 | qty/variant/bundle/giftเป็นแถวที่พิสูจน์ได้ |
| A28 | W03/W04 | cropped/collapsed/missingfieldsคงunknown |
| A29 | W03 | futurecoupon/coinsไม่กลายเป็นapplieddiscount |
| A30 | W03/W07 | refundcurrentstep/destination/bankconfirmationแยกกัน |
| A31 | W03/W04/W07 | foreign/BNPLไม่แปลงเป็นTHBหรือcashadvanceเอง |
| A32 | W04/W05/W07 | verified actual payer ต่างจาก uploader ตาม D06; creator ไม่ถูกปลอม และไม่บังคับใบรับรองนอกเกณฑ์ |
| A33 | W03/W06 | ปุ่มReceiptไม่ใช่เอกสารreceiptที่ได้แล้ว |
| A34 | W03/W04/W06 | checkoutmismatchเก็บร่าง ไม่สร้างbalancingrow/paidcertificate |
| A35 | W01/W02/W06 | append/replace/detachและretentionทุกsource |
| A36 | W01/W02/W03 | per-filepersist/resumeหลังpartialupload/responseหาย |
| A37 | W03/W04 | 41items/แถวเสียไม่ทำsummaryดูพร้อมitemallocation |
| A38 | W01/W05/W08 | raw API/worker guards; rollout fixture พิสูจน์ว่า binary ที่ไม่รองรับไม่เข้าถึง capture records ก่อนเปิด intake |
| A39 | W01/W05/W07 | list/count/export/ledgerไม่รวมparent+source+projectionซ้ำ |
| A40 | W06/W07 | partialcertificatecompletionทำต่อเฉพาะsourceค้าง |
| A41 | W00/W01/W04/W05 | known business zero ไม่มี zero-money destination; capture-only retention/access ตาม D08 รวมส่วนตัวทั้งหมดและงานทิ้งค้าง |
| A42 | W03/W04/W07 | order/payment/invoice/uploaddatesข้ามเดือนยังมีที่มา |
| A43 | W02/W03 | quota/attemptidentity/lostresponseใช้ผลที่เก็บแล้ว |
| A44 | W01/W05/W06/W07 | merge/splitหลังsign/consumptionไม่ย้ายสิทธิเงินหรือลายเซ็น |
| A45 | W02/W04/W06 | LINEหลายงาน/ภาพมาช้าไม่แก้ผิดgroup/source |
| A46 | W01/W02/W07 | child/originalaccessตรวจจริงบนview/download/export/LINE |
| A47 | W01/W08 | disable intake ยังอ่าน/กู้คืนตามสิทธิ; ไม่ rollback ไป binary ที่ไม่รองรับหลังมีข้อมูลใหม่; route/entitlement/runoff เดิมผ่าน |
| A48 | W03/W04/W06 | group/source/selectionrevisionป้องกันlateworkerทับreview |

## 7. Traceability: gap → งานที่ต้องปิด

ทุก IG ยัง **Open**; วงเล็บ P0 เป็น financial gate ตาม spec ไม่ใช่เหตุProductionปัจจุบัน IG15 เพิ่มในรอบรีวิว 2026-09-15

| Gap | งาน | หลักฐานปิด gap |
|---|---|---|
| IG01 (P0) | W01/W02/W06 | append/replace/resume/retention ผ่านAPI+browserและissued-source references |
| IG02 | W03/W04 | multi-evidence schemaและcompleteness/limit/summary fixtures |
| IG03 (P0) | W01/W05/W07 | servercapture-onlyguardsและread/export/ledgerreconciliation |
| IG04 (P0) | W01/W04/W05/W07 | payer/full-source/lineage/locksผ่านresolverและDBrace |
| IG05 (P0) | W05/W06/W07 | partialcertificate/paymentprogressและretryไม่เกิดผลซ้ำ |
| IG06 | W03/W04/W06 | staleOCR/snapshot/signaturetestsร่วมgrouprevision |
| IG07 (P0) | W01/W05/W06/W07 | alias/merge/split/siblingidentityและconsumptioninvariants |
| IG08 | W02/W03 | per-attemptadmission/usage/quota-mid-batchrecovery |
| IG09 | W00/W01/W02/W03/W07 | original evidence authorization/retention ผ่านทุก surface; D08 ครอบ capture-only และ AI processor ก่อนข้อมูลจริง/G1 |
| IG10 | W02/W04/W06 | LINEtarget+wizardreturn+save/resumeถูกงาน/ร้าน |
| IG11 (P0) | W00/W04/W05/W06/W07 | decisionD03/D04และsupportedrouteจริง; unsupportedไม่finalize |
| IG12 | W03/W04/W05/W07 | zerocompany/quantity/gifts/multipleeventdates |
| IG13 | W00/W01/W08 | capability/migration/oldnewconsumer/disableintakefixtures ผ่าน launch gate + entitlement เดิม ไม่ใช่กลไกใหม่ |
| IG14 | W00/W03/W08 | authorizedThaiheldoutlabels, actualAIevalและ40+usabilityresults |
| IG15 | W00/W01 | permission key/entitlement ตาม D07 และ server rejection ของ actor ที่ไม่มีสิทธิในทุก endpoint |

## 8. Verification ที่รันเมื่อพัฒนาแต่ละส่วน

ใช้testที่มีอยู่และเพิ่มเฉพาะinvariants/edge casesของfeature ไม่เขียนtestที่แค่สะท้อนimplementation การแก้schema/contractsให้build/generateตามworkflowrepoก่อนรันconsumer ไม่แก้ package.json เพื่อเพิ่มscriptในงานนี้

คำสั่งต่อไปนี้ตรวจชื่อpackageและtest pathsจากrepoแล้ว **ยังไม่ได้รันในงานวางแผนนี้** เลือกเฉพาะsuiteที่ตรงdiff ไม่รันทั้งหมดทุกครั้ง ตัวอย่างจากrepo root:

```sh
pnpm --filter @watchdog-bms/contracts build
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts src/modules/expenses/domain/logic/expense-totals.logic.spec.ts
pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-upload.logic.spec.ts src/features/expenses/receipt-single-form.spec.ts src/features/expenses/substitute-receipt-wizard.model.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/domain/logic/business-document-classification.logic.spec.ts
```

| ประเภท | ใช้กับงาน | ต้องพิสูจน์ |
|---|---|---|
| Contract/DTO/schema | W01/W03/W05 | additive compatibility, unknownversion/errors, forgedclienttotals/statusถูกreject |
| Logic/fixtures | W03/W04 | moneyroles/scope/completeness, allocationconservation/caps/stableties, unknown≠0 |
| Local PostgreSQL | W01/W05/W06/W07 | uniqueness/transaction rollback/locking/races/actualpayer, destination/payment/JVไม่ซ้ำ |
| HTTP/API integration | W02/W05/W06/W07 | auth/ABAC/revision/idempotency และcompletejourneyข้ามmodule |
| Browser mobile+desktop / LINEpayload | W02/W04/W06/W07 | loading/error/partialsave/reload/backnavigation/permissions/Thai copy |
| Rendered certificate | W06 | originalกับส่วนบริษัทชัด, realsignatures/scope/version, PAPER/DIGITALไม่สลับสถานะ |
| AI held-out evaluation | W03/W08 | amount/currency/scope/items/state/unknownและfalse-readyแยกกัน |
| Usability40+ | W04/W08 | independentcompletion, recovery, ไม่เข้าใจsaved/issuedว่าpaid |
| Readmodel/export/regression | W07/W08 | นับต้นทุนครั้งเดียว, originalevidenceaccess, ordinaryreceipt/claimไม่ถอย |
| Migration/capability/recovery | W01/W08 | oldrecordsemantics, rejectunknownsource, disableintakeไม่ทำงานหาย |

ชุดทดสอบเดิมที่ควรต่อยอด: [funding PostgreSQL](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts), [source-draft PostgreSQL](../../apps/api/src/modules/expenses/expense-source-draft.pg.spec.ts), [receipt truth PostgreSQL](../../apps/api/src/modules/expenses/receipt-truth.pg.spec.ts), [payment mirror](../../apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts), [atomic confirmation](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts) ต้องแยกชุดที่ใช้mockจากPostgreSQLจริง; mockไม่ปิดDB concurrency gate

ก่อนรันDBsuiteต้องอ่านtest harnessและใช้ฐานlocalแยกที่พิสูจน์ได้ ไม่รับ DATABASE_URL ที่อาจชี้UAT/Productionหรือtunnelโดยปริยาย: funding suiteอ่าน DATABASE_URL และมีwrites; receipt-truthใช้ RECEIPT_TRUTH_TEST_DATABASE_URLพร้อมlocalguards เงื่อนไขข้ามtest/ไม่มีDBไม่ใช่หลักฐานconcurrencyผ่าน

หลังfocusedchecksผ่าน ให้typecheckเฉพาะpackagesที่แก้และconsumerที่ใช้contractนั้นผ่านscriptsเดิม หากต้องแก้dependenciesจึงเปลี่ยนpackage.json; ไม่เพิ่มscriptเพียงเพื่อรันไฟล์testใหม่นี้ ใช้ `pnpm --filter <package> exec tsx --test <path>` เมื่อไฟล์ถูกสร้างจริง

## 9. Gates และเงื่อนไขเปิดใช้

| Gate | เงื่อนไข | ผลที่อนุญาต |
|---|---|---|
| G0 — เริ่มfoundation/intake | D01/D06/D07พร้อม, D02ของsliceพร้อม; W01serverguards/access/capabilityและlegacycompatibilityผ่านก่อนW02เปิดรับgroup | พัฒนา/ทดสอบcaptureที่ไม่สร้างผลการเงิน |
| G1 — Capture pilot | IG15 และ D08 สำหรับข้อมูลจริงปิดแล้ว; ไม่มี binary ที่ไม่รองรับเข้าถึงข้อมูลใหม่; W01–W04เฉพาะcapture/reviewที่เปิดผ่าน; upload/resume/limits/quota/LINE/permissions/unknownsและUI recoveryมีหลักฐาน | เก็บและตรวจร่างตามขอบเขต; ห้ามอ้างfeatureค่าใช้จ่าย/เบิกครบ |
| G2 — Financial/certificate path | D03/D04ของrouteพร้อม; W05–W07ของrouteนั้นผ่าน โดยW06บังคับเฉพาะrouteที่มีใบรับรอง (route ใบเสร็จล้วนตรวจ technical integration ได้ด้วย W05+W07 ส่วน W06 ยังบังคับที่ G3); P0ทั้ง6และP1ที่เกี่ยวข้องปิด; source/payment/export/races/actualpayer/correctionมีหลักฐาน | ผ่านtechnical integrationของrouteนั้น รวมCOMPANYcertificateissue; การเปิดลูกค้ารอG3และreleaseprotocol |
| G3 — Full-feature acceptance | W08ผ่านตามD05, D08 (PDPA/retention) ปิดแล้ว, A01–A48ในsupportedscopeมีผลจริง, Thai3platformcoverageและ40+ทดสอบแล้ว, compatibility/disableintakeพร้อม | ถือว่าfeatureครบก่อนเข้าสู่งานreleaseที่มีprotocolแยก |

ไม่มีการใช้G1ตัดW06ออกจากscopeเดิม และไม่มีการใช้unsupportedstatusปิดข้อกำหนดหลักโดยไม่มีimplementation ข้อยกเว้นต้องสะท้อนในspecและreadinessตามจริง

เมื่อมีงานปล่อยระบบภายหลัง ให้อ่าน [cloud operations](../runbooks/cloud-environment-operations.md) ก่อนแตะenvironment และ [UAT/Production protocol](../runbooks/uat-production-v2-deployment.md) ก่อนdeploy/promotion/retry ต้องบันทึกrun IDsและacceptanceตามrunbook การปิดfeatureใหม่ให้ใช้capability/intake controlที่ออกแบบ ไม่ลบschemaหรือทำเอกสารที่ออกแล้วหาย

## 10. การบันทึกผลและรักษา spec/plan ให้ตรงกัน

ทุกงานย่อยที่ส่งตรวจต้องมี: W ID, spec sections, A/IGที่เกี่ยวข้อง, สิ่งที่เปลี่ยน/ไม่รองรับ, file/contract/migrationimpact, command+resultจริง และ next state เมื่อbehaviorหรือscopeเปลี่ยนให้แก้specก่อนหรือในdiffเดียวกับplan/memory

- เก็บ evidence ใหม่เมื่อเริ่มทดสอบใน `docs/evidence/marketplace-buyer-expense-capture/<work-id>/`; ยังไม่ได้สร้างหลักฐานruntimeเปล่า ๆ ในรอบวางแผน
- บันทึกfixture IDs/version/hash, expected/actual, testedcommit/runtime/schema/model/policyversionตามสิ่งที่testใช้; ไม่เก็บrawcustomerPII/credentials
- แยก not-run / skipped / failed / passed ชัด; IGปิดได้เมื่อdecision+implementation+verificationครบ ไม่ใช่เพราะมีชื่อtest
- ใช้memoryงานเดิมบอก Wปัจจุบัน/decisionค้าง/ผลcheck/ขั้นถัดไป ไม่ใช้legacyrole-gateworkflow

Verificationรอบวางแผน: ตรวจtraceability A01–A48/IG01–IG15, W00–W08dependencies, D01–D08 references, links/anchors/test pathsและคู่spec/planด้วยlocaldocumentcheck ไม่มีapplicationcode/migration/runtime tests/cloud actions

ผล local document check รอบ v0.5 (2026-09-15, Python stdlib): PASS — 9 work packages, 8 decisions (D01–D08), acceptance 48 ข้อใน spec map ครบ 48 แถวในแผน, gap 15 ข้อ (IG01–IG15) map ครบ, dependency graph ไม่มีวงจรและ W01 ก่อน W02, ลิงก์ในเอกสารคู่นี้ 100 ลิงก์ resolve ครบและ file-line target ทุกตัวชี้ไฟล์ที่มีจริงภายในจำนวนบรรทัดของไฟล์, 9 anchors ครบ

รอบรีวิว 2026-09-15 ตรวจโค้ดจริงเพิ่ม (อ่านอย่างเดียว ไม่รัน application test): `reimbursement-source.ts:32-38,43,44-48,97-98,128`, `expense-upload.use-case.ts:99`, `substitute-funding.logic.ts:6-16`, `expense-launch-gate.ts:36-57`, `permission-registry.ts:160-181`, `expense-source-draft.logic.ts:14` และรายชื่อไฟล์ใน `apps/web/src/features/expenses/` คำสั่ง application tests ยังไม่ได้รันในรอบนี้

### ตรวจทานรีวิว v0.5 และแก้ก่อน merge — 2026-09-16

เทียบกับ source บน develop `51d79fdb` และ main `3baa10c2` ซึ่ง application code ที่เกี่ยวข้องตรงกัน เป็นการแก้เอกสาร ไม่มีการปิด implementation gaps จาก static review

| จุดที่พบ | การแก้ใน v0.6 | หลักฐาน/ข้อกำหนดที่ตรวจรับต่อ |
|---|---|---|
| W05 บังคับ reimbursement resolver กับทุก funding route และก่อน W06 | แยก company-funded กับ employee-funded; source รอใบรับรองสร้างได้แต่ยังไม่ claim-ready | spec §4, W05/W06/W07, A04/A17/A20 |
| D06 เสนอให้บังคับใบรับรองเมื่อ uploader ไม่ใช่ payer | creator ใช้ได้เฉพาะผู้จ่ายจริงที่ยืนยันแล้ว; payer binding ต้องตรวจที่ server; ใบรับรองต้องเข้า eligibility ด้วย | spec §11/12, D06, A19/A32 |
| FULL mode ถูกเรียกรวมว่า VAT และ D03 ชวนบังคับ tax status ให้ผ่าน | ใช้ FULL/SIMPLE ตาม capture policy; review ตาม facts พร้อมทางพัก ไม่เปลี่ยนภาษีเพื่อผ่าน guard | spec §4/9, D03, A04/A08 |
| การบล็อกใบรับรองเมื่อจ่ายบางส่วนถูกเขียนว่าให้แก้ประวัติ | ระบุให้รักษาข้อเท็จจริง ใช้ correction/reversal เมื่อข้อมูลผิดตามสิทธิ ไม่ rewrite/เติมจ่ายเพื่อออกใบ | spec §12.4, W06, A20 |
| helper launch gate ถูกสมมติว่ารับ route ใหม่ได้ | ระบุ expenses/DEFAULT ที่ hard-code และ integration ของ route/registry/runoff/deployment admission เดิม | D07, W01, A47 |
| additive schema + reject unknown ไม่กัน binary เก่าที่ไม่อ่าน discriminator | ส่ง guards ครบทุก consumer ก่อน intake; ถ้ากัน binary เก่าไม่ได้ให้คงปิด ห้าม rollback ไป binary ที่ไม่รองรับหลังมีข้อมูล | spec §14.3, W01/W08, A38/A47 |
| D08 รอ G3 แต่ pilot รับ/ส่งข้อมูลบุคคลได้ก่อน | D08 ส่วนที่เกี่ยวข้องต้องครบก่อนใช้ข้อมูลจริง/AI ใน W02/W03/G1; fixtures จำลองยังเดินได้ | D08, IG09, A41/A46 |
| สาม attachment guards ถูกอธิบายว่าเกิดพร้อมกันทุก request | แยกเงื่อนไข active evidence, attachmentId ambiguity และ attachment-only source review; explicit linked source ยังต้องตรวจ lineage/consumption | spec §4, W05/W07, A09/A16 |
| dependency/permission wording และชื่อเอกสารยังไม่ตรงกัน | W01 ระบุ D07/D02 ครบ; ยังไม่สรุปว่าต้องเพิ่ม permission keys ใหม่; แยก derived source จาก LINE ExpenseSourceDraft | spec §4/8, W00/W01/W04, IG15 |

ผลตรวจเอกสาร v0.6 (Python stdlib): PASS — 48 acceptance, 15 gaps, 9 work packages, 8 decisions, dependency graph ไม่มีวงจร, 138 local links (spec/plan 115), 45 file-line targets, 10 anchors, corpus 45+9 เคส/15 ต่อแพลตฟอร์ม, 5 planned commands และ 8 existing test paths; เป็นการตรวจเอกสาร ไม่ได้รันคำสั่ง application tests

การ merge spec/plan ไม่ใช่การตัดสิน D01–D08 แทนเจ้าของ policy, การเปิด launch route หรือการ deploy ฟีเจอร์

Next: เริ่ม W00 ของ slice แรก: D01/D06/D07 และ D02 ส่วน foundation ก่อน W01 → W02; D03 ก่อน allocation/financial action ที่พึ่ง policy, D04 ก่อน W06, D08 ก่อนข้อมูลบุคคลจริง/AI pilot; D05/W08 และเงื่อนไขที่เหลือยังเปิดอยู่ ไม่ถือว่า merge เอกสารเท่ากับอนุมัติ policy หรือเปิด feature
