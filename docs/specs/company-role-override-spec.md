# Spec: Company Role Override (owner edits standard roles)

Status: draft, pending implementation
Related: `docs/plans/company-role-override-plan.md`, `docs/agent-memory/company-role-override.md`

## Product goal

A company owner must be able to set permissions for **every role their employees can hold**, from
`ตั้งค่า → สิทธิ์การใช้งาน`, without a WatchDog operator's help.

## Users

- **Company owner** (`OWNER`, holds every company permission key) — primary.
- Anyone the owner grants `access.role.manage` to — same capability, still bounded by
  `ownerGatedGrantViolation` (a non-owner cannot grant beyond their own permission scope).

## Current behaviour (the defect)

Every role a fresh company sees is a **system role**: `prisma/sync-permissions.ts` writes all twelve
`ROLE_GRANTS` entries with `scopeKey: 'system', isSystem: true`, and `ListRolesUseCase` returns
`scopeKey IN ('system', companyId)`. With no custom roles yet, every row is a system role.

Three layers then block editing:

1. `UpdateRoleUseCase` — `if (existing.isSystem) throw new ForbiddenException(...)`.
2. `DisableRoleUseCase` — same guard.
3. `PermissionMatrixPrototypePage` — the `แก้ไข` / `ปิดใช้งาน` buttons render inside
   `{!selectedRole.isSystem && ...}`, and `PermissionCell` is a `<span>`, never a control.

The owner holds `access.role.manage`, so the existing "อ่านอย่างเดียว" banner does not appear. The
screen simply offers no control and gives no reason — indistinguishable from a broken page.

## Why the obvious fix is wrong

System roles are shared: `scopeKey: 'system'` with `@@unique([scopeKey, key])` means there is
exactly **one** `ADMIN` row for the entire platform. Relaxing the `isSystem` guard would let company
A's owner rewrite the permissions of company B, C, and D. That is a cross-tenant escalation, not a
feature.

## Solution: copy-on-write override

`Role.companyId` is nullable and uniqueness is `(scopeKey, key)`, so a company may own a role whose
`key` equals a system role's key, scoped to itself. The override is created lazily, on first edit.

### Rules

- **R1.** Editing a system role forks it: create `Role { companyId, scopeKey: companyId, key:
  <same key>, name, description, isSystem: false, status: ACTIVE }`, copy its `RolePermission`
  rows, then apply the requested change to the fork. One transaction.
- **R2.** Every `MembershipRole` row that links **a membership of this company** to the system role
  is repointed to the fork. Memberships of other companies are never touched.
- **R3.** The system role row itself is never modified or deleted.
- **R4.** Once an override exists, the company's list shows the override and hides the system role
  of the same `key`. There is never a visible duplicate.
- **R5.** Subsequent edits are plain updates of the override — forking happens at most once per
  (company, role key).
- **R6.** `NON_EDITABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW']` stay forbidden and
  keep returning 403.
  - `OWNER` — the owner could strip `access.role.manage` from themselves and permanently lock the
    company out of its own settings.
  - `SYSTEM_ADMIN`, `COMPANY_VIEW` — platform-operator roles, not roles a company's employees hold.
- **R7.** Disabling a system role stays forbidden. An override, being a company role, may be
  disabled under the existing rules.
- **R8.** Permission-scope rules are unchanged: `compileRole`, `hasNonCoreCapability` ("at least one
  permission"), unknown-key rejection, and `ownerGatedGrantViolation` all still apply to the
  resulting key set.

### Platform-only roles (added 2026-10-02, RB-34)

Copy-on-write keeps the system role's `key`, and several checks compare role keys, so one more
rule bounds what a company may copy.

- **R9.** A platform-only role does not exist for a company other than the platform company.
  The list is `PLATFORM_ONLY_ROLE_KEYS` in `apps/api/src/modules/auth/permission-registry.ts`
  (today the two Mangmee sales roles) and the single test is `platformOnlyRoleRefused(roleKey,
  platformTenant)` in `employee-access.logic.ts`. It is asked by key, so it covers the system row
  and a company copy that kept the key. A shop therefore cannot:
  - list it (`ListRolesUseCase`, which the access matrix also reads);
  - read it, preview it or edit it by id (`GetRoleUseCase`, `PreviewRoleUseCase`,
    `UpdateRoleUseCase` answer `404 Role not found`, the same answer as an unknown id);
  - assign it (`roleGrantViolation`, employee create and update);
  - pick it as a reimbursement approver or route a claim to it
    (`ListReimbursementApproverOptionsUseCase`).

  A copy a shop made before the by-id routes refused it stays in the database and stays with any
  employee who holds it, but it is no longer listed, editable, assignable or offered as an approver;
  its `sales.*` permissions never did anything outside the platform company. It can still be
  disabled by id. Inside the platform company nothing changes.

  A new platform-only role (the executive-report role is the planned one) is defined like any system
  role in `SYSTEM_ROLES` and `ROLE_GRANTS`, and its key is added to `PLATFORM_ONLY_ROLE_KEYS`. That
  one list also feeds `PLATFORM_ROLE_KEYS`, so no other code changes.

### Deployment interaction

`sync-permissions.ts` re-syncs system roles on every deploy. Overrides are company-scoped, so a
deploy never overwrites them. `COMPANY_ROLE_BACKFILLS` already targets company-scoped roles and will
reach overrides — which is correct: an override should receive the same regression backfills any
custom role gets.

## Acceptance criteria

1. Owner opens `ตั้งค่า → สิทธิ์การใช้งาน`, selects `Admin`, presses `แก้ไข`, changes permissions,
   saves. The save succeeds.
2. Employees who held `Admin` in that company still hold `Admin` afterwards, with the new
   permissions; their effective access reflects the change on next session load.
3. A second company's `Admin` role and its members are byte-for-byte unchanged.
4. The role list shows exactly one `Admin` after the override exists.
5. Editing `Admin` a second time does not create another role row.
6. `OWNER`, `SYSTEM_ADMIN`, `COMPANY_VIEW` still return 403 on update, with a message stating why.
7. Before the first edit, the UI tells the owner what pressing save will do (a copy is created for
   this company; N employees move to it; other companies are unaffected).
8. An audit row is written for the fork and for the permission change.

## Out of scope

- Making the read-only permission matrix table cells directly clickable. Editing stays in
  `RoleBuilder`.
- Resetting an override back to the platform default.
- Per-employee permission overrides (no backend model exists).
