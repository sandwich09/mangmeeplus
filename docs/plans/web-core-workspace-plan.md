# Web Core Workspace Plan

## Linked Spec

- Spec: `docs/specs/web-core-workspace-spec.md`
- Roadmap item: `docs/plans/master-implementation-checklist.md` -> 03. Web Core Workspace
- Related guideline: `docs/guidelines/web-frontend-code-style.md`
- Related specs:
  - `docs/specs/auth-authorization-rbac-spec.md`
  - `docs/specs/permission-matrix.md`
  - `docs/specs/enterprise-architecture-spec.md`
- Local template source:
  - `/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/`

## Purpose

Implement the shared Next.js web workspace foundation before business modules are added.

This plan should give Sonnet 4.6 enough detail to continue implementation without asking for product or architecture direction.

## Alignment Review Result

Review date: 2026-06-23.

- Business alignment: matches product direction. Web is full Business OS workspace; LINE/LIFF remains assistant, alert, auth bridge, and deep-link channel.
- UI alignment: TailAdmin is suitable as dense admin workspace template. Use shell/common primitives only; discard demo ecommerce/auth/pages/charts/images.
- Template alignment: feature and plan templates must require business journey, web/LINE boundaries, permission model, loading/error states, and verification before future implementation handoff.
- Journey alignment: current `/` platform status page stays separate. Company-scoped workspace starts at `/companies/[companyId]/dashboard`; deep links restore context through `companyId`.
- Risk cleaned: notification entry is layout placeholder only in item 03. Item 06 owns real notification data and delivery.

## Current Repository Context

Current web stack:

- `apps/web`: Next.js 15 App Router, React 19, TypeScript, CSS Modules.
- `apps/web/app/page.tsx`: thin route rendering `PlatformFoundationPage`.
- `apps/web/app/layout.tsx`: root metadata and body only.
- `apps/web/src/features/platform-foundation`: current feature pattern example.
- `apps/web/src/common/components/badge`: shared `Badge` primitive.
- `apps/web/src/common/components/layout`: shared `Stack` primitive.
- `apps/web/src/common/styles/theme.css`: imports generated design tokens.
- `packages/design-tokens`: shared token package.

Selected UI template:

- TailAdmin Next.js Free admin dashboard template.
- Local path: `/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/`.
- Local version: `2.3.0`.
- License: MIT.
- Template stack: Next.js 16.x, React 19, TypeScript, Tailwind CSS v4.
- Template strengths to reuse: admin layout, collapsible sidebar, mobile backdrop, sticky header, notification/user dropdowns, breadcrumbs, form controls, table primitives, badges, alerts, modals, dashboard card density, icons, and shell assets.

Repository rules already established:

- Route files stay thin.
- Feature code lives under `apps/web/src/features/<feature>/`.
- Shared UI/API/model/function code lives under `apps/web/src/common/`.
- CSS Modules are used for feature/component styles.
- Feature components do not call `fetch` directly.

Before implementation, inspect latest code again because item 01 and item 02 may add auth/session APIs or new common helpers.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Start point:

1. Read this plan first.
2. Read `docs/specs/web-core-workspace-spec.md`.
3. Read `docs/guidelines/web-frontend-code-style.md`.
4. Inspect `/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/`.
5. Inspect `apps/web`, `packages/design-tokens`, `packages/contracts`, and any auth/session APIs added by item 02.
6. Start at Phase 0: Template Intake and Dependency Alignment.

