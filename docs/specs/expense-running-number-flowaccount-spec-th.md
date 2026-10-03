# Spec: เลขรายจ่าย EXP ตั้งแต่บันทึกร่าง และเส้นทางรายจ่าย–ใบแทน–ใบเบิก

วันที่: 2026-09-11
สถานะ: **IMPLEMENTED — LOCAL VERIFICATION COMPLETE; RELEASE VALIDATION PENDING**
เจ้าของ: thawatchai / Codex

ผู้ใช้อนุญาต 2026-09-11 ให้ปรับ spec แก้จุดที่พบและเริ่ม implement จริง ดำเนินการแล้วบน branch `codex/expense-running-number-20260911` ดู [ผล implement และหลักฐานล่าสุด](../qa/evidence/expense-running-number-implementation-2026-09-11/README.md) ชุดหลัก merge เข้า develop/main แล้ว ผู้ใช้สั่งให้เปิด flag เป็นค่าเริ่มต้นในรุ่นถัดไป เพื่อไม่ต้องเปิดเองหลัง deploy; ยังไม่มีการ deploy หรือเปลี่ยน customer gates

## 1. ผลพิสูจน์ระบบเดิมก่อน implement (ประวัติ)

**ยังรับรองว่า “ไม่มีเส้นทางใดติด” ไม่ได้** ระบบเดิมมีเส้นทางย้อนกลับที่ทำงานจริง มีข้อจำกัดตามสถานะ และมีช่องว่างที่ต้องแก้ก่อนเปิด EXP ตั้งแต่ร่าง

หลักฐาน: [รายงานพิสูจน์](../research/expense-running-number-proof-2026-09-11-th.md), [ไฟล์ผลทดสอบ](../qa/evidence/expense-running-number-2026-09-11/README.md)

- PostgreSQL จริงผ่าน 57 กรณี: expense edit 31, funding 7, reimbursement race/source 16 และ migration compatibility เดิม 3; อีก 6 กรณีเป็น sequence logic/repository mock ต้องไม่นับเป็น DB จริง
- API จริงพิสูจน์ source → RB → reject/reopen → resubmit → finance NEEDS_INFO → resubmit → approve → pay/retry → void ได้ จากนั้น GET ยืนยันผลแล้ว cancel ได้ โดยคง RB และไม่จ่ายต้นทางซ้ำ
- void payment ซ้ำตอบ 422 `Payment is already voided` แม้ครั้งแรกสำเร็จ เป็นช่องว่างการรับมือ response หาย; ผู้ใช้ยังกลับมาทำต่อได้เมื่ออ่านสถานะล่าสุด
- source วันที่ 22 ส.ค. 2026 ทำให้ projection ที่ยืนยัน 11 ก.ย. ได้ `EXP-202609-00001` ระบบยังไม่ได้อิงเดือนเอกสารตาม target นี้
- ใส่ EXP ในข้อมูลเข้า paper renderer แล้วเลข SRC หายจากเนื้อหาจริง และเติม EXP ในสำเนา source snapshot เก่าแล้ว approval hash เปลี่ยนจริง
- browser baseline ยังไม่ผ่านทั้งชุด: 2 ผ่าน / 8 ไม่ผ่าน มี test contract ผิด, local launch attestation ไม่ตรง build และหน้าโหลดค้างที่ยังไม่แยกสาเหตุ ห้ามใช้ชุดนี้เป็นหลักฐานว่า UI ใช้งานจบ
- ยังไม่มี migration/implementation ของ EXP policy ใหม่ จึงยังไม่มีผล E2E หลัง migrate ของ feature นี้

## 2. เป้าหมายและขอบเขต

ผู้ใช้ทั่วไปหาและอ้างอิงรายจ่ายได้ตั้งแต่บันทึกร่าง นักบัญชีตรวจลำดับเลขและรอยแก้ไขได้ เลขไม่เปลี่ยนเมื่อ OCR แก้วัน ยืนยัน จ่าย เปิดย้อนดู หรือกลับรายการ เอกสารใบแทน SRC และใบเบิก RB ที่เชื่อมอยู่ต้องคงตัวตนเดิม

