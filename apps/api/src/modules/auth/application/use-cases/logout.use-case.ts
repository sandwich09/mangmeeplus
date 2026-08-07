import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(tokenId: string, actorUserId?: string, requestId?: string): Promise<void> {
    // ponytail: updateMany avoids NotFoundException when session already revoked
    await this.prisma.client.authSession.updateMany({
      where: { tokenId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    // L-10: awaited, and never gated on the actor. An unattributable logout is exactly the
    // event worth keeping, so the unresolved actor is recorded explicitly instead of
    // dropping the row.
    await this.audit?.log({
      action: AuditAction.AUTH_SESSION_LOGOUT,
      actorUserId,
      targetType: 'auth_session',
      targetId: tokenId,
      requestId: requestId ?? randomUUID(),
      result: 'SUCCESS',
      ...(actorUserId ? {} : { riskLevel: 'MEDIUM' as const, metadataJson: { actor: 'unresolved' } }),
    });
  }
}
