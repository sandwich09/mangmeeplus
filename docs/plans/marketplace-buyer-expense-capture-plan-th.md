# Implementation Plan: หลักฐานซื้อ marketplace/ค้าปลีก/ค่าขนส่งผ่าน LINE อัปโหลด และเปลี่ยนใบเสร็จ

Status: Planned v0.11, 2026-09-17. Paired with spec v0.11: W00–W08, D01–D09, A01–A88, IG01–IG29, E01–E27. On failed reading, notify that the file is saved and link directly to the same Web review/manual work item. No reread CTA or manual-entry dialogue as error recovery. Application/runtime/UX verification remains NOT_RUN.
Spec: [ข้อกำหนดผลิตภัณฑ์และการเชื่อมระบบ](../specs/marketplace-buyer-expense-capture-spec-th.md)
Research: [วิเคราะห์หกมุม](../research/marketplace-buyer-receipt-brainstorm-2026-09-14-th.md)
Corpus: [45 public purchase/order cases + 9 supplemental cases](../research/marketplace-buyer-public-corpus-2026-09-14-th.md)
Memory: [สถานะ marketplace เดิม](../agent-memory/marketplace-buyer-receipt-brainstorm.md) · [retail/electronic integration](../agent-memory/thai-retail-buyer-receipt-survey.md)
Retail: [11 public documents + electronic guidance](../research/thai-retail-buyer-receipt-survey-2026-09-17-th.md); normative requirements in spec §16, not a separate optional backlog
Courier: [7-provider survey checked 2026-09-18](../research/thai-courier-receipt-survey-2026-09-18-th.md); spec §18 / plan §12 add CC01–CC10 within v0.11; owner-approved non-receipt replies NR01–NR09 in spec §18.4 / plan §12.1 remain implementation work, with latest-specimen and runtime-validation gaps retained

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
- [x] ตรวจโค้ดแบบเจาะจุด: spec §14 มี E01–E24 และ IG01–IG29; ยังไม่ใช่ inventory ทุก caller หรือ runtime reproduction
- [x] จัด W00–W08 และ traceability ครบ A01–A88 / IG01–IG29 ในแผนนี้
- [x] รีวิวเอกสาร 2026-09-15 เทียบ resolver/permission registry จริง: เพิ่มข้อบังคับ payer/totals identity/tax classification, D07 permission, IG15 และแก้ seam ของ W04
- [x] รวมผลสำรวจค้าปลีก/electronicเป็นข้อกำหนด§16 พร้อมA49–A74 และIG16–IG25; ครบLINE AI/อัปโหลดใหม่/เปลี่ยนใบเสร็จ และคงW06
- [ ] ตัดสิน persistence/API/policy เฉพาะส่วนที่ใช้จริงและจัด Thai golden bundles ที่ได้รับสิทธิ์
- [ ] ลงมือแก้แอป/migration, ทดสอบ API/DB/browser, วัด AI และ usability40+
- [ ] ตรวจรับ feature เต็มและผ่านกระบวนการปล่อยระบบเมื่อมีงาน release

## 3. ลำดับงานและ dependencies

| งาน | ส่งมอบอะไร | ต้องมีมาก่อน | Spec |
|---|---|---|---|
| W00 | ปิด design decisions ของ slice, caller inventory, fixtures และ contract | baseline/corpus/impact review ที่มีแล้ว | §2/5/11/13/14 |
| W01 | data contract, capture-only guards, lineage/access/version foundation | W00: D01/D06/D07 และขอบเขต intake D02 | §4/5/8/14 |
| W02 | multi-file upload/append/replace/resume ผ่าน Web/LINE เดิม | W01 และ D02 ฝั่ง upload | §3/7/8/14/16 |
| W03 | อ่านหลายหลักฐานพร้อม scope, completeness, reconciliation และ quota | W02 และ D02 ฝั่ง AI | §6/7/13/16 |
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
| D02 | manifest/append/replace/resume contracts, MIME/file/page/item limits, extraction attempt identity, batch budget, unknown/partial errorsและreason/persist-state/allowed-action mappingตาม§17และpre-capture diagnostic context/lookupตาม§17.5; reuse quota policy เดิม; target10MiBและautomaticPDFpipelineตัดสินแล้วตาม§16.7 ส่วนrunner seam/worker leases/จำนวนหน้าที่รองรับและrender pixel/page/token/HTTP budgetsและquota-subcall mappingต้องปิดก่อนimplementation | ผู้พัฒนา Web/API/AI ตาม boundary | W02/W03 เฉพาะส่วนที่พึ่งข้อนั้น |
| D03 | shared discount/shipping eligible base, coins/wallet treatment, actual payer authorization, business allocation และ company-funded personal amount ที่ปลายทางแทนได้ **รวม tax review ตาม facts/สิทธิและทางพักเมื่อไม่รองรับ ไม่บังคับ NON_CLAIMABLE หรือ VAT=0; การแตกบรรทัดต้องผ่าน `expenseTotalsIdentityError` ของ vatMode ปลายทาง** | Product/ผู้รับผิดชอบบริษัทและบัญชี สำหรับ policy; API สำหรับ enforcement | W04 ที่คำนวณตาม policy, W05/W07 ของ route นั้น |
| D04 | map eligibility/วันที่/ผู้รับเงิน/ผู้รับรองกับกฎใบรับรองเดิม; wordingยอดoriginalกับส่วนบริษัท; correction/partial completion; ไม่สร้าง policy ใบรับรองใหม่โดยปริยาย | Product/บัญชีและผู้พัฒนา expense/certificate | W06 |
| D05 | authorized Thai positive/negative bundles, human expected labels, supported layout/limits, เกณฑ์ pilot ด้านเวลาแก้/ความเข้าใจ/false-ready | ผู้ตรวจข้อมูลบัญชี, QA/UX และผู้รับผิดชอบ AI | W08 และการอ้างความพร้อม/accuracy |
| D06 | backend-to-frontend source/payer/error contracts, canonical evidence access, full-source claim mapping, consumed-source aliases และ consumer inventory **รวมข้อชี้ขาด: derived source จะแทน actual payer อย่างไรในเมื่อ [resolver](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:32) ใช้ `createdByUserId` เมื่อไม่มีใบรับรอง — creator เดิมใช้ได้เมื่อเป็นผู้จ่ายจริงที่ยืนยันแล้ว หรือเพิ่ม server-verified payer binding; ห้ามปลอม creator และห้ามบังคับใบรับรองนอก eligibility §12 เพื่อแก้ payer** | ผู้พัฒนา expense/reimbursement/contracts | W01 foundation และ W05/W07 |
| D07 | permission key/entitlement ของ capture group, business allocation และ derived source generation: reuse key เดิมหรือเพิ่มใหม่ใน [permission registry](../../apps/api/src/modules/auth/permission-registry.ts:160), map เข้า role/ownership ใด และใช้ launch route/entitlement ใด รวม registry/seed/runoff/deployment admission; helper เดิมผูก expenses/DEFAULT ไม่รับ route ใหม่โดยอัตโนมัติ | ผู้พัฒนา auth/expense และผู้ดูแลสิทธิ | W01 และทุก UI/endpoint ของ feature |
| D08 | PDPA: ฐานการประมวลผล/ROPA/retention ของกลุ่มหลักฐานที่ไม่กลายเป็นเอกสารการเงิน และการส่งภาพที่มีข้อมูลส่วนบุคคลเข้า AI provider ตาม processor register เดิม | ผู้รับผิดชอบ PDPA/Product | ก่อน W02/W03 หรือ G1 ใช้ข้อมูลบุคคลจริง/ส่ง AI; fixtures จำลองไม่มีข้อมูลบุคคลเดินต่อได้ และ G3 ตรวจ coverage ครบ |
| D09 | electronic verification method/status/reason/version และขอบเขตตัวตรวจ; baselineเก็บoriginalและแสดงnot-checked/unavailableได้ ห้ามอ้างผ่านจากOCR; automated signature/timestamp checks ต้องมีtrust/fixture/retention/processor evidence | ผู้พัฒนาAPI/AI กับผู้รับผิดชอบเอกสารบัญชี/ข้อมูล | ไม่ขวางcaptureที่ไม่รับรองผลตรวจ; บล็อกverified badge/automationที่ยังไม่พิสูจน์ และW08ก่อนอ้างverificationพร้อม |

ทุก decision ยังเปิดจนกว่าจะมีเนื้อหาและผู้ตัดสินจริงใน spec/บันทึกงาน ไม่ให้ตัวเลือกเทคนิคธรรมดากลายเป็น approval ใหม่ที่ไม่จำเป็น; เรื่อง policy ที่เปลี่ยนยอด/สิทธิห้ามเดา หากเปลี่ยนขอบเขต ให้บันทึกใน spec ก่อนพัฒนาส่วนนั้น

## 5. Work packages ที่ตรวจรับได้

<a id="w00"></a>
### W00 — ปิดแบบของ slice และเตรียมหลักฐานทดสอบ

Owner: ผู้พัฒนา feature; Product/บัญชีเฉพาะ policy; QA/UX/AI เฉพาะ fixture และเกณฑ์ตรวจรับ
Status: In progress 2026-09-18 — decisions v1 (D01/D02/D06/D07/D09 ปิดระดับโค้ด; D03/D04/D08 เป็นค่าเริ่มต้นรอเจ้าของยืนยัน) อยู่ใน [contract appendix](../specs/marketplace-buyer-expense-capture-contract-appendix-th.md); fixture manifest สังเคราะห์ในภาคผนวก §13; authorized Thai bundles/UX 40+ ยังเปิด (D05)

- [ ] อ่าน spec/plan/memory ล่าสุดและเทียบ working tree ที่จะลงมือ ไม่อ้างเลขบรรทัด E01–E24 ว่ายังคงเดิมเสมอ
- [ ] ระบุ slice-1 contract: A ข้อไหนอยู่ใน slice แรก (ข้อเสนอ: employee-funded, ไม่เกินสองร้าน, ยังไม่มีใบรับรอง) และข้อไหนเลื่อน เพื่อไม่ให้ W00 กลายเป็นงานเอกสารยาวก่อนมีโค้ด
- [ ] ปิด D01/D06/D07 และส่วน D02 ที่ต้องใช้ก่อนสร้าง schema/upload; บันทึก action/request/response/error/revision และ permission matrix ลง spec §5/13 หรือ contract appendix ที่ลิงก์จาก spec
- [ ] inventory Web/LINE/API/background paths: init/complete/extract/update/remove/confirm/pay/post/claim/certificate/cancel/reversal และ list/count/export/evidence download; ต้องรวม [reimbursement-source.ts](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts:97) ที่ query `sourceReimbursementRequestId: null` ในฐานะ read consumer ของ discriminator
- [ ] จัด fixtures จากข้อมูลที่ได้รับสิทธิ์; ใช้ simulated unit cases ที่ระบุว่าเป็นข้อมูลจำลองได้ระหว่างพัฒนา แต่ไม่นับแทน45referenceหรือThai golden bundles
- [ ] ให้คนระบุ expected scope/items/quantity/amount/currency/payment/refund/unknowns/business use/payer/document eligibility; แยก purchase ที่ซ้ำข้าม tuning/held-out
- [ ] ใช้ decision register แยกเรื่องที่ค้างเฉพาะ route ออกจากงาน capture ที่เดินได้
- [ ] D08 บันทึก policy/processor/retention ที่ reuse และช่องว่างก่อนใช้ข้อมูลบุคคลจริงใน W02/W03/G1; ใช้ fixtures จำลองที่ไม่มีข้อมูลบุคคลได้ระหว่างที่ยังเปิดอยู่

Deliverables: decisions ของ slice, endpoint/consumer inventory, fixture manifest และ expected outputs ที่ตรวจย้อนกลับได้
- [ ] ใช้inventory spec§16.6ปิดcallersครบสามทาง รวมหน้าเปลี่ยนใบเสร็จและLINE final-receipt/substitute continuation; ระบุsource-reported/provider/default valuesให้ชัด
- [ ] D02/D06ต้องมีreplacementexpected attachment/revision, state/error matrix, upload/extraction/PDFcapability budgets; D09กำหนดbaseline not-checkedก่อนแสดงสถานะelectronic
- [ ] D05เพิ่มretail5แบรนด์+electronic bundlesและRC→A49–A67; ห้ามนับguidesเป็นreceiptsหรือredactทับsignedverificationfixture

- [ ] สำหรับPDF10MB: ปิดD02execution/attempt+budget contractตาม§16.7; reusepdf-lib/pdfjs-dist/sharpจากAPIและinfraที่มีโดยไม่reuseLINEread-onlydrainผิดงาน; ก่อนเพิ่มdependency/serviceต้องระบุเหตุที่ของเดิมใช้ไม่ได้
- [ ] จัดauthorized/synthetic 10,000,000และ10,485,760bytefixtures ทั้งหลายหน้าและหน้าเดียวlargeimage, native/scanned/mixed, tinyThai text, signedoriginalภายใต้สิทธิ, หลายใบ/จำนวนหน้ามาก; file paddingอย่างเดียวไม่ใช้แทนlarge-rasterqualityfixture

