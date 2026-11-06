// 10D: company/branch scope data for the workspace header (switcher + branch filter).
// Cookie-session model: same-origin BFF (`/api/v1/*`) with the httpOnly cookie via authedApiFetch —
// no localStorage bearer token, no cross-origin call.
import { authedApiFetch } from '@/common/api/authed-fetch';
import type { PlanTermLockReason, PlanTermState } from '@watchdog-bms/contracts';
import { shopHasSystemWhtCertificates } from '../expenses/expense-wht-certificates.logic';

export type MyCompany = { companyId: string; companyName: string; roles: string[]; roleNames?: Record<string, string>; canManagePlan?: boolean; expired?: boolean; freeExpenseDrafts?: boolean; planState?: PlanTermState; lockReason?: PlanTermLockReason };

export async function fetchMyCompanies(): Promise<MyCompany[]> {
  const body = await authedApiFetch<{ data: MyCompany[] }>('/v1/auth/me/companies');
  return body.data;
}

export type MyContext = {
  userId: string;
  companyId: string;
  roles: string[];
  roleNames?: Record<string, string>;
  permissions: string[];
  scopes?: { branchIds?: string[] };
  manualExpenseWebEntry?: boolean;
  disbursementVoucherWebEntry?: boolean;
  freeExpenseDrafts?: boolean;
  isDemo?: boolean;
  demoExpiresAt?: string;
  entitledFeatureKeys?: string[] | null;
};

type AccessContext = Pick<MyContext, 'roles' | 'roleNames' | 'permissions' | 'scopes' | 'manualExpenseWebEntry' | 'disbursementVoucherWebEntry' | 'freeExpenseDrafts' | 'entitledFeatureKeys' | 'isDemo' | 'demoExpiresAt'>;

export function accessContextFingerprint(context: AccessContext): string {
  const sorted = (items: readonly string[] | undefined) => [...new Set(items ?? [])].sort();
  return JSON.stringify({
    roles: sorted(context.roles),
    roleNames: sorted(context.roles).map((key) => [key, context.roleNames?.[key] ?? '']),
    permissions: sorted(context.permissions),
    // undefined means unrestricted branches; preserve it instead of collapsing it to [].
    branchIds: context.scopes?.branchIds === undefined ? null : sorted(context.scopes.branchIds),
    // Screen settings the menu depends on that change no permission. Only these booleans, never
    // a feature list: an unrelated entitlement change must not refresh every open tab of the shop.
    // A missing value reads as shown, exactly as `canOpenManualWeb` reads it.
    manualExpenseWebEntry: context.manualExpenseWebEntry !== false,
    disbursementVoucherWebEntry: context.disbursementVoucherWebEntry === true,
    freeExpenseDrafts: context.freeExpenseDrafts === true,
    isDemo: context.isDemo === true,
    demoExpiresAt: context.demoExpiresAt ?? null,
    systemWhtCertificates: shopHasSystemWhtCertificates(context.entitledFeatureKeys),
  });
}

export async function fetchMyContext(companyId: string): Promise<MyContext> {
  return authedApiFetch<MyContext>('/v1/auth/me', { headers: { 'X-Company-Id': companyId } });
}

export type BranchOption = { id: string; code: string; name: string; type: string };

export async function fetchActiveBranches(companyId: string): Promise<BranchOption[]> {
  const body = await authedApiFetch<{ items: BranchOption[] }>(
    `/v1/companies/${companyId}/branches?status=ACTIVE&pageSize=100`,
  );
  return body.items;
}

/** Refresh the shop chooser after the profile command changes its display name. */
export const COMPANY_PROFILE_CHANGED_EVENT = 'mangmee:company-profile-changed';
export function notifyCompanyProfileChanged(): void {
  window.dispatchEvent(new Event(COMPANY_PROFILE_CHANGED_EVENT));
}
