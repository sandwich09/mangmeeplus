import { ConflictException, ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LinkLineIdentityUseCase } from './link-line-identity.use-case';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { revokePendingLineHandoffTokens } from '../../domain/logic/line-handoff.logic';

@Injectable()
export class CompleteEmployeeLineLinkUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkLineIdentity: LinkLineIdentityUseCase,
    private readonly lineVerifier: LineLoginVerifierAdapter,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { linkToken: string; idToken: string; requestId: string }): Promise<{ linked: true }> {
    const tokenHash = createHash('sha256').update(input.linkToken).digest('hex');
    const initial = await this.prisma.client.employeeLineLinkToken.findUnique({ where: { tokenHash } });
    const invalid = () => new ForbiddenException('LINE link token is invalid, expired, or already used.');
    try {
      if (!initial || !['PENDING', 'USED'].includes(initial.status) || initial.expiresAt.getTime() <= Date.now()) throw invalid();
      // Invalid provider proof cannot consume the QR; network I/O precedes all database locks.
      const { subject } = await this.lineVerifier.verify(input.idToken);
      const channelId = this.linkLineIdentity.canonicalChannelId();
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'line-identity-user:' + initial.userId}, 0))`;
        const token = await tx.employeeLineLinkToken.findUnique({ where: { tokenHash } });
        if (!token || token.userId !== initial.userId || token.expiresAt.getTime() <= Date.now()) throw invalid();
        const membership = await tx.companyMembership.findFirst({ where: {
          id: token.membershipId, companyId: token.companyId, userId: token.userId,
          status: 'ACTIVE', user: { status: 'ACTIVE' }, company: { status: 'ACTIVE' },
        } });
        if (!membership) throw invalid();

        // The receipt proves THIS QR's original LINE account. Recovery only reads current state;
        // it cannot sever a later binding or perform a second link after a lost HTTP response.
        if (token.status === 'USED') {
          if (token.claimedLineUserId !== subject || token.claimedLineChannelId !== channelId) throw invalid();
          const identity = await tx.externalIdentity.findFirst({ where: {
            provider: 'LINE', providerChannelId: channelId, providerUserId: subject, userId: token.userId, status: 'ACTIVE',
          } });
          if (!identity) throw invalid();
          return { linked: true as const };
        }
        if (token.status !== 'PENDING') throw invalid();
        const claimed = await tx.employeeLineLinkToken.updateMany({
          where: { id: token.id, status: 'PENDING', expiresAt: { gt: new Date() } },
          data: { status: 'USED', usedAt: new Date(), claimedLineUserId: subject, claimedLineChannelId: channelId },
        });
        if (claimed.count !== 1) throw invalid();
        await this.linkLineIdentity.linkVerifiedIdentity({
          userId: token.userId, lineUserId: subject, companyId: token.companyId,
          requestId: input.requestId, allowReassign: true,
        }, tx);

        const others = await tx.externalIdentity.findMany({
          where: { userId: token.userId, provider: 'LINE', status: 'ACTIVE', providerUserId: { not: subject } },
          select: { id: true, providerUserId: true, updatedAt: true },
        });
        let severed = 0;
        for (const identity of others) {
          const changed = await tx.externalIdentity.updateMany({
            where: { id: identity.id, userId: token.userId, status: 'ACTIVE', updatedAt: identity.updatedAt },
            data: { status: 'UNLINKED' },
          });
          if (changed.count !== 1) continue;
          await tx.passwordResetToken.updateMany({ where: { userId: token.userId, status: 'PENDING' }, data: { status: 'REVOKED' } });
          await tx.lineCompanyContext.deleteMany({ where: { lineUserId: identity.providerUserId } });
          const handoffLinksRevoked = await revokePendingLineHandoffTokens(tx.lineWebHandoffToken, {
            lineUserId: identity.providerUserId, userId: token.userId,
          });
          await tx.auditLog.create({ data: {
            actorUserId: token.userId, action: AuditAction.AUTH_IDENTITY_UNLINK,
            targetType: 'ExternalIdentity', targetId: identity.id, companyId: token.companyId,
            requestId: input.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
            metadataJson: { reason: 'employee_line_relink', handoffLinksRevoked },
          } });
          severed++;
        }
        await tx.auditLog.create({ data: {
          action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_SUCCESS, targetType: 'EmployeeLineLinkToken',
          targetId: token.id, companyId: token.companyId, actorUserId: token.userId,
          requestId: input.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
          metadataJson: { unlinkedPreviousLineIdentities: severed },
        } });
        return { linked: true as const };
      }, { maxWait: 5_000, timeout: 20_000 });
    } catch (error) {
      void this.audit?.log({
        action: AuditAction.ACCESS_EMPLOYEE_LINE_LINK_FAILURE, targetType: 'EmployeeLineLinkToken',
        targetId: initial?.id, companyId: initial?.companyId, requestId: input.requestId,
        result: 'FAILED', riskLevel: 'MEDIUM',
        metadataJson: { reason: error instanceof ConflictException || error instanceof ForbiddenException || error instanceof UnauthorizedException ? 'link_refused' : 'transaction_failed' },
      });
      if (error instanceof ConflictException || error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({ code: 'line_link_retry', message: 'LINE link could not finish. Retry the same QR.' });
    }
  }
}
