# Spec: ส่วนลดจากเซลล์ — สะสมและเลือกใช้หนึ่งรายการต่อบิล

ปรับล่าสุด 2026-09-29 · **DRAFT — มติล่าสุดอยู่ในเอกสาร; เดโมเดิมยังไม่ตรงแพตเทิร์นใหม่นี้**
[Plan](../plans/sales-event-discounts-plan-th.md) · [Memory](../agent-memory/sales-event-discounts-2026-09-28.md)

[E2E impact / bug / gap และ dependency audit](../research/sales-event-discounts-e2e-impact-audit-2026-09-29-th.md) เป็นรายการช่องว่างที่ต้องปิดก่อน implementation acceptance. ภาพ ChatGPT เป็น reference ของโครงรายการ/แท็บเท่านั้น ไม่ยกสี ฟอนต์ หรือกติกาวันหมดอายุมาด้วย.

## 1. มติล่าสุดและขอบเขต

หัวหน้าเซลล์สร้างชุด → เซลล์แจก QR → ลูกค้า **รับส่วนลดเก็บสะสม** → **เลือกใช้หนึ่งรายการ** → ระบบลดรายการที่กำลังซื้อหรือบิลต่ออายุถัดไปให้อัตโนมัติ. มติล่าสุดเรื่องรับหลายรายการแทนที่คำสั่งก่อนหน้าที่รับแล้ว apply ทันที: การรับไม่เลือกใช้ให้ ไม่ตัดเงิน และไม่กินสิทธิ์หนึ่งบิล. ไม่มี FIFO อัตโนมัติ ไม่มีการรวมส่วนลดหลายรายการ.

| สถานการณ์เมื่อเลือกใช้ | ผลที่ลูกค้าเห็น | ใช้สิทธิ์สำเร็จเมื่อ |
|---|---|---|
| กำลังเลือกแพ็ก/ดูยอด ยังไม่เริ่มชำระ | ยอดรายการนี้ลดทันที → ยืนยันชำระตามปกติ | ยืนยันรับเงินจริงของรายการนี้ |
| มี subscription รายเดือน ไม่มีการซื้อใหม่ | “จะลดบิลวันที่ …” ของรอบรายเดือนถัดไป | ยืนยันรับเงินจริงของบิลรอบนั้น |
| มี subscription รายปี ไม่มีการซื้อใหม่ | “จะลดบิลวันที่ …” ของรอบรายปีถัดไป | ยืนยันรับเงินจริงของบิลรอบนั้น |
| ยังไม่เลือกแพ็ก/ไม่มี subscription | ส่วนลดรอการซื้อครั้งถัดไปที่รองรับ | จ่ายการซื้อเต็มแพ็กครั้งแรก |
| สมัครใหม่ รอเปิดร้าน | ใช้หน้าสมัครและสถานะเดิม; เข้าร้านได้แล้วจึงรับส่วนลดในหน้าแพ็กเกจ | กดรับที่หน้าแพ็กเกจ แล้วเลือกใช้และจ่ายสำเร็จ |
| มีรายการ accepted/processing/UNKNOWN | รับสะสมได้ แต่เปลี่ยนส่วนลดในรายการที่เริ่มแล้วไม่ได้; รอผลก่อนเลือกใช้กับรายการใหม่ | ไม่แก้ยอด invoice ย้อนหลัง |

หนึ่งสิทธิ์ส่วนลดใช้ได้กับหนึ่งบิล และหนึ่งบิลใช้ได้ไม่เกินหนึ่งรายการ. ต่อบริษัท/Billing account มี selection ที่ยังทำงานได้ไม่เกินหนึ่งรายการ แม้เป้าหมายต่างรอบกัน. ปุ่มก่อนเลือกเป็น **“เลือก”**; กดสำเร็จแล้วเป็น **“ใช้ส่วนลด”** พร้อมสถานะ selected และปุ่มรายการอื่น disabled. กดปุ่ม “ใช้ส่วนลด” ของรายการเดิมซ้ำเพื่อยกเลิก; เมื่อยกเลิกสำเร็จจึงเลือกรายการใหม่ได้. ไม่สลับทับรายการเดิมโดยตรง ไม่มีกดครั้งที่สองเพื่อเริ่มจ่าย. ปุ่มนี้เป็น toggle ของการเลือก; การชำระเงินจริงยังผ่าน consent/Checkout เดิม. รายการที่ไม่ได้เลือกไม่ถูกใช้ ไม่ FIFO; บิลหลังใช้แล้วกลับราคาเต็มจนมีการเลือกใหม่.

ไม่เปลี่ยนวันตัดรอบ ระยะเวลาแพ็ก วิธีชำระ หรือสร้าง subscription จากการรับ/เลือกส่วนลด. รายปีลดบิลต่ออายุปีถัดไป ไม่หารรายเดือน/คืนบิลที่จ่ายแล้ว. วันปิดรับใช้กับ issuance เท่านั้น: รับทันแล้วเก็บไว้/เลือกให้บิลปีหน้าได้. แบบใหม่นี้ไม่มี fixed/received/ready expiry, hard stop หรือการขยายอายุหลังรับ.

ขอบเขตครั้งนี้ปรับ spec+plan และตรวจโค้ด/ผลกระทบตลอด flow; ไม่แก้ production app หรือเดโมในรอบนี้. ไม่มี customer referral/rewards; attribution เดิมคงเดิม. ตัวเลขในเดโมเดิมไม่ใช่ราคาที่อนุมัติขายแล้ว. คำที่แสดงต่อผู้ใช้ทุกบทบาทใช้ “ส่วนลด / ชุดส่วนลด / รับส่วนลด” ไม่ใช้คำว่า “ตั๋ว”; ชื่อ technical เช่น SalesDiscountTicket และเส้นทางไฟล์เดิมคงไว้ได้ ไม่ต้อง rename schema เพียงเพื่อ copy.

## 2. Journey และสิทธิ์

