import { Injectable } from '@nestjs/common';
import type { CitCalendarEntryDto } from '@watchdog-bms/contracts';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

@Injectable()
export class GetCitCalendarUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(companyId: string): Promise<CitCalendarEntryDto[]> {
    const { items } = await this.taxRepo.findPeriods(companyId, { taxType: 'CIT', pageSize: 50 });
    return Promise.all(items.map(async (period) => {
      const summary = await this.taxRepo.prisma.client.citLedgerSummary.findUnique({
        where: { companyId_taxPeriodId: { companyId, taxPeriodId: period.id } },
      });
      return {
        formType: period.formType as 'PND50' | 'PND51',
        periodKey: period.periodKey,
        accountingPeriodId: summary?.accountingPeriodId ?? null,
        dueDate: period.dueDate?.toISOString() ?? null,
        onlineExtensionDueDate: null,
        status: period.status,
        hasLedgerSummary: Boolean(summary && !summary.missingLedger),
      };
    }));
  }
}
