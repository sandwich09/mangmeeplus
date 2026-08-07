import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import { validatePrefixTemplate } from '../../domain/logic/document-sequence.logic';
import type { DocumentSequenceRecord, DocumentResetPolicy } from '../../domain/models/document-sequence.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';

export type UpsertDocumentSequenceCommand = {
  documentType: string;
  branchId?: string;
  periodKey: string;
  prefixTemplate: string;
  padding?: number;
  resetPolicy?: DocumentResetPolicy;
};

@Injectable()
export class UpsertDocumentSequenceUseCase {
  constructor(
    private readonly repo: PrismaDocumentSequenceRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: UpsertDocumentSequenceCommand): Promise<DocumentSequenceRecord> {
    if (!ctx.permissions.includes('document.sequence.manage')) throw new ForbiddenException();

    const err = validatePrefixTemplate(cmd.prefixTemplate);
    if (err) throw new BadRequestException(err);

    const record = await this.repo.upsertConfig({
      companyId: ctx.companyId,
      branchId: cmd.branchId,
      documentType: cmd.documentType,
      periodKey: cmd.periodKey,
      prefixTemplate: cmd.prefixTemplate,
      padding: cmd.padding,
      resetPolicy: cmd.resetPolicy,
      updatedByUserId: ctx.userId,
    });

    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'document.sequence.update',
      targetType: 'document_sequence',
      targetId: record.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
    });

    return record;
  }
}
