import { Injectable } from '@nestjs/common';
import type { PlatformAiBudgetDto } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { resolvePlatformAiBudget } from '../../../line-ai/application/company-ai-usage-meter';

/** Read half of the platform AI budget settings page (metering spec §7.9). */
@Injectable()
export class GetPlatformAiBudgetUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async execute(): Promise<PlatformAiBudgetDto> {
    const settings = await resolvePlatformAiBudget(this.prisma, this.config);
    return {
      monthlyBudgetSatang: settings.monthlyBudgetSatang,
      ceilingSatang: settings.ceilingSatang,
      source: { monthlyBudgetSatang: settings.monthlyBudgetSource, ceilingSatang: settings.ceilingSource },
      envDefaults: {
        monthlyBudgetSatang: this.config.aiMonthlyBudgetSatang,
        ceilingSatang: this.config.aiMonthlyBudgetSatangCeiling,
      },
    };
  }
}
