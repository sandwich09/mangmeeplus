# Agent Memory: mangmee-system-ui-alignment

Status: Implemented first production UI alignment pass, company dashboard/sidebar refinement, permissions matrix page, individual permissions page, PO approval settings visual alignment, and current-feature interactive accent normalization.
Owner: Codex main thread acting as senior software engineer.
Scope: Align WatchDog-BMS web workspace with the Mangmee HTML reference while preserving current repository route, permission, API, and component boundaries.

## Source References

- Visual reference: `/Users/bombam/Downloads/มั่งมี-ระบบทั้งหมด (เปิดได้ทุกเครื่อง).html`
- Design handoff folder: `../design_handoff_mangmee`
- Route map: `../design_handoff_mangmee/routes.md`
- API contract: `../design_handoff_mangmee/api.ts`
- Permission model: `../design_handoff_mangmee/permissions.ts`

## Decisions

- Treat the HTML as the visual source of truth, not as production code to copy.
- Keep WatchDog-BMS company-scoped routing under `/companies/[companyId]/...` instead of introducing prototype routes such as `/dashboard` or `/settings/permissions` outside the existing workspace shell.
- Do not add prototype-only menus unless the current backend, permission registry, and route model can support them safely.
- Prototype-only menu routes may exist as planned read-only workspace pages when they are permission-aware and do not fake backend mutations.
- Centralize reusable Mangmee UI primitives under `apps/web/src/common/components/mangmee`.
- Centralize visual tokens in `packages/design-tokens` and regenerate `packages/design-tokens/generated/web/theme.css`.
- Reuse existing module registry and permission helpers for the sidebar. The Mangmee reference menu colors are mapped to current WatchDog module keys/groups through a shared helper.
- The latest design screenshot is the sidebar/header/company dashboard acceptance target: 289px sidebar, compact branch selector in header, bell/avatar on the right, greeting `สวัสดี นภา`, KPI cards, and quick menu chips.
- `COMPANY_VIEW` is now a real system role in the API permission registry for the local Company mock account. It is intentionally compact to keep JWT cookies small while still showing the full prototype company menu.
- Keep profile menu behavior aligned with auth UX guidance: `Reset password` remains above `ออกจากระบบ`.
- Mark `accounting` and `tax` as ready because the repository already has feature pages and API clients for those modules.
- Settings navigation follows the latest design as one expandable `สิทธิ์การใช้งาน` parent with child rows for `รายบุคคล`, `เพิ่มพนักงาน`, `อนุมัติคำสั่งซื้อ`, `นโยบายส่วนลด`, and `การแจ้งเตือน`.
- Keep the active state on the selected child row for settings subpages such as PO approval, while the parent stays expanded without becoming a second active row.
- The child row `รายบุคคล` routes to `/companies/[companyId]/settings/access-overview` and renders the design-aligned `สิทธิ์รายบุคคล` screen. The parent `/settings/permissions` remains the role permission matrix screen.
- The current backend has purchase order approval actions, but no dedicated persisted settings contract for amount-based PO approval thresholds. The PO approval settings page therefore uses a shared frontend model for the design/demo flow and does not perform fake save mutations.
- Interactive hierarchy is now consistent across current feature menus: primary actions reuse `mangmee-btn-primary`; active tabs, filters, action links, and loading indicators use the Mangmee brand accent. Blue remains allowed for semantic informational/status states only.

## Implementation Notes

- Shared helpers:
  - `apps/web/src/common/components/mangmee/mangmee-design.ts`
  - `apps/web/src/common/components/mangmee/MangmeePage.tsx`
  - `apps/web/src/common/components/mangmee/index.ts`
- Global styling:
  - `apps/web/app/globals.css`
  - `packages/design-tokens/tokens.json`
  - `packages/design-tokens/scripts/build-tokens.mjs`
  - `packages/design-tokens/generated/web/theme.css`
- Workspace shell:
  - `apps/web/src/common/components/app-shell/AppSidebar.tsx`
  - `apps/web/src/common/components/app-shell/AppHeader.tsx`
  - `apps/web/src/common/components/app-shell/WorkspaceShell.tsx`
  - `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`
- Workspace module/menu registry:
  - `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.model.ts`
  - `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx`
- Company mock role/permissions:
  - `apps/api/src/modules/auth/permission-registry.ts`
  - `apps/api/src/modules/auth/permission-registry.spec.ts`
- Page-level adoption:
  - `apps/web/src/common/components/page/PageHeader.tsx`
  - `apps/web/src/common/components/data-table/ListPageLayout.tsx`
  - `apps/web/src/features/web-core-workspace/components/PlannedModulePage.tsx`
  - `apps/web/app/(workspace)/companies/[companyId]/settings/page.tsx`
  - `apps/web/src/features/dashboard-notifications/DashboardPages.tsx`
  - `apps/web/src/features/accounting-documents/AccountingPages.tsx`
  - `apps/web/src/features/tax/TaxWorkspacePage.tsx`
