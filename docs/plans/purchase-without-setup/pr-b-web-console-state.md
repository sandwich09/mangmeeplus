# PR B — สถานะ "ยังไม่มีแพ็กเกจ" ฝั่งเว็บ/คอนโซล, LoginPage (R-B5 ขยาย), R-B4, DQ8, RV30 — implementation brief

Spec: [../../specs/mangmee-purchase-without-setup-spec-th.md](../../specs/mangmee-purchase-without-setup-spec-th.md) §18.2 (R-B4, R-B5 ขยาย, R-C1, R-C5, R-C6, R-C7), §18.3 (RV23, RV25, RV26, RV30), §18.4 DQ8 · Plan: [../mangmee-purchase-without-setup-plan-th.md](../mangmee-purchase-without-setup-plan-th.md) "แก้ไขแผน 2026-09-27" P1 ข้อ 2, 10, 11, 11b และ P5 RV30 · Readme: [00-readme.md](00-readme.md) · ฐานโค้ด: `origin/develop` ddcdcadf (ทุกบรรทัดในเอกสารนี้ตรวจกับโค้ดจริงแล้ว 2026-09-27)

กติกาที่ใช้ทั้ง brief: ไม่แตะไฟล์ pinned (`apps/web/app/login/page.tsx`, `session-gate.logic.ts`, `server-session.ts`, `apps/web/app/api/auth/login/route.ts`, `companies/[companyId]/layout.tsx`, `refresh-session.use-case.ts`, `auth.guard.ts`, `auth.module.ts` — รายการเต็มใน `infra/security/validate-production-maintenance-release.sh:97-120`); ไม่แตะ `package.json`; ไม่มี env/flag ใหม่; DTO ใหม่ทุกฟิลด์ optional; error code ใหม่ต้องมีข้อความไทยใน `apps/web/src/common/api/api-error-message.ts` (spec `api-error-coverage.spec.ts:70-78` บังคับสำหรับ module `system-partner-management`) และใน `BillingPage.errorText`; worktree แยกจาก `origin/develop` ล่าสุด หลัง PR A merge (PR A ทำ pins sync — PR B ไม่แตะไฟล์ pinned จึงไม่ต้อง re-pin แต่ต้องรัน `--check` ให้ผ่าน)

---

## 1. Scope & Definition of Done

### 1.1 ขอบเขต (11 ข้อ)

| # | เรื่อง | ไฟล์หลัก |
|---|---|---|
| 1 | contracts helper `planTermLockReason` (รับ `Date \| string`) + `planTermState()` + `planTermStateLabel()`; re-export จาก API domain; ลงทะเบียน spec ใน `ci.yml` | `packages/contracts/src/plan-term.ts`, `apps/api/src/modules/system-partner-management/domain/logic/plan-term.logic.ts`, `apps/api/src/modules/sales-console/application/sales-company-search.service.ts`, `.github/workflows/ci.yml:543` |
| 2 | DTO optional: `/auth/me/companies` (`lockReason`, `planState`), `CompanyPlanTermDto.lockReason`, `PartnerCompanySummaryDto`/`PartnerCompanyDetailDto` (`planState`, `lockReason`, `tierKey`, `termEndsAt`), `BillingOperatorCompany.planState` + `source` ของร้าน `no_package`, `AdminPackageChangeItemDto` (`planState`, `lockReason`) | `auth.controller.ts:1072-1107`, `list-partners.use-case.ts:47-103`, `get-partner-detail.use-case.ts:28-86,138-185`, `billing-admin.service.ts:89-111`, `package-change-decision.use-case.ts:52-93` |
| 3 | label ทุกจุด render (F04) จาก helper เดียว | picker, switcher, BillingPage, PartnerDetailPage, PartnerListPage, BillingCompanyDirectory/Overview, SalesConsoleParts + sales-console.logic, SignupQueuePage, get-partner-timeline |
| 4 | guard คอนโซล: "เปิดใช้งานบริษัท" สำหรับร้าน term-disabled (web ซ่อน + API ปฏิเสธ `partner_activation_term_locked`), อนุมัติคำขอเปลี่ยนแพ็กเกจของร้านล็อก (web ซ่อนปุ่ม + API ปฏิเสธ `package_change_company_locked`) | `partner-lifecycle-transition.use-case.ts`, `package-change-decision.use-case.ts`, `PartnerDetailPage.tsx:3161`, `SignupQueuePage.tsx:779-787` |
| 5 | LoginPage R-B5 ขยาย: มาจากลิงก์ LINE + ไม่มี session → เริ่ม LINE login ทันที; `channel=line` → ปุ่ม LINE บนสุด + ฟอร์มรหัสผ่านพับ; copy `:41`; log `login_wall_from_line_link` ที่ BFF start route | `apps/web/src/features/auth/LoginPage.tsx`, `apps/web/app/api/auth/line-login/start/route.ts` |
| 6 | R-B4: ในเบราว์เซอร์ของ LINE แสดง "เปิดหน้านี้ใน Safari/Chrome" แทน reauth; copy `:99,:111`; `account/email/page.tsx` back-link ตาม permission + copy `:25` + รับ `channel=line`; start route redirect `/login?next=` เมื่อไม่มี session | `AccountEmailOtpPanel.tsx`, `apps/web/app/account/email/page.tsx`, `start/route.ts:32` |
| 7 | ~~DQ8: session ลูกค้า 30 วัน~~ **ตัดออก — Owner 2026-09-27 ให้คงอายุ session 7 วันไปก่อน**; ไม่แตะ `issue-token.use-case.ts` และ `auth-cookies.constants.ts` (แนวทางเก็บไว้ใน §3.13) | — |
| 8 | RV30: `PLAN_TERM_CHANGED_EVENT` + WorkspaceLayout re-read notice/`router.refresh()` + re-read on focus/visibility | `plan-term.api.ts`, `BillingPage.tsx:289`, `WorkspaceLayout.tsx:75-105` |
| 9 | ลิงก์โควตาใบเสร็จ permission-aware (G18), ปุ่มจ่ายในการ์ดใกล้หมดอายุ (G17), back link ของ locked shell → settings (F20) | `ExpensesPages.tsx:289,517-531,2901,2970`, `PlanTermSidebarCard.tsx:78-105`, `BillingPage.tsx:306-307` |
| 10 | tests แก้/เพิ่ม + ลงทะเบียน | §5 |
| 11 | docs amend | §6 |

นอกขอบเขต (อยู่ PR อื่น): R-B1/R-B2/LIFF/push/copy LINE (PR A), R-C11 helper `planManagersOf` (PR A — PR B ใช้ `permissions.includes('company.plan.manage')` ฝั่งเว็บเท่านั้น), ปลด `partnerMetadataLockError`/ฟอร์มแก้ไขข้อมูลบริษัท (PR E), gate อีเมล/โปรไฟล์ในหน้าซื้อ (PR C/D), error map 21 รหัส (PR D/G)

### 1.2 DoD

- ร้าน `no_package` ไม่มีคำว่า "ทดลองใช้"/"ครบกำหนด"/"ปิดใช้งาน"/"พักการใช้งานแล้ว" ในทุก surface ที่ระบุ §3; ร้าน `trial_ended` อ่านว่า "หมดอายุ"; ร้านที่แอดมินปิดเองอ่านว่า "พักการใช้งาน"
- `GET /v1/auth/me/companies` ตอบ `planState`/`lockReason` (optional) และ picker/switcher ใช้มัน; client เก่า (ไม่มีฟิลด์) ยังทำงาน (fallback = พฤติกรรมเดิม)
- ปุ่ม "ต่ออายุ" ของร้าน `no_package` มีคำเตือนผลข้างเคียงจริง 5 ข้อ (§4) + เหตุผลบังคับ (เดิม); ปุ่ม "เปิดใช้งานบริษัท" ไม่แสดงสำหรับร้าน term-locked และ API ปฏิเสธด้วย `partner_activation_term_locked`; ปุ่ม "เปลี่ยนแพ็กเกจให้" ไม่แสดงสำหรับร้านล็อกในคิว และ API ปฏิเสธด้วย `package_change_company_locked`
- `/login?line=handoff-expired&next=…` และ `/login?next=…channel=line…` โดยไม่มี session → ไม่เห็นฟอร์มรหัสผ่าน เห็นหน้า "กำลังเข้าสู่ระบบด้วย LINE…" แล้วเด้งไป LINE (เมื่อ LINE login available); กลับมาลง `next`; วน loop ไม่ได้ (§8)
- ในเบราว์เซอร์ของ LINE หน้าอีเมลบัญชีไม่มีปุ่ม reauth ที่พาออกนอกโดยไม่มี session — มีปุ่ม "เปิดหน้านี้ใน Safari/Chrome"; start route ที่ไม่มี session redirect `/login?next=<returnTo>`
- หลังชำระสำเร็จใน locked shell หน้าปลดล็อกในที่ (sidebar ธุรกิจโผล่) โดยไม่ต้อง reload มือ
- spec ที่แตะทั้งหมดผ่าน; `spec-suite-coverage.spec.ts`, `api-error-coverage.spec.ts` ผ่าน; contracts spec ใหม่อยู่ใน `ci.yml`; `sync-production-maintenance-release-pins.mjs --check` ผ่าน; ci.yml ที่แก้ต้องขึ้น main แบบ byte-identical ก่อน UAT all (P0)
- `docs/agent-memory/purchase-without-setup-2026-09-26.md` อัปเดต Status/Verification/Next

---

## 2. Contracts

### 2.1 `packages/contracts/src/plan-term.ts` (ต่อจากบรรทัด 14 `PlanTermLockReason`)

ปัจจุบัน: `plan-term.ts:14` มี type `PlanTermLockReason = 'trial_ended' | 'no_package'` เท่านั้น; ฟังก์ชันอยู่ที่ `apps/api/.../plan-term.logic.ts:74-80` (รับ `Date` เท่านั้น) และ `sales-company-search.service.ts:37-42` (`accessStateOf`, ใช้ที่ `:166` เท่านั้น; ไม่มี spec ใดเรียกตรง)

เพิ่มใน contracts (วางหลังบรรทัด 14):

```ts
/** Row shape every reader can hand in: Prisma rows carry Date, DTOs carry ISO strings. */
export type PlanTermStateInput = {
  tierKey?: string | null;
  termStartAt: Date | string;
  termEndsAt: Date | string;
  renewCount: number;
  termDisabledAt?: Date | string | null;
};

/**
 * ADMIN_HOLD = a human (or SUSPENDED/ARCHIVED) disabled the company; NO_PACKAGE/EXPIRED = the
 * term locked it (`lockReason`); TRIAL/ACTIVE = a running term. Precedence in that order.
 */
export type PlanTermState = 'ADMIN_HOLD' | 'NO_PACKAGE' | 'EXPIRED' | 'TRIAL' | 'ACTIVE';

const timeOf = (value: Date | string): number => (value instanceof Date ? value : new Date(value)).getTime();

/** Moved from apps/api plan-term.logic.ts:74-80 unchanged in meaning (sales-deals spec R2). */
export function planTermLockReason(
  term: Pick<PlanTermStateInput, 'termStartAt' | 'termEndsAt' | 'renewCount'>,
): PlanTermLockReason {
  return timeOf(term.termEndsAt) <= timeOf(term.termStartAt) && term.renewCount === 0 ? 'no_package' : 'trial_ended';
}

/** No `companyStatus` = the sales-console reading (accessStateOf): admin holds are not visible. */
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date): Exclude<PlanTermState, 'ADMIN_HOLD'>;
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date, companyStatus: string | null | undefined): PlanTermState;
export function planTermState(term: PlanTermStateInput | null | undefined, now: Date, companyStatus?: string | null): PlanTermState {
  // Same rule as billing-state.ts:8 `held`: anything not ACTIVE that the term did not disable.
  if (companyStatus && companyStatus !== 'ACTIVE' && !(companyStatus === 'DISABLED' && term?.termDisabledAt)) return 'ADMIN_HOLD';
  if (!term) return 'ACTIVE'; // legacy/grandfathered — fail open like every limit gate
  if (planTermLockReason(term) === 'no_package') return 'NO_PACKAGE';
  if (timeOf(term.termEndsAt) <= now.getTime() || term.termDisabledAt) return 'EXPIRED';
  return term.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : 'ACTIVE';
}

export const PLAN_TERM_STATE_LABEL_TH: Record<PlanTermState, string> = {
  ADMIN_HOLD: 'พักการใช้งาน',
  NO_PACKAGE: 'ยังไม่มีแพ็กเกจ',
  EXPIRED: 'หมดอายุ',
  TRIAL: 'กำลังทดลองใช้',
  ACTIVE: 'ใช้งานได้',
};

export function planTermStateLabel(state: PlanTermState): string {
  return PLAN_TERM_STATE_LABEL_TH[state];
}
```

