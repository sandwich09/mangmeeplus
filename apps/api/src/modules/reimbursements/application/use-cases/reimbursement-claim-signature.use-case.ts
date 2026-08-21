import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  LinkReimbursementSignedCopyInput,
  ReimbursementClaimSignatureRole,
  ReimbursementClaimSignatureSummary,
  ReimbursementSignedCopySummary,
  RequestContext,
  SignReimbursementClaimFormInput,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import type { ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { toSignedCopySummaries } from '../dto/reimbursement.mapper';
import { assertCanReadRequest, claimSignatureAckHash } from './reimbursement-request.use-case';

const SIGNATURE_METADATA_TAG = 'reimbursement_claim_signature';
const SIGNATURE_MAX_BYTES = 2_000_000;
const SIGNATURE_MIME_TYPES = ['image/png', 'image/jpeg'];
/** A signed copy is a scan or a phone photo of the printed form. */
const SIGNED_COPY_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

/**
 * Roles this user may sign, derived from who actually performed each step —
 * exactly the actors the printed form names. A step that has not happened has no
 * eligible signer at all, so nobody can pre-sign an approval.
 */
export function eligibleClaimSignatureRoles(req: ReimbursementRequestRecord, userId: string): ReimbursementClaimSignatureRole[] {
  const roles: ReimbursementClaimSignatureRole[] = [];
  // A corrected/reopened draft can keep its request number, but its facts are editable and therefore
  // cannot be signed until resubmission freezes a new snapshot.
  if (!req.requestNo || ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'].includes(req.status)) return roles;
  if (req.requesterUserId === userId) roles.push('REQUESTER');

  const approvedStep = (req.approvalSteps ?? [])
    .filter((step) => step.status === 'APPROVED' && !!step.decidedAt)
    .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
  if (approvedStep?.decisionByUserId === userId) roles.push('APPROVER');

  // Same gate the printed form uses: BLOCKED/NEEDS_INFO are decisions, not sign-off.
  if (req.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && req.financeReviewedByUserId === userId) roles.push('FINANCE_REVIEW');

  const payment = (req.payments ?? [])
    .filter((row) => row.status === 'RECORDED')
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())
    .at(-1);
  if (payment?.paidByUserId === userId) roles.push('PAYER');
  return roles;
}

/** Signature bytes as a data URL, after magic-byte and checksum verification. */
export async function loadOwnedClaimSignature(
  repo: PrismaReimbursementRepository,
  storage: AttachmentStoragePort,
  companyId: string,
  attachmentId: string,
  userId: string,
  requestId: string,
  role: ReimbursementClaimSignatureRole,
): Promise<{ id: string; dataUrl: string; checksumSha256: string }> {
  const attachment = await repo.findClaimSignatureAttachment(companyId, attachmentId, userId, requestId, role);
  if (!attachment) throw new BadRequestException('claim_signature_attachment_invalid');
  if (attachment.byteSize > SIGNATURE_MAX_BYTES) throw new BadRequestException('claim_signature_too_large');
  const object = await storage.getObject({
    bucket: attachment.bucket,
    objectKey: attachment.objectKey,
    ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
  });
  assertImageBytes(object.bytes, attachment.mimeType);
  const checksum = sha256(object.bytes);
  if (attachment.checksumSha256 && attachment.checksumSha256 !== checksum) {
    throw new ConflictException('claim_signature_checksum_mismatch');
  }
  return { id: attachment.id, dataUrl: `data:${attachment.mimeType};base64,${object.bytes.toString('base64')}`, checksumSha256: checksum };
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertImageBytes(bytes: Buffer, mimeType: string): void {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((mimeType === 'image/png' && !png) || (mimeType === 'image/jpeg' && !jpeg)) {
    throw new BadRequestException('claim_signature_bytes_mismatch');
  }
}

/** Upload endpoints borrow the attachment grant for the signer's own file, like the substitute receipt. */
function withAttachmentCreate(ctx: RequestContext): RequestContext {
  return ctx.permissions.includes('attachment.create') ? ctx : { ...ctx, permissions: [...ctx.permissions, 'attachment.create'] };
}

async function loadSignableRequest(
  repo: PrismaReimbursementRepository,
  ctx: RequestContext,
  requestId: string,
  role: ReimbursementClaimSignatureRole,
): Promise<ReimbursementRequestRecord> {
  const req = await repo.findRequestById(ctx.companyId, requestId, true);
  if (!req) throw new NotFoundException('Reimbursement request not found');
  await assertCanReadRequest(ctx, req, repo);
  if (!eligibleClaimSignatureRoles(req, ctx.userId).includes(role)) {
    throw new ForbiddenException('claim_signature_role_not_eligible');
  }
  return req;
}

@Injectable()
export class InitClaimSignatureUploadUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly createUpload: CreateUploadIntentUseCase) {}

  async execute(
    ctx: RequestContext,
    requestId: string,
    input: { role: ReimbursementClaimSignatureRole; originalFileName: string; mimeType: string; byteSize: number },
  ) {
    const req = await loadSignableRequest(this.repo, ctx, requestId, input.role);
    if (!SIGNATURE_MIME_TYPES.includes(input.mimeType)
      || !Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException('claim_signature_must_be_png_or_jpeg_max_2mb');
    }
    return this.createUpload.execute(withAttachmentCreate(ctx), {
      originalFileName: input.originalFileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      visibility: 'INTERNAL',
      ...(req.branchId ? { branchId: req.branchId } : {}),
      metadataJson: { generatedFor: SIGNATURE_METADATA_TAG, requestId, role: input.role },
    });
  }
}