- Latest design-dashboard pass:
  - `apps/web/src/features/dashboard-notifications/DashboardPages.tsx`
  - `apps/web/src/common/icons/bell.svg`
  - Planned company routes under `apps/web/app/(workspace)/companies/[companyId]/...` for inbox, sales, customers, bookings, CRM reports, broadcast, journal, sales documents, period closing, and settings subroutes.
- Latest permissions-page pass:
  - `apps/web/app/(workspace)/companies/[companyId]/settings/permissions/page.tsx`
  - `apps/web/src/features/employee-access/PermissionMatrixPrototypePage.tsx`
  - `apps/web/src/features/employee-access/permission-matrix-prototype.model.ts`
  - `apps/web/src/features/employee-access/permission-matrix-prototype.model.spec.ts`
- Latest individual-permissions pass:
  - `apps/web/app/(workspace)/companies/[companyId]/settings/access-overview/page.tsx`
  - `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
  - `apps/web/src/features/employee-access/individual-permissions-prototype.model.ts`
  - `apps/web/src/features/employee-access/individual-permissions-prototype.model.spec.ts`
- Latest PO approval settings pass:
  - `apps/web/app/(workspace)/companies/[companyId]/settings/po-approval/page.tsx`
  - `apps/web/src/features/employee-access/PoApprovalSettingsPage.tsx`
  - `apps/web/src/features/employee-access/po-approval-settings.model.ts`
  - `apps/web/src/features/employee-access/po-approval-settings.model.spec.ts`
  - Reused `MangmeeBranchChip` from `apps/web/src/common/components/mangmee/MangmeePage.tsx`
  - Settings submenu logic in `apps/web/src/common/components/app-shell/AppSidebar.tsx` and `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`

## Verification

- 2026-07-14 interactive-theme pass:
  - `node --import tsx --test src/common/components/mangmee/mangmee-interactive-theme.spec.ts` passed (1/1).
  - `node --import tsx --test src/**/*.spec.ts` passed (272/272).
  - `corepack pnpm --filter @watchdog-bms/web typecheck` passed.
  - `git diff --check` passed; source audit found no legacy blue primary/tab/loading accent in feature TSX files.
  - Local browser reached the real login UI with web/API running on ports 3001/3000, but both seeded dev login and password login returned HTTP 500 in the current local runtime. Authenticated visual smoke is therefore pending and not claimed as passed; this matches the existing local-runtime blocker recorded for other recent browser passes.

- `corepack pnpm --filter @watchdog-bms/design-tokens build` passed.
- `corepack pnpm --filter @watchdog-bms/web typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/web test` passed with 163 tests.
- `corepack pnpm --filter @watchdog-bms/api typecheck` passed.
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/permission-registry.spec.ts` passed with 7 tests.
- Permission sync completed locally: 301 permissions, 12 roles, 1162 role grants upserted.
- `Company / Company@123` login returned 200 and redirects to `/companies/seed-local-company/dashboard`.
- Local DB `COMPANY_VIEW` role has 23 grants and no platform `system.*` permissions.
- Local web dev server started at `http://127.0.0.1:3000`.
- Runtime route checks:
  - `HEAD /` returned 200.
  - `HEAD /login` returned 200.
  - `HEAD /companies/demo/dashboard` returned 307 to `/login?next=%2Fcompanies%2Fdemo%2Fdashboard&fresh=1`, which matches the auth guard.
  - Authenticated `HEAD /companies/seed-local-company/dashboard` returned 200.
  - Authenticated `HEAD /companies/seed-local-company/inbox` returned 200.
  - Authenticated `HEAD /companies/seed-local-company/settings/permissions` returned 200.
  - Captured rendered dashboard HTML contained the latest design menu labels, branch selector `ทุกสาขา (รวม)`, greeting `สวัสดี นภา`, and KPI value `฿86,400`.
  - Playwright desktop screenshot using system Chrome passed at `1600x900`; output: `/private/tmp/watchdog-company-dashboard-fixed.png`.
  - Bell icon render bug was fixed by changing `apps/web/src/common/icons/bell.svg` from `fill="none"` to `fill="currentColor"`.
- Permissions page screenshot using system Chrome passed at `1600x900`; output: `/private/tmp/watchdog-permissions-matrix-final.png`.
- Focused permissions matrix model test passed with 3 tests; web typecheck passed.
- Focused PO approval/settings navigation tests passed with 17 tests.
- Individual permissions screenshot using system Chrome passed at `1600x900`; output: `/private/tmp/watchdog-individual-permissions-final.png`.
- Web test suite passed with 173 tests after adding individual permissions page.

## CRM suite + login channels pass (2026-07-07)

- Shared prototype dataset transcribed 1:1 from the reference HTML into
  `apps/web/src/features/crm/mangmee-crm-data.ts` (branches, status/tier metadata,
  14 conversations, 14 customers, seed messages, seed bookings, staff-color hash).
  All CRM prototype pages import it; visuals are Tailwind + `mangmee-*` primitives.
