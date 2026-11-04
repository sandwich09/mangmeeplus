import { filedWithholdingPaymentPeriods } from '../../tax/application/services/filed-withholding-payment';
import { validateStatusTransition } from '../domain/logic/expense-status.logic';
import { formPeriodKey, isPeriodLocked } from '../../tax/domain/logic/tax-period.logic';
import { ConflictException, UnprocessableEntityException, type HttpException } from '@nestjs/common';
import { withholdingPeriodLockedMessage, canVoidExpenseFinancialState, EXPENSE_VOID_CERTIFICATE_WORDS, type ExpenseVoidBlocker } from '@watchdog-bms/contracts';
import { civilPeriodKey, coerceCivilDate, type TaxFormType, type ExpenseCorrectionBlocker, type ExpenseCorrectionCapabilities } from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import type { Prisma } from '../../../generated/prisma/client';
import type { DisbursementExpenseReason } from '@watchdog-bms/contracts';
import { expenseDisbursementReservationMessage } from '@watchdog-bms/contracts';
import { disbursementVoucherReadWhere, type DisbursementReadScope } from './prisma-disbursement-voucher.repository';
import { disbursementVoucherActions } from '../domain/logic/disbursement-voucher.logic';

/** The pointer is deliberately not a foreign key: fail closed even if its document is missing. */
export async function readDisbursementReservations(db: any, companyId: string, expenseIds: string[], caller?: DisbursementReadScope & { permissions: string[] }, loadedExpenses?: Array<{ id: string; reservedByDisbursementVoucherId?: string | null }>, includeDraft = false) {
  const reservations = new Map<string, { voucherId: string; documentNumber: string | null; preparerName: string | null; canOpen: boolean; viewerMay: 'act' | 'open' | 'none'; viewerCanPay: boolean; status?: string }>();
  if (!expenseIds.length) return reservations;
  const expenses = loadedExpenses ?? await db.expenseRecord.findMany({ where: { companyId, id: { in: expenseIds }, ...(!includeDraft && { reservedByDisbursementVoucherId: { not: null } }) }, select: { id: true, reservedByDisbursementVoucherId: true } });
  const voucherIds = [...new Set<string>(expenses.flatMap((e: any) => e.reservedByDisbursementVoucherId ? [e.reservedByDisbursementVoucherId] : []))];
  if (!voucherIds.length && !includeDraft) return reservations;
  const vouchers = await db.disbursementVoucher.findMany({ where: { companyId,
    ...(includeDraft ? { OR: [{ id: { in: voucherIds } }, { status: 'DRAFT', lines: { some: { companyId, expenseId: { in: expenseIds } } } }] } : { id: { in: voucherIds } }) },
    ...(includeDraft && { orderBy: { updatedAt: 'desc' } }),
    select: { id: true, status: true, documentNumber: true, preparedByUserId: true, ...(includeDraft && { lines: { select: { expenseId: true } } }) } });
  const allVoucherIds = vouchers.map((voucher: any) => voucher.id);
  const preparers = vouchers.length ? await db.user.findMany({ where: { id: { in: [...new Set(vouchers.map((v: any) => v.preparedByUserId))] }, memberships: { some: { companyId } } }, select: { id: true, displayName: true } }) : [];
  const readable = caller?.permissions.includes('expense.disbursement.read') ? await db.disbursementVoucher.findMany({ where: { ...disbursementVoucherReadWhere({ ...caller, companyId }), id: { in: allVoucherIds } }, select: { id: true } }) : [];
  const names = new Map<string, string>(preparers.map((p: any) => [p.id, p.displayName]));
  const documents = new Map<string, any>(vouchers.map((v: any) => [v.id, v]));
  const readableIds = new Set(readable.map((v: any) => v.id));
  for (const expense of expenses) {
    const draft = vouchers.find((voucher: any) => voucher.status === 'DRAFT' && voucher.lines?.some((line: any) => line.expenseId === expense.id));
    const voucherId = expense.reservedByDisbursementVoucherId ?? draft?.id;
    if (!voucherId) continue;
    const voucher = documents.get(voucherId);
    const canOpen = readableIds.has(voucherId);
    const actions = voucher && caller ? disbursementVoucherActions(voucher, caller.permissions) : null;
    reservations.set(expense.id, { voucherId, ...(voucher?.status === 'DRAFT' && { status: 'DRAFT' }), documentNumber: voucher?.documentNumber ?? null,
      preparerName: names.get(voucher?.preparedByUserId) ?? null, canOpen, viewerCanPay: canOpen && Boolean(caller?.permissions.includes('expense.disbursement.pay')), viewerMay: canOpen ? actions?.withdraw || actions?.cancel ? 'act' : 'open' : 'none' });
  }
  return reservations;
}

