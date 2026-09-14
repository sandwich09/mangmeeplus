# Implementation Plan — LINE-first Signup (P10-L)

> **Implementation update 2026-09-14 — IN PROGRESS:** ซื้อครั้งแรก/ซื้อซ้ำ, upgrade ทุกช่วงที่จ่ายสะสม, downgrade สิ้นรอบ/เลือกสาขาและสมาชิก/ซ่อม invoice เดิม, cancel/resume/restart, financial observations, Admin company/timeline/scopes/case ownership และกู้คืน LINE/Postmark รายการเดิม, ฉบับร่างการตั้งค่า และ policy/gate/VAT มี actual Next/Nest/PostgreSQL/Chromium + marketing ผ่าน133กลุ่มกับ Stripe/Postmark/LINE จำลอง. Focused Admin42 (รวมแก้ copy gate หลังเปลี่ยน policy), downgrade17 และ regression/PG มีส่วนทับซ้อน. ดู [หลักฐานและข้อจำกัด](../evidence/billing-integration-2026-09-13/README.md). Controls/Postmark operations/full signup/full LINE/native/CI/merge ยังไม่ครบ. Receipt-only HIDDEN; ไม่มี deploy.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

สถานะ: **v2 2026-09-04 (หลัง Review รอบ 1)** — คู่กับ spec v4 [mangmee-line-first-signup-spec-th.md](../specs/mangmee-line-first-signup-spec-th.md) §15 และ [review round 1](mangmee-line-first-signup-review-round-1-th.md); Owner สั่งเริ่ม implement หลังรีวิว (2026-09-04) — ลำดับ **L-A (pre-flight B-01) → L-A2 → L-B → L-C → L-E → UAT → L-D**

## 0a. Pre-flight ใน L-A (ต้องทำก่อนเขียนของใหม่ — หลักฐานจาก review B-01)

- [ ] เขียน integration test: provision ผ่าน `ProvisionSignupUseCase` จริง (ไม่ mock onboarding) แล้วอ่าน `CompanyPlanTerm.tierKey` — คาดว่าได้ `STARTER_249` แทน `PRO_999` (บั๊ก) ถ้าใช่ → แก้: `CreateCompanyOnboardingCommand.planTier?/planDays?` ให้ onboarding เขียน tier ครั้งเดียว; provision-signup ส่ง tier แทนการเรียก `applyPlanTermPreset` ซ้ำ; อัปเดต `provision-signup.use-case.spec.ts:84-90` และ `create-company-onboarding.spec.ts:1195-1198` ให้ทดสอบเส้นจริง
- [ ] grep ผู้อ่าน `contactEmail` ทุกตัวตาม review B-03 และใส่ null-guard/ทางแยก source ก่อน migration nullable

## 0b. Slice L-A2 — ตัวนับสลิป (ใหม่, review G-01) — branch `codex/line-signup-a2-receipt-quota`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| **ไม่มีตารางใหม่** (แก้ 2026-09-05) | ใช้ seam เดิม `admitCompanyOcr` (`line-ai/application/company-ocr-governance.ts`) ที่นับ `CompanyOcrMonthlyUsage` อยู่แล้ว | ซ้อน `planLimit = effectiveReceiptQuota(planTerm)` (helper `receipt-quota.logic.ts`) เข้าใน transaction เดิม เฉพาะ route `receipt-ocr-web`/`receipt-ocr-line`; effective = min(ocrMonthlyLimit, planLimit); variant ใหม่ `plan_exceeded` → code `RECEIPT_QUOTA_EXCEEDED` |
| บังคับ | จุดเดียว = OCR client (`receipt-ocr.client.ts` เรียก `admitCompanyOcr`) ครอบทั้ง LINE และเว็บ | `RECEIPT_QUOTA_ENFORCED=false` = คำนวณ+audit `plan.receipt_quota.would_block` แต่ไม่บล็อก; ต้องพิสูจน์ว่าไม่มี path ใบเสร็จทาง LINE ที่ข้าม client |
| Copy | `line-business-card.logic.ts` การ์ดชนโควตา; web แบนเนอร์ใน `ExpensesHubPage` upload tab | ครั้งเดียว/เดือน ทาง LINE (เก็บ `quotaNoticeSentMonthKey` บน `CompanyPlanTerm`) |
| บรรทัด "ใบที่ n/15" | reply หลังอ่านสำเร็จ (เฉพาะ `FREE_TRIAL_15`) | |
| Tests | CAS ชนกัน 2 request พร้อมกัน → นับ 1 ครั้ง; ใบที่ 16 ถูกปฏิเสธทั้ง LINE และเว็บ; warm-up 10 ใบ; flag off = ไม่บังคับแต่ยังนับ | |

