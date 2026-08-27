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

## รอบจูนใหญ่ 2026-08-27 เย็น (Owner: "จูนให้ครบทีเดียว")

- Owner อนุมัติขยาย approval `DPO-2026-07-23-bedrock-global` ให้ UAT (chat directive 2026-08-27) → ตั้ง repo variable `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` แล้ว; UAT deploy ถัดไปรัน Sonnet 4.6 ทั้ง chat+doc เท่า production
- หลักฐานรอบทดสอบแรกของ Owner: เลนเร็วไม่ยิง (preparedPlanVersion=null ทุกเทิร์น — โมเดล 3.5 ไม่ emit fused plan), intake 5.5s (prompt ใหญ่ขึ้น+โมเดลเก่า), รูปใบเสร็จ→unknown
- จูนชุดเดียว: UAT debounce default 1000ms (deploy.sh wiring ใหม่ + pins re-synced), composer ธุรกิจ = คำตอบ+ตัวเลขบรรทัดแรก ≤400 ตัวอักษร, casual = ปลดล็อกความรู้ทั่วไป/ธุรกิจ/บัญชี/ภาษี + ตัวย่อแชทไทย (Owner concept: คุยได้แบบ ChatGPT) โดยคงกติกา: ห้ามเลขบริษัทนอก tools, ห้ามอ้างข้อมูลสด, เคสเฉพาะให้เช็คนักบัญชี; casual maxTokens 180→400; gateway suite 984/0

## Release ledger UAT 2026-08-27 (รอบจูนใหญ่)

