// 10D: Settings > สาขา — thin client over companies/:companyId/branches.
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type BranchType = 'HEAD_OFFICE' | 'BRANCH' | 'ONLINE' | 'WAREHOUSE';
export type BranchStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';

export type Branch = {
  id: string;
  code: string;
  name: string;
  type: BranchType;
  isVatEstablishment: boolean;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  status: BranchStatus;
  createdAt: string;
  updatedAt: string;
};

export async function listBranches(companyId: string): Promise<Branch[]> {
  const branches: Branch[] = [];
  for (let page = 1; ; page++) {
    const body = await apiFetch<{ items: Branch[]; total: number; page: number; pageSize: number }>(`/v1/companies/${companyId}/branches?pageSize=100&page=${page}`);
    branches.push(...body.items);
    if (body.page * body.pageSize >= body.total) return branches;
  }
}

export type CreateBranchInput = {
  code: string;
  name: string;
  type: BranchType;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
};

export async function createBranch(companyId: string, input: CreateBranchInput): Promise<Branch> {
  return apiFetch(`/v1/companies/${companyId}/branches`, { method: 'POST', body: JSON.stringify(input) });
}

export type UpdateBranchInput = {
  name?: string;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  status?: BranchStatus;
};

export async function updateBranch(companyId: string, branchId: string, input: UpdateBranchInput): Promise<Branch> {
  return apiFetch(`/v1/companies/${companyId}/branches/${branchId}`, { method: 'PATCH', body: JSON.stringify(input) });
}
