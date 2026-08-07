import { Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyAccessMatrix, EffectiveAccessView } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { highRiskCount, summarizeCapabilities, toEffectivePermissions } from '../../domain/logic/capability.logic';

const MEMBERSHIP_SELECT = {
  id: true,
  employeeAccessProfile: { select: { displayName: true } },
  user: { select: { displayName: true } },
  roles: {
    select: {
      role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  },
} as const;

type MembershipRow = {
  id: string;
  employeeAccessProfile: { displayName: string } | null;
  user: { displayName: string };
  roles: Array<{ role: { key: string; permissions: Array<{ permission: { key: string } }> } }>;
};

function collect(m: MembershipRow): { roleKeys: string[]; permissionKeys: string[] } {
  const keys = new Set<string>();
  const roleKeys: string[] = [];
  for (const mr of m.roles) {
    roleKeys.push(mr.role.key);
    for (const rp of mr.role.permissions) keys.add(rp.permission.key);
  }
  return { roleKeys, permissionKeys: [...keys] };
}

@Injectable()
export class GetEffectiveAccessUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async matrix(companyId: string): Promise<CompanyAccessMatrix> {
    const memberships = (await this.prisma.client.companyMembership.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: MEMBERSHIP_SELECT,
    })) as MembershipRow[];

    const rows = memberships.map((m) => {
      const { roleKeys, permissionKeys } = collect(m);
      return {
        membershipId: m.id,
        displayName: m.employeeAccessProfile?.displayName ?? m.user.displayName,
        roleKeys,
        capabilitySummary: summarizeCapabilities(permissionKeys).map((c) => c.nameTh),
        highRiskCount: highRiskCount(permissionKeys),
      };
    });
    return { rows, total: rows.length };
  }

  async forMembership(companyId: string, membershipId: string): Promise<EffectiveAccessView> {
    const m = (await this.prisma.client.companyMembership.findFirst({
      where: { id: membershipId, companyId },
      select: MEMBERSHIP_SELECT,
    })) as MembershipRow | null;
    if (!m) throw new NotFoundException('Membership not found');

    const { roleKeys, permissionKeys } = collect(m);
    return {
      membershipId: m.id,
      displayName: m.employeeAccessProfile?.displayName ?? m.user.displayName,
      roleKeys,
      capabilities: summarizeCapabilities(permissionKeys),
      permissions: toEffectivePermissions(permissionKeys),
      permissionCount: permissionKeys.length,
    };
  }
}
