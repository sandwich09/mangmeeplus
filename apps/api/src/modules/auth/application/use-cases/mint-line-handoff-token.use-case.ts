import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { generateLineHandoffToken, isSafeHandoffPath } from '../../domain/logic/line-handoff.logic';

export type MintLineHandoffTokenInput = {
  userId: string;
  companyId: string;
  lineUserId: string;
  /** Which sender minted it (`line_ai_reply`, `notification_push`, …) — audit and adoption only. */
  surface: string;
  targetPath: string;
};

export type MintLineHandoffTokenResult = { rawToken: string; expiresAt: Date };

/**
 * P12-3b step 1 (spec §11 "Minting seam"): turn a destination the server has already decided to
 * send into a single-use proof of WHO it is being sent to.
 *
 * Minting requires no user-facing permission — it is a side effect of a message the per-surface
 * checks have already authorised — and it grants none: the exchange re-resolves everything.
 *
 * An unsafe path throws rather than silently trimming, because the only honest fallback is the
 * plain link the caller would have sent anyway; the delivery seam catches this and keeps it.
 */
@Injectable()
export class MintLineHandoffTokenUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: MintLineHandoffTokenInput): Promise<MintLineHandoffTokenResult> {
    if (!isSafeHandoffPath(input.targetPath, input.companyId)) {
      throw new BadRequestException('Handoff target path is outside the company tenant root.');
    }

    const { rawToken, tokenHash, expiresAt } = generateLineHandoffToken();
    await this.prisma.client.lineWebHandoffToken.create({
      // Hash only. The raw token exists solely in the message about to be sent.
      data: {
        tokenHash,
        userId: input.userId,
        companyId: input.companyId,
        lineUserId: input.lineUserId,
        targetPath: input.targetPath,
        surface: input.surface,
        expiresAt,
      },
    });

    void this.audit?.log({
      action: AuditAction.AUTH_LINE_HANDOFF_ISSUE,
      actorUserId: input.userId,
      companyId: input.companyId,
      targetType: 'line_web_handoff_token',
      requestId: randomUUID(),
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      // `targetPath` is a route, not business data; the token itself is never audited.
      metadataJson: { surface: input.surface, companyId: input.companyId, targetPath: input.targetPath },
    });

    return { rawToken, expiresAt };
  }
}