ใช้หลักจาก FlowAccount เรื่องวันที่เอกสารและไม่คืนเลขอัตโนมัติ ตาม [research เดิม](../research/expense-running-number-flowaccount-impact-audit-2026-09-11-th.md) รายละเอียดการออกเลขร่าง การแก้เลข และข้อจำกัดเอกสารเซ็นเป็นข้อกำหนดของเรา ไม่อ้างว่าเทียบระบบ FlowAccount สดครบทุกกรณี

ขอบเขต v1 ที่เสนอให้ใช้พัฒนา:

- ออก EXP ที่ **บันทึกร่างครั้งแรกโดยผู้ใช้ตรวจวันที่เอกสารแล้ว** ไม่ใช่ทันทีที่สร้างแถว DB จาก upload intent
- คงเลขเมื่อแก้ข้อมูล ไม่คืนเลขอัตโนมัติ ไม่เปิดแก้เลขด้วยมือหรือใช้เลขที่เคยออกซ้ำใน v1
- ครอบคลุม manual, upload/OCR, LINE และรายจ่ายจากใบเบิก ด้วยขอบเขตความหมายเดียวกัน
- รักษาข้อจำกัดด้านผู้รับเงิน ภาษี งวดบัญชี และสิทธิ์เดิม ไม่เพิ่มสิทธิ์ด้วยการมีเลข EXP
- การเปิดรองรับผู้สำรองจ่ายที่ไม่มีบัญชีผู้ใช้เป็นงานนโยบายแยก ต้องมีข้อยุติก่อนอ้างว่ารองรับเส้นทางนั้น

## 3. กฎเลขและวันที่

| ID | ข้อกำหนด |
| --- | --- |
| N01 | ใช้เดือนของ `expenseDate` ที่ผู้ใช้ตรวจและบันทึกครั้งแรก แปลงเป็น civil date ตามกฎ timezone ของบริษัท ไม่ใช้เวลาบันทึก/confirm/UTC slice/วันที่ OCR รันเป็นเดือนเลข |
| N02 | วันที่จ่ายเป็นอีก field ไม่อนุมานว่าจ่ายแล้วจากวันที่เอกสาร และไม่บังคับวันที่จ่ายเพื่อบันทึกร่างรายจ่ายธรรมดา ใบแทนหรือการจ่ายจริงยังต้องครบตามกฎของขั้นนั้น |
| N03 | ตัวอย่าง template เดิม `EXP-YYYYMM-00001`; ใช้ DocumentSequence เดิม ขอบเขต company/branch ต้องตรงกับ template ที่แสดง branch ได้ ห้ามสร้าง counter แยก branch แล้วพิมพ์เลขเหมือนกันใน company เดียว |
| N04 | เลขเกิดพร้อมการบันทึกร่างที่สำเร็จเท่านั้น การเปิดหน้า preview, upload ที่ยังไม่สำเร็จ, OCR callback, validation fail, Back/Next ที่ไม่มีการเปลี่ยนข้อมูล ไม่จองเลข |
| N05 | เมื่อมี EXP แล้ว confirm/pay/reopen/edit/แก้วันข้ามเดือนต้องใช้เลขเดิม ตรวจเจ้าของเลขให้ตรง expense ID; ห้าม reserve แล้วเขียนทับอย่างปัจจุบัน |
| N06 | กดซ้ำ response หาย หรือ worker retry ต้องกลับไป expense ID/EXP เดิม Idempotency scoped tenant + operation; key เดิม payload ต่างต้อง conflict และยังรักษาข้อมูลเดิม |
| N07 | สร้างร่าง + lines + ผูกทะเบียนเลขเป็น transaction เดียว หรือใช้รูปแบบ atomic เดิมที่พิสูจน์ผลเทียบเท่าได้ ไม่มี successful expense ที่เลขไม่มีเจ้าของ ไม่มีเลข committed ที่ชี้ร่างสร้างไม่สำเร็จ |
| N08 | ลบ/ยกเลิกไม่ decrement counter ไม่เติมช่องว่าง ไม่ย้ายเลขเอกสารอื่นมาแทน เก็บเหตุการณ์ยกเลิกและเจ้าของเดิมตามโครงสร้าง audit/registry เดิม |
| N09 | การจัดเลข concurrent ใน company/month เดียวต้อง unique และ retry ได้ตามกฎเดิม ไม่สร้าง abstraction หรือ dependency เพิ่มหาก transaction/sequence ที่มีทำได้ |