export async function assertExpenseDisbursementReservation(db: any, expense: { id: string; companyId: string; reservedByDisbursementVoucherId?: string | null }, operation: Parameters<typeof expenseDisbursementReservationMessage>[0], payingThroughDisbursementVoucherId?: string, caller?: DisbursementReadScope & { permissions: string[] }) {
  if (!expense.reservedByDisbursementVoucherId || (operation === 'recordPayment' && expense.reservedByDisbursementVoucherId === payingThroughDisbursementVoucherId)) return;
  const reservation = (await readDisbursementReservations(db, expense.companyId, [expense.id], caller, [expense])).get(expense.id);
  throw new ConflictException({ code: 'expense_disbursement_reserved',
    disbursementReservation: reservation ? { voucherId: reservation.canOpen ? reservation.voucherId : null, documentNumber: reservation.documentNumber, preparerName: reservation.preparerName, viewerMay: reservation.viewerMay, viewerCanPay: reservation.viewerCanPay } : null,
    message: expenseDisbursementReservationMessage(operation, reservation?.documentNumber ?? null, reservation?.preparerName ?? null, operation === 'approveSubstitute' ? 'act' : reservation?.viewerMay ?? 'none', reservation?.viewerCanPay ?? false) });
}

/** Used by both source readers and draft validation; permissions live at their entry points. */
export function disbursementExpenseSelectionReason(expense: { reservedByDisbursementVoucherId?: string | null; recordPaymentBlocker: ExpenseCorrectionBlocker | null; currency: string }): DisbursementExpenseReason | null {
  if (expense.reservedByDisbursementVoucherId) return 'reserved';
  if (expense.recordPaymentBlocker === 'live_claim') return 'claim';
  if (['personal_advance', 'missing_branch', 'not_confirmed', 'no_balance'].includes(expense.recordPaymentBlocker ?? '')) return expense.recordPaymentBlocker as DisbursementExpenseReason;
  return expense.currency !== 'THB' ? 'foreign_currency' : null;
}

/** Permission-free facts shared by the payment capability and disbursement source readers. */
export function recordExpensePaymentBlocker(expense: {
  sourceReimbursementRequestId?: string | null; status: string; branchId?: string | null; outstandingAmount: unknown;
}, liveClaim: boolean, fundingSource: string | null | undefined): ExpenseCorrectionBlocker | null {
  return liveClaim || expense.sourceReimbursementRequestId ? 'live_claim'
    : fundingSource === 'PERSONAL_ADVANCE' ? 'personal_advance'
    : expense.status !== 'CONFIRMED' ? 'not_confirmed'
    : !expense.branchId ? 'missing_branch'
    : new Decimal(String(expense.outstandingAmount)).lte(0) ? 'no_balance' : null;
}

