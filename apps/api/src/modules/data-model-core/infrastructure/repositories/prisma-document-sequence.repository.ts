import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import type { DocumentSequenceRepositoryPort, ListDocumentSequencesInput, PaginatedDocumentSequences } from '../../domain/ports/document-sequence-repository.port';
import type {
  DocumentSequenceRecord,
  ReservedDocumentNumberRecord,
  UpsertDocumentSequenceInput,
  ReserveDocumentNumberInput,
  CommitDocumentNumberInput,
  CancelDocumentNumberInput,
  VoidDocumentNumberInput,
} from '../../domain/models/document-sequence.model';
import {
  formatDocumentNumber,
  getDefaultDocumentSequenceConfig,
  templateNumbersAreBranchDistinct,
} from '../../domain/logic/document-sequence.logic';

@Injectable()
export class PrismaDocumentSequenceRepository implements DocumentSequenceRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsertConfig(input: UpsertDocumentSequenceInput): Promise<DocumentSequenceRecord> {
    const branchScopeKey = input.branchId ?? 'GLOBAL';
    const row = await this.prisma.client.documentSequence.upsert({
      where: {
        companyId_branchScopeKey_documentType_periodKey: {
          companyId: input.companyId,
          branchScopeKey,
          documentType: input.documentType,
          periodKey: input.periodKey,
        },
      },
      create: {
        companyId: input.companyId,
        branchId: input.branchId,
        branchScopeKey,
        documentType: input.documentType,
        periodKey: input.periodKey,
        prefixTemplate: input.prefixTemplate,
        padding: input.padding ?? 5,
        resetPolicy: (input.resetPolicy ?? 'NONE') as any,
        createdByUserId: input.updatedByUserId,
        updatedByUserId: input.updatedByUserId,
      },
      update: {
        prefixTemplate: input.prefixTemplate,
        padding: input.padding ?? undefined,
        resetPolicy: input.resetPolicy as any ?? undefined,
        updatedByUserId: input.updatedByUserId,
      },
    });
    return this.toSeqRecord(row);
  }

  async list(input: ListDocumentSequencesInput): Promise<PaginatedDocumentSequences> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const where = {
      companyId: input.companyId,
      ...(input.documentType ? { documentType: input.documentType } : {}),
      ...(input.branchId ? { branchId: input.branchId } : {}),
    };
    const [rows, total] = await this.prisma.client.$transaction([
      this.prisma.client.documentSequence.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.client.documentSequence.count({ where }),
    ]);
    return { items: rows.map((r) => this.toSeqRecord(r)), total, page, pageSize };
  }

  async reserveNumber(input: ReserveDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    return this.prisma.client.$transaction((tx) => this.reserveNumberInTransaction(tx, input));
  }

  /** Reuses the canonical sequence allocator inside a caller-owned transaction. */
  async reserveNumberInTransaction(
    tx: Prisma.TransactionClient,
    input: ReserveDocumentNumberInput,
  ): Promise<ReservedDocumentNumberRecord> {
    // Idempotency check
    const existing = await tx.documentNumber.findFirst({
      where: { companyId: input.companyId, documentType: input.documentType, idempotencyKey: input.idempotencyKey },
      include: { sequence: true },
    });
    if (existing) {
      if ((existing.branchId ?? undefined) !== (input.branchId ?? undefined) || existing.sequence.periodKey !== input.periodKey) {
        throw new ConflictException('Idempotency key already used with different document sequence parameters.');
      }
      return this.toNumRecord(existing);
    }

    // The template has to be resolved before the scope key, because it decides whether the counter
    // may be split per branch at all (CR-7). A branch-blind template gets one company-wide counter;
    // only a template carrying {BRANCH} renders numbers two branches cannot collide on.
    const stored = await tx.documentSequence.findFirst({
      where: { companyId: input.companyId, documentType: input.documentType },
      orderBy: [{ periodKey: 'desc' }, { createdAt: 'desc' }],
    });
    if (stored?.status === 'DISABLED') {
      throw new UnprocessableEntityException('Document sequence is disabled or missing.');
    }
    const template = stored?.prefixTemplate ?? getDefaultDocumentSequenceConfig(input.documentType)?.prefixTemplate;
    const branchDistinct = Boolean(template && templateNumbersAreBranchDistinct(template));
    const branchScopeKey = branchDistinct ? input.branchId ?? 'GLOBAL' : 'GLOBAL';

    let sequence = await tx.documentSequence.findFirst({
      where: {
        companyId: input.companyId,
        branchScopeKey,
        documentType: input.documentType,
        periodKey: input.periodKey,
      },
    });
    if (!sequence) {
      const previous = await tx.documentSequence.findFirst({
        where: {
          companyId: input.companyId,
          branchScopeKey,
          documentType: input.documentType,
        },
        orderBy: { periodKey: 'desc' },
      });
      if (previous?.status === 'DISABLED') {
        throw new UnprocessableEntityException('Document sequence is disabled or missing.');
      }
      // `stored` before the code default: a company that customized its template under a branch
      // scope must keep that template when its counter becomes company-wide, not silently revert.
      const config = previous ?? stored ?? getDefaultDocumentSequenceConfig(input.documentType);
      if (!config) {
        throw new UnprocessableEntityException('Document sequence is disabled or missing.');
      }
      // A company already numbering under a branch scope must not restart at 1 when its counter
      // becomes company-wide — it would re-issue numbers it has already given out and wedge itself
      // in exactly the way CR-7 describes. Only one scope can ever have issued within a period (the
      // second one's first insert always failed and rolled back), so the highest counter in the
      // period is that scope's, and continuing from it is unambiguous.
      //
      // Only for the merge. When the template names the branch, the scopes render different strings
      // and each one is entitled to its own series starting at 1 — carrying a number over there
      // would inflate a counter for no reason.
      const issuedElsewhereThisPeriod = branchDistinct ? null : await tx.documentSequence.findFirst({
        where: {
          companyId: input.companyId,
          documentType: input.documentType,
          periodKey: input.periodKey,
          NOT: { branchScopeKey },
        },
        orderBy: { nextNumber: 'desc' },
      });
      sequence = await tx.documentSequence.upsert({
        where: {
          companyId_branchScopeKey_documentType_periodKey: {
            companyId: input.companyId,
            branchScopeKey,
            documentType: input.documentType,
            periodKey: input.periodKey,
          },
        },
        update: {},
        create: {
          companyId: input.companyId,
          branchId: input.branchId,
          branchScopeKey,
          documentType: input.documentType,
          periodKey: input.periodKey,
          prefixTemplate: config.prefixTemplate,
          nextNumber: Math.max(1, issuedElsewhereThisPeriod?.nextNumber ?? 1),
          padding: config.padding,
          resetPolicy: config.resetPolicy,
          status: 'ACTIVE',
          createdByUserId: input.reservedByUserId,
          updatedByUserId: input.reservedByUserId,
        },
      });
    }
    if (sequence.status !== 'ACTIVE') {
      throw new UnprocessableEntityException('Document sequence is disabled or missing.');
    }

    const date = this.documentDateParts(input.periodKey);
    const updatedSequence = await tx.documentSequence.update({
      where: { id: sequence.id },
      data: { nextNumber: { increment: 1 } },
    });
    const sequenceNumber = updatedSequence.nextNumber - 1;
    const branch = input.branchId
      ? await tx.branch.findFirst({ where: { id: input.branchId, companyId: input.companyId }, select: { code: true } })
      : null;
    const documentNumber = formatDocumentNumber(sequence.prefixTemplate, {
      year: date.year,
      month: date.month,
      branchCode: branch?.code,
      documentType: input.documentType,
      sequenceNumber,
      padding: sequence.padding,
    });

    const numRow = await tx.documentNumber.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        sequenceId: sequence.id,
        documentType: input.documentType,
        documentNumber,
        status: 'RESERVED',
        idempotencyKey: input.idempotencyKey,
        reservedByUserId: input.reservedByUserId,
        reservedAt: new Date(),
      },
    });
    return this.toNumRecord(numRow);
  }

  async commitNumber(input: CommitDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    return this.prisma.client.$transaction((tx) => this.commitNumberInTransaction(tx, input));
  }

  /** Commits a reservation inside the aggregate transaction that owns it. */
  async commitNumberInTransaction(
    tx: Prisma.TransactionClient,
    input: CommitDocumentNumberInput,
  ): Promise<ReservedDocumentNumberRecord> {
    const existing = await tx.documentNumber.findFirst({
      where: { id: input.id, companyId: input.companyId },
    });
    if (!existing) throw new NotFoundException('Document number not found.');
    if (existing.status !== 'RESERVED') {
      throw new ConflictException('Only RESERVED document numbers can be committed.');
    }

    const row = await tx.documentNumber.update({
      where: { id: existing.id },
      data: {
        status: 'COMMITTED',
        committedAt: new Date(),
        ownerType: input.ownerType,
        ownerId: input.ownerId,
      },
    });
    return this.toNumRecord(row);
  }

  async cancelReservation(input: CancelDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    const existing = await this.prisma.client.documentNumber.findFirst({
      where: { id: input.id, companyId: input.companyId },
    });
    if (!existing) throw new NotFoundException('Document number not found.');
    if (existing.status !== 'RESERVED') {
      throw new ConflictException('Only RESERVED document numbers can be cancelled.');
    }

    const row = await this.prisma.client.documentNumber.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return this.toNumRecord(row);
  }

  async voidNumber(input: VoidDocumentNumberInput): Promise<ReservedDocumentNumberRecord> {
    const existing = await this.prisma.client.documentNumber.findFirst({
      where: { id: input.id, companyId: input.companyId },
    });
    if (!existing) throw new NotFoundException('Document number not found.');
    if (existing.status !== 'COMMITTED') {
      throw new ConflictException('Only COMMITTED document numbers can be voided.');
    }

    const row = await this.prisma.client.documentNumber.update({
      where: { id: existing.id },
      data: { status: 'VOIDED', voidedAt: new Date() },
    });
    return this.toNumRecord(row);
  }

  private documentDateParts(periodKey: string): { year: number; month: number } {
    const monthly = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey);
    if (monthly) return { year: Number(monthly[1]), month: Number(monthly[2]) };
    const yearly = /^(\d{4})$/.exec(periodKey);
    if (yearly) return { year: Number(yearly[1]), month: 1 };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  private toSeqRecord(row: any): DocumentSequenceRecord {
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined,
      branchScopeKey: row.branchScopeKey, documentType: row.documentType,
      periodKey: row.periodKey, prefixTemplate: row.prefixTemplate,
      nextNumber: row.nextNumber, padding: row.padding, resetPolicy: row.resetPolicy,
      status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  private toNumRecord(row: any): ReservedDocumentNumberRecord {
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? undefined,
      sequenceId: row.sequenceId, documentType: row.documentType,
      documentNumber: row.documentNumber, status: row.status,
      ownerType: row.ownerType ?? undefined, ownerId: row.ownerId ?? undefined,
      idempotencyKey: row.idempotencyKey, reservedByUserId: row.reservedByUserId,
      reservedAt: row.reservedAt, committedAt: row.committedAt ?? undefined,
      cancelledAt: row.cancelledAt ?? undefined, voidedAt: row.voidedAt ?? undefined,
    };
  }
}
