import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';

export type AccountSecurityState = {
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  pendingEmail: string | null;
  pendingEmailExpiresAt: string | null;
  /** PDPA objection route (M-05 §3.1): set = LINE AI assistant opted out for this user. */
  aiAssistantOptOutAt: string | null;
  /** Self-service LINE link: an ACTIVE LINE identity exists for this user. */
  lineLinked: boolean;
  lineLinkedAt: string | null;
};

@Injectable()
export class GetAccountSecurityStateUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<AccountSecurityState> {
    const now = new Date();
    const [user, pendingToken, lineIdentity] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { id: userId },
        select: { email: true, emailVerifiedAt: true, aiAssistantOptOutAt: true },
      }),
      this.prisma.client.emailVerificationToken.findFirst({
        where: {
          userId,
          status: 'PENDING',
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        select: { newEmail: true, expiresAt: true },
      }),
      this.prisma.client.externalIdentity.findFirst({
        where: { userId, provider: 'LINE', status: 'ACTIVE' },
        select: { linkedAt: true },
      }),
    ]);

    return {
      email: user?.email ?? null,
      emailVerified: user?.emailVerifiedAt != null,
      emailVerifiedAt: user?.emailVerifiedAt?.toISOString() ?? null,
      pendingEmail: pendingToken?.newEmail ?? null,
      pendingEmailExpiresAt: pendingToken?.expiresAt.toISOString() ?? null,
      aiAssistantOptOutAt: user?.aiAssistantOptOutAt?.toISOString() ?? null,
      lineLinked: lineIdentity != null,
      lineLinkedAt: lineIdentity?.linkedAt.toISOString() ?? null,
    };
  }
}
