import { HR_ASSIGNABLE_ROLE_KEYS, type AssignableRoleSummary, type RoleSummary } from '@watchdog-bms/contracts';

/** Prevent an older cached API shape from silently becoming an empty role picker. */
export function isAssignableRoleCatalog(value: unknown): value is AssignableRoleSummary[] {
  return Array.isArray(value) && value.every((role) => (
    typeof role === 'object'
    && role !== null
    && typeof (role as { assignableByCurrentUser?: unknown }).assignableByCurrentUser === 'boolean'
  ));
}

/**
 * Roles the viewer may actually assign. `assignableByCurrentUser` is the server's own grant
 * decision (list-roles.use-case), so the pickers never re-implement the permission math — and the
 * employee's current role stays pinned even when it is not grantable, so every row keeps showing
 * the role they hold today (spec R1/R3).
 */
export function assignableRoleOptions(roles: RoleSummary[], currentRoleId?: string): RoleSummary[] {
  return roles.filter((role) => role.assignableByCurrentUser === true || (Boolean(currentRoleId) && role.id === currentRoleId));
}

/** The viewer's own employee row — the API always rejects a self role change (spec R4). */
export function isSelfEmployee(employee: { userId: string } | null | undefined, viewerUserId?: string): boolean {
  return Boolean(employee && viewerUserId && employee.userId === viewerUserId);
}

/** HR may edit a protected employee's profile, but may not change that employee's system role. */
export function isOperationalRoleTargetReadOnly(viewerPermissions: string[], currentRole?: Pick<RoleSummary, 'key' | 'isSystem'>): boolean {
  return viewerPermissions.includes('access.role.operational.assign')
    && !viewerPermissions.includes('access.role.manage')
    && Boolean(currentRole && (currentRole.isSystem !== true || !HR_ASSIGNABLE_ROLE_KEYS.some((key) => key === currentRole.key)));
}

/**
 * The role field falls back to a read-only badge whenever a change could only end in a 403 —
 * read-only viewer, OWNER target, the viewer's own row — or when the list offers nothing beyond
 * the current role (spec R4/R5/R7).
 */
export function isRoleFieldReadOnly(input: {
  canEditEmployee: boolean;
  isOwnerTarget: boolean;
  isSelfTarget: boolean;
  optionCount: number;
}): boolean {
  return !input.canEditEmployee || input.isOwnerTarget || input.isSelfTarget || input.optionCount <= 1;
}
