import { Injectable } from '@nestjs/common';
import type { CapabilityPackCatalog, CapabilityPackView } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { CAPABILITY_PACKS } from '../../domain/registries/capability-pack.registry';
import { ownerGatedGrantViolation } from '../../domain/logic/employee-access.logic';
import { loadEntitledFeatureKeys } from '../entitlement.helper';

@Injectable()
export class ListCapabilityPacksUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string, granterPermissionKeys: string[], isOwner: boolean): Promise<CapabilityPackCatalog> {
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    const granter = new Set(granterPermissionKeys);

    const views: CapabilityPackView[] = CAPABILITY_PACKS.map((pack) => {
      const locked = !!pack.featureEntitlementKey && !!entitled && !entitled.has(pack.featureEntitlementKey);
      return {
        ...pack,
        locked,
        grantableByCurrentUser: pack.key === 'pack.reimbursement.self'
          ? true
          : ownerGatedGrantViolation(pack.permissionKeys, granter, isOwner) === undefined
            && (isOwner || pack.permissionKeys.every((k) => granter.has(k))),
      };
    });

    const byModule = new Map<string, CapabilityPackView[]>();
    for (const v of views) {
      const list = byModule.get(v.module) ?? [];
      list.push(v);
      byModule.set(v.module, list);
    }
    return { modules: [...byModule.entries()].map(([module, packs]) => ({ module, packs })) };
  }
}
