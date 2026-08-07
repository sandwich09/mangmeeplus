import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestContext, TaxFormType, TaxType } from '@watchdog-bms/contracts';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';

export type TaxSummaryRow = {
  taxType: TaxType;
  formType: TaxFormType;
  periodKey: string;
  status: string;
  dueDate: string | null;
  activeEventCount: number;
  reviewIssueCount: number;
  openIssueCount: number;
  taxableBase: string;
  taxAmount: string;
};

function currentPeriodKey(): string {
  return civilPeriodKey(todayCivilDate());
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class GetTaxSummaryUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: RequestContext, periodKey = currentPeriodKey()): Promise<{ periodKey: string; rows: TaxSummaryRow[]; totalTaxAmount: string; openIssueCount: number }> {
    if (!ctx.permissions.includes('tax.report.read')) throw new ForbiddenException('Missing permission: tax.report.read');

    const periods = await this.taxRepo.findPeriods(ctx.companyId, { periodKey, page: 1, pageSize: 100 });
    const rows: TaxSummaryRow[] = [];
    let totalTaxAmount = 0;
    let totalOpenIssues = 0;

    for (const period of periods.items) {
      const [events, issues] = await Promise.all([
        this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE'),
        this.taxRepo.findIssuesByPeriod(ctx.companyId, period.id),
      ]);
      const taxableBase = events.reduce((sum, event) => sum + money(event.taxableBase), 0);
      const taxAmount = events.reduce((sum, event) => {
        if (event.eventType === 'VAT_INPUT') return sum - money(event.taxAmount);
        if (event.eventType === 'WHT_PND3' || event.eventType === 'WHT_PND53') return sum + money(event.withheldAmount ?? event.taxAmount);
        return sum + money(event.taxAmount);
      }, 0);
      const openIssueCount = issues.filter((issue) => issue.status === 'OPEN').length;
      totalTaxAmount += taxAmount;
      totalOpenIssues += openIssueCount;
      rows.push({
        taxType: period.taxType,
        formType: period.formType,
        periodKey: period.periodKey,
        status: period.status,
        dueDate: period.dueDate ? period.dueDate.toISOString() : null,
        activeEventCount: events.length,
        reviewIssueCount: issues.length,
        openIssueCount,
        taxableBase: taxableBase.toFixed(4),
        taxAmount: taxAmount.toFixed(4),
      });
    }

    return { periodKey, rows, totalTaxAmount: totalTaxAmount.toFixed(4), openIssueCount: totalOpenIssues };
  }
}
