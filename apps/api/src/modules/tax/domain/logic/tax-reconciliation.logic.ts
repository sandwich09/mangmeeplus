import Decimal from 'decimal.js';
import type { TaxReconciliationIssueCode, TaxReportContribution, TaxReportForm, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';

export type TaxReconciliationFact = {
  componentKey: TransactionTaxComponentPreview['componentKey'];
  externalTaxCode: string | null;
  evidenceStatus: string | null;
  accountAssignmentsPresent: boolean;
  reportMappingPresent: boolean;
  sourceBaseAmount: string;
  sourceTaxAmount: string;
  eventBaseAmount: string;
  eventTaxAmount: string;
  journalTaxAmount: string;
  reportAmount: string;
  taxAmountTolerance?: string;
};

export type TaxReconciliationFactIdentity = {
  sourceType: string;
  sourceId: string;
  sourceLineKey: string;
  componentKey: TransactionTaxComponentPreview['componentKey'];
};

const money = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

export function reconciliationFactKey(fact: TaxReconciliationFactIdentity): string {
  return [fact.sourceType, fact.sourceId, fact.sourceLineKey, fact.componentKey].join('|');
}

export function unionReconciliationFacts(...groups: TaxReconciliationFactIdentity[][]): TaxReconciliationFactIdentity[] {
  const facts = new Map<string, TaxReconciliationFactIdentity>();
  for (const group of groups) for (const fact of group) facts.set(reconciliationFactKey(fact), fact);
  return [...facts.values()].sort((a, b) => reconciliationFactKey(a).localeCompare(reconciliationFactKey(b)));
}

export function primaryTaxReportAmount(contributions: TaxReportContribution[], taxAmount: string): string {
  const sources = new Decimal(taxAmount).isZero() ? ['TAX_BASE'] : ['TAX_AMOUNT', 'DUTY', 'OTHER'];
  const candidates = contributions.filter((entry) => sources.includes(entry.amountSource));
  const preferred = new Decimal(taxAmount).isZero()
    ? candidates.filter((entry) => entry.boxKey !== 'box_1_total_sales')
    : candidates;
  const selected = (preferred.length ? preferred : candidates).reduce<TaxReportContribution | null>((best, entry) => (
    !best || new Decimal(entry.amount).abs().gt(new Decimal(best.amount).abs()) ? entry : best
  ), null);
  return money(selected?.amount ?? 0);
}

export function taxComponentInForm(componentKey: string, formType: TaxReportForm): boolean {
  if (formType === 'PP36') return componentKey === 'PP36_OUTPUT';
  if (formType === 'PP30') return ['VAT', 'IMPORT_VAT', 'PP36_INPUT'].includes(componentKey);
  if (formType === 'CUSTOMS_SUPPORT') return ['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'].includes(componentKey);
  return true;
}

export function reconcileTaxFact(fact: TaxReconciliationFact): {
  sourceEventDelta: string;
  eventJournalDelta: string;
  eventReportDelta: string;
  issueCode: TaxReconciliationIssueCode;
  blocking: boolean;
} {
  const sourceBase = new Decimal(fact.sourceBaseAmount);
  const sourceTax = new Decimal(fact.sourceTaxAmount);
  const eventBase = new Decimal(fact.eventBaseAmount);
  const eventTax = new Decimal(fact.eventTaxAmount);
  const journalTax = new Decimal(fact.journalTaxAmount);
  const report = new Decimal(fact.reportAmount);
  const zeroTaxClassification = sourceTax.isZero() && eventTax.isZero();
  const sourceEvent = zeroTaxClassification ? sourceBase.minus(eventBase) : sourceTax.minus(eventTax);
  const eventJournal = eventTax.minus(journalTax);
  const eventReport = zeroTaxClassification ? eventBase.minus(report) : eventTax.minus(report);
  const tolerance = new Decimal(fact.taxAmountTolerance ?? '0.01');
  if (!tolerance.isFinite() || tolerance.isNegative()) throw new Error('invalid_tax_amount_tolerance');
  let issueCode: TaxReconciliationIssueCode = 'MATCHED';
  const codeRequired = ['VAT', 'IMPORT_VAT', 'PP36_OUTPUT', 'PP36_INPUT'].includes(fact.componentKey);
  if (codeRequired && !fact.externalTaxCode) issueCode = 'MISSING_TAX_CODE';
  else if (fact.evidenceStatus === 'REVIEW_REQUIRED' || fact.evidenceStatus === 'REJECTED') issueCode = 'EVIDENCE_PENDING';
  else if (!fact.accountAssignmentsPresent && !eventTax.isZero()) issueCode = 'MISSING_ACCOUNT_RULE';
  else if (!fact.reportMappingPresent) issueCode = 'MISSING_REPORT_RULE';
  else if (!sourceEvent.abs().lte(tolerance)) issueCode = 'SOURCE_EVENT_MISMATCH';
  else if (!eventJournal.abs().lte(tolerance)) issueCode = 'EVENT_JOURNAL_MISMATCH';
  else if (!eventReport.abs().lte(tolerance)) issueCode = 'REPORT_MISMATCH';
  return {
    sourceEventDelta: money(sourceEvent), eventJournalDelta: money(eventJournal), eventReportDelta: money(eventReport),
    issueCode, blocking: issueCode !== 'MATCHED',
  };
}
