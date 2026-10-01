import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import type { ReservedDocumentNumberRecord, ReserveDocumentNumberInput } from '../../domain/models/document-sequence.model';
import { AuditService } from '../../../audit/application/audit.service';

@Injectable()
export class ReserveDocumentNumberUseCase {
  constructor(
    private readonly repo: PrismaDocumentSequenceRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(input: ReserveDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    const record = await this.repo.reserveNumber(input);

    void this.audit.log({
      companyId: input.companyId,
      actorUserId: input.reservedByUserId,
      action: 'document.number.reserve',
      targetType: 'document_number',
      targetId: record.id,
      requestId: '',
      result: 'SUCCESS',
      riskLevel: 'LOW',
    });

    return record;
  }

  /**
   * Reserves inside the caller's transaction, so the number commits or rolls back with the document
   * it is for. No audit row here: one written now would describe a reservation that may never commit.
   */
  executeInTransaction(tx: Prisma.TransactionClient, input: ReserveDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    return this.repo.reserveNumberInTransaction(tx, input);
  }
}
