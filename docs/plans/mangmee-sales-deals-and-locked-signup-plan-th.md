# สมัครแล้วล็อก + Sales console + ดีลพิเศษ + หน้าแพ็กเกจ — Implementation Plan (ฉบับรวม)

## Linked Spec

- Spec: [mangmee-sales-deals-and-locked-signup-spec-th.md](../specs/mangmee-sales-deals-and-locked-signup-spec-th.md) (ทะเบียน S01–S25 ใน §13)
- แทนที่: free-usage-close-toggle-plan (ยกงาน S2–S5 มาใช้โดยตัดสวิตช์), special-invoice plan (ยก Phase 1 สลิปมาเป็นทางสำรอง), billing-special-price plan (พัก)
- สถานะ: DRAFT 2026-09-20 — รอ D1–D5

## Purpose

ปิด trial, ล็อกร้านใหม่จนจ่าย, ให้ทีมขายทำดีลราคาอิสระผ่าน console ของตัวเองพร้อมอนุมัติ และให้ลูกค้าจ่ายเองผ่านโหมดชำระครั้งเดียวของ PR #667 (บัตร/PromptPay) โดยเปิดสิทธิ์อัตโนมัติหลังจ่าย ภายในกรอบ 3 วัน (โอน+สลิปเป็นทางสำรอง Phase 4)

## Current Repository Context

