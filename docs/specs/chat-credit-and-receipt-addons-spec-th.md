# สเปก: ซื้อเครดิตแชตและจำนวนอ่านรูปเพิ่ม

วันที่: 2026-09-28
อัปเดตล่าสุด: 2026-09-29 — D12 รวมการปรับเครดิตเดิมและทุก dependency เข้ากับ source ร่วมใน §18
สถานะ: **ราคาและ D1–D12 ยืนยันแล้ว; ยังไม่ implement หรือเปิดขาย**. D9 คงการเติมเดิมจนวันครบรอบแล้วเริ่มยอดเต็ม; D10 รวมยอดแถมและยอดซื้อในช่อง “ยอดเพิ่มเติม” และไม่แสดงยอดกันไว้ให้ลูกค้า; D11 รับแนวทางแก้ทั้ง 10 จุด; D12 รวมการแก้ admin/config/usage/readers ให้สอดคล้องกัน. ไม่มีคำถามธุรกิจค้างในขอบเขต V1 นี้

เอกสารคู่กัน: [แผนงาน](../plans/chat-credit-and-receipt-addons-plan-th.md) · [มติและหลักฐานต้นทุน](../agent-memory/chat-credit-and-receipt-addons-discussion-2026-09-28.md) · [E2E impact audit](../research/chat-credit-and-receipt-addons-e2e-impact-audit-2026-09-28-th.md)

## 1. เป้าหมาย ผู้ใช้ และขอบเขต

OWNER ของบริษัทซื้อเครดิตแชตหรือจำนวนอ่านรูปใบเสร็จเพิ่มได้ จ่ายครั้งเดียว ได้ยอดเฉพาะสินค้าที่ซื้อ และใช้ร่วมกันภายในบริษัทเดิม โดยไม่เปลี่ยนแพ็ก สาขา สมาชิก วันสิ้นสมาชิก วันตัดเงิน หรือ subscription. สมาชิกที่มีสิทธิ์ใช้ AI/อ่านเอกสารใช้ยอดของบริษัทผ่านสิทธิ์งานเดิม; ผู้ซื้อไม่จำเป็นต้องเป็นคนใช้เอง

ลูกค้าเห็นจากหน้าเดียวว่าเหลือ “จากแพ็กเกจ” เท่าไร “ยอดเพิ่มเติม” เท่าไร และ “คงเหลือรวม” เท่าไร. ยอดเพิ่มเติมรวมยอดที่ผู้ดูแลให้และยอดซื้อ โดยไม่แยกสองช่องและไม่แสดงยอดที่ระบบกันไว้. ระบบยังแยกแหล่งยอดภายในเพื่อใช้ตามลำดับและคืนเงินถูกต้อง. แชตคิดตาม token; รูปคิดเป็นหน่วยคงที่ตาม §6. ประวัติการซื้อ/จ่ายเงินและประวัติใช้ยอดต้องตามกลับถึงกันได้

งานนี้รวม catalog, quote, one-time payment, paid apply, admin grant ผ่านกลไกเพิ่มยอดร่วม, ยอดแชตซื้อเพิ่ม, เครดิตแชตตามรอบสมาชิก, โควตารูปซื้อเพิ่ม, Web/LINE, การคืนเงิน/รายการซ้ำ, การย้ายกติกาเดิม และเกณฑ์ยืนยัน flow. ไม่รวมปรับราคา/สิทธิ์แพ็กหลัก แปลงเครดิตเป็นเงิน โอนยอดข้ามบริษัท auto top-up subscription ใหม่ หรือ engine ส่วนลดใหม่

## 2. มติที่ยืนยันแล้วและลำดับเอกสาร

1. ราคาและจำนวนใช้ §4 เท่านั้น แทนข้อเสนอราคาก่อนหน้าทั้งหมดในบทสนทนา
2. 1 เครดิตแชตแทนต้นทุน CHAT ที่มิเตอร์บันทึก 1 บาท; ไม่ใช่หนึ่งข้อความ เงินสด หรือส่วนลดบิล. เก็บจำนวนเป็นจำนวนเต็มหน่วยย่อย 0.01 เครดิต ไม่ปัดขึ้นเป็นหนึ่งเครดิตทุกข้อความ
3. เครดิตแชตจากแพ็กเริ่มต้น 80 ต่อรอบเดือนสมาชิก ใช้ก่อนยอดซื้อเพิ่ม. เครดิตแพ็กคงเหลือไม่ทบเมื่อครบรอบ; ยอดซื้อเพิ่มไม่ถูก reset พร้อมแพ็ก
4. ยอดซื้อเพิ่มทั้งสองชนิดมีอายุ **12 เดือนนับจากซื้อแต่ละครั้ง**. ซื้อรอบใหม่ไม่ต่ออายุยอดเก่า และซื้อเพิ่มไม่ต่ออายุสมาชิก
5. รายปีให้เครดิตแชตเป็น 12 รอบเดือนภายในสิทธิ์ที่จ่าย ไม่ให้ 960 เครดิตทันที. จำนวนอ่านใบเสร็จจากแพ็กรายปียังคงมติเดิมที่ให้โควตาทั้งปีทันที
6. เป้าธุรกิจคือ contribution margin เฉลี่ยรวมอย่างน้อย 70% ตามการใช้จริง ไม่ใช่รับประกันกำไรสุทธิหรือ margin ทุกบริษัทที่ใช้สิทธิ์ครบ
7. ตารางราคานี้ไม่เปลี่ยนหน่วยเครดิต ไม่หัก OCR ซ้ำจาก CHAT และไม่เปลี่ยนสิทธิ์ย้อนหลังของแพ็ก/ดีล/Admin
8. เมื่อสมาชิกหมดอายุ เก็บ purchased lots ที่ยังไม่หมดอายุไว้ แต่ใช้ไม่ได้จนกลับมามีสมาชิกที่ใช้งานได้. อายุ 12 เดือนยังนับจากการซื้อเดิม ไม่หยุดนับระหว่างพัก และกลับมาสมัครไม่ชุบ lot ที่หมดอายุแล้ว
9. Owner รับแนวทางแก้ impact ตามคำแนะนำและให้ admin console เพิ่มยอดผ่านกลไก ADD_ON เดียวกับการซื้อ ทั้งรูปและแชต. เพิ่ม/ใช้/คืนหน่วยและประวัติใช้รูปแบบเดียวกัน โดยคงแหล่งที่มาและการอนุมัติที่ตรวจสอบได้; ไม่ปรับแพ็กหรือ operational cap จากการเพิ่มยอด

สเปกนี้เป็นมติใหม่ด้านรอบเครดิตและแบบขาย add-on เหนือข้อความเดือนปฏิทิน/ไม่มี top-up ใน [สเปก 80 เครดิตเดิม](ai-chat-credit-default-80-spec-th.md). การคง override และ operational safety caps ของเอกสารเดิมยังมีผล. ส่วน receipt-only HIDDEN ใน [มติซื้อแพ็กเดิม](mangmee-billing-pack-amendment-2026-09-12.md) ยังคงเป็นสถานะระบบจนมีการนำสเปกนี้ไปพัฒนาและเปิดใช้อย่างชัดเจน; การเขียนเอกสารไม่เปิด gate เอง

## 3. มติ V1 ที่ยืนยันแล้ว

| ID | เรื่อง | กติกา/ข้อเสนอ | สถานะ |
| --- | --- | --- | --- |
| D1 | อายุยอดซื้อเพิ่ม | 12 เดือนปฏิทินต่อการซื้อ ใช้เวลาจ่ายสำเร็จที่ตรวจสอบแล้วเป็นจุดเริ่ม ไม่ใช้เวลารับ webhook | **Owner ยืนยัน 2026-09-28** |
| D2 | สมาชิกหมดอายุ | เก็บยอดที่ยังไม่หมดอายุไว้ ใช้ต่อเมื่อกลับมามีสมาชิก; เวลา 12 เดือนเดินต่อระหว่างพัก | **Owner ยืนยัน 2026-09-28** |
| D3 | ผู้ซื้อที่มีสิทธิ์ | ทุก paid tier/ดีลที่มีสิทธิ์ใช้งานชนิดนั้นและมีช่วงสมาชิกที่ชำระแล้ว; OWNER ซื้อผ่าน billing เดิม. Trial/manual-only ยังไม่ซื้อเองใน V1; grace ไม่สร้าง included cycle ใหม่ และไม่เปิดซื้อเพิ่มจนต่อสมาชิกสำเร็จ | **Owner รับตามคำแนะนำ 2026-09-28** |
| D4 | หน่วยรูปและลำดับใช้ | V1 ขายการอ่านไฟล์ภาพหนึ่งหน้าเป็น 1 หน่วยเมื่อมีผลใช้งานได้; ใช้สิทธิ์แพ็ก/ของแถมก่อนยอดซื้อเพิ่ม. PDF/เอกสารหลายหน้าไม่ใช้ยอดซื้อเพิ่มใน V1 | **Owner รับตามคำแนะนำ 2026-09-28** |
| D5 | คืนเงินเชิงพาณิชย์ | เจ้าหน้าที่ตรวจเป็นกรณี ไม่เปิด self-service refund. คืนยอดที่ยังไม่ใช้ตามราคาเดิมที่จ่าย; ส่วนใช้แล้วหรือข้อยกเว้นเป็นการอนุมัติแยก | **Owner รับตามคำแนะนำ 2026-09-28** |
| D6 | Admin ใช้กลไกเพิ่มยอดร่วม | การซื้อและ admin เพิ่มยอดผ่าน ADD_ON grant application เดียวกัน ทั้ง CHAT_CREDIT และ RECEIPT_IMAGE; สิทธิ์/หลักฐานต้นทางแยกตาม source แต่ผลต่อยอดและสมาชิกใช้ invariant เดียวกัน | **Owner ยืนยัน 2026-09-28** |
| D7 | แหล่ง admin grant รุ่นแรก | ยอดแถม/ชดเชยที่ไม่มีรายรับเท่านั้น; ไม่รองรับการบันทึกรับเงินนอกระบบใน V1 | **Owner ยืนยัน 2026-09-28** |
| D8 | อายุและลำดับใช้ admin grant | 12 เดือนจากเพิ่มยอดสำเร็จ, พักใช้เมื่อสมาชิกหมดอายุแต่ expiry เดินต่อ, ใช้แพ็ก → admin gift → purchased; ภายในกลุ่มใช้หมดอายุก่อน ทั้งรูปและแชต | **Owner ยืนยัน 2026-09-28** |
| D9 | ย้ายลูกค้าเดิมไปวันครบรอบ | คงการเติมตามกติกาเดิมจนวันครบรอบถัดไปที่มี paid coverage แล้วทิ้งยอดแพ็กเดิมที่เหลือและเริ่ม allowance เต็ม (default 80; คง override/deal จริง); หลัง cutover ไม่มีเติมต้นเดือนอีก. รับต้นทุน legacy grant ช่วงรอยต่อ ไม่ prorate และไม่ reset ยอดซื้อ/แถม | **Owner ยืนยัน 2026-09-29: “คงการเติมเดิมจนถึงวันครบรอบ (แนะนำ)”** |
| D10 | ยอดและภาษาหน้าลูกค้า | รวม admin gift กับ purchased เป็น “ยอดเพิ่มเติม”; แสดงจากแพ็กเกจ/ยอดเพิ่มเติม/คงเหลือรวม. ไม่แสดงยอดกันไว้หรือข้อมูลภายใน. ข้อความไทยและ field/value ต้องตรงกันทั้ง Web/LINE/ประวัติ/เอกสาร | **Owner ยืนยัน 2026-09-29** |
| D11 | แนวทางแก้ 10 จุด U01–U10 | รับแนวทางแก้ทั้งหมดใน customer-balance consistency audit และ §17 เป็นข้อกำหนด; ใช้ของเดิมที่ถูกต้อง รักษา permission/source/hold/delivery guards และตรวจ dependency ทุกช่องทาง. การรับแนวทางไม่ใช่หลักฐานว่าแก้ runtime แล้ว | **Owner รับตามคำแนะนำ 2026-09-29: “เอาตามที่แนะนำปรับเลย”** |
| D12 | ปรับเครดิตเดิมและ source ร่วมทั้ง flow | รวม admin grant, operational settings, package/deal/payment writers, usage/repair, read projections และข้อความในงานเดียวตาม §18; ข้อมูลชนิดเดียวกันมี authority เดียว. Valid flow ต้องไม่ติดเงื่อนไขคนละงาน; ไม่ยกเลิกการตรวจสิทธิ์/ยอด/เงินที่จำเป็น | **Owner สั่งปรับ spec+plan 2026-09-29 ให้แก้ร่วมกันและข้อมูลออกจาก source เดียวกัน** |

D1–D12 ยืนยันครบแล้ว ไม่ต้องขอยืนยันมติเดิมซ้ำ. D9 มาจากคำตอบเลือกคงการเติมเดิมโดยตรง ไม่ใช่การอนุมานจาก D11. Technical lock design และการตรวจ paid anchor เป็นหน้าที่ implementation ไม่ใช่เรื่องที่ให้ Owner ตัดสินวิธีเขียนโค้ด; หากข้อมูลบริษัทใดยังไม่พอให้ใช้กติกาพักไว้ใน legacy ตาม §11

## 4. Catalog ราคา และต้นทุนอ้างอิง

ค่าราคาเก็บเป็นสตางค์ THB; offer ID ด้านล่างเป็น target contract ใหม่ ไม่ใช่ Stripe Price ที่สร้างแล้ว

| Offer key | สินค้า | จำนวน | ราคาขาย (บาท) | ราคาขาย (สตางค์) | อายุ |
| --- | --- | ---: | ---: | ---: | --- |
| CHAT_50 | เครดิตแชต | 50 เครดิต | 299 | 29900 | 12 เดือน |
| CHAT_100 | เครดิตแชต | 100 เครดิต | 549 | 54900 | 12 เดือน |
| CHAT_300 | เครดิตแชต | 300 เครดิต | 1499 | 149900 | 12 เดือน |
| RECEIPT_IMAGE_20 | อ่านรูปใบเสร็จ | 20 รูป | 349 | 34900 | 12 เดือน |
| RECEIPT_IMAGE_50 | อ่านรูปใบเสร็จ | 50 รูป | 799 | 79900 | 12 เดือน |
| RECEIPT_IMAGE_100 | อ่านรูปใบเสร็จ | 100 รูป | 1499 | 149900 | 12 เดือน |

ราคาอ้างอิงนโยบายปัจจุบัน NOT_VAT_REGISTERED; quote ต้องใช้ tax policy revision จริงและแสดงยอดชำระทั้งหมด. การเปลี่ยนภาษีภายหลังใช้ publication/preview เดิม ไม่ silently ลด margin ด้วยการตีความราคาเป็นรวม VAT ใหม่ และไม่คำนวณเอกสารเก่าย้อนหลัง

