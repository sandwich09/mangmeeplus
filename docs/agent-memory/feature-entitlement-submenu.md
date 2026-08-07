# Agent Memory: feature-entitlement-submenu

Status: PHASE 2B IMPLEMENTED AND VERIFIED — package test CLIs hit the documented TSX socket restriction; equivalent Node+TSX runs are clean
Owner: Codex
Scope: Shared feature-entitlement catalog, expense submenu inheritance/gating, one evidence permission, system-admin entitlement UI, system navigation/back links, remaining safe submenu definitions, and permission-aware procurement/AP, banking, workflow, CRM, inventory, and notification navigation.

Decisions:
- Follow `docs/plans/feature-entitlement-submenu-plan.md` as the approved spec.
- Use Ponytail full mode: existing patterns, shortest correct diff, no new dependency.
- Keep inheritance in `loadEntitledFeatureKeys`; keep `filterPermissionsByEntitlement` signature and call sites unchanged.
- Add exactly one permission key: `expense.evidence.read`.
- Do not change Prisma schema or add a migration.
- Keep absent child rows absent when saving. The loader materializes inheritance at permission-resolution time; the UI only writes the clicked key.
- Keep every non-expense module at `submenus: []` for Phase 1.
- A module-entry permission is not, by itself, an exclusion. The module nav gate is widened to the union of its feature-owned tab keys so one disabled child does not orphan enabled siblings.
- Exclude only: a key governed by a multi-feature prefix rule, a key owned by another feature, or a key shared by two tabs of the same module.
- Both `/procurement` and `/accounts-payable` remain children of the single `procurement` parent feature.
- Keep Inventory Products and Scan at parent scope because `inventory.product.*` is shared with CRM. Keep Stock Action and Stock Count at parent scope because both use `inventory.stock_count.create`.
- Keep CRM payment proofs at parent scope because `accounting.document.read` belongs to `sales_documents`.
- Keep `thai_tax.submenus` empty and do not touch `TaxWorkspacePage.tsx`; VAT/WHT/CIT have no per-type keys.
- Add no Phase 2 permission keys, Prisma changes, dependencies, or API spec files. The extended API specs were already listed by `apps/api/package.json`.

Open questions:
- None.

Artifacts:
- Step 1 — catalog and accepted keys:
  - `packages/contracts/src/feature-entitlements.ts`
  - `packages/contracts/src/index.ts`
  - `apps/api/src/modules/system-partner-management/domain/feature-registry.ts`
- Step 2 — evidence permission and parity:
  - `apps/api/src/modules/auth/permission-registry.ts`
  - `apps/api/src/modules/auth/permission-registry.spec.ts`
  - `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`
  - `apps/api/src/modules/employee-access/domain/logic/capability.logic.spec.ts`
- Step 3 — shared-evidence guard:
  - `apps/api/src/modules/expenses/presentation/http/expense.controller.ts`
  - `apps/api/src/modules/expenses/application/use-cases/expense-evidence.use-case.ts`
  - `apps/api/src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts`
  - `apps/api/src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts`
- Steps 4–5 — inheritance and parent/child filtering:
  - `apps/api/src/modules/employee-access/application/entitlement.helper.ts`
  - `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.ts`
  - `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`
- Step 6 — child-key validation:
  - `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.ts`
  - `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts`
- Step 7 — expense module, tab, and sidebar gates:
  - `apps/web/src/features/expenses/ExpensesPages.tsx`
  - `apps/web/src/features/expenses/expenses.model.ts`
  - `apps/web/src/features/expenses/expenses.model.spec.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- Step 8 — entitlement tree UI and pure logic:
  - `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
  - `apps/web/src/features/system-partners/system-partners.logic.ts`
  - `apps/web/src/features/system-partners/system-partners.logic.spec.ts`
