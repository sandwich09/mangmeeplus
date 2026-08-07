import { ConflictException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { verifyPassword } from '../../domain/logic/password-credential.logic';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../domain/ports/auth-mailer.port';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class RequestEmailChangeUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH_MAILER_TOKEN) private readonly mailer: AuthMailerPort,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: {
    userId: string;
    currentPassword: string;
    newEmail: string;
    requestId?: string;
  }): Promise<{ email: string; expiresAt: string }> {
    const newEmail = input.newEmail.trim().toLowerCase();
    const user = await this.prisma.client.user.findUnique({
      where: { id: input.userId },
      include: { credential: true },
    });
    const credential = user?.credential;

    if (!user || !credential || credential.status === 'DISABLED' || !verifyPassword(input.currentPassword, credential.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    if (user.email === newEmail && user.emailVerifiedAt) {
      throw new ConflictException('This email is already verified for your account.');
    }

    const duplicate = await this.prisma.client.user.findFirst({
      where: { email: newEmail, id: { not: input.userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('This email is already being used by another account.');
    }

    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: input.userId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: input.userId,
          newEmail,
          tokenHash: hashToken(rawToken),
          expiresAt,
        },
      });
    });

    await this.mailer.sendEmailVerification({ toEmail: newEmail, rawToken, expiresAt });
    await this.audit?.log({
      action: AuditAction.AUTH_EMAIL_CHANGE_REQUEST,
      actorUserId: input.userId,
      targetType: 'User',
      targetId: input.userId,
      requestId: input.requestId ?? 'system',
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: { email: newEmail },
    });

    return { email: newEmail, expiresAt: expiresAt.toISOString() };
  }
}