| สินค้า | AI เฉลี่ย/หน่วย (บาท) | AI + ค่ารับเงินเฉลี่ย/หน่วย (บาท) | เหลือทั้งชุด (บาท) | Contribution margin |
| --- | ---: | ---: | ---: | ---: |
| แชต 50 | 1.00 | 1.47 | 225.34 | 75.4% |
| แชต 100 | 1.00 | 1.34 | 414.51 | 75.5% |
| แชต 300 | 1.00 | 1.25 | 1123.34 | 74.9% |
| รูป 20 | 3.50 | 4.79 | 253.18 | 72.5% |
| รูป 50 | 3.50 | 4.41 | 578.68 | 72.4% |
| รูป 100 | 3.50 | 4.26 | 1073.34 | 71.6% |

ตารางต้นทุนเป็นสมมติฐานวางราคา ไม่ใช่ราคาเรียกเก็บตามต้นทุน: ค่ารับเงิน = 1.07 × (ราคา × 0.0405 + 10). ยังไม่หัก server ทีมงาน พัฒนา หาลูกค้า หรือความเสียหายจาก refund. หลักฐานเดิมและข้อจำกัดอยู่ใน memory; ไม่ใช้ค่า OCR 3.50 เป็นค่าที่การจูนแชตยืนยันแล้ว. ค่าแชต 0.64 บาท/ข้อความที่ Owner ส่งมาใช้สื่อสารภายในเท่านั้น ไม่รับประกันว่าซื้อแล้วคุยได้กี่ข้อความ

V1 ไม่มี coupon/ส่วนลด/ตั๋วงานอีเวนต์/ดีลแพ็กที่ติดมากับ add-on โดยอัตโนมัติ. การเสนอส่วนลด add-on เป็นมติใหม่ที่ต้องประเมินจากยอดจ่ายสุทธิ ไม่เปลี่ยนราคา 6 รายการนี้เอง

## 5. เครดิตแชตตามวันครบรอบและการตัดยอด

### 5.1 รอบเครดิตจากสมาชิก

- ยึดวันและเวลาที่เริ่มสิทธิ์สมาชิกจาก paid application ที่ตรวจสอบแล้วใน Asia/Bangkok เป็น anchor; เก็บ timestamp UTC พร้อม anchor ที่ใช้คำนวณอย่างถาวร. รอบเป็นช่วง [start, end); ไม่ใช้ 30 วันคงที่
- ตัวอย่างเริ่ม 15 กันยายน 10:00 น. → รอบแรกถึง 15 ตุลาคม 10:00 น.; ครบรอบแล้วตั้งสิทธิ์ใหม่ 80 เครดิต ไม่บวก 80 ทับยอดเก่า. Anchor วันที่ 31 clamp เป็นวันสุดท้ายของเดือนสั้น และกลับไปวันที่ 31 ในเดือนที่มี ห้ามให้ anchor ไหลเป็นวันที่ 28 ถาวร
- สร้างรอบปัจจุบันแบบ idempotent จากสิทธิ์ที่ชำระแล้ว; ไม่ให้เครดิตย้อนหลังทุกเดือนที่ไม่ได้เข้าใช้งาน. หลักฐานรอบมี unique source และ allowance snapshot
- Upgrade/downgrade/ซื้อแพ็กซ้ำ/ต่ออายุล่วงหน้า/เติมเครดิตไม่สร้างรอบใหม่กลางรอบ. การสมัครใหม่หลังสิทธิ์ขาดช่วงเริ่ม continuity/anchor ใหม่เมื่อ paid apply; การจ่ายต่ออายุล่าช้าใช้ช่วงบริการจริงที่ยืนยัน ไม่ใช้เวลามาถึงของ event เป็น anchor
- รายปีตรวจ coverage ที่ชำระแล้วก่อนสร้างแต่ละรอบ. ยกเลิกต่ออายุยังใช้รอบที่ชำระถึงได้; grace หรือ invoice ที่ยังไม่จ่ายไม่สร้าง allowance ใหม่. การใช้ยอดซื้อเพิ่มระหว่างหมดสมาชิกยึด D2
- Default 80 ไม่เขียนทับ admin/deal override. ยึด resolver/provenance เดิม: ดีล CHAT แยกจาก TOTAL เดิม และไม่เปลี่ยน cap กลางรอบเป็น grant ฟรีซ้ำ. การลด allowance ไม่สร้างยอดติดลบหรือหนี้ลูกค้า

### 5.2 Purchased lots และ funding

- Credit lot แต่ละครั้งมีจำนวน วันจ่าย วันพร้อมใช้ วันหมดอายุ แหล่ง invoice/attempt และสถานะคืนเงินแยกกัน. 50 เครดิต = 5000 หน่วยย่อย; ไม่แปลงจากราคาขาย 299 บาทเป็น 299 เครดิต
- อายุ 12 เดือนคำนวณจากวันจ่ายสำเร็จแบบ calendar year/12 calendar months พร้อม clamp ปีอธิกสุรทิน. แสดงวันเวลาจริงให้ลูกค้า. ความล่าช้า apply ไม่สร้าง grant ที่มี expiry ต่างกันทุก retry
- ลำดับตัด: allowance จากแพ็กที่ยังใช้ได้ → ADMIN_GRANTED ตาม D8 → PURCHASED. ภายในแต่ละกลุ่มใช้ lot ที่หมดอายุก่อน → วันที่ให้/ซื้อก่อน → stable ID. ถ้างานเดียวเกินส่วนฟรี ให้แบ่ง debit ข้ามแหล่ง เช่น ฟรีเหลือ 1.25 ใช้ 2.00 → ฟรี 1.25 + ซื้อเพิ่ม 0.75
- Operator/internal projection แยก issued/used/reserved/available/expired/refunded; customer projection ใช้ §17 และไม่ส่งยอด reserved หรือ source breakdown ให้ลูกค้า; available ไม่ติดลบและหัก reservation ค้างแล้ว. lot หมดอายุหยุดรับงานใหม่ แต่ reservation ที่รับก่อนหมดอายุ settle กับ lot เดิมได้
- ผูกทุกคำขอ/การเรียกโมเดลกับ cycle และ lot ที่จองไว้ตั้งแต่รับงาน. การ settle หลังเที่ยงคืน/วันครบรอบไม่ย้ายค่าใช้ไปตัดรอบใหม่. ปล่อย hold ของ lot ที่หมดอายุแล้วไม่ชุบชีวิตเครดิต
- คำนวณการใช้จาก input/output token รวม context และ cached token ตามโมเดล/FX/pricing snapshot เดิมของแต่ละ call. deterministic reply ที่ไม่เรียก AI ไม่คิดเครดิต; transport retry/settle ซ้ำไม่คิดเพิ่ม. งานที่มีหลาย call รวมทุก call ที่เป็น CHAT หนเดียว
- ค่า provider ที่เกิดจริงต้องยังอยู่ใน AiUsageEvent แม้มีการชดเชยให้ลูกค้า; compensation เป็น entry แยกที่มีเหตุผล ไม่แก้ยอดต้นทุนจริงให้ดู margin ดีขึ้น

### 5.3 Reservation และ operational caps

แยก commercial credit balance ออกจาก monthly safety budgets. เครดิตเพิ่มใช้แทนเพดานสิทธิ์แชต 80 ที่หมด แต่ไม่ bypass TOTAL/OCR cap, permission, security hold หรือ model readiness. AiUsageEvent.monthKey และ aggregate เพื่อรายงานต้นทุนยังเป็นเดือนปฏิทิน; รอบสมาชิกต้องมี identity แยก ไม่เปลี่ยนความหมาย monthKey เดิม

ใช้ reservation/settlement และ invocationKey เดิมร่วมกับ funding allocation ของเครดิต ไม่สร้างมิเตอร์ token ชุดที่สอง. ทั้ง SHARED และ SPLIT ที่เปิด purchased CHAT ต้องจองยอดได้อย่าง durable ก่อนเรียก provider ตาม upper bound ที่คำนวณจากโมเดลจริง; ไม่อาศัยเพียง Redis lease หรือมี saldo > 0 แล้วปล่อยใช้ไม่จำกัด. ไม่บังคับเปลี่ยนทุกบริษัทเป็น SPLIT เพื่อเปิดสินค้า

ถ้า mapping/model/bound ไม่พร้อม ให้รายงาน ADDON_NOT_READY ก่อนขาย/ก่อน dispatch; ไม่เปิดขายแล้วเงียบ ๆ ใช้โหมดที่ไม่มี reservation. ถ้าต้นทุนเกิน bound บันทึกต้นทุนจริงและ issue ตาม breach flow เดิม แต่ไม่ debit ลูกค้าเกินยอด/วงเงินที่ได้รับอนุญาตหรือสร้างหนี้อัตโนมัติ. หลักฐานที่ยังไม่ทราบต้องคง hold ไม่ปล่อยเพราะ timeout; ใช้ [การกระทบยอด hold เดิม](line-ai-credit-hold-reconciliation-spec-th.md)

เมื่อ cap เชิงปฏิบัติการปิดการใช้ ให้หน้าแสดงเหตุผลตรง scope และช่องทางแก้ ไม่เสนอซื้อเพิ่มว่าแก้ได้. Quote ตรวจ readiness/known blocking cap อีกครั้ง; หลังจ่ายหากเกิด security/cap hold ให้แสดงยอดที่ได้รับแต่ยังใช้ไม่ได้ หรือ paid-held ตามเหตุจริง ไม่ต่อสมาชิกเพื่อหลบ cap

## 6. หน่วยอ่านรูปและการใช้โควตา

มติ D4: รูปหนึ่งหน้าในชนิดไฟล์ที่ระบบรองรับอยู่ = 1 หน่วยเมื่ออ่านแล้วมีผลใช้งานได้และบันทึก durable แล้ว. NEEDS_REVIEW ที่มีข้อมูลให้ตรวจถือว่าอ่านแล้ว ไม่ต้องรอผู้ใช้ยืนยันลงบัญชี. หลาย provider calls/repair/reread ภายในงานเดิมยังเป็นหนึ่งหน่วย

- ใช้สิทธิ์แพ็กที่ยังใช้ได้ → ยอดแถมจาก admin → purchased image lots ตาม D8; ภายในแต่ละกลุ่มใช้วันหมดอายุก่อน. ต้องระบุการเปลี่ยนลำดับจาก FEFO รวมของ implementation เดิมอย่างชัดเจนและไม่แก้ประวัติเก่า
- จองหน่วยก่อน provider; success เปลี่ยนเป็นใช้แล้ว, technical failure ที่ไม่มีผลใช้งานได้คืนหน่วยเดิม. ภาพผิดประเภท/อ่านไม่ได้ไม่มีหน่วยใช้สำเร็จ; เก็บ provider cost และใช้ rate limit เดิม ไม่แจก provider retries ไม่จำกัด
- webhook/queue/network retry, ส่งผลลัพธ์เดิมซ้ำ หรืออ่านซ้ำอัตโนมัติใน operation เดิม ไม่ตัดอีก. ผู้ใช้สั่งอ่านใหม่เป็น operation ใหม่ต้องแจ้งก่อนว่าจะใช้หนึ่งหน่วย; ไม่อ้าง hash ไฟล์อย่างเดียวให้ทุกการส่งภาพซ้ำใช้ฟรี
- เครดิตแชตหมดไม่ปิด OCR ที่ยังมีสิทธิ์; โควตารูปหมดไม่ปิด CHAT ที่ยังมีเครดิต. ภาพที่ใช้เข้าเส้นทาง OCR ห้ามถูกหักทั้งรูปและ CHAT สำหรับ routing เดียวกัน
- ราคา flat ครอบการอ่านรูปตามข้อจำกัดไฟล์เดิม ไม่สัญญาว่าหนึ่งรูปที่รวมเอกสารหลายสิบใบหรือ PDF หลายหน้าคือหนึ่งหน่วย. V1 purchased image lots ไม่ใช้กับ PDF/bank statement/signature/งานสร้างภาพ; การใช้สิทธิ์แพ็กเดิมในเส้นทางเหล่านี้คงเดิมและ UI ต้องบอกข้อจำกัดก่อนซื้อ
- ต่อแพ็กหรือซื้อแพ็กซ้ำยังเป็น flow เดิม: โควตาแพ็กอาจเพิ่ม/ขยายตามมติเดิม แต่ห้ามขยาย expiry ของ ADD_ON. Refund add-on ไม่กระทบโควตาจากแพ็กอื่น

## 7. Journey ลูกค้าและสถานะหน้าจอ

1. OWNER เปิด Billing จาก Web หรือ LINE handoff ที่ยืนยันบริษัท/ผู้ใช้แล้ว เห็นสองบัตร “เครดิตแชต” กับ “จำนวนอ่านรูปใบเสร็จ”. แต่ละบัตรมี “จากแพ็กเกจ”, “ยอดเพิ่มเติม”, “คงเหลือรวม” ตาม customer projection §17; ไม่แสดงแยกยอดแถม/ยอดซื้อหรือยอดกันไว้
2. เลือกหนึ่ง offer ต่อ checkout. แสดงจำนวน ราคา ยอดจ่ายจริง อายุ 12 เดือน เงื่อนไขสมาชิก และ “ซื้อครั้งเดียว ไม่เปลี่ยนแพ็กเกจหรือวันหมดอายุสมาชิก”
3. Quote ฝั่ง server pin account/mode/company/actor/offer revision/tax/unit/expiry rule/consent/source versions. ลูกค้าส่งเฉพาะ offer key และวิธีจ่าย ไม่ส่งราคา/จำนวน/ยอดคงเหลือให้ server เชื่อ
4. Confirm ด้วย idempotency key เดิม → CARD_ONCE หรือ PROMPTPAY_ONCE ผ่าน adapter/Checkout/QR เดิม. ไม่ใช้ CARD_AUTO, PROMPTPAY_RENEW หรือ subscription item
5. Return/refresh แสดงข้อความตามสถานะจริงในตารางและ §17.4 จน provider evidence ยืนยันผล. ปิดหน้าแล้วกลับมาเปิดรายการเดิมได้; ไม่ให้ชำระซ้ำเพราะ timeout
6. เมื่อ paid และ apply สำเร็จ เพิ่มยอดสินค้านั้นแบบ atomic แล้ว refresh customer projection/history. Admin grant เพิ่มใน “ยอดเพิ่มเติม” เดียวกัน. การแจ้งเตือนใช้ outbox เดิมและ dedupe; notification ล้มเหลวไม่ rollback หรือเพิ่มยอดซ้ำ
7. ใช้งาน → reserve/settle ภายใน → ลูกค้าเห็นผล “ใช้เครดิตแชต” หรือ “อ่านรูปใบเสร็จ” ต่อ logical operation. ไม่แสดง reservation/child call/cycle/lot ID ในประวัติ. ซื้อ/ให้เพิ่มแต่ละครั้งยังมีวันหมดอายุเดิมของตัวเองและมีรายละเอียดที่ลูกค้าดูได้