1. หัวหน้า Sales/SYSTEM_ADMIN เริ่มงานว่าง กรอกชื่องาน/ชุดเป็น text เลือกเซลล์ ตั้งเงิน/จำนวน/กลุ่ม/สินค้า/ช่วงรับ แล้ว “ยืนยันและเปิดแจกส่วนลด”. ไม่มี input ขั้นต่ำหลัง VAT หรือปุ่มเพิ่มชุดอีกชุดในฟอร์ม.
2. Sales ที่ได้รับมอบหมายเปิด QR ไปหน้าแพ็กเกจของร้าน พร้อมบริบทสิทธิ์จากเซลล์. หากยังไม่ login/ยังไม่มีร้าน ใช้หน้าสมัครและขั้นตอนเปิดร้านเดิมทั้งหมด; ไม่เพิ่มฟอร์ม/ช่อง/ปุ่มรับส่วนลดในหน้าสมัคร.
3. หน้า “แพ็กเกจและการชำระเงิน” วาง section **“ส่วนลด” ก่อนเนื้อหาแพ็กเกจ**. มีรายการที่รับได้จาก QR และรายการที่รับเก็บไว้แล้ว. กด “รับส่วนลด” เพิ่มเข้า collection ในหน้าเดิม; ไม่เลือกใช้/เปลี่ยนยอดให้เอง. Replay คืนรายการเดิม; รับเพิ่มต้อง explicit intent.
4. กด “เลือก” ได้ก่อนเลือกแพ็กหรือขณะดู quote/subscription. Server บันทึก selection แล้วแสดงปุ่ม “ใช้ส่วนลด”; ปิดปุ่มรายการอื่นทั้งหมด. แสดงบิล/วันที่/ราคาเต็ม/ส่วนลด/VAT/ยอดใหม่. กดรายการเดิมซ้ำจึงยกเลิกก่อนเปลี่ยนรายการ; ดูรายละเอียดหรือรับเพิ่มยังทำได้.
5. ซื้อทันทีใช้ consent/Checkout เดิม. Monthly/annual เรียกเก็บตามรอบเดิมโดยลดบิลที่เลือกอัตโนมัติ ไม่ต้องกลับมากดซ้ำ. QR ลดบิลให้แต่ลูกค้ายังต้องจ่ายตามปกติ.
6. Verified paid → USED; activation แยก. Sales/head ดูเก็บไว้/เลือกไว้/กำลังจ่าย/ใช้แล้วและเงินจริง/คืนแยก.

Customer ต้อง active membership + company.plan.manage ผ่าน Billing assertOwner เดิม. Agent ผ่าน platform tenant guard + active assignment + own ticket scope; head ใช้ sales.event.manage, report ข้าม agent ใช้ sales.report.read. เพิ่ม registry/grants ตามรูปแบบเดิม ไม่ hard-code OWNER. การรับและการเลือกใช้ต้อง revalidate company/source/terms/revision; claim acknowledgment แยก use acknowledgment/target intent; browser ส่งยอด/agentId ไม่ใช่ authority.

BillingPage.tsx และ billing-profile-navigation.ts เป็นจุดต่อ frontend เดิม. ทั้งรับ/สะสม/เลือกใช้ส่วนลดอยู่ในหน้าแพ็กเกจของบริษัทเดียวกันกับการซื้อและต่ออายุ. Header ใช้บริบทบริษัทปัจจุบัน ไม่ถามชื่อบริษัทที่จะสมัครซ้ำ. เลือกใช้/เปลี่ยน/เอาส่วนลดออกก่อน Checkout → invalidate quote เก่า/consent ใหม่; refresh/กลับจาก billing profile/เปลี่ยนอุปกรณ์คง server selection. Company switch ไม่ย้ายส่วนลดหรือรายการชำระข้ามบริษัท.

ยึด BillingPage/BillingCustomerFrame/MangmeePage จริง: คงหัวข้อ/คำอธิบาย, แท็บ “แพ็กเกจ / การต่ออายุและชำระเงิน / ประวัติ”, การ์ดแพ็กเกจปัจจุบันและช่องทางช่วยเหลือ. ในแท็บแพ็กเกจ วาง section ส่วนลดก่อนทั้งการ์ดแพ็กเกจปัจจุบัน, catalog/deal และขั้นยืนยันซื้อ; ต้องอยู่นอกเงื่อนไข showOverview เพื่อไม่หายตอน choosing/quote/capacity. แท็บต่ออายุวาง section เดียวกันก่อนบิลถัดไปและอ่าน selection ชุดเดียวกัน; แท็บประวัติชำระเงินคงเดิม ไม่สร้าง selection อีกชุด. ซื้อใหม่ยังผ่านเลือกแพ็ก→capacity/profile/email checks→quote/consent เดิม. ไม่แสดงฟอร์มเลือกบริษัทหรือสมัครซ้ำในเนื้อหา Billing.

หน้าสมัคร/ข้อมูลที่กรอก/ปุ่มส่งคำขอ/หน้ารออนุมัติคงเดิม. ก่อนมีบริษัทและ active membership ไม่สร้าง ticket ไม่กัน quota ไม่ทำ signup-ticket binding. เมื่อเข้าร้านได้แล้วจึงกลับ Billing ด้วย safe return context และตรวจสิทธิ์/QR/window/assignment ปัจจุบันก่อนกดรับ. Context ที่พกมาคือความตั้งใจดูส่วนลด ไม่ใช่สิทธิ์ที่ได้รับแล้ว. หาก QR หมดอายุต้องสแกนใหม่; ถ้าพร้อมหลังปิดรับ ให้แสดงรับไม่ได้ตามเงื่อนไข ไม่ออกย้อนหลังจากวันที่สมัคร. Demo จำลองผลจบ signup ในเครื่องมือภายนอกหน้าลูกค้า ไม่วาดฟอร์มสมัครใหม่ทับของเดิม.

คิว Sales ไม่เปิด hosted Checkout URL/เอกสารการเงิน/PII; ลิงก์ไป Billing ต้องตรวจสิทธิ์ลูกค้าใหม่. QR ไม่พิสูจน์การอยู่หน้างาน. AI Gateway ไม่เขียนเงิน/ส่วนลดตรงฐานข้อมูล.

### 2.1 UI/UX ของส่วนลดและธีม

