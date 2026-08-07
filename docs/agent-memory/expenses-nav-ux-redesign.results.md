# Results: expenses-nav-ux-redesign

## Files touched

- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts` — added gated expenses sidebar sub-items.
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts` — added expenses submenu construction tests.
- `apps/web/src/common/components/app-shell/AppSidebar.tsx` — changed sub-item active matching so the longest sibling href wins.
- `apps/web/src/common/components/app-shell/AppSidebar.spec.ts` — added longest-match sidebar test.
- `apps/web/app/(workspace)/companies/[companyId]/expenses/upload/page.tsx` — added route-backed upload tab page.
- `apps/web/app/(workspace)/companies/[companyId]/expenses/manual/page.tsx` — added route-backed manual tab page.
- `apps/web/app/(workspace)/companies/[companyId]/expenses/categories/page.tsx` — added route-backed categories tab page.
- `apps/web/app/(workspace)/companies/[companyId]/expenses/signatures/page.tsx` — added route-backed signatures tab page.
- `apps/web/app/(workspace)/companies/[companyId]/expenses/evidence/page.tsx` — added route-backed evidence tab page.
- `apps/web/src/features/expenses/ExpensesPages.tsx` — removed hub tab bar, made panels route-driven, preserved `?tab=` deep links, balanced list layout, redesigned manual entry, kept guided panels mounted, added step helpers, and added AI loading feedback.
- `apps/web/src/features/expenses/ExpensesUi.tsx` — made `StatCard` grid-height friendly.
- `apps/web/src/features/expenses/expenses.model.ts` — added pure manual-entry VAT/total helper.
- `apps/web/src/features/expenses/expenses.model.spec.ts` — added manual VAT/total helper tests.
- `apps/web/src/features/dashboard-notifications/NotificationBell.tsx` — reduced bell button, icon, and badge size.
- `apps/web/src/common/i18n/workspace-dictionary.ts` — added/updated Thai and English strings for route tabs, manual summary, step helpers, and upload phases.
- `docs/agent-memory/expenses-nav-ux-redesign.results.md` — recorded implementation and verification results.

## Extraction notice approach

Upload success stores the extraction notice in `sessionStorage` under `expenses.extractionNotice.<expenseId>`, then routes to `/companies/{companyId}/expenses?expenseId=<id>`. The list hub reads and removes that key when opening the modal, so the AI extraction notice still appears after moving from the upload route to the list route.

## Verification

### `corepack pnpm --filter @watchdog-bms/web typecheck`

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
src/features/crm/BookingsPrototypePage.tsx(735,201): error TS2339: Property 'depositAmount' does not exist on type 'CrmBookingSummary'.
src/features/crm/BookingsPrototypePage.tsx(736,216): error TS2339: Property 'depositAmount' does not exist on type 'CrmBookingSummary'.
src/features/crm/BookingsPrototypePage.tsx(736,247): error TS2339: Property 'totalAmount' does not exist on type 'CrmBookingSummary'.
src/features/expenses/expense-upload.logic.ts(46,46): error TS2307: Cannot find module 'heic2any' or its corresponding type declarations.
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/web@0.1.0 typecheck: `next typegen && tsc --noEmit`
Exit status 2
```

### `corepack pnpm --filter @watchdog-bms/web lint`

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
src/features/crm/BookingsPrototypePage.tsx(735,201): error TS2339: Property 'depositAmount' does not exist on type 'CrmBookingSummary'.
src/features/crm/BookingsPrototypePage.tsx(736,216): error TS2339: Property 'depositAmount' does not exist on type 'CrmBookingSummary'.
src/features/crm/BookingsPrototypePage.tsx(736,247): error TS2339: Property 'totalAmount' does not exist on type 'CrmBookingSummary'.
src/features/expenses/expense-upload.logic.ts(46,46): error TS2307: Cannot find module 'heic2any' or its corresponding type declarations.
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/web@0.1.0 lint: `next typegen && tsc --noEmit`
Exit status 1
```

### `corepack pnpm --filter @watchdog-bms/web test`

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/72557.pipe
    at Server.setupListenHandle [as _listen2] (node:net:1926:21)
    at listenInCluster (node:net:2005:12)
    at Server.listen (node:net:2127:5)
    at file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31537
    at new Promise (<anonymous>)
    at createIpcServer (file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31515)
    at async file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:55:459 {
  code: 'EPERM',
  errno: -1,
  syscall: 'listen',
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/72557.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

## Could not do

- Typecheck and lint did not pass because of existing errors in `src/features/crm/BookingsPrototypePage.tsx` and `src/features/expenses/expense-upload.logic.ts`; route type generation completed successfully.
- The test suite did not execute because `tsx` cannot listen on its IPC pipe in this sandbox (`EPERM`). Retrying with `TMPDIR=/private/tmp` failed for the same reason.
- `apps/api/prisma/seed.ts`, `docs/agent-memory/expenses-nav-ux-redesign.handoff.md`, `docs/agent-memory/expenses-nav-ux-redesign.md`, and `docs/qa/~$WatchDog-BMS_Manual_QA_Test_Plan_2026-07-09.xlsx` were already dirty/untracked and were not touched for this web-only task.
