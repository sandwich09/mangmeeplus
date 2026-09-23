import { lockAccountEmail } from '../account-email-state';
import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';

// Stable code so the web client can name the actual problem instead of a generic 400.
export const PASSWORD_REUSE = {
  code: 'password_reuse',
  message: 'New password must be different from the current password.',
};

// Reauthentication input failure, not a session 401 that clients should refresh.
export const CURRENT_PASSWORD_INCORRECT = {
  code: 'current_password_incorrect',
  message: 'Current password is incorrect.',
};

export const CURRENT_PASSWORD_REQUIRED = {
  code: 'current_password_required',
  message: 'Current password is required for this password change.',
};

export function canSkipCurrentPassword(input: {
  credential: { mustChangePassword: boolean; updatedAt: Date } | null;
  passwordCredentialVersion: Date | null | undefined;
}): boolean {
  return Boolean(
    input.credential?.mustChangePassword
    && input.passwordCredentialVersion
    && input.credential.updatedAt.getTime() === input.passwordCredentialVersion.getTime(),
  );
}

@Injectable()
export class ChangePasswordUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
    currentTokenId: string,
    sessionId?: string,
  ): Promise<void> {
    const credential = await this.prisma.client.userCredential.findUnique({ where: { userId } });
    if (!credential || credential.status === 'DISABLED') {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    if (currentPassword && !verifyPassword(currentPassword, credential.passwordHash)) {
      throw new BadRequestException(CURRENT_PASSWORD_INCORRECT);
    }

    if (credential.expiresAt && credential.expiresAt <= new Date()) {
      throw new ForbiddenException('Temporary password has expired.');
    }

    // Re-submitting the temporary password as the "new" one used to succeed and clear
    // mustChangePassword, leaving the account on a password the employer issued — an
    // employee's date of birth is already 8 characters, so length alone let it through.
    if (verifyPassword(newPassword, credential.passwordHash)) {
      throw new BadRequestException(PASSWORD_REUSE);
    }

    await this.prisma.client.$transaction(async (tx) => {
      await lockAccountEmail(tx, userId);
      const current = await tx.userCredential.findUnique({ where: { userId } });
      if (!current || current.passwordHash !== credential.passwordHash || current.status === 'DISABLED' ||
          (current.expiresAt && current.expiresAt <= new Date())) throw new BadRequestException(CURRENT_PASSWORD_INCORRECT);
      if (!currentPassword) {
        const session = sessionId
          ? await tx.authSession.findUnique({
            where: { id: sessionId },
            select: { userId: true, passwordCredentialVersion: true },
          })
          : null;
        if (session?.userId !== userId || !canSkipCurrentPassword({
          credential: current,
          passwordCredentialVersion: session?.passwordCredentialVersion,
        })) throw new BadRequestException(CURRENT_PASSWORD_REQUIRED);
      }
      await tx.emailVerificationToken.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.user.update({ where: { id: userId }, data: { emailRevision: { increment: 1 } } });
      await tx.userCredential.update({
        where: { userId },
        data: {
          passwordHash: hashPassword(newPassword),
          status: 'ACTIVE',
          mustChangePassword: false,
          expiresAt: null,
          // User-chosen password: drop the revealable system-generated copy.
          tempPasswordEncrypted: null,
        },
      });
      await revokeActiveSessions(tx.authSession, { userId, exceptTokenId: currentTokenId });
    });
  }
}