Do not mark Master Implementation Checklist item 03 complete until Phase 0 through Phase 7 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Use TailAdmin as the primary web UI template for item 03.
- Adapt TailAdmin code into WatchDog names and boundaries; do not replace the monorepo or ignore existing package structure.
- Build shared web shell and patterns before module-specific screens.
- Keep `apps/web/app/**/page.tsx` and `layout.tsx` thin.
- Prefer common components only for cross-feature behavior.
- Use feature-local files for web-core orchestration under `apps/web/src/features/web-core-workspace/`.
- TailAdmin-derived common shell/UI may use Tailwind CSS v4 utilities. Existing non-template components may keep CSS Modules.
- Keep `packages/design-tokens` as WatchDog brand token source. If TailAdmin CSS variables are copied, map them to WatchDog tokens or document why they remain.
- Use server components by default. Add client components only for interactive nav, menus, forms, and stateful controls.
- Do not implement business mutations in this item.
- Do not copy TailAdmin ecommerce demo content, demo auth flow, demo user/country images, calendar, maps, or charts unless needed to prove shell layout.
- Do not upgrade `apps/web` from Next 15 to Next 16 only because TailAdmin uses Next 16. Upgrade only if current Next cannot support selected template integration and blocker is documented.
- Owner approved copying TailAdmin assets/icons into the repo. Preserve MIT license attribution if TailAdmin source, icons, or assets are copied substantially.
- Defer TailAdmin dark mode from item 03. Do not wire theme provider or dark-mode toggle in the first Web Core Workspace pass.
- Do not trust client permission checks for security; backend remains source of truth.
- Each phase must leave `@watchdog-bms/web` typecheckable.

## Role Gates For This Item

- BA gate: web journey supports owner/admin/manager/sales/inventory/finance/accountant/marketing/auditor roles without moving final business actions into LINE.
- SA gate: route, session, permission, API error, deep-link, and component contracts match Auth/RBAC, Permission Matrix, Enterprise Architecture, and module specs.
- DEV gate: smallest correct TailAdmin adaptation; reuse existing `common` and feature patterns; no module-specific business logic.
- Integration gate: verify desktop/mobile shell, Thai/English labels, permission states, cover loaders, and deep-link path behavior through real web routes where possible.

## Scope

### In Scope

- Next.js workspace route group and shared shell.
- TailAdmin template intake and adaptation.
- Tailwind CSS v4/SVGR setup for `apps/web` if direct TailAdmin component use requires it.
- Data-driven module navigation.
- Desktop and mobile responsive navigation.
- Shared page header, breadcrumbs, toolbar, and state components.
- Shared list/detail/form layout primitives.
- Shared web API client and normalized error model.
- Shared cover loader behavior for every API wait or mutation.
- Permission-aware nav, action, readonly, and forbidden UI states.
- Deep-link target builder/parser for core modules.
- Placeholder module landing routes when needed to prove shell integration.
- Unit tests for pure logic and route/deep-link helpers.
- Typecheck/build verification.

### Out of Scope

- Inventory, accounting, tax, CRM, workflow, marketplace, reports, or AI business logic.
- Backend auth/RBAC/audit implementation.
- Database schema changes.
- Notification delivery.
- TailAdmin ecommerce demo dashboard as product dashboard.
- Real dashboards or charts.
- TailAdmin auth flow as WatchDog auth.
- TailAdmin dark mode toggle/provider in item 03.
- Next.js version upgrade unless strictly required and separately verified.
- OCR/upload review.
- Production deployment.
- Full design system documentation or Storybook.

## First Implementation Defaults

Use these defaults unless owner explicitly changes them:

- UI template source: `/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/`.
- Route group: `apps/web/app/(workspace)/`.
- Feature folder: `apps/web/src/features/web-core-workspace/`.
- Common shell components: `apps/web/src/common/components/app-shell/`.
- Common page components: `apps/web/src/common/components/page/`.
- Common state components: `apps/web/src/common/components/state/`.
- Common API helpers: `apps/web/src/common/api/`.
- Deep-link helpers: `apps/web/src/common/functions/deep-link/` or `apps/web/src/common/functions/deep-link.ts` if small.
- Icons: start with TailAdmin bundled SVG icon components when copying/adapting its shell. Add another icon library only when TailAdmin icons are insufficient.
- Styling: use TailAdmin Tailwind v4 for template-derived shell/common UI; keep existing CSS Modules where already present until they are intentionally migrated.
- Dark mode: deferred by owner decision. Keep roadmap backlog entry; do not implement theme toggle/provider in item 03.
- Language: Thai (`th`) is default visible language. Add top-bar language switch to English (`en`). Keep internal ids/route keys/permission keys in English.
- Copy: centralize visible labels/messages in Thai and English dictionaries from the start.
- Use existing token variables from `packages/design-tokens`; add tokens only if a missing token is unavoidable.
- If item 02 session API is missing, use a clearly named local web-core fixture only for shell development. Remove or replace it before item 03 completion.