Exit: W01 เริ่มได้เมื่อ D01/D06/D07 ชัด; W02/W03 เริ่มเมื่อ D02 ส่วนที่ใช้ชัด; ไม่ต้องรอเปิดทุก unsupported route
Verification: ตรวจ contract กับ code owner/consumer และทำ traceability check; ยังไม่ใช้ผลนี้เป็น application test

<a id="w01"></a>
### W01 — Foundation และ guard ก่อนรับข้อมูลกลุ่ม

Owner: API/contracts/database
Status: Done (2026-09-18) — schema/contracts/config/API/guards/pg; runner + web + LINE อยู่ใน W02/W03
Depends on: W00 / D01 / D06 / D07 และขอบเขต intake D02

จุดแก้หลัก: [Prisma schema](../../apps/api/prisma/schema.prisma), [expense contracts](../../packages/contracts/src/expenses.ts), [funding guard](../../apps/api/src/modules/expenses/infrastructure/substitute-funding.guard.ts), [expense repository](../../apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts), [reimbursement source](../../apps/api/src/modules/reimbursements/infrastructure/reimbursement-source.ts)

- [x] เพิ่ม bounded/versioned contracts และ relational identities ตาม D01 โดย reuse Expense module; ไม่สร้าง marketplace service แยก — W01: `packages/contracts/src/expense-capture.ts` (`EXPENSE_CAPTURE_CONTRACT_VERSION = 1`) + 6 ตาราง/12 enum ใน migration `20260918120000_expense_capture_foundation`
- [x] เพิ่ม source-role/capability guards ในทุก financial entry point จาก inventory รวม raw API/background callers; where-clause ของ ambiguous-source ฝั่ง reimbursements ต้องเห็น discriminator ด้วย ไม่ใช่เฉพาะโมดูล expenses — W01: resolver ambiguity + payer, picker, evidence service, duplicate scoring (unit + pg spec); export/`evidenceRef` ยังเป็นงาน W05/W07 ตาม §12
- [x] เพิ่ม/ผูก permission key ตาม D07 และบังคับที่ server ทุก endpoint ของ feature; UI ซ่อนปุ่มไม่ใช่ guard — W01: ใช้ key เดิมทั้งหมด (ไม่เพิ่ม key ใหม่), `allowedActions`/`blockers` ตัดสินที่ server
- [x] วาง canonical ownership/retention/access และ lock traversal ที่ group/child/attachment aliases เข้าขอบเขตเดียวกัน — W01: `<company>:expense-capture:<group>` อยู่หลัง `reimbursement-evidence:*` และก่อน `ai-budget:*` พิสูจน์ใน pg spec 20 รอบ; `EXPENSE_CAPTURE_RETENTION_DAYS` + purge ของ `LineIntakeAttempt`
- [x] reuse [launch gate เดิม](../../apps/api/src/modules/expenses/application/expense-launch-gate.ts:36) ตาม D07 โดยรู้ว่า `assertExpenseRootOpen` ผูก expenses/DEFAULT ตายตัว; route แยกต้องเชื่อม registry/seed/guard/runoff/deployment admission เดิมครบ ไม่เปิด route จริงในงานเอกสาร — W01: create/add-file/convert เรียก `assertExpenseRootOpen` ตัวเดิม ไม่มี route ใหม่ใน registry
- [x] deploy compatibility guards ให้ทุก consumer ก่อนเริ่มสร้าง group; พิสูจน์ว่าไม่มี server/worker ที่ไม่รู้ source role เข้าถึงข้อมูลใหม่ ถ้าคุมไม่ได้คง intake ปิด; additive schema หรือปิด intake อย่างเดียวไม่อนุญาต rollback ไป binary เก่าหลังมีข้อมูล (spec §14.3) — W01: D01 ทาง B ทำให้ binary เก่าไม่เห็นตารางใหม่และเห็น derived source เป็นค่าใช้จ่ายปกติ; `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` wired ครบ (deploy.sh/kamal/pins) และ maintenance_only บังคับ false
- [x] ทำ additive migration ตามแบบที่ตัดสินแล้ว; legacy records คง semantics เดิม ไม่เดาว่าเป็นcapture-onlyจากชื่อร้านหรือ OCR — W01: additive ล้วน ไม่มี backfill; คอลัมน์ lineage เป็น null ทุกแถวเดิม (pg spec ยืนยัน unique index ไม่แตะแถว null)
- [x] ให้ list/read แสดงงาน capture ได้โดยไม่สื่อว่าเป็นยอดบริษัทที่รับรู้แล้ว; versions ที่ไม่เข้าใจ source role ปฏิเสธ final mutation — W01: `GET capture-groups` เป็นรายการแยก ไม่มียอดเงิน; `facts` ว่างจนกว่าจะมี observation จริง

- [x] (ครึ่ง schema) ขยายsource/document/representation lineageและสถานะextractionแยกelectronicverificationตามD09 โดยreuseattachment/hash/objectversionเดิม; query/lock keysต้องครอบcross-channelduplicates — W01 วางคอลัมน์ `electronicVerificationJson`/`attachmentChecksum`/`objectVersionId`/`preprocessVersion` และ duplicate keys แล้ว; สถานะ extraction จริงมากับ W03
- [x] ออกcontractของreplaceพร้อมexpected old attachment/version + expected expense/group revision + operation identityและtyped conflicts; completeต้องinvalidateผลตรวจที่ผูกsourceเก่าแบบatomicโดยไม่ลบค่าที่คนยืนยัน — W02-web: `CompleteExpenseReceiptUploadInput` + 4 conflict codes; ค่าที่คนตรวจแล้วคงอยู่พร้อม `sourceAttachmentId`/`sourceStale` และ `aiVerificationStatus = NOT_VERIFIED`
- [x] servermutationmatrix§16.4ครอบclaimDRAFT/submitted, PREPARED/PAYER_CERTIFIED/ISSUED, paid/posted/voidedและpermissionchange; ไม่ใช้UIเป็นguard — W02-web: ตรวจก่อนยืนยัน bytes ทุกครั้ง, reuse `substitute_evidence_locks_expense`/`substitute_source_has_live_claim`, PREPARED ยังรับ supporting ได้ (11 เคสใน `expense-upload.use-case.spec.ts`)

- [ ] durablejob/manifestผูกcompany/actor/attachmenthash+objectversion/preprocessversion/attempt; perpage/regioncheckpoint, boundedlease/cancel/stale/paused states และserverstatusทำต่อหลังUIปิดได้ — W01 วางตาราง `ExpenseCaptureReadJob` + manifest ว่าง + cancel ตอน detach ไว้แล้ว; runner/lease/checkpoint เป็นงาน W03 จึงยังไม่ติ๊ก
- [ ] existinguploadconfig/transport/security/retentionต้องรับ10MiBตามcapabilityที่เปิด; originalbytesไม่ผ่านAIเป็นก้อนใหญ่ก่อนpreprocess; internalAIcallsผ่านpermission-checkedAPI ไม่มีGatewayDBaccess

Exit: สร้าง capture-only fixture ได้และพิสูจน์ว่า confirm/pay/claim/certificate-finalization ที่ยังไม่ eligible ถูกปฏิเสธโดย server; ordinary receipt ยังผ่าน path เดิม
Checks: contract/DTO checks, local PostgreSQL constraints/transactions, cross-company/branch/actor/alias และ old/new capability tests
Acceptance หลัก: A09/A10/A15/A16/A35/A36/A38/A39/A44/A46/A47
IG: IG01/IG03/IG04/IG07/IG09/IG13/IG15

<a id="w02"></a>
### W02 — อัปโหลดหลายไฟล์และกลับมาทำต่อ

Owner: Web/API/LINE intake
Status: W02-web done (2026-09-19) — multi-file intake, group page shell, replace/append contract, read-status recovery; W02-LINE ยังไม่ส่ง
Depends on: W01 / D02 upload contract

จุดแก้หลัก: [ExpenseReviewPage: เปลี่ยนใบเสร็จ](../../apps/web/src/features/expenses/ExpenseReviewPage.tsx:428), [replacement policy](../../apps/web/src/features/expenses/expenses.model.ts:1705), [LINE webhook](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts:5815), [ExpensesPages](../../apps/web/src/features/expenses/ExpensesPages.tsx), [upload UI logic](../../apps/web/src/features/expenses/expense-upload.logic.ts), [expense client](../../apps/web/src/features/expenses/expenses.api.ts), [upload use cases](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts), [remove receipt](../../apps/api/src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.ts), [LINE continuation](../../apps/api/src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.ts)

- [x] ทางเข้าปัจจุบันรับหลายไฟล์/หลายหน้าเป็น recoverable work item; ไม่วน init แล้วสร้าง unrelated expense ต่อไฟล์ — W02-web: `UploadPanel` ส่ง ≥ 2 ไฟล์เข้า `POST capture-groups` ครั้งเดียวแล้ววนเฉพาะ `files`/`complete`; ไฟล์เดียวยังเป็น expense เดิมทุก request (guard ใน `ExpensesPages.qa.spec.ts`)
- [x] per-file identity/manifest/status และ resumable intent; complete/retryใช้identityเดิมเมื่อผลตอบกลับหาย — W02-web: state machine ใน `expense-capture-upload.logic.ts` (PENDING→UPLOADING→STORED/FAILED/UNKNOWN), retry ใช้ `fileId` เดิม, ผลหาย = UNKNOWN + ตรวจสอบสถานะ (12 เคสใน `expense-capture-upload.logic.spec.ts`)
- [x] “เพิ่มหลักฐาน” append; “เปลี่ยนไฟล์นี้” replace เฉพาะเป้าหมาย; detach/cleanupไม่ลบไฟล์ที่ source/signature ยังอ้าง — W02-web: `intent` บน `…/receipt-uploads/{a}/complete` + matrix §16.4 ที่ server; append ไม่แตะ primary และไม่ retire (spec ใน `expense-upload.use-case.spec.ts`); detach guard เป็นของ W01
- [x] กลับจากปิดหน้าแสดงส่วนที่ server เก็บแล้ว ขอเลือกใหม่เฉพาะไฟล์ที่ bytes ยังไม่ถึง ไม่สัญญาว่าเก็บไฟล์บนbrowserได้ทุกกรณี — W02-web: manifest ใน sessionStorage + `mergeCaptureManifest` ให้สถานะจาก server ชนะเสมอ และไฟล์ที่ bytes ไม่ถึง = “เลือกไฟล์นี้ใหม่”
- [ ] LINEผูกgroup/source/actor/branchจากบริบทที่ยืนยันได้; หลายงานหรือภาพที่มาช้าให้เลือกงานเมื่อกำกวม
- [x] (เว็บ) single-file/camera/drop/review เดิมยังทำงาน; failed-reading notice+ลิงก์Webงานเดิมตาม§17.6 แยกsaved/unknown; ไม่มีerror reread; A83–A85 — W02-web: กล้องยังไฟล์เดียว, ข้อความ `expenses.extract_failed`/`:704`/`:724` ไม่ชวนอ่านซ้ำแล้ว และปุ่มอ่านซ้ำถูกซ่อนทุก terminal failure; ฝั่งแชต LINE อยู่ที่ W02-LINE
- [x] ต่อหน้าเปลี่ยนใบเสร็จด้วย expected target/revision, append-vs-replace intent และ state matrix §16.4; re-readใช้ไฟล์ที่commitจริง — W02-web: `expectedUpdatedAt` + `expectedPrimaryAttachmentId` + `operationId` (idempotent/conflict) และ READY → NEEDS_REVIEW แบบ atomic
- [ ] PDF limits/capability/error messagesตรงกันทั้งสามทาง; รับไฟล์สำเร็จแยกจากอ่านสำเร็จ และไม่re-encodesigned PDFเพื่อผ่านgate
- [ ] LINEcaptionlessPDF/หลายเอกสาร/latefileต้องมีdurable pending work/clarificationที่กลับงานเดิม ไม่resetหลักฐาน; เก็บsafe rejection reasonก่อนมีexpenseและตอบคำถามย้อนหลังตาม§17.5; แก้E15/IG20ที่file/PDFไม่มีcontentBase64จนOCRถูกข้าม โดยต่อoriginalเข้าboundedpipeline ไม่ส่ง10MBตรงให้provider

- [ ] ทั้งสามทางรับPDF10MiBแล้วsave→queue/readพร้อมstatus/progressที่serverยืนยัน; ปรับข้อความ4MBmanual-onlyออกสำหรับขนาดที่รองรับ; ไม่บังคับผู้ใช้split/compressเอง
- [ ] status/reopen/retryเมื่อHTTPผลหายใช้jobเดิม; replacementหยุดapplyงานเก่าตามrevisionและpreserveoriginal; ไม่มีfinalLINEส่งจนrecipient/permission/versionตรงและdeliveryสำเร็จจริง — W02-web ทำฝั่ง status/reopen/retry (`GET …/read-status` + polling 3 วิ) และ provenance `sourceStale` ของไฟล์เก่าแล้ว; การหยุด apply ของ job เก่าเป็นงาน W03, LINE delivery เป็นงาน W02-LINE

Exit: ส่ง4ไฟล์ สำเร็จ2แล้วตัดเน็ต กลับมาทำต่อโดยไม่สูญงาน/สร้างdraftซ้ำ และเพิ่มหน้า2ไม่ retire หน้า1
Checks: upload/retention/API permission tests, local browser บนmobile+desktop และ LINE payload/retry tests โดยไม่ส่งข้อความจริงถึงลูกค้า
Acceptance หลัก: A01/A02/A14/A15/A35/A36/A43/A45/A46
IG: IG01/IG09/IG10

