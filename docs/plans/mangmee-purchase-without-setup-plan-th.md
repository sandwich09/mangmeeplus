# Implementation Plan: ซื้อแพ็กเกจได้ทันทีหลังสมัคร (ไม่ต้องตั้งค่าก่อนซื้อ)

## Linked Spec

- [mangmee-purchase-without-setup-spec-th.md](../specs/mangmee-purchase-without-setup-spec-th.md) (DRAFT v0.2 2026-09-27, มติ D-PF-1..10; **§18 = ผลตรวจโค้ดจริงและกติกาที่แก้ — มีผลเหนือรายการงานด้านล่างที่ขัดกัน; ดู "แก้ไขแผน 2026-09-27" ท้ายไฟล์**)
- memory: [purchase-without-setup-2026-09-26.md](../agent-memory/purchase-without-setup-2026-09-26.md)

## Purpose

ทำให้เส้นทาง "การ์ดในแชต → หน้าแพ็กเกจ → Stripe → ใช้งานได้" เหลือ 3 หน้า 4 แตะ ไม่มีช่องกรอกในแอป, ทำให้สถานะ "ยังไม่มีแพ็กเกจ" เข้าได้ทุกทางโดยไม่ต้องให้ Owner ต่ออายุในคอนโซล, และให้ลูกค้า/แอดมินแก้เอกสารได้เองโดยไม่กระทบสิทธิ์

## Current Repository Context

- develop `ddcdcadf` = main สำหรับ billing/LINE/LIFF; production serve `a2b926c6` (2026-09-26)
- ของเดิมที่ต่อยอด: locked shell + allowlist (P29/S03), one-time Checkout (#667), recipient OTP flow (signup-optional-email spec), refund credit notes line-based (#770), end-package (#776), admin invoice page, reviewed-op + single-admin self-confirm, Postmark events service, handoff `/l/<token>`, `withLineExternalBrowser` (web), `liff.openWindow external`
- ข้อจำกัด: ไม่แตะ `paid-invoice.ts` / `paid-checkout-invoice.ts`; ไม่แก้ `package.json` เว้นเพิ่ม/ลบ dependency; ไม่มี flag/env ใหม่; ทำงานใน worktree แยก (shared checkout มีงานอื่นค้าง)
- การทดสอบตามคำสั่ง Owner 2026-09-21: local = typecheck + boot + spec ที่แตะ; CI ครั้งเดียวตอน merge; UAT Stripe test mode ก่อน production (G27)

## Implementation Rules

- Ponytail full: diff สั้นที่สุด, pattern เดิมก่อน, ไม่มี abstraction เผื่อ; helper ใหม่แค่ 2 ตัว (`planTermStateLabel`, `withLineExternalBrowserParam`)
- ทุก error code ใหม่ต้องมี Thai สองที่; ทุก op ใหม่ใช้ journal/observed/retry + audit เดิม
- Controller เขียน brief ต่อ PR แล้วส่ง subagent ทำ; push/PR/cloud อยู่ที่ main thread (มติ 2026-09-19)
- PR แยกตาม phase ต่อ develop (แล้ว twin ไป main); deploy รวมเป็น release เดียว

## Scope

### In Scope
- Phase 1–5 ด้านล่าง; เอกสาร amend ตาม spec §17; e2e ใหม่; smoke ใหม่

### Out of Scope
- CTA เว็บ official (คงเข้า LINE); วิธีใช้ 5 ขั้นบนเว็บ (repo `mangmee_web` — ticket แยก); กติกา VAT-era reissue; G26 (LINE gate บน permission); trial/โอน/สลิป

## Phase 0: Discovery and Alignment (เสร็จ 2026-09-26)

- วิเคราะห์เส้นทางทั้งชุดจากโค้ด + หน้าเว็บจริง + memory; Owner ตัดสิน D-PF-1..8; ผู้ทดลองยืนยันอาการ (เข้าจากการ์ดในแชต กดเลือกแพ็กเกจไม่ได้)

## Phase 1: สถานะยังไม่มีแพ็กเกจ + ลิงก์จาก LINE (ปลดทางตัน) — PR A (API + LIFF + LINE) / PR B (web + console) — *รายการงานด้านล่างถูกแทนที่โดย "แก้ไขแผน 2026-09-27" §P1*

### Tasks
1. contracts: `planTermStateLabel(term|lockReason)` → {key, label} ("ยังไม่มีแพ็กเกจ" / "หมดอายุ" / "ทดลองใช้อยู่" / "ใช้งานได้"); `withLineExternalBrowserParam(url)` (ข้าม `liff.line.me` และ host ที่ไม่ใช่ web base)
2. `line-handoff.logic.ts` `lineHandoffUrl()` ใส่ param; ตรวจทุก builder ที่สร้าง URL เข้าเว็บโดยไม่ผ่าน handoff (การ์ดล็อก `line-business-card.logic.ts:516-541`, promotion `line-staff-menu.logic.ts:301-322`, package-change reply webhook `:2838-2845`, notification cards `notification.use-cases.ts`, sales offer (มีแล้ว), line-web-qr (มีแล้ว), "บริษัทของฉัน") ให้ผ่าน helper; unit test "ทุก uri ในทุก builder มี param" (R-B1)
3. R-B2: อ่านเหตุผลเงื่อนไข `process-line-webhook.use-case.ts:3268-3280`; ทางเลือก ก) wrap เสมอเมื่อ `event.handoff` มี (record ยังเก็บ plain) ข) mint ตรงใน builder ของการ์ดล็อก/ตอบขอเปลี่ยนแพ็กเกจ; บันทึกเหตุผลใน memory; test ทั้ง flag เปิด/ปิด
4. `get-line-signup-status.use-case.ts`: `canEnter` รวมร้านล็อก, DTO `entryKind`/`lockReason`; `liff-page.security.ts`: หน้า COMPLETED+LOCKED (หัวข้อ/ปุ่ม "เลือกแพ็กเกจ" ผ่าน `liff/session` + `openWindow external`), label รายการร้าน; `exchange-liff-session.use-case.ts`: target billing สำหรับร้านล็อก (R-C3); fixture `line-liff-signup.spec.ts` ร้านล็อก
5. `line-signup-notify.service.ts`: push ใหม่ (R-C4) — ปุ่มเป็น handoff external ไปหน้าแพ็กเกจ (ใช้ mint ที่มีอยู่ของ push); ภาพวิธีใช้ในแชต: อัปเดต asset (ขั้น "เลือกแพ็กเกจ") — ถ้าไม่มีไฟล์ต้นฉบับ ให้เปลี่ยนเป็นข้อความชั่วคราวและเปิด ticket
6. LINE copy: G19 ("ให้ทีมงานติดต่อกลับ" → support request จริง), G20 (สรุปเมนูแพ็กเกจธุรกิจ = เว็บ), G25 (FAQ ทดลองใช้ถอด), G02 ข้อความ; `line-public-policy.logic.ts` FAQ ขั้นตอน 4 ขั้นให้ตรงจริง
7. web: `AccountEmailOtpPanel.reauthenticate` ใช้ `withLineExternalBrowser` (R-B4); LoginPage handoff-expired + session → next (R-B5); `BillingCompanyPicker` label (R-C5); e2e: LINE login (fake) → ร้านล็อก → billing
8. console: partner list/detail DTO `lockReason` + `stateLabel`; PartnerDetailPage สถานะ + คำเตือน/เหตุผลบังคับที่ปุ่มต่ออายุสำหรับ `no_package` (R-C6) — เหตุผลผ่าน `checkPlanTermAdjustment` เดิม
9. R-B3 (handoff/LIFF exchange ตั้ง `emailReauthenticatedAt` + binding) — ทำถ้าไม่บานปลาย ไม่งั้นเลื่อนไป Phase 5
10. test R-C10: provisioning → sweep ไม่ส่งครบกำหนด/ไม่แจ้งแอดมิน
11. R-C11 (D-PF-10): helper `planManagersOf(companyId)` + แทนที่การเช็ก OWNER role ทุกจุดใน LINE/sweep/notifications/sales push/หน้าอีเมลบัญชี ตามรายการใน spec; test: custom role ที่มี `company.plan.manage` ได้การ์ดล็อก/ปุ่มซื้อ/แจ้งเตือน, พนักงานไม่มีสิทธิ์ยังได้ข้อความพนักงาน