## 0c. Slice L-E — ข้อมูลร้านและบัญชีของฉัน (ใหม่, review G-02) — branch `codex/line-signup-e-profile`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| หน้าเว็บ | `apps/web/app/(workspace)/companies/[companyId]/settings/profile/page.tsx` + `features/company-profile/CompanyProfilePage.tsx`; เมนูใน `settings-menu.logic.ts` | ใช้ `PATCH /companies/:id/identity`, `PUT vat-registration` เดิม; perm `company.legal_identity.manage` |
| บัญชีของฉัน | endpoint ใหม่ `PATCH /v1/auth/me/contact` (phone), `POST /v1/auth/me/password/set` (สร้าง credential ครั้งแรก — ถ้าไม่มี), reuse email-verification request | LINE-only user ตั้งรหัสสำรองได้ |
| เช็คลิสต์ | การ์ดบน dashboard OWNER (`features/dashboard/...`) อ่านสถานะจาก `GET /companies/:id/identity` + `GET /v1/auth/me` | ไม่บล็อก; ซ่อนเมื่อครบ |
| prompt ตามบริบท | จุดออกเอกสารภาษี (ถ้ามีในรอบนี้ — ไม่งั้นแค่ลิงก์ไปหน้า profile) | เล็ก |
| Tests | web specs idiom เดิม; api: set-password ครั้งแรกไม่ทับของเดิม, phone validator | |
กติกา: Opus 5 implement / Fable 5 คุม-รีวิว-ทดสอบซ้ำ; แต่ละ slice = branch เดียว → PR → develop → main → deploy UAT (production ปิดด้วย flag จนกว่า Owner สั่ง); ponytail full mode; ห้ามแตะ `package.json` นอกจาก dependency; ไฟล์ pinned (`deploy.sh`, `auth.guard.ts`, `auth.module.ts`) แก้แล้วต้อง re-sync pins
ฐานโค้ด: develop `91957572` (fact sweep 2026-09-04)

## 0. ก่อนเริ่ม (Fable)

- [ ] ดึงต้นทุนจริงต่อใบ/ต่อ turn จาก `AiUsageEvent` บน prod (script พร้อมแล้ว; เปิดอุโมงค์เมื่อ Owner สั่ง — มีเมลแจ้งเตือน bastion 1 ฉบับ) → Owner เคาะ `LINE_FREE_AI_BUDGET_SATANG`
- [ ] ตรวจว่า webhook รับ event `follow` แล้วเดินเข้า unlinked path หรือไม่ (`process-line-webhook.use-case.ts`) — ถ้าไม่ เพิ่มใน L-B
- [ ] ตรวจ `LIFF_PAGE_SCRIPT` ว่า `liff.openWindow({external:true})` ใช้ได้ใน mode ใหม่ (`liff-page.security.ts`)
- [ ] ตรวจ `applyPlanTermPreset` รับ tier ใหม่ได้โดยไม่มี switch ที่ต้องแก้หลายที่ (`plan-term.logic.ts`)

## Slice L-A — backend core (api + contracts + migration)

**Branch** `codex/line-signup-a-core`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| Contracts additive | `packages/contracts/src/plan-term.ts` (`FREE_TRIAL_15` + preset), `packages/contracts/src/external-signup.ts` (`LineSignupSubmitDto`, `LineSignupStatusDto`, `PackageChangeRequestDto`, ขยาย `AdminSignupQueueItemDto`) | FROZEN = additive เท่านั้น |
| Migration | `apps/api/prisma/schema.prisma` + `prisma/migrations/<ts>_line_first_signup` | `CompanySignupRequest`: line* คอลัมน์ (ไม่มีรูป), legal* 7 คอลัมน์, `contactEmail` nullable, `autoApproved`, `adminReminderSentAt`, index (lineChannelId, lineProviderUserId, state); `PackageChangeRequest` ใหม่ + partial unique OPEN; `CompanyPlanTerm.warmupUntil/warmupSlipLimit` |
| Config | `apps/api/src/common/config/app-config.service.ts` | `lineSignupEnabled`, `lineSignupApprovalMode`, `lineSignupAutoDailyCap`, `lineSignupWarmupSlips`, `lineFreeAiBudgetSatang`, `lineSignupAdminReminderMinutes`, `lineSignupBusinessDays/Hours` |
| Business hours helper | `apps/api/src/modules/external-signup/domain/business-hours.logic.ts` (ใหม่, pure) + spec | Asia/Bangkok, MON–SAT 09:00–18:00; `isBusinessHours(now)`, `nextBusinessStart(now)` |
| State machine | `external-signup/domain/company-signup.logic.ts` | `TRANSITIONS` แยกตาม source; `line-oa` ห้าม EMAIL_*; spec ตารางทั้งสอง |
| ID token verify reuse | ย้าย/แชร์ตัวตรวจจาก `auth/application/use-cases/complete-employee-line-link.use-case.ts` เป็น service กลาง (`auth/application/line-id-token.service.ts`) | ห้ามเปลี่ยนพฤติกรรม employee link; spec เดิมต้องยังผ่าน |
| Legal evidence | `auth/application/legal-acceptance.service.ts` เพิ่ม `currentRelease()` (version/statement/fingerprint/challenge) + `recordFromEvidence(tx, …)` | reuse `legalReleaseScopeRef`/statement constants; surface `'liff'` |
| Submit / status use-cases | `external-signup/application/submit-line-signup.use-case.ts`, `get-line-signup-status.use-case.ts` (ใหม่) | dedupe 1 open/LINE, attachUserId เมื่อ identity ACTIVE, AUTO_FREE → provisioning ทันที + daily cap, audit `signup.line.*`, `adminNotify.enqueue` เมื่อ MANUAL; `phoneNumber?` ตรวจด้วย validator มือถือไทยเดิม (10 หลักขึ้นต้น 0) → เก็บคอลัมน์ `phoneNumber` เดิม |
| Provisioning | `system-onboarding/application/use-cases/create-company-onboarding.use-case.ts` (`ownerAuth`, `legalAcceptance`), `external-signup/application/provision-signup.use-case.ts` (source line-oa → `FREE_TRIAL_15`/30 วัน, warm-up, งบ AI, ข้าม LINE_LINK_PENDING → COMPLETED) | `temporaryPassword` undefined; ExternalIdentity + LegalDocumentActionRecord ในธุรกรรมเดียว |
| Slip counter | จุดที่นับ `monthlySlipLimit` (P29 T2) | เพิ่ม `min(limit, warmupSlipLimit)` เมื่อยังไม่พ้น `warmupUntil` |
| Rate limits | `auth/application/auth-rate-limit.service.ts` | `line-signup-user` 3/วัน, `line-signup-ip` 20/ชม., `line-liff-session-user` 30/ชม., `line-signup-read` 60/ชม. |
| Package change | `external-signup/application/package-change-request.use-case.ts` + controller ใน companies scope | idempotent OPEN; audit |
| Controllers | `external-signup/presentation/http/public-line-signup.controller.ts` (ใหม่, `@Public()`), ขยาย `system-signup-request.controller.ts` (SUSPEND, DTO), `system-partners` timeline endpoint | flag off → 403 `line_signup_disabled` |