ก่อนบันทึกครั้งแรก OCR เป็นข้อเสนอ เมื่อวันที่ไม่ชัดให้เก็บในรายการ “รอตรวจวันที่เอกสาร” พร้อมไฟล์เดิม ผู้ใช้เปิดกลับมาแก้ได้ หากผิดหลังมีเลขแล้ว ให้แก้วันผ่านสิทธิ์/สถานะที่อนุญาตโดยคง EXP และแสดงข้อความธรรมดาว่าเลขออกแล้วจึงคงเดิม

## 4. สถานะและทางไปต่อที่ต้องมี

| สถานการณ์ | พฤติกรรมและทางไปต่อ |
| --- | --- |
| รับไฟล์/OCR ยังไม่เสร็จ | เก็บ ID/ไฟล์/ข้อมูลที่กรอกไว้ แสดงสถานะให้ค้นคืนได้ ยังไม่มี EXP; retry extraction ไม่สร้างรายจ่ายใหม่ |
| บันทึกร่างครั้งแรก | ตรวจวันเอกสารและฟิลด์ขั้นต่ำเดิม แล้วออกเลขพร้อมบันทึก ถ้าไม่ผ่านให้อยู่ฟอร์มพร้อมข้อมูลและชี้ field ที่ต้องแก้ |
| ย้อน SRC step 3 → 2 → 1 | แสดงค่ารายจ่ายจริงและข้อมูลหลักฐานเดิม; การดูอย่างเดียวไม่เปลี่ยน source timestamp, number, revision หรือ signature |
| แก้ SRC ก่อน ISSUED | ใช้ edit/revision flow เดิม การแก้ facts ที่กระทบลายเซ็นทำให้ตรวจและเซ็นใหม่ โดยเก็บ revision/scan เดิม; no-op ไม่ล้างลายเซ็น |
| SRC ออกแล้ว/จ่ายแล้ว/โพสต์แล้ว | ห้ามเปิดแก้ต้นทางโดยอาศัยปุ่ม Back ต้องใช้ cancellation/correction/reversal ที่ระบบรองรับจริง อย่าสัญญาว่าทุกสถานะคืน DRAFT ได้ |
| SRC ยกเลิกแล้ว | view-only ไม่มี “จัดทำฉบับแก้ไข” หรือ mutation ที่ชุบฉบับยกเลิกกลับมา; เปิดดูข้อมูล/ไฟล์/ประวัติได้ตามสิทธิ์ |
| RB ยังร่าง source เปลี่ยน | บอกว่าข้อมูลต้นทางเปลี่ยน มีปุ่มโหลดข้อมูลล่าสุดให้ตรวจใหม่ คงข้อความที่ผู้ใช้เป็นเจ้าของและ RB ID/เลข ไม่ submit snapshot เก่า |
| RB ส่งแล้ว source ถูกล็อก | API ปฏิเสธการแก้ตาม guard; UI ระบุเลข RB ที่ล็อกและผู้/บทบาทที่ทำต่อได้ ลิงก์เปิดได้เท่าที่มีสิทธิ์ ถ้าไม่มีสิทธิ์ไม่ทำลิงก์เสียให้คลิก |
| RB REJECTED / finance NEEDS_INFO | ใช้ reopen/คืนร่างที่รองรับ คง RB/EXP เดิม ต้องตรวจและรับรองข้อมูลชุดใหม่ก่อน resubmit ไม่สร้าง projection ซ้ำ |
| RB READY_FOR_PAYMENT | การแก้ต้องผ่าน flow ที่รองรับ; cancellation ต้องจัดการ projection ครบก่อนจบ ถ้าบางรายการล้ม ให้แสดง pending และ retry รายการเดิม |
| RB PAID | ใช้ void payout ตามสิทธิ์/งวด แล้วโหลดสถานะล่าสุดก่อนขั้นถัดไป ไม่แก้ยอดต้นทางแทนการกลับรายการ |
| void ซ้ำหลัง response หาย | เป้าหมายคือคืนผลสำเร็จเดิมโดยไม่ reversal ซ้ำ หรือ client อ่าน detail แล้วยืนยันว่า payment เดิม VOIDED และแสดงผลสำเร็จ ต้องไม่ทิ้งผู้ใช้กับ 422 อย่างเดียว |
| งวดปิด | คงข้อมูลเดิมและแจ้งเหตุพร้อมทางดำเนินการที่ระบบบัญชีอนุญาต ห้ามเปิดงวด/ย้ายวันที่/ใช้สิทธิ์ admin อัตโนมัติเพื่อให้ flow ผ่าน |
| paper ไม่ผูกผู้สำรองจ่าย | แจ้งตั้งแต่เลือกวิธี/ผู้รับเงินว่าเบิกต่อไม่ได้จนระบุบุคคลที่ตรวจสอบได้ ห้ามเดาจากชื่อหรือคนอัปโหลด; ไม่ถือว่าจบ E2E ของผู้ไม่มีบัญชีแล้ว |