### Tests
- unit: helper ทั้งสอง, builder param coverage, signup-status DTO, LIFF status copy (jsdom ถ้ามี pattern), webhook การ์ดล็อก one-tap ทั้งสอง flag
- PG: provision no_package → signup-status entryKind LOCKED + liff/session target billing
- web: picker labels; e2e locked landing (fake LINE harness ตาม memory local-line-fake-harness)
- console: partner detail label/warning spec

### Exit Criteria
- ร้านใหม่กด "เลือกแพ็กเกจ" จาก LIFF/การ์ด/push ถึงหน้าแพ็กเกจในเบราว์เซอร์นอก LINE โดยล็อกอินแล้ว; ไม่มี "ติดต่อทีมงาน" เป็นทางหลัก; typecheck api/web + boot + spec ที่แตะผ่าน

## Phase 2: ซื้อโดยไม่ต้องตั้งค่าก่อน — PR C (API + workers) / PR D (web) — *แทนที่โดย §P2*

### Tasks
1. `billing.service.ts` quote (`:280-372`) / checkout (`:511-751`) / resume: ถอด email proof (`:301`, `:530`), profile gate (`:306`), recipient compare (`:335,635,686` → เหลือกรณี op ค้าง); quote คืน `documentProfile`; Stripe Customer sync ก่อน Checkout ตาม R-A2 (อีเมลเฉพาะ verified/ผู้รับปัจจุบัน; ที่อยู่เฉพาะครบ); Checkout params R-A3 (`customer_update.address='auto'`, ทั้ง payment/subscription, รวม `billing-repeat.ts:289-295` และ deal/advance paths)
2. reconciler apply (`billing-reconciler.service.ts:464-675`, subscription apply `:917-1040`): หลังหลักฐานผ่าน → อ่าน Customer → R-A4 (recipient capture + profile fill-if-blank, idempotent, audit); ตรวจว่า `billing-email-recipient` service รองรับ source `STRIPE_CHECKOUT`
3. schema: `BillingAccount.recipientSource/recipientBouncedAt/recipientBounceNotifiedAt`; migration additive
4. R-A7: หลัง apply ส่งอีเมลชำระสำเร็จผ่าน `EmailDeliveryService` (template billing status เดิม, ลิงก์เข้าแอป) ไปผู้รับเอกสาร (เดิมส่งไป owner account email — เปลี่ยนเป็นผู้รับ; ถ้าผู้รับ = account email ส่งครั้งเดียว); `postmark-events.service` → bounce/spam ตรงผู้รับ → ธง + LINE push 1 ครั้ง (ใช้ notification trigger `billing.package_updated` pattern) + แบนเนอร์ผ่าน status DTO
5. status DTO: `recipient {email, source, bouncedAt}`; `allowedActions` ไม่ขึ้นกับอีเมล/โปรไฟล์
6. web `BillingPage.tsx`: ถอด email gate (`:441,505`) + profile modal/detour (`:251,308-315,335`, `billing-profile-navigation.ts`); กล่องข้อมูลเอกสารไม่บล็อก (R-A9); หน้ายืนยัน R-A11; return R-A8 (อีเมล + ปุ่มแก้ → เปิด recipient flow เดิมใน `BillingEmailRecipientPanel`); แบนเนอร์ตีกลับ; G16 (ไม่กระโดดแท็บ)
7. web `CompanyProfilePage`: คง `returnTo=billing` เป็นทางเลือก; ข้อความ hint "เว้นไว้ก่อนได้" ให้สอดคล้อง (ที่อยู่กรอกที่ Stripe ได้)
8. ถอด/ลด mapping `BILLING_EMAIL_VERIFICATION_REQUIRED`, `BILLING_COMPANY_PROFILE_REQUIRED` จากเส้นทางซื้อ (คงข้อความ 1 release); เอกสาร amend: company-profile-gate spec, signup-optional-email spec §5.2/§8, sales-deals D4/S16
9. e2e fixture ใหม่ `billing-no-setup.fixture.ts` (ไม่แก้ค่าเดิมของ `billing-preview.fixture.ts`): ร้านล็อก ไม่มีอีเมล/ที่อยู่ → ซื้อ → return → recipient จาก Stripe (stub)
10. smoke `billing-no-setup-smoke.ts` (simulated Stripe: session ไม่มี customer email → completed ด้วย customer_details.email; card + promptpay async; ตรวจ recipient/profile หลัง apply)

