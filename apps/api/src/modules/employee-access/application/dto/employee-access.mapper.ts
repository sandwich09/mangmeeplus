import { entitledRoleMenus, filterPermissionsByEntitlement } from '../../domain/logic/feature-gate.logic';
import type { EmployeeSummary, RoleSummary, PermissionCatalogItem } from '@watchdog-bms/contracts';
import { SYSTEM_ROLES } from '../../../auth/permission-registry';
import { maskIdentityNumber } from '../../domain/logic/employee-access.logic';

export const EMPLOYEE_PROFILE_INCLUDE = {
  user: {
    select: {
      email: true,
      credential: { select: { mustChangePassword: true } },
      externalIdentities: { select: { status: true } },
    },
  },
  membership: {
    select: {
      roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      branchScopeMode: true,
      defaultBranchId: true,
      branchScopes: { select: { branchId: true } },
    },
  },
} as const;

export const ROLE_INCLUDE = {
  permissions: { select: { permission: { select: { key: true } } } },
} as const;

type EmployeeProfileRow = {
  id: string;
  userId: string;
  membershipId: string;
  displayName: string;
  titlePrefix?: string | null;
  jobTitle?: string | null;
  legalName: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
  dateOfBirth?: Date | null;
  addressLine?: string | null;
  postalCode?: string | null;
  province?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  identityType: 'THAI_NATIONAL_ID' | 'PASSPORT';
  identityLast4: string;
  phoneNumber: string;
  email?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    email?: string | null;
    credential: { mustChangePassword: boolean } | null;
    externalIdentities: Array<{ status: string }>;
  };
  membership: {
    roles: Array<{ role: { id: string; key: string; name: string } }>;
    branchScopeMode?: 'ALL_BRANCHES' | 'SELECTED_BRANCHES' | 'DEFAULT_BRANCH_ONLY';
    defaultBranchId?: string | null;
    branchScopes?: Array<{ branchId: string }>;
  };
};

export function toEmployeeSummary(row: EmployeeProfileRow): EmployeeSummary {
  return {
    id: row.id,
    userId: row.userId,
    membershipId: row.membershipId,
    displayName: row.displayName,
    // Null on rows written before the title was split out of displayName; those are never
    // backfilled, so the reader simply gets no title rather than a guessed one.
    titlePrefix: (row.titlePrefix ?? undefined) as EmployeeSummary['titlePrefix'],
    jobTitle: row.jobTitle ?? undefined,
    legalName: row.legalName ?? undefined,
    email: row.email ?? row.user.email ?? undefined,
    firstName: row.firstName ?? undefined,
    lastName: row.lastName ?? undefined,
    nickname: row.nickname ?? undefined,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString() : undefined,
    addressLine: row.addressLine ?? undefined,
    postalCode: row.postalCode ?? undefined,
    province: row.province ?? undefined,
    district: row.district ?? undefined,
    subdistrict: row.subdistrict ?? undefined,
    identityType: row.identityType,
    identityMasked: maskIdentityNumber(row.identityLast4),
    phoneNumber: row.phoneNumber,
    status: row.status as EmployeeSummary['status'],
    roles: row.membership.roles.map((r) => ({ id: r.role.id, key: r.role.key, name: r.role.name })),
    branchScopeMode: row.membership.branchScopeMode ?? 'ALL_BRANCHES',
    defaultBranchId: row.membership.defaultBranchId ?? undefined,
    branchScopeBranchIds: (row.membership.branchScopes ?? []).map((s) => s.branchId),
    mustChangePassword: row.user.credential?.mustChangePassword ?? false,
    lineLinked: row.user.externalIdentities.some((e) => e.status === 'ACTIVE'),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type RoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: string;
  permissions: Array<{ permission: { key: string } }>;
};

/**
 * What the standard roles' descriptions said before they were written in Thai. A company that edited
 * a standard role in those days got its own copy carrying this text, and a stored copy is never
 * rewritten: it is read as the standard role's description of today instead.
 * ponytail: a fixed list for rows already stored; drop it once no company role carries one of these.
 */
const FORMER_STANDARD_DESCRIPTIONS: Record<string, string> = {
  ADMIN: 'Administrative access', MANAGER: 'Manager level access',
  HR: 'Employee administration with operational role assignment', SALES: 'Sales access',
  INVENTORY: 'Inventory access', FINANCE: 'Finance access', ACCOUNTANT: 'Accounting access',
  MARKETING: 'Marketing access', STAFF: 'General staff access', AUDITOR_READONLY: 'Read-only audit access',
};
const STANDARD_DESCRIPTIONS = new Map(SYSTEM_ROLES.map((role) => [role.key, role.description]));

export function toRoleSummary(row: RoleRow, entitled?: Set<string> | null): RoleSummary {
  let description = row.description && row.description === FORMER_STANDARD_DESCRIPTIONS[row.key]
    ? STANDARD_DESCRIPTIONS.get(row.key)
    : row.description;
  if (entitled != null && (row.isSystem || description === STANDARD_DESCRIPTIONS.get(row.key))) {
    const granted = new Set(filterPermissionsByEntitlement(row.permissions.map(p => p.permission.key), entitled));
    const labels = entitledRoleMenus(entitled).filter(menu => menu.actions.view?.some(key => granted.has(key))).map(menu => menu.labelTh);
    description = labels.length ? `เมนูที่บทบาทนี้มีสิทธิ์ใช้: ${labels.join(' · ')}` : 'สิทธิ์ของบทบาทขึ้นอยู่กับเมนูที่บริษัทเปิดใช้';
  }
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: description ?? undefined,
    isSystem: row.isSystem,
    status: row.status as RoleSummary['status'],
    permissionKeys: row.permissions.map((p) => p.permission.key),
  };
}

export function toPermissionCatalogItem(item: { key: string; description: string; riskLevel: string }): PermissionCatalogItem {
  return {
    key: item.key,
    module: item.key.split('.')[0] ?? item.key,
    description: item.description,
    riskLevel: item.riskLevel as PermissionCatalogItem['riskLevel'],
  };
}
