// ---- Item 10C: Employee Access and Role Management ----

export type EmployeeAccessStatus = 'DRAFT' | 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
export type EmployeeIdentityType = 'THAI_NATIONAL_ID' | 'PASSPORT';

export type EmployeeRoleRef = {
  id: string;
  key: string;
  name: string;
};

// 10D: membership branch scope (assignment-driven visibility; ALL_BRANCHES = unrestricted)
export type BranchScopeMode = 'ALL_BRANCHES' | 'SELECTED_BRANCHES' | 'DEFAULT_BRANCH_ONLY';

export type ThaiAddressOption = {
  postalCode: string;
  provinceCode: string;
  provinceTh: string;
  districtCode: string;
  districtTh: string;
  subdistrictCode: string;
  subdistrictTh: string;
};

/**
 * คำนำหน้า, stored as its own field since 2026-08-15.
 *
 * It used to be concatenated into `displayName` with no separator, which forced every reader to
 * guess it back out with `startsWith` and silently ate the first characters of anyone whose given
 * name begins with a title. `displayName` now carries the name alone; compose the two with
 * `employeeFullName` wherever the title should be shown.
 * See docs/agent-memory/employee-title-prefix-field.md.
 */
export const EMPLOYEE_TITLE_PREFIXES = ['นาย', 'นาง', 'นางสาว'] as const;
export type EmployeeTitlePrefix = (typeof EMPLOYEE_TITLE_PREFIXES)[number];

/**
 * The name as a document or an employee record should show it. Absent on rows written before the
 * split — and on owners, who have no employee profile at all — so the title is simply omitted
 * rather than guessed.
 */
export function employeeFullName(employee: { titlePrefix?: string; displayName: string }): string {
  return `${employee.titlePrefix ?? ''}${employee.displayName}`;
}

export type EmployeeSummary = {
  id: string;
  userId: string;
  membershipId: string;
  /** The name WITHOUT คำนำหน้า. Use `employeeFullName` to render it with the title. */
  displayName: string;
  titlePrefix?: EmployeeTitlePrefix;
  /** Company-visible job title only; it never grants system permissions. */
  jobTitle?: string;
  legalName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  dateOfBirth?: string;
  addressLine?: string;
  postalCode?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  identityType: EmployeeIdentityType;
  identityMasked: string;
  phoneNumber: string;
  status: EmployeeAccessStatus;
  roles: EmployeeRoleRef[];
  branchScopeMode: BranchScopeMode;
  defaultBranchId?: string;
  branchScopeBranchIds: string[];
  mustChangePassword: boolean;
  lineLinked: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeDetail = EmployeeSummary;

export type CreateEmployeeInput = {
  username: string;
  /** The name WITHOUT คำนำหน้า; send the title in `titlePrefix`. */
  displayName: string;
  titlePrefix?: EmployeeTitlePrefix;
  jobTitle?: string;
  legalName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  dateOfBirth: string;
  addressLine?: string;
  postalCode?: string;
  province?: string;
  district?: string;
  subdistrict?: string;
  identityType: EmployeeIdentityType;
  identityNumber: string;
  phoneNumber: string;
  /** Exactly one role per employee membership. Kept as an array for wire compatibility. */
  roleIds: string[];
  // Set after the owner confirms an `employee_existing_user` prompt: attach a second company
  // membership to the existing account (matched by username) instead of creating a new user.
  linkExistingUser?: boolean;
};

export type UpdateEmployeeInput = {
  /** The name WITHOUT คำนำหน้า; send the title in `titlePrefix`. */
  displayName?: string;
  titlePrefix?: EmployeeTitlePrefix;
  jobTitle?: string | null;
  legalName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  nickname?: string | null;
  dateOfBirth?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  province?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  identityType?: EmployeeIdentityType;
  identityNumber?: string;
  phoneNumber?: string;
  /** Replaces the assignment with exactly one role; omit for profile-only edits. */
  roleIds?: string[];
  branchScopeMode?: BranchScopeMode;
  defaultBranchId?: string | null;
  branchIds?: string[]; // replaces the SELECTED_BRANCHES scope set atomically
};

export type SetEmployeeStatusInput = {
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  reason?: string;
};

export type EmployeeCredentialHandoff = {
  userId: string;
  username: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  expiresAt?: string;
  lineLink?: EmployeeLineLinkPackage;
  /** Regenerate only: true when the temporary password reached the employee's linked LINE. */
  lineNotified?: boolean;
  // true = attached to an existing account; the person keeps their current login, so no
  // temporary password is issued and none is returned (temporaryPassword is empty).
  reusedExistingAccount?: boolean;
};

export type EmployeeLineLinkPackage = {
  linkUrl: string;
  qrImageUrl: string;
  expiresAt: string;
};

// ---- Roles and Permissions ----

export type RoleStatus = 'ACTIVE' | 'DISABLED';

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  status: RoleStatus;
  permissionKeys: string[];
  /** Permissions still usable after this company's feature entitlements — matches the access matrix. */
  effectivePermissionCount?: number;
  /**
   * The requesting user may assign this role right now — the server's own grant decision
   * (`roleGrantViolation`), so pickers never re-implement the permission math. Absent on
   * reads with no requester context (e.g. the access matrix).
   */
  assignableByCurrentUser?: boolean;
};