/** A live claim can own the expense itself or any of its shared evidence files. */
export function expensePaymentClaimWhere(companyId: string, expenseIds: string[], attachmentIds: string[]): Prisma.ReimbursementLineWhereInput {
  return { companyId, request: { status: { notIn: ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED'] } }, OR: [
    { linkedExpenseId: { in: expenseIds } }, { attachmentId: { in: attachmentIds } },
  ] };
}

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

/** Certificates reached through tax events cannot be cancelled by the expense's own handoff flow. */
export async function hasExpenseTaxWorkspaceCertificate(db: any, companyId: string, expenseId: string, eventIds: string[], handoffs: any[]): Promise<boolean> {
  const issued = eventIds.length ? await db.whtCertificate.findFirst({ where: { companyId, status: 'ISSUED',
    OR: eventIds.map((id) => ({ taxEventIdsJson: { array_contains: [id] } })) }, select: { id: true } }) : null;
  return Boolean(issued || handoffs.some((h: any) => !(h.sourcePaymentType === 'expense.record' && h.sourcePaymentId === expenseId)
    && (h.status === 'SYSTEM_ISSUED' || h.status === 'EXTERNAL_LINKED' || h.certificateId || h.externalIssuedDate)));
}

/** The same facts decide both the detail capabilities and the locked mutation's refusal. */
export async function readExpenseCorrectionCapabilities(db: any, expense: any, permissions: string[], lockPeriods = false, caller?: DisbursementReadScope, includeDraft = false): Promise<ExpenseCorrectionCapabilities> {
  const companyId = expense.companyId;
  const payments = expense.payments ?? await db.expensePayment.findMany({ where: { companyId, expenseId: expense.id } });
  const journals = await db.journalEntry.findMany({ where: { companyId, OR: [
    { sourceType: 'expense.record', sourceId: expense.id },
    { sourceType: 'expense.payment', sourceId: { in: [expense.id, ...payments.map((p: any) => p.id)] } },
  ] }, select: { sourceType: true, sourceId: true, status: true } });
  const events = await db.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', sourceId: expense.id }, select: { id: true, taxPeriodId: true, status: true } });
  const handoffs = await db.whtCertificateHandoff.findMany({ where: expenseWhtHandoffWhere(companyId, expense.id, events.map((event: any) => event.id)) });
  const ownHandoff = handoffs.find((h: any) => h.sourcePaymentType === 'expense.record' && h.sourcePaymentId === expense.id && ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'].includes(h.status));
  const ownCertificate = ownHandoff?.status === 'SYSTEM_ISSUED' && ownHandoff.certificateId
    ? await db.whtCertificate.findFirst({ where: { companyId, id: ownHandoff.certificateId }, select: { certificateNumber: true, issuedAt: true } }) : null;
  const certificateOnExpense: ExpenseCorrectionCapabilities['certificateOnExpense'] = ownHandoff ? {
    kind: ownHandoff.status === 'SYSTEM_ISSUED' ? 'SYSTEM' : 'EXTERNAL',
    number: ownHandoff.status === 'SYSTEM_ISSUED' ? ownCertificate?.certificateNumber ?? null : ownHandoff.externalCertificateNumber ?? null,
    date: (ownHandoff.status === 'SYSTEM_ISSUED' ? ownCertificate?.issuedAt : ownHandoff.externalIssuedDate)?.toISOString() ?? null,
    canCancel: permissions.includes(ownHandoff.status === 'SYSTEM_ISSUED' ? 'wht.certificate.correct' : 'wht.external_certificate.link'),
  } : null;
  const taxWorkspaceCertificate = await hasExpenseTaxWorkspaceCertificate(db, companyId, expense.id, events.map((event: any) => event.id), handoffs);
  const periodLocks = await readExpensePeriodLocks(db, expense, events.filter((event: any) => event.status === 'ACTIVE').map((event: any) => event.taxPeriodId), lockPeriods);
  const claim = await findLiveClaimOf(db, companyId, expense);
  const links = await db.attachmentLink.findMany({ where: { companyId, targetType: 'expense.record', targetId: expense.id }, select: { attachmentId: true } });
  const linkedClaim = await db.reimbursementLine.findFirst({ where: expensePaymentClaimWhere(companyId, [expense.id], links.map((link: any) => link.attachmentId)), select: { id: true } });
  const substitute = await db.expenseSubstituteReceiptEvidence.findFirst({ where: { companyId, expenseId: expense.id, status: { not: 'SUPERSEDED' } }, orderBy: { version: 'desc' } });
  const reservation = expense.reservedByDisbursementVoucherId || includeDraft ? (await readDisbursementReservations(db, companyId, [expense.id], caller ? { ...caller, permissions } : undefined, [expense], includeDraft)).get(expense.id) : null;
  const disbursementReservation = reservation ? { ...(reservation.status === 'DRAFT' && { status: 'DRAFT' as const }), voucherId: reservation.canOpen ? reservation.voucherId : null, documentNumber: reservation.documentNumber, preparerName: reservation.preparerName, viewerMay: reservation.viewerMay, viewerCanPay: reservation.viewerCanPay } : null;
  const liveClaim = Boolean(claim || linkedClaim);
  const reopenBlockers: ExpenseCorrectionBlocker[] = [];
  if (expense.reservedByDisbursementVoucherId) reopenBlockers.push('disbursement_reserved');
  if (expense.status !== 'CONFIRMED') reopenBlockers.push('not_confirmed');
  if (journals.some((j: any) => j.status === 'POSTED')) reopenBlockers.push('ledger_posted');
  else if (expense.postingStatus === 'posted' || expense.postingStatus === 'reversed' || expense.journalEntryId
    || payments.some((p: any) => p.postingStatus === 'posted' || p.postingStatus === 'reversed' || p.journalEntryId)) reopenBlockers.push('posting_unresolved');
  if (journals.some((j: any) => j.status !== 'POSTED')) reopenBlockers.push('journal_pending');
  if (taxWorkspaceCertificate) reopenBlockers.push('certificate_issued');
  if (certificateOnExpense && !certificateOnExpense.canCancel) reopenBlockers.push('certificate_permission_missing');
  if (periodLocks.lockedAccountingPeriodKey) reopenBlockers.push('accounting_period_locked');
  if (periodLocks.lockedTaxPeriods.length) reopenBlockers.push('tax_period_filed');
  if (liveClaim) reopenBlockers.push('live_claim');
  if (!permissions.includes('expense.confirm')) reopenBlockers.push('permission_denied');
  const paymentPermission = permissions.includes('expense.payment.record');
  const recordPaymentBlocker: ExpenseCorrectionBlocker | null = !paymentPermission ? 'permission_denied'
    : expense.reservedByDisbursementVoucherId ? 'disbursement_reserved' : recordExpensePaymentBlocker(expense, liveClaim, substitute?.fundingSource);
  const rejectBlocker: ExpenseCorrectionBlocker | null = !permissions.includes('expense.reject') ? 'permission_denied'
    : liveClaim ? 'live_claim' : validateStatusTransition(expense.status, 'REJECTED') ? 'not_confirmed'
    : payments.some((p: any) => p.status === 'RECORDED') ? 'recorded_payments' : Number(expense.paidAmount) > 0 ? 'legacy_paid_balance' : null;
  return { ...periodLocks, certificateOnExpense, disbursementReservation, canReject: !rejectBlocker, rejectBlocker, canReopen: reopenBlockers.length === 0, reopenBlockers, canRecordPayment: !recordPaymentBlocker, recordPaymentBlocker,
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
  // Legacy claimed rows may predate component snapshots: fail closed in their VAT month.
  if (expense.inputVatClaimStatus === 'CLAIMABLE' && Number(expense.vatAmount) !== 0) formTypes.add('PP30');
  return [...formTypes];
}

/** Same date/form lookup for confirmation, capability and locked reopen. Active event periods
 * also fence retirement when a component was recognized in another month. */
/**
 * `withholdingForms`: a correction also stops at a filed ภ.ง.ด.3 / ภ.ง.ด.53 period, because reopening retires the
 * withholding events of a filed return. Confirmation does not: a document confirmed after the period was filed is
 * left to the tax sync, which skips or flags it for an amended filing, as before.
 */
export async function readExpensePeriodLocks(db: any, expense: any, eventPeriodIds: string[] = [], lock = false, withholdingForms = true) {
  const periodKey = civilPeriodKey(coerceCivilDate(expense.expenseDate));
  const formTypes = lockedTaxFormTypesOf(expense) as TaxFormType[];
  if (withholdingForms && Number(expense.whtAmount) > 0) formTypes.push(expense.vendorEntityKindSnapshot === 'INDIVIDUAL' ? 'PND3' : 'PND53');
  if (lock) {
    await db.$executeRaw`SELECT id FROM "AccountingPeriod" WHERE "companyId" = ${expense.companyId} AND "periodKey" = ${periodKey} FOR UPDATE`;
    await db.$executeRaw`SELECT id FROM "TaxPeriod" WHERE "companyId" = ${expense.companyId} AND ("periodKey" = ${periodKey} OR id IN (SELECT "taxPeriodId" FROM "TaxEvent" WHERE "companyId" = ${expense.companyId} AND "sourceType" = 'expense.record' AND "sourceId" = ${expense.id} AND status = 'ACTIVE')) ORDER BY id FOR UPDATE`;
  }
  const accounting = await db.accountingPeriod.findUnique({ where: { companyId_periodKey: { companyId: expense.companyId, periodKey } }, select: { status: true } });
  const periods = formTypes.length || eventPeriodIds.length ? await db.taxPeriod.findMany({ where: {
    companyId: expense.companyId, OR: [
      ...[...new Set(formTypes)].map(formType => ({ formType, periodKey: formPeriodKey(formType, expense.expenseDate) })),
      ...(eventPeriodIds.length ? [{ id: { in: eventPeriodIds } }] : []),
    ],
  }, select: { formType: true, periodKey: true, status: true } }) : [];
  const filedPayments = withholdingForms && (Number(expense.whtAmount) > 0 || eventPeriodIds.length) ? await filedWithholdingPaymentPeriods(db, expense.companyId, 'expense.record', expense.id, Number(expense.whtAmount) > 0 ? { formType: expense.vendorEntityKindSnapshot === 'INDIVIDUAL' ? 'PND3' : 'PND53', periodKey } : undefined, undefined, expense.whtRemittance === 'E_WHT') : [];
  return { lockedAccountingPeriodKey: accounting && !['OPEN', 'REOPENED'].includes(accounting.status) ? periodKey : null,
    lockedTaxPeriods: [...periods.filter((p: any) => !['PND3', 'PND53'].includes(p.formType) && isPeriodLocked(p.status)).map((p: any) => ({ formType: p.formType as TaxFormType, periodKey: p.periodKey })), ...filedPayments] };
}

/** Retire reporting facts before any correction can replace line ids, dates or payee facts. */
export async function retireExpenseTaxEvents(tx: any, companyId: string, expenseId: string): Promise<void> {
  const events = await tx.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', sourceId: expenseId }, select: { id: true } });
  await tx.whtCertificateHandoff.updateMany({ where: { ...expenseWhtHandoffWhere(companyId, expenseId, events.map((e: any) => e.id)), status: 'REQUIRED' }, data: { status: 'CANCELLED' } });
  await tx.taxEvent.updateMany({ where: { companyId, sourceType: 'expense.record', sourceId: expenseId, status: { in: ['ACTIVE', 'EXCLUDED'] } }, data: { status: 'SUPERSEDED', sourceHash: null } });
  await tx.taxReviewIssue.updateMany({ where: { companyId, sourceType: 'expense.record', sourceId: expenseId, status: 'OPEN',
    issueCode: { in: ['WHT_PAYEE_KIND_UNKNOWN', 'MISSING_TAX_ID', 'FUNCTIONAL_CURRENCY_FX_MISSING', 'WHT_RATE_MISMATCH'] },
    taxPeriod: { formType: { in: ['PND2', 'PND3', 'PND53'] } } }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedNote: 'ข้อมูลต้นทางเปลี่ยนแล้ว' } });
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
    error: new UnprocessableEntityException({ code: 'posting_unresolved', message: EXPENSE_VOID_CERTIFICATE_WORDS.postingUnresolved }),
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
      error: new UnprocessableEntityException({ code: 'posting_unresolved', message: EXPENSE_VOID_CERTIFICATE_WORDS.postingUnresolved }),
    } };
  }
  if (!['OPEN', 'REOPENED'].includes(period.status)) {
    return { period, refusal: {
      blocker: { code: 'accounting_period_locked', periodKey: period.periodKey },
      error: new ConflictException({ code: 'accounting_period_locked', message: EXPENSE_VOID_CERTIFICATE_WORDS.accountingPeriodLocked(period.periodKey) }),
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
        error: new ConflictException({ code: 'tax_period_locked', message: lockedTaxPeriod.formType === 'PND3' || lockedTaxPeriod.formType === 'PND53'
          ? withholdingPeriodLockedMessage(period.periodKey, 'ยกเลิกเอกสารนี้', lockedTaxPeriod.formType) : EXPENSE_VOID_CERTIFICATE_WORDS.taxPeriodLocked(period.periodKey) }),
      } };
    }
  }
  return { period };
}