`CompanyPlanTermDto` (`:19-40`) เพิ่มหลัง `paidPlan?: boolean;`:

```ts
  /** R2: present only while `derivedState` is EXPIRED — why the shop is locked. Derived from the row. */
  lockReason?: PlanTermLockReason;
```

ไม่เพิ่ม `planState` ใน `CompanyPlanTermDto` (เหตุผล: `toPlanTermDto(row, now)` ที่ `plan-term.logic.ts:116-140` เป็นฟังก์ชัน pure จาก term row มี 8 call sites และไม่เห็น `Company.status` จึงบอก ADMIN_HOLD ไม่ได้; หน้า partner detail มี `companyStatus` prop อยู่แล้ว (`PartnerDetailPage.tsx:2387-2392`) และ DTO มี `termStartAt/termEndsAt/renewCount/termDisabledAt` เป็น string ครบ → เว็บเรียก `planTermState(term, new Date(), companyStatus)` ได้ตรง ๆ — นี่คือเหตุผลที่ helper รับ `Date | string`) — ต้อง amend spec §18.2 R-C7 บรรทัด "เพิ่มฟิลด์ optional ใน 4 responses" ให้ระบุว่า `CompanyPlanTermDto` ได้ `lockReason` และ `planState` derive ฝั่งเว็บ (§6)

`packages/contracts/src/sales.ts:90` `SalesCompanyAccessState = 'NO_PACKAGE' | 'TRIAL' | 'ACTIVE' | 'EXPIRED'` **คงเดิม** (structurally = `Exclude<PlanTermState,'ADMIN_HOLD'>` — overload แรกของ `planTermState` คืนค่าชนิดนี้พอดี ไม่ต้องแก้ `SalesCompanySearchItem`)

### 2.2 Re-export ฝั่ง API

`apps/api/src/modules/system-partner-management/domain/logic/plan-term.logic.ts`:

- `:5-11` import เพิ่ม `planTermLockReason as contractsPlanTermLockReason` — หรือง่ายกว่า: ลบฟังก์ชัน `:63-80` ทั้ง doc comment แล้วเพิ่มบรรทัด `export { planTermLockReason } from '@watchdog-bms/contracts';` ที่ตำแหน่งเดิม (ผู้เรียก 6 ไฟล์ import จาก path นี้: `sales-company-search.service.ts:23`, `provision-signup.use-case.ts:8`, `process-line-webhook.use-case.ts:150`, `company-plan-term.use-cases.ts:18`, `plan-term-sweep.use-case.ts:12`, `billing.service.ts:41` — ไม่ต้องแก้ import ใด)
- `toPlanTermDto` (`:116-140`) เพิ่มใน object ที่ return หลัง `daysLeft,`: `...(derivedState === 'EXPIRED' ? { lockReason: planTermLockReason(row) } : {}),` (row เป็น Date — helper รับได้)

`apps/api/src/modules/sales-console/application/sales-company-search.service.ts`:

- `:23` เปลี่ยน import เป็น `planTermState` จาก `@watchdog-bms/contracts` (เพิ่มในบล็อก import `:9-20`) และลบ import `planTermLockReason` จาก system-partner-management
- ลบ `:28-30 TermRow` และ `:32-42 accessStateOf` ทั้งก้อน
- `:166` → `accessState: planTermState(company.planTerm, now),` (overload 2 อาร์กิวเมนต์ → ชนิด `SalesCompanyAccessState` ตรง)

### 2.3 DTO ใหม่ (optional ทุกตัว)

`packages/contracts/src/partner-management.ts`:

```ts
// :51-65 PartnerCompanySummaryDto — เพิ่มหลัง lineContextHealth
  /** R-C6/R-C7: the term's own state, so a term-locked shop never reads as "ปิดใช้งาน". */
  planState?: PlanTermState;
  lockReason?: PlanTermLockReason;
  tierKey?: PlanTierKey;
  termEndsAt?: string;
// :74-121 PartnerCompanyDetailDto — เพิ่มหลัง entitlementNormalizationPending
  planState?: PlanTermState;
  lockReason?: PlanTermLockReason;
```
import เพิ่มที่ `:3-7`: `import type { PlanTermLockReason, PlanTermState, PlanTierKey } from './plan-term.js';`

`packages/contracts/src/external-signup.ts:445-453` `AdminPackageChangeItemDto` เพิ่ม:

```ts
  /** R-C6: approving a request cannot unlock a shop; the queue must show the lock first. */
  planState?: PlanTermState;
  lockReason?: PlanTermLockReason;
```
(import type จาก `./plan-term.js` — ตรวจว่า external-signup.ts ยังไม่ import วงกลม: plan-term.ts ไม่ import external-signup)

`packages/contracts/src/billing.ts:269-279` `BillingOperatorCompany` เพิ่มหลัง `source`: `planState?: PlanTermState;` (`PlanTermLockReason` import อยู่แล้วที่ `:1` — เพิ่ม `PlanTermState` ในบรรทัดเดียวกัน)

`/auth/me/companies` ไม่มี type ใน contracts (เว็บประกาศเองที่ `workspace-scope.api.ts:6` และ `BillingCompanyPicker.tsx:8`) — เพิ่มฟิลด์ที่สองที่นั้น (§3.5, §3.6)

### 2.4 Error codes ใหม่ (API → เว็บ 2 map)

| code | HTTP | ที่โยน | ข้อความไทย (API `message` และ `CODE_LABELS`) |
|---|---|---|---|
| `package_change_company_locked` | 409 `ConflictException` (pattern `paidPlanReviewRequired` `company-plan-term.use-cases.ts:28`) | `package-change-decision.use-case.ts` ใน tx ก่อน claim | no_package: "ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ" · trial_ended: "แพ็กเกจของร้านนี้หมดอายุแล้ว ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหน้าพาร์ทเนอร์ก่อนแล้วค่อยเปลี่ยนแพ็กเกจ" |
| `partner_activation_term_locked` | 409 `ConflictException` | `partner-lifecycle-transition.use-case.ts` เมื่อ human actor + target ACTIVE + term หมด | no_package: "ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ" · trial_ended: "แพ็กเกจของร้านนี้หมดอายุแล้ว ต่ออายุในหมวดแพ็กเกจ หรือให้ลูกค้าซื้อเองจากหน้าแพ็กเกจ" |

`apps/web/src/common/api/api-error-message.ts` `CODE_LABELS` (วางถัดจาก `:597 package_change_request_not_found`):

```ts
  package_change_company_locked: 'ร้านนี้ยังไม่มีแพ็กเกจที่ใช้งานได้ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หากต้องการเปลี่ยนให้เอง กดต่ออายุในหน้าพาร์ทเนอร์ก่อน',
  partner_activation_term_locked: 'ร้านนี้ถูกพักเพราะยังไม่มีแพ็กเกจหรือแพ็กเกจหมดอายุ เปิดใช้งานจากที่นี่ไม่ได้ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหมวดแพ็กเกจ',
```

`BillingPage.errorText`: **ไม่ต้องเพิ่ม** (กติกา readme แก้ 2026-09-27: `api-error-message.ts` เป็น map เดียว; PR D ทำให้ `BillingPage` fall-through ไป `translateApiError`) — สองรหัสนี้เป็นของคอนโซล ไม่ถึง BillingPage

---

## 3. Code changes per file (current → new)

### 3.1 `apps/api/src/modules/auth/presentation/auth.controller.ts:1072-1107` (`myCompanies`)

ปัจจุบัน `:1085` select `planTerm: { select: { termEndsAt: true } }`; `:1102-1104` คำนวณ `expired` อย่างเดียว

```ts
// :1085
company: { select: { name: true, status: true, planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } },
// :1094-1105 ใน map — เพิ่มหลัง canManagePlan (คง expired ไว้เพื่อ client เก่า)
        expired: m.company.status === 'DISABLED' || (m.company.planTerm ? m.company.planTerm.termEndsAt.getTime() <= now : false),
        // R-C5/R-C7: the picker and the switcher say WHY the shop is locked, from the one helper.
        planState: planTermState(m.company.planTerm, new Date(now), m.company.status),
        ...(m.company.planTerm && m.company.planTerm.termEndsAt.getTime() <= now ? { lockReason: planTermLockReason(m.company.planTerm) } : {}),
```
import: เพิ่ม `planTermLockReason, planTermState` ในบล็อก import จาก `@watchdog-bms/contracts` ที่ `:39`. หมายเหตุ: query `:1076-1083` คืนเฉพาะ ACTIVE หรือ DISABLED+termDisabledAt จึงไม่มีทางได้ `ADMIN_HOLD` ที่นี่ (ดี — picker ไม่ต้องรองรับ)

### 3.2 `apps/api/src/modules/system-partner-management/application/use-cases/list-partners.use-case.ts`

- `:47-78` select เพิ่ม `planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } },`
- `:83` ก่อน map: `const now = new Date();`
- `:87-102` return เพิ่มหลัง `lineContextHealth,`:
```ts
        planState: planTermState(c.planTerm, now, c.status),
        ...(c.planTerm && c.planTerm.termEndsAt.getTime() <= now.getTime() ? { lockReason: planTermLockReason(c.planTerm) } : {}),
        ...(c.planTerm ? { tierKey: c.planTerm.tierKey as PlanTierKey, termEndsAt: c.planTerm.termEndsAt.toISOString() } : {}),
```
- `:4` import เพิ่ม `planTermLockReason, planTermState, type PlanTierKey` (value import → เปลี่ยน `import type {…}` เป็น `import { …, type LineContextHealth, … }`)

### 3.3 `.../get-partner-detail.use-case.ts`

- `:28-86` select เพิ่ม `planTerm: { select: { tierKey: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } },`
- `:138-185` return เพิ่มหลัง `entitlementNormalizationPending:`:
```ts
      planState: planTermState(c.planTerm, now, c.status),
      ...(c.planTerm && c.planTerm.termEndsAt.getTime() <= now.getTime() ? { lockReason: planTermLockReason(c.planTerm) } : {}),
```
(ประกาศ `const now = new Date();` หลัง `:88`; import จาก contracts `:3-11`)

### 3.4 `apps/api/src/modules/billing/application/billing-admin.service.ts:89-111` (`companyView`)

- `:105-107` `source`: ปัจจุบัน `term?.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : term ? 'MANUAL' : 'NONE'` → ร้าน `no_package` ต้องไม่เป็น `'TRIAL'`:
```ts
      source: term?.billingReceiptAccountId ? (…เดิม…) : term && planTermLockReason(term) === 'no_package' ? 'NONE' : term?.tierKey === 'FREE_TRIAL_15' ? 'TRIAL' : term ? 'MANUAL' : 'NONE',
      planState: planTermState(term, new Date(), company.status),
```
(`planTermLockReason` import จาก contracts — ไฟล์นี้ยัง import ไม่มี; `billing.service.ts:41` import จาก path API ซึ่งยัง re-export อยู่จึงไม่ต้องแก้)

### 3.5 `apps/api/.../package-change-decision.use-case.ts`

`list()` `:61`:
```ts
        company: { select: { name: true, status: true, planTerm: { select: { tierKey: true, billingReceiptAccountId: true, termStartAt: true, termEndsAt: true, renewCount: true, termDisabledAt: true } } } },
```
`:74-92` map เพิ่มหลัง `currentTierKey`:
```ts
        planState: planTermState(row.company.planTerm, now, row.company.status),
        ...(row.company.planTerm && row.company.planTerm.termEndsAt.getTime() <= now.getTime() ? { lockReason: planTermLockReason(row.company.planTerm) } : {}),
```
(`const now = new Date();` หลัง `:64`)