- โครงตาม reference: หัวข้อ “ส่วนลด” + ข้อความ “เลือกใช้ได้ 1 รายการต่อบิล”, กล่องเดียวในธีม Mangmee มีแท็บ **“ส่วนลดที่มี N” / “ประวัติส่วนลด”**, ภายในเป็นแถวคั่นเส้น ชื่อ/ยอด/เงื่อนไขสั้นด้านซ้าย ปุ่มด้านขวา. ไม่มีภาพตั๋ว เส้นประ คูปองตกแต่ง หรือการ์ดใหญ่แยกต่อรายการ.
- N คือจำนวนสิทธิ์ที่รับแล้วและยังไม่ consumed/revoked ไม่ใช่จำนวนที่โหลดหรือเห็น 3 แถว. Pending/temporarily ineligible ยังอยู่และอธิบายเหตุผล; จึงใช้ “ส่วนลดที่มี” ไม่อ้างว่าทั้งหมดกดใช้ได้ทันที. ประวัติส่วนลดแสดง USED/REVOKED พร้อมวัน/บิล/เหตุผลตามสิทธิ์; ต่างจากประวัติชำระเงินเดิม.
- QR offer ที่ยังไม่รับแสดงแถว “รับส่วนลด” ภายใน section เดียวกัน ไม่รวมใน N. รับแล้วแถวนั้นเปลี่ยนเป็นสิทธิ์ในรายการ ไม่แสดงข้อเสนอเดิมซ้ำอีกกล่อง; ถ้า cap อนุญาตรับเพิ่มจึงแสดง “รับเพิ่ม” พร้อมจำนวน. การเปิดหน้าไม่ออกสิทธิ์หรือเลือกเอง.
- แถวแสดงชื่อที่หัวหน้าตั้ง, “ลด … บาทก่อน VAT”, scope/target date เมื่อเกี่ยวข้อง. “รับได้ถึง …” ใช้เฉพาะข้อเสนอที่ยังไม่รับ; ไม่มี “หมดอายุ” บนสิทธิ์ที่รับแล้ว. วันที่ใช้เวลาไทยและปีเต็มโดยเฉพาะรายปี.
- มี 1–3 รายการแสดงทั้งหมดตามความสูงเนื้อหา. มากกว่า 3 ให้ viewport รายการเห็นไม่เกิน 3 แถวเต็มและเลื่อนแนวตั้งดูที่เหลือ; title/แท็บ/count/สถานะ selection อยู่นอกส่วนเลื่อน. ห้ามใช้ slice(0,3) แล้วทิ้งรายการที่เหลือหรือ clip แถวที่สาม. ความสูงปรับตามแถวจริง/viewport/font zoom; หน้า Billing หลักยังเลื่อนตามปกติ ไม่มี horizontal scroll. ใช้กติกานี้กับทั้งสองแท็บ.
- ลำดับ claimedAt ใหม่ก่อน + ID เป็น tie-breaker; เปลี่ยน selection ไม่กระโดดสลับแถว. Cursor ต้องเสถียร. Server ส่ง selected record แยกจากหน้ารายการเสมอเพื่อ lock รายการอื่นแม้ selected ยังโหลดไม่ถึง. แสดงสถานะที่เลือกและลิงก์ “ดูรายการที่เลือก” เลื่อนไปแถวนั้นโดยไม่เปลี่ยน selection. โหลดหน้าถัดไปด้วย scroll/pagination เดิม; ล้มเหลวเก็บรายการเดิมและมี retry.
- ใช้ MangmeeCard/mangmee-card, mangmee-btn, mangmee-input, spacing/radius/shadow/font/brand tokens เดิม. “เลือก” เป็น secondary; “ใช้ส่วนลด” เป็น selected brand treatment เดิม + aria-pressed=true. ไม่คัดลอก palette/typography ของ ChatGPT หรือสร้างสีเขียวชุดใหม่. ไทย/อังกฤษอยู่ใน dictionary เดิม (Select / Apply discount).
- Dropdown ทั้ง head/Sales/customer/หน้าเกี่ยวข้องใช้ ThemedSelect หรือ SelectField + PopoverPanel เดิม; ไม่ใช้ native select/custom dropdown ใหม่. ชื่องาน/ชุดเป็น text; การเลือกส่วนลดใช้ปุ่มในแถว. Assignment หลายคนใช้ตัวเลือกหลายรายการเดิม ไม่ใช้ ThemedSelect แบบ single value แทน. วันที่ใช้ ThemedDate/field เดิม.
- Dropdown ต้องตรวจ closed/open/selected/disabled/loading/error/empty/ชื่อไทยยาว/search/keyboard/Escape/outside-click/portal ใน modal และ scroll container. ถ้า disable ขณะเปิด ต้องปิดเมนูและป้องกัน option mutation; current value ถูกลบ/หมดสิทธิ์ต้องแสดง unavailable/placeholder ไม่แสดง option แรกแทนโดยไม่ได้เลือก. Pending ใช้ scoped CoverLoader ตาม guideline.
- ปุ่มอย่างน้อย 44px บนจอสัมผัส; label/aria-describedby บอก “กดอีกครั้งเพื่อยกเลิกการเลือก”. Enter/Space ทำเหมือนคลิก; focus และ aria-live ประกาศผลหลัง server ยืนยัน. กล่อง scroll เข้าถึงด้วย keyboard/touch และเลื่อนแถวที่ focus เข้ามาโดยไม่ trap หน้า. ทดสอบ 320/390/768/1280px, zoom 200%, ชื่อยาวและจำนวนมาก.

### 2.2 ปุ่มและ state เดียวกันทุกหน้าจอ

| State | ปุ่มรายการนั้น | รายการอื่น / ผลเมื่อกด |
|---|---|---|
| AVAILABLE ไม่มี selection | “เลือก” enabled เมื่อ eligible | เลือกหนึ่งรายการ; ระหว่าง request ปิด mutation ทุกแถว |
| SELECTED/QUEUED/ARMED | “ใช้ส่วนลด” selected | รายการอื่นยังคำว่า “เลือก” แต่ disabled; กดรายการเดิมเพื่อ clear |
| SELECTING / CLEARING / UNKNOWN operation | คง label ล่าสุด + loader | ทุกปุ่มเปลี่ยน selection disabled; retry/re-read operation เดิม ไม่ toggle ใหม่ |
| Selected แต่สินค้า/ราคาไม่รองรับ | “ใช้ส่วนลด” selected + reason | ไม่ลด/ไม่ชำระเงียบ ๆ; ยกเลิกได้ถ้าไม่มี accepted/financial reservation |
| RESERVED / accepted / processing | label ล่าสุด + “กำลังตรวจรายการชำระเงิน” | clear/select disabled จนผลชัดเจน; ยังรับสะสมได้ตามสิทธิ์ |
| ไม่มีสิทธิ์จัดการ/ถูก suspend | read-only พร้อมเหตุผล | ไม่ optimistic mutation; recovery ที่ยอมรับแล้วดำเนินต่อ |
| CONSUMED / REVOKED | “ใช้แล้ว” / “ยกเลิกสิทธิ์แล้ว” ในประวัติ | ไม่แสดงปุ่มเลือก; consumed ปลด selection แบบ atomic |

การกดรายการอื่นขณะที่มี selection ห้ามทำ replace แม้ยิง API ตรง. ยกเลิกหลัง ARMED ต้องยืนยัน detach จาก provider ก่อนปลด lock/ให้เลือกใหม่. ถ้า invoice แข่งจน accepted แล้ว clear ต้องถูกปฏิเสธและแสดง source เดิม; ห้าม UI คืนยอดเต็มหรือแสดง “ยกเลิกแล้ว” ก่อนผลแน่นอน. “ใช้ส่วนลด” ไม่ได้แปลว่า CONSUMED; ใช้สิทธิ์สำเร็จเมื่อ verified paid เท่านั้น.

### เลือกเซลล์ผู้แจกเมื่อมีหลายคน

Assignment อยู่ต่อชุดส่วนลด อ้าง stable salesUserId; งานใช้รวมรายงาน ไม่ให้สิทธิ์ทุกชุดโดยอัตโนมัติ. ฟอร์มย่อแสดงจำนวนที่เลือก ชื่อไม่เกิน 3 คน และปุ่มดูรายชื่อที่เหลือ/แก้ไข. เปิดตัวเลือกแล้วค้นหาชื่อหรือรหัส กรองทีม ดูเฉพาะคนที่เลือก และแบ่งหน้าได้; demo มี 24 คน 4 ทีม หน้าละ 6 คนเพื่อทดลอง 10–20 คนขึ้นไป. ช่องเลือกไม่จำกัดอยู่สองชื่อและไม่ต้องเลื่อนรายชื่อทั้งหมดในฟอร์ม.