/** The expense's own issued certificate or self-issued record, for cancellation checks and detail. */
export async function readExpenseCancellationCertificate(db: any, companyId: string, expenseId: string): Promise<{ kind: 'SYSTEM' | 'EXTERNAL'; number: string | null } | null> {
  const handoff = await db.whtCertificateHandoff.findFirst({ where: {
    companyId, sourcePaymentType: 'expense.record', sourcePaymentId: expenseId,
    status: { in: ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'] },
  } });
  if (handoff) {
    const certificate = handoff.status === 'SYSTEM_ISSUED' && handoff.certificateId
      ? await db.whtCertificate.findFirst({ where: { companyId, id: handoff.certificateId }, select: { certificateNumber: true } }) : null;
    return { kind: handoff.status === 'EXTERNAL_LINKED' ? 'EXTERNAL' : 'SYSTEM', number: handoff.status === 'EXTERNAL_LINKED'
      ? handoff.externalCertificateNumber ?? null : certificate?.certificateNumber ?? null };
  }
  return null;
}

/** The same structural refusals as the expense void, read before the claim's intent is written. */
export async function findClaimExpenseVoidBlocker(db: any, companyId: string, expenseId: string): Promise<ExpenseVoidBlocker | null> {
  const expense = await db.expenseRecord.findFirst({ where: { id: expenseId, companyId }, include: { lines: true } });
  // Gone or already voided: nothing is left to void. Not confirmed yet: it is closed without a journal.
  if (!expense || expense.status === 'VOIDED') return null;
  const events = await db.taxEvent.findMany({ where: { companyId, sourceType: 'expense.record', sourceId: expenseId }, select: { id: true, taxPeriodId: true, status: true } });
  const eventIds = events.map((event: any) => event.id);
  const handoffs = await db.whtCertificateHandoff.findMany({ where: expenseWhtHandoffWhere(companyId, expenseId, eventIds) });
  if (await hasExpenseTaxWorkspaceCertificate(db, companyId, expenseId, eventIds, handoffs)) return { code: 'certificate_issued' };
  if (expense.status === 'READY_FOR_CONFIRMATION') return null;
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
    message: `รายการนี้เป็นรายการค่าใช้จ่ายของใบเบิก${claim.requestNo ? ` ${claim.requestNo}` : ''} จึงยกเลิก ปฏิเสธ หรือลบจากหน้ารายจ่ายไม่ได้ `
      + 'ให้ยกเลิกที่ใบเบิกนั้นในเมนูการเบิกจ่าย ระบบจะยกเลิกรายการนี้ให้เอง ถ้าจ่ายเงินคืนแล้ว ให้ยกเลิกการจ่ายที่ใบเบิกก่อน',
    reimbursementRequestId: claim.requestId,
    ...(claim.requestNo && { requestNo: claim.requestNo }),
  });
}
