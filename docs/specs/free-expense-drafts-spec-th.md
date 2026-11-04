# Spec: สิทธิ์อ่านเอกสารฟรี 3 ใบสำหรับร้านที่ยังไม่เคยซื้อแพ็กเกจ

วันที่: 2026-10-28 (Asia/Bangkok)
สถานะ: MERGED MAIN + DEVELOP / POST-MERGE LOCAL BROWSER VERIFIED — ยังไม่ deploy หรือเปิด live gate
Owner: thawatchai
เอกสารคู่กัน: [แผน](../plans/free-expense-drafts-plan-th.md) · [impact / bug / gap](../research/free-expense-drafts-impact-audit-2026-10-28-th.md) · [memory](../agent-memory/free-expense-drafts.md)

## 1. เป้าหมายและมติที่ได้รับ

ให้ร้านที่เปิดสำเร็จแล้วแต่ยังไม่เคยซื้อแพ็กเกจ ส่งบิล ใบเสร็จ หรือสลิปที่เกี่ยวกับรายจ่ายให้อ่านฟรีรวม 3 ใบต่อเดือน เปิดดูผล แก้ข้อมูล และเก็บร่างได้ ผู้ใช้เริ่มใช้งานตามปกติ ไม่ต้องกดรับสิทธิ์หรือเห็นข้อความเชิญชวนก่อนใช้งาน

| ID | มติจากบทสนทนา | ผลที่ต้องเกิด |
| --- | --- | --- |
| D01 | ให้เฉพาะคนที่เปิดร้านแล้ว | provision ร้านและสมาชิกสำเร็จจริง; เพิ่มเพื่อน LINE หรือส่งคำขอสมัครอย่างเดียวยังไม่ได้สิทธิ์ |
| D02 | อ่านได้เดือนละ 3 ใบ; เปิดเฉพาะรายจ่าย ดู/แก้/เก็บ draft | จำกัดเอกสารและการกระทำทั้งเว็บ/LINE/API/worker ไม่ใช่แค่ซ่อนเมนู |
| D03 | ใช้งานได้เอง; Owner เพิ่ม welcome ครั้งเดียวสำหรับร้าน LINE ที่เปิดใหม่เมื่อ 2026-10-30 | ต้อนรับเฉพาะ cohort ใหม่ตาม [new-shop welcome spec](new-shop-welcome-package-advisor-spec-th.md); ไม่ส่งย้อนหลัง ไม่ต้องกดรับสิทธิ์ ไม่มี counter แทรกทุกคำตอบหรือการขายระหว่างแก้ร่าง |
| D04 | ใช้เฉพาะคำสั่งที่ไม่เสียค่า AI; พิมพ์ถามไม่ได้ | คำสั่งที่รองรับต้องไม่เรียกโมเดลตลอดเส้นทาง; OCR 3 ใบเป็นข้อยกเว้นที่ระบบรับต้นทุน |
| D05 | ข้อความปฏิเสธต้องระวัง guard อื่น | เหตุความปลอดภัย สิทธิ์ support ระบบปิด และสถานะงานยังใช้เหตุของตนเอง |
| D06 | เฉพาะร้านที่ยังไม่เคยซื้อแพ็กเกจ | ร้านเคยซื้อแล้วหมดอายุไม่กลับมาใช้ฟรี แม้ยกเลิก/คืนเงิน/เปลี่ยนวิธีจ่าย |
| D07 | เขียน spec + plan ตรวจ impact, bug, gap และคำให้ครบ | เก็บข้อกำหนด แผน และหลักฐานตรวจไว้ใน docs |
| D08 | “implement ได้เลย ให้ luna sol ช่วยตามความเหมาะสมของงาน” | อนุญาต implementation และ local tests; ไม่ใช่คำสั่ง deploy |

ข้อกำหนดเชิงออกแบบในหัวข้อถัดไปเป็นรายละเอียดเพื่อทำให้มติข้างต้นทำงานครบ ไม่ใช่การอ้างว่า Owner ระบุชื่อ field, schema หรือข้อความทุกประโยคเอง

## 2. ขอบเขตและเอกสารที่ใช้ร่วมกัน

ใช้ [locked signup](mangmee-sales-deals-and-locked-signup-spec-th.md), [plan term](mangmee-company-plan-term-spec-th.md), [package entitlements](mangmee-package-entitlements-spec-th.md), [feature entitlement](feature-entitlement-decoupling-spec.md), [OCR governance](company-ocr-governance-spec-th.md), [receipt continuity](receipt-reliability-and-draft-continuity-spec.md), [receipt UX](line-receipt-ux-signup-reapply-spec.md), [credit wording](line-ai-credit-wording-and-deterministic-reads-spec-th.md), [support](line-support-request-spec-th.md), [capture/correction](line-ai-capture-correction-spec.md), [draft control](line-ai-draft-control-spec-th.md) และ [manual entry flag](manual-expense-web-entry-flag-spec-th.md)

เมื่อ implementation งานนี้ผ่าน acceptance แล้วเท่านั้น:
- แก้ข้อกำหนดล็อกทุกงานจนซื้อแพ็กเกจ เฉพาะร้านที่เข้าเกณฑ์และเฉพาะกิจกรรมฟรีในเอกสารนี้
- เพิ่มข้อความจำนวนเอกสารฟรีแยกจากข้อความเครดิต AI เดิม เฉพาะเหตุ FREE_DOCUMENT_LIMIT_REACHED
- ไม่คืน trial 15 ใบ/30 วัน ไม่เปลี่ยน paid catalog ราคา grant สัญญา วันสิ้นรอบ หรือสิทธิ์ของร้านที่มีอยู่
- guard การระงับ การยอมรับเงื่อนไข สิทธิ์ผู้ใช้/สาขา การเงิน และคำสั่งเจ้าหน้าที่มีผลตามเดิม
- สเปกต้นทางมี amendment อ้างถึงเอกสารนี้เฉพาะ cohort ฟรี ไม่เปลี่ยน paid/admin policy เดิม เพื่อไม่เหลือคำสัญญาสองแบบ