การเลือกสะสมด้วย ID ข้ามหน้า/คำค้น/ทีม. “เลือกผลค้นหาทั้งหมด N คน” เลือกเฉพาะ active ที่ตรงตัวกรองในทุกหน้า; แสดงจำนวนก่อนกด ไม่รวม inactive และไม่ให้สิทธิ์สมาชิกใหม่ของทีมในอนาคตอัตโนมัติ. ดูคนที่เลือกเพื่อลบรายคนหรือล้างทั้งหมดได้. “ใช้รายชื่อ N คน” บันทึกลงร่าง; ยกเลิกไม่แก้ร่าง. เผยแพร่จึงมีผลกับสิทธิ์แจกจริง ต้องมีอย่างน้อยหนึ่งคนและทุก ID ต้องยัง active/อยู่ในขอบเขตหัวหน้า. Server ตรวจสิทธิ์ทั้งหมดแบบ atomic พร้อม revision/audit actor และ IDs ที่เพิ่ม/ลบ; stale assignment revision ให้ refresh/review ไม่เขียนทับเงียบ ๆ.

บัญชีปิดใช้งานแสดงเหตุผลและเลือกใหม่ไม่ได้. ตอนโหลด/ค้นหาให้แสดงกำลังโหลด; ผิดพลาดมี retry โดยคง selection, ไม่พบแสดง empty state, ไม่มีสิทธิ์จัดการให้ read-only. ใช้รายชื่อ Sales/ทีมและ permissions เดิมพร้อม server search/pagination; bulk selection resolve เป็นชุด IDs ที่แน่นอนภายใต้ scope เดียวกันก่อนยืนยัน ไม่ตีความแค่ checkbox ของหน้าปัจจุบันเป็นรายชื่อทั้งหมด. Demo ใช้รายการในหน่วยความจำ จึงไม่อ้างว่าได้ตรวจ API loading/error/auth จริง.

ถอดเซลล์แล้วเผยแพร่หยุดสร้าง QR และรับส่วนลดใหม่ผ่าน QR เก่าของคนนั้นทันที. ส่วนลดที่ออกแล้วคงใช้ได้ตามเงื่อนไขและคงเครดิตคนเดิม; หัวหน้าติดตามต่อได้. หน้าจริงใช้ผู้เข้าสู่ระบบเป็นผู้แจก; ตัวเลือกสลับเซลล์ใน demo มีไว้ทดลองบทบาทเท่านั้น.

## 3. ตั้งชุดส่วนลดและช่วงรับ

| ค่า | กติกา |
|---|---|
| ชื่องาน/ชื่อชุดส่วนลด | text 1–120 ตัวอักษรหลัง trim; ชื่อชุดไม่ใช่ dropdown |
| ส่วนลดก่อน VAT | จำนวนสตางค์บวกคงที่; ระบบคำนวณ VAT/ยอดจ่าย |
| จำนวนออกสูงสุด | lifetime issued; ไม่คืนจาก revoke/refund |
| ต่อบริษัทต่อชุด | cap การออกสะสม; สะสมหลายรายการได้แต่หนึ่งรายการต่อบิล |
| เซลล์ผู้แจก | stable IDs ตาม assignment; รองรับค้นหา/ทีม/หลายหน้า |
| กลุ่มลูกค้า | ทั้งหมด / สมัครใหม่ผ่านงาน / บริษัทเดิม |
| สินค้าที่ใช้ได้ | catalog/approved deal ที่ provider proof ผ่าน รวม renewal ของสินค้าที่รองรับ |
| เปิดรับ / ปิดรับส่วนลด | หัวหน้ากรอกวันเวลาเอง; server [start,end), เก็บ UTC แสดงเวลาไทย |

ไม่มี “ลูกค้าใช้ส่วนลดได้ถึงเมื่อไร” หรือจำนวนวันหลังรับแล้ว. แสดงว่า “รับภายในเวลานี้ แล้วเก็บไว้เลือกใช้ลดบิลหนึ่งบิลได้ แม้เลยวันปิดรับ”. ชื่อ/ค่าร่างเดิมคงไว้เมื่ออัปเดต demo แต่ expiry เก่าไม่ใช้ตัดสิทธิ์ในแบบใหม่.

ปุ่มครั้งแรก “ยืนยันและเปิดแจกส่วนลด”; แก้ใช้ “บันทึกการเปลี่ยนแปลง”. Revision ใหม่ใช้กับสิทธิ์ที่ออกใหม่; รายการที่รับแล้วตรึงส่วนลด/source scope/agent. Cap เพิ่มได้ ลดไม่ต่ำกว่า issued. ต่อช่วงรับได้เพื่อรับใหม่ ไม่ทำให้ USED กลับใช้ได้. “พักแจก” หยุดรับใหม่อย่างเดียว; “ระงับใช้” หยุดการผูกกับ invoice ใหม่แต่คงสิทธิ์/งานติดตามที่ accepted แล้ว. QUEUED/ARMED ที่ยังไม่ accepted ต้องผ่าน detach/collection hold ที่พิสูจน์แล้ว; ไม่ถือว่าปิดปุ่มแล้วหยุด provider ได้.

เพิกถอนเฉพาะสิทธิ์ที่ยังไม่ RESERVED/CONSUMED พร้อมสิทธิ์เหตุผล/audit/customer notice; ไม่มีการคืน cap. หาก ARMED ต้องยืนยันถอนจาก provider ก่อนบันทึก REVOKED และปลด selection; ถ้า cutoff ชนะหรือผล UNKNOWN ให้คง lock/ตรวจรายการเดิม. การระงับ/เพิกถอนต้องแสดงเหตุผลและผลต่อบิลที่เคยเลือกไว้ให้ลด ห้ามเรียกเก็บราคาเต็มเงียบ ๆ โดยหน้าเดิมยังสัญญาส่วนลด.

## 4. Claim, binding และ target ของส่วนลด

QR signed/opaque จำกัดอายุไม่เกิน 5 นาทีและไม่เลย claim close; ตรวจ active assignment ซ้ำตอน claim. เปลี่ยน terms หลัง scan ให้ preview revision ใหม่. DB clock เป็นตัวตัดสิน ไม่ใช้เวลาสแกน/นาฬิกา browser. รับหลังปิดไม่ได้ แต่ recovery ของคำขอที่ commit แล้วคืนรายการเดิม.

Claim + cap + ticket + audit เป็น atomic local transaction. Select สร้าง selection/target เมื่อไม่มี active selection; Clear ระบุรายการเดิมกับ expected selectionVersion. Double-tab stale selection ให้ refresh ไม่เขียนทับหรือ replace เงียบ ๆ. คำสั่งต้องส่ง desired state (select ID / clear expected ID) ไม่เป็น server-side toggle: retry key เดิมต้องคืนผลเดิม ไม่กดย้ำจนกลายเป็นยกเลิก. ในชุดเดียวกัน scan ซ้ำคืนรายการเดิม; รับเพิ่มต้อง explicit intent/key ใหม่และไม่เลือกให้อัตโนมัติ. เซลล์คนแรกของบริษัทในชุดตรึง attribution.

