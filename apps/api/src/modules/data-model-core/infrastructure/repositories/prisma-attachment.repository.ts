import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
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
import { findAttachmentLinkConflict, isAllowedAttachmentTarget, isDisbursementVoucherFile } from '../../domain/logic/attachment.logic';
import { disbursementVoucherError } from '@watchdog-bms/contracts';
import { lockFundingEvidence, assertFundingMutation } from '../../../expenses/infrastructure/substitute-funding.guard';
import {
  REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
  REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
  REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG,
} from '../../../reimbursements/domain/reimbursement.constants';

/**
 * `isReimbursementPaymentSlipFile` as a query: the files that are not a reimbursement payment slip, neither
 * linked to a payment nor uploaded to become one. For a list that offers a person files to attach as something
 * else; attaching a slip anywhere else is refused, so it must not be offered.
 *
 * The tag half says "no such tag, or another tag" on purpose. A plain NOT over a JSON path is NULL, not true,
 * for a file with no metadata or with metadata that has no `generatedFor`, which is every ordinary upload: the
 * list would lose its receipts and keep nothing but files tagged for something else.
 */
export const NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE = {
  AND: [
    { links: { none: { targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE, purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE } } },
    { OR: [
      { metadataJson: { path: ['generatedFor'], equals: Prisma.DbNull } },
      { metadataJson: { path: ['generatedFor'], not: REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG } },
    ] },
  ],
} satisfies Prisma.AttachmentObjectWhereInput;

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async isDisbursementVoucherFile(input: FindAttachmentInput, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = tx ?? this.prisma.client;
    if (await db.disbursementVoucher.findFirst({ where: { companyId: input.companyId, OR: [{ pdfAttachmentId: input.id }, { slipAttachmentId: input.id },
      ...(['preparer', 'approver', 'payer'] as const).flatMap(role => [
        { [`${role}SignatureJson`]: { path: ['attachmentId'], equals: input.id } },
        { paidSnapshotJson: { path: ['actors', role, 'signature', 'attachmentId'], equals: input.id } },
      ]),
      { revisions: { some: { snapshotJson: { path: ['actors', 'preparer', 'signature', 'attachmentId'], equals: input.id } } } },
    ] }, select: { id: true } })) return true;
    return isDisbursementVoucherFile(db, { companyId: input.companyId, attachmentId: input.id });
  }
  get commercialAccessDb() { return this.prisma.client; }

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

  /**
   * Whether these bytes are the slip of a reimbursement payment. A slip is payment evidence with a
   * viewer rule of its own (owner decision 2026-10-01): the generic download never serves it and the
   * generic delete never removes it. Narrow on purpose: the slip link and nothing else.
   */
  async isReimbursementPaymentSlip(input: FindAttachmentInput, tx?: Prisma.TransactionClient): Promise<boolean> {
    const link = await ((tx ?? this.prisma.client) as any).attachmentLink.findFirst({
      where: {
        companyId: input.companyId,
        attachmentId: input.id,
        targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
        purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
      },
      select: { id: true },
    });
    return Boolean(link);
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
      if (typeof input.metadataJson?.freeExpenseUploadMonth === 'string') {
        const pendingFree = await tx.attachmentObject.count({ where: { companyId: input.companyId,
          status: { in: ['PENDING_UPLOAD', 'ACTIVE'] }, createdAt: { gte: input.pendingCreatedAfter },
          metadataJson: { path: ['freeExpenseUploadMonth'], equals: input.metadataJson.freeExpenseUploadMonth } } });
        if (pendingFree >= 3) throw new ConflictException({ code: 'FREE_DOCUMENTS_IN_FLIGHT', message: 'กรุณาใช้ไฟล์ที่ส่งไว้หรือลองอ่านไฟล์เดิมอีกครั้งค่ะ' });
      }
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
      // Frozen package files are retained from download onward, including old unfiled versions.
      // Linking the newly created attachment and package is atomic, so no public delete can race it.
      if (await db.taxFilingPackage.findFirst({ where: { companyId: input.companyId, attachmentId: input.id, whtFilingId: { not: null } }, select: { id: true } })) {
        throw new ConflictException({ code: 'WHT_FILING_FILE_RETAINED', message: 'ไฟล์นี้เป็นแบบภาษีที่เก็บไว้ ลบไม่ได้ เปิดหน้าภาษีหัก ณ ที่จ่ายเพื่อดาวน์โหลด' });
      }
      const evidence = { attachmentIds: [input.id], expenseIds: [] as string[] };
      await lockFundingEvidence(db, input.companyId, evidence);
      const claim = await db.reimbursementLine.findFirst({ where: { companyId: input.companyId, request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } },
        OR: [{ attachmentId: { in: evidence.attachmentIds } }, { linkedExpenseId: { in: evidence.expenseIds } }] }, select: { id: true } });
      if (claim) throw new ConflictException({ code: 'substitute_source_has_live_claim', message: 'Receipt is retained by a submitted reimbursement.' });
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${input.id}:attachment-retention`}))`;
      if (await this.isDisbursementVoucherFile(input, db)) throw new ConflictException(disbursementVoucherError('disbursement_file_retained'));
      // Under the lock the slip link is written with, so a link racing this delete is seen here.
      if (await this.isReimbursementPaymentSlip(input, db)) {
        throw new ConflictException({
          code: 'reimbursement_payment_slip_retained',
          message: 'Attachment is retained as reimbursement payment evidence.',
        });
      }
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

  async linkToTarget(input: LinkAttachmentInput, transaction?: Prisma.TransactionClient): Promise<AttachmentLinkRecord> {
    const link = async (tx: Prisma.TransactionClient) => {
      if (input.targetType === 'expense.record') {
        await lockFundingEvidence(tx, input.companyId, { attachmentIds: [input.attachmentId], expenseIds: [input.targetId] });
      }
      const attachment = await tx.attachmentObject.findFirst({
        where: { id: input.attachmentId, companyId: input.companyId, status: 'ACTIVE' },
        select: { id: true, branchId: true },
      });
      if (!attachment) throw new BadRequestException('Attachment must be ACTIVE in the current company.');

      if (!isAllowedAttachmentTarget(input.targetType, input.purpose)) {
        throw new BadRequestException('Unsupported attachment target or purpose.');
      }
      const conflict = await findAttachmentLinkConflict(tx, input);
      if (conflict) throw new BadRequestException(conflict);
      const targetWhere = {
        id: input.targetId,
        companyId: input.companyId,
        ...(input.targetOwnerUserId ? { createdByUserId: input.targetOwnerUserId } : {}),
        ...(input.branchIds ? { OR: [{ branchId: { in: input.branchIds } }, { branchId: null }] } : {}),
      };
      const target = input.targetType === 'expense.record'
        ? await tx.expenseRecord.findFirst({ where: targetWhere, select: { id: true, branchId: true } })
        : await tx.accountingDocument.findFirst({ where: targetWhere, select: { id: true, branchId: true } });
      if (!target) throw new NotFoundException('Attachment target not found.');
      if (input.targetType === 'accounting.document' && attachment.branchId !== target.branchId) {
        throw new BadRequestException('Attachment and accounting document must belong to the same branch.');
      }
      if (input.targetType === 'expense.record') {
        if (attachment.branchId !== target.branchId) throw new BadRequestException('Attachment and expense must belong to the same branch.');
        await assertFundingMutation(tx, input.companyId, input.targetId, 'supersede');
      }

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
    };
    const row = transaction ? await link(transaction) : await this.prisma.client.$transaction(link);
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

  async findById(input: FindAttachmentInput, tx?: Prisma.TransactionClient): Promise<AttachmentRecord | null> {
    const row = await (tx ?? this.prisma.client).attachmentObject.findFirst({
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