ไม่มี guest inbox, signup แบบใหม่, free chat, คลังฝากไฟล์ไม่จำกัด, ระบบแพ็กเกจใหม่ทั้งชุด, ระบบ coupon, สวิตช์ trial หรือการเปลี่ยนค่าบริษัทจริงในงานเอกสารนี้

## 3. ผู้มีสิทธิ์และขอบเขตร้าน

สิทธิ์ผูก companyId ซึ่งเป็นร้าน/บริษัทเดียวกัน รวมทุกสาขา ผู้ใช้ และช่องทาง ผู้ใช้ยังต้องเป็นสมาชิกที่ใช้งานได้และมีสิทธิ์กับรายการนั้น การมีสิทธิ์ฟรีไม่ได้เพิ่ม role หรือสิทธิ์อ่านข้อมูลผู้อื่น

| สภาพร้าน | ผล |
| --- | --- |
| ยังไม่มีร้าน / สมัครรออนุมัติ / provision ไม่เสร็จ | flow สมัคร/สถานะเดิม ไม่มี OCR หรือร่างธุรกิจ |
| เปิดร้านแล้ว ไม่เคยซื้อ และเดิมล็อกเพราะ no_package เท่านั้น | FREE_EXPENSE_DRAFTS เมื่อ policy พร้อม |
| trial เดิมยังไม่หมด หรือสิทธิ์ Admin/manual ที่ใช้งานอยู่ | รักษาสิทธิ์เดิม ไม่ลดเหลือ 3 และไม่บวกฟรีอีกกอง |
| trial เดิมหมด ไม่เคยซื้อ และไม่มี hold อื่น | เข้า FREE_EXPENSE_DRAFTS ได้; ต้องพิสูจน์ว่าเป็น term-only lock |
| เคยซื้อแพ็กเกจแล้ว ไม่ว่ากำลังใช้ หมดอายุ ยกเลิก คืนเงิน หรือ disputed | ไม่เข้า cohort ฟรี; ใช้ flow ตามสิทธิ์/การกู้คืนเดิม |
| ซื้อสำเร็จแต่ apply สิทธิ์ค้าง หรือหลักฐานรับเงินยังไม่ชัด | ไป recovery เดิม ห้ามแจกฟรีเพื่อกลบงานรับเงินค้าง |
| admin disable/hold, SUSPENDED, ARCHIVED, กำลังลบข้อมูล | ไม่เปิดกลับด้วยสิทธิ์ฟรี |
| ร้านเก่าไม่มี term / special grant ที่ตีความไม่ได้ | คงสิทธิ์เดิมหรือ review ตามเหตุ; ไม่อนุมานว่าเป็นร้านฟรี |
| แพ็กเกจยังใช้ได้แต่โควตาหมด | ไม่เติมฟรี 3 ใบ |

หลักฐาน “ยังไม่เคยซื้อ”:
1. อ่านจากประวัติการซื้อที่ระบบรับรองแล้วของบริษัท ไม่ใช้ราคา tier, renewCount, billingAccountId ปัจจุบัน หรือวันหมดอายุเพียงตัวเดียว
2. ตรวจการซื้อครั้งแรก ซื้อซ้ำ ต่ออายุ ดีล และช่องทางจ่ายที่มีอยู่ รวมรายการเก่าที่ไม่ใช่สัญญาปัจจุบัน; billing customer/account ที่สร้างไว้แต่ไม่เคยจ่ายไม่ใช่หลักฐานซื้อ
3. ใช้ขอบเขต environment/account/mode ตาม billing source contract; PAID_OTHER_MODE หรือ SOURCE_INCONSISTENT ไม่แปลว่าใช้ฟรีได้
4. คืนเงิน/ล้าง mapping/ย้าย provider ไม่ลบประวัติการเคยซื้อ; ข้อมูลขาดหรืออ่านไม่ได้ไม่ถือว่า “ไม่เคยซื้อ”
5. admin gift ไม่ใช่การซื้อ แต่ยังใช้ provenance/อายุ/hold เดิม; ไม่ผสม grant กับฟรีจนทำให้เกิน 3 โดยไม่ได้รับสิทธิ์นั้น
6. เพิ่มวิธี login, ยกเลิกผูก LINE, reapply, เปลี่ยนเดือน หรือ replay provisioning ไม่สร้างสิทธิ์ซ้ำ
7. ร้านเพิ่มเติมต้องผ่านการเปิดร้านและการตรวจซ้ำ/abuse เดิม ไม่มีทางสร้างร้านเพื่อหลบ suspension หรือ quota อัตโนมัติ

## 4. สิ่งที่ใช้ฟรีได้

