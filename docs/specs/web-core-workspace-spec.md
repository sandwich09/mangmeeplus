# Web Core Workspace Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 03.

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Define the shared Next.js web workspace shell for full Business OS work so later modules can plug in without inventing their own layout, navigation, page structure, permission states, list/detail/form patterns, or deep-link rules.

Web is the full workspace for create, update, approve, report, export, setup, review, and audit-heavy workflows. LINE is only the AI assistant, summary, alert, account-linking, and deep-link channel.

### Alignment Summary

- Business alignment: matches [[product/vision|Product Vision]] and [[specs/sme-business-os-overview|SME Business OS Overview]]: web owns full work, source records, review, approvals, reports, and setup; LINE/LIFF only assists, alerts, links, and bridges auth.
- UI alignment: TailAdmin is used only as dense admin workspace structure and common UI primitives. TailAdmin demo ecommerce/auth/pages are not product requirements.
- Journey alignment: current root `PlatformFoundationPage` remains bootstrap/status only. Company-scoped workspace dashboard starts at `/companies/[companyId]/dashboard`.
- Security alignment: web permission checks improve UX only; backend Auth/RBAC and module APIs enforce access, ABAC, validation, audit, and final mutations.
- Implementation alignment: item 03 creates shell/patterns/deep links/API client only. Business module logic starts in later checklist items.

### Canonical Web Journey

1. User signs in or resumes a first-party session from Auth/RBAC item 02.
2. Web loads current user, company memberships, selected company, roles, permissions, and locale with a full-workspace cover loader.
3. User selects company when multiple memberships exist.
4. Workspace shell renders TailAdmin-derived sidebar, topbar, breadcrumbs, page title/actions, and main content.
5. Navigation shows only modules allowed by the user's permission view. Direct unauthorized routes show `ForbiddenState`.
6. User opens dashboard or a module list/detail/form. Business modules use shared page, list, detail, form, state, and API patterns.
7. Every API wait shows the smallest safe cover loader and disables covered actions.
8. LINE alerts, AI citations, notifications, and copied links open company-scoped web routes. Deep links never perform final mutations.

## 3. Non-goals

- Implementing inventory, accounting, CRM, tax, reports, marketplace, workflow, or AI business logic.
- Replacing backend auth, RBAC, audit, or API enforcement. Web can reflect permissions, but server remains source of truth.
- Building advanced BI dashboards, charts, document editors, OCR review, or import workflows.
- Building mobile-native apps. Web must be responsive, but native mobile remains out of scope.
- Adding staging, production deployment, or infrastructure work.
- Adding a full external design system or Storybook unless owner asks later.

## 4. User Roles

- Owner: uses workspace navigation, dashboard entry, approvals, reports, settings, and audit surfaces.
- Admin: configures company setup, users, roles, module settings, and master data.
- Manager: reviews team queues, approval tasks, exceptions, and module records.
- Sales: works sales/CRM records and opens quotations or follow-up tasks.
- Inventory staff: works stock, product, location, scan, and movement pages.
- Finance/accountant: works accounting, expense, tax, export, and report pages.
- Marketing: works campaign drafts and marketplace/marketing surfaces later.
- Auditor readonly: reads reports, records, and audit trail without mutation.

## 5. Boundary and Ownership

The web core owns:

- Workspace app shell.
- Route group conventions.
- Navigation model and module registry.
- Shared page chrome.
- Shared list/detail/form layouts.
- Shared empty/loading/error/forbidden states.
- Shared action toolbar patterns.
- Shared deep-link path builder/parser.
- Shared HTTP client behavior for web features.
- Shared permission-aware UI helpers.
- Responsive layout and accessibility baseline.

Business modules own:

- Module-specific domain records.
- Module-specific form fields and validation rules.
- Module-specific table columns, filters, and actions.
- Module-specific API calls under feature folders.
- Module-specific audit event labels and record timelines.

Backend owns:

- Authentication and session validity.
- Company membership and selected company verification.
- Permission and ABAC enforcement.
- Data validation and final mutation.
- Audit log persistence.
- Source-of-truth records.

## 6. Current Repository Baseline

Current scaffold:

- `apps/web`: Next.js 15 App Router, React 19, TypeScript, CSS Modules.
- `apps/web/app/page.tsx`: thin route rendering `PlatformFoundationPage`.
- `apps/web/app/layout.tsx`: global metadata and body shell only.
- `apps/web/src/features/platform-foundation`: first feature example with separated component, API, logic, constants, and model files.
- `apps/web/src/common/components`: current `Badge` and `Stack` primitives.
- `apps/web/src/common/styles/theme.css`: imports generated design tokens.
- `packages/design-tokens`: shared design token package.

Implementation must follow [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]].

## 7. Template Source

Use the local TailAdmin template as the Web Core Workspace UI base:

```text
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/
```

Template facts checked on 2026-06-23:

- Name: TailAdmin Next.js Free admin dashboard template.
- Version in local `package.json`: `2.3.0`.
- License: MIT. Owner approved copying TailAdmin assets/icons into the repo with MIT license attribution preserved.
- Stack: Next.js 16.x, React 19, TypeScript, Tailwind CSS v4.
- Key source files:
  - `src/app/(admin)/layout.tsx`
  - `src/layout/AppSidebar.tsx`
  - `src/layout/AppHeader.tsx`
  - `src/layout/Backdrop.tsx`
  - `src/context/SidebarContext.tsx`
  - `src/components/common/PageBreadCrumb.tsx`
  - `src/components/ui/*`
  - `src/components/form/*`
  - `src/components/tables/*`
  - `src/icons/*`

Template usage rules:

- Use TailAdmin shell structure, sidebar behavior, header layout, mobile backdrop, dropdown behavior, page breadcrumb, form controls, table primitives, modal, badge, alert, and button patterns as the starting point.
- Replace TailAdmin demo navigation with WatchDog module registry and permission-aware navigation.
- Replace ecommerce/dashboard demo content with WatchDog workspace/dashboard placeholders.
- Do not copy TailAdmin auth flow as product auth. WatchDog auth follows Auth/RBAC item 02.
- Do not copy ecommerce charts, maps, calendar, country images, demo user images, or marketing/demo pages unless a later checklist item needs them.
- Copy TailAdmin icons and structural assets needed for shell/common UI directly into `apps/web` when useful, and preserve MIT attribution.
- Remove `pro`/`new` demo badges unless WatchDog has a real product state to show.
- Keep TailAdmin's dense admin dashboard feel, but adapt labels, spacing, and routes to WatchDog Business OS.

Styling decision:

- TailAdmin is the chosen template, so item 03 may add Tailwind CSS v4 to `apps/web` for shell/common UI if implementation uses template components directly.
- Existing `packages/design-tokens` remains source for WatchDog brand tokens. TailAdmin color/spacing tokens should be mapped or wrapped instead of becoming a separate unmanaged design system.
- Feature modules after item 03 should reuse the TailAdmin-derived common components before creating feature CSS.
- TailAdmin dark mode is deferred from item 03. Keep it in roadmap backlog; do not wire dark-mode toggle/provider during first Web Core Workspace implementation.

## 8. Page Definitions

### PlatformFoundation Page

`PlatformFoundationPage` is a temporary platform status page. It exists to show foundation readiness such as web shell, API health, workers, config, Docker/local environment, and service status while checklist item 01/02 work is being built.

Rules:

- It is not the Business OS product home.
- It can remain at root `/` during foundation/bootstrap work.
- It should not receive TailAdmin business dashboard content.
- It can be removed, moved to `/platform/foundation`, or hidden behind admin/dev access after workspace routing is ready.

### Workspace Dashboard

Workspace dashboard is the company-scoped Business OS home inside the TailAdmin-derived shell.

It should show:

- Company context and quick status.
- Module entry points for inventory, accounting, expenses, tax, CRM, reports, workflow, and settings.
- Placeholder KPI/queue cards until Dashboard and Notification item 06 implements real metrics.
- Recent activity/alerts placeholders only when backed by APIs or clear fixtures.
- Permission-aware empty/forbidden states.

Initial route:

```text
/companies/[companyId]/dashboard
```

Root `/` should keep `PlatformFoundationPage` until auth/session/default-company routing exists. After that, `/` may redirect to the user's default company workspace dashboard.

## 9. Route Structure

Use Next.js App Router route groups. Route files must stay thin and import feature/common components.