- Step 9 — shared Back link and system section navigation:
  - `apps/web/src/common/components/app-shell/BackLink.tsx`
  - `apps/web/src/common/components/app-shell/SystemHeader.tsx`
  - `apps/web/src/features/system-partners/PartnerListPage.tsx`
  - `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
  - `apps/web/src/features/system-partners/SharedLineSettingsPage.tsx`
  - `apps/web/src/features/system-onboarding/SystemOnboardingNewPage.tsx`
- Step 10 — documentation:
  - `docs/specs/permission-matrix.md`
  - `docs/agent-memory/feature-entitlement-submenu.md`
- Step 11 — Phase 2 catalog rows and inheritance/validation regression coverage:
  - `packages/contracts/src/feature-entitlements.ts`
  - `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`
  - `apps/api/src/modules/system-partner-management/application/use-cases/set-partner-features.use-case.spec.ts`
- Step 12 — permission-aware tabs, cards, routes, and focused logic specs:
  - `apps/web/src/features/procurement/procurement.logic.ts`
  - `apps/web/src/features/procurement/procurement.logic.spec.ts`
  - `apps/web/src/features/procurement/ProcurementPages.tsx`
  - `apps/web/src/features/accounts-payable/accounts-payable.logic.ts`
  - `apps/web/src/features/accounts-payable/accounts-payable.logic.spec.ts`
  - `apps/web/src/features/accounts-payable/AccountsPayablePages.tsx`
  - `apps/web/src/features/banking/banking.logic.ts`
  - `apps/web/src/features/banking/banking.logic.spec.ts`
  - `apps/web/src/features/banking/BankingPages.tsx`
  - `apps/web/src/features/workflow/workflow.logic.ts`
  - `apps/web/src/features/workflow/workflow.logic.spec.ts`
  - `apps/web/src/features/workflow/WorkflowPages.tsx`
  - `apps/web/src/features/crm/crm.logic.ts`
  - `apps/web/src/features/crm/crm.logic.spec.ts`
  - `apps/web/src/features/crm/CrmPages.tsx`
  - `apps/web/src/features/inventory/inventory.logic.ts`
  - `apps/web/src/features/inventory/inventory.logic.spec.ts`
  - `apps/web/src/features/dashboard-notifications/dashboard-notifications.logic.ts`
  - `apps/web/src/features/dashboard-notifications/dashboard-notifications.logic.spec.ts`
  - `apps/web/src/features/dashboard-notifications/NotificationPages.tsx`
  - server route wrappers under `apps/web/app/(workspace)/companies/[companyId]/{procurement,banking,workflow,crm,inventory,notifications,settings}`
- Phase 2b correction:
  - `packages/contracts/src/feature-entitlements.ts`
  - `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
  - `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
  - `apps/web/src/features/web-core-workspace/design-icons.tsx`
  - `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx`
  - `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
  - `apps/web/src/features/system-partners/system-partners.logic.ts`
  - `apps/web/src/features/system-partners/system-partners.logic.spec.ts`

Phase 2b correction:

- Added 20 safe children omitted by the entry-key test: Workflow 5, CRM 6, Banking 2, Procurement/AP 4, and Inventory 3.
- Final catalog: 37 children, 49 accepted parent+child entitlement keys, 117 uniquely-owned child permissions, 0 unknown permission keys, and 0 permissions assigned to more than one child.
- Module nav unions now include every feature-owned tab gate for Inventory, Procurement, Accounts Payable, Banking, Workflow, and CRM. `inventory.product.*` and `crm.ai.*` stay out of those unions to prevent cross-feature menu leakage.
- Feature cards use 12 distinct glyphs from the workspace sidebar icon aliases. `thai_tax` uses the existing `StampIcon` so it does not duplicate the sales-document glyph; no tax entitlement or tab behavior changed.

Final child count:

| Feature | Children |
| --- | ---: |
| `inventory` | 3 |
| `sales_documents` | 0 |
| `expenses` | 6 |
| `double_entry_ledger` | 0 |
| `thai_tax` | 0 |
| `procurement` | 7 |
| `bank_reconciliation` | 6 |
| `crm` | 7 |
| `dashboard_notifications` | 2 |
| `ai_line_assistant` | 0 |
| `reports` | 0 |
| `workflow_automation` | 6 |

