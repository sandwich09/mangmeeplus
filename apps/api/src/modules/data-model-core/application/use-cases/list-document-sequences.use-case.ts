import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import type { PaginatedDocumentSequences } from '../../domain/ports/document-sequence-repository.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';

export type ListDocumentSequencesQuery = {
  documentType?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class ListDocumentSequencesUseCase {
  constructor(private readonly repo: PrismaDocumentSequenceRepository) {}

  async execute(ctx: RequestContext, query: ListDocumentSequencesQuery): Promise<PaginatedDocumentSequences> {
    if (!ctx.permissions.includes('document.sequence.read')) throw new ForbiddenException();
    return this.repo.list({ ...query, companyId: ctx.companyId });
  }
}