## Phase 0: Template Intake and Dependency Alignment

### Goal

Make TailAdmin usable inside `apps/web` without breaking monorepo conventions.

### Tasks

- [ ] Inspect TailAdmin local template files before editing.
- [ ] Confirm TailAdmin MIT license and preserve attribution if copying substantial code/assets.
- [ ] Copy TailAdmin icons/assets needed for shell/common UI into `apps/web` when useful; do not copy demo images/routes wholesale.
- [ ] Decide direct Tailwind v4 adoption versus partial CSS Modules port. Default: direct Tailwind v4 adoption for TailAdmin-derived common UI.
- [ ] Add only required web dependencies for template integration, such as `tailwindcss`, `@tailwindcss/postcss`, `tailwind-merge`, and `@svgr/webpack`, if current `apps/web` lacks them.
- [ ] Update `apps/web/next.config.mjs` only if TailAdmin SVG icon imports need SVGR.
- [ ] Update `apps/web/app/globals.css` to load Tailwind v4 and WatchDog token CSS without removing existing token import.
- [ ] Add or map TailAdmin theme variables to WatchDog tokens instead of creating an unmanaged second design system.
- [ ] Do not import TailAdmin demo routes wholesale.
- [ ] Do not upgrade Next/React unless a concrete blocker proves it is required.

### TailAdmin Files to Inspect

```text
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/package.json
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/LICENSE
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/app/layout.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/app/(admin)/layout.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/layout/AppSidebar.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/layout/AppHeader.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/layout/Backdrop.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/context/SidebarContext.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/app/globals.css
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/icons/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/ui/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/form/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/tables/
```

### Tests

- `pnpm --filter @watchdog-bms/web typecheck`
- `pnpm --filter @watchdog-bms/web build` after dependency/style config changes, if dependencies can install.

### Exit Criteria

- Dependency/style path is explicit.
- TailAdmin source files to adapt are known.
- Repo still typechecks or blocker is documented with exact error.

## Phase 1: Workspace Route Group and Shell

### Goal

Create shared workspace frame and route structure that later modules can mount into.

### Tasks

- [ ] Add `apps/web/app/(workspace)/layout.tsx`.
- [ ] Add `apps/web/app/(workspace)/companies/[companyId]/layout.tsx` for company-scoped workspace shell.
- [ ] Add `apps/web/app/(workspace)/companies/[companyId]/dashboard/page.tsx`.
- [ ] Add `apps/web/app/(workspace)/dashboard/page.tsx` only as redirect/default-company entry if session context supports it.
- [ ] Keep root `apps/web/app/page.tsx` as `PlatformFoundationPage` for now; workspace dashboard lives under `/companies/[companyId]/dashboard`.
- [ ] Adapt TailAdmin `src/app/(admin)/layout.tsx` into `WorkspaceShell`.
- [ ] Adapt TailAdmin `AppSidebar`, `AppHeader`, `Backdrop`, and `SidebarContext` into WatchDog common shell components.
- [ ] Add desktop sidebar, sticky topbar, main content area, breadcrumb slot, and action slot.
- [ ] Add top-bar language switch with Thai default and English option.
- [ ] Add TailAdmin-style mobile sidebar/backdrop behavior.
- [ ] Add session/company loading placeholder.
- [ ] Add no-company and signed-out shell states.
- [ ] Remove TailAdmin logo/demo links and replace with WatchDog brand/company context.
- [ ] Keep route files thin and move logic into feature/common files.