Remaining exclusions:

| Tab | Test | Reason |
| --- | --- | --- |
| สินค้า / Products | (a) | `inventory.product.*` is governed by the Inventory+CRM prefix rule. |
| สแกน QR / Scan | (a) | It uses the same cross-feature `inventory.product.read` key. |
| หลักฐานการชำระเงิน | (b) | `accounting.document.read` belongs to `sales_documents`, not CRM. |
| บันทึกสต็อก / Stock Action | (c) | It shares `inventory.stock_count.create` with ตรวจนับ. |
| ตรวจนับ / Stock Count | (c) | It shares `inventory.stock_count.create` with บันทึกสต็อก. |
| `thai_tax` VAT/WHT/CIT tabs | no per-tab key | No new permission keys were authorized for these tabs. |

Verification — Phase 2b:

- `corepack pnpm --filter @watchdog-bms/contracts build` — exit 0:

  ```text
  > @watchdog-bms/contracts@0.1.0 build /Users/bombam/Documents/WatchDog/WatchDog-BMS/packages/contracts
  > tsc -p tsconfig.json
  ```

- `corepack pnpm --filter @watchdog-bms/api test` — the package command exited 1 before test discovery because TSX could not create its restricted-sandbox control socket:

  ```text
  Error: listen EPERM: operation not permitted
  /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/21582.pipe
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/api@0.1.0 test
  Exit status 1
  ```

  A workaround read the unchanged explicit test-file list from `apps/api/package.json` and passed it to `node --import tsx --test --test-reporter=tap`:

  ```text
  1..631
  # tests 2726
  # suites 639
  # pass 2726
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 8972.5735
  ```

- `corepack pnpm --filter @watchdog-bms/web test` — the package command likewise exited 1 before discovery on the TSX socket:

  ```text
  > tsx --test "src/**/*.spec.ts"
  Error: listen EPERM: operation not permitted
  /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/21916.pipe
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test
  Exit status 1
  ```

  Running the unchanged glob through `node --import tsx --test --test-reporter=tap "src/**/*.spec.ts"` completed:

  ```text
  1..129
  # tests 475
  # suites 126
  # pass 475
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 893.451667
  ```

- `corepack pnpm --filter @watchdog-bms/web typecheck` — exit 0:

  ```text
  > next typegen && tsc --noEmit

  Generating route types...
  ✓ Types generated successfully
  ```

- `corepack pnpm --filter @watchdog-bms/web build` reached the default Turbopack build but emitted nothing after `Creating an optimized production build ...` for 90 seconds, so the stalled run was interrupted (exit 130). The same package command with Next's existing `IS_WEBPACK_TEST=1` verification switch completed with exit 0:

  ```text
  ▲ Next.js 16.2.11 (webpack)
  Creating an optimized production build ...
  ✓ Compiled successfully in 3.7s
  Collecting page data using 9 workers ...
  ✓ Generating static pages using 9 workers (11/11) in 186ms
  Finalizing page optimization ...
  Collecting build traces ...
  ```

- Focused Phase 2b checks also passed before the full runs: API 26/26 and web 44/44.
- Catalog audit: 37 children, 49 accepted parent+child keys, 117 uniquely-owned child permissions, 0 unknown permission keys, and 0 permissions assigned to more than one child.
- Constraint audit: `git diff --check` is clean; no Phase 2b Prisma/schema/migration, permission-key, `entitlement.helper.ts`, filter-signature, default-feature, or tax-tab behavior change.
- Backward compatibility remains catalog-wide: a parent-only company materializes every child as inherited and retains the byte-identical child-owned permission set.

Verification — superseded Phase 2 record (before Phase 2b):

