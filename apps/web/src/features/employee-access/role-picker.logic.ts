import { workspaceDictionary, type DictionaryKey, type SupportedLocale } from '../../common/i18n/workspace-dictionary';
import { t } from '../../common/i18n/workspace-i18n.logic';
import { THAI_SYSTEM_ROLE_NAMES, HR_ASSIGNABLE_ROLE_KEYS, hasPrivilegedGrant, isRoleEditableByCompany, type EmployeeSummary, type AssignableRoleSummary, type CapabilityPackView, type RoleSummary, type RoleTemplate } from '@watchdog-bms/contracts';

export const EMPLOYEE_BRANCH_SCOPE_HELP = `กำหนดได้เฉพาะสาขาที่บัญชีของคุณเข้าถึง สาขาอื่นให้${THAI_SYSTEM_ROLE_NAMES.OWNER}กำหนด`;

/** The status endpoint checks raw role grants, including custom roles, rather than the role's name. */
export function canChangeEmployeeStatus(permissions: readonly string[], employee: Pick<EmployeeSummary, 'status' | 'roles'> | null | undefined, roles: readonly RoleSummary[]): boolean {
  return !!employee && employee.status !== 'DRAFT' && permissions.includes('access.employee.disable')
    && employee.roles.every(isRoleEditableByCompany)
    && (permissions.includes('access.role.manage') || employee.roles.every(ref => {
      const role = roles.find(role => role.id === ref.id);
      return !!role && !hasPrivilegedGrant(role.permissionKeys);
    }));
}

/** Older memberships keep main-branch access in defaultBranchId, without a branchScopes row. */
export function employeeBranchIds(employee: Pick<EmployeeSummary, 'branchScopeMode' | 'defaultBranchId' | 'branchScopeBranchIds'>): string[] {
  return employee.branchScopeMode === 'DEFAULT_BRANCH_ONLY'
    ? employee.defaultBranchId ? [employee.defaultBranchId] : []
    : employee.branchScopeBranchIds;
}

/**
 * What a role lets a person do in THIS shop, for the read-only lists (the role page, a person's rights).
 * A choice is listed when the role holds every right of it and the shop's package has it. `locked` is
 * the server's own answer (list-capability-packs.use-case): the choice's feature is not among the
 * shop's entitled features, by the same evaluator that strips those rights from the session.
 * Nothing is taken out of the role: the rights of a locked choice stay saved as they are.
 */
export function roleCanDoPacks<P extends Pick<CapabilityPackView, 'isCore' | 'locked' | 'permissionKeys'>>(
  permissionKeys: readonly string[],
  packs: readonly P[],
): P[] {
  const held = new Set(permissionKeys);
  return packs.filter((pack) => !pack.isCore && !pack.locked && pack.permissionKeys.length > 0 && pack.permissionKeys.every((key) => held.has(key)));
}

/**
 * The name the API stores for each standard role. Editing one gives the company
 * its own copy, which starts out with this name: a copy still carrying it was never named by the
 * company, so it reads as the standard role and not as "Accountant".
 * COMPANY_VIEW keeps its legacy stored alias here; the dictionary supplies today's viewer label.
 */
const STANDARD_ROLE_NAMES: Record<string, string> = {
  OWNER: 'Owner', SYSTEM_ADMIN: 'System Admin', COMPANY_VIEW: 'Company owner',
  MANGMEE_SALES_LEAD: 'Mangmee Sales Lead', MANGMEE_SALES: 'Mangmee Sales',
  ADMIN: 'Admin', MANAGER: 'Manager', HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', FINANCE: 'Finance',
  ACCOUNTANT: 'Accountant', MARKETING: 'Marketing', STAFF: 'Staff', AUDITOR_READONLY: 'Auditor (Read-only)',
};

/** A standard role, or a company's copy of one that the company has not given a name of its own. */
export function hasStandardRoleName(role: Pick<RoleSummary, 'key' | 'name'> & { isSystem?: boolean }): boolean {
  return role.isSystem === true || role.name === STANDARD_ROLE_NAMES[role.key];
}

const ROLE_NAME_TO_KEY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(STANDARD_ROLE_NAMES).map(([key, name]) => [name.toLowerCase(), key])),
  sysadmin: 'SYSTEM_ADMIN', auditor: 'AUDITOR_READONLY', 'auditor (readonly)': 'AUDITOR_READONLY',
};

/** Standard roles translate; a company's named copy keeps its name on every surface. */
export function roleDisplayName(
  roleOrKey: (Pick<RoleSummary, 'key' | 'name'> & { isSystem?: boolean }) | string,
  locale: SupportedLocale = 'th',
): string {
  const rawName = typeof roleOrKey === 'string' ? roleOrKey : roleOrKey?.name;
  const normalizedName = String(rawName ?? '').trim().toLowerCase();
  const rawKey = typeof roleOrKey === 'string' ? ROLE_NAME_TO_KEY[normalizedName] ?? roleOrKey : roleOrKey?.key;
  const key = String(rawKey ?? ROLE_NAME_TO_KEY[normalizedName] ?? '').trim().toUpperCase();
  const dictKey = `role.${key}`;
  const standard = dictKey in workspaceDictionary.th
    && (typeof roleOrKey === 'string' || hasStandardRoleName({ key, name: String(rawName ?? ''), isSystem: roleOrKey?.isSystem }));
  return standard ? t(dictKey as DictionaryKey, locale) : (rawName || 'บทบาทที่กำหนดเอง');
}

/** Thai label for a bare system-role key (company switcher, pickers). Unknown keys pass through. */
export function roleKeyDisplayName(key: string): string {
  return roleDisplayName(key);
}

/**
 * The boxes an example role ticks in the role builder, or null when the example cannot be offered.
 * A choice every role holds automatically (a core pack, such as a person's own claims) has no box and
 * the API gives it whatever is sent, so it neither rules the example out nor is ticked. An example is
 * ruled out only by another of its choices that has no box here: one the company has not unlocked or
 * this user may not give. Naming the automatic claim choice had hidden six examples since 2026-08-27.
 */
export function roleTemplateChoices(
  template: Pick<RoleTemplate, 'capabilityPackKeys'>,
  packs: Pick<CapabilityPackView, 'key' | 'isCore'>[],
  tickable: ReadonlySet<string>,
): string[] | null {
  const automatic = new Set(packs.filter((pack) => pack.isCore).map((pack) => pack.key));
  const choices = template.capabilityPackKeys.filter((key) => !automatic.has(key));
  return choices.every((key) => tickable.has(key)) ? choices : null;
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

/** Editing settings needs the view choice too; leave it selected when editing is turned off. */
export function settingsViewIncluded(packKeys: readonly string[]): string[] {
  return packKeys.includes('pack.company.settings.manage') && !packKeys.includes('pack.company.settings.view')
    ? [...packKeys, 'pack.company.settings.view'] : [...packKeys];
}
