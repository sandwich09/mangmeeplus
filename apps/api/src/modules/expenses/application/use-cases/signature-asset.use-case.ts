import { GetExpenseUseCase } from './expense-draft.use-case';
import { assertExpenseFinancialAccess } from '../expense-commercial-access';
import { Inject, Injectable, ForbiddenException, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { CreateUploadIntentUseCase } from '../../../data-model-core/application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../../data-model-core/application/use-cases/complete-attachment-upload.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { AuditService } from '../../../audit/application/audit.service';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';
import { todayCivilDate } from '@watchdog-bms/contracts';
import type { RequestContext, CreateSignatureAssetInput, SignatureFillInput } from '@watchdog-bms/contracts';
import type { SignatureAssetRecord } from '../../domain/models/expense.model';
import { normalizeSignatureImage, SIGNATURE_MAX_BYTES } from '../../domain/logic/signature-image.logic';

function hasPerm(ctx: RequestContext, perm: string): boolean {
  return ctx.permissions.includes(perm);
}

const SIGNATURE_ATTACHMENT_PURPOSE = 'expense.signature.asset';

/**
 * Owner decision 2026-08-20 (superseding D10/D11): a signature is a PERSONAL asset — no approval
 * step, visible only to its owner, usable the moment it is saved. What the model gates is therefore
 * the signing act, not a queue: `expense.review` and `expense.confirm` are the two acts the
 * substitute-receipt flow performs. `expense.signature.self_manage` is the self-service grant;
 * `expense.signature.manage` remains accepted only for compatibility and never widens ownership.
 *
 * Authenticity does not come from this list: it comes from the authenticated signing act plus the
 * audit trail, and forgery is prevented by the ownership binding (`submittedByUserId`), which every
 * lookup still enforces.
 */
export const SIGNATURE_OWNER_PERMISSIONS = ['expense.signature.self_manage', 'expense.review', 'expense.confirm', 'expense.signature.manage'] as const;

/** Shared with the LINE flow, so the ask, the numbered choice and the write agree on one rule. */
export function maySubmitSignature(permissions: readonly string[]): boolean {
  return SIGNATURE_OWNER_PERMISSIONS.some((key) => permissions.includes(key));
}

function assertSignatureOwner(ctx: RequestContext): void {
  if (!maySubmitSignature(ctx.permissions)) {
    throw new ForbiddenException(`Missing permission: one of ${SIGNATURE_OWNER_PERMISSIONS.join(', ')}`);
  }
}

/**
 * A7/A8: the URL for a signature image, so nobody signs with an image they cannot see.
 *
 * Same-origin through our own API on purpose. This used to hand the browser a raw presigned storage
 * URL, and a cross-origin storage response bound straight into `<img src>` is exactly what Chrome's
 * ORB refuses — the signer saw a broken-image icon and certified blind, while `fetch()` of the same
 * URL returned a perfectly good PNG. `/api/v1/*` is the web's rewrite to this API (next.config.ts),
 * so the browser treats the preview as first-party, sends the session cookie, and no storage-host
 * CORS or response-header drift can reach it. `GetSignatureImageUseCase` below serves the bytes and
 * repeats the owner-only authorization; a URL on its own grants nothing.
 *
 * Deliberately not routed through `CreateDownloadUrlUseCase`: that gate refuses any attachment
 * already recorded as a certificate's payer/approver signature, which is precisely the attachment
 * its owner has to look at.
 */
export function signatureInlineUrl(
  audit: AuditService,
  ctx: RequestContext,
  attachment: { id: string },
  /** The asset the preview belongs to, so the audit row names the thing, not just the blob. */
  signatureAssetId?: string,
): string {
  void audit.log({
    companyId: ctx.companyId, actorUserId: ctx.userId,
    action: 'expense.signature.preview_url.create', targetType: 'company_signature_asset',
    targetId: signatureAssetId ?? attachment.id,
    requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    metadataJson: { signatureAssetId: signatureAssetId ?? null, attachmentId: attachment.id },
  });
  return `/api/v1/companies/${ctx.companyId}/expense-signatures/images/${attachment.id}`;
}

/**
 * Serves the bytes behind `signatureInlineUrl`, with the same owner-only rule the rest of D14
 * enforces: `findReusableSignatureAsset` pinned to one attachment answers only when that attachment
 * belongs to a signature asset THIS caller submitted, and only while it is a live PNG/JPEG — so the
 * response can always carry a real image content type, which is what makes it safe in `<img src>`.
 */
@Injectable()
export class GetSignatureImageUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  async execute(ctx: RequestContext, attachmentId: string): Promise<{ bytes: Buffer; mimeType: 'image/png' | 'image/jpeg'; fileName: string }> {
    assertSignatureOwner(ctx);
    const attachment = await this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId, attachmentId);
    if (!attachment) throw new NotFoundException('Signature image not found');
    const object = await this.storage.getObject({
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      ...(attachment.objectVersionId ? { objectVersionId: attachment.objectVersionId } : {}),
    });
    return {
      bytes: object.bytes,
      mimeType: attachment.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      fileName: attachment.originalFileName,
    };
  }
}