<a id="w03"></a>
### W03 — อ่านหลักฐานแบบมี scope และไม่ฝืนเติมค่าที่ขาด

Owner: AI Gateway + API extraction
Status: Planned
Depends on: W02 / D02 extraction contract

จุดแก้หลัก: [Gateway reader/prompt/parser](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts:157), [LINE OCR client](../../apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:120), [OCR contract](../../packages/contracts/src/line-ai.ts), [extract use case](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts), [OCR client](../../apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts), [OCR apply](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts), [document classification](../../apps/ai-gateway/src/modules/line-ai/domain/logic/business-document-classification.logic.ts)

- [ ] group extractionเก็บpage/regionหรือexact span, document/order/store/item/component identities และ completeness; ไฟล์เดียวอาจหลายorder/หลายpanel
- [ ] อ่าน monetary roles แยก charge/discount/tax/tender/reward/refund/summary และความสัมพันธ์included/parent-child; ไม่รวมสิ่งที่ซ้ำ — เริ่มตาม spec §13.3 คือ schema กลางที่เก็บ label/scope/ที่มา แล้วเพิ่ม mapping เฉพาะที่มีตัวอย่างรองรับ ไม่ต้องได้ taxonomy เต็มก่อน G1
- [ ] ตรวจ source-reported amounts/สมการด้วยDecimal; แยก observed/inferred/policy-derived; ไม่สร้างrounding/discountเพื่อปิดยอด
- [ ] รองรับเกินlimit/แถวเสียด้วยincomplete stateที่รักษาต้นฉบับ; summary fallbackไม่อ้างว่าพร้อมแบ่งสินค้า
- [ ] แยก method/paid/refund timeline/destination/currency และวันที่แต่ละเหตุการณ์; unknownไม่เป็น0/THB/paid
- [ ] reuseผลที่ตรงrevision, per-attempt budget/admission และ retryตามgovernanceเดิม; quotaหมดกลางชุดยังเก็บ/แก้ต่อได้
- [ ] ป้องกันprompt injectionจากเอกสารและlate resultทับreview; Gatewayเรียกpermission-checked APIsเท่านั้น
- [ ] sharedreceipt rules/contract/parser/applyครอบretail events/pack/tax/settlementตาม§16.2ทั้งสามทาง; ไม่แยกpromptตามหน้า
- [ ] เพิ่มgroup outputก่อนแก้MULTI_DOCUMENT routing; legacy single-expenseไม่รับfieldsรวมหลายธุรกรรม
- [ ] electronic original/derivative, pagecoverage และmethod-specific verificationตามD09; preserve vision-reader policy/sharedbank-statement behaviorตามD02
- [ ] replacement OCR observationsต้องผูกattachment/version และแสดงdiff/unknown; ไม่เติมข้อมูลใบใหม่ด้วยfactsใบเก่าโดยไม่แสดงที่มา

- [ ] เพิ่มreceiptPDFpreprocessingก่อนsharedreader: copiesหน้าเป็นboundedPDFตามขนาดจริง; ถ้าหน้าเดียวเกินให้render/rasterเป็นboundedregionsพร้อมoverviewและพิกัด/overlap ไม่ลดtinytextจนอ่านผิด
- [ ] ทุกcallตรวจprovider limits+serializedHTTP/base64+pixels/tokens; schedulerจำกัดconcurrency/time/memory, checkpointต่อchunk; text-nativeเป็นoptimizationภายใต้D02 ไม่สลับreaderpolicyโดยปริยาย
- [ ] page/regionobservationsรวมตามdocumentgraphก่อนnormalize/allocate; headers/footers/totals/overlapไม่บวกซ้ำและsame-nameitemsไม่ถูกdedupเอง; ไม่บีบtranscriptionทุกหน้าลง4096tokensแล้วอ้างครบ
- [ ] หลายหน้าตาม§16.8: manifestครบทุกหน้า, page/read-stateและdocument-completenessแยกกัน, carry-forward/blank/missing-page/multiple-invoice grouping; A81/A82
- [ ] partialretry/budgetexhausted/stale/cancelและข้อความ/recoveryมีกฎตาม§16.7/17; logicalcustomerjobแยกprovidercallsและusageledger ไม่ใช้จำนวนchunkคิดcustomerreceiptใหม่เงียบ ๆ; A75–A80

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

สถานะ 2026-09-18: **W04a (API) ส่งแล้ว** — engine + `facts`/`review`/`accept` (รายละเอียดและ deviation ใน appendix ข้อ 17) ช่องที่ยังว่างคือหน้ากลุ่ม/LINE summary = **W04b**

- [ ] สรุปยอด/ร้าน/สินค้า/ผู้จ่ายในหน้าตรวจเดิม เปิดdetailเพิ่มได้ และแสดงblockerที่กระทบactionก่อนกด *(W04b; server ส่ง `facts`/`allocation`/`blockers`/`allowedActions` ให้แล้ว)*
- [x] รับ business/personal selectionระดับจำนวนโดยไม่เลือก“บริษัททั้งหมด”ให้เอง; purposeทั่วไปยังoptional — `businessUse UNKNOWN` = blocker ไม่ใช่ค่าเริ่มต้น; `selection` เป็นจำนวนต่อแถว, แถวที่ไม่มี quantity แบ่งไม่ได้
- [x] ผูก actual payerตามสิทธิ ไม่ใช้uploader/ชื่อผู้รับสินค้าแทนผู้รับเงินคืน — payer ต้องเป็นสมาชิก ACTIVE ในสาขา, payer ≠ ตัวเองต้อง `expense.review`
- [x] source breakdownก่อนunique inferenceก่อนpolicy allocation; largest remainderถึงสตางค์พร้อมstable ties/eligible caps/provenance — `shareByBasis` + provenance ต่อบรรทัด (componentId/share/remainderAdjust/shippingShare)
- [x] ผลการแบ่งต้องแตกเป็นบรรทัดที่ผ่าน `expenseTotalsIdentityError` ตาม vatMode ปลายทาง; tax classification มาจาก facts/review ตาม D03 เมื่อ employee route ยังไม่รองรับให้เก็บรอ ไม่บังคับ classification ให้ resolver รับ — identity null by construction (property test 200 ชุด); `tax_review_pending` เป็น scope-level ไม่บล็อก accept
- [x] serverสร้างreviewed allocation snapshot ผูกrevision/policy/payer/selection; การเปลี่ยนfactsทำให้previewที่เกี่ยวข้องหมดอายุ — `ExpenseCaptureAllocation` PREVIEW/ACCEPTED/SUPERSEDED/INVALIDATED + CAS `expectedRevision`
- [x] unknown/unsupportedคงทางพัก; business amount0ที่ยืนยันแล้วจบเป็นหลักฐานไม่มีเงินส่งต่อ — `NO_COMPANY_PORTION` ที่ accept แล้วปิดกลุ่มเป็น `CLOSED_NO_HANDOFF`; unknown ไม่ถูกนับเป็น 0
- [x] เลือก expenseDateจากfactsที่reviewตามปลายทาง ไม่ใช้upload dateทับpayment/invoice/order date — `expenseDateChoice` per scope, ไม่มีวันที่ = blocker (ไม่ใช้วันนี้)

- [ ] หน้าตรวจ/LINE summaryใช้document total, settlement, expense allocationและclaim amountแยก; coins/CPN/points/void/taxlegendไม่รู้ต้องมีเหตุผลและmanual review
- [ ] เปลี่ยนใบเสร็จแสดงdiff/provenanceของfactsใหม่กับค่าที่คนตรวจ; ไม่mixidentity/rows/paymentจากคนละซื้อ; READYกลับNEEDS_REVIEWเมื่อprimaryเปลี่ยนและfinalactionรอreview
- [ ] แสดงfile saved/reading/partial/read failed/not-checkedตามจริงบนทั้งสามทาง; เก็บร่าง/แนบเพิ่ม/อ่านใหม่และsupplier recoveryมีทางทำต่อสำหรับ40+

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

- [ ] siblingdocuments/ภาพ/PDF/ใบเต็มรูปต่างเลขของซื้อเดียวมีpurchase lineageและconsumptionเดียว; เชื่อมเมื่อหลักฐานหรือreviewยืนยัน ไม่ใช้hash/ยอด/brandเป็นคำตัดสินเดียว
- [ ] primary replacement, same-purchase supplemental และnew-purchase routingไม่สร้างderivedsourceซ้ำหรือเปลี่ยนreserved/consumedscope; concurrentcomplete/retryผ่านA71/A72

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

- [ ] ทางขอไฟล์/ใบเต็มรูป/ใบแทนจากร้านแยกจากใบรับรองมั่งมี; electronicverification unavailableไม่เปิดcertificateเอง
- [ ] เปลี่ยน/ลบ/แนบหลังPREPARED/PAYER_CERTIFIED/ISSUEDต้องใช้revision/retention/correctionเดิม; LINE final-receipt routeไม่ข้ามprimarymateriallockหรือย้ายลายเซ็น
- [ ] เอกสารตามมาหลังissue/paymentคงoriginalandfinancialhistoryและกลับsourceเดิม; DIGITAL/PAPERและpartialsourcecompletionยังบังคับ

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

- [ ] export/list/detail/LINEstatus/evidencedownloadสะท้อนcurrent-source reviewและelectronic statusแยกกัน; ไม่ยกผลตรวจไฟล์เก่าให้ไฟล์ใหม่ และoriginal/derivativeaccessตรวจต่อrequest
- [ ] claimDRAFTที่sourceเปลี่ยนต้องrevalidateก่อนsubmit; submitted/paid/postedใช้correctionrouteตามสิทธิ ไม่แก้projectionหรือสร้างpaymentจากlateinvoice
- [ ] ตรวจstock/asset/third-party payment intentเฉพาะdestinationที่มีจริง; unsupportedไม่กลายเป็นexpense/claimอัตโนมัติจากชื่อร้าน

Exit: browser/API/DBแสดงเส้นทางoriginal1290→source810→claim810→projection/paymentที่ถูกต้องเพียงชุดเดียว รวมtax blockedและcompany-fundedทางที่รองรับ
Checks: end-to-end local integration, payment-vs-edit races, snapshot/actor/branchrevocation, source/payment/JV identities, export reconciliation และordinary expense/reimbursement regression
Acceptance หลัก: A01/A04/A05/A08–A10/A13/A15/A17/A20/A21/A24/A30–A32/A39/A40/A42/A44/A46
IG: IG03/IG04/IG05/IG07/IG09/IG11

<a id="w08"></a>
### W08 — ตรวจรับและเตรียมเปิดใช้

Owner: ผู้พัฒนา feature + QA/UX/AI + Product/บัญชีในผลลัพธ์ที่รับรอง
Status: Planned
Depends on: W01–W07 / D05

- [ ] ทดสอบthree-entry parity + replacement state/race/failure matrix§16.4 และ§16.6; file unchangedไม่ใช่proofว่าค่าถูก และอ่านสำเร็จไม่ใช่signatureverified
- [ ] รันA01–A88ตามmappingและบันทึกผลจริงต่อfixture/case; skipหรือmockไม่ใช้แทนหลักฐานDB/browserที่กำหนด
- [ ] วัดAIด้วยheld-out purchase bundles แยกmoney/scope/item completeness/payment/refund/unknown/false-ready; ไม่อ้างaccuracyจาก45publicreferences
- [ ] ทดสอบผู้ใช้40–49/50–59/60+ที่มีทักษะต่างกัน เริ่มdiscovery6–8คน ใช้uploadหลายภาพ/ตัดส่วนตัว/แก้ยอด/พักกลับ/ใบรับรอง/แยกsaved-issued-submitted-paid
- [ ] ทดสอบ§17 UXE-01–27/unknown fallback และA83–A88 รวมคำถามตามไฟล์ที่ถูกปฏิเสธก่อนcapture/ไม่มีevent/หลายไฟล์/AIไม่พร้อมด้วยerror injectionผ่านสามทาง รวมผลmutationหาย/ส่งข้อความล้มเหลว/ไม่มีผู้รับช่วยจริง; บันทึกว่าผู้ใช้เข้าใจสถานะและทำต่อได้ ไม่ตรวจแค่ข้อความตรงsnapshot
- [ ] เก็บindependent completion, correction timeของผู้ซื้อ/บัญชี, recovery success, false confidence, providerlatency/cost ตามเกณฑ์D05
- [ ] ทดสอบold/newcontract/worker compatibility, disable-new-intakeและงานค้าง, retained evidence, normal receipt regressions
- [ ] ปิดIGตามsliceด้วยdecision+implementation+evidence; ผลผิดผู้จ่าย/สกุล/ยอด/paidและduplicatefinancial consumptionเป็นreleaseblockerในชุดregressionที่ตกลง
- [ ] บันทึกข้อจำกัดและreadinessตามrouteจริง; งานcloud/releaseภายหลังต้องอ่านrunbooksและผ่านprotocolของrepoก่อนทำ