การปิดงานหนึ่ง action ตามกฎไม่ได้แปลว่าทั้ง flow ต้องติด UI ต้องอธิบาย “ทำอะไรต่อ ที่ไหน โดยใคร” อย่างชัดเจน ปุ่ม disabled ต้องมีเหตุผล และทุก mutation ยังตรวจ server-side

## 5. ความสัมพันธ์ เอกสารพิมพ์ และบัญชี

- EXP ต้นทาง, SRC evidence และ RB request เป็นคนละเลข ใช้ ID/FK เชื่อม ไม่ parse prefix หรือจับคู่จากเลข/ยอด/ชื่อ
- `linkedExpenseId` ของ source-backed RB line ยังชี้รายจ่ายต้นทาง ส่วนรายจ่ายที่สร้างจากใบเบิกใช้ company/request/line tuple เดิม รายจ่ายนี้มี EXP ของตัวเอง ห้ามนำ EXP ต้นทางมาใช้แทน
- Projection แต่ละบรรทัดใช้วันที่ที่ตรวจแล้วของบรรทัดนั้น และคงเลขเมื่อ materialize/finance retry; source คนละเดือนใน RB เดียวไม่ถูกเหมาเป็นเดือน header
- เงินพนักงานจ่ายร้านและเงินบริษัทคืนพนักงานต้องแยกกัน การจ่าย RB ไม่สร้าง ExpensePayment อีกชุดบน source และไม่ confirm source ซ้ำเป็นค่าใช้จ่ายบัญชีครั้งที่สอง
- Paper/downloaded signing form ต้องแสดง **เลขใบแทน SRC** และ **เลขรายจ่าย EXP** คนละช่อง ชื่อไฟล์อย่างเดียวไม่ใช่หลักฐานบนกระดาษ ตรวจ rendered PDF จริงก่อน acceptance
- ห้ามเปลี่ยน frozen paper form, signed scan, checksum หรือ approval snapshot เก่าเพื่อเติมเลขแสดงผล หากต้องแก้เอกสารใช้ revision/correction flow ที่มีประวัติชัดเจน
- Source snapshot v1 เดิมไม่เพิ่ม EXP ย้อนหลัง เพราะพิสูจน์แล้วว่าทำ hash เปลี่ยน การแสดง EXP ปัจจุบันให้แยกจาก “ข้อเท็จจริง ณ ตอนส่ง/เซ็น” และห้ามให้ display-only backfill ทำคิวอนุมัติเก่า stale
- การ reopen ต้องล้างสิทธิ์ใช้ลายเซ็นเก่ากับข้อมูลใหม่ แต่ประวัติที่ต้องเก็บยังค้นคืนได้ ห้ามอ้างว่าเก็บครบเพียงเพราะ bytes ยังอยู่ใน storage ต้องพิสูจน์การเข้าถึงประวัติจริง

## 6. Migration และ rollback

ใช้ [แผน A–H และ L01–L16](../plans/expense-running-number-migration-linked-e2e-draft-2026-09-11-th.md) เป็นรายละเอียด ข้อกำหนดตัดสินสำหรับ v1:

