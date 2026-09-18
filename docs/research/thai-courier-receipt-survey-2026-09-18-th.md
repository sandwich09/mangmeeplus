# สำรวจเอกสารค่าขนส่งในไทย: ใบสั้น ใบเต็ม และ electronic

Status: Research checked 2026-09-18 (Asia/Bangkok); integrated as discovery and regression cases in spec §18 and plan W00–W08. No application implementation, live-account document request, merge or deployment.
Scope: ผู้ซื้อบริการขนส่งเพื่อค่าใช้จ่าย/เบิกเงิน ผ่าน LINE AI, upload และ replace เดิม; ไปรษณีย์ไทย, KEX/เคอรี่, Flash, J&T, SPX, DHL Express และ SCG Express. การกระทบยอดรายได้จาก COD ของผู้ขายไม่อยู่ในขอบเขตนี้
Related: [Spec](../specs/marketplace-buyer-expense-capture-spec-th.md) · [Plan](../plans/marketplace-buyer-expense-capture-plan-th.md) · [Source catalog](thai-courier-receipt-survey-2026-09-18.json)

## 1. สิ่งที่ยืนยันได้และข้อจำกัดเรื่อง “ล่าสุด”

ตรวจช่องทางผู้ให้บริการทั้ง 7 เจ้า ณ วันที่ข้างต้น; ไม่ได้ยืนยันว่าได้ specimen แบบล่าสุดครบทุกประเภทของทุกเจ้า ตัวอย่างที่เห็นวันที่ใหม่ที่สุดคือใบรับเงินไปรษณีย์ไทย 23/02/2026 ส่วนภาพแบบอื่นเก็บไว้เป็น historical layout ไม่ใช้วันที่ search crawl หรือ PDF metadata แทนวันที่ออกเอกสาร

ทะเบียนมี 11 document records: ตรวจภาพ/หน้า PDF 9 รายการ และอ่านข้อความจากเอกสาร Flash อีก 2 รายการซึ่งยังไม่ได้ตรวจภาพ. ในจำนวนนี้ 7 รายการเป็นสำเนาธุรกรรมที่เผยแพร่สาธารณะโดยบุคคลที่สาม และ 4 รายการเป็นตัวอย่างในคู่มือ ไม่ได้ตรวจความแท้ของธุรกรรม. ใบ DHL หน้าสรุปกับหน้ารายละเอียดนับเป็นชุดตัวอย่างเดียว; KEX หนึ่งหน้าคู่มือมีเอกสาร 3 ชนิดจึงแยก records ตามชนิด ไม่เรียกว่าใบเสร็จ 3 ใบ. ไม่ได้นับทั้ง 26 หน้า Flash ว่าตรวจครบ

ยังไม่ได้ไฟล์ e-Tax ต้นฉบับของธุรกรรมลูกค้าสำหรับตรวจลายมือชื่อ: 0 ไฟล์ที่ตรวจ signature จริง. ภาพข้อความ “Digitally signed” ยืนยันได้เพียงว่ามีข้อความดังกล่าว ไม่ใช่ผลตรวจ cryptographic signature. ยังขาด specimen ปัจจุบันแบบเต็มของไปรษณีย์ไทย/KEX/Flash และตัวอย่างใบจริงของ J&T/SPX/SCG; ไม่อ้างว่าบริษัทเหล่านี้ไม่มีเอกสารดังกล่าว

## 2. ผลรายผู้ให้บริการ

