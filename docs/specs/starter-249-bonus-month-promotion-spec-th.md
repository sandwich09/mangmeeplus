# Spec Admin console สร้างแคมเปญโปรโมชั่น Starter 249

สถานะ: **SPEC REVISED — ปิดข้อกำหนด F01–F09 ตามมติ 9 ตุลาคม 2026; รุ่นแรกพัฒนาแล้วเมื่อ 9 ตุลาคม 2026 ตาม [แผน](../plans/starter-249-bonus-month-promotion-plan.md); ยังไม่มีแคมเปญที่เปิดใช้งาน**

วันที่จัดทำ: 5 ตุลาคม 2026; ปรับกติกา: 9 ตุลาคม 2026

เจ้าของกติกา: Thawatchai / Product Owner

เอกสารนี้กำหนดให้ผู้ดูแล **สร้างและจัดการแคมเปญโปรโมชั่นผ่าน Admin console** โดยแคมเปญแรกคือ `STARTER_249`: ซื้อรายเดือน 249 บาท ได้เวลา 2 เดือนและใบเสร็จรวม 60 ใบ; ซื้อรายปี ได้เวลา 13 เดือนและใบเสร็จรวม 390 ใบ รวม bug/gap/impact, dependency, จุดแก้ไข และเกณฑ์ทดสอบก่อนเริ่มแก้โค้ด ผู้ใช้ยืนยันว่าร้านใหม่และร้านเดิมใช้ได้ **ครั้งเดียวต่อร้านต่อแคมเปญ** และเดือนฟรีเพิ่มใบเสร็จ 30 ใบ

แนวทาง Admin console เป็นมติจากผู้ใช้แล้ว: เพิ่มเมนูแคมเปญในส่วน Billing ของ Admin ใช้ระบบ policy revision, quote, payment attempt, reconciliation และ audit เดิม ผู้ดูแลสร้างร่าง ตั้งเวลา เปิด พัก และจบแคมเปญได้โดยไม่ต้อง deploy ต่อแคมเปญหลังพัฒนาความสามารถนี้แล้ว ระบบส่วนลดกิจกรรมบน main ให้ส่วนลดเงินผ่านสิทธิ์ที่รับจาก LINE และยังไม่มีสิทธิ์แถมเดือน จึงใช้เป็นแบบอย่างการจองและใช้สิทธิ์ โดยคงความหมายของส่วนลดกิจกรรมเดิม

## 1 ขอบเขตและหลักฐาน

- งานนี้ปรับ spec, task memory และหลักฐานจำลองเท่านั้น ไม่มีการแก้ source, schema, `package.json`, configuration ที่ใช้งานจริง หรือเปิดโปรโมชั่น
- ตรวจ working tree ที่ HEAD `4a5817b4238379c2e3e3a24df996dd7168411eda` และพบว่าเก่ากว่า main จึงใช้ **local Git snapshot ของ `origin/main` ที่ `fddfd05baf97be683796f6b7db4d2e72157197db`** เป็นฐานวิเคราะห์หลัก เรียกฐานนี้ว่า **M** ในตาราง source
- ไม่ fetch remote และไม่ได้ตรวจสิ่งที่ deploy อยู่ จึงไม่อ้างว่า M เป็น Production หรือเป็น remote ล่าสุด ณ เวลาที่อ่านเอกสาร
- source ในตารางอ้าง path และบรรทัดที่ M; บางไฟล์ยังไม่มีใน working tree นี้ ตรวจซ้ำได้ด้วย `git show fddfd05baf97be683796f6b7db4d2e72157197db:<path>`
- มีการเปลี่ยนแปลงงานอื่นจำนวนมากอยู่แล้ว งานนี้ไม่แก้หรือย้ายไฟล์เหล่านั้น และไม่แก้เอกสารกติกาเดิมให้ดูเหมือนโปรโมชั่นอนุมัติครบแล้ว
- ไม่ได้อ่าน cloud, Stripe account, DB ลูกค้าจริง หรือดำเนินการ UAT/Production

เอกสารประกอบเดิม: [มติแพ็กเกจ](mangmee-billing-pack-amendment-2026-09-12.md), [Billing controls](mangmee-billing-controls-spec-th.md), [Sales deals และ locked signup](mangmee-sales-deals-and-locked-signup-spec-th.md), [เครดิต CHAT](ai-chat-credit-default-80-spec-th.md), [trial carryover](../plans/billing-trial-carryover-2026-09-17.md) รวมถึง `docs/specs/sales-event-discounts-spec-th.md` และ `docs/specs/chat-credit-and-receipt-addons-spec-th.md` ที่ M เอกสารสองรายการหลังมีพฤติกรรมใหม่กว่าบาง memory ใน working tree นี้

## 2 มติที่ยืนยันแล้ว

### มติจากผู้ใช้

| เรื่อง | กติกา |
| --- | --- |
| แพ็กเกจ | Starter รหัส `STARTER_249` |
| รายเดือน | ซื้อ 249 บาท 1 เดือน ฟรีเพิ่ม 1 เดือน รวม 2 เดือน |
| รายปี | ซื้อแพ็กเกจรายปี ฟรีเพิ่ม 1 เดือน รวม 13 เดือน ไม่ใช่ 24 เดือน |
| ผู้มีสิทธิ์ | ทั้งร้านใหม่และร้านเดิมที่ซื้อรายการเข้าเงื่อนไข |
| จำนวนครั้ง | ครั้งเดียวต่อร้านต่อแคมเปญ ใช้เดือนแล้วใช้ปีซ้ำในแคมเปญเดิมไม่ได้ |
| ใบเสร็จเดือนฟรี | เพิ่ม 30 ใบ รายเดือนรวม 60 ใบ รายปีรวม 390 ใบ |
| Admin console | **ยืนยันแล้ว:** ให้ Admin สร้างและจัดการแคมเปญโปรโมชั่นเป็นทางหลัก; รายละเอียดหน้าจอและ contract ด้านล่างเป็น design ของงานที่จะพัฒนา |
| การทำงานรอบนี้ | วิเคราะห์และทำ spec เท่านั้น |

ราคาปีใน catalog default ที่ M คือ **2,490 บาท** (`249 × 10`) สำหรับบริการปกติ 12 เดือนและใบเสร็จ 360 ใบ ราคาไม่ได้เป็น `249 × 12` และไม่ได้เป็น 249 บาทสำหรับทั้งปี อย่างไรก็ตาม `BillingPolicy.offerTerms` เปลี่ยนราคาตาม revision ได้; console ต้องแสดงราคาจาก policy ที่จะใช้จริงและปฏิเสธ copy “249” หากราคาไม่ตรง ไม่อ้างว่าได้ตรวจราคาขายสดแล้ว

| รอบ | ยอดตาม catalog default | ระยะปกติ | เดือนแถม | รวมเวลา | ใบเสร็จปกติ | รวมใบเสร็จตามมติ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| เดือน | 249 บาท | 1 เดือน | 1 เดือน | 2 เดือน | 30 ใบ | 60 ใบ |
| ปี | 2,490 บาท | 12 เดือน | 1 เดือน | 13 เดือน | 360 ใบ | 390 ใบ |

ตัวเลขเป็นค่าปกติของ source; VAT และยอดชำระสุดท้ายใช้ quote ตาม tax policy เดิม โปรโมชั่นนี้ไม่ได้อนุมัติการเปลี่ยนภาษีหรือราคาหลัก

### มติปิดกติกาวันที่ 9 ตุลาคม 2026

ผู้ใช้ยืนยันข้อเสนอต่อไปนี้ในรอบปรับ spec; ไม่ใช่การอนุมัติให้แก้โค้ดหรือรับชำระเงินจริง

| ID | เรื่อง | กติกา |
| --- | --- | --- |
| Q1 | โบนัสใบเสร็จ | เพิ่ม 30 ใบ ใช้ทันทีหลัง apply, หมดอายุที่ benefitEnd เดิม ไม่ยกยอดโบนัส; หักสิทธิ์แพ็กเกจที่หมดอายุก่อน และถ้าหมดพร้อมกันหัก PROMOTION ก่อน base รายละเอียด allocator ใน §5 |
| Q2 | CHAT ในเดือนฟรี | มีเครดิตตามรอบ Starter ปกติ เปิดเมื่อถึงรอบจริง ไม่แจก 2/13 รอบล่วงหน้า; admin free days ไม่ได้สิทธิ์นี้ |
| Q3 | เวลาและเพดาน | Admin กรอก start/end/cap; reservation commit เป็นจุดรับสิทธิ์ อายุ quote 10 นาที, เริ่มคำสั่งสร้าง Checkout ภายใน 10 นาทีจากการจอง, Checkout อายุ 30 นาทีจาก dispatch ตาม flow เดิม; recovery ไม่ปลดสิทธิ์จาก timeout (§6) |
| Q4 | การซ้อน | หนึ่งสิทธิ์ต่อรายการ: NORMAL / PROMOTION / EVENT_DISCOUNT; Sales deal ไม่ซ้อนโปร และสิทธิ์ที่ไม่เลือกไม่ถูกใช้ |
| Q5 | Upgrade | รุ่นแรกไม่ทำ immediate differential/full-package upgrade ที่ทับสิทธิ์โปร; เริ่มหลังช่วงโปรและสิทธิ์ที่จ่ายล่วงหน้าสิ้นสุด ไม่มีเครดิตเงินจากเดือนฟรี (§7) |
| Q6 | Refund/dispute | รับเงินจริงแล้วไม่คืน campaign usage; คืนเต็มยกเลิกสิทธิ์ที่ยังไม่ใช้จาก invoice นั้นและเก็บประวัติใช้แล้ว; คืนบางส่วนคงเวลา/โควตา; dispute ใช้ Billing hold/review เดิม (§7) |

Q1/Q2/Q4–Q6 เป็นมติจากคำตอบผู้ใช้ ส่วนอายุและ fence ของ Q3 เป็นข้อกำหนดออกแบบเพื่อปิด F03 โดย reuse quote 10 นาทีและ Checkout 30 นาทีที่ M มีอยู่ ค่า start/end/cap จริงเป็นข้อมูลขณะ Admin สร้างแคมเปญ ไม่ใช่ policy gap ที่ค้างอยู่

## 3 ประสบการณ์ผู้ซื้อและขอบเขตสิทธิ์

ผู้มีสิทธิ์ซื้อยังใช้ permission จัดการแพ็กเกจของบริษัทตามระบบเดิม ไม่ผูกโปรโมชั่นกับ user หรือ LINE identity: ผู้ซื้อสองคนของร้านเดียวกันต้องเห็นว่าใช้สิทธิ์ร่วมกัน และเปลี่ยน OWNER/บัญชีเข้าใช้ก็ไม่รับซ้ำ

1. เปิดหน้าแพ็กเกจจาก Web หรือ LINE แล้วอ่าน catalog พร้อมสิทธิ์โปรโมชั่นของบริษัทที่เลือก
2. การ์ด Starter แสดง “249 บาท ได้ 2 เดือน” หรือ “2,490 บาท ได้ 13 เดือน” พร้อมเงื่อนไขครั้งเดียวต่อร้าน และโควตาที่อนุมัติจริง การ์ดแพ็กเกจอื่นไม่รับสิทธิ์จากชื่อหรือราคาใกล้เคียง
3. แสดงยอดจ่ายวันนี้ ช่วงเวลาที่ซื้อ ช่วงเวลาฟรี วันหมดอายุใหม่ จำนวนใบเสร็จ และวัน/ยอดรอบถัดไปใน quote เดียวกัน ผู้ซื้อที่มีเวลาเดิมเหลือเห็นว่าต่อจากวันใด
4. ผู้ซื้อเลือก NORMAL/PROMOTION/EVENT_DISCOUNT ชัดเจนแล้ว review quote; จองสิทธิ์พร้อม `BillingAttempt` ภายใต้ลำดับ lock ใน §6 จากนั้นไป Checkout
5. รอ verified payment และ apply; หน้า return ไม่ถือว่าพารามิเตอร์ success แปลว่าชำระ/เพิ่มสิทธิ์แล้ว
6. หลัง apply แสดงสิทธิ์โปรโมชั่นที่ใช้ รายการชำระที่อ้างอิง เวลาแถม และรอบถัดไปในหน้าแพ็กเกจ/ประวัติเดียวกัน

