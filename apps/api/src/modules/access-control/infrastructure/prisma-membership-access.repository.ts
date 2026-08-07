import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { IMembershipAccessPort } from '../domain/ports/membership-access.port';

@Injectable()
export class PrismaMembershipAccessRepository implements IMembershipAccessPort {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveMembership(
    userId: string,
    companyId?: string,
  ): Promise<{ membershipId: string; companyId: string; status: string } | null> {
    const membership = await this.prisma.client.companyMembership.findFirst({
      where: companyId
        ? { userId, companyId, status: 'ACTIVE' }
        : { userId, status: 'ACTIVE' },
      select: { id: true, companyId: true, status: true },
    });

    if (!membership) return null;

    return {
      membershipId: membership.id,
      companyId: membership.companyId,
      status: membership.status,
    };
  }
}
