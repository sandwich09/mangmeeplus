# Feature: Grantable-Only Role Pickers (Employee Access)

## 1. Status

- Roadmap/checklist item: follow-up under **10C / 10C+** (see [[plans/master-implementation-checklist|Master Implementation Checklist]]); tracked as a UX-correctness slice, not a new numbered item.
- Owner: thawatchai (proposal in chat, 2026-08-19: "ให้แสดงแค่ role ของพนักงานเท่าที่มีสิทธิ์เข้าถึง ไม่ต้องแสดงทั้งหมดของที่ร้านค้ามี").
- Date: 2026-08-19.
- Readiness: **Implement-ready.** Discovery recorded in `docs/agent-memory/employee-role-dropdown-scope.md`.

## 2. Goal

Staff who manage other employees should never be offered a role they cannot actually grant. Today the role pickers list (almost) every role the company has; the API then rejects out-of-scope choices and the web collapses every 403 into the generic "คุณไม่มีสิทธิ์ทำรายการนี้", so the person cannot tell what went wrong. After this change:

1. The assignment pickers list **only roles the requester can actually grant** (same decision rule the API already enforces) — picking from the dropdown can no longer dead-end in a permission error.
2. A member can see **which roles they themselves hold** (workspace sidebar shows all held roles, not only the first).

No authorization behavior changes; this narrows what the UI offers to what the server already allows.

## 3. Source Docs

- Related specs: [[specs/employee-access-role-management-spec|10C Spec]] (§ role-grant subset rule), [[specs/employee-access-role-management-v2-phase1-spec|10C+ Phase 1 Spec]] (granter-scope filtering, `grantableByCurrentUser` precedent on capability packs), [[specs/branch-scope-visibility-spec|Branch Scope Visibility Spec]] (R3 "show only what you may pick" precedent), [[specs/permission-matrix|Permission Matrix]]
- Cache decision: [[adr/0012-private-no-store-api-default|ADR 0012]]
- Related plans: [[plans/employee-access-role-picker-scope-plan|Employee Access Role Picker Scope Plan]]
- Discovery/task memory: `docs/agent-memory/employee-role-dropdown-scope.md`
- Authorization source of truth: `roleGrantViolation` in `apps/api/src/modules/employee-access/domain/logic/employee-access.logic.ts` and the self/owner-target checks in `update-employee.use-case.ts`.

## 4. Non-goals

- No change to server-side authorization, permission keys, or audit behavior. Server guards stay as defense in depth.
- The **role filter** dropdown on สิทธิ์รายบุคคล ("ทุกตำแหน่ง") and the role rail on the permission matrix stay **unfiltered** — they are views over existing data, not grant actions.
- Reimbursement settings "บทบาทผู้อนุมัติเริ่มต้น" (free-text role key, `ReimbursementsPages.tsx` ~1604) — needs its own constrained picker; separate work item.
- Letting admins edit the owner's profile fields (this spec only removes the dead-end entry point; see B1).
- LINE/LIFF surfaces — none exist for role assignment.

## 5. User Roles

- **Owner:** picker shows every assignable role (everything except OWNER/SYSTEM_ADMIN and inactive roles). Unchanged.
- **Admin (default, no `access.role.manage`):** sees no people-manager roles (existing `hasPrivilegedGrant` behavior) and no FINANCE/ACCOUNTANT (owner-gated); other roles only when the role's permissions fit within the admin's own.
- **Admin with delegated `access.role.manage`:** additionally sees people-manager roles whose permissions fit within their own; still no FINANCE/ACCOUNTANT (owner-gated).
- **Manager:** day-to-day picker shows only non-privileged roles whose permissions fit within the manager's own.
- **Auditor / read-only staff (`access.employee.read` only):** no picker at all — read-only role badge (existing behavior, kept).
- **Every member:** sees all of their own held roles in the workspace sidebar.

## 6. Business Journey

1. Trigger: a people-manager opens สิทธิ์รายบุคคล (`/settings/access-overview`) or the add/edit employee wizard (`/settings/employees`).
2. Main user action: change an employee's ตำแหน่ง via the role picker, or assign a role while creating an employee.
3. System response: the picker lists exactly the grantable roles (current role pinned); choosing one saves successfully.
4. Review or approval: n/a (role writes remain audit-logged server-side).
5. Completion state: role saved; "เปลี่ยนบทบาทพนักงานแล้ว" toast (existing).
6. Exception path: if permissions changed mid-session and the server still rejects, the generic forbidden message shows and the page refetches roles + employee data.

