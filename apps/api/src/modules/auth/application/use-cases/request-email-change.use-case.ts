import { BadRequestException, ConflictException, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { verifyPassword } from '../../domain/logic/password-credential.logic';
import { generateRawToken, hashToken } from '../../domain/logic/secure-token.logic';
import { AUTH_MAILER_TOKEN, type AuthMailerPort } from '../../domain/ports/auth-mailer.port';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { CURRENT_PASSWORD_INCORRECT } from './change-password.use-case';

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
    currentPassword?: string;
    newEmail: string;
    requestId?: string;
  }): Promise<{ email: string; expiresAt: string }> {
    const newEmail = input.newEmail.trim().toLowerCase();
    const user = await this.prisma.client.user.findUnique({
      where: { id: input.userId },
      include: { credential: true },
    });
    const credential = user?.credential;

    if (!user || credential?.status === 'DISABLED') {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    // A LINE-first owner (P10-L §15.4) has no `UserCredential` at all: nothing was ever issued to
    // them, so there is no password to re-prove and the authenticated session is the only evidence
    // they can offer. Demanding one here is what made the recovery email — the whole point of
    // §3.6 progressive profiling — unreachable for exactly the accounts that need it most.
    // The password check stays mandatory the moment a credential exists.
    if (credential && !verifyPassword(input.currentPassword ?? '', credential.passwordHash)) {
      throw new BadRequestException(CURRENT_PASSWORD_INCORRECT);
    }

    if (user.email === newEmail && user.emailVerifiedAt) {
      throw new ConflictException('This email is already verified for your account.');
    }

    const duplicate = await this.prisma.client.user.findFirst({
      where: { email: newEmail, id: { not: input.userId } },
      select: { id: true },
    });
    if (duplicate) {
      // Coded so the caller can offer the §4F account-merge path instead of a dead end. The
      // message is unchanged for callers that only read `message`.
      throw new ConflictException({
        code: 'email_belongs_to_other_account',
        message: 'This email is already being used by another account.',
      });
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