/** Web upload/draw/import step 1: create the attachment upload intent (no asset row yet). */
@Injectable()
export class InitSignatureUploadUseCase {
  constructor(private readonly createIntent: CreateUploadIntentUseCase) {}

  async execute(ctx: RequestContext, cmd: { originalFileName: string; mimeType: string; byteSize: number }) {
    assertSignatureOwner(ctx);
    if (cmd.mimeType !== 'image/png' && cmd.mimeType !== 'image/jpeg') {
      throw new BadRequestException('Signature images must be PNG or JPEG');
    }
    // The web canvas keeps its own bytes (it posts the background-removed PNG itself), so nothing
    // downscales this channel the way `deriveUsableImage` downscales LINE. Without this the library
    // happily stores a 3 MB photo that certification then refuses at the 2 MB cap — a signature that
    // can never sign, discovered only at the moment of signing.
    if (cmd.byteSize > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException(`ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB (ไฟล์นี้ ${(cmd.byteSize / 1_000_000).toFixed(1)} MB)`);
    }
    return this.createIntent.execute(ctx, cmd);
  }
}

/**
 * Creates a company signature asset from a completed attachment. Every path (web upload/draw/import,
 * LINE AI intake, the LINE numbered-answer route) lands here.
 *
 * The asset is ACTIVE from creation and belongs to its submitter (owner decision 2026-08-20): there
 * is no approval step to wait for on any channel. `approvedByUserId`/`approvedAt` are kept and mean
 * "activated" — by the person whose signature it is — so the columns every reader already joins on
 * stay populated and the audit answers "since when was this usable".
 *
 * D14 says ONE current signature per person, and saving a new one is how you replace it, so the
 * repository retires the submitter's previous ACTIVE row inside this create's own transaction. The
 * retirement is a status move only — `archivedAt` records it on the row, in the same request as the
 * `expense.signature.create` audit below that caused it.
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
    private readonly permissionResolver: PermissionResolverService,
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
    options?: { beforeCommit: () => Promise<void> },
  ): Promise<SignatureAssetRecord> {
    assertSignatureOwner(ctx);

    // LINE retries must not create duplicate assets.
    if (cmd.lineMessageId) {
      const existing = await this.repo.findSignatureAssetByLineMessageId(ctx.companyId, cmd.lineMessageId);
      if (existing) {
        await this.currentOwner(ctx);
        if (existing.submittedByUserId !== ctx.userId) throw new ForbiddenException('Signature belongs to another owner.');
        await options?.beforeCommit();
        return existing;
      }
    }

    if (!cmd.attachmentAlreadyActive) {
      await this.completeUpload.execute(ctx, {
        attachmentId: cmd.attachmentId,
        checksumSha256: cmd.checksumSha256,
        byteSize: cmd.byteSize,
      });
    }

    const identity = await this.currentOwner(ctx);
    await options?.beforeCommit();
    let asset: SignatureAssetRecord;
    try {
      asset = await this.repo.createSignatureAsset({
        companyId: ctx.companyId,
        // The name its owner reads in the signature list when none was typed: the date as every other
        // screen prints one (2 ต.ค. 2569), not the machine form 2026-10-02. Stored, so it never changes.
        label: cmd.label ?? `${identity.displayName} ${formatThaiExportDate(todayCivilDate())}`,
        originalAttachmentId: cmd.attachmentId,
        submittedByUserId: ctx.userId,
        submittedFromChannel: cmd.submittedFromChannel ?? 'WEB',
        lineMessageId: cmd.lineMessageId,
        // Activated by its owner, at creation. Nothing else may set these columns any more.
        status: 'ACTIVE',
        approvedByUserId: ctx.userId,
        approvedAt: new Date(),
      });
    } catch (error) {
      // A redelivery that raced past the read above now loses at the unique index instead of
      // creating the twin. Hand back the winner: this call's job is done either way.
      if ((error as { code?: string }).code === 'P2002' && cmd.lineMessageId) {
        const winner = await this.repo.findSignatureAssetByLineMessageId(ctx.companyId, cmd.lineMessageId);
        if (winner) {
          if (winner.submittedByUserId !== ctx.userId) throw new ForbiddenException('Signature belongs to another owner.');
          return winner;
        }
      }
      throw error;
    }
    await this.repo.linkAttachmentToTarget(cmd.attachmentId, 'company.signature_asset', asset.id, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.create', targetType: 'company_signature_asset', targetId: asset.id,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      // `activationMode` is what an auditor reads to know no second party was involved — there is no
      // longer an `expense.signature.approve` row for this asset to look for.
      metadataJson: { submittedFromChannel: asset.submittedFromChannel, status: asset.status, activationMode: 'personal' },
    });

    // The web canvas owns background removal on its own channel: it shows the user both renditions
    // and posts the derived PNG itself moments later. Deriving here too would burn a second sharp
    // pass to produce an attachment the client immediately overwrites — and would silently override
    // a user who looked at the preview and chose NOT to remove the background.
    const derivedAttachmentId = (cmd.submittedFromChannel ?? 'WEB') === 'WEB'
      ? undefined
      : await this.deriveUsableImage(ctx, asset.id, cmd.attachmentId);
    return derivedAttachmentId
      ? await this.repo.updateSignatureAsset(ctx.companyId, asset.id, { derivedAttachmentId })
      : asset;
  }

  private async currentOwner(ctx: RequestContext) {
    const current = await this.permissionResolver.resolveAccess(ctx.userId, ctx.companyId);
    const identity = await this.repo.findActiveMemberIdentity(ctx.companyId, ctx.userId, null);
    if (!identity || identity.userId !== ctx.userId || current.companyId !== ctx.companyId
      || ctx.membershipId && current.membershipId !== ctx.membershipId) throw new ForbiddenException('Signature access changed.');
    assertSignatureOwner({ ...ctx, permissions: current.permissions });
    return identity;
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

/**
 * Retire a personal signature. Permission opens the operation; ownership decides whose row it is.
 *
 * Certified documents are untouched: they resolve by recorded attachment id, and the pinned
 * re-resolution accepts any status.
 */
