# Web Frontend Code Style Guideline

## Status

Accepted

## Goal

Keep the Next.js web admin easy to grow by separating feature code by responsibility and reusing common code before creating new functions.

## Folder Rule

Every feature must live in its own folder under `apps/web/src/features/`.

Example:

```text
apps/web/src/features/inventory/
  components/
    InventoryPage.tsx
    InventoryPage.module.css
  inventory.api.ts
  inventory.constants.ts
  inventory.logic.ts
  inventory.model.ts
```

Shared code must live under `apps/web/src/common/`.

Example:

```text
apps/web/src/common/
  api/
  components/
    badge/
    layout/
    modal/
  constants/
  functions/
  models/
  styles/
    theme.css
  utils/
```

## Numeric Input Appearance

Hide native up/down steppers for every `input[type="number"]` through the shared rules in `apps/web/app/globals.css`, including plain inputs and fields in modals. Keep numeric types, `inputMode`, limits and step validation appropriate to the field. Do not duplicate spinner-hiding CSS in each feature or change data-entry semantics just to remove the arrows.

## Separation Rule

Do not mix page markup, business logic, constants, models, API calls, and CSS in one file.

Use this default split:

- `components/*.tsx`: React markup and user interaction wiring.
- `*.module.css`: feature or component styles.
- `*.model.ts`: TypeScript types, interfaces, enums, and view models.
- `*.constants.ts`: static labels, options, route names, table columns, and defaults.
- `*.api.ts`: API calls and request/response mapping.
- `*.logic.ts`: pure functions, derived state, formatting, validation, sorting, filtering, and view model builders.

Next.js route files in `apps/web/app/` should stay thin. Route files should import feature components instead of holding feature logic directly.

## Common Folder Rule

`apps/web/src/common/` is the first place to check before creating reusable code.

Common must include these shared areas:

- `components/`: reusable UI primitives such as modal, badge, button, input, table primitives, empty states, loading states, and alignment/layout helpers.
- `functions/`: shared pure reusable functions.
- `styles/`: shared theme tokens and app-wide style primitives.
- `api/`: shared HTTP clients, API errors, auth headers, request IDs, and response mapping helpers.
- `constants/`: shared static app constants.
- `models/`: shared types used by more than one feature.

Modal, badge, and alignment/layout helpers should be common components, not duplicated in feature folders.

## Common-First Rule

Before creating a new function, model, constant, API helper, hook, or component:

1. Check `apps/web/src/common/`.
2. Check related feature folders for existing patterns.
3. Reuse or extend existing common code when behavior is shared.
4. Create feature-local code only when the behavior belongs to one feature.
5. Move code to `common` when a second feature needs it.

Do not duplicate helpers under multiple features.

## Constant Reuse Rule

Values reused across files or features must be named constants so changes and root-cause analysis have one obvious place to start.

Default homes:

- Feature-local constants stay in `features/<feature>/<feature>.constants.ts` while only one feature uses them.
- Shared constants move to `apps/web/src/common/constants/` when a second feature needs them.
- Visible Thai/English copy still belongs in dictionaries, not JSX or generic constants.
- Contract values shared with backend belong in shared contract models or API mapping code, not copied strings.

Use constants for route keys, permission keys, status values, table/page defaults, option values, test ids, API query defaults, and repeated UI state names.

Do not create constants for one-off obvious literals or values that are clearer inline.

## Common Components Rule

Common components must solve cross-feature UI behavior.

Default common component homes:

- `common/components/modal/`: modal, dialog, drawer, focus trap, escape handling, backdrop, and size rules.
- `common/components/badge/`: badges, status labels, counters, and severity labels.
- `common/components/layout/`: alignment, spacing, stack, inline, grid helpers, and responsive layout primitives.

Feature folders may style specific layouts, but shared component behavior belongs in `common/components/`.

## API Rule

Feature components must not call `fetch` directly.

Use feature API files for feature-specific calls:

```text
features/sales/sales.api.ts
```

Use common API files for shared client behavior:

```text
common/api/http-client.ts
common/api/api-error.model.ts
```