- [ ] A75–A82ต้องมีผลจริงบนLINE/new-upload/replacement รวมsingle-page10MB; goldenfieldaccuracy/completeness/qualityเทียบต้นฉบับ, resumabilityเมื่อworkerตาย และขอบtransport/base64; เวลา/costวัดจากfixtureไม่สัญญา10วินาทีโดยไม่มีข้อมูล

Exit: มีacceptance evidenceครบสำหรับrouteที่เสนอเปิดใช้งาน พร้อมremaining unsupported routesที่แสดงทางพักจริง; ไม่มีการประกาศreleaseจากlocaltestsอย่างเดียว
IG: IG01–IG29; Acceptance: A01–A88

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
| A49 | W03/W04/W08 | RC-A01: ยอด68; ไม่สร้างจ่าย500 |
| A50 | W03/W04/W08 | RC-A02: ลดครั้งเดียว รักษาscope/แถวอ้างอิง |
| A51 | W03/W04/W07/W08 | RC-A03: document222 กับsettlement44+178และpoints balanceแยก; ไม่auto-approve reimbursement |
| A52 | W03/W04/W08 | RC-A04: saleใหม่53; ไม่ทำเป็นcoupon/refundนอกหลักฐาน |
| A53 | W03/W04/W08 | RC-A05: quantity/UOM/packไม่คูณซ้ำ, tax groupและยอดรวมถูก, codeไม่กลายเป็นrate |
| A54 | W01/W02/W03/W08 | RC-A06: แยกdocument/transactionและsame-file lineage ไม่รวมเป็นซื้อเดียว |
| A55 | W01/W05/W07/W08 | RC-A07: evidenceมาทีหลังไม่เพิ่มexpense/claim/paymentซ้ำ |
| A56 | W03/W04/W08 | RC-A08: ยอด35; ไม่สร้างสินค้าคูปองหรือใช้เลขคิวเป็นreceipt ID |
| A57 | W03/W04/W08 | RC-A09: ไม่แปลงแต้มเป็นยอดเงินหรือpayer identity |
| A58 | W03/W04/W08 | RC-A10: เก็บsource conflict ไม่ปรับยอดตามป้ายโดยเดา |
| A59 | W02/W03/W04/W08 | RC-A11: completenessตรงภาพ, ไม่ให้แบ่งส่วนตัวจากitem blockที่หาย, save/recoveryผ่าน |
| A60 | W05/W06/W07/W08 | RC-A12: recoveryถูกชนิด; ใบรับรองไม่แทนtax invoice; late document/correctionไม่จ่ายซ้ำ |
| A61 | W01/W02/W03/W08 | RC-A13: แยกdocument typeกับcontainer; ต้นฉบับไม่เปลี่ยน, text/OCRมีprovenanceและขัดกันแล้วไม่false-ready |
| A62 | W01/W03/W04/W08 | RC-A14: ผลตรวจแยกmethod/pass/fail/not-checked/unavailable; อ่านได้ไม่เท่ากับตรวจผ่าน, ตรวจผ่านไม่เท่ากับอนุมัติภาษี/เบิก; ใช้fixtureที่ไม่ได้redactทับsigned original  baselineพิสูจน์not-checked/unavailable; pass/failตามmethodต้องมีfixtureเมื่อเปิดautomatedverificationตามD09 และยังห้ามอ้างว่ามีตัวตรวจจากbaselineเพียงอย่างเดียว |
| A63 | W01/W05/W06/W07/W08 | RC-A15: เสนอผูกซื้อเดิมโดยไม่เพิ่มยอด; ความต่างเลขเอกสาร/issuer/ยอดเข้าตรวจและcorrectionตามlock ไม่overwriteหลักฐานหรือเงินที่postแล้ว |
| A64 | W02/W03/W06/W08 | RC-A16: saved draftยังอยู่, มีทางเพิ่มหลักฐาน/กรอกต่อ/ขอร้าน; ไม่ปล่อยpasswordสู่log/prompt ไม่สร้างใบรับรองหรือแอบอนุมัติเพื่อข้ามerror |
| A65 | W02/W03/W08 | RC-A17: document/page coverageถูกต้อง; ไม่จำกัดหนึ่งไฟล์เท่ากับหนึ่งซื้อ และไม่ใช้summaryแทนcomplete item reviewโดยไม่แจ้ง |
| A66 | W01/W02/W03/W07/W08 | RC-A18: เก็บเฉพาะหลักฐานที่มีสิทธิ, tenant/accessครบ; contentเป็นข้อมูลไม่ใช่คำสั่ง, ไม่fetch arbitrary URL/ส่งไฟล์ออกเอง; ข้อมูลประกอบวิธีตรวจไม่สูญหาย |
| A67 | W02/W03/W08 | RC-A19: ตรวจขอบ4MB/4MiB/10MiBและ+1byte; FE/BEใช้10MiBเดียวกัน, ไฟล์ภายในขอบเข้าautomatic pipeline; เกินขอบไม่อ้างเก็บสำเร็จหรือทับต้นฉบับ และคงงานเดิมไว้ |
| A68 | W01/W02/W03/W04/W08 | LINE integration: เก็บ bytes/target ที่อนุญาตก่อนบอกเก็บแล้ว; clarification ผูกงานและไฟล์เดิม ไม่สร้าง expense ก่อนรู้ scope; ไม่ยกเลิก MULTI_DOCUMENT guard ใน single-expense contract |
| A69 | W02/W03/W04/W08 | three-entry parity: facts/ยอด/unknown/completeness/verification semantics และ policy version ตรงกัน; ต่างได้เฉพาะช่องทางกับขนาดที่มีสัญญาชัด ไม่มี prompt แยกจนอ่านคนละยอด |
| A70 | W01/W02/W03/W04/W08 | Replaceสำเร็จแต่failed readingให้Webกรอกงานเดิมตาม§17.6พร้อมcurrentfile/humanfactsและprovenance; ไม่เสนอOCRretry ไม่แสดงverifiedจากไฟล์เก่า unknownตรวจสถานะก่อน |
| A71 | W01/W02/W03/W04/W08 | replacement concurrency: complete ต้องตรวจ expected target attachment และ revision ที่ผู้ใช้เริ่มเปลี่ยน; มี winner เดียวหรือแจ้ง conflict ไม่ให้ stale upload ทับ; stale OCR/notice/cache ไม่เปลี่ยนผลของไฟล์ปัจจุบัน |
| A72 | W01/W02/W05/W06/W07/W08 | replacement state matrix: ใช้ตาราง §16.4; อนุญาตตาม server guards และ correction เดิม; ทุกผล deny/conflict มีทางกลับงานที่ถูกต้อง ไม่ retire หลักฐานที่ใช้ลงนามหรือจ่ายแล้ว |
| A73 | W02/W03/W04/W06/W08 | replacement semantic identity: ถาม/แสดงความต่างก่อนยอมรับ facts ใหม่; ไม่เอา vendor/item/tax/payment จากสองซื้อปนกัน ไม่เติมช่องว่างด้วยค่าจากเอกสารเก่าโดยไม่มี provenance; งานใหม่ต้องเริ่มตามสิทธิและไม่ทำรายการเดิมหาย |
| A74 | W02/W03/W08 | PDF capability: แยก stored กับ readable; แสดงสาเหตุ/ทางกรอกต่อหรือแนบไฟล์อื่น; ไม่ใช้ first-page/summary เป็น complete และไม่เปลี่ยน provider policy หรือส่งข้อมูลออกเพื่อแก้ error โดยปริยาย |
| A75 | W01/W02/W03/W08 | PDF10,000,000/10,485,760bytes ทั้งtext/scanned/mixed pages ผ่านLINE/อัปโหลด/เปลี่ยนใบเสร็จ: ระบบรับต้นฉบับและเริ่มautomatic bounded readingทั้งไฟล์; ขนาดเกิน4MBเพียงอย่างเดียวไม่คืนunsupported/manual-only; ส่งผลที่อ่านได้พร้อมข้อขัดกันเข้าสู่review; ถ้ามีหน้าค้างหรืออ่านไม่สำเร็จต้องเป็นpartial ไม่อ้างอ่านครบ |
| A76 | W02/W03/W08 | PDFหน้าเดียว10MBหรือหน้าหนึ่งยังเกินขอบproviderหลังแยก: renderสำเนาและแบ่งregions/tilesที่ตรวจขนาดจริง พร้อมoverview+พิกัด/ส่วนซ้อน; อ่านตัวเลขเล็ก/ภาษาไทยได้ตามgolden fixture ไม่ลดภาพจนข้อมูลหาย; ไม่เปลี่ยนต้นฉบับ |
| A77 | W03/W04/W05/W08 | headerร้านหน้า1, สินค้าหลายchunk, totalท้ายใบ และมีหลายใบในPDF: assembleobservationsตามdocument/page/region+stableline IDs ไม่บวกsubtotal/totalซ้ำหรือmergeจากชื่อสินค้า; cross-pageidentity/void/ส่วนลดและunknownมีprovenanceก่อนallocation |
| A78 | W01/W02/W03/W04/W08 | workerหยุดหลังอ่านบางส่วน/retryผลหาย/ผู้ใช้เปลี่ยนprimaryหรือสิทธิระหว่างอ่านไฟล์10MB: ผลchunkที่สำเร็จยังอยู่; resumeเฉพาะงานค้างและreuseattemptตามgovernance; ไม่สร้างexpense/claimซ้ำ; rechecktenant/actor/revisionก่อนapply/notifyและstaleไม่ทับใหม่ |
| A79 | W01/W02/W03/W08 | 10MBมีหลายร้อยหน้า/รูปขยายใหญ่มาก/เกินtoken-budgetหรือquotaหมดกลางงาน: จำกัดpage-per-batch/pixels/memory/time/concurrencyและขนาดHTTPจริง; ทำต่อด้วยcheckpointหรือแสดงpaused/incompleteตามเหตุจริง ไม่ตัดหน้าเงียบหรือบังคับลูกค้าแบ่งPDFเพราะ4MB; sizeไม่ใช่unlimitedbudget |
| A80 | W01/W02/W03/W06/W08 | e-Taxต้นฉบับ10MBถูกsplit/rasterเพื่ออ่าน; encrypted/corruptบางส่วน: hash/bytes/versionต้นฉบับคงเดิม; signature/timestampตรวจoriginalเท่านั้น; derivativeมีlineageไม่อ้างเป็นต้นฉบับ, errorชี้หน้า/สาเหตุและเก็บผลที่สำเร็จ; ไม่ออกใบรับรองอัตโนมัติ |
| A81 | W01/W02/W03/W04/W08 | PDF 2/5/10/20 หน้า ทั้ง native/scanned/mixed และใบเดียวต่อหลายหน้า: มี manifest ครบทุกหน้าเรียงตามไฟล์และเลขหน้าที่พิมพ์เป็นหลักฐานแยก; header/footer/carry-forward ไม่สร้างยอดหรือรายการซ้ำ; ไม่ใช้เพดาน 17 หน้าของ certificate preview เป็นเพดาน reader; ผ่านทั้งสามทาง |
| A82 | W02/W03/W04/W08 | แยกblank/failed/missingและfile/document completeness; failed/partialเปิดWebกรอกข้อมูลขาด+แนบหน้าที่ขาดในงานเดิม ไม่มีuser rereadหรือmergeคนละบิล |
| A83 | W00/W01/W02/W03/W04/W06/W07/W08 | UXE-01–27และunknownมีสถานะ/actionตามสิทธิ์; OCRfailedใช้saved-file notice+Websame-work link ไม่มีerror rereadหรือmanual-entry chat; linkrouteต้องใช้ได้จริง |
| A84 | W01/W02/W03/W04/W06/W07/W08 | ผลบันทึก/สร้างใบเบิก/ออกใบรับรองหาย, กดซ้ำ, cancel, สิทธิหรือsourceเปลี่ยนระหว่างerror: ตรวจสถานะด้วยoperationเดิมก่อนretryผลที่ไม่ทราบ; ไม่สร้าง/จ่าย/นับอ่านซ้ำ, source/สิทธิตรงตอนกด, retryเฉพาะส่วนค้าง, cancelไม่เท่ากับลบไฟล์หรือถอนเอกสารการเงิน |
| A85 | W02/W04/W06/W07/W08 | UX40+กดลิงก์ถึงWebงานเดิมพร้อมไฟล์/partialfacts; login-return/mobile/permissions/stateตรง ไม่อัปโหลดหรือสร้างใหม่และไม่สับสนsaved/submitted/paid |
| A86 | W00/W01/W02/W03/W04/W08 | LINEถามย้อนหลังว่าไฟล์เมื่อกี้ส่งไม่ได้/ทำไมอ่านไม่ได้/ต้องส่งใหม่ไหม หลังrejectionหรือrestartโดยยังไม่มีexpense: ตอบจากreason/stage/size-limit-at-attempt/persist-stateที่APIตรวจสิทธิ์และอ้างอิงattemptเดิมได้; สาเหตุoversizeไม่กลายเป็นdownloaderrorทั่วไป; คำถามอย่างเดียวไม่OCRซ้ำ/สร้างร่าง/แก้เงิน |
| A87 | W01/W02/W04/W08 | มีหลายไฟล์หรือหลายงาน/ไฟล์ชื่อซ้ำ/ไม่มีevent/retentionหมด/สิทธิ์เปลี่ยน/ข้อความLINEมาช้า: เลือกเฉพาะattemptที่actor/company/chatเข้าถึงได้; ผูกเป้าหมายด้วยreferenceที่serverตรวจได้ ไม่เลือกlatestผิดงาน; ไม่พบข้อมูลหรือlookupล่มตอบต่างกันและไม่เดาสาเหตุ/เปิดเผยงานอื่น |
| A88 | W01/W02/W03/W04/W06/W07/W08 | ผู้ใช้ถามเหตุผลขณะAI/provider/quotaไม่พร้อม, ถามซ้ำหลังrecoveryหรือlimitเปลี่ยน, หรือส่งข้อความแจ้งผลไม่สำเร็จ: ใช้คำตอบสถานะจากserverและfallbackเดิมเมื่อเหมาะสม; แสดงเหตุที่เกิดตอนนั้นแยกสถานะปัจจุบัน; ไม่ต้องอ่านไฟล์อีกเพื่ออธิบายerror ไม่ให้คำตอบถามสถานะกลายเป็นคำสั่งretry และไม่อ้างส่งข้อความถึงแล้วหากdeliveryไม่สำเร็จ |

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
| IG16 (P1) | W03/W04/W08 | normalize signed eventsก่อนexpense materialization; ไม่absหรือเปิดnegativeทุกแถว; monetary role/provenance/Decimal; A49–A52/A56/A57 |
| IG17 (P1) | W03/W04/W07/W08 | แยกqty/UOM/packกับdisplay count, อ่านlegend/unknown และreuseper-line tax; ไม่ใช้7%ทั้งใบ/ไม่เดาZERO_RATED; A53/A58/A59 |
| IG18 (P1) | W02/W03/W08 | D02ระบุupload/extraction/provider limitsแยกและหน่วยbytes; shared threshold+error recoveryทั้งสามทาง; A67/A69/A74 |
| IG19 (P1) | W01/W02/W03/W08 | capability typed errors, page/document completeness, boundedreuse/retry; รักษาvision reader policyเดิมจนD02ตัดสิน; A61/A65/A74 |
| IG20 (P1) | W01/W02/W03/W04/W08 | durable capture/pending identityตามสิทธิ; ไม่บอกเก็บแล้วก่อนpersist,ไม่lost bytesหลังถามกลับ; scope/target/versionก่อนgroup routing; ปิดfile/PDF preflight gapจากE15ด้วยbounded reader; A68/A69/A75/A81 |
| IG21 (P1) | W01/W02/W03/W04/W07/W08 | original hash/version+derivative, not-checked/failed/unavailableต่างกัน, D09/authorized evidence; screenshotยังreviewได้ตามpolicy; A61/A62/A64/A66 |
| IG22 (P1) | W01/W02/W03/W04/W08 | invalidate current-source verificationโดยรักษาค่าคนพร้อมprovenance; diff/reviewก่อนใช้กับไฟล์ใหม่ ไม่ปนสองซื้อ; A70/A73 |
| IG23 (P0) | W01/W02/W05/W06/W07/W08 | expected old attachment+revisionจากUI/LINE, transaction/idempotency/old-result fence, state matrixและretention; A63/A71/A72 |
| IG24 (P0) | W01/W05/W06/W07/W08 | document relations/candidatesที่ตรวจแล้วและconsumptionข้ามช่องทาง; ไม่mergeจากยอด/โลโก้; replacement/creditผ่านcorrection; A54/A55/A60/A63/A69 |
| IG25 (P1) | W00/W08 | authorized bundlesครบ5แบรนด์, held-outไม่รั่วข้ามภาพเดียวกัน; UX40+ผ่านreplacement/recovery, sample countsไม่ใช่ผลผ่าน; A49–A74 |
| IG26 (P1) | W01/W02/W03/W04/W08 | เพิ่มbounded page/region preprocessing + manifest/reassembly; ขนาดส่วนย่อยวัดจริง, overview/overlap dedupและtinyprintquality; A75/A76/A77/A80 |
| IG27 (P1) | W00/W01/W02/W03/W08 | durable bounded runner, perchunkcheckpoint+attemptidentity, HTTP/base64/pixels budgets, source/actorcheckตอนทำต่อ; A78/A79; ไม่manual-onlyจาก4MB |
| IG28 (P1) | W00/W01/W02/W03/W04/W06/W07/W08 | §17 UXE-01–27, reason/persist-state/action contractร่วม; unknown-result status-before-retry, no false saved/charged/sent claim, parityและUX40+; A83–A85 |
| IG29 (P1) | W00/W01/W02/W03/W04/W06/W07/W08 | §17.5 safe pre-capture outcome/reason, scoped status lookup, no-event/ambiguous/expired distinction, grounded human-language replyและread-only fallback; A86–A88 |

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
| G1 — Capture pilot | IG15 และ D08 สำหรับข้อมูลจริงปิดแล้ว; ไม่มี binary ที่ไม่รองรับเข้าถึงข้อมูลใหม่; W01–W04เฉพาะcapture/reviewที่เปิดผ่าน; upload/resume/limits/quota/LINE/permissions/unknownsและUI recoveryมีหลักฐาน; retail/electronicผ่านIG16–IG22ที่เกี่ยวข้องรวมreplacementและD09baseline status พร้อมIG28–IG29/§17error recoveryแบบWeb deep linkและLINEถามย้อนหลังของเส้นทางที่เปิด | เก็บและตรวจร่างตามขอบเขต; ห้ามอ้างfeatureค่าใช้จ่าย/เบิกครบ |
| G2 — Financial/certificate path | D03/D04ของrouteพร้อม; W05–W07ของrouteนั้นผ่าน โดยW06บังคับเฉพาะrouteที่มีใบรับรอง (route ใบเสร็จล้วนตรวจ technical integration ได้ด้วย W05+W07 ส่วน W06 ยังบังคับที่ G3); P0/P1ที่เกี่ยวข้องกับrouteรวมIG23/IG24ปิด; source/payment/export/races/actualpayer/correctionมีหลักฐาน | ผ่านtechnical integrationของrouteนั้น รวมCOMPANYcertificateissue; การเปิดลูกค้ารอG3และreleaseprotocol |
| G3 — Full-feature acceptance | W08ผ่านตามD05, D08 (PDPA/retention) ปิดแล้ว, A01–A88ในsupportedscopeมีผลจริง, Thai3platform+5retail-brand coverage รวมelectronicและthree-entry40+ทดสอบแล้ว, compatibility/disableintakeพร้อม | ถือว่าfeatureครบก่อนเข้าสู่งานreleaseที่มีprotocolแยก |

