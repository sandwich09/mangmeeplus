# Handoff: การ์ด LINE ระบบมั่งมีตามดีไซน์ที่ล็อก

วันที่ส่งต่อ: **5 ตุลาคม 2569** · Repository: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus`

**สถานะ: ดีไซน์อนุมัติแล้ว ตรวจโค้ดและทำแผนแล้ว ยังไม่ได้แก้ runtime สำหรับงานนี้** มีภาพครบ **8 บริบท / 20 ตัวอย่างตามสถานะ / 40 ภาพ** ที่ความกว้าง 320 และ 736 px พร้อมผลตรวจจาก HTML ที่อนุมัติ

เจ้าของสั่ง **“โอเค lock design นี้ไว้ ต้องเป็นตามนี้เท่านั้น”** เมื่อ 2026-10-04 และ **“ทำเลย”** เมื่อ 2026-10-05 จึงอนุญาตให้ลงโค้ดตามแบบนี้แล้ว คำขอ handoff ล่าสุดให้จัดเตรียมเอกสารส่งต่อ งานเผยแพร่ UAT/Production ของ **System OA** ยังไม่ได้รับคำสั่ง การเผยแพร่ Contact Us / Social Media ของ **MangmeePlus Official ฝั่งการตลาด** ก่อนหน้านี้เป็นคนละงาน

## คำสั่งสำหรับผู้รับงาน

> นำดีไซน์ LINE ระบบมั่งมีที่ล็อกแล้วไปใช้ใน native Flex ทั้ง 8 บริบทตามภาพและเอกสารนี้ ห้ามออกแบบใหม่ ให้เริ่มจาก spec, plan, source code และ fixtures ที่ลิงก์ไว้ รักษาสี สัดส่วน หัวสองบรรทัด มาสคอตยื่นข้ามรอยต่อ และแถว `ชื่อ : ค่า` ตาม baseline ข้อความกับข้อมูลต้องเปลี่ยนตามเรื่อง สถานะ และสิทธิ์ที่มีจริง ห้ามใส่ข้อมูลตัวอย่างลง runtime หรือแต่งคำตอบใหม่จากภาพ
>
> ใช้ builder และสัญญาข้อมูลเดิมก่อน รักษา canonical answer, tenant/permission checks, confirmation postbacks, source freshness, fallback และการส่งหลายข้อความให้ข้อมูลครบ ตรวจทุกเส้นทางของ gateway และ media acknowledgment รวมถึงปลายทางใบเบิก ทำ focused checks ที่เกี่ยวข้อง แล้วบันทึกผลใน plan/memory พร้อม native preview จาก payload จริง ยังไม่เผยแพร่ระบบจากคำสั่งนี้
>
> Checkout มีงานอื่นค้างอยู่หลายไฟล์ รวมไฟล์ LINE ที่จะเกี่ยวข้อง อย่า reset, ย้อนทับ หรือรวบงานอื่นไป commit/deploy อ่าน AGENTS.md และ Ponytail full ก่อนแก้โค้ด ไม่แก้ package.json ถ้าไม่ได้เปลี่ยน dependency และไม่เพิ่ม dependency, model call หรือ migration เพื่อเปลี่ยนหน้าตาการ์ด

## เอกสารและแบบที่เป็นข้อกำหนด

- [Spec ของดีไซน์ที่ล็อก](../specs/line-system-oa-card-design-lock-spec-th.md)
- [แผน implementation และ checklist](../plans/line-system-oa-card-design-implementation-plan-th.md)
- [Task memory พร้อมประวัติการตัดสินใจและตรวจ source](../agent-memory/line-system-oa-card-pattern-review-2026-10-04.md)
- [HTML ต้นฉบับที่ล็อก](../evidence/line-system-oa-design-lock-2026-10-04/approved-preview.html)
- [Manifest ของ baseline: 30 ไฟล์และ SHA-256](../evidence/line-system-oa-design-lock-2026-10-04/manifest.json)
- [Preview เปิดดูได้ของชุด handoff](../evidence/line-system-oa-handoff-2026-10-05/preview.html)
- [ผลตรวจรอบ handoff: 40 กรณี PASS](../evidence/line-system-oa-handoff-2026-10-05/source-backed-card-checks.json)
- [Manifest ของชุดภาพ handoff](../evidence/line-system-oa-handoff-2026-10-05/manifest.json)

SHA-256 ของ HTML ที่อนุมัติ: `2e3670353dbba10dfe6925fc019a04f59018147977bf0816967fcb6f0e42196d` ขนาด 703,004 bytes ชุดภาพ handoff สร้างใหม่จาก HTML เดียวกันโดยไม่เปลี่ยน baseline ตัวปรับใน preview เป็นเครื่องมือสำรวจ ค่าที่อนุมัติคือค่าเริ่มต้นใน manifest

## ภาพตัวอย่างครบทุกบริบทและสถานะ

แต่ละแถวมีภาพสองขนาด กดลิงก์เพื่อดูภาพเต็ม **320 px ใช้ตรวจพื้นที่แคบ / 736 px ใช้ตรวจ layout อีกขนาดหนึ่ง** ทั้งสองเป็น viewport ของตัวอย่าง HTML ยังไม่ใช่ภาพจาก LINE client หรือ native payload

| บริบท | ตัวอย่าง / สถานะ | ภาพ 320 px | ภาพ 736 px |
| --- | --- | --- | --- |
| 1. สรุปค่าใช้จ่าย | สิงหาคม 2569 | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-expense-summary-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-expense-summary-736.png) |
| 2. งานค้าง | พบใบเบิกรออนุมัติ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-open-alert-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-open-alert-736.png) |
| 2. งานค้าง | ไม่พบแจ้งเตือนที่ยังเปิด | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-empty-alerts-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-empty-alerts-736.png) |
| 2. งานค้าง | ไม่พบงานที่มอบหมายและยังไม่เสร็จ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-empty-assigned-tasks-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/business-empty-assigned-tasks-736.png) |
| 3. ถามตอบทั่วไป | “ทำอะไรได้บ้าง” | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-capability-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-capability-736.png) |
| 3. ถามตอบทั่วไป | “วันนี้เหนื่อยจัง” | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-casual-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-casual-736.png) |
| 3. ถามตอบทั่วไป | อธิบายค่าบริการในบิล BHC | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-explain-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-explain-736.png) |
| 4. คำสั่งแก้ไข | รอยืนยัน ก่อนบันทึก | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-command-preview-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-command-preview-736.png) |
| 4. คำสั่งแก้ไข | แก้ไขแล้ว | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-command-applied-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/source-command-applied-736.png) |
| 4. คำสั่งแก้ไข | ยกเลิกแล้ว ยังไม่ได้แก้รายการ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/cancelled-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/cancelled-736.png) |
| 4. คำสั่งแก้ไข | ขอข้อมูลเพิ่ม | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/clarify-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/clarify-736.png) |
| 5. รายการทั่วไป | ยืนยันแล้ว | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-general-card-layered-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-general-card-layered-736.png) |
| 5. รายการทั่วไป | กำลังตรวจสอบข้อมูล | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-กำลังตรวจสอบข้อมูล-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-กำลังตรวจสอบข้อมูล-736.png) |
| 5. รายการทั่วไป | ปฏิเสธ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-ปฏิเสธ-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-ปฏิเสธ-736.png) |
| 5. รายการทั่วไป | ยกเลิก | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-ยกเลิก-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/general-ยกเลิก-736.png) |
| 6. รอตรวจสอบ | ใบเสร็จรอตรวจสอบ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-review-card-layered-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-review-card-layered-736.png) |
| 7. ชำระเงิน | ชำระแล้ว | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-payment-card-layered-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-payment-card-layered-736.png) |
| 7. ชำระเงิน | ยังไม่ชำระ | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/payment-ยังไม่ชำระ-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/payment-ยังไม่ชำระ-736.png) |
| 7. ชำระเงิน | ชำระบางส่วน | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/payment-ชำระบางส่วน-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/payment-ชำระบางส่วน-736.png) |
| 8. กำลังสแกน | รับเอกสารแล้ว กำลังอ่าน | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-scanning-card-layered-320.png) | [ดูภาพ](../evidence/line-system-oa-handoff-2026-10-05/screenshots/mm-scanning-card-layered-736.png) |

## รูปมาสคอตที่ต้องใช้

| รูป | การใช้งาน | ไฟล์ PNG โปร่งใสที่ล็อก |
| --- | --- | --- |
| มาสคอต POS / เงิน | ทุกบริบทและสถานะทั่วไป รวมคำถาม คำสั่ง สรุป งานค้าง รายการและการชำระเงิน | [payment-cutout.png](../evidence/line-system-oa-design-lock-2026-10-04/payment-cutout.png) |
| มาสคอตแว่นขยาย | ใบเสร็จรอตรวจสอบ | [review-cutout.png](../evidence/line-system-oa-design-lock-2026-10-04/review-cutout.png) |
| มาสคอตสแกนมือถือ | กำลังอ่าน/สแกนเอกสาร | [scanning-cutout.png](../evidence/line-system-oa-design-lock-2026-10-04/scanning-cutout.png) |

ต้นฉบับจากเจ้าของ: [POS / ชำระเงิน](</Users/thawatchai/Downloads/line/S__66076710.png>), [ตรวจสอบ](</Users/thawatchai/Downloads/line/S__66076711.jpg>), [สแกน](</Users/thawatchai/Downloads/line/S__66076713.png>) สำหรับ runtime ให้ใช้ cutout ที่ล็อกไว้ข้างต้น ยังไม่ได้คัดลอกไป static assets ของเว็บหรือเผยแพร่ URL สำหรับ Flex

## กฎดีไซน์ที่ต้องคงไว้

- หัวไล่สี **`#174e37` → `#167c52`**, พื้นข้อมูลขาว, แถวเน้นยอดครีม **`#f3f0df`** สีสถานะและปุ่มตามภาพของแต่ละบริบท
- หัวกระชับ **80–81 px** ใน HTML baseline, พื้นขาวมุมโค้งซ้อนขึ้น **12 px**, มาสคอตกว้าง **112 px** ยื่นลงจากรอยต่อ **16 px** และอยู่เหนือพื้นขาว ขนาดเหล่านี้เป็นหลักฐานของแบบ ไม่ใช่การรับรองว่า native Flex แสดงตรงแล้ว
- ข้อความหัว **2 บรรทัดเท่านั้น** เปลี่ยนตามบริบท/สถานะ ไม่มี `MANGMEE PLUS`, ข้อความมุมขวาบน หรือ `คำสั่งมั่งมี` ห้ามขยายหัวหรือเพิ่มช่องว่าง
- แถวข้อมูลมีสามคอลัมน์ **ชื่อข้อมูล / `:` / ค่า** จัด `:` ให้ตรงกัน ข้อความยาวขึ้นบรรทัดได้ ข้อมูลสำคัญต้องไม่หาย
- คำถามทั่วไปแสดงคำตอบตรงๆ ไม่เพิ่ม `คำตอบจากน้องมั่งมี`, `ถามตอบทั่วไป`, `น้องมั่งมีตอบให้นะคะ`, `คำถามของคุณ` ซ้ำในตัวการ์ด คำถามสั้นใช้เป็นหัวได้ คำถามยาวย่อหัวตามเรื่อง ไม่บังคับทวนคำถามทุกครั้ง
- ใบเสร็จรอตรวจสอบ **ไม่มีแถบเหลืองรอตรวจสอบซ้ำ** สแกน **ไม่มี** `เอกสารที่รับ : รูปภาพ` และ `สถานะ : กำลังอ่านข้อมูล` ไม่ใส่เปอร์เซ็นต์หรือเวลาจบที่ไม่ทราบ
- งานค้าง **ไม่มี** `ระดับแจ้งเตือน` และ `ขอบเขต` ใช้ `เลขที่ใบเบิก`, `ต้องทำ : ตรวจสอบและอนุมัติใบเบิก`, `ข้อมูล ณ` ตามภาพ และหมายเหตุว่าตรวจเฉพาะอะไร
- พื้นแชตสีน้ำเงิน เวลาแชต ข้อความ “ตัวอย่างดีไซน์” carousel และตัวปรับเป็นเครื่องมือแสดงตัวอย่าง **ไม่ส่งอยู่ภายใน Flex**
- ถ้า native LINE ทำส่วนใดให้ตรงไม่ได้ ให้ระบุความต่างและขอคำสั่งใหม่ก่อนเปลี่ยน baseline ห้ามแทนแบบอื่นเอง