### Tests
- unit: gate ใหม่ทุก purchase kind (INITIAL/RESTART/REPEAT/UPGRADE/FULL_PACKAGE/deal/advance) ไม่โยน 3 รหัส; Checkout params ทุก path; sync-back mapping (ที่อยู่แยกได้/ไม่ได้, ไม่ทับค่าที่มี); bounce flag/notify once
- PG: apply → recipient captured + profile filled; replay idempotent; account email ยังไม่ verified
- web: BillingPage specs ที่แตะ; e2e 1280/390 fixture ใหม่
- ไม่มี diff ในไฟล์หลักฐาน (assert ด้วย `git diff --stat`)

### Exit Criteria
- ร้านที่ไม่มีอีเมล/ที่อยู่ quote+checkout ได้; simulated paid → recipient/profile ถูกเติม; อีเมลชำระสำเร็จออก; หน้าแพ็กเกจไม่มีปุ่มตาย

## Phase 3: แก้ไขเอกสารด้วยตัวเอง — PR E (API + workers + web) — *แทนที่โดย §P3 (ออกใบใหม่แทนใบเดิม พักไปสเปกแยก — DQ1)*

### Tasks
1. resend (R-D1): endpoint + limiter + Stripe `invoices/:id/send`, `charges/:id` receipt_email; ปุ่มในหน้าเอกสาร; audit
2. recipient change (R-D2): ต่อยอด flow เดิมด้วย "ส่งเอกสารล่าสุดไปอีเมลใหม่" + ล้างธงตีกลับ; เปิดจาก return/แท็บ/แบนเนอร์
3. reissue engine (R-D3) เป็น op `DOCUMENT_REISSUE` ตามแบบ collection op (ไฟล์ใหม่ `billing-document-reissue.ts`; `billing-schedule.ts` เพิ่มชื่อ type เท่านั้น): preview (diff ฟิลด์, ยอด, เลขใบ) → confirm → ขั้น 1–4 ของ R-D3 แบบ observed/retry; schema `BillingInvoice.kind/replacesInvoiceId/replacedByInvoiceId/reissueOperationId`
4. guards (R-D4): `billing-refund-source.ts`, reconciler paid-held/credit-note checks, `billing-repeat.ts` assertNoDebt, `billing-purchase-source.ts`, settlements/sales report → ข้าม reissue credit note และใบ `DOCUMENT_REISSUE`; PG tests: หลัง reissue ซื้อซ้ำ/ต่อท้ายรอบ/upgrade ยังได้, refund ของใบเดิมยังทำได้ครั้งเดียว (ห้ามคืนซ้ำผ่านใบใหม่)
5. limits (R-D5: 30 วันนับจากวันที่ออกใบ, 1 ครั้ง/ใบ), VAT guard (R-D6), copy (R-D7); ใบใหม่ตั้ง `effective_at` = วันที่ใบเดิม และ Customer `tax_ids` `th_vat` เมื่อมีเลขผู้เสียภาษี; history UI ป้าย "ถูกแทนที่"; documents open ใช้ใบใหม่เป็นค่าเริ่มต้น
6. errors ใหม่ + Thai สองที่; docs: line-web-billing-ui spec §7 (เอกสาร) amend

### Tests
- unit: window/once/fields/VAT guard; credit note + new invoice params; guards
- PG: op replay/idempotent, refund-before/after, source drift, Stripe error mid-way (journal)
- smoke: `billing-no-setup-smoke.ts` ขยาย resend/reissue (simulated Stripe)
- e2e: หน้าเอกสาร → แก้ไข → ยืนยัน → ประวัติ (stub)

### Exit Criteria
- AC4/AC5 ผ่านแบบ simulated; ไฟล์หลักฐานไม่เปลี่ยน

## Phase 4: เครื่องมือแอดมิน — PR F (API + web) — *แทนที่โดย §P4*

### Tasks
1. admin invoice page 3 ปุ่ม (R-E1) ผ่าน reviewed-op + self-confirm + password proof (`billing-approval.ts`); R-E2 recipient by admin (`recipientSource=ADMIN`, แจ้งลูกค้า)
2. partner profile fields (R-E3): DTO/use-case `update-partner-profile` + `PartnerDetailPage` ฟอร์ม (address widget เดิม) + Stripe Customer sync (เรียก billing service เดิมที่ sync ก่อน Checkout)
3. reference lookup (R-E4): endpoint + ช่องค้นหาบน `/system/billing`
4. support reference (R-E5): SupportRequest fields + ฟอร์ม/การ์ดที่เริ่มจากหน้า billing แนบ reference; inbox ปุ่ม "เปิดรายการ"
5. audit R-E7; docs: controls spec C-series amend สั้น

### Tests
- unit/HTTP: permission per endpoint (OWNER ปฏิเสธ, scoped operator ตาม company scope, single-admin self-confirm), lookup ไม่รั่วข้ามบริษัท
- web: admin page specs ที่แตะ; e2e admin 1280/390 สำหรับ 3 ปุ่ม (stub)

### Exit Criteria
- AC6 ผ่าน; ทุกข้อความ "ติดต่อทีมงาน" ฝั่งลูกค้ามีเลขอ้างอิง

## Phase 5: ขัดเกลาเส้นทางซื้อ — PR G (web + API เล็กน้อย) — *เพิ่มเติมโดย §P5*

### Tasks
1. G09 error map ครบ + แสดงข้อความ API เมื่อไม่มี mapping; ลบ mapping ตาย; แก้ 2 ข้อความผิดสถานการณ์
2. G10 quote หมดอายุ; G11 Checkout สร้างไม่สำเร็จ → ข้อความ + retry; G12 cancel path one-tap; G13 polling 3 นาที; G14 ปลดล็อกในที่ (re-read plan-term notice หลัง APPLIED)
3. G17 ปุ่มไปหน้าแพ็กเกจในการ์ดใกล้หมดอายุ; G18 ลิงก์โควตา → billing; G24 โหมดจ่าย default บัตร + "วิธีชำระอื่น", รายปีต่อเดือน, VAT note บนการ์ดเมื่อนโยบายเพิ่ม VAT
4. R-B3 ถ้าเลื่อนมาจาก Phase 1

### Tests
- web specs ที่แตะ; e2e return states (paid/pending/cancel/expired) 390