| แหล่งสิทธิ์เดิมของร้าน | พฤติกรรมเป้าหมาย |
| --- | --- |
| ร้านใหม่ที่ยังล็อก / ไม่มี paid term | เริ่มจากเวลาชำระที่ตรวจสอบแล้ว; การสมัครเฉย ๆ ไม่รับเดือนฟรี |
| Legacy trial ที่ยังใช้อยู่หรือหมดแล้ว | ซื้อผ่าน INITIAL ตาม eligibility เดิม วัน trial ที่เหลือไม่ถูกนับเป็นเดือนโปรโมชั่น; receipt carryover แยกตามกติกาเดิม |
| Starter จ่ายครั้งเดียวและยังไม่หมด | ซื้อเต็มแพ็กเกจแล้วต่อจากวันหมดสิทธิ์เดิม เพิ่มหนึ่งรอบซื้อและหนึ่งเดือนฟรีได้ครั้งเดียว |
| Paid package หมดอายุ | RESTART เมื่อ source/หนี้/ผู้ให้บริการผ่านการตรวจ เริ่มจาก paidAt ไม่ฟื้น quota ที่หมดอายุ |
| Starter มี auto renewal อยู่ | ต้องรองรับการซื้อเต็มแพ็กเกจที่ผ่าน repeat path และเลื่อนการเรียกเก็บจริงถึงปลายสิทธิ์ใหม่; ไม่ให้โบนัสเพียงเพราะเปิดแคมเปญ |
| ร้านเดิมถือ Basic/Pro/Enterprise | ต้องซื้อ Starter ผ่านกติกาเปลี่ยน tier/capacity เดิมก่อน ไม่แจกย้อนหลังหรือเปลี่ยน tier ทันทีโดยไม่ตรวจ; quote ของ scheduled change ต้องแสดงวันเริ่ม Starter จริง |
| มี pending Checkout, change, refund, debt review หรือ manual/security hold | ใช้เหตุผลและ recovery action เดิม ไม่ปลด hold เพื่อให้ซื้อโปรได้ |

### เมื่อโปรใช้ไม่ได้และการเปลี่ยนตัวเลือก

Eligibility ของ promotion แยกจาก permission/gate ของการซื้อแพ็กเกจ หากใช้สิทธิ์แล้ว, cap เต็ม, จบ/พักแคมเปญ หรือ catalog stale ให้แสดงเหตุผลพร้อม “ซื้อแพ็กเกจปกติ” เมื่อ purchase guards เดิมอนุญาต ไม่ปิดปุ่มซื้อทั้งหมดเพราะหมดสิทธิ์โปร NORMAL ยังคง 1/12 เดือนและ 30/360 ใบ

Quote/attempt เก็บ `benefitChoice` พร้อม campaign หรือ event ticket ที่เลือกเพียงอย่างเดียว; NORMAL ไม่ reserve ทั้งสองอย่าง หากโปรใช้ไม่ได้ระหว่างกดจ่าย ให้คืน `PROMOTION_UNAVAILABLE` พร้อมทางสร้าง quote ใหม่ ผู้ซื้อต้องเห็นและยืนยันเวลา/โควตา/ราคาใหม่ก่อน provider I/O ห้าม fallback เป็นซื้อปกติอัตโนมัติจากจอที่โฆษณา 2/13 เดือน

การเปลี่ยนตัวเลือกหลังมี RESERVED ต้องยุติและพิสูจน์ original attempt เป็น terminal unpaid ก่อน release แล้วสร้าง quote ใหม่; UNKNOWN ให้เปิดสถานะรายการเดิม ไม่สร้าง Checkout คู่ขนาน Event ticket ไม่ถูกกินเมื่อเลือก PROMOTION และ campaign usage ไม่ถูกกินเมื่อเลือก EVENT_DISCOUNT/DEAL; deal ใช้เส้นทางเดิมและไม่มี promotion snapshot

การต่ออายุอัตโนมัติรอบถัดไปกลับเป็นเดือน/ปีปกติ ไม่มีเดือนฟรีเพิ่มโดยอัตโนมัติ การเปิดแคมเปญไม่แก้ invoice ที่สร้างไปแล้วและไม่มอบสิทธิ์ย้อนหลัง หากต้องการให้บิล auto renewal ใช้โปรเอง ต้องเพิ่มนโยบายเรื่อง consent และ invoice reservation แยกต่างหาก; draft นี้เสนอรับสิทธิ์ตอนผู้ซื้อยืนยันซื้อเต็มแพ็กเกจ

## 4 Admin console สร้างและจัดการแคมเปญ

เพิ่มเมนู **“แคมเปญโปรโมชั่น”** ใน Admin ส่วน Billing ใช้ layout, fields, loading/error states และ workflow ของ Billing เดิม มีหน้ารายการและรายละเอียดแคมเปญโดยตรง การตั้งค่าทั่วไปใน `/system/billing/settings` ยังคงแยกจากการทำงานรายแคมเปญ

### หน้าจอและการสร้างแคมเปญ

เส้นทางต่อไปนี้เป็น route เป้าหมายที่ยังต้องพัฒนา:

| หน้าจอ | เส้นทาง | สิ่งที่ Admin ทำได้ |
| --- | --- | --- |
| รายการแคมเปญ | `/system/billing/campaigns` | ค้นชื่อ กรองสถานะ/แพ็กเกจ ดูช่วงเวลาและจำนวนใช้สิทธิ์ กด “สร้างแคมเปญ”; แยก TEST/LIVE ชัด |
| สร้างแคมเปญ | `/system/billing/campaigns/new` | เลือกแบบตั้งต้น “ซื้อแพ็กเกจแถมเดือน” กรอกข้อมูลและบันทึกร่าง ไม่เปิดรับสิทธิ์ทันที |
| รายละเอียดแคมเปญ | `/system/billing/campaigns/[campaignId]` | ดูเงื่อนไขที่มีผล ร่างที่กำลังแก้ preview รายงานการใช้สิทธิ์ และประวัติ; แก้ร่าง เปิด พัก กลับมาเปิด หรือจบตามสถานะ |

เส้นทางหลัก: Admin กดสร้าง → ใช้แบบตั้งต้น Starter 249 → ตั้งชื่อ/วันเวลา/เพดาน → บันทึกร่าง → ตรวจตัวอย่างรายเดือนและรายปี → ยืนยันเปิดผ่าน workflow เดิม → ระบบแสดงตามเวลาและสิทธิ์จริงบนหน้าแพ็กเกจลูกค้า ผู้ดูแลไม่ต้องกรอก JSON หรือแก้ค่า environment

แคมเปญแรกใช้กติกาที่ Owner ยืนยันแล้วเป็นแบบตั้งต้น: Starter ทั้งเดือนและปี แถม 1 เดือนและ 30 ใบ ร้านใหม่/เดิมหนึ่งครั้งต่อร้าน กติกาเหล่านี้เป็นข้อมูลใน campaign snapshot ที่ backend ตรวจ ไม่ผูกการให้สิทธิ์กับชื่อแคมเปญหรือเงื่อนไข `ราคาเท่ากับ 249` ในโค้ด รุ่นนี้รองรับ campaign type “ซื้อแพ็กเกจแถมเดือน”; โปรชนิดอื่นและการเปิดแพ็กเกจอื่นต้องมี rule/readiness ที่รองรับก่อนจึงให้เลือกในฟอร์ม

### ข้อมูลในแบบฟอร์ม

| ข้อมูล | การใช้งานและ validation |
| --- | --- |
| รหัสแคมเปญ | ID คงที่จาก server; เปลี่ยนชื่อหรือ revision ไม่เปลี่ยนสิทธิ์ครั้งเดียว |
| ชื่อภายในและคำอธิบาย | ใช้ค้นหา/จัดการใน Admin แยกจากข้อความที่ลูกค้าเห็น |
| ชื่อที่ลูกค้าเห็น | plain text มีความยาวจำกัด ไม่รับ HTML; copy ราคา/เดือนคำนวณจากกติกา |
| ประเภทแคมเปญ | “ซื้อแพ็กเกจแถมเดือน” ในรุ่นนี้; ไม่มีช่องสูตรหรือ script อิสระ |
| แพ็กเกจและรอบ | เลือกจาก catalog ที่ระบบรองรับ; แบบตั้งต้นครั้งนี้เลือก Starter เดือนและปี มีแถว preview แยก ไม่เอาปีไปคูณโบนัส 12 |
| ผลประโยชน์ | แบบตั้งต้น `bonusMonths = 1`, bonus receipts 30 ใบตาม Q1; บันทึกแยกตาม rule เดือน/ปี นโยบาย CHAT ตามมติ Q2; ไม่เปิดให้เปลี่ยนเป็นกติกาที่ยังไม่มีมติหรือ implementation รองรับ |
| ผู้มีสิทธิ์ | ร้านใหม่และร้านเดิม; หนึ่งครั้งต่อบริษัทต่อ campaign คงที่สำหรับรุ่นนี้ |
| เริ่มและสิ้นสุด | กรอกเวลาไทย แสดง Asia/Bangkok; เก็บ UTC; `start <= now < end` เมื่อรับจอง |
| โควตาแคมเปญ | มีเพดานหรือ “ไม่จำกัด” แบบเลือกชัด หากมีเพดานนับ reserved + consumed ภายใต้ lock |
| การซ้อนสิทธิ์ | แสดงกติกาตาม Q4 ไม่ให้ผู้จัดการเปลี่ยนโดยไม่มี policy validation |
| เหตุผลและ revision | ใช้ expectedVersion, previewHash, reason และ audit เดิม |
| Preview | แสดงร้านใหม่/ร้านเดิม, เดือน/ปี, 4 โหมดชำระ, paid/free dates, quota, รอบถัดไป และ blocker ที่พบ |

ฟอร์มแสดงราคาและโควตาต้นทางแบบอ่านอย่างเดียวจาก Billing catalog; แก้แคมเปญไม่เปลี่ยนราคาฐาน ปุ่ม “บันทึกร่าง” ยอมให้ข้อมูลยังไม่ครบและแสดงสิ่งที่ขาด ปุ่ม “ตรวจสอบก่อนเปิด” ต้องผ่าน validation ทุกข้อก่อนยืนยันเปิด ต้องมี capability/readiness ของ Q1–Q6 ครบใน reader/worker/provider ของโหมดที่เปิด จึงเผยแพร่ได้; ยังเก็บร่างไว้ได้เมื่อระบบไม่พร้อม

### Catalog ที่แคมเปญยอมรับ

Campaign revision pin `catalogRevisionId` และ `offerSignature` ต่อ interval ประกอบด้วย tier, cadence, currency, base price, tax treatment, base receipt units และ contract version ที่มีผลต่อ quote; ไม่รวมชื่อ/ข้อความตกแต่ง ต้องตรวจที่ preview, publication และ reservation commit โดยเทียบกับ offer ปัจจุบัน การเปลี่ยน policy ส่วนที่ไม่กระทบ signature ไม่ทำให้ทุก campaign stale

แบบตั้งต้นนี้บังคับ base 30/360 + bonus 30 = 60/390 และราคาเดือน 249 บาทก่อนภาษีตาม tax policy เดิม ราคาปีอ่านจาก policy ที่ preview (default 2,490 บาท) หาก base quota เปลี่ยนเป็น 50/600 ห้ามเปิดแคมเปญแบบตั้งต้นนี้ด้วย 80/630 หรือปรับ bonus ให้ติดลบเพื่อให้ครบมติเดิม

เมื่อ signature เปลี่ยน campaign แสดง `CATALOG_STALE` และหยุดรับจองใหม่โดยไม่ปิด NORMAL; Admin ต้องโหลด policy ล่าสุด ตรวจ preview และ publish revision ที่ยังผ่านข้อกำหนด 60/390 หากต้องการเปลี่ยนคำสัญญาเป็นจำนวนอื่นต้องเป็นการเปลี่ยน product rule ก่อน ไม่ทำผ่านแค่แก้ copy การเปิด gate/publish catalog กับการ reserve ใช้ fence เดียวกัน (§6)

