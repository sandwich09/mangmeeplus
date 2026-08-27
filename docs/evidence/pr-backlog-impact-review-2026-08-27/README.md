# ตรวจผลกระทบ PR ค้าง — 27 สิงหาคม 2569

ขอบเขต: เคลียร์ 8 PR ตามคำสั่ง Owner โดยไม่ย้อนโค้ดใหม่ ไม่เปิดฟีเจอร์เพิ่ม ไม่แตะ subscription และไม่ deploy UAT/Production

## เหตุผลที่ค้างและการจัดการ

| PR | ผลตรวจ | การจัดการ |
|---|---|---|
| [#306](https://github.com/MangmeeDev/mangmeeplus/pull/306) | งานสาขา/ยอด/UX ล่าสุด มี local regression และ CI ครบ | merge ปกติหลัง [CI 33069530136](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33069530136) ผ่าน; merge commit `2ed114f2` |
| [#264](https://github.com/MangmeeDev/mangmeeplus/pull/264) | งานสรุป LINE เข้าแล้วทาง #288/#301 พร้อมกฎตัวเลขจาก source ที่แข็งแรงกว่า | ปิด superseded พร้อมหลักฐาน ไม่ย้อนกิ่งเก่า |
| [#268](https://github.com/MangmeeDev/mangmeeplus/pull/268) | `ff024262` อยู่ใน ancestry ของ develop ผ่าน #269/#270 แล้ว; commit ปลายกิ่งเป็น retrigger ว่าง | ปิดงานซ้ำ; ไม่ใช่ dashboard หน้าลูกค้า |
| [#272](https://github.com/MangmeeDev/mangmeeplus/pull/272) | ถูกแทนด้วย #290 ซึ่งเพิ่มกฎให้ลิงก์ SES ใช้ frontend URL จริง; CI เก่าติด checksum เก่า | ปิด superseded; ไม่เปิด SES/claim route |
| [#273](https://github.com/MangmeeDev/mangmeeplus/pull/273) | patch แอป/แพ็กเกจ/infra เท่ากับ `a0b616e3` ที่เข้าแล้วทาง #276; CI เก่าติด checksum เก่า | ปิดงานซ้ำ |
| [#274](https://github.com/MangmeeDev/mangmeeplus/pull/274) | patch เท่ากับ `3cb16603` ที่เข้าแล้วทาง #277; run เก่าจบ `startup_failure` ไม่ได้กำลังรอ | ปิดงานซ้ำ |
| [#275](https://github.com/MangmeeDev/mangmeeplus/pull/275) | category patch เท่ากับ `2076f0c2` ที่เข้าแล้วทาง #277; job เก่าถูกยกเลิกก่อนเทส | ปิดงานซ้ำ |
| [#265](https://github.com/MangmeeDev/mangmeeplus/pull/265) | งานกู้รหัส LINE ยังไม่อยู่ใน develop; พบบั๊ก stale recovery แล้วแก้ | รวม develop ล่าสุด, เทสใหม่, push กลับ PR เดิม; สถานะ CI/merge ล่าสุดอยู่ใน PR |

การปิด PR ซ้ำไม่ได้ลบ branch หรือทิ้งงาน ทุกตัวมีคอมเมนต์ระบุ commit/PR ที่ส่งมอบงานไปแล้ว

ระหว่างรอ #265 รอบแรก CI `33072074916` ผ่านครบ แต่มีงาน #307 เข้า develop ที่ `4e6d2918` จาก task อื่นก่อน merge จึงรวมฐานใหม่นี้และตรวจซ้ำ ไม่ใช้ผล CI เก่ารับรองโค้ดรวม จุด conflict มีเพียง checksum ที่สร้างใหม่จากไฟล์จริง; ไม่ทับงาน LINE ของ #307 และไม่มี diff ของ package manifest เทียบกับ develop ล่าสุด

## บั๊กที่แก้ใน #265

ก่อนแก้: ขอรหัสกู้คืน → ผู้ใช้เปลี่ยนรหัสผ่านแล้ว → รหัสกู้คืนที่ค้างอยู่ยังทับรหัสใหม่ได้ เทสยืนยันด้วย `Missing expected rejection`

หลังแก้: hash ของรหัสกู้คืนผูกกับ credential ณ เวลาขอ รหัสผ่านที่เปลี่ยนโดยผู้ใช้หรือผู้ดูแลทำให้รหัสกู้คืนเก่าใช้ไม่ได้ทันที ตรวจ credential ซ้ำภายใต้ row lock ก่อนใช้ token จึงไม่ทับการเปลี่ยนรหัสที่เกิดพร้อมกัน การขอหลายครั้งถูกเรียงบน row เดิม ไม่เพิ่มตารางหรือ dependency

- ขอรหัสกู้คืนเฉย ๆ ไม่เปลี่ยนรหัสเดิมและไม่เตะผู้ใช้ออกจากระบบ
- ใช้รหัสกู้คืนสำเร็จแล้วจึงเปลี่ยนเป็นรหัสชั่วคราวและให้ตั้งรหัสใหม่ตามโฟลว์เดิม
- บัญชีปิด/ไม่มีสิทธิ์/ไม่มี LINE ไม่ข้ามการตรวจ; มีคำแนะนำติดต่อผู้ดูแลหรือทีมช่วยเหลือ
- การรีเซ็ตพนักงานโดยผู้ดูแลและ LINE login เดิมไม่ได้ถูกแทนที่

## หลักฐานทดสอบ

| ตรวจอะไร | ผล |
|---|---|
| Focused auth/reset/SES | 56 ผ่าน |
| PostgreSQL จริง | lifecycle/concurrency 1 scenario ผ่าน ไม่ skip: ขอพร้อมกัน 4 ครั้งเหลือ 1 pending; ใช้พร้อมกัน 2 ครั้งสำเร็จ 1; เปลี่ยนเอง/ผู้ดูแล/stale snapshot/ปิดสิทธิ์/ส่ง LINE ล้มเหลว |
| API เต็ม | ผ่านทั้ง pretest/test และ rerun หลังรวม #307; ก่อนรวมฐานใหม่ TAP 5,342 ผ่าน / 98 environment-gated skips / 0 fail |
| Web เต็ม | 1,144 ผ่าน, 0 skip |
| API/Web typecheck + build | ผ่าน |
| API card/category/accounting focused | 113 ผ่าน |
| AI composer/orchestrator | 118 ผ่าน |
| Monitoring shell spec | ผ่าน โดยไม่เรียก AWS |
| UI รวมบน 390/1280 px | 25 ผ่าน, 0 fail/skip/flaky; รอบสุดท้าย 23.1 วินาที |
| Login UI เดิม | เพิ่มอีก 5 ผ่าน รวม 30 browser checks |
| PostgreSQL expense/accounting | อีก 44 ผ่าน, 0 skip; พิสูจน์การจ่ายเงิน/เอกสาร/rollback ด้วยฐานข้อมูลจริง |
| Chrome จริง | ส่งคำขอแบบบัญชีไม่ทราบตัวตน → ข้อความกลาง → กลับเข้าสู่ระบบได้ |

คำสั่งทดสอบหลัก: `pnpm --filter @watchdog-bms/api test`, `pnpm --filter @watchdog-bms/web test`, `tsx --test .../auth-endpoints.spec.ts .../notify-password-reset-request.use-case.spec.ts .../forgot-password-reset.use-case.spec.ts`, PostgreSQL `.../line-recovery.pg.spec.ts` ด้วย `AUTH_RECOVERY_TEST_DATABASE_URL`, และ Playwright `e2e/line-recovery.spec.ts e2e/local-active-feature-regression.spec.ts e2e/dashboard.spec.ts e2e/transaction-branch.spec.ts`

รอบ UI แรกพบข้อผิดพลาดใน test harness: ยังไม่เปิดเมนูมือถือก่อน logout และพยายามล้าง legal acceptance ซึ่งเป็น append-only แก้เฉพาะ harness แล้ว rerun ผ่านครบ โดยไม่ลดข้อป้องกันข้อมูล ภาพหลังเข้าสู่ระบบรอ branch/ตัวเลขโหลดครบก่อนเก็บหลักฐาน

หลังรวม #307: รัน API เต็ม, web 1,144 ข้อ, web typecheck และ PostgreSQL 45 ข้อผ่านอีกครั้ง ตรวจ maintenance source ได้ `bytes=verified` ผล API build/typecheck, UI rerun และ CI ของ commit ใหม่ก่อน merge บันทึกต่อในคอมเมนต์ส่งมอบ #265

## ภาพหน้าจอ

- คำขอกู้รหัสผ่าน: [มือถือ](forgot-390.png), [คอม](forgot-1280.png), [Chrome จริง](chrome-forgot-submitted.png)
- บังคับตั้งรหัสใหม่พร้อมทางออก: [มือถือ](forced-change-390.png), [คอม](forced-change-1280.png)
- ตั้งรหัสใหม่แล้วกลับเข้าใช้งาน: [มือถือ](recovered-390.png), [คอม](recovered-1280.png)
- โฟลว์เดิมยังบันทึกได้: [บันทึกด้วยมือ](manual-1280-saved.png), [อัปโหลดพร้อมสาขา](upload-390-saved.png)

## ขอบเขตของหลักฐาน

- API `3035`/web `3036` ใช้สำเนา `watchdog_recovery_review_20260827`; local เดิม `3000`/`3003` และฐานต้นฉบับไม่ถูกแก้โดยงานนี้
- คง 16 ON / 44 OFF; ไม่เปิด feature หรือแก้ schema/package manifest
- PostgreSQL test intercept เฉพาะ transport LINE; browser recovery ใช้ token จำลองในฐานทดสอบ แต่ login/change-password/session ใช้ API จริง ไม่มีการส่ง LINE จริงหรืออีเมลจริง
- legal acceptance จำลองอยู่ในฐานสำเนาและคง append-only; ไม่ปิด trigger เพื่อล้าง fixture
- ภาพ upload พิสูจน์ไฟล์/สาขาและอ่าน byte กลับได้ ไม่ใช่หลักฐาน AI อ่านถูก; provider ใน local ยัง disabled จึงต้องกรอกข้อมูลก่อนส่งตรวจ
- 157 รายการเก่าที่ไม่ทราบสาขายังไม่ถูกเดาหรือย้าย ขอบเขตนี้ไม่ใช่การรับรองว่าสายเชื่อมต่อจริง/ทุก provider พร้อมใช้งาน
- รายงานนี้บันทึกผลก่อน merge; สถานะ exact-head CI และ merge ขั้นสุดท้ายตรวจได้ใน [#265](https://github.com/MangmeeDev/mangmeeplus/pull/265) โดยไม่ต้องแก้ application commit เพื่อบันทึกผล CI ของตัวเอง
