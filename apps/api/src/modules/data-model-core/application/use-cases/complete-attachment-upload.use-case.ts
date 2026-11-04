import { isBranchInScope } from '../../domain/logic/branch.logic';
import { Inject, Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { LOGGER_TOKEN, type AppLogger } from '../../../../common/logger/logger.service';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../domain/ports/attachment-storage.port';
import { generateImmutableObjectKey, inspectAttachmentBytes, attachmentInspectionFailureCode, type AttachmentInspectionPolicy } from '../../domain/logic/attachment.logic';
import type { AttachmentRecord } from '../../domain/models/attachment.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { AttachmentMalwareScanner } from '../../infrastructure/attachment-malware-scanner';
import { ObjectVersionCleanupService } from '../services/object-version-cleanup.service';

export type CompleteAttachmentUploadCommand = {
  attachmentId: string;
  checksumSha256?: string;
  byteSize?: number;
};

const PHASH_IMAGE_SIZE = 32;
const PHASH_SIZE = 8;
const PHASH_MAX_INPUT_PIXELS = 40_000_000;
const PHASH_COSINES = Array.from({ length: PHASH_SIZE }, (_, frequency) =>
  Array.from({ length: PHASH_IMAGE_SIZE }, (_, position) =>
    Math.cos(((2 * position + 1) * frequency * Math.PI) / (2 * PHASH_IMAGE_SIZE))));

/** Stable pixel fingerprint for JPEG/PNG re-encoding. Failure is advisory and never blocks upload. */
export async function computeImagePerceptualHash(bytes: Buffer, mimeType: string): Promise<string | undefined> {
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return undefined;
  try {
    const pixels = await sharp(bytes, { limitInputPixels: PHASH_MAX_INPUT_PIXELS })
      .rotate()
      .flatten({ background: '#ffffff' })
      .greyscale()
      .resize(PHASH_IMAGE_SIZE, PHASH_IMAGE_SIZE, { fit: 'fill' })
      .raw()
      .toBuffer();
    const coefficients: number[] = [];
    for (let v = 0; v < PHASH_SIZE; v += 1) {
      for (let u = 0; u < PHASH_SIZE; u += 1) {
        let sum = 0;
        for (let y = 0; y < PHASH_IMAGE_SIZE; y += 1) {
          for (let x = 0; x < PHASH_IMAGE_SIZE; x += 1) {
            sum += pixels[(y * PHASH_IMAGE_SIZE) + x]!
              * PHASH_COSINES[u]![x]!
              * PHASH_COSINES[v]![y]!;
          }
        }
        coefficients.push(sum * (u === 0 ? Math.SQRT1_2 : 1) * (v === 0 ? Math.SQRT1_2 : 1));
      }
    }
    const ac = coefficients.slice(1).sort((a, b) => a - b);
    const median = ac[Math.floor(ac.length / 2)]!;
    let hash = 0n;
    for (const coefficient of coefficients) {
      hash = (hash << 1n) | (coefficient >= median ? 1n : 0n);
    }
    return hash.toString(16).padStart(16, '0');
  } catch {
    // ponytail: duplicate detection is advisory; malformed/oversized images already passed
    // the security boundary above, so a fingerprint failure must not lose a valid upload.
    return undefined;
  }
}

@Injectable()
export class CompleteAttachmentUploadUseCase {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly malwareScanner: AttachmentMalwareScanner,
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
    private readonly objectVersionCleanup: ObjectVersionCleanupService,
  ) {}

  async execute(ctx: RequestContext, cmd: CompleteAttachmentUploadCommand, options?: { inspectionPolicy: AttachmentInspectionPolicy }): Promise<AttachmentRecord> {
    if (!ctx.permissions.includes('attachment.create')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.upload.complete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    const existing = await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId });
    if (!existing) throw new NotFoundException('Attachment not found.');
    if (existing.uploadedByUserId !== ctx.userId || !isBranchInScope(ctx.scopes ?? {}, existing.branchId)) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.upload.complete', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }
    if (existing.status !== 'PENDING_UPLOAD') {
      throw new BadRequestException('Attachment is not in PENDING_UPLOAD state.');
    }

    const metadata = await this.storage.getObjectMetadata({
      bucket: existing.bucket,
      objectKey: existing.objectKey,
    });
    if (!metadata.exists) {
      throw new BadRequestException('Uploaded object was not found in storage.');
    }
    if (metadata.byteSize !== existing.byteSize) {
      await this.rejectUpload(ctx, existing.id, 'Uploaded object size does not match attachment metadata.');
    }
    if (metadata.mimeType && metadata.mimeType !== existing.mimeType) {
      await this.rejectUpload(ctx, existing.id, 'Uploaded object MIME type does not match attachment metadata.');
    }

    const uploaded = await this.storage.getObject({
      bucket: existing.bucket,
      objectKey: existing.objectKey,
      objectVersionId: metadata.objectVersionId,
    });
    if (uploaded.bytes.byteLength !== existing.byteSize) {
      await this.rejectUpload(ctx, existing.id, 'Uploaded bytes do not match attachment metadata.');
    }
    if (uploaded.mimeType && uploaded.mimeType !== existing.mimeType) {
      await this.rejectUpload(ctx, existing.id, 'Uploaded bytes have an unexpected MIME type.');
    }
    const contentError = inspectAttachmentBytes(existing.mimeType, uploaded.bytes, options?.inspectionPolicy);
    if (contentError) await this.rejectUpload(ctx, existing.id, contentError, attachmentInspectionFailureCode(contentError));
    try {
      await this.malwareScanner.assertClean(uploaded.bytes);
    } catch (error) {
      await this.rejectUpload(ctx, existing.id, 'Malware scan rejected the attachment.',
        (error as Error).message === 'MALWARE_DETECTED' ? 'CONTENT_REJECTED' : 'CONTENT_UNINSPECTABLE');
    }

    const checksumSha256 = createHash('sha256').update(uploaded.bytes).digest('hex');
    const perceptualHash = await computeImagePerceptualHash(uploaded.bytes, existing.mimeType);
    if (metadata.checksumSha256 && metadata.checksumSha256 !== checksumSha256) {
      await this.rejectUpload(ctx, existing.id, 'Storage checksum does not match uploaded bytes.');
    }

    const stored = await this.storage.putObject({
      objectKey: generateImmutableObjectKey(ctx.companyId, checksumSha256, existing.originalFileName),
      mimeType: existing.mimeType,
      bytes: uploaded.bytes,
    });
    if (stored.byteSize !== existing.byteSize || stored.checksumSha256 !== checksumSha256) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'ATTACHMENT_FINALIZATION',
      });
      await this.rejectUpload(ctx, existing.id, 'Final storage object does not match verified upload bytes.');
    }

    let record: AttachmentRecord;
    try {
      record = await this.attachments.markActive({
        id: cmd.attachmentId,
        companyId: ctx.companyId,
        objectKey: stored.objectKey,
        objectVersionId: stored.objectVersionId,
        checksumSha256,
        ...(perceptualHash ? { perceptualHash } : {}),
        byteSize: stored.byteSize,
      });
    } catch (error) {
      await this.objectVersionCleanup.enqueue({
        companyId: ctx.companyId,
        bucket: stored.bucket,
        objectPath: stored.objectKey,
        expectedVersion: stored.objectVersionId,
        source: 'ATTACHMENT_FINALIZATION',
      });
      throw error;
    }

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'attachment.upload.complete', targetType: 'attachment', targetId: record.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return record;
  }

  private async rejectUpload(ctx: RequestContext, id: string, message: string, code?: 'CONTENT_UNINSPECTABLE' | 'EMBEDDED_FILE_REJECTED' | 'CONTENT_REJECTED'): Promise<never> {
    const riskLevel = code === 'CONTENT_UNINSPECTABLE' || code === 'EMBEDDED_FILE_REJECTED' ? 'MEDIUM' : 'HIGH';
    await this.attachments.markQuarantined({ id, companyId: ctx.companyId });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'attachment.upload.rejected',
      targetType: 'attachment',
      targetId: id,
      requestId: ctx.requestId,
      result: 'FAILED',
      riskLevel,
      metadataJson: { reason: message, ...(code ? { code } : {}) },
    });
    if (riskLevel === 'HIGH') emitSecurityEvent(this.logger, SECURITY_EVENT.attachmentUploadRejected, 'HIGH', {
      companyId: ctx.companyId,
      attachmentId: id,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
    });
    throw new BadRequestException(code && code !== 'CONTENT_REJECTED' ? { code, message } : message);
  }
}