Quote เก่ายังไม่ reserve ให้ review ใหม่ ส่วน RESERVED/CONSUMED ใช้ราคา โควตา tax และ service rules จาก accepted snapshot ต่อไป การกู้คืนห้าม resolve benefit จาก live catalog ค่า catalog ที่ออก public ใช้ generation เดียวกับ campaign signature; cache มีอายุไม่เกิน boundary ถัดไปและ invalidation เมื่อ publish/pause/end/stale แต่ reservation API เป็นตัวตรวจสุดท้ายเสมอ

### สิทธิ์และสถานะ

ใช้สิทธิ์ `system.billing.read` สำหรับดู และ `system.billing.policy.manage` สำหรับจัดการ ใช้ reauthentication/approval mode ที่ระบบมีอยู่ ไม่เพิ่มผู้อนุมัติชั้นใหม่โดยไม่มีเหตุผล การเปิด sales/payment gate ยังคงต้องมีสิทธิ์ gate แยกตามเดิม Sales ทั่วไปไม่ควรเปลี่ยนโปรระดับระบบได้เพราะแก้แบบฟอร์มหน้าจอได้

| สถานะที่ Admin เห็น | การทำงาน |
| --- | --- |
| ร่าง | แก้/บันทึก/ตรวจสอบ/ยกเลิกร่าง ไม่มีผลต่อ quote หรือ catalog |
| รออนุมัติ | แสดงตาม approval mode เดิม; ใช้ preview/version ที่ตรงกัน ห้ามแก้ข้อมูลขณะรอแล้วอนุมัติ snapshot เก่า |
| ตั้งเวลาแล้ว | เผยแพร่แล้วและยังไม่ถึง start; พักหรือจบได้โดยบันทึกเหตุผล; ระบบเริ่มรับสิทธิ์ตามเวลาจริงโดยไม่ deploy |
| กำลังใช้งาน | รับการจองที่เข้าเงื่อนไข; แก้เป็นร่าง revision ใหม่ พัก หรือจบได้ |
| พัก | ไม่รับจองใหม่; กลับมาเปิดได้ภายในช่วงเวลาเดิมและ readiness ผ่าน; การเปิดกลับไม่ล้างจำนวนใช้สิทธิ์ |
| จบแล้ว | ถึง end หรือ Admin กดจบ; เก็บอ่านประวัติ ไม่กลับมาเปิดด้วย campaign ID เดิม การจัดรอบใหม่ต้องสร้างแคมเปญใหม่และเปิดอย่างชัดเจน |

วงจร publication ใช้ DRAFT → PREVIEW → workflow อนุมัติเดิม → published revision แยกจากสถานะ campaign ที่แสดงตามเวลา/pause/end การ “จบแคมเปญ” ต้องระบุ `endedAt` และไม่ใช่การลบ campaign การยกเลิกร่างที่ไม่เคย publish ใช้ CANCELLED ของ operation เดิมได้

การพักหรือจบมีผลปิดรับจองใหม่ทันทีหลัง command สำเร็จ ไม่รอ worker มาเปลี่ยน label; API ตรวจเวลาและ revision ทุกครั้ง รายการที่ commit RESERVED ก่อนคำสั่งปิดสำเร็จได้รับการรับสิทธิ์แล้ว แม้ provider ยังไม่ตอบหรือยังไม่สร้าง session; ให้สร้าง/กู้คืนตาม deadline และ snapshot ใน §6 เห็น “มีรายการชำระค้าง N รายการที่จะยังได้รับสิทธิ์ตามเดิม” ใน preview ก่อนพัก/จบ ไม่หยุดการ apply ของเงินที่รับแล้ว

บันทึก config ใหม่กระทบเฉพาะการจองหลังมีผล ไม่แก้รายการชำระเก่า ให้ publication validation ปฏิเสธ rule ซ้อนบน Starter interval เดียวกันในช่วงเดียวกันสำหรับรุ่นแรก เพื่อไม่ต้องสร้างระบบ priority ของหลายโปร

การแก้ campaign ที่มีผลแล้วแสดง published revision ควบคู่ draft; ก่อน publish ต้องอ่าน policy ล่าสุดและแก้เฉพาะ campaignId ที่เลือกภายใต้ expectedVersion ห้ามเขียนทับราคาหรือ campaign อื่นจากหน้าเก่าที่เปิดค้าง ลดเพดานต่ำกว่า reserved + consumed ไม่ได้ โดยอ่านจำนวนใหม่ใน final transaction ภายใต้ shared fence ใน §6 ไม่ใช้ count จาก preview วันสิ้นสุดต้องอยู่หลังวันเริ่ม และคำสั่งที่ response หายต้องค้น operation เดิมก่อนส่งซ้ำ

### รายงานและสถานะผิดพลาด

รายงาน console ต้องแยกจำนวนจอง, จ่ายแล้วรอ apply, สำเร็จ, ยกเลิกก่อนจ่าย, คืนเงิน, จำนวนเดือน/ใบเสร็จแถม และเงินที่รับจริง ห้ามนับเดือนฟรีเป็นยอดขายหรือเพิ่ม SalesAttribution แบบ first activation ซ้ำ

รายชื่อร้านที่ใช้สิทธิ์ต้องกดเข้าประวัติ invoice/attempt เดิมได้ตาม permission และ company scope แยกตัวเลข “จำนวนสิทธิ์ที่ใช้แล้ว” ออกจาก “สิทธิ์ที่ยังใช้งานอยู่”; refund ไม่ทำให้ตัวแรกหายตามนโยบาย Q6 ผู้ไม่มี financial/document permission ไม่ได้เห็นยอดละเอียดหรือเอกสารจากการเปิดหน้าแคมเปญ

โหลดข้อมูลไม่สำเร็จต้องมี retry และรักษาร่างที่พิมพ์ไว้; stale version ให้โหลดข้อมูลล่าสุดแล้ว review ใหม่; สิทธิ์หายต้องหยุด mutation แม้ปุ่มยังแสดง; cap เต็ม/ยังไม่เริ่ม/หมดเวลา/เก็บเงินโหมดนั้นไม่ได้แสดงเหตุผลแยก การบันทึกร่างไม่ถือว่าสร้างโปรโมชั่นที่ลูกค้าใช้ได้แล้ว

### ส่วนที่ใช้ซ้ำจากระบบเดิม

| ของเดิม | ใช้ซ้ำได้ | สิ่งที่ยังไม่ครอบคลุม |
| --- | --- | --- |
| Billing configuration | draft, revision, preview, approval, permission, audit, gate | ยังไม่มี promotion terms และ reservation ต่อบริษัท |
| Sales event console | form/theme, เวลา, scope, report pattern, การ reserve/use/release | ผูก agent/LINE ticket และส่วนลดเงิน; validator ต้อง discount มากกว่า 0; ไม่มีเดือนแถม |
| Sales deal | quote snapshot, ซื้อ N เดือน, one-time payment, delayed renewal binding | ดีลรายร้านเปลี่ยนราคา/สิทธิ์และ attribution; ไม่ใช่โปร catalog ครั้งเดียวต่อแคมเปญ |
| Grant free days | provider schedule journal, เลื่อน renewal, cancellation preservation | รับจำนวนวันจริงและ active subscription; ไม่เพิ่ม receipt หรือ AI allowance |

มติให้ใช้ Admin console สำหรับสร้างแคมเปญชัดเจนแล้ว ต่อยอดระบบ Billing หลังหน้าจอแคมเปญ โดยไม่เพิ่มขั้นตอนให้ Sales แจก LINE ticket หรือให้ Admin ต่ออายุร้านทีละร้านเพื่อใช้งานโปรโมชั่นนี้

## 5 เวลา โควตา และมูลค่าที่ต้องแยก

### การนับเดือน

ให้ `S` เป็นต้นช่วงที่ซื้อ: paidAt สำหรับ INITIAL/RESTART หรือ paidThrough เดิมสำหรับการซื้อเพิ่มที่ผ่าน source validation ส่วน scheduled change ใช้ effective boundary ที่ยืนยันไว้

- `paidMonths = 1` สำหรับเดือน และ `12` สำหรับปี
- `paidEnd = appendMonths(S, paidMonths, originalAnchorDay)`
- `benefitEnd = appendMonths(S, paidMonths + 1, originalAnchorDay)`
- ช่วงที่จ่ายคือ `[S, paidEnd)`; เดือนแถมคือ `[paidEnd, benefitEnd)`
- ใช้ helper `appendPackageInterval` เดิมที่นับเดือนครั้งเดียวและ clamp วันสิ้นเดือน ไม่ใช้ 30 วัน/365 วัน และไม่บวก 1 เดือนซ้ำจนเสีย anniversary
- คง convention UTC anchor ของ billing เดิมและแสดงผลเวลาไทย ไม่เปลี่ยนทั้งระบบเป็น local calendar ระหว่างทำโปรโมชั่น; ทดสอบช่วง 00:00–06:59 เวลาไทยด้วย

ตัวอย่างชำระ 5 ต.ค. 2026 เวลา 10:00 ไทย: รายเดือนสิ้นช่วงที่จ่าย 5 พ.ย. และสิ้นโปรโมชั่น 5 ธ.ค. 2026; รายปีสิ้นช่วงที่จ่าย 5 ต.ค. และสิ้นโปรโมชั่น 5 พ.ย. 2027 ซื้อ 31 ม.ค. 2026 เวลา 10:00 แบบเดือน ให้ paidEnd 28 ก.พ. และ benefitEnd 31 มี.ค. ไม่ใช่ 28 มี.ค.

ห้ามใช้ `interval='year', intervalCount=2` เพื่อแถมเดือน เพราะจะเป็น 24 เดือน และห้ามเปลี่ยน offer รายปีเป็น recurring ทุก 13 เดือน: รอบถัดไปยังเป็นปีปกติหลังสิ้นสิทธิ์โปรโมชั่น

### ใบเสร็จ

คง base offer 30/360 และเพิ่ม bonus 30 ใบเป็น grant `PROMOTION` มี provenance จาก redemption/invoice เดียวกับการชำระ รวม 60/390 ใบ **เปิดใช้ทันทีเมื่อ apply** แม้ซื้อไว้ล่วงหน้า และหมดอายุที่ benefitEnd ของรายการนั้น ไม่ refill เมื่อเข้าเดือนฟรี

Base grant มี `serviceEnd = paidEnd`, `expiresAt = benefitEnd` และ carry ได้เฉพาะ valid paid units ตาม repeat policy เดิม Bonus grant มี `serviceStart = paidEnd`, `serviceEnd = benefitEnd`, `availableAt = appliedAt`, `expiresAt = benefitEnd` แบบ fixed; repeat/grace/admin free days ไม่เลื่อนอายุโบนัส Trial carryover, admin gifts และ add-on คง source/expiry ของตัวเอง

ลำดับการหักในกลุ่มสิทธิ์แพ็กเกจรวม PROMOTION: eligible และ available เท่านั้น → expiresAt เร็วสุด → ถ้าหมดอายุเท่ากัน PROMOTION ก่อน base → createdAt/id สำหรับกรณีที่ไม่มีผลต่างทางนโยบาย คงลำดับกลุ่มเดิม package → team gift → purchased add-on และเงื่อนไข one-page image ของ add-on; มติโบนัสไม่เปลี่ยนกติกาสินค้า add-on เดิม PROMOTION ต้องเป็น package kind ไม่ใช่ ADD_ON และ Web/LINE/OCR ต้องเรียก allocator เดียวกัน

ตัวอย่าง base 30 + bonus 30, ใช้ 20 ตอน expiry เท่ากัน: หักโบนัส เหลือ base 30 + bonus 10 เมื่อซื้อปกติอีก 30 ก่อนหมด จะ carry base เดิมตาม policy แต่ bonus 10 ยังหมดวันเดิม หลังวันนั้นเหลือ base รวม 60 ใบ ไม่ใช่ 40 และไม่ใช่ 70