| กิจกรรม | ขอบเขตฟรี |
| --- | --- |
| ส่งเอกสารรายจ่าย | อ่านบิล/ใบเสร็จ/สลิปรวม 3 ใบต่อเดือน ผ่าน pipeline เดิมที่จำกัดไว้ |
| ดูรายการ/ค้นหาร่าง/เปิดรายละเอียด/ภาพต้นฉบับ | ตาม own/related/read permission และ branch scope เดิม |
| แก้ร่างบนเว็บ | วันที่ คู่ค้าในเอกสาร รายการ ยอดเงิน หมวด และข้อเท็จจริงต้นทางที่ form เดิมอนุญาต พร้อม validation/version check |
| เลือกหมวด/สาขา/ข้อมูลประกอบ | อ่าน lookup ขั้นต่ำที่ต้องใช้ใน form ตามสิทธิ์; ไม่เปิดจัดการ master data ทั้งโมดูล |
| เก็บร่างที่ข้อมูลยังไม่ครบ | ได้; ไม่ใช้ zero แทนค่าที่อ่านไม่ได้ ไม่บังคับกรอกเพื่อยืนยันรายการ |
| แก้ร่างเก่าเมื่อโควตาหมด/เปลี่ยนเดือน | ได้ ไม่หักสิทธิ์อ่านใหม่ |
| ติดต่อเจ้าหน้าที่ เลือกร้าน ดูสถานะ/ตั้งค่าบัญชี/แพ็กเกจ | ใช้ entry point เดิมตามสิทธิ์ |
| สร้างรายจ่ายเปล่าด้วยมือ/สั่งสร้างจากข้อความ | ไม่เปิดเพิ่มในรอบนี้; ร่างฟรีเกิดจากงานรับเอกสาร |
| ขอ AI อ่านซ้ำหรือเปลี่ยนไฟล์ให้ AI อ่านใหม่ | ต้อง admission ใหม่เมื่อเป็นงานอ่านใหม่จริง; replay งานเดิมไม่หักซ้ำ |
| พิมพ์ถาม/วิเคราะห์/อธิบาย/สั่งแก้ด้วยภาษาธรรมชาติ/เสียง | ไม่เปิดในสิทธิ์ฟรี |
| ส่งตรวจ/mark-ready/ยืนยัน/อนุมัติ/ปฏิเสธ/void/จ่าย/เบิก/ลงบัญชี/ส่งออกบัญชี | ไม่เปิดด้วยสิทธิ์ฟรี แม้ role เดิมมี permission |
| ใบแทน ใบเตรียมจ่าย ใบสำคัญจ่าย 50 ทวิ ภาษี procurement CRM inventory banking reports | ไม่เปิดกระบวนการจากสิทธิ์ฟรี |

ร่างใช้ DRAFT/NEEDS_REVIEW ตาม flow เดิม ไม่เพิ่ม state ธุรกิจ “FREE_DRAFT” อีกชุด; เก็บ provenance ของแหล่งสิทธิ์แยกจากสถานะเอกสาร ห้าม auto-post, auto-confirm หรือสร้าง payment/reimbursement/tax event จากการอ่านหรือบันทึกร่าง

สลิปเป็นหลักฐานที่อ่านได้ ไม่ยืนยันว่ารายจ่ายชำระแล้ว ไม่ถือเป็นใบกำกับภาษี ไม่สร้างรายจ่ายซ้ำเมื่อนำไปผูกกับบิลเดิม การผูกใช้กลไก evidence/capture ที่มีอยู่และสิทธิ์เฉพาะร่าง ไม่จำเป็นต้องเปิด capture handoff/review/accept-allocation ทั้งชุด

แก้ source facts ได้โดยไม่ต้องให้ expense.review/expense.confirm เพิ่มทั้งก้อน หาก writer เดิมสร้าง vendor, เอกสารทางบัญชี หรือ side effect อื่น ต้องแยกการบันทึก source draft ออกจาก side effect นั้น คงการแก้ตัวเลข/ภาษีตาม validator เดิมโดยไม่สร้างสิทธิ์ภาษีจากการอ่าน

## 5. โควตาและต้นทุน

### 5.1 หน่วยและเวลา

- 3 เอกสารต่อบริษัทต่อเดือนปฏิทิน Asia/Bangkok เริ่มรอบใหม่วันที่ 1 เวลา 00:00 ไม่สะสม ไม่เริ่มรอบใหม่เมื่อล็อกอินหรือเปลี่ยนสาขา
- หนึ่งเอกสารธุรกิจที่ส่งเป็นหนึ่งไฟล์และบันทึกผลใช้งานได้ = 1 ใบ; provider chunks/หน้าของเอกสารเดียว/retry ภายใน job ไม่เพิ่มจำนวน
- บิลกับสลิปเป็นคนละเอกสาร อ่านทั้งสองนับ 2 แม้ผูกเป็นรายจ่ายเดียวกัน
- รอบแรกไม่เปิดการแยกหลายเอกสารธุรกิจในไฟล์เดียวให้ร้านฟรี: ใช้ classification เดิมตรวจแล้วให้ส่งแยกเอกสาร ไม่ auto-split เป็นหลายร่างด้วย admission เดียว และไม่สร้าง batch split service ใหม่
- ขนาดไฟล์ ประเภทไฟล์ จำนวนหน้า และเพดาน provider calls ยึดข้อจำกัดเดิม; quota 3 ไม่ใช่สิทธิ์อัปโหลด PDF ขนาดไม่จำกัด
- ไม่สัญญาว่ารูปคล้ายกันจะ deduplicate ได้เอง; ต้องใช้ operation/document identity ที่พิสูจน์ได้ ไม่เทียบชื่อร้าน/ยอดแล้วรวมธุรกรรมคนละรายการ

### 5.2 การนับและความพร้อมกัน

ใช้ admission/reservation/refund เดิมร่วมกันทุก entry point:
1. จองก่อนเรียก provider ภายใต้ company/month lock; used + in-flight ต้องไม่เกิน 3
2. “อ่านสำเร็จ” ต้องมี usable result ที่ persist แล้ว; ไม่ใช่ HTTP 200 จาก provider อย่างเดียว
3. ล้มเหลวก่อน usable result คืนสิทธิ์ตาม operation เดิมครั้งเดียว; ค่า provider ที่เกิดขึ้นยังบันทึกจริง
4. usable result แล้วแต่ LINE ส่งตอบไม่สำเร็จ: ยังคงใช้ 1 ใบ ส่งผลเดิมซ้ำ ไม่อ่านใหม่ ไม่สร้างร่างเพิ่ม
5. ไม่คืนสิทธิ์เพราะผู้ใช้ลบร่างหลังอ่านสำเร็จ; ไม่ reset usage เมื่อซื้อแพ็กเกจ
6. การแก้ข้อความ/ตัวเลขด้วยมือ การเปิดภาพเดิม และ retry ส่ง notification ไม่คิดเป็นการอ่าน
7. request ข้ามเดือนยึดเดือนที่จองครั้งแรกจนงานจบ; refund ใช้เดือน/source เดิม; งานใหม่เดือนใหม่ใช้รอบใหม่
8. เมื่อมีงานกำลังอ่านครบจำนวนที่เหลือ ให้ตอบ “กำลังอ่านเอกสารก่อนหน้า” จนรู้ผล ไม่อ้างว่าอ่านฟรีสำเร็จครบ 3 แล้ว
9. retry หลังปฏิเสธ quota ไม่ทำงานเองเมื่อถึงเดือนหน้า ต้องมีการเริ่มอ่านใหม่จากผู้ใช้
10. legacy shadow enforcement ห้ามทำให้กลุ่มฟรีอ่านเกิน 3; paid/trial policy เดิมไม่ถูกเปลี่ยนโดยอ้อม