### Exit Criteria
- AC7 ผ่าน; ไม่มีปุ่มจางไร้คำอธิบายในเส้นทางซื้อ

## Phase 6: Integration Verification และ Rollout — *เพิ่มเติมโดย §P6*

1. รวม develop → รัน CI ครั้งเดียว; twin PR main ตามลำดับ
2. UAT (Stripe test mode): G27 ทั้ง 5 สมมติฐาน; AC1 จาก LINE จริง iPhone + Android (external browser, one-tap, PromptPay QR ข้ามแอปธนาคาร); AC4/AC5 กับร้านทดสอบ; บันทึก op ids ตาม runbook
3. Production: promote ตาม runbook; acceptance ภายใน ~5 นาทีหลัง website-ready; Owner เดิน AC1 ด้วยร้านใหม่จริง 1 ร้าน แล้วคืนเงิน/ยุติแพ็กเกจในแอป (flow เดิม)
4. หลัง release: ร้านที่ Owner เคยต่ออายุด้วยมือ — ไม่ต้องทำอะไร (R-C9); ticket repo `mangmee_web` วิธีใช้ 5 ขั้น

## Risks

- **Evidence chain** (สูงสุด): reissue credit note ถูกอ่านเป็น refund → hold/review/บล็อกซื้อซ้ำ → R-D4 + PG tests ครอบทุกตัวตรวจ; ทำ Phase 3 หลัง Phase 2 นิ่ง
- **Stripe Checkout email**: Customer ที่มีอีเมลจะล็อกในหน้า Checkout → R-A2; ต้องพิสูจน์ใน test mode ว่า Checkout ถามอีเมลเมื่อ Customer ไม่มี และบันทึกลง Customer (G27)
- **Replay flag**: เหตุผลเดิมของเงื่อนไข wrap ไม่ชัด → R-B2 สองทาง; ค่า flag บน production ต้องอ่านจาก env readback ก่อน UAT
- **เบราว์เซอร์ภายนอก**: iOS Safari vs Android default; LINE PC ignore param; ทดสอบเครื่องจริง
- **Single-admin**: op เอกสารต้อง self-confirm ได้ (owner คนเดียว) → reuse pattern refund
- **Postmark**: bounce webhook ผูกกับ MessageStream/secret ที่ตั้งไว้ 2026-09-23 — ตรวจ readback ก่อน UAT
- **Worktree/shared checkout**: งานอื่นค้างใน shared tree → ทุก PR จาก worktree แยก; stage explicit paths

## Open Questions

- Q1, Q2, Q4, Q5 ใน spec §16 (ค่าเริ่มต้นใช้ได้ทันที); Q3/Q6 ตัดสินแล้ว (D-PF-9/10)
- ต้องการ e2e ผ่าน LINE จริงบน CI ไหม (ไม่ — fake harness local + UAT เครื่องจริงพอ)

## Delegation Briefs (สรุปสำหรับ controller)

- PR A/B (Phase 1): agent 1 = API+LIFF+LINE (tasks 2–6, 10), agent 2 = web+console (tasks 7–8); pins: ไม่แก้ `package.json`, ไม่แตะไฟล์หลักฐาน, run typecheck (heap flag) + spec ที่แตะ + `node scripts/run-line-ai-whole-chain-acceptance.mjs` ก่อน push (LINE-AI changes)
- PR C/D (Phase 2): agent 3 = billing API/reconciler/workers/schema/smoke, agent 4 = web BillingPage/return/profile + e2e fixture ใหม่
- PR E (Phase 3): agent 5 = reissue engine + guards + UI (ต้องอ่าน refund-fix memory 2026-09-23 เรื่อง credit note lines)
- PR F (Phase 4): agent 6 = admin
- PR G (Phase 5): agent 7 = polish
- ทุก brief แนบ: spec section ที่เกี่ยว, ไฟล์/บรรทัดจาก spec §3/§13, ข้อห้าม, คำสั่ง verify, และให้เขียนผลลง memory นี้

## แก้ไขแผน 2026-09-27 (ตาม spec §18 — ผลตรวจโค้ดจริง)

### P0. ข้อบังคับก่อนเริ่มทุก PR

- **Pins:** `node infra/security/sync-production-maintenance-release-pins.mjs --check` ปัจจุบัน **exit 1** (develop stale จาก commit 48c4ab57) → PR แรก (PR A) รัน sync (rewrite validator + `deploy-production.yml:421`), รัน `--check`, รัน `bash infra/security/{sync-production-maintenance-release-pins,validate-production-maintenance-release}.spec.sh`, commit ใน PR เดียวกัน + twin main. ไฟล์ pinned ที่แผนนี้แตะ: `auth.guard.ts` (allowlist route ใหม่), `auth.controller.ts`? (ไม่ pinned), `app/login/page.tsx`/`session-gate.logic.ts` (**ห้ามแตะ** — R-B5 ส่วนแรกมีแล้ว), `companies/[companyId]/layout.tsx` (**ห้ามแตะ** — G14 ทำใน `WorkspaceLayout.tsx`), `auth.module.ts` (หลีกเลี่ยง provider ใหม่: helper เป็นฟังก์ชัน Prisma ธรรมดา), `apps/workers/src/main.ts` (ไม่เพิ่ม worker)
- **การลงทะเบียนเทสต์ (ไม่แตะ package.json):** API unit spec ใหม่ → `scripts/line-ai-whole-chain-acceptance.catalog.mjs` (api-behavior args) หรือชื่อใน `ci.yml:541-547`; `*.pg.spec.ts` ใหม่ → invocation ของตัวเองใน job "Migrations and Boot" (pattern `ci.yml:766-778`) — ห้ามใช้ suffix `.postgres.spec.ts`; contracts spec ใหม่ → ชื่อใน `ci.yml` (เหมือน `:543`); smoke ใหม่ → `apps/api/src/scripts/` export ฟังก์ชัน เรียกจาก `billing-http-smoke.ts` ด้วย selector `BILLING_NO_SETUP_ONLY=1` (pattern `:207-258`) + step ใน `extended-tests.yml`; e2e → auto (chromium project) แต่รันเฉพาะ `extended-tests.yml:309`; web spec auto (glob)
- **ci.yml parity:** ทุกการแก้ `.github/workflows/ci.yml` ต้องอยู่บน main แบบ byte-identical ก่อน UAT all (`deploy-uat.yml:79-93`; runbook :273-278)
- **หลักฐาน PG/smoke/e2e:** มาจาก Extended Tests (manual) — บันทึก run id ใน exit ของ phase (ไม่ใช่ "CI once at merge")
- **Worktree:** ทุก PR จาก worktree แยก; controller ไม่แก้ worktree ของ agent ที่กำลังทำงาน; recipe fake-LINE harness แนบใน brief (อยู่ใน memory ไม่ใช่ repo)
- **ห้ามแตะ:** `paid-invoice.ts`, `paid-checkout-invoice.ts`, `billing-schedule.ts` (ไม่มี op ใหม่ที่นั่น); amend รายการ "ห้ามแตะ 6 ไฟล์" ใน `mangmee-sales-deals-and-locked-signup-plan-th.md:19,83` ให้เหลือ 2 ไฟล์หลักฐาน (RV34)
- **Flags ที่งานนี้พึ่ง (ไม่เพิ่มใหม่):** `LINE_WEB_HANDOFF_ENABLED` (true), `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` (true บน production — ยืนยัน 2026-09-26), `BILLING_MODE=live`

