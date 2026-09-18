# สำรวจใบเสร็จค้าปลีกฝั่งผู้ซื้อ: 7-Eleven, Lotus’s, Big C, Makro และ CJ MORE

Status: Research integrated into spec/plan v0.11 on 2026-09-17 per user request. RC-A01–19 map to normative A49–A67; LINE/upload/replacement adds A68–A74 and automatic PDF10MiB/multi-page requirements add A75–A82; error/recovery UX adds A83–A85 and grounded LINE follow-up adds A86–A88. Application implementation and runtime verification remain pending.
Scope: ค่าใช้จ่าย/เบิกเงินฝั่งผู้ซื้อ; กระดาษและ electronic ของทั้งห้าแบรนด์, UX40+ และทางกู้ต่อ รวมใบรับรองแทนใบเสร็จ
Related: [spec v0.11](../specs/marketplace-buyer-expense-capture-spec-th.md), [plan W00–W08](../plans/marketplace-buyer-expense-capture-plan-th.md), [ทะเบียนตัวอย่าง JSON](thai-retail-buyer-receipt-survey-2026-09-17.json)

## 1. ข้อเสนอที่ได้จากการสำรวจ

ใช้ทางเข้าอัปโหลด/LINE และหน้าตรวจค่าใช้จ่ายเดิมร่วมกันได้ในเชิง solution แต่ตัวอ่านและการกระทบยอดต้องเข้าใจใบเสร็จค้าปลีกเพิ่ม ไม่ใช่เพียงเพิ่มชื่อร้านห้าแห่งเข้า prompt และไม่ใช่อ้างว่าระบบปัจจุบันรองรับครบแล้ว

แยกสามอย่าง: **ช่องทางซื้อ → ผู้ออกเอกสาร → รายการซื้อที่หลักฐานอ้างถึง** เช่น ซื้อของ Lotus’s ผ่าน Shopee หรือซื้อจากผู้ขายรายอื่นบน Makro PRO; โลโก้แอปไม่ใช่ข้อสรุป legal issuer และใบกำกับที่ตามมาภายหลังไม่ใช่ซื้อใหม่

หน้าร้านหนึ่งผู้ขาย/หนึ่งการซื้อควรเริ่มจาก expense เดียวที่มีหลายบรรทัด/หมวดตามความสามารถเดิม แยก source เมื่อมี legal/document/funding scope ที่ต้องแยกจริง ไม่สร้าง expense หนึ่งใบต่อ SKU และไม่บังคับผู้ใช้เข้า flow หลายร้านเพราะมีสินค้าหลายประเภท

## 2. วิธีสำรวจและข้อจำกัด

- ตรวจภาพจริงผ่าน browser **11 เอกสารใน 10 ภาพ จาก 10 source pages**: 7-Eleven 3, Lotus’s 2, Big C 3, Makro 1, CJ MORE 2; ภาพ Big C หนึ่งภาพมีสองใบเสร็จคนละเลข/เวลา จึงแยกสอง document cases
- ทั้งหมดเป็นเอกสารไทยที่เผยแพร่สาธารณะ ไม่ใช่ธุรกรรมที่พิสูจน์ความแท้ ไม่ใช่ 15 ใบต่อร้าน และไม่ได้รัน OCR/model evaluation
- ตัวอย่างลงวันที่ช่วง 2016–2025 บางภาพเก่าหรือขอบถูกตัด และหนึ่งภาพเป็นหน้าจอแอปที่แสดงใบกำกับ ไม่ใช่ไฟล์ e-Tax ต้นฉบับที่ตรวจลายมือชื่อแล้ว
- แยกข้อมูลจากภาพที่เห็น, official guidance ที่อ่านได้, search-index-only และข้อเสนอของเรา ไม่เชื่อคำบรรยายภาพจาก search เป็นผลอ่านจริง: พบคำบรรยายสินค้า/ส่วนลด/จำนวนแถวบางผลลัพธ์คลาดเคลื่อนจากภาพ
- เก็บ URL/locator และบันทึกเชิงโครงสร้าง ไม่คัดลอกภาพจริง ชื่อ/ที่อยู่ผู้ซื้อ เลขสมาชิก เลขบัตร หรือเลขเอกสารรายบุคคลเข้า repo; ยังไม่มีสิทธิใช้เป็น training data หรือแจกต่อ
- คำแนะนำ Easy E-Receipt ที่เป็นแคมเปญปี 2024/2025 ใช้ยืนยันรูปแบบ/เส้นทางเอกสารในเวลานั้น ไม่ใช้ประกาศสิทธิภาษีหรือกำหนดเวลาปัจจุบันปี 2026
- Electronic coverage: ตรวจภาพใบกำกับในแอป 7-Eleven หนึ่งตัวอย่าง และตรวจ official guidance ครบห้าแบรนด์ตามตาราง §4.1; ยังไม่มีไฟล์ e-Tax ต้นฉบับที่ตรวจ signature/timestamp ครบห้าแบรนด์ ไม่นับคู่มือ/โปสเตอร์เป็นใบเสร็จเพิ่ม

## 3. ตัวอย่างที่ตรวจภาพแล้ว