- ล็อก/term/sweep/LINE: ตาม free-usage plan §2 (ของเดิมมีครบ ยกเว้น gap S02–S05)
- Billing (develop bb87c556, PR #667): `BillingPurchaseMode` + gate ต่อโหมด, quote `purchaseMode`, Checkout `mode: 'payment'`, `paidPackageCheckoutEvidence({ paymentMethod })`, reconciler apply ครั้งเดียว + `bindPromptPayRenewal`, `BillingAccount.renewalMode/billingAnchorDay/contractAttemptId`, OWNER ยกเลิก Checkout; async events, `quoteTotals`
- ผู้ใช้/รหัสผ่านชั่วคราว: employee-access (`create-employee`, `regenerate-employee-credential`); platform tenant `seed-watchdog-system-company`; registry roles/permissions (`permission-registry.ts`)
- web: `/system` layout + `SystemHeader`; workspace nav/locked shell; `BillingPage.tsx`; `SignupQueuePage` (คำขอเปลี่ยนแพ็กเกจ)
- ห้ามแตะเพิ่มจาก origin/develop (พิสูจน์ด้วย diff ว่างเทียบ develop): `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-collection.ts`, `billing-schedule.ts`, `billing-upgrade.ts`, `billing-refund-source.ts`

## Implementation Rules

- ponytail full; worktree แยกจาก `main` checkout; implementer = subagent ต่อ phase, controller review; push/PR/merge/cloud ใน main thread
- ทุก provider write มี idempotency + journal/observed; ทุกการอนุมัติมีเหตุผล + audit; PII เซลล์เข้ารหัส
- ไม่เพิ่มฟิลด์ใน `BillingCatalog`/BFF public; ไม่มีราคาบน LINE

## Scope

### In Scope
- P1 ปิด trial + locked shell + LINE · P2 Sales console (roles/users/deals/approve/reports) · P3 ชำระดีลผ่านโหมดครั้งเดียวของ PR #667 (บัตร/PromptPay) + หน้าแพ็กเกจ · P4 ต่ออายุดีล/รายงาน/คู่มือ + สลิปสำรอง (Q9) + แปลง subscription บัตรอัตโนมัติ (Q7) · P5 ดีลต่ออายุอัตโนมัติ (บัตร/QR ทุกงวด)

### Out of Scope
- สวิตช์ trial, coupon บน subscription, proration ในระบบ (Q7 ค่าเริ่มต้น), คอมมิชชันในระบบ, EasySlip

## Phase 0: Discovery and Alignment (เสร็จ 2026-09-20)

- สำรวจโค้ด 3 รอบ (guards/term/LINE, billing chain, admin/web/permissions) → spec ฉบับรวม; Owner มติ: ไม่มีฟรี, จ่ายใน 3 วัน, ไม่มีสิทธิ์ก่อนจ่าย, หัวหน้าเห็นทุกทีม, ดีลกำหนดได้ทุกอย่าง, คอมมิชชันนอกระบบ, ร้านทดลองเดิมใช้จนครบ
- Exit: Owner ตอบ D1–D5

## Phase 1: ปิด trial + ล็อกร้านใหม่ (เว็บ + LINE) — PR แยก 2 ใบ (API / web+LINE)

### Tasks
1. provisioning: `TRIAL_DAYS = 0` → term 0 วัน + lifecycle `DISABLED` reason `no_package` + `termDisabledAt` ทันที (ไม่แจ้งเตือน "ครบกำหนด"), ข้าม warmup/งบ AI; push ต้อนรับใหม่ "เลือกแพ็กเกจเพื่อเริ่มใช้งาน"; `update: {}` เดิมคงไว้ (S23)
2. copy 6 จุด (S01) + `BillingCatalog.trial = null` + คิวสมัคร: ซ่อน "อนุญาตทดลองใช้ฟรีเพิ่มอีกครั้ง"
3. notice/billing status เพิ่ม `lockReason`; guard allowlist เพิ่ม identity/vat/business-type; locked shell 2 เมนู + hub ตั้งค่าเฉพาะการ์ดโปรไฟล์ + `/renew` copy ใหม่ + ซ่อน bell/checklist; error label `company_term_expired` เป็นกลาง
4. LINE: กรอง `termEndsAt` ใน `resolveCompanyForLineUser`; การ์ด "สมัครแพ็กเกจก่อน" (OWNER, ลิงก์หน้าแพ็กเกจผ่าน handoff seam) ; reply พนักงาน; LIFF start copy; event status `package_required`

### Tests
- provision spec + AUTO_FREE integration (0 วัน + DISABLED + push ใหม่; ร้านมี term อยู่ไม่ถูกแตะ); guard spec; web logic specs; webhook spec (owner/staff/รูป/ACTIVE+หมดอายุ/legacy no-term); whole-chain acceptance script; E2E locked shell 390/1280

### Exit Criteria
- ร้านใหม่บน local: LINE ตอบการ์ดเดียว, เว็บ 2 เมนู, แก้ที่อยู่ได้, ร้านทดลองเดิมปกติ

## Phase 2: Sales console — roles, ผู้ใช้, ดีล, อนุมัติ (PR แยก: API / web)

### Tasks
1. registry: roles `MANGMEE_SALES_LEAD`, `MANGMEE_SALES` + permission keys (spec §9); SYSTEM_ADMIN ได้ทุก key; `BillingOperatorScope` ไม่เกี่ยว
2. migration: `SalesAgentProfile` (PII เข้ารหัส), `PackageChangeRequest` เพิ่ม `kind/salesUserId/approvedByUserId/approvedAt/offerExpiresAt/rejectedReason/version`
3. module `sales-console` (api): `SalesAgentsService` (สร้าง user ผ่าน create-employee wrapper บน platform tenant + role + profile; รหัสผ่านชั่วคราว; suspend), `SalesDealsService` (CRUD DRAFT, submit, approve → `offerExpiresAt`+push OWNER ไม่มีตัวเลข, reject, cancel; unique OPEN handling S18; block ร้านที่มี subscription S14), `SalesCompanySearch` (ฟิลด์จำกัด), scan รายวันปิด EXPIRED (reuse scan-worker) ; controllers `/v1/sales/*`, `/v1/system/sales-agents*`; audit ครบ
4. web: `apps/web/app/sales/*` layout + gate `canOpenSales` + landing ตาม role; หน้า ดีล/ร้านค้า/ทีม; admin console เมนู "ทีมขาย" (PII เฉพาะ SYSTEM_ADMIN, export CSV)
5. ลูกค้า: `GET package-change-requests` DTO เพิ่ม `deal`
6. (2026-09-21, ระหว่างทำ) roles ใหม่ถือเฉพาะ `sales.*` + `account.session.read/password.change/identity.link`; เหตุผลบังคับเฉพาะ reject/cancel; `SalesCompanySearchItem` ส่ง `branchCount/employeeCount/catalogMonthlyPriceSatang` ให้ฟอร์มเตือนได้ก่อนบันทึก; SYSTEM_ADMIN แก้ผู้แนะนำได้ในหน้าพาร์ตเนอร์ (`PATCH /v1/system/partners/:companyId/referral`, 30 วัน, `salesCode: null` = ล้าง); ตัวกันโกง D6 ทั้งชุดเลื่อนไป Phase 4 (สมัครเก็บข้อมูลครบแล้ว); คำในระบบ "เครดิต AI"; ฟอร์มสมัครบนเว็บได้ช่อง "รู้จักเราทางไหน" + รหัสเซล (LINE/LIFF และฟอร์ม HTML ของ API ได้ option `SALES` เช่นกัน)

### Tests
- PG: role/permission matrix (เซลล์เห็นเฉพาะตน, หัวหน้าเห็นทุกทีม, self-approve ปฏิเสธ, `/system` 403), state machine + replay + unique OPEN, expiry scan, PII ไม่อยู่ใน audit/DTO ของ lead; web logic; E2E sales console 390 (สร้างเซลล์ → login เปลี่ยนรหัส → สร้างดีล → หัวหน้าอนุมัติ)

### Exit Criteria
- ดีล APPROVED ปรากฏใน DTO ของร้านนั้นเท่านั้น; ทุกบทบาทถูกกั้นตาม spec

## Phase 3: ชำระดีลผ่านโหมดครั้งเดียวของ PR #667 (บัตร / PromptPay) + หน้าแพ็กเกจ

ปรับ 2026-09-21 ตาม spec §19: ไม่มี `DealSource`/Checkout แยก; ดีลวิ่งบนเส้นทาง `CARD_ONCE` / `PROMPTPAY_ONCE` ที่ develop มีแล้ว

### Tasks
1. contracts: `BillingOffer.intervalCount: number` (catalog ยังส่ง 1; snapshot/marketing smoke byte-identical), `BillingQuote.deal?: { requestId; months; description }`, `BillingStatus.deal?` (สรุปดีล APPROVED: ราคา/เดือน/สิทธิ์/หมดอายุ/`purchaseModes` ที่ใช้ได้), DTO `package-change-requests` `deal` (จาก Phase 2) ใช้ค่าเดียวกัน
2. billing domain: `appendPackageInterval(start, interval, anchorDay, count = 1)`; `dealOffer(snapshot)` → `BillingOffer` ของดีล (S35); `assertDealSnapshot` (S36); `dealPurchaseModes(gates, priceSatang, account)` (S38/S39, เพดาน PromptPay เป็นค่าคงที่ + test)
3. `billing.service` `quote({ dealId, purchaseMode })`: โหลดดีล APPROVED ของร้าน (lock), D4 (อีเมลยืนยัน + ที่อยู่), gate ตามโหมด (`BILLING_MODE_NOT_READY`), ข้าม `assertStripePrice`/`restartFits` เมื่อมี `deal` (S36/S45), เตือนร้านทดลอง (Q5), snapshot `{ deal, quote.offer = dealOffer, purchaseMode }`; `checkout` เดิม (`unit_amount` จาก snapshot เท่านั้น); ดีลหมดอายุ = quote/checkout ใหม่ปฏิเสธ (S46)
4. reconciler apply ครั้งเดียว (เดิม) + follow-up ดีล **ในธุรกรรมเดียว**: `companyPlanTerm` (tier ฐาน, ลิมิตดีล, term N เดือน), feature entitlements ตาม snapshot, งบ AI, `PackageChangeRequest → APPLIED` (`paymentState STRIPE_ONE_TIME`, `paymentRef` = invoice id), แถว `SalesAttribution` ครั้งแรก, re-enable บริษัท (เดิม), audit CRITICAL `sales.deal.applied`, trigger `billing.package_updated` ข้อความดีล (S41); replay idempotent ด้วย `evidenceHash` เดิม; session ที่สร้างก่อนหมดอายุแล้วจ่ายทีหลังยัง apply; scan EXPIRED ข้ามดีลที่มี attempt เปิด (S46)
5. ร้านที่มีสิทธิ์อยู่ (spec §19.3 แถว 1–3): ล็อก/หมดอายุ/ทดลอง = เริ่มทันที; ครั้งเดียวยังไม่หมด = `snapshot.oneTime` ต่อท้าย + สิทธิ์ทันที (S40); `PROMPTPAY_RENEW` = ยกเลิก subscription QR (system-initiated, journal/observed) + void บิลค้าง + ต่อท้าย — แถว `CARD_AUTO` (Q7) อยู่ Phase 4
6. web `BillingPage.tsx`: การ์ดข้อเสนอเป็นการ์ดแรก (ชื่อ tier ฐาน + "ข้อเสนอพิเศษสำหรับร้านคุณ", ราคา/รวม N เดือน, สาขา·ผู้ใช้·ใบต่อเดือน, เมนู, ใช้ได้ถึง, ตัวเลือกโหมด reuse ของ #667 จำกัดตาม `deal.purchaseModes`, ปุ่ม "เลือกข้อเสนอนี้"; ปิดทั้งสอง gate → "ติดต่อทีมงาน"), ขั้น D4 ผ่าน `billingProfileHref(..., { deal })` กลับมาการ์ดเดิม, copy S04, error labels สอง map, `billing-preview.fixture.ts` เพิ่ม fixture ดีลแยก (S44); theme Mangmee เดิม, 390px
7. admin: `BillingCompanyOverview` source `DEAL` คู่ `renewalMode` (S43); label ใน `billing-admin.service.ts`
8. rollout (Owner): เปิด PromptPay บนบัญชี Stripe live; เปิด gate `card_once`/`promptpay_once` หลัง UAT ของ #667 ผ่าน (S37); เปลี่ยน copy "บัตรออนไลน์" → "บัตรหรือ PromptPay" (S42); บันทึกใน runbook billing
9. ห้ามแตะเพิ่มจาก origin/develop: `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-collection.ts`, `billing-schedule.ts`, `billing-upgrade.ts`, `billing-refund-source.ts` (พิสูจน์ด้วย diff ว่างเทียบ develop)

### Tests
- unit: `dealOffer`, `appendPackageInterval(count)` (กุมภาพันธ์/เดือนสั้น/12 เดือน = 1 ปี), `assertDealSnapshot`, `dealPurchaseModes` (เพดาน, gate ปิด, ตระกูลโหมด)
- PG/HTTP smoke ใหม่ `billing-deal-smoke.ts` ต่อจาก journeys ครั้งเดียวของ #667 ใน `billing-http-smoke.ts` (simulated Stripe): card sync, promptpay async สำเร็จ/ล้มเหลว, OWNER ยกเลิก QR ค้างแล้วเลือกดีล, replay evidence, ดีลหมดอายุ (quote ปฏิเสธ / session เก่าจ่ายทีหลังยัง apply / scan ข้าม attempt เปิด), ต่อท้ายรอบครั้งเดียว, แปลง `PROMPTPAY_RENEW`, gate ปิด, ร้านทดลอง (Q5), ลิมิตต่ำกว่าที่ใช้ (S45), refund ก่อนหน้า (S40), apply ครบทุกสิทธิ์ + LINE/เว็บใช้ได้
- regression: journeys ครั้งเดียว/ catalog ของ #667 ไม่เปลี่ยน (byte-identical), `billing-marketing-smoke`, `billing-offer-terms-smoke`, e2e `billing-preview.spec.ts` เดิม + spec ใหม่การ์ดดีล 390; whole-chain acceptance
- UAT (Stripe test mode): ร้านล็อก → ดีล → บัตร และ PromptPay จริง → APPLIED; วัดเวลา approve→APPLIED ใน evidence

### Exit Criteria
- ร้านล็อก → ดีล → จ่าย (บัตร/QR) → ใช้งานได้ภายในนาที; เส้นทางซื้อ catalog ของ #667 ไม่เปลี่ยน (diff ว่างในไฟล์หลักฐาน + smoke เดิมผ่าน)

## Phase 4: ต่ออายุดีล, รายงานหัวหน้า, คู่มือ

- scan 14 วันก่อนหมด: สร้างดีลรอบถัดไป APPROVED (D3) + push; รายงาน `/v1/sales/reports/summary` + หน้า; runbook เซลล์/Owner; ตัวชี้วัด time-to-active; สลิปสำรอง (Q9): ยก endpoint/verify จาก special-invoice plan (apply เดียวกับดีล); แปลง subscription บัตรอัตโนมัติเป็นดีล (Q7 ค่าเริ่มต้น: ยกเลิกทันทีเมื่อจ่าย ไม่มี proration; ฟอร์มดีลโชว์มูลค่าคงเหลือ; issue `DEAL_SUBSCRIPTION_CANCEL_PENDING` + retry; S34)

## Integration Verification

- Contract/UI: DTO ใหม่ทุกฟิลด์ถูกใช้; catalog byte-identical; Thai ครบสอง map; 390px
- สิทธิ์: matrix 5 บทบาท × endpoint (ตาราง test)
- การเงิน: quote = Stripe invoice ทุกช่องทาง; ไม่มี diff ใน evidence subscription files; PromptPay async path พิสูจน์
- Evidence: `docs/evidence/sales-deals-<date>/` + memory ทุก phase

## Risks

- gate `card_once`/`promptpay_once` ปิดจน UAT ของ PR #667 ผ่าน (S37) + PromptPay live + เพดานยอด (S38) → dev/UAT test mode; production รอ Owner เปิด gate; fallback โอน (Phase 4, Q9)
- ดีลราคาอิสระไม่มีบันได → ความเสี่ยงราคาผิดพลาด → เตือนสูงกว่า catalog + audit + รายงานหัวหน้า
- PII เซลล์ (S10) → เข้ารหัส + สิทธิ์เฉพาะ + export log
- ร้านที่มี subscription แล้ว (S14) → block ชัด + ข้อความบอกทางแก้
- ปริมาณ PR ใหญ่ → แบ่ง phase/PR ตามข้างบน ทำ P1 ก่อนเสมอ (ปิด trial คือมติหลัก)

## Open Questions

- D1–D5 ใน spec §16; ลำดับ: P1 → P2 → P3 → P4 (P2 กับ P3 API ทำคู่ขนานได้ถ้าคนละคน แต่ merge P2 ก่อน)

## มติรอบ 2 (2026-09-20) — งานที่เพิ่ม/เปลี่ยน

- Phase 2: อนุมัติเองได้สำหรับ lead/SYSTEM_ADMIN (D2) → ลด branch self-approval; audit `selfApproved`
- ~~Phase 3~~ → Phase 4, ทบทวนโดย Q7 (spec §19.3/19.5; ค่าเริ่มต้น = ไม่มี proration): **แปลง subscription เป็นดีลโดยจ่ายส่วนต่าง** (D5): `DealSource` รองรับร้านที่มี `baseSubscriptionId` — คำนวณส่วนต่างด้วย `proratedPackagePrice` จาก contract snapshot เดิม, quote แสดง 3 ตัวเลข, Checkout ครั้งเดียว, apply ดีล, สั่ง `CANCEL_RENEWAL` ระบบ (reuse collection op, ไม่ต้องลูกค้ากด), ปิด resume ใน status/Portal ขณะดีล ACTIVE; tests: ส่วนต่าง 0/บวก, subscription ค้างชำระ/grace ถูกปฏิเสธ, cancel observed, ไม่มี invoice ซ้ำจาก Stripe หลังแปลง
- Phase 4 (เปลี่ยน): ต่ออายุดีล = สร้าง PENDING_APPROVAL อัตโนมัติ 14 วันก่อนหมด + แจ้งเตือนเซลล์/หัวหน้า (เว็บ+LINE+สรุปรายวัน) + เตือนซ้ำ 7 วัน + แจ้ง Owner (D3); รายงาน: นับเฉพาะยอดผ่านดีล ผูก `salesUserId`, เซลล์เห็นของตัวเองรายเดือน, หัวหน้าเห็นทุกทีม, ไม่มีเอกสารการเงิน; โอนดีลข้ามเซลล์ (Owner, audit)
- Phase 5 (optional, D6): ลิงก์แนะนำของเซลล์ตอนสมัคร + นับยอดร้านที่แนะนำ N เดือน

## D6 ตัดสินแล้ว — ย้ายจาก Phase 5 optional เข้า Phase หลัก

- Phase 1 (เพิ่ม): option `SALES` + ช่องรหัสเซลล์ + `?ref=` ในฟอร์มสมัคร LIFF/เว็บ; `CompanySignupRequest.referralSalesCode/referralSalesUserId`; provisioning คัดลอกไป `Company.referralSalesUserId/referredAt/referralSource`; คิวสมัครแสดง "รู้จักเราจากเซลล์"; `signup-pages.qa.spec.ts` ปรับ
- Phase 2 (เพิ่ม): รหัสเซลล์ออกตอนสร้างบัญชี (unique, แสดงในหน้าโปรไฟล์เซลล์ + ลิงก์แนะนำ), ระงับเซลล์ = รหัสหยุดรับ; Owner แก้ referral ของร้านพร้อมเหตุผล (audit)
- Phase 4 (เปลี่ยน): รายงานคำนวณตามสูตร §17.1 (ดีลชนะ, หน้าต่าง 14 วัน, refund หัก) แยกคอลัมน์ ดีล/แนะนำ; ตัวกันโกง: self-referral (identity ตรงกับเซลล์/ทีม), เจ้าของเดียวกันหลายร้าน, anomaly 20 ร้าน/วัน + IP/LINE/เบอร์ซ้ำ → ธง + สรุปรายวัน; tests: หน้าต่าง 14 วันขอบเขตพอดี, ดีลชนะแนะนำ, refund หัก, self-referral ไม่นับ, รหัสไม่ ACTIVE ไม่นับ
- Phase 5 optional ถูกลบ
- มติรอบ 3: หน้าต่างแนะนำ 14 วัน, เกณฑ์ผิดปกติ 20 ร้าน/วัน, รหัสเซลล์ง่าย (ตั้งเองได้ 3–6 ตัว, ค่าเริ่มต้นสุ่ม 4 ตัวไม่มีตัวสับสน); สรุปรายวันถึง Owner = trigger `sales_daily_digest` บน cron 07:00 เดิม → คอนโซล + LINE (ถ้าผูก) (+ อีเมล optional) — รอ Owner เลือกช่องทาง
- มติรอบ 4: attribution = แถวเดียวต่อร้านตอน APPLIED ครั้งแรก (ตาราง `SalesAttribution`), renewal ไม่นับ; รายงาน Phase 4 อ่านจากตารางนี้เท่านั้น (ง่ายกว่าเดิม); digest = คอนโซลเท่านั้น (trigger `sales_daily_digest` ลงทะเบียนใน `NOTIFICATION_TRIGGER_KEYS`)

## Phase 1 kickoff (2026-09-20)

- Worktree `/private/tmp/mangmee-sales-deals-p1-20260920`, branch `codex/sales-deals-phase1-20260920` จาก origin/develop 5b4a0666; implementer = Opus ×2 (server: api+contracts+LINE / web), controller = Fable 5.1 (review bug/gap/impact + theme)
- พบว่า develop มีของแล้ว: guard allowlist `isCompanyProfileRecoveryRoute` (identity/vat/business-type) และ `WorkspaceLayout` ปล่อย `/settings/profile` ผ่าน recovery layout → S03 เหลือแค่ nav 2 เมนู, hub ตั้งค่า, copy `/renew`, label, ซ่อน bell/checklist
- ช่องรหัสเซลล์ตอนสมัคร (D6) ย้ายไป Phase 2 พร้อมบัญชีเซลล์ (ต้องมี user ให้ resolve ก่อน) — ลดขนาด PR Phase 1
- ไม่ commit จนกว่า controller review ผ่าน; docs ฉบับรวม 3 ไฟล์ถูก copy เข้า worktree แล้ว

## D7 (มติรอบ 5): ดีลตัดบัตรอัตโนมัติ — Phase 5 (หลัง Phase 3)

- ยกงานจาก [billing-special-price-plan-th.md](billing-special-price-plan-th.md) Phase 1–3 มาเป็น Phase 5 ของแผนนี้: `BillingSpecialPrice` ผูกกับดีล (`dealId`), สร้าง Stripe Price ตอนอนุมัติดีลที่ `autoRenew=true` (journal/observed/drain แบบ refunds), quote path ใช้ offer/priceId ของดีล, `capacity()` ใช้ offer ของดีล, legacy guard ผ่อน, `SCHEDULE_PRICE_RETURN` + issue `SPECIAL_PRICE_ENDING` + drift check, UI: สวิตช์ในฟอร์มดีล + การ์ดลูกค้าแสดง "ตัดบัตรอัตโนมัติทุกเดือน/ปี ยกเลิกได้จากหน้าแพ็กเกจ"
- ข้อจำกัดที่ต้องบอกเซลล์ในฟอร์ม: รอบเดือน/ปีเท่านั้น, ลูกค้าต้องจ่ายด้วยบัตร, การจบดีลต้องสั่งกลับราคาปกติ
- Tests: ตาม spec billing-special-price §15 + regression smokes เดิมด้วย fixture ราคาดีล; UAT Stripe test mode: สมัคร→ดีลอัตโนมัติ→ตัดบัตรรอบถัดไป (จำลอง invoice.paid) → กลับราคาปกติ
- 2026-09-21 (Q8 ค่าเริ่มต้น): รองรับ `PROMPTPAY_RENEW` ด้วย — Price ของดีล + `bindPromptPayRenewal` ของ PR #667; การ์ดใช้ตัวเลือกโหมด `CARD_AUTO`/`PROMPTPAY_RENEW`

## มติ Q1–Q6 (2026-09-20) — งานที่เพิ่ม
- Phase 2: หน้า "งานของฉัน" + badge ใน `/sales` (trigger keys ลงทะเบียน); temp password โชว์ครั้งเดียว + LINE ถ้าผูก; ค้นหาร้านทุกร้าน (ฟิลด์น้อย) + audit LOW; role ใหม่ไม่มี permission ธุรกิจ + landing `/sales`
- Phase 3: quote ดีลบนร้านที่ยังทดลอง → เตือน "วันทดลองที่เหลือไม่ทบ"; ฟอร์มดีลใส่ยอดที่ลูกค้าจ่ายจริง (ป้ายกำกับ "รวม VAT ถ้ามี"), ระบบแยก VAT ตามนโยบายปัจจุบัน (ตอนนี้ NOT_VAT_REGISTERED = 0); preview ดีลแสดงจำนวนสาขา/ผู้ใช้ที่เกินลิมิตใหม่ (S31)
- Phase 5: `SCHEDULE_PRICE_RETURN` ต้องย้อนเมนู/งบ AI/ลิมิตเป็นค่าเริ่มต้นของ tier ในธุรกรรมเดียว (S26) พร้อม audit before/after

### Phase 1 controller review log (2026-09-20)
- Web pass 1 (Opus): 23 files, +437/−242, web tsc clean, 1,850 web tests green; theme scan clean (no hex/inline style/vh/new css); locked shell = `LockedWorkspaceLayout` + `isLockedShellPath` + `buildLockedNavItems` + `LockedShellProvider` + `SettingsMenu` island; `/renew` copy by `lockReason`; BillingPage no-package copy; trial copy removed (signup pages, EmailAccessPage, SignupQueuePage checkbox)
- Findings sent back: (W1) business layout mounted while the notice was loading → 403 burst for locked shops → render neutral line until loaded; (W2) staff without `company.setup.read` hit an empty hub/forbidden profile → locked hub shows "บัญชีของฉัน" card (change-password + account email); (W3) repeat-applicant toast still said "รอจัดแพ็กเกจ" → falls through to normal approve toast once the API fence is gone
- Cross-agent gap: web removed `grantRepeatTrial`/`trialGrantNote` payload while API still enforced `line_signup_repeat_trial_grant_required` → server agent told to drop the fence + `requiresRepeatTrialGrant` hint (repeat applicants provision locked like everyone; AUTO_FREE→MANUAL routing kept) and to fix stale copy in `e2e/line-signup-contact-email.spec.ts` + `apps/api/src/scripts/email-access-smoke.ts`
- Server pass 1 (Opus) in progress: provisioning 0-day term + `no_package_lock` best-effort lifecycle DISABLED, warm-up/AI-budget removed, LINE card/member reply/terminal outcome, LIFF/promo/notify copy, catalog trial optional
- Web pass 2 (controller-verified): W1 `settled` gate renders a neutral line until the notice lands; W2 `LOCKED_ACCOUNT_CARD` + `showsLockedAccountCard` (staff locked → account card only); W3 repeat-applicant toast branch removed; web tsc exit 0; theme scan clean (no hex/inline style/vh); web tests 1,851 pass per implementer
- Server pass 1 (Opus) controller-verified: `SIGNUP_TERM_DAYS = 0` + `lockUntilPackageBought` (Company lock → lifecycle DISABLED reason `no_package` → stamps termDisabledAt/expiredNotifiedAt, transactional, guarded on ACTIVE + no_package so retries/S23 write nothing); `resolveCompanyForLineUser` filters ended terms (legacy null term still resolves; a locked *selected* company returns null → locked reply, never a silent switch); `lockedCompanyFor` + `replyIfCompanyLocked` (owner Flex card via handoff seam when billing open, text fallback otherwise; member reply) on both lanes; `package_required` classified as refusal; catalog `trial` removed, `lockReason` on notice + billing status; LIFF/promo/notify copy; repeat-trial fence removed; e2e/smoke copy realigned; module import external-signup → system-partner-management is one-directional. Suites: api 9,821 pass, whole-chain 4+4+1571+387 pass, contracts 324, PG specs 80 pass. auth.guard untouched (no CI re-pin)
- Controller gate after both passes: contracts build 0, web tsc 0, web tests 1,851 pass
- Follow-ups delegated to Sonnet: (F1) sweep expiry branch skips the "ครบกำหนด" notification and uses reason `no_package` for 0-day terms (fallback if the provisioning lock step ever fails); (F2) LINE public-policy FAQ answers rewritten without the free trial (copy for Owner tweak in PR)
- Final gate (controller, final tree): copy fix "บัตรหรือ PromptPay" → "บัตรออนไลน์" (PromptPay arrives in Phase 3); web tsc 0 + 1,851 pass; api targeted specs 496 pass; contracts 324 pass; api typecheck 0; Sonnet follow-ups F1 (sweep no_package: 15/15) and F2 (public-policy FAQ: 404/404) merged in; whole-chain acceptance rerun before push
- PR opened: https://github.com/MangmeeDev/mangmeeplus/pull/666 (develop ← codex/sales-deals-phase1-20260920, commit 02b7a15b); whole-chain acceptance on the final tree 4+1571+387 pass / 0 fail; CI pending; main sync PR after develop merge per repo protocol

## ปรับตาม PR #667 (2026-09-21) — โหมดชำระครั้งเดียว บัตร/PromptPay และ QR ต่ออายุ

- develop bb87c556 มี `BillingPurchaseMode` (`CARD_AUTO`/`CARD_ONCE`/`PROMPTPAY_ONCE`/`PROMPTPAY_RENEW`), gate ต่อโหมด (ปิดจน UAT ของ #667 ผ่าน), Checkout `mode: 'payment'` + หลักฐาน promptpay + apply ครั้งเดียว + `bindPromptPayRenewal` + OWNER ยกเลิก Checkout — spec §19.1
- Phase 3 เขียนใหม่ทั้งส่วน (ข้างบน): ดีล = snapshot `deal` บนเส้นทางครั้งเดียวของ #667; งานที่หายไป: `DealSource`, Checkout/evidence แยก, `payment_method_types` ของเรา, สลิปใน Phase 3; งานที่เพิ่ม: S35 (`intervalCount`/append N เดือน), S36 (`assertDealSnapshot`), S38/S39 (`dealPurchaseModes`), S45 (ข้าม `restartFits`), S46 (หมดอายุระหว่างจ่าย)
- Phase 4 เพิ่ม: สลิปสำรอง (Q9 ค่าเริ่มต้น = เลื่อนมาที่นี่) ยก endpoint/verify จาก special-invoice plan; แปลง subscription บัตรอัตโนมัติเป็นดีล (Q7 ค่าเริ่มต้น = ยกเลิกทันทีเมื่อจ่าย ไม่มี proration ในระบบ; ฟอร์มดีลโชว์มูลค่าคงเหลือให้เซลล์หักเอง; issue `DEAL_SUBSCRIPTION_CANCEL_PENDING` + retry; เหตุการณ์ subscription เก่าไม่ hold บัญชี — S34)
- Phase 5 เพิ่ม: ดีลต่ออายุอัตโนมัติรองรับ `PROMPTPAY_RENEW` ด้วย (Q8 ค่าเริ่มต้น) ผ่าน Price ของดีล + `bindPromptPayRenewal`; การ์ดใช้ตัวเลือกโหมดของ #667 (`CARD_AUTO`/`PROMPTPAY_RENEW`)
- การนับยอดทีมขาย (§17.2) ไม่เปลี่ยน: ครั้งแรกครั้งเดียวทุกโหมด; `PROMPTPAY_RENEW` นับเฉพาะ QR ครั้งแรก
- 2026-09-21 บ่าย: merge develop 143f7e07 อีกรอบ (#676 ร้านเดิมซื้อ catalog เอง, #677 CI gate ใหม่ ~3 นาที: billing HTTP smoke ย้ายไป extended-tests แบบสั่งรันเอง, #681) — PG spec ของ sales console ผูกใน "Migrations and Boot"; มติ Phase 3 หลัง #676 อยู่ใน spec §19.7 (ใช้ `billingFeaturePlan/applyBillingFeaturePlan` + เติมให้เส้นทางครั้งเดียว, ดีลรับตาม purchase source, supersede สองทาง, ดีล→catalog = ต่อท้าย Q10)
- Phase 1 ไม่ต้องแก้โค้ดเพิ่ม: merge develop เข้า branch แล้ว (sweep เก็บทั้ง `lockReason` และ `nextStep` ของ #667; BillingPage เก็บทั้งตัวเลือกโหมดและหัวข้อตาม `lockReason`); copy "บัตรออนไลน์" คงไว้จน Owner เปิด gate PromptPay บน production (S42)
- รอมติ Owner: Q7 / Q8 / Q9 (spec §19.5) — ถ้าไม่ตอบ ใช้ค่าเริ่มต้น

## Delivery mode (Owner 2026-09-21): ไม่ merge จนกว่าจะเสร็จทั้งหมด

- branch เดียว `codex/sales-deals-phase1-20260920` (worktree `/private/tmp/mangmee-sales-deals-p1-20260920`) / PR #666 ขยายทีละ phase (เปลี่ยนชื่อ PR ตอนจบ); ไม่มี PR ต่อ phase; merge `origin/develop` เข้ามาเป็นระยะแบบ plain merge (ห้าม rebase); CI รันทุก push — ต้องเขียวก่อนเริ่ม phase ถัดไป
- แต่ละ phase: implementer subagent (Opus/Sonnet) + controller review (bug/gap/impact/theme) + evidence ใน memory ก่อนขึ้น phase ถัดไป; commit ต่อ phase ชัดเจน (`feat(sales): phase N …`)
- ตอนจบ: admin-merge #666 เข้า develop แล้วเปิด PR sync ไป main จาก main-based branch (โปรโตคอลเดิม); deploy ตาม runbook เป็นขั้นแยก (production ยังติด Postmark secrets และ gate ของ #667)
- ลำดับต่อไป: Phase 2 (Sales console) → Phase 3 → Phase 4 → Phase 5