Claim ผูก companyId ที่มีอยู่แล้วภายใต้ Company→batch lock; ตรวจ membership/per-company limit/audience จากข้อมูลสมัครเดิม. Signup/provisioning/dedup ทำตามระบบเดิม ไม่มี ticket mutation ใน use case สมัคร. ไม่ย้ายส่วนลดข้ามบริษัท; binding ซ้ำ/คำขอซ้ำใช้ request key และ constraint เดิม.

ส่วนลดที่ไม่ได้เลือกต้องไม่มี provider operation/coupon. เมื่อ USED ให้ปลด selection ที่ consume แล้ว; รายการอื่นคง AVAILABLE จนลูกค้าเลือกใช้ใหม่.

Target resolution ตอนเลือกใช้ ตามลำดับ:
- มี quote ที่กำลังซื้อและยังไม่มี accepted payment → quote ปัจจุบันมีสิทธิ์ก่อน scheduled renewal; ผูก purchase intent เดิม คำนวณใหม่ แล้วให้ยืนยันยอด.
- ไม่มี purchase intent แต่มี active subscription → target รอบ recurring ถัดไปที่ยังผูกส่วนลดได้; เก็บ subscription ID/cycle/expected date.
- ยังไม่มีทั้งสอง → รอ first eligible full-package payment ของบริษัท.
- accepted/processing/UNKNOWN/finalized invoice ที่แก้ไม่ได้ → ไม่เปลี่ยน amount/body/key เดิม. รับสะสมได้ แต่ยังเลือก/เปลี่ยนใช้ไม่ได้จนผลเดิมชัดเจน. แสดง “รายการนี้เริ่มชำระแล้ว เก็บส่วนลดไว้เลือกใช้หลังทราบผล”. ถ้าพิสูจน์ terminal no-payment และเก็บต่อไม่ได้ จึงเลือกส่วนลดและสร้าง discounted quote ใหม่ได้.
- Claim ไม่เรียกเก็บเงินและยังไม่มี target. Select/use เก็บ selection + QUEUED intent แบบ durable; outbox/BillingOperation เดิมผูก native provider แล้วจึงแสดง ARMED. ระหว่างรอแสดง “กำลังผูกส่วนลด”; error มี retry/issue ไม่อ้างว่า apply สำเร็จแล้ว.

ยกเลิกต่ออายุแล้วไม่มีบิล → คงส่วนลดและแสดง “รอการซื้อครั้งถัดไป”; ไม่เริ่ม/คืน subscription เอง. เปลี่ยน cadence/แพ็กก่อน invoice → resolve target/ราคาใหม่ แจ้งวัน/ยอดประมาณการใหม่; ห้ามยึด date เดิมหรือใช้สอง subscription. มีหนี้เก่าไม่ลดหนี้ย้อนหลัง; ผ่าน debt gates เดิมก่อน target ใหม่. ยังไม่เลือกสินค้าหรือ target ไม่รองรับให้บอกเหตุผล คง ticket และไม่สัญญายอดแน่นอน.

ยอดที่แสดงล่วงหน้าของ renewal เป็น **ประมาณการ** ตามราคา/VAT ปัจจุบัน; final bill ใช้ราคา/ภาษี/consent ของ Billing ตอนออก invoice. ถ้าลดไม่ได้เพราะ floor/extra coupon/unsupported/hold ต้อง NEEDS_ATTENTION และแจ้ง customer/operator ก่อนออกบิล ไม่ silently consume หรือข้ามส่วนลด. ใช้ retry/dunning/collection hold ที่พิสูจน์แล้ว; หาก provider หยุด finalization/collection อย่างปลอดภัยไม่ได้ ให้ปิด combination นั้นก่อน rollout. การซื้อราคาเต็มแทนทำได้เมื่อผู้ใช้เห็นยอดใหม่และยืนยัน โดยส่วนลดยังคงรอใช้.

## 5. State, data และ concurrency

| Record | ข้อมูลหลัก |
|---|---|
| SalesEvent / Batch / Assignment | event/name/revision/terms/claim window/lifetime cap/issue state/suspension/active sales IDs/audit |
| SalesDiscountTicket | serial/request key unique; immutable company/agent/amount/scope; claimedAt; claimAcknowledgment; ไม่มี post-claim expiresAt |
| Ticket target | ticket/company/account + PURCHASE_INTENT/NEXT_RENEWAL/FIRST_PURCHASE; subscription/cycle/expectedAt; QUEUED/ARMED/NEEDS_ATTENTION; version/reason |
| Redemption | ticket/attempt/invoice/provider account/mode/coupon; immutable totals/policy/tax/evidence; acceptedAt/paidAt; RESERVED/CONSUMED/RELEASED |

Customer status derive: USED เมื่อ verified paid; IN_PAYMENT เมื่อ RESERVED; REVOKED/VOID; WAITING_READY; NEEDS_ATTENTION; QUEUED/ARMED (“รอหักบิลอัตโนมัติ” หรือ “ส่วนลดพร้อมใช้กับรายการนี้”). Claim-window end ไม่เปลี่ยนสถานะของรายการที่รับแล้ว. เพิ่ม AVAILABLE (“เก็บไว้แล้ว”) เมื่อไม่มี target; มี target จึง QUEUED/ARMED. ห้าม preview ส่วนลดที่ยังไม่เลือกเป็นส่วนลดที่ผูกกับบิลแล้ว. ไม่ consume ตอน claim/coupon creation/invoice finalization.

Partial unique หนึ่ง active redemption/consumed ต่อ ticket และหนึ่งสิทธิ์ต่อ invoice/attempt; selection เดียวต่อ company + Billing account + provider mode ไม่ใช่หนึ่งรายการต่อ cycle ที่เปิดค้างได้หลายรายการ. Target เดียวต่อ active selection. หลัง provider ARMED ต้อง clear→พิสูจน์ detach สำเร็จ→selection ว่าง แล้วจึงรับ select ใหม่; CLEARING ยังถือ lock เดิม. Binding company/account/subscription/source ตรวจทุก boundary. Select/clear กับ invoice-create/acceptance แข่งกันต้อง serialize ด้วย lock/version เดียว: ถ้า accepted ก่อนให้ปฏิเสธ clear/change พร้อม source เดิม. ไม่ตัดสินด้วย webhook arrival order.

Snapshot ของ quote ต้องมี selectionVersion แม้ไม่มีส่วนลด (null selection) และ eventDiscount evidence เมื่อมี: ticket/revision/discountBeforeTax/baseSubtotal/baseTax/baseTotal/discountedSubtotal/tax/total/target/account/mode. Quote request ระบุ observed selectionVersion; stale ตอบ conflict. Checkout ตรวจ version/target/terms ปัจจุบันใน transaction เดียวกับ accepted fence และ reservation. Quote ยอดเต็มที่สร้างก่อน select หรือ quote ลดที่สร้างก่อน clear ใช้ชำระไม่ได้. Out-of-order quote responses ต้องถูกทิ้ง; ทุก successful select/clear/offer/tax/source change reset consent. Lost response ดึง operation/selection เดิมกลับก่อนเปิดปุ่ม.