| สถานะภายใน | สิ่งที่ลูกค้าเห็น/ทำได้ | ผลต่อยอด |
| --- | --- | --- |
| Loading | “กำลังโหลดข้อมูล…” ไม่แสดง 0 เป็นยอดจริง | ไม่เปลี่ยน |
| ไม่มีสิทธิ์ซื้อ | เห็นยอดเท่าที่สิทธิ์ read เดิมอนุญาต; “ให้เจ้าของบริษัทเป็นผู้ซื้อเพิ่ม” | ไม่เปลี่ยน |
| ไม่มีรายการ | แสดง 0 เมื่ออ่านข้อมูลสำเร็จและยอดเป็น 0 จริง; “ยังไม่มีรายการ” ในประวัติ | ไม่เปลี่ยน |
| Pending payment | “รอชำระเงิน” พร้อม “กลับไปชำระรายการเดิม” | ยังไม่เพิ่ม |
| Unknown payment | “กำลังตรวจสอบการชำระเงิน กรุณาตรวจรายการเดิมก่อนชำระอีกครั้ง” | ไม่เดาผล |
| Paid / applying | “ชำระเงินแล้ว กำลังเพิ่มยอดให้” | เพิ่มเมื่อ commit เท่านั้น |
| Paid / held | “ชำระเงินแล้ว แต่ยังเพิ่มยอดไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขรายการ” | เก็บหลักฐานเดิม ไม่สร้าง checkout ใหม่เพื่อซ่อม |
| Applied | “เพิ่มเครดิตแชตแล้ว” หรือ “เพิ่มจำนวนอ่านรูปใบเสร็จแล้ว” พร้อมจำนวนและวันหมดอายุ | เพิ่มครั้งเดียว |
| Expired / failed / cancelled unpaid | “รายการชำระเงินหมดเวลา” / “ชำระเงินไม่สำเร็จ” / “ยกเลิกรายการแล้ว” ตามหลักฐานจริง | ซื้อใหม่ได้เมื่อยืนยันรายการเดิมเก็บเงินไม่ได้ |
| สมาชิกหมด | “สมาชิกหมดอายุแล้ว ต่ออายุสมาชิกเพื่อใช้ยอดที่ยังไม่หมดอายุ” | ยอดที่ยังไม่หมดอายุคงอยู่; ไม่แสดงว่าใช้ได้ตอนนี้ |
| Refund/dispute review | “กำลังตรวจสอบคำขอคืนเงิน” หรือ “รายการชำระเงินนี้อยู่ระหว่างตรวจสอบ” | จัดการ refund freeze ภายใน ไม่แสดงยอดกันไว้ |

Info hint แชต: “เครดิตที่ใช้ขึ้นอยู่กับปริมาณข้อความที่ส่ง คำตอบที่ได้รับ และข้อมูลประกอบการตอบ ระบบนับเป็นหน่วยข้อความที่เรียกว่าโทเคน แต่ละครั้งจึงใช้เครดิตไม่เท่ากัน” ใช้หน่วยเครดิตไม่ใช่บาท. Info hint รูป: “อ่านรูปใบเสร็จ 1 รูป ใช้ 1 ครั้ง ยอดเพิ่มเติมใช้กับไฟล์ภาพหนึ่งหน้า และมีอายุ 12 เดือนนับจากวันที่ได้รับแต่ละรายการ” เงื่อนไข PDF และแพ็กเดิมยังยึด D4

### 7.1 ตำแหน่งราคาบนหน้าจอเป้าหมาย

ตำแหน่งเสนอจากโครง BillingPage ปัจจุบันตามคำถาม Owner “ราคาซื้อเพิ่มจะอยู่ตรงไหนของจอจริง”; เป็น UI target ในเอกสาร ยังไม่มี runtime และ Owner ยังปรับตำแหน่งได้

- หน้า `/companies/[companyId]/billing` หัวข้อ “แพ็กเกจและการชำระเงิน”: ลำดับแท็บ **แพ็กเกจ | เครดิตและรูป | การต่ออายุและชำระเงิน | ประวัติ**. เพิ่ม “เครดิตและรูป” ถัดจากแท็บแพ็กเกจเดิม
- ในแท็บใหม่ แสดงยอดคงเหลือแยก CHAT/IMAGE ก่อน แต่ละบัตรมีจากแพ็กเกจ/ยอดเพิ่มเติม/คงเหลือรวม พร้อมวันเติมรอบถัดไปและรายการยอดที่จะหมดอายุ; ไม่แยกผู้ดูแลกับยอดซื้อ และไม่แสดงยอดกันไว้ตาม §17. ใต้ยอดวางส่วน “ซื้อเครดิตแชตเพิ่ม” และ “ซื้อจำนวนอ่านรูปเพิ่ม” แยกกัน แต่ใช้ card pattern เดียวกัน
- แต่ละส่วนแสดงสามชุดราคา: CHAT 50/100/300 = 299/549/1,499 บาท; IMAGE 20/50/100 = 349/799/1,499 บาท. ทุก card มีจำนวน ราคาเต็มต่อชุด และปุ่มซื้อ; ราคา/availability อ่าน catalog กลาง ไม่ hardcode แยกหน้าจอ
- แสดงอายุ 12 เดือนและเงื่อนไขสมาชิกข้างส่วนซื้อ พร้อม hint token สำหรับ CHAT และหนึ่งรูปตาม D4 สำหรับ IMAGE. ก่อนจ่ายมี review จำนวน/ราคาสุทธิ/อายุยอด/บริษัทที่ได้รับยอด; ไม่ใช้หน้าซื้อเพิ่มแสดง provider cost หรือ margin
- ในแท็บ “แพ็กเกจ” ใต้สรุปยอดแต่ละสินค้าให้ปุ่ม “ซื้อเครดิตเพิ่ม” / “ซื้อจำนวนอ่านรูปเพิ่ม” พาไปยังส่วนสินค้าที่ตรงกันในแท็บใหม่. จุดเครดิตหมดใน Web/LINE ส่ง deep link เข้าส่วนเดียวกันตามสิทธิ์/readiness; ไม่เปิดหน้าซื้อแพ็กใหม่โดยปริยาย
- Desktop แสดงสาม price cards ต่อแถวในแต่ละสินค้า; mobile เรียงลงและให้แถบแท็บเลื่อนแนวนอนได้โดยไม่ตัดชื่อ/บีบปุ่ม. ไม่เปิด checkout ทันทีจาก deep link; ต้องเลือกชุดและตรวจ quote ก่อน
- Admin console การเพิ่มยอดแถม/ชดเชยใช้ฟอร์มสินค้า/จำนวน/เหตุผล/วันหมดอายุและ preview ตาม §16; ไม่แสดงราคาขายเป็นยอดเรียกเก็บ และไม่สร้างช่องกรอกเงินรับนอกระบบ. ราคาขายที่ลูกค้าเห็นใช้ catalog/policy revision เดียวกับ quote

## 8. Contracts และขอบเขตสถาปัตยกรรม

Reuse [billing integration](mangmee-owned-billing-integration-spec-th.md), [billing controls](mangmee-billing-controls-spec-th.md), BillingService/assertOwner, BillingAttempt/Invoice, reconciler, payment evidence validators, scopes, refunds, notifications และ receipt admission เดิม. AI Gateway ส่ง usage/settlement ผ่าน permission-checked API เท่านั้น ไม่มีการเข้าฐานข้อมูลหรือเพิ่มยอดซื้อเอง

### 8.1 Target API แบบ additive

ชื่อ field/route ด้านล่างเป็น contract เป้าหมายสำหรับ implementation; ห้ามระบุว่ามี runtime แล้ว

| Seam | Target contract |
| --- | --- |
| Catalog | เพิ่ม addOnOffers แยกจาก package offers: offerKey, productKind CHAT_CREDIT/RECEIPT_IMAGE, quantityUnits, unitScale, priceSatang, currency, validityMonths=12, availability/reason. ข้อมูลส่วนบุคคลอยู่ authenticated read |
| Quote เดิม | เพิ่ม discriminated purchaseIntent=ADD_ON + addOnOfferKey; FULL_PACKAGE เดิมคง shape/behavior. ห้ามส่ง tier/interval/deal/discount คละกับ ADD_ON |
| Checkout เดิม | quoteId/accepted consent + idempotency key; one-time modes เท่านั้น. Snapshot pin purchaseIntent เพื่อไม่ตกเข้า full-package apply |
| Billing status / quota read | เพิ่ม customer quotaSummary ตาม §17: packageRemainingUnits/additionalRemainingUnits/totalRemainingUnits, unitScale, วันเติม/หมดอายุและ public use/purchase states. ไม่มี reserved/admin-vs-paid breakdown/internal blockedReason. Operator ใช้ scoped projection แยก |
| Usage history | authenticated company-scoped read: cursor, product, time range, public operation reference/type/quantity/date/expiry ตาม §17. ไม่ส่ง reservation/lot/source-operation hashes หรือ internal reason. Financial history/document ยังคงสิทธิ์เดิม |
| Attempt/history/documents | reuse endpoints เดิม เพิ่มชนิดสินค้า/จำนวน; receipt/invoice ต้องเป็นค่าบริการมั่งมี แยกจากใบเสร็จธุรกิจลูกค้าที่นำมา OCR |

Error code เป้าหมาย: ADDON_NOT_READY, ADDON_MEMBERSHIP_REQUIRED, ADDON_OFFER_UNAVAILABLE, CHAT_CREDIT_INSUFFICIENT, RECEIPT_UNITS_INSUFFICIENT; reuse billing quote-stale/purchase-pending/payment-held codes เมื่อความหมายตรง. TOTAL/OCR operational refusal คง scope เดิม ไม่แปลงทุก error เป็นยอดหมด

### 8.2 Data impact ที่เล็กที่สุด

| พื้นที่ | สิ่งที่เพิ่ม/ปรับ | ขอบเขตที่ต้องรักษา |
| --- | --- | --- |
| BillingPolicyRevision / contracts | add-on catalog/price mappings และ gates แยกต่อ product ใน policy revision; field ใหม่หาย = unavailable | ไม่เปลี่ยน package priceIds หรือเปิดขายจากค่า default |
| BillingQuote/Attempt/Invoice | snapshot version + purchaseIntent/product/units/validity/payment evidence; reuse lifecycle และ source invoice เดิม | legacy snapshots ยังเป็น package; test/live/account isolation ทุก key |
| BillingInvoice product discriminator | เพิ่ม productKind ที่ query ได้: PACKAGE/CHAT_CREDIT/RECEIPT_IMAGE, legacy default PACKAGE และต้องตรง immutable source snapshot | membership readers เลือก PACKAGE; add-on validity ไม่เป็นช่วงสมาชิก ดู §15.1 |
| CHAT grants (ใหม่) | lot ของ INCLUDED_CYCLE, PURCHASED และ ADMIN_GRANTED: company, sourceKey/hash, anchor/cycle identity, units ในหน่วยย่อย, validity, invoice/account reference สำหรับ purchased, revoked/frozen state | unique source; anchor มาจาก paid continuity. ไม่ทำ general-purpose wallet หรือ cash balance |
| CHAT funding entries (ใหม่) | allocation ของ reservation/debit/release/correction/refund ต่อ grant; request/invocation/usageEvent/reservation/source-operation references และจำนวนเต็ม | append-only corrections, unique settlement/operation key; meter provider cost เดิมยังเป็นต้นทุนจริง |
| AiBudgetReservation | ผูก funding/cycle ของ CHAT กับ reservation เดิม; รองรับ wallet reservation โดยไม่เปลี่ยนความหมาย SHARED/SPLIT operational policy | ก่อน provider ต้องจองได้จริง; timeout ไม่เพิ่มยอดกลับเอง |
| BillingReceiptGrant | kind=ADD_ON และ helper ที่เพิ่มเฉพาะ lot; use 12-month validity ของ add-on ไม่ใช้ membership paidThrough. หาก reuse serviceStart/serviceEnd ให้หมายถึง validity ของ ADD_ON อย่าง explicit ใน helper/readers | grantPaidPackageReceipts เดิมแก้ CompanyPlanTerm และไม่รับ ADD_ON: ห้ามเรียกตรง ๆ แล้วอาศัย branch REPEAT. ADD_ON ต้องไม่ขยาย term/collection หรือถูก REPEAT ขยายอายุ |
| CompanyOcrUsageEvent | reuse grant reference/admission idempotency; แสดง source package/gift/add-on และรักษาหลักฐานการคืนหน่วย | ไม่เอาจำนวน AiUsageEvent มาเป็นจำนวนรูป; เก็บ unit effect แยกจาก provider call cost |
| Receipt commercial entries (ใหม่) | stable logical operation + generation + source lot; reserve/consume/release/revoke effects และ source versions ตาม §15.3 | หลักฐานคงอยู่แม้ admission เดิมเปลี่ยน ID/ถูกลบ; unique effects และ balance projection แยก held/consumed/released/frozen |

การเปลี่ยนยอดทุกชนิดอยู่ภายใต้ transaction/lock ที่สอดคล้องกัน. เส้นทาง receipt ปัจจุบันใช้ partner-ocr-config ก่อน Company/FK writes; reservation มีลำดับ partner-ocr-config → platform budget เมื่อจำเป็น → ai-budget ของเดือนที่ pin. ต้องทำ lock matrix ของ reserve/settle/cycle reset/apply/refund ตามของจริงก่อนเพิ่ม wallet lock; ห้ามใช้เพียง lock เดือน เพราะสองเดือน/สองรอบอาจแข่งแย่ง purchased lot เดียวกัน. ไม่มี provider I/O ระหว่างถือ DB transaction

## 9. Paid apply, duplicate และการกู้รายการ

- Financial validation ยืนยัน Stripe account/livemode, customer/company, original attempt, payment currency/amount/tax, exact approved Price/quantity และ charge ที่รับเงินสำเร็จ. ไม่ใช้ browser return, client metadata, event ชื่อ paid หรือ webhook signature อย่างเดียวเป็นสิทธิ์เพิ่มยอด
- แยก payment status จาก application status. เพิ่ม grant + source marker + audit + outbox ภายใน transaction เดียวหลัง recheck source/permissions/lifecycle; webhook/refresh/worker replay ทุกรูปแบบสร้างยอดได้ครั้งเดียว
- สร้าง unique grant source จาก verified invoice/line และ original attempt ใน account/mode เดิม พร้อม sourceHash. key เดิม payload เดิมคืนผลเดิม; key เดิมแต่ payload ต่างปฏิเสธ. เปลี่ยน webhook event ID ไม่ทำให้ invoice เดิมเพิ่มได้อีก
- Reuse account active-attempt reservation ใน V1 เพื่อกันสองแท็บสร้างสอง checkout โดยไม่จำเป็น. การซื้อเพิ่มอีกรายการหลังรายการแรกจบเป็นการซื้อใหม่โดยตั้งใจ ไม่ dedupe ด้วย offerKey อย่างเดียว
- กรณี paid ก่อน DB commit ล้มเหลว: retry apply จากหลักฐานเดิม; กรณี DB commit แล้วคำตอบหาย: read marker และคืนยอดเดิม. ห้ามเรียก charge ใหม่เพื่อให้ grant ตรงยอด
- Accepted purchase ที่จ่ายแล้วต้อง reconcile ต่อแม้ปิด new-sales gate/ราคาเปลี่ยน. หาก actor/company/security source ไม่ผ่านเมื่อ apply ให้ paid-held พร้อม issue ตามหลักเดิม ไม่เปิดสิทธิ์ใหม่เพื่อช่วยให้สำเร็จ
- หาก membership เปลี่ยนระหว่าง checkout กับ paid: ยอดเงินไม่หาย; preserve purchased lot และใช้ eligibility ตามมติ D2 หรือ paid-held เมื่อเป็น security inconsistency. ไม่ปรับวันสมาชิกเป็นผลข้างเคียง
- ตรวจ subscription graph ก่อน/หลัง add-on ว่า baseSubscriptionId, paidThrough, nextChargeAt, tier/capacity/entitlements ไม่เปลี่ยน. One-time invoice ต้องไม่ถูก periodic reconciler ตีความเป็น renewal ภายหลัง. หาก BillingInvoice.periodStart/periodEnd เดิมต้องมีค่า ให้ add-on projection ใช้ช่วง validity ที่ pin และ product discriminator; ไม่อ้าง provider line period ของ one-time invoice เป็นช่วงสมาชิก