**Tests (ต้องมีจริง):** ตาม spec §11 บล็อก Unit/integration ทั้งหมดของ L-A (transitions ×2, submit 6 เคส, provisioning idempotent, legal gate ไม่โผล่, AUTO_FREE + cap + warm-up + ใบที่ 16, business hours ขอบเวลา, package change idempotent) — `pnpm --filter @watchdog-bms/api test` ทั้งชุดต้องเขียว + typecheck

## Slice L-B — LIFF + handoff + ข้อความ (api + workers)

**Branch** `codex/line-signup-b-liff`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| LIFF pages | `auth/presentation/auth.controller.ts` (`GET line/signup-page`, `GET line/start-page`), `common/security/liff-page.security.ts` (`LIFF_PAGE_SCRIPT` modes `signup`/`start`, CSP เดิม) | ฝัง statement/challenge ปัจจุบันตอน render; ฟอร์ม 1 ช่อง; `openWindow({external:true})` |
| LIFF session | `auth/application/use-cases/exchange-liff-session.use-case.ts` (ใหม่) → reuse `MintLineHandoffTokenUseCase`; route `POST /v1/auth/line/liff/session` | needsSignup เมื่อไม่มี identity; เลือกบริษัทจาก `LineCompanyContext` |
| Webhook cards | `line-ai/domain/logic/line-business-card.logic.ts` (การ์ด 3 ประตู, การ์ดสถานะ in/out of hours, การ์ดชนโควตา, การ์ดกันหลุด), `line-ai/application/use-cases/process-line-webhook.use-case.ts` (unlinked path + `follow` event + คำขอค้าง lookup + "ติดต่อเจ้าหน้าที่" + "โปรโมชั่น" ปุ่มขอเปลี่ยนแพ็กเกจ + AI-pause 24 ชม.) | reply-first; copy ตาม spec §7 (ค่ะ/นะคะ ตาม persona เดิม; ห้าม "+") |
| Push | `external-signup/application/line-signup-notify.service.ts` (ใหม่): พร้อมใช้ / ร้านที่ 2 / ปฏิเสธ / กันหลุด ผ่าน `pushSystemLineMessage`; outbox eventKey replay-safe | นับ push ≤ 2 ใน 7 วัน, ≤ 6 ใน 30 วัน (test) |
| P29 ข้อความ | `plan-term.logic.ts` `expiredLineOwnerMessageTh` + ladder 7/3/1 | เพิ่มปุ่ม "ขอเปลี่ยนแพ็กเกจ" (ไม่แตะ state machine) |
| Workers | `apps/workers/src/modules/signup-claim-email/…` หรือ module ใหม่ `line-signup-sweeps`: เตือนแอดมิน 60 นาที (นับตามเวลาทำการ), กันหลุดวันที่ 7 (หรือ 5 ใบ) exactly-once | timer 15 นาที; ใช้ internal controller pattern เดิม (`assertWorkerToken`) |
| Admin notify | `signup-admin-notify.service.ts` | ป้าย "จาก LINE" ใน dashboard event + LINE push; แจ้ง "ติดต่อเจ้าหน้าที่" พร้อมลิงก์ `/system/partners/<id>` |