`decide()` `:127-128` (ใน tx ก่อน claim `:129` — แถวจึงยัง OPEN เมื่อถูกปฏิเสธ):
```ts
      const term=await tx.companyPlanTerm.findUnique({where:{companyId:row.companyId}});
      if(body.action==='APPROVE'&&term?.billingReceiptAccountId)throw paidPlanReviewRequired();
      // R-C6/RV25: SetCompanyPlanTerm never moves the dates (company-plan-term.use-cases.ts:160-168),
      // so approving would tell the shop "เปลี่ยนแพ็กเกจแล้ว" while it stays locked at zero days.
      if(body.action==='APPROVE'&&term&&term.termEndsAt.getTime()<=Date.now())throw packageChangeCompanyLocked(planTermLockReason(term));
```
เพิ่ม factory ข้างบนไฟล์ (หลัง `:34`):
```ts
export const packageChangeCompanyLocked = (reason: PlanTermLockReason) => new ConflictException({ code: 'package_change_company_locked',
  message: reason === 'no_package' ? 'ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ'
    : 'แพ็กเกจของร้านนี้หมดอายุแล้ว ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหน้าพาร์ทเนอร์ก่อนแล้วค่อยเปลี่ยนแพ็กเกจ' });
```
(import `ConflictException` เพิ่มที่ `:2`; `planTermLockReason, planTermState, type PlanTermLockReason, type PlanTermState` จาก contracts `:3-11`)

### 3.6 `apps/api/.../partner-lifecycle-transition.use-case.ts:35-59`

เพิ่มหลัง `:48` (หลัง SUSPENDED check, ก่อน `fromStatus`):
```ts
    // R-C6 (purchase-without-setup §18.2): a human re-activating a shop the TERM locked is undone by
    // the sweep within ~5 minutes (plan-term-sweep.use-case.ts:66-70 picks ACTIVE + expired). The
    // renewal path is safe here: RenewCompanyPlanTermUseCase moves termEndsAt (:278-292) BEFORE it
    // calls this use case (:319-328) in the same transaction, so this read sees the new end.
    if (cmd.targetStatus === 'ACTIVE' && cmd.requestingAdminUserId !== null) {
      const term = await tx.companyPlanTerm.findUnique({ where: { companyId: cmd.companyId }, select: { termStartAt: true, termEndsAt: true, renewCount: true } });
      if (term && term.termEndsAt.getTime() <= Date.now()) throw partnerActivationTermLocked(planTermLockReason(term));
    }
```
factory (หลัง `:21`):
```ts
export const partnerActivationTermLocked = (reason: PlanTermLockReason) => new ConflictException({ code: 'partner_activation_term_locked',
  message: reason === 'no_package' ? 'ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ'
    : 'แพ็กเกจของร้านนี้หมดอายุแล้ว ต่ออายุในหมวดแพ็กเกจ หรือให้ลูกค้าซื้อเองจากหน้าแพ็กเกจ' });
```
ผู้เรียกที่ส่ง ACTIVE ด้วย `requestingAdminUserId: null` (reconciler `:615,:979,:1212,:1343`, `billing-free-days.ts:180`, `billing-repeat.ts:495`) ไม่ผ่าน guard นี้ — ถูกต้อง (ระบบเปิดหลังจ่าย)

### 3.7 `apps/api/.../get-partner-timeline.use-case.ts`

- `:80-86` term select เพิ่ม `termStartAt: true, renewCount: true, termDisabledAt: true`
- `:152-156` type ของพารามิเตอร์ `term` เพิ่ม `termStartAt: Date; renewCount: number; termDisabledAt: Date | null;`
- `:161` ปัจจุบัน `if(companyStatus!=='ACTIVE')return all(companyStatus==='DISABLED'?'ร้านถูกพักใช้งาน':…)` →
```ts
    if(companyStatus!=='ACTIVE')return all(companyStatus==='DISABLED'
      ? (term?.termDisabledAt ? (planTermLockReason(term)==='no_package' ? 'ยังไม่มีแพ็กเกจ ลูกค้าเลือกซื้อเองได้จากหน้าแพ็กเกจ' : 'แพ็กเกจหมดอายุแล้ว') : 'ร้านถูกพักใช้งานโดยผู้ดูแล')
      : companyStatus==='ARCHIVED'?'ร้านถูกเก็บเข้าประวัติแล้ว':'ร้านยังไม่พร้อมใช้งาน');
```

### 3.8 เว็บ — customer picker/switcher/BillingPage

`apps/web/src/features/web-core-workspace/workspace-scope.api.ts:6`:
```ts
export type MyCompany = { companyId: string; companyName: string; roles: string[]; canManagePlan?: boolean; expired?: boolean; planState?: PlanTermState; lockReason?: PlanTermLockReason };
```
(`import type { PlanTermLockReason, PlanTermState } from '@watchdog-bms/contracts';`)

`WorkspaceScope.tsx:327-331` ปัจจุบัน `{c.expired ? (<span …>หมดอายุ</span>) : null}` →
```tsx
              {c.expired ? (
                <span className="ml-1.5 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
                  {planTermStateLabel(c.planState === 'NO_PACKAGE' ? 'NO_PACKAGE' : 'EXPIRED')}
                </span>
              ) : null}
```
(`:310-314` route ไป `/renew` คงเดิม; import `planTermStateLabel` จาก contracts)

`apps/web/src/features/billing/BillingCompanyPicker.tsx`:
- `:8` → `type CompanyChoice = { companyId: string; companyName: string; canManagePlan: boolean; expired: boolean; planState?: PlanTermState };`
- `:14` (fetch) คงเดิม
- `:24` copy (ตาราง §4 แถว P1)
- `:27` → `{company.expired ? <MangmeeBadge tone="amber">{planTermStateLabel(company.planState === 'NO_PACKAGE' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge> : 'แพ็กเกจและเอกสารการชำระเงิน'}`

`apps/web/src/features/billing/BillingPage.tsx`:
- `:341` badge ปัจจุบัน `…: lockReason === 'no_package' ? 'ยังไม่มีแพ็กเกจ' : 'ครบกำหนดใช้งาน'` →
```tsx
<MangmeeBadge tone={status.accessState === 'ACTIVE' ? 'brand' : 'amber'}>{status.accessState === 'HELD' ? 'อยู่ระหว่างตรวจสอบ' : planTermStateLabel(status.accessState === 'ACTIVE' ? 'ACTIVE' : lockReason === 'no_package' ? 'NO_PACKAGE' : 'EXPIRED')}</MangmeeBadge>
```
- `:347` "ครบกำหนดเมื่อ {date}" → "หมดอายุเมื่อ {date}" (ให้ตรง `CompanyTermExpiredPage.tsx:94`)
- `:293 lockReason` cast คงไว้ (`BillingStatus.lockReason` มีใน contracts `:181` แล้ว → ลบ cast `as { lockReason?: PlanLockReason } | undefined` ได้; type `PlanLockReason` ของเว็บ = ชนิดเดียวกับ `PlanTermLockReason`)
- `:296-298` คงเดิม (ใช้ `PLAN_LOCK_COPY`)
- `:306-307` back link (§3.14)
- `:289` + RV30 event (§3.13)

### 3.9 เว็บ — partner detail (`apps/web/src/features/system-partners/PartnerDetailPage.tsx`)

`apps/web/src/features/system-partners/plan-term.logic.ts`:
- `:13-19 planTermStatusChip(term)` → `planTermStatusChip(term: CompanyPlanTermDto, companyStatus: PartnerCompanyStatus, now = new Date())`:
```ts
export function planTermStatusChip(term: CompanyPlanTermDto, companyStatus: string, now = new Date()): PlanTermChip {
  const state = planTermState(term, now, companyStatus);
  if (state === 'ADMIN_HOLD' || state === 'NO_PACKAGE' || state === 'EXPIRED') return { label: planTermStateLabel(state), tone: 'danger' };
  return { label: `เหลือ ${term.daysLeft} วัน`, tone: term.derivedState === 'WARNING' ? 'warning' : 'success' };
}
```
- `:25-27 planTermDisabledChip` ลบทิ้ง (state chip พูดแทนแล้ว; ป้าย "พักการใช้งานแล้ว" สำหรับ termDisabledAt คือสิ่งที่ R-C7 ห้าม — ร้าน `no_package` เคยได้ "หมดอายุแล้ว" + "พักการใช้งานแล้ว" + "ทดลองใช้ฟรี" สามป้ายพร้อมกัน)

`PartnerDetailPage.tsx`:
- `:2531` เพิ่ม `const termState = term ? planTermState(term, new Date(), companyStatus) : null;`
- `:2562-2566` → `<PlanTermBadge chip={planTermStatusChip(term, companyStatus)} />` (ลบบรรทัด disabledChip) และ tier: `{termState !== 'NO_PACKAGE' && <span className="text-sm font-medium text-gray-900">{PLAN_TIER_PRESETS[term.tierKey].labelTh}</span>}`
- `:2583-2589` grid: เมื่อ `termState === 'NO_PACKAGE'` แสดง `<ReadOnlyField label="แพ็กเกจ" value="ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ" />` + `<ReadOnlyField label="เปิดร้านเมื่อ" value={formatDate(term.termStartAt)} />` แทนคู่ "เริ่มใช้งาน/ครบกำหนด" (วันเริ่ม = วันสิ้นสุด อ่านเป็น "หมดอายุวันนี้"); "แจ้งเตือนล่วงหน้า"/"ต่ออายุแล้ว" คงไว้
- `:2599-2606` ปุ่ม "ต่ออายุ" คงไว้ (Q4 ไม่ถอด)
- `:2720-2726` modal: แทนบรรทัด `:2721` ด้วย
```tsx
            {termState === 'NO_PACKAGE' ? (
              <div role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ การต่ออายุ = ให้วันใช้งานฟรี และเปิดสิทธิ์ทดลองใช้: ให้ AI อ่านใบเสร็จ 15 ใบ/เดือน, เครดิตแชตเริ่มต้น, เมนูแพ็กเกจเริ่มต้น, ใบที่อ่านไปยกยอดได้ไม่เกิน 15 ใบเมื่อซื้อครั้งแรก และหน้าจอของลูกค้าจะเรียกช่วงนี้ว่า "ช่วงทดลอง" — ไม่มีการเรียกเก็บเงิน
              </div>
            ) : (
              <p className="text-base text-gray-600">ต่ออายุการใช้งานโดยผู้ดูแล ไม่ใช่การซื้อแพ็กเกจ ไม่มีการเรียกเก็บเงินหรือเพิ่มใบเสร็จจากรายการนี้</p>
            )}
```
ข้อเท็จจริง 5 ข้อยืนยันจากโค้ด: 15 ใบ/เดือน = `receipt-quota.logic.ts:31-32` (`FREE_TRIAL_15` ใช้ `monthlySlipLimit` = 15 จาก `PLAN_TIER_PRESETS`); เครดิตแชต = `company-ai-budget-policy.ts:150-151` `DEFAULT_CHAT_CREDIT_SATANG`; เมนู starter = `provision-signup.use-case.ts:291`; ยกยอด ≤15 = `billing-trial-carryover.ts:12-18`; copy "ทดลองใช้" = `BillingPage.tsx:546,549,557`. เหตุผลบังคับคงเดิม (`:2492 partnerAdjustmentReason` + API `plan-term-adjustment.ts:29-30`)
- `:3079-3082` เพิ่ม `const lockedState = detail.planState === 'NO_PACKAGE' || detail.planState === 'EXPIRED' ? detail.planState : null;`
- `:3089` หลัง `<StatusBadge status={currentStatus}/>` เพิ่ม `{lockedState && <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{planTermStateLabel(lockedState)}</span>}`
- `:3091` notice: `บริษัทนี้{lockedState ? (lockedState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : 'แพ็กเกจหมดอายุ') : STATUS_LABEL[currentStatus]} ข้อมูลบริษัท ฟีเจอร์ และ AI จึงอ่านได้อย่างเดียว {lockedState ? 'ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือต่ออายุได้ในหมวดแพ็กเกจ' : 'เปลี่ยนสถานะได้ในหมวดภาพรวม'}` (`fieldsLocked` คงเดิม — ปลดใน PR E ตาม RV26)
- `:3161` → `{currentStatus!=='ACTIVE'&&!lockedState&&<button …>เปิดใช้งานบริษัท</button>}` และเพิ่ม `{lockedState&&<p className="text-sm text-gray-600">ร้านนี้ถูกพักเพราะ{lockedState==='NO_PACKAGE'?'ยังไม่มีแพ็กเกจ':'แพ็กเกจหมดอายุ'} เปิดใช้งานจากที่นี่ไม่ได้ (ระบบจะพักกลับอัตโนมัติ) ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหมวดแพ็กเกจ</p>}`; `LifecycleConfirmModal :388-430` ไม่แก้

### 3.10 เว็บ — partner list / billing admin / sales console / queue

`PartnerListPage.tsx`:
- เพิ่มหลัง `:19`: `const rowLabel = (c: PartnerCompanySummaryDto) => c.planState === 'NO_PACKAGE' || c.planState === 'EXPIRED' ? planTermStateLabel(c.planState) : STATUS_LABEL[c.status];`
- `:130` `{STATUS_LABEL[company.status]}` → `{rowLabel(company)}` (class คง `STATUS_CLASS[company.status]` = amber สำหรับ DISABLED)