## 10. Refund, dispute และ reconciliation

ใช้ permission/scope, preview, sourceHash/version, approval และ financial evidence เดิมของ BillingRefundsService. จำนวนเงินกับจำนวนหน่วยเป็นคนละค่า: 100 เครดิตราคา 549 บาท คืน 10 เครดิตไม่เท่ากับคืน 10 บาท

มติ D5: คืนเงินหน่วยที่ยังไม่ใช้ตามสัดส่วนราคาขายเดิมที่จ่ายจริง พร้อมภาษีตาม invoice/credit-note เดิม และ rounding เป็นสตางค์ที่กำหนดแน่นอน. Preview แสดงจำนวนหน่วยที่จะ revoke และเงินจริงสูงสุดที่ยังคืนได้; เคสใช้บางส่วน/ข้อยกเว้นให้เจ้าหน้าที่อนุมัติ ไม่ให้เว็บตีความสิทธิ์ refund เอง

1. ตอน reserve refund ล็อก lot และกันเฉพาะหน่วยที่ขอคืน ไม่ให้ usage แย่งใช้ระหว่าง provider refund. มี usage hold ค้างต้อง settle/resolve หรือหักออกจาก refundable units ก่อน
2. เมื่อ provider ยืนยัน refund สำเร็จ เขียน reversal ของ grant/หน่วยและ audit ครั้งเดียว; invoice เต็มคืนและยังไม่ใช้ revoke ทั้ง lot. Partial refund ต้องมี mapping เงิน→หน่วยของรายการต้นทาง ห้ามปัดเดาให้ทั้ง lot หาย
3. Refund failed/cancelled ที่ยืนยันแล้วปล่อย refund hold เฉพาะหน่วยที่ยังไม่หมดอายุ; UNKNOWN คง hold และ reconcile ต่อ. Duplicate webhook ไม่คืนหน่วยหรือเงินซ้ำ
4. Refund/dispute ที่เกิดจาก provider dashboard โดยไม่มี operation ภายใน: freeze ส่วนที่เหลือของ lot ที่เกี่ยวข้อง สร้าง review issue; ไม่ลบ usage ที่ใช้จริงหรือเรียกเก็บใหม่โดยอัตโนมัติ. หากใช้ไปแล้วมากกว่าคืนได้ บันทึก merchant loss/review ไม่สร้างเครดิตลูกค้าติดลบ
5. Dispute ที่ปิดแล้วใช้ผลเงินจริงและ operation ที่ audit ได้ก่อน unfreeze/revoke; การคืนเงินและการปล่อยหน่วยเป็น state transitions แยก ไม่ใช้ชื่อ event เดียวตัดสินทั้งคู่
6. การแก้ provider usage ภายหลังต้องอ้าง original invocation/cycle/lots และทำ signed adjustment ครั้งเดียว. ไม่ใช้ราคาขายปัจจุบัน reprice refund หรือแก้ประวัติต้นทุนเก่า

## 11. การย้ายจากเดือนปฏิทินและความเข้ากันได้

- Rollout มี per-company cutover/source marker. ตาม D9 บริษัทเดิมที่รู้ paid continuity คงการเติมเดิมจนถึงวันครบรอบถัดไปที่มี paid coverage หลังเปิดกติกา; ประกาศวันเปลี่ยนล่วงหน้า. วันนั้น reset เฉพาะ included เป็น allowance เต็มหนึ่งครั้ง ไม่ prorate หรือเติมย้อนหลังสะสม; หลัง cutover ปิด calendar grant ของบริษัทนั้น. ถ้าวันครบรอบตรงต้นเดือนให้ออก anniversary grant ครั้งเดียว ไม่ออกทั้งสองแบบ
- ตัวอย่างสิทธิ์ default 80 และสมาชิกต่อเนื่องครบรอบวันที่ 15: วันที่ 1 ต.ค. เติมตามกติกาเดิม; วันที่ 15 ต.ค. ทิ้ง included ที่เหลือและตั้งเป็น 80 เต็ม; วันที่ 1 พ.ย. ไม่เติม; วันที่ 15 พ.ย. reset เป็น 80 ตามรอบ. ยอดซื้อ/แถมยังใช้จำนวนและวันหมดอายุเดิม; บันทึกต้นทุนรอบรอยต่อเพื่อประเมิน margin ไม่ถือว่าได้รับรายรับเพิ่ม
- บริษัทที่ไม่มี anchor/usage attribution พอใช้ยังอยู่ legacy จนตรวจ source สำเร็จ; ไม่อนุมาน CHAT จากชื่อ usageTag อย่างเดียว และไม่ผูกวันของ trial/manual term เป็นวันซื้อจริง. Purchased CHAT ไม่เปิดให้บริษัทที่ยังไม่พร้อมคุม reservation/cycle
- ไม่ backfill เงินหรือ purchased lots จาก admin monthly cap. ไม่แก้ historical monthKey, price/FX snapshots, invoices หรือการหักยอดเดิม. ใช้ cycle identity ใหม่ควบคู่ calendar cost reports
- แบบ dual reader ต้องอ่าน legacy/package/add-on ถูกต้อง. ปิด gate แล้วหยุดเฉพาะซื้อใหม่; ยอดที่รับเงินแล้ว การใช้งานตามสิทธิ์ reconciliation/refund/history ยังทำงาน. ห้าม rollback ไป binary ที่ไม่รู้จัก paid lots แล้วทำให้ยอดลูกค้าหาย
- เวลาถอน implementation ใช้ forward repair/compatible readers และปิด sale admission ตาม protocol ไม่ลบ grants หรือย้อน DB ที่มีเงินจ่ายแล้ว

## 12. ธุรกิจและรายงานที่ต้องแยก

รายการยอดซื้อเพิ่มที่ยังไม่ใช้เป็นภาระการให้บริการในอนาคต ไม่ถือเงินรับทั้งหมดเป็นกำไรทันที. รายงานแยก cash collected, tax, fee, refund/dispute, credits/units issued-consumed-held-expired, provider cost รวม failure และรายการที่ยังจับคู่ไม่ได้. การรับรู้รายได้ให้ใช้ billing/accounting policy ที่อนุมัติ ไม่ตั้งกติกาบัญชีใหม่จากสูตร margin นี้

แสดง contribution ตามยอดขาย/การใช้ที่เทียบช่วงกันได้ ไม่เอาเงิน prepaid ทั้งก้อนหารกับ usage สัปดาห์เดียว. Blended margin ต้องถ่วงด้วยรายได้ ไม่เฉลี่ยเปอร์เซ็นต์แต่ละร้านตรง ๆ; แยก fixed/shared server และค่าพัฒนาออกเพื่อไม่หักซ้ำ

ความเสี่ยงแพ็กหลักยังอยู่: Enterprise 1999/500 รูป และ Starter 249/30 รูป+80 เครดิตอาจเหลือ margin ต่ำเมื่อใช้ครบ. Add-on นี้ไม่แก้สิทธิ์แพ็กเดิม ไม่ห้ามซื้อแพ็กซ้ำที่เคยอนุมัติเพียงเพื่อบังคับซื้อ add-on. การปรับ catalog แพ็กหลักเป็นมติแยก; UI เปรียบเทียบราคา/สิทธิ์ตามจริงและห้ามอ้างว่า blended 70% ผ่านแล้ว

## 13. Acceptance criteria

เกณฑ์นี้เป็นงานตรวจตอน implementation ไม่ใช่ผล PASS และไม่มีการรันทดสอบ/เรียก provider/ชำระเงินในงานเขียนเอกสารนี้

| ID | ผลที่ต้องยืนยัน |
| --- | --- |
| A01 | Catalog/quote/checkout ทั้งหก offer ตรงราคา จำนวน อายุ 12 เดือน และ current tax revision; client แก้ราคา/ข้าม gate ไม่ได้ |
| A02 | ซื้อ→จ่ายผ่านวิธีที่เปิด→verified paid→เพิ่มยอด→แสดงยอด→ใช้จริง ครบทั้ง CHAT และ IMAGE; ทุกกรณี subscription/term/tier/capacity ไม่เปลี่ยน |
| A03 | สองแท็บ, request/event/worker ซ้ำ, event สลับลำดับ และคำตอบหาย ไม่เก็บเงิน/เพิ่ม/ตัดยอดซ้ำ; deliberate second purchase เพิ่มได้ |
| A04 | Pending/failed/cancelled/UNKNOWN ไม่เพิ่มยอด; paid-but-unapplied กู้จากรายการเดิม ไม่ชำระใหม่ |
| A05 | เครดิตแพ็กตัดก่อนซื้อเพิ่มและแบ่ง debit ข้ามแหล่งได้; hold/reserve/settle/correction reconcile กับ source และ available ไม่ติดลบ |
| A06 | รอบวันที่ 15/29/30/31, ปีอธิกสุรทิน, รายปี 12 รอบ, prepaid/upgrade/downgrade ไม่เติมซ้ำ; reset กับ settle ที่แข่งกันไม่ย้ายต้นทุนผิดรอบ |
| A07 | อายุ purchased lots ไม่เปลี่ยนเมื่อซื้อเพิ่ม/ต่อแพ็ก; expiry ขณะมี hold ไม่ลบหลักฐานและไม่ชุบเครดิต. สมาชิกหมด/กลับมาตรง D2 |
| A08 | รูปหนึ่งงานหลาย model calls ใช้หนึ่งหน่วย; failure ไม่มี usable result คืนหน่วย; request replay ไม่คิดซ้ำ; PDF/ชนิดนอก scope ไม่หัก purchased image units |
| A09 | CHAT/OCR/operational TOTAL แยกถูกต้อง; system/cap error ไม่ขายเครดิตเป็นทางแก้ผิดสาเหตุ; SHARED/SPLIT ต่างคุม paid-credit concurrency ได้ |
| A10 | Full/partial refund, dispute, provider-origin refund, usage-vs-refund race และ late correction ไม่จ่ายคืนเกินยอดจริง/ไม่คืนหน่วยซ้ำ/ไม่สร้างหนี้ลูกค้า |
| A11 | บริษัท/ผู้ใช้/account-mode ข้ามกัน, revoked OWNER, stale quote/source และ forged identifiers ถูกปฏิเสธ; billing read/document permissions ไม่กว้างขึ้น |
| A12 | Web/LINE แสดงจากแพ็กเกจ/ยอดเพิ่มเติม/คงเหลือรวม วันเติม/หมดอายุและ hint ตรงกัน; ไม่แสดงแยก admin/purchased หรือยอดกันไว้. Mobile/loading/error/permission/payment/recovery ใช้ต่อได้ |
| A13 | Legacy invoices/admin/deals/annual receipt grants/การซื้อแพ็กเต็มยังทำงานเดิม; migration ไม่ให้เครดิตซ้ำและปิด new-sale gate ไม่ลบ paid rights |
| A14 | Report แยกจำนวนข้อความ/เครดิต/รูป/provider calls และ cash/contribution; ชุดข้อมูลน้อยหรือ unmatched costs ไม่ถูกแสดงเป็น margin ที่ยืนยันแล้ว |
| A15 | Customer paid และ admin-approved grant ของ CHAT/IMAGE เข้า application seam เดียวกัน; จำนวนและอายุ pin ตาม source; ไม่เปลี่ยนแพ็ก วันสมาชิก หรือ operational cap |
| A16 | Admin preview/approval/source version/credential/scope และ idempotency เดิมยังครบ; ไม่ปลอม paid evidence, invoice หรือแปลง grant ฟรีเป็นรายรับ |
| A17 | Admin grants ใช้ consumer/history/hold/release เดียวกับสินค้านั้น; legacy overrides/grants ไม่ถูกแปลงหรือเปลี่ยนอายุย้อนหลัง; expiry/lapse ตามมติ D8 |
| A18 | Revoke admin grant กัน usage/refund race และไม่คืนเป็นเงิน; technical compensation คืน source เดิมครั้งเดียว ไม่ทั้ง release และ mint grant ใหม่ซ้ำ |

## 14. สถานะส่งต่อ

เอกสารนี้พร้อมใช้ review และแบ่งงานตามแผน. D1–D12 ยืนยันครบแล้ว; implementation ต้องจัดทำรายละเอียด cutover/lock matrix และหลักฐานตรวจรับตามแผน โดยคงราคาที่ Owner ยืนยัน. ขอบเขตล่าสุดรวม A01–A32/E01–E60 ตาม §18 และ plan §15. ก่อนแตะ cloud หรือเปิด sale gate อ่าน runbooks ตาม AGENTS และบันทึก exact UAT/READY/Production run IDs กับ signed result/customer OPEN acceptance ตาม protocol. การอนุมัติราคาและขอ spec/plan ไม่ใช่การอนุมัติ deploy ในงานนี้

## 15. ข้อกำหนดเพิ่มจาก E2E impact audit

[Audit 2026-09-28](../research/chat-credit-and-receipt-addons-e2e-impact-audit-2026-09-28-th.md) พบ source inconsistency หนึ่งจุดและ dependency/design gaps อีก 11 ประเด็น. ส่วนนี้ทำให้ target design ชัดขึ้น ไม่ใช่รายงานว่าแก้ runtime แล้ว. ใช้ร่วมกับ A01–A14 และ acceptance E01–E22 ใน audit; หากตัวอย่าง reuse ก่อนหน้ากว้างกว่าส่วนนี้ ให้ยึดข้อจำกัดที่ระบุชัดในส่วนนี้

### 15.1 Product identity ต้องอยู่ตลอด payment และ reader chain

- ADD_ON checkout ใช้ native one-time Price ที่ pin ใน policy revision แยกจาก recurring Price/inline price_data ของ package เดิม. หนึ่ง line quantity=1 หมายถึงหนึ่ง bundle; units 50/100/300 หรือ 20/50/100 อยู่ใน server catalog/snapshot. ไม่ใช้จำนวนเครดิตเป็น payment quantity
- แยก validator สำหรับ exact add-on Price/evidence โดยรักษา package validator เดิม; ไม่ผ่าน paidVariant หรือ full-package impact/apply. Catalog/readiness ต้องตรวจทั้งชนิด Price และ consumer readiness ของสินค้านั้น
- Persist Invoice.productKind แบบ query ได้และตรวจตรง snapshot; migration กำหนด records เดิมเป็น PACKAGE. Membership status/renewal/upgrade/restart/collection readers ต้อง scope PACKAGE/contract source ก่อน orderBy periodEnd. Financial history/refund/settlement อ่านทุกชนิดได้ตาม scope แต่ต้อง dispatch ตาม productKind
- Account activeAttemptId เป็น reservation ร่วมที่ reuse ได้ แต่ customer package paymentState กับ pending add-on แสดงแยก. Complete/cancel/expire/retry ต้อง clear เฉพาะ attempt ที่ตรง source; ห้ามคืนสถานะ collection หรือ fulfillment deal/referral ของ package จาก add-on
- ADD_ON ไม่สร้าง referral/commission entitlement ใหม่อัตโนมัติ; งาน sales attribution เดิมต้องไม่ตีความการซื้อเพิ่มเป็นการซื้อแพ็กแรก. การเปลี่ยน commercial attribution เป็นมติแยก