### Suggested Files

```text
apps/web/app/(workspace)/layout.tsx
apps/web/app/(workspace)/dashboard/page.tsx
apps/web/app/(workspace)/companies/[companyId]/layout.tsx
apps/web/app/(workspace)/companies/[companyId]/dashboard/page.tsx
apps/web/src/common/components/app-shell/WorkspaceShell.tsx
apps/web/src/common/components/app-shell/WorkspaceShell.model.ts
apps/web/src/common/i18n/workspace-dictionary.ts
apps/web/src/common/i18n/workspace-i18n.logic.ts
apps/web/src/common/i18n/workspace-i18n.model.ts
apps/web/src/features/web-core-workspace/components/WorkspaceDashboardPage.tsx
apps/web/src/features/web-core-workspace/web-core-workspace.model.ts
apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts
apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts
```

### Tests

- `pnpm --filter @watchdog-bms/web typecheck`
- Shell renders with valid session fixture or session adapter.
- Thai is selected by default before any saved preference exists.
- English switch updates visible shell labels.
- Route files remain import-only/thin by inspection.

### Exit Criteria

- TailAdmin-derived workspace shell renders for dashboard route.
- Desktop and mobile frame do not overlap content.
- Shell has clear slots for nav, header, breadcrumbs, page actions, and main content.

## Phase 2: Module Registry and Navigation

### Goal

Make navigation data-driven and permission-aware.

### Tasks

- [ ] Add typed `WorkspaceModule` registry.
- [ ] Add initial modules: dashboard, inventory, accounting, expenses, tax, CRM, reports, workflow, settings.
- [ ] Add nav grouping: operate, finance, growth, admin.
- [ ] Store nav labels as translation keys, not hard-coded visible strings.
- [ ] Add permission requirements per module using permission matrix direction.
- [ ] Add active route detection.
- [ ] Add disabled/planned state for routes that are visible but not implemented.
- [ ] Add company-scoped URL builder for nav links when company context exists.
- [ ] Replace TailAdmin demo nav items such as ecommerce, calendar, profile, forms, tables, pages, charts, UI elements, and authentication.
- [ ] Add tests for permission filtering and active route logic.

### Suggested Permissions

- Dashboard: `dashboard.read` when Dashboard and Notification keys exist; before then, any active company member fixture may see only placeholder dashboard content.
- Inventory: `inventory.product.read`, `inventory.movement.read`, or `inventory.report.read`.
- Accounting: `accounting.document.read`, `accounting.invoice.read`, or `ledger.report.read`.
- Expenses: `expense.read`, `expense.read_own`, `reimbursement.read`, or `reimbursement.read_own`.
- Tax: `tax.period.read`, `tax.report.read`, or `tax.reminder.read`.
- CRM: `crm.customer.read`, `crm.lead.read`, `crm.opportunity.read`, or `crm.report.read`.
- Reports: `report.catalog.read` or `report.query.run`, plus source-module read permission for actual datasets.
- Workflow: `workflow.template.read`, `workflow.rule.read`, `workflow.task.read`, or `workflow.run.read`.
- Settings: `admin.user.manage`, `admin.role.manage`, or company setup admin permission from Auth/RBAC implementation.

If exact permission keys are not implemented yet, define local constants close to the owning spec, mark them provisional, and update them when the module's permission source of truth exists.

### Tests

- Owner/admin permission set sees admin modules.
- Staff-like permission set hides admin modules.
- Thai module labels render by default.
- English module labels render after language switch.
- Direct module route without permission maps to forbidden state.
- Current route marks exactly one active nav item.

### Exit Criteria

- Later modules can register navigation by editing one registry.
- Permission filtering works without hard-coded UI branches.

