import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emailDeliveryEnabled } from '../email-delivery.policy';

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
  /**
   * Whether this environment has a mailer at all (spec §15.4.1 C). Production runs
   * `EMAIL_PROVIDER=disabled`, whose adapter is a silent no-op, so without this the profile page
   * says "ส่งลิงก์ยืนยันไปที่อีเมลแล้วค่ะ" over a letter that was never sent.
   */
  emailDeliveryEnabled: boolean;
};

@Injectable()
export class GetAccountSecurityStateUseCase {
  constructor(
    private readonly prisma: PrismaService,
    // @Optional() like `ConfirmEmailVerificationUseCase`: the auth specs construct this by hand.
    @Optional() @Inject(AppConfigService) private readonly config: AppConfigService | null = null,
  ) {}

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
      emailDeliveryEnabled: emailDeliveryEnabled(this.config),
    };
  }
}
