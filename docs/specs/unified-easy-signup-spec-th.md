# สมัครผ่านเว็บและ LINE ให้เริ่มใช้งานง่ายเท่ากัน

> แก้ไข 2026-09-16: เรื่องอีเมลใช้ [spec สมัคร LINE แบบไม่บังคับอีเมลและยืนยัน OTP ก่อนจ่าย](signup-optional-email-otp-billing-spec-th.md) เป็นกฎปัจจุบัน: อีเมลติดต่อร้านใน LINE เป็นทางเลือก, web claim ยังต้องมีอีเมล, การอนุมัติชำระใหม่ต้องใช้อีเมลบัญชีที่ยืนยันแล้ว และเปลี่ยนผู้รับเอกสารเดิมของบริษัทด้วยการตรวจและยืนยันแยก ข้อความเดิมด้านล่างที่ขัดกันเป็นประวัติ ไม่ใช่กฎสำหรับ implementation รอบนี้
> **Current scope — 2026-09-16:** เส้นทางที่อนุมัติและ implement แล้วคือ official → สมัครในแอป → ตรวจคำขอ → claim → ตั้งรหัส/ใช้บัญชีเดิม → เริ่มใช้โดยไม่บังคับ LINE พร้อมยืนยันอีเมลและกู้รหัสผ่าน Postmark. ดู [ผล browser/API/PG ปัจจุบัน](../evidence/billing-integration-2026-09-13/final-integration-result.json). ส่วนฟอร์มย่อ, OTP/passwordless และ email auto-provision เป็นงาน E0 แยกจาก branch billing นี้ ไม่ใช้ผล billing/signup เดิมอ้างว่า implement เส้นทางใหม่นี้แล้ว. สถานะ BRAINSTORM ด้านล่างเป็นประวัติข้อเสนอ E0; การเปิด provider/production ยังต้องผ่าน release acceptance.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](../plans/mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป โดยมติ pack amendment2026-09-12 ให้ annual รับโควตาทั้งก้อนทันทีและไม่รีเซ็ตโควตา paid รายเดือน. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

> **หลัง signup → payment 2026-09-11:** ใช้ [LINE + web billing UI](mangmee-line-web-billing-ui-spec-th.md) / [แผน](../plans/mangmee-line-web-billing-ui-plan-th.md). ผู้สมัครเว็บที่ไม่มี LINE จ่ายและจัดการเอกสารผ่าน app ได้; ผู้สมัคร LINE ใช้ LIFF handoff เข้าหน้าเดียวกันโดยไม่ตั้ง password เพียงเพื่อจ่าย. Billing email แยกจาก login/recovery identity; ไม่สร้าง user/company/trial/subscription ใหม่เมื่อเปลี่ยนช่องทาง. Billing UI/routes หลังมีบัญชีมี local browser/HTTP evidence แล้วตาม implementation checkpoint; เส้นทาง easy signup ใหม่ยังต้องสรุปและ implement แยก ไม่ถือว่าเลือก OTP/link จากการทำ billing สำเร็จ.

สถานะ: **BRAINSTORM / PRODUCT DIRECTION CONFIRMED 2026-09-11; DESIGN PROPOSAL, NOT IMPLEMENTED**.

Owner ยืนยัน: ลูกค้าที่ไม่ใช้ LINE ต้องสมัครและใช้งานมั่งมีผ่านเว็บได้ครบ และสมัครง่ายเหมือนทาง LINE. เอกสารนี้บันทึกเป้าหมายที่ยืนยันแล้วและข้อเสนอเพื่อคุยต่อ ไม่ถือว่า Owner เลือก OTP แทนลิงก์ ยกเลิกการตรวจทุกกรณี หรืออนุมัติเปิด email/auto-approval บน production แล้ว.

อ้างอิง: [P10](mangmee-external-signup-contract-spec-th.md), [P10-L](mangmee-line-first-signup-spec-th.md), [นโยบาย trial/email ล่าสุด](onboarding-trial-receipt-fixes-spec.md), [P11 delivery](mangmee-email-delivery-claim-spec-th.md), [P26 billing](mangmee-billing-subscription-spec-th.md), [แผน](../plans/unified-easy-signup-plan-th.md), [เว็บไซต์ official](../../../mangmee_web/docs/specs/stripe-billing-alignment-spec-th.md).

## 1. เป้าหมายที่ยืนยันแล้ว

- LINE เป็นทางเลือก. การสมัคร ใช้งานเว็บ กลับเข้าสู่ระบบ กู้บัญชี ดูสถานะสมัคร ติดต่อทีมงาน และต่ออายุเมื่อ billing พร้อม ต้องมีทางที่ไม่บังคับ LINE.
- ลดขั้นตอนและเวลารอของผู้สมัครเว็บให้ใกล้เคียง LINE; ไม่ให้ช่องทางที่เลือกทำให้ได้คนละบัญชี ร้าน trial หรือ subscription โดยไม่ตั้งใจ.
- ทั้งสองช่องทางใช้ trial เดิม FREE_TRIAL → FREE_TRIAL_15: 30 วันจาก provisioning, 1 สาขา/2 คน/15 ใบต่อเดือน. การเปลี่ยนช่องทางหรือเพิ่มวิธี login ไม่เริ่ม trial ใหม่.
- ฟีเจอร์เฉพาะ LINE เช่น ส่งรูปในแชต เป็นความสะดวกเสริม; core business journey ต้องทำบนเว็บได้. ต้องตรวจ coverage จริงก่อนอ้างว่าทุก journey ผ่านแล้ว.

## 2. สิ่งที่โค้ดทำปัจจุบัน

| จุดเข้า | พฤติกรรมที่พบใน checkout |
|---|---|
| mangmee_web | trial request modal ส่ง Web3Forms/อีเมลหาทีมงาน; ยังไม่ได้ส่งเข้า CompanySignupRequest โดยตรง. ตอน fallback mailto ยังตั้ง trialDone=true แม้ไม่รู้ว่าผู้ใช้ส่งอีเมลแล้วหรือไม่ |
| App /signup (Flow B) | คำขอ → manual review → approval email → mailbox claim + ตั้งรหัส/เข้าบัญชีเดิม → provision; LINE เป็นขั้นเชื่อมภายหลัง |
| LINE OA/LIFF | verified LINE identity → ข้อมูลร้าน/มือถือ/อีเมล → AUTO_FREE เมื่อเปิดโหมดและผ่านเงื่อนไข หรือ manual review; ใช้ได้โดยไม่ตั้งรหัสผ่าน |

หลักฐานโค้ด: submit-company-signup.use-case.ts, signup-claim.use-case.ts, submit-line-signup.use-case.ts, provision-signup.use-case.ts, SignupPage.tsx และ actual bundled template ใน sibling index.html. ไม่ได้ตรวจ cloud/current production configuration ในรอบ brainstorm.

## 3. Journey ที่เสนอ

เว็บ official กด “เริ่มใช้ฟรี” → หน้าเริ่มสมัครในแอป → เลือก LINE หรืออีเมล. LINE OA เข้าทาง LINE เดิม; ทั้งคู่ลงคำขอในระบบมั่งมี ใช้ provisioning/สิทธิ์/คิวตรวจกลางที่มีอยู่. ฟอร์มฝากทีมงานติดต่อกลับแยกเป็น “ขอคำแนะนำ” และไม่แสดงเป็นการเปิดบัญชี.

**ข้อเสนอเส้นอีเมลสำหรับลูกค้าใหม่:**

1. กรอกชื่อร้าน มือถือ อีเมล และยอมรับข้อกำหนด. ยังไม่ขอ username/password, VAT, เลขภาษี, ที่อยู่ หรือข้อมูลเพื่อออกเอกสารที่ยังไม่จำเป็นต่อการเริ่มใช้; การลด field ต้องปรับ DTO/provisioning ให้ตรง ไม่สร้างค่าภาษี/ตัวตนสมมติ.
2. ยืนยันเจ้าของอีเมล. เสนอรหัสสั้นในหน้าสมัครเดิมเพื่อใช้ข้ามมือถือ/คอมได้; ลิงก์ยืนยันยังเป็นทางเลือกที่ต้องเทียบกับ code เดิม. ยังไม่ได้เลือกวิธีสุดท้ายหรือกำหนดอายุ/จำนวนครั้งจากตัวอย่างเป็น policy.
3. ตรวจ eligibility ปัจจุบันอีกครั้ง → ผู้สมัครใหม่ที่ผ่านเกณฑ์เปิดร้านอัตโนมัติพร้อม session → หน้าเริ่มอัปโหลดใบเสร็จ. กรณีต้องตรวจ แสดงสถานะและทางติดตามโดยไม่อ้างว่าร้านพร้อมแล้ว. เวลา trial เริ่มเมื่อ provision สำเร็จ.
4. ครั้งถัดไปเข้าได้ด้วยวิธีอีเมลที่รองรับจริง; ตั้งรหัสหรือเชื่อม LINE เพิ่มทีหลังได้. ห้ามส่งมอบ signup แบบไม่ใช้รหัสโดยยังไม่มีทางกลับเข้า/กู้บัญชีที่ไม่ใช้ LINE.

ข้อเสนอนี้เปลี่ยนลำดับ Flow B เดิมเฉพาะ flow ใหม่เมื่อออกแบบ/implement ครบ: email proof → eligibility → auto หรือ manual review → provision. คำขอเก่าที่รออนุมัติ/claim ต้องเดินต่อด้วย policy revision เดิม ไม่ถูก approve ใหม่จากการเปลี่ยนฟอร์ม.

## 4. Identity, review และ billing boundaries

- การยืนยันอีเมลพิสูจน์กล่องอีเมล ไม่พิสูจน์ว่าผู้ใช้เป็นเจ้าของร้าน/บัญชีทุกแถวที่มี contactEmail ตรงกัน. ห้าม merge หรือให้สิทธิ์บัญชีเก่าจาก unverified/contact email collision; ต้องใช้ account proof และ linking rules ที่มีอยู่.
- บัญชีเดิมที่ตั้งรหัสหรือผูก LINE แล้วต้องไม่ถูกเปลี่ยนวิธีเข้า/กู้บัญชีหรือยกเลิกข้อจำกัดเงียบ ๆ. ให้แยก new account, existing verified account, unverified-email collision และ held/revoked account ใน contract.
- ตรวจข้ามช่องทาง: คำขอเดิมที่ยังค้าง, ร้านเดิม, repeat-trial intent, prior rejection/hold และ concurrent submissions. ชื่อร้าน/อีเมล/มือถือเหมือนกันเป็น review signal ไม่ใช่หลักฐาน ownership. ร้านที่สองเป็น explicit intent และใช้กติกา trial ซ้ำที่อนุมัติแล้ว.
- เสนอ auto เฉพาะ first-time eligible applicant หลัง identity proof. กรณีซ้ำ/ข้อจำกัด/เกิน cap/สัญญาณที่ต้องตรวจยังใช้คิวเดิม. ต้องป้องกันสลับเว็บ/LINE เพื่อหลบ cap หรือได้ trial ซ้ำ; ห้ามคูณเพดาน auto โดยเปิด counter ต่อช่องทางโดยไม่ตั้งใจ.
- Persist source channel และ identity method แยกกันเพื่อวัด funnel เช่น มาจากเว็บ official แต่ยืนยันด้วย LINE; ไม่เพิ่ม analytics vendor ในงานนี้.
- ไม่มีบัตรหรือ Stripe ตอนสมัคร trial. เมื่อ billing พร้อม OWNER เลือกบริษัทก่อนซื้อ ใช้ company billing เดิม ไม่สร้าง subscription แยกตามช่องทาง/วิธี login.

## 5. Failure และ operational readiness

- Owner เลือก **Postmark** แล้วสำหรับ transactional email; [provider spec](mangmee-transactional-email-provider-spec-th.md), [API reference](../research/postmark-developer-reference-th.md) และ [plan](../plans/mangmee-transactional-email-provider-plan-th.md) ระบุ adapter/config/attempt/retry/webhook และแยก validation token/Sandbox/inbox proof. Receipt ค่า Postmark ใช้ลงบัญชีบริษัทเรา; customer Invoice/Receipt ใช้ Stripe. Postmark adapter/durable delivery/callback และ paid notification มี local integration evidence แล้ว; native inbox/operations/full signup ยังไม่ครบ ดูหลักฐาน integration ล่าสุด. การเลือก provider ไม่เลือก OTP/link หรือเปลี่ยน eligibility ให้เอง.
- อีเมลผิด/ไม่มา/หมดอายุ/ใช้ซ้ำ/ส่งซ้ำ/หลายแท็บ ต้องแก้และ retry ได้จากคำขอเดิม; changing email ต้องยกเลิก proof เดิมและยืนยันใหม่. Bounded attempts/rate limits, single-use proof และ atomic claim ห้ามถูกตัดเพื่อความสั้นของฟอร์ม.
- ปิด browser หรือ provision ล้มเหลวต้องกลับมาต่อได้ ไม่สร้างร้านซ้ำและไม่เผาวัน trial ระหว่างรอ. Refresh/กลับจากอีเมลบนคนละอุปกรณ์ไม่ทำให้การเปิดร้านสำเร็จแต่ผู้ใช้เข้าไม่ได้.
- ถ้า email provider ปิด/ส่งล้มเหลว ให้สถานะ unavailable/retry ตามจริง ไม่อ้างว่าส่งรหัสแล้วหรือเปิดร้านได้; mailto draft ไม่ใช่หลักฐานส่งสำเร็จ.
- มีบันทึก 2026-09-07 ว่า email delivery ถูก deferred; ไม่อนุมานว่า live ยังเป็นค่าดังกล่าววันนี้. ต้องตรวจและพิสูจน์จริงในงาน ops ก่อนเปิด email-based signup/login โดยอ่าน runbook cloud/release ก่อนเสมอ.
- Local simulated delivery ใช้พิสูจน์ app state/API/browser ได้ แต่ inbox delivery, sender setup, bounce/complaint และ production readiness ต้องมีหลักฐานแยก. ไม่เรียก local mailer ว่าส่งอีเมลจริงผ่านแล้ว.

## 6. เกณฑ์ยอมรับที่เสนอ

- ลูกค้าใหม่ไม่มี LINE: สมัคร → ยืนยันอีเมล → เปิดร้านอัตโนมัติเมื่อ eligible → อัปโหลดใบเสร็จบนเว็บได้; ไม่ตั้งรหัสระหว่าง onboarding ตามแบบที่เลือก.
- Logout/กลับมาใช้และกู้บัญชีได้โดยไม่ต้องมี LINE; บัญชีเดิม/held/revoked ไม่ถูก bypass.
- สมัครซ้ำพร้อมกัน, กลับ browser, ชนกับคำขอจาก LINE และ provision crash/retry → ไม่สร้าง user/company/trial ซ้ำโดยไม่ตั้งใจ.
- Linking ทั้ง email-first→LINE และ LINE-first→เว็บเข้าร้านเดิม; ไม่เริ่ม trial หรือ billing ใหม่. Shared contact ไม่ attach บัญชีให้อัตโนมัติ.
- Manual-review cases อยู่ในคิวและผู้สมัครเห็นเหตุ/next action ที่เปิดเผยได้; ไม่ให้ผล auto เพราะ client ส่ง flag หรือเปลี่ยนช่องทาง.
- Desktop/390px/keyboard, loading/error/expired/delivery outage, consent evidence และ first business action มี browser/API/DB assertions.
- หน้า official แสดง submitted/ready จาก backend evidence จริง; marketing handoff ส่ง attribution ที่ allowlist เท่านั้น ไม่ส่ง identity proof หรือ paid entitlement.

## 7. ข้อยังเป็นข้อเสนอ

Email code เทียบกับ one-time link, วิธีกลับเข้าและกู้บัญชีแบบไม่ใช้ LINE, ขอบเขต email auto-approval/abuse cap และการลด required fields ต้องออกแบบให้จบก่อน runtime change. User ยืนยันเป้าหมายความง่ายและ LINE optional แล้ว; ไม่ต้องถามเป้าหมายนี้ซ้ำ. ใช้ discussion ถัดไปปรับรายละเอียดที่มีผลต่อประสบการณ์และ policy ไม่ตีความว่าระบบใหม่ทำเสร็จแล้ว.