1. คง EXP ทุกเลขที่มีอยู่แล้ว รวม void/cancelled; reconcile ทะเบียนเลขโดยรายงานกรณีไม่ตรง ห้ามแก้ด้วยการ renumber หมู่
2. ไม่ backfill null EXP ทุก DRAFT อัตโนมัติ Raw upload/OCR ยังรอตรวจเก็บ null ได้ ข้อมูลเดิมที่มี frozen paper/SRC/signature/active RB ให้คง snapshot และเข้า compatibility path
3. ข้อมูลเก่า null EXP ยังค้นจากวันที่ ร้าน ยอด SRC/RB และ stable link ได้ ใช้ข้อความ “รายการเดิมยังไม่มีเลขรายจ่าย” ไม่ใส่เลขปลอมจาก suffix ของ ID
4. จะให้เลขกับ legacy ที่ยังไม่ผูกหลักฐานได้เมื่อผู้ใช้บันทึกโดยชัดแจ้งและผ่านกฎ N01–N09 เท่านั้น ไม่ออกเลขเพราะเปิดอ่าน/คืนร่างเฉย ๆ
5. ถ้า legacy ที่มี dependency ต้องออก EXP เพื่อทำขั้นต่อไป ให้ implementation ระบุ compatibility branch อย่างชัดเจนและพิสูจน์ hash/artifact เดิมไม่เปลี่ยน หากยังพิสูจน์ไม่ได้ต้องปิดเฉพาะการ rollout ใหม่ ไม่ทำข้อมูลเก่าใช้งานต่อไม่ได้
6. inventory ต้องแยก source-backed relation จาก legacy projection relation ห้ามตีความ linkedExpenseId แบบเดียวทุกยุค
7. Counter เริ่มเหนือเลขที่เคยออกทั้งหมด ไม่ใช่ MAX เฉพาะ active; replay/backfill resume ไม่ตัดเลขซ้ำ
8. Reader และ writer ทุกทางต้องรองรับมีเลข/ไม่มีเลขก่อนเปิด flag ออกเลขร่าง รวมคิว LINE/OCR และ browser เก่าที่ค้างอยู่
9. Rollback ใช้ได้เฉพาะ runtime ที่รักษาเลขที่ออกแล้ว โค้ดเก่าที่ confirm แล้ว reserve/overwrite เสมอเป็น rollback target ที่ใช้ไม่ได้
10. Rehearsal ต้องเทียบ ID, tenant, links, amount, payment/journal counts, retained JSON/hash/ไฟล์ก่อน–หลัง และผ่าน approve/pay/void/cancel ของข้อมูลเก่าจริง ไม่ใช่แค่ migrate exit 0

Migration ใหม่เพิ่ม nullable draft identity 2 columns และ unique index เท่านั้น ซ้อมบนสำเนาฐานข้อมูล local แล้ว 13 ตารางมีข้อมูลเดิมเท่าเดิม ไม่มี backfill ส่วน full production cohorts/old browser/worker ต้องผ่าน release validation ตามรายงานล่าสุด

## 7. UX/UI สำหรับผู้ใช้ทั่วไปและผู้สูงวัย

- แสดง “วันที่เอกสาร” และ “วันที่จ่าย” คนละ label พร้อมตัวอย่าง ไม่ให้จำคำว่า fiscal period หรือ allocation
- เห็น EXP ชัดเมื่อบันทึกสำเร็จ มี copy action ไม่แทรก popup ทุกครั้งที่กด Back
- หน้ารายการบนจอใหญ่ใช้หัวคอลัมน์แรก “เลขรายจ่าย” แยกจากผู้ขาย/หมวดหมู่ แสดงเลขเต็มและใช้ “ยังไม่มีเลขรายจ่าย” เมื่อยังไม่ออกเลข จอเล็กกว่า 1280px ใช้การ์ดโดยวางชื่อประเภทและเลขเต็มก่อนชื่อผู้ขาย; เลขยาวตัดบรรทัดได้ ไม่ใช้ ellipsis ซ่อนเลข
- กรณี OCR แนะนำวันผิด ให้แก้ตรง field พร้อมเก็บข้อมูลอื่นไว้; ข้ามเดือนหลังมีเลขใช้คำอธิบายสั้น ไม่เปิด dialog ที่ดูเหมือนบันทึกไม่ได้
- แสดง SRC/EXP/RB พร้อมชื่อประเภทและสถานะ ไม่แสดงเลขสามชุดลอย ๆ ใช้ปุ่ม “ดู” เดียวเมื่อพิมพ์เปิดสิ่งเดียวกัน
- Source ที่ถูกล็อกต้องเห็นข้อมูลได้ ปุ่มแก้แสดงเหตุและทางไป RB ตามสิทธิ์ ต้องไม่วนกลับมาหน้าเดิมโดยไม่อธิบาย
- Error โหลด/บันทึกมี retry รักษาข้อมูลที่พิมพ์; retry action ที่สำเร็จแล้วแสดงผลจาก server ไม่สร้างรายการใหม่
- Acceptance ต้องตรวจ desktop 1440, mobile 390, keyboard/focus, ขยายข้อความ 200%, ขนาดปุ่มหลักเป้าหมาย 44 CSS px และการใช้งานจริงกับคนที่ไม่คุ้นระบบ/ผู้สูงวัย บันทึกผลจริงก่อนรับงาน ไม่อ้างผลอัตโนมัติแทน usability test