### 15.2 Commercial CHAT funding และ authority ของ multi-call

- การใช้ AiBudgetReservation กับ SHARED เป็นงานเพิ่ม capability: engine ปัจจุบันรับ SPLIT เท่านั้น จึงไม่ถือว่า reuse ได้โดยแค่เรียก helper. ต้องพิสูจน์ bound/retry/settlement จาก provider ที่ใช้จริงทั้งสอง mode โดยรักษา operational cap semantics
- Parent reservation ใน API เป็น authority ของ operational month, commercial cycle/attempt context, classification และ pricing snapshot. Child body/envelope ต้องตรง parent; reject mismatch ก่อน reserve/dispatch. Child invocation จอง allocation ของตัวเองภายใน context นั้น ไม่เชื่อ lot/cycle/month จาก request และไม่ย้ายงานข้าม anniversary ไป allowance ใหม่
- Reserve/settle/release/correction/operator charge-at-bound ใช้ commercial funding seam เดียวกัน; การ acknowledge breach ไม่ใช่ refund. Holds เก่าต้องค้น/กู้ได้แม้อยู่นอก current/previous calendar month
- Late provider evidence หลัง operator release/expiry ยังคงบันทึก actual cost. ส่วนที่ผูก funding เดิมไม่ได้เข้าความเสียหายของผู้ให้บริการ/review ไม่หัก lot ใหม่ที่ไม่เกี่ยวข้อง ไม่ทำเครดิตลูกค้าติดลบ
- Customer UI ใช้ projection §17; operator ต้องแยก operational month spend ออกจาก anniversary allowance/purchased balance. การซื้อเครดิตไม่เปลี่ยน safety cap และ refusal จาก cap ต้องไม่แนะนำซื้อเป็นวิธีแก้

### 15.3 Receipt unit ต้องผูก file eligibility และ operation ถาวร

- ตามมติ D4 ให้ admission รับ trusted eligibility จาก server attachment/preprocess: operation family, file kind/page class และ logical operation ID. ห้ามใช้ค่าจาก client โดยตรง. อ้าง classification ที่ตรวจแล้วใน funding entry โดยไม่เก็บเอกสารลูกค้าเพิ่ม
- ครอบคลุม Web receipt client, LINE intake/receipt OCR, expense capture read runner/preprocess/chunks และ bank statement client. Purchased image lot เลือกได้เฉพาะภาพหนึ่งหน้าตาม D4; PDF/statement ใช้สิทธิ์แพ็กเดิมตามเดิม ไม่ fallback ไป purchased image units
- IMAGE readiness ต้องพิสูจน์ billing account→purchased grant→consumer binding ในแต่ละ paid/deal cohort ที่ D3 อนุมัติ. ทางเดิมที่ไม่มี term.billingReceiptAccountId ใช้ monthly/gift path และอาจยังไม่ enforce quota; ห้ามขายโดยมี grant แต่ consumer มองไม่เห็น หรือเปลี่ยนสิทธิ์ legacy/CompanyPlanTerm เพื่อบังคับให้ซื้อ. Cohort ที่ยังต่อไม่ครบ unavailable ก่อน checkout
- Commercial receipt entry ใช้ stable logical operation และ execution generation แยกจาก CompanyOcrUsageEvent.id ที่ legacy recovery เปลี่ยนได้. เขียน reserve/consume/release/revoke แบบ durable และมี unique effects; compensation ไม่ลบประวัติการซื้อ/ใช้/คืนหน่วย
- Read model ต้องแยก reserved กับ consumed และไม่ count released/frozen เป็น available. ถ้าปรับ admission ให้เก็บแถว released ต้องปรับ projection เดิมพร้อมกัน; ห้ามใช้ `_count.admissions` ทุกแถวต่อไป
- OCR usable persisted result รวม needs-review เป็นจุด consume; failed/unsupported ไม่มี usable result release จาก source เดิมครั้งเดียว. Delayed release ของ generation เก่าต้องไม่ปล่อยหน่วยของงานใหม่ และ lot หมดอายุไม่กลับมา usable

### 15.4 Refund และ financial observers ต้องปิด source เดียวกับ usage

- เพิ่ม grant/funding version, unused/held/consumed units และ cumulative refund allocation ใน preview/source hash; invoice/account version อย่างเดียวไม่กัน usage race
- Refund และ consumption ใช้ลำดับ locks เดียวกันที่ P0 ยืนยัน; freeze ก่อนออก provider call และ apply verified result ครั้งเดียว. ทุก financial observer—including provider-origin webhook, refresh/reconcile, settlement และ operator retry—ต้องเข้าการ reconcile ADD_ON lot เดียวกัน โดยไม่เปลี่ยน entitlement policy ของ package เดิม
- Pin total refundable consideration และ denominator หน่วยจาก original paid line/tax allocation. Technical rounding ใช้ยอดสะสม: target refund ของหน่วยสะสมที่อนุมัติปัดลงเป็นสตางค์ แล้วหักยอดที่คืนไปแล้ว; หน่วยสุดท้ายที่คืนครบตามสิทธิ์รับส่วนต่างที่เหลือโดยไม่เกิน original refundable amount. การอนุมัติว่าคืนหน่วยใดได้ยังยึด D5 ไม่ใช่สูตรนี้อนุมัติ refund ให้เอง
- Provider-origin partial refund ที่ไม่มี unit allocation ภายในต้อง freeze ส่วนที่เหลือและ review ไม่แปลงเงินบาทเป็นหน่วยแบบเดา. Failed/UNKNOWN/dispute และ expiry ระหว่าง freeze ใช้ state transitions ใน §10

### 15.5 Recovery access, display และ migration readiness

- ยอด/ประวัติเมื่อสมาชิกหมดใช้ billing recovery read เดิม หรือเพิ่ม exact GET allowlist ใน AuthGuard พร้อมสิทธิ์เดิม; ห้ามเปิด billing prefix ทั้งหมด. การถูก disable เพราะ security ไม่ใช่ membership lapse และต้องคง block เดิม
- Quote/review/return/status/history/documents/notification/operator DTO ต้อง discriminate สินค้า. Notification “เพิ่มเครดิต/จำนวนอ่านรูปแล้ว” ห้ามใช้ข้อความ “อัปเดตแพ็ก/ต่ออายุ” สำหรับ ADD_ON; reference invoice เดิมและ outbox dedupe เดิม
- Commercial history/source identity ต้องทนต่อการ retention purge ของ LINE event/AI turn. เก็บ opaque references ที่จำเป็น ไม่อาศัย cascade หรือเก็บ raw prompt/image เพิ่มเพื่อทำบัญชียอด
- Legacy cutover ใช้ D9 ที่ยืนยันใน §11/§16: หลักฐานสำหรับ operator ต้องแสดง grant/remaining/holds ก่อนและหลัง cutover พร้อม transition cost ของ legacy reset ก่อน anniversary; ไม่ prorate และไม่สร้าง legacy grant หลัง cutover. หน้าลูกค้าไม่แสดง holds ตาม D10
- Bangkok anniversary calculator ไม่ reuse UTC package interval helper ตรง ๆ. ต้องตรวจเวลาไทยก่อน 07:00, วัน 29/30/31, leap year และ paid coverage ที่จบก่อน cycle end โดยไม่เลื่อนวันสมาชิกเดิม
- ความครบของแบบไม่เท่ากับพร้อมขาย: D9 ยืนยันแล้ว แต่ cutover/lock design และ runtime evidence E01–E60 ตามขอบเขตล่าสุด §18 ยังต้องปิดใน implementation/release ที่ได้รับมอบหมายภายหลัง

## 16. Admin เพิ่มยอดผ่าน ADD_ON เดียวกัน — มติล่าสุด

Owner ระบุว่ารวม admin console ที่เพิ่มให้เอง และใช้รูปแบบเดียวกันทั้งรูปและแชต. คำว่า flow เดียวกันหมายถึง **shared grant application, product units, ledger, consumption, history และ recovery**; ขั้นยืนยันต้นทางมีสองแบบตามหลักฐานจริง

| ทางเข้า | ก่อนเพิ่มยอด | กลไกร่วม | ผลที่ไม่เกิด |
| --- | --- | --- | --- |
| ลูกค้าซื้อ | quote → verified one-time payment → immutable paid source | ADD_ON application → grant/entries/audit/outbox ครั้งเดียว → balance/consumer/history | ไม่ต่ออายุ/เปลี่ยนแพ็ก/เพิ่ม safety cap |
| Admin เพิ่มให้ | เลือกบริษัท/สินค้า/จำนวน/เหตุผล → preview → submit/approve ตาม permission และ approval policy เดิม | ADD_ON application เดียวกัน โดย source เป็น approved admin operation | ไม่สร้าง checkout/paid invoice ปลอม หรือเปลี่ยนยอดเงินที่รับจริง |

1. Core grant command ระบุ company, productKind CHAT_CREDIT/RECEIPT_IMAGE, sourceKind PAID_CHECKOUT/ADMIN_GRANT, stable source ID/hash, quantity, validity policy และ approved source reference. ค่าจำนวนเป็นเครดิตหน่วยย่อยหรือรูปจำนวนเต็มตามสินค้า; ใช้ helper ร่วมใน application เดิม ไม่สร้าง generic wallet framework หรือรวมหน่วยรูปกับเครดิตเป็นยอดเดียว
2. Paid entry ตรวจ paid evidence เดิม; admin entry ตรวจ company scope, manage/approve permissions, credential proof, reason, source version และ original operation. Core final mutation รับเฉพาะ source ที่ผ่านการตรวจจาก entry point เหล่านี้ ไม่ยอมให้ client เปลี่ยน sourceKind เพื่อข้ามการจ่ายเงิน
3. Admin เลือกชนิดสินค้าในรูปแบบฟอร์มเดียวกันและเพิ่มจำนวนเฉพาะชนิดนั้น; ไม่มีการเพิ่มฟรี 80 ใหม่หรือปรับ cap เพื่อจำลอง grant. การกำหนด operational budget/allowance override เดิมยังเป็นอีกการตั้งค่าที่ต้องใช้สิทธิ์เดิม และไม่ถูกตีความเป็นการเพิ่มยอด
4. Admin gift/compensation ที่ไม่มีการรับเงินไม่มี paidSatang/invoice/commission ใหม่; customer balance รวมใน “ยอดเพิ่มเติม”; ประวัติแสดงเหตุการณ์จริง “ได้รับเครดิตเพิ่ม”/“ได้รับจำนวนอ่านรูปเพิ่ม” และรายการซื้อ/จ่ายตามสิทธิ์ §17 โดยไม่แยกเป็นอีกกระเป๋าหรือเปิดเผยชื่อ/เหตุผลภายในของ admin. บันทึกเหตุผลและผู้ทำใน operator audit โดยไม่เผย internal note ทั้งหมดให้ลูกค้า
5. Grant จากการซื้อและ admin ใช้ reserve/consume/release/expiry/read projection เดียวกันของสินค้านั้น พร้อม source identity แยกและ unique operation key. Retry, double click, response lost หรืออนุมัติซ้ำไม่สร้าง lot ใหม่. การเปลี่ยน permission/source ระหว่าง preview กับ apply ต้องให้ตรวจใหม่
6. จำนวน/อายุของ admin grant pin จาก approved operation ตามมติ D7–D8 ไม่สืบ expiry=termEndsAt โดยปริยายจาก admin receipt helper เดิม. หน้าพรีวิวต้องแสดงผลต่อยอดและกติกาวันหมดอายุตรงกันทั้งสองสินค้า
7. การถอนยอดที่ admin ให้เป็น audited reversal ของ lot เดิม คุม consumed/held/unused ภายใต้ locks เดียวกับ usage; ไม่แตะ purchased lot อื่น ไม่ลบ usage และไม่สร้างเงินคืนจากยอดฟรี. การชดเชย technical failure ปกติคือ release/refund หน่วยจาก source เดิม; ห้ามทั้งคืนหน่วยเดิมและเพิ่ม admin grant ชดเชยซ้ำโดยอัตโนมัติ
8. New admin grants ใช้ policy ที่ยืนยันใหม่เท่านั้น; legacy ADMIN_ADJUSTMENT และ monthly cap overrides ไม่ยืดอายุ/แปลงเป็น purchased ย้อนหลัง. สิทธิ์เลือกบริษัทสำหรับ admin คงขอบเขตเดิม; D3 กำหนด self-service buyer ไม่ได้ให้ admin ข้าม company security หรือเปิดสมาชิก
9. D9 ยืนยันสำหรับ migration: บริษัทเดิมคง legacy จนถึง anniversary ถัดไปที่มี paid coverage; วันนั้น expire included เดิมและออก allowance เต็มรอบหนึ่งครั้ง (default 80, ใช้ override/deal ที่มีผลจริง). ถ้ามีต้นเดือนก่อนวัน cutover ให้ใช้ legacy grant ตามเดิมและบันทึกเป็น transition cost; หลัง cutover ไม่ให้ calendar grant อีก. Purchased/admin lots และ holds ของงานเดิมไม่ถูก reset; ทุก event ใช้ source fence และ lock matrix เดียวกัน. ไม่มี prorate bridge 14/30; ใช้ตัวอย่างและกรณีวันครบรอบตรงต้นเดือนใน §11
10. รอบปกติเป็นวัน/เวลาเดียวกันของเดือนตาม paid membership anchor (เดือนมี 28–31 วัน) ตาม §5.1 และให้ allowance เต็มตามสิทธิ์ทุก cycle; ไม่มีการลดเป็น 14 วันสำหรับรอบปกติ. หาก paid coverage/anchor หาไม่ได้ไม่เดารอบหรือสร้างสิทธิ์ใหม่

Readiness เพิ่ม A15–A18 และ E23–E27 ใน audit. งานทางเทคนิคเช่น unique constraints, lock order, authorization และ integer bounds ให้ implementation ออกแบบ/ตรวจตาม invariant โดยไม่ถาม Owner เลือกวิธีเขียนโค้ด

## 17. ยอดหน้าลูกค้า ภาษาไทย และความตรงกันของข้อมูล — D10

