import { ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { lineIdentityLockKey } from '../../../../common/database/line-identity-lock';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';
import { revokePendingLineHandoffTokens } from '../../domain/logic/line-handoff.logic';

@Injectable()
export class LinkLineIdentityUseCase {
  constructor(
    private readonly lineVerifier: LineLoginVerifierAdapter,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; idToken: string; requestId: string; companyId?: string; allowReassign?: boolean; expectedNonce?: string }): Promise<{ linked: true; providerUserId: string }> {
    return observeCustomerJourney(
      this.audit,
      {
        key: 'line-link', requestId: input.requestId, targetType: 'external_identity',
        actorUserId: input.userId, ...(input.companyId ? { companyId: input.companyId } : {}),
      },
      () => this.link(input),
      () => ({ outcome: 'linked' }),
    );
  }

  private async link(input: { userId: string; idToken: string; requestId: string; companyId?: string; allowReassign?: boolean; expectedNonce?: string }): Promise<{ linked: true; providerUserId: string }> {
    const { userId, idToken, requestId, companyId, allowReassign = false, expectedNonce } = input;
    // The web OAuth lane (P12-2) supplies the nonce it minted, so the ID token must prove it came
    // from that round trip; the LIFF/link surfaces pass none and stay byte-exact.
    const { subject: lineUserId } = await this.lineVerifier.verify(
      idToken,
      expectedNonce ? { nonce: expectedNonce } : undefined,
    );
    return this.prisma.client.$transaction(
      (tx) => this.linkVerifiedIdentity({ ...input, lineUserId }, tx),
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  canonicalChannelId(): string {
    const channelId = this.config.lineMessagingChannelId ?? this.config.lineLoginChannelId;
    if (!channelId && this.config.isProduction) {
      throw new ServiceUnavailableException('LINE channel configuration is missing.');
    }
    return channelId ?? 'unknown';
  }

  /** Internal transaction boundary. Callers must verify LINE proof before taking DB locks.
   * Ordinary OAuth/LIFF calls enter through execute; only the admin QR service shares this body.
   */
  async linkVerifiedIdentity(
    input: { userId: string; lineUserId: string; requestId: string; companyId?: string; allowReassign?: boolean },
    tx: Prisma.TransactionClient,
  ): Promise<{ linked: true; providerUserId: string }> {
    const { userId, lineUserId, requestId, allowReassign = false } = input;
    const providerChannelId = this.canonicalChannelId();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'line-identity-user:' + userId}, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lineIdentityLockKey(providerChannelId, lineUserId)}, 0))`;
    const companyId = await this.resolveCompanyId(userId, input.companyId, tx);
    const match = { provider: 'LINE' as const, providerUserId: lineUserId };
    let existing = await tx.externalIdentity.findFirst({ where: { ...match, providerChannelId } });
    if (!existing) {
      const legacy = await tx.externalIdentity.findMany({ where: match, take: 2 });
      if (legacy.length) {
        const candidate = legacy[0]!;
        const known = candidate.providerChannelId === 'unknown' || candidate.providerChannelId === this.config.lineLoginChannelId;
        if (legacy.length !== 1 || !known || !allowReassign) {
          throw new ConflictException({ code: 'line_identity_review_required', message: 'Ask an administrator to review the existing LINE binding and issue a new LINE QR.' });
        }
        existing = candidate;
      }
    }
    if (existing?.status === 'DISABLED') throw new ForbiddenException('LINE identity is disabled.');
    if (existing?.status === 'ACTIVE' && existing.userId !== userId && !allowReassign) {
      throw new ConflictException({ code: 'line_linked_elsewhere', message: 'LINE account already linked to another user.' });
    }
    if (existing && existing.userId !== userId) {
      await tx.passwordResetToken.updateMany({ where: { userId: existing.userId, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await revokePendingLineHandoffTokens(tx.lineWebHandoffToken, { lineUserId, userId: existing.userId });
    }
    try {
      if (existing) {
        await tx.externalIdentity.update({
          where: { id: existing.id, userId: existing.userId, status: existing.status, updatedAt: existing.updatedAt },
          data: { userId, providerChannelId, status: 'ACTIVE', linkedAt: new Date() },
        });
      } else {
        await tx.externalIdentity.create({ data: {
          userId, provider: 'LINE', providerUserId: lineUserId, providerChannelId, status: 'ACTIVE', linkedAt: new Date(),
        } });
      }
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002' || (error as { code?: string }).code === 'P2025') {
        throw new ConflictException({ code: 'line_identity_changed', message: 'LINE binding changed. Reload and try again.' });
      }
      throw error;
    }
    await this.upsertCompanyContext(lineUserId, companyId, tx);
    await tx.auditLog.create({ data: {
      actorUserId: userId, action: AuditAction.AUTH_IDENTITY_LINK,
      targetType: 'ExternalIdentity', targetId: lineUserId, requestId,
      result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: { ...(existing && existing.providerChannelId !== providerChannelId ? { legacyBindingRepaired: true } : {}) },
    } });
    return { linked: true, providerUserId: lineUserId };
  }

  /** Resolve selected company before mutating identity state.
   *  - explicit companyId: validate active membership — any role (Owner decision 2026-08-29:
   *    linking and company selection are login-level; per-company authorization stays with the
   *    permission resolver and branch ABAC downstream).
   *  - no companyId, single membership: auto-resolve.
   *  - no companyId, multiple memberships: skip context; webhook prompts selection. */
  private async resolveCompanyId(userId: string, companyId: string | undefined, tx: Prisma.TransactionClient): Promise<string | undefined> {
    const activeMemberships = await tx.companyMembership.findMany({
      where: { userId, status: 'ACTIVE', user: { status: 'ACTIVE' }, company: { status: 'ACTIVE' } },
      select: { companyId: true },
    });

    if (companyId) {
      if (!activeMemberships.some((m) => m.companyId === companyId)) {
        throw new ForbiddenException('User is not an active member of the specified company.');
      }
      return companyId;
    }

    if (activeMemberships.length === 0) {
      throw new ForbiddenException('User has no active company membership.');
    }
    if (activeMemberships.length === 1) {
      return activeMemberships[0]?.companyId;
    }

    // ponytail: 2+ memberships without explicit context: skip write; webhook will prompt selection
    return undefined;
  }

  private async upsertCompanyContext(lineUserId: string, companyId: string | undefined, tx: Prisma.TransactionClient): Promise<void> {
    if (!companyId) return;

    await tx.lineCompanyContext.upsert({
      where: { lineUserId },
      create: { lineUserId, companyId, selectedAt: new Date() },
      // Review MED-2: `aiPausedUntil` is the §8 "ติดต่อเจ้าหน้าที่" hold on one conversation about
      // one shop. This path can move a severed LINE account to a DIFFERENT user, so carrying the
      // hold over would open somebody else's shop with the assistant silently switched off until a
      // timestamp nobody can see expires. Cleared on every link, including a re-link by the same
      // person: deliberately re-attaching an account is a fresh start, not a paused thread.
      update: { companyId, selectedAt: new Date(), aiPausedUntil: null },
    });
  }
}
