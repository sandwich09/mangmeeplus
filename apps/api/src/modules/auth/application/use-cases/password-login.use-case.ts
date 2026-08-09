import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { IssueTokenUseCase, type AuthTokensResult } from './issue-token.use-case';
import { LegalAcceptanceService } from '../legal-acceptance.service';

// ponytail: constant-cost verify — unknown accounts still pay one scrypt so
// response timing cannot reveal whether an identifier exists (user enumeration).
const DUMMY_PASSWORD_HASH = hashPassword('watchdog.timing.equalizer');

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
  ) {}

  // `identifier` matches the login screen field "ชื่อผู้ใช้ หรือ อีเมล": username or email.
  async execute(identifier: string, password: string): Promise<PasswordLoginResult> {
    const trimmed = identifier.trim();
    const user = await this.prisma.client.user.findFirst({
      where: { OR: [{ username: trimmed }, { email: trimmed.toLowerCase() }] },
      include: { credential: true },
    });
    const credential = user?.credential;
    const passwordMatches = verifyPassword(password, credential?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (
      !user
      || user.status !== 'ACTIVE'
      || !credential
      || credential.status === 'DISABLED'
      || !passwordMatches
    ) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    if (credential.expiresAt && credential.expiresAt <= new Date()) {
      throw new ForbiddenException('Temporary password has expired.');
    }

    // An ACTIVE membership in a suspended/disabled/archived company grants no access:
    // PrismaPermissionResolverRepository rejects it on the next request. Select only
    // usable memberships so a token is never issued for access that cannot resolve.
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: { userId: user.id, status: 'ACTIVE', company: { status: 'ACTIVE' } },
      select: {
        id: true,
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

    const isSystemAdmin = membership.roles.some((mr) => mr.role.key === 'SYSTEM_ADMIN');
    const companyId = isSystemAdmin ? null : membership.companyId;
    const legalAcceptance = await this.legalAcceptance.getStatus({
      userId: user.id,
      companyId: membership.companyId,
      membershipId: membership.id,
    });

    const tokens = await this.issueToken.execute(user.id, 'watchdog');
    return {
      ...tokens,
      passwordChangeRequired: credential.mustChangePassword,
      companyId,
      redirectPath: isSystemAdmin ? '/system/partners' : `/companies/${companyId}/dashboard`,
      legalAcceptanceRequired: legalAcceptance.required,
    };
  }
}
