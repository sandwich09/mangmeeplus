import { Inject, Injectable, ForbiddenException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
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

  async execute(ctx: RequestContext, cmd: CreateUploadIntentCommand): Promise<CreateUploadIntentResult> {
    if (!ctx.permissions.includes('attachment.create')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.upload.intent', targetType: 'attachment', targetId: undefined,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
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
      metadataJson: cmd.metadataJson,
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
