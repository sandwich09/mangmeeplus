import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../domain/ports/auth-mailer.port';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_MESSAGE = 'If the account is eligible, a password reset link has been sent.';

@Injectable()
export class RequestPasswordResetUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_MAILER_TOKEN) private readonly mailer: AuthMailerPort,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { identifier: string; requestId?: string }): Promise<{ message: string }> {
    const identifier = input.identifier.trim();
    const normalizedEmail = identifier.toLowerCase();
    const user = await this.prisma.client.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { username: identifier }],
      },
      include: { credential: true },
    });

    const eligible = !!(
      user
      && user.status === 'ACTIVE'
      && user.email
      && user.emailVerifiedAt
      && user.credential
      && user.credential.status !== 'DISABLED'
    );

    if (!user) {
      return { message: GENERIC_MESSAGE };
    }

    if (!eligible) {
      void this.audit?.log({
        action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
        actorUserId: user.id,
        targetType: 'User',
        targetId: user.id,
        requestId: input.requestId ?? 'system',
        result: 'DENIED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason: 'ineligible_account' },
      });
      return { message: GENERIC_MESSAGE };
    }

    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
    });

    void this.mailer.sendPasswordResetLink({
      toEmail: user.email!,
      rawToken,
      expiresAt,
    }).catch(() => undefined);

    void this.audit?.log({
      action: AuditAction.AUTH_PASSWORD_RESET_REQUEST,
      actorUserId: user.id,
      targetType: 'User',
      targetId: user.id,
      requestId: input.requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { email: user.email },
    });

    return { message: GENERIC_MESSAGE };
  }
}