Recommended workspace route shape:

```text
apps/web/app/
  layout.tsx
  globals.css
  page.tsx
  (workspace)/
    layout.tsx
    dashboard/page.tsx
    companies/[companyId]/
      layout.tsx
      dashboard/page.tsx
      inventory/page.tsx
      accounting/page.tsx
      expenses/page.tsx
      tax/page.tsx
      crm/page.tsx
      reports/page.tsx
      workflow/page.tsx
      settings/page.tsx
    not-found.tsx
```

Company-scoped deep-link paths should use a stable company hint:

```text
/companies/[companyId]/dashboard
/companies/[companyId]/inventory/products/[productId]
/companies/[companyId]/inventory/movements/[movementId]
/companies/[companyId]/accounting/invoices/[invoiceId]
/companies/[companyId]/expenses/[expenseId]
/companies/[companyId]/tax/periods/[taxPeriodId]
/companies/[companyId]/crm/customers/[customerId]
/companies/[companyId]/approvals/[approvalId]
/companies/[companyId]/reports/[reportKey]
/companies/[companyId]/settings/users/[userId]
```

Rules:

- `companyId` in URL is a selection hint only. Backend must verify membership and permission.
- `/dashboard` without company scope may redirect to the last/default company when session context exists.
- Web may store last selected company for convenience, but URL deep links must be enough to restore context.
- Unknown or unauthorized company shows a permission-aware error state, not partial data.
- Business modules may add child routes later, but must keep this company-scoped path convention.

## 10. Navigation Model

Navigation must be data-driven, not hard-coded across components.

Minimum module registry fields:

```ts
type WorkspaceModule = {
  key: string;
  labelKey: string;
  buildHref: (companyId: string) => string;
  iconKey: string;
  navGroup: 'operate' | 'finance' | 'growth' | 'admin';
  requiredAnyPermissions: string[];
  requiredAllPermissions?: string[];
  status: 'ready' | 'planned' | 'disabled';
  statusReasonKey?: string;
  deepLinkTargets: string[];
};
```

Initial modules:

- Dashboard
- Inventory
- Accounting
- Expenses
- Tax
- CRM
- Reports
- Workflow
- Settings

Navigation behavior:

- Desktop uses persistent sidebar plus top bar.
- Mobile uses compact top bar and slide-over or bottom navigation for primary modules.
- Active route is visible.
- On desktop, hover expansion of a collapsed sidebar overlays the page; only an explicit pinned expansion changes the main-content offset. Route changes scroll the active row only when it is outside the sidebar viewport and never force-centre an already visible row.
- On desktop, pressing the sidebar's collapse button closes it to the rail at once, also while the pointer still rests on the sidebar and also when the button is pressed from the keyboard; hover expansion starts again only after the pointer has left the sidebar and come back.
- Unauthorized modules are hidden from primary nav unless a route is opened directly; direct open shows forbidden state.
- Planned modules may appear as disabled only when useful for roadmap visibility. They must not fake working behavior.
- Top bar contains company selector, language switch, user menu entry, and notification entry placeholder. Real notification data, preferences, rules, and delivery live in Dashboard and Notification item 06.
- Personal signature setup is a low-frequency account task: keep its existing permission-checked route and contextual signing links, but expose it from the personal account area instead of the permanent Expenses submenu.

Language behavior:

- Thai (`th`) is the default workspace language.
- English (`en`) can be selected from a compact language switch in the top bar.
- The language switch must work before full user settings exist.
- Store selected language in client preference such as `localStorage` for MVP; later sync to user profile when settings API exists.
- Internal route keys, permission keys, API fields, and test ids remain English/stable.
- Visible labels, nav names, button text, state messages, breadcrumbs, and validation summaries use translation dictionaries.
- Missing translation should fail visibly in development or fall back to Thai with a clear key, not silently show unrelated English copy.

## 11. Workspace Shell

Shell requirements:

- Based on TailAdmin `AdminLayout` structure: sidebar, mobile backdrop, sticky top header, and main content with responsive sidebar offset.
- Semantic landmarks: header, nav, main.
- Skip link for keyboard users.
- Stable max width rules for dense business screens.
- Responsive sidebar/topbar without layout jump.
- Breadcrumb slot.
- Page title and action slot.
- Optional secondary nav/tabs slot.
- Optional right-side detail or inspector slot.
- Global loading and error boundaries for workspace routes.
- Session/company loading state.
- Permission forbidden state.
- Empty workspace state when user has no company membership.