มติ Owner 2026-09-29: รวมช่อง admin แถมกับซื้อเพิ่ม ไม่แสดงยอดกันไว้ และใช้ภาษาไทยที่ลูกค้าทั่วไปเข้าใจ. ส่วนนี้แทนข้อเสนอเดิมที่ให้แสดง source breakdown/held บนหน้าลูกค้า; กลไกการจองและแหล่งยอดภายในยังคงเดิม. [ผลตรวจ dependency/field/wording](../research/chat-credit-and-receipt-addons-customer-balance-consistency-audit-2026-09-29-th.md) เป็นรายละเอียดการนำไปพัฒนา ยังไม่ใช่ผล runtime E2E

มติ D11 หลัง Owner อ่านคำอธิบาย 10 จุด: แนวทางแก้ U01–U10 ทั้งหมดเป็นข้อกำหนดที่รับแล้ว ไม่ต้องขอเลือกวิธีแก้เดิมซ้ำ. รายการติดตาม implementation และ acceptance ของแต่ละจุดอยู่ใน plan §14. เริ่มจาก contract/หน่วย/ยอดและแหล่งสิทธิ์ ต่อด้วยทุก consumer/ข้อความ และรองรับข้อความ LINE ที่ค้างก่อนใช้ template ใหม่; ยังไม่ทำเครื่องหมายว่าแก้สำเร็จจนมีหลักฐานจริง. D9 ได้รับคำตอบแยกแล้วใน §3/§11; D11 ไม่เปลี่ยนราคา อายุยอด หรือสิทธิ์แพ็กหลัก

### 17.1 ข้อมูลที่ลูกค้าเห็น

| ส่วน | ชื่อบนจอ | ความหมาย |
| --- | --- | --- |
| สินค้า CHAT | เครดิตแชต | ตัวเลขหน่วยเครดิต ทศนิยมได้ไม่เกิน 2 ตำแหน่ง |
| สินค้า IMAGE | จำนวนอ่านรูปใบเสร็จ | ตัวเลขจำนวนเต็ม หน่วย “รูป”; ไม่ใช่ใบเสร็จค่าบริการที่ออกหลังชำระเงิน |
| ยอดแพ็ก | จากแพ็กเกจ | ส่วนที่เหลือจากสิทธิ์แพ็กที่ยังมีผล |
| ยอดนอกแพ็ก | ยอดเพิ่มเติม | **รวมยอดที่ admin ให้กับยอดซื้อ** ในช่องเดียว; ไม่ใช้ชื่อ “ยอดซื้อ” กับยอดรวมนี้ |
| ตัวเลขหลัก | คงเหลือรวม | ยอดสองช่องรวมกันตาม snapshot เดียวกัน; เมื่อใช้ไม่ได้ให้แสดงสถานะจริงคู่กับยอด ไม่ใช้หัวข้อ “ใช้ได้ตอนนี้” |
| รอบแชต | เติมรอบถัดไปวันที่ {วันเวลา} | แสดงเฉพาะเมื่อยืนยันรอบและสิทธิ์ที่ชำระแล้วได้; ไม่เดาว่าทุกวันที่ 1 |
| วันหมดอายุ | {จำนวน} {เครดิต/รูป} หมดอายุวันที่ {วันเวลา} | แสดงเฉพาะจำนวนที่จะหมดวันนั้น ไม่บอกว่าทั้งยอดเพิ่มเติมหมดอายุวันเดียว |

ไม่แสดงยอดจอง/กันไว้, RESERVED/HELD/BLOCKED, monthly money budget, provider/model/FX, ต้นทุนหรือ margin, database ID, sourceHash, raw error/stack trace, ชื่อผู้อนุมัติหรือเหตุผล admin ภายใน. ข้อกำหนดนี้ครอบคลุม card/detail/tooltip/accessibility text/history/export/LINE/email ที่ลูกค้าเข้าถึง รวมถึง customer quota response ไม่ใช่เพียงซ่อนด้วย CSS. Operator API/view ที่มีสิทธิ์ยังเห็นข้อมูลที่จำเป็นต่อการกู้และคืนเงิน

Customer usage history แสดงหนึ่งรายการต่อ logical operation: ซื้อเครดิต/ซื้อจำนวนอ่านรูป, ได้รับเครดิตเพิ่ม/ได้รับจำนวนอ่านรูปเพิ่ม, ใช้เครดิตแชต/อ่านรูปใบเสร็จ, คืนเครดิต/คืนจำนวนอ่านรูปเมื่อมีผลคืนที่ยืนยันแล้ว, ยอดหมดอายุ, คืนเงินตามหลักฐาน. ไม่เผย child invocation, reserve/release หรือแยก debit จาก admin/purchased. การซื้อที่จ่ายจริงยังมี invoice/receipt ตามสิทธิ์เดิม; grant ฟรีไม่มีเอกสารรับเงินจริงปลอม

### 17.2 วิธีคำนวณที่ server ใช้ แต่ไม่แสดงรายละเอียดภายใน

ณ เวลา `asOf` เดียวกัน เลือก grants ที่ valid ตามสิทธิ์สินค้าและ company เท่านั้น. สำหรับแต่ละ source หัก **consumed + active usage reservation + refund-frozen units + revoked units** ที่ไม่ซ้อนทับกันจาก issued units. อย่าหัก reservation ซ้ำจาก projection ที่หักไปแล้ว

- `packageRemainingUnits` = ผลรวม net ของ package sources
- `additionalRemainingUnits` = ผลรวม net ของ ADMIN_GRANTED + PURCHASED sources
- `totalRemainingUnits` = packageRemainingUnits + additionalRemainingUnits สำหรับแพ็กที่มีจำนวนจำกัด
- ทั้งสามเป็นจำนวนเต็มตาม unitScale; UI ห้ามคำนวณรวม source เองหรือรวมจากคนละ API response. ค่าเสียหาย/ติดลบ/ไม่ใช่จำนวนเต็มเป็น data error ที่ต้อง reconcile ไม่ clamp แล้วรายงานเหมือนยอดปกติ
- การซ่อนยอดกันไว้ไม่คืนสิทธิ์นั้นให้ใช้ซ้ำ. งานกำลังทำแสดงเพียงสถานะ “กำลังดำเนินการ” ตามงานจริง; เมื่อ settle/release แล้ว refresh ตัวเลข ไม่มีบรรทัดยอดจอง. ไม่สร้างรายการประวัติใช้สำเร็จก่อนมี settlement/result ที่ยืนยัน
- Membership lapse ไม่เปลี่ยน purchased/admin ที่ยัง valid เป็นศูนย์; แสดงยอดคงเหลือกับข้อความต่ออายุสมาชิก. ระงับการใช้งาน/เพดานบริษัทไม่ใช่ credit expiry. `useState` และ `purchaseState` แยกจากค่าจำนวน
- After grant/use/refund/revoke/expiry/reset แสดง snapshot ใหม่ทั้งชุด. Client ไม่บวกยอดซื้อ/admin แบบ optimistic ก่อน commit. เมื่อกลับจากชำระแล้วมีการใช้พร้อมกัน ให้แสดงจำนวนที่เพิ่มของรายการ กับยอดปัจจุบันตามจริง ไม่บังคับยอดให้เท่ากับยอดเก่า+ชุดที่ซื้อ
- ลำดับตัดยังเป็นแพ็ก → admin → purchased และ FEFO ภายในกลุ่ม; การรวมบนจอไม่ merge lots/expiry/source financial ownership. Refund ซื้อเพิ่มยังคืนได้เฉพาะ purchased source ที่มี paid consideration

### 17.3 Target field dictionary และตัวอย่างค่า

เป็น additive customer contract ใหม่ใต้ `quotaSummary` ของ Billing status หรือ quota read ที่มี authorization เดิม. ห้าม rename/reinterpret `BillingReceiptUsage.monthlyAllowance.additionalRemaining` เดิมให้กลายเป็นรวม paid+gift เพราะ reader เดิมหมายถึง admin allowance; ย้าย consumer ใหม่ไป projection นี้อย่างชัดเจน. ไม่ใช้ raw internal ledger object หรือ object spread จาก operator DTO

| Field | Type/หน่วย | ข้อกำหนด |
| --- | --- | --- |
| schemaVersion | literal 1 ของ quotaSummary | แยกจาก version ของ BillingCatalog เดิม |
| companyId | string | ต้องตรง authenticated company และ response request generation |
| snapshotId / asOf | opaque string / UTC ISO timestamp | หนึ่ง consistent read snapshot ครอบคลุมทั้งสองสินค้า; ไม่โชว์ ID บนจอ |
| balances | discriminated entries 2 สินค้า | unique productKind; ขาด/ซ้ำ/อ่านไม่ได้เป็น unavailable ไม่เติมศูนย์ |
| productKind / unitScale | CHAT_CREDIT/100 หรือ RECEIPT_IMAGE/1 | scale เป็น literal ตามสินค้า เปลี่ยนเองไม่ได้ |
| packageLimitKind | FINITE หรือ UNLIMITED | UNLIMITED ใช้ได้เฉพาะสิทธิ์ legacy ที่พิสูจน์ได้ ไม่อนุมานจาก field หาย/null |
| packageRemainingUnits | nonnegative safe integer; null เฉพาะ UNLIMITED | 1800 CHAT = 18 เครดิต; 7 IMAGE = 7 รูป |
| additionalRemainingUnits | nonnegative safe integer | admin+paid net; ไม่มี adminRemaining/purchasedRemaining/reservedUnits ใน customer DTO |
| totalRemainingUnits | nonnegative safe integer; null เฉพาะ UNLIMITED | FINITE ต้องเท่าผลบวกสองช่อง; UNLIMITED แสดง “ไม่จำกัดตามแพ็กเกจ” และยังแสดงยอดเพิ่มเติมที่เป็นจำนวนจริง |
| packageResetsAt / packageExpiresAt | UTC ISO หรือ null | reset แชตกับ expiry สมาชิก/receipt package เป็นคนละค่า; null ไม่แปลว่าข้อมูลเสียหายหรือไม่มีวันหมดอายุทุกกรณี |
| nextAdditionalExpiry | null หรือ {expiresAt, remainingUnits} | วันหมดอายุแรกที่มี net remaining > 0 พร้อมจำนวนของวันนั้น; กลุ่มวันที่เดียวกันรวมได้ ไม่เปิด source breakdown |
| useState | AVAILABLE / PROCESSING / EXHAUSTED / MEMBERSHIP_REQUIRED / COMPANY_LIMIT / FEATURE_UNAVAILABLE / REVIEW_REQUIRED / TEMPORARILY_UNAVAILABLE | Public state ที่ map คำไทย; EXHAUSTED ไม่ใช้แทน unresolved hold/operational cap/lookup failure; PROCESSING ต้องมีงานจริงกำลังทำ ไม่ใช้กับ hold ที่ค้างไม่ทราบผล |
| purchaseState | AVAILABLE / OWNER_REQUIRED / MEMBERSHIP_REQUIRED / SALES_UNAVAILABLE / PAYMENT_PENDING / TEMPORARILY_UNAVAILABLE | BUY ปรากฏเมื่อ AVAILABLE และผู้ใช้มีสิทธิ์; ปิดขายไม่ปิดการใช้ยอดเดิม |
| offer.quantityUnits / offer.unitScale | integer/literal เช่น 5000/100 | หนึ่งชุด 50 เครดิต; รูป 20 = 20/1. ใช้หน่วยเดียวกับ grant/admin preview/history; UI input 50 เครดิต parse เป็น 5000 ที่ server ไม่ส่ง floating point ledger units |
| offer.priceSatang / quote.totalSatang | integer THB satang | 29900 = 299 บาท. ไม่ใช้ quantityUnits เป็นเงินบาท; tax/total จาก quote snapshot |
| remaining/quantity ใน customer history | integer + productKind/unitScale | หนึ่ง logical operation aggregate; ไม่ซ้ำทั้ง child/provider usage กับ parent outcome |

ชื่อ `quantityUnits`/`unitScale` คือ target สำหรับ add-on ใหม่; ราคาจ่ายเป็น satang และ Stripe line quantity=1 bundle เสมอ. Legacy package fields เช่น receiptAllowance, monthlySlipLimit และ old admin receipt units ยังคงจำนวนเต็มรูปตาม contract เดิม มี adapter ชัดเจน ไม่เปลี่ยนหน่วยย้อนหลัง. CHAT admin input ยอมรับได้ไม่เกิน 2 ตำแหน่ง IMAGE ต้องเป็นจำนวนเต็ม; ตรวจ safe bounds ก่อนคูณ/รวม

ตัวอย่าง customer response นี้เป็น fixture ออกแบบ ไม่ใช่ยอดลูกค้าจริง. ภายใน CHAT: package 20 − hold 2 = 18, admin 5 + paid 40 − paid hold 1 = 44, รวม 62 เครดิต. IMAGE: package 8 − hold 1 = 7, admin 3 + paid 20 − hold 2 = 21, รวม 28 รูป. Holds ไม่อยู่ใน JSON ที่ส่งลูกค้า

```json
{
  "schemaVersion": 1,
  "companyId": "example-company",
  "snapshotId": "example-snapshot",
  "asOf": "2026-09-28T17:00:00Z",
  "balances": [
    {
      "productKind": "CHAT_CREDIT",
      "unitScale": 100,
      "packageLimitKind": "FINITE",
      "packageRemainingUnits": 1800,
      "additionalRemainingUnits": 4400,
      "totalRemainingUnits": 6200,
      "packageResetsAt": "2026-10-15T03:00:00Z",
      "packageExpiresAt": null,
      "nextAdditionalExpiry": {"expiresAt": "2027-03-10T03:00:00Z", "remainingUnits": 500},
      "useState": "AVAILABLE",
      "purchaseState": "AVAILABLE"
    },
    {
      "productKind": "RECEIPT_IMAGE",
      "unitScale": 1,
      "packageLimitKind": "FINITE",
      "packageRemainingUnits": 7,
      "additionalRemainingUnits": 21,
      "totalRemainingUnits": 28,
      "packageResetsAt": null,
      "packageExpiresAt": "2026-12-15T03:00:00Z",
      "nextAdditionalExpiry": {"expiresAt": "2027-03-10T03:00:00Z", "remainingUnits": 3},
      "useState": "AVAILABLE",
      "purchaseState": "AVAILABLE"
    }
  ]
}
```

Formatting: เครดิตใช้ comma และทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 62, 18.25; รูปเป็นจำนวนเต็ม; ราคาแสดงบาทจาก satang โดยรักษาสตางค์ถ้ามี. Date ใช้ formatter ไทย/Asia-Bangkok เดียวกันทั้ง Web/LINE/notification; วันที่+เวลาชัดเมื่อเป็นจุดตัดสิทธิ์. Loading/error ไม่ใช้ 0/ไม่จำกัดแทนข้อมูลที่อ่านไม่ได้; null ไม่ stringify เป็น “null/undefined/NaN/Invalid Date”. Company switch ยกเลิก/ละทิ้ง response ของบริษัทเก่า; snapshotId opaque ใช้ตรวจชุดข้อมูล ไม่เปรียบเทียบเรียงลำดับแบบตัวอักษร

### 17.4 ข้อความและทางไปต่อที่ต้องตรงสถานะจริง