- `corepack pnpm --filter @watchdog-bms/contracts build` — exit 0:

  ```text
  > @watchdog-bms/contracts@0.1.0 build /Users/bombam/Documents/WatchDog/WatchDog-BMS/packages/contracts
  > tsc -p tsconfig.json
  ```

- `corepack pnpm --filter @watchdog-bms/api test` reached the package script but TSX could not create its restricted-sandbox control socket, so no test started and the wrapper exited 1:

  ```text
  Error: listen EPERM: operation not permitted
  /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/18795.pipe
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/api test
  ```

  The same explicit file list from `apps/api/package.json`, run through `node --import tsx --test --test-reporter=tap` to avoid only that socket, completed:

  ```text
  1..631
  # tests 2725
  # suites 639
  # pass 2725
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 8163.443834
  ```

  This is the corrected Phase 1 baseline of 2722 plus three Phase 2 regression tests. There are no API test failures; the previously mentioned crm-inbox failures do not occur.

- `corepack pnpm --filter @watchdog-bms/web test` hit the same TSX socket restriction before discovery and the wrapper exited 1:

  ```text
  > tsx --test "src/**/*.spec.ts"
  Error: listen EPERM: operation not permitted
  /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/19087.pipe
  ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web test
  ```

  The unchanged glob, run through `node --import tsx --test --test-reporter=tap "src/**/*.spec.ts"`, completed:

  ```text
  1..128
  # tests 471
  # suites 125
  # pass 471
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 920.684209
  ```

  This is +29 passing web tests from the corrected Phase 1 baseline of 442.

- `corepack pnpm --filter @watchdog-bms/web typecheck` — exit 0:

  ```text
  > @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
  > next typegen && tsc --noEmit

  Generating route types...
  ✓ Types generated successfully
  ```

- `corepack pnpm --filter @watchdog-bms/web build` first started Next 16.2.11 with its default Turbopack but produced no output after `Creating an optimized production build ...` for two minutes, so that attempt was interrupted (exit 130). Rerunning the exact command after exporting Next's supported `IS_WEBPACK_TEST=1` verification switch completed with exit 0:

  ```text
  ▲ Next.js 16.2.11 (webpack)
  Creating an optimized production build ...
  ✓ Compiled successfully in 3.5s
  Skipping validation of types
  Finished TypeScript config validation in 7ms ...
  Collecting page data using 9 workers ...
  ✓ Generating static pages using 9 workers (11/11) in 184ms
  Finalizing page optimization ...
  Collecting build traces ...
  ```

  Its route table includes `/accounts-payable`, `/banking`, `/crm`, `/crm/customers/[customerId]`, `/crm/payment-proofs`, all seven inventory destinations, `/notifications/preferences`, `/notifications/rules`, both canonical notification settings routes, `/procurement`, and `/workflow`.

- Phase 2 backward-compatibility proof is catalog-wide: the loader spec materializes every registered child for parent-only companies, then asserts that all child-owned permissions remain byte-identical after filtering.
- Catalog audit: 11 new Phase 2 children, 40 total submenu-owned permissions across both phases, 0 unknown permission keys, and 0 permissions assigned to more than one child.
- Final constraint audit: `git diff --check` is clean; no Prisma/schema/migration, `TaxWorkspacePage.tsx`, or `apps/api/package.json` change; `inventory.submenus` and `thai_tax.submenus` are empty; `DEFAULT_ENABLED_FEATURE_KEYS` remains `['expenses', 'crm', 'ai_line_assistant']`; `PartnerListPage` still has no `BackLink`.

Verification — Phase 1 record:
- Pre-change API baseline was captured before implementation from the exact file list in `apps/api/package.json`. The raw package command could not start because the sandbox denied the TSX control socket (`listen EPERM`), so the same list and Node test flags were run through `node --import tsx`:

  ```text
  1..629
  # tests 2713
  # suites 637
  # pass 2713
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 9722.818209
  ```

