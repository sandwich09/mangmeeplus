import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import type { RequestContext, CreateSignatureAssetInput, SignatureFillInput } from '@watchdog-bms/contracts';
import type { SignatureAssetRecord } from '../../domain/models/expense.model';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

const SIGNATURE_ATTACHMENT_PURPOSE = 'expense.signature.asset';

/** Web upload/draw/import step 1: create the attachment upload intent (no asset row yet). */
@Injectable()
export class InitSignatureUploadUseCase {
  constructor(private readonly createIntent: CreateUploadIntentUseCase) {}

  async execute(ctx: RequestContext, cmd: { originalFileName: string; mimeType: string; byteSize: number }) {
    if (!hasPerm(ctx, 'expense.signature.manage')) throw new ForbiddenException('Missing permission: expense.signature.manage');
    if (cmd.mimeType !== 'image/png' && cmd.mimeType !== 'image/jpeg') {
      throw new BadRequestException('Signature images must be PNG or JPEG');
    }
    return this.createIntent.execute(ctx, cmd);
  }
}

/**
 * Creates a pending company signature asset from a completed attachment.
 * Every path (web upload/draw/import, LINE AI intake) lands here:
 * lifecycle starts at PENDING_OWNER_APPROVAL; only an owner-level approver
 * can activate it. The pending queue in web IS the approval ticket.
 */
@Injectable()
export class CreateSignatureAssetUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: CreateSignatureAssetInput & {
      checksumSha256?: string;
      byteSize?: number;
      submittedFromChannel?: 'WEB' | 'LINE';
      lineMessageId?: string;
    },
  ): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.manage')) throw new ForbiddenException('Missing permission: expense.signature.manage');

    // LINE retries must not create duplicate pending assets.
    if (cmd.lineMessageId) {
      const existing = await this.repo.findSignatureAssetByLineMessageId(ctx.companyId, cmd.lineMessageId);
      if (existing) return existing;
    }

    await this.completeUpload.execute(ctx, {
      attachmentId: cmd.attachmentId,
      checksumSha256: cmd.checksumSha256,
      byteSize: cmd.byteSize,
    });

    const asset = await this.repo.createSignatureAsset({
      companyId: ctx.companyId,
      label: cmd.label,
      originalAttachmentId: cmd.attachmentId,
      submittedByUserId: ctx.userId,
      submittedFromChannel: cmd.submittedFromChannel ?? 'WEB',
      lineMessageId: cmd.lineMessageId,
    });
    await this.repo.linkAttachmentToTarget(cmd.attachmentId, 'company.signature_asset', asset.id, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.create', targetType: 'company_signature_asset', targetId: asset.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { submittedFromChannel: asset.submittedFromChannel, status: asset.status },
    });
    return asset;
  }
}

@Injectable()
export class ApproveSignatureAssetUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, signatureId: string): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.approve')) throw new ForbiddenException('Missing permission: expense.signature.approve');
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status !== 'PENDING_OWNER_APPROVAL') throw new BadRequestException(`Cannot approve signature in status ${asset.status}`);

    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, {
      status: 'ACTIVE',
      approvedByUserId: ctx.userId,
      approvedAt: new Date(),
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.approve', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { submittedByUserId: asset.submittedByUserId },
    });
    return updated;
  }
}

@Injectable()
export class RejectSignatureAssetUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, signatureId: string, reason: string): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.approve')) throw new ForbiddenException('Missing permission: expense.signature.approve');
    if (!reason?.trim()) throw new BadRequestException('Reject reason is required');
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status !== 'PENDING_OWNER_APPROVAL') throw new BadRequestException(`Cannot reject signature in status ${asset.status}`);

    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, {
      status: 'REJECTED',
      rejectedByUserId: ctx.userId,
      rejectedAt: new Date(),
      rejectReason: reason.trim().slice(0, 300),
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.reject', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
    });
    return updated;
  }
}

@Injectable()
export class ArchiveSignatureAssetUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, signatureId: string): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.manage')) throw new ForbiddenException('Missing permission: expense.signature.manage');
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status === 'ARCHIVED') return asset;

    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, { status: 'ARCHIVED', archivedAt: new Date() });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.archive', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
    });
    return updated;
  }
}

