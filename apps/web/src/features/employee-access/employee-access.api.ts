import type {
  AssignableRoleSummary,
  CapabilityPackCatalog,
  CompanyAccessMatrix,
  EffectiveAccessView,
  EmployeeCredentialHandoff,
  EmployeeLineLinkPackage,
  EmployeeSummary,
  PermissionMatrix,
  RolePreviewInput,
  RolePreviewResult,
  RoleSummary,
  RoleTemplate,
  ThaiAddressOption,
  DiscountPolicy,
  PoApprovalPolicy,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import { ApiError } from '@/common/models/api-error.model';
import { isAssignableRoleCatalog } from './role-picker.logic';

const base = (companyId: string) => `/companies/${companyId}/settings`;

export type CreateEmployeeResult = EmployeeCredentialHandoff & { employeeId: string };

// ---- Employees ----
// ชื่อที่ใช้แสดงบนหน้าจอ: ชื่อเล่นก่อน ถ้าไม่มีใช้ชื่อเต็ม
export const employeeShortName = (e: Pick<EmployeeSummary, 'nickname' | 'displayName'>) =>
  e.nickname?.trim() || e.displayName;

export const listEmployees = (c: string) => apiFetch<EmployeeSummary[]>(`${base(c)}/employees`);
export const getEmployee = (c: string, id: string) => apiFetch<EmployeeSummary>(`${base(c)}/employees/${id}`);
export const createEmployee = (c: string, body: Record<string, unknown>) =>
  apiFetch<CreateEmployeeResult>(`${base(c)}/employees`, { method: 'POST', body: JSON.stringify(body) });
export const completeEmployee = (c: string, id: string) =>
  apiFetch<{ employeeId: string; status: 'ACTIVE' }>(`${base(c)}/employees/${id}/complete`, { method: 'POST' });
export const updateEmployee = (c: string, id: string, body: Record<string, unknown>) =>
  apiFetch<EmployeeSummary>(`${base(c)}/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const setEmployeeStatus = (c: string, id: string, status: string, reason?: string) =>
  apiFetch<EmployeeSummary>(`${base(c)}/employees/${id}/disable`, { method: 'POST', body: JSON.stringify({ status, reason }) });
export const regenerateEmployeeCredential = (c: string, id: string) =>
  apiFetch<EmployeeCredentialHandoff>(`${base(c)}/employees/${id}/credentials/regenerate`, { method: 'POST' });
export const issueEmployeeLineLinkToken = (c: string, id: string) =>
  apiFetch<EmployeeLineLinkPackage>(`${base(c)}/employees/${id}/line-link-token`, { method: 'POST' });
export const revokeEmployeeLineLinkToken = (c: string, id: string) =>
  apiFetch<void>(`${base(c)}/employees/${id}/line-link-token/revoke`, { method: 'POST' });

// ---- Roles and permissions ----
export const listRoles = async (c: string): Promise<AssignableRoleSummary[]> => {
  const roles = await apiFetch<RoleSummary[]>(`${base(c)}/roles`, { cache: 'no-store' });
  if (!isAssignableRoleCatalog(roles)) {
    throw new ApiError({
      kind: 'server_error',
      code: 'invalid_response',
      message: 'Role catalog is missing its assignment permission context.',
    });
  }
  return roles;
};
export const createRole = (c: string, body: Record<string, unknown>) =>
  apiFetch<any>(`${base(c)}/roles`, { method: 'POST', body: JSON.stringify(body) });
export const updateRole = (c: string, id: string, body: Record<string, unknown>) =>
  apiFetch<any>(`${base(c)}/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const disableRole = (c: string, id: string) =>
  apiFetch<any>(`${base(c)}/roles/${id}/disable`, { method: 'POST' });
export const listPermissionCatalog = (c: string) => apiFetch<any[]>(`${base(c)}/permissions`);

// ---- Item 10C+ Phase 1: Smart Roles (capability packs, job presets, effective access) ----
export const listCapabilityPacks = (c: string) =>
  apiFetch<CapabilityPackCatalog>(`${base(c)}/capability-packs`);
export const listRoleTemplates = (c: string) => apiFetch<RoleTemplate[]>(`${base(c)}/role-templates`);
export const previewRole = (c: string, body: RolePreviewInput) =>
  apiFetch<RolePreviewResult>(`${base(c)}/roles/preview`, { method: 'POST', body: JSON.stringify(body) });
export const getEffectiveAccessMatrix = (c: string) =>
  apiFetch<CompanyAccessMatrix>(`${base(c)}/effective-access`);
export const getMembershipEffectiveAccess = (c: string, membershipId: string) =>
  apiFetch<EffectiveAccessView>(`${base(c)}/effective-access/${membershipId}`);

// ---- มั่งมี Flow A: role x menu x action matrix projection (spec D3) ----
export const getAccessMatrix = (c: string) => apiFetch<PermissionMatrix>(`${base(c)}/access/matrix`);

export const listThaiAddresses = (c: string, postalCode: string) =>
  apiFetch<ThaiAddressOption[]>(`${base(c)}/address-master?postalCode=${encodeURIComponent(postalCode)}`);

export const getDiscountPolicy = (c: string) => apiFetch<DiscountPolicy>(`${base(c)}/discount-policy`);
export const saveDiscountPolicyApi = (c: string, body: DiscountPolicy) =>
  apiFetch<DiscountPolicy>(`${base(c)}/discount-policy`, { method: 'PUT', body: JSON.stringify(body) });
export const getPoApprovalPolicy = (c: string) => apiFetch<PoApprovalPolicy>(`${base(c)}/po-approval`);
export const savePoApprovalPolicy = (c: string, body: PoApprovalPolicy) =>
  apiFetch<PoApprovalPolicy>(`${base(c)}/po-approval`, { method: 'PUT', body: JSON.stringify(body) });
