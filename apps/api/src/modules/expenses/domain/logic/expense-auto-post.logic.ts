import type {
  ExpensePaymentStatus,
  ExpensePostingSourceType,
  TaxEvidenceStatus,
} from '@watchdog-bms/contracts';

export type ExpenseAutoPostBlocker =
  | 'NO_ACTIVE_EVIDENCE'
  | 'TAX_EVIDENCE_NEEDS_REVIEW'
  | 'NOT_TAX_EVIDENCE'
  | 'VENDOR_NAME_MISSING';

export function expenseAutoPostBlockers(input: {
  activeEvidenceCount: number;
  taxEvidenceStatus: TaxEvidenceStatus;
  vendorNameSnapshot: string | null;
}): ExpenseAutoPostBlocker[] {
  const blockers: ExpenseAutoPostBlocker[] = [];
  if (input.activeEvidenceCount < 1) blockers.push('NO_ACTIVE_EVIDENCE');
  if (input.taxEvidenceStatus === 'NEEDS_REVIEW') blockers.push('TAX_EVIDENCE_NEEDS_REVIEW');
  if (input.taxEvidenceStatus === 'NOT_TAX_EVIDENCE') blockers.push('NOT_TAX_EVIDENCE');
  if (!input.vendorNameSnapshot?.trim()) blockers.push('VENDOR_NAME_MISSING');
  return blockers;
}

export function nextExpensePostingSource(input: {
  paymentStatus: ExpensePaymentStatus;
  sourceReimbursementRequestId: string | null;
  generatedSourceTypes: ReadonlySet<string>;
}): ExpensePostingSourceType | null {
  if (!input.generatedSourceTypes.has('expense.record')) return 'expense.record';
  if (
    input.paymentStatus === 'PAID'
    && input.sourceReimbursementRequestId === null
    && !input.generatedSourceTypes.has('expense.payment')
  ) return 'expense.payment';
  return null;
}
