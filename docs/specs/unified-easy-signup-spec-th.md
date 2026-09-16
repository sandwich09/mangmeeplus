# สมัครและเข้าสู่ระบบด้วยอีเมลโดยไม่ใช้รหัสผ่าน

สถานะ 2026-09-16: REVIEWED / IMPLEMENTING. Owner สั่งรีวิว bug/gap/impact แล้วเริ่ม implement. ขอบเขตนี้ต่อจาก billing และ optional-email OTP; ไม่ deploy หรือส่งเงินจริง/เมลจริงจากการทดสอบนี้.

## 1. ผลลัพธ์และข้อกำหนด

ลูกค้าไม่มี LINE เริ่มที่เว็บ → ยืนยันอีเมลด้วยรหัส 6 หลัก → กรอกชื่อร้าน ชื่อผู้ติดต่อ มือถือ และรับทราบข้อกำหนด → เปิดร้านเมื่อผ่านกฎเดิม หรือเห็นสถานะรอตรวจ → เริ่มใช้งาน. ไม่ขอรหัสผ่าน เลขภาษี หรือ VAT ตอนสมัคร. กลับเข้าครั้งถัดไปใช้รหัสอีเมลใหม่ ตั้งรหัสสำรอง/ผูก LINE ภายหลังได้. สิทธิ์เริ่มต้นใช้ provisioning เดิม: 7 เมนู, trial 30 วัน, 1 สาขา/2 คน, 15 ใบต่อเดือน. การเข้าสู่ระบบ/ผูกช่องทางไม่ให้ trial หรือแพ็กเกจซ้ำ.

ใช้ OTP เพื่อรองรับผู้ประกอบการที่เปิดเมลคนละอุปกรณ์กับหน้าเว็บ. เปิดหน้าเว็บอุปกรณ์ใหม่ต้องขอรหัสใหม่ที่อุปกรณ์นั้น; ไม่มี bearer proof ใน URL. การกู้โดยยังเข้ากล่องอีเมลได้ใช้ OTP login เดิม; กล่องอีเมลและ LINE หายทั้งคู่ส่ง support ไม่เปลี่ยนอีเมลหรือรวมบัญชีจากชื่อ/มือถือ.

## 2. Identity และ security contract

- Public login proof แยกจาก AccountEmailOtpService (ผูก/เปลี่ยนอีเมลหลัง authenticated). ไม่ใช้ AccountClaimToken, verification link หรือ billing recipient เป็น login proof.
- User.emailLoginEnabledAt เป็น opt-in ของวิธี login. บัญชี email-first ใหม่ตั้งใน transaction เปิดร้าน; บัญชีเดิมต้องยืนยัน password หรือ fresh same-account LINE proof และกดยืนยันที่หน้าความปลอดภัย. อีเมลต้อง verified และบัญชี ACTIVE. ไม่เปิดวิธีใหม่อัตโนมัติให้บัญชีเก่า และไม่เพิ่ม passwordless ให้ SYSTEM_ADMIN.
- Public challenge: email ปรับ lowercase, random UUID, browser secret สุ่มอย่างน้อย 256 bit เก็บ hash, purpose EMAIL_ACCESS_V1, environment/key version, security binding ของ user ถ้ามี, HMAC ของ OTP, expiry, failed attempts, delivery attempt, status. Raw OTP อยู่แค่ memory/transport ไม่ log/DB/outbox. เก็บ browser secret ใน HttpOnly SameSite cookie ของ BFF; JS เห็นเพียงสถานะ/challenge id.
- OTP อายุ 10 นาที, ผิดได้ 5 ครั้ง, ขอใหม่ห่าง 60 วินาที, ไม่เกิน 5 ครั้ง/ชม./อีเมล และ 10 ครั้ง/วัน/อีเมล พร้อม shared fail-closed IP limiter. รหัสใหม่ยกเลิกรหัสเดิม; requestKey เดิมต้อง fingerprint ตรงและไม่ส่งซ้ำ. Changing email เริ่ม challenge ใหม่. Timing/result ก่อนพิสูจน์อีเมลไม่เปิดเผยว่ามีบัญชีหรือไม่.
- Confirm ผูก browser secret + code + purpose + current identity snapshot. account disabled, email/security revision/credential/LINE binding เปลี่ยน, code expired/used/revoked ถูกปฏิเสธ. Count ผิด commit แม้ตอบ error. OTP ใช้ได้ครั้งเดียว; response หายให้ขอใหม่ ไม่คืน session จาก code เก่า. หลังพิสูจน์ใหม่ resume ร้าน/คำขอเดิมได้.
- consume proof และสร้าง AuthSession เป็น transaction เดียวภายใต้ user/company/membership locks ตามลำดับเดิม. ต้องผ่าน platform/legal/password-change/company guards เดิม. Email session เก็บ fresh email reauthentication เพื่อให้ผู้สมัครใหม่ตั้งรหัสสำรองได้; อำนาจนี้หมดอายุ 5 นาทีตาม helper เดิม.
- Unverified/duplicate legacy address ไม่ attach/merge/overwrite. หลัง proof แสดงให้ใช้ login เดิมหรือ support; ไม่มี account existence response ก่อน proof. Existing enabled account เข้า membership เดิมเท่านั้น ไม่เปิดร้านใหม่จากปุ่มสมัคร.

