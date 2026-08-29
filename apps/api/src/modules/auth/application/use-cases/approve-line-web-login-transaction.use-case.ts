import { ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { hashLineWebQrValue } from '../../domain/logic/line-web-qr.logic';

/** One message for "no such code", "already used" and "expired": a prober must not learn which. */
function notFound(): NotFoundException {
  return new NotFoundException('QR transaction is expired or not found.');
}

/**
 * P12-3a step 2: the signed-in phone approves the desktop's transaction (master plan §13.6E).
 *
 * The caller is already authenticated through the untouched P12-1/P12-2 machinery, so this only
 * binds that identity to a PENDING, unexpired transaction. The approve is a conditional UPDATE on
 * status='PENDING', so two phones racing the same code produce exactly one approval — the loser
 * sees the same generic not-found as a stranger.
 */
@Injectable()
export class ApproveLineWebLoginTransactionUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { userId: string; publicCode: string; requestId: string }): Promise<{ approved: true }> {
    const now = new Date();
    const transaction = await this.prisma.client.lineWebLoginTransaction.findUnique({
      where: { publicCodeHash: hashLineWebQrValue(input.publicCode) },
    });
    if (!transaction || transaction.status !== 'PENDING' || transaction.expiresAt <= now) throw notFound();

    // Re-checked here rather than trusted from the token: the session may predate a suspension,
    // and approving is what hands a brand-new session to another browser.
    const user = await this.prisma.client.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user || user.status !== 'ACTIVE') throw new ForbiddenException('Account is not active.');

    const claimed = await this.prisma.client.lineWebLoginTransaction.updateMany({
      where: { id: transaction.id, status: 'PENDING' },
      data: { status: 'APPROVED', userId: input.userId, approvedAt: now },
    });
    if (claimed.count === 0) throw notFound();

    void this.audit?.log({
      action: AuditAction.AUTH_LINE_QR_APPROVE,
      actorUserId: input.userId,
      targetType: 'line_web_login_transaction',
      targetId: transaction.id,
      requestId: input.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
    });
    return { approved: true };
  }
}