## ข้อมูลในตัวอย่างมาจากไหน และ runtime ตอบอะไรได้

เจ้าของขอให้ตรวจคำตอบในโค้ดจริงแล้ว ตัวอย่างคำตอบที่แต่งขึ้นในช่วงแรกถูกแทนด้วย source/fixtures ด้านล่าง ให้ใช้ชุดล่าสุดเท่านั้น

- [คำตอบจาก source: ความสามารถ / คุยทั่วไป / อธิบายบิล / แก้ไขรายการ](../evidence/line-system-oa-design-lock-2026-10-04/source-answer-examples.json) และ [ตัวตรวจคำตอบจาก source](../evidence/line-system-oa-design-lock-2026-10-04/verify-source-answers.mts)
- [Fixture สรุปค่าใช้จ่ายและงานค้าง](../evidence/line-system-oa-design-lock-2026-10-04/business-summary-examples.json) และ [ตัวตรวจ business examples](../evidence/line-system-oa-design-lock-2026-10-04/verify-business-summary-examples.mts)

| บริบท | ข้อมูล/พฤติกรรมที่นำไปใช้ได้ |
| --- | --- |
| สรุปค่าใช้จ่าย | ยอดรวม จำนวนรายการ ช่วงวันที่ ที่มา ข้อมูล ณ และรายการที่ยกเว้นจากผลอ่านจริง ตัวอย่าง fixture คือ 85.00 บาท / 7 รายการ / สิงหาคม 2569 / ไม่รวมรายการยกเลิกหรือปฏิเสธ 1 รายการ คำถามสรุปกว้างไม่เพิ่มยอดจ่าย/ค้าง หมวด ร้านค้า หรือ breakdown เอง |
| งานค้าง | แยกแจ้งเตือนที่ยังเปิดตามสิทธิ์กับงาน OPEN ที่มอบหมายให้ผู้ใช้ ตัวอย่างพบใบเบิก `RB-202608-00002` หรือผลอ่านสำเร็จที่ไม่พบรายการ ข้อมูลว่างต้องไม่เกิดจากการไม่มีสิทธิ์/ระบบอ่านล้มเหลว |
| ถามตอบทั่วไป | คำตอบตามสิทธิ์และฟีเจอร์ที่ใช้งานได้ คุยทั่วไปตามคำตอบเดิม หรืออธิบายเอกสารที่อ้างอิงได้ ตัวอย่าง BHC อธิบายสินค้า 1,520 + ค่าบริการ 152 + VAT 117.04 = 1,789.04 บาท รักษาคำตอบและแหล่งข้อมูลเดิม |
| คำสั่งแก้ไข | รายการที่แก้ ค่าเดิม→ค่าใหม่ ยอดก่อน/หลัง คำเตือนและขั้นที่เกิดจริง ตัวอย่าง BHC เพิ่มค่าบริการ 152.00 ยอด 1,626.40→1,789.04 ต้องแสดง preview และบันทึกเมื่อยืนยันเท่านั้น |
| รายการทั่วไป / รอตรวจสอบ | facts ของเอกสารจาก capture/OCR หรือ record จริง เช่นเลขรายการ ร้านค้า วันที่ รายการ ยอด VAT หมวดและสถานะตามที่อ่านได้ `ยืนยันรายการ` ไม่เท่ากับ `ชำระเงินแล้ว` |
| ชำระเงิน | net payable, paid, outstanding, payment status และวันที่/วิธีจ่ายที่ source รองรับ บาง fields มีใน model แต่ LINE detail tool ยังไม่ส่ง ต้องเพิ่ม projection อย่างจำกัดก่อนแสดง |
| กำลังสแกน | ยืนยันว่ารับเอกสารแล้วและกำลังประมวลผล ณ ขั้นที่เกิดจริง ไม่อ้างว่าอ่านสำเร็จ ไม่สมมุติ progress หรือเวลาจบ |

