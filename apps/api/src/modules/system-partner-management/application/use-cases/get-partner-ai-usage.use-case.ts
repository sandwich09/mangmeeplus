import { Injectable } from '@nestjs/common';
import type { PartnerAiUsageDto, PartnerAiUsageMonthDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import {
  bangkokMonthKey,
  previousBangkokMonthKey,
  resolvePlatformAiBudget,
} from '../../../line-ai/application/company-ai-usage-meter';

const MONTH_SELECT = {
  monthKey: true,
  costSatang: true,
  callCount: true,
  inputTokens: true,
  outputTokens: true,
  cacheReadInputTokens: true,
  cacheWriteInputTokens: true,
} as const;

/** Read half of the partner-console AI meter (metering spec §7.7) — system-admin surface only. */
@Injectable()
export class GetPartnerAiUsageUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(companyId: string): Promise<PartnerAiUsageDto> {
    const monthKey = bangkokMonthKey();
    const previousMonthKey = previousBangkokMonthKey();

    const [months, configuration, tagGroups, platform] = await Promise.all([
      this.prisma.client.companyAiMonthlyUsage.findMany({
        where: { companyId, monthKey: { in: [monthKey, previousMonthKey] } },
        select: MONTH_SELECT,
      }),
      this.prisma.client.companyAiConfiguration.findUnique({
        where: { companyId },
        select: { monthlyBudgetSatang: true },
      }),
      this.prisma.client.aiUsageEvent.groupBy({
        by: ['usageTag'],
        where: { companyId, monthKey },
        _sum: { costSatang: true },
        _count: { _all: true },
        orderBy: { _sum: { costSatang: 'desc' } },
        take: 10,
      }),
      // The console must quote what a company actually inherits, which is the platform settings
      // row when one exists — the same value the five enforcement seams compare against.
      resolvePlatformAiBudget(this.prisma, this.config),
    ]);

    const overrideSatang = configuration?.monthlyBudgetSatang ?? null;
    const defaultSatang = platform.monthlyBudgetSatang;
    const month = (key: string): PartnerAiUsageMonthDto | null => months.find((m) => m.monthKey === key) ?? null;

    return {
      current: month(monthKey),
      previous: month(previousMonthKey),
      budget: {
        effectiveSatang: overrideSatang ?? defaultSatang,
        overrideSatang,
        defaultSatang,
        ceilingSatang: platform.ceilingSatang,
      },
      topTags: tagGroups.map((group) => ({
        tag: group.usageTag,
        costSatang: group._sum.costSatang ?? 0,
        calls: group._count._all,
      })),
    };
  }
}