ใช้ semantic copy keys และ Thai formatter ที่แชร์ได้ผ่าน contracts/helpers เดิม; Web, LINE card, plain-text/drain, expense upload และ notification ต้องใช้ความหมายเดียวกัน ไม่ให้โมเดลคิดราคา/ยอด/วันหรือคำอธิบายการจ่ายเงินเอง. Prefix/suffix สุภาพต่างตามช่องทางได้ แต่ข้อเท็จจริง/ปุ่มเหมือนกัน

| Key / เงื่อนไข | ข้อความหลักภาษาไทย | ทางไปต่อ |
| --- | --- | --- |
| balance.loading | กำลังโหลดข้อมูล… | รอ; ห้ามแสดงยอด 0 ปลอม |
| balance.unavailable | โหลดข้อมูลยอดคงเหลือไม่สำเร็จ กรุณาลองอีกครั้ง | ลองอีกครั้ง; ไม่กล่าวว่ายอดหมด |
| chat.exhausted | เครดิตแชตหมดแล้ว | ซื้อเครดิตเพิ่มเมื่อ purchaseState อนุญาต; หรือแสดงวันเติมรอบที่ยืนยันได้ |
| chat.insufficient_for_request | เครดิตแชตที่เหลือไม่พอสำหรับคำขอนี้ | ซื้อเพิ่มเมื่ออนุญาต/ดูยอด; ไม่เปลี่ยน remaining เป็น 0 |
| image.exhausted | จำนวนอ่านรูปใบเสร็จหมดแล้ว | ซื้อจำนวนอ่านรูปเพิ่มเมื่ออนุญาต/กรอกข้อมูลเองเมื่อ flow รองรับ |
| request.processing | กำลังดำเนินการรายการก่อนหน้า กรุณารอสักครู่ | ดูรายการเดิม; ไม่แสดงยอดกันไว้/ไม่ส่ง provider ซ้ำ |
| membership.expired | สมาชิกหมดอายุแล้ว ต่ออายุสมาชิกเพื่อใช้ยอดที่ยังไม่หมดอายุ | ต่ออายุสมาชิก; คงยอดเพิ่มเติมที่ valid |
| usage.company_limit | การใช้งานนี้ถึงขีดจำกัดที่บริษัทกำหนด กรุณาติดต่อผู้ดูแลบริษัท | ติดต่อผู้ดูแล; ไม่มีปุ่มซื้อเพิ่มเพื่อแก้เหตุนี้ |
| usage.feature_unavailable | บริษัทนี้ยังไม่ได้เปิดใช้การอ่านรูปใบเสร็จ / ผู้ช่วยแชต | ติดต่อผู้ดูแล; ไม่บอกว่าเครดิตหมดหรือระบบล่ม |
| usage.review_required | รายการนี้ต้องให้ทีมงานตรวจสอบ กรุณาติดต่อทีมงานพร้อมเลขรายการ | ติดต่อทีมงาน; ไม่บอกว่ากำลังประมวลผลหากไม่ทราบผลจริง |
| usage.temporarily_unavailable | ตอนนี้ยังทำรายการนี้ไม่ได้ กรุณาลองอีกครั้งภายหลัง | Retry เฉพาะเมื่อ execution state อนุญาต; ไม่สัญญาว่าลองใหม่เอง |
| purchase.owner_required | ให้เจ้าของบริษัทเป็นผู้ซื้อเพิ่ม | ดูยอด/ติดต่อเจ้าของ; ไม่เผยข้อมูลการเงินเพิ่ม |
| purchase.unavailable | ยังซื้อเพิ่มรายการนี้ไม่ได้ในขณะนี้ | ใช้ยอดเดิมได้ตามสิทธิ์; อย่าซ่อนยอดหรืออ้างว่าหมดอายุ |
| purchase.changed | ข้อมูลรายการซื้อเปลี่ยนแล้ว กรุณาตรวจยอดใหม่ก่อนชำระเงิน | ตรวจรายการใหม่; ไม่ใช้ราคาเก่าเงียบ ๆ |
| payment.pending | รอชำระเงิน | กลับไปชำระรายการเดิม |
| payment.checking | กำลังตรวจสอบการชำระเงิน กรุณาตรวจรายการเดิมก่อนชำระอีกครั้ง | ตรวจสถานะ; ไม่สั่งจ่ายรายการใหม่จาก network timeout |
| payment.applying | ชำระเงินแล้ว กำลังเพิ่มยอดให้ | ดูรายการเดิม; ไม่แสดงยอดเพิ่มก่อน commit |
| payment.review | ชำระเงินแล้ว แต่ยังเพิ่มยอดไม่ได้ กรุณาติดต่อทีมงานพร้อมเลขรายการ | ติดต่อทีมงาน; ไม่บอกว่าชำระล้มเหลว |
| payment.failed / cancelled / expired | ชำระเงินไม่สำเร็จ / ยกเลิกรายการแล้ว / รายการชำระเงินหมดเวลา | ซื้อใหม่เฉพาะเมื่อยืนยันว่าไม่เก็บเงินจากรายการเดิม |
| grant.applied | เพิ่มเครดิตแชตแล้ว {จำนวน} เครดิต / เพิ่มจำนวนอ่านรูปใบเสร็จแล้ว {จำนวน} รูป | ดูยอดและประวัติ; admin grant ไม่ใช้ข้อความว่าชำระเงินสำเร็จ |
| document.pending | กำลังเตรียมเอกสาร กรุณาลองเปิดอีกครั้ง | เปิดเอกสารเดิม; ไม่ต้องเห็นชื่อ provider/config |
| refund.review / succeeded / failed | กำลังตรวจสอบคำขอคืนเงิน / คืนเงินสำเร็จ / คืนเงินไม่สำเร็จ กรุณาติดต่อทีมงาน | สถานะตามหลักฐานเงิน; หน่วยเครดิตและเงินคืนแสดงคนละหน่วย |
| image.ineligible | ยอดเพิ่มเติมใช้กับไฟล์ภาพหนึ่งหน้า กรุณาส่งรูปใบเสร็จ | ใช้เฉพาะเมื่อจะต้องใช้ additional IMAGE และไฟล์ไม่เข้าเงื่อนไข; คงสิทธิ์ PDF จากแพ็ก |
| auth.expired / forbidden | กรุณาเข้าสู่ระบบอีกครั้ง / คุณไม่มีสิทธิ์ดูข้อมูลนี้ | เข้าสู่ระบบ/กลับหน้าก่อนหน้า; ไม่โชว์ยอดของบริษัทอื่น |
| request.rate_limited | ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองรายการเดิมอีกครั้ง | ใช้ retryAfter ที่ validate แล้วหากมี; ไม่สร้าง payment ใหม่ |
| unknown error ก่อนเริ่มรายการ | ยังทำรายการนี้ไม่ได้ กรุณาลองอีกครั้ง หรือติดต่อทีมงาน | Safe fallback ไม่มี raw message/code/stack |
| unknown error หลังอาจส่งชำระแล้ว | ยังยืนยันผลรายการไม่ได้ กรุณาตรวจรายการเดิมก่อนชำระอีกครั้ง | กลับรายการเดิม; ห้ามยืนยันว่าไม่มีการตัดเงินโดยไม่มีหลักฐาน |

ห้าม map ทุก AI_BUDGET_EXCEEDED/OCR limit เป็นยอดซื้อหมดแล้วแสดง BUY: public reason ต้องมาจากผู้ตัดสิน admission ที่รู้ commercial vs operational cause จริง. หากสาเหตุยังไม่ชัด ใช้ unavailable/review ตามหลักฐาน ห้ามเดาว่าซื้อเพิ่มจะแก้ได้. File saved/not saved และ expense recorded/not recorded ต้องประกอบข้อความจาก source state เดิม ไม่ใช้คำว่า “เก็บไฟล์แล้ว” หรือ “ไม่เสียเครดิต” กับทุก error. กรณี OCR ใช้ได้และบันทึกผล durable แล้วแต่ส่งคำตอบไม่สำเร็จยังไม่ใช่อ่านล้มเหลวที่คืนหน่วย

### 17.5 ความเข้ากันได้และเกณฑ์ตรวจรับ

- Customer presenter ใช้ allowlist public DTO; ไม่ reuse operator view ด้วยการซ่อน field บางตัว. Admin receipt/AI/billing overview ยังแสดง source/holds ที่มีสิทธิ์และใช้สูตรเดียวกับ customer aggregate. ห้ามแก้ helper ที่แชร์สอง audience จน operator ขาดข้อมูลกู้รายการ
- LINE queued delivery มีการตรวจข้อความเทียบ static refusal formatter. การแก้ copy ต้องมี template version/legacy verifier หรือ controlled re-render ที่รักษา claim/lease/delivery idempotency; ไม่แก้ข้อความที่ส่งแล้ว, ไม่ปิด integrity guard, ไม่ส่งเก่าซ้ำ และไม่ทำรายการเก่าค้างเพราะข้อความเปลี่ยน
- Public policy answers เรื่องเครดิต/การอ่านรูปและ business/tool replies ที่ตอบยอด ต้องใช้ customer projection/copy เดียวกัน ไม่มีการเข้าถึง raw ledger ผ่าน AI Gateway. Error fallback ใน common toast/helper และ per-page handler ต้องตรงบริบท stage ของ payment
- อ่าน source ปัจจุบันพบข้อความเดือนปฏิทิน, admin-only monthlyAllowance text และ common raw-Error fallback; รายการเหล่านี้เป็น implementation work ใน audit ใหม่ ไม่ถือว่าแก้แล้วจากการอัปเดต spec

| ID | เกณฑ์ตรวจรับเพิ่ม |
| --- | --- |
| A19 | Customer เห็นจากแพ็กเกจ/ยอดเพิ่มเติม/คงเหลือรวมทั้งสองสินค้า; admin+paid รวมหนึ่งช่อง และไม่พบยอดกันไว้/source breakdown ใน payload/DOM/tooltip/history/export/LINE |
| A20 | quantityUnits/unitScale/priceSatang/วันหมดอายุ/รอบเติมตรงกันทุก producer-consumer; ภาพไม่มีทศนิยม, CHAT ไม่แสดงเป็นบาท, null/error ไม่กลายเป็น zero/unlimited |
| A21 | Server sum และ internal hold/refund deduction reconcile ได้; หักครั้งเดียว ไม่ merge expiry; lapse/cap ไม่ลบ retained balance และ concurrent refresh ไม่บวกยอดเอง |
| A22 | ทุก state มีข้อความไทยและทางไปต่อที่ตรงเหตุ; ไม่มี raw enum/error/provider details, wrong monthly promise, false saved/refund/no-charge claim หรือ upsell แก้ operational cap |
| A23 | Customer/operator authorization และ shared helper แยก audience; switching company/stale responses/unknown enum ไม่เผยยอดผิดบริษัทหรือกลับไป fallback ภายใน |
| A24 | Web/LINE immediate/card/drain/email/public-policy และ queued-message upgrade ให้ข้อความ/ตัวเลขตรงกัน; การเปลี่ยน copy ไม่ทำ delivery integrity/recovery เสีย |

A19–A24 ตรวจด้วย E28–E42 ใน audit ใหม่นอกเหนือ E01–E27 เดิม รวม 42 scenarios ที่ยังไม่รัน. ตัวอย่าง JSON/คณิตศาสตร์ตรวจได้ในงานเอกสาร แต่ไม่ทดแทน API→DB→Gateway→UI execution evidence

## 18. ปรับระบบเครดิตเดิมร่วมกับ ADD_ON และแหล่งข้อมูลที่ใช้ร่วมกัน — D12

ส่วนนี้เพิ่มข้อกำหนดจาก [audit source ร่วม C01–C12/E43–E60](../research/chat-credit-and-receipt-addons-unified-source-audit-2026-09-29-th.md) ต่อจาก F01–F12/U01–U10. ครอบคลุมการเพิ่มยอดและปรับเพดานเดิมด้วย ไม่จบที่หน้าซื้อใหม่. ไม่ใช่การเปลี่ยนราคา/สิทธิ์แพ็ก หรือการเปิดใช้ระบบจริง

### 18.1 Authority ของข้อมูล

| ข้อมูล | Source ที่มีอำนาจตัดสิน | Consumers / ข้อห้าม |
| --- | --- | --- |
| ยอดลูกค้าสองสินค้า | Valid grants + funding/unit effects และ original source; included มี cycle snapshot | Admission, quotaSummary, admin balance, history ใช้ allocator/projector เดียว; ไม่ใช้ cap-used หรือจำนวน provider calls แทน |
| จำนวนสิทธิ์แพ็กต่อรอบ | Verified paid continuity + package/deal/admin allowance provenance ที่ resolver เดิมรับรอง | ออก included cycle ตาม D9/§5; แก้ cap ไม่ใช่เพิ่มยอดกลางรอบ และการสิ้นดีลไม่ลบ purchased/admin lots |
| เพดานต้นทุนและข้อจำกัดระบบ | Company/platform config + active/pending operational policy revision | Model/bound/TOTAL/CHAT/OCR monetary caps และ OCR monthly count เป็นข้อมูลผู้ดูแล; ไม่ส่งเป็นเครดิต/รูปคงเหลือของลูกค้า |
| สมาชิกและสิทธิ์งาน | CompanyPlanTerm/paid membership source + tenant/permission/feature checks เดิม | แยก valid balance, can use และ can buy; admin grant ไม่ขยาย term หรือคืนสถานะบริษัท |
| ต้นทุนจริง | AiUsageEvent/reservation settlement + corrections จากหลักฐาน provider | ใช้ cost report และ CHAT conversion ตามหน่วยเดิม; OCR cost ไม่เป็น CHAT debit หรือจำนวนรูปโดยตรง |
| เงินและเอกสารรับเงิน | Verified invoice/payment/refund/credit note ใน company/account/mode เดิม | ซื้อเพิ่มใช้ paid source; admin gift ไม่มี paid invoice; unit return ไม่ใช่ cash refund |
| สถานะและคำตอบแต่ละ action | API decision ที่ประกอบ sources ข้างต้นใน context เดียว | UI/LINE อ่าน public reason/action; ไม่ตีความ cap error เป็นยอดหมดเอง; operator ได้ diagnostic ตามสิทธิ์ |

Reuse policy resolver/readAiBudgetReadiness/receiptQuotaSnapshot และ billing application boundaries ที่มีอยู่ โดยเพิ่ม commercial projection และ source binding ในตำแหน่งเดิม. ไม่ต้องรวมทุกข้อมูลลงตารางเดียว ไม่เพิ่ม service หรือ event bus ชุดใหม่. API เป็นเจ้าของ final mutation; Gateway รับ envelope และใช้ internal API ที่ตรวจสิทธิ์เท่านั้น

### 18.2 แยกคำสั่งเพิ่มยอดจากคำสั่งตั้งเพดาน

