import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaBranchRepository } from '../../infrastructure/repositories/prisma-branch.repository';
import type { PaginatedBranches } from '../../domain/models/branch.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type ListBranchesQuery = {
  status?: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
  type?: 'HEAD_OFFICE' | 'BRANCH' | 'ONLINE' | 'WAREHOUSE';
  page?: number;
  pageSize?: number;
};

@Injectable()
export class ListBranchesUseCase {
  constructor(private readonly branches: PrismaBranchRepository) {}

  async execute(ctx: RequestContext, query: ListBranchesQuery): Promise<PaginatedBranches> {
    if (!ctx.permissions.some(key => key === 'company.branch.read' || key === 'company.branch.manage')) throw new ForbiddenException();
    return this.branches.list({ ...query, companyId: ctx.companyId });
  }
}
