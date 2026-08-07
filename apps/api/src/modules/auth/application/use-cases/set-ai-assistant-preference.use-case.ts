import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

/**
 * PDPA objection route (M-05 register §3.1): self-service toggle for the LINE AI
 * assistant. Scoped to the caller's own User row; the webhook use-case reads the
 * timestamp and refuses opted-out turns before any model/gateway involvement.
 */
@Injectable()
export class SetAiAssistantPreferenceUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(userId: string, enabled: boolean, requestId?: string): Promise<void> {
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { aiAssistantOptOutAt: enabled ? null : new Date() },
    });
    await this.audit?.log({
      action: AuditAction.AUTH_AI_ASSISTANT_PREFERENCE_UPDATE,
      actorUserId: userId,
      targetType: 'User',
      targetId: userId,
      requestId: requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: { enabled },
    });
  }
}
