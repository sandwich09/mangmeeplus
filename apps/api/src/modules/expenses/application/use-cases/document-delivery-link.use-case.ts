import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { GetExpenseUseCase } from './expense-draft.use-case';
import {
  composeIssuedSubstituteReceiptPdf,
  composeUnsignedSubstituteReceiptFormPdf,
} from './substitute-receipt.use-case';

export type DocumentDeliveryLinkKind = 'ISSUED_PDF' | 'UNSIGNED_FORM_PDF';

/** D7: a fixed three days. Not company-configurable, never extended — an expired link is re-minted. */
export const DELIVERY_LINK_TTL_MS = 72 * 60 * 60 * 1_000;
/** §12.3: one prefix, so one lifecycle rule and one no-`s3:ListBucket` statement cover every copy. */
export const DELIVERY_OBJECT_PREFIX = 'line-delivery/';
/** The 302 target outlives the click and nothing more. */
export const DELIVERY_PRESIGNED_SECONDS = 120;
/** 32 random bytes as unpadded base64url — 43 characters. Shared by the token and the object key. */
const RANDOM_BYTES = 32;
/** The exact shape `safeTenantLink` allows and the resolver accepts. Anything else never reaches the database. */
export const DELIVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function opaqueRandom(): string {
  return randomBytes(RANDOM_BYTES).toString('base64url');
}

/** The row stores only this. R16: a database reader can neither mint nor replay a link. */
export function deliveryTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * §12.2 — the key is opaque. No company id, expense id, document number, user id or date appears in
 * it, so holding one key reveals nothing about any other. It is independent of the token, so a
 * leaked key cannot be turned into a link and a leaked link cannot be turned into a key.
 */
export function deliveryTempObjectKey(): string {
  return `${DELIVERY_OBJECT_PREFIX}${opaqueRandom()}.pdf`;
}

/** Resolving the path against the base ORIGIN, degrading to the relative path exactly like the
 *  continuation's `absoluteLink`, so an unset `webBaseUrl` never throws in dev or tests. */
function deliveryUrl(webBaseUrl: string | undefined, token: string): string {
  const path = `/d/${token}`;
  try {
    return webBaseUrl ? new URL(path, webBaseUrl).toString() : path;
  } catch {
    return path;
  }
}

export type DocumentDeliveryLinkResult = { url: string; expiresAt: Date; linkId: string };

/**
 * §12.1 — the API **copies** the rendered PDF to the delivery prefix and hands back a token. The
 * source artifact is never moved, renamed or deleted, and no raw storage URL ever reaches the chat.
 *
 * §12.7 — re-issuing while a link is still live mints a SECOND token against a SECOND key. Both stay
 * valid until they expire or are revoked; nothing here invalidates an earlier link.
 */
