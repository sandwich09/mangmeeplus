import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { LineContextHealth, PaginatedPartnersDto, PartnerCompanySummaryDto } from '@watchdog-bms/contracts';

export type ListPartnersQuery = {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class ListPartnersUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListPartnersQuery): Promise<PaginatedPartnersDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (query.q !== undefined && typeof query.q !== 'string') throw new UnprocessableEntityException('คำค้นบริษัทไม่ถูกต้อง');
    const q = (query.q ?? '').trim();
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new UnprocessableEntityException('หน้ารายการหรือจำนวนรายการต่อหน้าไม่ถูกต้อง');
    }
    if (q.length > 120 || (query.status && !['ACTIVE', 'DISABLED', 'ARCHIVED', 'SUSPENDED'].includes(query.status))) {
      throw new UnprocessableEntityException('คำค้นหรือสถานะบริษัทไม่ถูกต้อง');
    }
    const skip = (page - 1) * pageSize;
    if (!Number.isSafeInteger(skip) || skip > 2_147_483_647) throw new UnprocessableEntityException('หน้ารายการไม่ถูกต้อง');

    const where: Prisma.CompanyWhereInput = {
      ...(query.status ? { status: query.status as 'ACTIVE' | 'DISABLED' | 'ARCHIVED' | 'SUSPENDED' } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { registeredName: { contains: q, mode: 'insensitive' as const } },
        { id: q },
      ] } : {}),
    };

    // ponytail: explicit select — never touch business tables
    const [companies, total] = await Promise.all([
      this.prisma.client.company.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          registeredName: true,
          timezone: true,
          locale: true,
          status: true,
          createdAt: true,
          activatedAt: true,
          disabledAt: true,
          archivedAt: true,
          featureEntitlements: {
            where: { enabled: true },
            select: { featureKey: true },
          },
          aiConfiguration: { select: { modelId: true } },
          memberships: {
            where: { status: 'ACTIVE' },
            select: {
              user: {
                select: {
                  externalIdentities: {
                    where: { provider: 'LINE', status: 'ACTIVE' },
                    select: { id: true },
                    take: 1,
                  },
                },
              },
            },
            take: 50, // cap for list performance
          },
        },
      }),
      this.prisma.client.company.count({ where }),
    ]);

    const items: PartnerCompanySummaryDto[] = companies.map((c) => {
      const hasLinkedUser = c.memberships.some((m) => m.user.externalIdentities.length > 0);
      const lineContextHealth: LineContextHealth = hasLinkedUser ? 'LINKED' : 'UNLINKED';

      return {
        id: c.id,
        name: c.name,
        registeredName: c.registeredName ?? undefined,
        timezone: c.timezone,
        locale: c.locale,
        status: c.status as PartnerCompanySummaryDto['status'],
        createdAt: c.createdAt.toISOString(),
        activatedAt: c.activatedAt?.toISOString(),
        disabledAt: c.disabledAt?.toISOString(),
        archivedAt: c.archivedAt?.toISOString(),
        enabledFeatureKeys: c.featureEntitlements.map((f) => f.featureKey),
        // A budget-only row leaves modelId null (spec §6.8); the summary means "no model configured".
        configuredModelId: c.aiConfiguration?.modelId ?? undefined,
        lineContextHealth,
      };
    });

    return { items, total, page, pageSize };
  }
}
