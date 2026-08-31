# Runbook: ตั้งค่า AWS SES ส่งอีเมลระบบ (step by step สำหรับ Owner)

สถานะ: เขียน 2026-08-30 ตามคำสั่ง Owner ("เพิ่มทีหลัง โน๊ตไว้ให้ฉัน step by step") — **ยังไม่ได้ทำ**; ทำเสร็จเมื่อไหร่ = ปลดล็อก deploy UAT ของรอบ auto-register

ข้อเท็จจริงที่ตรวจแล้ว (2026-08-30):
- ผู้ส่งที่ Owner เลือก: **contact@mangmeeplus.com** — ใช้ได้ เพราะ SES ยืนยันที่ระดับโดเมน และกล่องรับเมลจริงอยู่บน **Google Workspace** (MX = aspmx.l.google.com) → ลูกค้ากดตอบเมลแล้วเข้ากล่อง Google เดิม ระบบรับเมลไม่ถูกแตะ
- DNS ของ mangmeeplus.com อยู่ **Cloudflare** (nameserver cory/dayana.ns.cloudflare.com)
- SPF ปัจจุบัน: `v=spf1 include:_spf.google.com ~all` (Google อย่างเดียว)
- บัญชี AWS 311414082667 **ยังไม่เคยตั้ง SES เลย** (= อยู่ sandbox, ส่งได้เฉพาะอีเมลที่ verify และวันละ 200 ฉบับ) และ IAM user ฝั่ง dev (`watchdog-bedrock-dev`) ไม่มีสิทธิ์ SES ใด ๆ

## ขั้นที่ 0 — เปิดทางให้ทำงาน (เลือกทางเดียว)

- ทาง A (แนะนำ): เพิ่ม policy ให้ IAM user `watchdog-bedrock-dev` ชั่วคราว: `ses:*` (หรืออย่างต่ำ `ses:GetAccount, ses:PutAccountDetails, ses:CreateEmailIdentity, ses:GetEmailIdentity, ses:CreateConfigurationSet*, ses:PutConfigurationSet*, ses:ListEmailIdentities, ses:CreateEmailIdentityPolicy, ses:PutEmailIdentityDkimAttributes, ses:PutEmailIdentityMailFromAttributes`) → ผมทำขั้น 1–5 ให้เองหมด เหลือคุณแค่วาง DNS (ขั้น 2) และกดฟอร์มขอออก sandbox (ขั้น 4 — AWS บังคับกรอกในนามเจ้าของบัญชี)
- ทาง B: คุณเปิด AWS Console เอง (region **ap-southeast-1**) แล้วทำตามขั้น 1–5 ทีละจอ (ผมนั่งไกด์ในแชตได้)

## ขั้นที่ 1 — สร้าง identity ระดับโดเมน

Console → Amazon SES → Identities → **Create identity** → เลือก **Domain** → กรอก `mangmeeplus.com` → เปิด **Easy DKIM (RSA_2048)** → Create. จอถัดไปจะโชว์ **CNAME 3 รายการ** (DKIM)

## ขั้นที่ 2 — วาง DNS ใน Cloudflare (คุณทำ ~5 นาที)

Cloudflare → เลือกโซน mangmeeplus.com → DNS → เพิ่มตามที่ SES โชว์:
1. **CNAME ×3** (ชื่อรูปแบบ `xxxx._domainkey.mangmeeplus.com` → ค่า `xxxx.dkim.amazonses.com`) — ตั้ง **Proxy status = DNS only (เมฆเทา)** ทั้งสามรายการ ห้ามเปิดเมฆส้ม
2. **ไม่ต้องแก้ SPF เดิม** (Easy DKIM ทำให้ DMARC ผ่านด้วย DKIM alignment; ระบบส่งใช้ MAIL FROM ของ amazonses เอง) — ถ้าจะเนี้ยบสุดค่อยเพิ่ม custom MAIL FROM ทีหลัง ไม่บังคับ
3. แนะนำเพิ่ม DMARC ถ้ายังไม่มี: TXT ชื่อ `_dmarc` ค่า `v=DMARC1; p=none; rua=mailto:contact@mangmeeplus.com` (โหมดเฝ้าดู ไม่กระทบเมลเดิม)

