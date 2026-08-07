import { Injectable } from '@nestjs/common';
import type { ChartOfAccountsReadiness } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service.js';
import {
  loadChartReadiness,
  loadChartTemplatePreview,
} from './chart-template-query.service.js';
import type { ChartTemplatePreview } from '../../domain/logic/chart-template.logic.js';

@Injectable()
export class ChartReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  async inspect(companyId: string): Promise<{
    preview: ChartTemplatePreview;
    readiness: ChartOfAccountsReadiness;
  }> {
    const preview = await loadChartTemplatePreview(this.prisma.client as any, companyId);
    const readiness = await loadChartReadiness(this.prisma.client as any, companyId, preview);
    return { preview, readiness };
  }

  async load(companyId: string): Promise<ChartOfAccountsReadiness> {
    return (await this.inspect(companyId)).readiness;
  }
}