**Tests:** webhook 7 เคส (spec §11), liff/session 3 เคส, reminders exactly-once, push budget; LIFF HTML snapshot ไม่มี inline script นอก `LIFF_PAGE_SCRIPT`

## บันทึกสำหรับ L-C จากรีวิว L-A รอบ 5–6 (2026-09-05)

- แอดมิน**หยุด**คำขอที่ค้าง `PROVISIONING` และยังไม่มีบริษัทไม่ได้แล้ว (ระงับถูกปิดทุกความสดเพื่อกันร้านไร้เพดาน) — ทางเดินตอนนี้: รอ stale → ปิดงาน (สร้างร้าน) → ระงับแถวที่ settle แล้ว → ปิดบริษัทที่หน้าพาร์ทเนอร์; ถ้าจะเปิด "ระงับแบบเจาะจง" ต้องเพิ่ม `companyId?` ใน `AdminSignupQueueItemDto` (additive) และอนุญาตเฉพาะ `staleProvisioning && companyId == null`
- ขอบ `PROVISIONING → SUSPENDED` ในตาราง transition ทั้งสองไม่มีใครเรียกถึงแล้ว — ตัดสินใจเก็บหรือลบให้ชัด (อย่าปล่อยเป็น "recovery ที่ไม่มีใครเรียก" ซึ่งเป็น pattern ที่รีวิว 5 รอบเจอซ้ำ)
- `decide(SUSPEND)` ปฏิเสธ PROVISIONING แบบไม่แยก source — L-C ตัดสินว่า Flow B ต้องการกติกาเดียวกันไหม
- **Flow B ยังไม่มีหน้าจอกู้แถวค้าง** (`LINE_ONLY_QUEUE_STATES` จำกัด PROVISIONING/PROVISIONING_FAILED/READY ไว้ที่ line-oa) — fence re-claim ทำงานเฉพาะเมื่อผู้สมัครเปิดลิงก์ claim ซ้ำ; L-C เลือกเปิดให้เว็บด้วยหรือทำ sweep
- `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` + ระบบแจ้งเตือน ops (§15.6) ยังไม่มีในโค้ด — ทำใน L-C พร้อมต่อ deploy.sh + grep contract ใน serving-mode spec
- SUSPEND UI สำหรับแถว COMPLETED ที่ auto-approve + แท็บ "อนุมัติอัตโนมัติ 14 วัน" (route `/system/signup-requests/auto-approved` มีแล้ว ไม่มีหน้าเว็บใช้)
- Test-fake (`line-signup-auto-free.integration.spec.ts`) ไม่มี row locking — เทสต์ที่พึ่ง blocking semantics ต้องใช้ Postgres จริง

**คำตอบจาก L-C (ลงแล้ว 23781780, 2026-09-05 — รอรีวิว):**

- ระงับแบบเจาะจง: ทำแล้วตามข้อแรก — `decide(SUSPEND)` ยังปฏิเสธ `PROVISIONING` ทุกกรณี ยกเว้น `staleProvisioning && companyId === null` (`companyId?` เพิ่มใน `AdminSignupQueueItemDto` แบบ additive) เพราะ stamp อยู่ในธุรกรรมเดียวกับการสร้างบริษัท → ไม่มี companyId = ไม่มีบริษัทให้ค้าง
- ขอบ `PROVISIONING → SUSPENDED`: **เก็บ** — กลับมาเรียกถึงได้ผ่านทางเดียวข้างบนเท่านั้น
- Flow B ใช้กติกาเดียวกัน (ไม่แยก source): ระงับระหว่างสร้างยังห้ามเหมือนเดิม
- **Flow B กู้แถวค้าง: ตัดสินใจ "ไม่สร้าง" ใน L-C** — เหตุผล: `REISSUABLE_STATES` = `EMAIL_PENDING | EMAIL_FAILED | EXPIRED` ทำให้ reissue 409 ที่ `PROVISIONING_FAILED`/`READY` และ `EMAIL_PENDING` ไม่ใช่ขอบที่ถูกกฎหมายจาก `PROVISIONING_FAILED` ในตาราง official-site; ผู้สมัครกู้เองไม่ได้เพราะ claim token ถูกใช้แล้ว (`usedAt`) — จะเปิดต้องเพิ่มขอบ transition หรือ action retry เฉพาะ Flow B (งานจริง ไม่ใช่สลับ flag) → นอกขอบเขต; ระหว่างนี้กู้ด้วยมือ (เปิดแถวใน DB ดูว่าครึ่งไหน commit แล้วปิดงานเอง); คาดความถี่ ≈ 0 เพราะ Flow B provision จาก claim page ใน request เดียว
- `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` + ops alerts: ทำแล้ว (`signup-ops-alert.service.ts`, 5 จุด: cap อัตโนมัติ, push 429, provisioning ล้ม, stale re-claim, งบ AI หมด ≥ N/วัน นับจาก sweep 15 นาที) ใช้ราง push แอดมินของ L-B, key = วัน Bangkok, ต่อ config + deploy.sh (ทั้งสอง env = 5) + grep contract (10 ตัวแปร) + pins
- SUSPEND UI สำหรับแถว COMPLETED + แท็บ "อนุมัติอัตโนมัติ 14 วัน" + แท็บ "คำขอเปลี่ยนแพ็กเกจ" (โหลดแบบ lazy, 403 ไม่ทำให้หน้าพัง): ทำแล้ว
- เพิ่มนอกคำสั่ง: `GET /system/partners/:partnerCompanyId/timeline` (คำนวณจากแถวที่มีอยู่ ไม่มีตารางใหม่; บรรทัด "ทำไม AI ปฏิเสธ" คำนวณจากสถานะปัจจุบัน), `POST …/line-message` (SEC-05), `POST …/plan-term/end-warmup`, ป้าย LINE ใน `/system/users`, "ลูกค้าใช้ LINE เท่านั้น" บนหน้า onboarding แอดมิน (A-04, console ส่ง boolean → `ownerAuth.kind = 'line-link-later'`); package-change APPROVE เรียก `SetCompanyPlanTermUseCase` ตัวเดิม (H-01: จุดเขียน tier จุดเดียว) ภายใต้ `system.partner_company.update`
- ค้าง Owner: ปุ่ม rich menu "เปิดร้านใหม่ ทดลองฟรี" (คำถามท้าย runbook rich menu)