@Injectable()
export class ArchiveSignatureAssetUseCase {
  constructor(private readonly repo: PrismaExpenseRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, signatureId: string): Promise<SignatureAssetRecord> {
    assertSignatureOwner(ctx);
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.submittedByUserId !== ctx.userId) throw new ForbiddenException('You can only archive your own signature');
    if (asset.status === 'ARCHIVED') return asset;

    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, { status: 'ARCHIVED', archivedAt: new Date() });
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.archive', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { submittedByUserId: asset.submittedByUserId },
    });
    return updated;
  }
}

/**
 * Records the derived background-removed PNG produced by the web canvas flow.
 * The original signature asset is always kept.
 *
 * Substitute-receipt certification (R9) prefers `derivedAttachmentId`, so re-pointing it swaps the
 * image that signs legal artifacts — which is exactly why ONLY the submitter may do it. That
 * ownership check is the whole integrity story now: re-pointing your own personal signature is
 * updating your own signature, and there is no approval left to send it back to. Certified
 * documents are unaffected: they resolve by recorded attachment id.
 */
@Injectable()
export class SetSignatureDerivedAssetUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, signatureId: string, cmd: { attachmentId: string; checksumSha256?: string; byteSize?: number }): Promise<SignatureAssetRecord> {
    assertSignatureOwner(ctx);
    const asset = await this.repo.findSignatureAssetById(ctx.companyId, signatureId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    if (asset.status === 'ARCHIVED' || asset.status === 'REJECTED') {
      throw new BadRequestException(`Cannot attach derived asset in status ${asset.status}`);
    }
    if (asset.submittedByUserId !== ctx.userId) {
      throw new ForbiddenException('Only the signature submitter may attach its background-removed image.');
    }

    await this.completeUpload.execute(ctx, { attachmentId: cmd.attachmentId, checksumSha256: cmd.checksumSha256, byteSize: cmd.byteSize });
    await this.repo.linkAttachmentToTarget(cmd.attachmentId, 'company.signature_asset', signatureId, SIGNATURE_ATTACHMENT_PURPOSE, ctx.companyId, ctx.userId);
    const updated = await this.repo.updateSignatureAsset(ctx.companyId, signatureId, { derivedAttachmentId: cmd.attachmentId });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId,
      action: 'expense.signature.background_remove', targetType: 'company_signature_asset', targetId: signatureId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH',
      metadataJson: { derivedAttachmentId: cmd.attachmentId },
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
    private readonly getExpense: GetExpenseUseCase,
  ) {}