| ID | แหล่งภาพ | สิ่งที่เห็นและผลต่อระบบ |
|---|---|---|
| R7-01 | [7-Eleven ส่วนลดหลายรายการ](https://pantip.com/topic/41888782) | ยอด 199 ลด 1+5+20.25+5+9.75 เหลือ 158; “บิลนี้ประหยัด 41” เป็นยอดสรุป ไม่ลดซ้ำ; มีแถวเกม/สิทธิราคา0และตัวนับที่ไม่ใช่จำนวนสินค้าซื้อ |
| R7-02 | [7-Eleven เงินสด/เงินทอน](https://www.kawa-sho.co.jp/blog_post_0000804.html) | ซื้อ 54+14=68 รับเงิน500 ทอน432; ค่าใช้จ่ายไม่ใช่500 และ VAT Included ไม่ใช่ให้บวกภาษีอีก |
| R7-03 | [ใบกำกับในแอป 7-Eleven](https://droidsans.com/how-to-get-receipt-from-7-11/) | มีตารางสินค้า ส่วนลด VAT และช่องผู้ซื้อที่ผู้เผยแพร่ปิดไว้; screenshot ไม่ยืนยัน digital signature และไม่ควรนับซ้ำกับใบเสร็จเดิม |
| RL-01 | [Lotus’s ใบเสร็จพร้อมป้ายราคา](https://pantip.com/topic/43056367/desktop) | ใบเสร็จ 16+58.75+58.75=133.50; ป้ายในภาพแสดง58.50; เก็บความต่าง ไม่แก้ยอดบิลตามป้ายเอง; โปรโมชั่นคูปอง320ท้ายบิลไม่ใช่ส่วนลดที่ใช้แล้ว |
| RL-02 | [Lotus’s coins + บัตร](https://www.wongnai.com/attractions/1926507mi-%E0%B9%82%E0%B8%A5%E0%B8%95%E0%B8%B1%E0%B8%AA-%E0%B8%8A%E0%B8%B0%E0%B8%AD%E0%B8%B3) | 227−5=222; coins44 + M/C178; แต้มคงเหลือ45.32 ไม่ใช่ยอดจ่าย การใช้ coins ไม่ควรถูกแปลงเป็นส่วนลด/เงินพนักงานโดยไม่รู้ policy |
| RB-01 | [Big C ยกเลิกแล้วคิดใหม่](https://pantip.com/topic/35750140) | แถว59, −59, 53 รวม53; รับ59ทอน6; Vatable53 และ VAT3.47 พร้อม VAT INCLUDED อย่า map คำว่า Vatable เป็นฐานก่อนVAT โดยอัตโนมัติ |
| RB-02 | [Big C ภาพสองใบ—ฝั่งซ้าย](https://pantip.com/topic/38016701/desktop) | รายการยาว มีบรรทัดจำนวน×ราคาต่อหน่วยและส่วนลดติดลบ; ยอดรวม/บัตร1,198.50; อย่านับบรรทัดรายละเอียดจำนวนเป็นสินค้าใหม่ |
| RB-03 | [Big C ภาพเดียวกัน—ฝั่งขวา](https://pantip.com/topic/38016701/desktop) | Total839, CPN130, CASH709; ข้อความประหยัด130ถูกพิมพ์ซ้ำด้านล่าง ต้องแยกยอดเอกสารกับองค์ประกอบชำระและยังไม่สรุปการบัญชีของCPNจากตำแหน่งพิมพ์อย่างเดียว |
| RM-01 | [Makro ภาษีหลายกลุ่ม/ชั่งน้ำหนัก](https://pantip.com/topic/35950630) | มี quantity/weight, unit packs, pack price, VAT code; น้ำหนัก0.244/0.118 และตาราง code1→อัตรา0/code2→อัตรา7; 32.25+3,967.29+277.71=4,277.25; อ้างเอกสารอย่างย่อที่ออกแทน |
| RC-01 | [CJ MORE / BAO CAFÉ คูปอง](https://pantip.com/topic/42908631/desktop) | สินค้า45, แถวคูปองราคา0, ส่วนลดAIS−10, รวม35 รับ40ทอน5; เลขคิว21ไม่ใช่เลขใบเสร็จ และไม่หักคูปองซ้ำสองแถว |
| RC-02 | [CJ MORE โปรจำนวน/แต้ม/บัตร](https://www.lemon8-app.com/%40lumoomoneystory/7449232893437641223?region=th) | 3ชิ้น30−โปร2=28 ชำระบัตร28; แต้มครั้งนี้1 คงเหลือ296 หมดอายุ260 เป็นแต้มไม่ใช่เงิน และเลขอ้างอิงบัตรไม่ยืนยันผู้สำรองจ่าย |

ตัวเลขข้างต้นคือค่าที่อ่านได้จากภาพ ไม่ใช่การยืนยันข้อร้องเรียนของเจ้าของโพสต์หรือราคาปัจจุบัน JSON มี direct media URL และตำแหน่งเอกสารสำหรับตรวจย้อนกลับ

## 4. Official sources และระดับความมั่นใจ

| แหล่ง | ตรวจได้อะไร | ขอบเขตการใช้ |
|---|---|---|
| [7-Eleven ช่องทางใบกำกับ](https://www.7eleven.co.th/promotion/only/3931-EasyE-Receipt) | หน้า official ระบุมี4ช่องทางขอใบกำกับ; รายละเอียดหลักเป็นภาพ | ยืนยันว่ามีทางขอเอกสารเพิ่ม ไม่สรุปรายละเอียดทุกช่องทางจากข้อความที่ไม่ได้เปิดเห็น |
| [ALL ONLINE วิธีขอเอกสาร](https://allonline.7eleven.co.th/service/help/order-and-pay/receipt/) | Browser อ่านคู่มือได้: ขอเต็มรูปตอนซื้อ หรือขอย้อนหลัง/แก้ไข และดาวน์โหลด PDF จากรายละเอียดคำสั่งซื้อ | หน้าอ่าน ณ 2026-09-17 ระบุย้อนหลัง/แก้ไขภายใน7วันนับจากชำระ และรอ24ชม.; เป็นเงื่อนไข ALL ONLINE ไม่ใช่ทุกช่องทาง7-Eleven และไม่ใช่ SLA ของมั่งมี |
| [Lotus’s แบบฟอร์ม e-Tax](https://fftiform.lotuss.com/) | หน้าอ่านได้ ระบุช่องทาง Shopee/Lazada/TikTok/Amaze/Makro PRO/Axtra Mall และการส่งเอกสารภายหลังรับสินค้า | ใช้เฉพาะบริบทของแบบฟอร์มนี้ ไม่เหมารวมเป็นขั้นตอนทุกหน้าร้าน; ไม่กดยอมรับสินค้าหรือกรอกข้อมูลแทนผู้ใช้ |
| [Big C FAQ](https://www.bigc.co.th/p/faq) | มีการใช้ code/คะแนนกับคำสั่งซื้อ, วิธีจ่ายหลายแบบ และการติดต่อเมื่อรายการเปลี่ยน | แยก purchase/payment/reward; หน้า link ขอใบกำกับปลายทางให้ข้อมูลจำกัด จึงยังไม่ยืนยัน flow ครบ |
| [Big C Gift Card FAQ](https://corporate.bigc.co.th/bigcgiftcard-faqs) | คำอธิบาย official ระบุบัตรแทนเงินสด/เติมมูลค่า | Gift card เป็นคนละแนวคิดกับ promotional coupon; ต้องระบุเจ้าของแหล่งเงินก่อนเบิก |
| [Makro PRO terms](https://www.makro.pro/static/terms-conditions) | ข้อ1.2 ระบุ marketplace; ข้อ15.5 ให้ผู้ขายออกใบเสร็จ/e-Tax เมื่อร้องขอและมีเงื่อนไขรูปแบบกระดาษ/เปลี่ยนรูปแบบ | ไม่ถือว่าเอกสารทุกใบออกโดย Makro และไม่สัญญาว่าผู้ซื้อเปลี่ยนรูปแบบเอกสารได้เสมอ |
| [CJ MORE คู่มือ e-Tax ปี2024](https://www.cjmore.co.th/news/details/95) | Browser อ่านได้: สมาชิกสบายการ์ดเชื่อม LINE OA และกรอกฟอร์มขอ e-Tax; มีเงื่อนไขคืนใบอย่างย่อ ณ สาขาที่ซื้อในแคมเปญนั้น | ยืนยันเส้นทางที่เคยมี แต่ยังไม่ยืนยัน CJ full-invoice layout/ขั้นตอนปัจจุบันปี2026; ไม่ทำเงื่อนไขคืนสินค้า/กำหนดเวลาปี2024เป็นกฎถาวร |
| [กรมสรรพากร ข้อหารือ0702/443](https://www.rd.go.th/67521.html) | 27ม.ค.2568 อธิบายการออกเต็มรูปแทนอย่างย่อ ทั้งกระดาษและอิเล็กทรอนิกส์ | ใช้แยกชนิด/ความสัมพันธ์เอกสาร ไม่ใช้รับรองว่าบิลใดผ่านภาษีโดยอัตโนมัติ |
| [กรมสรรพากร ประกาศVATฉบับ36](https://www.rd.go.th/3401.html) | ผู้ขายออกใบแทนใบกำกับเมื่อเอกสารเดิมสูญหาย/ถูกทำลาย/ชำรุดตามเงื่อนไข | คนละกระบวนการกับใบรับรองแทนใบเสร็จภายในมั่งมี |

Lotus’s FAQ URL เก่า redirect ไปหน้า My Lotus’s จึงไม่ใช้ indexed FAQ เก่ากำหนดวันขอย้อนหลังให้ลูกค้า การทำ merchant recovery links จริงควรเก็บ channel, last_verified_at และ fallback ไปช่องทางบริการลูกค้าเมื่อหน้าเปลี่ยน

### 4.1 ใบเสร็จและใบกำกับ electronic ต้องอยู่ในขอบเขตตั้งต้น

| แบรนด์/ช่องทาง | หลักฐานทางการที่เปิดตรวจแล้ว | ผลต่อมั่งมีและสิ่งที่ยังขาด |
|---|---|---|
| 7-Eleven / ALL ONLINE | [คู่มือ ALL ONLINE](https://allonline.7eleven.co.th/service/help/order-and-pay/receipt/) มีดาวน์โหลด PDF จากบัญชี→ประวัติ→รายละเอียดคำสั่งซื้อ; R7-03 เป็นภาพใบกำกับในแอปจากสื่อภายนอก | รับ PDF หรือภาพหน้าจอผ่าน capture เดิม; ไฟล์ PDF ต้นฉบับ/ลายมือชื่อและเส้นทางหน้าร้านทุกแบบยังไม่ได้ทดสอบ |
| Lotus’s / marketplace | [ฟอร์ม official](https://fftiform.lotuss.com/) ระบุส่งเอกสารทางอีเมลสำหรับช่องทางที่กำหนด; [โปสเตอร์ official ปี2025](https://www.cpaxtra.com/storage/newsroom/news/2025/01/20250116-112813-8.webp) ระบุเช็ก Junk Mail และ Tax box เมื่อไม่ได้รับเอกสาร พร้อมทางแก้ข้อมูล | ช่องทางซื้อมีผลต่อวิธีขอ/กู้เอกสาร; แยกเงื่อนไขฟอร์มกับโปสเตอร์ปีเก่า ไม่กดยอมรับสินค้าเพื่อให้ได้ใบกำกับอัตโนมัติ; ยังขาดไฟล์ต้นฉบับ |
| Big C สาขา / Online | [คู่มือแคมเปญปี2025](https://corporate.bigc.co.th/campaign/20755/Easy-E-Receipt-2025?lang=th) และภาพประกอบสาขาที่ตรวจเห็นระบุใบอย่างย่อ+บัตรประชาชน แจ้งอีเมลหรือเบอร์โทร แล้วรอ e-Tax; มีภาพเงื่อนไขออนไลน์แยก | เป็นหลักฐานเส้นทางรับ electronic ในช่วงแคมเปญ ไม่ใช่หลักฐานไฟล์จริงหรือ SLA ปัจจุบัน; ไม่ขอเก็บบัตรประชาชนในมั่งมีเพียงเพราะร้านใช้ขอออกเอกสาร |
| Makro / Makro PRO | [terms ข้อ15.5](https://www.makro.pro/static/terms-conditions) ยืนยันเรื่อง e-Tax ที่ผู้ขายออก; [โปสเตอร์ official ปี2025](https://www.cpaxtra.com/storage/newsroom/news/2025/01/20250116-112813-9.webp) กล่าวถึง e-Tax ทั้งสาขาและแอป | อย่าใช้แบรนด์แอปตัดสิน issuer; ใบส่งของ/คำสั่งซื้อ/ใบกำกับอาจคนละเอกสาร ยังไม่ตรวจไฟล์ e-Tax จริง |
| CJ MORE | [คู่มือ official ปี2024](https://www.cjmore.co.th/news/details/95) แสดงการขอผ่าน LINE OA ของสมาชิกสบายการ์ด | เตรียมรับไฟล์ที่ผู้ใช้นำมาจาก LINE และภาพหน้าจอ แต่ยังไม่ยืนยันนามสกุล/วิธีส่งมอบปัจจุบันหรือใบ e-Tax จริง; มีทางติดต่อร้านเมื่อคู่มือเก่าใช้ไม่ได้ |

แยก **receipt/invoice/order evidence** ออกจาก **ไฟล์หรือภาพที่ใช้ส่งมา**: PDF อาจเป็นใบกำกับที่ออกด้วยระบบอิเล็กทรอนิกส์, สแกนกระดาษ, หรือพิมพ์หน้า order เป็น PDF ก็ได้ ส่วน screenshot ของ e-Tax ยังเป็นภาพหลักฐาน ไม่ใช่ต้นฉบับที่ตรวจทางเทคนิคได้

ข้อเสนอการรองรับร่วมกัน:

1. รับไฟล์ PDF ต้นฉบับจากแอป/อีเมล/LINE หรือภาพหน้าจอในทางเข้าเดิม ผู้ใช้ไม่ต้องเลือกเทคโนโลยีของเอกสาร; manual upload/share เป็นขอบเขตแรก ไม่สร้างตัวเชื่อมทุกแอปหรืออ่าน mailbox ทั้งกล่อง
2. เก็บ bytes/hash/version ของต้นฉบับพร้อมสิทธิและที่มา; ภาพ preview, หน้าที่แยก และข้อมูล redaction เป็น derivative ที่มี lineage ไม่เขียนทับต้นฉบับ โดย hash ใช้ตรวจไฟล์เหมือนกัน ไม่พิสูจน์ผู้ออกหรือความถูกต้องทางภาษี
3. ทบทวนหลังอ่านโค้ด: readerปัจจุบันใช้vision/document providerตามdecisionเดิม จึงreuseก่อน; nativePDF text layerเป็นoptimizationที่D02ต้องตัดสินพร้อมเทียบrenderedpage/completeness ไม่เปลี่ยนเป็นtext-firstโดยปริยาย PDFหลายหน้า/หลายเอกสารยังต้องมีpagecoverageและหลักฐานกำกับfield ตามspec§16.3
4. แยกสถานะ extraction, document verification และสิทธิใช้จ่าย/ภาษีออกจากกัน ห้ามสรุป verified จากนามสกุล PDF/โลโก้/คำว่า e-Tax หรือ confidence ของ AI; สถานะตรวจเอกสารต้องแยกยังไม่ตรวจ, ตรวจผ่าน, พบปัญหา และตรวจไม่ได้ พร้อม method/time/reason ไม่ให้ error จากตัวตรวจกลายเป็นเอกสารปลอม
5. วิธีตรวจต้องตรงระบบที่ออกเอกสาร: [e-Tax Invoice by Email](https://www.etax.teda.th/) ใช้การประทับรับรองเวลาและมีข้อกำหนด PDF/A-3; อีเมลแนบ PDF ทั่วไปไม่ได้แปลว่าผ่านกระบวนการนี้ และไม่สรุปว่า e-Tax ทุกระบบต้องตรวจแบบเดียวกัน การทำตัวตรวจอัตโนมัติเป็นขอบเขตต้องตัดสินเพิ่ม ไม่ใช่อ้างว่ามั่งมีมีแล้ว
6. ถ้าเอกสารมาทางอีเมล ให้เก็บหลักฐานประกอบที่จำเป็นต่อวิธีตรวจตาม policy/สิทธิของบริษัทเมื่อผู้ใช้แนบมา โดยเฉพาะกรณี by Email; ไม่ใช้ข้อความอีเมลว่า “ชำระแล้ว” แทนหลักฐานจ่าย และไม่อ่านข้อมูลที่ไม่เกี่ยวกับรายการซื้อ
7. QR/ลิงก์เป็นทางเข้าถึงเอกสาร ไม่ใช่ใบเสร็จเอง ไม่เปิด arbitrary URL จาก OCR อัตโนมัติ; ลิงก์หมดอายุหรือผูก login ให้ผู้ใช้เปิดแอปร้านและแชร์ไฟล์มา ไม่ส่งเอกสารส่วนตัวไปเว็บตรวจภายนอกโดยไม่มีการอนุญาต
8. ภาพกระดาษ + screenshot + PDF เต็มรูปที่มาภายหลังอาจเป็นซื้อเดียวกัน ใช้ issuer/branch/document reference/order/date/amount/currency และ explicit replacement reference ช่วยเสนอจับคู่; เก็บความขัดกันให้คนตรวจ ไม่ merge ด้วยยอดเท่ากันอย่างเดียว และไม่เพิ่ม expense/หนี้/เบิกซ้ำ ใบลดหนี้/ใบแก้ไขต้องผ่าน correction และสถานะล็อกเดิม

**ผลต่อ corpus:** ต้องเก็บเป็น purchase bundles ครอบกระดาษ→ภาพหน้าจอ→PDF→ใบแก้ไข ไม่ใช้จำนวนไฟล์เป็นจำนวนซื้อ ขอไฟล์ที่มีสิทธิใช้งานหรือ merchant sandbox fixtures; การปิดข้อมูลใน signed PDF เปลี่ยน bytes และอาจทำให้ตรวจ signature ไม่ผ่าน จึงแยกชุดทดสอบ extraction ที่ redacted/synthetic ออกจากชุดทดสอบ verification ที่เก็บต้นฉบับภายใต้สิทธิ ไม่ตัดสินระบบผิดเพราะเราแก้ไฟล์ทดสอบเอง

## 5. ฟิลด์ที่ควรเพิ่ม/ทำให้ชัดในแบบกลาง

เป็นข้อเสนอ extension ของ facts layer; ก่อนเพิ่ม field ต้องเทียบ contract เดิมและเลือก diff ที่เล็กที่สุด ไม่สร้างบริการหรือ schema ห้าชุดตามชื่อร้าน

| กลุ่ม | ข้อมูลที่ต้องแยก |
|---|---|
| Identity | merchant brand, legal issuer/name/tax branch, store, POS, document number/date/time, purchase channel; เก็บเลขเป็น string ไม่ตัด0นำหน้า |
| Document | อย่างย่อ/เต็มรูป/ใบส่งของ/สลิปชำระ/ใบคืน/ใบแทน/หน้าจอ; relation original/replaces/supports; source page/region และ completeness |
| Electronic evidence | source format/channel, original/derivative relation, hash/version, page coverage, extraction method และ verification method/status/reason/time; แยกข้อมูลทางเทคนิคจากชื่อสถานะที่แสดงผู้ใช้ |
| Line events | sale, explicit void/reversal, price adjustment, applied discount, zero-price promotion, reward/info, unknown; link แถวที่หักล้างกันเมื่อหลักฐานชัด |
| Quantity | ปริมาณซื้อ, หน่วย, pack size, unit price, line amount แยกกัน; ทศนิยมกก.กับจำนวนแพ็กไม่ใช่ค่าเดียวกัน |
| Money | ยอดเอกสาร, subtotal/discount/tax, เงินรับมา, เงินทอน, ยอดแต่ละวิธีจ่าย, amount outstanding/unknown; ไม่ตีความ cash tendered เป็น paid expense |
| Promotion/reward | ใช้ลดแล้ว, ใช้ชำระแล้ว, ได้รับครั้งนี้, คงเหลือ, หมดอายุ, สิทธิซื้อครั้งหน้า, savings summary; เก็บ label/provenance เมื่อ classification ยังไม่รู้ |
| Tax | raw tax marker/legend และ tax group ต่อบรรทัด/summary; code1/code2 ไม่ใช่1%/2%, rate0ไม่สรุป EXEMPT เทียบ ZERO_RATED โดยไม่มีหลักฐาน |
| Financial use | บริษัท/ส่วนตัว/จำนวนส่วนบริษัท, actual payer ที่ยืนยันได้, expense/stock/asset intent เมื่อปลายทางจำเป็น; ไม่เดาจากชื่อร้าน |

สมการเป็นตัวตรวจ ไม่ใช่เครื่องสร้างตัวเลขปิดยอด: R7-02 500−432=68; RL-02 227−5=222 และ 44+178=222; RB-01 59−59+53=53; RB-03 130+709=839 ส่วนสิทธิขอเบิกของ coins/คูปองที่ไม่ใช่เงินสดต้องรอ D03/D06 ไม่ตัดสินว่าเบิกได้222หรือ178จากภาพอย่างเดียว

## 6. ผลต่อโค้ดและแผนเดิม

ตรวจแบบ static เท่านั้น ไม่ได้รัน OCR/API/DB จึงยังไม่กล่าวว่าเป็นบั๊กที่ reproduce แล้ว

| จุด | หลักฐานปัจจุบัน | ข้อเสนอ/งานเดิม |
|---|---|---|
| ใบยาว | [OCR apply](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:130) จำกัด40item lines | W02/W03: ถ่ายต่อ/append, overlap dedup, page coverage; fallback summary ต้องบอกอ่านรายการไม่ครบก่อนเลือกส่วนตัว |
| แถวติดลบ | [usableItemLines](../../apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts:591) รับamountไม่ติดลบและแถวใดไม่ผ่านจะคืน[]ทั้งblock | W03/W04: normalize event/discount/void ก่อน materialize ordinary expense lines; อย่าเพียงเปิดรับ negative ทุกแถวหรือใช้ abs() |
| ฟิลด์ส่วนลด/การชำระ | [ReceiptOcrFieldResult](../../packages/contracts/src/line-ai.ts:270) มีdiscountAmountรวมและadditionalCharges ซึ่งคูปองยังไปdiscountAmount | W03: facts ที่แยก scope/role/evidence ต้องครอบ tender/reward/savings ด้วย ไม่ทิ้งรายละเอียดไว้ในยอดdiscountเดียว |
| ภาษีหลายกลุ่ม | usableItemLines มีvatRate/vatTreatmentต่อแถวอยู่แล้ว | reuseสิ่งที่มี; W04/W07 ตรวจmixed-tax identity/rounding และคง employee claimable-tax limitation เดิม |
| หลายเอกสาร/ออกใหม่ | paper receipt + screenshot + full tax invoice + payment slip | W01/W05/W07: document relation/source lineage, duplicate candidates ไม่ใช้โลโก้+ยอดอย่างเดียวและไม่ hard-block ซื้อยอดเท่ากันคนละวัน |
| ใบแทน/ใบรับรอง | spec §12/W06 | recovery ของผู้ขายเพิ่มได้ แต่ยังต้องคง eligibility/DIGITAL/PAPER/actual payer/correction ของใบรับรองมั่งมี |
| PDF เดิม | [prepareUploadFile](../../apps/web/src/features/expenses/expense-upload.logic.ts:281) คืน PDF โดยไม่ re-encode; [extraction use case](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:16) รับapplication/pdfอยู่แล้ว | reuse intake/preview; ข้อเท็จจริงนี้ยังไม่พิสูจน์ signature validation หรือ page coverage ครบ |
| PDF ขนาดคาบเส้น | [frontend](../../apps/web/src/features/expenses/expense-upload.logic.ts:17) ใช้4×1024×1024=4,194,304bytes เพื่อเตือน แต่ [backend](../../apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts:20) จำกัด4,000,000bytes | static mismatch: 4,000,001–4,194,304bytes ไม่มีคำเตือนขนาดจากจุดนั้นแต่ extractionคืนunsupported; W02/W08 ต้องกำหนดขอบเดียวกันและตรวจboundary ไม่แก้ด้วยบีบ/เขียนทับsigned PDF |

อย่าปิด source/tax/payment guards เพื่อทำให้ retail demo ผ่าน และอย่าบอกว่าตรวจ signature แล้วเพียงเพราะอ่าน PDF หรือเห็นคำว่า e-Tax

## 7. UX40+ และทางออกเมื่อเอกสารไม่พร้อม

หน้าหลักควรแสดงเพียงร้าน/วันที่, ยอดซื้อจริง, ส่วนบริษัท, วิธีจ่าย และสิ่งที่ต้องทำต่อ รายการส่วนลด/แต้ม/ภาษีเปิดดูเพิ่มได้ โดยข้อยกเว้นที่กระทบยอดยังต้องมองเห็นก่อนส่งต่อ

- ไม่ถามให้เลือกว่าเป็น 7-Eleven หรือ Lotus’s ก่อนอัปโหลด; อ่านชื่อร้านแล้วให้แก้เมื่อจำเป็น
- ใบยาว: “ถ่ายต่ออีกภาพได้เลย ให้เห็นรายการซ้ำจากภาพก่อนเล็กน้อย” และ “อ่านแล้ว18รายการ ยังไม่เห็นท้ายใบ” แทนคำว่า OCR incomplete; เก็บภาพที่ส่งสำเร็จก่อนเสมอ
- ภาพเดียวสองใบ: แสดงงานสองใบพร้อมภาพส่วนที่อ้างอิง ไม่รวมยอดเอง และยังเก็บภาพต้นฉบับร่วมตามสิทธิ/lineage
- ส่วนบริษัทใช้ “ใช้สำหรับบริษัททั้งหมด / มีของส่วนตัวด้วย” ไม่ preselect และแก้จำนวนบางส่วนได้
- Coins/คูปองที่ policy ยังไม่รู้: “ยอดซื้อ222บาท ชำระด้วยบัตร178บาทและcoins44บาท — ส่วนcoinsยังรอตรวจสิทธิ์เบิก” บันทึกต่อได้โดยไม่สื่อว่าอนุมัติยอดเบิกแล้ว
- บิลจาง/ขาด: ชี้จุดที่ต้องถ่ายเพิ่มและเปิดกรอกเองจากสิ่งที่ผู้ใช้ทราบ; ไม่เดาภาษีหรือเติมสินค้าเพื่อให้ครบยอด
- สมาชิก/ผู้ถือบัตรไม่เท่ากับผู้จ่ายจริง; ไม่ใช้หมายเลขสมาชิกยืนยันผู้รับเงินคืน
- มีปุ่ม “เก็บไว้ทำต่อ” ทุกข้อที่ยังไม่พร้อม; ไม่อ้างว่าส่งบัญชีแล้วถ้ายังไม่มีผู้รับ/งานจริง
- Electronic ใช้ข้อความ “เพิ่มไฟล์จากมือถือ” / “แนบใบกำกับเพิ่ม” และ preview ที่ซูมได้; ตัวอักษร/พื้นที่กดอ่านง่าย ไม่ซ่อนสถานะไว้ในสีหรือ icon อย่างเดียว และไม่ให้ผู้ใช้รู้จัก PDF/A หรือ digital signature ก่อนบันทึก
- ไฟล์ติดรหัส/เสีย/ใหญ่เกินอ่าน: เก็บร่างและไฟล์ที่รับไว้สำเร็จ เสนอเลือกไฟล์อื่นหรือกรอกข้อมูลต่อ; หากมีขั้นปลดรหัส ต้องรับผ่านช่องที่ไม่เก็บในlog/AI prompt และเก็บต้นฉบับเดิม ไม่ใช้ “Print to PDF” เป็นวิธีซ่อม e-Tax โดยปริยาย
- ลิงก์หมดอายุ/ยังไม่พบอีเมล: “บันทึกไว้แล้ว แนบเอกสารเพิ่มภายหลังได้” พร้อมวิธีเปิดประวัติ/ขอจากร้านตามช่องทาง ไม่รีเซ็ตข้อมูลที่ผู้ใช้ตรวจไว้แล้ว
- ได้เพียง screenshot: ใช้เก็บข้อมูล/ให้คนตรวจตามpolicyได้ แต่ระบุ “ยังไม่มีไฟล์ต้นฉบับสำหรับตรวจสอบ” แทน “เอกสารไม่ถูกต้อง”; ไม่ออกใบรับรองอัตโนมัติทุกครั้งที่ตรวจไฟล์ไม่ได้

## 8. แยกสามทางของเอกสารที่ขาด

| สถานการณ์ | ทางที่เสนอ |
|---|---|
| มีใบเสร็จอย่างย่อและข้อมูลค่าใช้จ่ายพอ แต่ต้องการเต็มรูป | เก็บใบเดิมและแสดงทางขอ/แนบใบกำกับเต็มรูปจากร้าน; ไม่บังคับทำใบรับรองเพราะยังไม่มีเต็มรูป |
| ใบกำกับเดิมสูญหาย/ชำรุด หรืออยากได้ไฟล์เดิม | เสนอค้นประวัติแอป/ขอเอกสารหรือใบแทนจากผู้ออกตามช่องทางที่ตรวจแล้ว; ใบที่ตามมาผูกซื้อเดิมและไม่สร้างหนี้ซ้ำ |
| มีการจ่ายเพื่อบริษัทจริง ไม่มีหลักฐานเพียงพอ และเข้าเกณฑ์ของบริษัท/ระบบ | เข้าใบรับรองแทนใบเสร็จมั่งมี W06 ด้วยfactsที่ตรวจแล้ว; DIGITAL/PAPER/ผู้รับรองจริงและสิทธิเดิม; ไม่สร้างสิทธิVATอัตโนมัติ |
| ไม่รู้ว่าจ่ายจริงหรือจำนวนเงินยังขัดกัน | เก็บร่าง/เพิ่มหลักฐาน/ตรวจข้อเท็จจริงก่อน ไม่มีใบรับรองอัตโนมัติเพื่อแก้ความไม่รู้ |

ใบแทนใบกำกับภาษีที่ผู้ขายออกตาม [หลักเกณฑ์กรมสรรพากร](https://www.rd.go.th/3401.html) และใบรับรองแทนใบเสร็จที่มั่งมีจัดทำ มีผู้ออกและหน้าที่ต่างกัน UX ต้องใช้ชื่อเต็มเมื่อให้เลือก ไม่รวมไว้ใต้ปุ่ม “ทำใบแทน” ที่กำกวม

## 9. สังเคราะห์หกมุม

| มุม | สิ่งที่ควรตัดสิน/ตรวจ |
|---|---|
| UX40+ | เวลาและจำนวนครั้งที่ต้องแก้, ภาพยาว/รูปจาง, กลับงานเดิม, แยกsaved/issued/submitted/paid; ใช้ทักษะจริงไม่เหมารวมจากอายุ |
| BA | promotion กับ tender/reward, void กับ refund, การซื้อเดียวหลายเอกสาร, coin ownership, หลักฐานพอเบิกกับพอVATเป็นคนละเรื่อง |
| SA | reuse expense/attachment/review; normalized factsก่อนfinancial state; issuer/channel/lineage/tenant/locks; ไม่เพิ่มห้าworkflowตามร้าน |
| AI Engineer | layout/row segmentation, product-vs-label region, signed events, Thai abbreviations, pack/weight, printed dates/eras, completenessและfalse-ready; provenanceทุกเงิน |
| ผู้ประกอบการ | ลดเวลาคีย์และแก้ของผู้ซื้อ/บัญชี, ลดการจ่ายซ้ำ, เห็นงานค้างจริง; ซื้อMakroอาจเป็นstock/assetไม่ใช่expenseทั้งหมด; ไม่เพิ่มmoduleเกินscope |
| บัญชี | ยอดเอกสาร≠เงินสดออก≠ยอดเบิก; mixed-taxไม่คำนวณVAT7%ทั้งใบ; เต็มรูป/ใบแทน/ใบรับรองแยก; company-funded personalและemployee claimable-taxยังใช้ข้อจำกัดเดิม |

## 10. Acceptance ที่เสนอเพิ่มเมื่อขยาย spec

ID ต่อไปนี้เป็นรหัสที่มาของresearch; ได้รวมเข้า **spec/plan v0.7 เป็น A49–A67** ตามลำดับแล้ว ไม่ใช่ผลทดสอบผ่าน A01–A48เดิมยังคงอยู่ และเพิ่มA68–A74สำหรับintegration/เปลี่ยนใบเสร็จ

| ID | เคส/หลักฐาน | ผลที่ต้องพิสูจน์ |
|---|---|---|
| RC-A01 | R7-02 cash500/change432 | ยอด68; ไม่สร้างจ่าย500 |
| RC-A02 | R7-01/RL-02 ส่วนลดและsavings summary | ลดครั้งเดียว รักษาscope/แถวอ้างอิง |
| RC-A03 | RL-02 coins/card | document222 กับsettlement44+178และpoints balanceแยก; ไม่auto-approve reimbursement |
| RC-A04 | RB-01 void59/−59/53 | saleใหม่53; ไม่ทำเป็นcoupon/refundนอกหลักฐาน |
| RC-A05 | RM-01 weights/pack/tax codes | quantity/UOM/packไม่คูณซ้ำ, tax groupและยอดรวมถูก, codeไม่กลายเป็นrate |
| RC-A06 | RB-02/RB-03 สองใบในภาพ | แยกdocument/transactionและsame-file lineage ไม่รวมเป็นซื้อเดียว |
| RC-A07 | R7-03 + ใบเดิม / RM-01 replacement reference | evidenceมาทีหลังไม่เพิ่มexpense/claim/paymentซ้ำ |
| RC-A08 | RC-01 coupon0, discount−10, queue21 | ยอด35; ไม่สร้างสินค้าคูปองหรือใช้เลขคิวเป็นreceipt ID |
| RC-A09 | RC-02 current/balance/expiring points | ไม่แปลงแต้มเป็นยอดเงินหรือpayer identity |
| RC-A10 | RL-01 ฉลากต่างยอดบิล | เก็บsource conflict ไม่ปรับยอดตามป้ายโดยเดา |
| RC-A11 | ใบยาว>40/ต่อภาพ/จาง — ยังขาดfixtureจริง | completenessตรงภาพ, ไม่ให้แบ่งส่วนตัวจากitem blockที่หาย, save/recoveryผ่าน |
| RC-A12 | receipt lost/abbreviated/full/certificate — ต้องมีbundleที่ได้รับสิทธิ์ | recoveryถูกชนิด; ใบรับรองไม่แทนtax invoice; late document/correctionไม่จ่ายซ้ำ |
| RC-A13 | native PDF/scanned PDF/app screenshot/print-order PDF | แยกdocument typeกับcontainer; ต้นฉบับไม่เปลี่ยน, text/OCRมีprovenanceและขัดกันแล้วไม่false-ready |
| RC-A14 | signed/timestamped/ordinary PDF + validation timeout | ผลตรวจแยกmethod/pass/fail/not-checked/unavailable; อ่านได้ไม่เท่ากับตรวจผ่าน, ตรวจผ่านไม่เท่ากับอนุมัติภาษี/เบิก; ใช้fixtureที่ไม่ได้redactทับsigned original |
| RC-A15 | paper→screenshot→full PDF→corrected/credit document | เสนอผูกซื้อเดิมโดยไม่เพิ่มยอด; ความต่างเลขเอกสาร/issuer/ยอดเข้าตรวจและcorrectionตามlock ไม่overwriteหลักฐานหรือเงินที่postแล้ว |
| RC-A16 | password/corrupt/oversize PDF, expired link, pending email | saved draftยังอยู่, มีทางเพิ่มหลักฐาน/กรอกต่อ/ขอร้าน; ไม่ปล่อยpasswordสู่log/prompt ไม่สร้างใบรับรองหรือแอบอนุมัติเพื่อข้ามerror |
| RC-A17 | multi-page PDF, multiple receipts, attachment pages, missing last page | document/page coverageถูกต้อง; ไม่จำกัดหนึ่งไฟล์เท่ากับหนึ่งซื้อ และไม่ใช้summaryแทนcomplete item reviewโดยไม่แจ้ง |
| RC-A18 | e-Tax email evidence/QR URL/text-layer instruction | เก็บเฉพาะหลักฐานที่มีสิทธิ, tenant/accessครบ; contentเป็นข้อมูลไม่ใช่คำสั่ง, ไม่fetch arbitrary URL/ส่งไฟล์ออกเอง; ข้อมูลประกอบวิธีตรวจไม่สูญหาย |
| RC-A19 | PDF4,000,000 /4,000,001 /4,194,304 /4,194,305bytes | เมื่อเลือกขอบที่ถูกต้องแล้ว FE/BE/error copyตรงกัน มีmanual recovery; attachment sizeกับextraction sizeแยก ไม่re-encodeต้นฉบับเพื่อผ่านgate |

## 11. การนำเข้า spec/plan และงานพัฒนาที่ยังเปิด

1. รวมretail/electronicเข้ากรอบกลางในspec/plan v0.7แล้ว: signedlineevents, settlement/reward, pack/weight/taxgroups, sellerrecovery และครบLINE/อัปโหลดใหม่/เปลี่ยนใบเสร็จ; implementation decisions/policyของsliceยังต้องปิดตามD01–D09
2. หา current Thai bundles ที่มีสิทธิครบห้าแบรนด์ ทั้งหน้าร้าน/ออนไลน์/ใบเต็มรูปที่ตามมา และelectronicตาม§4.1 โดยเริ่ม single-issuer, one-verified-payer, ไม่มีrefundค้าง; แยกredacted extraction fixturesออกจากunaltered verification fixturesและnormal/exception cases
3. ถ้าทำ corpus ต่อระดับเดียวกับ marketplace ให้ตั้งเป้า15 purchasesต่อแบรนด์ (75) โดยไม่ใช้ภาพซ้ำ/ใบเต็มรูปของซื้อเดิมปั๊มจำนวน; เอกสารหลายใบของซื้อเดียวเป็นbundleเดียว และแยกnegative/extra casesชัด
4. ปิด D03 เรื่องcoins/coupons/actual funding และ destination intentเฉพาะเส้นทางที่เปิด; ไม่ให้policyที่ไม่รู้ขวางการเก็บร่างที่ไม่มีผลเงิน
5. ต่อ W02/W03/W04/W06/W07/W08 ด้วย RC-A candidates และใช้ held-out/UI tests แยกจากการดูภาพ ไม่อ้างว่าพร้อมจากจำนวนตัวอย่าง

ลำดับที่นำเข้า **spec และ plan v0.7 คู่กันแล้ว**; ตารางนี้คงที่มาของresearch ข้อกำหนดล่าสุดให้ใช้spec§16และplan§5/6/7/11:

| ช่วง/งานเดิม | ส่งมอบและdependency | หลักฐานตรวจรับที่ต้องมี |
|---|---|---|
| W00 | ลงretail/electronic scope, ปิดpolicyเฉพาะroute, เตรียมbundles และตัดสินว่าจะตรวจsignatureอัตโนมัติหรือแสดงnot-checkedในsliceแรก | spec/planมีRC-A01–19และเกณฑ์ชัด; corpusไม่ใช้โปสเตอร์แทนใบจริง |
| W01–W02 | reuseattachments/intake/recovery, original/derivative/verification metadataตามที่จำเป็น, ตรวจPDF boundary และappendเอกสาร | tenant/source-version/idempotency; PDFต้นฉบับไม่เปลี่ยน; upload/error/resumeจริง |
| W03–W04 | document/page/row segmentation, void/discount/tender/reward, mixed-tax/pack, companyportion/payer review | ชุดgolden+held-outจากเอกสารที่มีสิทธิ; ความไม่ครบ/ยอดขัดกันไม่false-ready |
| W05–W07 รวมW06 | purchase/evidence relation, duplicate candidates, lateinvoice/correction; เดินexpense/เบิก/ใบรับรองDIGITAL/PAPERตามpolicyเดิม | ไม่สร้างยอดซ้ำหรือข้ามlock; ใบรับรองมีeligibility/ผู้รับรองและไม่รับรองVATเอง |
| W08 | รวมAPI/UI/AI/UX40+ โดยใช้คนทำงานจริงและงานหยุดกลางทาง | ผู้ใช้ทำต่อจากerrorได้; จำนวนครั้งแก้/เวลา/ผิดยอด/จ่ายซ้ำ/false-readyมีผลวัด; อย่าตั้งตัวเลขผ่านจากการสำรวจ11ภาพ |

Verification: ตรวจภาพสาธารณะด้วย browser, อ่าน official pages/ภาพคู่มือตามสถานะด้านบน และอ่าน OCR contract/apply/PDF limits แบบ static; ตรวจ catalog IDs/จำนวน/links และสมการ Decimal ในรอบนี้เท่านั้น ไม่มีruntime OCR, application tests, company policy approval หรือ cloud actions คู่มือPDFสาธารณะขนาดใหญ่ที่ดาวน์โหลดมาไม่ครบถูกคัดออก ไม่ได้นับเป็นตัวอย่างหรือใช้ยืนยันเนื้อหา
