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

## เช็คลิสต์สั้น (ไว้ติ๊ก)

- [ ] ขั้น 0: สิทธิ์ AWS (ทาง A หรือ B)
- [ ] ขั้น 1: สร้าง domain identity + Easy DKIM
- [ ] ขั้น 2: วาง CNAME 3 รายการใน Cloudflare (DNS only) + DMARC
- [ ] ขั้น 3: configuration set + SNS bounce/complaint
- [ ] ขั้น 4: ยื่นขอ production access (รอ ~1 วัน)
- [ ] ขั้น 5: ตั้ง env UAT → ทดสอบ inbox/DKIM/bounce → ค่อยไป production