Shell must not contain business-specific logic.

## 12. Shared Page Patterns

### List Pattern

Required elements:

- Page header with title, subtitle/status slot, and primary action.
- Filter/search toolbar.
- Stable table/list container.
- Cover loader over the list/table area while loading, refreshing, filtering, sorting, or paginating.
- Empty state.
- Loading state.
- Error state with retry.
- Pagination placeholder or cursor controls.
- Row action menu.
- Permission-aware create/export buttons.

### Detail Pattern

Required elements:

- Breadcrumb back to list.
- Record title and status badge.
- Primary and secondary action slots.
- Summary facts section.
- Activity/audit timeline slot.
- Source links slot.
- Related records slot.
- Permission-aware forbidden or readonly state.

### Form Pattern

Required elements:

- Field labels and validation messages.
- Dirty state handling.
- Save/cancel action bar.
- Destructive action confirmation pattern.
- Server validation error mapping.
- Readonly mode when permission allows view but not edit.
- Cover loader over the form or modal while submit/save/delete/confirm waits for API response.
- Consistent disabled/loading button behavior to prevent duplicate submit.

### Settings Pattern

Required elements:

- Left subnavigation or tabs.
- Permission labels for admin-only pages.
- Audit note slot for sensitive config changes.
- Confirm flow for high-risk settings.

## 13. Common Components

Create common components only when they are cross-feature. Feature-specific presentation stays in feature folders.

Recommended common components:

- `app-shell`: adapt TailAdmin `AdminLayout`, `AppSidebar`, `AppHeader`, `Backdrop`, and `SidebarContext` into `WorkspaceShell`, `WorkspaceSidebar`, `WorkspaceTopbar`, `WorkspaceNav`, `CompanySwitcher`, and `UserMenu`.
- `page`: adapt TailAdmin `PageBreadCrumb` into `PageHeader`, `PageSection`, `ActionToolbar`, and `Breadcrumbs`.
- `button`: adapt TailAdmin `Button` and add `IconButton` if needed.
- `field`: adapt TailAdmin form inputs/select/textarea/switch patterns into `TextField`, `SelectField`, `TextareaField`, `SwitchField`, and `FieldError`.
- `data-table`: adapt TailAdmin table/pagination primitives into `DataTable`, `TableEmptyState`, `TableToolbar`, and pagination controls.
- `state`: create `EmptyState`, `LoadingState`, `CoverLoader`, `ErrorState`, `ForbiddenState` in TailAdmin visual style.
- `tabs`: adapt TailAdmin tab/segmented controls where available.
- `status`: adapt TailAdmin badge/alert styles for severity/status labels.
- `modal`: adapt TailAdmin modal implementation for confirmation and simple dialog flows.

Icons:

- Use TailAdmin bundled SVG icon components for copied template navigation and controls.
- For new WatchDog-only icon buttons not covered by TailAdmin icons, use an icon library only after adding it deliberately to `apps/web`; do not hand-roll random SVGs.

## 14. Common API Behavior

Feature components must not call `fetch` directly.

Shared web API client should live under:

```text
apps/web/src/common/api/
  http-client.ts
  api-error.model.ts
  request-context.model.ts
```

Client behavior:

- Sends credentials/session as required by auth implementation.
- Sends selected company hint through route or `X-Company-Id` when backend contract supports it.
- Sends or preserves request id when available.
- Exposes pending/loading state to UI callers for every request or mutation.
- Parses JSON success and typed error responses.
- Maps `401` to signed-out/session-expired state.
- Maps `403` to forbidden state.
- Maps `404` to not-found state.
- Maps validation errors to form fields when response shape allows.
- Never logs tokens, cookies, prompts, or document payloads.

Cover loader behavior:

- Every API call or user action waiting for a response must show a loader covering the relevant UI scope.
- Use full-workspace cover loader for session/company bootstrap and route-level blocking loads.
- Use page/section cover loader for lists, tables, detail panels, reports, and refresh/filter/sort/pagination requests.
- Use form/modal cover loader for create/update/delete/confirm flows.
- Keep visible context underneath when safe, but block repeated interaction in the covered scope.
- Disable submit, save, delete, confirm, export, pagination, filter, and bulk-action controls while their request is pending.
- Do not show silent waits, invisible promises, or only console/network activity.
- Loader labels must use Thai/English dictionaries.

## 15. Permission Behavior

Web permission behavior is user experience only. Backend remains enforcement source.

Rules:

- Shell receives current user, selected company, roles, and permissions from auth/session API when available.
- Shell revalidates roles, permissions, entitlement-filtered permissions, and branch scope while active: once per minute while visible, on focus/visibility return, and immediately after a stable permission/feature denial. It refreshes the server workspace only when that access context changed.
- Navigation filters by `requiredAnyPermissions`.
- Buttons and bulk actions check required permissions before enabling.
- Direct route access without permission shows `ForbiddenState`.
- Readonly detail is allowed when user has read permission but lacks mutation permission.
- Sensitive actions include visible confirmation and audit note.
- Permission keys must use the matrix naming direction from [[specs/permission-matrix|Permission Matrix]].
- Registry permission constants must be sourced from implemented module specs when available. Provisional keys are allowed only as local constants with a comment pointing to the owning spec or item.

## 16. Deep-Link Behavior

Deep links are used by LINE alerts, AI citations, notifications, email, and copied web URLs.

Deep-link target model:

```ts
type DeepLinkTarget = {
  companyId: string;
  targetType:
    | 'dashboard'
    | 'product'
    | 'stockMovement'
    | 'invoice'
    | 'expense'
    | 'taxPeriod'
    | 'customer'
    | 'approval'
    | 'report'
    | 'settingsUser';
  targetId?: string;
  tab?: string;
  highlight?: string;
};
```

Rules:

- Deep-link path builder must be a pure function with tests.
- Parser must reject unknown target types.
- Target ids are opaque strings.
- Missing or archived records show not-found or archived state.
- Unauthorized records show forbidden state.
- Deep links from LINE must never perform final mutation by themselves.

## 17. Visual and Interaction Requirements

- Business workspace should feel dense, quiet, and operational.
- TailAdmin is the visual baseline for density, sidebar, topbar, forms, tables, badges, modals, and dashboard cards.
- Avoid landing-page hero composition inside workspace.
- Avoid card-inside-card layouts.
- Use design tokens from `packages/design-tokens` through `theme.css`.
- Avoid raw colors when token exists.
- Cards should be adapted from TailAdmin, but avoid nesting cards and keep repeated-item surfaces compact.
- Text must not overflow buttons, nav items, table cells, or empty states on mobile.
- Do not scale font size with viewport width.
- Letter spacing stays `0`.
- Use stable dimensions for nav rows, icon buttons, toolbar controls, table rows, and status chips.
- Desktop and mobile layouts must avoid overlapping controls.

## 18. Accessibility Requirements

- Keyboard can reach navigation, company switcher, user menu, and page actions.
- Focus state is visible.
- Active nav item uses `aria-current="page"` when applicable.
- Icon-only buttons have accessible labels.
- Form fields have programmatic labels.
- Error messages are associated with fields.
- Dialogs/drawers trap focus if implemented.
- Color is not the only status signal.

## 19. Data Model Draft

Web-only view models and config types:

- `WorkspaceSessionView`: user, selectedCompany, companies, roles, permissions, locale.
- `WorkspaceModule`: module registry entry.
- `WorkspaceNavGroup`: grouped navigation view model.
- `WorkspaceRouteDefinition`: route metadata and permission requirements.
- `WorkspaceLocale`: `th` or `en`.
- `WorkspaceDictionary`: translated labels/messages keyed by stable ids.
- `DeepLinkTarget`: canonical deep-link object.
- `ListQueryState`: search, filters, sort, page/cursor.
- `TableColumnDefinition`: shared table column metadata.
- `PageAction`: permission-aware action metadata.
- `PermissionState`: allowed, forbidden, readonly, signedOut.
- `WorkspaceError`: normalized web error model.
- `WorkspacePendingState`: pending request kind, scope, label key, and blocking flag.

No database tables are required for this item unless auth/session work from item 02 already exposes session APIs.

