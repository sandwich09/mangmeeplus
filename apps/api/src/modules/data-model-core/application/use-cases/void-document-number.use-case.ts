import { Injectable } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import type { ReservedDocumentNumberRecord, VoidDocumentNumberInput } from '../../domain/models/document-sequence.model';
import { AuditService } from '../../../audit/application/audit.service';

@Injectable()
export class VoidDocumentNumberUseCase {
  constructor(
    private readonly repo: PrismaDocumentSequenceRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(input: VoidDocumentNumberInput, actorUserId?: string): Promise<ReservedDocumentNumberRecord> {
    const record = await this.repo.voidNumber(input);

    void this.audit.log({
      companyId: input.companyId,
      // A real user id goes into the User FK (actorType defaults USER); with no
      // user this is a system job — record it as SYSTEM so 'system' never hits
      // the actorUserId FK (which would fail the constraint).
      ...(actorUserId
        ? { actorUserId }
        : { actorType: 'SYSTEM' as const, actorRefId: 'document-number' }),
      action: 'document.number.void',
      targetType: 'document_number',
      targetId: record.id,
      requestId: '',
      result: 'SUCCESS',
      riskLevel: 'LOW',
    });

    return record;
  }
}
