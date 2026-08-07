# Plan: Company Role Override

Spec: `docs/specs/company-role-override-spec.md`

No schema migration. `Role.companyId` is already nullable and uniqueness is already
`(scopeKey, key)`, so a company-scoped row with an existing system role's key is legal today.

## Files

### 1. `packages/contracts/src/employee-access.ts`

Add the shared constant so web and API cannot drift (per
`docs/agent-memory/dev-shared-constants-guideline.md`):

```ts
/**
 * Roles a company may never rewrite. OWNER is excluded because an owner could strip
 * access.role.manage from themselves and lock the company out of its own settings;
 * SYSTEM_ADMIN and COMPANY_VIEW are platform-operator roles, not employee roles.
 */
export const NON_EDITABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW'] as const;

export function isRoleEditableByCompany(role: Pick<RoleSummary, 'key'>): boolean;
```

Export both from the package index. Add a spec covering the predicate.

### 2. `apps/api/.../use-cases/update-role.use-case.ts`

Replace the blanket `isSystem` rejection (L28) with:

```ts
if (existing.isSystem && NON_EDITABLE_ROLE_KEYS.includes(existing.key)) {
  throw new ForbiddenException('This role is managed by WatchDog and cannot be edited.');
}
```

Then, inside the existing `$transaction`, before the `role.update`:

- If `existing.isSystem`:
  1. `tx.role.findUnique({ where: { scopeKey_key: { scopeKey: companyId, key: existing.key } } })`
     — reuse an override if one somehow already exists (idempotency).
  2. Otherwise `tx.role.create({ data: { companyId, scopeKey: companyId, key: existing.key,
     name: existing.name, description: existing.description, isSystem: false } })`.
  3. Copy permissions: read the system role's `RolePermission` rows and `createMany` them onto the
     fork. (Needed so a name-only edit — `permissionKeys` undefined — still produces a faithful
     copy.)
  4. Repoint memberships **of this company only**:
     ```ts
     const rows = await tx.membershipRole.findMany({
       where: { roleId: existing.id, membership: { companyId } },
       select: { membershipId: true },
     });
     await tx.membershipRole.deleteMany({
       where: { roleId: existing.id, membershipId: { in: rows.map(r => r.membershipId) } },
     });
     await tx.membershipRole.createMany({
       data: rows.map(r => ({ membershipId: r.membershipId, roleId: fork.id })),
       skipDuplicates: true,
     });
     ```
     Verify the `membership` relation name on `MembershipRole` against `schema.prisma` before
     writing this — do not guess it.
  5. Audit `ACCESS_ROLE_CREATE` for the fork with
     `metadataJson: { forkedFromRoleId: existing.id, key, movedMemberships: rows.length }`,
     risk `HIGH`.
  6. Continue the rest of the use case against `targetRoleId = fork.id` instead of `cmd.roleId`.

Everything after that — `compileRole`, unknown-key rejection, `hasNonCoreCapability`,
`ownerGatedGrantViolation`, the `rolePermission` delete/create, the `ACCESS_ROLE_UPDATE` audit row,
and the final `toRoleSummary` read — stays as it is, just pointed at `targetRoleId`.

Note the permission compilation currently happens **before** the transaction; keep that order and
only move the row-writing into the fork-aware transaction.

### 3. `apps/api/.../use-cases/list-roles.use-case.ts`

After the `findMany`, drop each system role whose `key` is also present on a company-scoped row:

```ts
const overriddenKeys = new Set(rows.filter(r => r.scopeKey === companyId).map(r => r.key));
const visible = rows.filter(r => !(r.scopeKey === 'system' && overriddenKeys.has(r.key)));
```

Keep the existing `orderBy` and the `effectivePermissionCount` mapping.

### 4. `apps/api/.../use-cases/get-access-matrix.use-case.ts`

Apply the same de-duplication to the roles it projects, so the matrix does not show two `Admin`
rows. Read the file first — if it reuses `ListRolesUseCase`, this step is already covered and should
be skipped rather than duplicated.

### 5. `apps/api/.../use-cases/disable-role.use-case.ts`

Unchanged. System roles stay non-disableable; an override is a company role and already qualifies.

### 6. `apps/web/.../PermissionMatrixPrototypePage.tsx`

- Compute `const roleEditable = isRoleEditableByCompany(selectedRole)`.
- Change the action bar condition from `{!selectedRole.isSystem && ...}` to `{roleEditable && ...}`,
  and keep `ปิดใช้งาน` gated on `!selectedRole.isSystem` (only overrides/custom roles may be
  disabled).
- When `!roleEditable`, render a muted lock note in the action bar's place:
  `ตำแหน่งนี้ระบบดูแลให้ แก้ไขไม่ได้` .
- When `selectedRole.isSystem && roleEditable`, show a notice above `RoleBuilder` in edit mode:
  `ตำแหน่งมาตรฐาน — เมื่อบันทึก ระบบจะสร้างสำเนาสำหรับบริษัทของคุณ พนักงาน {staffCounts[id] ?? 0} คนที่อยู่ตำแหน่งนี้จะย้ายมาอัตโนมัติ · บริษัทอื่นไม่ได้รับผลกระทบ`
  (amber banner, same styling as the existing read-only banner).
- `onSubmit` is unchanged — it already calls `updateRole(companyId, selectedRole.id, body)`; the API
  returns the override's summary and the page reloads.

### 7. Tests

API (`*.spec.ts` beside the use cases, matching the existing style):

- forking creates one company-scoped role with the same `key`, `isSystem: false`
- the fork's permission set equals the requested set
- the system role's own `RolePermission` rows are unchanged
- only this company's `MembershipRole` rows move; another company's stay on the system role
- a second update reuses the override and creates no second role row
- each key in `NON_EDITABLE_ROLE_KEYS` still throws `ForbiddenException`
- `ListRolesUseCase` returns one row per key once an override exists

Contracts: a spec for `isRoleEditableByCompany`.

## Verification

- `pnpm --filter @watchdog-bms/contracts test`
- `pnpm --filter @watchdog-bms/api test`
- `pnpm --filter @watchdog-bms/web typecheck`
- e2e `SET-04`, `SET-05`, `SET-09` in `e2e/settings.spec.ts` must still pass.

## Risks

- **Membership repointing** is the dangerous step. It must be scoped by `membership.companyId` and
  must run inside the same transaction as the fork. A partial apply would leave employees with no
  role at all.
- **Session/permission caching** — check whether effective permissions are cached per session; if
  they are, note in the results doc when a user picks up the new permissions.
- **`get-access-matrix`** de-dup must match `list-roles` exactly, or the matrix and the role list
  will disagree about which `Admin` is real.