### P1. Phase 1 (แทนที่รายการเดิม) — PR A (API + LIFF + LINE) / PR B (web + console)

1. **Pins sync** (P0) — ก่อนอื่น
2. contracts `plan-term.ts`: ย้าย `planTermLockReason` (รับ Date|string) + `accessStateOf` (จาก sales-console) → `planTermStateLabel`; re-export จาก API; **ไม่ใส่ใน `line-ai.ts`**; spec ชื่อใน ci.yml
3. **Outbound transform** `withLineExternalBrowserParam(url)` (URL parse, คง fragment, ข้าม `liff.line.me`/official/tel) ใส่ที่ `line-reply.adapter.ts:22-29`, `system-line-push.ts:43-51`, `notification.use-cases.ts:781-806` หลังคำนวณ retry key; length-aware กับ 5000; ตอน mint ตัด param จาก target (`line-handoff-link.service.ts:118-120`); ลบ param ซ้ำใน `sales-deal.logic.ts:220` และ door card `:417-425`; tests: retry key ไม่เปลี่ยน, ภาพไม่แตะ, fragment คง, idempotent
4. **R-B2 ทาง (ข):** `replyIfCompanyLocked` (`:2185-2192`) mint ก่อนสร้างการ์ด (`linkFor(..., surface 'locked_card_packages')`) เว้นกลุ่ม/ห้อง; `buildPackageRequiredMessage` รับ `packageUrl` (validate prefix `/l/`) fallback URL ธรรมดา; `handlePackageChangeRequest` (`:2841-2846`) เช่นกัน; promotion card เพิ่ม group guard; ไม่แตะ `:3274`/`linePushRetryKey`; tests: flag on/off → `/l/`, recorded == sent, mint fail → plain, group → plain
5. `/l/[token]` route: `HEAD` → 204; forward client IP (`forwardedClientHeaders()`); LoginPage copy `:41`
6. LIFF: `get-line-signup-status` เพิ่ม `lockReason` + `canManagePlan` (optional; คง `canEnter`); `liff-page.security.ts` หน้า COMPLETED+ล็อก+manager: หัวข้อ/ปุ่ม "เลือกแพ็กเกจ" เตรียม handoff ตอน render แล้ว `openWindow external`; label รายการร้านสั้น (สถานะในเนื้อความ); fallback เมื่อ billing disabled; `exchange-liff-session.destination()` permission-aware → billing/renew; fixture `line-liff-signup.spec.ts` เพิ่มเคสร้านล็อก (ไม่เปลี่ยนเคส ACTIVE); `liff-start-handoff.spec.ts` ปรับ label
7. Push หลังสมัคร: คงลิงก์ LIFF, หัวข้อ "เปิดร้านแล้ว" ปุ่ม "เลือกแพ็กเกจ" ทั้ง `first`/`attached` (`line-signup-notify.service.ts:56-58,352-374`); ภาพวิธีใช้ตอน follow: ถอด/แทนด้วยไฟล์ใหม่ชื่อใหม่ (`:240-252,:2226-2230`; spec `line-first-signup-webhook.spec.ts:403-404`)
8. Copy: G19 → postback ใหม่ "ให้ทีมงานติดต่อกลับ" สร้าง support request **ไม่หยุด AI 24 ชม.** (ไม่ใช้ "ติดต่อเจ้าหน้าที่"); G20 (`line-staff-menu.logic.ts:310`, `line-public-policy.logic.ts:16`, webhook `:244` — ข้อความ Owner-verbatim ต้องให้ Owner sign-off); G25 คง topic key แก้เฉพาะข้อความ; RV33 `auth.controller.ts:580`
9. **R-C11 helper** `access-control/domain/logic/plan-manager.logic.ts` (`planManagerRoleFilter`, `planManagersOf`, `planManagerLineUserIds`, `canManagePlan`) ใช้ใน `assertOwner` ด้วย; call sites: webhook `:1707,:2301+5741-5753,:2817`, `plan-term-sweep.use-case.ts:177-180`, `billing-notifications.service.ts:225-228` (แยก LINE/email), `sales-deals.service.ts:524` (ฟังก์ชันใหม่; ห้ามแตะ `ownerLineUserIds`), `account/email/page.tsx:23`; คง OWNER ที่ `:5842`; specs: `line-billing-entry.spec.ts:24,26`, webhook spec `:386-407,825-862,2335,2386-2400,2470-2650`, `line-first-signup-webhook.spec.ts:1296,1317,1425-1460`, `plan-term-sweep.use-case.spec.ts:76,194`, `package-change-decision.use-case.spec.ts:45-76`
10. Web/console: `/auth/me/companies` เพิ่ม `lockReason` (`auth.controller.ts:1094-1105`; spec `:351`); picker/switcher labels (`BillingCompanyPicker.tsx:24,27`, `WorkspaceScope.tsx:327-331`); `BillingPage.tsx:341-347` ใช้ helper; partner list เลือก `planTerm` + ฟิลด์ optional; PartnerDetailPage สถานะจาก helper + คำเตือนต่ออายุระบุผลข้างเคียง (RV25) + guard "เปิดใช้งานบริษัท" + queue เปลี่ยนแพ็กเกจแสดงล็อก/บล็อกอนุมัติ; `BillingCompanyDirectory/Overview`, `SalesConsoleParts`, `SignupQueuePage`, partner timeline labels — **ทำแล้ว 2026-09-28 (PR B, branch `claude/purchase-pr-b-web-console-20260928`, worktree `mangmeeplus-purchase-pr-b`); ไม่ได้ push/merge/deploy ในรอบนี้ — ดู `docs/agent-memory/purchase-without-setup-2026-09-26.md` (Verification). BC03/RV31 (`e2e/plan-term-billing-readiness.spec.ts:103-110,736-775`) ยังแดงและยังค้าง Phase 6 ตามเดิม — ไม่ได้แก้ใน PR B**
11. ถอด R-B3 ออกจากงาน; R-B4 = ปุ่ม "เปิดหน้านี้ใน Safari/Chrome" ในเบราว์เซอร์ LINE + start route redirect `/login?next=`
11b. **R-B5 ขยาย (ไม่ต้องล็อกอินซ้ำ):** `LoginPage.tsx` — มาจากลิงก์ LINE + ไม่มี session → เริ่ม LINE login ทันที (ไม่แสดงฟอร์ม); `channel=line` → ปุ่ม LINE เป็นปุ่มหลัก; copy `:41`; log `login_wall_from_line_link`; ~~DQ8 อายุ session ลูกค้า 30 วัน~~ (`issue-token.use-case.ts:19` แยกตาม role — ไฟล์ไม่ pinned; `refresh-session.use-case.ts` pinned ห้ามแตะ → ทำที่ issue เท่านั้น); tests: `LoginPage` spec, `line-login` e2e, AC10 บนเครื่องจริงใน Phase 6 — **ทำแล้ว 2026-09-28 ยกเว้น DQ8 (PR B): R-B5 ขยาย + R-B4 (`AccountEmailOtpPanel.tsx`, start route) เสร็จ; DQ8 ตัดออกจากรอบนี้ตามมติ Owner 2026-09-27 (คงอายุ session 7 วัน) — ไม่แตะ `issue-token.use-case.ts`/`auth-cookies.constants.ts`; แนวทางเดิมเก็บไว้ใน `docs/plans/purchase-without-setup/pr-b-web-console-state.md` §3.13 สำหรับรอบถัดไป**
12. PG test: provisioning → sweep ไม่แจ้ง (R-C10 มีแล้ว — เพิ่มเคส integration เท่านั้น)