Q&A / คำสั่งแก้ไข / สรุป / งานค้างใช้ outputs ที่รันแบบ offline จาก source กับ repository fixtures ไม่ได้ดึงบทสนทนา Production หรือยอดปัจจุบันของเจ้าของ ส่วนเลข `DEMO-EXP-*` และข้อมูลในตัวอย่างรายการทั่วไป/รอตรวจสอบ/ชำระเงินเป็น **ข้อมูลสมมุติเพื่อดู layout** ทุกจำนวน วันที่ ชื่อร้านและเลขเอกสารต้องแทนด้วยข้อมูลที่ตรวจสิทธิ์แล้วใน runtime ห้าม hardcode จากภาพ ถ้าข้อมูลหายให้ละหรือระบุว่าไม่ทราบตาม contract เดิม อย่าเพิ่มแถวใหม่เพียงเพราะ model มี field

ข้อมูลใบเสร็จมี field ที่รองรับหลายชนิด แต่ต้องใช้เฉพาะที่ grounded แยกวันที่พิมพ์บนบิลกับวันที่อัปโหลด และผู้ขอเบิกกับผู้อัปโหลด Contract หมวดค่าใช้จ่ายปัจจุบันมีชื่อหมวดเดียว ไม่ได้มี parent/subcategory แยกตามภาพอ้างอิงแรก

