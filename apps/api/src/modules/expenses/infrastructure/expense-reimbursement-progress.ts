import { claimPaymentDuplicateBlock } from '../../reimbursements/domain/logic/reimbursement.logic';
import { effectivePolicy } from '../../reimbursements/domain/reimbursement.constants';
import type { ExpenseReimbursementProgress } from '@watchdog-bms/contracts';
import type { ExpenseDb } from './prisma-expense.repository';
import { branchScopeWhere } from '../../data-model-core/domain/logic/branch.logic';

/** Personal advances finish through the claim; they must never be confirmed a second time. */
export async function loadExpenseReimbursementProgress(db: ExpenseDb, companyId: string,
  rows: readonly { id: string; branchId: string | null; status: string; sourceReimbursementRequestId?: string | null }[], scopes = {}) {
  const ids = rows.filter(row => !row.sourceReimbursementRequestId && row.status === 'READY_FOR_CONFIRMATION').map(row => row.id);
  const result = new Map<string, ExpenseReimbursementProgress>();
  if (!ids.length) return result;
  const certificates = await db.expenseSubstituteReceiptEvidence.findMany({
    where: { companyId, expenseId: { in: ids }, status: 'ISSUED', fundingSource: 'PERSONAL_ADVANCE', ...branchScopeWhere(scopes) },
    select: { expenseId: true },
  });
  if (!certificates.length) return result;
  for (const certificate of certificates) result.set(certificate.expenseId, { status: 'WAITING_CLAIM' });
  const lines = await db.reimbursementLine.findMany({
    where: { companyId, OR: [...result.keys()].map(id => ({ sourceExpenseSnapshotJson: { path: ['expenseId'], equals: id } })),
      request: { companyId, status: { notIn: ['CANCELLED', 'VOIDED', 'REJECTED'] }, ...branchScopeWhere(scopes) } },
    select: { sourceExpenseSnapshotJson: true, request: { select: { id: true, requestNo: true, status: true, branchId: true, updatedAt: true, approvalPolicySnapshotJson: true, sourceExpenses: { where: { status: { notIn: ['VOIDED', 'REJECTED'] } }, select: { duplicateStatus: true } } } } },
    orderBy: { request: { updatedAt: 'desc' } },
  });
  for (const line of lines) {
    const id = (line.sourceExpenseSnapshotJson as { expenseId?: string } | null)?.expenseId;
    if (!id || result.get(id)?.requestId || !rows.some(row => row.id === id && row.branchId === line.request.branchId)) continue;
    result.set(id, { requestId: line.request.id, requestNo: line.request.requestNo, status: line.request.status, hasConfirmedDuplicate: claimPaymentDuplicateBlock({ approvalPolicySnapshotJson: line.request.approvalPolicySnapshotJson as any, confirmedDuplicateExpenseCount: (line.request.sourceExpenses ?? []).filter(expense => expense.duplicateStatus === 'CONFIRMED_DUPLICATE').length }, effectivePolicy(null)) === 'CONFIRMED' });
  }
  return result;
}