@Injectable()
export class CompleteClaimSignatureUploadUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository, private readonly completeUpload: CompleteAttachmentUploadUseCase) {}

  async execute(
    ctx: RequestContext,
    requestId: string,
    attachmentId: string,
    input: { role: ReimbursementClaimSignatureRole; checksumSha256?: string; byteSize?: number },
  ) {
    await loadSignableRequest(this.repo, ctx, requestId, input.role);
    const attachment = await this.repo.findClaimSignatureUploadAttachment(ctx.companyId, attachmentId, ctx.userId, requestId, input.role);
    if (!attachment || attachment.status !== 'PENDING_UPLOAD') throw new BadRequestException('claim_signature_upload_not_found');
    return this.completeUpload.execute(withAttachmentCreate(ctx), {
      attachmentId,
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {}),
      ...(input.byteSize !== undefined ? { byteSize: input.byteSize } : {}),
    });
  }
}

@Injectable()
export class SignClaimFormUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, requestId: string, input: SignReimbursementClaimFormInput): Promise<ReimbursementClaimSignatureSummary> {
    const req = await loadSignableRequest(this.repo, ctx, requestId, input.role);
    // You sign what you previewed: any edit to the claim between preview and
    // signature invalidates the acknowledgement.
    if (claimSignatureAckHash(req) !== input.snapshotHash) throw new ConflictException('stale_claim_snapshot');

    const signatureAttachmentId = input.signatureAttachmentId
      ?? await this.repo.findLatestActiveSavedSignatureAttachmentId(ctx.companyId, ctx.userId);
    if (!signatureAttachmentId) {
      throw new UnprocessableEntityException({
        code: 'claim_saved_signature_required',
        message: 'claim_saved_signature_required',
      });
    }
    const signature = await loadOwnedClaimSignature(
      this.repo, this.storage, ctx.companyId, signatureAttachmentId, ctx.userId, requestId, input.role,
    );
    const saved = await this.repo.upsertClaimSignature({
      companyId: ctx.companyId,
      reimbursementRequestId: requestId,
      role: input.role,
      signatureAttachmentId: signature.id,
      signedByUserId: ctx.userId,
      signedAt: new Date(),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.claim_form.sign',
      targetType: 'reimbursement_request', targetId: requestId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { role: input.role, signatureAttachmentId: signature.id, snapshotHash: input.snapshotHash },
    });
    return { role: saved.role, signedByUserId: saved.signedByUserId, signedAt: saved.signedAt.toISOString() };
  }
}

@Injectable()
export class LinkSignedClaimFormCopyUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, requestId: string, input: LinkReimbursementSignedCopyInput): Promise<ReimbursementSignedCopySummary[]> {
    const req = await this.repo.findRequestById(ctx.companyId, requestId);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    await assertCanReadRequest(ctx, req, this.repo);
    // Nothing to scan back before the claim has a document number.
    if (!req.requestNo || ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'].includes(req.status)) {
      throw new UnprocessableEntityException('claim_form_requires_submitted');
    }
    const canUpload = req.requesterUserId === ctx.userId
      || ctx.permissions.includes('reimbursement.finance_review')
      || ctx.permissions.includes('reimbursement.payment.record');
    if (!canUpload) throw new ForbiddenException('claim_form_signed_copy_denied');

    // Same ACTIVE assertion as LinkAttachmentUseCase, plus the uploader must be
    // the actor: a signed copy is evidence, not an arbitrary company file.
    const attachment = await this.attachments.findById({ id: input.attachmentId, companyId: ctx.companyId });
    if (!attachment || attachment.status !== 'ACTIVE' || attachment.uploadedByUserId !== ctx.userId) {
      throw new BadRequestException('claim_form_signed_copy_attachment_invalid');
    }
    if (!SIGNED_COPY_MIME_TYPES.includes(attachment.mimeType)) {
      throw new BadRequestException('claim_form_signed_copy_must_be_pdf_or_image');
    }

    await this.repo.linkSignedClaimFormCopy(ctx.companyId, requestId, input.attachmentId, ctx.userId);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.claim_form.signed_copy.link',
      targetType: 'reimbursement_request', targetId: requestId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { attachmentId: input.attachmentId },
    });
    return toSignedCopySummaries(await this.repo.listSignedClaimFormCopies(ctx.companyId, requestId));
  }
}