เก็บแหล่งสิทธิ์ FREE_MONTHLY_3 ไว้กับ admission ที่จองจริง เพื่อไม่รวม trial/gift/paid events หรือคืนสิทธิ์ผิดกองเมื่อมีการซื้อระหว่างงาน กรณี quota snapshot โหลดไม่ได้ห้าม fallback เป็น 0 used หรือ 3 remaining

### 5.3 AI budget และ abuse

จำนวนใบฟรีและเงินที่ระบบจ่าย provider เป็นคนละข้อจำกัด ยังใช้ company OCR switch, operational count, rate limit, model policy, reservation, unknown-cost hold และ circuit breaker เดิม

- จำกัดแชตด้วย access policy ก่อน router ไม่ใช้เพียง CHAT cap = 0 เพราะยังอาจมี SHARED/default/override ทำให้เรียกได้
- เส้นทางอ่านเอกสารที่อนุญาตต้องใช้ OCR budget envelope ทั้งการจำแนกและการอ่าน; ห้าม fallback ไป paid chat เพื่อแต่งข้อความ
- ตรวจค่า default ที่มีอยู่ผ่าน resolver เดิมก่อน provisioning; ห้ามสร้างเครดิตแชต 80 บาท/Trial budget เพื่อให้ OCR ทำงาน
- ไม่มีตัวเลขงบใหม่ที่อนุมัติในงานนี้ ใช้ effective OCR budget เดิมผ่าน governed writer โดยไม่ทับ Admin override; ถ้าทำงานครบ 3 เอกสารใน fixture ปกติไม่ได้ เป็น readiness blocker ก่อนเปิด cohort
- unreadable/non-expense/multi-document failures คืนจำนวนเมื่อไม่มี usable result แต่ยังอยู่ใต้ rate/cost brakes; ไม่วน retry ฟรีไม่จำกัด
- สถานะงบปิด/ไม่พอ/ตรวจไม่ได้ ไม่ใช้ข้อความ “อ่านฟรีครบ 3 ใบ” ถ้าไม่ครบจริง และไม่สัญญาว่าซื้อแล้วจะแก้ outage ได้

### 5.4 เมื่อครบและการเก็บไฟล์

ใบที่ 1–2 ตอบผลตามปกติ; ใบที่ 3 ที่ commit สำเร็จตอบผลและแนบท้ายแจ้งครบสั้น ๆ ครั้งเดียว ไม่มี push แจ้งครบแยกหรือแจ้งเมื่อต้นเดือน

ใบถัดไป: ไม่เรียก provider และไม่สร้างร่างใหม่/คลัง pending ไม่จำกัด แสดงสถานะไฟล์ตามสิ่งที่เก็บได้จริง:
- ยังไม่มีไฟล์ durable: “ยังไม่ได้อ่านและบันทึกเอกสารนี้”
- transport/storage เก็บต้นฉบับไว้แล้ว: “รับไฟล์ไว้แล้ว แต่ยังไม่ได้อ่านหรือสร้างร่าง” พร้อมทางเปิดเฉพาะเมื่อมีสิทธิ์และลิงก์ที่ใช้งานได้
- มีร่าง/ผลเดิมอยู่แล้ว: ให้เปิดฉบับเดิม ไม่บอกว่าไม่มีรายการ

temporary bytes และไฟล์ที่รับระหว่าง race ใช้ retention/cleanup เดิม ไม่เก็บข้อมูลไม่มีเจ้าของ ไม่ลบหลักฐาน/ร่างเดิมเมื่อหมดโควตา ข้อความครบอิง successful count หลัง commit; marker แยก free/month/source จาก trial/paid notices และ retry delivery ได้โดยไม่ส่งซ้ำ

## 6. คำสั่ง LINE ที่ไม่ใช้โมเดล

ใช้ handler เดิมที่ผ่านการตรวจว่าทั้งเส้นทางไม่มี AI call เท่านั้น ไม่สร้าง natural-language router ใหม่

| กลุ่ม | การตัดสิน |
| --- | --- |
| ติดต่อเรา/เจ้าหน้าที่/กลับจาก support pause | public/support route เดิม; resume ไม่เพิ่มสิทธิ์แชต |
| เลือกร้าน/สาขาหรือคำตอบตัวเลขใน picker ที่ยังเปิด | ต้องผูก pending context + actor + company + revision; เลขลอยไม่ใช่คำสั่ง |
| เปิดรายการ/ร่าง/ดูสิทธิ์ที่มี handler อยู่แล้ว | permission-checked read และข้อความ template ไม่มีโมเดล |
| ดูบริการ/วิธีใช้แบบ card ที่เตรียมไว้ | แสดงเฉพาะความสามารถที่ทำได้จริง; ไม่รวมคำถามธุรกิจปลายเปิด |
| ปุ่มยืนยัน/ยกเลิก preview การแก้ผ่าน LINE ที่ค้างจากสิทธิ์เดิม | ไม่ใช้ preview เดิมข้ามเข้าโหมดฟรี; แก้และเก็บข้อเท็จจริงผ่านหน้าร่างในเว็บ คำว่า “ยืนยัน” ไม่เปิด action อื่น |
| prepared simple read / formatter deterministic แต่ใช้ AI เตรียม intent | ไม่ถือว่าฟรี |
| ข้อความทั่วไป/คำสั่งผสม/voice/transcription/semantic correction | ปฏิเสธก่อน intent model, embedding, planner, composer หรือ advisor |
| รูปพร้อม caption | เข้า expense document lane ได้เมื่อยืนยันขอบเขตได้; caption เป็นข้อมูลเอกสาร ไม่เปิดคำสั่งแชต/คำสั่งการเงินที่แฝงมา |

