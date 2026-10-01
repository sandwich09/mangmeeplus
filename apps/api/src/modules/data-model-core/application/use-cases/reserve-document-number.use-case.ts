import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaDocumentSequenceRepository } from '../../infrastructure/repositories/prisma-document-sequence.repository';
import type { ReservedDocumentNumberRecord, ReserveDocumentNumberInput } from '../../domain/models/document-sequence.model';
import { AuditService } from '../../../audit/application/audit.service';
import { auditActorOf } from '../../../audit/domain/logic/audit-actor.logic';

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
      // Same rule as commit/void/cancel. `reservedByUserId` is a plain column, so a worker reserves
      // under its own id; only a real user id may enter the User FK.
      ...auditActorOf(input.reservedByUserId, 'document-number'),
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
