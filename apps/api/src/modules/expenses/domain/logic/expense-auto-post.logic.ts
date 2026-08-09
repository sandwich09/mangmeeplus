import type {
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
  expenseId: string;
  sourceReimbursementRequestId: string | null;
  accrualPosted: boolean;
  pendingPaymentId?: string;
}): { sourceType: ExpensePostingSourceType; sourceId: string } | null {
  if (!input.accrualPosted) return { sourceType: 'expense.record', sourceId: input.expenseId };
  if (input.sourceReimbursementRequestId === null && input.pendingPaymentId) {
    return { sourceType: 'expense.payment', sourceId: input.pendingPaymentId };
  }
  return null;
}
