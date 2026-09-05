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
  /** P10-L §3.6 "กันหลุด" contact number, held on the user, not an OTP factor. */
  phoneNumber: string | null;
  /**
   * The other half of what `PasswordLoginUseCase` looks accounts up by. A LINE-first account has
   * neither this nor a verified email, which is why setting a first password must collect one.
   */
  username: string | null;
  /**
   * Whether a `UserCredential` exists at all. A LINE-first account has none, which is what
   * decides between "set a backup password" and "change your password" — not `mustChangePassword`.
   */
  hasPassword: boolean;
};

@Injectable()
export class GetAccountSecurityStateUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string): Promise<AccountSecurityState> {
    const now = new Date();
    const [user, pendingToken, lineIdentity] = await Promise.all([
      this.prisma.client.user.findUnique({
        where: { id: userId },
        select: {
          email: true, emailVerifiedAt: true, aiAssistantOptOutAt: true, phoneNumber: true, username: true,
          credential: { select: { id: true } },
        },
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
      phoneNumber: user?.phoneNumber ?? null,
      username: user?.username ?? null,
      hasPassword: user?.credential != null,
    };
  }
}