API files should return typed data from feature or common models.

## Cover Loader Rule

Every API call, mutation, submit, refresh, filter, sort, pagination, export, delete, or confirmation flow that waits for a response must show a visible loader covering the relevant UI scope.

Rules:

- Use shared `CoverLoader`/loading primitives, not one-off spinners.
- Cover the smallest safe scope: full workspace for session/company bootstrap, page/section for data refresh, table for list operations, form/modal for submit or confirm.
- Disable covered controls while pending to prevent duplicate requests.
- No silent waits: users must see visible pending UI whenever the app is waiting for an API response.
- Loader labels must come from Thai/English dictionaries.

## CSS Rule

Use CSS modules for feature/component styles.

Keep global CSS limited to imports, reset, body defaults, and app-wide primitives.

Do not put feature-specific class names in `app/globals.css`.

Theme tokens must live in `apps/web/src/common/styles/theme.css`.

Feature CSS modules should use CSS variables from `theme.css` for colors, spacing, radius, typography, shadows, and z-index values.

Avoid repeating raw colors, spacing, and z-index values inside feature CSS unless the value is truly feature-specific.

## TailAdmin Template Exception

Web Core Workspace item 03 uses the local TailAdmin Next.js admin dashboard template as the UI base:

```text
/Users/spare058/Downloads/free-nextjs-admin-dashboard-main/
```

For TailAdmin-derived workspace shell and common UI primitives, Tailwind CSS v4 utility classes are allowed when copying/adapting template components. This exception applies to shared shell/common UI created for item 03, such as sidebar, header, backdrop, breadcrumbs, buttons, badges, forms, tables, modals, and state components.

Rules for this exception:

- Keep TailAdmin-derived code under `apps/web/src/common/` or `apps/web/src/features/web-core-workspace/` using WatchDog names.
- TailAdmin assets/icons may be copied into `apps/web` with MIT license attribution preserved.
- Do not import TailAdmin demo routes, ecommerce dashboard content, demo auth flow, maps, charts, or stock images unless a later feature plan explicitly needs them.
- Keep `packages/design-tokens` as WatchDog brand token source; map TailAdmin variables instead of creating an unmanaged second design system.
- Feature modules after item 03 should reuse the TailAdmin-derived common components before adding feature-local styling.

## Function Rule

Prefer pure functions in `*.logic.ts` for derived data and transformations.

Pure logic must not call APIs, read browser state, or mutate inputs.

## Language Rule

Thai (`th`) is the default visible workspace language. English (`en`) must be available through the workspace language switch.

Rules:

- Keep internal route keys, permission keys, API fields, constants, and test ids in English.
- Put visible labels/messages in shared dictionaries or feature dictionaries, not hard-coded inside JSX.
- Add Thai and English copy together for new shared workspace UI.
- Ensure Thai labels fit nav, topbar, buttons, tables, forms, empty states, and mobile layouts.

## Naming Rule

Use feature-prefixed file names:

- `inventory.api.ts`
- `inventory.constants.ts`
- `inventory.logic.ts`
- `inventory.model.ts`

Use PascalCase for React components:

- `InventoryPage.tsx`
- `InventoryTable.tsx`

## Review Checklist

- [ ] Route file is thin.
- [ ] Feature has its own folder.
- [ ] CSS is in a CSS module.
- [ ] Models are separated from components.
- [ ] Constants are separated from components.
- [ ] API calls are separated from components.
- [ ] Logic is separated into pure functions.
- [ ] Shared behavior was checked in `common` before adding new code.
- [ ] Reused values are named constants and shared from the right feature/common/contract home.
- [ ] Code duplicated by two features was moved to `common`.
- [ ] Visible copy comes from Thai/English dictionaries.
- [ ] API waits and mutations show a scoped `CoverLoader` and disable covered controls.
- [ ] Empty, loading, error, forbidden, and readonly states are handled.
- [ ] Permission checks are treated as UX only; backend remains source of truth.
- [ ] TailAdmin-derived code excludes demo ecommerce/auth/pages unless a later plan explicitly needs them.