## 8. รายการแก้และเกณฑ์ก่อนเปิดใช้งานเต็มรูปแบบ

| งาน | เกณฑ์ที่ต้องผ่านก่อนรับ |
| --- | --- |
| P1 ออกเลขร่างทุก entry point | manual/upload/LINE/projection ใช้เดือนวันที่เอกสารและ atomic/idempotent; OCR ผิดวัน/ปี พ.ศ. และขอบเดือน Bangkok ไม่ทำเลขผิดโดยเงียบ |
| P1 Confirm compatibility | มี EXP แล้วไม่ reserve/overwrite; response หายหลัง commit retry ได้เลขเดิม; legacy มี dependency ทำงานต่อได้ |
| P1 Paper identity | PDF ที่มีทั้ง EXP/SRC อ่านได้จริง กระดาษเก่า/ไฟล์เซ็นกลับเชื่อม version ถูก โดยไม่เขียนทับประวัติ |
| P1 Migration/rollback | cohorts A–H และ L12–L14 ผ่านบน DB/storage จริง ทั้ง old snapshot, old writer/job/browser; counter/amount/hash unchanged ตามกฎ |
| P1 Linked reverse flow | L01–L16 มีผลครบแยก UI/API/DB/ledger; จ่าย/กลับรายการ/ยกเลิกไม่ซ้ำ รวม failure injection ระหว่างหลาย projection และงวดปิด |
| P2 Recovery UX | 422 already-voided ไม่เป็นหน้าตัน ตรวจสถานะและทำต่อได้; ล็อก source มีคำอธิบาย/ลิงก์ตามสิทธิ์ |
| P2 Test harness | ส่งเฉพาะ fields ของ UpdatePolicy DTO, จัด approver ให้ตรง frozen role, เตรียม schema/gate/build และแก้เหตุ browser loading ก่อนเรียก E2E green |
| Scope decision | กำหนด beneficiary สำหรับ paper/no-account ก่อนเปิดเส้นทางนั้น; ไม่เปิด manual renumber/reuse ใน v1 |

เกณฑ์รวม: ไม่มี blocker ที่ไม่ระบุทางต่อในขอบเขตที่ประกาศรองรับ ไม่มีการข้าม permission/source/period guard เพื่อให้ test ผ่าน และหลักฐานต้องมาจาก commit/runtime/schema เดียวกับรุ่นที่จะรับงาน

## 9. สถานะถัดไป

พัฒนา v1 และตรวจ local integration แล้วตามรายงานล่าสุด ผู้ใช้อนุญาตให้เปิดออกเลขร่างเป็นค่าเริ่มต้นเมื่อไม่ได้กำหนด environment flag (2026-09-11) ระยะถัดไปเป็นการตรวจ release ตามข้อมูลและ environment ที่จะเปิดจริง ไม่อ้างว่า live LINE/OCR, ผู้ใช้สูงวัยจริง หรือทุก cohort ใน Production ผ่านแล้ว


## 10. แนวแก้ที่กำหนดก่อน implement (2026-09-11)

