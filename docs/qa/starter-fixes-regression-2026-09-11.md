# Starter: ผลแก้ไขและทดสอบผลกระทบใน local — 11 กันยายน 2026

สถานะ: แก้ข้อพบ F01/F02/F03/F05/F06/F07/F08/F09/F10/F11 และทดสอบซ้ำในขอบเขต local แล้ว; เคส provider/LINE/mail จริงยัง BLOCKED ตามการปิดรอบที่เจ้าของอนุมัติ ไม่ได้อ้างว่ารันทุก combination หรือทุกบริการภายนอกผ่าน

ฐานงาน: main `07824efc9dd6c53c926b7f275a16581f97b8266e` → branch `codex/starter-qa-fixes-20260911` ใน worktree `mangmeeplus-main-starter-qa-20260911` ใช้ web 3000, API 3001, AI Gateway 3002 และฐาน `watchdog_starter_qa_20260911` ผลทดสอบนี้บันทึกก่อน commit/push; สถานะรวม branch ติดตามใน task memory

อ้างอิง: [รายงานก่อนแก้](main-starter-web-qa-2026-09-11.md), [กติกาที่เจ้าของอนุมัติ](../specs/starter-web-qa-fixes-spec.md), [แผน](../plans/starter-web-qa-fixes-plan.md)

## กติกาที่นำมาใช้

- เริ่มต้นคือ feature preset 7 เมนู แยกจากแพ็กเกจราคา; บริษัทใหม่ที่ไม่ได้ระบุ preset เริ่มด้วย starter และบริษัทเดิมเก็บสิทธิ์เดิมไว้
- Admin ปรับค่าตามขอบเขตเดิมได้ มีค่าเดิม → ค่าใหม่ก่อนบันทึกสำหรับเมนู โควตา งบ AI/OCR และวันต่ออายุ โดยคง validation เดิม
- AI เห็นและใช้เฉพาะข้อมูล/การทำงานที่สิทธิ์ปัจจุบันอนุญาต การถอนสิทธิ์มีผลต่อ template, งานรอสร้าง, ผลลัพธ์เก่า และการนำผลไปใช้
- ต้นทางสำรองจ่ายกับรายการบัญชีจากใบเบิกนับเป็นค่าใช้จ่ายเดียว แยกตัวตนเอกสารเดิมไว้ และแสดงสถานะเบิกคืนจริง
- ผู้รับเงินภายนอก/ไม่มีบัญชีจัดการนอกระบบ เก็บเฉพาะข้อมูลที่ระบบมีอยู่ ไม่สร้างการเชื่อมตัวตนหรือ flow เบิกใหม่

## ผลปิดข้อพบและผลกระทบที่ตรวจเพิ่ม

