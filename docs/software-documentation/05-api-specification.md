# 05 — API Specification (ข้อกำหนด API ทั้งระบบ)

**วัตถุประสงค์:** เอกสารนี้เป็นบันทึกถาวรของ API ทั้งหมดของ MangmeePlus / WatchDog-BMS ที่ได้จากการอ่าน controller, guard, DTO และ route handler จริงในโค้ด ครอบคลุม `apps/api` (ERP core, NestJS), `apps/ai-gateway` (AI Gateway + AgentCore runtime), route handler ของ Next.js ใน `apps/web/app/api/**`, สัญญาร่วมใน `packages/contracts`, สัญญาระหว่างบริการ (ai-gateway ↔ api, workers ↔ api) และคิวงานเบื้องหลัง เพื่อให้ทีมในอนาคตสร้างระบบขึ้นใหม่และเรียกใช้ API ได้ถูกต้องโดยอาศัยเอกสารนี้คู่กับโค้ดที่เก็บถาวรไว้

**ที่มา:** checkout `closeout-docs-main` ที่ commit `08850deaf` (2026-11-10, `origin/main`) โค้ดคือความจริง ตารางรายการ endpoint ในหมวด 2–3 สร้างจากการ parse decorator ของ NestJS (`@Controller`, `@Get/@Post/@Put/@Patch/@Delete`, `@RequirePermissions`, `@RequireAnyPermission`, `@Public`, `@UseGuards`) ด้วยสคริปต์อ่านอย่างเดียว แล้วตรวจยอดกับการนับ decorator ด้วย grep

**รหัสความต้องการ:** เอกสารนี้ใช้ `FR-API-<nnn>` สำหรับความต้องการเชิงหน้าที่ของชั้น API และ `NFR-<nnn>` (ช่วง `NFR-API-…`) สำหรับความต้องการที่ไม่ใช่หน้าที่ ดูหมวด 9

## สารบัญ

1. [ข้อตกลงร่วมของ API (Conventions)](#1-ข้อตกลงร่วมของ-api-conventions)
2. [รายการ endpoint ทั้งหมดของ `apps/api` แยกตามโมดูล](#2-รายการ-endpoint-ทั้งหมดของ-appsapi-แยกตามโมดูล)
3. [Endpoint สาธารณะ/ไม่ต้องล็อกอิน, webhook และ endpoint ภายใน](#3-endpoint-สาธารณะไม่ต้องล็อกอิน-webhook-และ-endpoint-ภายใน)
4. [รายการ endpoint ของ `apps/ai-gateway` และ route handler ของ `apps/web`](#4-รายการ-endpoint-ของ-appsai-gateway-และ-route-handler-ของ-appsweb)
5. [รายละเอียดเต็มของ endpoint สำคัญ](#5-รายละเอียดเต็มของ-endpoint-สำคัญ)
6. [สัญญาร่วมใน `packages/contracts`](#6-สัญญาร่วมใน-packagescontracts)
7. [สัญญาระหว่างบริการและคิวงานเบื้องหลัง](#7-สัญญาระหว่างบริการและคิวงานเบื้องหลัง)
8. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#8-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
9. [รายการ FR/NFR ของชั้น API](#9-รายการ-frnfr-ของชั้น-api)
10. [สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด](#10-สิ่งที่ตรวจไม่ได้-และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด)

---

## 1. ข้อตกลงร่วมของ API (Conventions)

### 1.1 Base path และ versioning

| บริการ | Global prefix | หลักฐาน | หมายเหตุ |
|---|---|---|---|
| `apps/api` (ERP Core API) | `/v1` | `apps/api/src/main.ts` (`app.setGlobalPrefix('v1', { exclude: [{ path: 'local-storage/(.*)' }] })`) | มี version เดียวคือ `v1` ไม่มี header-based versioning; ยกเว้น `local-storage/*` (ใช้เฉพาะ storage แบบ local) ที่ไม่มี prefix |
| `apps/ai-gateway` (Nest) | `/v1` | `apps/ai-gateway/src/main.ts` | ทุก route ธุรกิจอยู่ใต้ `/v1/internal/ai/*` |
| AgentCore runtime | ไม่มี prefix | `apps/ai-gateway/src/agentcore/runtime.ts` | `GET /ping`, `POST /invocations` ตามโปรโตคอล AgentCore (HTTP server ล้วน ไม่ใช้ Nest) |
| `apps/web` (Next.js) | `/api/*` | `apps/web/next.config.mjs` (rewrites), `apps/web/app/api/**/route.ts` | `/api/:path*` ถูก rewrite ไป `${apiOrigin}/:path*` ดังนั้นเบราว์เซอร์เรียก `/api/v1/...` = `apps/api` `/v1/...`; ส่วน `/api/auth/*` และ `/api/public/*` เป็น route handler (BFF) ของ Next เอง |
| `apps/workers` | — | `apps/workers/src/main.ts` | ไม่มี API ธุรกิจ มีเพียง HTTP health server ตอบ `200 {service,status:'ok'}` ทุก path |

Swagger (`/docs`) เปิดเฉพาะเมื่อ config `swaggerEnabled` เป็นจริง ทั้งสองบริการ (`main.ts` ของแต่ละแอป) — ชื่อเอกสาร "WatchDog-BMS ERP Core API" และ "WatchDog-BMS AI Gateway API" version `0.1.0`

**Tenancy ใน path:** route ธุรกิจของลูกค้าเกือบทั้งหมดอยู่ใต้ `/v1/companies/:companyId/...` ส่วน route ระดับแพลตฟอร์มใช้ prefix คงที่: `/v1/auth/*` (ตัวตน/เซสชัน), `/v1/system/*` (คอนโซลผู้ดูแลระบบ), `/v1/sales/*` (คอนโซลเซลล์), `/v1/billing/*` (แค็ตตาล็อก/การซื้อระดับบัญชีผู้ใช้), `/v1/public/*` (ไม่ล็อกอิน), `/v1/internal/*` (บริการภายใน), `/v1/line/*` และ `/v1/webhooks/line` (LINE), `/v1/plan-term/*`, `/v1/health`

`AuthGuard` บังคับว่า header `X-Company-Id` กับ `:companyId` ใน path ถ้าส่งมาทั้งคู่ต้องตรงกัน มิฉะนั้น `403 Route company does not match request context.` (`apps/api/src/modules/auth/presentation/auth.guard.ts:258-263`) ถ้าไม่ส่ง header ระบบใช้ `:companyId` จาก path; ถ้าไม่มีทั้งคู่ resolver เลือก membership ที่ ACTIVE ตัวแรก (SYSTEM_ADMIN ก่อน) — ดู `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts`

### 1.2 วิธียืนยันตัวตนแยกตามพื้นผิว

| พื้นผิว | กลไก | รายละเอียดจากโค้ด |
|---|---|---|
| เบราว์เซอร์ (เว็บแอป) | Session cookie ผ่าน BFF | BFF (`apps/web/app/api/auth/*`) แลก credential ฝั่ง server แล้วเก็บ token ใน cookie `httpOnly`: `watchdog_token` (access JWT; ถ้ายาวเกิน 3,500 ตัวอักษรจะแบ่งเป็น `watchdog_token.0..5`), `watchdog_refresh` (path-scoped `/api/auth`), `watchdog_csrf` (อ่านได้จาก JS, double-submit), `watchdog_home`, `watchdog_persist` — `apps/web/src/common/auth/auth-cookies.constants.ts`. API อ่าน cookie เป็น fallback ของ Bearer (`accessTokenFromCookies` ใน `apps/api/src/modules/auth/presentation/auth-cookie.constants.ts`) |
| Client แบบ token (สคริปต์/การทดสอบ/BFF ฝั่ง server) | `Authorization: Bearer <access JWT>` | Bearer มาก่อน cookie เสมอ (`auth.guard.ts:181-184`). JWT ตรวจด้วย `WatchdogJwtVerifierAdapter`; เมื่อไม่ใช่ production จะลอง `DevJwtVerifierAdapter` ด้วย. Token ต้องมี session claim (`tokenId`) และแถว `AuthSession` ต้อง `ACTIVE`, เป็นของ `subject` และยังไม่หมดอายุ |
| อายุ token | access 900 วินาที, refresh 7 วัน | `apps/api/src/modules/auth/application/use-cases/issue-token.use-case.ts:20-21`; refresh แบบ rotation ผ่าน `POST /v1/auth/session/refresh` |
| เซสชันเดโม (sales demo) | JWT provider `demo` ผูก `demoCompanyId` | เรียกได้เฉพาะบริษัทเดโมนั้น และถูกปิด route ตาม `isDemoUnavailableRoute` (`auth.guard.ts:253-256, 288-289`) |
| Worker → API | header `X-Worker-Token` | route `@Public()` ใต้ `/v1/internal/*` เรียก `assertWorkerToken()` เทียบกับ env `WORKER_INTERNAL_TOKEN` แบบ constant-time, fail-closed (`apps/api/src/common/security/worker-token.ts`) |
| AI Gateway ↔ API | header `X-Internal-Secret` (+ `X-Actor-Delegation` สำหรับ tool invoke) | `assertInternalSecret()` (`apps/api/src/common/security/secret-compare.ts`, `apps/ai-gateway/src/common/security/internal-secret.ts` — โค้ดชุดเดียวกันสองที่โดยตั้งใจ). ฝั่ง gateway ตรวจใน middleware ก่อน body parser สำหรับทุก path ที่ขึ้นต้น `/v1/internal/` (`apps/ai-gateway/src/common/http/gateway-http.middleware.ts`) |
| LINE webhook | header `x-line-signature` | HMAC-SHA256 ของ raw body ด้วย channel secret, เข้ารหัส base64, เทียบแบบ `timingSafeEqual` (`apps/api/src/modules/auth/infrastructure/line-webhook-verifier.ts`) |
| Stripe events | header `stripe-signature` | ตรวจใน `BillingReconcilerService.receive(rawBody, signature)`; body parser เฉพาะ path จำกัด 256 KB และเก็บ `rawBody` (`apps/api/src/common/middleware/provider-events-body.middleware.ts`) |
| Postmark events | header `Authorization` (Basic) | `PostmarkEventsService.receive(authorization, body)` (`apps/api/src/modules/auth/presentation/postmark-events.controller.ts`) |
| Amazon SES (ผ่าน SNS) | ลายเซ็นข้อความ SNS + Topic ARN ที่คาดไว้ | ตรวจใน `SesEventsUseCase.handle`; parser เฉพาะ path รับทุก content-type จำกัด 256 KB; มี rate limit `ses-events-ip` (`public-ses-events.controller.ts`) |
| LIFF / LINE identity | header `x-line-id-token` หรือ id token ใน body | ใช้กับ route สมัคร/ผูกบัญชีผ่าน LINE (ดูหมวด 3 และ 5) |

**ลำดับ guard ของ `apps/api`:** (1) `ApiRateLimitGuard` (global, ต่อ IP) → (2) `AuthGuard` (ยืนยันตัวตน + สร้าง `RequestContext`) → (3) `DenyByDefaultGuard` (ตรวจ permission metadata) → guard เฉพาะ controller (`ReimbursementWriteQuiesceGuard`, `SalesAgentActiveGuard`)

**Deny by default:** route ที่ไม่ใช่ `@Public()` และไม่มี `@RequirePermissions`/`@RequireAnyPermission` จะถูกปฏิเสธด้วย `403 Permission metadata is required.` (`apps/api/src/common/security/deny-by-default.guard.ts`) — จากการ parse ไม่พบ route ใดที่ขาด metadata

- `@RequirePermissions(a, b)` = ต้องมี**ครบทุก**คีย์
- `@RequireAnyPermission(a, b)` = ต้องมี**อย่างน้อยหนึ่ง**คีย์ (ใช้ร่วมกับ `@RequirePermissions` ได้ ต้องผ่านทั้งสองเงื่อนไข)
- metadata ระดับ handler ทับระดับ class (`reflector.getAllAndOverride`)

**ประตูอื่นใน `AuthGuard` (เรียงตามลำดับในโค้ด):**

| ประตู | เงื่อนไข | ผลลัพธ์ |
|---|---|---|
| Platform access ปิด | `PlatformAccessService.getStatus().effectiveState === 'CLOSED'` | route สาธารณะ (นอกจากรายการ `CLOSED_PUBLIC_PATHS`) และผู้ใช้ที่ไม่ใช่ `SYSTEM_ADMIN` ได้ `503 {code:'platform_access_closed'}`; `/v1/health`, `/v1/internal/*`, `POST /v1/public/stripe-events`, `POST /v1/public/postmark-events` ผ่านเสมอ |
| ไม่มี token | — | `401 Missing authentication token.` |
| Token/เซสชันไม่ถูกต้อง | ลายเซ็นผิด, ไม่มี session claim, เซสชันหมดอายุ/ถูกเพิกถอน | `401` |
| ลิงก์เดโมหมดอายุ | `POST .../demo-chat/(messages\|files)` ของบริษัท DEMO ที่หมดอายุ | `410 {code:'demo_link_expired'}` |
| บริษัท/สมาชิกภาพ | ไม่มี membership ACTIVE, บริษัทไม่ ACTIVE | `403` (`company_membership_disabled`, `company_access_unavailable`, `company_term_expired`) |
| ต้องเปลี่ยนรหัสผ่าน | `UserCredential.mustChangePassword` และ path ไม่ขึ้นต้น `/v1/auth/` และไม่ใช่เซสชัน LINE | `403 Password change required before accessing business modules.` |
| อายุแพ็กหมด | `CompanyPlanTerm.termEndsAt <= now` (ยกเว้น `/v1/auth/*`, `/v1/plan-term/notice`, route กู้คืนด้าน billing/โปรไฟล์บริษัท, `SYSTEM_ADMIN`) | `403 {code:'company_term_expired'}` |
| ยังไม่ยอมรับข้อตกลง | `LegalAcceptanceService.isRequired` (ยกเว้น 5 path ใน `LEGAL_ACCEPTANCE_EXEMPT_PATHS`) | `403 {code:'legal_acceptance_required'}` |
| สิทธิ์ร่างรายจ่ายฟรี | บริษัทอยู่โหมด free-expense-drafts และ route ไม่อยู่ในรายการอนุญาต | `403 {code:'FREE_EXPENSE_DRAFTS_ONLY'}` |

### 1.3 Entitlement / feature gate

ไม่มี decorator สำหรับ feature gate แยกต่างหาก การบังคับทำที่จุดเดียวตอน resolve permission: permission ของฟีเจอร์ที่บริษัทไม่ได้เปิดจะถูก**ตัดออก**จาก `RequestContext.permissions` (`filterPermissionsByEntitlement` ใน `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts`) และ `DenyByDefaultGuard` จะตอบ `403 {code:'feature_not_enabled', featureKey}` เมื่อ permission ที่ขาด**ทุกตัว**เป็น permission ที่ role ให้ไว้แต่ถูก feature gate ตัด (ไม่เช่นนั้นตอบ `403 Insufficient permissions.`)

ลำดับการหา feature key ของ permission (ฟังก์ชัน `featureKeyDeniedByEntitlement`): (1) `SUBFEATURE_RULES` จาก `FEATURE_CATALOG[].submenus[].permissionKeys` (ตรวจ parent ก่อน แล้ว sub-key), (2) ชุดที่คงไว้เสมอ `RETAINED_REPORT_PERMISSIONS` / `RETAINED_REIMBURSEMENT_PERMISSIONS`, (3) `PREFIX_FEATURE_RULES` (เช่น `reimbursement.` → `reimbursement`, `report.` → `reports`, `crm.channel.` → `line_oa`), (4) capability pack ที่มี `featureEntitlementKey` (`apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`). บริษัทที่ไม่มีแถว entitlement เลย = legacy fail-open

คอลัมน์ **"Feature gate / แพ็ก"** ในหมวด 2 คำนวณโดยจำลองฟังก์ชันข้างต้นกับ `TIER_FEATURE_PRESETS` (`packages/contracts/src/menu-entitlements.ts`): ทุกแพ็กที่ขาย (STARTER_249, BASIC_499, PRO_999, ENTERPRISE_1999) ได้ชุด starter เดียวกัน (`dashboard_notifications`, `expenses` + `expenses.list/upload/manual/categories/evidence/signatures`, `reimbursement`, `ai_line_assistant`, `employee_access` + sub-keys, `company_settings` + sub-keys) และ ENTERPRISE_1999 เพิ่ม `wht_pnd53`, `wht_50bis` ค่าที่แสดง:

- `ทุกแพ็ก` — permission ไม่ถูก gate หรือ gate ด้วยคีย์ที่อยู่ใน starter preset
- `ENT` — ใช้ได้เฉพาะ ENTERPRISE_1999 (คีย์ `wht_pnd53` / `wht_50bis`)
- `ไม่ขาย(<featureKey>)` — permission ถูก gate ด้วยคีย์ที่ไม่อยู่ใน preset ของแพ็กใดเลย (นอกขอบเขตแพ็ก 1,999; ดูหมวด 8)
- `แพลตฟอร์ม` — route ของ `system.*`/`sales.*`/executive หรือ route สาธารณะ/ภายใน ซึ่งไม่ผูกกับแพ็กของลูกค้า

FREE_TRIAL_15 ไม่อยู่ใน `TIER_FEATURE_PRESETS` (ชนิด `Exclude<PlanTierKey,'FREE_TRIAL_15'>`) การให้สิทธิ์ช่วงทดลองดูเอกสารด้าน billing (02f)

### 1.4 Header มาตรฐาน

| Header | ทิศทาง | การใช้ | หลักฐาน |
|---|---|---|---|
| `Authorization: Bearer …` | request | access JWT | `auth.guard.ts` |
| `X-Company-Id` | request | เลือก tenant (ต้องตรงกับ `:companyId`) | `auth.guard.ts:177-263`; อยู่ใน CORS `allowedHeaders` |
| `X-Request-Id` | request/response | ถ้าไม่ส่งระบบสร้าง UUID; ค่าที่ยาวเกิน 256 ไบต์ถูกแทนด้วย `sha256:<hex>`; ส่งกลับใน response เสมอ และใช้เป็นคีย์ idempotency ของบาง flow (เช่น OCR admission) | `apps/api/src/common/middleware/request-id.middleware.ts` |
| `Idempotency-Key` | request | ใช้กับ handler 27 ตัว (billing checkout/คำสั่งผู้ดูแล, การจ่ายเงิน ฯลฯ — ดูคอลัมน์ Request ในหมวด 2 ที่มี `H:idempotency-key`) | `@Headers('idempotency-key')` |
| `idempotencyKey` (ใน body) | request | DTO บางตัวรับคีย์ใน body รูปแบบ `^[A-Za-z0-9_-]{8,64}$` | DTO ใน `presentation/` 5 ไฟล์ |
| `X-Idempotency-Key` | request (ภายใน) | worker แจ้งเตือน → API และ webhook ขาออกของ workflow | `apps/workers/src/modules/notifications/notification-worker.ts`, `workflow-action-runner.use-case.ts:530` |
| `X-Worker-Token` | request (ภายใน) | 49 handler ใต้ `/v1/internal/*` | `worker-token.ts` |
| `X-Internal-Secret`, `X-Actor-Delegation` | request (ภายใน) | gateway ↔ api | `internal-tools.controller.ts`, `erp-tool.client.ts` |
| `x-line-signature`, `x-line-id-token` | request | LINE webhook / LIFF | controller ของ LINE |
| `X-Line-Retry-Key` | request ขาออก (API → LINE Messaging API) | คีย์กันส่งซ้ำเมื่อ push ข้อความไป LINE | ผู้ส่งข้อความ LINE ใน `apps/api/src` (6 จุดอ้างอิง) |
| `stripe-signature` | request | Stripe events | `billing.controller.ts` (`StripeEventsController`) |
| `x-csrf-token` | request (ผ่านเว็บ) | double-submit CSRF ตรวจที่ `apps/web/proxy.ts` สำหรับ mutation ไป `/api/v1/*` ที่มี cookie เซสชัน; ผิด → `403 {code:'csrf_token_invalid'}` | `apps/web/src/common/auth/middleware.logic.ts` |
| `Cache-Control` | response | ค่าเริ่มต้นทุก response ของ API คือ `private, no-store, max-age=0`; controller ที่ตั้งใจให้ cache ได้ตั้งค่าเอง | `apps/api/src/common/middleware/api-cache-control.middleware.ts` |
| `Retry-After` | response | ส่งพร้อม `429` | `api-rate-limit.guard.ts` |
| `Content-Disposition`, `X-Export-Row-Count` | response | ไฟล์ export/PDF | controller ด้านรายงาน/ภาษี |

CORS: `credentials: true`, `allowedHeaders = Authorization, Content-Type, X-Company-Id, X-Request-Id`, methods `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`; origin ต้องอยู่ใน `CORS_ALLOWED_ORIGINS` (production บังคับตั้งค่า) — `apps/api/src/main.ts`

### 1.5 Body, validation, pagination และ filter

- **Body parser:** JSON/urlencoded จำกัดตาม `HTTP_BODY_LIMIT` (ค่าเริ่มต้น `1mb`, `packages/config/src/index.ts`), `inflate: false` (ปฏิเสธ body ที่บีบอัด), เก็บ `rawBody` ไว้ตรวจลายเซ็น ข้อยกเว้น: `POST /v1/companies/:id/banking/bank-accounts/:id/statement-imports/extract` ใช้ limit `UPLOAD_MAX_BYTES × 1.5` (ค่าเริ่มต้น `UPLOAD_MAX_BYTES` = 10,485,760 ไบต์), `/v1/public/ses-events` และ `/v1/public/(postmark|stripe)-events` จำกัด 256 KB
- **Validation:** global `TrimStringsPipe` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` (`apps/api/src/common/pipes/validation-pipe.options.ts`) → field ที่ไม่อยู่ใน DTO class ทำให้ได้ `400`; string ทุกตัวถูก trim. Handler ที่รับ `@Body()` เป็น type/interface (ไม่ใช่ class) จะไม่ถูก whitelist โดย pipe และตรวจเองใน use case
- **ไฟล์อัปโหลด:** ไม่มี multipart ผ่าน API โดยตรงสำหรับเอกสารธุรกิจ ใช้รูปแบบ 3 ขั้น `init` (ขอ presigned URL) → อัปโหลดตรงไป object storage → `complete` (ยืนยัน/สแกน) ดู attachment, expense capture, payment slip, signature ในหมวด 2 และ 5
- **Pagination แบบหน้า:** query `page` (เริ่ม 1) + `pageSize`; response มี `page`, `pageSize` และยอดรวม โดยชื่อ field ของรายการและตำแหน่งของยอดรวมต่างกันตามโมดูล (เช่น billing ใช้ `pagination: { page, pageSize, total }`) — ดู type ผลลัพธ์ใน `packages/contracts`. `@Query('page')`/`@Query('pageSize')` ปรากฏใน 24 handler
- **Pagination แบบ cursor:** query `cursor` (+ `limit` หรือ `pageSize`) — `@Query('cursor')` ปรากฏใน 6 handler และ handler ของ billing อ่าน `cursor`/`limit` จาก query ดิบ (เช่น `GET …/billing/history`: `limit` 1–2 หลัก ค่าเริ่มต้น 20)
- **Filter ที่ใช้ซ้ำ:** `status`, `scope`, `branchId`, `search`/`q`, `from`/`to` หรือ `fromDate`/`toDate` (วันที่แบบ civil date `YYYY-MM-DD`), `periodKey`, `sourceModule`. วันที่ผิดรูปแบบ → `400 {code:'invalid_date'}` (`InvalidCivilDateError` แปลงใน `AllExceptionsFilter`)
- **ขอบเขตสาขา (ABAC):** `RequestContext.scopes.branchIds` มาจาก membership (`branchScopeMode`); use case กรองข้อมูลตามสาขาเอง ไม่ใช่ query parameter ที่ผู้เรียกกำหนดเองได้อย่างอิสระ

### 1.6 รูปแบบ error และรหัส error

ระบบใช้ exception มาตรฐานของ NestJS ผ่าน `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`) รูป response มี 2 แบบ:

```json
// แบบข้อความล้วน (HttpException ที่ส่ง string)
{ "statusCode": 403, "message": "Insufficient permissions.", "error": "Forbidden" }

// แบบมีรหัส (HttpException ที่ส่ง object) — ไม่มี statusCode/error ห่อ
{ "code": "feature_not_enabled", "featureKey": "reimbursement" }
{ "code": "company_term_expired", "message": "This company's usage term has ended. Contact the administrator to renew." }

// Validation (class-validator)
{ "statusCode": 400, "message": ["field must be a string", "..."], "error": "Bad Request" }
```

เว็บ (`authedApiFetch`) อ่าน `message` (string หรือ array), `code`, และแนบ `requestId` จาก header `x-request-id` เข้า `details`

| HTTP | ความหมาย | ที่มา |
|---|---|---|
| 400 | validation, วันที่ผิด (`invalid_date`), Prisma validation → `Request shape or field values are invalid.` | ValidationPipe, filter |
| 401 | ไม่มี/ผิด token, เซสชันหมด, ลายเซ็น webhook/secret ภายในผิด | AuthGuard, assert* |
| 403 | ไม่มีสิทธิ์, feature ไม่เปิด, ประตูใน 1.2, CSRF (ที่เว็บ) | guards |
| 404 | ไม่พบข้อมูล; Prisma `P2025` → `Record not found.`; route ที่ซ่อนไว้ตาม config | use case, filter |
| 409 | ข้อมูลซ้ำ/ขัดแย้ง; Prisma `P2002` → `Duplicate value: …`, `P2003` → `Operation conflicts with related records: …`; optimistic conflict ของโดเมน (เช่น `EXPENSE_UPDATE_CONFLICT`, `accounting_document_changed`) | use case, filter |
| 410 | ลิงก์เดโมหมดอายุ (`demo_link_expired`) | AuthGuard |
| 413 | body ใหญ่เกิน (provider events) | middleware |
| 429 | เกิน rate limit (+ `Retry-After`) | rate limit |
| 502 | ผู้ให้บริการภายนอกไม่ตอบ (เช่น ตอบ LINE OA ไม่ได้) | controller |
| 503 | platform ปิด (`platform_access_closed`), ระบบกัน abuse ใช้ไม่ได้ | guards |
| 500 | ข้อผิดพลาดที่ไม่ได้จัดการ (log พร้อม requestId/method/path); Prisma schema drift/pool คง 500 โดยตั้งใจ | filter |

รหัส error (`code`) มีรูปแบบผสม snake_case และ UPPER_SNAKE พบค่าคงที่ `code: '…'` ที่ไม่ซ้ำกันประมาณ 619 ค่าใน `apps/api/src` (รวมรหัสข้อมูลอ้างอิงที่ไม่ใช่ error) รหัส error ข้ามโมดูลที่สำคัญ:

| code | HTTP | ความหมาย |
|---|---|---|
| `feature_not_enabled` | 403 | permission ถูกตัดเพราะบริษัทไม่ได้เปิดฟีเจอร์ (`featureKey` บอกคีย์) |
| `legal_acceptance_required` | 403 | ต้องยอมรับ Terms/Privacy ฉบับปัจจุบันก่อน |
| `company_term_expired` | 403 | อายุแพ็กหมด/บริษัทถูกปิดเพราะหมดอายุ |
| `company_membership_disabled`, `company_access_unavailable` | 403 | สมาชิกภาพถูกปิด/เข้าบริษัทไม่ได้ |
| `platform_access_closed` | 503 | ปิดการเข้าใช้ของลูกค้าทั้งแพลตฟอร์ม |
| `FREE_EXPENSE_DRAFTS_ONLY` | 403 | บัญชีฟรีใช้ได้เฉพาะอ่านเอกสาร/ร่างรายจ่าย |
| `demo_link_expired` | 410 | ลิงก์เดโมหมดอายุ |
| `invalid_date`, `invalid_filter`, `validation` | 400 | ข้อมูลนำเข้าผิด |
| `accounting_period_locked`, `period_closed`, `tax_period_locked` | 409/400 | งวดบัญชี/ภาษีถูกล็อก |
| `EXPENSE_UPDATE_CONFLICT`, `accounting_document_changed`, `expense_wht_source_changed`, `expense_correction_source_changed`, `support_request_changed` | 409 | ข้อมูลต้นทางเปลี่ยนระหว่างทำรายการ (optimistic concurrency) |
| `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, `SUBSTITUTE_EVIDENCE_RETENTION_LOCKED` | 409/422 | กฎหลักฐานรายจ่าย/ใบรับรองแทนใบเสร็จ |
| `wht_handoff_not_issuable`, `wht_certificate_payment_required` | 409 | เงื่อนไขออกหนังสือรับรอง 50 ทวิ |
| `AI_BUDGET_UNAVAILABLE`, `AI_MONTHLY_BUDGET_EXCEEDED`, `AI_BUDGET_INSUFFICIENT` | ส่วนใหญ่ส่งเป็น `errorCode` ในผลลัพธ์ (ไม่ใช่ HTTP error) | งบ AI ของบริษัทไม่พอ/ใช้ไม่ได้ — ชุดรหัส `AI_BUDGET_REFUSAL_CODES` ใน `packages/contracts/src/line-ai.ts` |
| `csrf_token_invalid` | 403 | (ชั้นเว็บ) CSRF token ไม่ตรง |
| `BILLING_CATALOG_UNAVAILABLE` | 503 | (BFF) อ่านแค็ตตาล็อกราคาไม่ได้ |

สถานะ HTTP ที่ระบุเป็นช่วงในตารางนี้หมายความว่าโค้ดโยน exception ต่างชนิดกันตามจุดใช้ ให้ตรวจ use case ของ endpoint นั้นประกอบ

### 1.7 Rate limit

| ชั้น | Bucket | ค่า | พฤติกรรมเมื่อ Redis ล่ม | หลักฐาน |
|---|---|---|---|---|
| Global ทุก request | `api-ip` (คีย์ = IP ลูกค้าที่เชื่อถือได้จาก `trustedClientIp`) | `RATE_LIMIT_MAX_REQUESTS` ต่อ `RATE_LIMIT_WINDOW_SECONDS` (ค่าเริ่มต้น 120 ครั้ง / 60 วินาที; production บังคับเปิด) | ลดระดับเป็นตัวนับในโปรเซส (`degrade-to-local`) | `api-rate-limit.guard.ts`, `packages/config/src/index.ts:211-213` |
| Login | `password-login-identifier-ip`, `password-login-ip` | นับเฉพาะครั้งที่ล้มเหลว; ค่าจาก config `passwordLogin*` | fail-closed | `auth-rate-limit.service.ts` |
| Reset password | `password-reset-request-identifier-ip`, `password-reset-request-ip`, `password-reset-confirm-ip` | ค่าจาก config | fail-closed | เดียวกัน |
| LINE login/QR/handoff | `line-login-callback-ip` และ bucket ของ QR create/poll, handoff exchange | ค่าจาก config | fail-closed | เดียวกัน |
| สมัครสาธารณะ | `public-signup-ip`, `public-signup-read-ip`, `public-signup-resend-ip`, `public-signup-resend-request`, `public-signup-claim-ip` | ค่าคงที่ในไฟล์ (หน้าต่าง `PUBLIC_SIGNUP_WINDOW_SECONDS`) | fail-closed | เดียวกัน |
| สมัครผ่าน LINE | `line-signup-ip`, bucket ต่อ LINE user, `line-signup-read-ip` | ค่าคงที่ในไฟล์ | fail-closed | เดียวกัน |
| Email OTP / email access | `email-otp-ip` (120/ชม.), `email-otp-reauth-user` (20/ชม.), `email-access-<action>-ip` (request 10/ชม., อื่น 30/ชม.) | ตามโค้ด | fail-closed | เดียวกัน |
| SES events | `ses-events-ip` | ค่าคงที่ | fail-closed | เดียวกัน |
| AI/OCR | `ocr`, `llm`, `ai-ocr-company`, `ai-llm-company` | ต่อผู้ใช้/ต่อบริษัท, หน้าต่าง `AI_RATE_LIMIT_WINDOW_SECONDS` (60) | fail-closed (bucket ที่มีค่าใช้จ่าย) | `redis-rate-limit.service.ts` และผู้เรียก |
| Billing | `billing-command`, `billing-operator-commands`, `billing-issue-update`, `billing-resend`, `billing-resend-admin`, `billing-reauthenticate` | ตามโค้ดของ billing | fail-closed | โมดูล billing |
| อื่น ๆ | `system-email-connection`, `line-credential-publication`, `login` | ตามโค้ด | — | ผู้เรียก `limits.consume` |
| AgentCore runtime | จำนวน invocation พร้อมกัน | เกิน → `429 {error:'TOO_MANY_CONCURRENT_INVOCATIONS'}`; body เกิน `AGENTCORE_MAX_BODY_BYTES` (1 MiB) ถูกปฏิเสธ | — | `agentcore/runtime.ts` |

`/health` และ `/v1/health` ไม่ถูกนับ rate limit

### 1.8 เว็บแอปเรียก API อย่างไร (BFF)

1. **เส้นทางข้อมูล:** โค้ดฝั่งเบราว์เซอร์เรียก same-origin `/api/v1/<path>` ผ่าน `authedFetch`/`authedApiFetch` (`apps/web/src/common/api/authed-fetch.ts`) → Next rewrite (`next.config.mjs`: `/api/:path*` → `${apiOrigin}/:path*`, `proxyTimeout` 180 วินาที) → `apps/api` `/v1/<path>` โดย cookie `watchdog_token` ถูกส่งไปด้วยและ API อ่านเป็น token
2. **CSRF/Origin:** `apps/web/proxy.ts` ปฏิเสธ mutation ไป `/api/*` ที่ไม่ใช่ same-origin (`403 Cross-origin request rejected.`) และบังคับ header `x-csrf-token` = cookie `watchdog_csrf` สำหรับ mutation ไป `/api/v1/*` ที่มี cookie เซสชัน
3. **การจัดการ 401:** `authedFetch` เรียก `POST /api/auth/refresh` หนึ่งครั้ง (single-flight) แล้วลองใหม่; 401 ซ้ำและ refresh ยืนยันว่าเซสชันหมดจริง → redirect `/login?next=…`. `403 csrf_token_invalid` → refresh หนึ่งครั้งแล้วลองใหม่หนึ่งครั้ง
4. **การจัดการ 403 เชิงธุรกิจ:** `feature_not_enabled`/`Insufficient permissions.` → ยิง event `watchdog:access-context-stale`; ข้อความ `Password change required` → ไป `/change-password`; `legal_acceptance_required`/`company_term_expired` → หน้าที่เกี่ยวข้อง
5. **Route handler (BFF) ของ Next:** `/api/auth/*` (login, refresh, logout, change-password, LINE login/QR, email access, signup claim, account merge, dev-login) และ `/api/public/*` — เรียก API ฝั่ง server ที่ `internalApiV1Base()` (`INTERNAL_API_URL` → `NEXT_PUBLIC_API_BASE_URL` → `NEXT_PUBLIC_API_URL` → `http://localhost:3001/v1`) token ไม่ถูกส่งกลับให้ JS ของเบราว์เซอร์ รายการเต็มอยู่หมวด 4.3
6. **Server components** เรียก API ตรงด้วย Bearer ที่อ่านจาก cookie (เช่น layout ตรวจ `GET /v1/auth/me`)

---

<!-- GENERATED-INVENTORY-START -->

## 2. รายการ endpoint ทั้งหมดของ `apps/api` แยกตามโมดูล

ตารางในหมวดนี้สร้างด้วยสคริปต์ที่ parse decorator ของทุกไฟล์ที่มี `@Controller(` ใต้ `apps/api/src/**` (ไม่รวม `*.spec.ts`) หนึ่งแถว = หนึ่ง decorator `@Get/@Post/@Put/@Patch/@Delete` (หนึ่ง handler) หาก decorator ระบุหลาย path (alias) จะแสดงทุก path ในแถวเดียวกัน

**วิธีอ่านคอลัมน์**

- **Method / Path** — path เต็มรวม global prefix `/v1`
- **Handler** — ชื่อ method ใน controller class ของหัวข้อย่อยนั้น (เลขบรรทัดของ decorator ในไฟล์อยู่ในวงเล็บ)
- **สิทธิ์** — `Public` = `@Public()` (ดูกลไกตรวจสอบในหมวด 3); รายการคีย์คั่นด้วย `+` = ต้องมีครบ (`@RequirePermissions`); `any(a \| b)` = มีอย่างน้อยหนึ่ง (`@RequireAnyPermission`); ค่าคงที่ในโค้ด (เช่น `DOCUMENT_READ_PERMISSIONS`) ถูกแทนด้วยรายการคีย์จริงแล้ว
- **Feature gate / แพ็ก** — ดูคำอธิบายหมวด 1.3; ค่าใน `[...]` คือ feature key ที่ gate permission ของ route นั้น
- **วัตถุประสงค์** — คำอธิบายภาษาไทยที่แปลงจากชื่อ handler (และชื่อ controller เมื่อชื่อ handler สั้น) ตามพจนานุกรมคำกริยา/คำนาม คำที่ไม่มีในพจนานุกรมคงภาษาอังกฤษ ตามด้วยข้อความ `@ApiOperation.summary` จากโค้ดเมื่อมี (ตัวเอียง) ให้ถือ summary, path และโค้ดเป็นหลักหากคำแปลอัตโนมัติคลุมเครือ
- **Request** — `B:` = ชนิดของ `@Body()`, `B{…}` = field ที่ดึงด้วย `@Body('x')`, `Q:` = ชนิดของ `@Query()`, `Q{…}` = query parameter รายตัว, `H:idempotency-key` = handler อ่าน header `Idempotency-Key`, `B:raw(req.body)` = อ่าน body ดิบจาก `@Req()`; `—` = ไม่มี body/query (มีเพียง path parameter)
- **Response** — return type ที่ประกาศใน signature; ถ้าไม่ได้ประกาศ (handler ส่วนใหญ่) แสดง `→ Class.method()` คือ use case/service ตัวแรกที่ handler เรียกซึ่งเป็นผู้กำหนดรูปผลลัพธ์; ตัวเลขในวงเล็บคือ `@HttpCode` ที่กำหนด (ไม่ระบุ = ค่าเริ่มต้นของ Nest: POST 201, อื่น 200)

### 2.0 สรุปจำนวน endpoint

| โมดูล (`apps/api/src/modules/<…>`) | Controller class | Endpoint (handler) | `@Public` | ทุกแพ็ก | ENT | ไม่ขาย | แพลตฟอร์ม |
|---|---:|---:|---:|---:|---:|---:|---:|
| `accounting-documents` | 6 | 29 | 0 | 9 | 0 | 20 | 0 |
| `ai-draft` | 3 | 10 | 2 | 8 | 0 | 0 | 2 |
| `audit` | 1 | 1 | 0 | 1 | 0 | 0 | 0 |
| `auth` | 9 | 65 | 28 | 31 | 0 | 0 | 34 |
| `banking` | 5 | 29 | 0 | 0 | 0 | 29 | 0 |
| `billing` | 5 | 143 | 6 | 31 | 0 | 0 | 112 |
| `crm-inbox` | 17 | 65 | 18 | 5 | 0 | 42 | 18 |
| `crm` | 6 | 53 | 0 | 4 | 0 | 49 | 0 |
| `dashboard-notifications` | 7 | 23 | 8 | 11 | 0 | 4 | 8 |
| `data-model-core` | 7 | 21 | 5 | 16 | 0 | 0 | 5 |
| `data-rights` | 1 | 13 | 0 | 0 | 0 | 0 | 13 |
| `employee-access` | 6 | 33 | 0 | 23 | 0 | 8 | 2 |
| `executive-business` | 3 | 15 | 1 | 0 | 0 | 0 | 15 |
| `expenses` | 8 | 128 | 1 | 127 | 0 | 0 | 1 |
| `external-signup` | 8 | 38 | 19 | 2 | 0 | 0 | 36 |
| `feature-launch` | 2 | 4 | 2 | 0 | 0 | 0 | 4 |
| `health` | 3 | 3 | 2 | 1 | 0 | 0 | 2 |
| `inventory` | 4 | 29 | 0 | 0 | 0 | 29 | 0 |
| `ledger` | 2 | 29 | 1 | 0 | 0 | 28 | 1 |
| `line-ai` | 5 | 7 | 7 | 0 | 0 | 0 | 7 |
| `procurement` | 7 | 51 | 0 | 0 | 0 | 51 | 0 |
| `public-home-theme` | 2 | 3 | 1 | 0 | 0 | 0 | 3 |
| `reimbursements` | 4 | 55 | 1 | 54 | 0 | 0 | 1 |
| `reports` | 1 | 12 | 0 | 5 | 0 | 7 | 0 |
| `sales-console` | 8 | 42 | 4 | 0 | 0 | 0 | 42 |
| `sales-demo` | 3 | 9 | 1 | 3 | 0 | 0 | 6 |
| `system-identity-reconciliation` | 1 | 7 | 0 | 0 | 0 | 0 | 7 |
| `system-onboarding` | 1 | 4 | 0 | 0 | 0 | 0 | 4 |
| `system-partner-management` | 7 | 44 | 1 | 1 | 0 | 0 | 43 |
| `tax` | 3 | 75 | 0 | 18 | 15 | 40 | 2 |
| `workflow` | 7 | 28 | 4 | 0 | 0 | 24 | 4 |
| **รวม 31 โมดูล** | **152** | **1068** | **112** | **350** | **15** | **331** | **372** |

แยกตาม HTTP method: POST 556, GET 404, PATCH 56, PUT 40, DELETE 12 — รวม **1068 handler**, 1080 path เมื่อนับ alias แยก

**การตรวจความครบถ้วน:** คำสั่ง `grep -rhE "@(Get|Post|Put|Patch|Delete)\(" apps/api/src --include='*.ts' --exclude='*.spec.ts' | grep -vE "^\s*(//|\*|/\*)" | grep -oE "@(Get|Post|Put|Patch|Delete)\(" | wc -l` ได้ **1068** ตรงกับยอดรวมของสคริปต์ (การนับแบบ `^\s*@(Get|…)` ได้ 1067 เพราะมี 1 decorator ที่อยู่หลัง decorator อื่นในบรรทัดเดียวกัน)

### 2.1 โมดูล `accounting-documents` — 29 endpoint

**`AccountingDocumentController`** — `apps/api/src/modules/accounting-documents/presentation/http/accounting-document.controller.ts` · base path: `/v1/companies/:companyId/accounting/documents` · 11 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1 | GET | `/v1/companies/:companyId/accounting/documents` | `list` (L55) | any(`accounting.document.read` \| `accounting.document.read_related` \| `accounting.quotation.read` \| `accounting.invoice.read` \| `accounting.billing_note.read` \| `accounting.receipt.read` \| `accounting.tax_invoice.read` \| `accounting.credit_note.read` \| `accounting.debit_note.read`) | ไม่ขาย(sales_documents) | ดูรายการ (เอกสาร บัญชี) — _List accounting documents_ | `Q{documentType,status,paymentStatus,counterpartyId,branchId,fromDate,toDate,page,pageSize}` | `→ ListDocumentsUseCase.execute()` |
| 2 | GET | `/v1/companies/:companyId/accounting/documents/:documentId` | `getOne` (L83) | any(`accounting.document.read` \| `accounting.document.read_related` \| `accounting.quotation.read` \| `accounting.invoice.read` \| `accounting.billing_note.read` \| `accounting.receipt.read` \| `accounting.tax_invoice.read` \| `accounting.credit_note.read` \| `accounting.debit_note.read`) | ไม่ขาย(sales_documents) | ดูข้อมูล (เอกสาร บัญชี) — _Get accounting document by id_ | — | `→ GetDocumentUseCase.execute()` |
| 3 | GET | `/v1/companies/:companyId/accounting/documents/:documentId/posting-source` | `getPostingSource` (L90) | `accounting.document.read` | ไม่ขาย(sales_documents) | ดูข้อมูล แหล่งที่มา การลงบัญชี — _Get ledger-ready posting source for finalized document_ | — | `→ GetDocumentPostingSourceUseCase.execute()` |
| 4 | POST | `/v1/companies/:companyId/accounting/documents` | `create` (L97) | any(`accounting.document.create` \| `accounting.quotation.create` \| `accounting.invoice.create` \| `accounting.billing_note.create` \| `accounting.receipt.create` \| `accounting.credit_note.create` \| `accounting.debit_note.create`) | ไม่ขาย(sales_documents) | สร้าง (เอกสาร บัญชี) — _Create accounting document draft_ | `B:CreateAccountingDocumentDto` | `→ CreateDocumentUseCase.execute()` |
| 5 | PATCH | `/v1/companies/:companyId/accounting/documents/:documentId` | `update` (L104) | any(`accounting.document.update` \| `accounting.quotation.update` \| `accounting.invoice.update` \| `accounting.billing_note.update` \| `accounting.receipt.update`) | ไม่ขาย(sales_documents) | แก้ไข (เอกสาร บัญชี) — _Update an accounting document draft_ | `B:UpdateAccountingDocumentDto` | `→ UpdateDocumentUseCase.execute()` |
| 6 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/issue` | `issue` (L125) | any(`accounting.document.issue` \| `accounting.quotation.issue` \| `accounting.invoice.issue` \| `accounting.billing_note.issue` \| `accounting.receipt.issue` \| `accounting.tax_invoice.issue` \| `accounting.credit_note.issue` \| `accounting.debit_note.issue`) | ไม่ขาย(sales_documents) | ออกเอกสาร (เอกสาร บัญชี) — _Issue accounting document_ | — | `→ IssueDocumentUseCase.execute()` (200) |
| 7 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/void` | `void` (L133) | any(`accounting.document.void` \| `accounting.quotation.void` \| `accounting.invoice.void` \| `accounting.billing_note.void` \| `accounting.receipt.void` \| `accounting.tax_invoice.void` \| `accounting.credit_note.void` \| `accounting.debit_note.void`) | ไม่ขาย(sales_documents) | ยกเลิก (void) (เอกสาร บัญชี) — _Void accounting document_ | `B:{ reason: string }` | `→ VoidDocumentUseCase.execute()` (200) |
| 8 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/submit-approval` | `submitApprovalAction` (L141) | `accounting.quotation.submit_approval` | ไม่ขาย(sales_documents) | ส่ง การดำเนินการ การอนุมัติ — _Submit quotation for approval_ | — | `→ SubmitQuotationApprovalUseCase.execute()` (200) |
| 9 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/approve` | `approve` (L149) | `accounting.quotation.approve` | ไม่ขาย(sales_documents) | อนุมัติ (เอกสาร บัญชี) — _Approve quotation issue_ | `B:{ note?: string }` | `→ ApproveQuotationUseCase.execute()` (200) |
| 10 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/reject` | `reject` (L157) | `accounting.quotation.approve` | ไม่ขาย(sales_documents) | ปฏิเสธ (เอกสาร บัญชี) — _Reject quotation issue_ | `B:{ note: string }` | `→ RejectQuotationUseCase.execute()` (200) |
| 11 | POST | `/v1/companies/:companyId/accounting/documents/:documentId/convert` | `convert` (L165) | any(`accounting.document.create` \| `accounting.quotation.create` \| `accounting.invoice.create` \| `accounting.billing_note.create` \| `accounting.receipt.create` \| `accounting.credit_note.create` \| `accounting.debit_note.create`) | ไม่ขาย(sales_documents) | แปลง (เอกสาร บัญชี) — _Convert issued quotation to invoice or billing note_ | `B:{ targetType: AccountingDocumentType }` | `→ ConvertDocumentUseCase.execute()` (200) |

**`AccountingPaymentController`** — `apps/api/src/modules/accounting-documents/presentation/http/accounting-payment.controller.ts` · base path: `/v1/companies/:companyId/accounting/payments` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 12 | GET | `/v1/companies/:companyId/accounting/payments` | `list` (L24) | `accounting.payment.read` | ไม่ขาย(sales_documents) | ดูรายการ (การจ่ายเงิน บัญชี) — _List payments_ | `Q{direction,counterpartyId,fromDate,toDate,page,pageSize}` | `→ ListPaymentsUseCase.execute()` |
| 13 | GET | `/v1/companies/:companyId/accounting/payments/:paymentId` | `getOne` (L46) | `accounting.payment.read` | ไม่ขาย(sales_documents) | ดูข้อมูล (การจ่ายเงิน บัญชี) — _Get payment by id_ | — | `→ GetPaymentUseCase.execute()` |
| 14 | POST | `/v1/companies/:companyId/accounting/payments` | `create` (L53) | `accounting.payment.create` | ไม่ขาย(sales_documents) | สร้าง (การจ่ายเงิน บัญชี) — _Record payment_ | `B:CreateAccountingPaymentDto` | `→ CreatePaymentUseCase.execute()` |
| 15 | POST | `/v1/companies/:companyId/accounting/payments/:paymentId/void` | `void` (L60) | `accounting.payment.void` | ไม่ขาย(sales_documents) | ยกเลิก (void) (การจ่ายเงิน บัญชี) — _Void payment record_ | `B:{ reason: string }` | `→ VoidPaymentUseCase.execute()` (200) |

**`CounterpartyController`** — `apps/api/src/modules/accounting-documents/presentation/http/counterparty.controller.ts` · base path: `/v1/companies/:companyId/accounting/counterparties` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 16 | GET | `/v1/companies/:companyId/accounting/counterparties` | `listCounterparties` (L95) | `accounting.counterparty.read` | ทุกแพ็ก [expenses] | ดูรายการ คู่ค้า (คู่ค้า) — _List counterparties_ | `Q{page,pageSize,search,usage,addressMissing}` | `→ ListCounterpartiesUseCase.execute()` |
| 17 | GET | `/v1/companies/:companyId/accounting/counterparties/:counterpartyId` | `getCounterparty` (L114) | any(`accounting.counterparty.read` \| `accounting.counterparty.manage` \| `expense.read_related` \| `accounting.document.read_related` \| `expense.create` \| `expense.update` \| `expense.review` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses,sales_documents] | ดูข้อมูล คู่ค้า — _Get counterparty by id_ | — | `→ GetCounterpartyUseCase.execute()` |
| 18 | POST | `/v1/companies/:companyId/accounting/counterparties` | `createCounterparty` (L124) | `accounting.counterparty.manage` | ทุกแพ็ก [expenses] | สร้าง คู่ค้า — _Create counterparty_ | `B:CreateCounterpartyDto` | `→ CreateCounterpartyUseCase.execute()` |
| 19 | PATCH | `/v1/companies/:companyId/accounting/counterparties/:counterpartyId` | `updateCounterparty` (L134) | any(`accounting.counterparty.read` \| `accounting.counterparty.manage` \| `expense.read_related` \| `accounting.document.read_related` \| `expense.create` \| `expense.update` \| `expense.review` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses,sales_documents] | แก้ไข คู่ค้า — _Update counterparty_ | `B:UpdateCounterpartyDto` | `→ UpdateCounterpartyUseCase.execute()` |
| 20 | POST | `/v1/companies/:companyId/accounting/counterparties/:counterpartyId/promote-seen-address` | `promote` (L145) | any(`accounting.counterparty.read` \| `accounting.counterparty.manage` \| `expense.read_related` \| `accounting.document.read_related` \| `expense.create` \| `expense.update` \| `expense.review` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses,sales_documents] | เลื่อนขั้น (คู่ค้า) — _Make an address seen on a document the primary one_ | `B:PromoteSeenAddressDto` | `→ PromoteSeenAddressUseCase.execute()` |

**`IncomeExpenseLedgerController`** — `apps/api/src/modules/accounting-documents/presentation/http/income-expense-ledger.controller.ts` · base path: `/v1/companies/:companyId/income-expense-ledger` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 21 | GET | `/v1/companies/:companyId/income-expense-ledger/availability` | `availability` (L25) | any(`accounting.document.create` \| `accounting.quotation.create` \| `accounting.invoice.create` \| `accounting.billing_note.create` \| `accounting.receipt.create` \| `accounting.tax_invoice.create` \| `accounting.counterparty.manage` \| `accounting.quotation.submit_approval`) | ทุกแพ็ก [expenses,sales_documents] | ดู ความพร้อมใช้ (บัญชีแยกประเภท รายจ่าย รายรับ) — _Check whether this deployment accepts new sales roots_ | — | `→ GetSalesDocumentRootAvailabilityUseCase.execute()` |
| 22 | GET | `/v1/companies/:companyId/income-expense-ledger/summary` | `summary` (L32) | any(`accounting.document.read` \| `expense.read`) | ทุกแพ็ก [expenses,sales_documents] | ดู สรุป (บัญชีแยกประเภท รายจ่าย รายรับ) — _Get the permission-aware income and expense ledger summary_ | `Q{from,to}` | `→ IncomeExpenseLedgerUseCase.summary()` |
| 23 | GET | `/v1/companies/:companyId/income-expense-ledger/entries` | `entries` (L39) | any(`accounting.document.read` \| `expense.read`) | ทุกแพ็ก [expenses,sales_documents] | ดู รายการ (บัญชีแยกประเภท รายจ่าย รายรับ) — _List income and expense source entries_ | `Q{type,categoryId,status,from,to,page,pageSize}` | `→ IncomeExpenseLedgerUseCase.entries()` |
| 24 | GET | `/v1/companies/:companyId/income-expense-ledger/export` | `export` (L59) | any(`accounting.document.export` \| `expense.export`) | ทุกแพ็ก [expenses,sales_documents] | ส่งออก (บัญชีแยกประเภท รายจ่าย รายรับ) — _Export the selected ledger sources as CSV and XLSX_ | `Q{type,categoryId,status,from,to}` | `→ IncomeExpenseLedgerUseCase.export()` |

**`RevenueCategoryController`** — `apps/api/src/modules/accounting-documents/presentation/http/revenue-category.controller.ts` · base path: `/v1/companies/:companyId/revenue-categories` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 25 | GET | `/v1/companies/:companyId/revenue-categories` | `listCategories` (L25) | any(`accounting.document.read` \| `accounting.document.read_related`) | ไม่ขาย(sales_documents) | ดูรายการ หมวดหมู่ (หมวดหมู่ รายได้) — _List active revenue categories_ | — | `→ ListRevenueCategoriesUseCase.execute()` |
| 26 | GET | `/v1/companies/:companyId/revenue-categories/manage` | `listAllCategories` (L33) | `accounting.revenue_category.manage` | ไม่ขาย(sales_documents) | ดูรายการ หมวดหมู่ ทั้งหมด — _List all revenue categories (management)_ | — | `→ ListAllRevenueCategoriesUseCase.execute()` |
| 27 | POST | `/v1/companies/:companyId/revenue-categories` | `createCategory` (L40) | `accounting.revenue_category.manage` | ไม่ขาย(sales_documents) | สร้าง หมวดหมู่ (รายได้) — _Create revenue category_ | `B:CreateRevenueCategoryDto` | `→ CreateRevenueCategoryUseCase.execute()` |
| 28 | PATCH | `/v1/companies/:companyId/revenue-categories/:categoryId` | `updateCategory` (L47) | `accounting.revenue_category.manage` | ไม่ขาย(sales_documents) | แก้ไข หมวดหมู่ (รายได้) — _Update revenue category (rename / reorder / retax / archive)_ | `B:UpdateRevenueCategoryDto` | `→ UpdateRevenueCategoryUseCase.execute()` |

**`SimpleIncomeController`** — `apps/api/src/modules/accounting-documents/presentation/http/simple-income.controller.ts` · base path: `/v1/companies/:companyId/accounting/simple-income` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 29 | POST | `/v1/companies/:companyId/accounting/simple-income` | `record` (L14) | any(`accounting.document.create` \| `accounting.invoice.create`) | ไม่ขาย(sales_documents) | บันทึก (รายรับ แบบง่าย) — _Record received income as one atomic invoice, payment, and receipt bundle_ | `B:RecordSimpleIncomeDto` | `→ RecordSimpleIncomeUseCase.execute()` |

### 2.2 โมดูล `ai-draft` — 10 endpoint

**`AiDraftInternalController`** — `apps/api/src/modules/ai-draft/presentation/http/ai-draft-internal.controller.ts` · base path: `/v1/internal/ai/draft-requests` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 30 | POST | `/v1/internal/ai/draft-requests/drain` | `drainQueued` (L23) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน queued (ภายใน ร่าง AI) | `B:{ batchSize?: number }` | `→ DrainDraftRequestsUseCase.execute()` |
| 31 | POST | `/v1/internal/ai/draft-requests/generate` | `generateOne` (L29) | Public — `X-Worker-Token` | แพลตฟอร์ม | สร้าง/ประมวลผล (ภายใน ร่าง AI) | `B:{ companyId: string; requestId: string }` | `→ LaunchShadowProbe.startSweep()` |

**`AiSuggestionController`** — `apps/api/src/modules/ai-draft/presentation/http/ai-suggestion.controller.ts` · base path: `/v1/companies/:companyId/ai/suggestions` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 32 | POST | `/v1/companies/:companyId/ai/suggestions/requests` | `request` (L39) | `ai.suggestion.request` | ทุกแพ็ก [ai_line_assistant] | ร้องขอ (คำแนะนำ AI) — _Request an AI suggestion/draft (web)_ | `B:CreateAiDraftRequestDto` | `→ CreateDraftRequestUseCase.execute()` (201) |
| 33 | GET | `/v1/companies/:companyId/ai/suggestions` | `listSuggestions` (L47) | `ai.suggestion.read_own` | ทุกแพ็ก [ai_line_assistant] | ดูรายการ คำแนะนำ (คำแนะนำ AI) — _List AI suggestions (ABAC-scoped)_ | `Q{scope,status,domain,agent,riskLevel,sourceModule,page,pageSize}` | `→ ListSuggestionsUseCase.execute()` |
| 34 | GET | `/v1/companies/:companyId/ai/suggestions/:id` | `getDetail` (L69) | `ai.suggestion.read_own` | ทุกแพ็ก [ai_line_assistant] | ดูข้อมูล รายละเอียด (คำแนะนำ AI) — _Get AI suggestion detail with citations and candidate actions_ | — | `→ GetSuggestionDetailUseCase.execute()` |
| 35 | POST | `/v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/validate` | `validateAction` (L76) | `ai.draft.review` | ทุกแพ็ก [ai_line_assistant] | ตรวจสอบ การดำเนินการ (คำแนะนำ AI) — _Validate a candidate action against source-module rules (no record created)_ | — | `→ ValidateCandidateActionUseCase.execute()` (200) |
| 36 | POST | `/v1/companies/:companyId/ai/suggestions/:id/actions/:actionId/create-source-draft` | `createDraft` (L84) | `ai.draft.create_source_draft` | ทุกแพ็ก [ai_line_assistant] | สร้าง ร่าง (คำแนะนำ AI) — _Create a source-module draft from a candidate action (web only)_ | `B:CreateSourceDraftDto` | `→ CreateSourceDraftUseCase.execute()` (201) |
| 37 | POST | `/v1/companies/:companyId/ai/suggestions/:id/reviews` | `reviewSuggestion` (L97) | `ai.suggestion.review` | ทุกแพ็ก [ai_line_assistant] | ตรวจทาน คำแนะนำ (AI) — _Record a review decision on an AI suggestion_ | `B:ReviewAiSuggestionDto` | `→ ReviewSuggestionUseCase.execute()` (201) |

**`AiTemplateController`** — `apps/api/src/modules/ai-draft/presentation/http/ai-template.controller.ts` · base path: `/v1/companies/:companyId/ai` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 38 | GET | `/v1/companies/:companyId/ai/suggestion-templates` | `listTemplates` (L16) | `ai.suggestion.read_own` | ทุกแพ็ก [ai_line_assistant] | ดูรายการ แม่แบบ (แม่แบบ AI) — _List AI suggestion templates with availability_ | — | `→ ListTemplatesUseCase.execute()` |
| 39 | GET | `/v1/companies/:companyId/ai/provider-status` | `provider` (L23) | `ai.suggestion.read_own` | ทุกแพ็ก [ai_line_assistant] | ดู ผู้ให้บริการ (แม่แบบ AI) — _Read AI draft provider status_ | — | `→ GetProviderStatusUseCase.execute()` |

### 2.3 โมดูล `audit` — 1 endpoint

**`AuditController`** — `apps/api/src/modules/audit/presentation/audit.controller.ts` · base path: `/v1/companies/:companyId/audit` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 40 | GET | `/v1/companies/:companyId/audit/logs` | `getLogs` (L31) | `audit.log.read` | ทุกแพ็ก | ดูข้อมูล บันทึก (บันทึกตรวจสอบ) — _List audit logs for the current company_ | `Q{page,pageSize,targetType,actorUserId,from,to}` | `Promise<` |

### 2.4 โมดูล `auth` — 65 endpoint

**`AccountEmailOtpController`** — `apps/api/src/modules/auth/presentation/account-email-otp.controller.ts` · base path: `/v1/auth/account/email/otp` · 9 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 41 | GET | `/v1/auth/account/email/otp` | `status` (L42) | `account.session.read` | ทุกแพ็ก | ดู สถานะ (OTP อีเมล บัญชี) | — | `→ AccountEmailOtpService.status()` |
| 42 | GET | `/v1/auth/account/email/otp/:id` | `challenge` (L45) | `account.session.read` | ทุกแพ็ก | ดู challenge (OTP อีเมล บัญชี) | — | `→ AccountEmailOtpService.status()` |
| 43 | POST | `/v1/auth/account/email/otp/login-method` | `loginMethod` (L48) | `account.password.change` | ทุกแพ็ก [company_settings] | เข้าสู่ระบบ วิธี (OTP อีเมล บัญชี) | `B:EmailLoginEnableDto` | `→ AuthRateLimitService.assertEmailOtpUserAllowed()` (200) |
| 44 | POST | `/v1/auth/account/email/otp/request` | `request` (L54) | `account.password.change` | ทุกแพ็ก [company_settings] | ร้องขอ (OTP อีเมล บัญชี) | `B:EmailOtpRequestDto` | `→ AuthRateLimitService.assertEmailOtpIpAllowed()` (202) |
| 45 | POST | `/v1/auth/account/email/otp/:id/resend` | `resend` (L61) | `account.password.change` | ทุกแพ็ก [company_settings] | ส่งซ้ำ (OTP อีเมล บัญชี) | `B:EmailOtpRequestDto` | `→ AuthRateLimitService.assertEmailOtpIpAllowed()` (202) |
| 46 | POST | `/v1/auth/account/email/otp/:id/confirm` | `confirm` (L68) | `account.password.change` | ทุกแพ็ก [company_settings] | ยืนยัน (OTP อีเมล บัญชี) | `B:EmailOtpConfirmDto` | `→ AuthRateLimitService.assertEmailOtpIpAllowed()` (200) |
| 47 | POST | `/v1/auth/account/email/otp/:id/cancel` | `cancel` (L74) | `account.password.change` | ทุกแพ็ก [company_settings] | ยกเลิก (OTP อีเมล บัญชี) | — | `→ AccountEmailOtpService.cancel()` (200) |
| 48 | POST | `/v1/auth/account/email/otp/line-reauth/start` | `beginLine` (L77) | `account.password.change` | ทุกแพ็ก [company_settings] | เริ่ม LINE (OTP อีเมล บัญชี) | — | `→ AuthRateLimitService.assertLineLoginCallbackAllowed()` (200) |
| 49 | POST | `/v1/auth/account/email/otp/line-reauth` | `line` (L83) | `account.password.change` | ทุกแพ็ก [company_settings] | ดำเนินการ LINE (OTP อีเมล บัญชี) | `B:EmailLineReauthDto` | `→ AuthRateLimitService.assertLineLoginCallbackAllowed()` (200) |

**`AuthController`** — `apps/api/src/modules/auth/presentation/auth.controller.ts` · base path: `/v1/auth` · 43 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 50 | GET | `/v1/auth/login-channels` | `loginChannels` (L281) | Public | แพลตฟอร์ม | เข้าสู่ระบบ ช่องทาง (auth) — _Discover configured login channels; unavailable channels fail closed_ | — | — |
| 51 | POST | `/v1/auth/password/login` | `passwordLoginWithCredentials` (L288) | Public — rate limit: `assertPasswordLoginAllowed` | แพลตฟอร์ม | ดำเนินการ การเข้าสู่ระบบ รหัสผ่าน พร้อม ข้อมูลรับรอง — _Sign in with an admin-created username and password_ | `B:PasswordLoginDto` | `→ AuthRateLimitService.assertPasswordLoginAllowed()` (200) |
| 52 | POST | `/v1/auth/password/reset-request` | `requestPasswordResetNotice` (L328) | Public — rate limit: `assertPasswordResetRequestAllowed` | แพลตฟอร์ม | ร้องขอ ประกาศ การรีเซ็ต รหัสผ่าน — _Send a one-time recovery password to the account's linked LINE identity_ | `B:PasswordResetRequestDto` | `→ AuthRateLimitService.assertPasswordResetRequestAllowed()` (200) |
| 53 | POST | `/v1/auth/dev/token` | `devToken` (L346) | Public — ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | แพลตฟอร์ม | ดำเนินการ token dev — _Issue dev token (local only)_ | `B:DevTokenDto` | `→ IssueTokenUseCase.execute()` (200) |
| 54 | POST | `/v1/auth/line/exchange` | `lineExchange` (L390) | Public | แพลตฟอร์ม | ดำเนินการ การแลก token LINE — _Exchange LINE Login ID token for WatchDog access token_ | `B:LineExchangeDto` | — (200) |
| 55 | POST | `/v1/auth/line/login/callback` | `lineLoginCallback` (L403) | Public — rate limit: `assertLineLoginCallbackAllowed` | แพลตฟอร์ม | ดำเนินการ callback การเข้าสู่ระบบ LINE — _Complete LINE web login: exchange OAuth code, verify ID token, issue first-party tokens_ | `B:LineLoginCallbackDto` | `→ AuthRateLimitService.assertLineLoginCallbackAllowed()` (200) |
| 56 | POST | `/v1/auth/line/qr/create` | `lineQrCreate` (L422) | Public — rate limit: `assertLineQrCreateAllowed` | แพลตฟอร์ม | ดำเนินการ การสร้าง QR LINE — _Mint a desktop QR login transaction; returns the QR and the browser-bound secret_ | `B:LineQrCreateDto` | `→ AuthRateLimitService.assertLineQrCreateAllowed()` (200) |
| 57 | POST | `/v1/auth/line/qr/redeem` | `lineQrRedeem` (L436) | Public — rate limit: `assertLineQrPollAllowed` | แพลตฟอร์ม | ดำเนินการ การแลกใช้ QR LINE — _Poll a desktop QR transaction; issues first-party tokens once approved_ | `B:LineQrRedeemDto` | `→ AuthRateLimitService.assertLineQrPollAllowed()` (200) |
| 58 | POST | `/v1/auth/line/qr/approve` | `lineQrApprove` (L452) | `account.session.read` | ทุกแพ็ก | ดำเนินการ การอนุมัติ QR LINE — _Approve a scanned desktop QR login for the current user_ | `B:LineQrApproveDto` | `→ ApproveLineWebLoginTransactionUseCase.execute()` (200) |
| 59 | POST | `/v1/auth/line/handoff/exchange` | `lineHandoffExchange` (L476) | Public — rate limit: `assertLineHandoffExchangeAllowed` | แพลตฟอร์ม | ดำเนินการ การแลก token การส่งต่อ LINE — _Exchange a single-use LINE deep-link handoff token for a first-party session_ | `B:LineHandoffExchangeDto` | `→ AuthRateLimitService.assertLineHandoffExchangeAllowed()` (200) |
| 60 | GET | `/v1/auth/line/link-page` | `lineLinkPage` (L492) | Public — ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | แพลตฟอร์ม | ดู หน้า ลิงก์/การผูก LINE — _Local LIFF account-link page_ | — | `string` |
| 61 | GET | `/v1/auth/line/link-page.js` | `lineLinkPageScript` (L520) | Public | แพลตฟอร์ม | ดู สคริปต์ หน้า ลิงก์/การผูก LINE — _Static same-origin LIFF account-link client_ | `Q{v}` | `string` |
| 62 | GET | `/v1/auth/line/link-page/package-advisor`<br>`/v1/auth/line/package-advisor-page` | `linePackageAdvisorPage` (L530) | Public | แพลตฟอร์ม | ดู หน้า ที่ปรึกษา แพ็กเกจ LINE — _Read-only LIFF package advisor using the public catalog_ | — | `string` |
| 63 | GET | `/v1/auth/line/package-advisor.js` | `linePackageAdvisorScript` (L551) | Public | แพลตฟอร์ม | ดู สคริปต์ ที่ปรึกษา แพ็กเกจ LINE | — | `string` |
| 64 | GET | `/v1/auth/line/link-page/signup`<br>`/v1/auth/line/signup-page` | `lineSignupPage` (L567) | Public | แพลตฟอร์ม | ดู หน้า การสมัคร LINE — _LIFF signup page for a LINE-first company application (P10-L §3.2)_ | — | `string` |
| 65 | GET | `/v1/auth/line/link-page/start`<br>`/v1/auth/line/start-page` | `lineStartPage` (L692) | Public | แพลตฟอร์ม | ดู หน้า การเริ่ม LINE — _LIFF start page: exchange a LINE identity for a web session (P10-L §3.5)_ | — | `string` |
| 66 | GET | `/v1/auth/line/link-page/event-discount` | `lineEventDiscountPage` (L724) | Public | แพลตฟอร์ม | ดู หน้า ส่วนลด เหตุการณ์ LINE — _LIFF page: claim a sales-event discount after scanning a booth QR (sales-event spec §3.3)_ | — | `string` |
| 67 | POST | `/v1/auth/line/liff/session` | `lineLiffSession` (L746) | Public — LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ เซสชัน LIFF LINE — _Exchange a LIFF ID token for a one-time web handoff URL (P10-L §3.5)_ | `B:LiffSessionDto` | `ExchangeLiffSessionResult` (200) |
| 68 | POST | `/v1/auth/line/link` | `lineLink` (L787) | `account.identity.link` | ทุกแพ็ก [company_settings] | ดำเนินการ ลิงก์/การผูก LINE — _Link LINE identity to current user_ | `B:LineLinkDto` | `→ LinkLineIdentityUseCase.execute()` (200) |
| 69 | POST | `/v1/auth/line/link/oauth` | `lineLinkOauth` (L805) | `account.identity.link` | ทุกแพ็ก [company_settings] | ดำเนินการ OAuth ลิงก์/การผูก LINE — _Link LINE identity to current user from a web OAuth code (P12-2)_ | `B:LineLoginCallbackDto` | `→ AuthRateLimitService.assertLineLoginCallbackAllowed()` (200) |
| 70 | POST | `/v1/auth/account-merge` | `accountMerge` (L829) | `account.identity.link` | ทุกแพ็ก [company_settings] | ดำเนินการ merge บัญชี — _Merge this account into the one that owns the conflicting LINE identity (spec §4F)_ | `B:AccountMergeDto` | `→ AuthRateLimitService.assertLineLoginCallbackAllowed()` (200) |
| 71 | POST | `/v1/auth/account-merge/preview` | `accountMergePreview` (L851) | `account.identity.link` | ทุกแพ็ก [company_settings] | ดำเนินการ ตัวอย่าง merge บัญชี — _What merging into the LINE-owning account would do (spec §4F)_ | `B:AccountMergeDto` | `→ AuthRateLimitService.assertAccountMergePreviewAllowed()` (200) |
| 72 | GET | `/v1/auth/line/link-page/employee`<br>`/v1/auth/line/employee-link-page` | `employeeLineLinkPage` (L867) | Public | แพลตฟอร์ม | ดู หน้า ลิงก์/การผูก LINE พนักงาน — _Employee-specific LIFF account-link page (no prior WatchDog session required)_ | — | `string` |
| 73 | POST | `/v1/auth/line/employee-link` | `employeeLineLink` (L894) | Public — LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ ลิงก์/การผูก LINE พนักงาน — _Complete employee LINE account link using a short-lived link token_ | `B:EmployeeLineLinkDto` | `→ CompleteEmployeeLineLinkUseCase.execute()` (200) |
| 74 | POST | `/v1/auth/line/unlink` | `lineUnlink` (L908) | `account.identity.unlink` | ทุกแพ็ก [company_settings] | ดำเนินการ การยกเลิกผูก LINE — _Unlink LINE identity from current user_ | — | `→ UnlinkLineIdentityUseCase.execute()` (200) |
| 75 | POST | `/v1/auth/password/change` | `changeCurrentPassword` (L918) | `account.password.change` | ทุกแพ็ก [company_settings] | เปลี่ยน รหัสผ่าน ปัจจุบัน — _Change current user password_ | `B:ChangePasswordDto` | `void` (204) |
| 76 | GET | `/v1/auth/account/security` | `accountSecurityState` (L933) | `account.session.read` | ทุกแพ็ก | ดู สถานะ ความปลอดภัย บัญชี — _Return email verification state for the current user_ | — | `→ GetAccountSecurityStateUseCase.execute()` |
| 77 | POST | `/v1/auth/account/ai-assistant` | `setAiAssistantPreference` (L943) | `account.password.change` | ทุกแพ็ก [company_settings] | ตั้งค่า ค่ากำหนด ผู้ช่วย AI — _Enable or disable the LINE AI assistant for the current user_ | `B:SetAiAssistantPreferenceDto` | `void` (204) |
| 78 | POST | `/v1/auth/account/email` | `requestAccountEmailChange` (L956) | `account.password.change` | ทุกแพ็ก [company_settings] | ร้องขอ การเปลี่ยนแปลง อีเมล บัญชี — _Request an email change and send a verification link_ | `B:RequestEmailChangeDto` | — (202) |
| 79 | POST | `/v1/auth/account/email/resend` | `resendAccountEmailVerification` (L969) | `account.session.read` | ทุกแพ็ก | ส่งซ้ำ การยืนยัน อีเมล บัญชี — _Resend the latest pending email verification link_ | — | — (202) |
| 80 | POST | `/v1/auth/account/email/verify` | `verifyAccountEmail` (L979) | Public | แพลตฟอร์ม | ตรวจยืนยัน อีเมล บัญชี — _Confirm a pending email verification token_ | `B:VerifyEmailDto` | — (200) |
| 81 | POST | `/v1/auth/session/refresh` | `refresh` (L989) | Public | แพลตฟอร์ม | รีเฟรช (auth) — _Refresh access token using refresh token_ | `B:RefreshDto` | `→ RefreshSessionUseCase.execute()` (200) |
| 82 | POST | `/v1/auth/logout` | `logoutSession` (L999) | `account.session.read` | ทุกแพ็ก | ออกจากระบบ เซสชัน (auth) — _Revoke current session_ | — | `void` (204) |
| 83 | POST | `/v1/auth/sessions/revoke-others` | `revokeOtherActiveSessions` (L1010) | `account.session.read` | ทุกแพ็ก | เพิกถอน เซสชัน ที่ใช้งานอยู่ อื่น — _Revoke all active sessions except the current session_ | — | `→ RevokeOtherSessionsUseCase.execute()` (200) |
| 84 | GET | `/v1/auth/legal-acceptance` | `legalAcceptanceStatus` (L1025) | `account.session.read` | ทุกแพ็ก | ดู สถานะ การยอมรับ ข้อตกลงทางกฎหมาย — _Return the current Terms acceptance and Privacy Notice acknowledgment status_ | — | `→ LegalAcceptanceService.getStatus()` |
| 85 | POST | `/v1/auth/legal-acceptance` | `acceptLegalDocuments` (L1033) | `account.session.read` | ทุกแพ็ก | ยอมรับ เอกสาร ข้อตกลงทางกฎหมาย — _Accept the current Terms and acknowledge the current Privacy Notice_ | `B:AcceptLegalDocumentsDto` | `→ LegalAcceptanceService.accept()` (200) |
| 86 | GET | `/v1/auth/me` | `me` (L1056) | `account.session.read` | ทุกแพ็ก | ดู ข้อมูลตนเอง (auth) — _Return current authenticated context_ | — | `→ LegalAcceptanceService.getStatus()` |
| 87 | GET | `/v1/auth/account/display-name` | `displayNameHistory` (L1118) | `account.session.read` | ทุกแพ็ก | ดู ประวัติ ชื่อ การแสดงผล | `Q{companyId,userId}` | `→ AccountProfileUseCase.displayNameHistory()` |
| 88 | PATCH | `/v1/auth/account/display-name` | `setMyDisplayName` (L1124) | `account.session.read` | ทุกแพ็ก | ตั้งค่า ชื่อ การแสดงผล ของฉัน | `B:SetMyDisplayNameDto` | `→ AuthRateLimitService.assertAccountProfileWriteAllowed()` |
| 89 | PATCH | `/v1/auth/me/contact` | `setMyContact` (L1131) | `account.password.change` | ทุกแพ็ก [company_settings] | ตั้งค่า ข้อมูลติดต่อ ของฉัน — _Set or clear the current user recovery phone number_ | `B:SetMyContactDto` | `→ AuthRateLimitService.assertAccountProfileWriteAllowed()` (200) |
| 90 | POST | `/v1/auth/me/password/set` | `setMyFirstPassword` (L1142) | `account.password.change` | ทุกแพ็ก [company_settings] | ตั้งค่า รหัสผ่าน แรก ของฉัน — _Set the first password for an account that has none_ | `B:SetFirstPasswordDto` | `→ AuthRateLimitService.assertAccountProfileWriteAllowed()` (200) |
| 91 | POST | `/v1/auth/me/email/unverified` | `setMyUnverifiedEmail` (L1161) | `account.password.change` | ทุกแพ็ก [company_settings] | ตั้งค่า อีเมล ที่ยังไม่ยืนยัน ของฉัน — _Correct a LINE-linked account unverified email without email delivery_ | `B:SetUnverifiedEmailDto` | — (200) |
| 92 | GET | `/v1/auth/me/companies` | `myCompanies` (L1170) | `account.session.read` | ทุกแพ็ก | ดู บริษัท ของฉัน — _List active company memberships of the current user_ | — | — |

**`EmailPasswordResetController`** — `apps/api/src/modules/auth/presentation/email-password-reset.controller.ts` · base path: `/v1/auth/password` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 93 | POST | `/v1/auth/password/email-reset-request` | `request` (L19) | Public — rate limit: `assertPasswordResetRequestAllowed` | แพลตฟอร์ม | ร้องขอ (การรีเซ็ต รหัสผ่าน อีเมล) | `B:PasswordResetRequestDto` | `→ AuthRateLimitService.assertPasswordResetRequestAllowed()` (200) |
| 94 | POST | `/v1/auth/password/email-reset-confirm` | `confirm` (L24) | Public — rate limit: `assertPasswordResetConfirmAllowed` | แพลตฟอร์ม | ยืนยัน (การรีเซ็ต รหัสผ่าน อีเมล) | `B:EmailPasswordResetConfirmDto` | `→ AuthRateLimitService.assertPasswordResetConfirmAllowed()` (200) |

**`LineOfficialWebhookController`** — `apps/api/src/modules/auth/presentation/line-official-webhook.controller.ts` · base path: `/v1/line/official` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 95 | POST | `/v1/line/official/webhook` | `webhook` (L23) | Public — `x-line-signature` (HMAC-SHA256 ของ raw body) | แพลตฟอร์ม | ดำเนินการ webhook (OA ทางการ LINE) | `B:raw(req.body)` | `Record<string, never>` (200) |

**`LineWebhookController`** — `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` · base path: `/v1/` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 96 | POST | `/v1/line/webhook` | `lineWebhook` (L24) | Public — `x-line-signature` (HMAC-SHA256 ของ raw body) | แพลตฟอร์ม | ดำเนินการ webhook LINE — _LINE Messaging API webhook receiver_ | — | `Record<string, never>` (200) |
| 97 | POST | `/v1/webhooks/line` | `legacyLineWebhook` (L34) | Public — `x-line-signature` (HMAC-SHA256 ของ raw body) | แพลตฟอร์ม | ดำเนินการ webhook LINE แบบเดิม — _LINE Messaging API webhook receiver (legacy path)_ | `B:raw(req.body)` | `Record<string, never>` (200) |

**`PublicPlatformAccessController`** — `apps/api/src/modules/auth/presentation/platform-access.controller.ts` · base path: `/v1/auth/platform-access` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 98 | GET | `/v1/auth/platform-access` | `status` (L18) | Public | แพลตฟอร์ม | ดู สถานะ (การเข้าถึง แพลตฟอร์ม สาธารณะ) | — | `→ PlatformAccessService.getStatus()` |

**`SystemPlatformAccessController`** — `apps/api/src/modules/auth/presentation/platform-access.controller.ts` · base path: `/v1/system/platform-access` · สิทธิ์ระดับ class: `system.launch_gate.manage` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 99 | GET | `/v1/system/platform-access` | `status` (L30) | `system.launch_gate.manage` | แพลตฟอร์ม | ดู สถานะ (การเข้าถึง แพลตฟอร์ม ระบบ) | — | `→ PlatformAccessService.getStatus()` |
| 100 | PUT | `/v1/system/platform-access` | `update` (L35) | `system.launch_gate.manage` | แพลตฟอร์ม | แก้ไข (การเข้าถึง แพลตฟอร์ม ระบบ) | `B:SetPlatformAccessDto` | `→ PlatformAccessService.setState()` |

**`PostmarkEventsController`** — `apps/api/src/modules/auth/presentation/postmark-events.controller.ts` · base path: `/v1/public/postmark-events` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 101 | POST | `/v1/public/postmark-events` | `receive` (L10) | Public — `Authorization` Basic (Postmark) | แพลตฟอร์ม | รับ (เหตุการณ์ Postmark) | `B:raw(req.body)` | `→ PostmarkEventsService.receive()` (200) |

**`SystemEmailDeliveryController`** — `apps/api/src/modules/auth/presentation/system-email-delivery.controller.ts` · base path: `/v1/system/email-delivery` · สิทธิ์ระดับ class: `system.email_delivery.read` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 102 | GET | `/v1/system/email-delivery` | `history` (L28) | `system.email_delivery.read` | แพลตฟอร์ม | ดู ประวัติ (การนำส่ง อีเมล ระบบ) | `Q:SystemEmailHistoryQueryDto` | `→ SystemEmailDeliveryService.history()` |
| 103 | GET | `/v1/system/email-delivery/connection` | `connection` (L34) | `system.email_delivery.read` | แพลตฟอร์ม | ดู การเชื่อมต่อ (การนำส่ง อีเมล ระบบ) | `Q:Record<string` | `→ SystemEmailDeliveryService.connection()` |
| 104 | GET | `/v1/system/email-delivery/retention` | `retention` (L40) | `system.email_delivery.read` | แพลตฟอร์ม | ดู การเก็บรักษา (การนำส่ง อีเมล ระบบ) | `Q:Record<string` | `→ SystemEmailDeliveryService.retention()` |
| 105 | PUT | `/v1/system/email-delivery/retention` | `setRetention` (L47) | `system.email_delivery.read` + `system.email_delivery.manage` | แพลตฟอร์ม | ตั้งค่า การเก็บรักษา (การนำส่ง อีเมล ระบบ) | `B:EmailHistoryPolicyDto` `Q:Record<string` | `→ SystemEmailDeliveryService.setRetention()` |

### 2.5 โมดูล `banking` — 29 endpoint

**`AdjustmentController`** — `apps/api/src/modules/banking/presentation/http/adjustment.controller.ts` · base path: `/v1/companies/:companyId/banking/adjustments` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 106 | GET | `/v1/companies/:companyId/banking/adjustments` | `list` (L28) | `bank.adjustment.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ (รายการปรับปรุง) — _List bank adjustments_ | — | `→ ListBankAdjustmentsUseCase.execute()` |
| 107 | GET | `/v1/companies/:companyId/banking/adjustments/:id` | `getOne` (L35) | `bank.adjustment.read` | ไม่ขาย(bank_reconciliation) | ดูข้อมูล (รายการปรับปรุง) — _Get bank adjustment by id_ | — | `→ GetBankAdjustmentUseCase.execute()` |
| 108 | POST | `/v1/companies/:companyId/banking/adjustments` | `create` (L42) | `bank.adjustment.create` | ไม่ขาย(bank_reconciliation) | สร้าง (รายการปรับปรุง) — _Create bank adjustment draft_ | `B:CreateBankAdjustmentDto` | `→ CreateBankAdjustmentUseCase.execute()` |
| 109 | POST | `/v1/companies/:companyId/banking/adjustments/:id/submit` | `submit` (L49) | `bank.adjustment.create` | ไม่ขาย(bank_reconciliation) | ส่ง (รายการปรับปรุง) — _Submit bank adjustment for approval_ | — | `→ SubmitBankAdjustmentUseCase.execute()` (200) |
| 110 | POST | `/v1/companies/:companyId/banking/adjustments/:id/approve` | `approve` (L57) | `bank.adjustment.approve` | ไม่ขาย(bank_reconciliation) | อนุมัติ (รายการปรับปรุง) — _Approve bank adjustment_ | `B:{ ledgerDebitAccountId: string; ledgerCreditAccountId: string }` | `→ ApproveBankAdjustmentUseCase.execute()` (200) |
| 111 | POST | `/v1/companies/:companyId/banking/adjustments/:id/void` | `void` (L69) | `bank.adjustment.void` | ไม่ขาย(bank_reconciliation) | ยกเลิก (void) (รายการปรับปรุง) — _Void bank adjustment_ | `B:{ reason: string }` | `→ VoidBankAdjustmentUseCase.execute()` (200) |

**`BankAccountController`** — `apps/api/src/modules/banking/presentation/http/bank-account.controller.ts` · base path: `/v1/companies/:companyId/banking/bank-accounts` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 112 | GET | `/v1/companies/:companyId/banking/bank-accounts` | `list` (L26) | `bank.account.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ (บัญชี ธนาคาร) — _List bank accounts_ | — | `→ ListBankAccountsUseCase.execute()` |
| 113 | GET | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | `getOne` (L33) | `bank.account.read` | ไม่ขาย(bank_reconciliation) | ดูข้อมูล (บัญชี ธนาคาร) — _Get bank account by id_ | — | `→ GetBankAccountUseCase.execute()` |
| 114 | POST | `/v1/companies/:companyId/banking/bank-accounts` | `create` (L40) | `bank.account.manage` | ไม่ขาย(bank_reconciliation) | สร้าง (บัญชี ธนาคาร) — _Create bank account_ | `B:CreateBankAccountDto` | `→ CreateBankAccountUseCase.execute()` |
| 115 | PATCH | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId` | `update` (L47) | `bank.account.manage` | ไม่ขาย(bank_reconciliation) | แก้ไข (บัญชี ธนาคาร) — _Update bank account_ | `B:UpdateBankAccountDto` | `→ UpdateBankAccountUseCase.execute()` |
| 116 | POST | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/deactivate` | `deactivate` (L54) | `bank.account.manage` | ไม่ขาย(bank_reconciliation) | ปิดใช้งาน (บัญชี ธนาคาร) — _Deactivate bank account_ | — | `→ DeactivateBankAccountUseCase.execute()` (200) |

**`MatchingController`** — `apps/api/src/modules/banking/presentation/http/matching.controller.ts` · base path: `/v1/companies/:companyId/banking` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 117 | GET | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/match-candidates` | `listCandidates` (L25) | `bank.match.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ ตัวเลือก (การจับคู่) — _List match candidates for a bank account_ | — | `→ ListMatchCandidatesUseCase.execute()` |
| 118 | POST | `/v1/companies/:companyId/banking/statement-lines/:statementLineId/matches` | `confirm` (L32) | `bank.match.confirm` | ไม่ขาย(bank_reconciliation) | ยืนยัน (การจับคู่) — _Confirm a match for a statement line_ | `B:{ sourceType: string; sourceId: string; sourceDisplayNumber?: string; allocatedAmount: string; currency: string; overrideReason?: string }` | `→ ConfirmMatchUseCase.execute()` |
| 119 | POST | `/v1/companies/:companyId/banking/matches/:matchId/reject` | `reject` (L43) | `bank.match.confirm` | ไม่ขาย(bank_reconciliation) | ปฏิเสธ (การจับคู่) — _Reject a match_ | `B:{ reason: string }` | `→ RejectMatchUseCase.execute()` (200) |
| 120 | POST | `/v1/companies/:companyId/banking/matches/:matchId/void` | `void` (L55) | `bank.match.unmatch` | ไม่ขาย(bank_reconciliation) | ยกเลิก (void) (การจับคู่) — _Void a confirmed match_ | — | `→ VoidMatchUseCase.execute()` (200) |
| 121 | POST | `/v1/companies/:companyId/banking/statement-lines/:statementLineId/ignore` | `ignore` (L63) | `bank.match.override` | ไม่ขาย(bank_reconciliation) | ข้าม/เพิกเฉย (การจับคู่) — _Ignore a statement line_ | `B:{ reason: string }` | `→ IgnoreStatementLineUseCase.execute()` (200) |

**`ReconciliationController`** — `apps/api/src/modules/banking/presentation/http/reconciliation.controller.ts` · base path: `/v1/companies/:companyId/banking` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 122 | GET | `/v1/companies/:companyId/banking/reconciliations` | `list` (L28) | `bank.reconciliation.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ (การกระทบยอด) — _List reconciliation sessions_ | — | `→ ListReconciliationSessionsUseCase.execute()` |
| 123 | POST | `/v1/companies/:companyId/banking/reconciliations` | `create` (L35) | `bank.reconciliation.create` | ไม่ขาย(bank_reconciliation) | สร้าง (การกระทบยอด) — _Create reconciliation session_ | `B:CreateReconciliationSessionDto` | `→ CreateReconciliationSessionUseCase.execute()` |
| 124 | GET | `/v1/companies/:companyId/banking/reconciliations/:sessionId` | `getOne` (L42) | `bank.reconciliation.read` | ไม่ขาย(bank_reconciliation) | ดูข้อมูล (การกระทบยอด) — _Get reconciliation session by id_ | — | `→ GetReconciliationSessionUseCase.execute()` |
| 125 | POST | `/v1/companies/:companyId/banking/reconciliations/:sessionId/complete` | `complete` (L49) | `bank.reconciliation.complete` | ไม่ขาย(bank_reconciliation) | ยืนยันเสร็จสิ้น (การกระทบยอด) — _Complete reconciliation session_ | `B:{ snapshotLines?: Array<{ statementLineId: string; statusAtCompletion: string; matchedAmountAtCompletion: string; ignoredReasonAtCompletion?: string }> }` | `→ CompleteReconciliationSessionUseCase.execute()` (200) |
| 126 | POST | `/v1/companies/:companyId/banking/reconciliations/:sessionId/reopen` | `reopen` (L61) | `bank.reconciliation.reopen` | ไม่ขาย(bank_reconciliation) | เปิดใหม่ (การกระทบยอด) — _Reopen completed reconciliation session_ | `B:{ reason: string }` | `→ ReopenReconciliationSessionUseCase.execute()` (200) |
| 127 | GET | `/v1/companies/:companyId/banking/cash-position` | `cashPosition` (L73) | `bank.cash.read` | ไม่ขาย(bank_reconciliation) | ดู ตำแหน่ง เงินสด — _Get cash position summary_ | — | `→ GetCashPositionUseCase.execute()` |

**`StatementController`** — `apps/api/src/modules/banking/presentation/http/statement.controller.ts` · base path: `/v1/companies/:companyId/banking` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 128 | POST | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/extract` | `extract` (L30) | `bank.statement.import` | ไม่ขาย(bank_reconciliation) | สกัดข้อมูล (รายการเดินบัญชี) — _Extract statement rows from a PDF or photo (spec §20)_ | `B:{ fileBase64: string; mimeType: string; fileName: string }` | `→ ExtractStatementFileUseCase.execute()` (200) |
| 129 | GET | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | `listLines` (L42) | `bank.statement.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ รายการย่อย (รายการเดินบัญชี) — _List statement lines for a bank account_ | `Q{status}` | `→ ListStatementLinesUseCase.execute()` |
| 130 | GET | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports` | `listImports` (L53) | `bank.statement.read` | ไม่ขาย(bank_reconciliation) | ดูรายการ การนำเข้า (รายการเดินบัญชี) — _List statement imports for a bank account_ | — | `→ ListStatementImportsUseCase.execute()` |
| 131 | POST | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/preview` | `preview` (L63) | `bank.statement.import` | ไม่ขาย(bank_reconciliation) | ดูตัวอย่าง (รายการเดินบัญชี) — _Preview statement import_ | `B:{ rows: any[]; preset?: string; timezone?: string }` | `→ PreviewStatementImportUseCase.execute()` (200) |
| 132 | POST | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-imports/commit` | `commit` (L75) | `bank.statement.import` | ไม่ขาย(bank_reconciliation) | ยืนยันบันทึก (รายการเดินบัญชี) — _Commit statement import_ | `B:{       rows: any[];       preset?: string;       originalFileName?: string;       fileHash?: string;       duplicatePolicy?: 'skip' \| 'flag';       provenance?: {         sourceKind: BankStatementExtractionSourceKind;         extractionModelId?: string;         extractionModelLineage?: AiModelLineage[];       };     }` | `→ CommitStatementImportUseCase.execute()` |
| 133 | POST | `/v1/companies/:companyId/banking/bank-accounts/:bankAccountId/statement-lines` | `createManualLine` (L97) | `bank.statement.manual_line` | ไม่ขาย(bank_reconciliation) | สร้าง LINE แบบกรอกเอง — _Create manual statement line_ | `B:CreateManualStatementLineDto` | `→ CreateManualStatementLineUseCase.execute()` |
| 134 | POST | `/v1/companies/:companyId/banking/statement-imports/:importId/void` | `void` (L108) | `bank.statement.void` | ไม่ขาย(bank_reconciliation) | ยกเลิก (void) (รายการเดินบัญชี) — _Void statement import_ | `B:{ reason: string }` | `→ VoidStatementImportUseCase.execute()` (200) |

### 2.6 โมดูล `billing` — 143 endpoint

**`BillingCatalogController`** — `apps/api/src/modules/billing/presentation/billing.controller.ts` · base path: `/v1/billing` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 135 | GET | `/v1/billing/catalog` | `catalog` (L81) | Public | แพลตฟอร์ม | ดู แค็ตตาล็อก (การเรียกเก็บเงิน) | — | `→ BillingService.catalog()` |

**`BillingAdminController`** — `apps/api/src/modules/billing/presentation/billing.controller.ts` · base path: `/v1/system/billing` · 112 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 136 | GET | `/v1/system/billing/companies/:id/plan-adjustments` | `planAdjustmentList` (L88) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการ รายการปรับปรุง แพ็ก/แผน | `Q:unknown` | `→ BillingPlanAdjustmentsService.list()` |
| 137 | POST | `/v1/system/billing/companies/:id/plan-adjustments/preview` | `planAdjustmentPreview` (L91) | `system.billing.financial.read` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง รายการปรับปรุง แพ็ก/แผน | `B:BillingPlanAdjustmentDto` | `→ BillingPlanAdjustmentsService.preview()` (200) |
| 138 | GET | `/v1/system/billing/plan-adjustments/:id` | `planAdjustmentGet` (L94) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการปรับปรุง แพ็ก/แผน | `Q:unknown` | `→ BillingPlanAdjustmentsService.get()` |
| 139 | POST | `/v1/system/billing/plan-adjustments/:id/:action` | `planAdjustmentCommand` (L96) | `system.billing.financial.read` | แพลตฟอร์ม | ดำเนินการ คำสั่ง รายการปรับปรุง แพ็ก/แผน | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingPlanAdjustmentsService.command()` (200) |
| 140 | GET | `/v1/system/billing/companies/:id/receipt-adjustments` | `receiptAdjustmentList` (L101) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการ รายการปรับปรุง ใบเสร็จ | `Q:unknown` | `→ BillingReceiptAdjustmentsService.list()` |
| 141 | POST | `/v1/system/billing/companies/:id/receipt-adjustments/preview` | `receiptAdjustmentPreview` (L104) | `system.billing.override.manage` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง รายการปรับปรุง ใบเสร็จ | `B:BillingReceiptAdjustmentDto` | `→ BillingReceiptAdjustmentsService.preview()` (200) |
| 142 | GET | `/v1/system/billing/receipt-adjustments/:id` | `receiptAdjustmentGet` (L107) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการปรับปรุง ใบเสร็จ | `Q:unknown` | `→ BillingReceiptAdjustmentsService.get()` |
| 143 | POST | `/v1/system/billing/receipt-adjustments/:id/:action` | `receiptAdjustmentCommand` (L109) | `system.billing.financial.read` | แพลตฟอร์ม | ดำเนินการ คำสั่ง รายการปรับปรุง ใบเสร็จ | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingReceiptAdjustmentsService.command()` (200) |
| 144 | GET | `/v1/system/billing/companies/:id/credits` | `addOnCredits` (L116) | `system.billing.financial.read` | แพลตฟอร์ม | ดู เครดิต add-on | `Q:unknown` | `→ BillingAddOnAdminGrantsService.list()` |
| 145 | POST | `/v1/system/billing/companies/:id/credit-grants/preview` | `addOnGrantPreview` (L119) | `system.billing.override.manage` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง สิทธิ์ที่ให้ add-on | `B:BillingAddOnGrantDto` | `→ BillingAddOnAdminGrantsService.preview()` (200) |
| 146 | GET | `/v1/system/billing/credit-grants/:id` | `addOnGrantGet` (L122) | `system.billing.financial.read` | แพลตฟอร์ม | ดู สิทธิ์ที่ให้ add-on | `Q:unknown` | `→ BillingAddOnAdminGrantsService.get()` |
| 147 | POST | `/v1/system/billing/credit-grants/:id/:action` | `addOnGrantCommand` (L124) | `system.billing.financial.read` | แพลตฟอร์ม | ดำเนินการ คำสั่ง สิทธิ์ที่ให้ add-on | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingAddOnAdminGrantsService.command()` (200) |
| 148 | GET | `/v1/system/billing/batches` | `batchList` (L129) | `system.billing.read` | แพลตฟอร์ม | ดู รายการ ชุดงาน | `Q:unknown` | `→ BillingBatchesService.list()` |
| 149 | POST | `/v1/system/billing/batches/preview` | `batchPreview` (L131) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง ชุดงาน | `B:BillingBatchDto` | `→ BillingBatchesService.preview()` (200) |
| 150 | GET | `/v1/system/billing/batches/:id` | `batchGet` (L133) | `system.billing.read` | แพลตฟอร์ม | ดู ชุดงาน | `Q:unknown` | `→ BillingBatchesService.get()` |
| 151 | GET | `/v1/system/billing/batches/:id/export` | `batchExport` (L135) | `system.billing.export` | แพลตฟอร์ม | ดู การส่งออก ชุดงาน | `Q:unknown` | `→ BillingBatchesService.export()` |
| 152 | POST | `/v1/system/billing/batches/:id/:action` | `batchCommand` (L137) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ คำสั่ง ชุดงาน | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingBatchesService.submit()` (200) |
| 153 | GET | `/v1/system/billing/companies/:id/checkouts` | `checkoutAttempts` (L143) | `system.billing.read` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) ความพยายามชำระ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingCheckoutExpiryService.attempts()` |
| 154 | GET | `/v1/system/billing/companies/:id/checkouts/:attemptId` | `checkoutReview` (L145) | `system.billing.read` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) การตรวจทาน (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingCheckoutExpiryService.review()` |
| 155 | POST | `/v1/system/billing/companies/:id/checkouts/:attemptId/preview` | `checkoutPreview` (L147) | `system.billing.gate.manage` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) ตัวอย่าง (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingEventPreviewDto` | `→ BillingCheckoutExpiryService.preview()` (200) |
| 156 | GET | `/v1/system/billing/companies/:id/checkouts/:attemptId/requests` | `checkoutRequests` (L150) | `system.billing.read` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) คำขอ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingCheckoutExpiryService.history()` |
| 157 | GET | `/v1/system/billing/checkout-expiry/:id` | `checkoutExpiryGet` (L152) | `system.billing.read` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) วันหมดอายุ | `Q:unknown` | `→ BillingCheckoutExpiryService.get()` |
| 158 | POST | `/v1/system/billing/checkout-expiry/:id/:action` | `checkoutExpiryCommand` (L154) | `system.billing.gate.manage` | แพลตฟอร์ม | เริ่มชำระเงิน (checkout) คำสั่ง วันหมดอายุ | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingCheckoutExpiryService.run()` (200) |
| 159 | GET | `/v1/system/billing/settlements` | `settlementList` (L161) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการ การชำระบัญชี | `Q:unknown` | `→ BillingSettlementService.list()` |
| 160 | POST | `/v1/system/billing/settlements` | `settlementCreate` (L163) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ การสร้าง การชำระบัญชี | `B:BillingProviderScanDto` `H:idempotency-key` | `→ BillingSettlementService.create()` (200) |
| 161 | GET | `/v1/system/billing/settlements/:id` | `settlementGet` (L168) | `system.billing.financial.read` | แพลตฟอร์ม | ดู การชำระบัญชี | `Q:unknown` | `→ BillingSettlementService.get()` |
| 162 | GET | `/v1/system/billing/settlements/:id/findings` | `settlementFindings` (L170) | `system.billing.financial.read` | แพลตฟอร์ม | ดู ข้อค้นพบ การชำระบัญชี | `Q:unknown` | `→ BillingSettlementService.findings()` |
| 163 | POST | `/v1/system/billing/settlements/:id/:action` | `settlementAction` (L172) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ การดำเนินการ การชำระบัญชี | `B:BillingVersionDto` | `→ BillingSettlementService.action()` (200) |
| 164 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/refund-review` | `refundReview` (L177) | `system.billing.financial.read` | แพลตฟอร์ม | คืนเงิน การตรวจทาน (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingRefundsService.review()` |
| 165 | POST | `/v1/system/billing/companies/:id/invoices/:invoiceId/refund-preview` | `refundPreview` (L181) | `system.billing.refund.manage` | แพลตฟอร์ม | คืนเงิน ตัวอย่าง (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingRefundDto` | `→ BillingRefundsService.preview()` (200) |
| 166 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/end-package` | `endPackageReview` (L185) | `system.billing.financial.read` | แพลตฟอร์ม | สิ้นสุด การตรวจทาน แพ็กเกจ | `Q:unknown` | `→ BillingRefundsService.endPackageReview()` |
| 167 | POST | `/v1/system/billing/companies/:id/invoices/:invoiceId/end-package` | `endPackage` (L189) | `system.billing.refund.manage` | แพลตฟอร์ม | สิ้นสุด แพ็กเกจ (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingEndPackageDto` | `→ BillingRefundsService.endPackage()` (200) |
| 168 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/refund-requests` | `refundRequests` (L193) | `system.billing.financial.read` | แพลตฟอร์ม | คืนเงิน คำขอ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingRefundsService.list()` |
| 169 | GET | `/v1/system/billing/refunds/:id` | `refundRequest` (L197) | `system.billing.financial.read` | แพลตฟอร์ม | คืนเงิน คำขอ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingRefundsService.get()` |
| 170 | POST | `/v1/system/billing/refunds/:id/:action` | `refundCommand` (L199) | `system.billing.financial.read` | แพลตฟอร์ม | คืนเงิน คำสั่ง (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingRefundsService.run()` (200) |
| 171 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/recipient-review` | `recipientAdminReview` (L209) | `system.billing.financial.read` | แพลตฟอร์ม | ดู การตรวจทาน ผู้ดูแล ผู้รับเอกสาร | `Q:unknown` | `→ BillingDocumentAdminService.review()` |
| 172 | POST | `/v1/system/billing/companies/:id/invoices/:invoiceId/recipient-preview` | `recipientAdminPreview` (L213) | `system.billing.override.manage` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง ผู้ดูแล ผู้รับเอกสาร | `B:BillingRecipientAdminDto` | `→ BillingDocumentAdminService.preview()` (200) |
| 173 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/recipient-requests` | `recipientAdminRequests` (L219) | `system.billing.financial.read` | แพลตฟอร์ม | ดู คำขอ ผู้ดูแล ผู้รับเอกสาร | `Q:unknown` | `→ BillingDocumentAdminService.list()` |
| 174 | GET | `/v1/system/billing/recipient-changes/:id` | `recipientAdminGet` (L223) | `system.billing.financial.read` | แพลตฟอร์ม | ดู ผู้ดูแล ผู้รับเอกสาร | — | `→ BillingDocumentAdminService.get()` |
| 175 | POST | `/v1/system/billing/recipient-changes/:id/:action` | `recipientAdminCommand` (L225) | `system.billing.financial.read` | แพลตฟอร์ม | ดำเนินการ คำสั่ง ผู้ดูแล ผู้รับเอกสาร | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingDocumentAdminService.run()` (200) |
| 176 | POST | `/v1/system/billing/companies/:id/invoices/:invoiceId/resend` | `documentAdminResend` (L233) | `system.billing.override.manage` | แพลตฟอร์ม | ดำเนินการ การส่งซ้ำ ผู้ดูแล เอกสาร | `B:BillingDocumentResendAdminDto` | `→ BillingDocumentAdminService.resend()` (200) |
| 177 | GET | `/v1/system/billing/lookup` | `lookup` (L240) | `system.billing.read` | แพลตฟอร์ม | ค้นหา (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.lookup()` |
| 178 | GET | `/v1/system/billing/companies/:id/invoices/:invoiceId/adjustments/:kind` | `adjustments` (L245) | `system.billing.financial.read` | แพลตฟอร์ม | ดู รายการปรับปรุง (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.adjustments()` |
| 179 | POST | `/v1/system/billing/companies/:id/documents/:invoiceId/open` | `document` (L250) | `system.billing.document.read` | แพลตฟอร์ม | ดำเนินการ เอกสาร (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingDocumentDto` | `→ BillingAdminService.document()` (200) |
| 180 | GET | `/v1/system/billing/provider-scans` | `providerScans` (L255) | `system.billing.read` | แพลตฟอร์ม | ดู ผลสแกน ผู้ให้บริการ | `Q:unknown` | `→ BillingProviderScansService.list()` |
| 181 | GET | `/v1/system/billing/provider-scans/schedule` | `scanSchedule` (L259) | `system.billing.read` | แพลตฟอร์ม | สแกน/กวาดตรวจ กำหนดการ (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingProviderScansService.schedule()` |
| 182 | GET | `/v1/system/billing/provider-scans/schedule/history` | `scanScheduleHistory` (L261) | `system.billing.read` | แพลตฟอร์ม | สแกน/กวาดตรวจ ประวัติ กำหนดการ | `Q:unknown` | `→ BillingProviderScansService.scheduleHistory()` |
| 183 | GET | `/v1/system/billing/provider-scans/schedule/operations/:id` | `scanScheduleOperation` (L265) | `system.billing.read` | แพลตฟอร์ม | สแกน/กวาดตรวจ ปฏิบัติการ กำหนดการ | — | `→ BillingProviderScansService.scheduleOperation()` |
| 184 | POST | `/v1/system/billing/provider-scans/schedule/preview` | `scanSchedulePreview` (L267) | `system.billing.reconcile.run` | แพลตฟอร์ม | สแกน/กวาดตรวจ ตัวอย่าง กำหนดการ | `B:BillingScanScheduleDto` `H:idempotency-key` | `→ BillingProviderScansService.previewSchedule()` (200) |
| 185 | POST | `/v1/system/billing/provider-scans/schedule/operations/:id/:action` | `scanScheduleAction` (L272) | `system.billing.reconcile.run` | แพลตฟอร์ม | สแกน/กวาดตรวจ การดำเนินการ กำหนดการ | `B:BillingCommandDto` | `→ BillingProviderScansService.actSchedule()` (200) |
| 186 | GET | `/v1/system/billing/provider-scans/:id` | `providerScan` (L277) | `system.billing.read` | แพลตฟอร์ม | ดู การสแกน ผู้ให้บริการ | — | `→ BillingProviderScansService.get()` |
| 187 | POST | `/v1/system/billing/provider-scans` | `createProviderScan` (L279) | `system.billing.reconcile.run` | แพลตฟอร์ม | สร้าง การสแกน ผู้ให้บริการ | `B:BillingProviderScanDto` `H:idempotency-key` | `→ BillingProviderScansService.create()` |
| 188 | POST | `/v1/system/billing/provider-scans/:id/:action` | `providerScanAction` (L283) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ การดำเนินการ การสแกน ผู้ให้บริการ | `B:BillingVersionDto` | `→ BillingProviderScansService.act()` (200) |
| 189 | GET | `/v1/system/billing/companies/:id/invoice-scans` | `invoiceScans` (L288) | `system.billing.read` | แพลตฟอร์ม | ดู ผลสแกน ใบแจ้งหนี้ | `Q:unknown` | `→ BillingProviderScansService.list()` |
| 190 | GET | `/v1/system/billing/companies/:id/invoice-scans/:scanId` | `invoiceScan` (L292) | `system.billing.read` | แพลตฟอร์ม | ดู การสแกน ใบแจ้งหนี้ | — | `→ BillingProviderScansService.get()` |
| 191 | GET | `/v1/system/billing/companies/:id/invoice-scans/:scanId/findings` | `invoiceScanFindings` (L294) | `system.billing.read` | แพลตฟอร์ม | ดู ข้อค้นพบ การสแกน ใบแจ้งหนี้ | `Q:unknown` | `→ BillingProviderScansService.invoiceFindings()` |
| 192 | POST | `/v1/system/billing/companies/:id/invoice-scans` | `createInvoiceScan` (L298) | `system.billing.reconcile.run` | แพลตฟอร์ม | สร้าง การสแกน ใบแจ้งหนี้ | `B:BillingProviderScanDto` `H:idempotency-key` | `→ BillingProviderScansService.create()` |
| 193 | POST | `/v1/system/billing/companies/:id/invoice-scans/:scanId/:action` | `invoiceScanAction` (L302) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ การดำเนินการ การสแกน ใบแจ้งหนี้ | `B:BillingVersionDto` | `→ BillingProviderScansService.act()` (200) |
| 194 | GET | `/v1/system/billing/provider-events` | `providerEvents` (L306) | `system.billing.read` | แพลตฟอร์ม | ดู เหตุการณ์ ผู้ให้บริการ | `Q:unknown` | `→ BillingAdminService.providerEvents()` |
| 195 | GET | `/v1/system/billing/provider-events/:id` | `providerEvent` (L311) | `system.billing.read` | แพลตฟอร์ม | ดู เหตุการณ์ ผู้ให้บริการ | — | `→ BillingAdminService.providerEvent()` |
| 196 | POST | `/v1/system/billing/provider-events/:id/preview` | `previewEvent` (L313) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดูตัวอย่าง เหตุการณ์ (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingEventPreviewDto` | `→ BillingOperationsService.previewEvent()` (200) |
| 197 | GET | `/v1/system/billing/companies/:id/deliveries` | `deliveries` (L318) | `system.billing.read` | แพลตฟอร์ม | ดู การนำส่ง (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingNotificationsService.deliveries()` |
| 198 | GET | `/v1/system/billing/companies/:id/deliveries/:deliveryId` | `delivery` (L322) | `system.billing.read` | แพลตฟอร์ม | ดู การนำส่ง (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingNotificationsService.delivery()` |
| 199 | GET | `/v1/system/billing/operator-scopes` | `scopesList` (L324) | `admin.role.manage` | ทุกแพ็ก | ดู รายการ ขอบเขต | `Q:unknown` | `→ BillingScopesService.list()` |
| 200 | GET | `/v1/system/billing/scope-directory/:kind` | `scopeDirectory` (L328) | `admin.role.manage` | ทุกแพ็ก | ดู สารบบ ขอบเขต | `Q:unknown` | `→ BillingScopesService.directory()` |
| 201 | GET | `/v1/system/billing/scope-changes` | `scopeChanges` (L333) | `admin.role.manage` | ทุกแพ็ก | ดู การเปลี่ยนแปลง ขอบเขต | `Q:unknown` | `→ BillingScopesService.changes()` |
| 202 | GET | `/v1/system/billing/scope-changes/:id` | `scopeChange` (L337) | `admin.role.manage` | ทุกแพ็ก | ดู การเปลี่ยนแปลง ขอบเขต | — | `→ BillingScopesService.get()` |
| 203 | POST | `/v1/system/billing/scope-changes/preview` | `scopePreview` (L339) | `admin.role.manage` | ทุกแพ็ก | ดำเนินการ ตัวอย่าง ขอบเขต | `B:BillingScopePreviewDto` | `→ BillingScopesService.preview()` (200) |
| 204 | POST | `/v1/system/billing/scope-changes/:id/:action` | `scopeAction` (L345) | `admin.role.manage` | ทุกแพ็ก | ดำเนินการ การดำเนินการ ขอบเขต | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingScopesService.act()` (200) |
| 205 | GET | `/v1/system/billing/settings` | `settings` (L351) | `system.billing.read` | แพลตฟอร์ม | ดู การตั้งค่า (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingConfigurationService.settings()` |
| 206 | POST | `/v1/system/billing/reauthenticate` | `reauthenticate` (L353) | `system.billing.read` | แพลตฟอร์ม | ยืนยันตัวตนซ้ำ (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingReauthenticateDto` | — (200) |
| 207 | POST | `/v1/system/billing/companies/:id/reauthenticate` | `reauthenticateCompany` (L357) | `system.billing.financial.read` | แพลตฟอร์ม | ยืนยันตัวตนซ้ำ บริษัท (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingReauthenticateDto` | — (200) |
| 208 | GET | `/v1/system/billing/companies/:id/reauthenticate` | `companyProof` (L361) | `system.billing.financial.read` | แพลตฟอร์ม | ดู หลักฐานการชำระ บริษัท | `Q:unknown` | `→ BillingConfigurationService.companyProof()` |
| 209 | GET | `/v1/system/billing/configuration-checks` | `configurationChecks` (L372) | `system.billing.read` | แพลตฟอร์ม | ดู การตรวจ การตั้งค่า | `Q:unknown` | `→ BillingReadinessService.list()` |
| 210 | GET | `/v1/system/billing/configuration-checks/:id` | `configurationCheck` (L374) | `system.billing.read` | แพลตฟอร์ม | ดู การตรวจ การตั้งค่า | — | `→ BillingReadinessService.get()` |
| 211 | POST | `/v1/system/billing/configuration-checks` | `requestConfigurationCheck` (L376) | `system.billing.reconcile.run` | แพลตฟอร์ม | ร้องขอ การตรวจ การตั้งค่า | `B:BillingConfigurationCheckDto` `H:idempotency-key` | `→ BillingReadinessService.create()` (202) |
| 212 | POST | `/v1/system/billing/configuration-checks/:id/:action` | `configurationCheckAction` (L380) | `system.billing.reconcile.run` | แพลตฟอร์ม | ดำเนินการ การดำเนินการ การตรวจ การตั้งค่า | `B:BillingVersionDto` | `→ BillingReadinessService.run()` (200) |
| 213 | GET | `/v1/system/billing/configuration-changes` | `configurationList` (L385) | `system.billing.read` | แพลตฟอร์ม | ดู รายการ การตั้งค่า | `Q:unknown` | `→ BillingConfigurationService.list()` |
| 214 | GET | `/v1/system/billing/configuration-changes/:id` | `configurationGet` (L390) | `system.billing.read` | แพลตฟอร์ม | ดู การตั้งค่า | — | `→ BillingConfigurationService.get()` |
| 215 | GET | `/v1/system/billing/configuration-changes/:id/affected` | `configurationAffected` (L392) | `system.billing.read` | แพลตฟอร์ม | ดู ที่ได้รับผลกระทบ การตั้งค่า | `Q:unknown` | `→ BillingConfigurationService.affected()` |
| 216 | POST | `/v1/system/billing/configuration-changes/preview` | `configurationPreview` (L398) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง การตั้งค่า | `B:BillingConfigurationDto` | `→ BillingConfigurationService.preview()` (200) |
| 217 | POST | `/v1/system/billing/configuration-drafts` | `configurationDraft` (L406) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ ร่าง การตั้งค่า | `B:BillingConfigurationDto` `H:idempotency-key` | `→ BillingConfigurationService.saveDraft()` (200) |
| 218 | POST | `/v1/system/billing/configuration-changes/:id/:action` | `configurationAction` (L411) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ การดำเนินการ การตั้งค่า | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingConfigurationService.cancel()` (200) |
| 219 | POST | `/v1/system/billing/settings/emergency-close` | `configurationClose` (L422) | `system.billing.gate.manage` | แพลตฟอร์ม | ดำเนินการ การปิด การตั้งค่า | `B:BillingCloseDto` `H:idempotency-key` | `→ BillingConfigurationService.close()` (200) |
| 220 | GET | `/v1/system/billing/promotion-campaigns` | `promotionCampaigns` (L431) | `system.billing.read` | แพลตฟอร์ม | ดู แคมเปญ โปรโมชัน | `Q:unknown` | `→ BillingConfigurationService.promotionCampaigns()` |
| 221 | GET | `/v1/system/billing/promotion-campaigns/:campaignId` | `promotionCampaign` (L433) | `system.billing.read` | แพลตฟอร์ม | ดู แคมเปญ โปรโมชัน | `Q:unknown` | `→ BillingConfigurationService.promotionCampaign()` |
| 222 | GET | `/v1/system/billing/promotion-campaigns/:campaignId/report` | `promotionCampaignReport` (L437) | `system.billing.read` | แพลตฟอร์ม | ดู รายงาน แคมเปญ โปรโมชัน | `Q:unknown` | `→ BillingConfigurationService.promotionCampaignReport()` |
| 223 | POST | `/v1/system/billing/promotion-campaign-drafts` | `promotionDraft` (L442) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ ร่าง โปรโมชัน | `B:BillingPromotionDraftDto` `H:idempotency-key` | `→ BillingConfigurationService.savePromotionDraft()` (200) |
| 224 | POST | `/v1/system/billing/promotion-campaign-drafts/:campaignId/discard` | `promotionDraftDiscard` (L450) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ การทิ้ง ร่าง โปรโมชัน | `B:BillingPromotionDiscardDto` | `→ BillingConfigurationService.discardPromotionDraft()` (200) |
| 225 | POST | `/v1/system/billing/promotion-campaigns/:campaignId/preview` | `promotionPreview` (L456) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ ตัวอย่าง โปรโมชัน | `B:BillingPromotionPreviewDto` | `→ BillingConfigurationService.previewPromotion()` (200) |
| 226 | POST | `/v1/system/billing/promotion-campaigns/:campaignId/pause` | `promotionPause` (L462) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ การพัก โปรโมชัน | `B:BillingPromotionStateDto` `H:idempotency-key` | — (200) |
| 227 | POST | `/v1/system/billing/promotion-campaigns/:campaignId/end` | `promotionEnd` (L466) | `system.billing.read` | แพลตฟอร์ม | ดำเนินการ การสิ้นสุด โปรโมชัน | `B:BillingPromotionStateDto` `H:idempotency-key` | `→ BillingConfigurationService.setPromotionState()` (200) |
| 228 | GET | `/v1/system/billing/operations` | `operationsList` (L480) | `system.billing.read` | แพลตฟอร์ม | ดู รายการ ปฏิบัติการ | `Q:unknown` | `→ BillingOperationsService.list()` |
| 229 | GET | `/v1/system/billing/operations/:id` | `operation` (L485) | `system.billing.read` | แพลตฟอร์ม | ดู ปฏิบัติการ (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingOperationsService.get()` |
| 230 | POST | `/v1/system/billing/operations/preview` | `preview` (L487) | `system.billing.read` | แพลตฟอร์ม | ดูตัวอย่าง (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingRepairPreviewDto` | `→ BillingOperationsService.preview()` (200) |
| 231 | GET | `/v1/system/billing/companies/:id/invoice-findings/:findingId` | `invoiceFinding` (L497) | `system.billing.read` | แพลตฟอร์ม | ดู ข้อค้นพบ ใบแจ้งหนี้ | — | `→ BillingOperationsService.finding()` |
| 232 | GET | `/v1/system/billing/companies/:targetCompanyId/apply-invoices` | `applyInvoices` (L499) | `system.billing.read` | แพลตฟอร์ม | นำไปใช้ ใบแจ้งหนี้ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingOperationsService.applyInvoices()` |
| 233 | GET | `/v1/system/billing/companies/:targetCompanyId/apply-invoices/:id` | `applyInvoice` (L503) | `system.billing.read` | แพลตฟอร์ม | นำไปใช้ ใบแจ้งหนี้ (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingOperationsService.applyInvoice()` |
| 234 | POST | `/v1/system/billing/operations` | `submit` (L505) | `system.billing.read` | แพลตฟอร์ม | ส่ง (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingSubmitDto` `H:idempotency-key` | `→ BillingOperationsService.submit()` (202) |
| 235 | POST | `/v1/system/billing/operations/:id/:action` | `transition` (L513) | `system.billing.read` | แพลตฟอร์ม | เปลี่ยนสถานะ (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingVersionDto` | `→ BillingOperationsService.transition()` (200) |
| 236 | GET | `/v1/system/billing/overview` | `overview` (L520) | `system.billing.read` | แพลตฟอร์ม | ดู ภาพรวม (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.overview()` |
| 237 | POST | `/v1/system/billing/companies/:id/timeline/export` | `exportTimeline` (L526) | `system.billing.export` | แพลตฟอร์ม | ส่งออก ไทม์ไลน์ (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingTimelineExportDto` | `→ BillingAdminService.exportTimeline()` (200) |
| 238 | GET | `/v1/system/billing/companies/:id/timeline` | `timeline` (L531) | `system.billing.read` | แพลตฟอร์ม | ดู ไทม์ไลน์ (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.timeline()` |
| 239 | GET | `/v1/system/billing/companies/:id` | `company` (L536) | `system.billing.read` | แพลตฟอร์ม | ดู บริษัท (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.company()` |
| 240 | GET | `/v1/system/billing/issues` | `issues` (L541) | `system.billing.read` | แพลตฟอร์ม | ดู ประเด็น (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.issues()` |
| 241 | GET | `/v1/system/billing/issues/:id/outcomes` | `supportOutcomes` (L549) | `system.billing.read` | แพลตฟอร์ม | ดู ผลลัพธ์ ซัพพอร์ต | `Q:unknown` | `→ BillingAdminService.supportOutcomes()` |
| 242 | GET | `/v1/system/billing/issues/:id/outcomes/:outcomeId` | `supportOutcome` (L553) | `system.billing.read` | แพลตฟอร์ม | ดู ผลลัพธ์ ซัพพอร์ต | — | `→ BillingAdminService.supportOutcome()` |
| 243 | POST | `/v1/system/billing/issues/:id/outcomes/preview` | `previewSupportOutcome` (L557) | `system.billing.issue.manage` | แพลตฟอร์ม | ดูตัวอย่าง ผลลัพธ์ ซัพพอร์ต | `B:BillingSupportOutcomeDto` `H:idempotency-key` | `→ BillingAdminService.previewSupportOutcome()` |
| 244 | POST | `/v1/system/billing/issues/:id/outcomes/:outcomeId/:action` | `commitSupportOutcome` (L564) | `system.billing.issue.manage` | แพลตฟอร์ม | ยืนยันบันทึก ผลลัพธ์ ซัพพอร์ต | `B:BillingCommandDto` | `→ BillingAdminService.commitSupportOutcome()` |
| 245 | GET | `/v1/system/billing/issues/:id/operators` | `assignees` (L571) | `system.billing.issue.manage` | แพลตฟอร์ม | ดู ผู้รับมอบหมาย (ผู้ดูแล การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingAdminService.assignees()` |
| 246 | GET | `/v1/system/billing/issues/:id` | `issue` (L576) | `system.billing.read` | แพลตฟอร์ม | ออกเอกสาร (ผู้ดูแล การเรียกเก็บเงิน) | — | `→ BillingAdminService.issue()` |
| 247 | PATCH | `/v1/system/billing/issues/:id` | `updateIssue` (L578) | `system.billing.issue.manage` | แพลตฟอร์ม | แก้ไข ประเด็น (ผู้ดูแล การเรียกเก็บเงิน) | `B:BillingIssueDto` | `→ BillingAdminService.access()` |

**`BillingController`** — `apps/api/src/modules/billing/presentation/billing.controller.ts` · base path: `/v1/companies/:companyId/billing` · สิทธิ์ระดับ class: `account.session.read` · 25 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 248 | GET | `/v1/companies/:companyId/billing/recipient` | `recipient` (L604) | `account.session.read` | ทุกแพ็ก | ดู ผู้รับเอกสาร (การเรียกเก็บเงิน) | — | `→ BillingService.emailRecipient.current()` |
| 249 | POST | `/v1/companies/:companyId/billing/recipient/otp/request` | `recipientOtpRequest` (L606) | `account.session.read` | ทุกแพ็ก | ดำเนินการ คำขอ OTP ผู้รับเอกสาร | `B:BillingRecipientOtpRequestDto` | `→ BillingRecipientOtpService.request()` (202) |
| 250 | POST | `/v1/companies/:companyId/billing/recipient/otp/confirm` | `recipientOtpConfirm` (L611) | `account.session.read` | ทุกแพ็ก | ดำเนินการ การยืนยัน OTP ผู้รับเอกสาร | `B:BillingRecipientOtpConfirmDto` | `→ BillingRecipientOtpService.confirm()` (200) |
| 251 | POST | `/v1/companies/:companyId/billing/recipient/preview` | `recipientPreview` (L616) | `account.session.read` | ทุกแพ็ก | ดำเนินการ ตัวอย่าง ผู้รับเอกสาร | `B:BillingRecipientPreviewDto` | `→ BillingService.emailRecipient.preview()` (200) |
| 252 | GET | `/v1/companies/:companyId/billing/recipient/:id` | `recipientOperation` (L621) | `account.session.read` | ทุกแพ็ก | ดู ปฏิบัติการ ผู้รับเอกสาร | — | `→ BillingService.emailRecipient.get()` |
| 253 | POST | `/v1/companies/:companyId/billing/recipient/:id/:action` | `recipientCommand` (L622) | `account.session.read` | ทุกแพ็ก | ดำเนินการ คำสั่ง ผู้รับเอกสาร | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingService.emailRecipient.command()` (200) |
| 254 | GET | `/v1/companies/:companyId/billing` | `status` (L633) | `account.session.read` | ทุกแพ็ก | ดู สถานะ (การเรียกเก็บเงิน) | — | `→ BillingService.status()` |
| 255 | GET | `/v1/companies/:companyId/billing/event-discount` | `eventDiscount` (L635) | `account.session.read` | ทุกแพ็ก | ดู ส่วนลด เหตุการณ์ | — | `→ BillingService.eventDiscount()` |
| 256 | GET | `/v1/companies/:companyId/billing/collection/:id` | `collectionGet` (L637) | `account.session.read` | ทุกแพ็ก | ดู การเก็บเงิน | — | `→ BillingService.withPlanMenuImpact()` |
| 257 | POST | `/v1/companies/:companyId/billing/collection/preview` | `collectionPreview` (L641) | `account.session.read` | ทุกแพ็ก | ดำเนินการ ตัวอย่าง การเก็บเงิน | `B:BillingCollectionPreviewDto` | `→ BillingService.withPlanMenuImpact()` (200) |
| 258 | POST | `/v1/companies/:companyId/billing/collection/:id/capacity` | `planCapacityRepair` (L649) | `account.session.read` | ทุกแพ็ก | ดำเนินการ การซ่อม ความจุ/โควตา แพ็ก/แผน | `B:BillingCapacityRepairDto` `H:idempotency-key` | `→ BillingService.repairPlanCapacity()` (200) |
| 259 | POST | `/v1/companies/:companyId/billing/collection/:id/:action` | `collectionCommand` (L655) | `account.session.read` | ทุกแพ็ก | ดำเนินการ คำสั่ง การเก็บเงิน | `B:BillingCommandDto` `H:idempotency-key` | `→ BillingService.collection.withdraw()` (200) |
| 260 | POST | `/v1/companies/:companyId/billing/quote` | `quote` (L665) | `account.session.read` | ทุกแพ็ก | ดำเนินการ ใบเสนอราคา/ราคา (การเรียกเก็บเงิน) | `B:BillingQuoteDto` | `→ BillingService.quote()` (200) |
| 261 | GET | `/v1/companies/:companyId/billing/capacity` | `capacity` (L690) | `account.session.read` | ทุกแพ็ก | ดู ความจุ/โควตา (การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingService.capacity()` |
| 262 | POST | `/v1/companies/:companyId/billing/attempts/:attemptId/capacity` | `repairCapacity` (L695) | `account.session.read` | ทุกแพ็ก | ซ่อมข้อมูล ความจุ/โควตา (การเรียกเก็บเงิน) | `B:BillingCapacityRepairDto` `H:idempotency-key` | `→ BillingService.repairCapacity()` (202) |
| 263 | POST | `/v1/companies/:companyId/billing/checkout` | `checkout` (L702) | `account.session.read` | ทุกแพ็ก | เริ่มชำระเงิน (checkout) (การเรียกเก็บเงิน) | `B:BillingCheckoutDto` `H:idempotency-key` | `→ BillingService.checkout()` (200) |
| 264 | GET | `/v1/companies/:companyId/billing/attempts/:attemptId` | `attempt` (L710) | `account.session.read` | ทุกแพ็ก | ดู ความพยายามชำระ (การเรียกเก็บเงิน) | — | `→ BillingService.attempt()` |
| 265 | POST | `/v1/companies/:companyId/billing/attempts/:attemptId/resume` | `resume` (L712) | `account.session.read` | ทุกแพ็ก | ทำต่อ (การเรียกเก็บเงิน) | — | `→ BillingService.resume()` (200) |
| 266 | POST | `/v1/companies/:companyId/billing/attempts/:attemptId/cancel` | `cancelCheckout` (L716) | `account.session.read` | ทุกแพ็ก | ยกเลิก checkout (การเรียกเก็บเงิน) | `B:BillingEmptyDto` | `→ BillingCheckoutExpiryService.cancelOwn()` (200) |
| 267 | POST | `/v1/companies/:companyId/billing/refresh` | `refresh` (L720) | `account.session.read` | ทุกแพ็ก | รีเฟรช (การเรียกเก็บเงิน) | — | `→ BillingService.refresh()` (202) |
| 268 | POST | `/v1/companies/:companyId/billing/portal` | `portal` (L722) | `account.session.read` | ทุกแพ็ก | ดำเนินการ พอร์ทัล (การเรียกเก็บเงิน) | `B:BillingPortalDto` | `→ BillingService.portal()` (200) |
| 269 | GET | `/v1/companies/:companyId/billing/history` | `history` (L727) | `account.session.read` | ทุกแพ็ก | ดู ประวัติ (การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingService.history()` |
| 270 | GET | `/v1/companies/:companyId/billing/invoices/:documentId/adjustments/:kind` | `adjustments` (L736) | `account.session.read` | ทุกแพ็ก | ดู รายการปรับปรุง (การเรียกเก็บเงิน) | `Q:unknown` | `→ BillingService.adjustments()` |
| 271 | POST | `/v1/companies/:companyId/billing/documents/:documentId/open` | `document` (L741) | `account.session.read` | ทุกแพ็ก | ดำเนินการ เอกสาร (การเรียกเก็บเงิน) | `B:BillingDocumentDto` | `→ BillingService.document()` (200) |
| 272 | POST | `/v1/companies/:companyId/billing/documents/:documentId/resend` | `resendDocument` (L747) | `account.session.read` | ทุกแพ็ก | ส่งซ้ำ เอกสาร (การเรียกเก็บเงิน) | `B:BillingEmptyDto` | `→ BillingService.documentResend.run()` (200) |

**`StripeEventsController`** — `apps/api/src/modules/billing/presentation/billing.controller.ts` · base path: `/v1/public/stripe-events` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 273 | POST | `/v1/public/stripe-events` | `receive` (L757) | Public — `Stripe-Signature` (ตรวจกับ raw body) | แพลตฟอร์ม | รับ (เหตุการณ์ Stripe) | `B:raw(req.body)` | `→ BillingReconcilerService.receive()` (200) |

**`BillingInternalController`** — `apps/api/src/modules/billing/presentation/billing.controller.ts` · base path: `/v1/internal/billing` · `@Public()` ระดับ class · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 274 | POST | `/v1/internal/billing/provider-scans/drain` | `drainProviderScans` (L767) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน ผลสแกน ผู้ให้บริการ | — | `→ BillingProviderScansService.drain()` (200) |
| 275 | POST | `/v1/internal/billing/drain` | `drain` (L769) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน การเรียกเก็บเงิน) | — | `→ BillingCheckoutExpiryService.drain()` (200) |
| 276 | POST | `/v1/internal/billing/notifications/drain` | `drainNotifications` (L775) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน การแจ้งเตือน (ภายใน การเรียกเก็บเงิน) | — | `→ BillingNotificationsService.drain()` (200) |
| 277 | POST | `/v1/internal/billing/scan` | `scan` (L777) | Public — `X-Worker-Token` | แพลตฟอร์ม | สแกน/กวาดตรวจ (ภายใน การเรียกเก็บเงิน) | — | `→ BillingReconcilerService.scan()` (200) |

### 2.7 โมดูล `crm-inbox` — 65 endpoint

**`CrmAiAssistController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-ai-assist.controller.ts` · base path: `/v1/companies/:companyId/crm/conversations` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 278 | GET | `/v1/companies/:companyId/crm/conversations/:conversationId/ai/trust` | `trust` (L26) | `crm.ai.assist` | ทุกแพ็ก [ai_line_assistant] | กำหนดความเชื่อถือ (ผู้ช่วย AI CRM) — _Read stored CRM customer AI trust tier for staff assist_ | — | `→ CrmAiTrustReadUseCase.execute()` |
| 279 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/ai/summary` | `summarize` (L33) | `crm.ai.assist` | ทุกแพ็ก [ai_line_assistant] | สรุป (ผู้ช่วย AI CRM) — _Generate a CRM conversation AI summary for staff assist_ | — | `→ CrmAiSummaryUseCase.execute()` (200) |
| 280 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/ai/reply-draft` | `draft` (L41) | `crm.ai.assist` | ทุกแพ็ก [ai_line_assistant] | ดำเนินการ ร่าง (ผู้ช่วย AI CRM) — _Generate a CRM AI reply draft for staff assist without sending_ | `B:{ tone?: string }` | `→ CrmAiReplyDraftUseCase.execute()` (200) |
| 281 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/ai/insights` | `analyze` (L49) | `crm.ai.assist` | ทุกแพ็ก [ai_line_assistant] | วิเคราะห์ (ผู้ช่วย AI CRM) — _Generate CRM AI conversation insights for staff assist_ | — | `→ CrmAiInsightsUseCase.execute()` (200) |
| 282 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/ai/feedback` | `recordFeedback` (L57) | `crm.ai.assist` | ทุกแพ็ก [ai_line_assistant] | บันทึก ข้อเสนอแนะ (ผู้ช่วย AI CRM) — _Record CRM AI staff assist feedback_ | `B:unknown` | `→ CrmAiFeedbackUseCase.execute()` (200) |

**`CrmCustomerProfileAssistController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-ai-assist.controller.ts` · base path: `/v1/companies/:companyId/crm/customers` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 283 | POST | `/v1/companies/:companyId/crm/customers/ai-profile-extract` | `extract` (L71) | `crm.customer.create` + `crm.ai.assist` | ไม่ขาย(crm) | สกัดข้อมูล (ผู้ช่วย โปรไฟล์ ลูกค้า CRM) — _Extract an editable customer-form preview; never persists data_ | `B:unknown` | `→ CrmCustomerProfileExtractUseCase.execute()` (200) |

**`CrmAiInternalController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-ai-internal.controller.ts` · base path: `/v1/internal/crm` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 284 | POST | `/v1/internal/crm/trust-score-scan` | `trustScoreScan` (L15) | Public — `X-Worker-Token` | แพลตฟอร์ม | กำหนดความเชื่อถือ การสแกน คะแนน | — | `→ ScanCrmTrustScoresUseCase.execute()` |

**`CrmCampaignController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-campaign.controller.ts` · base path: `/v1/companies/:companyId/crm/campaigns` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 285 | GET | `/v1/companies/:companyId/crm/campaigns` | `list` (L11) | `crm.campaign.read` | ไม่ขาย(crm) | ดูรายการ (แคมเปญ CRM) | — | `→ CrmCampaignUseCase.list()` |
| 286 | POST | `/v1/companies/:companyId/crm/campaigns/drafts` | `create` (L12) | `crm.campaign.manage` | ไม่ขาย(crm) | สร้าง (แคมเปญ CRM) | `B:CreateCrmCampaignInput` | `→ CrmCampaignUseCase.create()` |
| 287 | POST | `/v1/companies/:companyId/crm/campaigns/:id/preview` | `preview` (L13) | `crm.campaign.manage` | ไม่ขาย(crm) | ดูตัวอย่าง (แคมเปญ CRM) | — | `→ CrmCampaignUseCase.preview()` |
| 288 | POST | `/v1/companies/:companyId/crm/campaigns/:id/send` | `send` (L14) | `crm.campaign.send` | ไม่ขาย(crm) | ส่ง (แคมเปญ CRM) | `B:SendCrmCampaignInput` | `→ CrmCampaignUseCase.send()` |
| 289 | POST | `/v1/companies/:companyId/crm/campaigns/generate` | `generate` (L15) | `crm.campaign.manage` + `crm.ai.assist` | ไม่ขาย(crm) | สร้าง/ประมวลผล (แคมเปญ CRM) | `B:GenerateCrmBroadcastInput` | `→ CrmAiBroadcastUseCase.execute()` |

**`CrmConversationActionsController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-conversation-actions.controller.ts` · base path: `/v1/companies/:companyId/crm/conversations/:conversationId` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 290 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/create-deal` | `createDeal` (L31) | `crm.opportunity.create` | ไม่ขาย(crm) | สร้าง ดีลขาย (การดำเนินการ บทสนทนา CRM) — _Create a deal (opportunity) from a conversation_ | `B:CreateDealFromConversationInput` | `→ CreateFromConversationUseCase.createDeal()` |
| 291 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/create-task` | `createTask` (L38) | `crm.follow_up.create` | ไม่ขาย(crm) | สร้าง งาน (การดำเนินการ บทสนทนา CRM) — _Create a follow-up task from a conversation_ | `B:CreateTaskFromConversationInput` | `→ CreateFromConversationUseCase.createTask()` |
| 292 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/create-quotation` | `createQuotation` (L45) | `crm.opportunity.create` + `crm.quotation.link` | ไม่ขาย(crm) | สร้าง ใบเสนอราคา (การดำเนินการ บทสนทนา CRM) — _Create a deal + quotation draft from a conversation_ | `B:CreateQuotationFromConversationInput` | `→ CreateFromConversationUseCase.createQuotation()` |
| 293 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/flag-payment-proof` | `flagPaymentProof` (L52) | `crm.inbox.reply` | ไม่ขาย(crm) | ติดธง หลักฐานการชำระ การจ่ายเงิน — _Flag an inbound image/file as a payment proof (finance queue capture)_ | — | `→ CrmPaymentProofUseCase.flag()` |

**`CrmPaymentProofQueueController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-conversation-actions.controller.ts` · base path: `/v1/companies/:companyId/crm/payment-proofs` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 294 | GET | `/v1/companies/:companyId/crm/payment-proofs` | `list` (L66) | `accounting.document.read` | ไม่ขาย(sales_documents) | ดูรายการ (คิว หลักฐานการชำระ การจ่ายเงิน CRM) — _List flagged payment proofs awaiting finance verification_ | — | `→ CrmPaymentProofUseCase.list()` |
| 295 | GET | `/v1/companies/:companyId/crm/payment-proofs/:conversationId/messages/:messageId/content` | `content` (L73) | `accounting.document.read` | ไม่ขาย(sales_documents) | ดู เนื้อหา (คิว หลักฐานการชำระ การจ่ายเงิน CRM) — _Stream a purpose-linked payment proof for finance review_ | — | `StreamableFile` |

**`CrmDailyBriefController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-conversation-actions.controller.ts` · base path: `/v1/companies/:companyId/crm/daily-brief` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 296 | GET | `/v1/companies/:companyId/crm/daily-brief` | `get` (L98) | `crm.inbox.read` | ไม่ขาย(crm) | ดูข้อมูล (brief รายวัน CRM) — _CRM daily brief widgets with deep links (unanswered/SLA/new customers/appointments/payment proofs)_ | `Q{period}` | `→ CrmDailyBriefUseCase.execute()` |

**`CrmConversationController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-conversation.controller.ts` · base path: `/v1/companies/:companyId/crm/conversations` · 11 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 297 | GET | `/v1/companies/:companyId/crm/conversations` | `list` (L46) | `crm.inbox.read` | ไม่ขาย(crm) | ดูรายการ (บทสนทนา CRM) — _List CRM inbox conversations (with chip counts)_ | `Q{status,search,overdue,unanswered,tag,assignee,customerId,page,pageSize}` | `→ ListCrmConversationsUseCase.execute()` |
| 298 | GET | `/v1/companies/:companyId/crm/conversations/:conversationId` | `get` (L75) | `crm.inbox.read` | ไม่ขาย(crm) | ดูข้อมูล (บทสนทนา CRM) — _Get conversation detail with messages_ | — | `→ GetCrmConversationUseCase.execute()` |
| 299 | GET | `/v1/companies/:companyId/crm/conversations/:conversationId/messages/:messageId/content` | `content` (L84) | `crm.inbox.read` | ไม่ขาย(crm) | ดู เนื้อหา (บทสนทนา CRM) — _Stream stored media content of a message_ | — | `StreamableFile` |
| 300 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/messages` | `send` (L102) | `crm.inbox.reply` | ไม่ขาย(crm) | ส่ง (บทสนทนา CRM) — _Send a text reply to the customer via LINE_ | `B:SendCrmMessageInput` | `→ SendCrmInboxMessageUseCase.execute()` |
| 301 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/notes` | `note` (L115) | `crm.inbox.note` | ไม่ขาย(crm) | ดำเนินการ บันทึกช่วยจำ (บทสนทนา CRM) — _Append a staff-only internal note (never sent to the customer)_ | `B:SendCrmMessageInput` | `→ SendCrmInboxMessageUseCase.execute()` |
| 302 | PUT | `/v1/companies/:companyId/crm/conversations/:conversationId/status` | `status` (L126) | `crm.inbox.resolve` | ไม่ขาย(crm) | ตั้งค่า สถานะ (บทสนทนา CRM) — _Change conversation triage status_ | `B:SetCrmConversationStatusInput` | `→ SetCrmConversationStatusUseCase.execute()` |
| 303 | PUT | `/v1/companies/:companyId/crm/conversations/:conversationId/priority` | `priority` (L137) | `crm.inbox.resolve` | ไม่ขาย(crm) | ตั้งค่า ลำดับความสำคัญ (บทสนทนา CRM) — _Change conversation priority_ | `B:SetCrmConversationPriorityInput` | `→ SetCrmConversationPriorityUseCase.execute()` |
| 304 | PUT | `/v1/companies/:companyId/crm/conversations/:conversationId/auto-reply` | `autoReply` (L148) | `crm.inbox.reply` | ไม่ขาย(crm) | ตั้งค่า การตอบ อัตโนมัติ — _Enable or disable autonomous AI for one conversation_ | `B:UpdateCrmConversationAutoReplyRequest` | `→ UpdateCrmConversationAutoReplyUseCase.execute()` |
| 305 | PUT | `/v1/companies/:companyId/crm/conversations/:conversationId/tags` | `tags` (L159) | `crm.inbox.resolve` | ไม่ขาย(crm) | ตั้งค่า แท็ก (บทสนทนา CRM) — _Replace conversation tags_ | `B:SetCrmConversationTagsInput` | `→ SetCrmConversationTagsUseCase.execute()` |
| 306 | PUT | `/v1/companies/:companyId/crm/conversations/:conversationId/assign` | `assign` (L172) | `crm.inbox.read` | ไม่ขาย(crm) | มอบหมาย (บทสนทนา CRM) — _Assign or unassign the conversation (self pickup/release without assign permission)_ | `B:AssignCrmConversationInput` | `→ AssignCrmConversationUseCase.execute()` |
| 307 | POST | `/v1/companies/:companyId/crm/conversations/:conversationId/read` | `read` (L183) | `crm.inbox.read` | ไม่ขาย(crm) | อ่าน (บทสนทนา CRM) — _Mark the conversation as read_ | — | `→ MarkCrmConversationReadUseCase.execute()` |

**`CrmCustomer360Controller`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-customer-360.controller.ts` · base path: `/v1/companies/:companyId/crm/customers/:customerId` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 308 | GET | `/v1/companies/:companyId/crm/customers/:customerId/summary360` | `summary360` (L21) | `crm.customer.read` | ไม่ขาย(crm) | ดู สรุป 360 (customer360 CRM) — _Customer 360 aggregate read model (per-source permission redaction)_ | — | `→ GetCrmCustomer360SummaryUseCase.execute()` |
| 309 | GET | `/v1/companies/:companyId/crm/customers/:customerId/timeline` | `timeline` (L28) | `crm.customer.read` | ไม่ขาย(crm) | ดู ไทม์ไลน์ (customer360 CRM) — _Customer unified timeline, newest first (per-source permission redaction)_ | `Q{before,limit}` | `→ GetCrmCustomer360TimelineUseCase.execute()` |
| 310 | POST | `/v1/companies/:companyId/crm/customers/:customerId/erase` | `erase` (L40) | `crm.customer.erase` | ไม่ขาย(crm) | ลบข้อมูลส่วนบุคคล (customer360 CRM) — _PDPA erasure: scrub a customer's personal data (finance-linked records retained; audited)_ | `B:{ reason?: string }` | `→ EraseCrmCustomerUseCase.execute()` |

**`CrmCustomerPdpaController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-customer-pdpa.controller.ts` · base path: `/v1/crm-customer/pdpa` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 311 | POST | `/v1/crm-customer/pdpa/consent-withdraw` | `consentWithdraw` (L54) | Public — rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ การถอน ความยินยอม — _Customer LINE LIFF self-service consent withdrawal_ | `B:CrmCustomerPdpaDto` | `→ AuthRateLimitService.assertCustomerRegisterAllowed()` (200) |
| 312 | POST | `/v1/crm-customer/pdpa/data-export` | `dataExport` (L68) | Public — rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ การส่งออก ข้อมูล — _Customer LINE LIFF self-service data export_ | `B:CrmCustomerDataExportDto` | `→ AuthRateLimitService.assertCustomerRegisterAllowed()` (200) |
| 313 | POST | `/v1/crm-customer/pdpa/erasure-request` | `erasureRequest` (L93) | Public — rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ คำขอ การลบข้อมูลส่วนบุคคล — _Customer LINE LIFF self-service erasure request_ | `B:CrmCustomerErasureDto` | `→ AuthRateLimitService.assertCustomerRegisterAllowed()` (202) |
| 314 | POST | `/v1/crm-customer/pdpa/erasure-status` | `erasureStatus` (L107) | Public — rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ สถานะ การลบข้อมูลส่วนบุคคล — _Customer LINE LIFF self-service erasure request status_ | `B:CrmCustomerErasureStatusDto` | `→ AuthRateLimitService.assertCustomerRegisterAllowed()` (200) |

**`CrmInboxPolicyController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-inbox-policy.controller.ts` · base path: `/v1/companies/:companyId/crm/inbox-policy` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 315 | GET | `/v1/companies/:companyId/crm/inbox-policy` | `get` (L16) | `crm.inbox.policy_manage` | ไม่ขาย(crm) | ดูข้อมูล (นโยบาย กล่องข้อความ CRM) — _Get the inbox first-response SLA policy_ | — | `→ GetCrmInboxPolicyUseCase.execute()` |
| 316 | PUT | `/v1/companies/:companyId/crm/inbox-policy` | `update` (L23) | `crm.inbox.policy_manage` | ไม่ขาย(crm) | แก้ไข (นโยบาย กล่องข้อความ CRM) — _Update the inbox first-response SLA policy_ | `B:UpdateCrmInboxPolicyInput` | `→ UpdateCrmInboxPolicyUseCase.execute()` |

**`CrmInternalController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-internal.controller.ts` · base path: `/v1/internal/crm` · `@Public()` ระดับ class · 10 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 317 | POST | `/v1/internal/crm/campaign-delivery-scan` | `campaignDelivery` (L32) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การนำส่ง แคมเปญ | — | `→ DeliverCrmCampaignUseCase.execute()` |
| 318 | POST | `/v1/internal/crm/sla-breach-scan` | `slaBreachScan` (L38) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การสแกน การผิด SLA SLA | — | `→ ScanCrmSlaBreachesUseCase.execute()` |
| 319 | POST | `/v1/internal/crm/new-conversation-scan` | `newConversationScan` (L44) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การสแกน บทสนทนา ใหม่ | — | `→ ScanCrmNewConversationsUseCase.execute()` |
| 320 | POST | `/v1/internal/crm/inbox-retry-scan` | `inboxRetryScan` (L50) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การสแกน การลองใหม่ กล่องข้อความ | — | `→ RetryCrmInboxDeliveriesUseCase.execute()` |
| 321 | POST | `/v1/internal/crm/autonomy-retry-scan` | `autonomyRetryScan` (L56) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การสแกน การลองใหม่ ระดับอัตโนมัติ | — | `→ RetryCrmAutonomyJobsUseCase.execute()` |
| 322 | POST | `/v1/internal/crm/booking-reminder-scan` | `bookingReminderScan` (L62) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การสแกน การเตือน การจอง | — | `→ ScanCrmBookingRemindersUseCase.execute()` |
| 323 | POST | `/v1/internal/crm/booking-proposal-sweep` | `bookingProposalSweep` (L68) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การกวาดตรวจ ข้อเสนอ การจอง | — | `→ SweepCrmBookingProposalsUseCase.execute()` |
| 324 | POST | `/v1/internal/crm/pdpa-purge` | `pdpaPurge` (L74) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การล้างข้อมูล PDPA | — | `→ PurgeCrmPdpaUseCase.execute()` |
| 325 | POST | `/v1/internal/crm/pdpa-erasure-process` | `pdpaErasureProcess` (L80) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การประมวลผล การลบข้อมูลส่วนบุคคล PDPA | — | `→ ProcessCrmErasureRequestsUseCase.execute()` |
| 326 | POST | `/v1/internal/crm/pdpa-post-restore-re-erasure` | `pdpaPostRestoreReErasure` (L86) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การลบข้อมูลส่วนบุคคล re การกู้คืน การลงบัญชี PDPA | `B:{ restoredSnapshotAt?: unknown; confirm?: unknown }` | `→ ProcessCrmErasureRequestsUseCase.replayAfterRestore()` |

**`CrmLineWebhookController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-line-webhook.controller.ts` · base path: `/v1/` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 327 | POST | `/v1/crm/line/webhook/:webhookKey` | `receive` (L30) | Public — `x-line-signature` (HMAC-SHA256 ของ raw body) | แพลตฟอร์ม | รับ (webhook LINE CRM) — _Company LINE OA webhook receiver (per-channel key)_ | `B:raw(req.body)` | `Record<string, never>` (200) |

**`CrmReportsController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-reports.controller.ts` · base path: `/v1/companies/:companyId/crm/reports` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 328 | GET | `/v1/companies/:companyId/crm/reports/summary` | `summary` (L15) | `crm.report.read` | ไม่ขาย(crm) | ดู สรุป (รายงาน CRM) — _CRM reports summary with real LTV aggregation_ | `Q{branchId,period}` | `→ GetCrmReportsSummaryUseCase.execute()` |

**`CrmTemplateController`** — `apps/api/src/modules/crm-inbox/presentation/http/crm-template.controller.ts` · base path: `/v1/companies/:companyId/crm/templates` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 329 | GET | `/v1/companies/:companyId/crm/templates` | `list` (L25) | `crm.template.read` | ไม่ขาย(crm) | ดูรายการ (แม่แบบ CRM) — _List CRM message templates (quick replies)_ | `Q{includeArchived}` | `→ ListCrmMessageTemplatesUseCase.execute()` |
| 330 | POST | `/v1/companies/:companyId/crm/templates/:templateId/approve-ai` | `approveAi` (L32) | `crm.template.manage` | ไม่ขาย(crm) | อนุมัติ AI (แม่แบบ CRM) — _Approve the current CRM message template version for autonomous AI context_ | — | `→ ApproveCrmMessageTemplateForAiUseCase.execute()` (200) |
| 331 | POST | `/v1/companies/:companyId/crm/templates` | `create` (L40) | `crm.template.manage` | ไม่ขาย(crm) | สร้าง (แม่แบบ CRM) — _Create a CRM message template_ | `B:CreateCrmMessageTemplateInput` | `→ CreateCrmMessageTemplateUseCase.execute()` |
| 332 | POST | `/v1/companies/:companyId/crm/templates/:templateId` | `update` (L47) | `crm.template.manage` | ไม่ขาย(crm) | แก้ไข (แม่แบบ CRM) — _Update a CRM message template_ | `B:UpdateCrmMessageTemplateInput` | `→ UpdateCrmMessageTemplateUseCase.execute()` (200) |
| 333 | POST | `/v1/companies/:companyId/crm/templates/:templateId/archive` | `archive` (L59) | `crm.template.manage` | ไม่ขาย(crm) | เก็บเข้าคลัง (archive) (แม่แบบ CRM) — _Archive a CRM message template_ | — | `→ ArchiveCrmMessageTemplateUseCase.execute()` (200) |

**`CustomerLineRegisterController`** — `apps/api/src/modules/crm-inbox/presentation/http/customer-line-register.controller.ts` · base path: `/v1/auth` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 334 | POST | `/v1/auth/line/customer-register` | `customerRegister` (L41) | Public — rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ดำเนินการ ทะเบียน ลูกค้า — _Customer LINE LIFF self-registration_ | `B:CustomerLineRegisterDto` | `→ AuthRateLimitService.assertCustomerRegisterAllowed()` (200) |
| 335 | GET | `/v1/auth/line/customer-register-page` | `customerRegisterPage` (L61) | Public | แพลตฟอร์ม | ดู หน้า ทะเบียน ลูกค้า — _Customer LINE LIFF self-registration page_ | — | `string` |

**`MessagingChannelController`** — `apps/api/src/modules/crm-inbox/presentation/http/messaging-channel.controller.ts` · base path: `/v1/companies/:companyId/crm/channels` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 336 | GET | `/v1/companies/:companyId/crm/channels` | `list` (L35) | `crm.channel.read` | ไม่ขาย(line_oa) | ดูรายการ (ช่องทาง ข้อความ) — _List company messaging channels (masked credentials)_ | — | `→ ListMessagingChannelsUseCase.execute()` |
| 337 | POST | `/v1/companies/:companyId/crm/channels` | `connect` (L42) | `crm.channel.manage` | ไม่ขาย(line_oa) | เชื่อมต่อ (ช่องทาง ข้อความ) — _Connect a company LINE OA channel_ | `B:ConnectMessagingChannelInput` | `→ ConnectMessagingChannelUseCase.execute()` |
| 338 | PATCH | `/v1/companies/:companyId/crm/channels/:channelId/settings` | `updateSettings` (L49) | `crm.channel.manage` | ไม่ขาย(line_oa) | แก้ไข การตั้งค่า (ช่องทาง ข้อความ) — _Update channel autonomy and booking defaults_ | `B:UpdateMessagingChannelSettingsRequest` | `→ UpdateMessagingChannelSettingsUseCase.execute()` |
| 339 | POST | `/v1/companies/:companyId/crm/channels/:channelId/test` | `test` (L60) | `crm.channel.manage` | ไม่ขาย(line_oa) | ทดสอบ (ช่องทาง ข้อความ) — _Test channel connection against the LINE API_ | — | `→ TestMessagingChannelUseCase.execute()` |
| 340 | POST | `/v1/companies/:companyId/crm/channels/:channelId/rotate` | `rotate` (L67) | `crm.channel.manage` | ไม่ขาย(line_oa) | หมุนเวียน (rotate) (ช่องทาง ข้อความ) — _Rotate channel credentials_ | `B:RotateMessagingChannelCredentialInput` | `→ RotateMessagingChannelCredentialUseCase.execute()` |
| 341 | POST | `/v1/companies/:companyId/crm/channels/:channelId/disable` | `disable` (L78) | `crm.channel.manage` | ไม่ขาย(line_oa) | ปิดใช้งาน (ช่องทาง ข้อความ) — _Disable the channel (inbound webhooks are dropped)_ | `B:DisableMessagingChannelInput` | `→ DisableMessagingChannelUseCase.execute()` |
| 342 | POST | `/v1/companies/:companyId/crm/channels/:channelId/reveal` | `reveal` (L89) | `crm.channel.manage` | ไม่ขาย(line_oa) | เปิดดูข้อมูลที่ปกปิด (ช่องทาง ข้อความ) — _Reveal channel credentials (audited, high risk)_ | — | `→ RevealMessagingChannelCredentialUseCase.execute()` |

### 2.8 โมดูล `crm` — 53 endpoint

**`CrmAiController`** — `apps/api/src/modules/crm/presentation/http/crm-ai.controller.ts` · base path: `/v1/companies/:companyId/crm` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 343 | GET | `/v1/companies/:companyId/crm/dashboard/summary` | `dashboard` (L25) | `crm.report.read` | ไม่ขาย(crm) | ดู แดชบอร์ด (AI CRM) — _CRM dashboard summary_ | `Q{scope}` | `→ GetCrmDashboardSummaryUseCase.execute()` |
| 344 | GET | `/v1/companies/:companyId/crm/ai/follow-up-priorities` | `priorities` (L32) | `crm.ai.read` | ทุกแพ็ก [ai_line_assistant] | ดู ลำดับความสำคัญ (AI CRM) — _Read-only follow-up priorities (source-backed)_ | `Q{scope}` | `→ GetCrmFollowUpPrioritiesUseCase.execute()` |
| 345 | GET | `/v1/companies/:companyId/crm/ai/customers/:customerId/summary` | `customer` (L39) | `crm.ai.read` | ทุกแพ็ก [ai_line_assistant] | ดู ลูกค้า (AI CRM) — _Read-only customer summary (source-backed)_ | — | `→ GetCrmCustomerAiSummaryUseCase.execute()` |
| 346 | GET | `/v1/companies/:companyId/crm/ai/opportunities/:opportunityId/summary` | `opportunity` (L46) | `crm.ai.read` | ทุกแพ็ก [ai_line_assistant] | ดู โอกาสขาย (AI CRM) — _Read-only opportunity summary (source-backed)_ | — | `→ GetCrmOpportunityAiSummaryUseCase.execute()` |
| 347 | GET | `/v1/companies/:companyId/crm/ai/pipeline-summary` | `pipeline` (L53) | `crm.ai.read` | ทุกแพ็ก [ai_line_assistant] | ดู ไปป์ไลน์ (AI CRM) — _Read-only pipeline summary (source-backed)_ | `Q{scope}` | `→ GetCrmPipelineAiSummaryUseCase.execute()` |

**`CrmBookingController`** — `apps/api/src/modules/crm/presentation/http/crm-booking.controller.ts` · base path: `/v1/companies/:companyId/crm/bookings` · 8 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 348 | GET | `/v1/companies/:companyId/crm/bookings/settings` | `settings` (L29) | `crm.booking.read` | ไม่ขาย(crm) | ดู การตั้งค่า (การจอง CRM) — _Get company booking buffer settings_ | — | `→ GetCrmBookingSettingsUseCase.execute()` |
| 349 | PATCH | `/v1/companies/:companyId/crm/bookings/settings` | `updateSettingsValue` (L36) | `crm.booking.update` | ไม่ขาย(crm) | แก้ไข มูลค่า การตั้งค่า — _Update company booking buffer settings_ | `B:UpdateCrmBookingSettingsInput` | `→ UpdateCrmBookingSettingsUseCase.execute()` |
| 350 | GET | `/v1/companies/:companyId/crm/bookings` | `list` (L43) | `crm.booking.read` | ไม่ขาย(crm) | ดูรายการ (การจอง CRM) — _List bookings for the Bangkok ISO week containing weekStart (Sunday-start)_ | `Q{branchId,weekStart}` | `→ ListCrmBookingsUseCase.execute()` |
| 351 | GET | `/v1/companies/:companyId/crm/bookings/availability` | `availability` (L50) | `crm.booking.read` | ไม่ขาย(crm) | ดู ความพร้อมใช้ (การจอง CRM) — _List free appointment start times for a staff member on a Bangkok date_ | `Q{branchId,staffUserId,date,durationMinutes}` | `→ ListCrmBookingsUseCase.availability()` |
| 352 | GET | `/v1/companies/:companyId/crm/bookings/by-customer/:customerId` | `byCustomer` (L64) | `crm.booking.read` | ไม่ขาย(crm) | ดู ตาม ลูกค้า — _List a customer's appointments (Customer 360 tab)_ | — | `→ ListCrmCustomerBookingsUseCase.execute()` |
| 353 | POST | `/v1/companies/:companyId/crm/bookings` | `create` (L71) | `crm.booking.create` | ไม่ขาย(crm) | สร้าง (การจอง CRM) — _Create a booking_ | `B:CreateCrmBookingInput` | `→ CreateCrmBookingUseCase.execute()` |
| 354 | PATCH | `/v1/companies/:companyId/crm/bookings/:bookingId` | `update` (L78) | `crm.booking.update` | ไม่ขาย(crm) | แก้ไข (การจอง CRM) — _Update a booking_ | `B:UpdateCrmBookingInput` | `→ UpdateCrmBookingUseCase.execute()` |
| 355 | POST | `/v1/companies/:companyId/crm/bookings/:bookingId/cancel` | `cancel` (L85) | `crm.booking.cancel` | ไม่ขาย(crm) | ยกเลิก (การจอง CRM) — _Cancel a booking_ | — | `→ CancelCrmBookingUseCase.execute()` |

**`CrmCustomerController`** — `apps/api/src/modules/crm/presentation/http/crm-customer.controller.ts` · base path: `/v1/companies/:companyId/crm` · 12 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 356 | GET | `/v1/companies/:companyId/crm/customers` | `list` (L52) | `crm.customer.read` | ไม่ขาย(crm) | ดูรายการ (ลูกค้า CRM) — _List CRM customers_ | `Q{scope,status,ownerUserId,tier,search,sortBy,page,pageSize}` | `→ ListCrmCustomersUseCase.execute()` |
| 357 | POST | `/v1/companies/:companyId/crm/customers` | `create` (L70) | `crm.customer.create` | ไม่ขาย(crm) | สร้าง (ลูกค้า CRM) — _Create CRM customer_ | `B:CreateCrmCustomerInput` | `→ CreateCrmCustomerUseCase.execute()` |
| 358 | POST | `/v1/companies/:companyId/crm/customers/merge/preview` | `previewCustomerMerge` (L77) | `crm.customer.merge` | ไม่ขาย(crm) | ดูตัวอย่าง merge ลูกค้า — _Preview customer merge impact and conflicts_ | `B:MergeCrmCustomersInput` | `→ PreviewCrmCustomerMergeUseCase.execute()` |
| 359 | POST | `/v1/companies/:companyId/crm/customers/merge` | `mergeCustomer` (L84) | `crm.customer.merge` | ไม่ขาย(crm) | รวม ลูกค้า (CRM) — _Merge a secondary customer into a canonical primary customer_ | `B:MergeCrmCustomersInput` | `→ MergeCrmCustomersUseCase.execute()` |
| 360 | GET | `/v1/companies/:companyId/crm/customers/:customerId` | `get` (L91) | `crm.customer.read` | ไม่ขาย(crm) | ดูข้อมูล (ลูกค้า CRM) — _Get CRM customer detail_ | — | `→ GetCrmCustomerUseCase.execute()` |
| 361 | PATCH | `/v1/companies/:companyId/crm/customers/:customerId` | `update` (L98) | `crm.customer.update` | ไม่ขาย(crm) | แก้ไข (ลูกค้า CRM) — _Update CRM customer_ | `B:UpdateCrmCustomerInput` | `→ UpdateCrmCustomerUseCase.execute()` |
| 362 | POST | `/v1/companies/:companyId/crm/customers/:customerId/line-identities/:identityId/link` | `linkCustomerLineIdentity` (L105) | `crm.customer.merge` | ไม่ขาย(crm) | ผูก ตัวตน LINE ลูกค้า — _Explicitly re-point and verify a LINE identity for a canonical customer_ | `B:LinkCrmCustomerLineIdentityInput` | `→ LinkCrmCustomerLineIdentityUseCase.execute()` |
| 363 | POST | `/v1/companies/:companyId/crm/customers/:customerId/archive` | `archive` (L117) | `crm.customer.archive` | ไม่ขาย(crm) | เก็บเข้าคลัง (archive) (ลูกค้า CRM) — _Archive CRM customer_ | `B:ArchiveCrmCustomerInput` | `→ ArchiveCrmCustomerUseCase.execute()` |
| 364 | POST | `/v1/companies/:companyId/crm/customers/:customerId/assign` | `assign` (L124) | `crm.customer.assign` | ไม่ขาย(crm) | มอบหมาย (ลูกค้า CRM) — _Assign CRM customer owner_ | `B:AssignCrmCustomerInput` | `→ AssignCrmCustomerUseCase.execute()` |
| 365 | GET | `/v1/companies/:companyId/crm/customers/:customerId/contacts` | `contacts` (L131) | `crm.contact.read` | ไม่ขาย(crm) | ดู ผู้ติดต่อ (ลูกค้า CRM) — _List customer contacts_ | — | `→ ListCrmContactsUseCase.execute()` |
| 366 | POST | `/v1/companies/:companyId/crm/customers/:customerId/contacts` | `addContact` (L138) | `crm.contact.manage` | ไม่ขาย(crm) | เพิ่ม ข้อมูลติดต่อ (ลูกค้า CRM) — _Create customer contact_ | `B:CreateCrmContactInput` | `→ CreateCrmContactUseCase.execute()` |
| 367 | PATCH | `/v1/companies/:companyId/crm/contacts/:contactId` | `editContact` (L145) | `crm.contact.manage` | ไม่ขาย(crm) | แก้ไข ข้อมูลติดต่อ (ลูกค้า CRM) — _Update customer contact_ | `B:UpdateCrmContactInput` | `→ UpdateCrmContactUseCase.execute()` |

**`CrmFollowUpController`** — `apps/api/src/modules/crm/presentation/http/crm-follow-up.controller.ts` · base path: `/v1/companies/:companyId/crm/follow-ups` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 368 | GET | `/v1/companies/:companyId/crm/follow-ups` | `list` (L36) | `crm.follow_up.read` | ไม่ขาย(crm) | ดูรายการ (การติดตาม CRM) — _List CRM follow-ups_ | `Q{scope,status,view,customerId,opportunityId,ownerUserId,page,pageSize}` | `→ ListCrmFollowUpsUseCase.execute()` |
| 369 | POST | `/v1/companies/:companyId/crm/follow-ups` | `create` (L54) | `crm.follow_up.create` | ไม่ขาย(crm) | สร้าง (การติดตาม CRM) — _Create CRM follow-up_ | `B:CreateCrmFollowUpInput` | `→ CreateCrmFollowUpUseCase.execute()` |
| 370 | PATCH | `/v1/companies/:companyId/crm/follow-ups/:followUpId` | `update` (L61) | `crm.follow_up.update` | ไม่ขาย(crm) | แก้ไข (การติดตาม CRM) — _Update CRM follow-up_ | `B:UpdateCrmFollowUpInput` | `→ UpdateCrmFollowUpUseCase.execute()` |
| 371 | POST | `/v1/companies/:companyId/crm/follow-ups/:followUpId/complete` | `complete` (L68) | `crm.follow_up.complete` | ไม่ขาย(crm) | ยืนยันเสร็จสิ้น (การติดตาม CRM) — _Complete CRM follow-up (optionally chain next task)_ | `B:CompleteCrmFollowUpInput` | `→ CompleteCrmFollowUpUseCase.execute()` (200) |
| 372 | POST | `/v1/companies/:companyId/crm/follow-ups/:followUpId/snooze` | `snooze` (L76) | `crm.follow_up.update` | ไม่ขาย(crm) | เลื่อนเวลา (การติดตาม CRM) — _Snooze CRM follow-up_ | `B:SnoozeCrmFollowUpInput` | `→ SnoozeCrmFollowUpUseCase.execute()` (200) |
| 373 | POST | `/v1/companies/:companyId/crm/follow-ups/:followUpId/cancel` | `cancel` (L84) | `crm.follow_up.update` | ไม่ขาย(crm) | ยกเลิก (การติดตาม CRM) — _Cancel CRM follow-up_ | `B:CancelCrmFollowUpInput` | `→ CancelCrmFollowUpUseCase.execute()` (200) |

**`CrmLeadController`** — `apps/api/src/modules/crm/presentation/http/crm-lead.controller.ts` · base path: `/v1/companies/:companyId/crm/leads` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 374 | GET | `/v1/companies/:companyId/crm/leads` | `list` (L39) | `crm.lead.read` | ไม่ขาย(crm) | ดูรายการ (ลีด CRM) — _List CRM leads_ | `Q{scope,status,source,assignedToUserId,search,page,pageSize}` | `→ ListCrmLeadsUseCase.execute()` |
| 375 | POST | `/v1/companies/:companyId/crm/leads` | `create` (L56) | `crm.lead.create` | ไม่ขาย(crm) | สร้าง (ลีด CRM) — _Create CRM lead_ | `B:CreateCrmLeadInput` | `→ CreateCrmLeadUseCase.execute()` |
| 376 | GET | `/v1/companies/:companyId/crm/leads/:leadId` | `get` (L63) | `crm.lead.read` | ไม่ขาย(crm) | ดูข้อมูล (ลีด CRM) — _Get CRM lead_ | — | `→ GetCrmLeadUseCase.execute()` |
| 377 | PATCH | `/v1/companies/:companyId/crm/leads/:leadId` | `update` (L70) | `crm.lead.update` | ไม่ขาย(crm) | แก้ไข (ลีด CRM) — _Update CRM lead_ | `B:UpdateCrmLeadInput` | `→ UpdateCrmLeadUseCase.execute()` |
| 378 | POST | `/v1/companies/:companyId/crm/leads/:leadId/assign` | `assign` (L77) | `crm.lead.assign` | ไม่ขาย(crm) | มอบหมาย (ลีด CRM) — _Assign CRM lead_ | `B:AssignCrmLeadInput` | `→ AssignCrmLeadUseCase.execute()` (200) |
| 379 | POST | `/v1/companies/:companyId/crm/leads/:leadId/convert` | `convert` (L85) | `crm.lead.convert` | ไม่ขาย(crm) | แปลง (ลีด CRM) — _Convert CRM lead to customer/opportunity (idempotent)_ | `B:ConvertCrmLeadInput` | `→ ConvertCrmLeadUseCase.execute()` (200) |
| 380 | POST | `/v1/companies/:companyId/crm/leads/:leadId/disqualify` | `disqualify` (L93) | `crm.lead.disqualify` | ไม่ขาย(crm) | ตัดสิทธิ์ (ลีด CRM) — _Disqualify CRM lead_ | `B:DisqualifyCrmLeadInput` | `→ DisqualifyCrmLeadUseCase.execute()` (200) |

**`CrmOpportunityController`** — `apps/api/src/modules/crm/presentation/http/crm-opportunity.controller.ts` · base path: `/v1/companies/:companyId/crm` · 15 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 381 | GET | `/v1/companies/:companyId/crm/pipeline/stages` | `stages` (L62) | `crm.opportunity.read` | ไม่ขาย(crm) | ดู ขั้น (โอกาสขาย CRM) — _List pipeline stages_ | — | `→ ListCrmPipelineStagesUseCase.execute()` |
| 382 | PUT | `/v1/companies/:companyId/crm/pipeline/stages` | `configureStages` (L69) | `crm.pipeline.configure` | ไม่ขาย(crm) | ตั้งค่า ขั้น (โอกาสขาย CRM) — _Configure pipeline stages_ | `B:UpdateCrmPipelineStagesInput` | `→ UpdateCrmPipelineStagesUseCase.execute()` |
| 383 | GET | `/v1/companies/:companyId/crm/activities` | `activities` (L78) | `crm.activity.read` | ไม่ขาย(crm) | ดู กิจกรรม (โอกาสขาย CRM) — _List CRM activities_ | `Q{customerId,opportunityId,leadId,actorUserId,page,pageSize}` | `→ ListCrmActivitiesUseCase.execute()` |
| 384 | POST | `/v1/companies/:companyId/crm/activities` | `addActivity` (L94) | `crm.activity.create` | ไม่ขาย(crm) | เพิ่ม กิจกรรม (โอกาสขาย CRM) — _Append CRM activity_ | `B:CreateCrmActivityInput` | `→ CreateCrmActivityUseCase.execute()` |
| 385 | GET | `/v1/companies/:companyId/crm/opportunities/board` | `pipelineBoard` (L103) | `crm.opportunity.read` | ไม่ขาย(crm) | ดู บอร์ด ไปป์ไลน์ — _Pipeline board grouped by stage_ | `Q{scope}` | `→ GetCrmPipelineBoardUseCase.execute()` |
| 386 | GET | `/v1/companies/:companyId/crm/opportunities` | `list` (L110) | `crm.opportunity.read` | ไม่ขาย(crm) | ดูรายการ (โอกาสขาย CRM) — _List CRM opportunities_ | `Q{scope,status,stageId,customerId,ownerUserId,search,page,pageSize}` | `→ ListCrmOpportunitiesUseCase.execute()` |
| 387 | POST | `/v1/companies/:companyId/crm/opportunities` | `create` (L128) | `crm.opportunity.create` | ไม่ขาย(crm) | สร้าง (โอกาสขาย CRM) — _Create CRM opportunity_ | `B:CreateCrmOpportunityInput` | `→ CreateCrmOpportunityUseCase.execute()` |
| 388 | GET | `/v1/companies/:companyId/crm/opportunities/:opportunityId` | `get` (L135) | `crm.opportunity.read` | ไม่ขาย(crm) | ดูข้อมูล (โอกาสขาย CRM) — _Get CRM opportunity detail_ | — | `→ GetCrmOpportunityUseCase.execute()` |
| 389 | PATCH | `/v1/companies/:companyId/crm/opportunities/:opportunityId` | `update` (L142) | `crm.opportunity.update` | ไม่ขาย(crm) | แก้ไข (โอกาสขาย CRM) — _Update CRM opportunity_ | `B:UpdateCrmOpportunityInput` | `→ UpdateCrmOpportunityUseCase.execute()` |
| 390 | POST | `/v1/companies/:companyId/crm/opportunities/:opportunityId/stage` | `move` (L149) | `crm.opportunity.stage_move` | ไม่ขาย(crm) | ย้าย (โอกาสขาย CRM) — _Move opportunity stage_ | `B:MoveCrmOpportunityStageInput` | `→ MoveCrmOpportunityStageUseCase.execute()` (200) |
| 391 | POST | `/v1/companies/:companyId/crm/opportunities/:opportunityId/close` | `closeOpportunity` (L157) | `crm.opportunity.close` | ไม่ขาย(crm) | ปิด โอกาสขาย (CRM) — _Close opportunity won/lost_ | `B:CloseCrmOpportunityInput` | `→ CloseCrmOpportunityUseCase.execute()` (200) |
| 392 | POST | `/v1/companies/:companyId/crm/opportunities/:opportunityId/reopen` | `reopenOpportunity` (L165) | `crm.opportunity.reopen` | ไม่ขาย(crm) | เปิดใหม่ โอกาสขาย (CRM) — _Reopen terminal opportunity_ | `B:ReopenCrmOpportunityInput` | `→ ReopenCrmOpportunityUseCase.execute()` (200) |
| 393 | GET | `/v1/companies/:companyId/crm/opportunities/:opportunityId/quotations` | `quotations` (L175) | `crm.opportunity.read` | ไม่ขาย(crm) | ดู ใบเสนอราคา (โอกาสขาย CRM) — _List opportunity quotation links_ | — | `→ ListCrmQuotationLinksUseCase.execute()` |
| 394 | POST | `/v1/companies/:companyId/crm/opportunities/:opportunityId/quotation-drafts` | `createQuotationDraft` (L182) | `crm.quotation.link` | ไม่ขาย(crm) | สร้าง ร่าง ใบเสนอราคา — _Create/link a quotation draft (accounting item 08 boundary)_ | `B:CreateCrmQuotationDraftInput` | `→ CreateCrmQuotationDraftUseCase.execute()` |
| 395 | POST | `/v1/companies/:companyId/crm/opportunities/:opportunityId/quotations/:linkId/refresh` | `refresh` (L189) | `crm.opportunity.read` | ไม่ขาย(crm) | รีเฟรช (โอกาสขาย CRM) — _Refresh quotation link status from accounting_ | — | `→ RefreshCrmQuotationLinkUseCase.execute()` (200) |

### 2.9 โมดูล `dashboard-notifications` — 23 endpoint

**`DashboardController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/dashboard.controller.ts` · base path: `/v1/companies/:companyId/dashboard` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 396 | GET | `/v1/companies/:companyId/dashboard` | `getDashboard` (L23) | `dashboard.read` | ทุกแพ็ก [dashboard_notifications] | ดูข้อมูล แดชบอร์ด | `Q:GenerateDashboardSnapshotDto` | `→ GenerateSnapshotUseCase.execute()` |
| 397 | GET | `/v1/companies/:companyId/dashboard/expense-months` | `getExpenseMonths` (L34) | `dashboard.read` | ทุกแพ็ก [dashboard_notifications] | ดูข้อมูล เดือน รายจ่าย | `Q:ExpenseMonthsQueryDto` | `→ GenerateSnapshotUseCase.getExpenseMonths()` |
| 398 | GET | `/v1/companies/:companyId/dashboard/snapshots/latest` | `getLatestSnapshot` (L45) | `dashboard.read` | ทุกแพ็ก [dashboard_notifications] | ดูข้อมูล สแนปช็อต ล่าสุด | `Q:GenerateDashboardSnapshotDto` | `→ GenerateSnapshotUseCase.execute()` |
| 399 | POST | `/v1/companies/:companyId/dashboard/snapshots/generate` | `generateSnapshotManual` (L56) | `dashboard.snapshot.generate` | ทุกแพ็ก [dashboard_notifications] | สร้าง/ประมวลผล แบบกรอกเอง สแนปช็อต | `B:GenerateDashboardSnapshotDto` | `→ GenerateSnapshotUseCase.execute()` |

**`InternalNotificationSweepController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.ts` · base path: `/v1/internal/notifications` · `@Public()` ระดับ class · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 400 | POST | `/v1/internal/notifications/delivery-sweep` | `deliverySweep` (L37) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การกวาดตรวจ การนำส่ง | — | `→ ProcessDueNotificationDeliveriesUseCase.execute()` |
| 401 | POST | `/v1/internal/notifications/snapshot-sweep` | `generateSnapshots` (L43) | Public — `X-Worker-Token` | แพลตฟอร์ม | สร้าง/ประมวลผล สแนปช็อต (การกวาดตรวจ การแจ้งเตือน ภายใน) | — | `→ GenerateDashboardSnapshotsSweepUseCase.execute()` |
| 402 | POST | `/v1/internal/notifications/stock-low-sweep` | `scanStockLow` (L49) | Public — `X-Worker-Token` | แพลตฟอร์ม | สแกน/กวาดตรวจ ต่ำ สต๊อก | — | `→ ScanStockLowNotificationsSweepUseCase.execute()` |
| 403 | POST | `/v1/internal/notifications/daily-owner-summary-sweep` | `createDailySummaries` (L55) | Public — `X-Worker-Token` | แพลตฟอร์ม | สร้าง สรุป รายวัน | — | `→ CreateDailyOwnerSummariesSweepUseCase.execute()` |

**`InternalNotificationController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/internal.controller.ts` · base path: `/v1/internal/companies/:companyId` · `@Public()` ระดับ class · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 404 | POST | `/v1/internal/companies/:companyId/dashboard/snapshots/generate` | `handleGenerateSnapshot` (L105) | Public — `X-Worker-Token` | แพลตฟอร์ม | จัดการ สแนปช็อต การสร้าง | `B:GenerateDashboardSnapshotDto` | `→ GenerateSnapshotUseCase.execute()` |
| 405 | POST | `/v1/internal/companies/:companyId/notifications/scan/stock-low` | `stockLow` (L117) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ ต่ำ สต๊อก | — | `→ StockLowScanUseCase.execute()` |
| 406 | POST | `/v1/internal/companies/:companyId/notifications/daily-owner-summary` | `dailySummary` (L128) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ สรุป รายวัน | `B:DailyOwnerSummaryDto` | `→ CreateDailyOwnerSummaryUseCase.execute()` |
| 407 | POST | `/v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | `delivery` (L141) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การนำส่ง (การแจ้งเตือน ภายใน) | — | `→ ProcessQueuedDeliveryUseCase.execute()` |

**`NotificationController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/notification.controller.ts` · base path: `/v1/companies/:companyId/notifications` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 408 | GET | `/v1/companies/:companyId/notifications` | `list` (L31) | `notification.read` | ทุกแพ็ก [dashboard_notifications] | ดูรายการ (การแจ้งเตือน) | `Q:any` | `→ ListNotificationsUseCase.execute()` |
| 409 | GET | `/v1/companies/:companyId/notifications/unread-count` | `unreadCount` (L46) | `notification.read` | ทุกแพ็ก [dashboard_notifications] | ดู การนับ ที่ยังไม่อ่าน | — | `→ GetUnreadCountUseCase.execute()` |
| 410 | POST | `/v1/companies/:companyId/notifications/:notificationId/read` | `markOneRead` (L53) | `notification.read` | ทุกแพ็ก [dashboard_notifications] | ทำเครื่องหมาย การอ่าน | — | `→ MarkReadUseCase.execute()` |
| 411 | POST | `/v1/companies/:companyId/notifications/read-all` | `markAll` (L60) | `notification.read` | ทุกแพ็ก [dashboard_notifications] | ทำเครื่องหมาย ทั้งหมด (การแจ้งเตือน) | — | `→ MarkAllReadUseCase.execute()` |
| 412 | POST | `/v1/companies/:companyId/notifications/:notificationId/dismiss` | `dismiss` (L67) | `notification.read` | ทุกแพ็ก [dashboard_notifications] | ปิด/ไม่สนใจ (การแจ้งเตือน) | — | `→ DismissNotificationUseCase.execute()` |

**`NotificationPreferenceController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/notification.controller.ts` · base path: `/v1/companies/:companyId/notification-preferences` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 413 | GET | `/v1/companies/:companyId/notification-preferences` | `get` (L79) | `notification.preference.manage` | ไม่ขาย(dashboard_notifications.preferences) | ดูข้อมูล (ค่ากำหนด การแจ้งเตือน) | — | `→ GetPreferenceUseCase.execute()` |
| 414 | PUT | `/v1/companies/:companyId/notification-preferences` | `update` (L86) | `notification.preference.manage` | ไม่ขาย(dashboard_notifications.preferences) | แก้ไข (ค่ากำหนด การแจ้งเตือน) | `B:UpdateNotificationPreferenceDto` | `→ UpdatePreferenceUseCase.execute()` |

**`NotificationRuleController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/notification.controller.ts` · base path: `/v1/companies/:companyId/notification-rules` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 415 | GET | `/v1/companies/:companyId/notification-rules` | `list` (L98) | `notification.rule.manage` | ไม่ขาย(dashboard_notifications.rules) | ดูรายการ (กฎ การแจ้งเตือน) | — | `→ ListRulesUseCase.execute()` |
| 416 | PUT | `/v1/companies/:companyId/notification-rules/:ruleId` | `update` (L105) | `notification.rule.manage` | ไม่ขาย(dashboard_notifications.rules) | แก้ไข (กฎ การแจ้งเตือน) | `B:UpdateNotificationRuleDto` | `→ UpdateRuleUseCase.execute()` |

**`NotificationDeliveryController`** — `apps/api/src/modules/dashboard-notifications/presentation/http/notification.controller.ts` · base path: `/v1/companies/:companyId/notification-deliveries` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 417 | GET | `/v1/companies/:companyId/notification-deliveries` | `list` (L117) | `notification.delivery.read` | ทุกแพ็ก [dashboard_notifications] | ดูรายการ (การนำส่ง การแจ้งเตือน) | `Q:any` | `→ ListDeliveriesUseCase.execute()` |
| 418 | POST | `/v1/companies/:companyId/notification-deliveries/:deliveryId/retry` | `retry` (L124) | `notification.delivery.retry` | ทุกแพ็ก [dashboard_notifications] | ลองใหม่ (การนำส่ง การแจ้งเตือน) | — | `→ RetryDeliveryUseCase.execute()` |

### 2.10 โมดูล `data-model-core` — 21 endpoint

**`AttachmentController`** — `apps/api/src/modules/data-model-core/presentation/http/attachment.controller.ts` · base path: `/v1/companies/:companyId/attachments` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 419 | POST | `/v1/companies/:companyId/attachments/upload-intent` | `uploadIntent` (L23) | `attachment.create` | ทุกแพ็ก | อัปโหลด เจตนา (ไฟล์แนบ) | `B:CreateUploadIntentDto` | `→ CreateUploadIntentUseCase.execute()` |
| 420 | POST | `/v1/companies/:companyId/attachments/:attachmentId/complete` | `complete` (L30) | `attachment.create` | ทุกแพ็ก | ยืนยันเสร็จสิ้น (ไฟล์แนบ) | `B:CompleteAttachmentUploadDto` | `→ CompleteAttachmentUploadUseCase.execute()` |
| 421 | GET | `/v1/companies/:companyId/attachments/:attachmentId/download-url` | `downloadUrl` (L43) | `attachment.read` | ทุกแพ็ก | ดาวน์โหลด URL (ไฟล์แนบ) | `Q{disposition}` | `→ CreateDownloadUrlUseCase.execute()` |
| 422 | POST | `/v1/companies/:companyId/attachments/:attachmentId/links` | `link` (L58) | `attachment.create` | ทุกแพ็ก | ผูก (ไฟล์แนบ) | `B:LinkAttachmentDto` | `→ LinkAttachmentUseCase.execute()` |
| 423 | DELETE | `/v1/companies/:companyId/attachments/:attachmentId` | `remove` (L70) | `attachment.delete` | ทุกแพ็ก | นำออก (ไฟล์แนบ) | — | `→ DeleteAttachmentUseCase.execute()` |

**`BranchController`** — `apps/api/src/modules/data-model-core/presentation/http/branch.controller.ts` · base path: `/v1/companies/:companyId/branches` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 424 | GET | `/v1/companies/:companyId/branches` | `list` (L19) | any(`company.branch.read` \| `company.branch.manage`) | ทุกแพ็ก [company_settings] | ดูรายการ (สาขา) | `Q:any` | `→ ListBranchesUseCase.execute()` |
| 425 | POST | `/v1/companies/:companyId/branches` | `create` (L31) | `company.branch.manage` | ทุกแพ็ก [company_settings] | สร้าง (สาขา) | `B:CreateBranchDto` | `→ CreateBranchUseCase.execute()` |
| 426 | PATCH | `/v1/companies/:companyId/branches/:branchId` | `update` (L38) | `company.branch.manage` | ทุกแพ็ก [company_settings] | แก้ไข (สาขา) | `B:UpdateBranchDto` | `→ UpdateBranchUseCase.execute()` |

**`CompanyIdentityController`** — `apps/api/src/modules/data-model-core/presentation/http/company-identity.controller.ts` · base path: `/v1/companies/:companyId/identity` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 427 | GET | `/v1/companies/:companyId/identity` | `get` (L61) | any(`company.setup.read` \| `company.setup.manage`) | ทุกแพ็ก | ดูข้อมูล (ตัวตน บริษัท) — _Read company tax identity, filtered per permission_ | — | `→ CompanyIdentityUseCase.get()` |
| 428 | PATCH | `/v1/companies/:companyId/identity` | `patch` (L69) | `company.legal_identity.manage` | ทุกแพ็ก | แก้ไขบางส่วน (ตัวตน บริษัท) — _Change the company legal tax identity_ | `B:PatchCompanyIdentityBodyDto` | `→ CompanyIdentityUseCase.patch()` |
| 429 | POST | `/v1/companies/:companyId/identity/complete-capture` | `completeCapture` (L81) | `company.legal_identity.manage` | ทุกแพ็ก | ยืนยันเสร็จสิ้น การจับภาพเอกสาร (ตัวตน บริษัท) — _Confirm the captured identity and close the capture window_ | `B:CompleteCaptureBodyDto` | `→ CompanyIdentityUseCase.completeCapture()` (200) |
| 430 | PATCH | `/v1/companies/:companyId/identity/business-type` | `patchBusinessType` (L94) | `company.legal_identity.manage` | ทุกแพ็ก | แก้ไขบางส่วน ประเภท ธุรกิจ — _Update the self-reported DBD TSIC activity without changing tax identity_ | `B:PatchCompanyBusinessTypeBodyDto` | `→ CompanyIdentityUseCase.patchBusinessType()` |

**`CompanyVatRegistrationController`** — `apps/api/src/modules/data-model-core/presentation/http/company-vat-registration.controller.ts` · base path: `/v1/companies/:companyId/vat-registration` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 431 | GET | `/v1/companies/:companyId/vat-registration` | `get` (L54) | `company.vat_registration.read` | ทุกแพ็ก | ดูข้อมูล (การจดทะเบียน VAT บริษัท) — _Read VAT registration status, optionally as of a date_ | `Q{asOf}` | `→ CompanyVatRegistrationUseCase.get()` |
| 432 | PUT | `/v1/companies/:companyId/vat-registration` | `put` (L66) | `company.vat_registration.manage` | ทุกแพ็ก | แทนที่ (การจดทะเบียน VAT บริษัท) — _Answer or correct the VAT registration status_ | `B:PutVatRegistrationBodyDto` | `→ CompanyVatRegistrationUseCase.put()` |

**`DocumentSequenceController`** — `apps/api/src/modules/data-model-core/presentation/http/document-sequence.controller.ts` · base path: `/v1/companies/:companyId/document-sequences` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 433 | GET | `/v1/companies/:companyId/document-sequences` | `list` (L17) | `document.sequence.read` | ทุกแพ็ก | ดูรายการ (ลำดับเลขที่ เอกสาร) | `Q:any` | `→ ListDocumentSequencesUseCase.execute()` |
| 434 | PUT | `/v1/companies/:companyId/document-sequences/:documentType` | `upsert` (L29) | `document.sequence.manage` | ทุกแพ็ก | สร้างหรือแก้ไข (ลำดับเลขที่ เอกสาร) | `B:UpsertDocumentSequenceDto` | `→ UpsertDocumentSequenceUseCase.execute()` |

**`LocalStorageController`** — `apps/api/src/modules/data-model-core/presentation/http/local-storage.controller.ts` · base path: `/local-storage` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 435 | PUT | `/local-storage/upload/:token` | `upload` (L16) | Public — ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | แพลตฟอร์ม | อัปโหลด (ที่เก็บไฟล์ local) | — | `void` (204) |
| 436 | GET | `/local-storage/download/:token` | `download` (L30) | Public — ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | แพลตฟอร์ม | ดาวน์โหลด (ที่เก็บไฟล์ local) | `Q{contentType,versionId}` | `void` |

**`ObjectVersionCleanupInternalController`** — `apps/api/src/modules/data-model-core/presentation/http/object-version-cleanup-internal.controller.ts` · base path: `/v1/internal/storage-cleanup/object-versions` · `@Public()` ระดับ class · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 437 | POST | `/v1/internal/storage-cleanup/object-versions/claim` | `claim` (L11) | Public — `X-Worker-Token` | แพลตฟอร์ม | รับสิทธิ์/จอง (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) | `B:{ batchSize?: number }` | `→ ObjectVersionCleanupService.claim()` |
| 438 | POST | `/v1/internal/storage-cleanup/object-versions/:id/complete` | `complete` (L17) | Public — `X-Worker-Token` | แพลตฟอร์ม | ยืนยันเสร็จสิ้น (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) | `B:{ claimToken: string }` | `→ ObjectVersionCleanupService.complete()` |
| 439 | POST | `/v1/internal/storage-cleanup/object-versions/:id/fail` | `fail` (L27) | Public — `X-Worker-Token` | แพลตฟอร์ม | บันทึกว่าล้มเหลว (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) | `B:{ claimToken: string; errorCode: string }` | `→ ObjectVersionCleanupService.fail()` |

### 2.11 โมดูล `data-rights` — 13 endpoint

**`DataRightsController`** — `apps/api/src/modules/data-rights/data-rights.controller.ts` · base path: `/v1/system/data-rights` · สิทธิ์ระดับ class: `system.data_rights.manage` · 13 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 440 | POST | `/v1/system/data-rights/cases` | `create` (L145) | `system.data_rights.manage` | แพลตฟอร์ม | สร้าง (สิทธิ์เจ้าของข้อมูล ข้อมูล) — _Open a restricted user/company data-rights case_ | `B:CreateCaseDto` | `→ DataRightsService.createCase()` |
| 441 | GET | `/v1/system/data-rights/cases` | `list` (L151) | `system.data_rights.manage` | แพลตฟอร์ม | ดูรายการ (สิทธิ์เจ้าของข้อมูล ข้อมูล) — _List data-rights cases with explicit safe fields and cursor paging_ | `Q:ListCasesQueryDto` | `→ DataRightsService.listCases()` |
| 442 | GET | `/v1/system/data-rights/cases/:caseId` | `get` (L157) | `system.data_rights.manage` | แพลตฟอร์ม | ดูข้อมูล (สิทธิ์เจ้าของข้อมูล ข้อมูล) — _Read one data-rights case and its append-only evidence trail_ | — | `→ DataRightsService.getCase()` |
| 443 | POST | `/v1/system/data-rights/cases/:caseId/verify-identity` | `verifyIdentity` (L163) | `system.data_rights.manage` | แพลตฟอร์ม | ตรวจยืนยัน ตัวตน (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:VerifyIdentityDto` | `→ DataRightsService.verifyIdentity()` (200) |
| 444 | POST | `/v1/system/data-rights/cases/:caseId/verify-authority` | `verifyAuthority` (L169) | `system.data_rights.manage` | แพลตฟอร์ม | ตรวจยืนยัน อำนาจ (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:VerifyAuthorityDto` | `→ DataRightsService.verifyAuthority()` (200) |
| 445 | POST | `/v1/system/data-rights/cases/:caseId/begin-retention-review` | `beginRetentionReview` (L175) | `system.data_rights.manage` | แพลตฟอร์ม | เริ่ม การตรวจทาน การเก็บรักษา | `B:CommandDto` | `→ DataRightsService.beginRetentionReview()` (200) |
| 446 | POST | `/v1/system/data-rights/cases/:caseId/decisions` | `recordDecision` (L181) | `system.data_rights.manage` | แพลตฟอร์ม | บันทึก การตัดสินใจ (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:RecordDecisionDto` | `→ DataRightsService.recordDecision()` (200) |
| 447 | POST | `/v1/system/data-rights/cases/:caseId/evidence` | `recordEvidence` (L187) | `system.data_rights.manage` | แพลตฟอร์ม | บันทึก หลักฐาน (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:RecordEvidenceDto` | `→ DataRightsService.recordEvidence()` (200) |
| 448 | POST | `/v1/system/data-rights/cases/:caseId/approve` | `approve` (L193) | `system.data_rights.manage` | แพลตฟอร์ม | อนุมัติ (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:SameActorStepDto` | `→ DataRightsService.approve()` (200) |
| 449 | POST | `/v1/system/data-rights/cases/:caseId/start-execution` | `startExecution` (L199) | `system.data_rights.manage` | แพลตฟอร์ม | เริ่ม การดำเนินการ (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:SameActorStepDto` | `→ DataRightsService.startExecution()` (200) |
| 450 | POST | `/v1/system/data-rights/cases/:caseId/start-verification` | `startVerification` (L205) | `system.data_rights.manage` | แพลตฟอร์ม | เริ่ม การยืนยัน (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:SameActorStepDto` | `→ DataRightsService.startVerification()` (200) |
| 451 | POST | `/v1/system/data-rights/cases/:caseId/complete` | `complete` (L211) | `system.data_rights.manage` | แพลตฟอร์ม | ยืนยันเสร็จสิ้น (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:CompleteCaseDto` | `→ DataRightsService.complete()` (200) |
| 452 | POST | `/v1/system/data-rights/cases/:caseId/close` | `close` (L217) | `system.data_rights.manage` | แพลตฟอร์ม | ปิด (สิทธิ์เจ้าของข้อมูล ข้อมูล) | `B:CloseCaseDto` | `→ DataRightsService.close()` (200) |

### 2.12 โมดูล `employee-access` — 33 endpoint

**`AccessCatalogController`** — `apps/api/src/modules/employee-access/presentation/http/access-catalog.controller.ts` · base path: `/v1/companies/:companyId/settings` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 453 | GET | `/v1/companies/:companyId/settings/address-master` | `addresses` (L23) | any(`access.employee.read` \| `access.employee.create` \| `access.employee.update` \| `company.setup.read` \| `company.legal_identity.read` \| `company.legal_identity.manage`) | ทุกแพ็ก [employee_access] | ดู ที่อยู่ (แค็ตตาล็อก การเข้าถึง) — _List Thai address master rows for a five-digit postal code_ | `Q{postalCode}` | `→ ListThaiAddressesUseCase.execute()` |
| 454 | GET | `/v1/companies/:companyId/settings/capability-packs` | `packs` (L30) | any(`access.capability_pack.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดู ชุดสิทธิ์ (แค็ตตาล็อก การเข้าถึง) — _List capability packs grouped by module with per-company lock/grantable state_ | — | `→ ListCapabilityPacksUseCase.execute()` |
| 455 | GET | `/v1/companies/:companyId/settings/role-templates` | `templates` (L37) | any(`access.role_template.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดู แม่แบบ (แค็ตตาล็อก การเข้าถึง) — _List job presets (role templates)_ | — | `→ ListRoleTemplatesUseCase.execute()` |
| 456 | GET | `/v1/companies/:companyId/settings/effective-access` | `matrix` (L44) | `access.effective.read` | ทุกแพ็ก [employee_access] | ดู ตาราง (แค็ตตาล็อก การเข้าถึง) — _Who-can-do-what matrix for active company members_ | — | `→ GetEffectiveAccessUseCase.matrix()` |
| 457 | GET | `/v1/companies/:companyId/settings/effective-access/:membershipId` | `member` (L51) | `access.effective.read` | ทุกแพ็ก [employee_access] | ดู สมาชิก (แค็ตตาล็อก การเข้าถึง) — _Effective access for one membership_ | — | `→ GetEffectiveAccessUseCase.forMembership()` |
| 458 | GET | `/v1/companies/:companyId/settings/access/matrix` | `accessMatrix` (L58) | any(`access.role.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดู ตาราง การเข้าถึง — _Role x menu x action permission matrix (มั่งมี Flow A projection over permission keys)_ | — | `→ GetAccessMatrixUseCase.execute()` |

**`BusinessPolicyController`** — `apps/api/src/modules/employee-access/presentation/http/business-policy.controller.ts` · base path: `/v1/companies/:companyId/settings` · 8 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 459 | GET | `/v1/companies/:companyId/settings/discount-policy` | `getDiscount` (L13) | `crm.customer.read` | ไม่ขาย(crm) | ดูข้อมูล ส่วนลด (นโยบาย ธุรกิจ) — _Get company discount policy_ | — | `→ BusinessPolicyUseCase.getDiscount()` |
| 460 | PUT | `/v1/companies/:companyId/settings/discount-policy` | `saveDiscount` (L18) | `crm.customer.update` | ไม่ขาย(crm) | บันทึก ส่วนลด (นโยบาย ธุรกิจ) — _Replace company discount policy_ | `B:DiscountPolicy` | `→ BusinessPolicyUseCase.saveDiscount()` |
| 461 | GET | `/v1/companies/:companyId/settings/po-approval` | `getPoApproval` (L25) | `procurement.purchase_order.read` | ไม่ขาย(procurement) | ดูข้อมูล การอนุมัติ ใบสั่งซื้อ — _Get company PO approval policy_ | — | `→ BusinessPolicyUseCase.getPoApproval()` |
| 462 | PUT | `/v1/companies/:companyId/settings/po-approval` | `savePoApproval` (L30) | `procurement.purchase_order.manage` | ไม่ขาย(procurement) | บันทึก การอนุมัติ ใบสั่งซื้อ — _Replace company PO approval policy_ | `B:PoApprovalPolicy` | `→ BusinessPolicyUseCase.savePoApproval()` |
| 463 | GET | `/v1/companies/:companyId/settings/retention-policy` | `getRetention` (L37) | `crm.channel.read` | ไม่ขาย(line_oa) | ดูข้อมูล การเก็บรักษา (นโยบาย ธุรกิจ) | — | `→ BusinessPolicyUseCase.getRetention()` |
| 464 | PUT | `/v1/companies/:companyId/settings/retention-policy` | `saveRetention` (L41) | `crm.channel.manage` | ไม่ขาย(line_oa) | บันทึก การเก็บรักษา (นโยบาย ธุรกิจ) | `B:DataRetentionPolicy` | `→ BusinessPolicyUseCase.saveRetention()` |
| 465 | GET | `/v1/companies/:companyId/settings/consent-policy` | `getConsent` (L45) | `crm.channel.read` | ไม่ขาย(line_oa) | ดูข้อมูล ความยินยอม (นโยบาย ธุรกิจ) | — | `→ BusinessPolicyUseCase.getConsent()` |
| 466 | PUT | `/v1/companies/:companyId/settings/consent-policy` | `saveConsent` (L49) | `crm.channel.manage` | ไม่ขาย(line_oa) | บันทึก ความยินยอม (นโยบาย ธุรกิจ) | `B:ConsentUnsubscribePolicy` | `→ BusinessPolicyUseCase.saveConsent()` |

**`EmployeeController`** — `apps/api/src/modules/employee-access/presentation/http/employee.controller.ts` · base path: `/v1/companies/:companyId/settings/employees` · 10 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 467 | GET | `/v1/companies/:companyId/settings/employees` | `list` (L34) | `access.employee.read` | ทุกแพ็ก [employee_access] | ดูรายการ (พนักงาน) — _List employee access profiles_ | — | `→ ListEmployeesUseCase.execute()` |
| 468 | GET | `/v1/companies/:companyId/settings/employees/:employeeId` | `get` (L41) | any(`access.employee.read` \| `access.employee.update`) | ทุกแพ็ก [employee_access] | ดูข้อมูล (พนักงาน) — _Get employee access profile detail_ | — | `→ GetEmployeeUseCase.execute()` |
| 469 | POST | `/v1/companies/:companyId/settings/employees` | `create` (L48) | `access.employee.create` | ทุกแพ็ก [employee_access] | สร้าง (พนักงาน) — _Create employee access (user, membership, role, temporary password, LINE link QR)_ | `B:CreateEmployeeDto` | `→ CreateEmployeeUseCase.execute()` |
| 470 | POST | `/v1/companies/:companyId/settings/employees/:employeeId/complete` | `complete` (L64) | `access.employee.create` | ทุกแพ็ก [employee_access] | ยืนยันเสร็จสิ้น (พนักงาน) — _Complete an employee draft and activate its company membership_ | — | `→ CreateEmployeeUseCase.completeDraft()` |
| 471 | PATCH | `/v1/companies/:companyId/settings/employees/:employeeId` | `update` (L77) | `access.employee.update` | ทุกแพ็ก [employee_access] | แก้ไข (พนักงาน) — _Update employee profile, identity, role, and branch assignment_ | `B:UpdateEmployeeDto` | `→ UpdateEmployeeUseCase.execute()` |
| 472 | POST | `/v1/companies/:companyId/settings/employees/:employeeId/disable` | `disable` (L94) | `access.employee.disable` | ทุกแพ็ก [employee_access] | ปิดใช้งาน (พนักงาน) — _Disable or suspend employee access_ | `B:SetEmployeeStatusDto` | `→ SetEmployeeStatusUseCase.execute()` |
| 473 | DELETE | `/v1/companies/:companyId/settings/employees/:employeeId/draft` | `deleteDraft` (L110) | `access.employee.disable` | ทุกแพ็ก [employee_access] | ลบ ร่าง (พนักงาน) — _Delete an unfinished company employee draft, preserving its login account_ | — | `→ DeleteEmployeeDraftUseCase.execute()` (204) |
| 474 | POST | `/v1/companies/:companyId/settings/employees/:employeeId/credentials/regenerate` | `regenerate` (L124) | `access.employee.credential.issue` | ทุกแพ็ก [employee_access] | สร้างใหม่ (พนักงาน) — _Regenerate a one-time temporary password for the employee_ | — | `→ RegenerateEmployeeCredentialUseCase.execute()` |
| 475 | POST | `/v1/companies/:companyId/settings/employees/:employeeId/line-link-token` | `issueLineLink` (L136) | `access.employee.line_link.issue` | ทุกแพ็ก [employee_access] | ออกเอกสาร ลิงก์/การผูก LINE — _Issue a short-lived LINE account-link QR/URL package_ | — | `→ IssueEmployeeLineLinkTokenUseCase.execute()` |
| 476 | POST | `/v1/companies/:companyId/settings/employees/:employeeId/line-link-token/revoke` | `revokeLineLink` (L149) | `access.employee.line_link.revoke` | ทุกแพ็ก [employee_access] | เพิกถอน ลิงก์/การผูก LINE — _Revoke any pending LINE account-link token for the employee_ | — | `→ RevokeEmployeeLineLinkTokenUseCase.execute()` |

**`EntitlementExceptionController`** — `apps/api/src/modules/employee-access/presentation/http/entitlement-exception.controller.ts` · base path: `/v1/system/entitlement-exceptions` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 477 | GET | `/v1/system/entitlement-exceptions` | `list` (L47) | `system.entitlement_exception.manage` | แพลตฟอร์ม | ดูรายการ (ข้อยกเว้น สิทธิ์ใช้ฟีเจอร์) — _Companies blocked on an entitlement dependency, with Thai feature names_ | — | `→ EntitlementExceptionUseCase.list()` |
| 478 | POST | `/v1/system/entitlement-exceptions/resolve` | `resolve` (L55) | `system.entitlement_exception.manage` | แพลตฟอร์ม | แก้ไข/ปิดประเด็น (ข้อยกเว้น สิทธิ์ใช้ฟีเจอร์) — _Resolve one exception: enable the prerequisite, or disable the dependents_ | `B:ResolveEntitlementExceptionBodyDto` | `→ EntitlementExceptionUseCase.resolve()` (200) |

**`PermissionController`** — `apps/api/src/modules/employee-access/presentation/http/permission.controller.ts` · base path: `/v1/companies/:companyId/settings/permissions` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 479 | GET | `/v1/companies/:companyId/settings/permissions` | `list` (L11) | any(`access.permission.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดูรายการ (สิทธิ์) — _List the registered permission catalog grouped by module_ | — | `→ ListPermissionsUseCase.execute()` |

**`RoleController`** — `apps/api/src/modules/employee-access/presentation/http/role.controller.ts` · base path: `/v1/companies/:companyId/settings/roles` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 480 | GET | `/v1/companies/:companyId/settings/roles` | `list` (L26) | any(`access.role.read` \| `access.role.manage` \| `access.employee.create` \| `access.employee.update`) | ทุกแพ็ก [employee_access] | ดูรายการ (บทบาท) — _List system and company custom roles_ | — | `→ ListRolesUseCase.execute()` |
| 481 | GET | `/v1/companies/:companyId/settings/roles/:roleId` | `get` (L37) | any(`access.role.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดูข้อมูล (บทบาท) — _Get role detail with permission keys_ | — | `→ GetRoleUseCase.execute()` |
| 482 | POST | `/v1/companies/:companyId/settings/roles/preview` | `preview` (L44) | any(`access.role.read` \| `access.role.manage`) | ทุกแพ็ก [employee_access] | ดูตัวอย่าง (บทบาท) — _Preview effective permissions of packs/preset/keys without saving_ | `B:RolePreviewDto` | `→ PreviewRoleUseCase.execute()` |
| 483 | POST | `/v1/companies/:companyId/settings/roles` | `create` (L56) | `access.role.manage` | ทุกแพ็ก [employee_access] | สร้าง (บทบาท) — _Create a company custom role_ | `B:CreateRoleDto` | `→ CreateRoleUseCase.execute()` |
| 484 | PATCH | `/v1/companies/:companyId/settings/roles/:roleId` | `update` (L70) | `access.role.manage` | ทุกแพ็ก [employee_access] | แก้ไข (บทบาท) — _Update a company custom role_ | `B:UpdateRoleDto` | `→ UpdateRoleUseCase.execute()` |
| 485 | POST | `/v1/companies/:companyId/settings/roles/:roleId/disable` | `disable` (L85) | `access.role.manage` | ทุกแพ็ก [employee_access] | ปิดใช้งาน (บทบาท) — _Disable a company custom role_ | — | `→ DisableRoleUseCase.execute()` |

### 2.13 โมดูล `executive-business` — 15 endpoint

**`ExecutiveInternalController`** — `apps/api/src/modules/executive-business/presentation/http/executive-internal.controller.ts` · base path: `/v1/internal/executive` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 486 | POST | `/v1/internal/executive/rebuild` | `rebuild` (L18) | Public — `X-Worker-Token` | แพลตฟอร์ม | สร้างใหม่ทั้งชุด (ภายใน ผู้บริหาร) — _Build the executive report summary tables: every hour the recent months, once a day every month (idempotent)_ | — | `ExecutiveRebuildResult` |

**`ExecutiveReportController`** — `apps/api/src/modules/executive-business/presentation/http/executive-report.controller.ts` · base path: `/v1/system/executive` · 8 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 487 | PATCH | `/v1/system/executive/companies/:targetCompanyId` | `updateNote` (L145) | `system.executive.read` + `system.executive.company_note.manage` | แพลตฟอร์ม | แก้ไข บันทึกช่วยจำ (รายงาน ผู้บริหาร) | `B:ExecutiveCompanyNoteDto` | `→ ExecutiveReportReadService.updateNote()` |
| 488 | GET | `/v1/system/executive/context` | `context` (L153) | `system.executive.read` | แพลตฟอร์ม | ดู บริบท (รายงาน ผู้บริหาร) | — | `→ ExecutiveReportReadService.context()` |
| 489 | GET | `/v1/system/executive/overview` | `overview` (L161) | `system.executive.read` | แพลตฟอร์ม | ดู ภาพรวม (รายงาน ผู้บริหาร) | `Q:ExecutiveReportQueryDto` | `→ ExecutiveReportReadService.overview()` |
| 490 | GET | `/v1/system/executive/companies` | `companies` (L169) | `system.executive.read` | แพลตฟอร์ม | ดู บริษัท (รายงาน ผู้บริหาร) | `Q:ExecutiveCompaniesQueryDto` | `→ ExecutiveReportReadService.companies()` |
| 491 | GET | `/v1/system/executive/analysis` | `analysis` (L177) | `system.executive.read` | แพลตฟอร์ม | ดู การวิเคราะห์ (รายงาน ผู้บริหาร) | `Q:ExecutiveAnalysisQueryDto` | `→ ExecutiveReportReadService.analysis()` |
| 492 | POST | `/v1/system/executive/exports` | `export` (L185) | `system.executive.read` + `system.executive.export` | แพลตฟอร์ม | ส่งออก (รายงาน ผู้บริหาร) | `B:ExecutiveExportDto` | `→ ExecutiveReportReadService.export()` (200) |
| 493 | GET | `/v1/system/executive/companies/:targetCompanyId` | `company` (L203) | `system.executive.read` | แพลตฟอร์ม | ดู บริษัท (รายงาน ผู้บริหาร) | `Q:ExecutiveCompanyQueryDto` | `→ ExecutiveReportReadService.company()` |
| 494 | GET | `/v1/system/executive/companies/:targetCompanyId/history` | `history` (L211) | `system.executive.read` | แพลตฟอร์ม | ดู ประวัติ (รายงาน ผู้บริหาร) | `Q:ExecutiveHistoryQueryDto` | `→ ExecutiveReportReadService.history()` |

**`ExecutiveUsersController`** — `apps/api/src/modules/executive-business/presentation/http/executive-users.controller.ts` · base path: `/v1/system/executive-users` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 495 | GET | `/v1/system/executive-users` | `list` (L67) | `system.executive_user.manage` | แพลตฟอร์ม | ดูรายการ (ผู้ใช้ ผู้บริหาร) | `Q:ExecutiveUserListQueryDto` | `→ ExecutiveUsersService.list()` |
| 496 | POST | `/v1/system/executive-users` | `create` (L75) | `system.executive_user.manage` | แพลตฟอร์ม | สร้าง (ผู้ใช้ ผู้บริหาร) | `B:ExecutiveUserCreateDto` | `→ ExecutiveUsersService.create()` (201) |
| 497 | GET | `/v1/system/executive-users/:userId` | `detail` (L84) | `system.executive_user.manage` | แพลตฟอร์ม | ดู รายละเอียด (ผู้ใช้ ผู้บริหาร) | — | `→ ExecutiveUsersService.detail()` |
| 498 | POST | `/v1/system/executive-users/:userId/status` | `status` (L92) | `system.executive_user.manage` | แพลตฟอร์ม | ดำเนินการ สถานะ (ผู้ใช้ ผู้บริหาร) | `B:ExecutiveUserStatusDto` | `→ ExecutiveUsersService.setStatus()` (200) |
| 499 | POST | `/v1/system/executive-users/:userId/credential` | `credential` (L101) | `system.executive_user.manage` | แพลตฟอร์ม | ดำเนินการ ข้อมูลรับรอง (ผู้ใช้ ผู้บริหาร) | `B:ExecutiveUserCredentialDto` | `→ ExecutiveUsersService.resetCredential()` (200) |
| 500 | POST | `/v1/system/executive-users/:userId/access` | `access` (L110) | `system.executive_user.manage` | แพลตฟอร์ม | ดำเนินการ การเข้าถึง (ผู้ใช้ ผู้บริหาร) | `B:ExecutiveUserAccessDto` | `→ ExecutiveUsersService.setAccess()` (200) |

### 2.14 โมดูล `expenses` — 128 endpoint

**`DisbursementVoucherController`** — `apps/api/src/modules/expenses/presentation/http/disbursement-voucher.controller.ts` · base path: `/v1/companies/:companyId/disbursement-vouchers` · 30 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 501 | GET | `/v1/companies/:companyId/disbursement-vouchers/payee-account` | `payeeAccount` (L26) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ดู บัญชี ผู้รับเงิน | `Q{payeeKey,branchId}` | `→ DisbursementVoucherUseCase.payeeAccount()` |
| 502 | GET | `/v1/companies/:companyId/disbursement-vouchers/payees` | `payees` (L32) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ดู ผู้รับเงิน (ใบสำคัญจ่าย การเบิกจ่าย) | `Q:Record<string` | `→ ReadDisbursementVoucherSourcesUseCase.payees()` |
| 503 | GET | `/v1/companies/:companyId/disbursement-vouchers/payable-expenses` | `payableExpenses` (L40) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ดู รายจ่าย เจ้าหนี้ | `Q:Record<string` | `→ ReadDisbursementVoucherSourcesUseCase.payableExpenses()` |
| 504 | GET | `/v1/companies/:companyId/disbursement-vouchers/approvers` | `approvers` (L46) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ดู ผู้อนุมัติ (ใบสำคัญจ่าย การเบิกจ่าย) | `Q{branchId}` | `→ DisbursementVoucherUseCase.approvers()` |
| 505 | POST | `/v1/companies/:companyId/disbursement-vouchers/from-payment` | `fromPayment` (L50) | `expense.disbursement.issue` | ทุกแพ็ก [expenses] | ดำเนินการ จาก การจ่ายเงิน | `B:IssueDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.fromPayment()` |
| 506 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/reissue` | `reissue` (L54) | `expense.disbursement.issue` | ทุกแพ็ก [expenses] | ออกใหม่ (ใบสำคัญจ่าย การเบิกจ่าย) | `B:ReissueDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.reissue()` |
| 507 | POST | `/v1/companies/:companyId/disbursement-vouchers` | `create` (L58) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | สร้าง (ใบสำคัญจ่าย การเบิกจ่าย) | `B:CreateDisbursementVoucherDraftDto` | `→ DisbursementVoucherUseCase.create()` |
| 508 | PUT | `/v1/companies/:companyId/disbursement-vouchers/:id` | `update` (L64) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | แก้ไข (ใบสำคัญจ่าย การเบิกจ่าย) | `B:UpdateDisbursementVoucherDraftDto` | `→ DisbursementVoucherUseCase.update()` |
| 509 | DELETE | `/v1/companies/:companyId/disbursement-vouchers/:id` | `delete` (L70) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ลบ (ใบสำคัญจ่าย การเบิกจ่าย) | — | `→ DisbursementVoucherUseCase.delete()` (204) |
| 510 | GET | `/v1/companies/:companyId/disbursement-vouchers` | `list` (L77) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | ดูรายการ (ใบสำคัญจ่าย การเบิกจ่าย) | `Q:DisbursementVoucherListQueryDto` | `→ DisbursementVoucherUseCase.list()` |
| 511 | GET | `/v1/companies/:companyId/disbursement-vouchers/:id` | `get` (L84) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | ดูข้อมูล (ใบสำคัญจ่าย การเบิกจ่าย) | — | `→ DisbursementVoucherUseCase.get()` |
| 512 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/submit` | `submit` (L90) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ส่ง (ใบสำคัญจ่าย การเบิกจ่าย) | `B:SubmitDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.submit()` |
| 513 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/remind` | `remind` (L94) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | เตือน (ใบสำคัญจ่าย การเบิกจ่าย) | `B:RemindDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.remind()` |
| 514 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/approve` | `approve` (L98) | `expense.disbursement.approve` | ทุกแพ็ก [expenses] | อนุมัติ (ใบสำคัญจ่าย การเบิกจ่าย) | `B:DisbursementVoucherCommandDto` | `→ DisbursementVoucherUseCase.approve()` |
| 515 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/return` | `return` (L102) | `expense.disbursement.approve` | ทุกแพ็ก [expenses] | ตีกลับ (ใบสำคัญจ่าย การเบิกจ่าย) | `B:EndDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.return()` |
| 516 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/withdraw` | `withdraw` (L106) | any(`expense.disbursement.prepare` \| `expense.disbursement.approve`) | ทุกแพ็ก [expenses] | ถอนคำขอ (ใบสำคัญจ่าย การเบิกจ่าย) | `B:EndDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.withdraw()` |
| 517 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/cancel` | `cancel` (L110) | any(`expense.disbursement.prepare` \| `expense.disbursement.approve`) | ทุกแพ็ก [expenses] | ยกเลิก (ใบสำคัญจ่าย การเบิกจ่าย) | `B:EndDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.cancel()` |
| 518 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/payee-account/reveal` | `revealAccount` (L114) | any(`expense.disbursement.prepare` \| `expense.disbursement.approve` \| `expense.disbursement.pay`) | ทุกแพ็ก [expenses] | เปิดดูข้อมูลที่ปกปิด บัญชี (ใบสำคัญจ่าย การเบิกจ่าย) | `Q:RevealDisbursementVoucherAccountQueryDto` | `→ DisbursementVoucherUseCase.revealAccount()` |
| 519 | GET | `/v1/companies/:companyId/disbursement-vouchers/:id/document.pdf` | `documentPdf` (L118) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | ดู PDF เอกสาร | — | `→ DisbursementVoucherUseCase.documentPdf()` |
| 520 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/pay` | `pay` (L127) | `expense.disbursement.pay` | ทุกแพ็ก [expenses] | จ่ายเงิน (ใบสำคัญจ่าย การเบิกจ่าย) | `B:PayDisbursementVoucherDto` | `→ DisbursementVoucherUseCase.pay()` |
| 521 | GET | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files` | `supportingFiles` (L131) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | ดู ไฟล์ เอกสารประกอบ | — | `→ DisbursementVoucherUseCase.supportingFiles()` |
| 522 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files/slip-upload-intent` | `startSupportingUpload` (L136) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | เริ่ม การอัปโหลด เอกสารประกอบ | `B:InitDisbursementVoucherSlipUploadDto` | `→ DisbursementVoucherUseCase.startSupportingUpload()` |
| 523 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files/slip-uploads/:attachmentId/complete` | `completeSupportingUpload` (L140) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น การอัปโหลด เอกสารประกอบ | `B:CompleteDisbursementVoucherSlipUploadDto` | `→ DisbursementVoucherUseCase.completeSupportingUpload()` |
| 524 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files` | `attachSupportingFile` (L144) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | แนบ ไฟล์ เอกสารประกอบ | `B:AttachDisbursementVoucherSlipDto` | `→ DisbursementVoucherUseCase.changeSupportingFile()` |
| 525 | DELETE | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files/:attachmentId` | `removeSupportingFile` (L148) | `expense.disbursement.prepare` | ทุกแพ็ก [expenses] | นำออก ไฟล์ เอกสารประกอบ | — | `→ DisbursementVoucherUseCase.changeSupportingFile()` |
| 526 | GET | `/v1/companies/:companyId/disbursement-vouchers/:id/supporting-files/:attachmentId` | `openSupportingFile` (L152) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | เปิด ไฟล์ เอกสารประกอบ | — | `→ DisbursementVoucherUseCase.openSupportingFile()` |
| 527 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/slip-upload-intent` | `startSlipUpload` (L157) | `expense.disbursement.pay` | ทุกแพ็ก [expenses] | เริ่ม การอัปโหลด สลิป | `B:InitDisbursementVoucherSlipUploadDto` | `→ DisbursementVoucherUseCase.startSlipUpload()` |
| 528 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/slip-uploads/:attachmentId/complete` | `completeSlipUpload` (L161) | `expense.disbursement.pay` | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น การอัปโหลด สลิป | `B:CompleteDisbursementVoucherSlipUploadDto` | `→ DisbursementVoucherUseCase.completeSlipUpload()` (200) |
| 529 | POST | `/v1/companies/:companyId/disbursement-vouchers/:id/slip` | `attachSlip` (L166) | `expense.disbursement.pay` | ทุกแพ็ก [expenses] | แนบ สลิป (ใบสำคัญจ่าย การเบิกจ่าย) | `B:AttachDisbursementVoucherSlipDto` | `→ DisbursementVoucherUseCase.attachSlip()` (200) |
| 530 | GET | `/v1/companies/:companyId/disbursement-vouchers/:id/slip` | `slip` (L171) | `expense.disbursement.read` | ทุกแพ็ก [expenses] | ดู สลิป (ใบสำคัญจ่าย การเบิกจ่าย) | — | `→ DisbursementVoucherUseCase.slip()` |

**`ExpenseCaptureReadInternalController`** — `apps/api/src/modules/expenses/presentation/http/expense-capture-read-internal.controller.ts` · base path: `/v1/internal/expenses/capture-read` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 531 | POST | `/v1/internal/expenses/capture-read/drain` | `drain` (L29) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน การอ่าน การจับภาพเอกสาร รายจ่าย) | `B:ExpenseCaptureReadDrainDto` | `Promise<` |

**`ExpenseCaptureController`** — `apps/api/src/modules/expenses/presentation/http/expense-capture.controller.ts` · base path: `/v1/companies/:companyId/expenses` · 15 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 532 | GET | `/v1/companies/:companyId/expenses/capture-capability` | `getCapability` (L67) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review` \| `expense.create` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | ดูข้อมูล ความสามารถ (การจับภาพเอกสาร รายจ่าย) | — | `→ GetExpenseCaptureCapabilityUseCase.execute()` |
| 533 | POST | `/v1/companies/:companyId/expenses/capture-groups` | `create` (L73) | any(`expense.receipt.upload` \| `expense.receipt.line_upload` \| `expense.create`) | ทุกแพ็ก [expenses] | สร้าง (การจับภาพเอกสาร รายจ่าย) | `B:CreateExpenseCaptureGroupDto` | `→ CreateExpenseCaptureGroupUseCase.execute()` |
| 534 | GET | `/v1/companies/:companyId/expenses/capture-groups` | `list` (L79) | any(`expense.read` \| `expense.read_own` \| `expense.review`) | ทุกแพ็ก [expenses] | ดูรายการ (การจับภาพเอกสาร รายจ่าย) | `Q{status,page,pageSize}` | `→ ListExpenseCaptureGroupsUseCase.execute()` |
| 535 | GET | `/v1/companies/:companyId/expenses/capture-groups/:groupId` | `get` (L94) | any(`expense.read` \| `expense.read_own` \| `expense.review`) | ทุกแพ็ก [expenses] | ดูข้อมูล (การจับภาพเอกสาร รายจ่าย) | — | `→ GetExpenseCaptureGroupUseCase.execute()` |
| 536 | GET | `/v1/companies/:companyId/expenses/capture-groups/:groupId/read-status` | `groupReadStatus` (L101) | any(`expense.read` \| `expense.read_own` \| `expense.review`) | ทุกแพ็ก [expenses] | ดู สถานะ การอ่าน กลุ่ม | — | `→ GetExpenseReadStatusUseCase.group()` |
| 537 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/files` | `add` (L107) | any(`expense.receipt.upload` \| `expense.receipt.line_upload` \| `expense.create` \| `expense.review`) | ทุกแพ็ก [expenses] | เพิ่ม (การจับภาพเอกสาร รายจ่าย) | `B:AddExpenseCaptureFileDto` | `→ AddExpenseCaptureFileUseCase.execute()` |
| 538 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/files/:fileId/complete` | `complete` (L113) | any(`expense.receipt.upload` \| `expense.receipt.line_upload` \| `expense.create` \| `expense.review`) | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น (การจับภาพเอกสาร รายจ่าย) | `B:CompleteExpenseCaptureFileDto` | `→ CompleteExpenseCaptureFileUseCase.execute()` |
| 539 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/files/:fileId/detach` | `detach` (L124) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ถอดออก (การจับภาพเอกสาร รายจ่าย) | `B:DetachExpenseCaptureFileDto` | `→ DetachExpenseCaptureFileUseCase.execute()` |
| 540 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/facts` | `facts` (L140) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ดำเนินการ ข้อเท็จจริง (การจับภาพเอกสาร รายจ่าย) | `B:ExpenseCaptureFactsDto` | `→ PatchExpenseCaptureFactsUseCase.execute()` |
| 541 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/review` | `reviewGroup` (L146) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ตรวจทาน กลุ่ม (การจับภาพเอกสาร รายจ่าย) | `B:ExpenseCaptureReviewDto` | `→ ReviewExpenseCaptureGroupUseCase.execute()` |
| 542 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/allocations/:allocationId/accept` | `accept` (L152) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ยอมรับ (การจับภาพเอกสาร รายจ่าย) | `B:ExpenseCaptureRevisionDto` | `→ AcceptExpenseCaptureAllocationUseCase.execute()` |
| 543 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/handoff` | `handoffGroup` (L168) | any(`expense.create` \| `expense.receipt.upload` \| `expense.review`) | ทุกแพ็ก [expenses] | ดำเนินการ กลุ่ม การส่งต่อ | `B:ExpenseCaptureHandoffDto` | `→ HandoffExpenseCaptureGroupUseCase.execute()` |
| 544 | POST | `/v1/companies/:companyId/expenses/capture-groups/:groupId/close` | `close` (L174) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ปิด (การจับภาพเอกสาร รายจ่าย) | `B:CloseExpenseCaptureGroupDto` | `→ CloseExpenseCaptureGroupUseCase.execute()` |
| 545 | GET | `/v1/companies/:companyId/expenses/:expenseId/read-status` | `expenseReadStatus` (L181) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.create` \| `expense.review` \| `expense.confirm` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | ดู สถานะ การอ่าน รายจ่าย | — | `→ GetExpenseReadStatusUseCase.expense()` |
| 546 | POST | `/v1/companies/:companyId/expenses/:expenseId/capture-group` | `convertExpense` (L188) | any(`expense.receipt.upload` \| `expense.receipt.line_upload` \| `expense.create`) | ทุกแพ็ก [expenses] | แปลง รายจ่าย (การจับภาพเอกสาร) | `B:ConvertExpenseToCaptureGroupDto` | `→ ConvertExpenseToCaptureGroupUseCase.execute()` |

**`ExpenseController`** — `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` · base path: `/v1/companies/:companyId/expenses` · 62 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 547 | GET | `/v1/companies/:companyId/expenses/capture-policy` | `captureExpensePolicy` (L178) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.create` \| `expense.review`) | ทุกแพ็ก [expenses] | ดู นโยบาย รายจ่าย การจับภาพเอกสาร | `Q{on}` | `→ GetExpenseCapturePolicyUseCase.execute()` |
| 548 | GET | `/v1/companies/:companyId/expenses/wht-income-categories` | `whtIncomeCategories` (L188) | `expense.create` | ทุกแพ็ก [expenses] | ดู หมวดหมู่ รายรับ ภาษีหัก ณ ที่จ่าย | — | `→ ListWhtIncomeCategoriesUseCase.execute()` |
| 549 | GET | `/v1/companies/:companyId/expenses` | `listExpenses` (L197) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review`) | ทุกแพ็ก [expenses] | ดูรายการ รายจ่าย (รายจ่าย) | `Q{status,branchId,paymentStatus,duplicateStatus,vendorCounterpartyId,sourceDocumentType,vendorAddressMissing,taxEvidenceStatus,expenseCategoryId,captureSource,postingStatus,fromDate,toDate,uploadedFromDate,uploadedToDate,page,pageSize}` | `→ ListExpensesUseCase.execute()` |
| 550 | GET | `/v1/companies/:companyId/expenses/shared-evidence` | `getSharedEvidence` (L243) | `expense.evidence.read` | ทุกแพ็ก [expenses] | ดูข้อมูล หลักฐาน ที่แชร์ | `Q:Record<string` | `→ GetSharedEvidenceViewUseCase.execute()` |
| 551 | POST | `/v1/companies/:companyId/expenses/accountant-package/bundle-plan` | `planAccountantBundle` (L265) | `expense.export` | ทุกแพ็ก [expenses] | ดำเนินการ ชุดเอกสาร นักบัญชี แพ็ก/แผน | `B:AccountantEvidenceBundleDto` | `→ CreateAccountantPackageUseCase.planBundle()` (200) |
| 552 | POST | `/v1/companies/:companyId/expenses/accountant-package/bundle/:part` | `downloadAccountantBundle` (L272) | `expense.export` | ทุกแพ็ก [expenses] | ดาวน์โหลด ชุดเอกสาร นักบัญชี | `B:AccountantEvidenceBundleDto` | `→ CreateAccountantPackageUseCase.downloadBundle()` (200) |
| 553 | POST | `/v1/companies/:companyId/expenses/accounting-software-export` | `createAccountingSoftwareExport` (L282) | `expense.export` | ทุกแพ็ก [expenses] | สร้าง การส่งออก ซอฟต์แวร์ บัญชี | `B:AccountingSoftwareExportDto` | `→ CreateAccountingSoftwareExportUseCase.execute()` (200) |
| 554 | POST | `/v1/companies/:companyId/expenses/accountant-package` | `createAccountantPackage` (L289) | `expense.export` | ทุกแพ็ก [expenses] | สร้าง แพ็กเกจ นักบัญชี | `B:AccountantPackageDto` | `→ CreateAccountantPackageUseCase.execute()` |
| 555 | POST | `/v1/companies/:companyId/expenses` | `createDraft` (L295) | `expense.create` | ทุกแพ็ก [expenses] | สร้าง ร่าง (รายจ่าย) | `B:CreateExpenseDraftInput` | `→ CreateExpenseDraftUseCase.execute()` |
| 556 | POST | `/v1/companies/:companyId/expenses/receipt-uploads` | `initReceiptUpload` (L301) | `expense.receipt.upload` | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) การอัปโหลด ใบเสร็จ | `B:ReceiptUploadIntentDto` | `→ InitReceiptUploadUseCase.execute()` |
| 557 | DELETE | `/v1/companies/:companyId/expenses/:expenseId` | `removeExpense` (L312) | any(`expense.delete` \| `expense.update`) | ทุกแพ็ก [expenses] | นำออก รายจ่าย | — | `void` (204) |
| 558 | GET | `/v1/companies/:companyId/expenses/:expenseId` | `getExpense` (L319) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.create` \| `expense.review` \| `expense.confirm` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | ดูข้อมูล รายจ่าย | — | `→ GetExpenseUseCase.execute()` |
| 559 | POST | `/v1/companies/:companyId/expenses/:expenseId/payments/slip-upload-intent` | `initPaymentSlip` (L329) | `expense.payment.record` | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) สลิป การจ่ายเงิน | `B:UploadIntentDto` | `→ ExpensePaymentSlipUploadUseCase.init()` |
| 560 | POST | `/v1/companies/:companyId/expenses/:expenseId/payments/slip-uploads/:attachmentId/complete` | `completePaymentSlip` (L335) | `expense.payment.record` | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น สลิป การจ่ายเงิน | `B:UploadCompletionDto` | `→ ExpensePaymentSlipUploadUseCase.complete()` |
| 561 | POST | `/v1/companies/:companyId/expenses/:expenseId/input-vat-decision` | `decideInputVat` (L341) | any(`expense.review`) | ทุกแพ็ก [expenses] | ตัดสิน VAT ภาษีซื้อ/นำเข้า | `B:DecideExpenseInputVatDto` | `→ DecideExpenseInputVatUseCase.execute()` |
| 562 | GET | `/v1/companies/:companyId/expenses/:expenseId/history` | `getHistory` (L347) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.create` \| `expense.review` \| `expense.confirm` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | ดูข้อมูล ประวัติ (รายจ่าย) | `Q{page}` | `→ GetExpenseHistoryUseCase.execute()` |
| 563 | GET | `/v1/companies/:companyId/expenses/:expenseId/payment-voucher.pdf` | `downloadPaymentVoucher` (L353) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review`) | ทุกแพ็ก [expenses] | ดาวน์โหลด ใบสำคัญจ่าย การจ่ายเงิน | `Q{paymentDate,payeeName,payeeAddress,payeeTaxId}` | `StreamableFile` |
| 564 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/evidence-upload` | `initPreparationUpload` (L375) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) การอัปโหลด การจัดเตรียม | `B:SubstitutePreparationUploadIntentDto` | `→ SubstituteReceiptEvidenceUploadUseCase.init()` |
| 565 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/evidence-upload/:attachmentId/complete` | `completePreparationUpload` (L381) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น การอัปโหลด การจัดเตรียม | `B:SubstitutePreparationUploadCompletionDto` | `→ SubstituteReceiptEvidenceUploadUseCase.complete()` |
| 566 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt` | `prepareSubstitute` (L387) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | จัดเตรียม ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:GenerateSubstituteReceiptInput` | `→ PrepareSubstituteReceiptUseCase.execute()` |
| 567 | PATCH | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId` | `amendSubstitute` (L393) | `expense.review` | ทุกแพ็ก [expenses] | แก้ไขเพิ่มเติม ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:AmendSubstituteReceiptDto` | `→ PrepareSubstituteReceiptUseCase.executeAmendment()` |
| 568 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/correct-document` | `correctSubstituteDocument` (L399) | `expense.review` | ทุกแพ็ก [expenses] | แก้ไขให้ถูกต้อง เอกสาร ใบรับรองแทนใบเสร็จ | `B:CorrectSubstituteDocumentDto` | `→ PrepareSubstituteReceiptUseCase.executeCorrection()` |
| 569 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/continuations/:workflowId` | `loadLineSubstituteContinuation` (L405) | `expense.review` | ทุกแพ็ก [expenses] | โหลด การทำต่อ ใบรับรองแทนใบเสร็จ LINE | — | `→ LineSubstituteReceiptContinuationUseCase.loadForWeb()` |
| 570 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/payers` | `listSubstitutePayers` (L415) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูรายการ ผู้จ่าย ใบรับรองแทนใบเสร็จ | — | `→ ListSubstituteReceiptPayersUseCase.execute()` |
| 571 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/history` | `listSubstituteHistory` (L421) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูรายการ ประวัติ ใบรับรองแทนใบเสร็จ | — | `→ ListSubstituteReceiptHistoryUseCase.execute()` |
| 572 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/artifact.pdf` | `downloadSubstitutePdf` (L427) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review` \| `expense.confirm`) | ทุกแพ็ก [expenses] | ดาวน์โหลด PDF ใบรับรองแทนใบเสร็จ | — | `StreamableFile` |
| 573 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/artifact-preview` | `previewIssuedSubstitute` (L443) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review` \| `expense.confirm`) | ทุกแพ็ก [expenses] | ดูตัวอย่าง ใบรับรองแทนใบเสร็จ ที่ออกแล้ว | — | `→ DownloadSubstituteReceiptPdfUseCase.preview()` |
| 574 | GET | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/form.pdf` | `downloadSubstituteFormPdf` (L453) | `expense.review` | ทุกแพ็ก [expenses] | ดาวน์โหลด PDF แบบฟอร์ม ใบรับรองแทนใบเสร็จ | — | `StreamableFile` |
| 575 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/certify` | `certifySubstitute` (L469) | any(`expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | รับรอง ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:CertifySubstituteReceiptInput` | `→ CertifySubstituteReceiptUseCase.execute()` |
| 576 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/preview` | `previewSubstitute` (L480) | any(`expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูตัวอย่าง ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:PreviewSubstituteReceiptInput` | `→ PreviewSubstituteReceiptUseCase.execute()` |
| 577 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/paper/upload-intent` | `initPaperUpload` (L491) | `expense.review` | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) การอัปโหลด เอกสารกระดาษ | `B:UploadIntentDto` | `→ PaperSubstituteReceiptUseCase.initUpload()` |
| 578 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/paper/submit` | `submitPaper` (L497) | `expense.review` | ทุกแพ็ก [expenses] | ส่ง เอกสารกระดาษ (รายจ่าย) | `B:SubmitSubstituteReceiptPaperDto` | `→ PaperSubstituteReceiptUseCase.submit()` |
| 579 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/paper/preview` | `previewPaper` (L503) | any(`expense.review` \| `expense.confirm`) | ทุกแพ็ก [expenses] | ดูตัวอย่าง เอกสารกระดาษ (รายจ่าย) | — | `→ PaperSubstituteReceiptUseCase.preview()` |
| 580 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/paper/accept` | `acceptPaper` (L509) | `expense.confirm` | ทุกแพ็ก [expenses] | ยอมรับ เอกสารกระดาษ (รายจ่าย) | `B:AcceptSubstituteReceiptPaperDto` | `→ PaperSubstituteReceiptUseCase.accept()` |
| 581 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-upload-intent` | `initSubstituteSignature` (L515) | any(`expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) ลายเซ็น ใบรับรองแทนใบเสร็จ | `B:UploadIntentDto` | `→ InitSubstituteSignatureUploadUseCase.execute()` |
| 582 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/signature-uploads/:attachmentId/complete` | `completeSubstituteSignature` (L526) | any(`expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น ลายเซ็น ใบรับรองแทนใบเสร็จ | `B:UploadCompletionDto` | `→ CompleteSubstituteSignatureUploadUseCase.execute()` |
| 583 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/approve` | `approveSubstitute` (L538) | `expense.confirm` | ทุกแพ็ก [expenses] | อนุมัติ ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:ApproveSubstituteReceiptInput` | `→ ApproveSubstituteReceiptUseCase.execute()` |
| 584 | POST | `/v1/companies/:companyId/expenses/:expenseId/substitute-receipt/:evidenceId/supersede` | `supersedeSubstitute` (L549) | `expense.review` | ทุกแพ็ก [expenses] | แทนที่ด้วยฉบับใหม่ ใบรับรองแทนใบเสร็จ (รายจ่าย) | `B:SupersedeSubstituteReceiptInput` | `→ SupersedeSubstituteReceiptUseCase.execute()` |
| 585 | POST | `/v1/companies/:companyId/expenses/:expenseId/extraction-request` | `requestReceiptExtraction` (L560) | any(`expense.ocr.request` \| `expense.review` \| `expense.receipt.upload`) | ทุกแพ็ก [expenses] | ร้องขอ การสกัดข้อมูล ใบเสร็จ | — | `→ RequestReceiptExtractionUseCase.execute()` |
| 586 | POST | `/v1/companies/:companyId/expenses/:expenseId/signature-fill` | `fillSignature` (L566) | `expense.review` | ทุกแพ็ก [expenses] | กรอก ลายเซ็น (รายจ่าย) | `B:SignatureFillInput & { checksumSha256?: string; byteSize?: number }` | `→ FillSignatureUseCase.execute()` |
| 587 | PATCH | `/v1/companies/:companyId/expenses/:expenseId` | `updateDraft` (L572) | any(`expense.update` \| `expense.review` \| `expense.create` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | แก้ไข ร่าง (รายจ่าย) | `B:UpdateExpenseDraftInput & { expectedUpdatedAt: string }` | `→ UpdateExpenseDraftUseCase.execute()` |
| 588 | POST | `/v1/companies/:companyId/expenses/:expenseId/totals-preview` | `previewDraftTotals` (L583) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ดูตัวอย่าง ยอดรวม ร่าง | `B:ExpenseTotalsPreviewDto` | `→ UpdateExpenseDraftUseCase.execute()` |
| 589 | PATCH | `/v1/companies/:companyId/expenses/:expenseId/review-fields` | `updateReviewFields` (L589) | any(`expense.review` \| `expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.confirm`) | ทุกแพ็ก [expenses] | แก้ไข ฟิลด์ การตรวจทาน | `B:UpdateExpenseDraftInput & { expectedUpdatedAt: string }` | `→ UpdateExpenseDraftUseCase.execute()` |
| 590 | POST | `/v1/companies/:companyId/expenses/:expenseId/non-expense-classification-override` | `overrideNonExpenseClassification` (L599) | `expense.review` | ทุกแพ็ก [expenses] | แทนที่ค่า (override) การจัดประเภท รายจ่าย ไม่ | `B:NonExpenseClassificationOverrideInput & { sourceDocumentType: SourceDocumentType; expectedUpdatedAt: string }` | `→ UpdateExpenseDraftUseCase.execute()` |
| 591 | POST | `/v1/companies/:companyId/expenses/:expenseId/ocr-total-acknowledgement` | `acknowledgeOcrTotal` (L616) | `expense.review` | ทุกแพ็ก [expenses] | รับทราบ ยอดรวม OCR | `B:OcrTotalAcknowledgementInput & { expectedUpdatedAt: string }` | `→ UpdateExpenseDraftUseCase.execute()` |
| 592 | DELETE | `/v1/companies/:companyId/expenses/:expenseId/receipts/:attachmentId` | `removeExpenseReceipt` (L626) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | นำออก ใบเสร็จ รายจ่าย | `B:RemoveExpenseReceiptDto` | `→ RemoveExpenseReceiptUseCase.execute()` (204) |
| 593 | POST | `/v1/companies/:companyId/expenses/:expenseId/receipt-uploads/:attachmentId/complete` | `completeReceiptUpload` (L636) | any(`expense.receipt.upload` \| `expense.review`) | ทุกแพ็ก [expenses] | ยืนยันเสร็จสิ้น การอัปโหลด ใบเสร็จ | `B:ReceiptUploadCompletionDto` | `→ CompleteReceiptUploadUseCase.execute()` |
| 594 | GET | `/v1/companies/:companyId/expenses/:expenseId/reviewers` | `reviewers` (L647) | any(`expense.update` \| `expense.review`) | ทุกแพ็ก [expenses] | ดู ผู้ตรวจ (รายจ่าย) | — | `→ MarkExpenseReadyUseCase.reviewers()` |
| 595 | POST | `/v1/companies/:companyId/expenses/:expenseId/mark-ready` | `markReady` (L653) | `expense.update` | ทุกแพ็ก [expenses] | ทำเครื่องหมาย พร้อม (รายจ่าย) | `B:MarkExpenseReadyDto` | `→ MarkExpenseReadyUseCase.execute()` |
| 596 | POST | `/v1/companies/:companyId/expenses/:expenseId/reviewer-mark-ready` | `markReadyAsReviewer` (L659) | `expense.review` | ทุกแพ็ก [expenses] | ทำเครื่องหมาย พร้อม เป็น ผู้ตรวจ | `B:MarkExpenseReadyDto` | `→ MarkExpenseReadyUseCase.execute()` |
| 597 | POST | `/v1/companies/:companyId/expenses/:expenseId/confirm` | `confirmExpense` (L665) | `expense.confirm` | ทุกแพ็ก [expenses] | ยืนยัน รายจ่าย | `B:ConfirmExpenseDto` | `→ ConfirmExpenseUseCase.execute()` |
| 598 | POST | `/v1/companies/:companyId/expenses/:expenseId/reject` | `rejectExpense` (L671) | `expense.reject` | ทุกแพ็ก [expenses] | ปฏิเสธ รายจ่าย | `B:ReasonRequiredDto` | `→ RejectExpenseUseCase.execute()` |
| 599 | POST | `/v1/companies/:companyId/expenses/:expenseId/void` | `voidExpense` (L677) | `expense.void` | ทุกแพ็ก [expenses] | ยกเลิก (void) รายจ่าย | `B:VoidExpenseDto` | `→ VoidExpenseUseCase.execute()` |
| 600 | POST | `/v1/companies/:companyId/expenses/:expenseId/reopen` | `reopenExpense` (L683) | `expense.confirm` | ทุกแพ็ก [expenses] | เปิดใหม่ รายจ่าย | `B:ReopenExpenseDto` | `→ ReopenExpenseUseCase.execute()` |
| 601 | POST | `/v1/companies/:companyId/expenses/:expenseId/payments/:paymentId/cancel` | `cancelExpensePayment` (L689) | `expense.payment.record` | ทุกแพ็ก [expenses] | ยกเลิก การจ่ายเงิน รายจ่าย | `B:ReasonRequiredDto` | `→ CancelExpensePaymentUseCase.execute()` |
| 602 | POST | `/v1/companies/:companyId/expenses/:expenseId/payments/:paymentId/confirm-date` | `confirmPaymentDate` (L695) | `expense.payment.record` | ทุกแพ็ก [expenses] | ยืนยัน วันที่ การจ่ายเงิน | `B:ConfirmExpensePaymentDateDto` | `→ RecordExpensePaymentUseCase.confirmDate()` |
| 603 | POST | `/v1/companies/:companyId/expenses/:expenseId/payment` | `recordPayment` (L701) | `expense.payment.record` | ทุกแพ็ก [expenses] | บันทึก การจ่ายเงิน (รายจ่าย) | `B:RecordExpensePaymentDto` | `→ RecordExpensePaymentUseCase.execute()` |
| 604 | POST | `/v1/companies/:companyId/expenses/:expenseId/duplicate-check` | `duplicateCheck` (L711) | `expense.review` | ทุกแพ็ก [expenses] | ทำสำเนา การตรวจ (รายจ่าย) | — | `→ DuplicateCheckUseCase.execute()` |
| 605 | POST | `/v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/dismiss` | `dismissDuplicate` (L717) | `expense.duplicate.resolve` | ทุกแพ็ก [expenses] | ปิด/ไม่สนใจ รายการซ้ำ (รายจ่าย) | `B:ReasonOptionalDto` | `→ ResolveDuplicateUseCase.execute()` |
| 606 | POST | `/v1/companies/:companyId/expenses/:expenseId/duplicates/:candidateId/confirm` | `confirmDuplicate` (L723) | `expense.duplicate.resolve` | ทุกแพ็ก [expenses] | ยืนยัน รายการซ้ำ (รายจ่าย) | `B:ReasonOptionalDto` | `→ ResolveDuplicateUseCase.execute()` |
| 607 | POST | `/v1/companies/:companyId/expenses/:expenseId/buyer-match/confirm` | `confirmBuyerMatch` (L731) | `expense.confirm` | ทุกแพ็ก [expenses] | ยืนยัน การจับคู่ ผู้ซื้อ | `B:ReasonOptionalDto` | `→ ConfirmBuyerMatchUseCase.execute()` |
| 608 | GET | `/v1/companies/:companyId/expenses/:expenseId/source-posting-input` | `getSourcePosting` (L737) | `expense.read` | ทุกแพ็ก [expenses] | ดูข้อมูล การลงบัญชี แหล่งที่มา | — | `→ GetExpenseSourcePostingInputUseCase.execute()` |

**`ExpenseCategoryController`** — `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` · base path: `/v1/companies/:companyId/expense-categories` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 609 | GET | `/v1/companies/:companyId/expense-categories` | `listCategories` (L755) | any(`expense.read` \| `expense.read_related` \| `expense.read_own` \| `expense.review` \| `expense.create` \| `expense.receipt.upload` \| `expense.receipt.line_upload`) | ทุกแพ็ก [expenses] | ดูรายการ หมวดหมู่ (หมวดหมู่ รายจ่าย) | — | `→ ListExpenseCategoriesUseCase.execute()` |
| 610 | GET | `/v1/companies/:companyId/expense-categories/manage` | `listAllCategories` (L762) | `expense.category.manage` | ทุกแพ็ก [expenses] | ดูรายการ หมวดหมู่ ทั้งหมด | — | `→ ListAllExpenseCategoriesUseCase.execute()` |
| 611 | POST | `/v1/companies/:companyId/expense-categories` | `createCategory` (L768) | `expense.category.manage` | ทุกแพ็ก [expenses] | สร้าง หมวดหมู่ (รายจ่าย) | `B:CreateExpenseCategoryInput` | `→ CreateExpenseCategoryUseCase.execute()` |
| 612 | PUT | `/v1/companies/:companyId/expense-categories/:categoryId/accountant-account` | `setAccountantAccount` (L774) | `expense.category.manage` | ทุกแพ็ก [expenses] | ตั้งค่า บัญชี นักบัญชี | `B:SetExpenseCategoryAccountantAccountDto` | `→ SetExpenseCategoryAccountantAccountUseCase.execute()` |
| 613 | DELETE | `/v1/companies/:companyId/expense-categories/:categoryId/accountant-account` | `clearAccountantAccount` (L780) | `expense.category.manage` | ทุกแพ็ก [expenses] | ล้าง บัญชี นักบัญชี | — | `→ ClearExpenseCategoryAccountantAccountUseCase.execute()` (204) |
| 614 | PATCH | `/v1/companies/:companyId/expense-categories/:categoryId` | `updateCategory` (L787) | `expense.category.manage` | ทุกแพ็ก [expenses] | แก้ไข หมวดหมู่ (รายจ่าย) | `B:UpdateExpenseCategoryInput` | `→ UpdateExpenseCategoryUseCase.execute()` |

**`CompanySubstituteReceiptController`** — `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` · base path: `/v1/companies/:companyId/substitute-receipts` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 615 | GET | `/v1/companies/:companyId/substitute-receipts/:evidenceId/expense` | `resolveExpense` (L798) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | แก้ไข/ปิดประเด็น รายจ่าย (ใบเสร็จ ใบรับรองแทนใบเสร็จ บริษัท) | — | `→ ListSubstituteReceiptHistoryUseCase.resolveExpenseId()` |
| 616 | GET | `/v1/companies/:companyId/substitute-receipts/candidates` | `listCandidates` (L804) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูรายการ ตัวเลือก (ใบเสร็จ ใบรับรองแทนใบเสร็จ บริษัท) | `Q:Record<string` | `→ ListSubstituteReceiptCandidatesUseCase.execute()` |
| 617 | GET | `/v1/companies/:companyId/substitute-receipts` | `list` (L811) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูรายการ (ใบเสร็จ ใบรับรองแทนใบเสร็จ บริษัท) | `Q:SubstituteReceiptListQueryDto` | `→ ListCompanySubstituteReceiptsUseCase.execute()` |

**`ExpenseSettingsController`** — `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` · base path: `/v1/companies/:companyId/expense-settings` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 618 | GET | `/v1/companies/:companyId/expense-settings/e-wht` | `getEWht` (L827) | any(`company.setup.manage` \| `expense.review` \| `expense.confirm` \| `expense.create` \| `expense.update` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูข้อมูล ภาษีหัก ณ ที่จ่าย e- | — | `→ GetExpenseEWhtSettingUseCase.execute()` |
| 619 | PATCH | `/v1/companies/:companyId/expense-settings/e-wht` | `updateEWht` (L833) | `company.setup.manage` | ทุกแพ็ก | แก้ไข ภาษีหัก ณ ที่จ่าย e- | `B:UpdateExpenseEWhtSettingDto` | `→ UpdateExpenseEWhtSettingUseCase.execute()` |
| 620 | GET | `/v1/companies/:companyId/expense-settings/substitute-receipt` | `getPolicy` (L839) | `company.setup.manage` | ทุกแพ็ก | ดูข้อมูล นโยบาย (การตั้งค่า รายจ่าย) | — | `→ GetSubstituteReceiptPolicyUseCase.execute()` |
| 621 | GET | `/v1/companies/:companyId/expense-settings/substitute-receipt/runtime` | `getRuntimePolicy` (L845) | any(`expense.review` \| `expense.confirm` \| `expense.read` \| `expense.read_related` \| `expense.read_own`) | ทุกแพ็ก [expenses] | ดูข้อมูล นโยบาย runtime | — | `→ GetSubstituteReceiptPolicyUseCase.executeRuntime()` |
| 622 | PATCH | `/v1/companies/:companyId/expense-settings/substitute-receipt` | `updatePolicy` (L851) | `company.setup.manage` | ทุกแพ็ก | แก้ไข นโยบาย (การตั้งค่า รายจ่าย) | `B:UpdateSubstituteReceiptPolicyInput` | `→ UpdateSubstituteReceiptPolicyUseCase.execute()` |

**`ExpenseSignatureController`** — `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` · base path: `/v1/companies/:companyId/expense-signatures` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 623 | GET | `/v1/companies/:companyId/expense-signatures/images/:attachmentId` | `signatureImageBytes` (L874) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | ดู ไบต์ รูป ลายเซ็น | — | `StreamableFile` |
| 624 | GET | `/v1/companies/:companyId/expense-signatures` | `list` (L899) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | ดูรายการ (ลายเซ็น รายจ่าย) | `Q{status}` | `→ ListSignatureAssetsUseCase.execute()` |
| 625 | POST | `/v1/companies/:companyId/expense-signatures/uploads` | `initSignatureUpload` (L905) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | เริ่มอัปโหลด (ขอ URL) การอัปโหลด ลายเซ็น | `B:UploadIntentDto` | `→ InitSignatureUploadUseCase.execute()` |
| 626 | POST | `/v1/companies/:companyId/expense-signatures` | `createSignature` (L911) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | สร้าง ลายเซ็น (รายจ่าย) | `B:CreateSignatureAssetDto` | `→ CreateSignatureAssetUseCase.execute()` |
| 627 | POST | `/v1/companies/:companyId/expense-signatures/:signatureId/archive` | `archiveSignature` (L928) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | เก็บเข้าคลัง (archive) ลายเซ็น (รายจ่าย) | — | `→ ArchiveSignatureAssetUseCase.execute()` |
| 628 | POST | `/v1/companies/:companyId/expense-signatures/:signatureId/derived` | `setDerivedAsset` (L935) | any(`expense.signature.self_manage` \| `expense.review` \| `expense.confirm` \| `expense.signature.manage`) | ทุกแพ็ก [expenses] | ตั้งค่า สินทรัพย์ derived | `B:SetSignatureDerivedAssetDto` | `→ SetSignatureDerivedAssetUseCase.execute()` |

### 2.15 โมดูล `external-signup` — 38 endpoint

**`CompanyPackageChangeController`** — `apps/api/src/modules/external-signup/presentation/http/company-package-change.controller.ts` · base path: `/v1/companies/:companyId/package-change-requests` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 629 | POST | `/v1/companies/:companyId/package-change-requests` | `create` (L30) | `company.plan.manage` | ทุกแพ็ก | สร้าง (การเปลี่ยนแปลง แพ็กเกจ บริษัท) — _Ask an admin to move this company to another package_ | `B:CreatePackageChangeRequestDto` | `PackageChangeRequestDto` (201) |
| 630 | GET | `/v1/companies/:companyId/package-change-requests` | `list` (L49) | `company.plan.manage` | ทุกแพ็ก | ดูรายการ (การเปลี่ยนแปลง แพ็กเกจ บริษัท) — _This company own package-change requests, newest first_ | — | `PackageChangeRequestDto[]` |

**`PublicCompanySignupController`** — `apps/api/src/modules/external-signup/presentation/http/public-company-signup.controller.ts` · base path: `/v1/public` · `@Public()` ระดับ class · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 631 | GET | `/v1/public/company-signups/availability` | `availability` (L93) | Public | แพลตฟอร์ม | ดู ความพร้อมใช้ (การสมัคร บริษัท สาธารณะ) — _Whether public self-service signup is open_ | — | `{ enabled: boolean }` |
| 632 | POST | `/v1/public/company-signups` | `create` (L99) | Public — rate limit: `assertPublicSignupAllowed` | แพลตฟอร์ม | สร้าง (การสมัคร บริษัท สาธารณะ) — _Submit a public company signup application_ | `B:PublicCompanySignupDto` | `PublicCompanySignupAcceptedDto` (202) |
| 633 | GET | `/v1/public/company-signups/:requestId` | `readStatus` (L134) | Public — rate limit: `assertPublicSignupReadAllowed` | แพลตฟอร์ม | อ่าน สถานะ (การสมัคร บริษัท สาธารณะ) — _Coarse public status of an application_ | — | `PublicSignupStatusDto` |
| 634 | POST | `/v1/public/company-signups/:requestId/resend-claim` | `resendClaim` (L145) | Public — rate limit: `assertPublicSignupResendAllowed` | แพลตฟอร์ม | ส่งซ้ำ ใบเบิก/claim (การสมัคร บริษัท สาธารณะ) — _Ask for a fresh claim email_ | — | `Promise<` (202) |
| 635 | POST | `/v1/public/signup-claims/info` | `claimInfo` (L164) | Public — rate limit: `assertPublicSignupReadAllowed` | แพลตฟอร์ม | รับสิทธิ์/จอง ข้อมูล (การสมัคร บริษัท สาธารณะ) — _Claim link details; identical empty answer for expired/used/unknown_ | `B:SignupClaimTokenDto` | `SignupClaimInfoDto` (200) |
| 636 | POST | `/v1/public/signup-claims/set-password` | `setPassword` (L174) | Public — rate limit: `assertSignupClaimSubmitAllowed` | แพลตฟอร์ม | ตั้งค่า รหัสผ่าน (การสมัคร บริษัท สาธารณะ) — _Claim: set a password for a new account, then provision_ | `B:SignupClaimSetPasswordDto` | `SignupClaimResultDto` (200) |
| 637 | POST | `/v1/public/signup-claims/attach` | `attach` (L193) | Public — rate limit: `assertPasswordLoginAllowed`, `assertSignupClaimSubmitAllowed` | แพลตฟอร์ม | แนบ (การสมัคร บริษัท สาธารณะ) — _Claim: attach the new company to an existing account, then provision_ | `B:SignupClaimAttachDto` | `SignupClaimResultDto` (200) |

**`PublicEmailAccessController`** — `apps/api/src/modules/external-signup/presentation/http/public-email-access.controller.ts` · base path: `/v1/public/email-access` · `@Public()` ระดับ class · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 638 | POST | `/v1/public/email-access/request` | `request` (L36) | Public — rate limit: `assertEmailAccessAllowed` | แพลตฟอร์ม | ร้องขอ (การเข้าถึง อีเมล สาธารณะ) | `B:EmailAccessRequestDto` | `→ AuthRateLimitService.assertEmailAccessAllowed()` (200) |
| 639 | POST | `/v1/public/email-access/confirm` | `confirm` (L41) | Public — rate limit: `assertEmailAccessAllowed` | แพลตฟอร์ม | ยืนยัน (การเข้าถึง อีเมล สาธารณะ) | `B:EmailAccessConfirmDto` | `→ AuthRateLimitService.assertEmailAccessAllowed()` (200) |
| 640 | POST | `/v1/public/email-access/signup` | `create` (L46) | Public — rate limit: `assertEmailAccessAllowed` | แพลตฟอร์ม | สร้าง (การเข้าถึง อีเมล สาธารณะ) | `B:EmailSignupDto` | `→ AuthRateLimitService.assertEmailAccessAllowed()` (200) |
| 641 | POST | `/v1/public/email-access/status` | `status` (L51) | Public — rate limit: `assertEmailAccessAllowed` | แพลตฟอร์ม | ดำเนินการ สถานะ (การเข้าถึง อีเมล สาธารณะ) | `B:EmailProofDto` | `→ AuthRateLimitService.assertEmailAccessAllowed()` (200) |

**`PublicLineSignupController`** — `apps/api/src/modules/external-signup/presentation/http/public-line-signup.controller.ts` · base path: `/v1/public` · `@Public()` ระดับ class · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 642 | POST | `/v1/public/line-signups` | `create` (L94) | Public — rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | สร้าง (การสมัคร LINE สาธารณะ) — _Submit a LINE-first company signup from the LIFF form_ | `B:LineSignupSubmitBodyDto` | `LineSignupSubmitAcceptedDto` (202) |
| 643 | POST | `/v1/public/line-signups/support` | `requestSupport` (L129) | Public — rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ร้องขอ ซัพพอร์ต (การสมัคร LINE สาธารณะ) — _Request signup help in the support inbox using verified LINE identity_ | `B:LineSignupSupportBodyDto` | `Promise<` (202) |
| 644 | PATCH | `/v1/public/line-signups/:requestId/contact-email` | `correctContactEmail` (L138) | Public — rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | แก้ไขให้ถูกต้อง อีเมล ข้อมูลติดต่อ — _Correct one token-owned pending LINE signup contact and resume intake_ | `B:LineSignupContactEmailCorrectionBodyDto` | `LineSignupStatusDto` (200) |
| 645 | POST | `/v1/public/line-signups/:requestId/retry` | `retryIntake` (L161) | Public — rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | ลองใหม่ การรับเข้า (การสมัคร LINE สาธารณะ) — _Resume one token-owned committed LINE signup intake_ | `B:LineSignupRetryBodyDto` | `LineSignupStatusDto` (200) |
| 646 | GET | `/v1/public/line-signups/me` | `readStatus` (L183) | Public — `x-line-id-token`; rate limit: `assertLineSignupReadAllowed`; LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | อ่าน สถานะ (การสมัคร LINE สาธารณะ) — _The latest application belonging to the LINE account this token proves_ | — | `LineSignupStatusDto` |

**`PublicSesEventsController`** — `apps/api/src/modules/external-signup/presentation/http/public-ses-events.controller.ts` · base path: `/v1/public` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 647 | POST | `/v1/public/ses-events` | `receive` (L29) | Public — ลายเซ็น SNS + Topic ARN; rate limit: `assertSesEventsAllowed` | แพลตฟอร์ม | รับ (เหตุการณ์ SES สาธารณะ) — _Amazon SNS endpoint for SES bounce/complaint events_ | `B:raw(req.body)` | `SesEventResult` (200) |

**`SignupClaimEmailInternalController`** — `apps/api/src/modules/external-signup/presentation/http/signup-claim-email-internal.controller.ts` · base path: `/v1/internal/signup-claim-email` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 648 | POST | `/v1/internal/signup-claim-email/drain` | `drain` (L30) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน อีเมล ใบเบิก/claim การสมัคร) | `B:SignupClaimEmailDrainDto` | `→ SignupClaimEmailService.drain()` |
| 649 | POST | `/v1/internal/signup-claim-email/reminder-sweep` | `reminderSweep` (L46) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การกวาดตรวจ การเตือน | — | `→ SignupClaimEmailService.sweepReminders()` |

**`SystemSignupRequestController`** — `apps/api/src/modules/external-signup/presentation/http/system-signup-request.controller.ts` · base path: `/v1/system/signup-requests` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 650 | GET | `/v1/system/signup-requests/:requestId/claim-deliveries` | `claimHistory` (L68) | `system.company_onboarding.read` | แพลตฟอร์ม | รับสิทธิ์/จอง ประวัติ (คำขอ การสมัคร ระบบ) | `Q:SignupClaimHistoryQueryDto` | `→ SignupAdminQueueUseCase.claimHistory()` |
| 651 | GET | `/v1/system/signup-requests` | `list` (L75) | `system.company_onboarding.read` | แพลตฟอร์ม | ดูรายการ (คำขอ การสมัคร ระบบ) — _List one page of one tab of the signup queue, with whole-queue counts_ | `Q:SignupQueueQueryDto` | `AdminSignupQueueDto` |
| 652 | GET | `/v1/system/signup-requests/auto-approved` | `listAutoApproved` (L88) | `system.company_onboarding.read` | แพลตฟอร์ม | ดูรายการ ที่อนุมัติแล้ว อัตโนมัติ — _Applications AUTO_FREE approved without an admin, for after-the-fact review_ | — | `AdminSignupQueueDto` |
| 653 | POST | `/v1/system/signup-requests/:requestId/decision` | `decide` (L95) | `system.company_onboarding.create` | แพลตฟอร์ม | ตัดสิน (คำขอ การสมัคร ระบบ) — _Approve or reject an application (idempotent)_ | `B:SignupDecisionRequestDto` | `AdminSignupDecisionDto` (200) |
| 654 | POST | `/v1/system/signup-requests/:requestId/reissue-claim` | `reissue` (L117) | `system.company_onboarding.create` | แพลตฟอร์ม | ออกใหม่ (คำขอ การสมัคร ระบบ) — _Revoke old claim links and send a fresh one (no age limit)_ | — | `AdminSignupReissueDto` (200) |

**`SystemSupportRequestController`** — `apps/api/src/modules/external-signup/presentation/http/system-support-request.controller.ts` · base path: `/v1/system/support-requests` · 12 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 655 | GET | `/v1/system/support-requests` | `list` (L62) | `system.partner_company.update` | แพลตฟอร์ม | ดูรายการ (คำขอ ซัพพอร์ต ระบบ) — _Customers waiting for a person, OPEN first_ | `Q:SupportRequestQueryDto` | `SupportRequestQueueDto` |
| 656 | GET | `/v1/system/support-requests/count` | `count` (L78) | `system.partner_company.update` | แพลตฟอร์ม | นับ (คำขอ ซัพพอร์ต ระบบ) — _How many customers are still waiting — the system nav badge_ | — | `SupportRequestCountDto` |
| 657 | GET | `/v1/system/support-requests/:supportRequestId/thread` | `thread` (L86) | `system.partner_company.update` | แพลตฟอร์ม | ดู เธรด (คำขอ ซัพพอร์ต ระบบ) — _The request and everything said on it, oldest first (สัญญา v3)_ | — | `SupportRequestThreadDto` |
| 658 | GET | `/v1/system/support-requests/:supportRequestId/messages/:messageId/content` | `content` (L101) | `system.partner_company.update` | แพลตฟอร์ม | ดู เนื้อหา (คำขอ ซัพพอร์ต ระบบ) — _Stream the stored bytes of one customer photo/file on this request_ | — | `StreamableFile` |
| 659 | POST | `/v1/system/support-requests/:supportRequestId/claim` | `claim` (L120) | `system.partner_company.update` | แพลตฟอร์ม | รับสิทธิ์/จอง (คำขอ ซัพพอร์ต ระบบ) — _Claim this live support request for the current operator_ | — | `SupportRequestActionDto` (200) |
| 660 | POST | `/v1/system/support-requests/:supportRequestId/release` | `release` (L131) | `system.partner_company.update` | แพลตฟอร์ม | ปล่อย (คำขอ ซัพพอร์ต ระบบ) — _Release a support request owned by the current operator_ | — | `SupportRequestActionDto` (200) |
| 661 | POST | `/v1/system/support-requests/:supportRequestId/reclaim` | `reclaim` (L142) | `system.partner_company.update` | แพลตฟอร์ม | เรียกคืน (คำขอ ซัพพอร์ต ระบบ) — _Explicitly take over a currently assigned case at the shown version_ | `B:SupportRequestReclaimDto` | `SupportRequestActionDto` (200) |
| 662 | POST | `/v1/system/support-requests/:supportRequestId/reply` | `reply` (L156) | `system.partner_company.update` | แพลตฟอร์ม | ตอบกลับ (คำขอ ซัพพอร์ต ระบบ) — _Send a request-bound LINE reply without exposing the LINE recipient id_ | `B:SupportRequestReplyDto` | `SupportRequestReplyResultDto` (200) |
| 663 | POST | `/v1/system/support-requests/:supportRequestId/resolve` | `resolve` (L171) | `system.partner_company.update` | แพลตฟอร์ม | แก้ไข/ปิดประเด็น (คำขอ ซัพพอร์ต ระบบ) — _Close a support request with an explicit resolution note_ | `B:SupportRequestResolveDto` | `SupportRequestActionDto` (200) |
| 664 | POST | `/v1/system/support-requests/:supportRequestId/answered` | `markAnswered` (L183) | `system.partner_company.update` | แพลตฟอร์ม | ทำเครื่องหมาย answered (คำขอ ซัพพอร์ต ระบบ) — _Mark this request answered (idempotent); records who answered_ | — | `SupportRequestActionDto` (200) |
| 665 | POST | `/v1/system/support-requests/:supportRequestId/resume-ai` | `resumeAssistant` (L196) | `system.partner_company.update` | แพลตฟอร์ม | ทำต่อ ผู้ช่วย (คำขอ ซัพพอร์ต ระบบ) — _Clear the assistant pause without changing the managed case outcome_ | — | `SupportRequestActionDto` (200) |
| 666 | POST | `/v1/system/support-requests/:supportRequestId/pause-ai` | `pauseAssistant` (L209) | `system.partner_company.update` | แพลตฟอร์ม | พัก ผู้ช่วย (คำขอ ซัพพอร์ต ระบบ) — _Pause the assistant without changing the managed case outcome_ | — | `SupportRequestActionDto` (200) |

### 2.16 โมดูล `feature-launch` — 4 endpoint

**`LaunchGateController`** — `apps/api/src/modules/feature-launch/presentation/http/launch-gate.controller.ts` · base path: `/v1/system/launch-gates` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 667 | POST | `/v1/system/launch-gates/commands` | `command` (L55) | `system.launch_gate.manage` | แพลตฟอร์ม | ดำเนินการ คำสั่ง (ด่าน การเปิดตัว) — _Internal control plane: OPEN/CLOSE one exact launch route_ | `B:LaunchGateCommandBodyDto` | `→ LaunchGateCommandUseCase.execute()` (200) |
| 668 | GET | `/v1/system/launch-gates/health` | `health` (L78) | `system.launch_gate.read` | แพลตฟอร์ม | ดู สุขภาพระบบ (ด่าน การเปิดตัว) — _Internal launch-health view (tenant-anonymous, read-only)_ | — | `→ GetLaunchHealthUseCase.execute()` |

**`RunoffInternalController`** — `apps/api/src/modules/feature-launch/presentation/http/runoff-internal.controller.ts` · base path: `/v1/internal/feature-launch` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 669 | POST | `/v1/internal/feature-launch/runoff/sweep` | `sweep` (L37) | Public — `X-Worker-Token` | แพลตฟอร์ม | กวาดตรวจตามรอบ (ภายใน runoff) | `B:{ limit?: number; cursorId?: string }` | — |
| 670 | POST | `/v1/internal/feature-launch/runoff/draining` | `draining` (L57) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ สถานะระบายคิว (ภายใน runoff) | `B:{ limit?: number; cursorId?: string }` | — |

### 2.17 โมดูล `health` — 3 endpoint

**`HealthInternalController`** — `apps/api/src/modules/health/presentation/http/health-internal.controller.ts` · base path: `/v1/internal/health` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 671 | GET | `/v1/internal/health/readiness` | `readiness` (L17) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดู ความพร้อม (ภายใน สุขภาพระบบ) | — | `→ GetHealthUseCase.readiness()` |

**`HealthController`** — `apps/api/src/modules/health/presentation/http/health.controller.ts` · base path: `/v1/health` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 672 | GET | `/v1/health` | `getHealth` (L12) | Public | แพลตฟอร์ม | ดูข้อมูล สุขภาพระบบ | — | `→ GetHealthUseCase.execute()` |

**`ProtectedTestController`** — `apps/api/src/modules/health/presentation/http/protected-test.controller.ts` · base path: `/v1/test` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 673 | GET | `/v1/test/protected` | `protectedRoute` (L8) | `health.read` | ทุกแพ็ก | ดู เส้นทาง ที่ป้องกัน | — | `object` |

### 2.18 โมดูล `inventory` — 29 endpoint

**`InventoryLocationController`** — `apps/api/src/modules/inventory/presentation/http/inventory-location.controller.ts` · base path: `/v1/companies/:companyId/inventory/locations` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 674 | GET | `/v1/companies/:companyId/inventory/locations` | `list` (L29) | `inventory.location.read` | ไม่ขาย(inventory) | ดูรายการ (สถานที่จัดเก็บ คลังสินค้า) | `Q:any` | `→ ListLocationsUseCase.execute()` |
| 675 | POST | `/v1/companies/:companyId/inventory/locations` | `create` (L43) | `inventory.location.manage` | ไม่ขาย(inventory) | สร้าง (สถานที่จัดเก็บ คลังสินค้า) | `B:CreateLocationDto` | `→ CreateLocationUseCase.execute()` |
| 676 | GET | `/v1/companies/:companyId/inventory/locations/:locationId/balances` | `balances` (L50) | `inventory.report.read` | ไม่ขาย(inventory) | ดู ยอดคงเหลือ (สถานที่จัดเก็บ คลังสินค้า) | `Q:any` | `→ GetStockBalanceUseCase.execute()` |
| 677 | POST | `/v1/companies/:companyId/inventory/locations/:locationId/internal-qr` | `locationQr` (L57) | `inventory.label.manage` | ไม่ขาย(inventory) | ดำเนินการ QR สถานที่จัดเก็บ | `B:GenerateEntityQrDto` | `→ GenerateQrLabelUseCase.execute()` |
| 678 | POST | `/v1/companies/:companyId/inventory/locations/:locationId/archive` | `archive` (L64) | `inventory.location.manage` | ไม่ขาย(inventory) | เก็บเข้าคลัง (archive) (สถานที่จัดเก็บ คลังสินค้า) | — | `→ ArchiveLocationUseCase.execute()` |
| 679 | GET | `/v1/companies/:companyId/inventory/locations/:locationId` | `getOne` (L71) | `inventory.location.read` | ไม่ขาย(inventory) | ดูข้อมูล (สถานที่จัดเก็บ คลังสินค้า) | — | `→ GetLocationUseCase.execute()` |
| 680 | PATCH | `/v1/companies/:companyId/inventory/locations/:locationId` | `update` (L78) | `inventory.location.manage` | ไม่ขาย(inventory) | แก้ไข (สถานที่จัดเก็บ คลังสินค้า) | `B:UpdateLocationDto` | `→ UpdateLocationUseCase.execute()` |

**`InventoryMovementController`** — `apps/api/src/modules/inventory/presentation/http/inventory-movement.controller.ts` · base path: `/v1/companies/:companyId/inventory` · 8 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 681 | GET | `/v1/companies/:companyId/inventory/movements` | `list` (L23) | `inventory.movement.read` | ไม่ขาย(inventory) | ดูรายการ (ความเคลื่อนไหว คลังสินค้า) | `Q:any` | `→ ListMovementsUseCase.execute()` |
| 682 | POST | `/v1/companies/:companyId/inventory/movements/receive` | `receive` (L39) | `inventory.movement.create` | ไม่ขาย(inventory) | รับ (ความเคลื่อนไหว คลังสินค้า) | `B:CreateMovementDto` | `→ CreateMovementUseCase.execute()` |
| 683 | POST | `/v1/companies/:companyId/inventory/movements/issue` | `issue` (L46) | `inventory.movement.create` | ไม่ขาย(inventory) | ออกเอกสาร (ความเคลื่อนไหว คลังสินค้า) | `B:CreateMovementDto` | `→ CreateMovementUseCase.execute()` |
| 684 | POST | `/v1/companies/:companyId/inventory/movements/transfer` | `transfer` (L53) | `inventory.movement.create` | ไม่ขาย(inventory) | โอน (ความเคลื่อนไหว คลังสินค้า) | `B:TransferStockDto` | `→ TransferStockUseCase.execute()` |
| 685 | POST | `/v1/companies/:companyId/inventory/movements/count` | `count` (L60) | `inventory.stock_count.create` | ไม่ขาย(inventory) | นับ (ความเคลื่อนไหว คลังสินค้า) | `B:StockCountDto` | `→ StockCountUseCase.execute()` |
| 686 | POST | `/v1/companies/:companyId/inventory/movements/adjust` | `adjust` (L67) | `inventory.movement.adjust` | ไม่ขาย(inventory) | ปรับปรุง (ความเคลื่อนไหว คลังสินค้า) | `B:CreateMovementDto` | `→ CreateMovementUseCase.execute()` |
| 687 | GET | `/v1/companies/:companyId/inventory/balances` | `balance` (L75) | `inventory.report.read` | ไม่ขาย(inventory) | ดู ยอดคงเหลือ (ความเคลื่อนไหว คลังสินค้า) | `Q:any` | `→ GetStockBalanceUseCase.execute()` |
| 688 | GET | `/v1/companies/:companyId/inventory/reports/stock` | `stockReport` (L82) | `inventory.report.read` | ไม่ขาย(inventory) | ดู รายงาน สต๊อก | `Q:any` | `→ GetStockReportUseCase.execute()` |

**`InventoryProductController`** — `apps/api/src/modules/inventory/presentation/http/inventory-product.controller.ts` · base path: `/v1/companies/:companyId/inventory/products` · 9 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 689 | GET | `/v1/companies/:companyId/inventory/products` | `list` (L28) | `inventory.product.read` | ไม่ขาย(product_catalog) | ดูรายการ (สินค้า คลังสินค้า) | `Q:any` | `→ ListProductsUseCase.execute()` |
| 690 | POST | `/v1/companies/:companyId/inventory/products` | `create` (L42) | `inventory.product.manage` | ไม่ขาย(product_catalog) | สร้าง (สินค้า คลังสินค้า) | `B:CreateProductDto` | `→ CreateProductUseCase.execute()` |
| 691 | GET | `/v1/companies/:companyId/inventory/products/:productId/movements` | `movements` (L49) | `inventory.movement.read` | ไม่ขาย(inventory) | ดู ความเคลื่อนไหว (สินค้า คลังสินค้า) | `Q:any` | `→ ListMovementsUseCase.execute()` |
| 692 | GET | `/v1/companies/:companyId/inventory/products/:productId/balances` | `balances` (L62) | `inventory.report.read` | ไม่ขาย(inventory) | ดู ยอดคงเหลือ (สินค้า คลังสินค้า) | `Q:any` | `→ GetStockBalanceUseCase.execute()` |
| 693 | POST | `/v1/companies/:companyId/inventory/products/:productId/barcodes` | `barcode` (L69) | `inventory.label.manage` | ไม่ขาย(inventory) | ดำเนินการ บาร์โค้ด (สินค้า คลังสินค้า) | `B:AddProductBarcodeDto` | `→ AddProductBarcodeUseCase.execute()` |
| 694 | POST | `/v1/companies/:companyId/inventory/products/:productId/internal-qr` | `productQr` (L76) | `inventory.label.manage` | ไม่ขาย(inventory) | ดำเนินการ QR สินค้า | `B:GenerateEntityQrDto` | `→ GenerateQrLabelUseCase.execute()` |
| 695 | POST | `/v1/companies/:companyId/inventory/products/:productId/archive` | `archive` (L83) | `inventory.product.manage` | ไม่ขาย(product_catalog) | เก็บเข้าคลัง (archive) (สินค้า คลังสินค้า) | — | `→ ArchiveProductUseCase.execute()` |
| 696 | GET | `/v1/companies/:companyId/inventory/products/:productId` | `getOne` (L90) | `inventory.product.read` | ไม่ขาย(product_catalog) | ดูข้อมูล (สินค้า คลังสินค้า) | — | `→ GetProductUseCase.execute()` |
| 697 | PATCH | `/v1/companies/:companyId/inventory/products/:productId` | `update` (L97) | `inventory.product.manage` | ไม่ขาย(product_catalog) | แก้ไข (สินค้า คลังสินค้า) | `B:UpdateProductDto` | `→ UpdateProductUseCase.execute()` |

**`InventoryQrController`** — `apps/api/src/modules/inventory/presentation/http/inventory-qr.controller.ts` · base path: `/v1/companies/:companyId/inventory/labels` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 698 | GET | `/v1/companies/:companyId/inventory/labels` | `list` (L18) | `inventory.label.manage` | ไม่ขาย(inventory) | ดูรายการ (QR คลังสินค้า) | `Q{entityType,entityId}` | `→ ListQrLabelsUseCase.execute()` |
| 699 | POST | `/v1/companies/:companyId/inventory/labels/generate` | `generate` (L30) | `inventory.label.manage` | ไม่ขาย(inventory) | สร้าง/ประมวลผล (QR คลังสินค้า) | `B:GenerateQrLabelDto` | `→ GenerateQrLabelUseCase.execute()` |
| 700 | GET | `/v1/companies/:companyId/inventory/labels/resolve` | `resolve` (L37) | `inventory.product.read` | ไม่ขาย(product_catalog) | แก้ไข/ปิดประเด็น (QR คลังสินค้า) | `Q{payload}` | `→ ResolveQrScanUseCase.execute()` |
| 701 | POST | `/v1/companies/:companyId/inventory/labels/scan` | `scan` (L44) | `inventory.product.read` | ไม่ขาย(product_catalog) | สแกน/กวาดตรวจ (QR คลังสินค้า) | `B{payload}` | `→ ResolveQrScanUseCase.execute()` |
| 702 | POST | `/v1/companies/:companyId/inventory/labels/:labelId/printed` | `markAsPrinted` (L51) | `inventory.label.manage` | ไม่ขาย(inventory) | ทำเครื่องหมาย เป็น ที่พิมพ์แล้ว | — | `→ MarkQrLabelPrintedUseCase.execute()` |

### 2.19 โมดูล `ledger` — 29 endpoint

**`ExpenseAutoPostInternalController`** — `apps/api/src/modules/ledger/presentation/http/expense-auto-post-internal.controller.ts` · base path: `/v1/internal/ledger/expense-auto-post` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 703 | POST | `/v1/internal/ledger/expense-auto-post/drain` | `execute` (L11) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ (ภายใน การลงบัญชี อัตโนมัติ รายจ่าย) | `B:{ limit?: number }` | `→ DrainExpenseAutoPostUseCase.execute()` |

**`LedgerController`** — `apps/api/src/modules/ledger/presentation/http/ledger.controller.ts` · base path: `/v1/companies/:companyId` · 28 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 704 | GET | `/v1/companies/:companyId/chart-of-accounts` | `listAccountsHandler` (L72) | `ledger.account.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ บัญชี (บัญชีแยกประเภท) — _List chart of accounts_ | `Q{accountClass,status}` | `→ ListAccountsUseCase.execute()` |
| 705 | GET | `/v1/companies/:companyId/chart-of-accounts/templates` | `listChartTemplatesHandler` (L79) | `ledger.account.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ แม่แบบ ผังบัญชี — _List available chart templates_ | — | `→ ChartTemplateService.list()` |
| 706 | GET | `/v1/companies/:companyId/chart-of-accounts/templates/:templateKey/preview` | `previewChartTemplateHandler` (L86) | `ledger.account.read` | ไม่ขาย(double_entry_ledger) | ดูตัวอย่าง แม่แบบ ผังบัญชี — _Preview chart template changes and dependencies_ | — | `→ ChartTemplateService.preview()` |
| 707 | POST | `/v1/companies/:companyId/chart-of-accounts/templates/:templateKey/apply` | `applyChartTemplateHandler` (L96) | `ledger.account.manage` | ไม่ขาย(double_entry_ledger) | นำไปใช้ แม่แบบ ผังบัญชี — _Apply a confirmed chart template preview_ | `B:ApplyChartTemplateDto` | `→ ChartTemplateService.apply()` (200) |
| 708 | GET | `/v1/companies/:companyId/chart-of-accounts/readiness` | `chartReadinessHandler` (L108) | `ledger.account.read` | ไม่ขาย(double_entry_ledger) | ดู ความพร้อม ผังบัญชี — _Get computed chart and automatic-posting readiness_ | — | `→ ChartTemplateService.readiness()` |
| 709 | GET | `/v1/companies/:companyId/chart-of-accounts/:accountId` | `getAccountHandler` (L115) | `ledger.account.read` | ไม่ขาย(double_entry_ledger) | ดูข้อมูล บัญชี (บัญชีแยกประเภท) — _Get account_ | — | `→ GetAccountUseCase.execute()` |
| 710 | POST | `/v1/companies/:companyId/chart-of-accounts` | `createAccountHandler` (L122) | `ledger.account.manage` | ไม่ขาย(double_entry_ledger) | สร้าง บัญชี (บัญชีแยกประเภท) — _Create account_ | `B:CreateChartOfAccountDto` | `→ CreateAccountUseCase.execute()` |
| 711 | PATCH | `/v1/companies/:companyId/chart-of-accounts/:accountId` | `updateAccountHandler` (L129) | `ledger.account.manage` | ไม่ขาย(double_entry_ledger) | แก้ไข บัญชี (บัญชีแยกประเภท) — _Update account_ | `B:UpdateChartOfAccountDto` | `→ UpdateAccountUseCase.execute()` |
| 712 | GET | `/v1/companies/:companyId/journal-entries` | `listJournalsHandler` (L138) | `ledger.journal.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ สมุดรายวัน (บัญชีแยกประเภท) — _List journal entries_ | `Q:any` | `→ ListJournalsUseCase.execute()` |
| 713 | GET | `/v1/companies/:companyId/journal-entries/:journalId` | `getJournalHandler` (L145) | `ledger.journal.read` | ไม่ขาย(double_entry_ledger) | ดูข้อมูล สมุดรายวัน (บัญชีแยกประเภท) — _Get journal entry_ | — | `→ GetJournalUseCase.execute()` |
| 714 | POST | `/v1/companies/:companyId/journal-entries/manual` | `createManualHandler` (L152) | `journal.entry.create` | ไม่ขาย(double_entry_ledger) | สร้าง แบบกรอกเอง (บัญชีแยกประเภท) — _Create draft manual journal_ | `B:CreateManualJournalDto` | `→ CreateManualJournalUseCase.execute()` |
| 715 | POST | `/v1/companies/:companyId/journal-entries/:journalId/post` | `postJournalHandler` (L159) | `journal.entry.post` | ไม่ขาย(double_entry_ledger) | ลงบัญชี (post) สมุดรายวัน (บัญชีแยกประเภท) — _Post journal entry_ | — | `→ PostJournalUseCase.execute()` (200) |
| 716 | POST | `/v1/companies/:companyId/journal-entries/:journalId/reverse` | `reverseJournalHandler` (L167) | `journal.entry.reverse` | ไม่ขาย(double_entry_ledger) | กลับรายการ สมุดรายวัน (บัญชีแยกประเภท) — _Reverse posted journal_ | `B:{ memo?: string }` | `→ ReverseJournalUseCase.execute()` (200) |
| 717 | POST | `/v1/companies/:companyId/posting/generate` | `generateJournalHandler` (L175) | `journal.entry.create` + `journal.entry.post` | ไม่ขาย(double_entry_ledger) | สร้าง/ประมวลผล สมุดรายวัน (บัญชีแยกประเภท) — _Generate journal from source document_ | `B:GenerateJournalFromSourceDto` | `→ GenerateJournalFromSourceUseCase.execute()` (200) |
| 718 | GET | `/v1/companies/:companyId/posting/expense-account-bindings` | `listExpenseAccountBindingsHandler` (L185) | `ledger.posting-rule.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ การผูก บัญชี รายจ่าย — _List expense categories and their reviewed ledger accounts_ | — | `→ ListExpenseAccountBindingsUseCase.execute()` |
| 719 | PUT | `/v1/companies/:companyId/posting/expense-account-bindings/:categoryId` | `setExpenseAccountBindingHandler` (L192) | `ledger.posting-rule.manage` | ไม่ขาย(double_entry_ledger) | ตั้งค่า การผูก บัญชี รายจ่าย — _Set or clear the reviewed ledger account of an expense category_ | `B:SetExpenseAccountBindingDto` | `→ SetExpenseAccountBindingUseCase.execute()` |
| 720 | GET | `/v1/companies/:companyId/posting/expense-backfill-preview` | `previewExpenseBackfillHandler` (L203) | `expense.read` + `journal.entry.create` + `journal.entry.post` | ไม่ขาย(double_entry_ledger) | ดูตัวอย่าง การเติมย้อนหลัง รายจ่าย — _Preview historical pending expenses before explicit backfill_ | — | `→ PreviewExpenseBackfillUseCase.execute()` |
| 721 | POST | `/v1/companies/:companyId/posting/expense-backfill` | `runExpenseBackfillHandler` (L210) | `expense.read` + `journal.entry.create` + `journal.entry.post` | ไม่ขาย(double_entry_ledger) | รัน การเติมย้อนหลัง รายจ่าย — _Explicitly backfill eligible historical pending expenses_ | `B:{ confirmed: boolean; limit?: number }` | `→ RunExpenseBackfillUseCase.execute()` (200) |
| 722 | GET | `/v1/companies/:companyId/periods` | `listPeriodsHandler` (L223) | `ledger.period.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ งวด (บัญชีแยกประเภท) — _List accounting periods_ | — | `→ ListPeriodsUseCase.execute()` |
| 723 | POST | `/v1/companies/:companyId/periods/ensure/:periodKey` | `ensurePeriodHandler` (L230) | `ledger.period.read` | ไม่ขาย(double_entry_ledger) | ตรวจให้มี งวด (บัญชีแยกประเภท) — _Ensure period exists_ | — | `→ EnsurePeriodUseCase.execute()` (200) |
| 724 | POST | `/v1/companies/:companyId/periods/:periodId/close-checks` | `closeChecksHandler` (L238) | `ledger.period.read` | ไม่ขาย(double_entry_ledger) | ปิด การตรวจ (บัญชีแยกประเภท) — _Run period close checks_ | — | `→ RunPeriodCloseChecksUseCase.execute()` (200) |
| 725 | POST | `/v1/companies/:companyId/periods/:periodId/close` | `closePeriodHandler` (L246) | `ledger.period.close` | ไม่ขาย(double_entry_ledger) | ปิด งวด (บัญชีแยกประเภท) — _Close period_ | `B:{ note?: string }` | `→ ClosePeriodUseCase.execute()` (200) |
| 726 | POST | `/v1/companies/:companyId/periods/:periodId/unclose` | `unclosePeriodHandler` (L254) | `ledger.period.unclose` | ไม่ขาย(double_entry_ledger) | ยกเลิกการปิด งวด (บัญชีแยกประเภท) — _Reopen closed period_ | `B:{ note: string }` | `→ UnclosePeriodUseCase.execute()` (200) |
| 727 | GET | `/v1/companies/:companyId/reports/general-ledger` | `glHandler` (L264) | `ledger.report.read` | ไม่ขาย(double_entry_ledger) | ดู GL (บัญชีแยกประเภท) — _General Ledger report_ | `Q{periodKey,accountId}` | `→ GetGeneralLedgerUseCase.execute()` |
| 728 | GET | `/v1/companies/:companyId/reports/trial-balance` | `tbHandler` (L271) | `ledger.report.read` | ไม่ขาย(double_entry_ledger) | ดู งบทดลอง (บัญชีแยกประเภท) — _Trial Balance_ | `Q{periodKey}` | `→ GetTrialBalanceUseCase.execute()` |
| 729 | GET | `/v1/companies/:companyId/reports/profit-and-loss` | `pnlHandler` (L278) | `ledger.report.read` | ไม่ขาย(double_entry_ledger) | ดู กำไรขาดทุน (บัญชีแยกประเภท) — _Profit and Loss_ | `Q{periodKey}` | `→ GetPnlReportUseCase.execute()` |
| 730 | GET | `/v1/companies/:companyId/reports/balance-sheet` | `bsHandler` (L285) | `ledger.report.read` | ไม่ขาย(double_entry_ledger) | ดู งบดุล (บัญชีแยกประเภท) — _Balance Sheet_ | `Q{periodKey}` | `→ GetBalanceSheetUseCase.execute()` |
| 731 | POST | `/v1/companies/:companyId/reports/:reportType/export` | `exportHandler` (L292) | `ledger.export` | ไม่ขาย(double_entry_ledger) | ส่งออก (บัญชีแยกประเภท) — _Export ledger report (stub)_ | `B:{ periodKey: string }` | `→ ExportReportUseCase.execute()` (200) |

### 2.20 โมดูล `line-ai` — 7 endpoint

**`InternalAiBudgetController`** — `apps/api/src/modules/line-ai/presentation/http/internal-ai-budget.controller.ts` · base path: `/v1/internal/ai` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 732 | POST | `/v1/internal/ai/budget-step` | `budgetStep` (L87) | Public — `X-Internal-Secret` | แพลตฟอร์ม | ดำเนินการ ขั้นตอน งบประมาณ — _Reserve the next provider invocation of an existing attempt_ | `B:AiBudgetStepDto` | `→ authority.reserve()` (200) |
| 733 | POST | `/v1/internal/ai/budget-settle` | `budgetSettle` (L153) | Public — `X-Internal-Secret` | แพลตฟอร์ม | ดำเนินการ การชำระ งบประมาณ — _Settle one provider invocation from its usage evidence_ | `B:AiBudgetSettleDto` | `→ logger.warn()` (200) |

**`InternalToolsController`** — `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts` · base path: `/v1/internal/ai/tools` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 734 | POST | `/v1/internal/ai/tools/invoke` | `invoke` (L360) | Public — `X-Internal-Secret`; `X-Actor-Delegation` | แพลตฟอร์ม | เรียกใช้ (เครื่องมือ ภายใน) — _Internal: invoke a read-only ERP tool (AI Gateway only)_ | `B:InternalToolCallDto` | `ToolResult` (200) |

**`LineAiLedgerInternalController`** — `apps/api/src/modules/line-ai/presentation/http/line-ai-ledger-internal.controller.ts` · base path: `/v1/internal/ai/line-ledger` · `@Public()` ระดับ class · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 735 | POST | `/v1/internal/ai/line-ledger/drain` | `drainLedger` (L20) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน บัญชีแยกประเภท (ภายใน AI LINE) | `B:{ batchSize?: number }` | `→ DrainLineLedgerUseCase.execute()` |
| 736 | POST | `/v1/internal/ai/line-ledger/sweep-orphan-events` | `sweepOrphanEvents` (L28) | Public — `X-Worker-Token` | แพลตฟอร์ม | กวาดตรวจตามรอบ เหตุการณ์ ที่ค้างไร้เจ้าของ | `B:{ batchSize?: number }` | `→ RecoverOrphanLineEventsUseCase.execute()` |

**`LineCaptureResultsInternalController`** — `apps/api/src/modules/line-ai/presentation/http/line-capture-results-internal.controller.ts` · base path: `/v1/internal/ai/line-capture-results` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 737 | POST | `/v1/internal/ai/line-capture-results/drain` | `drain` (L25) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน ผลลัพธ์ การจับภาพเอกสาร LINE) | `B:DrainCaptureResultsBodyDto` | `→ LineCaptureResultNotifierUseCase.execute()` |

**`LineDocumentQaInternalController`** — `apps/api/src/modules/line-ai/presentation/http/line-document-qa-internal.controller.ts` · base path: `/v1/internal/ai/line-document-qa` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 738 | POST | `/v1/internal/ai/line-document-qa/drain` | `drain` (L16) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน ถาม-ตอบ เอกสาร LINE) | `B:LineDocumentQaDrainDto` | `Promise<` |

### 2.21 โมดูล `procurement` — 51 endpoint

**`GoodsReceiptController`** — `apps/api/src/modules/procurement/presentation/http/goods-receipt.controller.ts` · base path: `/v1/companies/:companyId/procurement/goods-receipts` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 739 | GET | `/v1/companies/:companyId/procurement/goods-receipts` | `list` (L19) | any(`procurement.goods_receipt.read` \| `procurement.goods_receipt.read_related`) | ไม่ขาย(procurement,procurement.goods_receipts) | ดูรายการ (ใบเสร็จ สินค้า) | `Q:any` | `→ ListGoodsReceiptsUseCase.execute()` |
| 740 | POST | `/v1/companies/:companyId/procurement/goods-receipts` | `create` (L26) | `procurement.goods_receipt.create` | ไม่ขาย(procurement) | สร้าง (ใบเสร็จ สินค้า) | `B:CreateGoodsReceiptDto` | `→ CreateGoodsReceiptUseCase.execute()` |
| 741 | GET | `/v1/companies/:companyId/procurement/goods-receipts/:id` | `get` (L33) | any(`procurement.goods_receipt.read` \| `procurement.goods_receipt.read_related`) | ไม่ขาย(procurement,procurement.goods_receipts) | ดูข้อมูล (ใบเสร็จ สินค้า) | — | `→ GetGoodsReceiptUseCase.execute()` |
| 742 | POST | `/v1/companies/:companyId/procurement/goods-receipts/:id/post` | `post` (L40) | `procurement.goods_receipt.post` | ไม่ขาย(procurement) | ลงบัญชี (post) (ใบเสร็จ สินค้า) | — | `→ PostGoodsReceiptUseCase.execute()` |
| 743 | POST | `/v1/companies/:companyId/procurement/goods-receipts/:id/void` | `void` (L47) | `procurement.goods_receipt.void` | ไม่ขาย(procurement) | ยกเลิก (void) (ใบเสร็จ สินค้า) | `B:RequiredReasonDto` | `→ VoidGoodsReceiptUseCase.execute()` |

**`Pp36InputClaimController`** — `apps/api/src/modules/procurement/presentation/http/pp36-input-claim.controller.ts` · base path: `/v1/companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 744 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:vendorBillId/lines/:lineId/pp36-input-claim` | `execute` (L14) | `tax.review_issue.resolve` | ไม่ขาย(thai_tax) | ดำเนินการ (ใบเบิก/claim ภาษีซื้อ/นำเข้า ภ.พ.36) — _Release payment-recognized PP36 input VAT after verified Revenue Department receipt_ | `B:{ supplierPaymentId?: string; evidenceId: string; claimDate: string; reason: string }` | `→ ReleasePp36InputVatClaimUseCase.execute()` (200) |

**`PurchaseOrderController`** — `apps/api/src/modules/procurement/presentation/http/purchase-order.controller.ts` · base path: `/v1/companies/:companyId/procurement/purchase-orders` · 8 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 745 | GET | `/v1/companies/:companyId/procurement/purchase-orders` | `list` (L22) | any(`procurement.purchase_order.read` \| `procurement.purchase_order.read_related`) | ไม่ขาย(procurement,procurement.purchase_orders) | ดูรายการ (ใบสั่ง การซื้อ) | `Q:any` | `→ ListPurchaseOrdersUseCase.execute()` |
| 746 | POST | `/v1/companies/:companyId/procurement/purchase-orders` | `create` (L29) | `procurement.purchase_order.create` | ไม่ขาย(procurement) | สร้าง (ใบสั่ง การซื้อ) | `B:CreatePurchaseOrderDto` | `→ CreatePurchaseOrderUseCase.execute()` |
| 747 | GET | `/v1/companies/:companyId/procurement/purchase-orders/:id` | `get` (L36) | any(`procurement.purchase_order.read` \| `procurement.purchase_order.read_related`) | ไม่ขาย(procurement,procurement.purchase_orders) | ดูข้อมูล (ใบสั่ง การซื้อ) | — | `→ GetPurchaseOrderUseCase.execute()` |
| 748 | POST | `/v1/companies/:companyId/procurement/purchase-orders/:id/approve` | `approve` (L43) | `procurement.purchase_order.approve` | ไม่ขาย(procurement) | อนุมัติ (ใบสั่ง การซื้อ) | `B:ApprovalNoteDto` | `→ ApprovePurchaseOrderUseCase.execute()` |
| 749 | POST | `/v1/companies/:companyId/procurement/purchase-orders/:id/issue` | `issue` (L50) | `procurement.purchase_order.issue` | ไม่ขาย(procurement) | ออกเอกสาร (ใบสั่ง การซื้อ) | — | `→ IssuePurchaseOrderUseCase.execute()` |
| 750 | POST | `/v1/companies/:companyId/procurement/purchase-orders/:id/reject` | `reject` (L57) | `procurement.purchase_order.approve` | ไม่ขาย(procurement) | ปฏิเสธ (ใบสั่ง การซื้อ) | `B:RequiredNoteDto` | `→ RejectPurchaseOrderUseCase.execute()` |
| 751 | POST | `/v1/companies/:companyId/procurement/purchase-orders/:id/cancel` | `cancel` (L64) | `procurement.purchase_order.manage` | ไม่ขาย(procurement) | ยกเลิก (ใบสั่ง การซื้อ) | `B:ReasonDto` | `→ CancelPurchaseOrderUseCase.execute()` |
| 752 | POST | `/v1/companies/:companyId/procurement/purchase-orders/:id/close` | `close` (L71) | `procurement.purchase_order.manage` | ไม่ขาย(procurement) | ปิด (ใบสั่ง การซื้อ) | `B:ReasonDto` | `→ ClosePurchaseOrderUseCase.execute()` |

**`PurchaseRequestController`** — `apps/api/src/modules/procurement/presentation/http/purchase-request.controller.ts` · base path: `/v1/companies/:companyId/procurement/purchase-requests` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 753 | GET | `/v1/companies/:companyId/procurement/purchase-requests` | `list` (L21) | any(`procurement.purchase_request.read` \| `procurement.purchase_request.read_related`) | ไม่ขาย(procurement,procurement.purchase_requests) | ดูรายการ (คำขอ การซื้อ) | `Q:any` | `→ ListPurchaseRequestsUseCase.execute()` |
| 754 | POST | `/v1/companies/:companyId/procurement/purchase-requests` | `create` (L28) | `procurement.purchase_request.create` | ไม่ขาย(procurement) | สร้าง (คำขอ การซื้อ) | `B:CreatePurchaseRequestDto` | `→ CreatePurchaseRequestUseCase.execute()` |
| 755 | GET | `/v1/companies/:companyId/procurement/purchase-requests/:id` | `get` (L35) | any(`procurement.purchase_request.read` \| `procurement.purchase_request.read_related`) | ไม่ขาย(procurement,procurement.purchase_requests) | ดูข้อมูล (คำขอ การซื้อ) | — | `→ GetPurchaseRequestUseCase.execute()` |
| 756 | POST | `/v1/companies/:companyId/procurement/purchase-requests/:id/submit` | `submit` (L42) | `procurement.purchase_request.create` | ไม่ขาย(procurement) | ส่ง (คำขอ การซื้อ) | — | `→ SubmitPurchaseRequestUseCase.execute()` |
| 757 | POST | `/v1/companies/:companyId/procurement/purchase-requests/:id/approve` | `approve` (L49) | `procurement.purchase_request.approve` | ไม่ขาย(procurement) | อนุมัติ (คำขอ การซื้อ) | `B:ApprovalNoteDto` | `→ ApprovePurchaseRequestUseCase.execute()` |
| 758 | POST | `/v1/companies/:companyId/procurement/purchase-requests/:id/reject` | `reject` (L56) | `procurement.purchase_request.approve` | ไม่ขาย(procurement) | ปฏิเสธ (คำขอ การซื้อ) | `B:RequiredNoteDto` | `→ RejectPurchaseRequestUseCase.execute()` |
| 759 | POST | `/v1/companies/:companyId/procurement/purchase-requests/:id/cancel` | `cancel` (L63) | `procurement.purchase_request.create` | ไม่ขาย(procurement) | ยกเลิก (คำขอ การซื้อ) | `B:ReasonDto` | `→ CancelPurchaseRequestUseCase.execute()` |

**`SupplierPaymentController`** — `apps/api/src/modules/procurement/presentation/http/supplier-payment.controller.ts` · base path: `/v1/companies/:companyId/accounts-payable` · 9 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 760 | GET | `/v1/companies/:companyId/accounts-payable/payments` | `list` (L25) | any(`procurement.supplier_payment.read` \| `procurement.supplier_payment.read_related`) | ไม่ขาย(procurement,procurement.supplier_payments) | ดูรายการ (การจ่ายเงิน ผู้ขาย) | `Q:any` | `→ ListSupplierPaymentsUseCase.execute()` |
| 761 | POST | `/v1/companies/:companyId/accounts-payable/payments` | `create` (L32) | `procurement.supplier_payment.create` + `procurement.supplier_payment.release` | ไม่ขาย(procurement) | สร้าง (การจ่ายเงิน ผู้ขาย) | `B:CreateSupplierPaymentDto` | `→ CreateSupplierPaymentUseCase.execute()` |
| 762 | GET | `/v1/companies/:companyId/accounts-payable/wht-income-categories` | `whtIncomeCategories` (L41) | `procurement.supplier_payment.read` | ไม่ขาย(procurement) | ดู หมวดหมู่ รายรับ ภาษีหัก ณ ที่จ่าย | — | `→ ListWhtIncomeCategoriesUseCase.execute()` |
| 763 | GET | `/v1/companies/:companyId/accounts-payable/payments/:id` | `get` (L48) | any(`procurement.supplier_payment.read` \| `procurement.supplier_payment.read_related`) | ไม่ขาย(procurement,procurement.supplier_payments) | ดูข้อมูล (การจ่ายเงิน ผู้ขาย) | — | `→ GetSupplierPaymentUseCase.execute()` |
| 764 | GET | `/v1/companies/:companyId/accounts-payable/payments/:id/posting-source` | `postingSource` (L55) | `procurement.supplier_payment.read` | ไม่ขาย(procurement) | ดู แหล่งที่มา การลงบัญชี | — | `→ GetSupplierPaymentPostingSourceUseCase.execute()` |
| 765 | GET | `/v1/companies/:companyId/accounts-payable/payments/:id/pp36-posting-source` | `pp36PostingSource` (L62) | `procurement.supplier_payment.read` | ไม่ขาย(procurement) | ดู แหล่งที่มา การลงบัญชี ภ.พ.36 | — | `→ GetSupplierPaymentPp36PostingSourceUseCase.execute()` |
| 766 | POST | `/v1/companies/:companyId/accounts-payable/payments/:id/void` | `void` (L69) | `procurement.supplier_payment.void` | ไม่ขาย(procurement) | ยกเลิก (void) (การจ่ายเงิน ผู้ขาย) | `B:RequiredReasonDto` | `→ VoidSupplierPaymentUseCase.execute()` |
| 767 | GET | `/v1/companies/:companyId/accounts-payable/aging` | `aging` (L76) | `procurement.ap.report` | ไม่ขาย(procurement) | ดู อายุหนี้ (การจ่ายเงิน ผู้ขาย) | `Q:any` | `→ GetApAgingUseCase.execute()` |
| 768 | GET | `/v1/companies/:companyId/accounts-payable/suppliers/:supplierId/statement` | `statement` (L83) | `procurement.ap.report` | ไม่ขาย(procurement) | ดู รายการเดินบัญชี (การจ่ายเงิน ผู้ขาย) | `Q:any` | `→ GetSupplierStatementUseCase.execute()` |

**`SupplierController`** — `apps/api/src/modules/procurement/presentation/http/supplier.controller.ts` · base path: `/v1/companies/:companyId/procurement/suppliers` · 6 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 769 | GET | `/v1/companies/:companyId/procurement/suppliers` | `list` (L20) | `procurement.supplier.read` | ไม่ขาย(procurement) | ดูรายการ (ผู้ขาย) | `Q:any` | `→ ListSuppliersUseCase.execute()` |
| 770 | POST | `/v1/companies/:companyId/procurement/suppliers` | `create` (L27) | `procurement.supplier.manage` | ไม่ขาย(procurement) | สร้าง (ผู้ขาย) | `B:CreateSupplierDto` | `→ CreateSupplierUseCase.execute()` |
| 771 | GET | `/v1/companies/:companyId/procurement/suppliers/:supplierId` | `get` (L34) | `procurement.supplier.read` | ไม่ขาย(procurement) | ดูข้อมูล (ผู้ขาย) | — | `→ GetSupplierUseCase.execute()` |
| 772 | PATCH | `/v1/companies/:companyId/procurement/suppliers/:supplierId` | `update` (L41) | `procurement.supplier.manage` | ไม่ขาย(procurement) | แก้ไข (ผู้ขาย) | `B:UpdateSupplierDto` | `→ UpdateSupplierUseCase.execute()` |
| 773 | GET | `/v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | `getBankAccounts` (L48) | `procurement.supplier.bank.read` | ไม่ขาย(procurement) | ดูข้อมูล บัญชี ธนาคาร | — | `→ ListSupplierBankAccountsUseCase.execute()` |
| 774 | POST | `/v1/companies/:companyId/procurement/suppliers/:supplierId/bank-accounts` | `createBankAccount` (L55) | `procurement.supplier.bank.manage` | ไม่ขาย(procurement) | สร้าง บัญชี ธนาคาร | `B:CreateSupplierBankAccountDto` | `→ CreateSupplierBankAccountUseCase.execute()` |

**`VendorBillController`** — `apps/api/src/modules/procurement/presentation/http/vendor-bill.controller.ts` · base path: `/v1/companies/:companyId/accounts-payable/vendor-bills` · 15 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 775 | GET | `/v1/companies/:companyId/accounts-payable/vendor-bills` | `list` (L30) | any(`procurement.vendor_bill.read` \| `procurement.vendor_bill.read_related`) | ไม่ขาย(procurement,procurement.vendor_bills) | ดูรายการ (ใบแจ้งหนี้ ผู้ขาย) | `Q:any` | `→ ListVendorBillsUseCase.execute()` |
| 776 | GET | `/v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | `getPolicy` (L38) | `procurement.approval_policy.read` | ไม่ขาย(procurement) | ดูข้อมูล นโยบาย (ใบแจ้งหนี้ ผู้ขาย) | — | `→ GetProcurementApprovalPolicyUseCase.execute()` |
| 777 | PUT | `/v1/companies/:companyId/accounts-payable/vendor-bills/approval-policy` | `updatePolicy` (L45) | `procurement.approval_policy.manage` | ไม่ขาย(procurement) | แก้ไข นโยบาย (ใบแจ้งหนี้ ผู้ขาย) | `B:UpdateApprovalPolicyDto` | `→ UpdateProcurementApprovalPolicyUseCase.execute()` |
| 778 | GET | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/pp36-posting-source` | `getPp36PostingSource` (L52) | `procurement.vendor_bill.read` | ไม่ขาย(procurement) | ดูข้อมูล แหล่งที่มา การลงบัญชี ภ.พ.36 | — | `→ GetVendorBillPp36PostingSourceUseCase.execute()` |
| 779 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills` | `create` (L59) | `procurement.vendor_bill.create` | ไม่ขาย(procurement) | สร้าง (ใบแจ้งหนี้ ผู้ขาย) | `B:CreateVendorBillDto` | `→ CreateVendorBillUseCase.execute()` |
| 780 | GET | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id` | `get` (L66) | any(`procurement.vendor_bill.read` \| `procurement.vendor_bill.read_related`) | ไม่ขาย(procurement,procurement.vendor_bills) | ดูข้อมูล (ใบแจ้งหนี้ ผู้ขาย) | — | `→ GetVendorBillUseCase.execute()` |
| 781 | PATCH | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence` | `updateEvidence` (L73) | `procurement.vendor_bill.create` | ไม่ขาย(procurement) | แก้ไข หลักฐาน (ใบแจ้งหนี้ ผู้ขาย) | `B:UpdateVendorBillTaxEvidenceDto` | `→ UpdateVendorBillTaxEvidenceUseCase.execute()` |
| 782 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/tax-evidence/review` | `reviewEvidence` (L80) | `procurement.vendor_bill.approve` | ไม่ขาย(procurement) | ตรวจทาน หลักฐาน (ใบแจ้งหนี้ ผู้ขาย) | `B:ReviewVendorBillTaxEvidenceDto` | `→ ReviewVendorBillTaxEvidenceUseCase.execute()` |
| 783 | GET | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/posting-source` | `getPostingSource` (L87) | `procurement.vendor_bill.read` | ไม่ขาย(procurement) | ดูข้อมูล แหล่งที่มา การลงบัญชี | — | `→ GetVendorBillPostingSourceUseCase.execute()` |
| 784 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/match` | `match` (L94) | `procurement.vendor_bill.match` | ไม่ขาย(procurement) | จับคู่ (ใบแจ้งหนี้ ผู้ขาย) | — | `→ MatchVendorBillUseCase.execute()` |
| 785 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/match/override` | `overrideMatchRoute` (L101) | `procurement.vendor_bill.match.override` | ไม่ขาย(procurement) | แทนที่ค่า (override) เส้นทาง การจับคู่ | `B:MatchOverrideDto` | `→ OverrideVendorBillMatchUseCase.execute()` |
| 786 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/submit` | `submit` (L108) | `procurement.vendor_bill.create` | ไม่ขาย(procurement) | ส่ง (ใบแจ้งหนี้ ผู้ขาย) | — | `→ SubmitVendorBillUseCase.execute()` |
| 787 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/approve` | `approve` (L115) | `procurement.vendor_bill.approve` | ไม่ขาย(procurement) | อนุมัติ (ใบแจ้งหนี้ ผู้ขาย) | `B:ApprovalNoteDto` | `→ ApproveVendorBillUseCase.execute()` |
| 788 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/reject` | `reject` (L122) | `procurement.vendor_bill.approve` | ไม่ขาย(procurement) | ปฏิเสธ (ใบแจ้งหนี้ ผู้ขาย) | `B:RequiredNoteDto` | `→ RejectVendorBillUseCase.execute()` |
| 789 | POST | `/v1/companies/:companyId/accounts-payable/vendor-bills/:id/void` | `void` (L129) | `procurement.vendor_bill.void` | ไม่ขาย(procurement) | ยกเลิก (void) (ใบแจ้งหนี้ ผู้ขาย) | `B:RequiredReasonDto` | `→ VoidVendorBillUseCase.execute()` |

### 2.22 โมดูล `public-home-theme` — 3 endpoint

**`PublicHomeThemeController`** — `apps/api/src/modules/public-home-theme/home-theme.controller.ts` · base path: `/v1/public/home-theme` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 790 | GET | `/v1/public/home-theme` | `get` (L19) | Public | แพลตฟอร์ม | ดูข้อมูล (ธีม หน้าแรก สาธารณะ) | — | `PublicHomeTheme` |

**`SystemHomeThemeController`** — `apps/api/src/modules/public-home-theme/home-theme.controller.ts` · base path: `/v1/system/home-theme` · สิทธิ์ระดับ class: `system.home_theme.manage` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 791 | GET | `/v1/system/home-theme` | `get` (L31) | `system.home_theme.manage` | แพลตฟอร์ม | ดูข้อมูล (ธีม หน้าแรก ระบบ) | — | `→ HomeThemeService.assertAdmin()` |
| 792 | PUT | `/v1/system/home-theme` | `set` (L38) | `system.home_theme.manage` | แพลตฟอร์ม | ตั้งค่า (ธีม หน้าแรก ระบบ) | `B:SetHomeThemeDto` | `→ HomeThemeService.set()` |

### 2.23 โมดูล `reimbursements` — 55 endpoint

**`ReimbursementPayoutController`** — `apps/api/src/modules/reimbursements/presentation/http/reimbursement-payout.controller.ts` · base path: `/v1/companies/:companyId/reimbursements` · guard: `ReimbursementWriteQuiesceGuard` · 14 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 793 | GET | `/v1/companies/:companyId/reimbursements/payout-accounts/me/saved` | `listSavedOwn` (L30) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | ดูรายการ ของตนเอง ที่บันทึกไว้ — _List my saved payout accounts (last 4 digits only)_ | — | `→ MemberPayoutAccountUseCase.listSavedOwn()` |
| 794 | POST | `/v1/companies/:companyId/reimbursements/payout-accounts/me/saved` | `addSavedOwn` (L37) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | เพิ่ม ของตนเอง ที่บันทึกไว้ — _Add my saved payout account_ | `B:AddSavedPayoutAccountDto` | `→ MemberPayoutAccountUseCase.addSavedOwn()` |
| 795 | DELETE | `/v1/companies/:companyId/reimbursements/payout-accounts/me/saved/:accountId` | `deleteSavedOwn` (L44) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | ลบ ของตนเอง ที่บันทึกไว้ — _Delete my saved payout account_ | — | `→ MemberPayoutAccountUseCase.deleteSavedOwn()` (204) |
| 796 | POST | `/v1/companies/:companyId/reimbursements/payout-accounts/me/saved/:accountId/reveal` | `revealSavedOwn` (L52) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | เปิดดูข้อมูลที่ปกปิด ของตนเอง ที่บันทึกไว้ — _Reveal my saved payout account number (audited)_ | — | `→ MemberPayoutAccountUseCase.revealSavedOwn()` (200) |
| 797 | POST | `/v1/companies/:companyId/reimbursements/payout-accounts/me/saved/:accountId/make-default` | `makeSavedDefaultOwn` (L60) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | สร้าง ของตนเอง ค่าเริ่มต้น ที่บันทึกไว้ — _Make my saved own account the default_ | — | `→ MemberPayoutAccountUseCase.makeSavedDefaultOwn()` (200) |
| 798 | GET | `/v1/companies/:companyId/reimbursements/payout-accounts/me` | `getOwn` (L68) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | ดูข้อมูล ของตนเอง (การจ่ายคืน การเบิกคืน) — _Get my default payout account (last 4 digits only)_ | — | `→ MemberPayoutAccountUseCase.getOwn()` |
| 799 | PUT | `/v1/companies/:companyId/reimbursements/payout-accounts/me` | `setOwn` (L75) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | ตั้งค่า ของตนเอง (การจ่ายคืน การเบิกคืน) — _Set my default payout account_ | `B:SetMemberPayoutAccountDto` | `→ MemberPayoutAccountUseCase.setOwn()` |
| 800 | DELETE | `/v1/companies/:companyId/reimbursements/payout-accounts/me` | `deleteOwn` (L82) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | ลบ ของตนเอง (การจ่ายคืน การเบิกคืน) — _Remove my default payout account_ | — | `→ MemberPayoutAccountUseCase.deleteOwn()` |
| 801 | POST | `/v1/companies/:companyId/reimbursements/payout-accounts/me/reveal` | `revealOwn` (L89) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | เปิดดูข้อมูลที่ปกปิด ของตนเอง (การจ่ายคืน การเบิกคืน) — _Show my own full account number (audited)_ | — | `→ MemberPayoutAccountUseCase.revealOwn()` (200) |
| 802 | GET | `/v1/companies/:companyId/reimbursements/payout-accounts/members/:userId` | `getForMember` (L97) | any(`access.employee.read` \| `access.employee.update`) | ทุกแพ็ก [employee_access] | ดูข้อมูล สำหรับ สมาชิก — _Get an employee default payout account (last 4 digits only)_ | — | `→ MemberPayoutAccountUseCase.getForMember()` |
| 803 | PUT | `/v1/companies/:companyId/reimbursements/payout-accounts/members/:userId` | `setForMember` (L104) | `access.employee.update` | ทุกแพ็ก [employee_access] | ตั้งค่า สำหรับ สมาชิก — _Set an employee default payout account (audited, the employee is notified)_ | `B:SetMemberPayoutAccountDto` | `→ MemberPayoutAccountUseCase.setForMember()` |
| 804 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payout-destination/reveal` | `revealForClaim` (L111) | `account.session.read` | ทุกแพ็ก | เปิดดูข้อมูลที่ปกปิด สำหรับ ใบเบิก/claim — _Show the full account number of a claim's own snapshot (audited)_ | — | `→ RevealClaimPayoutUseCase.execute()` (200) |
| 805 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payout-correction` | `requestPayoutCorrection` (L123) | `account.session.read` | ทุกแพ็ก | ร้องขอ การแก้ไข การจ่ายคืน — _Send an approved claim back to have its payout account corrected (same claim and number)_ | `B:RequestPayoutCorrectionDto` | `→ RequestPayoutCorrectionUseCase.execute()` (200) |
| 806 | PUT | `/v1/companies/:companyId/reimbursements/:requestId/payout-destination` | `submitPayoutCorrection` (L133) | any(`reimbursement.update_own_draft` \| `reimbursement.finance_review`) | ทุกแพ็ก [reimbursement] | ส่ง การแก้ไข การจ่ายคืน — _Give the payout account of a claim sent back for correction (its requester, or finance review on their behalf)_ | `B:SubmitPayoutCorrectionDto` | `→ SubmitPayoutCorrectionUseCase.execute()` |

**`ReimbursementPolicyController`** — `apps/api/src/modules/reimbursements/presentation/http/reimbursement-policy.controller.ts` · base path: `/v1/companies/:companyId/reimbursement-policy` · guard: `ReimbursementWriteQuiesceGuard` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 807 | GET | `/v1/companies/:companyId/reimbursement-policy/approver-options` | `approverOptions` (L20) | `reimbursement.policy.manage` | ทุกแพ็ก [reimbursement] | ดู ตัวเลือก ผู้อนุมัติ — _List roles ready to approve reimbursements_ | — | `→ ListReimbursementApproverOptionsUseCase.execute()` |
| 808 | GET | `/v1/companies/:companyId/reimbursement-policy` | `get` (L27) | any(`reimbursement.policy.read` \| `reimbursement.policy.manage`) | ทุกแพ็ก [reimbursement] | ดูข้อมูล (นโยบาย การเบิกคืน) — _Get reimbursement policy settings_ | — | `→ GetReimbursementPolicyUseCase.execute()` |
| 809 | PUT | `/v1/companies/:companyId/reimbursement-policy` | `update` (L34) | `reimbursement.policy.manage` | ทุกแพ็ก [reimbursement] | แก้ไข (นโยบาย การเบิกคืน) — _Update reimbursement policy settings_ | `B:UpdateReimbursementPolicyDto` | `→ UpdateReimbursementPolicyUseCase.execute()` |

**`ReimbursementReconcileInternalController`** — `apps/api/src/modules/reimbursements/presentation/http/reimbursement-reconcile-internal.controller.ts` · base path: `/v1/internal/reimbursements` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 810 | POST | `/v1/internal/reimbursements/reconcile` | `execute` (L23) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ (ภายใน การกระทบยอด การเบิกคืน) | — | `→ ReimbursementProjectionReconcilerService.execute()` (200) |

**`ReimbursementController`** — `apps/api/src/modules/reimbursements/presentation/http/reimbursement.controller.ts` · base path: `/v1/companies/:companyId/reimbursements` · guard: `ReimbursementWriteQuiesceGuard` · 37 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 811 | GET | `/v1/companies/:companyId/reimbursements/hub` | `hub` (L128) | `account.session.read` | ทุกแพ็ก | ดู ศูนย์รวม (การเบิกคืน) | — | `ReimbursementHubBootstrap` |
| 812 | GET | `/v1/companies/:companyId/reimbursements/approval-queue` | `listApprovalQueue` (L150) | `account.session.read` | ทุกแพ็ก | ดูรายการ คิว การอนุมัติ — _List reimbursement approval queue (current permission or frozen assignment)_ | — | `→ ListApprovalQueueUseCase.execute()` |
| 813 | GET | `/v1/companies/:companyId/reimbursements/finance-queue` | `listFinanceQueue` (L159) | any(`reimbursement.finance_review` \| `reimbursement.payment.record`) | ทุกแพ็ก | ดูรายการ คิว การเงิน — _List reimbursement finance queue_ | — | `→ ListFinanceQueueUseCase.execute()` |
| 814 | GET | `/v1/companies/:companyId/reimbursements/posting/pending` | `listUnpostedPayments` (L166) | `reimbursement.finance_review` | ทุกแพ็ก | ดูรายการ การจ่ายเงิน ที่ยังไม่ลงบัญชี — _List recorded reimbursement payments awaiting posting_ | — | `→ ListUnpostedReimbursementPaymentsUseCase.execute()` |
| 815 | GET | `/v1/companies/:companyId/reimbursements/summary` | `summary` (L173) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ดู สรุป (การเบิกคืน) — _Read-only reimbursement summary for AI/LINE_ | — | `→ GetReimbursementAiSummaryUseCase.execute()` |
| 816 | GET | `/v1/companies/:companyId/reimbursements/source-options` | `sourceOptions` (L180) | any(`reimbursement.create` \| `reimbursement.update_own_draft` \| `reimbursement.finance_review`) | ทุกแพ็ก [reimbursement] | ดู ตัวเลือก แหล่งที่มา | `Q{branchId,requesterUserId,search,expenseId}` | `→ ListReimbursementSourcesUseCase.execute()` |
| 817 | GET | `/v1/companies/:companyId/reimbursements/draft-actions/:actionId` | `getDraftAction` (L186) | `account.session.read` | ทุกแพ็ก | ดูข้อมูล การดำเนินการ ร่าง — _Render the exact current LINE reimbursement draft preview_ | — | `→ LineReimbursementDraftUseCase.getForWeb()` |
| 818 | POST | `/v1/companies/:companyId/reimbursements/draft-actions/:actionId/confirm` | `confirmDraftAction` (L193) | `account.session.read` | ทุกแพ็ก | ยืนยัน การดำเนินการ ร่าง — _Confirm the exact rendered LINE reimbursement draft preview_ | `B:ReimbursementDraftActionControlDto` | `→ LineReimbursementDraftUseCase.confirmForWeb()` (200) |
| 819 | POST | `/v1/companies/:companyId/reimbursements/draft-actions/:actionId/cancel` | `cancelDraftAction` (L201) | `account.session.read` | ทุกแพ็ก | ยกเลิก การดำเนินการ ร่าง — _Cancel the exact LINE reimbursement draft preview without cancelling a reimbursement_ | `B:ReimbursementDraftActionControlDto` | `→ LineReimbursementDraftUseCase.cancelForWeb()` (200) |
| 820 | GET | `/v1/companies/:companyId/reimbursements` | `list` (L211) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ดูรายการ (การเบิกคืน) — _List reimbursement requests_ | `Q{scope,status,paymentStatus,requesterUserId,page,pageSize,bucket,search,order}` | `→ ListReimbursementsUseCase.execute()` |
| 821 | POST | `/v1/companies/:companyId/reimbursements` | `create` (L236) | `reimbursement.create` | ทุกแพ็ก [reimbursement] | สร้าง (การเบิกคืน) — _Create reimbursement draft_ | `B:CreateReimbursementRequestDto` `H:idempotency-key` | `→ CreateReimbursementDraftUseCase.execute()` |
| 822 | GET | `/v1/companies/:companyId/reimbursements/:requestId` | `get` (L243) | `account.session.read` | ทุกแพ็ก | ดูข้อมูล (การเบิกคืน) — _Get reimbursement detail (read permission or exact frozen approval assignment)_ | — | `→ GetReimbursementDetailUseCase.execute()` |
| 823 | POST | `/v1/companies/:companyId/reimbursements/:requestId/internal-notes` | `addInternalNote` (L250) | `account.session.read` | ทุกแพ็ก | เพิ่ม บันทึกช่วยจำ ภายใน — _Add a company-internal reimbursement note_ | `B:ReimbursementInternalNoteDto` | `→ ReimbursementInternalNotesUseCase.create()` |
| 824 | PATCH | `/v1/companies/:companyId/reimbursements/:requestId/internal-notes/:noteId` | `editInternalNote` (L257) | `account.session.read` | ทุกแพ็ก | แก้ไข บันทึกช่วยจำ ภายใน — _Edit a company-internal reimbursement note_ | `B:ReimbursementInternalNoteDto` | `→ ReimbursementInternalNotesUseCase.update()` (204) |
| 825 | DELETE | `/v1/companies/:companyId/reimbursements/:requestId/internal-notes/:noteId` | `deleteInternalNote` (L266) | `account.session.read` | ทุกแพ็ก | ลบ บันทึกช่วยจำ ภายใน — _Delete a company-internal reimbursement note_ | — | `→ ReimbursementInternalNotesUseCase.delete()` (204) |
| 826 | PATCH | `/v1/companies/:companyId/reimbursements/:requestId` | `update` (L274) | any(`reimbursement.update_own_draft` \| `reimbursement.finance_review`) | ทุกแพ็ก [reimbursement] | แก้ไข (การเบิกคืน) — _Update reimbursement draft_ | `B:UpdateReimbursementDraftDto` | `→ UpdateReimbursementDraftUseCase.execute()` |
| 827 | POST | `/v1/companies/:companyId/reimbursements/:requestId/submit` | `submitRequest` (L281) | `reimbursement.submit` | ทุกแพ็ก [reimbursement] | ส่ง คำขอ (การเบิกคืน) — _Submit reimbursement for approval_ | `B:SubmitReimbursementDto` | `→ SubmitReimbursementUseCase.execute()` (200) |
| 828 | POST | `/v1/companies/:companyId/reimbursements/:requestId/reopen` | `reopenRequest` (L289) | `reimbursement.update_own_draft` | ทุกแพ็ก [reimbursement] | เปิดใหม่ คำขอ (การเบิกคืน) — _Reopen a rejected reimbursement, or withdraw one nobody has decided yet, as a draft for correction and resubmission_ | — | `→ ReopenRejectedReimbursementUseCase.execute()` (200) |
| 829 | DELETE | `/v1/companies/:companyId/reimbursements/:requestId` | `deleteDraft` (L297) | `account.session.read` | ทุกแพ็ก | ลบ ร่าง (การเบิกคืน) | — | `→ CancelReimbursementUseCase.deleteDraft()` (204) |
| 830 | POST | `/v1/companies/:companyId/reimbursements/:requestId/cancel` | `cancelRequest` (L304) | any(`reimbursement.cancel_own` \| `reimbursement.finance_review`) | ทุกแพ็ก [reimbursement] | ยกเลิก คำขอ (การเบิกคืน) — _Cancel reimbursement request, or continue a cancellation that was started and has not completed_ | `B:CancelReimbursementDto` | `→ CancelReimbursementUseCase.execute()` (200) |
| 831 | POST | `/v1/companies/:companyId/reimbursements/:requestId/cancel/withdraw` | `withdrawCancellation` (L312) | any(`reimbursement.cancel_own` \| `reimbursement.finance_review`) | ทุกแพ็ก [reimbursement] | ถอนคำขอ การยกเลิก (การเบิกคืน) — _Take back a cancellation that was started and has not completed, while nothing of the claim has been voided_ | — | `→ WithdrawReimbursementCancellationUseCase.execute()` (200) |
| 832 | POST | `/v1/companies/:companyId/reimbursements/:requestId/approve` | `approveRequest` (L322) | `account.session.read` | ทุกแพ็ก | อนุมัติ คำขอ (การเบิกคืน) — _Approve reimbursement request (current permission or frozen assignment)_ | `B:ApproveReimbursementDto` | `→ ApproveReimbursementUseCase.execute()` (200) |
| 833 | POST | `/v1/companies/:companyId/reimbursements/:requestId/reject` | `rejectRequest` (L330) | `account.session.read` | ทุกแพ็ก | ปฏิเสธ คำขอ (การเบิกคืน) — _Reject reimbursement request (current permission or frozen assignment)_ | `B:RejectReimbursementDto` | `→ RejectReimbursementUseCase.execute()` (200) |
| 834 | POST | `/v1/companies/:companyId/reimbursements/:requestId/resume` | `resumeRequest` (L338) | `account.session.read` | ทุกแพ็ก | ทำต่อ คำขอ (การเบิกคืน) — _Carry out now the decision the claim already holds (its approver, or whoever may record the payment of a claim nobody had to approve)_ | — | `→ ResumeReimbursementUseCase.execute()` (200) |
| 835 | POST | `/v1/companies/:companyId/reimbursements/:requestId/finance-review` | `reviewRequest` (L348) | any(`reimbursement.finance_review` \| `reimbursement.duplicate.resolve` \| `reimbursement.payment.record`) | ทุกแพ็ก | ตรวจทาน คำขอ (การเบิกคืน) — _Finance review reimbursement request, or clear its duplicate block at the payment step_ | `B:FinanceReviewReimbursementInput` | `→ FinanceReviewReimbursementUseCase.execute()` (200) |
| 836 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payments` | `createPayment` (L358) | `reimbursement.payment.record` | ทุกแพ็ก | สร้าง การจ่ายเงิน (การเบิกคืน) — _Record reimbursement payment_ | `B:RecordReimbursementPaymentDto` | `→ RecordReimbursementPaymentUseCase.execute()` |
| 837 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/void` | `voidRequestPayment` (L365) | `reimbursement.payment.void` | ทุกแพ็ก | ยกเลิก (void) การจ่ายเงิน คำขอ — _Void reimbursement payment_ | `B:VoidReimbursementPaymentDto` | `→ VoidReimbursementPaymentUseCase.execute()` (200) |
| 838 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payments/slip-upload-intent` | `initPaymentSlip` (L383) | `reimbursement.payment.record` | ทุกแพ็ก | เริ่มอัปโหลด (ขอ URL) สลิป การจ่ายเงิน — _Start a payment slip upload for this claim_ | `B:InitPaymentSlipUploadDto` | `→ InitPaymentSlipUploadUseCase.execute()` |
| 839 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payments/slip-uploads/:attachmentId/complete` | `completePaymentSlip` (L390) | `reimbursement.payment.record` | ทุกแพ็ก | ยืนยันเสร็จสิ้น สลิป การจ่ายเงิน — _Complete a payment slip upload_ | `B:CompletePaymentSlipUploadDto` | `→ CompletePaymentSlipUploadUseCase.execute()` (200) |
| 840 | POST | `/v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/slips` | `attachPaymentSlip` (L403) | `reimbursement.payment.record` | ทุกแพ็ก | แนบ สลิป การจ่ายเงิน — _Attach a slip to a recorded payment, or move a misfiled signed copy to be its slip_ | `B:AttachPaymentSlipDto` | `→ AttachPaymentSlipUseCase.execute()` (200) |
| 841 | GET | `/v1/companies/:companyId/reimbursements/:requestId/payments/:paymentId/slips/:attachmentId/download-url` | `paymentSlipDownloadUrl` (L417) | `account.session.read` | ทุกแพ็ก | ดู URL ดาวน์โหลด สลิป การจ่ายเงิน — _Open a payment slip (requester, the claim approver, payment-record or finance-review holders)_ | `Q{disposition}` | `→ CreatePaymentSlipDownloadUrlUseCase.execute()` |
| 842 | GET | `/v1/companies/:companyId/reimbursements/:requestId/export` | `export` (L430) | `reimbursement.export` | ทุกแพ็ก [reimbursement] | ส่งออก (การเบิกคืน) — _Export reimbursement evidence (bounded JSON)_ | — | `→ ExportReimbursementEvidenceUseCase.execute()` |
| 843 | POST | `/v1/companies/:companyId/reimbursements/:requestId/claim-form/preview` | `previewClaimForm` (L439) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ดูตัวอย่าง แบบฟอร์ม ใบเบิก/claim — _Render the printable ใบเบิกค่าใช้จ่าย for this claim_ | — | `→ PreviewReimbursementClaimFormUseCase.execute()` (200) |
| 844 | POST | `/v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-upload-intent` | `initClaimSignature` (L452) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | เริ่มอัปโหลด (ขอ URL) ลายเซ็น ใบเบิก/claim — _Start a claim-form signature image upload_ | `B:InitClaimSignatureUploadDto` | `→ InitClaimSignatureUploadUseCase.execute()` |
| 845 | POST | `/v1/companies/:companyId/reimbursements/:requestId/claim-form/signature-uploads/:attachmentId/complete` | `completeClaimSignature` (L459) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ยืนยันเสร็จสิ้น ลายเซ็น ใบเบิก/claim — _Complete a claim-form signature image upload_ | `B:CompleteClaimSignatureUploadDto` | `→ CompleteClaimSignatureUploadUseCase.execute()` |
| 846 | POST | `/v1/companies/:companyId/reimbursements/:requestId/claim-form/signatures` | `signClaimForm` (L471) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ลงนาม แบบฟอร์ม ใบเบิก/claim — _Sign the claim form for one role_ | `B:SignReimbursementClaimFormDto` | `→ SignClaimFormUseCase.execute()` (200) |
| 847 | POST | `/v1/companies/:companyId/reimbursements/:requestId/claim-form/signed-copies` | `linkSignedCopy` (L479) | any(`reimbursement.read` \| `reimbursement.read_related` \| `reimbursement.read_own`) | ทุกแพ็ก | ผูก สำเนา ที่ลงนามแล้ว — _Attach a scan of the wet-ink signed claim form_ | `B:LinkReimbursementSignedCopyDto` | `→ LinkSignedClaimFormCopyUseCase.execute()` (200) |

### 2.24 โมดูล `reports` — 12 endpoint

**`ReportController`** — `apps/api/src/modules/reports/presentation/http/report.controller.ts` · base path: `/v1/companies/:companyId/reports` · 12 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 848 | GET | `/v1/companies/:companyId/reports/catalog` | `catalogHandler` (L41) | `report.catalog.read` | ไม่ขาย(reports) | ดู แค็ตตาล็อก (รายงาน) — _List report catalog_ | — | `→ ListReportCatalogUseCase.execute()` |
| 849 | POST | `/v1/companies/:companyId/reports/query` | `queryHandler` (L48) | `report.catalog.read` + `report.dataset.read` + `report.query.run` | ไม่ขาย(reports) | สืบค้น (รายงาน) — _Run a report query_ | `B:ReportQueryInput` | `→ RunReportQueryUseCase.execute()` (200) |
| 850 | GET | `/v1/companies/:companyId/reports/runs/:runId` | `runHandler` (L57) | `report.snapshot.read` | ทุกแพ็ก | รัน (รายงาน) — _Get report run metadata_ | — | `→ GetReportRunUseCase.execute()` |
| 851 | GET | `/v1/companies/:companyId/reports/runs` | `runsHandler` (L64) | `report.snapshot.read` | ทุกแพ็ก | ดู รอบการทำงาน (รายงาน) — _List permission-filtered report run history_ | `Q{cursor,pageSize}` | `→ ListReportRunsUseCase.execute()` |
| 852 | POST | `/v1/companies/:companyId/reports/drilldown` | `drilldownHandler` (L80) | `report.catalog.read` + `report.dataset.read` + `report.query.run` | ไม่ขาย(reports) | ดำเนินการ เจาะลึก (รายงาน) — _Resolve a permission-checked source drilldown link_ | `B:ReportDrilldownInput` | `→ ReportDrilldownUseCase.execute()` (200) |
| 853 | GET | `/v1/companies/:companyId/reports/views` | `viewsHandler` (L88) | `report.view.read` | ทุกแพ็ก | ดู มุมมอง (รายงาน) — _List own/shared report saved views_ | — | `→ ListReportViewsUseCase.execute()` |
| 854 | POST | `/v1/companies/:companyId/reports/views` | `createViewHandler` (L95) | `report.view.create` | ไม่ขาย(reports) | สร้าง มุมมอง (รายงาน) — _Create report saved view_ | `B:CreateReportViewInput` | `→ CreateReportViewUseCase.execute()` |
| 855 | PATCH | `/v1/companies/:companyId/reports/views/:viewId` | `updateViewHandler` (L102) | `report.view.update_own` | ไม่ขาย(reports) | แก้ไข มุมมอง (รายงาน) — _Update report saved view_ | `B:UpdateReportViewInput` | `→ UpdateReportViewUseCase.execute()` |
| 856 | POST | `/v1/companies/:companyId/reports/views/:viewId/archive` | `archiveViewHandler` (L109) | `report.view.update_own` | ไม่ขาย(reports) | เก็บเข้าคลัง (archive) มุมมอง (รายงาน) — _Archive report saved view_ | — | `→ ArchiveReportViewUseCase.execute()` (200) |
| 857 | GET | `/v1/companies/:companyId/reports/exports` | `exportsHandler` (L117) | any(`report.export.read_own` \| `report.export.manage`) | ทุกแพ็ก | ดู ไฟล์ส่งออก (รายงาน) — _List recent report exports_ | — | `→ ListReportExportsUseCase.execute()` |
| 858 | POST | `/v1/companies/:companyId/reports/exports` | `exportHandler` (L124) | `report.export` | ไม่ขาย(reports) | ส่งออก (รายงาน) — _Request report export_ | `B:CreateReportExportInput` | `→ CreateReportExportUseCase.execute()` |
| 859 | GET | `/v1/companies/:companyId/reports/exports/:exportId/download` | `downloadHandler` (L131) | any(`report.export.read_own` \| `report.export.manage`) | ทุกแพ็ก | ดาวน์โหลด (รายงาน) — _Download report export content_ | `Q{format}` | `→ DownloadReportExportUseCase.execute()` |

### 2.25 โมดูล `sales-console` — 42 endpoint

**`PublicEventDiscountsController`** — `apps/api/src/modules/sales-console/presentation/http/public-event-discounts.controller.ts` · base path: `/v1/public/event-discounts` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 860 | POST | `/v1/public/event-discounts/claim` | `claim` (L29) | Public — LINE ID token (ตรวจใน use case) | แพลตฟอร์ม | รับสิทธิ์/จอง (ส่วนลด เหตุการณ์ สาธารณะ) — _Claim a sales-event discount with a LIFF ID token and a booth QR token_ | `B:SalesEventClaimDto` | `SalesEventClaimResult` (200) |

**`SalesEventReportsController`** — `apps/api/src/modules/sales-console/presentation/http/sales-event-reports.controller.ts` · base path: `/v1/sales/events/report` · guard: `SalesAgentActiveGuard` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 861 | GET | `/v1/sales/events/report` | `report` (L22) | `sales.report.read` | แพลตฟอร์ม | ดู รายงาน (รายงาน เหตุการณ์ งานขาย) — _Event discounts per event, batch and agent — separate from sales credit (SD-Q3)_ | `Q{from,to,teamLeadUserId,salesUserId}` | `SalesEventReport` |

**`SalesEventsController`** — `apps/api/src/modules/sales-console/presentation/http/sales-events.controller.ts` · base path: `/v1/sales/events` · guard: `SalesAgentActiveGuard` · 9 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 862 | POST | `/v1/sales/events/batches` | `create` (L35) | `sales.event.manage` | แพลตฟอร์ม | สร้าง (เหตุการณ์ งานขาย) — _Create a batch and open it at once (no server-side draft)_ | `B:SalesEventBatchDto` | `SalesEventBatchView` (201) |
| 863 | GET | `/v1/sales/events/batches` | `list` (L45) | `sales.console.read` | แพลตฟอร์ม | ดูรายการ (เหตุการณ์ งานขาย) — _Batches the caller may see: all (admin), own and team (lead), assigned (agent)_ | `Q{cursor}` | `SalesEventBatchList` |
| 864 | GET | `/v1/sales/events/batches/:batchId` | `get` (L53) | `sales.console.read` | แพลตฟอร์ม | ดูข้อมูล (เหตุการณ์ งานขาย) — _One batch with its ticket figures_ | — | `SalesEventBatchView` |
| 865 | PATCH | `/v1/sales/events/batches/:batchId` | `update` (L62) | `sales.event.manage` | แพลตฟอร์ม | แก้ไข (เหตุการณ์ งานขาย) — _Save a new revision; tickets already issued keep what they were issued with_ | `B:SalesEventBatchUpdateDto` | `SalesEventBatchView` |
| 866 | POST | `/v1/sales/events/batches/:batchId/state` | `changeState` (L71) | `sales.event.manage` | แพลตฟอร์ม | เปลี่ยน สถานะ (เหตุการณ์ งานขาย) — _PAUSE / RESUME / SUSPEND / LIFT; SUSPEND and LIFT need a reason_ | `B:SalesEventBatchStateDto` | `SalesEventBatchView` (200) |
| 867 | GET | `/v1/sales/events/agents` | `searchAgents` (L81) | `sales.event.manage` | แพลตฟอร์ม | ค้นหา เซลล์ (เหตุการณ์ งานขาย) — _Sellers a batch may be handed to: own team (lead) or everyone (admin), 50 a page_ | `Q{q,cursor}` | `SalesEventAgentSearch` |
| 868 | POST | `/v1/sales/events/batches/:batchId/qr` | `issueQr` (L91) | `sales.console.read` | แพลตฟอร์ม | ออกเอกสาร QR (เหตุการณ์ งานขาย) — _A QR for an active distributor of an open batch; it works until the batch closes (SD-O11)_ | — | `SalesEventQr` (200) |
| 869 | GET | `/v1/sales/events/batches/:batchId/tickets` | `tickets` (L102) | `sales.console.read` | แพลตฟอร์ม | ดู ตั๋ว (เหตุการณ์ งานขาย) — _Tickets of a batch, newest first; an agent sees only the ones they handed out_ | `Q{cursor}` | `SalesEventTicketList` |
| 870 | POST | `/v1/sales/events/tickets/:ticketId/revoke` | `revoke` (L112) | `sales.event.manage` | แพลตฟอร์ม | เพิกถอน (เหตุการณ์ งานขาย) — _Revoke an unused ticket, with a reason_ | `B:SalesEventTicketRevokeDto` | `SalesEventTicketView` (200) |

**`SalesInternalController`** — `apps/api/src/modules/sales-console/presentation/http/sales-internal.controller.ts` · base path: `/v1/internal/sales` · `@Public()` ระดับ class · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 871 | POST | `/v1/internal/sales/deals/expire-sweep` | `expireSweep` (L20) | Public — `X-Worker-Token` | แพลตฟอร์ม | ทำให้หมดอายุ การกวาดตรวจ (ภายใน งานขาย) — _Close APPROVED deals past their 3-day window (idempotent)_ | — | `Promise<` |
| 872 | POST | `/v1/internal/sales/deals/renewal-sweep` | `renewalSweep` (L28) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ การกวาดตรวจ การต่ออายุ — _D3: write the next round as PENDING_APPROVAL 14 days out, chase it at 7_ | — | `SalesRenewalSweepResult` |
| 873 | POST | `/v1/internal/sales/daily-digest` | `dailyDigest` (L36) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ สรุปประจำวัน รายวัน — _§17.2: yesterday in one SYSTEM_ADMIN console notice (07:00 Bangkok)_ | — | `Promise<` |

**`SalesController`** — `apps/api/src/modules/sales-console/presentation/http/sales.controller.ts` · base path: `/v1/sales` · guard: `SalesAgentActiveGuard` · 18 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 874 | GET | `/v1/sales/companies` | `searchCompanies` (L104) | `sales.company.search` | แพลตฟอร์ม | ค้นหา บริษัท (งานขาย) — _Search shops by name — name, package state, province only (R11/Q4)_ | `Q{q}` | `SalesCompanySearchDto` |
| 875 | GET | `/v1/sales/deals` | `listDeals` (L116) | `sales.console.read` | แพลตฟอร์ม | ดูรายการ ดีลขาย (งานขาย) — _Deals — own only for an agent, every team for a lead; ?status= and ?salesUserId= narrow_ | `Q{status,salesUserId}` | `SalesDealListDto` |
| 876 | GET | `/v1/sales/my-work` | `myWork` (L129) | `sales.console.read` | แพลตฟอร์ม | ดู งาน ของฉัน — _Derived work list and badge count (Q6/S30)_ | — | `SalesMyWorkDto` |
| 877 | GET | `/v1/sales/reports/summary` | `reportSummary` (L142) | `sales.report.read` | แพลตฟอร์ม | ดู สรุป รายงาน — _Per-agent per-month activations and amount (no financial documents, S21)_ | `Q{from,to,teamLeadUserId,salesUserId}` | `SalesReportSummary` |
| 878 | GET | `/v1/sales/deals/:dealId` | `getDeal` (L157) | `sales.console.read` | แพลตฟอร์ม | ดูข้อมูล ดีลขาย (งานขาย) — _One deal with its company preview and over-limit counts (S31)_ | — | `SalesDealView` |
| 879 | POST | `/v1/sales/deals` | `createDeal` (L168) | `sales.deal.create` | แพลตฟอร์ม | สร้าง ดีลขาย (งานขาย) — _Create a DRAFT deal_ | `B:SalesDealSaveDto` | `SalesDealView` (201) |
| 880 | PUT | `/v1/sales/deals/:dealId` | `updateDeal` (L181) | `sales.deal.create` | แพลตฟอร์ม | แก้ไข ดีลขาย (งานขาย) — _Edit a DRAFT or REJECTED deal; an APPROVED one is immutable (R4)_ | `B:SalesDealSaveDto` | `SalesDealView` |
| 881 | POST | `/v1/sales/deals/:dealId/submit` | `submitDeal` (L193) | `sales.deal.create` | แพลตฟอร์ม | ส่ง ดีลขาย (งานขาย) — _Send a deal for approval_ | `B:SalesDealSubmitDto` | `SalesDealView` (200) |
| 882 | POST | `/v1/sales/deals/:dealId/approve` | `approveDeal` (L206) | `sales.deal.approve` | แพลตฟอร์ม | อนุมัติ ดีลขาย (งานขาย) — _Approve: sets offerExpiresAt and pushes the shop owners a numberless notice_ | `B:SalesDealApproveDto` | `SalesDealView` (200) |
| 883 | POST | `/v1/sales/deals/:dealId/reject` | `rejectDeal` (L220) | `sales.deal.approve` | แพลตฟอร์ม | ปฏิเสธ ดีลขาย (งานขาย) — _Reject with a reason the agent reads; nothing reaches the customer_ | `B:SalesDealDecisionDto` | `SalesDealView` (200) |
| 884 | POST | `/v1/sales/deals/:dealId/end` | `endDeal` (L233) | `sales.deal.approve` | แพลตฟอร์ม | สิ้นสุด ดีลขาย (งานขาย) — _D-P5-6 "จบดีล": record the cycle end an auto-renewing deal stops at_ | `B:SalesDealDecisionDto` | `SalesDealView` (200) |
| 885 | POST | `/v1/sales/deals/:dealId/cancel` | `cancelDeal` (L247) | `sales.deal.create` | แพลตฟอร์ม | ยกเลิก ดีลขาย (งานขาย) — _Cancel before payment (agent or lead)_ | `B:SalesDealDecisionDto` | `SalesDealView` (200) |
| 886 | GET | `/v1/sales/me/profile` | `myProfile` (L263) | `sales.console.read` | แพลตฟอร์ม | ดู โปรไฟล์ ของฉัน — _Read own tax and bank profile; audited_ | — | `SalesAgentProfileDto` |
| 887 | PATCH | `/v1/sales/me/profile` | `updateMyProfile` (L271) | `sales.console.read` | แพลตฟอร์ม | แก้ไข โปรไฟล์ ของฉัน — _Update own identity, address and bank details; withholding rate remains admin-owned_ | `B:SalesSelfProfileDto` | `SalesAgentProfileDto` |
| 888 | GET | `/v1/sales/team` | `listTeam` (L282) | `sales.team.manage` | แพลตฟอร์ม | ดูรายการ ทีม (งานขาย) — _Agents in the caller own team_ | — | `SalesAgentListDto` |
| 889 | POST | `/v1/sales/team` | `createTeamMember` (L290) | `sales.team.manage` | แพลตฟอร์ม | สร้าง สมาชิก ทีม — _Create an agent in own team; the temporary password is returned once_ | `B:SalesTeamCreateDto` | `SalesAgentCreateResult` (201) |
| 890 | GET | `/v1/sales/team/:userId/profile` | `teamProfile` (L302) | `sales.team.manage` | แพลตฟอร์ม | ดู โปรไฟล์ ทีม — _Read a profile in the caller own team; audited_ | — | `SalesAgentProfileDto` |
| 891 | POST | `/v1/sales/team/:userId/credential` | `resetTeamCredential` (L313) | `sales.team.manage` | แพลตฟอร์ม | รีเซ็ต ข้อมูลรับรอง ทีม — _Reset an own-team agent password; shown once, pushed if LINE-linked_ | — | `SalesAgentCredentialHandoff` (200) |

**`SystemSalesAgentsController`** — `apps/api/src/modules/sales-console/presentation/http/system-sales-agents.controller.ts` · base path: `/v1/system/sales-agents` · guard: `SalesAgentActiveGuard` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 892 | GET | `/v1/system/sales-agents/address-master` | `addresses` (L76) | any(`sales.agent_profile.manage` \| `sales.team.manage`) | แพลตฟอร์ม | ดู ที่อยู่ (เซลล์ งานขาย ระบบ) — _Thai address options for the sales payroll profile_ | `Q{postalCode}` | `→ ListThaiAddressesUseCase.execute()` |
| 893 | GET | `/v1/system/sales-agents` | `list` (L84) | `sales.agent_profile.manage` | แพลตฟอร์ม | ดูรายการ (เซลล์ งานขาย ระบบ) — _Every sales agent and lead (no PII fields in the list)_ | — | `SalesAgentListDto` |
| 894 | POST | `/v1/system/sales-agents` | `create` (L92) | `sales.agent_profile.manage` | แพลตฟอร์ม | สร้าง (เซลล์ งานขาย ระบบ) — _Create an agent or lead, optionally with the payroll record_ | `B:SystemSalesAgentCreateDto` | `SalesAgentCreateResult` (201) |
| 895 | GET | `/v1/system/sales-agents/export.csv` | `exportCsv` (L109) | `sales.agent_profile.manage` | แพลตฟอร์ม | ส่งออก CSV (เซลล์ งานขาย ระบบ) — _Payroll export with decrypted PII — SYSTEM_ADMIN only, audited HIGH_ | — | `string` |
| 896 | PATCH | `/v1/system/sales-agents/:userId` | `update` (L119) | `sales.agent_profile.manage` | แพลตฟอร์ม | แก้ไข (เซลล์ งานขาย ระบบ) — _Update an agent; a status change requires a reason_ | `B:SystemSalesAgentUpdateDto` | `SalesAgentView` |
| 897 | GET | `/v1/system/sales-agents/:userId/profile` | `profile` (L131) | `sales.agent_profile.manage` | แพลตฟอร์ม | ดู โปรไฟล์ (เซลล์ งานขาย ระบบ) — _Decrypted tax and bank record; every read audited MEDIUM (S10)_ | — | `SalesAgentProfileDto` |
| 898 | POST | `/v1/system/sales-agents/:userId/credential` | `credential` (L142) | `sales.agent_profile.manage` | แพลตฟอร์ม | ดำเนินการ ข้อมูลรับรอง (เซลล์ งานขาย ระบบ) — _Issue a fresh temporary password; shown once, pushed if LINE-linked_ | — | `SalesAgentCredentialHandoff` (200) |

**`SystemSalesReferralController`** — `apps/api/src/modules/sales-console/presentation/http/system-sales-agents.controller.ts` · base path: `/v1/system/partners` · guard: `SalesAgentActiveGuard` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 899 | PATCH | `/v1/system/partners/:partnerCompanyId/referral` | `setReferral` (L166) | `sales.agent_profile.manage` | แพลตฟอร์ม | ตั้งค่า การแนะนำ (งานขาย ระบบ) — _Set or clear a shop referring agent, within 30 days, with a reason_ | `B:SalesReferralUpdateDto` | `Promise<` |

**`SystemSalesAttributionController`** — `apps/api/src/modules/sales-console/presentation/http/system-sales-agents.controller.ts` · base path: `/v1/system/sales-attribution` · guard: `SalesAgentActiveGuard` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 900 | GET | `/v1/system/sales-attribution/flags` | `flags` (L196) | `sales.agent_profile.manage` | แพลตฟอร์ม | ดู ธง (attribution งานขาย ระบบ) — _Attribution rows carrying an anti-gaming flag, unreviewed first_ | — | `SalesAttributionFlagListDto` |
| 901 | POST | `/v1/system/sales-attribution/:partnerCompanyId/review` | `review` (L204) | `sales.agent_profile.manage` | แพลตฟอร์ม | ตรวจทาน (attribution งานขาย ระบบ) — _Keep or clear a flag, with a reason; audited HIGH_ | `B:SalesAttributionFlagReviewDto` | `SalesAttributionFlagListDto` (200) |

### 2.26 โมดูล `sales-demo` — 9 endpoint

**`DemoChatController`** — `apps/api/src/modules/sales-demo/presentation/demo-chat.controller.ts` · base path: `/v1/companies/:companyId/demo-chat` · สิทธิ์ระดับ class: `account.session.read` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 902 | POST | `/v1/companies/:companyId/demo-chat/messages` | `message` (L23) | `account.session.read` | ทุกแพ็ก | ดำเนินการ ข้อความ (แชต เดโม) | `B:DemoChatMessageDto` | `→ DemoChatService.message()` (202) |
| 903 | POST | `/v1/companies/:companyId/demo-chat/files` | `file` (L28) | `account.session.read` | ทุกแพ็ก | ดำเนินการ ไฟล์ (แชต เดโม) | — | `→ DemoChatService.file()` (202) |
| 904 | GET | `/v1/companies/:companyId/demo-chat/messages` | `messages` (L34) | `account.session.read` | ทุกแพ็ก | ดู ข้อความ (แชต เดโม) | `Q{after}` | `→ DemoChatService.messages()` |

**`SalesDemoLinksController`** — `apps/api/src/modules/sales-demo/presentation/sales-demo.controller.ts` · base path: `/v1/sales/demo-links` · guard: `SalesAgentActiveGuard` · 5 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 905 | POST | `/v1/sales/demo-links` | `mint` (L24) | `sales.demo_link.create` | แพลตฟอร์ม | ออก (mint) (ลิงก์ เดโม งานขาย) | `B:MintDemoLinkDto` | `→ SalesDemoService.mint()` (201) |
| 906 | GET | `/v1/sales/demo-links` | `list` (L37) | `sales.demo_link.create` | แพลตฟอร์ม | ดูรายการ (ลิงก์ เดโม งานขาย) | — | `→ SalesDemoService.links.list()` |
| 907 | PATCH | `/v1/sales/demo-links/:id` | `update` (L44) | `sales.demo_link.create` | แพลตฟอร์ม | แก้ไข (ลิงก์ เดโม งานขาย) | `B:raw(req.body)` | `→ SalesDemoService.links.update()` |
| 908 | POST | `/v1/sales/demo-links/:id/reset` | `reset` (L51) | `sales.demo_link.create` | แพลตฟอร์ม | รีเซ็ต (ลิงก์ เดโม งานขาย) | — | `→ SalesDemoService.links.reset()` (204) |
| 909 | DELETE | `/v1/sales/demo-links/:id` | `remove` (L58) | `sales.demo_link.create` | แพลตฟอร์ม | นำออก (ลิงก์ เดโม งานขาย) | — | `→ SalesDemoService.links.remove()` (204) |

**`DemoAuthController`** — `apps/api/src/modules/sales-demo/presentation/sales-demo.controller.ts` · base path: `/v1/auth/demo` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 910 | POST | `/v1/auth/demo/open` | `open` (L71) | Public | แพลตฟอร์ม | เปิด (auth เดโม) | `B:OpenDemoDto` | `→ SalesDemoService.open()` (200) |

### 2.27 โมดูล `system-identity-reconciliation` — 7 endpoint

**`SystemIdentityReconciliationController`** — `apps/api/src/modules/system-identity-reconciliation/presentation/http/system-identity-reconciliation.controller.ts` · base path: `/v1/system/identity-reconciliation` · สิทธิ์ระดับ class: `system.identity_reconciliation.resolve` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 911 | POST | `/v1/system/identity-reconciliation/companies/:partnerCompanyId/generate` | `generateForCompany` (L76) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | สร้าง/ประมวลผล สำหรับ บริษัท — _Generate reconciliation items for one company (writes no domain data)_ | — | `→ GenerateIdentityReconciliationUseCase.execute()` (200) |
| 912 | GET | `/v1/system/identity-reconciliation/items` | `listItems` (L83) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | ดูรายการ รายการ (การกระทบยอด ตัวตน ระบบ) — _List reconciliation items (cursor paged)_ | `Q:ListItemsQueryDto` | `→ ReadIdentityReconciliationUseCase.listItems()` |
| 913 | POST | `/v1/system/identity-reconciliation/items/:itemId/resolve-tax-id` | `resolveTaxId` (L89) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | แก้ไข/ปิดประเด็น รหัส ภาษี — _Resolve a Company/CompanyTaxProfile tax id disagreement_ | `B:ResolveTaxIdDto` | `→ ResolveIdentityReconciliationUseCase.resolveTaxId()` (200) |
| 914 | POST | `/v1/system/identity-reconciliation/items/:itemId/resolve-branch-duplicate` | `resolveBranchDuplicate` (L100) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | แก้ไข/ปิดประเด็น รายการซ้ำ สาขา — _Resolve duplicated branch tax identity_ | `B:ResolveBranchDuplicateDto` | `→ ResolveIdentityReconciliationUseCase.resolveBranchDuplicate()` (200) |
| 915 | POST | `/v1/system/identity-reconciliation/items/:itemId/resolve-vat-hint` | `resolveVatHint` (L111) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | แก้ไข/ปิดประเด็น คำใบ้ VAT — _Confirm or dismiss a dateless legacy VAT registration hint_ | `B:ResolveVatHintDto` | `→ ResolveIdentityReconciliationUseCase.resolveVatHint()` (200) |
| 916 | POST | `/v1/system/identity-reconciliation/companies/:partnerCompanyId/repair-tax-id` | `repairTaxId` (L122) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | ซ่อมข้อมูล รหัส ภาษี — _Repair a tax id typo without creating a legal-date fence (post-B2 route)_ | `B:RepairTaxIdDto` | `→ ResolveIdentityReconciliationUseCase.repairTaxId()` (200) |
| 917 | GET | `/v1/system/identity-reconciliation/reports/:reportKey` | `report` (L133) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | ดู รายงาน (การกระทบยอด ตัวตน ระบบ) — _Reconciliation reports_ | `Q{companyId}` | `→ ReadIdentityReconciliationUseCase.report()` |

### 2.28 โมดูล `system-onboarding` — 4 endpoint

**`SystemOnboardingController`** — `apps/api/src/modules/system-onboarding/presentation/http/system-onboarding.controller.ts` · base path: `/v1/system/company-onboardings` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 918 | POST | `/v1/system/company-onboardings` | `create` (L62) | `system.company_onboarding.create` | แพลตฟอร์ม | สร้าง (การเริ่มใช้งาน ระบบ) — _Create customer company onboarding (system admin only)_ | `B:CreateOnboardingDto` | `→ CreateCompanyOnboardingUseCase.execute()` (201) |
| 919 | GET | `/v1/system/company-onboardings/:id` | `getById` (L93) | `system.company_onboarding.read` | แพลตฟอร์ม | ดูข้อมูล ตาม รหัส — _Get onboarding run metadata (no password)_ | — | `→ GetCompanyOnboardingUseCase.execute()` |
| 920 | POST | `/v1/system/company-onboardings/:id/regenerate-temporary-password` | `regenerateTempPassword` (L102) | `system.company_onboarding.regenerate_temporary_password` | แพลตฟอร์ม | สร้างใหม่ รหัสผ่าน ชั่วคราว — _Regenerate temporary password and owner LINE link QR; shown once only_ | — | `→ RegenerateTemporaryPasswordUseCase.execute()` (200) |
| 921 | POST | `/v1/system/company-onboardings/:id/reissue-owner-line-link` | `reissueOwnerLineLinkQr` (L117) | `system.company_onboarding.regenerate_temporary_password` | แพลตฟอร์ม | ออกใหม่ QR ลิงก์/การผูก LINE เจ้าของ — _Reissue owner LINE link QR without changing the password_ | — | `→ ReissueOwnerLineLinkUseCase.execute()` (200) |

### 2.29 โมดูล `system-partner-management` — 44 endpoint

**`PartnerController`** — `apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts` · base path: `/v1/system/partners` · 35 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 922 | GET | `/v1/system/partners` | `list` (L296) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดูรายการ (พาร์ตเนอร์) — _List partner companies (metadata only)_ | `Q{status,page,pageSize,q,reportClassification,reportIndustryGroup}` | `→ ListPartnersUseCase.execute()` |
| 923 | GET | `/v1/system/partners/address-master` | `addresses` (L321) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | ดู ที่อยู่ (พาร์ตเนอร์) — _Thai address options for the partner identity form_ | `Q{postalCode}` | `→ ListThaiAddressesUseCase.execute()` |
| 924 | GET | `/v1/system/partners/:partnerCompanyId/identity` | `identityControl` (L331) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | ดู การควบคุม ตัวตน — _Read the partner company's legal-identity CAS token and allowed change kinds_ | — | `→ UpdatePartnerIdentityUseCase.getControl()` |
| 925 | PATCH | `/v1/system/partners/:partnerCompanyId/identity` | `updateIdentityFields` (L338) | `system.identity_reconciliation.resolve` | แพลตฟอร์ม | แก้ไข ฟิลด์ ตัวตน — _Change the registered name, tax id and/or address of a partner company_ | `B:PartnerIdentityBodyDto` | `→ UpdatePartnerIdentityUseCase.execute()` |
| 926 | GET | `/v1/system/partners/:partnerCompanyId` | `detail` (L364) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดู รายละเอียด (พาร์ตเนอร์) — _Get partner company detail (metadata only)_ | — | `→ GetPartnerDetailUseCase.execute()` |
| 927 | GET | `/v1/system/partners/:partnerCompanyId/team-note` | `getTeamNote` (L373) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดูข้อมูล บันทึกช่วยจำ ทีม | — | `→ CompanyTeamNoteService.get()` |
| 928 | PUT | `/v1/system/partners/:partnerCompanyId/team-note` | `putTeamNote` (L380) | `system.partner_company.update` | แพลตฟอร์ม | แทนที่ บันทึกช่วยจำ ทีม | `B:PutCompanyTeamNoteDto` | `→ CompanyTeamNoteService.put()` |
| 929 | PATCH | `/v1/system/partners/:partnerCompanyId` | `update` (L390) | `system.partner_company.update` | แพลตฟอร์ม | แก้ไข (พาร์ตเนอร์) — _Update partner company profile metadata_ | `B:UpdateProfileBodyDto` | `→ UpdatePartnerProfileUseCase.execute()` |
| 930 | POST | `/v1/system/partners/:partnerCompanyId/lifecycle` | `transitionLifecycle` (L408) | `system.partner_company.lifecycle.manage` | แพลตฟอร์ม | เปลี่ยนสถานะ วงจรชีวิต (พาร์ตเนอร์) — _Transition partner company lifecycle (activate/inactivate/archive)_ | `B:LifecycleBodyDto` | `→ PartnerLifecycleTransitionUseCase.execute()` (200) |
| 931 | GET | `/v1/system/partners/:partnerCompanyId/members` | `members` (L429) | `system.partner_member.read` | แพลตฟอร์ม | ดู สมาชิก (พาร์ตเนอร์) — _List partner company members with roles, LINE link and credential state_ | — | `→ ListPartnerMembersUseCase.execute()` |
| 932 | POST | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/line-unlink` | `unlinkLine` (L438) | `system.partner_member.manage` | แพลตฟอร์ม | ยกเลิกการผูก LINE (พาร์ตเนอร์) — _Unlink a member LINE identity (member relinks by scanning a fresh QR)_ | — | `→ PartnerMemberLineUnlinkUseCase.execute()` (200) |
| 933 | POST | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/line-link-token` | `issueLineLinkToken` (L460) | `system.partner_member.manage` | แพลตฟอร์ม | ออกเอกสาร token ลิงก์/การผูก LINE — _Issue a fresh LINE-link QR for a member (72h, single use, revokes prior pending QRs)_ | — | `→ PartnerMemberLineLinkTokenUseCase.execute()` (200) |
| 934 | POST | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reset` | `resetPassword` (L480) | `system.partner_member.manage` | แพลตฟอร์ม | รีเซ็ต รหัสผ่าน (พาร์ตเนอร์) — _Issue a new temporary password for a member (returned once, stored encrypted for reveal)_ | — | `→ PartnerMemberPasswordResetUseCase.execute()` (200) |
| 935 | POST | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/password/reveal` | `revealPassword` (L499) | `system.partner_member.manage` | แพลตฟอร์ม | เปิดดูข้อมูลที่ปกปิด รหัสผ่าน (พาร์ตเนอร์) — _Reveal the current system-generated temporary password (audited per reveal)_ | — | `→ PartnerMemberPasswordRevealUseCase.execute()` (200) |
| 936 | PATCH | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/contact` | `setContact` (L518) | `system.partner_member.manage` | แพลตฟอร์ม | ตั้งค่า ข้อมูลติดต่อ (พาร์ตเนอร์) — _Set member contact email and mobile (admin backfill; email becomes a login identifier)_ | `B:MemberContactBodyDto` | `→ SetPartnerMemberContactUseCase.execute()` |
| 937 | PATCH | `/v1/system/partners/:partnerCompanyId/members/:memberUserId/display-name` | `setDisplayName` (L540) | `system.partner_member.manage` | แพลตฟอร์ม | ตั้งค่า ชื่อ การแสดงผล — _Update a customer owner account display name_ | `B:OwnerNameBodyDto` | `→ SetPartnerOwnerNameUseCase.execute()` |
| 938 | PUT | `/v1/system/partners/:partnerCompanyId/features` | `setFeatureEntitlements` (L556) | `system.partner_feature.manage` | แพลตฟอร์ม | ตั้งค่า สิทธิ์ใช้ฟีเจอร์ ฟีเจอร์ — _Set partner feature entitlements_ | `B:SetFeaturesBodyDto` | `→ SetPartnerFeaturesUseCase.execute()` |
| 939 | PUT | `/v1/system/partners/:partnerCompanyId/ai-model` | `setAiModelConfig` (L578) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ตั้งค่า การตั้งค่า โมเดล AI — _Set approved AI model, monthly AI budget and/or CHAT/OCR budget policy for partner company_ | `B:SetAiModelBodyDto` | `→ SetPartnerAiModelUseCase.execute()` |
| 940 | PUT | `/v1/system/partners/:partnerCompanyId/ocr-config` | `setOcrConfiguration` (L603) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ตั้งค่า การตั้งค่า OCR — _Enable/disable OCR and set the monthly OCR read limit for one partner company_ | `B:SetOcrConfigBodyDto` | `→ SetPartnerOcrConfigUseCase.execute()` |
| 941 | PUT | `/v1/system/partners/:partnerCompanyId/manual-expense-web-entry` | `setManualExpenseWebEntry` (L628) | `system.partner_feature.manage` | แพลตฟอร์ม | ตั้งค่า รายการ เว็บ รายจ่าย แบบกรอกเอง — _Show or hide the web entrances to the manual expense page for one partner company_ | `B:SetManualExpenseWebEntryBodyDto` | `→ SetPartnerManualExpenseWebEntryUseCase.execute()` |
| 942 | PUT | `/v1/system/partners/:partnerCompanyId/disbursement-voucher-web-entry` | `setDisbursementVoucherWebEntry` (L648) | `system.partner_feature.manage` | แพลตฟอร์ม | ตั้งค่า รายการ เว็บ ใบสำคัญจ่าย การเบิกจ่าย — _Show or hide the web entrances to the disbursement voucher document for one partner company_ | `B:SetDisbursementVoucherWebEntryBodyDto` | `→ SetPartnerDisbursementVoucherWebEntryUseCase.execute()` |
| 943 | PUT | `/v1/system/partners/:partnerCompanyId/vat-registration` | `setVatRegistration` (L672) | `system.partner_company.update` | แพลตฟอร์ม | ตั้งค่า การจดทะเบียน VAT — _Answer or correct a partner company VAT registration_ | `B:SetPartnerVatRegistrationBodyDto` | `→ CompanyVatRegistrationUseCase.put()` |
| 944 | GET | `/v1/system/partners/:partnerCompanyId/ai-usage` | `aiUsage` (L689) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดู การใช้งาน AI — _Get partner AI spend meter: current/previous month, effective budget, top usage tags_ | — | `→ GetPartnerAiUsageUseCase.execute()` |
| 945 | GET | `/v1/system/partners/:partnerCompanyId/ai-credit-holds` | `aiCreditHolds` (L706) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดู การกันวงเงิน เครดิต AI — _List UNRESOLVED AI credit holds and unacknowledged breaches of every month, one page at a _ | `Q{cursor}` | `→ PartnerAiCreditHoldsUseCase.read()` |
| 946 | POST | `/v1/system/partners/:partnerCompanyId/ai-credit-holds/:reservationId/release` | `releaseAiCreditHold` (L722) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ปล่อย การกันวงเงิน เครดิต AI — _Release one UNRESOLVED hold: the credit is free immediately and no usage is recorded_ | `B:PartnerAiCreditHoldActionBodyDto` | `→ PartnerAiCreditHoldsUseCase.release()` (200) |
| 947 | POST | `/v1/system/partners/:partnerCompanyId/ai-credit-holds/:reservationId/charge-at-bound` | `chargeAiCreditHoldAtBound` (L738) | `system.partner_ai_model.manage` | แพลตฟอร์ม | เรียกเก็บเงิน การกันวงเงิน เครดิต AI ที่ ที่ผูกแล้ว — _Settle one UNRESOLVED hold at its own declared upper bound (no tokens, not a model call)_ | `B:PartnerAiCreditHoldActionBodyDto` | `→ PartnerAiCreditHoldsUseCase.chargeAtBound()` (200) |
| 948 | POST | `/v1/system/partners/:partnerCompanyId/ai-credit-holds/:reservationId/acknowledge-breach` | `acknowledgeAiCreditBreach` (L754) | `system.partner_ai_model.manage` | แพลตฟอร์ม | รับทราบ การผิด SLA เครดิต AI — _Acknowledge one breach row: money untouched, admission for that scope reopens_ | `B:PartnerAiCreditHoldActionBodyDto` | `→ PartnerAiCreditHoldsUseCase.acknowledgeBreach()` (200) |
| 949 | GET | `/v1/system/partners/:partnerCompanyId/ai-adjustments` | `aiAdjustments` (L787) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ดู รายการปรับปรุง AI — _Read bounded AI adjustment history for the original company_ | `Q:PartnerAiAdjustmentHistoryQueryDto` | `→ GetPartnerAiUsageUseCase.history()` |
| 950 | GET | `/v1/system/partners/:partnerCompanyId/plan-term` | `planTerm` (L798) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดู อายุแพ็ก แพ็ก/แผน — _Get plan limits and usage term ({ term: null } for grandfathered companies)_ | — | `→ GetCompanyPlanTermUseCase.execute()` |
| 951 | GET | `/v1/system/partners/:partnerCompanyId/plan-term/history` | `planTermHistory` (L806) | `system.partner_dashboard.read` | แพลตฟอร์ม | ดู ประวัติ อายุแพ็ก แพ็ก/แผน | `Q{cursor}` | `→ GetPartnerPlanAdjustmentHistoryUseCase.execute()` |
| 952 | PUT | `/v1/system/partners/:partnerCompanyId/plan-term` | `setPlanTermConfig` (L812) | `system.partner_company.update` | แพลตฟอร์ม | ตั้งค่า การตั้งค่า อายุแพ็ก แพ็ก/แผน — _Create or update plan limits and term (dates are set on create only)_ | `B:SetPlanTermBodyDto` | `→ SetCompanyPlanTermUseCase.execute()` |
| 953 | POST | `/v1/system/partners/:partnerCompanyId/plan-term/renew` | `renewPlanTermConfig` (L831) | `system.partner_company.update` | แพลตฟอร์ม | ต่ออายุ การตั้งค่า อายุแพ็ก แพ็ก/แผน — _Extend the usage term; re-enables a company only if the term expiry disabled it_ | `B:RenewPlanTermBodyDto` | `→ RenewCompanyPlanTermUseCase.execute()` (200) |
| 954 | POST | `/v1/system/partners/:partnerCompanyId/plan-term/end-warmup` | `endPlanTermWarmup` (L852) | `system.partner_company.update` | แพลตฟอร์ม | สิ้นสุด การอุ่นเครื่อง อายุแพ็ก แพ็ก/แผน — _End the LINE trial warm-up ceiling early (idempotent)_ | — | `→ EndPlanTermWarmupUseCase.execute()` (200) |
| 955 | GET | `/v1/system/partners/:partnerCompanyId/timeline` | `partnerTimeline` (L873) | `system.company_onboarding.read` | แพลตฟอร์ม | ดู ไทม์ไลน์ พาร์ตเนอร์ — _Key events for one shop, assembled from existing audit and meter rows_ | — | `→ GetPartnerTimelineUseCase.execute()` |
| 956 | POST | `/v1/system/partners/:partnerCompanyId/line-message` | `sendLineMessage` (L882) | `system.partner_company.update` | แพลตฟอร์ม | ส่ง ข้อความ LINE — _Push one operator-written LINE message to this shop OWNERs, plus the requester named _ | `B:PartnerLineMessageBodyDto` | `→ SendPartnerLineMessageUseCase.execute()` (200) |

**`PlanTermNoticeController`** — `apps/api/src/modules/system-partner-management/presentation/http/plan-term.controller.ts` · base path: `/v1/plan-term` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 957 | GET | `/v1/plan-term/notice` | `get` (L23) | `account.session.read` | ทุกแพ็ก | ดูข้อมูล (ประกาศ อายุแพ็ก แพ็ก/แผน) — _Plan term state of the caller's current company (null when unlimited)_ | — | `→ GetPlanTermNoticeUseCase.execute()` |

**`PlanTermInternalController`** — `apps/api/src/modules/system-partner-management/presentation/http/plan-term.controller.ts` · base path: `/v1/internal/plan-term` · `@Public()` ระดับ class · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 958 | POST | `/v1/internal/plan-term/sweep` | `execute` (L40) | Public — `X-Worker-Token` | แพลตฟอร์ม | ดำเนินการ (ภายใน อายุแพ็ก แพ็ก/แผน) | — | `→ PlanTermSweepUseCase.execute()` |

**`SystemAiBudgetController`** — `apps/api/src/modules/system-partner-management/presentation/http/system-ai-budget.controller.ts` · base path: `/v1/system/ai-budget` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 959 | GET | `/v1/system/ai-budget` | `get` (L27) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ดูข้อมูล (งบประมาณ AI ระบบ) — _Get platform AI monthly budget default and ceiling (with their source)_ | — | `→ GetPlatformAiBudgetUseCase.execute()` |
| 960 | PUT | `/v1/system/ai-budget` | `set` (L35) | `system.partner_ai_model.manage` | แพลตฟอร์ม | ตั้งค่า (งบประมาณ AI ระบบ) — _Set platform AI monthly budget default and ceiling (platform-level)_ | `B:SetPlatformAiBudgetBodyDto` | `→ SetPlatformAiBudgetUseCase.execute()` |

**`SystemLineController`** — `apps/api/src/modules/system-partner-management/presentation/http/system-line.controller.ts` · base path: `/v1/system/line` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 961 | GET | `/v1/system/line/shared-credentials` | `read` (L24) | `system.shared_line_credential.manage` | แพลตฟอร์ม | อ่าน (LINE ระบบ) | — | `→ SetSharedLineCredentialUseCase.read()` |
| 962 | PUT | `/v1/system/line/shared-credentials/:credentialKind` | `setSharedCredential` (L28) | `system.shared_line_credential.manage` | แพลตฟอร์ม | ตั้งค่า ข้อมูลรับรอง ที่แชร์ | `B:SetSharedLineCredentialBodyDto` | `→ RedisRateLimitService.consume()` |

**`SystemPackageChangeController`** — `apps/api/src/modules/system-partner-management/presentation/http/system-package-change.controller.ts` · base path: `/v1/system/package-change-requests` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 963 | GET | `/v1/system/package-change-requests` | `list` (L33) | `system.partner_company.update` | แพลตฟอร์ม | ดูรายการ (การเปลี่ยนแปลง แพ็กเกจ ระบบ) — _Package-change requests waiting on an admin (default OPEN)_ | `Q{status}` | `AdminPackageChangeQueueDto` |
| 964 | POST | `/v1/system/package-change-requests/:id/decision` | `decide` (L42) | `system.partner_company.update` | แพลตฟอร์ม | ตัดสิน (การเปลี่ยนแปลง แพ็กเกจ ระบบ) — _Approve (moves the tier) or reject one package-change request_ | `B:PackageChangeDecisionBodyDto` | `AdminPackageChangeDecisionDto` (200) |

**`SystemUserLookupController`** — `apps/api/src/modules/system-partner-management/presentation/http/system-user-lookup.controller.ts` · base path: `/v1/system/users` · 1 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 965 | GET | `/v1/system/users/lookup` | `lookup` (L13) | `system.partner_member.read` | แพลตฟอร์ม | ค้นหา (การค้นหา ผู้ใช้ ระบบ) — _Look up a person by email, username or name across every company_ | `Q{q,status}` | `→ LookupUsersUseCase.execute()` |

### 2.30 โมดูล `tax` — 75 endpoint

**`SystemWhtIncomeCategoryController`** — `apps/api/src/modules/tax/presentation/http/system-wht-income-category.controller.ts` · base path: `/v1/system/wht-income-categories` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 966 | GET | `/v1/system/wht-income-categories` | `list` (L18) | `system.wht_income_category.manage` | แพลตฟอร์ม | ดูรายการ (หมวดหมู่ รายรับ ภาษีหัก ณ ที่จ่าย ระบบ) | — | — |
| 967 | PATCH | `/v1/system/wht-income-categories/:code` | `setStatus` (L30) | `system.wht_income_category.manage` | แพลตฟอร์ม | ตั้งค่า สถานะ (หมวดหมู่ รายรับ ภาษีหัก ณ ที่จ่าย ระบบ) | `B:SetSystemWhtIncomeCategoryStatusDto` | `→ SetWhtIncomeCategoryStatusUseCase.execute()` |

**`TaxController`** — `apps/api/src/modules/tax/presentation/http/tax.controller.ts` · base path: `/v1/companies/:companyId` · 45 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 968 | GET | `/v1/companies/:companyId/tax/withholding/payer-mode` | `getWhtPayerMode` (L61) | any(`wht.pnd53.read` \| `company.legal_identity.manage` \| `company.branch.read`) | ทุกแพ็ก [company_settings,wht_pnd53] | ดูข้อมูล โหมด ผู้จ่าย ภาษีหัก ณ ที่จ่าย | `Q{periodKey}` | `→ PrismaTaxRepository.readWhtPayerMode()` |
| 969 | POST | `/v1/companies/:companyId/tax/withholding/payer-mode` | `answerWhtPayerMode` (L68) | `company.legal_identity.manage` | ทุกแพ็ก | ตอบ โหมด ผู้จ่าย ภาษีหัก ณ ที่จ่าย | `B:AnswerWhtPayerModeDto` | `→ PrismaTaxRepository.answerWhtPayerMode()` (200) |
| 970 | POST | `/v1/companies/:companyId/tax/withholding/filings/:filingId/confirm-rows` | `confirmWhtFilingRows` (L80) | `wht.pnd53.prepare` | ENT [wht_pnd53] | ยืนยัน แถว การยื่นแบบ ภาษีหัก ณ ที่จ่าย | `B:ConfirmWhtFilingRowsDto` | `→ GenerateTaxFilingPackageUseCase.confirmRows()` |
| 971 | GET | `/v1/companies/:companyId/tax/withholding/months` | `listWithholdingMonths` (L87) | `wht.pnd53.read` | ENT [wht_pnd53] | ดูรายการ เดือน การหักภาษี | — | `→ GenerateWhtReportUseCase.listMonths()` |
| 972 | GET | `/v1/companies/:companyId/tax/withholding/months/:periodKey` | `getWithholdingMonth` (L94) | `wht.pnd53.read` | ENT [wht_pnd53] | ดูข้อมูล เดือน การหักภาษี | — | `→ GenerateWhtReportUseCase.getMonth()` |
| 973 | GET | `/v1/companies/:companyId/tax/withholding/months/:periodKey/e-wht-export` | `exportEWht` (L101) | `wht.pnd53.read` | ENT [wht_pnd53] | ส่งออก ภาษีหัก ณ ที่จ่าย e- | `Q{establishmentCode}` | `→ GenerateWhtReportUseCase.eWhtExport()` |
| 974 | GET | `/v1/companies/:companyId/tax/pnd53/periods`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods` | `listPnd53Periods` (L123) | `wht.pnd53.read` | ENT [wht_pnd53] | ดูรายการ งวด ภ.ง.ด.53 — _List periods of the selected withholding form_ | — | `→ PrismaTaxRepository.findPeriods()` |
| 975 | GET | `/v1/companies/:companyId/tax/pnd53/periods/:periodId/events`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods/:periodId/events` | `listPnd53Events` (L132) | `wht.pnd53.read` | ENT [wht_pnd53] | ดูรายการ เหตุการณ์ ภ.ง.ด.53 — _Read source events for the selected withholding form_ | — | `→ PrismaTaxRepository.findEventsByPeriod()` |
| 976 | POST | `/v1/companies/:companyId/tax/pnd53/sync`<br>`/v1/companies/:companyId/tax/withholding/:formType/sync` | `syncPnd53` (L142) | `wht.pnd53.prepare` | ENT [wht_pnd53] | ซิงก์ ภ.ง.ด.53 (ภาษี) — _Sync both withholding forms without VAT_ | — | `→ SyncTaxEventsUseCase.execute()` (200) |
| 977 | POST | `/v1/companies/:companyId/tax/pnd53/periods/:periodId/report`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods/:periodId/report` | `generatePnd53` (L153) | `wht.pnd53.prepare` | ENT [wht_pnd53] | สร้าง/ประมวลผล ภ.ง.ด.53 (ภาษี) — _Compute the selected withholding report_ | — | `→ GenerateWhtReportUseCase.execute()` (200) |
| 978 | POST | `/v1/companies/:companyId/tax/pnd53/periods/:periodId/export`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods/:periodId/export` | `exportPnd53` (L164) | `wht.pnd53.prepare` | ENT [wht_pnd53] | ส่งออก ภ.ง.ด.53 (ภาษี) — _Produce the selected official withholding form and annexes_ | `B:ExportPnd53Dto` | `→ GenerateTaxFilingPackageUseCase.execute()` (200) |
| 979 | GET | `/v1/companies/:companyId/tax/pnd53/periods/:periodId/review-issues`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods/:periodId/review-issues` | `listPnd53Issues` (L177) | `wht.pnd53.read` | ENT [wht_pnd53] | ดูรายการ ประเด็น ภ.ง.ด.53 — _List review issues of the selected withholding form_ | — | `→ PrismaTaxRepository.findIssuesByPeriod()` |
| 980 | PATCH | `/v1/companies/:companyId/tax/pnd53/review-issues/:issueId/resolve`<br>`/v1/companies/:companyId/tax/withholding/:formType/review-issues/:issueId/resolve` | `resolvePnd53Issue` (L187) | `wht.pnd53.prepare` | ENT [wht_pnd53] | แก้ไข/ปิดประเด็น ประเด็น ภ.ง.ด.53 — _Resolve an issue belonging to the selected withholding form_ | `B:ResolvePnd53IssueDto` | — |
| 981 | PATCH | `/v1/companies/:companyId/tax/pnd53/periods/:periodId/mark-filed`<br>`/v1/companies/:companyId/tax/withholding/:formType/periods/:periodId/mark-filed` | `markPnd53Filed` (L199) | `wht.pnd53.prepare` | ENT [wht_pnd53] | ทำเครื่องหมาย ยื่นแล้ว ภ.ง.ด.53 — _Record that the selected exported withholding form was filed_ | `B:MarkPnd53FiledDto` | — |
| 982 | GET | `/v1/companies/:companyId/tax/profile` | `getProfile` (L211) | `tax.profile.read` | ไม่ขาย(thai_tax) | ดูข้อมูล โปรไฟล์ (ภาษี) — _Get company tax profile_ | — | — |
| 983 | GET | `/v1/companies/:companyId/tax/profile/signature` | `getTaxSignature` (L219) | `company.tax_signature.manage` | ENT [wht_50bis] | ดูข้อมูล ลายเซ็น ภาษี — _Read only the company WHT-certificate signature settings_ | — | `→ UpdateCompanyTaxSignatureUseCase.read()` |
| 984 | PATCH | `/v1/companies/:companyId/tax/profile/signature` | `updateTaxSignature` (L230) | `company.tax_signature.manage` | ENT [wht_50bis] | แก้ไข ลายเซ็น ภาษี — _Set the company WHT-certificate signature mode (BLANK or AUTO_STAMP)_ | `B:UpdateCompanyTaxSignatureDto` | `→ UpdateCompanyTaxSignatureUseCase.execute()` |
| 985 | GET | `/v1/companies/:companyId/tax/periods` | `listPeriods` (L239) | `tax.period.read` | ไม่ขาย(thai_tax) | ดูรายการ งวด (ภาษี) — _List tax periods_ | `Q{taxType,status,page,pageSize}` | `→ PrismaTaxRepository.findPeriods()` |
| 986 | POST | `/v1/companies/:companyId/tax/sync` | `sync` (L248) | `tax.event.sync` | ไม่ขาย(thai_tax) | ซิงก์ (ภาษี) — _Sync source tax events from accounting/expense/payment records_ | `B:{ since?: string }` | `→ SyncTaxEventsUseCase.execute()` (200) |
| 987 | GET | `/v1/companies/:companyId/tax/periods/:periodId/events` | `listEvents` (L259) | `tax.event.read` | ไม่ขาย(thai_tax) | ดูรายการ เหตุการณ์ (ภาษี) — _List tax events for a period_ | — | `→ PrismaTaxRepository.findEventsByPeriod()` |
| 988 | POST | `/v1/companies/:companyId/tax/periods/:periodId/vat-report` | `generateVatReport` (L268) | `tax.report.recompute` | ไม่ขาย(thai_tax) | สร้าง/ประมวลผล รายงาน VAT — _Generate/recompute VAT report snapshot for a period_ | `B:{ formType?: 'PP30' \| 'PP36'; periodKey: string }` | `→ GenerateVatReportUseCase.execute()` (200) |
| 989 | POST | `/v1/companies/:companyId/tax/periods/:periodId/wht-report` | `generateWhtReport` (L278) | `tax.report.recompute` | ไม่ขาย(thai_tax) | สร้าง/ประมวลผล รายงาน ภาษีหัก ณ ที่จ่าย — _Generate/recompute WHT report snapshot for a period_ | `B:{ formType?: 'PND3' \| 'PND53'; periodKey: string }` | `→ GenerateWhtReportUseCase.execute()` (200) |
| 990 | GET | `/v1/companies/:companyId/tax/periods/:periodId/review-issues` | `listReviewIssues` (L288) | `tax.review_issue.read` | ไม่ขาย(thai_tax) | ดูรายการ ประเด็น การตรวจทาน — _List review issues for a tax period_ | `Q{status}` | `→ PrismaTaxRepository.findIssuesByPeriod()` |
| 991 | PATCH | `/v1/companies/:companyId/tax/review-issues/:issueId/resolve` | `resolveIssue` (L295) | `tax.review_issue.resolve` | ไม่ขาย(thai_tax) | แก้ไข/ปิดประเด็น ประเด็น (ภาษี) — _Resolve a tax review issue_ | `B:{ note: string }` | `→ PrismaTaxRepository.resolveIssue()` |
| 992 | PATCH | `/v1/companies/:companyId/tax/periods/:periodId/mark-filed` | `markFiled` (L313) | `tax.filing.mark_filed` | ไม่ขาย(thai_tax) | ทำเครื่องหมาย ยื่นแล้ว (ภาษี) — _Mark tax period as filed (manual)_ | `B:MarkPnd53FiledDto` | `→ PrismaTaxRepository.findPeriodById()` |
| 993 | PATCH | `/v1/companies/:companyId/tax/periods/:periodId/mark-paid` | `markPaid` (L385) | `tax.filing.mark_paid` | ไม่ขาย(thai_tax) | ทำเครื่องหมาย ที่จ่ายแล้ว (ภาษี) — _Mark tax period as paid (manual)_ | `B:{ note?: string }` | `→ PrismaTaxRepository.findPeriodById()` |
| 994 | POST | `/v1/companies/:companyId/tax/periods/:periodId/filing-packages` | `generateExportPackage` (L398) | `tax.report.export` | ไม่ขาย(thai_tax) | สร้าง/ประมวลผล แพ็กเกจ การส่งออก — _Generate tax review export package artifact_ | `B:ExportTaxPackageDto` | `→ GenerateTaxFilingPackageUseCase.execute()` (200) |
| 995 | POST | `/v1/companies/:companyId/tax/wht-certificates` | `issueWhtCertificate` (L408) | `tax.certificate.issue` | ไม่ขาย(thai_tax) | ออกเอกสาร หนังสือรับรอง ภาษีหัก ณ ที่จ่าย — _Issue 50 Tawi WHT certificate with PDF artifact_ | `B:Parameters<CreateWhtCertificateUseCase['execute']>[1]` | `→ CreateWhtCertificateUseCase.execute()` (200) |
| 996 | GET | `/v1/companies/:companyId/wht/payment-handoffs` | `listWhtHandoffs` (L422) | any(`wht.certificate.read` \| `wht.certificate.issue` \| `wht.certificate.correct` \| `wht.external_certificate.link`) | ทุกแพ็ก [wht_50bis] | ดูรายการ การส่งต่อ ภาษีหัก ณ ที่จ่าย — _List 50 Tawi certificates awaiting external issuance_ | `Q:WhtCertificateHandoffListQueryDto = {}` | `→ WhtCertificateHandoffUseCase.listPaged()` |
| 997 | GET | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId` | `getWhtHandoff` (L440) | `wht.certificate.read` | ทุกแพ็ก | ดูข้อมูล การส่งต่อ ภาษีหัก ณ ที่จ่าย — _Read one 50 Tawi external handoff with its prefilled facts_ | — | `→ WhtCertificateHandoffUseCase.get()` |
| 998 | GET | `/v1/companies/:companyId/wht/expenses/:expenseId/certificate-history` | `getExpenseWhtCertificateHistory` (L448) | any(`wht.certificate.read` \| `wht.certificate.issue` \| `wht.certificate.correct` \| `wht.external_certificate.link`) | ทุกแพ็ก [wht_50bis] | ดูข้อมูล ประวัติ หนังสือรับรอง ภาษีหัก ณ ที่จ่าย รายจ่าย — _Read certificate history for one expense, newest first_ | — | `→ WhtCertificateHandoffUseCase.getExpenseHistory()` |
| 999 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/payee-address` | `setWhtHandoffPayeeAddress` (L456) | any(`wht.external_certificate.link` \| `wht.certificate.issue`) | ทุกแพ็ก [wht_50bis] | ตั้งค่า ที่อยู่ ผู้รับเงิน การส่งต่อ ภาษีหัก ณ ที่จ่าย — _Supply the payee address a frozen 50 Tawi prefill never had_ | `B:SetWhtHandoffPayeeAddressDto` | `→ WhtCertificateHandoffUseCase.setPayeeAddress()` (200) |
| 1000 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate/file-upload-intent` | `externalWhtFileIntent` (L471) | `wht.external_certificate.link` | ทุกแพ็ก | ดำเนินการ เจตนา ไฟล์ ภาษีหัก ณ ที่จ่าย ภายนอก | `B:ExternalWhtFileUploadDto` | `→ WhtCertificateHandoffUseCase.externalFileIntent()` |
| 1001 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate/file-uploads/:attachmentId/complete` | `completeExternalWhtFile` (L478) | `wht.external_certificate.link` | ทุกแพ็ก | ยืนยันเสร็จสิ้น ไฟล์ ภาษีหัก ณ ที่จ่าย ภายนอก | `B:CompleteExternalWhtFileDto` | `→ WhtCertificateHandoffUseCase.completeExternalFile()` |
| 1002 | GET | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate/files/:attachmentId` | `externalWhtFile` (L485) | any(`wht.certificate.read` \| `wht.certificate.issue` \| `wht.certificate.correct` \| `wht.external_certificate.link`) | ทุกแพ็ก [wht_50bis] | ดู ไฟล์ ภาษีหัก ณ ที่จ่าย ภายนอก | — | `→ WhtCertificateHandoffUseCase.externalFile()` |
| 1003 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate` | `linkExternalWhtCertificate` (L492) | `wht.external_certificate.link` | ทุกแพ็ก | ผูก หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ภายนอก — _Link an externally issued 50 Tawi certificate back to its handoff_ | `B:LinkExternalWhtCertificateDto` | `→ WhtCertificateHandoffUseCase.linkExternal()` (200) |
| 1004 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate/change` | `changeExternalWhtCertificate` (L506) | `wht.external_certificate.link` | ทุกแพ็ก | เปลี่ยน หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ภายนอก — _Change the standing self-issued certificate record_ | `B:LinkExternalWhtCertificateDto` | `→ WhtCertificateHandoffUseCase.changeExternal()` (200) |
| 1005 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/external-certificate/remove` | `removeExternalWhtCertificate` (L520) | `wht.external_certificate.link` | ทุกแพ็ก | นำออก หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ภายนอก — _Remove a mistaken self-issued certificate record_ | `B:RemoveExternalWhtCertificateDto` | `→ WhtCertificateHandoffUseCase.removeExternal()` (200) |
| 1006 | GET | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate` | `downloadSystemWhtCertificate` (L538) | any(`wht.certificate.read` \| `wht.certificate.issue` \| `wht.certificate.correct` \| `wht.external_certificate.link`) | ทุกแพ็ก [wht_50bis] | ดาวน์โหลด หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ระบบ | — | `→ IssueWhtCertificateFromHandoffUseCase.download()` |
| 1007 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate` | `issueSystemWhtCertificate` (L545) | `wht.certificate.issue` | ENT [wht_50bis] | ออกเอกสาร หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ระบบ — _Issue a 50 Tawi certificate directly from a settlement/expense WHT handoff_ | `B:IssueWhtCertificateDto = {}` | `→ IssueWhtCertificateFromHandoffUseCase.execute()` (200) |
| 1008 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate/correction` | `correctSystemWhtCertificate` (L558) | `wht.certificate.correct` | ทุกแพ็ก | แก้ไขให้ถูกต้อง หนังสือรับรอง ภาษีหัก ณ ที่จ่าย ระบบ — _Correct a SYSTEM-issued 50 Tawi certificate, superseding it with a new number_ | `B:CorrectWhtCertificateDto` | `→ CorrectWhtCertificateUseCase.execute()` (200) |
| 1009 | POST | `/v1/companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate/replacement-copy` | `issueSystemWhtReplacementCopy` (L575) | `wht.certificate.correct` | ทุกแพ็ก | ออกเอกสาร สำเนา ฉบับแทน ภาษีหัก ณ ที่จ่าย ระบบ — _Reissue an identical, same-numbered copy (ใบแทน) of a SYSTEM-issued 50 Tawi certificate_ | — | `→ IssueWhtReplacementCopyUseCase.execute()` (200) |
| 1010 | GET | `/v1/companies/:companyId/tax/cit-calendar` | `citCalendar` (L586) | `tax.period.read` | ไม่ขาย(thai_tax) | ดู ปฏิทิน ภาษีเงินได้นิติบุคคล — _List CIT PND50/PND51 calendar entries_ | — | `→ GetCitCalendarUseCase.execute()` |
| 1011 | PATCH | `/v1/companies/:companyId/tax/wht-categories/:code` | `setWhtCategoryStatusRoute` (L595) | `tax.config.manage` | ไม่ขาย(thai_tax) | ตั้งค่า เส้นทาง สถานะ หมวดหมู่ ภาษีหัก ณ ที่จ่าย — _Activate or return to draft a WHT income category_ | `B:{ status: string }` | `→ SetWhtIncomeCategoryStatusUseCase.execute()` |
| 1012 | GET | `/v1/companies/:companyId/tax/wht-categories` | `listWhtCategories` (L602) | `tax.config.read` | ไม่ขาย(thai_tax) | ดูรายการ หมวดหมู่ ภาษีหัก ณ ที่จ่าย — _List WHT income categories_ | `Q{status}` | — |

**`TransactionTaxController`** — `apps/api/src/modules/tax/presentation/http/transaction-tax.controller.ts` · base path: `/v1/companies/:companyId/tax` · 28 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1013 | GET | `/v1/companies/:companyId/tax/code-profiles` | `listProfiles` (L52) | `tax.profile.read` | ไม่ขาย(thai_tax) | ดูรายการ โปรไฟล์ (ภาษี ธุรกรรม) — _List effective-dated SAP/WatchDog Tax Code profiles_ | `Q{sourceSystem,status,effectiveDate}` | `→ TransactionTaxConfigUseCase.listProfiles()` |
| 1014 | GET | `/v1/companies/:companyId/tax/code-profile-templates` | `listProfileTemplates` (L60) | `tax.profile.read` | ไม่ขาย(thai_tax) | ดูรายการ แม่แบบ โปรไฟล์ | — | `→ TransactionTaxConfigUseCase.listProfileTemplates()` |
| 1015 | POST | `/v1/companies/:companyId/tax/code-profile-templates/:templateKey` | `createProfileFromTemplate` (L67) | `tax.profile.manage` + `tax.config.manage` | ไม่ขาย(thai_tax) | สร้าง โปรไฟล์ จาก แม่แบบ | `B:CreateTaxProfileFromTemplateDto` | `→ TransactionTaxConfigUseCase.createProfileFromTemplate()` |
| 1016 | POST | `/v1/companies/:companyId/tax/code-profiles` | `createProfile` (L79) | `tax.profile.manage` | ไม่ขาย(thai_tax) | สร้าง โปรไฟล์ (ภาษี ธุรกรรม) | `B:CreateTaxCodeProfileInput` | `→ TransactionTaxConfigUseCase.createProfile()` |
| 1017 | PATCH | `/v1/companies/:companyId/tax/code-profiles/:profileId` | `updateProfile` (L86) | `tax.profile.manage` | ไม่ขาย(thai_tax) | แก้ไข โปรไฟล์ (ภาษี ธุรกรรม) | `B:Partial<CreateTaxCodeProfileInput>` | `→ TransactionTaxConfigUseCase.updateProfile()` |
| 1018 | GET | `/v1/companies/:companyId/tax/code-profiles/:profileId/readiness` | `getProfileReadiness` (L93) | `tax.profile.read` + `tax.config.read` | ไม่ขาย(thai_tax) | ดูข้อมูล ความพร้อม โปรไฟล์ | — | `→ TransactionTaxConfigUseCase.getProfileReadiness()` |
| 1019 | POST | `/v1/companies/:companyId/tax/code-profiles/:profileId/activate` | `activateProfile` (L100) | `tax.profile.manage` | ไม่ขาย(thai_tax) | เปิดใช้งาน โปรไฟล์ (ภาษี ธุรกรรม) | — | `→ TransactionTaxConfigUseCase.activateProfile()` (200) |
| 1020 | POST | `/v1/companies/:companyId/tax/code-profiles/:profileId/retire` | `retireProfile` (L108) | `tax.profile.manage` | ไม่ขาย(thai_tax) | เลิกใช้ โปรไฟล์ (ภาษี ธุรกรรม) | — | `→ TransactionTaxConfigUseCase.retireProfile()` (200) |
| 1021 | POST | `/v1/companies/:companyId/tax/code-profiles/:profileId/import-preview` | `previewProfileImport` (L116) | `tax.config.manage` | ไม่ขาย(thai_tax) | ดูตัวอย่าง การนำเข้า โปรไฟล์ | `B:Omit<TaxCodeImportInput` | `→ TaxCodeImportUseCase.preview()` (200) |
| 1022 | POST | `/v1/companies/:companyId/tax/code-profiles/:profileId/import-apply` | `applyProfileImport` (L124) | `tax.config.manage` | ไม่ขาย(thai_tax) | นำไปใช้ การนำเข้า โปรไฟล์ | `B:Omit<TaxCodeImportInput` | `→ TaxCodeImportUseCase.apply()` (200) |
| 1023 | GET | `/v1/companies/:companyId/tax/code-definitions` | `listDefinitions` (L132) | `company.branch.read` | ทุกแพ็ก [company_settings] | ดูรายการ นิยาม (ภาษี ธุรกรรม) | `Q{profileId,externalCode,direction,transactionContext,status,effectiveDate}` | `→ TransactionTaxConfigUseCase.listDefinitions()` |
| 1024 | POST | `/v1/companies/:companyId/tax/code-definitions` | `upsertDefinition` (L148) | `tax.config.manage` | ไม่ขาย(thai_tax) | สร้างหรือแก้ไข นิยาม (ภาษี ธุรกรรม) | `B:UpsertTaxCodeDefinitionInput` | `→ TransactionTaxConfigUseCase.upsertDefinition()` |
| 1025 | PATCH | `/v1/companies/:companyId/tax/code-definitions/:taxCodeId` | `updateDefinition` (L155) | `tax.config.manage` | ไม่ขาย(thai_tax) | แก้ไข นิยาม (ภาษี ธุรกรรม) | `B:Omit<UpsertTaxCodeDefinitionInput` | `→ TransactionTaxConfigUseCase.upsertDefinition()` |
| 1026 | POST | `/v1/companies/:companyId/tax/resolve-preview` | `resolvePreview` (L162) | `company.branch.read` | ทุกแพ็ก [company_settings] | แก้ไข/ปิดประเด็น ตัวอย่าง (ภาษี ธุรกรรม) | `B:ResolveTransactionTaxPreviewDto` | `→ TransactionTaxConfigUseCase.resolvePreview()` (200) |
| 1027 | POST | `/v1/companies/:companyId/tax/legacy-remediation/preview` | `previewLegacyRemediation` (L170) | `tax.config.manage` + `tax.review_issue.resolve` | ไม่ขาย(thai_tax) | ดูตัวอย่าง การแก้ไข แบบเดิม | `B:LegacyTaxRemediationInput` | `→ TransactionTaxConfigUseCase.previewLegacyRemediation()` (200) |
| 1028 | POST | `/v1/companies/:companyId/tax/legacy-remediation/apply` | `applyLegacyRemediation` (L178) | `tax.config.manage` + `tax.review_issue.resolve` | ไม่ขาย(thai_tax) | นำไปใช้ การแก้ไข แบบเดิม | `B:LegacyTaxRemediationInput` | `→ TransactionTaxConfigUseCase.applyLegacyRemediation()` (200) |
| 1029 | GET | `/v1/companies/:companyId/tax/account-determination` | `listAccountRules` (L186) | `ledger.posting-rule.read` | ไม่ขาย(double_entry_ledger) | ดูรายการ กฎ บัญชี | `Q{taxCodeDefinitionId,transactionContext,direction,status,effectiveDate}` | `→ TransactionTaxConfigUseCase.listAccountRules()` |
| 1030 | PUT | `/v1/companies/:companyId/tax/account-determination` | `upsertAccountRule` (L201) | `tax.config.manage` + `ledger.posting-rule.manage` | ไม่ขาย(double_entry_ledger,thai_tax) | สร้างหรือแก้ไข กฎ บัญชี | `B:UpsertTaxAccountDeterminationRuleInput` | `→ TransactionTaxConfigUseCase.upsertAccountRule()` |
| 1031 | GET | `/v1/companies/:companyId/tax/report-mappings` | `listReportRules` (L208) | `tax.config.read` | ไม่ขาย(thai_tax) | ดูรายการ กฎ รายงาน | `Q{taxCodeDefinitionId,status,effectiveDate}` | `→ TransactionTaxConfigUseCase.listReportRules()` |
| 1032 | PUT | `/v1/companies/:companyId/tax/report-mappings` | `upsertReportRule` (L215) | `tax.config.manage` | ไม่ขาย(thai_tax) | สร้างหรือแก้ไข กฎ รายงาน | `B:UpsertTaxReportMappingRuleInput` | `→ TransactionTaxConfigUseCase.upsertReportRule()` |
| 1033 | GET | `/v1/companies/:companyId/tax/trade-evidence` | `listEvidence` (L222) | `tax.config.read` | ไม่ขาย(thai_tax) | ดูรายการ หลักฐาน (ภาษี ธุรกรรม) | `Q{branchId,transactionContext,status,sourceType,sourceId}` | `→ TransactionTaxConfigUseCase.listEvidence()` |
| 1034 | POST | `/v1/companies/:companyId/tax/trade-evidence` | `createEvidence` (L237) | `company.branch.read` | ทุกแพ็ก [company_settings] | สร้าง หลักฐาน (ภาษี ธุรกรรม) | `B:CreateTradeTaxEvidenceInput` | `→ TransactionTaxConfigUseCase.createEvidence()` |
| 1035 | POST | `/v1/companies/:companyId/tax/trade-evidence/:evidenceId/verify` | `verifyEvidence` (L244) | `tax.config.manage` | ไม่ขาย(thai_tax) | ตรวจยืนยัน หลักฐาน (ภาษี ธุรกรรม) | `B:VerifyTradeTaxEvidenceDto` | `→ TransactionTaxConfigUseCase.verifyEvidence()` (200) |
| 1036 | POST | `/v1/companies/:companyId/tax/reconciliations` | `generateReconciliation` (L252) | `tax.report.recompute` | ไม่ขาย(thai_tax) | สร้าง/ประมวลผล การกระทบยอด (ภาษี ธุรกรรม) | `B:GenerateTaxReconciliationDto` | `→ TransactionTaxReconciliationUseCase.generate()` |
| 1037 | GET | `/v1/companies/:companyId/tax/reconciliations` | `listReconciliations` (L259) | `tax.report.read` | ไม่ขาย(thai_tax) | ดูรายการ การกระทบยอด (ภาษี ธุรกรรม) | `Q{formType,periodKey,branchId,page,pageSize}` | `→ TransactionTaxReconciliationUseCase.list()` |
| 1038 | GET | `/v1/companies/:companyId/tax/reconciliations/:runId` | `getReconciliation` (L274) | `tax.report.read` | ไม่ขาย(thai_tax) | ดูข้อมูล การกระทบยอด (ภาษี ธุรกรรม) | `Q{page,pageSize}` | `→ TransactionTaxReconciliationUseCase.get()` |
| 1039 | POST | `/v1/companies/:companyId/tax/reconciliations/:runId/review` | `reviewReconciliation` (L281) | `tax.review_issue.resolve` | ไม่ขาย(thai_tax) | ตรวจทาน การกระทบยอด (ภาษี ธุรกรรม) | `B:ReviewTaxReconciliationDto` | `→ TransactionTaxReconciliationUseCase.review()` (200) |
| 1040 | GET | `/v1/companies/:companyId/tax/reports/pp30-boxes` | `pp30Boxes` (L290) | `tax.report.read` | ไม่ขาย(thai_tax) | ดู ช่อง ภ.พ.30 | `Q{periodKey,branchId}` | `→ TransactionTaxReconciliationUseCase.pp30Boxes()` |

### 2.31 โมดูล `workflow` — 28 endpoint

**`WorkflowDeadLetterController`** — `apps/api/src/modules/workflow/presentation/http/workflow-dead-letter.controller.ts` · base path: `/v1/companies/:companyId/workflow/dead-letters` · 3 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1041 | GET | `/v1/companies/:companyId/workflow/dead-letters` | `listDeadLetters` (L17) | `workflow.dead_letter.read` | ไม่ขาย(workflow_automation) | ดูรายการ letter dead — _List workflow dead letters_ | `Q{resolutionStatus,ruleId,page,pageSize}` | `→ ListWorkflowDeadLettersUseCase.execute()` |
| 1042 | POST | `/v1/companies/:companyId/workflow/dead-letters/:deadLetterId/replay` | `replay` (L35) | `workflow.dead_letter.replay` | ไม่ขาย(workflow_automation) | เล่นซ้ำ (letter dead เวิร์กโฟลว์) — _Replay a dead letter (re-validates permission/source state/idempotency)_ | — | `→ ReplayWorkflowDeadLetterUseCase.execute()` (200) |
| 1043 | POST | `/v1/companies/:companyId/workflow/dead-letters/:deadLetterId/ignore` | `ignore` (L43) | `workflow.dead_letter.replay` | ไม่ขาย(workflow_automation) | ข้าม/เพิกเฉย (letter dead เวิร์กโฟลว์) — _Ignore a dead letter (requires a resolution note)_ | `B:{ resolutionNote: string }` | `→ IgnoreWorkflowDeadLetterUseCase.execute()` (200) |

**`WorkflowInternalController`** — `apps/api/src/modules/workflow/presentation/http/workflow-internal.controller.ts` · base path: `/v1/internal/workflow` · `@Public()` ระดับ class · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1044 | POST | `/v1/internal/workflow/events/ingest` | `ingest` (L31) | Public — `X-Worker-Token` | แพลตฟอร์ม | นำเข้า (ภายใน เวิร์กโฟลว์) | `B:WorkflowEventEnvelope` | `→ LaunchShadowProbe.startSweep()` |
| 1045 | POST | `/v1/internal/workflow/outbox/drain` | `drain` (L52) | Public — `X-Worker-Token` | แพลตฟอร์ม | ระบายคิวงาน (ภายใน เวิร์กโฟลว์) | `B:{ batchSize?: number }` | `→ DrainWorkflowOutboxUseCase.execute()` |
| 1046 | POST | `/v1/internal/workflow/scan` | `scan` (L58) | Public — `X-Worker-Token` | แพลตฟอร์ม | สแกน/กวาดตรวจ (ภายใน เวิร์กโฟลว์) | `B:{ triggerType: ScanTriggerType }` | `→ RunWorkflowScanUseCase.execute()` |
| 1047 | POST | `/v1/internal/workflow/action-runs/retry` | `retry` (L64) | Public — `X-Worker-Token` | แพลตฟอร์ม | ลองใหม่ (ภายใน เวิร์กโฟลว์) | `B:{ limit?: number }` | `→ RetryDueWorkflowActionsUseCase.execute()` |

**`WorkflowRuleController`** — `apps/api/src/modules/workflow/presentation/http/workflow-rule.controller.ts` · base path: `/v1/companies/:companyId/workflow/rules` · 7 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1048 | GET | `/v1/companies/:companyId/workflow/rules` | `listRules` (L36) | `workflow.rule.read` | ไม่ขาย(workflow_automation) | ดูรายการ กฎ (กฎ เวิร์กโฟลว์) — _List workflow rules_ | `Q{status,triggerType,sourceModule,templateId,search,page,pageSize}` | `→ ListWorkflowRulesUseCase.execute()` |
| 1049 | POST | `/v1/companies/:companyId/workflow/rules` | `createRule` (L57) | `workflow.rule.manage` | ไม่ขาย(workflow_automation) | สร้าง กฎ (เวิร์กโฟลว์) — _Create a draft workflow rule_ | `B:CreateWorkflowRuleInput` | `→ CreateWorkflowRuleUseCase.execute()` |
| 1050 | GET | `/v1/companies/:companyId/workflow/rules/:ruleId` | `getOne` (L64) | `workflow.rule.read` | ไม่ขาย(workflow_automation) | ดูข้อมูล (กฎ เวิร์กโฟลว์) — _Get workflow rule detail_ | — | `→ GetWorkflowRuleUseCase.execute()` |
| 1051 | PATCH | `/v1/companies/:companyId/workflow/rules/:ruleId` | `updateRule` (L71) | `workflow.rule.manage` | ไม่ขาย(workflow_automation) | แก้ไข กฎ (เวิร์กโฟลว์) — _Edit a draft/disabled workflow rule_ | `B:UpdateWorkflowRuleInput` | `→ UpdateWorkflowRuleUseCase.execute()` |
| 1052 | POST | `/v1/companies/:companyId/workflow/rules/:ruleId/enable` | `enable` (L78) | `workflow.rule.enable` | ไม่ขาย(workflow_automation) | เปิดใช้งาน (กฎ เวิร์กโฟลว์) — _Enable a workflow rule (creates immutable version)_ | — | `→ EnableWorkflowRuleUseCase.execute()` (200) |
| 1053 | POST | `/v1/companies/:companyId/workflow/rules/:ruleId/disable` | `disable` (L86) | `workflow.rule.manage` | ไม่ขาย(workflow_automation) | ปิดใช้งาน (กฎ เวิร์กโฟลว์) — _Disable a workflow rule (stops future runs)_ | — | `→ DisableWorkflowRuleUseCase.execute()` (200) |
| 1054 | POST | `/v1/companies/:companyId/workflow/rules/:ruleId/test` | `test` (L94) | `workflow.rule.manage` | ไม่ขาย(workflow_automation) | ทดสอบ (กฎ เวิร์กโฟลว์) — _Evaluate condition/action plan against a sample payload (no side effects)_ | `B:{ samplePayload?: Record<string` | `→ TestWorkflowRuleUseCase.execute()` (200) |

**`WorkflowRunController`** — `apps/api/src/modules/workflow/presentation/http/workflow-run.controller.ts` · base path: `/v1/companies/:companyId/workflow` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1055 | GET | `/v1/companies/:companyId/workflow/runs` | `listRuns` (L18) | `workflow.run.read` | ไม่ขาย(workflow_automation) | ดูรายการ รอบการทำงาน (รอบการทำงาน เวิร์กโฟลว์) — _List workflow runs_ | `Q{ruleId,status,sourceModule,from,to,page,pageSize}` | `→ ListWorkflowRunsUseCase.execute()` |
| 1056 | GET | `/v1/companies/:companyId/workflow/runs/:runId` | `getRun` (L39) | `workflow.run.read` | ไม่ขาย(workflow_automation) | ดูข้อมูล รอบการทำงาน (เวิร์กโฟลว์) — _Get workflow run detail (rule version snapshot, condition result, action runs)_ | — | `→ GetWorkflowRunDetailUseCase.execute()` |
| 1057 | GET | `/v1/companies/:companyId/workflow/explanations/:runId` | `explainRun` (L46) | `workflow.run.read` | ไม่ขาย(workflow_automation) | อธิบาย รอบการทำงาน (เวิร์กโฟลว์) — _Human-readable explanation of why a run fired_ | — | `→ GetWorkflowExplanationUseCase.execute()` |
| 1058 | POST | `/v1/companies/:companyId/workflow/action-runs/:actionRunId/replay` | `replayActionRun` (L53) | `workflow.run.replay` | ไม่ขาย(workflow_automation) | เล่นซ้ำ รอบการทำงาน การดำเนินการ — _Replay a failed workflow action run_ | — | `→ ReplayWorkflowActionRunUseCase.execute()` (200) |

**`WorkflowTaskController`** — `apps/api/src/modules/workflow/presentation/http/workflow-task.controller.ts` · base path: `/v1/companies/:companyId/workflow/tasks` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1059 | GET | `/v1/companies/:companyId/workflow/tasks` | `listTasks` (L18) | `workflow.task.read` | ไม่ขาย(workflow_automation) | ดูรายการ งาน (งาน เวิร์กโฟลว์) — _List workflow tasks_ | `Q{scope,status,priority,sourceModule,page,pageSize}` | `→ ListWorkflowTasksUseCase.execute()` |
| 1060 | POST | `/v1/companies/:companyId/workflow/tasks/:taskId/snooze` | `snooze` (L38) | `workflow.task.work` | ไม่ขาย(workflow_automation) | เลื่อนเวลา (งาน เวิร์กโฟลว์) — _Snooze a workflow task_ | `B:{ snoozedUntil: string }` | `→ SnoozeWorkflowTaskUseCase.execute()` (200) |
| 1061 | POST | `/v1/companies/:companyId/workflow/tasks/:taskId/complete` | `complete` (L46) | `workflow.task.work` | ไม่ขาย(workflow_automation) | ยืนยันเสร็จสิ้น (งาน เวิร์กโฟลว์) — _Complete a workflow task (does not close the source record)_ | — | `→ CompleteWorkflowTaskUseCase.execute()` (200) |
| 1062 | POST | `/v1/companies/:companyId/workflow/tasks/:taskId/cancel` | `cancel` (L54) | `workflow.task.work` | ไม่ขาย(workflow_automation) | ยกเลิก (งาน เวิร์กโฟลว์) — _Cancel a workflow task_ | `B:{ reason?: string }` | `→ CancelWorkflowTaskUseCase.execute()` (200) |

**`WorkflowTemplateController`** — `apps/api/src/modules/workflow/presentation/http/workflow-template.controller.ts` · base path: `/v1/companies/:companyId/workflow/templates` · 2 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1063 | GET | `/v1/companies/:companyId/workflow/templates` | `listTemplates` (L16) | `workflow.template.read` | ไม่ขาย(workflow_automation) | ดูรายการ แม่แบบ (แม่แบบ เวิร์กโฟลว์) — _List workflow templates (available and unavailable)_ | — | `→ ListWorkflowTemplatesUseCase.execute()` |
| 1064 | POST | `/v1/companies/:companyId/workflow/templates/:templateKey/enable` | `enable` (L23) | `workflow.rule.manage` + `workflow.rule.enable` | ไม่ขาย(workflow_automation) | เปิดใช้งาน (แม่แบบ เวิร์กโฟลว์) — _Create a rule from a template (draft or enabled)_ | `B:EnableWorkflowTemplateInput` | `→ EnableWorkflowTemplateUseCase.execute()` (200) |

**`WorkflowWebhookController`** — `apps/api/src/modules/workflow/presentation/http/workflow-webhook.controller.ts` · base path: `/v1/companies/:companyId/workflow/webhooks` · 4 endpoint

| # | Method | Path | Handler | สิทธิ์ | Feature gate / แพ็ก | วัตถุประสงค์ | Request | Response |
|---:|---|---|---|---|---|---|---|---|
| 1065 | GET | `/v1/companies/:companyId/workflow/webhooks` | `listEndpoints` (L17) | `workflow.webhook.manage` | ไม่ขาย(workflow_automation) | ดูรายการ endpoint (webhook เวิร์กโฟลว์) — _List workflow webhook endpoints (secrets never returned)_ | — | `→ ListWorkflowWebhookEndpointsUseCase.execute()` |
| 1066 | POST | `/v1/companies/:companyId/workflow/webhooks` | `createEndpoint` (L24) | `workflow.webhook.manage` | ไม่ขาย(workflow_automation) | สร้าง endpoint (webhook เวิร์กโฟลว์) — _Create a webhook endpoint (created disabled by default)_ | `B:UpsertWorkflowWebhookEndpointInput` | `→ CreateWorkflowWebhookEndpointUseCase.execute()` |
| 1067 | POST | `/v1/companies/:companyId/workflow/webhooks/:endpointId/enable` | `enable` (L31) | `workflow.webhook.manage` | ไม่ขาย(workflow_automation) | เปิดใช้งาน (webhook เวิร์กโฟลว์) — _Enable a webhook endpoint_ | — | `→ SetWorkflowWebhookEndpointStatusUseCase.execute()` (200) |
| 1068 | POST | `/v1/companies/:companyId/workflow/webhooks/:endpointId/disable` | `disable` (L39) | `workflow.webhook.manage` | ไม่ขาย(workflow_automation) | ปิดใช้งาน (webhook เวิร์กโฟลว์) — _Disable a webhook endpoint_ | — | `→ SetWorkflowWebhookEndpointStatusUseCase.execute()` (200) |

**ผลการตรวจความครบถ้วนของหมวด 2:** สคริปต์พบ 1068 handler ใน 131 ไฟล์ controller (152 controller class ที่มี route) ทุก handler มี `@Public()` หรือ permission metadata (ไม่มี route ที่จะถูก `DenyByDefaultGuard` ปฏิเสธเพราะขาด metadata)

---

## 3. Endpoint สาธารณะ/ไม่ต้องล็อกอิน, webhook และ endpoint ภายใน

ทุก route ในหมวดนี้ติด `@Public()` จึงข้ามการตรวจ session/permission ของ `AuthGuard`/`DenyByDefaultGuard` ความปลอดภัยขึ้นกับกลไกในคอลัมน์ "กลไกตรวจสอบ" ซึ่งสกัดจากเนื้อ handler (เรียก `assertWorkerToken`, `assertInternalSecret`, ตรวจลายเซ็น, ตรวจ LINE ID token หรือ rate limit) แถวที่ระบุ "ไม่มีใน handler" หมายถึง handler ส่งต่อให้ use case ตรวจเอง (เช่น token แบบใช้ครั้งเดียวใน body) หรือเป็นข้อมูลสาธารณะจริง ดูหมายเหตุท้ายตาราง

### 3.1 Endpoint สาธารณะและ webhook (เรียกจากภายนอก) — 60 endpoint

| # | Method | Path | Controller.handler | กลไกตรวจสอบ (จาก handler) | วัตถุประสงค์ |
|---:|---|---|---|---|---|
| 1 | GET | `/v1/auth/login-channels` | `AuthController.loginChannels` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | เข้าสู่ระบบ ช่องทาง (auth) — _Discover configured login channels; unavailable channels fail closed_ |
| 2 | POST | `/v1/auth/password/login` | `AuthController.passwordLoginWithCredentials` | rate limit: `assertPasswordLoginAllowed` | ดำเนินการ การเข้าสู่ระบบ รหัสผ่าน พร้อม ข้อมูลรับรอง — _Sign in with an admin-created username and password_ |
| 3 | POST | `/v1/auth/password/reset-request` | `AuthController.requestPasswordResetNotice` | rate limit: `assertPasswordResetRequestAllowed` | ร้องขอ ประกาศ การรีเซ็ต รหัสผ่าน — _Send a one-time recovery password to the account's linked LINE identity_ |
| 4 | POST | `/v1/auth/dev/token` | `AuthController.devToken` | ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | ดำเนินการ token dev — _Issue dev token (local only)_ |
| 5 | POST | `/v1/auth/line/exchange` | `AuthController.lineExchange` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดำเนินการ การแลก token LINE — _Exchange LINE Login ID token for WatchDog access token_ |
| 6 | POST | `/v1/auth/line/login/callback` | `AuthController.lineLoginCallback` | rate limit: `assertLineLoginCallbackAllowed` | ดำเนินการ callback การเข้าสู่ระบบ LINE — _Complete LINE web login: exchange OAuth code, verify ID token, issue first-party tokens_ |
| 7 | POST | `/v1/auth/line/qr/create` | `AuthController.lineQrCreate` | rate limit: `assertLineQrCreateAllowed` | ดำเนินการ การสร้าง QR LINE — _Mint a desktop QR login transaction; returns the QR and the browser-bound secret_ |
| 8 | POST | `/v1/auth/line/qr/redeem` | `AuthController.lineQrRedeem` | rate limit: `assertLineQrPollAllowed` | ดำเนินการ การแลกใช้ QR LINE — _Poll a desktop QR transaction; issues first-party tokens once approved_ |
| 9 | POST | `/v1/auth/line/handoff/exchange` | `AuthController.lineHandoffExchange` | rate limit: `assertLineHandoffExchangeAllowed` | ดำเนินการ การแลก token การส่งต่อ LINE — _Exchange a single-use LINE deep-link handoff token for a first-party session_ |
| 10 | GET | `/v1/auth/line/link-page` | `AuthController.lineLinkPage` | ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | ดู หน้า ลิงก์/การผูก LINE — _Local LIFF account-link page_ |
| 11 | GET | `/v1/auth/line/link-page.js` | `AuthController.lineLinkPageScript` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู สคริปต์ หน้า ลิงก์/การผูก LINE — _Static same-origin LIFF account-link client_ |
| 12 | GET | `/v1/auth/line/link-page/package-advisor`<br>`/v1/auth/line/package-advisor-page` | `AuthController.linePackageAdvisorPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า ที่ปรึกษา แพ็กเกจ LINE — _Read-only LIFF package advisor using the public catalog_ |
| 13 | GET | `/v1/auth/line/package-advisor.js` | `AuthController.linePackageAdvisorScript` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู สคริปต์ ที่ปรึกษา แพ็กเกจ LINE |
| 14 | GET | `/v1/auth/line/link-page/signup`<br>`/v1/auth/line/signup-page` | `AuthController.lineSignupPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า การสมัคร LINE — _LIFF signup page for a LINE-first company application (P10-L §3.2)_ |
| 15 | GET | `/v1/auth/line/link-page/start`<br>`/v1/auth/line/start-page` | `AuthController.lineStartPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า การเริ่ม LINE — _LIFF start page: exchange a LINE identity for a web session (P10-L §3.5)_ |
| 16 | GET | `/v1/auth/line/link-page/event-discount` | `AuthController.lineEventDiscountPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า ส่วนลด เหตุการณ์ LINE — _LIFF page: claim a sales-event discount after scanning a booth QR (sales-event spec §3.3)_ |
| 17 | POST | `/v1/auth/line/liff/session` | `AuthController.lineLiffSession` | LINE ID token (ตรวจใน use case) | ดำเนินการ เซสชัน LIFF LINE — _Exchange a LIFF ID token for a one-time web handoff URL (P10-L §3.5)_ |
| 18 | GET | `/v1/auth/line/link-page/employee`<br>`/v1/auth/line/employee-link-page` | `AuthController.employeeLineLinkPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า ลิงก์/การผูก LINE พนักงาน — _Employee-specific LIFF account-link page (no prior WatchDog session required)_ |
| 19 | POST | `/v1/auth/line/employee-link` | `AuthController.employeeLineLink` | LINE ID token (ตรวจใน use case) | ดำเนินการ ลิงก์/การผูก LINE พนักงาน — _Complete employee LINE account link using a short-lived link token_ |
| 20 | POST | `/v1/auth/account/email/verify` | `AuthController.verifyAccountEmail` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ตรวจยืนยัน อีเมล บัญชี — _Confirm a pending email verification token_ |
| 21 | POST | `/v1/auth/session/refresh` | `AuthController.refresh` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | รีเฟรช (auth) — _Refresh access token using refresh token_ |
| 22 | POST | `/v1/auth/password/email-reset-request` | `EmailPasswordResetController.request` | rate limit: `assertPasswordResetRequestAllowed` | ร้องขอ (การรีเซ็ต รหัสผ่าน อีเมล) |
| 23 | POST | `/v1/auth/password/email-reset-confirm` | `EmailPasswordResetController.confirm` | rate limit: `assertPasswordResetConfirmAllowed` | ยืนยัน (การรีเซ็ต รหัสผ่าน อีเมล) |
| 24 | POST | `/v1/line/official/webhook` | `LineOfficialWebhookController.webhook` | `x-line-signature` (HMAC-SHA256 ของ raw body) | ดำเนินการ webhook (OA ทางการ LINE) |
| 25 | POST | `/v1/line/webhook` | `LineWebhookController.lineWebhook` | `x-line-signature` (HMAC-SHA256 ของ raw body) | ดำเนินการ webhook LINE — _LINE Messaging API webhook receiver_ |
| 26 | POST | `/v1/webhooks/line` | `LineWebhookController.legacyLineWebhook` | `x-line-signature` (HMAC-SHA256 ของ raw body) | ดำเนินการ webhook LINE แบบเดิม — _LINE Messaging API webhook receiver (legacy path)_ |
| 27 | GET | `/v1/auth/platform-access` | `PublicPlatformAccessController.status` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู สถานะ (การเข้าถึง แพลตฟอร์ม สาธารณะ) |
| 28 | POST | `/v1/public/postmark-events` | `PostmarkEventsController.receive` | `Authorization` Basic (Postmark) | รับ (เหตุการณ์ Postmark) |
| 29 | GET | `/v1/billing/catalog` | `BillingCatalogController.catalog` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู แค็ตตาล็อก (การเรียกเก็บเงิน) |
| 30 | POST | `/v1/public/stripe-events` | `StripeEventsController.receive` | `Stripe-Signature` (ตรวจกับ raw body) | รับ (เหตุการณ์ Stripe) |
| 31 | POST | `/v1/crm-customer/pdpa/consent-withdraw` | `CrmCustomerPdpaController.consentWithdraw` | rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | ดำเนินการ การถอน ความยินยอม — _Customer LINE LIFF self-service consent withdrawal_ |
| 32 | POST | `/v1/crm-customer/pdpa/data-export` | `CrmCustomerPdpaController.dataExport` | rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | ดำเนินการ การส่งออก ข้อมูล — _Customer LINE LIFF self-service data export_ |
| 33 | POST | `/v1/crm-customer/pdpa/erasure-request` | `CrmCustomerPdpaController.erasureRequest` | rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | ดำเนินการ คำขอ การลบข้อมูลส่วนบุคคล — _Customer LINE LIFF self-service erasure request_ |
| 34 | POST | `/v1/crm-customer/pdpa/erasure-status` | `CrmCustomerPdpaController.erasureStatus` | rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | ดำเนินการ สถานะ การลบข้อมูลส่วนบุคคล — _Customer LINE LIFF self-service erasure request status_ |
| 35 | POST | `/v1/crm/line/webhook/:webhookKey` | `CrmLineWebhookController.receive` | `x-line-signature` (HMAC-SHA256 ของ raw body) | รับ (webhook LINE CRM) — _Company LINE OA webhook receiver (per-channel key)_ |
| 36 | POST | `/v1/auth/line/customer-register` | `CustomerLineRegisterController.customerRegister` | rate limit: `assertCustomerRegisterAllowed`; LINE ID token (ตรวจใน use case) | ดำเนินการ ทะเบียน ลูกค้า — _Customer LINE LIFF self-registration_ |
| 37 | GET | `/v1/auth/line/customer-register-page` | `CustomerLineRegisterController.customerRegisterPage` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู หน้า ทะเบียน ลูกค้า — _Customer LINE LIFF self-registration page_ |
| 38 | PUT | `/local-storage/upload/:token` | `LocalStorageController.upload` | ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | อัปโหลด (ที่เก็บไฟล์ local) |
| 39 | GET | `/local-storage/download/:token` | `LocalStorageController.download` | ใช้ได้เฉพาะ `APP_ENV=local` (อื่น ๆ ตอบ 404) | ดาวน์โหลด (ที่เก็บไฟล์ local) |
| 40 | GET | `/v1/public/company-signups/availability` | `PublicCompanySignupController.availability` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดู ความพร้อมใช้ (การสมัคร บริษัท สาธารณะ) — _Whether public self-service signup is open_ |
| 41 | POST | `/v1/public/company-signups` | `PublicCompanySignupController.create` | rate limit: `assertPublicSignupAllowed` | สร้าง (การสมัคร บริษัท สาธารณะ) — _Submit a public company signup application_ |
| 42 | GET | `/v1/public/company-signups/:requestId` | `PublicCompanySignupController.readStatus` | rate limit: `assertPublicSignupReadAllowed` | อ่าน สถานะ (การสมัคร บริษัท สาธารณะ) — _Coarse public status of an application_ |
| 43 | POST | `/v1/public/company-signups/:requestId/resend-claim` | `PublicCompanySignupController.resendClaim` | rate limit: `assertPublicSignupResendAllowed` | ส่งซ้ำ ใบเบิก/claim (การสมัคร บริษัท สาธารณะ) — _Ask for a fresh claim email_ |
| 44 | POST | `/v1/public/signup-claims/info` | `PublicCompanySignupController.claimInfo` | rate limit: `assertPublicSignupReadAllowed` | รับสิทธิ์/จอง ข้อมูล (การสมัคร บริษัท สาธารณะ) — _Claim link details; identical empty answer for expired/used/unknown_ |
| 45 | POST | `/v1/public/signup-claims/set-password` | `PublicCompanySignupController.setPassword` | rate limit: `assertSignupClaimSubmitAllowed` | ตั้งค่า รหัสผ่าน (การสมัคร บริษัท สาธารณะ) — _Claim: set a password for a new account, then provision_ |
| 46 | POST | `/v1/public/signup-claims/attach` | `PublicCompanySignupController.attach` | rate limit: `assertPasswordLoginAllowed`, `assertSignupClaimSubmitAllowed` | แนบ (การสมัคร บริษัท สาธารณะ) — _Claim: attach the new company to an existing account, then provision_ |
| 47 | POST | `/v1/public/email-access/request` | `PublicEmailAccessController.request` | rate limit: `assertEmailAccessAllowed` | ร้องขอ (การเข้าถึง อีเมล สาธารณะ) |
| 48 | POST | `/v1/public/email-access/confirm` | `PublicEmailAccessController.confirm` | rate limit: `assertEmailAccessAllowed` | ยืนยัน (การเข้าถึง อีเมล สาธารณะ) |
| 49 | POST | `/v1/public/email-access/signup` | `PublicEmailAccessController.create` | rate limit: `assertEmailAccessAllowed` | สร้าง (การเข้าถึง อีเมล สาธารณะ) |
| 50 | POST | `/v1/public/email-access/status` | `PublicEmailAccessController.status` | rate limit: `assertEmailAccessAllowed` | ดำเนินการ สถานะ (การเข้าถึง อีเมล สาธารณะ) |
| 51 | POST | `/v1/public/line-signups` | `PublicLineSignupController.create` | rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | สร้าง (การสมัคร LINE สาธารณะ) — _Submit a LINE-first company signup from the LIFF form_ |
| 52 | POST | `/v1/public/line-signups/support` | `PublicLineSignupController.requestSupport` | rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | ร้องขอ ซัพพอร์ต (การสมัคร LINE สาธารณะ) — _Request signup help in the support inbox using verified LINE identity_ |
| 53 | PATCH | `/v1/public/line-signups/:requestId/contact-email` | `PublicLineSignupController.correctContactEmail` | rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | แก้ไขให้ถูกต้อง อีเมล ข้อมูลติดต่อ — _Correct one token-owned pending LINE signup contact and resume intake_ |
| 54 | POST | `/v1/public/line-signups/:requestId/retry` | `PublicLineSignupController.retryIntake` | rate limit: `assertLineSignupIpAllowed`; LINE ID token (ตรวจใน use case) | ลองใหม่ การรับเข้า (การสมัคร LINE สาธารณะ) — _Resume one token-owned committed LINE signup intake_ |
| 55 | GET | `/v1/public/line-signups/me` | `PublicLineSignupController.readStatus` | `x-line-id-token`; rate limit: `assertLineSignupReadAllowed`; LINE ID token (ตรวจใน use case) | อ่าน สถานะ (การสมัคร LINE สาธารณะ) — _The latest application belonging to the LINE account this token proves_ |
| 56 | POST | `/v1/public/ses-events` | `PublicSesEventsController.receive` | ลายเซ็น SNS + Topic ARN; rate limit: `assertSesEventsAllowed` | รับ (เหตุการณ์ SES สาธารณะ) — _Amazon SNS endpoint for SES bounce/complaint events_ |
| 57 | GET | `/v1/health` | `HealthController.getHealth` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดูข้อมูล สุขภาพระบบ |
| 58 | GET | `/v1/public/home-theme` | `PublicHomeThemeController.get` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | ดูข้อมูล (ธีม หน้าแรก สาธารณะ) |
| 59 | POST | `/v1/public/event-discounts/claim` | `PublicEventDiscountsController.claim` | LINE ID token (ตรวจใน use case) | รับสิทธิ์/จอง (ส่วนลด เหตุการณ์ สาธารณะ) — _Claim a sales-event discount with a LIFF ID token and a booth QR token_ |
| 60 | POST | `/v1/auth/demo/open` | `DemoAuthController.open` | ไม่มีใน handler (ตรวจใน use case / ข้อมูลสาธารณะ) | เปิด (auth เดโม) |

### 3.2 Endpoint ภายใน `/v1/internal/*` (service-to-service) — 52 endpoint

| # | Method | Path | Controller.handler | กลไกตรวจสอบ (จาก handler) | วัตถุประสงค์ |
|---:|---|---|---|---|---|
| 1 | POST | `/v1/internal/ai/draft-requests/drain` | `AiDraftInternalController.drainQueued` | `X-Worker-Token` | ระบายคิวงาน queued (ภายใน ร่าง AI) |
| 2 | POST | `/v1/internal/ai/draft-requests/generate` | `AiDraftInternalController.generateOne` | `X-Worker-Token` | สร้าง/ประมวลผล (ภายใน ร่าง AI) |
| 3 | POST | `/v1/internal/billing/provider-scans/drain` | `BillingInternalController.drainProviderScans` | `X-Worker-Token` | ระบายคิวงาน ผลสแกน ผู้ให้บริการ |
| 4 | POST | `/v1/internal/billing/drain` | `BillingInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน การเรียกเก็บเงิน) |
| 5 | POST | `/v1/internal/billing/notifications/drain` | `BillingInternalController.drainNotifications` | `X-Worker-Token` | ระบายคิวงาน การแจ้งเตือน (ภายใน การเรียกเก็บเงิน) |
| 6 | POST | `/v1/internal/billing/scan` | `BillingInternalController.scan` | `X-Worker-Token` | สแกน/กวาดตรวจ (ภายใน การเรียกเก็บเงิน) |
| 7 | POST | `/v1/internal/crm/trust-score-scan` | `CrmAiInternalController.trustScoreScan` | `X-Worker-Token` | กำหนดความเชื่อถือ การสแกน คะแนน |
| 8 | POST | `/v1/internal/crm/campaign-delivery-scan` | `CrmInternalController.campaignDelivery` | `X-Worker-Token` | ดำเนินการ การนำส่ง แคมเปญ |
| 9 | POST | `/v1/internal/crm/sla-breach-scan` | `CrmInternalController.slaBreachScan` | `X-Worker-Token` | ดำเนินการ การสแกน การผิด SLA SLA |
| 10 | POST | `/v1/internal/crm/new-conversation-scan` | `CrmInternalController.newConversationScan` | `X-Worker-Token` | ดำเนินการ การสแกน บทสนทนา ใหม่ |
| 11 | POST | `/v1/internal/crm/inbox-retry-scan` | `CrmInternalController.inboxRetryScan` | `X-Worker-Token` | ดำเนินการ การสแกน การลองใหม่ กล่องข้อความ |
| 12 | POST | `/v1/internal/crm/autonomy-retry-scan` | `CrmInternalController.autonomyRetryScan` | `X-Worker-Token` | ดำเนินการ การสแกน การลองใหม่ ระดับอัตโนมัติ |
| 13 | POST | `/v1/internal/crm/booking-reminder-scan` | `CrmInternalController.bookingReminderScan` | `X-Worker-Token` | ดำเนินการ การสแกน การเตือน การจอง |
| 14 | POST | `/v1/internal/crm/booking-proposal-sweep` | `CrmInternalController.bookingProposalSweep` | `X-Worker-Token` | ดำเนินการ การกวาดตรวจ ข้อเสนอ การจอง |
| 15 | POST | `/v1/internal/crm/pdpa-purge` | `CrmInternalController.pdpaPurge` | `X-Worker-Token` | ดำเนินการ การล้างข้อมูล PDPA |
| 16 | POST | `/v1/internal/crm/pdpa-erasure-process` | `CrmInternalController.pdpaErasureProcess` | `X-Worker-Token` | ดำเนินการ การประมวลผล การลบข้อมูลส่วนบุคคล PDPA |
| 17 | POST | `/v1/internal/crm/pdpa-post-restore-re-erasure` | `CrmInternalController.pdpaPostRestoreReErasure` | `X-Worker-Token` | ดำเนินการ การลบข้อมูลส่วนบุคคล re การกู้คืน การลงบัญชี PDPA |
| 18 | POST | `/v1/internal/notifications/delivery-sweep` | `InternalNotificationSweepController.deliverySweep` | `X-Worker-Token` | ดำเนินการ การกวาดตรวจ การนำส่ง |
| 19 | POST | `/v1/internal/notifications/snapshot-sweep` | `InternalNotificationSweepController.generateSnapshots` | `X-Worker-Token` | สร้าง/ประมวลผล สแนปช็อต (การกวาดตรวจ การแจ้งเตือน ภายใน) |
| 20 | POST | `/v1/internal/notifications/stock-low-sweep` | `InternalNotificationSweepController.scanStockLow` | `X-Worker-Token` | สแกน/กวาดตรวจ ต่ำ สต๊อก |
| 21 | POST | `/v1/internal/notifications/daily-owner-summary-sweep` | `InternalNotificationSweepController.createDailySummaries` | `X-Worker-Token` | สร้าง สรุป รายวัน |
| 22 | POST | `/v1/internal/companies/:companyId/dashboard/snapshots/generate` | `InternalNotificationController.handleGenerateSnapshot` | `X-Worker-Token` | จัดการ สแนปช็อต การสร้าง |
| 23 | POST | `/v1/internal/companies/:companyId/notifications/scan/stock-low` | `InternalNotificationController.stockLow` | `X-Worker-Token` | ดำเนินการ ต่ำ สต๊อก |
| 24 | POST | `/v1/internal/companies/:companyId/notifications/daily-owner-summary` | `InternalNotificationController.dailySummary` | `X-Worker-Token` | ดำเนินการ สรุป รายวัน |
| 25 | POST | `/v1/internal/companies/:companyId/notification-deliveries/:deliveryId/process` | `InternalNotificationController.delivery` | `X-Worker-Token` | ดำเนินการ การนำส่ง (การแจ้งเตือน ภายใน) |
| 26 | POST | `/v1/internal/storage-cleanup/object-versions/claim` | `ObjectVersionCleanupInternalController.claim` | `X-Worker-Token` | รับสิทธิ์/จอง (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) |
| 27 | POST | `/v1/internal/storage-cleanup/object-versions/:id/complete` | `ObjectVersionCleanupInternalController.complete` | `X-Worker-Token` | ยืนยันเสร็จสิ้น (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) |
| 28 | POST | `/v1/internal/storage-cleanup/object-versions/:id/fail` | `ObjectVersionCleanupInternalController.fail` | `X-Worker-Token` | บันทึกว่าล้มเหลว (ภายใน การล้าง เวอร์ชัน ออบเจ็กต์) |
| 29 | POST | `/v1/internal/executive/rebuild` | `ExecutiveInternalController.rebuild` | `X-Worker-Token` | สร้างใหม่ทั้งชุด (ภายใน ผู้บริหาร) — _Build the executive report summary tables: every hour the recent months, once a day every month (idempotent)_ |
| 30 | POST | `/v1/internal/expenses/capture-read/drain` | `ExpenseCaptureReadInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน การอ่าน การจับภาพเอกสาร รายจ่าย) |
| 31 | POST | `/v1/internal/signup-claim-email/drain` | `SignupClaimEmailInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน อีเมล ใบเบิก/claim การสมัคร) |
| 32 | POST | `/v1/internal/signup-claim-email/reminder-sweep` | `SignupClaimEmailInternalController.reminderSweep` | `X-Worker-Token` | ดำเนินการ การกวาดตรวจ การเตือน |
| 33 | POST | `/v1/internal/feature-launch/runoff/sweep` | `RunoffInternalController.sweep` | `X-Worker-Token` | กวาดตรวจตามรอบ (ภายใน runoff) |
| 34 | POST | `/v1/internal/feature-launch/runoff/draining` | `RunoffInternalController.draining` | `X-Worker-Token` | ดำเนินการ สถานะระบายคิว (ภายใน runoff) |
| 35 | GET | `/v1/internal/health/readiness` | `HealthInternalController.readiness` | `X-Worker-Token` | ดู ความพร้อม (ภายใน สุขภาพระบบ) |
| 36 | POST | `/v1/internal/ledger/expense-auto-post/drain` | `ExpenseAutoPostInternalController.execute` | `X-Worker-Token` | ดำเนินการ (ภายใน การลงบัญชี อัตโนมัติ รายจ่าย) |
| 37 | POST | `/v1/internal/ai/budget-step` | `InternalAiBudgetController.budgetStep` | `X-Internal-Secret` | ดำเนินการ ขั้นตอน งบประมาณ — _Reserve the next provider invocation of an existing attempt_ |
| 38 | POST | `/v1/internal/ai/budget-settle` | `InternalAiBudgetController.budgetSettle` | `X-Internal-Secret` | ดำเนินการ การชำระ งบประมาณ — _Settle one provider invocation from its usage evidence_ |
| 39 | POST | `/v1/internal/ai/tools/invoke` | `InternalToolsController.invoke` | `X-Internal-Secret`; `X-Actor-Delegation` | เรียกใช้ (เครื่องมือ ภายใน) — _Internal: invoke a read-only ERP tool (AI Gateway only)_ |
| 40 | POST | `/v1/internal/ai/line-ledger/drain` | `LineAiLedgerInternalController.drainLedger` | `X-Worker-Token` | ระบายคิวงาน บัญชีแยกประเภท (ภายใน AI LINE) |
| 41 | POST | `/v1/internal/ai/line-ledger/sweep-orphan-events` | `LineAiLedgerInternalController.sweepOrphanEvents` | `X-Worker-Token` | กวาดตรวจตามรอบ เหตุการณ์ ที่ค้างไร้เจ้าของ |
| 42 | POST | `/v1/internal/ai/line-capture-results/drain` | `LineCaptureResultsInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน ผลลัพธ์ การจับภาพเอกสาร LINE) |
| 43 | POST | `/v1/internal/ai/line-document-qa/drain` | `LineDocumentQaInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน ถาม-ตอบ เอกสาร LINE) |
| 44 | POST | `/v1/internal/reimbursements/reconcile` | `ReimbursementReconcileInternalController.execute` | `X-Worker-Token` | ดำเนินการ (ภายใน การกระทบยอด การเบิกคืน) |
| 45 | POST | `/v1/internal/sales/deals/expire-sweep` | `SalesInternalController.expireSweep` | `X-Worker-Token` | ทำให้หมดอายุ การกวาดตรวจ (ภายใน งานขาย) — _Close APPROVED deals past their 3-day window (idempotent)_ |
| 46 | POST | `/v1/internal/sales/deals/renewal-sweep` | `SalesInternalController.renewalSweep` | `X-Worker-Token` | ดำเนินการ การกวาดตรวจ การต่ออายุ — _D3: write the next round as PENDING_APPROVAL 14 days out, chase it at 7_ |
| 47 | POST | `/v1/internal/sales/daily-digest` | `SalesInternalController.dailyDigest` | `X-Worker-Token` | ดำเนินการ สรุปประจำวัน รายวัน — _§17.2: yesterday in one SYSTEM_ADMIN console notice (07:00 Bangkok)_ |
| 48 | POST | `/v1/internal/plan-term/sweep` | `PlanTermInternalController.execute` | `X-Worker-Token` | ดำเนินการ (ภายใน อายุแพ็ก แพ็ก/แผน) |
| 49 | POST | `/v1/internal/workflow/events/ingest` | `WorkflowInternalController.ingest` | `X-Worker-Token` | นำเข้า (ภายใน เวิร์กโฟลว์) |
| 50 | POST | `/v1/internal/workflow/outbox/drain` | `WorkflowInternalController.drain` | `X-Worker-Token` | ระบายคิวงาน (ภายใน เวิร์กโฟลว์) |
| 51 | POST | `/v1/internal/workflow/scan` | `WorkflowInternalController.scan` | `X-Worker-Token` | สแกน/กวาดตรวจ (ภายใน เวิร์กโฟลว์) |
| 52 | POST | `/v1/internal/workflow/action-runs/retry` | `WorkflowInternalController.retry` | `X-Worker-Token` | ลองใหม่ (ภายใน เวิร์กโฟลว์) |


<!-- GENERATED-INVENTORY-END -->

### 3.3 หมายเหตุกลไกตรวจสอบของ endpoint สาธารณะ (อ่านจากโค้ดเพิ่มเติม)

| กลุ่ม | Endpoint | กลไกที่ยืนยันจากโค้ด |
|---|---|---|
| LINE webhook (ระบบ ERP/AI) | `POST /v1/line/webhook`, `POST /v1/webhooks/line` (path เดิม) | ต้องมี `x-line-signature`; ดึง channel secret จาก `LineMessagingCredentialsService.get(undefined,'INBOUND')`; ต้องมี `req.rawBody`; `verifyLineWebhookSignature` (HMAC-SHA256, base64, timing-safe) ไม่ผ่าน → `401` + security event `lineWebhookSignatureInvalid`; ผ่านแล้ว enqueue ทุก event เข้า `LineMessageBufferService` และตอบ `200 {}` ทันที (งาน AI ทำแบบ async); enqueue ล้มเหลว → โยน error เพื่อให้ LINE ส่งซ้ำ — `apps/api/src/modules/auth/presentation/line-webhook.controller.ts` |
| LINE webhook (OA ทางการ) | `POST /v1/line/official/webhook` | ปิดด้วย config `lineOfficialReplyEnabled` (ปิด → `404`); ตรวจลายเซ็นด้วย `lineOfficialChannelSecret`; ตอบข้อความเมนูแบบคงที่ผ่าน LINE Reply API; ส่งไม่ได้ → `502` — `line-official-webhook.controller.ts` |
| LINE webhook (CRM ต่อ channel) | `POST /v1/crm/line/webhook/:webhookKey` | คีย์ต่อ channel ใน path + `x-line-signature` (อยู่นอกขอบเขตแพ็ก 1,999 — ฟีเจอร์ `line_oa`/`crm`) |
| Stripe | `POST /v1/public/stripe-events` | `BillingReconcilerService.receive(req.rawBody, stripe-signature)`; body parser เฉพาะ path 256 KB; ผ่าน `AuthGuard` แม้ platform ปิด |
| Postmark | `POST /v1/public/postmark-events` | `PostmarkEventsService.receive(authorization, body)` (Basic auth); ผ่านแม้ platform ปิด |
| Amazon SES/SNS | `POST /v1/public/ses-events` | rate limit `ses-events-ip` → `SesEventsUseCase.handle` ตรวจลายเซ็น SNS และ Topic ARN; ตอบ `200` เสมอสำหรับสิ่งที่รับไว้; `403` เมื่อ topic ไม่รู้จัก/ลายเซ็นผิด |
| Login/เซสชัน | `POST /v1/auth/password/login`, `/auth/session/refresh`, `/auth/line/login/callback`, `/auth/line/qr/create`, `/auth/line/qr/redeem`, `/auth/line/handoff/exchange`, `/auth/line/exchange` | credential อยู่ใน body (username/password, refresh token, OAuth code + PKCE verifier + nonce, desktop secret, handoff token แบบใช้ครั้งเดียว, LINE ID token) + rate limit ตามตาราง; route LINE ปิดด้วย config `lineWebLoginEnabled` (ปิด → `403 LINE login is not enabled.`) |
| Reset password | `POST /v1/auth/password/reset-request`, `/email-reset-request`, `/email-reset-confirm` | rate limit ต่อ identifier+IP และต่อ IP; token ตาม pattern `EMAIL_RECOVERY_TOKEN`; ตอบ `Cache-Control: no-store` |
| Email verify | `POST /v1/auth/account/email/verify` | token ยืนยันอีเมลแบบใช้ครั้งเดียวใน body (ตรวจใน use case) |
| หน้า LIFF (HTML/JS) | `GET /v1/auth/line/link-page*`, `/auth/line/*-page`, `/auth/line/*.js`, `/auth/line/customer-register-page` | ส่ง HTML/JS คงที่พร้อม header `Content-Security-Policy` (`LIFF_PAGE_CSP`), `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; ตัวหน้าไม่มีข้อมูลลับ การพิสูจน์ตัวตนทำด้วย LINE ID token ใน POST ถัดไป — `apps/api/src/common/security/liff-page.security.ts` |
| สมัครสาธารณะ | `/v1/public/company-signups*`, `/v1/public/signup-claims/*` | rate limit ต่อ IP/อีเมล/คำขอ; claim token ตาม `CLAIM_TOKEN_PATTERN`; คำตอบของ `signup-claims/info` เหมือนกันสำหรับ token หมดอายุ/ใช้แล้ว/ไม่รู้จัก |
| สมัครผ่าน LINE | `/v1/public/line-signups*` | LINE ID token (`idToken` ใน body หรือ header `x-line-id-token`) + rate limit ต่อ IP และต่อ LINE user |
| Email access (OTP) | `/v1/public/email-access/(request\|confirm\|signup\|status)` | `assertEmailAccessAllowed` + หลักฐาน `challengeId`/`browserSecret` (43 ตัวอักษร base64url) + รหัส 6 หลัก |
| ส่วนลดงานอีเวนต์ | `POST /v1/public/event-discounts/claim` | LIFF ID token + token จาก QR ของบูธ |
| เดโมขาย | `POST /v1/auth/demo/open` | token ของลิงก์เดโมใน body + IP (ตรวจใน `SalesDemoService.open`) |
| CRM ลูกค้าปลายทาง | `/v1/crm-customer/pdpa/*`, `/v1/auth/line/customer-register` | LINE ID token + rate limit `assertCustomerRegisterAllowed` (นอกขอบเขตแพ็ก 1,999) |
| ข้อมูลสาธารณะจริง | `GET /v1/health`, `GET /v1/billing/catalog`, `GET /v1/public/home-theme`, `GET /v1/auth/login-channels`, `GET /v1/auth/platform-access`, `GET /v1/public/company-signups/availability` | ไม่ต้องพิสูจน์ตัวตน; มีเพียง rate limit ระดับ IP ของทั้งระบบ |
| Dev/local | `POST /v1/auth/dev/token`, `PUT /local-storage/upload/:token`, `GET /local-storage/download/:token` | ใช้ได้เฉพาะ `config.isLocal` มิฉะนั้น `404`; token ของ local storage ต้องเป็น hex 32 ตัว และ upload ใช้ได้ครั้งเดียว (`409` ถ้าใช้ซ้ำ) |
| ภายใน | ทุก route ในตาราง 3.2 | `X-Worker-Token` (`assertWorkerToken`) หรือ `X-Internal-Secret` (`assertInternalSecret`) ตามที่ระบุ; `AuthGuard` ปล่อยผ่าน path `/v1/internal/*` ที่เป็น `@Public()` แม้ platform ปิด |

---

## 4. รายการ endpoint ของ `apps/ai-gateway` และ route handler ของ `apps/web`

### 4.1 `apps/ai-gateway` (NestJS) — 22 endpoint

ทุก route ติด `@Public()` ต่อ guard ของ Nest แต่ path ที่ขึ้นต้น `/v1/internal/` ถูกตรวจ header `X-Internal-Secret` ใน `gatewayHttpMiddleware` **ก่อน** helmet และ body parser (ไม่ผ่าน → `401` พร้อม `Connection: close` โดยไม่อ่าน body) และ handler เรียก `assertInternalSecret` ซ้ำอีกชั้น ผู้เรียกมีเพียง `apps/api` — LINE และเว็บไม่เรียก gateway โดยตรง Body limit: route สื่อ base64 (`receipt-ocr`, `bank-statement-extract`, `line-intake-route`, `capture-read`, `capture-extract`) 16 MB; `line-document-qa` 96 MB; อื่น ๆ ตาม config `bodyLimit` มี `productionMaintenanceMiddleware` (`PRODUCTION_SERVING_MODE`) อยู่ลำดับแรก

| # | Method | Path | Controller.handler (ไฟล์) | ผู้เรียกใน `apps/api` | วัตถุประสงค์ | Request → Response |
|---:|---|---|---|---|---|---|
| 1 | GET | `/v1/health` | `HealthController.getHealth` (`modules/health/presentation/http/health.controller.ts`) | health check ของ infra | สถานะบริการ AI Gateway | — → ผลของ `GetHealthUseCase.execute()` |
| 2 | POST | `/v1/internal/ai/draft-generate` | `AiDraftInternalController` (`modules/ai-draft/ai-draft-internal.controller.ts`) | `ai-draft/infrastructure/provider/ai-gateway-draft.provider.ts` | สร้างร่างคำแนะนำ AI (โมดูล AI แนะนำ) | body ตาม `packages/contracts/src/ai-draft-suggestion.ts` → ผลร่าง (200) |
| 3 | POST | `/v1/internal/ai/crm-booking-extract` | `CrmCustomerAiInternalController` (`modules/crm-customer-ai/crm-customer-ai-internal.controller.ts`) | `crm-inbox/infrastructure/crm-ai-gateway.client.ts` | สกัดข้อมูลการจองจากแชตลูกค้า | ชนิดใน `packages/contracts/src/crm-ai.ts` (200) |
| 4 | POST | `/v1/internal/ai/crm-intake` | เดียวกัน | เดียวกัน | จัดประเภทข้อความลูกค้าขาเข้า | `CrmCustomerIntakeRequest` → ผล intake (200) |
| 5 | POST | `/v1/internal/ai/crm-customer-profile-extract` | เดียวกัน | เดียวกัน | สกัดโปรไฟล์ลูกค้า | (200) |
| 6 | POST | `/v1/internal/ai/crm-reply-draft` | เดียวกัน | เดียวกัน | ร่างคำตอบให้พนักงาน | (200) |
| 7 | POST | `/v1/internal/ai/crm-trust-score` | เดียวกัน | (ไม่พบผู้เรียกใน `crm-ai-gateway.client.ts` จากการ grep path; ดูหมวด 10) | ให้คะแนนความน่าเชื่อถือลูกค้า | (200) |
| 8 | POST | `/v1/internal/ai/crm-summary` | เดียวกัน | เดียวกัน | สรุปบทสนทนา | (200) |
| 9 | POST | `/v1/internal/ai/crm-insights` | เดียวกัน | เดียวกัน | ข้อมูลเชิงลึกลูกค้า | (200) |
| 10 | POST | `/v1/internal/ai/crm-broadcast` | เดียวกัน | เดียวกัน | ร่างข้อความ broadcast | (200) |
| 11 | POST | `/v1/internal/ai/line-reliability-capabilities` | `LineReliabilityCapabilitiesController` (`modules/line-ai/presentation/http/line-reliability-capabilities.controller.ts`) | `line-ai/infrastructure/ai-gateway.client.ts` | รายงานความสามารถด้าน reliability ของ runtime ที่ให้บริการอยู่ | (200) |
| 12 | POST | `/v1/internal/ai/line-draft-edit-capability` | `LineAiInternalController.lineDraftEditCapability` (`modules/line-ai/presentation/http/line-ai-internal.controller.ts`) | เดียวกัน | ถามว่า runtime เปิดเครื่องมือแก้ร่างผ่าน LINE หรือไม่ | `{ requestId }` → `{ enabled: boolean }` (200; `400` ถ้าไม่มี `requestId`) |
| 13 | POST | `/v1/internal/ai/line/public-general` | `LineAiInternalController` | เดียวกัน | ตอบคำถามสาธารณะหนึ่งข้อแบบ stateless โดยไม่มีบริบทส่วนตัว (ต้องมี `inputEvidence` และ `budgetGrantV2` ที่ตรวจผ่าน) | `LineAiPublicGeneralRequest` → `LineAiPublicGeneralResponse` (200) |
| 14 | POST | `/v1/internal/ai/line-turn` | `LineAiInternalController.lineTurn` | เดียวกัน | ประมวลผล 1 เทิร์นของ LINE AI | `LineAiTurnRequest` → `LineAiTurnResponse` (200) — ดูหมวด 5.9 |
| 15 | POST | `/v1/internal/ai/line-workflow-classify` | `LineAiInternalController` | เดียวกัน | จัดประเภทงานซ้ำเป็น workflow (classifier) | (200) |
| 16 | POST | `/v1/internal/ai/line-intake-route` | `LineAiInternalController` | เดียวกัน | เลือกเส้นทาง/เจตนาของข้อความขาเข้า (รับสื่อ base64 ได้) | → `LineIntakeRoutePlan` (200) |
| 17 | POST | `/v1/internal/ai/receipt-ocr` | `LineAiInternalController` | `expenses/infrastructure/receipt-ocr.client.ts`, `line-ai/infrastructure/ai-gateway.client.ts` | อ่านใบเสร็จ (OCR + สกัด field) | สื่อ base64 → ผล extraction (200) |
| 18 | POST | `/v1/internal/ai/capture-read` | `LineAiInternalController` | `expenses/infrastructure/expense-capture-read.client.ts` | อ่านเอกสารในกลุ่ม capture (ขั้นอ่าน) | (200) |
| 19 | POST | `/v1/internal/ai/capture-extract` | `LineAiInternalController` | เดียวกัน | สกัด facts จากเอกสาร capture | (200) |
| 20 | POST | `/v1/internal/ai/bank-statement-extract` | `LineAiInternalController` | `banking/infrastructure/statement-ai-extract.client.ts` | สกัดรายการจาก statement ธนาคาร (นอกขอบเขตแพ็ก 1,999) | (200) |
| 21 | GET | `/v1/internal/ai/agents` | `LineAiInternalController.agents` | (เครื่องมือวินิจฉัย) | รายการ agent registry และ tool ของแต่ละ agent | — → `{ registryEnabled, agents[] }` |
| 22 | POST | `/v1/internal/ai/line-document-qa` | `DocumentQaController` (`modules/line-ai/presentation/http/document-qa.controller.ts`) | `line-ai/infrastructure/ai-gateway.client.ts` | ถาม-ตอบจากเอกสารที่ส่งทาง LINE | ชนิดใน `packages/contracts/src/line-document-qa.ts` (200) |

การนับ: `grep -rnE "@(Get|Post)\(" apps/ai-gateway/src --include='*.ts'` (ไม่รวม spec) ได้ 22 decorator (1 health + 1 ai-draft + 8 crm-customer-ai + 1 reliability + 10 line-ai-internal + 1 document-qa)

### 4.2 AgentCore runtime entrypoint — 2 endpoint

ไฟล์ `apps/ai-gateway/src/agentcore/runtime.ts` เป็น HTTP server แยก (ไม่ใช้ Nest DI สร้าง dependency จาก env) ฟังที่ `PORT` (ค่าเริ่มต้น 8080) AI Gateway เรียก runtime ฝั่ง server ด้วย ARN/id + qualifier ผ่าน `AgentCoreRuntimeClient` (`modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts`)

| Method | Path | พฤติกรรม |
|---|---|---|
| GET | `/ping` | `200 {"status":"ok"}` (liveness เท่านั้น) |
| POST | `/invocations` | body JSON ชนิด `RuntimePayload` (ต้องมี `turnId`, `companyId`, `userId`, `messageText`; field เสริมเช่น `permissions`, `entitlementDeniedPermissions`, `entitledFeatureKeys`, `actorDelegations`, `modelPolicy`, `attachments`, `conversationContext`, `inputEvidence`, `contractCapabilities`, `budgetGrantV2`, `taskProjection`, `semanticSubrequests`, `valueCandidates`, `preparedPlan`, `intakeIntent`) → `200` ผลการรัน orchestrator พร้อม timing และ `modelCallCount`. Error: `400 BODY_READ_ERROR` / `INVALID_JSON` / `INVALID_PAYLOAD` / `AI_CONTRACT_UNSUPPORTED`, `413 PAYLOAD_TOO_LARGE` (เกิน `AGENTCORE_MAX_BODY_BYTES`, ค่าเริ่มต้น 1,048,576), `429 TOO_MANY_CONCURRENT_INVOCATIONS` (เกิน `AGENTCORE_MAX_CONCURRENT_INVOCATIONS`, ค่าเริ่มต้น 16), `500 INVOCATION_ERROR`; ข้อจำกัดอื่น: `AGENTCORE_MAX_MESSAGE_CHARS` 8,000, `AGENTCORE_MAX_ATTACHMENTS` 10 |
| อื่น ๆ | — | `404` |

runtime เรียกกลับ `apps/api` ผ่าน `ErpToolClient` (`POST /v1/internal/ai/tools/invoke`) และ budget seam (`/v1/internal/ai/budget-step`, `/budget-settle`) ด้วย `X-Internal-Secret` — ไม่มีการเข้าฐานข้อมูลโดยตรง

### 4.3 Route handler ของ Next.js ใน `apps/web/app/api/**` — 20 ไฟล์ `route.ts`

ทุก handler ทำงานฝั่ง server และเรียก `apps/api` ที่ `internalApiV1Base()`; mutation ทุกตัวผ่านการตรวจ same-origin ใน `apps/web/proxy.ts` (CSRF double-submit บังคับเฉพาะ `/api/v1/*` ไม่รวม `/api/auth/*`)

| # | Method | Path (เว็บ) | ไฟล์ | Upstream API | วัตถุประสงค์และผลลัพธ์ |
|---:|---|---|---|---|---|
| 1 | POST | `/api/auth/login` | `app/api/auth/login/route.ts` | `POST /v1/auth/password/login` | รับ `{username,password,remember?}` (trim ทั้งคู่; ว่าง → `400`); สำเร็จ → ตั้ง cookie เซสชัน + CSRF แล้วตอบ `{passwordChangeRequired, legalAcceptanceRequired (ค่าเริ่มต้น true ถ้า API ไม่ส่ง), companyId, redirectPath}`; API ไม่ตอบ → `502`; ล้มเหลว → `loginFailureResponse` |
| 2 | POST | `/api/auth/refresh` | `app/api/auth/refresh/route.ts` | `POST /v1/auth/session/refresh` | ใช้ cookie `watchdog_refresh`; สำเร็จ `204` + cookie ใหม่ (คง CSRF เดิม); `401` เท่านั้นที่ล้าง cookie; ข้อผิดพลาดอื่นคง cookie ไว้ให้ลองใหม่ |
| 3 | POST | `/api/auth/logout` | `app/api/auth/logout/route.ts` | `POST /v1/auth/logout` (Bearer) | เพิกถอนเซสชันแล้วล้าง cookie เสมอ → `204` |
| 4 | POST | `/api/auth/change-password` | `app/api/auth/change-password/route.ts` | `POST /v1/auth/password/change` (ผ่าน `forwardPasswordChange`) | `{currentPassword?, newPassword}`; ไม่มีเซสชัน `401`; สำเร็จ `204`; ส่งต่อ `message`/`code` ของ API |
| 5 | POST | `/api/auth/dev-login` | `app/api/auth/dev-login/route.ts` | `POST /v1/auth/dev/token`, `GET /v1/auth/me` | เข้าสู่ระบบสำหรับพัฒนา local; นอก dev build → `404` |
| 6 | GET | `/api/auth/line-login/availability` | `app/api/auth/line-login/availability/route.ts` | `GET /v1/auth/login-channels` | `{available}`; ตรวจไม่ได้ → `503 {available:false}` |
| 7 | GET | `/api/auth/line-login/start` | `app/api/auth/line-login/start/route.ts` | `GET /v1/auth/login-channels`, `POST /v1/auth/account/email/otp/line-reauth/start` | เริ่ม LINE web login (OAuth Authorization Code + PKCE): สร้าง state/nonce/verifier เก็บใน cookie `httpOnly` แล้ว redirect ไป LINE |
| 8 | GET | `/api/auth/line-login/callback` | `app/api/auth/line-login/callback/route.ts` | `POST /v1/auth/line/login/callback` (ไม่มีเซสชัน), `POST /v1/auth/line/link/oauth` หรือ `POST /v1/auth/account/email/otp/line-reauth` (มีเซสชัน) | ปิด flow LINE login: ตรวจ state, แลก code ฝั่ง server, ตั้ง cookie เซสชัน; กรณีผูกบัญชีแล้วชน (`409`) เก็บ merge ticket ใน cookie `httpOnly` |
| 9 | POST | `/api/auth/line-qr/start` | `app/api/auth/line-qr/start/route.ts` | `POST /v1/auth/line/qr/create` | สร้างธุรกรรม QR login บนเดสก์ท็อป; เก็บ desktop secret ใน cookie `httpOnly`; ผิดพลาด `502 {error:true}` |
| 10 | POST | `/api/auth/line-qr/status` | `app/api/auth/line-qr/status/route.ts` | `POST /v1/auth/line/qr/redeem` | poll สถานะ; เมื่ออนุมัติแล้วตั้ง cookie เซสชันและตอบสถานะ + path |
| 11 | POST | `/api/auth/line-qr/approve` | `app/api/auth/line-qr/approve/route.ts` | `POST /v1/auth/line/qr/approve` (Bearer) | โทรศัพท์ที่ล็อกอินแล้วอนุมัติ `publicCode`; ไม่มีเซสชัน `401`, ไม่มี code `400` |
| 12 | POST | `/api/auth/email-access/request` | `app/api/auth/email-access/request/route.ts` → `features/auth/email-access-bff.server.ts` | `POST /v1/public/email-access/request` | ขอรหัส OTP ทางอีเมล |
| 13 | POST | `/api/auth/email-access/confirm` | `…/confirm/route.ts` | `POST /v1/public/email-access/confirm` | ยืนยันรหัส; ถ้าเป็นการล็อกอินจะตั้ง cookie เซสชัน |
| 14 | POST | `/api/auth/email-access/signup` | `…/signup/route.ts` | `POST /v1/public/email-access/signup` | สมัครร้านด้วยอีเมลที่ยืนยันแล้ว |
| 15 | POST | `/api/auth/email-access/status` | `…/status/route.ts` | `POST /v1/public/email-access/status` | อ่านสถานะหลักฐาน/การสมัคร |
| 16 | POST | `/api/auth/signup-claim` | `app/api/auth/signup-claim/route.ts` | `POST /v1/public/signup-claims/(set-password\|attach)` แล้ว `POST /v1/auth/password/login` | ปิด claim การสมัครและล็อกอินต่อทันที; ส่งต่อ `x-forwarded-for` ของผู้ใช้เพื่อให้ rate limit แยกรายคน; ตอบ `sessionEstablished` |
| 17 | POST | `/api/auth/account-merge` | `app/api/auth/account-merge/route.ts` | `POST /v1/auth/account-merge` | รวมบัญชีด้วย merge ticket จาก cookie; `400 merge_ticket_missing`, `401 session_expired`, `502 service_unreachable` |
| 18 | GET | `/api/auth/account-merge/ticket` | `app/api/auth/account-merge/ticket/route.ts` | `POST /v1/auth/account-merge/preview` | บอกว่ามีข้อเสนอรวมบัญชีหรือไม่และแผนการรวม (ตอบ `200` เสมอ) |
| 19 | GET | `/api/public/billing/catalog` | `app/api/public/billing/catalog/route.ts` | `GET /v1/billing/catalog` | แค็ตตาล็อกราคาแบบไม่ระบุตัวตน (CORS `*`, `no-store`, timeout 5 วินาที); ล้มเหลว `503 {code:'BILLING_CATALOG_UNAVAILABLE'}` |
| 20 | POST | `/api/public/halloween/draw` | `app/api/public/halloween/draw/route.ts` → `features/public-home/home-halloween-draw.server.ts` | (ประมวลผลในเว็บ) | กิจกรรมสุ่มรางวัลหน้าแรก; มี token bucket (`429 DRAW_BUSY`, `Retry-After: 1`) |

นอกจากนี้ `next.config.mjs` rewrite `/api/:path*` → API (`/api/v1/...`) และ `/local-storage/:path*` → API; path ที่ตรงกับ route handler ข้างต้นถูกจับโดย handler ก่อน rewrite

---

## 5. รายละเอียดเต็มของ endpoint สำคัญ

หมวดนี้ให้รายละเอียดของ endpoint สำคัญกว่า 40 ตัว (จัดเป็น 9 กลุ่ม) field และ validation คัดจาก DTO class จริง (class-validator) สถานะ HTTP มาจาก `@HttpCode` และ exception ที่อ่านพบ ทุก endpoint ที่ไม่ใช่ `Public` อยู่ภายใต้ประตูร่วมในหมวด 1.2 (401/403/503) และ rate limit `api-ip` (429) ซึ่งจะไม่กล่าวซ้ำ คำว่า "ผลของ `X.execute()`" หมายถึง controller ไม่ได้ประกาศ return type และส่งผลลัพธ์ของ use case นั้นกลับตรง ๆ (ชนิดอยู่ใน `packages/contracts` ตามหมวด 6)

### 5.1 การเข้าสู่ระบบและเซสชัน

**5.1.1 `POST /v1/auth/password/login`** — `AuthController.passwordLoginWithCredentials` (`apps/api/src/modules/auth/presentation/auth.controller.ts:288`) · Public · 200

| ส่วน | รายละเอียด |
|---|---|
| Request (`PasswordLoginDto`) | `username: string` (ไม่ว่าง), `password: string` (ไม่ว่าง) |
| Response | `{ accessToken, refreshToken, expiresIn, passwordChangeRequired, companyId, redirectPath, legalAcceptanceRequired }` (`password-login.use-case.ts:179-185`); `redirectPath` = `/system/partners` สำหรับ SYSTEM_ADMIN, มิฉะนั้น `/companies/{companyId}/dashboard` (หรือ `/expenses` สำหรับบัญชี free-expense-drafts) |
| Error | `401 Invalid username or password.`; `403 Temporary password has expired.`; `403 {code:'company_membership_disabled'}` และ 403 อื่นเมื่อไม่มีร้านที่เข้าได้; `429` เมื่อเกิน bucket `password-login-identifier-ip` / `password-login-ip`; `503 platform_access_closed` |
| ผลข้างเคียง | สร้างแถว `AuthSession`; ครั้งที่ล้มเหลวถูกนับเข้า rate limit (สำเร็จไม่นับ); emit security event `authLoginDenied` และบันทึก audit เมื่อถูกปฏิเสธ |

**5.1.2 `POST /v1/auth/session/refresh`** — `AuthController.refresh` · Public · 200 — Request `RefreshDto { refreshToken: string }` → Response `{ accessToken, refreshToken, expiresIn }` (หมุน refresh token; เซสชันเดิมใช้ต่อไม่ได้) · Error `401` เมื่อ token/เซสชันใช้ไม่ได้ · rate limit `assertRefreshAllowed` ต่อ refresh token id (ใน use case)

**5.1.3 `POST /v1/auth/logout`** — `AuthController.logoutSession` · สิทธิ์ `account.session.read` · 204 — ไม่มี body; ระบุเซสชันจาก claim ใน token (`extractSid`); `401 Cannot identify session.` ถ้าอ่านไม่ได้ · ผลข้างเคียง: เพิกถอน `AuthSession` ปัจจุบัน (`POST /v1/auth/sessions/revoke-others` เพิกถอนเซสชันอื่นทั้งหมด)

**5.1.4 `GET /v1/auth/me`** — `AuthController.me` (`auth.controller.ts:1056`) · สิทธิ์ `account.session.read` · 200 — ยกเว้นจากประตูเปลี่ยนรหัสผ่าน/ข้อตกลง/อายุแพ็ก เพื่อให้เซสชันที่ถูกบล็อกรู้สาเหตุ

Response: `userId`, `displayName`, `companyId`, `membershipId`, `roles[]`, `roleNames{}`, `permissions[]` (หลังตัดด้วย feature gate), `availablePermissions[]`, `entitledFeatureKeys[] | null`, `scopes{branchIds?}`, `authProvider`, `mustChangePassword`, `canSkipCurrentPassword`, `legalAcceptanceRequired`, `manualExpenseWebEntry`, `disbursementVoucherWebEntry`, และเมื่อเกี่ยวข้อง `isDemo`, `demoExpiresAt`, `freeExpenseDrafts` · Error เฉพาะ: `403 {code:'company_access_unavailable' | 'company_membership_disabled', companyName?}` เมื่อขอบริษัทที่เข้าไม่ได้

**5.1.5 `POST /v1/auth/password/change`** — สิทธิ์ `account.password.change` (ดูแถวในหมวด 2.4) — Request `ChangePasswordDto { currentPassword?: string (ไม่ว่างถ้าส่ง), newPassword: string (ยาว ≥ 8) }`; `currentPassword` ละได้เมื่อ `canSkipCurrentPassword` (รหัสชั่วคราวที่เพิ่งใช้ล็อกอินในเซสชันนี้) · ผลข้างเคียง: ล้าง `mustChangePassword`

**5.1.6 `GET/POST /v1/auth/legal-acceptance`** — สิทธิ์ `account.session.read` · POST 200 — Request `AcceptLegalDocumentsDto { termsVersion, privacyVersion, statementVersion: string; termsAccepted: true; privacyAcknowledged: true; deletionAcknowledged: true; locale: 'th'; displayChallenge: hex 64 ตัว }` (ทุก boolean ต้องเป็น `true` พอดี) · ผลข้างเคียง: บันทึกการยอมรับผูกกับ session token id และ user-agent; หลังสำเร็จประตู `legal_acceptance_required` เปิด

**5.1.7 `POST /v1/auth/line/login/callback`** — Public · 200 — Request `LineLoginCallbackDto { code: /^[\w.-]{10,512}$/, codeVerifier: /^[A-Za-z0-9\-._~]{43,128}$/, nonce: /^[A-Za-z0-9_-]{16,256}$/ }` → token ชุดเดียวกับ password login · `403 LINE login is not enabled.` เมื่อ config `lineWebLoginEnabled` ปิด; rate limit `line-login-callback-ip`

**5.1.8 QR login บนเดสก์ท็อป** — `POST /v1/auth/line/qr/create` (Public; `LineQrCreateDto { returnTo?: string ≤512 }` → QR + secret ผูกเบราว์เซอร์), `POST /v1/auth/line/qr/redeem` (Public; `{ desktopSecret }` → สถานะ; ออก token เมื่ออนุมัติแล้ว), `POST /v1/auth/line/qr/approve` (ต้องล็อกอิน; `{ publicCode }`; ยกเว้นจากประตู legal acceptance) — ทั้งสามตรวจ `lineWebLoginEnabled` และมี rate limit ของตัวเอง

### 5.2 การสมัครใช้งาน

**5.2.1 `POST /v1/public/company-signups`** — `PublicCompanySignupController.create` (`apps/api/src/modules/external-signup/presentation/http/public-company-signup.controller.ts`) · Public · rate limit `public-signup-ip` + ต่ออีเมล

| Field (`PublicCompanySignupDto`) | ชนิด / validation |
|---|---|
| `externalSignupId` | string ≤128, `/^[A-Za-z0-9_:-]+$/` (คีย์ idempotency ของผู้สมัคร) |
| `companyName` | string ไม่ว่าง ≤200 |
| `ownerFirstName`, `ownerLastName` | string ไม่ว่าง ≤80 |
| `contactEmail` | email ≤254 |
| `phoneNumber?` | ตาม `PHONE_PATTERN` |
| `businessType?` | string ≤120 |
| `vatRegistered?` | boolean |
| `taxId?` | string ≤32, ตัวเลข/ช่องว่าง/ขีด |
| `consentVersion` | string ไม่ว่าง ≤64 |
| `referralCode?` | ≤128 `/^[A-Za-z0-9_-]*$/` |
| `requestedOfferKey?` | หนึ่งใน `FREE_TRIAL`, `PRO_TRIAL`, `STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999` |
| `discoverySource?`, `discoverySourceOther?` | ตาม `SIGNUP_DISCOVERY_SOURCE_OPTIONS` / ≤ `SIGNUP_DISCOVERY_OTHER_MAX` |
| `referralSalesCode?` | ≤6 ตัวอักษร/ตัวเลข |

Response: ชนิด `PublicCompanySignupAcceptedDto` (`packages/contracts/src/external-signup.ts`) · ผลข้างเคียง: สร้างคำขอสมัคร, เข้าคิวอีเมล claim (ระบายโดย worker `signup-claim-email`) · เกี่ยวข้อง: `GET /v1/public/company-signups/availability`, `GET /v1/public/company-signups/:requestId` (สถานะแบบหยาบ), `POST …/:requestId/resend-claim`

**5.2.2 `POST /v1/public/signup-claims/set-password`** — Public · rate limit `public-signup-claim-ip` — Request `SignupClaimSetPasswordDto { token (ตาม CLAIM_TOKEN_PATTERN), username (3–40, ตาม USERNAME_PATTERN), password (8–128) }` · ผลข้างเคียง: สร้างบัญชีผู้ใช้ + provision บริษัท/สมาชิกภาพ OWNER · คู่กัน: `POST /v1/public/signup-claims/attach` (ผูกร้านใหม่กับบัญชีเดิม; นับ rate limit ของ password login ด้วย), `POST /v1/public/signup-claims/info`

**5.2.3 `POST /v1/public/line-signups`** — `PublicLineSignupController.create` · Public · LINE ID token + rate limit ต่อ IP และต่อ LINE user

Request `LineSignupSubmitBodyDto`: `idToken` (LINE ID token), `submissionId: UUID`, `intent: 'FIRST_SHOP' | 'ADD_SHOP'`, `companyName` (ไม่ว่าง), `phoneNumber` (≤20, ตัวเลข/ช่องว่าง/ขีด), `contactEmail?` (email; trim + lowercase; ค่าว่าง → null), `referralCode?`, `discoverySource?`, `discoverySourceOther?`, `referralSalesCode?` (≤6, ตัวพิมพ์ใหญ่), `legal: { documentVersion: /^v\d+$/, statementSha256, releaseFingerprintSha256, displayChallenge (SHA-256 hex), locale: 'th'|'en' }` · เกี่ยวข้อง: `GET /v1/public/line-signups/me` (header `x-line-id-token`), `PATCH …/:requestId/contact-email` (`{idToken, version, contactEmail}`), `POST …/:requestId/retry` (`{idToken, version}`), `POST …/support` (`{idToken}`)

**5.2.4 `POST /v1/public/email-access/(request|confirm|signup|status)`** — Public · 200 · `Cache-Control: no-store` — `request`: `{ email (≤254), requestKey: UUID, browserSecret: /^[A-Za-z0-9_-]{43}$/ }`; `confirm`: `{ challengeId: UUID, browserSecret, code: /^\d{6}$/ }`; `signup`: `{ challengeId, browserSecret, companyName (1–120), displayName (1–160), phoneNumber: /^(?:0|\+66)[0-9 -]{8,14}$/, consentVersion: 'EMAIL_SIGNUP_V1' }`; `status`: `{ challengeId, browserSecret }` · rate limit `email-access-<action>-ip`

**5.2.5 `POST /v1/companies/:companyId/package-change-requests`** — `CompanyPackageChangeController` · Request `CreatePackageChangeRequestDto { requestedTierKey ∈ PLAN_TIER_KEYS, note?: ≤500 }` · เป็น route กู้คืนที่ใช้ได้แม้อายุแพ็กหมด (`isBillingRecoveryRoute`) · ฝั่งผู้ดูแลตัดสินที่ `POST /v1/system/package-change-requests/:id/decision`

### 5.3 รายจ่าย (expenses) — อัปโหลดเอกสารและยืนยัน

Controller: `apps/api/src/modules/expenses/presentation/http/expense-capture.controller.ts` และ `expense.controller.ts` · แพ็ก: ทุกแพ็ก (`expenses` + sub-keys)

**5.3.1 `POST /v1/companies/:companyId/expenses/capture-groups`** — สิทธิ์ any(`expense.receipt.upload` | `expense.receipt.line_upload` …) — Request `CreateExpenseCaptureGroupDto { branchId?: ≤64, note?: ≤500 }` → กลุ่ม capture ใหม่ (ชนิดใน `packages/contracts/src/expense-capture.ts`)

**5.3.2 `POST …/capture-groups/:groupId/files`** — Request `AddExpenseCaptureFileDto { originalFileName (≤255), mimeType (≤255), byteSize: int ≥1 }` + field revision จาก `ExpenseCaptureRevisionDto` (optimistic concurrency ของกลุ่ม) → เจตนาอัปโหลด (presigned URL) สำหรับส่งไฟล์ตรงไป object storage

**5.3.3 `POST …/capture-groups/:groupId/files/:fileId/complete`** — Request `CompleteExpenseCaptureFileDto { byteSize?: int ≥1, checksumSha256?: ≤64 }` + revision → ยืนยันว่าอัปโหลดเสร็จ; ผลข้างเคียง: ไฟล์เข้าคิวอ่านเอกสาร (ระบายโดย worker `expense-capture-read` → `POST /v1/internal/expenses/capture-read/drain` → gateway `capture-read`/`capture-extract`)

**5.3.4 `GET …/capture-groups/:groupId/read-status`** และ **`GET …/expenses/:expenseId/read-status`** — ใช้ poll สถานะการอ่านเอกสาร

**5.3.5 `POST …/capture-groups/:groupId/handoff`** — สิทธิ์ any(`expense.create` | `expense.receipt.upload` …) — Request `ExpenseCaptureHandoffDto { allocationId (≤64), idempotencyKey?: ≤128 }` + revision → ส่งต่อ allocation ที่ยอมรับแล้วไปเป็นร่างรายจ่าย/ใบเบิก (ผลของ use case ใน `expense-capture-handoff.use-case.ts`)

**5.3.6 `POST /v1/companies/:companyId/expenses`** — สิทธิ์ `expense.create` — Request `CreateExpenseDraftInput` (type ใน `packages/contracts/src/expenses.ts`; ไม่ใช่ DTO class จึงตรวจใน use case): `captureSource`, `expenseDate`, `vatMode`, `lines[] { lineNumber, description, quantity, unitPrice, discountAmount?, vatRate?, vatTreatment?, whtCategoryCode?, whtRate?, expenseCategoryId?, … }`, และ optional `idempotencyKey`, `branchId`, `vendorCounterpartyId`, `vendorNameSnapshot`, `currency`, `inputVatClaimStatus`, `expenseCategoryId`, `note`, `missingReceiptReason`, `vatSource`, `whtInput`, `whtRemittance`

**5.3.7 `PATCH /v1/companies/:companyId/expenses/:expenseId`** — Request `UpdateExpenseDraftInput & { expectedUpdatedAt: string }` — `expectedUpdatedAt` เป็น optimistic lock; ไม่ตรง → `409 {code:'EXPENSE_UPDATE_CONFLICT'}`

**5.3.8 `POST …/expenses/:expenseId/extraction-request`** — สิทธิ์ any(`expense.ocr.request` | `expense.review` | `expense.receipt.upload`) — ไม่มี body; เรียก OCR แบบ synchronous ผ่าน gateway `receipt-ocr` (เว็บตั้ง proxy timeout 180 วินาทีเพราะเหตุนี้); เมื่อ gateway ปฏิเสธด้วยรหัสงบ AI (`isAiBudgetRefusalCode`) use case บันทึกเหตุผลไว้กับรายจ่าย (`expense-extraction.use-case.ts:189-193`) แทนการถามซ้ำ

**5.3.9 `POST …/expenses/:expenseId/confirm`** — สิทธิ์ `expense.confirm` — Request `ConfirmExpenseDto { vatSourceOverride?: ExpenseVatSourceOverrideDto }` → รายจ่ายสถานะยืนยันแล้ว (`ConfirmExpenseUseCase` ใน `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts`) · รหัส error ที่พบในโมดูล expenses และเกี่ยวกับการยืนยัน: `EXPENSE_EVIDENCE_REVIEW_REQUIRED`, `accounting_period_locked`, `tax_period_locked`, `posting_unresolved` (ไม่ได้ไล่ทุกเส้นทางใน use case — ดูหมวด 10) · คำสั่งคู่: `POST …/reopen`, `/reject`, `/void`, `/reviewer-mark-ready`

**5.3.10 ไฟล์แนบทั่วไป** — `apps/api/src/modules/data-model-core/presentation/http/attachment.controller.ts` (`/v1/companies/:companyId/attachments`, 5 endpoint): ขอเจตนาอัปโหลด → อัปโหลดตรง → `complete` → ขอ URL ดาวน์โหลด — ดูแถวในหมวด 2.10

### 5.4 เบิกคืนพนักงาน (reimbursements)

Controller: `apps/api/src/modules/reimbursements/presentation/http/reimbursement.controller.ts` · guard ระดับ class `ReimbursementWriteQuiesceGuard` · แพ็ก: ทุกแพ็ก (`reimbursement`)

**5.4.1 `POST /v1/companies/:companyId/reimbursements`** — สิทธิ์ `reimbursement.create` · header `Idempotency-Key`

| Field (`CreateReimbursementRequestDto`) | ชนิด / validation |
|---|---|
| `requesterUserId?`, `branchId?` | string ≤64 |
| `title?` | ≤200 |
| `reason` | ไม่ว่าง ≤1000 |
| `currency?` | ≤3 |
| `missingReceiptReason?` | ≤500 |
| `payout?` (`ReimbursementPayoutDto`) | `mode ∈ DEFAULT, CASH, SPECIFIED, SAVED` + `savedAccountId` (บังคับเมื่อ `SAVED`), `saveAsDefault?`, `saveForLater?`, `holderType?`, `payoutKind?`, `bankName?` ≤120, `accountName?` ≤200, `accountNumber?` ≤40 |
| `lines[]` (`ReimbursementLineDto`, 1..`REIMBURSEMENT_MAX_LINES`) | `lineNo` int ≥1, `incurredDate` ISO date (strict), `description` ≤500, `purpose?` ≤500, `categoryKey` ≤80, `categoryLabel?` ≤160, `amount` `/^\d{1,14}(?:\.\d{1,4})?$/`, `attachmentId?`, `linkedExpenseId?`, `sourceExpenseUpdatedAt?` |

Response: รายละเอียดใบเบิก (ร่าง) · ผลข้างเคียง: สร้าง `ReimbursementRequest` + lines สถานะร่าง

**5.4.2 `POST …/reimbursements/:requestId/submit`** — สิทธิ์ `reimbursement.submit` — `SubmitReimbursementDto { idempotencyKey?: ≤200, payoutSubmitToken?: hex 32 }` · Error ที่พบ: `duplicate_unresolved`, `reimbursement_source_review_required` · ผลข้างเคียง: เปลี่ยนสถานะเข้าสายอนุมัติ; snapshot นโยบาย, เลขที่เอกสาร, audit และ outbox event ถูก commit ใน transaction เดียวกัน (`reimbursement-request.use-case.ts:713-724`)

**5.4.3 `POST …/reimbursements/:requestId/approve`** — สิทธิ์ที่ decorator `account.session.read`; อำนาจอนุมัติจริงตรวจใน use case: `canApprove = ผู้อนุมัติที่ถูกกำหนดตาม snapshot ของขั้นอนุมัติ หรือผู้ถือ permission reimbursement.approve` (`apps/api/src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.ts:138-157`) และมีการกันอนุมัติของตนเอง (`selfApprovalBlocked`) — `ApproveReimbursementDto { comment?: ≤2000, approvalSnapshotHash?: ≤128, idempotencyKey?: ≤200, payoutVerifiedVersion?: int ≥1, payoutThirdPartyAccepted?: boolean }` → รายละเอียดใบเบิกรูปเดียวกับที่ drawer อ่าน (รวมชื่อไฟล์ใบเสร็จ) · `approvalSnapshotHash` กันการอนุมัติบนข้อมูลที่เปลี่ยนไปแล้ว

**5.4.4 `POST …/reimbursements/:requestId/reject`** — `RejectReimbursementDto { reason: ≤500, approvalSnapshotHash?, idempotencyKey?, payoutCorrectionReasonCode? ≤40 }`

**5.4.5 `POST …/reimbursements/:requestId/finance-review`** — สิทธิ์ any(`reimbursement.finance_review` | `reimbursement.duplicate.resolve`) — body `FinanceReviewReimbursementInput` (contract type)

**5.4.6 `POST …/reimbursements/:requestId/payments`** — สิทธิ์ `reimbursement.payment.record`

| Field (`RecordReimbursementPaymentDto`) | ชนิด / validation |
|---|---|
| `paidAmount` | รูปแบบเงิน `/^\d{1,14}(?:\.\d{1,4})?$/` |
| `currency?` | ≤3 |
| `paymentMethod` | หนึ่งใน `PAYMENT_METHODS` |
| `paidAt` | ISO date (strict) |
| `paymentReference?` | ≤140 |
| `bankAccountId?` | ≤64 |
| `note?` | ≤500 |
| `idempotencyKey?` | ≤128 |
| `slipAttachmentId?` | ≤64 (สลิปที่อัปโหลดด้วย flow ด้านล่าง) |
| `confirmSignedCopyWithdrawal?`, `payoutConfirmed?` | boolean |
| `payoutDestinationVersion?` | int ≥1 |
| `payoutDefaultToken?` | hex 32 |
| `methodMismatchReason?` | ≤500 |

ผลข้างเคียง: บันทึก `ReimbursementPayment`, เปลี่ยนสถานะการจ่าย, เขียน outbox; worker `reimbursement-reconcile` ไล่กระทบยอดภายหลัง · คู่กัน: `POST …/payments/:paymentId/void` (`reimbursement.payment.void`; `{ reason ≤500 }`), อัปโหลดสลิป `POST …/payments/slip-upload-intent` (`{originalFileName, mimeType, byteSize}`) → `POST …/payments/slip-uploads/:attachmentId/complete` (`{checksumSha256?: hex64, byteSize?}`) → `POST …/payments/:paymentId/slips`

**5.4.7 แบบฟอร์มใบเบิกและลายเซ็น** — `POST …/claim-form/preview`, `…/claim-form/signature-upload-intent`, `…/signature-uploads/:attachmentId/complete`, `POST …/claim-form/signatures` (`SignReimbursementClaimFormDto { role ∈ CLAIM_SIGNATURE_ROLES, signatureAttachmentId?: ≤64, snapshotHash: ≤64 }`), `POST …/claim-form/signed-copies`

**5.4.8 `POST …/reimbursements/:requestId/cancel`** — `CancelReimbursementDto { reason?: ≤500, taxFilingAttested?: boolean }` · Error ที่พบ: `reason_too_short`, `reimbursement_cancellation_tax_period_locked`, `reimbursement_cancellation_certificate_issued`, `reimbursement_cancellation_certificate_attestation_required`, `reimbursement_cancellation_certificate_permission_missing`

### 5.5 หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) และ ภ.ง.ด.3/53

Controller: `apps/api/src/modules/tax/presentation/http/tax.controller.ts`

**5.5.1 `POST /v1/companies/:companyId/wht/payment-handoffs/:handoffId/system-certificate`** — สิทธิ์ `wht.certificate.issue` · แพ็ก ENT (`wht_50bis`) — Request `IssueWhtCertificateDto { paymentId?: ≤200 }` → ออกหนังสือรับรองในระบบ · Error: `409 wht_handoff_not_issuable`, `wht_certificate_payment_required`, `tax_period_locked` · ดาวน์โหลด: `GET …/system-certificate`; แก้ไข: `POST …/system-certificate/correction` (`{ corrected, reason ≤500 }`, สิทธิ์ `wht.certificate.correct`), `POST …/system-certificate/replacement-copy`

**5.5.2 `POST …/wht/payment-handoffs/:handoffId/external-certificate`** — สิทธิ์ `wht.external_certificate.link` · แพ็ก: ทุกแพ็ก (ตั้งใจไม่ gate — `pack.wht.certificate.manage` ไม่มี `featureEntitlementKey`) — Request `LinkExternalWhtCertificateDto { commandId, externalCertificateNumber, externalEvidenceRef, issuedDate: YYYY-MM-DD, externalAttachmentId?, paymentDate?, paymentId?, note? }` (ความยาวสูงสุดตาม `WHT_LINK_LIMITS`) · คู่กัน: `…/external-certificate/file-upload-intent` → `…/file-uploads/:attachmentId/complete`, `…/change`, `…/remove`

**5.5.3 `POST /v1/companies/:companyId/tax/pnd53/periods/:periodId/export`** (alias `/tax/withholding/:formType/periods/:periodId/export`) — สิทธิ์ `wht.pnd53.prepare` · แพ็ก ENT (`wht_pnd53`) — Request `ExportPnd53Dto { exportFormat: 'PDF' | 'XLSX', establishmentCode?: /^\d{5}$/, sequence?: int ≥0 }` → ไฟล์แบบ ภ.ง.ด. · ขั้นก่อนหน้า: `POST …/sync`, `POST …/periods/:periodId/report`; ปิดงาน: `POST …/periods/:periodId/mark-filed`

### 5.6 รายงานและการส่งออก

**5.6.1 `POST /v1/companies/:companyId/reports/exports`** — `ReportController.exportHandler` · สิทธิ์ `report.export` — Request `CreateReportExportInput { datasetCode: string, format: ReportExportFormat, filters?: Record<string, ReportFilterValue>, viewId?: string }` → งาน export; ดาวน์โหลดที่ `GET …/reports/exports/:exportId/download?format=` (สิทธิ์ any(`report.export.read_own` | `report.export.manage`)) · **หมายเหตุขอบเขต:** `report.export` ถูก gate ด้วยคีย์ `reports` ซึ่งไม่อยู่ใน preset ของแพ็กใด → โมดูลรายงานกลางนี้อยู่นอกขอบเขตแพ็ก 1,999 (ดูหมวด 8); การส่งออกที่ลูกค้าแพ็ก 1,999 ใช้จริงอยู่ในโมดูล expenses/reimbursements/tax (เช่น ชุดเอกสารนักบัญชี, `GET …/reimbursements/:requestId/export`, `GET …/income-expense-ledger/export`) ดูแถวที่มีคำว่า export/accountant ในหมวด 2.14, 2.23, 2.1

**5.6.2 `GET /v1/companies/:companyId/income-expense-ledger/export`** — สิทธิ์ any(`accounting.document.export` | `expense.export`) — query `type, categoryId, …` → ไฟล์ CSV และ XLSX ของแหล่งรายรับ-รายจ่ายที่เลือก

### 5.7 Billing — แค็ตตาล็อก ใบเสนอราคา ชำระเงิน เปลี่ยนแพ็ก

Controller: `apps/api/src/modules/billing/presentation/billing.controller.ts` (5 class: `BillingCatalogController`, `BillingAdminController`, `BillingCompanyController`, `StripeEventsController`, `BillingInternalController`) — รายละเอียดเชิงธุรกิจอยู่ในเอกสาร 02f

**5.7.1 `GET /v1/billing/catalog`** — Public → แค็ตตาล็อกแพ็ก/ราคา (ชนิด `BillingOffer[]` และโครงสร้างใน `packages/contracts/src/billing.ts`); เว็บสาธารณะอ่านผ่าน `/api/public/billing/catalog`

**5.7.2 `POST /v1/companies/:companyId/billing/quote`** — สิทธิ์ที่ decorator `account.session.read` (การตรวจอำนาจจัดการแพ็กเพิ่มเติมอยู่ใน `BillingService`; เอกสารนี้ไม่ได้ไล่ยืนยัน — ดู 02f) · 200

| Field (`BillingQuoteDto`) | ชนิด / validation |
|---|---|
| `offerKey?` | string 1–40 |
| `interval?` | string 1–10 |
| `billingEmail?` | ≤320 |
| `capacity?` | อนุญาตทุกค่า (ตรวจใน service) |
| `purchaseMode?` | `CARD_AUTO`, `CARD_ONCE`, `PROMPTPAY_ONCE`, `PROMPTPAY_RENEW` |
| `purchaseIntent?` | `FULL_PACKAGE` |
| `dealId?` | 1–40 (ดีลจากเซลล์) |
| `eventDiscountChoice?` | `USE`, `DECLINE` |
| `eventDiscountTicketSerial?` | 1–40 |
| `benefitChoice?` | `NORMAL`, `PROMOTION`, `EVENT_DISCOUNT` (หนึ่งสิทธิประโยชน์ต่อการซื้อ; controller ปฏิเสธการผสม) |
| `promotionCampaignId?` | 1–64 (ใช้ได้เฉพาะกับ `PROMOTION`) |

Response: ใบเสนอราคา (มี `quoteId`) · Error: `400` เมื่อชุด field ขัดกัน

**5.7.3 `POST /v1/companies/:companyId/billing/checkout`** — 200 · header `Idempotency-Key` · rate limit `billing-command` (30 ครั้งต่อหน้าต่าง 60 วินาที ต่อ `companyId:userId`; `billing.controller.ts:600`) — Request `BillingCheckoutDto { quoteId: UUID, consentRevision: 1–120, accepted: true (ต้องเป็น true), channel: 'web' | 'line' }` → ผลของ `BillingService.checkout()` (attempt + ข้อมูลไปหน้าชำระของ Stripe) · ผลข้างเคียง: สร้าง checkout attempt, เรียก Stripe; สถานะสุดท้ายมาจาก `POST /v1/public/stripe-events` และ worker `billing-events`/`billing-scan` · ติดตาม: `GET …/billing/attempts/:attemptId`, `POST …/attempts/:attemptId/resume`, `…/cancel`, `…/capacity`

**5.7.4 `POST /v1/companies/:companyId/billing/portal`** — `BillingPortalDto { action: 'portal_payment_method' }` (ค่าอื่น → `400`) → ลิงก์ Stripe customer portal

**5.7.5 `GET /v1/companies/:companyId/billing`**, `/history` (`cursor`, `limit` 1–2 หลัก, ค่าเริ่มต้น 20), `/capacity`, `/event-discount`, `POST /refresh`, `POST /documents/:documentId/open`, `/resend` — อ่านสถานะ/ประวัติ/เอกสารการเรียกเก็บ; ทั้งหมดอยู่ในรายการ route กู้คืน (`isBillingRecoveryRoute`) จึงใช้ได้แม้แพ็กหมดอายุ

**5.7.6 เปลี่ยนแพ็ก/ปรับแผนโดยผู้ดูแล** — `GET /v1/system/billing/companies/:id/plan-adjustments`, `POST …/plan-adjustments/preview` (`BillingPlanAdjustmentDto`), `POST /v1/system/billing/plan-adjustments/:id/:action` (`BillingCommandDto { previewHash?: ≤120, accepted?: boolean }` + version + `Idempotency-Key`) — รูปแบบ "preview → command ด้วย previewHash" ใช้ซ้ำกับ receipt-adjustments, credit-grants, batches, refunds และคำสั่งผู้ดูแลอื่นทั้งหมดใน `BillingAdminController` (112 endpoint, สิทธิ์ตระกูล `system.billing.*`)

**5.7.7 `POST /v1/public/stripe-events`** — Public · 200 — body ดิบ + header `stripe-signature` → `BillingReconcilerService.receive`; ลายเซ็นผิด/ไม่มี → ปฏิเสธ; ผลข้างเคียง: บันทึก event ของผู้ให้บริการเพื่อให้ `POST /v1/internal/billing/drain` ประมวลผล (เปิดสิทธิ์แพ็ก, ออกเอกสาร, แจ้งเตือน)

### 5.8 LINE webhook

**`POST /v1/line/webhook`** (และ `POST /v1/webhooks/line`) — Public · 200 `{}` — Request: envelope ของ LINE Messaging API `{ destination, events[] }` + header `x-line-signature` · Error: `401 Missing x-line-signature header.` / `LINE Messaging channel secret not configured.` / `LINE webhook raw body unavailable.` / `Invalid LINE webhook signature.`; 5xx เมื่อ enqueue ไม่สำเร็จ (ให้ LINE ส่งซ้ำ) · ผลข้างเคียง: แต่ละ event ถูกแปลงด้วย `buildLineBufferEnvelope` แล้วเข้าบัฟเฟอร์ต่อแชต (`LineMessageBufferService`); worker ต่อแชตในโปรเซส API ประมวลผลแบบ async (intake → `line-turn` → ตอบกลับ LINE) และ drain บัฟเฟอร์เมื่อได้ SIGTERM (`app.enableShutdownHooks()`)

### 5.9 AI turn และเครื่องมือ ERP (service-to-service)

**5.9.1 `POST {gateway}/v1/internal/ai/line-turn`** — `X-Internal-Secret` · 200 — Request `LineAiTurnRequest` (`packages/contracts/src/line-ai.ts:330`): บังคับ `requestId`, `webhookEventId` (idempotency key = id ของ webhook event), `userContext` (ต้องมี `companyId`), `messageText`, `messagePreviewHash`; เสริม `packageOffers`, `modelPolicy`, `actorDelegations`, `entitledFeatureKeys`, `language`, `inputEvidence`, `contractCapabilities`, `budgetGrantV2`, `approvedKnowledge`, `selectedKnowledgeCardIds`, `howToActionId`, `taskProjection`, `responsePreferences`, `semanticSubrequests`, `reimbursementHints`, `retainedTaskSource`, `attachments`, `conversationContext`, `valueCandidates`, `openClarifications`, `resolvedClarificationIds`, `preparedPlan` · Response `LineAiTurnResponse`: `requestId`, `replyText`, `sourceRefs[]`, `sourceLabels[]`, `webLinks[]`, `intent`, `agent`, `refused`, `refusalReason?`, `toolsInvoked[]`, `toolCalls?`, `durationMs`, `errorCode?`, `modelLineage?`, `presentation?`, `coverage?`, `semanticCoverage?`, `usage?` · Error: `401` secret ผิด, `400 Invalid turn request payload.`

**5.9.2 `POST {api}/v1/internal/ai/tools/invoke`** — `InternalToolsController.invoke` · `X-Internal-Secret` + `X-Actor-Delegation` (delegation ใช้ครั้งเดียวที่ API ออกให้ต่อชื่อ tool) · 200 — Request `InternalToolCallDto { toolName: ≤120, context: { companyId, userId (บังคับ), requestId?, membershipId?, locale?, chatKeyHash?, groundingText?, inputEvidence?, valueCandidatesV2?, budgetGrantV2?, roles?, permissions?, branchIds?, locationIds? }, input?: object }` → `ToolResult { toolName, status, data?, sourceRefs[], asOf, stale?, errorCode?, errorMessage?, durationMs?, queryApplied?, basisVersion?, facts?, completeness? }` · หลักการ: permissions/roles/branch scope ใน body ใช้ตรวจรูปแบบเท่านั้น ค่าที่มีอำนาจจริง API คำนวณใหม่ด้วย `PermissionResolverService.resolveAccess()`; ตรวจ category ของ tool กับ `LINE_TOOL_REGISTRY`, entitlement (`hasToolFeature`) และ permission (`hasToolPermissions`); บันทึก audit ทุกการเรียก

**5.9.3 `POST {api}/v1/internal/ai/budget-step`** และ **`/budget-settle`** — `InternalAiBudgetController` · `X-Internal-Secret` · 200 — `budget-step`: v2 `{ version: 2, invocation: AiBudgetInvocationV2, repair? }` หรือแบบเดิม `{ companyId, attemptKey, stepKind, ordinal (1–64), monthKey 'YYYY-MM' }` → จอง+dispatch การเรียกโมเดลครั้งถัดไปของ attempt ที่ API รับไว้แล้ว; `budget-settle`: `{ invocationKey, sourceRoute, requestId?, externalUnits?, usage: { modelId, tag, ok, errorCode?, inputTokens, outputTokens, cacheReadInputTokens, cacheWriteInputTokens, usageBasis? } }` → บันทึกการใช้จริงและปรับยอดจอง · รหัสปฏิเสธ: `AI_BUDGET_REFUSAL_CODES` (`packages/contracts/src/line-ai.ts`)

**5.9.4 `POST {agentcore}/invocations`** — ดูหมวด 4.2

---

## 6. สัญญาร่วมใน `packages/contracts`

แพ็กเกจ `@watchdog-bms/contracts` (`packages/contracts/src/`) เป็น TypeScript ล้วน ไม่มี dependency ของ framework ใช้ร่วมกันโดย `apps/api`, `apps/ai-gateway`, `apps/web`, `apps/workers` เพื่อให้ชนิดข้อมูลบนสาย (wire types), enum/ค่าคงที่, ทะเบียน permission/feature/menu และตัว parse/validate ของสัญญา AI ตรงกันทุกฝั่ง มี 67 ไฟล์ซอร์ส (ไม่นับ `*.spec.ts` 28 ไฟล์ที่ทดสอบสัญญาเอง เช่น `prisma-enum-parity.spec.ts` ตรวจ enum ตรงกับ Prisma) `index.ts` re-export ทุกไฟล์และนิยามชนิดแกนกลาง

| ไฟล์ | บรรทัด | สิ่งที่นิยาม (ตัวอย่าง export จริง) |
|---|---:|---|
| `index.ts` | 311 | ชนิดแกนกลาง `HealthStatus`, `TenantContext`, `AuthProvider`, `RequestContext`, `PermissionKey`, `AuditResult`, `AuditRiskLevel` และ re-export ทั้งแพ็กเกจ |
| `access-matrix.ts` | 214 | ทะเบียนเมนูและตารางสิทธิ์: `MenuId`, `ActionId`, `MENU_REGISTRY`, `PermissionMatrixRow` |
| `feature-entitlements.ts` | 675 | แค็ตตาล็อกฟีเจอร์ที่ขาย/เปิดปิดได้: `FEATURE_CATALOG` (20 คีย์ระดับบน + submenu), `PLATFORM_INVARIANT_FEATURE_KEYS`, `FEATURE_DEPENDENCIES`, `LEGACY_FEATURE_INHERITANCE`, `ALL_FEATURE_ENTITLEMENT_KEYS` |
| `menu-entitlements.ts` | 534 | ผูกเมนูกับ entitlement และ preset ของแพ็ก: `MENU_ENTITLEMENT_BINDINGS`, `FEATURE_PACKAGE_PRESETS`, `TIER_FEATURE_PRESETS`, `SALES_DEAL_ALLOWED_FEATURE_KEYS`, `packageMenuLabels()` |
| `plan-term.ts` | 174 | อายุแพ็กและสถานะล็อก: `PlanTierKey`, `PlanTermState`, `PlanTermNoticeDto`, `PlanTermLockReason`, `FreeExpenseDraftAccess` |
| `billing.ts` | 805 | สัญญา billing ทั้งหมด (171 export): `STRIPE_API_VERSION`, `BILLING_PAID_TIERS`, `BillingOffer`, โหมดซื้อ, quote/attempt/invoice, `BILLING_PERMISSIONS`, `isBillingCustomerRecoveryPath` |
| `billing-labels.ts` | 124 | ป้ายภาษาไทยของ billing: `billingPlanLabel`, `billingOfferLabel`, `billingPermissionLabel`, `billingEventLabel` |
| `billing-company-profile.ts` | 26 | โปรไฟล์ผู้ซื้อสำหรับเอกสารเรียกเก็บ: `BillingCompanyProfile`, `companyBillingProfile()` |
| `buyer-snapshot-v1.ts` | 101 | snapshot ผู้ซื้อบนเอกสาร: `BuyerSnapshotV1`, `validBuyerSnapshotV1()` |
| `sales.ts` | 465 | คอนโซลเซลล์: `SALES_ROLE_KEYS`, `SALES_PERMISSION_KEYS`, `SALES_DEAL_STATUSES`, ชนิดดีล/อีเวนต์/ตั๋วส่วนลด |
| `demo-chat.ts` | 17 | เดโมขาย: `SalesDemoLinkItem`, ข้อความเครดิตเดโม, `isVirtualDemoTarget()` |
| `partner-management.ts` | 709 | คอนโซลผู้ดูแลระบบ/พาร์ตเนอร์: สถานะบริษัท, credential ของ LINE, DTO ของการจัดการร้าน |
| `executive-business.ts` | 394 | รายงานผู้บริหารแพลตฟอร์ม: `EXECUTIVE_ROLE_KEYS`, `EXECUTIVE_PERMISSION_KEYS`, DTO รายงาน |
| `executive-report-words.ts` | 262 | คำและคอลัมน์ export ของรายงานผู้บริหาร: `EXECUTIVE_WORDS`, `EXECUTIVE_EXPORT_SHEETS` |
| `company-team-note.ts` | 42 | บันทึกทีมต่อร้าน: `COMPANY_TEAM_NOTE_MANAGE_PERMISSION` (`system.executive.company_note.manage`), `CompanyTeamNoteDto` |
| `report-labels.ts` | 63 | การจัดประเภทร้านในรายงาน: `REPORT_CLASSIFICATIONS`, `REPORT_INDUSTRY_GROUPS` |
| `external-signup.ts` | 717 | การสมัคร: `SIGNUP_DISCOVERY_SOURCE_OPTIONS`, `SignupOfferKey`, `PublicCompanySignupBody`, `PublicCompanySignupAcceptedDto`, สัญญา LINE signup/support request |
| `legal-acceptance.ts` | 118 | เอกสารกฎหมายปัจจุบันและการยอมรับ: `CURRENT_LEGAL_DOCUMENTS`, `LEGAL_ACCEPTANCE_STATEMENT_VERSION`, `LegalAcceptanceStatusResponse` |
| `data-rights.ts` | 267 | เคสสิทธิ์เจ้าของข้อมูล (PDPA): `DATA_RIGHTS_CASE_TYPES`, `DATA_RIGHTS_CASE_STATUSES`, `DATA_RIGHTS_MANAGE_PERMISSION` |
| `email-delivery.ts` | 40 | สถานะการส่งอีเมลระบบ: `EMAIL_DELIVERY_PURPOSES`, `EMAIL_DELIVERY_STATES`, `SystemEmailDeliveryDto` |
| `home-theme.ts` | 16 | ธีมหน้าแรกสาธารณะ: `HOME_EVENTS`, `HOME_THEME_MANAGE_PERMISSION`, `PublicHomeTheme` |
| `employee-access.ts` | 346 | พนักงาน/บทบาท/ขอบเขตสาขา: `EmployeeAccessStatus`, `BranchScopeMode`, `CapabilityPack`, `THAI_SYSTEM_ROLE_NAMES` |
| `business-policy.ts` | 66 | นโยบายธุรกิจ: `DiscountPolicy`, `PoApprovalPolicy`, `DataRetentionPolicy` |
| `company-profile.ts` | 24 | path ของหน้าโปรไฟล์บริษัท: `COMPANY_PROFILE_SETTINGS_PATH`, `companyProfilePath()` |
| `company-business-type.ts` | 31 | ประเภทธุรกิจของร้าน: `CompanyBusinessType`, `PatchCompanyBusinessTypeRequest` |
| `company-tax-identity.ts` | 369 | ตัวตนทางภาษีของบริษัทและการจดทะเบียน VAT: `LEGAL_IDENTITY_AUTHORITY_REASONS`, `TIN_EXISTENCE_STATUSES`, `VAT_DETAIL_STATUSES` |
| `dbd-tsic-master.ts` | 1106 | ข้อมูลอ้างอิงรหัสกิจกรรมธุรกิจ: `DBD_TSIC_ACTIVITIES` |
| `civil-date.ts` | 223 | วันที่แบบปฏิทิน (ไม่มีเวลา): `CivilDate`, `CIVIL_DATE_PATTERN`, `InvalidCivilDateError`, `DEFAULT_COMPANY_TIME_ZONE` |
| `expenses.ts` | 2282 | สัญญารายจ่ายทั้งหมด (233 export): `EXPENSE_STATUSES`, `CreateExpenseDraftInput`, `UpdateExpenseDraftInput`, ผล extraction, ใบรับรองแทนใบเสร็จ, ลายเซ็น |
| `expense-capture.ts` | 507 | กลุ่ม capture เอกสาร: `EXPENSE_CAPTURE_CONTRACT_VERSION`, สถานะกลุ่ม/ไฟล์/handoff, manifest การอ่าน |
| `expense-capture-allocation.ts` | 384 | นโยบายจัดสรรเอกสาร→รายการ: `EXPENSE_CAPTURE_ALLOCATION_POLICY`, `CaptureFactsDocument` |
| `expense-capture-evidence.ts` | 2 | `expenseCaptureFieldRole` |
| `expense-evidence.ts` | 171 | การประเมินหลักฐานรายจ่าย: `ExpenseEvidenceAssessment`, `EXPENSE_RECEIPT_SOURCE_TYPES` |
| `expense-item-limits.ts` | 2 | `EXPENSE_MAX_ITEM_LINES` |
| `substitute-receipt-presentation.ts` | 11 | `removeSubstituteReceiptDisplayMetadata()` |
| `disbursement-vouchers.ts` | 286 | ใบสำคัญจ่าย: `DISBURSEMENT_VOUCHER_STATUSES`, `DISBURSEMENT_VOUCHER_MAX_LINES`, payee basis |
| `reimbursements.ts` | 2318 | สัญญาเบิกคืน (191 export): สถานะคำขอ/ขั้นอนุมัติ/การจ่าย, `ReimbursementHubBootstrap`, input ของ create/submit/approve/reject/payment, payout destination, claim form |
| `line-reimbursement-draft.ts` | 410 | ร่างใบเบิกจาก LINE: `LINE_REIMBURSEMENT_DRAFT_LIMITS`, `LineReimbursementDraftProposalV1` |
| `tax.ts` | 1081 | ภาษี (113 export): WHT/50 ทวิ, ภ.ง.ด., `WhtRemittance`, `whtPayerIdentity()`, คำบนเอกสาร |
| `transaction-tax.ts` | 387 | ภาษีระดับธุรกรรม: `TRANSACTION_TAX_REGIMES`, `TRANSACTION_TAX_DIRECTIONS`, `TRANSACTION_TAX_TREATMENTS` |
| `accounting-documents.ts` | 556 | เอกสารขาย/บัญชี: `AccountingDocumentType`, `AccountingDocumentStatus`, คู่ค้า (นอกจากคู่ค้า ส่วนใหญ่อยู่นอกขอบเขตแพ็ก 1,999) |
| `ledger.ts` | 447 | บัญชีแยกประเภท: `LedgerAccountClass`, `JournalEntryStatus`, `AccountingPeriodStatus` (นอกขอบเขต) |
| `banking.ts` | 425 | ธนาคาร/กระทบยอด (นอกขอบเขต) |
| `inventory.ts` | 262 | สินค้า/สต๊อก (นอกขอบเขต) |
| `procurement.ts` | 789 | จัดซื้อ/เจ้าหนี้ (นอกขอบเขต) |
| `crm.ts`, `crm-inbox.ts`, `crm-ai.ts`, `crm-campaign.ts` | 771 / 464 / 254 / 60 | CRM, กล่องข้อความ, AI ของ CRM, แคมเปญ (นอกขอบเขต) |
| `workflow.ts` | 378 | Workflow automation: trigger/condition/action/run (นอกขอบเขต) |
| `reports.ts` | 267 | ศูนย์รายงาน: `ReportQueryInput`, `CreateReportExportInput`, `REPORT_PERMISSION_KEYS` (นอกขอบเขต) |
| `dashboard.ts` | 74 | แดชบอร์ด: `DashboardPeriodKind`, `DashboardWidget`, `DashboardSnapshotDto` |
| `notifications.ts` | 135 | การแจ้งเตือน: `NotificationSeverity`, `NotificationChannel`, `NotificationTriggerKey` |
| `ai-tools.ts` | 1544 | ทะเบียนเครื่องมือ ERP ของ AI: `ToolCategory`, `LINE_TOOL_REGISTRY`, `LINE_ALLOWED_TOOL_CATEGORIES`, `ToolMeta`, `ToolResult`, `hasToolFeature()`, `hasToolPermissions()` |
| `line-ai.ts` | 2337 | สัญญา LINE AI (186 export): `LineAiTurnRequest`/`Response`, `LINE_AI_AGENT_REGISTRY`, intent/agent/refusal, `AI_BUDGET_REFUSAL_CODES`, `DEFAULT_CHAT_CREDIT_SATANG`, task projection, semantic subrequests, `LINE_AI_RUNTIME_CONTRACT_VERSION` |
| `line-ai-input-evidence.ts` | 168 | หลักฐานอินพุต v2: `LineAiInputEvidenceV2`, `parseLineAiInputEvidence()` |
| `line-ai-prepared-plan.ts` | 316 | แผนที่เตรียมไว้: `LINE_AI_PREPARED_PLAN_BOUNDS`, `parseLineAiPreparedPlan()` |
| `line-ai-advisor-answer.ts` | 205 | คำตอบที่ปรึกษา: `parseLineAiPreparedAdvisorAnswer()`, เกณฑ์ความมั่นใจ |
| `line-ai-value-normalizer.ts` | 1897 | ตัวแปลงจำนวนเงิน/วันที่/งวดจากข้อความไทย: `LineAiValueCandidates`, `extractValueCandidates()` |
| `line-ai-public-lookup.ts` | 95 | นโยบายค้นข้อมูลสาธารณะ: `PUBLIC_LOOKUP_TOPICS`, `PUBLIC_LOOKUP_POLICIES` |
| `line-ai-security-eval.ts` | 304 | ชุดกรณีทดสอบความปลอดภัยของสัญญา AI |
| `line-document-qa.ts` | 361 | ถาม-ตอบเอกสารทาง LINE: `LINE_DOCUMENT_QA_LIMITS`, `LINE_DOCUMENT_QA_MIME_TYPES`, สถานะงาน |
| `line-external-browser.ts` | 123 | การเปิดลิงก์นอก LINE in-app browser: `LINE_EXTERNAL_BROWSER_PARAM`, `lineSignedInOpenUrl()` |
| `ai-draft-suggestion.ts` | 376 | โมดูล AI แนะนำ: `AiSuggestionDomain`, `AiDraftRequestStatus`, `AiSuggestionStatus` |
| `ai-budget-bounds.ts` | 392 | งบ AI: `AiBudgetStepKind`, `AI_BUDGET_STEP_BOUNDS`, `AiBudgetGrantV2`, `aiBudgetInvocationKey()` |
| `ai-lineage.ts` | 58 | `AiModelLineage`, `AiModelPolicy`, `AiUsageEntry`, `AiUsageBasis` |
| `ai-timeouts.ts` | 50 | เพดานเวลา AI: `AI_DOCUMENT_OCR_TIMEOUT_MS`, `aiGatewayClientTimeoutMs()` |

แพ็กเกจร่วมอื่น: `packages/config/src/index.ts` (schema ของ env ด้วย zod สำหรับ api/gateway/workers/web และ `validateProductionConfig`), `packages/design-tokens` (token ของ UI; ไม่เกี่ยวกับ API)

---

## 7. สัญญาระหว่างบริการและคิวงานเบื้องหลัง

### 7.1 แผนผังการเรียกระหว่างบริการ

| ผู้เรียก → ผู้ถูกเรียก | ช่องทาง | การยืนยันตัวตน | Base URL (env) | หลักฐาน |
|---|---|---|---|---|
| web (เบราว์เซอร์) → api | HTTPS same-origin `/api/v1/*` (rewrite) | cookie `watchdog_token` + CSRF ที่ชั้นเว็บ | `apiOrigin` ใน `next.config.mjs` | หมวด 1.8 |
| web (BFF/server) → api | HTTP ภายใน | Bearer จาก cookie หรือไม่มี (route สาธารณะ) | `INTERNAL_API_URL` | `apps/web/src/common/api/internal-api-base.ts` |
| api → ai-gateway | HTTP ภายใน `POST /v1/internal/ai/*` | `X-Internal-Secret` | URL ของ gateway ใน config ของ api | `line-ai/infrastructure/ai-gateway.client.ts`, `expenses/infrastructure/receipt-ocr.client.ts`, `expense-capture-read.client.ts`, `ai-draft/infrastructure/provider/ai-gateway-draft.provider.ts`, `crm-inbox/infrastructure/crm-ai-gateway.client.ts`, `banking/infrastructure/statement-ai-extract.client.ts` |
| ai-gateway → AgentCore runtime | AWS Bedrock AgentCore invoke (ARN/id + qualifier) → `POST /invocations` | IAM ของ AWS (ฝั่ง gateway) | config AgentCore | `modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts`, `agentcore/runtime.ts` |
| ai-gateway / AgentCore → api | HTTP ภายใน `POST /v1/internal/ai/tools/invoke`, `/budget-step`, `/budget-settle` | `X-Internal-Secret` (+ `X-Actor-Delegation` สำหรับ tools) | `ERP_CORE_INTERNAL_URL` | `modules/line-ai/infrastructure/erp-tool.client.ts`, `common/usage/ai-budget-seam.ts` |
| workers → api | HTTP ภายใน `POST /v1/internal/*` | `X-Worker-Token` (+ `X-Idempotency-Key` สำหรับงานแจ้งเตือนรายรายการ) | `INTERNAL_API_URL` (ค่าเริ่มต้น `http://localhost:3001/v1`) | `apps/workers/src/common/internal-api.ts` |
| LINE Platform → api | HTTPS webhook | `x-line-signature` | — | หมวด 3.3 |
| Stripe / Postmark / SNS → api | HTTPS webhook | ลายเซ็น/Basic/SNS signature | — | หมวด 3.3 |
| api → LINE / Stripe / Postmark / SES / S3 | HTTPS ขาออก | credential ของผู้ให้บริการ (ไม่บันทึกในเอกสารนี้) | — | adapter ใน `infrastructure/` ของแต่ละโมดูล |

หลักการที่บังคับในโค้ด: AI Gateway **ไม่มี**การเข้าฐานข้อมูล ทุกข้อมูล ERP ผ่าน `tools/invoke` ที่ API ตรวจ permission/entitlement ใหม่จากฐานข้อมูล (ไม่เชื่อ permission ที่ gateway ส่งมา); งบ AI ตัดสินที่ API เท่านั้น (gateway ขอ `budget-step` ก่อนเรียกโมเดลและ `budget-settle` หลังเรียก)

### 7.2 สัญญา ai-gateway ↔ api

**api → gateway** (รายการ path เต็มในหมวด 4.1): header `Content-Type: application/json`, `X-Internal-Secret`; timeout ฝั่ง client คำนวณจาก `packages/contracts/src/ai-timeouts.ts` (`aiGatewayClientTimeoutMs`); ชนิด request/response อยู่ใน `line-ai.ts`, `line-document-qa.ts`, `expense-capture.ts`, `expenses.ts` (ผล OCR), `crm-ai.ts`, `ai-draft-suggestion.ts`, `banking.ts` ของ `packages/contracts`

**gateway → api `POST /v1/internal/ai/tools/invoke`** (รายละเอียด field ในหมวด 5.9.2)

- ผลลัพธ์ฝั่ง client (`ErpToolClient`) แปลงความล้มเหลวเป็น `ToolResult.status='error'` พร้อม `errorCode`: `POLICY_DENIED`, `MISSING_REQUIRED_INPUT`, `INTERNAL_SECRET_NOT_CONFIGURED`, `ACTOR_DELEGATION_MISSING`, `TOOL_TIMEOUT` (เกิน `AI_TOOL_TIMEOUT_MS`), `HTTP_<status>`
- Actor delegation: API ออก delegation แบบใช้ครั้งเดียวต่อชื่อ tool (จำนวนต่อ tool จำกัดด้วย `LINE_AI_ACTOR_DELEGATIONS_PER_TOOL`) ส่งมากับ `LineAiTurnRequest.actorDelegations`; gateway หยิบทีละใบส่งใน header `X-Actor-Delegation`
- ทะเบียน tool: `LINE_TOOL_REGISTRY` (`packages/contracts/src/ai-tools.ts`) — ชื่อ tool รูปแบบ `<module>.<action>` (เช่น `expense.list_recent`, `reimbursement.get_summary`, `billing.get_package_catalog`, `voucher.get_detail`, `wht.get_month_summary`); หมวด tool ที่ LINE ใช้ได้กำหนดด้วย `LINE_ALLOWED_TOOL_CATEGORIES` + `LINE_DRAFT_UPDATE_TOOL_CATEGORY`; หมวด `final_mutation`/`approval_request` ถือเป็น mutation (`MUTATION_TOOL_CATEGORIES` ใน `internal-tools.controller.ts`)
- Tool class ที่ลงทะเบียนใน `InternalToolsController` ครอบคลุม: บริษัท/สาขา/พนักงาน, แดชบอร์ด/แจ้งเตือน, รายจ่าย (list/detail/breakdown/daily closing/explain/ร่าง: set header, set line, add charge, remove line, set VAT mode/action preview), เบิกคืน (summary/detail/pending approvals/backlog/ร่างใบเบิก: options, preview create/update), ใบรับรองแทนใบเสร็จที่รอลงนาม, ใบสำคัญจ่าย/WHT (list/detail/month summary/calculate), แพ็กเกจ (catalog/usage), คู่ค้า (search/detail/action preview), การดำเนินการของทีม, public lookup admission, อธิบายความพยายามส่งไฟล์ และ tool ของโมดูลนอกขอบเขต (สต๊อก, ขาย, บัญชีแยกประเภท, ภาษีเต็ม, workflow, จัดซื้อ, ธนาคาร, CRM) — ซึ่งถูกตัดด้วย entitlement ของบริษัทเมื่อไม่ได้เปิดฟีเจอร์

**gateway → api budget seam** (`common/usage/ai-budget-seam.ts`): `POST /v1/internal/ai/budget-step` และ `/budget-settle` (หมวด 5.9.3); เมื่อ secret ไม่ได้ตั้ง/หมดเวลา/ไม่ตอบ 2xx ฝั่ง gateway ได้ `{ ok: false }` และต้องถือว่าไม่ได้รับอนุญาตให้เรียกโมเดล

### 7.3 สัญญา workers ↔ api และคิวงาน (BullMQ บน Redis)

กติการ่วม (`apps/workers/src/common/queue.ts`, `scan-worker.ts`, `internal-api.ts`): ทุกคิวสร้างผ่าน `createQueue()` (เก็บงานสำเร็จ 48 งาน / ล้มเหลว 100 งานล่าสุด); retry ตาม `QUEUE_RETRY_ATTEMPTS`/`QUEUE_RETRY_BACKOFF_MS` (exponential) ; เมื่อ `DLQ_ENABLED` งานที่ล้มเหลวครั้งสุดท้ายถูกคัดลอกไปคิว `<queue>-dlq` (เก็บ 500 งาน) ; worker ทำงาน concurrency 1 ; `postInternal()` ถือ `404` เป็น "endpoint ยังไม่ deploy" (ข้ามรอบและถอยห่าง 5 นาที) ; ทุก endpoint ที่ worker เรียกเป็น sweep แบบ idempotent ; worker ทั้งหมดเริ่มเมื่อ `QUEUE_ENABLED` เป็นจริง ; SIGTERM → ปิด health server แล้ว `worker.close()` ภายใน `WORKER_SHUTDOWN_TIMEOUT_MS`

| คิว | Job kind (payload) | รอบ | Scheduler/job id | API ที่เรียก (`POST /v1` + …) | ไฟล์ worker |
|---|---|---|---|---|---|
| `billing-events` | `billing-events-drain` `{kind}` | 10 วินาที | `billing-events-drain` | `/internal/billing/drain` | `modules/billing/billing-worker.ts` |
| `billing-scan` | `billing-scan` | 30 วินาที | `billing-scan` | `/internal/billing/scan` | เดียวกัน |
| `billing-discovery` | `billing-discovery` | 10 วินาที | `billing-discovery` | `/internal/billing/provider-scans/drain` | เดียวกัน |
| `billing-notifications` | `billing-notifications-drain` | 10 วินาที | `billing-notifications-drain` | `/internal/billing/notifications/drain` | เดียวกัน |
| `notifications` | `delivery.sweep` `{kind,data:{}}` | 30 วินาที | `notifications-delivery-sweep` | `/internal/notifications/delivery-sweep` | `modules/notifications/notification-worker.ts`, `notification-jobs.ts` |
| `notifications` | `snapshot.sweep` | 15 นาที | `notifications-snapshot-sweep` | `/internal/notifications/snapshot-sweep` | เดียวกัน |
| `notifications` | `stock_low.sweep` | 60 นาที | `notifications-stock-low-sweep` | `/internal/notifications/stock-low-sweep` | เดียวกัน |
| `notifications` | `daily_owner_summary.sweep` | cron `0 7 * * *` Asia/Bangkok (attempts 5, backoff 60 วินาที) | `notifications-daily-owner-summary-sweep` | `/internal/notifications/daily-owner-summary-sweep` | เดียวกัน |
| `notifications` | `snapshot.generate` `{companyId, periodKind: 'today'\|'week'\|'month', idempotencyKey}` | ตามที่ enqueue | — | `/internal/companies/:companyId/dashboard/snapshots/generate` (body `{periodKind}`, header `X-Idempotency-Key`) | เดียวกัน |
| `notifications` | `daily_owner_summary` `{companyId, periodKey: 'YYYY-MM-DD', idempotencyKey}` | ตามที่ enqueue | — | `/internal/companies/:companyId/notifications/daily-owner-summary` (`{periodKey}`) | เดียวกัน |
| `notifications` | `stock_low.scan` `{companyId, idempotencyKey}` | ตามที่ enqueue | — | `/internal/companies/:companyId/notifications/scan/stock-low` | เดียวกัน |
| `notifications` | `delivery.process` / `delivery.retry` `{companyId, deliveryId, channel: 'web'\|'line', idempotencyKey}` | ตามที่ enqueue | — | `/internal/companies/:companyId/notification-deliveries/:deliveryId/process` (`{channel}`) | เดียวกัน |
| `plan-term-sweep` | `plan-term-sweep-scan` | 5 นาที | `plan-term-sweep-scan` | `/internal/plan-term/sweep` | `modules/plan-term-sweep/plan-term-sweep-worker.ts` |
| `sales-sweep` | `sales-expire-sweep` | 15 นาที | `sales-expire-sweep` | `/internal/sales/deals/expire-sweep` | `modules/sales/sales-sweep-worker.ts` |
| `sales-sweep` | `sales-renewal-sweep` | 15 นาที | `sales-renewal-sweep` | `/internal/sales/deals/renewal-sweep` | เดียวกัน |
| `sales-sweep` | `sales-daily-digest` | cron `0 7 * * *` Asia/Bangkok | `sales-daily-digest` | `/internal/sales/daily-digest` | เดียวกัน |
| `executive-rebuild` | `executive-rebuild` | 60 นาที | `executive-rebuild` | `/internal/executive/rebuild` | `modules/executive/executive-rebuild-worker.ts` |
| `signup-claim-email` | `signup-claim-email-drain` | 30 วินาที | `signup-claim-email-drain` | `/internal/signup-claim-email/drain` | `modules/signup-claim-email/signup-claim-email-worker.ts` |
| `signup-claim-reminder` | `signup-claim-reminder-sweep` | 15 นาที | `signup-claim-reminder-sweep` | `/internal/signup-claim-email/reminder-sweep` | เดียวกัน |
| `workflow` | `outbox.drain` | 30 วินาที | `workflow-outbox-drain` | `/internal/workflow/outbox/drain` (`{}`) | `modules/workflow/workflow-worker.ts`, `workflow-jobs.ts` |
| `workflow` | `object-version-cleanup.drain` | 30 วินาที | `object-version-cleanup-drain` | `/internal/storage-cleanup/object-versions/claim` → ลบ object version ใน S3 → `/…/:id/complete` หรือ `/…/:id/fail` | `modules/object-version-cleanup/object-version-cleanup-worker.ts` |
| `workflow` | `scan.threshold` / `scan.sla` / `scan.schedule` | 15 นาที | `workflow-scan-threshold` / `-sla` / `-schedule` | `/internal/workflow/scan` (`{triggerType: 'THRESHOLD_SCAN'\|'SLA_SCAN'\|'SCHEDULE'}`) | `workflow-worker.ts` |
| `workflow` | `action.retry` | 60 วินาที | `workflow-action-retry` | `/internal/workflow/action-runs/retry` (`{}`) | เดียวกัน |
| `ai-draft` | `draft.drain` | 15 วินาที | `ai-draft-drain` | `/internal/ai/draft-requests/drain` | `modules/ai-draft/ai-draft-worker.ts` |
| `line-ai-ledger` | `ledger.drain` | `LINE_AI_LEDGER_RECLAIM_INTERVAL_MS` (ค่าเริ่มต้น 60 วินาที) | `line-ai-ledger-drain` | สามคำขอต่อรอบ: `/internal/ai/line-ledger/sweep-orphan-events` (`{batchSize:20}`), `/internal/ai/line-ledger/drain` (`{batchSize:20}`), `/internal/ai/line-capture-results/drain` (`{batchSize:25}`) | `modules/line-ai-ledger/line-ai-ledger-worker.ts` |
| `expense-capture-read` | `expense-capture-read-scan` | 30 วินาที | `expense-capture-read-scan` | `/internal/expenses/capture-read/drain` | `modules/expense-capture-read/expense-capture-read-worker.ts` |
| `expense-auto-post` | `expense-auto-post-scan` | 60 วินาที | `expense-auto-post-scan` | `/internal/ledger/expense-auto-post/drain` | `modules/expense-auto-post/expense-auto-post-worker.ts` |
| `reimbursement-reconcile` | `reimbursement-reconcile-scan` | 2 นาที | `reimbursement-reconcile-scan` | `/internal/reimbursements/reconcile` | `modules/reimbursement-reconcile/reimbursement-reconcile-worker.ts` |
| `crm-inbox` | `sla.scan`, `newconv.scan`, `retry.scan`, `autonomy.scan`, `reminder.scan`, `proposal.sweep` | 60 วินาทีแต่ละชนิด | `crm-inbox-<…>-scan` / `-sweep` | `/internal/crm/sla-breach-scan`, `/new-conversation-scan`, `/inbox-retry-scan`, `/autonomy-retry-scan`, `/booking-reminder-scan`, `/booking-proposal-sweep` | `modules/crm-inbox/crm-sla-worker.ts` |
| `crm-pdpa` | `pdpa.purge` / `pdpa.erasure` | 24 ชั่วโมง / 5 นาที | `crm-pdpa-purge` / `crm-pdpa-erasure` | `/internal/crm/pdpa-purge` (วนจนหมด), `/internal/crm/pdpa-erasure-process` | `modules/crm-inbox/crm-pdpa-worker.ts` |
| `crm-trust` | `trust.scan` | 60 นาที | `crm-trust-score-scan` | `/internal/crm/trust-score-scan` | `modules/crm-inbox/crm-trust-worker.ts` |
| `crm-campaign-delivery` | `deliver` | 15 วินาที | `crm-campaign-delivery` | `/internal/crm/campaign-delivery-scan` | `modules/crm-inbox/crm-campaign-worker.ts` |

รวม 20 คิว (ไม่นับคิว DLQ) — คิวที่เกี่ยวกับขอบเขตแพ็ก 1,999 โดยตรง: `billing-*`, `notifications`, `plan-term-sweep`, `sales-sweep`, `executive-rebuild`, `signup-claim-*`, `workflow` (เฉพาะ `outbox.drain` และ `object-version-cleanup.drain` ซึ่งเป็นโครงสร้างพื้นฐาน), `ai-draft`, `line-ai-ledger`, `expense-capture-read`, `reimbursement-reconcile`; ส่วน `crm-*`, `expense-auto-post` และ workflow scan/retry รับใช้ฟีเจอร์นอกขอบเขต

**Outbox:** use case ที่เปลี่ยนสถานะธุรกิจเขียนแถว `OutboxEvent` ใน transaction เดียวกับข้อมูล (เช่น submit ใบเบิก — `reimbursement-request.use-case.ts`) แล้ว `POST /v1/internal/workflow/outbox/drain` เป็นผู้เผยแพร่ต่อ (แจ้งเตือน/กฎ workflow)

**งานในโปรเซส API (ไม่ผ่าน BullMQ):** บัฟเฟอร์ข้อความ LINE ต่อแชต (`LineMessageBufferService`) ทำงานในโปรเซส `apps/api` และ drain เมื่อ shutdown

**Endpoint ภายในที่ไม่พบผู้เรียกใน `apps/workers`** (จากการ grep path): `POST /v1/internal/ai/draft-requests/generate`, `POST /v1/internal/ai/line-document-qa/drain`, `POST /v1/internal/crm/pdpa-post-restore-re-erasure`, `POST /v1/internal/feature-launch/runoff/sweep`, `…/runoff/draining`, `POST /v1/internal/workflow/events/ingest`, `GET /v1/internal/health/readiness` — เป็น endpoint สำหรับ operator/สคริปต์/health check หรือผู้เรียกอื่นที่ไม่ได้อยู่ใน worker (ดูหมวด 10)

---

## 8. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

รายการต่อไปนี้มี endpoint ในโค้ดแต่ permission ถูก gate ด้วย feature key ที่ไม่อยู่ใน `TIER_FEATURE_PRESETS` ของแพ็กใด (คอลัมน์ "ไม่ขาย" ในหมวด 2.0 รวม 331 endpoint) จึงไม่ลงรายละเอียดในหมวด 5 รายการ endpoint ครบถ้วนยังอยู่ในหมวด 2

| โมดูล / กลุ่ม endpoint | Feature key ที่ gate | จำนวน endpoint "ไม่ขาย" |
|---|---|---:|
| `inventory` — สินค้า คลัง ความเคลื่อนไหว QR/ฉลาก | `inventory`, `product_catalog` | 29 |
| `procurement` — ผู้ขาย ใบขอซื้อ ใบสั่งซื้อ รับสินค้า ใบแจ้งหนี้ผู้ขาย จ่ายเจ้าหนี้ ภ.พ.36 | `procurement` (+ sub-keys) | 51 |
| `banking` — บัญชีธนาคาร statement การจับคู่ กระทบยอด รายการปรับปรุง | `bank_reconciliation` | 29 |
| `ledger` — ผังบัญชี สมุดรายวัน งวดบัญชี งบการเงิน posting rule | `double_entry_ledger` (และ `expense_auto_post`) | 28 |
| `crm` — ลูกค้า ลีด โอกาสขาย การติดตาม การจอง AI ของ CRM | `crm` | 49 |
| `crm-inbox` — กล่องข้อความ ช่องทาง LINE OA ของร้าน แม่แบบ แคมเปญ นโยบายกล่องข้อความ | `crm`, `line_oa` | 42 |
| `accounting-documents` — เอกสารขาย (ใบเสนอราคา ใบแจ้งหนี้ ใบเสร็จ ใบกำกับภาษี) การรับชำระ หมวดรายได้ รายรับแบบง่าย | `sales_documents` | 20 |
| `tax` — พื้นที่ทำงานภาษีเต็ม (โปรไฟล์ภาษี งวด VAT/ภ.พ.30 CIT รายงานภาษี ภาษีระดับธุรกรรม) ยกเว้น ภ.ง.ด.3/53 และ 50 ทวิ | `thai_tax` | 40 |
| `workflow` — กฎ workflow แม่แบบ รอบการทำงาน งาน webhook dead letter | `workflow_automation` | 24 |
| `reports` — ศูนย์รายงาน/BI (query, drilldown, views, exports) | `reports` | 7 (อีก 5 endpoint ใช้ permission ชุด "retained" ที่ไม่ถูกตัด แต่ use case ยังเรียก `assertFeatureEnabled` ตามคอมเมนต์ใน `feature-gate.logic.ts`) |
| `dashboard-notifications` — ค่ากำหนดการแจ้งเตือนรายบุคคล และกฎการแจ้งเตือน | `dashboard_notifications.preferences`, `dashboard_notifications.rules` | 4 |
| `employee-access` (business policy) — นโยบายส่วนลด, การอนุมัติ PO, นโยบายเก็บรักษาข้อมูล/ความยินยอม | `crm`, `procurement`, `line_oa` | 8 |
| ai-gateway: `crm-*` (8 route), `bank-statement-extract` | รับใช้ CRM/ธนาคาร | — |
| workers: คิว `crm-inbox`, `crm-pdpa`, `crm-trust`, `crm-campaign-delivery`, `expense-auto-post`, workflow scan/retry | รับใช้ฟีเจอร์ข้างต้น | — |

หมายเหตุ: endpoint "ทุกแพ็ก" บางตัวในโมดูลข้างต้น (เช่น คู่ค้า `accounting/counterparties`, `income-expense-ledger`, WHT handoff ภายนอก) **อยู่ในขอบเขต** เพราะ permission ผ่าน gate ด้วยคีย์ `expenses` หรือไม่ถูก gate

---

## 9. รายการ FR/NFR ของชั้น API

AREA code ของเอกสารนี้คือ `API` ความต้องการเชิงธุรกิจของแต่ละโมดูลอยู่ในเอกสาร SRS (02x) รายการด้านล่างครอบคลุมพฤติกรรมของชั้น API ที่ทุกโมดูลพึ่งพา

### 9.1 Functional requirements

| ID | ชื่อ | คำอธิบาย / กฎหลัก | ผู้ใช้ / permission | แพ็ก | เงื่อนไขก่อนทำ → ขั้นตอนหลัก | ข้อผิดพลาด | Prisma models | Endpoints | หน้าจอ (web) | การทดสอบ |
|---|---|---|---|---|---|---|---|---|---|---|
| FR-API-001 | ยืนยันตัวตนด้วย token/cookie | ทุก route ที่ไม่ `@Public` ต้องมี access JWT (Bearer หรือ cookie `watchdog_token`) ที่ผูกกับ `AuthSession` ACTIVE | ผู้ใช้ทุกคน | ทุกแพ็ก + แพลตฟอร์ม | มีเซสชัน → guard ตรวจลายเซ็น, session claim, แถวเซสชัน → สร้าง `RequestContext` | 401 | `AuthSession`, `CompanyMembership`, `UserCredential` | ทุก route (หมวด 2) | ทุกหน้าใต้ `/companies/*`, `/system/*` | `apps/api/src/modules/auth/auth.guard.spec.ts`, `auth-endpoints.spec.ts` |
| FR-API-002 | Deny-by-default permission | route ต้องมี permission metadata; `@RequirePermissions` = ครบทุกคีย์, `@RequireAnyPermission` = อย่างน้อยหนึ่ง | ตาม permission ของ role | ทุกแพ็ก | resolve permission จาก role ที่ ACTIVE → ตรวจกับ metadata | 403 `Insufficient permissions.` / `Permission metadata is required.` | `Role`, `Permission`, `CompanyMembership` | ทุก route | — | `apps/api/src/modules/access-control/permission-resolver.spec.ts` |
| FR-API-003 | Feature entitlement gate | permission ของฟีเจอร์ที่บริษัทไม่ได้เปิดถูกตัดตอน resolve; ตอบ `feature_not_enabled` เมื่อ permission ที่ขาดทั้งหมดถูกตัดด้วย gate | ทุกผู้ใช้รวม OWNER | ตาม `TIER_FEATURE_PRESETS` | โหลด entitlement ของบริษัท → กรอง permission | 403 `{code:'feature_not_enabled', featureKey}` | `CompanyFeatureEntitlement`, `CompanyEntitlementSet` | ทุก route ธุรกิจ | เมนู workspace ซ่อน/แสดงตามสิทธิ์ | `packages/contracts/src/feature-entitlements.spec.ts`, spec ใน `employee-access/` |
| FR-API-004 | แยก tenant ด้วย path/header | `:companyId` กับ `X-Company-Id` ต้องตรงกัน; context ผูกกับ membership ของบริษัทนั้น | ทุกผู้ใช้ | ทุกแพ็ก | — | 403 `Route company does not match request context.` | `CompanyMembership`, `Company` | `/v1/companies/:companyId/*` | — | `auth.guard.spec.ts` |
| FR-API-005 | ประตูสถานะบัญชี/บริษัท | บังคับเปลี่ยนรหัสชั่วคราว, ยอมรับข้อตกลง, อายุแพ็ก, platform ปิด, โหมด free-expense-drafts, เซสชันเดโม พร้อมรายการ route ยกเว้น/กู้คืน | ทุกผู้ใช้ (ยกเว้น `SYSTEM_ADMIN` บางประตู) | ทุกแพ็ก | — | 403 `legal_acceptance_required` / `company_term_expired` / `FREE_EXPENSE_DRAFTS_ONLY`, 410 `demo_link_expired`, 503 `platform_access_closed` | `UserCredential`, `CompanyPlanTerm`, `LegalDocumentActionRecord`, `SalesDemoLink` | ทุก route; ยกเว้นตามหมวด 1.2 | `/change-password`, `/legal-acceptance`, หน้า renew | `auth.guard.spec.ts`, `free-expense-handoff.spec.ts`, `apps/api/src/modules/auth/presentation/demo-chat-expiry.spec.ts` |
| FR-API-006 | เข้าสู่ระบบและวงจรเซสชัน | login ด้วยรหัสผ่าน/LINE/QR/อีเมล OTP, refresh แบบหมุน token, logout, revoke-others | ผู้ใช้ทุกคน; `account.session.read` | ทุกแพ็ก | หมวด 5.1 | 401/403/429 | `AuthSession`, `UserCredential` | `/v1/auth/*` (65 endpoint) | `/login`, `/line-qr`, `/email-access` | `apps/api/src/modules/auth/presentation/auth.controller.spec.ts`, `line-handoff.spec.ts`, `apps/web/src/common/api/authed-fetch.spec.ts` |
| FR-API-007 | BFF เก็บ token ใน cookie httpOnly | token ไม่ถึง JS ของเบราว์เซอร์; CSRF double-submit; same-origin สำหรับ mutation | ผู้ใช้เว็บ | ทุกแพ็ก | หมวด 1.8, 4.3 | 403 `csrf_token_invalid`, 502 | — | `/api/auth/*` (18 handler) | ทุกหน้า | `apps/web/src/common/auth/auth-cookies.constants.spec.ts`, `change-password-bff.server.spec.ts` |
| FR-API-008 | สมัครใช้งานสาธารณะ | สมัครผ่านเว็บ/LINE/อีเมล, claim ด้วยลิงก์อีเมล, ขอเปลี่ยนแพ็ก | ผู้เยี่ยมชม (Public) | — | หมวด 5.2 | 400/429 | `CompanySignupRequest` | `/v1/public/*` (หมวด 3.1) | `/signup`, `/claim-account`, หน้า LIFF | `apps/api/src/modules/line-ai/line-first-signup-webhook.spec.ts` และ spec ใน `external-signup/` |
| FR-API-009 | รับ webhook ของผู้ให้บริการ | LINE, Stripe, Postmark, SES ตรวจลายเซ็นกับ raw body ก่อนประมวลผล; ตอบเร็วแล้วทำงานต่อแบบ async | ระบบภายนอก | — | หมวด 3.3, 5.7.7, 5.8 | 401/403/413 | `BillingProviderEvent` และตารางบัฟเฟอร์/เหตุการณ์ของ LINE | 6 endpoint webhook | — | spec ใน `auth/`, `billing/`, `external-signup/` |
| FR-API-010 | อัปโหลดไฟล์แบบ intent → direct upload → complete | ไฟล์ไม่ผ่าน API; API ออก presigned URL และยืนยันหลังอัปโหลด (ขนาด/เช็กซัม) | ตาม permission ของโมดูล | ทุกแพ็ก | หมวด 5.3, 5.4 | 400/409 | `ExpenseCaptureGroup` และตารางไฟล์แนบของแต่ละโมดูล | attachments, capture-groups, payment slip, signature, external WHT file | หน้าอัปโหลดรายจ่าย/ใบเบิก | spec ใน `expenses/`, `reimbursements/presentation/http/reimbursement.dtos.spec.ts` |
| FR-API-011 | Idempotency ของคำสั่ง | คำสั่งที่มีผลทางการเงินรับ `Idempotency-Key` (header) หรือ `idempotencyKey` (body); `X-Request-Id` ใช้เป็นคีย์ของ OCR admission | ตามโมดูล | ทุกแพ็ก | — | 409 เมื่อคีย์เดิมกับ payload ต่าง (ตาม use case) | ตารางคำสั่ง/attempt ของ billing, `ReimbursementPayment` | 27 handler ที่มี `H:idempotency-key` | — | spec ใน `billing/`, `reimbursements/` |
| FR-API-012 | Optimistic concurrency | การแก้ไขส่ง `expectedUpdatedAt`/`version`/`approvalSnapshotHash`/`snapshotHash`/`previewHash` | ตามโมดูล | ทุกแพ็ก | — | 409 (`EXPENSE_UPDATE_CONFLICT` ฯลฯ) | ตามโมดูล | PATCH expenses, approve/reject, billing command | — | `expenses/application/use-cases/expense-draft-concurrency.use-case.spec.ts` |
| FR-API-013 | Endpoint ภายในสำหรับ worker | route `/v1/internal/*` ป้องกันด้วย `X-Worker-Token`; ทุกตัวเป็น sweep แบบ idempotent | บริการ workers | — | หมวด 7.3 | 401 | `OutboxEvent` และตารางคิวของโมดูล | 49 handler | — | `apps/api/src/common/security/worker-token.spec.ts`, `apps/workers/src/common/internal-api.spec.ts` |
| FR-API-014 | AI Gateway เรียก ERP ผ่าน tool ที่ตรวจสิทธิ์ | gateway ไม่มี DB; `tools/invoke` ตรวจ secret + actor delegation แล้ว resolve สิทธิ์ใหม่; บันทึก audit | บริการ ai-gateway | ทุกแพ็ก (`ai_line_assistant`) | หมวด 5.9, 7.2 | 401; `ToolResult.errorCode` | `AuditLog` | `/v1/internal/ai/tools/invoke` | — | `apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts`, `apps/ai-gateway/src/auth/ai-auth.spec.ts` |
| FR-API-015 | งบ AI แบบจอง–ชำระ | ทุกการเรียกโมเดลต้องจองกับ API ก่อน (`budget-step`) และรายงานการใช้จริง (`budget-settle`) | บริการ ai-gateway | ทุกแพ็ก + add-on เครดิตแชต | หมวด 5.9.3 | รหัส `AI_BUDGET_*` | `AiBudgetReservation`, `CompanyAiMonthlyUsage`, `CompanyAiMonthlyBucketUsage`, `CompanyAiConfiguration` | `/v1/internal/ai/budget-step`, `/budget-settle` | — | `internal-ai-budget.controller.spec.ts`, `packages/contracts/src/ai-budget-bounds-v2.spec.ts` |
| FR-API-016 | AgentCore runtime protocol | `GET /ping`, `POST /invocations` พร้อมเพดาน body/ข้อความ/ไฟล์แนบ/concurrency | AI Gateway | ทุกแพ็ก | หมวด 4.2 | 400/413/429/500 | — | AgentCore | — | `apps/ai-gateway/src/agentcore/runtime.spec.ts`, `runtime-minimal-env.spec.ts` |
| FR-API-017 | แค็ตตาล็อกและการซื้อแพ็ก | catalog สาธารณะ → quote → checkout (Stripe) → ติดตาม attempt → เอกสาร; route กู้คืนใช้ได้แม้แพ็กหมดอายุ | เจ้าของร้าน (`account.session.read` + อำนาจใน service) | ทุกแพ็ก | หมวด 5.7 | 400/403/429 | `BillingQuote`, `BillingAttempt`, `BillingInvoice`, `BillingAccount`, `BillingSubscriptionContract` | `/v1/billing/catalog`, `/v1/companies/:companyId/billing/*` | หน้า billing/แพ็กเกจ | spec ใน `billing/application/*.spec.ts` |
| FR-API-018 | คอนโซลผู้ดูแล/เซลล์/ผู้บริหาร | route `/v1/system/*`, `/v1/sales/*` ใช้ permission ตระกูล `system.*`/`sales.*`; เซลล์ต้องผ่าน `SalesAgentActiveGuard` | SYSTEM_ADMIN, บทบาทเซลล์, บทบาทผู้บริหาร | แพลตฟอร์ม | — | 403 | ตารางของ billing/sales/partner | หมวด 2 โมดูล `billing` (admin), `sales-console`, `system-*`, `executive-business`, `data-rights` | `/system/*`, `/sales/*` | spec ในโมดูลนั้น ๆ |

### 9.2 Non-functional requirements

| ID | ชื่อ | ข้อกำหนดที่บังคับในโค้ด | หลักฐาน |
|---|---|---|---|
| NFR-API-001 | Rate limiting | ทุก request ถูกจำกัดต่อ IP (ค่าเริ่มต้น 120/60 วินาที; production ต้องเปิด) และมี bucket เฉพาะสำหรับ login/reset/สมัคร/OTP/AI/billing; bucket ที่ป้องกัน credential หรือค่าใช้จ่าย fail-closed | `api-rate-limit.guard.ts`, `auth-rate-limit.service.ts`, `redis-rate-limit.service.ts`, `packages/config/src/index.ts` |
| NFR-API-002 | การจำกัดขนาด body | ค่าเริ่มต้น 1 MB; ยกเว้นเฉพาะ path (statement extract, provider events 256 KB, gateway media 16/96 MB, AgentCore 1 MiB); ปฏิเสธ body ที่บีบอัด | `apps/api/src/main.ts`, `gateway-http.middleware.ts`, `agentcore/runtime.ts` |
| NFR-API-003 | Validation เข้มงวด | whitelist + forbidNonWhitelisted + transform + trim ทั้งสองบริการ | `validation-pipe.options.ts`, `body-validation-coverage.spec.ts` |
| NFR-API-004 | ห้าม cache response ตามค่าเริ่มต้น | `Cache-Control: private, no-store, max-age=0`; ปิด ETag | `api-cache-control.middleware.ts`, `main.ts` |
| NFR-API-005 | การเปรียบเทียบความลับแบบ constant-time | worker token, internal secret, ลายเซ็น LINE, CSRF | `secret-compare.ts`, `worker-token.ts`, `line-webhook-verifier.ts`, `middleware.logic.ts` |
| NFR-API-006 | ไม่รั่วข้อมูลผ่าน error | ข้อความ Prisma ไม่ถึง client (แปลงเป็นข้อความคงที่ 4 แบบ); 5xx log พร้อม `requestId/method/path`; log ผ่าน pino ที่ redaction | `all-exceptions.filter.ts`, `common/logger/` |
| NFR-API-007 | การติดตามคำขอ | `X-Request-Id` ทุก response; ค่าที่ยาวเกินถูกแฮช; security event แบบชื่อคงที่สำหรับการปฏิเสธที่สำคัญ | `request-id.middleware.ts`, `common/logger/security-event.ts` |
| NFR-API-008 | HTTP hardening | helmet, ปิด `x-powered-by`, CORS allowlist (บังคับใน production), Swagger ปิดจนกว่าจะตั้ง flag; เว็บตั้ง CSP ต่อคำขอด้วย nonce, HSTS, `X-Frame-Options: DENY` | `main.ts` (api, gateway), `apps/web/proxy.ts`, `next.config.mjs` |
| NFR-API-009 | Graceful shutdown | API drain บัฟเฟอร์ LINE ก่อนออก; gateway รอการเรียกโมเดลที่ค้างและ post usage; workers ปิดทีละตัวภายในเวลาที่กำหนด | `app.enableShutdownHooks()`, `apps/ai-gateway/src/main.ts`, `apps/workers/src/main.ts` |
| NFR-API-010 | ความทนทานของคิว | retention จำกัด, retry แบบ exponential, DLQ, sweep idempotent, ทน endpoint ที่ยังไม่ deploy ระหว่าง rolling deploy | `apps/workers/src/common/queue.ts`, `internal-api.ts` |
| NFR-API-011 | Timeout ของการเรียกระหว่างบริการ | tool call ตาม `AI_TOOL_TIMEOUT_MS`; OCR/เอกสารตาม `ai-timeouts.ts`; เว็บ proxy 180 วินาที; BFF catalog 5 วินาที | `erp-tool.client.ts`, `packages/contracts/src/ai-timeouts.ts`, `next.config.mjs` |
| NFR-API-012 | Versioning | prefix `/v1` เดียวทั้ง api และ gateway; สัญญา AI มีเวอร์ชันในตัว (`LINE_AI_RUNTIME_CONTRACT_VERSION`, `contractCapabilities`, `EXPENSE_CAPTURE_CONTRACT_VERSION`) | `main.ts`, `packages/contracts/src/line-ai.ts`, `expense-capture.ts` |

---

## 10. สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด

**ข้อจำกัดของวิธีทำเอกสารนี้**

1. คอลัมน์ "วัตถุประสงค์" ในหมวด 2–3 แปลงอัตโนมัติจากชื่อ handler/controller ด้วยพจนานุกรม จึงอาจแข็งหรือคลุมเครือ (เช่น คำว่า `claim` ถูกแปลเป็น "ใบเบิก/claim" ทั้งที่ในบริบทการสมัครหมายถึงการ claim ลิงก์) ให้ยึด path, ชื่อ handler, `@ApiOperation.summary` และโค้ดเป็นหลัก
2. คอลัมน์ "Response" แสดง return type เฉพาะ handler ที่ประกาศไว้ (ส่วนน้อย) ที่เหลือแสดง use case/service ตัวแรกที่ handler เรียก ชนิดผลลัพธ์จริงต้องอ่านจาก use case นั้นและ `packages/contracts`; handler ที่มีหลายคำสั่งก่อน return อาจแสดง service ที่ไม่ใช่ตัวกำหนดผลลัพธ์สุดท้าย (เช่น แถวที่ขึ้น `assertAdmin()` หรือ service ตรวจสิทธิ์)
3. คอลัมน์ "Feature gate / แพ็ก" คำนวณจาก permission ใน decorator เท่านั้น ไม่รวม (ก) การตรวจ `assertFeatureEnabled` ภายใน use case (เช่น โมดูล reports, การออก 50 ทวิผ่าน LINE), (ข) route ที่ decorator ใช้ `account.session.read` แล้วตรวจอำนาจจริงใน use case (เช่น อนุมัติใบเบิก, billing ของบริษัท), (ค) การให้สิทธิ์ช่วง FREE_TRIAL_15 และ entitlement ที่ผู้ดูแลเปิดเป็นรายร้าน/ดีลเซลล์ (`SALES_DEAL_ALLOWED_FEATURE_KEYS`), (ง) บริษัท legacy ที่ไม่มีแถว entitlement (fail-open)
4. รหัส error ในหมวด 5 เป็นรหัสที่ grep พบในไฟล์ use case/โมดูลที่เกี่ยวข้อง ไม่ได้ไล่ทุกเส้นทางของทุก use case; สถานะ HTTP ของรหัสระดับโดเมนให้ตรวจที่จุด `throw` จริง
5. ค่าตัวเลขของ rate limit ที่มาจาก config (`passwordLogin*`, `passwordReset*`, `lineLoginCallback*` ฯลฯ) และค่าคงที่บางตัวในไฟล์ (`PUBLIC_SIGNUP_*`, `LINE_SIGNUP_*`, `SES_EVENTS_MAX_PER_IP`) ไม่ได้คัดลอกค่ามาทุกตัว — ดู `apps/api/src/modules/auth/application/auth-rate-limit.service.ts` และ `packages/config/src/index.ts`
6. ชนิด body ของ route ใน `apps/ai-gateway` หมายเลข 2–11, 15–20, 22 (หมวด 4.1) ระบุเป็นไฟล์สัญญาที่เกี่ยวข้อง ไม่ได้คัดลอก field ทุกตัว
7. กลไกยืนยันตัวตนของการเรียก AgentCore (gateway → runtime) เป็นของ AWS SDK/IAM ซึ่งไม่ได้ตรวจในระดับโค้ด infra ในเอกสารนี้ และโครงสร้างพื้นฐานคลาวด์ถูกลบแล้วจึงตรวจการตั้งค่าจริงไม่ได้
8. ผู้เรียกของ endpoint ภายใน 7 ตัวที่ไม่พบใน `apps/workers` (หมวด 7.3) และผู้เรียกของ gateway `crm-trust-score` ไม่ได้สืบต่อว่าเรียกจากที่ใด (อาจเป็นสคริปต์ `apps/api/src/scripts/*`, operator หรือโค้ด API เองที่ประกอบ path แบบ dynamic)
9. ไม่ได้รันระบบ/ทดสอบใด ๆ (ตามกติกา read-only) ข้อมูลทั้งหมดมาจากการอ่านซอร์สที่ commit `08850deaf`

**เอกสารกับโค้ด**

- คอมเมนต์ใน `apps/api/src/modules/line-ai/presentation/http/internal-ai-budget.controller.ts` ระบุว่า "Until Phase E1c the gateway calls neither route" แต่โค้ด `apps/ai-gateway/src/common/usage/ai-budget-seam.ts` มี client ที่เรียก `/internal/ai/budget-step` และ `/budget-settle` อยู่แล้ว — คอมเมนต์ล้าหลังโค้ด
- คอมเมนต์ใน `apps/workers/src/modules/notifications/notification-worker.ts` ระบุว่า handler เป็น "stubs that log intent" แต่โค้ดจริงเรียก internal endpoint ของ API ครบทุกชนิดงาน
- `AuthController` มี handler ที่โยน `403 LINE login is deferred to a future release` (บรรทัด ~399) คู่กับ flow LINE login ที่ใช้งานจริง (`/auth/line/login/callback`) — เป็น path เดิมที่ถูกปิดไว้ ไม่ใช่ฟีเจอร์ที่หายไป
- ไม่ได้เทียบ endpoint ทีละตัวกับ spec ใน `docs/specs/**`; เอกสารนี้จึงไม่ยืนยันรายการ "มีใน spec แต่ไม่พบในโค้ด" ในระดับ endpoint (การเทียบระดับฟีเจอร์อยู่ในเอกสาร SRS รายโมดูล)