- ใช้ `PrismaDocumentSequenceRepository.reserveNumberInTransaction/commitNumberInTransaction` เดิมผ่าน helper ของรายจ่ายใน transaction ที่ caller ถืออยู่ ไม่สร้าง sequence service อีกชุด
- Manual create บันทึก header/lines/เลข/audit ใน transaction เดียว เพิ่ม optional client idempotency key และ nullable key/hash บน ExpenseRecord โดย unique ต่อ company; raw upload/LINE intake ยังคง staging ไม่มีเลข สร้าง migration แบบเพิ่ม columns เท่านั้น ไม่มี backfill snapshots หรือเลขย้อนหลัง
- Key เดิมต้อง replay expense เดิมเฉพาะ actor/payload เดิม; ถ้ารายจ่ายถูกลบแล้วให้รายงานว่าลบแล้ว ไม่สร้างใหม่จาก retry เลขที่เคยใช้ยังอยู่ใน DocumentNumber
- Update draft ออกเลขเมื่อมี explicit reviewed date ในการบันทึก ไม่ใช้ OCR callback หรือปุ่ม preview; LINE ใช้วันที่รับรองจากผู้ใช้โดยตรงตาม provenance ที่มีอยู่ ไม่ใช้ AI/OCR inference ออกเลขเอง
- Legacy null EXP ที่มี SRC evidence หรือ source reference ใน RB ยังคงไม่มีเลขเมื่อแก้ร่าง; confirm ภายใต้ guard เดิมสามารถผูกเลขแสดงผลได้ใน transaction โดยไม่แก้ retained snapshot/artifact
- Confirm allocator ย้ายเข้า finalize transaction, อิง expenseDate และใช้เลขเดิม เมื่อมีเลขแต่ registry เก่าหายให้คงเลขเดิมโดยไม่ตีความว่าเป็นของใหม่; ถ้าพบ registry ที่เป็นเจ้าของคนละรายการให้ conflict ชัดเจน
- Projection จากใบเบิกออกเลขพร้อม materialization ของแต่ละ line และไม่สร้างซ้ำใน retry
- การออกเลขตอนร่างเปิดเป็นค่าเริ่มต้นเมื่อไม่มี `EXPENSE_DRAFT_NUMBERING_ENABLED` หรือกำหนด `true` ตามคำสั่งล่าสุดของผู้ใช้; กำหนด `false` เพื่อปิดได้ โดย confirm compatibility ทำงานเสมอ; ปิด flag ไม่ลบ/เปลี่ยนเลขที่ออกแล้ว และไม่อนุญาต rollback ไป writer ที่ overwrite เลขเดิม
- Allocator ต้องข้ามเลขที่ถูกใช้แล้วในทะเบียน/ExpenseRecord สำหรับ expense.record โดยไม่ลด counter และไม่แก้เลข legacy เพื่อแก้การชน
- Void payout retry คืน detail ล่าสุดหลังตรวจ tenant/branch/permission; concurrent retry ต้องไม่สร้าง reversal/audit/outbox ซ้ำของ successful mutation
- เก็บ rendering fix แยกสองเลขทุก form โดยไม่ rerender/overwrite frozen historical files อัตโนมัติ ตรวจ PDF จริงใน local test
- ซ่อม E2E harness ให้ตรง DTO/approver และใช้ isolated checkout ที่ติดตั้ง dependencies จริงเพื่อแยก browser loading จาก symlink/build prerequisites; ไม่ปิด assertions เพื่อให้ผ่าน
- paper/no-account payer ยังไม่เปิด eligibility ใหม่ เพิ่มข้อความบอกข้อจำกัดก่อนเริ่มทำโดยไม่เดาตัวตน; เป็นขอบเขต v1 ที่ประกาศชัดเจน

Implementation checklist และหลักฐานใช้ [แผนพัฒนา](../plans/expense-running-number-implementation-2026-09-11-th.md)

### เพิ่มเติมจาก implement และการทดสอบจริง