| ข้อพบ | ผลหลังแก้ | หลักฐานหลัก |
|---|---|---|
| F01 ความหมาย starter | บริษัทใหม่ใช้ 7 เมนู; เปลี่ยนราคาเป็น PRO ยัง 7; ไม่ rewrite บริษัทเดิม | [admin PRO + starter](evidence/starter-web-20260911/fixes/admin-pro-starter7.png) และ onboarding tests |
| F02 หัวข้อ admin ซ้ำ | React sibling keys แยกตาม section; เปิด/แก้/ยกเลิกแล้วไม่เกิด section ซ้ำ | [ฟอร์มก่อน–หลัง](evidence/starter-web-20260911/fixes/admin-before-after-100-to-101.png) |
| F03 ข้อความเกินโควตา | สาขาที่ 2/สมาชิกที่ 3 แจ้งเพดาน 1 สาขา/2 คนชัดเจน; ยกเลิกฟอร์มแล้วล้าง error; เลข 0 ไม่ผ่านทั้ง UI/API | [โควตาพนักงาน](evidence/starter-web-20260911/fixes/employee-quota-limit2.png) |
| F05 ยอดซ้ำและต้นทางค้าง | รวม 125 ครั้งเดียว รอตรวจ 0; ต้นทาง “จ่ายคืนแล้ว” อ่านอย่างเดียว มีลิงก์ใบเบิก | [ยอดรวม](evidence/starter-web-20260911/fixes/expense-cost-once-and-source-progress.png), [ต้นทาง](evidence/starter-web-20260911/fixes/paid-source-readonly.png) |
| F06 สิทธิ์บางส่วนดูเหมือนไม่มี | แสดงสิทธิ์เดิม 21 รายการของ STAFF ที่ไม่ได้ตรงทั้งชุดงาน และคง grants เดิมเมื่อแก้บทบาท | browser เปิด editor/ยกเลิก + employee-access/role tests; รายละเอียด permission บางรายการยังเป็น key สำหรับตรวจสอบ |
| F07 งานแจ้งเตือนค้าง | source จบแล้วแสดง “ดำเนินการแล้ว”; history/read state คงอยู่; ย้อนจ่ายเปิดงานพร้อมจ่ายกลับ และจ่ายใหม่ปิดงาน | [งานเสร็จ](evidence/starter-web-20260911/fixes/owner-resolved-notifications.png), [ย้อนจ่าย](evidence/starter-web-20260911/fixes/payment-void-reopens-task.png) |
| F08 คู่มือไม่ตรงเว็บ | 8 เมนูย่อยรวมลายเซ็น, VAT ตามเอกสาร, ชื่อแท็บ “รายการที่เกี่ยวข้อง”; ไม่มีขั้นไปเลือก Tax Code/ปุ่มลงบัญชีที่ซ่อนอยู่ | [คู่มือ](evidence/starter-web-20260911/fixes/updated-expense-guide.png), guide shortcut tests |
| F09 ส่งออกขาดหลักฐานต้นทาง | Excel เต็ม 48 คอลัมน์มีผู้เบิก ผู้จ่าย แหล่งเงิน ผู้ขาย/เลขเอกสารเดิม และ provenance; manifest มีไฟล์ต้นทาง 2 ไฟล์ | [Excel](evidence/starter-web-20260911/fixes/claim-index-full.xlsx), [ค่าที่ตรวจ](evidence/starter-web-20260911/fixes/claim-index-checked-facts.json), [manifest](evidence/starter-web-20260911/fixes/claim-evidence-manifest.json) |
| F10 AI เกินสิทธิ์/เมนูหาย | Starter มี AI แนะนำ; owner ได้ guidance 6 ทาง staff 3 ทาง; template ที่ source permission ไม่พอไม่แสดง/ส่งไม่ได้; ข้อมูลเก่าตรวจสิทธิ์ซ้ำ | [staff AI](evidence/starter-web-20260911/fixes/staff-ai-permission-guidance.png), [staff ถูกกั้น evidence](evidence/starter-web-20260911/fixes/staff-evidence-denied.png), AI access tests |
| F11 ไฟล์ยกเลิกดูเป็นหลักฐานปัจจุบัน | เก็บ 3 ไฟล์เป็นประวัติ SUPERSEDED รวม scan ที่ยกเลิกก่อน issued; ไม่ใช้ยืนยันเอกสารใหม่หรือเติมช่องหลักฐานปัจจุบันใน Excel | [ประวัติบนเว็บ](evidence/starter-web-20260911/fixes/cancelled-certificate-history.png), [manifest ประวัติ](evidence/starter-web-20260911/fixes/cancelled-evidence-manifest.json), [Excel](evidence/starter-web-20260911/fixes/cancelled-index-full.xlsx) |

ผลกระทบต่อเนื่องที่พบระหว่างแก้และปิดเพิ่ม:

1. การเติมหลักฐานใบแทนทำให้ขั้น preflight กับ transaction ยืนยันเห็นไฟล์คนละชุด จึงปรับให้อ่านชุดเดียวกันภายใต้ transaction และเพิ่ม regression ที่มีประวัติใบแทนยกเลิก ไม่ข้าม checksum/locking
2. สถานะ resolved หายระหว่าง API DTO และ web normalization แก้ให้ส่งต่อครบทั้งหน้าแจ้งเตือนและ bell
3. กดแจ้งเตือนขณะอยู่หน้าใบเบิกเดิมไม่เปลี่ยนแท็บ และเปิดใบเดิมซ้ำไม่ได้หลังปิด drawer แก้ให้ query เลือกคิว/ใบเบิกและล้าง focus เมื่อปิด; [ทดสอบเปิดคิวการเงิน](evidence/starter-web-20260911/fixes/notification-reopens-finance-drawer.png)
4. Toast โควตาถูกต้องแต่ inline error ใน wizard ยัง generic แก้ให้ใช้ข้อความเดียวกันโดยรักษา conflict fields เดิม
5. ผลส่งออกเคยใช้เลขใบเบิกในคอลัมน์เลขเอกสารผู้ขาย ปรับให้อ่าน snapshot ต้นทาง; ตรวจ `QA1109-001` ตรงกับ input ของ EXP00001 บนเว็บ
6. หน้าหลักฐาน/รายละเอียดและคู่มือแสดงงานลงบัญชีที่ผู้ใช้ทำไม่ได้ ปรับการแสดงผลตาม capability เดิม ไม่เปิดสิทธิ์ ledger เพิ่ม
7. กรณีข้อมูลต้นทางหรือไฟล์ไม่อยู่ใน scope/หาไม่พบ/checksum ไม่ตรง ต้องขึ้นคำเตือนหลักฐานต้นทางไม่พร้อม ห้ามแทนด้วยไฟล์ที่เพิ่มภายหลังหรือถือว่าครบ

