# Expense running number: FlowAccount-style impact and E2E audit

> Historical audit before implementation. Latest implementation and local evidence: [verification report](../qa/evidence/expense-running-number-implementation-2026-09-11/README.md). Waiting-state/failure statements below describe that baseline.

Follow-up 2026-09-11: มี [ผลพิสูจน์บน local clone](../research/expense-running-number-proof-2026-09-11-th.md) และ [spec รอพัฒนา](../specs/expense-running-number-flowaccount-spec-th.md) แล้ว ข้อความ “ยังไม่ได้รัน” ด้านล่างเป็นสถานะตอนร่างเอกสารนี้ ไม่ใช่สถานะล่าสุดทุกกรณี
วันที่ตรวจ: 11 กันยายน 2569 (2026-09-11)

สถานะ: ตรวจและเสนอเงื่อนไขก่อนพัฒนา ยังไม่ใช่ spec ที่อนุมัติ และยังไม่ได้แก้ระบบเลข EXP

เพิ่มเติมตามคำขอผู้ใช้ 2026-09-11: [แผนร่าง migrate และ E2E ย้อนกลับรายจ่าย–ใบแทน–ใบเบิก](../plans/expense-running-number-migration-linked-e2e-draft-2026-09-11-th.md) จำแนกข้อมูลเดิม 8 กลุ่ม และเพิ่ม linked-flow acceptance L01–L16 รวม snapshot/hash compatibility และ rollback หลังมีเลขใหม่แล้ว

## ข้อสรุป

ทำให้ผู้ใช้ทำงานจบตั้งแต่รับเอกสารจนส่งบัญชีได้ แต่ข้อเสนอเดิมยังไม่พร้อมนำไป implement ตรง ๆ โดยเฉพาะจังหวะออกเลขร่าง การยืนยันที่ยังออกเลขอีกครั้ง การใช้เลขที่ลบไปแล้ว และการอ้างอิงบนใบแทนใบเสร็จที่พิมพ์ไปเซ็น

ควรใช้เดือนของ **วันที่เอกสารรายจ่ายที่ผู้ใช้ตรวจแล้ว** แยกจากวันที่จ่าย ออกเลขเมื่อบันทึกร่างสำเร็จครั้งแรก เก็บเลขเดิมเมื่อแก้วันที่/ยืนยัน/จ่าย และไม่คืนเลขอัตโนมัติ ส่วนการแก้เลขและใช้เลขที่เคยลบควรเป็นขอบเขตที่ตัดสินใจแยก เพราะกระทบทะเบียนเลขกลางและประวัติเอกสารหลายระบบ

ผลรอบนี้: ชุดทดสอบพื้นฐานเดิม 48 passed, 0 failed, 0 skipped; เปิดหน้าจอจริง 3 หน้า × 2 ขนาดได้โดยไม่ล้นจอ; จำลอง renderer แล้วพบว่าแบบพิมพ์ใบแทนสูญเสีย SRC เมื่อมี EXP จริง **ยังไม่ได้ทดสอบ E2E ของ logic ใหม่ เพราะยังไม่มี implementation** และยังไม่ได้ทดสอบกับผู้ใช้สูงวัยจริง

## ขอบเขตและหลักฐาน

- ตรวจ docs, contracts, model, allocator, draft/upload/OCR, LINE intake, reimbursement projection, confirmation, deletion, payment/ledger references, exports และหน้าจอ
- root checkout อยู่ที่ `a6608e17` และมีงานค้างของงานอื่นหลายชุด ใช้อ่านประกอบเท่านั้น ไม่เปลี่ยน code/config/data ของงานเหล่านั้น
- baseline ที่ใช้รัน unit/repository-mock tests และ renderer probe: `/tmp/mangmee-substitute-editable-navigation-20260910`, commit `a3bfed76309a207d242b9aa27bc6b11b4f9077e4`; งานนี้อยู่ใน `origin/main` ที่ `8f988a16` หลัง merge; `origin/develop` ที่ตรวจคือ `21fb6f67`
- browser smoke ใช้ local web `127.0.0.1:3000` และ API ที่ web เชื่อมอยู่ ขณะตรวจ process ใช้ checkout `/private/tmp/mangmee-substitute-step3-edit-20260910` ซึ่งมี local changes จึงไม่ใช่หลักฐาน Production
- source code findings ด้านล่างแยกข้อเท็จจริงที่ตรวจพบออกจากความเสี่ยงเมื่อเพิ่ม feature; ไม่ถือว่า docs เก่าที่เขียน Proposed เป็นพฤติกรรมที่ใช้งานได้แล้ว

## สิ่งที่ยืนยันได้จาก FlowAccount และข้อจำกัด

