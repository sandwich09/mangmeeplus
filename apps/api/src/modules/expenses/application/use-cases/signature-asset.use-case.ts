import { Inject, Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { AuditService } from '../../../audit/application/audit.service';
import { CreateOrUpdateNotificationEventUseCase } from '../../../dashboard-notifications/application/use-cases/notification.use-cases';
import { todayCivilDate } from '@watchdog-bms/contracts';
import type { RequestContext, CreateSignatureAssetInput, SignatureFillInput } from '@watchdog-bms/contracts';
import type { SignatureAssetRecord } from '../../domain/models/expense.model';
import { normalizeSignatureImage, SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

const SIGNATURE_ATTACHMENT_PURPOSE = 'expense.signature.asset';

/** The one screen a signature notification can be acted on — the same deep link the LINE ticket
 *  reply hands out, so both arrive at the named row. */
function signatureDeepLink(companyId: string, signatureId: string): string {
  return `/companies/${companyId}/expenses/signatures?signatureId=${signatureId}`;
}

const SIGNATURE_NOTICES = {
  PENDING: {
    triggerKey: 'expense.signature_approval_pending',
    title: 'ลายเซ็นรอเจ้าของกิจการอนุมัติ',
    body: 'มีลายเซ็นส่งเข้ามาใหม่ เปิดระบบเพื่อดูรูปและอนุมัติ',
  },
  APPROVED: {
    triggerKey: 'expense.signature_approved',
    title: 'ลายเซ็นของคุณได้รับอนุมัติแล้ว',
    body: 'ใช้ลงนามเอกสารได้ทันที ถ้ามีคำถามค้างอยู่ใน LINE ตอบคำถามนั้นเพื่อออกเอกสารต่อได้เลย',
  },
  REJECTED: {
    triggerKey: 'expense.signature_rejected',
    title: 'ลายเซ็นของคุณไม่ผ่านการอนุมัติ',
    body: 'ส่งรูปลายเซ็นใหม่อีกครั้งได้เลย',
  },
  DEMOTED: {
    triggerKey: 'expense.signature_needs_reapproval',
    title: 'ลายเซ็นกลับไปรอเจ้าของกิจการอนุมัติ',
    body: 'มีการเปลี่ยนรูปลายเซ็นที่อนุมัติไว้แล้ว จึงต้องอนุมัติใหม่ก่อนใช้ลงนาม',
  },
} as const;

/**
 * Every signature-lifecycle notice, in one shape. Recipients exclude the actor — the convention
 * `notifySignaturePending` (substitute-receipt.use-case) already set, and the reason the solo-owner
 * auto-approve makes no noise at all: they are both submitter and approver.
 *
 * Never throws: a notification failure must not lose an approval that already happened.
 */
async function notifySignature(
  notify: CreateOrUpdateNotificationEventUseCase | undefined,
  logger: Logger,
  ctx: RequestContext,
  signatureId: string,
  notice: { triggerKey: string; title: string; body: string },
  recipientUserIds: string[],
): Promise<void> {
  const recipients = [...new Set(recipientUserIds)].filter((userId) => userId && userId !== ctx.userId);
  if (!notify || recipients.length === 0) return;
  try {
    await notify.execute({
      companyId: ctx.companyId,
      triggerKey: notice.triggerKey,
      sourceModule: 'expenses',
      sourceType: 'company_signature_asset',
      sourceId: signatureId,
      severity: 'action',
      title: notice.title,
      body: notice.body,
      deepLinkHref: signatureDeepLink(ctx.companyId, signatureId),
      recipientUserIds: recipients,
    });
  } catch (error) {
    logger.warn({
      msg: 'signature_notification_failed',
      signatureId,
      triggerKey: notice.triggerKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * A7/A8: a short-lived inline URL for a signature image, so nobody approves or signs with an image
 * they cannot see.
 *
 * Deliberately not routed through `CreateDownloadUrlUseCase`: that gate refuses any attachment
 * already recorded as a certificate's payer/approver signature, which is precisely the attachment
 * an approver has to look at. The permission decision therefore belongs to each caller and is
 * stated at each call site.
 */
export async function signatureInlineUrl(
  storage: AttachmentStoragePort,
  audit: AuditService,
  ctx: RequestContext,
  attachment: { id?: string; bucket: string; objectKey: string; objectVersionId?: string; mimeType: string; originalFileName?: string },
  /** The asset the preview belongs to, so the audit row names the thing, not just the blob. */
  signatureAssetId?: string,
): Promise<string | null> {
  try {
    const signed = await storage.createDownloadUrl({
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
      mimeType: attachment.mimeType,
      // F14: without a name the browser saves the preview as "download".
      ...(attachment.originalFileName ? { fileName: attachment.originalFileName } : {}),
      disposition: 'inline',
    });
    // This path deliberately does not run through CreateDownloadUrlUseCase, so it would otherwise
    // hand out a readable URL for a signature with no record that anyone asked. Never the URL or
    // its token — those are the credential.
    void audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.preview_url.create', targetType: 'company_signature_asset',
      targetId: signatureAssetId ?? attachment.id ?? attachment.objectKey,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { signatureAssetId: signatureAssetId ?? null, attachmentId: attachment.id ?? null },
    });
    return signed.url;
  } catch {
    // ponytail: a preview is an aid, never the gate. A storage hiccup must not blank the queue.
    return null;
  }
}

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
 * Creates a company signature asset from a completed attachment. Every path (web upload/draw/import,
 * LINE AI intake, the LINE numbered-answer route) lands here.
 *
 * Lifecycle starts at PENDING_OWNER_APPROVAL and the pending queue in web IS the approval ticket —
 * EXCEPT for a submitter who already holds `expense.signature.approve` (owner decision 2026-08-20).
 * The backend has always let them approve their own submission; a solo owner would simply be
 * clicking approve on their own photo, so creation does it for them and records `autoApproved`.
 *
 * Two things are also fixed up here rather than at each caller, because both bite every channel:
 * the image is downscaled into what certification will accept, and its paper is made transparent
 * (a LINE JPEG has no alpha, so it otherwise prints as a white rectangle over the certificate).
 */
@Injectable()
export class CreateSignatureAssetUseCase {
  private readonly logger = new Logger(CreateSignatureAssetUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async execute(
    ctx: RequestContext,
    cmd: CreateSignatureAssetInput & {
      checksumSha256?: string;
      byteSize?: number;
      submittedFromChannel?: 'WEB' | 'LINE';
      lineMessageId?: string;
      /** The LINE pending-media route hands over bytes that were completed when they were parked,
       *  so there is no upload left to finish. */
      attachmentAlreadyActive?: boolean;
    },
  ): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.manage')) throw new ForbiddenException('Missing permission: expense.signature.manage');

    // LINE retries must not create duplicate pending assets.
    if (cmd.lineMessageId) {
      const existing = await this.repo.findSignatureAssetByLineMessageId(ctx.companyId, cmd.lineMessageId);
      if (existing) return existing;
    }

    if (!cmd.attachmentAlreadyActive) {
      await this.completeUpload.execute(ctx, {
        attachmentId: cmd.attachmentId,
        checksumSha256: cmd.checksumSha256,
        byteSize: cmd.byteSize,
      });
    }

    const autoApproved = hasPerm(ctx, 'expense.signature.approve');
    let asset: SignatureAssetRecord;
    try {
      asset = await this.repo.createSignatureAsset({
        companyId: ctx.companyId,
        label: cmd.label ?? await this.defaultLabel(ctx),
        originalAttachmentId: cmd.attachmentId,
        submittedByUserId: ctx.userId,
        submittedFromChannel: cmd.submittedFromChannel ?? 'WEB',
        lineMessageId: cmd.lineMessageId,
        ...(autoApproved ? { status: 'ACTIVE', approvedByUserId: ctx.userId, approvedAt: new Date() } : {}),
      });
    } catch (error) {
      // A redelivery that raced past the read above now loses at the unique index instead of
      // creating the twin. Hand back the winner: this call's job is done either way.
      if ((error as { code?: string }).code === 'P2002' && cmd.lineMessageId) {
        const winner = await this.repo.findSignatureAssetByLineMessageId(ctx.companyId, cmd.lineMessageId);
        if (winner) return winner;
      }
      throw error;
    }
    await this.repo.linkAttachmentToTarget(cmd.attachmentId, 'company.signature_asset', asset.id, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.create', targetType: 'company_signature_asset', targetId: asset.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { submittedFromChannel: asset.submittedFromChannel, status: asset.status, autoApproved },
    });

    if (autoApproved) {
      // The approval really happened, so it gets the row an auditor querying approvals looks for.
      // `create` alone, with `autoApproved` in its metadata, is invisible to that query.
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId,
        action: 'expense.signature.approve', targetType: 'company_signature_asset', targetId: asset.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
        metadataJson: { submittedByUserId: asset.submittedByUserId, autoApproved: true },
      });
    }

    // The web canvas owns background removal on its own channel: it shows the user both renditions
    // and posts the derived PNG itself moments later. Deriving here too would burn a second sharp
    // pass to produce an attachment the client immediately overwrites — and would silently override
    // a user who looked at the preview and chose NOT to remove the background.
    const derivedAttachmentId = (cmd.submittedFromChannel ?? 'WEB') === 'WEB'
      ? undefined
      : await this.deriveUsableImage(ctx, asset.id, cmd.attachmentId);
    // No demote here, unlike `SetSignatureDerivedAssetUseCase`: that guard exists for RE-pointing an
    // already-approved asset at an image nobody approved. This is the first derive of a brand-new
    // asset in its own creation flow — sending it straight back for approval would make the
    // auto-approve above meaningless.
    const created = derivedAttachmentId
      ? await this.repo.updateSignatureAsset(ctx.companyId, asset.id, { derivedAttachmentId })
      : asset;

    if (!autoApproved) {
      await notifySignature(this.notify, this.logger, ctx, created.id, SIGNATURE_NOTICES.PENDING,
        await this.repo.listUserIdsWithPermission(ctx.companyId, 'expense.signature.approve'));
    }
    return created;
  }

  /** A14: a LINE asset arrived with no label at all, so the queue read "ลายเซ็นไม่มีชื่อ" for every
   *  row and an owner with three staff could not tell them apart. */
  private async defaultLabel(ctx: RequestContext): Promise<string | undefined> {
    const identity = await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, null);
    return identity ? `${identity.displayName} ${todayCivilDate()}` : undefined;
  }

  /**
   * Produces the image the certificate will actually carry: background removed, and small enough
   * for certification's 2 MB ceiling. Best-effort — `findReusableSignatureAsset` prefers the
   * derived attachment and falls back to the original, so a failure here costs polish, not the
   * upload. The downscale-only retry is what keeps an 8 MB LINE photo usable when the alpha pass
   * cannot read it.
   */
  private async deriveUsableImage(ctx: RequestContext, signatureId: string, attachmentId: string): Promise<string | undefined> {
    try {
      const source = await this.repo.findActiveAttachmentObject(ctx.companyId, attachmentId);
      if (!source || (source.mimeType !== 'image/png' && source.mimeType !== 'image/jpeg')) return undefined;
      const object = await this.storage.getObject({
        bucket: source.bucket,
        objectKey: source.objectKey,
        ...(source.objectVersionId ? { objectVersionId: source.objectVersionId } : {}),
      });
      // Transparent first, because that is the point. When it cannot land under the certify budget
      // (a noisy photo's alpha PNG can exceed it at every edge) the opaque re-encode compresses far
      // better; when neither fits, store NOTHING — the reusable-signature lookup prefers the derived
      // attachment, so an over-budget derivative replaces a usable original with one certify
      // rejects outright.
      const rendered = await normalizeSignatureImage(object.bytes, source.mimeType, { removeBackground: true })
        ?? await normalizeSignatureImage(object.bytes, source.mimeType, { removeBackground: false });
      if (!rendered) return undefined;

      const checksumSha256 = createHash('sha256').update(rendered.bytes).digest('hex');
      const extension = rendered.mimeType === 'image/png' ? 'png' : 'jpg';
      const stored = await this.storage.putObject({
        objectKey: `${ctx.companyId}/generated/expense-signature/${signatureId}/${checksumSha256}-${randomUUID()}.${extension}`,
        mimeType: rendered.mimeType,
        bytes: rendered.bytes,
      });
      const derivedAttachmentId = await this.repo.createGeneratedSignatureAttachment({
        companyId: ctx.companyId,
        uploadedByUserId: ctx.userId,
        originalFileName: `signature-${signatureId}.${extension}`,
        mimeType: rendered.mimeType,
        byteSize: stored.byteSize,
        checksumSha256,
        storageProvider: stored.storageProvider,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        objectVersionId: stored.objectVersionId,
        metadataJson: { generatedBy: 'signature_asset', stage: 'derived', signatureAssetId: signatureId },
      });
      await this.repo.linkAttachmentToTarget(derivedAttachmentId, 'company.signature_asset', signatureId, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);
      return derivedAttachmentId;
    } catch (error) {
      this.logger.warn({
        msg: 'signature_derive_failed',
        signatureId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

@Injectable()
export class ApproveSignatureAssetUseCase {
  private readonly logger = new Logger(ApproveSignatureAssetUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
  ) {}

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
    // The submitter's next LINE turn will find `hasReusableSignature` true, but nothing tells them
    // that — the assistant only speaks when spoken to.
    await notifySignature(this.notify, this.logger, ctx, signatureId, SIGNATURE_NOTICES.APPROVED, [asset.submittedByUserId]);
    return updated;
  }
}

@Injectable()
export class RejectSignatureAssetUseCase {
  private readonly logger = new Logger(RejectSignatureAssetUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
  ) {}

  async execute(ctx: RequestContext, signatureId: string, reason: string): Promise<SignatureAssetRecord> {
    if (!hasPerm(ctx, 'expense.signature.approve')) throw new ForbiddenException('Missing permission: expense.signature.approve');
    if (!reason?.trim()) throw new BadRequestException('Reject reason is required');
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status !== 'PENDING_OWNER_APPROVAL') throw new BadRequestException(`Cannot reject signature in status ${asset.status}`);

    const rejectReason = reason.trim().slice(0, 300);
    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, {
      status: 'REJECTED',
      rejectedByUserId: ctx.userId,
      rejectedAt: new Date(),
      rejectReason,
    });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.reject', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
    });
    await notifySignature(this.notify, this.logger, ctx, signatureId,
      { ...SIGNATURE_NOTICES.REJECTED, body: `เหตุผล: ${rejectReason}\n${SIGNATURE_NOTICES.REJECTED.body}` },
      [asset.submittedByUserId]);
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
  private readonly logger = new Logger(SetSignatureDerivedAssetUseCase.name);

  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
    private readonly notify: CreateOrUpdateNotificationEventUseCase,
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
    // The demote protects an approval given by someone else. A submitter who holds the approval
    // permission is that someone else (owner decision 2026-08-20 auto-approve) — sending their own
    // asset back to their own queue is ceremony, and it would silently undo the auto-approve for
    // every web upload, which posts its derived PNG moments after creation.
    const selfApproved = hasPerm(ctx, 'expense.signature.approve');
    const demotedFromActive = asset.status === 'ACTIVE' && !selfApproved;

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
      metadataJson: { derivedAttachmentId: cmd.attachmentId, demotedFromActive, selfApproved },
    });
    if (demotedFromActive) {
      // Approval holders only. Only the submitter may re-point, so they are always the actor and
      // `notifySignature` always drops them — naming them here just reads as a promise it cannot
      // keep. The people with something waiting again are the ones who can clear it.
      await notifySignature(this.notify, this.logger, ctx, signatureId, SIGNATURE_NOTICES.DEMOTED,
        await this.repo.listUserIdsWithPermission(ctx.companyId, 'expense.signature.approve'));
    }
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
  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, status?: string): Promise<Array<SignatureAssetRecord & { previewUrl: string | null }>> {
    const canManage = hasPerm(ctx, 'expense.signature.manage') || hasPerm(ctx, 'expense.signature.approve');
    const canReview = hasPerm(ctx, 'expense.review');
    if (!canManage && !canReview) throw new ForbiddenException('Missing permission: expense.signature.manage');
    // Reviewers only see ACTIVE assets (fill picker); managers/approvers see the full queue.
    const assets = canManage
      ? await this.repo.listSignatureAssets(ctx.companyId, status)
      : await this.repo.listSignatureAssets(ctx.companyId, 'ACTIVE');

    return Promise.all(assets.map(async (asset) => ({
      ...asset,
      // A7: an owner was approving an image they could not see. Narrowest rule that fixes that —
      // whoever may act on the asset, plus the person whose signature it is. A reviewer who is
      // neither reads the row without the picture, exactly as before.
      previewUrl: canManage || asset.submittedByUserId === ctx.userId
        ? await this.previewUrl(ctx, asset)
        : null,
    })));
  }

  /** Derived first, same preference `findReusableSignatureAsset` certifies with, so the preview is
   *  the image the document will carry rather than the raw photo behind it. One audit row per asset
   *  per request: the loop stops at the first live attachment. */
  private async previewUrl(ctx: RequestContext, asset: SignatureAssetRecord): Promise<string | null> {
    for (const attachmentId of [asset.derivedAttachmentId, asset.originalAttachmentId]) {
      if (!attachmentId) continue;
      const attachment = await this.repo.findActiveAttachmentObject(ctx.companyId, attachmentId);
      if (attachment) return signatureInlineUrl(this.storage, this.audit, ctx, { id: attachmentId, ...attachment }, asset.id);
    }
    return null;
  }
}