จาก NEXT_RENEWAL ไป current purchase ต้องทำ explicit purchase-intent resolution ภายใต้ selection เดิม: ยืนยันถอนจากรอบเดิมก่อนผูก quote ใหม่ ไม่ติดสองบิล. Back/profile detour/reload ไม่ถือเป็น clear หรือย้าย target เอง; stale/abandoned purchase intent ต้อง resolve/cancel อย่างมี version และแจ้งผลต่อรอบเดิม. เปลี่ยนบริษัทล้าง client cache/request แล้วโหลดบริษัทใหม่; ห้ามส่ง selection ที่เพิ่งโหลดอีกบริษัทเข้ารอบเดิม.

Lock order: Company → Billing account/attempt lease → Batch (หลายชุดเรียง ID) → Ticket/target/redemption. ไม่มีการ issue ส่วนลดก่อนมีบริษัท; management ที่ถือ batch ห้ามขอ Company ย้อนทาง. ใช้ DB row locks/constraints ไม่ใช้ in-memory mutex; provider IO อยู่นอก transaction ผ่าน operation/outbox/idempotency/recovery เดิม.

Issued lifetime ไม่คืนจาก payment fail/revoke/void/refund. Terminal no-payment ปล่อยรายการเดิมพร้อม reschedule ไม่ออกรายการใหม่. UNKNOWN ไม่ปล่อยจาก timeout/UI cancel/session expiry อย่างเดียว. Retry invoice/payment เดิมยัง discount เดิม ไม่ขโมยสิทธิ์ไปอีก invoice.

## 6. Eligibility และการคำนวณ

| Purchase source | บิลที่ลดได้ในแบบใหม่ |
|---|---|
| INITIAL/RESTART/REPEAT/FULL_PACKAGE_UPGRADE เดือน/ปี | การซื้อเต็มแพ็กที่ยังไม่ accepted |
| Approved deal/CARD_AUTO/ADVANCE_DEAL | บิลเก็บเงินจริง ไม่เปลี่ยน snapshot ดีล/วันเริ่ม |
| Automatic monthly/annual RENEWAL | บิลถัดไปหนึ่งบิลของสินค้าที่อยู่ใน scope |
| PromptPay renewal | ลดบิลให้ก่อนสร้าง QR; ลูกค้ายังเป็นผู้จ่าย |
| เปลี่ยนแพ็ก/cadence แบบยังไม่เก็บเงิน | ไม่ consume; resolve บิลใหม่เมื่อถึงรอบ |
| Upgrade ส่วนต่าง/หนี้เก่า/refund/repair/ADD_ON | ไม่รองรับส่วนลด; คงสิทธิ์รอซื้อที่รองรับ ไม่ย้าย selection ไปบิล add-on |

ใช้ source classification/permission/company hold/debt/capacity/mode readiness เดิม. Publish รับได้เฉพาะ supported combinations; renewal ห้ามเลือก scope “catalog” แล้วไปลดดีลที่ไม่เข้าเงื่อนไข.

quoteTotals เดิมหา baseSubtotal/baseTax/baseTotal; discountedSubtotal = baseSubtotal - ticket.discountBeforeTaxSatang แล้วคิด VAT ที่ pin. ส่วนลดไม่ลดเดือน/ผู้ใช้/ใบเสร็จ/AI budget/สิทธิ์แพ็ก. ตัวอย่างส่วนลด 100 บาท:

| ราคาต้นฉบับ 499 บาท | ฐานก่อนลด | ฐานหลังลด | VAT หลังลด | จ่ายจริง |
|---|---:|---:|---:|---:|
| NOT_VAT_REGISTERED | 499.00 | 399.00 | 0.00 | 399.00 |
| EXCLUSIVE_VAT_7 | 499.00 | 399.00 | 27.93 | 426.93 |
| INCLUSIVE_VAT_7 | 466.36 | 366.36 | 25.65 | 392.01 |

ปัดครึ่งขึ้นที่สตางค์. Inclusive provider amount_off = baseTotal - targetTotal (106.99 ในตัวอย่าง) ไม่ส่ง 100 แล้วอ้างลดฐาน 100. พิสูจน์ subtotal/tax/total ทุกสตางค์; ไม่ตรงปิด combination ไม่ปัดชดเชย. final ต้อง >= verified provider floor สำหรับ account/mode/payment method/currency และ >0 รวมข้อบังคับ Billing ส่วนกลางที่มีอยู่จริง. ไม่มี minimum ของ ticket/batch และไม่เปิดช่องให้ Sales/ลูกค้ากรอก. Repo ปัจจุบันยังไม่มี central minimum ของยอดหลังลด; offerTerms ตรวจราคาสินค้าก่อนภาษี ไม่ใช่ floor ของยอดชำระหลังลด. จึงต้องเพิ่ม shared readiness/validator ของ provider floor และใช้ snapshot ตอน quote/dispatch; ไม่ถือค่าตัวอย่าง 100 บาทใน demo เป็นนโยบายจริง. ถ้า provider floor ยังพิสูจน์ไม่ได้ให้ combination นั้นไม่พร้อม. ลดเกินฐาน/ต่ำกว่า floor ปฏิเสธ ไม่ลดบางส่วน/บิลศูนย์. การเพิ่ม business minimum อื่นเป็นนโยบาย Billing แยก ไม่แอบเพิ่มในงานนี้.

Ticket terms ตรึงที่ออก แต่ offer/policy/permission ตรวจปัจจุบันตอน quote/dispatch; เปลี่ยนก่อน dispatch ทำ quote stale ต้อง consent ใหม่. หลัง accepted ใช้ snapshot. ใช้ส่วนลดไม่ได้ให้ reason และเลือกซื้อราคาเต็มชัดเจน ห้ามเปลี่ยนยอดเงียบ ๆ.

VAT ใช้การตั้งค่า Billing ปัจจุบันตอน quote ไม่ตรึงจากวันแจกส่วนลด. ตัวอย่างยังไม่คิด VAT: 499 ลดฐาน 100 = 399; ภายหลังตั้งให้บวก 7% จะคำนวณ quote ใหม่เป็น 426.93 อัตโนมัติ แม้เป็นส่วนลดที่แจกไว้ก่อน. ก่อน acceptedAt ต้องให้ลูกค้ายืนยันยอดใหม่เมื่อ tax/policy เปลี่ยน; หลัง acceptedAt เก็บ quote/tax/policy evidence เดิม ไม่แก้ยอดของ attempt หรือ invoice ย้อนหลัง. หน้า customer แสดง VAT ที่ระบบคำนวณ ไม่ให้เลือกรูปแบบ VAT เอง.

## 7. Provider, paid, renewal และ refund

