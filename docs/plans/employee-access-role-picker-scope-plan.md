# Employee Access Role Picker Scope Implementation Plan

## Linked Spec

- Spec: [[specs/employee-access-role-picker-scope-spec|Grantable-Only Role Pickers Spec]]
- Roadmap/checklist item: 10C / 10C+ UX-correctness follow-up (Reorder Log 2026-08-19)
- Related guidelines: ponytail full mode; no `package.json` edits; additive contract change only
- Task memory: `docs/agent-memory/employee-role-dropdown-scope.md`

## Purpose

Make the employee-access role pickers offer only roles the requester can actually grant, remove the dead-end saves that today end in the generic "คุณไม่มีสิทธิ์ทำรายการนี้", and let members see all roles they hold. Server authorization does not change; the server starts publishing its own grant decision per role so the web can stop approximating it.

## Current Repository Context

- Authorization source of truth: `roleGrantViolation` — `apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts:36` (OWNER/SYSTEM_ADMIN never assignable; owner bypass; permission-subset rule; FINANCE/ACCOUNTANT owner-gate via `access.role.financial.assign`, seeded to no role). Self-change block + owner-target block: `update-employee.use-case.ts:47-57` (owner-target rejection fires whenever `roleIds` is present; self/grant checks fire only when the role set actually changes).
- Roles list: `ListRolesUseCase` (`list-roles.use-case.ts`) returns system+company roles with raw `permissionKeys`; controller `role.controller.ts:26` has `@ReqCtx()` available. Requester `ctx.permissions` are entitlement-filtered (`prisma-permission-resolver.repository.ts:71-79`), role rows are raw — `roleGrantViolation` already lives with that asymmetry; computing the flag server-side keeps UI and API consistent by construction.
- Web pickers:
  - `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx` — listbox ~519-548 (filter: not OWNER/SYSTEM_ADMIN, ACTIVE, `canManageRoles || !hasPrivilegedGrant`), `changeSelectedRole` ~358, viewer flags 208-210, edit-menu item ~583, role FILTER dropdown ~461-470 (must stay unfiltered).
  - `apps/web/src/features/employee-access/AddEmployeePrototypePage.tsx` — assignable filter ~294-297 (keeps `r.id === currentRoleId`), chips ~741-750, save payload always includes `roleIds: [roleId]` (~493).
- Existing patterns to reuse: capability packs' per-item `grantableByCurrentUser` (`list-capability-packs.use-case.ts:21`); read-only badge branch for OWNER rows (`selectedIsOwner || !canEditEmployee`); branch selector scope-intersection precedent (`WorkspaceScope.tsx:71`).
- Sidebar: `WorkspaceLayout.tsx:168` passes `session.roles[0]` → `WorkspaceShell` → `AppSidebar` `roleLabel` (`AppSidebar.tsx:127`, label map `ROLE_LABEL_KEYS`).
- E2E: `e2e/_roles-reference.spec.ts` (`pageAs` every seeded QA role), `e2e/settings.spec.ts` (access-overview journey).

### Adjacent findings register (impact / bug / gap sweep, 2026-08-19)