## Phase 3: Common Page and State Components

### Goal

Create reusable workspace page primitives for future modules.

### Tasks

- [ ] Add `PageHeader` with title, description/status slot, breadcrumbs, and actions.
- [ ] Adapt TailAdmin `PageBreadCrumb` into `Breadcrumbs`/`PageHeader`.
- [ ] Adapt TailAdmin button/badge/alert/modal primitives into WatchDog common components.
- [ ] Add `ActionToolbar` for search/filter/action layout.
- [ ] Add `EmptyState`.
- [ ] Add `LoadingState`.
- [ ] Add `CoverLoader` overlay component for page, section, table, form, modal, and full-workspace scopes.
- [ ] Add `ErrorState`.
- [ ] Add `ForbiddenState`.
- [ ] Add common i18n helper for `th`/`en` dictionary lookup and missing-key fallback.
- [ ] Add `Button` and `IconButton` from TailAdmin-derived visual style.
- [ ] Extend `Badge` variants only if needed for status/severity.
- [ ] Use TailAdmin Tailwind classes or mapped WatchDog token CSS consistently for these common primitives.

### Suggested Files

```text
apps/web/src/common/components/page/
apps/web/src/common/components/state/
apps/web/src/common/components/button/
apps/web/src/common/i18n/
```

### Tests

- Typecheck.
- Component props enforce accessible labels for icon-only actions.
- Error state supports retry action.
- Forbidden state can render readonly/help text without exposing sensitive details.
- `CoverLoader` can cover page, section/table, form, modal, and full-workspace scopes.
- `CoverLoader` label renders in Thai and English.
- Common state/page components can render Thai and English labels.

### Exit Criteria

- Future modules can build first screens without duplicating header, toolbar, and state UI.

## Phase 4: List, Detail, and Form Patterns

### Goal

Provide reusable layout patterns for dense Business OS screens.

### Tasks

- [ ] Add list page layout primitive with toolbar, content slot, empty/loading/error states, and pagination slot.
- [ ] Add detail page layout primitive with summary, action slot, related records slot, and audit/source slot.
- [ ] Add form page layout primitive with field area, validation summary slot, and sticky or stable action bar.
- [ ] Wire list/table layout to show `CoverLoader` while search/filter/sort/page requests are pending.
- [ ] Wire detail layout to show `CoverLoader` while detail refresh or related-record requests are pending.
- [ ] Wire form layout to show `CoverLoader` while submit/save/delete/confirm requests are pending.
- [ ] Disable covered actions while pending to prevent duplicate API calls.
- [ ] Adapt TailAdmin form input/select/textarea/switch patterns for shared form controls.
- [ ] Adapt TailAdmin table and pagination primitives for shared list/table layouts.
- [ ] Add typed list query model for search, filters, sort, page/cursor.
- [ ] Add pure helper to serialize/deserialize list query to URL search params.
- [ ] Add example module landing pages using the patterns without business logic.

### Suggested Files

```text
apps/web/src/common/components/data-table/
apps/web/src/common/components/form-layout/
apps/web/src/common/functions/list-query.ts
apps/web/src/common/models/list-query.model.ts
```

### Tests

- List query helpers preserve search, filter, sort, and cursor/page.
- Empty, loading, error, and forbidden states keep stable layout.
- List/table pending request renders cover loader and disables pagination/filter controls.
- Form submit pending request renders cover loader and disables submit/cancel/destructive controls as appropriate.
- Typecheck.

### Exit Criteria

- Inventory and accounting can implement list/detail/form screens by composing shared primitives.

## Phase 5: API Client, Error Mapping, and Permission UI

### Goal

Create shared web client behavior and normalized UI state for auth/permission/API errors.

### Tasks