| ผู้ให้บริการ | ใบสั้น/กระดาษที่ตรวจ | ใบเต็มและ electronic ที่ยืนยันได้ | ความสดใหม่/สิ่งที่ยังขาด |
| --- | --- | --- | --- |
| ไปรษณีย์ไทย | C01 ใบรับเงิน EMS ปี 2026; C02 ใบรับเงิน/ใบกำกับภาษีอย่างย่อที่มีค่าหุ้มห่อ; C03 ใบรับเงิน 3 พัสดุ | หน้า COD ทางการระบุดาวน์โหลดหลักฐานชำระผ่าน SMS หรือ tracking; เอกสาร COD นี้ต้องแยกจากค่าฝากส่ง | ใบ 2026 ยืนยันได้เฉพาะ specimen นี้ ไม่ใช่ template ทุกสาขา; ยังไม่พบใบเต็มล่าสุดหรือช่องทาง e-receipt ค่าฝากส่งที่ยืนยันได้ในการสำรวจนี้ [THP COD](https://www.thailandpost.co.th/un/article_detail/product/568/11751) |
| KEX/เคอรี่ | C04 Kerry ปี 2023; C05 KEX ตัวอย่างปี 2024 มีค่าขนส่ง ส่วนลด และ fuel charge; C06–07 เป็นใบปะหน้า/ใบนำฝาก | เงื่อนไข COD Postpaid ระบุส่ง E-Tax Invoice ทางอีเมลที่ลงทะเบียน เป็นบริการเฉพาะนี้ ไม่ขยายความว่าใบเสร็จทุกบริการเป็น e-Tax | คู่มือ KEX อยู่บน third-party host และเป็นตัวอย่าง ไม่ใช่หลักฐานว่าทุกสาขาใช้ layout นี้ในปี 2026 [KEX COD](https://th.kex-express.com/en/terms-and-conditions-of-cod) |
| Flash Express | C08 ใบเสร็จรับเงินชั่วคราว 4 พัสดุ ปี 2019 | เว็บทางการให้ขอใบเสร็จผ่านแอป เลือกเลขพัสดุและกรอกข้อมูล แล้วส่งอีเมลตามกำหนดที่ระบุ; C09–10 เป็นข้อความใบเสร็จ/ใบกำกับภาษีเต็มปี 2021 มีหมายเหตุออกแทนใบชั่วคราว | official request guide ยังเข้าถึงได้; ใบเต็มที่พบเป็น historical text-only ไม่ใช่ specimen ล่าสุดหรือ signed original [Flash request](https://www.flashexpress.co.th/fle/call-center/invoice-application/) |
| J&T Express | ยังไม่ได้ใบจริงที่ตรวจได้ | ตรวจเว็บและ FAQ ผ่าน browser ได้ แต่ยังไม่พบรายละเอียดทางการเรื่องขอใบเต็ม/electronic ในหน้าที่ตรวจ | หน้า FAQ และแอปปัจจุบันไม่เพียงพอให้สรุปชนิดเอกสาร ต้องได้ตัวอย่างจากลูกค้าที่มีสิทธิหรือคู่มือออกเอกสารเพิ่มเติม [J&T FAQ](https://www.jtexpress.co.th/FAQ) |
| SPX Express | ยังไม่ได้ specimen ใบชั่วคราวจริง | เมนู “ขอใบกำกับภาษี” จากเว็บทางการพาไป Google Form ชื่อ Request Full Taxinvoice; ขอเลขที่/วันที่ใบชั่วคราว ข้อมูลผู้ซื้อ และอีเมล พร้อมเอกสารประกอบ; หน้าแบบฟอร์มระบุขอภายใน 15 วันหลังได้รับใบชั่วคราว | เปิดอ่านแบบฟอร์มจริงแล้ว ไม่กรอก/ส่งคำขอ; ระยะเวลาเป็นเงื่อนไขบนช่องทางนี้ ไม่ใช่ข้อสรุปกฎหมายทั่วไป และการส่งทางอีเมลยังไม่ยืนยันว่าเป็น e-Tax ที่ตรวจลายมือชื่อได้ [SPX](https://spx.co.th/th) · [แบบฟอร์มที่เว็บทางการลิงก์](https://docs.google.com/forms/d/1FJfxf-H4Fdug0tyKNX2nvMO4nsFY_NbAcpnE5wVTqtk/viewform) |
| DHL Express | C11 ตัวอย่างใบแจ้งหนี้/ใบกำกับภาษีเต็ม พร้อมหน้ารายละเอียดชิปเมนต์ | MyBill ทางการอธิบายดู/ดาวน์โหลดใบเสร็จและใบแจ้งหนี้; FAQ นำเข้าแยก Customs Receipt กับ Duty Invoice | บทความ MyBill ลงวันที่ 28/01/2025; specimen ในคู่มือวันที่ 08/10/2018 แม้ PDF metadata แก้ไขปี 2026 จึงยังเป็น historical specimen [MyBill](https://www.dhl.com/discover/th-th/ship-with-dhl/services/dhl-mybill-online-accounting-management) · [Import documents](https://www.dhl.com/discover/th-th/logistics-advice/import-export-advice/import-duty-faq) |
| SCG Express | ยังไม่ได้ใบจริงที่ตรวจได้ | FAQ ยืนยันประเภทบริการหลายแบบและช่องทางติดต่อ แต่ไม่พบ specimen ใบเต็มหรือขั้นตอน e-Tax ในหน้าที่ตรวจ | เก็บเป็น coverage gap ไม่ใช้ภาพโลโก้/ใบจองขนส่งแทนใบเสร็จ [SCG FAQ](https://www.scgexpress.co.th/faq/) |

## 3. ทะเบียนตัวอย่างที่ใช้วิเคราะห์

ข้อมูลบุคคล ชื่อผู้รับ ที่อยู่ เบอร์โทร เลข tracking จริง และเลขบัญชีของผู้เผยแพร่ไม่คัดลอกลง catalog; เก็บลิงก์ต้นทาง วันที่ ประเภท รูปแบบ และยอดที่จำเป็นต่อการวิเคราะห์. Public availability ไม่ได้แปลว่ามีสิทธิใช้เป็น training/golden fixture; D05 ต้องมีสิทธิและ redaction workflow ก่อนใช้กับ model test

| ID | ชนิด/วันที่ในเอกสาร | ประเด็นที่ตรวจได้ | หลักฐาน/ระดับ |
| --- | --- | --- | --- |
| C01 | THP ใบรับเงิน EMS, 2026-02-23 | ยอด 52; tracking, receipt number และ payment reference เป็นคนละเลข; QR ท้ายใบเป็น POST Family ไม่ใช่หลักฐานจ่ายเงินโดยตัวมันเอง | [ต้นทาง](https://pantip.com/topic/43993748) · [ภาพ](https://f.ptcdn.info/631/090/000/mm0a367fh4LbVrOTr3A-o.jpg), visual |
| C02 | THP ใบรับเงิน/ใบกำกับภาษีอย่างย่อ, 2022-08-13 | ค่าขนส่ง 2,400 + ค่าหุ้มห่อ 100 = 2,500; เงินสด 3,000/เงินทอน 500 ไม่ใช่ยอดค่าใช้จ่าย; พิมพ์ NON VAT 2,400 และ VAT 6.54 ในส่วน 100 | [ต้นทาง](https://pantip.com/topic/41718569) · [ภาพ](https://f.ptcdn.info/123/079/000/rlx16ubuvHjujpnEHQ9-o.jpg), visual |
| C03 | THP ใบรับเงิน EMS, 2020-08-23 | 3 พัสดุ: 85 + 85 + 125 = 295; น้ำหนักเป็นข้อมูลพัสดุ ไม่เอาไปคูณค่าบริการที่พิมพ์ซ้ำ | [ต้นทาง](https://pantip.com/topic/40150433) · [ภาพ](https://f.ptcdn.info/651/070/000/qfkflxkhdM53aNOXz9Z-o.png), visual |
| C04 | Kerry ใบเสร็จ, 2023-12-23 | อ่านจากภาพได้ subtotal 30 − discount 5 = 25, fuel 0; summary ของ image search เคยอ่าน subtotal เป็น 20 จึงไม่ใช้ summary เป็น expected truth | [ต้นทาง](https://pantip.com/topic/42424040) · [ภาพ](https://f.ptcdn.info/756/082/000/s69l431hi79bN18le75h6-o.jpg), visual |
| C05 | KEX ตัวอย่างใบเสร็จ, 2024-11-22 | 2 รายการขนส่ง 100 + 100, fuel 2 + 2; subtotal 200 + fuel total 4 = 204 ไม่บวก fuel ซ้ำทั้งระดับแถวและท้ายใบ | [คู่มือ หน้า 21](https://cdnc.heyzine.com/files/uploaded/3090dc098e512f7b6e41292aa5499bdd394bf7a8.pdf#page=21), visual training sample |
| C06 | KEX ใบปะหน้า, 2024-11-22 | barcode/tracking/CW และน้ำหนักไม่ใช่ราคา ไม่ใช่ใบเสร็จ | คู่มือเดียวกับ C05 หน้า 21 ด้านซ้าย, visual negative sample |
| C07 | KEX ใบนำฝาก, 2024-11-22 | จำนวนชิ้น/น้ำหนัก/ลายเซ็นรับฝาก ไม่ยืนยันยอดจ่าย | คู่มือเดียวกับ C05 หน้า 21 ด้านขวา, visual negative sample |
| C08 | Flash ใบเสร็จชั่วคราว, 2019-02-13 | 4 × 35 = 140; เป็นใบชั่วคราว ไม่อนุมานว่าเป็นใบกำกับภาษีอย่างย่อจากขนาดกระดาษ | [ต้นทาง](https://phatsadu.org/tracking/flashexpress) · [ภาพ](https://phatsadu.org/images/receipt/flash.jpg), visual |
| C09 | Flash ใบเสร็จ/ใบกำกับภาษี, 2021-07-01 | ยอดข้อความ 1,029.80 + VAT 19.88 = 1,049.68; มีหลายพัสดุและข้อความออกแทนใบชั่วคราว ต้องตรวจภาพก่อนใช้ expected line amounts | [เอกสารที่เผยแพร่](https://anyflip.com/aedqx/nkop/basic), text-only; browser ติด security verification ไม่ได้ดำเนินการผ่าน challenge |
| C10 | Flash ใบเสร็จ/ใบกำกับภาษี, 2021-07-02 | ยอดข้อความ 155.12 + VAT 1.88 = 157.00; ไม่ใช้จำนวนชิ้น 0 ของแถวว่างทำให้ยอดรวมผิด; signature ยังไม่ตรวจ | แหล่งเดียวกับ C09, text-only; ไม่จัดเป็น visual fixture |
| C11 | DHL ใบแจ้งหนี้/ใบกำกับภาษีและ shipment detail, 2018-10-08 | 1,028 + fuel 179.90 = 1,207.90; หน้า summary และ detail ย้ำยอดเดียวกัน; มี due date ต่างจาก invoice/shipment date และแสดง VAT 0% ซึ่งไม่เท่ากับไม่มีข้อมูล VAT | [คู่มือ หน้า 23–24](https://mydhl.express.dhl/content/dam/downloads/th/th/electronic-billing/dhl_mybill_userguide_th_th.pdf.coredownload.pdf#page=23), visual training sample หนึ่งชุด |

## 4. สิ่งที่ต้องอ่านและแยกให้ถูก

1. **ชนิดเอกสารกับหน้าตากระดาษ:** ใบสั้นไม่เท่ากับใบกำกับภาษีอย่างย่อ; A4/PDF ไม่เท่ากับใบเต็ม/e-Tax. อ่านหัวเอกสาร ผู้ขาย/ผู้ซื้อ สาขา และข้อมูลที่มีจริง ใช้ classification เดิม. กรมสรรพากรแยกใบกำกับภาษีอย่างย่อกับเต็มรูป และมีแนวทางออกเต็มรูปแทนอย่างย่อ จึงต้องรักษาความสัมพันธ์เอกสาร [ข้อหารือ กค 0702/443 ลงวันที่ 27/01/2568](https://www.rd.go.th/67521.html)
2. **บทบาทของเงิน:** แยกค่าขนส่ง/บรรจุภัณฑ์/fuel/พื้นที่พิเศษ/ประกัน/ค่าธรรมเนียม COD ออกจากมูลค่าสินค้า ยอด COD ที่เรียกเก็บแทน และยอดโอนสุทธิ. ใบรับเงิน COD ใช้ประกอบการซื้อเดิมได้ตามข้อเท็จจริง แต่ไม่บันทึกยอดสินค้าเป็นค่าใช้บริการขนส่งใหม่
3. **ผู้ออกเอกสาร:** ผู้ให้บริการขนส่ง ร้านตัวแทนรับพัสดุ ผู้ขายสินค้า ผู้ส่ง และผู้รับอาจเป็นคนละราย. โลโก้ผู้ขนส่งไม่ได้แทน legal issuer; ชื่อ/ที่อยู่ปลายทางไม่ใช่ข้อมูลผู้ซื้อในใบกำกับภาษีโดยอัตโนมัติ
4. **หลายพัสดุและหลายหน้า:** หนึ่งใบมีหลาย tracking ได้; ใบสรุปกับรายละเอียดอาจเป็นเอกสารเดียว. ต้องรักษา document/page/row identity ตาม manifest เดิม ไม่รวมหลายใบตามชื่อขนส่ง และไม่ใช้ MULTI_DOCUMENT กับหลายแถวของใบเดียวเพียงเพราะมีหลาย tracking
5. **ภาษีตามหลักฐาน:** ค่าบริการต่างชนิดในใบเดียวอาจมี treatment ต่างกันตามที่เอกสารแสดง; reuse per-line vatRate/vatTreatment. ไม่กำหนดว่า “ขนส่งทั้งหมด VAT 0” หรือ “ทั้งหมด VAT 7%”, ไม่อนุมัติภาษีซื้อจากชื่อแบรนด์ และไม่ใช้คำแนะนำ WHT ใน historical template เป็น policy ปัจจุบัน
6. **ต้นฉบับ electronic:** เก็บ bytes เดิมและแยก OCR/text/signature verification. คู่มือ RD อธิบายการตรวจลายมือชื่อบน PDF; การอ่านเนื้อหาได้ไม่ใช่การตรวจลายมือชื่อ [RD validation guide](https://etax.rd.go.th/etax_staticpage/app/emag/flipbook_2567/pdf/07_Validation.pdf)

ฟิลด์สำหรับ D02 ที่ต้องตรวจว่าของเดิมแทนได้หรือไม่: issuer, customer/buyer และ payer แยกกัน; document number/date, paid/due/unknown; tracking references แบบหลายค่า, service labels, parcel/piece count, weight/UOM, line amount/discount/charges และ tax evidence; relation ของใบชั่วคราว→ใบเต็ม/ใบแทน/credit note. ไม่ให้ผู้ใช้อายุ 40+ กรอก metadata เหล่านี้เองทั้งหมด และไม่เพิ่ม enum/ตารางรายขนส่งก่อนพิสูจน์ว่าจำเป็น

## 5. Impact/gap และทางใช้ของเดิม

| จุด | Evidence ปัจจุบัน | สิ่งที่ต้องตรวจรับ/ปรับเฉพาะเมื่อขาด |
| --- | --- | --- |
| Classification | [document kinds เดิม](../../packages/contracts/src/line-ai.ts:351) มี RECEIPT/TAX_INVOICE/ABBREVIATED_TAX_INVOICE/DELIVERY_NOTE/OTHER_BUSINESS_DOCUMENT | ใช้ชนิดเดิมก่อน; labels/manifests ต้องไม่สร้าง monetary expense จาก tracking/COD value; ไม่เพิ่ม provider handler เพียงเพราะแบรนด์ใหม่ |
| OCR contract/apply | [line evidence และ per-line VAT](../../packages/contracts/src/line-ai.ts:247), [field result](../../packages/contracts/src/line-ai.ts:270), [apply reconciliation](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:189) | ยอด shipment กับ summary ต้องไม่บวกซ้ำ; `documentNumber` ไม่ใช่ที่ใส่ tracking ทุกตัว. Source read พบยังไม่มี dedicated shipment reference block ใน ReceiptOcrFieldResult; D02 พิจารณาต่อยอด manifest/evidence เดิมก่อนเปลี่ยน contract |
| Existing UX/handlers | Spec §17.8 ตรวจ recovery และ review form เดิมไว้แล้ว | ใช้ LINE/upload/replace เดิมทั้งใบสั้น/เต็ม/PDFหลายหน้า; ถ้าอ่านไม่สำเร็จและเก็บจริง ให้ “กรอกข้อมูลต่อ” ที่งานเดิม ไม่มี mode ให้เลือกขนส่ง |
| Duplicate/late evidence | A55/A63/A70–A74 และ W01/W02/W05/W07 | ใบเต็มที่ตามมาเป็นการเพิ่ม/แทนหลักฐานของงานเดิมเมื่อยืนยันความสัมพันธ์แล้ว; tracking เดียวอย่างเดียวไม่พอ dedupe เพราะมีค่าบริการเสริม/ใบลดหนี้ได้ |
| Payment/tax/certificate | D03/D09, W04/W06/W07 | ยอดเรียกเก็บไม่ใช่ยอดจ่าย; ศุลกากรกับค่าบริการขนส่งไม่รวมภาษีซ้ำ; หากหลักฐานไม่พอพักให้ตรวจ ไม่สร้างใบรับรองแทนใบกำกับภาษีหรือเพราะ OCR fail |

นี่เป็น impact จาก source/schema และ specimen ไม่ใช่ bug ที่ reproduce ใน runtime. งาน PDF 10 MiB/หลายหน้าและ pending-before-expense → Web ยังคงเป็นช่องว่างจากแผนเดิม ไม่ถือว่าปิดแล้วเพราะมีตัวอย่าง PDF

## 6. เคสตรวจรับเพิ่มเติมใน W เดิม

CC01–CC10 เป็น regression cases ที่เสนอเพิ่มจากการสำรวจ ไม่ใช่ผลทดสอบที่ผ่านแล้ว. A ที่อ้างเป็น acceptance ที่เกี่ยวข้องและต้องขยายด้วยกรณีขนส่ง ไม่ได้หมายความว่า A เดิมตรวจครบทุกกรณีนี้อยู่แล้ว

Owner follow-up 2026-09-18: spec §18.4 / plan §12.1 เพิ่ม NR01–NR09 ใต้ CC01/CC04/CC08/CC09 สำหรับข้อความตอบเอกสารอื่นและทางทำต่อ. ไม่ปัดตก invoice/slip/order ทั้งหมด ไม่เรียกการจำแนกเอกสารอื่นว่าอ่านล้มเหลว และต้องยืนยัน persist/purpose/permission ก่อน saved copy หรือ Web link. เป็นข้อกำหนดที่ยืนยันแล้ว ยังไม่ใช่ runtime behavior ที่ implement เพิ่มในรอบนี้

| Case | Expected behavior | Existing acceptance / plan |
| --- | --- | --- |
| CC01 | แยก physical short/full จาก document kind; issuer/agent/sender/recipient ถูกบทบาท; receipt ID ไม่ใช่ tracking | A53/A61/A68; W00/W02/W03/W04/W08 |
| CC02 | 1 ใบหลายพัสดุและ PDF summary/detail ไม่สร้างหลาย expense หรือบวกยอดซ้ำ; คนละใบในไฟล์เดียวแยก document | A54/A65/A82; W01/W02/W03/W08 |
| CC03 | ค่าขนส่ง/fuel/discount/tax ต่อแถว reconcile รวมครั้งเดียว; เงินสด/เงินทอน/points ไม่เพิ่มยอด | A50/A51/A53/A57; W03/W04/W08 |
| CC04 | COD principal/declared value ไม่กลายเป็นค่าขนส่ง; ใบแจ้งหนี้/ใบปะหน้า/ใบนำฝากไม่ถือว่าจ่ายแล้ว | A51/A61/A68; W00/W03/W04/W07/W08 |
| CC05 | temporary→full/electronic แนบงานเดิม ไม่มี expense/claim/payment ซ้ำ; correction หลัง lock ใช้ flow เดิม | A55/A60/A63/A71/A74; W01/W02/W05/W06/W07/W08 |
| CC06 | bill รายเดือนที่มีใบย่อยจ่ายแล้ว/ชำระบางส่วน/credit note ไม่รวมเป็นรายจ่ายใหม่ซ้ำ และ due date ไม่แทน expense date | A54/A55/A63/A65; W01/W03/W04/W07/W08 |
| CC07 | PDF/email/screenshot/signature text แยกจาก verified original; ชนิด VAT/ภาษีศุลกากรคง facts ไม่อนุมานสิทธิ | A61/A62/A66; W00/W01/W03/W04/W08 |
| CC08 | LINE/new upload/replace ได้ facts และ recovery เดียวกัน; original 10 MiB/multipage ใช้ขอบเดิม; failed ที่เก็บแล้วเปิดกรอกงานเดิม | A64/A67/A69/A70/A75/A82–A88; W02/W03/W04/W08 |
| CC09 | ผู้ใช้ไม่ต้องเลือกขนส่งหรือรู้ชนิดภาษีก่อนส่ง; สรุปค่าบริการและส่วนที่ขาดด้วยภาษาคน; ไม่มีใบจริงใช้ W06 เฉพาะเข้าเกณฑ์ | A01/A60/A64/A85; W04/W06/W08 |
| CC10 | Golden fixtures ระบุ provider/issuer/date/channel/type/permission/visual or text-only; อย่าเอา historical/guide มาอ้าง latest accuracy | A61/A62/A66/A69; D05/D09; W00/W08 |

## 7. สิ่งที่ยังต้องได้ก่อนประกาศรองรับแบบล่าสุดครบ

- ชุดเอกสาร 2025–2026 ที่ได้รับอนุญาตของแต่ละ provider/ช่องทาง ครอบคลุมใบชั่วคราว ใบกำกับอย่างย่อ ใบเต็ม และ electronic ที่ผู้ให้บริการนั้นออกจริง; ถ้าไม่ออกชนิดหนึ่งให้ได้ official evidence แทนการเดา
- คู่ temporary/full ที่สัมพันธ์กันจริง, ใบยกเลิก/ลดหนี้, bill รายเดือนกับใบย่อย และพัสดุเดียวที่มีค่าใช้จ่ายเพิ่มภายหลัง; ไม่สร้างข้อมูลสัมพันธ์ขึ้นเองจากภาพคนละรายการ
- Signed original สำหรับ D09 แยกจาก redacted display derivative. J&T/SPX/SCG ยังไม่มี specimen verified ในทะเบียนนี้
- ทดสอบ AI/Web/API/LINE และ UX40+ ตาม W08 ด้วยข้อมูลที่มีสิทธิ. รอบนี้ตรวจเอกสาร/ภาพ/ลิงก์/เลขคณิตเท่านั้น ไม่เพิ่ม application tests สำหรับงาน research และไม่อ้างผล 83 tests ของการ audit handler เมื่อวานว่าเป็น courier accuracy