- Run IDs ตามลำดับ: 33054181991 (fail: ci.yml candidate≠main) → 33054568144 (fail: maintenance pins stale) → 33054821373 (fail: ECR 4 HIGH openssl CVEs) → 33056939107 (สำเร็จ — Sonnet 4.6 + debounce 1000ms + composer/casual ใหม่) → 33062335397 (สำเร็จ — แต่พบเลนเร็วตายใน AgentCore + evidenceRoles bug) → 33066376858 (ยกเลิกตามคำสั่ง Owner "อย่าพึ่งดีพอย") → **33066716942 สำเร็จ (final)**
- Candidate final: `79c018ef9f15ee0bec0635fc63688155262bff09` (PR #304 AgentCore lane flags env-aware, #305 evidenceRoles tolerant-filter + prompt enumeration)
- Verified 2026-08-27 ~19:00: ทั้ง 3 service (api-web / ai-gateway / workers) digest = `git-79c018ef...`; `/v1/health` 200 ok; AgentCore artifact `watchdog_orchestrator_uat_candidate-NwJNiqG5Jd` qualifier `candidate_uat_79c018ef9f15_4ffbf835` env มี `LINE_AI_FUSED_PLAN_SHADOW_ENABLED=true`, `LINE_AI_PREPARED_SIMPLE_READ_ENABLED=true`, families 4 ตัวครบ; smoke 2 เคสผ่าน (forbidden read + mutation refused) บน `global.anthropic.claude-sonnet-4-6`; prompt cache ทำงานจริง (call แรก cacheWrite 7,239 → call สอง cacheRead 7,239)
- ECR waiver openssl 4 CVE หมดอายุ 2026-09-10 — ต้อง revisit เมื่อ Debian ออก patch
- ค้าง: Owner retest บน LINE UAT → ดึง per-stage latency ทำตาราง before/after → ถ้าเลนเร็วยังไม่ยิงบน 4.6 debug ต่อใน artifact
- **รอบ A+B (Owner สั่ง "ขนของ develop เข้า main และ deploy UAT" 2026-08-27 ~19:40):** PR #308 (develop→main, merge `007dcba7` — บรรทุก #307 A+B, #265 LINE self-service recovery, #306 local-active regression; 150 ไฟล์; tree main==develop ยืนยันแล้ว)
  - Run **33075313286 FAILED** ที่ Resolve UAT Release: "release commit is not reachable from origin/develop" — ผมส่ง merge SHA ของ main เป็น release_ref; contract จริงคือ **release_ref ต้องเป็น commit บน develop** (main เป็นแค่ controller) — บทเรียนใหม่ของ protocol
  - Run **33075441692 SUCCESS** (จบ 13:50Z): release_ref = develop tip `a53bb992fc04713d7cba2f2b19c08286f27c08e5`, controller ref=main (`007dcba7` มี deploy.sh advisor wiring)
  - Verified 2026-08-27 ~20:51: ทั้ง 3 service digest = `git-a53bb992...`; `/v1/health` 200; api-web env `LINE_AI_ADVISOR_MODE=social` (เลนใหม่ติดอาวุธแล้ว) + debounce 1000 + loading + ledger ครบ; AgentCore artifact env เลนเร็วคงเดิม (fused/prepared true + 4 families)
  - รอ Owner retest: (1) รูป+พิมพ์คุยทันที ต้องได้คำตอบจริง (2) ทักเล่น ~5-6s + log `line.ai.advisor_direct_served` (3) 4 คำถามเลนเร็วธุรกิจ (4) ใบเสร็จใบเดิมยังอ่านถูก

## รอบเทสรัว (Owner 21:32) → แก้ครบ 3 ข้อตามสั่ง (2026-08-27 ดึก)

- วินิจฉัยจาก log 14:32-14:35Z: (ก) เลน advisor ยิงจริงครั้งแรก (`advisor_direct_served` — "หวัดดีจร้าา" การ์ดเขียว) (ข) busy-wait 25s แพ้เทิร์นรูป 4-model-call (ช่องว่าง lease เป็น ms) → "ดูค่าใช้จ่าย" bounce แล้ว ledger ตามตอบ 14:35 (ค) ปุ่ม talk + ข้อความรอคิว 23.6s เพราะ busy-wait ถือ per-chat worker (ง) **ใบเสร็จ CHAGEE ตายหลัง OCR สำเร็จ: `TRANSACTION_BRANCH_REQUIRED` (บริษัทหลายสาขา, LINE ไม่มีตัวเลือกสาขา) + copy โกหกว่า "ชั่วคราว"**
- แก้ (branch codex/rapid-fire-fixes): (1) **สาขา**: `pickLineDefaultBranchId` (สาขาเดียว→ใช้เลย; หลายสาขา→HEAD_OFFICE ตัวเดียว; ไม่ได้→undefined) + query ก่อน initReceiptUpload + catch แยก TRANSACTION_BRANCH_* → `RECEIPT_BRANCH_REQUIRED_REPLY` (บอกไปเลือกสาขาบนเว็บ ไม่ชวน retry) (2) **คิว**: lease แยกเลน `chat`/`media` ต่อบริษัท (meter laneKey; overshoot งบสูงสุด ~฿2/เลน Owner รับ) + คำสั่งเมนู stateless ลัดคิวทันทีแม้ worker ไม่ว่าง (คำสั่ง /company ยังรักษาลำดับ) + `promotion` ข้าม legal preflight เหมือน contact/talk (3) **ข้อความซ้อน**: ตัด status bubble 5 วิของเทิร์นข้อความเมื่อ loading animation เปิด (ack รูป delay-0 คงเดิม; spec buffer อัปเดตเป็นสัญญาใหม่ 4 เคส)
- ผลคาด: คุยระหว่างรูป = ตอบสดผ่านเลน chat ไม่ต้องรอ/ไม่ bounce; ปุ่มเมนูตอบทันทีเสมอ; ใบเสร็จบริษัทหลายสาขาบันทึกเข้า review ด้วยสำนักงานใหญ่; แชทรกน้อยลง

## บิลน้ำมันอ่านไม่ได้ 23:04/23:07 → intake vision timeout (Owner สั่งแก้ 2026-08-27 ดึก)

- อาการ: ส่งบิลน้ำมัน 2 ครั้ง ได้คำถามกลับว่ารูปอะไร; log: `line.intake-route` `PROVIDER_TIMEOUT` **15,011ms / 15,006ms** (`usageEstimated:true` → inputTokens 200000 เป็นค่าประมาณตอน timeout ไม่ใช่ token จริง) → route UNAVAILABLE → terminal `clarification_required`
- Root cause: `line-ai-internal.controller.ts:125` สร้าง `IntentRouterAgent(createProvider(this.config))` **ไม่ override timeout** → ได้ `AI_TOOL_TIMEOUT_MS`=15s (งบแชท) ขณะที่ทุก document path ในไฟล์เดียวกัน (161/205/325) ใช้ `DOCUMENT_OCR_TIMEOUT_MS`=45s; intake ตอนนี้ทำ vision + fused-plan prompt ก้อนใหญ่ = document workload แต่ถูกจับเวลาแบบ chat
- หลักฐานว่าเป็นปัญหาเชิงระบบ ไม่ใช่บิลน้ำมันใบเดียว: CHAGEE 21:32 = **15,003ms ok:true** (รอดหวุดหวิด), บิลน้ำมัน 15,011/15,006 = ตาย → รูปทุกใบเสี่ยง ~50/50
- แก้ 2 จุดคู่กัน (PR #314): gateway = attachment → `DOCUMENT_OCR_TIMEOUT_MS` (text-only คงงบแชท 15s ไม่ทำให้แชทช้าลง); api = `LINE_INTAKE_MEDIA_TIMEOUT_MS` 55s เฉพาะ media path (เดิม 30s จะตัดก่อน gateway 45s ทำให้ fix ฝั่ง gateway ไร้ผล)
- Verify: gateway suite **990/990**, api client/webhook/dispatch เขียว, typecheck ทั้ง 2 app สะอาด; เทสใหม่ 2 เคสใช้ fake timers พิสูจน์ทั้งสองทิศ (มีรูป: ไม่ตายที่ 15.1s แต่ตายในงบ 45s; ข้อความล้วน: ยังตายที่ 15s)

## สลิปรูดบัตร PTT อ่านไม่ได้ 23:18 → reason-code vocabulary (Owner สั่งแก้ทั้ง 2 ทาง 2026-08-27 ดึก)

- **ไม่ใช่ timeout** (ต่างจากบิลน้ำมัน 23:04/23:07): log 23:18:28 = `ok:true durationMs 13130` แต่ plan = UNAVAILABLE/UNSUPPORTED/confidence 0 → `ROUTER_JSON_PARSE_FAILED`
- พิสูจน์ด้วย local harness (สร้างสลิปจำลอง PTT/Jiffy/KBank → ยิง `IntentRouterAgent` + Sonnet 4.6 จริง, ดัก raw output): **โมเดลอ่านออกครบทุกฟิลด์** (PTT Station Jiffy, 1,000.00, KTC-Visa ****3544, APPR 594567, จัดหมวด cat-fuel เอง, ทักด้วยว่าไม่มีจำนวนลิตร) แต่กรอก `missingRequiredSignals: ["itemised fuel quantity/litres not shown on this slip"]` = ประโยคอิสระในช่องที่รับเฉพาะ reason code → `parseKnownArray` strict → classification null → บรรทัด 887 `if (raw['documentClassification'] !== undefined && !documentClassification) return null` → ทิ้ง plan ทั้งก้อน
- Root cause แท้จริงอยู่ที่ **prompt**: ทุก field enumerate ค่าที่อนุญาต ยกเว้น `missingRequiredSignals`/`contradictionSignals` ที่เขียนไว้แค่ `[]` เปล่า — **บั๊กพันธุ์เดียวกับ evidenceRoles เมื่อวาน** ที่ผมแก้ field เดียวโดยไม่ไล่ดู field พี่น้อง (บทเรียน: แก้ทั้งตระกูล)
- แก้ 2 ทางตามที่ Owner สั่ง (PR #315): (1) prompt render vocabulary จาก `BUSINESS_DOCUMENT_REASON_CODES` โดยตรง (ไม่ drift) + ประโยคห้าม free text + ใบ้ว่าสลิปบัตรคือ `PAYMENT_EVIDENCE_ONLY` (2) parser: `parseReasonCodes` filter รหัสที่ไม่รู้จัก + คืน `sawUnknown` → เติม `HUMAN_REVIEW_REQUIRED` + `requiresClarification=true` แทนการทิ้งทั้งใบ (non-array = shape เสีย ยังทิ้งเหมือนเดิม); ลบ `parseKnownArray` ที่ไม่มีผู้ใช้แล้ว
- พิสูจน์หลังแก้ (harness เดิม, โมเดลจริง): สลิปใบเดียวกัน → **ROUTED / EXPENSE_DOCUMENT_CAPTURE**, vendor PTT Station Jiffy, 1,000.00, cat-fuel, documentKind `TRANSFER_SLIP`, และเลือกรหัสถูกเอง `["PAYMENT_EVIDENCE_ONLY","MISSING_TAX_BASE_OR_VAT","MISSING_VENDOR_TAX_ID"]` — ตรงกับข้อสังเกตของ Owner ว่า "เหมือนใบแจ้งเฉย ๆ ไม่ใช่ใบเสร็จ" (EDC customer copy ขอคืน VAT ไม่ได้ ต้องขอใบกำกับภาษีจากปั๊ม)
- Verify: gateway suite **994/994**, typecheck สะอาด, spec ใหม่ 5 เคส (escalate/ผสม/ไม่ flag เกินจำเป็น/contradiction/non-array)

## Rich menu v2 ver2 + capability fix (Owner สั่งพร้อมภาพดีไซน์ 2026-08-27 ค่ำ)

- Owner ส่งดีไซน์ 2 ภาพ: rich menu 6 ช่อง (Promotion แทน เริ่มต้นใช้งานฟรี) + โปสเตอร์แพ็กเกจ 4 tier; สั่ง (1) คำตอบ "ทำอะไรได้บ้าง" ห้ามโฆษณาของที่ใช้ไม่ได้ (2) ปุ่มถ่ายใบเสร็จเข้ากล้องตรง ไม่ถาม แนบ/กล้อง/กลับ (3) เปลี่ยน rich menu (4) ช่อง Promotion ขึ้นโปสเตอร์
- ทำแล้ว: manifest+spec `rich-menu-v2-ver2` (ใบเสร็จ = URI `https://line.me/R/nv/camera/` — camera action ใช้ได้แค่ quick reply; Promotion = message `โปรโมชั่น`), backend `staff_menu_promotion` (public) + `buildPromotionCard` (hero โปสเตอร์+ปุ่มทดลองฟรี), `isCapabilityQuestion`+`buildCapabilityCard` (การ์ด 6 ฟังก์ชันจริง, จับเฉพาะคำถามสั้น; "ใบกำกับภาษีใช้ยังไง" ไม่โดนดัก), spec/runbook ต่อท้ายส่วน Ver2
- **ค้างรอ Owner: ไฟล์ PNG 2 ไฟล์** — bitmap เมนู 2500x1686 + โปสเตอร์ 1080x1350 (วางที่ `apps/web/public/assets/line/` ชื่อตาม manifest แล้วบันทึก sha256/byteSize ลง manifest) และการ apply เข้า LINE OA ผ่าน Messaging API ตาม runbook (ต้องใช้ channel token; ทำหลัง backend deploy)

## วินิจฉัยรอบทดสอบ 2 (2026-08-27 18:58–19:02 ICT, log+code proof — ยังไม่แก้ รอ Owner สั่ง)

อาการ Owner: (ก) ส่งรูปแล้วพิมพ์คุยโดนบล็อคทั้งที่ ack บอกคุยได้ (ข) คุยช้า ขึ้น loading ทุกครั้ง (ค) คำตอบของข้อความที่โดนบล็อคเด้งมาทีหลัง ~3 นาที

1. **ตัวบล็อค = budget admission lease** (`runWithCompanyAiBudgetAdmission` → `tryAcquireLease` ใน company-ai-usage-meter.ts): บริษัทละ **1 AI call พร้อมกัน** ทุก call (intake/turn/OCR) ต้องถือ lease — ระหว่างรูปกิน intake 14.6s+OCR 7.4s ข้อความแชท 2 ตัว (11:59:08/12) เจอ busy → 429 AI_BUDGET_BUSY → map เป็น rate_limited (5ms ไม่แตะโมเดล) → ส่ง "⏳ ระบบกำลังประมวลผลข้อความก่อนหน้า กรุณารอสักครู่แล้วลองใหม่" ขัดกับ `LINE_MEDIA_RECEIVED_TEXT` ("ระหว่างนี้คุยกับน้องต่อได้เลยนะคะ") — ไม่ใช่ token bucket (AI_LLM_MAX_PER_COMPANY=60/60s ไม่มีทางชน)
2. **คำตอบมาทีหลัง = LINE AI ledger drain (item 10F, Redis Stream PEL)**: `tryRouteIntake` ล้มแบบเงียบ → `ledger.appendTurn` (:2899) เขียน entry ก่อนเรียก turn → turn โดน 429 → entry ไม่ถูก ack → cron ทุกนาที `DrainLineLedgerUseCase` XAUTOCLAIM หลัง min-idle → รัน `requestLineTurn` ตรง (ไม่ผ่าน intake, ไม่มี log line.ai/ai.line ตอนสำเร็จ — เทิร์น 12:02:00/12:02:06 requestId 00e7625a/5157d4bb) → push คำตอบเข้าแชท ⇒ สัญญาชนกัน: reply บอก "ส่งใหม่" แต่ ledger จะตอบให้อยู่ดี (ถ้าผู้ใช้ส่งซ้ำ = ตอบซ้อน)
3. **ความช้าแชทเล่น (วัดจริง)**: รวม 10.4–13.3s = debounce 1.0s + intake-route 3.8–4.4s (cache hit 9,642 แล้ว; output fused plan ~250 tokens) + artifact turn 3.4–6.1s (plan-route+casual compose) + delivery 0.2s ⇒ 3 model calls ต่อ 1 ข้อความแชทเล่น; loading-on-accept ทำให้เห็น "กำลังหาคำตอบ" ทุกเทิร์น
4. ข่าวดีที่พิสูจน์แล้ว: รูปใบเสร็จ route ถูก (EXPENSE_DOCUMENT_CAPTURE 0.97, OCR ok, จบ delivered 28s เพราะ cold cache — warm คาด ~15s), Sonnet 4.6 ทุกจุด, planVer=1 ออกจริง (lane=null เพราะคำถามเป็น casual ทั้งหมด — เลนเร็ว 4 family ยังไม่ถูกทดสอบ)

แนวแก้ที่เสนอ (รอ Owner เลือก): A=รอ+retry lease แทนบล็อค (คุยระหว่างรูปได้จริง), B=ยุบ 3 calls→2/1 สำหรับ casual + ตัด fused plan เมื่อไม่ใช่ read family (เป้า ~5-6s), C=แก้ RATE_LIMIT_REPLY ให้ตรงกับพฤติกรรม ledger + เร่ง drain min-idle

### Implement A+B (Owner สั่ง 2026-08-27 ค่ำ; "แก้แล้วยังไม่ต้องดีพอย — ขน develop เข้า main ไป UAT รอบเดียว")

- **A**: `retryBusyAdmission` ใน company-ai-usage-meter (poll 1.2s เฉพาะ outcome busy, ไม่มี deadline = fail-fast เดิม → drain ไม่เปลี่ยน); เดินสายผ่าน `runBudgeted` ของ ai-gateway.client (line-turn / intake / receipt-ocr รับ `busyWaitDeadlineMs`); use case ให้งบรอ 25s ต่อ live turn (text+media+OCR); ถ้ายังไม่ทันและมี ledger entry → ส่ง `BUSY_FOLLOW_UP_REPLY` ("เดี๋ยวตามมาตอบ ไม่ต้องส่งซ้ำ") แทน copy เดิมที่ชวนส่งซ้ำ
- **B**: เปิดใช้ Advisor Slice A ตาม spec (scaffolding PR #235 มีครบ: contract+parser+caps+intakeIntent binding) — เพิ่มเฉพาะที่ขาด: `line-advisor-direct-answer.logic.ts` (eligibility §9.2 ฝั่ง delivery: SOCIAL_CHAT เท่านั้น, needsTools=false, confidence≥0.80, ไม่มี refusal/clarification/card/profile/family, veto จำนวนเงินบาท, สถานะแชทว่าง) + block ส่งตรงหลัง intake ใน webhook use case (pattern เดียวกับ exact-greeting; log `line.ai.advisor_direct_served`) → casual = 1 model call; เคสไม่ผ่าน gate ตกไปทางเดิมทุกประการ
- deploy.sh: `LINE_AI_ADVISOR_MODE` UAT default `social`, production non-off exit 2, maintenance บังคับ off; pins re-synced `bytes=verified`
- Verify: typecheck api = 0 error (หลัง prisma generate + pnpm install ใน worktree — error ก่อนหน้าเป็น stale client/dep บน develop ไม่เกี่ยวงานนี้); advisor logic spec 8/8; meter spec 0 fail (รวม 4 เคส retryBusyAdmission); 4 suite เดิมที่แตะไฟล์ (process-line-webhook / line-intake-dispatch / ai-gateway.client / recover-orphan) exit 0 ไม่มี fail
- คาดผล: คุยระหว่างรูป = รอคิวแล้วตอบจริง (ไม่บล็อค/ไม่ตอบซ้อน), casual ~5-6s (debounce 1s + intake ~4s + ส่งเลย), เคส fallback เท่าเดิม; ยังไม่ deploy ตามคำสั่ง

## การตัดสินใจ Owner 2026-08-27 (ค่ำ): ผู้รับรองความรู้ภาษี/บัญชี

- **ผู้รับรอง (named reviewer) = นักบัญชีคนที่จัดทำผังบัญชี 175 บัญชี** (คนเดิมของบริษัท) — ใช้กับ P23 tax pack, Advisor Slice B, และการตรวจรายการสาเหตุ CN/DN (F-LED-6)
- **แหล่งความจริง = เว็บ/ประกาศกรมสรรพากรเท่านั้น** (rd.go.th) — ทุกการ์ดต้องแนบ citation ต้นทาง; นักบัญชีคือผู้เซ็นรับรองการตีความ ไม่ใช่แหล่งข้อมูลแทน RD
- ค้างเก็บตอนทำ pack แรก: ชื่อ-นามสกุลจริงของนักบัญชี (สำหรับ approver row) + SLA การทบทวน — Owner เป็นผู้ประสาน
- ลำดับที่ตกลง: (1) pack `mangmee-product-help` ก่อน (ไม่ติด gate) (2) pack ภาษีปี 2569 เมื่อได้ลายเซ็นนักบัญชี
