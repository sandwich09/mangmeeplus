import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LineLoginVerifierAdapter } from '../../infrastructure/line-login-verifier.adapter';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

export type ExchangeLineTokenResult =
  | ({ linked: true } & AuthTokensResult)
  | { linked: false; message: string };

@Injectable()
export class ExchangeLineTokenUseCase {
  constructor(
    private readonly lineVerifier: LineLoginVerifierAdapter,
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  // ponytail: channelId from request body is accepted for future multi-channel support,
  //           but LINE token is verified using the server-configured channelId via LineLoginVerifierAdapter
  async execute(idToken: string, _channelId: string): Promise<ExchangeLineTokenResult> {
    const requestId = randomUUID();
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

    const identity = await this.prisma.client.externalIdentity.findFirst({
      where: { provider: 'LINE', providerUserId: lineUserId, status: 'ACTIVE' },
      include: { user: true },
    });

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
}
