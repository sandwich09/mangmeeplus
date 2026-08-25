# Agent Memory: mangmee-brain-2-5-day-priority-plan

Status: แผนฉบับร่างภาษาไทยขยายครอบคลุม Platform/LINE/Auto-register+email claim+shared OA/LIFF linking+Web QR Login/auto fallback/Onboarding/Operations/Quota/Incident/รายรับ, Auto Revenue/Reconciliation, post-submit expense UX และ mixed VAT แล้ว; docs-only; ยังไม่มีการแก้โค้ดหรือ deploy; 2026-08-25 ปรับเป็น v2 เรียงลำดับใหม่ตามเป้าหมาย รับคนให้ไหว → ใช้แล้วชอบ → โตต่อได้ (P3 ใหม่ = alarm/kill switch ก่อน GO, load smoke ใน Gate C, Gate เปิดวงกว้างต้นหัวข้อ 10); v3 วันเดียวกัน: Owner สั่งรายรับถอย, P6 เปลี่ยนเป็น AI แยกหมวดรายจ่าย (6A) + สมองมั่งมีเดโม (6B), Knowledge Pack ถอยไป P23, เพิ่ม P26 ระบบจ่ายเงิน/Subscription (จำกัดโควตาใบเสร็จ ใช้ต่อต้อง subscribe) ต่อจาก P14 และมาก่อน P15–P17; v4 วันเดียวกัน: Owner สั่งสมองมั่งมีไม่ใช่เดโม — สร้าง docs/specs/mangmee-brain-answer-architecture-assessment.md (Brain-Real Track B0–B7), 6B = B0 ยืนยัน telemetry + ล็อกคำถาม top-N

Owner: Product owner / Developer 1 คน

Scope:

- แปลงแผนตามเวลา 2.5 วันเป็นลำดับ P1, P2, P3, ... โดยไม่ใช้หัวข้อวันที่
- ตรวจสถานะเว็บ, สมองมั่งมี, UX ผู้ใช้ 40+, ความเสถียร, ความปลอดภัย และหลักฐานทดสอบที่มี
- ระบุ confirmed bug, UX risk, evidence gap, สิ่งที่ควรเพิ่มและเหตุผล
- กำหนดงานของ agent เฉพาะทางและ quality gate ที่ตรวจสอบย้อนกลับได้
- ตรวจ Platform System สำหรับจัดการบริษัท, LINE Login, auto-register จากเว็บไซต์ทางการและ email delivery
- ตรวจผู้ใช้หลายบริษัททั้งเว็บ/LINE, safe fast deploy, monitoring/user tracking, AI quota ต่อบริษัท และ incident mitigation ภายใน 15 นาที
- ตรวจความพร้อมของฟีเจอร์รายรับและวิธีต่อยอดจาก accounting/sales engine เดิม
- เพิ่มปัญหาจากผู้ใช้จริง: ส่งตรวจแล้วค้างหน้ารายละเอียด และใบเสร็จเดียวมีทั้งรายการมี VAT/ไม่มี VAT จนยอด reconciliation บล็อกการยืนยัน
- ประเมิน MANGMEE Auto Revenue จาก Bank/Gateway/Marketplace/POS/Invoice/API, Revenue Inbox, AI matching, accounting/tax impact และ full reconciliation boundary
- รวม flow ล่าสุดเข้า Auto-register: signup website → verify email/set Mangmee password → provision company/owner → add shared OA → LIFF account link/fallback → company select → first AI value
- เพิ่ม Web QR Login: desktop scan → LINE verification → first-party web session อัตโนมัติ; cancel/expiry/unlinked → Web Login หรือ Auto-register continuation โดยคง returnTo

Decisions:

