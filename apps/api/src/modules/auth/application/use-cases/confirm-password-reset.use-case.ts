import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { PASSWORD_REUSE } from './change-password.use-case';
import { hashToken } from '../../domain/logic/secure-token.logic';
import { IssueTokenUseCase } from './issue-token.use-case';
import type { PasswordLoginResult } from './password-login.use-case';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

@Injectable()
export class ConfirmPasswordResetUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(input: { token: string; newPassword: string; requestId?: string }): Promise<Omit<PasswordLoginResult, 'legalAcceptanceRequired'>> {
    const tokenHash = hashToken(input.token);
    const now = new Date();
    const token = await this.prisma.client.passwordResetToken.findUnique({ where: { tokenHash } });

    const fail = async (reason: string, actorUserId: string | null = token?.userId ?? null) => {
      await this.audit?.log({
        action: AuditAction.AUTH_PASSWORD_RESET_FAILURE,
        actorUserId: actorUserId ?? undefined,
        targetType: 'PasswordResetToken',
        targetId: token?.id,
        requestId: input.requestId ?? 'system',
        result: 'FAILED',
        riskLevel: 'MEDIUM',
        metadataJson: { reason },
      });
      throw new ForbiddenException('Password reset link is invalid, expired, or already used.');
    };

    if (!token) return fail('token_not_found', null);
    if (token.status !== 'PENDING') return fail('token_not_pending');
    if (token.expiresAt <= now) {
      await this.prisma.client.passwordResetToken.updateMany({
        where: { id: token.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return fail('token_expired');
    }

    const user = await this.prisma.client.user.findUnique({
      where: { id: token.userId },
      include: { credential: true },
    });
    const credential = user?.credential;
    if (!user || user.status !== 'ACTIVE' || !credential || credential.status === 'DISABLED') {
      return fail('user_ineligible', user?.id ?? null);
    }

    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        companyId: true,
        roles: { select: { role: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: 'company_access_unavailable',
        message: 'This account has no active company access. Contact your administrator.',
      });
    }
    const isSystemAdmin = membership.roles.some((entry) => entry.role.key === 'SYSTEM_ADMIN');
    const companyId = isSystemAdmin ? null : membership.companyId;

    // Same rule as the forced change screen: a reset that keeps the password already on the
    // account is not a reset. Checked before the transaction so the token stays usable for a retry.
    if (verifyPassword(input.newPassword, credential.passwordHash)) {
      throw new BadRequestException(PASSWORD_REUSE);
    }

    let revokedSessionCount = 0;
    let credentialUpdatedAt: Date | null = null;
    const usedAt = new Date();
    let claimed = true;

    try {
      await this.prisma.client.$transaction(async (tx) => {
        const claim = await tx.passwordResetToken.updateMany({
          where: { id: token.id, status: 'PENDING' },
          data: { status: 'USED', usedAt },
        });
        if (claim.count !== 1) {
          claimed = false;
          throw new Error('token_already_claimed');
        }

        const revoked = await tx.authSession.updateMany({
          where: { userId: user.id, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: usedAt },
        });
        revokedSessionCount = revoked.count;

        const updatedCredential = await tx.userCredential.update({
          where: { userId: user.id },
          data: {
            passwordHash: hashPassword(input.newPassword),
            status: 'ACTIVE',
            mustChangePassword: false,
            expiresAt: null,
            // User-chosen password: drop the revealable system-generated copy.
            tempPasswordEncrypted: null,
          },
        });
        credentialUpdatedAt = updatedCredential.updatedAt;

        await tx.auditLog.create({
          data: {
            companyId,
            actorUserId: user.id,
            action: AuditAction.AUTH_PASSWORD_RESET_CONFIRM,
            targetType: 'PasswordResetToken',
            targetId: token.id,
            requestId: input.requestId ?? 'system',
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: { revokedSessionCount },
          },
        });
      });
    } catch (error) {
      if (!claimed || (error instanceof Error && error.message === 'token_already_claimed')) {
        return fail('token_already_claimed');
      }
      throw error;
    }

    if (!credentialUpdatedAt) throw new Error('Password reset completed without a credential version.');
    const tokens = await this.issueToken.execute(user.id, 'watchdog', credentialUpdatedAt);
    return {
      ...tokens,
      passwordChangeRequired: false,
      companyId,
      redirectPath: isSystemAdmin ? '/system/partners' : `/companies/${companyId}/dashboard`,
    };
  }
}