รอ SES ขึ้น **Verified** (ปกติไม่กี่นาที–ชั่วโมง)

## ขั้นที่ 3 — Configuration set + event ตีกลับ

SES → Configuration sets → Create ชื่อ `mangmee-transactional` → เปิด event destination ชนิด **SNS** สำหรับ Bounce + Complaint (สร้าง SNS topic `mangmee-ses-events`) — เฟสแรกยังไม่ต้องต่อ consumer อัตโนมัติ แค่ให้มีปลายทางเก็บหลักฐานไว้ก่อน (งานต่อ consumer เป็นของ backend รอบถัดไปตาม P11 F-EM-2)

## ขั้นที่ 4 — ขอออกจาก sandbox (คอขวดเวลา ~24 ชม. — ทำเร็วสุด)

SES → Account dashboard → **Request production access**: Mail type `Transactional`, website `https://official.mangmeeplus.com`, use case อธิบายสั้น ๆ: "Transactional emails (account activation links) for MangmeePlus ERP customers who sign up on our website. Low volume (<500/month), double opt-in style claim links, bounce/complaint handled via SNS." → Submit แล้วรอเมลอนุมัติจาก AWS

## ขั้นที่ 5 — ตั้งค่าระบบ (ผมทำ)

- UAT ก่อน: เพิ่ม env ใน deploy ของ api-web: `EMAIL_PROVIDER=ses`, `SES_REGION=ap-southeast-1`, `SES_FROM_ADDRESS=contact@mangmeeplus.com`, `WEB_BASE_URL=https://uat.mangmeeplus.com` (production ใช้ https://mangmeeplus.com) — ผ่าน deploy.sh ตาม pattern ปกติ (pinned file → re-sync pins)
- ทดสอบจริงบน UAT: สมัคร → อนุมัติ → เมลเข้ากล่องจริง → DKIM = pass ใน header → กดลิงก์ตั้งรหัสสำเร็จ → ทดสอบ bounce ด้วย `bounce@simulator.amazonses.com`
- แล้วค่อยเปิด production ตาม release ปกติ

## เช็คลิสต์ — ผลจริง 2026-08-31 (Fable ทำผ่าน Chrome ของ Owner)

- [x] ขั้น 0: Owner login console ใน Chrome ให้ (ทาง B)
- [x] ขั้น 1: identity `mangmeeplus.com` + Easy DKIM RSA_2048 → **Verified / DKIM Successful**
- [x] ขั้น 2: CNAME 3 รายการใน Cloudflare (DNS only) — DMARC TXT ยังไม่ใส่ (dialog Cloudflare งอแง; optional ไม่กระทบการส่ง — follow-up เล็ก)
- [x] ขั้น 3: configuration set `mangmee-transactional` + SNS `mangmee-ses-events` (Deliveries/Hard bounces/Complaints)
- [x] ขั้น 4: ยื่น production access แล้ว — **Under review** (~24 ชม.; ระหว่างนี้ sandbox ส่งหา @mangmeeplus.com และ simulator ได้)
- [x] ขั้น 5 (ฝั่ง repo): deploy.sh UAT = EMAIL_PROVIDER=ses + SES_FROM_ADDRESS=contact@mangmeeplus.com + EXTERNAL_SIGNUP_ENABLED=true; production fail-closed ทั้งคู่; สิทธิ์ ses:SendEmail ผูกกับ provider gate ใน task-role policy ที่ deploy.sh เขียนเอง
- หมายเหตุ: อย่าแก้ policy `watchdog-bms-uat-api-runtime` ใน console — deploy.sh เขียนทับทุกรอบ ให้แก้ที่ deploy.sh เท่านั้น

## ขั้นที่ 6 — ต่อ consumer ตีกลับ/ร้องเรียน (P11 F-EM-2, ทำหลัง deploy)

ก่อนขั้นนี้ เมลที่ hard bounce ยังนับว่า "ส่งแล้ว" เพราะการส่งไม่ได้แนบ configuration set และไม่มีใครอ่าน SNS
หลังขั้นนี้ bounce ถาวร/complaint จะดัน `CompanySignupRequest` จาก `EMAIL_PENDING` → `EMAIL_FAILED`
(ติดธงในคิวแอดมิน + resend/reissue เดิมใช้ได้ทันที ตาม spec §4D)

1. **env (ผ่าน deploy.sh เท่านั้น — pinned file, integrator เป็นคนใส่ + re-pin):**
   - `SES_CONFIGURATION_SET=mangmee-transactional` — ถ้าไม่ใส่ การส่งจะไม่แนบ configuration set และ **จะไม่มี event ออกมาเลย**
   - `SES_EVENTS_TOPIC_ARN=arn:aws:sns:ap-southeast-1:311414082667:mangmee-ses-events` — ถ้าไม่ใส่ endpoint จะ **ปฏิเสธทุกข้อความ 403 (fail closed)** รวมถึงการยืนยัน subscription; UAT/production ใส่คนละค่าได้
   - ไม่ต้องแก้ IAM: statement `ses:SendEmail` ที่ deploy.sh เขียน ระบุ `configuration-set/mangmee-transactional` ไว้แล้ว
2. **สร้าง subscription (ทำหลัง deploy รอบที่มี env แล้ว):** SNS → topic `mangmee-ses-events` → Create subscription →
   Protocol **HTTPS** → Endpoint = `<origin>/v1/public/ses-events` → Create
   - **`<origin>` ต้องเป็น ECS Express URL จาก SSM** `/watchdog-bms/<env>/ecs-express-api-web-url`
     ไม่ใช่ custom domain — เหตุผลเดียวกับ LINE webhook: custom domain ตอบ GET ได้ แต่ POST ได้ `REQUEST_TIMEOUT`
     (ดู `cloud-environment-operations.md` → Employee LINE webhook) และการยืนยัน subscription ของ SNS เป็น POST
   - เส้นทางผ่าน Next proxy (`https://<domain>/api/v1/public/ses-events`) ก็ถึงปลายทางเดียวกัน แต่เพิ่ม hop โดยไม่จำเป็น
   - endpoint **ยืนยันเองอัตโนมัติ**: มันตรวจลายเซ็น SNS + TopicArn ก่อน แล้วค่อย GET `SubscribeURL` ให้ ไม่ต้องกดอะไรใน console
   - ถ้า subscription ค้าง `PendingConfirmation`: แปลว่า `SES_EVENTS_TOPIC_ARN` ยังไม่ตรง/ยังไม่ deploy หรือ endpoint ยังไม่ถึง → ดู log `ses.sns.signature_invalid` / 403 ใน CloudWatch แล้ว **Request confirmation** ซ้ำ
3. **ตรวจของจริงบน UAT:** สมัคร → อนุมัติ โดยใช้อีเมล `bounce@simulator.amazonses.com` → คำขอต้องเปลี่ยนเป็น `EMAIL_FAILED`
   ภายในไม่กี่วินาที + มี audit `signup.claim_email.bounced` (เก็บผู้รับที่ตีกลับ + diagnosticCode ตัดที่ 200 ตัวอักษร)
   → กด resend/แก้อีเมล แล้วต้องกลับเข้า `EMAIL_PENDING` ได้
   - `complaint@simulator.amazonses.com` = เส้นทาง complaint (audit `signup.claim_email.complaint`)
   - `ooto@simulator.amazonses.com` = bounce ชั่วคราว → ต้อง **ไม่** เปลี่ยน state (log อย่างเดียว)
   - Delivery event ปกติถูกละเว้นเงียบ ๆ (debug log) — SNS ได้ 200 ทุกกรณีที่รับไว้ เพื่อไม่ให้ retry วนซ้ำ