## จุดในโค้ดที่ตรวจแล้ว และช่องว่างที่ต้องทำต่อ

Removed 2026-10-05: the card reply is always on; there is no switch.

| จุด | ข้อค้นพบ / งานต่อ |
| --- | --- |
| [line-business-card.logic.ts](../../apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts) | builder เดิมสำหรับข้อความ, receipt draft และ answer cards ใช้ theme/layout เดิม รักษา `safeTenantLink`, canonical text และ fallback แล้วใช้ native pattern ร่วมเฉพาะบริบทที่ล็อก อย่าเปลี่ยน signup/package/legal/quota card ที่ใช้ helper เดียวโดยไม่ตั้งใจ |
| [line-draft-update-card.logic.ts](../../apps/api/src/modules/line-ai/domain/logic/line-draft-update-card.logic.ts) | preview เดิมมี diff ยอดก่อน/หลังและปุ่มยืนยัน/ยกเลิก เปลี่ยนหน้าตาโดยรักษา preview binding, sanitization และความหมายก่อน/หลังบันทึก |
| [process-line-webhook.use-case.ts](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) | `expenseDraftCardFacts`, `deliverCompletedReply/Replies`, gateway completion และ draft preview เป็นจุดต่อที่ต้องตรวจ canonical fallback, multipart และ permission-filtered quick replies ยังมี `lineAiMultipartTerminalFlexEnabled` ที่ default-off: อย่ารายงานว่าใช้การ์ดแล้วโดยไม่ได้ตรวจ gating และเส้นทางจริง การเปลี่ยน flag/gate ไม่ได้ทำในงานเตรียมนี้ |
| [line-message-buffer.service.ts](../../apps/api/src/modules/line-ai/application/line-message-buffer.service.ts) / [line-message-buffer.logic.ts](../../apps/api/src/modules/line-ai/domain/logic/line-message-buffer.logic.ts) | media acknowledgment ยังเป็น text ใช้ scan card แทน ณ จังหวะเดิม รักษา loading และ settle acknowledgment ก่อน final reply ไม่เพิ่มข้อความซ้ำ ไฟล์ต้องไม่ถูกเรียกว่าเป็นรูปโดยไม่มีข้อมูล |
| [LineAiAnswerCard contract](../../packages/contracts/src/line-ai.ts) / [runtime validator](../../apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts) | ปัจจุบันมี title/text/sourceLabels/webLink/badge ยังไม่มีแถว/บริบทของดีไซน์ใหม่ แผนเสนอ metadata optional จาก trusted gateway พร้อม validation; `text` ยังเป็นคำตอบ canonical ห้ามรับ Flex JSON จาก model |
| [orchestrator.agent.ts](../../apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts) / [line-ai-turn.use-case.ts](../../apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts) | ต้องครอบคลุม **3 เส้นทาง**: `buildAnswerPresentation`, `buildPreparedAnswerResult` และ direct tool read ที่สร้าง `answer_cards` เอง ใช้ผล tool สำเร็จที่มีสิทธิ์ ไม่ parse ข้อความโมเดลเพื่อเดายอดหรือ source |
| [response-composer.agent.ts](../../apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts) / [prepared-simple-read-formatter.ts](../../apps/ai-gateway/src/modules/line-ai/agents/prepared-simple-read-formatter.ts) | มี formatter สรุปค่าใช้จ่ายตามช่วง/ที่มา/as-of และการยกเว้นข้อมูลอยู่แล้ว คงคำตอบนี้และ breakdown เฉพาะที่ผู้ใช้ถาม |
| [erp-dashboard-tools.use-case.ts](../../apps/api/src/modules/line-ai/application/use-cases/erp-dashboard-tools.use-case.ts) / [notification.use-cases.ts](../../apps/api/src/modules/dashboard-notifications/application/use-cases/notification.use-cases.ts) / [notification.logic.ts](../../apps/api/src/modules/dashboard-notifications/domain/logic/notification.logic.ts) | `NotificationsListOpenAlertsTool` ให้ลิงก์ `/notifications` และตัด detail link ออก ทั้งที่ DTO มี `deepLinkHref` ต้องส่งลิงก์ใบเบิกที่ตรวจ tenant แล้วจาก source จริง ไม่เดา ID จากเลขใบเบิก |
| [erp-workflow-tools.use-case.ts](../../apps/api/src/modules/line-ai/application/use-cases/erp-workflow-tools.use-case.ts) | `workflow.list_assigned_tasks` อ่านเฉพาะงาน OPEN ของผู้ใช้ ต้องไม่รวมเป็นงานทั้งหมดบริษัท |
| [erp-core-detail-tools.use-case.ts](../../apps/api/src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.ts) | expense detail ส่งยอด/สถานะจ่ายแล้ว แต่ยังไม่ส่ง paymentDate/paymentMethod แม้ model รองรับ หากจะแสดงต้องส่ง field ที่มีจริงผ่าน permission-checked use case เดิม ไม่มี migration จำเป็นจากการเปลี่ยน presentation นี้ |
| [หน้า journey ใบเบิก](<../../apps/web/app/(workspace)/companies/[companyId]/reimbursements/[requestId]/page.tsx>) / [ReimbursementsPages.tsx](../../apps/web/src/features/reimbursements/ReimbursementsPages.tsx) | route ใบเบิกโดยตรงมีแล้ว หน้า hub ปัจจุบันไม่ได้อ่าน `focus` ของ legacy link ต้องพาไป journey ของใบนั้นโดยตรงและให้เว็บตรวจสิทธิ์/สถานะ |