- เป้าหมายที่ซื่อตรงกับเวลาปัจจุบันคือ Controlled Beta ไม่ใช่ Marketing วงกว้าง
- Feature ชูโรงคือ “สมองมั่งมี” แต่เปิดเฉพาะ lane ที่ผ่าน eval/permission/delivery gates
- ใช้สมองเดียวหลายโหมดและ AI Gateway เดิม; ไม่สร้าง runtime multi-agent swarm
- เพิ่มความรู้ผ่าน versioned Knowledge Pack; ใช้ compiled registry + lexical retrieval ก่อน
- tax/accounting high-risk pack ต้องมีผู้เชี่ยวชาญมนุษย์อนุมัติ
- ถ้า web chat ไม่พร้อมใน timebox ให้ dashboard CTA ไป LINE ที่พร้อมกว่า
- financial, tenant, malware, real-device และ exact-candidate evidence เป็น non-negotiable
- System Admin onboarding ปัจจุบันเหมาะกับ Controlled Beta และรองรับ attach Owner เดิม แต่ `modulePackage` ยังไม่กำหนด entitlement จริง
- Web multi-company รองรับทุก active membership อยู่แล้ว; LINE multi-company ยังเป็น Owner-only policy และต้องเปลี่ยนอย่างมี negative cross-tenant tests
- LINE Login foundation มีอยู่ แต่ controller fail-closed ด้วย 403 และปุ่มเว็บถูกซ่อน; ห้ามเปิดปุ่มก่อน callback/session/security E2E ครบ
- External signup ต้องใช้ integration endpoint แยก, service authentication, idempotency, durable state และ application onboarding service เดิม
- อีเมลแรกต้องเป็น single-use claim/set-password link; ห้ามส่ง temporary password; SES adapter/outbox ยังเป็นงานค้าง
- ใช้คำว่า Fast Hotfix Lane แทน bypass: feature CLOSE/targeted deploy/rollback ได้ แต่ห้ามข้าม security, migration, signed artifact และ customer verification
- SLA 15 นาทีหมายถึง acknowledge/contain/mitigate สำหรับ known failure classes ไม่ใช่ permanent fix ทุก incident
- Monitoring แยก Audit, operational trace และ product analytics; product events ห้ามเก็บ prompt/document/tax ID/LINE ID ดิบ
- AI มี per-company Redis bucket, monthly spend budget และ upload guards แต่ยังไม่มี per-company override ที่ implement แล้วหรือ canonical documents/month meter
- รายรับต้องต่อยอด `sales_documents`/receive payment เดิม; launch matrix blocker และ output-tax correctness ต้องผ่านก่อน Marketing
- P1–P8 ใช้ timebox 20 ชั่วโมงครบแล้ว; งาน implementation ใหม่ถูกเรียง P9–P18 และไม่รวม commitment เว้นแต่ Owner ตัด scope เดิมออก
- v2 (2026-08-25): จัดลำดับรอบ 2.5 วันใหม่ตามเป้าหมาย รับคนให้ไหว → ใช้แล้วชอบ → โตต่อได้ — P3 ใหม่คือ alarm ขั้นต่ำ + kill switch พิสูจน์จริง + incident drill 1 รอบก่อน GO (ดึงจาก P9); TTV เป็น P4, UX 40+ เป็น P5 (ทำติดกันเพราะแตะไฟล์ชุดเดียวกัน), สมองมั่งมีเป็น P6 = 6A (2 ชม. LINE-first) + 6B Knowledge Pack แกนขั้นต่ำ (1 ชม. ตัวแรกที่ตัดเมื่อชนเวลา); รวม 19.5 ชม. กันชน 0.5 ชม.
- v2: Gate C เพิ่ม load smoke บน exact candidate (อย่างน้อย 2 เท่าของ beta peak, hosted run เท่านั้น) และ P4 เพิ่มสถานะรอคิวเมื่อ OCR/AI หนาแน่น; GO ต้องผ่าน drill P3 + load smoke และ LIMITED GO ก็ยังต้องผ่าน P3 เสมอ
- v2: Gate เปิด Marketing วงกว้าง = (P9 ส่วนที่เหลือ + P25 load/capacity) และ (P10→P11→P12 สมัครเองได้) ต้องผ่านทั้งสองก้อน; หลังจากนั้น P14 → P15–P17 → P13 → P18–P24 โดย P9–P25 เป็นป้ายกลุ่มงาน ไม่ใช่ลำดับลงมือ
- v3 (2026-08-25) คำสั่ง Owner: ต้องเป็นงานจริง — ฟีเจอร์ที่ใช้อยู่มาก่อน; รายรับ/Auto Revenue ถอยไปหลัง P26; AI แยกหมวดหมู่รายจ่ายเป็นงาน AI อันดับหนึ่งของรอบ 2.5 วัน; เพิ่มระบบจ่ายเงิน/Subscription แทนรายรับ (คิวรอบถัดไป: P14 → P26 → P13 → P15–P17 → P18–P24)
- v3: ระบบมี category suggestion + auto-fill ตาม `RECEIPT_CATEGORY_AUTO_FILL_MIN_CONFIDENCE` อยู่แล้ว (receipt-ocr-apply.service.ts, expense-document.use-case.ts) → งาน 6A คือ golden set ≥30 ใบ + baseline + ปรับ mapping/threshold + UX ยืนยัน (pre-select, ไม่แน่ใจไม่เดา) + override rate metric; ห้ามเขียนใหม่
- v3: โมเดล subscribe = จำกัดโควตาใบเสร็จ; enforcement อ่อนโยนตาม 13.8 ข้อ 4 — โควตาเต็มยังอัปโหลด/กรอกเอง/อ่านของเดิมได้ เอกสารห้ามหาย; ห้าม enforce ก่อน meter (P14) + billing/หน้าชำระเงิน (P26) พร้อม; retry ไม่นับโควตา; enforcement มี kill switch ตามกติกา P3
- v3: Knowledge Pack แกนขั้นต่ำถอยไป P23 ทั้งชุด (registry/schema/packs); ถ้าเวลาไม่พอ 6A ลดเหลือ golden set + baseline แต่การวัดห้ามหาย
- v4 (2026-08-25) คำสั่ง Owner: สมองมั่งมีไม่ใช่เดโม — ต้องตอบฉลาด หาข้อมูลบริษัท เร็วและถูก; รีวิว architecture แล้วสรุปว่า **ไม่ออกแบบใหม่** เพราะสถาปัตยกรรมมีครบใน latency/autonomy lanes spec + advisor conversation spec และโค้ด Phase 0–6 **merge เข้า main แล้ว** (ผ่าน codex/line-ai-latency-autonomy-rebase) แบบ default-off
- v4 ข้อเท็จจริงจากการตรวจ: `LINE_AI_EXACT_GREETING_ENABLED` wire แล้ว (UAT on, production hard-block); flag เร่งความเร็วอื่น (loading-on-accept, debounce experiment, fused shadow, prepared simple-read, families) ยังไม่ wire เข้า deploy.sh = ปิดทุก env; compiled family มีตัวเดียว (sales.get_sales_summary::single_metric, allowlist ว่าง); **security suite 23 เคสไม่มี test รันจริง** (ไฟล์ถูกลบ 2026-08-21 เพราะ import ข้าม boundary พัง build); hosted baseline ยังไม่เคยวัด
- v4 Owner ยืนยันคำถาม top-N สำหรับ B6 (2026-08-25): เงินเข้า–ออกวันนี้ / สรุปรายการเดือนนี้ / สรุปค่าใช้จ่าย (ตัด "ยอดค้างรับ" ออกจากชุดแรก); mapping เบื้องต้น: accounting.get_summary สองข้อแรก, ค่าใช้จ่ายใช้ expense.list_recent/summary shape — ดู §6.1 ของ assessment
- v4 Brain-Real Track: B0 ยืนยัน telemetry UAT + บันทึกคำถาม top-N ที่ยืนยันแล้วลง manifest (ในรอบ 2.5 วัน = 6B) → B1 hosted baseline → B2 loading-on-accept → B3 debounce cohort 1,000ms → B4 fused-plan shadow → B5 re-establish security suite + เปิด prepared lane + family แรก (ผ่าน blind pairwise eval) → B6 ขยาย family top-N (เงินเข้า–ออกวันนี้, สรุป/หมวดค่าใช้จ่ายเพิ่ม, ยอดค้างรับ) → B7 advisor Slice A; ทุก flag เปิดผ่าน deploy.sh + UAT run (pattern PR #226); AI-01 ยัง gate ก่อน customer GO; cost gate -30%/lane
- หลัง `mark-ready` สำเร็จต้องใช้ list route เป็น terminal state: `router.replace`, toast, highlight exact expense และสถานะ READY_FOR_CONFIRMATION; failure ต้องคงค่าบนหน้าเดิม
- Mixed VAT เป็น P2 financial correctness: VAT treatment ต่อบรรทัด, unknown แยกจาก explicit no-VAT, document source VAT แยกจาก calculation และ no-VAT line ห้ามเข้า VAT base
- อนุญาต deterministic rounding allocation เฉพาะกรณีอัตราบวกเดียวร่วมกับ no-VAT และอยู่ใน approved tolerance; หลายอัตราบวก/unknown/เกิน tolerance ต้อง review แบบชี้บรรทัด
- Draft save ต้องไม่เป็นทางตันเพราะ VAT mismatch แต่ final confirmation ยังคง fail-closed จนแก้หรือใช้ reviewed/audited override
- Auto Revenue ต้อง reuse Banking statement/match, AccountingPayment/allocation, AccountingDocument, Ledger และ Tax เดิม; Revenue Inbox เป็น orchestration/read model ไม่ใช่ payment ledger ใหม่
- Bank deposit เป็น cash evidence ไม่ใช่ Revenue/tax point โดยอัตโนมัติ; unknown deposit ต้องค้าง Unidentified/Suspense และ reviewed classification
- Invoice payment ต้อง Dr Bank/Cr AR โดยไม่รับรู้ Revenue/output VAT ซ้ำ; customer deposit, transfer, capital/director loan, bank loan, refund และ marketplace settlement ต้องแยก accounting treatment
- เริ่มจาก imported Bank Statement + Invoice/Payment matching ก่อน direct bank/gateway/marketplace connector
- AI ทำ deterministic-first ranking/explanation; ช่วง Beta Accountant Review ก่อน posting และ ambiguous/no-invoice fail closed
- เป้าหมาย 95% เป็น North Star ของ coverage หลัง precision ผ่าน; วัด precision/coverage แยก และไม่เปิด auto-post จน source-specific sampled precision อย่างน้อย 99.5% ตาม risk gate
- Marketplace/Gateway ต้องทำ gross-to-net settlement; ห้ามถือ net bank settlement เป็น Revenue ทั้งก้อน
- Full bank reconciliation ต้องรวมเงินออก, fee, interest, transfer, opening/closing balances และทุก statement line ไม่ใช่ Revenue Inbox อย่างเดียว
- ฝั่งภาษีต้องเชื่อม sales/output VAT report และ ภ.พ.30 ตาม tax point; WHT รับเก็บ 50 ทวิ/receivable; ภ.ง.ด.3/53 โดยหลักเป็นหน้าที่ผู้จ่าย ส่วน ภ.ง.ด.50/51 เป็น period-level profit workpaper ไม่ใช่ per-deposit form
- Auto Revenue implementation ถูกเรียง P15–P22; P1–P8 ทำได้เพียง freeze scope/spec/golden data หรือ read-only prototype หากตัด scope เดิม
- Auto-register ใช้ LINE OA มั่งมี Production บัญชีเดิมเป็น Add Friend + AI chat + notification; ไม่สร้าง OA เพิ่มเพื่อนแยก
- OA Add QR/LINE ID เป็น public/common; personal account-link token เป็น short-lived bearer credential และห้ามใส่ใน marketing/email
- เส้นทางหลักคือ single-use email claim ยืนยัน email/ตั้ง Mangmee password แล้ว provision ผ่าน onboarding service เดิม; ไม่มี temporary password ใน email
- เว็บ, claim page และ LIFF fallback ใช้ `UserCredential` ชุดเดียว; เปลี่ยนรหัสจากช่องหนึ่งมีผลอีกช่องทันทีและไม่ใช่การเปลี่ยนรหัส LINE
- หลัง claim ใช้ short-lived signed handoff เชื่อม LINE โดยไม่กรอกรหัสซ้ำ; ผู้ที่มาจาก QR กลาง/อินฟลูฯ ใช้ username/password login ใน LIFF เป็น fallback
- Web desktop มี QR Login transaction อายุสั้น/ครั้งเดียวแยกจาก OA Add QR; linked identity สำเร็จแล้วออก first-party session และกลับ returnTo/เลือกบริษัทอัตโนมัติ
- QR หมดอายุ/ยกเลิก/provider error ให้สลับกลับ Web Password Login อัตโนมัติโดยคง returnTo แต่ห้าม prefill/submit password; unlinked ใช้ login+link หรือ Auto-register+claim continuation
- ผู้ใช้ LINE เดิมไม่ต้อง migrate password/session/chat หรือ re-link ทั้งหมด: same LINE Provider + ACTIVE unique `ExternalIdentity` ให้ auto-reuse; migrate เฉพาะ channel/context metadata ที่พิสูจน์ได้ ส่วนต่าง Provider/conflict ต้อง secure re-link
- แผนแก้ AUTH-04 ใช้ canonical `LINE_MESSAGING_CHANNEL_ID`, production ห้ามสร้าง identity channel=`unknown`, ทำ dry-run/backfill แบบ idempotent, strict resolver ทุก auth/delivery path, shadow reconciliation ก่อน session และตัด broad fallback หลัง gate
- Signup state canonical คือ RECEIVED→VALIDATED→EMAIL_PENDING→EMAIL_VERIFIED→PROVISIONING→READY→LINE_LINK_PENDING→COMPLETED; retry ไม่สร้าง Company/User/Membership/email/link ซ้ำ
- หลัง link ต้อง revalidate membership/role/branch/entitlement, เลือกบริษัทเมื่อหลายบริษัท, redirect กลับ OA และแสดง user/company/role/first-value menu

Open questions:

- Owner ยอมรับ Controlled Beta หรือยังต้องการเปิด Marketing วงกว้าง?
- ทางเข้าของสมองมั่งมีในรอบนี้จะใช้ LINE หรือ web chat ใหม่?
- ใครเป็น named tax/accounting reviewer?
- ใครรับ lead จาก CTA ขอทดลองใช้?
- currency rounding policy และ owner ของกฎคือใคร?
- จะรักษาสมองมั่งมีเป็น commitment หลัก หรือสลับเวลาให้ LINE Login/auto-register?
- เว็บไซต์ทางการจะ authenticate ด้วย HMAC หรือ service JWT และใครถือ/rotate secret?
- ยืนยันให้พนักงานทุก role ที่มี active membership สลับบริษัทผ่าน LINE ได้หรือไม่?
- SLA 15 นาทีหมายถึง contain หรือ permanent fix?
- Auto Revenue รุ่นแรกใช้ Bank Statement import + Invoice matching หรือ direct bank connection?
- source แรกที่มี volume สูงสุดคือธนาคาร/Gateway/Marketplace/POS ใด?
- ช่วง Beta Accountant ต้อง Review ทุก posting หรืออนุญาต exact match บางประเภท?
- ใครอนุมัติ classification/account/tax matrix?
- 95% หมายถึง auto-suggest, auto-match หรือ auto-post และ false-positive tolerance เท่าไร?
- email claim TTL เท่าไร และใคร resend/revoke ได้?
- Production OA Messaging Channel, LINE Login Channel และ LIFF อยู่ LINE Provider เดียวกันหรือไม่ และใครถือสิทธิ์ Admin?
- Package/ราคา subscription: ฟรีกี่ใบ/เดือน, จ่ายเท่าไรได้กี่ใบ, ลูกค้าเดิม grandfathered หรือไม่?
- Payment provider สำหรับค่า subscription และเจ้าของบัญชีรับเงิน/เอกสารภาษีฝั่ง Mangmee?
- เกณฑ์ความแม่นหมวดรายจ่ายที่ยอมรับได้ และใครยืนยันเฉลย golden set?

Artifacts:

- `docs/plans/mangmee-brain-2-5-day-priority-plan-th.md`
- `docs/specs/mangmee-brain-answer-architecture-assessment.md`
- `docs/specs/mangmee-brain-real-answers-spec.md` + `docs/plans/mangmee-brain-real-answers-plan.md` (2026-08-25 — S1 หมวดรายจ่าย, S2 security suite + canary, S3 สาม families; gap register G1–G10 รวม accounting.get_summary 200-doc cap และ tool ใหม่ accounting.get_cash_movement_summary)
- Existing advisor spec/plan/memory, web source, E2E results และ operational memories ที่ลิงก์ในหัวข้อแหล่งอ้างอิงของแผน

Verification:

- ตรวจเอกสาร advisor, AI Gateway, tax/accounting readiness และ release blockers
- ตรวจ source ของ workspace navigation, AI Suggestions, dashboard, login, receipt flow และ styles
- ตรวจ E2E/responsive evidence ที่มีใน repository
- Agent audit แบบ read-only รายงาน Web 1,048/1,048, AI Gateway 645/645, API exit 0 และ typecheck ผ่าน แต่ผลไม่ใช่ exact release candidate จึงยังไม่ใช่ activation evidence
- In-app browser ไม่มีแท็บ/local application ของ repository ที่พร้อมให้ตรวจ จึงจัดข้อค้นพบ UI เป็น static/code/E2E evidence และกำหนด real-device/browser run ไว้ใน P7
- ตรวจ System Onboarding/Partner Console contracts และ source: create/attach owner, members, lifecycle, feature/AI/VAT controls, audit และ handoff
- ตรวจ LINE auth source/plan: verifier/exchange use case มี แต่ public endpoint 403 และ `SHOW_LINE_LOGIN=false`
- ตรวจ multi-company source/spec: web company switch ใช้ active memberships; LINE resolution/company command จำกัด multi-company non-owner
- ตรวจ email ADR/config/module: `EMAIL_PROVIDER=ses` มี config แต่ runtime adapter ยังไม่ implement และ onboarding DTO ไม่มี email
- ตรวจ deployment/recovery/support runbooks แบบ read-only; ไม่แตะ AWS/UAT/Production และไม่ dispatch deploy
- ตรวจ request logger/audit/AI observability และแยกช่องว่าง product funnel analytics
- ตรวจ upload guard, AI rate limit, monthly spend budget และ proposed per-company override spec/plan
- ตรวจ sales-documents route/navigation, entitlement/launch matrix และ accounting/tax readiness
- ตรวจ Bank Reconciliation spec/plan/source: CSV/PDF/manual import, deterministic candidates, reconciliation sessions/evidence และ AccountingPayment `RECEIVED` มีอยู่; direct bank/OAuth และ marketplace settlement ถูก defer
- ตรวจ Accounting Documents/Payment: Invoice/receipt/payment allocation, overpayment/unapplied credit, AR/ledger/output VAT foundation มีอยู่; Auto Revenue ต้องไม่สร้าง competing payment ledger
- ตรวจแหล่งทางการกรมสรรพากรเรื่อง VAT tax point/ภ.พ.30, WHT/50 ทวิ/ภ.ง.ด.3/53 และ ภ.ง.ด.50/51 รวมถึง TFRS 15 ของสภาวิชาชีพบัญชี เพื่อนิยามขอบเขตในแผน; ยังต้อง named expert review ก่อน Production
- ตรวจ auth/password source: web `/change-password` ใช้ `ChangePasswordUseCase` กลาง, update UserCredential, clear must-change/temp copy และ revoke session อื่น; LIFF target ต้อง reuse use case นี้
- ตรวจ LINE link source/spec: OA Add URL กลางแยกจาก owner/employee personal QR; personal token bind user/membership, hash-only, single-use, owner 72h/employee 15m และ link สำเร็จ redirect กลับ OA
- ตรวจ official LINE docs: OA เดียวรองรับ QR/LINE ID/Add Friend link; LINE Login channel เชื่อม OA ได้เมื่ออยู่ Provider เดียวกัน; verified/premium ID เป็นงาน LINE OA ไม่ใช่ application credential
- ตรวจ LINE Login v2.1 และ security checklist: web ใช้ authorization-code callback, state ต้องสุ่ม/ตรวจทุกครั้ง, nonce ป้องกัน replay และ error/cancel ต้องกลับ callback; custom desktop QR จึงต้องเป็น browser-bound transaction ไม่ใช่ OA Add QR
- ตรวจ schema/source: `ExternalIdentity` มี `providerChannelId` และ unique provider+channel+user แต่ LINE exchange ค้น provider+user ขณะที่ notification มี channel-agnostic fallback; ต้อง inventory/normalize duplicates ก่อนเปิดผู้ใช้เดิม
- ตรวจ LINE official user-ID rule: Messaging API และ LINE Login คืน user ID เดียวกันเมื่อ Channel อยู่ Provider เดียวกัน; ต่าง Provider จะได้คนละ ID และห้ามเดาจับคู่
- ระบุ affected source สำหรับ remediation: exchange/link/request-context/employee-link grace, notification/password-reset delivery และ onboarding attach-owner ต้องเปลี่ยนมาใช้ canonical resolver เดียวกัน
- ตรวจ `ExpenseReviewPage.doAction`: หลังส่งตรวจปัจจุบัน reload detail + toast โดยไม่ navigate ออกจากหน้า
- ตรวจ expense VAT UI/domain: มี per-line rate/line source และ mixed VAT unit coverage แล้ว แต่ confirmation ปฏิเสธ reconciliation `MISMATCH/NEEDS_REVIEW/SOURCE_ONLY`; แผนเพิ่ม guided resolution และ end-to-end evidence
- ตรวจ `git diff --check` ของเอกสารแล้วไม่พบ whitespace error และตรวจว่า local links ในแผนมีไฟล์ปลายทางครบ

Next:

1. Product owner ตอบคำถามที่ยังเปิดในหัวข้อ 11 ของแผน โดยเฉพาะการเลือกระหว่างสมองมั่งมี, LINE Login และ auto-register ใน timebox เดียว รวมถึง claim TTL/resend/revoke
2. Freeze exact release candidate และ flags ตาม P1
3. ทำ P2–P8 ตามลำดับ v4 (P3 = alarm/kill switch ก่อน GO, P6 = 6A แยกหมวดรายจ่าย + 6B Brain-Real B0, P7 รวม load smoke + golden set หมวด) โดยหยุดเปิด feature เสี่ยงเมื่อ gate ไม่ผ่าน; เมื่อชนเวลา เลื่อน 6B ไปหลัง P8 (ห้ามหายจาก roadmap)
3b. รอบถัดไปเดิน Brain-Real B1–B7 ตาม assessment คู่ขนานกับ P10–P12
4. รอบถัดไปเดินตาม Gate เปิดวงกว้าง: (P9 ส่วนที่เหลือ + P25 ฉบับย่อ) คู่กับ (P10 → P11 → P12) ให้ผ่านทั้งสองก้อนก่อน Marketing วงกว้าง แล้วจึง P14 → P26 (ระบบจ่ายเงิน/subscription — spec/pricing ก่อนลงมือ) → P13 → P15–P17 (รายรับ ถอยตามคำสั่ง Owner) → P18–P24
5. อัปเดต memory นี้ด้วย SHA, verification artifacts และ GO/LIMITED GO/NO-GO หลังลงมือจริง
