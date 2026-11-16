# 02a — Software Requirements Specification: Core Platform (CORE)

**วัตถุประสงค์** เอกสารนี้เป็นข้อกำหนดซอฟต์แวร์ (SRS) ของ "แพลตฟอร์มแกนกลาง" ของ MangmeePlus / WatchDog-BMS ซึ่งเป็นฐานที่ทุกแพ็กเกจที่ขาย (FREE_TRIAL_15 ถึง ENTERPRISE_1999) ต้องใช้ร่วมกัน ได้แก่ การยืนยันตัวตนและ session, การควบคุมสิทธิ์ (RBAC/ABAC), พนักงานและบทบาท, การสมัครเปิดร้านและ onboarding, ข้อมูลหลักของบริษัท (บริษัท สาขา ตัวตนทางภาษี ไฟล์แนบ เลขที่เอกสาร), audit log, เคสสิทธิ์เจ้าของข้อมูล (PDPA), แดชบอร์ดและการแจ้งเตือน, ระบบ launch gate / entitlement ขณะรัน, health, ธีมหน้าแรกสาธารณะ, การกระทบยอดตัวตนภาษีของระบบ, โค้ดร่วม `apps/api/src/common` และ web shell ทุกข้อเขียนจากโค้ดจริงเพื่อให้ทีมในอนาคตเข้าใจ สร้างใหม่ และดูแลระบบได้จากเอกสารนี้ร่วมกับโค้ดที่เก็บถาวร

**ที่มา** checkout `closeout-docs-main` ของ `origin/main` commit `08850deaf` (2026-11-10) โค้ดคือความจริง เอกสารใน `docs/` ใช้ประกอบเจตนาเท่านั้น

**รหัสพื้นที่ (AREA)** `CORE` — ข้อกำหนดเชิงหน้าที่ใช้ `FR-CORE-<nnn>` ข้อกำหนดที่ไม่ใช่เชิงหน้าที่ใช้ `NFR-<nnn>`

## สารบัญ

1. [ขอบเขต คำย่อ และแพ็กเกจ](#1-ขอบเขต-คำย่อ-และแพ็กเกจ)
2. [ลำดับการตรวจคำขอ (request pipeline)](#2-ลำดับการตรวจคำขอ-request-pipeline)
3. [Authentication และ session (`auth`)](#3-authentication-และ-session-auth) — FR-CORE-001 … 026
4. [Access control (`access-control`)](#4-access-control-access-control) — FR-CORE-030 … 036
5. [พนักงานและบทบาท (`employee-access`)](#5-พนักงานและบทบาท-employee-access) — FR-CORE-040 … 050
6. [การสมัครเปิดร้าน (`external-signup`)](#6-การสมัครเปิดร้าน-external-signup) — FR-CORE-051 … 059
7. [Onboarding โดยผู้ดูแลระบบ (`system-onboarding`)](#7-onboarding-โดยผู้ดูแลระบบ-system-onboarding) — FR-CORE-060 … 061
8. [ข้อมูลหลัก (`data-model-core`)](#8-ข้อมูลหลัก-data-model-core) — FR-CORE-062 … 070
9. [Audit (`audit`)](#9-audit-audit) — FR-CORE-071 … 072
10. [สิทธิ์เจ้าของข้อมูล (`data-rights`)](#10-สิทธิ์เจ้าของข้อมูล-data-rights) — FR-CORE-073
11. [แดชบอร์ดและการแจ้งเตือน (`dashboard-notifications`)](#11-แดชบอร์ดและการแจ้งเตือน-dashboard-notifications) — FR-CORE-074 … 080
12. [Launch gate และ entitlement ขณะรัน (`feature-launch`)](#12-launch-gate-และ-entitlement-ขณะรัน-feature-launch) — FR-CORE-081 … 084
13. [Health, ธีมหน้าแรก, กระทบยอดตัวตนภาษี](#13-health-ธีมหน้าแรก-กระทบยอดตัวตนภาษี) — FR-CORE-085 … 087
14. [โค้ดร่วม `apps/api/src/common`](#14-โค้ดร่วม-appsapisrccommon) — FR-CORE-088 … 092
15. [Web shell](#15-web-shell) — FR-CORE-093 … 099
16. [ข้อกำหนดที่ไม่ใช่เชิงหน้าที่ (NFR)](#16-ข้อกำหนดที่ไม่ใช่เชิงหน้าที่-nfr)
17. [แค็ตตาล็อก permission key](#17-แค็ตตาล็อก-permission-key)
18. [ตาราง role → permission](#18-ตาราง-role--permission)
19. [Prisma models ของพื้นที่ CORE](#19-prisma-models-ของพื้นที่-core)
20. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#20-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
21. [สิ่งที่ยืนยันไม่ได้ และสิ่งที่มีใน docs แต่ไม่พบในโค้ด](#21-สิ่งที่ยืนยันไม่ได้-และสิ่งที่มีใน-docs-แต่ไม่พบในโค้ด)

---

## 1. ขอบเขต คำย่อ และแพ็กเกจ

### 1.1 โมดูลที่ครอบคลุม

| โมดูล API (`apps/api/src/modules/…`) | เนื้อหา | หัวข้อ |
|---|---|---|
| `auth` | password login, LINE Login, LIFF, handoff token, email OTP, session, legal acceptance, platform access, LINE webhook, อีเมลระบบ | §3 |
| `access-control` | permission resolver, policy (tenant/own-record), plan-manager | §4 |
| `employee-access` | พนักงาน บทบาท capability pack, role template, access matrix, entitlement normalization | §5 |
| `external-signup` | สมัครเปิดร้านจากเว็บ / LINE / อีเมล, คิวอนุมัติ, claim link, คำขอเปลี่ยนแพ็กเกจ, กล่องคำขอความช่วยเหลือ | §6 |
| `system-onboarding` | ผู้ดูแลระบบเปิดร้านให้ลูกค้า | §7 |
| `data-model-core` | สาขา ตัวตนบริษัท VAT ไฟล์แนบ เลขที่เอกสาร outbox | §8 |
| `audit` | บันทึกและอ่าน audit log | §9 |
| `data-rights` | เคส PDPA | §10 |
| `dashboard-notifications` | แดชบอร์ด ศูนย์แจ้งเตือน | §11 |
| `feature-launch` | launch gate, execution attempt, runoff | §12 |
| `health`, `public-home-theme`, `system-identity-reconciliation` | | §13 |
| `apps/api/src/common` | guard, rate limit, logger, pipe, filter | §14 |
| `apps/web` (shell) | proxy, BFF auth, layout, เมนู, หน้า public | §15 |

### 1.2 แพ็กเกจและคำย่อที่ใช้ในช่อง "แพ็กที่ได้ใช้"

แพ็กเกจกำหนดใน `packages/contracts/src/plan-term.ts` (`PlanTierKey`, `PLAN_TIER_PRESETS`) และฟีเจอร์ของแต่ละแพ็กกำหนดใน `packages/contracts/src/menu-entitlements.ts` (`TIER_FEATURE_PRESETS`, `FEATURE_PACKAGE_PRESETS.starter`)

| แพ็ก | สาขาสูงสุด | พนักงานสูงสุด | สลิป/เดือน | feature keys |
|---|---|---|---|---|
| `FREE_TRIAL_15` | 1 | 2 | 15 | starter preset (seed ตอน onboarding — `create-company-onboarding.use-case.ts` "Omitted or 'starter' seeds the 7-menu starter preset") |
| `STARTER_249` | 1 | 2 | 30 | starter preset |
| `BASIC_499` | 2 | 5 | 50 | starter preset |
| `PRO_999` | 5 | 10 | 100 | starter preset |
| `ENTERPRISE_1999` | 10 | 30 | 500 | starter preset + `wht_pnd53`, `wht_50bis` |

starter preset = `dashboard_notifications`, `expenses` (+ `.list/.upload/.manual/.categories/.evidence/.signatures`), `reimbursement`, `ai_line_assistant`, `employee_access` (+ `.employees/.roles/.overview`), `company_settings` (+ `.branches/.security`)

คำย่อ:

- **[ALL]** = ใช้ได้ทุกแพ็ก (FREE_TRIAL_15, STARTER_249, BASIC_499, PRO_999, ENTERPRISE_1999) เพราะเป็นฐานแพลตฟอร์มที่ไม่ผูกกับ feature key ใด หรือผูกกับ `employee_access` / `company_settings` ซึ่งเป็น `PLATFORM_INVARIANT_FEATURE_KEYS` (เปิดเสมอ ปิดไม่ได้ — `packages/contracts/src/feature-entitlements.ts:607`)
- **[ALL-DN]** = ทุกแพ็ก ผ่าน feature key `dashboard_notifications` ที่อยู่ใน starter preset (ปิดได้รายบริษัทโดยผู้ดูแลระบบ; เมื่อปิด permission `dashboard.*` / `notification.*` ถูกตัดออก)
- **[PLATFORM]** = เครื่องมือของทีมมั่งมี (role `SYSTEM_ADMIN` ใน platform tenant) ไม่ใช่สิทธิ์ของร้าน ใช้เพื่อขายและดูแลทุกแพ็ก
- **[PUBLIC]** = ไม่ต้องล็อกอิน ใช้ก่อนมีแพ็ก

หมายเหตุเรื่อง "free expense drafts": บริษัท `FREE_TRIAL_15` ที่เข้าเงื่อนไข `isFreeExpenseDraftCompany` (โมดูล `system-partner-management`) จะได้ permission ชุดแคบ (`freeExpenseDraftPermissions`) และ `AuthGuard` ปฏิเสธเส้นทางอื่นด้วย `FREE_EXPENSE_DRAFTS_ONLY` รายละเอียดอยู่ในเอกสารพื้นที่ billing/partner; ที่นี่บันทึกเฉพาะจุดบังคับใช้ใน guard (§2)

### 1.3 แบบแผนทั่วไปของ API

- prefix `/v1` ทุกเส้นทาง ยกเว้น `local-storage/*` (`apps/api/src/main.ts`)
- เส้นทางของร้านอยู่ใต้ `/v1/companies/:companyId/…`; เส้นทางผู้ดูแลระบบอยู่ใต้ `/v1/system/…` และจงใจไม่ใช้ชื่อพารามิเตอร์ `companyId` (ใช้ `partnerCompanyId`, `requestId` ฯลฯ) เพราะ `AuthGuard` ตีความ `:companyId` เป็นบริษัทของผู้เรียก
- เส้นทาง worker อยู่ใต้ `/v1/internal/…` เป็น `@Public()` และตรวจ header `x-worker-token` (§14 FR-CORE-089)
- ทุก controller ที่ไม่ใช่ `@Public()` ต้องมี `@RequirePermissions(...)` (AND) หรือ `@RequireAnyPermission(...)` (OR) มิฉะนั้นถูกปฏิเสธ 403 `Permission metadata is required.` (§4 FR-CORE-030)

---

## 2. ลำดับการตรวจคำขอ (request pipeline)

ลำดับจริงตามโค้ด (`apps/api/src/main.ts`, `apps/api/src/app.module.ts`, `apps/api/src/common/security/security.module.ts`, `apps/api/src/modules/auth/presentation/auth.guard.ts`, `apps/api/src/common/security/deny-by-default.guard.ts`):

1. Express: `apiCacheControl` (ตั้ง `Cache-Control: private, no-store, max-age=0` เป็นค่าเริ่มต้น) → `helmet` (CSP เปิดใน production) → `cookieParser` → body parser (`HTTP_BODY_LIMIT` ค่าเริ่มต้น `1mb`, `inflate:false`, เก็บ `rawBody`) → CORS (allow-list `CORS_ALLOWED_ORIGINS`, `credentials:true`, header ที่อนุญาต `Authorization, Content-Type, X-Company-Id, X-Request-Id`)
2. Middleware: `RequestIdMiddleware` → `RequestLoggerMiddleware` (ทุกเส้นทาง)
3. Global guard ที่ติดใน `main.ts`: `ApiRateLimitGuard` (ถัง `api-ip` ต่อ IP; ยกเว้น `/health`, `/v1/health`)
4. `APP_GUARD` ลำดับที่ 1 — `AuthGuard`:
   1. เส้นทาง `@Public()` ที่เป็น `/v1/health`, `/v1/internal/health/readiness`, ทุก `/v1/internal/*`, และ `POST /v1/public/(stripe-events|postmark-events)` ผ่านเสมอ
   2. อ่านสถานะ platform access; ถ้า `effectiveState = CLOSED` เส้นทาง public ผ่านได้เฉพาะ `CLOSED_PUBLIC_PATHS` (platform-access, login-channels, password/login, line/login/callback, line/qr/create, line/qr/redeem, session/refresh) ที่เหลือตอบ 503 `platform_access_closed`
   3. อ่าน token จาก `Authorization: Bearer` ก่อน แล้ว fallback cookie `watchdog_token` (รองรับ cookie แบบแบ่งชิ้น) — ไม่มี = 401
   4. ตรวจ JWT ด้วย `WatchdogJwtVerifierAdapter` (HS256, iss/aud) ; นอก production ลอง `DevJwtVerifierAdapter`
   5. ต้องมี claim `sid`; ค้น `AuthSession` ตาม `tokenId` ต้อง `ACTIVE`, เป็นของ subject, ยังไม่หมดอายุ — มิฉะนั้น 401
   6. session ประเภท `demo` ถูกบังคับให้ใช้ `demoCompanyId` เท่านั้น
   7. header `X-Company-Id` กับ `:companyId` ใน URL ต้องตรงกันถ้ามีทั้งคู่ (403 `Route company does not match request context.`)
   8. `ResolveRequestContextUseCase` → `PermissionResolverService` สร้าง `RequestContext` (roles, permissions, scopes.branchIds, entitledFeatureKeys ฯลฯ)
   9. ถ้า platform CLOSED และผู้ใช้ไม่ใช่ `SYSTEM_ADMIN` → 503
   10. ถ้า credential มี `mustChangePassword` และ session ไม่ใช่แบบ `line` และเส้นทางไม่ขึ้นต้น `/v1/auth/` → 403 `Password change required before accessing business modules.`
   11. ตรวจอายุแพ็ก: `CompanyPlanTerm.termEndsAt <= now` → 403 `company_term_expired` ยกเว้น `/v1/auth/*`, `/v1/plan-term/notice`, เส้นทางกู้คืน billing (`isBillingRecoveryRoute`), เส้นทางกู้คืนโปรไฟล์บริษัท (`isCompanyProfileRecoveryRoute` + ต้องมี permission ที่ตรง), และ `SYSTEM_ADMIN`
   12. ตรวจ legal acceptance: ถ้ายังไม่ยอมรับเอกสารฉบับปัจจุบัน → 403 `legal_acceptance_required` ยกเว้น `/v1/auth/me`, `/v1/auth/legal-acceptance`, `/v1/auth/password/change`, `/v1/auth/logout`, `/v1/auth/line/qr/approve`
   13. บริษัทโหมด free-expense-drafts: เส้นทางนอกชุดที่อนุญาต → 403 `FREE_EXPENSE_DRAFTS_ONLY`
5. `APP_GUARD` ลำดับที่ 2 — `DenyByDefaultGuard` ตรวจ permission metadata กับ `RequestContext.permissions`
6. Pipe: `TrimStringsPipe` → `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)
7. Controller → use case (ตรวจ `assertRouteCompany`, branch scope, กฎธุรกิจ) → `AllExceptionsFilter`

---

## 3. Authentication และ session (`auth`)

ไฟล์หลัก: `apps/api/src/modules/auth/presentation/auth.controller.ts`, `account-email-otp.controller.ts`, `email-password-reset.controller.ts`, `platform-access.controller.ts`, `line-webhook.controller.ts`, `line-official-webhook.controller.ts`, `postmark-events.controller.ts`, `system-email-delivery.controller.ts`; use case ใน `application/use-cases/`; ตรรกะบริสุทธิ์ใน `domain/logic/`

ไม่มี MFA/TOTP ในโค้ด (ค้น `totp|mfa|two-factor` ในโมดูล `auth` ไม่พบ) การยืนยันซ้ำ (re-authentication) ที่มีคือ รหัสผ่านปัจจุบัน, email OTP, และ LINE reauth (FR-CORE-017, 018)

### FR-CORE-001 ค้นหาช่องทางเข้าสู่ระบบ

- **คำอธิบาย** หน้า login ถาม API ว่าช่องทางใดเปิดใช้ ช่องทางที่ยังไม่พร้อมตอบแบบ fail-closed
- **ผู้ใช้/สิทธิ์** ทุกคน (`@Public()`)
- **แพ็ก** [PUBLIC]
- **เงื่อนไขก่อนทำ** ไม่มี
- **ขั้นตอนหลัก** `GET /v1/auth/login-channels` → `loginChannelAvailability(config)` คืน `{ password:{available:true}, phoneOtp:{available:false, reason:'deferred_to_future_release'}, line:{available, channelId} }`
- **กฎ/ข้อยกเว้น** LINE พร้อมเมื่อ `LINE_WEB_LOGIN_ENABLED` และมี `lineLoginChannelId` + `lineLoginChannelSecret` ครบ; phone OTP ไม่เปิดเสมอ
- **ข้อผิดพลาด** ไม่มีเฉพาะ
- **ข้อมูล** ไม่มี (อ่าน config)
- **API** `GET /v1/auth/login-channels`
- **หน้าจอ** `/login` (`apps/web/src/features/auth/LoginPage.tsx`), BFF `GET /api/auth/line-login/availability`
- **การทดสอบ** `domain/logic/login-channel.logic.spec.ts`, `e2e/login.spec.ts`

### FR-CORE-002 เข้าสู่ระบบด้วยชื่อผู้ใช้/อีเมลและรหัสผ่าน

- **คำอธิบาย** ล็อกอินด้วย `username` หรือ `email` กับรหัสผ่าน รับ access/refresh token และเส้นทางปลายทาง
- **ผู้ใช้/สิทธิ์** ผู้ใช้ที่มี `UserCredential`; `@Public()`
- **แพ็ก** [ALL] (ล็อกอินได้แม้แพ็กหมดอายุแบบ term-disabled เพื่อเข้าหน้าต่ออายุ)
- **เงื่อนไขก่อนทำ** `User.status = ACTIVE`, credential ไม่ `DISABLED`, มี membership `ACTIVE` ในบริษัท `ACTIVE` (หรือบริษัท `DISABLED` ที่ `planTerm.termDisabledAt` ไม่ว่าง)
- **ขั้นตอนหลัก**
  1. ตรวจถัง rate limit (ไม่กินโควตา): `password-login-identifier-ip` และ `password-login-ip`
  2. ค้นผู้ใช้ด้วย `username = trimmed` หรือ `email = lower(trimmed)`
  3. ตรวจรหัสผ่านด้วย scrypt (`scrypt$<salt>$<hash>`, 64 ไบต์, เทียบแบบ `timingSafeEqual`); ผู้ใช้ที่ไม่มีก็จ่ายค่า scrypt หนึ่งครั้งกับ `DUMMY_PASSWORD_HASH`
  4. ถ้ารหัสผ่านมีรูป `^[A-Za-z0-9_-]{12}$` จะค้น `PasswordResetToken` (รหัสกู้คืนทาง LINE — FR-CORE-003) เสมอ ทั้งผู้ใช้ที่มีและไม่มี
  5. เลือก membership (บริษัท ACTIVE เก่าสุดก่อน แล้วจึงบริษัท term-disabled)
  6. ตรวจ platform access (CLOSED อนุญาตเฉพาะ `SYSTEM_ADMIN`)
  7. ถ้าเข้าด้วยรหัสกู้คืน: ใน transaction เดียว lock `UserCredential`, claim token `PENDING→USED`, ตั้ง credential เป็น `TEMPORARY` + `mustChangePassword` + หมดอายุ 30 นาที, revoke ทุก session, เขียน audit `auth.password.reset_confirm`
  8. `IssueTokenUseCase.execute(userId, 'watchdog', credentialUpdatedAt)` (FR-CORE-007)
  9. คืน `{accessToken, refreshToken, expiresIn, passwordChangeRequired, companyId, redirectPath, legalAcceptanceRequired}`; `redirectPath` = `/system/partners` สำหรับ `SYSTEM_ADMIN`, `/companies/<id>/dashboard` (หรือ `/expenses` สำหรับ free-expense-drafts)
- **กฎ/ข้อยกเว้น** นับเฉพาะความล้มเหลวเข้าถัง rate limit (`recordPasswordLoginFailure`); ล็อกอินสำเร็จไม่กินโควตา; ค่าเริ่มต้น 5 ครั้ง/identifier+IP และ 20 ครั้ง/IP ต่อ 900 วินาที (`packages/config/src/index.ts:409-411`)
- **ข้อผิดพลาด** 401 `Invalid username or password.`; 403 `Temporary password has expired.`; 403 `company_membership_disabled`; 403 `company_access_unavailable`; 403 `platform_access_closed`; 429 พร้อม `retryAfterSeconds`; ทุกการปฏิเสธเขียน security event `auth.login.denied` และ audit `auth.login.denied` (metadata: identifier, reason)
- **ข้อมูล** `User`, `UserCredential`, `PasswordResetToken`, `CompanyMembership`, `Company`, `CompanyPlanTerm`, `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/password/login`
- **หน้าจอ** `/login`; BFF `POST /api/auth/login` (ตั้ง cookie — FR-CORE-094)
- **การทดสอบ** `auth-endpoints.spec.ts`, `presentation/auth.controller.spec.ts`, `domain/logic/password-credential.logic.spec.ts`, `free-expense-password-login.spec.ts`, `line-recovery.pg.spec.ts`, `application/auth-rate-limit.service.spec.ts`, `e2e/login.spec.ts`

### FR-CORE-003 ลืมรหัสผ่าน — รหัสชั่วคราวทาง LINE

- **คำอธิบาย** ผู้ใช้ที่ผูก LINE แล้วขอรหัสชั่วคราว 12 ตัวอักษรส่งเข้า LINE ของตนเอง ใช้แทนรหัสผ่านได้ 1 ครั้งภายใน 30 นาที
- **ผู้ใช้/สิทธิ์** `@Public()`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** ผู้ใช้ `ACTIVE` มี credential ที่ไม่ `DISABLED`, มี membership ACTIVE ในบริษัท ACTIVE, มี `ExternalIdentity` LINE `ACTIVE` บน channel เดียวกับ Messaging credential ของระบบ
- **ขั้นตอนหลัก** (`notify-password-reset-request.use-case.ts`)
  1. rate limit: `password-reset-request-identifier-ip` (ค่าเริ่มต้น 3) และ `password-reset-request-ip` (10) ต่อ 900 วินาที; identifier ถูก normalize เป็นตัวพิมพ์เล็ก
  2. ค้นผู้ใช้ `take: 2`; ถ้าเจอมากกว่า 1 → ปฏิเสธเงียบ (`ambiguous_identifier`)
  3. สร้างรหัส `generateRawToken(9)`; ใน transaction: lock credential, revoke token `PENDING` เดิม, สร้าง `PasswordResetToken` (เก็บเฉพาะ hash ที่ผูกกับ `passwordHash` ปัจจุบัน) หมดอายุ 30 นาที
  4. ส่ง Flex message ทาง LINE แบบ asynchronous (อ่าน identity ซ้ำก่อนส่ง); ส่งไม่สำเร็จ → revoke token
  5. ตอบข้อความเดียวกันทุกกรณี และหน่วงให้ครบ `PASSWORD_RESET_RESPONSE_MIN_MS` (ค่าเริ่มต้น 300 ms)
- **กฎ/ข้อยกเว้น** รหัสเดิมยังใช้ได้จนกว่าจะใช้รหัสกู้คืน; การใช้รหัสกู้คืนบังคับเปลี่ยนรหัสผ่าน (FR-CORE-002 ข้อ 7)
- **ข้อผิดพลาด** 429 เท่านั้น; เหตุผลการปฏิเสธ (`unknown_username`, `ineligible_account`, `no_active_company`, `line_channel_unavailable`, `line_identity_unavailable`) อยู่ใน audit `auth.password.reset_request` (result `DENIED`) และ security event `auth.password_reset.denied`
- **ข้อมูล** `PasswordResetToken`, `UserCredential`, `ExternalIdentity`, `AuditLog`
- **API** `POST /v1/auth/password/reset-request`
- **หน้าจอ** `/forgot-password` (`ForgotPasswordPage.tsx`, ช่องทาง LINE)
- **การทดสอบ** `application/use-cases/notify-password-reset-request.use-case.spec.ts`, `line-recovery.pg.spec.ts`, `infrastructure/system-line-push.spec.ts`, `e2e/line-recovery.spec.ts`

### FR-CORE-004 ลืมรหัสผ่าน — ลิงก์รีเซ็ตทางอีเมล

- **คำอธิบาย** ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของบัญชี แล้วตั้งรหัสใหม่ด้วย token
- **ผู้ใช้/สิทธิ์** `@Public()`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** ผู้ให้บริการอีเมลเป็น Postmark (`delivery.isPostmark`); identifier ตรงผู้ใช้เพียง 1 ราย; บัญชีผ่าน `lockEmailRecoveryAccount`
- **ขั้นตอนหลัก**
  1. `POST /v1/auth/password/email-reset-request` — rate limit ชุดเดียวกับ FR-CORE-003; จำกัดเพิ่ม 5 ฉบับ/ชั่วโมง และห่างกัน ≥ 60 วินาทีต่อผู้ใช้; สร้าง `PasswordResetToken` (hash) อายุ 30 นาที, เตรียม `EmailSendAttempt` (purpose `password_reset`), revoke token เดิม, audit `auth.password.reset_request`
  2. `POST /v1/auth/password/email-reset-confirm` `{token, newPassword}` — rate limit `password-reset-confirm-ip` (10/900 วินาที); รหัสใหม่ 8–128 ตัวอักษร; ห้ามซ้ำรหัสเดิม (`password_reuse`); audit `auth.password.reset_confirm`; **ไม่ออก session** ผู้ใช้ต้องล็อกอินใหม่
- **กฎ/ข้อยกเว้น** ตอบข้อความทั่วไปเสมอในขั้นขอ; token รูปแบบ `EMAIL_RECOVERY_TOKEN` (43 ตัวอักษร) ต่างจากรหัสกู้คืน LINE (12 ตัว) จึงใช้เป็นรหัสผ่านไม่ได้
- **ข้อผิดพลาด** 403 `email_reset_invalid`; 400 (รูปแบบรหัสผ่าน/`password_reuse`); 429
- **ข้อมูล** `PasswordResetToken`, `EmailSendAttempt`, `UserCredential`, `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/password/email-reset-request`, `POST /v1/auth/password/email-reset-confirm`
- **หน้าจอ** `/forgot-password` (ช่องทาง EMAIL), `/reset-password` (proxy ตั้ง `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`)
- **การทดสอบ** `application/use-cases/forgot-password-reset.use-case.spec.ts`, `postmark-delivery.pg.spec.ts`

### FR-CORE-005 เปลี่ยนรหัสผ่าน และการบังคับเปลี่ยนรหัสผ่านชั่วคราว

- **คำอธิบาย** ผู้ใช้เปลี่ยนรหัสผ่านของตนเอง; บัญชีที่ได้รหัสชั่วคราว (จากผู้ดูแล, การเพิ่มพนักงาน, หรือรหัสกู้คืน) ถูกกันออกจากทุกโมดูลธุรกิจจนกว่าจะเปลี่ยน
- **ผู้ใช้/สิทธิ์** ทุกบทบาท; `account.password.change`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** มี session; credential ไม่ `DISABLED` และรหัสชั่วคราวยังไม่หมดอายุ
- **ขั้นตอนหลัก** `POST /v1/auth/password/change` `{currentPassword?, newPassword(≥8)}` → ตรวจรหัสปัจจุบัน → ห้ามรหัสใหม่ตรงกับรหัสเดิม → ใน transaction: lock อีเมลบัญชี, ตรวจ credential ไม่ถูกเปลี่ยนระหว่างทาง, revoke `EmailVerificationToken` ที่ `PENDING`, เพิ่ม `User.emailRevision`, บันทึก hash ใหม่ (`status ACTIVE`, `mustChangePassword false`, `expiresAt null`, ล้าง `tempPasswordEncrypted`), revoke ทุก session ยกเว้น session ปัจจุบัน
- **กฎ/ข้อยกเว้น** ข้ามการกรอกรหัสปัจจุบันได้เฉพาะเมื่อ `canSkipCurrentPassword`: credential ยัง `mustChangePassword` และ `AuthSession.passwordCredentialVersion` ตรงกับ `credential.updatedAt` (คือ session นี้เพิ่งล็อกอินด้วยรหัสชั่วคราวนั้นเอง); การบังคับเปลี่ยนไม่ใช้กับ session ที่ล็อกอินด้วย LINE (`sessionProvider === 'line'`) และไม่ใช้กับเส้นทาง `/v1/auth/*`
- **ข้อผิดพลาด** 400 `current_password_incorrect`, `current_password_required`, `password_reuse`; 403 `Temporary password has expired.`; 401 เมื่อไม่มี credential
- **ข้อมูล** `UserCredential`, `AuthSession`, `EmailVerificationToken`, `User`
- **API** `POST /v1/auth/password/change`; `GET /v1/auth/me` คืน `mustChangePassword`, `canSkipCurrentPassword`
- **หน้าจอ** `/change-password` (`ChangePasswordPage.tsx`), BFF `POST /api/auth/change-password`; layout ของ `/companies/*` และ `/system/*` redirect ไป `/change-password?next=…`
- **การทดสอบ** `auth-endpoints.spec.ts`, `auth.guard.spec.ts`, `e2e/login.spec.ts`

### FR-CORE-006 ตั้งรหัสผ่านครั้งแรกของบัญชี LINE-first

- **คำอธิบาย** เจ้าของร้านที่เปิดร้านผ่าน LINE (ไม่มี credential) ตั้งรหัสผ่านสำรองและ username เอง
- **ผู้ใช้/สิทธิ์** เจ้าของบัญชี; `account.password.change`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** บัญชียังไม่มีรหัสผ่าน
- **ขั้นตอนหลัก** `POST /v1/auth/me/password/set` `{password(≥8), username?}` → rate limit `account-profile-write-user` (10 ครั้ง/900 วินาที) → `AccountProfileUseCase.setInitialPassword` → audit `auth.password.set`
- **กฎ/ข้อยกเว้น** username รูปแบบ `^[a-z0-9._-]{4,64}$`; บัญชีที่ไม่มีอีเมลต้องระบุ username; session ปัจจุบันไม่ถูก revoke
- **ข้อผิดพลาด** 400 (ต้องมี username), 409 (มีรหัสผ่านแล้ว / username ซ้ำ), 429
- **ข้อมูล** `User`, `UserCredential`, `AuditLog`
- **API** `POST /v1/auth/me/password/set`
- **หน้าจอ** `/companies/[companyId]/account`, `/companies/[companyId]/settings/profile` (ส่วน "บัญชีของฉัน" — `features/company-profile`)
- **การทดสอบ** `application/use-cases/account-profile.use-case.spec.ts`, `account-profile-username.pg.spec.ts`

### FR-CORE-007 การออก token, session และการหมุน refresh token

- **คำอธิบาย** ออก access token (JWT 15 นาที) และ refresh token (7 วัน) ผูกกับแถว `AuthSession`; refresh หมุน token ทุกครั้งและตรวจจับการใช้ซ้ำ
- **ผู้ใช้/สิทธิ์** ทุก session; refresh เป็น `@Public()` (refresh token คือ credential)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  - **ออก token** (`issue-token.use-case.ts`): payload `{sub:userId, sid:tokenId, provider}`; access token แนบ `permissions` ที่ resolve ตอนออก (เพื่อ AI Gateway); refresh token แนบ `type:'refresh'`, `fid:familyId`; ลงนาม HS256 พร้อม `iss`/`aud` (`jwtClaimIdentity`); สร้าง `AuthSession {tokenId, familyId, expiresAt, status ACTIVE, passwordCredentialVersion?}`; สำหรับ provider `watchdog` สร้าง session ใน transaction ที่ lock credential และตรวจ `updatedAt` ไม่เปลี่ยน
  - **refresh** (`refresh-session.use-case.ts`): ตรวจลายเซ็นและ `type`, ต้องมี `sid`; หา session จาก `tokenId` หรือ `previousTokenId`; ถ้า platform CLOSED อนุญาตเฉพาะ `SYSTEM_ADMIN`; ตรวจโควตา `session-refresh` (ค่าเริ่มต้น 30 ครั้ง/60 วินาที ต่อ token id); ถ้าเป็น token ปัจจุบัน → หมุน (CAS) แล้วออกคู่ใหม่; ถ้าเป็น token ก่อนหน้า → ยอมภายในช่วง grace `SESSION_REFRESH_REUSE_GRACE_SECONDS` (ค่าเริ่มต้น 30 วินาที, วัดจาก `rotatedAt`) โดยไม่หมุนซ้ำ; เกิน grace → revoke session และ 401 พร้อม security event `auth.session.refresh_reuse_detected`
- **กฎ/ข้อยกเว้น** session ประเภท `demo` หมดอายุตามลิงก์เดโม; provider `email` ต้องมี proof ใน transaction เดียวกัน; อัลกอริทึมถูกตรึงที่ HS256 ทุกจุดตรวจ
- **ข้อผิดพลาด** 401 (`Invalid or expired refresh token.`, `Token is not a refresh token.`, `Session is expired or revoked.`), 503 `platform_access_closed`, 500 เมื่อไม่ตั้ง secret
- **ข้อมูล** `AuthSession` (`tokenId`, `previousTokenId`, `familyId`, `rotatedAt`, `status`, `expiresAt`), `AuditLog` (`auth.login.exchange`, `auth.session.refresh`)
- **API** `POST /v1/auth/session/refresh`
- **หน้าจอ** BFF `POST /api/auth/refresh`; client `authedApiFetch` refresh แบบ single-flight เมื่อเจอ 401
- **การทดสอบ** `application/use-cases/refresh-session-reuse.use-case.spec.ts`, `infrastructure/jwt-verifier-pinning.spec.ts`, `auth.guard.spec.ts`

### FR-CORE-008 ออกจากระบบ และยกเลิก session อื่น

- **คำอธิบาย** revoke session ปัจจุบัน หรือ revoke ทุก session ยกเว้นปัจจุบัน
- **ผู้ใช้/สิทธิ์** ทุกบทบาท; `account.session.read`
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `POST /v1/auth/logout` (204) → `LogoutUseCase` ตั้ง session เป็น revoked + audit `auth.session.logout`; `POST /v1/auth/sessions/revoke-others` (200) → `RevokeOtherSessionsUseCase` + audit `auth.session.revoke_others`
- **กฎ/ข้อยกเว้น** ระบุ session จาก claim `sid` ของ token (header หรือ cookie); ไม่มีหน้ารายการ session ทั้งหมด (ไม่มี endpoint list)
- **ข้อผิดพลาด** 401 `Cannot identify session.`
- **ข้อมูล** `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/logout`, `POST /v1/auth/sessions/revoke-others`
- **หน้าจอ** เมนูผู้ใช้ใน `WorkspaceLayout`; BFF `POST /api/auth/logout` (ล้าง cookie)
- **การทดสอบ** `auth-endpoints.spec.ts`, `domain/logic` (`session-revocation.logic.ts` ถูกทดสอบผ่าน use case specs)

### FR-CORE-009 บริบทคำขอ (RequestContext) และ AuthGuard

- **คำอธิบาย** ทุกคำขอที่ไม่ public ต้องผ่าน `AuthGuard` ซึ่งสร้าง `RequestContext` ให้ controller ใช้ (ลำดับเต็มใน §2)
- **ผู้ใช้/สิทธิ์** ทุกคำขอ
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** ตาม §2 ข้อ 4; `RequestContext` = `{requestId, authSubject, sessionId, userId, companyId, membershipId, roles, permissions, availablePermissions, entitledFeatureKeys, entitlementDeniedPermissions, freeExpenseDrafts?, isDemo?, demoExpiresAt?, scopes:{branchIds?}, authProvider}` (`domain/models/request-context.model.ts`)
- **กฎ/ข้อยกเว้น** เส้นทางกู้คืนเมื่อแพ็กหมดอายุ (`TERM_RECOVERY_ROUTES`): `GET /v1/plan-term/notice`, `GET /v1/auth/me`, `GET /v1/auth/me/companies`, `GET|POST /v1/auth/legal-acceptance`, `POST /v1/auth/password/change`, `POST /v1/auth/logout`, `GET /v1/auth/account/security`, `GET|PATCH /v1/auth/account/display-name`, `PATCH /v1/auth/me/contact`, `POST /v1/auth/me/password/set` รวมถึงเส้นทาง account email OTP, billing และโปรไฟล์บริษัทที่ระบุด้วย regex; เมื่อ `GET /v1/auth/me` ถูกปฏิเสธ 403 จะตอบ `company_membership_disabled` หรือ `company_access_unavailable` พร้อม `companyName` เฉพาะเมื่อผู้ใช้มี membership กับบริษัทนั้น
- **ข้อผิดพลาด** 401, 403 (`legal_acceptance_required`, `company_term_expired`, `FREE_EXPENSE_DRAFTS_ONLY`), 410 `demo_link_expired`, 503 `platform_access_closed`
- **ข้อมูล** `AuthSession`, `User`, `ExternalIdentity`, `CompanyMembership`, `CompanyPlanTerm`, `UserCredential`
- **API** ทุกเส้นทางที่ไม่ public
- **หน้าจอ** layout `app/(workspace)/companies/[companyId]/layout.tsx`, `app/system/layout.tsx`
- **การทดสอบ** `auth.guard.spec.ts`, `access-control/permission-resolver.spec.ts`

### FR-CORE-010 เข้าสู่ระบบด้วย LINE บนเว็บ (OAuth Authorization Code + PKCE)

- **คำอธิบาย** ผู้ใช้กด "เข้าสู่ระบบด้วย LINE" → BFF เริ่ม OAuth → API แลก code กับ LINE, ตรวจ ID token, ออก token ของระบบ หรือแจ้งว่าต้องผูกบัญชีก่อน
- **ผู้ใช้/สิทธิ์** ผู้ใช้ที่ผูก LINE แล้ว; `@Public()`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** `LINE_WEB_LOGIN_ENABLED = true`; ตั้ง web base URL
- **ขั้นตอนหลัก** `POST /v1/auth/line/login/callback` `{code, codeVerifier, nonce}` → rate limit `line-login-callback-ip` (10/900 วินาที) → `LineLoginCallbackUseCase` แลก code ฝั่ง server แล้วใช้กฎเดียวกับ `ExchangeLineTokenUseCase` (ค้น `ExternalIdentity` LINE `ACTIVE` ตาม channel ที่อนุมัติ; identity รุ่นเก่าที่ไม่มี `providerChannelId` ใช้ fallback แบบไม่ระบุ channel พร้อม warn) → ออก token provider `line`
- **กฎ/ข้อยกเว้น** session แบบ `line` ไม่ถูกบังคับเปลี่ยนรหัสผ่านชั่วคราว; การปฏิเสธเขียน audit `auth.login.denied`; `POST /v1/auth/line/exchange` (รับ ID token ตรง ๆ) ถูกปิดถาวร ตอบ 403 `LINE login is deferred to a future release`
- **ข้อผิดพลาด** 403 `LINE login is not enabled.`, 403 `Account is not active.`, 503 `Web base URL is not configured.`, 429
- **ข้อมูล** `ExternalIdentity`, `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/line/login/callback`
- **หน้าจอ** `/login`; BFF `GET /api/auth/line-login/start`, `GET /api/auth/line-login/callback`, `GET /api/auth/line-login/availability`
- **การทดสอบ** `line-login-callback.spec.ts`, `application/line-id-token.service.spec.ts`

### FR-CORE-011 เข้าสู่ระบบบนเดสก์ท็อปด้วย QR (LINE web QR transaction)

- **คำอธิบาย** เดสก์ท็อปแสดง QR อายุสั้น; มือถือที่ล็อกอินแล้วสแกนและกดอนุมัติ; เดสก์ท็อป poll แล้วได้ session
- **ผู้ใช้/สิทธิ์** create/redeem เป็น `@Public()`; approve ต้อง `account.session.read`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** `LINE_WEB_LOGIN_ENABLED = true`
- **ขั้นตอนหลัก**
  1. `POST /v1/auth/line/qr/create` `{returnTo?}` → สร้าง `LineWebLoginTransaction` อายุ 3 นาที (`LINE_WEB_QR_TTL_MS`); คืน `publicCode` (ใส่ใน QR) และ `desktopSecret` (BFF เก็บใน cookie HttpOnly) — DB เก็บเฉพาะ sha256
  2. มือถือเปิด `/line-qr/<code>` → `POST /v1/auth/line/qr/approve` `{publicCode}` ผูกผู้ใช้ที่ล็อกอินกับ transaction (audit `auth.line_qr.approve`)
  3. เดสก์ท็อป `POST /v1/auth/line/qr/redeem` `{desktopSecret}` → `pending` / `expired` / `approved` + token; การ redeem เป็น conditional update ไป `CONSUMED` (audit `auth.line_qr.redeem`)
- **กฎ/ข้อยกเว้น** `returnTo` รับเฉพาะ path ภายในแอป; secret ที่ถูกใช้แล้วตอบ `expired` ไม่ออก session ซ้ำ; approve ได้รับยกเว้นจาก legal-acceptance gate
- **ข้อผิดพลาด** 403 (`LINE login is not enabled.`, `QR transaction is expired or not found.`), 404 (approve กับ QR หมดอายุ), 429 (ถัง `line-qr-create-ip` ค่าเริ่มต้น 10 ครั้ง/300 วินาที; `line-qr-poll-ip` 90 ครั้ง/60 วินาที)
- **ข้อมูล** `LineWebLoginTransaction` (`LineWebLoginTransactionStatus`), `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/line/qr/create|redeem|approve`
- **หน้าจอ** `/login` (แสดง QR), `/line-qr/[code]` (`LineQrApprovePage.tsx`); BFF `POST /api/auth/line-qr/start|status|approve`
- **การทดสอบ** `line-web-qr.spec.ts`, `domain/logic/line-web-qr.logic.spec.ts`

### FR-CORE-012 ลิงก์ handoff จาก LINE สู่เว็บ (single-use token)

- **คำอธิบาย** ลิงก์ในข้อความ LINE (คำตอบ AI, การแจ้งเตือน, ปุ่มเลือกร้าน) มีรูป `<web>/l/<token>` แตะแล้วได้ session ของผู้รับข้อความโดยไม่ต้องล็อกอิน
- **ผู้ใช้/สิทธิ์** mint: ภายใน server (ไม่มี permission ของผู้ใช้); exchange: `@Public()` (token คือ credential)
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** `LINE_WEB_HANDOFF_ENABLED = true`
- **ขั้นตอนหลัก**
  - **mint** (`mint-line-handoff-token.use-case.ts`): ตรวจ path ปลายทางอยู่ใต้ tenant root ของบริษัท (`/companies/<id>/…`, ยาว ≤ 512, ไม่มี backslash/อักขระควบคุม/traversal), สร้าง token 24 ไบต์ base64url เก็บเฉพาะ hash อายุ 15 นาที (`LINE_HANDOFF_TOKEN_TTL_MS`), audit `auth.line_handoff.issue`
  - **exchange** (`exchange-line-handoff-token.use-case.ts`): (1) ค้นด้วย hash (2) ตรวจ status/TTL (3) resolve ตัวตน LINE / ผู้ใช้ / membership / บริษัท ใหม่ ณ เวลาแตะ (4) claim `PENDING→USED` แบบ atomic ก่อนออก session (4b) ถ้า surface = `company_picker_open_web` สลับบริบทบริษัทของแชต LINE ด้วย (5) ออก token; ปลายทางอ่านจากแถวเท่านั้น
- **กฎ/ข้อยกเว้น** ข้อความในกลุ่ม/ห้อง (chat key ขึ้นต้น `C`/`R`) ตรวจเพียงว่าผู้ใช้มี LINE link ที่ยังใช้งาน; การยกเลิกผูก LINE revoke token ที่ส่งไปแล้ว; เมื่อ platform CLOSED เส้นทางนี้ถูกปิด (ไม่อยู่ใน `CLOSED_PUBLIC_PATHS`); route ของเว็บตอบ HEAD ด้วย 204 โดยไม่ใช้ token (กัน link preview)
- **ข้อผิดพลาด** 403 ข้อความทั่วไป `This link is expired or has already been used.` (เหตุผลจริงอยู่ใน audit เท่านั้น), 429 (`line-handoff-exchange-ip` ค่าเริ่มต้น 20 ครั้ง/60 วินาที), security event สำหรับ token ที่ถูกปฏิเสธ
- **ข้อมูล** `LineWebHandoffToken` (`LineWebHandoffTokenStatus`), `ExternalIdentity`, `CompanyMembership`, `LineCompanyContext`, `AuditLog`
- **API** `POST /v1/auth/line/handoff/exchange`
- **หน้าจอ** `apps/web/app/l/[token]/route.ts` (route handler; ได้รับยกเว้นจากหน้าเบราว์เซอร์ไม่รองรับ)
- **การทดสอบ** `line-handoff.spec.ts`, `domain/logic/line-handoff.logic.spec.ts`, `free-expense-handoff.spec.ts`

### FR-CORE-013 หน้า LIFF ที่ API ให้บริการ และการแลก LIFF session

- **คำอธิบาย** API ส่ง HTML/JS ของหน้า LIFF เอง (CSP เฉพาะ `LIFF_PAGE_CSP`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`) และแลก LIFF ID token เป็น URL handoff สำหรับเปิดเว็บในเบราว์เซอร์ภายนอก
- **ผู้ใช้/สิทธิ์** `@Public()` ทั้งหมด (ID token คือ credential)
- **แพ็ก** [PUBLIC] / [ALL]
- **ขั้นตอนหลัก**

  | เส้นทาง | หน้าที่ |
  |---|---|
  | `GET /v1/auth/line/link-page` | หน้าผูก LINE กับบัญชี (โหมด `account`) |
  | `GET /v1/auth/line/link-page.js` | สคริปต์ client ของหน้า LIFF (cache ตามพารามิเตอร์ `v`) |
  | `GET /v1/auth/line/link-page/employee`, `…/employee-link-page` | หน้าพนักงานผูก LINE ด้วย token (FR-CORE-015) |
  | `GET /v1/auth/line/link-page/signup`, `…/signup-page` | ฟอร์ม "เปิดร้านใหม่" พร้อมบล็อกยอมรับข้อกำหนด (FR-CORE-053) |
  | `GET /v1/auth/line/link-page/start`, `…/start-page` | "เริ่มใช้งาน" — พิสูจน์ตัวตนแล้วเปิดเว็บ |
  | `GET /v1/auth/line/link-page/package-advisor`, `…/package-advisor-page`, `GET /v1/auth/line/package-advisor.js` | หน้าช่วยเลือกแพ็กเกจ (อ่านแค็ตตาล็อกสาธารณะ) |
  | `GET /v1/auth/line/link-page/event-discount` | หน้ารับส่วนลดงานอีเวนต์ (ตรรกะการ claim อยู่พื้นที่ sales) |
  | `POST /v1/auth/line/liff/session` | แลก ID token → handoff URL |

  `POST /v1/auth/line/liff/session` `{idToken, companyId?, billingOffer?, billingInterval?, landing?('package'), to?}` → ตรวจ ID token → rate limit `LINE_LIFF_SESSION_MAX_PER_USER` (30/ชั่วโมง ต่อบัญชี LINE) → เลือกบริษัทจาก membership ที่ใช้งานอยู่ (ถ้ามีหลายร้านคืนรายการให้เลือก) → mint handoff token ไปยัง `dashboard` (ค่าเริ่มต้น `LIFF_START_TARGET_PATH`), หน้าแพ็กเกจ หรือ path ที่ลิงก์ชี้ → audit `auth.line.liff_session`
- **กฎ/ข้อยกเว้น** `companyId` และ `to` จาก client ยอมรับเฉพาะเมื่อผู้ใช้เป็นสมาชิกบริษัทนั้นจริง; `billingOffer` ต้องเป็น tier ที่ขาย; หน้า signup ต้องมี web base URL มิฉะนั้นปฏิเสธการ render; ปุ่ม "ติดต่อเจ้าหน้าที่" ชี้ไป Official OA
- **ข้อผิดพลาด** 401 (ID token ไม่ถูกต้อง), 403 `line_web_handoff_disabled`, 400 `line_billing_selection_invalid`
- **ข้อมูล** `ExternalIdentity`, `CompanyMembership`, `LineCompanyContext`, `LineWebHandoffToken`, `AuditLog`
- **API** ตามตาราง
- **หน้าจอ** หน้า LIFF (HTML จาก API: `apps/api/src/common/security/liff-page.security.ts`, `line-package-advisor.page.ts`)
- **การทดสอบ** `line-liff-signup.spec.ts`, `common/security/liff-start-handoff.spec.ts`, `liff-page-contrast.spec.ts`, `liff-event-discount-page.spec.ts`, `injectable-di-token.spec.ts`

### FR-CORE-014 ผูกและยกเลิกผูก LINE identity ของบัญชี

- **คำอธิบาย** ผู้ใช้ที่ล็อกอินแล้วผูกบัญชี LINE เพื่อใช้ LINE login / LINE AI / รับแจ้งเตือน และยกเลิกผูกได้
- **ผู้ใช้/สิทธิ์** ผูก: `account.identity.link`; ยกเลิก: `account.identity.unlink`
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  - `POST /v1/auth/line/link` `{idToken, companyId?}` (LIFF) และ `POST /v1/auth/line/link/oauth` `{code, codeVerifier, nonce}` (เว็บ OAuth, rate limit ถัง callback) → ตรวจ proof ก่อน lock DB → ถ้า identity นั้น `DISABLED` ปฏิเสธ; ถ้าผูกกับผู้ใช้อื่นอยู่ → 409 `line_linked_elsewhere` (ฝั่ง OAuth ใช้ออก merge ticket — FR-CORE-016) → สร้าง/ปรับ `ExternalIdentity` เป็น `ACTIVE` พร้อม `providerChannelId` → revoke `PasswordResetToken` ที่ค้าง → audit `auth.identity.link`
  - การเลือกบริษัทของแชต LINE: ระบุ `companyId` ต้องเป็นสมาชิก ACTIVE; ไม่ระบุและมีร้านเดียว = เลือกอัตโนมัติ; มีหลายร้าน = ข้าม ให้ webhook ถามทีหลัง
  - `POST /v1/auth/line/unlink` → ใน transaction เดียว: ต้องมีวิธีล็อกอินอื่นเหลือ (รหัสผ่านสำรอง + username) มิฉะนั้น `LAST_LOGIN_REQUIRED`; ตั้ง identity เป็น `UNLINKED` (CAS ด้วย `updatedAt`); revoke email token / reset token / handoff token; ล้างบริบทบริษัทของแชตและการพัก AI ที่ค้าง; audit `auth.identity.unlink`
- **กฎ/ข้อยกเว้น** binding ที่ต้องให้ผู้ดูแลตรวจตอบ 409 `line_identity_review_required`
- **ข้อผิดพลาด** 409 (`line_linked_elsewhere`, `line_identity_changed`, `line_identity_review_required`, `LAST_LOGIN_REQUIRED`), 403 (`LINE identity is disabled.`, ไม่ใช่สมาชิกบริษัท), 404 `No active LINE identity linked.`, 503 `LINE channel configuration is missing.`
- **ข้อมูล** `ExternalIdentity`, `LineCompanyContext`, `PasswordResetToken`, `EmailVerificationToken`, `LineWebHandoffToken`, `AuditLog`
- **API** `POST /v1/auth/line/link`, `POST /v1/auth/line/link/oauth`, `POST /v1/auth/line/unlink`
- **หน้าจอ** หน้า LIFF link-page; ส่วนบัญชีของฉันใน `/companies/[companyId]/settings/profile`
- **การทดสอบ** `line-linking.spec.ts`, `line-link-oauth.spec.ts`, `application/use-cases/link-line-identity.use-case.spec.ts`, `line-binding.pg.spec.ts`

### FR-CORE-015 พนักงานผูก LINE ด้วย QR/ลิงก์ที่ผู้ดูแลออกให้

- **คำอธิบาย** พนักงานสแกน QR (token อายุ 15 นาที; ของเจ้าของร้านจาก onboarding 72 ชั่วโมง) แล้วผูก LINE โดยไม่ต้องมี session ของระบบ
- **ผู้ใช้/สิทธิ์** `@Public()`; ผู้ออก token ต้องมี `access.employee.line_link.issue` (FR-CORE-045)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `POST /v1/auth/line/employee-link` `{token(32 ตัว), idToken}` → ตรวจ ID token กับ LINE ก่อน (proof ไม่ถูกต้องไม่ทำให้ QR ถูกใช้) → ตรวจ token `PENDING` ยังไม่หมดอายุ และ membership/ผู้ใช้/บริษัท ACTIVE → claim `PENDING→USED` พร้อม `claimedLineUserId/ChannelId` → ถ้าผู้ใช้มี LINE identity อื่นอยู่ ให้ `UNLINKED` ตัวเก่า (audit `auth.identity.unlink`) → ผูกตัวใหม่ → audit `access.employee.line_link.success`
- **กฎ/ข้อยกเว้น** idempotent: LINE account เดิมสแกน token ที่ใช้แล้วซ้ำได้ผลสำเร็จเดิม; LINE account อื่นสแกน token ที่ใช้แล้วถูกปฏิเสธ
- **ข้อผิดพลาด** 403 `LINE link token is invalid, expired, or already used.`; 503 `line_link_retry`; audit `access.employee.line_link.failure`
- **ข้อมูล** `EmployeeLineLinkToken` (`EmployeeLineLinkTokenStatus`), `ExternalIdentity`, `PasswordResetToken`, `AuditLog`
- **API** `POST /v1/auth/line/employee-link`, `GET /v1/auth/line/link-page/employee`
- **หน้าจอ** หน้า LIFF employee (HTML จาก API)
- **การทดสอบ** `application/use-cases/complete-employee-line-link.use-case.spec.ts`

### FR-CORE-016 รวมบัญชี (account merge) เมื่อ LINE ถูกผูกกับบัญชีอื่นอยู่แล้ว

- **คำอธิบาย** เมื่อผู้ใช้พิสูจน์ว่าควบคุม LINE ของ "บัญชีเดิม" ระบบออก ticket ให้ย้าย membership ของบัญชีปัจจุบันไปรวมกับบัญชีเดิม แล้วปิดบัญชีปัจจุบัน
- **ผู้ใช้/สิทธิ์** `account.identity.link`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** มี `AccountMergeTicket` (อายุ 15 นาที `ACCOUNT_MERGE_TICKET_TTL_MS`) ที่ออกให้ session นี้
- **ขั้นตอนหลัก**
  1. `POST /v1/auth/account-merge/preview` `{ticket}` (rate limit 120/ชั่วโมง/IP) → แผนรายร้าน: ร้านที่ย้าย ร้านที่ติดขัด และวิธีล็อกอินที่เหลือ (ไม่เขียนข้อมูล)
  2. `POST /v1/auth/account-merge` `{ticket}` → ตรวจเจ้าของ ticket ก่อนทุกอย่าง → ตรวจบัญชีปลายทางยังใช้งานได้ → ใน transaction: revoke email token ของทั้งสองบัญชี, ย้าย membership (role และ branch scope ตามไป), ย้ายอีเมลถ้าปลายทางไม่มี, ตั้งบัญชีต้นทางเป็น `DISABLED` (ไม่ลบ), CAS `consumedAt` → ออก session ของบัญชีเดิม; audit `auth.account.merge`
- **กฎ/ข้อยกเว้น** (`domain/logic/account-merge.logic.ts`) ร้านที่ปลายทางเป็นสมาชิกอยู่แล้วแต่ membership ไม่ ACTIVE หรือชุดบทบาทขัดกัน → ล้มเหลวแบบปิด ให้คนตัดสิน; ทุกร้านที่ถูกแตะต้องยังมี OWNER ที่ ACTIVE หลังรวม; ticket ที่ consume แล้วตอบสำเร็จซ้ำ (double-click)
- **ข้อผิดพลาด** 404 `merge_ticket_invalid`, 403 `merge_ticket_not_yours`, 409 `merge_not_needed` / `merge_target_unavailable` / `merge_ticket_expired`
- **ข้อมูล** `AccountMergeTicket`, `CompanyMembership`, `MembershipRole`, `MembershipBranchScope`, `User`, `AuthSession`, `AuditLog`
- **API** `POST /v1/auth/account-merge`, `POST /v1/auth/account-merge/preview`
- **หน้าจอ** กล่องโต้ตอบใน `/login` / หน้าบัญชี; BFF `POST /api/auth/account-merge`, `/api/auth/account-merge/ticket`
- **การทดสอบ** `application/use-cases/account-merge.use-case.spec.ts`

### FR-CORE-017 ยืนยันและเปลี่ยนอีเมลบัญชีด้วยรหัส OTP 6 หลัก

- **คำอธิบาย** ผู้ใช้ตั้ง/เปลี่ยน/ยืนยันอีเมลของบัญชีด้วย OTP ที่ส่งไปยังอีเมลใหม่ (แทนลิงก์ยืนยันรุ่นเก่า)
- **ผู้ใช้/สิทธิ์** เจ้าของบัญชี; อ่านสถานะ `account.session.read`; การเขียน `account.password.change`
- **แพ็ก** [ALL] (เข้าถึงได้แม้แพ็กหมดอายุ — `isAccountEmailRecoveryRoute`)
- **เงื่อนไขก่อนทำ** ผู้ให้บริการอีเมล = `postmark` พร้อม `postmarkServerId`, `emailOtpHmacKey` (hex 64 ตัว) และ `emailOtpHmacKeyVersion`; สภาพแวดล้อมเป็น local/uat/production (UAT ส่งได้เฉพาะผู้รับใน `postmarkUatAllowedRecipients`); session ยัง ACTIVE; ผ่าน re-auth (รหัสผ่านปัจจุบัน หรือ LINE reauth ภายใน 5 นาที — FR-CORE-018)
- **ขั้นตอนหลัก** (`application/account-email-otp.service.ts`)
  1. `GET /v1/auth/account/email/otp` และ `GET …/otp/:id` — สถานะ: `email`, `emailVerified`, `emailRevision`, `emailRequirement` (`READY`/`MISSING`/`UNVERIFIED`/`CHANGE_PENDING`), `emailLoginEnabled`, `hasPassword`, `lineLinked`, และ challenge (`status`, `expiresAt`, `retryAt`, `attemptsRemaining`, `deliveryStatus`, `delivered`)
  2. `POST …/otp/request` `{newEmail, requestKey(UUIDv4), expectedEmailRevision, currentPassword?}` → idempotent ด้วย `(userId, requestKey)` + fingerprint; ตรวจ `emailRevision` ตรง; อีเมลต้องไม่ซ้ำกับ email/username ของผู้ใช้อื่น; ตรวจงบส่งเมล; สร้าง `EmailSendAttempt` (purpose `email_verification`); revoke token `PENDING` เดิม; เพิ่ม `emailRevision`; สร้าง `EmailVerificationToken` (`proofKind 'OTP'`, เก็บ HMAC-SHA256 ของรหัสผูกกับ environment, token id, userId, email, emailRevision, security binding, sessionId, key version, expiresAt); audit `auth.email.otp.requested`; ส่งอีเมล
  3. `POST …/otp/:id/resend` — ขอรหัสใหม่ของ challenge เดิมภายใต้กฎเดียวกัน
  4. `POST …/otp/:id/confirm` `{code(6 หลัก)}` — ตรวจ binding ปัจจุบัน; รหัสผิดเพิ่ม `failedAttempts` (ครบ 5 → `REVOKED`) และเขียน audit `auth.email.otp.invalid`; รหัสถูก → ตั้ง `User.email`, `emailVerifiedAt`, เพิ่ม `emailRevision`, revoke session อื่น, audit `auth.email.verified`, ส่งประกาศความปลอดภัยไปอีเมลเดิมถ้ามี
  5. `POST …/otp/:id/cancel` — ยกเลิก challenge (audit `auth.email.otp.cancelled`)
- **กฎ/ข้อยกเว้น** OTP อายุ 10 นาที (`EMAIL_OTP_TTL_MS`), cooldown 60 วินาที; งบต่อผู้ใช้ 1/นาที, 5/ชั่วโมง, 10/วัน และ 5/ชั่วโมงต่อผู้รับ (นับรวม OTP บัญชี, OTP ผู้รับเอกสาร billing, และ email access); รหัสผิดรวม ≥ 20 ครั้ง/ชั่วโมงต่อผู้ใช้ → 429; ถัง IP `email-otp-ip` 120/ชั่วโมง และ `email-otp-reauth-user` 20/ชั่วโมง; การเปลี่ยนรหัสผ่าน/อีเมล/LINE ทำให้ binding เปลี่ยนและ challenge กลายเป็น `REVOKED`
- **ข้อผิดพลาด** `EMAIL_OTP_TARGET_INVALID` (400), `EMAIL_STATE_CHANGED` (409), `EMAIL_REAUTH_REQUIRED` (401/403), `EMAIL_CONFLICT` (409), `EMAIL_OTP_RATE_LIMITED` (429 + `retryAfterSeconds`), `EMAIL_DELIVERY_UNAVAILABLE` (503), `EMAIL_OTP_NOT_FOUND` (404), `EMAIL_OTP_INVALID` / `EMAIL_OTP_ATTEMPTS_EXCEEDED` (409)
- **ข้อมูล** `EmailVerificationToken`, `EmailSendAttempt`, `EmailAccessChallenge`, `User` (`email`, `emailVerifiedAt`, `emailRevision`), `AuthSession` (`emailReauthenticatedAt`, `emailReauthBindingHash`), `AuditLog`
- **API** `GET /v1/auth/account/email/otp`, `GET /v1/auth/account/email/otp/:id`, `POST /v1/auth/account/email/otp/request`, `POST …/:id/resend`, `POST …/:id/confirm`, `POST …/:id/cancel`
- **หน้าจอ** `/account/email` (`AccountEmailOtpPanel.tsx`), ส่วนบัญชีของฉันใน `/companies/[companyId]/settings/profile`
- **การทดสอบ** `application/account-email-otp.postgres.spec.ts`, `domain/logic/email-otp.logic.spec.ts`, `account-profile-email.pg.spec.ts`, `postmark-delivery.pg.spec.ts`, `e2e/account-email-otp-ux.spec.ts`
- **หมายเหตุ** endpoint รุ่นลิงก์ยืนยัน (`POST /v1/auth/account/email`, `/account/email/resend`, `/account/email/verify`, `/me/email/unverified`) ยังมีอยู่แต่ตอบ 409 `EMAIL_OTP_REQUIRED` ทุกครั้ง (ดู §20)

### FR-CORE-018 เปิด/ปิดการเข้าสู่ระบบด้วยอีเมล และการยืนยันตัวตนซ้ำผ่าน LINE

- **คำอธิบาย** ผู้ใช้เลือกเปิด "เข้าสู่ระบบด้วยอีเมล (รหัส OTP)" เป็นวิธีสำรอง และทำ re-auth ด้วย LINE แทนรหัสผ่าน
- **ผู้ใช้/สิทธิ์** `account.password.change`
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  - `POST /v1/auth/account/email/otp/login-method` `{enabled, currentPassword?}` → ต้องผ่าน re-auth (รหัสผ่านที่ใช้งานได้ หรือ `emailReauthenticatedAt` ภายใน `EMAIL_REAUTH_TTL_MS` 5 นาที); เปิดได้เมื่ออีเมล `READY`; ตั้ง/ล้าง `User.emailLoginEnabledAt`; revoke `EmailAccessChallenge` ที่ค้าง; audit `auth.email_login.enabled` / `auth.email_login.disabled`
  - `POST …/otp/line-reauth/start` → สร้าง nonce (เก็บ hash ใน `AuthSession.emailReauthNonceHash`, หมดอายุ 10 นาที) คืน `{nonce, channelId}`; `POST …/otp/line-reauth` `{code, codeVerifier, nonce}` → แลก code กับ LINE, ตรวจ `auth_time` ไม่เก่ากว่า 5 นาที, ต้องเป็น LINE identity ที่ผูกกับบัญชีนี้ → ตั้ง `emailReauthenticatedAt`
- **กฎ/ข้อยกเว้น** บัญชี `isSystemProtected` หรือที่มีบทบาท `SYSTEM_ADMIN` เปิดการเข้าด้วยอีเมลไม่ได้ (`EMAIL_LOGIN_NOT_ALLOWED`); ปิดไม่ได้ถ้าไม่มีรหัสผ่านที่ใช้งานได้และไม่มี LINE (`LAST_LOGIN_REQUIRED`)
- **ข้อผิดพลาด** `EMAIL_REAUTH_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED` (409), `EMAIL_LOGIN_NOT_ALLOWED` (403), `LAST_LOGIN_REQUIRED` (409)
- **ข้อมูล** `User.emailLoginEnabledAt`, `AuthSession`, `EmailAccessChallenge`, `AuditLog`
- **API** `POST /v1/auth/account/email/otp/login-method`, `POST …/line-reauth/start`, `POST …/line-reauth`
- **หน้าจอ** `/account/email`
- **การทดสอบ** `application/account-email-otp.postgres.spec.ts`, `application/email-access.pg.spec.ts`

### FR-CORE-019 เข้าสู่ระบบด้วยอีเมล (email access OTP)

- **คำอธิบาย** ผู้ใช้กรอกอีเมล รับ OTP แล้วได้ session โดยไม่ใช้รหัสผ่าน; อีเมลที่ยังไม่มีบัญชีนำไปสู่การสมัครเปิดร้านทางอีเมล (FR-CORE-054)
- **ผู้ใช้/สิทธิ์** `@Public()`
- **แพ็ก** [PUBLIC] / [ALL]
- **เงื่อนไขก่อนทำ** การส่งอีเมลพร้อมใช้งาน; สำหรับการล็อกอิน บัญชีต้องเปิด `emailLoginEnabledAt`
- **ขั้นตอนหลัก** (`application/email-access.service.ts`, controller `external-signup/presentation/http/public-email-access.controller.ts`) `POST /v1/public/email-access/request` → สร้าง `EmailAccessChallenge` และส่งรหัส; `POST …/confirm` → ตรวจรหัส; ถ้าเป็นบัญชีเดิมออก session provider `email` (ผูก `emailReauthBinding`) ; ถ้าไม่มีบัญชีคืน proof สำหรับสมัคร; `POST …/status` → อ่านสถานะคำขอสมัครของอีเมลนั้น
- **กฎ/ข้อยกเว้น** rate limit ต่อ IP: `request` 10/ชั่วโมง, `confirm` และ `signup` 30/ชั่วโมง; ใช้งบผู้รับร่วมกับ FR-CORE-017; platform CLOSED → ปฏิเสธ
- **ข้อผิดพลาด** `EMAIL_ACCESS_INVALID` (401), `EMAIL_OTP_INVALID`, `EMAIL_OTP_RATE_LIMITED` (429), `EMAIL_DELIVERY_UNAVAILABLE` (503), `EMAIL_SIGNUP_INPUT_INVALID` (400), `platform_access_closed`
- **ข้อมูล** `EmailAccessChallenge`, `EmailSendAttempt`, `User`, `AuthSession`
- **API** `POST /v1/public/email-access/request|confirm|signup|status`
- **หน้าจอ** `/email-access` (`EmailAccessPage.tsx`); BFF `POST /api/auth/email-access/request|confirm|signup|status`
- **การทดสอบ** `application/email-access.pg.spec.ts`

### FR-CORE-020 การยอมรับข้อกำหนดการใช้งานและประกาศความเป็นส่วนตัว (legal acceptance gate)

- **คำอธิบาย** ก่อนใช้โมดูลธุรกิจ ผู้ใช้ต้องยอมรับข้อกำหนดการใช้งานและรับทราบประกาศความเป็นส่วนตัวฉบับปัจจุบัน ระบบเก็บหลักฐานแบบมีเวอร์ชันและ hash
- **ผู้ใช้/สิทธิ์** ทุกบทบาท; `account.session.read`
- **แพ็ก** [ALL]
- **เงื่อนไขก่อนทำ** เปลี่ยนรหัสผ่านชั่วคราวแล้ว (มิฉะนั้น 403)
- **ขั้นตอนหลัก**
  1. `GET /v1/auth/legal-acceptance` → `{required, acceptedAt, companyId, companyName, membershipId, capacity, statementVersion, terms, privacy, statements{th,en}, displayChallenges{th,en}}`
  2. `POST /v1/auth/legal-acceptance` `{termsVersion, privacyVersion, statementVersion, termsAccepted:true, privacyAcknowledged:true, deletionAcknowledged:true, locale:'th', displayChallenge(hex 64)}` → ตรวจเวอร์ชันและ challenge ตรงกับที่ server ออก → บันทึก `LegalDocumentActionRecord` คู่ terms/privacy ใน batch เดียว (พร้อม session token id, user agent)
- **กฎ/ข้อยกเว้น** เอกสารปัจจุบัน: `TERMS_OF_USE v3`, `PRIVACY_NOTICE v3` (effective 2026-08-14), statement version `v2` (`packages/contracts/src/legal-acceptance.ts`); ความสมบูรณ์ผูกกับ `artifactSha256` ของไฟล์ที่เสิร์ฟจริง; รับเฉพาะ locale `th`; capacity = `AUTHORIZED_REPRESENTATIVE` / `INVITED_MEMBER` / `SYSTEM_OPERATOR`; หลักฐานที่เก็บบนหน้า LIFF signup ถูก replay เข้าตารางเดียวกันตอน provisioning (surface แยกจาก session) ถ้า release ยังไม่เปลี่ยน; การยอมรับซ้ำเป็น idempotent
- **ข้อผิดพลาด** 403 (ต้องเปลี่ยนรหัสผ่านก่อน), 409 (เวอร์ชันเอกสารเก่า), 403 `legal_acceptance_required` จาก guard
- **ข้อมูล** `LegalDocumentActionRecord` (`LegalDocumentType`, `LegalDocumentAction`, `LegalAcceptanceCapacity`, `LegalAcceptanceSurface`)
- **API** `GET|POST /v1/auth/legal-acceptance`
- **หน้าจอ** `/legal-acceptance` (`LegalAcceptancePage.tsx`), `/terms`, `/privacy`, `/data-deletion`
- **การทดสอบ** `application/legal-acceptance.service.spec.ts`, `packages/contracts/src/legal-acceptance.spec.ts`, `e2e/legal-acceptance.spec.ts`

### FR-CORE-021 ข้อมูลบัญชีของตนเอง (me, บริษัทของฉัน, ชื่อที่แสดง, เบอร์ติดต่อ, ความปลอดภัยบัญชี, ผู้ช่วย AI)

- **คำอธิบาย** ชุด endpoint self-service ของผู้ใช้ที่ล็อกอิน
- **ผู้ใช้/สิทธิ์** ทุกบทบาท; อ่าน `account.session.read`, เขียน `account.password.change` (ยกเว้นชื่อที่แสดงใช้ `account.session.read`)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**

  | Endpoint | พฤติกรรม |
  |---|---|
  | `GET /v1/auth/me` | คืน `userId, displayName, companyId, membershipId, roles, roleNames, permissions, availablePermissions, entitledFeatureKeys, scopes, authProvider, mustChangePassword, canSkipCurrentPassword, legalAcceptanceRequired, manualExpenseWebEntry, disbursementVoucherWebEntry` และ `isDemo/demoExpiresAt`, `freeExpenseDrafts` ถ้ามี |
  | `GET /v1/auth/me/companies` | รายการ membership ACTIVE ในบริษัท ACTIVE หรือบริษัท DISABLED เพราะแพ็กหมดอายุ (พร้อมข้อมูล plan term) — ใช้กับตัวสลับบริษัท |
  | `GET /v1/auth/account/display-name?companyId&userId?` | ประวัติชื่อที่แสดง; ดูของคนอื่นต้องมี `access.employee.update` และเป็นสมาชิกบริษัทเดียวกัน |
  | `PATCH /v1/auth/account/display-name` `{companyId, displayName}` | แก้ชื่อของตนเอง (1–160 ตัวอักษร) |
  | `PATCH /v1/auth/me/contact` `{phoneNumber?}` | ตั้ง/ล้างเบอร์มือถือไทย (`normalizeThaiMobile`); audit `auth.account.contact_update` |
  | `GET /v1/auth/account/security` | `AccountSecurityState`: อีเมล/สถานะยืนยัน, `aiAssistantOptOutAt`, `lineLinked`, `lineLinkedAt`, `lineMessagingReady`, `phoneNumber`, `username`, `hasPassword`, `emailDeliveryEnabled` |
  | `POST /v1/auth/account/ai-assistant` `{enabled}` | ช่องทางคัดค้านตาม PDPA: เปิด/ปิดผู้ช่วย LINE AI ของผู้ใช้ (ตั้ง `User.aiAssistantOptOutAt`); audit `auth.ai_assistant.preference_update` |

- **กฎ/ข้อยกเว้น** การเขียนโปรไฟล์จำกัด 10 ครั้ง/15 นาทีต่อผู้ใช้; `userId` มาจาก session เสมอ ไม่รับจาก body; ค่า `manualExpenseWebEntry` / `disbursementVoucherWebEntry` เป็นค่าตั้งหน้าจอของบริษัท (`CompanyWebEntrySetting`) ไม่ใช่สิทธิ์
- **ข้อผิดพลาด** 400 `account_display_name_invalid`, 403, 404, 429
- **ข้อมูล** `User`, `UserCredential`, `CompanyMembership`, `Role`, `CompanyWebEntrySetting`, `AuthSession`, `AuditLog`
- **API** ตามตาราง
- **หน้าจอ** `/companies/[companyId]/account`, `/companies/[companyId]/settings/profile`, header ของ workspace (ตัวสลับบริษัท)
- **การทดสอบ** `application/use-cases/account-profile.use-case.spec.ts`, `application/use-cases/get-account-security-state.use-case.spec.ts`, `presentation/auth.controller.spec.ts`

### FR-CORE-022 เปิด/ปิดการเข้าใช้งานของลูกค้าทั้งแพลตฟอร์ม (platform access)

- **คำอธิบาย** สวิตช์ระดับแพลตฟอร์ม `OPEN`/`CLOSED`; เมื่อปิด ลูกค้าทุกคนเห็นหน้า maintenance มีเพียง `SYSTEM_ADMIN` ที่เข้าได้
- **ผู้ใช้/สิทธิ์** อ่าน: ทุกคน (`@Public()`); ตั้งค่า: `SYSTEM_ADMIN` ด้วย `system.launch_gate.manage`
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `GET /v1/auth/platform-access` (public), `GET /v1/system/platform-access`, `PUT /v1/system/platform-access` `{state, reason?}` → upsert `PlatformAccessControl{id:'platform'}` + audit `platform.access.state_update` (CRITICAL, metadata from/to/reason) ใน transaction เดียว
- **กฎ/ข้อยกเว้น** `effectiveState` = `CLOSED` เมื่อ production และ `productionServingMode !== 'live'` หรืออ่านแถวควบคุมไม่ได้; ค่าเริ่มต้นเมื่อไม่มีแถว: production = `CLOSED`, อื่น ๆ = `OPEN`; ตั้ง `OPEN` ไม่ได้ถ้า `canOpen = false`
- **ข้อผิดพลาด** 409 `platform_access_open_unavailable`; ลูกค้าได้ 503 `platform_access_closed`
- **ข้อมูล** `PlatformAccessControl` (`PlatformAccessState`), `AuditLog`
- **API** `GET /v1/auth/platform-access`, `GET|PUT /v1/system/platform-access`
- **หน้าจอ** `/system/platform-access`, `/maintenance`
- **การทดสอบ** `auth.guard.spec.ts`, `presentation/auth.controller.spec.ts`

### FR-CORE-023 รับ webhook ของ LINE Messaging (OA ของระบบ)

- **คำอธิบาย** จุดรับเหตุการณ์จาก LINE สำหรับ OA ที่ร้านใช้คุยกับผู้ช่วย AI; โมดูล `auth` ทำเฉพาะตรวจลายเซ็นและส่งเข้า buffer (การประมวลผล AI อยู่ในเอกสารพื้นที่ LINE AI)
- **ผู้ใช้/สิทธิ์** LINE platform; `@Public()` + ลายเซ็น `x-line-signature`
- **แพ็ก** [ALL] (รองรับ `ai_line_assistant`)
- **ขั้นตอนหลัก** `POST /v1/line/webhook` และ `POST /v1/webhooks/line` (path เดิม) → ต้องมี header ลายเซ็น, channel secret (จาก `LineMessagingCredentialsService` โหมด `INBOUND`) และ `rawBody` → `verifyLineWebhookSignature` → บันทึกการสังเกตลายเซ็น → แปลงแต่ละ event เป็น envelope แล้ว `messageBuffer.enqueue` → ตอบ 200 ทันที
- **กฎ/ข้อยกเว้น** ถ้า enqueue ล้มเหลวจะ throw เพื่อให้ LINE ส่งซ้ำ (ไม่ ack เหตุการณ์ที่ไม่ถึง buffer)
- **ข้อผิดพลาด** 401 (ไม่มี header / ไม่มี secret / ไม่มี raw body / ลายเซ็นผิด) + security event `line.webhook.signature_invalid`
- **ข้อมูล** `PlatformLineCredential`, `LineWebhookEventLog` (เขียนโดยชั้นถัดไป)
- **API** `POST /v1/line/webhook`, `POST /v1/webhooks/line`
- **หน้าจอ** ไม่มี
- **การทดสอบ** `line-webhook.controller.spec.ts`

### FR-CORE-024 ตอบกลับอัตโนมัติของ Official OA (เมนูติดต่อ/โซเชียล)

- **คำอธิบาย** webhook ของ Official OA ตอบการ์ด Flex ตายตัวเมื่อผู้ใช้พิมพ์คำสำคัญ ไม่มีสถานะ ERP/AI
- **ผู้ใช้/สิทธิ์** LINE platform; `@Public()` + ลายเซ็น
- **แพ็ก** [PUBLIC]
- **เงื่อนไขก่อนทำ** `LINE_OFFICIAL_REPLY_ENABLED = true` (ค่าเริ่มต้น false → 404) และตั้ง `LINE_OFFICIAL_CHANNEL_SECRET`, `LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN`
- **ขั้นตอนหลัก** `POST /v1/line/official/webhook` → ตรวจลายเซ็น → เฉพาะ event ข้อความตัวอักษรจากผู้ใช้เดี่ยวที่มี `replyToken` → `officialOaReplyForText`: คำว่า `ติดต่อมั่งมีทีม` / `ติดต่อเรา` / `contact us` → การ์ดติดต่อ; `social media` / `โซเชียล` / `ติดตามน้องมั่งมี` → การ์ดโซเชียล; อื่น ๆ ไม่ตอบ → เรียก LINE reply API (timeout 5 วินาที)
- **ข้อผิดพลาด** 404 (ปิดอยู่), 401 (ลายเซ็น), 502 `Official OA reply unavailable.` (ยกเว้น reply token ใช้ไม่ได้ซึ่งถือว่าจบ)
- **ข้อมูล** ไม่มี (การ์ดเป็นไฟล์ JSON `domain/logic/line-official-contact-card.json`, `line-official-social-card.json`)
- **API** `POST /v1/line/official/webhook`
- **หน้าจอ** ไม่มี
- **การทดสอบ** `line-official-webhook.controller.spec.ts`

### FR-CORE-025 การส่งอีเมลระบบ, เหตุการณ์จาก Postmark และคอนโซลตรวจการส่งอีเมล

- **คำอธิบาย** โครงสร้างส่งอีเมลของระบบ (OTP, รีเซ็ตรหัสผ่าน, claim link, ประกาศความปลอดภัย) มี ledger การส่ง, การรับ callback และหน้าจอผู้ดูแลระบบสำหรับดูสถานะแบบปลอดภัย
- **ผู้ใช้/สิทธิ์** ระบบ; คอนโซล: `SYSTEM_ADMIN` ด้วย `system.email_delivery.read` (แก้นโยบายเก็บประวัติเพิ่ม `system.email_delivery.manage`); callback: `@Public()` + HTTP Basic auth
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**
  - `EmailDeliveryService.prepare()` สร้าง `EmailSendAttempt` (idempotent ด้วย `intentKey`) ใน transaction ของผู้เรียก; `send()` ส่งผ่าน adapter (`postmark-auth-mailer`, `ses-auth-mailer`, `local-console-auth-mailer`, `disabled-auth-mailer`); ลองใหม่ตามตาราง `[1, 5, 15, 60]` นาที
  - `POST /v1/public/postmark-events` → ตรวจ Basic auth แบบ constant-time; ตรวจ server id และ message stream ตรงกับ config; เก็บเฉพาะข้อเท็จจริงที่ผ่านการกรอง (ไม่เก็บเนื้อหา/หัวเรื่อง) ลง outbox ชนิด `email.postmark.event.received`; ผ่านได้แม้ platform CLOSED
  - `GET /v1/system/email-delivery` (รายการสังเกตการส่งแบบ cursor), `GET …/connection` (ตรวจการเชื่อมต่อ มี rate limit), `GET …/retention`, `PUT …/retention` (`{scopeKey, commandId(UUID), version, …}` แบบ compare-and-set + idempotent ต่อ `commandId`)
  - การล้างประวัติอีเมลตามนโยบาย (`email-history-retention.ts`) ทำเป็นชุดจำกัดขนาด โดยคงรายการที่ยังไม่แน่ชัด, proof ที่ยังใช้งาน, suppression และงานที่ยังไม่เสร็จ
- **กฎ/ข้อยกเว้น** ผู้อ่านคอนโซลต้องมีทั้งบทบาท `SYSTEM_ADMIN` และ permission (ตรวจซ้ำใน service); ผลลัพธ์ผูกกับ scope ของบัญชีส่งเมลปัจจุบัน ถ้า config เปลี่ยนระหว่างอ่านจะให้โหลดใหม่
- **ข้อผิดพลาด** 401 (callback), 400 `Invalid Postmark event` / `Postmark environment mismatch`, 503 `Email event persistence unavailable`, 409 เมื่อ scope/version ของนโยบายเปลี่ยนระหว่างทาง, 429 สำหรับการตรวจการเชื่อมต่อถี่เกิน
- **ข้อมูล** `EmailSendAttempt`, `EmailSuppression`, `EmailHistoryPolicy`, `OutboxEvent`
- **API** `POST /v1/public/postmark-events`, `GET /v1/system/email-delivery`, `GET /v1/system/email-delivery/connection`, `GET|PUT /v1/system/email-delivery/retention`; (SES: `POST /v1/public/ses-events` — FR-CORE-057)
- **หน้าจอ** `/system/email-delivery` (`features/system-email-delivery`), `/system/signup-requests/[id]/mail`
- **การทดสอบ** `postmark-delivery.pg.spec.ts`, `infrastructure/postmark.client.spec.ts`, `infrastructure/postmark-configuration.spec.ts`, `infrastructure/ses-auth-mailer.adapter.spec.ts`, `infrastructure/account-claim-email.template.spec.ts`

### FR-CORE-026 Dev token (เฉพาะเครื่องนักพัฒนา)

- **คำอธิบาย** ออก token โดยไม่ต้องใช้รหัสผ่านเพื่อการพัฒนา
- **ผู้ใช้/สิทธิ์** `@Public()` แต่ทำงานเฉพาะ `config.isLocal`
- **แพ็ก** ไม่เกี่ยวกับแพ็ก (เครื่องมือพัฒนา)
- **ขั้นตอนหลัก** `POST /v1/auth/dev/token` `{userId?}` → ถ้าไม่ระบุ ใช้ membership OWNER ที่เก่าสุด → `IssueTokenUseCase(userId, 'dev')`
- **กฎ/ข้อยกเว้น** นอก local ตอบ 404 เสมอ; `DevJwtVerifierAdapter` ถูกลองเฉพาะเมื่อไม่ใช่ production
- **ข้อผิดพลาด** 404
- **ข้อมูล** `CompanyMembership`, `AuthSession`
- **API** `POST /v1/auth/dev/token`
- **หน้าจอ** BFF `POST /api/auth/dev-login`
- **การทดสอบ** `auth-endpoints.spec.ts`

---

## 4. Access control (`access-control`)

ไฟล์: `apps/api/src/modules/access-control/` (`application/permission-resolver.service.ts`, `infrastructure/prisma-permission-resolver.repository.ts`, `infrastructure/policies/*`, `domain/logic/plan-manager.logic.ts`), `apps/api/src/common/security/deny-by-default.guard.ts`, `permissions.decorator.ts`, `public.decorator.ts`, `apps/api/src/modules/auth/permission-registry.ts`. โมดูลนี้ไม่มี controller ของตนเอง

### FR-CORE-030 ปฏิเสธโดยปริยาย (deny-by-default) และ metadata สิทธิ์ของ route

- **คำอธิบาย** ทุก route ที่ไม่ได้ติด `@Public()` ต้องประกาศ permission; ผู้เรียกต้องถือครบทุก key ใน `@RequirePermissions` และอย่างน้อยหนึ่ง key ใน `@RequireAnyPermission`
- **ผู้ใช้/สิทธิ์** ทุกคำขอ
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `DenyByDefaultGuard.canActivate`: public → ผ่าน; ไม่มี `request.context` → 401; ไม่มี metadata ทั้งสองแบบ → 403 `Permission metadata is required.`; ตรวจ `PermissionSet.hasAll` / `has`
- **กฎ/ข้อยกเว้น** ถ้า permission ที่ขาด **ทุกตัว** อยู่ใน `entitlementDeniedPermissions` (role ให้ไว้แต่ถูกตัดเพราะฟีเจอร์ปิด) ตอบ 403 `{code:'feature_not_enabled', featureKey}`; มิฉะนั้นตอบ `Insufficient permissions.` โดยไม่เปิดเผยการตั้งค่าฟีเจอร์
- **ข้อผิดพลาด** 401 `Authentication is required.`, 403 ตามข้างต้น
- **ข้อมูล** ไม่มี (ใช้ `RequestContext`)
- **API** ทุก route
- **หน้าจอ** web แสดงตาม `code` (`apps/web/src/common/api/api-error.logic.ts`)
- **การทดสอบ** `access-control/policies.spec.ts`, `health/health.spec.ts`, `e2e/feature-entitlement-accessibility.spec.ts`

### FR-CORE-031 การ resolve สิทธิ์ของผู้ใช้ต่อบริษัท (permission resolver)

- **คำอธิบาย** จาก `userId` (+ `companyId` ที่ขอ) คืน membership, roles, permissions, branch scope และข้อมูล entitlement
- **ผู้ใช้/สิทธิ์** ภายใน (AuthGuard, IssueToken, LINE)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** (`prisma-permission-resolver.repository.ts`)
  1. ระบุ `companyId` → หา membership `ACTIVE` ของบริษัทนั้น; ไม่ระบุ → เลือกตามลำดับ: membership ที่มีบทบาท `SYSTEM_ADMIN` ในบริษัท ACTIVE → membership เก่าสุดในบริษัท ACTIVE → membership ในบริษัท DISABLED เพราะแพ็กหมดอายุ
  2. ไม่พบ → 403 (`company_membership_disabled` ถ้า membership เป็น `DISABLED`/`SUSPENDED`, มิฉะนั้น `No active company membership.`)
  3. บริษัทไม่ `ACTIVE` → 403 (`company_term_expired` ถ้า term-disabled; `Company is not active.` ถ้าผู้ดูแลพักไว้) ยกเว้น `allowTermRecovery` (server เลือกเอง ไม่รับจากคำขอ) หรือโหมด free-expense-drafts
  4. ใช้เฉพาะ role ที่ `status = ACTIVE`; รวม permission key ของทุก role แบบไม่ซ้ำ
  5. `loadEntitledFeatureKeys` → `filterPermissionsByEntitlement` (FR-CORE-032)
  6. branch scope (FR-CORE-033)
  7. คืน `availablePermissions` (ทุก key ในระบบที่แพ็กของบริษัทเปิดให้ — ใช้แสดงผลเท่านั้น) และ `entitledFeatureKeys` (`null` = บริษัทรุ่นเก่าที่ไม่มีแถว entitlement → เปิดทุกฟีเจอร์)
- **กฎ/ข้อยกเว้น** บริษัท `reportClassification = DEMO` ตั้ง `isDemo` + `demoExpiresAt`
- **ข้อผิดพลาด** 403 ตามข้างต้น, 403 `No active branch scope assigned.`
- **ข้อมูล** `CompanyMembership`, `MembershipRole`, `Role`, `RolePermission`, `Permission`, `MembershipBranchScope`, `Branch`, `Company`, `CompanyPlanTerm`, `CompanyFeatureEntitlement`
- **API** ไม่มีโดยตรง (ผลปรากฏใน `GET /v1/auth/me`)
- **หน้าจอ** ไม่มีโดยตรง
- **การทดสอบ** `access-control/permission-resolver.spec.ts`

### FR-CORE-032 การตัดสิทธิ์ตาม feature entitlement ของบริษัท

- **คำอธิบาย** permission ที่เป็นของฟีเจอร์ที่บริษัทไม่ได้เปิด ถูกตัดออกตั้งแต่ขั้น resolve ทำให้ API guard, เมนูเว็บ และเครื่องมือ LINE AI ปฏิเสธพร้อมกัน — รวมถึง `OWNER`
- **ผู้ใช้/สิทธิ์** ทุกบทบาท
- **แพ็ก** [ALL] (เป็นกลไกที่ทำให้ "แพ็กไหนได้อะไร" มีผลจริง)
- **ขั้นตอนหลัก** (`employee-access/domain/logic/feature-gate.logic.ts`, `application/entitlement.helper.ts`) แมป permission → feature จาก (ก) `SUBFEATURE_RULES` ที่ได้จาก `FEATURE_CATALOG.submenus[].permissionKeys` (ข) กฎ prefix ที่ตรวจก่อน pack (เช่น `dashboard.` / `notification.` → `dashboard_notifications`; `reimbursement.` → `reimbursement`; `report.` → `reports`; `crm.channel.` → `line_oa`; `crm.ai.` และ `ai.suggestion.` / `ai.draft.` → `ai_line_assistant`; `crm.` → `crm`; `accounting.counterparty.` → `expenses` หรือ `sales_documents`; `inventory.product.` → product catalog) (ค) `featureEntitlementKey` ของ capability pack; permission ที่ไม่แมปกับอะไรไม่ถูก gate
- **กฎ/ข้อยกเว้น** `employee_access` และ `company_settings` เปิดเสมอ; บริษัทที่ไม่มีแถว entitlement เลย = fail-open (รุ่นเก่า); ความสัมพันธ์บังคับ `FEATURE_DEPENDENCIES`: `expense_auto_post ⇒ double_entry_ledger`, `procurement.supplier_payments ⇒ procurement.vendor_bills`, `procurement.ap_aging ⇒ procurement.vendor_bills`
- **ข้อผิดพลาด** 403 `feature_not_enabled` (ไม่ได้ซื้อ) ต่างจาก 403 `feature_temporarily_unavailable` (ซื้อแล้วแต่ launch gate ปิด — FR-CORE-082)
- **ข้อมูล** `CompanyFeatureEntitlement`, `CompanyEntitlementSet`
- **API** ทุก route (ทางอ้อม)
- **หน้าจอ** เมนูซ้าย/การ์ดตั้งค่าถูกซ่อนตาม permission ที่เหลือ
- **การทดสอบ** `employee-access/domain/logic/feature-gate.logic.spec.ts`, `domain/logic/menu-entitlement-binding.spec.ts`, `application/entitlement.helper.spec.ts`, `packages/contracts/src/feature-entitlements.spec.ts`, `e2e/feature-entitlement-accessibility.spec.ts`

### FR-CORE-033 ขอบเขตสาขา (branch scope ABAC)

- **คำอธิบาย** membership แต่ละรายมีโหมดขอบเขตสาขา กำหนดว่าผู้ใช้เห็น/บันทึกรายการของสาขาใดได้
- **ผู้ใช้/สิทธิ์** กำหนดโดยผู้ที่มี `access.employee.update` (FR-CORE-042)
- **แพ็ก** [ALL] (จำนวนสาขาที่มีได้ขึ้นกับแพ็ก — §1.2)
- **ขั้นตอนหลัก** `resolveBranchIds(mode, selectedBranchIds, defaultBranchId)`: `ALL_BRANCHES` → `undefined` (ไม่จำกัด); `SELECTED_BRANCHES` → สาขา ACTIVE ที่เลือก; `DEFAULT_BRANCH_ONLY` → `[defaultBranchId]`; สาขาเริ่มต้นถูกเรียงไว้ลำดับแรก; ผลอยู่ใน `RequestContext.scopes.branchIds`
- **กฎ/ข้อยกเว้น** ตัวช่วยบังคับใช้ (`data-model-core/domain/logic/branch.logic.ts`): `isBranchInScope` (scope `undefined` = ไม่จำกัด; รายการที่ `branchId = null` เป็นส่วนกลางของบริษัท เห็นได้ทุกคน), `branchScopeWhere` (Prisma fragment), `resolveCreateBranchId` (ระบุชัด > สาขาแรกใน scope > `null`); บทบาทกำกับดูแล `ALL_BRANCH_ROLE_KEYS` (`OWNER, SYSTEM_ADMIN, COMPANY_VIEW, ADMIN, HR, AUDITOR_READONLY, FINANCE, ACCOUNTANT`) ต้องเป็น `ALL_BRANCHES` เสมอ (บังคับที่ทางเขียนของพนักงาน)
- **ข้อผิดพลาด** 403 `No active branch scope assigned.` (เลือกสาขาแต่ไม่เหลือสาขา ACTIVE), 403 `Branch is outside your assigned branch scope.`
- **ข้อมูล** `CompanyMembership.branchScopeMode/defaultBranchId`, `MembershipBranchScope`, `Branch`
- **API** ทุก route ที่อ่าน/เขียนข้อมูลผูกสาขา
- **หน้าจอ** `WorkspaceScope.tsx`, `TransactionBranchField.tsx`, `branch-scope-label.logic.ts`
- **การทดสอบ** `data-model-core/domain/logic/branch.logic.spec.ts`, `domain/logic/p1-branch-authorization-matrix.spec.ts`, `employee-access/application/use-cases/update-employee-branch-scope.spec.ts`, `e2e/branch-scope.spec.ts`, `e2e/transaction-branch.spec.ts`

### FR-CORE-034 นโยบายขอบเขตผู้เช่า (tenant boundary) และเจ้าของรายการ (own record)

- **คำอธิบาย** ตัวประเมินนโยบายรวม: ข้ามบริษัท = ปฏิเสธ; รายการของตนเอง = อนุญาต; `OWNER`/`ADMIN` = อนุญาตแทน
- **ผู้ใช้/สิทธิ์** ภายใน
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `CompositePolicyEvaluator`: deny แรกชนะ, เก็บ allow แรก, ไม่เข้าเงื่อนไข = `not_applicable`; `TenantBoundaryPolicy` เทียบ `resourceCompanyId` กับ `companyId`; `OwnRecordPolicy` เทียบ `resourceOwnerId` กับ `userId`
- **กฎ/ข้อยกเว้น** `AuthGuard` บังคับ header กับ route company ตรงกันแบบรวมศูนย์; controller เรียก `assertRouteCompany(ctx, companyId)` ซ้ำ (`data-model-core/presentation/http/assert-route-company.ts`); `common/security/abac/company-scope.policy.ts` และ `own-record.policy.ts` เป็น placeholder ที่มีคอมเมนต์ระบุไว้ในโค้ด
- **ข้อผิดพลาด** 403
- **ข้อมูล** ไม่มีเฉพาะ
- **API** ทุก route ของร้าน
- **หน้าจอ** ไม่มี
- **การทดสอบ** `access-control/policies.spec.ts`

### FR-CORE-035 ผู้มีสิทธิ์จัดการแพ็กเกจ (plan manager)

- **คำอธิบาย** คำถาม "ใครจัดการแพ็กเกจของร้านได้" ตอบด้วยเงื่อนไขเดียวทั้งเว็บและ LINE: สมาชิก ACTIVE ที่มี role ACTIVE ซึ่งให้ `company.plan.manage`
- **ผู้ใช้/สิทธิ์** `company.plan.manage` (OWNER ถือโดยปริยาย; role กำหนดเองถือได้ถ้าเจ้าของเป็นผู้ให้)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `planManagerRoleFilter()`, `canManagePlan(roles)`, `planManagersOf(db, companyId)`, `planManagerLineUserIds(db, companyId, channelId)` (`domain/logic/plan-manager.logic.ts`)
- **กฎ/ข้อยกเว้น** ผู้ที่ไม่มีสิทธิ์เห็นข้อความ `ASK_PLAN_MANAGER_TH` แทนปุ่มซื้อ; การให้ `company.plan.manage` แก่ role ทำได้เฉพาะ OWNER (FR-CORE-046)
- **ข้อมูล** `CompanyMembership`, `Role`, `RolePermission`, `ExternalIdentity`
- **API** ใช้โดย `POST /v1/companies/:companyId/package-change-requests` (FR-CORE-058) และพื้นที่ billing
- **หน้าจอ** `/companies/[companyId]/billing`, `/companies/[companyId]/renew`
- **การทดสอบ** `access-control/domain/logic/plan-manager.logic.spec.ts`

### FR-CORE-036 ทะเบียน permission, บทบาทระบบ และการ sync ลงฐานข้อมูล

- **คำอธิบาย** `permission-registry.ts` เป็นแหล่งความจริงของ permission key (`PERMISSIONS` พร้อม risk level), บทบาทระบบ (`SYSTEM_ROLES`) และ grant (`ROLE_GRANTS`); ถูก import โดย seed และ sync script เพื่อเขียน `Permission`, `Role`, `RolePermission`
- **ผู้ใช้/สิทธิ์** ระบบ (deploy)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** บทบาทระบบถูก re-sync ทุก deploy จาก `ROLE_GRANTS`; บทบาทที่บริษัทสร้างเองเก็บ `RolePermission` แบบ materialized จึงมีทะเบียน `COMPANY_ROLE_BACKFILLS` (`employee-access/domain/registries/company-role-backfill.registry.ts`) ให้ `prisma/sync-permissions.ts` เติม key ให้ครั้งเดียวต่อ role (เขียน audit actor `SYSTEM`, requestId `sync-permissions:<key>`) และไม่เติมซ้ำถ้าผู้ดูแลของร้านถอนออกภายหลัง
- **กฎ/ข้อยกเว้น** `COMPANY_PERMISSION_KEYS` = ทุก key ที่ไม่ขึ้นต้น `system.` หรือ `sales.` (สิ่งที่ `OWNER` ถือ); `PLATFORM_ONLY_ROLE_KEYS` = บทบาททีมขายและผู้บริหารมั่งมี ใช้ได้เฉพาะใน platform tenant; `PLATFORM_ROLE_KEYS` = `SYSTEM_ADMIN` + รายการนั้น
- **ข้อมูล** `Permission` (`PermissionRiskLevel`), `Role` (`isSystem`, `scopeKey`, `status`), `RolePermission`, `AuditLog`
- **API** ไม่มี
- **หน้าจอ** ไม่มี
- **การทดสอบ** `auth/permission-registry.spec.ts`, `employee-access/domain/logic/role-template-system-role-parity.spec.ts`, `e2e/_roles-reference.spec.ts`
- **หมายเหตุ** ตารางเต็มอยู่ใน §17–§18

---

## 5. พนักงานและบทบาท (`employee-access`)

ไฟล์: `apps/api/src/modules/employee-access/` — controller ใน `presentation/http/` (`employee.controller.ts`, `role.controller.ts`, `permission.controller.ts`, `access-catalog.controller.ts`, `entitlement-exception.controller.ts`, `business-policy.controller.ts`), ตรรกะใน `domain/logic/employee-access.logic.ts`, ทะเบียนใน `domain/registries/`, contract ใน `packages/contracts/src/employee-access.ts`, `access-matrix.ts`

ระบบไม่มี "คำเชิญทางอีเมล": การเพิ่มพนักงานคือการสร้างบัญชี + รหัสผ่านเริ่มต้น (วันเกิด `DDMMYYYY` ที่ต้องเปลี่ยนเมื่อเข้าใช้ครั้งแรก) + QR ผูก LINE ที่ผู้ดูแลส่งมอบเอง (ค่า `INVITED` มีใน enum `EmployeeAccessStatus` และถูกนับในบางคำสั่ง แต่ไม่พบทางเขียนสถานะนี้ใน use case ของโมดูล)

### FR-CORE-040 ดูรายชื่อและรายละเอียดพนักงาน

- **คำอธิบาย** รายการพนักงานของบริษัทพร้อมบทบาท สถานะ ขอบเขตสาขา และเลขประจำตัวแบบปิดบัง
- **ผู้ใช้/สิทธิ์** รายการ: `access.employee.read`; รายละเอียด: `access.employee.read` หรือ `access.employee.update`
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/settings/employees` → `EmployeeSummary[]`; `GET …/employees/:employeeId` → `EmployeeDetail` (ฟิลด์: ชื่อ, คำนำหน้า `นาย/นาง/นางสาว`, ตำแหน่งงาน `jobTitle`, อีเมล, `sharedAccount`, วันเกิด, ที่อยู่, `identityType`, `identityMasked` (`*********<last4>`), เบอร์โทร, `status`, `roles`, `branchScopeMode`, `defaultBranchId`, `branchScopeBranchIds`, `mustChangePassword`, `lineLinked`)
- **กฎ/ข้อยกเว้น** เลขบัตร/พาสปอร์ตไม่ถูกคืนเต็ม (เก็บ `identityLast4`, `identityHash` แบบ HMAC, `identityEncryptedRef`); `jobTitle` เป็นข้อมูลแสดงผล ไม่ให้สิทธิ์ใด
- **ข้อผิดพลาด** 404 `Employee not found`
- **ข้อมูล** `EmployeeAccessProfile`, `CompanyMembership`, `MembershipRole`, `Role`, `User`, `UserCredential`, `ExternalIdentity`
- **API** `GET /v1/companies/:companyId/settings/employees`, `GET …/employees/:employeeId`
- **หน้าจอ** `/companies/[companyId]/settings/employees`, `/companies/[companyId]/settings/access-overview`
- **การทดสอบ** `application/use-cases/employee-lifecycle.use-case.spec.ts`, `e2e/journeys/team-and-roles.journey.spec.ts`, `e2e/employee-job-title.spec.ts`

### FR-CORE-041 เพิ่มพนักงาน (wizard: ร่าง → ทำให้เสร็จ) และการผูกบัญชีที่มีอยู่แล้ว

- **คำอธิบาย** สร้างพนักงานเป็นร่าง กำหนดบทบาทหนึ่งบทบาท แล้วทำให้เสร็จเพื่อเปิดใช้งาน; ได้ชุดส่งมอบ (username, รหัสผ่านเริ่มต้นจากวันเกิด, QR ผูก LINE)
- **ผู้ใช้/สิทธิ์** `access.employee.create` (OWNER, ADMIN, HR)
- **แพ็ก** [ALL] — จำนวนที่นั่งจำกัดตาม `CompanyPlanTerm.employeeLimit` (2 / 2 / 5 / 10 / 30 ตามแพ็ก; บริษัทที่ไม่มีแถว plan term ไม่จำกัด)
- **เงื่อนไขก่อนทำ** ผู้ขอมีสิทธิ์ให้บทบาทที่เลือก (ดูกฎ)
- **ขั้นตอนหลัก** (`create-employee.use-case.ts`)
  1. `POST …/employees` พร้อม `CreateEmployeeInput` (username, displayName, titlePrefix?, jobTitle?, dateOfBirth, identityType `THAI_NATIONAL_ID`/`PASSPORT`, identityNumber, phoneNumber, `roleIds` ต้องมี 1 รายการพอดี, `linkExistingUser?`, ที่อยู่ ฯลฯ)
  2. ตรวจ role มีอยู่และ `roleGrantViolation` ผ่าน (ถ้าไม่ผ่านเขียน audit `access.employee.role.assign` ผล DENIED แล้ว 403)
  3. ตรวจซ้ำในบริษัท: เลขประจำตัว (hash), เบอร์โทร, อีเมล, username
  4. ถ้ามีร่างของบุคคลเดียวกันอยู่แล้ว → ทำต่อจากร่าง (ไม่ซื้อที่นั่งเพิ่ม)
  5. ถ้า username ตรงกับบัญชีที่มีอยู่ (เช่นเจ้าของร้านอื่น) → 409 `employee_existing_user`; ส่งซ้ำพร้อม `linkExistingUser=true` เพื่อผูก membership ใหม่กับบัญชีเดิม (`attachExistingUser`) โดยไม่แตะรหัสผ่าน/username/อีเมลของบัญชีนั้น และต้องให้อีเมลในร้านที่ต่างจากอีเมลล็อกอิน
  6. มิฉะนั้นสร้าง `User` + `UserCredential` + `CompanyMembership` + `MembershipRole` + `EmployeeAccessProfile` สถานะ `DRAFT` + LINE link token; audit `access.employee.create` — **รหัสผ่านเริ่มต้นของพนักงานใหม่คือวันเกิดในรูป `DDMMYYYY`** (`employeePasswordFromDateOfBirth(cmd.dateOfBirth)`), credential ถูกตั้ง `status ACTIVE`, `mustChangePassword: true`, `expiresAt: null` (ไม่หมดอายุ) และ `tempPasswordEncrypted: null`; ค่านี้ถูกคืนใน `EmployeeCredentialHandoff.temporaryPassword` (ว่างเมื่อผูกบัญชีเดิม)
  7. `POST …/employees/:employeeId/complete` → ตรวจขีดจำกัดที่นั่ง แล้วเปลี่ยนเป็น `ACTIVE`
- **กฎ/ข้อยกเว้น**
  - `roleGrantViolation` (`employee-access.logic.ts`): ห้ามให้ `OWNER`/`SYSTEM_ADMIN`/`COMPANY_VIEW`; บทบาท platform-only ใช้ได้เฉพาะ platform tenant; role ที่มี `company.plan.manage` ให้ได้เฉพาะเจ้าของ; เจ้าของให้ได้ทุก role ของบริษัท; ผู้ถือ `access.role.operational.assign` (ไม่มี `access.role.manage`) ให้ได้เฉพาะบทบาทระบบ `MANAGER, SALES, INVENTORY, MARKETING, STAFF`; ผู้อื่นให้ได้เฉพาะ role ที่ permission เป็นเซตย่อยของตนเอง (นับรวม permission ที่ถูกตัดเพราะฟีเจอร์ปิด); `FINANCE`/`ACCOUNTANT` ต้องมี `access.role.financial.assign`
  - username เปรียบเทียบด้วย `lower()` แบบตรงตัว (ไม่ใช้ ILIKE เพราะ `_` เป็น wildcard); ลองสร้าง username สูงสุด 5 ครั้ง
  - บทบาทกำกับดูแล (FR-CORE-033) ทำให้ membership ถูกขยายเป็น `ALL_BRANCHES` ใน transaction เดียวกับการเขียน role
- **ข้อผิดพลาด** 400 `Exactly one employee role is required.`; 403 (role ไม่ถูกต้อง/ละเมิดกฎ); 409 `employee_identity_conflict`, `employee_phone_conflict`, `employee_email_conflict`, `employee_username_conflict`, `employee_existing_user`, `employee_email_must_differ`, `Only an employee draft can be completed.`; 422 เมื่อเกินขีดจำกัดที่นั่ง
- **ข้อมูล** `User`, `UserCredential`, `CompanyMembership`, `MembershipRole`, `EmployeeAccessProfile` (`EmployeeIdentityType`), `EmployeeLineLinkToken`, `CompanyPlanTerm`, `AuditLog`
- **API** `POST /v1/companies/:companyId/settings/employees`, `POST …/employees/:employeeId/complete`
- **หน้าจอ** `/companies/[companyId]/settings/employees` (wizard เพิ่มพนักงาน — `features/employee-access`)
- **การทดสอบ** `application/use-cases/create-employee.use-case.spec.ts`, `create-employee-username.pg.spec.ts`, `domain/logic/employee-access.logic.spec.ts`, `e2e/journeys/team-and-roles.journey.spec.ts`

### FR-CORE-042 แก้ไขพนักงาน บทบาท ตำแหน่งงาน และขอบเขตสาขา

- **คำอธิบาย** แก้ข้อมูลโปรไฟล์, เปลี่ยนบทบาท (แทนที่ด้วยหนึ่งบทบาท), ตั้ง `jobTitle`, กำหนด `branchScopeMode` / `defaultBranchId` / `branchIds`
- **ผู้ใช้/สิทธิ์** `access.employee.update` (OWNER, ADMIN, MANAGER, HR)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `PATCH …/employees/:employeeId` พร้อม `UpdateEmployeeInput` → ตรวจกฎ → transaction: ปรับโปรไฟล์ / `User` (ชื่อ, อีเมล — เฉพาะบัญชีที่ไม่ได้ใช้ร่วมกับร้านอื่น), แทนที่ role, แทนที่ชุด `MembershipBranchScope` → audit `access.employee.update` หรือ `access.employee.role.assign`
- **กฎ/ข้อยกเว้น** ห้ามเปลี่ยน role ของตนเอง; ห้ามแก้การมอบ `OWNER`/role แพลตฟอร์ม; การให้ role ใช้ `roleGrantViolation` เดียวกับ FR-CORE-041; ผู้แก้ที่ถูกจำกัดสาขาแก้ได้เฉพาะพนักงานที่ scope ปัจจุบันอยู่ในขอบเขตของตน และผลลัพธ์ต้องอยู่ในขอบเขตด้วย; สาขาที่อ้างต้องเป็นของบริษัทและ `ACTIVE`; `SELECTED_BRANCHES` ต้องเหลืออย่างน้อย 1 สาขา; `DEFAULT_BRANCH_ONLY` ต้องมีสาขาเริ่มต้น; บทบาทกำกับดูแลห้ามจบด้วย scope แคบ (ระบุ scope แคบ = 403; มอบบทบาทเฉย ๆ = ขยายอัตโนมัติ); บัญชีที่ใช้ร่วมหลายร้านเก็บอีเมลของร้านไว้ในโปรไฟล์ ไม่แตะ `User.email`
- **ข้อผิดพลาด** 404; 400 `Exactly one employee role is required.`; 403 (`Users cannot change their own role assignment.`, `Owner and platform role assignments cannot be changed through employee management.`, `One or more branches are invalid for this company.`, `SELECTED_BRANCHES requires at least one branch.`, `DEFAULT_BRANCH_ONLY requires a default branch.`, `Role <KEY> requires access to all branches.`); 409 (เบอร์โทร/อีเมล/เลขประจำตัวซ้ำ, `employee_email_must_differ`)
- **ข้อมูล** `EmployeeAccessProfile`, `User`, `CompanyMembership`, `MembershipRole`, `MembershipBranchScope`, `Branch`, `AuditLog`
- **API** `PATCH /v1/companies/:companyId/settings/employees/:employeeId`
- **หน้าจอ** `/companies/[companyId]/settings/employees`, `/companies/[companyId]/settings/access-overview`
- **การทดสอบ** `application/use-cases/update-employee-branch-scope.spec.ts`, `application/use-cases/employee-lifecycle.use-case.spec.ts`, `e2e/employee-job-title.spec.ts`, `e2e/branch-scope.spec.ts`

### FR-CORE-043 ระงับ ปิด เปิดใช้งานพนักงาน และลบร่าง

- **คำอธิบาย** เปลี่ยนสถานะการเข้าถึงของพนักงานเป็น `ACTIVE` / `SUSPENDED` / `DISABLED` และลบร่างที่ยังไม่เสร็จ
- **ผู้ใช้/สิทธิ์** `access.employee.disable` (OWNER, ADMIN, MANAGER, HR)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `POST …/employees/:employeeId/disable` `{status, reason?}` (`SetEmployeeStatusUseCase`) → ปรับ `EmployeeAccessProfile.status` และ `CompanyMembership.status` พร้อมกัน; `DELETE …/employees/:employeeId/draft` → revoke LINE link token, ลบ membership ของบริษัทนี้ (โปรไฟล์/role/branch scope ลบตาม; บัญชีผู้ใช้ที่ใช้ร่วมคงอยู่), audit `access.employee.draft.delete`
- **กฎ/ข้อยกเว้น** ร่างเปลี่ยนสถานะได้ด้วยการ complete เท่านั้น; ห้ามระงับ/ปิดเจ้าของร้านและบทบาทแพลตฟอร์ม; ผู้ที่ไม่มี `access.role.manage` ระงับ/ปิด/ลบร่างของผู้ถือบทบาทบริหารคน (เช่น Admin, Manager) ไม่ได้; การเปิดใช้งานจาก `SUSPENDED`/`DISABLED` กลับเป็น `ACTIVE` ต้องผ่านขีดจำกัดที่นั่ง (เช่นเดียวกับ complete); การตั้ง `ACTIVE` ซ้ำเป็น no-op
- **ข้อผิดพลาด** 404; 403 (`Owner and platform access cannot be suspended or disabled from employee management.`, `Changing status of people-managing roles requires access.role.manage.`); 409 (`Draft employee status can only be changed by completing the employee wizard.`, `employee_draft_not_deletable`); 422 เกินขีดจำกัดที่นั่ง
- **ข้อมูล** `EmployeeAccessProfile`, `CompanyMembership`, `EmployeeLineLinkToken`, `CompanyPlanTerm`, `AuditLog`
- **API** `POST …/employees/:employeeId/disable`, `DELETE …/employees/:employeeId/draft`
- **หน้าจอ** `/companies/[companyId]/settings/employees`
- **การทดสอบ** `application/use-cases/employee-lifecycle.use-case.spec.ts`

### FR-CORE-044 ออกรหัสผ่านชั่วคราวใหม่ให้พนักงาน

- **คำอธิบาย** ผู้ดูแลออกรหัสผ่านชั่วคราวใหม่แบบสุ่ม (12 ตัวอักษรจาก `generateTemporaryPassword()`, อายุ 72 ชั่วโมงตาม `temporaryPasswordExpiry`, บังคับเปลี่ยนเมื่อเข้าใช้) — ต่างจากรหัสเริ่มต้นตอนสร้างพนักงานซึ่งเป็นวันเกิดและไม่หมดอายุ (FR-CORE-041)
- **ผู้ใช้/สิทธิ์** `access.employee.credential.issue` (OWNER, ADMIN) — ระดับ CRITICAL
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `POST …/employees/:employeeId/credentials/regenerate` → ตั้ง credential ใหม่ + audit `access.employee.credential.issue` → หลัง commit พยายามส่งการ์ดรหัสผ่านไป LINE ที่ผูกกับผู้ใช้นั้น (best-effort) → คืน `EmployeeCredentialHandoff` (`temporaryPassword`, `expiresAt`, `lineNotified`)
- **กฎ/ข้อยกเว้น** พนักงานที่ใช้บัญชีจากร้านอื่น (shared account) ออกรหัสใหม่ที่นี่ไม่ได้
- **ข้อผิดพลาด** 404; 403 `This employee signs in with an existing account from another company; its password cannot be regenerated here.`
- **ข้อมูล** `UserCredential` (`tempPasswordEncrypted`), `AuditLog`
- **API** `POST /v1/companies/:companyId/settings/employees/:employeeId/credentials/regenerate`
- **หน้าจอ** `/companies/[companyId]/settings/employees`
- **การทดสอบ** `application/use-cases/regenerate-employee-credential.use-case.spec.ts`

### FR-CORE-045 ออกและเพิกถอน QR/ลิงก์ผูก LINE ของพนักงาน

- **คำอธิบาย** ออก token ใช้ครั้งเดียว (อายุ 15 นาที) ให้พนักงานสแกนเพื่อผูก LINE และเพิกถอนได้
- **ผู้ใช้/สิทธิ์** ออก: `access.employee.line_link.issue`; เพิกถอน: `access.employee.line_link.revoke` (OWNER, ADMIN)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `POST …/employees/:employeeId/line-link-token` → `generateLineLinkToken()` (24 ไบต์ base64url; เก็บ sha256) → คืน `EmployeeLineLinkPackage{linkUrl, qrImageUrl, expiresAt}`; `linkUrl` = `https://liff.line.me/<liffId>/employee?token=…` (หรือ endpoint ตรงของ API เมื่อไม่มี LIFF id); QR เป็น SVG data URL ที่สร้างในเครื่อง ไม่ส่ง token ไปบริการภายนอก; `POST …/line-link-token/revoke` → ตั้ง token เป็น revoked
- **ข้อผิดพลาด** 404
- **ข้อมูล** `EmployeeLineLinkToken`, `AuditLog` (`access.employee.line_link.issue`, `access.employee.line_link.revoke`)
- **API** `POST …/employees/:employeeId/line-link-token`, `POST …/employees/:employeeId/line-link-token/revoke`
- **หน้าจอ** `/companies/[companyId]/settings/employees`
- **การทดสอบ** `domain/logic/employee-access.logic.spec.ts`, `auth/application/use-cases/complete-employee-line-link.use-case.spec.ts`

### FR-CORE-046 จัดการบทบาทของบริษัท

- **คำอธิบาย** ดูบทบาท (ระบบ + ที่บริษัทสร้าง), ดูตัวอย่างผลของบทบาทก่อนบันทึก, สร้าง, แก้ไข และปิดใช้งานบทบาท
- **ผู้ใช้/สิทธิ์** รายการ: `access.role.read` / `access.role.manage` / `access.employee.create` / `access.employee.update` (อย่างใดอย่างหนึ่ง); รายละเอียดและ preview: `access.role.read` หรือ `access.role.manage`; สร้าง/แก้/ปิด: `access.role.manage` (ค่าเริ่มต้นมีเฉพาะ OWNER)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  - `GET …/settings/roles` → `RoleSummary[]` พร้อม `effectivePermissionCount`, `activeEmployeeCount`, `assignableByCurrentUser` (คำนวณด้วยกฎเดียวกับทางเขียน)
  - `GET …/settings/roles/:roleId`
  - `POST …/settings/roles/preview` → แสดง permission ที่จะได้จาก pack/template
  - `POST …/settings/roles` `{name, description?, permissionKeys?, capabilityPackKeys?, roleTemplateKey?}` → รวม permission จาก pack/template; สร้าง key จากชื่อ (ASCII) หรือจาก segment สุดท้ายของ template key เมื่อชื่อเป็นภาษาไทย (`tpl.x.manager` → `MANAGER`); audit `access.role.create`
  - `PATCH …/settings/roles/:roleId` → แก้ role ของบริษัท; การแก้บทบาทระบบจะ "fork" เป็น role ของบริษัทที่ key เดิม แล้วย้ายผู้ถือเดิมไป role ใหม่; audit `access.role.update` / `access.role.create`
  - `POST …/settings/roles/:roleId/disable` → ปิด role ของบริษัท; audit `access.role.disable`
- **กฎ/ข้อยกเว้น** บทบาทที่บริษัทแก้ไม่ได้: `OWNER`, `SYSTEM_ADMIN`, `COMPANY_VIEW` (`NON_EDITABLE_ROLE_KEYS`); role ใหม่ห้ามใช้ key ของบทบาทระบบหรือ platform-only; บริษัททั่วไปมองไม่เห็นบทบาท platform-only (404); ต้องมี permission อย่างน้อยหนึ่งรายการนอกชุด core; ผู้ที่ไม่ใช่เจ้าของให้ `company.plan.manage` ไม่ได้ และผู้ที่ไม่มี `access.role.financial.assign` ให้ `reimbursement.read` หรือ `access.role.operational.assign` ผ่าน role ไม่ได้ (`ownerGatedGrantViolation`); ปิด role ไม่ได้ถ้ายังมีสมาชิก `ACTIVE`/`INVITED` ถืออยู่; บทบาทระบบปิดไม่ได้
- **ข้อผิดพลาด** 404 `Role not found`; 403 (`This role is managed by MangmeePlus and cannot be edited.`, `Unknown permission keys: …`, `At least one permission is required.`, ข้อความ owner-gated, `Protected system roles cannot be disabled.`); 409 `Role is still assigned to active employees. Reassign before disabling.`
- **ข้อมูล** `Role`, `RolePermission`, `Permission`, `MembershipRole`, `AuditLog`
- **API** `GET|POST /v1/companies/:companyId/settings/roles`, `GET|PATCH …/roles/:roleId`, `POST …/roles/preview`, `POST …/roles/:roleId/disable`
- **หน้าจอ** `/companies/[companyId]/settings/permissions` (หน้า "บทบาทและสิทธิ์"; `/settings/roles` redirect มาที่นี่) — route rule ต้องมี `access.role.manage`
- **การทดสอบ** `application/use-cases/create-role.use-case.spec.ts`, `application/use-cases/role-management.use-case.spec.ts`, `domain/logic/capability.logic.spec.ts`, `e2e/_roles-reference.spec.ts`, `e2e/journeys/team-and-roles.journey.spec.ts`

### FR-CORE-047 แค็ตตาล็อก permission, capability pack และ role template

- **คำอธิบาย** ข้อมูลอ้างอิงสำหรับสร้างบทบาท: รายการ permission, ชุดสิทธิ์สำเร็จรูป (capability pack) และแม่แบบบทบาทตามประเภทธุรกิจ
- **ผู้ใช้/สิทธิ์** permissions: `access.permission.read` หรือ `access.role.manage`; packs: `access.capability_pack.read` หรือ `access.role.manage`; templates: `access.role_template.read` หรือ `access.role.manage`
- **แพ็ก** [ALL] (pack ที่ผูกกับฟีเจอร์ที่บริษัทไม่ได้เปิดจะไม่ให้สิทธิ์ที่ใช้งานได้ — FR-CORE-032)
- **ขั้นตอนหลัก** `GET …/settings/permissions` → `PermissionCatalogItem[]`; `GET …/settings/capability-packs` → pack จาก `capability-pack.registry.ts` (key เช่น `pack.core.basics` (core), `pack.company.settings.view/manage`, `pack.company.plan.manage`, `pack.company.legal_identity.manage`, `pack.company.vat_registration.manage`, `pack.people.view/manage`, `pack.audit.read`, `pack.dashboard.manage`, `pack.notification.admin`, `pack.expense.*`, `pack.reimbursement.*` และ pack ของโมดูลอื่น); `GET …/settings/role-templates` → template จาก `role-template.registry.ts` (`tpl.x.readonly/accounting/marketing/manager/finance`, `tpl.retail.*`, `tpl.trading.*`, `tpl.service.*`, `tpl.ecom.*`)
- **กฎ/ข้อยกเว้น** risk level ของ pack = ค่าสูงสุดของ permission ภายใน; `access.role_template.manage` มีในทะเบียนแต่ไม่พบ controller ที่ใช้ (ไม่มี endpoint จัดการ template ของบริษัท)
- **ข้อมูล** ไม่มี (ทะเบียนในโค้ด) + `Permission`
- **API** `GET /v1/companies/:companyId/settings/permissions`, `…/capability-packs`, `…/role-templates`
- **หน้าจอ** `/companies/[companyId]/settings/permissions`
- **การทดสอบ** `domain/logic/capability.logic.spec.ts`, `domain/logic/role-template-read-coverage.spec.ts`, `domain/logic/role-template-system-role-parity.spec.ts`

### FR-CORE-048 สิทธิ์ที่มีผลจริง (effective access) และตารางสิทธิ์ (access matrix)

- **คำอธิบาย** มุมมอง "ใครทำอะไรได้" รายคน และตารางบทบาท × ความสามารถของบริษัท
- **ผู้ใช้/สิทธิ์** effective access: `access.effective.read` (OWNER, ADMIN, AUDITOR_READONLY); matrix: `access.role.read` หรือ `access.role.manage`
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `GET …/settings/effective-access`, `GET …/settings/effective-access/:membershipId`, `GET …/settings/access/matrix` (ผลกรองตาม entitlement ของบริษัท ให้ตรงกับจำนวนสิทธิ์บนการ์ดบทบาท)
- **ข้อผิดพลาด** 404 `Membership not found`
- **ข้อมูล** `CompanyMembership`, `MembershipRole`, `Role`, `RolePermission`, `CompanyFeatureEntitlement`
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/settings/access-overview` (route rule: `access.employee.read`), `/companies/[companyId]/settings/permissions`
- **การทดสอบ** `application/use-cases/get-access-matrix.use-case.spec.ts`

### FR-CORE-049 ฐานข้อมูลที่อยู่ไทย (address master)

- **คำอธิบาย** ค้นจังหวัด/อำเภอ/ตำบล/รหัสไปรษณีย์สำหรับฟอร์มพนักงานและที่อยู่จดทะเบียนของบริษัท
- **ผู้ใช้/สิทธิ์** อย่างใดอย่างหนึ่งใน `access.employee.read`, `access.employee.create`, `access.employee.update`, `company.setup.read`, `company.legal_identity.read`, `company.legal_identity.manage`
- **แพ็ก** [ALL] (เข้าถึงได้แม้แพ็กหมดอายุเมื่อมี permission ที่ตรง)
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/settings/address-master` → `ThaiAddressOption[]` (`postalCode, provinceCode/Th, districtCode/Th, subdistrictCode/Th`)
- **ข้อมูล** `ThaiAddressMaster`
- **API** `GET /v1/companies/:companyId/settings/address-master`
- **หน้าจอ** ฟอร์มพนักงาน, `/companies/[companyId]/settings/profile`
- **การทดสอบ** `application/use-cases/list-thai-addresses.use-case.spec.ts`

### FR-CORE-050 แก้ข้อยกเว้นการ normalize entitlement (ผู้ดูแลระบบ)

- **คำอธิบาย** เมื่อการ normalize ชุดฟีเจอร์ของบริษัทพบความขัดแย้งของ dependency ผู้ดูแลระบบเลือกวิธีแก้ (เปิดฟีเจอร์ที่ต้องมีก่อน หรือปิดฟีเจอร์ที่พึ่งพา)
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; `system.entitlement_exception.manage`
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `GET /v1/system/entitlement-exceptions` (รายการที่ค้าง), `POST /v1/system/entitlement-exceptions/resolve` (คำสั่งแก้ — เป็นคำสั่งเดียวที่เขียน entitlement ระหว่าง normalization ค้างอยู่ จึงใช้ key แยกจาก `system.partner_feature.manage`)
- **กฎ/ข้อยกเว้น** ใช้ตาราง dependency `FEATURE_DEPENDENCIES` เดียวกับ FR-CORE-032; ตรรกะ normalize อยู่ใน `application/normalize-entitlements.ts`
- **ข้อมูล** `CompanyEntitlementNormalization`, `CompanyEntitlementSet`, `EntitlementCommand`, `EntitlementTransition`, `CompanyFeatureEntitlement`
- **API** `GET /v1/system/entitlement-exceptions`, `POST /v1/system/entitlement-exceptions/resolve`
- **หน้าจอ** `/system/partners/[companyId]` (ส่วนฟีเจอร์ของร้าน — พื้นที่ partner management)
- **การทดสอบ** `application/use-cases/entitlement-exception.use-case.spec.ts`, `application/normalize-entitlements.spec.ts`

---

## 6. การสมัครเปิดร้าน (`external-signup`)

ไฟล์: `apps/api/src/modules/external-signup/` — controller ใน `presentation/http/`, เครื่องสถานะใน `domain/company-signup.logic.ts`, แกนกลาง `application/company-signup-core.service.ts`, provisioning `application/provision-signup.use-case.ts`; contract `packages/contracts/src/external-signup.ts`

**เครื่องสถานะของ `CompanySignupRequest.state`** (`TRANSITIONS` ใน `company-signup.logic.ts`):

| จาก | ไปได้ |
|---|---|
| `RECEIVED` | `VALIDATED`, `SUSPENDED` |
| `VALIDATED` | `PENDING_REVIEW`, `SUSPENDED` |
| `PENDING_REVIEW` | `EMAIL_PENDING`, `REJECTED`, `SUSPENDED` |
| `EMAIL_PENDING` | `EMAIL_VERIFIED`, `EMAIL_FAILED`, `SUSPENDED`, `EXPIRED` |
| `EMAIL_FAILED` | `EMAIL_PENDING`, `SUSPENDED`, `EXPIRED` |
| `EMAIL_VERIFIED` | `PROVISIONING`, `SUSPENDED` |
| `PROVISIONING` | `READY`, `PROVISIONING_FAILED`, `SUSPENDED` |
| `PROVISIONING_FAILED` | `PROVISIONING`, `SUSPENDED` |
| `READY` | `LINE_LINK_PENDING`, `SUSPENDED` |
| `LINE_LINK_PENDING` | `COMPLETED`, `SUSPENDED` |
| `EXPIRED` | `EMAIL_PENDING` |
| `COMPLETED`, `SUSPENDED`, `REJECTED` | (สิ้นสุด) |

แหล่งที่มา (`source`): `official-site` (ฟอร์มเว็บ), `line-oa` (LIFF), `email-otp` (อีเมล) ทุกแหล่ง provision แพ็กเดียวกันคือ `FREE_TRIAL_15` (`SIGNUP_TRIAL_TIER_KEY`); แพ็กที่ผู้สมัครระบุ (`requestedOfferKey`) เก็บเป็นหลักฐานที่มาเท่านั้น

### FR-CORE-051 สมัครเปิดร้านจากฟอร์มเว็บสาธารณะ (Flow B)

- **คำอธิบาย** ผู้สนใจกรอกฟอร์มสมัคร ระบบรับคำขอเข้าคิวให้ผู้ดูแลระบบอนุมัติ แล้วจึงส่งอีเมล claim link ฉบับเดียว
- **ผู้ใช้/สิทธิ์** `@Public()`
- **แพ็ก** [PUBLIC] → ได้ `FREE_TRIAL_15` เมื่อ provision
- **เงื่อนไขก่อนทำ** `EXTERNAL_SIGNUP_ENABLED = true` (ค่าเริ่มต้น false)
- **ขั้นตอนหลัก**
  1. `GET /v1/public/company-signups/availability` → `{enabled}`
  2. `POST /v1/public/company-signups` (202) — ฟิลด์: `externalSignupId`, `companyName`, `ownerFirstName`, `ownerLastName`, `contactEmail`, `phoneNumber?`, `businessType?`, `vatRegistered?`, `taxId?`, `consentVersion`, `referralCode?`, `requestedOfferKey?`, `discoverySource?`, `discoverySourceOther?`, `referralSalesCode?` → normalize + `payloadHash` (canonical fingerprint) → ตรวจ MX ของโดเมนอีเมล (timeout 3 วินาที) → resolve รหัสเซลล์ก่อนสร้างแถว → สร้าง/ทำต่อคำขอ → เลื่อนถึง `PENDING_REVIEW` → แจ้งผู้ดูแล
  3. `GET /v1/public/company-signups/:requestId` → สถานะแบบหยาบ
  4. `POST /v1/public/company-signups/:requestId/resend-claim` (202) → ขอส่ง claim email ใหม่
- **กฎ/ข้อยกเว้น** rate limit: 10 ครั้ง/ชั่วโมงต่อ IP และ 5 ครั้ง/ชั่วโมงต่ออีเมล (submit), 60/ชั่วโมงต่อ IP (อ่าน), resend 10/ชั่วโมงต่อ IP และ 3/ชั่วโมงต่อคำขอ; ส่งซ้ำด้วย `externalSignupId` เดิมและ payload เดิม = ทำต่อจากจุดที่ค้าง (ไม่เปิดคำขอใหม่ และไม่เปิดสิ่งที่ผู้ดูแลตัดสินแล้ว); ค่า offer เก่า `PRO_TRIAL` ถูก normalize เป็น `FREE_TRIAL`; ผู้สมัครส่ง resend เองได้ภายใน 30 วันหลังอนุมัติ
- **ข้อผิดพลาด** 403 `external_signup_disabled`; 409 (externalSignupId เดิมแต่ payload ต่าง — `external_signup_payload_conflict`); 422 (payload ไม่ถูกต้อง / โดเมนอีเมลไม่มี MX); 400 (รหัสเซลล์ไม่รู้จัก/ถูกพัก); 429
- **ข้อมูล** `CompanySignupRequest` (`CompanySignupState`), `OutboxEvent`, `AuditLog`
- **API** ตามขั้นตอน
- **หน้าจอ** `/signup` (`features/external-signup/SignupPage`), `/signup/status/[requestId]`
- **การทดสอบ** `application/submit-company-signup.use-case.spec.ts`, `application/public-signup-status.use-case.spec.ts`, `domain/company-signup.logic.spec.ts`, `presentation/http/public-company-signup.controller.spec.ts`, `application/signup-replay-recovery.spec.ts`

### FR-CORE-052 Claim link: ตั้งรหัสผ่านหรือผูกกับบัญชีเดิม แล้วเปิดร้าน

- **คำอธิบาย** ผู้สมัครที่ได้รับอนุมัติเปิดลิงก์ในอีเมล (พิสูจน์ความเป็นเจ้าของกล่องจดหมาย) แล้วเลือกสร้างบัญชีใหม่หรือผูกร้านใหม่กับบัญชีที่มีอยู่ จากนั้นระบบ provision ร้าน
- **ผู้ใช้/สิทธิ์** `@Public()` (token คือ credential)
- **แพ็ก** [PUBLIC]
- **เงื่อนไขก่อนทำ** คำขออยู่ที่ `EMAIL_PENDING`; `AccountClaimToken` ยังไม่หมดอายุ (72 ชั่วโมง `CLAIM_TOKEN_TTL_HOURS`) และยังไม่ถูกใช้
- **ขั้นตอนหลัก**
  1. `POST /v1/public/signup-claims/info` `{token}` → `{valid:false}` เหมือนกันทุกกรณีที่ใช้ไม่ได้ (หมดอายุ/ใช้แล้ว/ไม่รู้จัก/รูปแบบผิด); ถ้าใช้ได้คืนข้อมูลที่หน้าต้องใช้ รวมถึงว่าอีเมลนี้มีบัญชีอยู่แล้วหรือไม่
  2. `POST /v1/public/signup-claims/set-password` `{token, username, password}` → ตรวจ username/อีเมลซ้ำ **ก่อน** ใช้ token → เก็บเฉพาะ hash ของรหัสผ่าน → เลื่อนสถานะ → provision (FR-CORE-056)
  3. `POST /v1/public/signup-claims/attach` → ยืนยัน credential ของบัญชีเดิม (จ่าย scrypt หนึ่งครั้งเสมอ) → ผูกร้านใหม่กับบัญชีนั้น → provision
- **กฎ/ข้อยกเว้น** token ส่งใน body เท่านั้น (ไม่อยู่ใน URL ของ API); token เก็บแบบ SHA-256; ตรวจสถานะซ้ำภายใต้ advisory lock ของคำขอ; URL ส่งมอบสร้างจาก web base ที่ตั้งค่าไว้ ไม่ใช้ `Origin` ของผู้เรียก
- **ข้อผิดพลาด** 400 `claim_link_invalid_or_expired`; 409 `username_taken`, `email_already_registered_use_existing_account`; 429 (`public-signup-claim-ip` 20/ชั่วโมง)
- **ข้อมูล** `AccountClaimToken`, `CompanySignupRequest`, `User`, `UserCredential`
- **API** `POST /v1/public/signup-claims/info|set-password|attach`
- **หน้าจอ** `/claim-account` (`ClaimAccountPage`), `/signup/welcome`; BFF `POST /api/auth/signup-claim`
- **การทดสอบ** `application/signup-claim.use-case.spec.ts`, `application/account-claim-token.service.spec.ts`, `domain/account-claim.logic.spec.ts`

### FR-CORE-053 สมัครเปิดร้านผ่าน LINE (LIFF, LINE-first)

- **คำอธิบาย** ผู้ใช้เปิดหน้า LIFF "เปิดร้านใหม่" กรอกชื่อร้านและเบอร์มือถือ ยอมรับข้อกำหนด แล้วได้ร้านที่เจ้าของล็อกอินด้วย LINE (ไม่มี username/รหัสผ่าน)
- **ผู้ใช้/สิทธิ์** `@Public()`; ตัวตนมาจาก LIFF ID token เท่านั้น
- **แพ็ก** [PUBLIC] → `FREE_TRIAL_15`
- **เงื่อนไขก่อนทำ** `LINE_SIGNUP_ENABLED = true` (ค่าเริ่มต้น false); หลักฐานการยอมรับข้อกำหนดบนหน้าตรงกับ release ปัจจุบัน
- **ขั้นตอนหลัก**
  1. `POST /v1/public/line-signups` — `idToken`, client submission id (UUID), `intent` (`FIRST_SHOP`/`ADD_SHOP`), `companyName`, `phoneNumber`, `contactEmail?`, `referralCode?`, `discoverySource?`, `discoverySourceOther?`, `referralSalesCode?`, `legal{documentVersion, statementSha256, releaseFingerprintSha256, displayChallenge, locale}` → ตรวจ ID token → ค้นคำขอเดิมด้วย key (รวมแถวสิ้นสุดแล้ว เพื่อไม่สร้างร้านซ้ำเมื่อ response หาย) → ตรวจ legal release → resolve รหัสเซลล์ → สร้างคำขอ `source = line-oa` → ตามโหมดอนุมัติ:
     - `LINE_SIGNUP_APPROVAL_MODE = MANUAL` (ค่าเริ่มต้น): เข้าคิว `PENDING_REVIEW`
     - `AUTO_FREE`: อนุมัติและ provision ทันที ยกเว้นกรณีเคยได้ trial แล้ว (repeat trial), อีเมลติดต่อซ้ำกับบัญชีอื่น หรือเคยถูกปฏิเสธ — กรณีเหล่านี้เข้าคิวให้คนตัดสิน
  2. `GET /v1/public/line-signups/me` (ID token ใน header) → สถานะคำขอและร้านที่มี
  3. `PATCH /v1/public/line-signups/:requestId/contact-email` `{idToken, version, contactEmail?}` → แก้อีเมลติดต่อ (compare-and-set ด้วย `version`)
  4. `POST /v1/public/line-signups/:requestId/retry` `{idToken, version}` → ทำคำขอเดิมต่อ
  5. `POST /v1/public/line-signups/support` `{idToken}` → เปิดคำขอความช่วยเหลือ (FR-CORE-059)
- **กฎ/ข้อยกเว้น** หนึ่งบัญชี LINE มีคำขอที่ยังไม่จบได้ครั้งละหนึ่งรายการ (partial unique index; สถานะ `COMPLETED`/`REJECTED`/`SUSPENDED` เท่านั้นที่ปลดล็อก); rate limit: 20/ชั่วโมงต่อ IP, สมัครใหม่ 3 ครั้ง/วันต่อบัญชี LINE, ความพยายาม 20/ชั่วโมง, อ่าน 60/ชั่วโมง, ขอความช่วยเหลือ 3 ครั้ง/วัน; เบอร์มือถือต้องเป็นเบอร์ไทย; อีเมลติดต่อเป็นข้อมูลติดต่อ ไม่ใช่หลักฐานความเป็นเจ้าของ; คำสัญญา "ภายในวันทำการ" คำนวณด้วยเขตเวลา Asia/Bangkok แบบ offset คงที่ (`domain/business-hours.logic.ts`)
- **ข้อผิดพลาด** 403 `line_signup_disabled`; 401 (ID token); 409 `line_signup_submission_conflict`, `legal_release_changed`, `line_signup_already_pending`, `line_signup_version_conflict`, `line_signup_contact_update_not_allowed`, `line_signup_retry_not_available`, `line_signup_identity_disabled`, `line_signup_account_blocked`; 422/400 (ข้อมูลไม่ถูกต้อง); 429 `line_support_daily_limit`
- **ข้อมูล** `CompanySignupRequest`, `ExternalIdentity`, `LegalDocumentActionRecord`, `LineSupportRequest`, `OutboxEvent`
- **API** ตามขั้นตอน
- **หน้าจอ** หน้า LIFF signup (HTML จาก `GET /v1/auth/line/link-page/signup`)
- **การทดสอบ** `application/submit-line-signup.use-case.spec.ts`, `application/line-signup-auto-free.integration.spec.ts`, `application/line-signup-status-and-package-change.spec.ts`, `domain/line-signup.logic.spec.ts`, `domain/business-hours.logic.spec.ts`, `line-signup-duplicate-email.pg.spec.ts`, `line-signup-stale-identity.pg.spec.ts`, `presentation/http/public-line-signup.controller.spec.ts`, `e2e/line-signup-contact-email.spec.ts`

### FR-CORE-054 สมัครเปิดร้านด้วยอีเมล (email-first)

- **คำอธิบาย** ผู้ที่ยืนยันอีเมลด้วย OTP แล้ว (FR-CORE-019) และยังไม่มีบัญชี กรอกชื่อร้าน ชื่อ และเบอร์มือถือเพื่อเปิดร้าน
- **ผู้ใช้/สิทธิ์** `@Public()` + proof จาก email access
- **แพ็ก** [PUBLIC] → `FREE_TRIAL_15`
- **เงื่อนไขก่อนทำ** `EXTERNAL_SIGNUP_ENABLED = true`; `consentVersion = 'EMAIL_SIGNUP_V1'`
- **ขั้นตอนหลัก** `POST /v1/public/email-access/signup` → `EmailSignupService.submit`: ตรวจ proof ใน transaction, ถ้ามีคำขอของอีเมลนี้อยู่แล้วให้ทำต่อ (ไม่ให้ trial ซ้ำ), สร้าง `CompanySignupRequest` (`source = email-otp`, `externalSignupId = email-first:<fingerprint>`, `emailProofVerifiedAt`), audit `signup.email.received` → `resume`: เลื่อน `RECEIVED → VALIDATED` → เข้าสู่การอนุมัติ/provision; `POST /v1/public/email-access/status` → `{kind:'NEW'}` หรือสถานะคำขอเดิม
- **กฎ/ข้อยกเว้น** อีเมลที่ตรงกับ email/username ของบัญชีที่มีอยู่ → ให้เข้าบัญชีเดิม
- **ข้อผิดพลาด** `EMAIL_SIGNUP_INPUT_INVALID` (400), `EMAIL_ACCESS_EXISTING_ACCOUNT` (409), `EMAIL_SIGNUP_CHANGED` (409), `external_signup_disabled`
- **ข้อมูล** `CompanySignupRequest`, `EmailAccessChallenge`, `AuditLog`
- **API** `POST /v1/public/email-access/signup`, `POST /v1/public/email-access/status`
- **หน้าจอ** `/email-access`
- **การทดสอบ** `auth/application/email-access.pg.spec.ts`

### FR-CORE-055 คิวคำขอสมัครสำหรับผู้ดูแลระบบ และการตัดสิน

- **คำอธิบาย** ผู้ดูแลระบบดูคิว ตัดสินคำขอ ออก claim link ใหม่ และตรวจย้อนหลังคำขอที่ระบบอนุมัติเอง
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; อ่าน `system.company_onboarding.read`; ตัดสิน/ออกลิงก์ใหม่ `system.company_onboarding.create`
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**
  - `GET /v1/system/signup-requests?tab=&cursor=&limit=` → หนึ่งหน้าของหนึ่งแท็บ (`ALL`, `PENDING_REVIEW`, `AWAITING_CLAIM`, `PROBLEM`, `ARCHIVED`) พร้อมจำนวนทั้งคิว; เรียงเก่าสุดก่อน; cursor = base64url ของ `<createdAt>|<id>`; ขนาดหน้าเริ่มต้น 50 สูงสุด 200
  - `GET /v1/system/signup-requests/auto-approved` → คำขอที่ `AUTO_FREE` อนุมัติ
  - `GET /v1/system/signup-requests/:requestId/claim-deliveries` → ประวัติการส่ง claim email
  - `POST /v1/system/signup-requests/:requestId/decision` — `action` ∈ `APPROVE`, `CREATE_NEW_SHOP`, `RETURN_EXISTING`, `REQUEST_INFO`, `RETRY_INTAKE`, `REJECT`, `SUSPEND`; ฟิลด์เสริม `version`, `targetCompanyId`, `grantRepeatTrial`, `trialGrantNote`, `acknowledgeSharedContact`, `sharedContactNote`, `resolutionNote`, `notifyApplicant`, `rejectionReason`
  - `POST /v1/system/signup-requests/:requestId/reissue-claim` → revoke claim link เก่าและส่งฉบับใหม่ (ไม่จำกัดอายุคำขอ)
- **กฎ/ข้อยกเว้น** การเปลี่ยนสถานะกับข้อมูลประกอบ (เช่น `approvedAt`, การเข้าคิวอีเมล) commit พร้อมกันใน CAS เดียว; การตัดสินเป็น idempotent; คำขอเว็บ: `APPROVE` → `EMAIL_PENDING` + คิวอีเมล claim; คำขอ LINE: `APPROVE` provision ทันที; `PROVISIONING_FAILED` แสดงในคิวทุกแหล่ง, `READY` ที่ค้างแสดงเฉพาะแหล่ง LINE; web base URL ต้องตั้งค่าเฉพาะการตัดสินที่ provision (`APPROVE`, `CREATE_NEW_SHOP`, `RETRY_INTAKE`) — `REJECT`/`SUSPEND` ไม่ขึ้นกับค่านี้; อีเมลแจ้งปฏิเสธใช้ข้อความที่ผู้ดูแลพิมพ์ (ถูก escape ตอน render)
- **ข้อผิดพลาด** 409 (การตัดสินไม่เข้ากับสถานะปัจจุบัน / `signup_operator_unresolved`), 503 (ไม่ได้ตั้ง web base เมื่อต้อง provision)
- **ข้อมูล** `CompanySignupRequest`, `AccountClaimToken`, `EmailSendAttempt`, `OutboxEvent`, `AuditLog`
- **API** ตามข้างต้น
- **หน้าจอ** `/system/signup-requests`, `/system/signup-requests/[id]/mail`
- **การทดสอบ** `application/signup-admin-queue.use-case.spec.ts`, `presentation/http/system-signup-request.controller.spec.ts`, `application/signup-suspend-race.spec.ts`, `application/signup-admin-notify.service.spec.ts`

### FR-CORE-056 Provisioning ร้านจากคำขอสมัคร

- **คำอธิบาย** เปลี่ยนคำขอที่ผ่านแล้วให้เป็นบริษัทจริง ผ่าน `CreateCompanyOnboardingUseCase` เพียงทางเดียว (FR-CORE-060)
- **ผู้ใช้/สิทธิ์** ระบบ (เรียกจาก claim, การตัดสินของผู้ดูแล, AUTO_FREE)
- **แพ็ก** [PUBLIC] → `FREE_TRIAL_15`
- **ขั้นตอนหลัก** (`provision-signup.use-case.ts`) แย่ง "fence" ของคำขอ (ผู้ชนะรายเดียว; ผู้เรียกซ้ำอ่านผลของผู้ชนะ) → เลือกรูปแบบเจ้าของตาม `source` (รหัสผ่านที่ตั้งเอง / ผูกบัญชีเดิม / LINE identity) → เรียก onboarding (ซึ่งประทับ `companyId` ลงคำขอใน transaction เดียวกัน) → ตั้ง plan term ของ trial และตัวป้องกัน → บันทึกคำตอบ VAT จากฟอร์มเป็นสถานะบริษัท (ไม่สร้าง `VatFact`) → ล้าง hash รหัสผ่านที่ค้างบนคำขอ → audit (เฉพาะ boolean และ id) → เลื่อนสถานะ `READY` → `LINE_LINK_PENDING` / `COMPLETED`
- **กฎ/ข้อยกเว้น** fence ที่ค้างเกิน 3 นาที (`STALE_PROVISIONING_MS = 180000`) ถือว่าถูกทิ้ง ผู้เรียกรายอื่นยึดต่อได้และส่ง ops alert; ถ้าความพยายามก่อนหน้าสร้างบริษัทแล้ว (`companyId` มีค่า) จะไม่เรียก onboarding ซ้ำ; ผู้ดำเนินการที่บันทึกต้องเป็น user จริง (AUTO_FREE ใช้ `SYSTEM_ADMIN` ที่ active จาก directory)
- **ข้อผิดพลาด** 409 `signup_provisioning_in_progress`, `line_signup_existing_resolution_not_provisionable`, `email_signup_proof_required`
- **ข้อมูล** `CompanySignupRequest`, `CompanyOnboardingRun`, `Company`, `User`, `UserCredential`, `ExternalIdentity`, `CompanyMembership`, `CompanyPlanTerm`, `AuditLog`
- **API** ไม่มีโดยตรง
- **หน้าจอ** `/signup/welcome`
- **การทดสอบ** `application/provision-signup.use-case.spec.ts`, `application/provision-signup.plan-term.integration.spec.ts`, `signup-provisioning-recovery.pg.spec.ts`

### FR-CORE-057 งานเบื้องหลังของการสมัคร: outbox drain, การเตือน, การหมดอายุ, เหตุการณ์ SES

- **คำอธิบาย** worker เรียก endpoint ภายในเพื่อส่งอีเมล/ข้อความ LINE ของการสมัคร และรันการกวาดตามเวลา; SNS ของ Amazon SES ส่ง bounce/complaint เข้ามา
- **ผู้ใช้/สิทธิ์** worker (`x-worker-token`); SNS (`@Public()` + ตรวจลายเซ็น SNS)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**
  - `POST /v1/internal/signup-claim-email/drain` `{batchSize?}` → ประมวลผล outbox ชนิดของการสมัคร (`email.account_claim.requested`, `email.signup_rejected.requested`, การแจ้ง LINE, ops alert) ด้วย lease เดียว
  - `POST /v1/internal/signup-claim-email/reminder-sweep` (ทุก 15 นาที) → เตือน 24 ชั่วโมงก่อน claim link หมดอายุ (`CLAIM_REMINDER_AFTER_HOURS = 48`); ย้ายคำขอที่อนุมัติแล้วไม่ claim ภายใน 30 วันไป `EXPIRED` (`claim_not_started`); การเตือนโปรไฟล์วันที่ 7 ของร้าน LINE; นับร้าน trial ที่ใช้งบ AI หมด; ตรวจ push ที่ค้าง; ตรวจ AI credit hold ที่ค้าง; ปิดคำขอความช่วยเหลือที่หมดเวลา; ลบข้อมูลคำขอความช่วยเหลือที่จบแล้วเกิน 90 วัน; ลบคำขอสมัครที่ค้างที่ `RECEIVED` เกิน 7 วัน (`INTAKE_RETENTION_DAYS`)
  - `POST /v1/public/ses-events` → rate limit 600/ชั่วโมงต่อ IP; body จำกัด 256 KB รับทุก content-type; ตรวจลายเซ็น SNS (`infrastructure/sns-signature.ts`); ยืนยัน subscription / จัดการ bounce-complaint
- **ข้อผิดพลาด** 401 (worker token), 403 (SNS topic ไม่รู้จัก/ลายเซ็นผิด/ไม่ได้ตั้งค่า)
- **ข้อมูล** `OutboxEvent`, `CompanySignupRequest`, `AccountClaimToken`, `EmailSendAttempt`, `EmailSuppression`, `LineSupportRequest`, `LineSupportMessage`
- **API** ตามข้างต้น
- **หน้าจอ** ไม่มี
- **การทดสอบ** `application/signup-claim-email.service.spec.ts`, `application/ses-event.use-case.spec.ts`, `infrastructure/sns-signature.spec.ts`, `application/signup-ops-alert.service.spec.ts`, `application/line-signup-notify.service.spec.ts`

### FR-CORE-058 คำขอเปลี่ยนแพ็กเกจจากร้าน

- **คำอธิบาย** ร้านเปิดคำขอเปลี่ยนแพ็กเกจให้ทีมงานติดต่อกลับ (ไม่เปลี่ยนแพ็กเอง — แพ็กเปลี่ยนผ่านผู้ดูแลระบบหรือการชำระเงินที่ยืนยันแล้วเท่านั้น)
- **ผู้ใช้/สิทธิ์** `company.plan.manage`
- **แพ็ก** [ALL] (ใช้ได้แม้ร้าน `DISABLED` เพราะแพ็กหมดอายุ; ร้าน `SUSPENDED`/`ARCHIVED` ใช้ไม่ได้)
- **ขั้นตอนหลัก** `POST /v1/companies/:companyId/package-change-requests` `{requestedTierKey…}` → ตรวจ tier เป็นแพ็กที่รู้จัก → ตรวจผู้ขอเป็น plan manager (FR-CORE-035) → สร้าง `PackageChangeRequest`; `GET …/package-change-requests` → รายการคำขอของร้าน
- **กฎ/ข้อยกเว้น** หนึ่งร้านมีคำขอ OPEN ได้หนึ่งรายการ (partial unique index) — กดซ้ำได้คำขอเดิมกลับมา ไม่ error; คำขอจากปุ่มใน LINE ที่ไม่ระบุ tier ใช้ `nextPlanTierKey` (ขั้นถัดไปของบันได `FREE_TRIAL_15 → STARTER_249 → BASIC_499 → PRO_999 → ENTERPRISE_1999`) เป็นจุดเริ่มคุย
- **ข้อผิดพลาด** 422 `tierKey "<x>" is not a known plan tier.`; 403 `company_plan_manage_required`
- **ข้อมูล** `PackageChangeRequest`, `CompanyMembership`, `CompanyPlanTerm`
- **API** `POST|GET /v1/companies/:companyId/package-change-requests`
- **หน้าจอ** `/companies/[companyId]/renew`, `/companies/[companyId]/billing`
- **การทดสอบ** `application/line-signup-status-and-package-change.spec.ts`

### FR-CORE-059 กล่องคำขอความช่วยเหลือจาก LINE (ผู้ดูแลระบบ)

- **คำอธิบาย** ลูกค้ากด "ติดต่อเจ้าหน้าที่" ใน LINE หรือหน้า LIFF; ผู้ดูแลระบบรับเรื่อง ตอบกลับผ่าน LINE ปิดเรื่อง และควบคุมการพัก/เปิดผู้ช่วย AI ของแชตนั้น
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; `system.partner_company.update` (ทุก endpoint)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**

  | Endpoint (`/v1/system/support-requests…`) | หน้าที่ |
  |---|---|
  | `GET /` | คิวคำขอ (เรียงข้อความลูกค้าที่รอนานสุดก่อน; หน้า 50 สูงสุด 200; cursor) |
  | `GET /count` | จำนวนที่ค้าง |
  | `GET /:supportRequestId/thread` | คำขอ + ข้อความทั้งหมด (สูงสุด 500 ข้อความ เก่าก่อน) |
  | `GET /:supportRequestId/messages/:messageId/content` | ไฟล์/รูปของลูกค้า (ผูกกับคำขอ — id จากเคสอื่นได้ 404) |
  | `POST /:id/claim`, `/release`, `/reclaim` | รับเรื่อง / ปล่อย / ยึดจากผู้รับเดิม (ตรวจ version) |
  | `POST /:id/reply` | ตอบลูกค้าทาง LINE (ต้องมี `operationId` สำหรับ idempotency) |
  | `POST /:id/resolve`, `/answered` | ปิดเรื่อง (บันทึกย่อ ≤ 500 ตัวอักษร) / ทำเครื่องหมายว่าตอบแล้ว |
  | `POST /:id/resume-ai`, `/pause-ai` | เปิด/พักผู้ช่วย AI ของแชต |

- **กฎ/ข้อยกเว้น** thread ไม่เปิดเผย `lineMessageId`, `operationId`, `senderUserId`; เคส `CLOSED` อ่านได้จนถูกลบเมื่อครบ 90 วัน แต่ทำรายการต่อไม่ได้ (404); รหัสข้อผิดพลาดจากผู้ให้บริการที่เก็บ/แสดงเป็นชุดจำกัด
- **ข้อผิดพลาด** 404 `Support request "<id>" not found.`; 409 `support_request_changed`; 422 `support_queue_cursor_invalid`, `support_reclaim_input_invalid`, `support_reply_operation_id_invalid`
- **ข้อมูล** `LineSupportRequest` (`LineSupportRequestStatus`), `LineSupportMessage`, `LineSupportMessageBlob`, `LineCompanyContext`
- **API** ตามตาราง; ฝั่งลูกค้า `POST /v1/public/line-signups/support`
- **หน้าจอ** `/system/support-requests`
- **การทดสอบ** `application/support-request-admin.use-case.spec.ts`, `line-support-request.pg.spec.ts`

---

## 7. Onboarding โดยผู้ดูแลระบบ (`system-onboarding`)

ไฟล์: `apps/api/src/modules/system-onboarding/presentation/http/system-onboarding.controller.ts`, `application/use-cases/create-company-onboarding.use-case.ts`, `get-company-onboarding.use-case.ts`, `regenerate-temporary-password.use-case.ts`, `reissue-owner-line-link.use-case.ts`

### FR-CORE-060 เปิดร้านให้ลูกค้า (company onboarding)

- **คำอธิบาย** ผู้ดูแลระบบสร้างบริษัท เจ้าของ สาขาแรก บทบาท ฟีเจอร์ และ plan term ในครั้งเดียว แล้วได้ชุดส่งมอบให้เจ้าของร้าน; เป็นทางเดียวที่สร้างบริษัท (การสมัครทุกแบบเรียก use case นี้)
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; `system.company_onboarding.create`
- **แพ็ก** [PLATFORM] — กำหนดแพ็กเริ่มต้นของร้าน (ค่าเริ่มต้น feature preset = starter)
- **ขั้นตอนหลัก** `POST /v1/system/company-onboardings` — `companyName`, `ownerDisplayName`, `ownerUsername` (บังคับเว้นแต่ `ownerLineOnly`), `ownerLineOnly?`, `attachExistingOwner?`, `taxId?`, `vatRegistration?{status: REGISTERED|NOT_REGISTERED, effectiveFrom}`, `modulePackage?`, `lineOaAddUrl?`, `lineLinkUrl?` → transaction (เพดานเวลา 15 วินาที): `Company`, `User` เจ้าของ, `UserCredential` (รหัสชั่วคราว 12 ตัว อายุ 72 ชั่วโมง, `mustChangePassword`), `CompanyMembership` + บทบาท `OWNER`, สาขาแรก, ฟีเจอร์เริ่มต้น, plan term, `CompanyOnboardingRun`, token ผูก LINE ของเจ้าของ (อายุ 72 ชั่วโมง `OWNER_LINE_LINK_TOKEN_TTL_MS`), audit
- **กฎ/ข้อยกเว้น** รูปแบบการเข้าของเจ้าของ (`ownerAuth`): `password` (ค่าเริ่มต้น), `line` (LINE identity ถูกสร้างใน transaction เดียวกัน ไม่มี username/credential), `line-link-later` (ไม่มี credential; QR ผูก LINE เป็นทางเข้าเดียว); `taxId` ที่ให้มาถูกเก็บเป็น revision `INITIAL_CAPTURE`; ไม่เดาสถานะ VAT (ไม่ระบุ = `UNKNOWN`); ชื่อร้านซ้ำได้สำหรับทางสมัครสาธารณะ ส่วนคอนโซลผู้ดูแลยังกันชื่อซ้ำ; plan term เขียนครั้งเดียวที่นี่; หลักฐานการยอมรับข้อกำหนดจาก LIFF ถูก replay ใน transaction นี้
- **ข้อผิดพลาด** 409 (ชื่อ/username ซ้ำ, LINE identity ถูกใช้แล้ว — unique violation), 400 (payload)
- **ข้อมูล** `Company`, `User`, `UserCredential`, `ExternalIdentity`, `CompanyMembership`, `MembershipRole`, `Branch`, `CompanyFeatureEntitlement`, `CompanyPlanTerm`, `CompanyOnboardingRun` (`OnboardingRunStatus`), `CompanyLegalIdentityRevision`, `CompanyVatRegistrationFact`, `EmployeeLineLinkToken`, `LegalDocumentActionRecord`, `AuditLog`
- **API** `POST /v1/system/company-onboardings`
- **หน้าจอ** `/system/company-onboardings/new` (`features/system-onboarding`)
- **การทดสอบ** `application/use-cases/create-company-onboarding.spec.ts`, `presentation/http/system-onboarding.controller.spec.ts`

### FR-CORE-061 อ่านผล onboarding, ออกรหัสผ่านชั่วคราวใหม่ของเจ้าของ, ออก QR ผูก LINE ของเจ้าของใหม่

- **คำอธิบาย** เครื่องมือหลังการเปิดร้านสำหรับผู้ดูแลระบบ
- **ผู้ใช้/สิทธิ์** อ่าน: `system.company_onboarding.read`; ออกรหัส/QR ใหม่: `system.company_onboarding.regenerate_temporary_password` (CRITICAL)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `GET /v1/system/company-onboardings/:id`; `POST …/:id/regenerate-temporary-password` (หมุน credential ของเจ้าของเป็นรหัสชั่วคราวใหม่ อายุ 72 ชั่วโมง); `POST …/:id/reissue-owner-line-link` (ออกเฉพาะ QR ใหม่ ไม่แตะรหัสผ่าน — สำหรับเจ้าของที่ตั้งรหัสถาวรแล้วแต่ QR หมดอายุ)
- **ข้อผิดพลาด** 404 (`Onboarding run "<id>" not found.`, ไม่พบ credential/membership ของเจ้าของ)
- **ข้อมูล** `CompanyOnboardingRun`, `UserCredential`, `EmployeeLineLinkToken`, `AuditLog`
- **API** ตามข้างต้น
- **หน้าจอ** `/system/partners/[companyId]`, `/system/company-onboardings/new` (หน้าผลลัพธ์)
- **การทดสอบ** `application/use-cases/regenerate-temporary-password.use-case.spec.ts`, `application/use-cases/reissue-owner-line-link.use-case.spec.ts`

---

## 8. ข้อมูลหลัก (`data-model-core`)

ไฟล์: `apps/api/src/modules/data-model-core/` — controller: `branch.controller.ts`, `company-identity.controller.ts`, `company-vat-registration.controller.ts`, `attachment.controller.ts`, `document-sequence.controller.ts`, `local-storage.controller.ts`, `object-version-cleanup-internal.controller.ts`; contract `packages/contracts/src/company-tax-identity.ts`, `company-business-type.ts`, `company-profile.ts`

### FR-CORE-062 จัดการสาขา

- **คำอธิบาย** ดู สร้าง แก้ไข และเปลี่ยนสถานะสาขาของบริษัท
- **ผู้ใช้/สิทธิ์** ดู: `company.branch.read` หรือ `company.branch.manage`; สร้าง/แก้: `company.branch.manage` (OWNER, ADMIN)
- **แพ็ก** [ALL] — จำนวนสาขา ACTIVE จำกัดตาม `CompanyPlanTerm.branchLimit` (1 / 1 / 2 / 5 / 10); ไม่มีแถว plan term = ไม่จำกัด; รองรับ capacity override ชั่วคราว
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/branches` (กรอง `status`, `type`, แบ่งหน้า); `POST …/branches` `{code(≤40), name(≤200), type, taxBranchCode?, phone?, email?, addressJson?}`; `PATCH …/branches/:branchId` `{name?, taxBranchCode?, phone?, email?, addressJson?, status?}`
- **กฎ/ข้อยกเว้น** `type` ∈ `HEAD_OFFICE`, `BRANCH`, `ONLINE`, `WAREHOUSE`; `status` ∈ `ACTIVE`, `DISABLED`, `ARCHIVED`; `code` ตรง `^[A-Z0-9_-]{1,20}$` และไม่ซ้ำในบริษัท; `taxBranchCode` เป็นเลข 5 หลัก ไม่ซ้ำในสาขา ACTIVE; บริษัทมีสำนักงานใหญ่ ACTIVE ได้หนึ่งแห่ง; สาขาออกจาก `ACTIVE` ไม่ได้ถ้าเป็นสำนักงานใหญ่ ACTIVE แห่งเดียว (`branch_head_office_required`) หรือเป็นสาขา ACTIVE สุดท้าย (`branch_last_active_required`); การถูกปฏิเสธเพราะสิทธิ์ถูกเขียน audit ผล DENIED
- **ข้อผิดพลาด** 403; 404 `Branch not found.`; 400 (รูปแบบ code/tax code); 409 `branch_head_office_exists`, code/tax code ซ้ำ; 422 `plan_branch_limit_exceeded` (พร้อม `details{limit, active}`), `branch_head_office_required`, `branch_last_active_required`
- **ข้อมูล** `Branch` (`BranchStatus`, `BranchType`), `CompanyPlanTerm`, `AuditLog` (`company.branch.create`, update)
- **API** `GET|POST /v1/companies/:companyId/branches`, `PATCH …/branches/:branchId`
- **หน้าจอ** `/companies/[companyId]/settings/branches` (`features/branch-settings`)
- **การทดสอบ** `application/use-cases/create-branch.use-case.spec.ts`, `update-branch.use-case.spec.ts`, `list-branches.use-case.spec.ts`, `domain/logic/branch.logic.spec.ts`, `infrastructure/repositories/prisma-branch.repository.spec.ts`, `e2e/settings.spec.ts`, `e2e/journeys/evidence-and-settings.journey.spec.ts`

### FR-CORE-063 ตัวตนของบริษัท: ข้อมูลร้าน ตัวตนทางภาษี และประเภทธุรกิจ

- **คำอธิบาย** อ่านและแก้ชื่อร้านที่แสดง, เลขประจำตัวผู้เสียภาษี 13 หลัก, ชื่อจดทะเบียน, ที่อยู่จดทะเบียน และประเภทธุรกิจ พร้อมประวัติการแก้ไขแบบมีชนิด
- **ผู้ใช้/สิทธิ์** อ่าน: `company.setup.read` หรือ `company.setup.manage` (ได้มุมมองปิดบัง — 4 หลักท้าย, จังหวัด); อ่านเต็ม: `company.legal_identity.read`; แก้: `company.legal_identity.manage` (ค่าเริ่มต้นมีเฉพาะ OWNER)
- **แพ็ก** [ALL] (อ่าน/แก้ได้แม้แพ็กหมดอายุสำหรับผู้มีสิทธิ์ที่ตรง — เส้นทางกู้คืน)
- **ขั้นตอนหลัก**
  - `GET /v1/companies/:companyId/identity` → `CompanyIdentityResponse`: บล็อก control (`legalIdentityVersion`, ตัว latch) ส่งเสมอ; ส่วนที่ผู้เรียกไม่มีสิทธิ์เห็นจะ "ไม่มีอยู่" ใน DTO (ไม่ใช่ null); `readiness` แยก `sellerIdentityComplete` กับความพร้อมออกใบกำกับภาษี
  - `PATCH …/identity` — ฟิลด์ `displayName` (1–200), `taxId` (13 หลัก หลังตัดขีด), `registeredName` (1–255), `addressJson` (รูปปิด — key ที่ไม่รู้จักเป็นข้อผิดพลาด), `changeKind`, เหตุผลการแก้, `expectedVersion` → compare-and-set ด้วย `legalIdentityVersion` → เขียน `CompanyLegalIdentityRevision` → audit (เฉพาะ 4 หลักท้ายและชื่อฟิลด์ที่เปลี่ยน) → เข้าคิว sync ลูกค้า Stripe ใน transaction เดียวกัน
  - `POST …/identity/complete-capture` → ปิดช่วง "เก็บข้อมูลครั้งแรก" (เขียนครั้งเดียว, idempotent)
  - `PATCH …/identity/business-type` `{expectedVersion, code, other?}` → `code` เป็นรหัสกิจกรรม DBD/TSIC (`DBD_TSIC_ACTIVITIES`) หรือ `OTHER` (ต้องมีข้อความ ≤ 200 ตัวอักษร)
- **กฎ/ข้อยกเว้น** ชนิดการแก้ที่ผู้ใช้เลือกได้ (`USER_LEGAL_IDENTITY_CHANGE_KINDS`): `INITIAL_CAPTURE`, `CORRECTION` (เหตุผล `TYPO`/`FORMATTING`/`TRANSLITERATION`), `LEGAL_CHANGE`; ระหว่างยังไม่ปิดช่วงเก็บข้อมูล ทุกการแก้เป็น `INITIAL_CAPTURE`; หลังปิดแล้ว เลขผู้เสียภาษีแก้แบบ `CORRECTION` ไม่ได้ (ต้องเป็น `LEGAL_CHANGE` หรือให้ผู้ดูแลระบบแก้ผ่าน reconciliation — FR-CORE-087); ฟิลด์ที่เคยมี revision `LEGAL_CHANGE` รับได้เฉพาะ `LEGAL_CHANGE` ถัดไป; เลขใหม่ทำให้ผลการตรวจสอบเลขเดิมเป็นโมฆะ; ปิดช่วงเก็บข้อมูลไม่ได้ถ้าข้อมูลยังไม่ครบ; ชื่อร้านที่แสดงบนเว็บเป็นอิสระจากฟิลด์ทางกฎหมาย
- **ข้อผิดพลาด** 404 `Company <id> not found`; 409 `legalIdentityVersion is stale; reload and retry`, `company_business_type_version_conflict`; 422 `identity_change_kind_not_allowed` (พร้อม `allowedChangeKinds`), `company_tax_identity_incomplete`, `taxId must be 13 digits`, `registeredName must be 1-255 characters`, `invalid addressJson`, `at least one identity field must be supplied`, `company_business_type_invalid`, `company_business_type_other_required`, `company_business_type_other_invalid`
- **ข้อมูล** `Company` (`name`, `registeredName`, `brandName`, `taxId`, `businessTypeCode/Other/Version`, `addressJson`, `legalIdentityVersion`, `legalIdentityCaptureCompletedAt`, `lastLegalChangeEffectiveDate`, `legalIdentityAuthoritative*`, `tinExists*`, `vatDetail*`), `CompanyLegalIdentityRevision` (`LegalIdentityChangeKind`, `LegalIdentityCorrectionReason`), `CompanyTaxProfile` (mirror เลขภาษีแบบ legacy), `Branch`, `AuditLog`
- **API** `GET|PATCH /v1/companies/:companyId/identity`, `POST …/identity/complete-capture`, `PATCH …/identity/business-type`
- **หน้าจอ** `/companies/[companyId]/settings/profile` (`features/company-profile/CompanyProfilePage` — การ์ด "ข้อมูลร้าน" และ "บัญชีของฉัน"), `/companies/[companyId]/account`
- **การทดสอบ** `application/use-cases/company-identity.use-case.spec.ts`, `domain/logic/company-legal-identity.logic.spec.ts`, `domain/logic/company-tax-readiness.logic.spec.ts`, `infrastructure/company-tax-identity-migration.pg.spec.ts`, `packages/contracts/src/company-tax-identity.spec.ts`, `company-business-type.spec.ts`, `e2e/profile-completeness-card.spec.ts`

### FR-CORE-064 สถานะการจดทะเบียน VAT ของบริษัท (ข้อเท็จจริงแบบมีช่วงวันที่)

- **คำอธิบาย** บันทึกว่าบริษัทจด VAT หรือไม่ ตั้งแต่วันใด เป็นชุดช่วงเวลา `[effectiveFrom, effectiveTo)`; วันที่ไม่มีข้อเท็จจริงครอบคลุม = `UNKNOWN`
- **ผู้ใช้/สิทธิ์** อ่าน: `company.vat_registration.read` (OWNER, FINANCE, ACCOUNTANT); ตอบ/แก้: `company.vat_registration.manage` (OWNER, ACCOUNTANT)
- **แพ็ก** [ALL] (เส้นทางกู้คืนเมื่อแพ็กหมดอายุ)
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/vat-registration?asOf=YYYY-MM-DD`; `PUT …/vat-registration` — คำสั่งชนิด upsert ข้อเท็จจริง (`status` `REGISTERED`/`NOT_REGISTERED`, `effectiveFrom`) หรือ `CANCEL_FUTURE` (`replaceFactId`) พร้อม `commandId` และ `expectedVersion` → ค้นทะเบียนคำสั่ง **ก่อน** compare-and-set (retry ด้วย commandId เดิมได้คำตอบเดิม) → fingerprint คำนวณฝั่ง server → วางแผน (ปิดช่วงเดิม, แทนที่ข้อเท็จจริงในอนาคต) → เขียน `CompanyVatRegistrationFact` + `CompanyVatRegistrationCommand` + ปรับ `CompanyVatRegistrationState` → ปรับ mirror `Company.vatRegistered` (ค่าล่าสุดที่รู้ อาจช้ากว่า; ตรรกะรันใช้ accessor ตามวันที่)
- **กฎ/ข้อยกเว้น** วันที่เริ่มล่วงหน้าได้ไม่เกิน 365 วัน; ห้ามแก้ข้อเท็จจริงทับงวดภาษีที่ยื่นแล้ว (locked period); แหล่งที่มาของข้อเท็จจริง `LEGACY_SEED`, `USER_ANSWER`, `RD_VERIFIED`, `RECONCILIATION`
- **ข้อผิดพลาด** 404; 409 `expectedVersion is stale; reload and retry`, `this commandId was already used with a different payload`; 422 `asOf must be YYYY-MM-DD` และรหัสปฏิเสธจากตัววางแผน
- **ข้อมูล** `CompanyVatRegistrationState`, `CompanyVatRegistrationFact` (`VatFactStatus`, `VatFactSource`), `CompanyVatRegistrationCommand`, `VatRegistrationPrompt`, `TaxPeriod`
- **API** `GET|PUT /v1/companies/:companyId/vat-registration`
- **หน้าจอ** `/companies/[companyId]/settings/profile`
- **การทดสอบ** `application/use-cases/company-vat-registration.use-case.spec.ts`, `domain/logic/company-vat-registration.logic.spec.ts`

### FR-CORE-065 ไฟล์แนบ: อัปโหลด ตรวจ ดาวน์โหลด ผูก และลบ

- **คำอธิบาย** บริการไฟล์กลางของทุกโมดูล: ขอ URL อัปโหลดแบบลงนาม → อัปโหลดตรงไป storage → ยืนยันและตรวจเนื้อหา → ผูกกับเอกสารต้นทาง → ดาวน์โหลดด้วย URL ลงนาม
- **ผู้ใช้/สิทธิ์** `attachment.create` (ขอ/ยืนยัน/ผูก), `attachment.read` (ดาวน์โหลด), `attachment.delete` (ลบ — OWNER, ADMIN)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  1. `POST /v1/companies/:companyId/attachments/upload-intent` `{originalFileName(≤500), mimeType, byteSize, visibility?, branchId?, metadataJson?}` → ตรวจชนิดและขนาด → สร้าง `AttachmentObject` สถานะ `PENDING_UPLOAD` + URL อัปโหลด (วัตถุที่ค้างเก็บ 24 ชั่วโมง)
  2. `POST …/attachments/:attachmentId/complete` `{checksumSha256?, byteSize?}` → ตรวจว่ามีวัตถุใน storage, ตรวจ magic bytes/ชนิดจริง, ตรวจเนื้อหา (PDF: ไม่มีไฟล์ฝัง, ไม่มี active content, จำกัดจำนวน object และขนาดขยาย; รูป: ไม่มี active content), สแกนมัลแวร์ (ClamAV — `infrastructure/attachment-malware-scanner.ts`), คำนวณ perceptual hash ของรูป (ใช้ตรวจซ้ำแบบแนะนำ ล้มเหลวได้โดยไม่กระทบการอัปโหลด) → `ACTIVE`
  3. `GET …/attachments/:attachmentId/download-url?disposition=inline|attachment` → URL ลงนามพร้อม `expiresAt`
  4. `POST …/attachments/:attachmentId/links` `{targetType, targetId, purpose}` → ผูกกับเป้าหมายที่อนุญาต (`isAllowedAttachmentTarget`)
  5. `DELETE …/attachments/:attachmentId`
- **กฎ/ข้อยกเว้น** ชนิดที่รับ: `image/jpeg`, `image/png`, `application/pdf` (นามสกุลต้องตรงชนิด); ขนาดสูงสุด 25 MB (`MAX_ATTACHMENT_BYTES`); ดาวน์โหลดได้เฉพาะ `ACTIVE` และอยู่ใน branch scope; ผู้อัปโหลดเท่านั้นที่ resume การอัปโหลดของตน; `inline` อนุญาตเฉพาะ PNG/JPEG/PDF (SVG ไม่เคย inline); ไฟล์ลายเซ็นใน `company.signature_asset` และสลิปจ่ายเงินเบิกจ่ายเป็นไฟล์เฉพาะทาง ผูกร่วมกับเป้าหมายอื่นไม่ได้ และดาวน์โหลดผ่านทางทั่วไปไม่ได้; ไฟล์ใบทวิ 50 ภายนอก, ไฟล์ใบสำคัญจ่าย และหลักฐานใบรับรองแทนใบเสร็จที่ล็อกการเก็บรักษาแล้ว ลบไม่ได้; การปฏิเสธเนื้อหาเขียน security event `attachment.upload.rejected`
- **ข้อผิดพลาด** 400 (ชนิด/ขนาด/ชื่อไฟล์, `Attachment is not in PENDING_UPLOAD state.`, `Uploaded object was not found in storage.`, รหัส `CONTENT_UNINSPECTABLE` / `EMBEDDED_FILE_REJECTED` / `CONTENT_REJECTED`); 403 (`Attachment is not accessible.`, `Attachment is outside your assigned branch scope.`, `wht_external_file_read_denied`, `disbursement_file_general_download_denied`); 404; 409 (`SUBSTITUTE_EVIDENCE_RETENTION_LOCKED`, `disbursement_file_retained`); 429/503 จากการจำกัดการอัปโหลด
- **ข้อมูล** `AttachmentObject` (`AttachmentStatus`, `AttachmentVisibility`), `AttachmentBlob`, `AttachmentLink`, `OutboxEvent`
- **API** ตามขั้นตอน
- **หน้าจอ** ใช้โดยทุกหน้าที่มีไฟล์ (ค่าใช้จ่าย, เบิกจ่าย, ลายเซ็น)
- **การทดสอบ** `application/use-cases/create-upload-intent.use-case.spec.ts`, `complete-attachment-upload.use-case.spec.ts`, `create-download-url.use-case.spec.ts`, `link-attachment.use-case.spec.ts`, `delete-attachment.use-case.spec.ts`, `free-expense-attachment.spec.ts`, `domain/logic/attachment.logic.spec.ts`, `infrastructure/attachment-malware-scanner.spec.ts`, `infrastructure/repositories/prisma-attachment.repository.spec.ts`

### FR-CORE-066 Storage adapter (S3 และ local) และ endpoint ของ local storage

- **คำอธิบาย** port `attachment-storage.port.ts` มี adapter สองตัว: `s3-storage.adapter.ts` (presigned URL) และ `local-storage.adapter.ts` (สำหรับเครื่องนักพัฒนา ใช้ token ใน URL)
- **ผู้ใช้/สิทธิ์** `@Public()` (token ใน path คือ credential) — อยู่นอก prefix `/v1`
- **แพ็ก** ไม่เกี่ยวกับแพ็ก (โครงสร้างพื้นฐาน)
- **ขั้นตอนหลัก** `PUT /local-storage/upload/:token`, `GET /local-storage/download/:token`
- **ข้อมูล** `AttachmentObject`
- **API** ตามข้างต้น
- **หน้าจอ** ไม่มี
- **การทดสอบ** ครอบคลุมผ่าน specs ของ attachment use case

### FR-CORE-067 ลำดับเลขที่เอกสาร (document sequence) และการจองเลข

- **คำอธิบาย** ตั้งรูปแบบเลขที่เอกสารต่อชนิดเอกสาร และบริการจอง/ยืนยัน/ยกเลิก/void เลขที่ให้โมดูลอื่น
- **ผู้ใช้/สิทธิ์** อ่าน: `document.sequence.read` (OWNER, ADMIN, FINANCE, ACCOUNTANT, AUDITOR_READONLY); ตั้งค่า: `document.sequence.manage` (OWNER, ADMIN)
- **แพ็ก** [ALL] (ใช้โดยเอกสารค่าใช้จ่าย/เบิกจ่ายของ starter preset และโมดูลอื่น)
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/document-sequences`; `PUT …/document-sequences/:documentType` `{branchId?, periodKey, prefixTemplate(≤80), padding(1–12)?, resetPolicy?}`; use case ภายใน: `reserve-document-number`, `commit-document-number`, `cancel-document-number`, `void-document-number`
- **กฎ/ข้อยกเว้น** placeholder ที่ใช้ได้: `{YYYY}`, `{YY}`, `{MM}`, `{BRANCH}`, `{DOC}`, `{SEQ}`; นโยบาย reset: `NONE`, `MONTHLY`, `YEARLY`; ตัวนับแยกสาขาได้เฉพาะเมื่อ template มี `{BRANCH}` (เพราะ `DocumentNumber` unique ระดับบริษัทบน `(companyId, documentType, documentNumber)`) — การตั้งค่าที่ขัดกันถูกปฏิเสธตั้งแต่ตอนตั้งค่า
- **ข้อผิดพลาด** 403; 400 (template ไม่ถูกต้อง / ตัวนับแยกสาขาโดยไม่มี `{BRANCH}`)
- **ข้อมูล** `DocumentSequence` (`DocumentSequenceStatus`, `DocumentResetPolicy`), `DocumentNumber` (`DocumentNumberStatus`)
- **API** `GET /v1/companies/:companyId/document-sequences`, `PUT …/document-sequences/:documentType`
- **หน้าจอ** ไม่พบหน้าตั้งค่าเฉพาะใน `apps/web/app` (ใช้ค่าเริ่มต้นจาก `getDefaultDocumentSequenceConfig`)
- **การทดสอบ** `application/use-cases/upsert-document-sequence.use-case.spec.ts`, `list-document-sequences.use-case.spec.ts`, `reserve-document-number.use-case.spec.ts`, `domain/logic/document-sequence.logic.spec.ts`, `infrastructure/repositories/document-sequence-branch-collision.spec.ts`

### FR-CORE-068 Outbox event (เขียนเหตุการณ์ในธุรกรรมเดียวกับข้อมูล)

- **คำอธิบาย** บริการกลางสำหรับเขียน `OutboxEvent` แบบ idempotent เพื่อให้ worker ส่งต่อ (อีเมล, LINE push, workflow, การล้าง storage)
- **ผู้ใช้/สิทธิ์** ภายใน
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `OutboxAppendService` — canonical JSON (เรียง key ทุกระดับ, เคารพ `toJSON`) → fingerprint; append ที่ไม่มี requestId ใช้ `occurredAt` ของผู้เรียกเป็นขอบเขตการเกิดหนึ่งครั้ง; ล้มเหลว → log event `outbox.append.failed`
- **ข้อมูล** `OutboxEvent` (`OutboxEventStatus`, `OutboxEventPriority`)
- **API** ไม่มี (permission `outbox.event.read` มีในทะเบียนแต่ไม่พบ controller ที่ใช้)
- **การทดสอบ** `application/services/outbox-append.service.spec.ts`, `domain/logic/outbox.logic.spec.ts`

### FR-CORE-069 การล้าง object version ใน storage (งานภายใน)

- **คำอธิบาย** worker รับงานลบ version ของวัตถุใน S3 ที่ไม่ใช้แล้ว (เช่นการอัปโหลดที่ถูกปฏิเสธ/ถูกแทนที่)
- **ผู้ใช้/สิทธิ์** worker (`x-worker-token`)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `POST /v1/internal/storage-cleanup/object-versions/claim` → รับงาน (outbox ชนิด `storage.object_version_cleanup.requested`); `POST …/:id/complete`; `POST …/:id/fail` (พร้อม `errorCode`)
- **ข้อผิดพลาด** 400 `cleanup claim identity is invalid`, `cleanup errorCode is invalid`; 401
- **ข้อมูล** `OutboxEvent`
- **API** ตามข้างต้น
- **การทดสอบ** `application/services/object-version-cleanup.service.spec.ts`, `domain/logic/object-version-inventory.logic.spec.ts`

### FR-CORE-070 การกำหนดสาขาของรายการธุรกรรม

- **คำอธิบาย** ทุกการสร้างรายการที่ผูกสาขาใช้ตัวช่วยเดียวกันเพื่อเลือก/ตรวจสาขา
- **ผู้ใช้/สิทธิ์** ภายใน (ทุกโมดูลธุรกรรม)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** (`application/services/transaction-branch.ts`) สาขาที่ผู้ใช้เลือกชนะ (ต้องอยู่ใน scope); ถ้าไม่เลือกและมีสาขาที่ใช้ได้เพียงแห่งเดียว → ใช้สาขานั้น; ผู้ที่เห็นทุกสาขาต้องเลือกเอง
- **ข้อผิดพลาด** 422 `TRANSACTION_BRANCH_REQUIRED`, `TRANSACTION_BRANCH_INVALID`; 403 `Branch is outside your assigned branch scope.`
- **ข้อมูล** `Branch`
- **หน้าจอ** `TransactionBranchField.tsx`
- **การทดสอบ** `application/services/transaction-branch.spec.ts`, `e2e/transaction-branch.spec.ts`

---

## 9. Audit (`audit`)

ไฟล์: `apps/api/src/modules/audit/application/audit.service.ts`, `domain/models/audit-action.ts`, `domain/logic/audit-actor.logic.ts`, `infrastructure/prisma-audit.repository.ts`, `presentation/audit.controller.ts`

### FR-CORE-071 บันทึก audit log

- **คำอธิบาย** ทุกการกระทำสำคัญเขียนแถว `AuditLog` (action แบบ dotted จาก `AuditAction`, target, actor, requestId, result, riskLevel, metadata)
- **ผู้ใช้/สิทธิ์** ภายใน
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** สามโหมด: `log(entry)` หลัง commit — ไม่ throw (insert หนึ่งครั้ง + retry หนึ่งครั้ง แล้ว log event `audit.persist.failed`); `log(entry, tx)` ใน transaction — throw เพื่อ rollback ทั้งหมด; `logOrThrow(entry)` ก่อนผลข้างเคียง — fail-closed (ใช้ที่ขอบเขตเครื่องมือ AI)
- **กฎ/ข้อยกเว้น** metadata ถูก sanitize: key ที่ตรง `authorization|password|token|secret|cookie|credential|api[_-]?key|raw(prompt|body|payload)|full(payload|body)|document(body|content)|body|content` → `[REDACTED]`; สตริงยาวเกิน 512 ตัวถูกตัด; อาร์เรย์เกิน 50 รายการถูกตัด; result ∈ `SUCCESS`, `DENIED`, `FAILED` (`AuditResult`); risk ∈ `LOW/MEDIUM/HIGH/CRITICAL`; actor type ∈ `USER`, `SYSTEM`, `CRM_CUSTOMER`, `SERVICE` (`AuditActorType`)
- **ข้อมูล** `AuditLog`
- **API** ไม่มี
- **การทดสอบ** `audit.service.spec.ts`, `domain/logic/audit-actor.logic.spec.ts`, `infrastructure/prisma-audit.repository.spec.ts`

### FR-CORE-072 อ่าน audit log ของบริษัท

- **คำอธิบาย** รายการ audit log ของบริษัทแบบแบ่งหน้า กรองตามบทบาทของผู้อ่าน
- **ผู้ใช้/สิทธิ์** `audit.log.read` (OWNER, ADMIN, ACCOUNTANT, AUDITOR_READONLY)
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/audit/logs?page&pageSize&targetType&actorUserId&from&to` → `{data[{id, action, targetType, targetId, actorUserId, result, riskLevel, createdAt, requestId}], total, page, pageSize}`
- **กฎ/ข้อยกเว้น** `pageSize` 1–100 (ค่าเริ่มต้น 20); `OWNER` และ `AUDITOR_READONLY` เห็นทั้งบริษัท; `ADMIN` เห็นหมวด `admin`, `security`; `ACCOUNTANT` เห็นหมวด `accounting`, `tax`, `finance`; บทบาทอื่นที่ได้ permission นี้ผ่าน role กำหนดเองเห็นเฉพาะรายการที่ตนเป็น actor; response ไม่มี `metadataJson`
- **ข้อผิดพลาด** 403
- **ข้อมูล** `AuditLog`
- **API** `GET /v1/companies/:companyId/audit/logs`
- **หน้าจอ** ไม่พบหน้าเฉพาะใน `apps/web/app` ที่เรียก endpoint นี้ (ยืนยันไม่ได้ว่ามี UI — ดู §21)
- **การทดสอบ** `infrastructure/prisma-audit.repository.spec.ts`

---

## 10. สิทธิ์เจ้าของข้อมูล (`data-rights`)

ไฟล์: `apps/api/src/modules/data-rights/data-rights.controller.ts`, `data-rights.service.ts`; contract `packages/contracts/src/data-rights.ts`

### FR-CORE-073 เคสสิทธิ์เจ้าของข้อมูลและการยุติการใช้งาน (PDPA case control plane)

- **คำอธิบาย** ผู้ดูแลระบบเปิดและเดินเคสคำขอลบบัญชีผู้ใช้ การออกจากร้าน และการยุติ workspace ของบริษัท เป็น "จุดควบคุมและเก็บหลักฐาน" — โค้ดในโมดูลนี้ไม่อ่าน ย้าย หรือลบข้อมูลของเป้าหมายเอง
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; `system.data_rights.manage` (CRITICAL; ทุก endpoint ของ controller)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**

  | Endpoint (`/v1/system/data-rights/…`) | ขั้น |
  |---|---|
  | `POST cases` | เปิดเคส (`caseType`, `requestSource`, เป้าหมาย, `requestKey` สำหรับ idempotency) |
  | `GET cases`, `GET cases/:caseId` | รายการ / รายละเอียด + ประวัติการกระทำ |
  | `POST cases/:caseId/verify-identity` | ยืนยันตัวตนผู้ร้อง → `IDENTITY_VERIFIED` |
  | `POST cases/:caseId/verify-authority` | ยืนยันอำนาจต่อ tenant |
  | `POST cases/:caseId/begin-retention-review` | → `RETENTION_REVIEW` |
  | `POST cases/:caseId/decisions` | บันทึกการตัดสินรายหมวดข้อมูล |
  | `POST cases/:caseId/evidence` | แนบหลักฐาน |
  | `POST cases/:caseId/approve` | → `APPROVED` |
  | `POST cases/:caseId/start-execution` | → `EXECUTING` |
  | `POST cases/:caseId/start-verification` | → `VERIFICATION` |
  | `POST cases/:caseId/complete` | `outcome` ∈ `COMPLETED` / `COMPLETED_WITH_EXCEPTION` + `outcomeSummary` (≤ 4,000 ตัวอักษร) |
  | `POST cases/:caseId/close` | ปิดเคสโดยไม่ดำเนินการ: `outcome` ∈ `REJECTED` / `CANCELLED` / `BLOCKED` |

- **กฎ/ข้อยกเว้น**
  - ชนิดเคส: `USER_ACCOUNT_ERASURE`, `MEMBERSHIP_EXIT`, `COMPANY_WORKSPACE_OFFBOARDING`; แหล่งคำขอ: `EMAIL`, `SUPPORT`, `IN_APP`, `OTHER_MONITORED_CHANNEL`
  - หมวดการตัดสิน 12 หมวด: `ACCOUNT_IDENTITY`, `AUTHENTICATION_SECRETS`, `MEMBERSHIPS_ACCESS`, `TENANT_OPERATIONAL_DATA`, `ACCOUNTING_TAX_DOCUMENTS`, `ATTACHMENTS_OBJECT_VERSIONS`, `AI_OCR_DATA`, `AUDIT_SECURITY_LOGS`, `QUEUES_CACHES`, `PROCESSORS`, `BACKUPS`, `LEGAL_ACCEPTANCE_EVIDENCE`; การจัดการ: `DELETE`, `ANONYMIZE`, `RESTRICT`, `RETAIN`, `RETURN`, `NOT_APPLICABLE`
  - ขอบเขตข้ามประเภท (`dataRightsAllowedDispositions`): `MEMBERSHIP_EXIT` ตัดสินได้เฉพาะ `MEMBERSHIPS_ACCESS` (`DELETE`/`RESTRICT`/`NOT_APPLICABLE`); `USER_ACCOUNT_ERASURE` กับข้อมูลของ tenant (ปฏิบัติการ, เอกสารบัญชี/ภาษี, ไฟล์แนบ) ได้เฉพาะ `RESTRICT`/`RETAIN`/`NOT_APPLICABLE`; `COMPANY_WORKSPACE_OFFBOARDING` กับ `ACCOUNT_IDENTITY`/`AUTHENTICATION_SECRETS` ได้เฉพาะ `NOT_APPLICABLE`
  - หลักฐานขั้นต่ำต่อชนิดเคส (`dataRightsBaselineEvidenceRequirements`) และหลักฐานตามการตัดสิน (`dataRightsEvidenceRequirements`); ชนิดหลักฐาน 11 ชนิด (`IDENTITY_VERIFICATION` … `INDEPENDENT_VERIFICATION`)
  - การแบ่งแยกหน้าที่: ห้าขั้นตอนถูกปฏิเสธถ้าผู้ทำเป็นคนเดียวกับขั้นก่อน (`data_rights_second_admin_required`) ยกเว้นเมื่อแพลตฟอร์มมี System Admin ที่ใช้งานอยู่เพียงคนเดียว — ทำ "self-step" ได้โดยต้องให้เหตุผล มีเครื่องหมายบนแถว และ audit `system.data_rights.single_admin_step`; ฐานข้อมูลบังคับกฎเดียวกันซ้ำ
  - `requestKey` ซ้ำด้วย payload เดียวกัน = replay; ต่างกัน = 409
- **ข้อผิดพลาด** 404 (`Data-rights case <id> was not found.`, ไม่พบผู้ใช้/บริษัทเป้าหมาย); 409 (`data_rights_request_key_conflict`, `Tenant authority is already verified.`, `Case <id> is already terminal.`); 403 `data_rights_second_admin_required`; 422 `data_rights_invalid_input` และรหัสของแต่ละขั้น
- **ข้อมูล** `DataRightsCase` (`DataRightsCaseType`, `DataRightsCaseStatus`, `DataRightsRequestSource`), `DataRightsDecisionRecord` (`DataRightsDecisionCategory`, `DataRightsDisposition`), `DataRightsEvidenceRecord` (`DataRightsEvidenceType`), `DataRightsCaseActionRecord`, `AuditLog`
- **API** ตามตาราง
- **หน้าจอ** `/system/data-rights`, `/system/data-rights/new`, `/system/data-rights/[caseId]` (`features/system-data-rights`); หน้าสาธารณะอธิบายขั้นตอน `/data-deletion`
- **การทดสอบ** `data-rights.service.spec.ts`, `data-rights.controller.spec.ts`, `data-rights-single-admin.pg.spec.ts`, `packages/contracts/src/data-rights.spec.ts`

---

## 11. แดชบอร์ดและการแจ้งเตือน (`dashboard-notifications`)

ไฟล์: `apps/api/src/modules/dashboard-notifications/` — `presentation/http/dashboard.controller.ts`, `notification.controller.ts`, `internal.controller.ts`; use case ใน `application/use-cases/`; ผู้ให้ข้อมูล widget ใน `application/providers/`; ตรรกะใน `domain/logic/notification.logic.ts`; ค่าคงที่ใน `domain/models/notification.model.ts`, `dashboard.model.ts`; contract `packages/contracts/src/dashboard.ts`, `notifications.ts`

### FR-CORE-074 แดชบอร์ดของบริษัท (snapshot)

- **คำอธิบาย** หน้าแรกของ workspace แสดง widget สรุปตามช่วงเวลา จาก snapshot ที่ cache ไว้
- **ผู้ใช้/สิทธิ์** อ่าน: `dashboard.read`; สั่งสร้างใหม่: `dashboard.snapshot.generate` (OWNER, ADMIN)
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/dashboard?periodKind&branchId&customStart&customEnd`; `GET …/dashboard/snapshots/latest`; `POST …/dashboard/snapshots/generate` (บังคับสร้างใหม่) → `DashboardSnapshotDto{periodKind, periodStart, periodEnd, generatedAt, freshnessStatus, widgets[]}`
- **กฎ/ข้อยกเว้น** `periodKind` ∈ `today`, `week`, `month`, `quarter`, `last_month`, `custom`; snapshot ถือว่า `fresh` ภายใน 15 นาที (`SNAPSHOT_FRESH_THRESHOLD_MINUTES`) และนำกลับมาใช้เฉพาะเมื่อ (ก) ตรงกับช่วงเวลาที่ขอจริง (ข) ยังตรงกับฟีเจอร์ที่บริษัทเปิดอยู่; **เนื้อหา** ของ snapshot ตามฟีเจอร์ของบริษัท ไม่ตามสิทธิ์ของผู้กระตุ้น; **การมองเห็น** แต่ละ widget ตรวจต่อคำขอ — ผู้อ่านต้องถือ permission อ่านของ provider นั้น (deny by default); provider ที่มี: `ExpenseSummaryProvider` (ค่าใช้จ่าย — อยู่ในแพ็กที่ขาย) และ `InventoryHealthProvider` (สต๊อก — ฟีเจอร์ `inventory` ไม่อยู่ในแพ็กที่ขาย ดู §20); provider ที่ล้มเหลวคืน widget สถานะ unavailable; การเลือกสาขาชัดเจนเป็นแบบตรงตัว ไม่เลือก = ขอบเขตของผู้อ่าน; มุมมองรวมไม่จำกัดเท่านั้นที่รวมรายการส่วนกลางของบริษัท
- **ข้อผิดพลาด** 403 (`feature_not_enabled` เมื่อ `dashboard_notifications` ปิด)
- **ข้อมูล** `DashboardSnapshot` (`DashboardScope`, `DashboardFreshnessStatus`, `DashboardGeneratedBy`), `DashboardWidgetConfig` (`DashboardWidgetStatus`), `ExpenseRecord`
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/dashboard` (`features/web-core-workspace/components/WorkspaceDashboardPage.tsx`)
- **การทดสอบ** `application/use-cases/generate-snapshot.use-case.spec.ts`, `application/providers/expense-summary.provider.spec.ts`, `dashboard-notification-correctness.spec.ts`, `presentation/http/dashboard-notifications.dtos.spec.ts`, `e2e/dashboard.spec.ts`
- **หมายเหตุ** permission `dashboard.configure` มีในทะเบียน แต่ไม่พบ controller ที่ใช้ (ไม่มี endpoint ปรับแต่ง widget)

### FR-CORE-075 ยอดค่าใช้จ่ายรายเดือนบนแดชบอร์ด

- **คำอธิบาย** ยอดรวมค่าใช้จ่ายที่ยืนยันแล้วแยกตามเดือนของปีที่เลือก
- **ผู้ใช้/สิทธิ์** `dashboard.read`
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/dashboard/expense-months` → `DashboardExpenseMonthsDto{year, months[{month, total(สตริงทศนิยม 2 ตำแหน่ง), count}], years[]}` (ปีที่มีข้อมูลในขอบเขตสาขาเดียวกัน + ปีปัจจุบัน)
- **ข้อมูล** `ExpenseRecord`
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/dashboard`
- **การทดสอบ** `application/providers/expense-summary.provider.spec.ts`

### FR-CORE-076 ศูนย์แจ้งเตือน (กระดิ่ง)

- **คำอธิบาย** รายการแจ้งเตือนของผู้ใช้ จำนวนที่ยังไม่อ่าน ทำเครื่องหมายอ่านแล้ว อ่านทั้งหมด และปิดรายการ
- **ผู้ใช้/สิทธิ์** `notification.read`
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/notifications` (กรอง `status`, `severity`, `triggerKey`, `read`, `cursor`, `pageSize`); `GET …/notifications/unread-count` → `{total, bySeverity{critical, action, insight, info}}`; `POST …/notifications/:notificationId/read`; `POST …/notifications/read-all`; `POST …/notifications/:notificationId/dismiss`
- **กฎ/ข้อยกเว้น** ระดับความสำคัญ: `critical` (สำคัญ), `action` (ต้องดำเนินการ), `insight` (ข้อมูลเชิงลึก), `info` (แจ้งเพื่อทราบ); สถานะเหตุการณ์: `open`, `resolved`, `suppressed`, `expired`; แจ้งเตือนเป็นของผู้รับแต่ละคน (`NotificationRecipient`)
- **ข้อมูล** `NotificationEvent` (`NotificationSeverity`, `NotificationEventStatus`), `NotificationRecipient`
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/notifications`, กระดิ่งใน header ของ workspace
- **การทดสอบ** `dashboard-notification-correctness.spec.ts`, `e2e/notifications.spec.ts`

### FR-CORE-077 ตั้งค่าการแจ้งเตือนของผู้ใช้

- **คำอธิบาย** ผู้ใช้เลือกช่องทาง (เว็บ/LINE), ชนิดแจ้งเตือนที่เปิด, ช่วงเวลาเงียบ, เขตเวลา และความถี่สรุป
- **ผู้ใช้/สิทธิ์** `notification.preference.manage`
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** `GET|PUT /v1/companies/:companyId/notification-preferences` — `enabledChannels` (`web`, `line`), `enabledTriggerKeys`, `quietHoursStart/End`, `timezone`, `digestFrequency` (`none`/`daily`/`weekly`)
- **กฎ/ข้อยกเว้น** ไม่มีแถวตั้งค่า = ค่าเริ่มต้น: ช่องทาง `['web','line']`, ทุก trigger ใน `IMPLEMENTED_TRIGGER_KEYS`, เขตเวลา Asia/Bangkok; ช่วงเวลาเงียบระงับ LINE สำหรับรายการที่ไม่ใช่ critical (รองรับช่วงข้ามคืน); trigger ใน `ALWAYS_DELIVERED_TRIGGER_KEYS` (เช่น `expense.review_requested`, `expense.disbursement_*`, `expense.wht_certificate_cancelled`) ส่งเสมอ; รายการ trigger ที่บันทึกไว้เก่ากว่า trigger ที่เพิ่มทีหลังไม่ทำให้แจ้งเตือนใหม่หาย
- **ข้อมูล** `NotificationPreference` (`NotificationChannel`, `NotificationDigestPolicy`)
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/notifications/preferences`, `/companies/[companyId]/settings/notifications`
- **การทดสอบ** `application/use-cases/notification-preference.use-case.spec.ts`, `domain/logic/notification.logic.spec.ts`

### FR-CORE-078 กฎการแจ้งเตือนของบริษัท

- **คำอธิบาย** ผู้ดูแลเปิด/ปิดกฎและปรับเงื่อนไข ผู้รับ ช่องทาง cooldown ของแต่ละ trigger
- **ผู้ใช้/สิทธิ์** `notification.rule.manage` (OWNER, ADMIN)
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** `GET /v1/companies/:companyId/notification-rules`; `PUT …/notification-rules/:ruleId` `{conditionJson?, recipientPolicyJson?, channelPolicyJson?, cooldownMinutes?, digestPolicy?, status?('enabled'|'disabled')}`
- **กฎ/ข้อยกเว้น** สถานะกฎ `enabled`/`disabled`/`system`; dedup ด้วย `buildDedupKey`; cooldown ต่อกฎ (`computeCooldownUntil`); trigger ถูกผูกกับ feature key ผ่าน `NOTIFICATION_TRIGGER_FEATURE_KEYS` — trigger ของฟีเจอร์ที่บริษัทไม่ได้เปิดไม่ถูกส่ง
- **ข้อมูล** `NotificationRule` (`NotificationRuleStatus`), `AlertState` (`AlertStateStatus`)
- **API** ตามข้างต้น
- **หน้าจอ** `/companies/[companyId]/notifications/rules`, `/companies/[companyId]/settings/notification-rules`
- **การทดสอบ** `dashboard-notification-correctness.spec.ts`

### FR-CORE-079 การส่งแจ้งเตือน (เว็บ + LINE push) และการลองใหม่

- **คำอธิบาย** เหตุการณ์แจ้งเตือนถูกแตกเป็นผู้รับและรายการส่งต่อช่องทาง; LINE push ไปยัง LINE ของพนักงานผ่าน OA ของระบบ; ผู้ดูแลดู log การส่งและสั่งส่งใหม่
- **ผู้ใช้/สิทธิ์** ดู log: `notification.delivery.read` (OWNER, ADMIN, AUDITOR_READONLY); สั่งส่งใหม่: `notification.delivery.retry` (OWNER, ADMIN)
- **แพ็ก** [ALL-DN]
- **ขั้นตอนหลัก** โมดูลอื่นเรียก `CreateOrUpdateNotificationEventUseCase` (dedup → cooldown → สร้างผู้รับเฉพาะสมาชิกปัจจุบัน → สร้าง `NotificationDelivery` สถานะ `queued`; รองรับ `supersedeEarlier` และผู้รับแบบเว็บอย่างเดียว) → `ProcessQueuedDeliveryUseCase` ตรวจซ้ำที่ทางออก (สมาชิกภาพ, ฟีเจอร์ของบริษัท, ตั้งค่าผู้ใช้, ช่วงเวลาเงียบ, LINE identity บน channel ของระบบ, ไม่ push ไปยังแชตเดโม) → claim + เรียกผู้ให้บริการ + บันทึกผล ใน transaction เดียว; `GET /v1/companies/:companyId/notification-deliveries`; `POST …/notification-deliveries/:deliveryId/retry`
- **กฎ/ข้อยกเว้น** สถานะการส่ง: `queued`, `sending`, `sent`, `failed`, `skipped`, `suppressed`; ลองสูงสุด 5 ครั้ง (`MAX_DELIVERY_ATTEMPTS`); backoff แบบ exponential ฐาน 30 วินาที สูงสุด 1 ชั่วโมง; ข้อผิดพลาดที่ลองใหม่ได้: `RATE_LIMIT`, `NETWORK_ERROR`, `TIMEOUT`, `PROVIDER_ERROR`, `HTTP_5xx`; `HTTP_4xx` ถือว่าจบ; ลิงก์ในข้อความ LINE ใช้ handoff token (FR-CORE-012); การแจ้งเตือน CRM ตรวจซ้ำหลัง lock รายลูกค้าเพื่อเคารพการลบข้อมูลตาม PDPA
- **ข้อผิดพลาด** 403; 404; 400 `Delivery is not retryable`; 400 `NOTIFICATION_RETRY_REVIEW_REQUIRED` (รายการเปลี่ยนไปแล้ว); การสั่งส่งใหม่สำเร็จเขียน audit `notification_delivery.retry`
- **ข้อมูล** `NotificationDelivery` (`NotificationDeliveryStatus`), `NotificationRecipient`, `NotificationEvent`, `ExternalIdentity`
- **API** ตามข้างต้น
- **หน้าจอ** ไม่พบหน้า log การส่งเฉพาะใน `apps/web/app` (ยืนยันไม่ได้ — ดู §21)
- **การทดสอบ** `application/use-cases/process-due-deliveries.use-case.spec.ts`, `infrastructure/document-notification-state.spec.ts`, `domain/logic/notification.logic.spec.ts`

### FR-CORE-080 งานกวาดของ worker สำหรับแดชบอร์ดและการแจ้งเตือน

- **คำอธิบาย** endpoint ภายในที่ worker เรียกตามเวลา
- **ผู้ใช้/สิทธิ์** worker (`x-worker-token`); รันด้วยบริบทระบบสิทธิ์น้อยที่สุด (`WORKER_NOTIFICATION_PERMISSIONS` — ไม่สังเคราะห์บทบาท OWNER)
- **แพ็ก** [PLATFORM] (ทำงานให้บริษัทที่เปิด `dashboard_notifications`)
- **ขั้นตอนหลัก**

  | Endpoint | หน้าที่ |
  |---|---|
  | `POST /v1/internal/notifications/delivery-sweep` | ส่งรายการ `queued` ที่ถึงกำหนด (ชุดละ 200 — `DELIVERY_SWEEP_BATCH_LIMIT`); ความล้มเหลวของรายการหนึ่งไม่หยุดทั้งชุด |
  | `POST /v1/internal/notifications/snapshot-sweep` | สร้าง snapshot แดชบอร์ดของทุกบริษัท |
  | `POST /v1/internal/notifications/stock-low-sweep` | สแกนสต๊อกต่ำ (ฟีเจอร์ inventory — §20) |
  | `POST /v1/internal/notifications/daily-owner-summary-sweep` | สรุปรายวันถึงเจ้าของ; ถ้าบางบริษัทล้มเหลวตอบ non-2xx เพื่อให้ worker ลองใหม่ (บริษัทที่สำเร็จ dedup ด้วย periodKey) |
  | `POST /v1/internal/companies/:companyId/dashboard/snapshots/generate` | สร้าง snapshot รายบริษัท |
  | `POST /v1/internal/companies/:companyId/notifications/scan/stock-low` | สแกนสต๊อกต่ำรายบริษัท |
  | `POST /v1/internal/companies/:companyId/notifications/daily-owner-summary` | สรุปรายวันรายบริษัท |
  | `POST /v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | ประมวลผลรายการส่งเดียว |

- **กฎ/ข้อยกเว้น** งานกวาดบันทึกการสังเกตแบบ shadow ของ launch gate (FR-CORE-083) โดยไม่ใช้ผลตัดสิน
- **ข้อผิดพลาด** 401 `Invalid worker token`
- **ข้อมูล** `DashboardSnapshot`, `NotificationEvent`, `NotificationDelivery`, `FeatureLaunchObservationBucket`
- **การทดสอบ** `presentation/http/internal.controller.spec.ts`, `application/use-cases/process-due-deliveries.use-case.spec.ts`

---

## 12. Launch gate และ entitlement ขณะรัน (`feature-launch`)

ไฟล์: `apps/api/src/modules/feature-launch/` — `domain/launch-matrix.catalog.ts`, `domain/runoff-matrix.catalog.ts`, `domain/shadow-surface.catalog.ts`, `application/launch-gate.guard.ts`, `application/use-cases/launch-gate-command.use-case.ts`, `get-launch-health.use-case.ts`, `application/seed-launch-gates.ts`, `retire-launch-builds.ts`, `execution-attempt.service.ts`, `launch-shadow.probe.ts`, `runoff-lifecycle.ts`, `presentation/http/launch-gate.controller.ts`, `runoff-internal.controller.ts`

มีสองชั้นที่ต่างกันและต้องไม่สับสน:

1. **Entitlement (ซื้อหรือไม่)** — รายบริษัท ตัดสินด้วย `CompanyFeatureEntitlement` → ผิดเงื่อนไขตอบ `feature_not_enabled` (FR-CORE-032)
2. **Launch gate (เปิดให้บริการหรือไม่ ณ ตอนนี้)** — ระดับแพลตฟอร์มต่อ (gateKey, routeKey) ไม่มีสถานะรายบริษัท → ปิดอยู่ตอบ `feature_temporarily_unavailable`

`FEATURE_LAUNCH_MATRIX` (สำเนาในโค้ดของ `docs/specs/feature-entitlement-launch-matrix.json` เพราะ image production ไม่มี `docs/`; spec `launch-matrix.catalog.spec.ts` ตรวจว่าตรงกัน) — แถวที่ seed เป็น `OPEN` (routeKey `DEFAULT`, class `ORDINARY`): `inventory`, `product_catalog`, `sales_documents`, `expenses`, `reimbursement`, `double_entry_ledger`, `expense_auto_post`, `thai_tax`, `procurement`, `bank_reconciliation`, `crm`, `dashboard_notifications`, `ai_line_assistant`, `line_oa`, `reports`, `workflow_automation`; `cap.wht50bis` มีสาม route (`SYSTEM_INITIAL_ISSUE`, `SYSTEM_CONTENT_CORRECTION`, `SYSTEM_REPLACEMENT_COPY`) seed `OPEN`; แถว `SPECIALIST_LEGAL` seed `CLOSED`: `cap.thai_tax.external_filing_correction` (routeKey เป็น namespace `<formType:correctionRoute:channelVersion>` ยัง materialize ไม่ได้), `cap.thai_tax.vat_scope_credit_transfer` (namespace `<transitionKind>`), และ `cap.thai_tax.vat_credit_in_product_offset` (routeKey `DEFAULT`, `openPolicy: FORBIDDEN_V5_1` — ห้ามเปิดใน v5.1)

### FR-CORE-081 คำสั่งเปิด/ปิด launch gate และมุมมองสุขภาพการเปิดตัว

- **คำอธิบาย** ผู้ดูแลระบบสั่ง `OPEN`/`CLOSE` route หนึ่ง ๆ ของฟีเจอร์ทั้งแพลตฟอร์ม (kill switch) และดูสถานะรวมแบบไม่ระบุ tenant
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; สั่ง: `system.launch_gate.manage` (CRITICAL); อ่าน: `system.launch_gate.read`
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**
  - `POST /v1/system/launch-gates/commands` — `gateKey`, `routeKey`, `action` (`OPEN`/`CLOSE`), `commandId?`, `reason?`, `snapshot{targetEnvironment?, buildReleaseId?, expectedGeneration, validationEvidenceRef?, validationEvidenceHash?, specialistApprovedByUserId?, releaseApprovedByUserId?, emergencyClose?, emergencyAuthorityUserId?, incidentRef?}` → ทั้งหมดทำใน transaction หลังได้ exclusive lock ของ route: ค้นผลคำสั่งเดิมตาม `(gateKey, routeKey, commandId)` → ตรวจ `expectedGeneration` (CAS) → เขียน `FeatureLaunchGateTransition` + ปรับ `FeatureLaunchGate` + audit → เก็บ `FeatureLaunchCommandResult` (รวมกรณี no-op)
  - `GET /v1/system/launch-gates/health` → แถวชนิด A (หนึ่งแถวต่อ gate/route ที่ materialize ได้: สถานะ + generation) และชนิด B (ผลรวมไม่ระบุ tenant ต่อ featureKey: จำนวน ON/DRAINING/OFF) พร้อมตัวเลข shadow (`observed`, `wouldBlock`) ในหน้าต่างสังเกตคงที่; ตัวชี้วัดที่ยังไม่มีแหล่งข้อมูลคืนเป็น `null` ไม่ประมาณค่า; ไม่ส่ง companyId / ชื่อบริษัท / เนื้อหาลูกค้า
- **กฎ/ข้อยกเว้น** generation เพิ่มเฉพาะเมื่อสถานะเปลี่ยนจริง: `CLOSED→OPEN` (+1), `OPEN→CLOSE` (+1), `OPEN→OPEN` บน deployment เดิม = no-op, `OPEN→OPEN` บน build/environment อื่น = "per-build acceptance" ที่ generation เดิม, `CLOSED→CLOSE` = no-op; แถว `FORBIDDEN_V5_1` ปฏิเสธ `OPEN` ก่อนพิจารณาหลักฐานใด; แถวที่ `matrixRowStatus = BLOCKED` ห้าม `OPEN`; แถว specialist ต้องมีผู้อนุมัติ; `commandId` ที่ขึ้นต้น `runoff-complete:` เป็นของระบบ (`reserved_command_id_prefix`); `commandId` เดิม + payload/action ต่าง = ปฏิเสธ; คำสั่งนี้ไม่ "retire" build — การจำกัดหน้าต่าง build ทำโดย `retireLaunchBuilds` หลัง deploy ตามรายชื่อ build ที่ให้บริการจริง (หน้าต่าง `LAUNCH_ATTESTATION_WINDOW = 2`)
- **ข้อผิดพลาด** 409 (generation ไม่ตรง / commandId ถูกใช้กับ payload อื่น), 422/400 (รูปแบบ), 403
- **ข้อมูล** `FeatureLaunchGate` (`FeatureLaunchGateState`, `FeatureLaunchRouteClass`), `FeatureLaunchGateTransition` (`FeatureLaunchGateAction`), `FeatureLaunchCommandResult` (`FeatureLaunchCommandResultKind`), `FeatureLaunchObservationBucket`, `AuditLog`
- **API** `POST /v1/system/launch-gates/commands`, `GET /v1/system/launch-gates/health`
- **หน้าจอ** ไม่พบหน้าเฉพาะใน `apps/web/app/system` สำหรับ launch gate (ใช้ผ่าน API/runbook); `/system/platform-access` เป็นสวิตช์อีกตัวที่ใช้ permission เดียวกัน (FR-CORE-022)
- **การทดสอบ** `application/use-cases/launch-gate-command.use-case.spec.ts`, `launch-gate-command.use-case.race.spec.ts`, `get-launch-health.use-case.spec.ts`, `presentation/http/launch-gate.controller.spec.ts`, `domain/logic/launch-gate-snapshot.logic.spec.ts`, `application/assert-specialist-routes-closed.spec.ts`

### FR-CORE-082 การบังคับใช้ launch gate ขณะรัน (guard)

- **คำอธิบาย** use case ที่สร้าง "งานใหม่" ของฟีเจอร์เรียก `LaunchGateGuardService` เพื่อตรวจว่า route เปิดอยู่ **บน deployment นี้**
- **ผู้ใช้/สิทธิ์** ภายใน (ผู้ใช้ทุกบทบาทได้รับผล)
- **แพ็ก** [ALL] (มีผลกับฟีเจอร์ที่ขาย: `expenses`, `cap.wht50bis`, LINE AI; และกับ `sales_documents`, CRM ที่ไม่ได้ขาย)
- **ขั้นตอนหลัก** `assertLaunchRouteOpen(gateKey, routeKey='DEFAULT')` — อ่าน `FeatureLaunchGate` แบบไม่ cache; ไม่มีแถวหรือไม่ `OPEN` → ปฏิเสธ; ตรวจว่ามี attestation ที่ยัง "มีชีวิต" ของ generation ปัจจุบันซึ่งระบุ environment และ build ที่กำลังรัน (`isOpenOnDeployment`, `liveAttestationKeys` — marker ล่าสุดของแต่ละ build ชนะ; marker `CLOSE` ที่ generation เดิม = การ retire build); `assertLaunchRouteOpenInTransaction(db, …)` ถือ shared lock ของ route แล้วตรวจ เพื่อให้เป็นเส้นตรงกับคำสั่ง `CLOSE` (ซึ่งถือ exclusive lock)
- **กฎ/ข้อยกเว้น** ผู้เรียกใช้ที่พบในโค้ด: ค่าใช้จ่าย (`expenses/application/expense-launch-gate.ts` — กันเฉพาะการสร้างร่างด้วยมือและการอัปโหลดใบเสร็จ; การทำรายการเดิมต่อ เช่น mark-ready/confirm/payment ไม่ถูกกัน — นโยบาย `BLOCK_NEW_ROOT`), เอกสารขาย, CRM quotation / สร้างจากบทสนทนา, ใบทวิ 50 (ออก/แก้ไข/ใบแทน/ออกจาก handoff), LINE webhook (`process-line-webhook.use-case.ts`); route ที่คนเปิดเอง (HUMAN) ไม่ถูกพาข้าม build อัตโนมัติ ต้องเปิดซ้ำบน build ใหม่; route ที่ระบบ seed ถูก attest ต่อ build ใหม่โดย bootstrap (`seedLaunchGates`, `attestOpenOnThisBuild`); ความล้มเหลวของการอ่าน gate ไม่ถูกแปลงเป็น "เปิด" (เสื่อมไปทางปิด)
- **ข้อผิดพลาด** 403 `{code:'feature_temporarily_unavailable', featureKey}`; ข้อความภาษาไทยของค่าใช้จ่าย: "ระบบบันทึกค่าใช้จ่ายปิดปรับปรุงชั่วคราว รายการเดิมยังเปิดดูได้ตามป…" (ข้อความเต็มใน `expense-launch-gate.ts`); การปฏิเสธเขียน audit ผล `DENIED`
- **ข้อมูล** `FeatureLaunchGate`, `FeatureLaunchGateTransition`
- **API** ทางอ้อม (endpoint สร้างงานของโมดูลผู้เรียก)
- **หน้าจอ** web แยกข้อความ "ปิดปรับปรุงชั่วคราว" ออกจาก "ไม่ได้ซื้อ"
- **การทดสอบ** `application/launch-gate.guard.spec.ts`, `application/seed-launch-gates.spec.ts`, `application/retire-launch-builds.spec.ts`

### FR-CORE-083 การสังเกตแบบ shadow และ ExecutionAttempt (ยังไม่เปิดบังคับ)

- **คำอธิบาย** สำหรับงาน asynchronous (sweep, drain, dispatch) ระบบคำนวณว่า guard "จะ" ตัดสินอย่างไรแล้วบันทึกเป็นสถิติรายชั่วโมง โดยไม่บล็อกงาน; `ExecutionAttemptService` เป็น seam สำหรับการบังคับใช้ในอนาคต
- **ผู้ใช้/สิทธิ์** ภายใน
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `LaunchShadowProbe` / `LaunchShadowSweep` → เหตุผล `available`, `feature_disabled`, `launch_gate_closed`, `unmapped_feature`, `no_company` → `flush()` พับลง `FeatureLaunchObservationBucket` รายชั่วโมง (ไม่มี companyId/PII); log event `launch.shadow.would_block`, `.persist_failed`, `.read_failed`; `ExecutionAttemptService`: ประทับ availability vector (generation ของ gate + epoch ของ entitlement), claim แบบ per-attempt `QUEUED→CLAIMED`, token/lease `DISPATCHING` (lease เริ่มต้น 60 วินาที)
- **กฎ/ข้อยกเว้น** คอมเมนต์ในโค้ดระบุชัดว่า "F1 SCOPE: nothing on a hot path calls `claimAttempt` yet. Enforcement is NOT flipped" — คือ shadow เป็นการวัดเท่านั้น ณ commit นี้; ไม่มี batch claim API
- **ข้อมูล** `FeatureLaunchObservationBucket`, `ExecutionAttempt` (`ExecutionAttemptStatus`)
- **API** ไม่มี (ตัวเลขปรากฏใน `GET /v1/system/launch-gates/health`)
- **การทดสอบ** `application/launch-shadow.probe.spec.ts`, `launch-shadow.probe.concurrency.spec.ts`, `execution-attempt.service.spec.ts`, `execution-attempt.service.race.spec.ts`, `domain/shadow-surface.catalog.spec.ts`

### FR-CORE-084 วงจร runoff เมื่อปิดฟีเจอร์ของบริษัท

- **คำอธิบาย** เมื่อผู้ดูแลระบบปิดฟีเจอร์ของร้าน งานที่ค้างอยู่ ณ ขณะปิดถูกจับเป็น snapshot ให้ทำต่อจนหมด (`DRAINING`) แล้วระบบจึงบันทึก `OFF`
- **ผู้ใช้/สิทธิ์** worker (`x-worker-token`)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `POST /v1/internal/feature-launch/runoff/sweep` `{limit?, cursorId?}` → เติม `OFF` ให้ lifecycle ที่ snapshot ว่างแล้ว (ไม่ขยายสมาชิก snapshot และไม่บังคับ OFF ขณะยังมีรายการเปิด); `POST …/runoff/draining` → รายการ lifecycle ที่กำลัง drain พร้อม `openItems`, `ageHours` (มี id ระดับ tenant เพราะเป็นพื้นผิวภายในของผู้ปฏิบัติการ)
- **กฎ/ข้อยกเว้น** `limit` ถูกจำกัดสูงสุด 200 (`MAX_DRAINING_PAGE`); cursor ที่ผิดรูปแบบ → 422 `invalid_runoff_cursor`; snapshot หนึ่งรับ root สูงสุด 500; การตรวจมีงบเวลา (500 ms ต่อ query, 4 query); การจัดการงานที่เหลือของแต่ละฟีเจอร์ตาม `runoff-matrix.catalog.ts`
- **ข้อมูล** `RunoffSnapshot`, `EntitlementTransition` (`EntitlementTransitionAction`), `CompanyEntitlementSet`, `EntitlementCommand`
- **API** ตามข้างต้น
- **การทดสอบ** `application/runoff-lifecycle.spec.ts`, `runoff-lifecycle.race.spec.ts`, `domain/runoff-matrix.catalog.spec.ts`

---

## 13. Health, ธีมหน้าแรก, กระทบยอดตัวตนภาษี

### FR-CORE-085 Health check

- **คำอธิบาย** liveness สาธารณะที่ไม่แตะฐานข้อมูล และ readiness เชิงลึกสำหรับ worker
- **ผู้ใช้/สิทธิ์** `GET /v1/health`: ทุกคน; `GET /v1/internal/health/readiness`: `x-worker-token`
- **แพ็ก** ไม่เกี่ยวกับแพ็ก
- **ขั้นตอนหลัก** `/v1/health` → `buildHealthStatus('api')` (ไม่ query DB, ได้รับยกเว้น rate limit, ผ่านแม้ platform CLOSED); readiness → `SELECT 1` แล้วรายงาน `db: ok|error` (ข้อผิดพลาดของ driver ผ่าน logger ที่ redact)
- **ข้อผิดพลาด** 401 (readiness ไม่มี token)
- **API** `GET /v1/health`, `GET /v1/internal/health/readiness`
- **การทดสอบ** `health/health.spec.ts`
- **หมายเหตุ** `GET /v1/test/protected` (`ProtectedTestController`) ต้องใช้ permission `health.read` ซึ่งไม่มีในทะเบียน permission — เป็น route ทดสอบของ guard ที่ไม่มีบทบาทใดเข้าได้

### FR-CORE-086 ธีมอีเวนต์ของหน้าแรกสาธารณะ

- **คำอธิบาย** ผู้ดูแลระบบเลือกธีมของหน้าแรก (`default` = ปกติ, `halloween` = ฮาโลวีน) ที่ติดตั้งมากับ release
- **ผู้ใช้/สิทธิ์** อ่านสาธารณะ: ทุกคน; จัดการ: `SYSTEM_ADMIN` + `system.home_theme.manage` (ตรวจทั้งบทบาทและ permission ใน service)
- **แพ็ก** [PUBLIC] / [PLATFORM]
- **ขั้นตอนหลัก** `GET /v1/public/home-theme` → `{event}`; `GET /v1/system/home-theme` → `{event, version, updatedAt}`; `PUT /v1/system/home-theme` `{event, expectedVersion}` → advisory lock → ตรวจ version → upsert `PublicHomeThemeSetting{id:'homepage'}` (version +1) + audit `system.home_theme.update` (HIGH; from/to event และ version)
- **กฎ/ข้อยกเว้น** ค่าที่ไม่รู้จัก resolve เป็น `default`; ตั้งค่าเดิมซ้ำ = คืนค่าเดิมไม่เพิ่ม version; การเพิ่ม/ลบธีมเป็นงาน release โค้ด (`HOME_EVENTS`)
- **ข้อผิดพลาด** 403; 400 `Invalid installed theme or version.`; 409 `home_theme_conflict`
- **ข้อมูล** `PublicHomeThemeSetting`, `AuditLog`
- **API** ตามข้างต้น
- **หน้าจอ** `/system/home-theme` (`features/system-home-theme`), `/` (หน้าแรก), `/halloween/[[...card]]`
- **การทดสอบ** ไม่มี spec ใน `apps/api/src/modules/public-home-theme`; ฝั่งเว็บ `features/public-home/home-events.spec.ts`, `PublicHome.rendered.spec.ts`, `e2e/journeys/public-home.journey.spec.ts`

### FR-CORE-087 การกระทบยอดตัวตนภาษีของบริษัทโดยผู้ดูแลระบบ

- **คำอธิบาย** เครื่องมือปฏิบัติการสำหรับหาความคลาดเคลื่อนระหว่าง `Company` กับ `CompanyTaxProfile` (เลขผู้เสียภาษี), รหัสสาขาภาษีซ้ำ และ "คำใบ้ VAT" รุ่นเก่า แล้วให้คนตัดสินแก้ทีละรายการ
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN`; `system.identity_reconciliation.resolve` (CRITICAL; ทุก endpoint)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก**

  | Endpoint (`/v1/system/identity-reconciliation/…`) | หน้าที่ |
  |---|---|
  | `POST companies/:partnerCompanyId/generate` | สร้างรายการที่ค้าง (รันซ้ำได้; ไม่แก้ข้อมูลโดเมน; ความคลาดเคลื่อนที่หายไปเองถูกปิดรายการ) |
  | `GET items` | รายการแบบ cursor (รายการ `TAX_ID` แนบ identity version สำหรับใช้เป็น CAS token) |
  | `POST items/:itemId/resolve-tax-id` | เลือกเลขที่ถูกต้อง (เป็น correction หรือ legal change ที่ต้องมี `effectiveFrom`) |
  | `POST items/:itemId/resolve-branch-duplicate` | แก้รหัสสาขาภาษีซ้ำ |
  | `POST items/:itemId/resolve-vat-hint` | แปลงคำใบ้เป็นข้อเท็จจริง VAT (ไม่บันทึก `NOT_REGISTERED` แทนคำตอบที่ไม่มี) |
  | `POST companies/:partnerCompanyId/repair-tax-id` | แก้เลขผู้เสียภาษีที่บันทึกผิดหลังปิดช่วงเก็บข้อมูล |
  | `GET reports/:reportKey` | รายงานที่ 2 (ค้าง/แก้แล้วต่อบริษัทและชนิด, ข้อมูลปิดบัง) และ 5 (revision ชนิด `INITIAL_CAPTURE`/`CORRECTION` ทั้งหมด); รายงานอื่นตอบ 422 |

- **กฎ/ข้อยกเว้น** ทุกคำสั่งมีรูปเดียวกัน: lock บริษัท → ค้นคำสั่งเดิมก่อน CAS → ตรวจว่าต้นทางไม่เปลี่ยน → แก้ → ปิดรายการ → audit ใน transaction เดียว; ตัวสร้างรายการทำงานทีละบริษัท (serialize) และไม่เปิดรายการที่ `RESOLVED` ซ้ำ; ชนิดรายการ `TAX_ID`, `BRANCH_DUP`, `VAT_HINT`; สถานะต้นทาง `ALIGNED`, `PENDING_ONE_SIDED`, `PENDING_CONFLICT`
- **ข้อผิดพลาด** 404 `Company <id> not found`; 409 (version/ต้นทางเปลี่ยน); 422 (`effectiveFrom (YYYY-MM-DD) is required for a legal ch…`, รายงานที่ยังไม่รองรับ)
- **ข้อมูล** `CompanyIdentityReconciliationItem` (`ReconciliationKind`, `ReconciliationSourceState`, `ReconciliationStatus`), `Company`, `CompanyTaxProfile`, `CompanyLegalIdentityRevision`, `CompanyVatRegistrationFact`, `Branch`, `AuditLog`
- **API** ตามตาราง
- **หน้าจอ** ไม่พบหน้าเฉพาะใน `apps/web/app/system` (ใช้ผ่าน API ตามช่วงปฏิบัติการ)
- **การทดสอบ** `application/use-cases/identity-reconciliation.use-cases.spec.ts`, `data-model-core/domain/logic/identity-reconciliation.logic.spec.ts`

---

## 14. โค้ดร่วม `apps/api/src/common`

### FR-CORE-088 Rate limiting

- **คำอธิบาย** จำกัดอัตราคำขอสองชั้น: ถังรวมต่อ IP ของทั้ง API และถังเฉพาะจุดของ auth/signup
- **ผู้ใช้/สิทธิ์** ทุกคำขอ
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `ApiRateLimitGuard` (`common/security/api-rate-limit.guard.ts`): เปิดเมื่อ `RATE_LIMIT_ENABLED` (ค่าเริ่มต้น false; `validateProductionConfig` บังคับให้เป็น true ใน production — `packages/config/src/index.ts:890`), ถัง `api-ip`, ค่าเริ่มต้น 120 คำขอ/60 วินาที, ตั้ง header `Retry-After`; `RedisRateLimitService` (`redis-rate-limit.service.ts`): `consume` (Lua แบบ atomic), `inspect`, consume-once ต่อ operation id, และ admission lease แบบ crash-safe (`acquire`/`release` ด้วย token)
- **กฎ/ข้อยกเว้น** นโยบายเมื่อ Redis ล่ม: ค่าเริ่มต้น `fail-closed` (ถังที่คุ้มครองค่าใช้จ่ายหรือ credential — auth, AI); เฉพาะถัง `api-ip` ใช้ `degrade-to-local` (ตัวนับในโปรเซส) และส่ง security event `api.rate_limit.store_degraded` ตอนเปลี่ยนสถานะ (เสื่อม/ฟื้น); ข้อผิดพลาดอื่นของ limiter → 503 `API abuse controls are unavailable.`
- **ข้อผิดพลาด** 429 `Too many requests. Please wait before trying again.` (+ `retryAfterSeconds` สำหรับถัง auth), 503
- **ข้อมูล** Redis (ไม่ใช่ Prisma)
- **การทดสอบ** `common/security/api-rate-limit.guard.spec.ts`, `redis-rate-limit.service.spec.ts`, `auth/application/auth-rate-limit.service.spec.ts`

### FR-CORE-089 Endpoint ภายในของ worker (worker token)

- **คำอธิบาย** ทุก controller ใต้ `/v1/internal/*` เป็น `@Public()` และเรียก `assertWorkerToken(header 'x-worker-token')`
- **ผู้ใช้/สิทธิ์** `apps/workers`
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** เทียบกับ `WORKER_INTERNAL_TOKEN` แบบ constant-time (`timingSafeStringEqual`); ไม่ตั้งค่า/ไม่ส่ง/ไม่ตรง → 401 `Invalid worker token`; `AuthGuard` ปล่อย `/v1/internal/*` ผ่านแม้ platform CLOSED
- **API ในพื้นที่ CORE** `internal/health/readiness`, `internal/notifications/*`, `internal/companies/:companyId/…` (แดชบอร์ด/แจ้งเตือน), `internal/signup-claim-email/*`, `internal/storage-cleanup/object-versions/*`, `internal/feature-launch/runoff/*`
- **การทดสอบ** `common/security/worker-token.spec.ts`, `secret-compare.spec.ts`

### FR-CORE-090 Idempotency และ fingerprint ของคำสั่ง

- **คำอธิบาย** แบบแผนร่วมของคำสั่งที่เปลี่ยนสถานะสำคัญ: client ส่ง `commandId` / `requestKey` / `operationId`; server คำนวณ fingerprint ของ payload เอง; retry ได้คำตอบเดิม; key เดิม + payload ต่าง = 409
- **ผู้ใช้/สิทธิ์** ภายใน
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `canonicalFingerprint(payload)` (`common/security/canonical-fingerprint.ts`): เรียง key แบบ byte-wise ทุกระดับ, เขียน `null` ออกมา (ไม่ทิ้ง), ปฏิเสธ NaN/Infinity, ห้ามมีค่าที่เปลี่ยนต่อคำขอ (requestId, timestamp, actor); ลำดับ "ค้นทะเบียนคำสั่งก่อน compare-and-set" ใช้ใน VAT registration, identity reconciliation, launch gate, data rights, email retention; `RequestIdMiddleware` จำกัด `x-request-id` ขาเข้าไว้ที่ 256 ไบต์แบบ deterministic
- **การทดสอบ** `common/security/canonical-fingerprint.spec.ts`

### FR-CORE-091 Validation, การจัดการข้อผิดพลาด, logging และ security event

- **คำอธิบาย** ชั้นขอบของ HTTP ที่ใช้ร่วมทั้ง API
- **ผู้ใช้/สิทธิ์** ทุกคำขอ
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** `TrimStringsPipe` ตัดช่องว่างของสตริง; `ValidationPipe` ด้วย `GLOBAL_VALIDATION_PIPE_OPTIONS` (`whitelist`, `forbidNonWhitelisted`, `transform`) — ฟิลด์ที่ไม่ประกาศใน DTO ถูกปฏิเสธ; `AllExceptionsFilter` เพิ่ม requestId/method/path ให้ stack ของ 5xx; logger เป็น pino JSON พร้อม redaction (`logger.service.ts`, `NestPinoLoggerBridge`); `RequestLoggerMiddleware` บันทึกคำขอ; `emitSecurityEvent(logger, name, risk, fields)` ส่งบรรทัดที่มี `msg` = ชื่อเหตุการณ์ และ `riskLevel` ระดับราก (`HIGH`/`CRITICAL`) เพื่อให้ metric filter จับได้ — ชื่อใน `SECURITY_EVENT`: `auth.login.denied`, `auth.rate_limit.exceeded`, `auth.password_reset.denied`, `auth.session.refresh_reuse_detected`, `api.rate_limit.store_degraded`, `line.webhook.signature_invalid`, `workflow.webhook.blocked`, `attachment.upload.rejected`, `ai.tool.invoke.denied` และอื่น ๆ ในไฟล์
- **กฎ/ข้อยกเว้น** Swagger (`/docs`) เปิดเฉพาะเมื่อ `swaggerEnabled` ในทุกสภาพแวดล้อม; ปิด `x-powered-by` และ `etag`
- **การทดสอบ** `common/pipes/trim-strings.pipe.spec.ts`, `body-validation-coverage.spec.ts`, `common/filters/all-exceptions.filter.spec.ts`, `common/logger/log-redaction.spec.ts`, `logger.spec.ts`, `security-event.spec.ts`, `security-event-emitters.spec.ts`, `common/middleware/request-logger.middleware.spec.ts`

### FR-CORE-092 การระบุ IP ของผู้ใช้จริงหลัง proxy

- **คำอธิบาย** `trustedClientIp(request)` ใช้เป็น key ของ rate limit
- **ขั้นตอนหลัก** เชื่อ `X-Forwarded-For` เฉพาะเมื่อคู่ TCP เป็นที่อยู่ภายใน (loopback / RFC1918 / IPv6 ULA-link-local); เดินจากขวาไปซ้ายข้าม hop ที่เป็นของชั้น proxy ภายในหรือช่วง IP ของ Cloudflare (รายการฝังในโค้ด) — hop แรกที่ไม่ใช่ทั้งสองคือ IP ที่ proxy สังเกตเห็นจริง; ค่าที่ไม่ใช่ IP กลายเป็น `unknown`
- **แพ็ก** [ALL]
- **การทดสอบ** `common/security/trusted-client-ip.spec.ts`

ส่วนประกอบร่วมอื่น: `common/config/app-config.service.ts` (ตัวอ่าน config ที่ validate ด้วย schema ใน `packages/config/src/index.ts`), `common/config/line-messaging-credentials.service.ts`, `common/database/prisma.service.ts`, `serializable-transaction.ts`, `line-identity-lock.ts`, `prisma-error.ts`, `common/export/csv.logic.ts`, `xlsx.logic.ts`, `thai-date.logic.ts`, `common/http/public-api-base.ts`, `web-link.ts`, `common/observability/customer-journey-*.ts`, `common/documents/cancelled-document.ts`, `common/security/active-company.ts`

---

## 15. Web shell

ไฟล์: `apps/web/proxy.ts`, `apps/web/app/**`, `apps/web/src/common/auth/*`, `apps/web/src/common/api/*`, `apps/web/src/common/security/security-headers.logic.ts`, `apps/web/src/common/client-support/*`, `apps/web/src/features/web-core-workspace/*`, `apps/web/src/features/auth/*`, `apps/web/src/features/public-home/*`

### FR-CORE-093 Proxy ของเว็บ: security header, CSRF, เส้นทางที่ต้องล็อกอิน, เบราว์เซอร์ที่ไม่รองรับ

- **คำอธิบาย** `proxy()` (middleware ของ Next.js) ทำงานกับทุกคำขอยกเว้น static asset
- **ผู้ใช้/สิทธิ์** ทุกผู้เยี่ยมชม
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**
  1. สร้าง nonce ต่อคำขอและ CSP (`buildContentSecurityPolicy`) ที่อนุญาต origin ของ API, AI gateway และ storage; ตั้ง `BASE_SECURITY_HEADERS` ทุก response
  2. เผยแพร่ path+query จริงผ่าน header `x-request-path` (ตั้งจาก `nextUrl` ค่าจาก client ชนะไม่ได้)
  3. `/api/*` ที่เป็นการเขียน (ไม่ใช่ GET/HEAD/OPTIONS): ต้อง same-origin (`Origin` host ตรง หรือ `Sec-Fetch-Site` เป็น `same-origin`/`none`) → มิฉะนั้น 403; `/api/v1/*` ที่มี cookie session ต้องมี header `x-csrf-token` ตรงกับ cookie `watchdog_csrf` (เทียบแบบ constant-time) → มิฉะนั้น 403 `csrf_token_invalid`
  4. เบราว์เซอร์ที่ระบุได้ว่าเก่าเกินรองรับ → redirect `/unsupported-browser?next=…` (ยกเว้น path ที่ได้รับยกเว้น เช่น `/l/<token>`)
  5. เส้นทางที่ต้องมี cookie (`isProtectedPagePath`): `/companies/*`, `/system`, `/system/*`, `/legal-acceptance`, `/account/email`, `/billing/companies` → ไม่มี cookie redirect `/login?next=…`
  6. `/reset-password` ได้ `Referrer-Policy: no-referrer` และ `Cache-Control: private, no-store`
- **กฎ/ข้อยกเว้น** cookie ไม่ใช่หลักฐานการล็อกอิน — proxy เป็นเพียงด่านตรวจการมีอยู่; การยืนยันจริงทำที่ layout ฝั่ง server ด้วย `GET /v1/auth/me`; `/login` ไม่ถูกกันที่ proxy
- **การทดสอบ** `src/common/auth/middleware.logic.spec.ts`, `proxy.spec.ts`, `auth-cookies.constants.spec.ts`, `src/common/security/security-headers.logic.spec.ts`, `csp-dynamic-rendering.spec.ts`, `src/common/client-support/client-support.logic.spec.ts`, `e2e/login.spec.ts`

### FR-CORE-094 BFF ของการยืนยันตัวตนและ cookie session

- **คำอธิบาย** route handler ใต้ `/api/auth/*` เรียก API แล้วตั้ง/ล้าง cookie; browser ไม่เคยถือ token ใน JavaScript
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** route: `login`, `logout`, `refresh`, `change-password`, `dev-login`, `line-login/{start,callback,availability}`, `line-qr/{start,status,approve}`, `account-merge`, `account-merge/ticket`, `email-access/{request,confirm,signup,status}`, `signup-claim`; cookie: `watchdog_token` (access, httpOnly; แบ่งชิ้น `<name>.0..5` ชิ้นละ 3,500 ตัวอักษร เพราะ JWT ฝัง permission ทำให้เกิน 4,096 ไบต์), `watchdog_refresh` (httpOnly, path `/api/auth`, อายุ 7 วัน), `watchdog_csrf` (อ่านได้จาก JS สำหรับ double-submit), `watchdog_home` (เส้นทางบ้านหลังล็อกอิน), `watchdog_persist` ("จดจำฉัน")
- **กฎ/ข้อยกเว้น** client `authedApiFetch` (`src/common/api/authed-fetch.ts`): เรียก same-origin `/api/v1/*` (Next rewrite ไป ERP API), แนบ CSRF header, เจอ 401 → refresh ครั้งเดียวแบบ single-flight แล้วลองใหม่ (redirect `/login` เฉพาะเมื่อ refresh ยืนยันว่า session หมดจริง), เจอ 403 `csrf_token_invalid` → refresh แล้วลองใหม่ครั้งเดียว, เจอ `company_term_expired` → นำไปหน้าต่ออายุ, เจอ `legal_acceptance_required` → นำไปหน้ายอมรับ
- **หน้าจอ** `/login`, `/change-password`, `/email-access`, `/claim-account`, `/line-qr/[code]`
- **การทดสอบ** `src/common/auth/refresh-route.spec.ts`, `server-session.spec.ts`, `session.spec.ts`, `change-password-bff.server.spec.ts`; `src/features/auth/line-login-bff.logic.spec.ts`, `line-login-start-route.spec.ts`, `line-login-callback-route.spec.ts`, `line-login-availability-route.spec.ts`, `line-handoff-route.spec.ts`, `account-merge-bff.logic.spec.ts`, `account-merge-ticket-route.spec.ts`, `login-failure-response.server.spec.ts`, `auth.api.spec.ts`, `LoginPage.spec.ts`; `e2e/login.spec.ts`

### FR-CORE-095 Layout ของ workspace, เมนู และการกันเส้นทาง

- **คำอธิบาย** โครงหน้าของร้าน: แถบเมนูซ้าย, header (ตัวสลับบริษัท, กระดิ่ง, เมนูผู้ใช้), ตัวเลือกขอบเขตสาขา และการกันหน้าตาม permission
- **ผู้ใช้/สิทธิ์** สมาชิกของบริษัท
- **แพ็ก** [ALL] — เมนูที่ปรากฏขึ้นกับ permission ที่เหลือหลังตัดตามฟีเจอร์ของแพ็ก
- **ขั้นตอนหลัก** `app/(workspace)/companies/[companyId]/layout.tsx` ตรวจ session จริง: ไม่มี → `/login?next=…`; platform ปิด → `/maintenance`; auth service ล่ม → แสดงสถานะขัดข้อง (ไม่ส่งไป login เพื่อเลี่ยงวนลูป); ไม่มีสิทธิ์ในบริษัท → `CompanyAccessUnavailable` (ระบุชื่อบัญชีที่ล็อกอิน); session ที่มีเฉพาะบทบาททีมขาย → `/sales/deals`; เฉพาะผู้บริหาร → หน้า executive; ต้องเปลี่ยนรหัสผ่าน → `/change-password?next=…`; ต้องยอมรับข้อกำหนด → `/legal-acceptance`; เมนูสร้างจาก `MENU_ENTITLEMENT_BINDINGS` (`packages/contracts/src/menu-entitlements.ts`) กรองด้วย `filterModulesByPermissions` / `filterModulesForSession`; การเข้าหน้าด้วย URL ตรงถูกกันด้วย `canAccessWorkspacePath` + `ROUTE_PERMISSION_RULES` (`route-permissions.ts`) ผ่าน `route-permission-guard.tsx`
- **กฎ/ข้อยกเว้น** เมนูสถานะ `planned` ไม่แสดง; เมนูคู่มือการใช้งานไม่ต้องมี permission (เปิดได้ทุกคนที่เข้า workspace; เล่ม "ภาษี" และ "รายงานการเงิน" ถูกซ่อน); ร้านที่แพ็กหมดอายุ ("locked") เหลือเฉพาะหน้าบัญชี/ข้อมูลร้านและหน้าต่ออายุ; กฎเส้นทางของพื้นที่ CORE: `/settings/profile` ← `company.setup.read|manage`; `/settings/branches` ← `company.branch.read|manage`; `/settings/employees` ← `access.employee.read|create|update`; `/settings/access-overview` ← `access.employee.read`; `/settings/permissions`, `/settings/roles` ← `access.role.manage`; `/settings/notifications`, `/notifications/preferences` ← `notification.preference.manage`; `/settings/notification-rules`, `/notifications/rules` ← `notification.rule.manage`; `/notifications` ← `notification.read`; `/settings/security` ← `account.password.change|identity.link|identity.unlink` (แต่หน้านี้ redirect ไป dashboard — §20)
- **หน้าจอ** `WorkspaceLayout.tsx`, `SettingsMenu.tsx`, `MenuFilterScope.tsx`, `WorkspaceScope.tsx`
- **การทดสอบ** `src/features/web-core-workspace/web-core-workspace.spec.ts`, `menu-filter.spec.ts`, `permission-page-visibility.spec.ts`, `sold-features-regressions.spec.ts`, `workspace-layout.qa.spec.ts`, `workspace-scope.api.spec.ts`, `branch-scope-label.logic.spec.ts`; `e2e/sidebar-nav.spec.ts`, `e2e/settings.spec.ts`, `e2e/feature-entitlement-accessibility.spec.ts`

### FR-CORE-096 ศูนย์ตั้งค่าบริษัท (settings hub)

- **คำอธิบาย** หน้า `/companies/[companyId]/settings` แสดงการ์ดตั้งค่าตามสิทธิ์
- **ผู้ใช้/สิทธิ์** เมนู "ตั้งค่าร้าน" เปิดด้วยอย่างใดอย่างหนึ่งใน gate permission ของ binding `settings` (`company.settings.view`, `company.setup.manage`, และ key ของ ledger/tax setup); แต่ละการ์ดกันด้วย permission ของหน้าปลายทาง
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก** การ์ด (`SETTINGS_MENU_ITEMS`): `company-profile` (ข้อมูลร้าน) และ `my-account` (บัญชีของฉัน) → `/settings/profile`; `branches`; `employees` → `/settings/access-overview`; `substitute-receipt`; `e-wht`; `tax-signature`; `line-oa`; `crm-catalog`; `accounting-tax-setup`; `tax-codes`; `tax-accounts`; `chart-of-accounts`
- **กฎ/ข้อยกเว้น** `filterSettingsMenuItems(permissions, locked, systemCertificatesAvailable)` ซ่อนการ์ดที่ผู้ดูไม่มีสิทธิ์; ร้าน locked เหลือเฉพาะสองการ์ดแรก; การ์ดของฟีเจอร์ที่ไม่ได้ขาย (line-oa, crm-catalog, accounting-tax-setup, tax-codes, tax-accounts, chart-of-accounts) ถูกซ่อนโดยอัตโนมัติเพราะ permission ถูกตัด; การจัดการแพ็กเกจมีเมนูระดับบนแยกต่างหาก
- **หน้าจอ** `/companies/[companyId]/settings`, `/settings/profile`, `/settings/branches`, `/settings/employees`, `/settings/access-overview`, `/settings/permissions`
- **การทดสอบ** `src/features/web-core-workspace/settings-menu.logic.spec.ts`; `e2e/settings.spec.ts`, `e2e/system-settings-ux.spec.ts`, `e2e/journeys/evidence-and-settings.journey.spec.ts`

### FR-CORE-097 หน้าบัญชีและความปลอดภัยของผู้ใช้เอง

- **คำอธิบาย** หน้าที่ผู้ใช้จัดการบัญชีของตนเอง
- **แพ็ก** [ALL]
- **ขั้นตอนหลัก**

  | หน้า | เนื้อหา | API |
  |---|---|---|
  | `/companies/[companyId]/account` | โปรไฟล์ของตนเอง (ใช้ `CompanyProfilePage`) สำหรับผู้ที่ไม่มีสิทธิ์ตั้งค่าร้าน | FR-CORE-021, 006, 014 |
  | `/companies/[companyId]/settings/profile#account` | ส่วน "บัญชีของฉัน": ชื่อ, เบอร์, รหัสผ่านสำรอง, LINE, ผู้ช่วย AI | FR-CORE-021, 006, 014 |
  | `/account/email` | ยืนยัน/เปลี่ยนอีเมลด้วย OTP, เปิดการเข้าด้วยอีเมล (อยู่นอก layout บริษัท เข้าถึงได้เมื่อแพ็กหมดอายุ) | FR-CORE-017, 018 |
  | `/change-password` | เปลี่ยนรหัสผ่าน; ปุ่มย้อนกลับ/หน้าแรกแสดงเฉพาะเมื่อ session ไม่ถูกบล็อก | FR-CORE-005 |
  | `/legal-acceptance` | ยอมรับข้อกำหนด | FR-CORE-020 |
  | `/line-qr/[code]` | อนุมัติ QR login จากมือถือ | FR-CORE-011 |

- **กฎ/ข้อยกเว้น** เมนูผู้ใช้สร้างจาก `buildAccountLinks(companyId, permissions, locked)`; หน้า `/settings/security` ถูกปิด (redirect) ตามการตัดสินใจ 2026-08-05 ที่บันทึกในคอมเมนต์ของโค้ด
- **การทดสอบ** `src/features/auth/AccountEmailOtpPanel.state.spec.ts`, `AccountEmailOtpPanel.qa.spec.ts`, `ChangePasswordPage.spec.ts`, `LineQrApprovePage.spec.ts`, `legal-acceptance.logic.spec.ts`; `e2e/account-email-otp-ux.spec.ts`, `e2e/legal-acceptance.spec.ts`, `e2e/login.spec.ts`

### FR-CORE-098 หน้าสาธารณะ

- **คำอธิบาย** หน้าที่ไม่ต้องล็อกอิน
- **แพ็ก** [PUBLIC]
- **ขั้นตอนหลัก**

  | หน้า | เนื้อหา |
  |---|---|
  | `/` | หน้าแรก (`features/public-home/PublicHome`) พร้อม structured data และธีมอีเวนต์จาก `GET /v1/public/home-theme` |
  | `/halloween/[[...card]]` | หน้ากิจกรรมอีเวนต์ฮาโลวีน (เกม/การ์ดแชร์; BFF `POST /api/public/halloween/draw`) |
  | `/login`, `/forgot-password`, `/reset-password`, `/email-access` | การเข้าสู่ระบบและกู้คืน |
  | `/signup`, `/signup/status/[requestId]`, `/signup/welcome`, `/claim-account` | สมัครเปิดร้าน |
  | `/terms`, `/privacy`, `/data-deletion` | เอกสารทางกฎหมาย (ฉบับตรึงอยู่ที่ `/legal/releases/v3/terms-th.html`, `/legal/releases/v3/privacy-th.html`) |
  | `/verify-email` | หน้าเดิมของลิงก์ยืนยันอีเมล — API ปลายทางตอบ `EMAIL_OTP_REQUIRED` แล้ว (§20) |
  | `/unsupported-browser` | ประกาศเบราว์เซอร์ไม่รองรับ (`no-store`, `noindex`) |
  | `/maintenance` | แสดงเมื่อ platform access ปิด |
  | `/d/expired`, `/d/[token]` | ลิงก์เดโมของทีมขาย (พื้นที่ sales) |
  | `/llms.txt`, `/llms-full.txt` | route handler ข้อความสำหรับ LLM crawler |

- **กฎ/ข้อยกเว้น** หน้าที่ใช้ nonce ของ CSP ต้อง render แบบ dynamic (เช่น `app/login/page.tsx` ตั้ง `dynamic = 'force-dynamic'`; มี spec `src/common/security/csp-dynamic-rendering.spec.ts` คุม)
- **การทดสอบ** `features/public-home/PublicHome.rendered.spec.ts`, `home-events.spec.ts`, `e2e/journeys/public-home.journey.spec.ts`

### FR-CORE-099 โครงหน้าของคอนโซลผู้ดูแลระบบ (`/system`)

- **คำอธิบาย** layout ของ `/system/*` ตรวจ session จริงและบทบาทแพลตฟอร์ม
- **ผู้ใช้/สิทธิ์** `SYSTEM_ADMIN` (และผู้อ่านเฉพาะส่วน เช่น ผู้บริหาร เข้าได้เฉพาะ subtree ที่ตรวจ permission ของตน)
- **แพ็ก** [PLATFORM]
- **ขั้นตอนหลัก** `app/system/layout.tsx`: ไม่มี session → `/login?next=…`; platform ปิดสำหรับผู้ไม่ใช่ admin → `/maintenance`; ไม่มีสิทธิ์ → `SystemAccessDenied`; ต้องเปลี่ยนรหัสผ่าน/ยอมรับข้อกำหนด → redirect; หน้าของพื้นที่ CORE: `/system/company-onboardings/new`, `/system/signup-requests`, `/system/signup-requests/[id]/mail`, `/system/support-requests`, `/system/data-rights*`, `/system/email-delivery`, `/system/home-theme`, `/system/platform-access`; `/system/users` redirect ไป `/system/partners`
- **การทดสอบ** `src/common/auth/session-gate.logic.spec.ts`; `e2e/system-settings-ux.spec.ts`

---

## 16. ข้อกำหนดที่ไม่ใช่เชิงหน้าที่ (NFR)

| ID | ชื่อ | ข้อกำหนดตามโค้ด | หลักฐาน |
|---|---|---|---|
| NFR-101 | ปฏิเสธโดยปริยาย | route ที่ไม่ public และไม่มี permission metadata ถูกปฏิเสธ 403 | `common/security/deny-by-default.guard.ts` |
| NFR-102 | การแยกผู้เช่า | header `X-Company-Id` กับ `:companyId` ต้องตรงกัน; ทุก query ผูก `companyId`; เส้นทาง system ไม่ใช้ชื่อ `companyId` | `auth.guard.ts`, `assert-route-company.ts` |
| NFR-103 | การเก็บรหัสผ่าน | scrypt + salt 16 ไบต์ + hash 64 ไบต์, เทียบ constant-time, จ่ายต้นทุนเท่ากันสำหรับบัญชีที่ไม่มีอยู่; ความยาวขั้นต่ำ 8 ตัวอักษร ไม่มีกฎความซับซ้อนอื่น; ห้ามตั้งรหัสใหม่ซ้ำรหัสปัจจุบัน (กันการคงรหัสวันเกิดไว้) | `domain/logic/password-credential.logic.ts`, `password-login.use-case.ts` |
| NFR-104 | Token ที่เป็น credential เก็บเฉพาะ hash | claim token, handoff token, QR code/secret, LINE link token, reset token เก็บ SHA-256; OTP เก็บ HMAC ที่ผูกบริบท | `secure-token.logic.ts`, `line-handoff.logic.ts`, `line-web-qr.logic.ts`, `email-otp.logic.ts` |
| NFR-105 | JWT | HS256 ตรึงทุกจุด, `iss`/`aud` จากแหล่งเดียว, access 15 นาที, refresh 7 วัน, ต้องมี `sid` และ session ที่ ACTIVE | `jwt-claims.logic.ts`, `issue-token.use-case.ts`, `auth.guard.ts` |
| NFR-106 | การตรวจจับ refresh token ถูกใช้ซ้ำ | หมุนทุกครั้ง, grace 30 วินาที, family id, revoke เมื่อพบการใช้ซ้ำ | `refresh-session.use-case.ts` |
| NFR-107 | กันการเดาบัญชี (enumeration) | คำตอบเดียวกันและเวลาขั้นต่ำสำหรับคำขอรีเซ็ต; claim link ตอบ `{valid:false}` เหมือนกัน; handoff ตอบข้อความเดียว | `notify-password-reset-request.use-case.ts`, `signup-claim.use-case.ts`, `exchange-line-handoff-token.use-case.ts` |
| NFR-108 | Rate limit | ถังรวม 120/60 วินาทีต่อ IP; ถัง auth/signup ตามตารางใน FR; fail-closed เมื่อ Redis ล่ม (ยกเว้นถังรวม) | `api-rate-limit.guard.ts`, `auth-rate-limit.service.ts`, `packages/config/src/index.ts` |
| NFR-109 | Audit | การกระทำสำคัญเขียน `AuditLog`; metadata ถูก redact; audit ใน transaction rollback พร้อมข้อมูล; audit หลัง commit ไม่ทำให้คำขอล้ม | `audit.service.ts` |
| NFR-110 | Security event สำหรับ alarm | ชื่อเหตุการณ์แบบ dotted + `riskLevel` ระดับราก | `common/logger/security-event.ts` |
| NFR-111 | การ redact log | logger pino พร้อม redaction; ข้อผิดพลาดของ driver ผ่าน logger เท่านั้น | `common/logger/logger.service.ts`, `log-redaction.spec.ts` |
| NFR-112 | การตรวจ input | DTO แบบ whitelist; ฟิลด์เกินถูกปฏิเสธ; ขนาด body 1 MB (ค่าเริ่มต้น), `inflate:false`; SNS 256 KB | `main.ts`, `validation-pipe.options.ts` |
| NFR-113 | ความปลอดภัยของไฟล์ | รับเฉพาะ JPEG/PNG/PDF ≤ 25 MB; ตรวจ magic bytes, active content, ไฟล์ฝังใน PDF; สแกนมัลแวร์; ดาวน์โหลดด้วย URL ลงนามอายุจำกัด | `domain/logic/attachment.logic.ts`, `attachment-malware-scanner.ts` |
| NFR-114 | Header และ cache | API ค่าเริ่มต้น `private, no-store`; helmet; ปิด `x-powered-by`/`etag`; เว็บตั้ง CSP แบบ nonce ต่อคำขอ | `main.ts`, `api-cache-control.middleware.ts`, `apps/web/proxy.ts` |
| NFR-115 | CSRF และ same-origin | double-submit cookie + ตรวจ origin สำหรับการเขียนผ่าน BFF | `apps/web/src/common/auth/middleware.logic.ts` |
| NFR-116 | CORS | allow-list ชัดเจน; production ต้องตั้ง `CORS_ALLOWED_ORIGINS` มิฉะนั้นไม่ boot | `main.ts` |
| NFR-117 | Idempotency | คำสั่งสำคัญรับ key จาก client และ fingerprint ฝั่ง server; retry ปลอดภัย | `canonical-fingerprint.ts`, FR-CORE-090 |
| NFR-118 | การทำงานพร้อมกัน | compare-and-set ด้วย version, advisory lock, `SELECT … FOR UPDATE`, ลำดับ lock คงที่ (เช่น membership ก่อน account) | `company-identity.use-case.ts`, `home-theme.service.ts`, `account-merge.use-case.ts`, `password-login.use-case.ts` |
| NFR-119 | ข้อมูลส่วนบุคคล | เลขบัตร/พาสปอร์ตเก็บ last4 + HMAC + ref ที่เข้ารหัส; เลขผู้เสียภาษีปิดบังสำหรับผู้ไม่มีสิทธิ์; audit เก็บเฉพาะ id/boolean; ข้อมูลคำขอความช่วยเหลือลบหลัง 90 วัน; คำขอสมัครที่ค้างลบหลัง 7 วัน | `employee-access.logic.ts`, `company-identity.use-case.ts`, `signup-claim-email.service.ts` |
| NFR-120 | หลักฐานการยอมรับทางกฎหมาย | ผูกกับ SHA-256 ของไฟล์ที่เสิร์ฟจริง, เวอร์ชัน, challenge จาก server, เวลา server | `legal-acceptance.service.ts`, `packages/contracts/src/legal-acceptance.ts` |
| NFR-121 | ความพร้อมใช้งานเทียบความปลอดภัย | ถังรวมเสื่อมเป็นตัวนับในโปรเซสแทนการล่มทั้ง API; health สาธารณะไม่แตะ DB | `api-rate-limit.guard.ts`, `get-health.use-case.ts` |
| NFR-122 | การปิดระบบอย่างเรียบร้อย | `enableShutdownHooks()` เพื่อระบาย buffer ข้อความ LINE ก่อนออก | `main.ts` |
| NFR-123 | ภาษาและเขตเวลา | ข้อความถึงผู้ใช้เป็นภาษาไทย (รหัส error คงที่ + ข้อความไทยที่เว็บแมป); เขตเวลา Asia/Bangkok (UTC+7 คงที่) สำหรับวันทำการและค่าเริ่มต้นการแจ้งเตือน | `business-hours.logic.ts`, `apps/web/src/common/api/api-error-message.ts` |
| NFR-124 | อุปกรณ์เป้าหมายของเว็บ | เบราว์เซอร์ที่ระบุได้ว่าเก่าเกินถูกนำไปหน้าประกาศ; ที่ไม่รู้จักไม่ถูกบล็อก | `client-support.logic.ts` |
| NFR-125 | การสังเกตการณ์ของ launch control | สถิติ would-block เก็บถาวรรายชั่วโมงโดยไม่มีข้อมูล tenant | `launch-shadow.probe.ts` |
| NFR-126 | การแบ่งแยกหน้าที่ | เคส PDPA ต้องใช้สองคน เว้นโหมดผู้ดูแลคนเดียวที่มีเหตุผลและ audit; บังคับซ้ำในฐานข้อมูล | `data-rights.service.ts` |

---

## 17. แค็ตตาล็อก permission key

แหล่งความจริง: `apps/api/src/modules/auth/permission-registry.ts` (`PERMISSIONS`, 391 key รวม 15 key ของ billing ที่มาจาก `BILLING_PERMISSIONS`) ตารางนี้ครอบคลุมทุก key ที่โมดูลในพื้นที่ CORE เป็นเจ้าของหรือบังคับใช้ (62 key) key ของโมดูลอื่น (expense, reimbursement, accounting, tax, ledger, bank, procurement, crm, workflow, ai, report, bi, inventory, sales, billing, executive, partner) อยู่ในเอกสาร SRS ของพื้นที่นั้น; จำนวนต่อกลุ่มดูตาราง 18.2

เส้นทางในคอลัมน์ "จุดบังคับใช้" ย่อ prefix `/v1/companies/:companyId/` (ของร้าน) หรือ `/v1/` (ของ auth/system) คอลัมน์ "feature gate" คือ feature key ที่ถ้าปิดจะทำให้ key ถูกตัดออกจากผู้ใช้ทุกคนของบริษัท (FR-CORE-032); `platform` = ไม่เกี่ยวกับ entitlement ของร้าน

| # | Permission key | คำอธิบายในโค้ด | Risk | จุดบังคับใช้ | Feature gate |
|---|---|---|---|---|---|
| 1 | `account.session.read` | Read own session info | LOW | `GET /auth/me`, `me/companies`, `logout`, `sessions/revoke-others`, `legal-acceptance`, `account/security`, `account/display-name`, `account/email/otp` (อ่าน), `line/qr/approve` | — |
| 2 | `account.password.change` | Change own account password | MEDIUM | `password/change`, `me/password/set`, `me/contact`, `account/ai-assistant`, `account/email/otp/*` (เขียน) | company_settings.security (เปิดเสมอ) |
| 3 | `account.identity.link` | Link external identity | MEDIUM | `line/link`, `line/link/oauth`, `account-merge`, `account-merge/preview` | company_settings.security (เปิดเสมอ) |
| 4 | `account.identity.unlink` | Unlink external identity | MEDIUM | `line/unlink` | company_settings.security (เปิดเสมอ) |
| 5 | `company.setup.read` | Read company setup | LOW | `GET identity` (มุมมองปิดบัง), `settings/address-master` | — |
| 6 | `company.setup.manage` | Manage company setup | LOW | `GET identity`; นอกพื้นที่: นโยบายใบรับรองแทนใบเสร็จ, e-WHT | — |
| 7 | `company.plan.manage` | Manage company package and billing purchases | CRITICAL | `package-change-requests`; นอกพื้นที่: billing | — |
| 8 | `company.settings.view` | Open the company settings hub | LOW | ไม่มี controller ใช้ — เป็น gate ของเมนู "ตั้งค่าร้าน" บนเว็บ | — |
| 9 | `company.legal_identity.read` | Read full company legal tax identity | MEDIUM | ทำให้ `GET identity` คืนค่าตัวเต็ม; `settings/address-master` | — |
| 10 | `company.legal_identity.manage` | Manage company legal tax identity | HIGH | `PATCH identity`, `identity/complete-capture`, `identity/business-type`; `settings/address-master` | — |
| 11 | `company.vat_registration.read` | Read company VAT registration status | LOW | `GET vat-registration` | — |
| 12 | `company.vat_registration.manage` | Answer/correct company VAT registration | HIGH | `PUT vat-registration` | — |
| 13 | `admin.user.read` | Read users (admin) | LOW | ไม่พบ controller ใช้ | — |
| 14 | `admin.user.manage` | Manage users (admin) | HIGH | ไม่พบ controller ใช้ | — |
| 15 | `admin.role.read` | Read roles (admin) | LOW | ไม่พบ controller ใช้ | — |
| 16 | `admin.role.manage` | Manage roles (admin) | HIGH | นอกพื้นที่ (billing, accounting-documents) | — |
| 17 | `audit.log.read` | Read audit logs | MEDIUM | `GET audit/logs` | — |
| 18 | `company.branch.read` | Read company branches | LOW | `GET branches` | company_settings.branches (เปิดเสมอ) |
| 19 | `company.branch.manage` | Manage company branches | MEDIUM | `POST/PATCH branches` | company_settings.branches (เปิดเสมอ) |
| 20 | `attachment.read` | Read attachments | LOW | `GET attachments/:id/download-url` | — |
| 21 | `attachment.create` | Create/upload attachments | LOW | `attachments/upload-intent`, `:id/complete`, `:id/links` | — |
| 22 | `attachment.delete` | Delete attachments | MEDIUM | `DELETE attachments/:id` | — |
| 23 | `document.sequence.read` | Read document sequences | LOW | `GET document-sequences` | — |
| 24 | `document.sequence.manage` | Manage document sequences | HIGH | `PUT document-sequences/:documentType` | — |
| 25 | `outbox.event.read` | Read outbox events (ops) | MEDIUM | ไม่พบ controller ใช้ | — |
| 26 | `dashboard.read` | Read company dashboard | LOW | `GET dashboard`, `dashboard/expense-months`, `dashboard/snapshots/latest` | dashboard_notifications |
| 27 | `dashboard.configure` | Configure dashboard widgets | MEDIUM | ไม่พบ controller ใช้ | dashboard_notifications |
| 28 | `dashboard.snapshot.generate` | Generate dashboard snapshot | LOW | `POST dashboard/snapshots/generate` | dashboard_notifications |
| 29 | `notification.read` | Read own notifications | LOW | `notifications` (รายการ, unread-count, read, read-all, dismiss) | dashboard_notifications |
| 30 | `notification.preference.manage` | Manage own notification preferences | LOW | `GET/PUT notification-preferences` | dashboard_notifications |
| 31 | `notification.rule.manage` | Manage notification rules (admin) | HIGH | `GET notification-rules`, `PUT notification-rules/:ruleId` | dashboard_notifications |
| 32 | `notification.delivery.read` | Read notification delivery logs | MEDIUM | `GET notification-deliveries` | dashboard_notifications |
| 33 | `notification.delivery.retry` | Retry failed notification deliveries | MEDIUM | `POST notification-deliveries/:id/retry` | dashboard_notifications |
| 34 | `access.employee.read` | Read employee access profiles | LOW | `GET settings/employees`, `:employeeId`, `address-master` | employee_access (เปิดเสมอ) |
| 35 | `access.employee.create` | Create employee access | HIGH | `POST settings/employees`, `:id/complete`; `GET settings/roles` | employee_access (เปิดเสมอ) |
| 36 | `access.employee.update` | Update employee access profile/role | MEDIUM | `PATCH settings/employees/:id`; `GET settings/roles`; ดูประวัติชื่อของผู้อื่น | employee_access (เปิดเสมอ) |
| 37 | `access.employee.disable` | Disable/suspend employee access | HIGH | `POST settings/employees/:id/disable`, `DELETE :id/draft` | employee_access (เปิดเสมอ) |
| 38 | `access.employee.credential.issue` | Issue/regenerate employee temporary password | CRITICAL | `POST :id/credentials/regenerate` | employee_access (เปิดเสมอ) |
| 39 | `access.employee.line_link.issue` | Issue employee LINE account-link token | MEDIUM | `POST :id/line-link-token` | employee_access (เปิดเสมอ) |
| 40 | `access.employee.line_link.revoke` | Revoke employee LINE account-link token | MEDIUM | `POST :id/line-link-token/revoke` | employee_access (เปิดเสมอ) |
| 41 | `access.role.read` | Read company roles | LOW | `GET settings/roles`, `roles/:id`, `roles/preview`, `access/matrix` | employee_access (เปิดเสมอ) |
| 42 | `access.role.manage` | Create/update/disable company roles | HIGH | `POST/PATCH settings/roles`, `roles/:id/disable` (+ อ่านทุกแค็ตตาล็อก) | employee_access (เปิดเสมอ) |
| 43 | `access.role.operational.assign` | Assign HR-approved operational roles | HIGH | ไม่ใช่ guard ของ route — ใช้ใน `roleGrantViolation` (HR มอบบทบาทปฏิบัติการ) | employee_access (เปิดเสมอ) |
| 44 | `access.role.financial.assign` | Approve Finance/Accountant role assignment | CRITICAL | ไม่ใช่ guard ของ route — ใช้ใน `roleGrantViolation` / `ownerGatedGrantViolation` | employee_access (เปิดเสมอ) |
| 45 | `access.permission.read` | Read permission catalog | LOW | `GET settings/permissions` | employee_access (เปิดเสมอ) |
| 46 | `access.capability_pack.read` | Read capability pack catalog | LOW | `GET settings/capability-packs` | employee_access (เปิดเสมอ) |
| 47 | `access.role_template.read` | Read job presets (role templates) | LOW | `GET settings/role-templates` | employee_access (เปิดเสมอ) |
| 48 | `access.role_template.manage` | Manage company job presets | HIGH | ไม่พบ controller ใช้ | employee_access (เปิดเสมอ) |
| 49 | `access.effective.read` | Read effective access (who can do what) | MEDIUM | `GET settings/effective-access`, `effective-access/:membershipId` | employee_access (เปิดเสมอ) |
| 50 | `system.company_onboarding.create` | Create customer company onboarding | HIGH | `POST system/company-onboardings`; `system/signup-requests/:id/decision`, `reissue-claim` | platform |
| 51 | `system.company_onboarding.read` | Read customer company onboarding | MEDIUM | `GET system/company-onboardings/:id`; `GET system/signup-requests*` | platform |
| 52 | `system.company_onboarding.regenerate_temporary_password` | Regenerate customer owner temporary password | CRITICAL | `POST system/company-onboardings/:id/regenerate-temporary-password`, `reissue-owner-line-link` | platform |
| 53 | `system.email_delivery.read` | Read safe platform email delivery observations | HIGH | `GET system/email-delivery*` | platform |
| 54 | `system.email_delivery.manage` | Manage local email history retention | HIGH | `PUT system/email-delivery/retention` (ร่วมกับ read) | platform |
| 55 | `system.line_binding.manage` | Manage customer LINE channel bindings | HIGH | ไม่พบ controller ใช้ | platform |
| 56 | `system.home_theme.manage` | Select the public homepage event presentation | HIGH | `GET/PUT system/home-theme` | platform |
| 57 | `system.entitlement_exception.manage` | Resolve a normalization dependency exception (enable prerequisite / disable dependents) | HIGH | `system/entitlement-exceptions`, `…/resolve` | platform |
| 58 | `system.launch_gate.read` | Read the internal launch-health view (tenant-anonymous) | MEDIUM | `GET system/launch-gates/health` | platform |
| 59 | `system.launch_gate.manage` | OPEN/CLOSE an exact launch route (control-plane command) | CRITICAL | `POST system/launch-gates/commands`; `GET/PUT system/platform-access` | platform |
| 60 | `system.identity_reconciliation.resolve` | Generate and resolve company tax identity reconciliation items | CRITICAL | `system/identity-reconciliation/*` | platform |
| 61 | `system.data_rights.manage` | Orchestrate restricted user/company data-rights and offboarding cases | CRITICAL | `system/data-rights/*` | platform |
| 62 | `system.partner_company.update` | Update partner company profile metadata | MEDIUM | `system/support-requests/*` (key ของพื้นที่ partner management ที่โมดูล external-signup ใช้) | platform |

ข้อสังเกตจากโค้ด:

- key ที่มีในทะเบียนแต่ไม่พบ controller ใดอ้างถึง: `admin.user.read`, `admin.user.manage`, `admin.role.read`, `outbox.event.read`, `dashboard.configure`, `access.role_template.manage`, `system.line_binding.manage`, `company.settings.view` (ตัวหลังใช้เป็น gate ของเมนูเว็บ)
- `health.read` ถูกอ้างโดย `ProtectedTestController` แต่ **ไม่อยู่** ในทะเบียน
- `ai.tool.invoke` และ `line.ai.query` อยู่ใน `pack.core.basics` (ไม่ถูก gate) และเป็นของพื้นที่ LINE AI
- ระดับ risk เป็นข้อมูลกำกับ (ใช้คำนวณ risk ของ capability pack และแสดงผล) ไม่ได้เปลี่ยนพฤติกรรมของ guard

---

## 18. ตาราง role → permission

สร้างจาก `ROLE_GRANTS` ใน `apps/api/src/modules/auth/permission-registry.ts` (commit `08850deaf`) โดยขยาย spread ทุกตัว (`STAFF_ROLE_GRANTS`, `REIMBURSEMENT_SELF_SERVICE_PERMISSIONS`, `REPORT_BI_*`, `BILLING_PERMISSIONS`, `EXECUTIVE_PERMISSION_KEYS`, `SALES_PERMISSION_KEYS`) นี่คือ grant ของ **บทบาทระบบ** ตามโค้ด; สิทธิ์ที่ใช้ได้จริงของผู้ใช้ = grant ของบทบาท ∩ ฟีเจอร์ที่บริษัทเปิด (FR-CORE-032) และบทบาทที่บริษัทสร้างหรือ fork เองเก็บใน DB

### 18.1 บทบาทระบบ (`SYSTEM_ROLES`)

| ย่อ | Role key | ชื่อไทย (`THAI_SYSTEM_ROLE_NAMES`) | ขอบเขต | จำนวน key | บริษัทแก้ได้ | หมายเหตุ |
|---|---|---|---|---|---|---|
| OWN | `OWNER` | เจ้าของกิจการ | ร้าน | 339 | ไม่ได้ | = `COMPANY_PERMISSION_KEYS` (ทุก key ที่ไม่ขึ้นต้น `system.`/`sales.`); มอบผ่านหน้าพนักงานไม่ได้ |
| ADM | `ADMIN` | ผู้ดูแลบริษัท | ร้าน | 209 | ได้ (fork เป็น role ของบริษัท) | ไม่มี `access.role.manage` / `admin.role.manage` / `access.role_template.manage` (เจ้าของมอบผ่าน role กำหนดเอง) |
| MGR | `MANAGER` | ผู้จัดการ | ร้าน | 136 | ได้ (fork เป็น role ของบริษัท) | อนุมัติงาน; แก้การมอบหมายพนักงานรายวัน |
| HR | `HR` | ฝ่ายบุคคล | ร้าน | 52 | ได้ (fork เป็น role ของบริษัท) | = `STAFF` + จัดการพนักงาน + `access.role.operational.assign` |
| FIN | `FINANCE` | ฝ่ายการเงิน | ร้าน | 211 | ได้ (fork เป็น role ของบริษัท) | ต้องมี `access.role.financial.assign` จึงมอบได้ |
| ACC | `ACCOUNTANT` | ฝ่ายบัญชี | ร้าน | 150 | ได้ (fork เป็น role ของบริษัท) | ต้องมี `access.role.financial.assign` จึงมอบได้ |
| SAL | `SALES` | ฝ่ายขาย | ร้าน | 92 | ได้ (fork เป็น role ของบริษัท) | พนักงานขายของร้าน (ไม่ใช่ทีมขายมั่งมี) |
| INV | `INVENTORY` | ฝ่ายคลังสินค้า | ร้าน | 61 | ได้ (fork เป็น role ของบริษัท) |  |
| MKT | `MARKETING` | ฝ่ายการตลาด | ร้าน | 52 | ได้ (fork เป็น role ของบริษัท) |  |
| STF | `STAFF` | พนักงาน | ร้าน | 46 | ได้ (fork เป็น role ของบริษัท) | = `STAFF_ROLE_GRANTS` |
| AUD | `AUDITOR_READONLY` | ผู้ตรวจสอบ (ดูอย่างเดียว) | ร้าน | 114 | ได้ (fork เป็น role ของบริษัท) | อ่าน/ส่งออกเท่านั้น |
| CV | `COMPANY_VIEW` | ผู้ดูภาพรวมบริษัท | ร้าน | 41 | ไม่ได้ | ดูภาพรวม; มอบผ่านหน้าพนักงานไม่ได้ |
| SYS | `SYSTEM_ADMIN` | ผู้ดูแลระบบ | แพลตฟอร์ม | 56 | ไม่ได้ | ทุก key `system.*` และ `sales.*` + `account.*` 4 key |
| EX | `MANGMEE_EXECUTIVE` | ผู้บริหารมั่งมี | แพลตฟอร์ม | 4 | ไม่ได้ | platform-only |
| EXX | `MANGMEE_EXECUTIVE_EXPORT` | สิทธิ์ส่งออกรายงานสำหรับผู้บริหาร | แพลตฟอร์ม | 4 | ไม่ได้ | platform-only |
| EXC | `MANGMEE_EXECUTIVE_CONTACT` | สิทธิ์ดูข้อมูลติดต่อสำหรับผู้บริหาร | แพลตฟอร์ม | 4 | ไม่ได้ | platform-only |
| EXN | `MANGMEE_EXECUTIVE_COMPANY_NOTE` | (จาก `COMPANY_TEAM_NOTE_WORDS.roleName`) | แพลตฟอร์ม | 4 | ไม่ได้ | platform-only |
| MSL | `MANGMEE_SALES_LEAD` | หัวหน้าทีมขายมั่งมี | แพลตฟอร์ม | 11 | ไม่ได้ | platform-only |
| MS | `MANGMEE_SALES` | เซลล์มั่งมี | แพลตฟอร์ม | 7 | ไม่ได้ | platform-only |

### 18.2 จำนวน key ต่อกลุ่มของแต่ละบทบาท (ทุก key ในทะเบียน)

กลุ่ม = ส่วนแรกของ key (`journal.*` นับรวมกับ `ledger`, `wht.*` กับ `tax`, `bi.*` กับ `report`) คอลัมน์ "ทั้งหมด" คือจำนวน key ของกลุ่มในทะเบียน

| กลุ่ม | ทั้งหมด | OWN | ADM | MGR | HR | FIN | ACC | SAL | INV | MKT | STF | AUD | CV | SYS | EX | EXX | EXC | EXN | MSL | MS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `system.billing` | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 | 0 | 0 | 0 | 0 | 0 |
| `account` | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 3 | 3 | 3 | 3 |
| `company` | 11 | 11 | 5 | 2 | 1 | 3 | 4 | 1 | 1 | 1 | 1 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `admin` | 4 | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `audit` | 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ai` | 15 | 15 | 15 | 9 | 5 | 9 | 10 | 7 | 7 | 5 | 5 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `attachment` | 3 | 3 | 3 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `document` | 2 | 2 | 2 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `outbox` | 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `dashboard` | 3 | 3 | 3 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `notification` | 5 | 5 | 5 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `line` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `system (อื่น)` | 23 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 23 | 0 | 0 | 0 | 0 | 0 | 0 |
| `system.executive` | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 1 | 1 | 1 | 1 | 0 | 0 |
| `sales` | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 | 8 | 4 |
| `inventory` | 10 | 10 | 10 | 4 | 0 | 4 | 4 | 1 | 8 | 1 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `accounting` | 48 | 48 | 4 | 11 | 1 | 47 | 11 | 10 | 1 | 1 | 1 | 11 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `expense` | 26 | 26 | 24 | 13 | 7 | 26 | 12 | 7 | 7 | 7 | 7 | 5 | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `tax` | 25 | 25 | 0 | 6 | 0 | 21 | 25 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `ledger` | 13 | 13 | 0 | 2 | 0 | 7 | 13 | 0 | 0 | 0 | 0 | 6 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `bank` | 22 | 22 | 7 | 1 | 0 | 19 | 15 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `procurement` | 35 | 35 | 17 | 10 | 5 | 28 | 11 | 5 | 8 | 5 | 5 | 13 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `reimbursement` | 16 | 16 | 14 | 11 | 6 | 13 | 9 | 6 | 6 | 6 | 6 | 8 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `crm` | 47 | 47 | 47 | 37 | 0 | 6 | 5 | 32 | 0 | 3 | 0 | 11 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `access` | 16 | 16 | 12 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `workflow` | 12 | 12 | 12 | 3 | 2 | 3 | 4 | 2 | 2 | 2 | 2 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `report` | 19 | 19 | 19 | 11 | 9 | 14 | 14 | 11 | 11 | 11 | 9 | 9 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **รวม** | 391 | **339** | **209** | **136** | **52** | **211** | **150** | **92** | **61** | **52** | **46** | **114** | **41** | **56** | **4** | **4** | **4** | **4** | **11** | **7** |

### 18.3 เมทริกซ์ key ของพื้นที่ CORE × บทบาท

● = มี grant ในโค้ด, เว้นว่าง = ไม่มี บทบาท `EX`/`EXX`/`EXC`/`EXN` (ผู้บริหารมั่งมี 4 บทบาท) มี key ของ CORE เหมือนกันทุกบทบาทจึงรวมเป็นคอลัมน์ `EX*`

| Permission key | OWN | ADM | MGR | HR | FIN | ACC | SAL | INV | MKT | STF | AUD | CV | SYS | MSL | MS | EX* |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `account.session.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `account.password.change` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `account.identity.link` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `account.identity.unlink` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |
| `company.setup.read` | ● | ● | ● |  | ● | ● |  |  |  |  | ● | ● |  |  |  |  |
| `company.setup.manage` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `company.plan.manage` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `company.settings.view` | ● | ● |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `company.legal_identity.read` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `company.legal_identity.manage` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `company.vat_registration.read` | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |
| `company.vat_registration.manage` | ● |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| `admin.user.read` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.user.manage` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `admin.role.read` | ● | ● |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| `admin.role.manage` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `audit.log.read` | ● | ● |  |  |  | ● |  |  |  |  | ● |  |  |  |  |  |
| `company.branch.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |
| `company.branch.manage` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `attachment.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |
| `attachment.create` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |
| `attachment.delete` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `document.sequence.read` | ● | ● |  |  | ● | ● |  |  |  |  | ● |  |  |  |  |  |
| `document.sequence.manage` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `outbox.event.read` | ● | ● |  |  |  | ● |  |  |  |  | ● |  |  |  |  |  |
| `dashboard.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |
| `dashboard.configure` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `dashboard.snapshot.generate` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `notification.read` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |  |  |  |
| `notification.preference.manage` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ● |  |  |  |  |
| `notification.rule.manage` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `notification.delivery.read` | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `notification.delivery.retry` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.read` | ● | ● | ● | ● |  |  |  |  |  |  | ● |  |  |  |  |  |
| `access.employee.create` | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.update` | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.disable` | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.credential.issue` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.line_link.issue` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.employee.line_link.revoke` | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.role.read` | ● | ● | ● | ● |  |  |  |  |  |  | ● | ● |  |  |  |  |
| `access.role.manage` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.role.operational.assign` | ● |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.role.financial.assign` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.permission.read` | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `access.capability_pack.read` | ● | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `access.role_template.read` | ● | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `access.role_template.manage` | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| `access.effective.read` | ● | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| `system.company_onboarding.create` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.company_onboarding.read` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.company_onboarding.regenerate_temporary_password` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.email_delivery.read` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.email_delivery.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.line_binding.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.home_theme.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.entitlement_exception.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.launch_gate.read` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.launch_gate.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.identity_reconciliation.resolve` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.data_rights.manage` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| `system.partner_company.update` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |

### 18.4 รายการ grant ครบทุก key ของแต่ละบทบาท

รูปแบบ: **กลุ่ม** — ส่วนท้ายของ key คั่นด้วยจุลภาค (เช่น **account** — `session.read` หมายถึง `account.session.read`) เรียงตามลำดับในทะเบียน

- **`OWNER`** (339 key) — ทุก key ในทะเบียนที่ไม่ขึ้นต้น `system.` หรือ `sales.` กลุ่มและจำนวนตามคอลัมน์ `OWN` ของตาราง 18.2; key ที่มีเฉพาะ `OWNER` (ไม่มีบทบาทระบบอื่นถือ): `company.plan.manage`, `company.legal_identity.read`, `company.legal_identity.manage`, `admin.role.manage`, `company.tax_signature.manage`, `procurement.goods_receipt.post`, `procurement.goods_receipt.void`, `procurement.approval_policy.manage`, `access.role.manage`, `access.role.financial.assign`, `access.role_template.manage`
- **`ADMIN`** (209 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `setup.manage`, `settings.view`, `branch.read`, `branch.manage`; **admin** — `user.read`, `user.manage`, `role.read`; **audit** — `log.read`; **ai** — `tool.invoke`, `suggestion.read`, `suggestion.read_own`, `suggestion.request`, `suggestion.generate`, `suggestion.review`, `suggestion.dismiss`, `suggestion.admin`, `draft.read`, `draft.request`, `draft.review`, `draft.create_source_draft`, `template.read`, `template.manage`, `tool_invocation.read`; **attachment** — `read`, `create`, `delete`; **document** — `sequence.read`, `sequence.manage`; **outbox** — `event.read`; **dashboard** — `read`, `configure`, `snapshot.generate`; **notification** — `read`, `preference.manage`, `rule.manage`, `delivery.read`, `delivery.retry`; **line** — `ai.query`; **inventory** — `product.read`, `product.manage`, `location.read`, `location.manage`, `movement.read`, `movement.create`, `movement.adjust`, `stock_count.create`, `report.read`, `label.manage`; **accounting** — `counterparty.read`, `counterparty.manage`, `document.read_related`, `revenue_category.manage`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `review`, `confirm`, `reject`, `void`, `delete`, `payment.record`, `disbursement.read`, `disbursement.prepare`, `disbursement.approve`, `disbursement.pay`, `disbursement.issue`, `duplicate.resolve`, `category.manage`, `signature.self_manage`, `signature.manage`, `export`; **bank** — `account.read`, `account.manage`, `statement.read`, `match.read`, `adjustment.read`, `reconciliation.read`, `cash.read`; **procurement** — `supplier.read`, `supplier.manage`, `supplier.bank.read`, `supplier.bank.manage`, `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_request.read`, `purchase_order.read`, `purchase_order.manage`, `goods_receipt.read`, `vendor_bill.read`, `supplier_payment.read`, `approval_policy.read`, `ap.report`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`, `approve`, `reject`, `payment.record`, `payment.void`, `policy.read`, `policy.manage`, `export`; **crm** — `customer.read`, `customer.create`, `customer.update`, `customer.archive`, `customer.assign`, `customer.merge`, `customer.export`, `customer.erase`, `contact.read`, `contact.manage`, `lead.read`, `lead.create`, `lead.update`, `lead.assign`, `lead.convert`, `lead.disqualify`, `opportunity.read`, `opportunity.create`, `opportunity.update`, `opportunity.stage_move`, `opportunity.close`, `opportunity.reopen`, `activity.read`, `activity.create`, `follow_up.read`, `follow_up.create`, `follow_up.update`, `follow_up.complete`, `pipeline.configure`, `quotation.link`, `report.read`, `ai.read`, `channel.read`, `channel.manage`, `inbox.read`, `inbox.reply`, `ai.assist`, `inbox.note`, `inbox.assign`, `inbox.resolve`, `template.read`, `template.manage`, `inbox.policy_manage`, `booking.read`, `booking.create`, `booking.update`, `booking.cancel`; **access** — `employee.read`, `employee.create`, `employee.update`, `employee.disable`, `employee.credential.issue`, `employee.line_link.issue`, `employee.line_link.revoke`, `role.read`, `permission.read`, `capability_pack.read`, `role_template.read`, `effective.read`; **workflow** — `template.read`, `rule.read`, `rule.manage`, `rule.enable`, `run.read`, `run.replay`, `task.read`, `task.work`, `dead_letter.read`, `dead_letter.replay`, `webhook.manage`, `audit.read`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `view.share`, `view.manage`, `snapshot.read`, `export`, `export.read_own`, `export.manage`, `subscription.manage`, `audit.read`; **bi** — `view.read`, `view.create`, `view.update_own`, `view.share`, `admin`
- **`MANAGER`** (136 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `branch.read`; **ai** — `tool.invoke`, `suggestion.read`, `suggestion.read_own`, `suggestion.request`, `suggestion.review`, `suggestion.dismiss`, `draft.read`, `draft.request`, `draft.review`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`, `location.read`, `movement.read`, `report.read`; **accounting** — `counterparty.read`, `document.read`, `quotation.read`, `quotation.approve`, `invoice.read`, `billing_note.read`, `receipt.read`, `tax_invoice.read`, `credit_note.read`, `debit_note.read`, `payment.read`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `review`, `disbursement.read`, `disbursement.approve`, `duplicate.resolve`, `signature.self_manage`; **tax** — `profile.read`, `config.read`, `period.read`, `report.read`, `certificate.read`, `review_issue.read`; **ledger** — `report.read`, `period.read`; **bank** — `cash.read`; **procurement** — `supplier.read`, `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_request.read`, `purchase_request.approve`, `purchase_order.read`, `purchase_order.approve`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`, `approve`, `reject`, `payment.record`, `payment.void`; **crm** — `customer.read`, `customer.assign`, `contact.read`, `lead.read`, `lead.create`, `lead.update`, `lead.assign`, `lead.convert`, `lead.disqualify`, `opportunity.read`, `opportunity.create`, `opportunity.update`, `opportunity.stage_move`, `opportunity.close`, `opportunity.reopen`, `activity.read`, `activity.create`, `follow_up.read`, `follow_up.create`, `follow_up.update`, `follow_up.complete`, `quotation.link`, `report.read`, `ai.read`, `channel.read`, `inbox.read`, `inbox.reply`, `ai.assist`, `inbox.note`, `inbox.assign`, `inbox.resolve`, `template.read`, `template.manage`, `booking.read`, `booking.create`, `booking.update`, `booking.cancel`; **access** — `employee.read`, `employee.update`, `employee.disable`, `role.read`, `capability_pack.read`, `role_template.read`; **workflow** — `run.read`, `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`
- **`HR`** (52 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **ai** — `tool.invoke`, `suggestion.read_own`, `suggestion.request`, `draft.read`, `draft.request`; **company** — `branch.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **accounting** — `document.read_related`; **expense** — `read_related`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `signature.self_manage`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`; **reimbursement** — `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **access** — `employee.read`, `employee.create`, `employee.update`, `employee.disable`, `role.read`, `role.operational.assign`; **workflow** — `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`
- **`FINANCE`** (211 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `vat_registration.read`, `branch.read`; **ai** — `tool.invoke`, `suggestion.read`, `suggestion.read_own`, `suggestion.request`, `suggestion.review`, `suggestion.dismiss`, `draft.read`, `draft.request`, `draft.review`; **attachment** — `read`, `create`; **document** — `sequence.read`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`, `location.read`, `movement.read`, `report.read`; **accounting** — `counterparty.read`, `counterparty.manage`, `document.read`, `document.create`, `document.update`, `document.issue`, `document.void`, `document.export`, `revenue_category.manage`, `quotation.read`, `quotation.create`, `quotation.update`, `quotation.submit_approval`, `quotation.approve`, `quotation.issue`, `quotation.void`, `invoice.read`, `invoice.create`, `invoice.update`, `invoice.issue`, `invoice.void`, `billing_note.read`, `billing_note.create`, `billing_note.update`, `billing_note.issue`, `billing_note.void`, `receipt.read`, `receipt.create`, `receipt.update`, `receipt.issue`, `receipt.void`, `tax_invoice.read`, `tax_invoice.issue`, `tax_invoice.void`, `tax_document_buyer_evidence.manage`, `credit_note.read`, `credit_note.create`, `credit_note.issue`, `credit_note.void`, `debit_note.read`, `debit_note.create`, `debit_note.issue`, `debit_note.void`, `payment.read`, `payment.create`, `payment.update`, `payment.void`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `review`, `confirm`, `reject`, `void`, `delete`, `payment.record`, `disbursement.read`, `disbursement.prepare`, `disbursement.approve`, `disbursement.pay`, `disbursement.issue`, `duplicate.resolve`, `ocr.request`, `ai.verify`, `category.manage`, `signature.self_manage`, `signature.manage`, `export`; **tax** — `profile.read`, `config.read`, `period.read`, `event.read`, `event.sync`, `report.read`, `report.recompute`, `report.export`, `filing.mark_filed`, `filing.mark_paid`, `certificate.read`, `certificate.issue`, `certificate.void`, `review_issue.read`, `review_issue.resolve`; **wht** — `pnd53.read`, `pnd53.prepare`, `certificate.read`, `external_certificate.link`, `certificate.issue`, `certificate.correct`; **ledger** — `account.read`, `journal.read`, `posting-rule.read`, `report.read`, `period.read`, `export`; **journal** — `entry.create`; **bank** — `account.read`, `account.manage`, `account.sensitive_read`, `statement.read`, `statement.import`, `statement.manual_line`, `statement.void`, `match.read`, `match.suggest`, `match.confirm`, `match.unmatch`, `match.override`, `adjustment.read`, `adjustment.create`, `adjustment.void`, `reconciliation.read`, `reconciliation.create`, `reconciliation.export`, `cash.read`; **procurement** — `supplier.read`, `supplier.manage`, `supplier.bank.read`, `supplier.bank.manage`, `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_request.read`, `purchase_request.create`, `purchase_order.read`, `purchase_order.create`, `purchase_order.issue`, `goods_receipt.read`, `vendor_bill.read`, `vendor_bill.create`, `vendor_bill.direct_entry`, `vendor_bill.approve`, `vendor_bill.void`, `vendor_bill.match`, `vendor_bill.match.override`, `supplier_payment.read`, `supplier_payment.create`, `supplier_payment.release`, `supplier_payment.void`, `approval_policy.read`, `ap.report`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`, `finance_review`, `payment.record`, `payment.void`, `duplicate.resolve`, `policy.read`, `export`; **crm** — `customer.read`, `contact.read`, `opportunity.read`, `activity.read`, `follow_up.read`, `report.read`; **workflow** — `run.read`, `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `view.share`, `snapshot.read`, `export`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`, `view.share`
- **`ACCOUNTANT`** (150 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `vat_registration.read`, `vat_registration.manage`, `branch.read`; **audit** — `log.read`; **ai** — `tool.invoke`, `suggestion.read`, `suggestion.read_own`, `suggestion.request`, `suggestion.review`, `suggestion.dismiss`, `draft.read`, `draft.request`, `draft.review`, `tool_invocation.read`; **attachment** — `read`, `create`; **document** — `sequence.read`; **outbox** — `event.read`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`, `location.read`, `movement.read`, `report.read`; **accounting** — `counterparty.read`, `document.read`, `document.export`, `quotation.read`, `invoice.read`, `billing_note.read`, `receipt.read`, `tax_invoice.read`, `credit_note.read`, `debit_note.read`, `payment.read`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `disbursement.read`, `disbursement.issue`, `signature.self_manage`, `export`; **tax** — `profile.read`, `profile.manage`, `config.read`, `config.manage`, `period.read`, `period.manage`, `event.read`, `event.sync`, `report.read`, `report.recompute`, `report.export`, `filing.mark_filed`, `filing.mark_paid`, `certificate.read`, `certificate.issue`, `certificate.void`, `review_issue.read`, `review_issue.resolve`, `adjustment.create`; **wht** — `pnd53.read`, `pnd53.prepare`, `certificate.read`, `external_certificate.link`, `certificate.issue`, `certificate.correct`; **ledger** — `account.read`, `account.manage`, `journal.read`, `posting-rule.read`, `posting-rule.manage`, `report.read`, `period.read`, `period.close`, `period.unclose`, `export`; **journal** — `entry.create`, `entry.post`, `entry.reverse`; **bank** — `account.read`, `statement.read`, `match.read`, `match.confirm`, `match.unmatch`, `match.override`, `adjustment.read`, `adjustment.approve`, `adjustment.void`, `reconciliation.read`, `reconciliation.create`, `reconciliation.complete`, `reconciliation.reopen`, `reconciliation.export`, `cash.read`; **procurement** — `supplier.read`, `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_order.read`, `goods_receipt.read`, `vendor_bill.read`, `supplier_payment.read`, `ap.report`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`, `finance_review`, `export`; **crm** — `customer.read`, `contact.read`, `opportunity.read`, `activity.read`, `report.read`; **workflow** — `run.read`, `task.read`, `task.work`, `audit.read`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `view.share`, `snapshot.read`, `export`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`, `view.share`
- **`SALES`** (92 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **ai** — `tool.invoke`, `suggestion.read_own`, `suggestion.request`, `suggestion.dismiss`, `draft.read`, `draft.request`, `draft.review`; **company** — `branch.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`; **accounting** — `counterparty.read`, `document.read_related`, `quotation.read`, `quotation.create`, `quotation.update`, `quotation.submit_approval`, `quotation.issue`, `invoice.read`, `billing_note.read`, `payment.read`; **expense** — `read_related`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `signature.self_manage`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`; **reimbursement** — `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **crm** — `customer.read`, `customer.create`, `customer.update`, `contact.read`, `contact.manage`, `lead.read`, `lead.create`, `lead.update`, `lead.convert`, `lead.disqualify`, `opportunity.read`, `opportunity.create`, `opportunity.update`, `opportunity.stage_move`, `opportunity.close`, `activity.read`, `activity.create`, `follow_up.read`, `follow_up.create`, `follow_up.update`, `follow_up.complete`, `quotation.link`, `report.read`, `ai.read`, `inbox.read`, `inbox.reply`, `ai.assist`, `inbox.note`, `inbox.resolve`, `template.read`, `booking.read`, `booking.create`; **workflow** — `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`
- **`INVENTORY`** (61 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **ai** — `tool.invoke`, `suggestion.read_own`, `suggestion.request`, `suggestion.dismiss`, `draft.read`, `draft.request`, `draft.review`; **company** — `branch.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`, `location.read`, `movement.read`, `movement.create`, `movement.adjust`, `stock_count.create`, `report.read`, `label.manage`; **accounting** — `document.read_related`; **expense** — `read_related`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `signature.self_manage`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_order.read`, `goods_receipt.read`, `goods_receipt.create`; **reimbursement** — `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **workflow** — `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`
- **`MARKETING`** (52 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **ai** — `tool.invoke`, `suggestion.read_own`, `suggestion.request`, `draft.read`, `draft.request`; **company** — `branch.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **inventory** — `product.read`; **accounting** — `document.read_related`; **expense** — `read_related`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `signature.self_manage`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`; **reimbursement** — `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **crm** — `customer.read`, `report.read`, `ai.read`; **workflow** — `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`, `view.create`, `view.update_own`
- **`STAFF`** (46 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **ai** — `tool.invoke`, `suggestion.read_own`, `suggestion.request`, `draft.read`, `draft.request`; **company** — `branch.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **line** — `ai.query`; **accounting** — `document.read_related`; **expense** — `read_related`, `read_own`, `create`, `receipt.upload`, `receipt.line_upload`, `update`, `signature.self_manage`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`; **reimbursement** — `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **workflow** — `task.read`, `task.work`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `view.create`, `view.update_own`, `snapshot.read`, `export.read_own`; **bi** — `view.read`
- **`AUDITOR_READONLY`** (114 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `branch.read`; **audit** — `log.read`; **ai** — `tool.invoke`, `suggestion.read`, `suggestion.read_own`, `draft.read`, `template.read`, `tool_invocation.read`; **attachment** — `read`, `create`; **document** — `sequence.read`; **outbox** — `event.read`; **dashboard** — `read`; **notification** — `read`, `delivery.read`; **line** — `ai.query`; **inventory** — `product.read`, `location.read`, `movement.read`, `report.read`; **accounting** — `counterparty.read`, `document.read`, `document.export`, `quotation.read`, `invoice.read`, `billing_note.read`, `receipt.read`, `tax_invoice.read`, `credit_note.read`, `debit_note.read`, `payment.read`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`, `export`; **tax** — `profile.read`, `config.read`, `period.read`, `event.read`, `report.read`, `report.export`, `certificate.read`, `review_issue.read`; **ledger** — `account.read`, `journal.read`, `posting-rule.read`, `report.read`, `period.read`, `export`; **bank** — `account.read`, `statement.read`, `match.read`, `adjustment.read`, `reconciliation.read`, `reconciliation.export`, `cash.read`; **procurement** — `supplier.read`, `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_request.read`, `purchase_order.read`, `goods_receipt.read`, `vendor_bill.read`, `supplier_payment.read`, `approval_policy.read`, `ap.report`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`, `export`; **crm** — `customer.read`, `customer.export`, `contact.read`, `lead.read`, `opportunity.read`, `activity.read`, `follow_up.read`, `report.read`, `channel.read`, `inbox.read`, `template.read`; **access** — `employee.read`, `role.read`, `permission.read`, `capability_pack.read`, `role_template.read`, `effective.read`; **workflow** — `template.read`, `rule.read`, `run.read`, `dead_letter.read`, `audit.read`; **report** — `catalog.read`, `dataset.read`, `query.run`, `view.read`, `snapshot.read`, `export`, `export.read_own`, `audit.read`; **bi** — `view.read`
- **`COMPANY_VIEW`** (41 key) — **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **company** — `setup.read`, `settings.view`, `branch.read`; **admin** — `role.read`; **attachment** — `read`, `create`; **dashboard** — `read`; **notification** — `read`, `preference.manage`; **accounting** — `document.read`, `quotation.read`, `invoice.read`; **expense** — `read`, `read_related`, `evidence.read`, `read_own`; **ledger** — `journal.read`, `report.read`, `period.read`; **procurement** — `purchase_request.read_related`, `purchase_order.read_related`, `goods_receipt.read_related`, `vendor_bill.read_related`, `supplier_payment.read_related`, `purchase_order.read`; **reimbursement** — `read`, `read_related`, `read_own`, `create`, `update_own_draft`, `submit`, `cancel_own`; **crm** — `customer.read`, `report.read`, `inbox.read`; **access** — `role.read`; **report** — `catalog.read`
- **`SYSTEM_ADMIN`** (56 key) — **system** — `billing.read`, `billing.financial.read`, `billing.document.read`, `billing.issue.manage`, `billing.reconcile.run`, `billing.apply.retry`, `billing.policy.manage`, `billing.gate.manage`, `billing.approval.approve`, `billing.notification.retry`, `billing.collection.manage`, `billing.refund.manage`, `billing.override.manage`, `billing.audit.read`, `billing.export`, `company_onboarding.create`, `company_onboarding.read`, `email_delivery.manage`, `email_delivery.read`, `company_onboarding.regenerate_temporary_password`, `line_binding.manage`, `shared_line_credential.manage`, `home_theme.manage`, `partner_dashboard.read`, `executive.read`, `executive.export`, `executive.contact.read`, `executive.company_note.manage`, `executive_user.manage`, `wht_income_category.manage`, `partner_company.create`, `partner_company.update`, `partner_company.lifecycle.manage`, `partner_feature.manage`, `partner_ai_model.manage`, `partner_line_credential.manage`, `partner_member.read`, `partner_member.manage`, `entitlement_exception.manage`, `launch_gate.read`, `launch_gate.manage`, `identity_reconciliation.resolve`, `data_rights.manage`; **account** — `session.read`, `password.change`, `identity.link`, `identity.unlink`; **sales** — `demo_link.create`, `console.read`, `company.search`, `deal.create`, `deal.approve`, `team.manage`, `report.read`, `agent_profile.manage`, `event.manage`
- **`MANGMEE_EXECUTIVE`** (4 key) — **account** — `session.read`, `password.change`, `identity.link`; **system** — `executive.read`
- **`MANGMEE_EXECUTIVE_EXPORT`** (4 key) — **account** — `session.read`, `password.change`, `identity.link`; **system** — `executive.export`
- **`MANGMEE_EXECUTIVE_CONTACT`** (4 key) — **account** — `session.read`, `password.change`, `identity.link`; **system** — `executive.contact.read`
- **`MANGMEE_EXECUTIVE_COMPANY_NOTE`** (4 key) — **account** — `session.read`, `password.change`, `identity.link`; **system** — `executive.company_note.manage`
- **`MANGMEE_SALES_LEAD`** (11 key) — **account** — `session.read`, `password.change`, `identity.link`; **sales** — `demo_link.create`, `console.read`, `company.search`, `deal.create`, `deal.approve`, `team.manage`, `report.read`, `event.manage`
- **`MANGMEE_SALES`** (7 key) — **account** — `session.read`, `password.change`, `identity.link`; **sales** — `demo_link.create`, `console.read`, `company.search`, `deal.create`

---

## 19. Prisma models ของพื้นที่ CORE

แหล่งความจริง: `apps/api/prisma/schema.prisma` ตารางนี้สรุป model ที่โมดูลในพื้นที่ CORE เป็นเจ้าของ พร้อมฟิลด์สำคัญ (ไม่รวม relation) และ FR ที่ใช้

### 19.1 ตัวตน บัญชี และ session

| Model | ฟิลด์สำคัญ | Enum / สถานะ | FR |
|---|---|---|---|
| `User` | `displayName`, `username`, `email`, `emailVerifiedAt`, `emailRevision`, `emailLoginEnabledAt`, `phoneNumber`, `status`, `isSystemProtected`, `aiAssistantOptOutAt` | `UserStatus`: ACTIVE, SUSPENDED, DISABLED | 002, 017, 018, 021 |
| `UserCredential` | `userId`, `passwordHash`, `status`, `mustChangePassword`, `tempPasswordEncrypted`, `expiresAt` | `CredentialStatus`: ACTIVE, TEMPORARY, DISABLED | 002, 005, 006, 044 |
| `AuthSession` | `userId`, `tokenId`, `previousTokenId`, `familyId`, `rotatedAt`, `status`, `issuedAt`, `expiresAt`, `revokedAt`, `passwordCredentialVersion`, `emailReauthenticatedAt`, `emailReauthBindingHash`, `emailReauthNonceHash`, `emailReauthExpiresAt`, `billingReauthenticatedAt`, `billingCredentialVersion` | `AuthSessionStatus`: ACTIVE, REVOKED, EXPIRED | 007, 008, 018 |
| `ExternalIdentity` | `userId`, `provider`, `providerUserId`, `providerChannelId`, `status`, `linkedAt`, `lastLoginAt` | `IdentityProvider`; `ExternalIdentityStatus`: ACTIVE, UNLINKED, DISABLED | 010, 014, 015 |
| `EmailVerificationToken` | `userId`, `newEmail`, `tokenHash`, `status`, `expiresAt`, `usedAt`, `proofKind`, `failedAttempts`, `emailRevision`, `securityBindingHash`, `sessionId`, `keyVersion`, `sendAttemptId`, `requestKey`, `requestFingerprint`, `companyId` | `VerificationTokenStatus`: PENDING, USED, EXPIRED, REVOKED | 017 |
| `EmailAccessChallenge` | `email`, `browserSecretHash`, `requestKey`, `codeHash`, `keyVersion`, `environment`, `userId`, `securityBindingHash`, `status`, `failedAttempts`, `sendAttemptId`, `signupRequestId`, `expiresAt`, `verifiedAt`, `usedAt` | | 019, 054 |
| `PasswordResetToken` | `userId`, `tokenHash`, `status`, `expiresAt`, `usedAt` | `VerificationTokenStatus` | 003, 004 |
| `AccountMergeTicket` | `tokenHash`, `newUserId`, `existingUserId`, `lineProviderUserId`, `requestId`, `expiresAt`, `consumedAt` | | 016 |
| `LineWebLoginTransaction` | `publicCodeHash`, `desktopSecretHash`, `status`, `userId`, `returnTo`, `expiresAt`, `approvedAt`, `consumedAt` | `LineWebLoginTransactionStatus` | 011 |
| `LineWebHandoffToken` | `tokenHash`, `userId`, `companyId`, `lineUserId`, `targetPath`, `surface`, `status`, `expiresAt`, `usedAt` | `LineWebHandoffTokenStatus` | 012, 013 |
| `LineChannelBinding` | `companyId`, `lineOfficialAccountId`, `messagingChannelId`, `liffChannelId`, `status` | | (ใช้โดย `LineChannelBindingService`; ไม่มี controller ในพื้นที่นี้) |
| `LineCompanyContext` | `lineUserId`, `companyId`, `selectedAt`, `aiPausedUntil` | | 012, 014, 059 |
| `LegalDocumentActionRecord` | `batchId`, `documentType`, `action`, `scopeRef`, `documentVersion`, `artifactUrl`, `releaseFingerprintSha256`, `statementVersion`, `statementText`, `statementSha256`, `acceptedByUserId`, `companyId`, `membershipId`, `actorCapacity`, `rolesJson`, `authProvider`, `sessionTokenId`, `requestId`, `locale`, `displayChallenge`, `surface`, `userAgent`, `acceptedAt` | `LegalDocumentType`, `LegalDocumentAction`, `LegalAcceptanceCapacity`, `LegalAcceptanceSurface` | 020 |
| `PlatformAccessControl` | `id` ('platform'), `state`, `updatedBySystemAdminUserId`, `reason` | `PlatformAccessState`: OPEN, CLOSED | 022 |
| `EmailSendAttempt` | `intentKey`, `generation`, `purpose`, `signupRequestId`, `provider`, `providerServerId`, `stream`, `recipient`, `providerMessageId`, `status`, `possibleDuplicate`, `errorCode`, `deadlineAt`, `submittedAt`, `deliveredAt`, `suppressedAt`, `nextRecoveryAt`, `historyArchivedAt` | | 025 |
| `EmailSuppression`, `EmailHistoryPolicy` | (รายการผู้รับที่ถูกระงับ / นโยบายเก็บประวัติแบบมี version) | | 025 |

### 19.2 บริษัท สมาชิก บทบาท

| Model | ฟิลด์สำคัญ | Enum / สถานะ | FR |
|---|---|---|---|
| `Company` | `name`, `registeredName`, `brandName`, `taxId`, `businessTypeCode`, `businessTypeOther`, `businessTypeVersion`, `vatRegistered`, `phone`, `email`, `addressJson`, `timezone`, `locale`, `baseCurrency`, `status`, `legalIdentityVersion`, `legalIdentityCaptureCompletedAt`, `lastLegalChangeEffectiveDate`, `legalIdentityAuthoritativeAt/Reason/Ref`, `tinExistsStatus/At`, `vatDetailStatus/At`, `referralSalesUserId`, `reportClassification` | `CompanyStatus`: ACTIVE, SUSPENDED, DISABLED, ARCHIVED | 060, 063 |
| `CompanyMembership` | `companyId`, `userId`, `status`, `defaultBranchId`, `branchScopeMode` | `MembershipStatus`: DRAFT, ACTIVE, INVITED, SUSPENDED, DISABLED; `MembershipBranchScopeMode` | 031, 033, 041–043 |
| `Role` | `companyId` (null = บทบาทระบบ), `scopeKey`, `key`, `name`, `description`, `isSystem`, `status` | `RoleStatus`: ACTIVE, DISABLED | 036, 046 |
| `Permission` | `key`, `description`, `riskLevel` | `PermissionRiskLevel` | 036 |
| `RolePermission`, `MembershipRole` | ตารางเชื่อม | | 031, 046 |
| `MembershipBranchScope` | `membershipId`, `branchId` | | 033, 042 |
| `Branch` | `companyId`, `code`, `name`, `type`, `isVatEstablishment`, `taxBranchCode`, `addressJson`, `phone`, `email`, `status` | `BranchType`, `BranchStatus` | 062 |
| `EmployeeAccessProfile` | `companyId`, `userId`, `membershipId`, `displayName`, `titlePrefix`, `jobTitle`, `legalName`, `firstName`, `lastName`, `nickname`, `dateOfBirth`, ที่อยู่, `email`, `identityType`, `identityLast4`, `identityHash`, `identityEncryptedRef`, `phoneNumber`, `status` | `EmployeeIdentityType` | 040–043 |
| `EmployeeLineLinkToken` | `companyId`, `membershipId`, `userId`, `issuedByUserId`, `tokenHash`, `status`, `expiresAt`, `claimedLineUserId`, `claimedLineChannelId`, `usedAt` | `EmployeeLineLinkTokenStatus` | 015, 045, 060 |
| `CompanyPlanTerm` | `tierKey`, `branchLimit`, `employeeLimit`, `monthlySlipLimit`, `capacityOverride`, `termStartAt`, `termEndsAt`, `warningDays`, `renewCount`, `termDisabledAt` (เจ้าของ model คือพื้นที่ partner/billing; CORE อ่านเพื่อบังคับขีดจำกัดและอายุแพ็ก) | | 009, 041, 062 |
| `CompanyFeatureEntitlement` | `companyId`, `featureKey`, `enabled`, `epoch`, `lastSeq`, `grantOrigin` | | 032 |
| `CompanyEntitlementSet`, `EntitlementCommand`, `EntitlementTransition`, `CompanyEntitlementNormalization`, `RunoffSnapshot` | ชุด entitlement แบบมี version, คำสั่ง, transition, สถานะ normalize, snapshot ของ runoff | `EntitlementTransitionAction`, `CompanyEntitlementNormalizationStatus` | 050, 084 |
| `CompanyLegalIdentityRevision` | `companyId`, `legalIdentityVersion`, `snapshotJson`, `changeKind`, `effectiveFrom`, `correctionReason`, `reconciliationItemId`, `repairCommandId`, `note`, `evidenceRef`, `actorUserId` | `LegalIdentityChangeKind`, `LegalIdentityCorrectionReason` | 063, 087 |
| `CompanyVatRegistrationState`, `CompanyVatRegistrationCommand`, `CompanyVatRegistrationFact`, `VatRegistrationPrompt` | fact: `status`, `effectiveFrom`, `effectiveTo`, `source`, `evidenceRef`, `answeredAt`, `actorId`, `supersededAt`, `supersededByCommandId` | `VatFactStatus`, `VatFactSource` | 064 |
| `CompanyIdentityReconciliationItem` | `companyId`, `kind`, `discriminator`, `sourceState`, `payloadMaskedJson`, `sourceFingerprint`, `status`, `resolutionCommandId`, `resolutionJson`, `resolvedByUserId`, `resolvedAt` | `ReconciliationKind`, `ReconciliationSourceState`, `ReconciliationStatus` | 087 |
| `ThaiAddressMaster` | รหัสและชื่อ ตำบล/อำเภอ/จังหวัด (ไทย/อังกฤษ), `postalCode`, พิกัด | | 049 |
| `CompanyBusinessPolicy` | `discountPolicyJson`, `poApprovalPolicyJson`, `retentionPolicyJson`, `consentPolicyJson` | | §20 |

### 19.3 การสมัครและ onboarding

| Model | ฟิลด์สำคัญ | Enum / สถานะ | FR |
|---|---|---|---|
| `CompanySignupRequest` | `source`, `externalSignupId`, `payloadHash`, `companyName`, `taxId`, `ownerDisplayName/FirstName/LastName`, `contactEmail`, `intakePolicyVersion`, `emailProofVerifiedAt`, `consentVersion`, `referralCode`, `discoverySource`, `discoverySourceOther`, `referralSalesCode`, `referralSalesUserId`, `requestedOfferKey`, `state`, `version`, `failureCode`, `businessType`, `phoneNumber`, `vatRegistered`, `mxValid`, `pendingPasswordHash`, `attachUserId`, `approvedAt` และฟิลด์การตัดสิน/การ provision อื่น | `CompanySignupState` (14 สถานะ — §6) | 051–057 |
| `AccountClaimToken` | `signupRequestId`, `tokenHash`, `expiresAt`, `usedAt`, `revokedAt` | | 052, 055 |
| `CompanyOnboardingRun` | `companyId`, `ownerUserId`, `status`, `modulePackage`, `handoffUrl`, `lineAddUrl`, `lineLinkUrl`, `createdBySystemAdminUserId`, `completedAt` | `OnboardingRunStatus` | 060, 061 |
| `PackageChangeRequest` | `companyId`, `requestedByUserId`, `requestedTierKey`, `status`, `note`, `decidedByUserId`, `decidedAt` และฟิลด์การขาย/การชำระเงิน (พื้นที่ sales/billing) | | 058 |
| `LineSupportRequest`, `LineSupportMessage`, `LineSupportMessageBlob` | คำขอ: `companyId`, `lineUserId`, `lineUserIdHash`, `signupRequestId`, `requestText`, `status`, `assignedToUserId`, `answeredAt` ฯลฯ | `LineSupportRequestStatus` | 059 |

### 19.4 ไฟล์ เลขที่เอกสาร outbox audit

| Model | ฟิลด์สำคัญ | Enum / สถานะ | FR |
|---|---|---|---|
| `AttachmentObject` | `companyId`, `branchId`, `storageProvider`, `bucket`, `objectKey`, `objectVersionId`, `originalFileName`, `mimeType`, `byteSize`, `checksumSha256`, `perceptualHash`, `visibility`, `status`, `uploadedByUserId`, `uploadedAt`, `deletedAt`, `metadataJson` | `AttachmentStatus`, `AttachmentVisibility` | 065 |
| `AttachmentBlob` | `attachmentId`, `companyId`, `data` | | 065 |
| `AttachmentLink` | `companyId`, `attachmentId`, `targetType`, `targetId`, `purpose`, `linkedByUserId` | | 065 |
| `DocumentSequence` | `companyId`, `branchId`, `branchScopeKey`, `documentType`, `periodKey`, `prefixTemplate`, `nextNumber`, `padding`, `resetPolicy`, `status` | `DocumentSequenceStatus`, `DocumentResetPolicy` | 067 |
| `DocumentNumber` | `companyId`, `branchId`, `sequenceId`, `documentType`, `documentNumber`, `status`, `ownerType`, `ownerId`, `idempotencyKey`, `reservedAt`, `committedAt`, `cancelledAt`, `voidedAt` | `DocumentNumberStatus` | 067 |
| `OutboxEvent` | `companyId`, `eventType`, `aggregateType`, `aggregateId`, `eventKey`, `payloadJson`, `headersJson`, `status`, `priority`, `attempts`, `availableAt`, `lockedAt`, `lockedBy`, `claimToken`, `publishedAt`, `lastError` | `OutboxEventStatus`, `OutboxEventPriority` | 068, 057, 069 |
| `AuditLog` | `companyId`, `actorType`, `actorUserId`, `actorRefId`, `action`, `targetType`, `targetId`, `requestId`, `result`, `riskLevel`, `metadataJson`, `createdAt` | `AuditActorType`, `AuditResult`, `AuditRiskLevel` | 071, 072 |

### 19.5 PDPA, แดชบอร์ด, การแจ้งเตือน, launch control, ธีม

| Model | ฟิลด์สำคัญ | Enum / สถานะ | FR |
|---|---|---|---|
| `DataRightsCase` | `requestKey`, `caseType`, `status`, `requestSource`, `requesterContactHash`, `targetUserId`, `companyId`, `membershipId`, `receivedAt`, `dueAt`, เวลาและผู้ทำของแต่ละขั้น (`identityVerified*`, `authorityVerified*`, `approved*`, `executionStarted*`, `verificationStarted*`, `completed*`), `outcomeSummary` | `DataRightsCaseType`, `DataRightsCaseStatus`, `DataRightsRequestSource` | 073 |
| `DataRightsDecisionRecord`, `DataRightsEvidenceRecord`, `DataRightsCaseActionRecord` | การตัดสินรายหมวด / หลักฐาน / ประวัติการกระทำ | `DataRightsDecisionCategory`, `DataRightsDisposition`, `DataRightsEvidenceType` | 073 |
| `DashboardSnapshot` | `companyId`, `scope`, `scopeKey`, `periodKind`, `periodStart`, `periodEnd`, `metricsJson`, `sourceRefsJson`, `freshnessStatus`, `generatedBy`, `generatedAt` | `DashboardScope`, `DashboardFreshnessStatus`, `DashboardGeneratedBy` | 074 |
| `DashboardWidgetConfig` | (ค่าตั้ง widget) | `DashboardWidgetStatus` | 074 (ไม่พบ endpoint เขียน) |
| `NotificationRule` | `companyId`, `triggerKey`, `name`, `severity`, `conditionJson`, `recipientPolicyJson`, `channelPolicyJson`, `cooldownMinutes`, `digestPolicy`, `status` | `NotificationRuleStatus`, `NotificationDigestPolicy` | 078 |
| `NotificationEvent` | `companyId`, `ruleId`, `triggerKey`, `sourceModule`, `sourceType`, `sourceId`, `severity`, `title`, `body`, `payloadJson`, `sourceRefsJson`, `deepLinkHref`, `dedupKey`, `status`, `firstSeenAt`, `lastSeenAt`, `resolvedAt` | `NotificationSeverity`, `NotificationEventStatus` | 076, 079 |
| `NotificationRecipient` | `eventId`, `companyId`, `userId`, `recipientReason`, `readAt`, `dismissedAt`, `waitingKey`, `supersededAt`, `finishedAt`, `snoozedUntil` | | 076 |
| `NotificationDelivery` | `recipientId`, `companyId`, `channel`, `status`, `attemptCount`, `nextAttemptAt`, `sentAt`, `errorCode`, `errorMessage`, `providerMessageId`, `metadataJson` | `NotificationChannel`, `NotificationDeliveryStatus` | 079 |
| `NotificationPreference` | `companyId`, `userId`, `enabledChannelsJson`, `enabledTriggerKeysJson`, `quietHoursStart`, `quietHoursEnd`, `timezone`, `digestFrequency` | | 077 |
| `AlertState` | `companyId`, `dedupKey`, `status`, `occurrenceCount`, `lastTriggeredAt`, `cooldownUntil`, `lastResolvedAt` | `AlertStateStatus` | 078 |
| `FeatureLaunchGate` | `gateKey`, `routeKey`, `state`, `generation`, `lastSeq`, `reason` | `FeatureLaunchGateState` | 081, 082 |
| `FeatureLaunchGateTransition` | `gateKey`, `routeKey`, `seq`, `generation`, `commandId`, `action`, `actorUserId`, `payloadFingerprint`, `reason`, `targetEnvironment`, `buildReleaseId`, `expectedGeneration`, `routeClass`, `validationEvidenceRef/Hash`, `specialistApprovedByUserId`, `releaseApprovedByUserId`, `emergencyClose`, `emergencyAuthorityUserId`, `incidentRef` | `FeatureLaunchGateAction`, `FeatureLaunchRouteClass` | 081 |
| `FeatureLaunchCommandResult`, `FeatureLaunchObservationBucket` | ผลคำสั่งที่เก็บถาวร / สถิติ shadow รายชั่วโมง | `FeatureLaunchCommandResultKind` | 081, 083 |
| `ExecutionAttempt` | `companyId`, `companyScope`, `sourceType`, `sourceId`, `attemptSeq`, `attemptKey`, `identityFingerprint`, `status`, `entitlementEpochsJson`, `launchEntriesJson`, `availabilityVectorHash`, `targetEnvironment`, `buildReleaseId`, `claimedAt`, `dispatchToken`, `leaseOwner`, `leaseExpiresAt`, `leaseGeneration`, `dispatchedAt`, `attempts`, `lastError`, `terminalAt` | `ExecutionAttemptStatus` | 083 |
| `PublicHomeThemeSetting` | `id` ('homepage'), `event`, `version`, `updatedBySystemAdminUserId`, `updatedAt` | | 086 |

---

## 20. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

รายการต่อไปนี้พบในโมดูลของพื้นที่ CORE แต่ไม่อยู่ในฟีเจอร์ของแพ็กใดใน `TIER_FEATURE_PRESETS`, มีสถานะ `planned`, ถูกปิดถาวรในโค้ด หรือไม่มีทางเรียกใช้ จึงไม่บรรยายเชิงลึก

| รายการ | ตำแหน่งในโค้ด | เหตุผล |
|---|---|---|
| นโยบายส่วนลด `GET/PUT …/settings/discount-policy` | `employee-access/presentation/http/business-policy.controller.ts` | gate ด้วย `crm.customer.read/update` (ฟีเจอร์ `crm` ไม่อยู่ในแพ็กที่ขาย); เมนู `discount` สถานะ `planned` |
| นโยบายอนุมัติใบสั่งซื้อ `GET/PUT …/settings/po-approval` | เดียวกัน | gate ด้วย `procurement.purchase_order.*` (ฟีเจอร์ `procurement` ไม่ขาย); เมนู `poapproval` สถานะ `planned` |
| นโยบายเก็บรักษาข้อมูลและ consent ของ CRM `GET/PUT …/settings/retention-policy`, `consent-policy` | เดียวกัน | gate ด้วย `crm.channel.read/manage` (ฟีเจอร์ `line_oa` ไม่ขาย) |
| Widget สุขภาพสต๊อกบนแดชบอร์ด และการสแกนสต๊อกต่ำ | `dashboard-notifications/application/providers/inventory-health.provider.ts`, `use-cases/stock-low-scan.use-case.ts`, `internal/notifications/stock-low-sweep` | ฟีเจอร์ `inventory` ไม่อยู่ในแพ็กที่ขาย |
| Trigger แจ้งเตือนของโมดูลที่ไม่ขาย (`stock_low`, `crm_sla_breach`, `crm_new_conversation`, `crm_payment_proof`, `workflow.*` ของ inventory/procurement/tax ฯลฯ) | `dashboard-notifications/domain/models/notification.model.ts` | ผูกกับ feature key ที่ไม่ขาย (`NOTIFICATION_TRIGGER_FEATURE_KEYS`) |
| การปรับแต่ง widget แดชบอร์ด (`dashboard.configure`, `DashboardWidgetConfig`) | ทะเบียน permission, schema | ไม่พบ endpoint |
| Phone OTP login | `auth/domain/logic/login-channel.logic.ts` | คืน `available:false`, `deferred_to_future_release` เสมอ |
| `POST /v1/auth/line/exchange` (แลก LINE ID token ตรง) | `auth.controller.ts` | ตอบ 403 `LINE login is deferred to a future release` เสมอ |
| ลิงก์ยืนยันอีเมลรุ่นเก่า: `POST /v1/auth/account/email`, `/account/email/resend`, `/account/email/verify`, `/me/email/unverified` และหน้า `/verify-email` | `auth.controller.ts`, `request-email-change.use-case.ts`, `resend-email-verification.use-case.ts`, `confirm-email-verification.use-case.ts` | controller ตอบ 409 `EMAIL_OTP_REQUIRED` เสมอ (use case ยังอยู่ในโค้ดแต่ controller ไม่เรียก) |
| หน้า `/companies/[companyId]/settings/security` | `apps/web/app/(workspace)/companies/[companyId]/settings/security/page.tsx` | redirect ไป dashboard (ปิดตามการตัดสินใจ 2026-08-05 ในคอมเมนต์) |
| `GET /v1/test/protected` | `health/presentation/http/protected-test.controller.ts` | ต้องใช้ `health.read` ซึ่งไม่มีในทะเบียน |
| Permission `admin.user.*`, `admin.role.read`, `outbox.event.read`, `access.role_template.manage`, `system.line_binding.manage` | `permission-registry.ts` | ไม่พบ controller ใช้ในโค้ด |
| Role template และ capability pack ของฟีเจอร์ที่ไม่ขาย (inventory, crm, quotation, billing, payment, procurement, bank, ledger, tax ทั่วไป) | `employee-access/domain/registries/*` | แค็ตตาล็อกยังแสดง แต่ permission ถูกตัดสำหรับบริษัทที่ไม่ได้เปิดฟีเจอร์นั้น |
| เมนูสถานะ `planned` ใน `MENU_ENTITLEMENT_BINDINGS`: `crmreport`, `salesdoc`, `sales`, `accounting`, `closing`, `poapproval`, `discount` | `packages/contracts/src/menu-entitlements.ts` | ไม่แสดงในเมนู |
| การ์ดตั้งค่า `line-oa`, `crm-catalog`, `accounting-tax-setup`, `tax-codes`, `tax-accounts`, `chart-of-accounts` | `web-core-workspace/settings-menu.logic.ts` | ฟีเจอร์ปลายทางไม่อยู่ในแพ็กที่ขาย |
| คู่มือ "ภาษี" และ "รายงานการเงิน" ในเมนูคู่มือ | `web-core-workspace/web-core-workspace.logic.ts` | ถูกซ่อน (คอมเมนต์ owner decision 2026-08-10) |
| ExecutionAttempt enforcement (claim/dispatch) | `feature-launch/application/execution-attempt.service.ts` | คอมเมนต์ระบุว่ายังไม่มี hot path เรียก — เป็น seam เท่านั้น |
| Launch gate ของฟีเจอร์ที่ไม่ขาย และ gate `SPECIALIST_LEGAL` (`cap.thai_tax.*`) | `feature-launch/domain/launch-matrix.catalog.ts` | ฟีเจอร์ไม่อยู่ในแพ็ก / seed `CLOSED` |
| หน้ากิจกรรมฮาโลวีน `/halloween/*` | `apps/web/src/features/public-home/Halloween*` | เนื้อหาการตลาดตามอีเวนต์ ไม่ใช่ฟีเจอร์ของแพ็ก |

---

## 21. สิ่งที่ยืนยันไม่ได้ และสิ่งที่มีใน docs แต่ไม่พบในโค้ด

การตรวจสอบทำแบบอ่านอย่างเดียว ไม่ได้รัน build/test/server ดังนั้นพฤติกรรมด้านล่างยืนยันจากการอ่านโค้ดเท่านั้น

**ยืนยันไม่ได้ / อ่านไม่ครบ**

1. รายละเอียดภายในของ use case ขนาดใหญ่ถูกอ่านจากส่วนหัว คอมเมนต์ จุด throw และ DTO ไม่ได้อ่านทุกบรรทัด: `legal-acceptance.service.ts` (740 บรรทัด), `signup-admin-queue.use-case.ts` (1,170), `submit-line-signup.use-case.ts` (774), `support-request-admin.use-case.ts` (792), `data-rights.service.ts` (1,202), `normalize-entitlements.ts` (1,183), `execution-attempt.service.ts` (943), `runoff-lifecycle.ts` (842), `notification.use-cases.ts` (909) — เงื่อนไขย่อยบางข้ออาจไม่ปรากฏในเอกสารนี้
2. ผลของแต่ละ `action` ใน `POST /v1/system/signup-requests/:requestId/decision` (`CREATE_NEW_SHOP`, `RETURN_EXISTING`, `REQUEST_INFO`, `RETRY_INTAKE`) ระบุได้ตามชื่อและคอมเมนต์ ไม่ได้ไล่ทุกสาขาของโค้ด
3. ค่า HTTP status ของบางข้อผิดพลาดใน `email-access.service.ts` และ `launch-gate-command.use-case.ts` ระบุตามรูปแบบที่อ่านพบ ไม่ได้ยืนยันทุกจุด
4. ค่า config ที่อ้างชื่อแต่ไม่ได้เปิดดูค่าเริ่มต้น: `postmarkUatAllowedRecipients`, `productionServingMode`, `swaggerEnabled` (ค่าที่ตรวจแล้ว: `LINE_SIGNUP_ENABLED` false, `LINE_QR_CREATE_MAX_PER_IP` 10/300 วินาที, `LINE_QR_POLL_MAX_PER_IP` 90/60 วินาที, `LINE_HANDOFF_EXCHANGE_MAX_PER_IP` 20/60 วินาที — `packages/config/src/index.ts:238,449-457`)
5. ไม่พบหน้าเว็บที่เรียก `GET /v1/companies/:companyId/audit/logs` และ `…/document-sequences` (ค้นคำในทั้ง `apps/web`); ส่วน `notification-deliveries` มี client ใน `features/dashboard-notifications/dashboard-notifications.api.ts` แต่ไม่ได้ยืนยันว่าหน้าใดแสดง
6. ไม่พบหน้าเว็บใต้ `/system` สำหรับ launch gate, identity reconciliation และ entitlement exception โดยเฉพาะ (อาจฝังอยู่ในหน้า `/system/partners/[companyId]` ซึ่งอยู่นอกพื้นที่นี้ — ไม่ได้ตรวจ)
7. `LineChannelBindingService` (`auth/application/line-channel-binding.service.ts`) ถูก export จาก `auth.module.ts` แต่ไม่ได้ไล่หาผู้เรียก
8. การ sync บทบาท/permission ลงฐานข้อมูล (`apps/api/prisma/seed.ts`, `prisma/sync-permissions.ts`) อธิบายตามคอมเมนต์ใน `permission-registry.ts` และ `company-role-backfill.registry.ts` ไม่ได้อ่านสคริปต์เอง
9. ชุดฟีเจอร์ที่ seed ให้ `FREE_TRIAL_15` ระบุตามคอมเมนต์ของ `create-company-onboarding.use-case.ts` ("Omitted or 'starter' seeds the 7-menu starter preset") ไม่ได้ไล่โค้ด seed ทีละบรรทัด; `TIER_FEATURE_PRESETS` เองไม่มี key `FREE_TRIAL_15`
10. รายชื่อไฟล์ทดสอบอ้างจาก `git ls-files`; ไม่ได้ตรวจว่า spec ใดอยู่ในรายการที่ CI รันจริง

**มีใน docs/ความจำของโครงการ แต่โค้ดต่างออกไป (หรือไม่พบ)**

1. **MFA** — โจทย์ระบุ "MFA if any": ไม่พบ MFA/TOTP ในโค้ด มีเพียง re-authentication ด้วยรหัสผ่าน, email OTP และ LINE (FR-CORE-017, 018)
2. **คำเชิญพนักงาน (invitations)** — ไม่พบ flow เชิญทางอีเมลหรือการเขียนสถานะ `INVITED`; พนักงานถูกสร้างพร้อมรหัสผ่านเริ่มต้นจากวันเกิดและ QR ผูก LINE (FR-CORE-041)
3. **"ไม่มี feature switch ทาง env"** (บันทึกแนวทางของโครงการ) — โค้ดยังมีสวิตช์ config ที่มีผลจริงในพื้นที่นี้: `LINE_WEB_LOGIN_ENABLED`, `LINE_WEB_HANDOFF_ENABLED`, `EXTERNAL_SIGNUP_ENABLED`, `LINE_SIGNUP_ENABLED`, `LINE_OFFICIAL_REPLY_ENABLED`, `LINE_SIGNUP_APPROVAL_MODE`, `RATE_LIMIT_ENABLED`, `swaggerEnabled` (ค่าเริ่มต้นส่วนใหญ่เป็น false ใน `packages/config/src/index.ts`)
4. **การยืนยันอีเมลด้วยลิงก์** — use case และหน้า `/verify-email` ยังอยู่ แต่ controller ปิดทางแล้วและใช้ OTP แทน (§20)
5. **Launch enforcement แบบเต็ม (ExecutionAttempt)** — spec/plan ที่คอมเมนต์อ้าง (F1) กล่าวถึงการ "flip enforcement"; ที่ commit นี้งาน asynchronous ยังเป็น shadow เท่านั้น ส่วนการกัน "งานใหม่" ผ่าน `LaunchGateGuardService` ทำงานจริง (FR-CORE-082, 083)
6. **รายงาน identity reconciliation** — spec อ้างรายงาน 6 ชุด; โค้ดให้เฉพาะรายงานที่ 2 และ 5 ที่เหลือตอบ 422 (FR-CORE-087)
7. **`access.role_template.manage` / template ของบริษัท** — มี permission และ audit action (`access.role_template.create/update/apply`) แต่ไม่พบ endpoint จัดการ template ของบริษัท
8. **หน้าความปลอดภัยบัญชี (`/settings/security`)** — มีใน `FEATURE_CATALOG` (`company_settings.security`) และ route rule แต่หน้า redirect ออก; ฟังก์ชันย้ายไป `/change-password`, `/account/email` และส่วนบัญชีของหน้าโปรไฟล์