## Slice L-C — admin + support + flags (web + infra)

**Branch** `codex/line-signup-c-admin`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| คิว | `apps/web/src/features/system-signup-requests/SignupQueuePage.tsx` (+ api) | ป้าย LINE, ชื่อ LINE, legalAcceptedAt, autoApproved filter, ปุ่มระงับ, toggle แจ้งตอน reject (default on), แท็บคำขอเปลี่ยนแพ็กเกจ |
| Partner page | `apps/web/src/features/system-partners/PartnerDetailPage.tsx` | Timeline ต่อร้าน; กล่อง "ส่งข้อความถึงร้าน" (confirm + audit); ปุ่ม "ตรวจแล้ว" ปลด warm-up |
| Users lookup | `system-partner-management/application/use-cases/lookup-users.use-case.ts` + `apps/web/src/features/system-users/*` | ค้นชื่อ LINE; แสดง LINE-only user |
| Flags/infra | **ย้ายไปทำใน L-A2 แล้ว (2026-09-05, รีวิว L-A2 F1):** `infra/prod-ecs-express/deploy.sh` ต่อ `LINE_SIGNUP_*` + `RECEIPT_QUOTA_ENFORCED` (UAT true / prod false + hard-stop) + pins re-sync — L-C เหลือแค่ตรวจว่าค่า UAT ตรง spec §10 | production-serving-mode.spec.sh ต้อง PASS |
| Docs | `docs/runbooks/line-first-signup-support-playbook.md` (4 ticket + กู้บัญชี 5 ขั้น), `docs/runbooks/line-rich-menu-v2-console-setup.md` (ปุ่ม "เปิดร้านใหม่ ทดลองฟรี" → LIFF signup URL) | Owner ทำ rich menu ใน console |
| UAT deploy | chain เดิม (PR → develop → main → deploy-uat `target=all`) | บันทึก run id ใน agent-memory |

**Tests:** web specs ตาม idiom เดิม (`.spec.ts`, renderToStaticMarkup + source assertions); E2E คิว/partner/users ที่มีอยู่ต้องไม่หัก; UAT script มือ 10 เคส (spec §11)

## Slice L-D — หน้าปัด (gate ก่อน AUTO_FREE บน prod)

**Branch** `codex/line-signup-d-dashboard`

- `system-partners/application/use-cases/line-signup-funnel.use-case.ts` (นับจาก audit `signup.line.*` + `AiUsageEvent` ต่อ company/monthKey) + หน้า `apps/web/app/system/line-signup/page.tsx` (`force-dynamic`)
- ตัวเลข: funnel 7 ขั้น, ต้นทุน AI ต่อร้าน (avg/p90), ร้านที่ชนโควตา/หมดอายุ/ขอเปลี่ยนแพ็กเกจ, push ที่ใช้เดือนนี้ (ประมาณจาก outbox)
- เกณฑ์เปิด AUTO_FREE: หน้าปัดขึ้น UAT + Owner ดูข้อมูล 2 สัปดาห์ของ MANUAL

## UAT rehearsals ที่ต้องทำด้วยมือ (จากรีวิว L-A/L-A2 2026-09-05 — เพิ่มใน test plan รอบแรก)

