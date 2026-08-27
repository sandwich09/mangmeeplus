# Agent Memory: brain-ocr-evidence-harvest

Status: รอบแรกเสร็จ 2026-08-27 — กวาดหลักฐานจริงจาก UAT DB + prod (เท่าที่สิทธิ์ให้) ตามคำสั่ง Owner สำหรับ baseline "ตอบถูก+เร็ว" (B0/B1) และ golden set OCR/หมวดหมู่ (S1-R1)

Owner: thawatchai (Product Owner)

Scope: อ่านอย่างเดียวทั้งหมด — UAT RDS ผ่าน `infra/uat/db-port-forward.sh` (ปิดอุโมงค์แล้ว), prod ผ่าน T0 (CloudWatch filter-log-events + S3 list) ตาม `production-support-access.md`; ไม่มี synthetic message, ไม่แตะ root

Decisions (Owner 2026-08-27 — ตอบ 4 ข้อของ strategy discussion):

1. Baseline ใช้ log/ข้อมูลที่มีอยู่แล้วใน UAT+prod ไม่ต้องยิงข้อความใหม่
2. หมวดหมู่จากนักบัญชีมีอยู่แล้ว (ส่งเป็น Excel) — ระบุได้ว่าคือ **ผังบัญชี 175 บัญชี** ที่วิเคราะห์ไว้ใน `docs/research/chart-of-accounts-csv-analysis.md` (ต้นฉบับ `ผังบัญชี.csv` อยู่เครื่อง spare058; เครื่องนี้ไม่มีไฟล์ xlsx อื่นที่เข้าเค้า — ถ้า Owner หมายถึงไฟล์อื่นต้องส่งซ้ำ)
3. SLO table (simple-read p50≤3s/p95≤8s ฯลฯ) **ยอมรับเป็นเป้าทดลอง** จนกว่า baseline ออก
4. เดินคู่ขนาน: ความเร็ว = activation ของโค้ดที่ merge แล้ว; ความแม่น = เก็บ golden จากใบเสร็จจริงใน log

## ผลกวาด UAT (DB จริง, 2026-08-27)

### ความเร็ว/ต้นทุนสมอง (AiUsageEvent เดือน 2026-08)

- **Model calls ต่อ 1 turn (group by requestId):** 1 call=83 turns, 2=48, 3=49, 4=14, 6=25, 7=2 — turn ที่ใช้ tools จริงกิน **4–7 calls** ยืนยัน "ช้าโดยโครงสร้าง" ด้วยข้อมูลจริง
- **จุดแพงสุด: `line.intake-route`** — 214 calls, avg input **17,449 tokens/call**, avg 1.95 บาท/call (รวม 418 บาท ~80% ของค่า LINE-AI ทั้งเดือน) และ **cache แทบไม่ทำงาน** (avg cacheRead 1,664 vs fresh 17,449; เทียบ plan-route ที่ cache 4,015/914) → lever อันดับ 1: prompt-cache/ลดขนาด intake-route prompt
- line.loop avg 0.28 บาท, compose 0.27, critic 0.12 — ตัวอื่นถูกหมด
- LINE webhook UAT 90 วัน: สัปดาห์ 10 ส.ค.=171, 17 ส.ค.=194, 24 ส.ค.=21 events — **มี traffic จริงพอทำ baseline** (memory เดิมที่ว่า 0 คือ snapshot 25 ส.ค.)
- AuditLog ไม่มี action `line.ai.%` เลย (0 แถว 30 วัน) → per-stage p50/p95 ต้องอ่านจาก CloudWatch log (UAT เก็บ 3 วัน) ไม่ใช่ DB

### OCR (AuditLog `expense.ocr.request` ทั้งหมด 145 แถว)

- 2026-07: ok 25 / failed 10 / not_configured 4; 2026-08: ok 43+4(web) / NEEDS_REVIEW(line) 15 / failed 5 / no-status 32
- documentKind: ABBREVIATED_TAX_INVOICE 52, TAX_INVOICE 28, RECEIPT 19, HANDWRITTEN_CASH_BILL 10, ORDER_OR_CHECK_BILL 9, TRANSFER_SLIP 7, MARKETPLACE 4 — "หลายรูปแบบ" ตามที่ Owner ว่าจริง
- Spend: ส.ค. stage-2 extract 130 ครั้ง ≈ 80 บาท + re-read 15 ครั้ง ≈ 6.8 บาท (Typhoon stage-1 ไม่ถูก meter)

### คลัง golden (ใบเสร็จจริงที่คนยืนยันแล้ว)

- Expense ที่มีรูปใบเสร็จ 135 แถว; **CONFIRMED 24** โดย **confirmed+มีหมวด = 18 ใบ** (เป้า S1-R1 = 30)
- ความหลากหลายดี: transfer slip, handwritten, Starbucks/ร้านกาแฟ, MR.DIY, โรงพยาบาล, marketplace screenshot, ลายมือ ฯลฯ (list ตัวอย่าง 27 แถวถูกดึงแล้ว — query ซ้ำได้ตาม SQL ใน transcript)
- Pool เพิ่ม: NEEDS_REVIEW 88 แถวรอคนยืนยัน → **ทางปิด gap 12 ใบ: Owner ยืนยันเพิ่มในเว็บ UAT ~12 ใบ หรือดึงจาก prod (ต้อง T1)**

## Prod (T0 เท่าที่สิทธิ์ IAM `watchdog-bedrock-dev` ให้)

- `/ecs/watchdog-bms-prod-ai-gateway` 14 วัน: มีแต่ boot log (13 ส.ค.) = **AI traffic prod ≈ 0**; api-web มีชีวิต (health)
- `logs:StartQuery` ถูก Deny (filter-log-events ใช้ได้), S3 prod bucket ListBucket ถูก Deny (by design)
- ใบเสร็จ prod มีจริง (~4MB prefix `cmr*` ตาม runbook 08-09) แต่เข้าได้ทาง **T1 `connect-production.sh view` เท่านั้น** (interactive + transcript; ห้าม port-forward per D8) → ถ้าต้องใช้ prod receipts ต้องนัด ceremony กับ Owner

## Artifacts/วิธีทำซ้ำ

- Tunnel: `infra/uat/db-port-forward.sh` (แท็บค้าง) + `psql "$(... --url)"`; SQL ชุดเต็มอยู่ใน session transcript 2026-08-27
- ห้ามลืม: อ่าน `cloud-environment-operations.md` + `production-support-access.md` ก่อนทุกครั้ง

## Next

1. ดึง per-stage latency จาก CloudWatch UAT (หน้าต่าง 3 วัน — สัปดาห์ 24 ส.ค. มี 21 events) → ตาราง p50/p95 ฉบับแรก pin SHA (B1)
2. Export 18 confirmed receipts (ภาพ+label) จาก UAT → เติม golden fixtures แบบ sanitized; ขอ Owner ยืนยันเพิ่ม ~12 ใบจาก pool NEEDS_REVIEW 88 ใบ
3. เสนอแก้ intake-route: เปิด prompt caching เต็ม/ตัด catalogue ที่ยัดเข้า prompt (17k tokens) — คาดลดต้นทุน ~10x และตัด latency ก้อนแรก
4. ทำตามลำดับ activation เดิม (assessment): loading-on-accept → debounce cohort → prepared lane canary; ทุก flag ผ่าน UAT ก่อน