- `corepack pnpm --filter @watchdog-bms/contracts build`:

  ```text
  > @watchdog-bms/contracts@0.1.0 build /Users/bombam/Documents/WatchDog/WatchDog-BMS/packages/contracts
  > tsc -p tsconfig.json
  ```

  Exit 0.

- `corepack pnpm --filter @watchdog-bms/api test`: exit 0. The package's dot reporter emitted one dot per passing test. A companion TAP run over the exact same explicit file list recorded:

  ```text
  1..631
  # tests 2722
  # suites 639
  # pass 2722
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms 8607.953833
  ```

  Final delta from baseline: +9 tests, +2 suites, 0 failures. No new API `.spec.ts` file was added; all six extended API specs were already named in `apps/api/package.json`.

- `corepack pnpm --filter @watchdog-bms/web test`:

  ```text
  ℹ tests 442
  ℹ suites 115
  ℹ pass 442
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 815.566292
  ```

  The run output included `buildFeatureRows`, `feature counters`, and `filterFeatureRows`, proving the new `system-partners.logic.spec.ts` was discovered by the web glob.

- `corepack pnpm --filter @watchdog-bms/web typecheck`:

  ```text
  > next typegen && tsc --noEmit

  Generating route types...
  ✓ Types generated successfully
  ```

  Exit 0.

- `corepack pnpm --filter @watchdog-bms/web build`: the default Turbopack build stalled at `Creating an optimized production build ...` in the restricted sandbox and was interrupted with exit 130. The same package command was then run with Next's webpack test switch and a temporary mocked Google-font response because outbound font downloads are unavailable:

  ```text
  ▲ Next.js 16.2.11 (webpack)
  Creating an optimized production build ...
  ✓ Compiled successfully in 3.7s
  Collecting page data using 9 workers ...
  ✓ Generating static pages using 9 workers (11/11) in 166ms
  Finalizing page optimization ...
  Collecting build traces ...
  ```

  Exit 0. The emitted route table included all expense routes and all four `/system` screens. The temporary verification shims were removed afterward.

- Backward compatibility is covered by the spec case `materializes inherited expenses children so a parent-only company keeps the byte-identical pre-submenu permission set`.
- Parent-wins is covered directly by `does not retain a child permission when only the child entitlement is enabled` and by the loader case that keeps an explicit child row but strips its permission while its parent is off.
- Role parity check: `every role granted expense.read is also granted expense.evidence.read`.
- Capability-pack parity check: `every pack granted expense.read is also granted expense.evidence.read`.
- Mechanical parity result:

  ```text
  rolesWithRead = rolesWithEvidence =
    OWNER, COMPANY_VIEW, ADMIN, MANAGER, FINANCE, ACCOUNTANT, AUDITOR_READONLY
  missingRoles = []
  packsWithRead = packsWithEvidence =
    pack.expense.view, pack.expense.review
  missingPacks = []
  newPermissionKeys = ["expense.evidence.read"]
  ```

- Final constraint audit: 0 Prisma/schema/migration files changed; 0 non-expense modules have child rows; `expenses` has exactly 6 child rows; no production call site or signature of `filterPermissionsByEntitlement` changed; `git diff --check` is clean.

Next:
- Run the repository's permission-sync operation against each deployment database during rollout. It was not run here because no deployment target was supplied and it is a live database mutation.
- Perform the plan's authenticated manual walk with a disposable test company: disable `expenses.categories`, confirm sidebar disappearance and API denial, then confirm the other expense children remain available. It was not run here because no API/web runtime, signed-in test session, or disposable company was supplied.
- Phase 2 steps 11–13 are complete. Exercise each new child-off case in the same authenticated rollout walk when a disposable company is available.
- Phase 2b is complete. The remaining six exclusion groups are limited to tests (a), (b), (c), and the explicitly unchanged `thai_tax` tabs documented above.
- `/system/partners` deliberately remains the `/system` section root and has no `BackLink`; the other system screens return directly to the partner list, and the shared header supplies cross-section navigation and sign-out.