ไม่มีการใช้G1ตัดW06ออกจากscopeเดิม และไม่มีการใช้unsupportedstatusปิดข้อกำหนดหลักโดยไม่มีimplementation ข้อยกเว้นต้องสะท้อนในspecและreadinessตามจริง

เมื่อมีงานปล่อยระบบภายหลัง ให้อ่าน [cloud operations](../runbooks/cloud-environment-operations.md) ก่อนแตะenvironment และ [UAT/Production protocol](../runbooks/uat-production-v2-deployment.md) ก่อนdeploy/promotion/retry ต้องบันทึกrun IDsและacceptanceตามrunbook การปิดfeatureใหม่ให้ใช้capability/intake controlที่ออกแบบ ไม่ลบschemaหรือทำเอกสารที่ออกแล้วหาย

## 10. การบันทึกผลและรักษา spec/plan ให้ตรงกัน

ทุกงานย่อยที่ส่งตรวจต้องมี: W ID, spec sections, A/IGที่เกี่ยวข้อง, สิ่งที่เปลี่ยน/ไม่รองรับ, file/contract/migrationimpact, command+resultจริง และ next state เมื่อbehaviorหรือscopeเปลี่ยนให้แก้specก่อนหรือในdiffเดียวกับplan/memory

- เก็บ evidence ใหม่เมื่อเริ่มทดสอบใน `docs/evidence/marketplace-buyer-expense-capture/<work-id>/`; ยังไม่ได้สร้างหลักฐานruntimeเปล่า ๆ ในรอบวางแผน
- บันทึกfixture IDs/version/hash, expected/actual, testedcommit/runtime/schema/model/policyversionตามสิ่งที่testใช้; ไม่เก็บrawcustomerPII/credentials
- แยก not-run / skipped / failed / passed ชัด; IGปิดได้เมื่อdecision+implementation+verificationครบ ไม่ใช่เพราะมีชื่อtest
- ใช้memoryงานเดิมบอก Wปัจจุบัน/decisionค้าง/ผลcheck/ขั้นถัดไป ไม่ใช้legacyrole-gateworkflow

Verificationย้อนหลังรอบ v0.6: ตรวจtraceability A01–A48/IG01–IG15, W00–W08dependencies, D01–D08 references, links/anchors/test pathsและคู่spec/planด้วยlocaldocumentcheck ไม่มีapplicationcode/migration/runtime tests/cloud actions

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

การ merge spec/plan ไม่ใช่การตัดสิน D01–D09 แทนเจ้าของ policy, การเปิด launch route หรือการ deploy ฟีเจอร์

Next ณ v0.6 (ประวัติ; ขอบเขตล่าสุดดู Next v0.8): เริ่ม W00 ของ slice แรก: D01/D06/D07 และ D02 ส่วน foundation ก่อน W01 → W02; D03 ก่อน allocation/financial action ที่พึ่ง policy, D04 ก่อน W06, D08 ก่อนข้อมูลบุคคลจริง/AI pilot; D05/W08 และเงื่อนไขที่เหลือยังเปิดอยู่ ไม่ถือว่า merge เอกสารเท่ากับอนุมัติ policy หรือเปิด feature

### รวม retail/electronic และเปลี่ยนใบเสร็จเป็น v0.7 — 2026-09-17

คำขอรอบนี้คือรวมผลสำรวจเข้าคู่spec/planและตรวจimpact/bug/gap โดยผู้ใช้ย้ำหน้าเปลี่ยนใบเสร็จด้วย จึงเพิ่มbaseline spec§16, A49–A74, IG16–IG25, E12–E21 และD09. ยังไม่แก้application code, prompt, schema, company policy, mergeหรือdeployในรอบนี้

| ข้อค้นพบจากreview | วิธีแก้ในข้อกำหนด/แผน | หลักฐานที่จะใช้ปิดงานจริง |
|---|---|---|
| ชื่อfeatureเดิมทำให้retailดูเหมือนนอกscope | ขยายScopeและWเดิมทั้งสามทาง; researchRC-A01–19mapเป็นA49–A67 | traceability + A69สามทาง; ไม่สร้างห้าmerchant workflows |
| หน้าเปลี่ยนมีauto rereadเดิมอยู่แล้ว | reuseE16 และเพิ่มepoch/source provenance/error+reviewstateแทนการสร้างreaderใหม่ | A70–A73; UI/API/raceเมื่อคนแก้พร้อมOCR |
| READYมีปุ่มเปลี่ยนแต่ไม่auto reread; completeไม่ได้invalidateOCRเดิมอย่างชัด | กำหนดกลับNEEDS_REVIEWและผูกผลตรวจกับไฟล์ใหม่ โดยคงค่าคนพร้อมdiff | A70/A72/A73; เป็นstatic risk ยังไม่reproduce |
| Expected revisionในcompleteไม่ได้สะท้อนเวลาที่ผู้ใช้เลือกไฟล์ | เพิ่มexpected old attachment + revisionในintent/complete และidempotency/conflict contract | A71 DBconcurrency +สองแท็บ +LINElatefile; ไม่อ้างว่าปัจจุบันไม่มีlockเลย |
| PDFขอบ4MiB/4MBต่างกันจริง | IG18/A67และD02ให้กำหนดthresholdsharedทั้งupload/replacement/LINEและแยกstorageกับAI limits | boundary 4,000,000/4,000,001/4,194,304/4,194,305bytes; staticเท่านั้นในรอบนี้ |
| LINEPDF/captionกับWebมีintakeคนละเงื่อนไข | W02/W03เพิ่มpendingcapture/typedcapability/clarification; legacy multi-docguardคงอยู่ | A68/A69/A74, persisted-before-savedและไม่สร้างpurchaseซ้ำ |
| Researchเสนอtext-firstแต่sharedreaderปัจจุบันเป็นvision/documentตามdecisionเดิม | §16.3ให้reuseก่อน native textเป็นD02optimizationที่ต้องพิสูจน์pagecoverage/render/งบ | E13/E14, receipt +bank-statementregression; ไม่เปลี่ยนproviderpolicyในงานdocs |
| e-Taxguideไม่ใช่originalPDF/verification proof | D09/§16.3/§16.5แยกbaseline not-checkedกับตัวตรวจจริง; ไม่รวมOCRverifiedกับcryptographicverified | A61/A62/A64/A66 พร้อมauthorized unalteredfixturesเมื่อเปิดverification |
| เปลี่ยนreceiptอาจชนretention/claim/signature/payment | §16.4ใช้ข้อจำกัดเข้มสุดและreusecorrection/W06; supplementallateinvoiceไม่เพิ่มหนี้ | A60/A63/A71/A72 + funding/source resolver/APItests |

ผลตรวจในรอบนี้ต้องบันทึกหลังรันlocaldocumentcheck: IDs/จำนวน/mapping, local links/anchors/code-line targets, workdependencies, corpuscounts/RCmapping, currentversionwordingและdiffscope. ไม่มีการใช้การตรวจเอกสารนี้ปิดIGหรือประกาศruntimeผ่าน