Exit: ร้านใหม่กด "เลือกแพ็กเกจ" จาก LIFF (1 แตะ)/การ์ดล็อก (1 แตะ)/push (2 แตะ) ถึงหน้าแพ็กเกจในเบราว์เซอร์นอก LINE; pins `--check` ผ่าน; spec ที่แตะ + catalog ผ่าน; ไม่มี "ติดต่อทีมงาน" เป็นทางหลัก

### P2. Phase 2 (แทนที่รายการเดิม) — PR C (API + workers + schema) / PR D (web)

1. Schema (additive): `BillingAccount.recipientEmail` (index) / `recipientSource` / `recipientBouncedAt` / `recipientBounceNotifiedAt` / `checkoutAddressJson`; migration + PG spec ที่แตะทุกคอลัมน์; script backfill `recipientEmail` จาก Stripe Customer (read-only, run ใน release step)
2. Gate removal ครบทุกจุด (RV03): proofs `billing.service.ts:301,529-530,620-621,675-676`, `billing-repeat.ts:207-208`; equality → QUOTE_STALE (`:332-336,633-635,683-687`, repeat `:281`); `assertBillingProfileUnchanged` non-throwing (`:550,:659`, repeat `:209`); portal `:922-929` + collection ops (`billing-collection.ts:24,75,164,262-263`) เลิกบังคับอีเมล (DQ2); Customer creation ไม่มีอีเมล (`:615-632`); DTO `billing.dto.ts:94` + controller `:538` optional; contracts `billing.ts:127` nullable (SCHEDULED_CHANGE/ADVANCE_DEAL มีใน purchase-kind list แล้ว — ไม่ต้องทำ, spec §18.5 A16)
3. Customer sync payload เดียว 3 จุด (R-A2) + `customer_update.address` never/auto (R-A3) 3 จุด + `cancel_url&checkout=canceled`; deploy note: ไม่มี repeat attempt ค้าง (RV17)
4. Recipient capture (R-A4 ก): อ่าน Customer ก่อน tx ใต้ lease ใน 4 apply paths + admin apply; เขียนเฉพาะเมื่อว่าง; `checkoutAddressJson` จาก `session.customer_details` (one-time) / Customer (subscription)
5. **Flow เปลี่ยนผู้รับใหม่** (R-A8/R-D2): endpoints `recipient/otp/request|confirm` (class DTO), challenge purpose `billing_recipient` ผูก companyId, limiter เดิม, op `UPDATE_BILLING_EMAIL` แบบมี recipient proof (worker ไม่ assert account email), Stripe Customer update journaled, แจ้งผู้รับเดิม; allowlist ใน `auth.guard.ts` (pinned → sync pins อีกครั้งใน PR นี้); web `BillingEmailRecipientPanel` rewrite (2 ทาง: อีเมลบัญชี verified / อีเมลใหม่ + OTP); เปิดจาก return (APPLIED), แท็บการต่ออายุ, แบนเนอร์ตีกลับ
6. R-A7: outbox key ใหม่ + `recipientUserId` nullable + admin monitor join; worker อ่าน SUPPRESSED ผ่าน intentKey → ธง + LINE push (trigger เดิม) + แบนเนอร์; Postmark stream แยก (DQ6: config/secret ตั้งค่าใน release); UAT allowlist ในแผนทดสอบ
7. Web `BillingPage.tsx`: ถอด gate ทุกบรรทัด (RV05/§18.2 R-A9) — `email` ไม่ส่งเมื่อว่าง (คง positional param ใน `billing.api.ts:24`); ลบ reset quote จาก email state (`:144,147`); ถอด modal/กล่องเหลือง `:78,212-216,250-251,308-315,326-338` (คง `billing-profile-navigation.ts`); หน้ายืนยัน R-A11; return R-A8 (อีเมลที่ PAID, ปุ่มแก้ที่ APPLIED); G16 route error by code; `CompanyTermExpiredPage.tsx:98` ลิงก์โปรไฟล์เป็นทางเลือก; `account/email/page.tsx:23,25` + `AccountEmailOtpPanel` copy `:99,111`; `CompanyProfilePage` ปุ่ม "ใช้ที่อยู่จากการชำระเงิน" (ผ่าน identity use case; สิทธิ์ legal_identity) + returnTo no-change → กลับ (RV29)
8. Docs amend ใน PR: company-profile-gate spec (:5-13), signup-optional-email spec (:20,21,82,86,181-182,189,355), sales-deals spec (:51,53,112,120,152,184,194,350), transactional-email spec (:128), line-web-billing-ui spec (:78)
9. Tests: แก้ที่จะแดง — `billing-http-smoke.ts:267-295,310-346`, `email-verification-smoke.ts:77-78,134-150`, `billing-free-days-smoke.ts:117-118`, `billing-portal-smoke.ts:70-77`, `billing-notification-smoke.ts:61-64,112-115`, `billing-mail-recovery-smoke.ts`, `billing-company-profile.spec.ts:10-17` (+contracts), `billing-profile-recovery.spec.ts:7-32`, `billing-email-recipient.postgres.spec.ts:23-33`, typecheck-only specs (grace/package/purchase-source/advance-deal), seeding smokes (upgrade/restart/plan-change), e2e `customer-billing-ux.spec.ts:63-89,137-143`, `billing-advance-deal.spec.ts:25,55,74,87,121`, `plan-term-billing-readiness.spec.ts:631,643-648`, web `billing-profile-navigation.spec.ts` (คง), `account-email-otp.postgres.spec.ts` (คง helper); ใหม่: fixture `billing-no-setup.fixture.ts` + spec mock-based 1280/390 (stub `checkout.stripe.com/**`), smoke `checkBillingNoSetup()` (fake Stripe ต้องตั้ง Customer email เมื่อ Checkout completed), PG recipient capture/replay, coverage test ไล่ `billingError('X')` ทุกรหัสมีไทย (RV28)

