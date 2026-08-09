import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import { templateNumbersAreBranchDistinct, validatePrefixTemplate } from '../../domain/logic/document-sequence.logic';
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
    // The config-time half of CR-7: a per-branch counter whose numbers cannot name the branch
    // renders the same string as every other branch, and the company-wide unique on DocumentNumber
    // rejects all but the first — permanently. Refuse the configuration instead of accepting one
    // that silently becomes company-wide at reservation time.
    if (cmd.branchId && !templateNumbersAreBranchDistinct(cmd.prefixTemplate)) {
      throw new BadRequestException(
        'A branch-specific sequence must include {BRANCH} in its prefix template, otherwise two branches would render the same document number.',
      );
    }

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
