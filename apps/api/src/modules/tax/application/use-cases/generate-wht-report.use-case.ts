import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { groupWhtEvents, computeWhtTotals } from '../../domain/logic/wht-report.logic';
import type { WhtFormType, WhtReportDto } from '@watchdog-bms/contracts';

@Injectable()
export class GenerateWhtReportUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(companyId: string, formType: WhtFormType, periodKey: string): Promise<WhtReportDto> {
    const period = await this.taxRepo.findPeriod(companyId, formType, periodKey);
    if (!period) throw new Error(`Tax period ${formType}/${periodKey} not found`);

    const events = await this.taxRepo.findEventsByPeriod(companyId, period.id, 'ACTIVE');
    const issues = await this.taxRepo.findIssuesByPeriod(companyId, period.id, { status: 'OPEN' });

    const whtEvents = events.filter(e => e.eventType === 'WHT_PND3' || e.eventType === 'WHT_PND53');
    const groups = groupWhtEvents(whtEvents.map(e => ({
      id: e.id,
      whtFormType: (e.whtFormType as WhtFormType | null) ?? formType,
      payeeSnapshot: e.payeeSnapshot,
      incomeCategoryCode: e.incomeCategoryCode,
      whtRate: e.whtRate,
      grossAmount: e.grossAmount,
      withheldAmount: e.withheldAmount,
      netPaidAmount: e.netPaidAmount,
      certificateNumber: null,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceEventType: e.sourceEventType,
    })));
    const totals = computeWhtTotals(groups, issues.length);

    const reportData = { periodKey, formType, totals, groups };
    const checksum = crypto.createHash('sha256').update(JSON.stringify(reportData)).digest('hex').slice(0, 16);

    await this.taxRepo.prisma.client.taxReportSnapshot.create({
      data: { companyId, taxPeriodId: period.id, formType: formType as any, periodKey, reportJson: reportData as any, checksum },
    });

    return {
      id: period.id, companyId, periodId: period.id, formType, periodKey,
      totalGross: totals.totalGross, totalWithheld: totals.totalWithheld,
      payeeGroupCount: totals.payeeGroupCount, reviewIssueCount: totals.reviewIssueCount,
      checksum, snapshotAt: new Date().toISOString(),
      sourceRefs: whtEvents.map(e => ({ sourceType: e.sourceType, sourceId: e.sourceId, permissionChecked: true as const })),
    };
  }
}