- หน้า admin แยกงาน **“เพิ่มยอดให้ลูกค้า”** ซึ่งเลือกเครดิตแชตหรือจำนวนอ่านรูป และ **“ตั้งเพดานต้นทุน AI”** ซึ่งเป็นการควบคุมภายใน. แบบแรกใช้ D6–D8 shared grant/approval; แบบหลัง reuse operational writers และ guards เดิม. การเพิ่ม CHAT ไม่เปลี่ยน IMAGE หรือ cap; เพิ่ม IMAGE ไม่เปลี่ยน CHAT หรือสมาชิก
- New grant รับ product/quantity/reason/source version ตาม contract; server กำหนดอายุ 12 เดือนนับจาก appliedAt ที่ commit สำเร็จ. Preview ระบุ “ใช้ได้ 12 เดือนนับจากวันที่เพิ่มยอดสำเร็จ”; หลังสำเร็จแสดง expiresAt จริง. Retry คืน appliedAt/expiresAt เดิม ไม่เริ่มอายุใหม่. ไม่ใช้ maxExpiry=min(termEndsAt,paidThrough) กับ new lot และไม่เปิดช่องกรอก expiry ที่ขัด D8; legacy operations ยัง decode กติกาเดิม
- SPLIT activation flag, การเลือก model, C+O<=TOTAL, การเปลี่ยนโหมดเดือนถัดไป และ cap floor เป็น guard ของ operational settings/usage ไม่ใช่ validator ของยอด grant. Admin gift อาจมีคำเตือนว่าใช้ยังไม่ได้ตาม eligibility จริง; ข้อความสำเร็จยืนยันเฉพาะ “เพิ่มยอดแล้ว” ไม่รับประกันว่าทุกงานเรียก AI ได้
- รักษา scope/permission/approval/credential/source hash/idempotency และ company security เดิม. ไม่ใช้การยกข้อจำกัด expiry เป็นการอนุมัติสร้าง gift ให้บริษัทที่ lifecycle/สิทธิ์สร้างไม่ผ่าน. ยอดที่ให้แล้วคงอยู่และพักใช้ตาม D8
- activeAttemptId/collection เป็น source ของการจ่าย/สมาชิก ไม่ใช่ล็อกกระเป๋าทุกคำสั่งโดยอัตโนมัติ. Admin grant ที่ไม่เปลี่ยน source เหล่านี้ทำร่วมกับ paid apply ได้ภายใต้ balance locks; ห้าม clear หรือยึด activeAttempt ของ checkout. ถ้า source มีผลต่อ eligibility/authorization จริงและเปลี่ยน ต้อง revalidate หรือให้ตรวจรายการเดิมด้วยเหตุผลที่ตรง ไม่ bypass
- New-sale readiness ตรวจว่า paid product ใช้ได้ผ่าน consumer จริงตาม cohort/model/bounds/feature ก่อน checkout. การปิดขายไม่บล็อก grant จาก paid evidence ที่รับแล้วหรือปิดการกู้ยอดเดิม. Commercial reservation ต้องพร้อมทั้ง SHARED/SPLIT โดยไม่ force บริษัทไป SPLIT หรือยกเพดานอัตโนมัติ

### 18.3 ตัดการผูกผิดระหว่าง allowance กับ operational cap

หลัง cutover เครดิต default 80/deal/legacy allowance ที่พิสูจน์ได้เป็น included-cycle source. ห้ามตรวจ CHAT allowance เดิมซ้ำเป็นเพดานรวมของ included+additional จนแพ็กหมดแล้วใช้ยอดซื้อไม่ได้. Actual operational TOTAL/OCR/explicit CHAT cap ยังมีผลตาม config ที่อนุมัติ; ต้องมี provenance/adapter แยกความหมายนี้ก่อนเปิดสินค้า

P0 ต้องจัดกลุ่มบริษัทจากข้อมูลจริง: SHARED default, SHARED explicit TOTAL override, SPLIT active/pending, CHAT deal, legacy TOTAL deal, manual/trial/paid/annual. ห้ามสันนิษฐานว่า explicit TOTAL override ทั้งหมดเป็น gift หรือว่าเป็น safety-only แล้วลด included สิทธิ์เดิม. บันทึก source/version และผลก่อน–หลังด้วย resolver เดิม; cohort ที่แยกไม่ได้คง legacy และไม่เปิดซื้อเพิ่มจน mapping ตรวจสอบได้. ไม่ถาม Owner เลือกวิธีเขียนโค้ดแทนการตรวจ source

Platform default, company config, deal apply/return/expiry, package renewal/upgrade/repeat, temporary capacity override, trial carryover, free-days, grace start/restore และ plan sweep ต้องอยู่ใน writer matrix เดียวกัน. Paid/admin add-on lots ไม่ถูกผู้เขียน package kinds ต่อ/ลดอายุหรือ reset. ค่า default/pending ที่เปลี่ยนไม่เพิ่ม/ถอน paid units และไม่ย้อนแก้ invoice/usage snapshot. รักษา whitelist package kinds ปัจจุบันแทนการขยายให้ครอบทุก grant

### 18.4 Context, snapshot และเส้นทางใช้งาน

1. ตรวจ tenant/actor/permission/source-state และจำแนก trusted route/content/operation ก่อนเลือก commercial product; OCR cost bucket ไม่ใช่ RECEIPT_IMAGE เสมอ. รักษา CRM/draft ที่ใช้ CHAT ตาม scope เดิม และ statement/PDF/multipage ที่ไม่ใช้ IMAGE add-on. Deterministic/no-provider ไม่จองหรือตัดเครดิต AI เพียงเพราะใช้หน้าผู้ช่วย
2. Pin companyId, asOf (UTC), Bangkok operational monthKey, membership cycle identity, lot references, policy/config revisions และ source versions ใน API context เดียว. monthKey ของต้นทุน/ตั้ง cap กับ cycle ของสิทธิ์สมาชิกและวันหมดอายุ lot เป็นคนละฟิลด์ ห้าม map ทับกัน
3. Display/read ใช้ consistent transaction/snapshot และ projector เดียวสำหรับยอดและเหตุผล โดย reuse RepeatableRead pattern ที่มี. คืน customer quotaSummary ตาม §17; operator อ่านยอดเดียวกันพร้อมรายละเอียดที่มีสิทธิ์. SnapshotId opaque ไม่ใช้เรียงลำดับตัวอักษร; refresh/generation/company guards เดิมยังอยู่
4. Preview/read ไม่เป็นการอนุมัติใช้ถาวร. ก่อน mutation/provider re-read ภายใต้ lock order ที่ครอบทุก writer แล้วประเมิน commercial funding + operational bound + feature/count readiness ของ request จริง. การจองส่วนหนึ่งผ่านแต่อีกส่วนไม่ผ่านต้องไม่มี debit/provider และคืนเฉพาะ reservation ที่พิสูจน์ว่าไม่ dispatch; ไม่มี network I/O ใน transaction
5. Parent DB reservation/operation เป็น authority ของ child company/month/cycle/funding/model/pricing. แก้ F04 ให้ select และตรวจ parent.monthKey; request body ไม่พาไปจองอีกเดือน/อีก lot. Capture resume/LINE redelivery/CRM/draft requeue ใช้ operation identity เดิมตาม workflow; explicit user reread เป็นงานใหม่ตาม D4
6. CHAT ตัดหน่วยตาม metered usage ที่ยืนยันและ source allocation ครั้งเดียว; IMAGE ตัดหนึ่ง eligible durable usable result ต่อ logical read ไม่ใช่ทุก preprocess/chunk/provider call. Failure/compensation, operator hold actions, late usage correction และ financial refund มี effects แยกตามหลักฐาน ไม่คืนหรือ mint ซ้ำ
7. History/notifications หลัง commit อ่านผลจริงจาก source เดียว. Customer ไม่เห็น holds แต่ availability ต้องหักภายใน; pending hold ไม่ปล่อยเพราะซ่อน UI/timeout. Operator กู้รายการที่เก่ากว่าสองเดือนหรือข้าม cutover ได้โดยอ้าง funding source; expired lot ไม่ฟื้นจาก late evidence

### 18.5 Field/value และความเข้ากันได้ของ API

| Field / intent | กติกาที่ต้องตรงตั้งแต่ writer ถึง UI |
| --- | --- |
| productKind, quantityUnits, unitScale | Grant/offer/history ใช้ CHAT_CREDIT/100 หรือ RECEIPT_IMAGE/1; CHAT 50=5000 units, IMAGE 20=20 units. จำนวนรูปเต็มบวก; แชตละเอียด 0.01; ตรวจ range ทั้ง parse/convert/DB/sum ก่อน mutation |
| priceSatang / costSatang / monthlyBudgetSatang | ทั้งหมดเป็นสตางค์แต่คนละความหมาย: ราคาขาย/ต้นทุนจริง/เพดาน. ห้าม cast เป็นจำนวน grant. CHAT50 ราคา29900; IMAGE20 ราคา34900 ไม่ใช่จำนวนเครดิตหรือรูป |
| packageRemainingUnits/additionalRemainingUnits/totalRemainingUnits | สูตร §17 เดียวทุก consumer; source priority→FEFO; operator totals เท่ากับ customer totals ณ snapshot เดียว ไม่มี writer อัปเดต balance counter แยกจาก effects |
| OCR monthlyLimit / receipt allowance | monthlyLimit เป็น operational count รวม routes เดิม ส่วน receipt product เป็นสิทธิ์ commercial; เปลี่ยน monthlyLimit ไม่สร้าง IMAGE grant และจำนวน uploaded files ไม่ใช่ used units |
| undefined / null / 0 | Config omitted=คงเดิม; monthlyBudgetSatang:null=inherit; budgetPolicy:null=cancel future pending เท่านั้น; OCR monthlyLimit:null=ไม่มี count cap. Wallet 0=ยอดจริง, missing/error=unavailable; null ไม่ใช่ unlimited นอก explicit FINITE/UNLIMITED ของ §17 |
| effectiveMonthKey / cycle / paidAt / appliedAt / expiresAt | Operational policy ใช้เดือนปฏิทินไทย; included ใช้ anniversary; purchased ใช้ paidAt ที่พิสูจน์; admin ใช้ appliedAt; แสดงวันเวลาจาก server ไม่ใช้ timezone browser หรือเวลารับ webhook |
| reason / revision / allowed action | Request เหตุผลและ expected revision ผูก source ถูกประเภท; response มี public reason/action ตามหลักฐาน. Customer payload ไม่มี operator diagnostic/cost/admin reason; role ของ financial documents คงเดิม |

เพิ่ม/แปลง contracts แบบ explicit โดยคง legacy meaning; ไม่เปลี่ยน old additionalRemaining ให้รวม paid เงียบ ๆ ไม่เปลี่ยน field cap เดิมเป็น wallet. เก็บ old operation/snapshot decoder และ compatibility version จน callers ย้ายครบ. Unknown schema/state หรือ DTO ขาดห้าม fallback ไป raw object/0/ไม่จำกัด; ปิดเฉพาะ feature ใหม่ที่ยังอ่านไม่ได้และคง legacy path ที่ปลอดภัย

### 18.6 Guard และคำไทยที่เหมาะกับงาน

“ไม่มี block” หมายถึงผู้มีสิทธิ์ทำรายการข้อมูลถูกต้องแล้วไม่ติดเพดาน/เดือน/expiry/source ของคนละงาน. Permission, negative balance, duplicate source, unresolved payment, corrupt state และจริง ๆ ถึง operational limit ยังต้องถูกตรวจ. ห้ามลบ guards เพื่อทำให้หน้าจอไม่มี error

เพิ่มยอดสำเร็จใช้ “เพิ่มเครดิตแชตแล้ว” / “เพิ่มจำนวนอ่านรูปแล้ว”; ถ้าใช้งานยังไม่ได้แสดงเหตุแยก ไม่เปลี่ยนผล grant เป็นล้มเหลว. Stale preview ใช้ “ข้อมูลเปลี่ยนแล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจรายการอีกครั้ง”; บันทึกแล้ว response หายใช้ “กำลังตรวจสอบผลรายการเดิม” แล้ว read ด้วย operation key เดิมก่อนเปิดให้ส่งใหม่. Form แสดง validation ข้าง field; server revalidate เสมอ. ไม่มี toast สำเร็จและ error ของ mutation เดียวกันพร้อมกัน

Operational errors อยู่หน้าผู้ดูแลพร้อม field/action ที่แก้ได้ ใช้คำ “เพดานต้นทุน AI” และบาทสำหรับค่าใช้จ่ายภายใน ไม่ใช้ “เครดิตลูกค้า” กลบ. ลูกค้าใช้ copy matrix §17.4: ยอดไม่พอจึงซื้อเพิ่ม, ถึงขีดจำกัดบริษัทจึงติดต่อผู้ดูแล, สมาชิกหมดจึงต่ออายุ, ระบบไม่พร้อมจึงลองอ่านสถานะ/ติดต่อช่วยเหลือตามจริง. ไม่อ้าง charge/refund/file-saved หาก source ยังไม่ยืนยัน; U07 queued LINE compatibility ต้องพร้อมก่อนเปลี่ยน template

### 18.7 Acceptance เพิ่ม A25–A32

| ID | เกณฑ์ผ่าน |
| --- | --- |
| A25 | Grant/allowance/operational cap/cost/payment เป็นคนละ authority; config writers ไม่ mint/revoke units; legacy meanings และ null/zero/omitted ไม่เปลี่ยนเงียบ ๆ |
| A26 | Admin CHAT/IMAGE ใช้ shared grant กับ paid source โดย authority ต้นทางแยก; new gifts 12 เดือน; ไม่บังคับ SPLIT/model/C+O<=TOTAL/เดือนหน้าหรือ active checkout ที่ไม่เกี่ยว; security/approval/source guards คงอยู่ |
| A27 | Customer/admin/timeline/preview/LINE อ่าน commercial balances จาก allocator/projector เดียวและ snapshot ที่สอดคล้อง; availability มาจาก canonical decision ไม่ใช่ยอดบวกหรือ money OK อย่างเดียว |
| A28 | ทุก AI entry point pin route/product/source; deterministic ไม่ตัด, non-receipt OCR ไม่กิน IMAGE; parent/child funding และ logical operation ไม่หักซ้ำ; commercial reservation ใช้ได้โดยไม่ force SPLIT |
| A29 | Deal/default/package/free-days/grace/trial/sweep/cutover ไม่ลบหรือเปลี่ยนอายุ additional lots; ไม่มี early included reset; cohort mapping เก็บสิทธิ์เดิมและ D9 |
| A30 | Grant/use/settle/refund/revoke/correction/config/reset ใช้ lock/source-version matrix ที่ไม่ deadlock และไม่สร้าง effect ซ้ำ; old-month holds ค้นกู้ได้ ไม่มี expired revival/late debit ผิด source |
| A31 | Form/API/DB/UI หน่วย/ราคา/วันที่/reasons ตรง; ทุก valid flow มีทางจบและ error มี Thai next action; no raw error/false buy/false success/false refund และ no customer internal fields |
| A32 | Compatible schema/readers/operation decoding และ source reconciliation พร้อมก่อนเปิด consumer/sales ราย cohort; gate closed ยังใช้/กู้ยอดเดิมได้; no paid lots backfill จาก cap และไม่มี rollback binary ที่อ่านสิทธิ์ใหม่ไม่ได้ |

รวม A01–A32 และ E01–E60; ทั้ง 60 E2E scenarios ยังไม่รัน. ตรวจเอกสารและ source ไม่ทดแทนหลักฐาน DB concurrency, browser, provider/payment และ release acceptance