1. คู่มือ expense บนมือถือระบุว่าเลขสัมพันธ์กับวันที่เอกสารที่เลือก วันที่เริ่มต้นเป็นวันนี้และแก้ได้ และมีการถ่ายบิลเก็บไว้กรอกภายหลัง [คู่มือบันทึกค่าใช้จ่าย](https://flowaccount.com/help-center/category/mobile-app/mobile-expense)
2. กลไกปรับเลขตามวันที่ย้อนหลังทำก่อนบันทึก หลังบันทึกไม่ใช้กลไกนี้เปลี่ยนเลขอัตโนมัติ [เอกสารย้อนหลัง](https://flowaccount.com/help-center/category/customize-template/backdated-document)
3. เลขที่ลบถูกข้าม มีการแก้เลขด้วยมือและประวัติเลขก่อน/หลัง [การแก้เลขเอกสาร](https://flowaccount.com/help-center/category/customize-template/custom-docserial)
4. เอกสารทางการเรื่องลบยังขัดกัน: [คู่มือทั่วไป](https://flowaccount.com/help-center/category/customize-template/delete-document) ระบุ EXP ในกลุ่มลบเลขกลางได้ แต่ [คู่มือลบค่าใช้จ่าย](https://flowaccount.com/help-center/category/expense/delete-expense) ยังอธิบายลบจากเลขล่าสุด ไม่ควรอ้างว่าได้ยืนยัน permission/status ทุกแบบของ FlowAccount EXP แล้ว

ฉะนั้น “แบบ FlowAccount” ในรายงานนี้หมายถึงหลักการวันที่เอกสาร/เลขต่อเนื่อง/ไม่คืนอัตโนมัติ ส่วนจุดออกเลขร่าง สิทธิ์แก้เลข เอกสารที่เซ็นแล้ว และข้อยกเว้นของระบบเราเป็นข้อเสนอที่ต้องกำหนดเอง ไม่ใช่ข้อเท็จจริงจากการทดสอบบัญชี FlowAccount จริง

## Findings ที่ต้องปิดก่อนพัฒนาและปล่อยใช้

P1 = กระทบความถูกต้องหรือทำให้ flow สำคัญจบผิด; P2 = UX/ขอบเขต/ข้อมูลเก่าที่ต้องกำหนดใน spec ไม่ควรปล่อยให้ implementation เดา

| ID | ระดับ / หลักฐาน | สิ่งที่พบและผลกระทบ | เงื่อนไขที่เสนอ |
| --- | --- | --- | --- |
| F01 | P1 · code + UI | `InitReceiptUploadUseCase` สร้าง ExpenseRecord ก่อนส่งไฟล์/OCR สำเร็จ ดังนั้น “DRAFT ทุกแถวมีเลข” กับ “อัปโหลดเฉย ๆ ยังไม่ออกเลข” ขัดกันในโมเดลปัจจุบัน | กำหนดรับไฟล์ไว้ก่อน กับบันทึกร่างที่ตรวจวันที่แล้วให้ชัด อาจใช้ metadata/สถานะย่อยเดิม ไม่จำเป็นต้องสร้างอีกระบบ เก็บ ID และไฟล์เดิม ผู้ใช้ยังค้นคืนได้ |
| F02 | P1 · code | `ConfirmExpenseUseCase` ยัง reserve EXP ทุกครั้งจากเดือน UTC ณ เวลายืนยัน แล้วเขียนทับ expenseNumber หากเพิ่มเลขตอนร่างอย่างเดียวจะออกสองเลข/เปลี่ยนเลขเมื่อยืนยัน | draft save และ confirm ต้องใช้เลขเดียวกัน confirm ออกเลขเฉพาะ legacy ที่ผ่านกฎรองรับจริง ไม่เปลี่ยนเลขตามเวลาปัจจุบัน |
| F03 | P1 · code | manual create เขียน header ก่อน resolve/upsert lines และมี cleanup เมื่อผิดพลาด; confirm แยก finalize กับ commitNumber เป็นคนละ transaction มีช่วงที่ผลธุรกิจกับทะเบียนเลขอาจไม่ตรงกันเมื่อบางขั้นล้ม | บันทึกข้อมูลร่างที่ยอมรับแล้ว+ผูกเลขสำเร็จเป็นหน่วยเดียว ใช้ transaction helper เดิม คืนผลซ้ำอย่างปลอดภัยเมื่อ response หาย ห้ามถือว่ากดอีกครั้งคือเอกสารใหม่ |
| F04 | P1 · schema | DocumentNumber unique รวมทุกสถานะ แม้ CANCELLED/VOIDED; ลบ ExpenseRecord ไม่ทำให้เลขว่างในทะเบียนกลาง จึงใช้เลขที่ลบแล้วแบบ manual ไม่ได้ตามข้อเสนอเดิม | ระยะแรกแนะนำยังไม่ใช้เลขเก่าซ้ำ หากต้องการต้องออกแบบประวัติการครอบครองเลขและ active uniqueness โดยเฉพาะ EXP ห้ามถอด unique ของเลขเอกสารทุกชนิด |
| F05 | P1 · reproduced | renderer แบบ paper ใช้ `expenseNumber ?? documentNumber` ในช่องอ้างอิง เมื่อใส่ EXP แล้ว SRC หายจากเนื้อหาแบบพิมพ์; paper PDF path ยังปิด footer ที่ใส่ ID ไฟล์มีชื่อ SRC แต่กระดาษไม่มี | แสดงสองช่องชัดเจน: เลขใบแทน SRC และเลขรายจ่าย EXP ตรวจภาพ PDF/กระดาษจริงและรับไฟล์เซ็นกลับให้ตรง evidence/version |
| F06 | P1 · code + design risk | ใบแทนมี frozen paper snapshot ตั้งแต่ดาวน์โหลดก่อนเซ็น การเปลี่ยนเลขภายหลังอาจทำให้กระดาษ, snapshot/hash, รายการและหลักฐานคนละเลข | ไม่ล็อกเฉพาะตอนเซ็นหรือโพสต์บัญชี ต้องครอบคลุมเอกสารที่ถูกออก/ส่ง/พิมพ์แล้ว หรือใช้ flow แก้ไขที่ยกเลิกแบบเดิมชัดเจน ห้ามเขียนทับไฟล์ประวัติ |
| F07 | P1 · code | รายจ่ายสร้างจาก manual, upload, LINE pending-media และ materialize รายการเบิกได้คนละทาง แก้เฉพาะปุ่มเว็บจะตกหล่น | กำหนด issuance event ทุกช่องทาง ใช้ allocator เดียว; หนึ่งแหล่งข้อมูลที่ retry ต้องได้ expense ID เดิมและ EXP เดิม รายการเบิกไม่สร้าง EXP เพิ่มจากการ reconcile ซ้ำ |
| F08 | P1 · code | DeleteExpense มีสิทธิ์/branch/status/payment/linked data guards และมีใบแทนแม้ PREPARED ก็ retention lock; ยังไม่มีการเปลี่ยน DocumentNumber เมื่อ hard-delete รายจ่ายที่มีเลข | คง guards ไว้ การมีเลขไม่ใช่สิทธิ์ให้ลบ แจ้งเหตุผลและเอกสารที่ติดอยู่ ปรับทะเบียนเลขกับ audit ใน transaction เดียวและไม่ลด counter |
| F09 | P1 · code + proposed feature gap | ยังไม่มี expense renumber API/contract/สิทธิ์เฉพาะ; เลขปรากฏใน export, LINE, bank match display, journal document references และใบแทน | หากทำ manual edit ต้องมีสิทธิ์ฝั่ง server, branch scope, expected version, reason, before/after, stable ID, freeze boundary และรูปแบบอักขระที่ปลอดภัยกับ PDF/Excel/ชื่อไฟล์ |
| F10 | P1 · existing date review + design risk | OCR อาจผิดเดือน/ปี อ่านวันที่ออกบิลแทนวันจ่าย หรือมาช้าหลังผู้ใช้แก้แล้ว; upload เริ่มด้วยวันนี้และ LINE มี placeholder date | ให้ตรวจวันที่เอกสารกับภาพก่อนออกเลข ไม่เอา placeholder หรือ OCR ที่ยังไม่รับรองเป็นฐานถาวร ใช้ provenance/date-review เดิม OCR ภายหลังห้ามทับค่าที่ผู้ใช้ยืนยัน |
| F11 | P1 · allocator + design risk | retry ข้ามเดือน/เปลี่ยนสาขาอาจส่ง idempotency key เดิมด้วย period ต่างและชน; บันทึกพร้อมกัน/กดสองครั้ง/สองแท็บต้องไม่ออกเลขซ้ำ | ผูก retry กับ logical save เดิมและ period ตอนออกเลข ไม่คำนวณใหม่จากวันที่ปัจจุบัน ทดสอบ concurrency ด้วย DB จริงและ rollback กลางทาง |
| F12 | P2 · UI + API | ค้นหาในรายการทำกับข้อมูลที่โหลดตามเดือนส่งเข้าระบบ ขณะที่เลขใหม่เป็นเดือนเอกสาร เช่น EXP-202608 อาจอยู่ในรายการรับเข้า ก.ย.; เลขที่อยู่นอกเดือนเลือกค้นไม่พบ | รักษา intake list เดิม ระบุว่าค้นในช่วงไหน และให้ค้นเลขข้ามช่วงได้ภายใต้สิทธิ์เดิม ต้องค้นเจอแม้เดือนในเลขไม่ตรงเดือนหน้าจอ |
| F13 | P2 · UI code | รายการแสดง `firstFilled(expenseNumber, vendorDocumentNumber)` ช่องเดียว พอร่างมี EXP เลขบิลร้านค้าจะไม่แสดงในตำแหน่งเดิม ทั้งที่ยังมีข้อมูล | แสดง “เลขรายจ่าย” กับ “เลขใบเสร็จร้านค้า” แยก ไม่ให้ผู้ใช้คิดว่า OCR เปลี่ยนเลขบิล การตรวจเอกสารซ้ำยังใช้บิลต้นทาง/หลักฐานตามเดิม |
| F14 | P2 · model + history | มีรายจ่ายเก่าเลข null และเลขที่ออกจากเดือนยืนยัน ส่วน SRC บางใบออกก่อนเปลี่ยนกฎเดือนจ่ายแล้ว; DRAFT อาจมี SRC ที่เซ็นแล้วหรือใบเบิกที่ตรึง source อยู่ | ไม่ renumber/backfill ประวัติอัตโนมัติ ร่างเก่าที่ตรวจวันที่แล้วและไม่มี frozen/active dependencies อาจรับเลขเมื่อบันทึกภายใต้กฎใหม่ กลุ่มที่ผูกเอกสารและรายการยืนยันเก่าใช้ migration policy แยกตามแผนเพิ่มเติม |
| F15 | P1 · accounting boundary | เลขร่างทำให้ผู้ใช้เข้าใจผิดว่า “ลงบัญชี/จ่ายแล้ว”; เลขเดือนเดิมอาจไม่ตรงวันที่แก้ภายหลัง; ระบบตรวจงวดบัญชี/ภาษีจาก expenseDate ไม่ใช่ prefix | การออก EXP ไม่เปลี่ยนสถานะ ภาษี ยอดเงิน หรือวันลงบัญชี รายงานใช้วันที่ของรายงานนั้น ๆ คง period lock และทดสอบว่า draft ไม่หลุดเข้าเอกสารที่ยืนยันแล้ว |
| F16 | P2 · shared allocator | ค่าเริ่มต้น EXP เป็นรายบริษัท ถ้าไม่มี `{BRANCH}` ต้องไม่แยก counter รายสาขา; มี config padding/reset/template เดิม | ห้ามเริ่มเลขใหม่ทับของเก่าเมื่อเปลี่ยน config/เดือน/สาขา ระบุ cutover รองรับของเดิม ตรวจหลายบริษัท เดือนใหม่ สิ้นปี และเลขเกิน padding |

ไม่มีการกล่าวว่าความเสี่ยงทุกข้อเกิดกับข้อมูลผู้ใช้แล้ว: F05 ทำซ้ำได้จริง ส่วนข้ออื่นระบุ code fact และเงื่อนไขที่ต้องป้องกันเมื่อเพิ่ม logic ใหม่

## Flow ที่เสนอให้ผู้ใช้ทำงานจบ

1. **รับไฟล์/เริ่มกรอก** — ระบบเก็บไฟล์ที่รับสำเร็จและรายการอ้างอิงเดิมไว้ เปิดกลับมาทำต่อได้ ยังไม่จอง EXP เพราะแค่เปิดหน้า/เริ่ม upload; ถ้าไม่ทราบวันจ่ายก็เก็บงานได้
2. **ตรวจข้อมูลร่าง** — แสดงวันที่เอกสารพร้อมภาพต้นทาง สำหรับ manual ใช้วันนี้เป็นค่าเริ่มต้นที่เห็นและเปลี่ยนได้ สำหรับ OCR แสดงว่าเป็นค่าที่อ่านมา ผู้ใช้ตรวจวันที่ก่อนบันทึกร่าง ไม่ต้องรอข้อมูลภาษีครบ/ผู้อนุมัติ/การจ่ายเงิน
3. **บันทึกร่างครั้งแรกสำเร็จ** — ออก EXP ของเดือนวันที่เอกสารและผูกกับ expense ID เดิมครั้งเดียว แจ้ง “บันทึกร่างแล้ว · เลขรายจ่าย … · ยังไม่ลงบัญชี” ถ้า save ไม่สำเร็จอย่าแสดงว่าได้เลขจริงแล้ว
4. **กลับมาแก้ไข/ตรวจ/ทำใบแทน** — วันที่หรือข้อมูลเปลี่ยนแล้วบันทึกได้ตามสิทธิ์เดิมโดยเลขไม่เปลี่ยน Step 1→2→3→ย้อนกลับต้องคงข้อมูลและเลข หากมีแบบไปเซ็นแล้วใช้การแก้ไข/ยกเลิกแบบเดิมที่ชัดเจน
5. **ยืนยัน/จ่าย/ส่งบัญชี** — ใช้ EXP เดิมตลอด; SRC เป็นเลขอีกชนิดและอาจคนละเดือน; ยอดและวันจ่ายอิง payment จริง การยืนยันไม่เท่ากับ ledger posting สำเร็จ ต้องตรวจผลปลายทางด้วย
6. **ยกเลิก/ลบ** — ลบเฉพาะที่ผ่าน guards และสิทธิ์ ส่วนที่มีบัญชี/เงิน/ใบแทนใช้ทางจัดการเดิม เลขไม่กลับเข้าคิว มีประวัติให้ตามช่องว่างได้ เอกสารอื่นไม่เลื่อนเลข

ตัวอย่าง: วันที่เอกสาร 31 ส.ค. 2569, บันทึก 11 ก.ย. 2569 → `EXP-202608-00001`; จ่าย 15 ก.ย. ไม่เปลี่ยน EXP; ถ้ามีใบแทนที่ใช้เดือนจ่าย SRC อาจเป็น `SRC-202609-…` ซึ่งไม่ใช่เลขผิด

ถ้า OCR อ่าน 31 ส.ค. แต่จริงเป็น 1 ก.ย.: แก้ก่อนบันทึกครั้งแรกจะออกเดือน ก.ย. หากแก้หลังมีเลขแล้ว วันที่จริงต้องแก้ได้ตามสถานะโดยเลขเดิมไม่เปลี่ยนเอง แสดงข้อความว่าเลขถูกออกไว้ก่อนแก้วันที่ ห้ามบังคับให้ผู้ใช้ใส่วันที่ผิดเพื่อให้ตรงเลข

หากวันเอกสารยังไม่รู้ ให้เก็บงานรับเข้าไว้และบอกว่ายังรอตรวจวันที่ ไม่สร้างวันที่จริงปลอมเพื่อให้ได้ EXP นี่เป็นจุดที่ต้องตกลงให้ชัดหากคำว่า “ทุกฉบับร่างมีเลข” หมายถึงทุกแถวใน DB ตั้งแต่เริ่ม upload ด้วย

## ผลต่อแต่ละมุมมอง

| มุมมอง | สิ่งที่ต้องทำได้ | จุดที่ไม่ควรทำ |
| --- | --- | --- |
| นักบัญชี | แยก EXP/SRC/เลขบิลร้านค้า; ค้นได้ทั้งเลขเดิมและประวัติ; อธิบายเลขขาด; แยกวันเอกสาร/วันรับเข้า/วันจ่าย; export กับบัญชีอ้างอิงรายการเดียวกัน | ใช้เดือนในเลขแทนงวดบัญชี/ภาษี; ลงรายการร่างเข้ายอดยืนยัน; ลบหลักฐานหรือแก้ reference ของงวดปิดโดยตรง |
| ผู้ใช้ทั่วไป | ถ่ายรูปหรือกรอก → ตรวจวันที่ → บันทึก → หาเจอ → ทำต่อ เห็นชัดว่ายังต้องทำอะไรและใครทำต่อ | ต้องตั้งเลขเอง เลือกเดือนรันเอง หรือเข้าใจคำว่า sequence/idempotency ก่อนใช้ได้ |
| ผู้ใช้สูงวัย/ไม่ถนัดเทคโนโลยี | วันแบบไทยอ่านง่าย ภาพหลักฐานขยายได้ ปุ่มหลักเด่น ข้อผิดพลาดชี้ช่องที่แก้ ข้อมูลไม่หายเมื่อย้อนกลับ/อินเทอร์เน็ตสะดุด | สรุปบันทึกสำเร็จด้วยสีอย่างเดียว ซ่อนเหตุผลใน tooltip ใช้ดินสอเล็ก ๆ เป็นทางเดียว หรือแสดงเลขยาวแทนชื่อร้านกับยอด |
| UX/UI | หนึ่งปุ่มหลักในแต่ละช่วง สถานะรับไฟล์/ร่าง/รอยืนยัน/จ่ายแล้วต่างกัน เลขมี label ชัด คัดลอกได้โดยไม่เข้าฟอร์มแก้ | ขึ้นเลขคาดการณ์เหมือนเลขจริงก่อน save; ให้เลือกรับเลขใหม่เพียงเพราะแก้วันที่; หายจากรายการเมื่อ backdate |
| BA | ระบุ issuance event และ owner ของทุกช่องทาง รวมถึงรายการเบิก; state/exception table; cutover legacy; เงื่อนไขลบและแก้เลข | เอาสถานะ Awaiting ของอีกผลิตภัณฑ์มาเท่ากับ raw DRAFT ของเราโดยไม่ดู journey |
| SA | transaction, uniqueness, tenant/branch, retry, source version, immutable ID, outbox, historical artifacts และ shared allocator ต้องสอดคล้อง | ลด counter, `MAX(เลขที่ยังอยู่)+1`, เปลี่ยน PK เป็นเลขมนุษย์อ่าน, ถอด unique กลางหรือสร้าง allocator อีกชุดสำหรับเว็บ |

### UX ที่ควรตรวจเป็นพิเศษ

- ใช้คำ “วันที่เอกสาร” ให้สอดคล้องกัน ตอนตรวจพบ manual ใช้ “วันที่ค่าใช้จ่าย” และ upload ใช้ “วันที่ในใบเสร็จ”; ต้องไม่ทำให้สับสนกับวันจ่าย
- ตัวเลขปีไทยบนปฏิทินเป็น 2569 แต่ EXP ตัวอย่างใช้ 2026; ไม่ต้องให้ผู้ใช้แปลงปีเองหรืออ่านรูปแบบ `YYYYMM` เพื่อรู้ว่าบันทึกสำเร็จ
- หน้ารับไฟล์ปัจจุบันใส่วันนี้ พร้อมคำแนะนำว่าใช้วันที่ที่พิมพ์บนใบเสร็จ; อย่าให้ค่าเริ่มต้นดูเหมือน OCR ตรวจแล้ว
- ใน mobile ที่ตรวจ input หลักเป็น 16px แล้ว แต่ helper หลายจุดเล็ก/สีอ่อน เลขใหม่และเหตุผลที่ทำต่อไม่ได้ต้องอ่านได้ ไม่ฝังไว้ในคำอธิบายจาง ๆ
- กำหนดเป้าหมายปุ่มหลักอย่างน้อย 44×44 CSS px เป็นข้อเสนอเพื่อการใช้งานของเรา; WCAG 2.5.8 AA กำหนดขั้นต่ำ 24×24 พร้อมข้อยกเว้น ไม่ใช่ 44 เสมอ [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- ต้องทดสอบขยายข้อความ 200% โดยข้อมูลและฟังก์ชันไม่หาย รอบนี้ยังไม่ได้ตรวจข้อนี้ [W3C resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
- เลขยาวควรดูเต็ม/คัดลอกได้, ชื่อร้านและยอดยังเด่น, error คงข้อมูลที่กรอกและปุ่มกลับไปแก้; กรณี response หายให้ตรวจผลเดิม ไม่สร้างรายการใหม่เงียบ ๆ
- ถ้าไม่มีใบเสร็จและยังไม่จ่าย อนุญาตเก็บร่าง แต่การรับรองว่าได้จ่ายเงินจริง/หลักฐานตาม policy อาจยังทำไม่ครบ ต้องบอกสิ่งที่รอ ไม่กรอกวันจ่ายแทนผู้ใช้เพื่อผ่าน step
- การกลับมาแก้เอกสารที่ยืนยันแล้วมี spec ที่ยังเป็น Proposed อยู่ อย่าสัญญาว่า “กลับไปแก้ได้ทุกสถานะ” จนกว่าจะตรวจ implementation และ flow ที่อนุมัติจริง

## Acceptance E2E ที่ต้องผ่านหลังมี implementation

ตารางนี้เป็นแผนตรวจที่ยังต้องรัน ไม่ใช่ผลผ่าน

| กลุ่ม | กรณีสำคัญ | ผลที่ต้องพิสูจน์ |
| --- | --- | --- |
| Intake | เปิดหน้า/ยกเลิกเลือกไฟล์/upload เริ่มแล้วล้ม/OCR ล้ม | ไม่กิน EXP เพราะแค่เปิดหน้า ไฟล์ที่รับสำเร็จกลับมาทำต่อได้ ไม่มี orphan ที่หลอกว่า save สำเร็จ |
| Draft | manual ไม่รู้วันจ่าย; OCR ตรวจวันที่; LINE รับรูป | ทุกเส้นทางบันทึกร่างที่มีวันเอกสารรับรองแล้วได้ EXP ครั้งเดียวโดยไม่ต้องจ่ายก่อน |
| Date | สิ้นเดือน, ก่อน 07:00 ไทย, 31 ธ.ค.→1 ม.ค., พ.ศ./ค.ศ., วันที่อนาคต/อ่านไม่ได้ | ใช้ civil document date ที่ตรวจแล้ว ไม่หลุดเดือนเพราะ UTC ไม่เดาวันที่ที่ไม่ทราบ |
| OCR correction | ผิดเดือนก่อน/หลังออกเลข; OCR ส่งผลช้าหลังคนแก้ | ก่อน save ใช้วันที่แก้ หลัง save เลขคงเดิม ค่าที่ผู้ใช้รับรองไม่ถูก OCR ทับ |
| Retry | double click, lost response หลัง commit, reload/back, สองแท็บ | expense ID/number เดิม, 1 allocation, ไม่มี paid record หรือ outbox ซ้ำ |
| Concurrency | ผู้ใช้หลายคนบันทึกพร้อมกัน, เดือนใหม่พร้อมกัน, save ชน delete/edit | ไม่ซ้ำ ไม่ overwrite และผล conflict มีทางแก้ ต้องใช้ DB จริง ไม่ใช่ mock อย่างเดียว |
| Scope | สองบริษัท/หลายสาขา/สาขาถูกเพิกถอนสิทธิ์ | เลขไม่ข้ามบริษัท; global prefix ไม่สร้างเลขชนกันระหว่างสาขา; error/search ไม่เปิดเผยข้อมูลนอกสิทธิ์ |
| Failure | lines validation fail, allocation disabled, transaction timeout, ledger consumer retry | ไม่ให้ผลสำเร็จครึ่งเดียว; ไม่คืน/ลด counter; downstream failure แยกจาก draft save failure |
| State | DRAFT→review→READY→CONFIRMED→partial/full payment→VOIDED | EXP เดิมทุกจุด; early number ไม่ข้ามหลักฐาน/permission/period lock; void ไม่ทำให้เลข reusable |
| Correction | วันที่/ยอด/หมวดเปลี่ยน; source version stale | optimistic concurrency; อนุมัติ/ลายเซ็นที่ต้องตรวจใหม่ reset ตาม flow เดิม; ไม่เปลี่ยน EXP เอง |
| Substitute | step 1→2→3→ย้อน 2/1; digital/paper; โหลดแบบไปเซ็นแล้วแก้ข้อมูล | ข้อมูล/ไฟล์/EXP คงอยู่; SRC และ EXP ปรากฏแยก; upload scan ตรวจถูก version และปฏิเสธแบบเก่าถ้า invalidated |
| Deletion | ลบเลขกลาง/ท้าย; ลบไม่ผ่านเพราะจ่าย/ใบแทน/บัญชี; retry delete | เลขอื่นไม่ขยับ รายการใหม่ใช้เลขถัดไป เลขที่ลบตรวจประวัติได้และไม่มี owner ที่ดูเหมือนยัง active |
| Manual renumber (ถ้าอยู่ใน scope) | ไม่มีสิทธิ์, ชนเลข active/เก่า, ตัวเลขสูง/ต่ำ, เปลี่ยนเดือน, input ผิดรูปแบบ | server enforce กฎเดียวกับ UI, before/after/reason, counter ไม่ถอย, ฟอร์ม/ไฟล์/การค้นหาไม่อ้างผิดรายการ |
| Reimbursement | approve หลายบรรทัด, projection retry/reconcile | source line หนึ่งมี expense หนึ่ง/EXP หนึ่ง; RB กับ EXP คนละหน้าที่; ไม่มีการบันทึกค่าใช้จ่ายหรือจ่ายซ้ำ |
| Accounting | ยืนยันแล้วรอโพสต์, โพสต์สำเร็จ, งวดปิด, ภาษีล็อก | ตรวจ journal และ source references จริง จำนวนเงิน/บัญชีคงเดิม, debit=credit, เลขเดือนไม่เปลี่ยนงวดบัญชี |
| Export/search | เลข EXP ส.ค.รับเข้า ก.ย.; ค้นข้ามเดือน/หลายหน้า; original vendor no. | หาได้จากเลข/ร้าน/เลขบิลตามสิทธิ์ วันที่และสถานะใน export ตรงวัตถุประสงค์ ไม่เปลี่ยนเลขของไฟล์เก่า |
| Migration/config | ร่างเก่า/ยืนยันเก่าเลข null/เลขเดิม, custom prefix, padding overflow, rollback runtime | ไม่ backfill เงียบ ๆ ไม่ใช้เลขเก่าซ้ำ runtime เก่าต้องไม่ overwrite EXP ที่ runtime ใหม่สร้าง |
| Usability | mobile/desktop/200%/keyboard; ผู้ใช้สูงวัยถ่ายบิล→แก้วัน→บันทึก→ค้นคืน→ส่งต่อ | ทำได้โดยไม่ต้องเข้าใจ running number; บอกได้ว่าบันทึกแล้วหรือยังและต้องทำอะไรต่อ ไม่มีข้อมูลหาย |

ชุด automated E2E เดิมใน `e2e/expenses.spec.ts` มี upload, confirm, date visibility, payment retry อยู่แล้ว แต่หลายกรณี require `S3_E2E=1` และ MinIO; ส่วน `e2e/substitute-editable-navigation.spec.ts` ใน baseline worktree เป็น opt-in `SUBSTITUTE_NAVIGATION_LIVE=1` และต้องมี DB/ลายเซ็นทดสอบแยก ยังไม่มีชุดพิสูจน์ early EXP/manual reuse ตามข้อเสนอใหม่นี้

การทดสอบเต็มต้องมี DB/tenant และที่เก็บไฟล์ทดสอบแยก, roles owner/accountant/staff/viewer, receipt fixtures ที่ตั้งใจให้วันผิด/หาย, รองรับจุดฉีด failure และตรวจปลายทางหลัง background jobs จบ การผ่าน browser ที่มี response mock อย่างเดียวไม่พอจะรับรอง concurrency/ledger/retention

สำหรับ usability ให้ผู้ใช้เป้าหมายลองงานจริงโดยไม่บอกตำแหน่งปุ่ม: บิลย้อนหลังหนึ่งใบ, ไม่รู้วันจ่าย, แก้ OCR ผิดเดือน, ค้นงานที่เพิ่งบันทึก, กลับไปแก้ข้อมูลก่อนเซ็น บันทึกจุดลังเล/ต้องขอความช่วยเหลือ/บันทึกซ้ำ การตรวจโดยวิศวกรแทนการลองกับผู้ใช้ไม่ได้

## การตรวจที่รันแล้ว

1. Baseline tests จาก worktree `a3bfed76`:

```sh
node --import tsx --test \
  apps/api/src/modules/data-model-core/domain/logic/document-sequence.logic.spec.ts \
  apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.spec.ts \
  apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts
```

ผล 48 passed, 0 failed, 0 skipped; log `/tmp/expense-number-audit-baseline-tests.log` เป็น logic/repository-mock tests ไม่ใช่ real DB concurrency

2. Read-only browser smoke `/tmp/expense-number-audit-ui.cjs`: หน้า manual/upload/list ที่ 1440×1000 และ 390×900 รวม 6 page/viewport checks ผ่าน ไม่มี horizontal overflow; ไม่มี business mutation request (`blockedWrites: []`); login เฉพาะ session ของการตรวจ ผล `/tmp/expense-number-audit-ui.log`, screenshots `/tmp/expense-number-audit-{manual,upload,list}-{1440,390}.png` ไม่ได้กดบันทึก จ่าย ลบ เซ็น หรือออกเอกสารให้ผู้ใช้

3. Renderer probe `/tmp/expense-number-audit-render.ts`: synthetic snapshot เดียวกัน ก่อนมี EXP พบ SRC ในเนื้อหา หลังใส่ `EXP-202608-00001` พบ EXP แต่ไม่พบ SRC ยืนยัน F05 โดยไม่เขียน DB; ผล SVG `/tmp/expense-number-audit-paper-with-exp.svg` ไม่ได้ render PDF ใหม่ในรอบนี้

4. Read-only local API ของตัวอย่างจากภาพเดิมพบรายจ่ายยัง DRAFT และ `expenseNumber:null` ทั้งที่มี SRC แล้ว ยืนยันว่าเลข EXP ตั้งแต่ร่างยังไม่ใช่พฤติกรรมปัจจุบัน ไม่ใช้ผลนี้อ้างสถานะ Production

## Code/doc anchors สำหรับพัฒนาต่อ

- `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`: CreateExpenseDraftUseCase, UpdateExpenseDraftUseCase, ConfirmExpenseUseCase
- `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts`: InitReceiptUploadUseCase และ upload completion
- `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts`: date review/provenance
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`: createReceiptDraftFromPendingMedia
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts`: expense projection creation
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.ts`: reserveNumberInTransaction, commitNumberInTransaction, cancelReservation, voidNumber
- `apps/api/prisma/schema.prisma`: ExpenseRecord, DocumentSequence, DocumentNumber
- `apps/api/src/modules/expenses/application/use-cases/delete-expense.use-case.ts`: DeleteExpenseUseCase
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts`: renderSubstituteReceiptSvg และ EXP/SRC fallback
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`: freezePaperForm และ unsigned form download
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt-pdf.logic.ts`: omitPageFooter
- `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`, `domain/logic/expense-export.logic.ts`: exports/filename references
- `apps/api/src/modules/banking/infrastructure/prisma-match-source.query.ts`: bank matching display reference
- `apps/api/src/modules/ledger/application/use-cases/journal.use-case.ts`: expense journal document references
- `apps/web/src/features/expenses/ExpensesPages.tsx`: load/filter/search, EXP/vendor number fallback
- `docs/specs/expense-upload-date-visibility-spec.md`: intake period และ document period; ตรวจ runtime เพิ่มเพราะ export behavior มีการเปลี่ยนต่อจาก spec นี้
- `docs/specs/expense-confirmed-return-for-correction-spec.md`: Proposed; ห้ามถือว่า correction loop implemented แล้ว
- `docs/agent-memory/expense-evidence-record-navigation-numbering.md`: original confirm-time number policy / legacy null policy
- `docs/agent-memory/substitute-number-payment-month-2026-09-10.md`: SRC payment-month policy ซึ่งต้องแยกจาก EXP document-month

## ข้อเสนอสำหรับตัดสินใจรอบถัดไป

1. เลือกจังหวะ “บันทึกร่างที่ผู้ใช้ตรวจวันที่แล้ว” เป็นจุดออก EXP; งานรับไฟล์ค้างยังบันทึกและค้นคืนได้โดยไม่มี EXP ก่อนจุดนั้น
2. คงเลขเมื่อแก้วันที่ ไม่คืนเลขจากการลบ; เอกสารเก่าไม่ถูกจัดเลขใหม่อัตโนมัติ
3. แนะนำเริ่มจากระบบออกเลขอัตโนมัติที่ครบทุกช่องทางก่อน ส่วน manual renumber/ใช้เลขลบซ้ำให้พิจารณาเป็น scope แยก ถ้าต้องการพร้อมกันต้องรวม F04/F06/F09 และ acceptance ที่เกี่ยวข้องตั้งแต่ spec
4. แสดง EXP และ SRC แยกบนแบบพิมพ์ พร้อม label เลขบิลร้านค้าแยกบนหน้าจอ
5. ต้องมี spec/plan ที่ปิด state, permissions, cutover และ failure semantics ก่อน code และมี E2E ใหม่ผ่านจริงก่อนประกาศใช้งานได้ครบ

ยังไม่มีการ implement, commit, merge หรือ deploy เรื่องเลขรายจ่ายในรอบ audit นี้
