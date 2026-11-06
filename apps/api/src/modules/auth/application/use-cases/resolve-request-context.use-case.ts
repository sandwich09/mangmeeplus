import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import type { AuthProvider, RequestContext } from '../../domain/models/request-context.model';

@Injectable()
export class ResolveRequestContextUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async execute(
    subject: string,
    requestId: string,
    authProvider: AuthProvider,
    companyId?: string,
    allowTermRecovery = false,
  ): Promise<RequestContext> {
    // ponytail: watchdog/dev tokens use sub=userId directly; line tokens use sub=providerUserId
    let userId: string;

    if (authProvider === 'watchdog' || authProvider === 'dev') {
      const user = await this.prisma.client.user.findUnique({ where: { id: subject } });
      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('Unknown identity.');
      }
      userId = subject;
    } else {
      const identity = await this.prisma.client.externalIdentity.findFirst({
        where: { providerUserId: subject, status: 'ACTIVE' },
        include: { user: true },
      });
      if (!identity || identity.user.status !== 'ACTIVE') {
        throw new UnauthorizedException('Unknown identity.');
      }
      userId = identity.userId;
    }

    const resolved = await this.permissionResolver.resolveAccess(userId, companyId, allowTermRecovery);

    return {
      requestId,
      authSubject: subject,
      userId,
      companyId: resolved.companyId,
      membershipId: resolved.membershipId,
      roles: resolved.roles,
      permissions: resolved.permissions,
      availablePermissions: resolved.availablePermissions,
      entitledFeatureKeys: resolved.entitledFeatureKeys,
      ...(resolved.isDemo ? { isDemo: true, demoExpiresAt: resolved.demoExpiresAt } : {}),
      ...(resolved.freeExpenseDrafts ? { freeExpenseDrafts: true } : {}),
      entitlementDeniedPermissions: resolved.entitlementDeniedPermissions,
      scopes: resolved.scopes,
      authProvider,
    };
  }
}
