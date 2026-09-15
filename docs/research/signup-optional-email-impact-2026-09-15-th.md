# ผลกระทบเมื่อไม่บังคับ email ตอนสมัคร

> **2026-09-15 follow-up:** ผู้ใช้สั่งทำ [spec](../specs/signup-optional-email-otp-billing-spec-th.md) และ [plan](../plans/signup-optional-email-otp-billing-plan-th.md) พร้อม OTP ผูก/เปลี่ยน email และ gate ก่อนจ่ายแล้ว รายงานด้านล่างเป็น baseline investigation ก่อนข้อกำหนดใหม่นี้ ยังไม่มี implementation ใหม่

วันที่: 2026-09-15
สถานะ: วิเคราะห์และเสนอทางเลือก ยังไม่อนุมัติเปลี่ยน policy / ยังไม่ implement
ขอบเขตหลักฐาน: checkout ปัจจุบัน HEAD `e30bfd4efa82ebf3b2d79636761f6f3e8adc829f` รวม working changes ที่มีอยู่ ไม่ได้ตรวจว่ารุ่นใดกำลังทำงานบน Production

## ข้อเสนอ

ให้ email เป็น optional สำหรับ LINE signup ได้ เพราะใช้ LINE ID token ที่ backend ตรวจแล้วเป็นหลักฐานตัวตนอยู่แล้ว ส่วน web signup ปัจจุบันยังต้องใช้ email รับ claim link ก่อนเปิดบัญชี หากต้องการเว็บแบบไม่มีทั้ง LINE และ email ต้องออกแบบวิธียืนยันตัวตน การกลับเข้า และกู้บัญชีให้ครบก่อน เช่น วิธีที่ยืนยันเจ้าของเบอร์จริง ไม่ใช่เพียงกรอกเบอร์ถูก format

ข้อดีที่คาดหวังคือกรอกสั้นลง เหมาะกับผู้ไม่ใช้อีเมล ลดการกรอก email สมมติหรือของคนอื่น แต่ยังไม่ได้วัด conversion หรือทดสอบกับผู้สูงวัยจริง

## ข้อค้นพบจากโค้ด

| จุด | สภาพปัจจุบันและผลกระทบ | สิ่งที่ต้องรักษาหรือปรับ |
|---|---|---|
| Form / API / contract | LINE form JavaScript, HTTP DTO, domain normalizer และ TypeScript contract บังคับ email หลายชั้น เอา required ที่หน้าเดียวออกยังสมัครไม่ได้ | ปรับให้ตรงกันทุกชั้น; ถ้าเลือกกรอกยังต้องตรวจรูปแบบและความยาว |
| สมัครแล้วกลับมาต่อ | `resumeIntake` หยุดเมื่อไม่มี contactEmail; `canRetryIntake` เป็น false ด้วย ถ้าเปลี่ยน validator อย่างเดียวอาจสร้างคำขอค้าง RECEIVED/VALIDATED แล้วไปต่อไม่ได้ | เปลี่ยนเงื่อนไขความครบตามช่องทาง/policy; lost response, refresh และ retry ต้องลงคำขอ/ร้านเดิม |
| Web signup | ส่ง claim link ทาง email, claim และ `emailOwnerShape` ต้องมี contactEmail | คง email required สำหรับ flow นี้ จนกว่าจะมีเส้นทางยืนยันและกลับเข้าทดแทนที่พร้อม |
| เข้าใช้และรหัสสำรอง | LINE owner สร้างได้โดยไม่มี email/username/password; ตั้งรหัสสำรองได้ แต่เมื่อไม่มี email หรือ username ต้องเลือก username | ไม่บังคับตั้งรหัสก่อนใช้; หน้า security ต้องอธิบายวิธีเข้าเดิมและวิธีสำรองตามจริง |
| กู้บัญชี | Email password reset ต้องมี email ที่ verified และ credential; เบอร์ใน profile เป็น contact ไม่ใช่ OTP factor | แยก “กรอกแล้ว” จาก “ยืนยันแล้ว”; ผู้ใช้ที่เข้า LINE ไม่ได้และไม่มีวิธีสำรองต้องมี support recovery ที่ตรวจ ownership ไม่ย้ายบัญชีจากเบอร์/ชื่อร้านเหมือนกัน |
| ถอด LINE | Controller/use-case ที่ตรวจไม่มี guard ว่ามีวิธีเข้าอื่นก่อน unlink เป็น gap เดิม ไม่ใช่ bug ที่เพิ่งเกิดจาก optional email | ป้องกันถอดวิธีเข้าสุดท้ายที่ backend และ UI; ตรวจสภาพ credential/identifier จริงและ race กับการเปลี่ยนบัญชี |
| อนุมัติอัตโนมัติ / trial | Email ซ้ำใน User, Company หรือคำขออื่นเป็นสัญญาณส่ง manual review อยู่แล้ว | ไม่มี email คือไม่มีสัญญาณนี้ ไม่ใช่หลักฐานว่าไม่เคยสมัคร; รักษา LINE identity, existing company, repeat trial, prior rejection และ cap/rate limit เดิม ห้ามใช้เบอร์/ชื่อร้านเป็น ownership proof |
| เพิ่ม email ทีหลัง | ระบบแยก unverified account email, verified email และ company contact; มี conflict/verification flows อยู่แล้ว | เก็บ account/company เดิม, ไม่ merge หรือย้ายสิทธิ์เพราะ email ตรงกัน, ไม่ overwrite email ของบัญชีเดิมเมื่อเปิดร้านเพิ่ม, ไม่เริ่ม trial ใหม่ |
| ซื้อแพ็กเกจ | `BillingService.quote` ยังบังคับ billingEmail และส่งให้ Stripe customer | optional ตอนสมัครไม่ได้แปลว่าซื้อได้โดยไม่มี email; ขอ email สำหรับเอกสารตอนซื้อและอธิบายวัตถุประสงค์ แยกจาก login/recovery email |
| แจ้งเตือน | Billing email notices เลือกเฉพาะ owner ที่มี verified email; มี notification ในแอป/LINE เป็นอีกเส้นทาง | ไม่มีผู้รับ email ต้องไม่ถูกแสดงว่า delivery สำเร็จหรือวน retry อีเมลว่าง; LINE login ไม่เท่ากับ LINE push พร้อมเสมอ ให้ดูสถานะส่งจริงและ notification preference |
| รายจ่าย / ใบแทน / ใบเบิก | จาก reader ที่ค้น ไม่พบ owner email เป็น key สำหรับการผูกเอกสารเหล่านี้; มี User/Company ID เป็น identity | คาดว่ากระทบต่ำ แต่ยังต้องทดสอบสร้าง/ลงนาม/อนุมัติ/พิมพ์/ดาวน์โหลดด้วย owner ที่ email เป็น null ก่อนยืนยัน E2E |
| Support / admin | คิวแอดมินรองรับ email ไม่มีค่าในบางจุดแล้ว แต่สัญญาณ duplicate email จะหายไปและช่องทางติดต่อเหลือน้อยลง | แสดง “ยังไม่ได้ระบุ”, source, LINE identity ที่ระบบยืนยัน, เบอร์และ request ID ให้ตามคำขอได้ ไม่บอกให้ผู้ไม่มี email ไปเช็กกล่องเมล |

