export type BranchStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
export type BranchType = 'HEAD_OFFICE' | 'BRANCH' | 'ONLINE' | 'WAREHOUSE';

export type BranchRecord = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: BranchType;
  isVatEstablishment: boolean;
  taxBranchCode?: string | null;
  addressJson?: Record<string, unknown>;
  phone?: string;
  email?: string;
  status: BranchStatus;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateBranchRecord = {
  companyId: string;
  code: string;
  name: string;
  type: BranchType;
  taxBranchCode?: string | null;
  addressJson?: Record<string, unknown>;
  phone?: string;
  email?: string;
  createdByUserId?: string;
};

export type UpdateBranchRecord = {
  id: string;
  companyId: string;
  name?: string;
  taxBranchCode?: string | null;
  addressJson?: Record<string, unknown>;
  phone?: string;
  email?: string;
  status?: BranchStatus;
  updatedByUserId?: string;
};

export type FindBranchByIdInput = { id: string; companyId: string };

export type ListBranchesInput = {
  companyId: string;
  status?: BranchStatus;
  type?: BranchType;
  page?: number;
  pageSize?: number;
};

export type PaginatedBranches = {
  items: BranchRecord[];
  total: number;
  page: number;
  pageSize: number;
};
