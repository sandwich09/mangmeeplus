# Mangmee System UI Alignment Implementation Plan

## Linked Spec

- Spec: `docs/specs/mangmee-system-ui-alignment-spec.md`
- Agent memory: `docs/agent-memory/mangmee-system-ui-alignment.md`
- Summary: `docs/mangmee-system-ui-alignment-summary-th.md`
- Visual reference: `/Users/bombam/Downloads/มั่งมี-ระบบทั้งหมด (เปิดได้ทุกเครื่อง).html`
- Design handoff: `../design_handoff_mangmee`

## Purpose

ปรับ UI ของ WatchDog-BMS ให้ใกล้กับ HTML reference ของมั่งมีแบบ production-safe โดยเริ่มจาก shared token, shell, common component และ feature pages ที่มี API รองรับแล้ว จากนั้นค่อย migrate หน้าอื่นเป็น phase ต่อเนื่อง

อัปเดตรอบล่าสุด: ใช้ภาพ design ที่ 2 เป็น acceptance target สำหรับ company dashboard/sidebar/header โดยเพิ่ม menu prototype แบบ permission-aware, planned placeholder routes, และ `COMPANY_VIEW` role สำหรับ local company mock account

## Current Repository Context

- Apps/packages to inspect:
  - `apps/web`
  - `packages/design-tokens`
  - `apps/api` เฉพาะกรณีต้องเปิด API ใหม่
- Existing patterns to reuse:
  - Company-scoped route `/companies/[companyId]/...`
  - Workspace module registry
  - Permission-aware navigation
  - Feature-local API clients
  - Shared API error/localized message helpers
- Known dependencies:
  - Tailwind CSS v4 in `apps/web/app/globals.css`
  - Generated tokens from `packages/design-tokens`
  - Existing SVG icon components
- Open implementation risks:
  - Prototype route map ไม่ตรงกับ module taxonomy ปัจจุบันทั้งหมด
  - บาง prototype flow ยังไม่มี backend contract ใน repo
  - Browser visual verification ต้องใช้ local stack และ seed data ที่เสถียร

## Implementation Rules

- Follow `docs/specs/mangmee-system-ui-alignment-spec.md`.
- Keep route/controller files thin.
- Reuse common helpers/components before adding feature-specific styling.
- Do not enable unsupported prototype routes with fake mutations.
- Planned prototype routes may be enabled only as read-only placeholders inside the company shell.
- Backend remains source of truth for auth, permission, validation, audit, and persistence.
- Keep Thai copy user-facing and avoid implementation jargon on product screens.

## Scope

### In Scope

- Shared design tokens and generated CSS
- Shared Mangmee components and utility classes
- Workspace shell/header/sidebar alignment
- Page chrome alignment
- Settings, dashboard notification, accounting, tax, and planned-module first pass
- Unit tests for shared visual mapping and ready module state
- Documentation for plan, spec, memory, and Thai summary

### Out of Scope

- Copying the whole HTML prototype into production
- Implementing all prototype-only business flows in one pass
- Changing auth/RBAC backend behavior
- Adding screenshot regression before a stable running local stack exists
- Dark mode

## Role Gates

- BA gate: HTML reference and design handoff are accepted as visual target; current WatchDog product route model remains canonical.
- SA gate: Shared tokens/components are introduced without bypassing route/API/permission boundaries.
- DEV gate: Reusable components are implemented in common layer and adopted by representative pages.
- Integration gate: design-token build/check, web typecheck, and web unit tests pass.

## Phase 0: Discovery and Alignment

### Goal

Confirm the prototype, design handoff, current workspace architecture, API support, and permission model.

### Tasks

- [x] Inspect HTML reference and extracted styles.
- [x] Inspect `../design_handoff_mangmee` route/API/permission files.
- [x] Inspect workspace shell and feature page structure.
- [x] Identify supported modules and avoid unsupported fake routes.

### Tests

- None.

### Exit Criteria

- The implementation path is clear and does not conflict with current backend/permission architecture.

## Phase 1: Shared UI Foundation

### Goal

Create reusable Mangmee style primitives so every page can migrate consistently.

### Tasks

- [x] Add brand, gray, status, radius, and shadow tokens.
- [x] Update design token generator to emit reusable shadow tokens.
- [x] Regenerate web theme CSS.
- [x] Add `MangmeePage`, card, icon, badge, stat, tone, and initials helpers.
- [x] Add global utility classes for page, card, button, input, table, tabs, and shell.

### Tests

- [x] Design token build/check.
- [x] Unit tests for tone mapping.

### Exit Criteria

- Feature pages can adopt Mangmee visuals without inventing new local style systems.

## Phase 2: Shell and Representative Pages

### Goal

Apply the shared UI foundation to the workspace shell and API-backed representative pages.

### Tasks

- [x] Align sidebar, header, workspace shell, company/branch scope controls.
- [x] Align shared page header and list surface.
- [x] Align settings overview.
- [x] Align dashboard notifications.
- [x] Align accounting documents.
- [x] Align tax workspace.
- [x] Align planned-module page.
- [x] Mark accounting/tax ready because current route/API support exists.

### Tests

- [x] Web typecheck.
- [x] Web unit tests.

### Exit Criteria

- Main shell and representative ready/planned pages match the new shared visual language.