## Migration และ compatibility

- `User.email`, `Company.email` และ `CompanySignupRequest.contactEmail` เป็น nullable อยู่แล้ว จึงไม่จำเป็นต้องเปลี่ยนสาม column นี้เพื่อรับค่าว่าง และไม่ต้องเติม email สมมติให้ข้อมูลเดิม
- Normalization ต้องตกลงให้ชัด: absent/null/ข้อความว่างเป็น “ไม่ระบุ” ในเส้นทาง LINE; ห้ามเก็บ email placeholder ร่วมกันหรือใช้ empty string เป็น unique account email
- Payload hash/idempotency รวม contactEmail ปัจจุบัน การเปลี่ยน `''` เป็น `null` หรือ omitted ต้องไม่ทำให้ retry ของคำขอเดิมกลายเป็น payload conflict หรือเปิดร้านเพิ่ม
- คำขอเก่าที่ email ว่างอาจเป็น partial/migrated row ที่ยังไม่ผ่าน intake ไม่ใช่คำขอใหม่ที่ผู้ใช้ตั้งใจข้าม email ทั้งหมด ห้าม auto-approve ย้อนหลังเพียงเพราะเอา guard email ออก
- คง state/review/provision evidence ของ web claim, คำขอรอแอดมินและร้านที่เปิดแล้ว ต้องรองรับ client เก่าที่ยังส่ง email และ deploy API ที่รับรูปแบบใหม่ก่อนเผยแพร่ client ใหม่
- หลังเปิดให้สร้าง addressless LINE requests แล้ว rollback ไป code ที่บังคับ email ทุก intake อาจทำให้คำขอที่กำลังดำเนินการค้าง ต้องมี reader/retry ที่เข้ากันได้ ไม่ใช่ rollback เฉพาะหน้าฟอร์ม

## UX ที่เสนอ