| ID | Type | Finding | Disposition |
|----|------|---------|-------------|
| B1 | Bug (reachable) | OWNER rows offer "แก้ไขข้อมูลพนักงาน" (`IndividualPermissionsPrototypePage.tsx:583` gates only `canEditEmployee`); wizard save always sends `roleIds`, and `update-employee.use-case.ts:47` rejects any role write on an OWNER target → every save 403s. Wizard also preselects a wrong role for the owner (owner's role never in `assignable`, falls back to `assignable[0]`). | Fix here (R5): hide the edit entry on OWNER rows. |
| B2 | Gap (core) | Pickers list FINANCE/ACCOUNTANT and permission-superset roles that non-owners can never grant → guaranteed 403 rendered as generic Thai text. | Fix here (R1/R2). |
| B3 | Gap (core) | No self-row guard; API always rejects self role change. | Fix here (R4). |
| B4 | Inconsistency | `settings/employees/page.tsx` is the only employee-access route not calling `requireRoutePermission` (rule already exists at `route-permissions.ts:16`). | Fix here (Phase 5). |
| B5 | Inconsistency | Access-overview listbox drops the employee's current role when filtered (no `currentRoleId` pin, unlike wizard). | Fix here (R3). |
| B6 | Adjacent bug | Reimbursement "บทบาทผู้อนุมัติเริ่มต้น" is free text (`ReimbursementsPages.tsx:1604`); typo/unheld role later blocks approvers with "บทบาทของคุณไม่ตรงกับผู้อนุมัติที่กำหนดไว้ในขั้นนี้". | Out of scope; separate work item (needs its own constrained picker). |
| B7 | Latent | Unrouted `EmployeeAccessPages.tsx` page components keep an unfiltered role-checkbox UI; would regress the spec if ever remounted. | Note only; do not delete in this pass. |
| B8 | Product nuance | `access.role.financial.assign` seeded to nobody → only OWNER can ever grant FINANCE/ACCOUNTANT; after R1 they disappear from every non-owner picker (intended per team decision 2026-07-28 — surfaced for owner awareness). | Documented in spec §10. |
| B9 | Accepted behavior | Entitlement-filtered requester permissions vs raw role keys: roles carrying non-entitled feature permissions are non-grantable by non-owners (Item 10A deny/hide-together). Server-computed flag inherits this automatically. | Documented in spec §11/§13. |

- Known dependencies: none new. Contract addition is optional/additive (`RoleSummary.assignableByCurrentUser?`), so `PermissionMatrixPrototypePage` and other `listRoles` consumers are unaffected.
- Open implementation risks: see Risks.

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Keep route/controller files thin; grantability stays in domain logic (`roleGrantViolation` reused per role — no duplicate rule implementation).
- Reuse existing helpers/components (read-only badge branch, empty states, `localizedErrorMessage`).
- Do not implement outside phase scope; no `package.json` edits; no new dependencies.

## Scope

### In Scope

- API: per-role `assignableByCurrentUser` on `GET .../settings/roles`; contract field.
- Web: both assignment pickers filtered on the flag; self-row + degenerate-list read-only states; current-role pin on access-overview; hide owner-row edit entry; 403-on-change refetch.
- Web: sidebar shows all held roles.
- Route guard parity for `/settings/employees` (B4).

### Out of Scope

- B6 (reimbursement approver-role picker), B7 cleanup, any change to write-path guards/audit, role-definition surfaces (permission matrix, role builder), LINE/AI surfaces.

## Phase 0: Discovery and Alignment

### Goal

- Confirm spec, contracts, permissions, and current code still align.

### Tasks

- [x] Discovery pass recorded in `docs/agent-memory/employee-role-dropdown-scope.md` (surfaces, guards, parity, adjacent findings B1–B9).
- [ ] Re-read spec §7 rules before each phase; record deviations in task memory.

### Exit Criteria

- Alignment clear (done 2026-08-19).

## Phase 1: API — publish grantability per role

### Goal

- `RoleSummary.assignableByCurrentUser` computed server-side from the existing rule.

### Tasks

- [x] `packages/contracts/src/employee-access.ts`: add optional `assignableByCurrentUser?: boolean` to `RoleSummary`.
- [x] `list-roles.use-case.ts`: accept requester context (`permissions: string[]`, `isOwner: boolean`); per role set flag = `status === 'ACTIVE' && roleGrantViolation([{ key, permissionKeys }], permissions, isOwner) === undefined`. Requester stays optional so `GetAccessMatrixUseCase` (no request context) keeps reading the list without the flag.
- [x] `role.controller.ts` `list()`: pass `ctx.permissions` and `ctx.roles.includes('OWNER')`.

### Tests

- [x] Flag matrix added to the already-registered `role-management.use-case.spec.ts`: owner sees all assignable true; default admin → FINANCE/ACCOUNTANT + people-manager roles false; admin+`access.role.manage` → people-manager true when subset holds, financial still false; manager subset-violation false; inactive false; OWNER/SYSTEM_ADMIN false; no requester → flag absent.

### Exit Criteria

- Focused api tests green; typecheck green.

## Phase 2: Web — access-overview picker (สิทธิ์รายบุคคล)

### Goal

- Picker offers exactly grantable roles; self/owner rows can no longer dead-end.

### Tasks

- [x] Listbox options: `assignableRoleOptions(roles, selectedRole?.id)` replacing the `hasPrivilegedGrant` approximation (server flag already encodes the OWNER/SYSTEM_ADMIN/ACTIVE exclusions; current-role pin per R3/B5).
- [x] Self row: read-only-badge branch is now `isRoleFieldReadOnly({ canEditEmployee, isOwnerTarget, isSelfTarget, optionCount })`; `viewerUserId` threaded from the server session like `viewerPermissions`; caption per spec R4.
- [x] Degenerate list (no grantable alternative): read-only badge via the same helper (R7).
- [x] OWNER rows offer no edit entry (B1/R5): the three-dot menu was already wrapped in `!selectedIsOwner`, so the remaining hole was the handler — `editSelectedEmployee` now carries the same `selectedIsOwner` guard as `deleteSelectedEmployee`.
- [x] `changeSelectedRole`: 403 triggers `await reload()` before rethrowing, so `withBusy` still renders the generic forbidden message (R10).
- [x] Role FILTER dropdown untouched (R6).

### Tests

- [x] `role-picker.logic.ts` + `.spec.ts` (option predicate, self-row test, row-state decision), covering: owner viewer, manager viewer, self row, owner row, current-role pin, degenerate list.

### Exit Criteria

- Web unit tests + typecheck green; manual browser check as MANAGER and ADMIN.

## Phase 3: Web — add/edit employee wizard

### Goal

- Same grantability source in the wizard; self-edit cannot dead-end.

### Tasks

- [x] Filter replaced with `assignableRoleOptions(roles, currentRoleId)` (pin kept). The now-dead `viewerPermissions` prop was dropped from the wizard and its route page.
- [x] Self-target (`isSelfEmployee(editingEmployee, viewerUserId)`) renders the ตำแหน่ง section read-only with the current role (R4); the unchanged `roleIds` still ship (API no-op).
- [x] Empty state "ยังไม่มีบทบาทให้เลือก" + submit validation untouched (R7).

### Tests

- [x] Same `role-picker.logic.spec.ts` covers the predicate reused here (no duplicate logic).

### Exit Criteria

- Create + edit journeys verified in browser as OWNER and MANAGER.

## Phase 4: Web — sidebar shows all held roles

### Goal

- Members learn their roles from the shell (R9).

### Tasks

- [x] `WorkspaceLayout.tsx`: `userRole={session.roles[0]}` → `userRoles={session.roles}`; `WorkspaceShell`/`AppSidebar` take the array and join localized `roleLabelKey` labels with " · " on the existing `truncate` line (safe at 390px).

### Tests

- [x] No spec asserted the single-role prop (`userRole` had no other reference in the repo); full web suite re-run instead.

### Exit Criteria

- Sidebar shows all roles for a multi-role QA member; no layout break at 390px.

## Phase 5: Route-guard parity (B4)

### Tasks

- [x] `apps/web/app/(workspace)/companies/[companyId]/settings/employees/page.tsx`: calls `requireRoutePermission(session, '/settings/employees')` like siblings.

### Exit Criteria

- Unauthorized visit renders the standard forbidden state instead of a load error.

## Integration Verification

- Backend/API contract: `GET settings/roles` includes the flag; `PermissionMatrixPrototypePage` unaffected (additive field).
- Web journey: as MANAGER — picker shows only grantable roles, current role pinned, self row read-only; as OWNER — full assignable list; owner row shows no edit entry for non-self viewers.
- Loading/error/permission states: empty-state, forbidden route state, 403-refetch path.
- E2E/browser check: `e2e/settings.spec.ts` and `_roles-reference.spec.ts` stay green; manual `pageAs(MANAGER)` picker sweep.
- Commands: `pnpm --filter @watchdog-bms/api test -- list-roles` (or nearest focused pattern), `pnpm --filter web test -- employee-access`, `pnpm typecheck`, targeted Playwright run for `settings.spec.ts`.

## Risks

- Stale flag after mid-session permission change → R10 refetch + 60s access-context poll + server guard (accepted residual).
- Over-filtering regression on view-only lists if the flag is applied too broadly → R6 explicit; verify filter dropdown + matrix rail after Phase 2/3.
- Multi-role memberships: UI remains single-select; pinning uses `roles[0]` as today — no behavior change intended.
- B7 latent regression if dead page components are remounted — covered by note in task memory.

## Open Questions

- Sidebar display format for members holding 3+ roles (spec §16) — decide during Phase 4 with 390px check.
