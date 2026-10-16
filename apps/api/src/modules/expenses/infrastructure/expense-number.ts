import { ConflictException } from '@nestjs/common';
import { civilPeriodKey, utcDateToCivilDate } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaDocumentSequenceRepository } from '../../data-model-core/infrastructure/repositories/prisma-document-sequence.repository';

/** Enabled by default; an explicit opt-out never changes an assigned number. */
export const expenseDraftNumberingEnabled = () => (process.env['EXPENSE_DRAFT_NUMBERING_ENABLED'] ?? 'true') === 'true';

type NumberedExpense = {
  id: string; companyId: string; branchId: string | null; expenseDate: Date;
  expenseNumber: string | null; draftIdempotencyKey?: string | null;
};

export const expenseDraftNumberKey = (key: string) => `expense-draft:${key}`;

/** Caller owns the expense lock/transaction and persists the returned number in that transaction. */
export async function expenseNumberInTransaction(
  tx: Prisma.TransactionClient,
  allocator: PrismaDocumentSequenceRepository,
  expense: NumberedExpense,
  actorUserId: string,
): Promise<string> {
  if (expense.expenseNumber) {
    const existing = await tx.documentNumber.findFirst({ where: {
      companyId: expense.companyId, documentType: 'expense.record', documentNumber: expense.expenseNumber,
    } });
    // Legacy records can predate the registry. Preserve their identity without inventing history.
    if (existing && (existing.status !== 'COMMITTED' || existing.ownerType !== 'expense_record' || existing.ownerId !== expense.id)) {
      throw new ConflictException({ code: 'EXPENSE_NUMBER_OWNER_CONFLICT', message: 'เลขรายจ่ายไม่ตรงกับทะเบียน ให้ผู้ดูแลตรวจสอบ' });
    }
    return expense.expenseNumber;
  }
  const reserved = await allocator.reserveNumberInTransaction(tx, {
    companyId: expense.companyId, branchId: expense.branchId ?? undefined, documentType: 'expense.record',
    periodKey: civilPeriodKey(utcDateToCivilDate(expense.expenseDate)),
    idempotencyKey: expense.draftIdempotencyKey ? expenseDraftNumberKey(expense.draftIdempotencyKey) : `expense:${expense.id}:number`,
    reservedByUserId: actorUserId,
  });
  if (reserved.status === 'COMMITTED' && reserved.ownerType === 'expense_record' && reserved.ownerId === expense.id) return reserved.documentNumber;
  if (reserved.status !== 'RESERVED') throw new ConflictException('EXPENSE_NUMBER_OWNER_CONFLICT');
  await allocator.commitNumberInTransaction(tx, {
    id: reserved.id, companyId: expense.companyId, ownerType: 'expense_record', ownerId: expense.id,
  });
  return reserved.documentNumber;
}

/** Frozen legacy evidence is not silently revised by adding a display reference on draft save. */
export async function canNumberReviewedDraft(tx: Prisma.TransactionClient, expense: NumberedExpense): Promise<boolean> {
  if (expense.expenseNumber || !expenseDraftNumberingEnabled()) return false;
  const evidence = await tx.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId: expense.companyId, expenseId: expense.id }, select: { id: true } });
  if (evidence) return false;
  const claim = await tx.reimbursementLine.findFirst({ where: { companyId: expense.companyId, linkedExpenseId: expense.id }, select: { id: true } });
  return !claim;
}