- LINE: “อีเมล (ไม่บังคับ)” พร้อมข้อความ “เพิ่มภายหลังได้ในข้อมูลบัญชี”; เว้นว่างได้จริงทั้งส่งสมัครและกลับมาต่อ ไม่ขีดแดงเพราะยังไม่ได้ระบุ
- หลังเปิดร้าน: แสดงข้อความสั้นว่าเข้าผ่าน LINE ได้ และเสนอ “ตั้งวิธีเข้าสำรอง” แบบข้ามได้ ไม่บังคับกรอกซ้ำทันทีหลังเพิ่งอนุญาตให้ข้าม
- แสดงสถานะ “ยังไม่ระบุ / ยังไม่ยืนยัน / ยืนยันแล้ว” แยกกัน; email ที่ยังไม่ verified ห้ามอ้างว่าใช้กู้บัญชีได้แล้ว
- ผู้สูงวัยไม่ควรถูกบังคับตั้ง username ภาษาอังกฤษหรือ password ในขั้นสมัครเพื่อชดเชยช่อง email ที่เพิ่งลด ให้ขอเมื่อเลือกตั้งวิธีสำรอง
- ตอนซื้อแพ็กเกจ: ขอ “อีเมลรับเอกสารการชำระเงิน” พร้อมเหตุผล; email นี้ไม่เปลี่ยนบัญชี login หรือยืนยัน recovery ให้อัตโนมัติ

## E2E ที่ต้องพิสูจน์ก่อนเปิด

1. LINE ใหม่ไม่กรอก email → เปิดร้าน → ออกจากระบบ → เข้าด้วย LINE เดิม → ได้ร้าน/User/trial เดิม
2. Submit ซ้ำ, lost response, ปิด LIFF, เปิดหลายแท็บ, request ค้าง RECEIVED/VALIDATED → retry สำเร็จครั้งเดียว ไม่มีร้านหรือ trial ซ้ำ
3. Manual review / ขอข้อมูล / ปฏิเสธแล้วสมัครใหม่ / retry provisioning / กลับร้านเดิม / เพิ่มร้าน เดินได้เมื่อ email ไม่มีค่า
4. Email ที่มีค่าแต่ผิด format ยังถูกปฏิเสธ; กรอกภายหลังและ email ชนบัญชีอื่นไม่ย้ายสิทธิ์หรือเปิด trial ใหม่
5. ตั้ง username/password โดยไม่มี email → login ได้; ไม่มีวิธีสำรองแล้ว unlink LINE ต้องไม่ผ่าน; reset email ต้องไม่อ้างว่าส่งจริงเมื่อไม่ eligible
6. Billing ที่ไม่มี login email → ขอ billing email → จ่าย/กลับจาก provider/ดูและดาวน์โหลดเอกสารได้ในบัญชีเดิม; notifications ทดสอบทั้งไม่มี email, unverified และ verified
7. Owner ไม่มี email สร้างรายจ่าย/ใบแทน/ใบเบิก ลงนาม อนุมัติ และอ่าน PDF ได้; permission/tenant boundaries ไม่เปลี่ยน
8. Web signup เดิม, pending claim link เดิม, LINE client เก่าและ addressless legacy partial rows เดินตามกติกาที่กำหนด ไม่ถูก migrate เป็นอนุมัติใหม่โดยไม่ตั้งใจ

## หลักฐานและข้อจำกัด

- ตรวจ source, contracts, schema และ specs; ไม่แก้ product code, ไม่ deploy และไม่เปลี่ยนฐานข้อมูล
- ชุดเดิม 106 tests ผ่าน, zero failures/skips: `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/external-signup/domain/line-signup.logic.spec.ts src/modules/auth/application/use-cases/account-profile.use-case.spec.ts src/modules/auth/line-liff-signup.spec.ts`
- Log: `/tmp/signup-optional-email-impact-20260915-tests.log` หลักฐานนี้ยืนยันพฤติกรรมปัจจุบัน ไม่ใช่การผ่าน E2E ของ policy ใหม่
- Source references: [LINE normalizer](../../apps/api/src/modules/external-signup/domain/line-signup.logic.ts), [LINE submit/retry/duplicate policy](../../apps/api/src/modules/external-signup/application/submit-line-signup.use-case.ts), [status actions](../../apps/api/src/modules/external-signup/application/get-line-signup-status.use-case.ts), [LIFF form](../../apps/api/src/common/security/liff-page.security.ts), [provisioning](../../apps/api/src/modules/external-signup/application/provision-signup.use-case.ts), [account profile](../../apps/api/src/modules/auth/application/use-cases/account-profile.use-case.ts), [email recovery eligibility](../../apps/api/src/modules/auth/application/email-recovery-lock.ts), [unlink](../../apps/api/src/modules/auth/application/use-cases/unlink-line-identity.use-case.ts), [billing quote](../../apps/api/src/modules/billing/application/billing.service.ts), [billing notifications](../../apps/api/src/modules/billing/application/billing-notifications.service.ts).
- Product baseline: [LINE signup](../specs/mangmee-line-first-signup-spec-th.md), [recovery](../specs/line-signup-recovery-and-resolution-spec-th.md), [web/LINE easy signup proposal](../specs/unified-easy-signup-spec-th.md). การถามผลกระทบครั้งนี้ยังไม่ใช่การอนุมัติให้เปลี่ยนข้อกำหนดเหล่านี้
