import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { Prisma } from '../../../../generated/prisma/client';
import type { AttachmentRepositoryPort } from '../../domain/ports/attachment-repository.port';
import type {
  AttachmentRecord,
  AttachmentLinkRecord,
  CreatePendingAttachmentInput,
  MarkAttachmentActiveInput,
  MarkAttachmentDeletedInput,
  LinkAttachmentInput,
  FindAttachmentInput,
} from '../../domain/models/attachment.model';
import { isAllowedAttachmentTarget } from '../../domain/logic/attachment.logic';

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async isSubstituteRawSignature(input: FindAttachmentInput): Promise<boolean> {
    const row = await (this.prisma.client as any).expenseSubstituteReceiptEvidence.findFirst({
      where: {
        companyId: input.companyId,
        OR: [{ payerSignatureAttachmentId: input.id }, { approverSignatureAttachmentId: input.id }],
      },
      select: { id: true },
    });
    return Boolean(row);
  }

  /**
   * Whose personal signature these bytes are — `null` when the attachment is not a signature at all.
   *
   * The sibling above only sees images a certificate already RECORDED, so a library asset that has
   * not signed anything yet sails past it. Every signature image carries exactly one AttachmentLink
   * with `targetType = 'company.signature_asset'` (written for the original at creation and for the
   * background-removed render), which is what makes the whole library visible to one lookup.
   *
   * `ownerUserId: null` means the link outlived its asset row: unresolvable ownership, which the
   * caller must treat as "not yours" rather than "not a signature".
   *
   * The normal case is one link, but the schema allows the same bytes to be linked to more than one
   * asset. Ordered by creation so the ORIGINAL owner is authoritative: a later link cannot hand
   * someone else's signature image to whoever added it, so the D14 gate denies anyone but the first
   * (real) owner. `findFirst` without an order would pick arbitrarily and could return the later one.
   */
  async findSignatureAssetOwner(input: FindAttachmentInput): Promise<{ ownerUserId: string | null } | null> {
    const link = await (this.prisma.client as any).attachmentLink.findFirst({
      where: { companyId: input.companyId, attachmentId: input.id, targetType: 'company.signature_asset' },
      select: { targetId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!link) return null;
    const asset = await (this.prisma.client as any).companySignatureAsset.findFirst({
      where: { id: link.targetId, companyId: input.companyId },
      select: { submittedByUserId: true },
    });
    return { ownerUserId: asset?.submittedByUserId ?? null };
  }

  async findSubstituteEvidenceRetentionHold(
    input: FindAttachmentInput,
    tx?: Prisma.TransactionClient,
  ): Promise<'SUBSTITUTE_ARTIFACT' | 'SUBSTITUTE_SOURCE' | null> {
    const client = (tx ?? this.prisma.client) as any;
    const retainedStatuses = ['PAYER_CERTIFIED', 'ISSUED', 'SUPERSEDED'];
    // R11: on the paper route the signatures exist ONLY on this scan, from the moment it is linked
    // to a still-PREPARED evidence. Deleting it there is not "before anything was signed" — it is
    // erasing the only copy of the ink and stranding a document that can no longer be certified.
    const wetSignedScan = await client.expenseSubstituteReceiptEvidence.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: ['PREPARED', ...retainedStatuses] },
        wetSignedScanAttachmentId: input.id,
      },
      select: { id: true },
    });
    if (wetSignedScan) return 'SUBSTITUTE_ARTIFACT';

    const directEvidence = await client.expenseSubstituteReceiptEvidence.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: retainedStatuses },
        OR: [
          { certifiedArtifactAttachmentId: input.id },
          { artifactAttachmentId: input.id },
          { payerSignatureAttachmentId: input.id },
          { approverSignatureAttachmentId: input.id },
        ],
      },
      select: { id: true },
    });
    if (directEvidence) return 'SUBSTITUTE_ARTIFACT';

    const snapshotEvidence = await client.expenseSubstituteReceiptEvidence.findFirst({
      where: {
        companyId: input.companyId,
        status: { in: retainedStatuses },
        OR: [
          { paymentEvidenceAttachmentIds: { array_contains: [input.id] } },
          { supportingAttachmentIds: { array_contains: [input.id] } },
        ],
      },
      select: { id: true },
    });
    if (snapshotEvidence) return 'SUBSTITUTE_SOURCE';

    const links = await client.attachmentLink.findMany({
      where: {
        companyId: input.companyId,
        attachmentId: input.id,
        targetType: 'expense.record',
      },
      select: { targetId: true },
    });
    const linkedExpenseIds = [...new Set<string>(links.map((link: { targetId: string }) => link.targetId))];
    const sourceEvidence = await client.expenseRecord.findFirst({
      where: {
        companyId: input.companyId,
        OR: [
          { primaryAttachmentId: input.id },
          ...(linkedExpenseIds.length > 0 ? [{ id: { in: linkedExpenseIds } }] : []),
        ],
        substituteReceiptEvidences: { some: { status: { in: retainedStatuses } } },
      },
      select: { id: true },
    });
    return sourceEvidence ? 'SUBSTITUTE_SOURCE' : null;
  }

  async createPending(input: CreatePendingAttachmentInput): Promise<AttachmentRecord> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:attachment-pending-quota`}))`;
      const pending = await tx.attachmentObject.aggregate({
        where: { companyId: input.companyId, status: { in: ['PENDING_UPLOAD', 'QUARANTINED'] }, createdAt: { gte: input.pendingCreatedAfter } },
        _sum: { byteSize: true },
      });
      if ((pending._sum.byteSize ?? 0) + input.byteSize > input.pendingQuotaBytes) {
        throw new ConflictException('Pending upload quota exceeded.');
      }
      return tx.attachmentObject.create({
        data: {
          companyId: input.companyId,
          branchId: input.branchId,
          storageProvider: input.storageProvider,
          bucket: input.bucket,
          objectKey: input.objectKey,
          originalFileName: input.originalFileName,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          visibility: input.visibility as any,
          status: 'PENDING_UPLOAD',
          uploadedByUserId: input.uploadedByUserId,
          metadataJson: input.metadataJson as any,
        },
      });
    });
    return this.toRecord(row);
  }

  async markActive(input: MarkAttachmentActiveInput): Promise<AttachmentRecord> {
    const changed = await this.prisma.client.attachmentObject.updateMany({
      where: { id: input.id, companyId: input.companyId, status: 'PENDING_UPLOAD' },
      data: {
        status: 'ACTIVE',
        uploadedAt: new Date(),
        objectKey: input.objectKey,
        objectVersionId: input.objectVersionId,
        checksumSha256: input.checksumSha256,
        perceptualHash: input.perceptualHash,
        byteSize: input.byteSize,
      },
    });
    if (changed.count !== 1) throw new ConflictException('Attachment upload was already completed or is no longer pending.');
    const row = await this.prisma.client.attachmentObject.findFirstOrThrow({
      where: { id: input.id, companyId: input.companyId },
    });
    return this.toRecord(row);
  }

  async markQuarantined(input: { id: string; companyId: string }): Promise<void> {
    await this.prisma.client.attachmentObject.updateMany({
      where: { id: input.id, companyId: input.companyId, status: 'PENDING_UPLOAD' },
      data: { status: 'QUARANTINED' },
    });
  }

  async sumPendingBytes(input: { companyId: string; createdAfter: Date }): Promise<number> {
    const result = await this.prisma.client.attachmentObject.aggregate({
      where: { companyId: input.companyId, status: { in: ['PENDING_UPLOAD', 'QUARANTINED'] }, createdAt: { gte: input.createdAfter } },
      _sum: { byteSize: true },
    });
    return result._sum.byteSize ?? 0;
  }

  async markDeleted(input: MarkAttachmentDeletedInput, tx?: Prisma.TransactionClient): Promise<AttachmentRecord> {
    const client = this.prisma.client as any;
    const mark = async (db: Prisma.TransactionClient) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:attachment-retention`}))`;
      const hold = await this.findSubstituteEvidenceRetentionHold(input, db);
      if (hold) {
        throw new ConflictException({
          statusCode: 409,
          code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
          message: 'Attachment is retained by certified substitute-receipt evidence.',
          hold,
        });
      }
      const changed = await db.attachmentObject.updateMany({
        where: { id: input.id, companyId: input.companyId, status: { not: 'DELETED' } },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      if (changed.count !== 1) throw new Error('Attachment was not found or was already deleted.');
      const row = await db.attachmentObject.findFirstOrThrow({ where: { id: input.id, companyId: input.companyId } });
      return this.toRecord(row);
    };
    return tx ? mark(tx) : client.$transaction(mark);
  }

  async linkToTarget(input: LinkAttachmentInput): Promise<AttachmentLinkRecord> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      const attachment = await tx.attachmentObject.findFirst({
        where: { id: input.attachmentId, companyId: input.companyId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!attachment) throw new BadRequestException('Attachment must be ACTIVE in the current company.');

      if (!isAllowedAttachmentTarget(input.targetType, input.purpose)) {
        throw new BadRequestException('Unsupported attachment target or purpose.');
      }
      const target = await tx.expenseRecord.findFirst({
        where: {
          id: input.targetId,
          companyId: input.companyId,
          ...(input.targetOwnerUserId ? { createdByUserId: input.targetOwnerUserId } : {}),
        },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Attachment target not found.');

      return tx.attachmentLink.create({
        data: {
          companyId: input.companyId,
          attachmentId: input.attachmentId,
          targetType: input.targetType,
          targetId: input.targetId,
          purpose: input.purpose,
          linkedByUserId: input.linkedByUserId,
        },
      });
    });
    return {
      id: row.id,
      companyId: row.companyId,
      attachmentId: row.attachmentId,
      targetType: row.targetType,
      targetId: row.targetId,
      purpose: row.purpose,
      linkedByUserId: row.linkedByUserId,
      createdAt: row.createdAt,
    };
  }

  async findById(input: FindAttachmentInput): Promise<AttachmentRecord | null> {
    const row = await this.prisma.client.attachmentObject.findFirst({
      where: { id: input.id, companyId: input.companyId },
    });
    return row ? this.toRecord(row) : null;
  }

  /** Bounded batch read so a multi-line document resolves its file names in one query. */
  async findManyByIds(input: { companyId: string; ids: string[] }): Promise<AttachmentRecord[]> {
    if (input.ids.length === 0) return [];
    const rows = await this.prisma.client.attachmentObject.findMany({
      where: { id: { in: input.ids }, companyId: input.companyId },
      take: 200,
    });
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: any): AttachmentRecord {
    return {
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId ?? undefined,
      storageProvider: row.storageProvider,
      bucket: row.bucket,
      objectKey: row.objectKey,
      objectVersionId: row.objectVersionId ?? undefined,
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      checksumSha256: row.checksumSha256 ?? undefined,
      perceptualHash: row.perceptualHash ?? undefined,
      visibility: row.visibility as any,
      status: row.status as any,
      uploadedByUserId: row.uploadedByUserId,
      uploadedAt: row.uploadedAt ?? undefined,
      deletedAt: row.deletedAt ?? undefined,
      metadataJson: row.metadataJson as Record<string, unknown> | undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
