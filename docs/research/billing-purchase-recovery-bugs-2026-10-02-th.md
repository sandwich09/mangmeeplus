# ผลตรวจและแก้เส้นทางซื้อแพ็กเกจ — 2 ตุลาคม 2026

สถานะ: แก้บัคที่ยืนยันได้ครบตามขอบเขตนี้ และตรวจซ้ำผ่าน; พร้อม review ใน branch `codex/billing-purchase-recovery-20261002`

ขอบเขต: ทดลองใช้, หมดอายุ/ถูกปิดโดยระบบตามอายุ, ซื้อครั้งเดียวแบบเต็มและส่วนต่าง, เริ่มใหม่จากสมาชิกเดิม, การเปลี่ยนผู้รับเอกสาร, ประวัติชำระเงิน และ workspace/auth/สิทธิ์/โควตาที่กระทบการซื้อ งานทั้งหมดอยู่ใน worktree จาก main `f20a1101e6ef5a827b2054eaa887c6cbbd984826` ไม่เปลี่ยนข้อมูลลูกค้าหรือ deploy

## บัคและผลกระทบที่ยืนยัน

| จุด | สาเหตุ/ผลก่อนแก้ | Dependency impact | วิธีแก้และหลักฐาน |
|---|---|---|---|
| ปุ่มไม่ตรงกับ API | status ยังเสนอซื้อขณะเปลี่ยนผู้รับเอกสาร หรือมีข้อมูลแพ็กเกจที่ quote ปฏิเสธ | เกิด error หลังเลือกราคา ทั้งเต็มและส่วนต่าง; ผู้ใช้ไม่รู้ว่าจะจัดการที่ใด | ใช้ purchaseBlockCode จากเงื่อนไขท้องถิ่นเดียวกัน; แสดงข้อความและทางไปจัดการ/ตรวจสถานะ |
| คำขอแอดมินเปลี่ยนผู้รับเอกสารชนการซื้อ | คำขอ ADMIN มี drain แยก ไม่ตั้ง activeEmailOperationId จึงหลุด guard ของ quote/Checkout | อีเมล/Customer ของเอกสารอาจเปลี่ยนขณะเปิดรายการชำระ | ตรวจ pendingAdminRecipientChange ทั้งก่อน quote และใน transaction ของ Checkout; ทดสอบคำขอเกิดหลัง quote ว่าไม่สร้าง attempt |
| เริ่มใหม่จากสมาชิกหมดอายุ | status ไม่ตรวจ FINANCIAL_REVIEW และ refund/unapplied/dispute history ที่ restart ต้องตรวจ | โฆษณาปุ่มที่ quote ปฏิเสธ; สมาชิกยังเรียกเก็บได้/grace ต้องจัดการรายการเดิม | shared cheap local restart preflight; คงการตรวจ Stripe subscription/debt/charge ทุกครั้งก่อนการเงิน; ตัด invoice ของสมาชิกใหม่ออกใน apply retry |
| แพ็กเกจครั้งเดียวที่คืนเงินแล้ว/ข้อมูลไม่ครบ | status ไม่ตรวจ active paid source; snapshot {} หลุดอ่าน quote.offer เป็น 500 | BASIC เต็มและส่วนต่างกดได้แต่ซื้อไม่ได้; financial source ต้องให้ทีมงานตรวจ | shared oneTimeSourceReady ตรวจ invoice/account/attempt/period และ offer shape; คืน stable review code ก่อนเสนอปุ่ม/รับชำระ |
| quote อายุยาวกว่าต้นทาง | quote 10 นาทีอาจเลยเวลาหมดอายุของ one-time source ซึ่งจะเปลี่ยนเป็น RESTART | สรุปเงื่อนไขเดิมยังค้างหลังโหมด/เมนู/การเลือก capacity เปลี่ยน | clip expiresAt ถึง paidThrough และตรวจ source ยังไม่หมดอายุใน Checkout ทุก one-time kind; baseline stale Checkout fixture ถูกปฏิเสธอยู่แล้ว จึงไม่อ้างว่าพิสูจน์การเรียกเก็บผิดสำเร็จ |
| หน้าค้างข้ามวันหมดอายุ/กลับแท็บ | โหลด status ครั้งแรก แต่ refresh เฉพาะ catalog; เหตุการณ์ระหว่าง status read อาจถูกทิ้ง | ปุ่ม disable ผิดโหมด/คำขอเสร็จแล้วกลับมาซื้อไม่ได้; quote เก่าค้าง | refresh ที่ paidThrough/term/grace และ focus/visibility; เก็บ event ที่เข้าระหว่าง read; ตรวจ stale request ไม่เขียนทับสถานะใหม่ |
| workspace พาออกจากหน้าซื้อ | business context read หลังหมดอายุเรียก redirectToCompanyRenewal แม้อยู่ billing recovery; shell เดิมไม่สังเกต expiry | หน้าซื้อ/return/document ถูกพาออกโดย module อื่น | ใช้ recovery-path contract เดิมยกเว้น navigation redirect แต่ยังคืน business 403; billing shell re-read notice เมื่อหมดอายุ/กลับแท็บ; Chromium ยืนยันยังอยู่ URL billing และ business API ยังล็อก |
| history endpoint ล้มหรือตอบค้างแล้วซื้อไม่ได้ | Promise.all ของ status/catalog/history เคลียร์หน้าถ้า history พัง และยังรอประวัติที่ไม่ตอบ แม้ status/ราคาพร้อมแล้ว | บริการเอกสารที่ไม่จำเป็นต่อเริ่มซื้อทำให้เส้นทางซื้อหาย | โหลด history แยกพร้อม loading/error/retry; 401/403 ยัง fail closed; Chromium จำลองทั้ง 503, pending response และผล permit เก่าที่มาหลัง denial ใหม่ |
| ปิด plan_changes แต่ one-time ปุ่มอัปเกรดยังเปิด | หน้าไม่รู้ gate ของการเปลี่ยนแพ็กเกจระหว่างรอบ; API ปฏิเสธหลังคลิก | BASIC แบบเต็มและส่วนต่างเข้าเส้นทางซื้อไม่ได้ ทั้งที่ซื้อแพ็กเกจเดิมเพิ่มยังได้ | additive packageChangesEnabled; ปิดเฉพาะบัตรที่เปลี่ยน tier/cadence พร้อมเหตุผล และคง repeat; HTTP และ Chromium ตรวจแยก |

