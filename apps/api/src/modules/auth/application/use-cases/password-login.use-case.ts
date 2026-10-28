import { isFreeExpenseDraftCompany } from '../../../system-partner-management/application/free-expense-access';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { revokeActiveSessions } from '../../domain/logic/session-revocation.logic';
import { hashLineRecoveryPassword } from '../../domain/logic/secure-token.logic';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';
import { LegalAcceptanceService } from '../legal-acceptance.service';
import { PlatformAccessService } from '../platform-access.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';

// ponytail: constant-cost verify — unknown accounts still pay one scrypt so
// response timing cannot reveal whether an identifier exists (user enumeration).
const DUMMY_PASSWORD_HASH = hashPassword('watchdog.timing.equalizer');
const RECOVERY_CREDENTIAL_TTL_MS = 30 * 60 * 1000;
// generateRawToken(9) is exactly 12 base64url characters. The parked email-reset
// flow uses a 43-character token in the same table and must never become a login password.
const RECOVERY_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{12}$/;

export type PasswordLoginResult = AuthTokensResult & {
  passwordChangeRequired: boolean;
  companyId: string | null;
  redirectPath: string;
  legalAcceptanceRequired: boolean;
};

@Injectable()
export class PasswordLoginUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issueToken: IssueTokenUseCase,
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly platformAccess?: PlatformAccessService,
  ) {}

  // `identifier` matches the login screen field "ชื่อผู้ใช้ หรือ อีเมล": username or email.
  async execute(identifier: string, password: string): Promise<PasswordLoginResult> {
    const trimmed = identifier.trim();
    const user = await this.prisma.client.user.findFirst({
      where: { OR: [{ username: trimmed }, { email: trimmed.toLowerCase() }] },
      include: { credential: true },
    });
    // For recovery-shaped input, perform this lookup for both known and unknown users so
    // the fallback does not reintroduce identifier enumeration through query count.
    const recoveryToken = RECOVERY_PASSWORD_PATTERN.test(password)
      ? await this.prisma.client.passwordResetToken?.findUnique({
        where: { tokenHash: hashLineRecoveryPassword(password, user?.credential?.passwordHash ?? DUMMY_PASSWORD_HASH) },
      }) ?? null
      : null;
    const credential = user?.credential;
    const passwordMatches = verifyPassword(password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);
    const recoveryMatches = !!(
      user
      && recoveryToken
      && recoveryToken.userId === user.id
      && recoveryToken.status === 'PENDING'
      && recoveryToken.expiresAt > new Date()
    );

    if (
      !user
      || user.status !== 'ACTIVE'
      || !credential
      || credential.status === 'DISABLED'
      || (!passwordMatches && !recoveryMatches)
    ) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    if (passwordMatches && credential.expiresAt && credential.expiresAt <= new Date()) {
      throw new ForbiddenException('Temporary password has expired.');
    }

    // Prefer usable companies, then allow a term-only hold into authenticated recovery.
    // Admin/security holds remain excluded; a recovery login grants no business access.
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        id: true,
        companyId: true,
        company: { select: { planTerm: { select: { tierKey: true } } } },
        roles: { select: { role: { select: { key: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }) ?? await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'DISABLED', planTerm: { termDisabledAt: { not: null } } } },
      select: { id: true, companyId: true, company: { select: { planTerm: { select: { tierKey: true } } } }, roles: { select: { role: { select: { key: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) {
      const disabledMembership = await this.prisma.client.companyMembership.findFirst({ where: { userId: user.id, status: { in: ['DISABLED', 'SUSPENDED'] }, company: { status: 'ACTIVE' } }, select: { id: true } });
      if (disabledMembership) throw new ForbiddenException({ code: 'company_membership_disabled', message: 'Shop membership is disabled.' });
      throw new ForbiddenException({
        code: 'company_access_unavailable',
        message: 'This account has no active company access. Contact your administrator.',
      });
    }

    const isSystemAdmin = membership.roles.some((mr) => mr.role.key === 'SYSTEM_ADMIN');
    const platformAccess = await this.platformAccess?.getStatus();
    if (platformAccess?.effectiveState === 'CLOSED' && !isSystemAdmin) {
      throw new ForbiddenException({
        code: 'platform_access_closed',
        message: 'MangmeePlus is not open for customer sign-in yet.',
      });
    }
    const companyId = isSystemAdmin ? null : membership.companyId;
    const freeExpenseDrafts = !isSystemAdmin && membership.company?.planTerm?.tierKey === 'FREE_TRIAL_15'
      && await isFreeExpenseDraftCompany(this.prisma.client, membership.companyId);
    const legalAcceptance = await this.legalAcceptance.getStatus({
      userId: user.id,
      companyId: membership.companyId,
      membershipId: membership.id,
    });

    let credentialUpdatedAt = credential.updatedAt;
    let passwordChangeRequired = credential.mustChangePassword;

    if (!passwordMatches && recoveryToken) {
      const usedAt = new Date();
      const recoveryExpiresAt = new Date(usedAt.getTime() + RECOVERY_CREDENTIAL_TTL_MS);
      const recoveryPasswordHash = hashPassword(password);

      credentialUpdatedAt = await this.prisma.client.$transaction(async (tx) => {
        // Same lock order as request/issuance. A stale login must never overwrite
        // a password changed or disabled while its access checks were running.
        await tx.$queryRaw`SELECT "id" FROM "UserCredential" WHERE "userId" = ${user.id} FOR UPDATE`;
        const currentCredential = await tx.userCredential.findUnique({ where: { userId: user.id } });
        if (!currentCredential || currentCredential.status === 'DISABLED'
          || currentCredential.passwordHash !== credential.passwordHash
          || currentCredential.updatedAt.getTime() !== credential.updatedAt.getTime()) {
          throw new UnauthorizedException('Invalid username or password.');
        }
        const claim = await tx.passwordResetToken.updateMany({
          where: {
            id: recoveryToken.id,
            userId: user.id,
            status: 'PENDING',
            expiresAt: { gt: usedAt },
          },
          data: { status: 'USED', usedAt },
        });
        if (claim.count !== 1) throw new UnauthorizedException('Invalid username or password.');

        const updatedCredential = await tx.userCredential.update({
          where: { userId: user.id },
          data: {
            passwordHash: recoveryPasswordHash,
            status: 'TEMPORARY',
            mustChangePassword: true,
            expiresAt: recoveryExpiresAt,
            tempPasswordEncrypted: null,
          },
          select: { updatedAt: true },
        });
        const revokedSessionCount = await revokeActiveSessions(tx.authSession, { userId: user.id, now: usedAt });

        await tx.auditLog.create({
          data: {
            companyId,
            actorUserId: user.id,
            action: AuditAction.AUTH_PASSWORD_RESET_CONFIRM,
            targetType: 'PasswordResetToken',
            targetId: recoveryToken.id,
            requestId: recoveryToken.id,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: { revokedSessionCount },
          },
        });

        return updatedCredential.updatedAt;
      });
      passwordChangeRequired = true;
    }

    const tokens = await this.issueToken.execute(user.id, 'watchdog', credentialUpdatedAt);
    return {
      ...tokens,
      passwordChangeRequired,
      companyId,
      redirectPath: isSystemAdmin ? '/system/partners' : `/companies/${companyId}/${freeExpenseDrafts ? 'expenses' : 'dashboard'}`,
      legalAcceptanceRequired: legalAcceptance.required,
    };
  }
}