## 11. ชุดตรวจรับเพิ่มสำหรับสามทางและหน้าเปลี่ยนใบเสร็จ

| ชุด | Test seams ที่มีอยู่ให้ต่อยอด | Casesและผลที่ต้องพิสูจน์ |
|---|---|---|
| Shared AI/normalization | [Gateway tests](../../apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts), [OCR apply](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.spec.ts) | A49–A59/A61/A65/A69/A74; money role, void, pack/mixedtax, nofalsecomplete, multi-doc/version/provider gates |
| New upload + replace UX logic | [upload logic](../../apps/web/src/features/expenses/expense-upload.logic.spec.ts), [review steps](../../apps/web/src/features/expenses/expense-review-steps.logic.spec.ts), [shared upload consistency](../../apps/web/src/common/files/upload-consistency.spec.ts) | A64/A67/A69–A74; nativefilepreservation, threshold, ready/reread, sameerrorsemantics; เพิ่มbrowser mobile/desktopเพื่อพิสูจน์ปุ่มจริง ไม่ใช้logicmockแทน |
| Complete/remove/state guards | [upload use cases](../../apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts), [remove receipt](../../apps/api/src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.spec.ts) | A70–A73; expectedtarget/revision, successbind/failread, signed/liveclaimdeny, retainedoriginal, reloadlostresponse |
| LINE intake/recovery/certificate continuation | [intake dispatch tests](../../apps/api/src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts), [receipt reliability PG](../../apps/api/src/modules/line-ai/receipt-reliability.pg.spec.ts) | A68/A69/A71/A72; PDFwith/withoutcaption, clarificationlatermessage, expiredmedia, contextหลายงาน, finalreceiptกับsignatureไม่สลับ; ไม่ส่งข้อความจริงหาลูกค้า |
| Funding/source/export invariants | PG suitesและresolver/projection seamsใน§8เดิม | A55/A60/A63/A69/A71/A72; ต้นฉบับ/child/claimรวมเงินครั้งเดียว, actualpayer/fullsource/locks, ordinaryreceiptsregression |
| Electronic verification | reusefixture/attachmenttest infrastructureตามD09 | A62 baselineยังไม่ตรวจ/ตรวจไม่ได้ไม่แสดงผ่าน; automatedsignature/timestamppathต้องมีvalid/tampered/unavailable/unsupported fixturesของmethodนั้นเมื่อมีimplementation ไม่ทดสอบลายมือชื่อจากไฟล์redacted |

คำสั่งเพิ่มเติมที่วางแผนไว้ (ยังไม่รันในงานเอกสาร; ใช้หลังแก้sliceที่เกี่ยวข้องและbuilddependenciesตาม§8):

```sh
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts
pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expense-review-steps.logic.spec.ts src/common/files/upload-consistency.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts src/modules/expenses/application/use-cases/remove-expense-receipt.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/line-intake-dispatch.use-case.spec.ts
```

PG/browser/AIevalต้องอ่านharnessและใช้localisolatedauthorizedfixturesก่อนรัน ไม่ใช้liveDBจากenvironmentโดยไม่ตรวจ; DBsuiteที่skipไม่ปิดconcurrencygate. Test receipt batchesและnativePDFต้องอยู่ภายใต้quota/provider/privacyเดิม บันทึกsurface/attachmentversion/model/policyversion/expectedactualทุกcriticalcase; ถ้าไม่มีoriginalsignedfilesให้ระบุcoveragegap ไม่สร้างผลผ่านจำลอง

Next v0.7 (ประวัติ; ถูกขยายด้วย v0.8 ด้านล่าง): เริ่มW00ปิดcontract/representationเฉพาะsliceและauthorizedfixtures แล้วW01guards → W02ทั้งสามทาง → W03sharedreader → W04review → W05/W06/W07ตามroute → W08. เปลี่ยนใบเสร็จและใบรับรองเป็นscopeบังคับของfeatureเต็ม; D09automatedverificationเป็นขอบเขตต้องตัดสินเพิ่ม ส่วนการรับelectronicและสถานะที่ซื่อตรงต้องมีในbaseline

ผลตรวจเอกสาร v0.7 (2026-09-17): PASS — Python stdlib ตรวจ A74/IG25/E21/D9/W9, mapping RC19→A49–A67, 175 local links/84 file-line targets/9 anchor links, 9 planned commands/14 test-path occurrences, dependency order และคอลัมน์ตาราง; corpus11docs/10images/5electronicguidesและสมการDecimalตรงกัน. `git diff --check` ผ่าน. คำสั่งตรวจ: `python3 /tmp/check-mangmee-retail-v07.py` (ใช้ bundled Python runtime); application/API/DB/browser/OCR evaluation ยังไม่รันเพราะเป็นงานspec/plan. ไม่ถือว่าIGปิดหรือโค้ดแก้แล้ว

### PDF 10 MB automatic reading — v0.8, 2026-09-17

Product decisionจากผู้ใช้: ส่งไฟล์10MBแล้วAIต้องอ่านได้ จึงปิดtargetขนาดต้นฉบับที่10MiBและเลือกboundedinternalprocessingในspec§16.7; ไม่ให้manual-onlyเพราะเกิน4MB. A75–A80/IG26–IG27/E22–E24ถูกเพิ่มในmapping/W00–W03/W08แล้ว D02ยังต้องปิดrunner/admission/resourcebudgetที่พิสูจน์ได้ก่อนcode, D09ยังแยกการตรวจe-Taxออกจากการอ่าน

Implementation orderที่เล็กที่สุด:

1. W00/W01: reuseAPIpdf-lib/pdfjs-dist/sharpและattachment/job/workerpatternsที่มี; ตัดสินmanifest/jobstatus/lease/attemptและbudgetcontract โดยไม่ใช้LINEread-onlydrainทำreceiptmutationตรง ๆ
2. W02: LINE/newupload/replaceส่งoriginal10MiBเข้าการเก็บ/อ่านงานเดียว พร้อมstatus/resume; เอาข้อความ4MBmanual-onlyออกเฉพาะเมื่อbackendpipelineพร้อมจริง
3. W03: splitPDFตามหน้ากับขนาดจริง → large-page raster/regionsเมื่อจำเป็น → sharedreader → source-aware merge/reconciliation; originalไม่เปลี่ยน, tinytextqualityต้องผ่าน, ไม่บีบทุกหน้าลงcontextเดียว
4. W04–W07: reusepreview/source/claim/certificateเดิม; ผลอ่านเป็นfactsไม่สร้างexpenseต่อchunk, review/paid/lock boundariesคงเดิม
5. W08: actual10MBหลายหน้าและหน้าเดียวทั้งสามทาง, failure/resume/stale/permission/HTTP-base64/memory/token/usage tests พร้อมmeasurement; เปิดใช้เมื่อevidenceครบ ไม่ถือว่าแค่เพิ่มค่าขนาดเสร็จงาน

| กรณีตรวจเพิ่ม | สิ่งที่ต้องพิสูจน์ | หลักฐานที่มีให้ต่อยอด |
|---|---|---|
| A75/A76:10MBหลายหน้าและหนึ่งหน้าใหญ่ | split outputbytesจริง, raster/tilesอ่านtinyThai/moneyได้, originalhashเดิม, ไม่manual-onlyเพราะ4MB | E22PDFcopy/renderpatterns, existingGateway/receiptapplytests; fixtureใหม่ต้องมีreal raster/text content |
| A77: contextข้ามหน้า/overlap/multiple invoices | issuer/rows/totalสัมพันธ์ถูก, ไม่บวกซ้ำ/ไม่dedupสินค้าจริง, ไม่สร้างexpenseต่อchunk | groupcontract+reconciliationtestsของW03/W04 |
| A78: crash/reclaim/replacement/concurrentretry | checkpoint/reusechunk, attemptidentity, source/actorcheckและlate-resultfenceครบ | upload/reliabilityPGและreplacementrace suitesตาม§11 |
| A79: page/pixel/token/HTTP/quota budgets | boundedrunnerวัดจริง, nofirst-Nsilenttruncate, pause/resumeไม่ทำข้อมูลหรือusageผิด | E23transport + OCRadmission + isolatedworker/APItests; ไม่ตั้งSLAจากขนาดไฟล์อย่างเดียว |
| A80: signedoriginal/encrypted/corrupt | originalbytesไม่เปลี่ยน, derivativesไม่ใช้ตรวจsignature, reasonและrecoveryตรง | D09fixturesและattachmentretention/securitytests |

ข้อจำกัดproviderตรวจจาก [AWS Bedrock Message](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Message.html) ณ2026-09-17; APIadapterปัจจุบันส่งConverse documentbytesตรงจึงยังอ่าน10MBโดยเพิ่มconstantอย่างเดียวไม่ได้ การอ่าน10MBอัตโนมัติเป็นงานplanned ยังไม่มีapplicationimplementation/runtimeproofในรอบนี้


### PDF หลายหน้า — ขยาย v0.8 ตามคำถามต่อเนื่อง

§16.8 และ A81/A82 ทำให้ page coverage, document completeness และหลายใบเสร็จในไฟล์เดียวเป็นข้อกำหนดตรวจรับชัดเจน; ไม่เปลี่ยนเพียงจำนวนหน้าที่ส่งให้โมเดล

- W00/D02: วัดและระบุขอบจำนวนหน้าที่รองรับ/page-per-batch พร้อมbudgetsและcapabilityร่วม; ค่า17หน้าของcertificate previewไม่เกี่ยวกับขอบreader
- W01/W02: manifestผูกoriginal/revision; แสดงจำนวนหน้าจริงและresumeผ่านทั้งสามทาง รวมแนบหน้าที่ขาดในงานเดิมกับsource invalidation
- W03/W04: รวมข้ามหน้าโดยแยกcarry-forward/total/headerซ้ำ; file coverageแยกdocument completeness, blankแยกfailed, invoice groupingไม่แน่ชัดต้องreviewก่อนfinancial handoff
- W08: A81/A82ตรวจ2/5/10/20หน้าแบบnative/scanned/mixed, <4MBและใกล้10MiB, >40items, repeatedfooter, missing-page/blank/failure/multipleinvoices; เพิ่ม50/100หน้าและboundaryตามD02เพื่อวัดresource/resume โดยไม่ใช้การpauseแทนหลักฐานอ่านครบ

Next v0.8: ปิดD02เฉพาะcontract/runner/budgets/declared-page-scopeจากfixtureและinfraจริงในW00 แล้วดำเนินW01→W02→W03ตามdependencyเดิม พร้อมรักษาW04–W08และfinancial/policy/release gates; งานนี้ยังเป็นspec/plan ไม่มีการเพิ่มขอบPDF4MBในruntimeหรือรับรองจำนวนหน้าที่ระบบใช้งานจริงอ่านครบแล้ว


ผลตรวจเอกสาร v0.8 (2026-09-17): PASS — `python3 /tmp/check-mangmee-retail-v08.py` ตรวจ A82/IG27/E24/D9/W9, mapping RC19, 183 local links/92 file-line targets/9 anchor links, 9 planned command shapes/14 existing test-path occurrences, dependency order/table columns/Decimal equations, ขอบต้นฉบับ10MiBและชุดหลายหน้าในcatalogตรงกับspec/plan; `git diff --check` ผ่าน ไม่มีการรันapplication/API/DB/browser/model tests หรือพิสูจน์OCR accuracy/จำนวนหน้าจริงในงานเอกสารนี้ ตรวจอ่านsourceแล้วพบว่ายังมีgatePDF4,000,000bytesและreaderส่งPDFทั้งไฟล์ด้วยoutput budget4096tokens; การรองรับ10MB/หลายหน้าจึงยังเป็นงานimplementation ไม่ใช่behaviorที่แก้แล้ว


LINE file/PDF follow-up (2026-09-17): E15/IG20เพิ่มstatic evidenceที่downloadLineMediaสร้างAI contentเฉพาะimageและPDFถูกNOT_REQUESTEDก่อนGateway. W02/W03ต้องต่อpersisted originalเข้าpipeline, W08เพิ่มA68/A75/A81แบบraw file webhook→downloadจริงในharness→validation/persist→reader→review; fixtureต้องไม่เติมcontentBase64ข้ามdownloader. ทดสอบPDFหลายหน้ากับcaptionless/ข้อความแยก/กลับมาตอบ/expiredmediaและwebupload recoveryผูกงานเดิม พร้อมclientที่รองรับบนมือถือ/desktop โดยไม่ส่งข้อความจริงหาลูกค้าในงานเอกสารนี้. LINEรับfileได้เป็นหลักฐานplatform; ไม่ใช่หลักฐานว่าบอตอ่านPDFครบแล้ว


### Error UX และ recovery — v0.9, 2026-09-17

คำถามผู้ใช้ทำให้พบว่าหลักการrecoveryเดิมยังไม่ใช่ชุดข้อความ/ปุ่ม/สถานะที่ตรวจรับร่วมกัน จึงเพิ่มspec§17 UXE-01–27, A83–A85, IG28และE25 โดยคงPDF10MiB/หลายหน้า/LINE/เปลี่ยนใบเสร็จ/ใบรับรองและfinancial guardsเดิม ไม่ถือว่าข้อความในแอปถูกแก้แล้ว

