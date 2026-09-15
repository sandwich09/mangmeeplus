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

สถานะปิดงานล่าสุด2026-09-15: มติวันแถมและอายุประวัติเมลได้รับอนุมัติและเขียนโค้ดแล้ว. CT22 พัก/กลับมาเก็บเงินมีคำขอผ่าน Admin พร้อมตรวจบิลเดิม/ผู้อนุมัติ/ผล Stripe; ไม่มี Owner question ค้าง. Local clean integration ผ่านตาม final-integration-result.json; รอ final CI และ Admin merge ทั้งสอง repo.

- วันแถมเลื่อนทั้งวันใช้งานและวันเก็บ Stripe เท่ากัน; ไม่เพิ่มใบเสร็จ/AI. ซื้อซ้ำคงวันครบรอบที่เลื่อน, ยกเลิกและ downgrade ที่รอไว้ยังคงอยู่.
- ประวัติเมลทั่วไปเก็บ180วัน, cleanupOFF; Admin เปลี่ยนผ่านเว็บได้. เก็บ original send/dedupe/suppression/audit/งานค้างต่อ; ไม่เปลี่ยน retention ใน Postmark.
- AP02–AP04 เพิ่ม proof หน้า Admin preset/child/CAS/retry/cascade/normalization จริง; package tier, role และ launch gate เป็นคนละชั้น. การเปลี่ยน entitlement ไม่ใช่การเปิด feature launch ที่ปิดอยู่.
- AP21–AP24 ตรวจ receipt/signature/current LINE source และการกู้ delivery ผ่านชุดเฉพาะและ regression; native LINE/LIFF บนอุปกรณ์จริงยังเป็น acceptance ก่อนเปิดบริการ ไม่ใช่ผลจำลอง.
- CT01–CT32+CT24a มี33กลุ่ม, AP01–AP24มี24กลุ่ม รวม57กลุ่ม acceptance; ไม่ใช่57business flowsหรือเปอร์เซ็นต์. ดู [mappingรายกลุ่ม](final-acceptance-map.md).

ผล native provider/device และการ deploy แยกจาก source/CI acceptance เสมอ. User อนุญาต simulation และสั่งจบที่ merge; ห้ามเปิด LIVE/deploy เพื่อเติมคำว่า PASS.