## 3. Signup และกฎอนุมัติ

หลัง OTP ใหม่ที่ไม่มีบัญชีให้ proof จำกัดเฉพาะ signup อายุ 10 นาที. ส่งข้อมูลผ่าน BFF พร้อม secret เดิมและ intake policy; server ไม่รับ userId, tier, approved flag จาก client. request source `email-otp`, policy EMAIL_SIGNUP_V1. บันทึก source email-otp สำหรับช่องทางสมัคร; ไม่รับ campaign/referral ใหม่ในรุ่นนี้ และไม่ใช้ attribution เป็นหลักฐานยืนยันตัวตน. ฟอร์มชื่อผู้ติดต่อเป็น displayName จริง ไม่สร้าง first/last name สมมติ.

ใช้ CompanySignupRequest, onboarding, provisioning fence, trial guards, audit/outbox เดิม. เพิ่ม source-specific transitions โดยไม่เปิด VALIDATED→PROVISIONING ให้ official-site เดิม. บัญชี ownerAuth=email ไม่มี temporary password/credential. verified email และ opt-in เขียนพร้อม owner.

AUTO_FREE ใช้ mode/cap เดียวกับ LINE (ชื่อ config เดิมคงไว้เพื่อ compatibility) และ advisory lock/day counter เดียวกัน;นับทั้งสอง source. Auto เฉพาะบัญชีใหม่ที่ไม่ชน User email/username, คำขอ/ชื่อร้าน/มือถือเดิมข้ามช่องทาง, prior reject/suspend, repeat intent และมี operator. กรณีเสี่ยง/ถึง cap/mode manual → PENDING_REVIEW ในคิวเดิม ไม่มีสิทธิ์ก่อน provision. Duplicate signal เป็นเหตุส่ง review ไม่ใช่ proof ownership. Adminต้องเห็นข้อความเตือนข้อมูลซ้ำก่อนกดอนุมัติ; สำหรับsourceemail-otpใช้contactEmailConflictเป็นสัญญาณรวม email/phone/shop-name ของคำขอ ไม่อ้างว่าเป็นตัวตนเดียวกัน. serialize source decision ภายใต้ shared cap lock และ recheck ก่อน grant.

หนึ่ง email-first request ต่อ normalized email สำหรับ first shop; request ที่ค้าง/rejected ไม่เปิดใหม่อัตโนมัติจาก OTP ใหม่. Refresh/response-loss/provision crash resume request เดิมด้วย fresh OTP. ผู้ดูแลอนุมัติใช้ permission/intent/audit เดิมและ source-aware provisioning; status browser เห็นได้เฉพาะผู้พิสูจน์ mailbox ของ request. Review ไม่เปิด trial จน provision สำเร็จ. Existing account/second shop ใช้ existing authenticated workflow ไม่แอบให้ auto trial ซ้ำ.

## 4. UX และ integration

