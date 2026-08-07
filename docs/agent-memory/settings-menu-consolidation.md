# Agent Memory: Settings Menu Consolidation

Status: Implemented, including owner foundation-gating reversal — 2026-07-29
Owner: Codex
Scope: Settings landing cards, workspace navigation/access rules, shared feature catalog, API entitlement
loading/capability packs, Partner feature controls, duplicate roles route, and regression tests.

Decisions:

- Registered `employee_access` and `company_settings`, with the five §E children and exact permission keys.
- Made only those two parents default-on when no explicit row exists; explicit false still wins.
- Left the original 12 features deny-by-default and kept the zero-row legacy fail-open behavior unchanged.
- Tagged the existing people/company-settings capability packs; did not add another gating path.
- Kept `account.session.read` in ungated `pack.core.basics`; security and branch child rules run before the
  ungated-pack check.
- Reflected default-on state in the Partner screen, gated the security card/header link/direct route, and
  removed legacy `admin.*` navigation fallbacks that could expose employee-access menus after `access.*`
  permissions were stripped.
- Removed duplicate landing cards instead of adding duplicate sidebar children.
- Added the substitute-receipt policy beneath Expenses without moving its route or changing the signatures tab.
- Reused `company.setup.manage`; did not add a permission or `FEATURE_CATALOG` child.
- Made sidebar parents with children navigate to their existing canonical href so พนักงานและสิทธิ์ genuinely opens the permission matrix.
- Treated the policy route as moduleless for active-state resolution so Settings and Expenses do not highlight together.

Open questions:

- With current shared entitlement rules, disabling `crm` while `inventory` remains enabled strips `crm.channel.read` but retains `inventory.product.read`; LINE OA hides, but the CRM catalog card remains.
- Disabling `thai_tax` can leave Tax Account Determination visible through `ledger.posting-rule.*` when `double_entry_ledger` remains enabled.
- New onboarding still writes explicit rows for all approved parents and enables only its existing standard
  package (`expenses`, `crm`, `ai_line_assistant`), so the two new parents are explicitly off for newly
  created companies until the platform operator enables them. This was not changed because the owner
  specified absent-row backward compatibility and explicit false must win.

Artifacts:

- `apps/web/src/features/web-core-workspace/settings-menu.logic.ts`
- `apps/web/src/features/web-core-workspace/settings-menu.logic.spec.ts`
- `apps/web/app/(workspace)/companies/[companyId]/settings/page.tsx`
- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`
- `apps/web/src/common/components/app-shell/AppHeader.tsx`
- `apps/web/src/common/components/app-shell/WorkspaceShell.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/settings/roles/page.tsx`
- `packages/contracts/src/feature-entitlements.ts`
- `apps/api/src/modules/employee-access/application/entitlement.helper.ts`
- `apps/api/src/modules/employee-access/domain/registries/capability-pack.registry.ts`
- `apps/api/src/modules/employee-access/domain/logic/feature-gate.logic.spec.ts`
- `apps/web/src/features/system-partners/system-partners.logic.ts`
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx`

Verification:

- `corepack pnpm --filter @watchdog-bms/contracts build`: pass.
- Focused API entitlement/onboarding/approved-key specs via the sandbox-safe Node loader: 55 pass / 0 fail.
- Full API suite run alone via the same file list and Node loader: 2763 pass / 0 fail.
- Requested `corepack pnpm --filter @watchdog-bms/api test`: blocked before discovery because the sandbox
  forbids the `tsx` CLI Unix IPC socket (`listen EPERM`).
- Focused web logic: 57 pass / 0 fail.
- Full web tests through the sandbox-safe equivalent `node --import tsx --test "src/**/*.spec.ts"`:
  500 pass / 0 fail.
- Requested `corepack pnpm --filter @watchdog-bms/web test`: blocked before discovery by the same `tsx`
  IPC restriction.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: pass.
- Requested default `corepack pnpm --filter @watchdog-bms/web build`: Turbopack remained silent in
  “Creating an optimized production build” and was terminated after 150 seconds.
- `corepack pnpm --filter @watchdog-bms/web exec next build --webpack`: pass; compiled successfully in
  4.1 seconds and generated all routes.
- `git diff --check`: pass.
- SET-01 and SET-08 were inspected; neither asserted heading was changed. E2E was not run.

## Review pass — Claude, 2026-07-29

Three defects found reviewing the implementation. All fixed; the exact package scripts all run here.

1. **Pack-level gating was far too broad.** `pack.company.settings.manage` also carries
   `attachment.create` / `attachment.delete` — granted by no other pack and guarding every upload
   endpoint — plus `company.setup.manage`, which guards the ตั้งค่าใบรับรองแทนใบเสร็จ menu under
   Expenses. Tagging it meant switching ตั้งค่าบริษัท off silently broke receipt upload for a company
   whose Expenses plan was still paid for. The four foundation packs are now untagged; the submenu
   rules do the gating, since they run before the ungated-pack check. `access.permission.read` moved
   into `employee_access.roles` because the pack was previously its only gate. This was a defect in
   the plan's §E, not in the implementation of it — §E has been corrected.

2. **Sidebar parents were made to navigate on click.** That bounced anyone whose permissions cover a
   child but not the parent's own href: an `access.employee.read`-only user clicking พนักงานและสิทธิ์
   was sent to `/settings/permissions`, denied by `exactSettingsRules`, and redirected to the
   dashboard — so they could not open the menu holding their only employee screen. It also yanked
   users off the current page on every collapse. Reverted to expand-only, and the reachability it was
   compensating for is now served properly by a `roles.permissions` child gated on `access.role.read`,
   matching the page's own rule.

3. **New companies would have shipped with foundation administration off.** Onboarding writes an
   explicit row for every approved key and explicit false beats `DEFAULT_ON_FEATURE_KEYS`, so a
   brand-new company could not add its first employee until an operator flipped two switches. Both
   keys added to `DEFAULT_ENABLED_FEATURE_KEYS`, with a spec on the onboarding seed.

Verification (exact package scripts, API run alone):

- `corepack pnpm --filter @watchdog-bms/contracts build`: pass.
- `corepack pnpm --filter @watchdog-bms/api test`: exit 0, 0 failures (4171 assertions).
- `corepack pnpm --filter @watchdog-bms/web test`: 501 pass / 0 fail.
- `corepack pnpm --filter @watchdog-bms/web typecheck`: pass.
- `corepack pnpm --filter @watchdog-bms/web build`: pass (default Turbopack; no hang here).

Next:

- Permission sync before deploy: `expense.evidence.read` and `expense.delete` are new keys.
- No UI/E2E run yet on any of this work.
- Codex's two open questions above (CRM catalog card surviving `crm`-off via `inventory.product.read`,
  and Tax Account Determination surviving via `ledger.posting-rule.*`) are unresolved and are entitlement
  semantics decisions, not defects in this change.