`BillingCompanyDirectory.tsx`:
- `:12-16 access()`: `{company.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingLabel('access', company.accessState)}`
- `:17-19 term()`: เพิ่มบรรทัดแรก `if (company.planState === 'NO_PACKAGE') return <><span className="block text-xs text-gray-500">แพ็กเกจ</span>ยังไม่มีแพ็กเกจ</>;` (`source` ของร้านนี้เป็น `'NONE'` หลัง §3.4 จึงไม่แสดง "ทดลองใช้ถึง" อีก)
- `:65` และ `:74` `{billingPlanLabel(company.tierKey)}` → `{company.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingPlanLabel(company.tierKey)}`

`BillingCompanyOverview.tsx`:
- `:37` แพ็กเกจปัจจุบัน: `{c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingPlanLabel(c.tierKey)}` และบรรทัดวันที่: `{c.planState === 'NO_PACKAGE' ? 'ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ' : c.termEndsAt ? \`ใช้ได้ถึง ${formatThaiDateTime(c.termEndsAt)}\` : 'ยังไม่มีวันสิ้นสุดในข้อมูล'}`
- `:38` การใช้งาน: `{c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingLabel('access', c.accessState)}`
- `:31 sources` คงเดิม; `:52` `sources[c.source]` → `c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : sources[c.source]`

`apps/web/src/features/sales-console/sales-console.logic.ts:85-90`:
```ts
const SALES_ACCESS_STATE_TONE: Record<SalesCompanyAccessState, MangmeeTone> = { NO_PACKAGE: 'danger', TRIAL: 'amber', ACTIVE: 'brand', EXPIRED: 'slate' };
export const SALES_ACCESS_STATE_META: Record<SalesCompanyAccessState, { label: string; tone: MangmeeTone }> = Object.fromEntries(
  (Object.keys(SALES_ACCESS_STATE_TONE) as SalesCompanyAccessState[]).map((state) => [state, { label: planTermStateLabel(state), tone: SALES_ACCESS_STATE_TONE[state] }]),
) as Record<SalesCompanyAccessState, { label: string; tone: MangmeeTone }>;
```
(ผล: ACTIVE 'ใช้งานอยู่' → 'ใช้งานได้'; อีก 3 ค่าเท่าเดิม; `dealWarnings :434` ใช้ค่า enum ไม่ใช่ label → ไม่กระทบ)

`SalesConsoleParts.tsx:58`: `{company.accessState !== 'NO_PACKAGE' && company.tierKey && <span>{billingPlanLabel(company.tierKey)}</span>}` (ไม่ให้ "ทดลองใช้ฟรี" โผล่ข้าง "ยังไม่มีแพ็กเกจ"); `:42-45` badge คงเดิม

`SignupQueuePage.tsx`:
- `:772` `{item.currentTierKey ? \`${label} → \` : ''}` → `{item.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ → ' : item.currentTierKey ? \`${PLAN_TIER_PRESETS[item.currentTierKey as PlanTierKey]?.labelTh ?? item.currentTierKey} → \` : ''}`
- `:757` (ใต้ชื่อร้าน) เพิ่ม `{(item.planState === 'NO_PACKAGE' || item.planState === 'EXPIRED') && <span className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{planTermStateLabel(item.planState)}</span>}`
- `:779-787` ปุ่ม "เปลี่ยนแพ็กเกจให้": เงื่อนไข `item.billingReviewPath ? <Link…> : <button…>` → `item.billingReviewPath ? <Link…> : (item.planState === 'NO_PACKAGE' || item.planState === 'EXPIRED') ? <p className="text-xs text-amber-800">{item.planState === 'NO_PACKAGE' ? 'ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ' : 'แพ็กเกจของร้านนี้หมดอายุแล้ว ต่ออายุในหน้าพาร์ทเนอร์ก่อน'}</p> : <button…>` — ปุ่ม "ไม่อนุมัติ" และลิงก์ `/system/partners/:id` (`:798-800`) คงไว้ (= "พ่วงต่ออายุ" ตาม R-C6)
- `:400-402` ข้อความ confirm `เป็น ${item.requestedTierKey}` → `เป็น ${PLAN_TIER_PRESETS[item.requestedTierKey as PlanTierKey]?.labelTh ?? item.requestedTierKey}` (ข้อความถึง operator ยังมี key ดิบ — แก้ตามกฎ "no machine tokens in UI" ในไฟล์เดียวกัน)

### 3.11 LoginPage (R-B5 ขยาย) — `apps/web/src/features/auth/LoginPage.tsx`

สถานะเดิม: `:139 nextPath`, `:171-176 lineNotice/linkMode`, `:199-216` recovery effect (session restore → `window.location.assign(landing)` = R-B5 ส่วนแรกกรณี refresh cookie; กรณี access cookie ใช้ได้ทำที่ `app/login/page.tsx:37-46` pinned), `:396 qrApproveLead`, `:406-417 lineLoginButton` (handler ที่ `LoginPage.spec.ts:25-28` ล็อกไว้ — **ห้ามแก้บรรทัด 411**), `:482-487`/`:584-589` ลำดับปุ่ม, `:489-580` ฟอร์ม

ที่มาของ `channel=line`: การ์ดล็อก `line-business-card.logic.ts:524-525`, การ์ดโปรโมชั่น webhook `:2311`, และ `/l/<token>` ที่หมดอายุส่ง `next` = `targetPath` ของ token (`apps/web/app/l/[token]/route.ts:37-43,64`) ซึ่งเป็น URL เหล่านั้น → ตรวจ `channel=line` ใน `nextPath` ครอบทั้ง handoff-expired และลิงก์ธรรมดา (รวม fallback ในกลุ่มของ R-B2)

เพิ่มหลัง `:176`:
```ts
  // R-B5 ขยาย (purchase-without-setup §18.2): a LINE link — an expired handoff, or a plain URL that
  // carries `channel=line` — must never end at a password form. With no session, LINE login starts
  // by itself; the callback lands on `next`. Loop-safe: every LINE failure returns as
  // `/login?line=failed|canceled|unavailable` WITHOUT `next`, which is not a LINE link any more.
  const fromLineLink = !linkMode && (lineNotice === 'handoff-expired' || /[?&]channel=line(?:&|$)/.test(nextPath ?? ''));
  const [autoStartingLine, setAutoStartingLine] = useState(false);
```
เพิ่ม effect หลัง `:216`:
```ts
  useEffect(() => {
    if (checkingSession || !fromLineLink || accessState === 'CLOSED' || lineLoginState !== 'available') return;
    setAutoStartingLine(true);
    const reason = lineNotice === 'handoff-expired' ? 'handoff-expired' : 'channel-line';
    window.location.assign(withLineExternalBrowser(`${lineStartUrl(nextPath ?? '/')}&from=${reason}&auto=1`, navigator.userAgent));
  }, [checkingSession, fromLineLink, accessState, lineLoginState, lineNotice, nextPath]);
```
(`lineLoginState` มาจาก availability fetch `:178-194`; ถ้า `unavailable`/`error` → แสดงฟอร์มตามปกติ + notice)

เพิ่มหลังบล็อก `if (checkingSession)` (`:382-390`):
```tsx
  if (autoStartingLine) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p role="status" className="text-sm text-gray-500">{lineNotice === 'handoff-expired' ? 'ลิงก์นี้หมดอายุแล้ว กำลังเข้าสู่ระบบด้วย LINE ให้…' : 'กำลังเข้าสู่ระบบด้วย LINE…'}</p>
        </div>
      </div>
    );
  }
```
`:396` → `const lineLeadLane = (lineNotice === 'qr-approve' || fromLineLink) && lineLoginAvailable;` และแทน `qrApproveLead` ที่ `:482`, `:584` ด้วย `lineLeadLane` (spec `LoginPage.spec.ts:14,16,18` ต้องแก้ตาม §5)

ฟอร์มพับ: ครอบ `<form …>` `:489-580` ด้วย
```tsx
          {fromLineLink && lineLoginAvailable ? (
            <details className="mt-6">
              <summary className="min-h-11 cursor-pointer list-none text-center text-sm font-semibold text-gray-600">เข้าสู่ระบบด้วยรหัสผ่านแทน</summary>
              {passwordForm}
            </details>
          ) : passwordForm}
```
โดยย้าย JSX ของ `<form>` ไปเป็น `const passwordForm = (<form …>…</form>);` ก่อน `return` (ข้อความ `<form onSubmit={handleSubmit}` ยังคงมีหนึ่งตำแหน่งให้ spec `:17` หา)

`:41` copy (§4 แถว L1)

`apps/web/app/api/auth/line-login/start/route.ts` — log `login_wall_from_line_link` (เว็บไม่มี client logging/analytics ใดเลย — grep `sendBeacon|client-log|analytics|trackEvent` ใน `apps/web/src`, `apps/web/app` = 0; BFF routes ไม่มี `console.*` เลยเช่นกัน — จึงเลือกจุด server เดียวที่ทุกทางผ่าน = start route ซึ่งไม่ pinned) เพิ่มหลัง `:26`:
```ts
  // purchase-without-setup R-B5 (4): how often a LINE link met the login wall. `from`/`auto` come
  // from LoginPage's auto-start; a manual tap on the LINE button carries only the returnTo signal.
  if (!emailReauth && returnTo && /[?&]channel=line(?:&|$)/.test(returnTo)) {
    const from = request.nextUrl.searchParams.get('from');
    console.info(JSON.stringify({ event: 'login_wall_from_line_link', from: from === 'handoff-expired' || from === 'channel-line' ? from : null,
      auto: request.nextUrl.searchParams.get('auto') === '1',
      hasSession: Boolean(joinCookieChunks((name) => request.cookies.get(name)?.value, ACCESS_TOKEN_COOKIE)) }));
  }
```
กรณี "มี session แต่ token หมดอายุ" ไม่ผ่าน LoginPage (pinned `page.tsx:44-45` redirect) — วัดจาก audit `AUTH_LINE_HANDOFF_EXCHANGE` result FAILED ที่ API เขียนอยู่แล้ว (`exchange-line-handoff-token.use-case.ts:210-218`, metadata `reason`) — ระบุในเอกสาร verify: metric = จำนวน audit FAILED เทียบกับจำนวน event นี้

### 3.12 R-B4 — `AccountEmailOtpPanel.tsx` + `account/email/page.tsx` + start route

`AccountEmailOtpPanel.tsx`:
- import `import { isLineInAppBrowser, withLineExternalBrowser } from '@/common/auth/line-in-app-browser.logic';`
- state: `const [inLineBrowser, setInLineBrowser] = useState(false);` + ใน effect `:29-51` บรรทัดแรก `setInLineBrowser(isLineInAppBrowser(navigator.userAgent));`
- เพิ่มหลัง `:85`:
```tsx
  // R-B4 (purchase-without-setup §18.2 / RV23): the LINE round trip cannot finish inside LINE's own
  // browser (the transaction cookie is set there, the callback lands in Safari/Chrome with no
  // session and no `next`). Reopen this page outside first; `channel=line` makes /login start LINE
  // login by itself when the outside browser has no session yet (R-B5).
  function reopenOutsideLine() {
    const url = new URL(window.location.href);
    url.searchParams.set('channel', 'line');
    window.location.assign(withLineExternalBrowser(url.pathname + url.search + url.hash, navigator.userAgent));
  }
  const lineReauthButton = inLineBrowser
    ? <div className="space-y-2 rounded-xl bg-gray-50 p-3"><p className="text-sm text-gray-600">ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน</p><button type="button" className={button} onClick={reopenOutsideLine}>เปิดหน้านี้ใน Safari/Chrome</button></div>
    : <button type="button" className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={reauthenticate}>ยืนยันตัวตนผ่าน LINE</button>;
```
- แทนปุ่ม `ยืนยันตัวตนผ่าน LINE` ทั้ง 3 จุด (`:114`, `:123`, `:145`) ด้วย `{state.lineLinked && lineReauthButton}`
- `:99`, `:111` copy (§4 แถว E1, E2)

`apps/web/app/account/email/page.tsx`:
- `:10` type ของ searchParams เพิ่ม `channel?: string | string[]`
- `:13-14` เพิ่ม `if (input.channel === 'line') query.set('channel', 'line');` (ทำให้ `next` `:15` พก `channel=line` → หลัง reopen ในเบราว์เซอร์นอกที่ไม่มี session `:17` redirect `/login?next=/account/email?…&channel=line` → R-B5 auto-start → callback กลับหน้านี้)
- `:23` `result.session.roles.includes('OWNER')` → `result.session.permissions.includes('company.plan.manage')` (`WebSession.permissions` มีที่ `web-session.model.ts:9`; `fetchServerSessionResult(company)` ส่ง `X-Company-Id` จึงเป็น permission ของบริษัทนั้น)
- `:25` copy (§4 แถว E3)

