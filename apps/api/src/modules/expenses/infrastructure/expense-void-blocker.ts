import { ConflictException, UnprocessableEntityException, type HttpException } from '@nestjs/common';
import { canVoidExpenseFinancialState, type ExpenseVoidBlocker } from '@watchdog-bms/contracts';
import { civilPeriodKey, utcDateToCivilDate, type ExpenseCorrectionBlocker, type ExpenseCorrectionCapabilities } from '@watchdog-bms/contracts';

/** Shared with journal creation and certificate issuance, so stale reads cannot cross correction. */
export async function lockExpenseCorrection(tx: any, companyId: string, expenseId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${expenseId}:expense-record-lifecycle`}))`;
}

/** Includes the Tax workspace's external certificate handoffs backed by the expense's events. */
export function expenseWhtHandoffWhere(companyId: string, expenseId: string, eventIds: string[]) {
  return { companyId, OR: [
    { sourcePaymentType: 'expense.record', sourcePaymentId: expenseId },
    ...eventIds.map((id) => ({ taxEventIdsJson: { array_contains: [id] } })),
  ] };
}

/** The same facts decide both the detail capabilities and the locked mutation's refusal. */
export async function readExpenseCorrectionCapabilities(db: any, expense: any, permissions: string[]): Promise<ExpenseCorrectionCapabilities> {
  const companyId = expense.companyId;
  const payments = expense.payments ?? await db.expensePayment.findMany({ where: { companyId, expenseId: expense.id } });
  const journals = await db.journalEntry.findMany({ where: { companyId, OR: [
    { sourceType: 'expense.record', sourceId: expense.id },
    { sourceType: 'expense.payment', sourceId: { in: [expense.id, ...payments.map((p: any) => p.id)] } },
  ] }, select: { sourceType: true, sourceId: true, status: true } });
  const events = await db.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', sourceId: expense.id }, select: { id: true, taxPeriodId: true } });
  const handoffs = await db.whtCertificateHandoff.findMany({ where: expenseWhtHandoffWhere(companyId, expense.id, events.map((event: any) => event.id)) });
  const issued = events.length ? await db.whtCertificate.findFirst({ where: { companyId, OR: events.map((e: any) => ({ taxEventIdsJson: { array_contains: [e.id] } })) }, select: { id: true } }) : null;
  const periods = await db.taxPeriod.findMany({ where: { companyId, formType: 'PND53', OR: [
    { id: { in: events.map((e: any) => e.taxPeriodId) } },
    ...(Number(expense.whtAmount) > 0 && expense.vendorEntityKindSnapshot === 'JURISTIC'
      ? [{ periodKey: civilPeriodKey(utcDateToCivilDate(expense.expenseDate)) }] : []),
  ] }, select: { status: true } });
  const claim = await findLiveClaimOf(db, companyId, expense);
  const links = await db.attachmentLink.findMany({ where: { companyId, targetType: 'expense.record', targetId: expense.id }, select: { attachmentId: true } });
  const linkedClaim = await db.reimbursementLine.findFirst({ where: { companyId, request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } }, OR: [
    { linkedExpenseId: expense.id }, { attachmentId: { in: links.map((link: any) => link.attachmentId) } },
  ] }, select: { id: true } });
  const substitute = await db.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId, expenseId: expense.id }, orderBy: { version: 'desc' } });
  const liveClaim = Boolean(claim || linkedClaim);
  const reopenBlockers: ExpenseCorrectionBlocker[] = [];
  if (expense.status !== 'CONFIRMED') reopenBlockers.push('not_confirmed');
  if (journals.some((j: any) => j.status === 'POSTED')) reopenBlockers.push('ledger_posted');
  else if (expense.postingStatus === 'posted' || expense.postingStatus === 'reversed' || expense.journalEntryId
    || payments.some((p: any) => p.postingStatus === 'posted' || p.postingStatus === 'reversed' || p.journalEntryId)) reopenBlockers.push('posting_unresolved');
  if (journals.some((j: any) => j.status !== 'POSTED')) reopenBlockers.push('journal_pending');
  if (issued || handoffs.some((h: any) => h.status === 'SYSTEM_ISSUED' || h.status === 'EXTERNAL_LINKED' || h.certificateId || h.externalIssuedDate)) reopenBlockers.push('certificate_issued');
  if (periods.some((p: any) => ['FILED', 'PAID', 'CLOSED'].includes(p.status))) reopenBlockers.push('tax_period_filed');
  if (liveClaim) reopenBlockers.push('live_claim');
  if (!permissions.includes('expense.confirm')) reopenBlockers.push('permission_denied');
  const paymentPermission = permissions.includes('expense.payment.record');
  const recordPaymentBlocker: ExpenseCorrectionBlocker | null = !paymentPermission ? 'permission_denied'
    : liveClaim || expense.sourceReimbursementRequestId ? 'live_claim'
    : substitute?.fundingSource === 'PERSONAL_ADVANCE' ? 'personal_advance'
    : expense.status !== 'CONFIRMED' ? 'not_confirmed'
    : !expense.branchId ? 'missing_branch'
    : Number(expense.outstandingAmount) <= 0 ? 'no_balance' : null;
  return { canReopen: reopenBlockers.length === 0, reopenBlockers, canRecordPayment: !recordPaymentBlocker, recordPaymentBlocker,
    payments: payments.map((p: any) => {
      const ownJournals = journals.filter((j: any) => j.sourceType === 'expense.payment' && (j.sourceId === p.id || j.sourceId === expense.id));
      const cancelBlocker: ExpenseCorrectionBlocker | null = p.status === 'VOIDED' ? 'payment_voided'
        : ownJournals.some((j: any) => j.status === 'POSTED') ? 'ledger_posted'
        : ownJournals.length ? 'journal_pending'
        : p.postingStatus === 'posted' || p.postingStatus === 'reversed' || p.journalEntryId ? 'posting_unresolved'
        : liveClaim || expense.sourceReimbursementRequestId ? 'live_claim'
        : !['CONFIRMED', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'DRAFT'].includes(expense.status) ? 'not_confirmed'
        : !paymentPermission ? 'permission_denied' : null;
      return { id: p.id, canCancel: !cancelBlocker, cancelBlocker };
    }) };
}

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