**ปลายทางใบเบิกที่ต้องได้:** `/companies/{companyId}/reimbursements/{requestId}` ปุ่มชื่อ **“เปิดใบเบิกเพื่ออนุมัติ”** เปิดเอกสาร ไม่อนุมัติทันที ใช้ request ID จาก persisted source/reference หรือ link ที่ตรวจแล้ว ห้ามเดาจาก `RB-…` legacy fixture `/reimbursements?tab=approvals&focus=…` เป็นข้อมูลเก่า ไม่ใช่เป้าหมายสุดท้าย

แจ้งเตือนต้องรักษา `notification.read` และ user/company scope การอ่านปัจจุบันขอ pageSize 10 และแสดงรายการสูงสุด 5; count ของหน้าที่อ่านไม่ใช่งานทั้งหมดบริษัท Workflow ต้องรักษา `workflow.task.read` ส่วน background notification push ใน workers/API เป็นอีกเส้นทางส่งและ **อยู่นอก scope implementation plan รอบนี้**

**Postback เดิมต้องคงไว้:** `action=draft-update-confirm&previewId=<opaque-id>` และ `action=draft-update-cancel&previewId=<opaque-id>`; displayText คือ `ยืนยันการแก้ไข` / `ยกเลิกการแก้ไข` คงการผูก user/company/chat/record-version, expiry และตรวจซ้ำใน handler ไม่ใส่ expenseId/companyId เพิ่มเพื่อข้าม binding

