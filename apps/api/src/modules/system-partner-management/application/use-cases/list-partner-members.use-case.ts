import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { PartnerMembersDto } from '@watchdog-bms/contracts';

@Injectable()
export class ListPartnerMembersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(companyId: string): Promise<PartnerMembersDto> {
    const company = await this.prisma.client.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException(`Partner company "${companyId}" not found.`);

    const memberships = await this.prisma.client.companyMembership.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: {
        status: true,
        roles: { select: { role: { select: { key: true } } } },
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            email: true,
            phoneNumber: true,
            externalIdentities: {
              where: { provider: 'LINE', status: 'ACTIVE' },
              select: { id: true },
            },
            // hasTempPassword only — the encrypted blob never leaves the API
            credential: {
              select: { status: true, mustChangePassword: true, expiresAt: true, tempPasswordEncrypted: true },
            },
          },
        },
      },
    });

    return {
      items: memberships.map((m) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        username: m.user.username ?? undefined,
        email: m.user.email ?? undefined,
        phoneNumber: m.user.phoneNumber ?? undefined,
        membershipStatus: m.status as PartnerMembersDto['items'][number]['membershipStatus'],
        roles: m.roles.map((r) => r.role.key),
        lineLinked: m.user.externalIdentities.length > 0,
        credential: m.user.credential
          ? {
              status: m.user.credential.status as 'ACTIVE' | 'TEMPORARY' | 'DISABLED',
              mustChangePassword: m.user.credential.mustChangePassword,
              expiresAt: m.user.credential.expiresAt?.toISOString(),
              hasTempPassword: m.user.credential.tempPasswordEncrypted !== null,
            }
          : undefined,
      })),
    };
  }
}