## Phase 2B: Latest Company Dashboard Design Refinement

### Goal

Align the live company dashboard at `/companies/seed-local-company/dashboard` with the second design screenshot while preserving WatchDog-BMS auth, RBAC, and company-scoped routes.

### Tasks

- [x] Change sidebar width/spacing and active menu state to match the latest design.
- [x] Change header to branch selector left, bell/avatar right, and remove desktop hamburger/language controls from the company view.
- [x] Replace the company dashboard placeholder with the design-style greeting, KPI cards, branch chip, and quick menu chips.
- [x] Replace the workspace menu registry with the design menu order and labels.
- [x] Add planned placeholder routes for prototype menu items that do not yet have full backend contracts.
- [x] Register `COMPANY_VIEW` in the API permission registry with compact read/menu grants.
- [x] Sync local permissions and verify `Company / Company@123` login.

### Tests

- [x] Web typecheck.
- [x] API typecheck.
- [x] Web unit tests.
- [x] API permission registry unit test.
- [x] Authenticated runtime route checks for dashboard, inbox, and permissions.

### Exit Criteria

- Company mock user sees the latest design menu and dashboard shell without relying on fake backend mutations.

## Phase 3: Remaining Feature Page Migration

### Goal

Move the rest of `apps/web/src/features` to the shared Mangmee page, card, form, table, button, and badge primitives.

### Tasks

- [x] Normalize interactive accents across current feature menus: primary actions, active tabs/filters, action links, and loading indicators use the shared Mangmee brand styles. (2026-07-14)
- [ ] Inventory pages. (Core catalog screens aligned; remaining inventory subpages still need full page-chrome migration.)
- [x] Expenses pages. (2026-07-09 — reskinned to the shared `MangmeePage`/`MangmeeCard`/`mangmee-*` idiom: 5 sub-tabs, finance KPI cards, status chips + search, split rich review panel, category/signature/evidence. See `docs/plans/expenses-mangmee-reskin-plan.md` + `docs/agent-memory/expenses-mangmee-reskin.md`.)
- [ ] CRM pages.
- [ ] Procurement/AP/reimbursement/banking pages.
- [ ] Reports/workflow/AI pages.
- [ ] Employee access advanced screens.
- [ ] Auth/account security pages if visual drift remains.

### Tests

- Web typecheck after each feature group.
- Unit tests for changed feature logic.
- Static regression test prevents legacy blue primary/tab/loading accents from returning in feature TSX files.
- Browser checks for desktop/tablet/mobile after local stack is running.

### Exit Criteria

- No feature page relies on a conflicting local visual pattern unless justified by its domain.

## Phase 4: Prototype Flow/API Expansion

### Goal

Implement prototype-only flows only after the backend contract exists.

### Tasks

- [ ] Choose next flow priority: inbox, bookings, broadcast, PO approval, discount policy, or CRM reports.
- [ ] Add/update backend endpoints and permission seeds.
- [ ] Add feature API clients.
- [ ] Add frontend pages using shared Mangmee components.
- [ ] Add unit/integration tests.

### Tests

- API tests for contracts and permission enforcement.
- Web tests for client helper/logic.
- Browser checks for critical user journeys.

### Exit Criteria

- New prototype flow is usable end to end with real backend support.

## Integration Verification

- Backend/API contract: Existing accounting/tax/dashboard APIs remain used; no fake new API was introduced.
- Web journey: Shell and representative pages are aligned.
- Loading/error/permission states: Existing feature states are preserved.
- E2E/browser screenshot check: Desktop captured; tablet/mobile screenshot capture pending.
- Desktop screenshot check: Playwright with system Chrome passed at `1600x900`; output `/private/tmp/watchdog-company-dashboard-fixed.png`.
- Remaining screenshot check: tablet/mobile capture.
- Runtime smoke check: dev server started at `http://127.0.0.1:3000`; `/` and `/login` return 200; unauthenticated workspace route redirects to login.
- Authenticated company smoke check: `Company / Company@123` login returns 200 and redirects to `/companies/seed-local-company/dashboard`; dashboard, inbox, and settings permissions routes return 200.
- Rendered dashboard HTML check: contains latest design labels including `ทุกสาขา (รวม)`, `สวัสดี นภา`, `฿86,400`, and the prototype menu order.
- Commands:
  - `corepack pnpm --filter @watchdog-bms/design-tokens build`
  - `corepack pnpm --filter @watchdog-bms/design-tokens typecheck`
  - `corepack pnpm --filter @watchdog-bms/design-tokens test`
  - `corepack pnpm --filter @watchdog-bms/web typecheck`
  - `corepack pnpm --filter @watchdog-bms/web test`
  - `corepack pnpm --filter @watchdog-bms/api typecheck`
  - `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/permission-registry.spec.ts`

## Risks

- Migrating every page at once can hide unrelated behavioral regressions. Continue by feature group with focused tests.
- The HTML prototype includes mocked flows. Do not treat mock data as production-ready API behavior.
- Visual parity should be confirmed with screenshots once the app is running locally.

## Open Questions

- Which prototype business flow should become the next backend-backed implementation target?
- Should the product switch from IBM Plex Sans Thai to Noto Sans Thai, or keep the current font stack?
- Should screenshot regression become a required CI check after seed data stabilizes?
