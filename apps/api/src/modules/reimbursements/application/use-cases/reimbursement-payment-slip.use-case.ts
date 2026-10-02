import {
  BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  canOpenReimbursementPaymentSlip,
  REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES,
  type AttachReimbursementPaymentSlipInput,
  type ReimbursementRequestDetail,
  type RequestContext,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import type { ReimbursementPaymentSlipLink, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import {
  REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES,
  REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG,
  REIMBURSEMENT_SIGNED_COPY_PURPOSE,
} from '../../domain/reimbursement.constants';
import { detailWithFileNames } from '../dto/reimbursement.mapper';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { assertReimbursementBranchInScope } from './reimbursement-branch-scope';
import { withAttachmentCreate } from './reimbursement-claim-signature.use-case';
import { assertCanReadRequestOrAssignment } from './reimbursement-request.use-case';

/**
 * Audit facts of a linked slip: ids and flags, never a file name, storage key or URL. A slip that
 * was moved out of the signed copies also records where it came from, who uploaded it, and whether
 * a "signed on paper" declaration was withdrawn with it (spec §16.2).
 */
export function paymentSlipAuditMetadata(slip: ReimbursementPaymentSlipLink): Record<string, unknown> {
  return {
    slipAttachmentId: slip.attachmentId,
    slipSource: slip.source,
    ...(slip.source === 'SIGNED_COPY' && {
      movedFromPurpose: REIMBURSEMENT_SIGNED_COPY_PURPOSE,
      originalUploaderUserId: slip.uploadedByUserId,
      paperDeclarationWithdrawn: slip.declarationWithdrawn,
    }),
  };
}

/** Every slip write is the payer's: the payment-record right, on a claim that exists. */
async function loadClaimForPayer(repo: PrismaReimbursementRepository, ctx: RequestContext, requestId: string): Promise<ReimbursementRequestRecord> {
  if (!ctx.permissions.includes('reimbursement.payment.record')) throw new ForbiddenException('Missing permission: reimbursement.payment.record');
  const req = await repo.findRequestById(ctx.companyId, requestId, true);
  if (!req) throw new NotFoundException('Reimbursement request not found');
  return req;
}

@Injectable()
export class InitPaymentSlipUploadUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly createUpload: CreateUploadIntentUseCase) {}

  async execute(ctx: RequestContext, requestId: string, input: { originalFileName: string; mimeType: string; byteSize: number }) {
    const req = await loadClaimForPayer(this.repo, ctx, requestId);
    assertReimbursementBranchInScope(ctx, req.branchId);
    if (!REIMBURSEMENT_PAYMENT_SLIP_MIME_TYPES.includes(input.mimeType)
      || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES) {
      throw new BadRequestException('payment_slip_invalid');
    }
    // The tag binds the file to this claim and, with the uploader recorded on the file, to this
    // payer: nothing else uploaded to the company can be passed off as this claim's slip.
    return this.createUpload.execute(withAttachmentCreate(ctx), {
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      visibility: 'INTERNAL',
      ...(req.branchId ? { branchId: req.branchId } : {}),
      metadataJson: { generatedFor: REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG, requestId },
    });
  }
}

@Injectable()
export class CompletePaymentSlipUploadUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  async execute(ctx: RequestContext, requestId: string, attachmentId: string, input: { checksumSha256?: string; byteSize?: number }): Promise<{ attachmentId: string }> {
    const req = await loadClaimForPayer(this.repo, ctx, requestId);
    assertReimbursementBranchInScope(ctx, req.branchId);
    const upload = await this.repo.findPaymentSlipUpload(ctx.companyId, attachmentId, ctx.userId, requestId);
    if (!upload || upload.status !== 'PENDING_UPLOAD') throw new BadRequestException('payment_slip_invalid');
    await this.completeUpload.execute(withAttachmentCreate(ctx), {
      attachmentId,
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {}),
      ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}),
    });
    // Only the id goes back: the storage record stays inside the API.
    return { attachmentId };
  }
}

/** Adds a slip to a recorded payment: a new upload, or a file already attached to the claim (§12.5, §16.2). */
@Injectable()
export class AttachPaymentSlipUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, requestId: string, paymentId: string, input: AttachReimbursementPaymentSlipInput): Promise<ReimbursementRequestDetail> {
    const req = await loadClaimForPayer(this.repo, ctx, requestId);
    assertReimbursementBranchInScope(ctx, req.branchId);
    if (!(req.payments ?? []).some((payment) => payment.id === paymentId)) throw new NotFoundException('Payment not found');

    const result = await this.repo.attachPaymentSlipAtomic({
      companyId: ctx.companyId, requestId, paymentId, attachmentId: input.attachmentId, actorUserId: ctx.userId,
      ...(input.confirmSignedCopyWithdrawal === true && { confirmSignedCopyWithdrawal: true }),
    });
    if (result.created && result.slip) {
      await this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payment.slip.attach',
        targetType: 'reimbursement_payment', targetId: paymentId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { requestId, ...paymentSlipAuditMetadata(result.slip) },
      });
    }
    // Re-read: a moved file changes the signed copies and the document step as well as the payment.
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, (await this.repo.findRequestById(ctx.companyId, requestId, true)) ?? req, ctx);
  }
}

/**
 * The only way to a slip's bytes. The generic attachment download refuses slip files outright, so
 * the viewer rule here cannot be walked around with an attachment id.
 */
@Injectable()
export class CreatePaymentSlipDownloadUrlUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext, requestId: string, paymentId: string, attachmentId: string, disposition?: 'inline',
  ): Promise<{ downloadUrl: string; expiresAt: Date }> {
    const req = await this.repo.findRequestById(ctx.companyId, requestId, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    // The same read gate as the claim detail, branch scope included; it also answers who may decide the pending step.
    const approvalActions = await assertCanReadRequestOrAssignment(ctx, req, this.repo);
    const auditEntry = {
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.payment.slip.open',
      targetType: 'reimbursement_payment', targetId: paymentId, requestId: ctx.requestId,
      metadataJson: { requestId, slipAttachmentId: attachmentId },
    };
    if (!canOpenReimbursementPaymentSlip(
      { userId: ctx.userId, permissions: ctx.permissions },
      { requesterUserId: req.requesterUserId, submittedAt: req.submittedAt, approvalSteps: req.approvalSteps, approvalActions },
    )) {
      void this.audit.log({ ...auditEntry, result: 'DENIED', riskLevel: 'HIGH' });
      throw new ForbiddenException('payment_slip_access_denied');
    }
    const file = (req.payments ?? []).some((payment) => payment.id === paymentId)
      ? await this.repo.findPaymentSlipFile(ctx.companyId, paymentId, attachmentId)
      : null;
    if (!file) throw new NotFoundException('Payment slip not found');

    const signed = await this.storage.createDownloadUrl({
      bucket: file.bucket,
      objectKey: file.objectKey,
      objectVersionId: file.objectVersionId,
      mimeType: file.mimeType,
      fileName: file.originalFileName,
      ...(disposition ? { disposition } : {}),
    });
    void this.audit.log({ ...auditEntry, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }
}
