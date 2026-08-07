import type { TaxEventDto, VatReportLineDto, TaxSourceRef } from '@watchdog-bms/contracts';

function toNum(s: string): number { return parseFloat(s) || 0; }
function d4(v: number): string { return v.toFixed(4); }

export type VatReportTotals = {
  outputVatTotal: string;
  inputVatTotal: string;
  netVatPayable: string;
  reviewNeededTotal: string;
  lineCount: number;
  reviewIssueCount: number;
};

export type VatReportLine = {
  taxEventId: string;
  eventType: TaxEventDto['eventType'];
  eventDate: string;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  taxInvoiceNumber: string | null;
  taxableBase: string;
  taxAmount: string;
  outputTaxCode: TaxEventDto['outputTaxCode'];
  included: boolean;
  reviewNote: string | null;
  sourceRef: TaxSourceRef;
};

export function computeVatTotals(lines: VatReportLine[]): VatReportTotals {
  let outputVat = 0;
  let inputVat = 0;
  let reviewNeeded = 0;
  let reviewIssueCount = 0;

  for (const line of lines) {
    if (line.eventType === 'VAT_REVIEW') {
      reviewNeeded += toNum(line.taxAmount);
      reviewIssueCount++;
      continue;
    }
    if (!line.included) continue;
    if (line.eventType === 'VAT_OUTPUT') outputVat += toNum(line.taxAmount);
    if (line.eventType === 'VAT_INPUT') inputVat += toNum(line.taxAmount);
  }

  return {
    outputVatTotal: d4(outputVat),
    inputVatTotal: d4(inputVat),
    netVatPayable: d4(outputVat - inputVat),
    reviewNeededTotal: d4(reviewNeeded),
    lineCount: lines.filter(l => l.eventType !== 'VAT_REVIEW').length,
    reviewIssueCount,
  };
}

export function buildVatReportLines(
  events: Array<{
    id: string;
    eventType: TaxEventDto['eventType'];
    eventDate: string;
    taxableBase: string;
    taxAmount: string;
    vatMode: string | null;
    outputTaxCode: TaxEventDto['outputTaxCode'];
    taxInvoiceNumber: string | null;
    payeeSnapshot: TaxEventDto['payeeSnapshot'];
    sourceType: string;
    sourceId: string;
    sourceEventType: string | null;
    reviewNote: string | null;
  }>,
): VatReportLine[] {
  return events.map(e => ({
    taxEventId: e.id,
    eventType: e.eventType as TaxEventDto['eventType'],
    eventDate: e.eventDate,
    counterpartyName: e.payeeSnapshot?.name ?? null,
    counterpartyTaxId: e.payeeSnapshot?.taxId ?? null,
    taxInvoiceNumber: e.taxInvoiceNumber,
    taxableBase: e.taxableBase,
    taxAmount: e.taxAmount,
    outputTaxCode: e.outputTaxCode,
    included: e.eventType !== 'VAT_REVIEW' && e.eventType !== 'VAT_EXEMPT',
    reviewNote: e.reviewNote,
    sourceRef: {
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      sourceEventType: e.sourceEventType ?? undefined,
      permissionChecked: true,
    },
  }));
}