- New prototype pages (client-side state only, no fake backend mutations), each with a
  pure `.model.ts` + node:test spec:
  - Inbox `/inbox`: `crm-inbox/InboxPrototypePage.tsx` + `inbox-prototype.model.ts` —
    status chips with live counts (incl. เกิน 30 นาที + 🤖 อัตโนมัติ), search, 10/page
    pagination, AI auto-reply for score>80, thread with slip verification (c8), status
    dropdown + auto-transitions (send→รอลูกค้า, slip→กำลังคุย, AI booking→ปิดแล้ว),
    reply/note composer, AI panel (Auto-AI toggles per customer, read-only discount %
    linking to discount policy, booking widget with deterministic slot hash), customer
    360 panel. Accepts `?conv=` deep link (used by Customers → เปิดแชท).
  - Customers `/customers`: `crm/CustomersPrototypePage.tsx` — KPI cards, search +
    tier chips, LTV-sorted table, profile modal with เปิดแชท deep link.
  - Bookings `/bookings`: `crm/BookingsPrototypePage.tsx` — 09:00–20:00 week grid,
    week navigation with Thai tags, create-booking modal, past-slot disable,
    mobile 7-day-chip day view.
  - CRM Reports `/crm-reports`: `crm/CrmReportsPrototypePage.tsx` — KPI cards, status
    bars, top-5 LTV customers, per-staff performance.
  - Broadcast `/broadcast`: `crm/BroadcastPrototypePage.tsx` — AI composer (5 tones ×
    exact `genBroadcast` strings, 5 poster gradients, segments with live counts,
    3 generated options), manual mode with image upload, send state, past campaigns.
  - Discount policy `/settings/discount-policy`: `employee-access/DiscountPolicyPage.tsx`
    — master toggle, default/ceiling steppers (clamped), per-tier %, override radio,
    saved/dirty save button; source of the read-only % shown in the inbox Auto-AI card.
- Login channels: `auth/LoginPage.tsx` now has the prototype method tabs
  (อีเมล/รหัสผ่าน · เบอร์มือถือ+OTP 60s countdown/resend/inline errors) and the LINE QR
  modal (60s auto re-QR, deterministic `buildQrCells` in `auth.logic.ts`). Both are
  gated behind `SHOW_PROTOTYPE_CHANNELS` (non-production) because the backend has no
  phone-OTP/LINE-login contract; OTP success completes via the dev-owner session.
  Prototype demo-account tiles were intentionally not added (covered by dev sign-in).

### Verification (2026-07-07)

- `corepack pnpm --filter @watchdog-bms/web test`: 219 tests pass (44 new across
  inbox/customers/bookings/reports/broadcast/discount/auth specs).
- `corepack pnpm --filter @watchdog-bms/web typecheck`: clean.
- Playwright (system Chrome) screenshots via dev server at desktop 1600×900,
  tablet 834×1112, mobile 390×844 for login (3 states), dashboard, permissions,
  access-overview, po-approval, customers, bookings, crm-reports, broadcast,
  discount-policy, inbox (empty/c8-slip/c4-VIP/tablet/mobile list+thread):
  `/tmp/mangmee-shots/`. Inbox collapses 3→2→1 panes; bookings switches to day view;
  two-column layouts stack below 1024px; wide tables scroll inside their cards.

## Follow-up

- `เพิ่มพนักงาน` still uses the real-backend `EmployeeAccessPages` create form, not the
  prototype's 4-step wizard visual — restyle needs its own spec/plan (real contract).
- Role add/edit/delete modals on the permission matrix page remain visual-only.
- Branch switcher does not re-scope the CRM mock dataset (pages render the ทุกสาขา
  aggregate view, matching the prototype's owner default); wire real scoping with the
  backend contract.
- Continue migrating remaining feature pages to `MangmeePage`, `MangmeeCard`,
  `mangmee-table`, `mangmee-input`, and `mangmee-btn`.
- Convert planned menu routes to full features only after backend contracts,
  permissions, API clients, and audit behavior are implemented.

## Deploy (2026-07-08)

- Deployed HEAD (`ef93ddb1`, merge of PR #6 "redesign-ui-and-remove-menu-fogot-password"
  on top of `73dd44fd` "feat: complete Mangmee prototype screens") — the only unshipped
  code since the last deploy (`df49a553`, feature-entitlement work) was confined to
  `apps/web` (dashboard, AppSidebar, employee-access/individual-permissions prototypes,
  new `MangmeeModulePrototypePage`, globals.css). No ai-gateway/workers changes, so
  deployed `api-web` only via `infra/prod-ecs-express/deploy.sh api-web`. Working tree
  had unrelated dirty `docs/plans`/`docs/specs` changes (another concurrent session's
  CRM-LINE work in progress) — left untouched, out of Docker build context, not swept in.
- Image `watchdog-bms-api:ecs-api-web-ef93ddb1-20260708230509`. Canary bake ran
  IN_PROGRESS ~9 min → single deployment, task-def revision `:68`, RollbackAlarm stayed
  OK (no rollback). Monitored via `ecs describe-services` only, did not probe the
  endpoint during bake.
- Verified after promotion: one GET https://mangmeeplus.com/v1/health → 200
  `{"status":"ok","db":"ok"}`.
