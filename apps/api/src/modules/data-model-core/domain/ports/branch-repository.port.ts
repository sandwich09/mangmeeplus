import type {
  BranchRecord,
  CreateBranchRecord,
  UpdateBranchRecord,
  FindBranchByIdInput,
  ListBranchesInput,
  PaginatedBranches,
} from '../models/branch.model';

export interface BranchRepositoryPort {
  create(input: CreateBranchRecord): Promise<BranchRecord>;
  update(input: UpdateBranchRecord): Promise<BranchRecord>;
  findById(input: FindBranchByIdInput): Promise<BranchRecord | null>;
  list(input: ListBranchesInput): Promise<PaginatedBranches>;
  countActiveHeadOffice(companyId: string): Promise<number>;
  findActiveByTaxBranchCode(companyId: string, taxBranchCode: string, excludeBranchId?: string): Promise<BranchRecord | null>;
}
