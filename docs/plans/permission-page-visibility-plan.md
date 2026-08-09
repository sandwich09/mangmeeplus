# Permission-Gated Page Visibility — Plan

Status: APPROVED FOR IMPLEMENTATION (Codex executor)
Date: 2026-08-08
Owner: Claude (harness engineer) + Codex CLI (executor)
Execution: `docs/plans/permission-page-visibility-codex-handoff.md`
Task memory: `docs/agent-memory/permission-page-visibility.md`
Related: `docs/specs/auth-authorization-rbac-spec.md`,
`docs/specs/permission-matrix.md`, `docs/plans/expenses-permission-visibility-plan.md`
(the hide-not-disable precedent), `docs/plans/web-access-error-handling-plan.md`

## 1. Problem

Owner report (2026-08-08): users without permission still SEE pages they cannot
use — e.g. `/settings/permissions` renders the full role matrix with the amber
banner "อ่านอย่างเดียว: บัญชีของคุณไม่มีสิทธิ์ access.role.manage …", and
"หลายหน้า" behave the same. Product decision: **a user with no right to a menu
must not see that menu or its page at all.**

Audit (2026-08-08, full sweep — file:line inventory in the audit section of the
task memory) found the root cause is structural, not per-page sloppiness:

1. **The permission gate is one client-side check** —
   `WorkspaceLayout.tsx:74-83` calls `canAccessWorkspacePath()`
   (`web-core-workspace.logic.ts:39-92`) and `router.replace`s to the
   dashboard. No server-side per-page guard exists anywhere.
2. **The same permission keys are hand-duplicated in four places** that must
   agree but don't: module registry (`web-core-workspace.constants.ts`
   `requiredAnyPermissions`), nav children (`buildNavItems`,
   `web-core-workspace.logic.ts:100-279`), settings-hub cards
   (`settings-menu.logic.ts:16-109`), and the exact route rules
   (`web-core-workspace.logic.ts:53-77`). `web-core-workspace.logic.ts:66-68`
   even carries a comment begging the two copies to stay in sync.
3. **Holes found** (each is a user-visible page with no usable right):
   - `roles` submenu children `poapproval`, `discount`, `lineoa` are pushed
     with NO permission check (`web-core-workspace.logic.ts:163-173`).
   - `/settings/po-approval` and `/settings/discount-policy` have NO route
     rule and NO page gate at all.
   - Inventory clients default `canManage = true`
     (`InventoryPages.tsx:79,245`) — `/inventory/products` shows the full edit
     UI to everyone; only the `/settings/crm-catalog/*` wrappers pass the real
     value.
   - `TradeTaxEvidencePage` has no read gate: any `tax.*.read` holder gets an
     editable evidence form (`TradeTaxEvidencePage.tsx:22-25`).
   - `TaxWorkspacePage` has no top-level gate — a `tax.profile.read`-only user
     sees an empty-but-complete workspace.
   - `NotificationCenterPage` never checks `notification.read`
     (`NotificationPages.tsx:32-50`).
   - Route/page key mismatch: `/settings/access-overview` route requires
     `access.effective.read` but the page lists employees via
     `access.employee.read` → 403 error banner + read-only banner together.
   - `TaxAccountSettingsPage.tsx:121-123` banner names `tax.config.read` but
     the code checks `tax.config.manage` (text/logic mismatch).
