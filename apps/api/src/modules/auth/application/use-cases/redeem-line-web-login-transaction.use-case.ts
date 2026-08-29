import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { hashLineWebQrValue } from '../../domain/logic/line-web-qr.logic';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';

export type RedeemLineWebLoginTransactionResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | ({ status: 'approved'; returnTo: string | null } & AuthTokensResult);

/**
 * P12-3a step 3: the polling desktop redeems its own transaction (master plan §13.6E).
 *
 * The desktop secret is the browser binding — an approved transaction can only ever be turned into
 * a session by the browser that started it. Redemption is a conditional UPDATE to CONSUMED, which
 * is terminal: a replayed secret finds a CONSUMED row and is answered 'expired', never a second
 * session (rule 8). An unknown secret is a 403, so polling cannot be used to enumerate codes.
 */
@Injectable()
export class RedeemLineWebLoginTransactionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { desktopSecret: string }): Promise<RedeemLineWebLoginTransactionResult> {
    const now = new Date();
    const transaction = await this.prisma.client.lineWebLoginTransaction.findUnique({
      where: { desktopSecretHash: hashLineWebQrValue(input.desktopSecret) },
    });
    if (!transaction) throw new ForbiddenException('QR transaction is expired or not found.');
    if (transaction.expiresAt <= now) return { status: 'expired' };
    if (transaction.status === 'PENDING') return { status: 'pending' };
    // CONSUMED is terminal — a second poll with the same secret must not re-mint.
    if (transaction.status !== 'APPROVED' || !transaction.userId) return { status: 'expired' };

    const user = await this.prisma.client.user.findUnique({
      where: { id: transaction.userId },
      select: { status: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active.');

    const claimed = await this.prisma.client.lineWebLoginTransaction.updateMany({
      where: { id: transaction.id, status: 'APPROVED' },
      data: { status: 'CONSUMED', consumedAt: now },
    });
    if (claimed.count === 0) return { status: 'expired' };

    const tokens = await this.issueToken.execute(transaction.userId, 'line');
    void this.audit?.log({
      action: AuditAction.AUTH_LINE_QR_REDEEM,
      actorUserId: transaction.userId,
      targetType: 'line_web_login_transaction',
      targetId: transaction.id,
      requestId: randomUUID(),
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
    });
    return { status: 'approved', returnTo: transaction.returnTo ?? null, ...tokens };
  }
}