## Browser regression ที่รันจริง

ใช้ Chrome แท็บ QA แยก admin `127.0.0.1:3000` กับ owner/staff `localhost:3000` ทุก mutation เป็นข้อมูลจำลอง local

- Admin สร้าง “QA Starter Fix 1109” จากฟอร์มจริง ไม่เลือก feature preset; ได้ 7 เมนูทันที แล้วเปลี่ยนแพ็กเกจราคาเป็น PRO (5 สาขา/10 สมาชิก/100 สลิป) แต่ยัง 7 เมนู
- บริษัท “QA เริ่มต้น 1109” เดิมยังคงชุดสิทธิ์เดิม เปลี่ยนโควตาสลิป 30→31 บันทึก/ตรวจผลแล้วคืน 30; ทดลอง 0 ถูกปฏิเสธ; preview 100→101 ในบริษัทใหม่แล้วกดยกเลิก ค่าคง 100
- แสดงวันหมดอายุเดิม→ใหม่ก่อนต่ออายุ แล้วกดยกเลิก ไม่เพิ่มวันจริงในรอบตรวจสุดท้าย; [ภาพ](evidence/starter-web-20260911/fixes/admin-renew-before-after.png)
- เพิ่มสาขาที่ 2 และสมาชิกที่ 3 ถูกปฏิเสธด้วยข้อความเพดานที่ถูกต้อง; retry ไม่สร้างสมาชิกเกินโควตา
- เปิดแก้บทบาท STAFF เห็น 21 สิทธิ์ที่คงไว้ กดยกเลิก; staff เข้า AI เห็นเฉพาะคำแนะนำตามสิทธิ์และเปิด URL evidence โดยตรงถูกกั้น
- OWNER dashboard ยืนยันแล้ว 125, รอตรวจ 0, ค้างจ่าย 0; expense list นับต้นทาง/ใบเบิก 125 ครั้งเดียว ทั้งก่อนและหลังทดสอบย้อนจ่าย
- ต้นทาง EXP00001 อ่านอย่างเดียว สถานะจ่ายคืนแล้ว ลิงก์เปิด RB00001 ได้ พร้อมเห็นไฟล์ 2 ไฟล์และยอดคงค้าง 0
- ย้อนรายการจำลอง RBPAY00002: RB กลับพร้อมจ่าย งานแจ้งเตือนเดียวกันกลับเป็น “ต้องดำเนินการ”; งานอนุมัติ/ตรวจการเงินเดิมยัง resolved
- เปิดคิวผ่านแจ้งเตือนโดยอยู่ในหน้าเดิม ปิด/เปิดซ้ำได้ จากนั้นบันทึก RBPAY00003 จำนวน 125 เงินสด อ้างอิง `QA-LOCAL-REGRESSION-1109`; สถานะกลับ PAID และงานพร้อมจ่าย resolved
- Evidence ของ EXP00002 แสดงครบถ้วน 1 รายการ/125 บาท/ต้องตรวจเพิ่ม 0; ดาวน์โหลด Excel เต็ม 48 คอลัมน์ + manifest 2 ไฟล์จาก UI และอ่านไฟล์จริง
- EXP00003 ยกเลิกแล้วแสดง scan/PDF/ใบแทนเป็นประวัติ; filter VOIDED แจ้งไม่มีไฟล์ปัจจุบันแต่มีประวัติ; export manifest 3 ไฟล์มี `substitute.history`, `is_historical=true`, `SUPERSEDED` และช่อง current evidence ของ Excel ว่าง
- เปิดทุกหัวข้อคู่มือค่าใช้จ่าย/เบิกจ่าย ตรวจชื่อเมนู ลายเซ็น VAT และลิงก์ตามสิทธิ์; รีโหลดหลังแก้และตรวจภาพหน้าจอจริง

