# Implementation Plan — LINE-first Signup (P10-L)

สถานะ: **DRAFT 2026-09-04** — คู่กับ spec v3 [mangmee-line-first-signup-spec-th.md](../specs/mangmee-line-first-signup-spec-th.md); เริ่ม Slice L-A เมื่อ Owner สั่ง (หลังเห็นตัวเลขต้นทุนต่อใบ)
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
| Submit / status use-cases | `external-signup/application/submit-line-signup.use-case.ts`, `get-line-signup-status.use-case.ts` (ใหม่) | dedupe 1 open/LINE, attachUserId เมื่อ identity ACTIVE, AUTO_FREE → provisioning ทันที + daily cap, audit `signup.line.*`, `adminNotify.enqueue` เมื่อ MANUAL |
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

## Slice L-C — admin + support + flags (web + infra)

**Branch** `codex/line-signup-c-admin`

| งาน | ไฟล์หลัก | หมายเหตุ |
|---|---|---|
| คิว | `apps/web/src/features/system-signup-requests/SignupQueuePage.tsx` (+ api) | ป้าย LINE, ชื่อ LINE, legalAcceptedAt, autoApproved filter, ปุ่มระงับ, toggle แจ้งตอน reject (default on), แท็บคำขอเปลี่ยนแพ็กเกจ |
| Partner page | `apps/web/src/features/system-partners/PartnerDetailPage.tsx` | Timeline ต่อร้าน; กล่อง "ส่งข้อความถึงร้าน" (confirm + audit); ปุ่ม "ตรวจแล้ว" ปลด warm-up |
| Users lookup | `system-partner-management/application/use-cases/lookup-users.use-case.ts` + `apps/web/src/features/system-users/*` | ค้นชื่อ LINE; แสดง LINE-only user |
| Flags/infra | `infra/prod-ecs-express/deploy.sh` (LINE_SIGNUP_* defaults UAT/prod + prod hard-stop เมื่อ `LINE_SIGNUP_ENABLED=true`), `infra/security/sync-production-maintenance-release-pins.mjs` re-sync | production-serving-mode.spec.sh ต้อง PASS |
| Docs | `docs/runbooks/line-first-signup-support-playbook.md` (4 ticket + กู้บัญชี 5 ขั้น), `docs/runbooks/line-rich-menu-v2-console-setup.md` (ปุ่ม "เปิดร้านใหม่ ทดลองฟรี" → LIFF signup URL) | Owner ทำ rich menu ใน console |
| UAT deploy | chain เดิม (PR → develop → main → deploy-uat `target=all`) | บันทึก run id ใน agent-memory |

**Tests:** web specs ตาม idiom เดิม (`.spec.ts`, renderToStaticMarkup + source assertions); E2E คิว/partner/users ที่มีอยู่ต้องไม่หัก; UAT script มือ 10 เคส (spec §11)

## Slice L-D — หน้าปัด (gate ก่อน AUTO_FREE บน prod)

**Branch** `codex/line-signup-d-dashboard`

- `system-partners/application/use-cases/line-signup-funnel.use-case.ts` (นับจาก audit `signup.line.*` + `AiUsageEvent` ต่อ company/monthKey) + หน้า `apps/web/app/system/line-signup/page.tsx` (`force-dynamic`)
- ตัวเลข: funnel 7 ขั้น, ต้นทุน AI ต่อร้าน (avg/p90), ร้านที่ชนโควตา/หมดอายุ/ขอเปลี่ยนแพ็กเกจ, push ที่ใช้เดือนนี้ (ประมาณจาก outbox)
- เกณฑ์เปิด AUTO_FREE: หน้าปัดขึ้น UAT + Owner ดูข้อมูล 2 สัปดาห์ของ MANUAL

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