## 7. Business Rules

- **R1 — Grantable-only options.** Both assignment pickers (access-overview role listbox; wizard role chips) render only roles the requesting user can grant. Grantability = the API's own rule set: role is ACTIVE; key ∉ {OWNER, SYSTEM_ADMIN}; requester is OWNER, or (a) the role's raw permission keys are a subset of the requester's effective permissions, (b) FINANCE/ACCOUNTANT additionally require `access.role.financial.assign`, and (c) people-manager roles (`PRIVILEGED_GRANT_KEYS`) additionally require `access.role.manage`.
- **R2 — Server-computed flag and fresh contract.** `GET /companies/:id/settings/roles` returns `assignableByCurrentUser: boolean` per role, computed by reusing `roleGrantViolation` per role with the requester's context. The web filters on the flag and never re-implements permission math (mirrors capability packs' `grantableByCurrentUser`). Because this catalog is session/tenant/permission-contextual, API responses default to `Cache-Control: private, no-store, max-age=0`, the browser request uses `cache: 'no-store'`, and a missing boolean is a visible invalid-response error rather than an empty role state. This keeps entitlement filtering consistent automatically (requester permissions are entitlement-filtered per Item 10A AC-FE-2, while role rows are raw — the server already makes that call today).
- **R3 — Current role pinned.** The target employee's current role is always shown as the selected value and remains selectable (re-selecting is a no-op; the API only evaluates grants when the set actually changes). It is never offered for OTHER employees if not grantable.
- **R4 — Self row is read-only.** The API always rejects changing one's own roles, so on the viewer's own row the picker renders as a read-only badge (same treatment as the OWNER row) with the caption "ตำแหน่งของตัวเองต้องให้ผู้ดูแลคนอื่นเปลี่ยนให้". Same rule in the wizard when the edit target is the viewer.
- **R5 — Owner rows offer no edit entry.** Hide "แก้ไขข้อมูลพนักงาน" on OWNER rows in access-overview: the wizard's save payload always carries `roleIds` and the API rejects any role write on an OWNER target, so today the action can only end in a 403 (bug B1). (The role picker on owner rows is already a read-only badge.)
- **R6 — View-only surfaces unchanged.** The role filter dropdown ("ทุกตำแหน่ง") and the permission-matrix role rail keep listing every company role.
- **R7 — Degenerate list collapses to read-only.** If no grantable alternative exists beyond the current role, render the read-only badge instead of a one-item dropdown. In the create wizard, zero grantable roles keeps the existing "ยังไม่มีบทบาทให้เลือก" empty state and blocks submit (existing validation).
- **R8 — Guards and audit unchanged.** `roleGrantViolation`, the self-change block, and DENIED audit rows stay exactly as they are; the UI filter is UX only.
- **R9 — Members see their own roles.** The workspace sidebar user area shows all held roles (localized labels, joined), sourced from the session (`session.roles`), replacing the current first-role-only display.
- **R10 — Stale-grant race.** If a role change still returns 403 (permissions revoked mid-session), keep the generic message and refetch roles + employees so the picker reflects the new reality. (Workspace access-context polling already forces a refresh within ~60s.)

## 8. Boundary and Ownership

- Web owns: rendering, filtering on the flag, read-only/self/owner states, sidebar role display.
- Backend/API owns: grantability computation (single source: `roleGrantViolation`) and all write-path guards.
- LINE/LIFF, AI Gateway, workers: not involved.
- Out of boundary: role *definitions* (create/update role) — already governed by 10C+ granter-scope rules.

## 9. Data Model Draft

- No schema change. Contract-only addition: `RoleSummary.assignableByCurrentUser?: boolean` (additive, optional — existing consumers unaffected).

## 10. Permission and Audit

