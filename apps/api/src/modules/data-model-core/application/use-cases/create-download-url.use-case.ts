import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaAttachmentRepository } from '../../infrastructure/repositories/prisma-attachment.repository';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../domain/ports/attachment-storage.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../domain/logic/branch.logic';
import { REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG } from '../../../reimbursements/domain/reimbursement.constants';
import { DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, disbursementVoucherError } from '@watchdog-bms/contracts';

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
    if (existing.metadataJson?.['generatedFor'] === DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG || existing.metadataJson?.['generatedBy'] === 'disbursement_voucher'
      || await this.attachments.isDisbursementVoucherFile({ id: existing.id, companyId: ctx.companyId })) {
      void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'attachment.download_url.create', targetType: 'attachment', targetId: existing.id,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH', metadataJson: { reason: 'disbursement_voucher_file' } });
      throw new ForbiddenException(disbursementVoucherError('disbursement_file_general_download_denied'));
    }
    if (await this.attachments.isSubstituteRawSignature({ id: existing.id, companyId: ctx.companyId })) {
      throw new ForbiddenException('Raw substitute-receipt signatures are never available through generic attachment downloads.');
    }
    // A reimbursement payment slip shows a bank transfer, often with a full account number. Its
    // readers are decided per claim by the slip endpoint (owner decision 2026-10-01), so this
    // generic path serves it to nobody: not once it is linked to a payment, and not while it is
    // still an upload waiting to be recorded.
    if (existing.metadataJson?.['generatedFor'] === REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG
      || await this.attachments.isReimbursementPaymentSlip({ id: existing.id, companyId: ctx.companyId })) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.download_url.create', targetType: 'attachment', targetId: existing.id,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
        metadataJson: { reason: 'reimbursement_payment_slip' },
      });
      throw new ForbiddenException('Payment slips are opened from their reimbursement claim.');
    }
    // A signature is a personal asset (owner decision 2026-08-20): only the person whose signature
    // it is may ever fetch the image. The gate above covers only images a certificate already
    // RECORDED, so a library asset that has not signed anything yet used to be downloadable by
    // anyone holding `attachment.read` — which every housekeeping role holds, and housekeeping
    // authorises deleting someone's signature, never looking at it. The owner's own preview does not
    // come through here (it is minted by `signatureInlineUrl`), so this costs them nothing.
    const signature = await this.attachments.findSignatureAssetOwner({ id: existing.id, companyId: ctx.companyId });
    if (signature && signature.ownerUserId !== ctx.userId) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'attachment.download_url.create', targetType: 'attachment', targetId: existing.id,
        requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
        metadataJson: { reason: 'personal_signature_not_owned' },
      });
      throw new ForbiddenException('A personal signature image is only available to the person it belongs to.');
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
