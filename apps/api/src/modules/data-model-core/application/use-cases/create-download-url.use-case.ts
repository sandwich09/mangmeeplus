import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../domain/ports/attachment-storage.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../domain/logic/branch.logic';

/**
 * `disposition: 'inline'` is the preview ask (an <img>/<embed> src, which Chrome's ORB refuses to
 * load from an `attachment` response). Omitted means download, which is what every existing
 * caller means and gets.
 */
export type CreateDownloadUrlCommand = { attachmentId: string; disposition?: 'inline' | 'attachment' };

export type CreateDownloadUrlResult = { downloadUrl: string; expiresAt: Date };

@Injectable()
export class CreateDownloadUrlUseCase {
  constructor(
    private readonly attachments: PrismaAttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, cmd: CreateDownloadUrlCommand): Promise<CreateDownloadUrlResult> {
    if (!ctx.permissions.includes('attachment.read')) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.download_url.create', targetType: 'attachment', targetId: cmd.attachmentId,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'MEDIUM',
      });
      throw new ForbiddenException();
    }

    const existing = await this.attachments.findById({ id: cmd.attachmentId, companyId: ctx.companyId });
    if (!existing) throw new NotFoundException('Attachment not found.');
    if (existing.status === 'DELETED' || existing.status === 'QUARANTINED') {
      throw new ForbiddenException('Attachment is not accessible.');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, existing.branchId)) {
      throw new ForbiddenException('Attachment is outside your assigned branch scope.');
    }
    if (await this.attachments.isSubstituteRawSignature({ id: existing.id, companyId: ctx.companyId })) {
      throw new ForbiddenException('Raw substitute-receipt signatures are never available through generic attachment downloads.');
    }

    const signed = await this.storage.createDownloadUrl({
      bucket: existing.bucket,
      objectKey: existing.objectKey,
      objectVersionId: existing.objectVersionId,
      mimeType: existing.mimeType,
      fileName: existing.originalFileName,
      ...(cmd.disposition ? { disposition: cmd.disposition } : {}),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'attachment.download_url.create', targetType: 'attachment', targetId: existing.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });

    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }
}