ข้อความพิมพ์ไม่ได้ถูกปฏิเสธทั้งหมด: alias ที่ตรง command เดิมและ context ที่ถูกต้องทำงานได้ แต่ห้ามใช้ broad keyword เช่น “รายการ”, “แก้”, “ยืนยัน” แล้วปล่อยทั้งข้อความเข้า model/tool

Guard ต้องครอบ text entry, image/file entry, message buffer, pending answers, draft continuation, retry/recovery, gateway client และ internal worker ไม่อาศัยข้อความใน prompt ให้โมเดลปฏิเสธเอง

## 7. ลำดับและการชนกันของ guard

เป็นลำดับเชิงเหตุผล; public/support routes รักษาตำแหน่งเดิมตาม contract ไม่ย้ายทุกอย่างเข้า generic guard เดียว ทุก action ยังตรวจสิทธิ์ที่ boundary จริง

| ลำดับ | เงื่อนไข | ผล |
| --- | --- | --- |
| G01 | webhook/session ไม่ถูกต้อง, replay, rate/abuse | ใช้ verification/idempotency/rate contract เดิม; replay ไม่ส่ง refusal ซ้ำ |
| G02 | public command / support routing / assistant pause | คำสั่งติดต่อและ resume ยังเข้าได้; ข้อความถึงเจ้าหน้าที่เข้าสู่เคสเดิม |
| G03 | identity/เปิดร้าน/สมาชิก/เลือกร้าน/สาขา | ระบุสถานะหรือขอเลือก ไม่ตัดสิน quota ของร้านอื่น |
| G04 | opt-out, legal acceptance, platform closure, admin hold/security/archive | รักษาคำตอบและการหยุดเดิม; สิทธิ์ฟรีไม่ข้ามเหตุเหล่านี้ |
| G05 | feature launch/feature override/permission/record scope/source state | ตอบข้อจำกัดจริง; no-model ไม่ข้าม final-mutation หรือ readonly guard |
| G06 | effective commercial mode และประวัติการซื้อ | FREE_EXPENSE_DRAFTS เฉพาะ §3; paid/expired/unknown ไม่ติดข้อความใช้ฟรี |
| G07 | คำสั่งพื้นฐานที่อนุญาต | ทำงานตาม handler โดยไม่เรียก AI; บาง handler เดิมอยู่ก่อน AI closure ก็รักษาขอบเขตนั้น |
| G08 | free text ต้องใช้โมเดล | FREE_CHAT_NOT_INCLUDED ก่อน provider/money reservation |
| G09 | free document lane | ตรวจ format/source/scope + OCR policy + จอง quota/ต้นทุน; ใช้เหตุที่พิสูจน์ได้ |
| G10 | apply/delivery/recovery | ตรวจสิทธิ์ สถานะ source version และ policy ใหม่ก่อนเขียน/ส่ง; ไม่ตอบสำเร็จจากแค่ provider |

เงื่อนไขชนกันที่ต้องคง:
- ฟรี + SUSPENDED/Admin disable: ตอบสถานะการระงับ ไม่เสนอแพ็กเกจเป็นทางปลด
- ฟรี + support pause: ข้อความถึงคนไม่ถูกนับเป็น free chat refusal; media ยังเคารพ pause เดิม
- ฟรี + OCR ปิด/ระบบอ่านปิด: ตอบการปิดบริการ ไม่เปลี่ยนเป็นครบ 3
- ฟรี + คำสั่งอนุมัติ/จ่าย/ลงบัญชี: ใช้ final-action boundary เดิม ไม่บอกว่าซื้อแล้วน้องมั่งมีจะทำให้ได้
- paid + credits หมด: คง credit reason; ไม่ fallback ฟรี
- paid + หมดอายุ: คง recovery เดิม; ไม่ใช้คำว่า “ใช้ฟรีเดือนละ 3”
- ตรวจประวัติ/สิทธิ์/โควตาไม่ได้: unavailable ตามสิ่งที่ขาด ไม่เดาว่าฟรีหรือหมด
- free + รุ่นสัญญาใหม่ยังไม่ยอมรับ: legal gate ตามเดิม; การซื้อไม่ใช้แทน acceptance
- job ค้างข้ามการเปลี่ยนสิทธิ์/ซื้อแพ็กเกจ: revalidate ก่อน provider/apply; ไม่ขยาย action, ไม่ charge ทั้งสองกอง, ไม่ทิ้งผลที่ commit แล้ว

กรณีหลาย guard มีผลพร้อมกัน ให้คง precedence เดิมของ safety/support/permission และตรวจ primary reason ที่มีหลักฐาน อย่าเพิ่ม blanket catch(error) → FREE_CHAT_NOT_INCLUDED

## 8. ข้อความและ UI ที่ผู้ใช้ต้องเข้าใจ

ใช้ “ร่าง”, “อ่านเอกสาร”, “สิทธิ์อ่านฟรี”, “เปิดดูรายการ” ในข้อความลูกค้า; ไม่ใช้ draft, OCR, quota, guard, entitlement, token, exception หรือ error code

ข้อความตัวอย่างเป็น template ส่วนแกน; ส่วนท้ายและปุ่มเลือกจากสิทธิ์ สถานะจริง และปลายทางที่เปิดได้

