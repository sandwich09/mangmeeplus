import type { RequestContext } from '@watchdog-bms/contracts';

/** Expense list precedence: full access, then persisted relations, then creator only. */
export function expenseListReadScope(ctx: RequestContext): 'company' | 'related' | 'own' | null {
  const permissions = ctx.permissions ?? [];
  if (permissions.includes('expense.read') || permissions.includes('expense.review')) return 'company';
  if (permissions.includes('expense.read_related')) return 'related';
  if (permissions.includes('expense.read_own')) return 'own';
  return null;
}
