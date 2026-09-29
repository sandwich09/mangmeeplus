# สมัคร LINE โดยไม่บังคับ email และยืนยัน email ด้วย OTP ก่อนชำระเงิน

วันที่: 2026-09-15
สถานะ 2026-09-16: SOURCE MERGED DEVELOP + MAIN / PR CI PASS — ไม่มี feature flag ใหม่; native UAT/Production acceptance ยังไม่ครบ ไม่ได้ deploy ดู [หลักฐานส่งมอบ](../evidence/signup-optional-email-local-2026-09-16.md#ci-gated-source-delivery)
เจ้าของ: thawatchai / Codex
แผน: [Implementation plan](../plans/signup-optional-email-otp-billing-plan-th.md)
ฐานการวิเคราะห์: [ผลกระทบและ source references](../research/signup-optional-email-impact-2026-09-15-th.md)

## 1. เป้าหมาย ขอบเขต และลำดับข้อกำหนด

ผู้ใช้สั่งทำ spec + plan โดยให้สมัครง่ายขึ้น ก่อนจ่ายเงินต้องแจ้งให้ผูก email ให้เรียบร้อย และเมื่อเปลี่ยน email ต้องยืนยัน email ใหม่ด้วย OTP ผู้ใช้แจ้งว่าเชื่อม mail provider แล้ว; source มี Postmark adapter/delivery evidence จริง แต่การยืนยัน email ปัจจุบันยังเป็นลิงก์ ไม่ใช่ OTP การเชื่อม provider ไม่ได้แปลว่ากติกา OTP หรือ gate การจ่ายมีอยู่แล้ว

ข้อกำหนดนี้เป็น amendment เฉพาะ optional LINE contact email, authenticated account email verification/change และเงื่อนไข email ก่อนเริ่มจ่ายใหม่ ของ [LINE signup](mangmee-line-first-signup-spec-th.md), [signup recovery](line-signup-recovery-and-resolution-spec-th.md), [billing UI](mangmee-line-web-billing-ui-spec-th.md) และ [email provider](mangmee-transactional-email-provider-spec-th.md) กฎ tenant, permission, source-state, trial, pricing, payment evidence และ ledger เดิมยังต้องผ่าน

ขอบเขตรุ่นแรก:

- LINE signup ผ่าน token ที่ backend ยืนยันแล้ว: contactEmail ไม่บังคับ ทั้ง first shop และ add shop
- Web signup ที่ใช้ email claim เดิม: ยังต้องมี email ไม่เปลี่ยนเป็น web signup ที่ไร้ทั้ง LINE/email ไม่เปลี่ยน claim/reset-password link ให้เป็น OTP ในงานนี้
- เพิ่ม/ยืนยัน/เปลี่ยน **email ของบัญชีที่ login อยู่** ใช้ email OTP การกรอก contact ตอนสมัครไม่ถือว่า verified
- ~~ก่อน user เริ่มชำระเงินหรือเพิ่มภาระการเรียกเก็บ ต้องมี current verified account email; warning ที่ UI มี API enforcement คู่กัน~~ → ยกเลิก (D-PF-1/R-A6, purchase-without-setup PR C 2026-09-28): อีเมลบัญชีเป็นทางเลือก; ผู้รับเอกสารแยกเป็น `BillingAccount.recipientEmail` ของบริษัท
- → D01 แทนที่ (PR C 2026-09-28): ผู้รับ = `BillingAccount.recipientEmail`; company-scoped recipient OTP มีแล้ว (proofKind `BILLING_RECIPIENT` ผูก companyId) ตามที่ D01 เคยเสนอ
- ~~**Design default D01:**~~ รุ่นแรกใช้ current verified account email ของผู้กดชำระเป็น billing recipient ของรายการใหม่ ไม่มีช่องกรอก billing email อิสระ ข้อนี้เป็นตัวเลือกออกแบบที่เสนอ ไม่ใช่คำกล่าวว่าผู้ใช้ได้เลือกนโยบายอีเมลแผนกบัญชีแยกแล้ว หากต้องแยก ต้องเพิ่ม company-scoped recipient verification/permissions ก่อน ไม่ใช้ verified ของคนหนึ่งรับรองอีก email
- ไม่สร้าง user/company/trial ใหม่จากการผูก email ไม่ auto-merge ด้วย email และไม่บังคับตั้งรหัสผ่านก่อนสแกนหรือจ่าย
- Provider outage ไม่ปิดงานรายจ่ายทั้งระบบ และการไม่ผ่าน email gate ไม่หยุด reconcile เงินที่จ่ายไปแล้ว
- ข้อกำหนดเพิ่มเติมจากผู้ใช้: UAT และ Production ต้องพร้อมใช้เมื่อ release เสร็จ ไม่มีงานค้างให้เปิด/ปิด feature flag หรือเปลี่ยน provider ภายหลัง ใช้ release contract §10; readiness ที่ยังไม่ผ่านต้องทำให้ release ไม่สำเร็จ ไม่ส่งมอบหน้าที่ใช้งานต่อไม่ได้
- ยังไม่รวม email OTP login, passwordless web signup, phone OTP, บังคับ OTP ทุกครั้งที่จ่าย, หรือเปลี่ยน legal/tax invoice policy

## 2. ผู้ใช้และประโยชน์

| ผู้ใช้ | เป้าหมาย | สิ่งที่ต้องป้องกัน |
|---|---|---|
| เจ้าของร้านผ่าน LINE / ผู้สูงวัย | กรอกสั้น เริ่มใช้ได้ กลับเข้าร้านเดิม | ไม่บังคับจำ username/password เพื่อชดเชย email ที่อนุญาตให้ข้าม |
| ผู้สมัครเว็บ | สมัคร/claim/login เดินต่อได้ | อย่าทำลายคำขอและ claim link ที่รออยู่ |
| OWNER ก่อนซื้อ/ต่อแพ็กเกจ | รู้ว่าต้องยืนยัน email เพราะอะไร และกลับมาจ่ายรายการที่เลือก | ไม่สูญเสียบริษัท แพ็กเกจ รอบเดือน/ปี และตัวเลือกสาขาระหว่างเปิดแอปเมล |
| นักบัญชี/เจ้าของหลายบริษัท | รู้ว่าใบแจ้งหนี้ใหม่จะส่งที่ใด ประวัติเดิมคงอยู่ | ไม่เปลี่ยนผู้รับของทุกบริษัทหรือเขียนเอกสารย้อนหลังตาม email บัญชีโดยเงียบ ๆ |
| Support/Admin | เห็นขั้นตอนที่ค้างและทางแก้ | ไม่เห็น OTP ไม่กด verified แทนลูกค้า ไม่ใช้ข้อมูลติดต่อเป็น ownership proof |

## 3. แบบจำลอง email และ invariant

แยกข้อมูลสามประเภทแม้บางครั้งมีข้อความเหมือนกัน:

1. `CompanySignupRequest.contactEmail` / `Company.email`: ข้อมูลติดต่อร้าน อาจว่าง/ยังไม่ยืนยัน ไม่ให้สิทธิ์ login/recovery/payment ด้วยตัวเอง
2. `User.email` + `emailVerifiedAt`: email บัญชีและหลักฐานยืนยันปัจจุบัน เป็นของ user ไม่ใช่ของทุกคนในบริษัท
3. Billing recipient ใน quote/attempt/contract: snapshot ที่ผู้มีสิทธิ์ยืนยันสำหรับบริษัท/รายการนั้น ไม่อ่าน email ล่าสุดเพื่อ rewrite historical invoice

Invariant E01–E12:

- E01 ไม่มี email ก็สมัคร LINE และใช้ core ERP ได้ เมื่อ identity/legal/eligibility เดิมผ่าน
- E02 email ใหม่ยังไม่ verified จน confirm OTP ที่ถูกต้องสำเร็จใน transaction ของ user คนเดิม
- E03 เริ่มเปลี่ยน email แล้วเก็บ current email/verifiedAt เดิมไว้; pending target แยกต่างหาก ความล้มเหลว/หมดอายุ/ยกเลิกไม่ลบ email เดิม
- E04 pending change ที่ยัง active กั้น **new payment authorization** จน verify หรือ cancel; email เดิมยังใช้เข้า/recover ตามสิทธิ์เดิมได้ กรณีหมดอายุไม่กั้นตลอดไป: current verified email เดิมกลับมาใช้ได้ สรุปราคาต้องแสดงผู้รับเดิมให้ตรวจและมีปุ่มขอรหัสใหม่ ไม่แสดง pending ที่หมดอายุเป็น active
- E05 การ verify email ไม่ตั้ง password ไม่เปิด session ใหม่ ไม่เพิ่ม role/membership ไม่ทำให้ billing consent สำเร็จ และไม่รับรอง ownership ของบริษัท
- E06 เมื่อเปลี่ยน email สำเร็จ ต้อง revoke pending verification/reset proofs ที่เกี่ยวข้อง และ session อื่นตาม policy; เก็บ session ที่กำลังยืนยันไว้ได้เมื่อยังมีสิทธิ์และ freshness ผ่าน
- E07 email ที่บัญชีอื่นถืออยู่ รวม username ที่ชน email ตาม rule ปัจจุบัน ต้อง conflict ไม่ auto-attach; pending challenge ไม่จอง email เป็นเจ้าของถาวร
- E08 payment gate ใช้ current server state และ current OWNER/บริษัทที่เลือก ไม่เชื่อ `emailVerified=true` หรือ email จาก browser
- E09 verified email ของ OWNER อีกคนไม่ผ่าน gate ให้ผู้กดปัจจุบัน และ verified ในบริษัทหนึ่งไม่มอบ membership ในอีกบริษัท
- E10 ผลชำระเงินจริงจาก provider และสิทธิ์/บัญชีแยกจาก email delivery; ไม่ rollback เงินหรือทิ้ง webhook เพราะ email เปลี่ยน
- E11 ไม่มีการถอดวิธีเข้าสุดท้าย: verified email อย่างเดียวที่ยังไม่มี credential **ยังไม่ใช่วิธี login สำรอง** ในระบบปัจจุบัน
- E12 `null`, blank, omitted ใช้แทน “ไม่ระบุ” ได้เฉพาะ LINE contact ตาม contract ใหม่; OTP target และ web claim email ยัง required ห้าม email สมมติ/placeholder

การรวมบัญชีที่ผู้ใช้ยืนยันผ่าน flow เดิมเป็น email/identity writer อีกทางหนึ่ง ไม่ใช่การ auto-merge จาก OTP: เมื่อย้าย email/verifiedAt ระหว่าง source และ target ต้องทำให้ challenge, security binding และ quote proof เก่าที่ได้รับผลกระทบของทั้งสองบัญชีใช้ต่อไม่ได้ใน transaction เดียว เพิ่ม emailRevision ตามการเปลี่ยนสถานะของแต่ละบัญชี คง authority/proof ของ account merge เดิมและไม่สร้าง verifiedAt ขึ้นใหม่ การรวมบัญชีแข่งกับ confirm/checkout ต้องไม่ยืนยัน email ให้ผิดบัญชีหรือใช้ consent ของ source แทน target

## 4. LINE signup และ compatibility

- หน้า LIFF HTML, inline JS, DTO, shared contracts, normalizer, status และ retry เปลี่ยนพร้อมกัน ไม่แก้เพียง required attribute
- เพิ่ม optional normalizer ของ LINE intake ที่เรียก required validator เดิมเมื่อมีค่า อย่าเปลี่ยน `requireLineContactEmail` ให้รับค่าว่างทั่วระบบ เพราะ account email setter และ OTP target ใช้ validator นี้ร่วมอยู่
- หากมีค่า trim/lowercase และใช้รูปแบบ/เพดานเดิม; หากไม่มีค่าบันทึก null ห้ามบันทึก empty string ลง unique `User.email`
- New intake บันทึก server-owned `intakePolicyVersion=LINE_CONTACT_OPTIONAL_V1` ใน request ไม่ให้ client เลือก policy ย้อนหลังเพื่อเลี่ยง review
- `resumeIntake` และ `canRetryIntake` ตัดสินความครบตาม source/policy ไม่ใช้ `Boolean(contactEmail && phoneNumber)` สำหรับ request ใหม่
- เมื่อไม่มี contact email ไม่รัน duplicate email query ด้วย `''` หรือ null และไม่บอกว่าเป็น email ใหม่ audit แยก `contactEmailPresent=false` กับผล review
- คง verified LINE identity, open-request uniqueness, exact submission idempotency, prior rejection, repeat trial, current memberships, global auto cap และ rate limits เดิม; ไม่มี email ไม่ใช่เหตุส่ง manual ทุกคน และไม่ใช่ข้อยกเว้นจาก guard อื่น
- คำขอที่มี duplicate contact email อยู่แล้วลบ email เพื่อหลบ review ไม่ได้: คง historical review signal จน operator/current policy resolve อย่างมีหลักฐาน
- Existing request ที่มี email คง hash/replay เดิม ห้าม rehash ทั้งตาราง `null`/omitted canonicalization ใช้กับ new revision และมี replay compatibility test
- Legacy LINE row ที่ email ว่างและค้างไม่ถูกอนุมัติอัตโนมัติจาก migration ให้ผู้ใช้ token-proven กด “ทำคำขอนี้ต่อโดยยังไม่ระบุอีเมล” ผ่าน retry เดิมที่ขยาย explicit acknowledgment + expectedVersion; revalidate identity/phone/legal facts/review/source state ก่อน adopt policy ใหม่ ไม่เปิด request/company/trial ใหม่และไม่แต่ง legal evidence
- Pending manual/REQUEST_INFO/REJECTED/PROVISIONING_FAILED/READY/COMPLETED ยังเดินตาม resolution และ guard เดิม เปลี่ยน contact หลังเริ่ม side effects ไม่ได้ด้วย intake endpoint

## 5. Journey และ UX

### 5.1 สมัครและเข้าภายหลัง

LINE → ชื่อร้าน/มือถือ + “อีเมล (ไม่บังคับ)” → ยอมรับข้อกำหนด → auto หรือ manual ตาม eligibility → เปิดร้านเดิมได้ผ่าน LINE

ข้อความใต้ email: ~~“เพิ่มภายหลังได้ ก่อนชำระแพ็กเกจจะให้ยืนยันอีเมลสำหรับรับเอกสาร”~~ → “เพิ่มภายหลังได้ อีเมลรับเอกสารกรอกที่หน้าชำระเงิน” (RV33) หลังเปิดร้านเสนอ “ตั้งวิธีเข้าสำรอง” แบบข้ามได้ ไม่บังคับกรอก email ซ้ำทันที

### 5.2 ก่อนจ่าย

เลือกบริษัท → เลือกแพ็กเกจ/รอบ → ~~ถ้าไม่มี verified email แสดงขั้น “ยืนยันอีเมลก่อนชำระเงิน”~~ (→ ไม่มีขั้นนี้แล้ว; Stripe Checkout ถามอีเมล — purchase-without-setup) → กรอก/ตรวจ email → ส่ง OTP → กรอกรหัส → สำเร็จ → ดึงราคา/สิทธิ์ล่าสุด → แสดงสรุปและให้กดยืนยันจ่ายอีกครั้ง → provider

- เห็นราคา/catalog ได้ก่อน OTP แต่ firm quote/financial action ต้องผ่าน gate ตาม §8
- Copy: “ยืนยันอีเมลเพื่อรับเอกสารการชำระเงิน” ปุ่มหลัก “ส่งรหัสยืนยัน” ปุ่มรอง “ไว้ภายหลัง” กลับไปใช้งานที่สิทธิ์เดิมอนุญาต
- มีค่าแต่ไม่ verified ให้ prefill และแก้ได้; verified และไม่มี pending change ใช้ต่อได้ ไม่ส่ง OTP ทุกการซื้อ
- ยืนยันสำเร็จไม่ auto-charge ไม่เปิด provider โดยอัตโนมัติหลังกลับจากเมล; ราคา/โควตาหรือบริษัทเปลี่ยนต้องให้ตรวจสรุปใหม่
- เก็บเฉพาะ selected company/offer/interval/capacity และ return context ที่ allowlist; ไม่เก็บ OTP/token/รหัสผ่านใน URL/localStorage/analytics การเก็บ challenge ID ไม่ใช่หลักฐานสิทธิ์
- บัญชีหมดอายุเพราะ term ต้องเข้าหน้าผูก email และกลับมาต่ออายุได้; security hold/user disabled/ไม่มี membership ไม่ถูกยกเว้นโดย email gate

### 5.3 OTP และเปลี่ยน email

- Shared account editor แสดงทีละขั้น: 1 กรอกอีเมล → 2 ยืนยันตัวตนและกด “ถัดไป · ขอรหัสยืนยัน” → 3 กรอก OTP; แสดงเลขขั้นและปุ่มถัดไป/ย้อนกลับ ไม่รวมช่องอีเมล รหัสผ่าน และ OTP ในฟอร์มเดียว (UX amendment 2026-09-29)
- ย้อนกลับจากขั้นยืนยันตัวตนเก็บอีเมลที่กรอกไว้; ย้อนกลับจาก OTP ต้อง cancel challenge สำเร็จก่อนกลับไปแก้อีเมล หาก cancel ล้มเหลวคงขั้น OTP และแสดงข้อผิดพลาด; กลับจาก LINE เก็บเฉพาะอีเมลร่างใน sessionStorage ไม่เก็บ password/OTP และยังให้ server ตรวจ reauthentication เดิม
- หน้าหรือ inline panel เดียวที่อ่านง่าย ไม่เปิด modal ซ้อน; ระบุ email ปลายทางพร้อมปุ่ม “แก้อีเมล” และ “ส่งรหัสใหม่”
- ช่องเดียว `type=text`, `inputmode=numeric`, `autocomplete=one-time-code`, รองรับ paste และเลขศูนย์นำหน้า; กด “ยืนยันรหัส” ชัดเจน ไม่ auto-submit เมื่อพิมพ์เลขตัวสุดท้าย
- ตัวอักษรอย่างน้อย 16px สำหรับ input, touch target อย่างน้อย 44px, ใช้ข้อความร่วมกับสี, focus ไปข้อผิดพลาด, screen-reader status, mobile 320/390px และ zoom 200% ไม่ตัดปุ่ม
- รหัสผิด/หมดอายุ/ส่งใหม่/เมลพิมพ์ผิด/ส่งไม่ได้/session หมดอายุ มีทางแก้จากข้อมูลที่กรอก ไม่เริ่ม signup ใหม่
- ส่งใหม่แจ้ง “ใช้รหัสจากอีเมลฉบับล่าสุด รหัสเดิมใช้ไม่ได้แล้ว” แสดงเวลาขอใหม่จาก server ไม่ใช้ timer ใน browser เป็น authority
- Email-change copy: “อีเมลเดิมยังใช้งานอยู่จนกว่าจะยืนยันอีเมลใหม่สำเร็จ” ไม่ขอเข้ากล่องเมลเก่าเป็น prerequisite เพราะผู้ใช้อาจเข้าไม่ได้แล้ว แต่ต้อง reauthenticate ตาม §6
- Target ที่ normalize แล้วตรง current verified email ให้แสดง “อีเมลนี้ยืนยันแล้ว” ไม่สร้าง challenge, ไม่เสีย budget และไม่ทำให้ payment กลายเป็น pending; ไม่ตัด Gmail dots/plus aliases หรือแก้ domain ที่พิมพ์ผิดให้อัตโนมัติ
- เปิดเมลคนละอุปกรณ์ได้; กลับมายืนยันใน app session ของ user เดิม ถ้า session หมดอายุให้ login ด้วยวิธีเดิมแล้ว resume challenge หลังตรวจสิทธิ์ ไม่ auto-login ด้วยเลข OTP
- หลัง confirm แสดง verified state และ current email; สำหรับผู้ไม่มี password ชวนตั้ง username/password สำรอง ไม่กล่าวว่า verified email เพียงอย่างเดียวใช้ login/recover แบบ passwordless ได้

## 6. OTP และความปลอดภัยของบัญชี

ค่าเริ่มต้นทางวิศวกรรมสำหรับรุ่นแรก (ไม่ใช่ข้อกำหนดที่อ้างว่ามาจาก Postmark):

| กติกา | ค่า/พฤติกรรม |
|---|---|
| รหัส | 6 หลัก จาก CSPRNG ของ Node crypto; เก็บเป็น string รักษา leading zero |
| อายุ | 10 นาทีจากเวลาสร้าง challenge ฝั่ง server; queue/provider delay ไม่ต่ออายุให้เงียบ ๆ |
| กรอกผิด | สูงสุด 5 ครั้งต่อ challenge แบบ atomic; ครบแล้ว revoke challenge ไม่ lock บัญชีทั้งบัญชี |
| ส่งใหม่ | อย่างน้อย 60 วินาที; รวม request/resend/change-target ไม่เกิน 5 ครั้ง/ชั่วโมง และ 10 ครั้ง/24 ชั่วโมงต่อ user |
| ป้องกันเดาสลับ challenge | budget confirm ผิดรวมต่อ user 20 ครั้ง/ชั่วโมง เพิ่มจาก per-challenge; resend ไม่ reset budget รวม |
| ป้องกัน mail bombing | recipient budget 5 ครั้ง/ชั่วโมง + existing trusted-client-IP limits; ใช้ infrastructure limiter เดิม แยก account/recipient จาก shared-office IP |
| หลังเกินโควตา | 429 พร้อม retryAfter; กลับไปใช้สิทธิ์เดิม/ดูเอกสาร/support ได้ ไม่มี admin bypass verified |

- (หมายเหตุ 2026-09-28: recipient OTP ของบริษัท — purchase-without-setup PR C §4.8 — ไม่บังคับ reauth ตาม DQ11; เหตุผลอยู่ใน brief นั้น กติกาข้อนี้ใช้กับอีเมลบัญชีเท่านั้น)
- เปลี่ยน/เพิ่ม email เป็น sensitive account mutation ต้อง active authenticated principal และ current permission เดิม; ถ้ามี usable credential ให้ตรวจ current password; LINE-only ใช้ fresh server-verified LINE reauthentication ผูก nonce/transaction/purpose/user/channel อายุไม่เกิน 5 นาทีเมื่อเริ่ม challenge ห้ามบังคับสร้าง password เพื่อผูก email การ confirm ภายในอายุ challenge 10 นาทีไม่ถามรหัสผ่านซ้ำเพียงเพราะครบ 5 นาที แต่ต้องตรวจ security binding ปัจจุบันเสมอ; request รุ่นใหม่ที่เกินช่วง reauthentication ต้องยืนยันตัวตนใหม่โดยเก็บ target/context เดิมไว้
- Reauthentication เป็นข้อมูลคนละชุดกับ mailbox OTP: OTP พิสูจน์กล่องใหม่ ไม่พิสูจน์ว่า requester มีสิทธิ์เปลี่ยนบัญชีเดิม session ที่ถูกขโมยอย่างเดียวต้องไม่พอเปิดวิธี recovery ใหม่
- Challenge ผูก user ID, normalized target email, email revision, credential/security binding, purpose และ expiry ห้ามย้าย proof ไป user/company/action อื่น
- ไม่เก็บ OTP ดิบใน DB/outbox/log/provider metadata; plain SHA256 ของ 6 หลักไม่พอ ใช้ HMAC-SHA256 กับ secret เฉพาะ OTP ที่แยกจาก JWT/credential encryption และ namespace/version/challenge binding; constant-time comparison
- เพิ่ม key/config ตาม pattern เดิม เก็บ secret ผ่านช่องทาง deployment secrets ไม่ใส่ default key ใน repo ไม่มี dependency crypto ใหม่; rotation รุ่นแรกใช้ coordinated challenge invalidation ตาม §10.4 พร้อม UX ขอใหม่
- รุ่นแรกใช้ `EMAIL_OTP_HMAC_KEY` เป็น secret สุ่ม 32 bytes (เข้ารหัส hex 64 ตัว) และ `EMAIL_OTP_HMAC_KEY_VERSION` เป็น metadata รุ่น key; ห้ามใช้ซ้ำข้าม environment หรือใช้ JWT/Postmark token แทน HMAC binding รวม authoritative environment และ challenge ID ด้วย ไม่อ่าน environment จาก client
- ใช้เวลาฝั่งฐานข้อมูลสำหรับ expiry/attempt admission; API หลาย instance และ restart ต้องเห็น budget เดียวกัน ไม่ใช้ process memory เป็น authority ถ้า budget store ไม่พร้อมให้ปฏิเสธ request/confirm ที่พิสูจน์ limit ไม่ได้โดยไม่ consume code เดิมหรือเปลี่ยน email ผู้ใช้ยังยกเลิก pending/อ่านข้อมูลตามสิทธิ์ได้เมื่อ DB พร้อม
- Confirm สำเร็จใน transaction เดียว: ตรวจ eligibility/security revision ใหม่, consume unexpired current challenge, update User email/verifiedAt/revision, revoke challenge/reset proofs อื่น, revoke session อื่น, append audit ที่ไม่มี email เต็ม/OTP ถ้า audit ล้มเหลว rollback ทั้งชุด
- ส่ง security notice ไปช่องทางเก่าที่เชื่อถือได้ (verified old email/LINE) หลัง commit แบบ durable best effort ไม่ส่ง OTP/credentials ใน notice และความล้มเหลวของ notice ไม่ rollback การเปลี่ยนที่เสร็จแล้ว
- ใช้ lock order ร่วมกับ email/profile/password/reset/billing ตาม §7; ทดสอบ race ไม่เพิ่ม lock คนละลำดับโดยไม่มีหลักฐาน
- Verification สำเร็จไม่ออก role/grant/session ใหม่; verified email ของบัญชีอื่นใช้เป็นเหตุ merge ไม่ได้ ให้ใช้ existing account proof/support path
- Profile endpoint เดิมที่แก้ unverified account email ตรง ๆ ต้องไม่กลายเป็นทางหลบ OTP ในรุ่นใหม่: redirect contract ไป request challenge หรือคืน `EMAIL_OTP_REQUIRED` พร้อม next action; company contact edit ยังเป็น contact เท่านั้น

## 7. สถาปัตยกรรมและ backend contract

### 7.1 Reuse และ data delta

ใช้ Auth module, `EmailVerificationToken`, `EmailSendAttempt`, suppression/callback/reconcile, mailer port และ audit เดิม ไม่สร้าง OTP service ภายนอกหรือ notification queue ชุดใหม่

Schema ที่เสนอแบบ additive:

- `User.emailRevision Int default 0` สำหรับ compare-and-set/quote binding เพิ่มเมื่อ request/cancel/confirm/replace challenge หรือ account email writer เปลี่ยนสถานะที่มีผลกับ gate ทุก writer ต้องเข้ากติกาเดียวกัน
- ขยาย `EmailVerificationToken` ด้วย `proofKind` (legacy LINK default / OTP), `failedAttempts`, `emailRevision`, `securityBindingHash`, `keyVersion`, `sendAttemptId`, `requestKey` และ `requestFingerprint` แบบ nullable สำหรับ legacy rows; unique `(userId, requestKey)` เมื่อมี key และ partial uniqueness สำหรับ active OTP ของ user เดียว
- ใช้ `tokenHash` เดิมเก็บ digest แต่ OTP/LINK ต้องถูกแยกชนิดทุก reader ไม่มี endpoint legacy ที่รับ OTP record ได้
- `CompanySignupRequest.intakePolicyVersion` nullable: null = legacy semantics, new LINE request ใส่ policy explicit; web source ไม่เปลี่ยน
- Quote/attempt snapshot เพิ่ม versioned `emailProof` ที่ผูก initiatingUserId, normalized verified recipient, verifiedAt, emailRevision และ policyVersion; ไม่เก็บ OTP หรือ raw secret ค่า hash ที่ออก browser ต้องไม่ทำหน้าที่เป็น bearer proof
- Data retention ใช้นโยบาย auth-proof/delivery เดิม; terminal OTP เก็บเฉพาะ metadata ที่จำเป็น ไม่เพิ่ม body/OTP retention และต้องมี expiry cleanup bounded

Lifecycle: `PENDING` → `USED` / `EXPIRED` / `REVOKED`; delivery แยก `READY/SENDING/ACCEPTED/UNKNOWN/RETRY/PERMANENT/SUPPRESSED` ตาม service เดิม รหัสหมดอายุหรือผิดครบไม่เปลี่ยน verification ของ email เดิม

Transaction admission ของ billing ใช้ลำดับ company/plan-term/authority → user security locks ตามขอบเขตปัจจุบัน Auth OTP transaction ห้ามไปถือ company lock หลัง user lock; เขียน notice/sync intent แล้วให้ post-commit worker ทำ company/provider side effect เพื่อหลีกเลี่ยง lock inversion รวมถึง reset/first-password/unlink ที่อาจใช้ UserCredential → User ต้องจัดลำดับให้สอดคล้องก่อน merge

P0 ต้องรวม `auth/application/use-cases/account-merge.use-case.ts` ซึ่งอ่านและย้าย email/verifiedAt ของสอง user ใน inventory ด้วย กำหนดลำดับ lock ของ source/target และ company/membership ร่วมกับ writer เดิมก่อนเขียน migration; ทดสอบ merge-vs-OTP และ merge-vs-checkout ด้วย PostgreSQL จริง ไม่ถือว่า lock ของ user เดียวครอบคลุมการรวมบัญชีแล้ว

### 7.2 API ที่เสนอ (ยังไม่มี implementation)

ทุก authenticated mutation ผ่าน BFF/cookie, CSRF/origin/whitelist/size validation และ permission pattern เดิม ไม่รับ `userId` จาก body:

| API | ข้อมูลหลัก / ผลลัพธ์ |
|---|---|
| `GET /auth/account/security` | เพิ่ม emailRevision, pending challenge ID/target/status/expiry/retryAfter, verification state, canUnlinkLine และ reason; owner-visible ไม่เปิดเผยไป public signup |
| `POST /auth/account/email/otp/request` | targetEmail, expectedEmailRevision, currentPassword หรือ fresh LINE proof ref, requestKey; คืน challengeId, masked target, expiresAt, resendAvailableAt, deliveryState |
| `POST /auth/account/email/otp/:id/confirm` | code, expectedEmailRevision; ตรวจ current authenticated owner + bound security state; คืน verified status/revision ไม่มี token/session ใหม่ |
| `POST /auth/account/email/otp/:id/resend` | expectedEmailRevision, requestKey; revoke/replace challenge แบบ atomic หลัง reserve send สำเร็จ คืน ID ใหม่และเวลาใหม่ |
| `POST /auth/account/email/otp/:id/cancel` | expectedEmailRevision; ยกเลิก pending ของตนเองและคง current email; authenticated explicit action พร้อม current security check |
| Billing status | เพิ่ม `emailRequirement` ของ viewer ปัจจุบัน (`READY/MISSING/UNVERIFIED/CHANGE_PENDING/DELIVERY_UNAVAILABLE`) และ next action; server คำนวณซ้ำเมื่อ mutation |

- Target-required ใช้ normalize/length policy เดิมของ account writer อย่าบังคับ legacy verified emails ให้ยืนยันใหม่เพราะเปลี่ยนเพดานรูปแบบของ signup; หาก legacy address ไม่ผ่าน provider ให้เส้นทางแก้ที่ชัด
- Request ซ้ำ key/body เดิมคืน reservation เดิม ไม่ส่งซ้ำ/นับ budget ซ้ำ; key เดิม body เปลี่ยน 409 เปลี่ยน target ต้อง revoke challenge เดิมภายใต้ revision lock
- หาก response confirm หาย client อ่าน security/challenge status ของตนเอง; ถ้า USED และ current email/verifiedAt ตรงผลเดิมแสดงสำเร็จ ไม่ consume/audit ซ้ำ ถ้า email เปลี่ยนอีกแล้วให้แสดงสถานะล่าสุด
- Stable errors: `EMAIL_OTP_REQUIRED`, `EMAIL_ALREADY_VERIFIED`, `EMAIL_CONFLICT`, `EMAIL_STATE_CHANGED`, `EMAIL_REAUTH_REQUIRED`, `EMAIL_OTP_INVALID`, `EMAIL_OTP_EXPIRED`, `EMAIL_OTP_ATTEMPTS_EXCEEDED`, `EMAIL_OTP_RATE_LIMITED`, `EMAIL_DELIVERY_UNAVAILABLE`, `EMAIL_DELIVERY_UNKNOWN`, `ACCOUNT_LAST_LOGIN_METHOD`, `BILLING_EMAIL_VERIFICATION_REQUIRED`, `BILLING_EMAIL_CHANGED` พร้อม Thai copy/next action ไม่ส่ง raw provider errors
- Expiry-only billing recovery context ต้องเข้า OTP/security route ได้ด้วย own-account permission เท่านั้น; ไม่ขยายเป็น ERP access หรือยกเว้น suspension/security holds

## 8. Payment gate และบัญชี/เอกสาร

### 8.1 สิ่งที่ต้องกั้นและสิ่งที่ต้องเดินต่อ

| เส้นทาง | Email gate |
|---|---|
| ดู catalog/ราคาเบื้องต้น/สถานะ/ประวัติ/เอกสารที่มีสิทธิ์ | ไม่กั้น ให้เตือนและลิงก์ไปยืนยันได้ |
| firm quote, new checkout, repeat purchase, upgrade, restart | ~~ต้อง current verified email, ไม่มี pending change และ D01 recipient ตรงกัน~~ → ไม่ต้องมี verified email; op ผู้รับค้าง (BILLING_EMAIL_UPDATE_PENDING) เป็นตัวบล็อกเดียว; ผู้รับเปลี่ยนตั้งแต่ quote → BILLING_QUOTE_STALE |
| resume ที่จะสร้าง/เปิดทางจ่ายใหม่, manual pay/retry หนี้, เปิดกลับ auto-renewal หรือแก้บัตรที่อาจกระตุ้นเรียกเก็บ | ตรวจ gate ก่อนเริ่ม side effect; ไม่ให้ hidden endpoint/worker/direct provider handoff bypass → portal/RESUME_RENEWAL/CANCEL_DOWNGRADE ไม่ผูกอีเมลบัญชีแล้ว (DQ2); op ผู้รับค้างยังกัน portal |
| cancel auto-renewal / downgrade ที่ลดภาระและไม่เรียกเก็บทันที | ไม่บังคับ OTP เพิ่ม ใช้ current permission/consent เดิม อย่าล็อกผู้ใช้ให้หยุดจ่ายไม่ได้ |
| GET attempt, refresh/reconcile, webhook, apply paid rights, refund/credit note สำหรับเงินเดิม | ไม่บล็อกเพราะ email ปัจจุบันหาย/เปลี่ยน เก็บ source authority และหลักฐานเงินเดิม |
| auto-renewal ตาม contract ที่อนุมัติไปแล้ว | ไม่ขอ OTP รายเดือนแบบ unattended; ใช้ retained authorization/recipient ของ contract ตาม cohort §10 การเปลี่ยนราคา/ผู้รับ/เปิดใหม่ต้องผ่าน flow ของตน |

### 8.2 Gate ที่ mutation boundary

- ~~`quote` อ่าน email จาก user ปัจจุบัน ไม่ใช้ free-text body เป็น authority; old client ส่ง billingEmail ต่างจาก verified email ให้ coded refusal/upgrade path ไม่ silently ยอมรับหรือ silently เปลี่ยนผู้รับ~~ → `quote.billingEmail` = recipientEmail ?? verified account email ?? null; body `billingEmail` optional และถูกละเลย
- ตรวจ proof/version/permission อีกครั้งใน transaction ที่ reserve attempt และก่อน first provider mutation ที่สร้าง financial authorization; stale quote จาก tab อื่นให้ refresh summary ไม่ auto retry จ่าย
- Reuse idempotency/attempt/lease และ current authority checks เดิม ไม่เพิ่ม provider call ภายใน DB transaction
- เก็บ proof snapshot ไว้กับ attempt ก่อน dispatch กำหนดจุดเริ่มการจ่ายชัด: หลัง authorization ถูกส่งออกไปแล้วรายการนั้นผูกกับ verified recipient/version ณ เวลาที่อนุมัติ ไม่อ้างว่าสามารถห้าม provider เก็บเงินได้ทุก millisecond จากการเปลี่ยน User ในภายหลัง
- เปลี่ยน email ขณะมี checkout ที่ dispatch แล้ว: ยืนยัน email ใหม่ได้ แต่แสดงว่ารายการค้างยังใช้ผู้รับ snapshot เดิม; ไม่เปิด attempt ใหม่ ไม่เปลี่ยนใบเดิมในที่เดิม ให้ reconcile/finish หรือ expire original open session ด้วย workflow เดิมที่ตรวจได้ก่อนออก quote ใหม่
- URL provider ที่ส่งออกไปแล้วอยู่นอก app gate การไม่แสดงปุ่มอย่างเดียวไม่ revoke URL; การ expire ทำได้เฉพาะ session ที่ provider ยืนยันว่า open และอาจแพ้ race กับ complete จึงต้องอ่าน/reconcile ผลเดิม ไม่สร้างการจ่ายทดแทนจาก timeout

### 8.3 เปลี่ยน email และหลายบริษัท

- Account email เป็น global user identity; เปลี่ยนแล้วใช้กับ **รายการจ่ายใหม่** ที่ user นี้มีสิทธิ์เป็น OWNER เท่านั้น
- ไม่เปลี่ยน company contact หรือ Stripe customers ทุกบริษัทอัตโนมัติ ไม่เปลี่ยนสิทธิ์เจ้าของร่วม และไม่เขียน email ใน invoice/receipt/SRC/RB/expense snapshots ย้อนหลัง
- หน้า billing แสดง email ผู้รับตามสัญญาปัจจุบันและ email สำหรับรายการใหม่ แสดงต่างกันได้อย่างตรงไปตรงมา
- สำหรับผู้ต้องการเปลี่ยนผู้รับ **การต่ออายุในอนาคตของบริษัทที่เลือก** ต้องมีคำสั่ง owner-authorized แยกหลัง OTP สำเร็จ (“ใช้อีเมลที่ยืนยันแล้วนี้รับเอกสารต่ออายุของบริษัท …”) พร้อม current source/version, preview, idempotent provider update และ readback; ไม่เปลี่ยนวัน/ราคา/สิทธิ์หรือ auto-charge จากคำสั่งนี้
- Reuse billing operation framework สำหรับ `UPDATE_BILLING_EMAIL` แบบไม่สร้าง financial event; provider success/local response lost ต้อง reconcile ก่อน retry ใช้ old recipient จน readback สำเร็จ แสดงสถานะค้างและทางแก้ ไม่กล่าวว่าเปลี่ยนสำเร็จจาก local User update
- บัญชีหนึ่งหลายบริษัทต้องเลือกบริษัทและมี current OWNER ต่อบริษัท ไม่ fan-out ใน auth transaction; บัญชีแผนกบัญชีแยกเป็น recipient ใช้ design extension ภายหลังหาก D01 เปลี่ยน

## 9. Postmark delivery และ failure recovery

- Reuse `PostmarkAuthMailerAdapter` / `EmailDeliveryService` เพิ่ม OTP template ใน purpose email_verification ผูก challenge กับ `sendAttemptId`, recipient, deadline, server/stream; ทั้ง HTML และ text มีรหัสเดียวกัน อายุ และข้อความห้ามส่งรหัสให้ผู้อื่น ไม่มีรหัสใน subject/preview metadata
- `TrackOpens=false`, `TrackLinks=None`; app สร้าง/ตรวจ OTP เอง Postmark ทำ transport การตั้ง provider สำเร็จไม่ใช่หลักฐาน mailbox verified
- Reserve challenge + delivery attempt + budget + audit atomically; provider send นอก transaction พร้อมตรวจ current binding ก่อน dispatch ไม่เก็บ raw OTP ใน durable queue
- หาก process ตายหลัง reserve แต่ก่อน send ไม่มี raw code สำหรับ replay ให้สถานะอ่านได้และออก challenge ใหม่หลัง cooldown; ห้ามแสดงว่าส่งแล้วหรือมี worker ส่ง code สมมติ
- Request/resend ใหม่ที่ preflight/reservation ล้มเหลวไม่ revoke code เดิม ส่วนที่ reserve ใหม่สำเร็จแล้ว revoke code เดิมแม้ส่งใหม่ล้มเหลว ต้องบอกตามจริงและให้ขอใหม่ได้ภายใต้ budget
- Provider accepted ≠ delivered ≠ verified; unknown outcome แสดง “ยังยืนยันการส่งไม่ได้” ไม่ยิง message เดิมซ้ำแบบ blind retry ผู้ใช้ขอรหัสใหม่ได้ตาม cooldown/budget โดย revoke รุ่นเก่า และ reconcile transport เดิมแยกกัน
- Late delivery/duplicate webhook ไม่เปิดใช้ code ที่ revoked และไม่ verify user; bounce/suppression ห้าม clear อัตโนมัติจากปุ่ม resend ให้แก้ email/ใช้ support ที่มี authority ตามเดิม
- UAT target ที่ไม่อยู่ใน allowlist ต้องปฏิเสธก่อน reserve/revoke challenge พร้อมข้อความสำหรับผู้ทดสอบ ไม่แทน recipient ด้วยกล่องอื่น ไม่ทำให้ account ติด pending; Production ห้ามรับ allowlist ของ UAT มาเป็นเงื่อนไขส่ง OTP
- Provider unavailable: ตั้งต้น signup LINE/core ERP ยังใช้ได้ ผู้ที่ยังต้องยืนยันเห็นทางลองใหม่ภายหลัง; ผู้มี verified email อยู่แล้วและไม่มี pending change ยังจ่ายได้ ไม่ตรวจ mail availability เป็น gate ทุกการจ่าย ไม่มี bypass manual mark verified เพื่อชดเชย downtime
- Native acceptance ต้องแยก configured credentials/sender, provider accepted, receiving-server delivered และผู้ทดสอบกรอก OTP สำเร็จ ไม่ใช้ local mock หรือเพียง HTTP 200 เป็น inbox proof

## 10. Migration, rollout และ rollback

| Cohort | กติกา |
|---|---|
| Existing verified users | คง verified fact เดิม ไม่ force OTP ใหม่เพียงเพราะเปลี่ยน release; เปลี่ยน address ครั้งต่อไปต้อง OTP |
| Existing null/unverified LINE owners | ใช้งานต่อได้ ขอ OTP เมื่อเลือกผูกหรือเริ่มชำระใหม่ |
| New LINE requests | optional policy revision ใหม่พร้อม idempotency ใหม่ตาม §4 |
| Legacy partial LINE requests | ไม่ auto-approve จาก null; explicit owned resume/revalidation ตาม §4 |
| Pending web claim / password reset links | คนละ purpose/table/flow คงกติกาและ expiry เดิม |
| Pending account email-verification LINK | ใน cutover revoke เฉพาะ purpose นี้อย่าง idempotent; หน้า link เก่าแสดงทาง login → ขอ OTP ใหม่ ห้ามแปลง SHA hash เป็น OTP หรือให้ link ที่ไม่มี binding ข้าม policy ใหม่ |
| Unused old billing quotes | ไม่มี emailProof ให้ stale/requote หลัง verify ไม่ backfill ว่าเคยตรวจแล้ว |
| Already dispatched checkout/unknown payment | retained legacy authorization cohort ตรวจ/reconcile เดิม ไม่ยืนยันว่า gate ใหม่ revoke URL เก่าทั้งหมด; ไม่เปลี่ยนผล paid หรือสร้างซ้ำ |
| Existing subscriptions / old recurring billing email | คงสัญญา/ผู้รับเดิมและแจ้ง OWNER เมื่อเข้าหน้า billing; ไม่หยุดสิทธิ์/ต่ออายุที่ consent แล้วทั้งฐานข้อมูล ผู้รับในอนาคตเปลี่ยนผ่าน §8.3 |

### 10.1 นโยบายที่ทำงานทันที ไม่มี feature activation step

- Optional LINE intake, account email OTP และ verified-email payment rule เป็น behavior ของ build เดียวกันใน UAT/Production ไม่เพิ่ม env boolean, remote flag, company allowlist, admin switch หรือ frontend build flag สำหรับเปิดฟีเจอร์นี้
- `intakePolicyVersion`, token `proofKind`, quote policy version และ migration checkpoint เป็นหลักฐานตีความข้อมูล/ทำงานซ้ำอย่างปลอดภัย ไม่ใช่สวิตช์ที่ operator ต้องแก้เพื่อเปิดใช้
- Config/secret ที่จำเป็นต้อง provision และผูกใน canonical release input ก่อน rollout: `provider=postmark`, environment identity, keys, callbacks และ tester scope งานนี้เป็นส่วนหนึ่งของ implementation/release ไม่ส่งมอบเป็น “deploy ผ่านแล้วค่อยตั้งค่า” ห้าม fallback ไป SES/disabled/local-console เมื่อประกาศ release นี้พร้อมใช้
- Existing `LINE_SIGNUP_ENABLED` / `EXTERNAL_SIGNUP_ENABLED` ต้อง render เป็น true ใน live release ตามขอบเขต signup ที่เปิดให้บริการอยู่และตรวจ readback; ไม่เพิ่มขั้นให้คนไปเปิดเอง การตัดสินใจปิดบริการจาก security/legal/maintenance และ commercial sales policy เดิมยังมีผล ไม่ใช้ email feature ไปเปิดรับเงินหรือเปลี่ยนสิทธิ์เหล่านั้น
- Readiness ไม่ผ่านให้หยุด candidate ตาม first failing boundary; ก่อน mutation ให้คงระบบเดิม หลังเริ่ม mutation ใช้ recovery protocol ของ operation เดิม ห้ามสรุปว่า release พร้อมจากการมี feature code ใน image

### 10.2 Environment contract ที่ต้องครบใน release เดียวกัน

| ข้อกำหนด | UAT | Production |
|---|---|---|
| Mail provider / native server | Postmark Live `20950027` | Postmark Live `20950034` |
| From / stream | `developer@mangmeeplus.com` / active Transactional `outbound`, subject `[UAT]` | `contact@mangmeeplus.com` / active Transactional `outbound`, ไม่มี prefix UAT |
| Origin / LINE callback | `https://uat.mangmeeplus.com` และ LINE channel/callback ของ UAT | `https://mangmeeplus.com` และ LINE channel/callback ของ Production |
| Secrets | token, webhook credentials, OTP key และ versions ของ UAT | ชุด Production แยกจาก UAT; ห้าม copy key/token/secret references ข้าม environment |
| Recipient scope | exact approved test mailboxes รวมกล่องเดิม/กล่องใหม่สำหรับ change flow; allowlist ไม่ว่าง | ส่งตาม recipient ที่ flow อนุญาต ไม่มี UAT allowlist จำกัดผู้ใช้จริง |
| Callback | URL ที่พิสูจน์ ingress/TLS/auth/server/stream ของ UAT จริง | URL ที่พิสูจน์ ingress/TLS/auth/server/stream ของ Production จริง |
| Mail template / data | OTP HTML/text อยู่กับ source/image เดียวกัน, ไม่อาศัย template ID จากหน้า dashboard ที่ยังไม่ได้ sync | template เดียวกับ UAT candidate; production data/secrets แยก ไม่ copy verification facts จาก UAT |
| Runtime | API/web/worker ที่ใช้ schema/proof ใหม่ compatible ทุก instance | exact immutable UAT-approved images ตาม protocol และ target-specific config ที่ตรวจใหม่ |

Preflight ต้องตรวจ rendered/effective config หลัง overrides และ serving-mode transforms ของเส้นทาง deploy จริง ไม่ตรวจเฉพาะ JSON ใน repo: shared config, ECS input override, Kamal baseline capture และ maintenance mode อาจให้ผลคนละค่า ถ้า `maintenance_only` ทำให้ mail/signup ถูกปิด ให้รายงาน prepared/closed ตามจริง ยังไม่ใช่ feature-ready/live

ก่อน mutation ตรวจด้วย secret-safe identity reads: token → server ID/Live/active stream, sender/domain, account sending eligibility/quota, intended callback URL/auth configuration และ secret reference/version ที่ candidate จะใช้ ห้ามพิมพ์ `/server` response เต็มหรือ raw key; ตรวจ freshness อีกครั้งที่ mutation boundary ค่าหรือ secret เปลี่ยนหลัง READY ต้องหยุดและออก evidence ใหม่ตาม protocol

แยก preflight ของ input/contract ออกจาก acceptance บน candidate: callback handler/auth ด้วย secret ใหม่, OTP endpoint และ normal customer journey ต้องพิสูจน์หลัง candidate รันแล้วใน release เดียวกันก่อนส่งมอบ ไม่บังคับ old runtime ที่ยังไม่มี schema/key/endpoint ใหม่ให้ผ่านพฤติกรรมใหม่ก่อน deploy จนเกิดวงจร dependency; failed post-rollout acceptance เป็น release failure ที่ต้องใช้ operation recovery เดิม ไม่ลด check เป็น optional

ใช้ config contract เดิม `infra/postmark/config.json` ร่วมกับ secret injection เดิม เพิ่ม OTP key ใน auth secret contract ไม่เอาไปปน mail-provider token ไม่สร้างระบบ deploy/secret store ใหม่ รายงาน ref/version metadata เท่านั้น Native send จากหน้า Postmark เดิมไม่แทน app acceptance

### 10.3 Cutover และการพิสูจน์ UAT → Production

1. ก่อน rollout: fixed candidate/controller, CI, migration rehearsal, rollback-compatible artifact และ environment prerequisites ของ target ต้องครบ ใน fixture/clone ปิด outbound access และไม่เดิน customer queues ไม่ให้ migration test ส่งเมลหรือแตะ Stripe จริง
2. Apply additive schema/indexes ด้วย migration runner เดิม ตรวจ duplicate/null cohorts, lock timeout และ resume checkpoint ไม่มี destructive backfill, synthetic verifiedAt หรือเปลี่ยน request hashes Index ของ active OTP ห้ามใช้ `now()` เป็นเงื่อนไขเวลาที่คาดว่าจะอัปเดตเอง: expire/revoke terminal rows ภายใต้ user lock ก่อน reserve รุ่นใหม่
3. ใช้ rollout isolation/drain ของ controller เดิมให้ API/worker เก่าที่ mint LINK, แก้ email หรือเริ่ม payment ไม่รับ mutation แข่งกับนโยบายใหม่ ต้องพิสูจน์จำนวน old writers/in-flight admissions เป็นศูนย์ก่อน expose candidate; ถ้าต้องปรับ controller ให้รวมใน implementation ห้ามปล่อย mixed writers แล้วอาศัย flag มาปิดช่องว่าง ไม่อ้าง zero downtime หากต้องมี maintenance window
4. ภายใต้ isolation เดิม revoke pending account-verification LINK อย่าง idempotent แล้ว deploy/verify compatible API, workers, BFF/web/LIFF ครบใน operation เดียวก่อนรับ traffic ผู้ใช้ใหม่ Provider attempts ที่ dispatch แล้วและ webhook/reconciliation ต้อง retain original identity; ไม่ล้าง queue หรือทำให้ paid event หายระหว่าง drain
5. Old browser/LIFF cache ต้องได้ coded upgrade/reload path ที่เก็บ safe form/selection context ไม่มี side effect จาก request ที่ contract เก่า; server ไม่ให้ legacy endpoint bypass OTP หลัง cutover และ reload ไม่สร้างคำขอ/ร้าน/charge ใหม่
6. UAT: ทดสอบ app no-email signup → ใช้งาน → OTP → payment summary/explicit consent, เปลี่ยน email, race/failure, migration/rollback และ native inbox จริงตาม plan โดยไม่เปิด flag; ทดสอบ redeploy/restart อีกครั้งว่า behavior/config คงเดิม ถ้าโค้ด/image/migration เปลี่ยนหลังแก้ UAT ให้ใช้ candidate/evidence ใหม่
7. Production: promote immutable images ที่ UAT ยืนยันแล้ว ตรวจ secrets/server/origin/callback/LINE redirect ของ Production ใหม่ และทำ controlled app OTP smoke ด้วยบัญชี/กล่องที่ได้รับอนุญาตใน target จริง ไม่มี OTP bypass หรือ native charge เพื่อทดสอบ email rule ไม่เปลี่ยน email ของลูกค้าจริงเป็น fixture
8. จบ release เมื่อ normal customer path ใช้งานได้และผล signed release/OPEN acceptance ของ run เดียวกันผ่านด้วย: บันทึก UAT operation/workflow ID, READY/Production IDs ตาม controller ที่ใช้ ห้ามใช้ Kamal operation ID แทน V2 Passport โดยไม่มี validator รับรอง ต้องใช้ [deployment protocol](../runbooks/uat-production-v2-deployment.md) รวม serving/legal/customer-access ขั้นเดิมเป็นส่วนของ release จนจบ ไม่ทิ้งงานเปิดฟีเจอร์ให้ผู้ใช้ทำหลังส่งมอบ และไม่ bypass PlatformAccess ด้วย feature นี้ ถ้าได้เพียง `PROMOTED_CLOSED` ต้องรายงาน deployed-not-launched ยังไม่บรรลุพร้อมใช้จริง

### 10.4 Runtime failure, restart และ rollback

- Preflight readiness ของ release ต้องมี provider/config ครบ แต่ liveness ของระบบที่เปิดใช้แล้วไม่ผูกกับทุก network call ไป Postmark: provider ล่มภายหลังไม่ทำให้ทั้ง ERP restart หรือบังคับผู้มี current verified email หยุดจ่าย ผู้ที่ missing/unverified หรือมี active pending ยังคง rule เดิมและมี cancel/retry/support ตาม §5/§9
- การหยุดส่งเพื่อ incident เป็น ops procedure เดิมและสถานะ degraded ที่ต้องรายงาน ไม่ใช่เส้นทาง activation ปกติหรือเหตุให้เปิด unverified-payment bypass; callbacks, paid reconciliation, เอกสารเดิมและ cancel ต้องเดินต่อ
- Redeploy/restart คง emailRevision, challenge expiry/status, budgets และ key version ไม่ reset limit หรือ revoke verified email จากการเปลี่ยน process; OTP expiry ใช้เวลาจริง แม้ cleanup worker ค้างยังยกเลิก pending ที่หมดอายุในการอ่าน/gate ได้
- รุ่นแรกเลือก key rotation แบบ coordinated invalidation: revoke active challenges ของ key เก่าอย่างมี checkpoint พร้อม deployment เปลี่ยน key ทุก verifier/sender ผู้ใช้ขอรหัสใหม่ได้; current verified email/เอกสาร/paid rights ไม่ถูก revoke ไม่ถือว่า rotation ผ่านจน instance เก่าหมดและ state/readback ตรง ไม่ต้องเพิ่ม previous-key machinery ในรุ่นแรก
- Rollback หลังรับ OTP/addressless request ใหม่แล้วต้องเป็น compatible build ที่อ่าน/เขียน proof ใหม่และยัง enforce payment rule; ไม่ย้อน schema, ไม่ restore ทั้ง DB ทับเงินหรือ email ที่เกิดหลัง release, ไม่คืน LINK ที่ revoke แล้ว เตรียม artifact/rehearsal นี้ก่อน cutover ถ้ายังไม่พร้อมให้ fail release readiness
- Callback retry/duplicate/late arrival ระหว่าง cutover/rollback ต้องทำงานกับ original attempts โดยไม่ resurrect OTP หรือ verify mailbox จาก Delivery; retained web-claim/reset links ต้องยังกลับ origin/purpose เดิมและใช้ได้ตาม expiry/permissions

อ่าน [cloud operations](../runbooks/cloud-environment-operations.md) และ [Postmark activation](../runbooks/postmark-environment-activation.md) ประกอบ protocol ก่อน deploy จริง งานเอกสารนี้ไม่เปิด/ปิดบริการ ไม่ส่ง email จริง และไม่สร้าง payment

## 11. Bug / gap / impact register

| ID | มุม | ปัญหา/ผลกระทบ | ข้อกำหนดปิด gap |
|---|---|---|---|
| G01 | UX/Dev | เอา required ออกหน้าเดียว แต่ API/JS ยังปฏิเสธ | ทุกชั้น + blank/null tests |
| G02 | SA/Dev | no-email request ค้างหรือ retry กลายเป็นร้านใหม่ | policy-aware resume / idempotency / existing fences |
| G03 | SA/Security | optional helper หลุดไปยอม email ว่างใน account mutation | required target validator คงเดิม แยก intake wrapper |
| G04 | BA/SA | ลบ email เพื่อหลบ manual/duplicate/repeat-trial | เก็บ historical review signals ไม่ auto approve จาก missing |
| G05 | UX/Security | ขาดวิธีเข้าบัญชีหลัง unlink หรือคิดว่า email verified = password login | last-login guard + explicit backup credential UX |
| G06 | UX | เลขศูนย์หาย, paste ยาก, เปิดเมลแล้วข้อมูลซื้อหาย | single text input + safe return context + reprice |
| G07 | Dev/Security | เดา OTP / resend reset budget / offline crack | HMAC binding + CSPRNG + atomic budgets + bounded attempts |
| G08 | SA | หลายแท็บ confirm/resend/change email แข่งกัน | user revision/current challenge/CAS; atomic one winner |
| G09 | Security | stolen session ผูกเมลคนร้าย | current password หรือ fresh same-user LINE proof |
| G10 | SA/Security | legacy verify/direct setter bypass OTP | proof kind + cutover/revoke/compatibility routes |
| G11 | SA/Dev | account email เปลี่ยนหลัง quote แล้วใช้ proof เก่าจ่ายใหม่ | emailProof/version + final authorization guard |
| G12 | SA/บัญชี | block webhook/reconcile จนเงินจ่ายแล้วแต่สิทธิ์ไม่ขึ้น | payment observation/application ไม่ผูก current mail gate |
| G13 | UX/BA | ยืนยัน email ไม่ได้เพราะบริษัทหมดอายุ แต่ต้องยืนยันเพื่อต่ออายุ | expiry-only own-account access; holds ยังห้าม |
| G14 | SA/บัญชี | เปลี่ยน User email แล้ว invoice/ทุกบริษัทถูกแก้ตาม | immutable old documents + selected-company recipient command |
| G15 | Dev/Ops | provider timeout ส่งซ้ำ / stale OTP ส่งช้า / fake success | durable delivery states + explicit new challenge + no raw-code replay |
| G16 | SA/Security | verified OWNER คนอื่นผ่าน gate ให้ผู้กด / public account enumeration | current actor proof + bounded authenticated responses |
| G17 | UX/SA | บังคับ mail gate ทุก action จนยกเลิกต่ออายุหรือดูเอกสารไม่ได้ | action matrix §8 แยกเพิ่มภาระกับลดภาระ/อ่าน/รับผล |
| G18 | SA/Ops | old browser/writer/checkout/recurring ถูก policy ใหม่ทำค้าง | cohort inventory + compatible rollout/rollback + no invented proof |
| G19 | Dev | audit/session/reset invalidation บางส่วน commit หรือ account merge ย้าย email แล้ว proof ของ source/target ยังใช้ได้ | transaction rollback + both-user revision/proof invalidation + merge/OTP/billing lock-order regression |
| G20 | UX/Support | ไม่มี credential แต่คิดว่า verified email กู้รหัสเองได้ | ระบุข้อจำกัดจริง + ตั้ง backup ข้ามได้ + support path ที่เข้าได้โดยไม่พึ่ง lost LINE; ห้ามกล่าวว่ามี passwordless recovery ในรุ่นนี้ |
| G21 | Dev/Ops | deploy ผ่านแต่ provider disabled, signup ปิด หรือรอเปิด feature flag | build behavior ทำงานทันที + rendered config/preflight/runtime acceptance §10.1–10.2 |
| G22 | SA/Security | UAT token/key/callback/LINE origin/allowlist ปน Production | target identity/secret version/recipient isolation; OTP ข้าม environment ใช้ไม่ได้ |
| G23 | Dev/SA | old API/worker หรือ cached LIFF bypass rule ช่วง rollout | drain old writers + cutover isolation + compatible client upgrade/replay |
| G24 | Dev/Ops | migration/rollback ทำ proof หรือ paid facts หาย; clone ส่งเมลจริง | additive/resumable migration + outbound-isolated rehearsal + compatible rollback |
| G25 | UX/Ops | ส่งไม่ได้แล้ว deploy ยังเขียว หรือ outage ภายหลังทำ ERP/ผู้ verified ใช้ไม่ได้ | แยก release readiness กับ runtime degradation; native app acceptance และ recovery |
| G26 | Dev/Security | restart/multiple instances/key rotation ทำ OTP/budget ใช้ผิดรุ่น | shared durable state/time + environment/key binding + coordinated rotation |
| G27 | UX/บัญชี | same-email request, expired pending, legacy email ว่างแต่มี verifiedAt หรือ recipient typo ทำจ่ายค้าง | normalize แบบเดิม/no-op ที่ verified + time-aware gate + truthful correction path |
| G28 | SA/Ops | UAT proof ถูกใช้เป็น prod-ready ทั้งที่ images/secret/controller หรือ customer gate ต่าง | immutable promotion + fresh target proof + signed result/OPEN acceptance ใน release เดียว |

## 12. Acceptance และข้อจำกัดที่ต้องรายงาน

- Acceptance A01–A70 และ release gates R01–R08 อยู่ใน plan; release ผ่านเมื่อกรณีหลักและ failure/race/legacy paths มีหลักฐาน actual HTTP + real PostgreSQL + web/LIFF รวม provider simulation และ native controlled inbox ตาม environment ที่แยกชัด ไม่มี feature flag หรือ provider activation ค้างหลังส่งมอบ
- baseline 106 tests จาก impact audit คือพฤติกรรมเก่า ไม่ใช่ no-email+OTP E2E ไม่ใช้ติ๊ก acceptance ใหม่
- ผู้ใช้มี verified email แต่ไม่มี credential ยังต้องตั้งรหัสสำรองเพื่อใช้ password login/reset flow เดิม ไม่เพิ่ม passwordless recovery โดยเงียบ ๆ UI/help ต้องไม่ให้คำสัญญาผิด; หากต้องการ self-service กู้จาก email โดยไม่เคยตั้ง password ให้ทำ policy/security amendment แยกก่อนส่งมอบเส้นทางนั้น
- D01 ใช้ recipient เดียวกับ verified account เป็น design default สำหรับ spec นี้; แผนกบัญชีแยกเป็นเรื่องออกแบบเพิ่มเติม ไม่ปิดกั้นการทำ OTP/intake core ที่ใช้ร่วมกัน
- [ผลส่ง Postmark จริง 2026-09-15](../evidence/postmark-native-delivery-2026-09-15.md) ยืนยัน UAT ส่งจาก developer และ Production ส่งจาก contact ถึง Gmail SMTP แล้ว เป็นการส่งผ่านหน้า provider ไม่ได้ยืนยัน application OTP, runtime configuration, Inbox placement หรือ A46; integration และ usability กับผู้สูงวัยจริงยังต้องพิสูจน์ในช่วง acceptance

## 13. Source / official references

Initial source audit ที่ checkout `e30bfd4e`: external-signup submit/status/domain/controller, LIFF security page, account profile/change/verify/reset/unlink, Prisma User/EmailVerificationToken/EmailSendAttempt, billing quote/checkout/resume/repeat/collection/portal/notifications และ BillingPage

Readiness/always-on amendment ตรวจ local source ที่ `c0c925968e945d452a2b483b4ddd8b5fec99e847` พร้อม working changes: account-merge writer, canonical Postmark config/validator, config defaults, ECS serving-mode transforms, Kamal overrides/secret freshness และ mandatory deployment runbook ไม่มี cloud runtime inspection ในรอบนี้ ข้อกำหนด §10 เป็นงานที่จะ implement ไม่ใช่ผล deployed state ปัจจุบัน

- Postmark ส่งผ่าน `/email` และรับ HTML/text/stream; รหัสและนโยบายตรวจเป็นหน้าที่ app: [Email API](https://postmarkapp.com/developer/api/email-api) (ตรวจ 2026-09-15)
- Auth proof ไม่ใช้ tracking: [Postmark link tracking](https://postmarkapp.com/developer/user-guide/tracking-links) (ตรวจ 2026-09-15)
- Expiry ของ Checkout session จำกัดที่ session open และอาจไม่สำเร็จถ้าสถานะเปลี่ยนแล้ว: [Stripe expire Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire) (ตรวจ 2026-09-15)


## Implementation security clarification (2026-09-15)

- การตั้งรหัสผ่านครั้งแรกเป็นการเพิ่มช่องทางเข้าบัญชี ต้องยืนยัน LINE บัญชีเดิมอีกครั้งภายใน 5 นาที และผูก proof กับ session/security state เดียวกัน ป้องกัน session ที่ถูกขโมยตั้งรหัสผ่านแล้วใช้ขอเปลี่ยนอีเมล การเปลี่ยนรหัสผ่านที่มีอยู่ยังใช้รหัสเดิมและตรวจซ้ำตอน commit
- การส่ง OTP ตรวจสถานะอีกครั้งหลัง provider preflight ก่อน POST; หากยกเลิกหลังเริ่มส่ง เมลอาจไปถึงแต่รหัสใช้ยืนยันไม่ได้ ไม่กล่าวอ้างว่าสามารถเรียกเมลที่ส่งไปแล้วกลับคืน
- คำขอ LINE เก่าที่มีเบอร์และ legal evidence ครบสามารถยืนยันแก้ข้อมูลติดต่อเป็นว่างเพื่อเข้ากติกาใหม่ได้ ไม่ auto-provision จากการอ่านสถานะ คำขอที่หลักฐานไม่ครบต้องใช้เส้นทางขอความช่วยเหลือของคำขอเดิมพร้อมคำแนะนำ ไม่สร้าง legal evidence ย้อนหลังหรือสมัครซ้ำโดยอัตโนมัติ
- เปลี่ยนผู้รับเอกสารบริษัทต้องมี preview/consent ใหม่ หาก OWNER ต้นทางออกก่อนส่ง OWNER คนอื่นยกเลิกคำขอที่ยังไม่ dispatch ได้ ส่วนผล provider ที่ไม่แน่ชัดคงการจองและตรวจผลเดิม ไม่ส่งงานการเงินใหม่ทับ


## Implementation evidence and exceptional recovery — 2026-09-16

Current implementation and measured boundaries are recorded in [local evidence](../evidence/signup-optional-email-local-2026-09-16.md). The source is implemented; the complete A01–A70/release matrix is not all passed.

- A definitive LINE intake field-validation refusal must release the retained failed submission body, preserving form values so the user can correct or remove the optional email. Unknown transport outcomes retain the exact key/body to avoid duplicate shops.
- First-password creation requires fresh same-account LINE reauthentication and holds the original session against concurrent logout. A verified email without a usable credential does not permit self-unlinking the last login. The current product has no customer self-unlink button; the protected API rejects the action with the backup-password path. Administrative identity recovery retains its separately authorized existing workflow.
- An unknown company recipient update opens a durable `EMAIL_RECIPIENT_REVIEW` support issue and displays its operation reference. Renewal cancellation remains available. Exact provider readback resolves the original operation/issue; after 23 hours no new POST is attempted. If the provider cannot prove its result, new financial authorization waits for support/provider evidence. Do not promise automatic completion or an unconditionally unblocked payment path.
- AWS metadata read on 2026-09-16 confirmed the canonical UAT/Production Postmark/OTP secret references do not yet exist. Native servers created earlier do not prove application credentials/callback readiness. No live release or inbox acceptance is claimed.

### Final compatibility corrections — 2026-09-16

- Password reauthentication accepts the existing login/password contract, including passwords longer than128 characters. Do not truncate a password or force an existing user to rotate it solely to link email; request-body and persistent attempt budgets remain enforced.
- (2026-09-28, DQ2: portal ไม่ตรวจ email proof แล้ว; ยังตรวจ company/customer/settings/authority และ portal config ห้ามแก้อีเมล) Recheck current company/customer/settings/authority/~~email proof~~ after Stripe creates a payment-method portal session and before returning its URL. A concurrent change withholds that capability; an unexposed provider session does not authorize a new charge. Native portal configuration must refuse customer email editing so it cannot bypass account OTP/company recipient consent.