`apps/web/app/api/auth/line-login/start/route.ts:32` ปัจจุบัน `if (!accessToken) return NextResponse.redirect(new URL('/login', origin));` →
```ts
    if (!accessToken) return NextResponse.redirect(new URL(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login', origin));
```

### 3.13 DQ8 — session 30 วัน — **ไม่ทำในรอบนี้ (Owner 2026-09-27: คงเดิม 7 วัน)** — เก็บแนวทางไว้สำหรับอนาคต ห้ามแตะไฟล์ในหัวข้อนี้ใน PR B

`apps/api/src/modules/auth/application/use-cases/issue-token.use-case.ts`:
- `:18-19` →
```ts
const ACCESS_EXPIRES_IN = 900;           // 15 min
// DQ8 (purchase-without-setup spec §18.4, Owner default): shop users keep a 30-day session so a
// LINE link taps straight into the web for a month; platform staff keep the 7-day session.
// Constants by role, not env (D-PF-8: no new flag).
const CUSTOMER_REFRESH_EXPIRES_IN = 30 * 24 * 3600;
const PLATFORM_REFRESH_EXPIRES_IN = 7 * 24 * 3600;
const PLATFORM_ROLE_KEYS: readonly string[] = ['SYSTEM_ADMIN', ...SALES_ROLE_KEYS];
```
(`import { SALES_ROLE_KEYS } from '@watchdog-bms/contracts';` — `sales.ts:7`)
- วิธีรู้ role ตอน issue: `:58-66` เรียก `permissionResolver.resolveAccess(userId)` อยู่แล้ว แต่ resolver เลือก membership เดียว (SYSTEM_ADMIN ก่อน แล้วค่อย membership เก่าสุด — `prisma-permission-resolver.repository.ts:31-54`) และ **โยน** เมื่อผู้ใช้มีแต่ร้าน DISABLED-by-term (`allowTermRecovery` ไม่ได้ส่ง) → ใช้ไม่ได้กับ LINE-first `no_package` owner และเซลล์ที่มีร้านของตัวเอง → ใช้ query ตรง (PrismaService inject อยู่แล้ว `:25`; ไม่มี provider ใหม่ → `auth.module.ts` ไม่ถูกแตะ) เพิ่มหลัง `:66`:
```ts
    // Any ACTIVE platform-role membership wins — independent of which membership the resolver
    // picked above, and reachable for a user whose only shop is term-locked (the resolver throws).
    const platformStaff = (await this.prisma.client.companyMembership.count({
      where: { userId, status: 'ACTIVE', roles: { some: { role: { key: { in: [...PLATFORM_ROLE_KEYS] }, status: 'ACTIVE' } } } },
    })) > 0;
    const refreshExpiresIn = platformStaff ? PLATFORM_REFRESH_EXPIRES_IN : CUSTOMER_REFRESH_EXPIRES_IN;
```
- `:71` `expiresIn: REFRESH_EXPIRES_IN` → `expiresIn: refreshExpiresIn`; `:74` `new Date(Date.now() + refreshExpiresIn * 1000)`
- `refresh-session.use-case.ts` (pinned, ไม่แตะ) ยืนยันแล้วว่าไม่ต้องแก้: `:136 isLive` ตรวจ `session.expiresAt > now`; `:236` sign refresh JWT ด้วย `expiresIn = floor((session.expiresAt - now)/1000)` และ comment `:204-205` "Rotation never writes expiresAt" → อายุจริง = แถว `AuthSession.expiresAt` ที่ issue เขียน
- ฝั่งเว็บ: `auth-cookies.server.ts:69` access cookie ใช้ `tokens.expiresIn` (900); refresh cookie `:70-74` และ PERSIST/CSRF/HOME `:75-96` ใช้ `REFRESH_TOKEN_MAX_AGE_SECONDS` (`auth-cookies.constants.ts:34` = 7 วัน) → เบราว์เซอร์จะทิ้ง refresh cookie ก่อน JWT หมด; refresh route `:56-61` ตั้ง cookie ใหม่ทุกครั้งที่ rotate (sliding) → แก้ `auth-cookies.constants.ts:34` เป็น `30 * 24 * 3600` พร้อม comment "DQ8: the browser cookie outlives the platform session (7 days) on purpose — the API row and JWT are the real limit; a stale cookie only yields a 401 that signs the user out". ไม่ต้องส่ง `refreshExpiresIn` ใน `AuthTokensResult` (`apps/web/app/api/auth/login/route.ts` pinned — ไม่แตะ)
- `remember` unchecked (`login/route.ts:26` → `persistent: false`) = session cookie ไม่มี maxAge — พฤติกรรมเดิม

### 3.14 RV30 — ปลดล็อกในที่

`apps/web/src/features/plan-term/plan-term.api.ts` เพิ่มท้ายไฟล์ (pattern `dashboard-notifications.api.ts:86-90`, `authed-fetch.ts:22`):
```ts
export const PLAN_TERM_CHANGED_EVENT = 'watchdog:plan-term-changed';

/** RV30: BillingPage fires this the moment a purchase is confirmed inside the locked shell. */
export function notifyPlanTermChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_TERM_CHANGED_EVENT));
}
```

`BillingPage.tsx` หลัง `:289 confirmed`:
```ts
  const lockedShell = useLockedShell();
  useEffect(() => { if (confirmed && lockedShell) notifyPlanTermChanged(); }, [confirmed, lockedShell]);
```
(import `useLockedShell` จาก `@/features/plan-term/LockedShellScope` `:16`; `notifyPlanTermChanged` จาก `plan-term.api`)

`WorkspaceLayout.tsx:75-105` (`WorkspaceLayoutClient`):
```tsx
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const lockedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void fetchPlanTermNotice(companyId).then((result) => {
      if (!active) return;
      // RV30: leaving EXPIRED means the server layout's session/permissions are stale too
      // (billing-reconciler.service.ts:603) — refresh them; the shell below switches by itself.
      const unlocked = result !== null && lockedRef.current && result.derivedState !== 'EXPIRED';   // result null = endpoint ล่ม ไม่ใช่ปลดล็อก (§9)
      setLoaded({ companyId, notice: result });
      if (unlocked) router.refresh();
    });
    return () => { active = false; };
  }, [companyId, revision, router]);

  useEffect(() => { lockedRef.current = notice?.derivedState === 'EXPIRED'; }, [notice?.derivedState]);

  // Only the locked shell listens: a running shop has nothing to unlock, and BusinessWorkspaceLayout
  // already re-reads its access context on focus (:189-202).
  useEffect(() => {
    if (notice?.derivedState !== 'EXPIRED') return;
    const bump = () => setRevision((n) => n + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener(PLAN_TERM_CHANGED_EVENT, bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener(PLAN_TERM_CHANGED_EVENT, bump); window.removeEventListener('focus', bump); document.removeEventListener('visibilitychange', onVisible); };
  }, [notice?.derivedState]);
```
(`useRef`/`useRouter` import อยู่แล้ว `:2,:6`; เพิ่ม `PLAN_TERM_CHANGED_EVENT` ใน import `:28`; `settled` guard `:96` คงเดิม → ระหว่าง re-read ไม่กระพริบเพราะ `loaded` ยังเป็นค่าเก่าจน `.then` มา)

ผลข้างเคียงที่ยอมรับ (spec P5): เมื่อ notice เปลี่ยนจาก EXPIRED → ACTIVE, `:99-104` สลับจาก `LockedWorkspaceLayout` เป็น `BillingWorkspaceLayout` → React unmount subtree เดิม → **BillingPage remount** (state ภายในหาย; `returning`/`attempt` กู้จาก URL query → re-read status → หัวข้อ "ชำระแล้ว เปิดใช้งานแล้ว"); `BillingWorkspaceLayout:147-157` โชว์ "กำลังเปิดหน้าแพ็กเกจ…" ครู่หนึ่งแล้วขึ้น sidebar ธุรกิจ; `router.refresh()` ทำให้ server layout (pinned, ไม่แตะ) re-fetch session → permissions ใหม่

### 3.15 G17/G18/F20

`ExpensesPages.tsx`:
- `:289` `UploadPanel({ companyId, branchId, canManagePlan, onSuccess, … }: { companyId: string; branchId?: string; canManagePlan: boolean; … })`
- `:521-524` →
```tsx
              {/* G18: the package page is where the quota is bought; staff without the permission
                  cannot buy, so they are told who can instead of being sent to a page that bounces. */}
              {canManagePlan
                ? <Link href={`/companies/${companyId}/billing`} className="underline">เปลี่ยนแพ็กเกจ</Link>
                : <span>แจ้งเจ้าของร้านให้เปลี่ยนแพ็กเกจ</span>}
```
- `:2970` mount เพิ่ม `canManagePlan={permissions.includes('company.plan.manage')}` (`permissions` มีใน `ExpensesHubPage :2901`)

`PlanTermSidebarCard.tsx:93-98` (การ์ดนี้ render เฉพาะผู้มี `canManagePlan ?? isOwner` ตาม `planTermView :18` — ไม่ต้องเพิ่ม prop): แทรกก่อน `<a href={\`tel:…\`}` :
```tsx
      <a
        href={`/companies/${encodeURIComponent(companyId)}/billing`}
        className="mt-2.5 block rounded-lg bg-brand-700 px-2 py-2 text-center text-[12.5px] font-bold text-white"
      >
        ไปหน้าแพ็กเกจ
      </a>
```
และเปลี่ยน class ของลิงก์โทร `:95` เป็น `mt-1.5 block rounded-lg border border-warning-200 bg-white px-2 py-2 text-center text-[12.5px] font-bold text-warning-700` (ปุ่มหลักมีปุ่มเดียว)

`BillingPage.tsx:306-307` (ใช้ `lockedShell` จาก §3.14):
```tsx
    backHref={status?.accessState === 'ACTIVE' ? `/companies/${encodeURIComponent(companyId)}/dashboard` : lockedShell ? `/companies/${encodeURIComponent(companyId)}/settings` : '/billing/companies'}
    backLabel={status?.accessState === 'ACTIVE' ? 'กลับแดชบอร์ด' : lockedShell ? 'กลับหน้าตั้งค่า' : 'กลับหน้าเลือกบริษัท'}>
```
(F20: `/billing/companies` → picker → `/` → resolver เลือกร้านล็อกเดิม → `/renew` วน; e2e `customer-billing-ux.spec.ts:135` mock เฉพาะ billing overview = EXPIRED ขณะ notice จริง ACTIVE → ไม่ใช่ locked shell → ยังเห็น "กลับหน้าเลือกบริษัท" ตามเดิม)

---

## 4. Copy table (ไทย เดิม → ใหม่)