| Copy ID | เหตุ/เงื่อนไข | ข้อความ |
| --- | --- | --- |
| C01 | อ่านสำเร็จและ persist ร่าง | อ่านเอกสารแล้วค่ะ เก็บเป็นร่างแล้ว ยังไม่ได้ยืนยันรายการ |
| C02 | ใบที่ 3 สำเร็จ | เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ เริ่มอ่านฟรีรอบใหม่ได้วันที่ {resetDate} |
| C03 | ใบเพิ่มหลังครบ; ไม่มี durable file/draft | เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้วค่ะ จึงยังไม่ได้อ่านและบันทึกเอกสารนี้ เริ่มอ่านฟรีรอบใหม่ได้วันที่ {resetDate} |
| C04 | ครบ แต่รับไฟล์ durable แล้ว ไม่มีร่าง | รับไฟล์ไว้แล้วค่ะ แต่เดือนนี้ใช้สิทธิ์อ่านฟรีครบ 3 ใบแล้ว จึงยังไม่ได้อ่านหรือสร้างร่างจากไฟล์นี้ |
| C05 | free chat request | สิทธิ์ใช้ฟรีของร้านยังไม่รวมการถามตอบกับน้องมั่งมีค่ะ |
| C06 | ต้องใช้ AI ตีความการแก้ แต่เปิดร่างบนเว็บได้ | การแก้ข้อมูลผ่านข้อความยังไม่รวมในสิทธิ์ใช้ฟรีค่ะ เปิดรายการแล้วแก้ข้อมูลในเว็บได้ |
| C07 | มี in-flight ใช้ที่ว่างอยู่ | กำลังอ่านเอกสารที่ส่งก่อนหน้าอยู่ค่ะ เมื่อทราบผลแล้วจึงตรวจสิทธิ์อ่านใบนี้ได้ |
| C08 | อ่านล้มเหลวและคืนสิทธิ์สำเร็จ | อ่านข้อมูลจากเอกสารนี้ไม่สำเร็จค่ะ ครั้งนี้ไม่หักสิทธิ์อ่านฟรี |
| C09 | ผลอ่านบันทึกแล้ว/กำลังส่งซ้ำ | เก็บร่างจากเอกสารนี้ไว้แล้วค่ะ เปิดดูรายการเดิมได้ |
| C10 | ตรวจสิทธิ์ไม่ได้ | ตอนนี้ยังตรวจสอบสิทธิ์อ่านเอกสารของร้านไม่ได้ค่ะ กรุณาลองอีกครั้ง |
| C11 | unsupported multi-document file | ไฟล์นี้มีหลายเอกสารค่ะ สำหรับสิทธิ์ใช้ฟรี กรุณาแยกส่งเอกสารละไฟล์ |
| C12 | action เว็บเกิน draft scope | สิทธิ์ใช้ฟรีรองรับการดูและเก็บร่างรายจ่ายค่ะ ขั้นตอนนี้ต้องใช้แพ็กเกจที่รองรับและสิทธิ์ของผู้ใช้งาน |

กติกาคำ:
1. C02/C03 ใส่วันเริ่มรอบใหม่ที่คำนวณจาก server และแสดงรูปแบบวันที่ของเว็บเดิม ไม่ hardcode “เดือนหน้า” จาก device time
2. ต่อท้าย “ยังเปิดดูและแก้ไขร่างเดิมได้ตามปกติ” เฉพาะเมื่อ actor ยังมีสิทธิ์นั้น; ถ้าอ่านได้อย่างเดียว ให้บอกเฉพาะเปิดดู
3. C05 ไม่บอกว่าเครดิตหมด/ยังไม่สมัคร/ต้องเปิดร้าน เพราะร้านนี้เปิดแล้ว; ไม่รับปากว่าส่งเอกสารได้ถ้า quota/feature ปิดอยู่
4. C06 ใช้เฉพาะเมื่อจับ action ได้โดยไม่ใช้โมเดล; จับไม่ได้ใช้ C05 ไม่เดาเจตนาจากคำเดียว
5. C07 ไม่บอกว่าจะรับหรืออ่านใบนี้อัตโนมัติ; มีปุ่มอ่านใหม่ได้เฉพาะ source ถูกเก็บและ retry path รองรับ
6. C08 ใช้เมื่อผล release ยืนยันแล้ว; ถ้ายังไม่ชัด บอกกำลังตรวจสอบผล ไม่อ้างว่าไม่หัก
7. C09 “เก็บแล้ว” ต้องมี durable result; notification ล้มเหลวไม่เปลี่ยนเป็น “ส่งใหม่”
8. C11 ต่อท้ายสถานะไฟล์/ร่างและการคืนสิทธิ์ตามจริง; ไม่อ้าง refund ก่อนสำเร็จ
9. C12 ไม่ใช้กับ suspension, unsupported feature, final financial action ใน LINE หรือการไม่มี permission; การซื้อไม่ใช่ทางแก้ทุกเหตุ
10. คงข้อความเฉพาะของ guard เดิมที่ตรวจแล้ว ไม่เปลี่ยน global formatter จน paid customer เห็นคำฟรี
11. ก่อนครบไม่แสดงคำชวนซื้อ โปรโมชั่น countdown หรือปุ่มรับฟรี; หน้าแพ็กเกจและการดูสิทธิ์โดยผู้ใช้ยังเข้าได้ตามปกติ
12. เมื่อครบหรือผู้ใช้ขอดูแพ็กเกจ เสนอปุ่มกลาง “ดูแพ็กเกจ” เฉพาะ OWNER/ผู้มีสิทธิ์ปลายทาง; สมาชิกอื่นใช้ “ติดต่อเจ้าของกิจการ” (ชื่อบทบาทจาก contracts; 2026-11-05) เมื่อเกี่ยวข้อง ไม่ส่ง billing deep link ที่เปิดไม่ได้
13. refusal แชตใช้ข้อความสั้น ไม่มีปุ่มขายแทรกอัตโนมัติ; คำสั่งดูแพ็กเกจที่ผู้ใช้เลือกเองยังทำงาน
14. ไม่ push แจ้งต้นเดือน/ชวนกลับมา/แจ้งซื้อใหม่; ไม่แสดงตัวนับ 1/3, 2/3 ท้ายทุกคำตอบ การเปิดหน้าดูสิทธิ์เองแสดงได้
15. ทั้ง Flex, plain-text fallback, web toast/banner, read-status, support console และ billing projection ใช้ reason/source เดียวกัน แม้ถ้อยคำสั้นยาวต่างกัน

