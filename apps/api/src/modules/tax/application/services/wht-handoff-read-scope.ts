import { NotFoundException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import { branchScopeWhere, isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import { expenseListReadScope } from '../../../expenses/application/expense-list-read-scope';
import { expenseRelatedToUserWhere } from '../../../expenses/infrastructure/prisma-expense.repository';

type HandoffDb = Pick<Prisma.TransactionClient, 'whtCertificateHandoff' | 'expenseRecord'>;

function expenseReadWhere(ctx: RequestContext): Prisma.ExpenseRecordWhereInput {
  const scope = expenseListReadScope(ctx);
  return {
    companyId: ctx.companyId,
    ...branchScopeWhere(ctx.scopes ?? {}),
    ...(scope === null ? { id: { in: [] } } : {}),
    ...(scope === 'own' ? { createdByUserId: ctx.userId } : {}),
    ...(scope === 'related' ? { AND: [expenseRelatedToUserWhere(ctx.userId)] } : {}),
  };
}

export function handoffBranchWhere(ctx: RequestContext): Prisma.WhtCertificateHandoffWhereInput {
  const scope = branchScopeWhere(ctx.scopes ?? {}) as { OR?: { branchId: { in: string[] } | null }[] };
  return { companyId: ctx.companyId, ...(scope.OR ? { OR: scope.OR.map(({ branchId }) => ({ sourceBranchId: branchId })) } : {}) };
}

export function findReadableHandoffExpense(db: HandoffDb, ctx: RequestContext, expenseId: string) {
  return db.expenseRecord.findFirst({
    where: { AND: [expenseReadWhere(ctx), { id: expenseId }] }, select: { id: true },
  });
}

/** Every by-id entry refuses outside scope with the exact same answer as a missing id. */
export async function loadScopedWhtHandoff(db: HandoffDb, ctx: RequestContext, handoffId: string) {
  const row = await db.whtCertificateHandoff.findUnique({ where: { id: handoffId } });
  if (!row || row.companyId !== ctx.companyId || !isBranchInScope(ctx.scopes ?? {}, row.sourceBranchId)) {
    throw new NotFoundException('WHT handoff not found.');
  }
  if (row.sourcePaymentType === 'expense.record') {
    const expense = row.sourcePaymentId && await findReadableHandoffExpense(db, ctx, row.sourcePaymentId);
    if (!expense) throw new NotFoundException('WHT handoff not found.');
  }
  return row;
}

export const nonExpenseHandoffWhere: Prisma.WhtCertificateHandoffWhereInput = {
  OR: [{ sourcePaymentType: null }, { sourcePaymentType: { not: 'expense.record' } }],
};

/** Read only source ids before applying expense ABAC; never truncate before authorization. */
// ponytail: generic source ids need a batch lookup; add a source relation if large lists outgrow it.
export async function handoffReadBoundary(db: HandoffDb, ctx: RequestContext, where: Prisma.WhtCertificateHandoffWhereInput) {
  const sources = await db.whtCertificateHandoff.findMany({
    where: { AND: [where, { sourcePaymentType: 'expense.record' }] }, select: { sourcePaymentId: true },
  });
  const ids = [...new Set(sources.flatMap(row => row.sourcePaymentId ? [row.sourcePaymentId] : []))];
  const expenses = ids.length ? await db.expenseRecord.findMany({
    where: { AND: [expenseReadWhere(ctx), { id: { in: ids } }] },
    select: { id: true, expenseNumber: true, expenseDate: true, status: true, lines: { orderBy: { lineNumber: 'asc' }, select: { description: true } } },
  }) : [];
  return {
    expenses: new Map(expenses.map(expense => [expense.id, expense])),
    where: { AND: [where, { OR: [nonExpenseHandoffWhere,
      { sourcePaymentType: 'expense.record', sourcePaymentId: { in: expenses.map(expense => expense.id) } },
    ] }] } satisfies Prisma.WhtCertificateHandoffWhereInput,
  };
}