/**
 * Records the derived background-removed PNG produced by the web canvas flow.
 * The original signature asset is always kept.
 *
 * Substitute-receipt certification (R9) prefers `derivedAttachmentId`, so re-pointing it swaps the
 * image that signs legal artifacts. Only the submitter may do it, and doing it to an ACTIVE asset
 * sends that asset back for owner approval — an approved signature is never silently replaced by an
 * image nobody approved. Certified documents are unaffected: they resolve by recorded attachment id.
 */
@Injectable()
export class SetSignatureDerivedAssetUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, signatureId: string, cmd: { attachmentId: string; checksumSha256?: string; byteSize?: number }): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.manage')) throw new ForbiddenException('Missing permission: expense.signature.manage');
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status === 'ARCHIVED' || asset.status === 'REJECTED') {
      throw new BadRequestException(`Cannot attach derived asset in status ${asset.status}`);
    }
    if (asset.submittedByUserId !== ctx.userId) {
      throw new ForbiddenException('Only the signature submitter may attach its background-removed image.');
    }
    const demotedFromActive = asset.status === 'ACTIVE';

    await this.completeUpload.execute(ctx, { attachmentId: cmd.attachmentId, checksumSha256: cmd.checksumSha256, byteSize: cmd.byteSize });
    await this.repo.linkAttachmentToTarget(cmd.attachmentId, 'company.signature_asset', signatureId, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);
    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, {
      derivedAttachmentId: cmd.attachmentId,
      ...(demotedFromActive ? { status: 'PENDING_OWNER_APPROVAL' } : {}),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.background_remove', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { derivedAttachmentId: cmd.attachmentId, demotedFromActive },
    });
    return updated;
  }
}

/**
 * Fills an ACTIVE signature into a substitute receipt / review evidence
 * placeholder. Explicit permission-checked WEB action with full audit —
 * LINE/AI can never reach this use case.
 */
@Injectable()
export class FillSignatureUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, input: SignatureFillInput & { checksumSha256?: string; byteSize?: number }): Promise<{ fillId: string; appliedAt: string }> {
    if (!hasPerm(ctx, 'expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    if (ctx.authProvider === 'line') throw new ForbiddenException('Signature fill is a web-only action');

    const expense = await this.repo.findById(ctx.companyId, expenseId);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
      throw new BadRequestException(`Cannot fill signature in status ${expense.status}`);
    }

    const asset = await this.repo.findSignatureAssetById(ctx.companyId, input.signatureAssetId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status !== 'ACTIVE') throw new BadRequestException('Only ACTIVE approved signatures can be filled into documents');

    if (input.renderedAttachmentId) {
      await this.completeUpload.execute(ctx, { attachmentId: input.renderedAttachmentId, checksumSha256: input.checksumSha256, byteSize: input.byteSize });
      await this.repo.linkAttachment(expenseId, input.renderedAttachmentId, 'expense.review.evidence', ctx.companyId, ctx.userId);
    }

    const fill = await this.repo.createSignatureFill({
      companyId: ctx.companyId,
      expenseId,
      signatureAssetId: input.signatureAssetId,
      appliedByUserId: ctx.userId,
      renderedAttachmentId: input.renderedAttachmentId,
      placeholder: input.placeholder,
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.fill', targetType: 'expense_record', targetId: expenseId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { signatureAssetId: input.signatureAssetId, renderedAttachmentId: input.renderedAttachmentId ?? null, placeholder: input.placeholder ?? null },
    });
    return { fillId: fill.id, appliedAt: fill.appliedAt.toISOString() };
  }
}

@Injectable()
export class ListSignatureAssetsUseCase {
  constructor(private readonly repo: PrismaExpenseRepository) {}

  async execute(ctx: RequestContext, status?: string): Promise<SignatureAssetRecord[]> {
    const canManage = hasPerm(ctx, 'expense.signature.manage') || hasPerm(ctx, 'expense.signature.approve');
    const canReview = hasPerm(ctx, 'expense.review');
    if (!canManage && !canReview) throw new ForbiddenException('Missing permission: expense.signature.manage');
    // Reviewers only see ACTIVE assets (fill picker); managers/approvers see the full queue.
    if (!canManage) return this.repo.listSignatureAssets(ctx.companyId, 'ACTIVE');
    return this.repo.listSignatureAssets(ctx.companyId, status);
  }
}