หน้าเว็บ:
- เพิ่มทางเข้ารายจ่ายใน shell เดิมเฉพาะ mode ฟรี โดย route เดิมและชื่อที่ระบบใช้ ไม่เพิ่ม landing page โปรโมชั่น
- หน้าแก้ร่างแสดง “เก็บร่าง” ชัดเจน; ไม่พาเข้าขั้นส่งตรวจ/ยืนยันหรือบังคับข้อมูลที่ใช้เฉพาะขั้นนั้น
- โหลดสิทธิ์: แสดงกำลังโหลด ไม่กะพริบเมนู paid; โหลดไม่ได้: แสดงลองใหม่ ไม่ตีความเป็นหมดโควตา
- บันทึกกำลังทำ/สำเร็จ/ผิดพลาด/stale revision ต้องรักษาข้อมูลที่กรอก; reload แสดงค่าที่ persist จริง
- สิทธิ์ถูกถอนระหว่างเปิดหน้า: ปิด mutation ตาม response ไม่แสดงสำเร็จปลอม ไม่เปิดภาพด้วย URL ข้ามบริษัท
- deep link จาก LINE หลัง login/เลือกบริษัท/acceptance ต้องกลับร่างเดิม; ค่า expired notice ไม่ redirect ร้านฟรีวนไป billing
- รายจ่ายเดิมที่ปิดงานแล้วไม่ย้อนเป็นร่าง และสิทธิ์ฟรีไม่แก้ข้อมูลการเงินของรายการนั้น

## 9. Architecture, contracts และข้อมูล

### 9.1 Effective access