OCR RESERVE ผูก grant allocation เดิม; CONSUME/RELEASE/replay ไม่เลือก lot ใหม่และไม่หักซ้ำ ตอน expiry ปิดรับใหม่ แต่ reserved work ที่เริ่มถูกต้องจบตาม admission เดิมได้; release หลังหมดอายุไม่ทำให้ยอดกลับมาใช้ได้ Refund full ต้อง fence/settle pending admissions ตาม §7 ก่อนสรุป revocation เพื่อไม่ทำยอดติดลบ Register kind/aggregation/unknown-kind compatibility ก่อนเปิด campaign

### เครดิต AI และเงิน

M มี AI credit cycle ที่อ้าง APPLIED PACKAGE invoice และ ledger ต่อ cycle แล้ว ไม่ควรออกแบบจาก memory รุ่นที่ใช้ calendar-month cap อย่างเดียว `ai-credit-cycles.ts` ระบุชัดว่า admin gift days ยืดรอบเดิมและไม่เพิ่ม allowance

Q2 ยืนยันให้เดือนฟรีมีรอบเครดิต Starter ปกติ Reader ต้องอ่าน APPLIED paid periods **พร้อม promotion service segments** ที่ไม่ revoked แล้วหา segment ครอบ `at` ก่อนใช้ legacy gift fallback: ช่วง paid และ free ไม่ทับกัน ไม่ merge เดือนฟรีเข้า paid invoice และไม่ข้าม free gap เพียงเพราะมี future paid invoice

Paid segment แบ่งรอบเดือนจาก original anchor เดิม; promo segment `[paidEnd, benefitEnd)` เปิดหนึ่งรอบที่ paidEnd มี `fundingSource=PROMOTION`, redemptionId และ sourcePaidInvoiceId ที่รับเงินจริง ค่า default CHAT 80 เป็นสิทธิ์ Starter ตาม policy/override ของรอบนั้น ไม่แจก 2/13 รอบล่วงหน้า Cycle key ใช้ account/cycleStart เดิมและ provenance ต่อ source + cycleStart ไม่ใช่ unique source invoice เพียงอย่างเดียว; provider-account migration ต้อง map logical cycle เดิมก่อน funding ไม่ให้สร้าง lot ซ้ำจากการเปลี่ยนบัญชี การ lazy fund/replay/ซื้อซ้ำก่อนหมดและ upgrade ไม่เติมรอบปัจจุบัน

ทั้ง free tail และ free gap ต้องคืน cycle เริ่ม paidEnd เดียวกัน แม้ paidEnd ถูก clamp (Jan 31 → Feb 28 → Mar 31); ห้ามบวกเดือนจากวันที่ถูก clamp จนเปลี่ยน benefitEnd Admin gift ที่ไม่มี promo segment ยังยืด cycle เดิมโดยไม่เติม ส่วน overrides, legacy cutover, permission, cost/budget holds และ service hold ยังบังคับเดิม

หากพบช่วงทับกัน/provenance ไม่ครบให้ `ENTITLEMENT_REVIEW` และหยุด funding ใหม่แทนเลือก invoice จากลำดับแถว คืนเต็มยุติ future funding ของ source นั้นและ revoke ส่วนที่ยังไม่ใช้; ไม่ลบหรือชดเชยเครดิตที่ใช้ไปแล้วอัตโนมัติ

แยก paid service end, free service end และเงินที่เก็บ ห้ามสร้าง invoice ปลอมมูลค่า 249 สำหรับเดือนฟรี หรือยืด financial paid period เพื่อให้ upgrade คิดว่าซื้อช่วงฟรีด้วย คง provider evidence ตามจริง; subscription trial/zero invoice ภายในไม่ใช่การจ่ายเงินจริงและไม่ให้ quota ซ้ำ

ในเชิงราคาเท่านั้น โปรเดือนเฉลี่ย `249 / 2 = 124.50` บาทต่อเดือนบริการ และโปรปี `2490 / 13 ≈ 191.54` บาทต่อเดือนบริการ เป็นตัวเลขก่อนต้นทุนและผลของ tax policy ไม่ใช่กำไร การวัดผลต้องรวมบริการเพิ่ม 1 เดือน, เครดิต/ใบเสร็จตาม Q1/Q2, payment fees ที่เกิดจริง และ renewal ที่เลื่อนออกไป ไม่ใช้ค่า fee หรือ usage ที่ไม่ได้ตรวจสดมารับรองความคุ้มค่า

## 6 Contract และขอบธุรกรรม

ต่อยอดโครงสร้างเดิมแบบ additive; ความหมายด้านล่างเป็นข้อกำหนดของ spec ส่วนชื่อ DTO/model จริงเลือกตาม pattern เดิมใน implementation plan

| ข้อมูล | ขอบเขตที่ต้องมี |
| --- | --- |
| Campaign draft ใน BillingOperation | stable campaignId, campaign type, internalName, ข้อมูลร่างที่อาจยังไม่ครบ, actor, expectedVersion และ reason; reuse draft persistence เดิมแต่แยก incomplete draft จาก validated publication payload |
| Promotion terms ใน BillingPolicyRevision | stable campaignId, internalName, displayName, campaign type, revision, tier/interval rules, start/end, paused, endedAt, bonusMonths, receipt/CHAT policy, cap และ stacking rule; ใช้ publication เดิม |
| `BillingPromotionRedemption` ใหม่ | companyId, stable campaignId, promotionEnvironmentId, provider bindings (stripeAccountId/livemode), pinned revision/hash/offerSignature, attemptId/generation, invoiceId, state, acceptedAt, createBy, consumedAt, benefitAppliedAt, version, paidStart/paidEnd/bonusEnd |
| DB constraints | unique `(promotionEnvironmentId, campaignId, companyId)`; provider account ไม่อยู่ในสิทธิ์ครั้งเดียว; attempt generation/source invoice ผูก exact redemption; reactivate RELEASED ต้อง version fence และเก็บ attempt เก่า |
| Quote และ BillingSnapshot | benefitChoice, promotion ID/revision/hash/offerSignature, eligibility result/reason, pinned base+bonus/CHAT policy, estimated dates, ราคาปกติ/ยอดวันนี้/renewal terms; snapshot บันทึกคำยินยอม |
| Checkout request | อ้าง quote และ choice เท่านั้น ห้าม client ส่งเดือนแถม จำนวนใบเสร็จ หรือราคาแล้วเชื่อทันที |
| BillingInvoice/contract | คงเงินและ provider evidence เดิม; snapshot อ้าง accepted promotion และ paid/free boundaries; renewal snapshot ต้องกลับเป็น offer ปกติ |
| Status/attempt/history | promotion state แยก paymentState/applyState/renewalSetupState/entitlementAdjustmentState; benefitEnd, expectedNextChargeAt, verified nextChargeAt (nullable), recovery reference และ blocked reason |
| Public catalog | แสดงข้อมูลโปรที่ประกาศได้เท่านั้น ไม่เผย redemption/บริษัท; eligibility จริงมาจาก company-scoped API |
| Admin campaign reads | list/detail แยก draft/published revision พร้อม status, allowedActions, validationErrors, aggregate usage และ operation reference; ไม่ส่ง company/financial detail เกินสิทธิ์ |
| Admin campaign commands | create/save draft, preview, submit/approve ตาม mode เดิม, pause/resume/end; ทุก mutation ผูก campaignId, environment, expectedVersion และ idempotency key; publish อ้าง previewHash และแสดงผลจาก server |

หน้ารายการแคมเปญไม่จำเป็นต้องมี campaign table และ publication workflow อีกชุด เริ่มจาก draft operations + campaign entries ใน policy revision เดิม + redemption ledger ที่จำเป็นต่อ uniqueness; list/detail รวมข้อมูลเฉพาะ mode และ latest draft ของ campaign นั้น หากโครงสร้าง draft เดิม validate เต็มตั้งแต่ save ต้องปรับให้บันทึก campaign draft ที่ยังไม่ครบได้ โดย publish ยังคง strict หากภายหลังต้องค้นแคมเปญจำนวนมากจึงพิจารณาแยก storage โดยไม่เปลี่ยน campaign identity

Quote/attempt เก่าที่ไม่มี promotion ต้องทำงานเหมือนเดิม ห้าม infer โปรจากวันที่ชำระหรือราคาปัจจุบันย้อนหลัง การเปลี่ยนชื่อ/ข้อความ/ช่วงเวลาของ revision ไม่ล้าง “ใช้แล้ว” และการสร้าง revision ใหม่ของ campaign เดิมไม่ใช่ campaign ใหม่

### State และการกู้คืน

1. **QUOTE**: คำนวณสิทธิ์ ไม่กินสิทธิ์และไม่หัก cap
2. **RESERVED**: commit จองพร้อม durable attempt คือ acceptance cutoff ก่อน provider I/O; ผูก company + campaign + logical environment + exact snapshot และ attempt generation
3. **CONSUMED**: เมื่อ exact paid evidence ยืนยันแล้ว แม้ apply จะ HELD ก็ใช้สิทธิ์แล้ว; benefitAppliedAt ยังว่างจน apply สำเร็จ
4. **APPLY**: transaction เดิมเขียน paid term, promotion segment, receipt grants, audit/outbox และ benefitAppliedAt แบบ idempotent ส่วน provider command ใช้ journal/recovery เดิมก่อนหรือหลังตาม purchase mode
5. **RELEASED**: เมื่อพิสูจน์ว่า original attempt ไม่จ่ายและไม่มี ambiguous payment/collectible invoice จึงคืนสิทธิ์จอง ไม่ใช้ browser back, webhook ช้า หรือเวลา reservation หมดเพียงอย่างเดียว
6. Refund/dispute หลัง CONSUMED แยกจาก promotion eligibility; ทำตาม Q6 และระบบ financial review เดิม ไม่ revoke ของที่ใช้แล้วด้วยการลบ ledger

### Identity ที่ไม่เปลี่ยนตามผู้รับเงิน

`promotionEnvironmentId` เป็น namespace ถาวรของระบบและ TEST/LIVE ไม่ใช่ deploy ID หรือ Stripe account ID ทั้ง environment และ stable campaign ID เปลี่ยนไม่ได้หลัง publication การย้าย provider/merchant account, owner/user, ช่องทาง, interval หรือ campaign revision ไม่ให้รับซ้ำ อ่าน usage รวมทุก provider binding ใน namespace เดียวกัน

Migration ต้อง preserve redemption identity และ retained paid history; ถ้าพบ duplicate consumed ให้ปิด admission ของ scope ที่มีปัญหาและเปิด review ไม่ลบเงิน/ประวัติเพื่อให้ unique ผ่าน TEST กับ LIVE แยกด้วย namespace จริง ผู้ซื้อส่ง environment/provider มา reset eligibility ไม่ได้ ไม่มีคำสั่ง reset consumed ในรุ่นแรก

### จุดรับสิทธิ์ อายุรายการ และ recovery

- Quote อายุไม่เกิน 10 นาทีและไม่เกิน source-valid boundary เดิม ไม่กิน cap; reserve ตรวจ fresh signature/version/gates/permission/source และ `start <= DB now < end` อีกครั้ง
- เมื่อ transaction RESERVED สำเร็จ บันทึก `acceptedAt`, `createBy = acceptedAt + 10 minutes` และ journal เดิม; cap ถูกใช้ทันที ไม่รอได้ session ID
- คำสั่งสร้าง Checkout ครั้งแรกเริ่มได้ก่อน createBy เท่านั้น; pause/end/catalog เปลี่ยนหลัง acceptedAt ไม่ถอนคำสัญญานี้ คำนวณ `providerExpiresAt = firstDispatchAt + 30 minutes` ตาม flow เดิมและ pin request payload/key ก่อน I/O อายุ provider ไม่บวกใหม่ทุก retry
- เมื่อ createBy ผ่านและ journal ยืนยัน **ยังไม่ dispatch** ให้ fence worker/lease แล้ว RELEASED ใน transaction; worker เก่าต้องส่ง I/O ไม่ได้หลัง fence หากบันทึก dispatched แล้วแต่ไม่รู้ว่าส่งถึง provider หรือไม่ ให้ UNKNOWN ไม่ใช้เวลาที่ผ่านเป็นหลักฐานไม่จ่าย
- ถ้าคำสั่งเดิม dispatched แล้ว response หาย ให้ค้น/readback original session/invoice หรือ replay exact original key/payload ภายใน recovery window ที่ native contract รองรับ (ไม่เกิน 23 ชั่วโมงจาก firstDispatch และไม่มีการสร้าง session ใหม่หลัง payload ใช้ไม่ได้) หากพิสูจน์ไม่ได้ให้ REVIEW พร้อมนับ cap ต่อไป ห้ามเปลี่ยน key เพื่อค้นผล
- Provider session หมดอายุแล้วต้องตรวจ payment/invoice/collectible state แบบ exact ก่อน release; async payment processing หรือ evidence ขัดกันยังไม่ terminal unpaid เมื่อ paid proof มาช้าหลัง campaign end/session expiry ให้ reconcile original paid proof ตามเวลาชำระจริง ไม่ตัดสิทธิ์จากเวลารับ webhook
- RELEASED re-reserve ใช้ attempt generation ใหม่เท่านั้น หาก old callback ไม่ตรง generation ให้ reconcile original attempt แยก ไม่ consume หรือ release ตัวใหม่ หากขัดหลักฐาน terminal เดิมให้ review/hold admission แทน grant ซ้ำ

