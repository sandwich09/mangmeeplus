import { ForbiddenException, Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { observeCustomerJourney } from '../../../../common/observability/customer-journey-audit';

export type ExchangeLineTokenResult =
  | ({ linked: true } & AuthTokensResult)
  | { linked: false; message: string };

@Injectable()
export class ExchangeLineTokenUseCase {
  constructor(
    private readonly lineVerifier: LineLoginVerifierAdapter,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly issueToken: IssueTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  // ponytail: channelId from request body is accepted for future multi-channel support,
  //           but LINE token is verified using the server-configured channelId via LineLoginVerifierAdapter
  async execute(idToken: string, _channelId: string): Promise<ExchangeLineTokenResult> {
    const requestId = randomUUID();
    return observeCustomerJourney(
      this.audit,
      { key: 'line-login', requestId, targetType: 'external_identity' },
      () => this.exchange(idToken, requestId),
      (result) => result.linked
        ? { outcome: 'linked' }
        : { outcome: 'unlinked', failureClass: 'identity_unlinked' },
    );
  }

  private async exchange(idToken: string, requestId: string): Promise<ExchangeLineTokenResult> {
    let lineUserId: string;
    try {
      const verified = await this.lineVerifier.verify(idToken);
      lineUserId = verified.subject;
    } catch (error) {
      void this.audit?.log({
        action: AuditAction.AUTH_LOGIN_DENIED,
        targetType: 'external_identity',
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason: 'line_verification_failed' },
      });
      throw error;
    }

    const identity = await this.resolveActiveIdentity(lineUserId);

    if (!identity) {
      void this.audit?.log({
        action: AuditAction.AUTH_LOGIN_DENIED,
        targetType: 'external_identity',
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason: 'unlinked_line_identity' },
      });
      return { linked: false, message: 'Account not linked. Contact admin to be invited.' };
    }

    const { user } = identity;
    if (user.status === 'SUSPENDED' || user.status === 'DISABLED') {
      void this.audit?.log({
        action: AuditAction.AUTH_LOGIN_DENIED,
        actorUserId: user.id,
        targetType: 'external_identity',
        targetId: identity.id,
        requestId,
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason: 'inactive_user' },
      });
      throw new ForbiddenException('Account is not active.');
    }

    const tokens = await this.issueToken.execute(user.id, 'line');
    return { linked: true, ...tokens };
  }

  /**
   * LINE userIds are channel-scoped, so resolve against the canonical
   * messaging channel first (P12.1). Identities linked before
   * `providerChannelId` was recorded fall back to the channel-agnostic query
   * with a warn — same shape as webhook/notification resolution — until the
   * migration backfill lands.
   */
  private async resolveActiveIdentity(lineUserId: string) {
    const where = { provider: 'LINE' as const, providerUserId: lineUserId, status: 'ACTIVE' as const };
    const canonicalChannelId = this.config.lineMessagingChannelId;
    if (!canonicalChannelId) {
      if (this.config.isProduction) {
        // P12.1: never resolve identities channel-agnostically in production.
        throw new ServiceUnavailableException('LINE channel configuration is missing.');
      }
      return this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    }
    const scoped = await this.prisma.client.externalIdentity.findFirst({
      where: { ...where, providerChannelId: canonicalChannelId },
      include: { user: true },
    });
    if (scoped) return scoped;
    const fallback = await this.prisma.client.externalIdentity.findFirst({ where, include: { user: true } });
    if (fallback) {
      console.warn(`[line-exchange] line_identity_channel_agnostic_fallback identityId=${fallback.id}`);
    }
    return fallback;
  }
}