ราคาใน BillingSubscriptionContract/approved deal คงราคาเต็ม. Discount เป็น invoice-specific overlay ที่ผูก ticket/cycle อย่างชัดเจน; **renewal ไม่ได้ต้องเต็มราคาทุกครั้งอีกแล้ว**. รอบที่มี authorized target ลดได้หนึ่ง invoice; รอบถัดไปไม่มี residual discount เว้นแต่ลูกค้าเลือกรายการอื่นใหม่. ไม่ spread event fields ลง contract หรือปล่อย coupon ติดถาวร.

ใช้ native once-only coupon/invoice discount ที่พิสูจน์ตรง API version repo. ผู้ซื้อก่อน Checkout ใช้ operation เฉพาะ attempt; recurring ใช้ operation ที่ผูก subscription/cycle และตรวจ actual invoice identity ตอน invoice creation/finalization. ห้ามใส่ coupon ซ้ำใน subscription + invoice จนลดสองครั้ง; provider invoice ID unique. ไม่ fallback customer balance/negative lines/public promotion code.

Stripe once อาจถือว่า coupon ใช้แล้วเมื่อ invoice finalized และหายจาก subscription discount list แต่ระบบธุรกิจต้องรอ verified paid ก่อน USED. Invoice unpaid/dunning ผูก reservation เดิมจน paid หรือพิสูจน์ว่าเก็บต่อไม่ได้; release/rearm ต้องไม่สร้างสิทธิ์สอง invoice. ข้ามรอบ/response หาย/repeated webhook ใช้ journal เดิม ไม่แจกใหม่.

ตรวจ invoice/session/line/PI/charge: account/mode/currency/source/subscription/cycle/ticket/coupon/amount/subtotal/tax/total ตรง expected evidence ทุกสตางค์. Wrong/foreign/extra discount → financial issue/PAID_HELD; ห้ามเปิดแพ็ก/ชวนจ่ายซ้ำ. Legacy ไม่มี eventDiscount ยังคง strict checks เดิม. ต้องแก้ validator ที่ currently reject discounts ใน reconciler/repeat/collection/price-return/refund-source อย่างแคบ ไม่ปิด validation ทั้งชุด.

Verified paid + invoice source + CONSUMED atomic/idempotent; activation เป็นอีก boundary. Advance รอวันเริ่ม; apply fail เป็นจ่ายแล้วพักตรวจ ไม่คืนสิทธิ์ ไม่ข้าม company/security hold. Invoice ศูนย์/bootstrap ไม่ consume.

Refund/dispute คง USED และ issued. คืนตามยอดรับจริงหลังลด/tax/credit-note/cumulative limits; ไม่คืนราคาเต็มหรือส่วนลดเป็นเงิน. Refund-before-paid callback อ่าน actual source และ consume หากเคยเก็บเงินจริง. Advance full refund ก่อนเริ่มใช้ cancellation protection เดิม. ชดเชยเป็นสิทธิ์ใหม่ผ่าน authorization/cap ปกติ.

## 8. Contracts, UI และรายงาน

ต่อ Sales/Billing handlers เดิมและ runtime DTO whitelist. Claim ส่ง QR/company/observed revision/idempotency; select ส่ง ticketId + expectedSelectionVersion + purchaseIntentId ถ้ามี; clear ส่ง expectedTicketId + expectedSelectionVersion. Select คนละ ID ขณะยังเลือกอยู่ตอบ SELECTION_ALREADY_ACTIVE; client ปิดปุ่มไม่ใช่ security boundary. คำสั่ง use/clear ใช้ idempotency/recovery แยกจาก Checkout; ไม่รับยอด/agent/target cycle ที่ browser อ้างเป็น authority. Quote/renewal resolution อ่าน server selection; Checkout ยังรับ quote/consent ตามเดิมแต่ตรวจ selection snapshot ด้วย.

List contract ระบุ items/status/reason/canSelect/canClear/cursor/hasMore/totalCount และ selected record + selectionVersion + operation state แยกจาก page. History เป็นคนละ query/filter ของ redemption/revocation และไม่ทำ USED กลับ AVAILABLE. Target/date/estimated totals/financial status/activation status แยก; cache key ต้อง company+account+mode+tab/cursor. Claim context ใน login/signup/LINE เป็น opaque safe-return intent ไม่ใช่สิทธิ์และไม่บรรทุก secret ใน URL/log. Profile return อ่าน server selection ใหม่ ไม่เพิ่มส่วนลดผ่าน query string.

ข้อความหลัก: “ส่วนลด”, “รับส่วนลด”, “เลือก”, “ใช้ส่วนลด”, “กดอีกครั้งเพื่อยกเลิกการเลือก”, “เลือกส่วนลดอื่นได้เมื่อยกเลิกรายการที่เลือกอยู่”, “จะลดบิลวันที่ …”, “กำลังผูกส่วนลด”, “กำลังยกเลิกการเลือก”, “กำลังตรวจรายการเดิม”, “ใช้แล้ว”. ไม่มีปุ่มสลับทับ/เก็บแยกจาก toggle; สีอย่างเดียวไม่บอกสถานะ. ข้อความถูกใช้ตรงกันบนหน้า quote/renewal/error/ประวัติ/notification/รายงานและเอกสารที่เกี่ยวข้อง.

UI ต้องมี loading/empty/forbidden/closed/network/retry/pending/attention; error ไม่ทำให้สูญเสีย binding. Reason codes: CLAIM_NOT_OPEN, ISSUANCE_FULL, COMPANY_LIMIT, WAITING_READY, TARGET_PENDING, TARGET_INCOMPATIBLE, MINIMUM_NOT_MET, PROVIDER_NOT_READY, IN_PAYMENT, ALREADY_USED, REVOKED, REDEMPTION_SUSPENDED, SELECTION_ALREADY_ACTIVE, SELECTION_STALE, SELECTION_CLEAR_PENDING. Scope/role denied ไม่เผยข้อมูลอีกบริษัท.

Report event→batch→ticket→target→redemption→verified invoice. แยก issued/queued/armed/in-payment/used/activated/revoked; คิว renewal เดือน/ปีแสดง expected date ไม่ถือเป็นรายได้ก่อน paid. เงินเต็ม/discount ก่อน VAT/VAT/collected/refunded/disputed/net; net=collected-succeeded refunds ไม่หัก dispute ซ้ำ. Unique invoice/attempt กันนับซ้ำ. Sales credit ใช้ ticket.salesUserId ไม่เขียน Company.referralSalesUserId/SalesAttribution ทับ.

## 9. Acceptance