### Fence ของเพดานและ publication

รุ่นแรกใช้ advisory transaction fence เดียวต่อ logical promotion environment (`billing-promotion-policy:<environment>`) โดยไม่เพิ่มระบบ distributed lock ใหม่ ทุก final mutation ที่เปลี่ยน admission ใช้ fence นี้: reserve/reactivate/release/consume, publish/cap/pause/end/resume, เปลี่ยน offer signature และ gate/config ที่มีผลต่อ admission รวม scheduled publication

ลำดับเมื่อ flow แตะหลายกลุ่ม: promotion fence → OCR config locks ตาม companyId เรียง → Company locks เรียง → BillingSettings ตาม pattern เดิม → BillingAccount/attempt/redemption ตาม ID เรียง → ledger writes ทุก path ที่ต้องถือหลาย lock ต้องเข้าที่ caller ตามลำดับเดียวกัน ห้ามค่อยเพิ่ม promotion fence ขณะถือ company/account lock อยู่ และห้ามเรียก provider I/O ใน transaction บาง path ไม่ต้องใช้ทุก lock แต่ห้ามย้อนลำดับ; plan ต้องตรวจ caller graph ของ reconcile/configuration/OCR/refund ก่อน enable

Final transaction อ่าน permission, expectedVersion, current offerSignature, current usage และ cap ใหม่พร้อมกัน `taken = RESERVED + CONSUMED` นับ consumed ที่ HELD/refunded ด้วยหนึ่งครั้ง; RESERVED→CONSUMED ไม่เปลี่ยน taken; RELEASED ลดครั้งเดียว Publication cap ใหม่ต้อง `cap >= taken` หรือไม่จำกัด ทั้ง previewHash และ settings version ไม่ใช้แทนการอ่าน usage ใหม่

ตัวอย่าง cap 2 ลดเป็น 1 แข่งกับสองร้าน: ถ้า reserve ทั้งสองก่อน publish ให้ reject cap=1; ถ้า publish ก่อน ให้รับได้ร้านเดียว; ถ้า reserve หนึ่งร้านแล้ว publish ให้ลดเป็น 1 ได้และปฏิเสธร้านที่สอง Pause/end ใช้ serialization เดียวกัน: commit ก่อนปิดได้รับสิทธิ์ commit หลังปิดไม่ได้ ภายใต้ full rollback ไม่มี reservation ที่ไม่ผูก durable attempt และไม่มี accepted payment ที่ถูกลบเพื่อลด cap

## 7 Payment และ renewal ทุกเส้นทาง

| โหมด | เส้นทางที่ต่อยอดได้ | สิ่งที่ต้องตรวจเพิ่ม |
| --- | --- | --- |
| CARD_ONCE | payment Checkout → paid evidence → one-time apply | สร้าง paid/free boundaries, ไม่สร้าง subscription |
| PROMPTPAY_ONCE | one-time apply เดิม | QR pending/expired/จ่ายหลังหน้าต่างโปรปิด, exact session evidence และ grant ครั้งเดียว |
| CARD_AUTO สำหรับ INITIAL/RESTART | M มี payment Checkout ที่เก็บบัตร แล้ว bind subscription ราคาเต็ม trialing ถึง paidThrough สำหรับ event discount | ขยาย predicate เป็น accepted prepaid purchase ที่รองรับ promotion; ห้ามปลอม `eventDiscount.choice=USE`; bind ถึง benefitEnd และยืนยันบัตร/customer/consent |
| PROMPTPAY_RENEW สำหรับ INITIAL/RESTART | payment Checkout แล้ว `bindPromptPayRenewal` | รอบใบแจ้งชำระถัดไปเริ่ม benefitEnd; send_invoice ไม่ใช่การตัด PromptPay อัตโนมัติ |
| CARD_AUTO ที่มี subscription และซื้อซ้ำ | `BillingRepeater` กับ zero→paid schedule/collection hold | หยุดการเก็บซ้อน เลื่อน anchor/cancel/scheduled change ถึง benefitEnd และคง renewal offer ปกติ |
| PROMPTPAY_RENEW หรือ pending change ที่มีอยู่ | ตรวจ renewal/source/schedule path เดิมก่อน quote | ต้องมี native proof สำหรับการซื้อเพิ่มขณะมี invoice/schedule; หากยังไม่รองรับให้ปิดเฉพาะ combination พร้อมเหตุผล ไม่ประกาศว่าครบทุกรูปแบบแล้ว |

กลไก “รับเงินตอนนี้แล้วเริ่ม recurring หลังช่วงที่ซื้อ” มีแล้วใน M จึงเป็นทาง reuse ที่แนะนำสำหรับซื้อครั้งแรก ต้องตรวจ caller ทุกจุดของ `paymentCheckoutSnapshot` และ `eventDiscountCardAuto`: Checkout creation, paid replay, import invoice, original invoice repair, renewal contract, cancellation และ price return ให้เข้าใจ snapshot เดียวกัน

ปุ่มหยุดต่ออายุรักษาสิทธิ์รวมเดือนฟรีจน benefitEnd; resume ไม่เพิ่มเดือนหรือ quota; grace เริ่มที่ปลายสิทธิ์ใหม่ตามกติกาเดิม; scheduled downgrade/cadence change ใช้ปลายสิทธิ์ใหม่โดยไม่ตัดเดือนฟรีทิ้ง ความหมายของสถานะ Stripe `trialing` ใน flow นี้เป็นการรอรอบต่อไปหลังรับเงินแล้ว ไม่ใช่เปิดทดลองใช้ฟรีสำหรับ signup