  async execute(ctx: RequestContext, expenseId: string, input: SignatureFillInput & { checksumSha256?: string; byteSize?: number }): Promise<{ fillId: string; appliedAt: string }> {
    if (!hasPerm(ctx, 'expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    if (ctx.authProvider === 'line') throw new ForbiddenException('Signature fill is a web-only action');

    await assertExpenseFinancialAccess(ctx, this.repo.commercialAccessDb);
    const expense = await this.getExpense.execute(ctx, expenseId).catch((error: unknown) => {
      if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error;
      throw new NotFoundException(`Expense ${expenseId} not found`);
    });
    if (!['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(expense.status)) {
      throw new BadRequestException(`Cannot fill signature in status ${expense.status}`);
    }

    const asset = await this.repo.findSignatureAssetById(ctx.companyId, input.signatureAssetId);
    if (!asset) throw new NotFoundException('Signature asset not found');
    // The ownership binding this module's header claims "every lookup still enforces" — this one did
    // not, so any `expense.review` holder could apply somebody else's signature to a document, and
    // with approval removed a signature is fillable the instant it is saved.
    if (asset.submittedByUserId !== ctx.userId) throw new ForbiddenException('You can only apply your own signature');
    if (asset.status !== 'ACTIVE') throw new BadRequestException('Only ACTIVE signatures can be filled into documents');

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

/**
 * "ลายเซ็นของฉัน" means exactly that: every caller gets only their own rows and previews.
 */
export type SignatureAssetListItem =
  Omit<SignatureAssetRecord, 'originalAttachmentId' | 'derivedAttachmentId'>
  & Partial<Pick<SignatureAssetRecord, 'originalAttachmentId' | 'derivedAttachmentId'>>
  & { previewUrl: string | null };

@Injectable()
export class ListSignatureAssetsUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, status?: string): Promise<SignatureAssetListItem[]> {
    assertSignatureOwner(ctx);
    const assets = await this.repo.listSignatureAssets(ctx.companyId, ctx.userId, status);

    return Promise.all(assets.map(async (asset) => {
      return {
        ...asset,
        previewUrl: await this.previewUrl(ctx, asset),
      };
    }));
  }

  /** Derived first, same preference `findReusableSignatureAsset` certifies with, so the preview is
   *  the image the document will carry rather than the raw photo behind it. One audit row per asset
   *  per request: the loop stops at the first live attachment. */
  private async previewUrl(ctx: RequestContext, asset: SignatureAssetRecord): Promise<string | null> {
    for (const attachmentId of [asset.derivedAttachmentId, asset.originalAttachmentId]) {
      if (!attachmentId) continue;
      const attachment = await this.repo.findActiveAttachmentObject(ctx.companyId, attachmentId);
      if (attachment) return signatureInlineUrl(this.audit, ctx, { id: attachmentId }, asset.id);
    }
    return null;
  }
}
