# Agent Memory: Web Core Workspace (03)

Status: COMPLETE / VERIFIED (2026-06-24)
Owner: Codex
Scope: apps/web - Web Core Workspace item 03, phases 0-7

## Role gate status:
- BA: Goal/users/journey/rules accepted from docs/specs/web-core-workspace-spec.md and docs/plans/web-core-workspace-plan.md. Web remains full Business OS workspace for owner/admin/manager/sales/inventory/finance/marketing/auditor roles; LINE stays assistant/alert/deep-link only. Acceptance criteria checked against spec section 22.
- SA: Route group, module registry, permission-aware nav, common API error mapping, deep-link builder/parser, i18n, and shared page/list/detail/form/modal/field/table patterns fit existing Next.js App Router + common/feature split. No data model or backend contract changes.
- DEV: Ponytail read. Smallest corrective diff after review: localize/persist shell language, add missing accessibility and common primitives, fix loader coverage, and keep TailAdmin attribution aligned. Touched files listed below. Focused checks pass.
- Integration: Backend-to-frontend boundary remains fixture/session-ready only; no business APIs added. Web browser QA covered root workspace route at desktop/tablet/mobile, language toggle/persistence, active nav, skip link, mobile sidebar/backdrop, and horizontal overflow.

## Decisions
- Tailwind v4 adopted for all TailAdmin-derived shell/common components; existing CSS Modules left in place for PlatformFoundationPage
- @svgr/webpack added to apps/web for SVG icon imports as React components
- TailAdmin icons copied under apps/web/src/common/icons/ with MIT attribution (ATTRIBUTION.md)
- angle-left.svg and angle-right.svg were empty in source — replaced with minimal inline SVG paths
- Next.js NOT upgraded: stays on Next 15 (TailAdmin Next 16 components work fine as-is)
- Dark mode deferred per plan decision
- Thai ('th') is default locale; English switch available in shell header
- Workspace locale persists in `localStorage` key `watchdog.workspace.locale`; page content i18n can move to cookie/server routing in a later item.
- Sidebar group headings are dictionary-backed and active nav links expose `aria-current="page"`.
- Workspace shell includes skip link to `#workspace-main`.
- Shared ActionToolbar, DataTable, Modal, and field primitives were added because item 03 explicitly requires common toolbar/table/modal/form patterns.
- params is Promise<{...}> in Next.js 15 dynamic layouts — await params in async layout/page
- All permission checks on web are UX-only; backend remains source of truth

## Artifacts

### Phase 0 — Deps & Setup
- apps/web/postcss.config.mjs — Tailwind v4 postcss plugin
- apps/web/next.config.mjs — @svgr/webpack rule
- apps/web/app/globals.css — tailwindcss + design tokens
- apps/web/src/common/icons/ — TailAdmin SVGs + index.tsx barrel + ATTRIBUTION.md
- apps/web/src/types/svg.d.ts — SVG module declaration for SVGR

### Phase 1 — Shell
- src/common/i18n/workspace-dictionary.ts — th/en dictionary
- src/common/i18n/workspace-i18n.logic.ts — t() helper
- src/common/components/app-shell/ — SidebarContext, AppSidebar, AppHeader, Backdrop, WorkspaceShell
- src/features/web-core-workspace/WorkspaceLayout.tsx — client layout wrapper
- app/(workspace)/layout.tsx — group passthrough
- app/(workspace)/companies/[companyId]/layout.tsx — async, awaits params
- app/(workspace)/companies/[companyId]/dashboard/page.tsx
- src/features/web-core-workspace/components/WorkspaceDashboardPage.tsx — placeholder

### Phase 2 — Navigation
- web-core-workspace.model.ts — WorkspaceModule, NavItem, NavGroup types
- web-core-workspace.constants.ts — 9-module registry + NAV_GROUP_ORDER
- web-core-workspace.logic.ts — filterModulesByPermissions, buildNavItems, getActiveModuleKey, groupNavItems

### Phase 3 — Components
- src/common/components/button/ — Button, IconButton
- src/common/components/page/ — PageHeader, ActionToolbar
- src/common/components/state/ — CoverLoader, LoadingState, EmptyState, ErrorState, ForbiddenState
- src/common/components/modal/ — Modal with escape close and focus trap
- src/common/components/field/ — TextField, SelectField, TextareaField, SwitchField, FieldError

### Phase 4 — Patterns
- src/common/models/list-query.model.ts — ListQuery, PaginationMeta
- src/common/functions/list-query.ts — serialize/deserialize
- src/common/components/data-table/ — DataTable, ListPageLayout, DetailPageLayout, FormPageLayout, Pagination

### Phase 5 — API Client
- src/common/models/api-error.model.ts — ApiError class
- src/common/models/permission-state.model.ts — PermissionState
- src/common/models/web-session.model.ts — WebSession, SessionState
- src/common/api/api-error.logic.ts — mapResponseToApiError, resolvePermissionState
- src/common/api/http-client.ts — HttpClient class + createWebApiClient

### Phase 6 — Deep Links + Landing
- src/common/functions/deep-link.ts — DeepLinkTarget, buildDeepLinkPath, parseDeepLinkPath
- 8 stub module pages (inventory, accounting, expenses, tax, crm, reports, workflow, settings)
- app/(workspace)/companies/[companyId]/not-found.tsx

## Verification:
- `pnpm --filter @watchdog-bms/web typecheck`: pass
- `pnpm --filter @watchdog-bms/web test`: first sandbox run failed with `listen EPERM` on tsx IPC pipe under `/var/folders/.../T`; escalated rerun passed 73/73.
- `pnpm --filter @watchdog-bms/web build`: pass, 11 app routes rendered.
- Browser QA with local dev server `http://127.0.0.1:3000/companies/demo-company/dashboard`:
  - Desktop 1440x900: Thai default nav/page, skip link, active dashboard link, no horizontal overflow.
  - Locale switch: Thai -> English updates shell labels; reload restores English after hydration from saved preference.
  - Mobile 390x844: no horizontal overflow; sidebar opens with backdrop and active link; closed sidebar clears backdrop.
  - Tablet 768x900: no horizontal overflow; active link and header controls visible.
- `pnpm agent:gates -- docs/agent-memory/web-core-workspace-03.md`: pass.

## Responsive shell
- Desktop (1440px): ml-[290px] expanded / ml-[90px] collapsed — Tailwind transitions
- Mobile (390px): isMobileOpen controls backdrop and sidebar overlay
- Thai labels: all shell labels + module names available in 'th' dictionary

## Next:
- 04. Data Model Core (multi-tenant branch/product/customer schema)
- Real session fetch wired into WorkspaceLayout via GET /v1/auth/me (item 02 provides endpoint)