- [ ] Add shared `http-client.ts` under `apps/web/src/common/api/`.
- [ ] Add typed `ApiError`, `ValidationError`, and `RequestContext` models.
- [ ] Add response mapper for `401`, `403`, `404`, validation, and unknown errors.
- [ ] Add request pending-state helper/hook or typed API wrapper so all API waits can drive `CoverLoader`.
- [ ] Add request id handling if backend contract exists.
- [ ] Add selected company hint handling if backend contract exists.
- [ ] Revalidate the active access context on a bounded visible-page interval, focus return, and stable permission/feature denial; refresh navigation only when roles, permissions, entitlement-filtered permissions, or branch scope changed.
- [ ] Add `PermissionState` helpers for allowed, readonly, forbidden, signed-out.
- [ ] Add field error mapper for form patterns.
- [ ] Document no-silent-wait rule: every feature API call must expose pending state to a cover loader.
- [ ] Ensure API helpers do not log secrets or raw sensitive payloads.

### Tests

- `401` maps to signed-out/session-expired state.
- `403` maps to forbidden state.
- Permission/feature `403` triggers access-context revalidation but never retries the denied request.
- `404` maps to not-found state.
- Validation response maps to field errors.
- Unknown response maps to generic error with request id when present.
- Permission helper returns readonly when read is allowed but mutation is not.
- Pending API request exposes pending state with scope and label key.
- Pending mutation blocks duplicate action until response settles.

### Exit Criteria

- Feature API files can reuse one HTTP/error behavior.
- UI states from auth and permission failures are consistent across modules.
- Future feature screens have a standard way to show cover loaders for every API wait.

## Phase 6: Deep Links and Module Landing Routes

### Goal

Make URLs from LINE, AI citations, notifications, and copied links resolve consistently.

### Tasks

- [ ] Add `DeepLinkTarget` type.
- [ ] Add `buildDeepLinkPath(target)` pure helper.
- [ ] Add parser for supported company-scoped paths.
- [ ] Add target types from spec: dashboard, product, stockMovement, invoice, expense, taxPeriod, customer, approval, report, settingsUser.
- [ ] Add module landing routes needed to prove shell navigation.
- [ ] Add not-found/forbidden routing behavior for unsupported or unauthorized paths.
- [ ] Add tests for core target paths and invalid targets.

### Tests

- Product target builds `/companies/[companyId]/inventory/products/[productId]`.
- Invoice target builds `/companies/[companyId]/accounting/invoices/[invoiceId]`.
- Approval target builds `/companies/[companyId]/approvals/[approvalId]`.
- Report target builds `/companies/[companyId]/reports/[reportKey]`.
- Unknown target is rejected.
- Missing required id is rejected.

### Exit Criteria

- Future LINE alerts and AI citations can deep link into web without route redesign.

## Phase 7: Responsive QA, Accessibility, and Verification

### Goal

Verify shell is usable and safe to extend.

### Tasks

- [ ] Check desktop width around 1440px.
- [ ] Check tablet width around 768px.
- [ ] Check mobile width around 390px.
- [ ] Confirm no text/control overlap in nav, topbar, buttons, and page headers.
- [ ] Confirm cover loader appears above page/table/form/modal content without hiding essential context permanently.
- [ ] Confirm covered controls cannot trigger duplicate API calls while pending.
- [ ] Confirm root `/` platform status page is not confused with the Business OS dashboard.
- [ ] Confirm TailAdmin demo routes/content are absent from product navigation.
- [ ] Confirm notification entry is non-data placeholder or hidden until item 06 provides real data.
- [ ] Confirm Thai labels fit nav, topbar, buttons, table headers, empty states, and mobile layout.
- [ ] Confirm English labels fit nav, topbar, buttons, table headers, empty states, and mobile layout.
- [ ] Confirm keyboard focus reaches nav, company switcher, user menu, and main actions.
- [ ] Confirm icon-only actions have accessible labels.
- [ ] Run web typecheck.
- [ ] Run web tests.
- [ ] Run web build if dependencies/environment allow.
- [ ] Record verification commands and results in implementation notes or final handoff.