การทดสอบขอบเขตบริษัท/สาขา การถอนสิทธิ์ AI ระหว่างคิว การเปิดผลเก่า และ race/idempotency ตรวจด้วย automated checks เพิ่มจาก browser ไม่ได้อ้างว่าเรียก provider จริง

## Verification

| ชุด | ผล |
|---|---|
| Expense 53 spec files | 1,245 ผ่าน, 0 fail, 6 PostgreSQL cases ถูก skip เพราะรอบแรกไม่ตั้ง DATABASE_URL |
| PostgreSQL payment rerun | 25 ผ่าน/0 skip รวม 6 cases ข้างต้น: concurrent same/different intents, rollback audit/outbox, replay หลังถอน scope/void |
| AI + notifications + onboarding | 253 ผ่าน, 0 fail |
| Web expense/AI/admin/roles/notifications/reimbursements | 648 ผ่าน, 0 fail |
| Guide links | 7 ผ่าน, 0 fail |
| Focused document/export หลังแก้รอบสุดท้าย | 39 + 12 ผ่าน, 0 fail (ซ้ำบางส่วนกับชุดด้านบน) |
| Contracts build / API SWC build | ผ่าน |
| Web TypeScript / API production-source TypeScript | ผ่าน; API ใช้ Node heap 8 GiB และไม่รวม historical spec typings |
| Diff whitespace / package.json | `git diff --check` ผ่าน; ไม่มี package.json/dependency changes |

[คำสั่งและผลสรุป](evidence/starter-web-20260911/fixes/verification-summary.txt) เก็บจำนวนแต่ละชุด ไม่บวก rerun เป็นจำนวนเคสไม่ซ้ำ Full API typecheck ที่รวม historical specs เคยชน heap 4 GiB; ไม่อ้างว่าผ่านทั้ง repository โดย specs ถูก execute แยกด้วย tsx และ source production typecheck ผ่าน

## ขอบเขตที่ยังไม่ทดสอบ

- BLOCKED: OCR/AI เรียก provider จริง ความแม่นยำ การคิด usage/budget และ provider failure/recovery; local ไม่มี sandbox พร้อมใช้
- BLOCKED: LINE login/link/callback/LIFF/webhook/ส่งใบเสร็จ/ส่ง notification จริง; ไม่มี test channel
- BLOCKED: อีเมล verification ส่งรับจริง; ไม่มี mail sandbox
- ไม่ได้รันซ้ำ exhaustive: ทุก file type/size/page limit, ทุกแขนงแก้ใบแทนหลัง issued, transfer payout, multi-source claims ทุกแบบ, export >500, ทุก expiry/rate-limit boundary, archive/reactivate และ multi-branch browser success ดู coverage เดิมประกอบ
- F04 ยังคงเป็นข้อจำกัด PDF viewer ของ in-app browser ที่รายงานเดิมแยกไว้ Chrome และไฟล์ PDF เดิมเปิดได้ ไม่รวมเป็น product fix
- ไม่แตะ UAT/Production หรือการจ่ายเงินจริง

## สถานะส่งต่องาน

เก็บ code/docs/evidence ใน branch ข้างต้นและเปิด local ไว้ให้ตรวจต่อ บริษัทใหม่ “QA Starter Fix 1109” ยังเป็น PRO + starter 7 เมนู บริษัทเดิม “QA เริ่มต้น 1109” ยัง limit 1/2/30 และ RB00001 จ่ายครบด้วย RBPAY00003 รายการจ่ายเดิม 00001/00002 เป็น VOIDED พร้อมเหตุผล ไม่มีคำถามด้านกติกาผลิตภัณฑ์ที่ต้องรอเจ้าของในขอบเขตนี้


หมายเหตุหลักฐานใน Git: ตัด query ที่มีลายเซ็นดาวน์โหลด local ออกจาก manifest ก่อนเผยแพร่ เก็บชื่อไฟล์ checksum provenance และเวลาหมดอายุไว้ หลักฐานนี้ใช้ตรวจผล ไม่ใช่ลิงก์ดาวน์โหลดที่ต่ออายุให้ใช้งาน