Exit: ร้านไม่มีอีเมล/ที่อยู่ quote+checkout ได้ทุก purchase kind; simulated paid → recipient/checkoutAddress ถูกเก็บ; อีเมลชำระสำเร็จออก; เปลี่ยนผู้รับด้วย OTP ไปอีเมลใหม่ได้; ไม่มีปุ่มตาย; ไม่มี diff ในไฟล์หลักฐาน

### P3. Phase 3 (แทนที่) — แก้เอกสาร: ส่งซ้ำ + ผู้รับ (ออกใบใหม่ พักไว้)

1. ส่งเอกสารซ้ำ (R-D1): คำสั่ง sync ใต้ lease; limiter inspect→Stripe→consume 3/ใบ/วัน; `invoices/:id/send`; `charges/:id receipt_email` เฉพาะเมื่อผู้รับเปลี่ยน; ปุ่มในหน้าเอกสาร (customer) ที่ `/billing/invoices/:id`; allowlist route (pinned sync); errors ไทย (`BILLING_RESEND_LIMIT`)
2. รายการที่ตัดออก: engine `DOCUMENT_REISSUE`, `BillingInvoice.kind/replaces*`, guards E1–E5 → ย้ายไป **สเปกแยก** `docs/specs/billing-document-reissue-spec-th.md` (ยังไม่เขียน) พร้อม DQ1; runbook ชั่วคราว `docs/runbooks/billing-document-correction-manual.md`: ขั้นตอนใน Stripe Dashboard (credit note out-of-band `email_type none` + ใบใหม่ paid out-of-band + `effective_at` เดิม) และกติกา "คืนเงินก่อนออกใบใหม่ถ้ามีแนวโน้มคืนเงิน" + ผลกระทบต่อ restart (ต้องแจ้งทีมก่อนทำ)
3. Tests: resend limiter/idempotency; smoke ขยาย; e2e ปุ่มส่งซ้ำ

### P4. Phase 4 (แทนที่) — แอดมิน

1. หน้าใบแจ้งหนี้ของบริษัท: 2 ปุ่ม (ส่งซ้ำ; เปลี่ยนอีเมลผู้รับ = reviewed op + password proof + self-confirm platform-scope; แจ้งผู้รับเดิม) — ต้องหลัง P2 ข้อ 2 (RV/A11); permission `system.billing.override.manage` + amend controls spec (:113,223) & single-admin spec (:14)
2. แก้ไขข้อมูลบริษัท (R-E3): export `CompanyIdentityUseCase` จาก DataModelCoreModule; admin path ด้วย change kind + audit CRITICAL เดิม; ปลด `partnerMetadataLockError` สำหรับ DISABLED+termDisabledAt; route address-master สำหรับ partner; Customer sync command journaled
3. Lookup (R-E4): suffix search 8 ตัวท้าย invoice/attempt (+op/issue) ใน `BillingAdminService`; index; 404 นอก scope; ช่องค้นหาบน `/system/billing`
4. Support reference (R-E5): LINE — แนบ `referenceKind/referenceId` บนแถวเดิม + derive companyId; inbox ปุ่ม "เปิดรายการ"; เว็บ — ใช้ `package-change-requests` เดิมเป็นคำขอช่วยเรื่องแพ็กเกจพร้อม reference (DQ4); เลขอ้างอิงเฉพาะ staff
5. Tests: permission per endpoint (OWNER ปฏิเสธ, scoped operator ต้อง reviewer ที่สอง), lookup ไม่รั่วข้ามบริษัท, identity path audit, lock rule; web admin specs; e2e admin 1280/390

### P5. Phase 5 (เพิ่มเติม) — ขัดเกลา (จากผลตรวจเว็บ)

