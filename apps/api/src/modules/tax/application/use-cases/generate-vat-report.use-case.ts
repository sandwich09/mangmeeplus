import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { buildVatReportLines, computeVatTotals } from '../../domain/logic/vat-report.logic';
import type { VatFormType, VatReportDto } from '@watchdog-bms/contracts';

@Injectable()
export class GenerateVatReportUseCase {
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(companyId: string, formType: VatFormType, periodKey: string): Promise<VatReportDto> {
    const period = await this.taxRepo.findPeriod(companyId, formType, periodKey);
    if (!period) throw new Error(`Tax period ${formType}/${periodKey} not found`);

    const events = await this.taxRepo.findEventsByPeriod(companyId, period.id, 'ACTIVE');
    const issues = await this.taxRepo.findIssuesByPeriod(companyId, period.id, { status: 'OPEN' });

    const vatEvents = events.filter(e => ['VAT_OUTPUT', 'VAT_INPUT', 'VAT_EXEMPT', 'VAT_REVIEW'].includes(e.eventType));
    const lines = buildVatReportLines(vatEvents.map(e => ({
      id: e.id,
      eventType: e.eventType as any,
      eventDate: e.eventDate.toISOString().split('T')[0]!,
      taxableBase: e.taxableBase,
      taxAmount: e.taxAmount,
      vatMode: e.vatMode,
      outputTaxCode: e.outputTaxCode,
      taxInvoiceNumber: e.taxInvoiceNumber,
      payeeSnapshot: e.payeeSnapshot,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceEventType: e.sourceEventType,
      reviewNote: e.reviewNote,
    })));

    const totals = computeVatTotals(lines);
    const reportData = { periodKey, formType, totals, lines };
    const checksum = crypto.createHash('sha256').update(JSON.stringify(reportData)).digest('hex').slice(0, 16);

    await this.taxRepo.prisma.client.taxReportSnapshot.create({
      data: { companyId, taxPeriodId: period.id, formType: formType as any, periodKey, reportJson: reportData as any, checksum },
    });

    return {
      id: period.id, companyId, periodId: period.id, formType, periodKey,
      outputVatTotal: totals.outputVatTotal, inputVatTotal: totals.inputVatTotal,
      netVatPayable: totals.netVatPayable, reviewNeededTotal: totals.reviewNeededTotal,
      lineCount: totals.lineCount, reviewIssueCount: issues.length,
      checksum, snapshotAt: new Date().toISOString(),
      sourceRefs: lines.map(l => l.sourceRef),
    };
  }
}