- การกลับรายการจ่ายต้อง commit payment/request/projection/reversal/ทะเบียน JV/audit/outbox ใน transaction เดียว การปิดงวดหรือเขียน outbox ล้มเหลวต้อง rollback ทั้งหมด; replay ตรวจสิทธิ์ก่อนคืนผลเดิม
- พบลิงก์ LINE `/reimbursements/:id` แต่เว็บมีเฉพาะ drawer `?focus=:id` เพิ่ม route redirect ไป drawer เดิมที่ตรวจสิทธิ์ ไม่สร้างหน้ารายละเอียดหรือ permission model ใหม่
- Manual save ที่ไม่ได้รับผลตอบกลับต้อง retry payload เดิมจนทราบผล เปิดรายการเดิมเพื่อตรวจแก้ต่อ ห้ามใช้ key เดิมกับ payload ใหม่หรือเปลี่ยน key แล้วสร้างซ้ำเพียงเพราะเน็ตขาด
- Custom EXP template ที่ไม่มีเดือนต้อง serialize namespace ระดับบริษัท ไม่ให้ counter คนละเดือนแข่งสร้างเลขตัวเดียวกัน

- คง Serializable isolation ของ confirmation/void ตามเดิม และ retry เฉพาะ P2034 ที่ฐานข้อมูล rollback แล้ว (สูงสุด 5 attempts) เพื่อรองรับคำขอพร้อมกันโดยไม่ลดการป้องกัน race กับงวด/ข้อมูลต้นทาง; callback ไม่มี external side effect

- เมื่อตรวจเลขนำเข้าเก่าที่ไม่มีทะเบียน ใช้เลขสูงสุดจาก ExpenseRecord และ DocumentNumber ทุกสถานะที่ตรงรูปแบบเดียวกันเป็นฐานของ counter ไม่เติมช่องว่างก่อนเลขเก่า; ทดสอบ legacy 00100 แล้วเลขใหม่เป็น 00101
- Manual retry ในหน้าที่ยังเปิดอยู่ใช้คำสั่งเดิม แม้ผู้ใช้ล้างช่องที่บังคับก่อน retry ก็ต้องตรวจผลเดิมต่อได้; แนบไฟล์ด้วยสาขาของรายจ่ายที่ server คืนมา
- การเก็บคำสั่งข้าม refresh/ปิดแท็บและ idempotency ของ client รุ่นเก่าที่ไม่ส่ง key ยังไม่ได้เพิ่มใน v1 นี้ ให้เปิดรายการรายจ่ายเพื่อตรวจผลเดิมก่อนสร้างใหม่; ไม่อ้าง retry guarantee ข้าม session

## Responsive KPI follow-up (2026-09-11)

ยอดบนการ์ดปรับขนาดตามพื้นที่ 18–26px; การ์ดแคบวางไอคอนเหนือยอด และยอดยาวมากขึ้นบรรทัดได้โดยไม่ตัดหรือย่อจำนวนเงิน ตาราง KPI รายจ่ายใช้ห้าคอลัมน์ตั้งแต่ 1536px เพื่อไม่บีบยอดบนจอกลาง ผ่านการตรวจ browser 8 ขนาดหน้าจอของรายจ่าย/ใบเบิก/ใบแทน และยอดยาวจำลอง ดู [หลักฐาน](../qa/evidence/expense-kpi-responsive-2026-09-11/README.md)

## Integration กับการตรวจหลักฐานล่าสุดบน develop (2026-09-11)

รายจ่ายที่ระบบสร้างจากใบเบิกซึ่งผ่านการอนุมัติ/ตรวจการเงินแล้ว ใช้หลักฐานและ snapshot ของใบเบิกผ่าน authority ภายในที่ตรวจ company/request/line/branch ตรงกัน ไม่บังคับให้เปิดหน้าตรวจหลักฐานรายจ่ายซ้ำเพราะไม่มีเส้นทางนั้นในใบเบิก การยืนยันรายจ่ายทั่วไปยังต้องตรวจหลักฐานล่าสุด ส่วนการไม่มีใบเสร็จยังขึ้นกับนโยบายเดิม การตรวจต้นทางภายใน transaction, VAT, งวดบัญชี และการป้องกันจ่ายต้นทางซ้ำยังคงเดิม ต้องผ่าน real PostgreSQL ทั้งการปฏิเสธ authority ผิดรายการ การยืนยันทั่วไปที่ยังไม่ตรวจ และการยืนยัน/จ่ายใบเบิกด้วย authority ที่ถูกต้อง
