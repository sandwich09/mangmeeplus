# C01–C08 implementation map — 2026-09-15

สถานะ: มีโค้ดและหลักฐานตรวจในเครื่องของแต่ละส่วนด้านล่างแล้ว แต่ยังไม่รับรอง CT01–CT32 ครบทุกเงื่อนไขหรือพร้อม merge ทั้งงาน ตารางนี้ใช้แทนการตีความข้อความ “next / pending” ใน checkpoint เก่าว่ายังไม่มี implementation ปัจจุบัน ดู [สถานะงานปัจจุบัน](../../agent-memory/stripe-postmark-implementation-status-2026-09-13.md) ประกอบ

| Control | สิ่งที่ทำและวิธีใช้งาน | หลักฐานของส่วนที่ตรวจแล้ว |
|---|---|---|
| C01 ภาพรวมลูกค้า | ค้นหาบริษัท → แพ็กเกจ/สิทธิ์/สถานะเงิน → invoice/ประวัติ → กลับบริษัทเดิม; trial/manual แสดงได้โดยไม่สร้าง billing account | [Company browser](admin-company-browser-result.json), [ประวัติและส่งออก](history-export-result.json) |
| C02 คิวปัญหา | คิว → ผู้รับผิดชอบ/ผู้สำรอง/กำหนดเวลา → ตรวจหลักฐาน → ปิดหรือเปิดเคสใหม่; SLA เก็บค่าของรอบปัญหาเดิม | [SLA และคิว](support-sla-result.json), [กู้การแจ้งเตือน](delivery-recovery-browser-result.json) |
| C03 ทำงานแก้ปัญหา | จากเคส/รายการเดิม → ดูผลกระทบ → ยืนยัน → คำสั่งถาวร → ตรวจผล/ลองคำสั่งเดิม → กลับบริษัท; แยกผลไม่ทราบออกจากสำเร็จ | [Invoice เดิม](paid-request-result.json), [Checkout เดิม](checkout-observation-result.json), [การแจ้งเตือน](delivery-recovery-browser-result.json), [Refund](refund-command-result.json) |
| C04 สิทธิ์ผู้ดูแล | กำหนดขอบเขตบริษัท → ตรวจรหัสผ่าน/ผู้อนุมัติเมื่อกำหนดไว้ → บันทึก → ถอน/หมดอายุ; ตรวจสิทธิ์ซ้ำเมื่อทำงานจริง | [Scope HTTP](scopes-http-result.json), [Scope browser](scopes-browser-result.json) |
| C05 ตั้งค่านโยบาย | สร้างร่าง → ตรวจผลกระทบ → อนุมัติ → ใช้ทันที/กำหนดเวลา → ตรวจ revision ที่ใช้จริง; ราคา/ใบเสร็จ/สาขา/สมาชิก/VAT ใช้ร่วมกับ marketing และเว็บ/LINE | [Configuration](configuration-browser-result.json), [กำหนดเวลา](scheduled-policy-result.json), [ราคาและใบเสร็จ](offer-terms-result.json), [จำนวนสาขา/สมาชิก](capacity-policy-result.json) |
| C06 เปิด/ปิดบริการ | ปิดขาย/กำหนดกลุ่มลูกค้า/การแจ้งเตือนตามสิทธิ์ → ลูกค้ารีเฟรชและทบทวนใหม่; การหยุดเก็บเงินแยกจากการปิดขาย และงานที่จ่ายแล้วกู้ต่อได้ | [กลุ่มลูกค้า](sales-cohort-result.json), [Configuration](configuration-browser-result.json), [Checkout observation](checkout-observation-result.json) |
| C07 ตรวจเทียบ Stripe | Event/invoice/config/settlement → ค้นหาแบบมีขอบเขต → ดูสิ่งที่ยังไม่ตรง → เคส/คำสั่งเดิม → ตรวจอีกครั้ง; หน้าต่อไปล้มให้ทำต่อจากจุดเดิม | [Provider event](provider-event-result.json), [Discovery](provider-discovery-result.json), [Invoice scan](invoice-discovery-result.json), [Config](configuration-check-result.json), [Settlement](settlement-result.json), [Batch](batch-result.json) |
| C08 ข้อยกเว้นและประวัติ | ปรับแพ็กเกจ/เพดานชั่วคราว เพิ่มใบเสร็จ ปรับ AI หรือคืนเงินตามการอนุมัติ → ดูผู้แก้/เหตุผล/ค่าก่อนหลัง/ผลจริง; สิทธิ์ซื้อและสิทธิ์แถมแยกกัน | [แพ็กเกจชั่วคราว](plan-adjustments-result.json), [ใบเสร็จ paid](admin-receipt-adjustments-result.json), [AI](admin-ai-adjustments-result.json), [Manual plan](manual-plan-result.json), [Manual receipts](manual-receipts-result.json), [Refund](refund-command-result.json) |

ยังต้องทำก่อนรับรองครบ:

- C08 การเพิ่มวันให้ลูกค้าที่จ่ายแล้ว: รอคำตอบเดิมว่าจะเลื่อนวันเรียกเก็บ Stripe ด้วยหรือไม่ จึงยังไม่มีการเดาวันตัดเงิน
- อายุจัดเก็บประวัติเมลในระบบ: รอคำตอบเดิม; การเก็บของ Postmark เป็นคนละขอบเขต ห้ามล้างหลักฐานส่งซ้ำ/งานค้าง/audit ตามการล้างประวัติทั่วไป
- AP21–AP24: ใบเสร็จตรวจ revision/สิทธิ์หลังเก็บไฟล์และบันทึกแบบ transaction ผ่าน [receipt proof](receipt-upload-source-result.json) แล้ว; ลายเซ็น/หลักฐานเสริมตรวจผู้ใช้และ LINE event ก่อนบันทึกผ่าน [signature proof](signature-upload-access-result.json) แบบจำลองแล้ว. คำถาม/ลำดับเดิมและ source ของงานก่อนหน้านี้มีผลใน evidence; ยังต้องเทียบ acceptance รวมกับ native LINE/LIFF แยกต่างหาก
- CT01–CT32 และ AP01–AP24 ต้องเทียบกับผลรวมของ source ปัจจุบันและ acceptance ที่ยังขาด; ชุดย่อยมีกรณีซ้ำกัน จึงห้ามบวกจำนวนเป็นเปอร์เซ็นต์หรือจำนวน business flows
- หลักฐานในตารางมีทั้งผลเก่าและผลล่าสุด แต่ละไฟล์บอก source และข้อจำกัดของตนเอง การผ่าน simulation ไม่แทน native LINE/LIFF/provider และไม่แทน final CI

[แพ็กเกจครบ12แบบและฟอร์ม Admin หลัง429](billing-label-offer-matrix-result.json) ผ่านแบบจำลองในเครื่องแล้ว; ผลนี้ไม่ใช่ native LINE/LIFF และไม่แทนทุก CT/AP.

CI ยังรวบไปรันเมื่อพร้อมเพื่อลดค่าใช้จ่าย งานนี้ยังไม่ push/merge/deploy

Current follow-up: [combined308](combined-upload-access-result.json) includes the12-offer matrix and forced429 recovery. [Admin budget safety/Thai UI](admin-budget-input-result.json) then passes12 focused browser/HTTP/PG groups and75 unit/error guards. Invalid nonempty amounts cannot clear a company override; platform read failure has a reload path. No full CT/AP/native or clean-CI closure is inferred.