## กรณีคืนเงินแล้ว reset

การคืนเงินและ end-package/reset มี hotfix ใน main/เวอร์ชันที่ตรวจเหตุการณ์เดิมแล้ว ไม่เพิ่มการล้างประวัติหรือ reset อัตโนมัติจากปุ่มซื้อ การคืนเงินเก่าก่อน hotfix โดยไม่ได้สั่ง endPackage ยังเหลือ active source ที่คืนเงินแล้วได้ กรณีนี้ต้องใช้คำสั่งยุติแพ็กเกจเดิมที่มีอยู่โดยผู้มีสิทธิ์ จากนั้นจึง RESTART ได้ การแก้รอบนี้ทำให้หน้าแจ้งเหตุที่ถูกต้องและไม่ชวนเปิดรายการที่ซื้อไม่ได้

## กรณีซื้อไม่ได้ที่เป็นกติกาปัจจุบัน

- ทดลองใช้ทั้งก่อน/หลังหมดอายุ และบริษัทที่ถูกปิดโดยระบบตามอายุ: เจ้าของยังเข้า billing เพื่อซื้อได้; business API ยังตอบ 403 จนชำระและเปิดสิทธิ์สำเร็จ
- บริษัทถูกพักโดยแอดมิน/ไม่มีสิทธิ์/ผิด tenant: ยังคงปฏิเสธการซื้อ ไม่เปิดสิทธิ์จาก UI หรือการกลับแท็บ
- สมาชิกหมดอายุแต่ยังเรียกเก็บได้ มี grace, หนี้, refund/dispute หรือ FINANCIAL_REVIEW: ต้องจัดการสมาชิก/หลักฐานเดิมก่อน RESTART
- ปิด plan_changes: active one-time เปลี่ยน tier/cadence ไม่ได้ แต่ซื้อแพ็กเกจเดิมเพิ่มได้เมื่อ new_sales และโหมดชำระเปิด
- target-specific proration/history/boundary และ provider drift/outage ยังต้องตรวจที่ quote/Checkout; status เป็น preflight ที่รู้เงื่อนไขท้องถิ่น ไม่รับประกันการเงินทุก target

## Fixture drift ที่แยกออกจากบัค product

