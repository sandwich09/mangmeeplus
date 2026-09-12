import { Inject, Injectable } from '@nestjs/common';
import type { IPermissionResolverPort, ResolvedAccess } from '../domain/ports/permission-resolver.port';
import { PERMISSION_RESOLVER_TOKEN } from '../domain/ports/permission-resolver.port';

@Injectable()
export class PermissionResolverService {
  constructor(
    @Inject(PERMISSION_RESOLVER_TOKEN)
    private readonly resolver: IPermissionResolverPort,
  ) {}

  async resolveAccess(userId: string, companyId?: string, allowTermRecovery = false): Promise<ResolvedAccess> {
    return this.resolver.resolveForUser({ userId, companyId, allowTermRecovery });
  }
}