## วิธีทำต่อและตรวจรับ

1. อ่าน spec/plan/memory และตรวจ dirty diff ของไฟล์ที่จะเปลี่ยน เก็บ baseline ของงานอื่นก่อนทำ ไม่ถือว่าการแก้ในไฟล์เหล่านี้ทั้งหมดเป็นงานนี้
2. ทำ shared native Flex presentation สำหรับบริบทที่ล็อก และใช้ PNG ที่อนุมัติจาก static assets เดิม จัด gradient, rounded white paper และมาสคอตใน body เดียว โดยวางมาสคอตหลังสุดเพื่ออยู่บนพื้นขาวและไม่โดน header clip
3. ส่งข้อมูลแสดงผลจาก permission-checked tools/capture ผ่าน contract optional ที่ validate แล้วให้ครอบคลุมทั้ง 3 gateway paths ยึด canonical answer และให้ fallback ข้อมูลครบเมื่อ payload/render จำกัด
4. ต่อ receipt review, general/payment detail, Q&A และ draft-update states โดยรักษาปุ่ม/สิทธิ์/จังหวะ mutation เดิม ต่อ scan acknowledgment ณ จังหวะเดิมด้วย
5. แก้ projection ของ notification detail link และทดสอบว่าคลิกใบเบิกแล้วถึงใบนั้นจริงในบริษัทที่ถูกต้อง
6. ตรวจ payload และ preview จาก **native JSON จริง** เทียบภาพทุกสถานะ ทั้งแคบ/กว้าง ข้อความยาว unknown fields, zero results, forbidden/unavailable และ URL ที่ไม่ปลอดภัย ตรวจ relevant tests/typechecks พร้อมบันทึกข้อผิดพลาดที่เป็น baseline เดิม
7. บันทึกผลและไฟล์ที่เปลี่ยนใน plan/memory นำ native rendering ที่พร้อมตรวจให้เจ้าของดู งานเผยแพร่และตรวจบน LINE มือถือจริงเป็นขั้นแยก