- RV29: one-tap "เลือกแพ็กเกจใหม่" เมื่อ `canCancelCheckout && PENDING` ทั้งหน้าแพ็กเกจและ return; branch ผล cancel (EXPIRED/COMPLETED/PENDING) และไม่เปิด chooser เมื่อ COMPLETED; quote expiry timer + re-quote (offer/mode/deal/intent/capacity เดิม); checkout FAILED → re-quote, UNKNOWN → "กำลังตรวจกับ Stripe" ไม่ retry; polling: attempt only, หยุดที่ HELD/FAILED, visibilitychange, throttle refresh; strip `profile=updated&offer` หลัง resume
- RV30: `PLAN_TERM_CHANGED_EVENT` (pattern `ACCESS_CONTEXT_STALE_EVENT` `authed-fetch.ts:22,200-207`) dispatch จาก BillingPage เมื่อ confirmed ใน `useLockedShell()`; `WorkspaceLayoutClient` re-read notice + `router.refresh()`; re-read on focus/visibility; ยอมรับ remount (recover จาก URL) หรือ guarded reload; หัวข้อ return ไม่รอ status ACTIVE (race)
- G09 mapping ครบ + ห้าม raw message; G24 expander auto-open เมื่อโหมดที่เลือกอยู่ข้างใน (e2e `.check()`); ไม่ใส่ helper text ใน label radio ของดีล; รายปีต่อเดือนบรรทัดใหม่; G17 ลิงก์จ่ายในการ์ดใกล้หมดอายุ; G18 quota link เฉพาะ `canManagePlan`; locked shell "กลับหน้าเลือกบริษัท" → settings; double header (ตรวจด้วย screenshot)

### P6. Phase 6 (เพิ่มเติม) — Verification/Rollout

- ก่อน UAT: ci.yml parity main; readback `salesCompanyIds` (RV18) และ Postmark stream/secret (DQ6); แก้ e2e rig `plan-term-billing-readiness.spec.ts:103-110` + BC03 (RV31); dispatch Extended Tests (billing suites + e2e) และบันทึก run ids
- G27 (test mode Stripe บน UAT) ขยาย: Checkout ถามอีเมลเมื่อ Customer ไม่มี + บันทึกลง Customer; `customer_update.address` never/auto ตามโปรไฟล์; `invoices/:id/send` ใบที่จ่ายแล้ว (test mode ไม่ส่งอีเมล — พิสูจน์ event); `receipt_email`; PROMPTPAY_RENEW binding เมื่ออีเมลมาจาก Checkout (RV20); handoff `usedAt` บนเครื่องจริง iPhone/Android (external browser, link preview ไม่กิน token); เลขอ้างอิงในคำขอ
- Production acceptance: Owner ซื้อจริงด้วยร้านใหม่ LINE (ไม่มีอีเมล) → ได้อีเมลชำระสำเร็จ + ใบเสร็จ Stripe → เปลี่ยนผู้รับ + ส่งซ้ำ (พิสูจน์อีเมลจริง) → คืนเงิน/ยุติแพ็กเกจในแอป (flow เดิม)

### ความเสี่ยงที่เพิ่ม (2026-09-27)

- ผู้รับเอกสารที่พิมพ์ผิดแก้ได้ก็ต่อเมื่อ flow OTP ใหม่ (P2 ข้อ 5) ส่งพร้อมกัน — ห้ามปล่อย P2 โดยไม่มีข้อ 5 (มิฉะนั้นอีเมลผิดต้องให้แอดมินแก้ใน Stripe)
- การเปลี่ยน `billing-repeat.ts` params (journal hash) ต้อง deploy ตอนไม่มี repeat attempt ค้าง
- R-A5 ต้องอยู่ใน release เดียวกับ P4 ข้อ 1 (มิฉะนั้นแอดมินเปลี่ยนผู้รับแล้วทุกการซื้อพัง)
- pins/`ci.yml`/twin-main ต้องทำครบทุก PR ที่แตะไฟล์ pinned/workflow

## แผนลงมือ (implementation briefs) — 2026-09-27

สถานะ: **พร้อมเขียนโค้ด** — brief ต่อ PR อยู่ใน `purchase-without-setup/` (สารบัญและกติกา contract ข้าม PR ใน [00-readme.md](purchase-without-setup/00-readme.md)); ทุกฉบับตรวจไฟล์/บรรทัดกับ `origin/develop` ddcdcadf และผ่านการตรวจความสอดคล้องข้าม PR แล้ว (spec §18.5 บันทึกข้อที่แก้)

| ลำดับ | PR | brief | ครอบ (phase เดิม) | ปล่อยเดี่ยวได้ |
|---|---|---|---|---|
| 1 | A | [pr-a-line-liff-api.md](purchase-without-setup/pr-a-line-liff-api.md) | P0 pins sync + P1 ฝั่ง API/LIFF/LINE (R-B1/R-B2/R-C2/R-C3/R-C4/R-C11, G19/G20/G25) | ได้ |
| 2 | B | [pr-b-web-console-state.md](purchase-without-setup/pr-b-web-console-state.md) | P1 ฝั่ง web/console (R-C5/R-C6/R-C7, R-B4, R-B5 ขยาย, DQ8, RV30, G17/G18/F20) | ได้ (หลัง A) |
| 3 | C | [pr-c-billing-api-no-setup.md](purchase-without-setup/pr-c-billing-api-no-setup.md) | P2 API + schema + flow OTP ผู้รับ + bounce + P3 resend + allowlist/pins | **คู่กับ D** |
| 4 | D | [pr-d-web-billing-no-setup.md](purchase-without-setup/pr-d-web-billing-no-setup.md) | P2 web + P5 ขัดเกลา + error map ครบ + e2e | **คู่กับ C** |
| 5 | E | [pr-e-admin-tools.md](purchase-without-setup/pr-e-admin-tools.md) | P4 admin (2 ปุ่ม, identity, lookup, reference) | หลัง C และ B |
| ทุก PR | — | [xx-cross-cutting.md](purchase-without-setup/xx-cross-cutting.md) | ลงทะเบียนเทสต์, pins, ci.yml parity, migrations, readbacks, UAT U1–U15 + production acceptance, docs master table, release/rollback | — |

Owner ตอบแล้ว 2026-09-27: DQ8 คงเดิม 7 วัน (ตัดออกจาก PR B), DQ9 ใช้ค่าเริ่มต้น (แอดมินแก้ได้), G20 sign-off (แพ็กเกจธุรกิจ = ชุด 1,999); ข้ออื่นใช้ค่าเริ่มต้น. สิ่งที่ยังไม่ปิดก่อนลงมือ (ไม่บล็อกการเขียนโค้ด): readback `salesCompanyIds`/`LINE_WEB_HANDOFF_ENABLED` บน UAT+production (xx §6), G27 พฤติกรรม Stripe บน UAT test mode, และ "ต้องตรวจ" ท้าย brief แต่ละฉบับ (ตรวจได้เมื่อรันคำสั่งจริง)