// ---- An expense record that belongs to a reimbursement claim ----

/** A claim whose expense records still count: the statuses a claim's evidence is released on (`expense-capture-group`). */
const ENDED_CLAIM_STATUSES = ['REJECTED', 'CANCELLED', 'VOIDED'];

export type ExpenseClaimOwner = { requestId: string; requestNo: string | null };

/**
 * The claim an expense record belongs to, while that claim still stands. A claim's expense records are
 * built when the claim is approved and end with it: cancelling the claim voids every one of them, with
 * the claim's own checks and in step with the claim's status. Voided, rejected or deleted on its own,
 * such a record leaves a claim that can be neither paid nor carried out.
 */
export async function findLiveClaimOf(
  db: any,
  companyId: string,
  expense: { sourceReimbursementRequestId?: string | null },
): Promise<ExpenseClaimOwner | null> {
  if (!expense.sourceReimbursementRequestId) return null;
  const claim = await db.reimbursementRequest.findFirst({
    where: { id: expense.sourceReimbursementRequestId, companyId, status: { notIn: ENDED_CLAIM_STATUSES } },
    select: { id: true, requestNo: true },
  });
  return claim ? { requestId: claim.id, requestNo: claim.requestNo ?? null } : null;
}

/** The refusal of a void, a rejection or a deletion asked of the expense screen for such a record: it names where to go. */
export function claimOwnsExpenseError(claim: ExpenseClaimOwner): ConflictException {
  return new ConflictException({
    code: 'expense_belongs_to_reimbursement',
    message: `รายการนี้เป็นรายการค่าใช้จ่ายของคำขอเบิก${claim.requestNo ? ` ${claim.requestNo}` : ''} จึงยกเลิก ปฏิเสธ หรือลบจากหน้ารายจ่ายไม่ได้ `
      + 'ให้ยกเลิกที่คำขอเบิกนั้นในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง ถ้าจ่ายเงินคืนแล้ว ให้ยกเลิกการจ่ายที่คำขอเบิกก่อน',
    reimbursementRequestId: claim.requestId,
    ...(claim.requestNo && { requestNo: claim.requestNo }),
  });
}