### Tests

- `pnpm --filter @watchdog-bms/web typecheck`
- `pnpm --filter @watchdog-bms/web test`
- `pnpm --filter @watchdog-bms/web build`

### Exit Criteria

- Typecheck passes.
- Relevant tests pass.
- Build passes or blocker is documented with exact error.
- Responsive shell is visually checked.

## Implementation Order

1. Inspect TailAdmin template source and confirm license/dependency needs.
2. Re-read current `apps/web` and token files.
3. Confirm whether auth/session API from item 02 exists.
4. Align Tailwind/SVGR/theme setup if direct TailAdmin component use requires it.
5. Add workspace route group and TailAdmin-derived shell.
6. Add module registry and permission-aware navigation.
7. Add common page/state primitives.
8. Add list/detail/form patterns.
9. Add API client and error mapping.
10. Add deep-link helpers.
11. Add placeholder module landing routes only as needed to verify shell.
12. Run typecheck/tests/build.
13. Update checklist only after implementation and verification are complete.

## Integration Verification

- Backend/API contract: verify session/company/permission fixtures or real Auth/RBAC item 02 contracts before marking item 03 done.
- Web journey: exercise root platform status, company-scoped dashboard, module nav, language switch, and direct forbidden route where implementation exists.
- Loading/error/permission states: verify full-workspace, page/table/form/modal cover loaders and forbidden/empty/error states.
- E2E/browser check: use existing browser automation or manual browser QA across desktop, tablet, and mobile widths; do not add a new E2E dependency without owner approval.
- Commands: record `pnpm --filter @watchdog-bms/web typecheck`, relevant tests, build result or exact blocker.

## Files to Inspect First

```text
apps/web/package.json
apps/web/app/layout.tsx
apps/web/app/page.tsx
apps/web/app/globals.css
apps/web/src/common/styles/theme.css
apps/web/src/common/components/
apps/web/src/features/platform-foundation/
packages/design-tokens/tokens.json
packages/design-tokens/generated/web/theme.css
packages/contracts/src/index.ts
docs/guidelines/web-frontend-code-style.md
docs/specs/auth-authorization-rbac-spec.md
docs/specs/permission-matrix.md
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/package.json
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/LICENSE
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/app/(admin)/layout.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/layout/AppSidebar.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/layout/AppHeader.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/context/SidebarContext.tsx
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/app/globals.css
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/icons/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/ui/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/form/
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/src/components/tables/
```

## Risks

- Implementing module-specific UI too early can lock future modules into wrong patterns.
- TailAdmin uses Next.js 16 while repo currently uses Next.js 15; avoid unnecessary framework upgrade.
- TailAdmin uses Tailwind v4 while repo currently uses CSS Modules and generated token CSS; integration must keep one understandable styling path.
- Relying on client-side permission checks can create false security. Backend checks remain mandatory.
- Adding many common components before second use can create unused abstraction. Keep primitives small.
- Company-scoped routes may need migration if owner later wants slug URLs.
- Auth/session API may not exist yet if item 02 implementation is incomplete.
- Mobile nav can easily overlap long Thai or company names without stable dimensions.

## Deferred Decisions

- Company URL key: keep opaque `companyId` for item 03. Slug migration is later scope if owner needs human-readable URLs.
- Settings route in item 03 should be shell placeholder only unless Auth/RBAC item 02 already exposes user/role screens to mount.

## Definition of Done

- TailAdmin-derived workspace shell and route group exist.
- Navigation is data-driven and permission-aware.
- Product journey remains web-first and LINE/LIFF stays assistant/deep-link only.
- Shared page, state, list/detail/form, API, and deep-link patterns exist.
- Future modules can plug into web patterns without redesign.
- Web code follows frontend guideline.
- Typecheck and relevant tests pass.
- Build passes or exact environment blocker is documented.