LINE มี absolute positioning, gradient และ rounded boxes แต่ส่วน absolute ที่หลุด parent ถูกตัด จึงต้องตรวจ layering ของ payload จริง และไม่ถือ CSS shadow ใน HTML ว่า native ทำได้ตรงโดยอัตโนมัติ อ้างอิง: [Flex layout](https://developers.line.biz/en/docs/messaging-api/flex-message-layout/) และ [Messaging API reference](https://developers.line.biz/en/reference/messaging-api/nojs/)

เกณฑ์เสร็จของ implementation:

- [ ] ทั้ง 8 บริบทและสถานะใน gallery ตรง baseline; 2 บรรทัดหัว, ไม่มีคำซ้ำ/แถวที่ถูกตัด, มาสคอตถูกภาพและซ้อนถูกชั้น
- [ ] ข้อมูล source/permission/tenant/status ถูกต้อง; ไม่ใส่ fixture ใน runtime และไม่ตีความ unavailable ว่าไม่มีงาน
- [ ] แถว `:` ตรง, ไม่มีข้อความชนรูป/ตัดหาย, canonical text และ multipart/fallback ยังครบ
- [ ] ปุ่มใบเบิกถึง journey ของใบนั้น; cross-tenant/unsafe URLs ถูกปฏิเสธ; เว็บยังตรวจสิทธิ์
- [ ] Preview confirm/cancel, expiry/version/user binding และ final financial mutation boundaries เดิมไม่ถดถอย
- [ ] Scan acknowledgment/loading/final ordering ผ่าน ไม่มีข้อความรับเอกสารซ้ำ
- [ ] Gateway ทั้งสามเส้นทางและ runtime validator ผ่าน focused tests; typecheck ของส่วนที่แตะผ่านหรือระบุ baseline failure ชัด
- [ ] มี native payload/preview evidence; การตรวจจริงใน LINE client ระบุสถานะแยก ไม่อ้างว่า HTML test คือ native acceptance

ตัวอย่าง focused commands สำหรับผู้ลงโค้ด **ยังไม่ได้รันในงาน handoff นี้** ให้เลือกเฉพาะส่วนที่แก้และเพิ่ม test ของ renderer/contract ใหม่ตามจำเป็น:

```sh
pnpm --dir apps/api exec tsx --test src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts src/modules/line-ai/domain/logic/line-draft-update-card.logic.spec.ts src/modules/line-ai/application/line-message-buffer.service.spec.ts src/modules/line-ai/application/use-cases/erp-empty-result-semantics.spec.ts
pnpm --dir apps/ai-gateway exec tsx --test src/modules/line-ai/agents/orchestrator.agent.spec.ts src/modules/line-ai/agents/response-composer.agent.spec.ts src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts
pnpm --dir packages/contracts typecheck
pnpm --dir apps/api typecheck
pnpm --dir apps/ai-gateway typecheck
```

เพิ่ม webhook integration และ notification/detail-link checks เมื่อต่อเส้นทางนั้น ห้ามแก้ assertions ให้ผ่านด้วยการลดข้อกำหนด source, permission หรือข้อมูลครบ

## หลักฐานและสถานะ ณ ส่งต่อ

**เสร็จแล้ว:** ตรวจ current source, เก็บคำตอบ/fixtures, ล็อกดีไซน์, เขียน spec/plan และสร้างภาพครบ 40 ภาพจาก baseline เดิม ผล [layout/source checks](../evidence/line-system-oa-handoff-2026-10-05/source-backed-card-checks.json) PASS ทั้ง 40 กรณี: หัวสองบรรทัด, มาสคอต 112 px / ยื่น 16 px, `:` ตรง, ไม่มี overflow/clipped text/ภาพหาย/JS error/หัวชนรูป และภาพอยู่เหนือ paper รวม source reply parity กับ local confirm/cancel interactions

**ยังต้องทำ:** runtime builder/contract/metadata/projection, static assets ของเว็บ, wiring ของทุกเส้นทาง, focused implementation tests, native payload และการตรวจบน LINE จริง ยังไม่มี runtime changes จากงานนี้ ไม่มี product tests ของ implementation ใหม่ และไม่มี System OA deploy

คำสั่งที่รันเพื่อเก็บภาพรอบนี้:

```sh
python3 /Users/thawatchai/.codex/plugins/cache/openai-bundled/visualize/1.0.46/skills/visualize/scripts/render.py docs/evidence/line-system-oa-design-lock-2026-10-04/approved-preview.html docs/evidence/line-system-oa-handoff-2026-10-05/preview.html --force
/Users/thawatchai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node docs/evidence/line-system-oa-handoff-2026-10-05/capture-approved-cards.cjs
```

[Capture helper](../evidence/line-system-oa-handoff-2026-10-05/capture-approved-cards.cjs) ใช้ headless Chrome แยก ไม่ใช้ login session และปุ่ม preview ไม่เรียก backend งานนี้ไม่เปลี่ยน LINE Manager/API settings ไม่เรียก provider/database ไม่แก้ cloud และไม่ทำ financial mutation

หากเจ้าของสั่งเผยแพร่ภายหลัง ต้องอ่าน [cloud operations runbook](../runbooks/cloud-environment-operations.md) และ [mandatory UAT/Production protocol](../runbooks/uat-production-v2-deployment.md) ใหม่ก่อนทุก deploy/promotion/retry บันทึก run IDs และตรวจ signed result พร้อม customer OPEN ตาม protocol ห้ามนำคำอนุญาตเผยแพร่ marketing OA มาใช้แทน

**ขั้นถัดไป:** ผู้รับงานเริ่ม implementation ตาม checklist นี้ได้จากคำอนุญาต “ทำเลย” เดิม โดยยึดดีไซน์ที่ล็อกและรักษางานค้างของ checkout