- Read permission: unchanged (`access.role.read` for the roles list; `access.employee.read` for both routes — and `/settings/employees/page.tsx` must start calling `requireRoutePermission` like its siblings, closing gap B4).
- Create/update permission: unchanged (`access.employee.create` / `access.employee.update`).
- No new permission keys. `access.role.financial.assign` remains seeded to no role (owner-only in effect, per team decision 2026-07-28) — after R1, FINANCE/ACCOUNTANT simply stop appearing for non-owners instead of failing on save.
- Sensitive actions to audit: unchanged — denied grants keep writing `ACCESS_EMPLOYEE_ROLE_ASSIGN / DENIED` audit rows.

## 11. API Behavior

- Endpoint: `GET /v1/companies/:companyId/settings/roles` (existing).
- Change: each `RoleSummary` gains `assignableByCurrentUser`, computed per role as `roleGrantViolation([role], ctx.permissions, ctx.roles.includes('OWNER')) === undefined` (plus ACTIVE-status check).
- Cache contract: browser API responses are private/non-storable by default and API ETags are disabled; intentionally public cacheable routes must override the policy explicitly. Next/static asset caching is a separate web-process policy and is unchanged.
- Validation/idempotency: read-only; no change.
- Error cases: a role catalog missing `assignableByCurrentUser` is rejected by the web as `invalid_response` and shown through the existing load-error state.

## 12. UI Behavior

### Web

- สิทธิ์รายบุคคล (`IndividualPermissionsPrototypePage`): listbox options = roles where `assignableByCurrentUser || role.id === currentRoleId`; self row and degenerate lists per R4/R7; owner-row edit menu hidden per R5; 403 on change triggers reload per R10.
- Add/edit wizard (`AddEmployeePrototypePage`): chips use the same predicate (replacing the client-side `hasPrivilegedGrant` approximation); self-target renders the role section read-only.
- Sidebar (`AppSidebar` via `WorkspaceShell`): user area lists all held roles per R9.
- Loading/empty/forbidden states: existing patterns kept ("ยังไม่มีบทบาทให้เลือก", read-only badges, generic forbidden text).

### LINE/LIFF

- None.

## 13. Edge Cases

- Viewer's own row (R4) and OWNER rows (R5) — read-only; no dead-end saves.
- Employee currently holding a role the viewer cannot grant (e.g. MANAGER viewing an ADMIN): current role stays visible/pinned (fixes today's inconsistency where the listbox omits it, B5).
- Custom role with zero permission keys: trivially a subset → grantable by any people-manager; acceptable (matches API).
- Companies with no entitlement rows (legacy fail-open): requester permissions unfiltered → same result as today.
- Multi-role memberships: UI stays single-select (existing); `roleIds: [one]` replaces the set (existing behavior, unchanged).
- Viewer with `access.employee.read` but without `access.role.read` (custom role): roles list request fails → picker absent, page still renders (existing behavior, kept).

## 14. Acceptance Criteria

- [ ] No selectable option in either assignment picker can produce a permission error under stable permissions (verified per seeded QA role).
- [ ] Non-owner admins/managers no longer see FINANCE/ACCOUNTANT or permission-superset roles; owner sees all assignable roles.
- [ ] Own row and OWNER rows expose no role picker and no dead-end "แก้ไขข้อมูลพนักงาน" path.
- [ ] Current role remains visible/pinned for every employee row.
- [ ] Sidebar shows every role the member holds.
- [ ] View-only role lists (filter dropdown, matrix rail) still show all roles.
- [ ] Server write guards and DENIED audit rows unchanged.

## 15. Test Cases

- Unit (api): `list-roles.use-case` flag matrix — owner / default admin / admin+role.manage / manager / financial roles / subset violation / inactive role.
- Unit (web): picker predicate + self-row/owner-row/degenerate-list rendering logic (pure helpers).
- Contract/cache regression: the web rejects the pre-flag role shape; API middleware emits private `no-store` by default while preserving an explicit route override.
- Permission: e2e harness `pageAs` (`e2e/_roles-reference.spec.ts`) — MANAGER and ADMIN see filtered pickers; existing `settings.spec.ts` access-overview flow stays green.
- Edge case: role-change 403 path refetches (mock revocation).

## 16. Open Questions

- Sidebar multi-role display format when a member holds 3+ roles (join all vs "first + n") — default: join all, revisit if it wraps badly on 390px.