| # | ไฟล์:บรรทัด | เดิม | ใหม่ |
|---|---|---|---|
| P1 | `BillingCompanyPicker.tsx:24` | ยังไม่มีบริษัทที่คุณเป็นเจ้าของ กรุณาให้เจ้าของบริษัทดำเนินการ หรือติดต่อทีมมั่งมี | ยังไม่มีบริษัทที่คุณมีสิทธิ์จัดการแพ็กเกจ กรุณาให้ผู้มีสิทธิ์จัดการแพ็กเกจของบริษัทดำเนินการ หรือติดต่อทีมมั่งมี |
| P2 | `BillingCompanyPicker.tsx:27` | ครบกำหนดใช้งาน | ยังไม่มีแพ็กเกจ / หมดอายุ (ตาม `planState`) |
| P3 | `WorkspaceScope.tsx:329` | หมดอายุ (ทุกกรณี) | ยังไม่มีแพ็กเกจ / หมดอายุ |
| B1 | `BillingPage.tsx:341` | ใช้งานได้ / อยู่ระหว่างตรวจสอบ / ยังไม่มีแพ็กเกจ / ครบกำหนดใช้งาน | ใช้งานได้ / อยู่ระหว่างตรวจสอบ / ยังไม่มีแพ็กเกจ / หมดอายุ |
| B2 | `BillingPage.tsx:347` | ครบกำหนดเมื่อ {วันที่} | หมดอายุเมื่อ {วันที่} |
| B3 | `BillingPage.tsx:307` | กลับหน้าเลือกบริษัท (locked shell) | กลับหน้าตั้งค่า (เฉพาะใน locked shell; นอก shell คงเดิม) |
| D1 | `system-partners/plan-term.logic.ts:14` | หมดอายุแล้ว | หมดอายุ · ยังไม่มีแพ็กเกจ · พักการใช้งาน (ตาม state) |
| D2 | `system-partners/plan-term.logic.ts:26` | พักการใช้งานแล้ว (chip แยก) | (ลบ — รวมใน D1) |
| D3 | `PartnerDetailPage.tsx:2583-2586` (ร้าน no_package) | เริ่มใช้งาน {วัน} / ครบกำหนด {วันเดียวกัน} | แพ็กเกจ: ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ / เปิดร้านเมื่อ {วัน} |
| D4 | `PartnerDetailPage.tsx:2721` (ร้าน no_package) | ต่ออายุการใช้งานโดยผู้ดูแล ไม่ใช่การซื้อแพ็กเกจ ไม่มีการเรียกเก็บเงินหรือเพิ่มใบเสร็จจากรายการนี้ | ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ การต่ออายุ = ให้วันใช้งานฟรี และเปิดสิทธิ์ทดลองใช้: ให้ AI อ่านใบเสร็จ 15 ใบ/เดือน, เครดิตแชตเริ่มต้น, เมนูแพ็กเกจเริ่มต้น, ใบที่อ่านไปยกยอดได้ไม่เกิน 15 ใบเมื่อซื้อครั้งแรก และหน้าจอของลูกค้าจะเรียกช่วงนี้ว่า "ช่วงทดลอง" — ไม่มีการเรียกเก็บเงิน (ร้านอื่นคงข้อความเดิม) |
| D5 | `PartnerDetailPage.tsx:3091` (ร้าน term-locked) | บริษัทนี้ปิดใช้งาน ข้อมูลบริษัท ฟีเจอร์ และ AI จึงอ่านได้อย่างเดียว เปลี่ยนสถานะได้ในหมวดภาพรวม | บริษัทนี้ยังไม่มีแพ็กเกจ/แพ็กเกจหมดอายุ ข้อมูลบริษัท ฟีเจอร์ และ AI จึงอ่านได้อย่างเดียว ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือต่ออายุได้ในหมวดแพ็กเกจ |
| D6 | `PartnerDetailPage.tsx:3161` (ร้าน term-locked) | ปุ่ม "เปิดใช้งานบริษัท" | (ไม่มีปุ่ม) ร้านนี้ถูกพักเพราะยังไม่มีแพ็กเกจ/แพ็กเกจหมดอายุ เปิดใช้งานจากที่นี่ไม่ได้ (ระบบจะพักกลับอัตโนมัติ) ลูกค้าซื้อแพ็กเกจเองได้จากหน้าแพ็กเกจ หรือกดต่ออายุในหมวดแพ็กเกจ |
| D7 | `PartnerDetailPage.tsx:3089` | (ป้าย "ปิดใช้งาน" อย่างเดียว) | ป้าย "ปิดใช้งาน" + ป้าย "ยังไม่มีแพ็กเกจ"/"หมดอายุ" |
| L1 | `PartnerListPage.tsx:130` (ร้าน term-locked) | ปิดใช้งาน | ยังไม่มีแพ็กเกจ / หมดอายุ (ร้านที่แอดมินปิดเองยัง "ปิดใช้งาน") |
| A1 | `BillingCompanyDirectory.tsx:18` (no_package) | ทดลองใช้ถึง {วัน} / ใช้งานถึง {วัน} | แพ็กเกจ: ยังไม่มีแพ็กเกจ |
| A2 | `BillingCompanyDirectory.tsx:65,74` (no_package) | ทดลองใช้ฟรี | ยังไม่มีแพ็กเกจ |
| A3 | `BillingCompanyDirectory.tsx:15` (no_package) | แพ็กเกจหมดอายุแล้ว | ยังไม่มีแพ็กเกจ |
| A4 | `BillingCompanyOverview.tsx:37` (no_package) | ทดลองใช้ฟรี · ใช้ได้ถึง {วัน} | ยังไม่มีแพ็กเกจ · ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ |
| A5 | `BillingCompanyOverview.tsx:38,52` (no_package) | แพ็กเกจหมดอายุแล้ว / ทดลองใช้ฟรี (ได้รับแพ็กเกจจาก) | ยังไม่มีแพ็กเกจ / ยังไม่มีแพ็กเกจ |
| S1 | `sales-console.logic.ts:88` | ใช้งานอยู่ | ใช้งานได้ (จาก helper; NO_PACKAGE/TRIAL/EXPIRED คงเดิม) |
| S2 | `SalesConsoleParts.tsx:58` (no_package) | ทดลองใช้ฟรี (ข้างป้าย) | (ซ่อน) |
| Q1 | `SignupQueuePage.tsx:772` (no_package) | ทดลองใช้ฟรี → {tier} | ยังไม่มีแพ็กเกจ → {tier} |
| Q2 | `SignupQueuePage.tsx:786` (ร้านล็อก) | ปุ่ม "เปลี่ยนแพ็กเกจให้" | ร้านนี้ยังไม่มีแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ / แพ็กเกจของร้านนี้หมดอายุแล้ว ต่ออายุในหน้าพาร์ทเนอร์ก่อน |
| Q3 | `SignupQueuePage.tsx:401` | เปลี่ยนแพ็กเกจของร้าน {ชื่อ} เป็น PRO_999 และแจ้งลูกค้าทางไลน์ ใช่หรือไม่ | เปลี่ยนแพ็กเกจของร้าน {ชื่อ} เป็น มืออาชีพ (PRO) และแจ้งลูกค้าทางไลน์ ใช่หรือไม่ |
| T1 | `get-partner-timeline.use-case.ts:161` (DISABLED + termDisabledAt) | ร้านถูกพักใช้งาน | ยังไม่มีแพ็กเกจ ลูกค้าเลือกซื้อเองได้จากหน้าแพ็กเกจ / แพ็กเกจหมดอายุแล้ว (แอดมินปิดเอง: ร้านถูกพักใช้งานโดยผู้ดูแล) |
| L1 | `LoginPage.tsx:41` | ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาเข้าสู่ระบบเพื่อเปิดรายการนี้ | ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว เข้าสู่ระบบด้วย LINE หรือรหัสผ่านเพื่อเปิดรายการนี้ (เห็นเฉพาะเมื่อ LINE login ไม่พร้อม) |
| L2 | `LoginPage.tsx` (ใหม่) | — | ลิงก์นี้หมดอายุแล้ว กำลังเข้าสู่ระบบด้วย LINE ให้… / กำลังเข้าสู่ระบบด้วย LINE… |
| L3 | `LoginPage.tsx` (ใหม่) | — | เข้าสู่ระบบด้วยรหัสผ่านแทน (summary ของฟอร์มที่พับ) |
| E1 | `AccountEmailOtpPanel.tsx:99` | ใช้รับเอกสารการชำระเงินและแจ้งเตือนบัญชี | ใช้เข้าสู่ระบบด้วยรหัส OTP รับแจ้งเตือนบัญชี และเป็นอีเมลตั้งต้นของเอกสารการชำระเงิน (จริงทั้งก่อน/หลัง Phase 2 — ดู §8; ตัดสิน 2026-09-27: เป็นข้อความสุดท้าย PR D ไม่แตะไฟล์นี้) |
| E2 | `AccountEmailOtpPanel.tsx:111` | กำลังรอยืนยันอีเมลใหม่ กรุณายืนยันหรือยกเลิกคำขอก่อนเริ่มชำระเงินใหม่ อีเมลเดิมยังคงอยู่ | กำลังรอยืนยันอีเมลใหม่ กรุณายืนยันหรือยกเลิกคำขอนี้ก่อน อีเมลเดิมยังคงอยู่ |
| E3 | `account/email/page.tsx:25` | ยืนยันอีเมลแล้วกลับไปเลือกแพ็กเกจได้ การยืนยันอีเมลยังไม่ใช่การชำระเงิน | จัดการอีเมลสำหรับเข้าสู่ระบบและรับแจ้งเตือน แล้วกลับไปหน้าแพ็กเกจได้ |
| E4 | `AccountEmailOtpPanel.tsx` (ใหม่, ในเบราว์เซอร์ LINE) | ยืนยันตัวตนผ่าน LINE | ยืนยันตัวตนผ่าน LINE ทำในเบราว์เซอร์ของ LINE ไม่ได้ กรุณาเปิดหน้านี้ใน Safari หรือ Chrome ก่อน + ปุ่ม "เปิดหน้านี้ใน Safari/Chrome" |
| X1 | `ExpensesPages.tsx:524` | ขอเปลี่ยนแพ็กเกจ (→ settings) | เปลี่ยนแพ็กเกจ (→ billing) / แจ้งเจ้าของร้านให้เปลี่ยนแพ็กเกจ (ไม่มีสิทธิ์) |
| X2 | `PlanTermSidebarCard.tsx` (ใหม่) | — | ไปหน้าแพ็กเกจ |
| C1 | `api-error-message.ts` (ใหม่) | — | ดู §2.4 |

ข้อความ LINE ("กดเมนู บริษัทของฉัน เพื่อรับลิงก์ใหม่" ของ R-B5) เป็น PR A

---

## 5. Tests

### 5.1 แก้ (จะแดงถ้าไม่แก้)