| งาน | สิ่งที่ต้องเพิ่มในงานเดิม | หลักฐานรับงาน |
|---|---|---|
| W00/D02/D06 | inventory reasonจริงจากintake/download/storage/reader/review/claim/certificate/delivery และmapกับpersist-state/action/unknownfallback | error→สถานะ→ปุ่ม→route→สิทธิ→fixtureครบUXE-01–27; ไม่สร้างenum/envelopeใหม่ถ้าของเดิมใช้ได้ |
| W01 | operation-status/expectedrevision/permissions/idempotencyสำหรับunknown-resultและการกดซ้ำ | ก่อน/หลังcommitผลหาย, concurrentactorและlateworkerไม่สร้าง/จ่ายซ้ำหรือเผยข้อมูลข้ามสิทธิ์ |
| W02/W03 | typed reasonจากdownload/scan/provider/budget/page failures, perfile/pageprogress, stop/resume; แก้copyที่เรียกPDFว่ารูป | raw LINE file eventและWeb upload/replaceผ่านเส้นจริงในharness; แยกไฟล์ถูกปฏิเสธกับscannerล่ม, transientกับquota/config |
| W04 | inline persisted notices/summary/actions/review source/diff; reusecopyและcomponentsเดิม | ปุ่มเปิดหน้าหรือข้อมูลที่ต้องแก้, กลับงานเดิม, nofalsecomplete; blocked/recoverable/unknownอ่านเข้าใจ |
| W06/W07 | certificate/claim/paid/issued/correction/partial-sourceและdelivery errors | outcome unknownตรวจoperationเดิม; ไม่มีfallbackออกใบรับรองหรือส่งเบิกใหม่เพื่อทำให้errorหาย |
| W08/D05 | A83–A85และUXE-01–27ผ่านintegrationพร้อมunknowncase/usability40+ | ตรวจผลstate/data/routeจริงควบคู่copy; ความเข้าใจผิดsaved/submitted/paidและrecovery successมีผลวัดตามD05 |

Next v0.9: ใช้error matrixร่วมกับD02/D06ในW00ก่อนimplementationที่เกี่ยวข้อง แล้วทำW01guardsและW02–W07ตามdependencyเดิม ไม่เพิ่มขั้นapprovalใหม่สำหรับข้อความทั่วไป; policy/permissionที่ยังเปิดอยู่คงgateเฉพาะactionที่พึ่งมัน งานเอกสารนี้ไม่ส่งข้อความลูกค้า ไม่แก้runtime และยังไม่มีผลusabilityจริง


ผลตรวจเอกสาร v0.9 (2026-09-17): PASS — `python3 /tmp/check-mangmee-retail-v09.py` ตรวจ A85/IG28/E25/D9/W9, UXE-01–27ครบและตรงcatalog, RC19 mapping, 187 local links/96 file-line targets/9 anchors, nine planned commands/14 existing test-path occurrences, dependency order/table consistency/Decimal/PDF boundary metadata. `git diff --check` ผ่าน. เป็นการตรวจเอกสารและtraceabilityเท่านั้น; application/API/DB/browser/AI/UX40+ testsยังNOT_RUN ไม่ปิดIG28จากการมีตารางข้อความ


### LINE ถามย้อนหลังถึงไฟล์หรือข้อผิดพลาด — v0.10, 2026-09-17

เพิ่มspec§17.5/A86–A88/IG29/E26–E27: botต้องอธิบายจากattemptจริงแม้ไฟล์ถูกปฏิเสธก่อนสร้างexpense และยอมรับว่าไม่รู้เมื่อไม่มีeventหรือค้นสถานะไม่ได้ ไม่ใช่เพิ่มpromptให้เดาสาเหตุจากแชต

- W00/D02/D06: ตัดสินsafe pre-capture diagnostic storage/retentionและpermission-checked queryจากevent/outcome/pendingเดิม; ระบุreason-stage/capability snapshot/currentstatus/actor+chat binding, target resolution และAPI/tool representationที่เล็กที่สุดก่อนcode
- W01: ข้อมูลlookupอยู่ใต้actor/company/chat/permission; restart/payloadscrub/retention/lateeventและrevisionต้องไม่ทำให้ตอบผิดไฟล์หรือเผยงานอื่น ไม่สร้างexpenseเพื่อเก็บerror
- W02: เปลี่ยนnull/coarse-errorจากdownload/validationเป็นtyped reasonที่persistได้ตามจริงทั้งก่อน/หลังเก็บไฟล์; reusependingcontextและper-attempt identity แยกnotfound/unavailable/expired-context/ambiguous
- W03/W04: reuseLINE status handlerและread-tool boundary; grounded human-language answerพร้อมsource/as-of, deterministic fallbackเมื่อAIไม่พร้อม และคำถามเลือกเป้าหมาย; คำถามเหตุผล/statusต้องไม่triggerOCR/retry/mutation
- W06/W07: ต่อactual claim/certificate/source stateที่อ่านได้ผ่านtoolsเดิมเมื่อคำถามอ้างงานนั้น; ไม่ใช้captureerrorลัดไปfinancialactionและไม่replaycreationเมื่อแจ้งผลไม่สำเร็จ
- W08: A86–A88ทดสอบrawrejectionก่อนexpense→ถามภาษาคน→scopedlookup→ตอบreasonและทางทำต่อ รวมfailure/noevent/unknown/ambiguous/providerdown/restart/cross-user; assertnoextraOCRcall/noexpensecreation/no financialmutationจากคำถามread-only

Next v0.10: ปิดD02/D06ส่วนdiagnosticตาม§17.5ร่วมกับerror UX v0.9 แล้วใช้W01–W08เดิม ไม่เพิ่มadmin/support channelหรือสิทธิ์อ่านrawlogsให้AI งานนี้ยังเป็นspec/planไม่มีการส่งข้อความจริงหรือเปลี่ยนruntime


ผลตรวจเอกสาร v0.10 (2026-09-17): PASS — `python3 /tmp/check-mangmee-retail-v010.py` ตรวจ A88/IG29/E27/D9/W9, UXE27และA86–A88/catalog,195 local links/104 file-line targets/9 anchors, nine planned commands/14 existing test-path occurrences, dependency/table/Decimal/PDF metadata. `git diff --check` ผ่าน. Read-only source traceยืนยันcoarse download failureและexisting expense-based status path; ไม่มีruntime reproduction, application/model/UX testsหรือการส่งข้อความLINEจริง ข้อกำหนดตอบย้อนหลังยังplanned


### อ่านไม่สำเร็จ → ลิงก์กรอกต่อบนเว็บ — v0.11, 2026-09-17

ผลตรวจของเดิมตาม spec §17.8: reuse `executeReceiptUpload` catch → `savedReceiptReplies` → `formatPaypersReply`, `UploadPanel`, `ExpenseReviewPage`/`ExpenseReviewEditSection`, pending-media completion และ `requestExpenseExtractionWithRecovery` ก่อนเสมอ ไม่เปิดงานสร้าง recovery handler หรือหน้ากรอกใหม่สำหรับ expense ที่มีอยู่แล้ว

คำตัดสินล่าสุดแทนข้อเสนอerror reread controls/textและmanual entryในLINEของv0.10: failed readingให้แจ้งเก็บไฟล์แล้วพร้อม **กรอกข้อมูลต่อ** ไปWebงานเดิมทันที ตามspec§17.6–17.7. ข้อเสนอเดิมยังไม่ได้implement จึงเปลี่ยนงานที่ต้องทำ ไม่ใช่การอ้างว่าลบfeatureในruntimeแล้ว

- W00/D02/D06: ระบุfailed/partial/persisted/unknownและsafe Web recovery targetสำหรับexpenseและpre-expense pending/capture; read-only GETไม่สร้าง/อ่าน/ส่งเบิก และปิดrouteของpendingก่อนเปิดใช้งาน
- W01/W02: เก็บoriginalและผูกงานก่อนบอกsaved; สร้างลิงก์จากserverorigin/targetที่ตรวจสิทธิ์ได้ ใช้หน้ารายการเดิมเมื่อมีexpenseId ไม่ลิงก์ไปฟอร์มว่าง/หน้าupload/listหรือpublicobject; เปิดซ้ำได้งานเดียว
- W03: เมื่อfailedแล้วไม่เริ่มOCRใหม่จากerror message/link/คำถาม; internal recoveryใช้เฉพาะงานเดิมที่ยังไม่terminalตามD02 รักษาpartialresults และไม่ใช้manual fallbackเลี่ยงการอ่านPDF10MiBปกติ
- W04: หน้าWebเดิมแสดงcurrentfile+partialfactsและช่องที่ขาด กรอก/บันทึกด้วยpermission/validation/provenanceเดิม; loginแล้วกลับtarget, mobileใช้ง่าย, deep linkเก่าหลังreplaceหรือlockต้องไม่แก้ผิดsnapshot; lateOCRไม่ทับhumanfacts
- W06/W07: รักษาclaim/certificate/funding locks; ไม่มีข้อมูลให้พัก/แนบเพิ่มในWeb ใบรับรองเฉพาะeligibility ไม่ใช่fallbackอัตโนมัติเมื่อOCRfail
- W08: ขยายA43/A64/A70/A74/A82–A88ด้วยLINE→same-work Web linkจริง, pendingก่อนexpense, saved/unsaved/unknown, partial/native/scanned/ordinary, login-return/mobile/permission/lock/replace/oldlink/repeatedclickและno newOCR/no newexpense. วัดUX40+ว่ากดแล้วกรอกต่อได้โดยไม่uploadหรือหารายการเอง

Next v0.11: ใช้Web manual recoveryเป็นscopeล่าสุดของ§17 ไม่มีงานเพิ่มปุ่มอ่านซ้ำหรือmanual-entry text handlerสำหรับerrorนี้. ตรวจspec/plan/catalog/memoryให้ไม่มีข้อเสนอเก่าเป็นข้อบังคับปัจจุบัน; implementationและruntime/UX proofยังpending

ขอบเขตที่ยังต้องทำหลังตรวจ handler เดิม:

- W02/W04: เชื่อม pending ที่ยังไม่มี expense ให้ไปกรอกบน Web โดยใช้ไฟล์เดิม จุดนี้ยังอยู่ใน clarification ของ LINE; reuse ขั้นตอน completion เดิมเมื่อผ่าน purpose/permission/source guards ไม่สร้าง expense อัตโนมัติให้ไฟล์ไม่ทราบประเภท และไม่อ้างว่ามี pending Web route แล้ว
- W03/W04: ปรับข้อความ/CTA ของ formatter และ dictionary เดิม; กำหนด terminal failure ให้ตรงกันแล้วปรับ `UploadPanel` ที่ยังออก new_request หลังบาง failed result รวมปุ่มอ่านซ้ำของ review ใน failed state โดยรักษา unknown-result recovery ด้วย requestId เดิม และการอ่านไฟล์ใหม่หลัง replace
- W08: ใช้ชุดทดสอบเดิมเป็นฐาน แก้ expectation เฉพาะพฤติกรรมที่เปลี่ยน และเพิ่มกรณี pending→Web/failed CTA ที่ยังไม่มี; ไม่เขียน test ซ้ำเพื่อยืนยันว่ามี form/link อยู่แล้ว PDF 10 MiB/หลายหน้าและ error reason ก่อนเก็บไฟล์ยังเป็นงานเดิม แยกจากการ reuse handler นี้

Verification ของการตรวจ reuse (2026-09-17): API existing tests 29/29 PASS ด้วย `pnpm exec tsx --test --test-reporter=spec --test-name-pattern='receipt owner summary and fallback|OCR governance LINE reply UX|receipt reliability: saved facts|audits a failed LINE receipt read|parks the bytes when the intake router' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` จาก `apps/api`; Web existing tests 54/54 PASS ด้วย `pnpm exec tsx --test --test-reporter=spec src/features/expenses/expense-upload.logic.spec.ts src/features/expenses/expense-capture-policy.spec.ts src/features/expenses/ExpenseReviewPage.qa.spec.ts` จาก `apps/web`. เป็น local tests ด้วย doubles และ source QA; ยังไม่ใช่ browser/E2E/LINE live/AI quality test และไม่มี application code change


ผลตรวจv0.11 (2026-09-17): PASS — `python3 /tmp/check-mangmee-retail-v011.py` ตรวจA88/IG29/E27/D9/W9, UXE27/catalog, Web-link recovery flagsและsame-work/persist/partial requirements, absenceของปุ่มอ่านซ้ำ/manualchatแบบเดิมในcurrent spec/plan,195 local links/104 line targets/9 anchors, nine planned commands/14 existing test paths, dependency/table/Decimal/PDF metadata. `git diff --check`ผ่าน. ตรวจพบrouteไฟล์หน้าexpenseเดิมจากrepository แต่ยังไม่ทดสอบbrowser/deep-link/login/pending/manualsaveจริง ไม่มีruntime/UI/UX change

## 12. เอกสารขนส่ง: discovery และชุดตรวจรับเพิ่ม — 2026-09-18