- `/signup` มีปุ่มเริ่มด้วยอีเมลและคำแนะนำสมัครในเมนู LINE เดิม ฟอร์ม legacy/manual claim ยังเดินต่อได้. `/login` มี “รับรหัสทางอีเมล” และ password/LINE เดิม. หน้า email flow รวม email → OTP → ข้อมูลร้าน/สถานะ; ไม่ต้องเข้าใจคำว่า token/provider.
- ช่อง code เดียว inputMode=numeric, autocomplete=one-time-code, paste 6 หลัก, label/error focus, 390px/keyboard. Terms/privacy ตอนสมัครเป็นการรับทราบ; ยอมรับเอกสารฉบับปัจจุบันที่ legal gate หลังเข้าสู่ระบบครั้งแรก. ปุ่ม loading กันกดซ้ำ; countdown จาก server retryAt; แก้อีเมล/ขอใหม่/กลับ login/support ไม่เป็นทางตัน.
- แสดงส่งสำเร็จเฉพาะ provider ยอมรับ; accepted ไม่แปล inbox. provider CONFIG/PERMANENT/UNKNOWN แจ้งความจริงและขอใหม่ตามเวลา ไม่ส่ง payload เดิมซ้ำเมื่อไม่รู้ผล.
- BFF ไม่ส่ง access/refresh/browser proof กลับ JS. Same-origin mutation guard, trusted IP forwarding, no-store และ allowlisted internal next path. หน้า status ไม่เปิดเผยข้อมูลร้านอื่น. เก็บ next path ที่ผ่าน sanitizeNextPath เพื่อกลับหน้าจ่ายเงิน/ตั้งรหัสสำรองหลัง OTP; forced password change และ legal gate ต้องทำก่อนกลับ.
- LINE link ใช้ verified LINE + current account flow เดิม; ไม่ link จาก contact email. Paid company/receipt/AI entitlement ใช้ company เดิม ไม่แก้ billing policy. Email verification gate ก่อนจ่ายยังทำงาน.
- Marketing CTA ไป app signup ไม่จำลองว่าเปิดร้านจาก lead submit. ข้อความและ docs ของ mangmee_web ต้องสอดคล้อง;ไม่เปลี่ยน pricing.

### Contract สำหรับ web developer

| Same-origin BFF | JSON จากหน้าเว็บ | ผลสำเร็จ |
|---|---|---|
| POST /api/auth/email-access/request | email≤254, requestKey UUID, nextPath? | challengeId, expiresAt, retryAt, deliveryStatus; HttpOnly browser cookie |
| POST /api/auth/email-access/confirm | code 6 digits | SIGNUP / EXISTING_LOGIN_REQUIRED / LOGIN |
| POST /api/auth/email-access/signup | companyName≤120, displayName≤160, phoneNumber, consentVersion=EMAIL_SIGNUP_V1 | STATUS หรือ LOGIN |
| POST /api/auth/email-access/status | {} | CODE / NEW / STATUS / LOGIN; ใช้ browser cookie เดิม |
| POST /api/v1/auth/account/email/otp/login-method | enabled boolean, currentPassword? | account email status รวม emailLoginEnabled; requires authenticated permission account.password.change + fresh proof |

BFF เท่านั้นที่ใส่ challengeId/browserSecret ไป `/v1/public/email-access/{action}`. LOGIN ตั้ง access/refresh cookies; response ให้เฉพาะ companyId, safe redirectPath และ legal/password-change flags. ไม่มี JWT/OTP/browser secret ใน URL หรือ response ให้ JavaScript. Serverรับโทรศัพท์ไทยทั้ง0… และ+66… แล้ว normalizeเป็น0…; consentVersion เป็น intake acknowledgement ไม่ใช้แทน legal acceptance record.

400 EMAIL_OTP_INVALID ให้กรอกรหัสใหม่ในช่องเดิม;401 EMAIL_ACCESS_INVALID กลับขั้นอีเมลและสร้าง requestKeyใหม่.429 แสดงเวลารอจากserver.503 EMAIL_DELIVERY_UNAVAILABLE ให้ลองใหม่/ติดต่อทีมงาน. ผู้สมัครที่ค้างตรวจขอ OTP ใหม่เพื่อกลับคำขอเดิมได้โดยไม่เริ่มtrialใหม่. Configใช้ POSTMARK/EMAIL_OTP_HMAC_* และ EXTERNAL_SIGNUP_ENABLED เดิม; mode/capของLINEครอบคลุมemailด้วยตาม§3. ปิดรับสมัครใหม่ไม่ปิดlogin/statusของคำขอเดิม.

## 5. Bug / gap / impact review

