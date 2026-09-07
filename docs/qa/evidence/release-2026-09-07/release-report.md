# ผล deploy MangmeePlus — 7 กันยายน 2026

Production deploy สำเร็จและ public customer gate เป็น **OPEN**. ยังรอ acceptance ของบัญชีผู้ดูแลปัจจุบัน จึงยังไม่ถือว่าปิดงาน release ครบทุกขั้นตอน

| ขั้น | Run | ผล |
| --- | --- | --- |
| UAT | [34068520561](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34068520561) | SUCCESS; signed Passport |
| Production READY | [34076680047](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34076680047) | SUCCESS; live / OWNER_OVERRIDE |
| Production | [34078121808](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34078121808) | SUCCESS; signed PROMOTED_LIVE |

- Application source: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`; controller: `3720db9a2414bd671c63be3fdd69270487f1402a`.
- Production workflow จบ 11:03:56 น. (Asia/Bangkok); canonical result validator และ cosign identity ผ่าน.
- Admin merge [PR #472](https://github.com/MangmeeDev/mangmeeplus/pull/472) หลัง CI ครบแล้ว; sender fix อยู่ทั้ง develop และ main.
- แก้ env ผู้ส่งอีเมลว่างที่ทำให้ API บูตไม่ผ่านในรอบก่อน โดยยังคง `EMAIL_PROVIDER=disabled`.
- [Migrations ทั้ง 15 ตัว](./production-migration-execution.json) ลง Production สำเร็จ. Durable operation `55d9d582-628f-4204-9515-2ac799187e19`; finalization job ผ่าน.
- [สถานะ AWS](./production-platform-final.json): ทั้งสามบริการ ACTIVE / revision เดียว / live / exact UAT image; ไม่มี current deployment, มี service tasks 3 ตัว และ alarms OK ทั้ง 15 ตัว.
- READY ซ้อม migrations บน clone ผ่านและล้าง resource เหลือศูนย์; ตรวจไม่พบ clone หลัง READY แล้ว.

## Config และ AI

[ตารางเทียบครบทุก key](./config-parity-after.md) ครอบคลุม 253 รายการ config และ 17 secret references จาก GitHub, API/Web, AI Gateway, workers และ AgentCore. ไม่มี runtime key ขาดฝั่ง Production และไม่มีความต่างที่ยังอธิบายไม่ได้; ค่า secret ไม่ถูกบันทึก.

- LINE signup, external signup, AUTO_FREE, receipt quota และ LINE draft edit เปิดเหมือน UAT.
- AgentCore Production version 25 และ UAT version 54 ใช้ artifact เดียวกัน; env ทั้ง 39 key ตรงตาม signed bindings โดยต่างกันเฉพาะ identity/URL/secret references ของ environment.
- Prepared read, fused plan, deterministic families และ draft editing เปิดใน runtime จริง. Chat และ document model เป็น Sonnet 4.6 เหมือนกัน.
- [Production AgentCore smoke](./production-agentcore-smoke-evidence.json) เรียก Sonnet 4.6 จริงสำเร็จ HTTP200 และปฏิเสธ mutation ด้วยตัวตนจำลอง; ไม่ใช่หลักฐานว่าดึงข้อมูลลูกค้าจริงสำเร็จ.
- ส่งเมล Production ยังปิดตามคำสั่ง owner; email claim/verification journey ยังพักไว้. URL, LINE channel/LIFF, DB, Redis, S3, role และ security controls เป็นของแต่ละ environment.

## หน้าเว็บและ LINE

[Hosted checks](./production-hosted-checks.json) ผ่าน: deep DB, signup availability, LINE login, LINE signup identity guard, signup/start/employee LIFF pages, signup/welcome/claim-account pages และ LINE provider webhook verification. LIFF ทั้งสามหน้าใช้ Production app `2011037668-9U7Pc6SJ`.

[Public readback](./production-public-open.json) ได้ `OPEN` และหน้า login200 พร้อม marker open. ไม่มีการเขียน gate ซ้ำ. OA Production ยืนยันเป็น `@458wpnio`.

ยังไม่ได้ทำรายการสมัครหรือ J1–J4 แก้บิลผ่าน LINE บนมือถือจริง และไม่ได้ส่งข้อความหรืออีเมลหาลูกค้าเพื่อทดสอบ.

## Acceptance ผู้ดูแลที่ยังค้าง

Runbook เดิมอ้าง `thawatchai.watchdog` แต่ [signed REVOKE run 32843219991](https://github.com/MangmeeDev/mangmeeplus/actions/runs/32843219991) ยืนยันว่าปิด credential บัญชีนี้และเพิกถอน session แล้วเมื่อ25สิงหาคม. การ login401 จึงตรงกับการเลิกใช้บัญชีเดิม; ไม่มีการ reset หรือเปิด credential คืน.

บัญชีปัจจุบันคือ `prodmangmeeplus`, user id `cmt8k20fs00000q319isxwkc5` ตาม signed ADD run32840045983. ต้องปลดล็อก Mac และ login บัญชีนี้ผ่าน browser เพื่อยืนยัน role/permission, gate readback, logout204 และ post-logout401. ไม่ต้องส่งรหัสผ่านในแชต. ได้เตรียมแก้ runbook ใน checkout แยกแล้ว แต่ยังไม่ commit/push ระหว่างรอ acceptance; main ยัง frozen.

Legal basis เป็น owner override `OWNER-DIRECTIVE-2026-09-07-UAT-PROD-PARITY`; legal manifest ยังคง BLOCKED และไม่ได้ถูกเปลี่ยนเป็น VERIFIED.

## Archive digests

- Passport: `sha256:752c9bb1bfaf55ac82b9268c2c1613f73db3c3d021de8736f5c6d0416794db79`
- READY: `sha256:1ed9e9af6c1d9abcadd634c46210b95c2e063e2afb2ca97b10b2031e9cf0cd94`
- Result: `sha256:5f3f8496b812a484e4be7ec48147f4244d238b403f087a73e0ca6c6e7017b821`
- Controller evidence: `sha256:02c9e2c7c21d7f5f32a0edab6f89311a76081c51d1df9a86f1eb7975a2c426a0`

Controller JSON และ release-operation JSON เป็น snapshot ตอนเริ่ม/เตรียมงาน (`PRE_MUTATION` / `HELD_FOR_ROLLOUT`); อย่านำไปอ้างว่า DB ไม่มี operation หรือยังไม่ finalize. [Workflow evidence](./production-run-34078121808.json) ยืนยัน finalization ผ่าน 11:03:47 น.; signed result ยืนยันผล promote.
