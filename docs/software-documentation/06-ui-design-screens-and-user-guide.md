# 06 — เอกสารออกแบบ UI/UX รายการหน้าจอ และคู่มือผู้ใช้ (apps/web)

**จุดประสงค์** เอกสารนี้เป็นบันทึกถาวรของส่วนหน้าเว็บ MangmeePlus / WatchDog-BMS (`apps/web`, Next.js) ครอบคลุมสถาปัตยกรรม front-end, design system, แบบจำลองเมนูและการซ่อน/แสดงตามแพ็กเกจและสิทธิ์, รายการหน้าจอครบทุก `page.tsx`, คู่มือผู้ใช้ทีละขั้นของแต่ละเส้นทางงานหลัก, แค็ตตาล็อกข้อความ dialog/สถานะว่าง/ข้อผิดพลาด/แจ้งเตือนเท่าที่รวมศูนย์ในโค้ด, การรองรับ accessibility/responsive/เบราว์เซอร์ และต้นแบบงานออกแบบใน `docs/prototypes` ทีมในอนาคตต้องสามารถสร้างและใช้งานหน้าเว็บซ้ำได้จากเอกสารนี้ร่วมกับโค้ดที่เก็บถาวร

**ที่มา** ตรวจจาก checkout `closeout-docs-main` (clean `origin/main`) commit `08850deaf` วันที่ 2026-11-10 โค้ดคือความจริง เอกสารใน `docs/` ใช้ประกอบเหตุผลเท่านั้น ทุกข้อที่ระบุในเอกสารนี้อ้างไฟล์ต้นทางแบบ repo-relative

**ขอบเขตแพ็ก** ทุกฟีเจอร์ที่ขายถึงแพ็ก `ENTERPRISE_1999` (`TIER_FEATURE_PRESETS` ใน `packages/contracts/src/menu-entitlements.ts:427-432`) รวม add-on, คอนโซลผู้ดูแลระบบ, billing, ทีมขาย และหน้า LINE ที่ใช้ขาย/ดูแลแพ็กเหล่านั้น หน้าที่มีโค้ดแต่ไม่อยู่ใน preset ใดจะถูกระบุในตารางว่า "นอกขอบเขต" และสรุปในหัวข้อ 12

**รหัสข้อกำหนดที่เอกสารนี้นิยาม** `FR-UI-001…FR-UI-024` (functional) และ `NFR-601…NFR-612` (non-functional; ใช้ช่วง 6xx เพื่อไม่ชนกับเอกสารอื่นในชุด)

## สารบัญ