| ID | ช่องโหว่/ผลกระทบ | ข้อกำหนดปิดช่องโหว่ |
|---|---|---|
| E01 | verification OTP ถูกใช้เป็น login โดยผิด purpose | dedicated model/purpose/public boundary |
| E02 | ยึดบัญชี contact email เก่า/ร่วม | explicit opt-in + verified/current snapshot; no merge |
| E03 | OTP เดาสุ่ม/ส่งเมลเกิน/DB leak | HMAC + bounded attempts/IP+recipient budgets + no raw secret |
| E04 | login CSRF/session fixation/URL leak | browser secret HttpOnly + same-origin + mint new session |
| E05 | response หาย/สองแท็บได้หลายร้าน | durable request id + single-use proof + provisioning fence |
| E06 | เปลี่ยน password/email/hold ระหว่างยืนยัน | lock + current security snapshot before atomic session |
| E07 | สมัครง่ายแต่ logout แล้วเข้าไม่ได้ | same OTP returning login + recovery/support/backup password |
| E08 | cap/trial คูณเมื่อใช้ web+LINE | shared daily lock/count + cross-channel duplicate review |
| E09 | admin approval ส่ง claim/password โดยผิด source | explicit email source transitions/onboarding/admin handling |
| E10 | providerล่มแต่หน้าแจ้ง sent/ready | durable delivery status + no synthetic success |
| E11 | new source ทำ legacy pending/LINE พัง | source-isolated transitions + old claims unchanged + regression |
| E12 | legal/platform bypass/สิทธิ์ผิดบริษัท | existing guards/current memberships/no client entitlement |
| E13 | อีเมลเปลี่ยนแล้ว codeเก่าใช้ได้ | securityBinding/current revision and opt-in checks |
| E16 | ปุ่มสมัครอยู่ผิดหน้า/admin READY ไม่มีทางทำต่อ | actual marketing→signup/browser admin approve + crash/retry; source-specific copy |
| E17 | OTP ทำเส้นทางจ่ายเงินหรือ reauth หาย/ขอใหม่วนรหัสเก่า | safe next path + legal/password gates + rotate request key after invalid proof |
| E15 | dynamic BFF ถูก Next rewrite ส่งผิด API | static BFF endpoints + real HTTP/browser regression |
| E18 | เพิ่ม public login แต่ maintenance pin ไม่ครอบคลุม | pin email-access service และ auth module; CLOSED ต้องไม่ออก session; validator tamper tests |
| E14 | optional-email branch ยังไม่รวมCI | pin baseline7ef09d8e; own worktree; exact integrated verification |

## 6. Acceptance

ต้องมี checks: new signup → logout → login → protected API; manual review → approve → OTP resume; wrong/5 attempts/expiry/resend/rate/delivery failure; replay/concurrency; unverified collision; legacy verified without opt-in; inactive user/member/company; email/password/LINE changes between request and confirm; no raw tokens in browser response; session/audit rollback; recover after provisioning crash; no duplicate trial; LINE shared cap; trial/paid entitlement unchanged; legacy signup/claim/password reset; mobile/keyboard/error/retry/back navigation. Map each result to actual check; local simulated Postmark ไม่ใช่ inbox/native acceptance. No deploy in this task.

Implementation evidence: [email-passwordless-signup-2026-09-16](../agent-memory/email-passwordless-signup-2026-09-16.md). Migration additive; deploy ต้อง migrate ก่อน app ที่อ่าน fields ใหม่. Public challenge ใช้ hashed evidence ตาม auth token ledger เดิม ไม่เก็บ raw OTP; ไม่ผูก cleanup กับการลบประวัติเมลหรือคำขอเปิดร้าน. การปิด email login ยกเลิก challenge และหยุด login ใหม่ ส่วน session เดิมใช้หน้าจัดการ session เดิมเพื่อออกจากอุปกรณ์.

Rollback runtime: หลังมี email-only customer แล้ว ห้ามย้อน app ไปเวอร์ชันที่ไม่มีemail loginโดยไม่เตรียมทางเข้าบัญชีสำรองให้ครบ. Prefer forward fix; migrationเป็นadditiveและห้ามลบidentity/proofเพื่อทำให้rollbackผ่าน. การปิดloginต่อบัญชีต้องมี password/LINEที่ใช้ได้ก่อนตามLAST_LOGIN_REQUIRED.
