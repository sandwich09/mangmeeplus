import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';

export type RevokeOtherSessionsInput = {
  userId: string;
  currentTokenId: string;
  requestId?: string;
};

export type RevokeOtherSessionsResult = {
  revokedCount: number;
};

@Injectable()
export class RevokeOtherSessionsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: RevokeOtherSessionsInput): Promise<RevokeOtherSessionsResult> {
    const revokedCount = await revokeActiveSessions(this.prisma.client.authSession, {
      userId: input.userId,
      exceptTokenId: input.currentTokenId,
    });

    // L-10: awaited; post-commit AuditService.log never throws.
    if (this.audit) {
      await this.audit.log({
        action: AuditAction.AUTH_SESSION_REVOKE_OTHERS,
        actorUserId: input.userId,
        targetType: 'auth_session',
        requestId: input.requestId ?? randomUUID(),
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: { revokedCount },
      });
    }

    return { revokedCount };
  }
}