/** Request-context role catalog returned to browser assignment/view surfaces. */
export type AssignableRoleSummary = RoleSummary & { assignableByCurrentUser: boolean };

export type RoleDetail = RoleSummary;

/**
 * Roles a company may never rewrite. OWNER is excluded because an owner could strip
 * access.role.manage from themselves and lock the company out of its own settings;
 * SYSTEM_ADMIN and COMPANY_VIEW are platform-operator roles, not employee roles.
 */
export const NON_EDITABLE_ROLE_KEYS = ['OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW'] as const;

export function isRoleEditableByCompany(role: Pick<RoleSummary, 'key'>): boolean {
  return !NON_EDITABLE_ROLE_KEYS.some((key) => key === role.key);
}

/** Finance-grade roles; assigning one is owner-gated on `access.role.financial.assign`. */
export const FINANCIAL_ROLE_KEYS = ['FINANCE', 'ACCOUNTANT'];

/** Built-in roles delegated by the HR operational-assignment permission. */
export const HR_ASSIGNABLE_ROLE_KEYS = ['MANAGER', 'SALES', 'INVENTORY', 'MARKETING', 'STAFF'] as const;

/**
 * Roles whose job is oversight of the whole business — governance, finance, audit — so a membership
 * holding one must stay `ALL_BRANCHES` (spec branch-scope-visibility R8). Enforced at the employee
 * write path, never by overriding the permission resolver, so the membership stays the single source
 * of branch truth. OWNER/SYSTEM_ADMIN cannot reach the employee form at all; they are listed so a
 * future direct-write path inherits the rule rather than re-deriving it.
 *
 * Not one of the four broad-read lists (`crm-customer.use-case.ts`, `crm.logic.ts`,
 * `audit.controller.ts`, `workflow-task.use-case.ts`): those answer "whose records", this answers
 * "which branches". MARKETING is deliberately absent here and present in one of those.
 */
export const ALL_BRANCH_ROLE_KEYS = [
  'OWNER', 'SYSTEM_ADMIN', 'COMPANY_VIEW', 'ADMIN', 'HR', 'AUDITOR_READONLY',
  ...FINANCIAL_ROLE_KEYS,
];

export type CreateRoleInput = {
  name: string;
  description?: string;
  permissionKeys?: string[];
  capabilityPackKeys?: string[];
  roleTemplateKey?: string;
};

export type UpdateRoleInput = {
  name?: string;
  description?: string;
  permissionKeys?: string[];
  capabilityPackKeys?: string[];
};

export type PermissionCatalogItem = {
  key: string;
  module: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
};

// ---- Item 10C+ Phase 1: Smart Roles (capability packs, job presets, effective access) ----

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type CapabilityPack = {
  key: string;
  module: string;
  nameTh: string;
  nameEn: string;
  description: string;
  permissionKeys: string[];
  riskLevel: RiskLevel;
  featureEntitlementKey?: string;
  isCore: boolean;
};

export type CapabilityPackView = CapabilityPack & {
  locked: boolean; // not entitled for this company
  lockReason?: string;
  grantableByCurrentUser: boolean; // false if pack exceeds the granter's own permissions
};

export type CapabilityPackCatalog = {
  modules: Array<{ module: string; packs: CapabilityPackView[] }>;
};

export type RoleTemplate = {
  key: string;
  nameTh: string;
  nameEn: string;
  description: string;
  industryTag?: 'retail' | 'trading' | 'service' | 'ecommerce' | 'crosscutting';
  capabilityPackKeys: string[];
  isSystem: boolean;
};

export type EffectivePermission = {
  key: string;
  module: string;
  description: string;
  riskLevel: RiskLevel;
};

export type EffectiveCapability = {
  packKey: string;
  nameTh: string;
  nameEn: string;
  riskLevel: RiskLevel;
};

export type EffectiveAccessView = {
  membershipId?: string;
  displayName?: string;
  roleKeys: string[];
  capabilities: EffectiveCapability[];
  permissions: EffectivePermission[];
  permissionCount: number;
};

export type RolePreviewInput = {
  capabilityPackKeys?: string[];
  permissionKeys?: string[];
  roleTemplateKey?: string;
  roleId?: string; // when editing: compute added/removed vs current
};

export type RolePreviewResult = EffectiveAccessView & {
  droppedKeys: Array<{ key: string; reason: 'not_entitled' | 'above_granter_scope' | 'unknown' }>;
  addedVsCurrent?: string[];
  removedVsCurrent?: string[];
};

export type CompanyAccessMatrixRow = {
  membershipId: string;
  displayName: string;
  roleKeys: string[];
  capabilitySummary: string[]; // human-readable pack names (Thai)
  highRiskCount: number;
};

export type CompanyAccessMatrix = {
  rows: CompanyAccessMatrixRow[];
  total: number;
};
