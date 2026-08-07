# Plan: Per-Person Menu Permission Overrides (gap G15 — MembershipMenuOverride)

Status: PLANNED — 2026-07-26
Owner: Claude (harness engineer) → Codex (implementation)
Branch: `fix/permissions-system` (PR #41 open; three verified expense workstreams already on it)
Scope: apps/api (model + migration + endpoints + resolver) + packages/contracts + apps/web (wire the existing prototype toggles). Supersedes the "keep switches disabled" state; must honor the binding constraints in `docs/plans/employee-access-role-management-v2-plan.md:440-445` and `docs/specs/permission-matrix.md:109-115`.

## Product rules (the spec)

1. A company admin can set, per employee (membership) and per menu, one of: **ALLOW** (เปิดเมนูนี้ให้คนนี้แม้ตำแหน่งไม่ให้), **DENY** (ปิดเมนูนี้สำหรับคนนี้แม้ตำแหน่งให้), or **INHERIT** (ตามตำแหน่ง = no row). Overrides are an *additional audited layer* — system-role defaults stay code-registered, never edited by this feature.
2. **ALLOW grants the menu's `view` keys only** (from `MENU_REGISTRY[menu].actions.view`). Create/edit/delete/approve still come from the role — a toggle must never escalate to void/confirm/manage.
3. **DENY subtracts ALL of that menu's action keys** (view+create+edit+del+approve) from the person's effective permissions.
4. **Entitlement filter still wins**: overrides apply BEFORE `filterPermissionsByEntitlement` in every resolution path — an ALLOW on a feature the company plan disables is silently inert (same rule that binds OWNER today).
5. **Protected targets**: overrides can never be written for (and are ignored at runtime on) memberships holding `NON_ASSIGNABLE_ROLE_KEYS` (`OWNER`, `SYSTEM_ADMIN`). UI keeps the "เจ้าของร้านเป็น super-admin" copy.
6. **No self-service**: a requester cannot override their own membership (mirrors `update-employee` self-mutation denial, DENIED audit row).
7. **Granter ceiling**: ALLOW requires the requester to hold every key being granted (the menu's view keys), Owner exempt — same shape as `roleGrantViolation`. DENY has no ceiling (narrowing) but still requires the write permission.
8. **Permissions to use the feature** (no new permission keys — no registry/sync changes):
   - read overrides: `access.employee.read`
   - write overrides: `access.role.manage` (ADMIN + OWNER hold it; MANAGER intentionally cannot)
9. **Eligible menus**: only `MenuId`s with non-empty `actions.view`, intersected with the page's `MVP1_INDIVIDUAL_PERMISSION_MENU_IDS` (`dashboard, inbox, customers, booking, crmreport, expenses, salesdoc`). `sales` (no view keys) and forward-declared keys stay out.
10. Effect is immediate for web/API (resolver is per-request, uncached). The JWT `permissions` claim (AI-gateway fast path) refreshes on token refresh — same staleness as role changes today; acceptable, documented.
11. Every write is audited in the same transaction: success + denied attempts, `riskLevel: 'HIGH'`, metadata `{membershipId, menuId, effect, granterUserId}`.

## Implementation steps

### A. Schema + migration (apps/api/prisma)
- `enum MembershipMenuOverrideEffect { ALLOW DENY }`
- `model MembershipMenuOverride`: `id`, `companyId`, `membershipId` (FK → `CompanyMembership`, add `menuOverrides MembershipMenuOverride[]` back-relation), `menuId String`, `effect MembershipMenuOverrideEffect`, `createdByUserId`, `createdAt/updatedAt`; `@@unique([membershipId, menuId])`, `@@index([companyId])`.
- Migration dir `20260726xxxxxx_g15_membership_menu_override` (plain CREATE TYPE/TABLE per `docs/guidelines/backend-hexagonal-code-style.md:142-152` — no IF NOT EXISTS on new objects). Run `pnpm --filter @watchdog-bms/api prisma:validate` + `migration:review`.

### B. Domain logic (pure, unit-tested) — `apps/api/src/modules/employee-access/domain/logic/menu-override.logic.ts`
```ts
export const OVERRIDE_ELIGIBLE_MENU_IDS: MenuId[]            // rule 9, derived from MENU_REGISTRY
export function applyMenuOverrides(granted: string[], overrides: {menuId: string; effect: 'ALLOW'|'DENY'}[]): string[]
  // DENY first (remove all action keys), then ALLOW (add view keys); unknown menuIds ignored
export function menuOverrideViolation(menuId, effect, requesterPermissions, requesterIsOwner): string | undefined
  // ineligible menu | ALLOW ceiling check (view keys ⊆ requester perms, owner exempt)
```
Spec: `menu-override.logic.spec.ts` (node:test) — deny removes every action key incl. approve; allow adds view only; deny+allow row impossible by unique but function is deny-wins; owner exempt; ineligible menu rejected; empty overrides = identity.

### C. Runtime resolution — the single most delicate step
- `prisma-permission-resolver.repository.ts`: add `menuOverrides: { select: { menuId: true, effect: true } }` to `membershipInclude`; after the role-union (~L68) and **before** `filterPermissionsByEntitlement` (~L73): `if (!roles.includes('OWNER') && !roles.includes('SYSTEM_ADMIN')) granted = applyMenuOverrides(granted, membership.menuOverrides)`.
- Extend `permission-resolver.spec.ts` (`makeMembership` factory): ALLOW adds view key; DENY removes despite role grant; OWNER membership ignores overrides; override-allowed key still stripped by entitlement filter.
- `get-membership-effective-access` / `getMembershipEffectiveAccess` path: verify what it computes from — if it unions role keys itself, apply the same `applyMenuOverrides` there so the "effective access" screen and the live resolver agree (this is the regression class the existing comments warn about). Add/extend its spec accordingly.

### D. API endpoints — `employee.controller.ts` (+ DTO in `employee-access.dtos.ts`, class-validator style)
- `GET  companies/:companyId/settings/employees/:employeeId/menu-overrides` → `{ overrides: MembershipMenuOverrideView[] }` — `@RequirePermissions('access.employee.read')`
- `PUT  companies/:companyId/settings/employees/:employeeId/menu-overrides/:menuId` body `{ effect: 'ALLOW' | 'DENY' | 'INHERIT' }` — `@RequirePermissions('access.role.manage')`; INHERIT deletes the row.
- New use case `set-menu-override.use-case.ts` following `update-employee.use-case.ts` verbatim pattern: tenant-scoped employee load (404), protected-target guard (rule 5), self-mutation denial + DENIED audit (rule 6), `menuOverrideViolation` ceiling (rule 7, requester owner via `ctx.roles`), upsert/delete + `tx.auditLog.create` in one `$transaction` (action constants added to `audit-action.ts`: `access.employee.menu_override.set` / `.clear`).
- Spec `set-menu-override.use-case.spec.ts` (fake Prisma, node:test): each guard → 403 + DENIED audit; ALLOW/DENY upsert + audit metadata; INHERIT delete; ceiling owner-exempt.
- **Gotcha: `apps/api/package.json` `test` script lists spec files explicitly — new specs MUST be appended there or they silently never run.**

### E. Contracts — `packages/contracts/src/employee-access.ts`
`MembershipMenuOverrideEffect`, `MembershipMenuOverrideView { menuId, effect, updatedAt }`, `SetMenuOverrideInput { effect: MembershipMenuOverrideEffect | 'INHERIT' }`. Rebuild contracts before web typecheck.

### F. Web wiring — `IndividualPermissionsPrototypePage.tsx` (+ `employee-access.api.ts`, + new `menu-override.model.ts`)
- api: `listMenuOverrides(companyId, employeeId)`, `setMenuOverride(companyId, employeeId, menuId, effect)`.
- New pure model `menu-override.model.ts` (+ `.spec.ts`, plain `.ts` — the web runner only picks up `*.spec.ts`): `mergeMenuState(roleHasView: boolean, override?: Effect)` → `{ enabled: boolean; source: 'role' | 'override_allow' | 'override_deny' }`, and `nextToggleEffect(state)` → effect to send on toggle (role-on→DENY, role-off→ALLOW, override→INHERIT-on-reset).
- Page: add overrides fetch to `reload()`'s `allSettled`; `AccessRow` gets `{ state, disabled, onToggle, onReset }` — live `ToggleSwitch` (it already supports `onChange`), pill shows ตามตำแหน่ง / กำหนดเอง: เปิด / กำหนดเอง: ปิด, a small "คืนค่าตามตำแหน่ง" reset link when overridden. `disabled = selectedIsOwner || !selectedActive || busy || !canManageRoles`. Mutations via the existing `withBusy` + `reload()` pattern.
- The "เมนูที่จะเห็นจริง" chips recompute through `mergeMenuState`.
- Copy: remove the "จะเปิดใช้งานในเฟสถัดไป" disclaimer; keep the OWNER super-admin branch; viewers without `access.role.manage` see the toggles disabled with the read-only hint (repo pattern B).

### G. Docs updates (same change set)
- `docs/specs/permission-matrix.md:109-115`: replace the "keep them disabled" note with the shipped model + rules 1–11 summary.
- `docs/plans/employee-access-role-management-v2-plan.md`: mark G15's switch-half done (the `expense.receipt.line_upload` exposure half stays open — out of scope here, record why).
- `docs/agent-memory/membership-menu-override.md` per template.

## Out of scope
- New permission keys / registry / sync changes; per-action (non-view) overrides; branch/team-scoped overrides; `expense.receipt.line_upload` matrix exposure; Redis caching; LIFF UI.

## Verification protocol (harness re-runs independently)
1. `corepack pnpm --filter @watchdog-bms/api prisma:validate` and `migration:review` output sane (single new type+table)
2. API tests: record baseline count first, then full run — 0 fail, new specs present in `package.json` test script AND in the run output
3. `corepack pnpm --filter @watchdog-bms/contracts build` → web test (baseline 348 + new model spec) → typecheck → build
4. Full-diff review vs rules 1–11; scope guard; resolver diff especially: override application sits before entitlement filter and inside the no-OWNER branch
5. e2e `SET-08` unaffected (heading unchanged); stack-up manual walk: toggle each state as ADMIN, verify sidebar changes for the target user, OWNER row locked, DENIED audit rows for self/owner attempts

## Acceptance checklist (harness signs off)
- [ ] Schema/migration per A; prisma validate + migration review clean
- [ ] Pure logic per B with full spec coverage (deny-all-actions, allow-view-only, owner-exempt ceiling)
- [ ] Resolver applies overrides pre-entitlement, skips OWNER/SYSTEM_ADMIN, spec'd (C); effective-access path agrees
- [ ] Endpoints + use case with all four guards + transactional audit incl. DENIED rows (D); specs registered in package.json
- [ ] Contracts types exported and consumed (E)
- [ ] Web toggles live with three-state pill + reset, gated by access.role.manage, chips recompute (F)
- [ ] Docs updated (G)
- [ ] All verification commands green; no unrelated diffs; PR #41 scope note updated if pushed there