## 20. API Behavior

Expected backend/session contracts from item 02:

- Current session endpoint returns user, selected/default company, company memberships, roles, and permissions.
- Company switch endpoint or preference update exists if implemented in auth item.
- Protected API responses distinguish unauthenticated, forbidden, not found, and validation errors.
- Backend verifies company route/header hints against membership.

Web core implementation can add typed adapters and fixtures only when backend contracts are not available yet. Any fixture must be local-only, clearly named, and removable before checklist item 03 is marked complete.

## 21. Edge Cases

- User has no company membership.
- User belongs to multiple companies.
- Selected company was disabled or user membership became inactive.
- Session expires while user is on workspace.
- User opens direct link to a module without permission.
- User opens direct link to missing, archived, or cross-company record.
- Module is planned but route is not implemented.
- Mobile viewport with long company name or long user display name.
- API returns validation errors for fields that are not visible.
- Network failure while saving form.
- User triggers filter, pagination, save, export, or delete repeatedly while an API request is pending.

## 22. Acceptance Criteria

- [ ] Workspace shell renders through thin Next.js route files.
- [ ] Desktop and mobile navigation use one data-driven module registry.
- [ ] Thai is the default visible language and English can be selected from the top-bar language switch.
- [ ] Workspace shell, header, sidebar, backdrop, breadcrumbs, buttons, badges, form controls, table primitives, and modal/state patterns are adapted from TailAdmin or documented when intentionally replaced.
- [ ] TailAdmin demo ecommerce/auth/demo pages are not copied into product routes.
- [ ] Root `PlatformFoundationPage` remains clearly separate from the Business OS workspace until default-company routing exists.
- [ ] Shared page header, toolbar, state, list/detail/form patterns exist for future modules.
- [ ] Every API call or response wait has a visible cover loader for the relevant UI scope.
- [ ] Permission-aware nav/action/forbidden states are implemented.
- [ ] Disabled-company or inactive-membership access renders a branded forbidden state, never a missing-page response.
- [ ] Unknown routes and runtime failures render branded 404 and retryable error states using the workspace design tokens.
- [ ] Deep-link builder/parser supports core target types and has tests.
- [ ] Shared API client normalizes auth, permission, not-found, validation, and generic errors.
- [ ] UI follows design tokens and web frontend code style guideline.
- [ ] Routes can host later inventory, accounting, CRM, reports, tax, workflow, and settings screens without redesign.
- [ ] `pnpm --filter @watchdog-bms/web typecheck` passes.
- [ ] Relevant web tests pass.

## 23. Test Cases

- Navigation groups hide modules when current permission set lacks required permissions.
- Thai locale renders Thai nav/page labels by default.
- English locale renders English nav/page labels after switch.
- Active route is marked for current path.
- Deep-link builder returns expected path for product, invoice, approval, and report targets.
- Deep-link parser rejects unknown target type.
- HTTP client maps `401` to signed-out/session-expired error.
- HTTP client maps `403` to forbidden error.
- Permission/feature `403` signals access-context revalidation without retrying the denied mutation.
- Password login does not issue a session for a user without membership in an active company.
- Disabled-company or revoked-membership deep links do not render the framework 404 page.
- Unknown routes render the branded 404 state and runtime errors expose retry without raw exception details.
- API request pending state renders `CoverLoader` and disables covered actions.
- Form submit renders form/modal cover loader and blocks duplicate submit.
- Table filter/pagination renders table cover loader and blocks duplicate controls.
- Form error mapper maps backend field errors to visible field messages.
- List query builder preserves search, filter, sort, and page/cursor state.
- Mobile shell keeps nav, title, actions, and content from overlapping.
- LINE/notification deep link opens the matching company-scoped web route without performing mutation.
- Route files remain thin and feature/common code stays outside `app/`.

## 24. Deferred Decisions

- Company URL key: item 03 keeps opaque `/companies/[companyId]`. Human-readable slugs are later migration scope.
- Notification center: item 03 may include a non-data topbar entry or disabled placeholder for layout. Item 06 owns real notification center data, rules, preferences, delivery, unread counts, and LINE delivery.

## Linked Plan

- [[plans/web-core-workspace-plan|Web Core Workspace Plan]]
