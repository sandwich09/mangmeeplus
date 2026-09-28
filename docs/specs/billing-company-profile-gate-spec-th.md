# ข้อมูลบริษัทก่อนซื้อแพ็กเกจ

**Superseded สำหรับการซื้อ (2026-09-26 D-PF-1, spec purchase-without-setup §18.2 R-A1/R-A2/R-A3; ทำแล้วใน PR C 2026-09-28): ที่อยู่/อีเมลไม่ใช่เงื่อนไขก่อน quote/checkout อีก; ข้อด้านล่างคงไว้เป็นประวัติ ยกเว้นที่ระบุ**

Owner decision 2026-09-17: ให้ทำตามข้อเสนอ popup/กลับไปกรอกข้อมูล/กลับมาซื้อต่อ โดยใช้ชื่อจดทะเบียนก่อน ถ้าเว้นว่างใช้ชื่อร้านที่สมัครไว้ และส่งข้อมูลชุดนี้ไป Stripe พร้อมตรวจ bug/gap/impact และ merge main + develop หลัง CI ผ่าน

- ~~ก่อนเริ่มซื้อใหม่ INITIAL/RESTART/REPEAT/UPGRADE ต้องมีที่อยู่ line1, ตำบล/แขวง, อำเภอ/เขต, จังหวัด และรหัสไปรษณีย์ไทย 5 หลัก~~ → ยกเลิก: ที่อยู่กรอกได้ที่ Stripe Checkout (customer_update.address=auto) และเก็บเป็น BillingAccount.checkoutAddressJson; trim ก่อนตรวจ ชื่อบนเอกสารใช้ registeredName.trim() ก่อน name.trim() เสมอ หากไม่มีทั้งคู่ถือว่าขาดชื่อ ที่อยู่เพิ่มเติมไม่บังคับ
- ประเภทธุรกิจ/ช่องทางรู้จัก/เลขภาษี/คำตอบ VAT ไม่เพิ่มเป็นเงื่อนไขซื้อจากมตินี้; ~~ใช้ verified account email ตามกติกาเดิม~~ → ยกเลิก: ผู้รับเอกสาร = BillingAccount.recipientEmail (capture จาก Checkout / OTP บริษัท / แอดมิน); ไม่ผูก purchase readiness เข้ากับความครบของหลักฐาน legal tax identity
- หน้าแพ็กเกจแสดงการเตือนพร้อมรายการข้อมูลที่ขาดและปุ่มไปหน้าข้อมูลร้านทันทีเมื่อ billing profile ยังไม่ครบ; ใช้เงื่อนไขและรายการเดียวกับ purchase gate เพื่อให้เจ้าของร้านเห็นก่อนเริ่มเลือกซื้อ
- เมื่อกดซื้อและข้อมูลไม่ครบ เปิด Modal เดิมพร้อมรายการช่องที่ขาด ปุ่ม “กรอกข้อมูลบริษัท” และ “ไว้ก่อน”; กลับหน้าข้อมูลร้านของบริษัทเดียวกัน โดยเก็บเฉพาะ package/interval/channel ที่ whitelist ไม่รับ return URL ภายนอก
- หลังบันทึกสำเร็จกลับมาทบทวนแพ็กเกจที่เลือก ต้องยืนยันราคา/ชื่อ/ที่อยู่/เงื่อนไขก่อนชำระ ไม่สั่งชำระอัตโนมัติ ห้ามหายข้อมูลเมื่อ error; เปลี่ยนบริษัท/หมด session/ไม่มีสิทธิ์ต้องไม่ส่งข้อมูลไปผิดบริษัท
- ~~Backend ตรวจที่ quote และก่อน checkout mutation~~ → Backend ไม่ปฏิเสธเพราะโปรไฟล์ไม่ครบ; drift ตั้งแต่ quote → BILLING_QUOTE_STALE เท่านั้น; bind normalized name/address ลง quote snapshot และตรวจใหม่ก่อนเริ่ม provider call หากข้อมูลเปลี่ยนให้ทบทวน quote ใหม่ ข้อมูลที่ไม่เกี่ยวกับการออกเอกสาร เช่น TSIC ไม่ทำให้ quote เก่าหมดอายุ
- ส่งชื่อ/ที่อยู่ไป Company-bound Stripe Customer ทั้งสร้างใหม่และลูกค้าเดิม ก่อนเริ่ม Checkout: country TH, line1 บ้านเลขที่/ถนน, line2 ที่อยู่เพิ่มเติม+ตำบล/แขวง, city อำเภอ/เขต, state จังหวัด, postal_code รหัสไปรษณีย์ รักษา verified email/customer/account/mode binding เดิม ใช้ API version ที่ repository pin → payload เดียว stripeCustomerSyncPayload: name เสมอ, address เฉพาะครบ 5 ช่อง, email เฉพาะ verified account email หรือผู้รับปัจจุบัน (ไม่มี = Checkout ถาม)
- Stripe error/timeout ห้ามเดินหน้าชำระและห้ามแสดงว่าพร้อมแล้ว; การยืนยัน/ลองซ้ำใช้ command identity เดิม และไม่ปล่อยให้คำสั่ง profile ที่ผลยังไม่ชัดเขียนทับการซื้อใหม่จากอีกคำสั่ง
- Quote เก่าที่ไม่มี profile ต้องสร้างใหม่ก่อนเริ่มขาย แต่ session/paid invoice เดิมยังตรวจผล/เปิดเอกสาร/เปิดสิทธิ์จากหลักฐานเดิมได้ ไม่เพิ่ม prerequisite ให้ paid fulfillment/recovery/การยกเลิก/บัตร/ประวัติ และไม่แก้เอกสารที่ออกแล้ว
- Expired owner ต้องเข้าถึงข้อมูลร้านที่จำเป็นต่อการซื้อใหม่ได้ รวมถึงค้นหาที่อยู่ไทยจากรหัสไปรษณีย์ในฟอร์ม โดยคง membership/owner/permission/tenant/security holds; ไม่เปิด business routes ให้บริษัทหมดอายุทั่วไป
- แท็บบัญชีของฉันยังบันทึกเบอร์มือถือ ตั้งรหัสผ่านแรก และเปลี่ยนวิธีเข้าสู่ระบบด้วยอีเมลได้เมื่อบริษัทไม่มีแพ็กเกจ โดยผ่านสิทธิ์บัญชีเดิม

Acceptance: shared rules + HTTP direct bypass/stale/error/race + Stripe payload new/existing + actual company-form→billing browser mobile/desktop + existing billing/LINE/signup regression. Provider simulation ต้องระบุแยกจาก Stripe sandbox/live; ไม่มี deploy หรือ charge จริงในงานนี้

อ้างอิง: [Stripe Customer billing address](https://docs.stripe.com/invoicing/customer), [Customer parameters](https://docs.stripe.com/api/customers/create); implementation must preserve repository-pinned Stripe version and existing recovery journals.