1. **ฆ่า task กลางทางหลัง commit** (ระหว่าง completeProvisioning กับ advance): รอ 3 นาที → แถวขึ้นชิป "เปิดร้านค้างอยู่" ในแท็บ มีปัญหา → กด ปิดงาน → ต้อง **adopt** (ร้านเดียว, companyId เดิม) → COMPLETED + audit `signup.provisioning.reclaimed_stale`/`finishedStrandedRow` → LINE บัญชีนั้นสมัครใหม่ไม่ติด 409
2. **ฆ่า task ก่อน commit**: ปิดงานต้อง**สร้าง**ร้าน และร้านต้องได้ term `FREE_TRIAL_15`/30 วัน + งบ AI 8000 (สองอย่างที่ระงับกลางทางจะทำหาย)
3. **กดอนุมัติซ้ำเร็วๆ** บนแถวเดียว: ร้านเดียว/attempt เดียว; toast ต้องบอกว่า "ยังเปิดร้านอยู่" ไม่ใช่ "ปิดงานเรียบร้อย"
4. **แอดมิน 2 คนกดแถวค้างเดียวกัน**: ร้านเดียว, COMPLETED เดียว
5. **จับเวลา provisioning จริงบน UAT** (end-to-end) เทียบ `STALE_PROVISIONING_MS`=180s — ถ้า p95 เกินครึ่ง ให้ขยาย
6. **ห้ามกด ระงับ บนแถว PROVISIONING** (ระบบต้องไม่มีปุ่มให้กดหลัง batch 6)
7. **Flow B ไม่ถดถอย**: สมัครเว็บ → อนุมัติ → เมล claim → ตั้งรหัส → ร้านเปิด; handoffUrl = `WEB_BASE_URL`; term = `PRO_999`/30 วัน (B-01 fix) ไม่ใช่ STARTER
8. **โควตา**: ร้านทดลองส่งใบที่ 16 ทาง LINE → การ์ดครั้งเดียว/เดือน + บรรทัด "อ่านครั้งที่ n จาก 15"; เว็บ → แบนเนอร์ค้าง ปุ่มปิด ลิงก์ 2 อัน; provider ล้ม 1 ครั้งแล้ว retry = นับ 1; แพ็กเกจจ่ายเงินได้ข้อความไม่มีคำว่า "ทดลอง"
9. **เพิ่มร้านที่ 2 จาก LINE ที่มีบัญชีแล้ว**: ได้ร้านเดียวเพิ่ม, LineCompanyContext ชี้ร้านใหม่, ใบเสร็จแรกเข้าร้านใหม่
10. **`WEB_BASE_URL`** ต้องมีในทุก env ที่เปิด LIFF (ไม่มี = สมัคร 503 และหน้าเปิดบริษัทใหม่ 503 — ตั้งใจ)
11. **กดครบ 3 ประตูของการ์ดต้อนรับบนมือถือจริง** — ประตู 3 ("มีบัญชีอยู่แล้ว เชื่อม LINE") ต้องพาไปหน้า login เว็บใน Safari/Chrome แล้วเชื่อมได้ (บั๊กเดิม: หน้าเก่า error อังกฤษ)
12. **พิมพ์ "ติดต่อเจ้าหน้าที่" จาก LINE ที่ยังไม่ผูกบัญชี** → แอดมินต้องได้รับแจ้งทาง LINE จริง; พิมพ์ซ้ำ 3 ครั้ง → แอดมินได้แจ้งครั้งเดียว; และปุ่มนี้ต้องมีบนการ์ดติดต่อ/การ์ดประตู
13. **ใช้งบ AI ของร้านทดลองจนหมดแล้วทักมา** → ต้องได้การ์ด "โควตา AI ครบ" พร้อมปุ่ม ไม่ใช่ "กำลังประมวลผลข้อความก่อนหน้า" และไม่มีงานค้างให้ worker retry
14. **ออกข้อกำหนดเวอร์ชันใหม่ระหว่างที่หน้า LIFF สมัครเปิดค้าง** แล้วกดส่ง → ต้องได้ข้อความให้โหลดใหม่ (409) และหน้าที่เปิดใหม่สมัครผ่าน
15. **กด "ปิด" บนหน้า LIFF** ทั้งสถานะสำเร็จและรอ → หน้าต้องปิดจริง
16. **อนุมัติร้านตอน OA โดน 429** (จำลอง) → push "พร้อมใช้" ต้องมาถึงเมื่อพ้นช่วง ไม่ตายถาวร
17. **ลูกค้าที่ใช้แต่เว็บ (Flow B) เปิดแจ้งเตือน P29 เหลือ 7 วัน** → ประโยคสุดท้ายต้องไม่บอกให้พิมพ์ในแชท LINE
18. **สมัครซ้ำนอกเวลาทำการทั้งที่มีคำขอค้าง** → หน้าสถานะต้องบอกชื่อร้านและ "นอกเวลาทำการ"
19. **เจ้าของร้านจาก LINE ครบวงจร**: สมัคร LIFF → dashboard → การ์ดเช็คลิสต์ → หน้าข้อมูลร้าน → ตั้งรหัสผ่านสำรอง (ต้องถูกบังคับให้ตั้งชื่อผู้ใช้เมื่อยังไม่มีอีเมล) → **ออกจากระบบแล้วล็อกอินบนคอมด้วยรหัสนั้น**
20. **กรอกเฉพาะเลขผู้เสียภาษี**บนร้านที่ยังไม่มีที่อยู่ แล้วกดบันทึก → ต้องบันทึกได้ ไม่ใช่ 422
21. เปิด `/settings/profile` ด้วยบทบาท FINANCE และ MANAGER → ปุ่ม/dropdown เขียนต้องปิดพร้อมคำอธิบาย และเห็นบล็อกข้อมูลร้านแบบปิดบัง (เลขภาษี 4 ตัวท้าย/จังหวัด)
22. **ตั้งอีเมลแล้วกดลิงก์ยืนยัน** → LINE ของเจ้าของต้องได้รับข้อความแจ้ง และ session LINE เดิมยังใช้ได้; ตั้งรหัสผ่านครั้งแรก → session อื่นถูกตัด
23. ใส่เบอร์ `081-234-5678` และเว้นว่าง → ผลตาม validator; อ่านกลับจาก `GET /auth/account/security`
24. ขอตั้งอีเมลที่บัญชีอื่นถือ → ข้อความ "รวมบัญชี" + ลิงก์ `/login`
25. เจ้าของที่ยังไม่ยอมรับข้อกำหนดเปิดหน้าจากเมนูตั้งค่า → redirect สะอาด ไม่ใช่จอตาย
26. **ลิงก์ "ใส่เลย" จากการ์ดกันหลุดวันที่ 7** ต้องลงที่ `/companies/<id>/settings/profile#account` ไม่ใช่ dashboard
27. (จากรีวิว L-B รอบ 2) กดครบ 4 ปุ่มบนการ์ดประตูบนมือถือจริง — ประตู 3 ต้องถึง `/login` ใน Safari/Chrome พร้อมแบนเนอร์ "ต้องเชื่อม LINE" และล็อกอินด้วยรหัสผ่าน 1 ครั้งต้องจบการเชื่อม LINE
28. พิมพ์ "ติดต่อเจ้าหน้าที่" จากบัญชีที่ยังไม่ผูก → LINE ของแอดมินได้ลิงก์คิว; ส่งซ้ำอีก 2 ครั้งในวันเดียว → แจ้งครั้งเดียวเท่านั้น
29. ทำให้ OA โดนโควตาข้อความ (หรือบังคับ 429) รอบการอนุมัติ → push "พร้อมใช้" ต้องมาถึงหลังพ้นช่วง ไม่ตาย; และดูว่าแอดมินเห็นแถวที่ค้างอยู่ได้อย่างไรระหว่างนั้น (ช่องโหว่ observability ที่รีวิวชี้ — แก้ในชุด L-C)
30. เปิดแจ้งเตือน P29 เหลือ 7 วันของบริษัท Flow B (เว็บอย่างเดียว) → ไม่มีประโยค LINE; ทำซ้ำกับร้านที่ผูก LINE → ต้องมี
31. ลูกค้าเดิมเพิ่มเพื่อน OA ซ้ำ → ข้อความต้อนรับกลับ ไม่มีประตูสมัคร
32. (จากรีวิว L-C) แอดมิน 2 คนบนแถวค้างเดียวกันใน "มีปัญหา": คนหนึ่งกดลองใหม่ อีกคนกดระงับภายใน 3 นาที → ต้องมีบริษัทเดียว และแถวต้องไม่กลายเป็น SUSPENDED ทั้งที่มีบริษัท
33. ยิงรั้วลิงก์ผ่านกล่องข้อความจริง: `https://app.mangmeeplus.com:x@evil.test/pay` และ `http://203.0.113.9/pay` → ต้องถูกปฏิเสธทั้งคู่; ใส่ลิงก์ในหมายเหตุตอนอนุมัติเปลี่ยนแพ็กเกจ → ต้องถูกปฏิเสธและหมายเหตุอยู่ใน audit
34. ขับ alert ทั้ง 5 เงื่อนไขจริง (cap อัตโนมัติ, 429 จาก OA, provisioning ล้ม, fence เก่า, งบ AI หมดเกินเกณฑ์) → 1 การแจ้งเตือนบนหน้าปัด + 1 push ต่อเงื่อนไขต่อวัน
35. A-04: เปิดร้านแบบ "ลูกค้าใช้ LINE เท่านั้น" → ไม่มี username/รหัสชั่วคราวใน response และ UI, สแกน QR แล้ว identity จึงปรากฏ
36. (จากรีวิว L-E รอบ 2) ตั้งชื่อผู้ใช้ที่มี `_` ขณะที่มีชื่อใกล้เคียง (เช่น มี `somchai` อยู่แล้ว ตั้ง `som_hai`) → ต้อง**ผ่าน**; ชื่อซ้ำต่างตัวพิมพ์ → ปฏิเสธ; ชื่อไทย → ข้อความบอกกติกาเป็นภาษาไทย
37. บันทึกข้อมูลกฎหมาย/VAT เวลา 01:00 น. ไทย → `effectiveFrom` ต้องเป็นวันที่ไทย ไม่ใช่วันก่อนหน้า
38. การ์ดเช็คลิสต์ → หน้าข้อมูลร้าน → กรอกเลขภาษี → กลับหน้าปัด: รายการต้องหายทันที; กด "ไว้ก่อน" ปิดแท็บแล้วเปิดใหม่ → ยังซ่อนอยู่ 7 วัน
40. (จากรีวิว L-E รอบ 3) พิมพ์ชื่อผู้ใช้เป็นภาษาไทย `สมชาย` → ประโยคบอกกติกาภาษาไทยต้องขึ้น**ก่อน**ยิง request; ถ้าข้ามฝั่ง client ต้องได้ประโยคเดียวกันจาก API
41. แอดมินสร้างพนักงานชื่อผู้ใช้ `SomChai` (ทางนั้นเก็บตัวพิมพ์ผสม) แล้วเจ้าของร้าน LINE ตั้ง `somchai` → ต้องถูกปฏิเสธ
42. (จากรีวิว L-C รอบ 2) ส่ง `https://app.mangmeeplus.com/x"https://evil.test/pay` (ลิงก์สองอันติดกันไม่มีช่องว่าง) จากกล่องข้อความและจากหมายเหตุเปลี่ยนแพ็กเกจ → ต้องถูกปฏิเสธ; แล้วดูในแชท LINE จริงว่า render กี่ลิงก์
43. หาแถว PROVISIONING ค้างเกิน 3 นาทีที่ยังไม่มีบริษัท → คิวต้องมีปุ่ม ระงับ (เจาะจง) และแถวที่มีบริษัทแล้ว/READY ต้องไม่มี
44. สมัครร้านที่สองจากบัญชี LINE ที่มีร้านแล้วโดยกรอกเบอร์ (ร้านแรกไม่กรอก) → `User.phoneNumber` ต้องถูกตั้ง และคำขอที่สามด้วยเบอร์เดิมต้องขึ้นเตือนเบอร์ซ้ำในคิว
45. ข้อจำกัดที่ยอมรับแล้ว (รอ Owner รับทราบ): โดเมนสากลแบบไม่มี scheme (`мангми.рф/pay`) ผ่านรั้วลิงก์ได้ เพราะกฎที่เข้มกว่าจะปฏิเสธข้อความไทยปกติ; alert `line_push_stuck` จะแจ้งทุกวันจนกว่าแถวค้างจะถูกเคลียร์
39. (จาก local drive) พิมพ์ "ติดต่อเจ้าหน้าที่" แล้วพิมพ์ "ขอเปลี่ยนแพ็กเกจ" ต่อทันที → ต้องได้การ์ด/คำขอเปลี่ยนแพ็กเกจ ไม่ใช่ "ทีมงานรับเรื่องแล้ว" ซ้ำ; เบอร์ที่กรอกตอนสมัครต้องโผล่ในหน้าข้อมูลร้าน/บัญชี