| ไฟล์:บรรทัด | เหตุ | assertion ใหม่ |
|---|---|---|
| `apps/web/src/features/system-partners/plan-term.logic.spec.ts:42-47` | label EXPIRED 'หมดอายุแล้ว' → 'หมดอายุ'; signature เพิ่ม `companyStatus` | `planTermStatusChip(term({derivedState:'EXPIRED',daysLeft:0}), 'ACTIVE')` → `{label:'หมดอายุ',tone:'danger'}`; ร้าน no_package (`termStartAt===termEndsAt`, `renewCount:0`, `termDisabledAt` set, `'DISABLED'`) → `'ยังไม่มีแพ็กเกจ'`; `'DISABLED'` ไม่มี `termDisabledAt` → `'พักการใช้งาน'`; term ปกติ + `'ACTIVE'` → `'เหลือ 12 วัน'` เหมือนเดิม |
| `…/plan-term.logic.spec.ts:50-58` | `planTermDisabledChip` ถูกลบ | ลบ describe นี้ (แทนด้วยเคส ADMIN_HOLD ข้างบน) |
| `apps/web/src/features/auth/LoginPage.spec.ts:14,16,18` | เปลี่ยนชื่อ `qrApproveLead` → `lineLeadLane` และนิยาม | `:14` → `/const lineLeadLane = \(lineNotice === 'qr-approve' \|\| fromLineLink\) && lineLoginAvailable;/`; `:16` `'{lineLeadLane ? ('`; `:18` `'{lineLeadLane ? null : ('`; `:25-29` คงเดิม (handler บรรทัด 411 ไม่แตะ) |
| `apps/web/src/features/expenses/ExpensesPages.qa.spec.ts:40-48` | ลิงก์โควตาไป billing | `:44` → `assert.match(source, /canManagePlan\s*\?\s*<Link href=\{`\/companies\/\$\{companyId\}\/billing`\}[^>]*>เปลี่ยนแพ็กเกจ</)`; เพิ่ม `assert.match(source, /แจ้งเจ้าของร้านให้เปลี่ยนแพ็กเกจ/)`; `assert.doesNotMatch(source, /href=\{`\/companies\/\$\{companyId\}\/settings`\}[^>]*>ขอเปลี่ยนแพ็กเกจ/)`; `:47` renew คงเดิม |
| `apps/api/src/modules/auth/presentation/auth.controller.spec.ts:351-373` | select/ฟิลด์ใหม่ | เพิ่ม membership ที่สาม `{ companyId:'co-locked', company:{ name:'Locked shop', status:'DISABLED', planTerm:{ tierKey:'FREE_TRIAL_15', termStartAt:T, termEndsAt:T, renewCount:0, termDisabledAt:T } }, roles:[…plan.manage] }` → assert `planState:'NO_PACKAGE'`, `lockReason:'no_package'`, `expired:true`; ร้าน `planTerm:null` → `planState:'ACTIVE'`, ไม่มี `lockReason`; `query.select.company.select.planTerm.select` มี 5 ฟิลด์ |
| `apps/api/.../list-partners.use-case.spec.ts:9-28` | select เพิ่ม planTerm | assert `rows.select.planTerm.select` = `{tierKey,termStartAt,termEndsAt,renewCount,termDisabledAt}`; เพิ่ม test ให้ `findMany` คืน 1 แถว no_package (`status:'DISABLED'`) → `items[0].planState==='NO_PACKAGE'`, `lockReason==='no_package'`, `tierKey==='FREE_TRIAL_15'`, `termEndsAt` ISO |
| `apps/api/.../get-partner-detail.use-case.spec.ts:5-33` | fake ไม่มี planTerm (ผ่านอยู่แล้ว) | เพิ่ม assert: `status:'DISABLED'` ไม่มี term → `result.planState==='ADMIN_HOLD'`; เพิ่มเคส fake ที่มี `planTerm` no_package → `'NO_PACKAGE'` + `lockReason` |
| `apps/api/.../package-change-decision.use-case.spec.ts:12-23,55,123-134,145-176` | `OPEN_ROW.company` ต้องมี `status` + term ครบ; `companyPlanTerm.findUnique` fake ต้องคืน term ที่มี `termEndsAt` | `OPEN_ROW.company = { name:'ร้านนิด', status:'ACTIVE', planTerm:{ tierKey:'FREE_TRIAL_15', termStartAt:P, termEndsAt:FUTURE, renewCount:0, termDisabledAt:null } }`; `:55` fake คืน `{ billingReceiptAccountId: options.paid?…:null, termStartAt, termEndsAt: options.locked ? PAST : FUTURE, renewCount:0 }`; `:129` เพิ่ม `items[0].planState==='TRIAL'`; test ใหม่: `locked:true` + APPROVE → rejects `error.getResponse().code==='package_change_company_locked'`, `updates.length===0` (ยังไม่ claim), `pushes.length===0`, `planTermCalls.length===0`; list ของร้านล็อก → `planState:'NO_PACKAGE'`, `lockReason:'no_package'` |
| `apps/api/.../partner-lifecycle-transition.use-case.spec.ts:39` | fake `companyPlanTerm` มีแต่ `updateMany` | เพิ่ม `findUnique: async () => options.term ?? null`; test ใหม่: admin actor + `targetStatus:'ACTIVE'` + term หมด → rejects code `partner_activation_term_locked` และ `company.update` ไม่ถูกเรียก; `requestingAdminUserId:null` + term หมด → ผ่าน (ทางของ reconciler); admin + term ยังไม่หมด → ผ่าน |
| `apps/api/.../company-plan-term.use-cases.spec.ts:218-300` | ยืนยันลำดับ renew (update ก่อน lifecycle) หลังเพิ่ม guard | เพิ่ม test: ร้าน no_package DISABLED+termDisabledAt renew → `lifecycle.calls[0].reason==='term_renewed'` และ `prisma.updateArgs().data.termEndsAt > now` (มีอยู่ที่ `:254-265` ส่วนใหญ่ — เพิ่ม assert ลำดับ) ; `:329-380 GetPlanTermNotice` ไม่เปลี่ยน |
| `apps/api/.../plan-term.logic.spec.ts:27-48` (API) | `planTermLockReason` ย้ายไป contracts | คง test ไว้ (import ผ่าน re-export ยังใช้ได้) — ย้ายสำเนา 4 เคสไป `packages/contracts/src/plan-term.spec.ts` |
| `apps/web/src/features/sales-console/sales-console.logic.spec.ts:117-123` | ไม่แดง (ใช้ enum) | เพิ่ม: `SALES_ACCESS_STATE_META.ACTIVE.label === planTermStateLabel('ACTIVE')` และ `NO_PACKAGE.label === 'ยังไม่มีแพ็กเกจ'` |
| `apps/web/src/features/plan-term/plan-term.logic.spec.ts:123-146` | ไม่แดง | คง; เพิ่ม `PLAN_LOCK_COPY.no_package.title === planTermStateLabel('NO_PACKAGE')` |
| `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts:994-1020` | **ไม่แดง** — PR B ไม่แตะ `buildLockedNavItems` (audit ระบุไว้ แต่ nav locked shell คงเดิมตาม R-C5) | รันเป็น regression guard เท่านั้น |
| `e2e/customer-billing-ux.spec.ts:125-149` | `:135` "กลับหน้าเลือกบริษัท" ยังอยู่ (ไม่ใช่ locked shell); `:140-141` back link ของหน้าอีเมลเปลี่ยนจาก OWNER role → permission (fixture OWNER มี `company.plan.manage` → ยังผ่าน) | เพิ่ม: หน้าอีเมล `heading` เดิม + assert description ใหม่ (E3); เพิ่ม `page.goto('/account/email?company=…&channel=line')` แล้ว `expect(page).toHaveURL(/channel=line/)`; ไม่แตะ `:133` |
| `e2e/billing-admin-directory.spec.ts:63-88` | fixture `:70-73` เป็น trial จริง (ยังคง "ทดลองใช้ฟรี"/"ทดลองใช้ถึง") | เพิ่ม test ใหม่: fixture no_package (`termStartAt = termEndsAt = now`, `renewCount:0`, company `status:'DISABLED'`, `termDisabledAt:now`) → article มี `'ยังไม่มีแพ็กเกจ'` ≥ 1, `not.toContainText('ทดลองใช้')`, `not.toContainText('แพ็กเกจหมดอายุแล้ว')` |
| `e2e/plan-term-billing-readiness.spec.ts:736-776` (BC03) | ปุ่มต่ออายุยังอยู่ (Q4) แต่ `:756` รอข้อความ 'ต่ออายุการใช้งานแล้ว' ที่หน้าเว็บไม่เคยแสดง (`PartnerDetailPage.tsx:2504` = 'บันทึกการปรับแพ็กเกจและวันใช้งานแล้ว') และ rig `:103-110` ส่ง `{days:30}` ผิด DTO (RV31) | อยู่ Phase 6 — **ไม่แก้ใน PR B**; บันทึกว่า BC03 แดงอยู่แล้วก่อน PR B |

### 5.2 ใหม่

| ไฟล์ | ครอบ |
|---|---|
| `packages/contracts/src/plan-term.spec.ts` | `planTermLockReason` 4 เคสเดิม (`plan-term.logic.spec.ts:27-48`) ทั้งแบบ `Date` และ ISO string; `planTermState`: `null` → ACTIVE; no_package → NO_PACKAGE แม้ส่ง companyStatus 'DISABLED'+termDisabledAt; `termEndsAt<=now` → EXPIRED; `termDisabledAt` set + end อนาคต → EXPIRED; `FREE_TRIAL_15` running → TRIAL; อื่น → ACTIVE; `'DISABLED'` ไม่มี termDisabledAt → ADMIN_HOLD; `'SUSPENDED'`/`'ARCHIVED'` → ADMIN_HOLD แม้ term ล็อก (precedence); `planTermStateLabel` ครบ 5 ค่า ไม่มี "+" และไม่มี snake_case; `PLAN_TERM_STATE_LABEL_TH.NO_PACKAGE === 'ยังไม่มีแพ็กเกจ'` |
| ~~issue-token.use-case.spec.ts~~ (ตัดออก — DQ8 ไม่ทำรอบนี้) | fake `jwtService.sign` เก็บ `options.expiresIn`; fake prisma `authSession.create` เก็บ `expiresAt`, `companyMembership.count` คืน 0/1, `userCredential`/`$transaction` เท่าที่ path `'line'` ใช้ (`:104-106`); เคส: count 0 → refresh JWT `expiresIn = 2592000`, `expiresAt ≈ now+30d` (±5s); count 1 → `604800`/7d; `resolveAccess` โยน (ร้านล็อก) → ยัง 30d; access `expiresIn = 900` ทั้งสองเคส |
| `apps/web/src/features/plan-term/plan-term.api.spec.ts` (ใหม่ หรือรวมใน `plan-term.logic.spec.ts`) | `PLAN_TERM_CHANGED_EVENT === 'watchdog:plan-term-changed'`; `notifyPlanTermChanged()` dispatch event บน `globalThis.window` fake |
| `apps/web/src/features/auth/LoginPage.spec.ts` (เพิ่ม describe) | source check: `fromLineLink` regex `/[?&]channel=line(?:&|$)/` และ `lineNotice === 'handoff-expired'`; auto-start ใช้ `withLineExternalBrowser(` + `&from=` + `&auto=1`; `autoStartingLine` return ก่อน `<form`; `<details` ครอบ `passwordForm` เมื่อ `fromLineLink`; `LINE_NOTICE_TEXT['handoff-expired']` ไม่มีคำว่า "รหัสผ่าน" ขึ้นก่อน "LINE" |
| `apps/web/src/features/auth/AccountEmailOtpPanel.qa.spec.ts` (source check แบบ `SignupQueuePage.qa.spec.ts:1-30`) | มี `isLineInAppBrowser(navigator.userAgent)`; ปุ่ม `เปิดหน้านี้ใน Safari/Chrome`; ไม่มี `onClick={reauthenticate}` นอก `lineReauthButton`; reopen URL ตั้ง `channel=line` |
| `apps/web/src/features/system-signup-requests/SignupQueuePage.qa.spec.ts` (เพิ่ม test) | ปุ่ม `เปลี่ยนแพ็กเกจให้` อยู่หลังเงื่อนไข `item.planState === 'NO_PACKAGE' \|\| item.planState === 'EXPIRED'`; confirm message ใช้ `PLAN_TIER_PRESETS[...]?.labelTh` |
| `apps/web/src/features/web-core-workspace/workspace-layout.qa.spec.ts` (ใหม่, source check) | มี `PLAN_TERM_CHANGED_EVENT` listener, `visibilitychange`, `router.refresh()` ใต้ `unlocked` |
| e2e `e2e/plan-term-billing-readiness.spec.ts` (เพิ่มเคสตาม audit — รันใน Extended Tests เท่านั้น; rig ต้องแก้ RV31 ก่อน) | picker/switcher labels ของร้าน no_package; unlock in place: mock notice EXPIRED→ACTIVE หลัง `PLAN_TERM_CHANGED_EVENT` → `aside` โผล่โดยไม่ `reload`; console renew warning มีข้อความ D4; `/login?line=handoff-expired&next=/companies/X/billing?channel=line` ไม่มี session → ไม่มี `#login-password`, redirect ไป `/api/auth/line-login/start?returnTo=…&from=handoff-expired&auto=1` (ดัก request) |

### 5.3 ลงทะเบียน (ไม่แตะ package.json)

- contracts: `packages/contracts/package.json:17` เป็นรายการตายตัว 13 ไฟล์ → ลงทะเบียน `plan-term.spec.ts` ที่ `.github/workflows/ci.yml:543` ต่อท้าย: `pnpm exec tsx --test packages/contracts/src/company-business-type.spec.ts packages/contracts/src/billing-company-profile.spec.ts packages/contracts/src/plan-term.spec.ts` (ci.yml parity กับ main ก่อน UAT all — P0)
- ~~API ใหม่ `issue-token.use-case.spec.ts`~~ — ตัดออก (DQ8 ไม่ทำรอบนี้) จึงไม่มี spec API ใหม่ให้ลงทะเบียนใน catalog
- API spec ที่แก้: ลงทะเบียนอยู่แล้ว (`apps/api/package.json` — auth.controller, package-change-decision, partner-lifecycle-transition, company-plan-term, plan-term.logic; `ci.yml:544` get-partner-detail; `ci.yml:547` list-partners; `ci.yml:778` sales-console.pg)
- web spec: auto (`apps/web/package.json:10` glob `src/**/*.spec.ts`)
- e2e: chromium project เก็บอัตโนมัติ แต่รันเฉพาะ `extended-tests.yml` (บันทึก run id ใน memory)

---

## 6. Docs to amend (ใน PR เดียวกัน)