| ID | กรณีและผลที่ต้องได้ |
|---|---|
| E01 | เริ่มว่าง→หัวหน้าสร้าง→Sales QR→เข้าหน้าแพ็กเกจ→claim→เลือกหนึ่งรายการ→ยอดซื้อทันทีลด→paid/apply/report; เลือกแล้วไม่ต้องกดใช้ซ้ำก่อนบิลที่ผูกไว้ |
| E02 | VAT ทั้งสาม/floor พอดี-ขาด/ลดเกินฐาน; ไม่ยอดลบ ไม่ override ส่วนกลาง; accepted totals immutable |
| E03 | Claim open/close ที่ตั้งเอง; รับก่อนปิดเก็บรอหนึ่งปีได้; signup ยังไม่ issue; เปิดร้านหลังปิดรับถูกปฏิเสธ |
| E04 | Claim vs accepted/finalized invoice race; current quote ลดได้, accepted เดิมคงยอดและรับสะสมได้อย่างเดียวจนทราบผลก่อนเลือกใช้กับรายการใหม่; suspend boundary |
| E05 | cap=1 ต่างบริษัท/duplicate/retry/สมัครเดิมแล้วรับที่ Billing; สะสมหลายรายการ/clear สำเร็จก่อน select ใหม่/ไม่รวมส่วนลด/หลังใช้ไม่หยิบรายการอื่นเอง |
| E06 | Lost response/processing/UNKNOWN/reordered callbacks; ไม่เก็บ/consume/grant ซ้ำ |
| E07 | Existing monthly และ annual: claim→เลือกใช้→next bill ลด→retry invoice เดิม→paid→รอบต่อไปเต็ม; cancel/cadence change ไม่สูญสิทธิ์ |
| E08 | Approved/advance/card/QR; paid แยก activation; bootstrap ไม่ consume |
| E09 | Source scope/audience/ส่วนต่าง/หนี้/extra coupon/renewal incompatible; attention ก่อนเรียกเก็บ คงส่วนลด |
| E10 | Failed payment/dunning/void terminal: reservation เดิมหรือ release/rearm ตามหลักฐาน; ไม่หมดอายุหลังงาน |
| E11 | Refund/dispute/refund-before-paid/advance cancel: คืนเงินจริง ส่วนลด USED/cap คง |
| E12 | หลายเซลล์/บริษัท/20 assigned/removed agent; attribution เดิมและ company isolation |
| E13 | รายงานยอดรอเดือน/ปีแยกเงินจริง/activation/refund; invoice ซ้ำไม่เพิ่มยอด |
| E14 | Expected renewal discount vs foreign/wrong account/tax/source/evidence; legacy strict; next full invoice มี proof |
| E15 | Customer/head/agent auth + desktop/mobile/LINE/profile-return/network/loading/state restoration |
| E16 | Gate OFF/company hold/permission/suspend: หยุดใหม่ แต่ recovery/refund/history ต่อได้ |
| E17 | Revision/เพิ่ม cap/แก้วันรับ; issued terms เดิม; ห้าม cap ต่ำกว่า issued |
| E18 | Revoke ก่อน reserve/audit/notice; pending/used แก้ไม่ได้; ไม่มี post-claim expiry/extension |
| E19 | Section ส่วนลดก่อน current package/catalog/quote และก่อน next bill; header/แท็บ/signup/theme เดิม; ไม่มีคำว่าตั๋วใน UI ใหม่ |
| E20 | 0/1/2/3/4/20/100 รายการ: สูงสุด3แถวเต็ม ที่เหลือ scroll, countครบ, ใช้รายการที่4ได้, selectedอยู่นอกpageยังlockรายการอื่น, historyแยก |
| E21 | “เลือก”→“ใช้ส่วนลด”; รายการอื่น disabled; กดซ้ำ clear สำเร็จก่อนเลือกใหม่; keyboard/touch/reload/สองแท็บเหมือนกัน; direct replace API ถูกปฏิเสธ |
| E22 | Select/clear double click + response lost ใช้ desired-state/idempotency; out-of-order requests/quotes ไม่พลิกกลับ; consent reset; old full/discount quote ใช้ไม่ได้ |
| E23 | Clear ARMED→detach proof→unlock; clear vs invoice cutoff/provider unknown ไม่แสดง success หรือชวนจ่ายใหม่ก่อนแน่ใจ; current purchase/next renewal ไม่แย่งสิทธิ์ |
| E24 | Dropdown ตาม theme ทุกบทบาท: search/long labels/open→disabled/stale value/portal/keyboard/mobile/200% zoom; reuse shared controls และ scoped loader |
| E25 | ADD_ON/ส่วนต่าง/repair ไม่ consume หรือย้าย selection; quota/AI credit/feature/period เท่าเดิมเมื่อจ่ายเต็มแพ็กโดยมีส่วนลด |
| E26 | History/receipt/credit-note/notification/report/settlement แสดงยอดรับจริงและภาษีหลังลด; ไม่คิดรายได้จาก selection/ราคาป้าย; ไม่เปลี่ยน legacy attribution |
| E27 | Migration/Gate OFF/revoke/suspend/disarm/rollback คง paid evidence และ recovery; legacyไม่มีdiscountยังstrict; pendingไม่คืนสิทธิ์จากtimeout |

## 10. ความพร้อมและแหล่งอ้างอิง

Demo เป็น state simulation ไม่มี API/DB/เงินจริง. เดโมก่อนมตินี้วางส่วนลดใต้แพ็ก, แสดงการ์ด/คำเก่า, สลับรายการโดยตรงและยังไม่มี viewport3แถว จึงไม่ผ่าน E19–E24. ผล 53 walkthroughs/63 assertions เป็นหลักฐานเวอร์ชันก่อนหน้า ไม่ใช่การรับรองมติใหม่นี้. [Evidence เดิม](../evidence/sales-ticket-demo-2026-09-28/README.md) เก็บเป็นประวัติ. Production acceptance E01–E27 ยัง pending; audit ระบุผล local regression แยกจากการตรวจ E2E ใหม่.

ใช้ [Sales deals](mangmee-sales-deals-and-locked-signup-spec-th.md), [Billing](mangmee-billing-subscription-spec-th.md), [company purchase](mangmee-existing-company-self-purchase-spec-th.md), [advance deal](../agent-memory/sales-deal-advance-purchase-2026-09-23.md). กฎ no-coupon ของ flow เดิมยังใช้ต่อ: spec นี้กำหนดข้อยกเว้นเฉพาะ authorized eventDiscount ที่ผ่าน native proof และ gate ตาม plan เท่านั้น ไม่อนุญาต coupon ทั่วไปหรือยกเลิก guard เดิม. อัปเดต integration docs พร้อม implementation/evidence เมื่อเปิดข้อยกเว้นจริง.

ตรวจ official docs ซ้ำ 2026-09-29: [Stripe coupons](https://docs.stripe.com/billing/subscriptions/coupons), [invoice transitions](https://docs.stripe.com/invoicing/integration/workflow-transitions), [invoice update](https://docs.stripe.com/api/invoices/update), [credit-note lines](https://docs.stripe.com/api/credit_notes/lines). อ้างอิงภาษีที่อ่าน 2026-09-28: [tax discounts](https://docs.stripe.com/tax/tax-rates#discounts), [credit notes](https://docs.stripe.com/invoicing/dashboard/credit-notes#credit-balances-and-discounts). เอกสาร provider ไม่แทน native proof บน API version repo (ที่ตรวจ 2026-08-26.dahlia).