**ลำดับก่อน UAT (คำสั่ง Owner 2026-09-05 "ทำให้เสร็จ ทดสอบใน local ก่อน ยังไม่ต้อง deploy UAT"):** ทำทุก slice ให้จบรีวิว → รวมกิ่ง → ยก stack local (docker postgres :15432 + api + web + workers) แล้วไล่เคสข้างบนเท่าที่ทำได้โดยไม่มี LINE จริง (ยิง endpoint ตรง, หน้าเว็บผ่าน browser) พร้อมหลักฐาน → ค่อย PR develop+main → รอ Owner สั่ง deploy UAT

## Rollout

1. L-A → L-B → L-C ขึ้น UAT (flag on, MANUAL) → Owner ทดสอบ 10 เคส → แก้รอบ
2. Owner สั่ง promote production พร้อม `LINE_SIGNUP_ENABLED=false` (โค้ดขึ้นก่อน สวิตช์ปิด) → วันเปิดจริงเปลี่ยน deploy.sh default + pins + deploy (Owner order)
3. 2 สัปดาห์ MANUAL บน prod + L-D ขึ้น → Owner สลับ `AUTO_FREE`
4. ทุกขั้นตามโปรโตคอล `docs/runbooks/uat-production-v2-deployment.md` (บันทึก run id, ห้ามยิง run ซ้ำ)

## ความเสี่ยงที่รู้แล้ว

- LIFF ทดสอบอัตโนมัติไม่ได้ → พึ่ง UAT มือ; ลดความเสี่ยงด้วยการยิง endpoint ตรงใน E2E
- `create-company-onboarding.use-case.ts` เป็นธุรกรรมใหญ่ (สร้าง 10 อย่าง) — เพิ่ม `ownerAuth` แบบ additive และ test เส้น password เดิมต้องเหมือนเดิม byte-for-byte
- โควตา push ของ OA ที่ ~80 สมัคร/เดือน — ต้องมีตัวนับใน L-D ก่อนจะรู้ว่าเมื่อไรต้องอัปแผน
- P29 ladder ส่งทาง LINE ให้ OWNER อยู่แล้ว — ห้ามส่งซ้ำจาก L-B (ตรวจ eventKey)