| ไฟล์:บรรทัด | แก้ |
|---|---|
| `docs/specs/mangmee-company-plan-term-spec-th.md:72` | "เห็นบริษัทใน switcher ติดป้าย "หมดอายุ"" → "ติดป้ายตาม `lockReason`: "ยังไม่มีแพ็กเกจ" (no_package) / "หมดอายุ" (trial_ended); label ทุก surface มาจาก `planTermStateLabel()` ใน contracts (purchase-without-setup R-C7)" |
| `docs/runbooks/line-first-signup-support-playbook.md:56` | เพิ่มท้ายบรรทัด: "— ถ้าบรรทัดเป็น *ยังไม่มีแพ็กเกจ* ทางหลักคือลูกค้าซื้อเองจากหน้าแพ็กเกจ; ปุ่มต่ออายุ = ให้วันใช้งานฟรี (มีคำเตือนผลข้างเคียงใน dialog ต้องใส่เหตุผล); ปุ่ม **เปิดใช้งานบริษัท** ใน Lifecycle ไม่ปรากฏสำหรับร้านที่ระบบพักเพราะแพ็กเกจ" |
| `docs/specs/mangmee-sales-deals-and-locked-signup-spec-th.md:62` (R2 vocabulary) | เพิ่ม "label กลาง: ยังไม่มีแพ็กเกจ / กำลังทดลองใช้ / ใช้งานได้ / หมดอายุ / พักการใช้งาน (`planTermStateLabel`)" — sales console badge ACTIVE เปลี่ยนจาก "ใช้งานอยู่" เป็น "ใช้งานได้" |
| `docs/specs/mangmee-purchase-without-setup-spec-th.md` §18.2 R-C7 | ระบุว่า `CompanyPlanTermDto` ได้ `lockReason` และ `planState` derive ฝั่งเว็บจาก helper + `companyStatus` (ไม่ใส่ใน DTO นี้); R-C6 เพิ่ม "API ปฏิเสธด้วย `partner_activation_term_locked` / `package_change_company_locked`"; DQ8 → คงเดิม 7 วัน (Owner 2026-09-27) |
| `docs/plans/mangmee-purchase-without-setup-plan-th.md` P1 ข้อ 10/11b | ติ๊กเสร็จ + run ids; ระบุว่า BC03/RV31 ยังค้าง Phase 6 |
| `docs/agent-memory/purchase-without-setup-2026-09-26.md` | Status/Verification/Next |

---

## 7. Verification commands (ตามคำสั่ง Owner 2026-09-21: typecheck + boot + spec ที่แตะ; PG/smoke/e2e ผ่าน Extended Tests)

```bash
# 0. base
git fetch origin && git worktree add /private/tmp/mangmee-pr-b origin/develop && cd /private/tmp/mangmee-pr-b && pnpm install --frozen-lockfile
node infra/security/sync-production-maintenance-release-pins.mjs --check   # ต้องผ่านหลัง PR A; PR B ไม่แตะไฟล์ pinned

# 1. contracts
pnpm --filter @watchdog-bms/contracts build
pnpm exec tsx --test packages/contracts/src/plan-term.spec.ts packages/contracts/src/prisma-enum-parity.spec.ts

# 2. typecheck (api ใช้ script ของ package เพราะ heap; อ่าน exit code จริง)
pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma
pnpm --filter @watchdog-bms/api run typecheck; echo "api typecheck exit=$?"
pnpm --filter @watchdog-bms/web run typecheck; echo "web typecheck exit=$?"

# 3. API specs ที่แตะ + coverage
pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/auth/presentation/auth.controller.spec.ts \
  src/modules/system-partner-management/application/use-cases/list-partners.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/package-change-decision.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.spec.ts \
  src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.spec.ts \
  src/modules/system-partner-management/domain/logic/plan-term.logic.spec.ts \
  src/spec-suite-coverage.spec.ts
pnpm --filter @watchdog-bms/api test:boot

# 4. web specs ที่แตะ + coverage
pnpm --filter @watchdog-bms/web exec tsx --test \
  src/common/api/api-error-coverage.spec.ts src/common/api/api-error-message.spec.ts \
  src/features/auth/LoginPage.spec.ts src/features/auth/AccountEmailOtpPanel.qa.spec.ts \
  src/features/system-partners/plan-term.logic.spec.ts src/features/plan-term/plan-term.logic.spec.ts \
  src/features/expenses/ExpensesPages.qa.spec.ts src/features/sales-console/sales-console.logic.spec.ts \
  src/features/system-signup-requests/SignupQueuePage.qa.spec.ts src/features/web-core-workspace/web-core-workspace.spec.ts

# 5. (ถ้าแตะ LINE-AI — PR B ไม่แตะ; ข้าม) node scripts/run-line-ai-whole-chain-acceptance.mjs

# 6. Extended Tests (manual dispatch) — e2e chromium (+ sales-console.pg ใน CI ปกติ); บันทึก run id ใน memory
```

Readback หลัง merge (UAT): `GET /v1/auth/me/companies` ของ owner ร้านใหม่ → `planState:'NO_PACKAGE'`; `GET /v1/system/partners?status=DISABLED` → แถวร้านใหม่มี `planState`/`lockReason`; iPhone/Android จริง: การ์ดล็อกในแชต → ลบ cookie → แตะซ้ำ → เห็นเฉพาะการเด้งไป LINE แล้วกลับหน้าแพ็กเกจ (AC10 ค)

---

## 8. Risks

1. **Auto-start วน loop** — ป้องกันโดยโครงสร้าง: ทุกทางล้มเหลวของ LINE กลับมาเป็น `/login?line=failed|canceled|unavailable|link-required` โดยไม่มี `next` (`callback/route.ts:37,133,138-139`; `start/route.ts:45`) → `fromLineLink=false`; `linkMode` ถูกตัดออกจาก `fromLineLink`; ผลข้างเคียงที่ยอมรับ: เมื่อ LINE ล้มเหลว `next` หาย (พฤติกรรมเดิมของทุกเลน) — ผู้ใช้กดเมนู "บริษัทของฉัน" รับลิงก์ใหม่ (copy PR A)
2. **`start/route.ts` `console.info`** — BFF ไม่มี logging convention; ต้องยืนยันว่า stdout ของ Next ใน container api-web ถูกเก็บใน CloudWatch (§9); ถ้าไม่ ให้ตัด log ออกและใช้ audit `AUTH_LINE_HANDOFF_EXCHANGE` FAILED เป็น metric เดียว (ไม่กระทบพฤติกรรม)
3. **`openExternalBrowser=1` ผ่าน `window.location.assign`** (R-B4 reopen) — LINE เอกสารรับรองสำหรับลิงก์; ต้องทดสอบบนเครื่องจริงว่า navigation แบบ assign เปิดเบราว์เซอร์นอกด้วย (ถ้าไม่ ให้ render เป็น `<a href>` แทนปุ่ม)
4. ~~DQ8 cookie 30 วัน~~ — ไม่ทำรอบนี้ (Owner 2026-09-27 คงเดิม)
5. **Guard ใน `partner-lifecycle-transition`** — ผู้เรียก ACTIVE ที่เป็น human มีเพียง partner controller (lifecycle route) และ renew (`company-plan-term.use-cases.ts:319-328` หลังอัปเดต termEndsAt ใน tx เดียวกัน); ถ้า e2e BC03 หรือ smoke ใดเรียก lifecycle ACTIVE ตรง ๆ กับร้าน term หมด จะได้ 409 — grep ก่อน merge (§9)
6. **`api-error-coverage.spec.ts`** จะแดงทันทีถ้าลืม `CODE_LABELS` ของ 2 รหัสใหม่ (scan `code: '…'` ใน `system-partner-management`) — เป็นความตั้งใจ
7. **Remount ของ BillingPage** หลังปลดล็อก (RV30) — state ใน memory (quote ค้าง, capacity draft) หาย; เกิดเฉพาะเมื่อ `confirmed` แล้ว (ไม่มี quote ค้าง) จึงยอมรับได้; หน้า return กู้จาก URL
8. **Copy E1/E3 ระหว่าง Phase 1→2**: เขียนให้จริงทั้งก่อน/หลังถอด gate (ไม่อ้างว่า "ไม่ต้องยืนยันอีเมลก่อนจ่าย" ซึ่งยังไม่จริงจน PR C) — plan P2 ข้อ 7 ระบุ `:99,:111` ไว้ใน PR D ด้วย → ตัดสิน 2026-09-27: PR B เป็นเจ้าของไฟล์นี้ทั้งหมด PR D ไม่แตะ
9. **label sales console ACTIVE เปลี่ยน** ('ใช้งานอยู่' → 'ใช้งานได้') — ไม่มี spec/e2e ยึดข้อความเดิม (grep แล้ว); แจ้งทีมขายผ่าน docs §6
10. **PR A ต้อง merge ก่อน** (pins sync) — มิฉะนั้น `--check` แดงทุก PR โค้ด (RV12); PR B เองไม่แตะไฟล์ pinned

---

## 9. "ต้องตรวจ" (ก่อน/ระหว่าง implement)

- [ ] `packages/contracts/src/external-signup.ts` import type จาก `./plan-term.js` ไม่สร้าง import วงกลม (plan-term.ts ไม่ import external-signup — ตรวจแล้วบนฐานนี้; ตรวจซ้ำหลัง PR A)
- [ ] `prisma-enum-parity.spec.ts` ไม่จับ `PLAN_TERM_STATE_LABEL_TH`/`PlanTermState` เป็น enum ที่ต้อง parity (ไม่ใช่ Prisma enum — ถ้าจับ ให้ใส่ใน exemption ของ spec นั้น)
- [ ] `api-error-message.spec.ts` มีรายการ snapshot ของ `CODE_LABELS` ที่ต้องเพิ่ม 2 รหัสใหม่หรือไม่ (ไฟล์ `:229,390-404` เป็นตัวอย่างการ assert ข้อความ)
- [ ] `partner-lifecycle-transition.use-case.spec.ts` fake `:39` เพิ่ม `findUnique` แล้ว `company-plan-term.use-cases.spec.ts` `makeLifecycle()` (mock) ไม่ต้องแก้ — ยืนยัน
- [ ] grep `partnerLifecycleTransition(` / `lifecycle` ACTIVE ใน `apps/api/src/scripts/*smoke*.ts` และ `e2e/` ว่าไม่มีเคสเปิด ACTIVE ให้ร้าน term หมดโดยตรง (เสี่ยง 409 ใหม่)
- [ ] stdout ของ Next route handler ใน container api-web ถูกส่งเข้า CloudWatch หรือไม่ (ดู `infra/api-web/start-api-web-runtime.sh` — pinned, อ่านอย่างเดียว) → ตัดสินข้อ 8.2
- [ ] เครื่องจริง iPhone/Android: (ก) reopen จากเบราว์เซอร์ LINE ด้วย `assign(...openExternalBrowser=1)` เปิด Safari/Chrome จริง; (ข) `/login?line=handoff-expired&next=…channel=line` ไม่มี cookie → ไม่มีฟอร์ม → LINE → กลับหน้าแพ็กเกจ (AC10 ค); (ค) LINE availability ตอบช้า → หน้า "กำลังตรวจสอบ…" ไม่โชว์ฟอร์มก่อน auto-start (ลำดับ: `lineLoginState==='loading'` → ฟอร์มพับยังไม่ render? ปัจจุบัน `fromLineLink && lineLoginAvailable` เป็นเงื่อนไขพับ — ระหว่าง loading ฟอร์มจะโชว์เต็ม 1 ครั้ง → ถ้าไม่ต้องการ ให้พับเมื่อ `fromLineLink && lineLoginState !== 'unavailable'` แทน)
- [ ] `WorkspaceLayoutClient` focus/visibility re-read: ตรวจว่า `fetchPlanTermNotice` swallow error เป็น `null` (`plan-term.api.ts:50-56`) แล้ว `unlocked` จะเป็น true เมื่อ endpoint ล่ม (null ≠ EXPIRED) → ป้องกันด้วย `result !== null &&` ใน `unlocked` (แนะนำใส่ตั้งแต่แรก)
- [ ] `BillingCompanyOverview.tsx` และ directory ใช้ `BillingOperatorCompany.planState` — smoke `billing-http-smoke.ts`/`billing-admin-directory` e2e ยึด `source:'TRIAL'` ของร้านที่มี `renewCount 0` และ term 0 วันหรือไม่ (เปลี่ยนเป็น `'NONE'`)
- [ ] `SignupQueuePage.tsx:772` ต้องยัง render `currentTierKey` สำหรับร้าน trial จริง (spec `:129`)
- [ ] `PartnerDetailPage` — `planTermStatusChip` signature ใหม่ถูกใช้ที่อื่นอีกไหม (grep `planTermStatusChip(`; พบ 1 จุด `:2563` บนฐานนี้)
- [ ] copy Owner-verbatim: D4 (คำเตือนต่ออายุ) และ Q2/D6 ให้ Owner sign-off ก่อน merge (กติกา plain-Thai, ไม่มี machine token)
- [ ] `docs/specs` ที่อ้าง "ใช้งานอยู่" ของ sales console (grep `ใช้งานอยู่` ใน docs/specs/mangmee-sales-deals-*) — amend ถ้ามี
- [ ] หลัง merge develop: twin PR ไป main; `ci.yml:543` ต้อง byte-identical บน main ก่อน UAT all; บันทึก run ids (Extended Tests) ใน memory