ข้อเสนอ provider ต้องยืนยันด้วย native test บน API version ของ repo ก่อนเปิดโหมด เอกสาร Stripe รองรับ [subscription schedules และ phase/proration](https://docs.stripe.com/billing/subscriptions/subscription-schedules) และ [trial_end/การเริ่มเรียกเก็บเมื่อจบช่วง](https://docs.stripe.com/billing/subscriptions/trials) แต่ไม่ได้รับรองว่า implementation ภายในหรือทุก combination ของระบบนี้ผ่านแล้ว

### ชำระแล้วแต่ตั้งรอบถัดไปยังไม่เสร็จ

แยก paymentState, applyState และ `renewalSetupState = NOT_REQUIRED | PENDING | READY | REVIEW | CANCELLED` One-time ใช้ NOT_REQUIRED; auto modes หลัง paid/apply แต่ก่อน exact subscription/schedule readback ใช้ PENDING, timeout ที่ยังยืนยันไม่ได้เป็น REVIEW โดยคง invoice, consumed usage และ grants ที่ apply แล้ว

Status/return แสดง “ชำระแล้ว ใช้ได้ถึง … กำลังตั้งค่ารอบถัดไป” พร้อมรายการเดิม/ปุ่มตรวจสถานะ ไม่ชวนจ่ายซ้ำ `expectedNextChargeAt = benefitEnd` เป็นเป้าหมาย; `nextChargeAt` และคำว่า “ตั้งต่ออายุแล้ว” แสดงเมื่อ READY พร้อม provider proof เท่านั้น Unknown ไม่ให้ยืนยันว่าไม่มี subscription

Retry bind ต้องใช้ source attempt/customer/consent/command key เดิมและ readback subscription/schedule ทั้งเดิมและที่อาจถูกสร้างแล้ว ห้ามมี collectible subscription ซ้ำ READY ต้องพิสูจน์ amount/cadence/collection mode/boundary ตรง snapshot และไม่เรียกเก็บก่อน benefitEnd; webhook/zero invoice ไม่เพิ่ม grants อีกครั้ง หากขาด consent ต้องให้ลูกค้าทำตาม flow เดิมโดยไม่เก็บ first payment ซ้ำ

ผู้ซื้อหยุดต่ออายุระหว่าง PENDING/REVIEW ต้องบันทึก cancellation intent และ reconcile ให้แน่ใจว่ารายการเดิมไม่เก็บเงินจริงก่อนแสดง CANCELLED; ห้าม cancel แล้ว retry worker กลับไป bind รอบใหม่ สำหรับ existing renewal ต้องมี collection/schedule hold proof ก่อนรับ purchase ตาม flow เดิม; failure หลังรับเงินไปแล้วเข้า recovery ไม่ rollback paid/grants อัตโนมัติและไม่ถือ apply สำเร็จว่า renewal พร้อม

### Upgrade และการคืนเงิน

กติกานี้ผูก **source invoice/redemption** ไม่ใช่ล้างทั้ง account และไม่มีมูลค่าเงินจาก bonus segment ทุก write ตรวจ current source/version/permission และ journal เดิม ใบเสร็จ/credit note บันทึกเฉพาะเงินที่รับ/คืนจริง

| Action และช่วง | เวลา/tier | Receipt/CHAT และ campaign usage |
| --- | --- | --- |
| Upgrade ทับ paid segment ของโปร | ปฏิเสธ immediate differential/full-package ด้วย `PROMOTION_UPGRADE_DEFERRED`; เสนอ scheduled upgrade เริ่มหลังสิทธิ์ที่ commit ไว้ทั้งหมด | ใช้ Starter ต่อจนถึง effectiveAt; ไม่มี proration จาก free month และไม่ refill |
| Upgrade ทับ free segment หรือมี promo purchase ในอนาคต | เหมือนข้างบน; `effectiveAt = max(benefitEnd, committed entitlement end)` แสดงวันที่จริงก่อนยืนยัน | ไม่มีการเปลี่ยน bonus เป็น tier ใหม่หรือเงินโดยเงียบ |
| Upgrade หลังสิทธิ์โปรสิ้นและไม่มี future segment | ใช้ purchase/upgrade source guards ปกติ | สิทธิ์แคมเปญเดิมยัง consumed; entitlement ใหม่มาจากรายการใหม่ |
| Scheduled upgrade/cadence change มีอยู่ก่อนซื้อโปรเพิ่ม | quote/repeat ต้องผ่าน pending-change guards เดิม; conflict ให้ resolve รายการเดิมและ review ใหม่ | ไม่เลื่อน scheduled change หรือเพิ่ม quota จากหน้าเก่าเอง |
| Cancel/resume auto renewal | ไม่ตัด paid/free time; จัดการ provider readiness ตามด้านบน | ไม่คืน campaign usage หรือ refill |
| Refund pending/failed/UNKNOWN | ยังไม่ตัด service จากการเดา; แสดง recovery เดิม | ไม่เพิ่ม/คืน usage และไม่ถือว่าคืนเงินสำเร็จ |
| Refund บางส่วนที่ verified ยอดสะสมยังน้อยกว่า actual paid | คงเวลาและ tier; ไม่มี proportional shortening | คง base/bonus/CHAT; consumed คงเดิม |
| Refund verified เต็มยอดสะสม ทั้งก่อน apply หรือหลัง apply, ยังไม่เริ่มหรือใช้อยู่ | ยกเลิก service ที่ยังไม่ใช้จาก invoice นั้น; ถ้าก่อน apply ไม่สร้าง grants แม้ paid evidence มาช้า | revoke เฉพาะ remaining grants/future cycle funding ของ source นั้น; เก็บ consumed/reservation history และ campaign usage |
| Refund เต็มหลังใช้ครบหรือหมดอายุ | ไม่ย้อนลบ service ที่ผ่านแล้ว ไม่คืนเงินจากโบนัสเสมือน | ไม่มี remaining ให้ revoke; consumed คงเดิม |
| Refund ของ invoice A แต่มี paid/future invoice B หรือ add-on/gift อื่น | คง start/end ของ B ไม่ดึงมาเริ่มเร็วและไม่ cascade revoke; ประเมินสิทธิ์ ณ เวลาจริงจาก segments ที่ยัง valid | ไม่แตะ lot/เงินของ B หรือ gift/add-on ที่ไม่อ้าง A; gap หลังถอน A ไม่มี access จน B เริ่ม เว้นแต่มีสิทธิ์อื่นครอบ |
| Dispute เปิด | ใช้ billing hold/review เดิมตาม source; การพักไม่เลื่อน benefitEnd | หยุด admission/funding ที่ hold ครอบ ไม่ลบใช้แล้ว/ไม่คืน campaign usage |
| Dispute ปิดชนะ | ปลดเฉพาะ hold ของ dispute เมื่อ verified; hold อื่นคงเดิม | กลับใช้ remainder ที่ยัง valid ไม่คืนหน่วยที่ใช้แล้ว/หมดอายุ |
| Dispute ปิดแพ้หรือเงินถูก reversed | financial review อ้างยอดเสียจริง; full reversal ใช้ full-refund entitlement rule, partial ใช้ partial rule เมื่อหลักฐาน terminal ชัด | ห้ามให้สิทธิ์แคมเปญใหม่หรือย้อนลบ consumption; unknown ยัง hold/review |
| Admin end-package จาก full-refunded source | ใช้ adjustment เดียวกับ full refund เป็น idempotent operation; ตรวจ renewal cancellation/readback | ไม่เพิ่ม revocation ซ้ำ; end-package ไม่เป็นช่องทาง reset campaign |

Full refund ของ promo เป็น **refund + entitlement adjustment ที่ติดตามผลแยกกัน** ไม่ใช้ optional end-package flag เดิมเพื่อปล่อยโบนัสต่อ UI แสดง financial `SUCCEEDED` และ entitlement `PENDING/REVIEW` ได้ แต่ไม่แสดง “ยุติสิทธิ์แล้ว” จน adjustment verified หาก provider คืนเงินเองนอก console ให้ import/reconcile กระบวนการเดียวกัน

Refund import ต้องยืนยัน source payment ด้วยและ mark redemption CONSUMED แม้ paid webhook ยังไม่มาหรือ apply ยัง HELD; ไม่ปลด reservation หรือให้รับโปรซ้ำจากการไม่เห็น paid callback

หลัง verified full refund ให้ fence source สำหรับ admission/funding ใหม่ทันที บันทึก `entitlementAdjustmentState` และ settle/cancel OCR/AI reservations เดิมก่อน revoke available remainder; งานที่ consume แล้วต้องเก็บเป็น used ไม่ทำยอดติดลบ Pending/unknown operation ต้องกู้คืนจาก source เดิม หาก paid apply แข่งกับ full refund ให้ final apply อ่าน refunded/revoked source ภายใต้ lock เดียวกัน: ไม่ grant หลัง revoked และไม่ให้ replay ฟื้นสิทธิ์

ต้องปรับ end-package source validation ที่ M เคยเทียบ `invoice.periodEnd == account.paidThrough` ให้ตรวจ paid+bonus service projection แทน; ห้ามยืด financial invoice period เพื่อผ่าน guard หรือ bulk revoke ทุก paid lot ของ account Projection ของ term/access/sweep/quote/CHAT/OCR/status ต้องตรวจ effective segments และ revocation เดียวกัน ไม่ใช้ max paidThrough อย่างเดียวเมื่อมี future gap ถ้า source/projection ขัดกันให้ REVIEW และปิด affected mutation/admission ไม่ลบ invoice อื่นเพื่อซ่อมเอง

ไม่มี self-service คืนสิทธิ์แคมเปญในรุ่นนี้ แม้ยอด refund เต็มหรือไม่เคยใช้โบนัส การแก้ provider error ภายหลังต้องเป็น audited financial correction และคืนเฉพาะ remainder ที่พิสูจน์ได้ตาม flow เดิม ไม่สร้าง redemption/bonus ใหม่

## 8 Bug gap และ impact register

`GAP` หมายถึงความสามารถที่ยังไม่มีตามโปรใหม่ ไม่ใช่ defect ของกติกาเดิม; `RISK` คือผลเสียที่อนุมานจาก source หากแก้เพียงบางจุด ไม่ใช่เหตุการณ์ที่ตรวจพบใน Production; `DEPENDENCY` คือของเดิมที่ต้องรวมในงาน ระดับ P1 ต้องปิดก่อนเปิดเส้นทางที่เกี่ยวข้อง, P2 ต้องปิดก่อนเผยแพร่ประสบการณ์/รายงานนั้น

| ID | ประเภท | ผลที่พบหรือความเสี่ยง | จุดแก้และหลักฐาน M | ระดับ |
| --- | --- | --- | --- | --- |
| G01 | GAP | Catalog ทุก offer มี intervalCount 1; Starter ยังได้ 1/12 เดือนและ 30/360 ใบ ไม่มี bonus policy | `packages/contracts/src/billing.ts:46`; `billing-package.ts:23,38` เพิ่ม separate promotion benefit ไม่เปลี่ยน base price/cadence | P1 |
| G02 | GAP | Free days เป็น `days × 86400000` และต้องมี active card subscription จึงไม่เท่ากับเดือนปฏิทินหรือครอบคลุม one-time | `billing-free-days.ts:29,55` reuse journal/provider checks ไม่เรียก admin gift หลังซื้อทุกครั้ง | P1 |
| G03 | GAP | ไม่มี redemption uniqueness ต่อ company/campaign; BillingAttempt uniqueness ป้องกันรายการเดิม แต่ไม่ป้องกันซื้อคนละรายการเพื่อเอาโปรซ้ำ | `schema.prisma` BillingAttempt/Invoice; เพิ่ม redemption และ transaction guards | P1 |
| G04 | RISK | ต่อเฉพาะ term แต่ provider ยังเก็บที่ 1/12 เดือน หรือ reconciler เขียนวันกลับ | `billing-reconciler.service.ts` applyInvoice/bindPromptPayRenewal; `billing-repeat.ts`, `billing-schedule.ts` ต้องรักษา provider และ local boundary ให้ตรง | P1 |
| G05 | RISK | ใช้ intervalCount ปีเพื่อแถมเดือนจะกลายเป็น 24 เดือน; เปลี่ยนเป็น recurring 13 เดือนเปลี่ยนสินค้าที่ต่ออายุ | `billing-package.ts:23`; `billing-policy.ts` assertStripePrice; เพิ่ม bonusMonths ที่แยก cadence | P1 |
| G06 | RISK | ขยาย grant/invoice period แบบรวมฟรีจะทำให้ upgrade คิดราคา/โควตาต่อช่วงผิด; หากแยกฟรีแต่ไม่เพิ่ม coverage reader จะเกิด gap/review | `billing-upgrade.ts:19` อ่าน grant/invoice exact periods; ปิด immediate upgrade ที่ทับโปรตาม Q5 และให้ scheduled/source readers รู้จัก redemption segment | P1 |
| G07 | GAP | AI cycle เดิมยืด admin gift โดยไม่เติม allowance เดือนใหม่ | `line-ai/application/ai-credit-cycles.ts:87`; `ai-credit-ledger.ts:73`; ต้องแยก promotion cycle ตาม Q2 โดยไม่กระทบ admin gifts | P1 |
| G08 | RISK | เพิ่ม receipt kind ใหม่โดยไม่แก้ allocator จะ error; ใช้ ADD_ON แทนจะได้กติกา one-page image/expiry ผิด | `billing-receipt-grants.ts:12,46,80`; OCR governance/ReceiptUnitEntry ต้องรู้จัก kind ตาม Q1 | P1 |
| G09 | DEPENDENCY | Main มีส่วนลดกิจกรรมและ CARD_AUTO first-payment flow แล้ว การออกแบบจาก checkout เก่าจะสร้างซ้ำหรือทำ no-discount guards หลวม | `billing-event-discount.logic.ts:18,43,51`; `billing-checkout-mode.ts:12` reuse การ dispatch แต่คงแหล่งสิทธิ์แยก | P1 |
| G10 | RISK | โปร + event discount/deal ซ้อนกันโดยไม่ตั้งใจ; DECLINE/เลือกสิทธิ์หนึ่งอาจเผาอีกสิทธิ์ | `billing.service.ts:553,663`; `billing-event-discount.ts:20,108`; ต้องใช้ stacking choice ใน quote/transaction เดียว | P1 |
| G11 | RISK | Pause/แก้ campaign หรือคืน reservation จาก timeout ทำให้ paid callback ภายหลังไม่มีสิทธิ์ หรือบริษัทรับซ้ำ | attempt snapshot, checkout-expiry, reconcile/import/repair; ยืนยันไม่จ่ายก่อน release และรักษา accepted snapshot | P1 |
| G12 | RISK | เลื่อน benefitEnd แล้ว repeat, cancel/resume, downgrade, cadence change, grace และ sweep ยังใช้วันเก่า | collection/schedule/repeat/free-days/plan-term sweep; ทดสอบทุก transition รวมสิทธิ์ที่เคยใช้โปรแล้ว | P1 |
| G13 | RISK | Trial carryover ใช้ periodEnd ที่ caller ส่ง การส่ง benefitEnd แทน paidEnd จะยืด trial gift แบบไม่ตั้งใจ | `billing-trial-carryover.ts:26`; one-time/recurring apply; pin trial expiry แยกจาก promo ตามกติกาเดิม | P1 |
| G14 | RISK | Refund, invoice document หรือ report อาจใช้ราคาเสมือนของ 2/13 เดือนแทนเงินที่จ่าย | financial/refunds/cash-movements/document-admin/sales report; ใช้ actual paid money และแสดง free time แยก | P1 |
| G15 | GAP | การ์ด/quote/return/status/history/Web/LINE/marketing ยังไม่มีเวลาฟรีและ eligibility แบบใหม่ | BillingPage/BillingPreview/billing-display/contracts/LINE entry/public catalog; cache ต้อง expire พร้อมเวลา campaign | P2 |
| G16 | DEPENDENCY | เคยมี diagnosis ว่าสถานะปุ่มซื้อกับ quote ไม่ตรงในบาง expired/pending states; ไม่ควรเพิ่ม generic blocker อีกชั้น | [audit 2 ต.ค.](../agent-memory/billing-trial-expired-purchase-audit-2026-10-02.md); recheck บนฐานที่จะ implement ไม่ถือรายงานเก่าว่ายังเกิดทุกข้อที่ M | P2 |
| G17 | RISK | สร้าง/แก้/พัก/จบแคมเปญจาก Admin โดยไม่มี revision/cap concurrency หรือใช้ชื่อ campaign เป็น ID เปิดทางรับซ้ำ/ขายเกินเพดาน/เขียนทับ campaign อื่น | BillingPolicyRevision/Settings/Operation + redemption; stable ID, incomplete draft แยก published rules, expectedVersion, publication validation | P1 |
| G18 | DEPENDENCY | Receipt และ AI add-on ledger เป็นงานใหม่บน main; old binary อาจไม่รู้จัก promotion fields/kind | schema/contract compatibility, allocator fail-closed, workers และ AI admission ต้องพร้อมก่อน enable | P1 |

ยังไม่มี bug ใหม่ที่ยืนยันด้วยธุรกรรมลูกค้าจริงในงานนี้ ผลที่พิสูจน์ด้วย runnable check คือ baseline ระยะเวลา/โควตายังไม่มีโปร และ helper รองรับการนับ 2/13 เดือนอย่างถูกต้อง รายการ RISK ต้องใช้ test case ด้านล่างทำให้ตรวจสอบได้ใน implementation

## 9 Dependency และตำแหน่งที่จะได้รับผล

path ที่ย่อเป็น `billing/...` หมายถึง `apps/api/src/modules/billing/...`; `line-ai/...` หมายถึง `apps/api/src/modules/line-ai/...` ทั้งตารางใช้ฐาน M

| ขอบเขต | Files หรือ model หลัก | งานที่จำเป็นหรือจุดยืนยัน |
| --- | --- | --- |
| Contract/catalog | `packages/contracts/src/billing.ts`, `billing-labels.ts`, `plan-term.ts` | promotion summary, receipt breakdown, dates, errors, backward compatibility; ไม่เปลี่ยน tier presets เพื่อแถมชั่วคราว |
| Config/parser/readiness | `billing/domain/billing-policy.ts`; `application/billing-configuration.service.ts`, `billing-configuration-impact.ts`, `billing-readiness.service.ts` | validate/publish/readiness per mode; config revision เดิม |
| Admin API/UI | `billing/presentation/billing.controller.ts`, `billing.dto.ts`; `apps/web/src/features/billing-admin/BillingConfigurationPage.tsx`, `BillingOfferTermsEditor.tsx`; หน้า `/system/billing/campaigns` ที่จะเพิ่ม | list/create/detail, draft/preview/publish/pause/resume/end และ report; scoped read/write, session proof, error states; reuse config workflow หลังหน้าจอ campaign |
| DB and audit | `apps/api/prisma/schema.prisma`: BillingPolicyRevision, Settings, Quote, Attempt, Invoice, Operation, Account, ReceiptGrant, SubscriptionContract | additive redemption schema/index; pinned snapshots; audit/outbox; migration และ rollout compatibility |
| Quote/Checkout/source | `billing/application/billing.service.ts`, `billing-purchase-source.ts`, `billing-restart.ts`, `billing-capacity.ts`, `billing-feature-entitlements.ts` | eligibility ทุกบริษัท, reservation, capacity, exact source และ price consent |
| Calendar/impact | `billing/domain/billing-package.ts` | paid/free boundaries ผ่าน helper เดียวกันทุก caller |
| Provider evidence | `billing/domain/paid-checkout-invoice.ts`, `paid-invoice.ts`; `infrastructure/stripe.client.ts` | จ่ายเท่ายอด snapshot และ account/mode/customer ถูกต้อง; zero invoice ไม่ grant |
| Apply and renewal | `billing/application/billing-reconciler.service.ts`, `billing-repeat.ts`, `billing-schedule.ts`, `billing-collection.ts` | atomic grants, provider boundary, cancellation/resume, next-charge/readback |
| Plan changes | `billing/application/billing-upgrade.ts`, `billing-price-return.ts`, `billing-capacity.ts`; scheduled change ใน service/reconciler | แยกมูลค่าฟรี, coverage gaps, pending effective date, Q5 |
| Retry/workers/import | `billing/application/billing-checkout-expiry.service.ts`, `billing-checkout-expiry-source.ts`, `billing-provider-scans.service.ts`, `billing-operations.service.ts` | consumed/released ถูกต้องใน lost response, delayed webhook, invoice import, apply retry; worker journal เดิม |
| Receipt quantity | `billing/application/billing-receipt-grants.ts`, `billing-trial-carryover.ts`, `billing-receipt-adjustments.service.ts`, `billing-addon-grants.ts` | base/bonus provenance, allocation, expiry, reversal, fixed gifts/add-ons ไม่ถูกยืด |
| OCR admission | `line-ai/application/company-ocr-governance.ts`; CompanyOcrUsageEvent และ ReceiptUnitEntry | Web และ LINE อ่านจำนวนตรงกัน, reserve/consume/release, retry ไม่หักซ้ำ |
| CHAT credit | `line-ai/application/ai-credit-cycles.ts`, `ai-credit-ledger.ts`, `company-ai-budget-policy.ts`, `company-ai-budget-reservation.ts`, `company-ai-budget-readiness.ts` | cycle เดือนฟรี, legacy/ledger cutover, quota holds, budget guards; AI Gateway ยังใช้ permission-checked API ไม่อ่าน DB ตรง |
| Term expiry/access | `apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.ts`, `company-plan-term.use-cases.ts`; web `features/plan-term` | lock ที่ benefitEnd/grace จริง; manual/security hold ไม่หายเพราะรับโปร |
| Financial/refund | `billing/application/billing-refunds.service.ts`, `billing-refund-source.ts`, `billing-end-package.ts`, `billing-financial.ts`, `billing-cash-movements.service.ts`, `billing-settlement.service.ts` | เงินจริง, partial/full refund/dispute, end-package, consumed rights; ไม่ถือ bonus เป็นเงินคืน |
| Documents/notifications | `billing/application/billing-document-admin.service.ts`, `billing-notifications.service.ts`, `billing-timeline.ts`, `billing-history-export.ts` | receipt/invoice/อีเมล/ประวัติบอกเวลาแถมและรอบถัดไปตรงกัน; no false payment success |
| Customer Web | `apps/web/src/features/billing/BillingPage.tsx`, `BillingPreviewPage.tsx`, `billing.api.ts`, `billing-display.ts`, `billing-error-text.ts` | new/existing/used/pending states, refreshed eligibility, quote review, mobile/desktop, next-charge copy |
| LINE | `billing/line-billing-entry.spec.ts`; `line-ai/domain/logic/line-event-discount.logic.ts`; LINE package/status entry และ notification เดิม | deep link พาบริษัท/permission ถูกต้อง ไม่ให้ AI แจกสิทธิ์จากข้อความ; no duplicate event claim flow |
| Sales event/deal | `billing/application/billing-event-discount.ts`; `domain/billing-event-discount.logic.ts`, `billing-checkout-mode.ts`, `deal-offer.ts`; `sales-console/application/sales-events.service.ts` | Q4, ใช้ predicate ร่วมกับ flow ที่มีแล้ว, คง ticket/deal attribution แยก |
| Marketing/public | `apps/web/app/api/public/billing/catalog/route.ts`; official marketing แยก repository | publication/cache/copy และราคา/โควตาต้องตรง accepted catalog; ยังไม่ได้ตรวจ source/deploy ของ marketing repo รอบนี้ |
| Ops/report | Billing timeline/admin reports, SalesAttribution, sales reports, provider scans | metrics ใช้จริงตาม redemption/paid/granted ไม่รวมฟรีเป็นรายได้ ไม่ reattribute ร้านเดิม |
| Tests | tests ใน §10 | domain → DB/concurrency → provider → browser/LINE → release evidence ตามขอบเขตจริง |

ตารางครอบคลุม dependency ที่พบจาก local source tracing และ external boundary ที่ระบุไว้ ไม่ใช่การรับรอง live dependency inventory ของ cloud/provider/marketing หาก implement ต้องทวน diff จาก M ถึงฐานใหม่ก่อนเพิ่มงาน ไม่ย้าย patch ไป checkout เก่านี้โดยถือว่า main ไม่มีระบบส่วนลด/ledger

## 10 Acceptance และการทดสอบที่ต้องมี

| ID | สถานการณ์และผลที่ต้องได้ |
| --- | --- |
| A01 | Starter เดือน 249 ได้ base 1 + free 1 รวม 2 เดือน; Starter ปีราคา policy ได้ base 12 + free 1 รวม 13 เดือน; Basic/Pro/Enterprise ไม่มีโบนัส |
| A02 | ร้านใหม่, trial เดิม, expired paid, active Starter one-time และ active renewal ที่รองรับ ซื้อได้เมื่อ guards ผ่าน; ร้านเดิมไม่ถูกตัดออกเพียงเพราะเคยจ่าย |
| A03 | บริษัทเดียวเลือกเดือน/ปี, ต่าง user/owner, ต่าง Web/LINE และต่าง key พร้อมกัน รับสำเร็จได้ครั้งเดียวต่อ campaign; campaign ใหม่รับได้; TEST/LIVE แยก |
| A04 | เปลี่ยนชื่อหรือ publish revision ใหม่ของ campaign เดิมไม่คืนสิทธิ์; quote stale ก่อน reserve ต้อง review ใหม่; accepted reservation คง snapshot แม้ revision เปลี่ยนก่อน provider I/O |
| A05 | Jan 31, Feb 28/29, leap year, Dec→Jan, ช่วงต้นวันไทยและซื้อก่อน/หลัง expiry; calendar count ไม่ drift และไม่ใช่ 30 วัน |
| A06 | ซื้อก่อนหมดต่อจาก paidThrough เดิม; หลังหมดเริ่มใหม่จาก verified paidAt; quote เป็นประมาณการและ apply ใช้เวลาชำระจริงพร้อมแสดงผลสุดท้าย |
| A07 | base 30/360 + bonus 30 ครั้งเดียว รวม 60/390 ใบตาม Q1; available/expiry ตาม policy, used/held/replayed OCR ถูกต้อง ไม่ grant ซ้ำตอนเข้าเดือนฟรี |
| A08 | base paid receipts, promo, trial carryover, admin gift และ add-on มี expiry/allocation ของตัวเอง; unknown kind ไม่ทำให้ production balance ล้มหลัง enable |
| A09 | เครดิตเดือนฟรีตาม Q2: เปิดเครดิตแต่ละรอบตามสิทธิ์จริง, ไม่มี refill จาก repeat/upgrade, cycleKey/replay ไม่ซ้ำ; admin free days ยังคงไม่เพิ่มเครดิตเอง |
| A10 | CARD_ONCE และ PROMPTPAY_ONCE ชำระแล้วเพิ่มสิทธิ์ exact once; declined/cancel/expired/UNKNOWN ไม่ grant และไม่ปลด reservation จากการเดา |
| A11 | CARD_AUTO/PROMPTPAY_RENEW first purchase รับเงินจริงทันทีแล้วเก็บรอบถัดไปที่ benefitEnd; subscription/zero invoice ไม่สร้าง grant ซ้ำ; consent ตรง mode |
| A12 | ซื้อซ้ำบน active auto renewal เลื่อน provider collection จริง ไม่มี overlapping invoice; pending schedule/cancel/refund/debt source ยังถูกตรวจ |
| A13 | Stop/resume renewal ก่อนช่วงฟรีจบไม่ตัดสิทธิ์/ไม่ grant ซ้ำ; grace, sweep และ scheduled downgrade/cadence change อ้าง boundary ที่ถูกต้อง |
| A14 | Immediate differential/full-package upgrade ที่ทับ paid/free/future promo ถูกปฏิเสธและเสนอ scheduled change หลัง committed entitlement end; หลังหมดโปรใช้ guards ปกติ ไม่มี cash credit/refill |
| A15 | Campaign ก่อนเริ่ม/จบ/pause/cap เต็ม: ปฏิเสธการจองใหม่; reserved Checkout จ่ายหลังปิดยัง apply; cap race ให้ผลตรงเพดาน |
| A16 | Webhook ซ้ำ/สลับลำดับ, worker restart, lost provider response, invoice import, apply HELD→retry และ reconciliation ใช้ invoice/redemption เดิม |
| A17 | Event discount/deal conflict ต้องตาม Q4; user เลือกโปรแล้วไม่กิน ticket อีกใบ; historical no-promotion/no-discount snapshots ยังตรวจได้ |
| A18 | Partial/full/cumulative refund, dispute/reversal/end-package ตาม §7; source-specific adjustment รวม future invoice/paid-held/OCR in-flight; usage คง consumed และ replay ไม่ฟื้นสิทธิ์ |
| A19 | Admin permission/reauth/scope/version ถูก revoke หรือ stale ระหว่าง preview→publish ต้องปฏิเสธ; customer ข้าม company ส่ง bonus/price ปลอมไม่ได้ |
| A20 | Catalog/status/quote/return/history/admin/LINE ใช้ dates/units เดียวกัน; loading/error/permission/used/pending มีทางกลับ; mobile 390px และ desktop อ่านเงื่อนไขครบ |
| A21 | API/worker/AI ledger mixed-version: gate ปิดจน readers รองรับ schema/kind, disable campaign ไม่หยุด recovery ของเงินที่รับแล้ว; rollback ไม่ลบ paid records |
| A22 | สรุปใช้สิทธิ์/เงิน/โควตาตรง ledger; บริษัทเดิมไม่เพิ่ม first-activation attribution; marketing copy ไม่โฆษณา offer ที่ quote รับไม่ได้ |
| A23 | Admin สร้าง campaign จากแบบตั้งต้น 249 และบันทึกร่างที่ยังไม่ครบได้; reload พบข้อมูลเดิม; draft ไม่ปรากฏเป็นโปรที่ซื้อได้; preview ต้องแสดง 2 เดือน/60 ใบและ 13 เดือน/390 ใบ |
| A24 | เปิด campaign ตาม workflow เดิมและเวลาที่ตั้งโดยไม่ deploy; list/detail/customer API แสดงสถานะตรงกันที่ start/end; ปิด sales gate ไม่ถูก publish campaign เปิดทับ |
| A25 | Pause/resume/end จาก Admin บังคับใช้ที่ API ทันทีหลังสำเร็จ; resume ไม่คืน usage; ended campaign เปิด ID เดิมไม่ได้; accepted Checkout ยังจ่าย/apply ตาม snapshot เดิม |
| A26 | Admin สองคนแก้พร้อมกันหรือเปิดหน้าค้าง: stale publish ถูกปฏิเสธ ไม่เขียนทับ campaign อื่น/ราคาฐาน; retry create/command ไม่สร้าง campaign หรือ operation ซ้ำ |
| A27 | Admin list/form/detail/report ที่ 390px และ desktop มี empty/loading/error/permission states; จำกัดข้อมูลการเงินตามสิทธิ์ และลิงก์กลับ attempt/invoice ใช้ access check เดิม |
| A28 | Catalog signature เปลี่ยน quota/price/tax: campaign stale รับใหม่ไม่ได้; snapshot ที่ reserved คงเดิม; NORMAL ยังซื้อได้; re-preview quota 50/600 ไม่ผ่าน template 60/390 (F01) |
| A29 | เปลี่ยน provider account ใน logical environment เดิมไม่คืน once-per-company; TEST/LIVE แยก; migration เก็บ history และปิด admission หากพบ duplicate (F02) |
| A30 | reserve→end→dispatch, createBy ผ่านทั้งยังไม่ dispatch/UNKNOWN, lost response, paid callback หลัง end และ old generation: ผลตรง §6 ไม่มี Checkout ซ้ำ (F03) |
| A31 | FEFO ใน package group, expiry เท่ากัน bonus-first, base carry แต่ bonus fixed, OCR held/expiry/replay และ add-on eligibility คงเดิม (F04) |
| A32 | AI free tail/free gap ให้รอบเดียวที่ paidEnd; ไม่ grant ล่วงหน้า/ซ้ำ/หลัง revoke; Jan31 clamp ถูกต้อง; admin free days ไม่เพิ่ม lot (F05) |
| A33 | paid/apply แล้ว bind timeout แสดง renewal PENDING/REVIEW; exact readback จึง READY; retry/cancel race ไม่สร้าง subscription หรือ grant ซ้ำ (F06) |
| A34 | NORMAL/PROMOTION/EVENT_DISCOUNT/DEAL แยก choice; สิทธิ์ที่ไม่เลือกไม่ถูกใช้; โปรหลุดไม่ silent fallback และ UNKNOWN ไม่เปิด Checkout ใหม่ (F07) |
| A35 | ครบ action matrix §7 ทั้ง active/future/used/unused/cumulative refund; invoice B ไม่ถูก revoke เมื่อคืน A; paid apply หลัง full refund ไม่ฟื้น grants (F08) |
| A36 | ทุก serialization ของ cap ลด 2→1 กับสอง reservations, pause/end และ release/replay ให้ taken ไม่เกิน final cap; shared fence ครอบ scheduled/catalog publication (F09) |

ต่อยอด focused suites ที่ M: `billing-package.spec.ts`, `billing-free-days.spec.ts`, `billing-upgrade.spec.ts`, `billing-event-discount.spec.ts`, `billing-event-discount.logic.spec.ts`, `billing-event-discount.pg.spec.ts`, `billing-event-discount-renewal.pg.spec.ts`, `billing-purchase-source.pg.spec.ts`, `billing-trial-carryover.pg.spec.ts`, `receipt-addon-ledger.pg.spec.ts`, `line-ai/application/ai-credit-cycles.spec.ts`, `ai-credit-funding.pg.spec.ts` รวมทั้ง E2E `customer-billing-ux.spec.ts`, `billing-preview.spec.ts`, `plan-term-billing-readiness.spec.ts` และ `sales-console.spec.ts` เพิ่ม Admin campaign journey ตาม A23–A27 เมื่อ implement อย่าถือการผ่าน suite เดิมว่า A01–A36 ผ่านแล้ว

ลำดับ dependency สำหรับแผนถัดไป: ใช้กติกา §2/§5–§7 ที่ปิดแล้ว → pin source ใหม่และตรวจ contract/schema/lock caller graph → Admin campaign list/create/detail + publication/rule/eligibility/reservation → quote/payment/paid-free apply → receipt/AI/renewal/change/refund consumers → browser/LINE/marketing → native provider proof และ release readiness วันเริ่ม/สิ้นสุดและเพดานของ campaign จริงให้ Admin กรอกภายหลัง ขั้นตอนนี้เป็น handoff ใน spec ไม่ใช่เริ่ม implementation plan หรืออนุญาต deploy

## 11 ผลตรวจของงาน spec นี้

| การตรวจ | ผลและข้อจำกัด |
| --- | --- |
| Source tracing | ตรวจ working tree และ M ผ่าน local Git; แยกของใหม่บน main ได้แก่ event discount first-payment binding, receipt/AI ledgers และ admin document/financial tools |
| Focused regression | `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot src/modules/billing/domain/billing-package.spec.ts src/modules/billing/application/billing-free-days.spec.ts` ผ่าน 14 tests, exit 0 ที่ working tree; ตรวจแล้ว implementation สองไฟล์นี้ไม่ต่างระหว่าง HEAD กับ M แต่ผลนี้ไม่รับรองทั้ง main หรือโปรใหม่ |
| Calendar/source assertions | เรียก helper จริงผ่าน `pnpm --filter @watchdog-bms/api exec tsx --eval` ผ่าน 8 assertions: ปกติเดือน/ปี = 1/12 เดือนและ 30/360 ใบ, +2/+13 เดือน, Jan 31→Mar 31, leap Feb 29→Mar 29 ปีถัดไป |
| Provider references | อ่านเอกสาร Stripe schedules/trials วันที่ 5 ต.ค. 2026; ยังไม่ทดสอบ API version/บัญชี Stripe ของระบบ |
| เอกสาร | ตรวจ local links, source paths ที่ M, IDs, whitespace และอ่านทวนตัวเลข/กติกา; ผลสุดท้ายบันทึกใน memory |
| ปรับตามมติ Admin console | เพิ่ม list/create/detail, draft และ publication lifecycle, pause/resume/end, fields/permission/report/contracts และ A23–A27; ตรวจเอกสารเท่านั้น ไม่ rerun application tests เพราะไม่มีการแก้ implementation |
| ไม่ได้ทดสอบ | ไม่มี promotion implementation จึงยังไม่มี DB migration/concurrency, native payment, browser acceptance, AI/OCR month-free, UAT หรือ Production proof |

ก่อนแตะ cloud ให้อ่าน [Cloud operations](../runbooks/cloud-environment-operations.md) และก่อน UAT/Production/retry ให้อ่าน [Deployment protocol](../runbooks/uat-production-v2-deployment.md) ตาม repo ไม่เรียกโปรโมชั่นพร้อมใช้งานจาก spec หรือ local tests เท่านั้น

## 12 ผลจำลองและการปิด F01–F09

[รายงานวันที่ 5 ตุลาคม 2026](../qa/starter-249-promotion-spec-e2e-simulation-2026-10-05-th.md) เป็นหลักฐานก่อนแก้ spec: 37 model cases และ 6 exact-source assertions พบ F01–F09 เก็บรายงานเดิมไว้ตามผลขณะนั้น กติกาปัจจุบันด้านบนแทนข้อเสนอเดิม ไม่ถือ model pass ว่า implementation สำเร็จ

| Finding | ข้อกำหนดปิด gap | Acceptance |
| --- | --- | --- |
| F01 | §4 pin signature และ stale/re-preview; ไม่เปลี่ยน 60/390 ตาม catalog | A28 |
| F02 | §6 logical environment + stable campaign + company; provider เป็น binding | A29 |
| F03 | §6 acceptedAt ที่ reservation commit, deadline/journal/terminal-unpaid fence | A30 |
| F04 | §5 immediate/fixed expiry/FEFO/bonus tie/carryover และ pending OCR | A31 |
| F05 | §5 promotion segment/cycle/funding source แยก admin gift | A32 |
| F06 | §7 payment/apply/renewal readiness แยกและ exact recovery | A33 |
| F07 | §3 explicit benefit choice, normal fallback ผ่าน review, ไม่ซ้อน | A34 |
| F08 | §7 deferred upgrade + refund/dispute matrix และ source-specific revocation | A35 |
| F09 | §6 shared final fence และ live usage check ทุก mutation | A36 |

การปิดนี้เป็น **ปิดข้อกำหนดใน spec** มีมติธุรกิจครบสำหรับรุ่นแรก ไม่ใช่ปิด implementation gap ใน source M กรณี provider/UI/DB/lock/migration ต้องตรวจจริงก่อนเปิดใช้ ดู [รายงานจำลองซ้ำวันที่ 9 ตุลาคม 2026](../qa/starter-249-promotion-spec-e2e-resimulation-2026-10-09-th.md) สำหรับผลตาม spec นี้และขอบเขตที่ยังไม่ได้ทดสอบ

## 13 สถานะการพัฒนารุ่นแรก

รุ่นแรกพัฒนาตาม [แผน](../plans/starter-249-bonus-month-promotion-plan.md) เมื่อ 9 ตุลาคม 2026 เอกสารนี้ยังเป็นกติกาสินค้า ส่วนแผนบันทึกจุดที่การออกแบบจริงต่างจากข้อความในเอกสารนี้พร้อมเหตุผลจาก source (R1–R19) ผลตรวจรับ A01–A36 และสิ่งที่ยังค้าง จุดต่างที่ผู้อ่านเอกสารนี้ควรรู้:

- เงื่อนไขแคมเปญเก็บในช่องแยกข้างนโยบายราคา ไม่ได้อยู่ใน JSON ก้อนเดียวกับนโยบาย (§6 ตาราง "Promotion terms") เพื่อให้ถอยรุ่นได้โดยไม่ปิดการขาย
- พักและจบแคมเปญเป็นคำสั่งขั้นเดียว (ยืนยันรหัสผ่าน เหตุผล และ version) จึงมีผลทันทีตาม §4; การเปิด แก้ เปลี่ยนเพดาน และกลับมาเปิด ผ่านขั้นตรวจและอนุมัติเดิม
- fence ของเพดานใช้ตอนจองและตอนเผยแพร่/พัก/จบ/กลับมาเปิด ส่วนการใช้สิทธิ์และการคืนสิทธิ์ใช้ lock บริษัทเดิม (§6 "Fence")
- การกู้คืนรายการที่ response หายใช้การอ่านกลับจากผู้ให้บริการเท่านั้น ไม่ส่งคำสั่งสร้าง Checkout ซ้ำ (§6)
- รุ่นแรกรับโปรกับการซื้อครั้งแรก การกลับมาซื้อหลังหมดอายุ และการซื้อต่อของ Starter แบบจ่ายครั้งเดียวรอบเดียวกัน; ร้านที่ตัดบัตรอัตโนมัติอยู่แล้วและการซื้อพร้อมเปลี่ยนรอบหรือเปลี่ยนรุ่น ระบบแจ้งเหตุผลและยังซื้อแบบปกติได้ (§3 ตารางแหล่งสิทธิ์, A12)
- คืนเงินเต็มของรายการที่ยังไม่เริ่ม ถูกพัก หรือถูกแทนด้วยรายการใหม่ และผล dispute ยังให้ทีมงานจัดการ รายงานแคมเปญแสดงว่ารอตรวจ (§7)
- ยังไม่ได้พิสูจน์กับ Stripe จริงและยังไม่ได้ตรวจรับบน UAT จึงยังไม่ควรเปิดแคมเปญให้ลูกค้าจริง
