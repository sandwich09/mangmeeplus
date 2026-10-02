import { HR_ASSIGNABLE_ROLE_KEYS, type AssignableRoleSummary, type RoleSummary } from '@watchdog-bms/contracts';

const THAI_SYSTEM_ROLE_NAMES: Record<string, string> = {
  OWNER: 'เจ้าของกิจการ', ADMIN: 'ผู้ดูแลบริษัท', SYSTEM_ADMIN: 'ผู้ดูแลระบบ', MANAGER: 'ผู้จัดการ',
  HR: 'ฝ่ายบุคคล', SALES: 'ฝ่ายขาย', INVENTORY: 'ฝ่ายคลังสินค้า', FINANCE: 'ฝ่ายการเงิน',
  ACCOUNTANT: 'ฝ่ายบัญชี', MARKETING: 'ฝ่ายการตลาด', STAFF: 'พนักงาน', AUDITOR_READONLY: 'ผู้ตรวจสอบ (ดูอย่างเดียว)',
  COMPANY_VIEW: 'เจ้าของบริษัท',
  MANGMEE_SALES_LEAD: 'หัวหน้าทีมขายมั่งมี', MANGMEE_SALES: 'เซลล์มั่งมี',
};

/**
 * The name the API stores for each standard role a company may edit. Editing one gives the company
 * its own copy, which starts out with this name: a copy still carrying it was never named by the
 * company, so it reads as the standard role and not as "Accountant".
 */
const STANDARD_ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Admin', MANAGER: 'Manager', HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', FINANCE: 'Finance',
  ACCOUNTANT: 'Accountant', MARKETING: 'Marketing', STAFF: 'Staff', AUDITOR_READONLY: 'Auditor (Read-only)',
};

/** A standard role, or a company's copy of one that the company has not given a name of its own. */
export function hasStandardRoleName(role: Pick<RoleSummary, 'key' | 'name'> & { isSystem?: boolean }): boolean {
  return role.isSystem !== false || role.name === STANDARD_ROLE_NAMES[role.key];
}

export function roleDisplayName(role: Pick<RoleSummary, 'key' | 'name'> & { isSystem?: boolean }): string {
  return hasStandardRoleName(role) ? THAI_SYSTEM_ROLE_NAMES[role.key] ?? role.name : role.name;
}

/** Thai label for a bare system-role key (company switcher, pickers). Unknown keys pass through. */
export function roleKeyDisplayName(key: string): string {
  return THAI_SYSTEM_ROLE_NAMES[key] ?? key;
}

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
export function assignableRoleOptions(roles: RoleSummary[], currentRoleIds?: string | readonly string[]): RoleSummary[] {
  const pinned = new Set(Array.isArray(currentRoleIds) ? currentRoleIds : currentRoleIds ? [currentRoleIds] : []);
  return roles.filter((role) => role.assignableByCurrentUser === true || pinned.has(role.id));
}

/** The viewer's own employee row — the API always rejects a self role change (spec R4). */
export function isSelfEmployee(employee: { userId: string } | null | undefined, viewerUserId?: string): boolean {
  return Boolean(employee && viewerUserId && employee.userId === viewerUserId);
}

/** HR may edit a protected employee's profile, but may not change that employee's system role. */
export function isOperationalRoleTargetReadOnly(
  viewerPermissions: string[],
  currentRole?: Pick<RoleSummary, 'key' | 'isSystem'> | readonly Pick<RoleSummary, 'key' | 'isSystem'>[],
): boolean {
  const currentRoles = Array.isArray(currentRole) ? currentRole : currentRole ? [currentRole] : [];
  return viewerPermissions.includes('access.role.operational.assign')
    && !viewerPermissions.includes('access.role.manage')
    && currentRoles.some((role) => role.isSystem !== true || !HR_ASSIGNABLE_ROLE_KEYS.some((key) => key === role.key));
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
