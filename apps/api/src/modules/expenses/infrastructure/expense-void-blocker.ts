import { ConflictException, UnprocessableEntityException, type HttpException } from '@nestjs/common';
import { canVoidExpenseFinancialState, type ExpenseVoidBlocker } from '@watchdog-bms/contracts';

// What stops an expense void, read in one place. The void itself throws on these; a reimbursement
// claim reads them before it commits to cancelling, and again when it shows a cancellation that has
// not finished, so a person is told what to do instead of being left with a claim that cannot move.

export type { ExpenseVoidBlocker };

type Refusal = { blocker: ExpenseVoidBlocker; error: HttpException };

/** The filed-form tax periods whose lock stops a void of this expense: the same seam the confirmation gate uses. */
export function lockedTaxFormTypesOf(expense: { lines?: any[]; inputVatClaimStatus?: string | null; vatAmount?: unknown }): string[] {
  const formTypes = new Set<string>();
  for (const line of expense.lines ?? []) {
    const components = Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [];
    for (const component of components) {
      for (const contribution of component?.reportContributions ?? []) {
        if (['PP30', 'PP36', 'CUSTOMS_SUPPORT'].includes(contribution?.formType)) formTypes.add(contribution.formType);
      }
    }
  }
  // The claim-status fallback fails closed for rows without components.
  if (expense.inputVatClaimStatus === 'CLAIMABLE' && Number(expense.vatAmount) !== 0) formTypes.add('PP30');
  return [...formTypes];
}

/**
 * The GENERATED journal a void has to reverse. A REVERSAL row for the source is the authoritative
 * "already reversed" signal (one per source by unique constraint); the original's status is not,
 * because reports count POSTED entries only.
 */
export async function findJournalToReverse(db: any, source: { companyId: string; sourceType: string; sourceId: string }): Promise<
  { reversed: true } | { reversed: false; original: any | null; refusal?: Refusal }> {
  const existingReversal = await db.journalEntry.findFirst({ where: { ...source, entryType: 'REVERSAL' }, select: { id: true } });
  if (existingReversal) return { reversed: true };
  const original = await db.journalEntry.findFirst({
    where: { ...source, entryType: 'GENERATED' },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
  });
  if (!original || original.status === 'POSTED') return { reversed: false, original };
  return { reversed: false, original, refusal: {
    blocker: { code: 'posting_unresolved' },
    error: new UnprocessableEntityException(`Generated journal ${original.entryNumber} is ${original.status}; resolve its posting state before voiding`),
  } };
}

/**
 * What the period of a posted journal refuses: a closed accounting period or a locked filed-form tax
 * period blocks the reversal. Fails closed on a missing period row: the FK guarantees it exists, but
 * a dangling id must block the void rather than skip the period and tax locks.
 */
export async function journalPeriodRefusal(
  db: any,
  opts: { companyId: string; lockedTaxFormTypes: string[] },
  original: { entryNumber: string; periodId: string },
): Promise<{ period: any; refusal?: Refusal }> {
  const period = await db.accountingPeriod.findFirst({ where: { companyId: opts.companyId, id: original.periodId } });
  if (!period) {
    return { period, refusal: {
      blocker: { code: 'posting_unresolved' },
      error: new UnprocessableEntityException(`Accounting period for journal ${original.entryNumber} was not found; cannot void`),
    } };
  }
  if (!['OPEN', 'REOPENED'].includes(period.status)) {
    return { period, refusal: {
      blocker: { code: 'accounting_period_locked', periodKey: period.periodKey },
      error: new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${period.periodKey} is not open; reopen it before voiding.` }),
    } };
  }
  if (opts.lockedTaxFormTypes.length) {
    const lockedTaxPeriod = await db.taxPeriod.findFirst({
      where: { companyId: opts.companyId, formType: { in: opts.lockedTaxFormTypes }, periodKey: period.periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] } },
      select: { formType: true },
    });
    if (lockedTaxPeriod) {
      return { period, refusal: {
        blocker: { code: 'tax_period_locked', periodKey: period.periodKey, formType: lockedTaxPeriod.formType },
        error: new ConflictException({ code: 'tax_period_locked', message: `${lockedTaxPeriod.formType}/${period.periodKey} is locked; use an adjustment or amended filing workflow.` }),
      } };
    }
  }
  return { period };
}

/**
 * What would stop voiding this claim-born expense for its claim's cancellation, read without
 * changing anything: the conditions the void itself refuses on (`VoidExpenseUseCase`,
 * `voidExpenseTrueReversal`), from the same two readers. Null: nothing known stands in the way.
 *
 * ponytail: the accrual journal only. A claim is cancelled only while it has no recorded payment,
 * so its expense records carry no settlement journal to reverse; read those too if that changes.
 */
export async function findClaimExpenseVoidBlocker(db: any, companyId: string, expenseId: string): Promise<ExpenseVoidBlocker | null> {
  const expense = await db.expenseRecord.findFirst({ where: { id: expenseId, companyId }, include: { lines: true } });
  // Gone or already voided: nothing is left to void. Not confirmed yet: it is closed without a journal.
  if (!expense || expense.status === 'VOIDED' || expense.status === 'READY_FOR_CONFIRMATION') return null;
  if (!canVoidExpenseFinancialState(expense)) return { code: 'expense_not_voidable' };
  const journal = await findJournalToReverse(db, { companyId, sourceType: 'expense.record', sourceId: expenseId });
  if (journal.reversed || !journal.original) return null;
  if (journal.refusal) return journal.refusal.blocker;
  return (await journalPeriodRefusal(db, { companyId, lockedTaxFormTypes: lockedTaxFormTypesOf(expense) }, journal.original)).refusal?.blocker ?? null;
}