- Lease/reconciler แตะ updatedAt ได้โดยไม่เปลี่ยน version/การเงิน/สิทธิ์: เปรียบเทียบ field อื่นทั้งหมดแทน metadata timestamp
- รหัสไปรษณีย์ตั้งใหม่จะล้างจังหวัด/เขต/แขวงโดยตั้งใจ: ตั้ง postal code ก่อน dependent fields ในตัวจำลอง
- ชุดทดสอบ AI support คาดข้อความ hold เก่า; ใช้ข้อความปัจจุบันที่ระบุว่าแอดมินพักใช้งาน
- ENTERPRISE เป็น paid tier ที่เปิดแล้ว: กรณี invalid tier ของ manual override เปลี่ยนเป็น FREE_TRIAL_15
- หน้าตั้งค่าการชำระเงินจัดเป็นหัวข้อและ reauth อยู่ที่คำขอที่ดำเนินการได้: ตัวจำลองต้องเปิดรายละเอียดคำขอ/หัวข้อจริง และใช้ข้อความสถานะปัจจุบัน
- OWNER จำลองต้องมี company.plan.manage ตามกติกาปัจจุบัน; ไม่ลด guard เพื่อให้ fixture ผ่าน
- LINE conversation จำลองต้องเป็น current bound context: เก็บ row/ข้อมูลธุรกิจไว้ แต่ invalidate pending state เมื่อพักสมาชิก; legacy context ที่ไม่ผูกช่องทางถูกล้างโดยตั้งใจ
- ชุดรวมใช้ SYSTEM_ADMIN role ร่วมกัน จึงต้องรัน acceptance ตามลำดับ; รอบที่ชนกันไม่ใช้เป็นหลักฐานบัค product
- Layout revalidation อาจกลับ overview แทน chooser: ทดสอบทางเข้าที่แสดงจริงและเลือก cadence เดิมใหม่; ยังคง assert ไม่ auto-charge และไม่ reuse quote เก่า
- ตัวจำลองย้ายวันหมดอายุต้องย้าย invoice periodEnd และ grant serviceEnd/expiresAt ให้ตรงกันด้วย; ไม่ลด upgradeHistory guard เพื่อยอมรับ ledger จำลองที่ไม่สอดคล้อง

## ข้อจำกัดของหลักฐาน

ใช้ Nest HTTP, PostgreSQL และ Chromium จริง แต่ Stripe/Postmark/LINE เป็น provider simulation ไม่ได้ชำระเงินจริง/ทดสอบ native Stripe UI หรือ deploy UAT/Production Provider outage/drift ที่ตรวจได้ตอน quote/Checkout เท่านั้นอาจยังปฏิเสธหลังเลือกแพ็กเกจได้อย่างถูกต้อง; status ไม่เปิด financial provider scan ทุกครั้งที่อ่านหน้า

ผลตรวจ (จำนวนแต่ละชุดมีเคสซ้อนกัน จึงไม่รวมเป็นยอดเดียว):

- ชุดรวม API/PostgreSQL: 266 กลุ่มผ่าน
- เส้นทางลูกค้า Nest HTTP/PostgreSQL/Next/Chromium: 113 กลุ่มผ่าน รวมเปิดสิทธิ์หลังชำระ, refund, restart, capacity, LINE และ receipt quota
- ชุด purchase recovery เจาะจง: 30 กลุ่มผ่าน รวมคลิก BASIC เต็ม/ส่วนต่างไปถึง review/consent, trial/expiry, pending recipient, gate, delayed response, history outage/pending และ permission denial
- เส้นทาง one-time ไม่มีอีเมล/ที่อยู่ล่วงหน้า: 7 กลุ่มผ่าน รวม Checkout/apply, เอกสาร, OTP และ recipient drift
- backend/frontend/PG checks: 146 tests ผ่าน ไม่มี skip; API/web typechecks และ API/contracts build ผ่าน

การเดิน browser แอดมินครบทุกหน้ามีข้อจำกัด: `billing-configuration-drafts-smoke.ts` ยังมี selector/ลิงก์จากหน้ารุ่นก่อน; รอบที่หยุดตรงนั้นไม่ใช่หลักฐานว่ามีบัค product และไม่อ้างว่าผ่านทั้งชุดแอดมิน

ผลรันสุดท้ายและคำสั่งอยู่ใน [task memory](../agent-memory/billing-purchase-recovery-implementation-2026-10-02.md)
