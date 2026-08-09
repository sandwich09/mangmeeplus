import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';

// Stable code so the web client can name the actual problem instead of a generic 400.
export const PASSWORD_REUSE = {
  code: 'password_reuse',
  message: 'New password must be different from the current password.',
};

@Injectable()
export class ChangePasswordUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(userId: string, currentPassword: string, newPassword: string, currentTokenId: string): Promise<void> {
    const credential = await this.prisma.client.userCredential.findUnique({ where: { userId } });
    if (!credential || credential.status === 'DISABLED' || !verifyPassword(currentPassword, credential.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect.');
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
