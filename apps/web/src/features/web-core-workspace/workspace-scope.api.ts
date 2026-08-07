// 10D: company/branch scope data for the workspace header (switcher + branch filter).
// Cookie-session model: same-origin BFF (`/api/v1/*`) with the httpOnly cookie via authedApiFetch —
// no localStorage bearer token, no cross-origin call.
import { authedApiFetch } from '@/common/api/authed-fetch';

export type MyCompany = { companyId: string; companyName: string; roles: string[] };

export async function fetchMyCompanies(): Promise<MyCompany[]> {
  const body = await authedApiFetch<{ data: MyCompany[] }>('/v1/auth/me/companies');
  return body.data;
}

export type MyContext = {
  userId: string;
  companyId: string;
  permissions: string[];
  scopes?: { branchIds?: string[] };
};

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
