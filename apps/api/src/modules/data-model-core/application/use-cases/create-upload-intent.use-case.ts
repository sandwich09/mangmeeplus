import { expenseDraftAccess } from '../../../expenses/application/expense-commercial-access';
import { freeExpenseAttachmentSource, assertFreeExpenseUploadAvailable, type FreeExpenseAttachmentSource } from './free-expense-attachment';
import { Inject, Injectable, ForbiddenException, BadRequestException, NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import {
  generateObjectKey,
  validateAttachmentFileName,
  validateAttachmentMeta,
} from '../../domain/logic/attachment.logic';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../domain/ports/attachment-storage.port';
import type { AttachmentVisibility } from '../../domain/models/attachment.model';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../domain/logic/branch.logic';
import { AppConfigService } from '../../../../common/config/app-config.service';

const PENDING_STORAGE_RETENTION_MS = 24 * 60 * 60 * 1000;

export type CreateUploadIntentCommand = {
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  visibility?: AttachmentVisibility;
  branchId?: string;
  metadataJson?: Record<string, unknown>;
};

export type CreateUploadIntentResult = {
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
  expiresAt: Date;
};

@Injectable()
export class CreateUploadIntentUseCase {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** Internal receipt retry: re-sign the existing pending object, never create another attachment. */
  async resume(ctx: RequestContext, attachmentId: string): Promise<CreateUploadIntentResult & { uploadRequired: boolean }> {
    if (!ctx.permissions.includes('attachment.create')) throw new ForbiddenException();
    const attachment = await this.attachments.findById({ id: attachmentId, companyId: ctx.companyId });
    if (!attachment) throw new NotFoundException('Attachment not found.');
    if (attachment.uploadedByUserId !== ctx.userId || !isBranchInScope(ctx.scopes ?? {}, attachment.branchId)) throw new ForbiddenException();
    if (attachment.status !== 'PENDING_UPLOAD' && attachment.status !== 'ACTIVE') throw new BadRequestException('Attachment cannot be resumed.');
    if (await expenseDraftAccess(ctx, this.attachments.commercialAccessDb)) {
      const source = attachment.metadataJson?.freeExpenseSource as { kind?: string; id?: string } | undefined;
      await freeExpenseAttachmentSource(this.attachments.commercialAccessDb, ctx,
        source?.kind === 'EXPENSE' ? { expenseId: source.id } : source?.kind === 'CAPTURE_GROUP' ? { captureGroupId: source.id } : {}, true);
    }
    if (attachment.status === 'ACTIVE') {
      return { attachmentId, uploadUrl: '', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date(), uploadRequired: false };
    }
    const metadata = await this.storage.getObjectMetadata({ bucket: attachment.bucket, objectKey: attachment.objectKey });
    // Bytes present after a lost upload response still pass completion's full checksum/scanner checks.
    if (metadata.exists) {
      return { attachmentId, uploadUrl: '', uploadMethod: 'PUT', uploadHeaders: {}, expiresAt: new Date(), uploadRequired: false };
    }
    const intent = await this.storage.createUploadIntent({
      companyId: ctx.companyId, objectKey: attachment.objectKey, mimeType: attachment.mimeType,
      byteSize: attachment.byteSize, expiresInSeconds: this.config.signedUrlTtlSeconds,
    });
    return { attachmentId, uploadUrl: intent.uploadUrl, uploadMethod: intent.uploadMethod, uploadHeaders: intent.uploadHeaders, expiresAt: intent.expiresAt, uploadRequired: true };
  }

  async execute(ctx: RequestContext, cmd: CreateUploadIntentCommand, source?: FreeExpenseAttachmentSource): Promise<CreateUploadIntentResult> {
    if (!ctx.permissions.includes('attachment.create')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.upload.intent', targetType: 'attachment', targetId: undefined,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    if (!isBranchInScope(ctx.scopes ?? {}, cmd.branchId)) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.upload.intent', targetType: 'attachment', targetId: undefined,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    let freeMetadata: Record<string, unknown> | undefined;
    const freeExpenseDrafts = await expenseDraftAccess(ctx, this.attachments.commercialAccessDb);
    if (freeExpenseDrafts || source?.freeOcrReservation) {
      const selected: FreeExpenseAttachmentSource = source ?? { expenseId: typeof cmd.metadataJson?.expenseReceiptExpenseId === 'string' ? cmd.metadataJson.expenseReceiptExpenseId : undefined };
      const target = await freeExpenseAttachmentSource(this.attachments.commercialAccessDb, ctx, selected, true);
      if (cmd.branchId && cmd.branchId !== target.branchId) throw new ForbiddenException('Attachment branch does not match its source.');
      cmd = { ...cmd, branchId: target.branchId ?? undefined, visibility: 'INTERNAL' };
      if (selected.freeOcrReservation && (ctx.authProvider !== 'line' || target.kind !== 'EXPENSE' || target.captureSource !== 'LINE_UPLOAD')) throw new ForbiddenException('Invalid admitted LINE receipt source.');
      const uploadMonth = await assertFreeExpenseUploadAvailable({ client: this.attachments.commercialAccessDb } as any, ctx.companyId, selected.freeOcrReservation, target.lineMessageId);
      freeMetadata = { freeExpenseSource: { kind: target.kind, id: target.id }, freeExpenseUploadMonth: uploadMonth,
        ...(target.kind === 'EXPENSE' ? { lineReceiptExpenseId: target.id } : {}) };
    }
    const metaErr = validateAttachmentMeta(cmd.mimeType, cmd.byteSize, this.config.uploadMaxBytes)
      ?? validateAttachmentFileName(cmd.originalFileName, cmd.mimeType);
    if (metaErr) throw new BadRequestException(metaErr);

    const pendingBytes = await this.attachments.sumPendingBytes({
      companyId: ctx.companyId,
      createdAfter: new Date(Date.now() - PENDING_STORAGE_RETENTION_MS),
    });
    if (pendingBytes + cmd.byteSize > this.config.uploadPendingMaxBytesPerCompany) {
      throw new HttpException(
        'Pending upload quota exceeded. Complete or wait for existing upload intents to expire.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const objectKey = generateObjectKey(ctx.companyId, cmd.originalFileName);
    const intent = await this.storage.createUploadIntent({
      companyId: ctx.companyId,
      objectKey,
      mimeType: cmd.mimeType,
      byteSize: cmd.byteSize,
      expiresInSeconds: this.config.signedUrlTtlSeconds,
    });

    const record = await this.attachments.createPending({
      companyId: ctx.companyId,
      branchId: cmd.branchId,
      storageProvider: intent.storageProvider,
      bucket: intent.bucket,
      objectKey: intent.objectKey,
      originalFileName: cmd.originalFileName,
      mimeType: cmd.mimeType,
      byteSize: cmd.byteSize,
      visibility: cmd.visibility ?? 'INTERNAL',
      uploadedByUserId: ctx.userId,
      metadataJson: freeMetadata ?? cmd.metadataJson,
      pendingQuotaBytes: this.config.uploadPendingMaxBytesPerCompany,
      pendingCreatedAfter: new Date(Date.now() - PENDING_STORAGE_RETENTION_MS),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'attachment.upload.intent', targetType: 'attachment', targetId: record.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return {
      attachmentId: record.id,
      uploadUrl: intent.uploadUrl,
      uploadMethod: intent.uploadMethod,
      uploadHeaders: intent.uploadHeaders,
      expiresAt: intent.expiresAt,
    };
  }
}