ให้ API ฝั่ง ERP เป็นเจ้าของ policy projection เดียว อาศัย billing purchase evidence + lifecycle + term + entitlements + permissions:
- commercial mode แยกจาก tier/status: FREE_EXPENSE_DRAFTS, EXISTING_ACCESS, PACKAGE_LOCKED, UNAVAILABLE (ชื่อ implementation ปรับได้โดย semantics ต้องครบ)
- ข้อมูลที่ client ต้องได้: source/version, ความสามารถอ่าน/สร้างร่างจากเอกสาร/แก้ source facts, read allowance limit/used/inFlight/remaining/resetAt และ allowed actions ของ actor/record
- mode ฟรีไม่ได้ทำให้ Company.status ACTIVE อัตโนมัติ ไม่ต่อ term ปลอม ไม่เขียน FREE_TRIAL_15 ใหม่ ไม่ล้าง admin hold
- free capability ต้องเพิ่มจาก policy เฉพาะ action ที่ระบุ แล้ว intersect กับ permission และ explicit Admin deny; ไม่เปิด ai_line_assistant ทั้งก้อนเพื่อให้อ่านเอกสาร และไม่เขียนทับ feature override เดิม
- แยกการผ่าน term-only lock ของ action ฟรีออกจาก allowTermRecovery ซึ่งปัจจุบันใช้กู้คืน billing; ไม่ allowlist /expenses/* ทั้ง prefix
- ตรวจเฉพาะ method + route + action + source state และใช้ use-case guard ซ้ำเพื่อครอบ internal tools/workers
- default=false/unknown สำหรับ field ใหม่ใน mixed deployment; client เก่า/ข้อมูลไม่ครบไม่เปิดโมเดลหรือ financial mutation

คง AI Gateway แยกจาก ERP: Gateway รับ server-authenticated scope และใช้ permission-checked API/tool ไม่อ่าน repository เพื่อเช็กประวัติซื้อเอง requestId/allowanceSource/actor/company มาจาก server ไม่เชื่อ browser หรือ prompt

### 9.2 Reuse และ schema ขั้นต่ำ

- CompanyPlanTerm / verified billing history: ใช้ข้อมูลเดิมสำหรับ classification และซื้อจริง; ห้าม overwrite historical financial projection
- CompanyOcrUsageEvent: เพิ่ม `quotaSource = FREE_MONTHLY_3` และ `succeededAt` แบบ additive (null source = legacy เดิม), pin month และ identity เดิม; free successful/in-flight/compensated state ต้องโยงกับ durable job/result เดิมที่พิสูจน์ได้
- ถ้าต้องเก็บสถานะเพิ่มให้เพิ่มบน admission/job ที่มีอยู่ ไม่สร้าง usage ledger ใหม่ขนานสองชุด; failed compensation ยึด id เดิม
- quota snapshot อ่าน source เดียวกับ admission; เพิ่ม cadence/source ฟรีใน contract ที่ใช้ร่วมกันพร้อมไล่ exhaustive consumers ของ BillingReceiptUsage
- quota notice ใช้ `freeQuotaNoticeSentMonthKey` แยกจาก paid/trial marker; claim เฉพาะ success ครบ 3 ในเดือนปัจจุบัน คืน marker เมื่อส่งล้มเหลว และใช้ผลเดิมตอนส่งซ้ำ
- ExpenseRecord/capture source provenance: ระบุว่าเกิดจากสิทธิ์ฟรีโดยไม่เปลี่ยน expense status; ไม่ต้อง clone/migrate ร่างเมื่อจ่าย
- index/constraint ต้องรองรับ company + source + month และ uniqueness operation เดิม; null legacy rows ไม่ถูกนับเป็นฟรีอัตโนมัติ
- rollback code รักษา provenance/usage ที่เขียนแล้ว; ไม่ drop column/ลบเอกสารเพื่อย้อน rollout

### 9.3 ซื้อแพ็กเกจและงานค้าง

- ซื้อสำเร็จใช้ verified paid transition เดิม ไม่มี grant ก่อนจ่าย ไม่มี free trial forfeiture copy ที่อ้างว่า 3 ใบนี้เป็น trial
- ร่างและ attachment เดิมทำต่อได้ตาม effective rights ใหม่; ไม่สร้าง expense/payment ซ้ำ
- สิทธิ์ฟรีที่เหลือไม่แปลงเป็น paid grant/เงินคืน/ส่วนลด ไม่บวก 3 เข้า allowance ที่ซื้อ
- งานที่จองฟรีก่อนจ่ายยังใช้ source เดิมและตรวจ current actor/source state ก่อน apply; retry ไม่หัก paid ซ้ำ
- historical successful payment ทำให้ neverPurchased=false ถาวรตามหลักฐาน; หมดอายุภายหลังไม่กลับฟรี
- เข้า/ออก mode ต้อง invalidate session/permission projection ตาม pattern เดิม; client cache ไม่ใช่อำนาจยืนยัน
- sales attribution/deal/commission ไม่เกิดจากการเปิดสิทธิ์ฟรี; paid purchase เดิมยังเป็นหลักฐานตามสัญญาเดิม

## 10. Acceptance criteria

| ID | หลักฐานที่ต้องผ่าน |
| --- | --- |
| AC01 | ร้านใหม่และร้าน no_package เดิมที่ไม่เคยซื้อเข้าใช้ฟรี; pending signup ไม่ได้; ไม่มี opt-in/marketing |
| AC02 | เคยซื้อทุกแบบแล้วหมดอายุ/คืนเงิน/เปลี่ยน mode ไม่ได้ฟรี; source unknown ไม่ผ่าน |
| AC03 | trial/manual/grandfathered/paid ที่ใช้ได้คงสิทธิ์เดิม; admin hold/security ไม่ถูกเปิด |
| AC04 | เว็บและ LINE ทุกสมาชิก/สาขารวมกันอ่านสำเร็จได้ 3; แข่งอ่านที่ใบสุดท้ายไม่เกิน |
| AC05 | เดือน BKK, in-flight, ข้ามเดือน, replay/refund/delete ไม่ reset/หักซ้ำ/คืนผิด source |
| AC06 | source draft ดู/แก้/เก็บ/reload ได้เมื่อ quota หมด; stale/foreign branch/foreign actor ถูกปฏิเสธ |
| AC07 | final mutation, manual new entry, other module และ auto-post ถูกปิดทุก boundary แม้เรียก API ตรง |
| AC08 | deterministic allowlist ทั้งเส้นทางมี provider calls = 0; typing supported alias ยังทำงาน |
| AC09 | free chat/semantic edit/voice/mixed intent มี provider calls = 0 รวม router/composer/fallback/recovery |
| AC10 | free document ใช้ OCR cost/operational guards จริง; ไม่มี free chat จาก caption หรือ PDF |
| AC11 | guard collision matrix §7 ให้ primary reason ถูกต้อง; public/support commands ไม่ถูกกลืน |
| AC12 | success 1–2 ไม่มี upsell/counter; ใบที่ 3 แจ้งครบหลัง commit ครั้งเดียว; blocked request ไม่อ้างสำเร็จ |
| AC13 | failure/unknown delivery/file saved/no file/in-flight ใช้ copy ตรงหลักฐานและสิทธิ์ |
| AC14 | paid purchase ระหว่างงาน/race/replay ได้ paid grant ครั้งเดียว ร่างเดิมอยู่ ฟรีไม่กลับหลัง expiry |
| AC15 | web desktop/mobile + LINE Flex/text fallback/deep link เป็น journey ที่ใช้ได้จริง พร้อม loading/error/permission |
| AC16 | frozen paid/trial/admin quota/credit/billing recovery/financial routes ผ่าน regression ที่เกี่ยวข้อง |
| AC17 | existing unpaid rollout/rollback/sweep/old session/recover worker ไม่ทำให้ full unlock หรือข้อมูลสูญหาย |
| AC18 | multi-document file ไม่สร้างหลายร่างในหนึ่งสิทธิ์; unsupported/failure คุม cost และแสดงสถานะจริง |
| AC19 | source/permission/policy recheck ก่อน worker apply และก่อนส่งข้อมูลกลับ; revoke ระหว่างงานไม่รั่ว |
| AC20 | ไม่มี claim ว่าส่งมอบ live จน protocol deploy และ customer OPEN acceptance ผ่านในงาน deploy ที่ได้รับอนุญาต |

## 11. สถานะพร้อมทำงานและข้อจำกัด

มติ product ได้รับครบและมี implementation ใน working tree แล้ว: exact action access, source-only writer, quota และ atomic completion, worker revalidation, LINE no-model gate, copy, เว็บและ login/handoff ใช้ projection เดียวกัน มี migration แบบ additive และทดสอบบน PostgreSQL local ที่แยกไว้ รายละเอียดคำสั่งและผลอยู่ใน [memory](../agent-memory/free-expense-drafts.md) และ [หลักฐาน](../evidence/free-expense-drafts-2026-10-28/verification.json)

ยังไม่ได้ทดสอบ browser desktop/mobile ด้วยบัญชี fixture ร้านฟรีจริง, native LINE, provider จริง หรือ UAT/Production ไม่มีการเปลี่ยน live gate ข้อจำกัดเหล่านี้ต้องผ่านก่อนรับรอง live journey ตาม protocol; ห้ามถือผล unit/PG ว่าเป็นผลเปิดบริการแล้ว

รายละเอียด implementation: pending source uploads ถูกจำกัด 3 ไฟล์ในช่วง retention 24 ชั่วโมงเดิม; ใช้ไฟล์เดิม retry ได้ ไม่เพิ่มกองไฟล์ไม่จำกัดเมื่ออ่านไม่ได้ ส่วน LINE image ที่จอง OCR ก่อนเก็บไฟล์ต้องส่ง reservation แบบ server-only ที่ผูก company/message/event/month ไปด้วย จึงไม่ปฏิเสธใบที่ 3 เพราะนับ reservation ของตัวเอง