คู่กับ spec §18, [รายงานสำรวจ](../research/thai-courier-receipt-survey-2026-09-18-th.md) และ [catalog](../research/thai-courier-receipt-survey-2026-09-18.json). คง baseline v0.11/W00–W08; ไม่เปิดงานสร้าง upload/recovery/provider handler ใหม่. ช่องทางทางการ 7 เจ้าได้รับการตรวจ แต่ยังไม่ได้ latest specimen ทุกประเภทของทุกเจ้า. 11 records ไม่ใช่ 11 ใบเสร็จจริงที่ตรวจความแท้แล้ว และยังไม่ใช่ authorized golden corpus

| Case | งานที่ต้องทำใน packages เดิม | หลักฐานก่อนปิดเคส |
| --- | --- | --- |
| CC01 | W00/W02/W03/W04/W08: ใช้ document kind และ issuer/buyer/payer เดิม; แยก receipt ID กับ tracking | Positive/negative ของใบสั้น/เต็ม/ตัวแทน/label; ไม่มี field attribution จากโลโก้หรือที่อยู่ปลายทางอย่างเดียว |
| CC02 | W01/W02/W03/W08: grouping หลายพัสดุ/หลายหน้า/หลายเอกสารตาม manifest | ใบเดียวหลาย tracking และ summary/detail รวมยอดครั้งเดียว; หลายใบยังติด guard ก่อน finalization |
| CC03 | W03/W04/W08: reconciliation ของแถว/ท้ายใบ/discount/fuel/ภาษี/เงินทอน | Decimal golden assertions จากภาพที่ตรวจและมีสิทธิ; VAT treatment ตามบรรทัด ไม่ hardcode ตามบริษัท |
| CC04 | W00/W03/W04/W07/W08: แยกเงินสินค้า COD/declared value จากค่าบริการและ paid state | Negative examples ไม่สร้าง freight expense จาก principal/label; invoice ยังไม่ paid เมื่อไม่มีหลักฐานชำระ |
| CC05 | W01/W02/W05/W06/W07/W08: later full/electronic evidence และ replace/correction ใช้งานเดิม | คู่เอกสารจริงที่สัมพันธ์, stale jobs/locks, ไม่มี expense/claim/certificate/payment ซ้ำ |
| CC06 | W01/W03/W04/W07/W08: monthly/partial-paid/credit documents กับ source usage เดิม | ใบรวมกับใบย่อยไม่ใช้ยอดซ้ำ; วันครบกำหนดไม่แทนวันเอกสาร; ใบค่าบริการเพิ่ม tracking เดียวไม่ถูกตัดทิ้งผิด |
| CC07 | W00/W01/W03/W04/W08: D09 electronic provenance และภาษีศุลกากร/ค่าบริการ | Original/derivative/signature outcomes แยกจาก OCR และ payment/tax approval; ไม่มีการ fetch URL ในเอกสารโดยไม่มี guard |
| CC08 | W02/W03/W04/W08: LINE/upload/replace และ recovery §17.6 | PDF/native/scan/multipage ตาม D02, persisted failure→same-work Web, permission/login/revision, ไม่เริ่มอ่านใหม่จาก error link |
| CC09 | W04/W06/W08: review เดิมและใบรับรองเมื่อเข้าเกณฑ์ | ผู้ใช้ 40+ ส่งและกรอกต่อได้โดยไม่เลือกขนส่ง/รู้ศัพท์ภาษี; ไม่ทราบยอดพักได้ ไม่สร้างใบรับรองจาก OCR fail |
| CC10 | W00/W08: D05 corpus rights/freshness และ D09 originals | แยก guide/text-only/public copy/authorized fixture; actual document date/channel/issuer recorded; รายงาน coverage gap ตามจริง |

ลำดับงาน: W00 ปิดส่วน contract/fixture ของ D02/D05/D09 ที่เกี่ยวข้อง → W01 guards → W02 intake/replace/pending continuation → W03 extraction → W04 review และ W05–W07 ตาม dependencies เดิม → W08 ตรวจรวม. ตาราง A ที่เกี่ยวข้องอยู่ในรายงาน §6 และ catalog; เป็น acceptance ที่ต้องขยายด้วยกรณีขนส่ง ไม่ใช่การอ้างว่าชุดทดสอบเดิมครอบ CC แล้ว

งานวิจัยที่ยังเปิด: ขอ/รับเฉพาะเอกสารที่มีสิทธิของปี 2025–2026 ตามช่องทางจริง โดยเฉพาะ full ของ THP/KEX/Flash, actual specimens ของ J&T/SPX/SCG, current DHL และ signed originals. ห้ามใช้ปีแก้ metadata ของคู่มือแทนปี specimen; อย่านับทุกหน้าในชุดที่ยังไม่ได้ตรวจ หรือสร้างคู่ temporary/full ขึ้นจากคนละธุรกรรม. ไม่ขอเอกสารหรือส่งฟอร์มให้ผู้ให้บริการในรอบนี้

Scope/impact review: ตรวจ contract เดิมว่ามี per-line VAT/charges และ document kinds แล้ว; shipment references หลายค่าต้องประเมินใน D02 ก่อนเพิ่ม shape. ข้อสังเกต COD/duplicate/issuer/tax เป็นความเสี่ยงจาก specimen และ source review ยังไม่ใช่ runtime bug ที่ reproduce. PDF 10 MiB, multipage, pending→Web และ failed-state copy ยังเป็นงานเปิดตามเดิม การเพิ่ม courier survey ไม่ปิดงานเหล่านี้

Verification รอบ research: ตรวจภาพ 9 records และข้อความ 2 records, official channels และเลขคณิตตัวอย่าง; ตรวจ consistency ของ catalog/spec/plan/links ด้วย local checker. ไม่มี application/AI accuracy/UX40+ test ของ courier และไม่ใช้ผล API29/Web54 ของ audit handler เป็นผลรอบนี้. ขยายชุดทดสอบเดิมใน §8 เฉพาะ behavior ที่ต้องเปลี่ยนและเคส CC ที่ยังไม่มี เมื่อมี authorized fixtures; ไม่เพิ่ม test ที่ตรวจเพียงว่าชื่อแบรนด์หรือปุ่มอยู่ในไฟล์

ผลตรวจเอกสาร 2026-09-18: PASS `python3 /tmp/check-mangmee-courier-20260918.py` — 7 providers/19 sources/11 records/10 CC mappings, 12 Decimal equalities, 214 local links/114 line targets/9 anchors; PASS baseline `python3 /tmp/check-mangmee-retail-v011.py` — A88/IG29/E27/D9/W9, 217 local links/117 line targets/9 anchors. Scoped `git diff --check` ผ่าน และ checker ตรวจ whitespace ของ untracked research ด้วย. ตัวเลขนี้เป็นคุณภาพเอกสาร ไม่ใช่ OCR accuracy หรือ runtime readiness

### 12.1 LINE ตอบเอกสารอื่นและมีทางทำต่อ — owner approved 2026-09-18

คู่กับ spec §18.4: เพิ่ม NR01–NR09 เป็นเคสย่อยของ CC01/CC04/CC08/CC09 ภายใต้ W เดิม. Scope รวมใบปะหน้า ใบนำฝาก เอกสารการค้า ใบแจ้งหนี้ สลิป คำสั่งซื้อ เช็กบิล ภาพไม่เกี่ยวข้อง ชนิดไม่แน่ใจ และอ่านไม่สำเร็จ. การจำแนกได้ว่าไม่ใช่ใบเสร็จไม่ใช่ OCR failure; ไม่ปฏิเสธ invoice/slip/order ที่ผ่าน eligibility และไม่รับรองว่าเอกสารทุกประเภทถูกเก็บไว้แล้ว

| งาน | สิ่งที่ปรับโดยใช้ของเดิม | เกณฑ์จบ |
| --- | --- | --- |
| W00/D02/D06 | Map classification/evidence, financial purpose, persist outcome, current target/revision และ allowed actions ไป NR01–NR09; ระบุจุดที่ข้อมูลเดิมยังไม่พอแยก label/deposit | ไม่มี brand enum/handler ใหม่โดยไม่มีเหตุ; unknown kind ใช้ NR08; saved message/Web CTA ใช้ได้เมื่อ server ยืนยัน state และสิทธิ์ |
| W01/W02 | ต่อ reference ที่เข้า expense purpose/permission เข้ากับ pending media และ bind หลักฐานใหม่ในงานเดิม; ใช้ foundation ของ §17.6 | ไม่สร้าง expense placeholder เพื่อมี URL; duplicate event/reply, หลาย pending, persistence failure และ missing/expired media มีทางจบที่ไม่อ้าง saved เท็จ; รูปไม่เกี่ยวข้องไม่ถูกเก็บเป็น expense pending อัตโนมัติ |
| W03/W04 | ปรับ formatter/dictionary/notice เดิมตามชนิดและ state; ใช้ gate เดิมแยก invoice/slip/order ที่ไป review ได้; เปิด Web pending/review เดิม | ข้อความบอกชนิดจริงและสิ่งที่ขาด; ไม่ตอบ “ยังไม่ได้สร้างรายการ” ใน append/replace ที่มี expense; no-new-OCR สำหรับ error link; retained facts และ human edits ไม่ถูกเขียนทับ |
| W04/W06/W07 | ทาง “จ่ายแล้วแต่ไม่มีใบเสร็จ” ของ NR01–NR03 ไป Web งานเดิมและ eligibility ใบรับรอง; NR06 reuse check-bill payment choices/continuation | ไม่เพิ่มแบบกรอกหลายช่องใน LINE; คำตอบ paid ไม่แทน payment proof/อนุมัติใบรับรอง; lock/permission/correction และป้องกัน claim/payment ซ้ำยังผ่าน |
| W08 | เพิ่ม behavior cases NR01–NR09 ในชุดทดสอบเดิมและตรวจ LINE→Web/mobile กับ upload/replace | คำตอบตรง facts/state, ปุ่มทำต่อได้จริง, user 40+ แยกอ่านไม่ได้/เอกสารอื่น/เก็บร่าง/จ่ายเงินได้ และไม่มี financial mutation ที่ไม่ได้ยืนยัน |

Test trace ที่ต้องทำเมื่อ implement (ยังไม่รันในรอบเอกสาร):

- NR01/NR02: label/deposit ไม่มีหลักฐานจ่าย, tracking/COD/weight ไม่เป็น freight total; มีข้อมูลรับชำระรวมจริงให้ประเมินเนื้อหา ไม่ปฏิเสธจากชื่อหัวใบ. ตรวจ pending persist แล้วแนบหลักฐานเพิ่ม/เปิด Web งานเดิมได้
- NR03: quote/PO/delivery ที่ไม่พอเป็น expense evidence ไม่สร้าง draft; เอกสารรวม invoice/receipt ไม่ถูกปัดทิ้งจากคำว่าใบส่งของ. Generic link ต้องตรงงานและสิทธิ์
- NR04/NR05: invoice/slip/marketplace order ที่ผ่าน gate ยังไป review ได้; amount/party/payment ที่ไม่รู้ไม่เติมเอง ไม่เปลี่ยนชนิดเป็นใบเสร็จหรือให้ tax approval และไม่ใช้ COD principal เป็นค่าส่ง
- NR06: รักษา 3 payment choices เดิมและ pending identity, paid/no receipt ต้องผ่านหลักฐาน/eligibility เดิม; duplicate click/old answer ไม่สร้างหรือออกใบรับรองซ้ำ
- NR07/NR08/NR09: non-business, uncertain classification และ terminal failed/partial ให้คนละผล; saved/unsaved/unknown/running/cross-company/permission revoked มี copy/action ตามจริง. สำเร็จในการจำแนกเอกสารอื่นไม่ใช้ failed recovery; ไม่เริ่ม OCR ใหม่จาก error CTA
- ทุกกรณีที่มีงาน: pending/expense target, login-return, append/replace/current revision, locked source, late OCR, หลายงานและ replay อยู่ใน W08 เดิม. ตรวจ Web/LINE parity และ persisted originals จริง ไม่ใช้ snapshot ของข้อความเป็นหลักฐานเพียงอย่างเดียว

Reuse/impact: ขยาย `formatBusinessDocumentReply`, `formatCheckBillDecisionReply`, reference/clarify branches, `ensurePendingMedia`, expense eligibility และ Web review เดิม; Gateway ให้ผลอ่าน/จำแนก ส่วน API ตรวจสิทธิ์และตัดสิน mutation. ใช้ชุด `process-line-webhook.use-case.spec.ts` และ `expense-document.logic.spec.ts` เดิม รวม continuation/UI/E2E ที่เกี่ยวข้องเมื่อ behavior เปลี่ยน. ไม่ต้องสร้าง global error framework หรือ formatter แยกรายขนส่ง; ช่องว่างจริงคือ copy ที่ตรงเอกสารและ persisted reference→Web ซึ่งต้องพิสูจน์ก่อนเปิดใช้

ผลตรวจเอกสารส่วนนี้ 2026-09-18: PASS `python3 /tmp/check-mangmee-non-receipt-replies.py` — NR9/spec-plan-catalog/persist-and-reuse flags และ test paths เดิม 2 ไฟล์ (ไม่ได้รัน tests). Courier checker PASS 218 links/118 line targets; baseline v0.11 checker PASS A88/IG29/E27/D9/W9, 221 links/121 line targets; scoped `git diff --check` ผ่าน. ไม่มี application/AI/browser/LINE/UX verification หรือ implementation change ในรอบปรับ spec/plan