4. **~10 "อ่านอย่างเดียว / ต้องมีสิทธิ์ X" banners** render full pages with
   disabled controls (inventory in task memory). The vocabulary meant for this
   (`PermissionState` model, `ForbiddenState`'s `readonly` prop) exists but is
   used by zero files.

## 2. Policy (the product rule this plan implements)

Three tiers, decided per route (table in §3):

- **T-MANAGE — configuration screens**: pages whose only purpose is changing
  company configuration. Visible ONLY with the manage-level key. No read-only
  mode, no banner. Menu item, settings card, route, and page all hide/block.
- **T-READ — data/operational screens**: pages whose content is meaningful to
  view (documents, directories, tax data for auditors — `AUDITOR_READONLY` is
  a spec-mandated persona holding `tax.config.read`, `ledger.account.read`
  etc.). Visible with the read key. WITHOUT the manage key: **mutation
  controls hide (do not render)** — the expenses precedent
  (`expenses-permission-visibility-plan.md`: "Read-only info stays visible —
  only actions hide"). All "อ่านอย่างเดียว" banners are deleted.
- **T-BLOCK — no relevant key**: menu hidden, settings card hidden, route
  redirected by the layout gate, and the page itself renders `ForbiddenState`
  if reached (defense in depth for direct URLs / stale sidebars).

Fail-closed rule: a missing/failed session yields NO permissions (`?? []`
already does this) — visibility code must never invert that.

## 3. Route policy table (authoritative)

| Route | Visible with (ANY of) | Tier | Change from today |
|---|---|---|---|
| `/settings/permissions` | `access.role.manage` | T-MANAGE | was `access.role.read` → **the reported page**; read-only matrix mode + banner removed |
| `/settings/roles` | `access.role.manage` | T-MANAGE | was `access.role.read` (route is feature-redirected today; rule kept consistent) |
| `/settings/po-approval` | mirror the PO-approval policy API guard (executor: read the API route for `getPoApprovalPolicy`/`savePoApprovalPolicy` and use its read/manage keys; manage key for visibility) | T-MANAGE | had NO rule |
| `/settings/discount-policy` | mirror the discount-policy API guard (same method) | T-MANAGE | had NO rule |
| `/settings/substitute-receipt` | `company.setup.manage` | T-MANAGE | rule existed; page gains its own block |
| `/settings/line-oa` | mirror the channel-settings API manage guard (executor verifies; expected `crm.channel.manage`-level) | T-MANAGE | card gate was `crm.channel.read` |
| `/settings/notifications`, `/settings/notification-rules` | `notification.preference.manage` / `notification.rule.manage` | T-MANAGE | pages already full-block; menu/route rules aligned |
| `/settings/access-overview` | `access.employee.read` | T-READ | was `access.effective.read` (mismatch fix); edit controls already gate on `access.employee.update/disable` — banner removed, controls hide |
| `/settings/employees` | `access.employee.read` | T-READ | unchanged |
| `/settings/branches` | `company.branch.read`, `company.branch.manage` | T-READ | unchanged |
| `/settings/accounting-tax-setup` | existing read/manage list | T-READ | banners removed; apply buttons hide without manage |
| `/settings/chart-of-accounts` | `ledger.account.read`, `ledger.account.manage` | T-READ | unchanged full-block; manage-blocker copy stays |
| `/settings/tax-codes` | existing list | T-READ | banners removed; activate/retire hide without manage |
| `/settings/tax-accounts` | existing list | T-READ | banner (with its wrong key text) removed; forms hide without `tax.config.manage && ledger.posting-rule.manage` |
| `/settings/crm-catalog/*` | `inventory.product.read` (manage for `/new`) | T-READ | unchanged (already correct) |
| `/tax` (workspace) | `tax.period.read` | T-READ | new top-level gate (was none) |
| `/tax/evidence` | mirror the evidence list API read guard (executor verifies; expected `tax.event.read`-family) | T-READ | new read gate; prepare form renders only with `canPrepareEvidence` |
| `/tax/reconciliation` | `tax.report.read` | T-READ | existing block; recompute banner removed, button hides |
| `/notifications` (center) | `notification.read` | T-READ | new gate |
| `/inventory/*` | module rule (existing) | T-READ | **`canManage` default flips to `false`**; all inventory routes pass real `session.permissions`-derived flags |
| `/journal`, `/reports`, `/ai-suggestions` | module rules (existing) | T-READ | covered by module gate; no page change |
| CRM/inbox/banking/procurement/AP/workflow/expenses/reimbursements | existing tab-visibility + ForbiddenState patterns | T-READ | unchanged (already correct); only their "อ่านอย่างเดียว" strings converge on hide-not-disable |

Sidebar/menu consequences: `roles` parent visibility becomes the union of its
children's rules, and its `buildHref` targets the first child the user can see
(today it hardcodes `/settings/permissions`, `web-core-workspace.logic.ts`
`:135`); children `poapproval`/`discount`/`lineoa` get explicit gates.

## 4. Design

### 4.1 Single source of truth

New module `apps/web/src/features/web-core-workspace/route-permissions.ts`:

```ts
export type RoutePermissionRule = {
  path: string;                       // exact path suffix after /companies/[id]
  anyOf: readonly string[];           // visibility keys (tier encoded by choice of keys)
};
export const ROUTE_PERMISSION_RULES: readonly RoutePermissionRule[] = [ …§3 table… ];
export function canSeeRoute(path: string, permissions: readonly string[]): boolean;
```

Consumed by all four existing layers — `canAccessWorkspacePath` (exact-rule
section replaced by the table), `buildNavItems` child gates,
`filterSettingsMenuItems` card gates, and (new) page-level guards — so a key
change happens in exactly one file. The module fallback matching
(`web-core-workspace.logic.ts:81-91`) stays as-is.

### 4.2 Page-level defense in depth

Tiny helper `requireRoutePermission(session, path): ReactNode | null` used by
the T-MANAGE/T-READ pages named in §3 as gaining "its own block": returns a
`ForbiddenState` render when `canSeeRoute` fails. Server pages call it right
after `fetchServerSession`. This closes the direct-URL flash window (the
layout gate is client-side) without touching all ~35 pages — only those the
audit flagged.

### 4.3 Banner removal / hide-not-disable

Every "อ่านอย่างเดียว/ต้องมีสิทธิ์ X" banner in the audit's §1a list is
deleted. Where the page stays visible (T-READ), the mutation controls the
banner referred to are HIDDEN (not disabled): buttons/forms wrap in
`{canManage && …}`. Where the page becomes T-MANAGE, the whole page is now
unreachable without manage, so its read-only branch is dead code — delete it.
Read-only INFO (values, lists, dates) always stays.

`ForbiddenState` is the one full-block component; its unused `readonly` prop
and the unused `PermissionState` model are deleted (they encode the banner
pattern this plan abolishes).

## 5. Impact analysis

- **OWNER / ADMIN**: hold the manage keys — see everything they saw before.
  Zero regression risk for the owner account.
- **AUDITOR_READONLY**: keeps tax/ledger read pages (T-READ preserved
  deliberately — spec-backed persona). Loses nothing it uses.
- **Employees with stray read keys** (e.g. `access.role.read` via a broad
  pack): the roles matrix and config screens disappear from their sidebar and
  settings hub; direct URLs bounce to the dashboard. This is exactly the
  owner's requested behavior.
- **API surface**: untouched. Backend 403s remain the hard boundary; this
  plan only stops the web UI from rendering screens the API would refuse.
- **E2E**: specs that visit settings pages sign in as owner (full keys) — no
  expected breakage; executor greps `e2e/` for the affected routes and
  reports.
- **Not in scope**: changing which keys any ROLE holds (that is data, not
  code), LINE-side visibility, dead `EmployeeAccessPages.tsx` removal.

## 6. Verification gates (per phase)

1. `corepack pnpm --filter @watchdog-bms/web typecheck`
2. `cd apps/web && CI=true node --import tsx --test "src/**/*.spec.ts"` —
   0 fail (baseline 759)
3. `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build`
4. Post-sweep grep: `grep -rn "อ่านอย่างเดียว" apps/web/src/features` → only
   hits explicitly kept by §3 (expected: zero).
5. Host E2E when the stack is available.