1. [สถาปัตยกรรม front-end](#1-สถาปัตยกรรม-front-end)
2. [Design system และแนวทาง UX](#2-design-system-และแนวทาง-ux)
3. [แบบจำลองการนำทาง เมนู entitlement และสิทธิ์](#3-แบบจำลองการนำทาง-เมนู-entitlement-และสิทธิ์)
4. [รายการหน้าจอทั้งหมด (207 หน้า)](#4-รายการหน้าจอทั้งหมด-207-หน้า)
5. [ข้อกำหนดเชิงหน้าที่ของ UI (FR-UI)](#5-ข้อกำหนดเชิงหน้าที่ของ-ui-fr-ui)
6. [คู่มือผู้ใช้ทีละขั้นตามเส้นทางงาน](#6-คู่มือผู้ใช้ทีละขั้นตามเส้นทางงาน)
7. [สรุปคู่มือในแอปและ help pack ที่มีใน repo](#7-สรุปคู่มือในแอปและ-help-pack-ที่มีใน-repo)
8. [แค็ตตาล็อก dialog สถานะว่าง ข้อผิดพลาด และการแจ้งเตือน](#8-แค็ตตาล็อก-dialog-สถานะว่าง-ข้อผิดพลาด-และการแจ้งเตือน)
9. [Accessibility, responsive และเบราว์เซอร์ที่รองรับ](#9-accessibility-responsive-และเบราว์เซอร์ที่รองรับ)
10. [ข้อกำหนดที่ไม่ใช่เชิงหน้าที่ (NFR)](#10-ข้อกำหนดที่ไม่ใช่เชิงหน้าที่-nfr)
11. [ต้นแบบและเอกสารอ้างอิงงานออกแบบ (`docs/prototypes`)](#11-ต้นแบบและเอกสารอ้างอิงงานออกแบบ-docsprototypes)
12. [นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)](#12-นอกขอบเขตแพ็ก-1999-มีโค้ดแต่ไม่ได้ขาย)
13. [สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด](#13-สิ่งที่ตรวจไม่ได้-และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด)

---

## 1. สถาปัตยกรรม front-end

### 1.1 เทคโนโลยีและโครงสร้างโฟลเดอร์

| รายการ | ค่า | หลักฐาน |
|---|---|---|
| Framework | Next.js `~16.4.1` (App Router), React 19, TypeScript 5.7 | `apps/web/package.json` |
| CSS | Tailwind CSS v4 (`@tailwindcss/postcss`) + CSS variables จาก design tokens + CSS modules บางส่วน | `apps/web/app/globals.css`, `apps/web/postcss.config.mjs` |
| Dependencies runtime | `@watchdog-bms/contracts`, `@watchdog-bms/design-tokens`, `heic-to` (แปลงรูป HEIC ฝั่งเบราว์เซอร์), `tailwind-merge` | `apps/web/package.json` |
| Output | `output: 'standalone'`, `poweredByHeader: false` | `apps/web/next.config.mjs` |
| ทดสอบหน่วย | `tsx --test "src/**/*.spec.ts"` (359 ไฟล์ spec ใต้ `apps/web/src`) | `apps/web/package.json` |
| E2E | Playwright 90 ไฟล์ใต้ `e2e/` | `e2e/*.spec.ts` |

โครงสร้างบังคับตาม `docs/guidelines/web-frontend-code-style.md`:

```text
apps/web/
  app/                      route files (บาง: import feature component แล้วส่ง session/params)
    (workspace)/companies/[companyId]/...   พื้นที่ทำงานของร้าน (103 หน้า)
    system/...              คอนโซลผู้ดูแลแพลตฟอร์ม (70 หน้า)
    sales/...               คอนโซลทีมขาย (12 หน้า)
    api/auth/*, api/public/*  BFF route handlers
    l/[token], d/[token]    route handler สำหรับลิงก์จาก LINE และลิงก์เดโม่
    login, signup, ...      หน้า auth และหน้าสาธารณะ (22 หน้า)
  proxy.ts                  middleware ของ Next 16 (CSP nonce, CSRF, กันเบราว์เซอร์เก่า, กันหน้าที่ต้องล็อกอิน)
  src/common/               โค้ดใช้ร่วม: api, auth, components, i18n, files, forms, hooks, security, styles
  src/features/<feature>/   หนึ่งฟีเจอร์หนึ่งโฟลเดอร์ (*.api.ts, *.logic.ts, *.model.ts, *.constants.ts, Page.tsx)
  public/                   ฟอนต์ ภาพหน้าแรก โลโก้ และ `legal/releases`
```

กฎแยกไฟล์ (`web-frontend-code-style.md` "Separation Rule"): route file ต้องบาง, component ไม่เรียก `fetch` ตรง ๆ ต้องผ่าน `*.api.ts`, ตรรกะคำนวณอยู่ใน `*.logic.ts` แบบ pure function, ตรวจ `src/common/` ก่อนสร้างของใหม่ ค่ามัธยฐานของ `page.tsx` คือ 10 บรรทัด (207 ไฟล์ รวม 3,174 บรรทัด โดย 3 หน้ากฎหมายกินไป 961 บรรทัด)

### 1.2 Route groups และ layouts

| Layout | ไฟล์ | หน้าที่ |
|---|---|---|
| Root | `app/layout.tsx` | `<html lang="th">`, ครอบ `ToastProvider`, เรียก `await connection()` เพื่อบังคับ render ต่อคำขอทุกหน้า (ดู 1.7), metadata/viewport (`viewportFit: 'cover'`) |
| Route group `(workspace)` | `app/(workspace)/layout.tsx` | pass-through ไม่มี UI ใช้จัดกลุ่มเท่านั้น (ไม่อยู่ใน URL) |
| ร้าน | `app/(workspace)/companies/[companyId]/layout.tsx` | server component ตรวจ session จริงกับ `GET /v1/auth/me` ผ่าน `fetchServerSessionResult(companyId)` แล้วตัดสิน: `signed_out` → `/login?next=…`, `platform_closed` → `/maintenance`, `unavailable` → throw (ไป `error.tsx`), `forbidden` → `CompanyAccessUnavailable`, เซลล์ล้วน → `/sales/deals`, ผู้บริหารล้วน → `/system/executive`, `mustChangePassword` → `/change-password`, ยังไม่ยอมรับเอกสารกฎหมาย → `/legal-acceptance`; ผ่านแล้ว render `WorkspaceLayoutClient` |
| คอนโซลระบบ | `app/system/layout.tsx` (`force-dynamic`) | เข้าได้เมื่อ role `SYSTEM_ADMIN` หรือ มี `system.billing.read` และ path อยู่ใต้ `/system/billing` หรือ มี `system.executive.read` และ path อยู่ใต้ `/system/executive`; มิฉะนั้นแสดง `SystemAccessDenied`; วาด `SystemHeader` + ป้ายสภาพแวดล้อม (`ระบบทดสอบ UAT` / `ระบบจริง` / `ทดสอบในเครื่อง`) |
| รายงานผู้บริหาร | `app/system/executive/layout.tsx` | ต้องมี `system.executive.read`; ครอบ `ExecutiveReportProvider` |
| บัญชีผู้บริหาร | `app/system/executive-users/layout.tsx` | ต้องมี `system.executive_user.manage` |
| คอนโซลทีมขาย | `app/sales/layout.tsx` (`force-dynamic`) | ต้องมี `sales.console.read` (`canOpenSales`); วาด `SalesHeader` |

ไฟล์พิเศษระดับราก: `app/loading.tsx` (`LoadingState` "กำลังเปิดหน้า..."), `app/system/loading.tsx`, `app/error.tsx` (หน้า "เปิดหน้านี้ไม่ได้" มีปุ่ม ออกจากระบบ / กลับไปหน้าแรก / ลองอีกครั้ง), `app/global-error.tsx` ("ระบบขัดข้องชั่วคราว" พร้อมเบอร์โทรทีมงาน), `app/not-found.tsx` ("ไม่พบหน้านี้" โดยตั้งใจไม่แสดงเลข 404), `app/robots.ts` (เปิด index เฉพาะ production), `app/sitemap.ts`, `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`

**เปลือกของพื้นที่ร้าน** (`src/features/web-core-workspace/WorkspaceLayout.tsx`) เลือก 1 ใน 3 เปลือกหลังอ่าน plan-term notice ครั้งเดียว (`fetchPlanTermNotice`):

| เปลือก | เงื่อนไข | สิ่งที่แสดง |
|---|---|---|
| `LockedWorkspaceLayout` | `notice.derivedState === 'EXPIRED'` และไม่ใช่โหมด `freeExpenseDrafts` | แถบข้างเหลือ 2 เมนู: `ตั้งค่าร้าน` และ (ถ้ามี `company.plan.manage`) `แพ็กเกจ`; ไม่มีกระดิ่ง ไม่มีตัวเลือกสาขา; path อื่นแสดง "กำลังพาไปหน้าที่ใช้ได้…" แล้ว `PlanTermBanner` พาไป `/renew` |
| `BillingWorkspaceLayout` | path อยู่ในกลุ่ม billing recovery (`isBillingCustomerRecoveryPath`) หรือหน้า `settings/profile` ของผู้มีสิทธิ์ | อ่าน `GET …/billing` ก่อน: `accessState === 'ACTIVE'` → ใช้เปลือกธุรกิจ; อื่น ๆ → แสดงหน้าโดยไม่มีเมนูธุรกิจ (recovery) |
| `BusinessWorkspaceLayout` | กรณีทั่วไป | `WorkspaceShell` = `AppHeader` (ตัวสลับร้าน `CompanySwitcher`, ตัวเลือกสาขา `BranchSelector`, กระดิ่ง `NotificationBell`, เมนูผู้ใช้) + `AppSidebar` + แบนเนอร์ (`PlanTermBanner` หรือ `DemoSessionBanner`) + การ์ดท้ายแถบข้าง `PlanTermSidebarCard` |

เปลือกธุรกิจยัง: (ก) ตรวจ access context ซ้ำทุก 60 วินาทีและเมื่อหน้าต่างกลับมา focus (`ACCESS_CONTEXT_POLL_MS`, `fetchMyContext`) ถ้า fingerprint เปลี่ยนจะ `router.refresh()`; (ข) กันการเปิดหน้าที่ไม่มีสิทธิ์ด้วย URL ตรงผ่าน `canAccessWorkspacePath` แล้วแสดงสถานะห้ามพร้อมลิงก์ไปหน้าที่เปิดได้; (ค) จำค่าตัวกรองต่อเมนูในหน่วยความจำ (`MenuFilterScope`, `slotFor`) — ค่าคงอยู่ตอนไป-กลับหน้ารายละเอียด และล้างเมื่อเปลี่ยนเมนู

### 1.3 Server component กับ client component

- `page.tsx` และ layout เกือบทั้งหมดเป็น **async server component** ทำ 3 อย่าง: อ่าน `params`/`searchParams`, เรียก `fetchServerSession(companyId)` (`src/common/auth/server-session.ts` → `GET /v1/auth/me` ฝั่งเซิร์ฟเวอร์ด้วย cookie ของคำขอ), แล้วส่ง `permissions`, `roles`, `userId`, `entitledFeatureKeys`, ค่าตั้งของร้าน เป็น props ให้ feature component
- feature component (`src/features/**/**Page.tsx`) เป็น **client component** (`'use client'`) โหลดข้อมูลเองด้วย `useEffect` + ฟังก์ชันใน `*.api.ts` ไม่มี React Server Actions และไม่มี data cache ของ Next สำหรับข้อมูลธุรกิจ (`cache: 'no-store'`)
- หน้าที่เป็น server component ล้วนโดยไม่มี client state: หน้ากฎหมาย (`/privacy`, `/terms`, `/data-deletion`), `/maintenance`, `/d/expired`, `/unsupported-browser`, หน้า redirect ต่าง ๆ
- การตรวจสิทธิ์ฝั่งหน้า (`requireRoutePermission`, `canSeeRoute`, `ForbiddenState`) เป็น **UX เท่านั้น** API เป็นผู้บังคับจริง (checklist ท้าย `web-frontend-code-style.md`)

### 1.4 การดึงข้อมูลและรูปแบบ BFF

เบราว์เซอร์ไม่ถือ token เอง session อยู่ใน cookie แบบ httpOnly และทุกคำขอเป็น same-origin:

| ชั้น | รายละเอียด | หลักฐาน |
|---|---|---|
| Rewrite | `/api/:path*` → `${INTERNAL_API_URL หรือ NEXT_PUBLIC_API_BASE_URL}/:path*`; `/local-storage/:path*` → API (ไฟล์ในเครื่อง dev); `experimental.proxyTimeout = 180_000` ms เพราะ OCR ใบเสร็จแบบ synchronous ใช้ได้ถึง 120 วินาที | `apps/web/next.config.mjs` |
| BFF auth routes | `app/api/auth/*` 18 route: `login`, `logout`, `refresh`, `change-password`, `dev-login`, `signup-claim`, `account-merge`, `account-merge/ticket`, `email-access/{request,confirm,signup,status}`, `line-login/{availability,start,callback}`, `line-qr/{start,status,approve}` — เรียก API ภายในแล้ว **ตั้ง/ลบ cookie** เอง | `apps/web/app/api/auth/**/route.ts`, `src/common/auth/auth-cookies.server.ts` |
| BFF public routes | `app/api/public/billing/catalog` (แค็ตตาล็อกราคาสำหรับหน้าแรก), `app/api/public/halloween/draw` | `apps/web/app/api/public/**` |
| Link handoff | `app/l/[token]/route.ts` แลก token ใช้ครั้งเดียวจากลิงก์ LINE เป็น session แล้ว 303 ไปปลายทาง (HEAD ตอบ 204 เพื่อไม่ให้ link preview เผา token; ล้มเหลวตอบหน้า HTML 503 ไม่มีสคริปต์); `app/d/[token]/route.ts` เปิดร้านเดโม่ (`POST /v1/auth/demo/open`) | ไฟล์ดังกล่าว |
| Cookies | `watchdog_token` (access; ถ้าเกิน 3,500 ไบต์แบ่งเป็น `.0…​.5`), `watchdog_refresh` (path `/api/auth`, อายุ 7 วัน), `watchdog_csrf`, `watchdog_home` (หน้า landing ที่จำไว้), `watchdog_persist` | `src/common/auth/auth-cookies.constants.ts` |
| Browser client | `authedApiFetch` (`src/common/api/authed-fetch.ts`): prefix `/api/v1`, แนบ `X-Company-Id`, แนบ `x-csrf-token` กับ mutation, เมื่อ 401 จะ refresh ครั้งเดียวแบบ single-flight แล้ว retry; 401 ซ้ำและ refresh ยืนยันว่า session หมด → `/login?next=…`; 403 รหัส `csrf_token_invalid` → refresh แล้ว retry หนึ่งครั้ง; `legal_acceptance_required` → `/legal-acceptance`; `company_term_expired` → `/renew`; ข้อผิดพลาดอื่นยิง toast ผ่าน `emitApiErrorToast` เว้นแต่ `suppressErrorToast` | ไฟล์ดังกล่าว |
| HttpClient | คลาสเก่า `HttpClient` (`src/common/api/http-client.ts`) ยังใช้ในบางจุด รูปแบบ header เดียวกัน | ไฟล์ดังกล่าว |
| Middleware | `proxy.ts`: (1) สร้าง nonce + CSP ต่อคำขอ, (2) mutation ใต้ `/api/` ต้อง same-origin และ `/api/v1` ที่มี cookie ต้องผ่าน double-submit CSRF, (3) เบราว์เซอร์เก่า → `/unsupported-browser?next=…`, (4) path ที่ต้องล็อกอิน (`/companies/*`, `/system/*`, `/legal-acceptance`, `/account/email`, `/billing/companies`) ที่ไม่มี cookie → `/login?next=…`, (5) ส่ง header `x-request-path` ให้ layout รู้ URL ที่ขอ | `apps/web/proxy.ts`, `src/common/auth/middleware.logic.ts` |

หลักสำคัญที่เขียนกำกับในโค้ด: "cookie ไม่ใช่หลักฐานการยืนยันตัวตน" — middleware เป็นเพียงด่านตรวจว่ามี cookie; การตัดสินว่า "ล็อกอินอยู่" ทำที่ layout ด้วย `GET /auth/me` เสมอ และ `/login` ไม่ถูกกั้นที่ middleware เพื่อกัน redirect loop

### 1.5 การจัดการ state

| ชนิด state | วิธี |
|---|---|
| Session/สิทธิ์ | props จาก server layout (`WebSession`, `src/common/models/web-session.model.ts`) ฟิลด์: `permissions`, `availablePermissions` (ใช้แสดงผลเท่านั้น), `entitledFeatureKeys` (`null` = legacy เปิดทุกฟีเจอร์), `roles`, `roleNames`, `scopes.branchIds`, `freeExpenseDrafts`, `isDemo`, `mustChangePassword`, `legalAcceptanceRequired`, `manualExpenseWebEntry`, `disbursementVoucherWebEntry` |
| ข้อมูลหน้า | `useState`/`useEffect` ภายใน client component; ไม่มี global store, ไม่มี React Query/SWR/Redux |
| Context ที่ใช้ร่วม | `SidebarContext`, `ToastContext`, `WorkspaceLocaleContext`, `BranchFilterProvider` (`WorkspaceScope.tsx`: ร้าน/สาขาที่เลือก), `MenuFilterScope`, `AccountNameScope`, `LockedShellProvider`, `BillingWorkspaceContext`, `ExecutiveReportProvider` |
| Event ข้าม component | `window` custom events: `watchdog:access-context-stale`, `PLAN_TERM_CHANGED_EVENT`, `ACCOUNT_NAME_CHANGED_EVENT`; toast bus (`src/common/feedback/toast-bus.ts`) |
| localStorage | `watchdog.workspace.locale` (ภาษา th/en) เท่านั้นในระดับ common (`src/common/i18n/use-locale.ts`) |
| URL state | ตัวกรองบางหน้าอยู่ใน query (`?tab=`, `?focus=`, `?pay=1`, `?draft=`, `?expenseId=`, `?edit=`, `?mode=view`, `?collection=`, `?attempt=`) |

### 1.6 ฟอร์ม การตรวจข้อมูล และสถานะ loading/error/permission

- **ฟอร์ม**: controlled input ของ React ล้วน ไม่มีไลบรารีฟอร์ม ใช้ field primitive ร่วม (`TextField`, `SelectField`, `TextareaField`, `SwitchField`, `ThemedSelect`, `ThemedDate`, `ThemedFile`, `ChoiceRow`, `ThaiAddressFields`) ข้อผิดพลาดแสดงใต้ช่องด้วย `FieldError` และผูก `aria-describedby`
- **การตรวจข้อมูล**: ตรวจฝั่งหน้าใน `*.logic.ts` (เช่น `signup.logic.ts`, `employee-email.logic.ts`, `upload-file.logic.ts`) + helper `src/common/forms/sanitize.ts`, `trim.ts`; ฝั่ง API เป็นผู้ตัดสินสุดท้าย ข้อความปฏิเสธจาก API ถูกแปลผ่าน `apiErrorMessage` (ดู 8.3)
- **กันข้อมูลหาย**: `useUnsavedNavigation` กันลิงก์/ปุ่ม Back/ปิดแท็บเมื่อฟอร์มยังไม่บันทึก (dialog "ยังไม่ได้บันทึกใบนี้" ปุ่ม `อยู่ต่อ` · `ไม่บันทึกและออก` · `บันทึกร่างและออก`); `Modal` prop `dirty` ถามก่อนปิด
- **Idempotency**: ฟอร์มสำคัญส่ง key ซ้ำเดิมทุกครั้งที่ retry (สมัครใช้งาน, checkout `Idempotency-Key`, คำสั่ง billing)
- **Loading**: กฎ "Cover Loader Rule" — ทุกการรอ API ต้องมี loader คลุมขอบเขตที่เกี่ยวข้อง (`CoverLoader` scope `workspace|page|section|table|form|modal`) และปุ่มที่กดแสดง `aria-busy` กดซ้ำไม่ได้
- **Error**: `ErrorState` (มีปุ่ม "ลองอีกครั้ง" และรหัสคำขอ), `Notice` tone `error|warning|info|success`, toast; ข้อผิดพลาดระดับ route ไป `app/error.tsx`
- **Permission**: `ForbiddenState` มี 3 แบบข้อความ — ไม่มีสิทธิ์ ("ไม่มีสิทธิ์เข้าถึง" + แนะให้แจ้งเจ้าของกิจการ หรือถ้าเป็น OWNER "เพิ่มสิทธิ์ได้ที่ พนักงานและสิทธิ์"), แพ็กเกจไม่มีหน้านี้ ("แพ็กเกจของร้านยังไม่มีหน้านี้" เมื่อ `availablePermissions` ก็ไม่มีสิทธิ์นั้น) และแบบกำหนดเอง
- **Empty**: `EmptyState` ("ไม่มีข้อมูล" / "ยังไม่มีรายการในที่นี้") พร้อม action เดียวที่ทำให้รายการเกิด

### 1.7 CSP nonce และกฎ `force-dynamic` ของหน้าสาธารณะ

- `proxy.ts` สุ่ม nonce 16 ไบต์ต่อคำขอ ใส่ใน header `x-nonce` และสร้าง CSP: `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'` (dev เพิ่ม `'unsafe-eval'`); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob: https: <origins>`; `font-src 'self' data:`; `connect-src 'self' <API, AI gateway, S3 origins>`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-src 'self' blob:`; `frame-ancestors 'none'` (`src/common/security/security-headers.logic.ts`)
- Header พื้นฐานทุกคำตอบ: HSTS 2 ปี + preload, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- **กฎ**: หน้าที่ถูก prerender ตอน build จะไม่มี nonce บน `<script>` ของ Next → CSP บล็อก → หน้าไม่ hydrate ค้างที่ loading (เหตุการณ์จริง: `/privacy`, `/terms` 2026-10-20; `/signup`, `/claim-account` ก่อนหน้านั้น) ทางแก้สองชั้น: (1) `RootLayout` เรียก `await connection()` ทำให้ **ทุกหน้า** render ต่อคำขอ; (2) หน้าสาธารณะ/หน้า auth ยังประกาศ `export const dynamic = 'force-dynamic'` กำกับ: `login`, `signup`, `signup/welcome`, `signup/status/[requestId]`, `claim-account`, `email-access`, `verify-email`, `reset-password`, `change-password`, `legal-acceptance`, `line-qr/[code]`, `maintenance`, `unsupported-browser`, `d/expired`, `account/email`, `billing/companies`, `settings/profile`, `account`, `billing/preview`, layout ของ `/system` และ `/sales` มี spec เฝ้า: `src/common/security/csp-dynamic-rendering.spec.ts`
- หน้าแรกส่ง `nonce` ให้ JSON-LD (`HomeStructuredData`) เอง (`app/page.tsx`)

### 1.8 i18n และการจัดการข้อความไทย

| เรื่อง | รายละเอียด |
|---|---|
| ภาษา | ไทยเป็นค่าเริ่มต้น (`getDefaultLocale() === 'th'`), อังกฤษมีใน dictionary; เปลือกร้านปัจจุบัน **ตรึง `locale = 'th'`** (`WorkspaceLayout.tsx`: `const locale: SupportedLocale = 'th'`) ส่วนหน้า login/error/not-found อ่านค่าจาก `useLocale()` |
| Dictionary | `src/common/i18n/workspace-dictionary.ts` (4,065 บรรทัด, th+en) เรียกด้วย `t(key, locale)`; กลุ่ม key ใหญ่สุด: `expenses.*` (~2,054 รายการรวมสองภาษา), `customers.*`, `inbox.*`, `counterparties.*`, `auth.*`, `crm_reports.*`, `inventory.*`, `dashboard.*`, `module.*`, `notification.*`, `shell.*` |
| คำกลางข้ามช่องทาง | คำที่ใช้ทั้งเว็บ LINE และเอกสารพิมพ์อยู่ใน `packages/contracts` (เช่น `THAI_SYSTEM_ROLE_NAMES`, `E_WHT_WORDS`, `DISBURSEMENT_VOUCHER_WORDS`, `EXPENSE_CORRECTION_WORDS`, `EXECUTIVE_WORDS`) เพื่อให้คำเดียวกันทุกที่ |
| ข้อความ error จาก API | API ตอบภาษาอังกฤษ; จุดแปลเดียวคือ `src/common/api/api-error-message.ts` (ดู 8.3); spec `no-raw-api-error-display.spec.ts` ห้ามแสดงข้อความดิบ |
| วันที่/เงิน | `src/common/i18n/thai-date.ts` (เช่น `13 ต.ค. 2569`), เงิน `฿1,200.00` บนจอ และ `1,200.00 บาท` ในประโยค (thai-ux-standard §1 Formats) |
| การพิมพ์ไทย | line-height ปรับสำหรับสระบน-ล่าง (`--text-sm--line-height: 1.6` ฯลฯ), ห้าม font-weight เกิน 700, class `.mangmee-unit` กันเลขเอกสาร/จำนวนเงิน/วันที่ถูกตัดบรรทัด (`globals.css`) |
| ตัวเฝ้าคำ | `sold-features-wording.spec.ts`, `one-source-words.spec.ts`, `workspace-i18n.spec.ts`, `api-error-coverage.spec.ts` |

### 1.9 Bundler: Turbopack กับ webpack

- `pnpm dev` ใช้ **Turbopack** (`next dev`), `pnpm build` ใช้ **webpack** (`next build --webpack`) — loader ต้องลงทะเบียน **ทั้งสองฝั่ง**
- SVG เป็น React component ผ่าน `@svgr/webpack`: ลงใน `turbopack.rules['*.svg']` และใน `webpack(config)` (จำกัด `include` ที่ `src/common/icons/` เพื่อไม่ชน `app/icon.svg`) ถ้าลงฝั่งเดียว อีกฝั่งจะได้ object แทน component และ React ล้มทั้งต้นไม้ ("Element type is invalid … got: object") ซึ่งเคยทำให้ทุกหน้าที่ล็อกอินพังใน container build ขณะ `next dev` ยังปกติ (หมายเหตุใน `next.config.mjs`)
- svgo ตั้ง `removeViewBox: false` เพราะไอคอนที่ย่อด้วย CSS เคยถูกตัด
- `typescript.ignoreBuildErrors: true` — ข้ามรอบ `tsc` ใน `next build` เพื่อไม่ให้ VM ขนาด ~3.8 GB OOM; ตรวจ type ด้วย `pnpm typecheck` แทน
- `distDir` เปลี่ยนได้ด้วย `NEXT_DIST_DIR` เพื่อรัน dev server ตัวที่สองใน checkout เดียวกัน
- Tailwind สแกนเฉพาะ `@source '../app'` และ `'../src'` (`source(none)`) เพราะเคยอ่าน cache ของ Turbopack เป็นข้อความแล้ว stylesheet พังทั้งแอป

### 1.10 PWA และพฤติกรรมบนมือถือ

- **ไม่มี PWA**: ไม่พบ web app manifest, service worker หรือ meta `apple-mobile-web-app-*` ใน `apps/web` (ค้นทั้ง `app/` และ `src/`) แอปเป็นเว็บ responsive ปกติ
- **ไม่มีหน้า LIFF ใน `apps/web`**: ไม่มี route `/liff` (มีเพียงรายการ disallow ใน `robots.ts`) หน้า LIFF/LINE ที่มีอยู่ให้บริการจากฝั่ง API (`apps/api/src/common/security/liff-page.security.ts`, `line-package-advisor.page.ts`) ซึ่งอยู่นอกเอกสารนี้
- มือถือเป็นพื้นผิวหลัก (390 px): ใช้ `min-h-dvh`/`100dvh` (ไม่ใช้ `vh`; เฝ้าด้วย `viewport-units.spec.ts`), `env(safe-area-inset-bottom)` กับแถบล่าง (`.mangmee-safe-bottom`, เฝ้าด้วย `safe-area.spec.ts`), input 16 px ต่ำกว่า 640 px กัน iOS ซูม, ปุ่มสูง 44 px บนมือถือ/40 px ตั้งแต่ 640 px
- LINE in-app browser: ลิงก์ login ด้วย LINE ถูกเติม `openExternalBrowser=1` เพื่อให้ทั้งรอบ OAuth อยู่ในเบราว์เซอร์เดียว (`src/common/auth/line-in-app-browser.logic.ts`)
- กล้อง: หน้าอัปโหลดใบเสร็จใช้ `<input type="file" capture>` ผ่าน `ThemedFile`; รูป HEIC แปลงด้วย `heic-to`; รูปใหญ่ย่อก่อนส่ง (`src/common/files/document-raster.logic.ts`, `image-pdf.logic.ts`)

---

## 2. Design system และแนวทาง UX

### 2.1 Design tokens (`packages/design-tokens`)

แหล่งความจริงเดียวคือ `packages/design-tokens/tokens.json` สคริปต์ `scripts/build-tokens.mjs` (`pnpm --filter @watchdog-bms/design-tokens build`) สร้าง `generated/web/theme.css` เป็น CSS variables แล้ว `apps/web/src/common/styles/theme.css` import เข้ามา และ `globals.css` (`@theme inline`) แมปเป็น utility ของ Tailwind

**สี (ครบทุก token)**

| กลุ่ม | Token → ค่า |
|---|---|
| พื้นผิว/ตัวอักษร | `page-bg #f6f8f5`, `surface #ffffff`, `border #e3ebe5`, `text-primary #1a2e22`, `text-secondary #475467`, `neutral-surface #edf1ed` |
| สถานะแบบ semantic เดิม | `success-surface #e9f6ef`, `success-text #2f6f51`, `info-surface #eef3fb`, `info-text #315a8c` |
| Gray | `gray-25 #fcfcfd`, `50 #f9fafb`, `100 #f2f4f7`, `200 #e4e7ec`, `300 #d0d5dd`, `400 #98a2b3`, `500 #667085`, `600 #475467`, `700 #344054`, `800 #1d2939`, `900 #101828` |
| Brand (เขียว) | `brand-25 #f0fdf4`, `50 #ecfdf3`, `100 #dcfce7`, `200 #bbf7d0`, `300 #86efac`, `400 #4ade80`, `500 #22c55e`, `600 #16a34a`, `700 #15803d`, `800 #166534`, `900 #14532d` |
| Gold | `gold-100 #fef3c7`, `300 #fcd34d`, `400 #fbbf24`, `500 #f59e0b`, `600 #d97706` |
| Success | `success-50 #ecfdf3`, `500 #12b76a`, `600 #039855`, `700 #027a48` |
| Warning | `warning-50 #fffaeb`, `100 #fef0c7`, `500 #f79009`, `600 #dc6803`, `700 #b54708` |
| Error | `error-50 #fef3f2`, `500 #f04438`, `700 #b42318` |
| Blue light | `blue-light-50 #f0f9ff`, `500 #0ba5ec` |

`color-scheme: light` เท่านั้น ไม่มีโหมดมืด (มีกฎ CSS กัน native picker กลายเป็นสีมืดบนเครื่องที่ตั้ง dark mode)

**Typography**

| รายการ | ค่า |
|---|---|
| `fontFamily.sans` | `'Outfit', 'IBM Plex Sans Thai', Inter, ui-sans-serif, system-ui, …` — Outfit สำหรับละตินและตัวเลข, IBM Plex Sans Thai สำหรับไทย; `--font-mono` ชี้ไปตระกูลเดียวกันเพื่อให้เลขอ้างอิงไม่เปลี่ยนฟอนต์ |
| ไฟล์ฟอนต์ | self-host ใน `apps/web/public/fonts`: `outfit-latin(.ext).woff2` (variable 400–700), `plex-thai-{400,500,600,700}.woff2`, `sarabun-{thai,latin}-{400..700}.woff2` (Sarabun ใช้เฉพาะหน้ากฎหมาย/PDPA class `.doc`); ทั้งหมด SIL OFL 1.1; ประกาศใน `src/common/styles/fonts.css`; spec `offline-fonts.spec.ts` |
| น้ำหนัก | 400–700 เท่านั้น (`--font-weight-extrabold` และ `black` ถูกแมปเป็น 700) |
| Line-height | `text-xs 1.5`, `sm/base/lg 1.6`, `xl/2xl 1.5`, `3xl 1.4` (วัดจากฟอนต์จริง: `docs/research/thai-ux-guideline-research-2026-10-13.md` §M3) |
| ขนาดขั้นต่ำ | ข้อความที่ต้องอ่าน ≥ 14 px, ไม่มีอะไรต่ำกว่า 12 px, input 16 px บนมือถือ |

**Spacing / radius / shadow / z-index**

| กลุ่ม | ค่า |
|---|---|
| `space` | `1=4`, `2=8`, `3=12`, `4=16`, `5=24`, `6=32` (px) |
| `radius` | `sm=6`, `md=8`, `lg=10`, `xl=12`, `2xl=16` (px) |
| `shadow` | `focus: 0 0 0 3px rgb(34 197 94 / 20%)`, `theme-sm`, `theme-md` |
| `zIndex` | `modal: 1000` (Modal จริงใช้ `z-[99999]` และ popover ของ field อยู่เหนือกว่านั้น) |

**Breakpoints** — `tokens.json` **ไม่มี token breakpoint**; ใช้ค่าเริ่มต้นของ Tailwind v4 และ media query ใน `globals.css`: 640 px (`sm`/`40rem`: ปุ่ม 40 px, กลุ่มปุ่มเรียงแนวนอน, FilterTabs ห่อบรรทัด), 768 px (`md`: padding เนื้อหา 1.75rem, ฟิลด์สั้นเรียง 2–3 ต่อแถว), 1024 px (`lg`: แถบข้างถาวร กว้าง 289 px เมื่อขยาย / 86 px เมื่อย่อ, ตัวแปร `--workspace-content-left`), 1280 และ ≥1536 px เป็นขนาดที่ต้องตรวจตามมาตรฐาน ความสูงแถบบน `--app-header-h: 68px`

### 2.2 Component ใช้ร่วม (`apps/web/src/common/components`) — รายการครบ

| กลุ่ม | Component / hook | จุดประสงค์ |
|---|---|---|
| `actions/` | `ActionGroup` | กลุ่มปุ่มที่อยู่ด้วยกัน: สูงเท่ากัน กว้างเท่ากัน ปุ่มถอยออกมาก่อน ปุ่มลงมือทำอยู่ท้าย (ขวาเมื่อเรียงแถว / บนสุดเมื่อซ้อน); วัดด้วย `useActionGroupLayout` + `action-group.logic.ts` |
| | `FormActionBar` | แถวปุ่มท้ายฟอร์ม ติดขอบล่างหน้าต่างเมื่อฟอร์มยาวกว่าจอ (`.mangmee-form-bar`, ตั้งตัวแปร `--mangmee-form-bar-height`); มีช่อง `summary` (ยอดรวม/สิ่งที่ยังขาด) |
| | `MoreActions` | ปุ่ม "เพิ่มเติม" รวม ≥2 การกระทำที่ใช้นาน ๆ ครั้ง ใช้ `<details>` ปิดด้วย Escape/คลิกนอก |
| `app-shell/` | `WorkspaceShell` | โครงพื้นที่ร้าน: ลิงก์ "ข้ามไปยังเนื้อหา", header, sidebar, backdrop, ใช้ `inert` กับเนื้อหาเมื่อเมนูมือถือเปิด |
| | `AppHeader` / `AppSidebar` / `Backdrop` / `SidebarContext` | แถบบน, แถบข้างแบบยุบได้พร้อม sub-item, ป้าย `attention`/`badgeLabel`/`trailing` (เช่น "เหลือ N วัน"), เมนูผู้ใช้ (บัญชีของฉัน, ลายเซ็นของฉัน, เปลี่ยนรหัสผ่าน, เชื่อมบัญชี LINE, ออกจากระบบ); logic ใน `app-sidebar.logic.ts` |
| | `SystemHeader` / `SalesHeader` | แถบนำทางของคอนโซลระบบและทีมขาย พร้อม badge งานค้าง |
| | `BackLink` | ลิงก์ "กลับไป + ชื่อที่" |
| `badge/` | `Badge` | ป้าย `ready|planned|neutral` |
| `brand/` | `MangmeeLogo`, `MangmeePlusMark` | โลโก้เหรียญงอกเงย และเครื่องหมายแท่งกราฟ |
| `button/` | `Button`, `IconButton`, `button-classes.ts` | ปุ่มเดียวของระบบ 4 แบบ `primary|secondary|quiet|danger` (`ghost` = ชื่อเก่าของ `quiet`), ขนาด `sm|md|lg`, `loading` → `aria-busy`; class `.mangmee-btn*` ใช้กับ `<button>`/`<a>` ดิบให้หน้าตาเดียวกัน |
| `data-table/` | `DataTable`, `Pagination`, `ListPageLayout`, `DetailPageLayout`, `FormPageLayout` | ตารางทั่วไป แบ่งหน้า และโครงหน้า list/detail/form |
| `document-preview/` | `DocumentPreviewModal` | ดูรูป/PDF ในหน้าต่าง (เฉพาะชนิดไฟล์ที่ระบบรับหรือสร้าง) รองรับการพิมพ์เฉพาะเนื้อ modal |
| `field/` | `TextField`, `SelectField`, `TextareaField`, `SwitchField`, `FieldError` | ช่องกรอกพร้อม label, hint, error, เครื่องหมายบังคับ |
| | `ThemedSelect`, `ThemedDate`, `ThemedFile`, `PopoverPanel` | ตัวแทน `<select>`, `<input type=date|month>`, `<input type=file>` ที่ธีมได้และตามภาษาแอป; panel เปิดผ่าน portal ตามตำแหน่ง trigger |
| | `ChoiceRow`, `InfoTip`, `ThaiAddressFields` | ตัวเลือก radio/checkbox แถว 44 px, tooltip อธิบาย, ชุดช่องที่อยู่ไทย (ค้นจากรหัสไปรษณีย์ผ่าน address master) |
| `layout/` | `Stack` | จัดแนว/ช่องไฟ (`gap 1–5` ตาม token) |
| `mangmee/` | `MangmeePage`, `MangmeeCard`, `MangmeeMutedCard`, `MangmeeBranchChip`, `MangmeeIconFrame`, `MangmeeBadge`, `MangmeeStatCard`, `MetricGrid`, `mangmee-design.ts` | กรอบหน้ามาตรฐาน (หัวเรื่องเดียว, back link, actions), การ์ด, ป้ายสาขา, ป้ายสถานะ 12 โทนสี, ตารางตัวเลขแบบหน้าแรก |
| `modal/` | `Modal`, `AlertModal`, `useConfirm`, `useInputPrompt` | dialog เดียวของระบบ (focus trap, Escape, backdrop, `dirty`, `printSurface`, ขนาด `sm|md|lg|xl`); ตัวแทน `window.alert/confirm/prompt` |
| `notice/` | `Notice` | แถบข้อความในหน้า 4 โทน หนึ่งประโยค หนึ่ง action |
| `page/` | `PageHeader`, `ActionToolbar` | หัวหน้าแบบเก่า (breadcrumbs) และแถบค้นหา/กรอง/ปุ่ม |
| `state/` | `LoadingState`, `CoverLoader`, `EmptyState`, `ErrorState`, `ForbiddenState`, `BrandedState` | สถานะมาตรฐานทั้งหมด (`BrandedState` = หน้าเต็มจอมีโลโก้ ใช้กับ error/404/แจ้งเบราว์เซอร์) |
| `steps/` | `ThemedSteps` | ตัวบอกขั้นของ wizard แบบวงกลมเลข (`done|current|upcoming|attention`) |
| `tabs/` | `FilterTabs` | แท็บกรองเหนือรายการพร้อมจำนวน เลื่อนในตัวเองบนมือถือ |
| `toast/` | `ToastProvider`, `Toast`, `useToast`, `toast.logic.ts` | ข้อความตอบกลับชั่วคราว (ดู 8.4) |
| `unsaved-navigation/` | `useUnsavedNavigation`, `requestNavigation` | กันออกจากหน้าที่ยังไม่บันทึก |
| อื่น ๆ | `prototype-data-notice.tsx` | ป้ายเตือน "ข้อมูลตัวอย่าง" ของหน้าต้นแบบ |

ส่วนใช้ร่วมนอก `components/`: `src/common/icons/` (ไอคอน SVG 57 ไฟล์จาก TailAdmin, MIT, `ATTRIBUTION.md`), `src/common/hooks/` (`use-dialog-focus`, `use-body-scroll-lock`, `use-close-on-outside-click`, `use-media-query`), `src/common/files/` (อัปโหลด, ดาวน์โหลด PDF/artifact, แปลงรูป), `src/common/legal/` (`LegalPage`, `LegalDocNav`, `legal-content.ts`), `src/common/table/paging.logic.ts`, `src/common/functions/` (`deep-link`, `list-query`, `overlay-geometry`)

ฐานของเปลือกและ primitive มาจากเทมเพลต TailAdmin (Next.js admin dashboard, MIT) ตาม "TailAdmin Template Exception" ใน `web-frontend-code-style.md` โดยเปลี่ยนชื่อเป็นของ WatchDog และแมปสีเข้ากับ design tokens

### 2.3 แนวทาง UX ที่บันทึกไว้ใน `docs/guidelines`

`docs/guidelines/` มี 4 ไฟล์: `thai-ux-standard.md` (มาตรฐาน UX ของหน้าจอที่ขาย มีผล 2026-10-13), `web-frontend-code-style.md`, `backend-hexagonal-code-style.md`, `security-implementation-guideline.md` สาระที่เกี่ยวกับ UI:

| หลัก | ข้อกำหนด (อ้าง `thai-ux-standard.md`) | สิ่งที่โค้ดทำ |
|---|---|---|
| ผู้ใช้เป้าหมาย | เจ้าของร้านไทยหรือคนทำเอกสารคนเดียวของร้าน ไม่ใช่นักบัญชี ใช้มือถือก่อน | หน้าทั้งหมดออกแบบที่ 390 px ก่อน |
| Mobile-first 390 px | ทุกหน้าต้องดูที่ 390, 1280 และหน้าต่างกว้าง ≥1536 พร้อมเมนูข้างเปิด (และ 360/768 ถ้าดูแน่น); ห้าม scroll แนวนอนระดับหน้า (§3.2) | `.mangmee-content { overflow-x: clip }`, ตารางเลื่อนในกล่องตัวเอง |
| หน้าต่างกว้างต้องเต็มจอ | ทุกหน้าเต็มพื้นที่เนื้อหา ไม่มีแบบแคบ/กึ่งกลาง ไม่มีการ์ดที่มี max-width ส่วนตัว (§3.3; เจ้าของ 2026-10-13 "ทำไมไม่ทำเต็มจอ") | คอมเมนต์และกฎใน `globals.css` บรรทัด ~191 |
| แถบปุ่มล่าง | ปุ่มของฟอร์มจบที่ท้ายฟอร์มและติดขอบล่างหน้าต่าง เริ่มที่ขอบเนื้อหา (`--workspace-content-left`) (§3.2–3.3) | `FormActionBar`, `.mangmee-form-bar` |
| ปุ่มในกลุ่มขนาดเดียวกัน | สูงเท่ากันเสมอ กว้างเท่ากันเมื่อเป็นคู่/แถว/กอง; วัดจริง ไม่กะด้วยตา (§2.3, §7) | `ActionGroup` + `useActionGroupLayout`, footer ของ `Modal` |
| ลำดับปุ่ม | ถอยออกก่อน ลงมือทำทีหลัง; ทำลายเป็นสีแดงและไม่ใช่ default focus (§2.4) | `.mangmee-actions`, `useConfirm` (ปุ่มปลอดภัย default = `ปิด`) |
| ปุ่มหลักหนึ่งปุ่มต่อ view | dialog นับเป็น view ของตัวเอง (§2.1) | `data-variant` บน `Button` ให้เทสต์นับได้ |
| พูดให้น้อย | hint หนึ่งบรรทัด, เนื้อ dialog หนึ่งประโยค, ไม่ซ้ำหัวเรื่อง (§1.3) | `Notice`, `useConfirm` |
| คำธรรมดาสำหรับคนไม่ใช่นักบัญชี | ไทยธรรมดา ไม่มี `กรุณา/ดำเนินการ/ท่าน`, ไม่มีอังกฤษ/รหัส/ชื่อสถานะบนจอ, ไม่มีหางเสียงบนเว็บ (LINE มีเสียงของตัวเอง) (§1.4–1.5) | อภิธานศัพท์บังคับ (§Glossary) เช่น `ร้าน` ไม่ใช่ `บริษัท`, `ใบเบิก`, `จ่าย`, `ลายเซ็น/เซ็น`, `รหัสยืนยัน` ไม่ใช่ OTP, `แพ็กเกจ`, `ทีมงานมั่งมี`; เฝ้าด้วย `sold-features-wording.spec.ts` |
| ปุ่มบอกสิ่งที่จะเกิด | กริยา + กรรม (`บันทึกร่าง`, `ส่งอนุมัติ`, `ออกหนังสือรับรอง 50 ทวิ`); ห้าม `ตกลง/OK/ใช่/ไม่` เปล่า ๆ (§1.2) | ชื่อปุ่มในทุกหน้า |
| การปฏิเสธต้องมีทางออก | error บอกว่าเกิดอะไรและต้องทำอะไร พร้อมปุ่ม/ลิงก์ไปที่แก้ (§1.6) | prop `action` ของ `ForbiddenState`/`Notice` |
| คำต้องจริงทุกกรณี | สร้างประโยคจากข้อเท็จจริงที่เดียว (§1.7) | คำกลางใน `packages/contracts` |
| Dialog ยืนยัน | เฉพาะก่อนสิ่งที่ย้อนไม่ได้/มีค่าใช้จ่าย; ปิดด้วย ✕/Escape/backdrop คือผลปลอดภัยและไม่ทิ้งข้อความที่พิมพ์ (§4) | `Modal` `dirty`, `closeOnBackdrop` |
| ข้อความไทยบนจอ | line-height ≥1.5, ห้ามตัดสระบน-ล่าง, หน่วยที่อ่านเป็นก้อนเดียวห้ามแตกบรรทัด, จำนวนเงินชิดขวา `tabular-nums` (§5) | `globals.css` §"Things read as one unit" |
| สี่สถานะของทุก action | กำลังทำ / เสร็จ (เป็นคำ) / ล้มเหลว (ข้อความที่พิมพ์ยังอยู่) / ไม่อนุญาต (เหตุผลและทางออก); สถานะไม่บอกด้วยสีอย่างเดียว (§6) | ป้ายสถานะมีคำเสมอ, `Notice` มีเครื่องหมายเป็นข้อความ |
| หลักฐานก่อนบอกว่าเสร็จ | เปิดหน้าจริงที่ 390 และ 1280 ด้วยข้อมูลไทย วัดกลุ่มปุ่ม กดเส้นทางหลักหนึ่งรอบรวมทางผิดหนึ่งครั้ง (§7) | ผล: `e2e/RESPONSIVE-RESULTS*.md`, journey specs |

มาตรฐานนี้บังคับกับหน้าที่ร้านในแพ็กที่ขายเข้าถึงได้ (`TIER_FEATURE_PRESETS`) รวมหน้า sign-in, sign-up, ซื้อแพ็กเกจ และโปรไฟล์ตนเอง **คอนโซลพนักงานมั่งมีและโมดูลที่ไม่ได้ขายไม่อยู่ใต้มาตรฐานนี้** (`thai-ux-standard.md` §Status)

---

## 3. แบบจำลองการนำทาง เมนู entitlement และสิทธิ์

### 3.1 สิ่งที่แต่ละแพ็กได้ (จากโค้ด)

`packages/contracts/src/menu-entitlements.ts`:

```ts
TIER_FEATURE_PRESETS = {
  STARTER_249: starter, BASIC_499: starter, PRO_999: starter,
  ENTERPRISE_1999: [...starter, 'wht_pnd53', 'wht_50bis'],
}
```

Starter preset (`STARTER_FEATURE_KEYS`, 17 keys): `dashboard_notifications`, `expenses`, `expenses.list`, `expenses.upload`, `expenses.manual`, `expenses.categories`, `expenses.evidence`, `expenses.signatures`, `reimbursement`, `ai_line_assistant`, `employee_access`, `employee_access.employees`, `employee_access.roles`, `employee_access.overview`, `company_settings`, `company_settings.branches`, `company_settings.security` โดย `employee_access` และ `company_settings` เป็น `PLATFORM_INVARIANT_FEATURE_KEYS` (เปิดเสมอ ไม่ใช่สินค้า; `feature-entitlements.ts:607`)

| แพ็ก (`PlanTierKey`) | ชื่อไทย (`PLAN_TIER_PRESETS`) | สาขา | พนักงาน | ใบเสร็จ/เดือน | เมนูที่ได้ |
|---|---|---|---|---|---|
| `FREE_TRIAL_15` | ทดลองใช้ฟรี | 1 | 2 | 15 | ไม่อยู่ใน `TIER_FEATURE_PRESETS` (type ตัด `FREE_TRIAL_15` ออก) — ชุดเมนูของ trial ไม่ได้กำหนดในไฟล์นี้ |
| `STARTER_249` | เริ่มต้น | 1 | 2 | 30 | starter preset |
| `BASIC_499` | เติบโต | 2 | 5 | 50 | starter preset |
| `PRO_999` | มืออาชีพ | 5 | 10 | 100 | starter preset |
| `ENTERPRISE_1999` | ธุรกิจ | 10 | 30 | 500 | starter preset + `wht_pnd53` (ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ) + `wht_50bis` (ออกหนังสือรับรอง 50 ทวิในระบบ) |

หน้าเว็บของร้านแสดงชื่อแพ็กโดยตัดวงเล็บอังกฤษออก (`shopPlanTierLabel`, `plan-term.ts:144`) สี่แพ็กที่ขายต่างกันที่โควตา ไม่ใช่เมนู ยกเว้น ENTERPRISE ที่เพิ่มสองสิทธิ์ด้านภาษีหัก ณ ที่จ่าย

Add-on (`packages/contracts/src/billing.ts:89-111`): `CHAT_50` (50 เครดิต AI, 299 บาท), `CHAT_100` (549), `CHAT_300` (1,499), `RECEIPT_IMAGE_20` (20 ใบ, 349), `RECEIPT_IMAGE_50` (799), `RECEIPT_IMAGE_100` (1,499) — ดูข้อสังเกตเรื่องหน้าจอซื้อ add-on ในหัวข้อ 13

### 3.2 ตาราง `MENU_ENTITLEMENT_BINDINGS` (ครบ 30 รายการ)

คอลัมน์ "แพ็ก" คำนวณจากกฎใน `packageMenuLabels`: เมนูนับว่าได้เมื่อ **ทุก** `entitlementKeys` อยู่ใน preset ของแพ็ก

| navKey | ชื่อเมนู | กลุ่ม | entitlementKeys | gatePermissions (อย่างน้อยหนึ่ง) | status | แพ็ก |
|---|---|---|---|---|---|---|
| `dashboard` | หน้าแรก | main | `dashboard_notifications` | `dashboard.read` | ready | ทุกแพ็กที่ขาย |
| `inbox` | กล่องข้อความ | operate | `crm.inbox` | `crm.inbox.read` | ready | ไม่มี |
| `customers` | ลูกค้า | operate | `crm.customers` | `crm.customer.read` | ready | ไม่มี |
| `booking` | การจองออนไลน์ | operate | `crm.bookings` | `crm.booking.read` | ready | ไม่มี |
| `crmreport` | รายงาน CRM | operate | `crm.overview` | `crm.report.read` | planned | ไม่มี |
| `crmsettings` | สินค้าและบริการ | operate | `product_catalog` | `inventory.product.read` | ready | ไม่มี |
| `salesdoc` | เอกสารขายและรับชำระ | operate | `sales_documents` | `accounting.document.read`, `…read_related`, `accounting.quotation.read`, `accounting.invoice.read`, `accounting.billing_note.read`, `accounting.receipt.read`, `accounting.tax_invoice.read`, `accounting.credit_note.read`, `accounting.debit_note.read` | planned | ไม่มี |
| `sales` | การขาย | operate | `sales_documents` | `accounting.quotation.read`, `accounting.invoice.read` | planned | ไม่มี |
| `inventory` | คลังสินค้า | operate | `inventory` | `inventory.location.read`, `inventory.movement.read`, `inventory.movement.create`, `inventory.stock_count.create`, `inventory.movement.adjust`, `inventory.report.read` | ready | ไม่มี |
| `procurement` | จัดซื้อ | operate | `procurement.suppliers`, `.purchase_requests`, `.purchase_orders`, `.goods_receipts` | `procurement.supplier.read`, `procurement.purchase_request.read(_related)`, `procurement.purchase_order.read(_related)`, `procurement.goods_receipt.read(_related)` | ready | ไม่มี |
| `workflow` | เวิร์กโฟลว์ | operate | `workflow_automation` | `workflow.template.read`, `workflow.rule.read`, `workflow.task.read`, `workflow.run.read`, `workflow.dead_letter.read`, `workflow.webhook.manage` | ready | ไม่มี |
| `ai-suggestions` | AI แนะนำ | operate (contextual) | `ai_line_assistant` | `ai.suggestion.read`, `ai.suggestion.read_own` | ready | ทุกแพ็กที่ขาย (ไม่เป็นเมนูหลัก) |
| `expenses` | ค่าใช้จ่ายและใบเสร็จ | finance | `expenses` | `expense.read`, `expense.read_related`, `expense.read_own`, `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.create`, `expense.confirm`, `expense.category.manage`, `expense.signature.self_manage`, `expense.signature.manage`, `expense.evidence.read` | ready | ทุกแพ็กที่ขาย |
| `counterparties` | คู่ค้า | finance | `expenses`, `sales_documents` | `accounting.counterparty.read`, `accounting.counterparty.manage` | ready | ไม่อยู่ในรายชื่อเมนูบนการ์ดแพ็ก (ขาด `sales_documents`) แต่แถบข้างแสดงตามสิทธิ์ — ดู 3.4 |
| `reimbursements` | การเบิกจ่าย | finance | `reimbursement` | `reimbursement.read`, `reimbursement.read_related`, `reimbursement.read_own`, `reimbursement.approve`, `reimbursement.finance_review` | ready | ทุกแพ็กที่ขาย |
| `journal` | สมุดรายวัน | finance | `double_entry_ledger` | `ledger.journal.read` | ready | ไม่มี (และถูกซ่อนด้วย `ACCOUNTING_UI_HIDDEN`) |
| `accounting` | บัญชี | finance | `sales_documents` | เหมือน `salesdoc` | planned | ไม่มี |
| `tax` | ภาษี | finance | `thai_tax` | `tax.profile.read`, `tax.config.read`, `tax.period.read`, `tax.event.read`, `tax.report.read` | ready | ไม่มี |
| `pnd53` | ภาษีหัก ณ ที่จ่าย | finance | `wht_pnd53` | `wht.pnd53.read`, `wht.pnd53.prepare` | ready | `ENTERPRISE_1999` เท่านั้น |
| `accounts-payable` | เจ้าหนี้การค้า | finance | `procurement.vendor_bills`, `.supplier_payments`, `.ap_aging` | `procurement.vendor_bill.read(_related)`, `procurement.supplier_payment.read(_related)`, `procurement.ap.report` | ready | ไม่มี |
| `banking` | บัญชีธนาคาร | finance | `bank_reconciliation` | `bank.account.read`, `bank.cash.read`, `bank.statement.read`, `bank.match.read`, `bank.reconciliation.read`, `bank.adjustment.read` | ready | ไม่มี |
| `reports` | รายงานการเงิน | finance | `reports` | `report.catalog.read` (retained: `report.snapshot.read`) | ready | ไม่มี |
| `closing` | ปิดงวด | finance | `double_entry_ledger` | `ledger.period.read` | planned | ไม่มี |
| `crm` | ลูกค้า (CRM) | growth | `crm` | `crm.customer.read`, `crm.lead.read`, `crm.opportunity.read`, `crm.report.read`, `crm.follow_up.read` | ready | ไม่มี |
| `roles` | พนักงานและสิทธิ์ | admin | `employee_access` | `access.role.read`, `access.role.manage`, `access.employee.read`, `access.employee.create`, `access.employee.update`, `access.effective.read` | ready | ทุกแพ็ก (platform invariant) |
| `settings` | ตั้งค่าร้าน | admin | (ว่าง) | `company.settings.view`, `company.setup.manage`, `ledger.account.read/manage`, `tax.profile.read/manage`, `tax.config.read/manage`, `ledger.posting-rule.read/manage` | ready | ทุกแพ็ก |
| `notifications` | การแจ้งเตือน | admin | `dashboard_notifications` | `notification.read` | ready | ทุกแพ็กที่ขาย (เข้าจากกระดิ่ง ไม่ใช่แถบข้าง) |
| `lineoa` | เชื่อมต่อ LINE OA | admin | `line_oa` | `crm.channel.read` | ready | ไม่มี |
| `poapproval` | อนุมัติคำสั่งซื้อ | admin | `procurement.purchase_orders` | `procurement.purchase_order.read` | planned | ไม่มี |
| `discount` | นโยบายส่วนลด | admin | `crm.customers` | `crm.customer.read` | planned | ไม่มี |

`packageMenuLabels(featureKeys)` คือ helper เดียวที่การ์ดแพ็กบนเว็บและแค็ตตาล็อกแพ็กใน LINE ใช้ร่วมกัน: ขึ้นต้นด้วย "ผู้ช่วย AI ทาง LINE" (ถ้ามี `ai_line_assistant`), ตามด้วยชื่อเมนู `ready` ที่ไม่ใช่ contextual, และ "ออกหนังสือรับรอง 50 ทวิในระบบ" (ถ้ามี `wht_50bis`); เมนู `pnd53` ถูกเรียกบนการ์ดว่า "ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ"

### 3.3 กลไกซ่อน/แสดงเมนูในเว็บ

ลำดับการตัดสิน (ทั้งหมดอยู่ใน `src/features/web-core-workspace/`):

1. **Entitlement → permission (ฝั่ง API)**: เว็บไม่คำนวณ entitlement เอง มันอ่าน `session.permissions` จาก `GET /v1/auth/me` ซึ่ง API กรองตามฟีเจอร์ที่ร้านเปิดแล้ว และอ่าน `session.availablePermissions` (สิทธิ์ที่ role มีโดยไม่คิดแพ็ก ใช้เลือกข้อความ "แพ็กเกจของร้านยังไม่มีหน้านี้") กับ `session.entitledFeatureKeys` (ใช้ตรงจุดเดียวคือ `shopHasSystemWhtCertificates` → `wht_50bis`)
2. **รายการโมดูล**: `WORKSPACE_MODULES` (`web-core-workspace.constants.ts`) สะท้อน `MENU_ENTITLEMENT_BINDINGS` (key, href, icon, group, `requiredAnyPermissions`, `status`)
3. **กรองตามสิทธิ์**: `filterModulesByPermissions` — ต้องมีอย่างน้อยหนึ่งสิทธิ์ใน `requiredAnyPermissions`; โมดูล `roles`/`ai-suggestions`/`tax`/`poapproval`/`discount`/`lineoa` ตัดสินด้วย `canSeeRoute` ของ route จริง
4. **ซ่อนหน้าบัญชี**: `ACCOUNTING_UI_HIDDEN = true` ซ่อน `journal` และ `closing` ทั้งแถบข้างและการเข้าด้วย URL (การซ่อนเป็น presentation เท่านั้น entitlement `double_entry_ledger` ยังทำงานเบื้องหลัง)
5. **โหมด `freeExpenseDrafts`**: เหลือโมดูล `expenses` อย่างเดียว และเข้าได้เฉพาะรายการ, อัปโหลด และรายละเอียดเอกสาร (`canAccessFreeExpenseWorkspacePath`) รวมทั้ง `/billing` ถ้ามี `company.plan.manage`
6. **สร้างแถบข้าง**: `buildNavItems` สร้าง sub-item (ดู 3.4) เพิ่ม `แพ็กเกจ` เมื่อมี `company.plan.manage` และเพิ่มกลุ่ม `คู่มือการใช้งานระบบ`
7. **รายการที่อนุญาตให้ขึ้นแถบข้าง**: `DESIGN_HANDOFF_NAV_ORDER` ใน `WorkspaceLayout.tsx` — เรียงและจำกัดเฉพาะ `dashboard, inbox, customers, booking, crmreport, crmsettings, salesdoc, expenses, counterparties, reimbursements, journal, tax, pnd53, reports, billing, roles, settings, guide` (โมดูล `inventory`, `procurement`, `workflow`, `accounts-payable`, `banking`, `crm`, `accounting`, `sales` **ไม่ขึ้นแถบข้างแม้มีสิทธิ์** แต่ route ยังเปิดได้ถ้าผ่านกฎสิทธิ์); session เดโม่ (`isDemo`) ไม่แสดง `billing`
8. **กันเข้าด้วย URL**: `canAccessWorkspacePath` + `ROUTE_PERMISSION_RULES` (`route-permissions.ts`, 49 กฎ ใช้กฎที่ path ยาวที่สุดที่ตรง) + `requireRoutePermission` ในหน้า
9. **ร้านที่ไม่มีแพ็ก/หมดอายุ**: `buildLockedNavItems` — เหลือ `ตั้งค่าร้าน` (+ `แพ็กเกจ`)

### 3.4 แถบข้างที่ร้านในแพ็กที่ขายเห็นจริง

| กลุ่ม | เมนู | เมนูย่อยและเงื่อนไข (จาก `buildNavItems`) |
|---|---|---|
| main | **หน้าแรก** (`/dashboard`) | `dashboard.read` |
| finance | **ค่าใช้จ่ายและใบเสร็จ** | `รายการค่าใช้จ่าย` (`expense.read|read_related|read_own`); `อัปโหลดใบเสร็จ` (`expense.receipt.upload`); `บันทึกด้วยมือ` (`expense.create` และค่าตั้งร้าน `manualExpenseWebEntry !== false`); `ใบเตรียมจ่าย/ใบสำคัญจ่าย` (`expense.disbursement.read` และค่าตั้งร้าน `disbursementVoucherWebEntry === true`); `หนังสือรับรอง 50 ทวิ` (`wht.certificate.read|issue|correct` หรือ `wht.external_certificate.link`); `ใบรับรองแทนใบเสร็จ` (`expense.review|confirm|read_related|read_own`); `หลักฐานทางบัญชี` (`expense.evidence.read`); `หมวดหมู่` (`expense.category.manage`) |
| finance | **คู่ค้า** (`/counterparties`) | `accounting.counterparty.read|manage` — binding ระบุ entitlement สองตัว (`expenses`, `sales_documents`) เพราะ permission ชุดนี้ถูกให้จาก pack ใต้ทั้งสองฟีเจอร์ (คอมเมนต์ `menu-entitlements.ts:208-214`); ร้าน starter เห็นเมนูเมื่อ session มีสิทธิ์นี้ |
| finance | **การเบิกจ่าย** (`/reimbursements`) | `reimbursement.read|read_related|read_own|approve|finance_review` |
| finance | **ภาษีหัก ณ ที่จ่าย** (`/tax/withholding`) | `wht.pnd53.read|prepare` — ENTERPRISE |
| admin | **แพ็กเกจ** (`/billing`) | `company.plan.manage`; ท้ายแถวแสดง "เหลือ N วัน" (`packageMenuTrailing`) เป็นสีเตือนเมื่อใกล้หมดและไม่มีการต่ออายุด้วยบัตร |
| admin | **พนักงานและสิทธิ์** | `รายชื่อพนักงาน` (`/settings/access-overview`, `access.employee.read`); `บทบาทและสิทธิ์` (`/settings/permissions`, `access.role.manage`); `เพิ่มพนักงาน` (แสดงเฉพาะคนที่มี `access.employee.create` แต่เปิดรายชื่อไม่ได้) |
| admin | **ตั้งค่าร้าน** | `ภาพรวมการตั้งค่า` (`company.settings.view|company.setup.read|manage`); `ข้อมูลร้าน` (`company.setup.read|manage`; ป้าย "ยังไม่ครบ" เมื่อ checklist ข้อมูลร้านยังขาด และจุดสีเหลืองบนเมนูแม่ สำหรับผู้มี `company.legal_identity.manage`); `สาขา` (`company.branch.read|manage`); `ตั้งค่าใบรับรองแทนใบเสร็จ` (`company.setup.manage`); e-WHT (`company.setup.manage`; ชื่อจาก `E_WHT_WORDS['S-1']`); `ลายเซ็นบน 50 ทวิ` (`company.tax_signature.manage` และร้านมี `wht_50bis`) |
| help | **คู่มือการใช้งานระบบ** | `เริ่มใช้งานร้านและ LINE`, `ค่าใช้จ่ายและใบเสร็จ`, `ใบรับรองแทนใบเสร็จ`, `การเบิกจ่าย` — ไม่ต้องมีสิทธิ์และไม่มี entitlement; คู่มือ `ภาษี` และ `รายงานการเงิน` ถูกซ่อนจากเมนู (เจ้าของ 2026-08-10) แต่ route ยังอยู่ |

องค์ประกอบนอกแถบข้าง: กระดิ่ง (`notification.read`, ไม่แสดงในโหมด free), ตัวสลับร้าน (`GET /v1/auth/me/companies`), ตัวเลือกสาขา (`GET /v1/companies/:id/branches`), เมนูผู้ใช้ (`บัญชีของฉัน` → `/account`, `ลายเซ็นของฉัน` → `/expenses/signatures` เมื่อมีสิทธิ์ลายเซ็นของตัวเอง, `เปลี่ยนรหัสผ่าน`, `เชื่อมบัญชี LINE`, `ออกจากระบบ`)

### 3.5 เมนูของคอนโซลระบบและทีมขาย

**`/system`** (`SystemHeader.tsx`): กลุ่ม *ลูกค้า* — `บริษัทและผู้ใช้งาน` (`/system/partners`), `การชำระเงิน` (`/system/billing`; ต้อง `billingAllowed`); กลุ่ม *คำขอและการติดต่อ* — `ขอความช่วยเหลือ` (`/system/support-requests`; badge จำนวนที่รอ), `คำขอสมัครใช้งาน`, `คำขอเกี่ยวกับข้อมูล` (`/system/data-rights`), `สถานะอีเมล` (ต้อง `emailAllowed`); กลุ่ม *ตั้งค่าระบบ* — บัญชีผู้บริหาร (`system.executive_user.manage`), ประเภทเงินได้หัก ณ ที่จ่าย (`system.wht_income_category.manage`), `ทีมขาย`, `ลิงก์เดโม่`, `ธีมหน้าแรก` (`system.home_theme.manage` + SYSTEM_ADMIN), `ตั้งค่า LINE`, `เพดานความปลอดภัยค่า AI`, `เปิด–ปิดบริการ`; เมนูรายงานผู้บริหาร (`EXECUTIVE_MENU`) เมื่อมี `system.executive.read` ผู้ใช้แบบ billing-only เห็นเฉพาะ `การชำระเงิน`; แบบ executive-only เห็นเฉพาะรายงาน

**`/sales`** (`SalesHeader.tsx`): กลุ่ม *งานขาย* — `ดีล`, `ลิงก์เดโม่`, `ร้านค้า`, `ส่วนลดจากงาน`, `งานของฉัน` (badge), `รายงาน` (`sales.report.read`); กลุ่ม *จัดการทีม* — `ทีม` (`sales.team.manage`); กลุ่ม *บัญชี* — `ข้อมูลของฉัน`

---

## 4. รายการหน้าจอทั้งหมด (207 หน้า)

**การนับ** `find apps/web/app -name page.tsx | wc -l` = **207** แบ่งเป็น: พื้นที่ร้าน `(workspace)/companies/[companyId]/…` 103, คอนโซลระบบ `system/…` 70, คอนโซลทีมขาย `sales/…` 12, หน้า auth/สาธารณะ/LINE 22 (งานมอบหมายประมาณไว้ ~190; ตัวเลขจริงคือ 207)

**วิธีอ่านตาราง**
- *Route* ในหัวข้อ 4.1–4.2 เขียนต่อจาก `/companies/[companyId]`
- *สิทธิ์* = permission key ที่หน้า/กฎ route ตรวจ (อย่างน้อยหนึ่งตัว เว้นแต่ระบุ "และ") ที่มา: `ROUTE_PERMISSION_RULES`, `page.tsx`, `buildNavItems` — API ตรวจซ้ำเสมอ
- *แพ็ก*: **S+** = ทุกแพ็กที่ขาย (`STARTER_249`, `BASIC_499`, `PRO_999`, `ENTERPRISE_1999`); **ENT** = `ENTERPRISE_1999` เท่านั้น; **ทุกร้าน** = ไม่ผูก entitlement ที่ขาย (platform invariant หรือหน้าบัญชี/แพ็กเกจ); **นอก** = ไม่อยู่ใน preset ของแพ็กใด
- *API* เขียนต่อจาก `/v1/companies/:companyId` (เบราว์เซอร์เรียกผ่าน `/api/v1/…`) เว้นแต่ขึ้นต้นด้วย `/v1/`; path ตรวจจากไฟล์ `*.api.ts` ของฟีเจอร์ ส่วน HTTP method ที่เขียนกำกับเป็นเพียงตัวบ่งชี้ (ดูเอกสาร API ของชุดนี้สำหรับ method/สิทธิ์ที่แน่นอน)

### 4.1 พื้นที่ร้าน — หน้าที่อยู่ในขอบเขตแพ็กที่ขาย (52 หน้า)

#### 4.1.1 หน้าแรก บัญชี แจ้งเตือน และคู่มือ

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์ | แพ็ก | API หลัก | Component |
|---|---|---|---|---|---|---|
| `/dashboard` | หน้าแรก | ภาพรวมรายจ่ายตามช่วง (วันนี้/สัปดาห์นี้/เดือนนี้/ไตรมาสนี้/เลือกวันที่), ตัวเลขงานที่รอ (เช่น ใบเสร็จรอตรวจ), การ์ดรายจ่ายรายเดือน, ทางลัด, ปุ่ม "อัปเดตข้อมูล" | `dashboard.read` | S+ | `GET /dashboard`, `GET /dashboard/expense-months`, `POST /dashboard/snapshots/generate`, `GET /notifications/unread-count` | `WorkspaceDashboardPage` → `dashboard-notifications/DashboardPages.tsx`, `ExpenseMonthsCard` |
| `/account` | บัญชีของฉัน | ข้อมูลบัญชีตนเอง: ชื่อที่แสดง, อีเมล, เบอร์มือถือ, รหัสผ่านสำรอง, เชื่อม LINE, ลิงก์ไปลายเซ็นของฉัน | ทุกสมาชิก (ผ่านเสมอใน `canAccessWorkspacePath`) | ทุกร้าน (เปิดได้แม้ร้านถูกล็อก) | `/v1/auth/account/display-name`, `/v1/auth/account/email`, `/v1/auth/account/email/resend`, `/v1/auth/account/security`, `/v1/auth/me/contact`, `/v1/auth/me/password/set` | `company-profile/CompanyProfilePage` (`accountOnly`) |
| `/notifications` | ศูนย์การแจ้งเตือน | รายการแจ้งเตือนตามความสำคัญ (สำคัญ/ต้องดำเนินการ/ข้อมูลเชิงลึก/แจ้งเพื่อทราบ), อ่าน, อ่านทั้งหมด, ปิด, เปิดเอกสารจาก deep link | `notification.read` | S+ | `GET /notifications`, `POST /notifications/:id/read`, `…/dismiss`, `POST /notifications/read-all`, `GET /notification-deliveries`, `POST /notification-deliveries/:id/retry` | `dashboard-notifications/NotificationPages.tsx` (`NotificationCenterPage`), `NotificationBell` |
| `/notifications/preferences` | (redirect) | ส่งต่อไป `/settings/notifications` | — | — | — | redirect |
| `/notifications/rules` | กฎการแจ้งเตือน | หน้าจอเดียวกับ `/settings/notification-rules` | `notification.rule.manage` | S+ (ดูหมายเหตุ ก) | `GET/POST /notification-rules`, `PATCH /notification-rules/:id` | `NotificationRulesPage` |
| `/settings/notifications` | ตั้งค่าการแจ้งเตือน | ช่องทาง (เว็บ/LINE), ช่วงเวลาเงียบ, ความถี่สรุป | `notification.preference.manage` | S+ (หมายเหตุ ก) | `GET/PUT /notification-preferences` | `NotificationPreferencesPage` |
| `/settings/notification-rules` | กฎการแจ้งเตือน | เปิด/ปิดกฎ | `notification.rule.manage` | S+ (หมายเหตุ ก) | เหมือน `/notifications/rules` | `NotificationRulesPage` |
| `/ai-suggestions` | AI แนะนำ | รายการข้อเสนอจาก AI ให้ตรวจ (เข้าจากลิงก์/แจ้งเตือน ไม่เป็นเมนูหลัก) | `ai.suggestion.read` หรือ `ai.suggestion.read_own` และ `hasAiSuggestionSourceAccess(permissions)` | S+ (`ai_line_assistant`) | `/ai/suggestions`, `/ai/suggestions/:id`, `/ai/suggestion-templates`, `/ai/suggestions/requests`, `/ai/suggestions/:id/actions/:actionId/validate|create-source-draft`, `/ai/suggestions/:id/reviews` | `ai-suggestions/AiSuggestionsPages.tsx` |
| `/user-guide/getting-started` | คู่มือ: เริ่มใช้งานร้านและ LINE | คำถาม-คำตอบ 52 ข้อ กรองตามสิทธิ์และฟีเจอร์ของผู้อ่าน | ไม่ต้องมี | ทุกร้าน | ไม่มี (เนื้อหาในโค้ด) | `user-guide/UserGuidePage`, `getting-started-guide.content.ts` |
| `/user-guide/expenses` | คู่มือ: ค่าใช้จ่ายและใบเสร็จ | คู่มือ + ส่วนใบเตรียมจ่าย (เมื่อร้านเปิด) + ปุ่มลัดตามสิทธิ์ | ไม่ต้องมี | ทุกร้าน | ไม่มี | `expenses-guide.content.ts`, `disbursement-voucher-guide.content.ts`, `expenses-guide-manual-entry.ts` |
| `/user-guide/substitute-receipts` | คู่มือ: ใบรับรองแทนใบเสร็จ | คู่มือ | ไม่ต้องมี | ทุกร้าน | ไม่มี | `substitute-receipt-guide.content.ts` |
| `/user-guide/reimbursements` | คู่มือ: การเบิกจ่าย | คู่มือ (ปุ่มลัดตามสิทธิ์และ role) | ไม่ต้องมี | ทุกร้าน | ไม่มี | `reimbursement-guide.content.ts` |

หมายเหตุ ก: preset starter มี `dashboard_notifications` แต่ **ไม่มี** sub-key `dashboard_notifications.preferences` และ `dashboard_notifications.rules` (`feature-entitlements.ts`) หน้าทั้งสามจึงเปิดได้เฉพาะเมื่อ session ยังมี `notification.preference.manage` / `notification.rule.manage` หลัง API กรองตาม entitlement — เอกสารนี้ไม่ได้ยืนยันผลการกรองฝั่ง API

#### 4.1.2 ค่าใช้จ่ายและใบเสร็จ (14 หน้า)

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์ | แพ็ก | API หลัก | Component |
|---|---|---|---|---|---|---|
| `/expenses` | รายการค่าใช้จ่าย | รายการเอกสารทั้งหมด, ยอดสรุปของช่วง, แท็บกรองสถานะพร้อมจำนวน, ค้นหา, เลือกเดือน, ส่งออก Excel ให้สำนักงานบัญชี, เปิดรายละเอียด | กฎ `/expenses`: `expense.read`, `expense.read_related`, `expense.read_own`, `expense.receipt.upload`, `expense.receipt.line_upload`, `expense.create`, `expense.confirm`, `expense.category.manage`, `expense.signature.self_manage`, `expense.signature.manage`, `expense.evidence.read` | S+ (`expenses.list`) | `GET /expenses`, `GET /expenses/capture-capability`, `GET /expenses/accounting-software-export` | `expenses/ExpensesPages.tsx` (`ExpensesHubPage` tab `list`) |
| `/expenses/upload` | อัปโหลดใบเสร็จ | เลือก/ถ่ายรูปใบเสร็จ เลือกสาขา หมายเหตุ ส่งให้ AI อ่านเป็นร่าง; "ถ่ายเพิ่ม"/"เลือกเพิ่ม", "ดูรายการที่ส่ง", "ส่งอีกใบ", "เติมข้อมูล", "ลบร่างใบเสร็จ" | `expense.receipt.upload` | S+ (`expenses.upload`) | `POST /expenses/receipt-uploads`, `POST /expenses/:id/receipt-uploads/:uploadId/complete`, `POST /expenses/:id/extraction-request`, `GET /expenses/:id/read-status`, `POST /attachments/upload-intent` | `ExpensesHubPage` tab `upload` |
| `/expenses/manual` | บันทึกด้วยมือ | กรอกข้อมูลเอกสาร ผู้ขาย รายการ ค่าบริการ ภาษี สรุป แล้วบันทึกร่าง | `expense.create` **และ** ค่าตั้งร้าน `manualExpenseWebEntry` (`canOpenManualWeb`) | S+ (`expenses.manual`) | `POST /expenses`, `POST /expenses/:id/totals-preview`, `GET /expense-categories`, `GET /accounting/counterparties` | `ExpensesHubPage` tab `manual` |
| `/expenses/[expenseId]` | รายละเอียดเอกสารค่าใช้จ่าย | ตรวจร่าง 3 ขั้น (ตรวจข้อมูล → ภาษีและเอกสาร → ตรวจสรุป), ส่งให้ตรวจ, ยืนยันเอกสาร, แก้ไขเอกสาร (reopen), ยกเลิกเอกสาร, บันทึกจ่าย/จ่ายบางส่วน/ยกเลิกรายการจ่าย, แนบ/ลบไฟล์, ตรวจบิลซ้ำ, สิทธิ์ใช้ภาษีซื้อ, จดเลขที่ 50 ทวิ/ออก 50 ทวิ, ออกใบสำคัญจ่าย, ประวัติ | กฎ `/expenses` (การกระทำแต่ละอย่างใช้ `expense.update`, `expense.review`, `expense.confirm`, `expense.payment.record` ฯลฯ ตาม API) | S+; ส่วนออก 50 ทวิในระบบ = ENT (`wht_50bis`) | `GET/PATCH /expenses/:id`, `…/review-fields`, `…/mark-ready`, `…/reviewer-mark-ready`, `…/reviewers`, `…/confirm`, `…/reject`, `…/reopen`, `…/void`, `…/payment`, `…/payments`, `…/payments/:pid/cancel`, `…/payments/:pid/confirm-date`, `…/payment-voucher.pdf`, `…/duplicate-check`, `…/duplicates/:did/confirm|dismiss`, `…/input-vat-decision`, `…/buyer-match/confirm`, `…/ocr-total-acknowledgement`, `…/non-expense-classification-override`, `…/signature-fill`, `…/history`, `…/receipts/:rid`, `/wht/expenses/:id/certificate-history`, `/wht/payment-handoffs/…` | `expenses/ExpenseReviewPage.tsx` |
| `/expenses/categories` | หมวดหมู่ | เพิ่มหมวดหมู่, เปลี่ยนชื่อหมวดของร้าน, เปิด/ปิดหมวด, ผูกบัญชีของผู้ทำบัญชี | `expense.category.manage` | S+ (`expenses.categories`) | `GET /expense-categories`, `POST /expense-categories/manage`, `PATCH /expense-categories/:id`, `…/:id/accountant-account` | `ExpensesHubPage` tab `categories` |
| `/expenses/evidence` | หลักฐานทางบัญชี | ตรวจความครบของเอกสารที่ยืนยันแล้วรายเดือน, แท็บ ทั้งหมด/ต้องแก้/ครบแล้ว, "ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี", ส่งออกตาราง | `expense.evidence.read` (ส่งออก: `expense.export`) | S+ (`expenses.evidence`) | `GET /expenses/shared-evidence`, `GET /expenses/accountant-package`, `…/accountant-package/bundle-plan`, `…/accountant-package/bundle/:part`, `GET /expenses/accounting-software-export` | `ExpensesHubPage` tab `evidence` |
| `/expenses/signatures` | ลายเซ็นของฉัน | เพิ่ม/เก็บถาวรภาพลายเซ็นประจำตัว ใช้เซ็นใบรับรองแทนใบเสร็จและใบเบิก | `expense.signature.self_manage`, `expense.signature.manage` (และผู้มี review/confirm ผ่าน entitlement แม่) | S+ (`expenses.signatures`) | `GET /expense-signatures`, `POST /expense-signatures/uploads`, `POST /expense-signatures`, `…/:id/archive`, `…/:id/derived` | `ExpensesHubPage` tab `signatures` |
| `/expenses/substitute-receipts` | ใบรับรองแทนใบเสร็จ | หน้ารวม: งานที่รอคุณ, กรอง 2 แบบ, สถานะ 4 แบบ, เปิดดู/ดาวน์โหลด PDF, เริ่มทำใบใหม่ | `expense.review`, `expense.confirm`, `expense.read_related`, `expense.read_own` | S+ (ไม่มี sub-entitlement; ติดมากับ `expenses`) | `GET /substitute-receipts`, `GET /substitute-receipts/candidates`, `GET /expense-settings/substitute-receipt/runtime` | `expenses/SubstituteReceiptHubPage.tsx` |
| `/expenses/substitute-receipts/new` | ทำใบรับรองแทนใบเสร็จ | wizard 4 ขั้น: ค่าใช้จ่าย → รายละเอียด → เซ็น → เสร็จ (`?expenseId=`, `?entry=new`, `?route=check-bill`, `?workflow=`) | เหมือนแถวบน | S+ | `POST /expenses/:id/substitute-receipt`, `…/evidence-upload`, `…/payers`, `…/:sid/preview`, `…/:sid/certify`, `…/:sid/approve`, `…/:sid/signature-upload-intent`, `…/:sid/paper`, `…/:sid/paper/preview`, `…/:sid/paper/accept`, `…/continuations/:cid` | `expenses/SubstituteReceiptWizardPage.tsx` |
| `/expenses/substitute-receipts/[evidenceId]` | ใบรับรองแทนใบเสร็จ (เปิดใบเดิม) | ทำต่อ/ดูอย่างเดียว (`?mode=view`), แก้หลักฐานการจ่าย (`?edit=payment`), แก้ไขเอกสาร, ออกใบแทน (supersede), ดาวน์โหลด | เหมือนแถวบน | S+ | `GET /substitute-receipts/:id/expense`, `…/substitute-receipt/:sid`, `…/artifact-preview`, `…/artifact.pdf`, `…/form.pdf`, `…/correct-document`, `…/supersede`, `…/history` | `SubstituteReceiptWizardPage` |
| `/expenses/disbursement-vouchers` | ใบเตรียมจ่าย/ใบสำคัญจ่าย | รายการใบ เรียง ร่าง/ส่งกลับให้แก้ → รออนุมัติ → รอจ่าย → จ่ายแล้ว → ยกเลิก; ปุ่ม "สร้างใบเตรียมจ่าย" | `expense.disbursement.read` (เมนูแสดงเมื่อ `disbursementVoucherWebEntry === true`) | S+ (สิทธิ์อยู่ใต้ `expenses`; เปิดเป็นรายร้านโดยผู้ดูแลระบบ) | `GET /disbursement-vouchers` | `expenses/disbursement-vouchers/DisbursementVoucherListPage.tsx` |
| `/expenses/disbursement-vouchers/new` | สร้างใบเตรียมจ่าย | เลือกผู้รับเงินและรายจ่ายยืนยันแล้วที่ค้างจ่าย, บันทึกร่าง, ส่งอนุมัติ (`?draft=`, `?expenseId=`) | `expense.disbursement.prepare` | S+ | `/disbursement-vouchers` และคำสั่งย่อย (POST/PUT/DELETE; `disbursement-vouchers.api.ts`) | `DisbursementVoucherDraftPage.tsx` |
| `/expenses/disbursement-vouchers/[id]` | ใบเตรียมจ่าย / ใบสำคัญจ่าย | เอกสารหนึ่งใบ: ส่งอนุมัติ, อนุมัติ, ส่งกลับให้แก้, กลับไปแก้, ยกเลิกใบ, ลบร่าง, บันทึกว่าจ่ายแล้ว (ได้ใบสำคัญจ่ายเลขเดิม), พิมพ์/ดาวน์โหลด | `expense.disbursement.read` (+ สิทธิ์อนุมัติ/บันทึกจ่ายตาม API) | S+ | `/disbursement-vouchers/:id`, คำสั่งใต้ path เดียวกัน, และ `…/:id.pdf` | `DisbursementVoucherDocumentPage.tsx` |
| `/expenses/wht-certificates` | หนังสือรับรอง 50 ทวิ | รายการจ่ายที่มีภาษีหัก ณ ที่จ่าย: สถานะ พร้อมออก/ยังไม่จ่าย/หลายการจ่าย, กรองเดือนที่จ่ายและแบบภาษี, จดเลขที่ใบที่ทำนอกระบบ, ออก/แก้/ออกสำเนาแทนใบในระบบ | `wht.certificate.read`, `wht.certificate.issue`, `wht.certificate.correct`, `wht.external_certificate.link` | S+ สำหรับจดเลขที่ใบนอกระบบ; **ENT** สำหรับออกใบในระบบ (`shopHasSystemWhtCertificates`) | `GET /wht/payment-handoffs`, `…/:hid/external-certificate` (+`/change`, `/remove`, `/files/:fid`), `…/:hid/payee-address`, `…/:hid/system-certificate` (+`/correction`, `/replacement-copy`) | `expenses/WhtCertificatesPage.tsx` |

#### 4.1.3 คู่ค้า การเบิกจ่าย ภาษีหัก ณ ที่จ่าย

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์ | แพ็ก | API หลัก | Component |
|---|---|---|---|---|---|---|
| `/counterparties` | คู่ค้า | สมุดรายชื่อผู้ขาย/ผู้รับเงิน: ค้นหา, เพิ่ม, แก้ไข | `accounting.counterparty.read`, `accounting.counterparty.manage` | S+ (ดู 3.4) | `GET/POST /accounting/counterparties` | `counterparties/CounterpartiesPage.tsx` |
| `/counterparties/[counterpartyId]` | รายละเอียดคู่ค้า | ข้อมูลภาษี ที่อยู่ ประเภทบุคคล/บริษัท, ใช้ที่อยู่ที่เคยเห็นในเอกสาร (promote seen address), รายจ่ายที่เกี่ยวข้อง | สองตัวบน หรือ `expense.read_related`, `accounting.document.read_related`, `expense.create`, `expense.update`, `expense.review`, `expense.receipt.upload`, `expense.receipt.line_upload` (API ตรวจที่มาของแถว) | S+ | `GET/PATCH /accounting/counterparties/:id`, `POST …/:id/promote-seen-address` | `CounterpartyDetailPage.tsx` |
| `/reimbursements` | การเบิกจ่าย | หน้ารวมใบเบิก: แท็บตามหน้าที่ (ของฉัน/รออนุมัติ/รอการเงิน/รอจ่าย/ทั้งหมด), ตัวกรองสถานะ, ค้นหา, "+ สร้างใบเบิก"; `?focus=<id>` redirect ไปหน้าใบเบิก | `reimbursement.read`, `reimbursement.read_related`, `reimbursement.read_own`, `reimbursement.approve`, `reimbursement.finance_review` (หรือ `account.session.read` สำหรับลิงก์งานที่มอบหมายเฉพาะตัว) | S+ (`reimbursement`) | `GET /reimbursements/hub`, `…/approval-queue`, `…/finance-queue`, `GET /reimbursement-policy`, `…/approver-options` | `reimbursements/ReimbursementsPages.tsx` (`ReimbursementsHubPage`) |
| `/reimbursements/new` | สร้างใบเบิก | รายการ 1–50 รายการ, แนบใบเสร็จ, ใช้ค่าใช้จ่ายที่บันทึกแล้ว (`?expenseId=`), เลือกวิธีรับเงินคืน, บันทึกร่าง, ทำแทนคนอื่น | `reimbursement.create` (ทำแทน: `reimbursement.finance_review`) | S+ | `POST /reimbursements`, `GET /reimbursements/source-options`, `/attachments/upload-intent`, `/attachments/:id/complete`, `/reimbursements/payout-accounts/me` | `ReimbursementCreatePage.tsx` |
| `/reimbursements/[requestId]` | ใบเบิก (journey) | หน้าเดียวของใบเบิกหนึ่งใบ ปลายทางของลิงก์จาก LINE/แจ้งเตือน: ส่งอนุมัติ, อนุมัติ, ส่งกลับให้แก้, ไม่อนุมัติ, ตรวจการเงิน, จ่ายเงิน (`?pay=1`), แนบสลิป, ยกเลิก/ถอนการยกเลิก, เซ็นในระบบ/บนกระดาษ, พิมพ์ใบเบิก, บันทึกภายใน | กฎ `/reimbursements` หรือ `account.session.read` (API ยืนยันการมอบหมาย) | S+ | `GET /reimbursements/:id`, `POST …/submit`, `…/approve`, `…/reject`, `…/reopen`, `…/resume`, `…/finance-review`, `…/payments`, `…/payments/:pid/slips`, `…/payments/:pid/void`, `…/cancel`, `…/cancel/withdraw`, `…/payout-correction`, `…/payout-destination`, `…/payout-destination/reveal`, `…/claim-form/preview`, `…/claim-form/signatures`, `…/claim-form/signed-copies`, `…/claim-form/signature-upload-intent`, `…/internal-notes` | `ReimbursementJourneyPage.tsx` |
| `/reimbursements/[requestId]/edit` | แก้ไขใบเบิก | แก้ร่าง/ใบที่ถูกส่งกลับ | `reimbursement.update_own_draft` หรือ `reimbursement.finance_review` | S+ | `PATCH /reimbursements/:id` | `ReimbursementCreatePage` (โหมดแก้) |
| `/reimbursements/draft-actions/[actionId]` | ตรวจร่างใบเบิกจาก LINE | ดูตัวอย่างร่างที่ผู้ช่วย LINE เตรียม แล้วยืนยันหรือยกเลิก | สมาชิกเจ้าของ action (API ตรวจ) | S+ | `GET /reimbursements/draft-actions/:id`, `POST …/confirm`, `…/cancel` | `ReimbursementDraftActionPage.tsx` |
| `/reimbursements/payout-account` | บัญชีรับเงินคืนของฉัน | ตั้ง/แก้บัญชีประจำสำหรับรับเงินคืน, ตั้งเป็นค่าเริ่มต้น, เปิดดูเลขเต็ม | `reimbursement.create` | S+ | `GET/PUT /reimbursements/payout-accounts/me`, `…/me/saved`, `…/me/reveal`, `…/:id/make-default`, `…/:id/reveal`, `…/members/:membershipId` | `ReimbursementPayoutAccountPage.tsx` |
| `/tax/withholding` | ภาษีหัก ณ ที่จ่าย | เลือก "เดือนที่จ่าย", "ดึงรายการล่าสุด", ตรวจรายการ "ต้องแก้ก่อนยื่น"/"ควรตรวจก่อนยื่น", "ดาวน์โหลดแบบ ภ.ง.ด.3" / "ภ.ง.ด.53", "บันทึกว่ายื่นแล้ว", ยื่นเพิ่มเติม, เลือกผู้จ่าย (สำนักงานใหญ่/สาขา), ส่งออก e-WHT, ลิงก์ "ดูหนังสือรับรอง 50 ทวิ" | `wht.pnd53.read`, `wht.pnd53.prepare` | **ENT** (`wht_pnd53`) | `GET /tax/withholding/months`, `…/months/:m`, `…/months/:m/e-wht-export`, `…/:form/periods`, `…/:form/periods/:p/report|events|export|mark-filed|review-issues`, `…/:form/sync`, `…/filings/:id/confirm-rows`, `…/payer-mode`, `GET /tax/wht-categories` | `tax/WithholdingPage.tsx` |
| `/tax/pnd53` | (redirect) | ส่งต่อไป `/tax/withholding` | — | — | — | redirect |

#### 4.1.4 แพ็กเกจและอายุการใช้งาน

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์ | แพ็ก | API หลัก | Component |
|---|---|---|---|---|---|---|
| `/billing` | แพ็กเกจ | สถานะแพ็กเกจ (ใช้ได้ถึง, อ่านใบเสร็จได้อีก N ใบ), เลือกแพ็กเกจ รายเดือน/รายปี, เลือกสาขา/ผู้ใช้เมื่อเกินโควตา (`BillingCapacityPicker`), วิธีจ่าย (ตัดบัตรอัตโนมัติ / บิลพร้อมเพย์), ส่วนลดจากงาน, โปรโมชั่น, ข้อเสนอพิเศษ (ดีล), ข้อมูลออกเอกสาร/อีเมลรับเอกสาร, แท็บการต่ออายุและจ่ายเงิน, ประวัติใบเสร็จ; `?collection=<uuid>` เปิดคำขอต่ออายุ | `company.plan.manage` (API; หน้าใช้เปลือก recovery ถ้าถูกปฏิเสธ) | ทุกร้าน | `GET /billing`, `/v1/billing/catalog`, `…/billing/event-discount`, `…/history`, `…/capacity`, `POST …/quote`, `…/checkout`, `…/attempts/:id` (+`/resume`, `/cancel`, `/capacity`), `…/refresh`, `…/portal`, `…/collection/preview`, `…/collection/:id` (+`/submit`, `/withdraw`, `/capacity`), `…/recipient` (+`/preview`, `/otp/request`, `/otp/confirm`, `/:id/submit`, `/:id/cancel`), `…/documents/:id/open`, `…/documents/:id/resend` | `billing/BillingPage.tsx`, `BillingCollectionPanel`, `BillingEmailRecipientPanel`, `BillingCapacityPicker` |
| `/billing/return` | แพ็กเกจ (กลับจากหน้าจ่ายเงิน) | อ่านผลรายการจ่าย `?attempt=<uuid>` แล้วแสดงสถานะ: จ่ายแล้ว/ยังยืนยันผลไม่ได้/หน้าจ่ายเงินหมดอายุ/จ่ายอีกครั้ง | เหมือน `/billing` | ทุกร้าน | `GET …/billing/attempts/:id` | `BillingPage` (`returning`) |
| `/billing/invoices/[invoiceId]` | รายละเอียดใบเสร็จ/การปรับปรุง | ดูใบแจ้งหนี้/ใบเสร็จของแพ็กเกจและการปรับปรุงที่เกี่ยวข้อง | `company.plan.manage` | ทุกร้าน | `…/billing/…invoices/:id` | `billing/BillingAdjustmentsPage.tsx` |
| `/billing/preview` | พรีวิวขั้นตอน (local) | หน้าจำลองขั้นตอนซื้อด้วย fixture — เปิดได้เฉพาะ `NODE_ENV=development` และ `APP_ENV=local` และ role `OWNER`; มิฉะนั้น 404 | OWNER | dev เท่านั้น | ไม่มี (fixture) | `billing/BillingPreviewPage.tsx` |
| `/renew` | แพ็กเกจหมดอายุ / ยังไม่มีแพ็กเกจ | ปลายทางเมื่อ API ตอบ `company_term_expired`: บอกสถานะและนำไป `แพ็กเกจ` (ถ้ามีสิทธิ์) หรือ `ข้อมูลร้าน` | สมาชิกร้าน | ทุกร้าน | `/api/v1/plan-term/notice`, `GET …/billing` | `plan-term/CompanyTermExpiredPage.tsx` |

#### 4.1.5 พนักงาน สิทธิ์ และตั้งค่าร้าน

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์ | แพ็ก | API หลัก | Component |
|---|---|---|---|---|---|---|
| `/settings` | ตั้งค่าร้าน | hub การ์ด: ข้อมูลร้าน, บัญชีของฉัน, สาขา, พนักงานและสิทธิ์, ตั้งค่าใบรับรองแทนใบเสร็จ, e-WHT, ลายเซ็นบน 50 ทวิ (และการ์ดของโมดูลนอกขอบเขตเมื่อมีสิทธิ์); ร้านที่ถูกล็อกเหลือ ข้อมูลร้าน + บัญชีของฉัน หรือการ์ด `LOCKED_ACCOUNT_CARD` | `company.settings.view`, `company.setup.read`, `company.setup.manage` ฯลฯ (โมดูล `settings`) | ทุกร้าน | checklist: `/v1/companies/:id/identity` | `web-core-workspace/SettingsMenu.tsx`, `ProfileAttentionBadge` |
| `/settings/profile` | ข้อมูลร้าน | ชื่อร้าน, ชื่อจดทะเบียน, เลขผู้เสียภาษี 13 หลัก, ที่อยู่ร้าน (จังหวัด…), ประเภทธุรกิจ, "ร้านจดทะเบียน VAT หรือยัง", การ์ดความครบถ้วน; ส่วนบัญชีของฉัน (`#account` ถูกย้ายไป `/account`) | เปิดหน้า: `company.setup.read` หรือ `company.setup.manage`; บันทึก: `company.legal_identity.manage` (API) | ทุกร้าน | `GET/PUT /v1/companies/:id/identity`, `…/identity/business-type`, `…/vat-registration` | `company-profile/CompanyProfilePage.tsx`, `ProfileCompletenessCard` |
| `/settings/branches` | สาขา | รายการสาขา (ชื่อ, รหัสสาขา, ประเภท สำนักงานใหญ่/สาขา/ออนไลน์/คลังสินค้า, รหัสสาขาภาษี, โทรศัพท์, สถานะ), "+ เพิ่มสาขา", แก้ไข, เปิด/ปิดใช้งาน; เมื่อเต็มโควตาแสดงลิงก์ "ดูหรือเปลี่ยนแพ็กเกจ" | `company.branch.read`, `company.branch.manage` | ทุกร้าน (`company_settings.branches`) | `GET/POST /v1/companies/:id/branches`, `PATCH …/branches/:branchId` | `branch-settings/BranchSettingsPage.tsx` |
| `/settings/access-overview` | รายชื่อพนักงาน | รายชื่อ + สถานะ (ร่าง/ใช้งาน/ปิดใช้งาน), ค้นหา/กรองสาขาและบทบาท, เปลี่ยนบทบาท (1 คน 1 บทบาท), ขอบเขตสาขา, ปิด/เปิดใช้งาน, ลบร่าง, รีเซ็ตรหัสผ่าน, ออกลิงก์เชื่อม LINE (ใช้ได้ 15 นาที), ดู "สิทธิ์ของ <คน>" | `access.employee.read` | ทุกร้าน (`employee_access.overview`) | `/settings/employees`, `…/employees/:id`, `…/:id/disable`, `…/:id/credentials/regenerate`, `…/:id/line-link-token` (+`/revoke`), `…/effective-access`, `…/effective-access/:id`, `…/roles` | `employee-access/IndividualPermissionsPrototypePage.tsx` |
| `/settings/employees` | เพิ่มพนักงาน / แก้ไขพนักงาน | ฟอร์ม 3 ส่วน: ข้อมูลส่วนตัว, ช่องทางติดต่อ, บทบาทและสาขา; หลังบันทึกแสดง QR/ลิงก์เชื่อม LINE; `?edit=<id>` = แก้ไข | เปิดหน้า: `access.employee.read|create|update`; สร้างต้อง `access.employee.create`, แก้ต้อง `access.employee.update` (ไม่ผ่าน → redirect ไปรายชื่อ) | ทุกร้าน (`employee_access.employees`) | `POST /settings/employees`, `…/employees/:id/draft`, `…/:id/complete`, `PATCH …/employees/:id`, `…/address-master?postalCode=`, `…/roles` | `employee-access/AddEmployeePrototypePage.tsx` |
| `/settings/permissions` | บทบาทและสิทธิ์ | รายการบทบาท (บทบาทมาตรฐาน/บทบาทของร้าน), ตารางสิทธิ์เข้าถึงเมนู (ดู/สร้าง/แก้ไข/ลบ/อนุมัติ), เพิ่มบทบาท, แก้ไข, ปิดใช้งานบทบาท, ย้ายพนักงานไปบทบาทอื่น | `access.role.manage` | ทุกร้าน (`employee_access.roles`) | `/settings/roles`, `…/roles/:id`, `…/roles/:id/disable`, `…/roles/preview`, `…/role-templates`, `…/capability-packs`, `…/permissions`, `…/access/matrix` | `employee-access/PermissionMatrixPrototypePage.tsx` |
| `/settings/roles` | (redirect) | ส่งต่อไป `/settings/permissions` | — | — | — | redirect |
| `/settings/security` | (redirect) | หน้าความปลอดภัยบัญชีถูกปิด (เจ้าของ 2026-08-05) ส่งต่อไป `/dashboard`; ฟอร์มเปลี่ยนรหัสผ่านอยู่ที่ `/change-password` | — | — | — | redirect |
| `/settings/substitute-receipt` | ตั้งค่าใบรับรองแทนใบเสร็จ | วิธีอนุมัติ, ผู้อนุมัติล่วงหน้า, บังคับหลักฐานการจ่ายอย่างน้อย 1 ไฟล์, ใช้หลักฐานประกอบอย่างเดียวได้, คำแนะนำให้พนักงาน | `company.setup.manage` | S+ | `GET/PUT /expense-settings/substitute-receipt` | `expenses/SubstituteReceiptSettingsPage.tsx` |
| `/settings/e-wht` | ตั้งค่า e-Withholding Tax | เปิด/ปิดการจ่ายแบบ e-WHT ของร้าน (ข้อความจาก `E_WHT_WORDS`); โหมด free ถูก redirect ไป `/expenses` | `company.setup.manage` | S+ | `GET/PUT /expense-settings/e-wht` | `expenses/EWhtSettingsPage.tsx` |
| `/settings/tax-signature` | ลายเซ็นบน 50 ทวิ | อัปโหลดลายเซ็นที่พิมพ์บนหนังสือรับรอง 50 ทวิ; ร้านที่ไม่มี `wht_50bis` ถูก redirect ไป `/expenses/wht-certificates` | `company.tax_signature.manage` (OWNER เท่านั้นโดยเจตนา) | **ENT** | `GET/PUT /tax/profile/signature`, `GET /tax/profile` | `tax/TaxSignatureSettingsPage.tsx` |

รวม 52 หน้า: 4.1.1 = 12, 4.1.2 = 14, 4.1.3 = 10, 4.1.4 = 5, 4.1.5 = 11

### 4.2 พื้นที่ร้าน — หน้าที่มีโค้ดแต่อยู่นอกขอบเขตแพ็ก (51 หน้า)

ทุกหน้าในตารางนี้ผูกกับ entitlement ที่ไม่อยู่ใน `TIER_FEATURE_PRESETS` (ดู 3.2) จึงระบุเพียงบรรทัดเดียวต่อหน้า

| Route | ชื่อ / ฟีเจอร์ | สิทธิ์ที่หน้าตรวจ | Component |
|---|---|---|---|
| `/accounting` | บัญชี (เอกสารขาย; status planned) | `accounting.*.read` | `accounting-documents/AccountingPages` |
| `/sales-documents` | เอกสารขายและรับชำระ (planned) | `accounting.*.read` | `AccountingHubPage` |
| `/sales-documents/record-income` | บันทึกรายรับ | `accounting.document.create`, `accounting.invoice.create` | `RecordIncomePage` |
| `/sales-documents/revenue-categories` | หมวดรายรับ | `accounting.revenue_category.manage` | `RevenueCategoryPanel` |
| `/sales` | การขาย (planned) | — | `PlannedModulePage` ("การขาย") |
| `/income-expense-ledger` | สมุดรายรับ-รายจ่าย | `accounting.document.read`, `expense.read` (ไม่มีเมนูในแถบข้าง; ดูหัวข้อ 13) | `IncomeExpenseLedgerPage` |
| `/accounts-payable` | เจ้าหนี้การค้า | `procurement.vendor_bill.read` ฯลฯ | `accounts-payable/AccountsPayablePages` |
| `/procurement` | จัดซื้อ | `procurement.*.read` | `procurement/ProcurementPages` |
| `/banking` | บัญชีธนาคารและกระทบยอด | `bank.*.read` | `banking/BankingPages` |
| `/journal` | สมุดรายวัน (ซ่อนด้วย `ACCOUNTING_UI_HIDDEN`) | `ledger.journal.read` | `ledger/LedgerReportsPage` |
| `/period-closing` | ปิดงวด (planned, ซ่อน) | `ledger.period.read` | `PlannedModulePage` ("ปิดงวด") |
| `/reports` | รายงานการเงิน | `report.catalog.read`, `report.snapshot.read` | `reports/ReportsWorkspacePage` |
| `/tax` | ภาษี (VAT/WHT/CIT workspace) | `tax.period.read` | `tax/TaxWorkspacePage` |
| `/tax/evidence` | หลักฐานภาษีซื้อขาย | `tax.config.read` | `TradeTaxEvidencePage` |
| `/tax/reconciliation` | กระทบยอดภาษี | `tax.report.read` | `TaxReconciliationPage` |
| `/inbox` | กล่องข้อความ | `crm.inbox.read` | `crm-inbox/InboxPrototypePage` |
| `/customers` | ลูกค้า | `crm.customer.read` | `crm/CustomersPrototypePage` |
| `/bookings` | การจองออนไลน์ | `crm.booking.read` | `crm/BookingsPrototypePage` |
| `/crm-reports` | รายงาน CRM (planned) | `crm.report.read` | `crm/CrmReportsPrototypePage` |
| `/crm` | ลูกค้า (CRM) | `crm.*.read` | `crm/CrmPages` |
| `/crm/customers/[customerId]` | ลูกค้า 360 | `crm.customer.read` | `Customer360Page` |
| `/crm/payment-proofs` | ตรวจหลักฐานการชำระของลูกค้า | (API) | `crm-inbox/PaymentProofReviewPage` |
| `/inventory` | คลังสินค้า (hub ลิงก์ 7 หน้า) | กฎ `/inventory` | inline ใน `page.tsx` |
| `/inventory/products` | สินค้า | `inventory.product.read` | `inventory/InventoryPages` (`ProductsPageClient`) |
| `/inventory/products/new` | เพิ่มสินค้า | `inventory.product.manage` | `ProductCreatePageClient` |
| `/inventory/products/[productId]` | รายละเอียดสินค้า | `inventory.product.read` | `ProductDetailPageClient` |
| `/inventory/locations` | สถานที่จัดเก็บ | `inventory.location.read` | `LocationsPageClient` |
| `/inventory/movements` | ความเคลื่อนไหว | `inventory.movement.read` | `MovementsPageClient` |
| `/inventory/movements/new` | บันทึกสต็อก | `inventory.movement.create`, `inventory.stock_count.create`, `inventory.movement.adjust` | `MovementFormPageClient` |
| `/inventory/stock-count` | ตรวจนับ | `inventory.stock_count.create` | `MovementFormPageClient` (COUNT) |
| `/inventory/reports/stock` | รายงานสต็อก | `inventory.report.read` | `StockReportPageClient` |
| `/inventory/scan` | สแกน QR | `inventory.product.read` | `ScanPageClient` |
| `/workflow` | เวิร์กโฟลว์ | `workflow.*` | `workflow/WorkflowPages` |
| `/settings/accounting-tax-setup` | ตั้งค่าบัญชีและภาษี (overview) | `ledger.account.*`, `tax.profile.*`, `tax.config.*` | `accounting-tax-setup/AccountingTaxSetupRoute` step `overview` |
| `/settings/accounting-tax-setup/prerequisites` | — ขั้น prerequisites | เหมือนบน | step `prerequisites` |
| `/settings/accounting-tax-setup/chart` | — ขั้นผังบัญชี | เหมือนบน | step `chart` |
| `/settings/accounting-tax-setup/chart/review` | — ตรวจผังบัญชี | เหมือนบน | step `chart-review` |
| `/settings/accounting-tax-setup/profile` | — ขั้น Tax Profile | เหมือนบน | step `profile` |
| `/settings/accounting-tax-setup/mappings` | — ขั้นผูกบัญชี | เหมือนบน | step `mappings` |
| `/settings/accounting-tax-setup/review` | — ขั้นตรวจและเปิดใช้ | เหมือนบน | step `review` |
| `/settings/chart-of-accounts` | ผังบัญชี Master Data | `ledger.account.read|manage` | `ledger/ChartOfAccountsSettingsPage` |
| `/settings/tax-codes` | Tax Code และ Tax Profile | `tax.profile.*`, `tax.config.*` | `tax/TaxCodeSettingsPage` |
| `/settings/tax-accounts` | Tax Account Determination | `tax.config.*`, `ledger.posting-rule.*` | `tax/TaxAccountSettingsPage` |
| `/settings/crm-catalog` | สินค้าและบริการสำหรับ CRM | `inventory.product.read` | `ProductsPageClient` (`basePath` crm-catalog) |
| `/settings/crm-catalog/new` | เพิ่มสินค้า/บริการ | `inventory.product.manage` | `ProductCreatePageClient` |
| `/settings/crm-catalog/[productId]` | รายละเอียดสินค้า/บริการ | `inventory.product.read` | `ProductDetailPageClient` (`catalogMode`) |
| `/settings/line-oa` | เชื่อมต่อ LINE OA (ของร้านเอง สำหรับ CRM Inbox) | `crm.channel.manage` | `crm-inbox/LineOaSettingsPage` |
| `/settings/discount-policy` | นโยบายส่วนลด (planned) | `crm.customer.update` | `employee-access/DiscountPolicyPage` |
| `/settings/po-approval` | อนุมัติคำสั่งซื้อ (planned) | `procurement.purchase_order.manage` | `employee-access/PoApprovalSettingsPage` |
| `/user-guide/tax` | คู่มือ: ภาษี (ซ่อนจากเมนู) | ไม่ต้องมี | `tax-guide.content.ts` |
| `/user-guide/reports` | คู่มือ: รายงานการเงิน (ซ่อนจากเมนู) | ไม่ต้องมี | `reports-guide.content.ts` |

### 4.3 หน้า auth และหน้าสาธารณะ (22 หน้า)

Route ในหัวข้อนี้เป็น path เต็ม ไม่มี entitlement (ทุกคน/ทุกร้าน)

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | ใครเปิดได้ | API / BFF | Component |
|---|---|---|---|---|---|
| `/` | หน้าแรกสาธารณะ มั่งมีพลัส | หน้า marketing: เรื่องราวส่งใบเสร็จ, ขั้นตอนสมัคร, ฟีเจอร์, แพ็กเกจและราคา, FAQ (`home-faq.json`), ธีมเทศกาล; JSON-LD; index ได้เฉพาะ production | สาธารณะ | `/api/public/billing/catalog`, ธีม: `home-theme.server.ts` | `public-home/PublicHome.tsx`, `HomeEventTheme`, `HomeReceiptStory`, `HomeSignupSteps` |
| `/halloween/[[...card]]` | หน้ากิจกรรม Halloween | หน้ากิจกรรมตามธีม (การ์ดผี, เกม, แชร์); 404 เมื่อธีม ≠ `halloween` หรือการ์ดไม่ถูกต้อง | สาธารณะ (ตามธีมที่เปิด) | `/api/public/halloween/draw` | `public-home/HalloweenEventPage.tsx` และ `Halloween*` |
| `/login` | เข้าสู่ระบบ | ชื่อผู้ใช้/อีเมล + รหัสผ่าน, "จดจำการเข้าสู่ระบบ", "ลืมรหัสผ่าน?", "ใช้รหัสยืนยันทางอีเมลแทนรหัสผ่าน", เข้าสู่ระบบด้วย LINE, QR "สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์" (บนจอคอม), ลิงก์เอกสารกฎหมาย; ผู้ที่ล็อกอินอยู่จริงถูกส่งไป landing (`resolveLoginLanding`); ปิดบริการ → แจ้งสถานะ | สาธารณะ | `POST /api/auth/login`, `/api/auth/refresh`, `/api/auth/line-login/availability|start`, `/api/auth/line-qr/start|status`, server: `GET /v1/auth/platform-access`, `GET /v1/auth/me` | `auth/LoginPage.tsx`, `AuthFrame` |
| `/forgot-password` | ลืมรหัสผ่าน | ขอรีเซ็ตรหัสผ่าน | สาธารณะ | `/api/v1/auth/password/reset-request`, `…/email-reset-request` | `auth/ForgotPasswordPage.tsx` |
| `/reset-password` | ตั้งรหัสผ่านใหม่ | ตั้งรหัสใหม่จากลิงก์อีเมล (header `no-store`, `noindex`, `no-referrer`) | ผู้ถือลิงก์ | `/api/v1/auth/password/email-reset-confirm` | `auth/ResetPasswordPage.tsx` |
| `/change-password` | เปลี่ยนรหัสผ่าน | เปลี่ยนเอง หรือบังคับเปลี่ยนเมื่อใช้รหัสชั่วคราว (ออกได้เฉพาะปุ่มออกจากระบบจนกว่าจะเปลี่ยน) | ผู้ล็อกอิน | `POST /api/auth/change-password` | `auth/ChangePasswordPage.tsx` |
| `/email-access` | เข้าด้วยรหัสยืนยันทางอีเมล | กรอกอีเมล → รหัสยืนยัน 6 หลัก → เข้าสู่ระบบ หรือสมัครร้านใหม่ (ชื่อร้าน, ชื่อผู้ติดต่อ, เบอร์มือถือ, ยอมรับข้อกำหนด) | สาธารณะ | `/api/auth/email-access/request|confirm|signup|status` | `auth/EmailAccessPage.tsx` |
| `/verify-email` | ยืนยันอีเมล | ยืนยันอีเมลบัญชีจากลิงก์ | ผู้ถือลิงก์ | `/api/v1/auth/account/email/verify` | `auth/VerifyEmailPage.tsx` |
| `/account/email` | อีเมลบัญชี | ตั้ง/ยืนยันอีเมลบัญชีด้วยรหัสยืนยัน เปิดได้แม้ร้านหมดอายุ; กลับไป billing เมื่อมี `company.plan.manage` (`?company=&interval=&channel=line`) | ผู้ล็อกอิน | `/v1/auth/account/email`, `…/email/otp`, `…/email/resend` | `auth/AccountEmailOtpPanel.tsx`, `billing/BillingCustomerFrame` |
| `/legal-acceptance` | ยืนยันเอกสารการใช้บริการ | อ่านและยอมรับข้อกำหนดการใช้งาน ประกาศความเป็นส่วนตัว และอำนาจการใช้งาน ก่อนใช้งานครั้งแรก/เมื่อมี release ใหม่ แล้วกลับไปหน้าที่ตั้งใจเปิด (`next`) | ผู้ล็อกอิน | `/v1/auth/legal-acceptance` | `auth/LegalAcceptancePage.tsx` |
| `/signup` | สมัครใช้งานมั่งมีพลัส | ฟอร์มสมัครร้าน: ชื่อร้าน, ชื่อ, นามสกุล, อีเมล, เบอร์มือถือ, การจดทะเบียน VAT, เลขผู้เสียภาษี, รู้จักเราทางไหน, รหัสเซลล์, ยอมรับข้อกำหนด; ทางเลือก "สมัครด้วยรหัสยืนยันทางอีเมล"; ตรวจว่าเปิดรับสมัครอยู่ก่อนแสดงฟอร์ม | สาธารณะ | `/api/v1/public/company-signups/availability`, `POST /api/v1/public/company-signups` | `external-signup/SignupPage.tsx`, `SignupChrome` |
| `/signup/status/[requestId]` | สถานะคำขอสมัคร | ดูสถานะคำขอ, ขอส่งลิงก์รับบัญชีใหม่ | ผู้ถือลิงก์ | `GET /api/v1/public/company-signups/:id`, `POST …/:id/resend-claim` | `external-signup/SignupStatusPage.tsx` |
| `/claim-account` | ตั้งรหัสผ่าน / รับบัญชี | เปิดจากลิงก์ในอีเมล: ตั้งชื่อผู้ใช้+รหัสผ่าน หรือ "เข้าสู่ระบบด้วยบัญชีเดิม" เพื่อผูกร้านใหม่กับบัญชีที่มีอยู่; ลิงก์ใช้ไม่ได้ → ทางไปหน้าสถานะ | ผู้ถือลิงก์ | `/api/v1/public/signup-claims/info`, `POST /api/auth/signup-claim` | `external-signup/ClaimAccountPage.tsx` |
| `/signup/welcome` | ขั้นตอนสุดท้าย เชื่อมกับ LINE | หลังตั้งรหัสผ่าน: เชื่อมบัญชี LINE (QR เมื่อใช้คอมพิวเตอร์), กรณี LINE ผูกกับบัญชีอื่นอยู่ → dialog รวมบัญชี; ลิงก์ไปแพ็กเกจ/เข้าใช้งานตามสถานะแพ็ก | ผู้ล็อกอิน | `/api/auth/line-login/start`, `/api/auth/account-merge`, `/api/auth/account-merge/ticket`, plan-term notice | `external-signup/SignupWelcomePage.tsx` |
| `/billing/companies` | เลือกร้านเพื่อซื้อแพ็กเกจ | ผู้ที่มาจากลิงก์ข้อเสนอ (`?offer=&interval=&channel=line&fromCompany=`) เลือกร้านที่จะซื้อ | ผู้ล็อกอิน | `GET /v1/auth/me/companies` | `billing/BillingCompanyPicker.tsx` |
| `/maintenance` | ระบบกำลังปรับปรุง | แสดงเมื่อแพลตฟอร์มปิดบริการ (`platform_access_closed`) | สาธารณะ | — | inline |
| `/unsupported-browser` | เปิดบนเครื่องนี้ไม่ได้ | แจ้งเบราว์เซอร์/LINE เก่าเกินไป สองภาษา ปุ่ม "ลองอีกครั้ง" และ "ติดต่อทีมงานมั่งมี" | สาธารณะ (`noindex`) | — | `common/client-support/GenericClientNotice.tsx` |
| `/privacy` | ประกาศความเป็นส่วนตัว | เอกสารกฎหมาย | สาธารณะ | — | `common/legal/LegalPage`, `legal-content.ts` |
| `/terms` | ข้อกำหนดการใช้งาน | เอกสารกฎหมาย | สาธารณะ | — | เหมือนบน |
| `/data-deletion` | การลบข้อมูล | วิธีขอลบข้อมูล | สาธารณะ | — | เหมือนบน |
| `/line-qr/[code]` | ยืนยันการเข้าสู่ระบบบนคอมพิวเตอร์ | ดูหัวข้อ 4.4 | ผู้ล็อกอิน | `POST /api/auth/line-qr/approve` | `auth/LineQrApprovePage.tsx` |
| `/d/expired` | ลิงก์เดโม่หมดอายุ | ดูหัวข้อ 4.4 | สาธารณะ | — | inline + `sales-demo/DemoRetryButton` |

### 4.4 หน้าและ route ที่เกี่ยวกับ LINE / LIFF

`apps/web` **ไม่มีหน้า LIFF** (ไม่มี LIFF SDK และไม่มี route `/liff`) สิ่งที่เชื่อมกับ LINE ในเว็บมีดังนี้

| Route | ชนิด | หน้าที่ | หลักฐาน |
|---|---|---|---|
| `/l/[token]` | route handler (ไม่นับใน 207) | ลิงก์จากข้อความ LINE: แลก token ใช้ครั้งเดียว (`^[A-Za-z0-9_-]{20,128}$`) เป็น session แล้ว 303 ไปหน้าเป้าหมาย; HEAD ตอบ 204; ล้มเหลวชั่วคราวตอบ HTML 503 "เปิดลิงก์ไม่สำเร็จชั่วคราว" พร้อมปุ่ม "ลองอีกครั้ง"; ไม่ผ่านด่านเบราว์เซอร์เก่า (ไม่ให้ token ติดใน URL ของหน้าแจ้ง) | `app/l/[token]/route.ts`, `client-support.logic.ts` |
| `/d/[token]` | route handler | เปิดร้านเดโม่จากลิงก์เซลล์ (`POST /v1/auth/demo/open`): 410 → `/d/expired`, ล้มเหลว → `/d/expired?reason=unavailable`; HEAD ตอบ 204 | `app/d/[token]/route.ts` |
| `/d/expired` | หน้า | "ลิงก์เดโม่นี้หมดอายุแล้วค่ะ" หรือ "ตอนนี้เปิดเดโม่ไม่ได้ชั่วคราวค่ะ…" ปุ่ม `เปิดร้านจริงฟรี`, `คุยกับทีมดูแล`, ลองอีกครั้ง (หน้านี้ใช้เสียงของ LINE มีหางเสียง) | `app/d/expired/page.tsx` |
| `/line-qr/[code]` | หน้า | หน้าที่มือถือเปิดเมื่อสแกน QR บนจอคอม: ยืนยัน/ไม่ยืนยันให้คอมพิวเตอร์เข้าสู่ระบบ; ถ้ายังไม่ล็อกอิน → `/login?line=qr-approve&next=…`; สถานะ: ยืนยันแล้ว, ไม่ได้ยืนยัน, QR หมดอายุแล้ว, ยืนยันไม่สำเร็จ | `app/line-qr/[code]/page.tsx`, `auth/LineQrApprovePage.tsx` |
| `/api/auth/line-login/{availability,start,callback}` | BFF | LINE Login (OAuth) สำหรับเข้าสู่ระบบและเชื่อมบัญชี; ใน LINE in-app browser เติม `openExternalBrowser=1` | `app/api/auth/line-login/*`, `features/auth/line-login-bff.logic.ts` |
| `/api/auth/line-qr/{start,status,approve}` | BFF | เข้าสู่ระบบบนคอมด้วย QR | `app/api/auth/line-qr/*` |
| เมนูผู้ใช้ "เชื่อมบัญชี LINE" และ QR ในหน้าเพิ่มพนักงาน | ส่วนของหน้า | เชื่อม LINE ของสมาชิกกับบัญชี (ลิงก์/QR ใช้ได้ 15 นาที) | `AppSidebar`/`AppHeader`, `AddEmployeePrototypePage`, `IndividualPermissionsPrototypePage` |
| แชต LINE จำลองในร้านเดโม่ | ส่วนของหน้า | pop-up แชต AI ในร้านเดโม่ (`POST /v1/companies/:id/demo-chat`) | `features/sales-demo/*` |

หน้าปลายทางของ deep link จาก LINE คือหน้าปกติของร้าน เช่น `/reimbursements/[requestId]`, `/reimbursements/draft-actions/[actionId]`, `/expenses/[expenseId]`, `/expenses/signatures`, `/billing` layout ของร้านรักษาปลายทางเดิมผ่านด่านเปลี่ยนรหัสผ่าน/ยอมรับเอกสาร (`companyGateReturnPath`)

### 4.5 คอนโซลทีมขาย `/sales` (12 หน้า)

เข้าได้เมื่อมี `sales.console.read` (role ฝั่งแพลตฟอร์ม `MANGMEE_SALES*` และ SYSTEM_ADMIN); ไม่ผูกแพ็กของร้าน

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์เพิ่ม | API (`/v1/…`) | Component |
|---|---|---|---|---|---|
| `/sales` | (redirect) | ไป `/sales/deals` | — | — | redirect |
| `/sales/deals` | ดีล | รายการดีล/ข้อเสนอพิเศษของเซลล์ | — | `sales/deals` | `sales-console/SalesDealsPage.tsx` |
| `/sales/deals/new` | ดีลใหม่ | ร่างดีลให้ร้าน (`?companyId=`): แพ็ก, ราคา, ฟีเจอร์ที่ขายได้ (`SALES_DEAL_ALLOWED_FEATURE_KEYS`), เครดิต AI | อนุมัติ/ปฏิเสธ: `sales.deal.approve` | `sales/deals`, `sales/companies` | `SalesDealFormPage.tsx` |
| `/sales/deals/[id]` | ดีล | ดู/แก้/ส่งอนุมัติ/อนุมัติ/ปฏิเสธดีล | `sales.deal.approve` | `sales/deals/:id`, `sales/deals/:id/:action` | `SalesDealFormPage.tsx` |
| `/sales/demo-links` | ลิงก์เดโม่ | สร้าง/แก้ไข/รีเซ็ตลิงก์ร้านเดโม่ 3 วัน | — | `sales/demo-links`, `…/:id`, `…/:id/reset` | `SalesDemoLinksPage.tsx` |
| `/sales/companies` | ร้านค้า | ร้านที่เซลล์ดูแล | — | `sales/companies` | `SalesCompaniesPage.tsx` |
| `/sales/events` | ส่วนลดจากงาน | ชุดส่วนลดจากงานอีเวนต์: เซลล์แสดง QR, หัวหน้าทีมสร้างชุด | สร้าง: `sales.event.manage` | `sales/events/batches`, `sales/events/agents`, `sales/events/report` | `SalesEventsPage.tsx` |
| `/sales/events/[batchId]` | ส่วนลดจากงาน (ชุด) | QR ของชุด, รายการสิทธิ์, เพิกถอนส่วนลด, เปิด/ปิดชุด | `sales.event.manage` | `sales/events/batches/:id`, `…/qr`, `…/state`, `…/tickets`, `sales/events/tickets/:id/revoke` | `SalesEventBatchPage.tsx` |
| `/sales/my-work` | งานของฉัน | ดีลที่ถูกปฏิเสธ/หมดอายุ/รออนุมัติ (badge ที่เมนู) | — | `sales/my-work` | `SalesMyWorkPage.tsx` |
| `/sales/reports` | รายงาน | สรุปผลงานขาย | `sales.report.read` (ไม่มี → redirect) | `sales/reports/summary` | `SalesReportsPage.tsx` |
| `/sales/team` | ทีม | จัดการบัญชีเซลล์ในทีม (หัวหน้าทีม) | `sales.team.manage` (ไม่มี → redirect) | `sales/team`, `…/:id/profile`, `…/:id/credential` | `SalesTeamPage.tsx` (`scope="lead"`) |
| `/sales/profile` | ข้อมูลของฉัน | ข้อมูลเซลล์ของตนเอง | — | `sales/me/profile` | `SalesMyProfilePage.tsx` |

### 4.6 คอนโซลผู้ดูแลแพลตฟอร์ม `/system` (70 หน้า)

ด่านรวม (`app/system/layout.tsx`): role `SYSTEM_ADMIN` เข้าได้ทุกส่วน; ผู้มี `system.billing.read` เข้าได้เฉพาะใต้ `/system/billing`; ผู้มี `system.executive.read` เข้าได้เฉพาะใต้ `/system/executive` API ตรวจสิทธิ์ละเอียดต่อคำสั่ง (เช่น `system.billing.financial.read`, `system.billing.override.manage`; `apps/api/src/modules/billing/presentation/billing.controller.ts`) คอนโซลนี้ไม่อยู่ใต้ `thai-ux-standard.md`

#### 4.6.1 ลูกค้า คำขอ และตั้งค่าระบบ (28 หน้า)

| Route | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | สิทธิ์เพิ่ม | API (`/v1/system/…`) | Component |
|---|---|---|---|---|---|
| `/system/partners` | บริษัทและผู้ใช้งาน | ค้นหา/กรองร้านทั้งหมด, ค้นหาผู้ใช้ (`UserLookupSection`), ไปหน้าเปิดร้านใหม่ | SYSTEM_ADMIN | `partners`, `users/lookup` | `system-partners/PartnerListPage.tsx` |
| `/system/partners/[companyId]` | รายละเอียดร้าน | สถานะร้าน (ใช้งานอยู่/ปิดใช้งาน/เก็บถาวร/ระงับชั่วคราว), แพ็กเกจและอายุ (ตั้ง/ต่ออายุ/ประวัติ), เปิด-ปิดฟีเจอร์ (ตาม `FEATURE_CATALOG` + `FEATURE_DEPENDENCIES`), สมาชิก (ชื่อที่แสดง, ติดต่อ, รีเซ็ต/เปิดดูรหัสผ่าน, ลิงก์เชื่อม LINE, ยกเลิกเชื่อม LINE), ข้อมูลนิติบุคคล, สถานะ VAT, เครดิต AI/โมเดล AI/การใช้ AI/credit holds, OCR config, เปิดเมนู "บันทึกด้วยมือบนเว็บ" และ "ใบเตรียมจ่าย", ส่งข้อความ LINE ถึงร้าน/ผู้ขอความช่วยเหลือ (`?support=&asker=`), โน้ตทีม, timeline, เซลล์ผู้แนะนำ | `system.partner_member.manage`, `system.partner_company.update`, `system.identity_reconciliation.resolve` | `partners/:id`, `…/features`, `…/lifecycle`, `…/plan-term` (+`/renew`, `/end-warmup`, `/history`), `…/members` (+`/:mid/contact`, `/display-name`, `/line-link-token`, `/line-unlink`, `/password/reset`, `/password/reveal`), `…/identity`, `…/vat-registration`, `…/ai-model`, `…/ai-usage`, `…/ai-adjustments`, `…/ai-credit-holds`, `…/ocr-config`, `…/manual-expense-web-entry`, `…/disbursement-voucher-web-entry`, `…/line-message`, `…/team-note`, `…/timeline`, `…/referral` | `system-partners/PartnerDetailPage.tsx`, `PartnerTeamNote`, `PartnerPlanAdjustmentHistory`, `PartnerAiAdjustmentHistory`, `PartnerReportLabels` |
| `/system/users` | (redirect) | รวมเข้าหน้า partners แล้ว → `/system/partners` | — | — | redirect |
| `/system/company-onboardings/new` | เปิดร้านใหม่ (New Company Onboarding) | ผู้ดูแลสร้างร้านและเจ้าของร้านเอง | SYSTEM_ADMIN | `company-onboardings`, `company-onboardings/:id/:action`, `partners/address-master` | `system-onboarding/SystemOnboardingNewPage.tsx` |
| `/system/support-requests` | คำขอคุยกับเจ้าหน้าที่ | กล่องคำขอความช่วยเหลือจาก LINE: อ่านเธรด, ตอบ, ทำเครื่องหมาย "ตอบแล้ว", "ให้ AI ทำงานต่อ", เปิดหน้าร้าน/รายการจ่ายที่เกี่ยวข้อง | SYSTEM_ADMIN | `support-requests`, `…/count`, `…/:id/thread`, `…/:id/reply`, `…/:id/answered`, `…/:id/messages/:mid/content` | `system-support-requests/SupportRequestsPage.tsx`, `SupportThreadModal` |
| `/system/signup-requests` | คำขอสมัครใช้งาน | คิวคำขอสมัคร: อนุมัติ/ปฏิเสธ, ออกลิงก์รับบัญชีใหม่, รายการที่อนุมัติอัตโนมัติ, คำขอเปลี่ยนแพ็กเกจจาก LINE | SYSTEM_ADMIN | `signup-requests`, `…/:id/decision`, `…/:id/reissue-claim`, `…/auto-approved`, `package-change-requests`, `…/:id/decision` | `system-signup-requests/SignupQueuePage.tsx` |
| `/system/signup-requests/[id]/mail` | ประวัติอีเมลรับบัญชี | ประวัติการส่งอีเมล claim ของคำขอ | SYSTEM_ADMIN | `signup-requests/:id/claim-deliveries` | `SignupClaimHistoryPage.tsx` |
| `/system/data-rights` | คำขอสิทธิข้อมูลและการปิดพื้นที่ทำงาน | รายการเคส PDPA | SYSTEM_ADMIN | `data-rights/cases` | `system-data-rights/DataRightsListPage.tsx` |
| `/system/data-rights/new` | เปิดเคสใหม่ | สร้างเคส (รองรับ seed จากเคสเดิม: `priorCaseReference`, `caseType`, `targetUserId`, `companyId`, `membershipId`) | SYSTEM_ADMIN | `POST data-rights/cases` | `DataRightsNewPage.tsx` |
| `/system/data-rights/[caseId]` | รายละเอียดเคส | ขั้นตอนของเคส, สรุปผลและปิดเคส | SYSTEM_ADMIN | `data-rights/cases/:id`, `…/:id/:action` | `DataRightsDetailPage.tsx` |
| `/system/email-delivery` | สถานะอีเมล | สถานะการเชื่อมต่อ/การส่งอีเมล และนโยบายเก็บประวัติ | SYSTEM_ADMIN (+`emailAllowed`) | `email-delivery`, `…/connection`, `…/retention` | `system-email-delivery/SystemEmailDeliveryPage.tsx`, `EmailHistoryPolicyPanel` |
| `/system/executive-users` | บัญชีผู้บริหาร | รายการบัญชีผู้บริหาร (ผู้อ่านรายงาน) | `system.executive_user.manage` | `executive-users` | `executive-users/ExecutiveUsersPage.tsx` |
| `/system/executive-users/new` | เพิ่มบัญชีผู้บริหาร | สร้างบัญชี | เหมือนบน | `executive-users` | `ExecutiveUserPage.tsx` |
| `/system/executive-users/[userId]` | บัญชีผู้บริหาร | แก้ไข/ปิดบัญชี | เหมือนบน | `executive-users/:id` | `ExecutiveUserPage.tsx` |
| `/system/executive` | รายงานผู้บริหาร — ภาพรวม | ภาพรวมธุรกิจของแพลตฟอร์ม, ตัวกรองช่วงเวลา, ส่งออก Excel | `system.executive.read` | `executive/context`, `executive/:section`, `executive/analysis`, `executive/exports` | `executive-reports/ExecutiveReportPage.tsx` (`overview`) |
| `/system/executive/revenue` | — รายได้ | รายงานรายได้ | เหมือนบน | `executive/revenue` | section `revenue` |
| `/system/executive/customers` | — ลูกค้า | รายงานลูกค้า | เหมือนบน | `executive/customers` | section `customers` |
| `/system/executive/usage` | — การใช้งาน | รายงานการใช้งาน | เหมือนบน | `executive/usage` | section `usage` |
| `/system/executive/companies` | — รายชื่อร้าน | รายชื่อร้านจากกราฟ | เหมือนบน | `executive/companies` | section `companies` |
| `/system/executive/companies/[targetCompanyId]` | — รายละเอียดร้าน | รายละเอียดและประวัติของร้าน, โน้ต | เหมือนบน | `executive/companies/:id`, `…/:id/history` | section `detail` |
| `/system/executive/compare` | (redirect) | หน้าเปรียบเทียบถูกถอด (เจ้าของ 2026-10-05) → `/system/executive` | — | — | redirect |
| `/system/wht-income-categories` | ประเภทเงินได้หัก ณ ที่จ่าย | แค็ตตาล็อกกลาง: ประเภทเงินได้, แบบยื่นภาษี (ภ.ง.ด.3/ภ.ง.ด.53), อัตราเริ่มต้น, เปิด–ปิดใช้ | `system.wht_income_category.manage` | `wht-income-categories` | `system-wht-income-categories/WhtIncomeCategoriesPage.tsx` |
| `/system/sales-team` | ทีมขายมั่งมี | จัดการบัญชีทีมขายทั้งหมด (PII scope admin), ส่งออก CSV, ทบทวน attribution | SYSTEM_ADMIN | `sales-agents`, `…/:id`, `…/:id/profile`, `…/:id/credential`, `sales-agents/export.csv`, `sales-agents/address-master`, `sales-attribution/flags`, `sales-attribution/:id/review` | `sales-console/SalesTeamPage.tsx` (`scope="admin"`) |
| `/system/demo-links` | ลิงก์เดโม่ | จัดการลิงก์เดโม่จากฝั่งผู้ดูแล (เจ้าของ 2026-11-09) | SYSTEM_ADMIN | `/v1/sales/demo-links…` | `sales-console/SalesDemoLinksPage.tsx` |
| `/system/home-theme` | ธีมหน้าแรก | เลือกธีมเทศกาลของหน้าแรกสาธารณะ | SYSTEM_ADMIN **และ** `system.home_theme.manage` | `home-theme` | `system-home-theme/HomeThemeSettingsPage.tsx` |
| `/system/line-settings` | ตั้งค่า LINE | credential กลางของ LINE Messaging API ที่ใช้ร่วม (ไม่แสดงค่าลับ) | SYSTEM_ADMIN | `line/shared-credentials`, `…/LINE_MESSAGING_API` | `system-partners/SharedLineSettingsPage.tsx` |
| `/system/ai-budget` | เพดานความปลอดภัยค่า AI กลาง | ตั้งเพดานค่าใช้จ่าย AI ระดับแพลตฟอร์ม | SYSTEM_ADMIN | `ai-budget` | `system-partners/PlatformAiBudgetPage.tsx` |
| `/system/platform-access` | เปิด–ปิดระบบ | เปิด/ปิดบริการทั้งแพลตฟอร์ม (สถานะ `OPEN`/`CLOSED`; ปิดแล้วผู้ใช้เห็น `/maintenance`) | SYSTEM_ADMIN | `platform-access` | `system-partners/PlatformAccessPage.tsx` |

#### 4.6.2 การชำระเงิน `/system/billing` (42 หน้า)

API ทั้งหมดอยู่ใต้ `/v1/system/billing/…` Component อยู่ใน `apps/web/src/features/billing-admin/` (เว้นแต่ระบุ)

| Route (ต่อจาก `/system/billing`) | ชื่อหน้าจอ | จุดประสงค์ / การกระทำหลัก | Component |
|---|---|---|---|
| `` (ราก) | การชำระเงิน | หน้าแรก: ค้นหาบริษัท, ภาพรวม (`overview`), ทางไป ดูแลลูกค้า / ตรวจยอดรับเงิน / ตรวจสอบกับ Stripe / แคมเปญโปรโมชั่น / รายการระดับระบบ | `BillingAdminPage`, `BillingCompanyDirectory` |
| `/issues` | รายการปัญหา | คิวปัญหา (รอรับงาน/เกินกำหนดติดตาม), ตัวกรอง, แบ่งหน้าแบบ cursor | `BillingAdminPage` (`issuesOnly`), `BillingIssueDirectory` |
| `/issues/[id]` | รายละเอียดเคส | รับเรื่อง/คืนเรื่อง, บันทึกสถานะ, วิธีแก้ (`BillingIssueResolutionPanel`) | `BillingAdminPage` |
| `/companies/[id]` | บริษัท (การชำระเงิน) | ภาพรวม / รายการชำระเงิน / ประวัติ (timeline + export), แพ็กเกจปัจจุบัน, สถานะชำระเงิน, วิธีต่ออายุ | `BillingAdminPage`, `BillingCompanyOverview`, `BillingTimelinePanel` |
| `/companies/[id]/checkouts` | ตรวจหน้าชำระและรายการค้าง | รายการ checkout attempt ของร้าน | `BillingCheckoutPage` |
| `/companies/[id]/checkouts/[attemptId]` | รายการชำระหนึ่งรายการ | รายละเอียด/ตรวจผลกับผู้ให้บริการ | `BillingCheckoutPage` |
| `/checkout-expiry/[id]` | คำสั่งหมดอายุหน้าชำระ | ผลของคำสั่งทำให้หน้าชำระหมดอายุ | `BillingCheckoutPage` |
| `/companies/[id]/invoices/[invoiceId]` | ใบแจ้งหนี้/ใบเสร็จของร้าน | รายละเอียดเอกสารและการปรับปรุง | `billing/BillingAdjustmentsPage` |
| `/companies/[id]/invoices/[invoiceId]/recipient` | เปลี่ยนอีเมลผู้รับเอกสาร | ขอเปลี่ยนผู้รับเอกสารของใบแจ้งหนี้ | `BillingRecipientAdminPage` |
| `/recipient-changes/[id]` | คำขอเปลี่ยนผู้รับเอกสาร | สถานะ/อนุมัติคำขอ | `BillingRecipientAdminPage` |
| `/companies/[id]/invoices/[invoiceId]/refund` | คำขอคืนเงิน | สร้างคำขอคืนเงิน | `BillingRefundPage` |
| `/refunds/[id]` | คำขอคืนเงิน (รายการ) | สถานะ/อนุมัติ/ผลจาก Stripe | `BillingRefundPage` |
| `/companies/[id]/apply-invoices` | เปิดแพ็กเกจจากยอดที่ลูกค้าจ่ายแล้ว | เลือกใบแจ้งหนี้ที่จ่ายแล้วเพื่อเปิดสิทธิ์ | `BillingApplyInvoicesPage` |
| `/companies/[id]/apply-invoices/[invoiceId]` | — (ใบที่เลือก) | ตรวจและยืนยันการเปิดสิทธิ์ | `BillingApplyInvoicesPage` |
| `/companies/[id]/plan-adjustments` | ปรับแพ็กเกจ/แถมวันใช้งาน | เพิ่มวันใช้งาน, ปรับสิทธิ์, ประวัติคำขอ | `BillingPlanAdjustmentsPage` |
| `/plan-adjustments/[id]` | คำขอปรับแพ็กเกจ | สถานะ รอยืนยัน/รอปรับวันกับ Stripe/ปรับสิทธิ์แล้ว/ยกเลิก | `BillingPlanAdjustmentsPage` |
| `/companies/[id]/receipt-adjustments` | ใบเสร็จที่ผู้ดูแลเพิ่มให้ | เพิ่ม/ถอนจำนวนใบเสร็จ (ต้องยืนยันรหัสผ่านซ้ำ `reauthenticate`) | `BillingReceiptAdjustmentsPage` |
| `/receipt-adjustments/[id]` | คำขอปรับใบเสร็จ | สถานะ/อนุมัติ | `BillingReceiptAdjustmentsPage` |
| `/companies/[id]/deliveries` | รายการแจ้งเตือนแพ็กเกจ | ประวัติการส่งอีเมล/LINE เกี่ยวกับแพ็กเกจ | `BillingDeliveryPanel` |
| `/companies/[id]/deliveries/[deliveryId]` | รายการแจ้งเตือนหนึ่งรายการ | รายละเอียด/ส่งซ้ำ (id รูป `email:<outboxId>`) | `BillingDeliveryPanel` |
| `/companies/[id]/invoice-scans` | งานค้นหาใบแจ้งหนี้ของร้าน | เริ่ม/ทำต่อ/ยกเลิกงานตรวจกับ Stripe | `BillingProviderScansPage` |
| `/companies/[id]/invoice-scans/[scanId]` | งานตรวจหนึ่งงาน | ผลตรวจและ findings | `BillingProviderScansPage` |
| `/companies/[id]/invoice-findings/[findingId]` | ตรวจหลักฐานใบแจ้งหนี้ที่พบ | ตรวจ finding หนึ่งรายการ | `BillingInvoiceFindingPage` |
| `/provider-scans` | งานตรวจกับ Stripe (ทั้งระบบ) | รายการงานค้นหา, ตารางเวลา (`BillingScanSchedulePanel`) | `BillingProviderScansPage` |
| `/provider-scans/[id]` | งานตรวจหนึ่งงาน | รายละเอียด | `BillingProviderScansPage` |
| `/provider-events` | เหตุการณ์จาก Stripe | รายการ webhook event | `BillingProviderEventsPage` |
| `/provider-events/[id]` | เหตุการณ์หนึ่งรายการ | preview / ประมวลผลซ้ำ | `BillingProviderEventsPage` |
| `/settlements` | ตรวจยอดรับเงิน | กระทบยอดชำระ/คืนเงิน/โอนออก/ค่าธรรมเนียม Stripe ตามช่วง | `BillingSettlementPage` |
| `/settlements/[id]` | รอบตรวจยอด | รายละเอียดรอบ | `BillingSettlementPage` |
| `/batches` | ตรวจรายการหลายบริษัท | งานแบบกลุ่ม | `BillingBatchPage` |
| `/batches/[id]` | งานกลุ่มหนึ่งงาน | ผลรายบริษัท | `BillingBatchPage` |
| `/operations/[id]` | รายละเอียดการดำเนินการ | สถานะคำสั่ง, ผลกระทบ, ลิงก์กลับไป issue/batch (`?issue=&batch=&queue=&cursor=`) | `BillingOperationPanel`, `BillingOperationDetail` |
| `/settings` | ตั้งค่าการชำระเงิน | ราคา/เงื่อนไขข้อเสนอ (`BillingOfferTermsEditor`), นโยบาย | `BillingConfigurationPage` |
| `/configuration-changes/[id]` | คำขอเปลี่ยนการตั้งค่า | ตรวจ/อนุมัติการเปลี่ยนราคา/เงื่อนไข | `BillingConfigurationPage` |
| `/configuration-changes/[id]/affected` | รายการที่ต้องตรวจประกอบการตั้งค่า | ร้าน/รายการที่ได้รับผลกระทบ | `BillingConfigurationImpactPage` |
| `/configuration-checks` | ตรวจการเชื่อมต่อ Stripe | ตรวจ POLICY/ACCOUNT/PRICE/PREPAID_PRICE/PORTAL/TAX | `BillingConfigurationChecksPage` |
| `/configuration-checks/[id]` | ผลตรวจหนึ่งครั้ง | รายละเอียด | `BillingConfigurationChecksPage` |
| `/campaigns` | แคมเปญโปรโมชั่น | รายการแคมเปญ | `BillingCampaignsPage` |
| `/campaigns/new` | สร้างแคมเปญโปรโมชั่น | ฟอร์มสร้าง (เช่น แถมเดือน) | `BillingCampaignFormPage` |
| `/campaigns/[campaignId]` | แคมเปญ | ร่าง/เผยแพร่/รายงาน (`BillingCampaignReportSection`, `BillingSalesCohortPicker`) | `BillingCampaignDetailPage` |
| `/operator-scopes` | บริษัทที่เจ้าหน้าที่การชำระเงินดูแล | กำหนดขอบเขตร้านของเจ้าหน้าที่ billing | `BillingScopesPage` |
| `/scope-changes/[id]` | คำขอเปลี่ยนขอบเขต | สถานะ/อนุมัติ | `BillingScopesPage` |

ตรวจจำนวน: `find apps/web/app/system/billing -name page.tsx | wc -l` = 42 และ `find apps/web/app/system -name page.tsx | wc -l` = 70 (28 + 42)

---

## 5. ข้อกำหนดเชิงหน้าที่ของ UI (FR-UI)

ข้อกำหนดชุดนี้มองจากฝั่งหน้าจอ: กฎธุรกิจฝั่ง API, รายการ endpoint เต็ม และ data model อยู่ในเอกสารอื่นของชุด หัวข้อ "หน้าจอ/API" อ้างตารางในหัวข้อ 4 ชื่อ Prisma model ตรวจจาก `apps/api/prisma/schema.prisma` คำย่อแพ็ก: **S+** = `STARTER_249`/`BASIC_499`/`PRO_999`/`ENTERPRISE_1999`, **ENT** = `ENTERPRISE_1999`

### FR-UI-001 เปลือกพื้นที่ร้านและเมนูตามแพ็กและสิทธิ์
- **คำอธิบาย**: แสดงแถบบน แถบข้าง แบนเนอร์อายุแพ็ก และกันการเปิดหน้าที่ไม่มีสิทธิ์
- **ผู้ใช้/สิทธิ์**: สมาชิกร้านทุกคน; เมนูตาม `session.permissions` (ตาราง 3.4)
- **แพ็ก**: ทุกร้าน; ชุดเมนูตาม 3.1
- **เงื่อนไขก่อนทำ**: ผ่านด่าน FR-UI-002
- **ขั้นตอนหลัก**: อ่าน plan-term notice → เลือกเปลือก (locked / billing recovery / business) → กรองโมดูล → สร้างแถบข้าง → ตรวจ `canAccessWorkspacePath` ของ path ปัจจุบัน
- **กฎ/ข้อยกเว้น**: `ACCOUNTING_UI_HIDDEN` ซ่อน `journal`/`closing`; โหมด `freeExpenseDrafts` เหลือเฉพาะค่าใช้จ่าย; session เดโม่ไม่เห็น `แพ็กเกจ`; หน้า `/account` เปิดได้เสมอ; ลิงก์งานเบิกจ่ายที่มอบหมายเฉพาะตัวเปิดได้ด้วย `account.session.read`; notice อ่านไม่ได้ครั้งแรก = เปิดต่อ (fail open) แต่ถ้ากำลังล็อกอยู่แล้วอ่านไม่ได้ = คงล็อก
- **ข้อผิดพลาด**: หน้าที่ถูกปฏิเสธแสดง `ForbiddenState` ในเปลือก พร้อมลิงก์ไปโมดูลแรกที่เปิดได้
- **ข้อมูล**: `CompanyMembership`, `Role`, `RolePermission`, `CompanyFeatureEntitlement`, `CompanyEntitlementSet`, `CompanyPlanTerm`, `CompanyWebEntrySetting`, `Branch`, `MembershipBranchScope`
- **API**: `GET /v1/auth/me`, `GET /v1/auth/me/companies`, `GET /api/v1/plan-term/notice`, `GET /v1/companies/:id/billing`, `GET /v1/companies/:id/branches`
- **หน้าจอ**: ทุกหน้าใต้ `/companies/[companyId]`
- **การทดสอบ**: `web-core-workspace.spec.ts`, `settings-menu.logic.spec.ts`, `menu-filter.spec.ts`, `permission-page-visibility.spec.ts`, `sold-features-regressions.spec.ts`, `AppSidebar.spec.ts`; e2e `sidebar-nav.spec.ts`, `feature-entitlement-accessibility.spec.ts`, `journeys/shop-menus-everyday.journey.spec.ts`

### FR-UI-002 ด่าน session และการพาไปหน้าที่ถูกต้อง
- **คำอธิบาย**: ไม่มี session → login; รหัสชั่วคราว → บังคับเปลี่ยน; ยังไม่ยอมรับเอกสารกฎหมาย → หน้ายอมรับ; แพลตฟอร์มปิด → maintenance; แล้วพากลับหน้าที่ตั้งใจเปิด
- **ผู้ใช้/สิทธิ์**: ทุกคน
- **แพ็ก**: ทุกร้าน
- **ขั้นตอนหลัก**: `proxy.ts` ตรวจ cookie → layout เรียก `fetchServerSessionResult` → redirect ตามผล (ตาราง 1.2)
- **กฎ/ข้อยกเว้น**: `next` ต้องผ่าน `sanitizeNextPath`; session เซลล์ล้วนไป `/sales/deals`, ผู้บริหารล้วนไป `/system/executive`; auth service ล่ม = แสดงหน้า error ไม่ส่งไป login (กัน loop)
- **ข้อผิดพลาด**: `CompanyAccessUnavailable` (บอกชื่อบัญชีที่ล็อกอินอยู่และชื่อร้าน), `SystemAccessDenied`
- **ข้อมูล**: `User`, `UserCredential`, `LegalDocumentActionRecord`
- **API**: `GET /v1/auth/me`, `POST /api/auth/refresh`, `/v1/auth/legal-acceptance`, `GET /v1/auth/platform-access`
- **หน้าจอ**: `/login`, `/change-password`, `/legal-acceptance`, `/maintenance`
- **การทดสอบ**: `session-gate.logic.spec.ts`, `middleware.logic.spec.ts`, `proxy.spec.ts`, `server-session.spec.ts`, `refresh-route.spec.ts`; e2e `login.spec.ts`, `legal-acceptance.spec.ts`

### FR-UI-003 สมัครใช้งานและรับบัญชี
- **คำอธิบาย**: ผู้สนใจกรอกฟอร์มสมัครร้าน ติดตามสถานะ รับลิงก์ทางอีเมลเพื่อตั้งรหัสผ่าน แล้วเชื่อม LINE
- **ผู้ใช้/สิทธิ์**: สาธารณะ (ไม่ต้องมีสิทธิ์)
- **แพ็ก**: ร้านใหม่ได้ tier `FREE_TRIAL_15` ตามค่าคงที่ `SIGNUP_TRIAL_TIER_KEY` (`plan-term.ts:154`); ข้อความในหน้าตามการตัดสินใจ 2026-09-20 ว่า "ไม่มีช่วงทดลอง" — ร้านใหม่ถูกถือว่าล็อกจนกว่าจะยืนยันได้ว่ามี term ที่ยังเดินอยู่ (`SignupWelcomePage.tsx:212-265`)
- **เงื่อนไขก่อนทำ**: ช่องทางสมัครเปิดอยู่ (`…/company-signups/availability`)
- **ขั้นตอนหลัก**: ดู 6.1
- **กฎ/ข้อยกเว้น**: ฟอร์มใช้ idempotency key เดิมทุกครั้งที่ retry และเปลี่ยน key เฉพาะหลังถูกปฏิเสธด้วย validation; ลิงก์ claim ที่ใช้ไม่ได้ทุกแบบแสดงหน้าเดียวกัน (ไม่บอกว่า token ใกล้ถูกแค่ไหน); อีเมลที่มีบัญชีอยู่แล้วให้ใช้ "เข้าสู่ระบบด้วยบัญชีเดิม"; LINE ที่ผูกกับบัญชีอื่น → เสนอรวมบัญชีหรือคงสองบัญชี
- **ข้อผิดพลาด**: error รายช่องใต้ช่องนั้น; ระบบตรวจลิงก์ไม่ได้ → "ตรวจสอบลิงก์ไม่ได้ตอนนี้" + ลองอีกครั้ง
- **ข้อมูล**: `CompanySignupRequest`, `CompanyOnboardingRun`, `Company`, `User`, `CompanyMembership`, `SalesAttribution`
- **API/หน้าจอ**: ตาราง 4.3 (`/signup`, `/signup/status/[requestId]`, `/claim-account`, `/signup/welcome`, `/email-access`)
- **การทดสอบ**: `signup.logic` specs, `signup-pages.qa.spec.ts`, `welcome-handoff.logic` spec; e2e `line-signup-contact-email.spec.ts`, `journeys/public-home.journey.spec.ts`

### FR-UI-004 เข้าสู่ระบบและกู้บัญชี
- **คำอธิบาย**: เข้าด้วยรหัสผ่าน, LINE Login, QR จากคอม, หรือรหัสยืนยันทางอีเมล; ลืม/รีเซ็ต/เปลี่ยนรหัสผ่าน; ยืนยันอีเมล
- **ผู้ใช้/สิทธิ์**: ทุกคน; เมนูผู้ใช้ใช้ `account.password.change`, `account.identity.link`, `account.identity.unlink`
- **แพ็ก**: ทุกร้าน
- **กฎ/ข้อยกเว้น**: `/login` ส่งต่อเฉพาะเมื่อ `GET /auth/me` ผ่านจริง; ข้อความ 401 ของหน้า login คือ "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง…" ไม่ใช่ "หมดอายุ"; rate limit → "ลองเข้าสู่ระบบหลายครั้งเกินไป…"
- **ข้อมูล**: `User`, `UserCredential`
- **API/หน้าจอ**: ตาราง 4.3–4.4
- **การทดสอบ**: `auth.logic` specs, `line-in-app-browser.logic.spec.ts`, `change-password-bff.server.spec.ts`; e2e `login.spec.ts`, `account-email-otp-ux.spec.ts`, `line-recovery.spec.ts`

### FR-UI-005 หน้าแรก
- **คำอธิบาย**: ภาพรวมรายจ่ายและงานที่รอ ตามช่วงเวลาและสาขาที่เลือก
- **ผู้ใช้/สิทธิ์**: `dashboard.read` · **แพ็ก**: S+
- **กฎ**: ป้ายความสดของข้อมูล (ล่าสุด/ข้อมูลเก่า/ข้อมูลบางส่วน/ไม่พร้อมใช้งาน); "เลือกวันที่" เริ่มที่เดือนก่อน
- **ข้อผิดพลาด**: "โหลดตัวเลขไม่สำเร็จ" / "โหลดตัวเลขใหม่ไม่สำเร็จ"
- **ข้อมูล**: `ExpenseRecord`, `ExpensePayment`, `NotificationEvent`
- **API/หน้าจอ**: `/dashboard` (4.1.1) · **การทดสอบ**: `dashboard-home.logic` spec; e2e `dashboard.spec.ts`

### FR-UI-006 ข้อมูลร้านและตัวตนทางภาษี
- **คำอธิบาย**: กรอกชื่อจดทะเบียน เลขผู้เสียภาษี ที่อยู่ ประเภทธุรกิจ และสถานะ VAT; การ์ดบอกสิ่งที่ยังขาด
- **ผู้ใช้/สิทธิ์**: เปิด `company.setup.read|manage`; บันทึก `company.legal_identity.manage` · **แพ็ก**: ทุกร้าน (เปิดได้แม้ร้านถูกล็อก)
- **กฎ**: ผู้ไม่มีสิทธิ์บันทึกเห็นข้อมูลแบบปิดบัง; จุดเตือนบนเมนู `ตั้งค่าร้าน` จนกว่าจะครบ; ข้อมูลร้านไม่ครบทำให้ออก 50 ทวิ/แบบภาษีไม่ได้ (หน้าเหล่านั้นลิงก์กลับมาที่นี่)
- **ข้อมูล**: `Company`, `CompanyLegalIdentityRevision`, `CompanyVatRegistrationState`, `CompanyVatRegistrationFact`
- **API/หน้าจอ**: `/settings/profile`, `/account` (4.1.5, 4.1.1) · **การทดสอบ**: `company-profile.logic` spec; e2e `profile-completeness-card.spec.ts`, `settings.spec.ts`

### FR-UI-007 สาขา
- **ผู้ใช้/สิทธิ์**: `company.branch.read|manage` · **แพ็ก**: ทุกร้าน; จำนวนสาขาตามโควตาแพ็ก (1/2/5/10)
- **กฎ**: เกินโควตา → ข้อความโควตาจาก API และลิงก์ "ดูหรือเปลี่ยนแพ็กเกจ"; สาขาไม่ลบ แต่ปิดใช้งาน; รหัสสาขาภาษีจำเป็นสำหรับแบบ ภ.ง.ด. หลายสาขา
- **ข้อมูล**: `Branch` · **API/หน้าจอ**: `/settings/branches` · **การทดสอบ**: `branch-scope-label.logic.spec.ts`, `transaction-create-branch.spec.ts`; e2e `branch-scope.spec.ts`, `transaction-branch.spec.ts`

### FR-UI-008 พนักงาน บทบาท สิทธิ์ และการเชื่อม LINE
- **ผู้ใช้/สิทธิ์**: `access.employee.read|create|update`, `access.role.manage`, `access.effective.read` · **แพ็ก**: ทุกร้าน; จำนวนพนักงานตามโควตา (2/5/10/30)
- **ขั้นตอนหลัก**: ดู 6.3
- **กฎ**: 1 คนมี 1 บทบาท; บทบาทมาตรฐานแก้ไม่ได้; มอบสิทธิ์ได้ไม่เกินสิทธิ์ของผู้มอบ; ลิงก์เชื่อม LINE ใช้ได้ 15 นาที
- **ข้อมูล**: `CompanyMembership`, `MembershipRole`, `Role`, `RolePermission`, `MembershipBranchScope`, `User`
- **API/หน้าจอ**: `/settings/access-overview`, `/settings/employees`, `/settings/permissions` · **การทดสอบ**: `role-picker.logic` spec, `employee-email.logic` spec; e2e `journeys/team-and-roles.journey.spec.ts`, `employee-job-title.spec.ts`

### FR-UI-009 นำใบเสร็จเข้าระบบ (อัปโหลดให้ AI อ่าน / บันทึกด้วยมือ)
- **ผู้ใช้/สิทธิ์**: `expense.receipt.upload`, `expense.ocr.request`; มือ: `expense.create` + ค่าตั้งร้าน · **แพ็ก**: S+; นับโควตาใบเสร็จเมื่อ AI อ่านสำเร็จ
- **กฎ**: ต้องเลือกสาขาก่อนส่ง; รูปใหญ่ย่ออัตโนมัติ; HEIC แปลงในเบราว์เซอร์; ผลเป็น "ร่าง" เสมอ คนเป็นผู้ยืนยัน
- **ข้อผิดพลาด**: ไฟล์ไม่รองรับ/ตรวจไม่ได้ (`CONTENT_UNINSPECTABLE`, `EMBEDDED_FILE_REJECTED`), โควตาอัปโหลดค้าง, 413
- **ข้อมูล**: `ExpenseRecord`, `ExpenseLine`, `ExpenseCaptureGroup`, `ExpenseCaptureFile`, `ExpenseCaptureReadJob`, `AttachmentObject`, `AttachmentLink`, `CompanyOcrUsageEvent`
- **API/หน้าจอ**: `/expenses/upload`, `/expenses/manual` · **การทดสอบ**: `upload-file.logic.spec.ts`, `upload-consistency.spec.ts`, `manual-expense-entry.logic` spec; e2e `expense-capture-intake.spec.ts`, `manual-expense-web-entry.spec.ts`, `journeys/staff-receipt-from-phone.journey.spec.ts`, `receipt-draft-continuity.spec.ts`

### FR-UI-010 ตรวจ ยืนยัน แก้ไข ยกเลิกรายจ่าย และบันทึกการจ่าย
- **ผู้ใช้/สิทธิ์**: `expense.read*`, `expense.update`, `expense.review`, `expense.confirm`, `expense.payment.record` · **แพ็ก**: S+
- **ขั้นตอนหลัก**: ดู 6.4
- **กฎ**: สถานะเอกสาร (ร่าง → รอตรวจ → พร้อมยืนยัน → ยืนยันแล้ว / ไม่ผ่าน) แยกจากสถานะการจ่าย (ยังไม่จ่าย/จ่ายบางส่วน/จ่ายแล้ว); ยืนยันไม่ได้ต้องบอกสิ่งที่ขาดและปุ่มกลับไปขั้นนั้น; งวดบัญชี/ภาษีที่ล็อกแล้วปฏิเสธพร้อมเหตุผล; วันที่จ่ายอนาคตไม่รับ
- **ข้อมูล**: `ExpenseRecord`, `ExpenseLine`, `ExpensePayment`, `ExpenseDuplicateCandidate`, `ExpenseInputVatDecision`
- **API/หน้าจอ**: `/expenses`, `/expenses/[expenseId]` · **การทดสอบ**: e2e `expenses.spec.ts`, `expense-number-save.spec.ts`, `expense-running-number.spec.ts`, `journeys/paid-expense-reopened.journey.spec.ts`, `journeys/expense-input-vat-right.journey.spec.ts`, `journeys/plain-shop-records-everything.journey.spec.ts`

### FR-UI-011 หมวดหมู่ค่าใช้จ่าย และคู่ค้า
- **ผู้ใช้/สิทธิ์**: `expense.category.manage`; `accounting.counterparty.read|manage` · **แพ็ก**: S+
- **กฎ**: หมวดของระบบเปลี่ยนชื่อไม่ได้ เปิด/ปิดได้; AI เลือกได้เฉพาะหมวดที่เปิด; คู่ค้าต้องระบุประเภทบุคคล/บริษัทก่อนใช้กับแบบภาษี
- **ข้อมูล**: `ExpenseCategory`, `ExpenseCategoryAccountantAccount` (คู่ค้า: ดูเอกสาร data model)
- **API/หน้าจอ**: `/expenses/categories`, `/counterparties`, `/counterparties/[id]` · **การทดสอบ**: e2e `counterparties.spec.ts`

### FR-UI-012 ใบรับรองแทนใบเสร็จ และลายเซ็นของฉัน
- **ผู้ใช้/สิทธิ์**: `expense.review`, `expense.confirm`, `expense.read_own`, `expense.read_related`; ลายเซ็น `expense.signature.self_manage`; ตั้งค่า `company.setup.manage` · **แพ็ก**: S+
- **กฎ**: wizard 4 ขั้น; หลักฐาน 2 ประเภท (หลักฐานประกอบ/หลักฐานการจ่าย) ห้ามเป็นไฟล์เดียวกัน; ใช้อ้างภาษีซื้อไม่ได้; เซ็นในระบบหรือบนกระดาษ; ผู้มีบทบาทที่ได้รับยกเว้นอนุมัติเองได้ (`hasSelfApprovalExemptRole`)
- **ข้อมูล**: `ExpenseSubstituteReceiptEvidence`, `ExpenseSubstituteReceiptPolicy`, `CompanySignatureAsset`
- **API/หน้าจอ**: `/expenses/substitute-receipts*`, `/expenses/signatures`, `/settings/substitute-receipt` · **การทดสอบ**: e2e `journeys/no-receipt-certificate.journey.spec.ts`, `substitute-cancelled-view-only.spec.ts`, `substitute-editable-navigation.spec.ts`

### FR-UI-013 การเบิกจ่าย
- **ผู้ใช้/สิทธิ์**: `reimbursement.create`, `reimbursement.update_own_draft`, `reimbursement.read|read_related|read_own`, `reimbursement.approve`, `reimbursement.finance_review`, `reimbursement.payment.record` · **แพ็ก**: S+
- **ขั้นตอนหลัก**: ดู 6.5
- **กฎ**: 1–50 รายการต่อใบ; ยอดรวมกรอกเองไม่ได้; ยอดต่ำกว่าเกณฑ์ของร้านไม่ต้องอนุมัติ; ขั้นตรวจการเงินเป็นตัวเลือกของร้าน; จ่ายโอนต้องแนบสลิป; เซ็นหลังจ่าย; เลขบัญชีเต็มต้องกดเปิดและถูกบันทึก; ห้ามอนุมัติใบของตัวเอง (ยกเว้นร้านผู้ใช้คนเดียวตามนโยบาย)
- **ข้อผิดพลาด**: ติดรายการซ้ำ (`duplicate_unresolved`, `duplicate_confirmed`) พร้อมข้อความเฉพาะขั้น
- **ข้อมูล**: `ReimbursementRequest`, `ReimbursementLine`, `ReimbursementApprovalStep`, `ReimbursementPayment`, `ReimbursementPayoutDestination`, `ReimbursementClaimSignature`, `ReimbursementPolicy`, `ReimbursementDraftAction`, `ReimbursementInternalNote`, `ReimbursementDuplicateCandidate`
- **API/หน้าจอ**: 4.1.3 · **การทดสอบ**: `reimbursements.logic` specs; e2e `reimbursements.spec.ts`, `reimbursement-receipt.spec.ts`, `journeys/claim-declined-then-paid.journey.spec.ts`

### FR-UI-014 ใบเตรียมจ่ายและใบสำคัญจ่าย
- **ผู้ใช้/สิทธิ์**: `expense.disbursement.read`, `expense.disbursement.prepare` และสิทธิ์อนุมัติ/บันทึกจ่าย/ออกใบจากการจ่ายตรง (5 ชุดสิทธิ์ตามตารางในคู่มือ) · **แพ็ก**: S+ เมื่อผู้ดูแลระบบเปิด `disbursementVoucherWebEntry` ให้ร้าน
- **ขั้นตอนหลัก**: ดู 6.6
- **กฎ**: รวมได้เฉพาะรายจ่ายยืนยันแล้วที่ค้างจ่ายของผู้รับเงินเดียวกัน; ใบสำคัญจ่ายใช้เลขที่เดิมของใบเตรียมจ่าย; ยกเลิกการจ่าย → ใบสำคัญจ่ายถูกยกเลิก
- **ข้อมูล**: `DisbursementVoucher`, `DisbursementVoucherLine`, `DisbursementVoucherRevision`, `DisbursementVoucherCommand`, `ExpensePayment`
- **API/หน้าจอ**: 4.1.2 · **การทดสอบ**: `disbursement-voucher-guide.content.spec.ts`; e2e `journeys/payment-document-two-people.journey.spec.ts`, `journeys/voucher-supporting-files.journey.spec.ts`

### FR-UI-015 หนังสือรับรอง 50 ทวิ
- **ผู้ใช้/สิทธิ์**: `wht.certificate.read|issue|correct`, `wht.external_certificate.link`; ลายเซ็น `company.tax_signature.manage` · **แพ็ก**: จดเลขที่ใบที่ทำนอกระบบ = S+; ออก/แก้/พิมพ์ใบแทนในระบบ = **ENT** (`wht_50bis`)
- **กฎ**: ข้อมูลร้านไม่ครบ → สถานะ "รอข้อมูลร้าน" พร้อมลิงก์ "กรอกข้อมูลร้าน"; ต้องมีที่อยู่ผู้รับเงิน; ประเภทเงินได้ที่ระบบไม่รองรับ → ให้ผู้ทำบัญชีทำนอกระบบ; พิมพ์ใบแทนใช้เลขที่เดิม
- **ข้อมูล**: `WhtCertificate`, `WhtCertificateHandoff`, `WhtCertificateHistory`, `WhtIncomeCategory`, `CompanyTaxProfile`
- **API/หน้าจอ**: `/expenses/wht-certificates`, `/settings/tax-signature`, ส่วนในหน้า `/expenses/[expenseId]` · **การทดสอบ**: `expense-wht-certificates.logic` spec; e2e `journeys/package-upgrade-unlocks-50-tawi.journey.spec.ts`, `wht-settlement.spec.ts`

### FR-UI-016 แบบ ภ.ง.ด.3 และ ภ.ง.ด.53
- **ผู้ใช้/สิทธิ์**: `wht.pnd53.read`, `wht.pnd53.prepare` · **แพ็ก**: **ENT** (`wht_pnd53`)
- **ขั้นตอนหลัก**: ดู 6.7
- **กฎ**: ภ.ง.ด.3 = จ่ายให้บุคคล, ภ.ง.ด.53 = จ่ายให้บริษัท; ประเภทที่ต้องยื่น ภ.ง.ด.2 ให้ผู้ทำบัญชีทำแยก; ดาวน์โหลดไม่ได้ถ้ามีรายการ "ต้องแก้ก่อนยื่น"; หลายสาขาต้องระบุผู้จ่าย/สาขา; ยื่นแล้วแก้แบบเดิมไม่ได้ (ยื่นเพิ่มเติมเป็นครั้งที่ n); พ้นกำหนดยื่นให้ผู้ทำบัญชีดำเนินการ
- **ข้อผิดพลาด**: รหัส `PND3_FILING_*`, `PND53_FILING_*`, `WHT_*` (8.3)
- **ข้อมูล**: `WhtFiling`, `WhtFilingLine`, `TaxEvent`, `TaxReviewIssue`, `TaxPeriod`, `WhtPayerModeFact`
- **API/หน้าจอ**: `/tax/withholding` · **การทดสอบ**: e2e `journeys/withholding-forms.journey.spec.ts`, `withholding-page.spec.ts`, `journeys/e-wht-payment.journey.spec.ts`

### FR-UI-017 หลักฐานทางบัญชีและการส่งออกให้สำนักงานบัญชี
- **ผู้ใช้/สิทธิ์**: `expense.evidence.read`, `expense.export` · **แพ็ก**: S+
- **ขั้นตอนหลัก**: ดู 6.8
- **กฎ**: ส่งออกเฉพาะรายการยืนยันแล้ว; รูปแบบ "Excel สำหรับสำนักงานบัญชี" และ "ไฟล์แยกตามหมวด" (สำหรับนำเข้าโปรแกรมบัญชี; เตือนหมวดที่ยังไม่มีรหัส); ชุดเอกสาร = สารบัญ + ไฟล์หลักฐาน แบ่งเป็นหลายส่วนเมื่อใหญ่ (`bundle-plan`, `bundle/:part`)
- **ข้อมูล**: `ExpenseRecord`, `AttachmentLink`, `ExpenseCategoryAccountantAccount`
- **API/หน้าจอ**: `/expenses/evidence`, `/expenses` · **การทดสอบ**: e2e `evidence.spec.ts`, `journeys/evidence-and-settings.journey.spec.ts`

### FR-UI-018 แพ็กเกจ: ซื้อ เปลี่ยน ต่ออายุ หยุดต่ออายุ และสถานะล็อก
- **ผู้ใช้/สิทธิ์**: `company.plan.manage` · **แพ็ก**: ทุกร้าน (หน้านี้คือที่ซื้อ S+)
- **ขั้นตอนหลัก**: ดู 6.10
- **กฎ**: 3 ขั้น (เลือกแพ็กเกจ → วิธีจ่าย → จ่าย); จ่ายจริงที่หน้าของผู้ให้บริการรับเงิน (Stripe) แล้วกลับ `/billing/return?attempt=`; ต้องติ๊กยอมรับการต่ออายุ; เพิ่มระดับมีผลหลังจ่ายส่วนต่าง ลดระดับ/ยกเลิกมีผลเมื่อจบรอบ; ระยะผ่อนผัน 7 วันเมื่อจ่ายต่ออายุไม่สำเร็จ; ระหว่างตรวจคำขอคืนเงินซื้อ/เปลี่ยนไม่ได้; การคืนเงินทำโดยทีมงาน (ไม่มีปุ่มคืนเงินฝั่งร้าน)
- **ข้อผิดพลาด**: ราคา/สถานะขายเปลี่ยน → "ตรวจสอบรายการใหม่"; หน้าจ่ายเงินหมดอายุ; ยังยืนยันผลไม่ได้ → "ตรวจสถานะล่าสุด" + เลขอ้างอิงสำหรับแจ้งทีมงาน
- **ข้อมูล**: `BillingAccount`, `BillingQuote`, `BillingAttempt`, `BillingInvoice`, `BillingSubscriptionContract`, `BillingReceiptGrant`, `BillingPromotionRedemption`, `CompanyPlanTerm`, `SalesEventTicket`
- **API/หน้าจอ**: 4.1.4, `/billing/companies`, `/account/email` · **การทดสอบ**: `billing-*.spec.ts` ใน `features/billing`; e2e `journeys/billing-first-card-renewal.journey.spec.ts`, `billing-first-promptpay.journey.spec.ts`, `billing-renew-or-top-up.journey.spec.ts`, `billing-stop-auto-renewal.journey.spec.ts`, `billing-unfinished-payment.journey.spec.ts`, `customer-billing-ux.spec.ts`, `billing-no-setup.spec.ts`, `billing-promotion.spec.ts`, `plan-term-billing-readiness.spec.ts`

### FR-UI-019 การแจ้งเตือนในแอป
- **ผู้ใช้/สิทธิ์**: `notification.read`, `notification.preference.manage`, `notification.rule.manage` · **แพ็ก**: S+
- **กฎ**: กระดิ่งแสดงจำนวนยังไม่ได้อ่าน; แจ้งเฉพาะคนที่เกี่ยวข้อง; หนึ่งงานที่รอมีหนึ่งแจ้งเตือน; ไม่แสดงเลขบัญชีเต็ม
- **ข้อมูล**: `NotificationEvent`, `NotificationRecipient`, `NotificationDelivery`, `NotificationPreference`, `NotificationRule`
- **API/หน้าจอ**: 4.1.1 · **การทดสอบ**: `dashboard-notifications.logic` spec; e2e `notifications.spec.ts`

### FR-UI-020 คู่มือการใช้งานในแอป
- **ผู้ใช้/สิทธิ์**: ทุกสมาชิก (เนื้อหาเปิดทุกคน ปุ่มลัดตามสิทธิ์) · **แพ็ก**: ทุกร้าน
- **กฎ**: ไฟล์คู่มือถูกตรึงด้วย hash สำหรับ help pack ของ LINE AI (หัวข้อ 7.2) การแก้ข้อความคู่มือเปลี่ยน hash
- **ข้อมูล**: ไม่มี (เนื้อหาในโค้ด) · **API**: ไม่มี · **หน้าจอ**: `/user-guide/*` · **การทดสอบ**: `user-guide.content.spec.ts`, `expenses-guide-manual-entry.spec.ts`, `disbursement-voucher-guide.content.spec.ts`

### FR-UI-021 ลิงก์จาก LINE, เข้าด้วย QR และร้านเดโม่
- **ผู้ใช้/สิทธิ์**: สมาชิกที่เชื่อม LINE; ผู้ถือลิงก์เดโม่ · **แพ็ก**: S+ (`ai_line_assistant`); เดโม่ไม่ผูกแพ็ก
- **กฎ**: token ใช้ครั้งเดียว; HEAD ไม่ใช้ token; ลิงก์เดโม่ไม่ใช้ LINE login; session เดโม่มีแบนเนอร์เวลาหมดอายุและจำกัดการกระทำ (`demo_action_unavailable`, `demo_read_limit_reached`)
- **ข้อมูล**: `SalesDemoLink`, `DemoChatMessage` · **API/หน้าจอ**: 4.4 · **การทดสอบ**: `demo-line-chat.logic.spec.ts`, `line-login-bff.logic` spec; e2e `line-recovery.spec.ts`, `liff-xss.spec.ts`

### FR-UI-022 คอนโซลทีมขาย
- **ผู้ใช้/สิทธิ์**: `sales.console.read`, `sales.deal.approve`, `sales.event.manage`, `sales.report.read`, `sales.team.manage` · **แพ็ก**: ไม่เกี่ยว (เครื่องมือขายแพ็ก)
- **กฎ**: เซลล์อนุมัติดีลของตัวเองไม่ได้; บัญชีถูกระงับ → เปลือกแจ้งครั้งเดียว; ดีลขายได้เฉพาะ `SALES_DEAL_ALLOWED_FEATURE_KEYS` (starter + `wht_pnd53` + `wht_50bis`)
- **ข้อมูล**: `SalesAgentProfile`, `SalesAttribution`, `SalesEventBatch`, `SalesEventBatchAgent`, `SalesEventQrToken`, `SalesEventTicket`, `SalesDemoLink`
- **API/หน้าจอ**: 4.5 · **การทดสอบ**: `sales-console.logic` spec, `sales-events.logic.spec.ts`; e2e `sales-console.spec.ts`, `billing-advance-deal.spec.ts`

### FR-UI-023 คอนโซลผู้ดูแลแพลตฟอร์ม (ร้าน สมาชิก คำขอ ตั้งค่า)
- **ผู้ใช้/สิทธิ์**: role `SYSTEM_ADMIN` + สิทธิ์ `system.*` รายหน้า (4.6.1) · **แพ็ก**: ไม่เกี่ยว
- **กฎ**: เปิด-ปิดฟีเจอร์ต้องผ่าน `FEATURE_DEPENDENCIES`; ปรับแพ็กต้องมีเหตุผลและ `expectedVersion`; ไม่แสดงค่าลับของ LINE credential
- **ข้อมูล**: `Company`, `CompanyPlanTerm`, `CompanyFeatureEntitlement`, `CompanyMembership`, `CompanySignupRequest`, `DataRightsCase`, `CompanyTeamNote`, `CompanyAiConfiguration`, `CompanyIntegrationCredential`, `WhtIncomeCategory`
- **API/หน้าจอ**: 4.6.1 · **การทดสอบ**: e2e `system-admin.spec.ts`, `system-settings-ux.spec.ts`, `system-support-resolution.spec.ts`, `SignupQueuePage.qa.spec.ts`

### FR-UI-024 คอนโซลการชำระเงินและรายงานผู้บริหาร
- **ผู้ใช้/สิทธิ์**: `system.billing.read` (+ `system.billing.financial.read`, `system.billing.override.manage` ฝั่ง API); `system.executive.read`, `system.executive_user.manage` · **แพ็ก**: ไม่เกี่ยว
- **กฎ**: คำสั่งที่กระทบเงิน/สิทธิ์เป็นแบบ preview → submit → approve พร้อม `previewHash`, `expectedVersion`, idempotency key; บางคำสั่งต้องยืนยันรหัสผ่านซ้ำ (`reauthenticate`); หน้าเปรียบเทียบของรายงานผู้บริหารถูกถอด
- **ข้อมูล**: `BillingIssue`, `BillingOperation`, `BillingInvoice`, `BillingProviderEvent`, `BillingOperatorScope`, `BillingSettings`, `BillingPolicyRevision`, `ExecutiveReportBuild`, `ExecutiveReportMonth`, `ExecutiveCompanyMonth`, `ExecutiveCompanyProfile`
- **API/หน้าจอ**: 4.6.1 (executive), 4.6.2 · **การทดสอบ**: e2e `billing-admin-directory.spec.ts`, `billing-admin-document-tools.spec.ts`, `billing-admin-menu-ux.spec.ts`, `executive-report.spec.ts`

---

## 6. คู่มือผู้ใช้ทีละขั้นตามเส้นทางงาน

เขียนด้วยคำบนจอจริง (ชื่อปุ่มและเมนูอยู่ในเครื่องหมาย “ ”) ที่มาของถ้อยคำ: dictionary, component ของแต่ละหน้า และคู่มือในแอป (`apps/web/src/features/user-guide/*.content.ts`) สิ่งที่คุณเห็นจริงขึ้นกับแพ็กเกจของร้านและสิทธิ์ของบัญชี

### 6.1 สมัครใช้งานและเข้าสู่ระบบครั้งแรก

1. เปิดเว็บมั่งมีพลัส กดปุ่มสมัคร หรือเปิดหน้า `/signup` จะเห็นหัวข้อ “สมัครใช้งานมั่งมีพลัส” และฟอร์ม “กรอกข้อมูลร้านเพื่อสมัคร”
2. กรอก “ชื่อร้าน” “ชื่อ” “นามสกุล” “อีเมล” “เบอร์มือถือ” ตอบเรื่อง “การจดทะเบียน VAT” และ “เลขประจำตัวผู้เสียภาษี” ถ้ามี ช่อง “รู้จักเราทางไหน (ไม่บังคับ)” และ “รหัสเซลล์” ข้ามได้ ติ๊กยอมรับ “ข้อกำหนดการใช้งาน” และ “ประกาศความเป็นส่วนตัว” แล้วกดส่ง
3. จอเปลี่ยนเป็น “ได้รับคำขอแล้ว กำลังตรวจสอบ” และ URL กลายเป็นหน้าสถานะของคำขอ เก็บลิงก์นี้ไว้เปิดดู “สถานะคำขอสมัคร” ภายหลังได้
4. เมื่อคำขอผ่าน จะได้อีเมลพร้อมลิงก์รับบัญชี กดลิงก์ จะเห็นหน้า “ตั้งรหัสผ่าน” ให้ตั้ง “ชื่อผู้ใช้” “รหัสผ่าน” และ “ยืนยันรหัสผ่าน” — ถ้าอีเมลนี้มีบัญชีอยู่แล้ว ให้ใช้ “เข้าสู่ระบบด้วยบัญชีเดิม” แทน
5. ถ้าลิงก์ขึ้นว่า “ลิงก์นี้ใช้ไม่ได้แล้ว” ให้เปิดหน้าสถานะคำขอแล้วขอลิงก์ใหม่ ถ้าขึ้นว่า “ตรวจสอบลิงก์ไม่ได้ตอนนี้” ให้กดลองอีกครั้ง (ลิงก์ยังใช้ได้)
6. หน้าถัดไปคือ “ขั้นตอนสุดท้าย เชื่อมกับ LINE” กดเชื่อมด้วยมือถือ หรือถ้า “ใช้คอมพิวเตอร์อยู่” ให้สแกน QR ด้วย LINE เสร็จแล้วจะขึ้น “เชื่อมบัญชี LINE แล้ว” ถ้าขึ้น “LINE นี้เชื่อมกับบัญชีอื่นอยู่แล้ว” ให้เลือกรวมบัญชีหรือคงไว้สองบัญชี
7. ครั้งแรกที่เข้าร้าน ระบบจะพาไปหน้า “ยืนยันเอกสารการใช้บริการ” อ่านแล้วกดยอมรับหนึ่งครั้ง
8. ร้านที่ยังไม่มีแพ็กเกจจะเห็นเพียงเมนู “ตั้งค่าร้าน” และ “แพ็กเกจ” ให้ไปข้อ 6.10 เพื่อเลือกแพ็กเกจ

**ทางเลือก**: ที่หน้าเข้าสู่ระบบกด “ใช้รหัสยืนยันทางอีเมลแทนรหัสผ่าน” กรอกอีเมล รับ “รหัสยืนยัน 6 หลัก” แล้วเข้าได้เลย หรือสมัครร้านใหม่จากหน้านั้น และสมัครผ่าน LINE ได้จากเมนูของ LINE OA (ดู 6.11)

**เข้าสู่ระบบครั้งต่อไป**: หน้า “เข้าสู่ระบบ” กรอก “ชื่อผู้ใช้ หรือ อีเมล” และ “รหัสผ่าน” หรือกดเข้าด้วย LINE บนคอมพิวเตอร์ใช้ “สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์” แล้วกดยืนยันบนมือถือที่หน้า “ยืนยันการเข้าสู่ระบบบนคอมพิวเตอร์” ลืมรหัสผ่านกด “ลืมรหัสผ่าน?” พนักงานที่ได้รหัสชั่วคราวจะถูกพาไปหน้าเปลี่ยนรหัสผ่านก่อนใช้งาน

### 6.2 ตั้งค่าร้านและตัวตนทางภาษี

1. เมนูซ้าย กด “ตั้งค่าร้าน” ถ้ายังกรอกไม่ครบจะมีจุดสีเหลืองที่เมนู และป้าย “ยังไม่ครบ” ที่ “ข้อมูลร้าน”
2. กดการ์ด “ข้อมูลร้าน” (ชื่อจดทะเบียน เลขผู้เสียภาษี ที่อยู่)
3. กรอก “ชื่อร้าน” “ชื่อจดทะเบียน” “เลขผู้เสียภาษี” (ตัวเลข 13 หลัก) “ที่อยู่ร้าน” (บ้านเลขที่ ถนน จังหวัด) และ “ประเภทธุรกิจ”
4. ตอบ “ร้านจดทะเบียน VAT หรือยัง”: “จดทะเบียน VAT แล้ว” หรือ “ยังไม่ได้จดทะเบียน VAT”
5. กด “บันทึกข้อมูลร้าน” จะขึ้น “บันทึกข้อมูลร้านแล้ว” และบรรทัด “ข้อมูลร้านยังขาด: …” จะหายเมื่อครบ
6. ถ้ามีหลายสาขา กลับไป “ตั้งค่าร้าน” → “สาขา” → “+ เพิ่มสาขา” กรอก “ชื่อสาขา” “รหัสสาขา” ประเภท และ “รหัสสาขาภาษี” (เช่น 00001) แล้วกด “บันทึก” สาขาที่เลิกใช้ให้ “ปิดใช้งาน” จำนวนสาขาเพิ่มได้ตามแพ็กเกจ
7. ร้านแพ็กธุรกิจที่จะออก 50 ทวิในระบบ: “ตั้งค่าร้าน” → “ลายเซ็นบน 50 ทวิ” แล้วอัปโหลดลายเซ็น (เฉพาะเจ้าของกิจการ)
8. ตั้งค่าเสริมตามต้องการ: “ตั้งค่าใบรับรองแทนใบเสร็จ” (วิธีอนุมัติและหลักฐานที่ต้องแนบ) และการตั้งค่า e-Withholding Tax

ข้อมูลบัญชีของตัวเอง (อีเมล เบอร์มือถือ รหัสผ่านสำรอง ชื่อที่แสดง) อยู่ที่เมนูผู้ใช้มุมบน → “บัญชีของฉัน”

### 6.3 เพิ่มพนักงานและกำหนดบทบาท

1. เมนูซ้าย “พนักงานและสิทธิ์” → “รายชื่อพนักงาน” → กด “เพิ่มพนักงาน”
2. ส่วน “ข้อมูลส่วนตัว”: คำนำหน้า ชื่อ นามสกุล ชื่อเล่น (ถ้ามี) ชื่อผู้ใช้ วันเดือนปีเกิด
3. ส่วน “ช่องทางติดต่อ”: อีเมล (ใช้เข้าสู่ระบบ) เบอร์โทรศัพท์ 10 หลัก ที่อยู่ (ถ้ามี)
4. ส่วน “บทบาทและสาขา”: ตำแหน่งงาน เลือกบทบาท 1 บทบาท เลือกอย่างน้อย 1 สาขา และเลือกสาขาหลัก
5. กดบันทึก ถ้าช่องใดขาดจะมีข้อความใต้ช่องนั้น เช่น “กรอกชื่อ” “อีเมลไม่ถูกต้อง” “เลือกบทบาท 1 บทบาท”
6. หลังบันทึกจะเห็น QR/ลิงก์ “เชื่อม LINE” ให้พนักงานสแกนด้วย LINE ของตัวเอง หรือกด “คัดลอกลิงก์” ส่งให้ (ลิงก์ใช้ได้ 15 นาที หมดแล้วกด “ออก QR ใหม่”)
7. แก้ไขภายหลัง: ที่ “รายชื่อพนักงาน” กดชื่อคน จะเห็น “เปลี่ยนบทบาท” ขอบเขตสาขา “รีเซ็ตรหัสผ่าน” “ออกลิงก์เชื่อม LINE” “แก้ไขข้อมูล” และ “ปิดใช้งาน” (มี dialog ยืนยันชื่อคน ปุ่ม “ไม่ปิด” · “ปิด”)
8. สร้างหรือแก้บทบาท: “พนักงานและสิทธิ์” → “บทบาทและสิทธิ์” → “เพิ่มบทบาท” ตั้งชื่อ แล้วติ๊กสิทธิ์ในตาราง “สิทธิ์เข้าถึงเมนู” (ดู/สร้าง/แก้ไข/ลบ/อนุมัติ) กดบันทึก “บทบาทมาตรฐาน” แก้ไม่ได้ ให้สร้าง “บทบาทของร้าน” แทน ก่อนปิดใช้งานบทบาทต้อง “ย้ายพนักงานไปบทบาทอื่น”

ถ้าเพิ่มไม่ได้เพราะครบจำนวนพนักงานของแพ็กเกจ ระบบจะบอกจำนวนสูงสุดและทางไป “แพ็กเกจ”

### 6.4 อัปโหลดใบเสร็จและยืนยันค่าใช้จ่าย

1. เมนูซ้าย “ค่าใช้จ่ายและใบเสร็จ” → “อัปโหลดใบเสร็จ” (บนมือถือถ่ายรูปได้เลย)
2. เลือกไฟล์หรือถ่ายรูป แล้วเลือกสาขา ใส่ “หมายเหตุ (ไม่บังคับ)” ได้ ใช้ “ถ่ายเพิ่ม” / “เลือกเพิ่ม” ถ้ามีหลายใบ
3. ส่งแล้วรอสักครู่ AI จะอ่านและเก็บเป็น **ร่าง** กด “ดูรายการที่ส่ง” หรือ “ส่งอีกใบ” ถ้าอ่านชื่อผู้ขาย วันที่ หรือยอดไม่ครบ กด “เติมข้อมูล” ส่งรูปผิดกด “ลบร่างใบเสร็จ”
4. เปิด “รายการค่าใช้จ่าย” กดแถวของร่าง จะเข้าหน้าตรวจ 3 ขั้น: “ตรวจข้อมูล” → “ภาษีและเอกสาร” → “ตรวจสรุป” เดินหน้าด้วย “ถัดไป” ถอยด้วย “กลับ”
5. ขั้น “ตรวจข้อมูล”: เทียบชื่อผู้ขาย เลขที่เอกสาร วันที่ ยอดเงิน และ VAT กับรูปใบเสร็จ
6. ขั้น “ภาษีและเอกสาร”: เลือก “ประเภทเอกสาร” ตอบ “ใช้เป็นหลักฐานรายจ่ายได้ไหม” เลือกหมวดหมู่ และ (ผู้ตรวจ) ตอบเรื่องสิทธิ์ใช้ภาษีซื้อ
7. ขั้น “ตรวจสรุป”: ถ้าคุณมีสิทธิ์ยืนยัน กด “ยืนยันเอกสาร” ถ้าไม่มี กด “ส่งให้ตรวจ” แล้วเลือกหนึ่งคนใน “ส่งให้ใครตรวจ” คนนั้นจะได้รับแจ้ง
8. ถ้ายืนยันไม่ได้ หน้าจอจะบอกสิ่งที่ขาดพร้อมปุ่มกลับไปแก้ขั้นนั้น ถ้าไม่มีใบเสร็จ กด “ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา” เพื่อไปทำใบรับรองแทนใบเสร็จ
9. เมื่อจ่ายเงินจริงแล้ว เปิดรายจ่ายเดิม ไปที่ “การจ่ายเงิน” ใส่ยอด วันที่จ่ายจริง วิธีจ่าย (เริ่มที่ “โอนเงิน”) แนบหลักฐานการจ่าย แล้วบันทึก จ่ายบางส่วนได้ ระบบเก็บยอดคงค้าง
10. แก้เอกสารที่ยืนยันแล้ว: ใช้ “แก้ไขเอกสาร” ยกเลิก: “ยกเลิกเอกสาร” พร้อมเหตุผล (ถ้ามีรายการจ่ายต้องยกเลิกรายการจ่ายก่อน)

**ไม่มีใบเสร็จ**: “ค่าใช้จ่ายและใบเสร็จ” → “ใบรับรองแทนใบเสร็จ” ทำ 4 ขั้น “ค่าใช้จ่าย” → “รายละเอียด” → “เซ็น” → “เสร็จ” แนบ “หลักฐานประกอบ” (ซื้ออะไร) และ “หลักฐานการจ่าย” (จ่ายเงินแล้ว) เลือกเซ็นในระบบด้วย “ลายเซ็นของฉัน” หรือพิมพ์เซ็นบนกระดาษแล้วอัปโหลดฉบับที่เซ็นครบ

**บันทึกด้วยมือ** (เมื่อร้านเปิดเมนูนี้): “ค่าใช้จ่ายและใบเสร็จ” → “บันทึกด้วยมือ” กรอกข้อมูลเอกสาร ผู้ขายและรายการ ภาษี ดู “สรุปก่อนบันทึก” แล้วบันทึกเป็นร่าง จากนั้นตรวจและยืนยันเหมือนข้อ 4–7

### 6.5 เบิกเงินคืน: สร้างใบเบิก → อนุมัติ → จ่าย → เซ็น

**ผู้เบิก**
1. เมนูซ้าย “การเบิกจ่าย” → “+ สร้างใบเบิก”
2. ใส่รายการที่จ่ายไป (1 ถึง 50 รายการ) แนบใบเสร็จทีละรายการ หรือเลือกค่าใช้จ่ายที่บันทึกไว้แล้ว ยอดรวมระบบคำนวณให้
3. ในกล่อง “รับเงินคืนทาง” เลือกบัญชีประจำ บัญชีอื่น หรือเงินสด (ตั้งบัญชีประจำครั้งเดียวได้ที่ “บัญชีรับเงินคืนของฉัน”)
4. กดบันทึกร่าง เปิดดูไฟล์ ตรวจกล่อง “การรับเงินคืน” แล้วกด “ส่งอนุมัติ” ระบบออกเลขที่เอกสาร
5. ติดตามที่หน้าใบเบิก บรรทัด “อยู่ที่” บอกว่าใบเบิกรอใคร ถ้าถูกส่งกลับ อ่านเหตุผล แก้ แล้วส่งใหม่

**ผู้อนุมัติ**
6. เปิดจากกระดิ่ง ลิงก์ใน LINE หรือ “การเบิกจ่าย” แท็บงานที่รอคุณ
7. ตรวจรายการ ใบเสร็จ และบัญชีรับเงิน (ใบที่ขอรับโอนต้องตรวจบัญชีและติ๊กก่อน) แล้วกด “อนุมัติ” หรือ “ส่งกลับให้แก้” (ต้องใส่เหตุผล)
8. ร้านที่เปิด “ตรวจการเงินก่อนจ่าย” ฝ่ายการเงินกด “อนุมัติจ่าย” อีกขั้น ใบที่ยอดต่ำกว่าเกณฑ์ของร้านขึ้น “ไม่ต้องอนุมัติตามนโยบาย” และข้ามไปขั้นจ่าย

**ผู้จ่ายเงิน**
9. ที่ใบเบิกกด “จ่ายเงิน” ดูกล่อง “โอนเข้าบัญชีนี้” (เลขเต็มต้องกดเปิด และระบบบันทึกทุกครั้ง) โอนหรือจ่ายจริงก่อน
10. กรอกฟอร์มบันทึกจ่าย แนบสลิป (จ่ายด้วยการโอนต้องแนบ) ติ๊กยืนยัน แล้วกดบันทึกจ่ายตามยอดบนปุ่ม บันทึกผิดใช้ “ยกเลิกการจ่าย”

**ปิดงาน**
11. หลังจ่ายครบ ในขั้นเอกสารเลือก “เซ็นในระบบ” หรือ “เซ็นบนกระดาษ” (พิมพ์ใบเบิก เซ็น แล้ว “แนบใบที่เซ็นแล้ว”) ทำครบวิธีใดวิธีหนึ่งใบเบิกก็จบ

ยกเลิกใบเบิก: เปิดใบแล้วใช้ “ยกเลิกใบเบิกนี้” พร้อมเหตุผล ตามสิทธิ์และสถานะ

### 6.6 เตรียมจ่ายและใบสำคัญจ่าย

เมนูนี้เห็นเมื่อทีมงานมั่งมีเปิดให้ร้านและบัญชีของคุณมีสิทธิ์

1. “ค่าใช้จ่ายและใบเสร็จ” → “ใบเตรียมจ่าย/ใบสำคัญจ่าย” → “สร้างใบเตรียมจ่าย” (หรือเริ่มจากหน้ารายจ่ายใบเดียว)
2. เลือกผู้รับเงิน แล้วเลือกรายจ่ายที่ยืนยันแล้วและยังค้างจ่าย กด “บันทึกร่าง”
3. กด “ส่งอนุมัติ” แล้วเลือกคนอนุมัติ ถ้าคุณอนุมัติเองได้เลือก “ฉันอนุมัติเลย” (ร้านที่มีผู้อนุมัติคนเดียวปุ่มจะเป็น “ส่งและอนุมัติ”)
4. ผู้อนุมัติเปิดใบ ตรวจผู้รับเงินและรายการ แล้วกด “อนุมัติ” หรือ “ส่งกลับให้แก้” พร้อมเหตุผล ผู้จัดทำใช้ “กลับไปแก้” ได้เอง ร่างที่ไม่เคยส่งใช้ “ลบร่าง”
5. ใบจะอยู่สถานะ “รอจ่าย” (อนุมัติแล้ว ยังไม่ได้บันทึกจ่าย) จ่ายเงินจริง แล้วเปิดใบ ตรวจยอด วันที่ วิธีจ่าย แนบ “หลักฐานการจ่าย” ถ้ามี กด “บันทึกว่าจ่ายแล้ว”
6. ระบบออก **ใบสำคัญจ่าย** เลขที่เดิม พิมพ์หรือดาวน์โหลดได้จากหน้าใบ
7. ถ้าจ่ายตรงไปแล้วโดยไม่มีใบเตรียมจ่าย ที่รายการจ่ายในหน้ารายจ่าย กด “ออกใบสำคัญจ่าย”

### 6.7 ออกหนังสือรับรอง 50 ทวิ และแบบ ภ.ง.ด.3 / ภ.ง.ด.53

**หนังสือรับรอง 50 ทวิ**
1. บันทึกจ่ายของรายจ่ายที่หักภาษี ณ ที่จ่ายให้เสร็จก่อน (ข้อ 6.4 ขั้น 9) โดยเลือก “จ่ายค่าอะไร” ให้ตรงประเภทเงินได้
2. เปิด “ค่าใช้จ่ายและใบเสร็จ” → “หนังสือรับรอง 50 ทวิ” เลือก “เดือนที่จ่าย” จะเห็นรายการพร้อมสถานะ “พร้อมออก” “ยังไม่ออก” “ออกแล้ว” “ทำนอกระบบ” “ยกเลิกแล้ว”
3. **ร้านทุกแพ็ก (ทำใบนอกระบบ)**: ทำใบจากแบบฟอร์มกรมสรรพากรหรือโปรแกรมอื่น แล้วกด “จดเลขที่ใบ” ใส่เลขที่และวันที่ แนบรูปหรือ PDF
4. **ร้านแพ็กธุรกิจ (ออกในระบบ)**: ตรวจผู้รับเงิน เลขผู้เสียภาษี ที่อยู่ (กด “เพิ่มที่อยู่” ถ้าขาด) แล้วออกหนังสือรับรอง จะขึ้น “ออกหนังสือรับรองเลขที่ … แล้ว” กด “ดาวน์โหลด” ต้องการอีกชุดใช้ “พิมพ์ใบแทน (เลขที่เดิม)”
5. ถ้าขึ้น “รอข้อมูลร้าน” หรือ “ข้อมูลร้านยังขาด: …” กด “กรอกข้อมูลร้าน” ไปเติมที่ข้อ 6.2 ก่อน

**ภ.ง.ด.3 / ภ.ง.ด.53 (แพ็กธุรกิจ)**
6. เมนูซ้าย “ภาษีหัก ณ ที่จ่าย” เลือก “เดือนที่จ่าย” แล้วกด “ดึงรายการล่าสุด”
7. ดูการ์ดของแต่ละแบบ: ภ.ง.ด.3 (จ่ายให้บุคคล) และ ภ.ง.ด.53 (จ่ายให้บริษัท) พร้อมจำนวนรายการ ยอดจ่าย ภาษีที่หักไว้ และ “กำหนดยื่น”
8. แก้ทุกรายการในแท็บ “ต้องแก้ก่อนยื่น” โดยกด “เปิดรายจ่าย” “เปิดคู่ค้า” หรือ “ตั้งค่าร้าน › ข้อมูลร้าน / สาขา” ตามที่แจ้ง (เช่น ไม่มีชื่อผู้รับเงิน ยังไม่มีรหัสสาขาภาษี) รายการ “ควรตรวจก่อนยื่น” ให้ตรวจแล้วยืนยัน
9. กด “ดาวน์โหลดแบบ ภ.ง.ด.3” หรือ “ดาวน์โหลดแบบ ภ.ง.ด.53” นำไปยื่นกับกรมสรรพากร
10. ยื่นแล้วกลับมากด “บันทึกว่ายื่นแล้ว” สถานะเปลี่ยนเป็น “ยื่นแล้ว” และดาวน์โหลด “แบบที่ยื่น” ย้อนหลังได้ รายการที่เพิ่มหลังจากนั้นจะเป็น “ยื่นเพิ่มเติมครั้งที่ …”
11. รายการที่ระบบแจ้ง “ต้องจัดทำ ภ.ง.ด.2 แยก” หรือ “ให้ผู้ทำบัญชีจัดทำแบบ” ให้ส่งผู้ทำบัญชี

### 6.8 ส่งออกเอกสารให้สำนักงานบัญชีทุกเดือน

1. “ค่าใช้จ่ายและใบเสร็จ” → “หลักฐานทางบัญชี”
2. เลือกเดือน (เริ่มที่เดือนปัจจุบัน เลือก “ทุกเดือน” ได้)
3. กดแท็บ “ต้องแก้” แล้วกดแต่ละแถวไปที่ “สิ่งที่ต้องแก้”: “ไม่มีไฟล์” → แนบใบเสร็จหรือทำใบรับรองแทนใบเสร็จ; “หลักฐานรายจ่ายรอตรวจ” → เปิดตรวจ; “ยังไม่จัดหมวด” → เลือกหมวดหมู่
4. เมื่อแท็บ “ครบแล้ว” มีทุกรายการ กด “ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี” จะได้สารบัญและไฟล์หลักฐานในชุดเดียว (ชุดใหญ่ระบบแบ่งหลายส่วนให้)
5. ต้องการเฉพาะตาราง: “เพิ่มเติม” หรือที่หน้า “รายการค่าใช้จ่าย” ใช้ “ส่งออก Excel ให้สำนักงานบัญชี” เลือก “รูปแบบไฟล์”: “Excel สำหรับสำนักงานบัญชี” หรือ “ไฟล์แยกตามหมวด” (สำหรับส่งเข้าโปรแกรมบัญชี)
6. ส่งไฟล์ให้สำนักงานบัญชี ระบบส่งออกเฉพาะรายการที่ยืนยันแล้ว ถ้าขึ้น “ช่วงนี้ยังไม่มีรายการที่ยืนยันแล้ว” ให้ยืนยันเอกสารก่อน

### 6.9 ดูภาพรวมและรายงาน

1. “หน้าแรก”: เลือกช่วง “วันนี้” “สัปดาห์นี้” “เดือนนี้” “ไตรมาสนี้” หรือ “เลือกวันที่” (ตั้งแต่–ถึง) เพื่อดูยอดรายจ่ายและงานที่รอ เช่น ใบเสร็จรอตรวจ เปลี่ยนสาขาจากตัวเลือกสาขาบนแถบบน กด “อัปเดตข้อมูล” ถ้าต้องการตัวเลขล่าสุด
2. “รายการค่าใช้จ่าย”: ยอดสรุปของช่วงที่เลือกอยู่ด้านบน กรองตามสถานะและค้นหาได้
3. “การเบิกจ่าย”: ตัวเลขใน “รอจ่าย” บอกยอดที่ต้องจ่ายคืน
4. “ภาษีหัก ณ ที่จ่าย” (แพ็กธุรกิจ): ยอดจ่ายและภาษีที่หักไว้รายเดือน
5. ถามเป็นภาษาพูดใน LINE ได้ เช่น ยอดรายจ่ายช่วงวันที่และสาขาที่ต้องการ (ข้อ 6.11)

เมนู “รายงานการเงิน” (งบทดลอง งบกำไรขาดทุน ฯลฯ) มีในโค้ดแต่ไม่อยู่ในแพ็กที่ขาย (หัวข้อ 12)

### 6.10 ซื้อ เปลี่ยน ต่ออายุ และหยุดต่ออายุแพ็กเกจ

**ซื้อครั้งแรก** (เจ้าของกิจการหรือผู้มีสิทธิ์จัดการแพ็กเกจ)
1. เมนูซ้าย “แพ็กเกจ” จะเห็น “สถานะแพ็กเกจ” และหัวข้อ “เลือกแพ็กเกจเพื่อเริ่มใช้งาน”
2. สลับ “รายเดือน” / “รายปี” แล้วกดเลือกแพ็กเกจ (เริ่มต้น เติบโต มืออาชีพ ธุรกิจ) การ์ดบอกราคา จำนวนใบเสร็จ สาขา ผู้ใช้ และเมนูที่ได้
3. ถ้ามี “ส่วนลดจากงาน” หรือโปรโมชั่น จะมีให้เลือกใช้กับการจ่ายครั้งนี้
4. ตรวจ “ข้อมูลออกเอกสาร” (“ออกใบเสร็จในชื่อ” และ “อีเมลรับเอกสาร”) แก้ได้ที่ “แก้ไขข้อมูลร้าน” หรือ “แก้อีเมลรับเอกสาร”
5. ขั้น “วิธีจ่าย”: เลือกตัดบัตรอัตโนมัติ หรือบิลพร้อมเพย์ (QR) แล้วติ๊กยอมรับการต่ออายุ (ถ้าไม่ติ๊กจะขึ้น “ติ๊กยอมรับการต่ออายุก่อน”)
6. กด “จ่าย …” ระบบพาไปหน้าจ่ายเงินของผู้ให้บริการรับเงิน จ่ายเสร็จจะกลับมาที่หน้าแพ็กเกจ เห็น “จ่ายแล้ว” และ “ดูใบเสร็จรับเงิน”
7. ถ้าขึ้น “ยังยืนยันผลไม่ได้” กด “ตรวจสถานะล่าสุด” / “อัปเดตข้อมูล” ถ้าหน้าจ่ายเงินหมดอายุกด “จ่ายอีกครั้ง” หรือ “เปลี่ยนวิธีจ่าย” มีปัญหาให้แจ้ง “เลขอ้างอิงสำหรับแจ้งทีมงาน”

**เปลี่ยนแพ็กเกจ**
8. “แพ็กเกจ” → “เปลี่ยนแพ็กเกจ” เพิ่มระดับ: จ่าย “ส่วนต่างแพ็กเกจ” แล้วมีผลทันทีโดยใช้วันหมดอายุเดิม ลดระดับ: ใช้ “เปลี่ยนแพ็กเกจรอบถัดไป” มีผลเมื่อจบรอบที่จ่ายไว้ (ยกเลิกได้ด้วย “ยกเลิกการเปลี่ยนแพ็กเกจ”) ถ้าสาขาหรือผู้ใช้เกินโควตาของแพ็กใหม่ ระบบให้เลือกสาขาและผู้ใช้ที่จะใช้ต่อ

**ต่ออายุ / หยุดต่ออายุ (ยกเลิก)**
9. แท็บ “การต่ออายุและจ่ายเงิน” แสดง “ต่ออายุอัตโนมัติวันที่ …” หรือ “ระบบจะออกบิล QR วันที่ …”
10. หยุด: กด “หยุดต่ออายุ” (บัตร) หรือ “หยุดออกบิล” (พร้อมเพย์) ยืนยันใน dialog “หยุดต่ออายุอัตโนมัติ?” / “หยุดออกบิลพร้อมเพย์ทุกงวด?” แพ็กเกจยังใช้ได้ถึงวันสิ้นรอบที่จ่ายไว้ เปิดกลับด้วย “กลับมาต่ออายุ”
11. จ่ายต่ออายุไม่สำเร็จ: มีระยะผ่อนผัน 7 วัน แก้บัตรที่ “เปลี่ยนวิธีจ่าย” หรือจ่ายบิลที่ขึ้น “มีบิลต่ออายุรอจ่าย”
12. ขอคืนเงิน: ไม่มีปุ่มบนเว็บ ให้ติดต่อทีมงานมั่งมี (พิมพ์ “ติดต่อเจ้าหน้าที่” ใน LINE)

**หมดอายุหรือยังไม่มีแพ็กเกจ**: เมนูจะเหลือ “ตั้งค่าร้าน” และ “แพ็กเกจ” ข้อมูลยังเก็บอยู่ เลือกแพ็กเกจที่หัวข้อ “เลือกแพ็กเกจเพื่อใช้งานต่อ”

**Add-on (เครดิตแชต AI และจำนวนอ่านใบเสร็จเพิ่ม)**: แค็ตตาล็อกมี 6 รายการ (3.1) แต่ **ไม่พบหน้าจอให้ร้านกดซื้อ add-on เองใน `apps/web`** หน้า “แพ็กเกจ” บอกจำนวนใบเสร็จที่เหลือและเครดิตที่มากับแพ็ก ส่วนการเพิ่มใบเสร็จ/เครดิตทำได้โดยซื้อแพ็กเดิมซ้ำ (ได้สิทธิ์อ่านเพิ่มและต่อเวลา) หรือทีมงานเพิ่มให้จากคอนโซล (4.6.2 “ใบเสร็จที่ผู้ดูแลเพิ่มให้”) — ดูหัวข้อ 13

### 6.11 ใช้ LINE ส่งใบเสร็จและถามคำถาม

ผู้ช่วย LINE (“น้องมั่งมี”) ทำงานนอกเว็บ (`apps/ai-gateway` + `apps/api` โมดูล `line-ai`) ส่วนนี้สรุปเฉพาะสิ่งที่ผู้ใช้ทำและจุดที่ต่อกับเว็บ ตามคำตอบในคู่มือ “เริ่มใช้งานร้านและ LINE”

1. **เชื่อมบัญชี**: ให้ผู้มีสิทธิ์จัดการพนักงานส่งลิงก์เชื่อม LINE (ข้อ 6.3) แล้วเปิดด้วย LINE ของคุณเอง
2. **เลือกร้าน**: พิมพ์ “เปลี่ยนบริษัท” แล้วเลือกร้าน ดูชื่อร้านให้ตรงก่อนส่งเอกสาร
3. **ส่งใบเสร็จ**: ส่งรูปใบเสร็จชัด ๆ ในแชต ถ้ามีหลายสาขาให้เลือกสาขาก่อน รอน้องมั่งมีอ่าน แล้วตรวจข้อมูลบนการ์ด การส่งรูปเป็นการเตรียม **ร่าง** การยืนยันเอกสารและบันทึกจ่ายยังต้องกดเอง
4. **หลายใบ**: ส่งรูปทีละใบให้เห็นชัด ตอบคำถามเรื่องรูปตามเอกสารจริง ตรวจจำนวนรายการกับยอดก่อนยืนยัน
5. **ถามยอด**: พิมพ์ถามยอดรายจ่าย บอกช่วงวันที่และสาขา คำตอบเป็นไปตามสิทธิ์ของคุณ
6. **ทำใบเบิก**: บอกรายการ ยอด หลักฐาน และวิธีรับเงินคืน ตรวจการ์ดร่าง แล้วกดยืนยันส่งอนุมัติ (ลิงก์ร่างเปิดหน้า “ตรวจร่างใบเบิก” บนเว็บได้)
7. **เปิดเว็บ**: พิมพ์ “เปลี่ยนบริษัท” แล้วกด “เปิดเว็บบริษัทนี้” ลิงก์นี้เป็นของคุณคนเดียว เข้าเว็บได้โดยไม่ต้องกรอกรหัสผ่าน
8. **แพ็กเกจ**: กด “แพ็กเกจและราคา” ในเมนูด้านล่าง หรือพิมพ์ “โปรโมชั่น”
9. **เปิดร้านเพิ่ม**: เจ้าของกิจการพิมพ์ “เปลี่ยนบริษัท” แล้วกด “เปิดร้านใหม่”
10. **ขอความช่วยเหลือ**: พิมพ์ “ติดต่อเจ้าหน้าที่” บอกชื่อร้านและเรื่องที่ต้องการ อย่าส่งรหัสผ่านหรือรหัสยืนยัน

### 6.12 งานของผู้ดูแลแพลตฟอร์ม (ทีมงานมั่งมี)

| งาน | ทำที่ไหน | ขั้นตอนย่อ |
|---|---|---|
| อนุมัติคำขอสมัคร | `/system/signup-requests` “คำขอสมัครใช้งาน” | เปิดคิว → ตรวจข้อมูล → อนุมัติหรือปฏิเสธ (dialog “ปฏิเสธคำขอสมัครใช้งาน”) → ถ้าอีเมลไม่ถึงออกลิงก์รับบัญชีใหม่ / ดู “ประวัติอีเมลรับบัญชี” |
| เปิดร้านให้ลูกค้าเอง | `/system/company-onboardings/new` | กรอกข้อมูลร้านและเจ้าของ → ยืนยัน |
| ดูแลร้าน | `/system/partners` → กดร้าน | ดูสถานะ, ปรับแพ็กเกจ/วันหมดอายุ (ต้องใส่เหตุผล), เปิด-ปิดฟีเจอร์, เปิดเมนู “บันทึกด้วยมือบนเว็บ” และ “ใบเตรียมจ่าย”, จัดการสมาชิก (รีเซ็ตรหัสผ่าน ออกลิงก์เชื่อม LINE ยกเลิกเชื่อม LINE), ตั้งสถานะ VAT, เครดิต AI, ส่งข้อความ LINE ถึงร้าน, จดโน้ตทีม |
| ตอบคำขอความช่วยเหลือ | `/system/support-requests` “คำขอคุยกับเจ้าหน้าที่” | ดู badge จำนวนที่รอ → เปิดเธรด → ตอบ → กด “ตอบแล้ว” หรือ “ให้ AI ทำงานต่อ” |
| เรื่องการชำระเงิน | `/system/billing` | ค้นหาบริษัท → ดูภาพรวม/รายการชำระเงิน/ประวัติ → แก้ปัญหาในคิว “รายการปัญหา” → เพิ่มวันใช้งานหรือใบเสร็จ, คืนเงิน, เปลี่ยนอีเมลผู้รับเอกสาร, เปิดแพ็กเกจจากยอดที่จ่ายแล้ว (ทุกคำสั่งเป็น ตรวจผลกระทบ → ยืนยัน/อนุมัติ) |
| ตั้งราคาและโปรโมชั่น | `/system/billing/settings`, `/system/billing/campaigns` | แก้เงื่อนไขข้อเสนอ → ตรวจรายการที่ได้รับผลกระทบ → อนุมัติ; สร้างแคมเปญ → เผยแพร่ → ดูรายงาน |
| ตรวจยอดกับ Stripe | `/system/billing/settlements`, `/provider-events`, `/provider-scans`, `/configuration-checks` | เลือกช่วง → ดูรายการ “ต้องตรวจแยก” → เริ่มงานตรวจ |
| ทีมขาย | `/system/sales-team`, `/system/demo-links` | เพิ่มบัญชีทีมขาย, ตั้งรหัสผ่าน, ส่งออก CSV, จัดการลิงก์เดโม่ |
| คำขอ PDPA | `/system/data-rights` | เปิดเคส → ทำตามขั้น → “สรุปผลและปิดเคส” |
| ตั้งค่าระบบ | `/system/line-settings`, `/system/ai-budget`, `/system/wht-income-categories`, `/system/home-theme`, `/system/email-delivery`, `/system/platform-access` | ตั้ง credential LINE กลาง, เพดานค่า AI, เปิด-ปิดประเภทเงินได้หัก ณ ที่จ่าย, ธีมหน้าแรก, ดูสถานะอีเมล, เปิด–ปิดบริการทั้งระบบ |
| รายงานผู้บริหาร | `/system/executive`, `/system/executive-users` | ดูภาพรวม/รายได้/ลูกค้า/การใช้งาน → เจาะรายชื่อร้าน → ส่งออก Excel; เพิ่มบัญชีผู้บริหาร |

---

## 7. สรุปคู่มือในแอปและ help pack ที่มีใน repo

### 7.1 คู่มือในแอป (`apps/web/src/features/user-guide/`)

คู่มือเขียนเป็นข้อมูล ไม่ใช่ markup: ทุกหน้าใช้ `UserGuidePage.tsx` render โครง `UserGuide { key, title, eyebrow, description, primaryLink, sections[] }` โดย section ประกอบจาก block 5 ชนิดเท่านั้น — `items` (หัวข้อ+รายละเอียด+ลิงก์), `steps`, `table`, `note` (`info|warn`), `faq` (`user-guide.model.ts`) เนื้อหาเปิดให้ทุกสมาชิก ส่วนปุ่มลัดเข้าหน้าจอแสดงตามสิทธิ์ของผู้อ่าน ข้อความมาตรฐาน: `GUIDE_PERMISSION_REQUEST` ("ใช้ตารางนี้บอกเจ้าของกิจการว่าต้องการสิทธิ์ใดเพิ่ม") และ `GUIDE_MISSING_MENU_HELP`

| ไฟล์ | ชื่อคู่มือ | อยู่ในเมนู | เนื้อหา (section id) |
|---|---|---|---|
| `getting-started-guide.content.ts` | เริ่มใช้งานร้านและ LINE | ใช่ | FAQ 52 ข้อใน 16 กลุ่ม (`GROUPS`): เริ่มใช้งานและเปิดร้าน, สาขา, พนักงาน, หน้าที่และสิทธิ์, แพ็กเกจและข้อมูล, ใช้งาน LINE, ค่าใช้จ่ายและหลักฐาน, บันทึกการจ่าย, ใบเบิกและบัญชีรับเงินคืน, ใบเตรียมจ่ายและใบสำคัญจ่าย, ใบรับรองแทนใบเสร็จ, หนังสือรับรอง 50 ทวิ, รายงาน, หน้าแรก, การแจ้งเตือน, ลายเซ็นของฉัน (กลุ่มที่ไม่มีข้อใดผ่านตัวกรองจะไม่แสดง) — แต่ละข้อกรองด้วย `permissions` และ `features` ของผู้อ่าน |
| `expenses-guide.content.ts` | ค่าใช้จ่ายและใบเสร็จ | ใช่ | `overview` (ขั้นงาน 5 ขั้น: นำเข้าระบบ → ระบบสร้างเป็นร่าง → ตรวจความครบถ้วน → ยืนยันเอกสาร → ส่งให้สำนักงานบัญชี; ตารางสถานะเอกสาร; สถานะเอกสารแยกจากการจ่าย), `submenus`, `list`, `detail` (ตรวจร่าง 3 ขั้น, แก้ไข/ยกเลิก, บันทึกจ่าย), `upload`, `manual`, `categories`, `evidence` |
| `disbursement-voucher-guide.content.ts` | (ต่อท้ายคู่มือค่าใช้จ่ายเมื่อร้านเปิด) ใบเตรียมจ่าย/ใบสำคัญจ่าย | ตามค่าตั้งร้าน | ทำคนเดียว/สองคน, กลับไปแก้, ลบร่าง, แจ้งเตือน, รอจ่าย, ออกใบสำคัญจ่ายจากการจ่ายตรง, ตารางชุดสิทธิ์ 5 ชุด |
| `expenses-guide-manual-entry.ts` | (ตัวปรับ) | — | ถ้าร้านไม่เปิดเมนูบันทึกด้วยมือ: ตัดปุ่มลัดและเปลี่ยนข้อความของ section `manual` (ทำกับผลลัพธ์ ไม่แก้ไฟล์ต้นทางที่ถูกตรึง hash) |
| `substitute-receipt-guide.content.ts` | ใบรับรองแทนใบเสร็จ | ใช่ | `overview`, `when` (ใช้/ไม่ควรใช้เมื่อใด, ข้อจำกัดทางภาษี), `list` (สถานะ 4 แบบ), `steps` (4 ขั้น), `select`, `form`, `evidence` (หลักฐาน 2 ประเภท), `sign` (ในระบบ/บนกระดาษ), `pdf`, `settings`, `permissions` |
| `reimbursement-guide.content.ts` | การเบิกจ่าย | ใช่ | `quick-start` (ตามบทบาท), `tabs`, `list`, `flow`, `status`, `create`, `payout`, `submit`, `approve`, `pay`, `account-number` (ใครเห็นเลขบัญชีเต็ม), `account-fix`, `finance`, `voucher` (ใบเบิก ลายเซ็น ปิดงาน), `stuck`, `notify`, `old-claims` และอื่น ๆ (ไฟล์ใหญ่ที่สุด ~147 KB) |
| `tax-guide.content.ts` | ภาษี | **ไม่** (ซ่อน 2026-08-10) | `overview`, `vat`, `wht` (รวม 50 ทวิ และภาษีหัก ณ ที่จ่าย), `cit`, `permissions`, `faq` |
| `reports-guide.content.ts` | รายงานการเงิน | **ไม่** (ซ่อน 2026-08-10) | `overview`, `catalog`, `run`, `views`, `permissions`, `faq` |

Spec ที่คุมเนื้อหา: `user-guide.content.spec.ts` (~82 KB), `expenses-guide-manual-entry.spec.ts`, `disbursement-voucher-guide.content.spec.ts`

### 7.2 Help pack ของผู้ช่วย LINE (อ้างคู่มือด้วย hash)

- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts` นิยาม `PRODUCT_HELP_PACK` (`id: 'mangmee-product-help'`, `status: 'APPROVED'`) การ์ดความรู้แต่ละใบ (`card(id, guide, anchor, title, questions[], body, permissionAnyOf, requiredCapabilities)`) ชี้ `sourceURL` ไปที่ `/companies/{companyId}/user-guide/<guide>#<anchor>` และเก็บ `sourceFile` + `sourceHash` (SHA-256) ของไฟล์คู่มือฝั่งเว็บ 6 ไฟล์ (`tax`, `disbursement-vouchers`, `expenses`, `reimbursements`, `substitute-receipts`, `reports`) มีการ์ดผูกไฟล์คู่มือ 16 ใบในไฟล์นี้ และการ์ดเพิ่มจาก `product-help-draft-cards.ts`
- บันทึกการอนุมัติ: `docs/agent-memory/line-help-cards-review-2026-10-20.md` — ชุด v6 รวม 68 การ์ด (12 เดิม + 4 ร่างเดิม + 52 ใหม่) เจ้าของอนุมัติ 2026-10-21
- **ผลต่อการแก้คู่มือ**: แก้ข้อความในไฟล์คู่มือ = hash เปลี่ยน = ต้อง re-pin และทบทวนการ์ด (`scripts/local-proof/repin.sh` ขั้น "guide fingerprints (LINE help pack)"; ทดสอบ `approved-knowledge.spec.ts`)
- หน้าแรกสาธารณะใช้สำเนาที่อนุมัติแล้ว: `apps/web/src/features/public-home/home-help-v6.json` (`sourcePackHash` + `cards`) ผ่าน `home-wiki.ts` เพื่อให้บริการ `/llms.txt` และ `/llms-full.txt`; FAQ หน้าแรก 21 ข้ออยู่ใน `home-faq.json`; spec `home-help-v6.spec.ts`

### 7.3 เอกสารประกอบอื่นใน repo

- `e2e/TEST-CASES.md`, `e2e/RESULTS.md`, `e2e/RESPONSIVE-RESULTS.md`, `e2e/RESPONSIVE-RESULTS-2026-08.md` — กรณีทดสอบและผลตรวจ responsive
- `docs/agent-memory/manual-test-playbook-2026-08-10.md` — ลำดับทดสอบด้วยมือ
- ไม่พบไฟล์คู่มือผู้ใช้แบบ PDF/Word หรือโฟลเดอร์ `docs/user-guide` ใน repo; คู่มือผู้ใช้ที่เป็นทางการมีเฉพาะในแอป (7.1)

---

## 8. แค็ตตาล็อก dialog สถานะว่าง ข้อผิดพลาด และการแจ้งเตือน

รวบรวมเฉพาะส่วนที่ **รวมศูนย์ในโค้ด** ข้อความเฉพาะหน้าจำนวนมากอยู่ใน `workspace-dictionary.ts` (กลุ่ม `expenses.*` ฯลฯ) และใน component ของแต่ละฟีเจอร์

### 8.1 Dialog มาตรฐาน

| Dialog | ที่มา | ข้อความ / ปุ่ม | พฤติกรรม |
|---|---|---|---|
| ยืนยันการกระทำ | `useConfirm` (`modal/use-confirm.tsx`) | ผู้เรียกกำหนด `title` (ชื่อสิ่งที่ทำ), `message` (ผลหนึ่งประโยค), `confirmLabel`, `cancelLabel`; ค่าเริ่มต้น `ยืนยัน` / `ปิด` | แทน `window.confirm`; ปุ่มถอยออกมาก่อน ปุ่มทำอยู่ท้าย กว้างเท่ากัน |
| แจ้งข้อความเดียว | `AlertModal` | ข้อความ + ปุ่ม `ปิด` | แทน `window.alert` |
| ถามข้อความ | `useInputPrompt` | ช่องกรอก + ปุ่มยืนยัน/ปิด | แทน `window.prompt` (เช่น เหตุผลการยกเลิก) |
| ปิด dialog ที่พิมพ์ค้าง | `Modal` prop `dirty` | "ยังไม่ได้บันทึกสิ่งที่พิมพ์ไว้" ปุ่ม `พิมพ์ต่อ` · `ปิดโดยไม่บันทึก` | กด backdrop ไม่ปิด; ✕/Escape ถามก่อน; focus อยู่ที่ `พิมพ์ต่อ` |
| ออกจากหน้าที่ยังไม่บันทึก | `useUnsavedNavigation` | "ยังไม่ได้บันทึกใบนี้" / "ถ้าออกตอนนี้ รายการที่เลือกไว้จะหาย" ปุ่ม `อยู่ต่อ` · `ไม่บันทึกและออก` · `บันทึกร่างและออก` | กันลิงก์ในแอป, ปุ่ม Back, ปิดแท็บ |
| ออกจากระบบ | เมนูผู้ใช้ | "ยืนยันออกจากระบบใช่หรือไม่?" → "กำลังออกจากระบบ..." / "ออกจากระบบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง" (`shell.signout*`) | — |
| ดูเอกสาร | `DocumentPreviewModal` | ดูรูป/PDF, ดาวน์โหลด, พิมพ์ | `printSurface`: พิมพ์เฉพาะเนื้อ modal |
| สิทธิ์ตามสาขา (403) | dictionary (หัวเรื่องใช้ `error.forbidden`) | "คุณไม่มีสิทธิ์ทำรายการนี้" + เนื้อความขอบเขตสาขา | — |

ตัวอย่าง dialog เฉพาะงานที่ยืนยันจากโค้ด: ปิดใช้งานพนักงาน (`ไม่ปิด` · `ปิด`), ลบร่างพนักงาน (`ไม่ลบ` · `ลบร่างพนักงาน`), เปลี่ยนบทบาท (`ไม่เปลี่ยน` · `เปลี่ยนบทบาท`), ปิดใช้งานบทบาท, "หยุดต่ออายุอัตโนมัติ?", "หยุดออกบิลพร้อมเพย์ทุกงวด?", รวมบัญชี LINE, ส่งกลับให้แก้ใบเตรียมจ่าย, ปฏิเสธคำขอสมัครใช้งาน, เพิกถอนส่วนลด

### 8.2 สถานะมาตรฐาน (`common/components/state`)

| สถานะ | Component | ข้อความเริ่มต้น (th) |
|---|---|---|
| กำลังโหลดหน้า | `LoadingState` (`app/loading.tsx`) | "กำลังเปิดหน้า..." ; dictionary `state.loading` = "กำลังโหลด..." |
| เปลือกร้านกำลังเปิด | `WorkspaceLayout` | "กำลังเปิดหน้า…" , "กำลังพาไปหน้าที่ใช้ได้…" , ชื่อร้าน placeholder "กำลังโหลด…" |
| รอ API ในขอบเขต | `CoverLoader` | label จากผู้เรียก (spinner มี `role="status"` `aria-busy`) |
| ว่าง | `EmptyState` | "ไม่มีข้อมูล" / "ยังไม่มีรายการในที่นี้" (หน้าเฉพาะแทนด้วยข้อความของตัวเอง เช่น "ยังไม่มีสาขา", "ไม่มีการแจ้งเตือน", "ไม่มีรายการที่ต้องออกหนังสือรับรอง", "เดือนนี้ไม่มีรายการ", "ช่วงนี้ยังไม่มีรายการที่ยืนยันแล้ว") |
| ผิดพลาด | `ErrorState` | "โหลดไม่สำเร็จ" + ปุ่ม "ลองอีกครั้ง" + "รหัสคำขอ: …" |
| ไม่มีสิทธิ์ | `ForbiddenState` | "ไม่มีสิทธิ์เข้าถึง" / "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" / "แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทให้ตรวจสิทธิ์…" ; OWNER: "เพิ่มสิทธิ์ได้ที่ พนักงานและสิทธิ์" |
| แพ็กไม่มีหน้านี้ | `ForbiddenState` (`packageAvailable === false`) | "แพ็กเกจของร้านยังไม่มีหน้านี้" |
| เข้าร้านไม่ได้ | `CompanyAccessUnavailable` | บอกชื่อบัญชีที่ล็อกอินและชื่อร้าน (เช่น ลิงก์เปิดในเบราว์เซอร์ที่ล็อกอินบัญชีอื่น) |
| เข้าคอนโซลไม่ได้ | `SystemAccessDenied` | แยกข้อความสำหรับผู้บริหาร |
| หน้า error ของ route | `app/error.tsx` | "เปิดหน้านี้ไม่ได้" / "ระบบขัดข้องชั่วคราว ปัญหาอยู่ที่ระบบของเรา" ปุ่ม `ออกจากระบบ` · `กลับไปหน้าแรก` · `ลองอีกครั้ง` |
| error ระดับราก | `app/global-error.tsx` | "ระบบขัดข้องชั่วคราว" + เบอร์ทีมงาน + `ลองอีกครั้ง` |
| ไม่พบหน้า | `app/not-found.tsx` | "ไม่พบหน้านี้" / "ลิงก์อาจไม่ครบ หรือหน้านี้ถูกย้ายแล้ว" + `กลับไปหน้าแรก` |
| เบราว์เซอร์เก่า | `GenericClientNotice` (`device`) | "เปิด Mangmee Plus บนเครื่องนี้ไม่ได้" / "อัปเดตระบบปฏิบัติการ เบราว์เซอร์ และ LINE เป็นเวอร์ชันล่าสุด…" (ไทย+อังกฤษ) |
| บริการเราขัดข้อง | `GenericClientNotice` (`service`) | "ยังเปิดมั่งมีไม่ได้" / "ปัญหาอยู่ที่ระบบของเรา ไม่ใช่ที่เครื่องของคุณ…" ปุ่ม `ลองอีกครั้ง` · `โทร 098-256-5628` |
| ปิดบริการ | `/maintenance` | "ระบบกำลังปรับปรุง" |
| โมดูลยังไม่เปิด | `PlannedModulePage` | ป้าย "เร็วๆ นี้" (`module.status.planned`) |
| ข้อมูลตัวอย่าง | `PrototypeDataNotice` | ป้ายเตือนของหน้าต้นแบบ (CRM ฯลฯ) |

### 8.3 ข้อความข้อผิดพลาด

**ชั้นที่ 1 — แปลข้อผิดพลาดจาก API** (`src/common/api/api-error-message.ts`, 1,837 บรรทัด): `apiErrorMessage(e, locale)` → ข้อความสำหรับลูกค้า โดยลำดับ: รหัสเฉพาะที่ส่งประโยคไทยจากเซิร์ฟเวอร์ผ่านได้ → `CODE_LABELS` (ประมาณ 1,040 รหัส) → `MESSAGE_LABELS` (137 ข้อความอังกฤษที่รู้จัก) → `MESSAGE_PATTERNS` (regex) → `KIND_LABELS` → `STATUS_LABELS` → ค่าสำรอง ข้อความดิบจาก API ไม่ถูกแสดง (fail closed) กลุ่มรหัสตามคำนำหน้า (จำนวนโดยประมาณ): `expense*` 128, `billing*` 70, `reimbursement*` 65, `wht*`/`WHT_*` 60, `control*` 53, `invalid*` 46, `substitute*` 45, `line*` 34, `sales*` 30, `partner*` 29, `email*` 23, `company*` 20, `customer*` 19, `payout*` 18, `claim*` 15, `payment*` 14, `PND3_FILING_*` 13, `PND53_FILING_*` 13, `entitlement*` 13, `account*` 12, `support*` 11 และอื่น ๆ

ข้อความสำรองตามสถานะ HTTP (`STATUS_LABELS`):

| สถานะ | ข้อความ |
|---|---|
| 400 / 422 | ทำรายการต่อไม่ได้ ตรวจข้อมูลที่กรอกและเงื่อนไขของรายการ แล้วลองอีกครั้ง |
| 401 | การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่ |
| 403 | (ข้อความของรหัส `insufficient_permissions`) |
| 404 | ไม่พบข้อมูลที่ต้องการ |
| 409 | รายการนี้ทำต่อไม่ได้ในสถานะปัจจุบัน เปิดหน้านี้ใหม่แล้วตรวจอีกครั้ง |
| 413 | ไฟล์หรือข้อมูลที่ส่งมีขนาดใหญ่เกินไป ลดขนาดแล้วลองอีกครั้ง |
| 429 | ทำรายการถี่เกินไป รอสักครู่แล้วลองอีกครั้ง |
| 500 | ระบบขัดข้องชั่วคราว ลองอีกครั้ง |
| 502 | เชื่อมต่อระบบไม่ได้ชั่วคราว ลองอีกครั้ง |
| 503 | บริการที่จำเป็นยังไม่พร้อมใช้งาน ลองอีกครั้งภายหลัง … |
| 504 | ระบบตอบช้าเกินไป ลองอีกครั้ง |
| network | เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง |
| อื่น ๆ | ทำรายการไม่สำเร็จ ลองอีกครั้ง / ทำรายการไม่สำเร็จ ตรวจข้อมูลแล้วลองอีกครั้ง |

ตัวอย่างรหัสเฉพาะที่สำคัญต่อแพ็กที่ขาย: `PND3_FILING_*` / `PND53_FILING_*` (REVIEW, EMPTY, MONTH, OVERDUE, BRANCHES, BRANCH, PAYER, EVENT, PAYEE, CATEGORY, AMOUNT, KIND, SOURCE), `WHT_ESTABLISHMENT_*`, `WHT_PAYER_MODE_*`, `WHT_FILING_*`, `wht_certificate_income_unsupported`, `CONTENT_UNINSPECTABLE`, `EMBEDDED_FILE_REJECTED`, `duplicate_unresolved`, `duplicate_confirmed`, `plan_branch_limit_exceeded`, `accounting_period_locked:<period>`, `tax_period_locked:<form>:<period>`, `demo_*`, คำของใบเตรียมจ่าย (`DISBURSEMENT_VOUCHER_ERROR_WORDS`) และบัญชีรับเงินคืน (`REIMBURSEMENT_SAVED_PAYOUT_ERROR_WORDS`) จาก `packages/contracts`

**ชั้นที่ 2 — ข้อความตามสถานะแบบสองภาษา** (`src/common/i18n/error-message.logic.ts` → dictionary `error.*`): `error.network` "เชื่อมต่อไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง", `error.server` "ระบบขัดข้อง ลองอีกครั้งภายหลัง", `error.forbidden` "คุณไม่มีสิทธิ์ทำรายการนี้", `error.rate_limited` "ทำรายการบ่อยเกินไป รอสักครู่", `error.conflict` "ข้อมูลซ้ำกับที่มีอยู่ในระบบ", `error.validation` "ข้อมูลไม่ถูกต้อง ตรวจสอบและลองอีกครั้ง", `error.session_expired`, `error.load_failed` "โหลดข้อมูลไม่สำเร็จ", `error.save_failed` "บันทึกไม่สำเร็จ ลองอีกครั้ง" หน้าจอ override ได้ต่อสถานะ (เช่น 401 ของหน้า login = `auth.login.error.invalid`)

**ชั้นที่ 3 — ข้อความหน้า login** (`auth.login.error.*`): `failed`, `invalid`, `rate_limited`, `temp_expired`, `company_membership_disabled`, `company_access_unavailable`, `identifier_required`, `password_required`

ตัวเฝ้า: `api-error-coverage.spec.ts`, `api-error-message.spec.ts`, `no-raw-api-error-display.spec.ts`, `billing-error-text.spec.ts`

### 8.4 Toast และการแจ้งเตือน

**Toast** (`common/components/toast`, `common/feedback/toast-bus.ts`)

| คุณสมบัติ | ค่า |
|---|---|
| โทน | `success`, `warning`, `error` |
| ระยะเวลา | success 4,000 ms; warning 4,000 ms; error 6,000 ms |
| จำนวนสูงสุดที่แสดง | 3; ข้อความ+โทนซ้ำไม่แสดงซ้อน |
| action | ลิงก์ในแอปได้หนึ่งอัน (เช่น "· ดู") ใส่เฉพาะเมื่อผู้อ่านเปิดปลายทางได้ |
| ตำแหน่ง | มือถือ (<640 px): เหนือแถบปุ่มล่างที่วัดได้ + safe area; จอกว้าง: ใต้แถบบน กึ่งกลางคอลัมน์เนื้อหา |
| ที่มาอัตโนมัติ | `authedApiFetch` ยิง `emitApiErrorToast` เมื่อ API ผิดพลาด (ปิดได้ด้วย `suppressErrorToast`) |
| รูปแบบคำ | เสร็จ = กริยา + "แล้ว" (เช่น "บันทึกข้อมูลร้านแล้ว", "บันทึกสาขาแล้ว", "ออกหนังสือรับรองเลขที่ {number} แล้ว", "ดึงรายการล่าสุดแล้ว", "คัดลอกลิงก์แล้ว") |

**การแจ้งเตือนในแอป** (`features/dashboard-notifications`)

| มิติ | ค่า |
|---|---|
| ความสำคัญ (`NotificationSeverity`) | `critical` สำคัญ, `action` ต้องดำเนินการ, `insight` ข้อมูลเชิงลึก, `info` แจ้งเพื่อทราบ |
| สถานะ | `open`, `resolved`, `dismissed` |
| ช่องทาง | `web`, `line` |
| สรุปรวม | `none`, `daily`, `weekly` |
| สถานะการส่ง | ส่งแล้ว, ส่งไม่สำเร็จ, รอส่ง, ข้าม (+ "ลองใหม่") |
| การกระทำ | "ทำเครื่องหมายอ่านแล้ว", "อ่านทั้งหมด", "ปิด"; ว่าง = "ไม่มีการแจ้งเตือน" |
| การตั้งค่า | "ช่องทางการแจ้งเตือน", "ช่วงเวลาเงียบ" (ไม่ส่งการแจ้งเตือนภายนอกในช่วงที่ตั้ง) |

ประเภทเหตุการณ์ (`kind`) มาจาก API เป็น string เปิด ไม่มี enum ฝั่งเว็บ จึงไม่มีรายการรวมศูนย์ในเว็บ — รายการเหตุการณ์ดูเอกสารฝั่ง API

**ป้ายบนเปลือก**: จุดสีเหลือง "ตั้งค่าร้านยังไม่ครบ" + ป้าย "ยังไม่ครบ"; "เหลือ N วัน" ที่เมนูแพ็กเกจ; `PlanTermBanner` (เตือนใกล้หมดอายุ/หมดอายุ); `DemoSessionBanner` (เวลาหมดอายุของเดโม่); badge จำนวนคำขอความช่วยเหลือ (คอนโซลระบบ) และ "งานของฉัน" (คอนโซลทีมขาย)

---

## 9. Accessibility, responsive และเบราว์เซอร์ที่รองรับ

### 9.1 Accessibility ที่ทำไว้ในโค้ด

| เรื่อง | การทำ | หลักฐาน |
|---|---|---|
| ภาษาเอกสาร | `<html lang="th">` | `app/layout.tsx`, `app/global-error.tsx` |
| ข้ามไปเนื้อหา | ลิงก์ "ข้ามไปยังเนื้อหา" ในเปลือกร้าน | `WorkspaceShell.tsx` (`shell.skip_to_content`) |
| Dialog | `role="dialog"`, `aria-modal="true"`, ชื่อผูกด้วย `useId`, กับดัก Tab ภายใน, Escape ปิด, ล็อก scroll ของ body, คืน focus ให้ปุ่มที่เปิด (จำ pointerdown ด้วยเพราะเบราว์เซอร์สัมผัสไม่ focus ปุ่ม) | `Modal.tsx`, `use-dialog-focus.ts`, `use-body-scroll-lock.ts` |
| เมนูมือถือ | เนื้อหาหลังเมนูถูกตั้ง `inert` | `WorkspaceShell.tsx` |
| การนำทาง | `aria-current="page"` บนเมนูที่เปิดอยู่, `<nav aria-label>` | `SystemHeader.tsx`, `SalesHeader.tsx`, `AppSidebar.tsx` |
| สถานะสด | `role="status"` (กำลังโหลด), `role="alert"` + `aria-live` (ข้อผิดพลาด/ประกาศ), ปุ่มกำลังทำ `aria-busy` และกดซ้ำไม่ได้ | `CoverLoader`, `GenericClientNotice`, `Button` |
| ฟอร์ม | label ทุกช่อง, error/hint ผูก `aria-describedby`, ใช้ `<input type=radio|checkbox>` จริงใน `ChoiceRow`, เครื่องหมายบังคับ | `field/Field.tsx`, `field/ChoiceRow.tsx` |
| คีย์บอร์ด | `MoreActions` ใช้ `<details>`; `ThemedSelect`/`ThemedDate` ใช้งานด้วยคีย์บอร์ดได้; focus ring จาก token `shadow.focus` | `actions/MoreActions.tsx`, `globals.css` (`.mangmee-btn:focus-visible`) |
| ไม่พึ่งสีอย่างเดียว | ป้ายสถานะมีคำเสมอ; `Notice` มีเครื่องหมายเป็นข้อความ | `Notice.tsx`, thai-ux-standard §6.3 |
| เป้าสัมผัส | ปุ่ม/แถวตัวเลือก ≥ 44 px บนมือถือ | `globals.css` (`.mangmee-btn { min-height: 2.75rem }`) |
| การเคลื่อนไหว | spinner ใช้ `motion-reduce:animate-none`; แอนิเมชันปุ่มอยู่ใต้ `@media (prefers-reduced-motion: no-preference)` | `CoverLoader.tsx`, `globals.css` |
| ตัวอักษร | ขั้นต่ำ 12 px, ข้อความอ่าน ≥ 14 px, line-height ไทย ≥ 1.5 | `globals.css` `@theme inline` |
| การพิมพ์ | `@media print` พิมพ์เฉพาะพื้นผิวเอกสารใน modal | `globals.css` (~บรรทัด 1468) |

**ข้อจำกัด**: ไม่พบการประกาศระดับความสอดคล้อง WCAG และไม่พบการทดสอบ accessibility อัตโนมัติแบบ axe ในชุดทดสอบของเว็บ (คำว่า WCAG/axe พบเพียงใน `e2e/harness/inv11.ts`) การตรวจที่มีคือ spec เชิงโครงสร้างและ e2e `feature-entitlement-accessibility.spec.ts` (ซึ่งตรวจ "การเข้าถึงได้ตามสิทธิ์/ฟีเจอร์" ไม่ใช่ a11y ตาม WCAG — ตีความจากชื่อไฟล์; ไม่ได้เปิดอ่านเนื้อหาทั้งไฟล์)

### 9.2 Responsive

| เรื่อง | พฤติกรรม |
|---|---|
| เปลือก | <1024 px: แถบข้างเป็น drawer เปิดจากปุ่มเมนู มี backdrop; ≥1024 px: แถบข้างถาวร 289 px ย่อได้เหลือ 86 px (ไอคอนอย่างเดียว); แถบบนสูง 68 px ทุกขนาด |
| เนื้อหา | padding 1rem (มือถือ) → 1.75rem (≥768) → 2rem/1.75rem (≥1024); เต็มความกว้างเสมอ; ห้าม scroll แนวนอนระดับหน้า |
| ปุ่ม | 44 px (มือถือ) / 40 px (≥640); กลุ่มปุ่มเรียงแถวเมื่อชื่อพอดี ไม่พอดีจึงซ้อนโดยปุ่มทำอยู่บน |
| ฟอร์ม | มือถือหนึ่งคอลัมน์; ≥768 ฟิลด์สั้น 2–3 ต่อแถว; แถบปุ่มล่างติดขอบและเว้น safe area |
| รายการ/ตาราง | ตารางเลื่อนในกล่องตัวเองหรือกลายเป็นแถวซ้อนบนมือถือ; `FilterTabs` เลื่อนแนวนอนในตัวเองบนมือถือ |
| หน่วยความสูง | `dvh` แทน `vh` (แก้ปัญหา ~86 px บน iOS ที่มีแถบเบราว์เซอร์ยุบได้) |
| หลักฐานการตรวจ | `e2e/responsive.spec.ts` (INV-1..8; desktop 1280×800 + อุปกรณ์มือถือ), `e2e/evidence.spec.ts` (7 อุปกรณ์), `e2e/responsive-baseline.spec.ts`; ผล 2026-08-19: 283 ผ่าน 0 ล้มเหลว, 366 subjects 0 blocking (`e2e/RESPONSIVE-RESULTS-2026-08.md`) |

### 9.3 เบราว์เซอร์ที่รองรับ และหน้า unsupported-browser

กฎอยู่ใน `src/common/client-support/client-support.logic.ts` (`classifyWebClient`) ทำงานใน `proxy.ts` กับคำขอ GET/HEAD ที่เป็นเอกสาร HTML เท่านั้น

| ไคลเอนต์ | ขั้นต่ำ | ต่ำกว่านี้ |
|---|---|---|
| iOS / iPadOS (Safari และทุกเบราว์เซอร์บน iOS) | iOS **16.4** | `unsupported` |
| Android | Android **10** และเบราว์เซอร์ Chromium/Firefox/Edge major ≥ **111** | `unsupported` |
| เดสก์ท็อป Chrome / Edge / Firefox | major ≥ **111** | `unsupported` |
| เดสก์ท็อป Safari | **16.4** | `unsupported` |
| ไม่รู้จัก, bot/crawler/headless, ไม่มี User-Agent | — | `unknown` → **ให้ผ่าน** (บล็อกเฉพาะที่ระบุได้แน่ว่าเก่า) |

- ไคลเอนต์ `unsupported` ถูก redirect ไป `/unsupported-browser?next=<path เดิม>` พร้อม `Cache-Control: private, no-store` และ `X-Robots-Tag: noindex, nofollow`
- path ที่ยกเว้น: `/api/*`, `/l/*` (ไม่ให้ token ติด URL หน้าแจ้ง), `/legal/releases/*`, `/privacy`, `/terms`, `/data-deletion`, `/maintenance`, `/unsupported-browser`, และไฟล์ static
- หน้า `/unsupported-browser` (`GenericClientNotice` โหมด `device`) เป็น HTML ครบจากเซิร์ฟเวอร์ ไม่พึ่ง JS (เพราะเบราว์เซอร์อาจรันแอปไม่ได้) แสดงไทย+อังกฤษ ปุ่ม "ลองอีกครั้ง / Try again" (กลับ `next` ที่ผ่าน `sanitizeNextPath`) และ "ติดต่อทีมงานมั่งมี / Contact support" (mailto)
- ทดสอบ: `client-support.logic.spec.ts`, e2e `client-support.spec.ts`

---

## 10. ข้อกำหนดที่ไม่ใช่เชิงหน้าที่ (NFR)

| รหัส | ชื่อ | ข้อกำหนด | หลักฐาน / การตรวจ |
|---|---|---|---|
| NFR-601 | มือถือก่อน | ทุกหน้าที่ขายต้องใช้ได้ที่ 390 px (และ 360) ไม่มี scroll แนวนอนระดับหน้า และตรวจที่ 1280 กับ ≥1536 | `thai-ux-standard.md` §3.2; `e2e/responsive.spec.ts` |
| NFR-602 | หน้าต่างกว้างเต็มจอ | ไม่มีกรอบหน้าแบบแคบ/กึ่งกลาง; แถบปุ่มล่างเริ่มที่ขอบเนื้อหา | `globals.css`; §3.3 |
| NFR-603 | ปุ่มเป็นระบบเดียว | 4 แบบ, สูง 44/40 px, กลุ่มปุ่มขนาดเท่ากัน, ลำดับถอย-ทำ | `Button`, `ActionGroup`; §2 |
| NFR-604 | ถ้อยคำ | ไทยธรรมดาตามอภิธานศัพท์ ไม่มีรหัส/อังกฤษ/หางเสียงบนเว็บ; ไม่แสดงข้อความ API ดิบ | `sold-features-wording.spec.ts`, `one-source-words.spec.ts`, `no-raw-api-error-display.spec.ts` |
| NFR-605 | CSP เข้ม | nonce ต่อคำขอ + `strict-dynamic`; ทุกหน้า render ต่อคำขอ; ไม่มี prerender | `proxy.ts`, `security-headers.logic.spec.ts`, `csp-dynamic-rendering.spec.ts` |
| NFR-606 | Session ปลอดภัย | cookie httpOnly; CSRF แบบ double-submit; mutation ต้อง same-origin; cookie ไม่ถือเป็นหลักฐานยืนยันตัวตน | `proxy.ts`, `middleware.logic.spec.ts`, `authed-fetch.spec.ts` |
| NFR-607 | Security headers | HSTS preload, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` ปิดกล้อง/ไมค์/ตำแหน่ง/จ่ายเงิน/USB | `next.config.mjs`, `security-headers.logic.ts` |
| NFR-608 | ทุกการรอมี feedback | loader คลุมขอบเขต, ปุ่ม `aria-busy`, ไม่มีการรอเงียบ; proxy timeout 180 วินาทีสำหรับ OCR | `CoverLoader`; `next.config.mjs` |
| NFR-609 | ฟอนต์และ build แบบ offline | ฟอนต์ self-host, ไม่เรียก Google Fonts, น้ำหนัก ≤700 | `fonts.css`, `offline-fonts.spec.ts` |
| NFR-610 | เบราว์เซอร์ขั้นต่ำ | iOS 16.4, Android 10 + Chromium 111, เดสก์ท็อป 111 / Safari 16.4; ต่ำกว่าเห็นหน้าแจ้ง | 9.3 |
| NFR-611 | สองภาษาในโครง | ไทยเป็นค่าเริ่มต้น; dictionary มี th+en; เปลือกร้านตรึงไทย | 1.8 |
| NFR-612 | ความพร้อมของสองตัว bundler | loader ลงทะเบียนทั้ง Turbopack (dev) และ webpack (build); ตรวจ type แยกจาก build | 1.9 |

---

## 11. ต้นแบบและเอกสารอ้างอิงงานออกแบบ (`docs/prototypes`)

| โฟลเดอร์ | ทำเพื่ออะไร | เนื้อหา | สถานะเทียบกับโค้ดจริง |
|---|---|---|---|
| `docs/prototypes/mangmee-executive/` | ต้นแบบหน้ารายงานผู้บริหาร ใช้ตรวจหน้าจอก่อนสร้างจริง ข้อมูลสมมติทั้งหมด ไม่เรียก API | `mangmee-executive-preview.html` (เปิดในเบราว์เซอร์ได้ตรง), `executive-preview.tsx`/`.css`, `executive-analytics.ts`, `preview-locale.ts`, สคริปต์ `build-preview.cjs` (ประกอบจาก components/tokens/fonts ของ `apps/web`), `check-demo.cjs`, `check-export.cjs`, `check-analytics.ts` (ตรวจการนำทาง กราฟ→รายชื่อ→รายละเอียด, ตัวกรอง, ส่งออกตัวอย่าง, ขนาดจอ 320–1440 px); อ้างสเปก `docs/specs/mangmee-executive-business-ui-spec-th.md`, `…-backend-spec-th.md`, `…-plain-language-spec-th.md` | หน้าจริงอยู่ที่ `/system/executive/*` (`features/executive-reports`); README ของต้นแบบพูดถึง "เปรียบเทียบ" ซึ่งในแอปจริง `/system/executive/compare` ถูกถอดเป็น redirect |
| `docs/prototypes/mangmee-main-website/` | ต้นแบบเว็บหลัก (หน้า marketing) สำหรับพิจารณาเนื้อหาและ layout ตาม `docs/research/mangmee-thai-main-website-guideline-2026-10-20-th.md` | `index-v1.html` (รุ่นแรก สีอ่อน), `index.html` (v2: เขียวเข้ม/เขียวมะนาว/เหลือง ครอบคลุมฟีเจอร์ 6 กลุ่ม + สิทธิ์เพิ่มของ Enterprise), `preview.html` (สลับ v1/v2 และเดสก์ท็อป/มือถือ), `v3/` (`README.md`, `content-th.md` ข้อความทั้งหมด + SEO/JSON-LD + ตารางความจริงจากโค้ด, `IMPLEMENTED-th.md`, `canvas/`): v3 เปลี่ยนหัวเรื่องเป็น "ส่งใบเสร็จผ่าน LINE ให้ AI ช่วยอ่าน คุณตรวจ แล้วค่อยยืนยัน" และเพิ่มตัวช่วยเลือกแพ็กเกจ 4 คำถาม | หน้าจริงคือ `app/page.tsx` + `features/public-home` (เอกสาร `v3/IMPLEMENTED-th.md` บันทึกสิ่งที่นำไปทำ) HTML ต้นแบบเป็นไฟล์ธรรมดา ไม่มี build |
| `docs/prototypes/mangmee-halloween-2026-10-21/` | ภาพตัวละครสำหรับธีม Halloween ของหน้าแรก | PNG โปร่งใส 4 ภาพ: `mangmee-broom.png` (1536×1024), `mangmee-peeking.png` (1312×1199), `friendly-ghost.png`, `friendly-pumpkin.png` (1236×1273); `prompts.json` (พรอมป์ต์สร้างภาพ), `verification.json` (ตรวจ alpha และ SHA-256) | ธีมจริง: `features/public-home/HomeEventTheme.tsx`, `home-events.css`, หน้า `/halloween/[[...card]]`, ตั้งค่าที่ `/system/home-theme`; README ระบุว่าชุดนี้เป็นภาพนิ่งต้นแบบ |

เอกสารอ้างอิงงานออกแบบอื่นที่โค้ดอ้างถึง: `docs/research/thai-ux-guideline-research-2026-10-13.md` (การวัดฟอนต์ไทย), `docs/plans/mangmee-auth-permissions-ui-plan.md` (hero หน้า login), `docs/agent-memory/sold-features-ux-program.md` (รายการหน้าจอและบันทึกโปรแกรม UX), `docs/specs/mobile-first-launch-features-spec.md`, และเทมเพลต TailAdmin (ภายนอก repo; ระบุ path บนเครื่องผู้พัฒนาใน `web-frontend-code-style.md`)

ในโค้ดยังมี "prototype" อีกความหมายหนึ่ง: โฟลเดอร์ `apps/web/src/features/mangmee-prototype/` และ component ที่ชื่อลงท้าย `PrototypePage` (เช่น `IndividualPermissionsPrototypePage`, `AddEmployeePrototypePage`, `PermissionMatrixPrototypePage`, `InboxPrototypePage`) — ชื่อค้างมาจากช่วงทำตาม design handoff; ตัวที่อยู่ในขอบเขต (พนักงาน/บทบาท) ต่อ API จริงแล้ว (`employee-access.api.ts`)

---

## 12. นอกขอบเขตแพ็ก 1,999 (มีโค้ดแต่ไม่ได้ขาย)

ทุกรายการไม่อยู่ใน `TIER_FEATURE_PRESETS` ของแพ็กใด (ตรวจจาก `menu-entitlements.ts`) รายละเอียด route อยู่ในตาราง 4.2

- **เอกสารขายและรับชำระ / บัญชี / การขาย** (`sales_documents`; binding `status: 'planned'`) — `/sales-documents*`, `/accounting`, `/sales`
- **สมุดรายรับ-รายจ่าย** — `/income-expense-ledger` (ไม่มีเมนู; ดูหัวข้อ 13)
- **ภาษี (VAT/WHT/CIT workspace)** (`thai_tax`) — `/tax`, `/tax/evidence`, `/tax/reconciliation`, คู่มือ `/user-guide/tax`
- **บัญชีแยกประเภท** (`double_entry_ledger`) — `/journal`, `/period-closing` (ซ่อนด้วย `ACCOUNTING_UI_HIDDEN`), `/settings/chart-of-accounts`, `/settings/accounting-tax-setup/*`, `/settings/tax-codes`, `/settings/tax-accounts`; และ `expense_auto_post` (ไม่มีหน้าจอ; ถูกตัดออกจาก preset `full` ด้วย)
- **รายงานการเงิน/BI** (`reports`) — `/reports`, คู่มือ `/user-guide/reports`
- **จัดซื้อและเจ้าหนี้การค้า** (`procurement.*`) — `/procurement`, `/accounts-payable`, `/settings/po-approval`
- **ธนาคารและกระทบยอด** (`bank_reconciliation.*`) — `/banking`
- **สินค้า/สต๊อก** (`inventory`) — `/inventory/*` (10 หน้า)
- **สินค้าและบริการ** (`product_catalog`) — `/settings/crm-catalog*`
- **CRM** (`crm.*`) — `/inbox`, `/customers`, `/bookings`, `/crm-reports`, `/crm`, `/crm/customers/[id]`, `/crm/payment-proofs`, `/settings/discount-policy`
- **เชื่อมต่อ LINE OA ของร้านเอง** (`line_oa`) — `/settings/line-oa` (ต่างจากผู้ช่วย LINE ของมั่งมีซึ่งอยู่ในแพ็ก)
- **ระบบอัตโนมัติ** (`workflow_automation.*`) — `/workflow`
- **บรอดแคสต์** — มี label `module.broadcast` และ `crm/broadcast.api.ts` แต่ไม่มีโมดูลใน `WORKSPACE_MODULES` (คอมเมนต์: "intentionally absent until the release entitlement is enabled")
- **หน้าความปลอดภัยบัญชี** — `/settings/security` เป็น redirect (ปิดฟีเจอร์ 2026-08-05) แม้ `company_settings.security` อยู่ใน preset
- **Preset `standard` และ `full`** (`FEATURE_PACKAGE_PRESETS`) — มีนิยาม ("มาตรฐาน", "ครบวงจร") แต่ไม่ถูกแมปกับ tier ที่ขายใด ใช้ได้จากคอนโซลผู้ดูแลเท่านั้น
- **หน้ากิจกรรม Halloween และธีมหน้าแรก** — ส่วน marketing ตามฤดูกาล ไม่ใช่ฟีเจอร์ของแพ็ก

---

## 13. สิ่งที่ตรวจไม่ได้ และสิ่งที่พบในเอกสารแต่ไม่พบในโค้ด

**ตรวจไม่ได้ / ไม่ได้ยืนยันในเอกสารนี้**

1. **การกรอง permission ตาม entitlement ฝั่ง API** — เว็บเชื่อ `session.permissions`; ผลจริงว่าร้าน starter ได้ `accounting.counterparty.*`, `notification.preference.manage`, `notification.rule.manage`, `wht.certificate.*`, `expense.disbursement.*` หรือไม่ ต้องดูเอกสารสิทธิ์/entitlement ของ API
2. **ชุดเมนูของ `FREE_TRIAL_15`** — ไม่อยู่ใน `TIER_FEATURE_PRESETS`; โค้ดเว็บมีโหมด `freeExpenseDrafts` (เหลือเฉพาะค่าใช้จ่าย) และข้อความ "ไม่มีช่วงทดลอง" (2026-09-20) แต่ความสัมพันธ์ระหว่างสามสิ่งนี้กำหนดฝั่ง API
3. **HTTP method ของ API ในตารางหัวข้อ 4** — path ตรวจจาก `*.api.ts`; method ระบุตามที่เห็นบางส่วนเท่านั้น
4. **`/income-expense-ledger`** — กฎ route รับ `expense.read` ซึ่งร้าน starter อาจมี และหน้าเรียก `…/income-expense-ledger/availability` เอง แต่ไม่มีเมนูในแถบข้าง จึงไม่ยืนยันว่าเป็นส่วนของแพ็กที่ขาย (จัดไว้นอกขอบเขต)
5. **รายการประเภทเหตุการณ์แจ้งเตือน (`kind`)** — ไม่มี enum ฝั่งเว็บ
6. **ไม่ได้รันแอป** — ตามกติกาของงานนี้ไม่มีการ build/รัน/เปิดเบราว์เซอร์ ถ้อยคำบนจอและขั้นตอนในหัวข้อ 6 มาจากการอ่านโค้ดและคู่มือในแอป ไม่ได้กดจริง ลำดับปุ่มย่อยบางจุดอาจต่างจากจอจริงเล็กน้อย
7. **จำนวนรหัสใน `CODE_LABELS`** — นับด้วย regex (ประมาณ 1,040) ไม่ใช่การประเมิน object จริง (มี spread จาก contracts เพิ่มอีก)
8. **e2e `feature-entitlement-accessibility.spec.ts`** — อ้างจากชื่อไฟล์ ไม่ได้อ่านเนื้อหา

**พบใน spec/เอกสาร/สัญญา แต่ไม่พบในโค้ดเว็บ**

1. **หน้าจอซื้อ add-on ด้วยตนเอง** — `packages/contracts/src/billing.ts` นิยาม `BILLING_ADDON_OFFERS` 6 รายการ (เครดิตแชต 3, รูปใบเสร็จ 3) และ API มี endpoint ให้ทีมงานให้/ถอนเครดิต (`system/billing/companies/:id/credits`, `credit-grants/*`) แต่ **ไม่พบหน้าหรือปุ่มซื้อ add-on ของลูกค้าใน `apps/web`** และ **ไม่พบหน้าจอ credit-grants ในคอนโซล `/system/billing`** ของเว็บ (มีเฉพาะ "ใบเสร็จที่ผู้ดูแลเพิ่มให้" `receipt-adjustments` และ "ปรับแพ็กเกจ" `plan-adjustments`)
2. **หน้า LIFF ในเว็บ** — งานมอบหมายกล่าวถึง "LIFF/LINE pages"; `apps/web` ไม่มี route LIFF (มีเพียงรายการ `/liff` ใน `robots.ts`) หน้า LIFF อยู่ฝั่ง API
3. **PWA** — ไม่มี manifest/service worker แม้แอปออกแบบมือถือก่อน
4. **สวิตช์ภาษาในเปลือกร้าน** — `web-frontend-code-style.md` ("Language Rule") กำหนดให้มีสวิตช์ภาษา ไทย/อังกฤษ ในพื้นที่ทำงาน และ dictionary มี key `shell.language*` แต่เปลือกร้านตรึง `locale = 'th'` (`WorkspaceLayout.tsx`) และค้นไม่พบการใช้ key `shell.language*` หรือ `setLocale` ใน `common/components/app-shell/` และ `features/web-core-workspace/` — เปลือกปัจจุบันไม่มีปุ่มสลับภาษา (หน้า login/error/not-found ยังอ่านค่าภาษาจาก `useLocale`)
5. **โครงโฟลเดอร์ `common/constants/`, `common/utils/`** — แนะนำในแนวทางและ README ของ `common/` แต่ไม่มีโฟลเดอร์จริง
6. **ไฟล์ `Modal.module.css` / `Modal.model.ts`** — `common/components/modal/README.md` ระบุว่า "Expected files when implemented" แต่ Modal จริงใช้ Tailwind class ในไฟล์เดียว
7. **หน้าเปรียบเทียบของรายงานผู้บริหาร** — อยู่ใน README ต้นแบบ แต่ในแอปถูกถอด (redirect)
8. **หน้าความปลอดภัยบัญชี (`company_settings.security`)** — มี sub-feature ใน catalog และอยู่ใน preset แต่หน้าจริงเป็น redirect
9. **คู่มือ "ภาษี" และ "รายงานการเงิน"** — มีไฟล์และ route แต่ถูกถอดจากเมนู
10. **Token breakpoint** — งานมอบหมายระบุว่า design tokens มี breakpoints; `tokens.json` ไม่มี (ใช้ค่า Tailwind)