@Injectable()
export class CreateDocumentDeliveryLinkUseCase {
  constructor(
    private readonly getExpense: GetExpenseUseCase,
    private readonly repo: PrismaExpenseRepository,
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Whether a link for this document, recipient and kind is still live.
   *
   * The token cannot be recovered from its hash, so this answers "has one already been sent?" and
   * never "what was it?". Callers use it to avoid minting a second temp copy for a reader who is
   * simply asking about the same document again — §12.7 still allows a deliberate second token.
   */
  async hasLiveLink(ctx: RequestContext, evidenceId: string, kind: DocumentDeliveryLinkKind): Promise<boolean> {
    const live = await this.prisma.client.documentDeliveryLink.findFirst({
      where: {
        companyId: ctx.companyId,
        evidenceId,
        kind,
        recipientUserId: ctx.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    return !!live;
  }

  async execute(
    ctx: RequestContext,
    input: { expenseId: string; evidenceId: string; kind: DocumentDeliveryLinkKind },
  ): Promise<DocumentDeliveryLinkResult> {
    // §14: "issued evidence readable by the recipient". That is exactly the gate the web artifact
    // download rides (GetExpenseUseCase: expense.read / review / read_own / read_related plus branch
    // scope), reused rather than restated — a second copy of a read rule is a second place to get it wrong.
    const expense = await this.getExpense.execute(ctx, input.expenseId);
    const evidence = await this.repo.findSubstituteEvidence(ctx.companyId, input.expenseId, input.evidenceId);
    if (!evidence) throw new NotFoundException('Substitute evidence not found.');
    const composed = input.kind === 'ISSUED_PDF'
      ? await composeIssuedSubstituteReceiptPdf(this.repo, this.storage, ctx.companyId, input.expenseId, evidence)
      : await composeUnsignedSubstituteReceiptFormPdf(this.repo, ctx.companyId, expense, evidence);
    const stored = await this.storage.putObject({
      objectKey: deliveryTempObjectKey(),
      mimeType: 'application/pdf',
      bytes: composed.data,
    });
    const token = opaqueRandom();
    let link: { id: string; expiresAt: Date };
    try {
      link = await this.prisma.client.documentDeliveryLink.create({
        data: {
          companyId: ctx.companyId,
          recipientUserId: ctx.userId,
          evidenceId: input.evidenceId,
          kind: input.kind,
          tokenHashSha256: deliveryTokenHash(token),
          tempBucket: stored.bucket,
          tempObjectKey: stored.objectKey,
          expiresAt: new Date(Date.now() + DELIVERY_LINK_TTL_MS),
          createdByUserId: ctx.userId,
        },
        select: { id: true, expiresAt: true },
      });
    } catch (error) {
      // Without the row nothing can ever resolve, revoke or account for this copy — and the prefix
      // lifecycle rule is the only other thing that would reach it. Best effort: a failed delete
      // must not replace the real error with a storage one.
      await this.storage.deleteObject({ bucket: stored.bucket, objectKey: stored.objectKey }).catch(() => undefined);
      throw error;
    }
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'document.delivery.link.create',
      targetType: 'document_delivery_link',
      targetId: link.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        kind: input.kind,
        evidenceId: input.evidenceId,
        expenseId: input.expenseId,
        recipientUserId: ctx.userId,
        documentNumber: evidence.documentNumber,
        expiresAt: link.expiresAt.toISOString(),
        byteSize: composed.data.byteLength,
      },
    });
    return { url: deliveryUrl(this.config.webBaseUrl, token), expiresAt: link.expiresAt, linkId: link.id };
  }
}

/** §15: one refusal shape for expired, revoked and unknown alike — the page it renders carries no
 *  document data, and an anonymous caller learns nothing about which of the three it hit. */
export type ResolvedDocumentDeliveryLink =
  | { status: 'OK'; url: string; expiresAt: Date }
  | { status: 'REFUSED' };

/** §12.4 — session-less by design: the token is the whole credential, so this use case takes no
 *  `RequestContext` and can never be confused for an authenticated read. */
@Injectable()
export class ResolveDocumentDeliveryLinkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { token: string; clientIp: string; requestId: string }): Promise<ResolvedDocumentDeliveryLink> {
    if (!DELIVERY_TOKEN_PATTERN.test(input.token)) return { status: 'REFUSED' };
    const link = await this.prisma.client.documentDeliveryLink.findUnique({
      where: { tokenHashSha256: deliveryTokenHash(input.token) },
    });
    // An unknown token names no company, no recipient and no row. There is nothing to attribute an
    // audit entry to, and writing one anyway would hand an anonymous scanner a row-insert primitive.
    if (!link) return { status: 'REFUSED' };
    const refusal = link.revokedAt ? 'revoked' : link.expiresAt.getTime() <= Date.now() ? 'expired' : undefined;
    if (refusal) {
      await this.auditOpen(link, input.clientIp, input.requestId, 'DENIED', { reason: refusal });
      return { status: 'REFUSED' };
    }
    // §15/R16: a token is a bearer credential, so who opened it is not knowable — but every open is.
    const opened = await this.prisma.client.documentDeliveryLink.update({
      where: { id: link.id },
      data: { openCount: { increment: 1 }, lastOpenedAt: new Date() },
      select: { openCount: true },
    });
    const signed = await this.storage.createDownloadUrl({
      bucket: link.tempBucket,
      objectKey: link.tempObjectKey,
      mimeType: 'application/pdf',
      // Deliberately generic: a Content-Disposition filename travels with the bytes, and the
      // document number belongs on the page, not in a URL anyone can forward.
      fileName: 'substitute-receipt.pdf',
      disposition: 'inline',
      expiresInSeconds: DELIVERY_PRESIGNED_SECONDS,
    });
    await this.auditOpen(link, input.clientIp, input.requestId, 'SUCCESS', { openCount: opened.openCount });
    return { status: 'OK', url: signed.url, expiresAt: signed.expiresAt };
  }

  /** §14: the row names the link, the recipient it was minted for, and the IP that opened it. The
   *  opener is anonymous by construction, so `actorUserId` stays empty rather than misattributing. */
  private auditOpen(
    link: { id: string; companyId: string; recipientUserId: string; evidenceId: string; kind: string },
    clientIp: string,
    requestId: string,
    result: 'SUCCESS' | 'DENIED',
    extra: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.log({
      actorType: 'SYSTEM',
      actorRefId: link.id,
      companyId: link.companyId,
      action: 'document.delivery.link.open',
      targetType: 'document_delivery_link',
      targetId: link.id,
      requestId,
      result,
      riskLevel: 'MEDIUM',
      metadataJson: {
        kind: link.kind,
        evidenceId: link.evidenceId,
        recipientUserId: link.recipientUserId,
        clientIp,
        ...extra,
      },
    });
  }
}

/** §12.6 — a presigned URL cannot be recalled, which is the whole reason the token indirection
 *  exists. Revoking therefore deletes the object the URLs point at; every issued URL dies with it. */
@Injectable()
export class RevokeDocumentDeliveryLinkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, linkId: string): Promise<{ revokedAt: Date }> {
    if (!ctx.permissions.includes('expense.review')) throw new ForbiddenException('Missing permission: expense.review');
    const link = await this.prisma.client.documentDeliveryLink.findFirst({
      where: { id: linkId, companyId: ctx.companyId },
    });
    if (!link) throw new NotFoundException('Delivery link not found.');
    // The mint path is branch-scoped through GetExpenseUseCase, so revoke must be too: a reviewer
    // assigned to one branch has no business acting on another branch's document, even to deny it.
    const scope = await this.repo.findSubstituteEvidenceScope(ctx.companyId, link.evidenceId);
    if (!scope) throw new NotFoundException('Delivery link not found.');
    if (!isBranchInScope(ctx.scopes ?? {}, scope.branchId)) {
      throw new ForbiddenException('Branch is outside your assigned branch scope.');
    }
    // Object first: a crash between the two leaves a link that resolves to nothing, never one that
    // still hands over the document.
    await this.storage.deleteObject({ bucket: link.tempBucket, objectKey: link.tempObjectKey });
    const revokedAt = link.revokedAt ?? new Date();
    if (!link.revokedAt) {
      await this.prisma.client.documentDeliveryLink.update({ where: { id: link.id }, data: { revokedAt } });
    }
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'document.delivery.link.revoke',
      targetType: 'document_delivery_link',
      targetId: link.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: {
        kind: link.kind,
        evidenceId: link.evidenceId,
        recipientUserId: link.recipientUserId,
        openCount: link.openCount,
        alreadyRevoked: !!link.revokedAt,
      },
    });
    return { revokedAt };
  }
}
